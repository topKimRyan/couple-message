// 커플 우체통 서비스 워커. 빌드 없이 그대로 배포된다.
// - 웹 푸시: Worker(worker/src/fcm.ts)가 보낸 data 로 알림을 띄운다. 편지 내용은 들어 있지 않다.
// - 오프라인: 페이지는 네트워크 우선, 빌드된 파일(/assets/)은 캐시 우선.

const CACHE = 'couple-mailbox-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          if (res.ok) caches.open(CACHE).then((c) => c.put(request, copy));
          return res;
        })
        .catch(async () => (await caches.match(request)) || caches.match('/')),
    );
    return;
  }

  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(request, copy));
            }
            return res;
          }),
      ),
    );
  }
});

// FCM 웹 푸시 페이로드: { data: { type, title, body }, ... }
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json().data || {} : {};
  } catch {
    // 형식이 달라도 알림은 띄운다(아이폰은 푸시마다 알림을 보여야 한다).
  }
  event.waitUntil(
    self.registration.showNotification(data.title || '커플 우체통', {
      body: data.body || '우체통을 열어 확인해 보세요.',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.type || 'mailbox',
      renotify: true,
      data: { url: '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) return open.focus();
      return self.clients.openWindow('/');
    })(),
  );
});
