/* v31.80 (Luis, 16/10/2026) — ¿DE QUÉ POSICIÓN SACASTE EL EXCEDENTE?
   "cuando un operario tiene que pickear un articulo que esta en excedente y esta en mas de una
    gondola en excedente, que le pregunte al operario de donde lo sacó. esto es con el fin de
    identificar cuando las gondolas se vacian para liberarlas en el mapa"

   Corre el picking de verdad (index.html) y mide:
     (a) excedente en 2+ posiciones: al confirmar el paso pregunta de cuál — y el PKC ya salió ANTES;
     (b) tocar una posición re-manda el PKC (mismo id) con el 7º campo "P22:5" y avanza;
     (c) «de más de una»: no deja anotar si no suma lo pickeado; con 3+2 manda "P21:3;P22:2";
     (d) v31.81 (Luis, D1 «no»): NO hay botón para saltear la pregunta;
     (e) excedente en UNA sola posición o «Faltan» con 0: no pregunta;
     (f) sin empresa ni depósito el 7º campo no se corre de lugar (campos 5 y 6 vacíos);
     (g) pkFetchExcedente suma la misma posición escrita de dos maneras (P3 / P03).
   Sale 1 si falla. */
const path = require("path");
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
    const armar = (porUbic, emp) => { sent = []; _pk = {
      tanda: "F12A", legajo: "277", idx: 0, mode: "item", excOk: true, results: {}, gondDone: {}, excPos: {},
      items: [{ art: "066", key: "066·EXC", esp: 5, sector: Object.keys(porUbic).join(" · "), excUbic: Object.keys(porUbic).join(" · "),
                excPorUbic: porUbic, exc: 228, isExc: true, emp: emp === undefined ? "LK" : emp },
              { art: "501", key: "501", esp: 3, sector: "A12", emp: "LK" }]
    }; };
    const POS = { P21: 72, P22: 52, P23: 56 };

    // (a)
    armar(POS); pkRender(); pkOk();
    out.pkcAntes = sent.length === 1 && sent[0].opcion === "PKC" && sent[0].texto === "F12A|066|5|5|5|LK";
    out.pregunta = _pk.mode === "excPos" && /De qu. posici.n sacaste/i.test(body().textContent) && _pk.idx === 0;
    out.botones = body().querySelectorAll(".pk-excpos-btn").length === 3;

    // (b) una posición
    pkExcPosTodo(1);
    const ult = sent[sent.length - 1];
    out.campo7 = ult ? ult.texto : "";
    out.campo7Ok = out.campo7 === "F12A|066|5|5|5|LK|P22:5" && ult.id === sent[0].id;
    out.avanzo = _pk.idx === 1 && _pk.mode === "item";

    // (c) varias
    armar(POS); pkRender(); pkOk();
    pkExcPosVarias(true);
    const i0 = document.getElementById("pkExcPos0"), i1 = document.getElementById("pkExcPos1");
    out.hayInputs = !!(i0 && i1);
    if (i0) i0.value = "3";
    const n0 = sent.length;
    pkExcPosVariasOk();                                     // suma 3 de 5 → no anota
    out.frenaSuma = sent.length === n0 && _pk.mode === "excPos" && /sumar 5/.test(body().textContent);
    if (i1) i1.value = "2";
    pkExcPosVariasOk();
    out.varias = sent.length ? sent[sent.length - 1].texto : "";
    out.variasOk = out.varias === "F12A|066|5|5|5|LK|P21:3;P22:2" && _pk.idx === 1;

    // (d) sin salteo: ningún botón que avance sin anotar la posición
    armar(POS); pkRender(); pkOk();
    out.skip = !/No s.|sin anotar/i.test(body().textContent) &&
               ![...body().querySelectorAll("button")].some((x) => /pkExcPosSkip|pkNext/.test(x.getAttribute("onclick") || ""));

    // (e) una sola posición / Faltan con 0
    armar({ P21: 72 }); pkRender(); pkOk();
    out.unaNoPregunta = _pk.mode !== "excPos" && _pk.idx === 1;
    armar(POS); pkRender(); pkF(); pkRender();
    const f = document.getElementById("pkFqty"); if (f) f.value = "0";
    pkConfirmF();
    out.ceroNoPregunta = _pk.mode !== "excPos" && _pk.idx === 1;
    armar(POS); pkRender(); pkF(); pkRender();
    const f2 = document.getElementById("pkFqty"); if (f2) f2.value = "2";
    pkConfirmF();
    out.faltanPregunta = _pk.mode === "excPos";

    // (f) sin depósito ni empresa: campos 5 y 6 vacíos, la posición en el 7º
    armar(POS, ""); _pk.excOk = false; pkRender(); pkOk(); pkExcPosTodo(0);
    out.posicional = sent[sent.length - 1].texto;
    out.posicionalOk = out.posicional === "F12A|066|5|5|||P21:5";

    // (g) pkFetchExcedente
    window.fetch = async function (url) {
      const J = (rows) => ({ ok: true, status: 200, json: async () => rows, headers: { get: () => null } });
      if (String(url).indexOf("vista_saldos_stock") >= 0) return J([{ clave: "066", cod_art: "066", excedente: 137 }]);
      if (String(url).indexOf("gv_excedente_posicion") >= 0)
        return J([{ clave: "066", sector: "P3", orden: 720, cajas: 80 }, { clave: "066", sector: "P03", orden: 720, cajas: 1 },
                  { clave: "066", sector: "P22", orden: 739, cajas: 56 }]);
      return J([]);
    };
    const ex = await pkFetchExcedente(["066"]);
    out.porUbic = JSON.stringify(ex["066"] && ex["066"].porUbic);
    out.porUbicOk = out.porUbic === JSON.stringify({ P03: 81, P22: 56 });
    return out;
  });

  await b.close();
  const fallos = []; const ok = (c, m) => { if (!c) fallos.push(m); };
  ok(r.pkcAntes, "(a) el PKC no salió ANTES de preguntar la posición");
  ok(r.pregunta, "(a) no preguntó de qué posición sacó el excedente");
  ok(r.botones, "(a) no hay un botón por posición");
  ok(r.campo7Ok, "(b) el PKC re-mandado salió «" + r.campo7 + "» (esperaba F12A|066|5|5|5|LK|P22:5, mismo id)");
  ok(r.avanzo, "(b) no avanzó después de anotar");
  ok(r.hayInputs, "(c) «de más de una» no muestra las cantidades");
  ok(r.frenaSuma, "(c) dejó anotar posiciones que no suman lo pickeado");
  ok(r.variasOk, "(c) varias salió «" + r.varias + "»");
  ok(r.skip, "(d) la pregunta de posición se puede saltear (D1: no)");
  ok(r.unaNoPregunta, "(e) preguntó con el excedente en una sola posición");
  ok(r.ceroNoPregunta, "(e) preguntó con 0 cajas levantadas");
  ok(r.faltanPregunta, "(e) no preguntó con «Faltan» y 2 cajas");
  ok(r.posicionalOk, "(f) sin depósito ni empresa salió «" + r.posicional + "» (esperaba F12A|066|5|5|||P21:5)");
  ok(r.porUbicOk, "(g) porUbic = " + r.porUbic);
  if (errs.length) fallos.push("errores de página: " + errs.join(" · "));
  if (fallos.length) { console.error("PK EXCEDENTE POSICIÓN — FALLA:\n  " + fallos.join("\n  ")); process.exit(1); }
  console.log("pk-excedente-posicion OK — pregunta la posición, manda el 7º campo y no pregunta de más.");
})();
