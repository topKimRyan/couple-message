import type { Side } from './crypto';
import { auth } from './firebase';

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
    res = await fetch(`${import.meta.env.VITE_WORKER_URL}${path}`, {
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

/** 상대 기기에 푸시를 보내 달라고 한다. 알림은 덤이므로 실패해도 조용히 넘어간다. */
export async function notify(type: 'letter' | 'contacts'): Promise<void> {
  try {
    const user = auth.currentUser;
    if (user) await post('/notify', { type }, await user.getIdToken());
  } catch (err) {
    console.warn('notify', err);
  }
}

/** Worker가 발급하는 Firebase uid와 같은 규칙. worker/src/handlers.ts 참고. */
export function roomUid(roomId: string, side: Side): string {
  return `r_${roomId.slice(0, 32)}_${side}`;
}
