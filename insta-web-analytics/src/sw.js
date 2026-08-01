// sw.js — precache the app shell so the tool works with no network.
//
// It caches only this app's own files. There is no fetch-through to any other
// origin, and no runtime caching of anything the user loads: their export
// never touches the cache because it is never fetched — it comes from a file
// input and stays in memory.

const CACHE = 'insta-web-analytics-v1';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/base.css',
  './js/main.js',
  './js/worker.js',
  './js/unzip.js',
  './js/scan.js',
  './js/charts.js',
  './js/ui.js',
  './js/views.js',
  './js/history.js',
  './js/parsers/index.js',
  './js/parsers/common.js',
  './js/parsers/profile.js',
  './js/parsers/connections.js',
  './js/parsers/content.js',
  './js/parsers/engagement.js',
  './js/parsers/consumption.js',
  './js/parsers/ads.js',
  './js/parsers/messages.js',
  './js/parsers/security.js',
  './js/parsers/insights.js',
  './js/parsers/json.js',
  './js/analytics/index.js',
  './js/analytics/util.js',
  './js/analytics/audience.js',
  './js/analytics/attribution.js',
  './js/analytics/content.js',
  './js/analytics/affinity.js',
  './js/analytics/fans.js',
  './js/analytics/insights.js',
  './js/analytics/consumption.js',
  './js/analytics/ads.js',
  './js/analytics/messages.js',
  './js/analytics/privacy.js',
  './js/analytics/summary.js',
  './js/analytics/passport.js',
  './js/analytics/trends.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // addAll is all-or-nothing; cache each file separately so one 404 during
      // development does not leave the app with no offline copy at all.
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  // Stale-while-revalidate: serve the cached copy immediately so the app opens
  // instantly and works with no network, but refresh it in the background so
  // the next load picks up a new version. Plain cache-first would pin users to
  // whatever they first installed until the cache name changed.
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(request);
      const network = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => null);
      return hit ?? (await network) ?? cache.match('./index.html');
    }),
  );
});
