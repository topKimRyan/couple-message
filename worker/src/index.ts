import { sendFcm } from './fcm';
import { AccessTokenProvider, createCustomToken, type ServiceAccount } from './google-auth';
import { Firestore } from './firestore';
import { handle, type Deps } from './handlers';
import { IdTokenVerifier } from './id-token';
import { FirestoreStore } from './store';

export interface Env {
  /** 서비스 계정 키 JSON 전체. Cloudflare 대시보드의 변수 및 비밀(또는 `wrangler secret put`)로 넣는다. */
  FIREBASE_SERVICE_ACCOUNT: string;
}

type SharedDeps = Omit<Deps, 'defer'>;

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

// isolate가 살아 있는 동안 액세스 토큰, 서명 키, ID 토큰 공개키를 재사용한다.
let cached: { raw: string; deps: SharedDeps } | undefined;

function depsFor(env: Env): SharedDeps {
  if (cached?.raw === env.FIREBASE_SERVICE_ACCOUNT) return cached.deps;
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT) as ServiceAccount;
  const tokens = new AccessTokenProvider(sa);
  const accessToken = () => tokens.get();
  const verifier = new IdTokenVerifier(sa.project_id);
  const deps: SharedDeps = {
    store: new FirestoreStore(new Firestore(sa.project_id, accessToken)),
    mintToken: (uid, claims) => createCustomToken(sa, uid, claims),
    verifyIdToken: (token) => verifier.verify(token),
    sendPush: (fcmToken, message) => sendFcm(sa.project_id, accessToken, fcmToken, message),
    // 서비스 계정 비밀키를 소금으로 써서, 저장된 키로 IP를 거꾸로 알아낼 수 없게 한다.
    hashIp: (bucket) => sha256Hex(`${sa.private_key}|${bucket}`),
  };
  cached = { raw: env.FIREBASE_SERVICE_ACCOUNT, deps };
  return deps;
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handle(request, { ...depsFor(env), defer: (work) => ctx.waitUntil(work) });
  },
} satisfies ExportedHandler<Env>;
