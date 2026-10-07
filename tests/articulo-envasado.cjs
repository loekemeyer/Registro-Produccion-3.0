/* Nombre del artículo (y marca) en las matrices de ENVASADO — tablet de GP2 y Cervantes (GP2 v3.0.1 / Cervantes v3.0.2).
   Supabase está simulado; la RPC reg_prod_3_0_envasado_articulos devuelve lo mismo que devolvería la base:
     322 → 2 piezas: 394 LOEKE y 842 CHEF, las dos «Espátula Lisa Nylon 1 Pza» (sólo se distinguen por la marca)
     321 → 1 pieza, 10 → no es de envasado

   GP2
     1) las tarjetas del selector de pieza llevan «Art. 394 · Espátula Lisa Nylon 1 Pza» y la marca, y las 2 se distinguen
     2) al elegir una, la línea colapsada dice el artículo
     3) una matriz de envasado con UNA pieza muestra el artículo en la card de la matriz
     4) una matriz que no es de envasado no muestra nada
     5) si la RPC falla, el selector queda como en la v1.245.2 («Art. 394» con el código del bundle) y sin errores
   Cervantes
     6) al tipear la matriz en «Empecé matriz», el aviso lista los artículos con nombre y marca
     7) con un solo artículo dice «Artículo:», con varios «Artículos de esta matriz:»
     8) una matriz que no es de envasado no muestra el bloque
     9) si la RPC falla, no se rompe nada
   Sale 1 si falla. */
const fs = require("fs");
const path = require("path");
let chromium;
try { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }
catch (_e) { try { ({ chromium } = require("playwright")); } catch (_e2) { console.error("Playwright no encontrado."); process.exit(2); } }
const { servir } = require("./_servidor.cjs");

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info, prefer, accept-profile, content-profile, x-supabase-api-version, accept",
  "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
};
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const SUPABASE_JS = fs.readFileSync(path.join(__dirname, "..", "supabase.js"), "utf8");

const ARTICULOS = {
  "322": [
    { pieza_codigo: "394", pieza_desc: "394 Terminado", arts: [{ codigo: "394", nombre: "Espátula Lisa Nylon 1 Pza", marca: "LOEKE" }] },
    { pieza_codigo: "842", pieza_desc: "842 Terminado", arts: [{ codigo: "842", nombre: "Espátula Lisa Nylon 1 Pza", marca: "CHEF" }] },
  ],
  "321": [
    { pieza_codigo: "321T", pieza_desc: "321 Terminado", arts: [{ codigo: "321", nombre: "Espátula Calada Nylon", marca: "LOEKE" }] },
  ],
};
const BUNDLE = {
  empleados: { "999": { nombre: "Prueba Envasado", activo: true, hora_entrada: "08:30:00" } },
  matrices: [
    { n: "322", d: "Env Espatula NY", ppk: 1, uxg: 1, maq: "", act: true },
    { n: "321", d: "Env espatula calada NY", ppk: 1, uxg: 1, maq: "", act: true },
    { n: "10", d: "Varilla c/ Cuchilla", ppk: 1, uxg: 1, maq: "", act: true },
  ],
  registro_en_golpes: false,
  matriz_salidas: {
    "322": [
      { comp_id: 1, codigo: "394", descripcion: "394 Terminado", arts: "394" },
      { comp_id: 2, codigo: "842", descripcion: "842 Terminado", arts: "842" },
    ],
  },
  matriz_fleje: {}, matriz_fleje_pieza: {}, envasado: {}, rollos_saldo: [], rollos_abiertos: {},
};

(async () => {
  const srv = await servir();
  const b = await chromium.launch();
  const errs = [];
  const res = [];
  const chequeo = (n, ok) => { res.push([n, !!ok]); if (!ok) console.log("  ✗ " + n); };
  const esperar = async (cond, ms = 8000) => { for (let t = 0; t < ms; t += 120) { if (await cond()) return true; await pausa(120); } return false; };

  async function contexto(rpcArticulos, extraInit) {
    const ctx = await b.newContext({ serviceWorkers: "block" });
    ctx.setDefaultTimeout(8000);
    if (extraInit) await ctx.addInitScript(extraInit);
    await ctx.route("https://cdn.jsdelivr.net/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: SUPABASE_JS }));
    await ctx.route("**/*.supabase.co/**", async (route) => {
      const req = route.request(); const url = req.url(); const m = req.method();
      const json = (status, body) => route.fulfill({ status, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify(body) });
      if (m === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
      if (url.includes("/auth/v1/token")) return json(200, { access_token: "x", refresh_token: "y", token_type: "bearer", expires_in: 3600, expires_at: 4102444800, user: { id: "u", email: "op@example.com" } });
      if (url.includes("/rpc/reg_prod_3_0_envasado_articulos")) return rpcArticulos === "falla" ? json(404, { message: "function not found" }) : json(200, ARTICULOS);
      if (url.includes("/rpc/registro_operarios_bundle")) return json(200, BUNDLE);
      if (url.includes("/rest/v1/Empleados")) return json(200, [{ Legajo: "999", Empleado: "Prueba Envasado", Activo: "SI", hora_entrada: "08:30:00" }]);
      if (url.includes("/rest/v1/Matrices")) return json(200, [{ N_Matriz: "322", Matriz: "Env Espatula NY" }, { N_Matriz: "321", Matriz: "Env espatula calada NY" }, { N_Matriz: "10", Matriz: "Varilla c/ Cuchilla" }]);
      if (m === "GET") return json(200, []);
      return json(201, []);
    });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errs.push(e.message));
    p.on("dialog", (d) => d.dismiss().catch(() => {}));
    return { ctx, p };
  }

  // ======================= GP2 =======================
  const sesionGP2 = `
    localStorage.setItem("sb-hrxfctzncixxqmpfhskv-auth-token", JSON.stringify({ access_token: "x", refresh_token: "y", token_type: "bearer", expires_at: 4102444800, expires_in: 3600, user: { id: "u", email: "op@example.com" } }));
    sessionStorage.setItem("gp_auth", "ok"); sessionStorage.setItem("gp_role", "admin"); sessionStorage.setItem("gp_email", "op@example.com");`;
  async function abrirGP2(rpcArticulos) {
    const c = await contexto(rpcArticulos, sesionGP2);
    await c.p.goto(srv.url + "/gp2/Produccion/RegistroApp/Operarios_GP2.html", { waitUntil: "domcontentloaded" });
    await c.p.waitForSelector("#legajoScreen", { state: "visible" });
    await esperar(() => c.p.evaluate(() => typeof D !== "undefined" && !!(D.empleados && D.empleados["999"])));
    if (rpcArticulos !== "falla") await esperar(() => c.p.evaluate(() => Object.keys(ENV_ARTS).length > 0));
    else await pausa(600);
    await c.p.fill("#legajoInput", "999");
    await c.p.click("#btnContinuar");
    await c.p.waitForSelector("#optionsScreen:not(.hidden)");
    await c.p.click('.box[data-code="E"]');
    return c;
  }

  { const { ctx, p } = await abrirGP2("ok");
    await p.fill("#textInput", "322");
    await p.waitForSelector("#piezaGrid .mz");
    const cards = await p.locator("#piezaGrid .mz").allTextContents();
    chequeo("1 el selector ofrece las 2 piezas de la 322", cards.length === 2);
    chequeo("1 la tarjeta del 394 dice artículo, nombre y marca", /Art\. 394/.test(cards[0]) && /Espátula Lisa Nylon 1 Pza/.test(cards[0]) && /LOEKE/.test(cards[0]));
    chequeo("1 la tarjeta del 842 dice artículo, nombre y marca", /Art\. 842/.test(cards[1]) && /Espátula Lisa Nylon 1 Pza/.test(cards[1]) && /CHEF/.test(cards[1]));
    chequeo("1 las 2 tarjetas se distinguen (mismo nombre, otra marca y otro artículo)", cards[0] !== cards[1]);
    await p.click("#piezaGrid .mz >> nth=0");
    await p.waitForSelector("#piezaGrid .pieza-cambiar");
    const linea = await p.textContent("#piezaGrid .pieza-cambiar");
    chequeo("2 la línea colapsada dice el artículo con nombre y marca", /Fabricás 394/.test(linea) && /Art\. 394 · Espátula Lisa Nylon 1 Pza \(LOEKE\)/.test(linea));

    await p.fill("#textInput", "321");
    await pausa(300);
    const card321 = await p.locator('#matrizGrid .mz[data-n="321"]').textContent();
    chequeo("3 matriz de envasado con una pieza: la card muestra el artículo", /Art\. 321 · Espátula Calada Nylon/.test(card321) && /LOEKE/.test(card321));
    chequeo("3 y no hay selector de pieza", await p.locator("#piezaPicker").evaluate((el) => el.classList.contains("hidden")));

    await p.fill("#textInput", "10");
    await pausa(300);
    const card10 = await p.locator('#matrizGrid .mz[data-n="10"]').innerHTML();
    chequeo("4 una matriz que no es de envasado no muestra artículo", !/mz-a/.test(card10));
    await ctx.close(); }

  { const { ctx, p } = await abrirGP2("falla");
    await p.fill("#textInput", "322");
    await p.waitForSelector("#piezaGrid .mz");
    const cards = await p.locator("#piezaGrid .mz").allTextContents();
    // sin la RPC queda lo de la v1.245.2: «Art. 394» con el código que trae el bundle, sin nombre ni marca
    chequeo("5 con la RPC caída el selector sigue andando, con el código del bundle y sin nombre ni marca", cards.length === 2 && /Art\. 394/.test(cards[0]) && /Art\. 842/.test(cards[1]) && cards.every((t) => !/Espátula/.test(t) && !/LOEKE|CHEF/.test(t)));
    await ctx.close(); }

  // ======================= Cervantes =======================
  async function abrirCervantes(rpcArticulos) {
    const c = await contexto(rpcArticulos);
    await c.p.goto(srv.url + "/cervantes/", { waitUntil: "domcontentloaded" });
    await c.p.waitForSelector("#legajoScreen", { state: "visible" });
    if (rpcArticulos !== "falla") await esperar(() => c.p.evaluate(() => !!document.querySelector("#syncBadge")) , 2000);
    await pausa(900);   // catálogos + artículos cargados
    await c.p.fill("#legajoInput", "999");
    await c.p.click("#btnContinuar");
    await c.p.waitForSelector("#optionsScreen:not(.hidden)");
    await c.p.click('.box[data-code="E"]');
    return c;
  }

  { const { ctx, p } = await abrirCervantes("ok");
    await p.fill("#textInput", "322");
    await esperar(() => p.evaluate(() => /Art\. 394/.test(document.getElementById("matrizInfo").textContent)));
    const info = await p.textContent("#matrizInfo");
    chequeo("6 el aviso de la 322 lista los 2 artículos con nombre y marca", /Art\. 394 · Espátula Lisa Nylon 1 Pza/.test(info) && /LOEKE/.test(info) && /Art\. 842 · Espátula Lisa Nylon 1 Pza/.test(info) && /CHEF/.test(info));
    chequeo("7 con varios artículos dice «Artículos de esta matriz:»", /Artículos de esta matriz:/.test(info));
    chequeo("6 el aviso es visible", await p.isVisible("#matrizInfo"));

    await p.fill("#textInput", "321");
    await esperar(() => p.evaluate(() => /Art\. 321/.test(document.getElementById("matrizInfo").textContent)));
    const info321 = await p.textContent("#matrizInfo");
    chequeo("7 con un solo artículo dice «Artículo:»", /Artículo:/.test(info321) && !/Artículos de esta matriz/.test(info321) && /Espátula Calada Nylon/.test(info321));

    await p.fill("#textInput", "10");
    await pausa(500);
    const visible10 = await p.evaluate(() => { const el = document.getElementById("matrizInfo"); return !el.classList.contains("hidden") && /Art\./.test(el.textContent); });
    chequeo("8 una matriz que no es de envasado no muestra artículos", !visible10);
    await ctx.close(); }

  { const { ctx, p } = await abrirCervantes("falla");
    await p.fill("#textInput", "322");
    await pausa(600);
    const hayArt = await p.evaluate(() => { const el = document.getElementById("matrizInfo"); return !el.classList.contains("hidden") && /Art\./.test(el.textContent); });
    chequeo("9 con la RPC caída Cervantes sigue andando, sin artículos", !hayArt);
    await ctx.close(); }

  const fallas = res.filter(([, ok]) => !ok);
  console.log(`articulo-envasado: ${res.length - fallas.length}/${res.length} chequeos OK · pageerrors: ${errs.length ? errs.join(" | ") : "none"} · ${fallas.length === 0 && errs.length === 0 ? "✓ OK" : "✗ FAIL"}`);
  await b.close(); await srv.cerrar();
  process.exit(fallas.length === 0 && errs.length === 0 ? 0 : 1);
})();
