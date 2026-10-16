/* v32.07 (Luis, 16/10/2026) — COMPLETAR PEDIDO con EXCEDENTE.
   "completar pedido en esos casos debería decirle que busque en excedente y/o gondola y preguntarle de donde lo saco.
    simple. en caso de que el admin no llegue a marcar vacio el excedente a tiempo."
   Mide, con el módulo de verdad (index.html) y la red mockeada:
     (a) código con excedente: avisa «buscalo en excedente (P21 · P22) y/o góndola» y NO elige origen solo;
     (b) sin origen el botón está deshabilitado y cpConfirm no mueve stock;
     (c) Excedente pide la posición (un botón por posición); sin posición no confirma;
     (d) Excedente + P22 → el movimiento sale de 'excedente' CON ubicación P22 y el evento CP dice «EXCEDENTE P22»;
     (e) Góndola sigue andando igual (sale de 'terminado', sin ubicación);
     (f) código SIN excedente: no hay opción Excedente y el origen se elige solo como antes.
   Sale 1 si falla. */
const path = require("path");
let chromium;
try { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }
catch (_e) { try { ({ chromium } = require("playwright")); } catch (_e2) { console.error("no playwright"); process.exit(2); } }
const APP = process.env.PK_APP || path.join(__dirname, "..", "virgilio", "index.html");
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto("file://" + APP, { waitUntil: "domcontentloaded" });
  const r = await p.evaluate(async () => {
    const out = {};
    const espera = (ms) => new Promise((res) => setTimeout(res, ms));
    window.alert = function () {};
    function J(data) { return Promise.resolve({ ok: true, status: 200, headers: { get: function () { return null; } }, json: function () { return Promise.resolve(data); }, text: function () { return Promise.resolve("2"); } }); }
    let saldo = { cod_art: "066", clave: "066", descripcion: "", a_guardar: 0, terminado: 3, excedente: 10, separar_pedidos: 0, a_facturar: 0, racks: 0, insumos: 0 };
    let FALT = [{ id: 1, np: "98140", cod_cliente: "771", cod_art: "066", cajas_pedidas: 10, cajas_entregadas: 8, cajas_falto: 2, tanda: "F12A", fecha_salida: new Date().toISOString().slice(0, 10) }];
    window.fetch = function (url) {
      url = String(url);
      if (url.indexOf("Entregas_Virgilio") >= 0 && url.indexOf("cajas_falto=gt.0") >= 0) return J(FALT);
      if (url.indexOf("vista_saldos_stock") >= 0) return J([saldo]);
      if (url.indexOf("gv_excedente_posicion") >= 0) return J(saldo.excedente > 0 ? [{ clave: "066", sector: "P21", orden: 738, cajas: 6 }, { clave: "066", sector: "P22", orden: 739, cajas: 4 }] : []);
      return J([]);
    };
    let moves = [], evs = [];
    window.stockMove = function (rows) { moves.push(rows); return Promise.resolve({ ok: true }); };
    window.enqueueReport = function (pl) { evs.push(pl); };
    window.trySendOneReport = function () { return Promise.resolve({ ok: false }); };
    window.faltMaybeCompletar = function () {};
    window.cpCerrarTareaSiCompleta = function () { return Promise.resolve(); };
    window.opDraftClear = function () {};
    window.updatePendingIndicator = function () {};
    window.cpReloadFaltantes = function () { return Promise.resolve([]); };
    const html = () => (document.getElementById("cpBody") || {}).innerHTML || "";
    const txt = () => (document.getElementById("cpBody") || {}).textContent || "";

    await showCPModal("104", null, "98140");
    await espera(150);
    // (a)
    out.aviso = /buscalo ah. y\/o en g.ndola/.test(txt()) && /P21 \(6\) · P22 \(4\)/.test(txt());
    out.sinOrigen = _cp.origen === null && /Excedente/.test(txt());
    // (b)
    const fin = () => document.querySelector("#cpBody .cp-fin");
    out.deshabilitado = !!fin() && fin().disabled;
    await cpConfirm();
    out.noMovio = moves.length === 0;
    // (c)
    cpOrigen("excedente");
    out.pidePos = /De qu. posici.n/.test(txt()) && /P21/.test(html()) && /P22/.test(html());
    out.sinPosDeshab = fin().disabled;
    // (d)
    cpExcPos("P22");
    out.conPosHabil = !fin().disabled;
    await cpConfirm();
    const m = (moves[0] || [])[0] || {};
    out.mov = JSON.stringify(m);
    out.movOk = m.deposito === "excedente" && m.ubicacion === "P22" && m.delta === -2;
    const cp = evs.filter((x) => x.opcion === "CP")[0] || {};
    out.ev = cp.texto || "";
    out.evOk = /^98140\|066\|2\|EXCEDENTE P22\|/.test(out.ev);
    // (e)
    moves = []; evs = [];
    await showCPModal("104", null, "98140"); await espera(150);
    cpOrigen("terminado"); await cpConfirm();
    const g = (moves[0] || [])[0] || {};
    out.gondOk = g.deposito === "terminado" && !g.ubicacion;
    // (f)
    saldo = Object.assign({}, saldo, { excedente: 0 });
    await showCPModal("104", null, "98140"); await espera(150);
    out.sinExc = _cp.origen === "terminado" && !/Excedente<small>/.test(html());
    return out;
  });
  await b.close();
  const f = []; const ok = (c, m) => { if (!c) f.push(m); };
  ok(r.aviso, "(a) no avisa que busque en excedente (P21 · P22) y/o góndola");
  ok(r.sinOrigen, "(a) con excedente eligió el origen solo o no ofrece Excedente");
  ok(r.deshabilitado && r.noMovio, "(b) sin origen dejó completar");
  ok(r.pidePos && r.sinPosDeshab, "(c) Excedente no pide la posición");
  ok(r.conPosHabil && r.movOk, "(d) el movimiento salió " + r.mov + " (esperaba excedente, P22, −2)");
  ok(r.evOk, "(d) el evento CP salió «" + r.ev + "»");
  ok(r.gondOk, "(e) Góndola dejó de andar");
  ok(r.sinExc, "(f) sin excedente cambió el comportamiento de antes");
  if (errs.length) f.push("errores de página: " + errs.join(" · "));
  if (f.length) { console.error("CP EXCEDENTE — FALLA:\n  " + f.join("\n  ")); process.exit(1); }
  console.log("cp-excedente OK — avisa excedente y/o góndola, pide de dónde y de qué posición.");
})();
