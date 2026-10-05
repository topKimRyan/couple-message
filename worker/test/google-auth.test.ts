import { describe, expect, it } from 'vitest';
import { createCustomToken, type ServiceAccount } from '../src/google-auth';

function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

async function makeServiceAccount() {
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const der = new Uint8Array((await crypto.subtle.exportKey('pkcs8', pair.privateKey)) as ArrayBuffer);
  const b64 = btoa(String.fromCharCode(...der)).replace(/(.{64})/g, '$1\n');
  const sa: ServiceAccount = {
    project_id: 'demo',
    client_email: 'firebase-adminsdk@demo.iam.gserviceaccount.com',
    private_key: `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`,
  };
  return { sa, publicKey: pair.publicKey };
}

describe('createCustomToken', () => {
  it('Firebase 형식의 RS256 토큰을 만든다', async () => {
    const { sa, publicKey } = await makeServiceAccount();
    const token = await createCustomToken(sa, 'r_abc_a', { roomId: 'abc', side: 'a' }, 1_800_000_000_000);
    const [h, p, s] = token.split('.');

    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, b64urlDecode(s), new TextEncoder().encode(`${h}.${p}`));
    expect(ok).toBe(true);
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(h)))).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(JSON.parse(new TextDecoder().decode(b64urlDecode(p)))).toEqual({
      iss: sa.client_email,
      sub: sa.client_email,
      aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
      iat: 1_800_000_000,
      exp: 1_800_003_600,
      uid: 'r_abc_a',
      claims: { roomId: 'abc', side: 'a' },
    });
  });
});
