import { describe, expect, it } from 'vitest';
import { decodeFields, encodeFields, Firestore, PreconditionFailed } from '../src/firestore';

describe('값 변환', () => {
  it('왕복', () => {
    const value = { s: '안녕', n: 3, b: true, z: null, t: new Date('2026-10-05T00:00:00Z'), m: { x: 'y' } };
    expect(decodeFields(encodeFields(value))).toEqual(value);
  });
});

describe('commit', () => {
  it('요청 형식과 전제 조건 실패', async () => {
    let sent: { url: string; body: unknown } | undefined;
    const fetchFn = (async (url: string, init: RequestInit) => {
      sent = { url, body: JSON.parse(String(init.body)) };
      return new Response('{"error":{"status":"FAILED_PRECONDITION"}}', { status: 400 });
    }) as unknown as typeof fetch;
    const db = new Firestore('demo', async () => 'token', fetchFn);

    await expect(
      db.commit([{ path: 'rooms/r1', fields: { a: 1 }, mask: ['a'], precondition: { exists: false } }]),
    ).rejects.toBeInstanceOf(PreconditionFailed);
    expect(sent?.url).toBe('https://firestore.googleapis.com/v1/projects/demo/databases/(default)/documents:commit');
    expect(sent?.body).toEqual({
      writes: [
        {
          update: { name: 'projects/demo/databases/(default)/documents/rooms/r1', fields: { a: { integerValue: '1' } } },
          updateMask: { fieldPaths: ['a'] },
          currentDocument: { exists: false },
        },
      ],
    });
  });
});
