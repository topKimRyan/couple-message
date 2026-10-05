import type { Side, Store } from './store';

export interface Deps {
  store: Store;
  mintToken: (uid: string, claims: Record<string, unknown>) => Promise<string>;
  allowedOrigins: string[];
  now?: () => Date;
}

const ROOM_ID_RE = /^[0-9a-f]{64}$/;
const DEVICE_ID_RE = /^[0-9A-Za-z-]{8,64}$/;
const INVITE_RE = /^[A-Z0-9]{6,32}$/;

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

/** web/src/api.ts 의 roomUid 와 같은 규칙. */
export function roomUid(roomId: string, side: Side): string {
  return `r_${roomId.slice(0, 32)}_${side}`;
}

export function normalizeInviteCode(code: string): string {
  return code.toUpperCase().replace(/[\s-]+/g, '');
}

interface RoomBody {
  roomId: string;
  side: Side;
  deviceId: string;
}

function parseRoomBody(body: Record<string, unknown>): RoomBody {
  const { roomId, side, deviceId } = body;
  if (typeof roomId !== 'string' || !ROOM_ID_RE.test(roomId)) throw mismatch();
  if (side !== 'a' && side !== 'b') throw mismatch();
  if (typeof deviceId !== 'string' || !DEVICE_ID_RE.test(deviceId)) throw mismatch();
  return { roomId, side, deviceId };
}

function issueToken(deps: Deps, { roomId, side }: RoomBody) {
  return deps.mintToken(roomUid(roomId, side), { roomId, side });
}

// TODO(3단계): /create, /login 모두 IP·기기 잠금 확인을 맨 앞에 넣는다.

async function handleCreate(body: Record<string, unknown>, deps: Deps) {
  const room = parseRoomBody(body);
  const inviteCode = normalizeInviteCode(String(body.inviteCode ?? ''));
  const invalidInvite = new HttpError(403, 'invite', '초대 코드가 맞지 않거나 이미 사용됐어요.');
  if (!INVITE_RE.test(inviteCode)) throw invalidInvite;

  // 유효한 초대 코드가 있을 때만 방 존재 여부를 알려준다.
  const invite = await deps.store.getInvite(inviteCode);
  if (!invite || invite.used) throw invalidInvite;

  const exists = new HttpError(409, 'exists', '이미 만들어진 방이에요. "처음이에요"를 끄고 들어와 주세요.');
  if (await deps.store.roomExists(room.roomId)) throw exists;

  const created = await deps.store.createRoom({
    ...room,
    inviteCode,
    inviteUpdateTime: invite.updateTime,
    now: deps.now?.() ?? new Date(),
  });
  if (!created) throw (await deps.store.roomExists(room.roomId)) ? exists : invalidInvite;
  return { token: await issueToken(deps, room) };
}

async function handleLogin(body: Record<string, unknown>, deps: Deps) {
  const room = parseRoomBody(body);
  if (!(await deps.store.roomExists(room.roomId))) throw mismatch();
  // TODO(3단계): isNew 이면 상대 기기에 "새 기기에서 로그인" 푸시.
  await deps.store.touchDevice(room.roomId, room.deviceId, room.side, deps.now?.() ?? new Date());
  return { token: await issueToken(deps, room) };
}

const routes: Record<string, (body: Record<string, unknown>, deps: Deps) => Promise<unknown>> = {
  '/create': handleCreate,
  '/login': handleLogin,
};

function corsHeaders(origin: string | null, deps: Deps): Record<string, string> {
  if (!origin || !deps.allowedOrigins.includes(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

function json(status: number, data: unknown, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
}

export async function handle(request: Request, deps: Deps): Promise<Response> {
  const cors = corsHeaders(request.headers.get('origin'), deps);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const route = routes[new URL(request.url).pathname];
  if (!route) return json(404, { error: 'not_found', message: '없는 주소예요.' }, cors);
  if (request.method !== 'POST') return json(405, { error: 'method', message: 'POST만 받아요.' }, cors);

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') throw new HttpError(400, 'bad_request', '요청 형식이 잘못됐어요.');
    return json(200, await route(body as Record<string, unknown>, deps), cors);
  } catch (err) {
    if (err instanceof HttpError) return json(err.status, { error: err.code, message: err.message }, cors);
    console.error(err);
    return json(500, { error: 'server', message: '잠시 후 다시 시도해 주세요.' }, cors);
  }
}
