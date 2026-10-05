import { Firestore, PreconditionFailed } from './firestore';
import type { LockState } from './lockout';

export type Side = 'a' | 'b';

export interface Invite {
  used: boolean;
  updateTime: string;
}

export interface NewRoom {
  roomId: string;
  inviteCode: string;
  inviteUpdateTime: string;
  side: Side;
  deviceId: string;
  now: Date;
}

export interface Device {
  deviceId: string;
  side: Side;
  fcmToken: string | null;
}

export interface StoredLock {
  state: LockState;
  updateTime: string;
}

/** 핸들러가 쓰는 저장소 동작. 테스트에서는 메모리 구현으로 바꾼다. */
export interface Store {
  getInvite(code: string): Promise<Invite | null>;
  roomExists(roomId: string): Promise<boolean>;
  /** 방 생성, 초대 사용 처리, 기기 등록을 한 번에. 그 사이 방이 생겼거나 초대가 쓰였으면 false. */
  createRoom(room: NewRoom): Promise<boolean>;
  /** 기기를 기록하고 처음 보는 기기인지 돌려준다. */
  touchDevice(roomId: string, deviceId: string, side: Side, now: Date): Promise<{ isNew: boolean }>;
  listDevices(roomId: string): Promise<Device[]>;
  setPushToken(roomId: string, deviceId: string, side: Side, fcmToken: string, now: Date): Promise<void>;
  clearPushToken(roomId: string, deviceId: string): Promise<void>;
  getLock(key: string): Promise<StoredLock | null>;
  /** prevUpdateTime 이후 다른 요청이 먼저 썼으면 false. 처음 쓰는 경우 prevUpdateTime 은 null. */
  saveLock(key: string, state: LockState, prevUpdateTime: string | null): Promise<boolean>;
}

export class FirestoreStore implements Store {
  constructor(private readonly db: Firestore) {}

  async getInvite(code: string): Promise<Invite | null> {
    const doc = await this.db.get(`invites/${code}`);
    return doc && { used: doc.fields.used === true, updateTime: doc.updateTime };
  }

  async roomExists(roomId: string): Promise<boolean> {
    return (await this.db.get(`rooms/${roomId}`)) !== null;
  }

  async createRoom(r: NewRoom): Promise<boolean> {
    try {
      await this.db.commit([
        {
          path: `rooms/${r.roomId}`,
          fields: { createdAt: r.now, inviteCode: r.inviteCode, lastLetterAt: null },
          precondition: { exists: false },
        },
        {
          path: `invites/${r.inviteCode}`,
          fields: { used: true, usedAt: r.now, roomId: r.roomId },
          mask: ['used', 'usedAt', 'roomId'],
          precondition: { updateTime: r.inviteUpdateTime },
        },
        {
          path: `rooms/${r.roomId}/devices/${r.deviceId}`,
          fields: { side: r.side, firstSeen: r.now, lastSeen: r.now },
        },
      ]);
      return true;
    } catch (err) {
      if (err instanceof PreconditionFailed) return false;
      throw err;
    }
  }

  async touchDevice(roomId: string, deviceId: string, side: Side, now: Date): Promise<{ isNew: boolean }> {
    const path = `rooms/${roomId}/devices/${deviceId}`;
    const existing = await this.db.get(path);
    await this.db.commit([
      existing
        ? { path, fields: { side, lastSeen: now }, mask: ['side', 'lastSeen'] }
        : { path, fields: { side, firstSeen: now, lastSeen: now } },
    ]);
    return { isNew: !existing };
  }

  async listDevices(roomId: string): Promise<Device[]> {
    const docs = await this.db.list(`rooms/${roomId}/devices`);
    return docs.map((d) => ({
      deviceId: d.id,
      side: d.fields.side as Side,
      fcmToken: typeof d.fields.fcmToken === 'string' ? d.fields.fcmToken : null,
    }));
  }

  async setPushToken(roomId: string, deviceId: string, side: Side, fcmToken: string, now: Date): Promise<void> {
    await this.db.commit([
      {
        path: `rooms/${roomId}/devices/${deviceId}`,
        fields: { side, fcmToken, lastSeen: now },
        mask: ['side', 'fcmToken', 'lastSeen'],
      },
    ]);
  }

  async clearPushToken(roomId: string, deviceId: string): Promise<void> {
    await this.db.commit([
      { path: `rooms/${roomId}/devices/${deviceId}`, fields: {}, mask: ['fcmToken'], precondition: { exists: true } },
    ]).catch((err) => {
      if (!(err instanceof PreconditionFailed)) throw err;
    });
  }

  async getLock(key: string): Promise<StoredLock | null> {
    const doc = await this.db.get(`lockouts/${key}`);
    return doc && { state: doc.fields as unknown as LockState, updateTime: doc.updateTime };
  }

  async saveLock(key: string, state: LockState, prevUpdateTime: string | null): Promise<boolean> {
    try {
      await this.db.commit([
        {
          path: `lockouts/${key}`,
          fields: { ...state },
          precondition: prevUpdateTime ? { updateTime: prevUpdateTime } : { exists: false },
        },
      ]);
      return true;
    } catch (err) {
      if (err instanceof PreconditionFailed) return false;
      throw err;
    }
  }
}
