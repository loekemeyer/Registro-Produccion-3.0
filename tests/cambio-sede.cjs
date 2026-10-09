/* Cambiar sede (Cervantes v3.1.14 · Virgilio v30.15) [Elías, 09/10: «te pide confirmar en grande, sí / no; si le da que sí lo cambia
   a la otra sede (con opción de cancelar y regresa a su sede anterior con el tiempo cancelado) … en poner la TV de la otra sede inicia
   el contador de tiempo; al lograr hacer el login en la otra sede, termina»]. Supabase simulado para las dos apps.

   1) Cervantes → «No»: no pasa nada
   2) Cervantes → «Sí»: va a Virgilio con el cambio guardado; ahí está «Cancelar el cambio» y no «Volver al inicio»;
      entra con el código y su nombre → Virgilio graba «CS» (apertura y cierre con ts_inicio = el «Sí») y el cambio se cierra
   3) Cervantes → «Sí» → en Virgilio «Cancelar»: vuelve a Cervantes y no se graba nada
   4) Virgilio → «🔁 Cambiar a Cervantes» → «Sí»: aunque el celular tenga un pase de Cervantes vigente pide el código de la TV, con
      «Cancelar el cambio»; el legajo ya está escrito; al entrar Cervantes manda «CS» con hora de inicio y segundos de tiempo muerto
   5) Cervantes con una matriz sin cajón: no deja cambiar de sede (pide cerrar con C)
   6) la copia de la tablet de GP2 (fuera de /cervantes-gp2/) no muestra el botón
   Sale 1 si falla. */
let chromium;
try { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }
catch (_e) { try { ({ chromium } = require("playwright")); } catch (_e2) { console.error("Playwright no encontrado."); process.exit(2); } }
const { servir } = require("./_servidor.cjs");

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info, prefer, accept-profile, content-profile, x-supabase-api-version, accept",
  "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
};
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const CODIGO_CERV = "4821";
const CODIGO_VIR = "1234";
const BUNDLE = {
  empleados: { "c104": { nombre: "Moncayo Jhonny", activo: true, hora_entrada: "00:01:00" } },
  matrices: [{ n: "10", d: "Varilla c/ Cuchilla", ppk: 1, uxg: 2, maq: "", act: true, th: 6.3 }],
  registro_en_golpes: true, matriz_salidas: {}, matriz_fleje: {}, matriz_fleje_pieza: {}, envasado: {}, rollos_saldo: [], rollos_abiertos: {},
};

(async () => {
  const srv = await servir();
  const b = await chromium.launch();
  const errs = [];
  const res = [];
  const chequeo = (n, ok) => { res.push([n, !!ok]); if (!ok) console.log("  ✗ " + n); };
  const esperar = async (cond, ms = 8000) => { for (let t = 0; t < ms; t += 100) { if (await cond()) return true; await pausa(100); } return false; };

  async function contexto(extraInit) {
    const ctx = await b.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 800 } });
    ctx.setDefaultTimeout(8000);
    const base = { eventos: [], filasVir: [], alerts: [] };
    if (extraInit) await ctx.addInitScript(extraInit);
    await ctx.route("**/*.supabase.co/**", async (route) => {
      const req = route.request(); const url = req.url(); const m = req.method();
      const json = (status, body) => route.fulfill({ status, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify(body) });
      if (m === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
      let cuerpo = {};
      try { cuerpo = JSON.parse(req.postData() || "{}"); } catch { /* sin cuerpo */ }
      const fn = (url.match(/\/rpc\/([a-z0-9_]+)/i) || [])[1] || "";
      // Cervantes
      if (fn === "reg_prod_3_0_cerv_ingresar") {
        return json(200, cuerpo.p_clave === CODIGO_CERV ? { ok: true, pase: "PASE.OK1", vence: new Date(Date.now() + 3600e3).toISOString() } : { ok: false, error: "codigo" });
      }
      if (fn === "reg_prod_3_0_bundle") return cuerpo.p_pase === "PASE.OK1" ? json(200, BUNDLE) : json(400, { code: "28000", message: "Pase inválido o vencido" });
      if (fn === "reg_prod_3_0_registrar_evento") {
        if (cuerpo.p_pase !== "PASE.OK1") return json(400, { code: "28000", message: "Pase inválido o vencido" });
        base.eventos.push(cuerpo);
        return json(200, { ok: true, id: base.eventos.length, premio: 0, uni: 0 });
      }
      if (fn === "reg_prod_3_0_registrar_ingreso") return json(200, 1);
      // Virgilio
      if (fn === "reg_prod_3_0_virgilio_operarios") {
        return json(200, cuerpo.p_clave === CODIGO_VIR ? { ok: true, operarios: [{ legajo: "104", nombre: "Moncayo Jhonny" }] } : { ok: false });
      }
      if (/\/rest\/v1\/Registros_Produccion_Virgilio/.test(url) && m === "POST") {
        (Array.isArray(cuerpo) ? cuerpo : [cuerpo]).forEach((r) => base.filasVir.push(r));
        return route.fulfill({ status: 201, headers: CORS, body: "" });
      }
      if (/\/rest\/v1\/Empleados/.test(url)) return json(200, [{ Legajo: "104", Empleado: "Moncayo Jhonny" }]);
      if (fn) return json(404, { code: "PGRST202", message: "function not found: " + fn });
      return route.abort();
    });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errs.push(e.message));
    p.on("dialog", (d) => { base.alerts.push(d.message()); d.dismiss().catch(() => {}); });
    return { ctx, p, base };
  }
  const leer = (p, k) => p.evaluate((key) => localStorage.getItem(key), k);
  const visible = (p, sel) => p.locator(sel).first().isVisible().catch(() => false);

  async function entrarCervantes(p, legajo) {
    await p.waitForSelector("#tvClaveInput");
    await p.fill("#tvClaveInput", CODIGO_CERV);
    await p.click("#tvClaveOk");
    await p.waitForSelector("#tvClaveModal", { state: "detached" });
    await esperar(() => p.evaluate(() => typeof hayCatalogo === "function" && hayCatalogo()));
    if (legajo != null) await p.fill("#legajoInput", legajo);
    await p.click("#btnContinuar");
    await p.waitForSelector("#optionsScreen:not(.hidden)");
  }
  async function entrarVirgilio(p) {
    await p.waitForSelector("#tvClaveInput");
    await p.fill("#tvClaveInput", CODIGO_VIR);
    await p.click("#tvClaveStep .primary-btn");
    await p.waitForSelector("#tvNombreLista button");
    await p.click("#tvNombreLista button");
    await p.waitForSelector("#optionsScreen:not(.hidden)");
  }

  // ---- 1) y 2) Cervantes → Virgilio ----
  { const { ctx, p, base } = await contexto();
    await p.goto(srv.url + "/cervantes-gp2/", { waitUntil: "domcontentloaded" });
    await entrarCervantes(p, "104");
    chequeo("1 Cervantes muestra «Cambiar a Virgilio»", await visible(p, "#btnCambiarSede"));
    await p.click("#btnCambiarSede");
    await p.waitForSelector(".rp-op[data-val='no']");
    chequeo("1 la pregunta es grande (≥ 22 px)", await p.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".rp-modal p")).fontSize) >= 22));
    await p.click(".rp-op[data-val='no']");
    chequeo("1 «No»: no queda ningún cambio y sigue en Cervantes", (await leer(p, "rp3_cambio_sede")) === null && /\/cervantes-gp2\//.test(p.url()));

    const antes = Date.now();
    await p.click("#btnCambiarSede");
    await p.click(".rp-op[data-val='si']");
    await p.waitForURL(/\/virgilio\//);
    const c = JSON.parse((await leer(p, "rp3_cambio_sede")) || "null");
    chequeo("2 «Sí»: va a Virgilio con el cambio guardado (c104, desde Cervantes, hora del «Sí»)",
      !!c && c.legajo === "c104" && c.desde === "cervantes" && c.hacia === "virgilio" && Date.parse(c.inicio) >= antes - 1000);
    await p.waitForSelector("#authBlock:not(.hidden)");
    chequeo("2 Virgilio muestra «Cancelar el cambio» y no «Volver al inicio»", (await visible(p, "#tvCancelarCambio")) && !(await visible(p, "#tvVolverInicio")));
    await pausa(1100);
    await entrarVirgilio(p);
    const ok = await esperar(() => base.filasVir.filter((r) => r.opcion === "CS").length >= 2);
    const cs = base.filasVir.filter((r) => r.opcion === "CS");
    const ap = cs.find((r) => !r.ts_inicio), ci = cs.find((r) => !!r.ts_inicio);
    chequeo("2 Virgilio graba CS: apertura y cierre del mismo operario (104)", ok && !!ap && !!ci && ap.legajo === "104" && ci.legajo === "104");
    chequeo("2 el cierre lleva ts_inicio = el «Sí» y termina después", !!ci && Date.parse(ci.ts_inicio) === Date.parse(c.inicio) && Date.parse(ci.ts_cliente) > Date.parse(c.inicio));
    chequeo("2 el cambio queda cerrado", (await leer(p, "rp3_cambio_sede")) === null);
    await ctx.close();
  }

  // ---- 3) Cervantes → «Sí» → Cancelar en Virgilio ----
  { const { ctx, p, base } = await contexto();
    await p.goto(srv.url + "/cervantes-gp2/", { waitUntil: "domcontentloaded" });
    await entrarCervantes(p, "104");
    await p.click("#btnCambiarSede");
    await p.click(".rp-op[data-val='si']");
    await p.waitForURL(/\/virgilio\//);
    await p.waitForSelector("#tvCancelarCambio");
    await p.click("#tvCancelarCambio");
    await p.waitForURL(/\/cervantes-gp2\//);
    await pausa(500);
    chequeo("3 «Cancelar» vuelve a Cervantes y borra el cambio", (await leer(p, "rp3_cambio_sede")) === null);
    chequeo("3 Cervantes sigue con su pase (no pide el código otra vez)", !(await visible(p, "#tvClaveInput")));
    chequeo("3 no se grabó ningún CS", !base.filasVir.some((r) => r.opcion === "CS") && !base.eventos.some((e) => e.p.toque && e.p.toque.opcion === "CS"));
    await ctx.close();
  }

  // ---- 4) Virgilio → Cervantes (con un pase de Cervantes vigente en el celular) ----
  { const { ctx, p, base } = await contexto(() => {
      if (!sessionStorage.getItem("__init")) {
        sessionStorage.setItem("__init", "1");
        localStorage.setItem("rp3c_pase", JSON.stringify({ pase: "PASE.VIEJO", vence: new Date(Date.now() + 3600e3).toISOString(), at: new Date().toISOString() }));
      }
    });
    await p.goto(srv.url + "/virgilio/", { waitUntil: "domcontentloaded" });
    await p.waitForSelector("#authBlock:not(.hidden)");
    await entrarVirgilio(p);
    await p.evaluate(() => backToLegajo());
    await p.waitForSelector("#btnCambiarPlanta");
    chequeo("4 Virgilio dice «Cambiar a Cervantes»", /Cambiar a Cervantes/.test(await p.textContent("#btnCambiarPlanta")) && (await visible(p, "#btnCambiarPlanta")));
    await p.click("#btnCambiarPlanta");
    await p.waitForSelector("#csConfirmar .cs-no");
    await p.click("#csConfirmar .cs-no");
    chequeo("4 «No»: sigue en Virgilio sin cambio", (await leer(p, "rp3_cambio_sede")) === null && /\/virgilio\//.test(p.url()));
    await p.click("#btnCambiarPlanta");
    await p.click("#csConfirmar .cs-si");
    await p.waitForURL(/\/cervantes-gp2\//);
    await p.waitForSelector("#tvClaveInput");
    chequeo("4 Cervantes pide el código aunque había un pase", (await leer(p, "rp3c_pase")) === null);
    chequeo("4 en el código está «Cancelar el cambio y volver a Virgilio» y no «Volver al inicio»",
      (await visible(p, "#tvClaveCancelarCambio")) && !(await visible(p, "#tvClaveVolver")));
    await pausa(1100);
    await entrarCervantes(p, null);
    chequeo("4 el legajo ya estaba escrito", (await p.inputValue("#legajoInput")) === "104");
    const ok = await esperar(() => base.eventos.some((e) => e.p.toque && e.p.toque.opcion === "CS"));
    const cs = base.eventos.find((e) => e.p.toque && e.p.toque.opcion === "CS");
    chequeo("4 Cervantes manda CS del legajo verdadero (c104) con hora de inicio y segundos de tiempo muerto",
      ok && cs.p.legajo === "c104" && !!cs.p.hora_inicio && Number(cs.p.segundos_tiempo_muerto) >= 1 && cs.p.uni === 0);
    chequeo("4 el cambio queda cerrado y Virgilio pedirá el código si vuelve", (await leer(p, "rp3_cambio_sede")) === null && (await leer(p, "vir_legajo_auth")) === null);
    await ctx.close();
  }

  // ---- 5) matriz sin cajón: no deja ----
  { const { ctx, p, base } = await contexto();
    await p.goto(srv.url + "/cervantes-gp2/", { waitUntil: "domcontentloaded" });
    await entrarCervantes(p, "104");
    await p.evaluate(() => { const s = readState("c104"); s.matrixNeedsC = true; writeState("c104", s); });
    await p.click("#btnCambiarSede");
    await pausa(400);
    chequeo("5 con una matriz sin cajón avisa y no pregunta", base.alerts.some((a) => /cajón/.test(a)) && !(await visible(p, ".rp-op")) && (await leer(p, "rp3_cambio_sede")) === null);
    await ctx.close();
  }

  // ---- 6) la regla del botón: sólo dentro de /cervantes-gp2/ ----
  { const { ctx, p } = await contexto();
    await p.goto(srv.url + "/cervantes-gp2/", { waitUntil: "domcontentloaded" });
    chequeo("6 hayOtraSede() sólo en /cervantes-gp2/", await p.evaluate(() => hayOtraSede() === true &&
      /\/cervantes-gp2\//.test("/cervantes-gp2/") && !/\/cervantes-gp2\//.test("/Produccion/RegistroApp/Operarios_GP2.html")));
    // un cambio hacia Cervantes en curso no afecta a la copia (mismo dominio): fuera de /cervantes-gp2/ cambioHaciaAca() no lo ve
    chequeo("6 fuera de /cervantes-gp2/ el cambio en curso no se toma", await p.evaluate(() => {
      localStorage.setItem("rp3_cambio_sede", JSON.stringify({ desde: "virgilio", hacia: "cervantes", legajo: "104", inicio: new Date().toISOString(), dia: dayKeyAR() }));
      const dentro = !!cambioHaciaAca();
      history.replaceState(null, "", "/Produccion/RegistroApp/Operarios_GP2.html");
      const fuera = cambioHaciaAca() === null;
      localStorage.removeItem("rp3_cambio_sede");
      return dentro && fuera;
    }));
    await ctx.close();
  }

  await b.close();
  await srv.cerrar();
  const n = res.filter((r) => r[1]).length;
  const propios = errs.filter((e) => !/Failed to fetch|NetworkError|net::|Load failed|aborted/i.test(e));
  console.log(`cambio-sede: ${n}/${res.length} chequeos OK · pageerrors: ${propios.length ? propios.join(" | ") : "none"} · ${n === res.length && !propios.length ? "✓ OK" : "✗ FAIL"}`);
  process.exit(n === res.length && !propios.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
