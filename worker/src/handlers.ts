import type { PushMessage, PushResult, PushType } from './fcm';
import { roomClaimsOf, verifiedEmailOf, type RoomClaims, type TokenPayload } from './id-token';
import { EMPTY_LOCK, ipBucket, lockedFor, recordFailure } from './lockout';
import type { Device, Side, Store } from './store';

export interface Deps {
  store: Store;
  mintToken: (uid: string, claims: Record<string, unknown>) => Promise<string>;
  /** 서명·만료 등이 맞으면 토큰 내용. 방 클레임인지 운영자인지는 핸들러가 판단한다. */
  verifyIdToken: (token: string) => Promise<TokenPayload | null>;
  sendPush: (fcmToken: string, message: PushMessage) => Promise<PushResult>;
  /** IP 묶음을 저장용 키로. 원래 IP는 저장하지 않는다. */
  hashIp: (bucket: string) => Promise<string>;
  /** 응답을 보낸 뒤에도 마저 할 일 (ctx.waitUntil). */
  defer: (work: Promise<unknown>) => void;
  now?: () => Date;
}

const ROOM_ID_RE = /^[0-9a-f]{64}$/;
const DEVICE_ID_RE = /^[0-9A-Za-z-]{8,64}$/;
const INVITE_RE = /^[A-Z0-9]{6,32}$/;
const SAVE_LOCK_ATTEMPTS = 3;

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

// 방이 없을 때와 입력 형식이 틀렸을 때를 구분하지 않는다. (docs/design.md §4)
const mismatch = () => new HttpError(401, 'mismatch', '정보가 맞지 않아요. 다섯 칸을 다시 확인해 주세요.');
const unauthorized = () => new HttpError(401, 'auth', '다시 로그인해 주세요.');
const badRequest = () => new HttpError(400, 'bad_request', '요청 형식이 잘못됐어요.');
const locked = (ms: number) =>
  new HttpError(429, 'locked', `너무 많이 틀렸어요. ${Math.ceil(ms / 60_000)}분 뒤에 다시 해 주세요.`);

/** web/src/api.ts 의 roomUid 와 같은 규칙. */
export function roomUid(roomId: string, side: Side): string {
  return `r_${roomId.slice(0, 32)}_${side}`;
}

export function normalizeInviteCode(code: string): string {
  return code.toUpperCase().replace(/[\s-]+/g, '');
}

const other = (side: Side): Side => (side === 'a' ? 'b' : 'a');

interface Req {
  body: Record<string, unknown>;
  ip: string;
  bearer: string | null;
}

interface RoomBody {
  roomId: string;
  side: Side;
  deviceId: string;
}

function parseRoomBody(body: Record<string, unknown>): RoomBody | null {
  const { roomId, side, deviceId } = body;
  if (typeof roomId !== 'string' || !ROOM_ID_RE.test(roomId)) return null;
  if (side !== 'a' && side !== 'b') return null;
  if (typeof deviceId !== 'string' || !DEVICE_ID_RE.test(deviceId)) return null;
  return { roomId, side, deviceId };
}

function issueToken(deps: Deps, { roomId, side }: RoomBody) {
  return deps.mintToken(roomUid(roomId, side), { roomId, side });
}

const now = (deps: Deps) => deps.now?.() ?? new Date();

// ── 잠금 ──────────────────────────────────────────────

async function lockKey(deps: Deps, req: Req): Promise<string> {
  return `ip_${await deps.hashIp(ipBucket(req.ip))}`;
}

async function assertNotLocked(deps: Deps, key: string): Promise<void> {
  const lock = await deps.store.getLock(key);
  const ms = lockedFor(lock?.state ?? EMPTY_LOCK, now(deps).getTime());
  if (ms > 0) throw locked(ms);
}

/** 실패 한 번을 기록한다. 동시 요청이 서로 덮어쓰지 못하게 전제 조건으로 쓰고, 계속 겹치면 거절한다. */
async function recordFail(deps: Deps, key: string): Promise<void> {
  for (let i = 0; i < SAVE_LOCK_ATTEMPTS; i++) {
    const lock = await deps.store.getLock(key);
    const next = recordFailure(lock?.state ?? EMPTY_LOCK, now(deps).getTime());
    if (await deps.store.saveLock(key, next, lock?.updateTime ?? null)) return;
  }
  throw new HttpError(429, 'busy', '잠시 후 다시 시도해 주세요.');
}

// ── 푸시 ──────────────────────────────────────────────

const MESSAGES: Record<Exclude<PushType, 'new-device'>, PushMessage> = {
  letter: { type: 'letter', title: '새 편지가 왔어요', body: '우체통을 열어 확인해 보세요.' },
  contacts: { type: 'contacts', title: '상대 연락처가 바뀌었어요', body: '우체통에서 새 연락처를 확인해 보세요.' },
};

/** 고른 기기들에 보내고, 더는 받을 수 없는 토큰은 지운다. 실패해도 던지지 않는다. */
async function pushTo(deps: Deps, roomId: string, devices: Device[], messageFor: (d: Device) => PushMessage) {
  await Promise.all(
    devices
      .filter((d) => d.fcmToken)
      .map(async (d) => {
        try {
          const result = await deps.sendPush(d.fcmToken!, messageFor(d));
          if (result === 'invalid-token') await deps.store.clearPushToken(roomId, d.deviceId);
        } catch (err) {
          console.error('push failed', err);
        }
      }),
  );
}

async function authenticate(deps: Deps, req: Req): Promise<RoomClaims> {
  const payload = req.bearer ? await deps.verifyIdToken(req.bearer) : null;
  const claims = payload && roomClaimsOf(payload);
  if (!claims) throw unauthorized();
  return claims;
}

/** 구글 로그인한 운영자인지. 목록은 Firestore config/admins (보안 규칙과 같은 곳). */
async function authenticateAdmin(deps: Deps, req: Req): Promise<string> {
  const payload = req.bearer ? await deps.verifyIdToken(req.bearer) : null;
  const email = payload && verifiedEmailOf(payload);
  if (!email) throw unauthorized();
  if (!(await deps.store.getAdminEmails()).includes(email)) throw new HttpError(403, 'forbidden', '운영자 계정이 아니에요.');
  return email;
}

// ── 엔드포인트 ─────────────────────────────────────────

async function handleCreate(req: Req, deps: Deps) {
  const key = await lockKey(deps, req);
  await assertNotLocked(deps, key);

  const room = parseRoomBody(req.body);
  const inviteCode = normalizeInviteCode(String(req.body.inviteCode ?? ''));
  const invalidInvite = new HttpError(403, 'invite', '초대 코드가 맞지 않거나 이미 사용됐어요.');
  if (!room) {
    await recordFail(deps, key);
    throw mismatch();
  }

  // 유효한 초대 코드가 있을 때만 방 존재 여부를 알려준다.
  const invite = INVITE_RE.test(inviteCode) ? await deps.store.getInvite(inviteCode) : null;
  if (!invite || invite.used) {
    await recordFail(deps, key);
    throw invalidInvite;
  }

  const exists = new HttpError(409, 'exists', '이미 만들어진 방이에요. "처음이에요"를 끄고 들어와 주세요.');
  if (await deps.store.roomExists(room.roomId)) throw exists;

  const created = await deps.store.createRoom({
    ...room,
    inviteCode,
    inviteUpdateTime: invite.updateTime,
    now: now(deps),
  });
  if (!created) throw (await deps.store.roomExists(room.roomId)) ? exists : invalidInvite;
  return { token: await issueToken(deps, room) };
}

async function handleLogin(req: Req, deps: Deps) {
  const key = await lockKey(deps, req);
  await assertNotLocked(deps, key);

  const room = parseRoomBody(req.body);
  if (!room || !(await deps.store.roomExists(room.roomId))) {
    await recordFail(deps, key);
    throw mismatch();
  }

  const { isNew } = await deps.store.touchDevice(room.roomId, room.deviceId, room.side, now(deps));
  if (isNew) {
    // 이 기기를 뺀 방의 모든 기기에 알린다. 내 다른 기기에도 알려야 정보가 새어 나간 것을 눈치챌 수 있다.
    deps.defer(
      deps.store.listDevices(room.roomId).then((devices) =>
        pushTo(
          deps,
          room.roomId,
          devices.filter((d) => d.deviceId !== room.deviceId),
          (d) =>
            d.side === room.side
              ? {
                  type: 'new-device',
                  title: '내 정보로 새 기기에서 들어왔어요',
                  body: '내가 아니라면 다섯 가지 정보를 아는 사람이 있는지 확인해 보세요.',
                }
              : { type: 'new-device', title: '상대가 새 기기에서 들어왔어요', body: '기기를 바꿨나 봐요.' },
        ),
      ),
    );
  }
  return { token: await issueToken(deps, room) };
}

async function handleRegisterPush(req: Req, deps: Deps) {
  const { roomId, side } = await authenticate(deps, req);
  const { deviceId, fcmToken } = req.body;
  if (typeof deviceId !== 'string' || !DEVICE_ID_RE.test(deviceId)) throw badRequest();
  if (typeof fcmToken !== 'string' || fcmToken.length < 20 || fcmToken.length > 4096) throw badRequest();

  // 기록을 지운 브라우저는 새 deviceId 로 같은 토큰을 다시 등록한다. 알림이 두 번 가지 않게 옛 기기에서 뗀다.
  const devices = await deps.store.listDevices(roomId);
  await Promise.all(
    devices
      .filter((d) => d.fcmToken === fcmToken && d.deviceId !== deviceId)
      .map((d) => deps.store.clearPushToken(roomId, d.deviceId)),
  );
  await deps.store.setPushToken(roomId, deviceId, side, fcmToken, now(deps));
  return { ok: true };
}

async function handleNotify(req: Req, deps: Deps) {
  const { roomId, side } = await authenticate(deps, req);
  const type = req.body.type;
  if (type !== 'letter' && type !== 'contacts') throw badRequest();
  deps.defer(
    deps.store
      .listDevices(roomId)
      .then((devices) => pushTo(deps, roomId, devices.filter((d) => d.side === other(side)), () => MESSAGES[type])),
  );
  return { ok: true };
}

async function handleDeleteRoom(req: Req, deps: Deps) {
  const admin = await authenticateAdmin(deps, req);
  const { roomId } = req.body;
  if (typeof roomId !== 'string' || !ROOM_ID_RE.test(roomId)) throw badRequest();
  if (!(await deps.store.deleteRoom(roomId, now(deps)))) throw new HttpError(404, 'not_found', '이미 없는 방이에요.');
  console.log(`room deleted by ${admin}: ${roomId}`);
  return { ok: true };
}

// 화면 파일과 같은 주소에서 서빙되므로(wrangler.toml 의 run_worker_first) CORS 가 필요 없다.
const routes: Record<string, (req: Req, deps: Deps) => Promise<unknown>> = {
  '/api/create': handleCreate,
  '/api/login': handleLogin,
  '/api/register-push': handleRegisterPush,
  '/api/notify': handleNotify,
  '/api/admin/delete-room': handleDeleteRoom,
};

function json(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export async function handle(request: Request, deps: Deps): Promise<Response> {
  const route = routes[new URL(request.url).pathname];
  if (!route) return json(404, { error: 'not_found', message: '없는 주소예요.' });
  if (request.method !== 'POST') return json(405, { error: 'method', message: 'POST만 받아요.' });

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') throw badRequest();
    const auth = request.headers.get('authorization');
    const req: Req = {
      body: body as Record<string, unknown>,
      ip: request.headers.get('cf-connecting-ip') ?? '',
      bearer: auth?.startsWith('Bearer ') ? auth.slice(7) : null,
    };
    return json(200, await route(req, deps));
  } catch (err) {
    if (err instanceof HttpError) return json(err.status, { error: err.code, message: err.message });
    console.error(err);
    return json(500, { error: 'server', message: '잠시 후 다시 시도해 주세요.' });
  }
}
