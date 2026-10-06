/* Registro Producción 3.0 — la pantalla de inicio (/) es el selector Virgilio | Cervantes. Virgilio vive en
   virgilio/ y Cervantes es la TABLET DE OPERARIOS DE GP2 (gp2/Produccion/RegistroApp/), cada una con su login.
   Verifica, sirviendo el repo por http:
     1) / muestra las 2 tarjetas y apuntan a virgilio/ y a la tablet de GP2;
     2) entrar a Virgilio carga virgilio/ sin errores de JS y muestra SU login;
     3) entrar a Cervantes lleva a la tablet de GP2 (sin sesión, al login de GP2, que vuelve a la tablet con ?next=) y
        el botón «Menú» de la tablet vuelve al inicio del sitio;
     4) /selector/ (URL vieja) redirige a /;
     5) virgilio/ llama a ../supabase.js (una sola copia, en la raíz).
   (v30.03: Cervantes dejó de abrir cervantes/ —la app de Registro Producción 2.0— y abre la tablet de GP2.)
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
  const TABLET = "gp2/Produccion/RegistroApp/Operarios_GP2.html";
  c.hrefCervantes = (await p.getAttribute("#cardCer", "href")) === TABLET;

  // 2) Virgilio
  await Promise.all([p.waitForURL("**/virgilio/"), p.click("#cardVir")]);
  await p.waitForSelector("#authBlock:not(.hidden)", { timeout: 10000 });
  c.virgilioMuestraSuLogin = (await p.locator("#googleSignInBtn").count()) === 1 && (await p.locator("#tvClaveStep").count()) === 1;
  c.virgilioCargaSupabaseJsDeLaRaiz = await p.evaluate(() => !!document.querySelector('script[src="../supabase.js"]') && typeof window.supabase !== "undefined");

  // 3) Cervantes = la tablet de operarios de GP2
  await p.goto(srv.url + "/", { waitUntil: "domcontentloaded" });
  await Promise.all([p.waitForURL("**/gp2/**"), p.click("#cardCer")]);
  await p.waitForLoadState("domcontentloaded");
  const url3 = new URL(p.url());
  // sin sesión de Google el guard de GP2 manda a su login y le deja ?next= la tablet para volver
  c.cervantesAbreGP2 = url3.pathname === "/" + TABLET || (url3.pathname === "/gp2/login.html" && decodeURIComponent(url3.searchParams.get("next") || "") === "/" + TABLET);
  c.cervantesNoEsLaAppVieja = !url3.pathname.startsWith("/cervantes/");
  const tablet = fs.readFileSync(path.join(__dirname, "..", TABLET), "utf8");
  c.tabletMenuVuelveAlInicio = /id="btnMenu"[^>]*onclick="location\.href='\.\.\/\.\.\/\.\.\/'"/.test(tablet);

  // 4) URL vieja del selector
  await p.goto(srv.url + "/selector/", { waitUntil: "domcontentloaded" });
  await p.waitForURL(srv.url + "/", { timeout: 10000 });
  c.selectorViejoRedirige = (await p.locator(".card").count()) === 2;

  const pass = Object.values(c).every(Boolean) && errs.length === 0 && sup404.length === 0;
  console.log("inicio-selector:", JSON.stringify(c), "· pageerrors:", errs.length ? errs.join("|") : "none", "· 4xx propios:", sup404.length ? sup404.join(", ") : "none", "·", pass ? "✓ OK" : "✗ FAIL");
  await b.close(); await srv.cerrar(); process.exit(pass ? 0 : 1);
})();
