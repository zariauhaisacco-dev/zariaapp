/* Zaria — Service Worker
 * Caches app shell for offline availability. API calls are network-first.
 */

const VERSION = 'zaria-v2';
const SHELL = [
  '/',
  '/css/app.css',
  '/css/dashboard.css',
  '/js/login.js',
  '/manifest.json',
  '/favicon/192',
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(VERSION).then(function (cache) {
      return cache.addAll(SHELL).catch(function () { /* ignore individual failures */ });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== VERSION; })
            .map(function (k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (event) {
  var req = event.request;

  // Only GET
  if (req.method !== 'GET') return;

  var url = new URL(req.url);

  // Same-origin only
  if (url.origin !== self.location.origin) return;

  // Never cache auth or PDF endpoints
  if (url.pathname.startsWith('/api/auth') || url.pathname.startsWith('/api/receipts') ||
      url.pathname.startsWith('/api/statements') || url.pathname.startsWith('/api/agreements')) {
    return;
  }

  // Network-first for pages and API
  event.respondWith(
    fetch(req).then(function (res) {
      // Only cache successful basic responses
      if (res && res.status === 200 && res.type === 'basic') {
        var copy = res.clone();
        caches.open(VERSION).then(function (cache) {
          cache.put(req, copy).catch(function () {});
        });
      }
      return res;
    }).catch(function () {
      // Network failed — serve from cache
      return caches.match(req).then(function (cached) {
        if (cached) return cached;
        if (req.mode === 'navigate') {
          return caches.match('/');
        }
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      });
    })
  );
});

/* ============ Push notifications ============ */
self.addEventListener('push', function (event) {
  if (!event.data) return;

  let payload = {};
  try { payload = event.data.json(); } catch (_) {
    payload = { title: 'Zaria', body: event.data.text() };
  }

  const title = payload.title || 'Zaria';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/favicon/192',
    badge: '/favicon/96',
    tag: payload.tag || 'zaria-default',
    data: { url: payload.url || '/client/dashboard' },
    requireInteraction: false,
    silent: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/* Open the URL when user clicks the notification */
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/client/dashboard';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (const c of list) {
        if (c.url.indexOf(self.location.origin) === 0 && 'focus' in c) {
          c.navigate(target);
          return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
