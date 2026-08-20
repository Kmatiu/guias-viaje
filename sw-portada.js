/* ────────────────────────────────────────────────────────────────
   Service worker de la portada de guías.

   Su único trabajo es que esta página se abra sin cobertura, para
   poder llegar desde ella a las guías que ya estén guardadas.

   No toca lo que hay dentro de las carpetas de cada guía: cada una
   tiene su propio service worker, y en una misma web manda siempre
   el más específico. Es decir, dentro de /Milán/ decide el sw.js de
   Milán, y aquí fuera decide este.

   Si algún día cambias el diseño de la portada y no ves los cambios,
   sube el número de VERSION: eso obliga a rehacer la caché.
   ──────────────────────────────────────────────────────────────── */

const VERSION = 'portada-v1';
const ESENCIALES = ['./', './index.html'];

// Al instalarse, guarda la portada y toma el relevo sin esperar.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(ESENCIALES))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

// Al activarse, borra las versiones antiguas de la portada.
// Solo las suyas: las cachés de las guías llevan otro nombre y no se tocan.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(
        claves
          .filter((k) => k.startsWith('portada-') && k !== VERSION)
          .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Las carpetas de las guías las gestiona el service worker de cada guía.
  // Este solo se ocupa de la portada, que es lo que cuelga de la raíz.
  const raiz = new URL('./', self.location).pathname;
  const resto = url.pathname.slice(raiz.length);
  const esPortada = resto === '' || resto === 'index.html';
  if (!esPortada) return;

  // Primero la red, para que los cambios se vean enseguida; si no hay
  // cobertura, la copia guardada. Es lo que hace que funcione el atajo
  // de la pantalla de inicio con el avión activado.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copia = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copia)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })
        .then((guardada) => guardada || caches.match('./index.html')))
  );
});
