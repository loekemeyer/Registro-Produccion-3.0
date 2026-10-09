/* Virgilio — el operario entra SÓLO con el código de la TV (v30.02, SOLO_TV = true).
   Supabase está simulado (reg_prod_3_0_virgilio_operarios, con Content-Profile reg_prod_3_0, acepta "1234"); lo demás se aborta como en las otras pruebas.

   1) la pantalla no muestra Google ni «Entrar con mi legajo»; sí el código de la TV y el aviso correcto
   2) signInWithGoogle() no sale a Google aunque se llame a mano
   3) no hay entrada por legajo (v30.07): ni campo de legajo, y loginWithLegajo() no entra ni deja sesión
   4) código incorrecto → «Clave incorrecta», no entra
   5) código correcto → lista de nombres → al elegir el suyo cae en la botonera y queda la sesión del día
   6) código correcto → «＋ No estoy en la lista» → pide el ALTA con su nombre (gv_operario_alta_crear) y NO entra;
      está el botón «Entrevista / prueba»
   7) una sesión de Google vieja en localStorage (el origen se comparte con GP2) ni cuenta ni se borra
   8) v30.12: cada ingreso con la TV deja el REGISTRO del equipo (reg_prod_3_0_registrar_ingreso: legajo, id gv_dispositivo,
      huella, navegador, pantalla); si esa llamada falla, el operario entra igual
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

  async function pagina(extraInit, opts) {
    const ctx = await b.newContext({ serviceWorkers: "block" });
    ctx.setDefaultTimeout(8000);
    const est = { google: 0, validar: 0, alta: null, ingresos: [] };
    if (extraInit) await ctx.addInitScript(extraInit);
    await ctx.route("**/*.supabase.co/**", async (route) => {
      const req = route.request(); const url = req.url();
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
      const json = (body) => route.fulfill({ status: 200, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify(body) });
      if (url.includes("/auth/v1/authorize")) { est.google++; return route.abort(); }
      if (url.includes("/rpc/reg_prod_3_0_virgilio_operarios")) {
        if (req.headers()["content-profile"] !== "reg_prod_3_0") return route.fulfill({ status: 404, headers: CORS, body: "{}" });   // v30.16: schema propio
        est.validar++;
        let clave = ""; try { clave = String(JSON.parse(req.postData() || "{}").p_clave || ""); } catch {}
        return json(clave === "1234" ? { ok: true, operarios: [{ legajo: "999", nombre: "Prueba TV" }] } : { ok: false });
      }
      if (url.includes("/rpc/gv_operario_alta_crear")) {
        try { est.alta = JSON.parse(req.postData() || "{}"); } catch {}
        return json({ id: 7, nombre: (est.alta && est.alta.p_nombre) || "", estado: "pendiente" });
      }
      if (url.includes("/rpc/reg_prod_3_0_registrar_ingreso")) {
        try { est.ingresos.push(JSON.parse(req.postData() || "{}")); } catch {}
        if (opts && opts.ingresoFalla) return route.fulfill({ status: 500, headers: { ...CORS, "content-type": "application/json" }, body: "{}" });
        return json(1);
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
  { const { ctx, p, est } = await pagina();
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
    // v30.13 (Elías): «necesita un botón de regresar, por si entró al equivocado»
    chequeo("1 se ve «← Volver al inicio» y apunta al inicio del sitio", (await visible(p, "#tvVolverInicio")) &&
      (await p.evaluate(() => new URL(document.getElementById("tvVolverInicio").href).pathname)) === "/");

    // ---- 2) Google cerrado también por código ----
    const urlAntes = p.url();
    await p.evaluate(() => signInWithGoogle());
    await pausa(400);
    chequeo("2 signInWithGoogle() no sale a Google", p.url() === urlAntes && /código de la TV/.test(await p.textContent("#authStatus")));

    // ---- 3) legajo sin el código ----
    chequeo("3 no existe el campo de legajo", (await p.locator("#legajoLoginInput").count()) === 0);
    await p.evaluate(async () => { await loginWithLegajo(); });
    chequeo("3 loginWithLegajo() no deja sesión y vuelve al código", (await leer(p, "vir_legajo_auth")) === null && (await visible(p, "#tvClaveStep")));

    // ---- 4) código incorrecto ----
    await p.fill("#tvClaveInput", "0000");
    await p.click("#tvClaveStep .primary-btn");
    await p.waitForFunction(() => /Clave incorrecta/.test(document.getElementById("legajoLoginError").textContent));
    chequeo("4 código incorrecto: «Clave incorrecta» y no entra", (await leer(p, "vir_legajo_auth")) === null && !(await visible(p, "#optionsScreen")));

    // ---- 5) código correcto → nombre ----
    await p.fill("#tvClaveInput", "1234");
    await p.click("#tvClaveStep .primary-btn");
    await p.waitForSelector("#tvNombreStep:not(.hidden)");
    chequeo("5 en «¿Quién sos?» también se puede volver al inicio", await visible(p, "#tvVolverInicio"));
    chequeo("5 con el código bien aparece la lista de nombres", (await p.locator("#tvNombreLista button").count()) === 1);
    await p.click("#tvNombreLista button");
    await p.waitForSelector("#optionsScreen:not(.hidden)");
    const ses = JSON.parse((await leer(p, "vir_legajo_auth")) || "null");
    chequeo("5 al elegir su nombre cae en la botonera con la sesión del día", ses && ses.legajo === "999" && !(await visible(p, "#plantSelector")));
    // 8) registro del equipo
    await p.waitForFunction(() => true); await pausa(600);
    const ing = est.ingresos[0] || {};
    chequeo("8 el ingreso deja UN registro con app y legajo", est.ingresos.length === 1 && ing.p_app === "virgilio" && ing.p_legajo === "999" && ing.p_nombre === "Prueba TV");
    chequeo("8 el registro lleva el id del equipo (gv_dispositivo), la huella y el navegador", !!ing.p_dispositivo && ing.p_dispositivo === (await leer(p, "gv_dispositivo")) && !!ing.p_huella && /Mozilla|Chrome/.test(ing.p_navegador || ""));
    chequeo("8 el registro lleva pantalla, zona e idioma", !!(ing.p_extra && ing.p_extra.pantalla && "zona" in ing.p_extra && "idioma" in ing.p_extra));
    chequeo("8 el método es clave_tv", ing.p_metodo === "clave_tv");
    await ctx.close(); }

  // ---- 6) código correcto → «No estoy en la lista» → nombre: pide el alta y ENTRA con el 600 (v30.08 ≡ Gestión v27.37) ----
  { const { ctx, p, est } = await pagina();
    await p.fill("#tvClaveInput", "1234");
    await p.click("#tvClaveStep .primary-btn");
    await p.waitForSelector("#tvNombreStep:not(.hidden)");
    await p.click("#tvNombreStep .tvnom-mas >> nth=0");
    await p.waitForSelector("#tvLegajoStep:not(.hidden)");
    await p.fill("#tvAltaNombre", "Juan Perez");
    await p.click("#tvLegajoStep .primary-btn");
    await p.waitForSelector("#optionsScreen:not(.hidden)");
    const ses6 = JSON.parse((await leer(p, "vir_legajo_auth")) || "null");
    chequeo("6 pide el alta con el nombre", est.alta && est.alta.p_nombre === "Juan Perez");
    chequeo("6 y entra con el legajo 600 y su nombre", ses6 && ses6.legajo === "600" && ses6.nombre === "Juan Perez");
    await ctx.close(); }

  // ---- 8b) si el registro falla, el operario entra igual ----
  { const { ctx, p, est } = await pagina(null, { ingresoFalla: true });
    await p.fill("#tvClaveInput", "1234");
    await p.click("#tvClaveStep .primary-btn");
    await p.waitForSelector("#tvNombreStep:not(.hidden)");
    await p.click("#tvNombreLista button");
    await p.waitForSelector("#optionsScreen:not(.hidden)");
    await pausa(500);
    chequeo("8 si el registro falla (500) el operario entra igual", est.ingresos.length === 1 && !!(await leer(p, "vir_legajo_auth")));
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
