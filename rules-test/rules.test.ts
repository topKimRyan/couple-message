import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const ROOM = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const sealed = { ct: 'Y2lwaGVydGV4dA==', iv: 'AAAAAAAAAAAAAAAA' };

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-couple-mailbox',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
});

afterAll(() => env.cleanup());

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const id of [ROOM, OTHER]) {
      await setDoc(doc(db, 'rooms', id), { createdAt: Timestamp.now(), inviteCode: 'KIMLEE2026', lastLetterAt: null });
    }
    await setDoc(doc(db, 'rooms', ROOM, 'letters', 'fromA'), {
      from: 'a',
      ...sealed,
      sentAt: Timestamp.now(),
      readAt: null,
    });
    await setDoc(doc(db, 'rooms', ROOM, 'devices', 'dev1'), { side: 'a' });
    await setDoc(doc(db, 'invites', 'KIMLEE2026'), { alias: '건우 커플', used: true });
    await setDoc(doc(db, 'invites', 'UNUSED2345'), { alias: '새 커플', used: false });
    await setDoc(doc(db, 'config', 'admins'), { emails: ['admin@example.com'] });
  });
});

function as(side: 'a' | 'b', roomId = ROOM): Firestore {
  return env.authenticatedContext(`r_${roomId.slice(0, 32)}_${side}`, { roomId, side }).firestore() as unknown as Firestore;
}

function google(email: string, verified = true): Firestore {
  return env.authenticatedContext(`g_${email}`, { email, email_verified: verified }).firestore() as unknown as Firestore;
}

function sendLetter(db: Firestore, fields: Record<string, unknown> = {}, roomId = ROOM) {
  const batch = writeBatch(db);
  batch.set(doc(collection(db, 'rooms', roomId, 'letters')), {
    from: 'a',
    ...sealed,
    sentAt: serverTimestamp(),
    readAt: null,
    ...fields,
  });
  batch.update(doc(db, 'rooms', roomId), { lastLetterAt: serverTimestamp() });
  return batch.commit();
}

describe('방 문서', () => {
  it('자기 방만 읽는다', async () => {
    await assertSucceeds(getDoc(doc(as('a'), 'rooms', ROOM)));
    await assertFails(getDoc(doc(as('a'), 'rooms', OTHER)));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore() as unknown as Firestore, 'rooms', ROOM)));
  });

  it('방 목록 조회 불가', async () => {
    await assertFails(getDocs(collection(as('a'), 'rooms')));
  });

  it('클라이언트는 방을 만들거나 지울 수 없다', async () => {
    const db = as('a', 'c'.repeat(64));
    await assertFails(setDoc(doc(db, 'rooms', 'c'.repeat(64)), { createdAt: serverTimestamp() }));
    await assertFails(deleteDoc(doc(as('a'), 'rooms', ROOM)));
  });

  it('만든 날, 초대 코드는 고칠 수 없다', async () => {
    await assertFails(updateDoc(doc(as('a'), 'rooms', ROOM), { inviteCode: 'X' }));
    await assertFails(updateDoc(doc(as('a'), 'rooms', ROOM), { createdAt: serverTimestamp() }));
  });
});

describe('연락처 칸', () => {
  const entry = () => ({ ...sealed, updatedAt: serverTimestamp() });

  it('자기 칸은 고친다', async () => {
    await assertSucceeds(updateDoc(doc(as('a'), 'rooms', ROOM), { 'contacts.a': entry() }));
    await assertSucceeds(updateDoc(doc(as('b'), 'rooms', ROOM), { 'contacts.b': entry() }));
    await assertSucceeds(updateDoc(doc(as('a'), 'rooms', ROOM), { 'contacts.a': entry() }));
  });

  it('상대 칸은 못 고친다', async () => {
    await assertFails(updateDoc(doc(as('a'), 'rooms', ROOM), { 'contacts.b': entry() }));
    await assertFails(updateDoc(doc(as('a'), 'rooms', ROOM), { contacts: { a: entry(), b: entry() } }));
  });

  it('형식이 틀리면 거부', async () => {
    const ref = doc(as('a'), 'rooms', ROOM);
    await assertFails(updateDoc(ref, { 'contacts.a': { ...sealed, updatedAt: Timestamp.now(), plain: '010' } }));
    await assertFails(updateDoc(ref, { 'contacts.a': { ...sealed, updatedAt: Timestamp.fromMillis(0) } }));
    await assertFails(updateDoc(ref, { 'contacts.a': { ...sealed, iv: 'short', updatedAt: serverTimestamp() } }));
    await assertFails(updateDoc(ref, { 'contacts.a': { ...sealed, ct: 'x'.repeat(4001), updatedAt: serverTimestamp() } }));
  });

  it('다른 방은 못 고친다', async () => {
    await assertFails(updateDoc(doc(as('a'), 'rooms', OTHER), { 'contacts.a': entry() }));
  });
});

describe('방 설정', () => {
  it('둘 다 고친다', async () => {
    await assertSucceeds(updateDoc(doc(as('b'), 'rooms', ROOM), { settings: { ...sealed, updatedAt: serverTimestamp() } }));
  });

  it('lastLetterAt 은 서버 시각으로만', async () => {
    await assertFails(updateDoc(doc(as('a'), 'rooms', ROOM), { lastLetterAt: Timestamp.fromMillis(0) }));
  });
});

describe('편지', () => {
  it('자기 방 편지를 읽는다', async () => {
    await assertSucceeds(getDocs(collection(as('b'), 'rooms', ROOM, 'letters')));
    await assertFails(getDocs(collection(as('b', OTHER), 'rooms', ROOM, 'letters')));
  });

  it('lastLetterAt 과 함께 보낸다', async () => {
    await assertSucceeds(sendLetter(as('a')));
  });

  it('lastLetterAt 없이 보내면 거부', async () => {
    const db = as('a');
    await assertFails(
      setDoc(doc(collection(db, 'rooms', ROOM, 'letters')), { from: 'a', ...sealed, sentAt: serverTimestamp(), readAt: null }),
    );
  });

  it('보낸 사람 위조, 읽음 미리 설정, 평문 필드, 큰 편지는 거부', async () => {
    await assertFails(sendLetter(as('a'), { from: 'b' }));
    await assertFails(sendLetter(as('a'), { readAt: serverTimestamp() }));
    await assertFails(sendLetter(as('a'), { text: '안녕' }));
    await assertFails(sendLetter(as('a'), { ct: 'x'.repeat(12001) }));
    await assertFails(sendLetter(as('a', OTHER), {}, ROOM));
  });

  it('받는 사람이 한 번만 읽음 표시', async () => {
    const ref = (db: Firestore) => doc(db, 'rooms', ROOM, 'letters', 'fromA');
    await assertFails(updateDoc(ref(as('a')), { readAt: serverTimestamp() }));
    await assertFails(updateDoc(ref(as('b')), { readAt: Timestamp.fromMillis(0) }));
    await assertSucceeds(updateDoc(ref(as('b')), { readAt: serverTimestamp() }));
    await assertFails(updateDoc(ref(as('b')), { readAt: serverTimestamp() }));
  });

  it('편지는 고치거나 지울 수 없다', async () => {
    const ref = doc(as('b'), 'rooms', ROOM, 'letters', 'fromA');
    await assertFails(updateDoc(ref, { ct: 'AAAA', readAt: serverTimestamp() }));
    await assertFails(deleteDoc(ref));
    await assertFails(deleteDoc(doc(as('a'), 'rooms', ROOM, 'letters', 'fromA')));
  });
});

describe('서버 전용 데이터', () => {
  it('기기, 초대, 잠금은 클라이언트가 못 본다', async () => {
    const db = as('a');
    await assertFails(getDocs(collection(db, 'rooms', ROOM, 'devices')));
    await assertFails(getDoc(doc(db, 'invites', 'KIMLEE2026')));
    await assertFails(getDoc(doc(db, 'lockouts', 'x')));
    await assertFails(setDoc(doc(db, 'rooms', ROOM, 'devices', 'mine'), { side: 'a' }));
  });
});

describe('운영자', () => {
  const admin = () => google('Admin@Example.com');
  const newInvite = (fields: Record<string, unknown> = {}) => ({
    alias: '민수 지은',
    used: false,
    createdAt: serverTimestamp(),
    ...fields,
  });

  it('방 목록과 메타데이터, 초대 코드를 본다', async () => {
    await assertSucceeds(getDocs(collection(admin(), 'rooms')));
    await assertSucceeds(getDoc(doc(admin(), 'rooms', ROOM)));
    await assertSucceeds(getDocs(collection(admin(), 'invites')));
  });

  it('편지와 기기는 운영자도 못 본다', async () => {
    await assertFails(getDocs(collection(admin(), 'rooms', ROOM, 'letters')));
    await assertFails(getDoc(doc(admin(), 'rooms', ROOM, 'letters', 'fromA')));
    await assertFails(getDocs(collection(admin(), 'rooms', ROOM, 'devices')));
  });

  it('방을 고치거나 지우는 것은 클라이언트로 안 된다 (Worker 가 한다)', async () => {
    await assertFails(updateDoc(doc(admin(), 'rooms', ROOM), { inviteCode: 'X' }));
    await assertFails(deleteDoc(doc(admin(), 'rooms', ROOM)));
  });

  it('초대 코드를 만든다', async () => {
    await assertSucceeds(setDoc(doc(admin(), 'invites', 'ABCDE23456'), newInvite()));
  });

  it('형식이 틀린 초대 코드는 거부', async () => {
    await assertFails(setDoc(doc(admin(), 'invites', 'abcde23456'), newInvite()));
    await assertFails(setDoc(doc(admin(), 'invites', 'ABCDE2345O'), newInvite()));
    await assertFails(setDoc(doc(admin(), 'invites', 'ABCDE23457'), newInvite({ used: true })));
    await assertFails(setDoc(doc(admin(), 'invites', 'ABCDE23458'), newInvite({ alias: '' })));
    await assertFails(setDoc(doc(admin(), 'invites', 'ABCDE23459'), newInvite({ roomId: ROOM })));
    await assertFails(setDoc(doc(admin(), 'invites', 'ABCDE2345B'), newInvite({ createdAt: Timestamp.fromMillis(0) })));
  });

  it('별칭만 고친다', async () => {
    await assertSucceeds(updateDoc(doc(admin(), 'invites', 'KIMLEE2026'), { alias: '건우랑 여자친구' }));
    await assertFails(updateDoc(doc(admin(), 'invites', 'UNUSED2345'), { used: true }));
  });

  it('안 쓴 초대 코드만 지운다', async () => {
    await assertSucceeds(deleteDoc(doc(admin(), 'invites', 'UNUSED2345')));
    await assertFails(deleteDoc(doc(admin(), 'invites', 'KIMLEE2026')));
  });

  it('운영자 목록은 클라이언트가 못 고친다', async () => {
    await assertFails(setDoc(doc(admin(), 'config', 'admins'), { emails: ['admin@example.com', 'me@example.com'] }));
    await assertFails(setDoc(doc(google('me@example.com'), 'config', 'admins'), { emails: ['me@example.com'] }));
  });

  it('목록에 없는 구글 계정, 이메일 미확인, 커플은 운영자가 아니다', async () => {
    for (const db of [google('someone@example.com'), google('admin@example.com', false), as('a')]) {
      await assertFails(getDocs(collection(db, 'rooms')));
      await assertFails(getDocs(collection(db, 'invites')));
      await assertFails(setDoc(doc(db, 'invites', 'ZZZZZ22222'), newInvite()));
    }
    await assertFails(getDoc(doc(google('someone@example.com'), 'rooms', ROOM)));
  });

  it('운영자 목록 문서가 없으면 아무도 운영자가 아니다', async () => {
    await env.withSecurityRulesDisabled((ctx) => deleteDoc(doc(ctx.firestore(), 'config', 'admins')));
    await assertFails(getDocs(collection(admin(), 'rooms')));
  });
});
