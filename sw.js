// @ts-check
/// <reference lib="webworker" />
/**
 * Offline cache for the kiosk when it is served over https: every file in the build is cached at
 * install, and the kiosk keeps running with no network (a backpack screen is usually offline).
 * Baseline: Chromium 83 (Android 11's original System WebView).
 * Video Range requests are answered from the cached file, which media players need for seeking.
 */
const worker = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self));
importScripts('kiosk-data.js');
const kiosk = /** @type {{build:string,files:string[]}} */ (/** @type {any} */ (self).PACKOS_KIOSK);
const CACHE = 'packos-kiosk-' + kiosk.build;

// A new build fetches every file fresh (never from the HTTP cache) and then WAITS: the old build keeps serving
// (and keeps its cache) until the page, back on its attract loop, asks this worker to take over.
// The very first install has nothing to replace, so it takes over at once.
worker.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE)
    .then((cache) => cache.addAll(kiosk.files.map((file) => new Request(file, { cache: 'reload' }))))
    .then(() => { if (!worker.registration.active) return worker.skipWaiting(); }));
});

worker.addEventListener('message', (event) => {
  if (event.data === 'activate') worker.skipWaiting();
});

worker.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key.startsWith('packos-kiosk-') && key !== CACHE).map((key) => caches.delete(key))))
    .then(() => worker.clients.claim()));
});

/**
 * Answers a media Range request from the cached file. A Blob slice is lazy, so a 15 MB film is never
 * copied into memory per request (the device has 4 GB).
 * @param {Request} request @param {Response} response
 */
async function ranged(request, response) {
  const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get('range') || '');
  if (!match) return response;
  const body = await response.blob();
  const start = Number(match[1]);
  const end = Math.min(match[2] ? Number(match[2]) : body.size - 1, body.size - 1);
  if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${body.size}` } });
  return new Response(body.slice(start, end + 1), {
    status: 206,
    headers: { 'Content-Type': response.headers.get('Content-Type') || 'video/mp4', 'Content-Range': `bytes ${start}-${end}/${body.size}`,
      'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes' },
  });
}

worker.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== worker.location.origin) return;
  event.respondWith(caches.open(CACHE).then(async (cache) => {
    const hit = await cache.match(request, { ignoreSearch: true })
      // Opening the kiosk folder itself (…/kiosk/) offline: serve the cached page.
      || (request.mode === 'navigate' && new URL(request.url).pathname.endsWith('/') ? await cache.match('index.html') : undefined);
    if (hit) return ranged(request, hit);
    return fetch(request);
  }));
});
