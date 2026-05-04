/* Minimal service worker for Vite build (no workbox dependency)
 * - Cache-first for same-origin static assets
 * - Network-first for navigations, with offline fallback page
 */

const SW_VERSION = 'v1';
const STATIC_CACHE = `tatva-static-${SW_VERSION}`;
const RUNTIME_CACHE = `tatva-runtime-${SW_VERSION}`;

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      await cache.addAll(PRECACHE_URLS);
      self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith('tatva-') && k !== STATIC_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      );
      self.clients.claim();
    })()
  );
});

function isStaticAssetRequest(request) {
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  return (
    url.pathname.startsWith('/assets/') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.jpg') ||
    url.pathname.endsWith('.jpeg') ||
    url.pathname.endsWith('.webp') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.ico') ||
    url.pathname.endsWith('.woff') ||
    url.pathname.endsWith('.woff2')
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  // Navigations: network first, fallback to cached shell/offline
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const network = await fetch(request);
          const cache = await caches.open(RUNTIME_CACHE);
          cache.put('/index.html', network.clone());
          return network;
        } catch {
          const cache = await caches.open(STATIC_CACHE);
          const cachedIndex = await cache.match('/index.html');
          return cachedIndex || (await cache.match('/offline.html'));
        }
      })()
    );
    return;
  }

  // Same-origin static assets: cache first
  if (isStaticAssetRequest(request)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME_CACHE);
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        cache.put(request, response.clone());
        return response;
      })()
    );
  }
});

