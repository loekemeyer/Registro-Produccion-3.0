/* v25.63 (Luis, 01/10): "RR tampoco tiene botón de anular, así que si entrás al módulo y no hacés
   nada, no podés salir · que puedan salir anulando la tarea completamente · que se registre que
   apretaron para empezar y que la anularon".
   Para RR, CC (lista y chooser) y CR CON items en la lista: tiene que estar el ⛔ ANULAR, y al
   tocarlo el toggle queda CERRADO y sale el cierre con el MISMO código, texto "ANULADO" y el
   inicio de la apertura (así el horario muestra el tramo y que se anuló). */
const path = require("path");
let chromium;
try { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }
catch (_e) { try { ({ chromium } = require("playwright")); } catch (_e2) { console.error("Playwright no encontrado"); process.exit(2); } }
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto("file://" + path.join(__dirname, "..", "virgilio", "index.html"), { waitUntil: "domcontentloaded" });
  const r = await p.evaluate(async () => {
    const LEG = "104", out = {};
    window.fetch = () => Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve([]), text: () => Promise.resolve("") });
    window.confirm = () => true; window.alert = () => {};
    const sent = [];
    const _enq = window.enqueueReport;
    window.enqueueReport = function (pl) { sent.push(pl); };
    const abrir = (code) => { const st = getLegajoState(LEG); st.toggles = st.toggles || {}; st.toggles[code] = new Date(Date.now() - 600000).toISOString(); setLegajoState(LEG, st); };
    const m = document.getElementById("tandaModal");
    const items = [{ np: "LK 0122", tanda: "E30A", rs: "Inc", cod: "1651", lios: 3, clase: "", cajas: 10 }];
    const caso = (code, render, sel) => {
      sent.length = 0; abrir(code); render(); m.classList.add("show");
      const btn = Array.from(m.querySelectorAll("button.pk-anular")).find((x) => x.textContent.indexOf("ANULAR") >= 0);
      if (!btn) return "sin botón";
      btn.click();
      const st = getLegajoState(LEG);
      const ev = sent.find((x) => x.opcion === code);
      if (st.toggles[code]) return "toggle sigue abierto";
      if (!ev) return "no emitió el cierre";
      if (ev.texto !== "ANULADO" || !ev.ts_inicio_iso) return "cierre sin ANULADO/inicio: " + JSON.stringify(ev);
      return "ok";
    };
    out.RR = caso("RR", () => { _cr = { legajo: LEG, admin: false, items: items.slice(), checked: new Set() }; crRender(); });
    out.CC = caso("CC", () => { _cc = { legajo: LEG, mode: "camion", items: items.slice(), checked: new Set(), camioneros: [] }; ccRender(); });
    out.CCchooser = caso("CC", () => { _cc = null; ccRenderChooser(LEG); });
    out.CR = caso("CR", () => { _ccr = { legajo: LEG, items: items.slice(), checked: new Set() }; ccrRender(); });
    // el admin de RR (sin toggle ni botonera) no lleva ANULAR
    _cr = { legajo: "sup:x", admin: true, items: items.slice(), checked: new Set() }; crRender();
    out.adminSinAnular = !m.querySelector("button.pk-anular");
    window.enqueueReport = _enq;
    return out;
  });
  await b.close();
  const ok = r.RR === "ok" && r.CC === "ok" && r.CCchooser === "ok" && r.CR === "ok" && r.adminSinAnular && !errs.length;
  console.log("toggle-anular: " + (ok ? "OK" : "FALLÓ") + " — " + JSON.stringify(r) + (errs.length ? " · errores: " + errs.join(" | ") : ""));
  process.exit(ok ? 0 : 1);
})();
