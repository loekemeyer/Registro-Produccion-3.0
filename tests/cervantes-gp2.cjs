/* Cervantes · botonera de GP2 (cervantes-gp2/, v3.1.3) — entra con el código de la TV, usa el PASE y habla con el schema reg_prod_3_0.
   Supabase está simulado: la base de mentira exige el pase (igual que reg_prod_3_0_pase_ok) y guarda lo que le llega.
     1) sin pase aparece la pantalla del código; código malo no entra; código bueno entra, guarda el pase y trae el catálogo
        con el pase, el id del equipo y la cabecera Content-Profile: reg_prod_3_0
     2) la botonera es la de GP2 (13 botones; sin CT de Eduardo mientras los rollos estén apagados) y el legajo se anota 1 vez
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
    "19": { nombre: "Eduardo Prueba", activo: true, hora_entrada: "08:30:00" },
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
      base.llamadas.push({ fn, perfil: req.headers()["content-profile"] || "", cuerpo, url });
      const paseMal = () => json(400, { code: "28000", details: null, hint: null, message: "Pase inválido o vencido" });
      const conPase = cuerpo.p_pase === base.paseValido && !!cuerpo.p_dispositivo;
      if (fn === "reg_prod_3_0_cerv_ingresar") {
        if (cuerpo.p_clave === CODIGO_TV) return json(200, { ok: true, nombre: null, pase: base.paseNuevo, vence: base.vence });
        return json(200, { ok: false, error: "codigo" });
      }
      if (fn === "reg_prod_3_0_registrar_ingreso") return json(200, 1);
      if (fn === "reg_prod_3_0_bundle") return conPase ? json(200, base.bundle) : paseMal();
      if (["reg_prod_3_0_tomar_rollo", "reg_prod_3_0_cerrar_rollo", "reg_prod_3_0_rollo_tomar", "reg_prod_3_0_rollo_cerrar"].includes(fn)) {
        if (!conPase) return paseMal();
        base.entregas.push({ fn, cuerpo });
        const repetido = !!cuerpo.p_id && base.rollos.some((r) => r.cuerpo.p_id === cuerpo.p_id);   // como reg_prod_3_0.rollo_llamadas
        if (!repetido) base.rollos.push({ fn, cuerpo });
        if (base.perderRespuesta) { base.perderRespuesta = false; return route.abort("failed"); }
        return json(200, repetido ? { ok: true, dup: true } : { ok: true });
      }
      if (fn === "reg_prod_3_0_envasado_articulos") return conPase ? json(200, ARTICULOS) : paseMal();
      if (fn === "reg_prod_3_0_registrar_evento") {
        if (!conPase) return paseMal();
        const id = String(cuerpo.p && cuerpo.p.id_ejecucion);
        if (base.eventos.some((e) => String(e.p.id_ejecucion) === id)) return json(200, { ok: true, id, dup: true });
        base.eventos.push(cuerpo);
        return json(200, { ok: true, id: base.eventos.length, premio: 0.5, uni: 0 });
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
  chequeo("2 los 13 botones de GP2", JSON.stringify(codigos) === JSON.stringify(["E", "C", "PB", "BC", "MOV", "LIMP", "Perm", "AL", "PR", "PC", "MOV P", "PM", "RM"]));
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
  chequeo("3 el toque crudo viaja adentro (opción, texto, hora y versión)", !!e1 && e1.p.toque.texto === "10" && !!e1.p.toque.ts_event && e1.p.toque.app_version === "v3.1.4" && e1.p.toque.id === e1.p.id_ejecucion);
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

  // ============ 9) nada de GP2 ============
  const todas = base.llamadas.concat(base2.llamadas, base3.llamadas);
  chequeo("9 no se llamó a ninguna función de GP2 (bundle, registrar, anular, rollos, stock)", todas.length > 0 && todas.every((c) => !GP2_FNS.test(c.url)));
  chequeo("9 todas las funciones son reg_prod_3_0_*", todas.every((c) => /^reg_prod_3_0_/.test(c.fn)));

  await ctx.close();
  const fallas = res.filter(([, ok]) => !ok);
  console.log(`cervantes-gp2: ${res.length - fallas.length}/${res.length} chequeos OK · pageerrors: ${errs.length ? errs.join(" | ") : "none"} · ${fallas.length === 0 && errs.length === 0 ? "✓ OK" : "✗ FAIL"}`);
  await b.close(); await srv.cerrar();
  process.exit(fallas.length === 0 && errs.length === 0 ? 0 : 1);
})();
