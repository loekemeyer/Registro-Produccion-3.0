/* v25.65 (Luis) — en la botonera: «Tiempo muerto» del día (jornada − prod − mov − no prod de
   gv_monitor_horas_operario, corre solo sin tarea abierta, "—" si no se pudo leer), botón
   «Historial de tareas» (el mismo Resumen de hoy, que vuelve a su lugar al cerrar) y el
   Deshacer adentro de la botonera. Sale 1 si falla.
   v25.77 (Luis): el contador es el tiempo desde el ÚLTIMO evento (empezó/terminó una tarea), NO el
   acumulado del día: se reinicia con cada evento, marca 0 con tarea abierta y toma el último
   ts_cliente de la base. */
const path = require("path");
let chromium;
try { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }
catch (_e) { try { ({ chromium } = require("playwright")); } catch (_e2) { console.error("Playwright no encontrado."); process.exit(2); } }
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 390, height: 800 } }); const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  let falla = false, srvTs = null;
  await p.route("**/*.supabase.co/**", (r) => {
    const u = r.request().url();
    if (u.includes("Registros_Produccion_Virgilio?select=ts_cliente")) {
      if (falla) return r.fulfill({ status: 500, body: "{}" });
      const ts = srvTs || new Date(Date.now() - 3600 * 1000).toISOString();   // último evento hace 1 h
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ ts_cliente: ts }]) });
    }
    return r.abort();
  });
  await p.goto("file://" + path.join(__dirname, "..", "virgilio", "index.html"), { waitUntil: "domcontentloaded" });
  const r = await p.evaluate(async () => {
    const out = {}; const sl = ms => new Promise(res => setTimeout(res, ms));
    window.alert = function () {}; window.confirm = function () { return true; };
    legajoInput.value = "999";
    goToOptions();
    await sl(400);
    const val = () => document.getElementById("tmMuertoVal").textContent;
    out.muertoUnaHora = /^1:00:0\d$/.test(val());          // último evento en la base hace 1 h
    // con picking abierto marca 0 y no corre
    const st = getLegajoState("999"); st.picking = { active: true }; setLegajoState("999", st);
    await sl(1200); out.ceroConTarea = val() === "0:00:00";
    st.picking = { active: false }; setLegajoState("999", st);
    await sl(1200); out.arrancaDeCeroAlTerminar = /^0:00:0[0-3]$/.test(val());
    // un evento nuevo (empezó/terminó una tarea) lo reinicia
    tmMarcarEvento("999", Date.now() - 5000); tmMarcarEvento("999", Date.now()); await sl(50);
    out.reiniciaConEvento = /^0:00:0[0-2]$/.test(val());
    // el contador y el botón están dentro de la botonera, arriba de los botones
    const bar = document.getElementById("tmBar");
    out.enBotonera = !!bar && document.getElementById("optionsScreen").contains(bar) &&
      bar.getBoundingClientRect().top < document.getElementById("row1").getBoundingClientRect().top;
    out.undoEnBotonera = document.getElementById("optionsScreen").contains(document.getElementById("undoBanner"));
    out.sinScrollHoriz = document.documentElement.scrollWidth <= window.innerWidth;
    // historial: se abre con el resumen y vuelve a su lugar
    histTareasAbrir();
    const cont = document.getElementById("legajoHistoryContent");
    out.histAbre = !document.getElementById("histTareasOv").classList.contains("hidden") &&
      document.getElementById("histTareasBody").contains(cont);
    histTareasCerrar();
    out.histVuelve = document.getElementById("legajoHistorySpace").contains(cont) &&
      document.getElementById("histTareasOv").classList.contains("hidden");
    return out;
  });
  // enqueueReport sella el evento aunque el legajo sea de prueba (no persiste, pero reinicia)
  r.enqueueReinicia = await p.evaluate(async () => {
    const sl = ms => new Promise(res => setTimeout(res, ms));
    localStorage.removeItem(_tmUltKey("999")); tmStart("999"); await sl(1300);
    enqueueReport({ legajo: "999", opcion: "RT", ts: Date.now(), id: "x_tm_" + Date.now() }); await sl(50);
    return /^0:00:0[0-1]$/.test(document.getElementById("tmMuertoVal").textContent);
  });
  r.calendarioOculto = await p.evaluate(() => getComputedStyle(document.getElementById("btnHistDias")).display === "none");
  falla = true;
  // sin lectura de la base sigue con lo local (no vuelve a un acumulado ni a "—")
  r.lecturaRotaSigue = await p.evaluate(async () => { await tmLeer(); return /^0:00:\d\d$/.test(document.getElementById("tmMuertoVal").textContent); });
  const pass = Object.values(r).every(Boolean) && errs.length === 0;
  console.log("botonera-tm-historial:", JSON.stringify(r), "· pageerrors:", errs.length ? errs.join("|") : "none", "·", pass ? "✓ OK" : "✗ FAIL");
  await b.close(); process.exit(pass ? 0 : 1);
})();
