/* Registro Producción 3.0 — la pantalla de inicio (/) es el selector Virgilio | Cervantes y cada app vive en
   su carpeta con su propio login.
   Verifica, sirviendo el repo por http:
     1) / muestra las 2 tarjetas y apuntan a virgilio/ y cervantes/;
     2) entrar a Virgilio carga virgilio/ sin errores de JS y muestra SU login;
     3) entrar a Cervantes carga cervantes/ y muestra la pantalla del legajo (sin rebotar al inicio);
     4) /selector/ (URL vieja) redirige a /;
     5) cervantes/ llama a ../supabase.js y virgilio/ también (una sola copia, en la raíz).
   Sale 1 si falla. */
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

  const c = {};
  // 1) inicio
  await p.goto(srv.url + "/", { waitUntil: "domcontentloaded" });
  c.dosTarjetas = (await p.locator(".card").count()) === 2;
  c.hrefVirgilio = (await p.getAttribute("#cardVir", "href")) === "virgilio/";
  c.hrefCervantes = (await p.getAttribute("#cardCer", "href")) === "cervantes/";

  // 2) Virgilio
  await Promise.all([p.waitForURL("**/virgilio/"), p.click("#cardVir")]);
  await p.waitForSelector("#authBlock:not(.hidden)", { timeout: 10000 });
  c.virgilioMuestraSuLogin = (await p.locator("#googleSignInBtn").count()) === 1 && (await p.locator("#tvClaveStep").count()) === 1;
  c.virgilioCargaSupabaseJsDeLaRaiz = await p.evaluate(() => !!document.querySelector('script[src="../supabase.js"]') && typeof window.supabase !== "undefined");

  // 3) Cervantes
  await p.goto(srv.url + "/", { waitUntil: "domcontentloaded" });
  await Promise.all([p.waitForURL("**/cervantes/"), p.click("#cardCer")]);
  await p.waitForSelector("#legajoScreen", { state: "visible", timeout: 10000 });
  c.cervantesNoRebota = p.url().endsWith("/cervantes/");
  c.cervantesPideLegajo = (await p.locator("#legajoInput").count()) === 1;
  c.cervantesCargaSupabaseJsDeLaRaiz = await p.evaluate(() => !!document.querySelector('script[src="../supabase.js"]') && typeof window.supabase !== "undefined");
  c.cervantesVolverAlInicio = (await p.getAttribute('#legajoScreen a[href="../"]', "href")) === "../";

  // 4) URL vieja del selector
  await p.goto(srv.url + "/selector/", { waitUntil: "domcontentloaded" });
  await p.waitForURL(srv.url + "/", { timeout: 10000 });
  c.selectorViejoRedirige = (await p.locator(".card").count()) === 2;

  const pass = Object.values(c).every(Boolean) && errs.length === 0 && sup404.length === 0;
  console.log("inicio-selector:", JSON.stringify(c), "· pageerrors:", errs.length ? errs.join("|") : "none", "· 4xx propios:", sup404.length ? sup404.join(", ") : "none", "·", pass ? "✓ OK" : "✗ FAIL");
  await b.close(); await srv.cerrar(); process.exit(pass ? 0 : 1);
})();
