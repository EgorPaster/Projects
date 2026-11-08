/* CustPlay service worker.
   Стратегия: сеть-в-первую-очередь (обновления всегда свежие при интернете),
   при отсутствии сети — из кэша (офлайн-режим PWA).
   При выходе новой версии меняй CACHE_NAME (например, custplay-v2), кэш перезапишется. */
const CACHE_NAME = 'custplay-v15';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
  './icons/icon-512-maskable.png',
  './js/i18n.js',
  './js/dice.js',
  './js/formula.js',
  './js/app.js'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) { return cache.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;   // чужие запросы не трогаем

  // Навигация (открытие/перезагрузка страницы): сначала сеть, офлайн — кэш
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then(function (res) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(function (c) { c.put(e.request, copy); });
        return res;
      }).catch(function () {
        return caches.match('./index.html').then(function (hit) { return hit || Response.error(); });
      })
    );
    return;
  }

  // Ресурсы: сеть → кэш (офлайн)
  e.respondWith(
    fetch(e.request).then(function (res) {
      const copy = res.clone();
      caches.open(CACHE_NAME).then(function (c) { c.put(e.request, copy); });
      return res;
    }).catch(function () {
      return caches.match(e.request).then(function (hit) { return hit || Response.error(); });
    })
  );
});
