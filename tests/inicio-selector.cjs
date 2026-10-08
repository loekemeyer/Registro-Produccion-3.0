/* Registro Producción 3.0 — la pantalla de inicio (/) es el selector Virgilio | Cervantes. Virgilio vive en
   virgilio/ y Cervantes en cervantes/ (el operario entra desde su celular), cada una con su login por el código
   de la TV de su planta.
   Verifica, sirviendo el repo por http:
     1) / muestra las 2 tarjetas y apuntan a virgilio/ y a cervantes/;
     2) entrar a Virgilio carga virgilio/ sin errores de JS y muestra SU login;
     3) entrar a Cervantes carga cervantes/ y, ANTES de entrar, muestra la pantalla del código de la TV (con «Volver al
        inicio»); la tablet de GP2 ya no está en el inicio;
     4) /selector/ (URL vieja) redirige a /;
     5) virgilio/ llama a ../supabase.js (una sola copia, en la raíz).
   (07/10/2026 [Elías]: «ya no estamos en GP2, usan su celular personal»: la tarjeta volvió de la tablet de GP2 a cervantes/.)
   Sale 1 si falla. */
const fs = require("fs");
const path = require("path");
let chromium;
try { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }
catch (_e) { try { ({ chromium } = require("playwright")); } catch (_e2) { console.error("Playwright no encontrado."); process.exit(2); } }
const { servir } = require("./_servidor.cjs");

(async () => {
  const srv = await servir();
  const b = await chromium.launch();
  const p = await b.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  const sup404 = [];
  p.on("response", (r) => { if (r.url().startsWith(srv.url) && r.status() >= 400) sup404.push(r.status() + " " + r.url().replace(srv.url, "")); });
  await p.route("**/*.supabase.co/**", (r) => r.abort());   // sin red hacia Supabase
  // la tablet y el login de GP2 traen supabase-js de un CDN: se les da la copia del repo (sin red)
  await p.route("**/cdn.jsdelivr.net/**", (r) => r.fulfill({ path: path.join(__dirname, "..", "virgilio", "vendor", "supabase.umd.js"), contentType: "text/javascript" }));

  const c = {};
  // 1) inicio
  await p.goto(srv.url + "/", { waitUntil: "domcontentloaded" });
  c.dosTarjetas = (await p.locator(".card").count()) === 2;
  c.hrefVirgilio = (await p.getAttribute("#cardVir", "href")) === "virgilio/";
  // v1.4 (Elías, 08/10: «si»): la tarjeta Cervantes abre la botonera de GP2 portada (cervantes-gp2/), no la tablet de gp2/ ni la app vieja
  c.hrefCervantes = (await p.getAttribute("#cardCer", "href")) === "cervantes-gp2/";
  c.cervantesNoAbreGP2 = !/^(\.\/)?gp2\//.test((await p.getAttribute("#cardCer", "href")) || "");

  // 2) Virgilio
  await Promise.all([p.waitForURL("**/virgilio/"), p.click("#cardVir")]);
  await p.waitForSelector("#authBlock:not(.hidden)", { timeout: 10000 });
  c.virgilioMuestraSuLogin = (await p.locator("#googleSignInBtn").count()) === 1 && (await p.locator("#tvClaveStep").count()) === 1;
  c.virgilioCargaSupabaseJsDeLaRaiz = await p.evaluate(() => !!document.querySelector('script[src="../supabase.js"]') && typeof window.supabase !== "undefined");

  // 3) Cervantes = cervantes-gp2/, con el código de la TV antes de entrar (sin red a Supabase la validación no puede hacerse;
  //    la pantalla aparece igual porque hay internet y falta el pase de hoy)
  await p.goto(srv.url + "/", { waitUntil: "domcontentloaded" });
  await Promise.all([p.waitForURL("**/cervantes-gp2/"), p.click("#cardCer")]);
  await p.waitForSelector("#tvClaveModal", { state: "visible", timeout: 10000 });
  c.cervantesPideElCodigoAntesDeEntrar = (await p.locator("#tvClaveInput").count()) === 1 && /Código de la TV/.test(await p.textContent("#tvClaveModal"));
  c.cervantesPuedeVolverAlInicio = (await p.getAttribute("#tvClaveVolver", "href")) === "../";
  await Promise.all([p.waitForURL(srv.url + "/"), p.click("#tvClaveVolver")]);
  c.volverLlevaAlInicio = (await p.locator(".card").count()) === 2;

  // 4) URL vieja del selector
  await p.goto(srv.url + "/selector/", { waitUntil: "domcontentloaded" });
  await p.waitForURL(srv.url + "/", { timeout: 10000 });
  c.selectorViejoRedirige = (await p.locator(".card").count()) === 2;

  // 5) UNA SOLA APP INSTALABLE [Elías, 08/10: «1 si»]. Antes había 3 (inicio, virgilio/, cervantes-gp2/), cada una con su id y el
  //    mismo alcance: según dónde se tocara «Instalar» salía otra app, y una instalada antes del id propio de Virgilio quedó trabada
  //    con el alcance viejo (Cervantes con la barra de «página fuera de la app» y la X que volvía al login de Virgilio, con captura).
  //    Ahora el inicio, Virgilio y Cervantes usan el MISMO manifiesto (el de la raíz), que cubre todo el sitio.
  const raiz = "https://x.test/Registro-Produccion-3.0/";
  const linkManifiesto = (d) => {
    const html = fs.readFileSync(path.join(__dirname, "..", d, "index.html"), "utf8");
    const m = html.match(/<link rel="manifest" href="([^"]+)"/);
    return m ? new URL(m[1], raiz + (d === "." ? "" : d + "/")).href : null;
  };
  c.unaSolaApp = [".", "virgilio", "cervantes-gp2"].every((d) => linkManifiesto(d) === raiz + "manifest.json");
  c.sinManifiestosPropios = !fs.existsSync(path.join(__dirname, "..", "virgilio", "manifest.json"))
    && !fs.existsSync(path.join(__dirname, "..", "cervantes-gp2", "manifest.json"));
  const mr = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));
  c.manifiestoCubreTodo = mr.id === "/Registro-Produccion-3.0/" && new URL(mr.scope, raiz + "manifest.json").href === raiz
    && new URL(mr.start_url, raiz + "manifest.json").href === raiz;
  // Android pide íconos PNG de 192 y 512 para instalar
  c.iconosPng = ["192x192", "512x512"].every((t) => mr.icons.some((i) => i.sizes === t && i.type === "image/png"
    && fs.existsSync(path.join(__dirname, "..", i.src))));
  // la app vieja cervantes/ (sin enlace, se borra cuando pasen todos) conserva el suyo, con alcance en la raíz
  const mc = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "cervantes", "manifest.json"), "utf8"));
  c.cervantesViejaCubreElInicio = new URL(mc.scope || "./", raiz + "cervantes/manifest.json").href === raiz;

  const pass = Object.values(c).every(Boolean) && errs.length === 0 && sup404.length === 0;
  console.log("inicio-selector:", JSON.stringify(c), "· pageerrors:", errs.length ? errs.join("|") : "none", "· 4xx propios:", sup404.length ? sup404.join(", ") : "none", "·", pass ? "✓ OK" : "✗ FAIL");
  await b.close(); await srv.cerrar(); process.exit(pass ? 0 : 1);
})();
