#!/usr/bin/env node
/* Trae a Virgilio de Registro Producción 3.0 lo nuevo de la botonera del operario de Gestión Virgilio.

   [Luis, 15/10/2026] «quiero comprobar que la parte de operarios de GV sea igual a la de RP3.0 (que cuando haya update en GV,
   se vea reflejado automáticamente en RP3.0)» · D1 «generador» · D2 «sí» (el chequeo de deriva) · «máxima prioridad que no se
   rompa nada en GV ahora: esto es para pasarle funcionalidades a RP3.0, no para GV».

   ⚠ SÓLO LEE el clon de Gestión Virgilio (git show). Nunca escribe ahí. Escribe sólo en virgilio/ y tools/gv_base.txt de este repo.

   Uso (desde la raíz de 3.0):
     node tools/traer_de_gv.cjs --gv <clon de Gestion-Virgilio> --revisar        # no escribe; sale 3 si GV tiene algo sin traer
     node tools/traer_de_gv.cjs --gv <clon> --version 30.NN                     # trae hasta el HEAD del clon y bumpea
     opciones: --hasta <rev de GV> (default HEAD) · --informe <archivo.md> · --forzar (escribe aunque haya choques sin resolver)

   Cómo funciona (y por qué no se equivoca en silencio):
     1. tools/gv_base.txt dice de qué commit de GV salió lo que hoy tiene virgilio/ (la BASE). Es un merge de 3 lados:
        BASE = GV en ese commit · NUESTRO = virgilio/ de acá · DE ELLOS = GV ahora.
     2. El JS se une POR UNIDAD (cada función, cada const/let/var, cada asignación de nivel superior; las IIFE como initAuth
        se abren y se unen por adentro). Por cada unidad de acá:
          igual en GV que en la base            → queda la de acá (puede ser propia de 3.0: login con la TV, cambio de sede…)
          acá igual a la base y GV la cambió     → se trae la de GV
          cambiaron los dos lados               → CHOQUE: queda la de acá y se lista. Si la unidad está en
                                                   tools/traer_de_gv.propio.json (lo propio de 3.0, con el motivo), es aviso;
                                                   si no, el script se corta (salvo --forzar) para que la una una persona.
          GV la borró y acá estaba como la base  → se borra
     3. Lo que acá NO está (lo que se recortó del supervisor) no se trae… salvo que el código que queda lo NOMBRE: entonces se
        trae esa unidad de GV, y lo que ella nombre, hasta cerrar (mismo criterio que el recorte del 06/10). Las entradas de
        supervisor (SUPERVISOR abajo) nunca se traen: si el operario las nombra, se avisa.
     4. El HTML y el CSS de fuera del JS se unen por líneas (git merge-file). Un choque deja lo de acá: si acá esa parte estaba
        recortada es lo esperado (se cuenta); si no, se lista para revisar.
     5. VUELTA EXACTA: antes de escribir, se corre el mismo merge con «DE ELLOS = BASE» y tiene que dar byte por byte el
        virgilio/ de hoy. Si no da, el script no sabe leer este archivo y se corta.
     6. recepcion.js, planimetria.js, supabase-config.js y sw.js: merge de 3 lados por líneas. Un archivo nuevo que el HTML
        pida (p. ej. gv-ui.css) se copia de GV.
     7. Lo propio de 3.0 que sí se pisa a la salida: APP_VERSION, SW_VERSION, version.json, el ?v= de recepcion.js y el sello
        gv_app «rp3@…» (D3, 15/10: que se sepa de qué app salió cada evento).
   Después: node tests/virgilio-*.cjs y el resto de tests/, revisar git diff, commit. */
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const cp = require("child_process");
const acorn = require("./vendor/acorn.js");

const RAIZ = path.join(__dirname, "..");
const VIR = path.join(RAIZ, "virgilio");
const BASE_TXT = path.join(__dirname, "gv_base.txt");
const PROPIO_JSON = path.join(__dirname, "traer_de_gv.propio.json");
const ARCHIVOS_JS = ["recepcion.js", "planimetria.js", "supabase-config.js", "sw.js", "gv-ui.css"];
// Archivos de GV que son de supervisor o del monitor: si GV agrega su <script>/<link> en una parte que acá quedó, se saca.
const NO_TRAER = [/^monitor\//, /^admin\//, /^importacion\.js$/, /^cobranzas\.js$/, /^hotsale\.js$/, /^estadisticas\.js$/, /^ads\.js$/,
  /^plantel\.js$/, /^analisis\.js$/, /^ayuda\.js$/, /^modulo_talleristas/, /^vendor\/(?!supabase)/];
// Entradas de supervisor: si el código del operario las nombra, NO se traen (se avisa). Mismas que tests/virgilio-solo-operario.cjs
// más los 5 cascarones (acá son funciones vacías a propósito).
const SUPERVISOR = new Set([
  "openFacturacion", "openPPP", "openStockAdmin", "openMonitor", "openCobranzas", "openPedidosImportacion", "openConfiguracion",
  "openPlanimMapa", "openColaImpresion", "openRecepcionAdmin", "openRemitosAdmin", "fetchMonitorDayStats", "renderMonitor",
  "computeInconsistencias", "pppLoadProgFromSupabase", "ocgGenerar", "facRender",
  "showSupervisor", "showConteo", "stkRender", "pppRenderProg", "psRender",
]);

class Corte extends Error {}

/* ---------------- argumentos ---------------- */
function args() {
  const a = process.argv.slice(2), o = { hasta: "HEAD" };
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    if (k === "--gv") o.gv = a[++i];
    else if (k === "--hasta") o.hasta = a[++i];
    else if (k === "--version") o.version = a[++i];
    else if (k === "--informe") o.informe = a[++i];
    else if (k === "--revisar") o.revisar = true;
    else if (k === "--forzar") o.forzar = true;
    else if (k === "--usar-gv") o.usarGv = a[++i].split(",").map(x => x.trim()).filter(Boolean);
    else throw new Corte("argumento desconocido: " + k);
  }
  if (!o.gv) throw new Corte("falta --gv <clon de Gestion-Virgilio>");
  if (!o.revisar && !o.version) throw new Corte("falta --version 30.NN (o --revisar para sólo mirar)");
  if (o.version && !/^\d+\.\d+$/.test(o.version)) throw new Corte("--version va como 30.NN (sin la v)");
  return o;
}

/* ---------------- git (sólo lectura del clon de GV) ---------------- */
function git(gv, a) { return cp.execFileSync("git", ["-C", gv].concat(a), { maxBuffer: 1 << 30 }).toString("utf8"); }
function gvShow(gv, rev, file) {
  try { return git(gv, ["show", rev + ":" + file]); } catch (_e) { return null; }
}

/* ---------------- unidades de JS ---------------- */
const norm = s => s.replace(/\s+/g, " ").trim();
function parse(code) {
  return acorn.parse(code, { ecmaVersion: "latest", sourceType: "script", allowReturnOutsideFunction: true, allowHashBang: true });
}
function iifeBody(st) {
  if (st.type !== "ExpressionStatement") return null;
  let e = st.expression;
  if (e.type === "UnaryExpression") e = e.argument;
  if (e.type !== "CallExpression") return null;
  let f = e.callee;
  if (f.type === "MemberExpression" && !f.computed && /^(call|apply)$/.test(f.property.name)) f = f.object;
  if ((f.type === "FunctionExpression" || f.type === "ArrowFunctionExpression") && f.body.type === "BlockStatement") return f;
  return null;
}
function texto(code, n) { return code.slice(n.start, n.end); }
function claveDe(code, st) {
  if (st.type === "FunctionDeclaration" || st.type === "ClassDeclaration") return (st.type === "ClassDeclaration" ? "class " : "fn ") + st.id.name;
  if (st.type === "VariableDeclaration") return "var " + st.declarations.map(d => d.id.type === "Identifier" ? d.id.name : norm(texto(code, d.id))).join(",");
  if (st.type === "ExpressionStatement") {
    const e = st.expression;
    if (e.type === "AssignmentExpression" && (e.left.type === "Identifier" || e.left.type === "MemberExpression")) return "asg " + norm(texto(code, e.left));
    if (e.type === "CallExpression" && e.callee.type === "MemberExpression" && e.arguments[0] && e.arguments[0].type === "Literal")
      return "call " + norm(texto(code, e.callee)) + " " + e.arguments[0].value;
  }
  return "stmt " + norm(texto(code, st)).slice(0, 200);
}
function definidos(code, st) {
  const out = [];
  if ((st.type === "FunctionDeclaration" || st.type === "ClassDeclaration") && st.id) out.push(st.id.name);
  else if (st.type === "VariableDeclaration") st.declarations.forEach(d => { if (d.id.type === "Identifier") out.push(d.id.name); });
  else if (st.type === "ExpressionStatement" && st.expression.type === "AssignmentExpression") {
    const l = st.expression.left;
    if (l.type === "Identifier") out.push(l.name);
    else if (l.type === "MemberExpression" && !l.computed && l.object.type === "Identifier" && /^(window|self|globalThis)$/.test(l.object.name)) out.push(l.property.name);
  }
  return out;
}
/* Una lista de unidades hermanas (el cuerpo de un <script> o de una IIFE). desde/hasta = el rango del contenedor. */
function unidades(code, body, desde, hasta, padre) {
  const lista = [], vistas = {};
  let prev = desde;
  for (const st of body) {
    let k = claveDe(code, st);
    const f = iifeBody(st);
    if (f) k = "iife " + ((f.id && f.id.name) || (() => {
      const pri = f.body.body.find(x => x.type === "FunctionDeclaration" || x.type === "VariableDeclaration");
      return pri ? claveDe(code, pri) : "#";
    })());
    vistas[k] = (vistas[k] || 0) + 1;
    if (vistas[k] > 1) k += " #" + vistas[k];
    const u = { clave: k, gap: code.slice(prev, st.start), start: st.start, end: st.end, txt: texto(code, st), defs: definidos(code, st), padre };
    if (f) {
      const b = f.body;   // BlockStatement
      u.hijos = unidades(code, b.body, b.start + 1, b.end - 1, u);
      u.cabeza = code.slice(st.start, b.start + 1);
      u.cola = code.slice(b.end - 1, st.end);
      u.resto = code.slice(u.hijos.length ? u.hijos[u.hijos.length - 1].end : b.start + 1, b.end - 1);
    }
    lista.push(u);
    prev = st.end;
  }
  lista.resto = code.slice(prev, hasta);
  return lista;
}

/* ---------------- HTML: scripts en línea vs esqueleto ---------------- */
const RE_SCRIPT = /(<script(?![^>]*\bsrc=)[^>]*>)([\s\S]*?)(<\/script>)/gi;
const MARCA = "\u0001JS\u0001";
function partir(html) {
  const js = [];
  const esq = html.replace(RE_SCRIPT, (_m, a, b, c) => { js.push(b); return a + MARCA + c; });
  return { esq, js };
}
function armarHtml(esq, js) {
  let i = 0;
  const out = esq.split(MARCA).map((p, j) => (j === 0 ? "" : js[i++]) + p).join("");
  if (i !== js.length) throw new Corte("el esqueleto unido no tiene la misma cantidad de <script> en línea");
  return out;
}

/* ---------------- merge por líneas (git merge-file), choques → lo nuestro ---------------- */
function mergeLineas(nuestro, base, ellos, nombre, choques) {
  if (nuestro === base) return ellos;
  if (ellos === base || ellos === nuestro) return nuestro;
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "traer-gv-"));
  const fo = path.join(d, "nuestro"), fb = path.join(d, "base"), ft = path.join(d, "ellos");
  fs.writeFileSync(fo, nuestro); fs.writeFileSync(fb, base); fs.writeFileSync(ft, ellos);
  const r = cp.spawnSync("git", ["merge-file", "--diff3", "-p", "-L", "rp3", "-L", "base", "-L", "gv", fo, fb, ft], { maxBuffer: 1 << 30 });
  fs.rmSync(d, { recursive: true, force: true });
  if (r.status < 0 || r.status > 127) throw new Corte("git merge-file falló en " + nombre + ": " + r.stderr);
  const lineas = r.stdout.toString("utf8").split("\n"), out = [];
  for (let i = 0; i < lineas.length; i++) {
    if (!lineas[i].startsWith("<<<<<<< rp3")) { out.push(lineas[i]); continue; }
    const o = [], b = [], t = []; let sec = o; i++;
    for (; i < lineas.length; i++) {
      const l = lineas[i];
      if (l.startsWith("||||||| base")) { sec = b; continue; }
      if (l === "=======") { sec = t; continue; }
      if (l.startsWith(">>>>>>> gv")) break;
      sec.push(l);
    }
    out.push(...o);
    choques.push({ archivo: nombre, recortado: o.join("").trim() === "", nuestro: o.join("\n"), gv: t.join("\n"), base: b.join("\n") });
  }
  return out.join("\n");
}

/* ---------------- referencias (para traer lo que el operario nombra) ---------------- */
function nombresUsados(code) {
  const out = new Set();
  let prevTok = null, prevPrev = null;
  try {
    for (const t of acorn.tokenizer(code, { ecmaVersion: "latest", allowReturnOutsideFunction: true })) {
      if (t.type === acorn.tokTypes.name) {
        const trasPunto = prevTok && prevTok.type === acorn.tokTypes.dot;
        if (!trasPunto || (prevPrev && prevPrev.type === acorn.tokTypes.name && /^(window|self|globalThis)$/.test(prevPrev.value))) out.add(t.value);
      } else if (t.type === acorn.tokTypes.string || t.type === acorn.tokTypes.template) {
        (String(t.value).match(/[A-Za-z_$][\w$]*(?=\s*\()/g) || []).forEach(n => out.add(n));
      }
      prevPrev = prevTok; prevTok = t;
    }
  } catch (_e) { (code.match(/[A-Za-z_$][\w$]*/g) || []).forEach(n => out.add(n)); }
  return out;
}
function nombresEnHtml(esq) {
  const out = new Set();
  for (const m of esq.matchAll(/\son\w+\s*=\s*"([^"]*)"/gi)) (m[1].match(/[A-Za-z_$][\w$]*(?=\s*\()/g) || []).forEach(n => out.add(n));
  return out;
}

/* ---------------- merge de unidades ---------------- */
function mapa(lista) { const m = new Map(); lista.forEach(u => m.set(u.clave, u)); return m; }
function todas(lista, out = []) { for (const u of lista) { out.push(u); if (u.hijos) todas(u.hijos, out); } return out; }
function ruta(u) { const p = []; for (let x = u; x; x = x.padre) p.unshift(x.clave); return p.join(" › "); }

/* Devuelve la lista resultante: cada elemento {gap, txt, hijos?, cabeza?, cola?, resto?, origen, clave, defs, g?} */
function unirLista(R, B, G, ctx, padreRuta) {
  const mB = mapa(B), mG = mapa(G), out = [];
  for (const r of R) {
    const b = mB.get(r.clave), g = mG.get(r.clave), donde = padreRuta + r.clave;
    if (r.hijos && b && b.hijos && g && g.hijos) {
      out.push({ clave: r.clave, gap: r.gap, cabeza: r.cabeza, cola: r.cola, defs: r.defs, g,
        hijos: unirLista(r.hijos, b.hijos, g.hijos, ctx, donde + " › "), resto: r.hijos.resto, origen: "rp3" });
      continue;
    }
    const nr = norm(r.txt), nb = b && norm(b.txt), ng = g && norm(g.txt);
    const queda = (o) => out.push({ clave: r.clave, gap: r.gap, txt: r.txt, defs: r.defs, g, origen: o, hijos: r.hijos && clonar(r.hijos), cabeza: r.cabeza, cola: r.cola, resto: r.hijos && r.hijos.resto });
    if (!b && !g) { queda("propio"); continue; }
    if (!b && g) { if (nr === ng) queda("rp3"); else { ctx.choques.push({ donde, tipo: "acá y en GV con el mismo nombre, distintas" }); queda("choque"); } continue; }
    if (b && !g) {
      if (nr === nb) { ctx.cambios.push({ donde, que: "GV la borró → se borra" }); continue; }
      ctx.choques.push({ donde, tipo: "GV la borró y acá cambió" }); queda("choque"); continue;
    }
    if (ng === nb || ng === nr) { queda("rp3"); continue; }
    if (nr === nb) {
      const gap = norm(r.gap) === norm(b.gap) ? g.gap : r.gap;
      out.push({ clave: r.clave, gap, txt: g.txt, defs: g.defs, g, origen: "gv", hijos: g.hijos && clonar(g.hijos), cabeza: g.cabeza, cola: g.cola, resto: g.hijos && g.hijos.resto });
      ctx.cambios.push({ donde, que: "se trae de GV" });
      continue;
    }
    if (ctx.usarGv.has(donde)) {
      ctx.usadosGv.add(donde);
      out.push({ clave: r.clave, gap: r.gap, txt: g.txt, defs: g.defs, g, origen: "gv", hijos: g.hijos && clonar(g.hijos), cabeza: g.cabeza, cola: g.cola, resto: g.hijos && g.hijos.resto });
      ctx.cambios.push({ donde, que: "se trae de GV (choque resuelto con --usar-gv)" });
      continue;
    }
    ctx.choques.push({ donde, tipo: "cambiaron los dos lados", rp3: r.txt, gv: g.txt, base: b.txt });
    queda("choque");
  }
  out.resto = R.resto;
  return out;
}
function clonar(lista) {
  const out = lista.map(u => ({ clave: u.clave, gap: u.gap, txt: u.txt, defs: u.defs, origen: "rp3", hijos: u.hijos && clonar(u.hijos), cabeza: u.cabeza, cola: u.cola, resto: u.resto }));
  out.resto = lista.resto;
  return out;
}
function emitir(lista) {
  let s = "";
  for (const u of lista) {
    s += u.gap;
    s += u.hijos ? u.cabeza + emitir(u.hijos) + u.cola : u.txt;
  }
  return s + (lista.resto || "");
}
function textoUnidad(u) { return u.hijos ? u.cabeza + emitir(u.hijos) + u.cola : u.txt; }

/* Trae de GV lo que el código de acá nombra y no está. sal = listas unidas (una por <script>), G = unidades de GV. */
function traerNombrado(sal, Gs, esq, ctx) {
  const defsG = new Map();   // nombre → unidad de GV (con su lista y posición)
  Gs.forEach((G, si) => {
    (function rec(lista, padreClaves) {
      lista.forEach((u, i) => {
        u.defs.forEach(n => { if (!defsG.has(n)) defsG.set(n, { u, lista, i, si, padreClaves }); });
        if (u.hijos) rec(u.hijos, padreClaves.concat([u.clave]));
      });
    })(G, []);
  });
  const definidosSal = () => { const s = new Set(); sal.forEach(L => todas(L).forEach(u => (u.defs || []).forEach(n => s.add(n)))); return s; };
  const usados = () => {
    const s = nombresEnHtml(esq);
    sal.forEach(L => todas(L).forEach(u => { if (!u.hijos) nombresUsados(u.txt).forEach(n => s.add(n)); else nombresUsados(u.cabeza).forEach(n => s.add(n)); }));
    return s;
  };
  const avisados = new Set();
  for (let vuelta = 0; vuelta < 50; vuelta++) {
    const def = definidosSal(), us = usados();
    const faltan = [...us].filter(n => !def.has(n) && defsG.has(n));
    let trajo = 0;
    for (const n of faltan) {
      if (SUPERVISOR.has(n)) { if (!avisados.has(n)) { avisados.add(n); ctx.supervisor.push(n); } continue; }
      const { u, lista, i, si, padreClaves } = defsG.get(n);
      // el contenedor de acá
      let dest = sal[si];
      for (const k of padreClaves) { const p = dest.find(x => x.clave === k); if (!p || !p.hijos) { dest = null; break; } dest = p.hijos; }
      if (!dest) { ctx.choques.push({ donde: padreClaves.join(" › ") + " › " + u.clave, tipo: "hace falta y su contenedor no está acá" }); continue; }
      if (dest.find(x => x.clave === u.clave)) continue;
      // ancla: el hermano anterior en GV que acá sí está
      let pos = 0;
      for (let j = i - 1; j >= 0; j--) { const idx = dest.findIndex(x => x.clave === lista[j].clave); if (idx >= 0) { pos = idx + 1; break; } }
      dest.splice(pos, 0, { clave: u.clave, gap: u.gap, txt: u.txt, defs: u.defs, origen: "gv-nueva", hijos: u.hijos && clonar(u.hijos), cabeza: u.cabeza, cola: u.cola, resto: u.hijos && u.hijos.resto });
      ctx.traidas.push({ donde: padreClaves.concat([u.clave]).join(" › "), lineas: u.txt.split("\n").length, por: n });
      trajo++;
    }
    if (!trajo) return;
  }
  throw new Corte("traer lo nombrado no cerró en 50 vueltas");
}

/* ---------------- el merge completo del index.html ---------------- */
function unirIndex(htmlR, htmlB, htmlG, ctx) {
  const pR = partir(htmlR), pB = partir(htmlB), pG = partir(htmlG);
  if (pR.js.length !== pB.js.length || pB.js.length !== pG.js.length)
    throw new Corte(`cantidad de <script> en línea distinta (3.0 ${pR.js.length}, base ${pB.js.length}, GV ${pG.js.length}): unir a mano`);
  let esq = mergeLineas(pR.esq, pB.esq, pG.esq, "index.html (HTML/CSS)", ctx.choquesHtml);
  // lo de supervisor/monitor que GV sumó en una parte que acá quedó: afuera
  esq = esq.split("\n").filter(l => {
    const m = l.match(/<(?:script|link)\b[^>]*(?:src|href)="([^"?#]+)/);
    if (!m || pR.esq.includes(m[1]) || !NO_TRAER.some(re => re.test(m[1]))) return true;
    ctx.sacados.push(m[1]);
    return false;
  }).join("\n");
  const sal = [], Gs = [];
  for (let i = 0; i < pR.js.length; i++) {
    const cR = pR.js[i], cB = pB.js[i], cG = pG.js[i];
    const R = unidades(cR, parse(cR).body, 0, cR.length, null);
    const B = unidades(cB, parse(cB).body, 0, cB.length, null);
    const G = unidades(cG, parse(cG).body, 0, cG.length, null);
    sal.push(unirLista(R, B, G, ctx, ""));
    Gs.push(G);
  }
  traerNombrado(sal, Gs, esq, ctx);
  const js = sal.map(emitir);
  js.forEach((c, i) => { try { parse(c); } catch (e) { throw new Corte(`el <script> ${i} unido no compila: ${e.message}`); } });
  return armarHtml(esq, js);
}

/* ---------------- lo propio de 3.0 a la salida ---------------- */
function sellar(html, sw, ver) {
  const v = "v" + ver;
  const una = (s, re, rep, que) => { const n = (s.match(re) || []).length; if (n !== 1) throw new Corte(`${que}: se esperaba 1 vez y está ${n}`); return s.replace(re, rep); };
  html = una(html, /const APP_VERSION = "v[\d.]+";/, `const APP_VERSION = "${v}";`, "APP_VERSION");
  html = una(html, /recepcion\.js\?v=[\d.]+/, `recepcion.js?v=${ver}`, "?v= de recepcion.js");
  sw = una(sw, /const SW_VERSION = "v[\d.]+-vir";/, `const SW_VERSION = "${v}-vir";`, "SW_VERSION");
  return { html, sw, versionJson: `{ "version": "${v}" }\n` };
}

/* ---------------- principal ---------------- */
function correr(o) {
  const gv = path.resolve(o.gv);
  const baseRev = fs.readFileSync(BASE_TXT, "utf8").split("\n").find(l => /^[0-9a-f]{7,40}\b/.test(l.trim())).trim().split(/\s+/)[0];
  const hasta = git(gv, ["rev-parse", o.hasta]).trim();
  const propio = JSON.parse(fs.readFileSync(PROPIO_JSON, "utf8"));
  const leerR = f => fs.readFileSync(path.join(VIR, f), "utf8");
  const nuevoCtx = () => ({ choques: [], choquesHtml: [], cambios: [], traidas: [], supervisor: [], sacados: [],
    usarGv: new Set(o.usarGv || []), usadosGv: new Set() });

  const htmlR = leerR("index.html");
  const htmlB = gvShow(gv, baseRev, "index.html");
  const htmlG = gvShow(gv, hasta, "index.html");
  if (htmlB == null) throw new Corte(`el clon de GV no tiene el commit base ${baseRev} (git -C ${gv} fetch --deepen=2000 origin main)`);

  // 5. vuelta exacta: con «de ellos = base» tiene que dar lo de hoy
  const ctx0 = nuevoCtx();
  if (unirIndex(htmlR, htmlB, htmlB, ctx0) !== htmlR) throw new Corte("VUELTA EXACTA: con GV = base el merge no reproduce virgilio/index.html tal cual. No se escribe nada.");

  const ctx = nuevoCtx();
  let html = unirIndex(htmlR, htmlB, htmlG, ctx);
  if (html.includes("\u0000")) throw new Corte("la salida trae el byte NUL de GV (código de supervisor que no debía entrar)");

  const otros = {};
  for (const f of ARCHIVOS_JS) {
    const r = leerR(f), b = gvShow(gv, baseRev, f), g = gvShow(gv, hasta, f);
    if (b == null || g == null) { ctx.choques.push({ donde: f, tipo: "no está en GV (base o ahora)" }); otros[f] = r; continue; }
    otros[f] = mergeLineas(r, b, g, f, ctx.choquesHtml);
  }
  // 6. archivos nuevos que el HTML pide
  const nuevos = {};
  for (const m of html.matchAll(/(?:src|href)="([^"?#:]+\.(?:js|css))(?:\?[^"]*)?"/g)) {
    const f = m[1];
    if (f.startsWith("../") || f.startsWith("/") || fs.existsSync(path.join(VIR, f))) continue;
    const g = gvShow(gv, hasta, f);
    if (g == null) ctx.choques.push({ donde: f, tipo: "el HTML lo pide y no está ni acá ni en GV" });
    else nuevos[f] = g;
  }
  // 7. sello gv_app propio (D3)
  const conSello = (s, re, rep, que) => {
    if (!re.test(s) && !s.includes(rep)) ctx.choques.push({ donde: que, tipo: "no se encontró el sello gv_app para ponerle rp3@" });
    return s.replace(re, rep);
  };
  html = conSello(html, /const GV_APP_TAG = "gestion@" \+ APP_VERSION;/, 'const GV_APP_TAG = "rp3@" + APP_VERSION;', "GV_APP_TAG");
  otros["sw.js"] = conSello(otros["sw.js"], /gv_app: "gestion-sw@"/, 'gv_app: "rp3-sw@"', "sw.js gv_app");

  // clasificar choques
  const sinResolver = ctx.choques.filter(c => !propio[c.donde]);
  const choquesHtmlReales = ctx.choquesHtml.filter(c => !c.recortado);
  // Un cambio que es SÓLO un número de caché (`?v=`) no es un cambio: GV mueve el de gv-ui.css en cada versión aunque el
  // archivo sea idéntico, y eso hacía que el chequeo diera «hay algo» cada vez (15/10, chequeo de las 13:10).
  const sinTok = s => s.replace(/\?v=[\d.]+/g, "?v=");
  const hayAlgo = sinTok(html) !== sinTok(htmlR) || ARCHIVOS_JS.some(f => sinTok(otros[f]) !== sinTok(leerR(f))) || Object.keys(nuevos).length;

  const inf = informe({ baseRev, hasta, ctx, propio, sinResolver, choquesHtmlReales, nuevos, hayAlgo });
  if (o.informe) fs.writeFileSync(o.informe, inf);
  console.log(inf.split("\n").slice(0, 60).join("\n"));

  const sinUsar = [...ctx.usarGv].filter(k => !ctx.usadosGv.has(k));
  if (sinUsar.length) throw new Corte("--usar-gv nombra unidades que no chocan: " + sinUsar.join(", "));
  if (o.revisar) return hayAlgo || sinResolver.length ? 3 : 0;
  if (sinResolver.length && !o.forzar) throw new Corte(`${sinResolver.length} choque(s) sin resolver (ver informe). No se escribe nada; unir a mano o anotarlos en ${path.basename(PROPIO_JSON)}.`);
  const s = sellar(html, otros["sw.js"], o.version);
  fs.writeFileSync(path.join(VIR, "index.html"), s.html);
  for (const f of ARCHIVOS_JS) fs.writeFileSync(path.join(VIR, f), f === "sw.js" ? s.sw : otros[f]);
  fs.writeFileSync(path.join(VIR, "version.json"), s.versionJson);
  for (const f in nuevos) { fs.mkdirSync(path.dirname(path.join(VIR, f)), { recursive: true }); fs.writeFileSync(path.join(VIR, f), nuevos[f]); }
  const viejo = fs.readFileSync(BASE_TXT, "utf8").split("\n").filter(l => !/^[0-9a-f]{7,40}\b/.test(l.trim()));
  fs.writeFileSync(BASE_TXT, [hasta + "  " + git(gv, ["log", "-1", "--format=%s", hasta]).trim().slice(0, 100)].concat(viejo).join("\n"));
  console.log(`\nEscrito virgilio/ v${o.version} (GV ${hasta.slice(0, 8)}). Correr tests/ y revisar git diff.`);
  return 0;
}

function informe({ baseRev, hasta, ctx, propio, sinResolver, choquesHtmlReales, nuevos, hayAlgo }) {
  const L = [];
  L.push(`# Traer de GV — base ${baseRev.slice(0, 8)} → GV ${hasta.slice(0, 8)}`, "");
  L.push(hayAlgo ? "GV tiene cambios de operario sin traer." : "Nada nuevo de GV para la botonera.", "");
  L.push(`- Unidades que se traen de GV: ${ctx.cambios.filter(c => c.que === "se trae de GV").length}`);
  L.push(`- Unidades que GV borró: ${ctx.cambios.filter(c => c.que !== "se trae de GV").length}`);
  L.push(`- Unidades nuevas de GV que el operario nombra: ${ctx.traidas.length} (${ctx.traidas.reduce((a, t) => a + t.lineas, 0)} líneas)`);
  L.push(`- Choques de JS: ${ctx.choques.length} (propios de 3.0: ${ctx.choques.length - sinResolver.length}, SIN RESOLVER: ${sinResolver.length})`);
  L.push(`- Choques de HTML/CSS: ${ctx.choquesHtml.length} (en partes recortadas: ${ctx.choquesHtml.length - choquesHtmlReales.length}, a revisar: ${choquesHtmlReales.length})`);
  L.push(`- Supervisor nombrado por el operario (no se trae): ${ctx.supervisor.join(", ") || "—"}`);
  L.push(`- Archivos nuevos: ${Object.keys(nuevos).join(", ") || "—"}`);
  L.push(`- <script>/<link> de supervisor que GV sumó y no se traen: ${ctx.sacados.join(", ") || "—"}`, "");
  if (sinResolver.length) { L.push("## Choques SIN RESOLVER (unir a mano)", ""); sinResolver.forEach(c => L.push(`- \`${c.donde}\` — ${c.tipo}`)); L.push(""); }
  const prop = ctx.choques.filter(c => propio[c.donde]);
  if (prop.length) { L.push("## Propios de 3.0 que GV también cambió (quedó lo de 3.0; mirar si hay algo que portar)", ""); prop.forEach(c => L.push(`- \`${c.donde}\` — ${propio[c.donde]}`)); L.push(""); }
  if (choquesHtmlReales.length) {
    L.push("## HTML/CSS: quedó lo de 3.0 (revisar)", "");
    choquesHtmlReales.forEach(c => L.push(`- ${c.archivo}: 3.0 \`${norm(c.nuestro).slice(0, 120)}\` · GV \`${norm(c.gv).slice(0, 120)}\``));
    L.push("");
  }
  L.push("## Se traen de GV", "", ...ctx.cambios.map(c => `- \`${c.donde}\` — ${c.que}`), "");
  L.push("## Nuevas (las nombra el operario)", "", ...ctx.traidas.map(t => `- \`${t.donde}\` (${t.lineas} líneas, por \`${t.por}\`)`), "");
  return L.join("\n");
}

if (require.main === module) {
  try { process.exit(correr(args())); }
  catch (e) { if (e instanceof Corte) { console.error("✋ " + e.message); process.exit(1); } throw e; }
}
module.exports = { correr };
