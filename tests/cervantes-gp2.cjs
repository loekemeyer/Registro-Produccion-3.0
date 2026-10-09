/* Cervantes · botonera de GP2 (cervantes-gp2/, v3.1.3) — entra con el código de la TV, usa el PASE y habla con el schema reg_prod_3_0.
   Supabase está simulado: la base de mentira exige el pase (igual que reg_prod_3_0_pase_ok) y guarda lo que le llega.
     1) sin pase aparece la pantalla del código; código malo no entra; código bueno entra, guarda el pase y trae el catálogo
        con el pase, el id del equipo y la cabecera Content-Profile: reg_prod_3_0
     2) cada operario ve los botones de SU tipo (como 2.0; sin CT del alimentador mientras los rollos estén apagados) y el legajo se
        anota 1 vez
     3) E y C llegan con el toque crudo adentro (opción, texto, hora, versión) y los golpes tal cual los cargó el operario
     4) el historial marca ENVIADO y el 🗑 anula en la base (con pase)
     5) sin señal: el toque queda PENDIENTE y se manda solo cuando vuelve
     6) pase vencido en la base: vuelve el código de la TV, el toque espera en la cola y sale con el pase nuevo
        6b) la pieza se elige por su ETIQUETA corta (como la tablet de GP2 desde el 07/10) y viaja como comp_salida_id
     7) base caída al abrir: se abre con el catálogo guardado en el celular y sin pase se puede cargar (queda en la cola, con aviso)
        hasta que vuelve y se ingresa el código
     8) rollos (Fase 1c): sólo si el catálogo trae rollos_activos; elegir rollo en E y «CT» / «PR quedó resto» de Eduardo; sin señal esperan
        en su cola y salen en orden; ANTI-DUPLICADO (Fase 1d): si la base lo hizo pero la respuesta se perdió, el reintento lleva el MISMO
        id y no descuenta otro rollo
    10) v3.1.9, la botonera de Registro Producción 2.0: botones por tipo de operario; con un tiempo muerto abierto sólo ése; PM tiempo
        muerto con aviso; 501 en kilos; RM con su recorrido; CM con balancín; cartel del alimentador; PCM; WhatsApp sin legajo 0;
        llegada tarde con la hora de cada uno; legajo nuevo actualiza el catálogo; el FJ no se borra
    11) v3.1.10: contador de cajón (lo que falta, «cajón completo»); error de envío a la auditoría y reintento solo cada 3 s; Terminar
        Día como 2.0 (último cajón, tiempo muerto abierto, FJ con id fijo que pisa al anterior y lleva el día entero, reenvío del día);
        «¿seguís mañana?» y al día siguiente «⚡ Continuar» (cajón continuado con lo de ayer; otro botón pide el código de Logística);
        la cola copiada al IndexedDB para el service worker y lo que él mandó se da por enviado
     9) NO se llama a nada de GP2 (registro_operarios_bundle, registrar_evento_prod, anular_evento_prod, tomar_rollo, cerrar_rollo)
   Sale 1 si falla. */
const fs = require("fs");
const path = require("path");
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
const CODIGO_TV = "4821";
const GP2_FNS = /\/rpc\/(registro_operarios_bundle|registrar_evento_prod|anular_evento_prod|tomar_rollo|cerrar_rollo|fabricar_stock)/;

const BUNDLE = {
  empleados: {
    "999": { nombre: "Prueba Operario", activo: true, hora_entrada: "08:30:00" },
    "19": { nombre: "Eduardo Prueba", activo: true, hora_entrada: "08:30:00", es_alimentador: true, ve_cm: true },
  },
  matrices: [
    { n: "10", d: "Varilla c/ Cuchilla", ppk: 1, uxg: 2, maq: "", act: true },
    { n: "322", d: "Env Espatula NY", ppk: 1, uxg: 1, maq: "", act: true },
  ],
  registro_en_golpes: true,
  // la 322 saca 2 piezas con etiqueta corta (GP2.matriz_salida_etiqueta): el operario ve sólo «LK» / «CH»
  matriz_salidas: { "322": [
    { comp_id: 1, codigo: "394", descripcion: "394 Terminado", arts: "394", etiqueta: "LK" },
    { comp_id: 2, codigo: "842", descripcion: "842 Terminado", arts: "842", etiqueta: "CH" },
  ] },
  matriz_fleje: {}, matriz_fleje_pieza: {}, envasado: {}, rollos_saldo: [], rollos_abiertos: {},
};
// Catálogo de la Fase 1c: trae `rollos_activos` y los flejes (la 10 corta del fleje 100; hay 4 rollos de 25 kg)
const BUNDLE_ROLLOS = Object.assign({}, BUNDLE, {
  rollos_activos: true,
  rollos_antiduplicado: true,
  matriz_fleje: { "10": { comp_id: 100, codigo: "FL94", descripcion: "Fleje 94" } },
  rollos_saldo: [{ comp_id: 100, codigo: "FL94", kg_por_rollo: 25, rollos: 4 }],
});
// v3.1.9 — la botonera de 2.0: permisos por tipo de operario (public."Empleados"), su hora de entrada, matriz de alimentador (tipo A),
// la 501 en kilos (tu = kg), una matriz sin tiempo histórico y los balancines.
const BUNDLE_20 = Object.assign({}, BUNDLE, {
  empleados: {
    "999": { nombre: "Operario Base", activo: true, hora_entrada: "00:01:00" },
    "19": { nombre: "Eduardo Prueba", activo: true, hora_entrada: "00:01:00", es_alimentador: true, ve_cm: true },
    "91": { nombre: "Matricero Prueba", activo: true, es_matriceria: true, ve_cm: true, ve_trm: true, ve_tl: true, ve_rem: true },
    "92": { nombre: "Piedra Prueba", activo: true, es_piedra: true },
    "233": { nombre: "Piedra con CM", activo: true, es_piedra: true, ve_cm: true, ve_mm: true },
    "0": { nombre: "Prueba (TESTING)", activo: true, hora_entrada: "00:01:00" },
    "556": { nombre: "Entra Tarde", activo: true, hora_entrada: "23:59:00" },
  },
  matrices: [
    { n: "10", d: "Varilla c/ Cuchilla", ppk: 1, uxg: 2, maq: "", act: true, th: 6.3 },
    { n: "71", d: "Corte Arandela Grande", ppk: 1, uxg: 3, maq: "alimentador", act: true, tipo: "A", th: 5 },
    { n: "99", d: "Matriz sin tiempo", ppk: 1, uxg: 1, maq: "", act: true, th: null },
    { n: "501", d: "Afilado Cuchilla", ppk: null, uxg: 1, maq: "", act: true, tipo: "P", th: 7650, tu: "kg" },
  ],
  balancines: [{ num: "1", tipo: "Balancin", matriz: null }, { num: "2", tipo: "Balancin", matriz: null }],
});
const ARTICULOS = { "322": [{ pieza_codigo: "394", pieza_desc: "394 Terminado", arts: [{ codigo: "394", nombre: "Espátula Lisa Nylon 1 Pza", marca: "LOEKE" }] }] };

(async () => {
  const srv = await servir();
  const b = await chromium.launch();
  const errs = [];
  const res = [];
  const chequeo = (n, ok) => { res.push([n, !!ok]); if (!ok) console.log("  ✗ " + n); };
  const esperar = async (cond, ms = 8000) => { for (let t = 0; t < ms; t += 100) { if (await cond()) return true; await pausa(100); } return false; };

  // La «base»: lo que hay que recordar entre pedidos.
  function nuevaBase() {
    return {
      paseValido: "PASE.OK1",        // el único pase que acepta hoy
      paseNuevo: "PASE.OK1",         // el que entrega al ingresar el código
      vence: new Date(Date.now() + 3 * 3600 * 1000).toISOString(),
      caida: false,                  // true = sin respuesta (como sin señal)
      bundle: BUNDLE,                // lo que devuelve reg_prod_3_0_bundle (hoy sin rollos; la Fase 1c los trae)
      rollos: [],                    // llamadas aceptadas de tomar/cerrar rollo (una por id)
      entregas: [],                  // todo lo que llegó de rollos, con los repetidos
      perderRespuesta: false,        // true = la base lo hace pero la respuesta no llega al celular (una vez)
      llamadas: [],                  // { fn, perfil, cuerpo }
      eventos: [],                   // cuerpos de reg_prod_3_0_registrar_evento aceptados
      anulados: [],
      anularRechazo: false,          // true = la base rechaza la baja por los datos (P0001)
      wa: [],                        // avisos de WhatsApp (Edge Function send-whatsapp)
      balancines: [],                // reg_prod_3_0_asignar_matriz_balancin aceptados
      erroresEnvio: [],              // reg_prod_3_0_registrar_error_envio (sin pase)
      contador: {},                  // contador de cajón por pieza (como reg_prod_3_0.contador_cajon)
      fjPisados: 0,                  // fines de jornada que pisaron a uno anterior (mismo id)
      falla500: false,               // true = registrar_evento contesta 500 (base caída a medias)
      bundleFalla: false,            // true = reg_prod_3_0_bundle contesta 503 (base caída: el catálogo no baja)
    };
  }
  const llamadas = (base, fn) => base.llamadas.filter((c) => c.fn === fn);

  async function contexto(base, extraInit) {
    const ctx = await b.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 800 } });
    ctx.setDefaultTimeout(8000);
    if (extraInit) await ctx.addInitScript(extraInit);
    await ctx.route("**/*.supabase.co/**", async (route) => {
      const req = route.request(); const url = req.url(); const m = req.method();
      const json = (status, body) => route.fulfill({ status, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify(body) });
      if (m === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
      if (base.caida) return route.abort("failed");
      const fn = (url.match(/\/rpc\/([a-z0-9_]+)/i) || [])[1] || "";
      let cuerpo = {};
      try { cuerpo = JSON.parse(req.postData() || "{}"); } catch { /* sin cuerpo */ }
      if (/\/functions\/v1\/send-whatsapp/.test(url)) { base.wa.push(cuerpo); return json(200, { ok: true }); }
      base.llamadas.push({ fn, perfil: req.headers()["content-profile"] || "", cuerpo, url });
      const paseMal = () => json(400, { code: "28000", details: null, hint: null, message: "Pase inválido o vencido" });
      const conPase = cuerpo.p_pase === base.paseValido && !!cuerpo.p_dispositivo;
      if (fn === "reg_prod_3_0_cerv_ingresar") {
        if (cuerpo.p_clave === CODIGO_TV) return json(200, { ok: true, nombre: null, pase: base.paseNuevo, vence: base.vence });
        return json(200, { ok: false, error: "codigo" });
      }
      if (fn === "reg_prod_3_0_registrar_ingreso") return json(200, 1);
      if (fn === "reg_prod_3_0_bundle") {
        if (base.bundleFalla) return json(503, { code: "PGRST000", details: null, hint: null, message: "base caída" });
        return conPase ? json(200, base.bundle) : paseMal();
      }
      if (["reg_prod_3_0_tomar_rollo", "reg_prod_3_0_cerrar_rollo", "reg_prod_3_0_rollo_tomar", "reg_prod_3_0_rollo_cerrar"].includes(fn)) {
        if (!conPase) return paseMal();
        base.entregas.push({ fn, cuerpo });
        const repetido = !!cuerpo.p_id && base.rollos.some((r) => r.cuerpo.p_id === cuerpo.p_id);   // como reg_prod_3_0.rollo_llamadas
        if (!repetido) base.rollos.push({ fn, cuerpo });
        if (base.perderRespuesta) { base.perderRespuesta = false; return route.abort("failed"); }
        return json(200, repetido ? { ok: true, dup: true } : { ok: true });
      }
      if (fn === "reg_prod_3_0_asignar_matriz_balancin") {
        if (!conPase) return paseMal();
        base.balancines.push(cuerpo);
        return json(200, { ok: true, balancin: cuerpo.p_balancin, matriz: cuerpo.p_matriz });
      }
      if (fn === "reg_prod_3_0_envasado_articulos") return conPase ? json(200, ARTICULOS) : paseMal();
      if (fn === "reg_prod_3_0_registrar_error_envio") { base.erroresEnvio.push(cuerpo); return json(200, true); }
      if (fn === "reg_prod_3_0_contador_cajon") {
        if (!conPase) return paseMal();
        const caj = (base.bundle.cajon || {})[String(cuerpo.p_n_matriz)] || {};
        const out = {};
        Object.keys(caj).forEach((k) => { out[k] = Object.assign({}, caj[k], { act: base.contador[k] != null ? base.contador[k] : caj[k].act }); });
        return json(200, out);
      }
      if (fn === "reg_prod_3_0_registrar_evento") {
        if (!conPase) return paseMal();
        if (base.falla500) return json(500, { code: "XX000", details: null, hint: null, message: "base caída" });
        const id = String(cuerpo.p && cuerpo.p.id_ejecucion);
        const previo = base.eventos.findIndex((e) => String(e.p.id_ejecucion) === id);
        if (previo >= 0 && cuerpo.p.toque && cuerpo.p.toque.opcion === "FJ") {   // como la fase 2c: un FJ nuevo pisa al anterior
          base.eventos[previo] = cuerpo; base.fjPisados++;
          return json(200, { ok: true, id: previo + 1, fj_pisado: true });
        }
        if (previo >= 0) return json(200, { ok: true, id, dup: true });
        base.eventos.push(cuerpo);
        // contador de cajón (fase 2c): C/CT de una matriz con contador suman; al llegar (o con «cajón completo») vuelve a 0
        let cajon = null;
        const caj = (base.bundle.cajon || {})[String(cuerpo.p.matriz)];
        if (caj && cuerpo.p.toque && ["C", "CT"].includes(cuerpo.p.toque.opcion)) {
          const k = Object.keys(caj)[0];
          const uxg = ((base.bundle.matrices || []).find((m) => m.n === cuerpo.p.matriz) || {}).uxg || 1;
          const uni = cuerpo.p.uni > 0 ? cuerpo.p.uni : (cuerpo.p.golpes || 0) * uxg;
          const antes = base.contador[k] != null ? base.contador[k] : caj[k].act;
          const completo = !!cuerpo.p.cajon_completo || antes + uni >= caj[k].uxc;
          base.contador[k] = completo ? 0 : antes + uni;
          cajon = { comp_id: Number(k), uxc: caj[k].uxc, antes, act: base.contador[k], completo };
        }
        return json(200, { ok: true, id: base.eventos.length, premio: 0.5, uni: 0, cajon });
      }
      if (fn === "reg_prod_3_0_anular_evento") {
        if (!conPase) return paseMal();
        if (base.anularRechazo) return json(400, { code: "P0001", details: null, hint: null, message: "no se puede anular" });
        base.anulados.push(cuerpo.p_id_ejecucion);
        return json(200, { ok: true, anulados: 1 });
      }
      if (fn) return json(404, { code: "PGRST202", message: "function not found: " + fn });
      if (m === "GET") return json(200, []);
      return json(201, []);
    });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errs.push(e.message));
    p.on("dialog", (d) => d.accept().catch(() => {}));
    return { ctx, p };
  }

  const entrarConCodigo = async (p, codigo) => {
    await p.waitForSelector("#tvClaveModal", { state: "visible" });
    await p.fill("#tvClaveInput", codigo);
    await p.click("#tvClaveOk");
  };
  const ponerLegajo = async (p, leg) => {
    await p.fill("#legajoInput", leg);
    await p.click("#btnContinuar");
    await p.waitForSelector("#optionsScreen:not(.hidden)");
  };
  const enviarOpcion = async (p, code, valor) => {
    await p.click(`.box[data-code="${code}"]`);
    if (valor != null) await p.fill("#textInput", valor);
    await p.click("#btnEnviar");
    await p.waitForSelector("#legajoScreen:not(.hidden)");
  };

  // ============ 1) código de la TV → pase → catálogo ============
  const base = nuevaBase();
  const { ctx, p } = await contexto(base);
  await p.goto(srv.url + "/cervantes-gp2/", { waitUntil: "domcontentloaded" });
  await p.waitForSelector("#tvClaveModal", { state: "visible" });
  chequeo("1 sin pase aparece la pantalla del código de la TV", true);
  chequeo("1 no se pidió el catálogo antes de tener pase", llamadas(base, "reg_prod_3_0_bundle").length === 0);
  await p.fill("#tvClaveInput", "0000");
  await p.click("#tvClaveOk");
  await esperar(() => p.evaluate(() => /incorrecto/i.test(document.getElementById("tvClaveError")?.textContent || "")));
  chequeo("1 código malo: avisa y la pantalla sigue", await p.isVisible("#tvClaveModal") && /incorrecto/i.test(await p.textContent("#tvClaveError")));
  await p.fill("#tvClaveInput", CODIGO_TV);
  await p.click("#tvClaveOk");
  await p.waitForSelector("#tvClaveModal", { state: "detached" });
  await esperar(() => p.evaluate(() => typeof D !== "undefined" && !!(D.empleados && D.empleados["999"])));
  const idEquipo = await p.evaluate(() => localStorage.getItem("gv_dispositivo"));
  const ing = llamadas(base, "reg_prod_3_0_cerv_ingresar").pop();
  chequeo("1 el código viaja con el id del equipo", !!ing && ing.cuerpo.p_clave === CODIGO_TV && ing.cuerpo.p_dispositivo === idEquipo && idEquipo.length >= 8);
  chequeo("1 las funciones se llaman en el schema reg_prod_3_0", llamadas(base, "reg_prod_3_0_bundle").every((c) => c.perfil === "reg_prod_3_0") && ing.perfil === "reg_prod_3_0");
  const bun = llamadas(base, "reg_prod_3_0_bundle").pop();
  chequeo("1 el catálogo se pide con el pase y el equipo", !!bun && bun.cuerpo.p_pase === "PASE.OK1" && bun.cuerpo.p_dispositivo === idEquipo);
  chequeo("1 el pase y el catálogo quedan guardados en el celular", await p.evaluate(() => !!JSON.parse(localStorage.getItem("rp3c_pase") || "null")?.pase && !!JSON.parse(localStorage.getItem("rp3c_bundle") || "null")?.data?.matrices));
  chequeo("1 ya no pide los nombres de artículo (GP2 los cambió por la etiqueta)", llamadas(base, "reg_prod_3_0_envasado_articulos").length === 0);

  // ============ 2) la botonera de GP2 ============
  await p.fill("#legajoInput", "12345");
  await p.click("#btnContinuar");
  await pausa(300);
  chequeo("2 un legajo que no está en el catálogo no entra", await p.isVisible("#legajoScreen"));
  await ponerLegajo(p, "999");
  const codigos = await p.$$eval(".box", (els) => els.map((e) => e.dataset.code));
  // v3.1.9: cada uno ve los de SU tipo, como 2.0 (el 999 no tiene permisos: operario base)
  chequeo("2 el operario base ve los 12 botones de 2.0", JSON.stringify(codigos) === JSON.stringify(["E", "C", "PB", "BC", "MOV", "LIMP", "Perm", "AL", "PC", "PM", "RM", "PCM"]));
  await esperar(() => llamadas(base, "reg_prod_3_0_registrar_ingreso").length > 0);
  const reg = llamadas(base, "reg_prod_3_0_registrar_ingreso")[0];
  chequeo("2 el legajo se anota en el equipo (1 vez), sin pase", !!reg && reg.cuerpo.p_legajo === "999" && reg.cuerpo.p_dispositivo === idEquipo && reg.cuerpo.p_app === "cervantes" && !("p_pase" in reg.cuerpo));
  await p.click("#btnBackTop");
  await ponerLegajo(p, "999");
  await pausa(200);
  chequeo("2 al volver a entrar con el mismo legajo no se anota otra vez", llamadas(base, "reg_prod_3_0_registrar_ingreso").length === 1);
  await p.click("#btnBackTop");
  await ponerLegajo(p, "19");
  chequeo("2 Eduardo (19) no tiene CT si el catálogo no trae rollos_activos", (await p.$$eval(".box", (els) => els.map((e) => e.dataset.code))).indexOf("CT") === -1);
  await p.click("#btnBackTop");
  await ponerLegajo(p, "999");

  // ============ 3) E y C ============
  await enviarOpcion(p, "E", "10");
  await esperar(() => base.eventos.some((e) => e.p.toque.opcion === "E"));
  const e1 = base.eventos.find((e) => e.p.toque.opcion === "E");
  chequeo("3 el E llega con el pase y el equipo", !!e1 && e1.p_pase === "PASE.OK1" && e1.p_dispositivo === idEquipo);
  chequeo("3 el E lleva la matriz, el legajo y 0 unidades", !!e1 && e1.p.matriz === "10" && e1.p.legajo === "999" && e1.p.uni === 0);
  chequeo("3 el toque crudo viaja adentro (opción, texto, hora y versión)", !!e1 && e1.p.toque.texto === "10" && !!e1.p.toque.ts_event && e1.p.toque.app_version === "v3.1.13" && e1.p.toque.id === e1.p.id_ejecucion);
  await ponerLegajo(p, "999");
  await enviarOpcion(p, "C", "120");
  await esperar(() => base.eventos.some((e) => e.p.toque.opcion === "C"));
  const c1 = base.eventos.find((e) => e.p.toque.opcion === "C");
  chequeo("3 el C manda los GOLPES tal cual (la base los multiplica)", !!c1 && c1.p.golpes === 120 && c1.p.matriz === "10" && c1.p.uni === undefined);
  chequeo("3 el C lleva los segundos trabajados y la hora de inicio", !!c1 && typeof c1.p.segundos_trabajados === "number" && !!c1.p.hora_inicio && !!c1.p.toque.hs_inicio);

  // ============ 4) historial y anular ============
  await esperar(() => p.evaluate(() => (document.getElementById("daySummary").textContent.match(/ENVIADO/g) || []).length >= 2));
  chequeo("4 el historial marca los toques como ENVIADO", await p.evaluate(() => (document.getElementById("daySummary").textContent.match(/ENVIADO/g) || []).length >= 2));
  await p.fill("#legajoInput", "999");
  await p.locator("#daySummary .hist-del").first().click();      // el de arriba = el último (C)
  await esperar(() => base.anulados.length > 0);
  chequeo("4 el 🗑 anula en la base con el id del toque", base.anulados[0] === c1.p.id_ejecucion);
  const anu = llamadas(base, "reg_prod_3_0_anular_evento").pop();
  chequeo("4 la anulación va con pase y equipo", !!anu && anu.cuerpo.p_pase === "PASE.OK1" && anu.cuerpo.p_dispositivo === idEquipo && anu.perfil === "reg_prod_3_0");

  // ============ 5) sin señal ============
  await ponerLegajo(p, "999");
  base.caida = true;                                          // sin señal: los pedidos a la base no responden
  const antes = base.eventos.length;
  await enviarOpcion(p, "PB");
  await esperar(() => p.evaluate(() => /sin enviar/.test(document.getElementById("syncBadge").textContent)), 6000);
  chequeo("5 sin señal el toque queda en la cola (el badge lo dice)", await p.evaluate(() => /1 sin enviar/.test(document.getElementById("syncBadge").textContent)) && base.eventos.length === antes);
  chequeo("5 y figura PENDIENTE (no ERROR)", await p.evaluate(() => /PENDIENTE/.test(document.getElementById("daySummary").textContent) && !/ERROR/.test(document.getElementById("daySummary").textContent)));
  base.caida = false;
  await p.click("#syncBadge");
  await esperar(() => base.eventos.length === antes + 1);
  chequeo("5 al volver la señal se manda con su hora original", base.eventos.length === antes + 1 && base.eventos[antes].p.toque.opcion === "PB");
  await esperar(() => p.evaluate(() => /al día/.test(document.getElementById("syncBadge").textContent)));
  chequeo("5 y la cola queda vacía", await p.evaluate(() => /al día/.test(document.getElementById("syncBadge").textContent)));

  // ============ 6) pase vencido en la base ============
  base.paseValido = "PASE.OK2"; base.paseNuevo = "PASE.OK2";   // el pase que tiene el celular ya no sirve
  await ponerLegajo(p, "999");
  const antes6 = base.eventos.length;
  await p.click('.box[data-code="PB"]');                       // cierra el tiempo muerto abierto en 5
  await p.click("#btnEnviar");
  await p.waitForSelector("#tvClaveModal", { state: "visible" });
  chequeo("6 la base rechaza el pase y vuelve la pantalla del código", true);
  chequeo("6 el toque espera en la cola (no se perdió)", base.eventos.length === antes6 && await p.evaluate(() => JSON.parse(localStorage.getItem("rp3c_queue") || "[]").length === 1));
  chequeo("6 el pase viejo se descartó", await p.evaluate(() => !localStorage.getItem("rp3c_pase")));
  await p.fill("#tvClaveInput", CODIGO_TV);
  await p.click("#tvClaveOk");
  await p.waitForSelector("#tvClaveModal", { state: "detached" });
  await esperar(() => base.eventos.length === antes6 + 1);
  chequeo("6 con el código nuevo sale lo que estaba en la cola, con el pase nuevo", base.eventos.length === antes6 + 1 && base.eventos[antes6].p_pase === "PASE.OK2");
  await esperar(() => p.evaluate(() => /al día/.test(document.getElementById("syncBadge").textContent)));
  chequeo("6 y la cola queda vacía", await p.evaluate(() => /al día/.test(document.getElementById("syncBadge").textContent)));

  // ============ 6b) pieza con etiqueta (como GP2 desde el 07/10) ============
  await ponerLegajo(p, "19");
  await p.click('.box[data-code="E"]');
  // [Elías, 08/10: «que si no escribo nada no aparezca nada; después de la 1.ª letra aparezcan cosas»]
  chequeo("6b sin nada escrito la lista de matrices está vacía y sin rótulo", (await p.locator("#matrizGrid .mz").count()) === 0 && !(await p.isVisible("#matrizPicker .mp-label")));
  await p.type("#textInput", "3");
  await p.waitForSelector("#matrizGrid .mz");
  chequeo("6b con la 1.ª letra o número aparecen las que coinciden", (await p.locator('#matrizGrid .mz[data-n="322"]').count()) === 1 && (await p.isVisible("#matrizPicker .mp-label")));
  await p.fill("#textInput", "");
  await p.dispatchEvent("#textInput", "input");
  chequeo("6b al borrar lo escrito la lista vuelve a quedar vacía", (await p.locator("#matrizGrid .mz").count()) === 0);
  await p.fill("#textInput", "322");
  await p.waitForSelector("#piezaGrid .mz");
  const tarjetas = (await p.locator("#piezaGrid .mz").allInnerTexts()).map((t) => t.trim());
  chequeo("6b la pieza se elige por su etiqueta y la tarjeta dice sólo eso", JSON.stringify(tarjetas) === JSON.stringify(["LK", "CH"]));
  await p.click("#piezaGrid .mz >> nth=1");
  await p.waitForSelector("#piezaGrid .pieza-cambiar");
  chequeo("6b elegida, la línea dice «Fabricás CH»", /Fabricás CH/.test(await p.textContent("#piezaGrid .pieza-cambiar")));
  chequeo("6b y la tarjeta de la matriz lleva la etiqueta", /CH/.test(await p.textContent('#matrizGrid .mz[data-n="322"] .mz-chip')));
  await p.click("#btnEnviar");
  await p.waitForSelector("#legajoScreen:not(.hidden)");
  await esperar(() => base.eventos.some((e) => e.p.toque.opcion === "E" && e.p.matriz === "322"));
  const e322 = base.eventos.find((e) => e.p.toque.opcion === "E" && e.p.matriz === "322");
  chequeo("6b el E lleva la pieza elegida (comp_salida_id), que decide dónde va el stock", !!e322 && e322.p.comp_salida_id === 2);
  await ponerLegajo(p, "19");
  await p.click('.box[data-code="C"]');
  chequeo("6b en el C la matriz activa dice «Pieza: CH»", /Pieza: CH/.test(await p.textContent("#matrizInfo")));
  await p.fill("#textInput", "5");
  await p.click("#btnEnviar");
  await p.waitForSelector("#legajoScreen:not(.hidden)");
  await esperar(() => base.eventos.some((e) => e.p.toque.opcion === "C" && e.p.matriz === "322"));
  chequeo("6b el C de la 322 también lleva la pieza", (base.eventos.find((e) => e.p.toque.opcion === "C" && e.p.matriz === "322") || { p: {} }).p.comp_salida_id === 2);

  // ============ 6c) 🗑 sin señal: la baja queda en cola, UNA vez, y sale DESPUÉS de los eventos ============
  // [Elías, 07/10: «en cola, pero asegurate de que no tenga o no se tome su duplicado»]
  await esperar(() => p.evaluate(() => /al día/.test(document.getElementById("syncBadge").textContent) && /ENVIADO/.test(document.getElementById("daySummary").textContent)));
  const idC322 = base.eventos.find((e) => e.p.toque.opcion === "C" && e.p.matriz === "322").p.id_ejecucion;
  const colaBajas = () => p.evaluate(() => JSON.parse(localStorage.getItem("rp3c_aqueue") || "[]"));
  const enHistorial = (id) => p.evaluate((x) => readState("19").last2.some((i) => i.id === x), id);
  await p.fill("#legajoInput", "19");
  await p.waitForSelector("#daySummary .hist-del");
  base.caida = true;
  const anuAntes = base.anulados.length;
  await p.locator("#daySummary .hist-del").first().click();          // el de arriba = el C de la 322, ya ENVIADO
  await esperar(async () => (await colaBajas()).length === 1);
  chequeo("6c 🗑 sin señal: no hay que repetirlo, la baja queda en su cola", JSON.stringify(await colaBajas()) === JSON.stringify([idC322]));
  chequeo("6c y el toque sale del historial", !(await enHistorial(idC322)));
  chequeo("6c el badge cuenta la baja pendiente", await p.evaluate(() => /1 sin enviar/.test(document.getElementById("syncBadge").textContent)));
  await p.evaluate((id) => enqueueAnular(id), idC322);                // otro 🗑 o un reintento no la duplica
  chequeo("6c la misma baja no se anota dos veces", (await colaBajas()).length === 1);
  await ponerLegajo(p, "19");
  await enviarOpcion(p, "PB");                                         // un toque nuevo, también sin señal
  await esperar(() => p.evaluate(() => /2 sin enviar/.test(document.getElementById("syncBadge").textContent)));
  base.caida = false;
  const desde6c = base.llamadas.length;
  await p.click("#syncBadge");
  await esperar(() => base.anulados.length === anuAntes + 1);
  const orden6c = base.llamadas.slice(desde6c).map((c) => c.fn);
  chequeo("6c con señal sale primero el toque y después la baja", orden6c.indexOf("reg_prod_3_0_registrar_evento") > -1 && orden6c.indexOf("reg_prod_3_0_registrar_evento") < orden6c.indexOf("reg_prod_3_0_anular_evento"));
  chequeo("6c la baja llega con el id del toque", base.anulados[anuAntes] === idC322);
  await esperar(() => p.evaluate(() => /al día/.test(document.getElementById("syncBadge").textContent)));
  await p.click("#syncBadge"); await pausa(400);
  chequeo("6c y llega UNA sola vez (la cola queda vacía)", base.anulados.length === anuAntes + 1 && (await colaBajas()).length === 0);
  // rechazo de la base por los datos: avisa y NO se borra de la pantalla (quedaría vivo en la base)
  const idPB = base.eventos[base.eventos.length - 1].p.id_ejecucion;
  await p.fill("#legajoInput", "19");
  await esperar(() => p.evaluate(() => /ENVIADO/.test(document.getElementById("daySummary").textContent)));
  base.anularRechazo = true;
  await p.locator("#daySummary .hist-del").first().click();          // el PB recién enviado
  await esperar(() => llamadas(base, "reg_prod_3_0_anular_evento").some((c) => c.cuerpo.p_id_ejecucion === idPB));
  await pausa(300);
  chequeo("6c baja rechazada por la base: el toque sigue en el historial y no va a la cola", (await enHistorial(idPB)) && (await colaBajas()).length === 0);
  base.anularRechazo = false;

  // ============ 7) base caída ============
  // 7a) con pase y catálogo guardados: se abre igual
  base.caida = true;
  const storage = await ctx.storageState();
  await p.close();
  const p2 = await ctx.newPage();
  p2.on("pageerror", (e) => errs.push(e.message));
  p2.on("dialog", (d) => d.accept().catch(() => {}));
  await p2.goto(srv.url + "/cervantes-gp2/", { waitUntil: "domcontentloaded" });
  await p2.waitForSelector("#legajoScreen", { state: "visible" });
  await pausa(500);
  chequeo("7 con pase guardado y la base caída no pide el código", !(await p2.locator("#tvClaveModal").count()));
  await esperar(() => p2.evaluate(() => typeof D !== "undefined" && !!(D.empleados && D.empleados["999"])));
  chequeo("7 el catálogo sale de lo guardado en el celular", await p2.evaluate(() => !!(D.empleados && D.empleados["999"]) && D.matricesMap && D.matricesMap.has("10")));
  await ponerLegajo(p2, "999");
  chequeo("7 se puede entrar con el legajo sin conexión con la base", await p2.isVisible("#optionsScreen"));
  await p2.close();

  // 7b) sin pase y la base caída: se puede cargar, queda en la cola con aviso
  const base2 = nuevaBase(); base2.caida = true;
  const { ctx: ctx2, p: p3 } = await contexto(base2);
  await p3.goto(srv.url + "/cervantes-gp2/", { waitUntil: "domcontentloaded" });
  await entrarConCodigo(p3, CODIGO_TV);
  await p3.waitForSelector("#tvClaveModal", { state: "detached" });
  await p3.waitForSelector("#legajoScreen", { state: "visible" });
  chequeo("7 sin poder verificar el código, la pantalla se va y se puede cargar", true);
  await p3.evaluate((d) => { localStorage.setItem("rp3c_bundle", JSON.stringify({ at: new Date().toISOString(), data: d })); }, BUNDLE);
  await p3.reload({ waitUntil: "domcontentloaded" });
  await entrarConCodigo(p3, CODIGO_TV);                      // sin pase, al abrir vuelve a pedir el código (la base sigue caída)
  await p3.waitForSelector("#tvClaveModal", { state: "detached" });
  await p3.waitForSelector("#legajoScreen", { state: "visible" });
  await esperar(() => p3.evaluate(() => typeof D !== "undefined" && !!(D.empleados && D.empleados["999"])));
  await ponerLegajo(p3, "999");
  await enviarOpcion(p3, "E", "10");
  await esperar(() => p3.evaluate(() => !!document.getElementById("redAviso")));
  chequeo("7 el toque queda en la cola y hay un aviso para ingresar el código", await p3.isVisible("#redAvisoBtn") && /esperan el código/.test(await p3.textContent("#redAvisoTxt")) && base2.eventos.length === 0);
  chequeo("7 el badge dice que esperan el código", await p3.evaluate(() => /esperan el código/.test(document.getElementById("syncBadge").textContent)));
  base2.caida = false;
  await p3.click("#redAvisoBtn");
  await entrarConCodigo(p3, CODIGO_TV);
  await p3.waitForSelector("#tvClaveModal", { state: "detached" });
  await esperar(() => base2.eventos.some((e) => e.p.toque.opcion === "E"));   // (antes puede salir el LT «llegada tarde», según la hora)
  if (process.env.TRAZA) console.log("   · base2:", JSON.stringify(base2.llamadas.map((c) => c.fn)), JSON.stringify(base2.eventos.map((e) => [e.p.toque.opcion, e.p_pase])));
  chequeo("7 al volver la base y poner el código, sale lo cargado sin conexión", base2.eventos.some((e) => e.p.toque.opcion === "E") && base2.eventos.every((e) => e.p_pase === "PASE.OK1"));
  await esperar(() => p3.evaluate(() => !document.getElementById("redAviso")));
  chequeo("7 y el aviso desaparece", await p3.evaluate(() => !document.getElementById("redAviso")));
  await ctx2.close();

  // ============ 8) rollos (Fase 1c) ============
  const base3 = nuevaBase(); base3.bundle = BUNDLE_ROLLOS;
  const { ctx: ctx3, p: p4 } = await contexto(base3);
  await p4.goto(srv.url + "/cervantes-gp2/", { waitUntil: "domcontentloaded" });
  await entrarConCodigo(p4, CODIGO_TV);
  await p4.waitForSelector("#tvClaveModal", { state: "detached" });
  await esperar(() => p4.evaluate(() => typeof D !== "undefined" && !!(D.empleados && D.empleados["999"]) && D.rollos_activos === true));
  await ponerLegajo(p4, "999");
  await p4.click('.box[data-code="E"]');
  await p4.fill("#textInput", "10");
  await p4.waitForSelector("#rolloGrid .rl");
  chequeo("8 con rollos_activos, al elegir la matriz 10 se ofrece el rollo de 25 kg del fleje 94", /25 kg/.test(await p4.textContent("#rolloGrid .rl")) && /FL94/.test(await p4.textContent("#rolloGrid .rl")));
  await p4.click("#rolloGrid .rl");
  await p4.click("#btnEnviar");
  await p4.waitForSelector("#legajoScreen:not(.hidden)");
  await esperar(() => base3.rollos.length === 1);
  const tom = base3.rollos[0];
  chequeo("8 el E con rollo llama a tomar_rollo con legajo, fleje, kg y matriz", !!tom && tom.fn === "reg_prod_3_0_rollo_tomar" && !!tom.cuerpo.p_id && tom.cuerpo.p_legajo === "999" && tom.cuerpo.p_comp_id === 100 && tom.cuerpo.p_kg_por_rollo === 25 && tom.cuerpo.p_matriz === "10" && !!tom.cuerpo.p_fecha);
  chequeo("8 y va con pase y equipo", !!tom && tom.cuerpo.p_pase === "PASE.OK1" && !!tom.cuerpo.p_dispositivo);
  await esperar(() => base3.eventos.some((e) => e.p.toque.opcion === "E"));
  chequeo("8 el toque E sale igual", base3.eventos.some((e) => e.p.toque.opcion === "E" && e.p.matriz === "10"));
  // Eduardo: el CT y «quedó resto» existen sólo con rollos
  await p4.click("#btnBackTop").catch(() => {});
  await p4.fill("#legajoInput", "19"); await p4.click("#btnContinuar"); await p4.waitForSelector("#optionsScreen:not(.hidden)");
  chequeo("8 Eduardo (19) tiene el botón CT cuando hay rollos", (await p4.$$eval(".box", (els) => els.map((e) => e.dataset.code))).includes("CT"));
  await p4.click('.box[data-code="PR"]');
  chequeo("8 en PR aparece «¿quedó resto?»", await p4.isVisible("#quedoRestoWrap"));
  await p4.check("#quedoRestoChk");
  await p4.click("#btnEnviar");
  await p4.waitForSelector("#legajoScreen:not(.hidden)");
  await esperar(() => base3.rollos.length === 2);
  const cer = base3.rollos[1];
  chequeo("8 PR con «quedó resto» llama a cerrar_rollo con quedo_resto = true", !!cer && cer.fn === "reg_prod_3_0_rollo_cerrar" && !!cer.cuerpo.p_id && cer.cuerpo.p_legajo === "19" && cer.cuerpo.p_quedo_resto === true && cer.cuerpo.p_pase === "PASE.OK1");
  // sin señal: tomar y cerrar esperan en orden
  await ponerLegajo(p4, "999");
  await enviarOpcion(p4, "C", "10");                          // el cajón de la matriz abierta, para poder empezar otra
  await esperar(() => base3.eventos.some((e) => e.p.toque.opcion === "C"));
  await ponerLegajo(p4, "999");
  base3.caida = true;
  await p4.click('.box[data-code="E"]'); await p4.fill("#textInput", "10"); await p4.waitForSelector("#rolloGrid .rl"); await p4.click("#rolloGrid .rl");
  await p4.click("#btnEnviar"); await p4.waitForSelector("#legajoScreen:not(.hidden)");
  await esperar(() => p4.evaluate(() => JSON.parse(localStorage.getItem("rp3c_rqueue") || "[]").length === 1));
  chequeo("8 sin señal el tomar_rollo espera en su cola y el badge lo cuenta", await p4.evaluate(() => JSON.parse(localStorage.getItem("rp3c_rqueue") || "[]").length === 1 && /sin enviar/.test(document.getElementById("syncBadge").textContent)) && base3.rollos.length === 2);
  base3.caida = false;
  await p4.click("#syncBadge");
  await esperar(() => base3.rollos.length === 3);
  chequeo("8 al volver la señal sale el tomar_rollo guardado, con su fecha original", base3.rollos.length === 3 && base3.rollos[2].fn === "reg_prod_3_0_rollo_tomar" && !!base3.rollos[2].cuerpo.p_fecha);
  await esperar(() => p4.evaluate(() => JSON.parse(localStorage.getItem("rp3c_rqueue") || "[]").length === 0 && /al día/.test(document.getElementById("syncBadge").textContent)));
  // la base hizo el «tomar» pero la respuesta se perdió: el reintento lleva el MISMO id y no descuenta otro rollo
  await esperar(() => p4.evaluate(() => /al día/.test(document.getElementById("syncBadge").textContent)));
  await ponerLegajo(p4, "999");
  await enviarOpcion(p4, "C", "10");
  await esperar(() => p4.evaluate(() => /al día/.test(document.getElementById("syncBadge").textContent)));
  await ponerLegajo(p4, "999");
  const nRollos = base3.rollos.length, nEntregas = base3.entregas.length;
  base3.perderRespuesta = true;
  await p4.click('.box[data-code="E"]'); await p4.fill("#textInput", "10"); await p4.waitForSelector("#rolloGrid .rl"); await p4.click("#rolloGrid .rl");
  await p4.click("#btnEnviar"); await p4.waitForSelector("#legajoScreen:not(.hidden)");
  await esperar(() => base3.entregas.length === nEntregas + 1);
  await esperar(() => p4.evaluate(() => JSON.parse(localStorage.getItem("rp3c_rqueue") || "[]").length === 1));
  await p4.click("#syncBadge");
  await esperar(() => base3.entregas.length === nEntregas + 2);
  const [primera, reintento] = base3.entregas.slice(nEntregas);
  chequeo("8 respuesta perdida: el reintento lleva el MISMO id", !!primera && !!reintento && !!primera.cuerpo.p_id && primera.cuerpo.p_id === reintento.cuerpo.p_id);
  chequeo("8 y la base lo cuenta una sola vez (no descuenta otro rollo)", base3.rollos.length === nRollos + 1);
  await esperar(() => p4.evaluate(() => JSON.parse(localStorage.getItem("rp3c_rqueue") || "[]").length === 0));
  chequeo("8 y las colas quedan vacías", await p4.evaluate(() => JSON.parse(localStorage.getItem("rp3c_rqueue") || "[]").length === 0 && JSON.parse(localStorage.getItem("rp3c_queue") || "[]").length === 0));
  await ctx3.close();


  // ============ 10) la botonera de Registro Producción 2.0 (v3.1.9) ============
  // [Elías, 08/10: «2.0», «todo lo del 10 debería ser como Reg Prod», «la 501 pone los kilos», «no mandar si se está usando el legajo 0»]
  const base4 = nuevaBase(); base4.bundle = BUNDLE_20;
  const { ctx: ctx4, p: p5 } = await contexto(base4);
  await p5.goto(srv.url + "/cervantes-gp2/", { waitUntil: "domcontentloaded" });
  await entrarConCodigo(p5, CODIGO_TV);
  await p5.waitForSelector("#tvClaveModal", { state: "detached" });
  await esperar(() => p5.evaluate(() => typeof D !== "undefined" && !!(D.empleados && D.empleados["91"])));
  const botonesDe = async (leg) => {
    await p5.fill("#legajoInput", leg); await p5.click("#btnContinuar"); await p5.waitForSelector("#optionsScreen:not(.hidden)");
    const v = await p5.$$eval(".box", (els) => els.map((e) => e.dataset.code).join(" "));
    await p5.click("#btnBackTop");
    return v;
  };
  const eventosDe = (op) => base4.eventos.filter((e) => e.p.toque.opcion === op);
  const ultimo = (op) => eventosDe(op).slice(-1)[0];
  // 10a) cada uno ve los de SU tipo (la tabla de capsDe/botonVisible de 2.0)
  chequeo("10a alimentador: base + PR, RD y CM", (await botonesDe("19")) === "E C PB BC MOV LIMP Perm AL PR PC RD CM PM RM PCM");
  chequeo("10a matricería: sólo TRM, TL, CM y REM", (await botonesDe("91")) === "TRM TL CM REM");
  chequeo("10a piedra: MOV P en lugar de MOV", (await botonesDe("92")) === "E C PB BC LIMP Perm AL PC MOV P PM RM PCM");
  chequeo("10a piedra con ve_cm y ve_mm: suma MM y CM", (await botonesDe("233")) === "E C PB BC LIMP Perm AL PC MOV P MM CM PM RM PCM");
  // 10b) tiempo muerto abierto: sólo ése se puede tocar; volver al legajo no deja nada trabado
  await ponerLegajo(p5, "999");
  await enviarOpcion(p5, "PB");
  await ponerLegajo(p5, "999");
  const libres = await p5.$$eval(".box:not(.bloq)", (els) => els.map((e) => e.dataset.code).join(" "));
  chequeo("10b con PB abierto sólo PB se puede tocar (los demás grises)", libres === "PB" && /tiempo muerto abierto \(PB\)/.test(await p5.textContent("#avisoBotones")));
  await p5.click('.box[data-code="PB"]');
  await p5.click("#btnBackTop");
  await ponerLegajo(p5, "999");
  chequeo("10b volver al legajo y entrar de nuevo: nada queda elegido ni trabado", await p5.isHidden("#selectedArea") && (await p5.$$eval(".box:not(.bloq)", (els) => els.length)) === 1);
  await p5.click('.box[data-code="PB"]'); await p5.click("#btnEnviar"); await p5.waitForSelector("#legajoScreen:not(.hidden)");
  await esperar(() => eventosDe("PB").length === 2);
  chequeo("10b el 2.º PB cierra el tiempo muerto con su duración", eventosDe("PB").length === 2 && typeof eventosDe("PB")[1].p.segundos_tiempo_muerto === "number");
  // 10c) PM es tiempo muerto (como 2.0): abre con aviso «Paro Matriz», cierra midiendo
  await ponerLegajo(p5, "999");
  await enviarOpcion(p5, "E", "10");
  await ponerLegajo(p5, "999");
  await enviarOpcion(p5, "PM");
  await esperar(() => eventosDe("PM").length === 1 && base4.wa.length >= 1);
  chequeo("10c PM abre un tiempo muerto y avisa «Paro Matriz» por WhatsApp", eventosDe("PM").length === 1 && base4.wa.some((w) => w.parametros[0] === "Paro Matriz" && w.parametros[1] === "10"));
  await ponerLegajo(p5, "999");
  chequeo("10c con el PM abierto sólo PM se puede tocar", (await p5.$$eval(".box:not(.bloq)", (els) => els.map((e) => e.dataset.code).join(" "))) === "PM");
  await enviarOpcion(p5, "PM");
  await esperar(() => eventosDe("PM").length === 2);
  chequeo("10c el 2.º PM lo cierra con los segundos de tiempo muerto", typeof (eventosDe("PM")[1] || { p: {} }).p.segundos_tiempo_muerto === "number" && base4.wa.filter((w) => w.parametros[0] === "Paro Matriz").length === 1);
  // 10d) 501: kilos con coma o punto, se guardan con coma y viajan como unidades (sin golpes)
  await ponerLegajo(p5, "999");
  await enviarOpcion(p5, "C", "40");
  await ponerLegajo(p5, "999");
  await enviarOpcion(p5, "E", "501");
  await ponerLegajo(p5, "999");
  await p5.click('.box[data-code="C"]');
  chequeo("10d en la 501 el C pide KILOS (teclado con coma)", /KILOS/.test(await p5.textContent("#inputLabel")) && (await p5.getAttribute("#textInput", "inputmode")) === "decimal");
  await p5.fill("#textInput", "5.6"); await p5.click("#btnEnviar"); await p5.waitForSelector("#legajoScreen:not(.hidden)");
  await esperar(() => eventosDe("C").some((e) => e.p.matriz === "501"));
  const c501 = eventosDe("C").find((e) => e.p.matriz === "501");
  chequeo("10d 5.6 kilos: el toque dice «5,6» y viajan 5,6 unidades, sin golpes", !!c501 && c501.p.toque.texto === "5,6" && c501.p.uni === 5.6 && c501.p.golpes === undefined);
  // 10e) RM: cantidad obligatoria → cierra el cajón → marca la rotura (WhatsApp); sin permiso de CM termina ahí
  await ponerLegajo(p5, "999");
  await p5.click('.box[data-code="RM"]'); await p5.click("#btnEnviar");
  await p5.waitForSelector("#cantidadCajonModal");
  await p5.fill("#cantidadCajonInput", "3,5"); await p5.click("#cantidadCajonOk");
  await esperar(() => eventosDe("RM").length === 1 && eventosDe("C").filter((e) => e.p.matriz === "501").length === 2);
  const cRM = eventosDe("C").filter((e) => e.p.matriz === "501")[1];
  chequeo("10e la rotura cierra el cajón con lo cargado y marca RM sobre la matriz", !!cRM && cRM.p.uni === 3.5 && ultimo("RM").p.matriz === "501");
  chequeo("10e y avisa «Rompio Matriz» por WhatsApp", base4.wa.some((w) => w.parametros[0] === "Rompio Matriz" && w.parametros[1] === "501"));
  chequeo("10e sin permiso de CM no se abre Cambiar Matriz y vuelve al legajo", !(await p5.locator("#cmModal").count()) && await p5.isVisible("#legajoScreen"));
  // 10f) CM (alimentador): matriz nueva + balancín → balancín asignado con pase → CM abierto; el 2.º toque lo cierra
  await ponerLegajo(p5, "19");
  await p5.click('.box[data-code="CM"]');
  await p5.waitForSelector("#cmModal");
  await p5.fill("#cmMatriz", "71"); await p5.selectOption("#cmBalancin", "2"); await p5.click("#cmOk");
  await p5.waitForSelector("#legajoScreen:not(.hidden)");
  await esperar(() => base4.balancines.length === 1 && eventosDe("CM").length === 1);
  chequeo("10f el balancín se asigna con el pase (2 → matriz 71)", base4.balancines[0] && base4.balancines[0].p_balancin === "2" && base4.balancines[0].p_matriz === "71" && base4.balancines[0].p_pase === "PASE.OK1");
  const cm1 = eventosDe("CM")[0];
  chequeo("10f el CM viaja como en 2.0: código CM y «Cambiar Matriz a 71»", !!cm1 && cm1.p.matriz === "CM" && cm1.p.nombre_matriz === "Cambiar Matriz a 71" && cm1.p.toque.texto === "71" && cm1.p.balancin === "2");
  await ponerLegajo(p5, "19");
  chequeo("10f con el CM abierto sólo CM se puede tocar", (await p5.$$eval(".box:not(.bloq)", (els) => els.map((e) => e.dataset.code).join(" "))) === "CM");
  await p5.click('.box[data-code="CM"]');
  chequeo("10f el 2.º CM no pide nada (cierra con la misma matriz)", await p5.isHidden("#inputArea"));
  await p5.click("#btnEnviar"); await p5.waitForSelector("#legajoScreen:not(.hidden)");
  await esperar(() => eventosDe("CM").length === 2);
  chequeo("10f y cierra el tiempo muerto con su duración", eventosDe("CM")[1].p.toque.texto === "71" && typeof eventosDe("CM")[1].p.segundos_tiempo_muerto === "number");
  // 10g) cajón de una matriz de alimentador (tipo A): pregunta «Continuar Produciendo / Cambiar Matriz»
  await ponerLegajo(p5, "19");
  await enviarOpcion(p5, "E", "71");
  await ponerLegajo(p5, "19");
  await p5.click('.box[data-code="C"]'); await p5.fill("#textInput", "5"); await p5.click("#btnEnviar");
  await p5.waitForSelector(".rp-op");
  const ops = (await p5.locator(".rp-op").allInnerTexts()).map((t) => t.trim());
  chequeo("10g matriz de alimentador: al cerrar el cajón pregunta Continuar / Cambiar Matriz", JSON.stringify(ops) === JSON.stringify(["Continuar Produciendo", "Cambiar Matriz"]));
  await p5.click('.rp-op[data-val="SEGUIR"]');
  await p5.waitForSelector("#legajoScreen:not(.hidden)");
  chequeo("10g «Continuar Produciendo» vuelve al legajo sin abrir CM", !(await p5.locator("#cmModal").count()));
  // 10h) PCM: al cerrarla pregunta si la matriz se rompió; «no rota» sólo la cierra
  await ponerLegajo(p5, "92");
  await enviarOpcion(p5, "E", "10");
  await ponerLegajo(p5, "92");
  await enviarOpcion(p5, "PCM");
  await ponerLegajo(p5, "92");
  await p5.click('.box[data-code="PCM"]'); await p5.click("#btnEnviar");
  await p5.waitForSelector(".rp-op");
  chequeo("10h al cerrar la PCM pregunta si la matriz se rompió", /se rompió/.test(await p5.textContent(".rp-modal")));
  await p5.click('.rp-op[data-val="NO"]');
  await esperar(() => eventosDe("PCM").length === 2);
  chequeo("10h «no rota» cierra la PCM midiendo el tiempo y no hay rotura", typeof eventosDe("PCM")[1].p.segundos_tiempo_muerto === "number" && !eventosDe("RM").some((e) => e.p.legajo === "92"));
  // 10i) «Matriz sin Tiempo» por WhatsApp, pero nunca con el legajo 0 (pruebas)
  const waAntes = base4.wa.length;
  await ponerLegajo(p5, "0");
  await enviarOpcion(p5, "E", "99");
  await esperar(() => eventosDe("E").some((e) => e.p.legajo === "0"));
  await pausa(300);
  chequeo("10i el legajo 0 (pruebas) no manda WhatsApp", base4.wa.length === waAntes);
  await ponerLegajo(p5, "999");
  await enviarOpcion(p5, "E", "99");
  await esperar(() => base4.wa.length === waAntes + 1);
  chequeo("10i otro legajo con una matriz sin tiempo: avisa «Matriz sin Tiempo»", base4.wa.length === waAntes + 1 && base4.wa[waAntes].parametros[0] === "Matriz sin Tiempo" && base4.wa[waAntes].parametros[1] === "99");
  // 10j) llegada tarde con la hora de entrada DE CADA UNO (no 08:30 para todos)
  const lt999 = eventosDe("LT").find((e) => e.p.legajo === "999");
  chequeo("10j la llegada tarde usa la hora de entrada del operario (00:01)", !!lt999 && /T00:01:00/.test(lt999.p.toque.hs_inicio));
  await ponerLegajo(p5, "556");
  await enviarOpcion(p5, "E", "10");
  await esperar(() => eventosDe("E").some((e) => e.p.legajo === "556"));
  chequeo("10j quien entra a las 23:59 no tiene llegada tarde", !eventosDe("LT").some((e) => e.p.legajo === "556"));
  // 10k) legajo nuevo que el celular todavía no tenía: se vuelve a pedir el catálogo y entra
  base4.bundle = Object.assign({}, BUNDLE_20, { empleados: Object.assign({}, BUNDLE_20.empleados, { "777": { nombre: "Recién Cargado", activo: true } }) });
  const nBundle = llamadas(base4, "reg_prod_3_0_bundle").length;
  await ponerLegajo(p5, "777");
  chequeo("10k legajo que no estaba: actualiza el catálogo y entra", llamadas(base4, "reg_prod_3_0_bundle").length === nBundle + 1 && /Recién Cargado/.test(await p5.textContent("#btnBackLabel")));
  await p5.click("#btnBackTop");
  // 10l) el fin de jornada no se borra
  await ponerLegajo(p5, "0");
  await enviarOpcion(p5, "C", "1");
  await ponerLegajo(p5, "0");
  await p5.click("#btnTerminarDia"); await p5.click("#btnConfirmTD");
  await esperar(() => eventosDe("FJ").some((e) => e.p.legajo === "0"));
  await p5.click("#btnBackTop").catch(() => {});
  await p5.fill("#legajoInput", "0");
  await esperar(() => p5.evaluate(() => /FJ/.test(document.getElementById("daySummary").textContent)));
  chequeo("10l el fin de jornada no tiene 🗑", await p5.evaluate(() => { const ids = readState("0").last2.map((x, i) => [x.opcion, i]); const iFJ = ids.find(([o]) => o === "FJ")[1]; return !document.querySelector(`#daySummary .hist-del[data-idx="${iFJ}"]`) && document.querySelectorAll("#daySummary .hist-del").length > 0; }));
  await ctx4.close();

  // ============ 11) v3.1.10: contador de cajón, Terminar Día como 2.0, Continuar Matriz, errores a la auditoría, reintento ============
  // [Elías, 08/10: «4 se tiene que» · «6 debería, con el máximo de unidades por cajón de GP2» · «8 usar el de Reg Prod y que envíe todo
  //  el día como respaldo» · «15 tiene que estar» · «16 como en 2.0» · «18 como en 2.0»]
  const BUNDLE_11 = Object.assign({}, BUNDLE_20, {
    empleados: Object.assign({}, BUNDLE_20.empleados, {
      "92": Object.assign({}, BUNDLE_20.empleados["92"], { hora_salida: "17:00:00" }),
      "233": Object.assign({}, BUNDLE_20.empleados["233"], { hora_salida: "17:00:00" }),
    }),
    cajon: { "10": { "500": { uxc: 100, act: 30, codigo: "Z10" } } },   // la 10 saca Z10: entran 100 por cajón y ya hay 30
  });
  const base5 = nuevaBase(); base5.bundle = BUNDLE_11;
  const { ctx: ctx5, p: p6 } = await contexto(base5);
  await p6.goto(srv.url + "/cervantes-gp2/", { waitUntil: "domcontentloaded" });
  await entrarConCodigo(p6, CODIGO_TV);
  await p6.waitForSelector("#tvClaveModal", { state: "detached" });
  await esperar(() => p6.evaluate(() => typeof D !== "undefined" && !!(D.cajon && D.cajon["10"])));
  const ev5 = (op, leg) => base5.eventos.filter((e) => e.p.toque.opcion === op && (!leg || e.p.legajo === leg));
  const intentos5 = (id) => llamadas(base5, "reg_prod_3_0_registrar_evento").filter((c) => c.cuerpo.p && c.cuerpo.p.id_ejecucion === id).length;
  // 11a) el contador de cajón: lo que falta, «cajón completo»
  await ponerLegajo(p6, "999");
  await enviarOpcion(p6, "E", "10");
  await ponerLegajo(p6, "999");
  await p6.click('.box[data-code="C"]');
  await esperar(() => llamadas(base5, "reg_prod_3_0_contador_cajon").length >= 1);
  chequeo("11a el C muestra lo que falta para completar el cajón (100 − 30) y la casilla «cajón completo»", /Faltan 70 unidades para completar el cajón \(ya hay 30\)/.test(await p6.textContent("#matrizInfo")) && await p6.isVisible("#cajonCompletoWrap"));
  chequeo("11a y relee el contador en la base, con el pase", llamadas(base5, "reg_prod_3_0_contador_cajon").some((c) => c.cuerpo.p_n_matriz === "10" && c.cuerpo.p_pase === "PASE.OK1"));
  await p6.fill("#textInput", "20"); await p6.click("#btnEnviar"); await p6.waitForSelector("#legajoScreen:not(.hidden)");
  await esperar(() => ev5("C", "999").length === 1);
  await esperar(() => p6.evaluate(() => readQueue().length === 0));
  await ponerLegajo(p6, "999");
  await p6.click('.box[data-code="C"]');
  chequeo("11a 20 golpes × 2 = 40 unidades: ahora faltan 30", /Faltan 30 unidades/.test(await p6.textContent("#matrizInfo")));
  await p6.fill("#textInput", "1"); await p6.check("#cajonCompletoChk"); await p6.click("#btnEnviar"); await p6.waitForSelector("#legajoScreen:not(.hidden)");
  await esperar(() => ev5("C", "999").length === 2);
  await esperar(() => p6.evaluate(() => readQueue().length === 0));
  chequeo("11a «cajón completo» viaja y el contador vuelve a 0 (en la base y en el celular)", ev5("C", "999")[1].p.cajon_completo === true && base5.contador["500"] === 0 && await p6.evaluate(() => D.cajon["10"]["500"].act === 0));
  await ponerLegajo(p6, "999");
  await p6.click('.box[data-code="E"]');
  chequeo("11a en otro botón la casilla no aparece", await p6.isHidden("#cajonCompletoWrap"));
  await p6.click("#btnResetSelection");
  await p6.click("#btnBackTop");

  // 11b) error de envío a la auditoría (al 1.er intento y cada 5) y reintento solo, cada 3 s
  base5.falla500 = true;
  await ponerLegajo(p6, "999");
  await enviarOpcion(p6, "PB");
  const idPB1 = await p6.evaluate(() => readQueue().slice(-1)[0].id);
  await esperar(() => base5.erroresEnvio.length >= 1);
  const errEnv = llamadas(base5, "reg_prod_3_0_registrar_error_envio")[0];
  chequeo("11b el envío fallido queda en la auditoría, sin pase", !!errEnv && errEnv.cuerpo.p_app === reg.cuerpo.p_app && errEnv.cuerpo.p_legajo === "999" && errEnv.cuerpo.p_detalle.opcion === "PB" && errEnv.cuerpo.p_detalle.intentos === 1 && errEnv.cuerpo.p_detalle.estado === 500 && !("p_pase" in errEnv.cuerpo));
  await esperar(() => intentos5(idPB1) >= 2, 7000);
  chequeo("11b se reintenta solo (cada 3 s) y no anota cada intento", intentos5(idPB1) >= 2 && base5.erroresEnvio.length === 1);
  base5.falla500 = false;
  await esperar(() => ev5("PB", "999").length === 1, 7000);
  chequeo("11b cuando la base vuelve, sale sin tocar nada", ev5("PB", "999").length === 1);

  // 11c) Terminar Día como 2.0 — matriz con contador: «¿Hiciste un último cajón?»
  await ponerLegajo(p6, "999");
  await p6.click("#btnTerminarDia");
  const td1 = await p6.textContent("#terminarDiaContent");
  chequeo("11c Terminar Día: resumen, el tiempo muerto abierto se cierra solo y pregunta por el último cajón", /Eventos hoy/.test(td1) && /Tiempo Muerto abierto/.test(td1) && /último cajón/.test(td1) && await p6.isHidden("#btnConfirmTD"));
  await p6.click("#btnUltSi");
  await p6.fill("#tdUltUni", "abc"); await p6.click("#btnUltSiCargar");
  chequeo("11c cantidad inválida: avisa y no carga nada", /enteros/.test(await p6.textContent("#tdUltFb")) && ev5("C", "999").length === 2);
  await p6.fill("#tdUltUni", "5"); await p6.check("#tdUltCompleto"); await p6.click("#btnUltSiCargar");
  await p6.waitForSelector("#legajoScreen:not(.hidden)");
  await esperar(() => ev5("FJ", "999").length === 1 && ev5("C", "999").length === 3 && ev5("PB", "999").length === 2);
  const dia5 = await p6.evaluate(() => dayKeyAR());
  const fj1 = ev5("FJ", "999")[0];
  let fjTexto = null;
  try { fjTexto = JSON.parse(fj1.p.toque.texto); } catch { /* no es JSON */ }
  const cUlt = ev5("C", "999")[2];
  chequeo("11c el último cajón llega con «cajón completo» y el PB abierto se cerró midiendo", cUlt.p.golpes === 5 && cUlt.p.cajon_completo === true && typeof ev5("PB", "999")[1].p.segundos_tiempo_muerto === "number");
  chequeo("11c el FJ tiene id fijo fj_<legajo>_<día> y el día entero en el texto", fj1.p.id_ejecucion === `fj_999_${dia5}` && !!fjTexto && fjTexto.counts.C === 3 && fjTexto.events.length >= 6 && fjTexto.events.every((x) => x.opcion !== "FJ"));
  const idE5 = ev5("E", "999")[0].p.id_ejecucion;
  await esperar(() => intentos5(idE5) >= 2);
  chequeo("11c después del FJ se reenvía el día entero como respaldo (la base no duplica)", intentos5(idE5) >= 2 && ev5("E", "999").length === 1);
  await p6.fill("#legajoInput", "999");
  await esperar(() => p6.evaluate(() => /FJ/.test(document.getElementById("daySummary").textContent)));
  chequeo("11c el historial muestra el FJ sin el texto del día", !/counts/.test(await p6.textContent("#daySummary")));
  // un 2.º Terminar Día PISA al anterior; el «No» carga el tiempo muerto desde el último cajón, ya cerrado
  await ponerLegajo(p6, "999");
  await p6.click("#btnTerminarDia");
  chequeo("11c otra vez Terminar Día: avisa que reemplaza el reporte anterior", /Ya cerraste el día hoy/.test(await p6.textContent("#terminarDiaContent")));
  await p6.click("#btnUltNo");
  await p6.selectOption("#tdUltNoTM", "LIMP"); await p6.click("#btnUltNoCargar");
  await p6.waitForSelector("#legajoScreen:not(.hidden)");
  await esperar(() => base5.fjPisados === 1 && ev5("LIMP", "999").length === 1);
  chequeo("11c el 2.º FJ pisa al 1.º (mismo id, una sola fila)", base5.fjPisados === 1 && ev5("FJ", "999").length === 1 && await p6.evaluate(() => readState("999").last2.filter((x) => x.opcion === "FJ").length === 1));
  chequeo("11c el «No» manda el tiempo muerto ya cerrado y no deja nada abierto", typeof ev5("LIMP", "999")[0].p.segundos_tiempo_muerto === "number" && await p6.evaluate(() => !readState("999").lastDowntime));

  // 11d) matriz sin contador: «¿Vas a seguir mañana?»; al día siguiente «⚡ Continuar» entre E y C
  const pasarAyer = (leg) => p6.evaluate((lg) => {
    const hoy = dayKeyAR(); const d = new Date(hoy + "T12:00:00-03:00"); d.setUTCDate(d.getUTCDate() - 1);
    const ayer = d.toISOString().slice(0, 10);
    const s = readState(lg); s.lastMatrix.ts = `${ayer}T15:00:00-03:00`; s.lastCajon = null;   // la empezó ayer a las 15:00
    localStorage.setItem(`${LS_PREFIX}::${ayer}::${lg}`, JSON.stringify(s));
    localStorage.removeItem(`${LS_PREFIX}::${hoy}::${lg}`);
  }, leg);
  await ponerLegajo(p6, "92");
  await enviarOpcion(p6, "E", "99");
  await ponerLegajo(p6, "92");
  await p6.click("#btnTerminarDia");
  chequeo("11d matriz sin cajón: pregunta si sigue mañana y no deja terminar sin contestar", /seguir mañana/.test(await p6.textContent("#terminarDiaContent")) && await p6.isDisabled("#btnConfirmTD"));
  await p6.click("#btnContSi");
  chequeo("11d «Sí, sigo mañana» habilita Terminar Día", await p6.isEnabled("#btnConfirmTD"));
  await p6.click("#btnConfirmTD");
  await p6.waitForSelector("#legajoScreen:not(.hidden)");
  await esperar(() => ev5("FJ", "92").length === 1);
  await pasarAyer("92");
  await ponerLegajo(p6, "92");
  const fila1 = await p6.$$eval("#row1 > .box", (els) => els.map((e) => e.dataset.code || e.id).join(" "));
  chequeo("11d al día siguiente aparece «⚡ Continuar» entre E y C, con lo de ayer (15:00 a 17:00 = 120 min)", fila1 === "E btnContinuarMatriz C" && /120 min/.test(await p6.textContent("#btnContinuarMatriz")));
  await p6.click('.box[data-code="PB"]');
  await p6.waitForSelector("#advIgnorarContModal");
  await p6.fill("#advIgnorarContCodigo", "1234"); await p6.click("#advIgnorarContOk");
  chequeo("11d tocar otro botón pide el código de Logística (uno malo no pasa)", /incorrecto/.test(await p6.textContent("#advIgnorarContFb")) && await p6.isHidden("#selectedArea"));
  await p6.click("#advIgnorarContCancel");
  await p6.click("#btnContinuarMatriz");
  await esperar(() => p6.evaluate(() => /Continuando Matriz 99/.test(document.getElementById("avisoBotones").textContent)));
  chequeo("11d «Continuar» deja activa la matriz de ayer (con aviso a la vista) y el botón se va", await p6.isVisible("#avisoBotones") && await p6.evaluate(() => readState("92").lastMatrix.texto === "99" && !!readState("92").cajonContinuado) && !(await p6.locator("#btnContinuarMatriz").count()));
  await p6.click('.box[data-code="C"]'); await p6.fill("#textInput", "10"); await p6.click("#btnEnviar");
  await p6.waitForSelector("#legajoScreen:not(.hidden)");
  await esperar(() => ev5("C", "92").length === 1);
  const cc5 = ev5("C", "92")[0];
  chequeo("11e el cajón continuado suma lo de ayer (7.200 s hasta la salida), con la hora de inicio de ayer y [CONT]", !!cc5 && cc5.p.segundos_trabajados >= 7200 && cc5.p.hora_inicio === "15:00:00" && /^\[CONT\]/.test(cc5.p.nombre_matriz) && cc5.p.cajon_continuado.segPostAyer === 7200);
  chequeo("11e el inicio del toque es el «Continuar» de hoy (la base descuenta sólo los tiempos muertos de hoy)", !!cc5 && Date.parse(cc5.p.toque.hs_inicio) > Date.now() - 10 * 60000 && await p6.evaluate(() => !readState("92").cajonContinuado));
  // con el código de Logística sigue con lo que tocó y el «Continuar» no vuelve
  await ponerLegajo(p6, "233");
  await enviarOpcion(p6, "E", "99");
  await ponerLegajo(p6, "233");
  await p6.click("#btnTerminarDia"); await p6.click("#btnContSi"); await p6.click("#btnConfirmTD");
  await p6.waitForSelector("#legajoScreen:not(.hidden)");
  await esperar(() => ev5("FJ", "233").length === 1);
  await pasarAyer("233");
  await ponerLegajo(p6, "233");
  await p6.click('.box[data-code="PB"]');
  await p6.waitForSelector("#advIgnorarContModal");
  await p6.fill("#advIgnorarContCodigo", "151515"); await p6.click("#advIgnorarContOk");
  chequeo("11d con el código de Logística sigue con lo que tocó y «Continuar» no vuelve", await p6.isVisible("#selectedArea") && (await p6.textContent("#selectedBox")) === "PB" && !(await p6.locator("#btnContinuarMatriz").count()));
  await p6.click("#btnResetSelection");
  await p6.click("#btnBackTop");

  // 11f) envío en segundo plano: la cola copiada al IndexedDB para el service worker (la copia de GP2 no tiene service worker propio)
  if (await p6.evaluate(() => typeof espejarColaSW === "function")) {
    base5.caida = true;
    await ponerLegajo(p6, "999");
    await enviarOpcion(p6, "PB");
    const idPB2 = await p6.evaluate(() => readQueue().slice(-1)[0].id);
    const leerCopia = (id) => p6.evaluate(async (i) => ({
      r: await idbTx(["cola"], "readonly", (tx) => tx.objectStore("cola").get(i)),
      m: await idbTx(["meta"], "readonly", (tx) => tx.objectStore("meta").get("envio")),
      disp: idDispositivo(),
    }), id);
    await esperar(async () => !!(await leerCopia(idPB2)).r);
    const copia = await leerCopia(idPB2);
    chequeo("11f la cola se copia al IndexedDB lista para el service worker (cuerpo del toque + pase + equipo)", !!copia.r && copia.r.cuerpo.id_ejecucion === idPB2 && copia.r.cuerpo.toque.opcion === "PB" && copia.m.pase === "PASE.OK1" && copia.m.dispositivo === copia.disp);
    await p6.evaluate(async (i) => {
      await idbTx(["enviados"], "readwrite", (tx) => tx.objectStore("enviados").put({ id: i, legajo: "999", matriz: "", cajon: null }));
      await recogerEnviadosSW();
    }, idPB2);
    chequeo("11f lo que mandó el service worker sale de la cola y figura ENVIADO", await p6.evaluate((i) => !readQueue().some((x) => x.id === i) && readState("999").last2.find((x) => x.id === i).status === "sent", idPB2));
    base5.caida = false;
  }
  await ctx5.close();

  // ============ 12) v3.1.11: sin catálogo dice «sin conexión», no «el legajo no existe» (auditoría 30/09, base caída) ============
  const base6 = nuevaBase();
  base6.bundleFalla = true;
  const { ctx: ctx6, p: p7 } = await contexto(base6);
  const avisos7 = [];
  p7.on("dialog", (d) => avisos7.push(d.message()));
  await p7.goto(srv.url + "/cervantes-gp2/", { waitUntil: "domcontentloaded" });
  await entrarConCodigo(p7, CODIGO_TV);
  await esperar(() => llamadas(base6, "reg_prod_3_0_bundle").length >= 1);
  await p7.fill("#legajoInput", "999");
  await p7.click("#btnContinuar");
  await esperar(() => avisos7.length >= 1);
  chequeo("12 celular nuevo con la base caída: avisa «Sin conexión», no «el legajo no existe»", /Sin conexión/.test(avisos7[0]) && !/no existe/.test(avisos7[0]) && !(await p7.isVisible("#optionsScreen")));
  base6.bundleFalla = false;
  await esperar(async () => { await p7.click("#btnContinuar"); return p7.isVisible("#optionsScreen"); });
  chequeo("12 cuando vuelve la base, el mismo legajo entra", await p7.isVisible("#optionsScreen"));
  await p7.click("#btnBackTop");
  const nAvisos = avisos7.length;
  await p7.fill("#legajoInput", "123456");
  await p7.click("#btnContinuar");
  await esperar(() => avisos7.length > nAvisos);
  chequeo("12 con catálogo, un legajo que no está sigue diciendo «no existe»", /no existe/.test(avisos7[nAvisos]));
  await ctx6.close();

  // ============ 13) v3.1.13: el legajo VERDADERO (c = CHEF SRL) y «¿Quién sos?» si el número es de dos personas ============
  const base7 = nuevaBase();
  base7.bundle = Object.assign({}, BUNDLE, { empleados: {
    "c29": { nombre: "Nora Chef", activo: true, hora_entrada: "00:01:00" },
    "29": { nombre: "Viviana Loeke", activo: true, hora_entrada: "00:01:00" },
    "c94": { nombre: "Isidro Chef", activo: true, hora_entrada: "00:01:00" },
  } });
  const { ctx: ctx7, p: p8 } = await contexto(base7);
  const preguntas8 = [];
  p8.on("dialog", (d) => preguntas8.push(d.message()));
  await p8.goto(srv.url + "/cervantes-gp2/", { waitUntil: "domcontentloaded" });
  await entrarConCodigo(p8, CODIGO_TV);
  await esperar(() => llamadas(base7, "reg_prod_3_0_bundle").length >= 1);
  await esperar(() => p8.evaluate(() => !!(D.empleados && D.empleados.c94)));
  // número de una sola persona: escribe 94 y es c94
  await ponerLegajo(p8, "94");
  chequeo("13 escribe «94» y entra Isidro con su legajo verdadero c94", /Isidro Chef/.test(await p8.textContent("#btnBackLabel")) && /c94/.test(await p8.textContent("#btnBackLabel")));
  await enviarOpcion(p8, "PB");
  await esperar(() => base7.eventos.length >= 1);
  chequeo("13 lo que carga va con el legajo verdadero c94", base7.eventos.some((e) => e.p.legajo === "c94") && !base7.eventos.some((e) => e.p.legajo === "94"));
  await p8.click("#btnBackTop").catch(() => {});
  // número de dos personas: 29 → «¿Quién sos?»
  await p8.fill("#legajoInput", "29");
  await p8.click("#btnContinuar");
  await p8.waitForSelector(".rp-modal .rp-op");
  const opciones = await p8.$$eval(".rp-modal .rp-op", (bs) => bs.map((b) => b.textContent));
  chequeo("13 el 29 está en las dos empresas: pregunta «¿Quién sos?» con los dos nombres", /Quién sos/.test(await p8.textContent(".rp-modal")) && opciones.length === 2 && opciones.some((t) => /Nora Chef/.test(t)) && opciones.some((t) => /Viviana Loeke/.test(t)));
  await p8.click('.rp-modal .rp-op[data-val="c29"]');
  await p8.waitForSelector("#optionsScreen:not(.hidden)");
  chequeo("13 eligió Nora: entra como c29", /Nora Chef/.test(await p8.textContent("#btnBackLabel")) && /c29/.test(await p8.textContent("#btnBackLabel")));
  await enviarOpcion(p8, "PB");
  await esperar(() => base7.eventos.some((e) => e.p.legajo === "c29"));
  chequeo("13 y lo que carga Nora va como c29, no como 29", base7.eventos.some((e) => e.p.legajo === "c29") && !base7.eventos.some((e) => e.p.legajo === "29"));
  await p8.click("#btnBackTop").catch(() => {});
  // vuelve a escribir 29 en el mismo celular: ya eligió, no pregunta otra vez
  const modales = await p8.locator(".rp-modal").count();
  await ponerLegajo(p8, "29");
  chequeo("13 el mismo celular vuelve a escribir 29: entra como c29 sin volver a preguntar", /Nora Chef/.test(await p8.textContent("#btnBackLabel")) && (await p8.locator(".rp-modal").count()) === modales);
  await ctx7.close();

  // ============ 9) nada de GP2 ============
  const todas = base.llamadas.concat(base2.llamadas, base3.llamadas, base4.llamadas, base5.llamadas, base6.llamadas, base7.llamadas);
  chequeo("9 no se llamó a ninguna función de GP2 (bundle, registrar, anular, rollos, stock)", todas.length > 0 && todas.every((c) => !GP2_FNS.test(c.url)));
  chequeo("9 todas las funciones son reg_prod_3_0_*", todas.every((c) => /^reg_prod_3_0_/.test(c.fn)));

  await ctx.close();
  const fallas = res.filter(([, ok]) => !ok);
  console.log(`cervantes-gp2: ${res.length - fallas.length}/${res.length} chequeos OK · pageerrors: ${errs.length ? errs.join(" | ") : "none"} · ${fallas.length === 0 && errs.length === 0 ? "✓ OK" : "✗ FAIL"}`);
  await b.close(); await srv.cerrar();
  process.exit(fallas.length === 0 && errs.length === 0 ? 0 : 1);
})();
