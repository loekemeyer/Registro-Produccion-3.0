/* Regresión v7.68 — MG (Guardado a Góndola) dejó de ser un toggle:
   (A) v25.86: apretar MG lo SELECCIONA y «Enviar» empieza la tarea (botón rojo, abre el chooser);
       tocarlo abierto re-abre el módulo.
   (B) cerrar el módulo termina la tarea y la deja en el Historial con su duración.
   (C) confirmar un guardado emite UN evento MG con ts_inicio (duración) y entra al historial;
       tras confirmar el botón tampoco queda rojo.
   (D) migrateClearMGToggle limpia un st.toggles.MG viejo (arregla el botón rojo pegado).
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
  await p.route("**/*.supabase.co/**", (r) => r.abort());   // v25.86: el test llama send(): sin red
  await p.goto("file://" + path.join(root, "index.html"), { waitUntil: "domcontentloaded" });

  const r = await p.evaluate(async () => {
    const out = {};
    const sent = [];
    window.alert = function () {};
    window.confirm = function () { return true; };
    window.stockMove = function () {};
    window.emitGuardadoSesion = function () {};
    window.loadArtNombres = async function () { return {}; };
    window.stockFetchSaldos = async function () { return { "502": { cod: "502", desc: "X", a_guardar: 10, terminado: 0 } }; };
    window.ocgFetchCapacidad = async function () { return {}; };
    window.ocgFetchCeldas = async function () { return {}; };
    window.ocgDemanda = async function () { return {}; };
    window.rkbFetchCxM = async function () { return { cxm: {} }; };
    window.trySendOneReport = async function (pl) { sent.push(pl); return { ok: true }; };

    localStorage.clear();
    legajoInput.value = "77";

    // ===== (A) v25.86: apretar MG SÓLO lo selecciona (como RR); «Enviar» empieza la tarea =====
    const vis = function () { const ov = document.getElementById("mgChooserModal"); return !!ov && ov.style.display !== "none" && ov.style.display !== ""; };
    selectOption("MG");
    const st1 = getLegajoState("77");
    out.aNoToggle = !(st1.toggles && st1.toggles.MG);
    out.aSeleccionaSinAbrir = !vis() && !document.getElementById("selectedArea").classList.contains("hidden");
    out.aSinEvento = sent.length === 0;
    await send();
    out.aEnviarAbre = vis() && !!(getLegajoState("77").mg && getLegajoState("77").mg.active) &&
      document.querySelector('[data-code="MG"]').classList.contains("pending");
    // tocar MG con la tarea abierta RE-ABRE el módulo
    document.getElementById("mgChooserModal").style.display = "none";
    selectOption("MG");
    out.bReentraAbierta = vis();

    // ===== (B) cerrar el módulo TERMINA la tarea: queda en el Historial con su duración =====
    closeMGChooser();
    await new Promise((res) => setTimeout(res, 500));
    const st2 = getLegajoState("77");
    out.bTerminaAlCerrar = !(st2.mg && st2.mg.active) && !(st2.toggles && st2.toggles.MG) &&
      !document.querySelector('[data-code="MG"]').classList.contains("pending");
    out.bEnHistorial = readDayHist(getTodayKey(), "77").some((x) => x.opcion === "MG" && x.ts_inicio_iso);
    out.bSinEventoGenerico = sent.filter((x) => x && x.opcion === "MG").length === 0;
    localStorage.clear();
    legajoInput.value = "77";

    // ===== (C) confirmar un guardado emite UN evento MG con ts_inicio =====
    sent.length = 0;
    await showMGModal("77");
    await new Promise((res) => setTimeout(res, 40));
    mgSet(0, 3);                 // 3 cajas a góndola
    await new Promise((res) => setTimeout(res, 20));
    mgConfirmar();
    await new Promise((res) => setTimeout(res, 20));
    const mgEvents = sent.filter((x) => x && x.opcion === "MG");
    out.cUnEvento = mgEvents.length === 1;
    out.cConDuracion = !!(mgEvents[0] && mgEvents[0].ts_inicio_iso);
    out.cTextoVacio = !!(mgEvents[0] && mgEvents[0].texto === "");
    const hist = readDayHist(getTodayKey(), "77").filter((x) => x.opcion === "MG");
    out.cEnHistorial = hist.length === 1;
    const st3 = getLegajoState("77");
    out.cNoToggle = !(st3.toggles && st3.toggles.MG);   // confirmar tampoco deja el botón rojo

    // ===== (D) botón rojo pegado de la versión vieja (st.toggles.MG dejado antes de v7.68):
    //          aun con el flag viejo el botón MG NO se pinta rojo (MG salió de TOGGLE_CODES),
    //          y la migración borra el flag. Reproduce el caso reportado (legajo con MG rojo). =====
    const m = readStateMap();
    m["88"] = { picking: { active: false, value: "" }, armado: { active: false, value: "" }, toggles: { MG: new Date().toISOString() }, continuar: {} };
    writeStateMap(m);
    out.dAntes = !!(getLegajoState("88").toggles.MG);
    legajoInput.value = "88";
    updateCoreButtonsState();
    const mgBox = document.querySelector('.box[data-code="MG"]');
    out.dNoRojoConFlag = !!(mgBox && !mgBox.classList.contains("pending"));   // aun con flag viejo: NO rojo
    migrateClearMGToggle();
    out.dDespues = !(getLegajoState("88").toggles.MG);
    updateCoreButtonsState();
    out.dNoRojoFinal = !!(mgBox && !mgBox.classList.contains("pending"));

    return out;
  });

  const checks = [
    ["A no-toggle", r.aNoToggle], ["A selecciona sin abrir", r.aSeleccionaSinAbrir], ["A sin evento", r.aSinEvento],
    ["A Enviar abre la tarea", r.aEnviarAbre], ["A abierta re-abre el módulo", r.bReentraAbierta],
    ["B cerrar termina la tarea", r.bTerminaAlCerrar], ["B en historial", r.bEnHistorial], ["B sin evento genérico", r.bSinEventoGenerico],
    ["C un evento MG", r.cUnEvento], ["C con duración", r.cConDuracion], ["C texto vacío", r.cTextoVacio],
    ["C en historial", r.cEnHistorial], ["C no-toggle tras confirmar", r.cNoToggle],
    ["D había MG viejo", r.dAntes], ["D botón NO rojo con flag viejo", r.dNoRojoConFlag],
    ["D se limpió", r.dDespues], ["D botón NO rojo tras migración", r.dNoRojoFinal],
  ];
  const pass = checks.every((c) => c[1]) && errs.length === 0;
  console.log("mg-reentrada:", JSON.stringify(r), "· pageerrors:", errs.length ? errs.join("|") : "none");
  checks.forEach((c) => console.log("  " + (c[1] ? "✓" : "✗") + " " + c[0]));
  console.log(pass ? "✓ OK" : "✗ FAIL");
  await b.close();
  process.exit(pass ? 0 : 1);
})();
