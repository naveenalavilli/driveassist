'use strict';

const VERSION = 'driveassist-v7';
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
    await cache.addAll(APP_SHELL);
    await Promise.allSettled(OFFLINE_AI_ASSETS.map((asset) => cache.add(asset)));
  }));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('driveassist-') && key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(async () => (await caches.match(event.request)) || caches.match('./offline.html')),
    );
    return;
  }

  if (requestUrl.origin === self.location.origin) {
    event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
    return;
  }

  if (requestUrl.hostname === 'cdn.jsdelivr.net' || requestUrl.hostname === 'storage.googleapis.com') {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(VERSION).then((cache) => cache.put(event.request, copy)));
        }
        return response;
      })),
    );
  }
});
