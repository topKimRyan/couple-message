import { AccessTokenProvider, createCustomToken, type ServiceAccount } from './google-auth';
import { Firestore } from './firestore';
import { handle, type Deps } from './handlers';
import { FirestoreStore } from './store';

export interface Env {
  /** 서비스 계정 키 JSON 전체. `wrangler secret put FIREBASE_SERVICE_ACCOUNT` */
  FIREBASE_SERVICE_ACCOUNT: string;
  /** 쉼표로 구분한 허용 출처. 예: https://이름.web.app */
  ALLOWED_ORIGINS: string;
}

// isolate가 살아 있는 동안 액세스 토큰과 서명 키를 재사용한다.
let cached: { raw: string; deps: Deps } | undefined;

function depsFor(env: Env): Deps {
  if (cached?.raw === env.FIREBASE_SERVICE_ACCOUNT) return cached.deps;
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT) as ServiceAccount;
  const tokens = new AccessTokenProvider(sa);
  const deps: Deps = {
    store: new FirestoreStore(new Firestore(sa.project_id, () => tokens.get())),
    mintToken: (uid, claims) => createCustomToken(sa, uid, claims),
    allowedOrigins: env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()),
  };
  cached = { raw: env.FIREBASE_SERVICE_ACCOUNT, deps };
  return deps;
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, depsFor(env));
  },
} satisfies ExportedHandler<Env>;
