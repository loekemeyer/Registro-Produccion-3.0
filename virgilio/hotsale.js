/* ============================================================================
   HOT SALE — rentabilidad ponderada (v25.91 · v25.93 · v25.98, pedido de Thomas 01/10/2026)
   ----------------------------------------------------------------------------
   Los súper piden un APORTE de hot sale (un % sobre el precio) dos o tres veces
   al año. Thomas quiere saber qué rentabilidad le queda en el período completo
   (la oferta más las semanas normales que la rodean), contando que en hot sale
   se vende más. Es su planilla (Semana · Vta · Recibo · Costo · Markup, con
   recibo $ y costo $ sumados y (recibo − costo) ÷ costo), hecha pantalla.

   DOS MODOS (v25.93):
     · PROMEDIO GENERAL: él carga Rent Pta Pta (importados, sin hot sale) y Rent
       c/AP (nacionales) — los tiene él: "en función de mi markup sé cuál es mi
       costo: 100 % punta a punta = recibo 1.000, me cuesta 500".
     · POR SÚPER, ÍTEM POR ÍTEM: elige el súper (GV_Supers, por super_key: un
       súper con código en LK y en Chef es UNO), la pantalla trae lo que ese súper
       compró en 12 meses (facturas de ISIS, gv_hotsale_items_super) ordenado por
       ÚLTIMA COMPRA (dd/mm/yy), él escribe la rent. de cada ítem, y sale el
       promedio por FAMILIA (importados / nacionales, por public."Importados") y
       por RUBRO (GV_Producto_Tipo.familia), cada uno con su rent. en hot sale y
       la ponderada del período. El promedio va PONDERADO por cajas vendidas en
       esos 12 meses (si ningún ítem cargado tiene cajas, promedio simple). Las
       rent. tipeadas quedan en localStorage por súper (gv_hotsale_rent::<key>).

   LO IMPORTADO POR TIERRA NATIVA O CHEF NO PUEDE QUEDAR A PÉRDIDA EN LK (v25.98):
     Thomas: "los artículos que importan Tierra Nativa o Chef, es importante que no
     queden a pérdida en LK… registrá a cuánto lo venden en dólares TN o Chef a LK,
     para definir cuál es la rentabilidad de LK y cuál le queda post hot sale
     inclusive, y en las semanas del hot sale también". Se carga UNA vez el u$s por
     unidad que el importador le cobra a LK (GV_Importado_Precio_LK, por código
     base, lo guarda gv_hotsale_precio_lk_guardar) y el dólar (GV_HotSale_Param,
     clave 'dolar', gv_hotsale_param_guardar). La pantalla saca por ítem:
       rent. LK hoy = (lo que LK le factura al súper, $/u de la última factura de
                       ISIS) ÷ (u$s × dólar) − 1
     y con eso la rent. LK en las semanas de hot sale y la ponderada, con ⚠ en lo
     que queda a pérdida, más el promedio por importador (ponderado por cajas) y
     cuántos ítems quedan a pérdida hoy / en HS / ponderado. Para lo que importa
     CHEF hay referencia: la última factura Chef → LK (isis_ch, cliente 1434) viene
     como ref_chef_usd y un botón «usar» la carga; para TIERRA NATIVA no hay
     fuente parseada, se tipea. Sin dólar cargado las columnas dicen «—».
     El u$s y el dólar viven en la BASE (son de todos, no de este navegador).

   Los dos % de rentabilidad del modo promedio NO se calculan acá.
   Los datos de hot sale son los de arriba de su planilla: HotSale % · Semanas
   HotSale · Semanas a Ponderar · cuánto más se vende en hot sale (× lo normal).

   CÓMO SE CALCULA (markup sobre costo; el costo unitario se cancela, por eso no se pide)
     rent. en hot sale = (1 + rent) × (1 − aporte) − 1
     ponderada        = (N × rent + H × k × rentHS) ÷ (N + H × k)
                        N = semanas normales, H = de hot sale, k = cuánto más se vende
   Verificado contra su planilla: 100 % / 20 % / 4 sem / 2 HS / ×2 → 73,33 % (se
   muestra 73 %: los porcentajes van SIN decimales, Thomas 01/10); su ítem real
   (recibo 922, costo 986 → −6,49 %) / 20 % / 12 sem / 2 HS / ×2 → −11,83 % (−12 %).
   La rentabilidad puede ser NEGATIVA: se admite.

   ⚠ Si la lista de súpers vuelve VACÍA no es "no hay súpers": las RPC son
   SECURITY DEFINER con guard de supervisor y devuelven 0 filas sin sesión. Se
   dice "no pude leer", nunca se dibuja una lista vacía como dato (regla "una
   lectura ROTA no es un CERO").

   ⚠ POR QUÉ VIVE EN SU PROPIO ARCHIVO: regla v23.98 (cobranzas.js). Se carga con
   ?v= atado a APP_VERSION — está en SIGUEN_APP_VERSION de scripts/bump-version.cjs
   y tests/version-tokens.cjs. Usa window.sb (el mismo cliente del index) sólo para
   las RPC de lectura y las dos de escritura de arriba (u$s por ítem y dólar).
   Candado: tests/hotsale-rent.cjs. SQL: sql/gv_hotsale_super_items_v2593.sql,
   sql/gv_hotsale_precio_lk_v2598.sql.
   ============================================================================ */

var _HS_KEY = "gv_hotsale_params_v2";
var _HS_IDS = ["MI", "MN", "A", "H", "P", "K"];
/* los valores de la planilla de Thomas del 01/10 */
var _HS_DEF = { MI: 75, MN: 10, A: 20, H: 2, P: 12, K: 2 };
var _HS_ROT = {
  MI: "Rent Pta Pta (importados)", MN: "Rent c/AP (nacionales)", A: "HotSale %",
  H: "Semanas HotSale", P: "Semanas a Ponderar", K: "cuánto más vendo en hot sale"
};
var _HS_MESES = 12;
var _hs = { modo: "prom", supers: null, supersErr: "", superKey: "", items: null, itemsErr: "", cargando: false, params: null, paramsErr: "" };

/* m: rentabilidad base (tanto por uno) · a: aporte hot sale (tanto por uno) ·
   P: semanas a ponderar · H: semanas de hot sale · k: cuánto más se vende (× lo normal) */
function hsCalc(m, a, P, H, k) {
  var mHS = (1 + m) * (1 - a) - 1;
  var N = P - H;
  var peso = N + H * k;                      /* unidades relativas: cada semana normal = 1 */
  var pond = peso > 0 ? (N * m + H * k * mHS) / peso : NaN;
  return { mHS: mHS, pond: pond, N: N };
}

/* promedio de rentabilidades PONDERADO por cajas (si ninguna caja, simple). items: [{rent, cajas}] */
function hsPromedio(items) {
  var conRent = items.filter(function (i) { return isFinite(i.rent); });
  if (!conRent.length) return NaN;
  var wSum = 0, acc = 0;
  conRent.forEach(function (i) { var w = Math.max(Number(i.cajas) || 0, 0); wSum += w; acc += w * i.rent; });
  if (wSum > 0) return acc / wSum;
  return conRent.reduce(function (s, i) { return s + i.rent; }, 0) / conRent.length;
}

/* rentabilidad de LK sobre un importado por TN / Chef: lo que LK le factura al súper ($/u)
   contra lo que le paga al importador (u$s por unidad × dólar). Sin alguno de los tres, NaN. */
function hsRentLK(ventaUnit, usd, dolar) {
  var v = Number(ventaUnit), u = Number(usd), d = Number(dolar);
  if (!(v > 0) || !(u > 0) || !(d > 0)) return NaN;
  return v / (u * d) - 1;
}
function _hsDolar() { var p = _hs.params && _hs.params.dolar; var n = p ? Number(p.valor) : NaN; return n > 0 ? n : NaN; }
function _hsUsd(it) { var n = Number(it && it.precio_usd_lk); return n > 0 ? n : NaN; }
/* o = los datos de hot sale validados (o null): devuelve {rent, mHS, pond} de LK para el ítem */
function _hsLK(it, o) {
  var rent = hsRentLK(it.venta_unit, _hsUsd(it), _hsDolar());
  if (!isFinite(rent) || !o) return { rent: rent, mHS: NaN, pond: NaN };
  var c = hsCalc(rent, o.A / 100, o.P, o.H, o.K);
  return { rent: rent, mHS: c.mHS, pond: c.pond };
}
function _hsHoyIso() { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }

function _hsNum(v, dec) {
  var n = Number(v);
  if (!isFinite(n)) return "—";
  return n.toLocaleString("es-AR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
/* porcentajes SIN decimales (Thomas, 01/10) */
function _hsPct(x) { return isFinite(x) ? _hsNum(x * 100, 0) + " %" : "—"; }
function _hsS(v) { var n = Number(v); return isFinite(n) ? n.toLocaleString("es-AR", { maximumFractionDigits: 2 }) : "—"; }
function _hsEsc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
function _hsFecha(d) { if (!d) return "—"; var s = String(d).slice(0, 10).split("-"); return s.length === 3 ? s[2] + "/" + s[1] + "/" + s[0].slice(2) : String(d); }
function _hsAbrev(s, n) { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; }

function _hsRpc(name, args) {
  var sb = window.sb;
  if (!sb || typeof sb.rpc !== "function") return Promise.resolve({ data: null, error: { message: "sin sesión" } });
  try { return Promise.resolve(sb.rpc(name, args || {})).catch(function (e) { return { data: null, error: e }; }); }
  catch (e) { return Promise.resolve({ data: null, error: e }); }
}

function _hsCss() {
  if (document.getElementById("hsCss")) return;
  var st = document.createElement("style");
  st.id = "hsCss";
  st.textContent = [
    "#hsOv{position:fixed;inset:0;z-index:9600;background:#f1f5f9;display:none;flex-direction:column;font-family:system-ui,Segoe UI,Arial,sans-serif;color:#0f172a;}",
    "#hsOv *{box-sizing:border-box;}",
    "#hsOv [hidden]{display:none!important;}",
    /* el index tiene un button{width:100%;padding:16px;font-size:22px;margin-top:14px} global:
       se neutraliza por contenedor (mismo pozo que cobranzas.js e Importados v23.93) */
    "#hsOv button{width:auto;margin-top:0;padding:6px 13px;font-size:13px;line-height:1.25;}",
    "#hsOv input,#hsOv select{width:auto;margin-top:0;font:inherit;font-size:15px;font-weight:700;text-align:center;padding:5px 6px;border:1px solid #cbd5e1;border-radius:7px;background:#fff;color:#0f172a;}",
    "#hsOv input:focus,#hsOv select:focus{outline:none;border-color:#b91c1c;box-shadow:0 0 0 3px rgba(185,28,28,.14);}",
    ".hs-top{display:flex;align-items:center;gap:14px;padding:10px 16px;background:linear-gradient(90deg,#b91c1c,#7f1d1d);color:#fff;flex:0 0 auto;flex-wrap:wrap;}",
    ".hs-top b{font-size:17px;letter-spacing:.2px;}",
    ".hs-top span{font-size:12.5px;opacity:.9;flex:1 1 320px;min-width:0;}",
    ".hs-x{order:2;margin-left:auto;background:#fff;color:#7f1d1d;border:none;border-radius:8px;padding:7px 16px;font-weight:800;cursor:pointer;}",
    ".hs-body{flex:1;min-height:0;overflow:auto;padding:14px 16px;}",
    ".hs-wrap{max-width:1120px;margin:0 auto;display:grid;grid-template-columns:minmax(0,100%);gap:12px;justify-items:center;}",
    ".hs-wrap>*{max-width:100%;min-width:0;}",
    ".hs-modo{display:flex;gap:6px;flex-wrap:wrap;justify-content:center;}",
    ".hs-modo button{border:1px solid #cbd5e1;border-radius:999px;background:#fff;color:#334155;font-weight:700;cursor:pointer;padding:6px 14px;}",
    ".hs-modo button.on{background:#b91c1c;border-color:#b91c1c;color:#fff;}",
    /* los datos: ancho según el dato, nada de 100 % (Thomas: «está muy ancho lo de arriba») */
    ".hs-form{display:flex;flex-wrap:wrap;gap:8px 12px;justify-content:center;align-items:end;width:fit-content;max-width:min(100%,470px);background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:10px 14px;box-shadow:0 1px 2px rgba(15,23,42,.06);}",
    ".hs-form label{display:grid;gap:3px;font-size:11.5px;color:#475569;line-height:1.2;font-weight:600;text-align:center;width:max-content;}",
    ".hs-form label.rent{color:#7f1d1d;}",
    ".hs-form label.rent input{border-color:#b91c1c;}",
    "#hsOv .hs-form input{width:84px;}",
    ".hs-form label[hidden]{display:none;}",
    ".hs-bar{display:flex;gap:10px;align-items:center;justify-content:center;flex-wrap:wrap;font-size:12.5px;color:#64748b;min-height:1.2em;}",
    ".hs-bar .err{color:#b91c1c;font-weight:700;}",
    ".hs-bar button{background:#fff;border:1px solid #cbd5e1;border-radius:8px;color:#0f172a;font-weight:700;cursor:pointer;}",
    ".hs-sel{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:center;font-size:13px;font-weight:700;color:#334155;}",
    ".hs-sel select{font-size:14px;max-width:100%;}",
    ".hs-wrapt{overflow-x:auto;max-width:100%;}",
    ".hs-t{border-collapse:collapse;margin:0 auto;font-variant-numeric:tabular-nums;background:#fff;border:1px solid #e2e8f0;border-radius:12px;}",
    ".hs-t th,.hs-t td{padding:6px 12px;text-align:center;border-bottom:1px solid #e2e8f0;white-space:nowrap;}",
    ".hs-t th{font-size:13.5px;font-weight:800;line-height:1.2;}",
    ".hs-t th small{display:block;font-weight:600;color:#64748b;font-size:11px;}",
    ".hs-t td.c{white-space:normal;max-width:26ch;font-size:13px;font-weight:600;color:#334155;}",
    ".hs-t td.c small{display:block;color:#64748b;font-size:11px;font-weight:500;}",
    ".hs-t td.v{font-size:15px;font-weight:700;}",
    ".hs-t tr.hs td{background:#fef2f2;}",
    ".hs-t tr.key td{border-bottom:none;}",
    ".hs-t tr.key td.v{font-size:24px;font-weight:900;color:#b91c1c;}",
    ".hs-t tr.fam td.v.pond{font-size:20px;font-weight:900;color:#b91c1c;}",
    ".hs-t td.v.neg{color:#7f1d1d;}",
    ".hs-t tr.grp td{padding:9px 12px 3px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#64748b;border-bottom:none;font-weight:700;}",
    ".hs-t tr.rub td{font-size:13px;}",
    ".hs-t tr.rub td.v{font-size:13.5px;font-weight:700;}",
    "@media(max-width:560px){.hs-t th,.hs-t td{padding:6px 7px;}.hs-t td.c{max-width:17ch;font-size:12.5px;}.hs-t td.v{font-size:14px;}.hs-t tr.key td.v{font-size:21px;}.hs-t th{font-size:13px;}}",
    /* ítems del súper */
    ".hs-it{border-collapse:collapse;margin:0 auto;font-variant-numeric:tabular-nums;background:#fff;border:1px solid #e2e8f0;}",
    ".hs-it th,.hs-it td{padding:3px 8px;text-align:center;border-bottom:1px solid #eef2f7;white-space:nowrap;font-size:12.5px;}",
    ".hs-it th{font-size:11.5px;font-weight:800;color:#475569;background:#f8fafc;line-height:1.2;}",
    ".hs-it td.d{text-align:center;max-width:30ch;overflow:hidden;text-overflow:ellipsis;}",
    ".hs-it td.imp{color:#1d4ed8;font-weight:700;}",
    ".hs-it td.nac{color:#166534;font-weight:700;}",
    "#hsOv .hs-it input{width:62px;padding:3px 4px;font-size:13px;}",
    ".hs-it tr.falta input{border-color:#f59e0b;background:#fffbeb;}",
    /* rent. de LK en lo importado por TN / Chef (v25.98) */
    ".hs-it th.lkh{background:#eff6ff;color:#1e3a8a;}",
    ".hs-it td.na{color:#cbd5e1;}",
    ".hs-it td small{display:block;color:#64748b;font-size:10.5px;font-weight:500;}",
    "#hsOv .hs-it input.usd{width:66px;}",
    "#hsOv .hs-it input.usd.err{border-color:#b91c1c;background:#fef2f2;}",
    "#hsOv .hs-it button.ref{padding:1px 6px;font-size:11px;border-radius:6px;border:1px solid #cbd5e1;background:#f8fafc;color:#1e3a8a;cursor:pointer;margin-left:3px;}",
    ".hs-it td.lk{font-weight:700;}",
    ".hs-it td.lk.neg{color:#b91c1c;background:#fef2f2;}",
    ".hs-dol{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;}",
    "#hsOv .hs-dol input{width:80px;}",
    ".hs-dol small{font-weight:500;color:#64748b;font-size:11.5px;}",
    ".hs-t tr.lk td.c small{color:#b91c1c;}",
    ".hs-det{font-size:13px;color:#475569;max-width:70ch;}",
    ".hs-det summary{cursor:pointer;color:#0f172a;font-weight:700;}",
    ".hs-det p{margin:6px 0;}",
    "#hsSemDet{max-width:none;}",
    ".hs-sem{display:grid;grid-template-columns:repeat(auto-fit,max-content);gap:14px;justify-content:center;margin-top:8px;}",
    ".hs-sem table{border-collapse:collapse;font-variant-numeric:tabular-nums;background:#fff;}",
    ".hs-sem caption{font-weight:800;padding:0 0 4px;}",
    ".hs-sem th,.hs-sem td{padding:3px 10px;text-align:center;border-bottom:1px solid #e2e8f0;white-space:nowrap;font-size:12.5px;}",
    ".hs-sem tr.hs td{background:#fef2f2;}",
    ".hs-sem tr.tot td{font-weight:800;border-top:2px solid #cbd5e1;border-bottom:none;}"
  ].join("\n");
  document.head.appendChild(st);
}

function openHotSale() {
  try { if (typeof requireSupervisor === "function" && !requireSupervisor()) return; } catch (_e) {}
  _hsCss();
  var ov = document.getElementById("hsOv");
  if (!ov) { ov = document.createElement("div"); ov.id = "hsOv"; document.body.appendChild(ov); }
  ov.style.display = "flex";
  ov.innerHTML =
    '<div class="hs-top">' +
      '<b>🏷️ Hot Sale — rentabilidad ponderada</b>' +
      '<span>El % que queda en el período con el aporte que pide el súper: con la rent. promedio de importados y nacionales, o ítem por ítem de un súper.</span>' +
      '<button class="hs-x" onclick="hsClose()">Cerrar</button>' +
    '</div>' +
    '<div class="hs-body"><div class="hs-wrap">' +
      '<div class="hs-modo" id="hsModo">' +
        '<button type="button" data-modo="prom" onclick="hsModo(\'prom\')">Rent. promedio imp. / nac.</button>' +
        '<button type="button" data-modo="super" onclick="hsModo(\'super\')">Por súper, ítem por ítem</button>' +
      '</div>' +
      '<form class="hs-form" id="hsForm" autocomplete="off" onsubmit="return false">' +
        '<label class="rent" id="hsLblMI">Rent Pta Pta<br>imp. sin HS (%)<input id="hsMI" type="number" step="1"></label>' +
        '<label class="rent" id="hsLblMN">Rent c/AP<br>nac. (%)<input id="hsMN" type="number" step="1"></label>' +
        '<label>HotSale %<br>(s/ precio)<input id="hsA" type="number" min="0" max="100" step="0.5"></label>' +
        '<label>Semanas<br>HotSale<input id="hsH" type="number" min="0" step="1"></label>' +
        '<label>Semanas<br>a Ponderar<input id="hsP" type="number" min="1" max="104" step="1"></label>' +
        '<label>Vende × en HS<br>(vs. normal)<input id="hsK" type="number" min="0" step="0.1"></label>' +
      '</form>' +
      '<div class="hs-bar"><span id="hsMsg"></span><button type="button" onclick="hsReset()">Ejemplo</button></div>' +
      '<div class="hs-sel" id="hsSel" hidden></div>' +
      '<div class="hs-wrapt"><table class="hs-t" id="hsT"></table></div>' +
      '<div class="hs-wrapt" id="hsItemsWrap" hidden><table class="hs-it" id="hsItems"></table></div>' +
      '<details class="hs-det" id="hsSemDet"><summary>Semana por semana (como la planilla)</summary><div class="hs-sem" id="hsSem"></div></details>' +
      '<details class="hs-det"><summary>Cómo se calcula</summary>' +
        '<p><b>Rentabilidad en hot sale</b> = (1 + rent.) × (1 − HotSale %) − 1. Con 100 % y 20 %: 2 × 0,8 − 1 = 60 %. Vale también en negativo: recibo 922 con costo 986 (−6 %) queda en −25 %.</p>' +
        '<p><b>Ponderada</b> = promedio de las rentabilidades pesado por lo que se vende cada semana: una semana normal pesa 1 y una de hot sale pesa lo que se vende de más (× 2 = pesa doble). Con 4 semanas, 2 de hot sale y venta doble: (2 × 100 % + 4 × 60 %) ÷ 6 = 73 %. Es la misma cuenta que la planilla, (recibo − costo) ÷ costo: el costo unitario se cancela y por eso no se pide.</p>' +
        '<p><b>Por súper</b>: los ítems son lo que ese súper compró en los últimos ' + _HS_MESES + ' meses (facturas de ISIS, LK y Chef juntos), ordenados por última compra. El promedio por familia y por rubro va ponderado por cajas vendidas en ese período; los ítems sin rent. cargada no entran. Las rent. que escribís quedan guardadas en este navegador, por súper.</p>' +
        '<p><b>Rent. de LK en lo importado por Tierra Nativa o Chef</b> = (lo que LK le factura al súper, $ por unidad de la última factura de ISIS) ÷ (u$s por unidad que le cobra el importador × dólar) − 1. El u$s se carga una vez por código y queda en la base (para lo de Chef hay referencia: la última factura Chef → LK); el dólar también. Con eso salen la rent. de LK hoy, en las semanas de hot sale y la ponderada: ⚠ es lo que queda a pérdida.</p>' +
      '</details>' +
    '</div></div>';
  _hsLoad();
  ov.querySelector("#hsForm").addEventListener("input", hsRender);
  _hsModoPintar();
  hsRender();
  if (_hs.modo === "super") _hsSuperInit();
}
function hsClose() { var ov = document.getElementById("hsOv"); if (ov) ov.style.display = "none"; }
function hsReset() { _HS_IDS.forEach(function (id) { document.getElementById("hs" + id).value = _HS_DEF[id]; }); hsRender(); }

function _hsLoad() {
  var o = null;
  try { o = JSON.parse(localStorage.getItem(_HS_KEY) || "null"); } catch (_e) { o = null; }
  _HS_IDS.forEach(function (id) { document.getElementById("hs" + id).value = (o && isFinite(o[id])) ? o[id] : _HS_DEF[id]; });
  _hs.modo = (o && o.modo === "super") ? "super" : "prom";
  _hs.superKey = (o && typeof o.superKey === "string") ? o.superKey : "";
}
function _hsRead() { var o = {}; _HS_IDS.forEach(function (id) { o[id] = parseFloat(document.getElementById("hs" + id).value); }); return o; }
function _hsSave(o) { try { localStorage.setItem(_HS_KEY, JSON.stringify(Object.assign({}, o, { modo: _hs.modo, superKey: _hs.superKey }))); } catch (_e) {} }

function hsModo(m) {
  _hs.modo = m === "super" ? "super" : "prom";
  _hsModoPintar();
  hsRender();
  if (_hs.modo === "super") _hsSuperInit();
}
function _hsModoPintar() {
  var sup = _hs.modo === "super";
  document.querySelectorAll("#hsModo button").forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-modo") === _hs.modo); });
  document.getElementById("hsLblMI").hidden = sup;
  document.getElementById("hsLblMN").hidden = sup;
  document.getElementById("hsSel").hidden = !sup;
  document.getElementById("hsItemsWrap").hidden = !sup;
  document.getElementById("hsSemDet").hidden = sup;
}

/* ----------------------------- modo por súper ----------------------------- */
function _hsParamsCargar(cb) {
  _hsRpc("gv_hotsale_params").then(function (r) {
    if (!r || r.error || r.data === null || typeof r.data !== "object") { _hs.paramsErr = "No pude leer el dólar" + (r && r.error && r.error.message ? " (" + r.error.message + ")" : " (falta la sesión de supervisor)") + "."; _hs.params = null; }
    else { _hs.params = r.data; _hs.paramsErr = ""; }
    if (cb) cb();
  });
}
function _hsSuperInit() {
  if (!_hs.params && !_hs.paramsErr) _hsParamsCargar(function () { _hsSelPintar(); _hsSuperRender(); });
  if (_hs.supers) { _hsSelPintar(); if (_hs.superKey && !_hs.items) hsSuperElegir(_hs.superKey); else _hsSuperRender(); return; }
  _hs.cargando = true; _hs.supersErr = ""; _hsSelPintar();
  _hsRpc("gv_hotsale_supers").then(function (r) {
    _hs.cargando = false;
    if (!r || r.error || !Array.isArray(r.data)) { _hs.supersErr = "No pude leer la lista de súpers" + (r && r.error && r.error.message ? " (" + r.error.message + ")" : "") + "."; _hs.supers = null; }
    else if (!r.data.length) { _hs.supersErr = "La lista de súpers vino vacía: hace falta la sesión de supervisor (no es que no haya súpers)."; _hs.supers = null; }
    else { _hs.supers = r.data; }
    _hsSelPintar();
    if (_hs.supers && _hs.superKey && _hs.supers.some(function (s) { return s.super_key === _hs.superKey; })) hsSuperElegir(_hs.superKey);
    else { _hs.superKey = ""; _hs.items = null; _hsSuperRender(); }
  });
}
function _hsSelPintar() {
  var el = document.getElementById("hsSel"); if (!el) return;
  if (_hs.cargando && !_hs.supers) { el.innerHTML = "Leyendo los súpers…"; return; }
  if (_hs.supersErr) { el.innerHTML = '<span style="color:#b91c1c">' + _hsEsc(_hs.supersErr) + '</span> <button type="button" onclick="_hs.supers=null;_hs.supersErr=\'\';_hsSuperInit()">Reintentar</button>'; return; }
  var opts = '<option value="">— elegí el súper —</option>';
  (_hs.supers || []).forEach(function (s) {
    var cods = (s.codigos || []).map(function (c) { return (c.empresa === "chef" ? "CH " : "LK ") + c.cod; }).join(" + ");
    opts += '<option value="' + _hsEsc(s.super_key) + '"' + (s.super_key === _hs.superKey ? " selected" : "") + '>' + _hsEsc(s.nombre) + " · últ. compra " + _hsFecha(s.ultima_compra) + " · " + _hsEsc(cods) + "</option>";
  });
  var dol = _hs.params && _hs.params.dolar, info;
  if (_hs.paramsErr) info = '<span style="color:#b91c1c">' + _hsEsc(_hs.paramsErr) + '</span> <button type="button" onclick="_hs.params=null;_hs.paramsErr=\'\';_hsSuperInit()">Reintentar</button>';
  else if (dol && Number(dol.valor) > 0) info = "guardado " + _hsFecha(dol.actualizado_at);
  else info = "cargalo para ver la rent. de LK en lo importado por TN / Chef";
  el.innerHTML = '¿Qué súper? <select id="hsSuper" onchange="hsSuperElegir(this.value)">' + opts + "</select>" +
    ' <span class="hs-dol">· Dólar $ <input id="hsDolar" type="number" min="1" step="1" placeholder="$ / u$s" value="' + (dol && Number(dol.valor) > 0 ? String(Number(dol.valor)) : "") + '" onchange="hsDolarSet(this.value)" title="pesos por dólar: con esto se pasa a $ lo que el importador le cobra a LK en u$s. Queda guardado en la base."> <small id="hsDolarInfo">' + info + '</small></span>';
}
function hsDolarSet(val) {
  var n = parseFloat(val), info = document.getElementById("hsDolarInfo");
  if (!(n > 0)) { if (info) info.innerHTML = '<span style="color:#b91c1c">el dólar tiene que ser mayor a 0</span>'; return; }
  if (info) info.textContent = "guardando…";
  _hsRpc("gv_hotsale_param_guardar", { p_clave: "dolar", p_valor: n }).then(function (r) {
    if (!r || r.error) { if (info) info.innerHTML = '<span style="color:#b91c1c">No se guardó' + (r && r.error && r.error.message ? " (" + _hsEsc(r.error.message) + ")" : "") + '</span>'; return; }
    _hs.params = Object.assign({}, _hs.params || {}, { dolar: { valor: n, actualizado_at: _hsHoyIso(), por: "" } });
    if (info) info.textContent = "guardado " + _hsFecha(_hsHoyIso());
    _hsSuperRender();
  });
}
/* u$s por unidad que el importador le cobra a LK: se guarda en la base por código base (vale para todos los súpers) */
function hsUsdSet(cod, val) {
  var n = parseFloat(val), nuevo = isFinite(n) && n >= 0 ? n : null;
  var inputs = document.querySelectorAll('#hsItems input.usd[data-cod="' + String(cod).replace(/"/g, '\\"') + '"]');
  inputs.forEach(function (i) { i.classList.remove("err"); i.disabled = true; });
  _hsRpc("gv_hotsale_precio_lk_guardar", { p_cod: cod, p_precio_usd: nuevo }).then(function (r) {
    if (!r || r.error) {
      var m = "No se guardó el u$s del " + cod + (r && r.error && r.error.message ? " (" + r.error.message + ")" : "") + ".";
      inputs.forEach(function (i) { i.disabled = false; i.classList.add("err"); i.title = m; });
      var msg = document.getElementById("hsMsg"); if (msg) msg.innerHTML = '<span class="err">' + _hsEsc(m) + '</span>';
      return;
    }
    (_hs.items || []).forEach(function (it) { if (it.cod_base === cod) it.precio_usd_lk = nuevo; });
    _hsSuperRender();
  });
}
function hsUsdRef(cod, usd) { hsUsdSet(cod, usd); }
function hsSuperElegir(key) {
  _hs.superKey = key || ""; _hs.items = null; _hs.itemsErr = "";
  var sel = document.getElementById("hsSuper"); if (sel && sel.value !== _hs.superKey) sel.value = _hs.superKey;
  _hsSave(_hsRead());
  if (!_hs.superKey) { _hsSuperRender(); return; }
  _hs.cargando = true; _hsSuperRender();
  var pedido = _hs.superKey;
  _hsRpc("gv_hotsale_items_super", { p_super_key: pedido, p_meses: _HS_MESES }).then(function (r) {
    if (_hs.superKey !== pedido) return;
    _hs.cargando = false;
    if (!r || r.error || !Array.isArray(r.data)) { _hs.itemsErr = "No pude leer los ítems" + (r && r.error && r.error.message ? " (" + r.error.message + ")" : "") + "."; _hs.items = null; }
    else { _hs.items = r.data; }
    _hsSuperRender();
  });
}
function _hsRentKey() { return "gv_hotsale_rent::" + _hs.superKey; }
function _hsRentMap() { try { return JSON.parse(localStorage.getItem(_hsRentKey()) || "{}") || {}; } catch (_e) { return {}; } }
function hsRentSet(k, val) {
  var m = _hsRentMap();
  var n = parseFloat(val);
  if (isFinite(n)) m[k] = n; else delete m[k];
  try { localStorage.setItem(_hsRentKey(), JSON.stringify(m)); } catch (_e) {}
  var tr = document.querySelector('#hsItems tr[data-k="' + k.replace(/"/g, '\\"') + '"]');
  if (tr) tr.classList.toggle("falta", !isFinite(n));
  _hsResumenPintar();
}
function _hsItemsConRent() {
  var m = _hsRentMap();
  return (_hs.items || []).map(function (it) {
    var k = it.empresa + "|" + it.cod;
    var r = m[k];
    return { k: k, it: it, rent: isFinite(r) ? r / 100 : NaN, cajas: Number(it.cajas) || 0 };
  });
}
/* grupos: familia (importados / nacionales) y rubro, cada uno con su promedio ponderado por cajas */
function hsGrupos(rows) {
  function grupo(label, sel) {
    var its = rows.filter(sel);
    var carg = its.filter(function (x) { return isFinite(x.rent); });
    return { label: label, n: its.length, nCarg: carg.length,
             cajas: its.reduce(function (s, x) { return s + x.cajas; }, 0),
             rent: hsPromedio(its) };
  }
  var fam = [grupo("Importados", function (x) { return !!x.it.es_importado; }), grupo("Nacionales", function (x) { return !x.it.es_importado; })];
  var rubros = {};
  rows.forEach(function (x) { var r = x.it.rubro || "Sin rubro"; rubros[r] = true; });
  var rub = Object.keys(rubros).map(function (r) { return grupo(r, function (x) { return (x.it.rubro || "Sin rubro") === r; }); });
  rub.sort(function (a, b) { return b.cajas - a.cajas || a.label.localeCompare(b.label); });
  return { fam: fam, rub: rub };
}
function _hsSuperRender() {
  var wrap = document.getElementById("hsItemsWrap"), t = document.getElementById("hsItems"), res = document.getElementById("hsT");
  if (!wrap || !t) return;
  if (_hs.modo !== "super") return;
  if (!_hs.superKey) { t.innerHTML = ""; res.innerHTML = ""; return; }
  if (_hs.cargando && !_hs.items) { t.innerHTML = '<tbody><tr><td>Leyendo lo que compró…</td></tr></tbody>'; res.innerHTML = ""; return; }
  if (_hs.itemsErr) { t.innerHTML = '<tbody><tr><td style="color:#b91c1c">' + _hsEsc(_hs.itemsErr) + ' <button type="button" onclick="hsSuperElegir(_hs.superKey)">Reintentar</button></td></tr></tbody>'; res.innerHTML = ""; return; }
  if (!_hs.items || !_hs.items.length) { t.innerHTML = '<tbody><tr><td>Este súper no tiene facturas en los últimos ' + _HS_MESES + ' meses.</td></tr></tbody>'; res.innerHTML = ""; return; }
  var rows = _hsItemsConRent();
  var o = _hsRead(), oOk = _hsValida(o) ? o : null;
  /* las columnas de LK sólo si el súper compra algo importado por TN / Chef */
  var conLK = (_hs.items || []).some(function (it) { return it.es_importado && it.importador; });
  var h = '<thead><tr><th>Últ.<br>compra</th><th>Cód.</th><th>Descripción</th><th>Rubro</th><th>Fam.</th><th>Cajas<br>' + _HS_MESES + ' m</th><th>Rent.<br>hoy %</th>' +
          (conLK ? '<th class="lkh">u$s → LK<br>por u</th><th class="lkh">Venta LK<br>$/u</th><th class="lkh">Rent. LK<br>hoy</th><th class="lkh">Rent. LK<br>en HS</th><th class="lkh">Rent. LK<br>pond.</th>' : '') +
          '</tr></thead><tbody>';
  function lkCell(v) { return '<td class="lk' + (v < 0 ? ' neg' : '') + '">' + (isFinite(v) ? (v < 0 ? '⚠ ' : '') + _hsPct(v) : '—') + '</td>'; }
  rows.forEach(function (x) {
    var it = x.it;
    h += '<tr data-k="' + _hsEsc(x.k) + '"' + (isFinite(x.rent) ? "" : ' class="falta"') + '>' +
         '<td>' + _hsFecha(it.ultima_compra) + '</td>' +
         '<td title="' + _hsEsc(it.empresa === "chef" ? "Chef" : "LK") + '"><b>' + _hsEsc(it.cod) + '</b></td>' +
         '<td class="d" title="' + _hsEsc(it.descripcion) + '">' + _hsEsc(_hsAbrev(it.descripcion, 30)) + '</td>' +
         '<td>' + _hsEsc(it.rubro || "Sin rubro") + '</td>' +
         '<td class="' + (it.es_importado ? "imp" : "nac") + '"' + (it.es_importado && it.importador ? ' title="importado por ' + _hsEsc(it.importador) + '"' : '') + '>' + (it.es_importado ? "Imp" + (it.importador ? "·" + (it.importador === "Tierra Nativa" ? "TN" : _hsEsc(it.importador)) : "") : "Nac") + '</td>' +
         '<td>' + _hsNum(it.cajas, 0) + '</td>' +
         '<td><input type="number" step="1" value="' + (isFinite(x.rent) ? _hsS(Math.round(x.rent * 10000) / 100).replace(",", ".") : "") + '" data-k="' + _hsEsc(x.k) + '" oninput="hsRentSet(this.getAttribute(\'data-k\'),this.value)"></td>';
    if (conLK) {
      var imp = it.es_importado && it.importador ? String(it.importador) : "";
      if (imp) {
        var lk = _hsLK(it, oOk), usd = _hsUsd(it), ref = Number(it.ref_chef_usd);
        h += '<td><input class="usd" type="number" min="0" step="0.01" value="' + (isFinite(usd) ? String(usd) : "") + '" placeholder="' + (ref > 0 ? _hsS(ref) : "u$s") + '" data-cod="' + _hsEsc(it.cod_base) + '" onchange="hsUsdSet(this.getAttribute(\'data-cod\'),this.value)" title="u$s por unidad que ' + _hsEsc(imp) + ' le cobra a LK. Queda guardado en la base.' + (ref > 0 ? ' Ref.: última factura Chef → LK ' + _hsFecha(it.ref_chef_fecha) + ' a u$s ' + _hsS(ref) : '') + '">' +
             (!isFinite(usd) && ref > 0 ? '<button type="button" class="ref" data-cod="' + _hsEsc(it.cod_base) + '" data-usd="' + ref + '" onclick="hsUsdRef(this.getAttribute(\'data-cod\'),this.getAttribute(\'data-usd\'))" title="última factura Chef → LK, ' + _hsFecha(it.ref_chef_fecha) + '">usar ' + _hsS(ref) + '</button>' : '') + '</td>' +
             '<td title="última factura al súper, ' + _hsFecha(it.venta_fecha) + '">' + (Number(it.venta_unit) > 0 ? '$ ' + _hsNum(it.venta_unit, 0) + '<small>' + _hsFecha(it.venta_fecha) + '</small>' : '—') + '</td>' +
             lkCell(lk.rent) + lkCell(lk.mHS) + lkCell(lk.pond);
      } else {
        h += '<td colspan="5" class="na">—</td>';
      }
    }
    h += '</tr>';
  });
  h += '</tbody>';
  t.innerHTML = h;
  _hsResumenPintar();
}
function _hsResumenPintar() {
  var res = document.getElementById("hsT"); if (!res || _hs.modo !== "super") return;
  var o = _hsRead();
  if (!_hsValida(o)) { res.innerHTML = ""; return; }
  var rows = _hsItemsConRent();
  if (!rows.length) { res.innerHTML = ""; return; }
  var g = hsGrupos(rows), a = o.A / 100;
  var carg = rows.filter(function (x) { return isFinite(x.rent); }).length;
  var h = '<thead><tr><th></th><th>Ítems<small>cargados / total</small></th><th>Cajas<small>' + _HS_MESES + ' m</small></th><th>Rent. hoy<small>prom. pond.</small></th><th class="hs">En hot sale<small>' + _hsS(o.A) + ' % · ' + _hsS(o.H) + ' sem · ×' + _hsS(o.K) + '</small></th><th>Ponderada<small>' + _hsS(o.P) + ' semanas</small></th></tr></thead><tbody>';
  function fila(gr, cls) {
    var c = isFinite(gr.rent) ? hsCalc(gr.rent, a, o.P, o.H, o.K) : { mHS: NaN, pond: NaN };
    return '<tr class="' + cls + '"><td class="c">' + _hsEsc(gr.label) + (gr.sub || "") + '</td><td>' + gr.nCarg + ' / ' + gr.n + '</td><td>' + _hsNum(gr.cajas, 0) + '</td>' +
           '<td class="v' + (gr.rent < 0 ? " neg" : "") + '">' + _hsPct(gr.rent) + '</td><td class="v' + (c.mHS < 0 ? " neg" : "") + '" style="background:#fef2f2">' + _hsPct(c.mHS) + '</td>' +
           '<td class="v pond' + (c.pond < 0 ? " neg" : "") + '">' + _hsPct(c.pond) + '</td></tr>';
  }
  h += '<tr class="grp"><td colspan="6">Por familia · ' + carg + ' de ' + rows.length + ' ítems con rent. cargada</td></tr>';
  g.fam.forEach(function (gr) { h += fila(gr, "fam"); });
  h += '<tr class="grp"><td colspan="6">Por rubro</td></tr>';
  g.rub.forEach(function (gr) { h += fila(gr, "rub"); });
  /* la rent. de LK en lo importado por TN / Chef: lo que no puede quedar a pérdida (v25.98) */
  var conImp = rows.filter(function (x) { return x.it.es_importado && x.it.importador; });
  if (conImp.length) {
    var d = _hsDolar();
    h += '<tr class="grp"><td colspan="6">Rent. de LK en lo importado por Tierra Nativa / Chef · ítems con u$s cargado' +
         (isFinite(d) ? ' · dólar $ ' + _hsNum(d, 0) : ' · <span style="color:#b91c1c;text-transform:none">falta cargar el dólar</span>') + '</td></tr>';
    ["Tierra Nativa", "Chef"].forEach(function (imp) {
      var its = conImp.filter(function (x) { return x.it.importador === imp; });
      if (!its.length) return;
      var lks = its.map(function (x) { return { rent: _hsLK(x.it, null).rent, cajas: x.cajas }; });
      var perd = { hoy: 0, hs: 0, pond: 0 }, nC = 0;
      its.forEach(function (x) { var l = _hsLK(x.it, o); if (isFinite(l.rent)) nC++; if (l.rent < 0) perd.hoy++; if (l.mHS < 0) perd.hs++; if (l.pond < 0) perd.pond++; });
      var sub = !nC ? '' : (perd.hoy || perd.hs || perd.pond)
        ? '<small>⚠ a pérdida: ' + perd.hoy + ' hoy · ' + perd.hs + ' en HS · ' + perd.pond + ' pond.</small>'
        : '<small style="color:#166534">ninguno a pérdida</small>';
      h += fila({ label: imp, sub: sub, n: its.length, nCarg: nC, cajas: its.reduce(function (s, x) { return s + x.cajas; }, 0), rent: hsPromedio(lks) }, "fam lk");
    });
  }
  h += '</tbody>';
  res.innerHTML = h;
}

/* ----------------------------- modo promedio ------------------------------ */
function _hsValida(o) {
  var bad = [];
  _HS_IDS.forEach(function (id) {
    if (_hs.modo === "super" && (id === "MI" || id === "MN")) return;
    if (!isFinite(o[id]) || (o[id] < 0 && id !== "MI" && id !== "MN")) bad.push(_HS_ROT[id]);
  });
  if (isFinite(o.H) && isFinite(o.P) && o.H > o.P) bad.push("Semanas HotSale > Semanas a Ponderar");
  if (isFinite(o.P) && o.P < 1) bad.push("Semanas a Ponderar (mínimo 1)");
  if (isFinite(o.P) && o.P > 104) bad.push("Semanas a Ponderar (máximo 104, dos años)");
  var msg = document.getElementById("hsMsg");
  if (bad.length) { msg.innerHTML = '<span class="err">Revisá: ' + bad.join(", ") + ".</span>"; return false; }
  msg.textContent = "Los datos quedan guardados en este navegador.";
  return true;
}
function _hsSemanas(o, m, titulo) {
  var r = hsCalc(m, o.A / 100, o.P, o.H, o.K);
  var h = '<table><caption>' + titulo + '</caption><thead><tr><th>Semana</th><th>Vta (× normal)</th><th>Rent.</th></tr></thead><tbody>';
  for (var w = 1; w <= o.P; w++) {
    var hs = w > r.N;
    h += '<tr' + (hs ? ' class="hs"' : '') + '><td>' + w + (hs ? ' · hot sale' : '') + '</td><td>' + _hsS(hs ? o.K : 1) + '</td><td>' + _hsPct(hs ? r.mHS : m) + '</td></tr>';
  }
  h += '<tr class="tot"><td>Ponderada</td><td>' + _hsS(r.N + o.H * o.K) + '</td><td>' + _hsPct(r.pond) + '</td></tr></tbody></table>';
  return h;
}
function hsRender() {
  var o = _hsRead();
  var t = document.getElementById("hsT"), sem = document.getElementById("hsSem");
  if (!_hsValida(o)) { t.innerHTML = ""; sem.innerHTML = ""; return; }
  _hsSave(o);
  if (_hs.modo === "super") { sem.innerHTML = ""; _hsResumenPintar(); return; }
  var a = o.A / 100;
  var I = hsCalc(o.MI / 100, a, o.P, o.H, o.K), N = hsCalc(o.MN / 100, a, o.P, o.H, o.K);
  var h = '<thead><tr><th></th><th>Importados<small>Rent Pta Pta</small></th><th>Nacionales<small>Rent c/AP</small></th></tr></thead><tbody>';
  h += '<tr><td class="c">Rent. hoy, sin hot sale</td><td class="v">' + _hsPct(o.MI / 100) + '</td><td class="v">' + _hsPct(o.MN / 100) + '</td></tr>';
  h += '<tr class="hs"><td class="c">En hot sale, con ' + _hsS(o.A) + ' % de aporte<small>' + _hsS(o.H) + ' sem · venta × ' + _hsS(o.K) + '</small></td><td class="v">' + _hsPct(I.mHS) + '</td><td class="v">' + _hsPct(N.mHS) + '</td></tr>';
  h += '<tr class="key"><td class="c">Rent. ponderada en ' + _hsS(o.P) + ' semanas<small>' + _hsS(I.N) + ' normales + ' + _hsS(o.H) + ' de hot sale</small></td>' +
       '<td class="v' + (I.pond < 0 ? ' neg' : '') + '" id="hsPondImp">' + _hsPct(I.pond) + '</td><td class="v' + (N.pond < 0 ? ' neg' : '') + '" id="hsPondNac">' + _hsPct(N.pond) + '</td></tr>';
  h += '</tbody>';
  t.innerHTML = h;
  sem.innerHTML = _hsSemanas(o, o.MI / 100, "Importados") + _hsSemanas(o, o.MN / 100, "Nacionales");
}
