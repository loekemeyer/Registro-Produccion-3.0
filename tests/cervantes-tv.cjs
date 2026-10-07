/* Cervantes — ingreso con el CÓDIGO DE LA TV en el primer mensaje del día (v3.0.4).
   Supabase y el reloj están simulados; internet se corta de verdad con context.setOffline.

   A) código mal y después bien        → vuelve a pedirlo; con el bueno queda el pase y el mensaje se envía; la llamada a la
                                         base lleva legajo, id del equipo, huella, navegador y modelo; el id queda guardado
   B) 2º mensaje del día               → no vuelve a pedir el código
   C) vigencia del pase                → a las 17:44 sigue valiendo; a las 17:50 vuelve a pedir el código
   D) la verificación NO depende de la LT: a las 08:00 (sin LT) también pide el código
   E) cancelar la pantalla             → no se envía nada, no queda pase
   F) sin internet                     → el mensaje se acepta pero queda RETENIDO: ni envío, ni IndexedDB (el service worker
                                         no lo ve); aviso visible; una recarga NO lo da por enviado (reconcile)
   G) vuelve internet                  → NO valida solo (el código vence): el aviso ofrece «Ingresar código»; con el código
                                         queda el pase, se libera y se envía todo
   H) legajo no habilitado / bloqueo   → mensaje propio, no se envía
   I) función caída (5xx)              → no culpa al operario: el mensaje queda retenido
   J) 6 códigos malos seguidos         → corta con mensaje, no se envía
   Sale 1 si falla. */
const path = require("path");
let chromium;
try { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }
catch (_e) { try { ({ chromium } = require("playwright")); } catch (_e2) { console.error("Playwright no encontrado."); process.exit(2); } }
const { servir } = require("./_servidor.cjs");

const CLAVE_BUENA = "4821";

const LEGAJO = "999";
const Q_KEY = "prod_queue_Cervantes_v2_supa";
const PASE_KEY = "prod_pase_Cervantes::" + LEGAJO;
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info, prefer, accept-profile, content-profile, x-supabase-api-version, accept",
  "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
};
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
// 06/10/2026 a la hora indicada de Buenos Aires (UTC-3)
const ba = (hhmm) => new Date(`2026-10-06T${hhmm}:00-03:00`).getTime();

(async () => {
  const srv = await servir();
  const b = await chromium.launch();
  const errs = [];
  const resultados = [];
  const traza = (m) => { if (process.env.TRAZA) console.log("   · " + m); };
  const chequeo = (nombre, ok) => { resultados.push([nombre, !!ok]); if (!ok) console.log("  ✗ " + nombre); };

  // Contexto nuevo por escenario: localStorage/IndexedDB limpios, reloj propio y Supabase simulado.
  async function escenario(hhmm, modoInicial) {
    const ctx = await b.newContext({ serviceWorkers: "block" });
    ctx.setDefaultTimeout(7000);
    const est = { modo: modoInicial, login: 0, emp: 0, posts: 0, llamadas: [] };
    await ctx.addInitScript((desfase) => {
      const RealDate = Date;
      window.__desfase = desfase;
      class FakeDate extends RealDate {
        constructor(...a) { if (a.length === 0) super(RealDate.now() + window.__desfase); else super(...a); }
        static now() { return RealDate.now() + window.__desfase; }
      }
      window.Date = FakeDate;
    }, ba(hhmm) - Date.now());
    await ctx.route("**/*.supabase.co/**", async (route) => {
      const req = route.request(); const url = req.url(); const m = req.method();
      const json = (status, body) => route.fulfill({ status, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify(body) });
      if (m === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
      if (url.includes("/rest/v1/rpc/reg_prod_3_0_cerv_ingresar")) {
        est.login++;
        let body = {}; try { body = req.postDataJSON() || {}; } catch (_e) { /* sin cuerpo */ }
        est.llamadas.push(body);
        if (est.modo === "caido") return json(500, { message: "boom" });
        if (est.modo === "legajo") return json(200, { ok: false, error: "legajo" });
        if (est.modo === "bloqueo") return json(200, { ok: false, error: "bloqueo" });
        if (est.modo === "sin_funcion") return json(404, { code: "PGRST202", message: "no existe" });
        return body.p_clave === CLAVE_BUENA ? json(200, { ok: true, nombre: "Prueba TV" }) : json(200, { ok: false, error: "codigo" });
      }
      if (m === "GET") {
        if (url.includes("/rest/v1/Empleados")) { est.emp++; return json(200, [{ Legajo: LEGAJO, Empleado: "Prueba TV", Activo: "SI", hora_entrada: "08:30:00" }]); }
        return json(200, []);
      }
      if (url.includes("Registros%20Produccion%20Cervantes")) est.posts++;
      return json(201, []);
    });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errs.push(e.message));
    p.on("dialog", (d) => d.dismiss().catch(() => {}));
    return { ctx, p, est };
  }

  async function abrir({ p, est }) {
    traza("abrir /cervantes/");
    await p.goto(srv.url + "/cervantes/", { waitUntil: "domcontentloaded" });
    await p.waitForSelector("#legajoScreen", { state: "visible" });
    for (let i = 0; i < 50 && est.emp === 0; i++) await pausa(100);
    await pausa(300);   // que cargarCatalogos() termine de llenar empleadosMap
  }
  async function entrarYElegir({ p }) {
    traza("legajo + continuar");
    await p.fill("#legajoInput", LEGAJO);
    await p.click("#btnContinuar");
    await p.waitForSelector("#optionsScreen:not(.hidden)", { timeout: 8000 });
  }
  async function enviarPB({ p }) {
    traza("elegir PB + enviar");
    await p.click('.box[data-code="PB"]');
    await p.click("#btnEnviar");
  }
  const modalTv = (p) => p.waitForSelector("#tvClaveModal", { state: "visible", timeout: 6000 }).then(() => true).catch(() => false);
  async function tipearClave({ p }, clave) {
    await p.fill("#tvClaveInput", clave);
    await p.click("#tvClaveOk");
  }
  // Tras enviar, Cervantes vuelve a la pantalla del legajo: para el siguiente mensaje se entra de nuevo.
  async function otroMensaje(s) {
    await s.p.waitForSelector("#legajoScreen", { state: "visible", timeout: 8000 });
    await entrarYElegir(s);
    await enviarPB(s);
  }
  // Pone el reloj simulado del navegador en la hora de Buenos Aires indicada (usa el reloj REAL: performance.timeOrigin).
  const fijarHora = (p, hhmm) => p.evaluate((T) => { window.__desfase = T - (performance.timeOrigin + performance.now()); }, ba(hhmm));
  const leer = (p, k) => p.evaluate((key) => localStorage.getItem(key), k);
  const cola = async (p) => JSON.parse((await leer(p, Q_KEY)) || "[]");
  const idbCuenta = (p) => p.evaluate(async () => {
    const dbs = await indexedDB.databases();
    if (!dbs.some((d) => d.name === "registro-prod")) return 0;
    return new Promise((res) => {
      const r = indexedDB.open("registro-prod");
      r.onsuccess = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains("queue")) return res(0);
        const q = db.transaction("queue").objectStore("queue").getAll();
        q.onsuccess = () => res(q.result.length); q.onerror = () => res(-1);
      };
      r.onerror = () => res(-1);
    });
  });
  const esperar = async (cond, ms = 10000) => { for (let t = 0; t < ms; t += 150) { if (await cond()) return true; await pausa(150); } return false; };

  // ---------- A) código mal y después bien ----------
  { const s = await escenario("12:30", "ok"); await abrir(s); await entrarYElegir(s); await enviarPB(s);
    chequeo("A al primer mensaje del día aparece la pantalla del código de la TV", await modalTv(s.p));
    chequeo("A todavía no se envía nada", s.est.posts === 0);
    await tipearClave(s, "0000");
    chequeo("A con el código malo vuelve a pedirlo y lo dice", (await modalTv(s.p)) && /incorrecto o vencido/.test(await s.p.textContent("#tvClaveError")));
    chequeo("A sigue sin enviarse ni dejar pase", s.est.posts === 0 && (await leer(s.p, PASE_KEY)) === null);
    await tipearClave(s, CLAVE_BUENA);
    const llego = await esperar(async () => s.est.posts > 0);
    const pase = JSON.parse((await leer(s.p, PASE_KEY)) || "null");
    chequeo("A con el código bueno queda el pase del día", pase && pase.day === "2026-10-06" && pase.legajo === LEGAJO && pase.nombre === "Prueba TV");
    chequeo("A el mensaje se envía", llego);
    chequeo("A la pantalla del código se cierra", (await s.p.locator("#tvClaveModal").count()) === 0);
    const ll = s.est.llamadas[s.est.llamadas.length - 1] || {};
    chequeo("A la llamada lleva app y legajo", ll.p_app === "cervantes" && ll.p_legajo === LEGAJO && ll.p_clave === CLAVE_BUENA);
    chequeo("A la llamada lleva el id del equipo, la huella y el navegador", !!ll.p_dispositivo && !!ll.p_huella && /Mozilla|Chrome/.test(ll.p_navegador || ""));
    chequeo("A la llamada lleva pantalla, zona e idioma", !!(ll.p_extra && ll.p_extra.pantalla && "zona" in ll.p_extra && "idioma" in ll.p_extra));
    const idGuardado = await leer(s.p, "gv_dispositivo");
    chequeo("A el id del equipo queda guardado y es el que se mandó", !!idGuardado && idGuardado === ll.p_dispositivo);
    chequeo("A los 2 intentos mandaron el mismo id y la misma huella", s.est.llamadas.length === 2 && s.est.llamadas[0].p_dispositivo === ll.p_dispositivo && s.est.llamadas[0].p_huella === ll.p_huella);
    chequeo("A el pase no guarda el código", !(await leer(s.p, PASE_KEY) || "").includes(CLAVE_BUENA));

    // ---------- B) 2º mensaje ----------
    await esperar(async () => (await cola(s.p)).length === 0);
    const antes = s.est.login, postsAntes = s.est.posts;
    await otroMensaje(s);
    await esperar(async () => s.est.posts > postsAntes);
    chequeo("B el 2º mensaje del día se envía sin volver a pedir el código", s.est.login === antes && s.est.posts > postsAntes && (await s.p.locator("#tvClaveModal").count()) === 0);
    await s.ctx.close(); }

  // ---------- C) vigencia del pase: 17:44 sigue valiendo, 17:50 vuelve a pedir ----------
  for (const [hhmm, debePedir] of [["17:44", false], ["17:50", true]]) {
    const s = await escenario("09:30", "ok"); await abrir(s); await entrarYElegir(s); await enviarPB(s);
    await modalTv(s.p); await tipearClave(s, CLAVE_BUENA);
    await esperar(async () => s.est.posts > 0);
    await esperar(async () => (await cola(s.p)).length === 0);
    await fijarHora(s.p, hhmm);
    await otroMensaje(s);
    const pidio = await modalTv(s.p);
    traza(`C ${hhmm}: pidió=${pidio}`);
    chequeo(`C a las ${hhmm} ${debePedir ? "vuelve a pedir el código" : "el pase sigue valiendo"}`, pidio === debePedir);
    await s.ctx.close();
  }

  // ---------- D) antes de las 08:30 (no hay LT) también pide el código ----------
  { const s = await escenario("08:00", "ok"); await abrir(s); await entrarYElegir(s); await enviarPB(s);
    chequeo("D a las 08:00 (sin LT) también pide el código", await modalTv(s.p));
    chequeo("D y no se envía hasta tenerlo", s.est.posts === 0 && (await cola(s.p)).length === 0);
    await s.ctx.close(); }

  // ---------- E) cancelar ----------
  { const s = await escenario("12:30", "ok"); await abrir(s); await entrarYElegir(s); await enviarPB(s);
    await modalTv(s.p); await s.p.click("#tvClaveNo");
    await pausa(600);
    chequeo("E cancelar: no se envía nada ni queda en la cola", s.est.posts === 0 && (await cola(s.p)).length === 0);
    chequeo("E cancelar: no queda pase ni se llamó a la base", (await leer(s.p, PASE_KEY)) === null && s.est.login === 0);
    chequeo("E cancelar: avisa que hay que ingresar el código", /código de la TV/.test(await s.p.textContent("#error")));
    chequeo("E cancelar: el botón Enviar vuelve a estar habilitado", await s.p.isEnabled("#btnEnviar"));
    await s.ctx.close(); }

  // ---------- F) sin internet → retenido ----------
  { const s = await escenario("12:30", "ok"); await abrir(s); await entrarYElegir(s);
    await s.ctx.setOffline(true);
    await enviarPB(s);
    const q1 = await esperar(async () => (await cola(s.p)).length >= 1, 6000);
    await pausa(500);
    const q = await cola(s.p);
    chequeo("F el mensaje se acepta y queda en la cola", q1 && q.length >= 1);
    chequeo("F queda RETENIDO (__retDia)", q.length >= 1 && q.every((x) => x.__retDia === "2026-10-06"));
    chequeo("F no pasa al IndexedDB (el service worker no lo ve)", (await idbCuenta(s.p)) === 0);
    chequeo("F sin internet no se pide el código ni se llama a la base", s.est.posts === 0 && s.est.login === 0 && (await s.p.locator("#tvClaveModal").count()) === 0);
    chequeo("F aviso visible arriba, sin botón mientras no hay internet", (await s.p.isVisible("#redAviso")) && !(await s.p.isVisible("#redAvisoBtn")));
    chequeo("F el indicador muestra 📺", /📺/.test(await s.p.textContent("#syncBadge")));
    const nRetenidos = q.length;

    // vuelve internet y se recarga: lo retenido NO se da por enviado
    await s.ctx.setOffline(false);
    await s.p.reload({ waitUntil: "domcontentloaded" });
    await s.p.waitForSelector("#legajoScreen", { state: "visible" });
    await pausa(1200);
    chequeo("F tras recargar, lo retenido sigue en la cola (reconcile no lo borra)", (await cola(s.p)).length === nRetenidos);
    chequeo("F tras recargar, el aviso sigue", await s.p.isVisible("#redAviso"));

    // ---------- G) hay internet otra vez ----------
    await s.p.evaluate(() => window.dispatchEvent(new Event("online")));
    await pausa(1500);
    chequeo("G al volver internet NO valida solo (el código vence en 2 minutos)", s.est.login === 0 && s.est.posts === 0);
    chequeo("G el aviso ofrece «Ingresar código»", await s.p.isVisible("#redAvisoBtn"));
    chequeo("G sigue retenido", (await cola(s.p)).length === nRetenidos);
    await s.p.click("#redAvisoBtn");
    chequeo("G el botón abre la pantalla del código", await modalTv(s.p));
    await tipearClave(s, CLAVE_BUENA);
    const libero = await esperar(async () => s.est.posts >= 1, 12000);
    await esperar(async () => (await cola(s.p)).length === 0, 12000);
    chequeo("G queda el pase", !!(await leer(s.p, PASE_KEY)));
    chequeo("G lo retenido se libera y se envía", libero && (await cola(s.p)).length === 0);
    chequeo("G el aviso desaparece", !(await s.p.locator("#redAviso").count()));
    await s.ctx.close(); }

  // ---------- H) legajo no habilitado / bloqueo por intentos ----------
  for (const [modo, rx, nombre] of [["legajo", /no está habilitado/, "legajo no habilitado"], ["bloqueo", /Demasiados intentos/, "demasiados intentos"]]) {
    const s = await escenario("12:30", modo); await abrir(s); await entrarYElegir(s); await enviarPB(s);
    await modalTv(s.p); await tipearClave(s, CLAVE_BUENA);
    await esperar(async () => s.est.login > 0); await pausa(600);
    chequeo(`H ${nombre}: avisa con su mensaje`, rx.test(await s.p.textContent("#error")));
    chequeo(`H ${nombre}: no se envía nada ni queda pase`, s.est.posts === 0 && (await cola(s.p)).length === 0 && (await leer(s.p, PASE_KEY)) === null);
    await s.ctx.close();
  }

  // ---------- I) función caída o sin crear: no se culpa al operario ----------
  for (const modo of ["caido", "sin_funcion"]) {
    const s = await escenario("12:30", modo); await abrir(s); await entrarYElegir(s); await enviarPB(s);
    await modalTv(s.p); await tipearClave(s, CLAVE_BUENA);
    const q1 = await esperar(async () => (await cola(s.p)).length >= 1, 6000);
    await pausa(400);
    const q = await cola(s.p);
    chequeo(`I ${modo}: el mensaje queda retenido, no rechazado`, q1 && q.every((x) => x.__retDia) && s.est.posts === 0 && (await leer(s.p, PASE_KEY)) === null);
    chequeo(`I ${modo}: el aviso de arriba ofrece «Ingresar código» para cuando ande`, (await s.p.isVisible("#redAvisoBtn")) && /código de la TV/.test(await s.p.textContent("#redAviso")));
    await s.ctx.close();
  }

  // ---------- J) 6 códigos malos seguidos ----------
  { const s = await escenario("12:30", "ok"); await abrir(s); await entrarYElegir(s); await enviarPB(s);
    for (let i = 0; i < 6; i++) { await modalTv(s.p); await tipearClave(s, "1111"); await pausa(150); }
    await esperar(async () => /no coincide/.test((await s.p.textContent("#error")) || ""), 4000);
    chequeo("J con 6 códigos malos corta y avisa", /no coincide/.test(await s.p.textContent("#error")) && (await s.p.locator("#tvClaveModal").count()) === 0);
    chequeo("J no se envía nada ni queda pase", s.est.posts === 0 && (await leer(s.p, PASE_KEY)) === null && s.est.login === 6);
    await s.ctx.close(); }

  const fallas = resultados.filter(([, ok]) => !ok);
  console.log(`cervantes-tv: ${resultados.length - fallas.length}/${resultados.length} chequeos OK · pageerrors: ${errs.length ? errs.join(" | ") : "none"} · ${fallas.length === 0 && errs.length === 0 ? "✓ OK" : "✗ FAIL"}`);
  await b.close(); await srv.cerrar();
  process.exit(fallas.length === 0 && errs.length === 0 ? 0 : 1);
})();
