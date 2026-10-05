import { describe, expect, it } from 'vitest';
import { sendFcm, type PushMessage } from '../src/fcm';

const message: PushMessage = { type: 'letter', title: '새 편지가 왔어요', body: '우체통을 열어 확인해 보세요.' };

function fakeFetch(status: number, body = '{}') {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(body, { status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('sendFcm', () => {
  it('데이터 전용 webpush 메시지를 보낸다', async () => {
    const { fn, calls } = fakeFetch(200);
    expect(await sendFcm('demo', async () => 'at', 'tok', message, fn)).toBe('ok');
    expect(calls[0].url).toBe('https://fcm.googleapis.com/v1/projects/demo/messages:send');
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer at');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      message: {
        token: 'tok',
        webpush: {
          headers: { TTL: '2419200', Urgency: 'high' },
          data: { type: 'letter', title: '새 편지가 왔어요', body: '우체통을 열어 확인해 보세요.' },
        },
      },
    });
  });

  it('등록 해제된 토큰은 invalid-token, 다른 오류는 던진다', async () => {
    const unregistered = fakeFetch(404, '{"error":{"status":"NOT_FOUND","details":[{"errorCode":"UNREGISTERED"}]}}');
    expect(await sendFcm('demo', async () => 'at', 'tok', message, unregistered.fn)).toBe('invalid-token');
    const badToken = fakeFetch(400, '{"error":{"message":"The registration token is not a valid FCM registration token"}}');
    expect(await sendFcm('demo', async () => 'at', 'tok', message, badToken.fn)).toBe('invalid-token');
    const server = fakeFetch(500, 'oops');
    await expect(sendFcm('demo', async () => 'at', 'tok', message, server.fn)).rejects.toThrow('500');
  });
});
