/* =========================================================
   sw.js — Service Worker de GP2.

   Su unico proposito es que la app sea instalable como PWA (ventana propia,
   sin barra de direcciones). NO cachea nada, a proposito:

   - Los datos salen de Supabase en vivo.
   - Cachear el HTML dejaria tablets pegadas a una version vieja del codigo,
     que es justo lo que el sistema de tokens ?v=... viene evitando.
   - server-local.ps1 ya responde todo con
     Cache-Control: no-cache, no-store, must-revalidate.

   Mismo criterio que el SW de Produccion Virgilio.
   ========================================================= */

const SW_VERSION = "gp2-v2";

self.addEventListener("install", () => {
  // La version nueva toma control de inmediato, sin quedar en waiting.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Si alguna version futura llegara a cachear, al activar se limpia todo:
    // asi ningun equipo queda pegado a HTML viejo.
    try {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
    } catch (e) { /* no-op */ }
    await self.clients.claim();
  })());
});

/* Navegaciones (abrir una pantalla) SIEMPRE de la red, sin pasar por el cache
   HTTP del navegador: 'reload' fuerza ir a la red ignorando la copia cacheada.
   Sin esto, el HTML (que se navega directo, sin ?v= propio) se queda pegado a una
   version vieja aunque el codigo ya este actualizado -- justo lo que este SW dice
   evitar. Los demas requests (Supabase, CDN, assets con ?v=) NO se interceptan:
   van derecho a la red y su frescura la maneja el token ?v=. Fallback a fetch
   normal si la red con 'reload' falla, para no romper la navegacion. */
self.addEventListener("fetch", (event) => {
  var req = event.request;
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req, { cache: "reload" }).catch(function () { return fetch(req); })
    );
  }
});
