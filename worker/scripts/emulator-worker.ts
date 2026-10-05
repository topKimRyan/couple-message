// 로컬 개발용: Firebase 에뮬레이터를 쓰는 Worker. 실제 handlers/store 코드를 그대로 쓰고,
// custom token 은 서명 없이 만들고(Auth 에뮬레이터는 서명을 검사하지 않음), 에뮬레이터가 주는
// 서명 없는 ID 토큰은 내용만 확인한다. 푸시는 실제로 보내지 않고 콘솔에 찍는다.
// 실행: npm run dev:emulator -w worker  (먼저 루트에서 npm run emulators)
import { createServer } from 'node:http';
import { Firestore } from '../src/firestore';
import { base64url } from '../src/google-auth';
import { handle, type Deps } from '../src/handlers';
import { checkStandardClaims, decodeJwt } from '../src/id-token';
import { FirestoreStore } from '../src/store';

const PROJECT = 'demo-couple-mailbox';
const INVITE = 'DEVINVITE';
const ADMIN = 'admin@example.com';

const db = new Firestore(PROJECT, async () => 'owner', fetch, 'http://127.0.0.1:8080');
await db.commit([
  { path: `invites/${INVITE}`, fields: { alias: '개발용', used: false, createdAt: new Date() } },
  // 운영자 화면 시험용. Auth 에뮬레이터의 구글 로그인 창에서 이 이메일로 계정을 만들면 된다.
  { path: 'config/admins', fields: { emails: [ADMIN] } },
]);

const deps: Deps = {
  store: new FirestoreStore(db),
  mintToken: async (uid, claims) => {
    const iat = Math.floor(Date.now() / 1000);
    const payload = {
      iss: 'dev@example.com',
      sub: 'dev@example.com',
      aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
      iat,
      exp: iat + 3600,
      uid,
      claims,
    };
    return `${base64url(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${base64url(JSON.stringify(payload))}.`;
  },
  verifyIdToken: async (token) => {
    const decoded = decodeJwt(token);
    return decoded && checkStandardClaims(decoded.payload, PROJECT, Date.now()) ? decoded.payload : null;
  },
  sendPush: async (fcmToken, message) => {
    console.log(`[push] ${fcmToken} ${JSON.stringify(message)}`);
    return 'ok';
  },
  hashIp: async (bucket) => bucket.replace(/[^0-9a-zA-Z]/g, '_'),
  defer: (work) => void work.catch((err) => console.error(err)),
  allowedOrigins: ['http://localhost:5173'],
};

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const response = await handle(
    new Request(`http://localhost:8787${req.url}`, {
      method: req.method,
      headers: { ...(req.headers as Record<string, string>), 'cf-connecting-ip': req.socket.remoteAddress ?? '' },
      body: req.method === 'POST' ? Buffer.concat(chunks) : undefined,
    }),
    deps,
  );
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(8787, () => console.log(`emulator worker: http://localhost:8787 (초대 코드 ${INVITE}, 운영자 ${ADMIN}, 다시 시작하면 초대 코드는 미사용으로 초기화)`));
