/* Regresión v26.56 (Luis, 05/10: "si uno termina el día con un picking o armado abierto, queda
   guardado con la data que se llegó a generar y se puede retomar después") —
   (A) ARMADO: el avance del asistente (vir_comp_<tanda>) de un armado del viernes a la tarde que se
       sigue el lunes (~65 h) se conserva mientras el armado siga abierto en el celular. Antes se
       borraba a las 36 h y el lunes arrancaba de cero (D45B, D52C, D67F; F22A al 05/10).
   (B) ARMADO: si el armado ya NO está abierto, el guardado viejo sí se descarta (basura).
   (C) ARMADO: el guardado de menos de 36 h se retoma como siempre.
   (D) PICKING: el guardado del picking (vir_pk_<legajo>) de otro día se conserva si el picking sigue
       abierto para esa tanda, y se descarta si no (v5.91). Candado para que no se pierda.
   Sale 1 si falla. */
const path = require("path");
let chromium;
try { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }
catch (_e) {
  try { ({ chromium } = require("playwright")); }
  catch (_e2) { console.error("Playwright no encontrado."); process.exit(2); }
}
(async () => {
  const root = path.join(__dirname, "..", "virgilio");
  const b = await chromium.launch();
  const p = await b.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.route("**/*.supabase.co/**", (r) => r.abort());
  await p.goto("file://" + path.join(root, "index.html"), { waitUntil: "domcontentloaded" });

  const r = await p.evaluate(() => {
    const out = {};
    const H = 3600 * 1000;
    const avance = function (horas) {
      return JSON.stringify({ _ts: Date.now() - horas * H, tanda: "F22A", step: 3,
        nps: [{ np: "LK 0300", rs: "Cliente", lios: 4, faltantes: { "508": 2 } }] });
    };
    const abrirArmado = function (leg, tanda) { const s = getLegajoState(leg); s.armado = { active: true, value: tanda, ts_inicio: null }; setLegajoState(leg, s); };

    // (A) 65 h + armado abierto → se retoma con lo cargado
    localStorage.clear();
    localStorage.setItem(_compPersistKey("F22A"), avance(65));
    abrirArmado("8", "F22A");
    const a = _compRestore("F22A");
    out.aSeRetoma = !!(a && a.nps && a.nps[0] && a.nps[0].lios === 4 && a.nps[0].faltantes["508"] === 2);

    // (B) 65 h + armado ya cerrado → se descarta
    localStorage.clear();
    localStorage.setItem(_compPersistKey("F22A"), avance(65));
    out.bSeDescarta = _compRestore("F22A") === null && localStorage.getItem(_compPersistKey("F22A")) === null;
    // … y el abierto de OTRA tanda no lo salva
    localStorage.setItem(_compPersistKey("F22A"), avance(65));
    abrirArmado("8", "F23B");
    out.bOtraTandaNoCuenta = _compRestore("F22A") === null;

    // (C) < 36 h → se retoma aunque no haya estado de armado
    localStorage.clear();
    localStorage.setItem(_compPersistKey("F22A"), avance(20));
    out.cMenos36h = !!_compRestore("F22A");

    // (D) picking de otro día
    localStorage.clear();
    const pk = { day: "2026-10-02", tanda: "F13E", legajo: "104", items: [{ art: "583E", esp: 6 }], idx: 1,
      results: { "583E": 2 }, mode: "item", forced: {}, app: "26.55" };
    localStorage.setItem("vir_pk_104", JSON.stringify(pk));
    { const s = getLegajoState("104"); s.picking = { active: true, value: "F13E", ts_inicio: null }; setLegajoState("104", s); }
    const d1 = pkLoadSaved("104");
    out.dPickingAbiertoSeConserva = !!(d1 && d1.results && d1.results["583E"] === 2);
    { const s = getLegajoState("104"); s.picking = { active: false, value: "", ts_inicio: null }; setLegajoState("104", s); }
    out.dPickingCerradoSeDescarta = pkLoadSaved("104") === null;
    return out;
  });

  let ok = true;
  for (const k of Object.keys(r)) { console.log((r[k] ? "OK   " : "FALLA") + " " + k); if (!r[k]) ok = false; }
  if (errs.length) { console.log("pageerror:", errs.slice(0, 3)); ok = false; }
  await b.close();
  console.log(ok ? "tarea-abierta-otro-dia: OK" : "tarea-abierta-otro-dia: FALLA");
  process.exit(ok ? 0 : 1);
})();
