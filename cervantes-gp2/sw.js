// Registro Producción 3.0 · Cervantes (botonera de GP2) — service worker.
// Patrón de Virgilio/Cervantes: NO cachea estáticos (el navegador siempre trae HTML/JS frescos).
// ENVÍO EN SEGUNDO PLANO, como Registro Producción 2.0 (v3.1.10, Elías 08/10: «16: como en 2.0»): la app copia la cola al IndexedDB
// «rp3c-envio» ya lista para mandar (el cuerpo de cada toque, el pase y el equipo) y pide un «sync»; cuando vuelve la señal, aunque la
// app esté cerrada, este service worker la manda a reg_prod_3_0_registrar_evento con ese pase. Lo enviado queda anotado en «enviados»
// y la app, al volver, lo da por enviado. La base no duplica (id del toque): si la app y el service worker mandan lo mismo, no pasa nada.
const SW_VERSION = "v3.1.12";

const SUPABASE_URL = "https://hrxfctzncixxqmpfhskv.supabase.co";
const SUPABASE_KEY = "sb_publishable_BqpAgZH6ty-9wft10_YMhw_0rcIPuWT";
const IDB_ENVIO = "rp3c-envio";

function idbAbrir() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_ENVIO, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      ["cola", "enviados"].forEach((n) => { if (!db.objectStoreNames.contains(n)) db.createObjectStore(n, { keyPath: "id" }); });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "k" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function idbTx(db, stores, modo, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, modo);
    const r = fn(tx);
    tx.oncomplete = () => resolve(r ? r.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function enviarCola() {
  const db = await idbAbrir();
  const meta = await idbTx(db, ["meta"], "readonly", (tx) => tx.objectStore("meta").get("envio"));
  if (!meta || !meta.pase) return;                                       // sin pase: lo manda la app cuando se ingrese el código
  if (meta.vence && Date.parse(meta.vence) <= Date.now()) return;        // pase vencido: ídem
  const cola = (await idbTx(db, ["cola"], "readonly", (tx) => tx.objectStore("cola").getAll())) || [];
  let sinSenal = false, enviados = 0;
  for (const it of cola) {
    let r;
    try {
      r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/reg_prod_3_0_registrar_evento`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY,
                   "Content-Profile": "reg_prod_3_0" },
        body: JSON.stringify({ p: it.cuerpo, p_pase: meta.pase, p_dispositivo: meta.dispositivo })
      });
    } catch { sinSenal = true; break; }
    let j = null;
    try { j = await r.json(); } catch { /* sin cuerpo */ }
    if (r.ok) {
      await idbTx(db, ["cola", "enviados"], "readwrite", (tx) => {
        tx.objectStore("cola").delete(it.id);
        tx.objectStore("enviados").put({ id: it.id, legajo: it.legajo, matriz: it.matriz || "", cajon: (j && j.cajon) || null,
                                         at: new Date().toISOString() });
      });
      enviados++;
      continue;
    }
    if (r.status >= 500 || (j && String(j.code) === "28000")) { sinSenal = r.status >= 500; break; }   // base caída o pase vencido
    // rechazo por los datos (4xx): lo resuelve la app al abrir (lo marca con error); se sigue con el resto
  }
  if (enviados) {
    const clientes = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    clientes.forEach((c) => { try { c.postMessage({ type: "SW_ENVIADOS", n: enviados }); } catch { /* cerrada */ } });
  }
  if (sinSenal) throw new Error("sin señal: el navegador vuelve a intentar");
}

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

self.addEventListener("sync", (event) => {
  if (event.tag === "rp3c-enviar") event.waitUntil(enviarCola());
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});
