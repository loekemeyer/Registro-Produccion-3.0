/* v23.87 (Luis) — el operario NO vuelve a la pantalla del legajo:
   1) después de registrar una tarea (send) sigue en su botonera;
   2) si ya entró HOY a Virgilio, una recarga lo deja directo en la botonera (sin selector ni legajo);
   3) (v30.01) sin esa marca TAMBIÉN cae directo: el selector de planta es la pantalla de inicio del sitio (/).
   Sale 1 si falla. */
const path = require("path");
let chromium;
try { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }
catch (_e) { try { ({ chromium } = require("playwright")); } catch (_e2) { console.error("Playwright no encontrado."); process.exit(2); } }
(async () => {
  const b = await chromium.launch(); const p = await b.newPage(); const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.route("**/*.supabase.co/**", (r) => r.abort());
  await p.goto("file://" + path.join(__dirname, "..", "virgilio", "index.html"), { waitUntil: "domcontentloaded" });
  const r = await p.evaluate(async () => {
    const out = {};
    const vis = id => !document.getElementById(id).classList.contains("hidden");
    window.alert = function () {}; window.confirm = function () { return true; };
    window.maybeRegisterLateArrival = async function () {};
    window.trySendOneReport = async function () { return { ok: true }; };
    window.getActivityStatus = async function () { return null; };
    window.tandaReservar = async function () { return null; };
    window.enqueueReport = function () {};
    window.showPickingList = function () {};
    // 1) send desde la botonera
    legajoInput.value = "999";
    goToOptions();
    selectOption("EP"); textInput.value = "E01C";
    await send();
    out.sigueEnBotonera = vis("optionsScreen") && !vis("legajoScreen");
    // 2) recarga con planta del día = virgilio → directo a la botonera
    document.getElementById("optionsScreen").classList.add("hidden");
    document.getElementById("legajoScreen").classList.remove("hidden");
    localStorage.setItem("vir_planta_dia", JSON.stringify({ planta: "virgilio", day: getTodayKey() }));
    __gvAuthTest.setOperario({ legajo: "999", nombre: "Prueba" });
    __gvAuthTest.route();
    out.recargaDirecto = vis("optionsScreen") && !vis("plantSelector") && !vis("legajoScreen");
    // 3) v30.01 (Registro Producción 3.0): la planta se elige en la pantalla de inicio del sitio, así que
    //    aunque la marca sea de otro día NO hay segundo selector: igual cae directo en la botonera
    document.getElementById("optionsScreen").classList.add("hidden");
    document.getElementById("legajoScreen").classList.remove("hidden");
    localStorage.setItem("vir_planta_dia", JSON.stringify({ planta: "virgilio", day: "2000-01-01" }));
    __gvAuthTest.setOperario({ legajo: "999", nombre: "Prueba" });
    __gvAuthTest.route();
    out.otroDiaDirecto = vis("optionsScreen") && !vis("plantSelector") && !vis("legajoScreen");
    // 4) elegir Virgilio guarda la marca y entra a la botonera
    chooseVirgilio();
    out.eligeGuarda = JSON.parse(localStorage.getItem("vir_planta_dia")).day === getTodayKey() && vis("optionsScreen");
    // 5) cambiar de planta borra la marca y vuelve al inicio del sitio (../). No se llama: navegaría y
    //    mataría el contexto de la prueba; se verifica el código.
    const cp = String(cambiarPlanta);
    out.cambiarVuelveAlInicio = /removeItem\("vir_planta_dia"\)/.test(cp) && /window\.location\.href = "\.\.\/"/.test(cp);
    return out;
  });
  const pass = Object.values(r).every(Boolean) && errs.length === 0;
  console.log("operario-queda-botonera:", JSON.stringify(r), "· pageerrors:", errs.length ? errs.join("|") : "none", "·", pass ? "✓ OK" : "✗ FAIL");
  await b.close(); process.exit(pass ? 0 : 1);
})();
