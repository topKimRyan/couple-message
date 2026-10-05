// 커플 화면(firebase.ts)과 운영자 화면(admin/firebase.ts)이 같이 쓰는 설정. 이 파일은 아무것도 초기화하지 않는다.
const env = import.meta.env;

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
};

// 로컬 개발·시험용 에뮬레이터 연결은 쓰는 곳마다 import.meta.env.VITE_USE_EMULATORS === 'true' 로 직접 확인한다.
// 빌드 때 상수로 바뀌어 배포 파일에서 에뮬레이터 코드가 통째로 빠진다(다른 모듈의 변수로 받으면 안 빠진다).
