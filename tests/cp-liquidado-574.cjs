/* Regresión v31.64 — Completar pedido completa con 574E un faltante del 574 liquidado (Luis, 16/10).

   El 574 nacional se liquidó dentro de los pedidos de 574E y queda discontinuado. Si una fila de
   faltante llega con el código viejo, CP tiene que mostrarla y completarla como 574E.

   Chequea:
   - A: faltante "574" de una NP de LK → 574E (con _cod_orig = 574).
   - B: faltante "574E" → sigue 574E.
   - C: otro código ("502") → sin cambio.
   Sale 1 si falla. */
const path = require("path");
let chromium;
try { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }
catch (_e) {
  try { ({ chromium } = require("playwright")); }
  catch (_e2) { console.error("Playwright no encontrado."); process.exit(2); }
}
(async () => {
  const root = path.join(__dirname, "..");
  const b = await chromium.launch();
  const p = await b.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto("file://" + path.join(root, "virgilio/index.html"), { waitUntil: "domcontentloaded" });
  const r = await p.evaluate(async () => {
    window.fetchCorrecciones = async function () { return new Map(); };
    window.fetch = async function () { return { ok: true, json: async function () { return []; } }; };
    window.supaFetchAllSafe = async function (url) {
      if (String(url) === SUPABASE_ENTREGAS_ENDPOINT) return [
        { id: 1, np: "LK 0300", cod_art: "574", cajas_pedidas: 14, cajas_entregadas: 13, cajas_falto: 1, tanda: "F97A" },
        { id: 2, np: "LK 0301", cod_art: "574E", cajas_pedidas: 2, cajas_entregadas: 1, cajas_falto: 1, tanda: "F97A" },
        { id: 3, np: "LK 0302", cod_art: "502", cajas_pedidas: 2, cajas_entregadas: 1, cajas_falto: 1, tanda: "F97A" }
      ];
      return [];
    };
    const f = await cpLoadFaltantes();
    const by = {}; f.forEach(function (e) { by[e.id] = { cod: e.cod_art, orig: e._cod_orig }; });
    return by;
  });
  await b.close();
  const fallas = [];
  if (!r[1] || r[1].cod !== "574E" || r[1].orig !== "574") fallas.push("A: 574 → " + JSON.stringify(r[1]));
  if (!r[2] || r[2].cod !== "574E") fallas.push("B: 574E → " + JSON.stringify(r[2]));
  if (!r[3] || r[3].cod !== "502") fallas.push("C: 502 → " + JSON.stringify(r[3]));
  if (errs.length) fallas.push("errores de página: " + errs.slice(0, 3).join(" | "));
  if (fallas.length) { console.error("cp-liquidado-574: FALLA\n - " + fallas.join("\n - ")); process.exit(1); }
  console.log("cp-liquidado-574: OK (574 → 574E en Completar pedido)");
})().catch((e) => { console.error(e); process.exit(1); });
