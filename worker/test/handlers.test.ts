import { beforeEach, describe, expect, it } from 'vitest';
import type { PushMessage, PushResult } from '../src/fcm';
import { handle, roomUid, type Deps } from '../src/handlers';
import type { LockState } from '../src/lockout';
import type { Device, Invite, NewRoom, Side, Store, StoredLock } from '../src/store';

class MemoryStore implements Store {
  invites = new Map<string, Invite>();
  rooms = new Set<string>();
  devices = new Map<string, Device & { roomId: string }>();
  locks = new Map<string, StoredLock>();
  version = 0;
  /** 다음 saveLock 을 몇 번 충돌시킬지 (동시 요청 흉내) */
  lockConflicts = 0;

  async getInvite(code: string) {
    return this.invites.get(code) ?? null;
  }
  async roomExists(roomId: string) {
    return this.rooms.has(roomId);
  }
  async createRoom(r: NewRoom) {
    const invite = this.invites.get(r.inviteCode);
    if (this.rooms.has(r.roomId) || invite?.updateTime !== r.inviteUpdateTime) return false;
    this.rooms.add(r.roomId);
    this.invites.set(r.inviteCode, { used: true, updateTime: 't2' });
    this.devices.set(`${r.roomId}/${r.deviceId}`, { roomId: r.roomId, deviceId: r.deviceId, side: r.side, fcmToken: null });
    return true;
  }
  async touchDevice(roomId: string, deviceId: string, side: Side) {
    const key = `${roomId}/${deviceId}`;
    const existing = this.devices.get(key);
    this.devices.set(key, { roomId, deviceId, side, fcmToken: existing?.fcmToken ?? null });
    return { isNew: !existing };
  }
  async listDevices(roomId: string) {
    return [...this.devices.values()].filter((d) => d.roomId === roomId).map(({ roomId: _, ...d }) => d);
  }
  async setPushToken(roomId: string, deviceId: string, side: Side, fcmToken: string) {
    this.devices.set(`${roomId}/${deviceId}`, { roomId, deviceId, side, fcmToken });
  }
  async clearPushToken(roomId: string, deviceId: string) {
    const d = this.devices.get(`${roomId}/${deviceId}`);
    if (d) d.fcmToken = null;
  }
  admins = ['admin@example.com'];
  deleted: string[] = [];
  async getAdminEmails() {
    return this.admins;
  }
  async deleteRoom(roomId: string) {
    if (!this.rooms.delete(roomId)) return false;
    this.deleted.push(roomId);
    for (const [key, d] of this.devices) if (d.roomId === roomId) this.devices.delete(key);
    return true;
  }
  async getLock(key: string) {
    return this.locks.get(key) ?? null;
  }
  async saveLock(key: string, state: LockState, prev: string | null) {
    if (this.lockConflicts > 0) {
      this.lockConflicts--;
      return false;
    }
    if ((this.locks.get(key)?.updateTime ?? null) !== prev) return false;
    this.locks.set(key, { state, updateTime: `v${++this.version}` });
    return true;
  }
}

const ROOM = 'ab'.repeat(32);
const ORIGIN = 'https://mailbox.web.app';
const DEVICE = '0f8e2c1a-1111-4222-8333-944455556666';
const FCM = (n: string) => `fcm-token-${n}-${'x'.repeat(20)}`;

let store: MemoryStore;
let deps: Deps;
let clock: number;
let pushes: { token: string; message: PushMessage }[];
let invalidTokens: Set<string>;
let deferred: Promise<unknown>[];

beforeEach(() => {
  store = new MemoryStore();
  store.invites.set('KIMLEE2026', { used: false, updateTime: 't1' });
  clock = Date.UTC(2026, 9, 5);
  pushes = [];
  invalidTokens = new Set();
  deferred = [];
  deps = {
    store,
    mintToken: async (uid, claims) => JSON.stringify({ uid, claims }),
    // 테스트용 토큰: "room:<side>" = 커플, "google:<email>[:unverified]" = 구글 로그인
    verifyIdToken: async (token) => {
      const [kind, value, flag] = token.split(':');
      if (kind === ROOM) return { sub: 'u', roomId: ROOM, side: value };
      if (kind === 'google') return { sub: 'g', email: value, email_verified: flag !== 'unverified' };
      return null;
    },
    sendPush: async (token, message): Promise<PushResult> => {
      if (invalidTokens.has(token)) return 'invalid-token';
      pushes.push({ token, message });
      return 'ok';
    },
    hashIp: async (bucket) => `h(${bucket})`,
    defer: (work) => deferred.push(work),
    allowedOrigins: [ORIGIN],
    now: () => new Date(clock),
  };
});

function call(path: string, body: unknown, opts: { origin?: string; ip?: string; bearer?: string } = {}) {
  const headers: Record<string, string> = { origin: opts.origin ?? ORIGIN, 'content-type': 'application/json' };
  if (opts.ip !== undefined) headers['cf-connecting-ip'] = opts.ip;
  else headers['cf-connecting-ip'] = '203.0.113.7';
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  return handle(new Request(`https://worker.dev${path}`, { method: 'POST', headers, body: JSON.stringify(body) }), deps);
}

const flush = () => Promise.all(deferred);

describe('/create', () => {
  it('초대 코드로 방을 만들고 토큰을 준다', async () => {
    const res = await call('/create', { inviteCode: 'kimlee-2026', roomId: ROOM, side: 'a', deviceId: DEVICE });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    const { token } = (await res.json()) as { token: string };
    expect(JSON.parse(token)).toEqual({ uid: roomUid(ROOM, 'a'), claims: { roomId: ROOM, side: 'a' } });
    expect(store.rooms.has(ROOM)).toBe(true);
    expect(store.invites.get('KIMLEE2026')?.used).toBe(true);
  });

  it('없는 초대 코드, 사용된 초대 코드는 403', async () => {
    expect((await call('/create', { inviteCode: 'NOPE1234', roomId: ROOM, side: 'a', deviceId: DEVICE })).status).toBe(403);
    await call('/create', { inviteCode: 'KIMLEE2026', roomId: ROOM, side: 'a', deviceId: DEVICE });
    const other = 'cd'.repeat(32);
    expect((await call('/create', { inviteCode: 'KIMLEE2026', roomId: other, side: 'a', deviceId: DEVICE })).status).toBe(403);
  });

  it('이미 있는 방이면 409, 초대 코드는 소모하지 않고 실패로 세지도 않는다', async () => {
    store.rooms.add(ROOM);
    const res = await call('/create', { inviteCode: 'KIMLEE2026', roomId: ROOM, side: 'b', deviceId: DEVICE });
    expect(res.status).toBe(409);
    expect(store.invites.get('KIMLEE2026')?.used).toBe(false);
    expect(store.locks.size).toBe(0);
  });

  it('틀린 초대 코드도 잠금 횟수에 들어간다', async () => {
    for (let i = 0; i < 5; i++) await call('/create', { inviteCode: `WRONG00${i}`, roomId: ROOM, side: 'a', deviceId: DEVICE });
    const res = await call('/create', { inviteCode: 'KIMLEE2026', roomId: ROOM, side: 'a', deviceId: DEVICE });
    expect(res.status).toBe(429);
  });
});

describe('/login', () => {
  it('있는 방이면 토큰, 기기 기록', async () => {
    store.rooms.add(ROOM);
    const res = await call('/login', { roomId: ROOM, side: 'b', deviceId: DEVICE });
    expect(res.status).toBe(200);
    expect(store.devices.get(`${ROOM}/${DEVICE}`)?.side).toBe('b');
  });

  it('없는 방과 잘못된 형식은 같은 401', async () => {
    const missing = await call('/login', { roomId: ROOM, side: 'a', deviceId: DEVICE });
    const malformed = await call('/login', { roomId: 'xyz', side: 'a', deviceId: DEVICE });
    expect(missing.status).toBe(401);
    expect(malformed.status).toBe(401);
    expect(await missing.json()).toEqual(await malformed.json());
  });
});

describe('잠금', () => {
  const wrong = (ip?: string) => call('/login', { roomId: 'ef'.repeat(32), side: 'a', deviceId: DEVICE }, { ip });

  it('5번 틀리면 15분 동안 맞는 정보도 막힌다', async () => {
    store.rooms.add(ROOM);
    for (let i = 0; i < 5; i++) expect((await wrong()).status).toBe(401);
    const res = await call('/login', { roomId: ROOM, side: 'a', deviceId: DEVICE });
    expect(res.status).toBe(429);
    expect(((await res.json()) as { message: string }).message).toContain('15분');

    clock += 15 * 60_000 + 1;
    expect((await call('/login', { roomId: ROOM, side: 'a', deviceId: DEVICE })).status).toBe(200);
  });

  it('IP마다 따로 센다, IPv6는 /64 단위', async () => {
    for (let i = 0; i < 5; i++) await wrong('2001:db8:1:2::1');
    expect((await wrong('2001:db8:1:2:ffff::9')).status).toBe(429);
    expect((await wrong('2001:db8:1:3::1')).status).toBe(401);
    expect((await wrong('198.51.100.1')).status).toBe(401);
  });

  it('동시 요청 충돌은 다시 읽고 센다', async () => {
    store.lockConflicts = 2;
    await wrong();
    expect([...store.locks.values()][0].state.fails).toBe(1);
  });

  it('계속 충돌하면 통과시키지 않고 429', async () => {
    store.rooms.add(ROOM);
    store.lockConflicts = 100;
    expect((await wrong()).status).toBe(429);
  });
});

describe('새 기기 알림', () => {
  beforeEach(() => {
    store.rooms.add(ROOM);
    store.devices.set(`${ROOM}/a-phone-1`, { roomId: ROOM, deviceId: 'a-phone-1', side: 'a', fcmToken: FCM('a1') });
    store.devices.set(`${ROOM}/b-phone-1`, { roomId: ROOM, deviceId: 'b-phone-1', side: 'b', fcmToken: FCM('b1') });
    store.devices.set(`${ROOM}/b-old-pc1`, { roomId: ROOM, deviceId: 'b-old-pc1', side: 'b', fcmToken: null });
  });

  it('처음 보는 기기면 이 기기를 뺀 모든 기기에 알린다', async () => {
    await call('/login', { roomId: ROOM, side: 'b', deviceId: 'b-new-tablet' });
    await flush();
    expect(pushes.map((p) => [p.token, p.message.title]).sort()).toEqual([
      [FCM('a1'), '상대가 새 기기에서 들어왔어요'],
      [FCM('b1'), '내 정보로 새 기기에서 들어왔어요'],
    ]);
  });

  it('아는 기기면 알리지 않는다', async () => {
    await call('/login', { roomId: ROOM, side: 'b', deviceId: 'b-phone-1' });
    await flush();
    expect(pushes).toEqual([]);
  });
});

describe('/register-push, /notify', () => {
  beforeEach(() => {
    store.rooms.add(ROOM);
    store.devices.set(`${ROOM}/a-phone-1`, { roomId: ROOM, deviceId: 'a-phone-1', side: 'a', fcmToken: null });
  });

  it('ID 토큰이 없거나 틀리면 401', async () => {
    expect((await call('/notify', { type: 'letter' })).status).toBe(401);
    expect((await call('/notify', { type: 'letter' }, { bearer: 'forged' })).status).toBe(401);
    expect((await call('/register-push', { deviceId: DEVICE, fcmToken: FCM('x') }, { bearer: 'nope' })).status).toBe(401);
  });

  it('토큰을 등록하고, 같은 토큰이 다른 기기에 있으면 뗀다', async () => {
    store.devices.set(`${ROOM}/a-old-id1`, { roomId: ROOM, deviceId: 'a-old-id1', side: 'a', fcmToken: FCM('a') });
    const res = await call('/register-push', { deviceId: 'a-phone-1', fcmToken: FCM('a') }, { bearer: `${ROOM}:a` });
    expect(res.status).toBe(200);
    expect(store.devices.get(`${ROOM}/a-phone-1`)?.fcmToken).toBe(FCM('a'));
    expect(store.devices.get(`${ROOM}/a-old-id1`)?.fcmToken).toBeNull();
  });

  it('형식이 틀리면 400', async () => {
    expect((await call('/register-push', { deviceId: 'x', fcmToken: FCM('a') }, { bearer: `${ROOM}:a` })).status).toBe(400);
    expect((await call('/notify', { type: 'hello' }, { bearer: `${ROOM}:a` })).status).toBe(400);
  });

  it('상대 기기에만 보내고, 만료된 토큰은 지운다', async () => {
    store.devices.set(`${ROOM}/a-phone-1`, { roomId: ROOM, deviceId: 'a-phone-1', side: 'a', fcmToken: FCM('a1') });
    store.devices.set(`${ROOM}/b-phone-1`, { roomId: ROOM, deviceId: 'b-phone-1', side: 'b', fcmToken: FCM('b1') });
    store.devices.set(`${ROOM}/b-gone-01`, { roomId: ROOM, deviceId: 'b-gone-01', side: 'b', fcmToken: FCM('gone') });
    invalidTokens.add(FCM('gone'));

    const res = await call('/notify', { type: 'letter' }, { bearer: `${ROOM}:a` });
    expect(res.status).toBe(200);
    await flush();
    expect(pushes).toEqual([{ token: FCM('b1'), message: expect.objectContaining({ type: 'letter', title: '새 편지가 왔어요' }) }]);
    expect(store.devices.get(`${ROOM}/b-gone-01`)?.fcmToken).toBeNull();
  });

  it('푸시 실패가 응답을 망치지 않는다', async () => {
    store.devices.set(`${ROOM}/b-phone-1`, { roomId: ROOM, deviceId: 'b-phone-1', side: 'b', fcmToken: FCM('b1') });
    deps.sendPush = async () => {
      throw new Error('fcm down');
    };
    const res = await call('/notify', { type: 'contacts' }, { bearer: `${ROOM}:a` });
    expect(res.status).toBe(200);
    await expect(flush()).resolves.toBeDefined();
  });
});

describe('/admin/delete-room', () => {
  beforeEach(() => {
    store.rooms.add(ROOM);
    store.devices.set(`${ROOM}/a-phone-1`, { roomId: ROOM, deviceId: 'a-phone-1', side: 'a', fcmToken: null });
  });
  const del = (bearer?: string, roomId = ROOM) => call('/admin/delete-room', { roomId }, { bearer });

  it('운영자는 방을 지운다 (이메일 대소문자 무시)', async () => {
    const res = await del('google:Admin@Example.com');
    expect(res.status).toBe(200);
    expect(store.rooms.has(ROOM)).toBe(false);
    expect(store.devices.size).toBe(0);
  });

  it('운영자가 아니면 403, 이메일 미확인·커플 토큰·토큰 없음은 401', async () => {
    expect((await del('google:someone@example.com')).status).toBe(403);
    expect((await del('google:admin@example.com:unverified')).status).toBe(401);
    expect((await del(`${ROOM}:a`)).status).toBe(401);
    expect((await del()).status).toBe(401);
    expect(store.rooms.has(ROOM)).toBe(true);
  });

  it('없는 방 404, 잘못된 형식 400', async () => {
    expect((await del('google:admin@example.com', 'cd'.repeat(32))).status).toBe(404);
    expect((await del('google:admin@example.com', 'nope')).status).toBe(400);
  });

  it('운영자 목록이 비어 있으면 아무도 못 지운다', async () => {
    store.admins = [];
    expect((await del('google:admin@example.com')).status).toBe(403);
  });

  it('구글 로그인 토큰으로 커플 기능은 못 쓴다', async () => {
    expect((await call('/notify', { type: 'letter' }, { bearer: 'google:admin@example.com' })).status).toBe(401);
  });
});

describe('라우팅과 CORS', () => {
  it('허용 안 된 출처에는 CORS 헤더 없음', async () => {
    store.rooms.add(ROOM);
    const res = await call('/login', { roomId: ROOM, side: 'a', deviceId: DEVICE }, { origin: 'https://evil.example' });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('preflight, 없는 경로, 잘못된 본문', async () => {
    const pre = await handle(new Request('https://w.dev/login', { method: 'OPTIONS', headers: { origin: ORIGIN } }), deps);
    expect(pre.status).toBe(204);
    expect((await call('/nope', {})).status).toBe(404);
    const bad = await handle(new Request('https://w.dev/login', { method: 'POST', body: 'not json' }), deps);
    expect(bad.status).toBe(400);
  });
});
