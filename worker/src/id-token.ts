// Firebase ID 토큰 검증. https://firebase.google.com/docs/auth/admin/verify-id-tokens#verify_id_tokens_using_a_third-party_jwt_library
import type { Side } from './store';

export interface RoomClaims {
  roomId: string;
  side: Side;
}

const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const ROOM_ID_RE = /^[0-9a-f]{64}$/;
const CLOCK_SKEW_S = 300;

function decodePart(part: string): Record<string, unknown> {
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
  const bytes = Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function decodeSignature(part: string): Uint8Array<ArrayBuffer> {
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

/** 서명 없이 내용만 꺼낸다. 형식이 틀리면 null. */
export function decodeJwt(token: string): { header: Record<string, unknown>; payload: Record<string, unknown> } | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    return { header: decodePart(parts[0]), payload: decodePart(parts[1]) };
  } catch {
    return null;
  }
}

/** 서명 이외의 항목 확인. 에뮬레이터용 검증기도 이것을 쓴다. */
export function checkRoomClaims(payload: Record<string, unknown>, projectId: string, nowMs: number): RoomClaims | null {
  const now = nowMs / 1000;
  const { aud, iss, exp, iat, sub, roomId, side } = payload;
  if (aud !== projectId || iss !== `https://securetoken.google.com/${projectId}`) return null;
  if (typeof exp !== 'number' || exp <= now) return null;
  if (typeof iat !== 'number' || iat > now + CLOCK_SKEW_S) return null;
  if (typeof sub !== 'string' || !sub) return null;
  if (typeof roomId !== 'string' || !ROOM_ID_RE.test(roomId)) return null;
  if (side !== 'a' && side !== 'b') return null;
  return { roomId, side };
}

export class IdTokenVerifier {
  private keys?: { byKid: Map<string, CryptoKey>; expiresAt: number; loadedAt: number };

  constructor(
    private readonly projectId: string,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  private async loadKeys(): Promise<Map<string, CryptoKey>> {
    const res = await this.fetchFn(JWKS_URL);
    if (!res.ok) throw new Error(`jwks: ${res.status}`);
    const { keys } = (await res.json()) as { keys: (JsonWebKey & { kid: string })[] };
    const byKid = new Map<string, CryptoKey>();
    for (const jwk of keys) {
      byKid.set(
        jwk.kid,
        await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']),
      );
    }
    const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1] ?? 3600);
    this.keys = { byKid, expiresAt: this.now() + maxAge * 1000, loadedAt: this.now() };
    return byKid;
  }

  private async key(kid: string): Promise<CryptoKey | undefined> {
    const keys = this.keys;
    if (!keys || keys.expiresAt <= this.now()) return (await this.loadKeys()).get(kid);
    if (keys.byKid.has(kid)) return keys.byKid.get(kid);
    // 키가 막 교체됐을 수 있으니 다시 받아 본다. 위조 토큰으로 매번 받게 하지 못하도록 1분에 한 번만.
    if (this.now() - keys.loadedAt < 60_000) return undefined;
    return (await this.loadKeys()).get(kid);
  }

  /** 유효하면 방 클레임, 아니면 null. */
  async verify(token: string): Promise<RoomClaims | null> {
    const decoded = decodeJwt(token);
    if (!decoded || decoded.header.alg !== 'RS256' || typeof decoded.header.kid !== 'string') return null;
    const claims = checkRoomClaims(decoded.payload, this.projectId, this.now());
    if (!claims) return null;

    const key = await this.key(decoded.header.kid);
    if (!key) return null;
    const [h, p, s] = token.split('.');
    const ok = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      decodeSignature(s),
      new TextEncoder().encode(`${h}.${p}`),
    );
    return ok ? claims : null;
  }
}
