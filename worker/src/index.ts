import { sendFcm } from './fcm';
import { AccessTokenProvider, createCustomToken, type ServiceAccount } from './google-auth';
import { Firestore } from './firestore';
import { handle, type Deps } from './handlers';
import { healthResponse, parseServiceAccount, runHealthChecks } from './health';
import { IdTokenVerifier } from './id-token';
import { FirestoreStore } from './store';

export interface Env {
  /** 서비스 계정 키 JSON 전체. Cloudflare 대시보드의 변수 및 비밀(또는 `wrangler secret put`)로 넣는다. */
  FIREBASE_SERVICE_ACCOUNT?: string;
}

type SharedDeps = Omit<Deps, 'defer'>;

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

// isolate가 살아 있는 동안 액세스 토큰, 서명 키, ID 토큰 공개키를 재사용한다.
let cached: { raw: string; deps: SharedDeps; tokens: AccessTokenProvider; sa: ServiceAccount } | undefined;

function depsFor(raw: string, sa: ServiceAccount) {
  if (cached?.raw === raw) return cached;
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
  cached = { raw, deps, tokens, sa };
  return cached;
}

/** 설정을 단계별로 확인한다. 배포 후 문제가 생기면 브라우저로 /api/health 를 열어 본다. */
async function health(env: Env): Promise<Response> {
  const config = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT);
  if ('problem' in config) return healthResponse([{ name: '비밀값 FIREBASE_SERVICE_ACCOUNT', ok: false }], config.problem);
  const { deps, tokens, sa } = depsFor(env.FIREBASE_SERVICE_ACCOUNT!, config.sa);
  const checks = await runHealthChecks([
    { name: '비밀값 FIREBASE_SERVICE_ACCOUNT', run: async () => `프로젝트 ${sa.project_id}` },
    { name: '서비스 계정 키로 서명', run: async () => void (await deps.mintToken('health-check', {})) },
    { name: 'Google 인증(액세스 토큰)', run: async () => void (await tokens.get()) },
    {
      name: 'Firestore 읽기(config/admins)',
      run: async () => {
        const admins = await deps.store.getAdminEmails();
        return admins.length ? `운영자 ${admins.length}명` : '운영자 목록이 비어 있음 (config/admins 문서 확인)';
      },
    },
  ]);
  return healthResponse(checks);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (new URL(request.url).pathname === '/api/health') return health(env);
    const config = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT);
    if ('problem' in config) {
      console.error(config.problem);
      return new Response(JSON.stringify({ error: 'config', message: '서버 설정이 아직 끝나지 않았어요. 운영자에게 알려 주세요.' }), {
        status: 500,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      });
    }
    const { deps } = depsFor(env.FIREBASE_SERVICE_ACCOUNT!, config.sa);
    return handle(request, { ...deps, defer: (work) => ctx.waitUntil(work) });
  },
} satisfies ExportedHandler<Env>;
