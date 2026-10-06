/* ============================================================================
   ESTADÍSTICAS ISIS — ventas y pedidos por artículo (v26.16 · v26.20, Luis 02/10/2026)
   ----------------------------------------------------------------------------
   Reemplaza la bajada a mano de ISIS de dos reportes mensuales, y desde la v26.20 los
   entrega YA CONFIGURADOS como piden los manuales (Luis: «configuralas de la forma que
   indica el word»):
     · Manual 29 — Estadísticas de ventas mensuales → esta_vtaarticutot1corte_vtas_<mes>_<lk|ch>.xls.
       Sin las columnas F, D y C (paso 21) ni el «Total General» (paso 22): A2:D es lo que se
       pega en Costos («Pegar Estad Vtas Mes LK y CH»), con el código ya como número (paso 25).
     · Manual 31 — Estadística de pedidos → vta_pedidoporarticulotot_pedidos_<lk|ch>_<mes>_<aa>.xls.
       Sin las columnas I, J y K (paso 1), código como número (paso 2), hoja «LK Sep-26» (paso 3).
       El BUSCARV de la Est. Madre sobre B:H (col 7 = unidades, 4 = cajas) no cambia.
       PEDIDOS DISRUPTIVOS (IMPORTANTE del manual 31): la fila del artículo va en ROJO y NEGRITA y
       en la columna I (la siguiente a la última) va el detalle: cliente, cuánto pidió y contra qué
       promedio. Disruptivo = un pedido de un cliente que difiere más de ±50 % del promedio de SUS
       pedidos anteriores de ese artículo en los 12 meses previos; sin pedidos previos =
       incorporación. Lo calcula gv_isis_estad_pedidos_disruptivos (sql/gv_isis_estad_disruptivos_v2620.sql).

   DE DÓNDE SALE:
     · VENTAS: gv_isis_estad_ventas — las facturas y NC de ISIS ya parseadas (sept/26 verificado
       contra el Excel de ISIS artículo por artículo).
     · PEDIDOS: gv_isis_estad_pedidos — sólo los pedidos web del pipeline de Gestión, por fecha del
       pedido (Luis, 02/10). No es el reporte de ISIS, que sólo tiene lo cargado al facturar.

   ⚠ Si una RPC vuelve VACÍA o con error no se baja nada (con la sesión vencida el guard de
   supervisor devuelve 0 filas: regla "una lectura ROTA no es un CERO"). Lo mismo si fallan los
   disruptivos: un archivo sin marcar no se distingue de un mes sin disruptivos.
   ⚠ SheetJS community no escribe estilos: el rojo y la negrita se pegan en el BIFF (eiXlsBytes).

   Vive en su propio archivo (regla v23.98). ?v= atado a APP_VERSION: está en
   SIGUEN_APP_VERSION de scripts/bump-version.cjs y tests/version-tokens.cjs.
   SQL: sql/gv_isis_estadisticas_v2616.sql y sql/gv_isis_estad_disruptivos_v2620.sql.
   Candado: tests/isis-estadisticas.cjs.
   ============================================================================ */

var _EI_MES3 = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
var _EI_MESV = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];
var _ei = { res: {}, busy: false };

/* ---------- armado de la hoja (puro: lo prueba tests/isis-estadisticas.cjs) ---------- */

function _eiNum(v) { var n = Number(v); return isFinite(n) ? n : 0; }
function _eiPut(ws, r, c, v, z) {
  var a = _eiAddr(r, c);
  if (typeof v === "number") ws[a] = z ? { t: "n", v: v, z: z } : { t: "n", v: v };
  else ws[a] = z ? { t: "s", v: String(v), z: z } : { t: "s", v: String(v) };
}
function _eiAddr(r, c) {
  var s = "", n = c + 1;
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s + (r + 1);
}
/* «Convertir en número» (paso 25 del manual 29, paso 2 del 31): el código todo dígitos va como NÚMERO
   (026 → 26, igual que lo convierte Excel); el que lleva letras (026L, 437E) queda texto. */
function eiCodVal(cod) {
  var s = String(cod == null ? "" : cod).trim();
  return /^\d+$/.test(s) ? Number(s) : s;
}
function _eiCols(ws, anchos) { ws["!cols"] = anchos.map(function (w) { return { wch: w }; }); }

/* Formatos MARCA de una fila disruptiva: se ven igual que los normales y eiXlsBytes les pone la
   letra roja y negrita (SheetJS community no escribe estilos: el color se pega en el BIFF). */
var _EI_MARCA = { s: "@", n2: "#,##0.00;-#,##0.00", n0: "0;-0" };

/* VENTAS configurada (manual 29): el export de ISIS sin las columnas F, D y C (paso 21) y sin los
   blancos que deja Crystal, sin «Total General» ni pie (el paso 22 los saca). A2:D = lo que se pega
   en Costos: código · descripción · bonificación · cantidad. */
function eiHojaVentas(rows, o) {
  o = o || {};
  var ws = {}, r = 0, Q = "#,##0.000", P = "#,##0.00";
  ["Artículo", "Descripción", "Bonificación", "Cantidad", "Máximo", "Promedio", "Mínimo", "Total", "% Particip."]
    .forEach(function (h, i) { _eiPut(ws, 0, i, h); });
  (rows || []).forEach(function (x) {
    r++;
    _eiPut(ws, r, 0, eiCodVal(x.cod));
    _eiPut(ws, r, 1, String(x.descripcion == null ? "" : x.descripcion));
    _eiPut(ws, r, 2, 0, Q);
    _eiPut(ws, r, 3, _eiNum(x.cantidad), Q);
    _eiPut(ws, r, 4, _eiNum(x.precio_max), P);
    _eiPut(ws, r, 5, _eiNum(x.promedio), P);
    _eiPut(ws, r, 6, _eiNum(x.precio_min), P);
    _eiPut(ws, r, 7, _eiNum(x.total), P);
    _eiPut(ws, r, 8, _eiNum(x.particip), P);
  });
  ws["!ref"] = "A1:" + _eiAddr(Math.max(r, 1), 8);
  _eiCols(ws, [9, 34, 11, 12, 12, 12, 12, 14, 9]);
  return ws;
}

/* PEDIDOS configurada (manual 31): el export de ISIS sin las columnas I, J y K (paso 1). Queda
   A Div · B código · C descripción · D caja · E cajas · F bonif · G unidad · H unidades: el BUSCARV
   de la Est. Madre sobre B:H (col 7 = unidades, col 4 = cajas) no cambia.
   o.disrup = { cod: [pedidos disruptivos] } (eiDisrupMapa): esa fila va en ROJO y NEGRITA y en la
   columna siguiente a la última (I) va el detalle — quién, cuánto y contra qué promedio. */
function eiHojaPedidos(rows, o) {
  o = o || {};
  var ws = {}, r = 0, P = "#,##0.00", dis = o.disrup || {}, hayDis = false;
  _eiPut(ws, 0, 1, "Artículo"); _eiPut(ws, 0, 3, "Med."); _eiPut(ws, 0, 4, "Cantidad"); _eiPut(ws, 0, 5, "Bonificac.");
  _eiPut(ws, 0, 6, "Med."); _eiPut(ws, 0, 7, "Cantidad");
  (rows || []).forEach(function (x) {
    r++;
    var lista = dis[_eiCodKey(x.cod)] || null;
    var zs = lista ? _EI_MARCA.s : null, zn = lista ? _EI_MARCA.n2 : P;
    var cod = eiCodVal(x.cod);
    _eiPut(ws, r, 0, "Div", zs);
    _eiPut(ws, r, 1, cod, lista ? (typeof cod === "number" ? _EI_MARCA.n0 : _EI_MARCA.s) : null);
    _eiPut(ws, r, 2, String(x.descripcion == null ? "" : x.descripcion), zs);
    _eiPut(ws, r, 3, "caja", zs);
    _eiPut(ws, r, 4, _eiNum(x.cajas), zn);
    _eiPut(ws, r, 5, 0, zn);
    _eiPut(ws, r, 6, "unidad", zs);
    /* sin UxB la base devuelve unidades vacías: la celda queda vacía (el BUSCARV da error y el SI.ERROR del
       manual 31 lo deja en blanco), nunca las cajas disfrazadas de unidades */
    if (x.unidades != null && x.unidades !== "") _eiPut(ws, r, 7, _eiNum(x.unidades), zn);
    if (lista) { _eiPut(ws, r, 8, eiDisrupTexto(lista, o.emp), _EI_MARCA.s); hayDis = true; }
  });
  if (hayDis) _eiPut(ws, 0, 8, "Pedido disruptivo (±50 % del promedio de sus pedidos de 12 meses)");
  ws["!ref"] = "A1:" + _eiAddr(Math.max(r, 1), hayDis ? 8 : 7);
  _eiCols(ws, hayDis ? [5, 9, 30, 6, 10, 10, 7, 11, 90] : [5, 9, 30, 6, 10, 10, 7, 11]);
  return ws;
}

/* ---------- pedidos disruptivos (gv_isis_estad_pedidos_disruptivos) ---------- */
function _eiCodKey(c) { return String(c == null ? "" : c).trim().toUpperCase(); }
function _eiN(v, dec) {
  var n = Number(v); if (!isFinite(n)) return "—";
  var neg = n < 0, s = Math.abs(n).toFixed(dec || 0).split(".");
  var ent = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return (neg ? "-" : "") + ent + (s[1] && /[1-9]/.test(s[1]) ? "," + s[1] : "");
}
function _eiDdMm(f, conAnio) {
  var p = String(f || "").slice(0, 10).split("-");
  return p.length === 3 ? p[2] + "/" + p[1] + (conAnio ? "/" + p[0].slice(2) : "") : String(f || "");
}
/* lo pedido: unidades y cajas; sin UxB, sólo cajas (nunca las cajas disfrazadas de unidades) */
function _eiCant(u, cj) {
  return (u != null && u !== "" && isFinite(Number(u))) ? _eiN(u, 0) + " u (" + _eiN(cj, 1) + " cj)" : _eiN(cj, 1) + " cj";
}
function eiDisrupMapa(filas) {
  var m = {};
  (filas || []).forEach(function (d) { var k = _eiCodKey(d.cod); if (!k) return; (m[k] = m[k] || []).push(d); });
  return m;
}
/* el comentario de la fila: incorporaciones primero, después el desvío más grande; hasta 5 y «+N más» */
function eiDisrupTexto(lista, emp) {
  var pre = String(emp || "").toLowerCase() === "lk" ? "LK " : (emp ? "CH " : "");
  var l = (lista || []).slice().sort(function (a, b) {
    var ia = a.tipo === "incorporacion" ? 1 : 0, ib = b.tipo === "incorporacion" ? 1 : 0;
    if (ia !== ib) return ib - ia;
    return Math.abs(_eiNum(b.desvio)) - Math.abs(_eiNum(a.desvio));
  });
  var MAX = 5, txt = l.slice(0, MAX).map(function (d) {
    var quien = String(d.razon_social || "").trim() || "Cliente";
    quien += " (" + pre + String(d.cliente == null ? "" : d.cliente) + ")";
    var cuanto = _eiCant(d.unidades, d.cajas) + " el " + _eiDdMm(d.fecha);
    if (d.tipo === "incorporacion") return "★ Incorporación: " + quien + " pidió " + cuanto;
    var pct = Math.round(_eiNum(d.desvio) * 100);
    var hist = "prom. " + _eiCant(d.prom_unidades, d.prom_cajas) + " en " + _eiN(d.pedidos_hist, 0) + " ped." +
      (_eiNum(d.hist_fc) > 0 ? " (" + _eiN(d.hist_fc, 0) + " por factura ISIS)" : "") +
      (d.hist_desde ? " desde " + _eiDdMm(d.hist_desde, true) : "");
    return (pct >= 0 ? "▲ +" : "▼ ") + pct + "%: " + quien + " pidió " + cuanto + " · " + hist;
  });
  if (l.length > MAX) txt.push("+" + (l.length - MAX) + " más");
  return txt.join(" | ");
}

/* nombre de la hoja: «LK Sep-26» (la «LK MES-AÑO» del manual 31); un rango suelto lleva las fechas */
function eiNombreHoja(emp, desde, hasta) {
  var e = String(emp || "").toLowerCase() === "lk" ? "LK" : "CH";
  var dd = String(desde || "").split("-"), hh = String(hasta || "").split("-");
  if (dd.length !== 3 || hh.length !== 3) return e;
  var mesEntero = dd[2] === "01" && dd[0] === hh[0] && dd[1] === hh[1] &&
    Number(hh[2]) === new Date(Date.UTC(Number(hh[0]), Number(hh[1]), 0)).getUTCDate();
  if (mesEntero) { var m = _EI_MES3[Number(dd[1]) - 1] || ""; return e + " " + m.charAt(0).toUpperCase() + m.slice(1) + "-" + dd[0].slice(2); }
  return e + " " + dd[2] + "." + dd[1] + "-" + hh[2] + "." + hh[1] + "-" + hh[0].slice(2);
}

/* .xls Excel 97 (BIFF8), con dos parches sobre el stream «Workbook» antes de bajarlo:
   1) letra Arial 10 como ISIS (SheetJS la escribe en 12): altura de los FONT (0x0031);
   2) la fila disruptiva en ROJO y NEGRITA: se agrega un FONT rojo/negrita y los XF de celda cuyo
      formato es una MARCA (_EI_MARCA) pasan a usarlo. Insertar un registro corre lo que sigue, así
      que se corrige el puntero absoluto de cada BOUNDSHEET (SheetJS no escribe INDEX, DBCELL ni
      EXTSST, que también lo tendrían: si algún día aparecen, no se marca nada y se avisa). */
function _eiU16(c, p) { return c[p] | (c[p + 1] << 8); }
function _eiBiffEstilos(c) {
  var recs = [], p = 0;
  while (p + 4 <= c.length) {
    var t = _eiU16(c, p), len = _eiU16(c, p + 2);
    recs.push({ t: t, p: p, len: len });
    p += 4 + len;
    if (t === 0x0A) break;                         /* EOF del globals */
  }
  var fonts = recs.filter(function (r) { return r.t === 0x31; });
  fonts.forEach(function (r) { if (r.len >= 2) { c[r.p + 4] = 200 & 255; c[r.p + 5] = 200 >> 8; } });
  /* qué índices de formato son marca: «@» es el 49 de fábrica; los otros, por su texto */
  var marcas = { 49: true }, txtMarca = [_EI_MARCA.n2, _EI_MARCA.n0];
  recs.forEach(function (r) {
    if (r.t !== 0x41E || r.len < 5) return;
    var d = r.p + 4, ifmt = _eiU16(c, d), cch = _eiU16(c, d + 2), hi = c[d + 4] & 1, s = "";
    for (var i = 0; i < cch; i++) s += String.fromCharCode(hi ? _eiU16(c, d + 5 + 2 * i) : c[d + 5 + i]);
    if (txtMarca.indexOf(s) >= 0) marcas[ifmt] = true;
  });
  var nf = fonts.length, ifntRojo = nf >= 4 ? nf + 1 : nf;    /* el índice 4 de FONT no existe en BIFF */
  var xfs = recs.filter(function (r) {
    if (r.t !== 0xE0 || r.len < 20) return false;
    var d = r.p + 4;
    return !(_eiU16(c, d + 4) & 0x0004) && marcas[_eiU16(c, d + 2)];   /* XF de celda con formato marca */
  });
  if (!xfs.length || !fonts.length) return { bytes: c, marcadas: 0 };
  if (recs.some(function (r) { return r.t === 0xFF || r.t === 0x20B || r.t === 0xD7; })) return { bytes: c, marcadas: -1 };
  xfs.forEach(function (r) {
    var d = r.p + 4;
    c[d] = ifntRojo & 255; c[d + 1] = ifntRojo >> 8;
    c[d + 9] |= 0x0C;                               /* fAtrNum + fAtrFnt: esta XF manda su letra */
  });
  var ult = fonts[fonts.length - 1], tam = 4 + ult.len;
  var nuevo = c.slice(ult.p, ult.p + tam);
  nuevo[4] = 200 & 255; nuevo[5] = 200 >> 8;          /* 10 pt */
  nuevo[6] |= 0x01;                                   /* grbit bit 0: negrita (redundante con bls; algunos lectores sólo miran éste) */
  nuevo[8] = 0x0A; nuevo[9] = 0;                      /* icv 10 = rojo de la paleta */
  nuevo[10] = 700 & 255; nuevo[11] = 700 >> 8;        /* bls 700 = negrita */
  var corte = ult.p + tam, out = new Uint8Array(c.length + tam);
  out.set(c.subarray(0, corte), 0); out.set(nuevo, corte); out.set(c.subarray(corte), corte + tam);
  recs.forEach(function (r) {
    if (r.t !== 0x85) return;
    var d = r.p + 4 + (r.p >= corte ? tam : 0);
    var pos = (out[d] | (out[d + 1] << 8) | (out[d + 2] << 16) | (out[d + 3] << 24)) >>> 0;
    if (pos >= corte) pos += tam;
    out[d] = pos & 255; out[d + 1] = (pos >>> 8) & 255; out[d + 2] = (pos >>> 16) & 255; out[d + 3] = (pos >>> 24) & 255;
  });
  return { bytes: out, marcadas: xfs.length };
}
function eiXlsBytes(X, ws, hoja) {
  var wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, ws, String(hoja || "Sheet1").slice(0, 31));
  var u8 = new Uint8Array(X.write(wb, { bookType: "biff8", type: "array" }));
  try {
    if (!X.CFB) return u8;
    var cfb = X.CFB.read(u8, { type: "array" });
    var ent = (cfb.FileIndex || []).find(function (f) { return f && (f.name === "Workbook" || f.name === "Book"); });
    if (!ent || !ent.content) return u8;
    /* un stream grande CFB lo devuelve como Array, no Uint8Array: se normaliza antes de parchar */
    var c = ent.content instanceof Uint8Array ? ent.content : Uint8Array.from(ent.content);
    var r = _eiBiffEstilos(c);
    if (r.marcadas < 0 && typeof console !== "undefined") console.warn("estadisticas: el .xls trae INDEX/EXTSST, la fila disruptiva no se pintó");
    ent.content = r.bytes; ent.size = r.bytes.length;
    return new Uint8Array(X.CFB.write(cfb, { type: "array" }));
  } catch (_e) { return u8; }
}

/* nombre del archivo, como lo guardan hoy (mes entero) o con las fechas si es un rango suelto */
function eiNombre(tipo, emp, desde, hasta) {
  var d = String(desde || ""), h = String(hasta || "");
  var dd = d.split("-"), hh = h.split("-");
  var mesEntero = dd.length === 3 && hh.length === 3 && dd[2] === "01" && dd[0] === hh[0] && dd[1] === hh[1] &&
    Number(hh[2]) === new Date(Date.UTC(Number(hh[0]), Number(hh[1]), 0)).getUTCDate();
  var e = String(emp || "").toLowerCase() === "lk" ? "lk" : "ch";
  if (tipo === "ventas") {
    var mv = mesEntero ? _EI_MESV[Number(dd[1]) - 1] : (dd[2] + dd[1] + "-" + hh[2] + hh[1]);
    return "esta_vtaarticutot1corte_vtas_" + mv + "_" + e + ".xls";
  }
  var mp = mesEntero ? _EI_MES3[Number(dd[1]) - 1] + "_" + dd[0].slice(2) : (dd[2] + dd[1] + "-" + hh[2] + hh[1] + "_" + hh[0].slice(2));
  return "vta_pedidoporarticulotot_pedidos_" + e + "_" + mp + ".xls";
}

/* ---------- pantalla ---------- */

function _eiEsc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
function _eiFmt(v, dec) { var n = Number(v); return isFinite(n) ? n.toLocaleString("es-AR", { minimumFractionDigits: dec, maximumFractionDigits: dec }) : "—"; }
function _eiIso(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function _eiRpc(name, args) {
  var sb = window.sb;
  if (!sb || typeof sb.rpc !== "function") return Promise.resolve({ data: null, error: { message: "sin sesión" } });
  try { return Promise.resolve(sb.rpc(name, args || {})).catch(function (e) { return { data: null, error: e }; }); }
  catch (e) { return Promise.resolve({ data: null, error: e }); }
}
async function _eiXlsx() {
  if (window.XLSX) return window.XLSX;
  if (typeof pppLoadXlsx === "function") return pppLoadXlsx();
  return new Promise(function (res, rej) {
    var sc = document.createElement("script"); sc.src = "vendor/xlsx.full.min.js";
    sc.onload = function () { window.XLSX ? res(window.XLSX) : rej(new Error("SheetJS no cargó")); };
    sc.onerror = function () { rej(new Error("No pude cargar SheetJS")); };
    document.head.appendChild(sc);
  });
}
function _eiBajar(bytes, nombre) {
  var blob = new Blob([bytes], { type: "application/vnd.ms-excel" });
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = nombre;
  document.body.appendChild(a); a.click();
  setTimeout(function () { try { URL.revokeObjectURL(a.href); a.remove(); } catch (_e) {} }, 4000);
}

var _EI_RPC_DISRUP = "gv_isis_estad_pedidos_disruptivos";
var _EI_REP = [
  { k: "vlk", tipo: "ventas", emp: "lk", t: "Ventas LK", rpc: "gv_isis_estad_ventas", man: "Manual 29 · costos" },
  { k: "vch", tipo: "ventas", emp: "ch", t: "Ventas CH", rpc: "gv_isis_estad_ventas", man: "Manual 29 · costos" },
  { k: "plk", tipo: "pedidos", emp: "lk", t: "Pedidos LK", rpc: "gv_isis_estad_pedidos", man: "Manual 31 · Est. Madre" },
  { k: "pch", tipo: "pedidos", emp: "ch", t: "Pedidos CH", rpc: "gv_isis_estad_pedidos", man: "Manual 31 · Est. Madre" }
];

function _eiCss() {
  if (document.getElementById("eiCss")) return;
  var st = document.createElement("style");
  st.id = "eiCss";
  st.textContent = [
    "#eiOv{position:fixed;inset:0;z-index:9600;background:#f1f5f9;display:none;flex-direction:column;font-family:system-ui,Segoe UI,Arial,sans-serif;color:#0f172a;}",
    "#eiOv *{box-sizing:border-box;}",
    /* el button{width:100%;padding:16px;font-size:22px} global del index se neutraliza acá (pozo de cobranzas / Importados) */
    "#eiOv button{width:auto;margin-top:0;padding:6px 13px;font-size:13px;line-height:1.25;}",
    "#eiOv input{width:auto;margin-top:0;font:inherit;font-size:14px;font-weight:700;text-align:center;padding:5px 6px;border:1px solid #cbd5e1;border-radius:7px;background:#fff;color:#0f172a;}",
    ".ei-top{display:flex;align-items:center;gap:14px;padding:10px 16px;background:linear-gradient(90deg,#1e3a8a,#172554);color:#fff;flex:0 0 auto;flex-wrap:wrap;}",
    ".ei-top b{font-size:17px;}",
    ".ei-top span{font-size:12.5px;opacity:.9;flex:1 1 300px;min-width:0;}",
    ".ei-x{margin-left:auto;background:#fff;color:#172554;border:none;border-radius:8px;font-weight:800;cursor:pointer;}",
    ".ei-body{flex:1;min-height:0;overflow:auto;padding:14px 16px;}",
    ".ei-wrap{width:fit-content;max-width:100%;margin:0 auto;display:grid;gap:12px;justify-items:center;}",
    ".ei-per{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:end;justify-content:center;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:10px 14px;}",
    ".ei-per label{display:grid;gap:3px;font-size:11.5px;color:#475569;font-weight:600;text-align:center;}",
    ".ei-t{border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;font-variant-numeric:tabular-nums;}",
    ".ei-t th,.ei-t td{padding:6px 10px;text-align:center;border-bottom:1px solid #e2e8f0;white-space:nowrap;font-size:13px;}",
    ".ei-t th{font-size:11.5px;font-weight:800;color:#475569;background:#f8fafc;line-height:1.2;}",
    ".ei-t td.r{font-weight:800;}",
    ".ei-t td small{display:block;font-weight:500;color:#64748b;font-size:11px;}",
    ".ei-t td .err{color:#b91c1c;font-weight:700;white-space:normal;max-width:30ch;display:inline-block;}",
    ".ei-t button{background:#1e3a8a;color:#fff;border:none;border-radius:8px;font-weight:800;cursor:pointer;}",
    ".ei-t button:disabled{opacity:.5;cursor:wait;}",
    ".ei-todas{background:#0f172a;color:#fff;border:none;border-radius:8px;font-weight:800;cursor:pointer;}",
    ".ei-nota{max-width:640px;font-size:12px;color:#475569;line-height:1.4;text-align:center;}",
    ".ei-nota b{color:#0f172a;}"
  ].join("\n");
  document.head.appendChild(st);
}

function openEstadisticasIsis() {
  try { if (typeof requireSupervisor === "function" && !requireSupervisor()) return; } catch (_e) {}
  _eiCss();
  var ov = document.getElementById("eiOv");
  if (!ov) { ov = document.createElement("div"); ov.id = "eiOv"; document.body.appendChild(ov); }
  var hoy = new Date();
  var ini = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1), fin = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
  ov.style.display = "flex";
  ov.innerHTML =
    '<div class="ei-top"><b>📑 Estadísticas ISIS por artículo</b>' +
      '<span>Ventas (manual 29) y pedidos (manual 31) con el mismo Excel que da ISIS, sin entrar a ISIS.</span>' +
      '<button class="ei-x" onclick="eiClose()">Cerrar</button></div>' +
    '<div class="ei-body"><div class="ei-wrap">' +
      '<div class="ei-per">' +
        '<label>Mes<input id="eiMes" type="month" value="' + _eiIso(ini).slice(0, 7) + '" onchange="eiMes()"></label>' +
        '<label>Desde<input id="eiDesde" type="date" value="' + _eiIso(ini) + '"></label>' +
        '<label>Hasta<input id="eiHasta" type="date" value="' + _eiIso(fin) + '"></label>' +
        '<button type="button" class="ei-todas" onclick="eiBajarTodas()">⬇ Bajar las 4</button>' +
      '</div>' +
      '<table class="ei-t" id="eiT"></table>' +
      '<div class="ei-nota">Los archivos salen <b>ya configurados</b> como piden los manuales: ventas sin las columnas F, D y C ni el «Total General» (se pega A2:D en Costos); pedidos sin I, J y K, hoja «LK Mes-Año», código como número. ' +
        '<b>Ventas</b> sale de las facturas y notas de crédito de ISIS ya leídas por Gestión (sept/26 verificado artículo por artículo). ' +
        '<b>Pedidos</b> son los pedidos web de la página, por fecha del pedido. ' +
        '<b>En rojo y negrita</b> va el artículo con un pedido que se aparta más del 50 % del promedio de los pedidos de ese cliente de los 12 meses anteriores (o una incorporación), con el detalle en la columna I; mientras la página no tenga 12 meses, el promedio usa también las facturas de ISIS. ' +
        'Si un reporte vuelve vacío no se baja nada.</div>' +
    '</div></div>';
  _ei.res = {};
  eiPintar();
}
function eiClose() { var ov = document.getElementById("eiOv"); if (ov) ov.style.display = "none"; }
function eiMes() {
  var m = (document.getElementById("eiMes") || {}).value || "";
  var p = m.split("-");
  if (p.length !== 2) return;
  var a = Number(p[0]), mm = Number(p[1]);
  document.getElementById("eiDesde").value = _eiIso(new Date(a, mm - 1, 1));
  document.getElementById("eiHasta").value = _eiIso(new Date(a, mm, 0));
}
function eiPintar() {
  var t = document.getElementById("eiT");
  if (!t) return;
  var h = '<tr><th>Reporte</th><th>Artículos</th><th>Cantidad<br><small>cajas / unid.</small></th><th>Total<br>$</th><th>En rojo<br><small>disruptivos</small></th><th></th></tr>';
  _EI_REP.forEach(function (r) {
    var x = _ei.res[r.k] || {};
    var cant = x.cajas != null ? (_eiFmt(x.cajas, 0) + ' cj · ' + _eiFmt(x.cant, 0) + ' u') : (x.cant != null ? _eiFmt(x.cant, 0) + ' u' : '—');
    h += '<tr><td class="r">' + _eiEsc(r.t) + '<small>' + _eiEsc(r.man) + '</small></td>' +
      (x.err ? '<td colspan="4"><span class="err">' + _eiEsc(x.err) + '</span></td>'
             : '<td>' + (x.n != null ? _eiFmt(x.n, 0) : '—') + '</td><td>' + cant + '</td><td>' + (x.tot != null ? _eiFmt(x.tot, 2) : '—') + '</td>' +
               '<td>' + (x.disArt != null ? _eiFmt(x.disArt, 0) + ' art.<small>' + _eiFmt(x.disPed, 0) + ' pedidos</small>' : '—') + '</td>') +
      '<td><button type="button" id="eiB_' + r.k + '"' + (x.busy ? ' disabled' : '') + ' onclick="eiBajar(\'' + r.k + '\')">' + (x.busy ? 'Armando…' : '⬇ .xls') + '</button></td></tr>';
  });
  t.innerHTML = h;
}
async function eiBajar(k) {
  var r = _EI_REP.find(function (z) { return z.k === k; });
  if (!r) return false;
  var desde = (document.getElementById("eiDesde") || {}).value, hasta = (document.getElementById("eiHasta") || {}).value;
  if (!desde || !hasta || desde > hasta) { _ei.res[k] = { err: "Elegí un período válido" }; eiPintar(); return false; }
  _ei.res[k] = { busy: true }; eiPintar();
  var X;
  try { X = await _eiXlsx(); } catch (e) { _ei.res[k] = { err: "No pude cargar el generador de Excel: " + (e && e.message || e) }; eiPintar(); return false; }
  var args = { p_empresa: r.emp, p_desde: desde, p_hasta: hasta };
  /* pedidos: también los disruptivos (manual 31, IMPORTANTE), en paralelo */
  var res = await Promise.all([_eiRpc(r.rpc, args), r.tipo === "pedidos" ? _eiRpc(_EI_RPC_DISRUP, args) : Promise.resolve(null)]);
  var q = res[0], qd = res[1];
  if (q.error) { _ei.res[k] = { err: "No pude leer: " + (q.error.message || q.error) + ". No se bajó nada." }; eiPintar(); return false; }
  var rows = Array.isArray(q.data) ? q.data : [];
  if (!rows.length) { _ei.res[k] = { err: "Volvió vacío (sin datos en el período o sin sesión de supervisor). No se bajó nada." }; eiPintar(); return false; }
  /* sin los disruptivos el archivo saldría sin marcar y nadie sabría que faltan: no se baja */
  if (qd && qd.error) { _ei.res[k] = { err: "No pude leer los pedidos disruptivos: " + (qd.error.message || qd.error) + ". No se bajó nada." }; eiPintar(); return false; }
  var dis = qd && Array.isArray(qd.data) ? qd.data : [];
  var mapa = eiDisrupMapa(dis);
  var o = { emp: r.emp, disrup: mapa };
  var ws = r.tipo === "ventas" ? eiHojaVentas(rows, o) : eiHojaPedidos(rows, o);
  _eiBajar(eiXlsBytes(X, ws, eiNombreHoja(r.emp, desde, hasta)), eiNombre(r.tipo, r.emp, desde, hasta));
  var s = { n: rows.length, cant: 0, tot: 0 };
  if (r.tipo === "pedidos") {
    s.disArt = rows.filter(function (x) { return mapa[_eiCodKey(x.cod)]; }).length;
    s.disPed = dis.length;
  }
  rows.forEach(function (x) {
    if (r.tipo === "ventas") { s.cant += _eiNum(x.cantidad); s.tot += _eiNum(x.total); }
    else { s.cajas = (s.cajas || 0) + _eiNum(x.cajas); s.cant += _eiNum(x.unidades); s.tot += _eiNum(x.importe); }
  });
  _ei.res[k] = s; eiPintar();
  return true;
}
async function eiBajarTodas() {
  for (var i = 0; i < _EI_REP.length; i++) {
    await eiBajar(_EI_REP[i].k);
    await new Promise(function (res) { setTimeout(res, 700); });   /* el navegador frena descargas pegadas */
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { eiHojaVentas: eiHojaVentas, eiHojaPedidos: eiHojaPedidos, eiXlsBytes: eiXlsBytes, eiNombre: eiNombre,
                     eiNombreHoja: eiNombreHoja, eiCodVal: eiCodVal, eiDisrupMapa: eiDisrupMapa, eiDisrupTexto: eiDisrupTexto };
}
