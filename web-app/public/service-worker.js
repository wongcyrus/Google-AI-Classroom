self.addEventListener('install', () => {
  console.log('Service worker installed');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('Service worker activated');
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'show-notification') {
    const {
      title,
      body,
      icon = '/favicon.ico',
      badge = '/favicon.ico',
      tag = 'message',
      requireInteraction = true,
      renotify = true,
      vibrate = [300, 150, 300, 150, 300],
      data = {},
    } = event.data;

    console.log('Service Worker received message to show notification:', { title, body, tag });
    const promiseChain = self.registration.showNotification(title, {
      body,
      icon,
      badge,
      tag,
      requireInteraction,
      renotify,
      vibrate,
      data,
    }).then(() => {
        console.log('Notification shown successfully by service worker.');
        if (event.ports && event.ports[0]) {
          event.ports[0].postMessage({ success: true });
        }
    }).catch((error) => {
        console.error('Service worker failed to show notification:', error);
        if (event.ports && event.ports[0]) {
          event.ports[0].postMessage({ success: false, error: error.message });
        }
    });
    event.waitUntil(promiseChain);
  }
});

self.addEventListener('notificationclick', (event) => {
  console.log('On notification click: ', event.notification.tag);
  const tag = event.notification.tag;
  const action = event.action || '';
  const data = event.notification.data || {};
  event.notification.close();

  // Find existing window client, focus it, and notify the app of the clicked notification
  event.waitUntil(
    self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    }).then((clientList) => {
      for (const client of clientList) {
        try {
          client.postMessage({
            type: 'notification-clicked',
            tag,
            action,
            data,
          });
        } catch {}
        if ('focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow('/');
      }
    })
  );
});
