
self.addEventListener('install', (event) => {
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
    event.waitUntil(
      self.registration.showNotification(title, {
        body: body,
        requireInteraction: true,
      })
    );
  }
});
