/* v27.58 (Thomas, 06/10) — el legajo 1 es de PRUEBA:
   (a) antes de registrar desde la botonera pregunta; «Cancelar» no registra nada;
   (b) «Aceptar» registra y da 10 min para deshacer (el banner arranca en 10:00);
   (c) cualquier otro legajo no pregunta y sigue con 60 s.
   Corre la pantalla de verdad (send + banner). Sale 1 si falla. */
const path = require("path");
let chromium;
try { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }
catch (_e) { try { ({ chromium } = require("playwright")); } catch (_e2) { console.error("Playwright no encontrado."); process.exit(2); } }
(async () => {
  const b = await chromium.launch(); const p = await b.newPage(); const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.route("**/*.supabase.co/**", (r) => r.abort());
  await p.goto("file://" + path.join(__dirname, "..", "virgilio", "index.html"), { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => typeof send === "function" && typeof _undoWindowMs === "function");
  const r = await p.evaluate(async () => {
    const out = {};
    let preguntas = [], resp = false, enq = [];
    window.alert = function () {}; window.confirm = function (m) { preguntas.push(String(m)); return resp; };
    window.maybeRegisterLateArrival = async function () {};
    window.trySendOneReport = async function () { return { ok: true }; };
    window.getActivityStatus = async function () { return null; };
    window.tandaReservar = async function () { return null; };
    window.enqueueReport = function (pl) { enq.push(pl); };
    const banner = () => (document.getElementById("undoBannerText") || {}).textContent || "";
    const correr = async (leg) => { legajoInput.value = leg; goToOptions(); selectOption("PB"); await send(); };
    // (a) legajo 1, Cancelar
    resp = false; await correr("1");
    out.a_pregunto = preguntas.length === 1 && /Legajo 1/.test(preguntas[0]);
    out.a_noRegistra = enq.length === 0 && !_lastSentReport;
    // (b) legajo 1, Aceptar
    preguntas = []; resp = true; await correr("1");
    out.b_registra = enq.length > 0 && !!_lastSentReport;
    out.b_10min = _undoWindowMs("1") === 600000 && /— (10:00|9:5\d)/.test(banner());
    // (c) otro legajo: no pregunta, 60 s
    hideUndoBanner(); _lastSentReport = null; enq = []; preguntas = []; resp = true;
    await correr("104");
    out.c_noPregunta = preguntas.filter((m) => /Legajo 1/.test(m)).length === 0 && enq.length > 0;
    out.c_60s = _undoWindowMs("104") === 60000 && /— (60|59)s/.test(banner());
    return out;
  });
  const pass = Object.values(r).every(Boolean) && errs.length === 0;
  console.log("legajo1-confirma:", JSON.stringify(r), "· pageerrors:", errs.length ? errs.join("|") : "none", "·", pass ? "✓ OK" : "✗ FAIL");
  await b.close(); process.exit(pass ? 0 : 1);
})();
