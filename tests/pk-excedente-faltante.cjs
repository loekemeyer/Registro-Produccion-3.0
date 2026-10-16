/* v32.00 (Luis, 16/10/2026)
   D8 — "preguntale al operario por cual paso que faltaba": con 2+ posiciones el operario marca en cuál no estaba.
   D5 — "excedente con posición registrada que el operario no encuentra ahí … Deberia llegarle, simple y se ajusta de ahi":
        «Sin stock» / «Faltan» en un paso de excedente con posición manda «-P21;-P22» en el 8º campo del PKC
        (un aviso por posición en la landing; ✓ vacía esa posición). Volver a confirmar completo lo saca.
   D6 — "que le aparezca en el front al operario que si o si tiene que poner la posicion y que se despliegue la lista de
        posiciones en el mapa para que no puedan poner cualquier cosa": la posición del excedente se elige de una lista
        desplegable con la zona P del Mapa (guardado y cartel del picking); sin la lista, el input de antes.
   Sale 1 si falla. */
const path = require("path");
const fs = require("fs");
let chromium;
try { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }
catch (_e) { try { ({ chromium } = require("playwright")); } catch (_e2) { console.error("Playwright no encontrado."); process.exit(2); } }

const APP = process.env.PK_APP || path.join(__dirname, "..", "virgilio", "index.html");

(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 430, height: 880 }, serviceWorkers: "block" })).newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.route("**/rest/v1/**", (r) => r.abort());
  await p.goto("file://" + APP, { waitUntil: "domcontentloaded" });

  const r = await p.evaluate(async () => {
    const espera = (ms) => new Promise((res) => setTimeout(res, ms));
    for (let i = 0; i < 60 && typeof window.pkRender !== "function"; i++) await espera(100);
    const out = {}; let sent = [];
    window.enqueueReport = function (pl) { sent.push(pl); };
    window.trySendOneReport = null;
    window.updatePendingIndicator = function () {};
    let m = document.getElementById("tandaModal");
    if (!m) { m = document.createElement("div"); m.id = "tandaModal";
      m.innerHTML = '<div class="tanda-modal-body"></div><div class="tanda-modal-foot"></div>';
      document.body.appendChild(m); }
    const body = () => m.querySelector(".tanda-modal-body");
    const armar = (ubic, porUbic) => { sent = []; _pk = {
      tanda: "F12A", legajo: "277", idx: 0, mode: "item", excOk: true, results: {}, gondDone: {}, excPos: {}, excCartel: {},
      items: [{ art: "066", key: "066·EXC", esp: 4, sector: ubic || "—", excUbic: ubic || "", excPorUbic: porUbic || null,
                exc: 4, isExc: true, emp: "LK" },
              { art: "501", key: "501", esp: 3, sector: "A12", emp: "LK" }]
    }; };
    const ult = () => (sent.length ? sent[sent.length - 1].texto : "");

    // D5 + D8 — Sin stock en un excedente con 2 posiciones: primero sale el PKC sin aviso, después pregunta
    // en cuál fue y no estaba (sin salteo: al menos una) y re-manda con esa sola
    armar("P21 · P22", { P21: 72, P22: 52 }); pkRender(); pkSinStock();
    out.antes = ult();
    out.pregunta = _pk.mode === "excFalta" && /En qu. posici.n fuiste y no estaba/.test(body().textContent) && _pk.idx === 0;
    pkExcFaltaOk();
    out.frenaVacio = _pk.mode === "excFalta" && /al menos una/.test(body().textContent);
    pkExcFaltaToggle(1); pkExcFaltaOk();
    out.sinStock = ult();
    out.sinStockOk = out.antes === "F12A|066|4|0|0|LK" && out.pregunta && out.frenaVacio &&
                     out.sinStock === "F12A|066|4|0|0|LK||-P22" && _pk.idx === 1;
    // Faltan con 1 posición
    armar("P21", { P21: 72 }); pkRender(); pkF(); pkRender();
    document.getElementById("pkFqty").value = "1"; pkConfirmF();
    out.faltan = ult();
    out.faltanOk = out.faltan === "F12A|066|4|1|1|LK||-P21";
    // vuelve y confirma completo → sin aviso
    _pk.idx = 0; pkRender(); pkOk();
    out.completo = ult();
    out.completoOk = out.completo === "F12A|066|4|4|4|LK";
    // completo de una: sin 8º campo
    armar("P21", { P21: 72 }); pkRender(); pkOk();
    out.okDirecto = ult() === "F12A|066|4|4|4|LK";

    // D6 — lista desplegable de la zona P
    window._gvLugares = null;
    try { _gvLugares = { lista: ["A01", "P01", "P13", "P21", "O05", "AD02"], set: new Set(["A01", "P01", "P13", "P21", "O05", "AD02"]), libres: new Set(), emp: {}, orden: {} }; } catch (_e) {}
    armar(); pkRender();
    const sel = document.getElementById("pkCartelInp");
    out.esSelect = !!sel && sel.tagName === "SELECT";
    out.opciones = sel ? [...sel.options].map((o) => o.value).join(",") : "";
    out.opcionesOk = out.opciones === ",P01,P13,P21";
    if (sel) { sel.value = "P13"; pkExcCartelAnotar(); }
    out.cartelSigue = /Est. el excedente en P13/.test(body().textContent);
    // sin elegir no pasa
    armar(); pkRender(); pkExcCartelAnotar();
    out.sinElegir = !!document.getElementById("pkCartelInp") && /Eleg. la posici/.test(body().textContent);
    // helper del guardado
    out.mgSelect = gvExcPosSelect('class="x"', "P13");
    out.mgSelectOk = /<select class="x">/.test(out.mgSelect) && /value="P13" selected/.test(out.mgSelect) && !/A01/.test(out.mgSelect);
    try { _gvLugares = { lista: [], set: new Set() }; } catch (_e) {}
    out.sinLista = gvExcPosSelect('class="x"', "") === "";
    return out;
  });
  await b.close();
  const src = fs.readFileSync(APP, "utf8");
  const mgUsaLista = /const ubicInp = gvExcPosSelect\(/.test(src);
  const fallos = []; const ok = (c, m) => { if (!c) fallos.push(m); };
  ok(r.sinStockOk, "(D8) Sin stock con 2 posiciones: antes «" + r.antes + "» · pregunta " + r.pregunta + " · frena vacío " + r.frenaVacio + " · después «" + r.sinStock + "» (esperaba …||-P22)");
  ok(r.faltanOk, "(D5) Faltan salió «" + r.faltan + "» (esperaba F12A|066|4|1|1|LK||-P21)");
  ok(r.completoOk, "(D5) re-confirmar completo salió «" + r.completo + "» (tiene que ir sin aviso)");
  ok(r.okDirecto, "(D5) «Puse» completo mandó aviso");
  ok(r.esSelect, "(D6) la posición del cartel no es una lista desplegable");
  ok(r.opcionesOk, "(D6) la lista trae «" + r.opciones + "» (esperaba sólo la zona P)");
  ok(r.cartelSigue, "(D6) elegir P13 no siguió a «¿Está en P13?»");
  ok(r.sinElegir, "(D6) dejó seguir sin elegir posición");
  ok(r.mgSelectOk, "(D6) gvExcPosSelect no arma la lista: " + r.mgSelect);
  ok(r.sinLista, "(D6) sin lista del Mapa tiene que volver al input de antes");
  ok(mgUsaLista, "(D6) el guardado (MG) no usa la lista desplegable");
  if (errs.length) fallos.push("errores de página: " + errs.join(" · "));
  if (fallos.length) { console.error("PK EXCEDENTE FALTANTE — FALLA:\n  " + fallos.join("\n  ")); process.exit(1); }
  console.log("pk-excedente-faltante OK — avisa la posición donde faltó y la posición se elige de la zona P.");
})();
