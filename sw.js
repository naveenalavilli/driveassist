'use strict';

const CACHE_PREFIX = `driveassist:${self.registration.scope}:`;
const VERSION = `${CACHE_PREFIX}shell-v8`;
const ASSET_CACHE = `${CACHE_PREFIX}models-v1`;
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './drive-core.js',
  './sign-reader.js',
  './script.js',
  './settings.js',
  './manifest.webmanifest',
  './info.html',
  './offline.html',
  './privacy.html',
  './404.html',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];
const OFFLINE_AI_ASSETS = [
  'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js',
  'https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js',
  'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js',
  'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js',
  'https://storage.googleapis.com/tfjs-models/savedmodel/ssdlite_mobilenet_v2/model.json',
  'https://storage.googleapis.com/tfjs-models/savedmodel/ssdlite_mobilenet_v2/group1-shard1of5',
  'https://storage.googleapis.com/tfjs-models/savedmodel/ssdlite_mobilenet_v2/group1-shard2of5',
  'https://storage.googleapis.com/tfjs-models/savedmodel/ssdlite_mobilenet_v2/group1-shard3of5',
  'https://storage.googleapis.com/tfjs-models/savedmodel/ssdlite_mobilenet_v2/group1-shard4of5',
  'https://storage.googleapis.com/tfjs-models/savedmodel/ssdlite_mobilenet_v2/group1-shard5of5',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then(async (cache) => {
    await cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: 'reload' })));
    // Model downloads must not hold installation open on an unreliable network.
  }));
  // Wait for existing pages to close rather than mixing a new shell with a live drive.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== VERSION && key !== ASSET_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function storeResponse(cacheName, request, response) {
  try { await (await caches.open(cacheName)).put(request, response); } catch { /* Storage may be full or unavailable. */ }
}

// After first activation, cache the already-loaded scripts/models as well as
// assets fetched by controlled pages. Keep them across shell-only updates.
self.addEventListener('message', (event) => {
  if (event.data !== 'cache-models') return;
  event.waitUntil((async () => {
    const cache = await caches.open(ASSET_CACHE);
    await Promise.allSettled(OFFLINE_AI_ASSETS.map(async (url) => {
      if (await cache.match(url)) return;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (response.ok) await storeResponse(ASSET_CACHE, url, response);
      } finally { clearTimeout(timer); }
    }));
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);

  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      // App-shell HTML and JS always come from the same installed version.
      const cached = await cache.match(event.request, { ignoreSearch: true });
      if (cached) return cached;
      try { return await fetch(event.request); }
      catch { return await cache.match('./offline.html'); }
    })());
    return;
  }

  if (requestUrl.origin === self.location.origin) {
    event.respondWith(caches.open(VERSION).then(async (cache) => (await cache.match(event.request)) || fetch(event.request)));
    return;
  }

  if (requestUrl.hostname === 'cdn.jsdelivr.net' || requestUrl.hostname === 'storage.googleapis.com') {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => (await cache.match(event.request)) || fetch(event.request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(storeResponse(ASSET_CACHE, event.request, copy));
        }
        return response;
      })),
    );
  }
});
