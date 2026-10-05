import type { Side } from './crypto';

// 이 기기에 남겨 두는 로그인 상태. encKey는 추출 불가 CryptoKey라 원본 정보는 남지 않는다.
export interface Session {
  roomId: string;
  side: Side;
  encKey: CryptoKey;
  anniversary: string;
}

const DB_NAME = 'couple-mailbox';
const STORE = 'kv';
const SESSION_KEY = 'session';
const DEVICE_KEY = 'couple-mailbox/device-id';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function loadSession(): Promise<Session | null> {
  try {
    return (await run<Session | undefined>('readonly', (s) => s.get(SESSION_KEY))) ?? null;
  } catch {
    return null;
  }
}

export async function saveSession(session: Session): Promise<void> {
  try {
    await run('readwrite', (s) => s.put(session, SESSION_KEY));
  } catch {
    // 사생활 보호 모드 등에서는 저장이 안 될 수 있다. 다음 방문 때 다시 입력하면 된다.
  }
}

export async function clearSession(): Promise<void> {
  try {
    await run('readwrite', (s) => s.delete(SESSION_KEY));
  } catch {
    // 지울 것이 없거나 저장소를 못 쓰는 경우
  }
}

let memoryDeviceId: string | null = null;

/** 새 기기 로그인 알림에 쓰는 이 기기의 무작위 ID. */
export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    memoryDeviceId ??= crypto.randomUUID();
    return memoryDeviceId;
  }
}
