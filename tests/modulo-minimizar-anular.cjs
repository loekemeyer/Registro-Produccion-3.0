/* v26.83 (Luis, 05/10) — «Si envía bajada de racks y cierra con el botón de cerrar de arriba, se debería
   considerar que sigue bajando de racks … agregar un botón "Anular bajada" … lo mismo con guardado a góndola»
   y «fijate si hay algún otro módulo donde aplique este problema» (Ingreso a racks).

   Caso que lo originó: Isidro (94) entró 3 veces a Bajar de racks; cada entrada mandaba un RKI nuevo y el
   tiempo de antes caía a tiempo muerto. Se prueba, en los tres módulos:
     A) «Cerrar» de arriba MINIMIZA: no manda el cierre (RKB / IRT / MGC), la tarea sigue abierta y el botón rojo.
     B) volver a entrar sigue el MISMO tramo: sin RKI / IRI / MGI nuevo y con la hora de inicio de antes —
        también si la app se reinició en el medio (el módulo ya no está en memoria).
     C) «Anular» está abajo y sale: manda el cierre con texto ANULADO, cierra la tarea y el botón deja de estar rojo.
     D) el monitor del admin no cuenta el tramo ANULADO como movimiento (≡ la vista: mov_s saca el ANULADO).
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

  const r = await p.evaluate(async () => {
    const out = {};
    const sent = [];
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    window.alert = function () {};
    window.confirm = function () { return true; };
    window.stockMove = function () {};
    window.emitGuardadoSesion = function () {};
    window.loadArtNombres = async function () { return {}; };
    window.stockFetchSaldos = async function () { return { "502": { cod: "502", desc: "X", racks: 20, a_guardar: 10, terminado: 0, excedente: 0 } }; };
    window.stockFetchArtFactors = async function () { return {}; };
    window.ocgFetchCapacidad = async function () { return {}; };
    window.ocgFetchCeldas = async function () { return {}; };
    window.ocgDemanda = async function () { return {}; };
    window.rkbFetchCxM = async function () { return { cxm: {}, locs: {} }; };
    window.gvFetchLugares = async function () { return null; };
    window.racksFetchPlani = async function () { return [{ sector: "AD05", estado: "libre", cod_art: null }]; };
    window.irFetchCxM = async function () { return {}; };
    window.trySendOneReport = async function (pl) { sent.push(pl); return { ok: true }; };
    const de = (op) => sent.filter((x) => x && x.opcion === op);
    const rojo = (code) => { updateCoreButtonsState(); const bx = [...document.querySelectorAll(".box")].find((x) => (x.querySelector(".box-title") || {}).innerText === code);
                             return !!(bx && bx.classList.contains("pending")); };
    const visible = (id) => { const e = document.getElementById(id); return !!(e && e.classList.contains("show")); };

    localStorage.clear();
    legajoInput.value = "77";

    // ===================== BAJAR DE RACKS =====================
    await showRacksBajarModal("77");
    await wait(30);
    const ini = getLegajoState("77").racks && getLegajoState("77").racks.ts;
    out.brAbreUnRKI = de("RKI").length === 1 && !!ini;
    out.brAnularAbajo = !!document.querySelector('#rkbBody button.gv-anular[onclick="rkbAnular()"]') &&
                        /Anular bajada/.test(document.querySelector("#rkbBody .gv-anular").textContent);
    // A) Cerrar minimiza
    rkbAskClose();
    out.brCerrarMinimiza = !visible("rkbModal") && de("RKB").length === 0 && !!getLegajoState("77").racks.active;
    out.brRojoMinimizado = rojo("BR");
    // B) volver a entrar (en memoria) = mismo tramo
    await wait(15);
    await showRacksBajarModal("77");
    out.brReentraMismo = visible("rkbModal") && de("RKI").length === 1 && _rkb && _rkb.tsInicio === ini;
    // B') app reiniciada: el módulo ya no está en memoria, la tarea sí
    rkbAskClose(); _rkb = null;
    await showRacksBajarModal("77");
    await wait(30);
    out.brReinicioMismo = de("RKI").length === 1 && _rkb && _rkb.tsInicio === ini;
    // C) Anular
    rkbAnular();
    const rkb = de("RKB");
    out.brAnularCierra = rkb.length === 1 && rkb[0].texto === "ANULADO" && !!rkb[0].ts_inicio_iso &&
                         Date.parse(rkb[0].ts_inicio_iso) === ini && !getLegajoState("77").racks.active && !visible("rkbModal") && _rkb === null;
    out.brNoRojoTrasAnular = !rojo("BR");

    // ===================== INGRESO A RACKS =====================
    sent.length = 0;
    await showIngresoRacksModal("77");
    await wait(30);
    const iniIr = getLegajoState("77").ir && getLegajoState("77").ir.ts;
    out.irAbreUnIRI = de("IRI").length === 1 && !!iniIr;
    out.irAnularAbajo = !!document.querySelector('#irBody button.gv-anular[onclick="irAnular()"]');
    out.irCerrarEsMinimizar = /irMinimizar\(\)/.test((document.querySelector("#irModal .ir-close") || {}).getAttribute ? document.querySelector("#irModal .ir-close").getAttribute("onclick") : "");
    irMinimizar();
    out.irCerrarMinimiza = !visible("irModal") && de("IRT").length === 0 && !!getLegajoState("77").ir.active;
    out.irRojoMinimizado = rojo("IR");
    selectOption("IR");                         // tocar IR con el ingreso minimizado
    await wait(15);
    out.irReentraMismo = visible("irModal") && de("IRI").length === 1 && _ir && _ir.tsInicio === iniIr;
    irMinimizar(); _ir = null;                  // app reiniciada
    await showIngresoRacksModal("77");
    await wait(30);
    out.irReinicioMismo = de("IRI").length === 1 && _ir && _ir.tsInicio === iniIr;
    irAnular();
    const irt = de("IRT");
    out.irAnularCierra = irt.length === 1 && irt[0].texto === "ANULADO" && Date.parse(irt[0].ts_inicio_iso) === iniIr &&
                         !getLegajoState("77").ir.active && !visible("irModal") && _ir === null;
    out.irNoRojoTrasAnular = !rojo("IR");

    // ===================== GUARDADO A GÓNDOLA =====================
    sent.length = 0;
    selectOption("MG");
    await send();                               // «Enviar» empieza la tarea y abre el chooser
    await wait(20);
    document.getElementById("mgChooserModal").style.display = "none";
    await showMGModal("77");                    // «Lo que llegó»
    await wait(40);
    const tr = getLegajoState("77").mg && getLegajoState("77").mg.tramo;
    out.mgAbreUnMGI = de("MGI").length === 1 && !!tr && _mg && _mg.tsInicio === tr;
    out.mgAnularAbajo = !!document.querySelector('#mgBody button.gv-anular[onclick="mgAnular()"]');
    mgAskClose();
    out.mgCerrarMinimiza = !visible("mgModal") && de("MGC").length === 0 && !!getLegajoState("77").mg.active;
    out.mgRojoMinimizado = rojo("MG");
    selectOption("MG");                         // tocar MG con el guardado minimizado: vuelve el MISMO
    await wait(15);
    out.mgReentraMismo = visible("mgModal") && de("MGI").length === 1 && _mg && _mg.tsInicio === tr;
    mgAskClose(); _mg = null;                   // app reiniciada
    await showMGModal("77");
    await wait(40);
    out.mgReinicioMismo = de("MGI").length === 1 && _mg && _mg.tsInicio === tr;
    mgAnular();
    const mgc = de("MGC");
    const st = getLegajoState("77");
    out.mgAnularCierra = mgc.length === 1 && mgc[0].texto === "ANULADO" && !(st.mg && st.mg.active) && !visible("mgModal") && _mg === null;
    out.mgNoRojoTrasAnular = !rojo("MG");
    out.mgHistorialAnulado = readDayHist(getTodayKey(), "77").some((x) => x.opcion === "MG" && String(x.texto || "") === "ANULADO");
    return out;
  });

  // D) el monitor del admin no cuenta el tramo ANULADO como movimiento (≡ vista)
  const fs = require("fs");
  const html = fs.readFileSync(path.join(root, "index.html"), "latin1");
  const dMonitor = /tanda === "ANULADO" && ev\.ts_inicio && MOV_TOGGLE_CODES\.has\(ev\.opcion\)\) continue;/.test(html);

  const checks = [
    ["BR abre un solo RKI", r.brAbreUnRKI], ["BR «Anular bajada» abajo", r.brAnularAbajo],
    ["BR Cerrar minimiza (sin RKB, tarea abierta)", r.brCerrarMinimiza], ["BR rojo minimizado", r.brRojoMinimizado],
    ["BR re-entrar = mismo tramo", r.brReentraMismo], ["BR tras reinicio = mismo tramo", r.brReinicioMismo],
    ["BR Anular → RKB ANULADO y cierra", r.brAnularCierra], ["BR no rojo tras anular", r.brNoRojoTrasAnular],
    ["IR abre un solo IRI", r.irAbreUnIRI], ["IR «Anular ingreso» abajo", r.irAnularAbajo], ["IR Cerrar = minimizar", r.irCerrarEsMinimizar],
    ["IR Cerrar minimiza (sin IRT)", r.irCerrarMinimiza], ["IR rojo minimizado", r.irRojoMinimizado],
    ["IR re-entrar = mismo tramo", r.irReentraMismo], ["IR tras reinicio = mismo tramo", r.irReinicioMismo],
    ["IR Anular → IRT ANULADO y cierra", r.irAnularCierra], ["IR no rojo tras anular", r.irNoRojoTrasAnular],
    ["MG abre un solo MGI", r.mgAbreUnMGI], ["MG «Anular guardado» abajo", r.mgAnularAbajo],
    ["MG Cerrar minimiza (sin MGC)", r.mgCerrarMinimiza], ["MG rojo minimizado", r.mgRojoMinimizado],
    ["MG re-entrar = mismo tramo", r.mgReentraMismo], ["MG tras reinicio = mismo tramo", r.mgReinicioMismo],
    ["MG Anular → MGC ANULADO y cierra", r.mgAnularCierra], ["MG no rojo tras anular", r.mgNoRojoTrasAnular],
    ["MG anulado en el Historial", r.mgHistorialAnulado],
    ["D monitor: ANULADO no es movimiento", dMonitor],
  ];
  const pass = checks.every((c) => c[1]) && errs.length === 0;
  console.log("modulo-minimizar-anular: pageerrors:", errs.length ? errs.join(" | ") : "none");
  checks.forEach((c) => console.log("  " + (c[1] ? "✓" : "✗") + " " + c[0]));
  console.log(pass ? "modulo-minimizar-anular: ✓ OK" : "modulo-minimizar-anular: ✗ FAIL");
  await b.close();
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.log("modulo-minimizar-anular: ✗ ERROR " + e.message); process.exit(1); });
