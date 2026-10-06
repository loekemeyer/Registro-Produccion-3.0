/* importacion.js — módulo de Pedidos Importación (sacado de index.html en la v24.65, sin
   cambios de comportamiento). Script clásico, NO módulo ES: todo lo de acá sigue siendo GLOBAL
   (los onclick="..." inline y los tests lo llaman por nombre) y comparte el scope léxico global con
   index.html. Se carga justo después del <script> principal: nada de acá corre al cargar salvo
   declaraciones con literales, y nada del index lo llama al cargar. */
/* v9.11/v9.12 — Módulo "Proveedor de importación": revisar/corregir el proveedor chino de cada
   artículo IMPORTADO. Lee y escribe el MAESTRO real `Importados` (vía vista_prov_importacion:
   una fila por cod_art de los activos, con su proveedor actual, ya cargado). Al tocar el
   desplegable, hace PATCH del proveedor en Importados (todas las marcas de ese código). Este
   maestro alimenta el circuito de OC de importados (v_importados_ordenes, índice = 10 meses en
   Importados_Config). García NO está: reenvasa lo de insumos, no importa. */
/* v23.89 (Luis) — FALLBACK, no la fuente: la lista viva es la tabla GV_Imp_Proveedor
   (vista gv_imp_proveedor_cfg), que hidrata _impCfgCargar(). Queda escrita para que la
   pantalla siga andando si el fetch falla. */
let _PROV_IMP_LISTA = ["Fujian", "Hugo Wong", "Becky", "Kangli", "Ownland", "Zhixin", "Frontier"];
/* v11.17 — Un solo botón "Importación" en el panel: adentro, solapas para cambiar entre
   📦 Pedidos (openPedidosImportacion) y 🏭 Proveedores (stkOpenProvImp). La llamada
   _impTabsHtml('ped') existía desde v10.42 pero la función nunca se definió (popup roto). */
function _impTabsHtml(cur) {
  // v11.70 — `width:auto;margin:0` explícitos: el `button{width:100%;padding:16px;margin-top:14px}`
  // global convertía las dos solapas en barras apiladas de ancho completo.
  // v24.57 (Thomas) — UNA fila que se desliza al costado: en el celular eran 4 filas de solapas.
  const t = function (on) { return 'width:auto;margin:0;flex:0 0 auto;padding:5px 11px;border-radius:999px;border:1px solid ' + (on ? '#1d4ed8' : '#cbd5e1') + ';background:' + (on ? '#1d4ed8' : '#fff') + ';color:' + (on ? '#fff' : '#334155') + ';font-size:12.5px;font-weight:800;cursor:pointer;white-space:nowrap'; };
  return '<div class="imp-tabs" style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;padding-bottom:2px">' +
    '<button style="' + t(cur === 'ped') + '" onclick="openPedidosImportacion()">📦 Pedidos</button>' +
    '<button style="' + t(cur === 'curso') + '" onclick="openImpEnCurso()" title="Los pedidos YA HECHOS que vienen en camino: qué día embarcan y qué día llegan. No mira lo que hay que pedir.">🚢 En curso</button>' +
    '<button style="' + t(cur === 'ntl') + '" onclick="openImpNtl()" title="La cuenta corriente de NTL, el forwarder de Hong Kong: depósitos, giros a las fábricas, recuperos y comisiones.">💱 NTL</button>' +
    '<button style="' + t(cur === 'provcc') + '" onclick="openImpProvCC()" title="Una cuenta por fábrica: cuánto le debemos por los pedidos en curso, cada giro, y la historia (hoja del Excel + extracto NTL).">📒 Cta. proveedor</button>' +
    '<button style="' + t(cur === 'hist') + '" onclick="openImpHistRecep()" title="Los pedidos hechos y las recepciones: qué se pidió, cuándo, cuánto llegó y dónde se guardó.">📜 Historial</button>' +
    '<button style="' + t(cur === 'disc') + '" onclick="openImpDisc()" title="Los importados dados de baja (Importados.activo = false): no salen en Pedidos ni en el PDF.">🚫 Discontinuos</button>' +
    '<button style="' + t(cur === 'prov') + '" onclick="stkOpenProvImp()">🏭 Proveedores</button>' +
    '<button style="' + t(false) + '" onclick="openImpoComex()" title="Verificación de documentos de importación (IMPO COMEX). Sólo supervisores.">🛃 IMPO COMEX</button></div>';
}
/* v23.19 (Elías, 28/09) — IMPO COMEX dentro de Gestión: la versión web vive en impo-comex/ (copia
   armada; el fuente está en el repo privado loekemeyer/Impo-Comex). Página completa, mismo origin:
   usa la misma sesión de Google. El control de supervisor lo hace el servidor (Impo_Comex_web). */
function openImpoComex() { location.href = "impo-comex/"; }
async function stkOpenProvImp() {
  _stkPopShell("🏭 Proveedor de importación", "stkPopBody", true);
  const body = document.getElementById("stkPopBody"); if (!body) return;
  body.innerHTML = '<div class="stkpop-empty">Cargando…</div>';
  const H = { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY };
  let rows = [];
  try { rows = await fetch(SUPABASE_URL + "/rest/v1/vista_prov_importacion?select=cod,descripcion,marca,proveedor,n_prov,es_e&order=cod&limit=5000", { headers: H, cache: "no-store" }).then(function (r) { return r.ok ? r.json() : []; }); } catch (_e) {}
  // lista de proveedores = base conocida ∪ los que ya aparecen en el maestro (para no perder ninguno)
  const provs = _PROV_IMP_LISTA.slice();
  rows.forEach(function (r) { if (r.proveedor && provs.indexOf(r.proveedor) < 0) provs.push(r.proveedor); });
  _stkPop = { kind: "provImp", rows: rows, provs: provs, q: "", soloSin: false, _focusQ: false };
  _provImpRender();
}
function _provImpRender() {
  const body = document.getElementById("stkPopBody"); if (!body || !_stkPop || _stkPop.kind !== "provImp") return;
  const all = _stkPop.rows || [];
  const provs = _stkPop.provs || _PROV_IMP_LISTA;
  const q = String(_stkPop.q || "").trim().toUpperCase();
  const conProv = all.filter(function (r) { return r.proveedor; }).length;
  let rows = all;
  if (_stkPop.soloSin) rows = rows.filter(function (r) { return !r.proveedor; });
  if (q) rows = rows.filter(function (r) { return stkMatchBusq(q, r.cod, r.descripcion, false); });   // v21.43
  let h = _impTabsHtml('prov');
  h += '<div class="stkpop-hint"><b>' + all.length + '</b> artículos importados (' + conProv + ' con proveedor). Tocá el desplegable para <b>corregir el proveedor chino</b> de cada uno (se guarda al instante en el maestro <code>Importados</code>, que alimenta la OC de importados). <small style="color:#94a3b8">García no está: reenvasa lo de insumos, no importa.</small></div>';
  h += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;align-items:center">';
  h += '<input id="provImpQ" placeholder="Buscar código o descripción…" value="' + escapeHtml(_stkPop.q || "") + '" oninput="provImpSearch(this.value)" style="flex:1;min-width:150px;padding:6px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px">';
  h += '<button class="mva-clear" style="' + (_stkPop.soloSin ? 'background:#b45309;color:#fff;border-color:#b45309' : '') + '" onclick="provImpToggleSin()">' + (_stkPop.soloSin ? '✓ ' : '') + 'Solo sin proveedor</button>';
  h += '</div>';
  if (!rows.length) { body.innerHTML = h + '<div class="stkpop-empty">Sin resultados.</div>'; return; }
  // v11.70 — la tarjeta ahora es ancha (compartida con Pedidos): esta tabla es de 3 columnas,
  // se le pone tope para que no quede estirada y anchos fijos para Código y Proveedor.
  h += '<div class="mva-tblwrap" style="max-width:900px"><table class="mva-tbl">' +
    '<colgroup><col style="width:190px"><col><col style="width:200px"></colgroup>' +
    '<thead><tr><th>Código</th><th>Descripción</th><th>Proveedor</th></tr></thead><tbody>';
  h += rows.map(function (r) {
    const cod = String(r.cod);
    const cur = r.proveedor || "";
    let opts = '<option value="">— sin proveedor —</option>' + provs.map(function (p) { return '<option value="' + escapeHtml(p) + '"' + (p === cur ? ' selected' : '') + '>' + escapeHtml(p) + '</option>'; }).join("");
    if (cur && provs.indexOf(cur) < 0) opts += '<option value="' + escapeHtml(cur) + '" selected>' + escapeHtml(cur) + '</option>';
    const sel = '<select onchange="provImpSet(\'' + encodeURIComponent(cod) + '\',this.value)" style="padding:5px 8px;border:1px solid ' + (cur ? '#16a34a' : '#f59e0b') + ';border-radius:8px;font-size:12.5px;background:' + (cur ? '#f0fdf4' : '#fffbeb') + ';font-weight:700;color:#0f172a;max-width:160px">' + opts + '</select>';
    const mk = r.marca ? ' <span style="color:#94a3b8;font-size:10.5px;font-weight:700">' + escapeHtml(String(r.marca)) + '</span>' : '';
    return '<tr' + (cur ? '' : ' style="background:#fffbeb"') + '><td><b>' + escapeHtml(cod) + '</b>' + mk + '</td><td style="font-size:12px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escapeHtml(artNombre(cod, r.descripcion) || "") + '">' + escapeHtml(artNombre(cod, r.descripcion) || "—") + '</td><td>' + sel + '</td></tr>';
  }).join("") + '</tbody></table></div>';
  body.innerHTML = h;
  if (_stkPop._focusQ) { const qi = document.getElementById("provImpQ"); if (qi) { qi.focus(); try { qi.setSelectionRange(qi.value.length, qi.value.length); } catch (_e) {} } }
}
function provImpSearch(v) { if (!_stkPop || _stkPop.kind !== "provImp") return; _stkPop.q = v; _stkPop._focusQ = true; _provImpRender(); }
function provImpToggleSin() { if (!_stkPop || _stkPop.kind !== "provImp") return; _stkPop.soloSin = !_stkPop.soloSin; _stkPop._focusQ = false; _provImpRender(); }
/* v22.81 — El maestro de importados (Importados / Importados_Volumen) se escribe CON LOGIN.
   Antes iba con la clave publicable como Bearer (= anon) y las dos tablas aceptaban escritura
   de cualquiera: la clave está en este repo público y signInAnonymously también da el rol
   authenticated. Ahora la base sólo deja escribir a supervisores (es_supervisor_virgilio(),
   políticas imp_write_supervisor / impvol_*_supervisor, sql/gv_importados_escritura_supervisor_v2281.sql)
   y acá se manda el JWT de la sesión Google (facAuthWriteHeaders).
   ⚠ Un PATCH que la RLS filtra NO da error: vuelve 0 filas. Por eso se pide la representación y
   se cuenta — 0 filas = no se guardó, y se avisa (no queda un error mudo). */
async function _impEscribir(ruta, metodo, cuerpo, prefer) {
  const h = await facAuthWriteHeaders({ Prefer: prefer || "return=representation" });
  if (!h) throw new Error(authNoSesionMsg("Iniciá sesión con Google para guardar."));
  const r = await fetch(SUPABASE_URL + "/rest/v1/" + ruta, { method: metodo, headers: h, body: JSON.stringify(cuerpo) });
  if (!r.ok) { let t = ""; try { t = await r.text(); } catch (_e) {} throw new Error("HTTP " + r.status + (t ? " — " + t : "")); }
  if (metodo === "PATCH") {
    let filas = null; try { filas = await r.json(); } catch (_e) {}
    if (!Array.isArray(filas) || !filas.length) throw new Error("no se guardó nada (0 filas): sólo un supervisor logueado puede cambiar el maestro de importados.");
  }
  return r;
}
async function provImpSet(codEnc, prov) {
  if (!_stkPop || _stkPop.kind !== "provImp") return;
  const cod = decodeURIComponent(codEnc);
  const row = (_stkPop.rows || []).find(function (x) { return String(x.cod) === cod; });
  const prev = row ? row.proveedor : null;
  if (row) row.proveedor = prov || null;   // optimista
  _stkPop._focusQ = false;
  try {
    // PATCH del maestro Importados: actualiza el proveedor de TODAS las filas (marcas) de ese cod_art
    await _impEscribir("Importados?cod_art=eq." + encodeURIComponent(cod), "PATCH",
      { proveedor: prov || null, actualizado: new Date().toISOString() });
  } catch (e) { if (row) row.proveedor = prev; try { alert("No se pudo guardar: " + (e.message || e)); } catch (_e2) {} }
  _provImpRender();
}

/* v9.22 — Módulo "Pedidos Importación": pantalla dedicada (FUERA de las OC de talleristas)
   para los pedidos a los proveedores chinos. Reusa ocgFetchImportados() (motor
   v_importados_ordenes + lógica de partes). Agrupa por IMPORTADOR (Chef / Tierra Nativa) →
   proveedor chino. Muestra proy, objetivo, stock, en curso y lo a pedir (unidades y cajas).
   Solo lectura por ahora (la emisión/curso se afina aparte). */
let _IMPORTADOR_DE = { "Ownland": "Chef", "Kangli": "Chef", "Fujian": "Chef", "Frontier": "Chef",
                       "Becky": "Tierra Nativa", "Hugo Wong": "Tierra Nativa", "Zhixin": "Tierra Nativa" };
/* v22.37 — Proveedores que NO nos facturan directo: le facturan a NTL y NTL nos factura a
   nosotros. Por ese servicio NTL cobra un 5% (la línea "NTL" del Excel de nacionalización,
   0,05×FOB). Ownland, Becky y Hugo Wong NO usan ese servicio → no llevan el 5%. */
let _NTL_PROVEEDORES = { "Frontier": true, "Fujian": true, "Kangli": true, "Zhixin": true };
function _esProvNtl(prov) { return !!_NTL_PROVEEDORES[String(prov || "").trim()]; }
/* v23.89 (Luis) — las TASAS también salen de la base (Importados_Config → gv_imp_nac_config).
   Esto es el FALLBACK con los números de la v23.79/80/81: si el fetch falla la cuenta no cambia,
   pero la fuente es la tabla y se edita desde el ⚙ del proveedor (pestaña Generales). */
let _NAC_TASAS = { estad_pct: 0.03, estad_fob_desde: 6000, estad_fob_hasta: 10000, estad_fijo: 180,
                   iva_pct: 0.21, iva_adic_pct: 0.20, gcias_pct: 0.06, iibb_pct: 0.0017,
                   derechos_pct: 0.18, ntl_pct: 0.05, valor_m3: 110, flete_full: 2000,
                   meses_objetivo: 10, moq: 1000, moq_meses_max: 12, moq_pct: 0.8,
                   autoriz_impo_pct: 0.007 };   // v25.13 (Thomas): «Autorización de Impo», % del FOB con INAL
function _nacPct(n) { return (Math.round(_nacNum(n, 0) * 10000) / 100).toLocaleString("es-AR"); }
// v23.79 (Luis): estadística por tramo de FOB — hasta el piso paga su %; en el tramo del medio,
// un fijo en u$s; arriba del techo, el % sin tope. Base del %: el CIF (como el resto).
function _nacEstad(fob, cif) {
  const T = _NAC_TASAS;
  if (fob > T.estad_fob_desde && fob <= T.estad_fob_hasta)
    return { v: T.estad_fijo, lbl: "Estadística (FOB " + _nacF(T.estad_fob_desde + 1) + "–" + _nacF(T.estad_fob_hasta) + ": fijo " + _nacF(T.estad_fijo) + ")", txt: "FOB " + _nacF(fob) + " entre " + _nacF(T.estad_fob_desde + 1) + " y " + _nacF(T.estad_fob_hasta) + " → u$s " + _nacF(T.estad_fijo) + " fijos" };
  return { v: T.estad_pct * cif, lbl: "Estadística (" + _nacPct(T.estad_pct) + "% CIF)", txt: _nacPct(T.estad_pct) + "% × CIF " + _nacF(cif) + " (FOB " + _nacF(fob) + (fob > T.estad_fob_hasta ? " > " + _nacF(T.estad_fob_hasta) + ": sin tope)" : " ≤ " + _nacF(T.estad_fob_desde) + ")") };
}
// v23.80 (Luis): lo RECUPERABLE, separado. Base imponible = CIF + derechos + estadística (la de aduana).
// Tasas generales: IVA 21%, IVA adicional 20%, Ganancias 6%, IIBB 0,17% (v23.81, Luis). Se pagan al despachar y
// vuelven como crédito fiscal: NO van al costo del artículo, pero sí hay que tener la plata.
function _nacRecup(cif, derechos, estad) {
  var T = _NAC_TASAS;
  var base = cif + derechos + estad;
  var bt = "base " + _nacF(base) + " (CIF + derechos + estadística)";
  var d = [["IVA (" + _nacPct(T.iva_pct) + "%)", T.iva_pct * base, _nacPct(T.iva_pct) + "% × " + bt],
    ["IVA adicional (" + _nacPct(T.iva_adic_pct) + "%)", T.iva_adic_pct * base, _nacPct(T.iva_adic_pct) + "% × base"],
    ["Ganancias (" + _nacPct(T.gcias_pct) + "%)", T.gcias_pct * base, _nacPct(T.gcias_pct) + "% × base"],
    ["Ingresos Brutos (" + _nacPct(T.iibb_pct) + "%)", T.iibb_pct * base, _nacPct(T.iibb_pct) + "% × base"]];
  return { base: base, total: d.reduce(function (s, x) { return s + x[1]; }, 0), detalle: d };
}
// v23.78 (Luis): derechos 35% del CIF sólo para Fujian; el resto 18% de base.
let _DERECHOS_PROV = { "Fujian": 0.35 };
function _derechosProv(prov) { var t = _DERECHOS_PROV[String(prov || "").trim()]; return t != null ? t : _NAC_TASAS.derechos_pct; }
/* v22.37 — parámetros de nacionalización del embarque (los pocos que cambian por pedido).
   El resto de las tasas están fijas dentro de _pedImpNacionalizar, iguales al Excel. */
const _NAC_DEFAULTS = { modo: "consolidada", valorM3: 110, fleteFull: 2000, tn: 0 };
function _nacNum(v, d) { var n = Number(v); return (isFinite(n) && n >= 0) ? n : (d || 0); }
function _nacF(n) { return Math.round(_nacNum(n, 0)).toLocaleString("es-AR"); }
function _nacF2(n) { return (Math.round(_nacNum(n, 0) * 100) / 100).toLocaleString("es-AR"); }
/* Costo de nacionalización (traer de China a Argentina), portado del Excel
   "Calculo_Nacionalizacion". Devuelve el costo NO RECUPERABLE (lo que queda pegado al costo
   del artículo) y el factor sobre FOB. Modos: consolidada (marítimo LCL), full (contenedor
   propio FCL) y avion (FEDEX). El 5% de NTL (línea "NTL" del Excel, 0,05×FOB) va SÓLO si
   opts.ntl. Los costos fijos de flete son POR EMBARQUE: acá cada proveedor = su propio pedido.
   ⚠ La logística de este cálculo vive también en sql/… — no; vive sólo acá (el módulo es front).
   Lo sostiene tests/impo-nacionalizacion.cjs. */
function _pedImpNacionalizar(fob, m3, opts) {
  opts = opts || {};
  fob = _nacNum(fob, 0); m3 = _nacNum(m3, 0);
  var ntl = !!opts.ntl;
  var modo = opts.modo || "consolidada";
  var valorM3 = _nacNum(opts.valorM3, _NAC_DEFAULTS.valorM3);
  var tasaDer = _nacNum(opts.derechos, 0.18);   // v23.78: 35% Fujian, 18% el resto
  var pctDer = Math.round(tasaDer * 100);
  var tn = _nacNum(opts.tn, 0);   // peso (toneladas); impacto menor salvo en avión. 0 = no cargado.
  if (!(fob > 0)) return { modo: modo, ok: false, noRecup: 0, ntl: 0, factor: 0, landed: 0, detalle: [] };
  var det = [];
  // v25.13 (Thomas): la «libre circulación» ahora se llama «Autorización de Impo», va EN LOS TRES MODOS y la
  // paga SÓLO lo que lleva INAL (GV_Articulo_INAL): % × FOB de esos artículos (Importados_Config.autoriz_impo_pct).
  // Sin el dato INAL (opts.fobInal null) va sobre todo el FOB: es lo conservador.
  var pAut = _nacNum(_NAC_TASAS.autoriz_impo_pct, 0.007);
  var sinInal = (opts.fobInal == null);
  var fobInal = sinInal ? fob : Math.min(fob, _nacNum(opts.fobInal, 0));
  var libreCirc = pAut * fobInal;                    // D33
  var detAut = ["Autorización de Impo (" + _nacPct(pAut) + "% FOB INAL)", libreCirc, _nacPct(pAut) + "% × FOB con INAL " + _nacF(fobInal) + (sinInal ? " (sin el dato INAL: sobre todo el FOB)" : ""), "inal"];
  if (modo === "full") {
    var seguroF = 0.005 * fob;
    var fleteF = _nacNum(opts.fleteFull, _NAC_DEFAULTS.fleteFull);
    var cifF = fleteF + seguroF + fob;
    var derechosF = tasaDer * cifF;
    var _eF = _nacEstad(fob, cifF), estadF = _eF.v;   // v23.79: por tramo de FOB
    var ntl5F = ntl ? 0.05 * fob : 0;
    var tasasF = 10 + 180;                                   // Sim + Tasa Est.
    var despachF = Math.max(300, fob * 0.01) + 150 + 100 + 30;
    var gastosF = 150 + 40;                                  // flete depósito + bancarios
    var fleteDepF = 2000 + 750 + 800;                        // container + marítima + terminal
    var noRecupF = fleteDepF + seguroF + derechosF + estadF + tasasF + gastosF + despachF + ntl5F + libreCirc;
    det = [["Flete + terminal", fleteDepF, "container 2.000 + marítima 750 + terminal 800", "m3"],
      ["Seguro (0,5% FOB)", seguroF, "0,5% × FOB " + _nacF(fob), "fob"],
      ["Derechos (" + pctDer + "% CIF)", derechosF, pctDer + "% × CIF " + _nacF(cifF), "fob"],
      [_eF.lbl, estadF, _eF.txt, "fob"],
      detAut,
      ["Tasas (Sim + est.)", tasasF, "Sim 10 + tasa est. 180", "fob"],
      ["Gastos varios", gastosF, "flete a depósito 150 + bancarios 40", "fob"],
      ["Despachante", despachF, "máx(300; 1% FOB) + 150 + 100 + 30", "fob"]];
    if (ntl) det.push(["Comisión NTL (5% FOB)", ntl5F, "5% × FOB " + _nacF(fob) + " (sobre FOB, no CIF)", "fob"]);
    var _rF = _nacRecup(cifF, derechosF, estadF);
    return { modo: modo, ok: true, cif: cifF, cifTxt: "flete " + _nacF(fleteF) + " + seguro " + _nacF(seguroF) + " + FOB " + _nacF(fob), ntl: ntl5F, noRecup: noRecupF, factor: noRecupF / fob, landed: fob + noRecupF, detalle: det, recup: _rF.total, detRecup: _rF.detalle, baseRecup: _rF.base };
  }
  if (modo === "avion") {
    var kg = tn * 1000;
    var fleteA = kg * 13.5;
    var certA = fleteA * 0.2;
    var seguroA = (fob + certA) * 0.01;
    var cifA = fob + seguroA + certA;
    var derechosA = tasaDer * cifA;
    var _eA = _nacEstad(fob, cifA), estadA = _eA.v;
    var ivaImpA = (derechosA + cifA) * 0.21;
    var tasaDesA = 50, gestionA = 85;
    var ntl5A = ntl ? 0.05 * fob : 0;   // v23.81 (Luis): en avión también va la comisión NTL
    var noRecupA = seguroA + derechosA + tasaDesA + gestionA + fleteA + estadA + ivaImpA + ntl5A + libreCirc;
    det = [["Flete FEDEX", fleteA, _nacF(kg) + " kg × 13,5", "m3"], ["Certif. FEDEX", certA, "20% × flete", "m3"],
      ["Seguro (1%)", seguroA, "1% × (FOB + certif.)", "fob"], ["Derechos (" + pctDer + "%)", derechosA, pctDer + "% × CIF " + _nacF(cifA), "fob"],
      [_eA.lbl, estadA, _eA.txt, "fob"], detAut, ["IVA importación", ivaImpA, "21% × (derechos + CIF)", "fob"],
      ["Tasa desembolso", tasaDesA, "fijo", "fob"], ["Gestión Comex", gestionA, "fijo", "fob"]];
    if (ntl) det.push(["Comisión NTL (5% FOB)", ntl5A, "5% × FOB " + _nacF(fob) + " (sobre FOB, no CIF)", "fob"]);
    return { modo: modo, ok: (kg > 0), cif: cifA, cifTxt: "FOB " + _nacF(fob) + " + seguro " + _nacF(seguroA) + " + certif. " + _nacF(certA), noRecup: noRecupA, ntl: ntl5A, factor: noRecupA / fob, landed: fob + noRecupA, detalle: det, recup: 0, detRecup: [], sinPeso: !(kg > 0) };
  }
  // consolidada (default) — marítimo LCL
  var fleteTot = 1080 + 35 + 90 + (tn < 1 ? 4 : tn * 4) + (valorM3 + 25) * m3;   // Costo Flete total (D10)
  var fleteCif = valorM3 * m3;                       // parte marítima que entra al CIF (D41)
  var seguro = 0.005 * fob;                          // D13
  var cif = fleteCif + seguro + fob;                 // D14
  var derechos = tasaDer * cif;                         // v23.77: 18% de base (Luis; cada artículo tiene su arancel)
  var ntl5 = ntl ? 0.05 * fob : 0;                   // D17 (línea "NTL")
  var _eC = _nacEstad(fob, cif), estad = _eC.v;   // v23.79: por tramo de FOB (Luis)
  var tasaFija = 180;                                // D19
  var sim = 10;                                      // D38
  var gastosVarios = 30 + 40;                        // F20 (flete depósito + bancarios)
  var despach = Math.max(300, fob * 0.01) + 120 + 0 + 30;   // F26 (honorarios 1% + gtos + digital.)
  var noRecup = fleteTot + derechos + estad + sim + gastosVarios + despach + tasaFija + ntl5 + libreCirc;
  det = [["Flete + dep. fiscal", fleteTot, "fijos 1.080 + 35 + 90 + " + (tn < 1 ? "4" : "4 × " + _nacF2(tn) + " TN") + " + (" + _nacF(valorM3) + " + 25) × " + _nacF2(m3) + " m³", "m3"],
    ["Derechos (" + pctDer + "% CIF)", derechos, pctDer + "% × CIF " + _nacF(cif) + (tasaDer === 0.18 ? " (base; cada artículo tiene su arancel)" : ""), "fob"],
    [_eC.lbl, estad, _eC.txt, "fob"],
    detAut,
    ["Tasas (Sim + est.)", sim + tasaFija, "Sim 10 + tasa est. 180", "fob"],
    ["Gastos varios", gastosVarios, "flete a depósito 30 + bancarios 40", "fob"],
    ["Despachante", despach, "máx(300; 1% FOB) + 120 + 30", "fob"]];
  if (ntl) det.push(["Comisión NTL (5% FOB)", ntl5, "5% × FOB " + _nacF(fob) + " (sobre FOB, no CIF)", "fob"]);
  var _rC = _nacRecup(cif, derechos, estad);
  return { recup: _rC.total, detRecup: _rC.detalle, baseRecup: _rC.base, modo: modo, ok: true, cif: cif, cifTxt: "flete marítimo " + _nacF(valorM3) + " × " + _nacF2(m3) + " m³ = " + _nacF(fleteCif) + " + seguro 0,5% " + _nacF(seguro) + " + FOB " + _nacF(fob), ntl: ntl5, noRecup: noRecup, factor: noRecup / fob, landed: fob + noRecup, detalle: det };
}
/* ══ v24.01 (Luis, 29/09) — EL COSTO DE NACIONALIZACIÓN POR ARTÍCULO ═══════════════
   Luis: "cada artículo en el listado tenga el coste de nacionalización, calculable por m³
   y que sea variable (se pueda ajustar)".

   ⚠ REPARTIR TODO POR m³ NO ES NEUTRO, y por eso hay TRES criterios y el default NO es m³:
   del costo del embarque, lo único que se paga por VOLUMEN es el flete; los derechos, la
   estadística, el seguro, la libre circulación, el despachante y la comisión NTL son un %
   del FOB / CIF. Repartiendo todo por m³, un artículo voluminoso y barato paga derechos
   que no generó y uno chico y caro los paga de menos.
     · "mixto" (default) → cada concepto por SU base: el flete por m³, el resto por FOB.
     · "m3"   → todo por m³   (lo que Luis pidió textual: el costo se mira contra el volumen)
     · "fob"  → todo por FOB  (el factor parejo de siempre)
   La base de cada concepto viaja en el 4.º elemento de res.detalle ("m3" | "fob"), puesta
   por _pedImpNacionalizar: no se adivina acá por el nombre del renglón.

   `items` = [{m3, fob, uni}] en el MISMO orden que las líneas. Devuelve un array paralelo
   con los u$s de cada uno, y la suma da EXACTAMENTE res.noRecup (se escala al final: en
   modo avión la suma del detalle no coincide con el no recuperable, porque el certificado
   FEDEX entra al CIF y no se suma como costo propio).

   Guards, porque una base puede venir vacía y una división por cero se lleva la pantalla:
   si la base elegida suma 0 se cae a la otra, y si las dos son 0 reparte por unidades; si
   tampoco hay unidades, parejo. Nunca le tira todo al primer renglón. */
function _impNacReparto(res, items, crit) {
  crit = (crit === "m3" || crit === "fob") ? crit : "mixto";
  items = (items || []).map(function (it) {
    return { m3: _nacNum(it && it.m3, 0), fob: _nacNum(it && it.fob, 0), uni: _nacNum(it && it.uni, 0), inal: !!(it && it.inal) };
  });
  var n = items.length;
  var cero = items.map(function () { return 0; });
  if (!n || !res || !res.ok || !(_nacNum(res.noRecup, 0) > 0))
    return { crit: crit, items: cero, total: 0, porBase: { m3: 0, fob: 0 }, usadas: [], sumaM3: 0, sumaFob: 0, sumaUni: 0 };
  var sM3 = 0, sFob = 0, sUni = 0, sInal = 0;
  items.forEach(function (it) { sM3 += it.m3; sFob += it.fob; sUni += it.uni; if (it.inal) sInal += it.fob; });
  function pesos(base) {
    // v25.13 — la Autorización de Impo la pagan sólo los que llevan INAL, por su FOB
    if (base === "inal") {
      if (sInal > 0) return { usa: "fob", w: items.map(function (it) { return it.inal ? it.fob / sInal : 0; }) };
      base = "fob";
    }
    var usa = base, s = (base === "m3" ? sM3 : sFob);
    if (!(s > 0)) { usa = (base === "m3" ? "fob" : "m3"); s = (usa === "m3" ? sM3 : sFob); }
    if (!(s > 0)) { usa = "unidades"; s = sUni; }
    if (!(s > 0)) return { usa: "parejo", w: items.map(function () { return 1 / n; }) };
    return { usa: usa, w: items.map(function (it) { return (usa === "m3" ? it.m3 : usa === "fob" ? it.fob : it.uni) / s; }) };
  }
  var acum = cero.slice(), porBase = { m3: 0, fob: 0 }, usadas = {};
  (res.detalle || []).forEach(function (d) {
    var imp = _nacNum(d && d[1], 0); if (!(imp > 0)) return;
    var base = (crit === "mixto") ? (d[3] === "m3" ? "m3" : d[3] === "inal" ? "inal" : "fob") : crit;
    porBase[base === "inal" ? "fob" : base] += imp;
    var p = pesos(base); usadas[p.usa] = true;
    p.w.forEach(function (w, i) { acum[i] += imp * w; });
  });
  var suma = acum.reduce(function (a, b) { return a + b; }, 0);
  var k = suma > 0 ? (_nacNum(res.noRecup, 0) / suma) : 0;
  acum = acum.map(function (v) { return v * k; });
  return { crit: crit, items: acum, total: acum.reduce(function (a, b) { return a + b; }, 0),
           porBase: porBase, usadas: Object.keys(usadas), sumaM3: sM3, sumaFob: sFob, sumaUni: sUni };
}
/* Qué dice la etiqueta del criterio elegido (para el chip y el title). */
function _impNacCritTxt(crit) {
  if (crit === "m3") return { lbl: "por m³", tip: "Todo el costo se reparte por VOLUMEN. Ojo: los derechos y la estadística son % del FOB, así que acá un artículo voluminoso y barato paga derechos que no generó." };
  if (crit === "fob") return { lbl: "por FOB", tip: "Todo el costo se reparte por PLATA (u$s FOB de cada artículo). Es el factor parejo de siempre." };
  return { lbl: "mixto", tip: "Cada concepto por su base: el flete por m³ (se paga por volumen) y derechos, estadística, seguro, despachante y NTL por FOB (son % del FOB/CIF). Es el reparto que no le cobra derechos al volumen." };
}
function _usd0(n) { return "u$s " + Math.round(_nacNum(n, 0)).toLocaleString("es-AR"); }
/* v23.75 — (Luis) cada chip de la banda se EXPANDE con el desglose: de dónde sale el consumo
   por mes y los meses al mínimo (izq), y cómo se arma lo no recuperable (der). El abierto/cerrado
   queda en _pedImpDesgAb por proveedor, así sobrevive a los re-render (editar un MC redibuja). */
var _pedImpDesgAb = {};
/* v23.91 — los datos con los que el pop-up rearma el desglose de cada proveedor. Va acá,
   junto a lo que lo usa: declarado más abajo quedaba en zona muerta para _pedImpBandaHtml. */
var _pedImpDesgData = {};
function _pedImpDesgToggle(el) { try { var k = el.getAttribute("data-k"); if (el.open) _pedImpDesgAb[k] = 1; else delete _pedImpDesgAb[k]; } catch (_e) {} }
function _pedImpDesgDer(nac, totUsd, m3) {
  /* v23.90 (Luis, 29/09) — DOS COLUMNAS: concepto (con su % entre paréntesis) e importe.
     La fórmula ya no ocupa una columna fija: se abre al tocar el renglón. Antes eran tres
     columnas y la del medio, con las cuentas de todos los ítems a la vez, era la que hacía
     ilegible el cuadro.
     ⚠ El % de cada concepto viene YA en su nombre, armado por _pedImpNacionalizar con las
     tasas de la base (_NAC_TASAS): acá no se escribe ningún número. */
  var esc = escapeHtml;
  var tdN = 'style="padding:0;border-bottom:1px solid #c7d2fe"';
  var tdI = 'style="padding:5px 8px;border-bottom:1px solid #c7d2fe;text-align:right;white-space:nowrap;font-weight:700;vertical-align:top"';
  var tit = function (txt, col) { return '<tr><td colspan="2" style="padding:9px 8px 3px;font-weight:800;font-size:14px;color:' + col + '">' + txt + '</td></tr>'; };
  var fila = function (d, col) {
    var det = String(d[2] || "");
    if (!det) return '<tr><td style="padding:5px 8px;border-bottom:1px solid #c7d2fe">' + esc(d[0]) + '</td><td ' + tdI + '>' + _usd0(d[1]) + '</td></tr>';
    return '<tr><td ' + tdN + '>' +
      '<details style="padding:5px 8px"><summary style="cursor:pointer;list-style:none">' + esc(d[0]) +
      ' <span style="font-size:11px;color:' + col + ';font-weight:800">▸ detalle</span></summary>' +
      '<div style="margin:4px 0 2px 2px;font-size:12.5px;color:' + col + '">' + esc(det) + '</div></details>' +
      '</td><td ' + tdI + '>' + _usd0(d[1]) + '</td></tr>';
  };
  var tot = function (lbl, txt, v, bg) {
    return '<tr style="background:' + bg + '"><td style="padding:6px 8px"><b>' + lbl + '</b>' +
      (txt ? '<div style="font-size:11.5px;font-weight:600;color:#475569">' + esc(txt) + '</div>' : '') +
      '</td><td style="padding:6px 8px;text-align:right;white-space:nowrap;font-size:15px;vertical-align:middle"><b>' + _usd0(v) + '</b></td></tr>';
  };
  var rec = nac.detRecup || [];
  var h = '<div style="margin-top:8px;font-size:13.5px;color:#312e81">' +
    (nac.cif > 0 ? '<div style="margin-bottom:6px"><b>CIF</b> = ' + nac.cifTxt + ' = <b>' + _usd0(nac.cif) + '</b> (base de derechos y estadística)</div>' : '') +
    '<div style="font-size:11.5px;color:#6366f1;margin-bottom:5px">👆 Tocá un renglón para ver de dónde sale el número.</div>' +
    '<table style="border-collapse:collapse;width:100%"><colgroup><col><col style="width:110px"></colgroup><tbody>' +
    '<tr><td style="padding:5px 8px;border-bottom:1px solid #c7d2fe"><b>FOB del pedido</b> <span style="color:#6366f1;font-size:12px">· ' + _nacF2(m3) + ' m³</span></td><td ' + tdI + '>' + _usd0(totUsd) + '</td></tr>' +
    tit('🔴 No recuperable · queda en el costo', '#b91c1c') +
    (nac.detalle || []).map(function (d) { return fila(d, "#4338ca"); }).join('') +
    tot('Total no recuperable', '÷ FOB = +' + Math.round(nac.factor * 100) + '%', nac.noRecup, '#fee2e2') +
    tot('Puesto en Arg', 'FOB + no recuperable', nac.landed, '#e0e7ff');
  if (rec.length) {
    h += tit('🟢 Recuperable · se paga al despachar y vuelve como crédito fiscal', '#047857') +
      rec.map(function (d) { return fila(d, "#047857"); }).join('') +
      tot('Total recuperable', 'no va al costo del artículo', nac.recup, '#d1fae5') +
      tot('Plata a tener al despachar', 'FOB + no recuperable + recuperable', nac.landed + nac.recup, '#fef3c7');
  }
  h += '</tbody></table>' + (nac.modo === "avion" ? '<div style="margin-top:6px;color:#6366f1">Avión (courier): el IVA no se recupera, por eso va en el costo.</div>' : '') + '</div>';
  return h;
}
/* Banda por proveedor: costo de nacionalización del pedido. */
function _pedImpBandaHtml(nac, totUsd, ext) {
  ext = ext || {};
  // v23.91 (Luis) — el desglose ya NO se abre DENTRO del chip: lo hacía crecer y empujaba la
  // tabla hacia abajo. Ahora el chip es una línea y «ver desglose» abre un pop-up.
  // Los datos para rearmarlo quedan en _pedImpDesgData, así el pop-up no depende del HTML.
  var chip = function (bg, bd, col, html, desg, lado) {
    var base = 'background:' + bg + ';border-color:' + bd + ';color:' + col;
    var cuerpo = '<div class="pc-txt">' + html + '</div>';
    if (desg) cuerpo += '<button class="pc-mas" title="Ver el desglose" onclick="pedImpDesgPop(\'' + encodeURIComponent(String(ext.prov || "")) + '\',\'' + lado + '\')">›</button>';
    return '<div class="pedimp-chip" style="' + base + '">' + cuerpo + '</div>';
  };
  _pedImpDesgData[String(ext.prov || "")] = { nac: nac, totUsd: totUsd, ext: ext };
  var _big = function (txt, col2) { return '<span class="pc-big"' + (col2 ? ' style="color:' + col2 + '"' : '') + '>' + txt + '</span>'; };
  var _pie = function (txt) { return '<div style="opacity:.85">' + txt + '</div>'; };
  var der;
  var modoTxt = { consolidada: "Consolidada", full: "Contenedor", avion: "Avión" }[nac.modo] || nac.modo;
  if (!(totUsd > 0)) der = chip("#f1f5f9", "#e2e8f0", "#475569", '🚢 Poné el pedido (columna <b>MC</b>) para ver el costo <b>puesto en Argentina</b>.');
  else if (nac.sinPeso) der = chip("#fef2f2", "#fecaca", "#991b1b", '✈️ <b>Avión:</b> cargá el <b>peso (TN)</b> arriba para calcular el flete FEDEX.');
  else der = chip("#eef2ff", "#c7d2fe", "#3730a3",
    _big("🚢 +" + Math.round(nac.factor * 100) + "% · " + _usd0(nac.noRecup), "#b91c1c") + ' <span style="font-weight:800;color:#b91c1c">no recuperable</span>' +
    _pie('puesto en Arg ' + _usd0(nac.landed) + ' · FOB ' + _usd0(totUsd) + ' · ' + modoTxt + (nac.ntl > 0 ? ' · NTL ' + _usd0(nac.ntl) : '') +
      (nac.recup > 0 ? ' · <span style="color:#047857;font-weight:700">' + _usd0(nac.recup) + ' recuperable</span>' : '')),
    _pedImpDesgDer(nac, totUsd, ext.m3), "der");
  // v24.58 (Thomas) — el chip del mínimo (izq) ya no se dibuja: «es una norma general, no algo que
  // sí o sí hay que cubrir». Queda sólo el costo puesto en Argentina.
  return '<div class="pedimp-banda">' + der + '</div>';
}
/* ══ v23.89 (Luis, 29/09) — LA CONFIG DE IMPORTADOS VIVE EN TABLAS ═══════════════════
   "Fijate que no vivan en el front los datos, sino que modifiquen las tablas pertinentes".
   Hasta la v23.87 el importador de cada proveedor, quién factura por NTL, el % de derechos,
   las tasas de nacionalización y el mínimo estaban ESCRITOS ACÁ, y los meses objetivo eran
   uno solo para todos (se editaban en OCs → ⚙ Configuraciones, que es otro módulo). Ahora:
     GV_Imp_Proveedor  (vista gv_imp_proveedor_cfg) → uno por proveedor, con lo que pisa
     Importados_Config (vista gv_imp_nac_config)    → los generales
   Los objetos de arriba (_PROV_IMP_LISTA, _IMPORTADOR_DE, _NTL_PROVEEDORES, _DERECHOS_PROV
   y _NAC_TASAS) quedan de FALLBACK: si el fetch falla la pantalla calcula igual que siempre.
   ⚠ Al agregar un parámetro nuevo de importados: va a la tabla y se hidrata acá. No se
   vuelve a escribir un número en este archivo. */
let _impCfgProv = {};          // proveedor → fila de gv_imp_proveedor_cfg
let _impCfgArt = {};           // cod_art  → { derechos_pct, prov } de gv_imp_articulo_cfg
/* v25.13 (Thomas) — tipo de producto (GV_Producto_Tipo, el Excel de equivalencias LK/CH/Loke) y si
   el artículo lleva INAL (GV_Articulo_INAL), resueltos por la vista gv_imp_articulo_extra.
   Clave "COD|MARCA". _impExtraOk en false = no se pudo leer: no se agrupa y la Autorización de
   Impo va sobre todo el FOB (lo conservador) en vez de adivinar quién lleva INAL. */
let _impExtra = {}, _impExtraOk = false;
async function _impCfgCargar() {
  try {
    const res = await Promise.all([
      supaFetchAllSafe(SUPABASE_URL + "/rest/v1/gv_imp_proveedor_cfg", "select=*&order=orden.asc,proveedor.asc").catch(function () { return []; }),
      supaFetchAllSafe(SUPABASE_URL + "/rest/v1/gv_imp_nac_config", "select=*").catch(function () { return []; }),
      // v23.90 (Luis) — los derechos pueden ser del ARTÍCULO (su partida arancelaria)
      supaFetchAllSafe(SUPABASE_URL + "/rest/v1/gv_imp_articulo_cfg", "select=cod_art,derechos_pct,proveedor").catch(function () { return []; }),
      supaFetchAllSafe(SUPABASE_URL + "/rest/v1/gv_imp_articulo_extra", "select=cod_art,marca,tipo_producto,familia,tipo_fila,inal,inal_certificado,inal_vence").catch(function () { return null; })
    ]);
    if (Array.isArray(res[3]) && res[3].length) {
      const ex = {};
      res[3].forEach(function (r) { ex[String(r.cod_art || "").trim().toUpperCase() + "|" + String(r.marca || "").trim().toUpperCase()] = r; });
      _impExtra = ex; _impExtraOk = true;
    }
    const pr = res[0], nac = res[1];
    _impCfgArt = {};
    (res[2] || []).forEach(function (a) {
      const c = String(a.cod_art || "").trim().toUpperCase(); if (!c) return;
      _impCfgArt[c] = { derechos_pct: (a.derechos_pct == null ? null : Number(a.derechos_pct)), prov: String(a.proveedor || "").trim() };
    });
    if (nac && nac[0]) { Object.keys(_NAC_TASAS).forEach(function (k) { if (nac[0][k] != null) _NAC_TASAS[k] = Number(nac[0][k]); }); }
    if (pr && pr.length) {
      // se hidratan los cuatro cachés; lo que la tabla no diga NO se inventa
      const lista = [], impDe = {}, ntl = {}, der = {};
      _impCfgProv = {};
      pr.forEach(function (r) {
        const nom = String(r.proveedor || "").trim(); if (!nom) return;
        _impCfgProv[nom] = r;
        if (r.activo !== false) lista.push(nom);
        if (r.importador) impDe[nom] = r.importador;
        if (r.usa_ntl) ntl[nom] = true;
        if (r.derechos_pct_propio != null) der[nom] = Number(r.derechos_pct_propio);
      });
      _PROV_IMP_LISTA = lista; _IMPORTADOR_DE = impDe; _NTL_PROVEEDORES = ntl; _DERECHOS_PROV = der;
    }
  } catch (_e) {}
}
/* v25.13 — tipo de producto e INAL de un artículo de la pantalla (sus filas del maestro, por marca). */
function _impExtraRow(cod, marca) { return _impExtra[String(cod || "").trim().toUpperCase() + "|" + String(marca || "").trim().toUpperCase()] || null; }
function _impExtraDe(it) {
  const o = { tipo: null, familia: null, inal: false, cert: null, vence: null };
  const dets = (it && it.det && it.det.length) ? it.det : [{ cod: it && it.cod, marca: _impPlantaVista(it) }];
  dets.forEach(function (d) {
    const r = _impExtraRow(d.cod || (it && it.cod), d.marca); if (!r) return;
    if (!o.tipo && r.tipo_producto) { o.tipo = r.tipo_producto; o.familia = r.familia; }
    if (r.inal) { o.inal = true; o.cert = o.cert || r.inal_certificado; o.vence = o.vence || r.inal_vence; }
  });
  return o;
}
/* El FOB de lo que lleva INAL (base de la Autorización de Impo). null si no se pudo leer el dato. */
function _impFobInal(items, usdOf) {
  if (!_impExtraOk) return null;
  return (items || []).reduce(function (s, it) { return s + (_impExtraDe(it).inal ? (_nacNum(usdOf(it), 0)) : 0); }, 0);
}
/* Un número de ESTE proveedor, con el general de fallback (la vista ya resolvió el coalesce). */
function _impProvNum(prov, campo, fb) {
  const r = _impCfgProv[String(prov || "").trim()];
  const v = r ? Number(r[campo]) : NaN;
  return isFinite(v) ? v : _nacNum(fb, 0);
}

/* v23.90 (Luis) — los DERECHOS bajan en cascada: artículo → proveedor → general.
   El % del artículo es su partida arancelaria, así que gana sobre el del proveedor. */
function _derechosArt(cod, prov) {
  const a = _impCfgArt[String(cod || "").trim().toUpperCase()];
  if (a && a.derechos_pct != null && isFinite(a.derechos_pct)) return a.derechos_pct;
  return _derechosProv(prov);
}
/* La tasa de derechos del EMBARQUE: promedio ponderado por FOB de sus artículos. Con todos
   en la misma tasa devuelve esa tasa, o sea que no cambia nada de lo que hay hoy. */
function _derechosPedido(items, prov) {
  var fob = 0, der = 0;
  (items || []).forEach(function (it) {
    var u = (typeof _pedImpUsdOf === "function") ? (_pedImpUsdOf(it) || 0) : 0;
    if (!(u > 0)) return;
    fob += u; der += u * _derechosArt(it.cod, it.prov || prov);
  });
  return fob > 0 ? (der / fob) : _derechosProv(prov);
}

/* ══ v23.90 (Luis, 29/09) — EL CÓDIGO ABRE LA PROYECCIÓN ════════════════════════════
   Es el MISMO pop-up de la pantalla de Stocks (`stkShowProyVentas`), no una copia: si
   cambia la forma de proyectar, cambia en los dos lados solo. Lo único que se agrega es
   el «← Volver al pedido», porque `_stkPopShell` pisa la tarjeta y `stkPopClose()` deja
   la pantalla de importación cerrada.
   ⚠ `stkShowProyVentas` es async pero dibuja el shell ANTES del primer await, así que
   cuando vuelve el control el header ya existe y se le puede colgar el botón. */
/* ══ v23.95 (Luis, 29/09) — MESES OBJETIVO por proveedor, en su encabezado ═══════════
   "el parámetro de meses objetivo ponelo configurable al lado del nombre de cada proveedor
   (menú desplegable con los números del 1 al 24 … que afecte a todos los códigos de ese
   proveedor)". Es la MISMA columna que edita el ⚙ (GV_Imp_Proveedor.meses_objetivo): no hay
   un segundo lugar donde guardarlo. Vacío en la tabla = hereda el general, y el select lo
   muestra como «gral N». */
function _pedImpMesesSel(prov, provEnc) {
  const r = _impCfgProv[String(prov || "").trim()] || {};
  const gral = _nacNum((_NAC_TASAS || {}).meses_objetivo, 10);
  const propio = (r.meses_objetivo_propio == null || r.meses_objetivo_propio === "") ? null : Math.round(Number(r.meses_objetivo_propio));
  // v24.63 (Thomas: «sacá el (gral)») — el general se muestra como su número pelado; ese número no se repite en la lista
  let op = '<option value=""' + (propio == null || propio === gral ? ' selected' : '') + '>' + gral + '</option>';
  for (let i = 1; i <= 24; i++) if (i !== gral) op += '<option value="' + i + '"' + (propio === i ? ' selected' : '') + '>' + i + '</option>';
  return '<label class="pedimp-mesessel" title="Meses de venta que se piden. Cambia el objetivo y el «a pedir» de TODOS los códigos de ' + escapeHtml(prov) + '.">' +
    'Meses obj <select onchange="pedImpSetMeses(\'' + provEnc + '\',this.value)">' + op + '</select></label>';
}
/* v24.64 (Thomas) — los botones 📦 y 📥 de la tabla son íconos sin texto: antes de abrir
   piden confirmar en un pop-up que dice qué hacen. */
const _PEDIMP_ACC = {
  baches:  { t: "📦 Baches", d: "Ver y editar los pedidos en curso de este artículo: cada bache con sus unidades, su fecha de reingreso y sus llegadas (total o parcial).", b: "Abrir Baches", c: "#475569" },
  recibir: { t: "📥 Recibir", d: "Registrar lo que LLEGÓ de este pedido: cuántas unidades, de qué empresa y a dónde va (A guardar, góndola, rack, excedente o insumos). Mueve el stock.", b: "Recibir", c: "#0f766e" }
};
function _pedImpAccionConfirmar(tipo, codEnc, fn) {
  const a = _PEDIMP_ACC[tipo]; if (!a) { fn(); return; }
  let ov = document.getElementById("pedImpAccOv"); if (ov) ov.remove();
  ov = document.createElement("div"); ov.id = "pedImpAccOv";
  ov.setAttribute("style", "position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:99998;display:flex;align-items:center;justify-content:center;padding:16px");
  ov.innerHTML = '<div style="background:#fff;border-radius:14px;max-width:360px;width:100%;padding:16px 18px;box-shadow:0 12px 32px rgba(15,23,42,.3)">' +
    '<div style="font-size:17px;font-weight:800;color:#0f172a;margin-bottom:6px">' + a.t + ' — ' + escapeHtml(decodeURIComponent(codEnc || "")) + '</div>' +
    '<div style="font-size:13.5px;color:#475569;line-height:1.4;margin-bottom:14px">' + a.d + '</div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end">' +
    '<button class="pedimp-acc-no" style="width:auto;margin:0;padding:8px 14px;border-radius:9px;border:1px solid #cbd5e1;background:#fff;color:#334155;font-size:14px;font-weight:700;cursor:pointer">Cancelar</button>' +
    '<button class="pedimp-acc-si" style="width:auto;margin:0;padding:8px 14px;border-radius:9px;border:1px solid ' + a.c + ';background:' + a.c + ';color:#fff;font-size:14px;font-weight:800;cursor:pointer">' + a.b + '</button></div></div>';
  const cerrar = function () { ov.remove(); };
  ov.addEventListener("click", function (ev) { if (ev.target === ov) cerrar(); });
  document.body.appendChild(ov);
  ov.querySelector(".pedimp-acc-no").onclick = cerrar;
  ov.querySelector(".pedimp-acc-si").onclick = function () { cerrar(); fn(); };
}
async function pedImpSetMeses(provEnc, v) {
  const prov = decodeURIComponent(provEnc || ""); if (!prov) return;
  const n = String(v || "").trim() === "" ? null : Number(v);
  if (n != null && !(n >= 1 && n <= 24)) return;
  try {
    await _impCfgRpc("gv_imp_proveedor_guardar", { p: { proveedor: prov, meses_objetivo: n } });
    await _impCfgCargar();                       // la config nueva
    const data = await ocgFetchImportados();     // el objetivo y el «a pedir» los recalcula la base
    // ⚠ sólo se reemplaza si el refetch trajo algo: una lectura vacía dejaría la pantalla en
    // blanco, y "no pude leer" no es "no hay importados" (§ una lectura ROTA no es un CERO).
    if (_stkPop && _stkPop.kind === "pedImp") {
      if (data && data.items && data.items.length) _stkPop.data = data;
      _pedImpRender();
    }
  } catch (e) {
    alert("No se pudieron guardar los meses objetivo de " + prov + ":\n" + (e && e.message ? e.message : e));
    _pedImpRender();
  }
}
function pedImpProyAbrir(codEnc, proyCajas) {
  // v25.01 — un INSUMO no vende: su proyección es la de los productos que arma. Se abre ese desglose.
  const _it = _pedImpItemPorClave(decodeURIComponent(codEnc || ""));
  if (_it && _it.esInsumo) { pedImpStockDesglose(codEnc, "proy"); return; }
  // v23.95 (Luis: "sigue saliendo de importación cuando aprieto") — la proyección se dibuja en
  // SU PROPIO overlay, encima del módulo, que queda intacto abajo. Sin «volver»: se cierra y ya.
  _stkPopAlt = "impProyOv";
  try { stkShowProyVentas(codEnc, proyCajas); } finally { _stkPopAlt = null; }
}

/* ══ v23.90 (Luis, 29/09) — MOQ: el mínimo que el chino acepta fabricar ══════════════
   "agregá al editor por proveedor MOQ … debería tener un indicador en caso de que no se
    llegue al MOQ que diga que permite margen hasta 12 meses de cobertura … en caso de que
    sea más de 12 meses, que indique que está fuera del target".
   Se mide POR ARTÍCULO y en UNIDADES, que es como lo pide la fábrica. La pregunta no es
   "¿cuántas unidades faltan?" sino "¿cuántos MESES de cobertura hay que comprar para que
   el pedido de ESTE código llegue al MOQ?":
       meses necesarios = (MOQ + stock + en curso) / proyección mensual
   · entra con el objetivo del proveedor (10 meses)  → sin chip, no hay nada que decir
   · entra estirando hasta el tope (12 por defecto)  → 🟡 se puede, fuera del target
   · ni con el tope                                  → 🔴 fuera de target
   El MOQ y el tope de meses salen de GV_Imp_Proveedor (default 1.000 u y 12 meses) y se
   editan en el ⚙ del proveedor. ⚠ Acá NO se escribe ningún número. */
/* v24.55 (Thomas, 29/09: "o llego a por lo menos 80% del MOQ o no pido nada") — el MOQ deja de
   ser sólo aviso y MUEVE la cantidad:
     · lo calculado ya llega al 80 % del MOQ           → se pide eso (estado ok)
     · no llega, pero subiendo al 80 % la cobertura
       queda dentro del tope del proveedor (12 meses)  → se sube al 80 % en master cajas (estira)
     · ni así                                          → NO se pide nada (fuera / sinproy)
   El MOQ y el tope salen de GV_Imp_Proveedor; el 80 % es moq_pct (general, default 0,8).
   Una cantidad puesta A MANO (mcOverride) gana siempre: acá no se mira. */
function _pedImpMoqCalc(it) {
  const prov = String((it && it.prov) || "").trim();
  const moq = _impProvNum(prov, "moq", _NAC_TASAS.moq);
  const topeMeses = _impProvNum(prov, "moq_meses_max", _NAC_TASAS.moq_meses_max) + ((it && it.esInsumo) ? INSUMO_MESES_PRODUCTO : 0);   // v25.01 — el insumo lleva sus 2 meses de producto también en el tope
  const pct = (Number(_NAC_TASAS.moq_pct) > 0 && Number(_NAC_TASAS.moq_pct) <= 1) ? Number(_NAC_TASAS.moq_pct) : 0.8;
  const div = (Number(it && it.uniMaster) > 0) ? Number(it.uniMaster) : (Number(it && it.uxc) > 0 ? Number(it.uxc) : 0);
  const mcBase = (it && it.aPedirCajas != null) ? Number(it.aPedirCajas) || 0 : 0;
  const uniBase = div > 0 ? mcBase * div : (Number(it && it.aPedirUni) || 0);
  const piso = moq * pct;
  const out = { moq: moq, pct: pct, piso: piso, topeMeses: topeMeses, mcBase: mcBase, mc: mcBase, uni: uniBase, estado: "ok", mesesNec: 0, meses: Number(it && it.meses) || 0 };
  if (!(moq > 0) || !(mcBase > 0) || uniBase >= piso) return out;       // sin pedido o ya llega al 80 %
  const proy = Number(it.proyUni) || 0;
  if (!(proy > 0) || !(div > 0)) { out.estado = "sinproy"; out.mc = 0; return out; }   // sin venta no se estira: no se pide
  const mcMin = Math.ceil(piso / div);
  const stock = (Number(it.stockUni) || 0), curso = Math.max(0, Number(it.enCurso) || 0);
  out.mesesNec = (mcMin * div + stock + curso) / proy;
  if (out.mesesNec <= topeMeses) { out.estado = "estira"; out.mc = mcMin; out.uni = mcMin * div; }
  else { out.estado = "fuera"; out.mc = 0; out.uni = 0; }
  return out;
}
function _pedImpMoqChip(it) {
  const ov = (_stkPop && _stkPop.mcOverride) ? _stkPop.mcOverride[it.key || it.cod] : undefined;
  if (ov != null) return "";
  const m = _pedImpMoqCalc(it);
  if (m.estado === "ok") return "";
  const pisoTxt = Math.round(m.piso).toLocaleString("es-AR"), baseTxt = Math.round(m.mcBase).toLocaleString("es-AR");
  const pctTxt = Math.round(m.pct * 100) + "%";
  if (m.estado === "estira") {
    const mesesTxt = (Math.round(m.mesesNec * 10) / 10).toLocaleString("es-AR");
    return ' <span style="font-size:10px;font-weight:800;color:#92400e;background:#fef3c7;border-radius:999px;padding:1px 6px" title="Lo calculado (' + baseTxt + ' MC) no llega al ' + pctTxt + ' del MOQ (' + pisoTxt + ' u). Se sube a ' + m.mc + ' MC: la cobertura queda en ' + mesesTxt + ' meses (tope ' + m.topeMeses + ').">🟡 MOQ ' + mesesTxt + 'm</span>';
  }
  return ' <span style="font-size:10px;font-weight:800;color:#fff;background:#b91c1c;border-radius:999px;padding:1px 6px" title="' + (m.estado === "sinproy" ? "Sin Estadística Madre no se puede estirar la cobertura" : "Llegar al " + pctTxt + " del MOQ (" + pisoTxt + " u) dejaría " + (Math.round(m.mesesNec * 10) / 10).toLocaleString("es-AR") + " meses de cobertura, más que el tope de " + m.topeMeses) + ': NO se pide (eran ' + baseTxt + ' MC).">🔴 MOQ · no se pide</span>';
}

/* ── El pop-up ⚙ Configurar parámetros, al lado del nombre del proveedor ────────────── */
let _impCfgPop = null;
async function pedImpCfgAbrir(provEnc) {
  const prov = decodeURIComponent(provEnc || ""); if (!prov) return;
  _impCfgPop = { prov: prov, tab: "params", q: "", arts: null, guardando: false, msg: "" };
  _impCfgRender();
  // los artículos se traen una vez y se reusan entre pestañas
  try {
    const H = { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY };
    const rows = await fetch(SUPABASE_URL + "/rest/v1/vista_prov_importacion?select=cod,descripcion,marca,proveedor&order=cod&limit=5000", { headers: H, cache: "no-store" }).then(function (r) { return r.ok ? r.json() : []; });
    if (_impCfgPop) { _impCfgPop.arts = rows || []; _impCfgRender(); }
  } catch (_e) { if (_impCfgPop) { _impCfgPop.arts = []; _impCfgRender(); } }
}
function pedImpCfgCerrar() { _impCfgPop = null; const o = document.getElementById("impCfgOv"); if (o) o.remove(); }
function pedImpCfgTab(t) { if (!_impCfgPop) return; _impCfgPop.tab = t; _impCfgPop.msg = ""; _impCfgRender(); }
function pedImpCfgBuscar(v) { if (!_impCfgPop) return; _impCfgPop.q = v || ""; _impCfgRender(); }
function _impCfgPctTxt(v) { return v == null || v === "" ? "" : String(Math.round(Number(v) * 10000) / 100).replace(".", ","); }
function _impCfgNum(id) { const e = document.getElementById(id); return e ? String(e.value || "").trim().replace(",", ".") : ""; }

function _impCfgRender() {
  let ov = document.getElementById("impCfgOv");
  if (!_impCfgPop) { if (ov) ov.remove(); return; }
  if (!ov) {
    ov = document.createElement("div"); ov.id = "impCfgOv";
    ov.setAttribute("style", "position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:99999;display:flex;align-items:flex-start;justify-content:center;padding:18px;overflow:auto");
    ov.addEventListener("click", function (ev) { if (ev.target === ov) pedImpCfgCerrar(); });
    document.body.appendChild(ov);
  }
  const P = _impCfgPop, prov = P.prov, r = _impCfgProv[prov] || {};
  const soloGral = !prov;   // v23.91 — el pop-up de los parámetros generales, sin proveedor
  const g = _NAC_TASAS, esc = escapeHtml;
  const tabB = function (id, txt) { return '<button onclick="pedImpCfgTab(\'' + id + '\')" style="padding:7px 18px;border-radius:999px;border:1px solid ' + (P.tab === id ? '#0f766e' : '#cbd5e1') + ';background:' + (P.tab === id ? '#0f766e' : '#fff') + ';color:' + (P.tab === id ? '#fff' : '#334155') + ';font-weight:800;font-size:14.5px;cursor:pointer">' + txt + '</button>'; };
  const campo = function (id, lbl, val, ph, hint) {
    return '<div style="display:flex;flex-direction:column;gap:3px;min-width:0">' +
      '<label style="font-size:12.5px;font-weight:800;color:#475569">' + lbl + '</label>' +
      '<input id="' + id + '" value="' + esc(val == null ? "" : String(val)) + '" placeholder="' + esc(ph) + '" style="padding:7px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:15px;font-weight:700;width:100%">' +
      (hint ? '<span style="font-size:11.5px;color:#94a3b8">' + hint + '</span>' : '') + '</div>';
  };
  let h = '<div style="background:#fff;border-radius:14px;max-width:760px;width:100%;box-shadow:0 18px 50px rgba(0,0,0,.3);overflow:hidden">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 16px;background:#0f766e;color:#fff">' +
    '<div style="font-size:18px;font-weight:800">' + (prov ? '⚙ Configurar — ' + esc(prov) : '⚙ Parámetros generales de importación') + '</div>' +
    '<button onclick="pedImpCfgCerrar()" style="background:#fff;color:#0f766e;border:0;border-radius:8px;padding:6px 16px;font-size:14.5px;font-weight:800;cursor:pointer">Cerrar</button></div>' +
    '<div style="padding:14px 16px">' +
    // v23.91 (Luis: "no entiendo por qué hay un general ahí y qué modifica esos") — los
    // generales salieron a su propio botón del módulo: acá sólo lo de ESTE proveedor.
    (prov ? '<div style="display:flex;gap:7px;margin-bottom:12px;flex-wrap:wrap">' + tabB("params", "Parámetros") + tabB("cods", "Códigos") + '</div>' : '');

  if (P.msg) h += '<div style="margin-bottom:10px;padding:7px 10px;border-radius:8px;font-size:12.5px;font-weight:700;background:' + (P.msg[0] === "!" ? "#fef2f2" : "#f0fdf4") + ';color:' + (P.msg[0] === "!" ? "#b91c1c" : "#166534") + '">' + esc(P.msg.replace(/^!/, "")) + '</div>';

  if (P.tab === "params") {
    h += '<div style="font-size:13px;color:#64748b;margin-bottom:10px">Lo que se deje <b>vacío</b> usa el valor general (el que aparece en gris). Los porcentajes van en <b>porcentaje</b>: 35 = 35%.</div>';
    h += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px">';
    h += '<div style="display:flex;flex-direction:column;gap:3px"><label style="font-size:11px;font-weight:800;color:#475569">Importador</label>' +
      '<input id="impCfgImportador" value="' + esc(r.importador || "") + '" placeholder="Chef / Tierra Nativa" style="padding:6px 9px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px"></div>';
    h += '<div style="display:flex;flex-direction:column;gap:3px"><label style="font-size:11px;font-weight:800;color:#475569">Factura vía NTL</label>' +
      '<label style="display:flex;align-items:center;gap:7px;font-size:13px;padding:6px 0"><input type="checkbox" id="impCfgNtl"' + (r.usa_ntl ? ' checked' : '') + '> le factura a NTL (comisión)</label></div>';
    h += campo("impCfgNtlPct", "Comisión NTL (%)", _impCfgPctTxt(r.ntl_pct_propio), _impCfgPctTxt(g.ntl_pct), "sobre el FOB · general " + _nacPct(g.ntl_pct) + "%");
    h += campo("impCfgDer", "Derechos (%)", _impCfgPctTxt(r.derechos_pct_propio), _impCfgPctTxt(g.derechos_pct), "sobre el CIF · general " + _nacPct(g.derechos_pct) + "%");
    h += campo("impCfgMeses", "Meses objetivo", r.meses_objetivo_propio == null ? "" : String(r.meses_objetivo_propio), String(g.meses_objetivo), "cuántos meses de venta se piden · general " + g.meses_objetivo);
    h += campo("impCfgM3", "Valor del m³ de flete (u$s)", r.valor_m3_propio == null ? "" : String(r.valor_m3_propio), String(g.valor_m3), "general " + _nacF(g.valor_m3));
    // v23.90 (Luis) — MOQ del proveedor y hasta cuántos meses de cobertura se admite estirar
    h += campo("impCfgMoq", "MOQ (unidades por código)", r.moq_propio == null ? "" : String(r.moq_propio), String(g.moq), "mínimo que la fábrica acepta · general " + _nacF(g.moq));
    h += campo("impCfgMoqMeses", "MOQ: tope de cobertura (meses)", r.moq_meses_max_propio == null ? "" : String(r.moq_meses_max_propio), String(g.moq_meses_max), "hasta acá se puede estirar · general " + g.moq_meses_max);
    h += '</div>';
    h += '<div style="margin-top:12px"><label style="font-size:11px;font-weight:800;color:#475569">Nota</label>' +
      '<input id="impCfgNotas" value="' + esc(r.notas || "") + '" style="padding:6px 9px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;width:100%"></div>';
    h += '<div style="display:flex;gap:8px;margin-top:14px;align-items:center;flex-wrap:wrap">' +
      '<button onclick="pedImpCfgGuardar()" style="background:#0f766e;color:#fff;border:0;border-radius:9px;padding:9px 20px;font-weight:800;font-size:15px;cursor:pointer"' + (P.guardando ? ' disabled' : '') + '>' + (P.guardando ? "Guardando…" : "💾 Guardar") + '</button>' +
      (r.actualizado ? '<span style="font-size:11px;color:#94a3b8">último cambio ' + esc(String(r.actualizado).slice(0, 16).replace("T", " ")) + (r.actualizado_por ? " · " + esc(r.actualizado_por) : "") + '</span>' : '') +
      '</div>';
  } else if (P.tab === "cods") {
    const arts = P.arts;
    if (arts == null) h += '<div style="padding:16px;color:#64748b">Cargando códigos…</div>';
    else {
      const mios = arts.filter(function (a) { return String(a.proveedor || "").trim() === prov; });
      const q = String(P.q || "").trim().toUpperCase();
      const otros = q ? arts.filter(function (a) { return String(a.proveedor || "").trim() !== prov && stkMatchBusq(q, a.cod, a.descripcion, false); }).slice(0, 40) : [];
      h += '<div style="display:flex;align-items:baseline;gap:8px;margin-bottom:6px"><span style="font-size:15px;font-weight:800;color:#0f172a">' + mios.length + ' código(s) de ' + esc(prov) + '</span>' +
        '<span style="font-size:12px;color:#94a3b8">% der. vacío = ' + _nacPct(_impProvNum(prov, "derechos_pct", g.derechos_pct)) + '% del proveedor</span></div>';
      h += '<div style="max-height:300px;overflow:auto;border:1px solid #e2e8f0;border-radius:9px;margin-bottom:12px">';
      h += mios.length ? mios.map(function (a) {
        // v23.90 (Luis) — los derechos, editables por artículo, acá mismo
        const _ac = _impCfgArt[String(a.cod).trim().toUpperCase()] || {};
        const _der = (_ac.derechos_pct == null) ? "" : _impCfgPctTxt(_ac.derechos_pct);
        return '<div style="display:flex;align-items:center;gap:8px;padding:6px 13px 6px 10px;border-bottom:1px solid #f1f5f9">' +
          '<b style="font-size:15px;min-width:74px">' + esc(String(a.cod)) + '</b>' +
          '<span style="font-size:13.5px;color:#475569;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(artNombre(a.cod, a.descripcion) || "—") + '</span>' +
          '<input value="' + esc(_der) + '" placeholder="' + _impCfgPctTxt(_impProvNum(prov, "derechos_pct", g.derechos_pct)) + '" onchange="pedImpCfgArtDer(\'' + encodeURIComponent(String(a.cod)) + '\',this.value)" title="Derechos de este artículo, en porcentaje (35 = 35%). Vacío = el del proveedor." style="width:62px;text-align:center;padding:4px 6px;border:1px solid ' + (_der ? '#0f766e' : '#cbd5e1') + ';border-radius:7px;font-size:14px;font-weight:800;background:' + (_der ? '#f0fdfa' : '#fff') + '">' +
          '<span style="font-size:12px;color:#94a3b8;font-weight:700">% der.</span>' +
          '<button onclick="pedImpCfgSacar(\'' + encodeURIComponent(String(a.cod)) + '\')" title="Sacarlo de ' + esc(prov) + ' (pide confirmación; no lo borra: queda sin proveedor)" style="background:#fee2e2;color:#b91c1c;border:0;border-radius:7px;padding:3px 10px;font-weight:800;font-size:13px;line-height:1.3;cursor:pointer">✕</button></div>';
      }).join("") : '<div style="padding:12px;color:#94a3b8;font-size:13.5px">Todavía no tiene códigos.</div>';
      h += '</div>';
      h += '<div style="font-size:15px;font-weight:800;color:#0f172a;margin-bottom:6px">Agregar un código</div>';
      h += '<input id="impCfgQ" value="' + esc(P.q || "") + '" oninput="pedImpCfgBuscar(this.value)" placeholder="Buscar código o descripción…" style="padding:7px 11px;border:1px solid #cbd5e1;border-radius:8px;font-size:15px;width:100%;margin-bottom:8px">';
      h += '<div style="max-height:240px;overflow:auto;border:1px solid #e2e8f0;border-radius:9px">';
      h += !q ? '<div style="padding:12px;color:#94a3b8;font-size:13.5px">Escribí un código o una descripción.</div>'
        : (otros.length ? otros.map(function (a) {
          const act = String(a.proveedor || "").trim();
          return '<div style="display:flex;align-items:center;gap:8px;padding:6px 13px 6px 10px;border-bottom:1px solid #f1f5f9">' +
            '<b style="font-size:15px;min-width:74px">' + esc(String(a.cod)) + '</b>' +
            '<span style="font-size:13.5px;color:#475569;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(artNombre(a.cod, a.descripcion) || "—") + '</span>' +
            (act ? '<span style="font-size:10.5px;font-weight:800;color:#b45309;background:#fffbeb;border-radius:999px;padding:1px 7px" title="Hoy es de ' + esc(act) + ': al agregarlo se lo saca de ahí">' + esc(act) + '</span>' : '') +
            '<button onclick="pedImpCfgCodigo(\'' + encodeURIComponent(String(a.cod)) + '\',\'' + encodeURIComponent(prov) + '\')" style="background:#dcfce7;color:#166534;border:0;border-radius:7px;padding:4px 13px;font-weight:800;font-size:15px;cursor:pointer">+</button></div>';
        }).join("") : '<div style="padding:12px;color:#94a3b8;font-size:13.5px">Sin resultados.</div>');
      h += '</div>';
    }
  } else {
    h += '<div style="font-size:13px;color:#64748b;margin-bottom:10px">Valen para <b>todos</b> los proveedores que no tengan el suyo propio, y para los artículos sin arancel propio. Los porcentajes en <b>porcentaje</b>: 21 = 21%.</div>';
    h += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px">';
    h += campo("impCfgGMeses", "Meses objetivo", String(g.meses_objetivo), "", "cuántos meses de venta se piden");
    h += campo("impCfgGDer", "Derechos (%)", _impCfgPctTxt(g.derechos_pct), "", "sobre el CIF");
    h += campo("impCfgGNtl", "Comisión NTL (%)", _impCfgPctTxt(g.ntl_pct), "", "sobre el FOB");
    h += campo("impCfgGIva", "IVA (%)", _impCfgPctTxt(g.iva_pct), "", "recuperable");
    h += campo("impCfgGIvaA", "IVA adicional (%)", _impCfgPctTxt(g.iva_adic_pct), "", "recuperable");
    h += campo("impCfgGGcias", "Ganancias (%)", _impCfgPctTxt(g.gcias_pct), "", "recuperable");
    h += campo("impCfgGIibb", "Ingresos Brutos (%)", _impCfgPctTxt(g.iibb_pct), "", "recuperable");
    h += campo("impCfgGEstad", "Estadística (%)", _impCfgPctTxt(g.estad_pct), "", "sobre el CIF");
    h += campo("impCfgGEstD", "Estadística: FOB desde", String(g.estad_fob_desde), "", "hasta acá, el %");
    h += campo("impCfgGEstH", "Estadística: FOB hasta", String(g.estad_fob_hasta), "", "en el tramo, el fijo");
    h += campo("impCfgGEstF", "Estadística: fijo (u$s)", String(g.estad_fijo), "", "en el tramo del medio");
    h += campo("impCfgGM3", "Valor del m³ (u$s)", String(g.valor_m3), "", "flete consolidado");
    h += campo("impCfgGFull", "Flete contenedor (u$s)", String(g.flete_full), "", "contenedor propio");
    h += campo("impCfgGMoq", "MOQ (unidades por código)", String(g.moq), "", "mínimo de la fábrica");
    h += campo("impCfgGMoqM", "MOQ: tope de cobertura (meses)", String(g.moq_meses_max), "", "hasta acá se estira");
    h += campo("impCfgGMoqP", "MOQ: mínimo a llegar (%)", _impCfgPctTxt(g.moq_pct != null ? g.moq_pct : 0.8), "", "si no se llega a este % del MOQ, no se pide");   // v24.56 (Thomas)
    h += campo("impCfgGAut", "Autorización de Impo (%)", _impCfgPctTxt(g.autoriz_impo_pct != null ? g.autoriz_impo_pct : 0.007), "", "sobre el FOB de lo que lleva INAL");   // v25.13 (Thomas)
    h += '</div>';
    h += '<div style="margin-top:14px"><button onclick="pedImpCfgGuardarGral()" style="background:#0f766e;color:#fff;border:0;border-radius:9px;padding:9px 20px;font-weight:800;font-size:15px;cursor:pointer"' + (P.guardando ? ' disabled' : '') + '>' + (P.guardando ? "Guardando…" : "💾 Guardar generales") + '</button></div>';
  }
  h += '</div></div>';
  ov.innerHTML = h;
  if (P.tab === "cods") { const qi = document.getElementById("impCfgQ"); if (qi && P.q) { qi.focus(); try { qi.setSelectionRange(qi.value.length, qi.value.length); } catch (_e) {} } }
}
/* Los % se muestran en PORCENTAJE y se guardan en TANTO POR UNO (la RPC rechaza > 1). */
function _impCfgPctVal(id) { const v = _impCfgNum(id); return v === "" ? null : (Number(v) / 100); }
async function _impCfgRpc(fn, cuerpo) {
  const h = await _scfgAuth();
  const r = await fetch(SUPABASE_URL + "/rest/v1/rpc/" + fn, { method: "POST", headers: Object.assign({}, h, { "Content-Type": "application/json" }), body: JSON.stringify(cuerpo) });
  if (!r.ok) {
    let t = ""; try { t = await r.text(); } catch (_e) {}
    let m = t; try { m = JSON.parse(t).message || t; } catch (_e2) {}
    throw new Error(m || ("HTTP " + r.status));
  }
  return r.json().catch(function () { return null; });
}
async function pedImpCfgGuardar() {
  if (!_impCfgPop || _impCfgPop.guardando) return;
  const prov = _impCfgPop.prov;
  const nEl = document.getElementById("impCfgNotas"), iEl = document.getElementById("impCfgImportador"), cEl = document.getElementById("impCfgNtl");
  const p = { proveedor: prov,
    importador: iEl ? iEl.value : null,
    usa_ntl: cEl ? !!cEl.checked : false,
    ntl_pct: _impCfgPctVal("impCfgNtlPct"),
    derechos_pct: _impCfgPctVal("impCfgDer"),
    meses_objetivo: _impCfgNum("impCfgMeses") === "" ? null : Number(_impCfgNum("impCfgMeses")),
    valor_m3: _impCfgNum("impCfgM3") === "" ? null : Number(_impCfgNum("impCfgM3")),
    moq: _impCfgNum("impCfgMoq") === "" ? null : Number(_impCfgNum("impCfgMoq")),
    moq_meses_max: _impCfgNum("impCfgMoqMeses") === "" ? null : Number(_impCfgNum("impCfgMoqMeses")),
    notas: nEl ? nEl.value : null };
  _impCfgPop.guardando = true; _impCfgPop.msg = ""; _impCfgRender();
  try {
    await _impCfgRpc("gv_imp_proveedor_guardar", { p: p });
    await _impCfgCargar();
    _impCfgPop.msg = "Guardado.";
    if (_stkPop && _stkPop.kind === "pedImp") _pedImpRender();
  } catch (e) { _impCfgPop.msg = "!No se pudo guardar: " + (e.message || e); }
  _impCfgPop.guardando = false; _impCfgRender();
}
async function pedImpCfgGuardarGral() {
  if (!_impCfgPop || _impCfgPop.guardando) return;
  const p = { meses_objetivo: Number(_impCfgNum("impCfgGMeses")),
    derechos_pct: _impCfgPctVal("impCfgGDer"), ntl_pct: _impCfgPctVal("impCfgGNtl"),
    iva_pct: _impCfgPctVal("impCfgGIva"), iva_adic_pct: _impCfgPctVal("impCfgGIvaA"),
    gcias_pct: _impCfgPctVal("impCfgGGcias"), iibb_pct: _impCfgPctVal("impCfgGIibb"),
    estad_pct: _impCfgPctVal("impCfgGEstad"),
    estad_fob_desde: Number(_impCfgNum("impCfgGEstD")), estad_fob_hasta: Number(_impCfgNum("impCfgGEstH")),
    estad_fijo: Number(_impCfgNum("impCfgGEstF")), valor_m3: Number(_impCfgNum("impCfgGM3")),
    flete_full: Number(_impCfgNum("impCfgGFull")),
    moq: Number(_impCfgNum("impCfgGMoq")), moq_meses_max: Number(_impCfgNum("impCfgGMoqM")), moq_pct: _impCfgPctVal("impCfgGMoqP"),
    autoriz_impo_pct: _impCfgPctVal("impCfgGAut") };
  _impCfgPop.guardando = true; _impCfgPop.msg = ""; _impCfgRender();
  try {
    await _impCfgRpc("gv_imp_nac_config_guardar", { p: p });
    await _impCfgCargar();
    _impCfgPop.msg = "Guardado.";
    if (_stkPop && _stkPop.kind === "pedImp") _pedImpRender();
  } catch (e) { _impCfgPop.msg = "!No se pudo guardar: " + (e.message || e); }
  _impCfgPop.guardando = false; _impCfgRender();
}
/* ══ v23.91 (Luis, 29/09) — EL DESGLOSE SE ABRE EN UN POP-UP ════════════════════════
   Adentro del chip lo hacía crecer y empujaba la tabla; y con el pedido de varios
   proveedores abiertos a la vez, la pantalla se volvía ilegible. La lógica de expandir
   cada concepto NO cambia: sigue siendo un <details> por renglón, ahora dentro del pop-up. */
function pedImpDesgPop(provEnc, lado) {
  const prov = decodeURIComponent(provEnc || "");
  const d = _pedImpDesgData[prov]; if (!d) return;
  const esDer = (lado === "der");
  if (!esDer) return;
  const cuerpo = _pedImpDesgDer(d.nac, d.totUsd, d.ext.m3);
  const titulo = esDer ? ('🚢 Puesto en Argentina — ' + prov) : ('⏳ Cuándo llega al mínimo — ' + prov);
  let ov = document.getElementById("impDesgOv");
  if (!ov) {
    ov = document.createElement("div"); ov.id = "impDesgOv";
    ov.setAttribute("style", "position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:99998;display:flex;align-items:flex-start;justify-content:center;padding:18px;overflow:auto");
    ov.addEventListener("click", function (ev) { if (ev.target === ov) pedImpDesgCerrar(); });
    document.body.appendChild(ov);
  }
  ov.innerHTML = '<div style="background:#fff;border-radius:14px;max-width:620px;width:100%;box-shadow:0 18px 50px rgba(0,0,0,.3);overflow:hidden">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 14px;background:#3730a3;color:#fff">' +
    '<div style="font-size:15px;font-weight:800">' + escapeHtml(titulo) + '</div>' +
    '<button onclick="pedImpDesgCerrar()" style="background:#fff;color:#3730a3;border:0;border-radius:8px;padding:4px 11px;font-weight:800;cursor:pointer">Cerrar</button></div>' +
    '<div style="padding:10px 14px 14px">' + cuerpo + '</div></div>';
}
/* v25.01 (Thomas, 30/09) — «12M»: el insumo se pide para 10 meses de insumo + 2 de producto. */
function _pedImpInsumoChip(it) {
  const mi = Number(it.meses) || 0, mp = Number(it.mesesProv) || 0;
  return ' <span class="pedimp-12m" style="font-size:10.5px;font-weight:800;color:#fff;background:#0369a1;border-radius:999px;padding:1px 6px" title="INSUMO (no es de ninguna empresa): se pide para ' + mp + ' meses de insumo + ' + (mi - mp) + ' meses de producto armado = ' + mi + ' meses de la Estadística Madre de los productos que lo usan">' + mi + 'M</span>';
}
/* v25.01 (Thomas, 30/09: "si aprieto en stock se abra el desglose de qué es lo que está contando") —
   el número de la columna Stock suma hasta cuatro fuentes; acá se ven una por una, con el detalle
   por insumo (gv_importados_stock_insumos) y por producto armado (vista_importados_partes). */
async function pedImpStockDesglose(keyEnc, foco) {
  const it = _pedImpItemPorClave(decodeURIComponent(keyEnc || "")); if (!it) return;
  const f = function (n) { return Math.round(Number(n) || 0).toLocaleString("es-AR"); };
  let ov = document.getElementById("impStkDesgOv");
  if (!ov) {
    ov = document.createElement("div"); ov.id = "impStkDesgOv";
    ov.setAttribute("style", "position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:99998;display:flex;align-items:flex-start;justify-content:center;padding:18px;overflow:auto");
    ov.addEventListener("click", function (ev) { if (ev.target === ov) pedImpStockDesgCerrar(); });
    document.body.appendChild(ov);
  }
  /* v25.71 (Luis, 01/10): más grande y con el CÓDIGO del componente de Cervantes (GRJ31), que sale de
     GV_Importados_Equiv_GP2. Sin esa fila se ve como antes. v26.00: un importado puede tener VARIOS
     componentes (942E = Z47 + Z47-M505D + 942E) y se listan todos. */
  let equiv = null, conv = null, insDetG = null, insErrG = false;
  const pintar = function (insDet, insErr) {
    if (insDet !== undefined) { insDetG = insDet; insErrG = !!insErr; } else { insDet = insDetG; insErr = insErrG; }
    const tr = function (a, b, c) { return '<tr><td style="text-align:left;padding:8px 10px">' + a + '</td><td class="num" style="padding:8px 10px;font-weight:700">' + b + '</td><td style="text-align:left;color:#475569;font-size:14px;padding:8px 10px">' + (c || "") + '</td></tr>'; };
    let h = '';
    if (foco !== "proy") {
      h += '<table class="mva-tbl imp-stk-desg" style="width:100%;font-size:16px"><thead><tr><th style="text-align:left;font-size:13px">Qué cuenta</th><th class="num" style="font-size:13px">u</th><th style="text-align:left;font-size:13px">De dónde</th></tr></thead><tbody>';
      h += tr('Stock propio del artículo', f(it.stockPropioModulo), 'depósitos de Virgilio' + (it.uniPedidas > 0 ? ', ya descontadas ' + f(it.uniPedidas) + ' u de pedidos abiertos' : ''));
      if (insErr) h += tr('Depósito insumos', f(it.stockInsU), '<span style="color:#b91c1c">no se pudo leer el detalle</span>');
      else if (insDet && insDet.length) insDet.forEach(function (d) { if (Number(d.saldo) || Number(d.uni)) h += tr('🧰 Insumo ' + escapeHtml(d.insumo), f(d.uni), escapeHtml(f(d.saldo) + ' ' + (d.unidad || '') + (Number(d.factor) > 1 ? ' × ' + f(d.factor) : ''))); });
      else h += tr('Depósito insumos', f(it.stockInsU), '');
      if (it.stockTermU > 0) h += tr('🧩 Productos ya armados', f(it.stockTermU), 'stock de los terminados que usan ' + (it.esInsumo ? 'este insumo' : 'esta parte') + ' (detalle abajo)');
      if (it.stockGp2U > 0 || equiv) {
        const fac = equiv && equiv.length === 1 ? Number(equiv[0].factor) || 1 : 1;
        const comp = equiv ? equiv.map(function (e) { return escapeHtml(e.componente_codigo); }).join(' + ') : '';
        h += tr('🏭 Cervantes (GP2)' + (comp ? ' · <b class="imp-gp2-cod" style="font-size:17px;color:#b45309">' + comp + '</b>' : ''), f(it.stockGp2U),
          (comp ? 'stock de <b>' + comp + '</b> en Cervantes (sector, talleristas y PS)' : 'componente equivalente en GP2: sector, talleristas y PS') +
          (fac !== 1 && it.stockGp2U > 0 ? ' · le toca el <b>' + Math.round(fac * 100) + ' %</b> de ' + f(it.stockGp2U / fac) + ' u' : ''));
      }
      if (it.stockConvU > 0 || conv) {
        const cc = conv ? conv.map(function (e) { return escapeHtml(e.cod_art + ' ' + e.empresa); }).join(' + ') : '';
        h += tr('🔁 Se convierte' + (cc ? ' · <b class="imp-conv-cod" style="font-size:17px;color:#7c3aed">' + cc + '</b>' : ''), f(it.stockConvU || 0),
          'stock disponible en Virgilio de ' + (cc ? '<b>' + cc + '</b>' : 'otro código') + ', que se puede convertir en este');
      }
      if (it.stockParteU > 0) h += tr('🔧 Parte ' + escapeHtml(it.stockParteCods || ''), f(it.stockParteU), 'el stock de la parte cuenta como stock de este artículo');
      h += '</tbody><tfoot><tr><th style="text-align:left;padding:8px 10px;font-size:16px">Total</th><th class="num" style="padding:8px 10px;font-size:18px">' + f(it.stockUni) + '</th><th></th></tr></tfoot></table>';
    }
    const det = it.parteDet || [];
    if (det.length) {
      let tp = 0, ts = 0;
      h += '<div style="margin-top:12px;font-weight:800">' + (it.esInsumo ? '🧩 Productos armados con este insumo' : '🧩 Terminados que usan esta parte') + '</div>';
      h += '<table class="mva-tbl" style="width:100%"><thead><tr><th style="text-align:left">Producto</th><th class="num">E.M. u/mes</th><th class="num">Stock u</th></tr></thead><tbody>';
      det.slice().sort(function (a, b) { return (Number(b.proy) || 0) - (Number(a.proy) || 0); }).forEach(function (d) {
        tp += Number(d.proy) || 0; ts += Number(d.stock_uni) || 0;
        h += '<tr><td style="text-align:left">' + escapeHtml(codCanon(d.cod)) + ' <span style="color:#64748b">' + escapeHtml(artNombre(d.cod, "")) + '</span></td><td class="num">' + f(d.proy) + '</td><td class="num">' + f(d.stock_uni) + '</td></tr>';
      });
      h += '</tbody><tfoot><tr><th style="text-align:left">Total</th><th class="num">' + f(tp) + '</th><th class="num">' + f(ts) + '</th></tr></tfoot></table>';
      if (it.esInsumo) h += '<div style="margin-top:8px;color:#475569;font-size:13px">Objetivo = ' + f(it.proyUni) + ' u/mes × ' + it.meses + ' meses (' + it.mesesProv + ' de insumo + ' + (it.meses - it.mesesProv) + ' de producto) = <b>' + f(it.objetivoUni) + ' u</b>.</div>';
    }
    ov.innerHTML = '<div style="background:#fff;border-radius:14px;max-width:760px;width:100%;box-shadow:0 18px 50px rgba(0,0,0,.3);overflow:hidden">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 16px;background:#0369a1;color:#fff">' +
      '<div style="font-size:19px;font-weight:800">' + (foco === "proy" ? '📈 Estadística Madre — ' : '📦 Stock — ') + escapeHtml(codCanon(_impCodVista(it))) + (it.esInsumo ? ' · insumo' : '') +
        (equiv ? ' <span class="imp-gp2-hdr" style="font-size:15px;font-weight:700;background:#fff;color:#b45309;border-radius:8px;padding:2px 8px;margin-left:6px">🏭 ' + equiv.map(function (e) { return escapeHtml(e.componente_codigo); }).join(' + ') + ' en Cervantes</span>' : '') + '</div>' +
      '<button onclick="pedImpStockDesgCerrar()" style="width:auto;margin-top:0;background:#fff;color:#0369a1;border:0;border-radius:8px;padding:4px 11px;font-size:14px;font-weight:800;cursor:pointer">Cerrar</button></div>' +
      '<div style="padding:10px 14px 14px">' + h + '</div></div>';
  };
  pintar(null, false);
  if (foco !== "proy") {
    /* v26.86 (Luis, 05/10): el componente de GP2 con el MISMO código (323E en GP2 = el artículo terminado)
       también suma, factor 1 (≡ gv_importados_ordenes, lateral e_mismo). No en un dual (it.planta): la
       vista tampoco lo suma ahí. */
    Promise.all([
      supaFetchAllSafe(SUPABASE_URL + "/rest/v1/GV_Importados_Equiv_GP2", "select=componente_codigo,factor&importado_cod=eq." + encodeURIComponent(it.cod)).catch(function () { return null; }),
      it.planta ? Promise.resolve(null) : supaFetchAllSafe(SUPABASE_URL + "/rest/v1/gv_gp2_stock_componente", "select=codigo&codigo=ilike." + encodeURIComponent(it.cod)).catch(function () { return null; })
    ]).then(function (rs) {
      const e = (rs[0] || []).slice(), mismo = rs[1] || [];
      const C = String(it.cod).toUpperCase().trim();
      if (mismo.length && !e.some(function (x) { return String(x.componente_codigo).toUpperCase().trim() === C; }))
        e.push({ componente_codigo: mismo[0].codigo, factor: 1 });
      if (e.length && document.getElementById("impStkDesgOv")) { equiv = e; pintar(); }
    });
    // v26.03 (Luis, D23) — stock de OTRO código de Virgilio que se convierte en éste (102E LK → 702E)
    supaFetchAllSafe(SUPABASE_URL + "/rest/v1/GV_Importados_Equiv_Virgilio", "select=cod_art,empresa&importado_cod=eq." + encodeURIComponent(it.cod))
      .then(function (r) { if (r && r.length && document.getElementById("impStkDesgOv")) { conv = r; pintar(); } })
      .catch(function () { /* sin el código se ve como antes */ });
  }
  if (foco === "proy" || !(it.stockInsU > 0)) return;
  try {
    const r = await supaFetchAllSafe(SUPABASE_URL + "/rest/v1/gv_importados_stock_insumos", "select=detalle&cod=eq." + encodeURIComponent(it.cod));
    if (document.getElementById("impStkDesgOv")) pintar((r && r[0] && r[0].detalle) || [], false);
  } catch (_e) { if (document.getElementById("impStkDesgOv")) pintar(null, true); }
}
function pedImpStockDesgCerrar() { const o = document.getElementById("impStkDesgOv"); if (o) o.remove(); }
function pedImpDesgCerrar() { const o = document.getElementById("impDesgOv"); if (o) o.remove(); }

/* v23.91 — los parámetros GENERALES, en su propio botón del módulo (no adentro del ⚙ de un
   proveedor, donde no se entendía a quién modificaban). Reusa el mismo pop-up, sin proveedor. */
function pedImpCfgGralAbrir() {
  _impCfgPop = { prov: "", tab: "gral", q: "", arts: null, guardando: false, msg: "" };
  _impCfgRender();
}
/* v23.91 — sacar un código pide confirmación: es el maestro, y el ✕ quedaba al lado del input. */
function pedImpCfgSacar(codEnc) {
  if (!_impCfgPop) return;
  const cod = decodeURIComponent(codEnc || "");
  let ok = false;
  try { ok = confirm("¿Sacar " + cod + " de " + _impCfgPop.prov + "?\n\nEl artículo NO se borra: queda sin proveedor y deja de figurar en el pedido de " + _impCfgPop.prov + "."); } catch (_e) { ok = false; }
  if (!ok) return;
  return pedImpCfgCodigo(codEnc, "");
}

/* v23.90 (Luis) — los derechos de UN artículo. Vacío = vuelve al % del proveedor. */
async function pedImpCfgArtDer(codEnc, valor) {
  if (!_impCfgPop) return;
  const cod = decodeURIComponent(codEnc || "");
  const v = String(valor == null ? "" : valor).trim().replace(",", ".");
  const pct = (v === "") ? null : (Number(v) / 100);
  if (pct != null && (!isFinite(pct) || pct < 0 || pct > 1)) {
    _impCfgPop.msg = "!El % de derechos va entre 0 y 100."; _impCfgRender(); return;
  }
  _impCfgPop.msg = "";
  try {
    await _impCfgRpc("gv_imp_articulo_derechos", { p_cod: cod, p_pct: pct });
    await _impCfgCargar();
    _impCfgPop.msg = (pct == null) ? (cod + ": vuelve al % del proveedor.") : (cod + ": derechos " + v + "%.");
    if (_stkPop && _stkPop.kind === "pedImp") _pedImpRender();
  } catch (e) { _impCfgPop.msg = "!No se pudo guardar: " + (e.message || e); }
  _impCfgRender();
}
async function pedImpCfgCodigo(codEnc, provEnc) {
  if (!_impCfgPop) return;
  const cod = decodeURIComponent(codEnc || ""), prov = decodeURIComponent(provEnc || "");
  const a = (_impCfgPop.arts || []).find(function (x) { return String(x.cod) === cod; });
  const prev = a ? a.proveedor : null;
  if (a) a.proveedor = prov || null;      // optimista
  _impCfgPop.msg = ""; _impCfgRender();
  try {
    await _impCfgRpc("gv_imp_codigo_proveedor", { p_cod: cod, p_proveedor: prov || null });
    await _impCfgCargar();
    _impCfgPop.msg = prov ? (cod + " ahora es de " + prov + ".") : (cod + " quedó sin proveedor.");
  } catch (e) { if (a) a.proveedor = prev; _impCfgPop.msg = "!No se pudo guardar: " + (e.message || e); }
  _impCfgRender();
}
async function openPedidosImportacion() {
  _stkPopShell("📦 Pedidos Importación", "stkPopBody", true);
  const body = document.getElementById("stkPopBody"); if (!body) return;
  body.innerHTML = '<div class="stkpop-empty">Calculando pedidos de importación…</div>';
  let data = { items: [], meses: 10 };
  // v23.89 — la config de importados (por proveedor y general) sale de la BASE, no del front
  await _impCfgCargar();
  try { data = await ocgFetchImportados(); } catch (_e) {}
  // Fecha estimada de entrega global (Stock_Config) — la muestra el carrito de LK.
  // v22.37 — y en la misma tirada: el mínimo por proveedor (25k default) y los parámetros
  // de nacionalización guardados (modo / valor m³ flete), todos con default si no hay fila.
  try {
    const cfg = await supaFetchAllSafe(SUPABASE_URL + "/rest/v1/Stock_Config", "select=clave,valor&clave=in.(entrega_estimada_global,impo_nac_modo,impo_nac_valor_m3)");
    const _cfgMap = {}; (cfg || []).forEach(function (r) { _cfgMap[r.clave] = r.valor; });
    data.entregaGlobal = _cfgMap.entrega_estimada_global ? String(_cfgMap.entrega_estimada_global).slice(0, 10) : "";
    data.nac = { modo: (_cfgMap.impo_nac_modo || _NAC_DEFAULTS.modo), valorM3: _nacNum(_cfgMap.impo_nac_valor_m3, _NAC_DEFAULTS.valorM3), tn: 0 };
  } catch (_e) { data.entregaGlobal = ""; data.nac = { modo: _NAC_DEFAULTS.modo, valorM3: _NAC_DEFAULTS.valorM3, tn: 0 }; }
  _stkPop = { kind: "pedImp", data: data, soloPedir: true };
  _pedImpRender();
  _impCervDenRepintar();   // v25.37 — el chip «Denegado por Cervantes» llega después, sin frenar la pantalla
}
/* v22.37 — guarda un parámetro de nacionalización / el mínimo en Stock_Config y re-renderiza.
   clave: 'impo_nac_modo' | 'impo_nac_valor_m3'. */
async function pedImpSetNacCfg(clave, valor) {
  if (!_stkPop || _stkPop.kind !== "pedImp") return;
  var v = String(valor == null ? "" : valor).trim();
  // reflejo inmediato en memoria (no esperamos al backend para pintar)
  if (clave === "impo_nac_modo") _stkPop.data.nac.modo = v || _NAC_DEFAULTS.modo;
  else if (clave === "impo_nac_valor_m3") _stkPop.data.nac.valorM3 = _nacNum(v, _NAC_DEFAULTS.valorM3);
  _pedImpRender();
  try {
    await fetch(SUPABASE_URL + "/rest/v1/Stock_Config?on_conflict=clave", {
      method: "POST",
      headers: { ...(await _scfgAuth()), "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ clave: clave, valor: v })
    });
  } catch (_e) {}
}
function pedImpSetNacTn(v) { if (!_stkPop || _stkPop.kind !== "pedImp") return; _stkPop.data.nac.tn = _nacNum(v, 0); _pedImpRender(); }
/* v10.38 — filtro Solo Pedido / Ver Todo. */
function pedImpSetFiltro(solo) { if (!_stkPop || _stkPop.kind !== "pedImp") return; _stkPop.soloPedir = !!solo; _pedImpRender(); }
/* Filtro por PROVEEDOR: "" = todas las tarjetas (un box por proveedor), o el nombre de un proveedor = solo ese box. */
function pedImpSetProv(provEnc) { if (!_stkPop || _stkPop.kind !== "pedImp") return; _stkPop.provFiltro = decodeURIComponent(provEnc || ""); _pedImpRender(); }
function pedImpToggle() { if (!_stkPop || _stkPop.kind !== "pedImp") return; _stkPop.soloPedir = !_stkPop.soloPedir; _pedImpRender(); }
/* v22.09 — BUSCADOR POR CÓDIGO. Reusa el matcher del módulo Stock (`stkMatchBusq`), así que
   vale la misma regla: un término que arranca con DÍGITO es un CÓDIGO y va por PREFIJO de la
   grafía que se MUESTRA (v21.09: "30" trae el 307, no el 030); si no arranca con dígito es
   texto libre y busca por pedazo en la descripción y en el proveedor. Varios términos,
   separados por espacio o coma (026 031 508).
   ⚠ BUSCANDO NO SE ESCONDE NADA: el término gana sobre "Solo Pedido" y sobre el filtro de
   proveedor, y barre TODOS los ítems, pidan o no. Es la regla v20.95: una fila que no sale no
   se distingue de un código que no existe, y el 0 es la respuesta, no un motivo para callarse. */
function pedImpSetQ(v) { if (!_stkPop || _stkPop.kind !== "pedImp") return; _stkPop.q = String(v == null ? "" : v); _pedImpRender(); }
function pedImpQTerms() { return String((_stkPop && _stkPop.q) || "").trim().split(/[\s,]+/).filter(Boolean); }
function pedImpMatch(it, terms) {
  if (!terms || !terms.length) return true;
  var cod = codCanon(it.cod);
  var libre = (cod + " " + (artNombre(it.cod, it.desc) || "") + " " + (it.desc || "") + " " + (it.prov || "")).toLowerCase();
  return terms.some(function (t) { return stkMatchBusq(t, cod, libre, false); });
}
/* v14.78 — "Cargar pedido ya hecho" (pedido emitido por fuera, plataforma externa) en UN solo
   pop-up, en vez de la cadena de prompt() de la v14.77. El pop-up pide:
     1) PROVEEDOR chino  ·  2) FECHA estimada de entrega
     3) los renglones, de dos maneras (pestañas):
        (a) "Elegir de la lista": los artículos de ese proveedor, se tipea UNIDADES por fila.
        (b) "Escribir": una línea por artículo, "código unidades" (se puede pegar del Excel).
   En las dos, las unidades se reconvierten EN VIVO a CAJAS (inner, uni_x_caja) y a MASTER CAJAS
   (uni_master de Importados_Volumen). Al guardar: las unidades se SUMAN a Importados.pedido_curso
   (RPC importados_set_curso, así el motor no vuelve a pedir lo ya pedido) y la fecha va a
   Importados.reingreso_est (la lee el portal LK). */
var _pedHecho = null;
var PED_HECHO_CSS =
  "#pedHechoOv{display:none;position:fixed;inset:0;z-index:1310;background:rgba(2,6,23,.78);overflow:auto;padding:14px;}" +
  "#pedHechoOv.show{display:block;}" +
  ".phc-card{background:#f8fafc;max-width:min(720px,96vw);margin:0 auto;border-radius:16px;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.55);}" +
  ".phc-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 15px;background:linear-gradient(90deg,#92400e,#b45309);color:#fff;}" +
  ".phc-head b{font-size:16px;font-weight:800;}" +
  ".phc-x{background:rgba(255,255,255,.22);color:#fff;border:none;border-radius:8px;padding:6px 12px;font-size:13px;font-weight:800;cursor:pointer;width:auto;margin:0;}" +
  ".phc-body{padding:12px 14px;max-height:calc(100vh - 120px);overflow:auto;}" +
  ".phc-row{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px;}" +
  ".phc-f{display:flex;flex-direction:column;gap:4px;min-width:180px;}" +
  ".phc-f label{font-size:11px;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:.4px;}" +
  ".phc-f select,.phc-f input{height:38px;border:1.5px solid #cbd5e1;border-radius:9px;padding:0 10px;font-size:14px;background:#fff;box-sizing:border-box;margin:0;width:auto;}" +
  ".phc-f select:focus,.phc-f input:focus{border-color:#b45309;outline:none;}" +
  ".phc-tabs{display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;}" +
  ".phc-tab{width:auto;margin:0;padding:7px 13px;border:1px solid #cbd5e1;border-radius:999px;background:#fff;color:#334155;font-size:13px;font-weight:800;cursor:pointer;}" +
  ".phc-tab.on{background:#b45309;border-color:#b45309;color:#fff;}" +
  ".phc-tbl{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;}" +
  ".phc-tbl th{font-size:10.5px;text-transform:uppercase;letter-spacing:.3px;color:#64748b;font-weight:800;padding:7px 6px;border-bottom:2px solid #e2e8f0;text-align:left;white-space:nowrap;}" +
  ".phc-tbl td{padding:5px 6px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#0f172a;vertical-align:middle;}" +
  ".phc-tbl .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;}" +
  ".phc-tbl tr.on td{background:#fffbeb;}" +
  ".phc-cod{font-weight:800;font-family:Consolas,Menlo,monospace;}" +
  ".phc-uni{width:96px;height:32px;border:1.5px solid #cbd5e1;border-radius:8px;padding:0 7px;font-size:13px;text-align:right;margin:0;box-sizing:border-box;}" +
  ".phc-uni:focus{border-color:#b45309;outline:none;}" +
  ".phc-ta{width:100%;min-height:120px;border:1.5px solid #cbd5e1;border-radius:10px;padding:9px 10px;font-size:13.5px;font-family:Consolas,Menlo,monospace;box-sizing:border-box;resize:vertical;}" +
  ".phc-ta:focus{border-color:#b45309;outline:none;}" +
  ".phc-hint{font-size:11.5px;color:#64748b;line-height:1.45;margin:6px 0 10px;}" +
  ".phc-scroll{max-height:44vh;overflow:auto;border-radius:10px;}" +
  ".phc-bad{color:#b91c1c;font-weight:800;}" +
  ".phc-warn{color:#b45309;font-weight:700;}" +
  ".phc-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:11px 14px;background:#fff;border-top:1px solid #e2e8f0;}" +
  ".phc-tot{font-size:13px;color:#334155;}" +
  ".phc-tot b{color:#0f172a;}" +
  ".phc-btn{width:auto;margin:0;padding:9px 16px;border-radius:10px;border:1px solid #cbd5e1;background:#fff;color:#334155;font-size:14px;font-weight:800;cursor:pointer;}" +
  ".phc-btn.go{background:#166534;border-color:#166534;color:#fff;}" +
  ".phc-btn[disabled]{opacity:.5;cursor:not-allowed;}" +
  "@media(max-width:600px){.phc-desc{display:none;}.phc-uni{width:74px;}.phc-tbl th{white-space:normal;font-size:9.5px;}.phc-tbl th,.phc-tbl td{padding-left:4px;padding-right:4px;}}";

function _pedHechoNorm(s) { s = String(s == null ? "" : s).toUpperCase().replace(/\s+/g, ""); return { raw: s, z: s.replace(/^0+/, "") }; }
function _pedHechoItem(cod) {
  var data = (_stkPop && _stkPop.data) || { items: [] };
  var t = _pedHechoNorm(cod); if (!t.raw) return null;
  var hits = (data.items || []).filter(function (x) { var c = _pedHechoNorm(x.cod); return c.raw === t.raw || (!!t.z && c.z === t.z); });
  // v22.93 — 809E viene en dos líneas (LK / CH): para cargar un pedido se ve como UN artículo con dos marcas,
  // así el flujo de siempre pide la marca ("809E CH 1224") y el bache cae en la fila correcta.
  if (hits.length > 1 && hits.every(function (x) { return x.cod === hits[0].cod && x.planta; })) {
    return Object.assign({}, hits[0], { key: hits[0].cod, planta: "", det: hits.reduce(function (a, x) { return a.concat(x.det || []); }, []) });
  }
  return hits[0] || null;
}
function _pedHechoNum(v) { var n = parseInt(String(v == null ? "" : v).replace(/[^\d]/g, ""), 10); return (n > 0) ? n : 0; }
function _pedHechoFmt(n) { return Number(n || 0).toLocaleString("es-AR"); }
/* uni → cajas / master cajas. Devuelve el texto listo (con ⚠ si no entra justo). */
function _pedHechoDiv(uni, porUnidad) {
  if (!(porUnidad > 0)) return '<span style="color:#94a3b8">—</span>';
  if (!(uni > 0)) return "0";
  var q = uni / porUnidad;
  if (Math.abs(q - Math.round(q)) < 1e-9) return _pedHechoFmt(Math.round(q));
  return '<span class="phc-warn" title="No entra justo: ' + _pedHechoFmt(uni) + ' u ÷ ' + _pedHechoFmt(porUnidad) + '">' + (Math.round(q * 100) / 100).toLocaleString("es-AR") + ' ⚠</span>';
}
/* v15.00 — un artículo puede comprarse por LK o por CH (437E/438E: dos filas en Importados
   con el mismo proveedor). Antes el popup tomaba la primera fila sin preguntar y el bache
   podía caer en la marca equivocada. Ahora: filas del proveedor elegido y sus marcas. */
function _pedHechoDetsProv(it) {
  var st = _pedHecho; var dets = (it && it.det) || [];
  if (!st || !st.prov) return dets;
  var d = dets.filter(function (x) { return String(x.prov || "").trim() === st.prov; });
  return d.length ? d : dets;
}
function _pedHechoMarcas(it) {
  var m = [];
  _pedHechoDetsProv(it).forEach(function (d) { var k = String(d.marca || "").trim().toUpperCase(); if (k && m.indexOf(k) < 0) m.push(k); });
  return m;
}
/* Fila de Importados que recibe el bache: la del proveedor elegido y, si hay más de una
   marca, la de la marca pedida. */
function _pedHechoDet(it, marca) {
  var dets = _pedHechoDetsProv(it);
  if (marca) { var d = dets.find(function (x) { return String(x.marca || "").trim().toUpperCase() === marca; }); return d || null; }
  return dets[0] || null;
}
/* Renglones efectivos según el modo: [{key, cod, marca, it, det, uni, err}]
   key = "cod" o "cod|MARCA" cuando el artículo tiene más de una marca. */
function _pedHechoLineas() {
  var st = _pedHecho; if (!st) return [];
  var mk = function (cod, marca, uni) {
    var it = _pedHechoItem(cod);
    if (!it) return { key: cod, cod: cod, marca: marca, it: null, det: null, uni: uni, err: "Código no está en importados" };
    var marcas = _pedHechoMarcas(it);
    var m = marca || (marcas.length === 1 ? marcas[0] : "");
    if (marcas.length > 1 && !m) return { key: it.cod, cod: it.cod, marca: "", it: it, det: null, uni: uni, err: it.cod + " se compra por " + marcas.join(" o ") + ": escribí " + it.cod + " " + marcas[0] + " " + (uni || 1000) };
    if (m && marcas.length && marcas.indexOf(m) < 0) return { key: it.cod + "|" + m, cod: it.cod, marca: m, it: it, det: null, uni: uni, err: "Marca " + m + " no existe para " + it.cod + " (" + marcas.join("/") + ")" };
    var det = _pedHechoDet(it, marcas.length > 1 ? m : "");
    return { key: marcas.length > 1 ? (it.cod + "|" + m) : it.cod, cod: it.cod, marca: m, it: it, det: det, uni: uni, err: det ? (uni > 0 ? "" : "Unidades en 0") : "Sin fila de importado para ese proveedor" };
  };
  if (st.modo === "texto") {
    var out = [];
    String(st.texto || "").split(/\r?\n/).forEach(function (ln) {
      var s = ln.trim(); if (!s) return;
      var m = s.match(/^([A-Za-z0-9._\-]+)(?:[\s\/]+(LK|CH))?[\s,;:\t]+([\d.,]+)\s*$/i);
      if (!m) { out.push({ key: s, cod: s, marca: "", it: null, det: null, uni: 0, err: "No entendí la línea (usá: código unidades — o código LK/CH unidades)" }); return; }
      out.push(mk(m[1].toUpperCase(), String(m[2] || "").toUpperCase(), _pedHechoNum(m[3])));
    });
    return out;
  }
  var arr = [];
  Object.keys(st.sel || {}).forEach(function (key) {
    var uni = _pedHechoNum(st.sel[key]); if (!(uni > 0)) return;
    var p = String(key).split("|");
    arr.push(mk(p[0], String(p[1] || "").toUpperCase(), uni));
  });
  return arr;
}
function _pedHechoTotales() {
  var ls = _pedHechoLineas().filter(function (l) { return l.det && l.uni > 0; });
  var u = 0, mc = 0, cj = 0;
  ls.forEach(function (l) {
    u += l.uni;
    if (l.it.uniMaster > 0) mc += l.uni / l.it.uniMaster;
    if (l.it.uxc > 0) cj += l.uni / l.it.uxc;
  });
  return { n: ls.length, uni: u, mc: mc, cajas: cj };
}
function pedImpCargarPedidoHecho() {
  var data = (_stkPop && _stkPop.data) || { items: [] };
  if (!(data.items || []).length) { try { alert("Todavía no cargaron los importados."); } catch (_e) {} return; }
  var provs = [];
  (data.items || []).forEach(function (it) { var p = it.prov || "(sin proveedor)"; if (provs.indexOf(p) < 0) provs.push(p); });
  provs.sort(function (a, b) { return String(a).localeCompare(String(b)); });
  var pre = (_stkPop && _stkPop.provFiltro && provs.indexOf(_stkPop.provFiltro) >= 0) ? _stkPop.provFiltro : "";
  _pedHecho = { provs: provs, prov: pre, fecha: (data.entregaGlobal || ""), ref: "", embarque: "", modo: "lista", sel: {}, texto: "", q: "", guardando: false };
  if (!document.getElementById("pedHechoCss")) { var st = document.createElement("style"); st.id = "pedHechoCss"; st.textContent = PED_HECHO_CSS; document.head.appendChild(st); }
  var ov = document.getElementById("pedHechoOv");
  if (!ov) { ov = document.createElement("div"); ov.id = "pedHechoOv"; document.body.appendChild(ov); }
  ov.classList.add("show");
  _pedHechoRender();
}
function pedHechoCerrar() { var ov = document.getElementById("pedHechoOv"); if (ov) ov.classList.remove("show"); _pedHecho = null; }
function pedHechoSetProv(v) { if (!_pedHecho) return; _pedHecho.prov = v || ""; _pedHechoRender(); }
function pedHechoSetFecha(v) { if (!_pedHecho) return; _pedHecho.fecha = String(v || ""); }
/* v15.85 — el PI agrupa las líneas como UN pedido en la solapa 🚢 En curso, y el embarque es el
   día que sale de China (la fecha de entrega de arriba es la de llegada). */
function pedHechoSetRef(v) { if (!_pedHecho) return; _pedHecho.ref = String(v == null ? "" : v).trim(); }
function pedHechoSetEmbarque(v) { if (!_pedHecho) return; _pedHecho.embarque = String(v || ""); }
function pedHechoSetModo(m) { if (!_pedHecho) return; _pedHecho.modo = m; _pedHechoRender(); }
function pedHechoBuscar(v) { if (!_pedHecho) return; _pedHecho.q = String(v || ""); _pedHechoRenderCuerpo(true); }
/* Tipeo de unidades en el modo LISTA: NO re-renderiza (perdería el foco); actualiza sólo las
   celdas de cajas / master cajas de esa fila y el pie de totales. */
function pedHechoSetUni(keyEnc, val, idx) {
  if (!_pedHecho) return;
  var key = decodeURIComponent(keyEnc);   // "cod" o "cod|MARCA" (v15.00)
  var uni = _pedHechoNum(val);
  if (uni > 0) _pedHecho.sel[key] = uni; else delete _pedHecho.sel[key];
  var it = _pedHechoItem(String(key).split("|")[0]);
  var cj = document.getElementById("phCj" + idx), mc = document.getElementById("phMc" + idx), tr = document.getElementById("phTr" + idx);
  if (cj && it) cj.innerHTML = _pedHechoDiv(uni, it.uxc);
  if (mc && it) mc.innerHTML = _pedHechoDiv(uni, it.uniMaster);
  if (tr) { if (uni > 0) tr.classList.add("on"); else tr.classList.remove("on"); }
  _pedHechoPie();
}
function pedHechoSetTexto(v) { if (!_pedHecho) return; _pedHecho.texto = String(v == null ? "" : v); _pedHechoPreview(); _pedHechoPie(); }
function _pedHechoPie() {
  var el = document.getElementById("phFoot"); if (!el || !_pedHecho) return;
  var t = _pedHechoTotales();
  var ok = !!_pedHecho.prov && t.n > 0 && !_pedHecho.guardando;
  el.innerHTML =
    '<div class="phc-tot">' + (t.n ? ('<b>' + t.n + '</b> artículo(s) · <b>' + _pedHechoFmt(t.uni) + '</b> u · <b>' + (Math.round(t.cajas * 100) / 100).toLocaleString("es-AR") + '</b> cajas · <b>' + (Math.round(t.mc * 100) / 100).toLocaleString("es-AR") + '</b> master cajas') : 'Cargá al menos un artículo con unidades.') + '</div>' +
    '<div style="display:flex;gap:8px"><button class="phc-btn" onclick="pedHechoCerrar()">Cancelar</button>' +
    '<button class="phc-btn go" ' + (ok ? '' : 'disabled') + ' onclick="pedHechoGuardar()">' + (_pedHecho.guardando ? '⏳ Guardando…' : '✅ Guardar pedido') + '</button></div>';
}
function _pedHechoRender() {
  var ov = document.getElementById("pedHechoOv"); if (!ov || !_pedHecho) return;
  var st = _pedHecho;
  var opts = '<option value="">— Elegí —</option>' + st.provs.map(function (p) { return '<option value="' + escapeHtml(p) + '"' + (p === st.prov ? ' selected' : '') + '>' + escapeHtml(p) + '</option>'; }).join("");
  ov.innerHTML =
    '<div class="phc-card"><div class="phc-head"><b>➕ Cargar pedido ya hecho</b><button class="phc-x" onclick="pedHechoCerrar()">Cerrar</button></div>' +
    '<div class="phc-body">' +
      '<div class="phc-row">' +
        '<div class="phc-f" style="flex:1 1 240px"><label>🏭 Proveedor</label><select onchange="pedHechoSetProv(this.value)">' + opts + '</select></div>' +
        '<div class="phc-f" style="flex:1 1 160px"><label>📄 Pedido (PI)</label><input type="text" placeholder="PI B260601" value="' + escapeHtml(st.ref || "") + '" onchange="pedHechoSetRef(this.value)" title="Número de proforma. Agrupa estas líneas como UN pedido en la solapa 🚢 En curso."></div>' +
        '<div class="phc-f" style="flex:0 0 auto"><label>🚢 Embarque</label>' + _pedImpFechaInputHtml(st.embarque, "pedHechoSetEmbarque(v)", 'title="Día que sale de China. Opcional." style="width:96px"') + '</div>' +
        '<div class="phc-f" style="flex:0 0 auto"><label>🛬 Llegada</label>' + _pedImpFechaInputHtml(st.fecha, "pedHechoSetFecha(v)", 'title="Día que llega. Es el reingreso que ve la página LK." style="width:96px"') + '</div>' +
      '</div>' +
      '<div class="phc-tabs">' +
        '<button class="phc-tab' + (st.modo === "lista" ? " on" : "") + '" onclick="pedHechoSetModo(\'lista\')">1 · Elegir de la lista</button>' +
        '<button class="phc-tab' + (st.modo === "texto" ? " on" : "") + '" onclick="pedHechoSetModo(\'texto\')">2 · Escribir código y unidades</button>' +
      '</div>' +
      '<div id="phCuerpo"></div>' +
    '</div>' +
    '<div class="phc-foot" id="phFoot"></div></div>';
  _pedHechoRenderCuerpo();
  _pedHechoPie();
}
function _pedHechoRenderCuerpo(soloTabla) {
  var el = document.getElementById("phCuerpo"); if (!el || !_pedHecho) return;
  var st = _pedHecho;
  if (st.modo === "texto") {
    el.innerHTML =
      '<div class="phc-hint">Una línea por artículo: <b>código unidades</b> (ej. <code>505C 132000</code>). Si el artículo se compra por LK y por CH, poné la marca: <code>438E CH 1224</code>. Sirve pegar del Excel — separador espacio, coma, punto y coma o tab. Las <b>cajas</b> y <b>master cajas</b> se calculan solas.</div>' +
      '<textarea class="phc-ta" placeholder="505C 132000&#10;438E CH 1224&#10;026 5000" oninput="pedHechoSetTexto(this.value)">' + escapeHtml(st.texto || "") + '</textarea>' +
      '<div id="phPrev" style="margin-top:10px"></div>';
    _pedHechoPreview();
    return;
  }
  var data = (_stkPop && _stkPop.data) || { items: [] };
  if (!st.prov) { el.innerHTML = '<div class="phc-hint">Elegí primero el <b>proveedor</b> para ver sus artículos. (O usá la pestaña <b>2</b> y escribí los códigos.)</div>'; return; }
  var q = _pedHechoNorm(st.q).raw;
  var items = (data.items || []).filter(function (it) { return (it.prov || "(sin proveedor)") === st.prov; });
  if (q) items = items.filter(function (it) { return stkMatchBusq(st.q, it.cod, it.desc, false); });   // v21.43
  items.sort(function (a, b) { return String(a.cod).localeCompare(String(b.cod), "es", { numeric: true }); });
  // v15.00 — un artículo con dos marcas (LK y CH) sale como DOS renglones, uno por marca.
  var rows = [];
  items.forEach(function (it) {
    var marcas = _pedHechoMarcas(it);
    if (marcas.length > 1) marcas.forEach(function (m) { rows.push({ it: it, key: it.cod + "|" + m, marca: m }); });
    else if (it.planta) { var _mk = marcas[0] || it.planta; rows.push({ it: it, key: it.cod + "|" + _mk, marca: _mk }); }   // v22.93 — 809E LK / CH
    else rows.push({ it: it, key: it.cod, marca: "" });
  });
  var filas = rows.map(function (r, i) {
    var it = r.it;
    var uni = _pedHechoNum(st.sel[r.key]);
    var keyEnc = encodeURIComponent(r.key);
    var mBadge = r.marca ? ' <span style="font-size:10.5px;font-weight:800;color:#fff;background:' + (r.marca === "CH" ? "#b45309" : "#1e6bd6") + ';border-radius:999px;padding:1px 7px" title="Este artículo se compra por LK o por CH: cargá las unidades en la fila de la marca que pediste">' + escapeHtml(r.marca) + '</span>' : '';
    return '<tr id="phTr' + i + '"' + (uni > 0 ? ' class="on"' : '') + '>' +
      '<td class="phc-cod">' + escapeHtml(it.cod) + mBadge + '</td>' +
      '<td class="phc-desc" style="color:#475569">' + escapeHtml(String(artNombre(it.cod, it.desc) || "").slice(0, 34)) + '</td>' +
      '<td class="num" style="color:#64748b">' + (it.uniMaster > 0 ? _pedHechoFmt(it.uniMaster) : (it.uxc > 0 ? _pedHechoFmt(it.uxc) + '*' : '—')) + '</td>' +
      '<td class="num"><input class="phc-uni" inputmode="numeric" value="' + (uni > 0 ? uni : "") + '" oninput="pedHechoSetUni(\'' + keyEnc + '\',this.value,' + i + ')" placeholder="0"></td>' +
      '<td class="num" id="phCj' + i + '">' + _pedHechoDiv(uni, it.uxc) + '</td>' +
      '<td class="num" id="phMc' + i + '">' + _pedHechoDiv(uni, it.uniMaster) + '</td></tr>';
  }).join("");
  var tabla = items.length
    ? '<div class="phc-scroll"><table class="phc-tbl"><thead><tr><th>Código</th><th class="phc-desc">Descripción</th><th class="num" title="Unidades por master caja (* = no hay uni/master cargado, se muestra uni/caja)">Uni/master</th><th class="num">Unidades</th><th class="num" title="Cajas inner = unidades ÷ uni por caja">Cajas</th><th class="num" title="Master cajas = unidades ÷ uni por master">Master cajas</th></tr></thead><tbody>' + filas + '</tbody></table></div>'
    : '<div class="phc-hint">Ningún artículo de <b>' + escapeHtml(st.prov) + '</b> con ese filtro.</div>';
  if (soloTabla) { var t = document.getElementById("phTabla"); if (t) { t.innerHTML = tabla; return; } }
  el.innerHTML =
    '<div class="phc-hint">Tipeá las <b>unidades</b> de cada código que ya pediste. Las <b>cajas</b> y <b>master cajas</b> salen solas (⚠ = no entra justo en la caja).</div>' +
    '<input class="phc-uni" style="width:100%;height:36px;text-align:left;margin-bottom:8px" placeholder="🔎 Filtrar por código o descripción" value="' + escapeHtml(st.q || "") + '" oninput="pedHechoBuscar(this.value)">' +
    '<div id="phTabla">' + tabla + '</div>';
}
function _pedHechoPreview() {
  var el = document.getElementById("phPrev"); if (!el || !_pedHecho) return;
  var ls = _pedHechoLineas();
  if (!ls.length) { el.innerHTML = ""; return; }
  el.innerHTML = '<table class="phc-tbl"><thead><tr><th>Código</th><th class="phc-desc">Descripción</th><th class="num">Unidades</th><th class="num">Cajas</th><th class="num">Master cajas</th></tr></thead><tbody>' +
    ls.map(function (l) {
      if (!l.it || !l.det) return '<tr><td class="phc-cod">' + escapeHtml(l.cod) + '</td><td colspan="4" class="phc-bad">' + escapeHtml(l.err) + '</td></tr>';
      var alerta = (_pedHecho.prov && (l.it.prov || "(sin proveedor)") !== _pedHecho.prov) ? ' <span class="phc-warn" title="Este código es de ' + escapeHtml(l.it.prov || "") + '">⚠ otro proveedor</span>' : '';
      var mTxt = (l.marca && _pedHechoMarcas(l.it).length > 1) ? ' <b style="color:' + (l.marca === "CH" ? "#b45309" : "#1e6bd6") + '">' + escapeHtml(l.marca) + '</b>' : '';
      return '<tr' + (l.uni > 0 ? ' class="on"' : '') + '><td class="phc-cod">' + escapeHtml(l.it.cod) + mTxt + '</td>' +
        '<td class="phc-desc" style="color:#475569">' + escapeHtml(String(artNombre(l.it.cod, l.it.desc) || "").slice(0, 30)) + alerta + '</td>' +
        '<td class="num">' + (l.uni > 0 ? _pedHechoFmt(l.uni) : '<span class="phc-bad">0</span>') + '</td>' +
        '<td class="num">' + _pedHechoDiv(l.uni, l.it.uxc) + '</td>' +
        '<td class="num">' + _pedHechoDiv(l.uni, l.it.uniMaster) + '</td></tr>';
    }).join("") + '</tbody></table>';
}
/* Guardar: por cada renglón, unidades SUMADAS a lo que ya estaba en curso (importados_set_curso
   es absoluto) sobre la fila de Importados del proveedor elegido, y la fecha a reingreso_est. */
async function pedHechoGuardar() {
  var st = _pedHecho; if (!st || st.guardando) return;
  if (!st.prov) { try { alert("Elegí el proveedor."); } catch (_e) {} return; }
  var ls = _pedHechoLineas().filter(function (l) { return l.det && l.uni > 0; });
  if (!ls.length) { try { alert("Cargá al menos un artículo con unidades."); } catch (_e) {} return; }
  var malas = _pedHechoLineas().filter(function (l) { return !l.det || !(l.uni > 0); });
  if (malas.length) { var sigo = false; try { sigo = confirm("Hay " + malas.length + " línea(s) que no se van a guardar (código desconocido o unidades en 0).\n¿Guardar igual el resto?"); } catch (_e) {} if (!sigo) return; }
  var iso = String(st.fecha || "").slice(0, 10);
  if (!iso) { var sinF = false; try { sinF = confirm("No pusiste fecha estimada de entrega.\n¿Guardar sin fecha?"); } catch (_e) {} if (!sinF) return; }
  st.guardando = true; _pedHechoPie();
  var okN = 0, errs = [];
  var _leg = ""; try { _leg = String(window.__authEmail || ""); } catch (_e) { _leg = ""; }
  for (var i = 0; i < ls.length; i++) {
    var l = ls[i];
    // v15.00 — la fila ya viene resuelta por proveedor + marca (LK/CH) desde _pedHechoLineas.
    var d = l.det || null;
    if (!d) { errs.push(l.it.cod + ": sin fila de importado"); continue; }
    // Cada carga = UN bache nuevo (unidades + su fecha). No pisa lo anterior:
    // el "en curso" queda como suma de baches y el reingreso = fecha más cercana.
    try {
      await _pedImpRpc("gv_importado_bache_add", { p_importado_id: d.id, p_unidades: l.uni, p_fecha: iso || null, p_legajo: _leg,
        p_ref: (st.ref || null), p_embarque: (String(st.embarque || "").slice(0, 10) || null) });
      okN++;
    } catch (e) { errs.push(l.it.cod + ": " + (e.message || e)); continue; }
  }
  st.guardando = false;
  var t = _pedHechoTotales();
  pedHechoCerrar();
  try {
    alert((okN ? "✅ " + okN + " artículo(s) cargados como pedido en curso de " + st.prov +
      "\n" + _pedHechoFmt(t.uni) + " u · " + (Math.round(t.mc * 100) / 100).toLocaleString("es-AR") + " master cajas" +
      (iso ? "\nEntrega estimada: " + _isoToDdMmAa(iso) : "") : "No se guardó nada.") +
      (errs.length ? "\n\n⚠ " + errs.join("\n") : ""));
  } catch (_e) {}
  await pedImpReload();
}
/* v10.38 — MASTER CAJAS del pedido, editable por código (se puede poner 0). Vacío = vuelve al
   calculado. El pedido se cuenta en master cajas REDONDAS → unidades = MC × uni_master. */
function pedImpSetMC(codEnc, val) {
  if (!_stkPop || _stkPop.kind !== "pedImp") return;
  const cod = decodeURIComponent(codEnc);
  if (!_stkPop.mcOverride) _stkPop.mcOverride = {};
  const raw = String(val == null ? "" : val).trim();
  if (raw === "") delete _stkPop.mcOverride[cod];
  else _stkPop.mcOverride[cod] = Math.max(0, Math.floor(Number(raw)) || 0);
  _pedImpRender();
}
/* v10.38 — MC efectivo (override o el calculado) y unidades en master cajas redondas. */
/* v24.42 — MESES DE STOCK = (stock disponible + EN CAMINO) ÷ proyección por mes. v24.43 (Thomas):
   suma lo que está en camino, y la columna En camino muestra la fecha (dd/mm) de reingreso.
   Sin proyección no hay meses: null ("—"), y va al final del orden. La alerta es < 4 meses. */
const _PEDIMP_MESES_ALERTA = 4;
function _pedImpMesesStock(it) {
  const proy = Number(it && it.proyUni) || 0; if (!(proy > 0)) return null;
  return ((Number(it.stockUni) || 0) + Math.max(0, Number(it.enCurso) || 0)) / proy;
}
/* v26.39 — el u$s de lo que viene EN CAMINO de un artículo: con el FOB GUARDADO de cada pedido
   (gv_importados_curso_fob, v26.37, por artículo del maestro = it.det[].id); lo que esa lectura no
   cubre —o si no se pudo leer (fobCur null)— va con el FOB de hoy. */
function _pedImpUsdCamino(it, fobCur) {
  const cam = Math.max(0, Number(it && it.enCurso) || 0); if (!(cam > 0)) return 0;
  const fobHoy = it.fobUni > 0 ? it.fobUni : 0;
  if (fobCur && (it.det || []).length) {
    let u = 0, cub = 0;
    it.det.forEach(function (d) { const x = fobCur[String(d.id)]; if (x) { u += Number(x.usd) || 0; cub += Number(x.pend) || 0; } });
    if (cub > 0) return u + Math.max(0, cam - cub) * fobHoy;
  }
  return cam * fobHoy;
}
/* v26.39 (Luis, 02/10: "definí cuáles son los pedidos más urgentes … si no hay ningún ítem por debajo de
   los 8 meses no es tan urgente como si todos están alrededor de 3 o 4 meses") — la URGENCIA de un
   proveedor = cuántos meses le faltan, en promedio, a su línea para tener 8 meses de stock:
     Σ consumo u$s/mes × máx(0; 8 − meses de stock) ÷ Σ consumo u$s/mes
   con los meses de _pedImpMesesStock (stock + en camino ÷ Est. Madre). Ponderado por PLATA: un artículo
   que casi no se vende no define la urgencia del proveedor. Ningún artículo debajo de 8 meses → 0;
   todos en 3-4 meses → 4 a 5. Stock negativo cuenta como 0 meses. Sin FOB cargado, promedio simple.
   v26.41 (Luis: "prefiero prioridad 1, 2, 3, 4"): PRIORIDAD 1 = faltan 3 o más · 2 = 2 a 3 · 3 = 1 a 2 ·
   4 = menos de 1 (incluye 0: ningún artículo debajo de 8 meses). Sin Est. Madre no tiene prioridad (va al final). */
const _PEDIMP_URG_MESES = 8;
function _pedImpUrgencia(items) {
  const m8 = _PEDIMP_URG_MESES;
  let n = 0, c4 = 0, c8 = 0, q = 0, sw = 0, sd = 0, sdS = 0;
  (items || []).forEach(function (it) {
    const m0 = _pedImpMesesStock(it); if (m0 == null) return;
    const m = Math.max(0, m0), w = (Number(it.proyUni) || 0) * (it.fobUni > 0 ? it.fobUni : 0), d = Math.max(0, m8 - m);
    n++; if (m < _PEDIMP_MESES_ALERTA) c4++; if (m < m8) c8++; if (_pedImpQuiebre(it)) q++;
    sw += w; sd += w * d; sdS += d;
  });
  const idx = sw > 0 ? sd / sw : (n ? sdS / n : 0);
  const nivel = !n ? 5 : idx >= 3 ? 1 : idx >= 2 ? 2 : idx >= 1 ? 3 : 4;
  return { idx: idx, nivel: nivel, etiqueta: nivel < 5 ? String(nivel) : "SIN Est. Madre", n: n, c4: c4, c8: c8, quiebran: q };
}
function _pedImpDdmm(f) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(f || "")); return m ? m[3] + "/" + m[2] : ""; }
function _pedImpEnCaminoHtml(it, cls) {
  const u = Math.max(0, Number(it.enCurso) || 0);
  if (!(u > 0)) return '<span style="color:#cbd5e1">0</span>';
  const f = _pedImpDdmm(it.reingresoEst);
  return u.toLocaleString("es-AR") + (f ? ' <span class="' + (cls || 'pedimp-camino-f') + '" style="color:#0369a1;font-weight:700" title="Llega (reingreso estimado)">' + f + '</span>' : ' <span style="color:#b45309;font-size:11px" title="Sin fecha de reingreso cargada">s/f</span>');
}
/* v24.74 (Thomas) — «FOB en viaje» = los u$s TOTALES de los pedidos en viaje, el mismo número
   de 🚢 En curso (gv_importados_pedidos_curso, una fila por PI + proveedor). No es una estimación
   unidades × FOB de hoy. Se lee aparte y, si falla, no se muestra (no se inventa un 0). */
var _pedImpViaje = { st: "", porProv: {}, nPorProv: {} };
function _pedImpViajeCargar() {
  if (_pedImpViaje.st === "cargando" || _pedImpViaje.st === "ok") return;
  _pedImpViaje.st = "cargando";
  _pedImpRpc("gv_importados_pedidos_curso", {}).then(function (rows) {
    _pedImpViaje = _pedImpViajeAgrupar(rows);
    if (_stkPop && _stkPop.kind === "pedImp") _pedImpRender();
  }).catch(function () { _pedImpViaje.st = "error"; });
}
function _pedImpViajeAgrupar(rows) {
  const u = {}, n = {};
  (rows || []).forEach(function (r) { const p = String(r.proveedor || "").trim() || "(sin proveedor)"; const v = Number(r.usd) || 0; if (v > 0) { u[p] = (u[p] || 0) + v; n[p] = (n[p] || 0) + 1; } });
  return { st: "ok", porProv: u, nPorProv: n };
}
/* v26.39 — lo mismo, esperándolo (la hoja resumen del PDF lo necesita ya). null = no se pudo leer. */
async function _pedImpViajeAsegurar() {
  if (_pedImpViaje.st === "ok") return _pedImpViaje.porProv;
  try { _pedImpViaje = _pedImpViajeAgrupar(await _pedImpRpc("gv_importados_pedidos_curso", {})); return _pedImpViaje.porProv; }
  catch (_e) { return null; }
}
function _pedImpViajeUsd(prov) { return _pedImpViaje.st === "ok" ? (Number(_pedImpViaje.porProv[prov]) || 0) : 0; }
function _pedImpPrioCmp(a, b) {
  const ma = _pedImpMesesStock(a), mb = _pedImpMesesStock(b);
  if (ma == null && mb != null) return 1;
  if (mb == null && ma != null) return -1;
  if (ma != null && mb != null && ma !== mb) return ma - mb;
  return _pedImpUniOf(b) - _pedImpUniOf(a) || ((b.aPedirUni || 0) - (a.aPedirUni || 0));
}
function _pedImpMesesFmt(m) { return m == null ? "—" : (Math.round(m * 10) / 10).toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
function _pedImpMesesCell(it) {
  const m = _pedImpMesesStock(it);
  if (m == null) return '<td class="num" style="color:#cbd5e1" title="Sin Estadística Madre: no hay meses de stock">—</td>';
  const proy = Number(it.proyUni) || 0;
  const stk = (Number(it.stockUni) || 0), cam = Math.max(0, Number(it.enCurso) || 0);
  const bajo = m < _PEDIMP_MESES_ALERTA;
  return '<td class="num pedimp-meses" title="(' + stk + ' u stock + ' + cam + ' u en camino) ÷ ' + proy + ' u/mes' + (cam > 0 ? ' · sólo stock: ' + _pedImpMesesFmt(stk / proy) + ' meses' : '') + '"' + (bajo ? ' style="color:#b91c1c;font-weight:800;background:#fef2f2"' : '') + '>' + (bajo ? '⚠ ' : '') + _pedImpMesesFmt(m) + '</td>';
}
/* v24.75 (Thomas) — QUIEBRE ANTES DE QUE LLEGUE LA IMPORTACIÓN. Con el stock REAL de hoy en
   Argentina (sin lo en camino) le quedan < 4 meses y se termina ANTES de la fecha de llegada del
   pedido en viaje (Importados.reingreso_est). Sin importación en camino, o en camino sin fecha,
   también avisa: no hay nada que llegue a tiempo. Sin proyección no se calcula (null).
   Devuelve { quiebra: 'aaaa-mm-dd', llega: 'aaaa-mm-dd'|'' , dias: días sin stock | null }. */
function _pedImpQuiebre(it, hoyMs) {
  const proy = Number(it && it.proyUni) || 0; if (!(proy > 0)) return null;
  const stk = (Number(it.stockUni) || 0);
  const mesesReal = stk / proy;
  if (!(mesesReal < _PEDIMP_MESES_ALERTA)) return null;
  const hoy = hoyMs != null ? hoyMs : (Date.now() - 3 * 3600000);
  const dQ = Math.floor(mesesReal * 30.4);
  const fQ = new Date(hoy + dQ * 86400000).toISOString().slice(0, 10);
  const cam = Math.max(0, Number(it.enCurso) || 0);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(it.reingresoEst || ""));
  if (cam > 0 && m) {
    const fL = m[1] + "-" + m[2] + "-" + m[3];
    if (fL <= fQ) return null;   // llega antes de quebrar
    return { quiebra: fQ, llega: fL, dias: Math.round((Date.parse(fL) - Date.parse(fQ)) / 86400000) };
  }
  return { quiebra: fQ, llega: "", dias: null, sinCamino: !(cam > 0) };
}
function _pedImpQuiebreChip(it) {
  const q = _pedImpQuiebre(it); if (!q) return "";
  const fq = _pedImpDdmm(q.quiebra);
  const txt = q.llega ? ('⛔ quiebra ' + fq + ' · llega ' + _pedImpDdmm(q.llega)) : ('⛔ quiebra ' + fq + (q.sinCamino ? ' · nada en camino' : ' · llegada s/f'));
  const tip = 'Con el stock real de hoy (' + (Number(it.stockUni) || 0) + ' u ÷ ' + it.proyUni + ' u/mes) se termina el ' + fq +
    (q.llega ? ' y la importación llega el ' + _pedImpDdmm(q.llega) + ': ' + q.dias + ' días sin stock.' : (q.sinCamino ? ' y no hay importación en camino.' : ' y la importación en camino no tiene fecha de llegada.')) + ' Ver si se puede hacer algo (adelantar, avión, reemplazo).';
  return '<div class="pedimp-quiebre" style="margin-top:2px"><span style="display:inline-block;font-size:10.5px;font-weight:800;color:#fff;background:#dc2626;border-radius:6px;padding:1px 5px;line-height:1.25" title="' + escapeHtml(tip) + '">' + txt + (q.dias ? ' · ' + q.dias + 'd' : '') + '</span></div>';
}
function _pedImpQuiebreBadge(n) {
  return n > 0 ? ' <span class="pedimp-quiebre-n" style="font-size:11px;font-weight:800;color:#fff;background:#7f1d1d;border-radius:999px;padding:0 6px" title="' + n + ' artículo(s) quiebran antes de que llegue la importación (stock real &lt; ' + _PEDIMP_MESES_ALERTA + ' meses)">⛔' + n + '</span>' : '';
}
function _pedImpAlertaBadge(n) {
  return n > 0 ? ' <span class="pedimp-alerta" style="font-size:11px;font-weight:800;color:#fff;background:#dc2626;border-radius:999px;padding:0 6px" title="' + n + ' con &lt; ' + _PEDIMP_MESES_ALERTA + ' meses de stock (stock + en camino)">⚠' + n + '</span>' : '';
}
function _pedImpMcOf(it) {
  const ov = (_stkPop && _stkPop.mcOverride) ? _stkPop.mcOverride[it.key || it.cod] : undefined;   // v22.93 — 809E LK y CH, cada uno el suyo
  if (ov != null) return ov;
  return (it.aPedirCajas != null) ? _pedImpMoqCalc(it).mc : 0;   // v24.55 — con la regla del 80 % del MOQ
}
/* v22.93 — 809E va en dos líneas (LK / CH): chip de planta, búsqueda por clave y a qué filas del maestro
   escribe un cambio (sólo las de SU planta: el FOB de Chef y el de Loeke son distintos). */
/* v23.30 (Luis 28/09) — la L es de ruteo, no parte del código: el maestro guarda 437EL/438EL/439EL
   (Loeke) al lado de 437E (Chef), y en pantalla/Excel/PDF salía "437EL". Se MUESTRA 437E con la chapa
   LK; por dentro sigue 437EL (volumen, reingreso y las RPC van por cod_art). */
function _impLRuteo(it) {
  return !!it && !it.planta && /[0-9E]L$/i.test(String(it.cod || "")) &&
    (it.det || []).every(function (d) { return String(d.marca || "").trim().toUpperCase() !== "CH"; });
}
function _impCodVista(it) { return _impLRuteo(it) ? String(it.cod).replace(/([0-9E])L$/i, "$1") : it.cod; }
function _impPlantaVista(it) { if (it && it.esInsumo) return ""; return (it && (it.planta || it.plantaVista)) || (_impLRuteo(it) ? "LK" : ""); }   // v25.01: un insumo no es de ninguna empresa
function _impPlantaChip(it) {
  var pl = _impPlantaVista(it);
  if (!pl) return "";
  return ' <span title="Mismo código, otro producto: cambia el packaging. Se pide por separado." style="font-size:10.5px;font-weight:800;color:#fff;background:' + (pl === "CH" ? "#b45309" : "#1e6bd6") + ';border-radius:999px;padding:1px 7px">' + pl + '</span>';
}
function _pedImpItemPorClave(key) {
  const data = (_stkPop && _stkPop.data) || {}, K = String(key || "").toUpperCase().trim();
  return (data.items || []).find(function (it) { return String(it.key || it.cod).toUpperCase().trim() === K; })
      || (data.items || []).find(function (it) { return String(it.cod).toUpperCase().trim() === K; }) || null;
}
function _pedImpFiltroFilas(it, cod) {
  const ids = (it && it.planta) ? (it.det || []).map(function (d) { return d.id; }).filter(function (x) { return x != null; }) : [];
  return ids.length ? ("id=in.(" + ids.join(",") + ")") : ("cod_art=eq." + encodeURIComponent(cod));
}
function _pedImpUniOf(it) { const mc = _pedImpMcOf(it); return (it.uniMaster > 0) ? mc * it.uniMaster : (mc > 0 ? (it.aPedirUni || 0) : 0); }
function _pedImpUsdOf(it) { return (it.fobUni > 0) ? _pedImpUniOf(it) * it.fobUni : 0; }
function _pedImpM3Of(it) { return (it.m3Master > 0) ? _pedImpMcOf(it) * it.m3Master : 0; }
function _pedImpRender() {
  if (_reingExcl === null && !_reingExclCargando) _reingExclCargar();
  const body = document.getElementById("stkPopBody"); if (!body || !_stkPop || _stkPop.kind !== "pedImp") return;
  const data = _stkPop.data || { items: [], meses: 10 };
  if (!_stkPop.mcOverride) _stkPop.mcOverride = {};
  const soloPedir = _stkPop.soloPedir !== false;   // default: Solo Pedido
  const allItems = (data.items || []);
  const _pedQ = pedImpQTerms(), _buscando = _pedQ.length > 0, _qRaw = String(_stkPop.q || "");
  // v14.99 — las fichas de proveedor salen de TODOS los ítems (no sólo de los que generan
  // pedido), así un chino sin nada a pedir sigue apareciendo y se puede elegir.
  const provAll = [];
  allItems.forEach(function (it) { const p = it.prov || "(sin proveedor)"; if (provAll.indexOf(p) < 0) provAll.push(p); });
  provAll.sort(function (a, b) { const ia = _IMPORTADOR_DE[a] || "zz", ib = _IMPORTADOR_DE[b] || "zz"; return String(ia).localeCompare(String(ib)) || String(a).localeCompare(String(b)); });
  const provSel = (_stkPop.provFiltro && provAll.indexOf(_stkPop.provFiltro) >= 0) ? _stkPop.provFiltro : "";
  const provFiltro = _buscando ? "" : provSel;   // buscando se barre TODO (ver pedImpSetQ)
  let items = allItems;
  // v14.99 — parado en UN proveedor se ven todos sus ítems aunque no generen pedido
  // (dueño: "si me paro en un solo prov, mostrame todos los items"). "Solo Pedido"
  // filtra únicamente en la vista Todos.
  if (_buscando) items = allItems.filter(function (it) { return pedImpMatch(it, _pedQ); });
  else if (soloPedir && !provFiltro) items = items.filter(function (it) { return _pedImpMcOf(it) > 0; });
  // ventanas POR PROVEEDOR (cada proveedor = una tarjeta con su tabla, subtotal y botón PDF).
  const byProv = {}, provOrder = [];
  items.forEach(function (it) { const prov = it.prov || "(sin proveedor)"; if (!byProv[prov]) { byProv[prov] = []; provOrder.push(prov); } byProv[prov].push(it); });
  provOrder.sort(function (a, b) { const ia = _IMPORTADOR_DE[a] || "zz", ib = _IMPORTADOR_DE[b] || "zz"; return String(ia).localeCompare(String(ib)) || String(a).localeCompare(String(b)); });
  let h = _impTabsHtml('ped');
  // v24.57 (Thomas: «ocupa mucho espacio») — la cabecera entera en 3 filas: herramientas ·
  // proveedores (una fila que se desliza) · totales + nacionalización. Lo que se explicaba en
  // párrafos pasó al ⓘ del menú ⋯ y a los `title`.
  const _entrega = (data.entregaGlobal || "");
  const _seg = function (on, first) { return 'width:auto;margin:0;flex:0 0 auto;padding:6px 11px;border:1px solid #0f766e;' + (first ? 'border-radius:999px 0 0 999px;border-right:0' : 'border-radius:0 999px 999px 0') + ';background:' + (on ? '#0f766e' : '#fff') + ';color:' + (on ? '#fff' : '#0f766e') + ';font-size:12.5px;font-weight:800;cursor:pointer'; };
  const _chip = function (on) { return 'width:auto;margin:0;flex:0 0 auto;padding:5px 10px;border-radius:999px;border:1px solid ' + (on ? '#0f766e' : '#cbd5e1') + ';background:' + (on ? '#0f766e' : '#fff') + ';color:' + (on ? '#fff' : '#334155') + ';font-size:12.5px;font-weight:800;cursor:pointer;white-space:nowrap'; };
  const _menuBtn = 'display:block;width:100%;margin:0;padding:8px 12px;border:0;border-radius:6px;background:#fff;color:#0f172a;font-size:13px;font-weight:700;text-align:left;cursor:pointer;white-space:nowrap';
  h += '<div class="pedimp-bar" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:8px">' +
    '<input class="pedimp-q" type="text" enterkeyhint="search" autocomplete="off" placeholder="🔎 Código(s) o descripción" value="' + escapeHtml(_qRaw) + '" oninput="pedImpSetQ(this.value)" style="width:auto;margin:0;flex:1 1 170px;min-width:150px;max-width:360px;height:32px;border:1.5px solid ' + (_buscando ? '#0f766e' : '#cbd5e1') + ';border-radius:8px;padding:0 10px;font-size:13.5px;box-sizing:border-box;background:#fff">' +
    (_buscando ? '<button class="mva-clear" style="width:auto;margin:0" onclick="pedImpSetQ(\'\')" title="Limpiar la búsqueda">✕</button>' : '') +
    '<span style="display:inline-flex;flex:0 0 auto"><button style="' + _seg(soloPedir, true) + '" onclick="pedImpSetFiltro(true)" title="Sólo lo que hay que pedir">Solo Pedido</button><button style="' + _seg(!soloPedir, false) + '" onclick="pedImpSetFiltro(false)" title="Todos los artículos">Ver Todo</button></span>' +
    '<label title="Fecha estimada de entrega que ven los clientes en el carrito del portal LK antes de confirmar. Vacía = no se muestra." style="display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:800;color:#1e3a8a;flex:0 0 auto">📅 ' +
    _pedImpFechaInputHtml(_entrega, "pedImpSetEntregaGlobal(v)", 'style="width:80px;margin:0;height:30px;padding:0 6px;border:1px solid ' + (_entrega ? '#1d4ed8' : '#cbd5e1') + ';border-radius:8px;font-size:12.5px;background:#fff;box-sizing:border-box"') + '</label>' +
    '<details class="pedimp-mas" style="position:relative;flex:0 0 auto"><summary title="Más acciones" style="list-style:none;cursor:pointer;padding:3px 11px;border:1px solid #cbd5e1;border-radius:999px;background:#fff;font-size:15px;font-weight:900;color:#334155;user-select:none">⋯</summary>' +
      '<div style="position:absolute;right:0;top:calc(100% + 4px);z-index:30;background:#fff;border:1px solid #cbd5e1;border-radius:10px;box-shadow:0 8px 24px rgba(15,23,42,.18);padding:4px;min-width:220px">' +
      '<button style="' + _menuBtn + '" onclick="this.closest(\'details\').open=false;pedImpExportExcel()" title="Bajar a Excel lo que se está viendo">📥 Excel</button>' +
      '<button style="' + _menuBtn + '" onclick="this.closest(\'details\').open=false;pedImpCargarPedidoHecho()" title="Registrar un pedido ya hecho por fuera (unidades en curso + fecha estimada de entrega)">➕ Cargar pedido ya hecho</button>' +
      '<details style="padding:4px 12px 6px"><summary style="cursor:pointer;font-size:13px;font-weight:700;color:#0f172a">ⓘ Cómo se usa</summary>' +
        '<div class="stkpop-hint" style="margin:6px 0 0;white-space:normal;max-width:300px">Índice <b>' + (data.meses || 10) + ' meses</b>. El pedido va en <b>master cajas redondas</b>: tocá la celda <b>MC</b> para ajustarlo (<b>0</b> = no pedir). <b>Unidades = MC × uni/master</b>. 🧩 = parte · ✏️ en curso · 📥 llegó · 🖨 PDF para que el chino cotice (sin FOB). En pantalla angosta la tabla se desliza al costado.</div></details>' +
      '</div></details>' +
    // v24.76 (Luis) — reporte en PDF de los proveedores que se elijan, en el hueco de la derecha
    '<button class="pedimp-rep-btn" onclick="pedImpRepAbrir()" title="PDF con la lógica del de Damián (pedido · sin pedir · discontinuos) de los proveedores que elijas" style="width:auto;margin:0 0 0 auto;flex:0 0 auto;padding:6px 14px;border:1px solid #1e3a8a;border-radius:8px;background:#1e3a8a;color:#fff;font-size:13px;font-weight:800;cursor:pointer;white-space:nowrap">🖨 IMPRIMIR PDF</button>' +
    (_buscando ? '<span style="font-size:11.5px;color:#0f766e;font-weight:700;flex-basis:100%">' + items.length + ' ítem(s) · se busca en <b>todos</b> los proveedores, pidan o no</span>' : '') +
    '</div>';
  // Proveedores: UNA fila que se desliza; la alerta va como número (⚠N) con el detalle en el title.
  if (provAll.length > 1) {
    h += '<div class="pedimp-provs" style="margin-bottom:8px;display:flex;gap:6px;flex-wrap:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;align-items:center;padding-bottom:2px">' +
      '<button style="' + _chip(!provSel) + '" onclick="pedImpSetProv(\'\')">Todos</button>' +
      provAll.map(function (p) { return '<button style="' + _chip(provSel === p) + '" onclick="pedImpSetProv(\'' + encodeURIComponent(p) + '\')">' + escapeHtml(p) + _pedImpAlertaBadge(allItems.filter(function (it) { const m = _pedImpMesesStock(it); return (it.prov || "(sin proveedor)") === p && m != null && m < _PEDIMP_MESES_ALERTA; }).length) + _pedImpQuiebreBadge(allItems.filter(function (it) { return (it.prov || "(sin proveedor)") === p && _pedImpQuiebre(it); }).length) + '</button>'; }).join('') +
      '</div>';
    if (provSel) h += '<div style="font-size:11.5px;color:' + (_buscando ? '#0f766e' : '#64748b') + ';margin:-4px 0 8px">' + (_buscando ? '· mientras buscás se miran <b>todos</b> los proveedores' : '· se muestran <b>todos</b> los artículos de ' + escapeHtml(provSel) + ', pidan o no') + '</div>';
  }
  // totales (respetan el MC editado y el proveedor elegido) + nacionalización, en UNA barra
  const itemsView = provFiltro ? items.filter(function (it) { return (it.prov || "(sin proveedor)") === provFiltro; }) : items;
  const _gUsd = itemsView.reduce(function (s, it) { return s + _pedImpUsdOf(it); }, 0);
  const _gM3 = itemsView.reduce(function (s, it) { return s + _pedImpM3Of(it); }, 0);
  const _nSinFob = itemsView.filter(function (it) { return _pedImpMcOf(it) > 0 && !(it.fobUni > 0); }).length;
  const _nSinVol = itemsView.filter(function (it) { return _pedImpMcOf(it) > 0 && !(it.m3Master > 0); }).length;
  // v22.37 — modo de nacionalización (marítimo consolidado / contenedor propio / avión), valor m³
  // flete y mínimo del pedido: se guardan en Stock_Config. Cada proveedor = su propio embarque.
  const _nac = (data.nac || { modo: "consolidada", valorM3: 110, tn: 0 });
  const _numIn = 'margin:0;height:28px;border:1px solid #c4b5fd;border-radius:7px;padding:0 5px;font-size:12.5px;text-align:right;box-sizing:border-box;background:#fff';
  const _lbl = 'font-size:12px;color:#6b21a8;font-weight:700;display:inline-flex;align-items:center;gap:4px;flex:0 0 auto';
  h += '<div class="pedimp-tot" style="display:flex;gap:6px 14px;flex-wrap:wrap;align-items:center;margin-bottom:10px;padding:7px 12px;background:#faf5ff;border:1px solid #e9d5ff;border-radius:10px">' +
    '<span style="font-size:16px;font-weight:800;color:#065f46;white-space:nowrap" title="Total del pedido FOB' + (_buscando ? ' (filtrado)' : '') + '">u$s ' + Math.round(_gUsd).toLocaleString("es-AR") + '</span>' +
    '<span style="font-size:16px;font-weight:800;color:#1e3a8a;white-space:nowrap" title="Volumen total' + (_buscando ? ' (filtrado)' : '') + '">' + (Math.round(_gM3 * 100) / 100).toLocaleString("es-AR") + ' m³</span>' +
    // v24.73 (Thomas) — FOB de lo que ya viene en camino
    (function () { const _src = provFiltro ? allItems.filter(function (it) { return (it.prov || "(sin proveedor)") === provFiltro; }) : allItems;
      _pedImpViajeCargar(); void _src;
      const _c = provFiltro ? _pedImpViajeUsd(provFiltro) : Object.keys(_pedImpViaje.porProv || {}).reduce(function (s, p) { return s + _pedImpViajeUsd(p); }, 0);
      return _c > 0 ? '<span class="pedimp-camino-fob-tot" style="font-size:13px;font-weight:800;color:#0369a1;white-space:nowrap" title="u$s totales de los pedidos en viaje (los mismos de 🚢 En curso)">en viaje ' + _usd0(_c) + '</span>' : ''; })() +
    // v24.60 (Thomas) — consumo por mes de todo lo que se ve (proy × FOB), aunque hoy no pida nada
    (function () { const _src = provFiltro ? allItems.filter(function (it) { return (it.prov || "(sin proveedor)") === provFiltro; }) : allItems;
      const _c = _src.reduce(function (s, it) { return s + (it.proyUni > 0 && it.fobUni > 0 ? it.proyUni * it.fobUni : 0); }, 0);
      return _c > 0 ? '<span class="pedimp-consumo-tot" style="font-size:13px;font-weight:800;color:#b45309;white-space:nowrap" title="Consumo por mes: Estadística Madre u/mes × FOB, sumado sobre ' + (provFiltro ? escapeHtml(provFiltro) : 'todos los proveedores') + '">consumo ' + _usd0(_c) + '/mes</span>' : ''; })() +
    (_nSinFob || _nSinVol ? '<span style="font-size:11px;color:#b45309;font-weight:700">⚠ ' + [_nSinFob ? _nSinFob + ' sin FOB' : '', _nSinVol ? _nSinVol + ' sin volumen' : ''].filter(Boolean).join(' · ') + '</span>' : '') +
    '<span style="flex:1 1 0;min-width:0"></span>' +
    '<label style="' + _lbl + '" title="Cómo viaja el pedido. El costo NO recuperable (derechos, flete, tasas, despachante' + (Object.keys(_NTL_PROVEEDORES).length ? ' y 5% NTL en los proveedores que facturan por NTL' : '') + ') queda pegado al costo del artículo. Cada proveedor se calcula como su propio embarque.">🚢 <select class="pedimp-modo" onchange="pedImpSetNacCfg(\'impo_nac_modo\',this.value)" style="width:auto;margin:0;height:28px;border:1px solid #c4b5fd;border-radius:7px;padding:0 4px;font-size:12.5px;font-weight:700;color:#6b21a8;background:#fff">' +
      [["consolidada", "Consolidada"], ["full", "Contenedor"], ["avion", "Avión"]].map(function (o) { return '<option value="' + o[0] + '"' + (_nac.modo === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>' +
    (_nac.modo === "consolidada" ? '<label style="' + _lbl + '" title="Valor del m³ de flete, en u$s">m³ u$s <input type="number" inputmode="decimal" min="0" value="' + _nac.valorM3 + '" onchange="pedImpSetNacCfg(\'impo_nac_valor_m3\',this.value)" style="width:54px;' + _numIn + '"></label>' : '') +
    (_nac.modo === "avion" ? '<label style="' + _lbl + '" title="Peso total del embarque en toneladas (avión cobra por kg)">TN <input type="number" inputmode="decimal" min="0" value="' + (_nac.tn || "") + '" onchange="pedImpSetNacTn(this.value)" placeholder="0" style="width:50px;' + _numIn + '"></label>' : '') +
    // v24.58 (Thomas) — el mínimo del pedido (25k) se sacó: es una norma general, no un requisito.
    // v23.91 (Luis) — los parámetros generales se editan acá, no adentro del ⚙ de un proveedor
    '<button class="mva-clear" style="width:auto;margin:0;padding:4px 9px;font-size:12px;background:#4338ca;color:#fff;border-color:#4338ca" onclick="pedImpCfgGralAbrir()" title="⚙ Generales: tasas, tope de estadística, valor del m³, mínimo y MOQ que valen para todos los proveedores que no tengan el suyo propio">⚙</button>' +
    '</div>';
  let algo = false;
  // v24.32 — la tarjeta se achica al ancho de la tabla más ancha que se dibuje
  let _anchoMax = 0;
  provOrder.forEach(function (prov) {
    if (provFiltro && prov !== provFiltro) return;   // ver solo el chino elegido
    const arr = byProv[prov]; if (!arr || !arr.length) return;
    algo = true;
    const imp = _IMPORTADOR_DE[prov] || "(sin importador)";
    const totMC = arr.reduce(function (s, it) { return s + _pedImpMcOf(it); }, 0);
    const totU = arr.reduce(function (s, it) { return s + _pedImpUniOf(it); }, 0);
    const totM3 = arr.reduce(function (s, it) { return s + _pedImpM3Of(it); }, 0);
    const totUsd = arr.reduce(function (s, it) { return s + _pedImpUsdOf(it); }, 0);
    const totCamUsd = _pedImpViajeUsd(prov), nCam = Number(_pedImpViaje.nPorProv[prov]) || 0;
    const provEnc = encodeURIComponent(prov);
    // v22.37 — proyección al mínimo (usa la demanda NATURAL, no el MC editado): FOB a pedir
    // hoy, consumo mensual (proy×fob) y techo (objetivo lleno×fob).
    const _isNtl = _esProvNtl(prov);
    const _burnN = arr.reduce(function (s, it) { return s + (it.proyUni > 0 && it.fobUni > 0 ? it.proyUni * it.fobUni : 0); }, 0);
    // v23.89 — el mínimo y el valor del m³ pueden ser propios de este proveedor (GV_Imp_Proveedor)
    const _valorM3P = _impProvNum(prov, "valor_m3", _nac.valorM3);
    // costo de nacionalización SOBRE EL PEDIDO ACTUAL (respeta el MC editado)
    // v23.90 — la tasa del embarque sale de sus artículos (cada uno puede tener la suya)
    const _derPed = _derechosPedido(arr, prov);
    const _nacR = _pedImpNacionalizar(totUsd, totM3, { modo: _nac.modo, valorM3: _valorM3P, tn: _nac.tn, ntl: _isNtl, derechos: _derPed, fobInal: _impFobInal(arr, _pedImpUsdOf) });
    // v24.42 — orden por PRIORIDAD: primero lo que tiene menos meses de stock; sin proyección, al final.
    arr.sort(_pedImpPrioCmp);
    const _nBajo = arr.filter(function (it) { const m = _pedImpMesesStock(it); return m != null && m < _PEDIMP_MESES_ALERTA; }).length;
    h += '<div style="border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;margin-bottom:14px;background:#fff">';
    h += '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;padding:10px 13px;background:#f8fafc;border-bottom:1px solid #e2e8f0">' +
      '<div style="min-width:0"><span style="font-size:16px;font-weight:800;color:#0f172a">🏭 ' + escapeHtml(prov) + '</span> <span style="font-size:11px;color:#94a3b8;font-weight:700">· ' + escapeHtml(imp) + '</span>' + _pedImpAlertaBadge(_nBajo) + _pedImpQuiebreBadge(arr.filter(function (it) { return _pedImpQuiebre(it); }).length) + (_isNtl ? ' <span style="font-size:10.5px;font-weight:800;color:#fff;background:#7c3aed;border-radius:999px;padding:1px 7px" title="Factura vía NTL (5% dentro del costo de nacionalización)">NTL</span>' : '') + '<div style="font-size:12px;color:#475569;margin-top:2px">' + arr.length + ' ítem(s) · <b>' + totMC + '</b> master cajas · <b>' + totU.toLocaleString("es-AR") + '</b> u' + (totUsd > 0 ? ' · <span class="pedimp-fob" style="color:#065f46;font-size:16px;font-weight:800;white-space:nowrap" title="FOB del pedido de este proveedor">FOB u$s ' + Math.round(totUsd).toLocaleString("es-AR") + '</span>' : '') + (totM3 > 0 ? ' · <span style="color:#0369a1">' + (Math.round(totM3 * 100) / 100) + ' m³</span>' : '') +
        (totCamUsd > 0 ? ' · <span class="pedimp-camino-fob" style="color:#0369a1;font-weight:800;white-space:nowrap" title="u$s totales de ' + nCam + ' pedido(s) en viaje de este proveedor (los mismos de 🚢 En curso)">en viaje FOB ' + _usd0(totCamUsd) + '</span>' : '') +
        // v24.59 (Thomas) — el consumo por mes (proyección × FOB) vuelve acá, sin el mínimo
        (_burnN > 0 ? ' · <span class="pedimp-consumo" style="color:#b45309;font-weight:700" title="Consumo por mes: Estadística Madre u/mes × FOB de cada artículo">consumo ' + _usd0(_burnN) + '/mes</span>' : '') + '</div></div>' +
      '<div style="display:flex;gap:7px;flex:1 1 auto;min-width:0;max-width:100%;flex-wrap:wrap;align-items:center;justify-content:flex-end">' +   // v24.54 (Thomas): en el celular los botones se cortaban (no se veían los PDF): ahora bajan de línea
      // v23.95 (Luis) — los meses objetivo, a un toque: cambian el objetivo y el «a pedir» de
      // TODOS los códigos de este proveedor (GV_Imp_Proveedor.meses_objetivo).
      _pedImpMesesSel(prov, provEnc) +
      // v23.89 (Luis) — los parámetros de ESTE proveedor se editan acá, no en el módulo de OCs
      '<button class="mva-clear" style="background:#0f766e;color:#fff;border-color:#0f766e" onclick="pedImpCfgAbrir(\'' + provEnc + '\')" title="Derechos, comisión NTL, mínimo, MOQ y los códigos de este proveedor">⚙ Configurar</button>' +
      '<button class="mva-clear" style="background:#1e6bd6;color:#fff;border-color:#1e6bd6" onclick="pedImpPdfProv(\'' + provEnc + '\')" title="PDF del pedido de este proveedor: Código, Master Cajas, Inner Cajas y Unidades (sin FOB)">🖨 PDF pedido</button>' +
      '<button class="mva-clear" style="background:#7c2d12;color:#fff;border-color:#7c2d12" onclick="pedImpPdfDamian(\'' + provEnc + '\')" title="PDF interno para Damián: código, descripción, foto, stock, máximo, pedido en master cajas, FOB y m³, con los totales y cómo se compone el pedido">📄 PDF para Damián</button>' +
      '</div>' +
      '</div>';
    // v22.37 — banda de proyección al mínimo + costo de nacionalización estimado.
    h += _pedImpBandaHtml(_nacR, totUsd, { prov: prov, items: arr, m3: totM3 });
    // v24.32 — anchos explícitos por <colgroup> y la tabla mide EXACTAMENTE lo que suman: hasta
    // la v24.3 Descripción era la única col SIN width y se comía todo el sobrante de la tarjeta
    // (el hueco muerto entre ella y Proy u/mes, que reclamó Luis el 29/09).
    const _cols = [104, 232, 92, 110, 74, 104, 70, 72, 94, 104, 100, 128, 92];
    const _ancho = _cols.reduce(function (a, b) { return a + b; }, 0);
    _anchoMax = Math.max(_anchoMax, _ancho);
    h += '<div class="mva-tblwrap wide"><table class="mva-tbl wide pedimp-tbl" style="min-width:' + _ancho + 'px">' +
      '<colgroup>' + _cols.map(function (w) { return '<col style="width:' + w + 'px">'; }).join('') + '</colgroup>' +
      '<thead><tr><th>Código</th><th>Descripción</th><th class="num" title="Estadística Madre por mes (unidades) y objetivo (unidades a tener)">E.M. u/mes<small>Objetivo</small></th><th class="num" title="Stock de hoy EN VIVO del depósito (los mismos depósitos que la pantalla de Stock) MENOS los pedidos abiertos, más el depósito insumos. Nunca negativo: si hay más pedidos que stock, muestra 0.">Stock</th><th class="num" title="Meses de stock = (stock disponible + en camino) ÷ Estadística Madre por mes. En rojo, menos de 4 meses. Sin Estadística Madre: —. La tabla se ordena por esta columna (menos meses primero).">Meses<small>stock</small></th><th class="num" title="En camino: unidades ya pedidas que no llegaron, con la fecha estimada de llegada (dd/mm)">En camino<small>u · llega</small></th><th class="num" title="A pedir: unidades calculadas para llegar al objetivo">A pedir<small>u</small></th><th class="num" title="Unidades por master caja (del Excel de quiebres / Importados_Volumen).">uni/ master</th><th class="num" title="Master cajas a pedir (editable). Poné 0 para no pedir. Vacío = vuelve al calculado.">MC pedido</th><th class="num" title="Unidades = MC × uni/master · FOB unitario (USD)">Unidades<small>FOB u$s/u</small></th><th class="num" title="u$s = unidades × FOB · m³ = MC × m³/master">u$s<small>m³</small></th><th class="num" title="Fecha estimada de reingreso del importado. Se muestra en el portal LK (Reingreso Est dd/mm) cuando el artículo está sin stock. Vacío = no se muestra.">Reingreso</th><th>Acciones</th></tr></thead><tbody>';
    arr.forEach(function (it) {
      const badge = it.esInsumo ? _pedImpInsumoChip(it) : (it.esParte ? ' <span style="color:#7c3aed" title="Parte">🧩</span>' : '');
      const _stkShow = (Number(it.stockUni) || 0);
      // v23.91 (Luis) — el número YA es el DISPONIBLE (v16.08): lo comprometido se lee en el
      // tooltip, no como un «−N» al lado, que hacía leer dos veces la misma resta.
      const _stkNum = (it.uniPedidas > 0)
        ? '<span title="Disponible: ya descontadas ' + it.uniPedidas + ' u de pedidos abiertos. Si los pedidos superan al stock, da NEGATIVO (v25.61).">' + _stkShow + '</span>'
        : String(_stkShow);
      var stockTxt = (it.stockParteU > 0)
        ? _stkNum + ' <span style="color:#7c3aed;font-weight:700;font-size:12px" title="Incluye ' + it.stockParteU + ' u de la parte ' + escapeHtml(it.stockParteCods || '') + '">🔧+' + it.stockParteU + '</span>'
        : _stkNum;
      // v15.26 — parte: el stock incluye los TERMINADOS que la usan (góndola/racks/a guardar de Virgilio)
      if (it.stockTermU > 0) {
        var _termDet = "";
        try { if (it.parteDet && it.parteDet.length) _termDet = it.parteDet.map(function (d) { return d.cod + ": " + (d.stock_uni != null ? d.stock_uni : "?") + " u"; }).join("  ·  "); } catch (_e) {}
        stockTxt += ' <span style="color:#7c3aed;font-weight:700;font-size:12px" title="Incluye ' + it.stockTermU + ' u de terminados armados con esta parte → ' + escapeHtml(_termDet) + '">🧩+' + it.stockTermU + '</span>';
      }
      // v15.27 — depósito insumos (parte suelta o importado sin reenvasar), convertido a unidades
      // v25.61 — stock en Cervantes (GP2) del componente equivalente, ya sumado al número
      if (it.stockGp2U > 0) stockTxt += ' <span style="color:#b45309;font-weight:700;font-size:12px" title="Incluye ' + it.stockGp2U + ' u del stock de GP2 (Cervantes) del componente equivalente">🏭+' + it.stockGp2U + '</span>';
      if (it.stockConvU > 0) stockTxt += ' <span style="color:#7c3aed;font-weight:700;font-size:12px" title="Incluye ' + it.stockConvU + ' u de stock de otro código de Virgilio que se convierte en éste">🔁+' + it.stockConvU + '</span>';
      if (it.stockInsU > 0) stockTxt += ' <span style="color:#0369a1;font-weight:700;font-size:12px" title="Incluye ' + it.stockInsU + ' u del depósito insumos (Movimientos_Stock, convertido con Insumos_Factores). En una parte, este stock reemplaza al seed del Excel.">🧰' + it.stockInsU + '</span>';
      // v16.08 — lo que se muestra ya es el DISPONIBLE: stock de hoy menos lo pedido, con piso en 0.
      const _codEncV = encodeURIComponent(it.cod);
      const _keyEncV = encodeURIComponent(it.key || it.cod);   // v22.93 — MC, FOB y reingreso van por línea (809E LK / CH)
      /* v24.80 (Luis, 30/09): UN 📦 y UN 📥 por código. Un código puede juntar varios artículos del
         maestro (323ES = 323ES suelto + 323E LK + 838E CH) y antes salía un par de botones por cada uno.
         Con más de uno, el botón abre un selector con cada pedido en viaje y de ahí el popup de siempre. */
      const _dets = it.det || [];
      const _detsEnc = encodeURIComponent(JSON.stringify(_dets.map(function (d) { return { id: d.id, cod: d.cod || it.cod, marca: d.marca || "", prov: d.prov || it.prov || "" }; }))).replace(/'/g, "%27");
      const _hayCurso = _dets.some(function (d) { return Number(d.curso) > 0; });
      const _cervDen = _dets.map(function (d) { return _impCervDen.porImp[d.id]; }).filter(Boolean)[0];   // v25.37
      const actHtml = !_dets.length ? '' : '<div style="margin:1px 0"><span style="white-space:nowrap">' +
          '<button class="stk-btn" style="padding:3px 8px;font-size:14px" title="📦 Baches: cada pedido en curso con su propia fecha de reingreso. Alta, edición y llegadas (total o parcial). El En curso y el Reingreso salen de acá (la fecha más cercana)." onclick="_pedImpAccionConfirmar(\'baches\',\'' + _codEncV + '\',function(){pedImpBachesDe(\'' + _detsEnc + '\',\'' + _codEncV + '\')})">📦</button>' +
          /* v25.66 (Luis, 01/10): el 📥 está SIEMPRE — sin pedido en viaje el pop-up avisa que no hay pedido registrado */
          ' <button class="stk-btn" style="padding:3px 8px;font-size:14px;' + (_hayCurso ? 'background:#0f766e;color:#fff;border-color:#0f766e;' : 'background:#fff;color:#0f766e;border-color:#0f766e;') + 'font-weight:800" title="📥 RECIBIR: recibir lo que llegó de este código: cuánto, de qué empresa y a dónde va (A guardar, góndola, rack, excedente o insumos). Queda en el Historial de recepción.' + (_hayCurso ? '' : ' Este código NO tiene pedido en viaje: se puede recibir igual (queda como SIN PEDIDO).') + '" onclick="_pedImpAccionConfirmar(\'recibir\',\'' + _codEncV + '\',function(){impRecibirCodigo(\'' + _detsEnc + '\')})">📥</button>' + _impCervDenChip(_cervDen, true) + '</span></div>';
      const _m3m = Number(it.m3Master) || 0;
      const _dimTip = it.m3Dims && it.m3Dims.l ? (it.m3Dims.l + '×' + it.m3Dims.a + '×' + it.m3Dims.h + ' cm') : '';
      // v14.97 — uni/master NO se edita desde la tabla (dueño: "al pedo editarlo desde ahí").
      // Con valor: texto plano. Sin valor: se deja el ⚠ clickeable, es el único lugar para cargarlo.
      const umTxt = (it.uniMaster > 0)
        ? '<span title="' + (_dimTip ? escapeHtml(_dimTip) : 'Unidades por master caja') + '">' + it.uniMaster + '</span>'
        : '<span style="cursor:pointer;color:#f59e0b" title="Falta uni por master (cargá el volumen). Sin esto no se puede redondear a master caja." onclick="pedImpEditVol(\'' + _codEncV + '\')">⚠ ✏️</span>';
      const mc = _pedImpMcOf(it);
      const mcInput = '<input type="number" inputmode="numeric" min="0" value="' + mc + '" onchange="pedImpSetMC(\'' + _keyEncV + '\',this.value)" onclick="event.stopPropagation()" style="width:64px;text-align:center;padding:5px 4px;border:2px solid ' + (mc > 0 ? '#0f766e' : '#cbd5e1') + ';border-radius:8px;font-size:14px;font-weight:800;color:#0f172a;background:' + (mc > 0 ? '#f0fdfa' : '#fff') + '">';
      const uni = _pedImpUniOf(it);
      const uniTxt = uni > 0 ? '<b style="color:#b45309">' + uni.toLocaleString("es-AR") + '</b>' : '<span style="color:#cbd5e1">0</span>';
      const _fob = Number(it.fobUni) || 0;
      const fobTxt = _fob > 0
        ? '<span style="cursor:pointer" title="Tocá para editar el FOB" onclick="pedImpEditFob(\'' + _keyEncV + '\')">' + _fob.toFixed(3) + ' <span style="color:#94a3b8;font-size:11px">✏️</span></span>'
        : '<span style="cursor:pointer;color:#cbd5e1" title="Cargar FOB unitario (USD)" onclick="pedImpEditFob(\'' + _keyEncV + '\')">✏️</span>';
      const _usd = _pedImpUsdOf(it);
      const usdTxt = _usd > 0 ? '<b style="color:#065f46">u$s ' + Math.round(_usd).toLocaleString("es-AR") + '</b>' : '<span style="color:#cbd5e1">—</span>';
      const _m3 = _pedImpM3Of(it);
      const m3Txt = _m3 > 0 ? '<b style="color:#0369a1">' + (Math.round(_m3 * 100) / 100) + '</b>' : '<span style="color:#cbd5e1">—</span>';
      const _rg = it.reingresoEst ? String(it.reingresoEst).slice(0, 10) : "";
      const rgInput = _pedImpFechaInputHtml(_rg, "pedImpSetReingreso(\'" + _keyEncV + "\',v)", 'onclick="event.stopPropagation()" title="Fecha de reingreso estimado (se muestra en el portal LK cuando está sin stock)" style="width:76px;padding:2px 6px;border:1px solid ' + (_rg ? '#b45309' : '#cbd5e1') + ';border-radius:8px;font-size:12px;background:' + (_rg ? '#fff7ed' : '#fff') + '"');
      // v23.90 (Luis) — el MISMO pop-up de proyección que la pantalla de Stocks.
      // La proyección se le pasa en CAJAS (la pantalla de importados la muestra en unidades).
      // v23.91 (Luis) — lo que se toca es la CELDA de la proyección, igual que en Stocks; el
      // código volvió a ser texto. Tocar el código para ver una proyección no se adivina.
      const _proyCaj = (Number(it.uxc) > 0) ? (Number(it.proyUni) || 0) / Number(it.uxc) : 0;
      const _proyCell = '<td class="num imp2 pedimp-proy" title="Tocá para ver de dónde sale la Estadística Madre (ventas facturadas de los últimos 12 meses)" onclick="event.stopPropagation();pedImpProyAbrir(\'' + _codEncV + '\',' + (Math.round(_proyCaj * 100) / 100) + ')">' + it.proyUni + '<small>' + it.objetivoUni + '</small></td>';
      h += '<tr><td><b>' + escapeHtml(codCanon(_impCodVista(it))) + '</b>' + _impPlantaChip(it) + badge + '</td><td title="' + escapeHtml(it.desc || "") + '"><span class="imp-desc">' + escapeHtml(artNombre(it.cod, it.desc)) + '</span>' + _pedImpQuiebreChip(it) + '</td>' + _proyCell + '<td class="num pedimp-stk" title="Tocá para ver qué está contando este stock" onclick="event.stopPropagation();pedImpStockDesglose(\'' + _keyEncV + '\')">' + stockTxt + '</td>' + _pedImpMesesCell(it) + '<td class="num">' + _pedImpEnCaminoHtml(it) + '</td><td class="num pedimp-apedir">' + it.aPedirUni + '</td><td class="num">' + umTxt + '</td><td class="num">' + mcInput + '</td><td class="num imp2">' + uniTxt + _pedImpMoqChip(it) + '<small>' + fobTxt + '</small></td><td class="num imp2">' + usdTxt + '<small>' + m3Txt + '</small></td><td class="num">' + rgInput + '<div style="display:flex;flex-wrap:wrap;justify-content:flex-end;column-gap:8px">' + _reingWebSwitchHtml(it.cod, it) + '</div></td><td>' + actHtml + '</td></tr>';
    });
    h += '</tbody></table></div></div>';
  });
  if (!algo) h += '<div class="stkpop-empty">' + (_buscando
    ? ('Ningún importado coincide con <b>' + escapeHtml(_qRaw) + '</b>. Se buscó en los ' + allItems.length + ' importados, de todos los proveedores.')
    : ('No hay importados ' + (soloPedir ? 'para pedir (todo en o sobre el objetivo)' : 'cargados') + '.')) + '</div>';
  // v24.32 (Luis) — "OPTIMIZACIÓN DE ESPACIO": la tarjeta mide lo que mide la tabla. Sin esto
  // la tarjeta iba a 1760px, la tabla estiraba al 100% y todo el sobrante caía en Descripción.
  try { const _card = body.closest ? body.closest(".stkpop-card") : null; if (_card) _card.style.maxWidth = _anchoMax > 0 ? ('min(' + (_anchoMax + 34) + 'px,98vw)') : ''; } catch (_e) {}
  _renderKeepFocus(body, h);   // v22.09 — el buscador re-renderiza en cada tecla: sin esto se pierde el foco
}
/* v10.38 — PDF del pedido de UN proveedor: Código · Master Cajas · Inner Cajas · Unidades (SIN FOB),
   para mandarle al proveedor chino a cotizar. Respeta el MC editado (0 = no va).
   v24.40 — suma INNER CAJAS = unidades ÷ uni_inner (Importados_Volumen). Sin uni_inner cargado va "—":
   no se inventa (medido 29/09: 134 de 155 lo tienen y en los 134 divide exacto a la master). */
function _pedImpInnerOf(it) { const ui = Number(it && it.uniInner) || 0; if (!(ui > 0)) return null; const u = _pedImpUniOf(it); return u > 0 ? Math.round(u / ui * 100) / 100 : 0; }
function pedImpPdfProv(provEnc) {
  const prov = decodeURIComponent(provEnc);
  const data = (_stkPop && _stkPop.data) || { items: [] };
  const arr = (data.items || []).filter(function (it) { return (it.prov || "(sin proveedor)") === prov && _pedImpMcOf(it) > 0; })
    .sort(function (a, b) { return String(codCanon(a.cod)).localeCompare(String(codCanon(b.cod)), undefined, { numeric: true }); });
  if (!arr.length) { try { alert("No hay ítems con pedido (MC > 0) para " + prov + "."); } catch (_e) {} return; }
  const fecha = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
  const th = 'border:1px solid #333;padding:7px 10px;background:#eaeaea;text-align:center;font-weight:800';
  const td = 'border:1px solid #333;padding:7px 10px';
  const tdc = td + ';text-align:center;font-weight:700';
  const fmt = function (n) { return Number(n).toLocaleString("es-AR"); };
  let faltaInner = 0;
  let filas = arr.map(function (it) {
    const inn = _pedImpInnerOf(it); if (inn == null && !it.innerSuelto) faltaInner++;   // v24.50 (Thomas): uni_inner = 0 = viene SUELTO, sin inner (no es un dato que falta)
    return '<tr><td style="' + tdc + '"><b>' + escapeHtml(codCanon(_impCodVista(it)) + (_impPlantaVista(it) ? " " + _impPlantaVista(it) : "")) + '</b></td><td style="' + tdc + '">' + fmt(_pedImpMcOf(it)) + '</td><td style="' + tdc + '">' + (inn == null ? (it.innerSuelto ? 'suelto' : '—') : fmt(inn)) + '</td><td style="' + tdc + '">' + fmt(_pedImpUniOf(it)) + '</td></tr>';
  }).join("");
  const totMC = arr.reduce(function (s, it) { return s + _pedImpMcOf(it); }, 0);
  const totI = arr.reduce(function (s, it) { const v = _pedImpInnerOf(it); return s + (v || 0); }, 0);
  const totU = arr.reduce(function (s, it) { return s + _pedImpUniOf(it); }, 0);
  filas += '<tr><td style="' + tdc + ';font-weight:800;background:#f4f4f4">TOTAL</td><td style="' + tdc + ';background:#f4f4f4">' + fmt(totMC) + '</td><td style="' + tdc + ';background:#f4f4f4">' + fmt(totI) + (faltaInner ? '*' : '') + '</td><td style="' + tdc + ';background:#f4f4f4">' + fmt(totU) + '</td></tr>';
  const inner = '<div style="text-align:center;font-weight:800;font-size:1.5em;margin-bottom:2px">PEDIDO · ' + escapeHtml(prov) + '</div>' +
    '<div style="text-align:center;color:#555;margin-bottom:12px">Producción Virgilio — ' + fecha + ' — ' + arr.length + ' artículo(s)</div>' +
    '<table style="margin:0 auto;border-collapse:collapse;font-size:1.05em"><thead><tr><th style="' + th + '">Código</th><th style="' + th + '">Master Cajas</th><th style="' + th + '">Inner Cajas</th><th style="' + th + '">Unidades</th></tr></thead><tbody>' + filas + '</tbody></table>' +
    (faltaInner ? '<div style="text-align:center;color:#555;font-size:.85em;margin-top:6px">* ' + faltaInner + ' artículo(s) sin unidades por inner cargadas (—): no suman al total de inner.</div>' : '');
  remitoPrintDoc(inner);
}
/* v24.42 — PDF PARA DAMIÁN (interno): por proveedor, ordenado por PRIORIDAD (menos meses de stock
   primero). Columnas: Código · Descripción · Foto · Stock (y sus meses) · Máximo (con los meses
   objetivo arriba) · Pedido en MASTER CAJAS (las unidades abajo) · FOB (total arriba) · m³ (total
   arriba). Abajo, el resumen de cómo se compone el pedido que arma el programa.
   La foto es la de la página LK (products-images/<cod>.webp); si no está, prueba la de Chef y, si
   tampoco, dice "sin foto". Medido 29/09: 97 de 150 importados tienen foto en LK. */
const _PEDIMP_FOTO_LK = "https://kwkclwhmoygunqmlegrg.supabase.co/storage/v1/object/public/products-images/";
const _PEDIMP_FOTO_CH = "https://nkhzocgdpwtgrmwleihr.supabase.co/storage/v1/object/public/products-images/";
// v24.47 (Thomas) — artículos sin foto propia que usan la de otro: misma foto, otro código.
// La clave "COD|CH" vale sólo para el artículo de esa empresa (el 809E de LK sigue con su foto).
const _PEDIMP_FOTO_ALIAS = { "838E": "323E", "877E": "809E", "198E": "598E", "692E": "816E",
  "809E|CH": "574E", "437E|CH": "437E", "438E|CH": "438E", "439E|CH": "439E" };
function _pedImpFotoHtml(cod, emp) {
  let c0 = String(cod || "").trim().toUpperCase();
  const _al = _PEDIMP_FOTO_ALIAS[c0 + "|" + (emp || "")] || _PEDIMP_FOTO_ALIAS[c0];
  if (_al) { c0 = _al; emp = ""; }   // la foto es de otro artículo: LK primero (877E → 809E de Loeke)
  if (!c0) return '<span class="sf">sin foto</span>';
  // v24.43 — las mismas variantes que usa la página LK (script.js / osa): el código, con o sin «E»,
  // y sin el sufijo de suelto/parte (323ES → 323E, 505C → 505). Después, el bucket de Chef.
  // Medido 29/09: con las variantes LK encuentra 106 de 150 importados (97 sin ellas).
  const alts = [c0, /E$/.test(c0) ? c0.slice(0, -1) : c0 + "E", c0.replace(/(E)[SD]$/, "$1"), c0.replace(/[A-Z]+$/, "")];
  const urls = [];
  // v24.45 — la página de Chef (paginach, script.js) guarda las fotos en .jpg, no en .webp.
  // v24.46 — el mismo número en LK y en Chef son artículos DISTINTOS (regla de la L): un artículo de
  // una empresa busca sólo en SU bucket. Sin empresa conocida, LK y después Chef.
  const bxs = emp === "CH" ? [[_PEDIMP_FOTO_CH, ".jpg"]] : emp === "LK" ? [[_PEDIMP_FOTO_LK, ".webp"]] : [[_PEDIMP_FOTO_LK, ".webp"], [_PEDIMP_FOTO_CH, ".jpg"]];
  bxs.forEach(function (bx) { alts.forEach(function (a) { const u = bx[0] + encodeURIComponent(a) + bx[1]; if (a && urls.indexOf(u) < 0) urls.push(u); }); });
  return '<img src="' + urls[0] + '" data-alts="' + urls.slice(1).join("|") + '" onerror="var l=(this.dataset.alts||\'\').split(\'|\').filter(Boolean);if(l.length){this.dataset.alts=l.slice(1).join(\'|\');this.src=l[0];}else{this.outerHTML=\'<span class=sf>sin foto</span>\';}">';
}
function _pedImpEmpFoto(it) {
  if (it && it.esInsumo) return "";   // v25.01 — el insumo no tiene empresa
  const pl = _impPlantaVista(it); if (pl) return String(pl).toUpperCase();
  const ms = (it && it.det || []).map(function (d) { return String(d.marca || "").trim().toUpperCase(); }).filter(Boolean);
  if (!ms.length) return "";
  if (ms.every(function (m) { return m === "CH"; })) return "CH";
  if (ms.every(function (m) { return m !== "CH"; })) return "LK";
  return "";
}
function _pedImpDamianData(prov) {
  const data = (_stkPop && _stkPop.data) || { items: [] };
  const arr = (data.items || []).filter(function (it) { return (it.prov || "(sin proveedor)") === prov && _pedImpMcOf(it) > 0; }).sort(_pedImpPrioCmp);
  const tot = arr.reduce(function (s, it) { s.mc += _pedImpMcOf(it); s.u += _pedImpUniOf(it); s.usd += _pedImpUsdOf(it); s.m3 += _pedImpM3Of(it); return s; }, { mc: 0, u: 0, usd: 0, m3: 0 });
  const meses = []; arr.forEach(function (it) { const m = Number(it.meses) || Number(data.meses) || 0; if (m && meses.indexOf(m) < 0) meses.push(m); });
  meses.sort(function (a, b) { return a - b; });
  return { arr: arr, tot: tot, meses: meses, mesesGral: Number(data.meses) || 10 };
}
/* v24.55 — en el PDF para Damián, al costado del renglón que la regla del 80 % del MOQ ESTIRÓ:
   «↑ 80% MOQ» y abajo «N m» (los meses de cobertura que quedan). Lo que no se pide va a la hoja «Sin pedir». */
function _pedImpMoqPdf(it) {
  const ov = (_stkPop && _stkPop.mcOverride) ? _stkPop.mcOverride[it.key || it.cod] : undefined;
  if (ov != null) return "";
  const m = _pedImpMoqCalc(it); if (m.estado !== "estira") return "";
  // v26.31 (Luis: "optimización horizontal absoluta") — en 2 renglones: la columna queda la mitad de ancha.
  return '<span class="moq">↑ ' + Math.round(m.pct * 100) + '% MOQ<br>' + (Math.round(m.mesesNec * 10) / 10).toLocaleString("es-AR") + ' m</span>';
}
/* v25.13 (Thomas) — las HOJAS del PDF para Damián de UN proveedor (pedido · sin pedir · discontinuos).
   La usa 📄 PDF para Damián (un proveedor) y 🖨 IMPRIMIR PDF con un solo proveedor tildado.
   opt.soloPed → sólo la hoja del pedido. Devuelve null si el proveedor no tiene ningún ítem,
   "" si con opt.soloPed no pide nada. Las hojas las arma _pedImpDamianPartes. */
async function _pedImpDamianHojas(prov, opt) {
  const p = await _pedImpDamianPartes([prov], opt);
  return p == null ? null : p.ped + p.sin + p.disc;
}
/* v26.31 (Luis, 02/10): «cuando se imprime el PDF y se eligen múltiples proveedores debería agrupar en
   con pedido (todos los proveedores discriminando), sin pedido (todos los proveedores discriminando),
   discontinuo (todos los proveedores discriminando)». Devuelve las TRES hojas por separado
   ({ ped, sin, disc }, "" la que no tiene nada), cada una con TODOS los proveedores pedidos:
   - con UN proveedor, igual que siempre: el nombre va en el título («Pedido Fujian 02/oct»);
   - con VARIOS, una sola tabla por hoja («Pedido 02/oct», con el total general arriba) y cada
     proveedor en su renglón-rótulo (tr.prov) con SUS totales en las mismas columnas. Una sola
     tabla = las columnas alineadas entre proveedores y el ancho lo da el dato más ancho de todos.
   ⚠ v26.39: 🖨 IMPRIMIR PDF ya no la llama con varios proveedores (va una por proveedor, ver
   pedImpRepImprimir); el modo de varios queda sin llamador.
   opt.soloPed → sólo la hoja del pedido. opt.discAll → los discontinuos ya leídos
   (_pedImpDamianDisc; null = no se pudieron leer). null si ningún proveedor tiene ítems. */
async function _pedImpDamianPartes(provs, opt) {
  opt = opt || {};
  const data = (_stkPop && _stkPop.data) || { items: [] };
  const G = provs.map(function (prov) {
    const d = _pedImpDamianData(prov);
    // v24.55 (Thomas): 3 hojas — 1) pedido · 2) lo que NO se pide, por meses de stock · 3) discontinuos.
    const sinPedir = (data.items || []).filter(function (it) { return (it.prov || "(sin proveedor)") === prov && !(_pedImpMcOf(it) > 0); }).sort(_pedImpPrioCmp);
    return { prov: prov, arr: d.arr, tot: d.tot, sinPedir: sinPedir, mesesTxt: d.meses.length ? d.meses.join(" / ") : String(d.mesesGral) };
  }).filter(function (g) { return g.arr.length || g.sinPedir.length; });
  if (!G.length) return null;
  const multi = G.length > 1;
  const fmt = function (n, dec) { return Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 }); };
  // v24.55 (Thomas: "optimizá las columnas al máximo") — cuadro sinóptico: ancho según el dato,
  // rótulos de 2 líneas con la unidad UNA vez arriba, todo centrado, sin relleno ni color.
  const ddmm = function (f) { return _pedImpDdmm(f); };
  // el título lleva la fecha de HOY como dd/mmm (29/sep), hora de Buenos Aires.
  const hoyTxt = (function () { try { const s = new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });   // AAAA-MM-DD
    return s.slice(8, 10) + "/" + ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"][Number(s.slice(5, 7)) - 1]; } catch (_e) { return ""; } })();
  // con varios proveedores el nombre NO va en el título: va en el renglón-rótulo de cada uno.
  const titulo = function (t, gs) { return t + (multi ? '' : ' ' + escapeHtml(gs[0].prov)) + ' ' + hoyTxt; };
  const banda = function (g, n, resto) { return '<tr class="prov"><td colspan="' + n + '">' + escapeHtml(g.prov) + '</td>' + (resto || '') + '</tr>'; };
  const desc = function (it) { return escapeHtml(String(artNombre(it.cod, it.desc) || "").replace(/⌀/g, "Ø")).replace(/Ø /g, "Ø "); };   // el ⌀ no está en la fuente del PDF
  const foto = function (it) { return it.esParte ? '<span class="sf">insumo</span>' : _pedImpFotoHtml(codCanon(it.cod), _pedImpEmpFoto(it)); };   // v24.44: los insumos van sin foto
  // v25.13 (Thomas) — debajo del código, «INAL» si el artículo tiene certificado (GV_Articulo_INAL).
  const inalTag = function (x) { return x && x.inal ? '<small class="inal" title="' + escapeHtml("Certificado INAL " + (x.cert || "") + (x.vence ? " · vence " + x.vence : "")) + '">INAL</small>' : ''; };
  const codTxt = function (it) { return escapeHtml(codCanon(_impCodVista(it))) + inalTag(_impExtraDe(it)); };
  // v25.3 (Thomas) — la MARCA del maestro Importados (LK / CH / Loke) en su propia columna. Reemplaza la
  // chapa de planta pegada al código (809E LK): sale del mismo dato. Sin marca cargada, la planta; sin nada, —.
  const marcaDe = function (it) { const ms = [], ks = [];
    (it.det || []).forEach(function (x) { const m = String(x.marca || "").trim(); if (m && ks.indexOf(m.toUpperCase()) < 0) { ks.push(m.toUpperCase()); ms.push(m); } });
    return ms.length ? ms.join("/") : (_impPlantaVista(it) || ""); };
  const marcaTd = function (it) { return '<td>' + escapeHtml(marcaDe(it) || "—") + '</td>'; };
  // v25.13 (Thomas): «agrupados por tipo de producto — ej. coladores 8 cm van las 3 marcas juntas».
  // El tipo sale de GV_Producto_Tipo (su Excel de equivalencias). Un grupo va donde cae su artículo
  // más URGENTE (la lista ya viene por prioridad) y adentro LK · CH · Loke. Sin tipo, el artículo es
  // su propio grupo. La primera fila de cada grupo lleva la raya de arriba gruesa (tr.g1).
  const _ordMarca = { LK: 0, CH: 1, LOKE: 2 };
  const agrupar = function (lista) {
    const gs = [], idx = {};
    lista.forEach(function (it, i) {
      const t = _impExtraDe(it).tipo, k = t ? "T|" + t : "C|" + (it.key || it.cod) + "|" + i;
      if (idx[k] == null) { idx[k] = gs.length; gs.push([]); }
      gs[idx[k]].push({ it: it, i: i });
    });
    const out = [];
    gs.forEach(function (g) {
      g.sort(function (a, b) { const ma = _ordMarca[marcaDe(a.it).toUpperCase()], mb = _ordMarca[marcaDe(b.it).toUpperCase()];
        return ((ma == null ? 3 : ma) - (mb == null ? 3 : mb)) || (a.i - b.i); });
      g.forEach(function (x, j) { out.push({ it: x.it, g1: j === 0 }); });
    });
    return out;
  };
  const trG = function (g1) { return g1 ? '<tr class="g1">' : '<tr>'; };
  const stockTd = function (it) { const m = _pedImpMesesStock(it), bajo = m != null && m < _PEDIMP_MESES_ALERTA;
    return '<td>' + fmt((Number(it.stockUni) || 0)) + '<small>' + (bajo ? '⚠ ' : '') + (m == null ? 's/proy' : _pedImpMesesFmt(m) + ' m') + '</small></td>'; };
  // «Llegan» sólo si algo del set viene en camino; si todo llega el MISMO día, la fecha va una vez en el rótulo.
  // v26.34 (Luis: "tiene que figurar el FOB de lo que llegó para comparar con el pedido") — con conFob, abajo
  // de las unidades va el FOB u$s de lo que viene (unidades en camino × FOB unitario: la MISMA cuenta que la
  // solapa 🚢 En curso, gv_imp_pedidos_historial), así se lee al lado del FOB del pedido nuevo.
  // v26.37 (Luis: "que guarde el FOB del pedido en curso") — cada bache guarda el FOB con que se pidió
  // (GV_Importados_Baches.fob_uni); lo que viene se valoriza con ESE precio (gv_importados_curso_fob, por
  // artículo del maestro = it.det[].id). Lo que esa lectura no cubre —o si falla— va con el FOB de hoy.
  const fobCur = ("cursoFob" in opt) ? opt.cursoFob : await _pedImpCursoFob();
  const usdCam = function (it) { return _pedImpUsdCamino(it, fobCur); };
  const camino = function (lista, conFob) {
    const con = lista.filter(function (it) { return (Number(it.enCurso) || 0) > 0; });
    const fs = con.map(function (it) { return ddmm(it.reingresoEst) || "s/f"; }).filter(function (x, k, a) { return a.indexOf(x) === k; });
    const una = fs.length === 1 ? fs[0] : "";
    return { hay: con.length > 0, una: una,
      // v26.37 (Luis: "que la fecha de llegada se vea un poquito más grande, al mismo tamaño de en curso") — .fl
      // v26.40 (Luis: "que figure el monto del pedido en usd arriba de en curso") — con conFob el u$s de lo que
      // viene va ARRIBA de las unidades (.fobl), después las unidades y abajo la fecha.
      th: '<th>Llegan<small>' + (conFob ? 'u$s · u' : 'u') + (una ? '' : ' · dd/mm') + '</small>' + (una ? '<span class="fl">' + una + '</span>' : '') + '</th>',
      td: function (it) { const cam = Math.max(0, Number(it.enCurso) || 0), f = ddmm(it.reingresoEst), u = usdCam(it);
        return '<td>' + (cam > 0 ? (conFob ? '<span class="fobl">' + (u > 0 ? fmt(u) : 's/FOB') + '</span>' : '') + fmt(cam) +
          (una ? '' : '<span class="fl">' + (f || 's/f') + '</span>') : '—') + '</td>'; } };
  };
  const maxTd = function (it) { return '<td>' + fmt(it.objetivoUni) + '<small>' + fmt(it.proyUni) + '/mes</small></td>'; };
  const todos = function (gs, k) { return [].concat.apply([], gs.map(function (g) { return g[k]; })); };
  const out = { ped: "", sin: "", disc: "" };

  // ── Hoja 1: el pedido ──
  const GP = G.filter(function (g) { return g.arr.length; });
  if (GP.length) {
    const lista = todos(GP, "arr");
    const cm = camino(lista, true), nL = cm.hay ? 7 : 6;
    const hayMoq = lista.some(function (it) { return !!_pedImpMoqPdf(it); });   // el aviso del 80 % del MOQ, A LA DERECHA
    const nota = hayMoq ? '<td class="nota"></td>' : '';
    const T = GP.reduce(function (s, g) { s.usd += g.tot.usd; s.m3 += g.tot.m3; return s; }, { usd: 0, m3: 0 });
    // el FOB de lo que llega, sumado: arriba de «Llegan» (el general) y en el rótulo de cada proveedor
    const usdCamDe = function (arr) { return arr.reduce(function (s, it) { return s + usdCam(it); }, 0); };
    const camTot = function (arr) { const u = usdCamDe(arr); return u > 0 ? fmt(u) : '—'; };
    // los meses del máximo arriba de Máx: con varios proveedores, una vez si todos piden a los mismos meses.
    const mesesH = GP.every(function (g) { return g.mesesTxt === GP[0].mesesTxt; }) ? GP[0].mesesTxt + ' m' : '';
    const filas = GP.map(function (g) {
      return (multi ? banda(g, 6, (cm.hay ? '<td class="tot">' + camTot(g.arr) + '</td>' : '') + '<td class="tot">' + g.mesesTxt + ' m</td><td></td><td class="sp"></td><td class="tot">' + fmt(g.tot.usd) + '</td><td class="tot">' + fmt(g.tot.m3, 1) + '</td>' + nota) : '') +
        agrupar(g.arr).map(function (x) {
          const it = x.it, u = _pedImpUniOf(it), usd = _pedImpUsdOf(it), m3 = _pedImpM3Of(it);
          return trG(x.g1) + '<td><b>' + codTxt(it) + '</b></td>' + marcaTd(it) + '<td class="dsc">' + desc(it) + '</td><td class="ft">' + foto(it) + '</td><td class="sp"></td>' + stockTd(it) +
            (cm.hay ? cm.td(it) : '') + maxTd(it) +
            '<td><b>' + fmt(u) + '</b></td><td class="sp"></td>' +   // el pedido SÓLO en unidades (sin MC ni inner)
            '<td>' + (usd > 0 ? fmt(usd) : '—') + '<small>' + (it.fobUni > 0 ? fmt(it.fobUni, 2) + '/u' : 's/FOB') + '</small></td>' +
            '<td>' + (m3 > 0 ? fmt(m3, 1) : '—') + '</td>' + (hayMoq ? '<td class="nota">' + _pedImpMoqPdf(it) + '</td>' : '') + '</tr>';
        }).join("");
    }).join("");
    // los totales en su PROPIA fila, arriba del rótulo (meses del máximo, FOB, m³ — sin total de unidades); a la izquierda, el título.
    const head = '<tr><th colspan="6" class="tit">' + titulo("Pedido", GP) + '</th>' + (cm.hay ? '<th class="tot">' + camTot(lista) + '</th>' : '') + '<th class="tot">' + mesesH + '</th><th rowspan="2">Pedido<small>u</small></th><th class="sp" rowspan="2"></th><th class="tot">' + fmt(T.usd) + '</th><th class="tot">' + fmt(T.m3, 1) + '</th>' + (hayMoq ? '<th class="nota"></th>' : '') + '</tr>' +
      '<tr><th>Cód</th><th>Mca</th><th>Descripción</th><th>Foto</th><th class="sp"></th><th>Stock<small>u · m</small></th>' + (cm.hay ? cm.th : '') + '<th>Máx<small>u</small></th><th>FOB<small>u$s</small></th><th>m³</th>' + (hayMoq ? '<th class="nota"></th>' : '') + '</tr>';
    out.ped = '<div class="hoja"><table><thead>' + head + '</thead><tbody>' + filas + '</tbody></table></div>';
  }

  // ── Hoja 2: lo que NO se pide, ordenado por meses de stock ──
  const GS = opt.soloPed ? [] : G.filter(function (g) { return g.sinPedir.length; });
  if (GS.length) {
    const cm = camino(todos(GS, "sinPedir")), nL = cm.hay ? 7 : 6;
    const motivo = function (it) {
      if (Number(it.aPedirCajas) > 0) { const q = _pedImpMoqCalc(it); return q.estado === "sinproy" ? "sin Est. Madre" : "&lt; " + Math.round(q.pct * 100) + "% MOQ"; }
      return !(Number(it.proyUni) > 0) ? "sin Est. Madre" : "alcanza";
    };
    const filas = GS.map(function (g) {
      return (multi ? banda(g, nL, '<td class="tot">' + g.mesesTxt + ' m</td><td></td>') : '') +
        agrupar(g.sinPedir).map(function (x) {
          const it = x.it;
          return trG(x.g1) + '<td><b>' + codTxt(it) + '</b></td>' + marcaTd(it) + '<td class="dsc">' + desc(it) + '</td><td class="ft">' + foto(it) + '</td><td class="sp"></td>' + stockTd(it) +
            (cm.hay ? cm.td(it) : '') + maxTd(it) + '<td class="pq">' + motivo(it) + '</td></tr>';
        }).join("");
    }).join("");
    out.sin = '<div class="hoja"><table><thead><tr><th colspan="' + (nL + 2) + '" class="tit">' + titulo("Sin pedir", GS) + '</th></tr>' +
      '<tr><th>Cód</th><th>Mca</th><th>Descripción</th><th>Foto</th><th class="sp"></th><th>Stock<small>u · m</small></th>' + (cm.hay ? cm.th : '') + '<th>Máx<small>u' + (multi ? '' : ' · ' + GS[0].mesesTxt + ' m') + '</small></th><th>Por qué</th></tr></thead><tbody>' + filas + '</tbody></table></div>';
  }

  // ── Hoja 3: los discontinuados de esos proveedores (Importados.activo = false) ──
  if (opt.soloPed) return out;
  const da = ("discAll" in opt) ? opt.discAll : await _pedImpDamianDisc(G.map(function (g) { return g.prov; }));
  if (da === null) { out.disc = '<div class="hoja"><div class="tit3">' + titulo("Discontinuos", G) + '</div><div style="text-align:center">No se pudo leer la lista de discontinuos.</div></div>'; return out; }   // no leer no es «no hay»
  const GD = G.map(function (g) { return { prov: g.prov, disc: (da.porProv[g.prov] || []).slice() }; }).filter(function (g) { return g.disc.length; });
  if (GD.length) {
    const mot = da.mot || {};
    const filas = GD.map(function (g) {
      g.disc.sort(function (a, b) { return String(a.cod_art).localeCompare(String(b.cod_art), "es", { numeric: true }); });
      return (multi ? banda(g, 7) : '') + g.disc.map(function (r) {
        const c = String(r.cod_art || "").trim(), em = String(r.marca || "").trim().toUpperCase() === "CH" ? "CH" : "LK";
        const xr = _impExtraRow(c, r.marca);
        return '<tr><td><b>' + escapeHtml(c) + inalTag(xr && xr.inal ? { inal: true, cert: xr.inal_certificado, vence: xr.inal_vence } : null) + '</b></td><td>' + escapeHtml(String(r.marca || "").trim() || "—") + '</td><td class="dsc">' + escapeHtml(String(r.descripcion || "").replace(/⌀/g, "Ø")) + '</td><td class="ft">' + _pedImpFotoHtml(c, em) + '</td><td class="sp"></td>' +
          '<td>' + fmt(Math.max(0, Number(r.stock_total) || 0)) + '</td><td class="dsc">' + escapeHtml(mot[c.toUpperCase()] || "—") + '</td></tr>';
      }).join("");
    }).join("");
    out.disc = '<div class="hoja"><table><thead><tr><th colspan="7" class="tit">' + titulo("Discontinuos", GD) + '</th></tr>' +
      '<tr><th>Cód</th><th>Mca</th><th>Descripción</th><th>Foto</th><th class="sp"></th><th>Stock<small>u</small></th><th>Motivo</th></tr></thead><tbody>' + filas + '</tbody></table></div>';
  }
  return out;
}
/* v25.13 — los discontinuados (Importados.activo = false) de los proveedores pedidos, en UNA lectura,
   agrupados por proveedor, con su motivo. null = no se pudieron leer (no leer no es «no hay»). */
async function _pedImpDamianDisc(provs) {
  try {
    const r = await Promise.all([
      supaFetchAllSafe(SUPABASE_IMPORTADOS_OC_ENDPOINT, "select=cod_art,marca,descripcion,stock_total,proveedor&principal=eq.true&activo=eq.false" +
        (provs.length === 1 ? "&proveedor=eq." + encodeURIComponent(provs[0]) : "")),
      supaFetchAllSafe(SUPABASE_URL + "/rest/v1/Articulos_Discontinuados", "select=cod,motivo").catch(function () { return []; })
    ]);
    const porProv = {}, mot = {};
    (r[0] || []).forEach(function (x) { const pv = String((x && x.proveedor) || (provs.length === 1 ? provs[0] : "")).trim();
      if (!pv || provs.indexOf(pv) < 0) return; (porProv[pv] = porProv[pv] || []).push(x); });
    (r[1] || []).forEach(function (x) { if (x && x.cod) mot[String(x.cod).trim().toUpperCase()] = x.motivo || ""; });
    return { porProv: porProv, mot: mot };
  } catch (_e) { return null; }
}
/* v26.37 (Luis) — el FOB GUARDADO de lo que viene en camino, por artículo del maestro (Importados.id):
   { "<id>": { pend, usd } }. La valoriza con el FOB de cada pedido (el del maestro si el bache es anterior
   a la v26.37). null si no se pudo leer o no devolvió nada (sin sesión de supervisor): entonces el PDF usa
   el FOB de hoy, como antes — "no pude leer" no es "u$s 0". */
async function _pedImpCursoFob() {
  try {
    const rows = await _pedImpRpc("gv_importados_curso_fob", {});
    if (!Array.isArray(rows) || !rows.length) return null;
    const m = {};
    rows.forEach(function (r) { if (r && r.importado_id != null) m[String(r.importado_id)] = { pend: Number(r.pendiente) || 0, usd: Number(r.usd) || 0 }; });
    return m;
  } catch (_e) { return null; }
}
/* v26.39 (Luis, 02/10) — la HOJA RESUMEN del paquete: por proveedor, lo que tiene en curso (u$s), lo que
   se va a pedir (FOB u$s), el % de nacionalización de ESE pedido (no recuperable sobre FOB, la misma cuenta
   de la banda de la pantalla) y la urgencia (_pedImpUrgencia), ordenado del más urgente al menos.
   En curso = los u$s de 🚢 En curso (gv_importados_pedidos_curso); si no se pudo leer, la suma de lo que
   viene en camino de sus artículos. Devuelve { html, orden } (orden = los proveedores por urgencia) o null. */
async function _pedImpResumenHoja(provs, opt) {
  opt = opt || {};
  const data = (_stkPop && _stkPop.data) || { items: [] };
  const nac = data.nac || { modo: "consolidada", valorM3: 110, tn: 0 };
  const viaje = await _pedImpViajeAsegurar();
  const fobCur = ("cursoFob" in opt) ? opt.cursoFob : await _pedImpCursoFob();
  const fmt = function (n, dec) { return Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 }); };
  const F = provs.map(function (prov) {
    const items = (data.items || []).filter(function (it) { return (it.prov || "(sin proveedor)") === prov; });
    if (!items.length) return null;
    const ped = items.filter(function (it) { return _pedImpMcOf(it) > 0; });
    const usd = ped.reduce(function (s, it) { return s + _pedImpUsdOf(it); }, 0);
    const m3 = ped.reduce(function (s, it) { return s + _pedImpM3Of(it); }, 0);
    const curso = viaje ? (Number(viaje[prov]) || 0) : items.reduce(function (s, it) { return s + _pedImpUsdCamino(it, fobCur); }, 0);
    const nr = usd > 0 ? _pedImpNacionalizar(usd, m3, { modo: nac.modo, valorM3: _impProvNum(prov, "valor_m3", nac.valorM3), tn: nac.tn,
      ntl: _esProvNtl(prov), derechos: _derechosPedido(ped, prov), fobInal: _impFobInal(ped, _pedImpUsdOf) }) : null;
    return { prov: prov, curso: curso, usd: usd, m3: m3, nac: nr, urg: _pedImpUrgencia(items) };
  }).filter(Boolean);
  if (!F.length) return null;
  F.sort(function (a, b) { return (a.urg.nivel - b.urg.nivel) || (b.urg.idx - a.urg.idx) || (b.usd - a.usd); });
  const hoyTxt = (function () { try { const t = new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
    return t.slice(8, 10) + "/" + ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"][Number(t.slice(5, 7)) - 1]; } catch (_e) { return ""; } })();
  const nacTd = function (r) {
    if (!r) return '<td>—</td>';
    if (r.sinPeso) return '<td>s/peso<small>avión</small></td>';
    return '<td><b>' + Math.round(r.factor * 100) + ' %</b><small>u$s ' + fmt(r.noRecup) + '</small></td>';
  };
  const urgTd = function (u) {
    if (!u.n) return '<td>SIN Est. Madre</td>';
    return '<td><b>' + u.etiqueta + '</b><small>faltan ' + fmt(u.idx, 1) + ' m · ' + u.c4 + ' &lt; ' + _PEDIMP_MESES_ALERTA + ' m · ' + u.c8 + ' &lt; ' + _PEDIMP_URG_MESES + ' m de ' + u.n +
      (u.quiebran ? ' · ' + u.quiebran + ' quiebra' + (u.quiebran > 1 ? 'n' : '') : '') + '</small></td>';
  };
  const filas = F.map(function (f) {
    return '<tr><td><b>' + escapeHtml(f.prov) + '</b></td><td>' + (f.curso > 0 ? fmt(f.curso) : '—') + '</td>' +
      '<td>' + (f.usd > 0 ? '<b>' + fmt(f.usd) + '</b><small>' + fmt(f.m3, 1) + ' m³</small>' : '—') + '</td>' + nacTd(f.nac) + urgTd(f.urg) + '</tr>';
  }).join("");
  const T = F.reduce(function (s, f) { s.curso += f.curso; s.usd += f.usd; if (f.nac && f.nac.ok) { s.fob += f.usd; s.nr += f.nac.noRecup; } return s; }, { curso: 0, usd: 0, fob: 0, nr: 0 });
  const cuenta = {}; F.forEach(function (f) { cuenta[f.urg.etiqueta] = (cuenta[f.urg.etiqueta] || 0) + 1; });
  const urgTot = ["1", "2", "3", "4", "SIN Est. Madre"].filter(function (k) { return cuenta[k]; }).map(function (k) { return (k.length === 1 ? 'P' + k : k) + ': ' + cuenta[k]; }).join(' · ');
  const tot = '<tr class="tt"><td>Total</td><td>' + (T.curso > 0 ? fmt(T.curso) : '—') + '</td><td>' + (T.usd > 0 ? fmt(T.usd) : '—') + '</td>' +
    '<td>' + (T.fob > 0 ? Math.round(T.nr / T.fob * 100) + ' %<small>u$s ' + fmt(T.nr) + '</small>' : '—') + '</td><td>' + urgTot + '</td></tr>';
  const html = '<div class="hoja res"><table><thead><tr><th colspan="5" class="tit">Resumen ' + hoyTxt + '</th></tr>' +
    '<tr><th>Proveedor</th><th>En curso<small>u$s</small></th><th>A pedir<small>FOB u$s</small></th><th>Nac.<small>no recup.</small></th><th>Prioridad<small>1 = más urgente</small></th></tr></thead>' +
    '<tbody>' + filas + tot + '</tbody></table>' +
    '<div class="ley">Prioridad según los meses que le faltan a la línea para tener ' + _PEDIMP_URG_MESES + ' meses de stock (stock + en camino), ponderado por consumo u$s/mes: 1 = faltan 3 o más · 2 = 2 a 3 · 3 = 1 a 2 · 4 = menos de 1</div></div>';
  // v26.42 — los mismos números van en el mensaje de WhatsApp del reporte quincenal (scripts/reporte-quincenal):
  // se devuelven acá para no volver a sacarlos del HTML.
  const datos = { total: { curso: T.curso, usd: T.usd, nr: T.nr, fob: T.fob },
    filas: F.map(function (f) { return { prov: f.prov, curso: f.curso, usd: f.usd, m3: f.m3, nivel: f.urg.nivel, etiqueta: f.urg.etiqueta }; }) };
  return { html: html, orden: F.map(function (f) { return f.prov; }), datos: datos };
}
/* v25.13 — el documento imprimible con las hojas (de uno o de varios proveedores). */
function _pedImpDamianDoc(titulo, hojas) {
  // v25.3 (Thomas): la hoja va VERTICAL (A4 portrait); la tabla entra en los 194 mm útiles.
  // v26.31 (Luis: "lo más pegadas unas a las otras posibles, optimización horizontal absoluta"):
  // separadores de 2 px (eran 5), Descripción y «Por qué» parten en renglones (entran en el alto de
  // la foto), y los totales en 14 (el título sigue en 16).
  // v26.34 (Luis, con la foto de la columna Máx: "dejalas al mínimo y el ancho de las columnas en sí
  // como la de la foto 1"): los separadores quedan en 2 px y cada columna lleva 4 px de aire por lado
  // (con 1 px «Stock» y «Llegan» se pegaban al borde, foto 2).
  const css = '@page{size:A4 portrait;margin:8mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#111;margin:0;font-size:14px}' +
    '.hoja+.hoja{page-break-before:always;break-before:page}' +
    'th.sp,td.sp{width:2px;min-width:2px;padding:0;border-top:0;border-bottom:0}' +   // v24.55 (Thomas): columna vacía finita que separa bloques
    'table{border-collapse:collapse;margin:0 auto}th,td{border:1px solid #444;padding:1px 4px;vertical-align:middle;text-align:center;white-space:nowrap;line-height:1.1}th{font-size:14px}' +
    'th.tit{font-size:16px;font-weight:800;white-space:normal}.tot{font-weight:800}.tit3{font-size:16px;font-weight:800;text-align:center}.nota{border:0;text-align:left;padding-left:2px}.moq{font-size:10px;font-weight:800;display:block;line-height:1.05}' +
    'th small,td small{display:block;font-weight:400;color:#555;font-size:10px}.fl{display:block;font-size:14px;font-weight:400;color:#111}.fobl{display:block;font-size:13px;font-weight:800;color:#111}.dsc{white-space:normal;max-width:112px;line-height:1}td.pq{white-space:normal;max-width:60px;font-size:12px}' +
    '.ft{padding:0}.ft img{width:42px;height:42px;object-fit:contain;display:block;margin:0 auto}.sf{color:#999;font-size:9px}' +
    'tr{page-break-inside:avoid}thead{display:table-header-group}' +
    'tr.prov>td{font-size:16px;font-weight:800;white-space:normal;border-top:3px solid #111;page-break-after:avoid;break-after:avoid}tr.prov>td.tot{font-size:14px}tr.prov>td.sp{border-top:0}tr.prov>td.nota{border:0}' +   // v26.31: un renglón-rótulo por proveedor
    'tr.g1>td{border-top:2px solid #111}small.inal{color:#0f766e;font-weight:800;font-size:9px}' +
    '.res td,.res th{padding:3px 8px}.res tr.tt>td{font-weight:800;border-top:3px solid #111}.ley{font-size:11px;color:#555;text-align:center;margin-top:6px;max-width:560px;margin-left:auto;margin-right:auto}';   // v26.39: la hoja resumen   // v25.13: raya gruesa = empieza otro tipo de producto
  return '<!doctype html><html><head><meta charset="utf-8"><title>' + escapeHtml(titulo) + '</title><style>' + css + '</style></head><body>' +
    hojas + '</body></html>';
}
async function pedImpPdfDamian(provEnc) {
  const prov = decodeURIComponent(provEnc);
  const hojas = await _pedImpDamianHojas(prov);
  if (hojas == null) { try { alert("No hay ítems de " + prov + "."); } catch (_e) {} return; }
  _pedImpPrintConFotos(_pedImpDamianDoc("Pedido " + prov + " — para Damián", hojas));
}
/* v24.76 (Luis 30/09) — 🖨 IMPRIMIR PDF: reporte de los proveedores elegidos. Una tabla por
   proveedor, del más urgente (menos meses de stock, con lo en camino) al menos urgente; sin
   proyección, al final. m³ y u$s son SÓLO de lo que genera pedido. Arial 15, rótulos centrados en
   2 líneas, ancho según el dato. */
function pedImpRepAbrir() {
  const data = (_stkPop && _stkPop.data) || { items: [] };
  const provs = [];
  (data.items || []).forEach(function (it) { const p = it.prov || "(sin proveedor)"; if (provs.indexOf(p) < 0) provs.push(p); });
  provs.sort(function (a, b) { const ia = _IMPORTADOR_DE[a] || "zz", ib = _IMPORTADOR_DE[b] || "zz"; return String(ia).localeCompare(String(ib)) || String(a).localeCompare(String(b)); });
  if (!provs.length) { try { alert("No hay proveedores cargados."); } catch (_e) {} return; }
  const sel = (_stkPop && _stkPop.provFiltro) || "";
  let ov = document.getElementById("impRepOv"); if (ov) ov.remove();
  ov = document.createElement("div"); ov.id = "impRepOv";
  ov.style.cssText = "position:fixed;inset:0;z-index:100000;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;padding:16px";
  const lab = 'display:flex;align-items:center;gap:8px;font-size:15px;font-weight:700;color:#0f172a;padding:4px 2px;cursor:pointer';
  const chk = 'width:18px;height:18px;margin:0;flex:0 0 auto';
  ov.innerHTML = '<style>#impRepOv button{width:auto;margin-top:0}#impRepOv input{box-sizing:border-box}</style>' +
    '<div style="background:#fff;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.3);padding:14px 16px;max-width:360px;width:100%;max-height:90vh;overflow:auto">' +
    '<div style="font-size:16px;font-weight:800;color:#1e3a8a;margin-bottom:8px;text-align:center">🖨 Reporte PDF</div>' +
    '<label style="' + lab + ';border-bottom:1px solid #e2e8f0;margin-bottom:4px"><input type="checkbox" id="impRepTodos" style="' + chk + '"' + (sel ? '' : ' checked') + ' onchange="Array.prototype.forEach.call(document.querySelectorAll(\'.imp-rep-prov\'),function(c){c.checked=this.checked}.bind(this))"> Todos</label>' +
    provs.map(function (p) { return '<label style="' + lab + '"><input type="checkbox" class="imp-rep-prov" value="' + escapeHtml(p) + '" style="' + chk + '"' + (!sel || sel === p ? ' checked' : '') + '> ' + escapeHtml(p) + '</label>'; }).join('') +
    '<label style="' + lab + ';border-top:1px solid #e2e8f0;margin-top:6px;padding-top:8px"><input type="checkbox" id="impRepSoloPed" style="' + chk + '"> Sólo lo que genera pedido</label>' +
    '<div style="display:flex;gap:8px;justify-content:center;margin-top:12px">' +
    '<button onclick="document.getElementById(\'impRepOv\').remove()" style="padding:7px 14px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;font-size:14px;font-weight:700;cursor:pointer">Cancelar</button>' +
    '<button class="imp-rep-ok" onclick="pedImpRepImprimir()" style="padding:7px 14px;border:1px solid #1e3a8a;border-radius:8px;background:#1e3a8a;color:#fff;font-size:14px;font-weight:800;cursor:pointer">🖨 Imprimir</button>' +
    '</div></div>';
  ov.addEventListener("click", function (e) { if (e.target === ov) ov.remove(); });
  document.body.appendChild(ov);
}
/* v25.13 (Thomas, 30/09): «el de arriba de todo tiene la misma funcionalidad de hoy, que te muestre
   todos, pero con la lógica del PDF de Damián». Mismo pop-up (proveedores tildados + «Sólo lo que
   genera pedido») y vista previa; la salida son las hojas de Damián (pedido · sin pedir · discontinuos;
   con «sólo lo que genera pedido», sólo la hoja del pedido). Retira el reporte de una tabla de la
   v24.76-79 (_pedImpRepHtml).
   v26.39 (Luis, 02/10): «primero un resumen … después las cinco hojitas de lo que tengo que pedir, después
   las cinco de lo que no estoy pidiendo y después las cinco de discontinuos. No que esté por proveedor».
   Con 2+ proveedores: 1) la hoja RESUMEN (_pedImpResumenHoja), 2) una hoja de PEDIDO por proveedor,
   3) una de SIN PEDIR por proveedor, 4) una de DISCONTINUOS por proveedor; cada proveedor en su propia
   hoja (con su nombre en el título) y en el orden de urgencia del resumen. Retira la tabla única con
   renglones-rótulo de la v26.31. Con un solo proveedor, sus hojas como siempre (sin resumen). */
async function pedImpRepImprimir() {
  const provs = Array.prototype.filter.call(document.querySelectorAll("#impRepOv .imp-rep-prov"), function (c) { return c.checked; }).map(function (c) { return c.value; });
  if (!provs.length) { try { alert("Elegí al menos un proveedor."); } catch (_e) {} return; }
  const sp = document.getElementById("impRepSoloPed"), soloPed = !!(sp && sp.checked);
  const btn = document.querySelector("#impRepOv .imp-rep-ok"), txt = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "Armando…"; }
  let hojas = "";
  try {
    // v26.39 (Luis): resumen → pedidos → sin pedir → discontinuos, una hoja por proveedor en cada tanda.
    const cursoFob = await _pedImpCursoFob();
    const discAll = soloPed ? null : await _pedImpDamianDisc(provs);
    let orden = provs.slice(), resumen = "";
    if (provs.length > 1) {
      const r = await _pedImpResumenHoja(provs, { cursoFob: cursoFob, soloPed: soloPed });
      if (r) { resumen = r.html; orden = r.orden; }
    }
    const ped = [], sin = [], disc = [];
    for (let i = 0; i < orden.length; i++) {
      const o = { soloPed: soloPed, cursoFob: cursoFob };
      // los discontinuos se leen UNA vez; si no se pudieron leer, va UNA hoja que lo dice (no una por proveedor)
      if (!soloPed) o.discAll = discAll || { porProv: {}, mot: {} };
      const pt = await _pedImpDamianPartes([orden[i]], o);
      if (!pt) continue;
      if (pt.ped) ped.push(pt.ped);
      if (pt.sin) sin.push(pt.sin);
      if (pt.disc) disc.push(pt.disc);
    }
    if (!soloPed && discAll === null) disc.push('<div class="hoja"><div class="tit3">Discontinuos</div><div style="text-align:center">No se pudo leer la lista de discontinuos.</div></div>');
    const paquete = ped.join("") + sin.join("") + disc.join("");
    if (paquete) hojas = resumen + paquete;
  } finally { if (btn) { btn.disabled = false; btn.textContent = txt; } }
  if (!hojas) { try { alert("No hay artículos para imprimir con esa selección."); } catch (_e) {} return; }
  const hoy = (function () { try { const t = new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }); return t.slice(8, 10) + "/" + t.slice(5, 7) + "/" + t.slice(2, 4); } catch (_e) { return ""; } })();
  pedImpRepVista(_pedImpDamianDoc("Pedidos importación " + hoy + (provs.length === 1 ? " · " + provs[0] : ""), hojas));
}
/* v24.79 (Luis) — vista previa antes de imprimir: la misma hoja en un iframe, con «Imprimir» y «Volver». */
function pedImpRepVista(html) {
  const ov = document.getElementById("impRepOv"); if (!ov) return;
  window._pedImpRepHtmlUlt = html;
  ov.innerHTML = '<style>#impRepOv button{width:auto;margin-top:0}</style>' +
    '<div class="imp-rep-vista" style="background:#fff;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.3);padding:10px;display:flex;flex-direction:column;gap:8px;max-height:94vh;width:min(840px,100%)">' +
    '<div style="display:flex;gap:8px;justify-content:center">' +
    '<button onclick="pedImpRepAbrir()" style="padding:7px 14px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;font-size:14px;font-weight:700;cursor:pointer">← Volver</button>' +
    '<button class="imp-rep-print" onclick="document.getElementById(\'impRepOv\').remove();_pedImpPrintConFotos(window._pedImpRepHtmlUlt)" style="padding:7px 14px;border:1px solid #1e3a8a;border-radius:8px;background:#1e3a8a;color:#fff;font-size:14px;font-weight:800;cursor:pointer">🖨 Imprimir</button>' +
    '<button onclick="document.getElementById(\'impRepOv\').remove()" style="padding:7px 14px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;font-size:14px;font-weight:700;cursor:pointer">✕</button></div>' +
    '<iframe class="imp-rep-prev" style="flex:1 1 auto;width:100%;height:80vh;border:1px solid #cbd5e1;border-radius:6px;background:#fff"></iframe></div>';
  ov.querySelector("iframe.imp-rep-prev").srcdoc = html;
}
/* Imprime en un iframe oculto ESPERANDO las fotos (remitoPrintDoc imprime a los 400 ms y
   saldrían en blanco). Techo de 8 s: una foto que no contesta no traba la impresión. */
function _pedImpPrintConFotos(html) {
  const ifr = document.createElement("iframe");
  ifr.setAttribute("aria-hidden", "true");
  ifr.style.cssText = "position:fixed;left:-10000px;top:0;width:1123px;height:794px;border:0;";
  document.body.appendChild(ifr);
  const w = ifr.contentWindow, doc = w.document;
  doc.open(); doc.write(html); doc.close();
  let fired = false;
  const fire = function () { if (fired) return; fired = true; setTimeout(function () { try { w.focus(); w.print(); } catch (_e) {} setTimeout(function () { try { document.body.removeChild(ifr); } catch (_e2) {} }, 2000); }, 150); };
  const t0 = Date.now();
  (function espera() {
    if (fired) return;
    let pend = 0;
    try { Array.prototype.forEach.call(doc.images, function (im) { if (!im.complete) pend++; }); } catch (_e) {}
    if (pend === 0 || Date.now() - t0 > 8000) fire(); else setTimeout(espera, 200);
  })();
}
/* v10.02 — Bajar a Excel los Pedidos Importación (lo que se está viendo, respeta "Solo lo que hay
   que pedir"). Stock negativo se exporta como 0 (igual que en pantalla). Sin librería (.xls = tabla HTML). */
function pedImpExportExcel() {
  if (!_stkPop || _stkPop.kind !== "pedImp") return;
  var data = _stkPop.data || { items: [] };
  var items = (data.items || []).slice();
  // v22.09 — con el buscador puesto, el Excel baja lo que se está viendo (y el término gana
  // sobre "Solo Pedido", igual que en pantalla).
  var _q = pedImpQTerms();
  // v23.23 (Luis): el Excel baja EXACTAMENTE lo que se ve. Parado en un proveedor se ven todos sus
  // items (aunque no pidan nada, ej. 440E) y el Excel los traía filtrados por "a pedir > 0" y de
  // TODOS los proveedores. Y las MC tocadas a mano (_pedImpMcOf) no llegaban al Excel.
  var _provAllX = [];
  items.forEach(function (it) { var p = it.prov || "(sin proveedor)"; if (_provAllX.indexOf(p) < 0) _provAllX.push(p); });
  var _provSelX = (_stkPop.provFiltro && _provAllX.indexOf(_stkPop.provFiltro) >= 0) ? _stkPop.provFiltro : "";
  if (_q.length) items = items.filter(function (it) { return pedImpMatch(it, _q); });
  else if (_provSelX) items = items.filter(function (it) { return (it.prov || "(sin proveedor)") === _provSelX; });
  else if (_stkPop.soloPedir !== false) items = items.filter(function (it) { return _pedImpMcOf(it) > 0; });
  if (!items.length) { try { alert("No hay ítems para exportar."); } catch (_e) {} return; }
  var esc = function (s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); };
  var fecha = (function () { try { return new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }); } catch (_e) { return "hoy"; } })();
  // Orden: por importador, proveedor, y dentro por A pedir desc (como en pantalla)
  items.sort(function (a, b) {
    var ia = _IMPORTADOR_DE[a.prov || ""] || "(sin importador)", ib = _IMPORTADOR_DE[b.prov || ""] || "(sin importador)";
    if (ia !== ib) return ia < ib ? -1 : 1;
    var pa = a.prov || "", pb = b.prov || ""; if (pa !== pb) return pa < pb ? -1 : 1;
    return _pedImpPrioCmp(a, b);   // v24.42 — mismo orden que la pantalla: menos meses de stock primero
  });
  var html = '<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"><style>td,th{border:1px solid #ccc;padding:3px 7px;font-family:Calibri,Arial,sans-serif;} th{background:#166534;color:#fff;text-align:left;}</style></head><body>';
  html += '<h3>Pedidos Importación — Producción Virgilio (' + esc(fecha) + ', índice ' + (data.meses || 10) + ' meses)' + (_q.length ? ' — búsqueda: ' + esc(_q.join(" ")) : '') + '</h3>';
  html += '<table><tr><th>Importador</th><th>Proveedor</th><th>Codigo</th><th>Descripcion</th><th>E.M. u/mes</th><th>Objetivo</th><th>Stock</th><th>Meses (stock+camino)</th><th>En camino</th><th>Llega</th><th>A pedir u</th><th>Master cjs</th><th>FOB u$s/u</th><th>u$s pedido</th><th>m3/master</th><th>m3 pedido</th></tr>';
  var _totM3 = 0, _totUsd = 0;
  items.forEach(function (it) {
    var imp = _IMPORTADOR_DE[it.prov || ""] || "(sin importador)";
    var stk = (Number(it.stockUni) || 0);   // v25.61 — puede ser negativo (D12)
    var caj = _pedImpMcOf(it);
    var m3m = Number(it.m3Master) || 0, m3t = _pedImpM3Of(it); _totM3 += m3t;
    var fob = Number(it.fobUni) || 0, usd = _pedImpUsdOf(it); _totUsd += usd;
    html += '<tr><td>' + esc(imp) + '</td><td>' + esc(it.prov || "") + '</td><td>' + esc(codCanon(_impCodVista(it)) + (_impPlantaVista(it) ? " " + _impPlantaVista(it) : "")) + '</td><td>' + esc(artNombre(it.cod, it.desc)) + '</td><td>' + (it.proyUni || 0) + '</td><td>' + (it.objetivoUni || 0) + '</td><td>' + stk + '</td><td>' + (_pedImpMesesStock(it) == null ? '' : _pedImpMesesFmt(_pedImpMesesStock(it))) + '</td><td>' + (it.enCurso || 0) + '</td><td>' + esc(_pedImpDdmm(it.reingresoEst)) + '</td><td>' + (it.aPedirUni || 0) + '</td><td>' + caj + '</td><td>' + (fob > 0 ? fob : "") + '</td><td>' + (usd > 0 ? Math.round(usd) : "") + '</td><td>' + (m3m > 0 ? m3m : "") + '</td><td>' + (m3t > 0 ? (Math.round(m3t * 100) / 100) : "") + '</td></tr>';
  });
  html += '<tr><td colspan="13"><b>TOTALES</b></td><td><b>' + Math.round(_totUsd) + '</b></td><td></td><td><b>' + (Math.round(_totM3 * 100) / 100) + '</b></td></tr>';
  html += '</table></body></html>';
  try {
    var blob = new Blob(["﻿" + html], { type: "application/vnd.ms-excel" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a"); a.href = url; a.download = "Pedidos_Importacion_" + fecha + ".xls";
    document.body.appendChild(a); a.click();
    setTimeout(function () { try { document.body.removeChild(a); URL.revokeObjectURL(url); } catch (_e) {} }, 1500);
  } catch (e) { try { alert("No se pudo generar el Excel: " + (e.message || e)); } catch (_e) {} }
}
/* v9.29 — Pedidos Importación operable: editar "en curso" y marcar llegada.
   Ambas acciones van por RPC SECURITY DEFINER (sql/importados_pedidos_rpc.sql) apuntando
   por Importados.id. Tras cada acción se re-consulta el motor y se re-renderiza. */
/* v22.96 (Thomas, 26/09: cierra la v22.81) — las RPC que ESCRIBEN (giros, cuenta corriente, baches, fechas de
   embarque/llegada, NTL, alias, en curso) van con el JWT de la sesión Google del supervisor, no con la clave
   pública: la base las rechaza si no es supervisor (es_supervisor_virgilio). Las de lectura siguen igual. */
const _PED_IMP_RPC_ESCRITURA = ["gv_imp_carga_pedido_set", "gv_imp_cc_deuda_add", "gv_imp_cc_deuda_borrar", "gv_imp_cc_deuda_set",
  "gv_imp_cc_set", "gv_imp_ntl_efectivo_add", "gv_imp_ntl_efectivo_borrar", "gv_imp_pago_add", "gv_imp_pago_borrar",
  "gv_imp_pago_cargas_set", "gv_imp_prov_alias_set", "gv_importado_bache_add", "gv_importado_bache_borrar",
  "gv_importado_bache_editar", "gv_importado_bache_embarque", "gv_importado_bache_llego", "gv_importado_pedido_fechas",
  "gv_importado_pedido_ref", "gv_importados_resync", "importados_marcar_llegada", "importados_set_curso",
  "gv_imp_recibir", "gv_imp_recibir_contexto", "gv_imp_recibir_sin_pedido", "gv_imp_recibir_contexto_sin_pedido", "gv_imp_recepcion_historial", "gv_imp_recepcion_anular",   // v23.45 — sólo authenticated (supervisor)
  "gv_imp_cervantes_denegados",   // v25.37
  "gv_imp_pi_editar", "gv_imp_pi_editores", "gv_imp_pi_ediciones",   // v25.94 — editar una PI (quién, cuándo): sólo supervisor
  "gv_importados_curso_fob"];   // v26.37 — el FOB guardado en cada pedido en curso (lectura, sólo supervisor)
async function _pedImpRpc(fn, body) {
  var headers = { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY, "Content-Type": "application/json" };
  if (_PED_IMP_RPC_ESCRITURA.indexOf(fn) >= 0) {
    headers = await facAuthWriteHeaders({ "Content-Type": "application/json" });
    if (!headers) throw new Error(authNoSesionMsg("Para guardar en Importación necesitás iniciar sesión con Google (supervisor)."));
  }
  var r = await fetch(SUPABASE_URL + "/rest/v1/rpc/" + fn, {
    method: "POST",
    headers: headers,
    body: JSON.stringify(body)
  });
  if (!r.ok) { var t = ""; try { t = await r.text(); } catch (_e) {} throw new Error("HTTP " + r.status + (t ? (" — " + t) : "")); }
  try { return await r.json(); } catch (_e) { return null; }
}
async function pedImpReload() {
  _pedImpViaje.st = "";   // v24.74 — releer el u$s en viaje (pudo entrar o llegar un pedido)
  try { var data = await ocgFetchImportados(); if (_stkPop && _stkPop.kind === "pedImp") { _stkPop.data = data; _pedImpRender(); } } catch (_e) {}
  _impCervDenRepintar();
}
/* v25.37 (30/09) — «Denegado por Cervantes». Lo que se recibe con destino 🏭 Cervantes le aparece a Cervantes
   en Recepción de Insumos de GP2 con Sí / No. Si dice NO, el trigger gv_ingreso_virgilio_denegado vuelve a
   poner el pedido EN VIAJE (le resta lo llegado) y acá se marca con este chip: en la fila del código, en
   📦 Baches, en 📥 RECIBIR y en el Historial [usuario: "en el mismo lugar que se cargaron las 3000 uni del
   rallador que vuelvan a aparecer con un cartelito de «Denegado por Cervantes»"]. Lectura propia con su propio
   catch: si falla, la pantalla anda igual, sin chips. */
var _impCervDen = { porBache: {}, porImp: {}, st: "" };
async function _impCervDenCargar() {
  try {
    var rows = (await _pedImpRpc("gv_imp_cervantes_denegados", {})) || [];
    var pb = {}, pi = {};
    rows.forEach(function (r) { if (!pb[r.bache_id]) pb[r.bache_id] = r; if (!pi[r.importado_id]) pi[r.importado_id] = r; });
    _impCervDen = { porBache: pb, porImp: pi, st: "ok" };
  } catch (_e) { _impCervDen = { porBache: {}, porImp: {}, st: "err" }; }
  return _impCervDen;
}
async function _impCervDenRepintar() {
  var antes = JSON.stringify(Object.keys(_impCervDen.porBache));
  await _impCervDenCargar();
  if (JSON.stringify(Object.keys(_impCervDen.porBache)) !== antes && _stkPop && _stkPop.kind === "pedImp") { try { _pedImpRender(); } catch (_e) {} }
}
function _impCervDenChip(r, corto) {
  if (!r) return "";
  var tip = "Cervantes dijo que NO le llegó" + (Number(r.unidades) > 0 ? " (" + Number(r.unidades).toLocaleString("es-AR") + " u)" : "") +
    (r.denegado_en ? " el " + _isoToDdMmAa(String(r.denegado_en).slice(0, 10)) : "") + (r.motivo ? " — " + r.motivo : "") +
    ". El pedido volvió a estar en viaje: recibilo de nuevo a donde corresponda.";
  return ' <span class="imp-cerv-den" title="' + escapeHtml(tip) + '" style="display:inline-block;background:#fee2e2;color:#b91c1c;border:1px solid #fca5a5;border-radius:999px;padding:1px 7px;font-size:11.5px;font-weight:800;white-space:nowrap">⛔ ' +
    (corto ? "Cervantes" : "Denegado por Cervantes") + '</span>';
}
/* v10.05 — cargar/editar el VOLUMEN de la master caja de un importado. Pide las medidas en cm
   (Largo x Ancho x Alto), calcula m³ = L×A×H/1.000.000 y lo guarda en Importados_Volumen (upsert).
   Se puede ingresar directamente el m³ escribiendo un solo número (ej. 0.045). */
async function pedImpEditVol(codEnc) {
  var cod = decodeURIComponent(codEnc);
  var cur = null;
  try {
    var data = (_stkPop && _stkPop.data) || {};
    (data.items || []).some(function (it) { if (String(it.cod).toUpperCase().trim() === cod.toUpperCase().trim()) { cur = it; return true; } return false; });
  } catch (_e) {}
  var prev = (cur && cur.m3Dims && cur.m3Dims.l) ? (cur.m3Dims.l + "x" + cur.m3Dims.a + "x" + cur.m3Dims.h) : (cur && cur.m3Master > 0 ? String(cur.m3Master) : "");
  var val = prompt("Medidas de la MASTER caja de " + codCanon(cod) + " en cm (Largo x Ancho x Alto).\nEj: 60x40x30\n\n(O escribí directo el m³ de la master, ej: 0.072)", prev);
  if (val === null) return;
  val = String(val).trim().toLowerCase().replace(/,/g, ".");
  var l = 0, a = 0, h = 0, m3 = 0;
  var parts = val.split(/[x*×]/).map(function (s) { return parseFloat(s.replace(/[^0-9.]/g, "")); }).filter(function (n) { return !isNaN(n); });
  if (parts.length >= 3) {
    l = parts[0]; a = parts[1]; h = parts[2];
    m3 = (l * a * h) / 1000000;
  } else if (parts.length === 1) {
    m3 = parts[0];   // ingresó el m³ directo
  } else {
    try { alert("No entendí las medidas. Usá 60x40x30 (cm) o un m³ directo como 0.072."); } catch (_e) {}
    return;
  }
  m3 = Math.round(m3 * 1000000) / 1000000;
  try {
    await _impEscribir("Importados_Volumen?on_conflict=cod", "POST",
      { cod: cod, largo_cm: l || null, ancho_cm: a || null, alto_cm: h || null, m3_master: m3, actualizado: new Date().toISOString() },
      "resolution=merge-duplicates,return=minimal");
    await pedImpReload();
  } catch (e) { try { alert("No se pudo guardar el volumen: " + (e.message || e)); } catch (_e) {} }
}
/* v10.06 — editar el FOB unitario (USD) de un importado. Escribe fob_uni en TODAS las filas del
   código en Importados (todas las marcas/plantas comparten el mismo FOB del proveedor). */
async function pedImpEditFob(codEnc) {
  var cod = decodeURIComponent(codEnc);
  var cur = 0, curIt = null;
  try {
    curIt = _pedImpItemPorClave(cod);   // v22.93 — llega la clave de la línea (809E|CH), no el código
    if (curIt) { cod = curIt.cod; cur = Number(curIt.fobUni) || 0; }
  } catch (_e) {}
  var val = prompt("FOB unitario (USD por unidad) de " + (curIt ? codCanon(_impCodVista(curIt)) + (_impPlantaVista(curIt) ? " " + _impPlantaVista(curIt) : "") : codCanon(cod)) + ":", cur > 0 ? String(cur) : "");
  if (val === null) return;
  val = String(val).trim().replace(/,/g, ".").replace(/[^0-9.]/g, "");
  var fob = parseFloat(val);
  if (isNaN(fob) || fob < 0) { try { alert("FOB inválido."); } catch (_e) {} return; }
  fob = Math.round(fob * 100000) / 100000;
  try {
    await _impEscribir("Importados?" + _pedImpFiltroFilas(curIt, cod), "PATCH",
      { fob_uni: fob, actualizado: new Date().toISOString() });
    await pedImpReload();
  } catch (e) { try { alert("No se pudo guardar el FOB: " + (e.message || e)); } catch (_e) {} }
}
// v25.12 (Luis, 30/09): *"desmarqué «cartel» pero sigue apareciendo en la página"*. Las páginas leen
// una copia (reingreso_cache de LK) que el cron 39 de LK rehace cada 5 min; tocar un switch
// esperaba hasta esa corrida. Ahora cada cambio del cartel, de la fecha de reingreso o de la
// entrega global le pide a LK que rehaga YA sólo el cartel (sync_reingresos_cartel_virgilio,
// ~1,6 s; la sync entera tarda ~11 s y anon corta a los 3 s). El switch «Web» sigue en ≤ 5 min.
// Si falla, el cron la rehace igual: no se avisa error, porque el dato ya quedó guardado.
var _impSyncT = null;
function _impSyncPaginas() {
  try {
    if (typeof PWEB_LK_URL === "undefined" || typeof PWEB_LK_ANON === "undefined") return;
    clearTimeout(_impSyncT);
    _impSyncT = setTimeout(function () {
      fetch(PWEB_LK_URL + "/rest/v1/rpc/sync_reingresos_cartel_virgilio", {
        method: "POST",
        headers: { apikey: PWEB_LK_ANON, Authorization: "Bearer " + PWEB_LK_ANON, "Content-Type": "application/json" },
        body: "{}"
      }).catch(function () {});
    }, 800);
  } catch (_e) {}
}
// v22.07 (Luis, 23/09) — switch "Cartel web" por importado: prende/apaga el badge de
// reingreso de las páginas y el partido del pedido. OFF = fila en GV_Reingreso_Excluido
// (la lee gv_reingresos_feed). Lectura anon (gv_reingreso_excluidos), escritura supervisor
// (gv_reingreso_web_set). Mientras no se cargó la lista, el switch no se dibuja: un ON
// supuesto sería mentir.
var _reingExcl = null, _reingExclCargando = false, _webOcul = null;
function _reingNorm(cod) {   // ≡ gv_cod_stock
  var s = String(cod == null ? "" : cod).toUpperCase().trim();
  s = s.replace(/\s*·.*$/, "").replace(/\s+(LK|CH|LOKE)$/, "").replace(/^0+(?=.)/, "").replace(/([0-9E])L$/, "$1");
  return s.trim();
}
async function _reingExclCargar() {
  _reingExclCargando = true;
  try {
    var r = await fetch(SUPABASE_URL + "/rest/v1/rpc/gv_reingreso_excluidos", {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY, "Content-Type": "application/json" },
      body: "{}"
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    var rows = await r.json();
    _reingExcl = new Set((rows || []).map(function (x) { return _reingNorm(x.cod); }));
  } catch (_e) { _reingExclCargando = false; return; }
  // v22.23 — lista del switch "Web" (visible / oculto en la página). Llamada propia: si falla,
  // el switch "Web" no se dibuja y el de "Cartel web" sigue andando.
  try {
    var r2 = await fetch(SUPABASE_URL + "/rest/v1/rpc/gv_web_ocultos", {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY, "Content-Type": "application/json" },
      body: "{}"
    });
    if (!r2.ok) throw new Error("HTTP " + r2.status);
    var rows2 = await r2.json();
    _webOcul = new Set((rows2 || []).map(function (x) { return _reingNorm(x.cod) + "|" + (x.empresa === "CH" ? "CH" : "LK"); }));
  } catch (_e) { _webOcul = null; }
  _reingExclCargando = false;
  try { if (_stkPop && _stkPop.kind === "pedImp") _pedImpRender(); } catch (_e) {}
}
// v22.23 (Luis, 24/09) — switch "Web" por importado: OFF = el artículo NO aparece en la
// página ni se puede pedir (active=false). v22.26: POR EMPRESA, según la marca del importado
// (LK/Loke → página LK; CH → página de Chef): el mismo número puede ser otro artículo en cada
// una. Lista en GV_Web_Oculto (cod, empresa); la aplica sync_reingresos_virgilio de LK cada
// 5 min, y sólo reactiva lo que ocultó este switch.
function _webEmpresasDe(it) {
  var out = [];
  ((it && it.det) || []).forEach(function (d) {
    var m = String(d.marca || "").trim().toUpperCase();
    var e = (m === "CH" || m === "CHEF") ? "CH" : "LK";
    if (out.indexOf(e) < 0) out.push(e);
  });
  if (!out.length) out.push("LK");
  return out.sort();
}
function _webVisibleSwitchHtml(cod, it) {
  if (!_webOcul) return "";
  var enc = encodeURIComponent(String(cod));
  var emps = _webEmpresasDe(it), dos = emps.length > 1;
  return emps.map(function (emp) {
    var on = !_webOcul.has(_reingNorm(cod) + "|" + emp);
    var pag = emp === "CH" ? "Chef" : "LK";
    return '<label onclick="event.stopPropagation()" style="display:inline-flex;align-items:center;gap:3px;margin:2px 0 0 0;font-size:11px;line-height:1;white-space:nowrap;cursor:pointer;font-weight:' + (on ? '400' : '800') + ';color:' + (on ? '#065f46' : '#b91c1c') + '" title="Artículo en la página ' + pag + ': ON = se ve y se puede pedir. OFF = oculto, no se puede pedir. Se aplica en hasta 5 min.">'
      + '<input type="checkbox" style="margin:0" data-emp="' + emp + '"' + (on ? ' checked' : '') + ' onchange="pedImpWebVisible(\'' + enc + '\',this.checked,\'' + emp + '\')">Web' + (dos || emp === "CH" ? ' ' + pag : '') + (on ? '' : ' OCULTO') + '</label>';   // v24.62 — corto y al lado del cartel
  }).join("");
}
async function pedImpWebVisible(codEnc, on, emp) {
  var cod = decodeURIComponent(codEnc);
  emp = emp === "CH" ? "CH" : "LK";
  var pag = emp === "CH" ? "Chef" : "LK";
  if (!on && !confirm("¿Ocultar " + cod + " de la página " + pag + "?\n\nNo va a aparecer ni se va a poder pedir (en hasta 5 minutos).")) { _pedImpRender(); return; }
  var headers = await facAuthWriteHeaders({ "Content-Type": "application/json" });
  if (!headers) { alert(authNoSesionMsg("Para ocultar o mostrar un artículo en la página necesitás iniciar sesión con Google (supervisor).")); _pedImpRender(); return; }
  try {
    var r = await fetch(SUPABASE_URL + "/rest/v1/rpc/gv_web_oculto_set", {
      method: "POST", headers: headers, body: JSON.stringify({ p_cod: cod, p_visible: !!on, p_empresa: emp })
    });
    if (!r.ok) throw new Error((await r.text()) || ("HTTP " + r.status));
    if (!_webOcul) _webOcul = new Set();
    var k = _reingNorm(cod) + "|" + emp;
    if (on) _webOcul.delete(k); else _webOcul.add(k);
  } catch (e) { alert("No se pudo cambiar la visibilidad web: " + (e.message || e)); }
  _pedImpRender();
}
function _reingWebSwitchHtml(cod, it) {
  if (!_reingExcl) return _webVisibleSwitchHtml(cod, it);
  var on = !_reingExcl.has(_reingNorm(cod));
  var enc = encodeURIComponent(String(cod));
  return '<label onclick="event.stopPropagation()" style="display:inline-flex;align-items:center;gap:3px;margin:2px 0 0 0;font-size:11px;line-height:1;white-space:nowrap;cursor:pointer;color:' + (on ? '#065f46' : '#94a3b8') + '" title="Cartel web de reingreso: ON = las páginas LK/CH muestran &quot;Sin stock hasta&quot; y parten el pedido. OFF = ni cartel ni partido.">'
    + '<input type="checkbox" style="margin:0"' + (on ? ' checked' : '') + ' onchange="pedImpReingresoWeb(\'' + enc + '\',this.checked)">Cartel' + (on ? '' : ' OFF') + '</label>'
    + _webVisibleSwitchHtml(cod, it);
}
async function pedImpReingresoWeb(codEnc, on) {
  var cod = decodeURIComponent(codEnc);
  var headers = await facAuthWriteHeaders({ "Content-Type": "application/json" });
  if (!headers) { alert(authNoSesionMsg("Para prender o apagar el cartel web necesitás iniciar sesión con Google (supervisor).")); _pedImpRender(); return; }
  try {
    var r = await fetch(SUPABASE_URL + "/rest/v1/rpc/gv_reingreso_web_set", {
      method: "POST", headers: headers, body: JSON.stringify({ p_cod: cod, p_activo: !!on })
    });
    if (!r.ok) throw new Error((await r.text()) || ("HTTP " + r.status));
    if (!_reingExcl) _reingExcl = new Set();
    var k = _reingNorm(cod);
    if (on) _reingExcl.delete(k); else _reingExcl.add(k);
    _impSyncPaginas();
  } catch (e) { alert("No se pudo cambiar el cartel web: " + (e.message || e)); }
  _pedImpRender();
}
// Fecha de REINGRESO estimado del artículo importado (Importados.reingreso_est).
// La lee LK (vista v_lk_reingresos → portal) para mostrar "Reingreso Est dd/mm"
// cuando el artículo está sin stock. Vacío = borra la fecha. dd/mm se arma en LK.
async function pedImpSetReingreso(codEnc, val) {
  var cod = decodeURIComponent(codEnc);
  var it0 = null; try { it0 = _pedImpItemPorClave(cod); if (it0) cod = it0.cod; } catch (_e) {}   // v22.93 — clave de línea
  var v = String(val == null ? "" : val).trim();   // 'YYYY-MM-DD' o '' para borrar
  try {
    await _impEscribir("Importados?" + _pedImpFiltroFilas(it0, cod), "PATCH",
      { reingreso_est: v || null, actualizado: new Date().toISOString() });
    _impSyncPaginas();   // v25.12: la fecha del cartel llega a la página ya
    // reflejar en memoria sin recalcular todo el pedido
    try {
      var data = (_stkPop && _stkPop.data) || {};
      (data.items || []).forEach(function (it) { if ((it0 && it0.planta) ? it === it0 : String(it.cod).toUpperCase().trim() === cod.toUpperCase().trim()) it.reingresoEst = v; });
    } catch (_e) {}
    _pedImpRender();
  } catch (e) { try { alert("No se pudo guardar el reingreso: " + (e.message || e)); } catch (_e) {} }
}
// Fecha ESTIMADA DE ENTREGA global (Stock_Config['entrega_estimada_global']).
// La lee LK (cron → app_settings) y la muestra en el carrito antes de confirmar.
async function pedImpSetEntregaGlobal(val) {
  var v = String(val == null ? "" : val).trim();   // 'YYYY-MM-DD' o '' para borrar
  try {
    if (!v) {
      await fetch(SUPABASE_URL + "/rest/v1/Stock_Config?clave=eq.entrega_estimada_global", {
        method: "DELETE",
        headers: { ...(await _scfgAuth()), Prefer: "return=minimal" }
      });
    } else {
      await fetch(SUPABASE_URL + "/rest/v1/Stock_Config?on_conflict=clave", {
        method: "POST",
        headers: { ...(await _scfgAuth()), "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ clave: "entrega_estimada_global", valor: v })
      });
    }
    if (_stkPop && _stkPop.data) _stkPop.data.entregaGlobal = v;
    _impSyncPaginas();   // v25.12
  } catch (e) { try { alert("No se pudo guardar la fecha de entrega: " + (e.message || e)); } catch (_e) {} }
}
// dd/mm/aaaa (o dd/mm, dd-mm-aaaa, yyyy-mm-dd) → 'YYYY-MM-DD'. "" = borrar, null = inválido.
function _pedImpParseFechaISO(s) {
  s = String(s == null ? "" : s).trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  var m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?$/);
  if (!m) return null;
  var d = parseInt(m[1], 10), mo = parseInt(m[2], 10);
  var y = m[3] ? parseInt(m[3], 10) : new Date().getFullYear();
  if (y < 100) y += 2000;
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  return y + "-" + String(mo).padStart(2, "0") + "-" + String(d).padStart(2, "0");
}
function _isoToDdMmAaaa(iso) {
  var m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? (m[3] + "/" + m[2] + "/" + m[1]) : "";
}
// v15.18 — dueño: "en el módulo para cargar pedidos poné formato dd/mm/yy, no mm/dd/yyyy".
// Los <input type="date"> los pinta el navegador según su idioma (en-US → mm/dd/yyyy), así que
// las fechas del módulo van como TEXTO dd/mm/aa: se muestran con _isoToDdMmAa y se leen con
// _pedImpParseFechaISO (acepta dd/mm/aa, dd/mm/aaaa, dd/mm y yyyy-mm-dd).
function _isoToDdMmAa(iso) {
  var m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? (m[3] + "/" + m[2] + "/" + m[1].slice(2)) : "";
}
// Campo de fecha en texto: valida, normaliza lo que se ve y llama al setter con el ISO ('' = borrar).
function _pedImpFechaTxt(el, setter) {
  var iso = _pedImpParseFechaISO(el.value);
  if (iso === null) { try { alert("Fecha inválida: usá dd/mm/aa (ej. 29/11/26)."); } catch (_e) {} el.value = _isoToDdMmAa(el.getAttribute("data-iso") || ""); return; }
  el.value = _isoToDdMmAa(iso); el.setAttribute("data-iso", iso);
  try { setter(iso); } catch (_e) {}
}
function _pedImpFechaInputHtml(iso, onIso, extraAttrs) {
  iso = String(iso || "").slice(0, 10);
  return '<input type="text" inputmode="numeric" placeholder="dd/mm/aa" maxlength="10" value="' + escapeHtml(_isoToDdMmAa(iso)) + '" data-iso="' + escapeHtml(iso) + '" onchange="_pedImpFechaTxt(this,function(v){' + onIso + '})" ' + (extraAttrs || "") + '>';
}
// Cargar un pedido YA HECHO (en curso): unidades + fecha estimada de entrega.
// Las unidades van a Importados.pedido_curso (el motor las resta de "a pedir", así
// no re-pide lo ya pedido). La fecha va a reingreso_est (la lee el portal LK).
async function pedImpSetCurso(id, codEnc, curso) {
  var cod = decodeURIComponent(codEnc);
  var val; try { val = prompt("Unidades EN CURSO (pedido ya hecho / en camino) de " + cod + ":", String(Math.round(curso || 0))); } catch (_e) { return; }
  if (val == null) return;
  var uni = parseInt(String(val).replace(/[^\d]/g, ""), 10);
  if (!(uni >= 0)) { try { alert("Número inválido."); } catch (_e) {} return; }
  try { await _pedImpRpc("importados_set_curso", { p_id: id, p_uni: uni }); }
  catch (e) { try { alert("No se pudo guardar: " + (e.message || e)); } catch (_e) {} return; }
  // Fecha estimada de entrega de ESE pedido (opcional). Enter vacío = sin fecha;
  // Cancelar = dejar la que estaba.
  var curFecha = "";
  try { ((_stkPop && _stkPop.data && _stkPop.data.items) || []).some(function (it) { if (String(it.cod).toUpperCase().trim() === cod.toUpperCase().trim()) { curFecha = it.reingresoEst ? _isoToDdMmAaaa(it.reingresoEst) : ""; return true; } return false; }); } catch (_e) {}
  var fv; try { fv = prompt("Fecha estimada de entrega de este pedido (dd/mm/aaaa).\nVacío = sin fecha · Cancelar = dejar como está.", curFecha); } catch (_e) { fv = null; }
  if (fv !== null) {
    var iso = _pedImpParseFechaISO(fv);
    if (iso === null) { try { alert("Fecha inválida (usá dd/mm/aaaa); se dejó como estaba."); } catch (_e) {} }
    else {
      try {
        await _impEscribir("Importados?cod_art=eq." + encodeURIComponent(cod), "PATCH",
          { reingreso_est: iso || null, actualizado: new Date().toISOString() });
      } catch (e) { try { alert("Se guardó 'en curso', pero no la fecha: " + (e.message || e)); } catch (_e) {} }
    }
  }
  await pedImpReload();
}
async function pedImpLlego(id, codEnc, curso) {
  var cod = decodeURIComponent(codEnc);
  var def = Math.round(curso || 0);
  var val; try { val = prompt("¿Cuántas unidades LLEGARON de " + cod + "?\n(Entran al stock y bajan de 'en curso'.)", String(def > 0 ? def : "")); } catch (_e) { return; }
  if (val == null) return;
  var uni = parseInt(String(val).replace(/[^\d]/g, ""), 10);
  if (!(uni > 0)) { try { alert("Poné un número mayor a 0."); } catch (_e) {} return; }
  var leg = ""; try { leg = String(window.__authEmail || ""); } catch (_e) {}
  try { await _pedImpRpc("importados_marcar_llegada", { p_id: id, p_uni: uni, p_legajo: leg }); }
  catch (e) { try { alert("No se pudo marcar la llegada: " + (e.message || e)); } catch (_e) {} return; }
  try { alert("✅ " + uni + " u de " + cod + " ingresadas al stock."); } catch (_e) {}
  await pedImpReload();
}
/* v14.94 — Baches de importación: cada pedido en curso es un BACHE con su propia fecha de
   reingreso. El "en curso" de un artículo es la suma de baches pendientes y el reingreso que
   ve la página LK es la fecha MÁS CERCANA. Backend: tabla GV_Importados_Baches + RPCs
   gv_importado_bache_add / _llego / _editar / _borrar / gv_importado_baches (listar) +
   gv_importados_resync (mantiene Importados.pedido_curso y reingreso_est como mirror). */
var _impBaches = null;
function _impBachesFmt(n) { return Number(n || 0).toLocaleString("es-AR"); }
async function pedImpBaches(importadoId, codEnc, provEnc) {
  var cod = decodeURIComponent(codEnc || "");
  var prov = decodeURIComponent(provEnc || "");
  _impBaches = { id: importadoId, cod: cod, prov: prov, rows: [], dirty: false };
  if (!document.getElementById("impBachesCss")) {
    var st = document.createElement("style"); st.id = "impBachesCss";
    st.textContent =
      "#impBachesOv{display:none;position:fixed;inset:0;z-index:1320;background:rgba(2,6,23,.78);overflow:auto;padding:14px}" +
      "#impBachesOv.show{display:block}" +
      ".ibc-card{background:#f8fafc;max-width:min(640px,96vw);margin:0 auto;border-radius:16px;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.55)}" +
      ".ibc-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 15px;background:linear-gradient(90deg,#0369a1,#0ea5e9);color:#fff}" +
      ".ibc-head b{font-size:16px;font-weight:800}" +
      ".ibc-x{background:rgba(255,255,255,.22);color:#fff;border:none;border-radius:8px;padding:6px 12px;font-size:13px;font-weight:800;cursor:pointer;width:auto;margin:0}" +
      ".ibc-body{padding:12px 14px}" +
      ".ibc-tbl{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden}" +
      ".ibc-tbl th{font-size:10.5px;text-transform:uppercase;color:#64748b;font-weight:800;padding:7px 6px;border-bottom:2px solid #e2e8f0;text-align:left}" +
      ".ibc-tbl td{padding:6px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#0f172a;vertical-align:middle}" +
      ".ibc-tbl td.num,.ibc-tbl th.num{text-align:right;font-variant-numeric:tabular-nums}" +
      ".ibc-tag{font-size:11px;font-weight:800;padding:2px 7px;border-radius:999px;white-space:nowrap}" +
      ".ibc-tag.en{background:#fff7ed;color:#b45309}.ibc-tag.ll{background:#f0fdf4;color:#166534}" +
      ".ibc-b{border:0;border-radius:7px;padding:5px 9px;font-size:12px;font-weight:700;cursor:pointer;margin:0 2px 2px 0;width:auto}" +
      ".ibc-b.ok{background:#166534;color:#fff}.ibc-b.ed{background:#e2e8f0;color:#0f172a}.ibc-b.rm{background:#fee2e2;color:#b91c1c}.ibc-b.add{background:#0369a1;color:#fff;padding:8px 14px}" +
      ".ibc-empty{padding:16px;text-align:center;color:#64748b;font-size:13px}" +
      ".ibc-foot{padding:11px 14px;background:#fff;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}";
    document.head.appendChild(st);
  }
  var ov = document.getElementById("impBachesOv");
  if (!ov) { ov = document.createElement("div"); ov.id = "impBachesOv"; document.body.appendChild(ov); }
  ov.classList.add("show");
  await _impBachesReload();
}
function pedImpBachesCerrar() {
  var ov = document.getElementById("impBachesOv"); if (ov) ov.classList.remove("show");
  var d = _impBaches && _impBaches.dirty; _impBaches = null;
  if (d) { try { pedImpReload(); } catch (_e) {} }
}
async function _impBachesReload() {
  if (!_impBaches) return;
  await _impCervDenCargar();   // v25.37
  try { _impBaches.rows = (await _pedImpRpc("gv_importado_baches", { p_importado_id: _impBaches.id })) || []; }
  catch (e) { _impBaches.rows = []; try { alert("No se pudieron leer los baches: " + (e.message || e)); } catch (_e) {} }
  _impBachesRender();
}
function _impBachesRender() {
  var ov = document.getElementById("impBachesOv"); if (!ov || !_impBaches) return;
  var rows = _impBaches.rows || [];
  var totalPend = rows.reduce(function (a, r) { return a + (r.estado === "en_curso" ? (Number(r.pendiente) || 0) : 0); }, 0);
  var body = rows.map(function (r) {
    var f = r.fecha_reingreso ? _isoToDdMmAa(String(r.fecha_reingreso).slice(0, 10)) : '<span style="color:#94a3b8">sin fecha</span>';
    var enc = r.estado === "en_curso";
    var lleg = (Number(r.unidades_llegadas) || 0) > 0 ? (' <span style="color:#64748b;font-size:11px">(llegó ' + _impBachesFmt(r.unidades_llegadas) + ')</span>') : "";
    // v15.85 — de qué PEDIDO (PI) es el bache y cuándo embarca. Las dos fechas del pedido entero
    // se editan en la solapa 🚢 En curso; acá se muestran para saber a cuál pertenece cada bache.
    var pi = r.pedido_ref ? escapeHtml(r.pedido_ref) : '<span style="color:#94a3b8">—</span>';
    var emb = r.fecha_embarque ? _isoToDdMmAa(String(r.fecha_embarque).slice(0, 10)) : '<span style="color:#94a3b8">—</span>';
    return "<tr>" +
      '<td style="font-family:Consolas,Menlo,monospace;font-size:11.5px;font-weight:700">' + pi + "</td>" +
      '<td class="num">' + _impBachesFmt(r.unidades) + lleg + "</td>" +
      '<td class="num">' + _impBachesFmt(r.pendiente) + "</td>" +
      "<td>" + emb + "</td>" +
      "<td>" + f + "</td>" +
      '<td><span class="ibc-tag ' + (enc ? "en" : "ll") + '">' + (enc ? "en curso" : "llegado") + "</span>" + (enc ? _impCervDenChip(_impCervDen.porBache[r.id]) : "") + "</td>" +
      '<td style="white-space:nowrap">' +
        (enc ? '<button class="ibc-b ok" title="Recibir lo que llegó: cuánto, empresa y a dónde va (queda en stock y en el historial)" onclick="impRecibirBache(' + r.id + ')">📥 Recibir</button>' +
               '<button class="ibc-b ed" onclick="pedImpBacheEditar(' + r.id + ')" title="Editar unidades/fecha">✏️</button>' +
               '<button class="ibc-b rm" onclick="pedImpBacheBorrar(' + r.id + ')" title="Anular">🗑</button>' : "—") +
      "</td></tr>";
  }).join("");
  ov.innerHTML =
    '<div class="ibc-card"><div class="ibc-head"><b>📦 Baches — ' + escapeHtml(codCanon(_impBaches.cod)) + (_impBaches.prov ? (" · " + escapeHtml(_impBaches.prov)) : "") + "</b>" +
      '<button class="ibc-x" onclick="pedImpBachesCerrar()">Cerrar</button></div>' +
    '<div class="ibc-body">' +
      (rows.length
        ? '<table class="ibc-tbl"><thead><tr><th>Pedido</th><th class="num">Unidades</th><th class="num">Pendiente</th><th title="Día que embarca (sale de China). Se edita por pedido en la solapa 🚢 En curso.">Embarque</th><th>Reingreso</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>' + body + "</tbody></table>"
        : '<div class="ibc-empty">Sin baches todavía. Agregá el primero.</div>') +
    "</div>" +
    '<div class="ibc-foot"><div style="font-size:13px;color:#334155">En curso pendiente: <b>' + _impBachesFmt(totalPend) + '</b> u · el reingreso que ve la página es la fecha <b>más cercana</b></div>' +
      '<button class="ibc-b add" onclick="pedImpBacheAdd()">➕ Agregar bache</button></div></div>';
}
async function pedImpBacheAdd() {
  if (!_impBaches) return;
  var uv; try { uv = prompt("Unidades del bache (pedido en curso):", ""); } catch (_e) { return; }
  if (uv === null) return;
  var uni = parseInt(String(uv).replace(/[^\d]/g, ""), 10);
  if (!(uni > 0)) { try { alert("Unidades inválidas."); } catch (_e) {} return; }
  // v15.85 — el bache va atado a un PEDIDO (el PI). Sin eso queda suelto en la solapa 🚢 En curso.
  var refPre = ""; try { (_impBaches.rows || []).some(function (x) { if (x.estado === "en_curso" && x.pedido_ref) { refPre = x.pedido_ref; return true; } return false; }); } catch (_e) {}
  var rv; try { rv = prompt("Número de PI / referencia del pedido (agrupa las líneas en 🚢 En curso).\nVacío = queda suelto:", refPre); } catch (_e) { rv = null; }
  if (rv === null) return;
  var ref = String(rv).trim();
  var fv; try { fv = prompt("Fecha estimada de reingreso (dd/mm/aa).\nVacío = sin fecha:", ""); } catch (_e) { fv = null; }
  var iso = null;
  if (fv !== null && String(fv).trim() !== "") { iso = _pedImpParseFechaISO(fv); if (iso === null) { try { alert("Fecha inválida (usá dd/mm/aa)."); } catch (_e) {} return; } }
  var ev; try { ev = prompt("Fecha de EMBARQUE (dd/mm/aa) — el día que sale de China.\nVacío = sin fecha:", ""); } catch (_e) { ev = null; }
  var isoEmb = null;
  if (ev !== null && String(ev).trim() !== "") { isoEmb = _pedImpParseFechaISO(ev); if (isoEmb === null) { try { alert("Fecha de embarque inválida (usá dd/mm/aa)."); } catch (_e) {} return; } }
  var leg = ""; try { leg = String(window.__authEmail || ""); } catch (_e) {}
  try { await _pedImpRpc("gv_importado_bache_add", { p_importado_id: _impBaches.id, p_unidades: uni, p_fecha: iso, p_legajo: leg, p_ref: ref || null, p_embarque: isoEmb }); _impBaches.dirty = true; }
  catch (e) { try { alert("No se pudo agregar: " + (e.message || e)); } catch (_e) {} return; }
  await _impBachesReload();
}
async function pedImpBacheLlego(bacheId) {
  if (!_impBaches) return;
  var r = (_impBaches.rows || []).find(function (x) { return x.id === bacheId; });
  var pend = r ? (Number(r.pendiente) || 0) : 0;
  var v; try { v = prompt("¿Cuántas unidades llegaron?\n(Entran al stock y bajan de 'en curso'. Podés cargar una llegada parcial.)", String(pend > 0 ? pend : "")); } catch (_e) { return; }
  if (v === null) return;
  var uni = parseInt(String(v).replace(/[^\d]/g, ""), 10);
  if (!(uni > 0)) { try { alert("Número inválido."); } catch (_e) {} return; }
  var leg = ""; try { leg = String(window.__authEmail || ""); } catch (_e) {}
  try { await _pedImpRpc("gv_importado_bache_llego", { p_bache_id: bacheId, p_unidades: uni, p_legajo: leg }); _impBaches.dirty = true; }
  catch (e) { try { alert("No se pudo marcar la llegada: " + (e.message || e)); } catch (_e) {} return; }
  await _impBachesReload();
}
/* v23.45 (Luis, 28/09) — 📥 RECIBIR una importación desde el panel.
   Guiado: qué bache, cuánto llegó, de qué empresa (sólo duales) y a dónde va cada parte
   (A guardar · Góndola · Rack · Excedente · Insumos) con los lugares del Mapa. Antes de grabar
   el backend SIMULA (gv_imp_recibir p_simular=true): si una góndola no alcanza o un rack está
   ocupado / es de otra empresa, lo avisa y la persona elige cómo se resuelve. Graba stock en
   Movimientos_Stock, descuenta el bache y deja el historial (GV_Imp_Recepcion). */
var _impRec = null;
function _impRecErr(e) {
  var m = String((e && e.message) || e || "");
  var i = m.indexOf(" — ");
  if (i >= 0) { try { var j = JSON.parse(m.slice(i + 3)); if (j && j.message) return j.message; } catch (_e) {} }
  return m;
}
/* v25.10 (Luis, 30/09): «Cervantes» va PRIMERO — lo importado que va directo a Cervantes (sobre todo insumos)
   no entra al stock de Virgilio: queda como aviso en GP2 (tabla GP2.ingreso_virgilio). Un insumo va en su unidad;
   lo demás, en cajas. v25.37: el aviso ya no está en la portada de GP2 sino en Recepción de Insumos → Importados,
   con Sí / No; el No vuelve a poner el pedido en viaje con «Denegado por Cervantes» (ver _impCervDen). */
var _IMP_REC_DEST = { cervantes: "Cervantes", a_guardar: "A guardar", gondola: "Góndola", rack: "Rack", excedente: "Excedente", insumos: "Insumos" };
function _impRecCss() {
  if (document.getElementById("impRecCss")) return;
  var st = document.createElement("style"); st.id = "impRecCss";
  st.textContent =
    "#impRecOv{display:none;position:fixed;inset:0;z-index:1330;background:rgba(2,6,23,.78);overflow:auto;padding:14px}" +
    "#impRecOv.show{display:block}" +
    ".irc-card{background:#f8fafc;max-width:min(720px,96vw);margin:0 auto;border-radius:16px;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.55)}" +
    ".irc-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 15px;background:linear-gradient(90deg,#0f766e,#14b8a6);color:#fff}" +
    ".irc-head b{font-size:16px;font-weight:800}" +
    ".irc-x{background:rgba(255,255,255,.22);color:#fff;border:none;border-radius:8px;padding:6px 12px;font-size:13px;font-weight:800;cursor:pointer;width:auto;margin:0}" +
    ".irc-body{padding:12px 14px;font-size:14px;color:#0f172a}" +
    ".irc-sec{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:10px 12px;margin-bottom:10px}" +
    ".irc-sec h4{margin:0 0 7px;font-size:12px;text-transform:uppercase;letter-spacing:.03em;color:#64748b}" +
    ".irc-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:6px}" +
    ".irc-row select,.irc-row input{height:36px;border:1.5px solid #cbd5e1;border-radius:8px;padding:0 8px;font-size:14px;width:auto;margin:0}" +
    ".irc-b{border:0;border-radius:8px;padding:8px 12px;font-size:13px;font-weight:800;cursor:pointer;width:auto;margin:0 4px 4px 0}" +
    ".irc-b.pri{background:#0f766e;color:#fff}.irc-b.sec{background:#e2e8f0;color:#0f172a}.irc-b.rm{background:#fee2e2;color:#b91c1c;padding:6px 10px}" +
    ".irc-b.on{background:#1d4ed8;color:#fff}.irc-b.warn{background:#b45309;color:#fff}" +
    ".irc-conf{background:#fff7ed;border:1px solid #fdba74;border-radius:10px;padding:8px 10px;margin:4px 0 8px;font-size:13px;color:#9a3412}" +
    ".irc-ok{background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:8px 10px;font-size:13px;color:#166534}" +
    ".irc-muted{color:#64748b;font-size:12.5px}";
  document.head.appendChild(st);
}
function _impRecOv() {
  _impRecCss();
  var ov = document.getElementById("impRecOv");
  if (!ov) { ov = document.createElement("div"); ov.id = "impRecOv"; document.body.appendChild(ov); }
  ov.classList.add("show");
  return ov;
}
function impRecCerrar() {
  var ov = document.getElementById("impRecOv"); if (ov) ov.classList.remove("show");
  var hecho = _impRec && _impRec.hecho; _impRec = null;
  if (hecho) {
    try { if (_impBaches) { _impBaches.dirty = true; _impBachesReload(); } } catch (_e) {}
    try { if (_stkPop && _stkPop.kind === "pedImp") pedImpReload(); } catch (_e) {}
  }
}
function _impRecShell(titulo, inner) {
  var ov = _impRecOv();
  ov.innerHTML = '<div class="irc-card"><div class="irc-head"><b>' + titulo + '</b><button class="irc-x" onclick="impRecCerrar()">✕ Cerrar</button></div><div class="irc-body">' + inner + '</div></div>';
}
// Desde la tabla: un Importados.id puede tener varios baches en curso → se elige cuál llegó.
async function impRecibirAbrir(importadoId, det) {
  _impRecShell("📥 Recibir importación", '<div class="irc-muted">Cargando pedidos en curso…</div>');
  var rows;
  try { rows = (await _pedImpRpc("gv_importado_baches", { p_importado_id: importadoId })) || []; }
  catch (e) { _impRecShell("📥 Recibir importación", '<div class="irc-conf">No se pudieron leer los pedidos: ' + escapeHtml(_impRecErr(e)) + '</div>'); return; }
  var enc = rows.filter(function (r) { return r.estado === "en_curso" && Number(r.pendiente) > 0; });
  await _impCervDenCargar();   // v25.37
  if (!enc.length) return _impRecSinPedidoAviso([det || { id: importadoId, cod: (rows[0] && rows[0].cod_art) || "" }]);   // v25.66
  if (enc.length === 1) return impRecibirBache(enc[0].id);
  var h = '<div class="irc-sec"><h4>¿Qué pedido llegó?</h4>' + enc.map(function (r) {
    return '<div class="irc-row"><button class="irc-b pri" onclick="impRecibirBache(' + r.id + ')">📥 ' + escapeHtml(r.pedido_ref || ("bache " + r.id)) + '</button><span class="irc-muted">' +
      Number(r.pendiente).toLocaleString("es-AR") + ' u pendientes' + (r.fecha_reingreso ? ' · llega ' + escapeHtml(String(r.fecha_reingreso).slice(0, 10)) : '') + '</span>' + _impCervDenChip(_impCervDen.porBache[r.id]) + '</div>';
  }).join('') + '</div>';
  _impRecShell("📥 Recibir importación", h);
}
// v24.80 — el 📥 del código: junta los pedidos en viaje de TODOS sus artículos del maestro.
function _impDetsDe(enc) { try { return JSON.parse(decodeURIComponent(enc)) || []; } catch (_e) { return []; } }
function _impDetLbl(d) { return escapeHtml(codCanon(d.cod || "")) + (d.marca ? ' ' + escapeHtml(d.marca) : ''); }
async function impRecibirCodigo(enc) {
  var dets = _impDetsDe(enc);
  if (dets.length === 1) return impRecibirAbrir(dets[0].id, dets[0]);
  _impRecShell("📥 Recibir importación", '<div class="irc-muted">Cargando pedidos en curso…</div>');
  var enc2 = [];
  try {
    var res = await Promise.all(dets.map(function (d) { return _pedImpRpc("gv_importado_baches", { p_importado_id: d.id }); }));
    res.forEach(function (rows, k) { (rows || []).forEach(function (r) { if (r.estado === "en_curso" && Number(r.pendiente) > 0) enc2.push({ r: r, d: dets[k] }); }); });
  } catch (e) { _impRecShell("📥 Recibir importación", '<div class="irc-conf">No se pudieron leer los pedidos: ' + escapeHtml(_impRecErr(e)) + '</div>'); return; }
  await _impCervDenCargar();   // v25.37
  if (!enc2.length) return _impRecSinPedidoAviso(dets);   // v25.66
  if (enc2.length === 1) return impRecibirBache(enc2[0].r.id);
  // v24.92: si el pedido entra como INSUMO (323E/838E/323ES → 323ES), el rótulo es el insumo, no el artículo.
  try {
    var ctxs = await Promise.all(enc2.map(function (x) { return _pedImpRpc("gv_imp_recibir_contexto", { p_bache_id: x.r.id }).catch(function () { return null; }); }));
    ctxs.forEach(function (c, k) { if (c && c.es_insumo && (c.insumos_cods || []).length) enc2[k].ins = c.insumos_cods[0]; });
  } catch (_e) {}
  var h = '<div class="irc-sec"><h4>¿Qué llegó?</h4>' + enc2.map(function (x) {
    var r = x.r;
    return '<div class="irc-row"><button class="irc-b pri" onclick="impRecibirBache(' + r.id + ')">📥 ' + (x.ins ? escapeHtml(x.ins) + ' <span style="font-weight:600">(insumo)</span>' : _impDetLbl(x.d)) + '</button><span class="irc-muted">' +
      escapeHtml(r.pedido_ref || ("bache " + r.id)) + ' · ' + Number(r.pendiente).toLocaleString("es-AR") + ' u pendientes' + (r.fecha_reingreso ? ' · llega ' + escapeHtml(_isoToDdMmAa(String(r.fecha_reingreso).slice(0, 10))) : '') + '</span>' + _impCervDenChip(_impCervDen.porBache[r.id]) + '</div>';
  }).join('') + '</div>';
  _impRecShell("📥 Recibir importación", h);
}
// v24.80 — el 📦 del código: con más de un artículo del maestro, se elige de cuál son los baches.
function pedImpBachesDe(enc, codEnc) {
  var dets = _impDetsDe(enc);
  if (dets.length === 1) return pedImpBaches(dets[0].id, codEnc, encodeURIComponent(dets[0].prov || ""));
  var h = '<div class="irc-sec"><h4>¿Baches de cuál?</h4>' + dets.map(function (d) {
    return '<div class="irc-row"><button class="irc-b pri" onclick="impRecCerrar();pedImpBaches(' + d.id + ',\'' + encodeURIComponent(d.cod || "") + '\',\'' + encodeURIComponent(d.prov || "") + '\')">📦 ' + _impDetLbl(d) + '</button></div>';
  }).join('') + '</div>';
  _impRecShell("📦 Baches", h);
}
async function impRecibirBache(bacheId) {
  _impRecShell("📥 Recibir importación", '<div class="irc-muted">Cargando lugares del Mapa…</div>');
  var ctx;
  try { ctx = await _pedImpRpc("gv_imp_recibir_contexto", { p_bache_id: bacheId }); }
  catch (e) { _impRecShell("📥 Recibir importación", '<div class="irc-conf">' + escapeHtml(_impRecErr(e)) + '</div>'); return; }
  _impRecIniciar(ctx, "imprec-" + bacheId);
}
/* v25.66 (Luis, 01/10): «que de la posibilidad de recibir algo por más que no haya pedido … que el pop-up alerte».
   El backend crea el pedido «SIN PEDIDO» en la MISMA operación, con unidades = lo que llegó: no queda nada en
   viaje y el pedido en curso nunca baja de cero. Anular la recepción anula ese pedido. */
function _impRecSinPedidoAlerta() {
  return '<div class="irc-conf" style="font-size:15px;line-height:1.4;border-width:2px">⚠ <b>No hay pedido registrado</b> de este código. ' +
    'Estás por recibir algo que no estaba pedido: entra al stock igual y queda anotado como recepción <b>SIN PEDIDO</b>. ' +
    'No descuenta ningún pedido en viaje.</div>';
}
function _impRecSinPedidoAviso(dets) {
  var h = _impRecSinPedidoAlerta() + '<div class="irc-sec"><h4>¿Recibir igual?</h4>' + (dets || []).map(function (d) {
    return '<div class="irc-row"><button class="irc-b pri" onclick="impRecibirSinPedido(' + Number(d.id) + ')">📥 Recibir sin pedido ' + _impDetLbl(d) + '</button></div>';
  }).join('') + '<div class="irc-row"><button class="irc-b sec" onclick="impRecCerrar()">Cancelar</button></div></div>';
  _impRecShell("📥 Recibir importación", h);
}
async function impRecibirSinPedido(importadoId) {
  _impRecShell("📥 Recibir importación", '<div class="irc-muted">Cargando lugares del Mapa…</div>');
  var ctx;
  try { ctx = await _pedImpRpc("gv_imp_recibir_contexto_sin_pedido", { p_importado_id: importadoId }); }
  catch (e) { _impRecShell("📥 Recibir importación", '<div class="irc-conf">' + escapeHtml(_impRecErr(e)) + '</div>'); return; }
  _impRecIniciar(ctx, "imprec-sp" + importadoId);
}
function _impRecIniciar(ctx, cidBase) {
  var uxc = Number(ctx.uni_x_caja) || 0;
  var soloInsumo = !!ctx.es_insumo || (!(ctx.gondola || []).length && (ctx.insumos_cods || []).length > 0 && !uxc);
  var cajasDef = uxc > 0 ? Math.round((Number(ctx.pendiente) || 0) / uxc) : 0;
  _impRec = {
    ctx: ctx, soloInsumo: soloInsumo, empresa: ctx.empresa || "LK", empresaBache: ctx.empresa || "", uxc: uxc || "", nota: "", hecho: false, sim: null,
    cerrar: false, cid: cidBase + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
    lineas: [soloInsumo
      ? { destino: "insumos", sector: "", cantidad: Number(ctx.pendiente) || "", cod_insumo: (ctx.insumos_cods || [])[0] || ctx.cod_stock, resolucion: "" }
      : { destino: "a_guardar", sector: "", cantidad: cajasDef || "", resolucion: "" }]
  };
  _impRecRender();
}
function _impRecU(l) { return !!l && (l.destino === "insumos" || (l.destino === "cervantes" && !!(_impRec && _impRec.soloInsumo))); }
function _impRecLugares(l) {
  var c = _impRec.ctx, emp = _impRec.empresa;
  if (l.destino === "gondola") return (c.gondola || []).filter(function (g) { return !c.dual || !emp || g.empresa === emp; })
    .map(function (g) { return { v: g.sector, t: g.sector + (c.dual ? " (" + g.empresa + ")" : "") + " · cap " + (g.cajas_max == null ? "?" : g.cajas_max) + " cj" }; });
  if (l.destino === "rack") return (c.racks || []).filter(function (r) { return r.estado !== "reservado"; })
    .map(function (r) {
      var e = r.estado === "libre" ? "libre" : r.estado === "mismo" ? "ya tiene este código (" + (r.cajas || 0) + " cj)" : "⚠ ocupado: " + r.cod + " (" + (r.cajas || 0) + " cj)";
      return { v: r.sector, t: r.sector + " · " + r.empresa + " · " + e };
    });
  if (l.destino === "insumos") return (c.insumos_pos || []).map(function (p) { return { v: p.sector, t: p.sector + (p.insumos ? " · tiene " + p.insumos : " · vacía") }; });
  return [];
}
function _impRecRender() {
  if (!_impRec) return;
  var c = _impRec.ctx, uxc = Number(_impRec.uxc) || 0;
  var pend = Number(c.pendiente) || 0;
  var h = '<div class="irc-sec"><div style="font-size:16px;font-weight:800">' + escapeHtml(c.es_insumo && (c.insumos_cods || []).length ? c.insumos_cods[0] : codCanon(c.cod_stock || c.cod_art)) + ' <span style="font-weight:600;color:#475569">' + escapeHtml(c.descripcion || "") + '</span></div>' +
    '<div class="irc-muted">' + escapeHtml(c.proveedor || "") + (c.sin_pedido ? ' · <b style="color:#b91c1c">sin pedido registrado</b>' : ' · pedido ' + escapeHtml(c.pedido_ref || "—") + ' · pendiente <b>' + pend.toLocaleString("es-AR") + ' u</b>' +
    (uxc > 0 ? ' (' + Math.round(pend / uxc).toLocaleString("es-AR") + ' cajas)' : '')) + (Number(c.uni_master) > 0 ? ' · master de ' + c.uni_master + ' u' : '') + '</div>' +
    (_impCervDen.porBache[c.bache_id] ? '<div class="irc-conf" style="margin-top:6px">' + _impCervDenChip(_impCervDen.porBache[c.bache_id]) + ' Cervantes dijo que esto no le llegó' +
      (_impCervDen.porBache[c.bache_id].motivo ? ' (' + escapeHtml(_impCervDen.porBache[c.bache_id].motivo) + ')' : '') + ': recibilo de nuevo a donde corresponda.</div>' : '') + '</div>';
  if (c.sin_pedido) h += _impRecSinPedidoAlerta();   // v25.66
  if (c.dual) {
    h += '<div class="irc-sec"><h4>¿De qué empresa es? (código dual: son productos distintos)</h4><div class="irc-row">' +
      ["LK", "CH"].map(function (e) { return '<button class="irc-b ' + (_impRec.empresa === e ? 'on' : 'sec') + '" onclick="impRecSet(\'empresa\',\'' + e + '\')">' + (e === "LK" ? "Loekemeyer (LK)" : "Chef (CH)") + '</button>'; }).join('') + '</div>' +
      (_impRec.empresaBache && _impRec.empresa !== _impRec.empresaBache ? '<div class="irc-conf">⚠ Este pedido se hizo para <b>' + escapeHtml(_impRec.empresaBache) + '</b> y estás recibiendo como <b>' + escapeHtml(_impRec.empresa) + '</b>. El stock va a la góndola / pila de ' + escapeHtml(_impRec.empresa) + '. Confirmá que es así.</div>' : '') + '</div>';
  }
  h += '<div class="irc-sec"><h4>¿Cuánto llegó y a dónde va?</h4>' +
    // v24.83 — un insumo no lleva UxB: el renglón sólo aparece si algún destino va en cajas
    (_impRec.lineas.some(function (l) { return !_impRecU(l); })
      ? '<div class="irc-row"><span class="irc-muted">Unidades por caja</span><input type="number" min="1" style="width:80px" value="' + (_impRec.uxc || "") + '" onchange="impRecSet(\'uxc\',this.value)"></div>' : '');
  _impRec.lineas.forEach(function (l, i) {
    /* v25.26 (Luis, 30/09): «No aparece Cervantes» — estaba adentro de un menú que decía «Insumos», al lado del
       menú de LUGARES (posiciones de rack), que es el que se mira. Los destinos van a la vista, como botones. */
    var opts = Object.keys(_IMP_REC_DEST).filter(function (k) { return k !== "insumos" || (c.insumos_cods || []).length; })
      .map(function (k) { return '<button type="button" class="irc-b irc-dest ' + (l.destino === k ? 'on' : 'sec') + '" data-dest="' + k + '" onclick="impRecLinea(' + i + ',\'destino\',\'' + k + '\')">' + (k === "cervantes" ? "🏭 " : "") + _IMP_REC_DEST[k] + '</button>'; }).join('');
    var lug = _impRecLugares(l);
    var lugHtml = '';
    if (l.destino === "gondola" && !lug.length) lugHtml = '<span class="irc-conf" style="margin:0">Este código no tiene celda de góndola en el Mapa' + (c.dual && _impRec.empresa ? ' para ' + _impRec.empresa : '') + '</span>';
    else if (lug.length) lugHtml = '<select onchange="impRecLinea(' + i + ',\'sector\',this.value)"><option value="">— lugar —</option>' +
      lug.map(function (o) { return '<option value="' + escapeHtml(o.v) + '"' + (l.sector === o.v ? ' selected' : '') + '>' + escapeHtml(o.t) + '</option>'; }).join('') + '</select>';
    var insHtml = (_impRecU(l) && (c.insumos_cods || []).length > 1)
      ? '<select onchange="impRecLinea(' + i + ',\'cod_insumo\',this.value)">' + c.insumos_cods.map(function (x) { return '<option' + (l.cod_insumo === x ? ' selected' : '') + '>' + escapeHtml(x) + '</option>'; }).join('') + '</select>' : '';
    /* v24.80 (Luis, 30/09): la carga puede ir en CAJAS o en UNIDADES. En unidades se convierte a cajas
       con la UxB (la recepción graba cajas enteras): se redondea a la caja más cercana y se dice la diferencia. */
    var enU = !_impRecU(l) && l.modo === "u";
    var qIn = '<input type="number" min="1" style="width:92px" value="' + ((enU ? l.uni : l.cantidad) || "") + '" onchange="impRecLinea(' + i + ',\'' + (enU ? 'uni' : 'cantidad') + '\',this.value)">';
    /* v24.83 (Luis, 30/09): un insumo NO se carga en cajas ni por UxB: se pregunta cuánto entra en SU unidad de
       medida (la base de Insumos_Factores, que trae el contexto; sin dato = unidades). */
    var _insU = _impRecU(l) ? ((c.insumos_unidad || {})[l.cod_insumo || ""] || "Uni") : "";
    var uSel = _impRecU(l) ? '<span class="irc-muted" title="Unidad de medida del insumo ' + escapeHtml(l.cod_insumo || "") + '">' + escapeHtml(_insU === "Uni" ? "unidades" : _insU) + ' →</span>'
      : '<select title="Cargar en cajas o en unidades" onchange="impRecLinea(' + i + ',\'modo\',this.value)"><option value="cajas"' + (enU ? '' : ' selected') + '>cajas</option><option value="u"' + (enU ? ' selected' : '') + '>unidades</option></select><span class="irc-muted">→</span>';
    h += '<div class="irc-row">' + qIn + uSel +
      '</div><div class="irc-row irc-dests">' + opts + '</div><div class="irc-row">' + lugHtml + insHtml +
      (_impRec.lineas.length > 1 ? '<button class="irc-b rm" onclick="impRecQuitar(' + i + ')">✕</button>' : '') + '</div>';
    if (enU && Number(l.uni) > 0) {
      var _uxcL = Number(_impRec.uxc) || 0;
      if (!(_uxcL > 0)) h += '<div class="irc-conf" style="margin:-2px 0 6px">Para convertir unidades a cajas falta cuántas unidades trae cada caja (arriba).</div>';
      else {
        var _difU = (Number(l.cantidad) || 0) * _uxcL - Number(l.uni);
        h += '<div class="irc-muted" style="margin:-2px 0 6px">= <b>' + (Number(l.cantidad) || 0).toLocaleString("es-AR") + ' cajas</b> de ' + _uxcL + ' u' +
          (_difU ? ' · <span style="color:#b45309;font-weight:800">no da cajas enteras: ' + Number(l.uni).toLocaleString("es-AR") + ' u ÷ ' + _uxcL + ' = ' + (Number(l.uni) / _uxcL).toLocaleString("es-AR", { maximumFractionDigits: 2 }) + ', se graban ' + ((Number(l.cantidad) || 0) * _uxcL).toLocaleString("es-AR") + ' u (' + (_difU > 0 ? '+' : '') + _difU.toLocaleString("es-AR") + ' u)</span>' : '') + '</div>';
      }
    }
    var cf = _impRec.sim && (_impRec.sim.conflictos || []).filter(function (x) { return x.destino === l.destino && (x.sector || "") === (l.sector || ""); })[0];
    if (cf && !l.resolucion) h += _impRecConfHtml(cf, l, i);
    else if (l.resolucion === "forzar") h += '<div class="irc-muted" style="margin:-2px 0 6px">⚠ Se manda igual (queda anotado en el historial). <a href="#" onclick="impRecLinea(' + i + ',\'resolucion\',\'\');return false">deshacer</a></div>';
  });
  var tot = _impRecTotales();
  h += '<button class="irc-b sec" onclick="impRecAgregar()">＋ Otro destino (partir la carga)</button>' +
    '<div class="irc-muted" style="margin-top:6px">Total: <b>' + tot.cajas + ' cajas</b>' + (tot.insU ? ' + <b>' + tot.insU.toLocaleString("es-AR") + ' u</b> de insumo' : '') +
    ' = <b>' + tot.uni.toLocaleString("es-AR") + ' u</b>' + (c.sin_pedido ? ' · sin pedido: entra todo al stock' : ' de ' + pend.toLocaleString("es-AR") + ' pendientes') +
    (!c.sin_pedido && tot.uni > pend ? ' · <span style="color:#b45309;font-weight:800">llegan ' + (tot.uni - pend).toLocaleString("es-AR") + ' u más de lo pedido: entran todas al stock y el pedido queda recibido (lo de más no descuenta otros pedidos en viaje)</span>' : '') + '</div>' +
    (tot.uni > 0 && tot.uni < pend
      /* v25.69 (Luis, D16): la casilla viene DESMARCADA (recepción parcial: lo que falta sigue pedido) y,
         marcada, dice sin vueltas que se cierra el PEDIDO TOTAL */
      ? '<div class="irc-muted" style="margin-top:8px;font-size:14px">📦 Recepción <b>parcial</b>: siguen pedidas <b>' + (pend - tot.uni).toLocaleString("es-AR") + ' u</b> de ' + pend.toLocaleString("es-AR") + '.</div>' +
        '<label class="irc-cerrar" style="display:flex;gap:8px;align-items:flex-start;margin-top:6px;font-size:13.5px;cursor:pointer;padding:6px 8px;border-radius:8px;border:1.5px solid ' + (_impRec.cerrar ? '#b91c1c;background:#fef2f2' : '#cbd5e1') + '"><input type="checkbox" style="width:18px;height:18px;margin:2px 0 0" ' + (_impRec.cerrar ? 'checked' : '') + ' onchange="impRecSet(\'cerrar\',this.checked)"><span>' +
        (_impRec.cerrar ? '<b style="color:#b91c1c">⛔ Se CIERRA EL PEDIDO COMPLETO.</b> Se da por recibido TODO el pedido: las ' + (pend - tot.uni).toLocaleString("es-AR") + ' u que faltan dejan de estar pedidas y quedan anotadas como faltante.'
                        : '<b>Cerrar el pedido completo</b> (marcalo sólo si no va a llegar nada más: las ' + (pend - tot.uni).toLocaleString("es-AR") + ' u que faltan dejan de estar pedidas).') + '</span></label>' : '') + '</div>';
  h += '<div class="irc-sec"><h4>Nota (opcional)</h4><input type="text" style="width:100%;height:36px;border:1.5px solid #cbd5e1;border-radius:8px;padding:0 8px;margin:0" placeholder="contenedor, remito, observaciones…" value="' + escapeHtml(_impRec.nota || "") + '" onchange="impRecSet(\'nota\',this.value)"></div>';
  if (_impRec.err) h += '<div class="irc-conf">' + escapeHtml(_impRec.err) + '</div>';
  if (_impRec.sim && _impRec.sim.ok) h += '<div class="irc-ok">✓ Revisado: no hay conflictos de espacio. Tocá <b>Confirmar recepción</b> para grabarla.</div>';
  h += '<div style="margin-top:10px">' + (_impRec.sim && _impRec.sim.ok
      ? '<button class="irc-b pri" onclick="impRecGrabar()">✅ Confirmar recepción</button>'
      : '<button class="irc-b pri" onclick="impRecRevisar()">🔎 Revisar espacio</button>') +
    '<button class="irc-b sec" onclick="impRecCerrar()">Cancelar</button></div>';
  _impRecShell("📥 Recibir importación", h);
}
function _impRecConfHtml(cf, l, i) {
  var txt = String(cf.conflicto || ""), op = '';
  var m = txt.match(/entran ([0-9.]+) de/);
  var entran = m ? Math.floor(Number(m[1])) : 0;
  if (/gondola_llena/.test(txt)) {
    op = (entran > 0 ? '<button class="irc-b pri" onclick="impRecPartir(' + i + ',' + entran + ')">Poner ' + entran + ' en góndola y el resto a A guardar</button>' : '') +
      '<button class="irc-b sec" onclick="impRecLinea(' + i + ',\'destino\',\'a_guardar\')">Todo a A guardar</button>' +
      '<button class="irc-b sec" onclick="impRecLinea(' + i + ',\'destino\',\'rack\')">Mandar a un rack</button>' +
      '<button class="irc-b warn" onclick="impRecLinea(' + i + ',\'resolucion\',\'forzar\')">Ponerlo igual en góndola</button>';
  } else if (/rack_/.test(txt)) {
    op = '<button class="irc-b pri" onclick="impRecLinea(' + i + ',\'sector\',\'\')">Elegir otro rack</button>' +
      '<button class="irc-b sec" onclick="impRecLinea(' + i + ',\'destino\',\'a_guardar\')">Mandar a A guardar</button>' +
      '<button class="irc-b warn" onclick="impRecLinea(' + i + ',\'resolucion\',\'forzar\')">Ponerlo igual ahí</button>';
  } else {
    op = '<button class="irc-b sec" onclick="impRecLinea(' + i + ',\'destino\',\'a_guardar\')">Mandar a A guardar</button>' +
      '<button class="irc-b warn" onclick="impRecLinea(' + i + ',\'resolucion\',\'forzar\')">Ponerlo igual</button>';
  }
  var leg = txt.replace(/gondola_llena:/, 'La góndola no alcanza:').replace(/gondola_sin_capacidad:/, 'Góndola sin capacidad cargada:')
    .replace(/rack_ocupado:/, 'Rack ocupado:').replace(/rack_otra_empresa:/, 'Rack de otra empresa:');
  return '<div class="irc-conf">⚠ ' + escapeHtml(leg) + '<div style="margin-top:6px">¿Cómo lo resolvés?</div><div style="margin-top:4px">' + op + '</div></div>';
}
function _impRecTotales() {
  var uxc = Number(_impRec.uxc) || 0, cajas = 0, insU = 0;
  _impRec.lineas.forEach(function (l) { var q = Number(l.cantidad) || 0; if (_impRecU(l)) insU += q; else cajas += q; });
  return { cajas: cajas, insU: insU, uni: cajas * uxc + insU };
}
// v24.80 — una línea cargada en unidades: cajas = unidades ÷ UxB, redondeado a la caja más cercana.
function _impRecUniACajas(l) {
  if (!l || _impRecU(l) || l.modo !== "u") return;
  var u = Number(l.uni) || 0, x = Number(_impRec && _impRec.uxc) || 0;
  l.cantidad = (u > 0 && x > 0) ? (Math.round(u / x) || 1) : "";
}
function impRecSet(k, v) {
  if (!_impRec) return; _impRec[k] = v; _impRec.sim = null; _impRec.err = "";
  if (k === "uxc") _impRec.lineas.forEach(_impRecUniACajas);
  _impRecRender();
}
function impRecLinea(i, k, v) {
  if (!_impRec || !_impRec.lineas[i]) return;
  var l = _impRec.lineas[i];
  l[k] = (k === "cantidad" || k === "uni") ? (Number(v) || "") : v;
  if (k === "modo" && v === "u" && !l.uni && Number(l.cantidad) > 0 && Number(_impRec.uxc) > 0) l.uni = Number(l.cantidad) * Number(_impRec.uxc);
  if (k === "uni" || k === "modo") _impRecUniACajas(l);
  if (k === "destino") { l.sector = ""; l.resolucion = ""; if ((v === "insumos" || (v === "cervantes" && _impRec.soloInsumo)) && !l.cod_insumo) l.cod_insumo = (_impRec.ctx.insumos_cods || [])[0] || _impRec.ctx.cod_stock; }
  if (k === "sector" || k === "cantidad" || k === "uni") l.resolucion = "";
  if (k !== "resolucion") { _impRec.sim = null; }
  _impRec.err = "";
  if (k === "resolucion" && _impRec.sim) { impRecRevisar(); return; }
  _impRecRender();
}
function impRecAgregar() { if (!_impRec) return; _impRec.lineas.push({ destino: "a_guardar", sector: "", cantidad: "", resolucion: "" }); _impRec.sim = null; _impRecRender(); }
function impRecQuitar(i) { if (!_impRec) return; _impRec.lineas.splice(i, 1); _impRec.sim = null; _impRecRender(); }
function impRecPartir(i, entran) {
  var l = _impRec.lineas[i]; var resto = (Number(l.cantidad) || 0) - entran;
  l.cantidad = entran; l.resolucion = "";
  if (resto > 0) _impRec.lineas.splice(i + 1, 0, { destino: "a_guardar", sector: "", cantidad: resto, resolucion: "" });
  _impRec.sim = null; impRecRevisar();
}
function _impRecValidar() {
  var c = _impRec.ctx;
  if (c.dual && !_impRec.empresa) return "Elegí de qué empresa es (LK o CH).";
  var tot = _impRecTotales();
  if (tot.cajas > 0 && !(Number(_impRec.uxc) > 0)) return "Falta cuántas unidades trae cada caja.";
  for (var i = 0; i < _impRec.lineas.length; i++) {
    var l = _impRec.lineas[i];
    if (!_impRecU(l) && l.modo === "u" && Number(l.uni) > 0 && !(Number(_impRec.uxc) > 0)) return "Para convertir unidades a cajas falta cuántas unidades trae cada caja.";
    if (!(Number(l.cantidad) > 0)) return "Cada destino tiene que tener una cantidad.";
    if ((l.destino === "gondola" || l.destino === "rack" || l.destino === "insumos") && !l.sector) return "Elegí el lugar de " + _IMP_REC_DEST[l.destino] + ".";
  }
  return "";
}
function _impRecFn() { return _impRec.ctx.sin_pedido ? "gv_imp_recibir_sin_pedido" : "gv_imp_recibir"; }   // v25.66
function _impRecBody(simular) {
  if (_impRec.ctx.sin_pedido) {
    var b = _impRecBodyBache(simular); delete b.p_bache_id; delete b.p_cerrar;
    b.p_importado_id = _impRec.ctx.importado_id; return b;
  }
  return _impRecBodyBache(simular);
}
function _impRecBodyBache(simular) {
  return { p_bache_id: _impRec.ctx.bache_id, p_empresa: _impRec.empresa || null, p_uni_x_caja: Number(_impRec.uxc) || null,
    p_destinos: _impRec.lineas.map(function (l) { return { destino: l.destino, sector: l.sector || null, cantidad: Number(l.cantidad), cod_insumo: l.cod_insumo || null, resolucion: l.resolucion || null, unidad: _impRecU(l) ? "Uni" : null }; }),
    p_nota: _impRec.nota || null, p_simular: !!simular, p_cerrar: _impRec.cerrar === true || _impRecTotales().uni >= (Number(_impRec.ctx.pendiente) || 0), p_client_id: _impRec.cid };
}
async function impRecRevisar() {
  if (!_impRec) return;
  var v = _impRecValidar(); if (v) { _impRec.err = v; _impRecRender(); return; }
  try { _impRec.sim = await _pedImpRpc(_impRecFn(), _impRecBody(true)); _impRec.err = ""; }
  catch (e) { _impRec.sim = null; _impRec.err = _impRecErr(e); }
  _impRecRender();
}
async function impRecGrabar() {
  if (!_impRec || _impRec.grabando) return;
  var v = _impRecValidar(); if (v) { _impRec.err = v; _impRecRender(); return; }
  var tot = _impRecTotales(), pend = Number(_impRec.ctx.pendiente) || 0;
  var resumen = "Recibir " + tot.uni.toLocaleString("es-AR") + " u de " + (_impRec.ctx.cod_stock || _impRec.ctx.cod_art) +
    (_impRec.ctx.dual ? " (" + _impRec.empresa + ")" : "") + ":\n" +
    _impRec.lineas.map(function (l) { return "  · " + l.cantidad + (_impRecU(l) ? " u" : " cajas") + " → " + _IMP_REC_DEST[l.destino] + (l.sector ? " " + l.sector : ""); }).join("\n") +
    "\n\n" + (_impRec.ctx.sin_pedido ? "⚠ NO HAY PEDIDO REGISTRADO de este código: entra todo al stock y queda anotado como recepción SIN PEDIDO. No descuenta ningún pedido en viaje."
      : tot.uni >= pend ? "El pedido queda RECIBIDO" + (tot.uni > pend ? " (llegan " + (tot.uni - pend) + " u de más)." : ".")
      : (_impRec.cerrar ? "⛔ SE CIERRA EL PEDIDO COMPLETO: las " + (pend - tot.uni) + " u que faltan dejan de estar pedidas (quedan como faltante)." : "Recepción parcial: siguen pedidas " + (pend - tot.uni) + " u.")) +
    "\n\n¿Confirmás?";
  if (!confirm(resumen)) return;
  _impRec.grabando = true;
  var r;
  try { r = await _pedImpRpc(_impRecFn(), _impRecBody(false)); }
  catch (e) { _impRec.grabando = false; _impRec.err = _impRecErr(e) + " — No se grabó nada. Si fue un corte de red, volvé a tocar Confirmar: no se graba dos veces."; _impRecRender(); return; }
  _impRec.grabando = false;
  if (!r || !r.ok) { _impRec.sim = r; _impRec.err = "Apareció un conflicto de espacio mientras cargabas: resolvelo y confirmá de nuevo."; _impRecRender(); return; }
  _impRec.hecho = true;
  var dest = _impRec.lineas.map(function (l) { return l.cantidad + (_impRecU(l) ? " u" : " cj") + " → " + _IMP_REC_DEST[l.destino] + (l.sector ? " " + l.sector : ""); }).join(" · ");
  _impRecShell("📥 Recepción grabada", '<div class="irc-ok">✓ Recibidas <b>' + Number(r.unidades).toLocaleString("es-AR") + ' u</b> (' + r.cajas + ' cajas). ' + escapeHtml(dest) + '</div>' +
    '<div class="irc-muted" style="margin-top:8px">' + (r.repetida ? "(Ya estaba grabada: no se cargó dos veces.) " : "") +
    (r.sin_pedido ? "Quedó anotada como recepción SIN PEDIDO (no había pedido en viaje). " : r.estado === "llegado" ? "El pedido quedó RECIBIDO y ya no figura en viaje." + (Number(r.faltante) > 0 ? " Faltaron " + Number(r.faltante).toLocaleString("es-AR") + " u (anotadas)." : "") : "El pedido sigue en curso con lo que falta.") +
    (!r.sin_pedido && Number(r.sobra) > 0 ? ' Llegaron ' + Number(r.sobra).toLocaleString("es-AR") + ' u más de lo pedido: entraron al stock igual.' : '') + '</div>' +
    (_impRec.lineas.some(function (l) { return l.destino === "cervantes"; }) ? '<div class="irc-ok" style="margin-top:8px">🏭 Lo que va a <b>Cervantes</b> no entró al stock de Virgilio: les aparece en <b>Recepción de Insumos → Importados</b> de GP2 para que digan <b>Sí</b> o <b>No</b>. Si dicen No, el pedido vuelve a estar en viaje con «Denegado por Cervantes».</div>' : '') +
    '<div style="margin-top:10px"><button class="irc-b pri" onclick="impRecCerrar()">Listo</button><button class="irc-b sec" onclick="impRecCerrar();openImpHistRecep()">Ver historial de recepción</button></div>');
}
/* Solapa 🚫 Discontinuos (v24.49, Thomas: "no deben aparecer en módulo importados, sino dentro de
   discontinuos de importados"). Son los de Importados.activo = false: la pantalla de Pedidos los
   saca con activo=eq.true, y acá se listan con su stock y en camino para que no se pierdan. */
async function openImpDisc() {
  _stkPopShell("🚫 Importados discontinuos", "stkPopBody", true);
  var body = document.getElementById("stkPopBody"); if (!body) return;
  body.innerHTML = _impTabsHtml('disc') + '<div class="stkpop-empty">Cargando…</div>';
  _stkPop = { kind: "impDisc" };
  var rows = null, mot = {};
  try {
    var r = await Promise.all([
      supaFetchAllSafe(SUPABASE_IMPORTADOS_OC_ENDPOINT, "select=cod_art,marca,proveedor,descripcion,stock_total,pedido_curso&principal=eq.true&activo=eq.false"),
      supaFetchAllSafe(SUPABASE_URL + "/rest/v1/Articulos_Discontinuados", "select=cod,motivo").catch(function () { return []; })
    ]);
    rows = r[0] || [];
    (r[1] || []).forEach(function (x) { if (x && x.cod) mot[String(x.cod).trim().toUpperCase()] = x.motivo || ""; });
  } catch (e) { rows = null; }
  if (!_stkPop || _stkPop.kind !== "impDisc") return;
  var h = _impTabsHtml('disc');
  if (rows === null) { body.innerHTML = h + '<div class="stkpop-empty" style="color:#b91c1c">No se pudo leer la lista. Probá de nuevo.</div>'; return; }
  if (!rows.length) { body.innerHTML = h + '<div class="stkpop-empty">No hay importados discontinuos.</div>'; return; }
  rows.sort(function (a, b) { return String(a.cod_art).localeCompare(String(b.cod_art), "es", { numeric: true }); });
  var n = function (v) { var x = Number(v) || 0; return x ? x.toLocaleString("es-AR", { maximumFractionDigits: 0 }) : '<span style="color:#94a3b8">0</span>'; };
  h += '<div style="font-size:12px;color:#64748b;margin:0 0 6px;text-align:center">' + rows.length + ' códigos dados de baja · no salen en 📦 Pedidos ni en el PDF</div>' +
    '<table class="mva-tbl" style="margin:0 auto;width:auto"><thead><tr><th>Código</th><th>Descripción</th><th>Emp.</th><th>Proveedor</th><th class="num">Stock<br><small>u</small></th><th class="num">En camino<br><small>u</small></th><th>Motivo</th></tr></thead><tbody>' +
    rows.map(function (r) {
      var c = String(r.cod_art || "").trim();
      var m = String(r.marca || "").trim().toUpperCase() === "CH" ? "CH" : "LK";
      return '<tr><td class="c"><b>' + escapeHtml(c) + '</b></td><td>' + escapeHtml(r.descripcion || "") + '</td><td class="c">' + m + '</td><td class="c">' + escapeHtml(r.proveedor || "—") + '</td><td class="num">' + n(r.stock_total) + '</td><td class="num">' + n(r.pedido_curso) + '</td><td>' + escapeHtml(mot[c.toUpperCase()] || "—") + '</td></tr>';
    }).join("") + '</tbody></table>';
  body.innerHTML = h;
}
/* Solapa 📜 Historial (v23.91, Luis: "debería pasar a ser Historial y mostrar recepción y
   pedidos"). Dos vistas del mismo circuito: lo que se PIDIÓ (baches, agrupados por pedido y
   proveedor → gv_imp_pedidos_historial) y lo que se RECIBIÓ con 📥 RECIBIR. */
async function openImpHistRecep() {
  _stkPopShell("📜 Historial de importaciones", "stkPopBody", true);
  var body = document.getElementById("stkPopBody"); if (!body) return;
  body.innerHTML = _impTabsHtml('hist') + '<div class="stkpop-empty">Cargando historial…</div>';
  _stkPop = { kind: "impHist", rows: [], peds: [], q: "", dias: 365, vista: "rec" };
  var r = await Promise.all([
    _pedImpRpc("gv_imp_recepcion_historial", { p_dias: 365 }).catch(function (e) { _stkPop.err = _impRecErr(e); return []; }),
    _pedImpRpc("gv_imp_pedidos_historial", { p_dias: 365 }).catch(function (e) { _stkPop.errPed = _impRecErr(e); return []; })
  ]);
  _stkPop.rows = r[0] || []; _stkPop.peds = r[1] || [];
  _impHistRender();
}
function impHistVista(v) { if (!_stkPop || _stkPop.kind !== "impHist") return; _stkPop.vista = v; _impHistRender(); }
/* Los PEDIDOS: un renglón por (pedido, proveedor), con lo pedido, lo llegado y su estado. */
function _impHistPedidosHtml() {
  var q = String(_stkPop.q || "").trim().toLowerCase();
  var rows = (_stkPop.peds || []).filter(function (r) {
    if (!q) return true;
    return [r.pedido_ref, r.proveedor, r.codigos, r.creado_por, r.estado].join(" ").toLowerCase().indexOf(q) >= 0;
  });
  if (_stkPop.errPed) return '<div class="stkpop-empty">No se pudieron leer los pedidos: ' + escapeHtml(_stkPop.errPed) + '</div>';
  if (!rows.length) return '<div class="stkpop-empty">' + (q ? 'Ningún pedido coincide con la búsqueda.' : 'Todavía no hay pedidos cargados.') + '</div>';
  var _f = function (d) { return d ? _isoToDdMmAa(String(d).slice(0, 10)) : "—"; };
  var _n = function (v) { return Math.round(Number(v) || 0).toLocaleString("es-AR"); };
  var _chip = function (e) {
    var c = { "en curso": ["#eef2ff", "#3730a3"], "llegado": ["#dcfce7", "#166534"], "anulado": ["#fee2e2", "#b91c1c"] }[e] || ["#f1f5f9", "#475569"];
    return '<span style="background:' + c[0] + ';color:' + c[1] + ';border-radius:999px;padding:1px 8px;font-size:11px;font-weight:800">' + escapeHtml(e) + '</span>';
  };
  return '<div class="mva-tblwrap" style="max-height:66vh;overflow-x:auto"><table class="mva-tbl" style="font-size:13px;width:auto;min-width:0;table-layout:auto">' +
    '<thead><tr><th>Pedido</th><th>Proveedor</th><th>Cargado</th><th>Embarque</th><th>Reingreso</th><th class="num">Ítems</th><th class="num">Unidades</th><th class="num">u$s</th><th>Estado</th><th>Códigos</th></tr></thead><tbody>' +
    rows.map(function (r) {
      var lleg = Number(r.llegadas) || 0, uni = Number(r.unidades) || 0;
      return '<tr><td style="white-space:normal;max-width:190px"><b>' + escapeHtml(r.pedido_ref || "") + '</b>' +
        (Number(r.anulados) > 0 ? '<br><span class="irc-muted">' + r.anulados + ' línea(s) anulada(s)</span>' : '') + '</td>' +
        '<td style="white-space:nowrap">' + escapeHtml(r.proveedor || "") + '</td>' +
        '<td style="white-space:nowrap">' + _f(r.creado) + (r.creado_por ? '<br><span class="irc-muted">' + escapeHtml(String(r.creado_por).replace(/@.*/, "")) + '</span>' : '') + '</td>' +
        '<td style="white-space:nowrap">' + _f(r.embarque) + '</td><td style="white-space:nowrap">' + _f(r.reingreso) + '</td>' +
        '<td class="num">' + (Number(r.items) || 0) + '</td>' +
        '<td class="num">' + _n(uni) + (lleg > 0 ? '<br><span class="irc-muted">llegaron ' + _n(lleg) + '</span>' : '') + '</td>' +
        '<td class="num">' + (Number(r.usd) > 0 ? 'u$s ' + _n(r.usd) : '—') + '</td>' +
        '<td style="white-space:nowrap">' + _chip(r.estado || "") + '</td>' +
        '<td style="white-space:normal;max-width:240px;font-size:11.5px;color:#475569">' + escapeHtml(r.codigos || "") + '</td></tr>';
    }).join('') + '</tbody></table></div>';
}
async function impHistAnular(id) {
  var m = prompt("Anular la recepción: se sacan del stock las cajas que entraron y el pedido vuelve a figurar en viaje.\n\n¿Por qué se anula?");
  if (m == null) return;
  if (String(m).trim().length < 3) { alert("Escribí por qué se anula."); return; }
  try { await _pedImpRpc("gv_imp_recepcion_anular", { p_id: id, p_motivo: String(m).trim() }); }
  catch (e) { alert(_impRecErr(e)); return; }
  try { _stkPop.rows = (await _pedImpRpc("gv_imp_recepcion_historial", { p_dias: 365 })) || []; } catch (_e) {}
  _impHistRender();
}
function impHistBuscar(v) { if (!_stkPop || _stkPop.kind !== "impHist") return; _stkPop.q = v; _impHistRender(); }
function _impHistRender() {
  if (!_stkPop || _stkPop.kind !== "impHist") return;
  var body = document.getElementById("stkPopBody"); if (!body) return;
  var q = String(_stkPop.q || "").trim().toLowerCase();
  var rows = (_stkPop.rows || []).filter(function (r) {
    if (!q) return true;
    return [r.cod_art, r.descripcion, r.proveedor, r.pedido_ref, r.por, r.nota].join(" ").toLowerCase().indexOf(q) >= 0;
  });
  // v23.91 — dos vistas: los PEDIDOS y las RECEPCIONES. La búsqueda vale para las dos.
  var esPed = (_stkPop.vista === "ped");
  var sub = function (id, txt, n) {
    var on = (esPed === (id === "ped"));
    return '<button onclick="impHistVista(\'' + id + '\')" style="padding:5px 13px;border-radius:999px;border:1px solid ' + (on ? '#0f766e' : '#cbd5e1') + ';background:' + (on ? '#0f766e' : '#fff') + ';color:' + (on ? '#fff' : '#334155') + ';font-weight:800;font-size:12.5px;cursor:pointer">' + txt + ' <span style="opacity:.75">' + n + '</span></button>';
  };
  var h = _impTabsHtml('hist') +
    '<div style="display:flex;gap:7px;margin:0 0 9px;flex-wrap:wrap">' +
      sub("ped", "🚢 Pedidos", (_stkPop.peds || []).length) + sub("rec", "📥 Recepciones", (_stkPop.rows || []).length) + '</div>' +
    '<div class="stkpop-hint">' + (esPed
      ? 'Lo que se le <b>pidió</b> a cada fábrica: un renglón por pedido, con cuándo se cargó, cuándo embarca, cuándo reingresa y cuánto llegó. Un pedido sin PI se agrupa por el día en que se cargó.'
      : 'Cada recepción hecha con <b>📥 RECIBIR</b>: cuándo, qué, cuánto, de qué empresa, dónde se guardó y quién la cargó. Lo marcado ⚠ se puso igual aunque el lugar tenía un conflicto de espacio.') + '</div>' +
    '<input type="search" placeholder="Buscar código, proveedor, pedido o persona" value="' + escapeHtml(_stkPop.q || "") + '" oninput="impHistBuscar(this.value)" style="height:36px;border:1.5px solid #cbd5e1;border-radius:8px;padding:0 10px;font-size:14px;width:min(420px,100%);margin:0 0 10px">';
  if (esPed) { body.innerHTML = h + _impHistPedidosHtml(); return; }
  if (_stkPop.err) h += '<div class="stkpop-empty">No se pudo leer el historial: ' + escapeHtml(_stkPop.err) + '</div>';
  else if (!rows.length) h += '<div class="stkpop-empty">' + (q ? 'Nada coincide con la búsqueda.' : 'Todavía no hay recepciones cargadas con 📥 RECIBIR.') + '</div>';
  else {
    h += '<div class="mva-tblwrap" style="max-height:66vh;overflow-x:auto"><table class="mva-tbl" style="font-size:13px;width:auto;min-width:0;table-layout:auto"><thead><tr><th>Fecha</th><th>Código</th><th>Emp.</th><th>Proveedor · pedido</th><th class="num">Recibido</th><th>Dónde</th><th>Quién</th><th>Nota</th><th></th></tr></thead><tbody>' +
      rows.map(function (r) {
        var f = new Date(r.ts);
        var fecha = isNaN(f) ? String(r.ts || "") : f.toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
        var donde = (r.destinos || []).map(function (d) {
          return (d.conflicto && d.resolucion === "forzar" ? '<span title="' + escapeHtml(d.conflicto) + '">⚠ </span>' : '') +
            Number(d.cantidad).toLocaleString("es-AR") + (d.unidad === "Uni" ? " u" : " cj") + ' → ' + (_IMP_REC_DEST[d.destino] || d.destino) + (d.sector ? ' <b>' + escapeHtml(d.sector) + '</b>' : '') +
            (d.denegado_en ? _impCervDenChip({ unidades: d.denegado_unidades, denegado_en: d.denegado_en, motivo: d.denegado_motivo }) : '');   // v25.37
        }).join('<br>');
        return '<tr' + (r.anulada_en ? ' style="opacity:.55;text-decoration:line-through"' : '') + '><td style="white-space:nowrap">' + escapeHtml(fecha) + '</td><td style="white-space:normal;max-width:220px"><b>' + escapeHtml(codCanon(r.cod_art)) + '</b> <span class="irc-muted">' + escapeHtml(r.descripcion || "") + '</span></td>' +
          '<td>' + escapeHtml(r.empresa || "") + '</td><td style="white-space:normal;max-width:180px">' + escapeHtml(r.proveedor || "") + '<br><span class="irc-muted">' + escapeHtml(r.pedido_ref || "") + '</span></td>' +
          '<td class="num">' + Number(r.unidades).toLocaleString("es-AR") + ' u<br><span class="irc-muted">' + (Number(r.cajas) || 0) + ' cj · ' + (r.estado_bache === "llegado" ? "recibido" : "sigue en viaje") +
            (Number(r.faltante) > 0 ? ' · faltaron ' + Number(r.faltante).toLocaleString("es-AR") : '') + (Number(r.sobrante) > 0 ? ' · de más ' + Number(r.sobrante).toLocaleString("es-AR") : '') + '</span></td>' +
          '<td style="white-space:nowrap">' + donde + '</td><td style="white-space:nowrap">' + escapeHtml(String(r.por || "").replace(/@.*/, "")) + '</td><td style="white-space:normal;max-width:200px">' + escapeHtml(r.nota || "") +
          (r.anulada_en ? '<br><b style="color:#b91c1c">ANULADA</b> <span class="irc-muted">' + escapeHtml(r.anulada_motivo || "") + '</span>' : '') + '</td>' +
          '<td>' + (r.es_ultima ? '<button class="stk-btn" style="padding:3px 8px;font-size:12px;background:#fee2e2;color:#b91c1c;border-color:#fecaca" onclick="impHistAnular(' + r.id + ')">↩ Anular</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  body.innerHTML = h;
}
async function pedImpBacheEditar(bacheId) {
  if (!_impBaches) return;
  var r = (_impBaches.rows || []).find(function (x) { return x.id === bacheId; });
  var curU = r ? String(r.unidades) : "";
  var curF = (r && r.fecha_reingreso) ? _isoToDdMmAa(String(r.fecha_reingreso).slice(0, 10)) : "";
  var uv; try { uv = prompt("Unidades del bache:", curU); } catch (_e) { return; }
  if (uv === null) return;
  var uni = parseInt(String(uv).replace(/[^\d]/g, ""), 10);
  if (!(uni > 0)) { try { alert("Unidades inválidas."); } catch (_e) {} return; }
  var fv; try { fv = prompt("Fecha de reingreso (dd/mm/aa).\nVacío = sin fecha:", curF); } catch (_e) { return; }
  if (fv === null) return;
  var iso = null;
  if (String(fv).trim() !== "") { iso = _pedImpParseFechaISO(fv); if (iso === null) { try { alert("Fecha inválida (usá dd/mm/aa)."); } catch (_e) {} return; } }
  try { await _pedImpRpc("gv_importado_bache_editar", { p_bache_id: bacheId, p_unidades: uni, p_fecha: iso, p_set_fecha: true }); _impBaches.dirty = true; }
  catch (e) { try { alert("No se pudo editar: " + (e.message || e)); } catch (_e) {} return; }
  await _impBachesReload();
}
async function pedImpBacheBorrar(bacheId) {
  if (!_impBaches) return;
  var ok = false; try { ok = confirm("¿Anular este bache? Sale del 'en curso'."); } catch (_e) { ok = false; }
  if (!ok) return;
  try { await _pedImpRpc("gv_importado_bache_borrar", { p_bache_id: bacheId }); _impBaches.dirty = true; }
  catch (e) { try { alert("No se pudo anular: " + (e.message || e)); } catch (_e) {} return; }
  await _impBachesReload();
}
/* v22.91 — 📒 CUENTA CORRIENTE POR PROVEEDOR (Thomas, 26/09: "debería estar la cta corriente de Hugo Wong,
   Becky Chen, Ownland" · sobre el formato: "la que creas mejor, entendible y analizable").
   Hasta acá la plata se veía POR PEDIDO (💵 Plata de 🚢 En curso) y la cuenta de NTL POR EMPRESA (💱 NTL):
   nadie juntaba, por fábrica, cuánto le debemos, cuánto le giramos y por dónde. Tres bloques por
   proveedor, cada uno de UNA fuente con su etiqueta, sin sumar cosas de fuentes distintas:
     · HOY   — los pedidos en curso con la planilla de deudas: FOB · girado · a girar por banco · falta.
     · LIBRO — el PI (nos factura) y cada giro (le giramos) en orden de fecha, saldo corrido = FOB − giros.
     · HISTORIA — la hoja del proveedor del Excel de Thomas tal cual (con SU saldo, no se rehace) y el
       extracto de NTL de esa fábrica (girado / recuperado). Sólo lectura: los giros se cargan en 🚢 En
       curso (💵 Giros) y el extracto en 💱 NTL.
   Backend: gv_imp_prov_cc_resumen() y gv_imp_prov_cc_libro(p_proveedor) — sql/gv_imp_prov_cuenta_v2291.sql. */
let _impProv = null;
async function openImpProvCC() {
  _stkPopShell("📒 Cuenta corriente por proveedor", "stkPopBody", true);
  const body = document.getElementById("stkPopBody"); if (!body) return;
  body.innerHTML = '<div class="stkpop-empty">Cargando las cuentas por proveedor…</div>';
  _stkPop = { kind: "impProv" };
  _impProv = { resumen: [], prov: "", libro: [], err: "", errLibro: "", hist: false };
  try { _impProv.resumen = (await _pedImpRpc("gv_imp_prov_cc_resumen", {})) || []; }
  catch (e) { _impProv.err = e.message || String(e); }
  // arranca parado en el que más se le debe (el backend ya los manda en ese orden)
  const primero = (_impProv.resumen || [])[0];
  if (primero) await impProvSet(_impCursoEnc(primero.prov)); else _impProvRender();
}
async function impProvSet(enc) {
  if (!_impProv) return;
  _impProv.prov = decodeURIComponent(enc || "");
  _impProv.libro = []; _impProv.errLibro = "";
  try { _impProv.libro = (await _pedImpRpc("gv_imp_prov_cc_libro", { p_proveedor: _impProv.prov })) || []; }
  catch (e) { _impProv.errLibro = e.message || String(e); }
  _impProvRender();
}
function impProvToggleHist() { if (!_impProv) return; _impProv.hist = !_impProv.hist; _impProvRender(); }
/* fechas del módulo: dd/mm/aa (v15.18) */
function _impProvFecha(iso) {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  return m ? (m[3] + "/" + m[2] + "/" + m[1].slice(2)) : String(iso);
}
function _impProvUsd(n, dec) {
  if (n == null || n === "") return "—";
  return _impNtlNum(n, dec == null ? 2 : dec);
}
function _impProvCanal(x) {
  const c = String(x.canal || '').trim();
  if (!c) return '<span class="ipc-sub">—</span>';
  if (/^ntl$/i.test(c)) return '<span class="ipc-chip ntl">NTL</span>';
  if (/^bco$/i.test(c)) return '<span class="ipc-chip bco">Banco</span>';
  return '<span class="ipc-chip pi">' + escapeHtml(c) + '</span>';
}
function _impProvRender() {
  const body = document.getElementById("stkPopBody"); if (!body || !_stkPop || _stkPop.kind !== "impProv") return;
  if (!document.getElementById("impProvCss")) {
    const cs = document.createElement("style"); cs.id = "impProvCss";
    cs.textContent =
      ".ipc-tbl{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;margin-bottom:12px}" +
      ".ipc-tbl th{font-size:10.5px;text-transform:uppercase;letter-spacing:.3px;color:#64748b;font-weight:800;padding:7px 7px;border-bottom:2px solid #e2e8f0;text-align:left;white-space:nowrap}" +
      ".ipc-tbl td{padding:6px 7px;border-bottom:1px solid #f1f5f9;font-size:12.5px;color:#0f172a;vertical-align:middle}" +
      ".ipc-tbl td.num,.ipc-tbl th.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}" +
      ".ipc-tbl tr.ipc-ped>td{background:#f8fafc;font-weight:800}" +
      ".ipc-tbl td.saldo{font-weight:800}" +
      ".ipc-mono{font-family:Consolas,Menlo,monospace;font-size:12px;font-weight:800}" +
      ".ipc-sub{font-size:10.5px;color:#64748b;font-weight:700}" +
      ".ipc-chip{font-size:10.5px;font-weight:800;padding:2px 7px;border-radius:999px;white-space:nowrap;display:inline-block}" +
      ".ipc-chip.ntl{background:#eef2ff;color:#4338ca}.ipc-chip.bco{background:#ecfdf5;color:#047857}" +
      ".ipc-chip.pi{background:#f1f5f9;color:#475569}" +
      ".ipc-neg{color:#b91c1c}.ipc-pos{color:#065f46}" +
      ".ipc-h{font-size:13px;font-weight:900;color:#0f172a;margin:14px 0 6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}" +
      ".ipc-kpi{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px}" +
      ".ipc-kpi>div{flex:1;min-width:150px;border-radius:10px;padding:9px 13px;border:1px solid #e2e8f0;background:#f8fafc}" +
      ".ipc-kpi .k{font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.4px;color:#475569}" +
      ".ipc-kpi .v{font-size:20px;font-weight:900;margin-top:2px}" +
      ".ipc-aviso{margin-bottom:10px;padding:8px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;font-size:12.5px;color:#92400e}" +
      ".ipc-prov{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;align-items:center}" +
      ".ipc-prov button{width:auto;margin:0;flex:0 0 auto;padding:6px 11px;border-radius:999px;border:1px solid #cbd5e1;background:#fff;color:#334155;font-size:12.5px;font-weight:800;cursor:pointer}" +
      ".ipc-prov button.on{border-color:#0f766e;background:#0f766e;color:#fff}" +
      ".ipc-prov button b{font-variant-numeric:tabular-nums}" +
      ".ipc-b{width:auto;margin:0;padding:5px 10px;border-radius:8px;border:1px solid #cbd5e1;background:#fff;color:#334155;font-size:12px;font-weight:800;cursor:pointer}";
    document.head.appendChild(cs);
  }
  const st = _impProv, res = st.resumen || [];
  let h = _impTabsHtml('provcc');
  h += '<div class="stkpop-hint">Una cuenta por <b>fábrica china</b>, armada con lo que ya está cargado. <b>Hoy</b> = la planilla de deudas ' +
       '(cuánto le debemos por los pedidos en curso y por dónde se paga) · <b>Libro</b> = el PI y cada giro, en orden, con el saldo corrido · ' +
       '<b>Historia</b> = la hoja del proveedor del Excel (con su saldo tal cual) y lo que el extracto de NTL le giró. ' +
       'Cada renglón dice de qué fuente sale; no se suman fuentes distintas. Los giros se cargan en 🚢 En curso → 💵 Giros.</div>';
  if (st.err) h += '<div class="stkpop-empty" style="color:#b91c1c">No se pudo leer: ' + escapeHtml(st.err) + '</div>';
  if (!res.length) { body.innerHTML = h + '<div class="stkpop-empty">No hay proveedores con cuenta.</div>'; return; }
  // fichas de proveedor, en el orden del backend (más deuda primero)
  h += '<div class="ipc-prov"><span class="ipc-sub" style="font-size:12px">🏭 Proveedor:</span>' +
    res.map(function (r) {
      const s = Number(r.saldo) || 0;
      return '<button class="' + (st.prov === r.prov ? 'on' : '') + '" onclick="impProvSet(\'' + _impCursoEnc(r.prov) + '\')" title="' +
        escapeHtml((r.pedidos || 0) + ' pedido(s) en curso · ' + (r.ntl_movs || 0) + ' mov. en NTL' + (r.hoja_movs ? ' · hoja del Excel' : '')) + '">' +
        escapeHtml(r.prov) + (s ? ' <b>' + _impProvUsd(s, 0) + '</b>' : '') + '</button>';
    }).join('') + '</div>';
  const r = res.find(function (x) { return x.prov === st.prov; });
  if (!r) { body.innerHTML = h + '<div class="stkpop-empty">Elegí un proveedor.</div>'; return; }
  const saldo = Number(r.saldo) || 0;
  const emp = r.empresa === 'TN' ? 'Tierra Nativa' : r.empresa === 'CH' ? 'Chef' : (r.empresa || '');
  h += '<div class="ipc-h">' + escapeHtml(r.prov) + (emp ? ' <span class="ipc-chip pi">' + escapeHtml(emp) + '</span>' : '') +
       ' <span class="ipc-sub">' + (r.pedidos || 0) + ' pedido(s) en curso · ' + _impCursoNum(r.unidades || 0) + ' u · ' +
       (Number(r.m3) || 0).toLocaleString("es-AR", { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + ' m³</span>' +
       '<button class="ipc-b" style="margin-left:auto" onclick="impProvExportExcel()">⬇ Excel</button></div>';
  // ---- HOY ----
  const dEmb = _impCursoDias(r.prox_embarque);
  h += '<div class="ipc-kpi">' +
    '<div style="background:' + (saldo > 0 ? '#fef2f2;border-color:#fecaca' : '#ecfdf5;border-color:#a7f3d0') + '"><div class="k">Le debemos hoy</div><div class="v ' + (saldo > 0 ? 'ipc-neg' : 'ipc-pos') + '">u$s ' + _impProvUsd(saldo, 0) + '</div><div class="ipc-sub">FOB ' + _impProvUsd(r.fob, 0) + ' − girado ' + _impProvUsd(r.pagado, 0) + '</div></div>' +
    '<div><div class="k">Le giramos</div><div class="v">u$s ' + _impProvUsd(r.pagado, 0) + '</div><div class="ipc-sub">' + (r.giros || 0) + ' giro(s)' + (r.ultimo_giro ? ' · último ' + _impProvFecha(r.ultimo_giro) : '') + '</div></div>' +
    '<div><div class="k">Por banco, contra factura vieja</div><div class="v">u$s ' + _impProvUsd(r.pend_giro_directo, 0) + '</div><div class="ipc-sub">' +
      (r.papa_banco_factura ? 'factura ' + escapeHtml(r.papa_banco_factura) + (r.papa_banco_bl ? ' · BL ' + _impProvFecha(r.papa_banco_bl) : '') : 'pend. giro directo de la planilla') + '</div></div>' +
    '<div><div class="k">Falta cubrir</div><div class="v">u$s ' + _impProvUsd(r.falta, 0) + '</div><div class="ipc-sub">sin giro y sin factura vieja que lo tape</div></div>' +
    '<div><div class="k">Próximo embarque · llegada</div><div class="v" style="font-size:16px">' + _impProvFecha(r.prox_embarque) + ' · ' + _impProvFecha(r.prox_llegada) + '</div><div class="ipc-sub">' +
      (dEmb != null ? 'embarca en ' + dEmb + ' d' : 'sin embarque a futuro') + '</div></div>' +
    '</div>';
  // avisos: lo que este cuadro no puede resolver solo
  const avisos = [];
  const pedidos = (st.libro || []).filter(function (x) { return x.fuente === 'pedido'; });
  pedidos.forEach(function (p) {
    if ((Number(p.fob) || 0) > 0 && !(Number(p.pagado) > 0)) avisos.push('<b>' + escapeHtml(p.carga) + '</b> no tiene ningún giro cargado: figura como deuda entera (u$s ' + _impProvUsd(p.fob, 0) + ').');
  });
  if (r.fob_difiere) avisos.push('Hay un PI cuyo FOB cargado difiere del que calcula el motor (ver 💵 Plata en 🚢 En curso).');
  if (!(r.hoja_movs > 0)) avisos.push('Sin hoja histórica en el Excel (sólo Ownland y Frontier vinieron con hoja): lo anterior a los pedidos en curso está sólo en el extracto de NTL.');
  if (r.papa_fecha && Math.abs((Number(r.papa_real) || 0) - saldo) > 1) avisos.push('La planilla "formato papá" del ' + _impProvFecha(r.papa_fecha) + ' dice deuda real <b>u$s ' + _impProvUsd(r.papa_real, 0) + '</b> y ésta dice <b>u$s ' + _impProvUsd(saldo, 0) + '</b>: a una de las dos le falta un giro o un FOB.');
  if (avisos.length) h += '<div class="ipc-aviso">⚠ ' + avisos.join('<br>⚠ ') + '</div>';
  h += '<div class="ipc-h">Hoy <span class="ipc-sub">pedidos en curso, la planilla de deudas · u$s</span></div>';
  if (!pedidos.length) h += '<div class="stkpop-empty">Sin pedidos en curso.</div>';
  else {
    h += '<table class="ipc-tbl" id="ipcHoy"><thead><tr><th>PI</th><th>A nombre de</th><th class="num">FOB</th><th class="num">Girado</th><th class="num">Por banco</th><th class="num">Falta</th><th>Pago 30%</th><th>Embarque</th><th>Llegada</th></tr></thead><tbody>' +
      pedidos.map(function (p) {
        return '<tr><td class="ipc-mono">' + escapeHtml(p.carga) + '</td><td>' + escapeHtml(p.canal || '—') + '</td><td class="num">' + _impProvUsd(p.fob) + '</td><td class="num">' + _impProvUsd(p.pagado) + '</td><td class="num">' + _impProvUsd(p.pend_giro) + '</td>' +
          '<td class="num saldo ' + ((Number(p.falta) || 0) > 0 ? 'ipc-neg' : 'ipc-pos') + '">' + _impProvUsd(p.falta) + '</td><td>' + _impProvFecha(p.fecha) + '</td><td>' + _impProvFecha(p.embarque) + '</td><td>' + _impProvFecha(p.llegada) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }
  // ---- LIBRO ----
  const libro = (st.libro || []).filter(function (x) { return x.fuente === 'pedido' || x.fuente === 'giro'; });
  h += '<div class="ipc-h">Libro <span class="ipc-sub">el PI cuando nos factura · cada giro cuando le pagamos · saldo corrido = FOB − giros · u$s</span></div>';
  if (st.errLibro) h += '<div class="stkpop-empty" style="color:#b91c1c">No se pudo leer el libro: ' + escapeHtml(st.errLibro) + '</div>';
  if (!libro.length) h += '<div class="stkpop-empty">Sin movimientos cargados.</div>';
  else {
    h += '<table class="ipc-tbl" id="ipcLibro"><thead><tr><th>Fecha</th><th>Concepto</th><th>Pedido</th><th>Canal</th><th class="num">Nos factura</th><th class="num">Le giramos</th><th class="num">Saldo</th><th>Detalle</th></tr></thead><tbody>' +
      libro.map(function (x) {
        const s = Number(x.saldo) || 0;
        return '<tr class="' + (x.fuente === 'pedido' ? 'ipc-ped' : '') + '"><td>' + _impProvFecha(x.fecha) + '</td><td>' + escapeHtml(x.concepto || '') + '</td><td class="ipc-mono">' + escapeHtml(x.carga || '') + '</td><td>' + _impProvCanal(x) + '</td>' +
          '<td class="num">' + (x.fob != null ? _impProvUsd(x.fob) : '') + '</td><td class="num">' + (x.pago != null ? _impProvUsd(x.pago) : '') + '</td><td class="num saldo ' + (s > 0 ? 'ipc-neg' : 'ipc-pos') + '">' + _impProvUsd(s) + '</td>' +
          '<td class="ipc-sub">' + escapeHtml(x.detalle || '') + (x.a_traves_de ? ' · a través de ' + escapeHtml(x.a_traves_de) : '') + '</td></tr>';
      }).join('') + '</tbody></table>';
  }
  // ---- HISTORIA ----
  const hoja = (st.libro || []).filter(function (x) { return x.fuente === 'hoja'; });
  const ntl = (st.libro || []).filter(function (x) { return x.fuente === 'ntl'; });
  h += '<div class="ipc-h">Historia <span class="ipc-sub">' + hoja.length + ' renglón(es) de la hoja del Excel · ' + ntl.length + ' del extracto NTL (girado u$s ' + _impProvUsd(r.ntl_girado, 0) + ' · recuperado u$s ' + _impProvUsd(r.ntl_recuperado, 0) + ')</span>' +
       '<button class="ipc-b" id="ipcHistBtn" onclick="impProvToggleHist()">' + (st.hist ? '▲ Ocultar' : '▼ Ver') + '</button></div>';
  if (st.hist) {
    if (hoja.length) {
      h += '<div class="ipc-sub" style="margin-bottom:4px">Hoja <b>' + escapeHtml(r.prov) + '</b> del Excel <i>Cuenta_Corriente_NTL.xlsx</i>, tal cual: <b>Factura</b> = lo que nos facturó la carga · <b>Giro</b> = lo que le salió (por NTL o por banco, «a través de» la factura que se usó de papel) · <b>Saldo hoja</b> = el que calcula el Excel, no se rehace acá.</div>' +
        '<table class="ipc-tbl" id="ipcHoja"><thead><tr><th>Fecha</th><th>Concepto</th><th>Fue a</th><th>A través de</th><th>Salió por</th><th class="num">Factura</th><th class="num">Giro</th><th class="num">Saldo hoja</th></tr></thead><tbody>' +
        hoja.map(function (x) {
          return '<tr><td>' + _impProvFecha(x.fecha) + '</td><td>' + escapeHtml(x.concepto || '') + '</td><td class="ipc-mono">' + escapeHtml(x.carga || '') + '</td><td class="ipc-mono">' + escapeHtml(x.a_traves_de || '') + '</td><td>' + _impProvCanal(x) + '</td>' +
            '<td class="num">' + (x.fob != null ? _impProvUsd(x.fob) : '') + '</td><td class="num">' + (x.pago != null ? _impProvUsd(x.pago) : '') + '</td><td class="num saldo">' + (x.saldo_excel != null ? _impProvUsd(x.saldo_excel) : '') + '</td></tr>';
        }).join('') + '</tbody></table>';
    }
    if (ntl.length) {
      h += '<div class="ipc-sub" style="margin-bottom:4px">Extracto de <b>NTL</b> (Hong Kong), sólo los renglones de esta fábrica: <b>Girado</b> = lo que NTL le transfirió · <b>Recuperado</b> = lo que volvió a NTL al nacionalizar. Es la cuenta de NTL, no la del proveedor: se mira entera en 💱 NTL.</div>' +
        '<table class="ipc-tbl" id="ipcNtl"><thead><tr><th>Fecha</th><th>Descripción</th><th>Empresa</th><th class="num">Girado</th><th class="num">Recuperado</th><th>Detalle</th></tr></thead><tbody>' +
        ntl.map(function (x) {
          return '<tr><td>' + _impProvFecha(x.fecha) + '</td><td>' + escapeHtml(x.concepto || '') + '</td><td>' + escapeHtml(_impNtlEmpNom(x.empresa)) + '</td><td class="num">' + (x.pago != null ? _impProvUsd(x.pago) : '') + '</td><td class="num">' + (x.recupero != null ? _impProvUsd(x.recupero) : '') + '</td><td class="ipc-sub">' + escapeHtml(x.detalle || '') + '</td></tr>';
        }).join('') + '</tbody></table>';
    }
    if (!hoja.length && !ntl.length) h += '<div class="stkpop-empty">Sin historia cargada para este proveedor.</div>';
  }
  body.innerHTML = h;
}
function impProvExportExcel() {
  if (!_impProv || !_impProv.prov) return;
  const st = _impProv, r = (st.resumen || []).find(function (x) { return x.prov === st.prov; }) || {};
  const esc = function (s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); };
  const n = function (v) { return v == null || v === "" ? "" : Number(v); };
  const fecha = _impCursoHoy();
  let html = '<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"><style>td,th{border:1px solid #ccc;padding:3px 7px;font-family:Calibri,Arial,sans-serif;} th{background:#0f766e;color:#fff;} h3,h4,p{font-family:Calibri,Arial,sans-serif}</style></head><body>';
  html += '<h3>Cuenta corriente ' + esc(st.prov) + ' — Gestión Virgilio (' + esc(fecha) + ')</h3>';
  html += '<p>Le debemos hoy u$s ' + n(r.saldo) + ' · girado ' + n(r.pagado) + ' · por banco contra factura vieja ' + n(r.pend_giro_directo) + ' · falta ' + n(r.falta) + '</p>';
  const secciones = [
    ['Libro (PI y giros, saldo corrido)', ['pedido', 'giro'], ['Fecha', 'Concepto', 'Pedido', 'Canal', 'Nos factura', 'Le giramos', 'Saldo', 'A traves de', 'Detalle'],
      function (x) { return [x.fecha, x.concepto, x.carga, x.canal, n(x.fob), n(x.pago), n(x.saldo), x.a_traves_de, x.detalle]; }],
    ['Hoja del Excel (tal cual)', ['hoja'], ['Fecha', 'Concepto', 'Fue a', 'A traves de', 'Salio por', 'Factura', 'Giro', 'Saldo hoja'],
      function (x) { return [x.fecha, x.concepto, x.carga, x.a_traves_de, x.canal, n(x.fob), n(x.pago), n(x.saldo_excel)]; }],
    ['Extracto NTL (esta fabrica)', ['ntl'], ['Fecha', 'Descripcion', 'Empresa', 'Girado', 'Recuperado', 'Detalle'],
      function (x) { return [x.fecha, x.concepto, x.empresa, n(x.pago), n(x.recupero), x.detalle]; }]
  ];
  secciones.forEach(function (s) {
    const rows = (st.libro || []).filter(function (x) { return s[1].indexOf(x.fuente) >= 0; });
    if (!rows.length) return;
    html += '<h4>' + esc(s[0]) + '</h4><table><tr>' + s[2].map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr>' +
      rows.map(function (x) { return '<tr>' + s[3](x).map(function (v) { return '<td>' + esc(v) + '</td>'; }).join('') + '</tr>'; }).join('') + '</table>';
  });
  html += '</body></html>';
  try {
    const blob = new Blob(["﻿" + html], { type: "application/vnd.ms-excel" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "Cta_" + String(st.prov).replace(/[^A-Za-z0-9]+/g, "_") + "_" + fecha + ".xls";
    document.body.appendChild(a); a.click();
    setTimeout(function () { try { document.body.removeChild(a); URL.revokeObjectURL(url); } catch (_e) {} }, 1500);
  } catch (e) { try { alert("No se pudo generar el Excel: " + (e.message || e)); } catch (_e) {} }
}
/* v15.85 — "🚢 En curso": los pedidos de importación YA HECHOS, separados del generador.
   Pedido del dueño (11/09): "quiero ver cuáles son los pedidos en curso por separado de si genera
   o no genera pedido… qué día llegan y qué día es la fecha de embarque".
   Una fila por PEDIDO (el PI), no por artículo: sale de gv_importados_pedidos_curso (baches
   en_curso agrupados por pedido_ref + proveedor). Las dos fechas se editan acá y se escriben en
   TODAS las líneas del pedido de una (RPC gv_importado_pedido_fechas); la de llegada además
   re-sincroniza Importados.reingreso_est (es la que ve el portal LK). */
async function openImpEnCurso() {
  _stkPopShell("🚢 Pedidos de importación en curso", "stkPopBody", true);
  const body = document.getElementById("stkPopBody"); if (!body) return;
  body.innerHTML = '<div class="stkpop-empty">Cargando pedidos en curso…</div>';
  _stkPop = { kind: "impCurso", rows: [], abierto: "", lineas: {}, provFiltro: "", refFiltro: "", cc: {}, vistaPlata: false,
    nac: { modo: _NAC_DEFAULTS.modo, valorM3: _NAC_DEFAULTS.valorM3, tn: 0 }, nacCrit: "mixto" };
  await _impCursoCargarNac();
  await impCursoReload();
}
/* v24.01 — las tasas y los parámetros por proveedor salen de la BASE (regla v23.89: no viven
   en el front). Si el fetch falla se queda con el fallback escrito en _NAC_TASAS y la cuenta da
   igual que siempre — lo que no puede es quedar en 0 y hacerle creer a nadie que no hay costo. */
async function _impCursoCargarNac() {
  try { await _impCfgCargar(); } catch (_e) {}
  try {
    const cfg = await supaFetchAllSafe(SUPABASE_URL + "/rest/v1/Stock_Config", "select=clave,valor&clave=in.(impo_nac_modo,impo_nac_valor_m3)");
    const m = {}; (cfg || []).forEach(function (r) { m[r.clave] = r.valor; });
    if (_stkPop && _stkPop.kind === "impCurso") {
      _stkPop.nac = { modo: (m.impo_nac_modo || _NAC_DEFAULTS.modo),
        valorM3: _nacNum(m.impo_nac_valor_m3, _NAC_TASAS.valor_m3 || _NAC_DEFAULTS.valorM3), tn: 0 };
    }
  } catch (_e) {}
}
async function impCursoReload() {
  if (!_stkPop || _stkPop.kind !== "impCurso") return;
  try { _stkPop.rows = (await _pedImpRpc("gv_importados_pedidos_curso", {})) || []; }
  catch (e) { _stkPop.rows = []; _stkPop.err = (e.message || String(e)); }
  // v15.74 — la cuenta corriente (plata) va en la misma lectura: si falla, la vista Plata se cae
  // al FOB del motor y 0 pagado, pero la logística sigue andando.
  try {
    const cc = (await _pedImpRpc("gv_imp_cc_lista", {})) || [];
    const m = {}; cc.forEach(function (x) { m[String(x.pedido_ref) + "\u00a7" + String(x.proveedor)] = x; });
    _stkPop.cc = m;
  } catch (_e) { if (!_stkPop.cc) _stkPop.cc = {}; }
  _impCursoRender();
}
function _impCursoKey(r) { return String(r.pedido_ref) + "§" + String(r.proveedor); }
/* encodeURIComponent NO escapa la comilla simple, y estos valores viajan dentro de un
   onclick="…('<valor>')": una comilla en el PI rompía el handler. */
function _impCursoEnc(s) { return encodeURIComponent(String(s == null ? "" : s)).replace(/'/g, "%27"); }
function _impCursoHoy() {
  try { return new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }); }
  catch (_e) { return new Date().toISOString().slice(0, 10); }
}
/* Días entre hoy (ART) y una fecha ISO. Negativo = ya pasó. */
function _impCursoDias(iso) {
  if (!iso) return null;
  const a = Date.parse(String(iso).slice(0, 10) + "T00:00:00Z"), b = Date.parse(_impCursoHoy() + "T00:00:00Z");
  if (isNaN(a) || isNaN(b)) return null;
  return Math.round((a - b) / 86400000);
}
function _impCursoNum(n) { return Number(n || 0).toLocaleString("es-AR"); }
/* Texto del estado del viaje: sin embarcar / embarcado / llegando / atrasado. */
function _impCursoEstado(r) {
  const dl = _impCursoDias(r.fecha_llegada), de = _impCursoDias(r.fecha_embarque);
  if (dl != null && dl < 0) return '<span class="imcu-tag atras">⚠ llegada vencida hace ' + Math.abs(dl) + ' d</span>';
  if (de == null) return '<span class="imcu-tag falta">⚠ falta la fecha de embarque</span>';
  if (de > 0) return '<span class="imcu-tag espera">embarca en ' + de + ' d</span>';
  return '<span class="imcu-tag viaje">🚢 embarcado hace ' + Math.abs(de) + ' d</span>';
}
function _impCursoFechaCell(r, campo) {
  const iso = (campo === "emb" ? r.fecha_embarque : r.fecha_llegada) || "";
  const dias = _impCursoDias(iso);
  const enc = _impCursoEnc(r.pedido_ref) + "','" + _impCursoEnc(r.proveedor);
  const fn = (campo === "emb" ? "impCursoSetEmbarque" : "impCursoSetLlegada") + "('" + enc + "',v)";
  const borde = iso ? (campo === "emb" ? "#0369a1" : "#b45309") : "#f59e0b";
  const fondo = iso ? (campo === "emb" ? "#f0f9ff" : "#fff7ed") : "#fffbeb";
  const tip = campo === "emb"
    ? "Día que embarca (sale de China). Se guarda en las " + r.n_lineas + " línea(s) del pedido."
    : "Día que llega. Se guarda en las " + r.n_lineas + " línea(s) y es el reingreso que ve la página LK.";
  return _pedImpFechaInputHtml(iso, fn, 'title="' + tip + '" style="width:86px;padding:5px 6px;border:1.5px solid ' + borde + ';border-radius:8px;font-size:13px;font-weight:700;background:' + fondo + '"') +
    (dias != null ? '<div class="imcu-sub">' + (dias >= 0 ? "faltan " + dias + " d" : "hace " + Math.abs(dias) + " d") + '</div>'
                  : '<div class="imcu-sub falta">sin cargar</div>');
}
/* v15.73 — filtros de la pantalla: fichas de PROVEEDOR y de PEDIDO (mismo criterio que la solapa
   📦 Pedidos, dueño 11/09: "poneme los mismos botones… para que pueda ver solo un pedido, cuánta
   plata es y todo"). Los totales de arriba (unidades, u$s, m³) se recalculan con lo filtrado, así
   parado en un pedido el cartel verde dice exactamente cuánta plata es ESE pedido. */
function impCursoSetProv(provEnc) {
  if (!_stkPop || _stkPop.kind !== "impCurso") return;
  _stkPop.provFiltro = decodeURIComponent(provEnc || "");
  _stkPop.refFiltro = "";               // cambiar de proveedor limpia el pedido elegido
  _impCursoRender();
}
function impCursoSetRef(refEnc) {
  if (!_stkPop || _stkPop.kind !== "impCurso") return;
  _stkPop.refFiltro = decodeURIComponent(refEnc || "");
  _impCursoRender();
  // parado en UN pedido, el detalle por artículo se abre solo (es lo que se va a mirar)
  if (_stkPop.refFiltro) {
    const r = (_stkPop.rows || []).find(function (x) { return x.pedido_ref === _stkPop.refFiltro; });
    if (r && _stkPop.abierto !== _impCursoKey(r)) impCursoToggle(_impCursoEnc(r.pedido_ref), _impCursoEnc(r.proveedor));
  }
}
/* Las filas que se están viendo según las dos fichas. */
function _impCursoVista() {
  const st = _stkPop || {};
  return (st.rows || []).filter(function (r) {
    if (st.provFiltro && r.proveedor !== st.provFiltro) return false;
    if (st.refFiltro && r.pedido_ref !== st.refFiltro) return false;
    return true;
  });
}
function _impCursoRender() {
  const body = document.getElementById("stkPopBody"); if (!body || !_stkPop || _stkPop.kind !== "impCurso") return;
  if (!document.getElementById("impCursoCss")) {
    const st = document.createElement("style"); st.id = "impCursoCss";
    st.textContent =
      ".imcu-tbl{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden}" +
      ".imcu-tbl th{font-size:10.5px;text-transform:uppercase;letter-spacing:.3px;color:#64748b;font-weight:800;padding:8px 7px;border-bottom:2px solid #e2e8f0;text-align:left;white-space:nowrap}" +
      ".imcu-tbl td{padding:8px 7px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#0f172a;vertical-align:middle}" +
      ".imcu-tbl td.num,.imcu-tbl th.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}" +
      ".imcu-tbl tr.imcu-open > td{background:#f8fafc}" +
      ".imcu-pi{font-weight:800;font-family:Consolas,Menlo,monospace;font-size:12.5px;cursor:pointer}" +
      ".imcu-provtd{cursor:pointer}.imcu-provtd:hover .imcu-prov{text-decoration:underline}" +
      ".imcu-prov{font-weight:800}.imcu-imp{font-size:10.5px;color:#94a3b8;font-weight:700}" +
      ".imcu-sub{font-size:10.5px;color:#64748b;margin-top:2px;font-weight:700}" +
      ".imcu-sub.falta{color:#b45309}" +
      ".imcu-tag{font-size:11px;font-weight:800;padding:3px 8px;border-radius:999px;white-space:nowrap;display:inline-block}" +
      ".imcu-tag.falta{background:#fffbeb;color:#b45309}.imcu-tag.espera{background:#eff6ff;color:#1d4ed8}" +
      ".imcu-tag.viaje{background:#f0fdf4;color:#166534}.imcu-tag.atras{background:#fef2f2;color:#b91c1c}" +
      ".imcu-det{background:#f8fafc!important;padding:0!important}" +
      ".imcu-det table{width:100%;border-collapse:collapse;margin:0}" +
      ".imcu-det th{font-size:10px;color:#94a3b8;padding:5px 7px;border-bottom:1px solid #e2e8f0}" +
      ".imcu-det td{font-size:12.5px;padding:4px 7px;border-bottom:1px solid #eef2f7}" +
      ".imcu-kpi{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px}" +
      ".imcu-kpi>div{flex:1;min-width:132px;border-radius:10px;padding:9px 13px}" +
      ".imcu-kpi .k{font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.4px}" +
      ".imcu-kpi .v{font-size:21px;font-weight:800}" +
      ".imcu-fila{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px}" +
      ".imcu-lbl{font-size:12px;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:.4px}" +
      ".imcu-b{border:0;border-radius:7px;padding:4px 9px;font-size:11.5px;font-weight:800;cursor:pointer;margin:0;width:auto;background:#e2e8f0;color:#0f172a}" +
      /* v15.74 — vista Plata (cuenta corriente): las mismas columnas del Excel de Thomas. */
      ".imcu-money{width:92px;text-align:right;padding:5px 6px;border:1.5px solid #cbd5e1;border-radius:8px;font-size:13px;font-weight:700;font-variant-numeric:tabular-nums;margin:0;box-sizing:border-box;background:#fff}" +
      ".imcu-money:focus{border-color:#0f766e;outline:none}" +
      ".imcu-money.pago{border-color:#a7f3d0;background:#f0fdf4}" +
      ".imcu-falta{font-weight:800;font-variant-numeric:tabular-nums}" +
      ".imcu-falta.cero{color:#16a34a}.imcu-falta.debe{color:#b45309}" +
      ".imcu-nom{width:104px;padding:5px 6px;border:1.5px solid #cbd5e1;border-radius:8px;font-size:12.5px;font-weight:700;margin:0;box-sizing:border-box;background:#fff}" +
      ".imcu-ntl{background:#eef2ff;border-color:#c7d2fe}" +
      "#impPagosOv{display:none;position:fixed;inset:0;z-index:1330;background:rgba(2,6,23,.78);overflow:auto;padding:14px}" +
      "#impPagosOv.show{display:block}" +
      ".ipg-card{background:#f8fafc;max-width:min(700px,96vw);margin:0 auto;border-radius:16px;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.55)}" +
      ".ipg-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 15px;background:linear-gradient(90deg,#065f46,#059669);color:#fff}" +
      ".ipg-head b{font-size:16px;font-weight:800}" +
      ".ipg-x{background:rgba(255,255,255,.22);color:#fff;border:none;border-radius:8px;padding:6px 12px;font-size:13px;font-weight:800;cursor:pointer;width:auto;margin:0}" +
      ".ipg-body{padding:12px 14px}" +
      ".ipg-tbl{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden}" +
      ".ipg-tbl th{font-size:10.5px;text-transform:uppercase;color:#64748b;font-weight:800;padding:7px 6px;border-bottom:2px solid #e2e8f0;text-align:left}" +
      ".ipg-tbl td{padding:6px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#0f172a}" +
      ".ipg-tbl td.num,.ipg-tbl th.num{text-align:right;font-variant-numeric:tabular-nums}" +
      ".ipg-tipo{font-size:10.5px;font-weight:800;padding:2px 7px;border-radius:999px;white-space:nowrap}" +
      ".ipg-tipo.a30{background:#eef2ff;color:#4338ca}.ipg-tipo.sal{background:#f0fdf4;color:#166534}.ipg-tipo.dir{background:#fff7ed;color:#b45309}" +
      ".ipg-foot{padding:11px 14px;background:#fff;border-top:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}" +
      ".ipg-empty{padding:16px;text-align:center;color:#64748b;font-size:13px}";
    document.head.appendChild(st);
  }
  const rows = _stkPop.rows || [];
  let h = _impTabsHtml('curso');
  h += '<div class="stkpop-hint">Lo que <b>ya está pedido y viene en camino</b>, un renglón por <b>pedido</b> (el PI del proveedor). Esta pantalla <b>no</b> mira lo que el módulo sugiere pedir: sólo los baches <code>en curso</code>. Tocá una fecha para corregirla — se guarda en <b>todas las líneas del pedido</b> de una, y la de <b>llegada</b> es la que la página LK muestra como "Reingreso Est". Tocá el <b>PI</b> para abrir el detalle por artículo. Las <b>fichas</b> de arriba filtran por <b>proveedor</b> o por <b>pedido</b>: parado en uno, los totales (unidades, <b>u$s</b>, m³) son los de ESE pedido.</div>';
  if (_stkPop.err) h += '<div class="stkpop-empty" style="color:#b91c1c">No se pudo leer: ' + escapeHtml(_stkPop.err) + '</div>';
  if (!rows.length) { body.innerHTML = h + '<div class="stkpop-empty">No hay pedidos de importación en curso.</div>'; return; }

  // ---- fichas de filtro (mismo botón redondeado que la solapa 📦 Pedidos) ----
  const _fb = function (on) { return 'width:auto;margin:0;flex:0 0 auto;padding:7px 13px;border-radius:999px;border:1px solid ' + (on ? '#0f766e' : '#cbd5e1') + ';background:' + (on ? '#0f766e' : '#fff') + ';color:' + (on ? '#fff' : '#334155') + ';font-size:13px;font-weight:800;cursor:pointer'; };
  const provs = [];
  rows.forEach(function (r) { if (provs.indexOf(r.proveedor) < 0) provs.push(r.proveedor); });
  provs.sort(function (a, b) { const ia = _IMPORTADOR_DE[a] || "zz", ib = _IMPORTADOR_DE[b] || "zz"; return String(ia).localeCompare(String(ib)) || String(a).localeCompare(String(b)); });
  const provFiltro = (_stkPop.provFiltro && provs.indexOf(_stkPop.provFiltro) >= 0) ? _stkPop.provFiltro : "";
  _stkPop.provFiltro = provFiltro;
  if (provs.length > 1) {
    h += '<div class="imcu-fila"><span class="imcu-lbl">🏭 Proveedor:</span>' +
      '<button style="' + _fb(!provFiltro) + '" onclick="impCursoSetProv(\'\')">Todos</button>' +
      provs.map(function (p) {
        const n = rows.filter(function (r) { return r.proveedor === p; }).length;
        return '<button style="' + _fb(provFiltro === p) + '" onclick="impCursoSetProv(\'' + _impCursoEnc(p) + '\')">' + escapeHtml(p) + (n > 1 ? ' <span style="opacity:.7">(' + n + ')</span>' : '') + '</button>';
      }).join('') + '</div>';
  }
  // fichas de PEDIDO: las del proveedor elegido (o todas si está en "Todos")
  const refsBase = rows.filter(function (r) { return !provFiltro || r.proveedor === provFiltro; });
  const refFiltro = (_stkPop.refFiltro && refsBase.some(function (r) { return r.pedido_ref === _stkPop.refFiltro; })) ? _stkPop.refFiltro : "";
  _stkPop.refFiltro = refFiltro;
  if (refsBase.length > 1) {
    h += '<div class="imcu-fila"><span class="imcu-lbl">📄 Pedido:</span>' +
      '<button style="' + _fb(!refFiltro) + '" onclick="impCursoSetRef(\'\')">Todos</button>' +
      refsBase.map(function (r) {
        return '<button style="' + _fb(refFiltro === r.pedido_ref) + '" onclick="impCursoSetRef(\'' + _impCursoEnc(r.pedido_ref) + '\')" title="' + escapeHtml(r.proveedor) + ' · ' + _impCursoNum(r.pendiente) + ' u · u$s ' + _impCursoNum(Math.round(Number(r.usd) || 0)) + '">' + escapeHtml(r.pedido_ref) + '</button>';
      }).join('') + '</div>';
  }
  // v15.74 — dos vistas del mismo listado: la logística (unidades, m³, fechas) y la de PLATA
  // (la cuenta corriente: las mismas columnas del Excel con el que Thomas lleva la deuda).
  const plata = !!_stkPop.vistaPlata;
  h += '<div class="imcu-fila"><span class="imcu-lbl">Ver:</span>' +
    '<button style="' + _fb(!plata) + '" onclick="impCursoSetVista(false)">📦 Logística</button>' +
    '<button style="' + _fb(plata) + '" onclick="impCursoSetVista(true)" title="Cuenta corriente: FOB, pagado, pendiente de giro directo y lo que falta">💵 Plata</button>' +
    '</div>';
  h += '<div class="imcu-fila">' +
    '<button class="mva-clear" style="background:#166534;color:#fff;border-color:#166534" onclick="impCursoExportExcel()" title="Bajar a Excel lo que se está viendo, con el detalle por artículo de cada pedido">📥 Excel</button>' +
    ((provFiltro || refFiltro) ? '<button class="mva-clear" onclick="impCursoSetProv(\'\')" title="Sacar los filtros">✕ Ver todo</button>' : '') +
    '</div>';

  // ---- totales de LO QUE SE ESTÁ VIENDO ----
  const vista = _impCursoVista();
  const tUni = vista.reduce(function (s, r) { return s + (Number(r.pendiente) || 0); }, 0);
  const tUsd = vista.reduce(function (s, r) { return s + (Number(r.usd) || 0); }, 0);
  const tM3 = vista.reduce(function (s, r) { return s + (Number(r.m3) || 0); }, 0);
  const sinEmb = vista.filter(function (r) { return !r.fecha_embarque; }).length;
  const foco = refFiltro ? ('📄 ' + refFiltro) : (provFiltro ? ('🏭 ' + provFiltro) : "");
  const kTit = refFiltro ? "Este pedido" : (provFiltro ? "Pedidos de " + provFiltro : "Pedidos en curso");
  if (plata) {
    // los mismos cuatro números del Excel, sobre lo filtrado
    let tFob = 0, tPag = 0, tGiro = 0, tFalta = 0;
    vista.forEach(function (r) {
      const c = _impCursoCc(r);
      tFob += Number(c.fob) || 0; tPag += Number(c.pagado) || 0;
      tGiro += Number(c.pend_giro_directo) || 0; tFalta += Number(c.falta) || 0;
    });
    h += '<div class="imcu-kpi">' +
      '<div style="background:#f8fafc;border:1px solid #e2e8f0"><div class="k" style="color:#475569">FOB ' + escapeHtml(refFiltro ? "del pedido" : "total") + '</div><div class="v" style="color:#0f172a">u$s ' + _impCursoNum(Math.round(tFob)) + '</div>' + (foco ? '<div style="font-size:10.5px;color:#64748b;font-weight:700">' + escapeHtml(foco) + '</div>' : '') + '</div>' +
      '<div style="background:#ecfdf5;border:1px solid #a7f3d0"><div class="k" style="color:#047857">Pagado</div><div class="v" style="color:#065f46">u$s ' + _impCursoNum(Math.round(tPag)) + '</div></div>' +
      '<div style="background:#fff7ed;border:1px solid #fed7aa"><div class="k" style="color:#b45309">Pend. giro directo</div><div class="v" style="color:#92400e">u$s ' + _impCursoNum(Math.round(tGiro)) + '</div></div>' +
      '<div style="background:#fef2f2;border:1px solid #fecaca"><div class="k" style="color:#b91c1c">Falta</div><div class="v" style="color:#991b1b">u$s ' + _impCursoNum(Math.round(tFalta)) + '</div></div>' +
      '</div>';
    h += '<div class="stkpop-hint">Cuenta corriente con los chinos, igual que el Excel: <b>Falta = FOB − Pagado − Pend. giro directo</b>. <b>A nombre de</b> es quién factura y cobra (<b>NTL</b>, el forwarder de Hong Kong, o el proveedor); sólo las que van a nombre del proveedor tienen giro directo. <b>💵</b> abre los giros de ese pedido para cargar uno nuevo. La plata que sale viaja pegada a una importación ya nacionalizada aunque financie el pedido siguiente — está explicado en <code>docs/IMPORTACIONES-PAGOS-ARGENTINA.md</code>.</div>';
    h += _impCursoTablaPlata(vista);
    body.innerHTML = h;
    return;
  }
  h += '<div class="imcu-kpi">' +
    '<div style="background:#eef2ff;border:1px solid #c7d2fe"><div class="k" style="color:#4338ca">' + escapeHtml(kTit) + '</div><div class="v" style="color:#3730a3">' + vista.length + '</div>' + (foco ? '<div style="font-size:10.5px;color:#6366f1;font-weight:700">' + escapeHtml(foco) + '</div>' : '') + '</div>' +
    '<div style="background:#fff7ed;border:1px solid #fed7aa"><div class="k" style="color:#b45309">Unidades por llegar</div><div class="v" style="color:#92400e">' + _impCursoNum(tUni) + '</div></div>' +
    '<div style="background:#ecfdf5;border:1px solid #a7f3d0"><div class="k" style="color:#047857">' + (refFiltro ? "Plata de este pedido (FOB)" : "FOB en camino") + '</div><div class="v" style="color:#065f46">u$s ' + _impCursoNum(Math.round(tUsd)) + '</div></div>' +
    '<div style="background:#eff6ff;border:1px solid #bfdbfe"><div class="k" style="color:#1d4ed8">Volumen</div><div class="v" style="color:#1e3a8a">' + (Math.round(tM3 * 10) / 10).toLocaleString("es-AR") + ' m³</div></div>' +
    '</div>';
  if (sinEmb) h += '<div style="margin-bottom:10px;padding:9px 13px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;font-size:12.5px;color:#92400e"><b>⚠ ' + sinEmb + ' pedido(s) sin fecha de embarque.</b> Cargala en la columna 🚢 (dd/mm/aa) y queda guardada en todas sus líneas.</div>';
  if (!vista.length) { body.innerHTML = h + '<div class="stkpop-empty">Nada con ese filtro.</div>'; return; }
  h += '<div class="mva-tblwrap wide"><table class="imcu-tbl">' +
    '<thead><tr><th>Proveedor</th><th>Pedido (PI)</th><th class="num">Líneas</th><th class="num">Unidades</th><th class="num">u$s</th><th class="num">m³</th><th>🚢 Embarque</th><th>🛬 Llegada</th><th>Estado</th></tr></thead><tbody>';
  vista.forEach(function (r) {
    const key = _impCursoKey(r);
    const abierto = _stkPop.abierto === key;
    const refEnc = _impCursoEnc(r.pedido_ref), provEnc = _impCursoEnc(r.proveedor);
    const imp = _IMPORTADOR_DE[r.proveedor] || "";
    h += '<tr' + (abierto ? ' class="imcu-open"' : '') + '>' +
      // v24.32 (Luis): "apretás sobre el proveedor y debería expandirse las unidades". Abre el
      // MISMO detalle que el PI (impCursoToggle), con el costo de nacionalización por artículo.
      '<td class="imcu-provtd" onclick="impCursoToggle(\'' + refEnc + '\',\'' + provEnc + '\')" title="Ver los artículos de este pedido con el costo de nacionalización de cada uno"><span class="imcu-prov">' + (abierto ? '▾ ' : '▸ ') + escapeHtml(r.proveedor) + '</span>' + (imp ? '<div class="imcu-imp">' + escapeHtml(imp) + '</div>' : '') + '</td>' +
      '<td><span class="imcu-pi" onclick="impCursoToggle(\'' + refEnc + '\',\'' + provEnc + '\')" title="Ver los artículos de este pedido">' + (abierto ? '▾ ' : '▸ ') + escapeHtml(r.pedido_ref) + '</span>' +
        '<div class="imcu-sub"><span class="imcu-b" onclick="impCursoSetRef(\'' + refEnc + '\')" title="Ver SÓLO este pedido (y cuánta plata es)">🔎 solo éste</span> <span class="imcu-b" onclick="impPiEditar(\'' + refEnc + '\',\'' + provEnc + '\')" title="Corregir las cantidades de cada ítem y el número de PI. Pregunta quién corrige y queda registrado el día y la hora.">✏️ Editar PI</span></div></td>' +
      '<td class="num">' + r.n_lineas + '</td>' +
      '<td class="num"><b>' + _impCursoNum(r.pendiente) + '</b></td>' +
      '<td class="num" style="color:#065f46;font-weight:700">' + (Number(r.usd) > 0 ? _impCursoNum(Math.round(r.usd)) : '—') + '</td>' +
      '<td class="num" style="color:#0369a1;font-weight:700">' + (Number(r.m3) > 0 ? (Math.round(r.m3 * 10) / 10).toLocaleString("es-AR") : '—') + '</td>' +
      '<td>' + _impCursoFechaCell(r, "emb") + '</td>' +
      '<td>' + _impCursoFechaCell(r, "lleg") + '</td>' +
      '<td>' + _impCursoEstado(r) + '</td></tr>';
    if (abierto) {
      const ls = _stkPop.lineas[key];
      h += '<tr><td class="imcu-det" colspan="9">' + (ls ? _impCursoLineasHtml(ls, r) : '<div style="padding:10px 14px;color:#64748b;font-size:12.5px">Cargando artículos…</div>') + '</td></tr>';
    }
  });
  h += '</tbody></table></div>';
  body.innerHTML = h;
}
/* Excel de lo que se está viendo: una hoja con los pedidos y, debajo, el detalle por artículo de
   cada uno (se piden las líneas que falten). Sin librería: .xls = tabla HTML, igual que el resto. */
async function impCursoExportExcel() {
  if (!_stkPop || _stkPop.kind !== "impCurso") return;
  const vista = _impCursoVista();
  if (!vista.length) { try { alert("No hay pedidos para exportar."); } catch (_e) {} return; }
  for (let i = 0; i < vista.length; i++) {
    const r = vista[i], key = _impCursoKey(r);
    if (!_stkPop.lineas[key]) {
      try { _stkPop.lineas[key] = (await _pedImpRpc("gv_importado_pedido_lineas", { p_pedido_ref: r.pedido_ref, p_proveedor: r.proveedor })) || []; }
      catch (_e) { _stkPop.lineas[key] = []; }
    }
  }
  const esc = function (s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); };
  const fecha = _impCursoHoy();
  const dm = function (iso) { return iso ? _isoToDdMmAa(String(iso).slice(0, 10)) : ""; };
  let html = '<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"><style>td,th{border:1px solid #ccc;padding:3px 7px;font-family:Calibri,Arial,sans-serif;} th{background:#0f766e;color:#fff;text-align:left;}</style></head><body>';
  html += '<h3>Pedidos de importación EN CURSO — ' + esc(fecha) + (_stkPop.provFiltro ? ' — ' + esc(_stkPop.provFiltro) : '') + (_stkPop.refFiltro ? ' — ' + esc(_stkPop.refFiltro) : '') + '</h3>';
  html += '<table><tr><th>Importador</th><th>Proveedor</th><th>Pedido (PI)</th><th>Lineas</th><th>Unidades</th><th>u$s FOB</th><th>m3</th><th>Embarque</th><th>Llegada</th></tr>';
  let tU = 0, tD = 0, tM = 0;
  vista.forEach(function (r) {
    tU += Number(r.pendiente) || 0; tD += Number(r.usd) || 0; tM += Number(r.m3) || 0;
    html += '<tr><td>' + esc(_IMPORTADOR_DE[r.proveedor] || "") + '</td><td>' + esc(r.proveedor) + '</td><td>' + esc(r.pedido_ref) + '</td><td>' + r.n_lineas +
      '</td><td>' + (Number(r.pendiente) || 0) + '</td><td>' + Math.round(Number(r.usd) || 0) + '</td><td>' + (Math.round((Number(r.m3) || 0) * 100) / 100) +
      '</td><td>' + esc(dm(r.fecha_embarque)) + '</td><td>' + esc(dm(r.fecha_llegada)) + '</td></tr>';
  });
  html += '<tr><td colspan="4"><b>TOTAL</b></td><td><b>' + tU + '</b></td><td><b>' + Math.round(tD) + '</b></td><td><b>' + (Math.round(tM * 100) / 100) + '</b></td><td></td><td></td></tr></table>';
  // v24.01 — el detalle lleva la nacionalización repartida con el MISMO criterio que la pantalla
  html += '<h3>Detalle por artículo — nacionalización repartida ' + esc(_impNacCritTxt((_stkPop.nacCrit || "mixto")).lbl) + '</h3>' +
    '<table><tr><th>Pedido (PI)</th><th>Proveedor</th><th>Codigo</th><th>Marca</th><th>Descripcion</th><th>Unidades</th><th>FOB u$s/u</th><th>u$s</th><th>m3</th><th>Nac u$s</th><th>Nac u$s/u</th><th>Puesto u$s/u</th><th>Llegada</th></tr>';
  vista.forEach(function (r) {
    const _ls = _stkPop.lineas[_impCursoKey(r)] || [];
    const _N = _ls.length ? _impCursoNac(r, _ls) : null;
    _ls.forEach(function (l, i) {
      const _uni = Number(l.pendiente) || 0;
      const _nacU = _N ? (Number(_N.rep.items[i]) || 0) : 0;
      const _nacUni = _uni > 0 ? _nacU / _uni : 0;
      const _fobU = _uni > 0 ? ((Number(l.usd) || 0) / _uni) : (Number(l.fob_uni) || 0);
      html += '<tr><td>' + esc(r.pedido_ref) + '</td><td>' + esc(r.proveedor) + '</td><td>' + esc(codCanon(l.cod_art)) + '</td><td>' + esc(l.marca || "") +
        '</td><td>' + esc(l.descripcion || "") + '</td><td>' + _uni + '</td><td>' + (Number(l.fob_uni) || "") + '</td><td>' + Math.round(Number(l.usd) || 0) +
        '</td><td>' + (l.m3 == null ? "" : l.m3) + '</td><td>' + (Math.round(_nacU * 100) / 100) + '</td><td>' + (Math.round(_nacUni * 10000) / 10000) +
        '</td><td>' + (Math.round((_fobU + _nacUni) * 10000) / 10000) + '</td><td>' + esc(dm(l.fecha_reingreso)) + '</td></tr>';
    });
  });
  html += '</table></body></html>';
  try {
    const blob = new Blob(["﻿" + html], { type: "application/vnd.ms-excel" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = "Importacion_En_Curso_" + fecha + ".xls";
    document.body.appendChild(a); a.click();
    setTimeout(function () { try { document.body.removeChild(a); URL.revokeObjectURL(url); } catch (_e) {} }, 1500);
  } catch (e) { try { alert("No se pudo generar el Excel: " + (e.message || e)); } catch (_e) {} }
}
/* v15.74 — VISTA PLATA: la cuenta corriente con los chinos, calcada del Excel con el que Thomas
   la lleva ("estado actual de deudas al exterior"): A nombre de · FOB · Pago · Pend Giro Directo ·
   Falta · Embarque · Fecha Pago 30% · Fecha Recup.
     · Falta  = FOB − Pagado − Pend. giro directo   (la fórmula de su planilla)
     · Pagado = la SUMA de los giros cargados (GV_Imp_Pagos), no un número tipeado
     · "A nombre de" = quién factura y cobra: NTL (forwarder de Hong Kong) o el proveedor
   Por qué la plata sale pegada a una importación ya nacionalizada aunque financie el pedido
   siguiente: docs/IMPORTACIONES-PAGOS-ARGENTINA.md. Backend: sql/gv_imp_cuenta_corriente_v1574.sql */
function impCursoSetVista(plata) {
  if (!_stkPop || _stkPop.kind !== "impCurso") return;
  _stkPop.vistaPlata = !!plata; _impCursoRender();
}
/* La fila de cuenta corriente del pedido. Si todavía no se leyó, se cae a lo que sabe el motor
   (FOB calculado, nada pagado) para que la tabla igual muestre algo coherente. */
function _impCursoCc(r) {
  const m = (_stkPop && _stkPop.cc) || {};
  const c = m[_impCursoKey(r)];
  if (c) return c;
  const fob = Number(r.usd) || 0;
  return { fob: fob, pagado: 0, pend_giro_directo: 0, falta: fob, saldo: fob, n_pagos: 0,
           a_nombre_de: "", fecha_pago_30: null, fecha_recup: null, fob_difiere: false, fob_calculado: fob };
}
function _impCursoMoneyInput(r, campo, val, extra) {
  const enc = _impCursoEnc(r.pedido_ref) + "','" + _impCursoEnc(r.proveedor);
  return '<input type="number" step="1" min="0" class="imcu-money' + (extra || "") + '" value="' + (Number(val) ? Math.round(Number(val)) : "") +
    '" placeholder="0" onchange="impCursoCcSet(\'' + enc + '\',\'' + campo + '\',this.value)">';
}
function _impCursoTablaPlata(vista) {
  let h = '<div class="mva-tblwrap wide"><table class="imcu-tbl">' +
    '<thead><tr><th>Proveedor</th><th>Pedido (PI)</th><th title="Quién emite la factura y cobra: NTL o el proveedor">A nombre de</th>' +
    '<th class="num">FOB</th><th class="num" title="Suma de los giros cargados. Tocá 💵 para verlos o agregar uno.">Pagado</th>' +
    '<th class="num" title="Del saldo, lo que va girado derecho al proveedor (no por NTL)">Pend. giro directo</th>' +
    '<th class="num" title="FOB − Pagado − Pend. giro directo">Falta</th>' +
    '<th title="El anticipo/depósito. De acá sale la fecha de embarque (depósito + lead time del PI)">💰 Pago 30%</th>' +
    '<th>🚢 Embarque</th><th title="Cuándo se recupera (las filas a nombre de NTL)">♻️ Recupero</th><th></th></tr></thead><tbody>';
  vista.forEach(function (r) {
    const c = _impCursoCc(r);
    const refEnc = _impCursoEnc(r.pedido_ref), provEnc = _impCursoEnc(r.proveedor);
    const enc = refEnc + "','" + provEnc;
    const imp = _IMPORTADOR_DE[r.proveedor] || "";
    const nom = String(c.a_nombre_de || "");
    const falta = Number(c.falta) || 0;
    const pagado = Number(c.pagado) || 0;
    const fob = Number(c.fob) || 0;
    const pct = fob > 0 ? Math.round((pagado / fob) * 100) : 0;
    h += '<tr>' +
      '<td><span class="imcu-prov">' + escapeHtml(r.proveedor) + '</span>' + (imp ? '<div class="imcu-imp">' + escapeHtml(imp) + '</div>' : '') + '</td>' +
      '<td><span class="imcu-pi" onclick="impCursoSetRef(\'' + refEnc + '\')" title="Ver sólo este pedido">' + escapeHtml(r.pedido_ref) + '</span></td>' +
      '<td><input type="text" class="imcu-nom' + (nom.toUpperCase() === "NTL" ? " imcu-ntl" : "") + '" value="' + escapeHtml(nom) + '" placeholder="NTL / ' + escapeHtml(r.proveedor) + '" title="Quién emite la factura y cobra" onchange="impCursoCcSet(\'' + enc + '\',\'nombre\',this.value)"></td>' +
      '<td class="num">' + _impCursoMoneyInput(r, "fob", c.fob) +
        (c.fob_difiere ? '<div class="imcu-sub falta" title="El FOB del PI no coincide con el que sale de FOB unitario × unidades del módulo">⚠ motor: ' + _impCursoNum(Math.round(c.fob_calculado)) + '</div>' : '') + '</td>' +
      '<td class="num"><b style="color:#065f46">' + _impCursoNum(Math.round(pagado)) + '</b>' +
        '<div class="imcu-sub">' + (c.n_pagos ? (c.n_pagos + ' giro' + (c.n_pagos > 1 ? 's' : '') + ' · ' + pct + '%') : 'sin giros') + '</div></td>' +
      '<td class="num">' + _impCursoMoneyInput(r, "pendgiro", c.pend_giro_directo) + '</td>' +
      '<td class="num"><span class="imcu-falta ' + (Math.abs(falta) < 1 ? "cero" : "debe") + '">' + _impCursoNum(Math.round(falta)) + '</span></td>' +
      '<td>' + _pedImpFechaInputHtml(c.fecha_pago_30 || "", "impCursoCcSet('" + enc + "','pago30',v)", 'title="Fecha del anticipo/depósito" style="width:82px;padding:5px 6px;border:1.5px solid #cbd5e1;border-radius:8px;font-size:12.5px;background:#fff"') +
        (c.dias_produccion != null ? '<div class="imcu-sub">+' + c.dias_produccion + ' d al embarque</div>' : '') + '</td>' +
      '<td>' + _impCursoFechaCell(r, "emb") + '</td>' +
      '<td>' + _pedImpFechaInputHtml(c.fecha_recup || "", "impCursoCcSet('" + enc + "','recup',v)", 'title="Fecha de recupero" style="width:82px;padding:5px 6px;border:1.5px solid #cbd5e1;border-radius:8px;font-size:12.5px;background:#fff"') + '</td>' +
      '<td><button class="imcu-b" style="background:#065f46;color:#fff" onclick="impCursoPagos(\'' + enc + '\')" title="Ver y cargar los giros de este pedido">💵 Giros</button></td>' +
      '</tr>';
  });
  return h + '</tbody></table></div>';
}
/* Un solo setter para toda la cabecera: cada campo manda su p_set_* para distinguir
   "no tocar" de "poner en null/0" (la RPC gv_imp_cc_set). */
async function impCursoCcSet(refEnc, provEnc, campo, valor) {
  if (!_stkPop || _stkPop.kind !== "impCurso") return;
  const ref = decodeURIComponent(refEnc), prov = decodeURIComponent(provEnc);
  const body = { p_pedido_ref: ref, p_proveedor: prov };
  const num = function (v) { const n = Number(String(v == null ? "" : v).replace(/[^\d.\-]/g, "")); return isFinite(n) ? n : 0; };
  if (campo === "nombre") { body.p_a_nombre_de = String(valor || "").trim() || null; body.p_set_a_nombre_de = true; }
  else if (campo === "fob") { const n = num(valor); body.p_fob = n > 0 ? n : null; body.p_set_fob = true; }
  else if (campo === "pendgiro") { body.p_pend_giro = num(valor); body.p_set_pend_giro = true; }
  else if (campo === "pago30") { body.p_pago_30 = String(valor || "").slice(0, 10) || null; body.p_set_pago_30 = true; }
  else if (campo === "recup") { body.p_recup = String(valor || "").slice(0, 10) || null; body.p_set_recup = true; }
  else return;
  try { await _pedImpRpc("gv_imp_cc_set", body); }
  catch (e) { try { alert("No se pudo guardar: " + (e.message || e)); } catch (_e) {} }
  await impCursoReload();
}
/* ---- Giros de UN pedido (el libro de la cuenta corriente) ---- */
var _impPagos = null;
function _impPagosTipoTxt(t) {
  if (t === "anticipo30") return '<span class="ipg-tipo a30">anticipo 30%</span>';
  if (t === "giro_directo") return '<span class="ipg-tipo dir">giro directo</span>';
  return '<span class="ipg-tipo sal">saldo</span>';
}
async function impCursoPagos(refEnc, provEnc) {
  const ref = decodeURIComponent(refEnc), prov = decodeURIComponent(provEnc);
  const r = ((_stkPop && _stkPop.rows) || []).find(function (x) { return x.pedido_ref === ref && x.proveedor === prov; });
  _impPagos = { ref: ref, prov: prov, rows: [], cc: r ? _impCursoCc(r) : null };
  let ov = document.getElementById("impPagosOv");
  if (!ov) { ov = document.createElement("div"); ov.id = "impPagosOv"; document.body.appendChild(ov); }
  ov.classList.add("show");
  await _impPagosReload();
}
function impPagosCerrar() {
  const ov = document.getElementById("impPagosOv"); if (ov) ov.classList.remove("show");
  const d = _impPagos && _impPagos.dirty; _impPagos = null;
  if (d) { try { impCursoReload(); } catch (_e) {} }
}
async function _impPagosReload() {
  if (!_impPagos) return;
  try { _impPagos.rows = (await _pedImpRpc("gv_imp_pagos", { p_pedido_ref: _impPagos.ref, p_proveedor: _impPagos.prov })) || []; }
  catch (e) { _impPagos.rows = []; try { alert("No se pudieron leer los giros: " + (e.message || e)); } catch (_e) {} }
  _impPagosRender();
}
function _impPagosRender() {
  const ov = document.getElementById("impPagosOv"); if (!ov || !_impPagos) return;
  const rows = _impPagos.rows || [];
  const tot = rows.reduce(function (a, x) { return a + (Number(x.monto_usd) || 0); }, 0);
  const cc = _impPagos.cc || {};
  const fob = Number(cc.fob) || 0;
  const falta = fob - tot - (Number(cc.pend_giro_directo) || 0);
  const body = rows.map(function (x) {
    return "<tr>" +
      "<td>" + (x.fecha ? _isoToDdMmAa(String(x.fecha).slice(0, 10)) : "—") + "</td>" +
      '<td class="num"><b>' + _impCursoNum(Math.round(Number(x.monto_usd) || 0)) + "</b></td>" +
      "<td>" + escapeHtml(x.beneficiario || "—") + "</td>" +
      "<td>" + _impPagosTipoTxt(x.tipo) + "</td>" +
      "<td>" + _impPagoCargasCell(x) + "</td>" +
      '<td style="font-size:11.5px;color:#64748b">' + escapeHtml(x.factura_ref || "") + (x.nota ? '<div style="font-size:10.5px;color:#94a3b8">' + escapeHtml(x.nota) + '</div>' : '') + "</td>" +
      '<td><button class="imcu-b" style="background:#fee2e2;color:#b91c1c" onclick="impPagoBorrar(' + x.id + ')" title="Borrar este giro">🗑</button></td></tr>';
  }).join("");
  ov.innerHTML =
    '<div class="ipg-card"><div class="ipg-head"><b>💵 Giros — ' + escapeHtml(_impPagos.ref) + ' · ' + escapeHtml(_impPagos.prov) + '</b>' +
      '<button class="ipg-x" onclick="impPagosCerrar()">Cerrar</button></div>' +
    '<div class="ipg-body">' +
      (rows.length
        ? '<table class="ipg-tbl"><thead><tr><th>Fecha</th><th class="num">u$s</th><th>A quién</th><th>Tipo</th><th title="Con qué carga se cursó el giro → qué carga queda cubierta. Es la imputación cruzada.">Cargas (a través de → fue a)</th><th>Factura / nota</th><th></th></tr></thead><tbody>' + body + "</tbody></table>"
        : '<div class="ipg-empty">Todavía no hay giros cargados para este pedido.</div>') +
    "</div>" +
    '<div class="ipg-foot"><div style="font-size:13px;color:#334155">FOB <b>u$s ' + _impCursoNum(Math.round(fob)) + '</b> · girado <b style="color:#065f46">u$s ' + _impCursoNum(Math.round(tot)) +
      '</b> · falta <b style="color:' + (Math.abs(falta) < 1 ? "#16a34a" : "#b45309") + '">u$s ' + _impCursoNum(Math.round(falta)) + '</b></div>' +
      '<button class="imcu-b" style="background:#065f46;color:#fff;padding:8px 14px" onclick="impPagoAdd()">➕ Cargar giro</button></div></div>';
}
async function impPagoAdd() {
  if (!_impPagos) return;
  let mv; try { mv = prompt("Monto del giro en u$s:", ""); } catch (_e) { return; }
  if (mv === null) return;
  const monto = Number(String(mv).replace(/[^\d.]/g, ""));
  if (!(monto > 0)) { try { alert("Monto inválido."); } catch (_e) {} return; }
  let fv; try { fv = prompt("Fecha del giro (dd/mm/aa).\nVacío = hoy:", ""); } catch (_e) { return; }
  if (fv === null) return;
  let iso = null;
  if (String(fv).trim() !== "") { iso = _pedImpParseFechaISO(fv); if (iso === null) { try { alert("Fecha inválida (usá dd/mm/aa)."); } catch (_e) {} return; } }
  const nomDef = (_impPagos.cc && _impPagos.cc.a_nombre_de) || "NTL";
  let bv; try { bv = prompt("¿A quién se le giró? (NTL o el proveedor):", nomDef); } catch (_e) { return; }
  if (bv === null) return;
  let tv; try { tv = prompt("Tipo de giro:\n  1 = anticipo 30%\n  2 = saldo\n  3 = giro directo", "2"); } catch (_e) { return; }
  if (tv === null) return;
  const tipo = String(tv).trim() === "1" ? "anticipo30" : (String(tv).trim() === "3" ? "giro_directo" : "saldo");
  let facv; try { facv = prompt("Factura / despacho contra el que se cursó (opcional — es la pata legal del giro):", ""); } catch (_e) { facv = ""; }
  let leg = ""; try { leg = String(window.__authEmail || ""); } catch (_e) {}
  try {
    await _pedImpRpc("gv_imp_pago_add", { p_pedido_ref: _impPagos.ref, p_proveedor: _impPagos.prov,
      p_fecha: iso, p_monto: monto, p_beneficiario: String(bv || "").trim() || null, p_tipo: tipo,
      p_factura: String(facv || "").trim() || null, p_legajo: leg });
    _impPagos.dirty = true;
  } catch (e) { try { alert("No se pudo cargar el giro: " + (e.message || e)); } catch (_e) {} return; }
  await _impPagosReload();
}
async function impPagoBorrar(pagoId) {
  if (!_impPagos) return;
  let ok = false; try { ok = confirm("¿Borrar este giro? El 'Pagado' del pedido baja."); } catch (_e) { ok = false; }
  if (!ok) return;
  try { await _pedImpRpc("gv_imp_pago_borrar", { p_pago_id: pagoId }); _impPagos.dirty = true; }
  catch (e) { try { alert("No se pudo borrar: " + (e.message || e)); } catch (_e) {} return; }
  await _impPagosReload();
}
/* v15.90 — Solapa 💱 NTL: la cuenta corriente del forwarder de Hong Kong, que hasta ahora vivía
   sólo en el Excel de Thomas. El circuito (efectivo → advance/balance a la fábrica → recupero
   cuando se nacionaliza, con el 3% de subida y el 5% de NTL sobre la FC) está en
   docs/IMPORTACIONES-PAGOS-ARGENTINA.md §4. Backend: gv_imp_ntl_resumen / _mov / _pendientes
   sobre GV_Imp_NTL_Mov (importación fiel del Excel, saldo verificado fila por fila). */
var _impNtl = null;
async function openImpNtl() {
  _stkPopShell("💱 Cuenta corriente NTL (Hong Kong)", "stkPopBody", true);
  const body = document.getElementById("stkPopBody"); if (!body) return;
  body.innerHTML = '<div class="stkpop-empty">Cargando la cuenta de NTL…</div>';
  _stkPop = { kind: "impNtl" };
  _impNtl = { resumen: [], movs: [], pend: [], cargas: [], conc: [], alias: [], empresa: "", prov: "", n: 60, vista: "extracto" };
  await impNtlReload();
}
async function impNtlReload() {
  if (!_impNtl) return;
  try {
    _impNtl.resumen = (await _pedImpRpc("gv_imp_ntl_resumen", {})) || [];
    _impNtl.pend    = (await _pedImpRpc("gv_imp_ntl_pendientes", {})) || [];
    _impNtl.movs    = (await _pedImpRpc("gv_imp_ntl_mov", { p_limit: _impNtl.n,
                        p_empresa: _impNtl.empresa || null, p_proveedor: _impNtl.prov || null })) || [];
    _impNtl.cargas  = (await _pedImpRpc("gv_imp_cargas", {})) || [];
    _impNtl.conc    = (await _pedImpRpc("gv_imp_conciliacion", {})) || [];
    _impNtl.alias   = (await _pedImpRpc("gv_imp_prov_alias", {})) || [];
  } catch (e) { _impNtl.err = (e.message || String(e)); }
  _impNtlRender();
}
/* devuelven la promesa del reload: el extracto se vuelve a pedir al backend con el filtro puesto */
function impNtlSetEmpresa(v) { if (!_impNtl) return; _impNtl.empresa = v || ""; return impNtlReload(); }
function impNtlSetProv(enc) { if (!_impNtl) return; _impNtl.prov = decodeURIComponent(enc || ""); return impNtlReload(); }
function impNtlMas() { if (!_impNtl) return; _impNtl.n = Math.min(500, (_impNtl.n || 60) + 100); return impNtlReload(); }
/* Nombre legible de cada empresa del extracto. D = el efectivo depositado que todavía no se
   repartió entre los dos importadores (lectura de los movimientos, a confirmar con Thomas). */
function _impNtlEmpNom(e) {
  if (e === "TN") return "Tierra Nativa";
  if (e === "CH") return "Chef";
  if (e === "D") return "Depósitos sin asignar";
  return e || "—";
}
function _impNtlClaseChip(c) {
  const m = { ingreso: ["ing", "💵 ingreso"], recupero: ["rec", "♻️ recupero"], giro: ["gir", "🏭 giro"],
              comision: ["com", "comisión"], gasto_bancario: ["gas", "gasto banc."], devolucion: ["dev", "devolución"] };
  const x = m[c] || ["otr", c || "—"];
  return '<span class="intl-c ' + x[0] + '">' + x[1] + '</span>';
}
function _impNtlNum(n, dec) {
  const v = Number(n) || 0;
  return v.toLocaleString("es-AR", { minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 });
}
function _impNtlRender() {
  const body = document.getElementById("stkPopBody"); if (!body || !_stkPop || _stkPop.kind !== "impNtl") return;
  if (!document.getElementById("impNtlCss")) {
    const st = document.createElement("style"); st.id = "impNtlCss";
    st.textContent =
      ".intl-tbl{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden}" +
      ".intl-tbl th{font-size:10.5px;text-transform:uppercase;letter-spacing:.3px;color:#64748b;font-weight:800;padding:8px 7px;border-bottom:2px solid #e2e8f0;text-align:left;white-space:nowrap}" +
      ".intl-tbl td{padding:6px 7px;border-bottom:1px solid #f1f5f9;font-size:12.5px;color:#0f172a;vertical-align:middle}" +
      ".intl-tbl td.num,.intl-tbl th.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}" +
      ".intl-c{font-size:10.5px;font-weight:800;padding:2px 7px;border-radius:999px;white-space:nowrap}" +
      ".intl-c.ing{background:#ecfdf5;color:#047857}.intl-c.rec{background:#eff6ff;color:#1d4ed8}" +
      ".intl-c.gir{background:#fff7ed;color:#b45309}.intl-c.com{background:#fef2f2;color:#b91c1c}" +
      ".intl-c.gas{background:#f8fafc;color:#64748b}.intl-c.dev{background:#faf5ff;color:#7c3aed}" +
      ".intl-c.otr{background:#f1f5f9;color:#475569}" +
      ".intl-neg{color:#b91c1c;font-weight:800}.intl-pos{color:#065f46;font-weight:800}";
    document.head.appendChild(st);
  }
  const st = _impNtl;
  let h = _impTabsHtml('ntl');
  h += '<div class="stkpop-hint">La cuenta del <b>forwarder de Hong Kong</b>, importada del Excel de Thomas (saldo verificado <b>fila por fila</b> contra el original). El circuito: entra <b>efectivo</b> (3% de comisión por subida) → NTL le <b>gira</b> a la fábrica el Advance 30% y el Balance 70% → cuando la carga se nacionaliza entra el <b>recupero</b> y NTL cobra su <b>5% s/FC</b>. <code>D</code> = depósitos todavía sin repartir entre Tierra Nativa y Chef.</div>';
  if (st.err) h += '<div class="stkpop-empty" style="color:#b91c1c">No se pudo leer: ' + escapeHtml(st.err) + '</div>';

  const total = (st.resumen || []).reduce(function (a, r) { return a + (Number(r.saldo) || 0); }, 0);
  const pend = (st.pend || []).reduce(function (a, r) { return a + (Number(r.monto) || 0); }, 0);
  h += '<div class="imcu-kpi">' +
    '<div style="background:#eef2ff;border:1px solid #c7d2fe"><div class="k" style="color:#4338ca">Saldo en NTL hoy</div><div class="v" style="color:#3730a3">u$s ' + _impNtlNum(total) + '</div></div>' +
    (st.resumen || []).map(function (r) {
      const s = Number(r.saldo) || 0;
      return '<div style="background:#f8fafc;border:1px solid #e2e8f0"><div class="k" style="color:#475569">' + escapeHtml(_impNtlEmpNom(r.empresa)) + '</div>' +
        '<div class="v" style="color:' + (s < 0 ? "#b91c1c" : "#065f46") + '">u$s ' + _impNtlNum(s) + '</div>' +
        '<div style="font-size:10.5px;color:#94a3b8;font-weight:700">' + r.movimientos + ' mov.</div></div>';
    }).join('') +
    '</div>';
  if (pend > 0) {
    h += '<div style="margin-bottom:10px;padding:9px 13px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;font-size:12.5px;color:#1e3a8a">' +
      '<b>♻️ Recuperos pendientes: u$s ' + _impNtlNum(pend) + '</b> — ' +
      (st.pend || []).map(function (r) { return escapeHtml(r.concepto || '') + ' <b>' + _impNtlNum(r.monto) + '</b>' + (r.empresa ? ' <span style="opacity:.7">(' + escapeHtml(r.empresa) + ')</span>' : ''); }).join(' · ') +
      '. Son los <b>directos</b>, sin pasar por NTL.</div>';
  }
  // acumulados del circuito
  const suma = function (campo) { return (st.resumen || []).reduce(function (a, r) { return a + (Number(r[campo]) || 0); }, 0); };
  h += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;font-size:12px;color:#475569">' +
    '<span style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:5px 10px">💵 Depositado <b>' + _impNtlNum(suma('ingresos')) + '</b></span>' +
    '<span style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:5px 10px">🏭 Girado a fábricas <b>' + _impNtlNum(suma('girado_a_fabricas')) + '</b></span>' +
    '<span style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:5px 10px">♻️ Recuperado <b>' + _impNtlNum(suma('recuperos')) + '</b></span>' +
    '<span style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:5px 10px">Comisiones + gastos <b>' + _impNtlNum(suma('comisiones') + suma('gastos_bancarios')) + '</b></span>' +
    '</div>';

  const _fb = function (on) { return 'width:auto;margin:0;flex:0 0 auto;padding:6px 12px;border-radius:999px;border:1px solid ' + (on ? '#0f766e' : '#cbd5e1') + ';background:' + (on ? '#0f766e' : '#fff') + ';color:' + (on ? '#fff' : '#334155') + ';font-size:12.5px;font-weight:800;cursor:pointer'; };
  // v15.91 — tres vistas de la misma cuenta
  const vista = st.vista || "extracto";
  h += '<div class="imcu-fila"><span class="imcu-lbl">Ver:</span>' +
    '<button style="' + _fb(vista === 'extracto') + '" onclick="impNtlSetVista(\'extracto\')">📄 Extracto</button>' +
    '<button style="' + _fb(vista === 'cargas') + '" onclick="impNtlSetVista(\'cargas\')" title="Las cargas del Excel con su saldo y el pedido que le calza">📦 Cargas</button>' +
    '<button style="' + _fb(vista === 'conc') + '" onclick="impNtlSetVista(\'conc\')" title="Los giros cargados contra el Excel: cuál aparece y cuál no">🔗 Conciliación</button>' +
    '</div>';
  h += _impNtlAliasHtml();
  if (vista === 'cargas') { body.innerHTML = h + _impNtlCargasHtml(); return; }
  if (vista === 'conc')   { body.innerHTML = h + _impNtlConcHtml(); return; }
  // filtros (sólo en el extracto)
  h += '<div class="imcu-fila"><span class="imcu-lbl">Empresa:</span>' +
    '<button style="' + _fb(!st.empresa) + '" onclick="impNtlSetEmpresa(\'\')">Todas</button>' +
    ['D', 'TN', 'CH'].map(function (e) { return '<button style="' + _fb(st.empresa === e) + '" onclick="impNtlSetEmpresa(\'' + e + '\')">' + escapeHtml(_impNtlEmpNom(e)) + '</button>'; }).join('') +
    '</div>';
  const provs = [];
  (st.movs || []).forEach(function (m) { if (m.proveedor && provs.indexOf(m.proveedor) < 0) provs.push(m.proveedor); });
  provs.sort();
  if (st.prov && provs.indexOf(st.prov) < 0) provs.unshift(st.prov);
  if (provs.length > 1) {
    h += '<div class="imcu-fila"><span class="imcu-lbl">🏭 Proveedor:</span>' +
      '<button style="' + _fb(!st.prov) + '" onclick="impNtlSetProv(\'\')">Todos</button>' +
      provs.map(function (p) { return '<button style="' + _fb(st.prov === p) + '" onclick="impNtlSetProv(\'' + encodeURIComponent(p).replace(/'/g, "%27") + '\')">' + escapeHtml(p) + '</button>'; }).join('') +
      '</div>';
  }

  h += '<div class="mva-tblwrap wide"><table class="intl-tbl">' +
    '<thead><tr><th>Fecha</th><th>Movimiento</th><th>Tipo</th><th>Proveedor</th><th>Empresa</th><th class="num">Débito</th><th class="num">Crédito</th><th class="num">Saldo</th></tr></thead><tbody>';
  (st.movs || []).forEach(function (m) {
    const sal = Number(m.saldo) || 0;
    h += '<tr>' +
      '<td style="white-space:nowrap">' + (m.fecha ? _isoToDdMmAa(String(m.fecha).slice(0, 10)) : '<span style="color:#94a3b8">—</span>') + '</td>' +
      '<td>' + escapeHtml(m.descripcion || '—') + (m.origen_destino ? '<div style="font-size:10.5px;color:#94a3b8">' + escapeHtml(String(m.origen_destino).slice(0, 70)) + '</div>' : '') + '</td>' +
      '<td>' + _impNtlClaseChip(m.clase) + '</td>' +
      '<td style="font-size:12px">' + escapeHtml(m.proveedor || '—') + '</td>' +
      '<td style="font-size:11.5px;color:#64748b">' + escapeHtml(m.empresa || '—') + '</td>' +
      '<td class="num">' + (Number(m.debito) > 0 ? '<span class="intl-neg">' + _impNtlNum(m.debito, 2) + '</span>' : '') + '</td>' +
      '<td class="num">' + (Number(m.credito) > 0 ? '<span class="intl-pos">' + _impNtlNum(m.credito, 2) + '</span>' : '') + '</td>' +
      '<td class="num" style="font-weight:800;color:' + (sal < 0 ? '#b91c1c' : '#0f172a') + '">' + _impNtlNum(sal) + '</td></tr>';
  });
  h += '</tbody></table></div>';
  if ((st.movs || []).length >= (st.n || 60)) h += '<button class="apr-mas" onclick="impNtlMas()">Ver más movimientos</button>';
  body.innerHTML = h;
}
/* v15.91 — La solapa 💱 NTL pasa a tener tres vistas:
     📄 Extracto      · el movimiento a movimiento (lo de la v15.90)
     📦 Cargas        · las cargas del Excel (CQ-9154, China 2…) con su saldo y el pedido que le calza
     🔗 Conciliación  · cada giro cargado contra el Excel: cuál matchea y cuál no
   Las sugerencias NO se guardan: son para que Thomas confirme el mapa carga ↔ PI, que es lo único
   que falta para atar el extracto a los pedidos. */
function impNtlSetVista(v) { if (!_impNtl) return; _impNtl.vista = v || "extracto"; return impNtlReload(); }
function _impNtlChip(txt, tipo) { return '<span class="intl-c ' + tipo + '">' + escapeHtml(txt) + '</span>'; }
/* Cargas del Excel: una fila por carga, con lo girado, el FOB y el saldo. */
function _impNtlCargasHtml() {
  const rows = (_impNtl && _impNtl.cargas) || [];
  if (!rows.length) return '<div class="stkpop-empty">No hay cargas cargadas.</div>';
  let h = '<div class="stkpop-hint">Las <b>cargas</b> del Excel de Thomas (las hojas por proveedor). <b>Girado</b> es lo que salió para esa carga y <b>FOB</b> lo que vale; saldo 0 = cerrada. El <b>pedido sugerido</b> es el que más se le parece por proveedor y monto — <b>es una sugerencia, no está guardada</b>: el mapa carga ↔ PI lo tiene que confirmar Thomas.</div>';
  h += '<div class="mva-tblwrap wide"><table class="intl-tbl"><thead><tr><th>Proveedor</th><th>Carga</th>' +
    '<th class="num">Girado</th><th class="num">FOB</th><th class="num">Saldo</th><th>Período</th>' +
    '<th>Pedido que le calza</th></tr></thead><tbody>';
  rows.forEach(function (r) {
    const sal = Number(r.saldo) || 0;
    const igual = String(r.sugerencia || "").indexOf("igual") >= 0;
    const pEnc = encodeURIComponent(r.prov).replace(/'/g, "%27");
    const cEnc = encodeURIComponent(r.carga).replace(/'/g, "%27");
    h += '<tr>' +
      '<td style="font-weight:800">' + escapeHtml(r.prov) + '</td>' +
      '<td style="font-family:Consolas,Menlo,monospace;font-weight:800;font-size:12px">' + escapeHtml(r.carga) + '</td>' +
      '<td class="num">' + _impNtlNum(r.girado) + '</td>' +
      '<td class="num">' + (Number(r.fob_carga) > 0 ? _impNtlNum(r.fob_carga) : '—') + '</td>' +
      '<td class="num"><b style="color:' + (Math.abs(sal) < 1 ? '#16a34a' : '#b45309') + '">' + _impNtlNum(sal) + '</b></td>' +
      '<td style="font-size:11.5px;color:#64748b;white-space:nowrap">' + (r.desde ? _isoToDdMmAa(String(r.desde).slice(0, 10)) : '—') + ' → ' + (r.hasta ? _isoToDdMmAa(String(r.hasta).slice(0, 10)) : '—') + '</td>' +
      '<td style="font-size:12px">' + (r.pedido_asignado
        ? '<b style="color:#065f46">✓ ' + escapeHtml(r.pedido_asignado) + '</b>'
        : (r.pedido_sugerido
            ? '<span style="color:#94a3b8">sugerido:</span> ' + escapeHtml(r.pedido_sugerido) + ' ' + _impNtlChip(r.sugerencia || '', igual ? 'ing' : 'otr')
            : '<span style="color:#94a3b8">—</span>')) +
        ' <button class="imcu-b" onclick="impCargaAsignar(\'' + pEnc + '\',\'' + cEnc + '\')" title="Decir a qué pedido corresponde esta carga">🔗 Asignar</button>' +
        '</td></tr>';
  });
  return h + '</tbody></table></div>';
}
/* Conciliación: los giros cargados contra el Excel. */
function _impNtlConcHtml() {
  const rows = (_impNtl && _impNtl.conc) || [];
  if (!rows.length) return '<div class="stkpop-empty">No hay giros cargados para conciliar.</div>';
  const ok = rows.filter(function (r) { return r.match !== "SIN MATCH"; }).length;
  let h = '<div class="stkpop-hint">Cada <b>giro</b> cargado en la cuenta corriente, buscado en el Excel de Thomas — en el extracto de NTL y en las hojas por proveedor. <b>' + ok + ' de ' + rows.length + '</b> aparecen. Los que dicen <b>SIN MATCH</b> no están en el Excel con ese monto: o el monto está mal, o el giro salió por un camino que no está en estas hojas.</div>';
  h += '<div class="mva-tblwrap wide"><table class="intl-tbl"><thead><tr><th>Pedido</th><th>Proveedor</th>' +
    '<th>Fecha cargada</th><th class="num">u$s</th><th>Estado</th><th>Dónde aparece en el Excel</th></tr></thead><tbody>';
  rows.forEach(function (r) {
    const sinMatch = r.match === "SIN MATCH";
    const exacto = r.match === "exacto";
    h += '<tr>' +
      '<td style="font-family:Consolas,Menlo,monospace;font-weight:800;font-size:12px">' + escapeHtml(r.pedido_ref) + '</td>' +
      '<td>' + escapeHtml(r.proveedor) + '</td>' +
      '<td style="white-space:nowrap">' + (r.fecha ? _isoToDdMmAa(String(r.fecha).slice(0, 10)) : '—') + '</td>' +
      '<td class="num"><b>' + _impNtlNum(r.monto_usd) + '</b></td>' +
      '<td>' + _impNtlChip(sinMatch ? '⚠ sin match' : (exacto ? '✓ exacto' : r.match), sinMatch ? 'com' : (exacto ? 'ing' : 'gir')) + '</td>' +
      '<td style="font-size:12px;color:#475569">' + (r.fuente
        ? '<b>' + escapeHtml(r.fuente) + '</b> · fila ' + r.fila_excel + ' · ' + (r.fecha_excel ? _isoToDdMmAa(String(r.fecha_excel).slice(0, 10)) : '—') +
          (r.detalle ? '<div style="font-size:10.5px;color:#94a3b8">' + escapeHtml(String(r.detalle).slice(0, 80)) + '</div>' : '')
        : '<span style="color:#b45309">no aparece</span>') + '</td></tr>';
  });
  return h + '</tbody></table></div>';
}
/* Alias: los nombres del extracto que hay que traducir. Los que quedan sin decidir los define Thomas. */
function _impNtlAliasHtml() {
  const rows = (_impNtl && _impNtl.alias) || [];
  const sinDecidir = rows.filter(function (r) { return !r.canonico && !r.es_empresa; });
  if (!sinDecidir.length) return "";
  return '<div style="margin-bottom:10px;padding:9px 13px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;font-size:12.5px;color:#92400e">' +
    '<b>⚠ ' + sinDecidir.length + ' nombre(s) del extracto sin definir:</b> ' +
    sinDecidir.map(function (r) {
      const aEnc = encodeURIComponent(r.alias).replace(/'/g, "%27");
      return '<b>' + escapeHtml(r.alias) + '</b> (' + r.movimientos + ' mov.) ' +
        '<button class="imcu-b" onclick="impAliasDefinir(\'' + aEnc + '\')" title="Decir a qué proveedor corresponde">✏️</button>';
    }).join(' · ') +
    '. No están en <code>Importados</code>: hay que decir a qué proveedor corresponden o si son otra cosa.</div>';
}
/* Definir a qué proveedor corresponde un nombre del extracto (o marcarlo como empresa). */
async function impAliasDefinir(aliasEnc) {
  const alias = decodeURIComponent(aliasEnc || "");
  let v;
  try {
    v = prompt("\"" + alias + "\" en el extracto de NTL, ¿a qué proveedor corresponde?\n" +
      "  · escribí el nombre del proveedor como figura en el módulo\n" +
      "  · o EMPRESA si no es un proveedor sino la empresa\n" +
      "  · vacío = dejarlo sin definir", "");
  } catch (_e) { return; }
  if (v === null) return;
  const txt = String(v).trim();
  const esEmpresa = txt.toUpperCase() === "EMPRESA";
  try {
    await _pedImpRpc("gv_imp_prov_alias_set", { p_alias: alias,
      p_canonico: esEmpresa ? null : (txt || null), p_es_empresa: esEmpresa });
  } catch (e) { try { alert("No se pudo guardar: " + (e.message || e)); } catch (_e) {} return; }
  await impNtlReload();
}
/* v15.94 — El mapa CARGA ↔ PEDIDO se carga desde la pantalla, no por chat.
   · En 📦 Cargas: 🔗 Asignar elige a qué pedido corresponde esa carga (o la marca como "ninguno").
   · En 💵 Giros: cada giro puede decir con qué carga se cursó ("a través de") y cuál cubre
     ("fue a"); si están vacías y el Excel de Thomas lo dice, aparece la sugerencia con un ✓ para
     aceptarla de una. Backend: GV_Imp_Carga_Pedido + GV_Imp_Pagos.carga_origen/carga_destino. */
async function impCargaAsignar(provEnc, cargaEnc) {
  const prov = decodeURIComponent(provEnc), carga = decodeURIComponent(cargaEnc);
  const fila = ((_impNtl && _impNtl.cargas) || []).find(function (r) { return r.prov === prov && r.carga === carga; }) || {};
  // los pedidos en curso de ese proveedor, para elegir por número
  let opciones = [];
  try {
    opciones = ((_stkPop && _stkPop.ccAll) || []).filter(function (c) { return c.proveedor === prov; });
  } catch (_e) {}
  if (!opciones.length) {
    try { opciones = (await _pedImpRpc("gv_imp_cc_lista", {}) || []).filter(function (c) { return c.proveedor === prov; }); }
    catch (_e) { opciones = []; }
  }
  const lista = opciones.map(function (c, i) { return "  " + (i + 1) + " = " + c.pedido_ref + " (FOB " + _impNtlNum(c.fob) + ")"; }).join("\n");
  const actual = fila.pedido_asignado || "";
  let v;
  try {
    v = prompt("¿A qué pedido corresponde la carga " + carga + " de " + prov + "?\n" +
      (lista ? lista + "\n" : "") +
      "  0 = no es ninguno de los pedidos en curso\n" +
      "(o escribí el PI a mano)", actual);
  } catch (_e) { return; }
  if (v === null) return;
  const txt = String(v).trim();
  let ref = txt;
  if (txt === "0") ref = "";
  else if (/^\d+$/.test(txt) && opciones[parseInt(txt, 10) - 1]) ref = opciones[parseInt(txt, 10) - 1].pedido_ref;
  let leg = ""; try { leg = String(window.__authEmail || ""); } catch (_e) {}
  try { await _pedImpRpc("gv_imp_carga_pedido_set", { p_proveedor: prov, p_carga: carga, p_pedido_ref: ref || null, p_legajo: leg }); }
  catch (e) { try { alert("No se pudo guardar: " + (e.message || e)); } catch (_e) {} return; }
  await impNtlReload();
}
/* Las dos cargas de un giro. Un solo prompt para las dos, que es como se leen. */
async function impPagoCargas(pagoId, sugO, sugD) {
  if (!_impPagos) return;
  const r = (_impPagos.rows || []).find(function (x) { return x.id === pagoId; }) || {};
  let v1;
  try { v1 = prompt("¿Con qué carga / factura se cursó este giro? (el \"a través de\" del Excel)\nVacío = sin dato:", r.carga_origen || sugO || ""); }
  catch (_e) { return; }
  if (v1 === null) return;
  let v2;
  try { v2 = prompt("¿Qué carga queda cubierta con este giro? (el \"fue a\")\nVacío = sin dato:", r.carga_destino || sugD || ""); }
  catch (_e) { return; }
  if (v2 === null) return;
  try { await _pedImpRpc("gv_imp_pago_cargas_set", { p_pago_id: pagoId, p_origen: String(v1).trim() || null, p_destino: String(v2).trim() || null }); _impPagos.dirty = true; }
  catch (e) { try { alert("No se pudo guardar: " + (e.message || e)); } catch (_e) {} return; }
  await _impPagosReload();
}
/* Aceptar de una lo que dice el Excel. */
async function impPagoCargasAceptar(pagoId, oEnc, dEnc) {
  if (!_impPagos) return;
  try { await _pedImpRpc("gv_imp_pago_cargas_set", { p_pago_id: pagoId, p_origen: decodeURIComponent(oEnc || "") || null, p_destino: decodeURIComponent(dEnc || "") || null }); _impPagos.dirty = true; }
  catch (e) { try { alert("No se pudo guardar: " + (e.message || e)); } catch (_e) {} return; }
  await _impPagosReload();
}
/* Celda de cargas de un giro: lo cargado, o la sugerencia del Excel con el ✓ para aceptarla. */
function _impPagoCargasCell(x) {
  // Los valores se codifican ANTES: llamar una función local adentro del string del onclick
  // deja un "enc(" dentro del atributo y el escáner de botones muertos lo lee como handler.
  const oEnc = encodeURIComponent(String(x.sug_origen == null ? "" : x.sug_origen)).replace(/'/g, "%27");
  const dEnc = encodeURIComponent(String(x.sug_destino == null ? "" : x.sug_destino)).replace(/'/g, "%27");
  const tiene = x.carga_origen || x.carga_destino;
  if (tiene) {
    return '<span style="font-family:Consolas,Menlo,monospace;font-size:11.5px;cursor:pointer" onclick="impPagoCargas(' + x.id + ')" title="Tocá para corregir">' +
      escapeHtml(x.carga_origen || '—') + ' <span style="color:#94a3b8">→</span> ' + escapeHtml(x.carga_destino || '—') + '</span>';
  }
  if (x.sug_origen || x.sug_destino) {
    return '<span style="font-size:11px;color:#b45309">según el Excel: <b>' + escapeHtml(x.sug_origen || '—') + ' → ' + escapeHtml(x.sug_destino || '—') + '</b></span> ' +
      '<button class="imcu-b" style="background:#166534;color:#fff" title="' + escapeHtml(x.sug_fuente || '') + '" onclick="impPagoCargasAceptar(' + x.id + ',\'' + oEnc + '\',\'' + dEnc + '\')">✓ usar</button>';
  }
  return '<button class="imcu-b" onclick="impPagoCargas(' + x.id + ')">+ cargas</button>';
}
/* v24.01 (Luis) — la nacionalización de ESTE pedido y su reparto por artículo.
   El embarque es el PEDIDO (un proveedor = un embarque, igual que en 📦 Pedidos), así que el
   costo se calcula una vez con el FOB y los m³ del pedido y después se reparte entre sus líneas
   con `_impNacReparto`. La tasa de derechos sale del promedio ponderado por FOB de SUS artículos
   (`_derechosPedido`), no de una tasa suelta: cada código puede tener su partida arancelaria. */
function _impCursoNac(r, ls) {
  const nac = (_stkPop && _stkPop.nac) || { modo: _NAC_DEFAULTS.modo, valorM3: _NAC_DEFAULTS.valorM3, tn: 0 };
  const prov = String(r && r.proveedor || "");
  const valorM3 = _impProvNum(prov, "valor_m3", nac.valorM3);
  // El EMBARQUE es el pedido entero, así que el costo se calcula con el FOB y los m³ del PEDIDO
  // — los mismos que muestra su fila. Las líneas sólo dicen cómo se REPARTE. Al revés (sumando
  // líneas) un detalle incompleto inflaría el factor sin que nada avise.
  let fob = _nacNum(r && r.usd, 0), m3 = _nacNum(r && r.m3, 0);
  if (!(fob > 0)) (ls || []).forEach(function (l) { fob += _nacNum(l.usd, 0); });
  if (!(m3 > 0)) (ls || []).forEach(function (l) { m3 += _nacNum(l.m3, 0); });
  const der = _impCursoDerechos(ls, prov);
  // v25.13 — la Autorización de Impo va sobre el FOB de las líneas que llevan INAL
  const _inalL = function (l) { const r = _impExtraRow(l.cod_art, l.marca); return !!(r && r.inal); };
  const fobInal = _impExtraOk ? (ls || []).reduce(function (s, l) { return s + (_inalL(l) ? _nacNum(l.usd, 0) : 0); }, 0) : null;
  const res = _pedImpNacionalizar(fob, m3, { modo: nac.modo, valorM3: valorM3, tn: nac.tn,
    ntl: _esProvNtl(prov), derechos: der, fobInal: fobInal });
  const rep = _impNacReparto(res, (ls || []).map(function (l) {
    return { m3: l.m3, fob: l.usd, uni: l.pendiente, inal: _inalL(l) };
  }), (_stkPop && _stkPop.nacCrit) || "mixto");
  return { res: res, rep: rep, fob: fob, m3: m3, valorM3: valorM3, prov: prov, modo: nac.modo };
}
/* ⚠ `_derechosPedido` lee el FOB con `_pedImpUsdOf`, que es del otro módulo y acá no aplica:
   las líneas del pedido en curso traen `usd` calculado por el backend. Este shim se lo da sin
   tocar aquella función (que sigue siendo la del generador de pedidos). */
function _impCursoDerechos(ls, prov) {
  var fob = 0, der = 0;
  (ls || []).forEach(function (l) {
    var u = _nacNum(l.usd, 0); if (!(u > 0)) return;
    fob += u; der += u * _derechosArt(l.cod_art, prov);
  });
  return fob > 0 ? (der / fob) : _derechosProv(prov);
}
function _impCursoLineasHtml(ls, r) {
  if (!ls.length) return '<div style="padding:10px 14px;color:#64748b;font-size:12.5px">Este pedido no tiene líneas en curso.</div>';
  const N = _impCursoNac(r, ls), crit = (_stkPop && _stkPop.nacCrit) || "mixto", ct = _impNacCritTxt(crit);
  const provEnc = _impCursoEnc(N.prov);
  const fx = N.res.ok && N.fob > 0 ? (Math.round(N.res.factor * 1000) / 10).toLocaleString("es-AR") : "—";
  const bt = function (c, t) {
    return '<span class="imcu-b" style="' + (crit === c ? 'background:#4c1d95;color:#fff;border-color:#4c1d95;' : '') + 'padding:3px 9px" onclick="impCursoNacCrit(\'' + c + '\')" title="' + escapeHtml(_impNacCritTxt(c).tip) + '">' + t + '</span>';
  };
  let h = '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:8px 12px;margin:2px 0 8px;background:#faf5ff;border:1px solid #e9d5ff;border-radius:10px;font-size:12.5px;color:#4c1d95">' +
    '<b>🛃 Nacionalización del embarque:</b> <b style="font-size:14px">u$s ' + _nacF(N.res.noRecup) + '</b>' +
    '<span style="color:#6b21a8">= ' + fx + '% del FOB · ' + escapeHtml(N.modo) + '</span>' +
    '<label style="display:flex;align-items:center;gap:5px;font-weight:700" title="Lo que cuesta cada m³ de flete marítimo. Se guarda en el proveedor (' + escapeHtml(N.prov) + ') y vale también para el módulo 📦 Pedidos: es la misma fuente.">u$s/m³ <input type="number" inputmode="decimal" min="0" step="1" value="' + N.valorM3 + '" onchange="impCursoSetNacM3(\'' + provEnc + '\',this.value)" style="width:66px;height:28px;border:1px solid #c4b5fd;border-radius:8px;padding:0 6px;font-size:13px;text-align:right"></label>' +
    '<span style="display:flex;align-items:center;gap:5px"><b>repartir:</b> ' + bt("mixto", "mixto") + bt("m3", "por m³") + bt("fob", "por FOB") + '</span>' +
    '<span style="color:#6b21a8;flex:1 1 100%;font-size:11.5px">' + escapeHtml(ct.tip) + '</span>' +
    '</div>';
  // ⚠ SIN width:99% en Descripción: se probó y deja un hueco muerto entre ella y Unidades (y parte
  // la marca en dos líneas). El reparto natural de la tabla queda más apretado, que es la regla.
  h += '<table><thead><tr><th style="text-align:left">Código</th><th style="text-align:left">Descripción</th><th style="text-align:right">Unidades</th><th style="text-align:right">u$s</th><th style="text-align:right">m³</th>' +
    '<th style="text-align:right;white-space:nowrap" title="Costo de nacionalización de ESTE artículo: la parte que le toca del costo del embarque, repartida ' + escapeHtml(ct.lbl) + '. Abajo, por unidad.">🛃 Nac. u$s<small style="display:block;font-weight:600;opacity:.75">u$s/u</small></th>' +
    '<th style="text-align:right;white-space:nowrap" title="Puesto en Argentina por unidad = FOB por unidad + la nacionalización que le toca. Es el costo real de la caja cuando llega al depósito.">Puesto<small style="display:block;font-weight:600;opacity:.75">u$s/u</small></th>' +
    '<th style="text-align:left">Llegada</th></tr></thead><tbody>';
  h += ls.map(function (l, i) {
    const nacU = _nacNum(N.rep.items[i], 0);
    const uni = _nacNum(l.pendiente, 0);
    const fobU = uni > 0 ? (_nacNum(l.usd, 0) / uni) : _nacNum(l.fob_uni, 0);
    const nacUni = uni > 0 ? (nacU / uni) : 0;
    return '<tr><td style="font-weight:800;font-family:Consolas,Menlo,monospace">' + escapeHtml(codCanon(l.cod_art)) + (l.marca ? ' <span style="font-size:10px;color:#64748b">' + escapeHtml(l.marca) + '</span>' : '') + '</td>' +
      '<td style="color:#475569">' + escapeHtml(String(artNombre(l.cod_art, l.descripcion) || "").slice(0, 40)) + '</td>' +
      '<td style="text-align:right;font-variant-numeric:tabular-nums">' + _impCursoNum(uni) + '</td>' +
      '<td style="text-align:right;color:#065f46">' + (Number(l.usd) > 0 ? _impCursoNum(Math.round(l.usd)) : '—') + '</td>' +
      '<td style="text-align:right;color:#0369a1">' + (Number(l.m3) > 0 ? (Math.round(l.m3 * 100) / 100).toLocaleString("es-AR") : '—') + '</td>' +
      '<td style="text-align:right;color:#6d28d9;font-weight:700">' + (nacU > 0 ? _nacF(nacU) : '—') +
        (nacUni > 0 ? '<div style="font-size:10.5px;color:#7c3aed;font-weight:600">' + _nacF2(nacUni) + '</div>' : '') + '</td>' +
      '<td style="text-align:right;font-weight:800;color:#0f172a">' + ((fobU + nacUni) > 0 ? _nacF2(fobU + nacUni) : '—') + '</td>' +
      '<td>' + (l.fecha_reingreso ? _isoToDdMmAa(String(l.fecha_reingreso).slice(0, 10)) : '<span style="color:#b45309">sin fecha</span>') + '</td></tr>';
  }).join("");
  h += '<tr style="background:#f8fafc"><td colspan="5" style="text-align:right;font-weight:700;color:#334155">TOTAL nacionalización repartida</td>' +
    '<td style="text-align:right;font-weight:800;color:#6d28d9">' + _nacF(N.rep.total) + '</td><td colspan="2"></td></tr>';
  return h + '</tbody></table>';
}
/* Cambiar el criterio de reparto: es sólo cómo se MUESTRA el costo del embarque repartido —
   no toca ninguna tabla ni el total, que sigue siendo el mismo u$s. */
function impCursoNacCrit(c) {
  if (!_stkPop || _stkPop.kind !== "impCurso") return;
  _stkPop.nacCrit = (c === "m3" || c === "fob") ? c : "mixto";
  _impCursoRender();
}
/* El u$s/m³ de flete SÍ toca la base: es `GV_Imp_Proveedor.valor_m3` de ese proveedor (regla
   v23.89, la config de importados vive en tablas). Se manda SÓLO esa clave: la RPC deja intacta
   toda clave ausente, así que mandar el resto pisaría lo que otro esté editando en el ⚙. */
async function impCursoSetNacM3(provEnc, v) {
  if (!_stkPop || _stkPop.kind !== "impCurso") return;
  const prov = decodeURIComponent(provEnc || ""); if (!prov) return;
  const n = Number(v);
  if (!isFinite(n) || n < 0) { _impCursoRender(); return; }
  // reflejo inmediato, sin esperar al backend
  if (_impCfgProv && _impCfgProv[prov]) _impCfgProv[prov].valor_m3 = n;
  _impCursoRender();
  try { await _impCfgRpc("gv_imp_proveedor_guardar", { p: { proveedor: prov, valor_m3: n } }); await _impCfgCargar(); }
  catch (e) { try { alert("No se pudo guardar el valor del m³: " + (e.message || e)); } catch (_e) {} }
  if (_stkPop && _stkPop.kind === "impCurso") _impCursoRender();
}
async function impCursoToggle(refEnc, provEnc) {
  if (!_stkPop || _stkPop.kind !== "impCurso") return;
  const ref = decodeURIComponent(refEnc), prov = decodeURIComponent(provEnc);
  const key = ref + "§" + prov;
  if (_stkPop.abierto === key) { _stkPop.abierto = ""; _impCursoRender(); return; }
  _stkPop.abierto = key; _impCursoRender();
  if (!_stkPop.lineas[key]) {
    let ls = [];
    try { ls = (await _pedImpRpc("gv_importado_pedido_lineas", { p_pedido_ref: ref, p_proveedor: prov })) || []; } catch (_e) { ls = []; }
    if (_stkPop && _stkPop.kind === "impCurso") { _stkPop.lineas[key] = ls; _impCursoRender(); }
  }
}
/* Las dos fechas del pedido. Se escriben en TODAS sus líneas en curso (una sola RPC). */
async function _impCursoSetFecha(refEnc, provEnc, iso, campo) {
  if (!_stkPop || _stkPop.kind !== "impCurso") return;
  const ref = decodeURIComponent(refEnc), prov = decodeURIComponent(provEnc);
  const body = { p_pedido_ref: ref, p_proveedor: prov };
  if (campo === "emb") { body.p_embarque = iso || null; body.p_set_embarque = true; }
  else { body.p_llegada = iso || null; body.p_set_llegada = true; }
  try { await _pedImpRpc("gv_importado_pedido_fechas", body); }
  catch (e) { try { alert("No se pudo guardar la fecha: " + (e.message || e)); } catch (_e) {} }
  if (_stkPop && _stkPop.kind === "impCurso") _stkPop.lineas = {};
  await impCursoReload();
}
function impCursoSetEmbarque(refEnc, provEnc, iso) { return _impCursoSetFecha(refEnc, provEnc, iso, "emb"); }
function impCursoSetLlegada(refEnc, provEnc, iso) { return _impCursoSetFecha(refEnc, provEnc, iso, "lleg"); }
/* Cambiar el número de PI de un pedido (los baches viejos quedaron con el mail del que cargó). */
async function impCursoRenombrar(refEnc, provEnc) {
  const ref = decodeURIComponent(refEnc), prov = decodeURIComponent(provEnc);
  let v; try { v = prompt("Número de PI / referencia de este pedido de " + prov + ":", ref === "(sin pedido)" ? "" : ref); } catch (_e) { return; }
  if (v === null) return;
  const nuevo = String(v).trim();
  if (!nuevo) { try { alert("La referencia no puede quedar vacía."); } catch (_e) {} return; }
  if (nuevo === ref) return;
  try { await _pedImpRpc("gv_importado_pedido_ref", { p_pedido_ref: ref, p_proveedor: prov, p_nuevo_ref: nuevo }); }
  catch (e) { try { alert("No se pudo renombrar: " + (e.message || e)); } catch (_e) {} return; }
  if (_stkPop && _stkPop.kind === "impCurso") { _stkPop.abierto = ""; _stkPop.lineas = {}; }
  await impCursoReload();
}
/* v25.94 — ✏️ EDITAR PI: corregir las cantidades de cada ítem (y el número de PI), con registro de
   QUIÉN, QUÉ DÍA y A QUÉ HORA. Pedido: "cuando toco el lápiz, me pregunte quién es la persona que
   va a corregir la PI… Tomás, Vivi, Luis, Tomás, Gastón, y un cuadradito Otro para poner el nombre,
   y ya se registre como un nuevo editor de pedidos".
   Tres pasos: 1) ¿quién corrige? · 2) cantidades nuevas · 3) antes → después (simulado en la base,
   no escribe) y recién ahí «Guardar». Todo lo decide la RPC gv_imp_pi_editar: la cantidad no puede
   quedar por debajo de lo ya llegado, 0 saca el ítem de la PI, y si la línea cambió mientras se
   editaba no pisa (manda lo que se VIO en `antes`). El log vive en GV_Imp_PI_Edicion. */
let _impPiEd = null;
const _IMP_PI_EDITORES_FALLBACK = ["Thomas", "Tomás", "Vivi", "Luis", "Gastón"];
function _impPiEdCss() {
  if (document.getElementById("impPiEdCss")) return;
  const st = document.createElement("style"); st.id = "impPiEdCss";
  st.textContent =
    "#impPiEdOv{display:none;position:fixed;inset:0;z-index:1330;background:rgba(2,6,23,.78);overflow:auto;padding:14px}" +
    "#impPiEdOv.show{display:block}" +
    "#impPiEdOv button{width:auto;margin-top:0}" +
    "#impPiEdOv input{box-sizing:border-box;margin:0}" +
    ".ipe-card{background:#f8fafc;width:max-content;max-width:96vw;margin:0 auto;border-radius:14px;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.55)}" +
    ".ipe-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 14px;background:linear-gradient(90deg,#1e3a8a,#2563eb);color:#fff}" +
    ".ipe-head b{font-size:15px;font-weight:800}" +
    ".ipe-x{background:rgba(255,255,255,.22);color:#fff;border:none;border-radius:8px;padding:5px 11px;font-size:13px;font-weight:800;cursor:pointer}" +
    ".ipe-body{padding:12px 14px;text-align:center}" +
    ".ipe-q{font-size:15px;font-weight:800;color:#0f172a;margin-bottom:10px}" +
    ".ipe-eds{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;max-width:460px;margin:0 auto}" +
    ".ipe-ed{border:1.5px solid #bfdbfe;background:#eff6ff;color:#1e3a8a;border-radius:10px;padding:9px 16px;font-size:15px;font-weight:800;cursor:pointer}" +
    ".ipe-ed:hover{background:#dbeafe}" +
    ".ipe-otro{display:flex;gap:6px;justify-content:center;align-items:center;margin-top:12px;padding-top:10px;border-top:1px dashed #cbd5e1}" +
    ".ipe-otro input{width:180px;padding:7px 9px;border:1.5px solid #cbd5e1;border-radius:9px;font-size:14px}" +
    ".ipe-b{border:0;border-radius:9px;padding:7px 14px;font-size:13.5px;font-weight:800;cursor:pointer;background:#e2e8f0;color:#0f172a}" +
    ".ipe-b.pri{background:#1d4ed8;color:#fff}.ipe-b.ok{background:#166534;color:#fff}.ipe-b:disabled{opacity:.5;cursor:default}" +
    ".ipe-quien{display:inline-flex;gap:8px;align-items:center;font-size:13px;color:#334155;margin-bottom:8px}" +
    ".ipe-quien b{color:#1e3a8a}" +
    ".ipe-ref{display:flex;gap:6px;justify-content:center;align-items:center;margin-bottom:10px;font-size:12.5px;font-weight:800;color:#475569}" +
    ".ipe-ref input{width:190px;padding:6px 8px;border:1.5px solid #cbd5e1;border-radius:8px;font-size:13.5px;font-weight:800;font-family:Consolas,Menlo,monospace;text-align:center}" +
    ".ipe-tbl{border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;margin:0 auto}" +
    ".ipe-tbl th{font-size:10.5px;text-transform:uppercase;color:#64748b;font-weight:800;padding:6px 8px;border-bottom:2px solid #e2e8f0;text-align:center;line-height:1.15}" +
    ".ipe-tbl td{padding:4px 8px;border-bottom:1px solid #f1f5f9;font-size:13.5px;color:#0f172a;text-align:center;font-variant-numeric:tabular-nums;white-space:nowrap}" +
    ".ipe-tbl td.cod{font-weight:800;font-family:Consolas,Menlo,monospace}" +
    ".ipe-tbl td.cod small{font-family:inherit;font-size:10px;color:#64748b;font-weight:700;margin-left:3px}" +
    ".ipe-tbl tr.cambia td{background:#fefce8}" +
    ".ipe-tbl tr.tot td{background:#f8fafc;font-weight:800;border-top:2px solid #e2e8f0}" +
    ".ipe-in{width:92px;padding:4px 6px;border:1.5px solid #cbd5e1;border-radius:7px;font-size:13.5px;font-weight:700;text-align:center;font-variant-numeric:tabular-nums}" +
    ".ipe-in:focus{border-color:#2563eb;outline:none}" +
    ".ipe-mas{color:#166534;font-weight:800}.ipe-men{color:#b91c1c;font-weight:800}" +
    ".ipe-foot{display:flex;gap:8px;justify-content:center;margin-top:12px}" +
    ".ipe-msg{margin:8px auto 0;max-width:520px;font-size:12.5px;font-weight:700;border-radius:9px;padding:7px 10px}" +
    ".ipe-msg.err{background:#fef2f2;color:#b91c1c;border:1px solid #fecaca}" +
    ".ipe-msg.ok{background:#f0fdf4;color:#166534;border:1px solid #bbf7d0}" +
    ".ipe-msg.info{background:#eff6ff;color:#1e40af;border:1px solid #bfdbfe}" +
    ".ipe-hist{margin-top:12px;padding-top:8px;border-top:1px dashed #cbd5e1}" +
    ".ipe-hist summary{cursor:pointer;font-size:12.5px;font-weight:800;color:#475569}" +
    ".ipe-hist .ipe-tbl td{font-size:12.5px}";
  document.head.appendChild(st);
}
function _impPiEdNum(n) { return Number(n || 0).toLocaleString("es-AR"); }
function _impPiEdDelta(d) {
  d = Number(d) || 0;
  if (!d) return '<span style="color:#94a3b8">—</span>';
  return '<span class="' + (d > 0 ? "ipe-mas" : "ipe-men") + '">' + (d > 0 ? "+" : "−") + _impPiEdNum(Math.abs(d)) + '</span>';
}
function _impPiEdFecha(iso) {
  try {
    return new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch (_e) { return String(iso || ""); }
}
async function impPiEditar(refEnc, provEnc) {
  _impPiEdCss();
  const ref = decodeURIComponent(refEnc || ""), prov = decodeURIComponent(provEnc || "");
  _impPiEd = { ref: ref, prov: prov, paso: "quien", editor: "", editores: null, edErr: "", lineas: null, linErr: "",
    nuevos: {}, refNuevo: ref, preview: null, msg: "", msgTipo: "", hist: null, guardando: false, guardado: null };
  let ov = document.getElementById("impPiEdOv");
  if (!ov) { ov = document.createElement("div"); ov.id = "impPiEdOv"; document.body.appendChild(ov); }
  ov.classList.add("show");
  _impPiEdRender();
  // editores y líneas en paralelo: mientras la persona elige quién es, las cantidades ya llegan
  const st = _impPiEd;
  _pedImpRpc("gv_imp_pi_editores", {}).then(function (rs) {
    if (_impPiEd !== st) return;
    st.editores = (rs || []).map(function (x) { return x.nombre; }).filter(Boolean);
    if (!st.editores.length) st.editores = _IMP_PI_EDITORES_FALLBACK.slice();
    _impPiEdRender();
  }).catch(function (e) {
    if (_impPiEd !== st) return;
    st.editores = _IMP_PI_EDITORES_FALLBACK.slice(); st.edErr = String(e.message || e); _impPiEdRender();
  });
  _pedImpRpc("gv_importado_pedido_lineas", { p_pedido_ref: ref, p_proveedor: prov }).then(function (ls) {
    if (_impPiEd !== st) return;
    st.lineas = ls || []; _impPiEdRender();
  }).catch(function (e) {
    if (_impPiEd !== st) return;
    st.lineas = null; st.linErr = String(e.message || e); _impPiEdRender();
  });
  _pedImpRpc("gv_imp_pi_ediciones", { p_pedido_ref: ref, p_proveedor: prov, p_limite: 200 }).then(function (hs) {
    if (_impPiEd !== st) return;
    st.hist = hs || []; _impPiEdRender();
  }).catch(function () { if (_impPiEd === st) { st.hist = []; _impPiEdRender(); } });
}
function impPiEdCerrar() {
  const ov = document.getElementById("impPiEdOv"); if (ov) ov.classList.remove("show");
  const g = _impPiEd && _impPiEd.guardado; _impPiEd = null;
  if (g && _stkPop && _stkPop.kind === "impCurso") {
    _stkPop.lineas = {};
    if (g.ref_nuevo && _stkPop.refFiltro === g.pedido_ref) _stkPop.refFiltro = g.ref_nuevo;
    _stkPop.abierto = "";
    try { impCursoReload(); } catch (_e) {}
  }
}
function impPiEdQuien(nomEnc) {
  if (!_impPiEd) return;
  const n = String(decodeURIComponent(nomEnc || "")).trim(); if (!n) return;
  _impPiEd.editor = n; _impPiEd.paso = "editar"; _impPiEd.msg = ""; _impPiEdRender();
}
function impPiEdOtro() {
  if (!_impPiEd) return;
  const inp = document.getElementById("impPiEdOtroIn");
  const n = String((inp && inp.value) || "").replace(/\s+/g, " ").trim();
  if (!n) { _impPiEd.msg = "Escribí el nombre de quien corrige."; _impPiEd.msgTipo = "err"; _impPiEdRender(); return; }
  if (n.length > 60) { _impPiEd.msg = "El nombre es demasiado largo."; _impPiEd.msgTipo = "err"; _impPiEdRender(); return; }
  impPiEdQuien(encodeURIComponent(n));
}
function impPiEdCambiarQuien() { if (_impPiEd) { _impPiEd.paso = "quien"; _impPiEd.preview = null; _impPiEd.msg = ""; _impPiEdRender(); } }
function impPiEdSetCant(bacheId, v) {
  if (!_impPiEd) return;
  // type=number: el valor llega sin separador de miles ("2520"); una coma decimal se toma como punto
  const s = String(v == null ? "" : v).replace(",", ".").trim();
  if (s === "") delete _impPiEd.nuevos[bacheId];
  else { const n = Math.round(Number(s)); if (isFinite(n)) _impPiEd.nuevos[bacheId] = n; }
  _impPiEd.preview = null;
  _impPiEdPintarTotales();
}
function impPiEdSetRef(v) { if (_impPiEd) { _impPiEd.refNuevo = String(v || "").trim(); _impPiEd.preview = null; } }
/* Sólo repinta Δ y totales, sin rearmar la tabla: si no, el input pierde el foco en cada tecla. */
function _impPiEdPintarTotales() {
  const st = _impPiEd; if (!st || !st.lineas) return;
  let tA = 0, tN = 0;
  st.lineas.forEach(function (l) {
    const a = Number(l.unidades) || 0, n = (l.bache_id in st.nuevos) ? st.nuevos[l.bache_id] : a;
    tA += a; tN += n;
    const d = document.getElementById("ipeD" + l.bache_id); if (d) d.innerHTML = _impPiEdDelta(n - a);
    const tr = document.getElementById("ipeR" + l.bache_id); if (tr) tr.className = (n !== a) ? "cambia" : "";
  });
  const t = document.getElementById("ipeTotN"); if (t) t.textContent = _impPiEdNum(tN);
  const td = document.getElementById("ipeTotD"); if (td) td.innerHTML = _impPiEdDelta(tN - tA);
}
function _impPiEdCambios() {
  const st = _impPiEd; const out = [];
  (st.lineas || []).forEach(function (l) {
    if (!(l.bache_id in st.nuevos)) return;
    const n = st.nuevos[l.bache_id], a = Number(l.unidades) || 0;
    if (n !== a) out.push({ bache_id: l.bache_id, unidades: n, antes: a });
  });
  return out;
}
async function impPiEdRevisar() {
  const st = _impPiEd; if (!st || st.guardando) return;
  const cambios = _impPiEdCambios();
  const refN = (st.refNuevo && st.refNuevo !== st.ref) ? st.refNuevo : null;
  if (!cambios.length && !refN) { st.msg = "No cambiaste ninguna cantidad ni el número de PI."; st.msgTipo = "info"; _impPiEdRender(); return; }
  const neg = cambios.filter(function (c) { return c.unidades < 0; });
  if (neg.length) { st.msg = "Una cantidad no puede ser negativa."; st.msgTipo = "err"; _impPiEdRender(); return; }
  st.guardando = true; st.msg = ""; _impPiEdRender();
  try {
    st.preview = await _pedImpRpc("gv_imp_pi_editar", { p_pedido_ref: st.ref, p_proveedor: st.prov, p_editor: st.editor,
      p_cambios: cambios, p_nuevo_ref: refN, p_simular: true });
    st.paso = "revisar";
  } catch (e) { st.msg = "No se pudo revisar: " + (e.message || e); st.msgTipo = "err"; }
  st.guardando = false; _impPiEdRender();
}
function impPiEdVolver() { if (_impPiEd) { _impPiEd.paso = "editar"; _impPiEd.msg = ""; _impPiEdRender(); } }
async function impPiEdGuardar() {
  const st = _impPiEd; if (!st || st.guardando || !st.preview) return;
  const cambios = _impPiEdCambios();
  const refN = (st.refNuevo && st.refNuevo !== st.ref) ? st.refNuevo : null;
  st.guardando = true; _impPiEdRender();
  try {
    st.guardado = await _pedImpRpc("gv_imp_pi_editar", { p_pedido_ref: st.ref, p_proveedor: st.prov, p_editor: st.editor,
      p_cambios: cambios, p_nuevo_ref: refN, p_simular: false });
    st.paso = "listo";
  } catch (e) { st.msg = "No se guardó nada: " + (e.message || e); st.msgTipo = "err"; }
  st.guardando = false; _impPiEdRender();
}
function _impPiEdTablaDiff(p) {
  let h = '<table class="ipe-tbl"><thead><tr><th>Código</th><th>Antes<br>u</th><th>Después<br>u</th><th>Dif.<br>u</th></tr></thead><tbody>';
  (p.filas || []).forEach(function (f) {
    h += '<tr class="cambia"><td class="cod">' + escapeHtml(codCanon(f.cod_art)) + (f.marca ? '<small>' + escapeHtml(f.marca) + '</small>' : '') + '</td>' +
      '<td>' + _impPiEdNum(f.antes) + '</td><td><b>' + (f.sale ? '0 <span class="ipe-men" style="font-size:11px">sale de la PI</span>' : _impPiEdNum(f.despues)) + '</b></td>' +
      '<td>' + _impPiEdDelta(f.delta) + '</td></tr>';
  });
  h += '<tr class="tot"><td>Total PI</td><td>' + _impPiEdNum(p.total_antes) + '</td><td>' + _impPiEdNum(p.total_despues) + '</td><td>' + _impPiEdDelta((p.total_despues || 0) - (p.total_antes || 0)) + '</td></tr>';
  return h + '</tbody></table>';
}
function _impPiEdHistHtml() {
  const hs = (_impPiEd && _impPiEd.hist) || [];
  if (!hs.length) return '';
  let h = '<details class="ipe-hist"><summary>📜 Ediciones anteriores (' + hs.length + ')</summary>' +
    '<table class="ipe-tbl" style="margin-top:6px"><thead><tr><th>Día y hora</th><th>Quién</th><th>Qué</th><th>Antes</th><th>Después</th></tr></thead><tbody>';
  hs.forEach(function (x) {
    const que = x.campo === "pedido_ref" ? "N° de PI" : (escapeHtml(codCanon(x.cod_art || "")) + (x.marca ? ' <small style="color:#64748b">' + escapeHtml(x.marca) + '</small>' : ''));
    const a = x.campo === "pedido_ref" ? escapeHtml(x.antes_ref || "") : _impPiEdNum(x.antes_u);
    const d = x.campo === "pedido_ref" ? escapeHtml(x.despues_ref || "") : _impPiEdNum(x.despues_u);
    h += '<tr><td>' + escapeHtml(_impPiEdFecha(x.ts)) + '</td><td title="' + escapeHtml(x.usuario || "") + '"><b>' + escapeHtml(x.editor || "") + '</b></td><td>' + que + '</td><td>' + a + '</td><td>' + d + '</td></tr>';
  });
  return h + '</tbody></table></details>';
}
function _impPiEdRender() {
  const ov = document.getElementById("impPiEdOv"); const st = _impPiEd; if (!ov || !st) return;
  let h = '<div class="ipe-card"><div class="ipe-head"><b>✏️ Editar ' + escapeHtml(st.ref) + ' · ' + escapeHtml(st.prov) + '</b>' +
    '<button class="ipe-x" onclick="impPiEdCerrar()">✕ Cerrar</button></div><div class="ipe-body">';
  const msg = st.msg ? '<div class="ipe-msg ' + (st.msgTipo || "info") + '">' + escapeHtml(st.msg) + '</div>' : '';
  if (st.paso === "quien") {
    h += '<div class="ipe-q">¿Quién corrige esta PI?</div>';
    if (!st.editores) h += '<div style="color:#64748b;font-size:13px">Cargando…</div>';
    else {
      h += '<div class="ipe-eds">' + st.editores.map(function (n) {
        return '<button class="ipe-ed" onclick="impPiEdQuien(\'' + _impCursoEnc(n) + '\')">' + escapeHtml(n) + '</button>';
      }).join("") + '</div>';
      h += '<div class="ipe-otro"><b style="font-size:13px;color:#475569">Otro:</b><input id="impPiEdOtroIn" placeholder="Nombre" maxlength="60" onkeydown="if(event.key===\'Enter\')impPiEdOtro()"><button class="ipe-b pri" onclick="impPiEdOtro()">Seguir</button></div>';
      h += '<div style="font-size:11.5px;color:#64748b;margin-top:6px">Un nombre nuevo queda como editor de pedidos para la próxima vez.</div>';
      if (st.edErr) h += '<div class="ipe-msg err">No se pudo leer la lista de editores (' + escapeHtml(st.edErr) + '). Se muestra la lista base.</div>';
    }
    h += msg + _impPiEdHistHtml();
  } else if (st.paso === "editar") {
    h += '<div class="ipe-quien">Corrige: <b>' + escapeHtml(st.editor) + '</b> <button class="ipe-b" style="padding:3px 9px;font-size:12px" onclick="impPiEdCambiarQuien()">cambiar</button></div>';
    h += '<div class="ipe-ref">N° de PI <input value="' + escapeHtml(st.refNuevo) + '" oninput="impPiEdSetRef(this.value)"></div>';
    if (st.linErr) h += '<div class="ipe-msg err">No se pudieron leer los ítems: ' + escapeHtml(st.linErr) + '</div>';
    else if (!st.lineas) h += '<div style="color:#64748b;font-size:13px">Cargando ítems…</div>';
    else if (!st.lineas.length) h += '<div style="color:#64748b;font-size:13px">Esta PI no tiene ítems en curso.</div>';
    else {
      let tA = 0, tN = 0;
      h += '<table class="ipe-tbl"><thead><tr><th>Código</th><th>Llegó<br>u</th><th>Actual<br>u</th><th>Nueva<br>u</th><th>Dif.<br>u</th></tr></thead><tbody>';
      st.lineas.forEach(function (l) {
        const a = Number(l.unidades) || 0, lleg = Math.max(0, a - (Number(l.pendiente) || 0));
        const tiene = l.bache_id in st.nuevos, n = tiene ? st.nuevos[l.bache_id] : a;
        tA += a; tN += n;
        h += '<tr id="ipeR' + l.bache_id + '"' + (n !== a ? ' class="cambia"' : '') + '><td class="cod" title="' + escapeHtml(artNombre(l.cod_art, l.descripcion) || "") + '">' + escapeHtml(codCanon(l.cod_art)) + (l.marca ? '<small>' + escapeHtml(l.marca) + '</small>' : '') + '</td>' +
          '<td>' + (lleg ? _impPiEdNum(lleg) : '—') + '</td>' +
          '<td>' + _impPiEdNum(a) + '</td>' +
          '<td><input class="ipe-in" type="number" inputmode="numeric" min="' + lleg + '" step="1" value="' + (tiene ? n : "") + '" placeholder="' + a + '" oninput="impPiEdSetCant(' + l.bache_id + ',this.value)"></td>' +
          '<td id="ipeD' + l.bache_id + '">' + _impPiEdDelta(n - a) + '</td></tr>';
      });
      h += '<tr class="tot"><td>Total</td><td></td><td>' + _impPiEdNum(tA) + '</td><td id="ipeTotN">' + _impPiEdNum(tN) + '</td><td id="ipeTotD">' + _impPiEdDelta(tN - tA) + '</td></tr></tbody></table>';
      h += '<div style="font-size:11.5px;color:#64748b;margin-top:6px">Vacío = queda igual · 0 = sale de la PI · no puede quedar por debajo de lo que ya llegó.</div>';
    }
    h += msg + '<div class="ipe-foot"><button class="ipe-b" onclick="impPiEdCerrar()">Cancelar</button>' +
      '<button class="ipe-b pri" ' + (st.guardando || !st.lineas ? 'disabled' : '') + ' onclick="impPiEdRevisar()">' + (st.guardando ? 'Revisando…' : 'Ver cambios →') + '</button></div>';
    h += _impPiEdHistHtml();
  } else if (st.paso === "revisar") {
    const p = st.preview || {};
    h += '<div class="ipe-q">Esto es lo que cambia</div>';
    h += '<div class="ipe-quien">Corrige <b>' + escapeHtml(p.editor || st.editor) + '</b>' + (p.editor_nuevo ? ' <span style="font-size:11.5px;color:#b45309;font-weight:800">(queda como editor nuevo)</span>' : '') + '</div>';
    if (p.ref_nuevo) h += '<div class="ipe-msg info">N° de PI: <b>' + escapeHtml(p.pedido_ref) + '</b> → <b>' + escapeHtml(p.ref_nuevo) + '</b></div>';
    if ((p.filas || []).length) h += '<div style="margin-top:8px">' + _impPiEdTablaDiff(p) + '</div>';
    h += msg + '<div class="ipe-foot"><button class="ipe-b" onclick="impPiEdVolver()">← Volver</button>' +
      '<button class="ipe-b ok" ' + (st.guardando ? 'disabled' : '') + ' onclick="impPiEdGuardar()">' + (st.guardando ? 'Guardando…' : '✔ Guardar') + '</button></div>';
  } else if (st.paso === "listo") {
    const g = st.guardado || {};
    h += '<div class="ipe-msg ok" style="font-size:14px">✔ Guardado · <b>' + escapeHtml(g.editor || st.editor) + '</b> · ' + escapeHtml(_impPiEdFecha(g.ts)) + '</div>';
    if (g.ref_nuevo) h += '<div class="ipe-msg info">N° de PI: <b>' + escapeHtml(g.pedido_ref) + '</b> → <b>' + escapeHtml(g.ref_nuevo) + '</b></div>';
    if ((g.filas || []).length) h += '<div style="margin-top:8px">' + _impPiEdTablaDiff(g) + '</div>';
    h += '<div class="ipe-foot"><button class="ipe-b pri" onclick="impPiEdCerrar()">Listo</button></div>';
  }
  ov.innerHTML = h + '</div></div>';
  if (st.paso === "quien" && st.editores) { const i = document.getElementById("impPiEdOtroIn"); if (i && !i.value && st.msgTipo === "err") try { i.focus(); } catch (_e) {} }
}
