import { initializeApp } from 'firebase/app';
import { firebaseConfig } from './firebase-config';
import { browserLocalPersistence, connectAuthEmulator, indexedDBLocalPersistence, initializeAuth } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';

export const app = initializeApp(firebaseConfig);

// 커플은 custom token 으로만 로그인하므로 팝업·리디렉션 로그인 도구(apis.google.com 스크립트)를 싣지 않는다.
export const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });

// 기기에 암호문을 캐시해 두면 다시 열 때 빠르고 읽기 횟수(무료 한도)도 아낀다.
// IndexedDB 를 못 쓰는 환경에서는 Firebase 가 메모리 캐시로 대신한다.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

if (import.meta.env.VITE_USE_EMULATORS === 'true') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}
