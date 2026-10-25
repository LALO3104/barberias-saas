// sw.js — "Mi barbería" (app instalable del personal).
//
// Qué hace:
//   - Permite instalar la app y que abra rápido.
//   - Páginas: SIEMPRE de la red. Nunca se guardan, porque traen datos de
//     clientes (nombres, teléfonos, citas). Sin internet se muestra
//     /offline.html.
//   - Archivos de la app con hash en el nombre (/_next/static/…): se guardan
//     la primera vez y se reutilizan (no cambian nunca).
//   - Supabase, otros dominios, POST y peticiones de datos: no se tocan.

const VERSION = "mi-barberia-v1";
const STATIC_CACHE = `${VERSION}-static`;
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/pwa/icon/192", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))
      )
      .catch(() => {})
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navegación (abrir una pantalla): red; sin conexión, página offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match(OFFLINE_URL).then((r) => r || Response.error())
      )
    );
    return;
  }

  // Archivos versionados de Next: caché primero.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((resp) => {
            if (resp.ok) {
              const copy = resp.clone();
              caches.open(STATIC_CACHE).then((c) => c.put(req, copy)).catch(() => {});
            }
            return resp;
          })
      )
    );
  }
  // Todo lo demás (datos RSC, rutas de la API, imágenes de Supabase): red normal.
});
