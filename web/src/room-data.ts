// 방 데이터 읽기·쓰기. 평문은 이 파일 밖(화면)과 이 파일 안(암호화 직전·복호화 직후)에만 존재한다.
// 저장 형식과 보안 규칙: docs/design.md §3, firestore.rules
import {
  collection,
  doc,
  limitToLast,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
  type DocumentData,
  type FirestoreError,
  type Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { open, seal, type Sealed, type Side } from './crypto';
import { db } from './firebase';
import type { Session } from './session';

export const CONTACT_MAX = 500;
export const LETTER_MAX = 1000;

export interface ContactView {
  /** null 이면 복호화 실패 */
  text: string | null;
  updatedAt: Date;
}

export interface Settings {
  graduation: string | null;
}

export interface RoomView {
  contacts: Record<Side, ContactView | null>;
  settings: Settings;
}

export interface LetterView {
  id: string;
  from: Side;
  /** null 이면 복호화 실패 */
  text: string | null;
  sentAt: Date;
  readAt: Date | null;
  pending: boolean;
}

// 암호문이 놓이는 자리. seal/open 의 context 로 묶인다.
const contactContext = (side: Side) => `contacts/${side}`;
const SETTINGS_CONTEXT = 'settings';
const letterContext = (id: string, from: Side) => `letters/${id}/${from}`;

const DEFAULT_SETTINGS: Settings = { graduation: null };

async function openOrNull<T>(key: CryptoKey, sealed: Sealed, context: string): Promise<T | null> {
  try {
    return await open<T>(key, sealed, context);
  } catch {
    return null;
  }
}

function roomRef(session: Session) {
  return doc(db, 'rooms', session.roomId);
}

function toDate(value: unknown): Date {
  return (value as Timestamp | null)?.toDate() ?? new Date();
}

async function readContact(session: Session, data: DocumentData, side: Side): Promise<ContactView | null> {
  const entry = data.contacts?.[side];
  if (!entry) return null;
  const body = await openOrNull<{ text: string }>(session.encKey, entry, contactContext(side));
  return { text: body?.text ?? null, updatedAt: toDate(entry.updatedAt) };
}

/** 방 문서 구독. 방이 지워지면 onData(null). */
export function watchRoom(
  session: Session,
  onData: (room: RoomView | null) => void,
  onError: (err: FirestoreError) => void,
): Unsubscribe {
  let latest = 0;
  return onSnapshot(
    roomRef(session),
    async (snap) => {
      const seq = ++latest;
      if (!snap.exists()) return onData(null);
      const data = snap.data({ serverTimestamps: 'estimate' });
      const [a, b, settings] = await Promise.all([
        readContact(session, data, 'a'),
        readContact(session, data, 'b'),
        data.settings ? openOrNull<Settings>(session.encKey, data.settings, SETTINGS_CONTEXT) : null,
      ]);
      // 복호화 중에 더 새로운 스냅샷이 왔으면 버린다.
      if (seq === latest) onData({ contacts: { a, b }, settings: { ...DEFAULT_SETTINGS, ...settings } });
    },
    onError,
  );
}

/** 최근 편지 limit 개를 오래된 것부터. 편지 내용은 바뀌지 않으므로 복호화 결과를 캐시한다. */
export function watchLetters(
  session: Session,
  limit: number,
  onData: (letters: LetterView[], hasMore: boolean) => void,
  onError: (err: FirestoreError) => void,
): Unsubscribe {
  const cache = new Map<string, Promise<string | null>>();
  const decrypt = (id: string, data: DocumentData) => {
    let text = cache.get(id);
    if (!text) {
      text = openOrNull<{ text: string }>(session.encKey, data as Sealed, letterContext(id, data.from)).then(
        (body) => body?.text ?? null,
      );
      cache.set(id, text);
    }
    return text;
  };

  let latest = 0;
  const q = query(collection(db, 'rooms', session.roomId, 'letters'), orderBy('sentAt'), limitToLast(limit));
  return onSnapshot(
    q,
    { includeMetadataChanges: true },
    async (snap) => {
      const seq = ++latest;
      const letters = await Promise.all(
        snap.docs.map(async (d): Promise<LetterView> => {
          const data = d.data({ serverTimestamps: 'estimate' });
          return {
            id: d.id,
            from: data.from,
            text: await decrypt(d.id, data),
            sentAt: toDate(data.sentAt),
            readAt: data.readAt ? toDate(data.readAt) : null,
            pending: d.metadata.hasPendingWrites,
          };
        }),
      );
      if (seq === latest) onData(letters, snap.size >= limit);
    },
    onError,
  );
}

export async function saveContact(session: Session, text: string): Promise<void> {
  const sealed = await seal(session.encKey, { text }, contactContext(session.side));
  await updateDoc(roomRef(session), { [`contacts.${session.side}`]: { ...sealed, updatedAt: serverTimestamp() } });
}

export async function saveSettings(session: Session, settings: Settings): Promise<void> {
  const sealed = await seal(session.encKey, settings, SETTINGS_CONTEXT);
  await updateDoc(roomRef(session), { settings: { ...sealed, updatedAt: serverTimestamp() } });
}

/**
 * 편지와 방의 lastLetterAt 을 한 번에 쓴다(보안 규칙이 둘 다 요구).
 * 화면에는 바로 나타나고, 돌려주는 Promise 는 서버가 받았을 때 끝난다.
 */
export async function sendLetter(session: Session, text: string): Promise<void> {
  const ref = doc(collection(db, 'rooms', session.roomId, 'letters'));
  const sealed = await seal(session.encKey, { text }, letterContext(ref.id, session.side));
  const batch = writeBatch(db);
  batch.set(ref, { from: session.side, ...sealed, sentAt: serverTimestamp(), readAt: null });
  batch.update(roomRef(session), { lastLetterAt: serverTimestamp() });
  await batch.commit();
}

export async function markRead(session: Session, letterId: string): Promise<void> {
  await updateDoc(doc(db, 'rooms', session.roomId, 'letters', letterId), { readAt: serverTimestamp() });
}
