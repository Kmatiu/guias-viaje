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

   ────────────────────────────────────────────────────────────────
   Correcciones de esta versión:
     1. addAll() es atómico: si uno de los archivos daba 404, no se
        guardaba ninguno, y encima el fallo se silenciaba.
     3. respondWith() podía recibir undefined cuando no había ni red
        ni copia guardada, y el navegador mostraba su pantalla de
        error en lugar de algo entendible.
   Van numeradas igual que en el sw.js de las guías para que sea fácil
   compararlos. Los otros cuatro fallos de aquel no se dan aquí: esta
   portada no precarga nada y su borrado de cachés antiguas ya estaba
   acotado a las suyas desde el principio.
   ──────────────────────────────────────────────────────────────── */

const VERSION = 'portada-v2';
const PREFIJO = 'portada-';
const ESENCIALES = ['./', './index.html'];

/* addAll() descarga todo y solo guarda si TODAS las respuestas son correctas.
   Con que uno de los dos archivos falte, se rechaza la promesa y la caché
   queda vacía: la portada parecería preparada y luego no abriría sin
   cobertura. Aquí se guarda archivo a archivo, tolerando fallos sueltos. [FIX 1] */
function addAllTolerante(cache, urls) {
  return Promise.all(urls.map((u) =>
    cache.add(new Request(u, { cache: 'reload' })).catch(() => null)
  ));
}

/* Devolver undefined desde respondWith() provoca un error de red del navegador.
   Mejor una página explicativa, que además dice qué hacer. [FIX 3] */
function sinConexion() {
  return new Response(
    '<!DOCTYPE html><meta charset="utf-8"><title>Sin conexión</title>' +
    '<body style="font-family:Georgia,serif;display:grid;place-items:center;' +
    'height:100vh;margin:0;text-align:center;background:#FAF4E8;color:#1A1A1A">' +
    '<div style="max-width:22rem;padding:1rem">' +
    '<h1 style="font-size:1.5rem;margin:0 0 .5rem">Sin conexión</h1>' +
    '<p style="color:#6B6B6B;line-height:1.5">Esta página todavía no está guardada ' +
    'en el móvil. Ábrela una vez con wifi y volverá a funcionar sin cobertura.</p>' +
    '</div>',
    { status: 504, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

// Al instalarse, guarda la portada y toma el relevo sin esperar.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => addAllTolerante(cache, ESENCIALES))
      .then(() => self.skipWaiting())
  );
});

/* Al activarse, borra las versiones antiguas de la portada.
   Solo las suyas: el almacén de cachés es común a todo el dominio, así que un
   borrado sin filtrar se llevaría por delante las cachés de las guías. */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(
        claves
          .filter((k) => k.startsWith(PREFIJO) && k !== VERSION)
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
      .catch(() =>
        caches.match(req, { ignoreSearch: true })
          .then((guardada) => guardada || caches.match('./index.html'))
          .then((guardada) => guardada || caches.match('./'))
          /* Si no aparece ninguna de las tres, se responde con algo válido en
             lugar de dejar a respondWith sin Response. [FIX 3] */
          .then((guardada) => guardada || sinConexion())
      )
  );
});
