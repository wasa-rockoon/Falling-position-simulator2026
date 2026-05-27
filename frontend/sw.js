var CACHE_NAME = 'predictor-cache-v12';
var TILE_CACHE_NAME = 'predictor-tiles-v12';
var urlsToCache = [
    './',
    './index.html',
    './css/leaflet.css',
    './css/jquery-ui.css',
    './css/predictor.css',
    './css/predictor-mobile.css',
    './js/jquery-3.3.1.min.js',
    './js/jquery-ui.min.js',
    './js/leaflet.js',
    './js/moment.js',
    './js/pred/pred.js',
    './js/pred/pred-ui.js',
    './js/pred/pred-map.js',
    './js/pred/pred-new.js',
    './js/pred/pred-config.js',
    './js/pred/pred-common.js',
    './js/pred/log-overlay.js',
    './js/pred/landsea.js',
    './js/pred/mobile-ui.js',
    './js/pred/launch-window.js',
    './js/pred/ehime-enhancements.js',
    './data/land_japan_raw.geojson',
    './images/target-1-sm.png',
    './images/target-8-sm.png',
    './images/pop-marker.png',
    './images/drag_handle.png',
    './favicon.ico',
    './sites.json',
    './manifest.json',
    './js/chart.min.js',
    './js/html2canvas.min.js',
    './js/pred/pred-collaborate.js',
    './js/pred/pred-chart.js'
];

self.addEventListener('install', function (event) {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(function (cache) {
                console.log('Opened cache');
                return cache.addAll(urlsToCache);
            })
    );
    self.skipWaiting();
});

// 古いキャッシュを自動削除
self.addEventListener('activate', function (event) {
    event.waitUntil(
        caches.keys().then(function (cacheNames) {
            return Promise.all(
                cacheNames.filter(function (cacheName) {
                    return cacheName !== CACHE_NAME && cacheName !== TILE_CACHE_NAME;
                }).map(function (cacheName) {
                    console.log('Deleting old cache:', cacheName);
                    return caches.delete(cacheName);
                })
            );
        })
    );
    self.clients.claim();
});

self.addEventListener('fetch', function (event) {
    var requestUrl = new URL(event.request.url);

    // HTML はネットワーク優先にして、UI変更の取り込み遅延を防ぐ
    if (event.request.mode === 'navigate' || requestUrl.pathname.endsWith('.html')) {
        event.respondWith(
            fetch(event.request)
                .then(function (networkResponse) {
                    if (networkResponse && networkResponse.status === 200) {
                        var responseToCache = networkResponse.clone();
                        caches.open(CACHE_NAME).then(function (cache) {
                            cache.put(event.request, responseToCache);
                        });
                    }
                    return networkResponse;
                })
                .catch(function () {
                    return caches.match(event.request);
                })
        );
        return;
    }

    // Handle Tile Caching (OSM/Mapbox tiles)
    if (requestUrl.href.includes('tile.openstreetmap.org') || requestUrl.href.includes('mapbox.com')) {
        event.respondWith(
            caches.open(TILE_CACHE_NAME).then(function (cache) {
                return cache.match(event.request).then(function (response) {
                    var fetchPromise = fetch(event.request).then(function (networkResponse) {
                        cache.put(event.request, networkResponse.clone());
                        return networkResponse;
                    });
                    return response || fetchPromise;
                });
            })
        );
        return;
    }

    // Handle Default Caching (Stale-while-revalidate)
    event.respondWith(
        caches.match(event.request)
            .then(function (response) {
                if (response) {
                    return response;
                }
                return fetch(event.request).then(
                    function (response) {
                        if (!response || response.status !== 200 || response.type !== 'basic') {
                            return response;
                        }
                        var responseToCache = response.clone();
                        caches.open(CACHE_NAME)
                            .then(function (cache) {
                                cache.put(event.request, responseToCache);
                            });
                        return response;
                    }
                );
            })
    );
});
