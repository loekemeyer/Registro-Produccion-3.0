/* Virgilio — el operario entra SÓLO con el código de la TV (v30.02, SOLO_TV = true).
   Supabase está simulado (gv_tv_clave_validar acepta "1234"); lo demás se aborta como en las otras pruebas.

   1) la pantalla no muestra Google ni «Entrar con mi legajo»; sí el código de la TV y el aviso correcto
   2) signInWithGoogle() no sale a Google aunque se llame a mano
   3) loginWithLegajo() sin el código de la TV no entra (ni deja sesión) y manda a ingresarlo
   4) código incorrecto → «Clave incorrecta», no entra
   5) código correcto → lista de nombres → al elegir el suyo cae en la botonera y queda la sesión del día
   6) código correcto → «＋ No estoy en la lista» → tipea el legajo → entra (el legajo sólo con el código vigente)
   7) una sesión de Google vieja en localStorage (el origen se comparte con GP2) ni cuenta ni se borra
   Sale 1 si falla. */
let chromium;
try { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }
catch (_e) { try { ({ chromium } = require("playwright")); } catch (_e2) { console.error("Playwright no encontrado."); process.exit(2); } }
const { servir } = require("./_servidor.cjs");

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info, prefer, accept-profile, content-profile",
  "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
};
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const srv = await servir();
  const b = await chromium.launch();
  const errs = [];
  const res = [];
  const chequeo = (n, ok) => { res.push([n, !!ok]); if (!ok) console.log("  ✗ " + n); };

  async function pagina(extraInit) {
    const ctx = await b.newContext({ serviceWorkers: "block" });
    ctx.setDefaultTimeout(8000);
    const est = { google: 0, validar: 0 };
    if (extraInit) await ctx.addInitScript(extraInit);
    await ctx.route("**/*.supabase.co/**", async (route) => {
      const req = route.request(); const url = req.url();
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
      const json = (body) => route.fulfill({ status: 200, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify(body) });
      if (url.includes("/auth/v1/authorize")) { est.google++; return route.abort(); }
      if (url.includes("/rpc/gv_tv_clave_validar")) {
        est.validar++;
        let clave = ""; try { clave = String(JSON.parse(req.postData() || "{}").p_clave || ""); } catch {}
        return json(clave === "1234" ? { ok: true, operarios: [{ legajo: "999", nombre: "Prueba TV" }] } : { ok: false });
      }
      if (url.includes("/rest/v1/Empleados")) return json([{ Legajo: "999", Empleado: "Prueba TV" }]);
      return route.abort();
    });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errs.push(e.message));
    p.on("dialog", (d) => d.dismiss().catch(() => {}));
    await p.goto(srv.url + "/virgilio/", { waitUntil: "domcontentloaded" });
    await p.waitForSelector("#authBlock:not(.hidden)");
    return { ctx, p, est };
  }
  const leer = (p, k) => p.evaluate((key) => localStorage.getItem(key), k);
  const visible = (p, sel) => p.locator(sel).first().isVisible();

  // ---- 1) pantalla ----
  { const { ctx, p } = await pagina();
    await p.waitForFunction(() => /código de la TV/.test(document.getElementById("authStatus").textContent));
    chequeo("1 no se ve el botón de Google", !(await visible(p, "#googleSignInBtn")));
    chequeo("1 no se ve el separador «o»", !(await visible(p, "#authBlock .auth-divider")));
    chequeo("1 no se ve «Entrar con mi legajo»", !(await visible(p, "#tvClaveStep .tvnom-mas")));
    chequeo("1 se ve el código de la TV", (await visible(p, "#tvClaveInput")) && (await visible(p, "#tvClaveStep .primary-btn")));
    chequeo("1 el aviso pide el código de la TV", /Ingresá el código de la TV/.test(await p.textContent("#authStatus")));
    // v30.03: debajo de «Entrar» no se ve nada; el «4 números» va con las letras juntas. v30.05: el título dice «Producción Virgilio»
    // y no hay cartel «Gestión Virgilio» debajo del botón
    chequeo("1 no se ve el instructivo ni el Resumen de hoy", !(await visible(p, "#btnInstructivo")) && !(await visible(p, "#legajoHistorySpace")));
    chequeo("1 el título dice «Producción Virgilio»", (await visible(p, "#legajoTitle")) && /^Producción Virgilio$/.test((await p.textContent("#legajoTitle")).trim()));
    chequeo("1 no hay cartel «Gestión Virgilio» debajo de «Entrar»", (await p.locator("#loginMarca").count()) === 0 && !/Gestión Virgilio/.test(await p.evaluate(() => document.getElementById("legajoScreen").innerText)));
    chequeo("1 el «4 números» va con las letras juntas", await p.evaluate(() => {
      const i = document.getElementById("tvClaveInput");
      return parseFloat(getComputedStyle(i, "::placeholder").letterSpacing) < 3 && parseFloat(getComputedStyle(i).letterSpacing) > 5;
    }));

    // ---- 2) Google cerrado también por código ----
    const urlAntes = p.url();
    await p.evaluate(() => signInWithGoogle());
    await pausa(400);
    chequeo("2 signInWithGoogle() no sale a Google", p.url() === urlAntes && /código de la TV/.test(await p.textContent("#authStatus")));

    // ---- 3) legajo sin el código ----
    await p.evaluate(async () => { document.getElementById("legajoLoginInput").value = "999"; await loginWithLegajo(); });
    chequeo("3 loginWithLegajo() sin código no deja sesión", (await leer(p, "vir_legajo_auth")) === null);
    chequeo("3 y manda a ingresar el código", /Primero ingresá el código de la TV/.test(await p.textContent("#legajoLoginError")) && (await visible(p, "#tvClaveStep")));

    // ---- 4) código incorrecto ----
    await p.fill("#tvClaveInput", "0000");
    await p.click("#tvClaveStep .primary-btn");
    await p.waitForFunction(() => /Clave incorrecta/.test(document.getElementById("legajoLoginError").textContent));
    chequeo("4 código incorrecto: «Clave incorrecta» y no entra", (await leer(p, "vir_legajo_auth")) === null && !(await visible(p, "#optionsScreen")));

    // ---- 5) código correcto → nombre ----
    await p.fill("#tvClaveInput", "1234");
    await p.click("#tvClaveStep .primary-btn");
    await p.waitForSelector("#tvNombreStep:not(.hidden)");
    chequeo("5 con el código bien aparece la lista de nombres", (await p.locator("#tvNombreLista button").count()) === 1);
    await p.click("#tvNombreLista button");
    await p.waitForSelector("#optionsScreen:not(.hidden)");
    const ses = JSON.parse((await leer(p, "vir_legajo_auth")) || "null");
    chequeo("5 al elegir su nombre cae en la botonera con la sesión del día", ses && ses.legajo === "999" && !(await visible(p, "#plantSelector")));
    await ctx.close(); }

  // ---- 6) código correcto → legajo ----
  { const { ctx, p } = await pagina();
    await p.fill("#tvClaveInput", "1234");
    await p.click("#tvClaveStep .primary-btn");
    await p.waitForSelector("#tvNombreStep:not(.hidden)");
    await p.click("#tvNombreStep .tvnom-mas");
    await p.waitForSelector("#tvLegajoStep:not(.hidden)");
    await p.fill("#legajoLoginInput", "999");
    await p.click("#tvLegajoStep .primary-btn");
    await p.waitForSelector("#optionsScreen:not(.hidden)");
    chequeo("6 «＋ No estoy en la lista» + legajo entra (con el código vigente)", !!(await leer(p, "vir_legajo_auth")));
    await ctx.close(); }

  // ---- 7) sesión de Google vieja ----
  { const clave = "sb-hrxfctzncixxqmpfhskv-auth-token";
    const sesionVieja = { access_token: "x", refresh_token: "y", token_type: "bearer", expires_at: 4102444800, expires_in: 3600, user: { id: "u", email: "alguien@example.com" } };
    const { ctx, p } = await pagina(`localStorage.setItem(${JSON.stringify(clave)}, ${JSON.stringify(JSON.stringify(sesionVieja))});`);
    await pausa(1500);
    chequeo("7 una sesión de Google guardada no cuenta: sigue el login por TV (sin «Reconectando…»)", (await visible(p, "#tvClaveInput")) && !/Reconectando/.test(await p.textContent("#authStatus")) && !(await visible(p, "#optionsScreen")));
    chequeo("7 y no se borra (el origen se comparte con GP2)", !!(await leer(p, clave)));
    await ctx.close(); }

  const fallas = res.filter(([, ok]) => !ok);
  console.log(`virgilio-solo-tv: ${res.length - fallas.length}/${res.length} chequeos OK · pageerrors: ${errs.length ? errs.join(" | ") : "none"} · ${fallas.length === 0 && errs.length === 0 ? "✓ OK" : "✗ FAIL"}`);
  await b.close(); await srv.cerrar();
  process.exit(fallas.length === 0 && errs.length === 0 ? 0 : 1);
})();
