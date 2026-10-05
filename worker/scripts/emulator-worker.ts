// 로컬 개발용: Firebase 에뮬레이터를 쓰는 Worker. 실제 handlers/store 코드를 그대로 쓰고,
// custom token 만 서명 없이 만든다(Auth 에뮬레이터는 서명을 검사하지 않음).
// 실행: npm run dev:emulator -w worker  (먼저 루트에서 npm run emulators)
import { createServer } from 'node:http';
import { Firestore } from '../src/firestore';
import { base64url } from '../src/google-auth';
import { handle, type Deps } from '../src/handlers';
import { FirestoreStore } from '../src/store';

const PROJECT = 'demo-couple-mailbox';
const INVITE = 'DEVINVITE';

const db = new Firestore(PROJECT, async () => 'owner', fetch, 'http://127.0.0.1:8080');
await db.commit([{ path: `invites/${INVITE}`, fields: { alias: '개발용', used: false } }]);

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
  allowedOrigins: ['http://localhost:5173'],
};

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const response = await handle(
    new Request(`http://localhost:8787${req.url}`, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body: req.method === 'POST' ? Buffer.concat(chunks) : undefined,
    }),
    deps,
  );
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(8787, () => console.log(`emulator worker: http://localhost:8787 (초대 코드 ${INVITE}, 다시 시작하면 미사용으로 초기화)`));
