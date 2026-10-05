import { beforeEach, describe, expect, it } from 'vitest';
import { handle, roomUid, type Deps } from '../src/handlers';
import type { Invite, NewRoom, Side, Store } from '../src/store';

class MemoryStore implements Store {
  invites = new Map<string, Invite>();
  rooms = new Set<string>();
  devices = new Map<string, Side>();

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
    this.devices.set(`${r.roomId}/${r.deviceId}`, r.side);
    return true;
  }
  async touchDevice(roomId: string, deviceId: string, side: Side) {
    const key = `${roomId}/${deviceId}`;
    const isNew = !this.devices.has(key);
    this.devices.set(key, side);
    return { isNew };
  }
}

const ROOM = 'ab'.repeat(32);
const ORIGIN = 'https://mailbox.web.app';
const DEVICE = '0f8e2c1a-1111-4222-8333-944455556666';

let store: MemoryStore;
let deps: Deps;

beforeEach(() => {
  store = new MemoryStore();
  store.invites.set('KIMLEE2026', { used: false, updateTime: 't1' });
  deps = {
    store,
    mintToken: async (uid, claims) => JSON.stringify({ uid, claims }),
    allowedOrigins: [ORIGIN],
  };
});

function call(path: string, body: unknown, origin = ORIGIN) {
  return handle(
    new Request(`https://worker.dev${path}`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    deps,
  );
}

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

  it('이미 있는 방이면 409, 초대 코드는 소모하지 않는다', async () => {
    store.rooms.add(ROOM);
    const res = await call('/create', { inviteCode: 'KIMLEE2026', roomId: ROOM, side: 'b', deviceId: DEVICE });
    expect(res.status).toBe(409);
    expect(store.invites.get('KIMLEE2026')?.used).toBe(false);
  });
});

describe('/login', () => {
  it('있는 방이면 토큰, 기기 기록', async () => {
    store.rooms.add(ROOM);
    const res = await call('/login', { roomId: ROOM, side: 'b', deviceId: DEVICE });
    expect(res.status).toBe(200);
    expect(store.devices.get(`${ROOM}/${DEVICE}`)).toBe('b');
  });

  it('없는 방과 잘못된 형식은 같은 401', async () => {
    const missing = await call('/login', { roomId: ROOM, side: 'a', deviceId: DEVICE });
    const malformed = await call('/login', { roomId: 'xyz', side: 'a', deviceId: DEVICE });
    expect(missing.status).toBe(401);
    expect(malformed.status).toBe(401);
    expect(await missing.json()).toEqual(await malformed.json());
  });
});

describe('라우팅과 CORS', () => {
  it('허용 안 된 출처에는 CORS 헤더 없음', async () => {
    store.rooms.add(ROOM);
    const res = await call('/login', { roomId: ROOM, side: 'a', deviceId: DEVICE }, 'https://evil.example');
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
