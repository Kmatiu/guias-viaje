/* Service worker de las guías de viaje interactivas.
   Hace que la guía se abra sin cobertura: cachea el HTML, las fotos del
   repositorio y los tiles del mapa que se hayan visitado.
   Sube este archivo junto al index.html, en la misma carpeta.

   Es idéntico para todas las guías: se copia tal cual, sin tocar nada.

   ---------------------------------------------------------------------------
   Correcciones de esta versión, marcadas en el punto exacto donde estaban:
     1. addAll() es atómico: un solo 404 anulaba TODA la caché, en silencio.
     2. `caches.match(a) || caches.match(b)`: match() devuelve una promesa, y
        una promesa siempre es verdadera, así que la segunda nunca se evaluaba.
     3. respondWith() recibía undefined cuando no había ni red ni copia.
     4. El manejador de PRECACHE no llamaba a waitUntil: el navegador podía
        dormir el worker a mitad de la descarga.
     5. La precarga descartaba las respuestas opacas, justo las de los tiles.
     6. El borrado de cachés antiguas se llevaba por delante la de la portada,
        porque el almacén de cachés es común a todo el dominio.
   --------------------------------------------------------------------------- */

var CACHE = 'guia-v3';
/* Solo se borran las cachés de guías. El almacén de cachés es común a todo el
   dominio, no a esta carpeta, así que un `caches.keys()` devuelve también las
   de la portada de guías y las de cualquier otra web publicada en el mismo
   usuario de GitHub. Sin este prefijo, entrar en una guía dejaba la portada sin
   su caché y la portada dejaba de abrirse sin cobertura. [FIX 6] */
var PREFIJO = 'guia-';
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

/* Respuesta de cortesía para cuando no hay ni red ni copia guardada. Devolver
   undefined desde respondWith() provoca un error de red del navegador y llena
   la consola de avisos que tapan cualquier problema real. [FIX 3] */
function sinConexion(url) {
  var esNavegacion = /\.html?($|\?)/.test(url) || url.slice(-1) === '/';
  if (esNavegacion) {
    return new Response(
      '<!DOCTYPE html><meta charset="utf-8"><title>Sin conexión</title>' +
      '<body style="font-family:system-ui;display:grid;place-items:center;' +
      'height:100vh;margin:0;text-align:center;background:#111;color:#eee">' +
      '<div><h1>Sin conexión</h1><p>Esta parte de la guía no está descargada.</p></div>',
      { status: 504, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
  return new Response('', { status: 504, statusText: 'Sin conexión' });
}

/* addAll() descarga todo y solo guarda si TODAS las respuestas son correctas:
   con que un archivo dé 404, se rechaza y no queda nada guardado. Como además
   el fallo se silenciaba, la guía parecía preparada y luego no abría sin
   cobertura. Aquí se cachea archivo a archivo, tolerando fallos sueltos. [FIX 1] */
function addAllTolerante(cache, urls) {
  return Promise.all(urls.map(function (u) {
    return cache.add(new Request(u, { cache: 'reload' })).catch(function () {
      return null;   // este archivo no está; el resto sigue guardándose
    });
  }));
}

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return addAllTolerante(c, CORE); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          /* Solo las versiones antiguas de guías: lo demás no es asunto
             de este service worker. [FIX 6] */
          var esDeGuia = k.indexOf(PREFIJO) === 0;
          return (esDeGuia && k !== CACHE) ? caches.delete(k) : null;
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
  /* Las respuestas opacas (otro dominio sin CORS, como los tiles) no se pueden
     leer desde el código y su .ok es false, pero sí se pueden guardar y volver
     a servir. Por eso entran aquí igual que las normales. */
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
  if (url.indexOf('http') !== 0) return;   // salta chrome-extension:, data:, blob:

  /* Clima y tipos de cambio: red primero, y si no hay señal, el último dato conocido. */
  if (isLiveData(url)) {
    e.respondWith(
      fetch(req)
        .then(function (r) { return putInCache(req, r); })
        .catch(function () {
          return caches.match(req).then(function (m) {
            return m || sinConexion(url);   // [FIX 3]
          });
        })
    );
    return;
  }

  /* La página y el índice de documentos: red primero para recoger
     actualizaciones, caché si no hay cobertura. */
  if (req.mode === 'navigate' || isIndex(url)) {
    e.respondWith(
      fetch(req)
        .then(function (r) { return putInCache(req, r); })
        .catch(function () {
          return caches.match(req).then(function (m) {
            if (m) return m;

            if (isIndex(url)) {
              // Sin cobertura y sin copia: lista vacía en vez de romper
              return new Response('{"documentos":[]}',
                { headers: { 'Content-Type': 'application/json' } });
            }

            /* Antes: `return caches.match('./index.html') || caches.match('./')`.
               match() devuelve una promesa y una promesa siempre es verdadera,
               así que el `||` se quedaba con la primera y la segunda opción no
               llegaba a evaluarse. Si index.html no estaba guardado pero './'
               sí, esto resolvía a undefined y el navegador mostraba su pantalla
               de error en lugar de la portada de la guía. [FIX 2] */
            return caches.match('./index.html')
              .then(function (p) { return p || caches.match('./'); })
              .then(function (p) { return p || sinConexion(url); });
          });
        })
    );
    return;
  }

  /* Fotos, tiles del mapa y demás: caché primero, que es lo que da la sensación
     de instantáneo al abrir una guía ya preparada. */
  e.respondWith(
    caches.match(req).then(function (m) {
      if (m) return m;
      return fetch(req)
        .then(function (r) { return putInCache(req, r); })
        /* Aquí `m` ya se sabe que es undefined: si tuviera valor se habría
           devuelto arriba. Devolverlo dejaba a respondWith sin Response. [FIX 3] */
        .catch(function () { return sinConexion(url); });
    })
  );
});

/* La guía puede pedir que se precarguen archivos concretos: es lo que hace el
   botón «Preparar para usar sin conexión». */
self.addEventListener('message', function (e) {
  var data = e.data || {};

  if (data.type === 'PRECACHE' && Array.isArray(data.urls)) {
    var port = e.ports && e.ports[0];

    /* Sin waitUntil, el navegador da por terminado el trabajo en cuanto vuelve
       del manejador y puede dormir el worker a mitad de la descarga: la barra
       se queda parada, sin error, y faltan archivos. [FIX 4] */
    e.waitUntil(
      caches.open(CACHE).then(function (c) {
        var done = 0;
        var total = data.urls.length;
        var fallidas = [];

        return Promise.all(data.urls.map(function (u) {
          return fetch(new Request(u, { cache: 'reload' }))
            .then(function (r) {
              /* Antes solo se aceptaba r.ok, y una respuesta opaca tiene
                 ok === false: los tiles del mapa se descartaban justo en la
                 precarga, que es donde más falta hacía guardarlos. Además el
                 criterio era incoherente con putInCache, que sí los aceptaba,
                 de modo que un tile visto navegando se guardaba y el mismo tile
                 pedido por la precarga, no. [FIX 5] */
              if (r && (r.ok || r.type === 'opaque')) return c.put(u, r);
              fallidas.push(u);
            })
            .catch(function () { fallidas.push(u); })
            .then(function () {
              done++;
              if (port) port.postMessage({ done: done, total: total });
            });
        })).then(function () {
          /* `done: total` cierra la barra de progreso al 100 %. Y se informa de
             lo que no se pudo guardar, por si la interfaz quiere usarlo.
             Ojo al interpretarlo: la guía pide todas las extensiones posibles
             de cada foto, así que la mayoría de los fallos son normales y
             esperados, no un problema. */
          if (port) port.postMessage({
            finished: true,
            done: total,
            total: total,
            failed: fallidas.length,
            failedUrls: fallidas
          });
        });
      }).catch(function (err) {
        if (port) port.postMessage({ finished: true, error: String(err) });
      })
    );
    return;
  }

  /* Permite que la página pregunte cuánto hay ya descargado y muestre «ya
     preparado» sin volver a bajarlo todo. La interfaz actual no lo usa. */
  if (data.type === 'STATUS' && Array.isArray(data.urls)) {
    var portS = e.ports && e.ports[0];
    e.waitUntil(
      caches.open(CACHE).then(function (c) {
        var guardadas = 0;
        return Promise.all(data.urls.map(function (u) {
          return c.match(u).then(function (m) { if (m) guardadas++; });
        })).then(function () {
          if (portS) portS.postMessage({ cached: guardadas, total: data.urls.length });
        });
      })
    );
    return;
  }

  if (data.type === 'CLEAR') {
    var portC = e.ports && e.ports[0];
    e.waitUntil(
      caches.delete(CACHE).then(function () {
        if (portC) portC.postMessage({ cleared: true });
      })
    );
  }
});
