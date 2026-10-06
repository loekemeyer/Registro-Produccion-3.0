/* Cervantes — login por la RED de la empresa en el primer mensaje del día (v3.0.1).
   Supabase y el reloj están simulados; internet se corta de verdad con context.setOffline.

   A) fuera de la red (403)            → no se envía nada, no queda pase, avisa que hay que usar el Wi-Fi
   B) en la red (200)                  → queda el pase del día, el mensaje se envía, el 2º mensaje no vuelve a preguntar
   C) vigencia del pase                → a las 17:44 sigue valiendo; a las 17:50 vuelve a preguntar
   D) la verificación NO depende de la LT: a las 08:00 (sin LT) fuera de la red también se bloquea
   E) sin internet                     → el mensaje se acepta pero queda RETENIDO: ni envío, ni IndexedDB (el service worker
                                         no lo ve); aviso visible; una recarga NO lo da por enviado (reconcile)
   F) vuelve internet pero en otra red → sigue retenido y el aviso dice que está fuera de la red
   G) vuelve internet en la red        → vuelve a preguntar solo, queda el pase, se libera y se envía todo
   H) legajo no habilitado (403)       → mensaje propio, no se envía
   Sale 1 si falla. */
const path = require("path");
let chromium;
try { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }
catch (_e) { try { ({ chromium } = require("playwright")); } catch (_e2) { console.error("Playwright no encontrado."); process.exit(2); } }
const { servir } = require("./_servidor.cjs");

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
    const est = { modo: modoInicial, login: 0, emp: 0, posts: 0 };
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
      if (url.includes("/functions/v1/login-operario")) {
        est.login++;
        if (est.modo === "ok") return json(200, { legajo: LEGAJO, nombre: "Prueba Red", sede: "Cervantes", access_token: "x", refresh_token: "y", expires_at: 0 });
        if (est.modo === "fuera") return json(403, { error: "Solo se puede entrar desde la red de la empresa." });
        if (est.modo === "legajo") return json(403, { error: "Legajo inexistente o inactivo." });
        return route.abort();
      }
      if (m === "GET") {
        if (url.includes("/rest/v1/Empleados")) { est.emp++; return json(200, [{ Legajo: LEGAJO, Empleado: "Prueba Red", Activo: "SI", hora_entrada: "08:30:00" }]); }
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

  // ---------- A) fuera de la red ----------
  { const s = await escenario("12:30", "fuera"); await abrir(s); await entrarYElegir(s); await enviarPB(s);
    await esperar(async () => s.est.login > 0);
    await pausa(600);
    chequeo("A pregunta a login-operario", s.est.login === 1);
    chequeo("A no envía nada", s.est.posts === 0 && (await cola(s.p)).length === 0);
    chequeo("A no deja pase", (await leer(s.p, PASE_KEY)) === null);
    chequeo("A avisa que hay que usar el Wi-Fi de la empresa", /Wi-Fi de la empresa/.test(await s.p.textContent("#error")));
    chequeo("A el botón Enviar vuelve a estar habilitado", await s.p.isEnabled("#btnEnviar"));
    await s.ctx.close(); }

  // ---------- B) en la red + C) vigencia ----------
  { const s = await escenario("12:30", "ok"); await abrir(s); await entrarYElegir(s); await enviarPB(s);
    const llego = await esperar(async () => s.est.posts > 0);
    const pase = JSON.parse((await leer(s.p, PASE_KEY)) || "null");
    chequeo("B queda el pase del día con la sede", pase && pase.day === "2026-10-06" && pase.sede === "Cervantes" && pase.legajo === LEGAJO);
    chequeo("B el mensaje se envía", llego);
    chequeo("B no guarda el JWT que devuelve login-operario", !/access_token|refresh_token/.test(await leer(s.p, PASE_KEY)));
    // 2º mensaje: el pase vigente evita volver a preguntar
    await esperar(async () => (await cola(s.p)).length === 0);
    const antes = s.est.login, postsAntes = s.est.posts;
    await otroMensaje(s);
    await esperar(async () => s.est.posts > postsAntes);
    chequeo("B el 2º mensaje del día se envía sin volver a preguntar", s.est.login === antes && s.est.posts > postsAntes);
    await s.ctx.close(); }

  // ---------- C) vigencia del pase: 17:44 sigue valiendo, 17:50 vuelve a preguntar ----------
  for (const [hhmm, debePreguntar] of [["17:44", false], ["17:50", true]]) {
    const s = await escenario("09:30", "ok"); await abrir(s); await entrarYElegir(s); await enviarPB(s);
    await esperar(async () => s.est.posts > 0);
    await esperar(async () => (await cola(s.p)).length === 0);
    await fijarHora(s.p, hhmm);
    const antes = s.est.login;
    await otroMensaje(s);
    await pausa(1500);
    traza(`C ${hhmm}: login antes=${antes} ahora=${s.est.login} · error="${(await s.p.textContent("#error")) || ""}"`);
    chequeo(`C a las ${hhmm} ${debePreguntar ? "vuelve a preguntar" : "el pase sigue valiendo"}`, debePreguntar ? s.est.login === antes + 1 : s.est.login === antes);
    await s.ctx.close();
  }

  // ---------- D) antes de las 08:30 (no hay LT) también verifica ----------
  { const s = await escenario("08:00", "fuera"); await abrir(s); await entrarYElegir(s); await enviarPB(s);
    await esperar(async () => s.est.login > 0); await pausa(500);
    chequeo("D a las 08:00 (sin LT) fuera de la red igual se bloquea", s.est.login === 1 && s.est.posts === 0 && (await cola(s.p)).length === 0);
    await s.ctx.close(); }

  // ---------- E) sin internet → retenido ----------
  { const s = await escenario("12:30", "ok"); await abrir(s); await entrarYElegir(s);
    await s.ctx.setOffline(true);
    await enviarPB(s);
    const q1 = await esperar(async () => (await cola(s.p)).length >= 1, 6000);
    await pausa(500);
    const q = await cola(s.p);
    chequeo("E el mensaje se acepta y queda en la cola", q1 && q.length >= 1);
    chequeo("E queda RETENIDO (__retDia)", q.length >= 1 && q.every((x) => x.__retDia === "2026-10-06"));
    chequeo("E no pasa al IndexedDB (el service worker no lo ve)", (await idbCuenta(s.p)) === 0);
    chequeo("E no se envía ni se pregunta (sin internet)", s.est.posts === 0 && s.est.login === 0);
    chequeo("E aviso visible arriba", await s.p.isVisible("#redAviso"));
    chequeo("E el indicador muestra 📶", /📶/.test(await s.p.textContent("#syncBadge")));
    const nRetenidos = q.length;

    // ---------- F) vuelve internet pero en OTRA red ----------
    s.est.modo = "fuera";
    await s.ctx.setOffline(false);
    const pregunto = await esperar(async () => s.est.login >= 1, 8000);
    await pausa(500);
    chequeo("F al volver internet pregunta por la red solo", pregunto);
    chequeo("F sigue retenido (fuera de la red)", (await cola(s.p)).length === nRetenidos && s.est.posts === 0);
    chequeo("F el aviso dice que está fuera de la red", /fuera de la red de la empresa/.test(await s.p.textContent("#redAviso")));

    // recarga: lo retenido NO se da por enviado
    await s.p.reload({ waitUntil: "domcontentloaded" });
    await s.p.waitForSelector("#legajoScreen", { state: "visible" });
    await pausa(1200);
    chequeo("F tras recargar, lo retenido sigue en la cola (reconcile no lo borra)", (await cola(s.p)).length === nRetenidos);
    chequeo("F tras recargar, el aviso sigue", await s.p.isVisible("#redAviso"));

    // ---------- G) vuelve internet EN la red ----------
    s.est.modo = "ok";
    const antes = s.est.login;
    await s.p.evaluate(() => window.dispatchEvent(new Event("online")));
    const libero = await esperar(async () => s.est.posts >= 1, 12000);
    await esperar(async () => (await cola(s.p)).length === 0, 12000);
    chequeo("G vuelve a preguntar al volver la red", s.est.login > antes);
    chequeo("G queda el pase", !!(await leer(s.p, PASE_KEY)));
    chequeo("G lo retenido se libera y se envía", libero && (await cola(s.p)).length === 0);
    chequeo("G el aviso desaparece", !(await s.p.locator("#redAviso").count()));
    await s.ctx.close(); }

  // ---------- H) legajo no habilitado ----------
  { const s = await escenario("12:30", "legajo"); await abrir(s); await entrarYElegir(s); await enviarPB(s);
    await esperar(async () => s.est.login > 0); await pausa(500);
    chequeo("H avisa que el legajo no está habilitado", /no está habilitado/.test(await s.p.textContent("#error")));
    chequeo("H no se envía nada", s.est.posts === 0 && (await cola(s.p)).length === 0);
    await s.ctx.close(); }

  const fallas = resultados.filter(([, ok]) => !ok);
  console.log(`cervantes-red: ${resultados.length - fallas.length}/${resultados.length} chequeos OK · pageerrors: ${errs.length ? errs.join(" | ") : "none"} · ${fallas.length === 0 && errs.length === 0 ? "✓ OK" : "✗ FAIL"}`);
  await b.close(); await srv.cerrar();
  process.exit(fallas.length === 0 && errs.length === 0 ? 0 : 1);
})();
