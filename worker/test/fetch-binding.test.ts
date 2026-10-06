import { afterEach, describe, expect, it } from 'vitest';
import { sendFcm } from '../src/fcm';
import { Firestore } from '../src/firestore';
import { AccessTokenProvider } from '../src/google-auth';
import { IdTokenVerifier } from '../src/id-token';

// Workers 의 fetch 처럼, 다른 객체의 메서드로 불리면 실패하는 fetch.
const realFetch = globalThis.fetch;
function strictFetch(this: unknown): Promise<Response> {
  if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
  return Promise.resolve(new Response('{"access_token":"t","expires_in":3600,"keys":[]}', { status: 200 }));
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('기본 fetch 는 Workers 에서도 부를 수 있게 묶여 있다', () => {
  it('AccessTokenProvider, Firestore, IdTokenVerifier, sendFcm', async () => {
    globalThis.fetch = strictFetch as unknown as typeof fetch;
    const { privateKey } = (await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair;
    const der = new Uint8Array((await crypto.subtle.exportKey('pkcs8', privateKey)) as ArrayBuffer);
    const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----\n`;
    const sa = { project_id: 'p', client_email: 'e@p', private_key: pem };

    await expect(new AccessTokenProvider(sa).get()).resolves.toBe('t');
    await expect(new Firestore('p', async () => 't').get('config/admins')).resolves.not.toBeUndefined();
    await expect(new IdTokenVerifier('p').verify('a.b.c')).resolves.toBeNull();
    await expect(sendFcm('p', async () => 't', 'tok', { type: 'letter', title: 'x', body: 'y' })).resolves.toBe('ok');
  });
});
