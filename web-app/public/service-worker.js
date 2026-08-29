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
    const { title, body } = event.data;
    console.log('Service Worker received message to show notification:', { title, body });
    const promiseChain = self.registration.showNotification(title, {
      body: body,
      requireInteraction: true,
      tag: 'message' // Use a tag to prevent stacking notifications
    }).then(() => {
        console.log('Notification shown successfully by service worker.');
    }).catch((error) => {
        console.error('Service worker failed to show notification:', error);
    });
    event.waitUntil(promiseChain);
  }
});

self.addEventListener('notificationclick', (event) => {
  console.log('On notification click: ', event.notification.tag);
  event.notification.close();

  // Find existing window client and focus it, preventing unwanted duplicate tabs
  event.waitUntil(
    self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    }).then((clientList) => {
      for (const client of clientList) {
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
