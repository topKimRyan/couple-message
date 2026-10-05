import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  connectAuthEmulator,
  indexedDBLocalPersistence,
  initializeAuth,
} from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { firebaseConfig } from '../firebase-config';

// 커플 화면과 다른 이름의 앱을 써서 로그인 상태를 따로 둔다.
// 같은 브라우저로 자기 방에 들어가 있어도 운영자 구글 로그인이 그 로그인을 덮어쓰지 않는다.
const adminApp = initializeApp(firebaseConfig, 'admin');

export const adminAuth = initializeAuth(adminApp, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence],
  popupRedirectResolver: browserPopupRedirectResolver,
});

// 운영자 데이터는 기기에 캐시하지 않는다(기본 메모리 캐시).
export const adminDb = getFirestore(adminApp);

if (import.meta.env.VITE_USE_EMULATORS === 'true') {
  connectAuthEmulator(adminAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(adminDb, '127.0.0.1', 8080);
}
