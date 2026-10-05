// 홈 화면 앱(PWA)과 웹 푸시. 서비스 워커는 public/sw.js.
import { registerPush } from './api';
import { app, auth } from './firebase';
import { getDeviceId } from './session';

const REGISTERED_KEY = 'couple-mailbox/push-registered';

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('service worker', err));
}

export function isStandalone(): boolean {
  return matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

export function isIos(): boolean {
  // 아이패드는 데스크톱 Safari 처럼 보고하므로 터치 지원으로 구분한다.
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

// ── 홈 화면에 추가 (안드로이드 크롬 등) ─────────────────────

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let installEvent: BeforeInstallPromptEvent | null = null;
const installListeners = new Set<() => void>();

/** 페이지를 열자마자 불러야 이벤트를 놓치지 않는다. */
export function captureInstallPrompt(): void {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installEvent = event as BeforeInstallPromptEvent;
    installListeners.forEach((fn) => fn());
  });
}

export function canInstall(): boolean {
  return installEvent !== null;
}

export function onInstallAvailable(fn: () => void): () => void {
  installListeners.add(fn);
  return () => installListeners.delete(fn);
}

export async function promptInstall(): Promise<boolean> {
  if (!installEvent) return false;
  const event = installEvent;
  installEvent = null;
  await event.prompt();
  return (await event.userChoice).outcome === 'accepted';
}

// ── 웹 푸시 ──────────────────────────────────────────

/**
 * needs-install: 아이폰에서 홈 화면 앱이 아니라서 알림을 받을 수 없음
 * unsupported: 이 브라우저(또는 설정)로는 불가
 */
export type PushStatus = 'needs-install' | 'unsupported' | NotificationPermission;

export async function pushStatus(): Promise<PushStatus> {
  if (isIos() && !isStandalone()) return 'needs-install';
  if (!import.meta.env.VITE_FIREBASE_VAPID_KEY) return 'unsupported';
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return 'unsupported';
  const { isSupported } = await import('firebase/messaging');
  if (!(await isSupported().catch(() => false))) return 'unsupported';
  return Notification.permission;
}

function readRegistered(): string | null {
  try {
    return localStorage.getItem(REGISTERED_KEY);
  } catch {
    return null;
  }
}

function writeRegistered(value: string): void {
  try {
    localStorage.setItem(REGISTERED_KEY, value);
  } catch {
    // 다음에 다시 등록하면 된다.
  }
}

/** 알림이 허용돼 있으면 이 기기의 푸시 토큰을 방에 등록한다. 토큰이나 방이 바뀌었을 때만 서버에 보낸다. */
export async function syncPushToken(roomId: string): Promise<void> {
  if (Notification.permission !== 'granted' || !auth.currentUser) return;
  const { getMessaging, getToken } = await import('firebase/messaging');
  const token = await getToken(getMessaging(app), {
    vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY,
    serviceWorkerRegistration: await navigator.serviceWorker.ready,
  });
  if (!token) return;
  const marker = `${roomId}|${token}`;
  if (readRegistered() === marker) return;
  await registerPush(await auth.currentUser.getIdToken(), { deviceId: getDeviceId(), fcmToken: token });
  writeRegistered(marker);
}

/** 버튼을 눌렀을 때만 부른다(아이폰은 사용자 동작 없이 권한을 물을 수 없다). */
export async function enablePush(roomId: string): Promise<PushStatus> {
  const permission = await Notification.requestPermission();
  if (permission === 'granted') await syncPushToken(roomId);
  return permission;
}
