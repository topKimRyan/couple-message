// Firebase 서비스 계정 키로 JWT를 서명한다. firebase-admin 없이 Web Crypto만 사용.

export interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

const encoder = new TextEncoder();

export function base64url(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? encoder.encode(input) : input;
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
}

const keyCache = new Map<string, Promise<CryptoKey>>();

function signingKey(pem: string): Promise<CryptoKey> {
  let key = keyCache.get(pem);
  if (!key) {
    key = crypto.subtle.importKey('pkcs8', pemToDer(pem), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, [
      'sign',
    ]);
    keyCache.set(pem, key);
  }
  return key;
}

export async function signJwt(sa: ServiceAccount, payload: Record<string, unknown>): Promise<string> {
  const unsigned = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(JSON.stringify(payload))}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await signingKey(sa.private_key), encoder.encode(unsigned));
  return `${unsigned}.${base64url(new Uint8Array(sig))}`;
}

const CUSTOM_TOKEN_AUD = 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit';

/** signInWithCustomToken 용 토큰. https://firebase.google.com/docs/auth/admin/create-custom-tokens */
export function createCustomToken(
  sa: ServiceAccount,
  uid: string,
  claims: Record<string, unknown>,
  now = Date.now(),
): Promise<string> {
  const iat = Math.floor(now / 1000);
  return signJwt(sa, {
    iss: sa.client_email,
    sub: sa.client_email,
    aud: CUSTOM_TOKEN_AUD,
    iat,
    exp: iat + 3600,
    uid,
    claims,
  });
}

const SCOPES = ['https://www.googleapis.com/auth/datastore', 'https://www.googleapis.com/auth/firebase.messaging'];

/** Firestore REST, FCM 호출용 OAuth 액세스 토큰. 만료 1분 전까지 재사용한다. */
export class AccessTokenProvider {
  private cached?: { token: string; expiresAt: number };

  constructor(
    private readonly sa: ServiceAccount,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async get(): Promise<string> {
    const now = Date.now();
    if (this.cached && this.cached.expiresAt - 60_000 > now) return this.cached.token;

    const iat = Math.floor(now / 1000);
    const assertion = await signJwt(this.sa, {
      iss: this.sa.client_email,
      scope: SCOPES.join(' '),
      aud: 'https://oauth2.googleapis.com/token',
      iat,
      exp: iat + 3600,
    });
    const res = await this.fetchFn('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    });
    if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { access_token: string; expires_in: number };
    this.cached = { token: data.access_token, expiresAt: now + data.expires_in * 1000 };
    return data.access_token;
  }
}
