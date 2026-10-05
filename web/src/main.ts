import './style.css';
import { signOut } from 'firebase/auth';
import { roomUid } from './api';
import { auth } from './firebase';
import { renderLogin } from './pages/login';
import { renderRoom } from './pages/room';
import { clearSession, loadSession, type Session } from './session';

const root = document.getElementById('app')!;

function showLogin(notice?: string) {
  renderLogin(root, { notice, onEnter: showRoom });
}

function showRoom(session: Session) {
  renderRoom(root, session, { onLeave: leave });
}

async function leave(notice?: string) {
  await clearSession();
  await signOut(auth).catch(() => {});
  showLogin(notice);
}

async function boot() {
  const [session] = await Promise.all([loadSession(), auth.authStateReady()]);
  const user = auth.currentUser;
  if (session && user?.uid === roomUid(session.roomId, session.side)) {
    showRoom(session);
  } else {
    showLogin();
  }
}

boot();
