// FCM HTTP v1 으로 웹 푸시 보내기. https://firebase.google.com/docs/cloud-messaging/send/v1-api
// 알림 내용은 web/public/sw.js 가 data 를 읽어 직접 띄운다(편지 본문은 절대 넣지 않는다).

export type PushType = 'letter' | 'contacts' | 'new-device';

export interface PushMessage {
  type: PushType;
  title: string;
  body: string;
}

export type PushResult = 'ok' | 'invalid-token';

const TTL_SECONDS = 4 * 7 * 24 * 3600;

export function buildFcmRequest(token: string, message: PushMessage) {
  return {
    message: {
      token,
      webpush: {
        headers: { TTL: String(TTL_SECONDS), Urgency: 'high' },
        data: { type: message.type, title: message.title, body: message.body },
      },
    },
  };
}

export async function sendFcm(
  projectId: string,
  accessToken: () => Promise<string>,
  token: string,
  message: PushMessage,
  fetchFn: typeof fetch = fetch,
): Promise<PushResult> {
  const res = await fetchFn(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: 'POST',
    headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
    body: JSON.stringify(buildFcmRequest(token, message)),
  });
  if (res.ok) return 'ok';
  const text = await res.text();
  // 앱을 지웠거나 권한을 끈 기기. 우리 요청 형식 오류(INVALID_ARGUMENT 일반)와 구분하려고 토큰 관련 문구만 본다.
  if (res.status === 404 || /UNREGISTERED|registration token/i.test(text)) return 'invalid-token';
  throw new Error(`fcm send: ${res.status} ${text}`);
}
