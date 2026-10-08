// Registro Producción 3.0 · Cervantes (botonera de GP2) — service worker.
// Patrón de Virgilio/Cervantes: NO cachea estáticos (el navegador siempre trae HTML/JS frescos) y no envía nada en segundo plano:
// los toques se mandan desde la página con el pase firmado (reg_prod_3_0_registrar_evento), que no se puede usar desde acá.
const SW_VERSION = "v3.1.8";

self.addEventListener("install", () => { self.skipWaiting(); });

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    try {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
    } catch {}
    await self.clients.claim();
    try {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clients) {
        try { client.postMessage({ type: "SW_UPDATED", version: SW_VERSION }); } catch {}
      }
    } catch {}
  })());
});

// Handler vacío: algunos navegadores lo piden para considerar completo al SW.
self.addEventListener("fetch", () => {});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});
