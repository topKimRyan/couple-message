import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

// 배포 빌드에 꼭 있어야 하는 값(web/.env.production). 비어 있으면 Firebase 에 붙지 못하는 앱이 배포되므로 빌드를 멈춘다.
const REQUIRED = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_VAPID_KEY',
];

export default defineConfig(({ command, mode }) => {
  if (command === 'build' && mode === 'production') {
    const env = loadEnv(mode, process.cwd(), 'VITE_');
    const missing = REQUIRED.filter((key) => !env[key]);
    if (missing.length) throw new Error(`web/.env.production 에 값이 없습니다: ${missing.join(', ')}`);
    if (env.VITE_USE_EMULATORS === 'true') throw new Error('배포 빌드에서 VITE_USE_EMULATORS 를 켜면 안 됩니다.');
  }
  return {
    build: {
      target: 'es2022',
      rolldownOptions: {
        input: { main: 'index.html', admin: 'admin.html' },
      },
    },
    server: {
      // 배포에서는 같은 주소의 Worker 가 /api 를 받는다. 로컬에서는 wrangler dev 또는 에뮬레이터용 Worker(8787)로.
      proxy: { '/api': 'http://localhost:8787' },
    },
    test: { environment: 'node' },
  };
});
