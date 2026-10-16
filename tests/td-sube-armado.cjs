/* v30.33 (traído de GV v31.90, Luis 16/10) — Terminar Día NO deja el armado vivo en el celular.
   "cuando termina el día el celular debería mandar el dato al server, no puede quedar vivo en el celu".
   tdSubirArmado(legajo), que corre en Terminar Día después de tdCerrarModulos:
   (A) armado abierto con copia local → sube la foto (en_curso) y, con el OK, borra vir_comp_<tanda>.
   (B) sin señal (el POST falla) → la copia local QUEDA (no se pierde avance).
   (C) sin armado abierto, o legajo de prueba → no manda nada.
   (D) Terminar Día la llama (el cableado no se pierde).
   Sale 1 si falla. */
const path = require("path");
const fs = require("fs");
let chromium;
try { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }
catch (_e) { try { ({ chromium } = require("playwright")); } catch (_e2) { console.error("no playwright"); process.exit(2); } }

(async () => {
  const root = path.join(__dirname, "..", "virgilio");
  const b = await chromium.launch(); const p = await b.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  let modo = "ok"; const posts = [];
  await p.route("**/*.supabase.co/**", (r) => r.abort());
  await p.route("**/rest/v1/rpc/gv_armado_avance_guardar**", async (route) => {
    let body = {}; try { body = JSON.parse(route.request().postData() || "{}"); } catch (_e) {}
    if (modo === "abort") return route.abort();
    posts.push(body);
    return route.fulfill({ status: 200, contentType: "application/json", body: '"ok"' });
  });
  await p.goto("file://" + path.join(root, "index.html"), { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => typeof tdSubirArmado === "function" && typeof _compPersistKey === "function");
  const w = (ms) => p.waitForTimeout(ms);
  const out = {};
  const preparar = (leg, abierto) => p.evaluate(([leg, abierto]) => {
    const st = getLegajoState(leg);
    st.armado = abierto ? { active: true, value: "F73A", ts_inicio: new Date().toISOString() } : { active: false, value: "", ts_inicio: null };
    setLegajoState(leg, st);
    localStorage.setItem(_compPersistKey("F73A"), JSON.stringify({ _ts: Date.now(), tanda: "F73A", legajo: leg, step: 2,
      pickUbic: "mesa", nps: [{ np: "LK 0392", codes: [{ cod: "248", rest: 15 }] }] }));
  }, [leg, abierto]);
  const hayLocal = () => p.evaluate(() => !!localStorage.getItem(_compPersistKey("F73A")));

  await preparar("8", true); posts.length = 0;
  await p.evaluate(() => tdSubirArmado("8")); await w(800);
  out.aSubeLaFoto = posts.length === 1 && posts[0].p_tanda === "F73A" && posts[0].p_estado === "en_curso"
    && posts[0].p_legajo === "8" && posts[0].p_snapshot && posts[0].p_snapshot.nps[0].np === "LK 0392" && !("pickUbic" in posts[0].p_snapshot);
  out.aBorraLaLocal = !(await hayLocal());

  modo = "abort"; await preparar("8", true); posts.length = 0;
  await p.evaluate(() => tdSubirArmado("8")); await w(800);
  out.bSinSenalQuedaLocal = await hayLocal();
  modo = "ok";

  await preparar("8", false); posts.length = 0;
  await p.evaluate(() => tdSubirArmado("8")); await w(500);
  out.cSinArmadoNoManda = posts.length === 0 && (await hayLocal());
  await preparar("1", true); posts.length = 0;
  await p.evaluate(() => tdSubirArmado("1")); await w(500);
  out.cPruebaNoManda = posts.length === 0;

  const src = fs.readFileSync(path.join(root, "index.html")).toString("utf8");
  out.dTerminarDiaLaLlama = /tdCerrarModulos\(legajoStr\);\s*\n\s*\/\/ 1d\)[^\n]*\n\s*tdSubirArmado\(legajoStr\);/.test(src);
  out.sinErrores = errs.length === 0;
  await b.close();
  const mal = Object.keys(out).filter((k) => !out[k]);
  console.log(JSON.stringify(out, null, 1));
  if (mal.length) { console.error("FALLA td-sube-armado:", mal.join(", "), errs.join(" | ")); process.exit(1); }
  console.log("OK td-sube-armado");
})();
