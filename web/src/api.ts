import type { Side } from './crypto';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function post<T>(path: string, body: unknown, idToken?: string): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (idToken) headers.authorization = `Bearer ${idToken}`;
  let res: Response;
  try {
    // 화면과 같은 주소의 Worker. 로컬 개발에서는 vite 가 /api 를 localhost:8787 로 넘긴다.
    res = await fetch(`/api${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError('network', '인터넷 연결을 확인해 주세요.');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string } & T;
  if (!res.ok) throw new ApiError(data.error ?? 'unknown', data.message ?? '잠시 후 다시 시도해 주세요.');
  return data;
}

export function createRoom(body: { inviteCode: string; roomId: string; side: Side; deviceId: string }) {
  return post<{ token: string }>('/create', body);
}

export function login(body: { roomId: string; side: Side; deviceId: string }) {
  return post<{ token: string }>('/login', body);
}

export function registerPush(idToken: string, body: { deviceId: string; fcmToken: string }) {
  return post<{ ok: true }>('/register-push', body, idToken);
}

export function notify(idToken: string, type: 'letter' | 'contacts') {
  return post<{ ok: true }>('/notify', { type }, idToken);
}

/** 운영자 전용: 편지·기기까지 방을 통째로 지운다. */
export function deleteRoom(idToken: string, roomId: string) {
  return post<{ ok: true }>('/admin/delete-room', { roomId }, idToken);
}

/** Worker가 발급하는 Firebase uid와 같은 규칙. worker/src/handlers.ts 참고. */
export function roomUid(roomId: string, side: Side): string {
  return `r_${roomId.slice(0, 32)}_${side}`;
}
