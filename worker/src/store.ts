import { Firestore, PreconditionFailed } from './firestore';

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

/** 핸들러가 쓰는 저장소 동작. 테스트에서는 메모리 구현으로 바꾼다. */
export interface Store {
  getInvite(code: string): Promise<Invite | null>;
  roomExists(roomId: string): Promise<boolean>;
  /** 방 생성, 초대 사용 처리, 기기 등록을 한 번에. 그 사이 방이 생겼거나 초대가 쓰였으면 false. */
  createRoom(room: NewRoom): Promise<boolean>;
  /** 기기를 기록하고 처음 보는 기기인지 돌려준다. */
  touchDevice(roomId: string, deviceId: string, side: Side, now: Date): Promise<{ isNew: boolean }>;
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
}
