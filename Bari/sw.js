/* Service worker de las guías de viaje interactivas.
   Hace que la guía se abra sin cobertura: cachea el HTML, las fotos del
   repositorio y los tiles del mapa que se hayan visitado.
   Sube este archivo junto al index.html, en la misma carpeta. */

var CACHE = 'guia-v2';
var CORE = ['./', './index.html'];
var TILE_LIMIT = 700;

function isLiveData(url) {
  return /open-meteo\.com|er-api\.com|exchangerate/.test(url);
}
/* Índices que el autor actualiza: deben pedirse siempre a la red primero.
   Con caché primero, subir documentos nuevos al repositorio no servía de nada:
   el navegador seguía mostrando el index.json que ya tenía guardado. */
function isIndex(url) {
  return /\/documentos\/index\.json(\?|$)/.test(url);
}
function isTile(url) {
  return /tile\.openstreetmap\.org|tile\.opentopomap\.org|basemaps\.cartocdn\.com/.test(url);
}

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(CORE); })
      .catch(function () {})
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          return k === CACHE ? null : caches.delete(k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

/* Evita que la caché crezca sin límite con los tiles del mapa. */
function trimTiles() {
  return caches.open(CACHE).then(function (c) {
    return c.keys().then(function (keys) {
      var tiles = keys.filter(function (r) { return isTile(r.url); });
      if (tiles.length <= TILE_LIMIT) return;
      return Promise.all(tiles.slice(0, tiles.length - TILE_LIMIT).map(function (r) {
        return c.delete(r);
      }));
    });
  });
}

function putInCache(req, res) {
  if (!res) return res;
  if (!(res.ok || res.type === 'opaque')) return res;
  var copy = res.clone();
  caches.open(CACHE).then(function (c) {
    c.put(req, copy);
    if (isTile(req.url) && Math.random() < 0.05) trimTiles();
  }).catch(function () {});
  return res;
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = req.url;
  if (url.indexOf('chrome-extension') === 0) return;

  /* Clima y tipos de cambio: red primero, y si no hay señal se muestra el último dato conocido. */
  if (isLiveData(url)) {
    e.respondWith(
      fetch(req).then(function (r) { return putInCache(req, r); })
                .catch(function () { return caches.match(req); })
    );
    return;
  }

  /* La página y el índice de documentos: red primero para recoger
     actualizaciones, caché si no hay cobertura. */
  if (req.mode === 'navigate' || isIndex(url)) {
    e.respondWith(
      fetch(req).then(function (r) { return putInCache(req, r); })
                .catch(function () {
                  return caches.match(req).then(function (m) {
                    if (m) return m;
                    if (isIndex(url)) {
                      // Sin cobertura y sin copia: lista vacía en vez de romper
                      return new Response('{"documentos":[]}',
                        { headers: { 'Content-Type': 'application/json' } });
                    }
                    return caches.match('./index.html') || caches.match('./');
                  });
                })
    );
    return;
  }

  /* Fotos, tiles del mapa y demás: caché primero, que es lo que da la sensación de instantáneo. */
  e.respondWith(
    caches.match(req).then(function (m) {
      if (m) return m;
      return fetch(req).then(function (r) { return putInCache(req, r); })
                       .catch(function () { return m; });
    })
  );
});

/* La guía puede pedir que se precarguen archivos concretos (botón "Preparar sin conexión"). */
self.addEventListener('message', function (e) {
  var data = e.data || {};
  if (data.type !== 'PRECACHE' || !Array.isArray(data.urls)) return;
  var port = e.ports && e.ports[0];
  caches.open(CACHE).then(function (c) {
    var done = 0, total = data.urls.length;
    return Promise.all(data.urls.map(function (u) {
      return fetch(u, { cache: 'reload' })
        .then(function (r) { if (r && r.ok) return c.put(u, r); })
        .catch(function () {})
        .then(function () {
          done++;
          if (port) port.postMessage({ done: done, total: total });
        });
    }));
  }).then(function () {
    if (port) port.postMessage({ finished: true });
  });
});
