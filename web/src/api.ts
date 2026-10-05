import type { Side } from './crypto';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${import.meta.env.VITE_WORKER_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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

/** Worker가 발급하는 Firebase uid와 같은 규칙. worker/src/handlers.ts 참고. */
export function roomUid(roomId: string, side: Side): string {
  return `r_${roomId.slice(0, 32)}_${side}`;
}
