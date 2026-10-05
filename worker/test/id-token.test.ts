import { beforeAll, describe, expect, it } from 'vitest';
import { base64url } from '../src/google-auth';
import { IdTokenVerifier, roomClaimsOf, verifiedEmailOf } from '../src/id-token';

const PROJECT = 'demo-mailbox';
const ROOM = 'ab'.repeat(32);
const NOW = 1_800_000_000_000;

let privateKey: CryptoKey;
let jwk: JsonWebKey;
let fetches = 0;

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  privateKey = pair.privateKey;
  jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey;
});

async function sign(payload: Record<string, unknown>, kid = 'k1'): Promise<string> {
  const unsigned = `${base64url(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }))}.${base64url(JSON.stringify(payload))}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(unsigned));
  return `${unsigned}.${base64url(new Uint8Array(sig))}`;
}

const valid = (over: Record<string, unknown> = {}) => ({
  iss: `https://securetoken.google.com/${PROJECT}`,
  aud: PROJECT,
  sub: 'r_x_a',
  iat: NOW / 1000 - 60,
  exp: NOW / 1000 + 3000,
  roomId: ROOM,
  side: 'a',
  ...over,
});

function verifier() {
  const fetchFn = (async () => {
    fetches++;
    return new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'k1', alg: 'RS256', use: 'sig' }] }), {
      headers: { 'cache-control': 'public, max-age=1000' },
    });
  }) as unknown as typeof fetch;
  return new IdTokenVerifier(PROJECT, fetchFn, () => NOW);
}

describe('IdTokenVerifier', () => {
  it('올바른 토큰이면 내용, 방 클레임을 꺼낼 수 있다', async () => {
    const payload = await verifier().verify(await sign(valid()));
    expect(payload && roomClaimsOf(payload)).toEqual({ roomId: ROOM, side: 'a' });
  });

  it('aud, iss, 만료, 서명이 틀리면 null', async () => {
    const v = verifier();
    expect(await v.verify(await sign(valid({ aud: 'other' })))).toBeNull();
    expect(await v.verify(await sign(valid({ iss: 'https://securetoken.google.com/other' })))).toBeNull();
    expect(await v.verify(await sign(valid({ exp: NOW / 1000 - 1 })))).toBeNull();
    const token = await sign(valid());
    const tampered = token.replace(/\.[^.]+\./, `.${base64url(JSON.stringify(valid({ side: 'b' })))}.`);
    expect(await v.verify(tampered)).toBeNull();
    const unsigned = `${base64url(JSON.stringify({ alg: 'none' }))}.${base64url(JSON.stringify(valid()))}.`;
    expect(await v.verify(unsigned)).toBeNull();
  });

  it('방 클레임, 확인된 이메일 꺼내기', () => {
    expect(roomClaimsOf({ roomId: undefined, side: 'a' })).toBeNull();
    expect(roomClaimsOf({ roomId: ROOM, side: 'c' })).toBeNull();
    expect(verifiedEmailOf({ email: 'A@B.com', email_verified: true })).toBe('a@b.com');
    expect(verifiedEmailOf({ email: 'a@b.com', email_verified: false })).toBeNull();
    expect(verifiedEmailOf({ roomId: ROOM })).toBeNull();
  });

  it('공개키를 캐시하고, 모르는 kid 로 매번 다시 받지 않는다', async () => {
    const v = verifier();
    fetches = 0;
    await v.verify(await sign(valid()));
    await v.verify(await sign(valid()));
    expect(fetches).toBe(1);
    expect(await v.verify(await sign(valid(), 'unknown'))).toBeNull();
    expect(await v.verify(await sign(valid(), 'unknown2'))).toBeNull();
    expect(fetches).toBe(1);
  });
});
