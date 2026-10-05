import './style.css';
import { signOut } from 'firebase/auth';
import { clearIndexedDbPersistence, terminate } from 'firebase/firestore';
import { roomUid } from './api';
import { auth, db } from './firebase';
import { renderLogin } from './pages/login';
import { renderRoom } from './pages/room';
import { clearSession, loadSession, type Session } from './session';

const root = document.getElementById('app')!;
const NOTICE_KEY = 'couple-mailbox/notice';

function showLogin(notice?: string) {
  renderLogin(root, { notice, onEnter: showRoom });
}

function showRoom(session: Session) {
  renderRoom(root, session, { onLeave: leave });
}

/** 로그인 정보와 기기에 캐시된 암호문을 지우고 처음 화면으로. */
async function leave(notice?: string) {
  await clearSession();
  await signOut(auth).catch(() => {});
  await terminate(db)
    .then(() => clearIndexedDbPersistence(db))
    .catch(() => {});
  try {
    if (notice) sessionStorage.setItem(NOTICE_KEY, notice);
  } catch {
    // 안내 문구만 사라진다.
  }
  location.reload();
}

function takeNotice(): string | undefined {
  try {
    const notice = sessionStorage.getItem(NOTICE_KEY) ?? undefined;
    sessionStorage.removeItem(NOTICE_KEY);
    return notice;
  } catch {
    return undefined;
  }
}

async function boot() {
  const [session] = await Promise.all([loadSession(), auth.authStateReady()]);
  const user = auth.currentUser;
  if (session && user?.uid === roomUid(session.roomId, session.side)) {
    showRoom(session);
  } else {
    showLogin(takeNotice());
  }
}

boot();
