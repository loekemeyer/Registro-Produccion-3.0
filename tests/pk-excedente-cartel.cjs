/* v31.82 (Luis, 16/10/2026) — EXCEDENTE SIN POSICIÓN REGISTRADA → EL CARTEL.
   "Si hay alguno que tiene excedente y no esta registrado, que le pida al operario marcar en qué gondola
    esta el excedente (en que gondola dice el cartel que esta y que, cuando llegue ahi, confirme si esta o no)"

   Corre el picking de verdad y mide:
     (a) paso de excedente sin posición → pide la posición del cartel (no se pickea todavía);
     (b) una posición mal escrita no pasa;
     (c) anotada P13 → «¿Está el excedente en P13?» con Sí / No;
     (d) Sí → paso normal en P13; «✓ Puse» manda el PKC con el 8º campo P13 (campos 5-7 en su lugar);
     (e) No está → 0 del excedente, sin 8º campo, y avanza;
     (f) con posición registrada no pregunta; el excedente marcado a mano tampoco;
     (g) «Me equivoqué de posición» vuelve a pedir el cartel.
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
    const txt = () => body().textContent.replace(/\s+/g, " ");
    const armar = (ubic, extra) => { sent = []; _pk = {
      tanda: "F12A", legajo: "277", idx: 0, mode: "item", excOk: true, results: {}, gondDone: {}, excPos: {}, excCartel: {},
      items: [Object.assign({ art: "066", key: "066·EXC", esp: 4, sector: ubic || "—", excUbic: ubic || "", excPorUbic: null,
                              exc: 4, isExc: true, emp: "LK" }, extra || {}),
              { art: "501", key: "501", esp: 3, sector: "A12", emp: "LK" }]
    }; };

    // (a)
    armar(); pkRender();
    out.pide = /D.nde est. el excedente del 066/.test(txt()) && !!document.getElementById("pkCartelInp") && !/Puse/.test(txt());
    out.sinSaltear = !/No s.|sin anotar/i.test(txt());
    // (b)
    document.getElementById("pkCartelInp").value = "cartel"; pkExcCartelAnotar();
    out.malEscrita = !!document.getElementById("pkCartelInp") && /letra y n.mero/.test(txt());
    // (c)
    document.getElementById("pkCartelInp").value = "p13"; pkExcCartelAnotar();
    out.llega = /Est. el excedente en P13/.test(txt()) && /No est/.test(txt()) && /S., est/.test(txt());
    // (d)
    pkExcCartelEsta(true);
    out.pasoNormal = /Puse 4/.test(txt()) && /P13/.test(txt());
    pkOk();
    out.pkc = sent.length ? sent[sent.length - 1].texto : "";
    out.pkcOk = out.pkc === "F12A|066|4|4|4|LK||P13" && _pk.idx === 1;
    // (e)
    armar(); pkRender();
    document.getElementById("pkCartelInp").value = "P13"; pkExcCartelAnotar(); pkExcCartelEsta(false);
    out.noEsta = sent.length ? sent[sent.length - 1].texto : "";
    out.noEstaOk = out.noEsta === "F12A|066|4|0|0|LK" && _pk.idx === 1;
    // (f)
    armar("P21"); pkRender();
    out.conPosNoPregunta = !document.getElementById("pkCartelInp") && /Puse 4/.test(txt());
    armar("P13", { manualExc: true }); pkRender();
    out.manualNoPregunta = !document.getElementById("pkCartelInp");
    // (g)
    armar(); pkRender();
    document.getElementById("pkCartelInp").value = "P13"; pkExcCartelAnotar(); pkExcCartelCambiar();
    out.cambiar = !!document.getElementById("pkCartelInp");
    return out;
  });

  await b.close();
  const fallos = []; const ok = (c, m) => { if (!c) fallos.push(m); };
  ok(r.pide, "(a) no pidió la posición del cartel");
  ok(r.sinSaltear, "(a) se puede saltear la pregunta del cartel");
  ok(r.malEscrita, "(b) dejó pasar una posición mal escrita");
  ok(r.llega, "(c) no preguntó si el excedente está en P13");
  ok(r.pasoNormal, "(d) «Sí, está» no llevó al paso de pickeo en P13");
  ok(r.pkcOk, "(d) el PKC salió «" + r.pkc + "» (esperaba F12A|066|4|4|4|LK||P13)");
  ok(r.noEstaOk, "(e) «No está» salió «" + r.noEsta + "» (esperaba F12A|066|4|0|0|LK)");
  ok(r.conPosNoPregunta, "(f) preguntó el cartel con la posición registrada");
  ok(r.manualNoPregunta, "(f) preguntó el cartel en el excedente marcado a mano");
  ok(r.cambiar, "(g) «Me equivoqué» no volvió a pedir el cartel");
  if (errs.length) fallos.push("errores de página: " + errs.join(" · "));
  if (fallos.length) { console.error("PK EXCEDENTE CARTEL — FALLA:\n  " + fallos.join("\n  ")); process.exit(1); }
  console.log("pk-excedente-cartel OK — pide el cartel, confirma al llegar y manda la posición.");
})();
