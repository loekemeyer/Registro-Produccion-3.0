/* Virgilio sólo con la botonera de operario (v30.03, 06/10/2026).
   Pedido de Nazareno: «en Registro Producción 3.0 solo esté la botonera de operarios de GV y GP2».
   El `index.html` de Gestión Virgilio mezcla operario y supervisor en un solo archivo; acá se recortó todo lo que sólo
   alcanza el supervisor (ver README, «Qué se recortó»). Esta prueba hace que no vuelva sin que nadie lo decida:

   1) los archivos de supervisor no están (scripts de módulos, librerías de vendor/, la Carga Manual de GP2) y los del
      operario sí;
   2) la página carga sin errores y sin ningún recurso propio que dé 404;
   3) la botonera tiene sus 20 botones, y cada uno se puede tocar sin error y muestra algo nuevo en pantalla;
   4) las entradas de supervisor no existen; los 5 cascarones que el código del operario todavía nombra son funciones
      vacías (se miran en el texto: dos viven adentro de un IIFE); y los paneles de supervisor son sólo el contenedor
      oculto, sin botones.
   Sale 1 si falla. */
const fs = require("fs");
const path = require("path");
let chromium;
try { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }
catch (_e) { try { ({ chromium } = require("playwright")); } catch (_e2) { console.error("Playwright no encontrado."); process.exit(2); } }
const { servir } = require("./_servidor.cjs");

const RAIZ = path.join(__dirname, "..");
const AUSENTES = [
  "virgilio/importacion.js", "virgilio/cobranzas.js", "virgilio/hotsale.js", "virgilio/estadisticas.js",
  "virgilio/modulo_talleristas_arts.js", "virgilio/modulo_talleristas_edit.js",
  "virgilio/vendor/jspdf.umd.min.js", "virgilio/vendor/jspdf.plugin.autotable.min.js", "virgilio/vendor/chart.umd.min.js",
  "virgilio/vendor/leaflet.min.js", "virgilio/vendor/leaflet.min.css", "virgilio/vendor/xlsx.full.min.js",
  "virgilio/vendor/html2canvas.min.js", "virgilio/vendor/images",
  "gp2/Produccion/RegistroApp/Registro_GP2.html",
];
const PRESENTES = [
  "virgilio/index.html", "virgilio/recepcion.js", "virgilio/planimetria.js", "virgilio/supabase-config.js", "virgilio/sw.js",
  "virgilio/vendor/supabase.umd.js", "supabase.js", "cervantes/index.html", "gp2/Produccion/RegistroApp/Operarios_GP2.html",
];
const BOTONES = ["EP", "AP", "RT", "MG", "CC", "CR", "RR", "INS", "CP", "RC", "IR", "RKBM", "MOV", "PPP", "AT", "PB", "Limp", "Perm", "PC", "CT"];
// Entradas de supervisor que NO pueden existir como función de la página.
const SUPERVISOR_AUSENTE = [
  "openFacturacion", "openPPP", "openStockAdmin", "openMonitor", "openCobranzas", "openPedidosImportacion", "openConfiguracion",
  "openPlanimMapa", "openColaImpresion", "openRecepcionAdmin", "openRemitosAdmin", "fetchMonitorDayStats", "renderMonitor",
  "computeInconsistencias", "pppLoadProgFromSupabase", "ocgGenerar", "facRender",
];
// Las 5 que el código del operario sigue nombrando (refrescos «si la pantalla de admin está abierta»): cascarón vacío.
const CASCARONES = ["showSupervisor", "showConteo", "stkRender", "pppRenderProg", "psRender"];
const PANELES = ["supervisorPanel", "conteoPanel", "plantSelector", "cervAdmin", "pppOverlay"];

(async () => {
  const res = [];
  const chequeo = (n, ok) => { res.push([n, !!ok]); if (!ok) console.log("  ✗ " + n); };

  // ---- 1) archivos ----
  for (const f of AUSENTES) chequeo("1 no está " + f, !fs.existsSync(path.join(RAIZ, f)));
  for (const f of PRESENTES) chequeo("1 sí está " + f, fs.existsSync(path.join(RAIZ, f)));
  chequeo("1 virgilio/vendor/ sólo tiene supabase.umd.js", JSON.stringify(fs.readdirSync(path.join(RAIZ, "virgilio", "vendor"))) === '["supabase.umd.js"]');

  const srv = await servir();
  const b = await chromium.launch();
  const errs = [];
  const malos = [];
  const html = fs.readFileSync(path.join(RAIZ, "virgilio", "index.html"), "utf8");
  const cascaronMal = CASCARONES.filter((n) => !new RegExp("pantalla de supervisor, no incluida\\. \\*/\\s*(async\\s+)?function " + n + "\\(\\) \\{\\}").test(html));
  async function pagina() {
    const ctx = await b.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 800 } });
    ctx.setDefaultTimeout(8000);
    await ctx.route("**/*.supabase.co/**", (r) => r.abort());
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errs.push(e.message));
    p.on("dialog", (d) => d.dismiss().catch(() => {}));
    p.on("response", (r) => { if (r.url().startsWith(srv.url) && r.status() >= 400) malos.push(r.status() + " " + r.url().replace(srv.url, "")); });
    p.on("requestfailed", (r) => { if (r.url().startsWith(srv.url)) malos.push("falló " + r.url().replace(srv.url, "")); });
    await p.goto(srv.url + "/virgilio/", { waitUntil: "domcontentloaded" });
    await p.waitForSelector("#authBlock:not(.hidden)");
    await p.waitForTimeout(400);
    return { ctx, p };
  }
  const entrar = (p) => p.evaluate(() => { __gvAuthTest.setOperario({ legajo: "999", nombre: "Prueba" }); __gvAuthTest.route(); });

  // ---- 2) y 3) carga y botonera ----
  { const { ctx, p } = await pagina();
    await entrar(p);
    const codigos = await p.evaluate(() => [...document.querySelectorAll("#optionsScreen [data-code]")].map((e) => e.getAttribute("data-code")));
    chequeo("3 la botonera tiene sus 20 botones", JSON.stringify(codigos) === JSON.stringify(BOTONES));
    chequeo("2 ningún recurso propio da 404 ni falla", malos.length === 0);
    if (malos.length) console.log("    " + malos.join("\n    "));

    // ---- 4) supervisor fuera ----
    const r = await p.evaluate(({ ausentes, paneles }) => {
      const out = { existen: [], panelMal: [] };
      for (const n of ausentes) if (typeof window[n] !== "undefined") out.existen.push(n);
      for (const id of paneles) {
        const el = document.getElementById(id);
        if (!el || !el.hasAttribute("hidden") && !el.classList.contains("hidden") && getComputedStyle(el).display !== "none") out.panelMal.push(id + " (visible)");
        else if (el.querySelectorAll("button,a,input,select,textarea,[onclick]").length) out.panelMal.push(id + " (trae controles)");
      }
      return out;
    }, { ausentes: SUPERVISOR_AUSENTE, paneles: PANELES });
    chequeo("4 ninguna entrada de supervisor existe (" + r.existen.join(", ") + ")", r.existen.length === 0);
    chequeo("4 los 5 cascarones son funciones vacías (" + cascaronMal.join(", ") + ")", cascaronMal.length === 0);
    chequeo("4 los paneles de supervisor son contenedores ocultos sin controles (" + r.panelMal.join(", ") + ")", r.panelMal.length === 0);
    await ctx.close(); }

  // ---- 3) cada botón se toca sin error y muestra algo nuevo ----
  const visibles = (p) => p.evaluate(() => [...document.querySelectorAll("[id]")].filter((e) => {
    const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
  }).map((e) => e.id));
  for (const code of BOTONES) {
    const { ctx, p } = await pagina();
    await entrar(p);
    const antes = await visibles(p);
    const errsAntes = errs.length;
    const raro = await p.evaluate((c) => { try { selectOption(c); return ""; } catch (e) { return "error: " + e.message; } }, code);
    await p.waitForTimeout(300);
    const nuevos = (await visibles(p)).filter((id) => !antes.includes(id));
    chequeo("3 botón " + code + " se toca sin error y muestra algo nuevo" + (raro ? " (" + raro + ")" : ""), !raro && nuevos.length > 0 && errs.length === errsAntes);
    await ctx.close();
  }

  chequeo("2 la página no tiró errores de JS", errs.length === 0);
  const fallas = res.filter(([, ok]) => !ok);
  console.log(`virgilio-solo-operario: ${res.length - fallas.length}/${res.length} chequeos OK · pageerrors: ${errs.length ? errs.join(" | ") : "none"} · ${fallas.length === 0 ? "✓ OK" : "✗ FAIL"}`);
  await b.close(); await srv.cerrar();
  process.exit(fallas.length === 0 ? 0 : 1);
})();
