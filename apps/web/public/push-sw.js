/* Push handlers, imported into the generated service worker (vite.config.ts → workbox.importScripts). */
self.addEventListener('push', (event) => {
  let msg = { title: 'CoinClash', body: 'Something happened in your game.', url: '/' };
  try {
    msg = { ...msg, ...event.data.json() };
  } catch (_) {
    /* plain-text or empty payload */
  }
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // The app is open and visible: it already shows the challenge live, so don't double up.
      if (clients.some((c) => c.visibilityState === 'visible')) return undefined;
      return self.registration.showNotification(msg.title, {
        body: msg.body,
        tag: msg.tag,
        icon: '/pwa-192.png',
        badge: '/pwa-192.png',
        data: { url: msg.url },
      });
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if ('focus' in c) {
          c.navigate(url);
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
