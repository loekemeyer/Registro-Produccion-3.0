/* Cervantes — ENTRADA con el código de la TV, antes de entrar (v3.0.5).
   Supabase y el reloj están simulados; internet se corta de verdad con context.setOffline (o con navigator.onLine simulado).

   A) abrir cervantes/ sin pase      → aparece la pantalla del código ANTES de la del legajo (y la tapa); código mal → sigue ahí y
                                       lo dice; código bien → entra, queda el pase del EQUIPO y la llamada a la base lleva app, código,
                                       id del equipo, huella, navegador y pantalla (sin legajo: todavía no hay)
   B) legajo                         → al poner el legajo queda anotado qué legajo se usó en el equipo (1 vez por día); otro legajo en el
                                       mismo equipo se anota aparte; el mensaje se envía sin volver a pedir el código
   C) recargar con pase              → no vuelve a pedir el código
   D) vigencia del pase              → a las 17:44 sigue valiendo; a las 17:50 vuelve la pantalla
   E) a las 08:00 (sin LT)           → también pide el código (no depende de la Llegada Tarde)
   F) arranque sin internet          → no hay pantalla: se carga y el mensaje queda RETENIDO (ni envío, ni IndexedDB, aviso sin botón);
                                       al volver internet la pantalla aparece sola; con el código se libera y se envía todo
   G) internet se corta con la pantalla abierta → se puede entrar y cargar: queda retenido; una recarga NO lo da por enviado;
                                       el aviso ofrece «Ingresar código» («Ahora no» lo deja para después)
   H) demasiados intentos            → lo dice y la pantalla sigue
   J) 7 códigos malos seguidos       → la pantalla sigue (el tope lo pone la base)
   I) función caída (5xx / sin crear) → no culpa al operario: entra y queda retenido; la pantalla no se abre sola por 5 minutos
   Sale 1 si falla. */
const path = require("path");
let chromium;
try { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }
catch (_e) { try { ({ chromium } = require("playwright")); } catch (_e2) { console.error("Playwright no encontrado."); process.exit(2); } }
const { servir } = require("./_servidor.cjs");

const CLAVE_BUENA = "4821";
const LEGAJO = "999";
const OTRO = "998";
const Q_KEY = "prod_queue_Cervantes_v2_supa";
const PASE_KEY = "prod_pase_Cervantes";
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
  async function escenario(hhmm, modoInicial, opts) {
    const ctx = await b.newContext({ serviceWorkers: "block" });
    ctx.setDefaultTimeout(7000);
    const est = { modo: modoInicial, login: 0, emp: 0, posts: 0, llamadas: [], registros: [] };
    await ctx.addInitScript(({ desfase, sinRed }) => {
      const RealDate = Date;
      window.__desfase = desfase;
      class FakeDate extends RealDate {
        constructor(...a) { if (a.length === 0) super(RealDate.now() + window.__desfase); else super(...a); }
        static now() { return RealDate.now() + window.__desfase; }
      }
      window.Date = FakeDate;
      // navigator.onLine simulado: sólo para el escenario «arranque sin internet» (la página carga por la red de verdad)
      if (sinRed) {
        window.__onLine = false;
        Object.defineProperty(navigator, "onLine", { configurable: true, get: () => window.__onLine !== false });
      }
    }, { desfase: ba(hhmm) - Date.now(), sinRed: !!(opts && opts.sinRed) });
    await ctx.route("**/*.supabase.co/**", async (route) => {
      const req = route.request(); const url = req.url(); const m = req.method();
      const json = (status, body) => route.fulfill({ status, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify(body) });
      if (m === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
      if (url.includes("/rest/v1/rpc/reg_prod_3_0_cerv_ingresar")) {
        est.login++;
        let body = {}; try { body = req.postDataJSON() || {}; } catch (_e) { /* sin cuerpo */ }
        est.llamadas.push(body);
        if (est.modo === "caido") return json(500, { message: "boom" });
        if (est.modo === "bloqueo") return json(200, { ok: false, error: "bloqueo" });
        if (est.modo === "sin_funcion") return json(404, { code: "PGRST202", message: "no existe" });
        return body.p_clave === CLAVE_BUENA ? json(200, { ok: true }) : json(200, { ok: false, error: "codigo" });
      }
      if (url.includes("/rest/v1/rpc/reg_prod_3_0_registrar_ingreso")) {
        let body = {}; try { body = req.postDataJSON() || {}; } catch (_e) { /* sin cuerpo */ }
        est.registros.push(body);
        return json(200, 1);
      }
      if (m === "GET") {
        if (url.includes("/rest/v1/Empleados")) {
          est.emp++;
          return json(200, [
            { Legajo: LEGAJO, Empleado: "Prueba TV", Activo: "SI", hora_entrada: "08:30:00" },
            { Legajo: OTRO, Empleado: "Otra Persona", Activo: "SI", hora_entrada: "08:30:00" },
          ]);
        }
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

  const modalTv = (p, ms = 6000) => p.waitForSelector("#tvClaveModal", { state: "visible", timeout: ms }).then(() => true).catch(() => false);
  const sinModal = async (p) => (await p.locator("#tvClaveModal").count()) === 0;
  async function abrir({ p, est }, { conPantalla = true } = {}) {
    traza("abrir /cervantes/");
    await p.goto(srv.url + "/cervantes/", { waitUntil: "domcontentloaded" });
    if (conPantalla) await p.waitForSelector("#tvClaveModal", { state: "visible" });
    else await p.waitForSelector("#legajoScreen", { state: "visible" });
    for (let i = 0; i < 50 && est.emp === 0; i++) await pausa(100);
    await pausa(300);   // que cargarCatalogos() termine de llenar empleadosMap
  }
  async function tipearClave({ p }, clave) {
    await p.fill("#tvClaveInput", clave);
    await p.click("#tvClaveOk");
  }
  async function entrarConCodigo(s) {   // abre y pasa la pantalla con el código bueno (espera a que quede el pase)
    await abrir(s);
    await tipearClave(s, CLAVE_BUENA);
    await s.p.waitForSelector("#tvClaveModal", { state: "detached" });
    await esperar(async () => (await leer(s.p, PASE_KEY)) !== null);
  }
  async function elegir({ p }, legajo = LEGAJO) {
    traza("legajo + continuar");
    await p.fill("#legajoInput", legajo);
    await p.click("#btnContinuar");
    await p.waitForSelector("#optionsScreen:not(.hidden)", { timeout: 8000 });
  }
  async function enviarPB({ p }) {
    traza("elegir PB + enviar");
    await p.click('.box[data-code="PB"]');
    await p.click("#btnEnviar");
  }
  // Tras enviar, Cervantes vuelve a la pantalla del legajo: para el siguiente mensaje se entra de nuevo.
  async function otroMensaje(s, legajo = LEGAJO) {
    await s.p.waitForSelector("#legajoScreen", { state: "visible", timeout: 8000 });
    await elegir(s, legajo);
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
  const visibilidad = (p) => p.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

  // ---------- A) la pantalla del código aparece ANTES de entrar ----------
  { const s = await escenario("12:30", "ok"); await abrir(s);
    chequeo("A al abrir sin pase aparece la pantalla del código de la TV", await modalTv(s.p));
    chequeo("A tapa la pantalla del legajo (no se puede tocar nada de abajo)", await s.p.evaluate(() => {
      const r = document.getElementById("legajoInput").getBoundingClientRect();
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!(el && el.closest("#tvClaveModal"));
    }));
    chequeo("A todavía no se llamó a la base ni se envió nada", s.est.login === 0 && s.est.posts === 0);
    await tipearClave(s, "0000");
    await esperar(async () => s.est.login === 1);
    await pausa(300);
    chequeo("A con el código malo la pantalla sigue y lo dice", (await modalTv(s.p)) && /incorrecto o vencido/.test(await s.p.textContent("#tvClaveError")));
    chequeo("A sin pase", (await leer(s.p, PASE_KEY)) === null);
    await tipearClave(s, CLAVE_BUENA);
    await s.p.waitForSelector("#tvClaveModal", { state: "detached" });
    await esperar(async () => (await leer(s.p, PASE_KEY)) !== null);
    const pase = JSON.parse((await leer(s.p, PASE_KEY)) || "null");
    chequeo("A con el código bueno entra y queda el pase del día del EQUIPO", pase && pase.day === "2026-10-06" && !("legajo" in pase));
    const ll = s.est.llamadas[s.est.llamadas.length - 1] || {};
    chequeo("A la llamada lleva app y código, y no lleva legajo", ll.p_app === "cervantes" && ll.p_clave === CLAVE_BUENA && !("p_legajo" in ll));
    chequeo("A la llamada lleva el id del equipo, la huella y el navegador", !!ll.p_dispositivo && !!ll.p_huella && /Mozilla|Chrome/.test(ll.p_navegador || ""));
    chequeo("A la llamada lleva pantalla, zona e idioma", !!(ll.p_extra && ll.p_extra.pantalla && "zona" in ll.p_extra && "idioma" in ll.p_extra));
    const idGuardado = await leer(s.p, "gv_dispositivo");
    chequeo("A el id del equipo queda guardado (el mismo que Virgilio) y es el que se mandó", !!idGuardado && idGuardado === ll.p_dispositivo);
    chequeo("A los 2 intentos mandaron el mismo id y la misma huella", s.est.llamadas.length === 2 && s.est.llamadas[0].p_dispositivo === ll.p_dispositivo && s.est.llamadas[0].p_huella === ll.p_huella);
    chequeo("A el pase no guarda el código", !(await leer(s.p, PASE_KEY) || "").includes(CLAVE_BUENA));

    // ---------- B) legajo y mensajes ----------
    chequeo("B todavía no se anotó ningún legajo", s.est.registros.length === 0);
    await elegir(s, LEGAJO);
    await esperar(async () => s.est.registros.length >= 1);
    const r1 = s.est.registros[0] || {};
    chequeo("B al poner el legajo se anota en el registro del equipo", s.est.registros.length === 1 && r1.p_app === "cervantes" && r1.p_legajo === LEGAJO && r1.p_nombre === "Prueba TV" && r1.p_metodo === "legajo");
    chequeo("B ese registro lleva el mismo id de equipo y la huella", r1.p_dispositivo === idGuardado && !!r1.p_huella && !!(r1.p_extra && r1.p_extra.pantalla));
    await enviarPB(s);
    const llego = await esperar(async () => s.est.posts > 0);
    chequeo("B el mensaje se envía sin volver a pedir el código", llego && (await sinModal(s.p)) && s.est.login === 2);
    await esperar(async () => (await cola(s.p)).length === 0);
    await otroMensaje(s, LEGAJO);
    await pausa(500);
    chequeo("B el mismo legajo el mismo día no se vuelve a anotar", s.est.registros.length === 1);
    await esperar(async () => (await cola(s.p)).length === 0);
    await otroMensaje(s, OTRO);
    await esperar(async () => s.est.registros.length >= 2);
    chequeo("B otro legajo en el mismo equipo se anota aparte (con el mismo id)", s.est.registros.length === 2 && s.est.registros[1].p_legajo === OTRO && s.est.registros[1].p_dispositivo === idGuardado);
    await esperar(async () => (await cola(s.p)).length === 0);

    // ---------- C) recargar con pase ----------
    await s.p.reload({ waitUntil: "domcontentloaded" });
    await s.p.waitForSelector("#legajoScreen", { state: "visible" });
    await pausa(800);
    chequeo("C recargar con pase de hoy no vuelve a pedir el código", (await sinModal(s.p)) && s.est.login === 2);
    await s.ctx.close(); }

  // ---------- D) vigencia del pase: 17:44 sigue valiendo, 17:50 vuelve la pantalla ----------
  for (const [hhmm, debePedir] of [["17:44", false], ["17:50", true]]) {
    const s = await escenario("09:30", "ok"); await entrarConCodigo(s);
    await fijarHora(s.p, hhmm);
    await visibilidad(s.p);
    const pidio = await modalTv(s.p, debePedir ? 4000 : 1500);
    traza(`D ${hhmm}: pidió=${pidio}`);
    chequeo(`D a las ${hhmm} ${debePedir ? "vuelve la pantalla del código" : "el pase sigue valiendo"}`, pidio === debePedir);
    await s.ctx.close();
  }

  // ---------- E) antes de las 08:30 (no hay LT) también pide el código ----------
  { const s = await escenario("08:00", "ok"); await abrir(s);
    chequeo("E a las 08:00 (sin LT) también pide el código", await modalTv(s.p));
    await s.ctx.close(); }

  // ---------- F) arranque SIN internet → sin pantalla, retenido; vuelve internet → la pantalla aparece sola ----------
  { const s = await escenario("12:30", "ok", { sinRed: true }); await abrir(s, { conPantalla: false });
    chequeo("F arranque sin internet: no hay pantalla del código", await sinModal(s.p));
    await elegir(s); await enviarPB(s);
    const q1 = await esperar(async () => (await cola(s.p)).length >= 1, 6000);
    await pausa(500);
    const q = await cola(s.p);
    chequeo("F el mensaje se acepta y queda en la cola", q1 && q.length >= 1);
    chequeo("F queda RETENIDO (__retDia)", q.length >= 1 && q.every((x) => x.__retDia === "2026-10-06"));
    chequeo("F no pasa al IndexedDB (el service worker no lo ve)", (await idbCuenta(s.p)) === 0);
    chequeo("F no se envía ni se llama a la base", s.est.posts === 0 && s.est.login === 0);
    chequeo("F aviso visible arriba, sin botón mientras no hay internet", (await s.p.isVisible("#redAviso")) && !(await s.p.isVisible("#redAvisoBtn")));
    chequeo("F el indicador muestra 📺", /📺/.test(await s.p.textContent("#syncBadge")));
    const n = q.length;
    chequeo("F sin internet no se anota el legajo (se hará cuando haya)", s.est.registros.length === 0);

    await s.p.evaluate(() => { window.__onLine = true; window.dispatchEvent(new Event("online")); });
    chequeo("F al volver internet la pantalla del código aparece sola", await modalTv(s.p));
    chequeo("F sigue retenido hasta tener el código", s.est.posts === 0 && (await cola(s.p)).length === n);
    await tipearClave(s, CLAVE_BUENA);
    const libero = await esperar(async () => s.est.posts >= 1, 12000);
    await esperar(async () => (await cola(s.p)).length === 0, 12000);
    chequeo("F con el código queda el pase, se libera y se envía lo retenido", !!(await leer(s.p, PASE_KEY)) && libero && (await cola(s.p)).length === 0);
    chequeo("F el aviso desaparece", !(await s.p.locator("#redAviso").count()));
    await s.ctx.close(); }

  // ---------- G) se corta internet con la pantalla abierta → entra y carga; recarga; «Ingresar código» ----------
  { const s = await escenario("12:30", "ok"); await abrir(s);
    await s.ctx.setOffline(true);
    await tipearClave(s, CLAVE_BUENA);
    await s.p.waitForSelector("#tvClaveModal", { state: "detached" });
    chequeo("G sin internet al dar el código: se entra igual (queda sin pase)", (await leer(s.p, PASE_KEY)) === null && s.est.login === 0);
    await elegir(s); await enviarPB(s);
    await esperar(async () => (await cola(s.p)).length >= 1, 6000);
    await pausa(400);
    const q = await cola(s.p);
    chequeo("G el mensaje queda retenido", q.length >= 1 && q.every((x) => x.__retDia === "2026-10-06") && s.est.posts === 0);
    const n = q.length;

    await s.ctx.setOffline(false);
    await s.p.reload({ waitUntil: "domcontentloaded" });
    await s.p.waitForSelector("#legajoScreen", { state: "visible" });
    await pausa(800);
    chequeo("G tras recargar, lo retenido sigue en la cola (reconcile no lo borra)", (await cola(s.p)).length === n);
    chequeo("G tras recargar sin pase vuelve a pedir el código", await modalTv(s.p));
    chequeo("G el aviso de arriba sigue", await s.p.isVisible("#redAviso"));
    await tipearClave(s, CLAVE_BUENA);
    const libero = await esperar(async () => s.est.posts >= 1, 12000);
    await esperar(async () => (await cola(s.p)).length === 0, 12000);
    chequeo("G con el código se libera y se envía todo", libero && (await cola(s.p)).length === 0 && !!(await leer(s.p, PASE_KEY)));
    await s.ctx.close(); }

  // ---------- G2) «Ahora no» del aviso deja lo retenido para después ----------
  { const s = await escenario("12:30", "caido"); await abrir(s);
    await tipearClave(s, CLAVE_BUENA);                       // la base no contesta: entra igual (I)
    await s.p.waitForSelector("#tvClaveModal", { state: "detached" });
    await elegir(s); await enviarPB(s);
    await esperar(async () => (await cola(s.p)).length >= 1, 6000);
    await pausa(300);
    chequeo("G2 retenido y con botón «Ingresar código» (hay internet)", (await cola(s.p)).length >= 1 && (await s.p.isVisible("#redAvisoBtn")));
    await s.p.click("#redAvisoBtn");
    chequeo("G2 el botón abre la pantalla, esta vez con «Ahora no»", (await modalTv(s.p)) && (await s.p.locator("#tvClaveNo").count()) === 1);
    await s.p.click("#tvClaveNo");
    await pausa(300);
    chequeo("G2 «Ahora no» la cierra y lo retenido sigue esperando", (await sinModal(s.p)) && (await cola(s.p)).length >= 1 && s.est.posts === 0);
    await s.ctx.close(); }

  // ---------- H) demasiados intentos ----------
  { const s = await escenario("12:30", "bloqueo"); await abrir(s);
    await tipearClave(s, CLAVE_BUENA);
    await esperar(async () => s.est.login === 1);
    await pausa(300);
    chequeo("H avisa «Demasiados intentos» y la pantalla sigue", (await modalTv(s.p)) && /Demasiados intentos/.test(await s.p.textContent("#tvClaveError")));
    chequeo("H no queda pase", (await leer(s.p, PASE_KEY)) === null);
    await s.ctx.close(); }

  // ---------- I) función caída o sin crear: no se culpa al operario ----------
  for (const modo of ["caido", "sin_funcion"]) {
    const s = await escenario("12:30", modo); await abrir(s);
    await tipearClave(s, CLAVE_BUENA);
    await s.p.waitForSelector("#tvClaveModal", { state: "detached" });
    chequeo(`I ${modo}: entra igual y no queda pase`, (await leer(s.p, PASE_KEY)) === null);
    await visibilidad(s.p);
    chequeo(`I ${modo}: la pantalla no se abre sola otra vez por 5 minutos`, !(await modalTv(s.p, 1200)));
    await elegir(s); await enviarPB(s);
    const q1 = await esperar(async () => (await cola(s.p)).length >= 1, 6000);
    await pausa(300);
    const q = await cola(s.p);
    chequeo(`I ${modo}: el mensaje queda retenido, no rechazado`, q1 && q.every((x) => x.__retDia) && s.est.posts === 0);
    await s.ctx.close();
  }

  // ---------- J) 7 códigos malos seguidos: la pantalla no se corta sola (frena la base, no la pantalla) ----------
  { const s = await escenario("12:30", "ok"); await abrir(s);
    for (let i = 0; i < 7; i++) { await modalTv(s.p); await tipearClave(s, "1111"); await esperar(async () => s.est.login === i + 1); await pausa(150); }
    chequeo("J con 7 códigos malos la pantalla sigue ahí, sin pase y sin enviar", (await modalTv(s.p)) && s.est.login === 7 && (await leer(s.p, PASE_KEY)) === null && s.est.posts === 0);
    await s.ctx.close(); }

  const fallas = resultados.filter(([, ok]) => !ok);
  console.log(`cervantes-tv: ${resultados.length - fallas.length}/${resultados.length} chequeos OK · pageerrors: ${errs.length ? errs.join(" | ") : "none"} · ${fallas.length === 0 && errs.length === 0 ? "✓ OK" : "✗ FAIL"}`);
  await b.close(); await srv.cerrar();
  process.exit(fallas.length === 0 && errs.length === 0 ? 0 : 1);
})();
