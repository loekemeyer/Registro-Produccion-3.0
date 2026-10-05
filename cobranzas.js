/* ============================================================================
   SUBMÓDULO COBRANZAS — front (v23.96, pedido de Luis 29/09)
   ----------------------------------------------------------------------------
   Pantalla propia con pestañas internas. La primera es BUSCAR CLIENTE: se tipea
   nombre o código (LK o CH) y se abre la FICHA del cliente con la deuda
   CONSOLIDADA (los códigos de LK y de Chef del mismo cliente suman juntos).

   ⚠ POR QUÉ VIVE EN SU PROPIO ARCHIVO Y NO EN index.html
   El index ya va por 63.000 líneas y 5 MB, tiene un byte NUL adentro (separador
   de _pppGeoCod) y lo editan varias sesiones a la vez. Este módulo va a crecer
   (Luis: "empezando con la de búsqueda de clientes"), así que arranca afuera.
   Se carga con ?v= atado a APP_VERSION — está en SIGUEN_APP_VERSION de
   scripts/bump-version.cjs y tests/version-tokens.cjs.

   ⚠ UNA SOLA PANTALLA CON LA VIEJA (v26.04, 02/10)
   «Deuda a cobrar / Cobranzas» (openCobros, 7 pestañas) ya no tiene botón
   propio: sus pestañas viven ACÁ, después de las de este módulo (pedido:
   "las de Cobranzas son lo principal, agregale las del otro pero ponelas
   después"). Las marcadas `vieja: true` en _CBZ_TABS las sigue DIBUJANDO
   index.html (cobrosRenderTab) adentro de #cobrosBody; openCobros(tab) abre
   esta pantalla en esa pestaña. Se fueron los dos lugares vacíos «A reclamar»
   (eso es 🕵 Agente, que ahora está al lado) y «Recibos».

   ⚠ DATOS
   Lee lo que YA existe en la base (nada nuevo se creó para esto):
     · gv_cobranza_clientes()            → lista con deuda, vencida, a reclamar
     · gv_cobranza_cliente(emp, cod)     → comprobante por comprobante + el pago
     · gv_cobranza_cuenta(emp, cod)      → cuenta corriente (debe/haber/saldo)
     · gv_cobranza_clientes_cuit()       → (empresa, código) → CUIT, para consolidar
     · cobranzas_escalones               → la escala 25/20/15/10/5 de la planilla
   Si la base no contesta (sesión sin supervisor, o mirando el front suelto),
   cae a datos DEMO y lo dice con un chip rojo arriba: un cero no puede
   confundirse con "no pude leer" (regla "una lectura ROTA no es un CERO").
   ============================================================================ */

var _cbz = {
  tab: "clientes",
  q: "",
  empresa: "",          // "" | "lk" | "chef"
  rows: [],             // clientes crudos (una fila por empresa+código)
  grupos: [],           // clientes consolidados (LK + CH del mismo cliente)
  cargando: false,
  demo: false,
  error: null,
  sel: null,            // clave del grupo abierto
  sub: "resumen",       // "resumen" | "deuda" | "pagos" | "comp" | "entregas" | "cta"
  comp: null,           // comprobantes de la ficha
  cta: null,            // cuenta corriente de la ficha
  abierta: null,        // fila de comprobante desplegada
  escalones: null,
  cc: { vista: "bancos", cuenta: "credicoop|lk", movs: null, cargando: false, err: null, filtro: null, msg: "", abierto: null, wpp: {}, pend: null, pendFiltro: "todas" },
  pop: null,
  ops: null,
  opSel: null
};

/* ------------------------------ utilidades ------------------------------- */
function _cbzEsc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
function _cbzNum(v) { var n = Number(v); return isFinite(n) ? n : 0; }
/* coma decimal, punto de miles (regla del dueño) */
function _cbzPlata(v, dec) {
  var n = Number(v);
  if (!isFinite(n)) return "—";
  return n.toLocaleString("es-AR", { minimumFractionDigits: dec == null ? 0 : dec, maximumFractionDigits: dec == null ? 0 : dec });
}
function _cbzFecha(d) {
  if (!d) return "—";
  var s = String(d).slice(0, 10).split("-");
  return s.length === 3 ? s[2] + "/" + s[1] + "/" + s[0].slice(2) : String(d);
}
function _cbzEmpLabel(e) { return e === "chef" ? "CH" : "LK"; }
/* el nombre se normaliza para poder juntar el mismo cliente de las dos empresas:
   sin acentos, sin puntuación, sin las formas societarias, en mayúscula */
function _cbzNorm(s) {
  return String(s || "")
    .toUpperCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\b(S\s*R\s*L|SRL|S\s*A\s*S|SAS|S\s*A|SA|CIF|SOCIEDAD ANONIMA|Y CIA|E HIJOS)\b/g, " ")
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
async function _cbzRpc(fn, args) {
  try {
    if (typeof sb === "undefined" || !sb || !sb.rpc) return { error: "sin cliente Supabase" };
    var r = await sb.rpc(fn, args || {});
    if (r && r.error) return { error: r.error.message || String(r.error) };
    return { data: (r && r.data) || [] };
  } catch (e) { return { error: (e && e.message) || String(e) }; }
}

/* --------------------------------- CSS ----------------------------------- */
function _cbzCss() {
  if (document.getElementById("cbzCss")) return;
  var st = document.createElement("style");
  st.id = "cbzCss";
  st.textContent = [
    "#cbzOv{position:fixed;inset:0;z-index:9600;background:#f1f5f9;display:none;flex-direction:column;font-family:system-ui,Segoe UI,Arial,sans-serif;color:#0f172a;}",
    "#cbzOv *{box-sizing:border-box;}",
    /* ⚠ el index tiene un button{width:100%;padding:16px;font-size:22px;margin-top:14px} global
       (linea ~26): sin esto el boton Cerrar sale de una pantalla de ancho y las pestanas se
       parten en dos renglones. Se neutraliza por contenedor, como el pop-up de Importados (v23.93). */
    "#cbzOv button{width:auto;margin-top:0;padding:6px 13px;font-size:13px;line-height:1.25;}",
    "#cbzOv input{width:auto;margin-top:0;}",
    ".cbz-top{display:flex;align-items:center;gap:14px;padding:10px 16px;background:linear-gradient(90deg,#0f766e,#083344);color:#fff;flex:0 0 auto;flex-wrap:wrap;}",
    ".cbz-top b{font-size:17px;letter-spacing:.2px;}",
    ".cbz-tabs{display:flex;gap:4px;flex-wrap:wrap;align-items:center;}",
    ".cbz-tsep{width:1px;align-self:stretch;background:rgba(255,255,255,.35);margin:3px 5px;}",
    ".cbz-tab{padding:6px 13px;border-radius:999px;border:none;font-weight:700;font-size:13px;cursor:pointer;background:rgba(255,255,255,.14);color:#e2e8f0;}",
    ".cbz-tab:hover{background:rgba(255,255,255,.26);}",
    ".cbz-tab.on{background:#fff;color:#0f766e;}",
    ".cbz-x{margin-left:auto;background:#dc2626;color:#fff;border:none;border-radius:8px;padding:7px 16px;font-weight:800;cursor:pointer;}",
    ".cbz-body{flex:1;min-height:0;overflow:auto;padding:16px;}",
    ".cbz-wrap{max-width:1180px;margin:0 auto;}",
    /* v26.04: las pestañas viejas se diseñaron a todo el ancho (tablas de muchas columnas): sin tope */
    ".cbz-wrap.cbz-vieja{max-width:none;}",
    ".cbz-viejabody{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;box-shadow:0 1px 2px rgba(15,23,42,.06);}",
    /* buscador */
    ".cbz-buscar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:10px 12px;box-shadow:0 1px 2px rgba(15,23,42,.06);}",
    ".cbz-inp{flex:1;min-width:220px;border:1px solid #cbd5e1;border-radius:9px;padding:9px 12px;font-size:15px;outline:none;}",
    ".cbz-inp:focus{border-color:#0f766e;box-shadow:0 0 0 3px rgba(15,118,110,.14);}",
    ".cbz-seg{display:flex;border:1px solid #cbd5e1;border-radius:9px;overflow:hidden;}",
    ".cbz-seg button{border:none;background:#fff;color:#475569;font-weight:700;font-size:13px;padding:8px 13px;cursor:pointer;}",
    ".cbz-seg button.on{background:#0f766e;color:#fff;}",
    ".cbz-hint{color:#64748b;font-size:12px;margin:8px 2px 0;}",
    /* lista de resultados */
    ".cbz-lista{margin-top:12px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;}",
    ".cbz-row{display:grid;grid-template-columns:1fr auto auto auto;gap:14px;align-items:center;padding:10px 14px;border-bottom:1px solid #f1f5f9;cursor:pointer;}",
    ".cbz-row:last-child{border-bottom:none;}",
    ".cbz-row:hover{background:#f0fdfa;}",
    ".cbz-row .nom{font-weight:700;font-size:14px;}",
    ".cbz-row .sub{color:#64748b;font-size:11.5px;margin-top:1px;}",
    ".cbz-hrow{display:grid;grid-template-columns:1fr auto auto auto;gap:14px;padding:6px 14px;background:#f8fafc;border-bottom:1px solid #e2e8f0;color:#94a3b8;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;text-align:right;}",
    ".cbz-hrow>div{min-width:92px;}",".cbz-hrow>div:first-child{min-width:0;}",
    ".cbz-cel{text-align:right;font-variant-numeric:tabular-nums;font-size:13px;min-width:92px;}",
    ".cbz-cel .k{display:block;font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:.4px;}",
    ".cbz-vacio{padding:28px;text-align:center;color:#64748b;}",
    /* chips */
    ".cbz-chip{display:inline-block;font-size:10.5px;font-weight:800;border-radius:5px;padding:2px 6px;vertical-align:middle;}",
    ".cbz-lk{background:#e0f2fe;color:#075985;}",
    ".cbz-ch{background:#fef3c7;color:#92400e;}",
    ".cbz-warn{background:#fee2e2;color:#991b1b;}",
    ".cbz-ok{background:#dcfce7;color:#166534;}",
    ".cbz-info{background:#e0e7ff;color:#3730a3;}",
    /* ficha */
    ".cbz-ficha-top{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;box-shadow:0 1px 2px rgba(15,23,42,.06);}",
    ".cbz-back{background:#f1f5f9;border:1px solid #cbd5e1;border-radius:8px;padding:6px 11px;font-weight:700;font-size:13px;cursor:pointer;color:#334155;}",
    ".cbz-titulo{font-size:21px;font-weight:800;line-height:1.15;}",
    ".cbz-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(124px,1fr));gap:1px;background:#e2e8f0;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;margin-top:12px;}",
    ".cbz-kpi{background:#fff;padding:9px 11px;text-align:center;}",
    ".cbz-kpi .k{font-size:10px;color:#64748b;font-weight:800;text-transform:uppercase;letter-spacing:.5px;}",
    ".cbz-kpi .v{font-size:18px;font-weight:800;font-variant-numeric:tabular-nums;margin-top:2px;line-height:1.1;}",
    ".cbz-kpi .s{font-size:10.5px;color:#94a3b8;margin-top:1px;}",
    ".cbz-rojo{color:#b91c1c;}.cbz-ambar{color:#b45309;}.cbz-verde{color:#047857;}",
    ".cbz-desglose{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;}",
    ".cbz-dcard{flex:0 1 auto;border:1px solid #e2e8f0;border-radius:9px;padding:7px 12px;background:#f8fafc;font-size:12.5px;}",
    ".cbz-dcard b{font-variant-numeric:tabular-nums;}",
    /* sub-pestañas de la ficha */
    ".cbz-sub{display:flex;gap:4px;margin:14px 0 0;}",
    ".cbz-sub button{border:1px solid #cbd5e1;background:#fff;color:#475569;border-radius:8px;padding:7px 14px;font-weight:700;font-size:13px;cursor:pointer;}",
    ".cbz-sub button.on{background:#0f766e;border-color:#0f766e;color:#fff;}",
    ".cbz-panel{background:#fff;border:1px solid #e2e8f0;border-radius:12px;margin-top:10px;overflow:hidden;box-shadow:0 1px 2px rgba(15,23,42,.06);}",
    /* tablas: ancho segun el dato, sin relleno */
    ".cbz-t{border-collapse:collapse;font-size:13px;width:100%;}",
    ".cbz-t th{background:#f8fafc;color:#475569;font-size:10.5px;text-transform:uppercase;letter-spacing:.4px;padding:7px 9px;border-bottom:1px solid #e2e8f0;white-space:nowrap;text-align:center;}",
    ".cbz-t td{padding:6px 9px;border-bottom:1px solid #f1f5f9;white-space:nowrap;text-align:center;font-variant-numeric:tabular-nums;}",
    ".cbz-t td.l{text-align:left;}",
    ".cbz-t tbody tr:hover{background:#f0fdfa;}",
    ".cbz-t tr.cbz-clic{cursor:pointer;}",
    ".cbz-t tr.cbz-sel{background:#ecfeff;}",
    ".cbz-exp{background:#f8fafc;text-align:left !important;white-space:normal !important;color:#334155;font-size:12.5px;padding:10px 14px !important;}",
    /* escala de descuentos */
    ".cbz-escala{display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:1px;background:#e2e8f0;border:1px solid #e2e8f0;border-radius:9px;overflow:hidden;}",
    ".cbz-esc{background:#fff;padding:8px 10px;text-align:center;}",
    ".cbz-esc.on{background:#ecfdf5;box-shadow:inset 0 0 0 2px #059669;}",
    ".cbz-esc .k{font-size:11px;color:#475569;font-weight:700;}",
    ".cbz-esc .p{font-size:15px;font-weight:800;color:#0f766e;}",
    ".cbz-esc .v{font-size:12.5px;color:#64748b;font-variant-numeric:tabular-nums;}",
    ".cbz-nota{color:#64748b;font-size:12px;padding:10px 14px;border-top:1px solid #f1f5f9;}",
    ".cbz-concgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(238px,1fr));gap:10px;margin-top:12px;}",
    ".cbz-conccard{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:11px 13px;box-shadow:0 1px 2px rgba(15,23,42,.06);}",
    ".cbz-conccard .t{font-size:12.5px;font-weight:800;color:#334155;}",
    ".cbz-conccard .p{font-size:26px;font-weight:800;line-height:1.1;margin-top:2px;font-variant-numeric:tabular-nums;}",
    ".cbz-conccard .s{font-size:11.5px;color:#64748b;margin-top:1px;}",
    ".cbz-conccard .bar{height:5px;border-radius:99px;background:#e2e8f0;overflow:hidden;margin-top:6px;}",
    ".cbz-conccard .bar i{display:block;height:100%;}",
    ".cbz-pend{padding:34px 16px;text-align:center;color:#64748b;}",
    ".cbz-pend h3{margin:0 0 6px;color:#334155;font-size:16px;}",
    /* v24.41 — badge, tarjetas de banco, pop-up, planilla del cliente */
    ".cbz-badge{display:inline-block;min-width:18px;height:18px;padding:0 5px;border-radius:99px;background:#dc2626;color:#fff;font-size:11px;font-weight:800;line-height:18px;text-align:center;vertical-align:middle;}",
    ".cbz-badge-abs{position:absolute;top:8px;right:10px;}",
    ".cbz-bank{position:relative;text-align:left;cursor:pointer;font:inherit;color:inherit;}",
    ".cbz-bank:hover{border-color:#0f766e;box-shadow:0 2px 10px rgba(15,118,110,.18);}",
    ".cbz-bank-abrir{margin-top:8px;font-size:12px;font-weight:800;color:#0f766e;}",
    ".cbz-cargas{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:10px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:8px 10px;}",
    ".cbz-cargas-k{font-size:12px;font-weight:800;color:#334155;margin-right:4px;}",
    ".cbz-cargar-s{border:1px solid #0f766e;color:#0f766e;background:#f0fdfa;border-radius:7px;padding:4px 10px;font-weight:700;font-size:12px;cursor:pointer;}",
    ".cbz-cargar-s:hover{background:#ccfbf1;}",
    "#cbzPop{position:fixed;inset:0;z-index:9700;background:rgba(15,23,42,.45);display:none;align-items:flex-start;justify-content:center;padding:18px 12px;}",
    ".cbz-pop-card{background:#fff;border-radius:14px;box-shadow:0 12px 40px rgba(15,23,42,.35);width:min(1180px,100%);max-height:calc(100vh - 36px);display:flex;flex-direction:column;overflow:hidden;}",
    ".cbz-pop-head{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:10px 14px;border-bottom:1px solid #e2e8f0;background:#f8fafc;}",
    ".cbz-pop-head>div:first-child{flex:1;min-width:220px;}",
    ".cbz-pop-body{overflow:auto;flex:1;}",
    ".cbz-pop-body .cbz-t thead th{position:sticky;top:0;z-index:1;background:#f1f5f9;}",
    ".cbz-plt td{padding:4px 8px;font-size:12.5px;}",
    ".cbz-plt tr.cbz-proy td{color:#64748b;background:#fcfcfd;}",
    ".cbz-plt tr.cbz-conext td:first-child{box-shadow:inset 3px 0 0 #059669;}",
    ".cbz-linea td{background:#fde047 !important;color:#713f12 !important;font-weight:800;text-align:center;font-size:12px;}",
    ".cbz-resgrid{display:grid;grid-template-columns:230px minmax(0,1fr);gap:12px;padding:12px;align-items:start;}",
    "@media (max-width:760px){.cbz-resgrid{grid-template-columns:1fr;}}",
    ".cbz-oplist{display:flex;flex-direction:column;gap:5px;max-height:620px;overflow:auto;}",
    ".cbz-oph{font-size:10.5px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin:6px 2px 1px;}",
    ".cbz-opi{text-align:left;border:1px solid #e2e8f0;background:#fff;border-radius:9px;cursor:pointer;font:inherit;}",
    ".cbz-opi:hover{border-color:#94a3b8;}",
    ".cbz-opi.on{border-color:#0f766e;background:#f0fdfa;box-shadow:inset 3px 0 0 #0f766e;}",
    ".cbz-opi .a{font-weight:700;font-size:12.5px;}",
    ".cbz-opi .b{font-size:11.5px;color:#64748b;margin-top:1px;font-variant-numeric:tabular-nums;}",
    ".cbz-pl{border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;background:#fff;}",
    ".cbz-plhead{display:flex;gap:18px;align-items:flex-end;flex-wrap:wrap;border-bottom:2px solid #0f766e;padding-bottom:8px;}",
    ".cbz-plhead>button{margin-left:auto;}",
    ".cbz-plhead .k,.cbz-plk{font-size:10px;color:#64748b;font-weight:800;text-transform:uppercase;letter-spacing:.5px;}",
    ".cbz-plhead .n{font-size:17px;font-weight:800;}",
    ".cbz-plk{margin:10px 0 4px;}",
    ".cbz-plgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px;}",
    ".cbz-plx{border-collapse:collapse;width:100%;font-size:13px;font-variant-numeric:tabular-nums;}",
    ".cbz-plx th{font-size:10.5px;color:#475569;text-transform:uppercase;letter-spacing:.3px;border-bottom:1px solid #cbd5e1;padding:4px 6px;text-align:center;white-space:nowrap;}",
    ".cbz-plx td{border-bottom:1px solid #f1f5f9;padding:4px 6px;text-align:center;white-space:nowrap;}",
    ".cbz-plx tr.nc td{color:#3730a3;}",
    ".cbz-plesc tr.on td{background:#ecfdf5;font-weight:800;color:#065f46;box-shadow:inset 0 1px 0 #059669,inset 0 -1px 0 #059669;}",
    ".cbz-pltot{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:#e2e8f0;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;margin-top:12px;}",
    ".cbz-pltot>div{background:#f8fafc;padding:8px 10px;text-align:center;}",
    ".cbz-pltot .k{font-size:10px;color:#64748b;font-weight:800;text-transform:uppercase;letter-spacing:.4px;}",
    ".cbz-pltot .v{font-size:16px;font-weight:800;font-variant-numeric:tabular-nums;margin-top:2px;}",
    ".cbz-pltot .big .v{font-size:26px;color:#0f766e;}",
    "@media (max-width:620px){.cbz-pltot{grid-template-columns:repeat(2,1fr);}}",
    ".cbz-plres{border:1px solid #e2e8f0;border-radius:10px;padding:8px 12px;font-size:13px;}",
    ".cbz-plres .lin{display:flex;justify-content:space-between;gap:10px;padding:3px 0;}",
    ".cbz-plnc{margin:8px 0;padding:8px 10px;border-radius:9px;background:#eef2ff;border:1px solid #c7d2fe;text-align:center;}",
    ".cbz-plnc .t{font-weight:800;color:#3730a3;}",
    ".cbz-plnc .v{font-size:19px;font-weight:800;color:#3730a3;font-variant-numeric:tabular-nums;}",
    ".cbz-plfin{display:flex;justify-content:space-between;align-items:center;margin-top:8px;padding:8px 10px;border-radius:9px;font-size:15px;}",
    ".cbz-plfin b{font-size:18px;font-variant-numeric:tabular-nums;}",
    ".cbz-plfin.deuda{background:#fef9c3;color:#854d0e;}",
    ".cbz-plfin.favor{background:#e0f2fe;color:#075985;}",
    ".cbz-plfin.ok{background:#dcfce7;color:#166534;}",
    ".cbz-mini{font-size:10.5px;color:#94a3b8;}",
    "@media print{.cbz-noprint{display:none!important;}}",
    ".cbz-amb{background:#fef9c3;color:#854d0e;}",
    ".cbz-cargar{background:#0f766e;color:#fff;border-radius:8px;padding:7px 13px;font-weight:800;font-size:13px;cursor:pointer;}",
    ".cbz-ccmsg{margin-top:8px;padding:8px 12px;border-radius:9px;background:#ecfdf5;color:#065f46;font-size:13px;border:1px solid #a7f3d0;}",
    ".cbz-ccmsg.err{background:#fef2f2;color:#991b1b;border-color:#fecaca;}",
    ".cbz-ccest{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;align-items:center;}",
    ".cbz-ccest button{border:1px solid #cbd5e1;background:#fff;color:#334155;border-radius:999px;font-weight:700;cursor:pointer;}",
    ".cbz-ccest button.on{background:#0f766e;border-color:#0f766e;color:#fff;}",
    ".cbz-conf{background:#059669 !important;border:none !important;color:#fff !important;border-radius:8px !important;font-weight:800;cursor:pointer;}",
    ".cbz-qlist{display:grid;gap:10px;margin-top:10px;}",
    ".cbz-q{background:#fff;border:1px solid #fecaca;border-left:4px solid #dc2626;border-radius:10px;padding:10px 12px;}",
    ".cbz-q.prop{border-color:#fde68a;border-left-color:#d97706;}",
    ".cbz-qhead{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;}",
    ".cbz-qimp{font-size:18px;font-weight:800;font-variant-numeric:tabular-nums;}",
    ".cbz-qtxt{font-size:12.5px;color:#334155;margin-top:3px;word-break:break-word;}",
    ".cbz-qsub{font-size:12px;color:#64748b;margin-top:3px;}",
    ".cbz-qal{font-size:12px;color:#b45309;margin-top:3px;font-weight:600;}",
    ".cbz-qt{margin-top:8px;width:auto;}",
    ".cbz-es{background:#0f766e;color:#fff;border:none;border-radius:7px;font-weight:800;cursor:pointer;padding:4px 10px !important;}",
    ".cbz-qacc{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:8px;}"
  ].join("\n");
  document.head.appendChild(st);
}

/* ------------------------------- pantalla -------------------------------- */
var _CBZ_TABS = [
  { id: "clientes",   t: "👤 Clientes" },
  { id: "conc",       t: "🏦 Conciliación" },
  { id: "escalones",  t: "📐 Escala" },
  /* v26.04: las de la pantalla vieja «Deuda a cobrar / Cobranzas», DESPUÉS. Las dibuja index.html
     (cobrosRenderTab); el id es el mismo que usa openCobros(tab), así Facturación sigue abriendo 'cruce'. */
  { id: "cc",         t: "📒 Cuenta corriente",   vieja: true },
  { id: "deuda",      t: "🗂 Facturas ISIS",      vieja: true },
  { id: "cob",        t: "💵 Valor por NP",       vieja: true },
  { id: "cruce",      t: "🔍 Facturación vs ISIS", vieja: true },
  { id: "anticipado", t: "📦 Facturable ya",      vieja: true },
  { id: "agente",     t: "🕵 Agente",             vieja: true },
  { id: "banco",      t: "🏦 Bancos",             vieja: true }
];
function _cbzTabOk(id) { return _CBZ_TABS.some(function (x) { return x.id === id; }); }
function _cbzEsVieja(id) { return _CBZ_TABS.some(function (x) { return x.id === id && x.vieja; }); }

async function openCobranzas(tab) {
  try { if (typeof requireSupervisor === "function" && !requireSupervisor()) return; } catch (_e) {}
  _cbzCss();
  var ov = document.getElementById("cbzOv");
  if (!ov) { ov = document.createElement("div"); ov.id = "cbzOv"; document.body.appendChild(ov); }
  ov.style.display = "flex";
  ov.innerHTML =
    '<div class="cbz-top">' +
      '<b>💳 Cobranzas</b>' +
      '<div class="cbz-tabs" id="cbzTabs"></div>' +
      '<button class="cbz-x" onclick="cbzClose()">Cerrar</button>' +
    '</div>' +
    '<div class="cbz-body"><div class="cbz-wrap" id="cbzWrap"></div></div>';
  _cbz.tab = _cbzTabOk(tab) ? tab : "clientes";
  _cbz.sel = null; _cbz.abierta = null;
  cbzRender();
  if (!_cbz.rows.length) cbzCargarClientes();
  if (!_cbz.conc && !_cbz.concCargando) cbzConcTablero();   // para el badge, aunque se abra en Clientes
}
function cbzClose() { var ov = document.getElementById("cbzOv"); if (ov) ov.style.display = "none"; }
/* v24.41 (Luis): cambiar de pestaña NO cierra el cliente abierto: al volver a «Clientes» sigue ahí */
function cbzSetTab(t) { _cbz.tab = _cbzTabOk(t) ? t : "clientes"; cbzRender(); if (t === "escalones") { cbzCargarEscalones(); cbzCargarCoronitas(); } }

/* el badge rojo de «Conciliación» = movimientos del extracto que esperan a una persona (v24.41) */
function cbzTabsPintar() {
  var tabs = document.getElementById("cbzTabs"); if (!tabs) return;
  var n = (typeof cbzConcPendN === "function") ? cbzConcPendN() : 0;
  tabs.innerHTML = _CBZ_TABS.map(function (x, i) {
    // una rayita separa las de este módulo de las de la pantalla vieja (v26.04)
    var sep = (x.vieja && !(_CBZ_TABS[i - 1] || {}).vieja) ? '<span class="cbz-tsep"></span>' : "";
    return sep + '<button class="cbz-tab' + (_cbz.tab === x.id ? " on" : "") + '" data-tab="' + x.id + '" onclick="cbzSetTab(\'' + x.id + '\')">' + x.t +
      (x.id === "conc" && n ? ' <span class="cbz-badge" id="cbzConcBadge">' + n + "</span>" : "") + "</button>";
  }).join("");
}
function cbzRender() {
  cbzTabsPintar();
  var w = document.getElementById("cbzWrap"); if (!w) return;
  if (_cbzEsVieja(_cbz.tab)) { cbzViejaPintar(w); return; }
  w.classList.remove("cbz-vieja"); _cbz.viejaTab = null;
  if (_cbz.tab === "clientes")  { w.innerHTML = _cbz.sel ? cbzFichaHtml() : cbzBuscadorHtml(); if (_cbz.sel) cbzFichaCargar(); return; }
  if (_cbz.tab === "conc")      { w.innerHTML = cbzConcHtml(); cbzConcCargar(); return; }
  if (_cbz.tab === "escalones") { w.innerHTML = cbzEscalonesHtml(); return; }
}

/* Pestaña de la pantalla vieja (v26.04). ⚠ Si ya está dibujada NO se rehace: cbzCargarClientes y otros
   llaman a cbzRender cuando terminan de leer, y rehacerla le borraría al supervisor los filtros que
   puso y volvería a pedir todo a la base. Se rehace al entrar de otra pestaña o al reabrir la pantalla. */
function cbzViejaPintar(w) {
  w.classList.add("cbz-vieja");
  if (_cbz.viejaTab === _cbz.tab && document.getElementById("cobrosBody")) return;
  _cbz.viejaTab = _cbz.tab;
  w.innerHTML = '<div id="cobrosBody" class="cbz-viejabody"></div>';
  if (typeof window.cobrosRenderTab === "function") { window.cobrosRenderTab(_cbz.tab); return; }
  document.getElementById("cobrosBody").innerHTML = '<div class="cbz-pend"><h3>No se pudo dibujar esta pestaña</h3>' +
    '<div>Falta la parte que vive en index.html. Recargá la página (Ctrl+F5).</div></div>';
}

/* ----------------------------- 1) buscador ------------------------------- */
function cbzBuscadorHtml() {
  var h = '<div class="cbz-buscar">' +
      '<input id="cbzQ" class="cbz-inp" placeholder="Buscar por nombre, código (LK o CH) o CUIT…" value="' + _cbzEsc(_cbz.q) + '" ' +
        'oninput="cbzBuscar(this.value)" autocomplete="off">' +
      '<div class="cbz-seg">' +
        '<button class="' + (_cbz.empresa === "" ? "on" : "") + '" onclick="cbzEmpresa(\'\')">Las dos</button>' +
        '<button class="' + (_cbz.empresa === "lk" ? "on" : "") + '" onclick="cbzEmpresa(\'lk\')">LK</button>' +
        '<button class="' + (_cbz.empresa === "chef" ? "on" : "") + '" onclick="cbzEmpresa(\'chef\')">Chef</button>' +
      '</div>' +
      '<button class="cbz-back" onclick="cbzCargarClientes()">↻ Actualizar</button>' +
    '</div>';
  h += '<div class="cbz-hint">' +
    (_cbz.demo ? '<span class="cbz-chip cbz-warn">DEMO — no pude leer la base, estos números son de ejemplo</span> ' : "") +
    (_cbz.error ? '<span class="cbz-chip cbz-warn">' + _cbzEsc(_cbz.error) + '</span> ' : "") +
    'Un cliente con código en LK y en Chef aparece <b>una sola vez</b>, con la deuda consolidada. La identidad la da el <b>CUIT</b>, no el código ni el nombre.</div>';
  h += '<div class="cbz-lista" id="cbzLista">' + cbzListaHtml() + '</div>';
  return h;
}
function cbzEmpresa(e) { _cbz.empresa = e; cbzRender(); setTimeout(function () { var i = document.getElementById("cbzQ"); if (i) i.focus(); }, 0); }
function cbzBuscar(v) {
  _cbz.q = v || "";
  var l = document.getElementById("cbzLista");
  if (l) l.innerHTML = cbzListaHtml();
}
function cbzFiltrados() {
  var q = _cbzNorm(_cbz.q), qraw = String(_cbz.q || "").trim().toLowerCase();
  return _cbz.grupos.filter(function (g) {
    if (_cbz.empresa && !g.cods.some(function (c) { return c.empresa === _cbz.empresa; })) return false;
    if (!qraw) return true;
    if (_cbzNorm(g.nombre).indexOf(q) >= 0) return true;
    var soloNum = qraw.replace(/\D/g, "");
    if (soloNum.length >= 8 && g.cuit && g.cuit.indexOf(soloNum) >= 0) return true;   // por CUIT
    return g.cods.some(function (c) {
      return String(c.cod_cliente).toLowerCase() === qraw ||
             (_cbzEmpLabel(c.empresa) + " " + c.cod_cliente).toLowerCase().indexOf(qraw) >= 0 ||
             _cbzNorm(c.cliente).indexOf(q) >= 0;   // el nombre largo de ISIS también busca
    });
  }).sort(function (a, b) { return b.deuda - a.deuda; });   // por dinero, mayor → menor
}
function cbzListaHtml() {
  if (_cbz.cargando) return '<div class="cbz-vacio">Cargando clientes…</div>';
  var rows = cbzFiltrados();
  if (!rows.length) return '<div class="cbz-vacio">' + (_cbz.q ? 'Ningún cliente con “' + _cbzEsc(_cbz.q) + '”.' : "Sin clientes.") + "</div>";
  var top = rows.slice(0, 80);
  /* el rotulo va UNA vez arriba, no repetido en cada renglon (regla: no repetir) */
  var h = '<div class="cbz-hrow"><div></div><div>Deuda</div><div>Vencida</div><div>A reclamar</div></div>';
  h += top.map(function (g) {
    return '<div class="cbz-row" onclick="cbzAbrir(\'' + _cbzEsc(g.key) + '\')">' +
      '<div><div class="nom">' + _cbzEsc(g.nombre) +
        (g.cods.length > 1 ? ' <span class="cbz-chip cbz-info">LK+CH</span>' : "") +
        (g.agente ? ' <span class="cbz-chip cbz-info" title="Agente de recaudación IIBB">agente</span>' : "") +
        '</div><div class="sub">' + g.cods.map(function (c) {
          return '<span class="cbz-chip ' + (c.empresa === "chef" ? "cbz-ch" : "cbz-lk") + '">' + _cbzEmpLabel(c.empresa) + " " + _cbzEsc(c.cod_cliente) + "</span>";
        }).join(" ") + "</div></div>" +
      '<div class="cbz-cel">' + (g.deuda ? "$ " + _cbzPlata(g.deuda) : "—") + "</div>" +
      '<div class="cbz-cel cbz-rojo">' + (g.vencida ? "$ " + _cbzPlata(g.vencida) : "—") + "</div>" +
      '<div class="cbz-cel cbz-ambar">' + (g.reclamar ? "$ " + _cbzPlata(g.reclamar) : "—") + "</div>" +
    "</div>";
  }).join("");
  if (rows.length > top.length) h += '<div class="cbz-vacio">… y ' + (rows.length - top.length) + " más. Afiná la búsqueda.</div>";
  return h;
}

/* ------------------------- carga + consolidación -------------------------- */
async function cbzCargarClientes() {
  _cbz.cargando = true; _cbz.error = null; cbzRender();
  var rr = await Promise.all([_cbzRpc("gv_cobranza_clientes"), _cbzRpc("gv_cobranza_clientes_cuit")]);
  var r = rr[0], rc = rr[1];
  if (r.error || !r.data || !r.data.length) {
    _cbz.demo = true;
    _cbz.error = r.error ? "No pude leer la base (" + r.error + ") — mostrando datos de ejemplo" : null;
    _cbz.rows = _CBZ_DEMO_CLIENTES.slice();
  } else { _cbz.demo = false; _cbz.rows = r.data; }
  var cuits = {};
  if (!rc.error) (rc.data || []).forEach(function (x) { if (x.cuit) cuits[x.empresa + "|" + x.cod_cliente] = String(x.cuit); });
  if (_cbz.demo) _cbz.rows.forEach(function (x) { if (x.cuit) cuits[x.empresa + "|" + x.cod_cliente] = String(x.cuit); });
  _cbz.cuits = cuits;
  _cbz.grupos = cbzConsolidar(_cbz.rows, cuits);
  _cbz.cargando = false;
  cbzRender();
}
/* Junta los códigos del MISMO cliente de las dos empresas.
   ⚠ LA CLAVE ES EL CUIT, nunca el código ("el cod cliente no significa nada,
   sólo el CUIT vale", v13.76) y tampoco la razón social: ISIS le pega el sufijo
   de la sucursal, así que "Bazar Monica S. CAP I SECC IV" (LK) y "Bazar Monica
   SRL" (CH) son el mismo cliente escrito de dos formas — agrupar por nombre lo
   parte en dos, y dos nombres parecidos de clientes distintos los fusiona.
   Sin CUIT el código va SOLO: no se adivina. Medido el 29/09: 69 CUIT tienen
   código en las dos empresas. */
function cbzConsolidar(rows, cuits) {
  var map = {};
  (rows || []).forEach(function (r) {
    var ck = (cuits || {})[r.empresa + "|" + r.cod_cliente] || (r.cuit ? String(r.cuit) : "");
    var k = ck ? "cuit:" + ck : (r.empresa + "|" + r.cod_cliente);
    var g = map[k];
    if (!g) g = map[k] = { key: k, cuit: ck, nombre: r.cliente || "(sin nombre)", cods: [], deuda: 0, vencida: 0, reclamar: 0, abiertos: 0, dias: 0, agente: false, ultimo: null, ultimoMonto: 0, ancla: null };
    g.cods.push(r);
    g.deuda    += Math.max(0, _cbzNum(r.deuda));
    g.vencida  += _cbzNum(r.vencida);
    g.reclamar += _cbzNum(r.a_reclamar);
    g.abiertos += _cbzNum(r.comprobantes_abiertos);
    g.dias      = Math.max(g.dias, _cbzNum(r.dias_mas_vieja));
    if (r.agente_retencion) g.agente = true;
    if (r.ultimo_pago && (!g.ultimo || r.ultimo_pago > g.ultimo)) { g.ultimo = r.ultimo_pago; g.ultimoMonto = _cbzNum(r.ultimo_pago_monto); }
    if (r.ancla && (!g.ancla || r.ancla > g.ancla)) g.ancla = r.ancla;
    /* de los dos nombres del mismo CUIT se muestra el MÁS CORTO: el largo suele ser
       el de ISIS con el sufijo de la sucursal pegado ("… CAP I SECC IV"). Los dos
       quedan buscables igual (cbzFiltrados mira todos los códigos del grupo). */
    if (r.cliente && r.cliente.length < (g.nombre || "").length) g.nombre = r.cliente;
  });
  return Object.keys(map).map(function (k) { return map[k]; });
}

/* ------------------------------ 2) la ficha ------------------------------
   La ficha se arma con UNA llamada por código: `gv_cobranza_ficha(emp, cod)`,
   que junta las tres fuentes que ya existían y no se hablaban entre sí:

     · DEUDA    → GV_Cobranza_Deuda_Viva = el Excel de deuda que se sube para la
                  Cuarentena (el ancla) + las facturas y NC nuevas de ISIS + lo
                  que la conciliación bancaria ya vio cobrado.
     · PAGOS    → GV_Cobranza_Imputacion = cada recibo del banco cruzado contra
                  las facturas que cancela, con el descuento tomado vs el ganado.
     · ENTREGAS → Facturacion_NP = lo que Gestión facturó (NP, tanda, m³, salida).

   Un grupo con código en LK y en Chef pide las dos y se suman: los totales de la
   cabecera salen de acá, no de la lista. */
function cbzAbrir(key) { _cbz.sel = key; _cbz.sub = "resumen"; _cbz.ficha = null; _cbz.comp = null; _cbz.cta = null; _cbz.ops = null; _cbz.opSel = null; _cbz.abierta = null; cbzRender(); }
function cbzVolver() { _cbz.sel = null; _cbz.ficha = null; _cbz.comp = null; _cbz.cta = null; _cbz.ops = null; _cbz.opSel = null; cbzRender(); }
function cbzSub(s) { _cbz.sub = s; cbzRender(); }
function cbzGrupo() { var k = _cbz.sel; return _cbz.grupos.filter(function (g) { return g.key === k; })[0] || null; }

var _CBZ_SUBS = [
  { id: "resumen",  t: "📋 Resumen" },
  { id: "deuda",    t: "💳 Deuda" },
  { id: "pagos",    t: "🧾 Pagos y descuentos" },
  { id: "comp",     t: "📄 Explicación" },
  { id: "entregas", t: "🚚 Entregas facturadas" },
  { id: "cta",      t: "📒 Cuenta corriente" }
];

function cbzFichaHtml() {
  var g = cbzGrupo();
  if (!g) return '<div class="cbz-vacio">Cliente no encontrado. <button class="cbz-back" onclick="cbzVolver()">← Volver</button></div>';
  var f = _cbz.ficha;
  var ret = g.cods.reduce(function (m, c) { return Math.max(m, _cbzNum(c.ret_cliente)); }, 0);
  /* los totales los manda la ficha (deuda viva de HOY); la lista es el respaldo
     mientras carga, o si la RPC no contesta */
  var deuda = f ? f.tot.deuda : g.deuda, vencida = f ? f.tot.vencida : g.vencida;
  var abiertos = f ? f.tot.comprobantes : g.abiertos, dias = f ? f.tot.dias : g.dias;
  var cuit = (f && f.cab.cuit) || g.cuit;
  var loc = f && (f.cab.localidad || f.cab.provincia)
    ? [f.cab.localidad, f.cab.provincia].filter(Boolean).join(", ") : "";
  var h = '<div class="cbz-ficha-top">' +
    '<div style="display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap;">' +
      '<button class="cbz-back" onclick="cbzVolver()">← Clientes</button>' +
      '<div style="flex:1;min-width:220px;">' +
        '<div class="cbz-titulo">' + _cbzEsc(g.nombre) + "</div>" +
        '<div style="margin-top:5px;">' + g.cods.map(function (c) {
          return '<span class="cbz-chip ' + (c.empresa === "chef" ? "cbz-ch" : "cbz-lk") + '">' + _cbzEmpLabel(c.empresa) + " " + _cbzEsc(c.cod_cliente) + "</span>";
        }).join(" ") +
        (cuit ? ' <span class="cbz-chip" style="background:#f1f5f9;color:#475569;">CUIT ' + _cbzEsc(cuit) + "</span>" : ' <span class="cbz-chip cbz-warn" title="Sin CUIT no se puede consolidar con la otra empresa">sin CUIT</span>') +
        (loc ? ' <span class="cbz-chip" style="background:#f1f5f9;color:#475569;">' + _cbzEsc(loc) + "</span>" : "") +
        (g.agente ? ' <span class="cbz-chip cbz-info">agente de recaudación</span>' : "") +
        (ret ? ' <span class="cbz-chip cbz-info">retención ' + _cbzPlata(ret * 100, 1) + " %</span>" : "") +
        (_cbz.demo ? ' <span class="cbz-chip cbz-warn">DEMO</span>' : "") +
        "</div>" +
      "</div>" +
    "</div>" +
    '<div class="cbz-kpis">' +
      cbzKpi("Deuda total", "$ " + _cbzPlata(deuda), g.cods.length > 1 ? "consolidada LK + CH" : (f ? "deuda viva" : ""), "") +
      cbzKpi("Vencida", vencida ? "$ " + _cbzPlata(vencida) : "—", "", vencida ? "cbz-rojo" : "") +
      cbzKpi("Comprob.", _cbzPlata(abiertos), "abiertos", "") +
      cbzKpi("Más vieja", dias ? _cbzPlata(dias) : "—", "días", dias > 60 ? "cbz-rojo" : "") +
      cbzKpi("Último pago", g.ultimo ? "$ " + _cbzPlata(g.ultimoMonto) : "—", g.ultimo ? _cbzFecha(g.ultimo) : "", "cbz-verde") +
      cbzKpi("A reclamar", g.reclamar ? "$ " + _cbzPlata(g.reclamar) : "—", "descuento mal tomado", g.reclamar ? "cbz-ambar" : "") +
    "</div>";
  if (g.cods.length > 1) {
    h += '<div class="cbz-desglose">' + g.cods.map(function (c) {
      var d = f && f.porCod[c.empresa + "|" + c.cod_cliente];
      var dd = d ? _cbzNum(d.totales && d.totales.deuda) : Math.max(0, _cbzNum(c.deuda));
      var vv = d ? _cbzNum(d.totales && d.totales.vencida) : _cbzNum(c.vencida);
      return '<div class="cbz-dcard"><span class="cbz-chip ' + (c.empresa === "chef" ? "cbz-ch" : "cbz-lk") + '">' + _cbzEmpLabel(c.empresa) + " " + _cbzEsc(c.cod_cliente) + "</span> " +
        "deuda <b>$ " + _cbzPlata(dd) + "</b>" +
        (vv ? ' · vencida <b class="cbz-rojo">$ ' + _cbzPlata(vv) + "</b>" : "") +
        (_cbzNum(c.a_reclamar) ? ' · reclamar <b class="cbz-ambar">$ ' + _cbzPlata(c.a_reclamar) + "</b>" : "") + "</div>";
    }).join("") + "</div>";
  }
  if (f && f.ancla) h += '<div class="cbz-hint" style="margin:8px 2px 0;">Deuda del Excel de Cuarentena del <b>' +
    _cbzEsc(new Date(f.ancla).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })) +
    "</b>, más las facturas y NC posteriores de ISIS, menos lo que la conciliación bancaria ya vio cobrado.</div>";
  h += "</div>";
  h += '<div class="cbz-sub">' + _CBZ_SUBS.map(function (s) {
    return '<button class="' + (_cbz.sub === s.id ? "on" : "") + '" onclick="cbzSub(\'' + s.id + '\')">' + s.t + "</button>";
  }).join("") + "</div>";
  h += '<div class="cbz-panel" id="cbzPanel"><div class="cbz-vacio">Cargando…</div></div>';
  return h;
}
function cbzKpi(k, v, s, cls) {
  return '<div class="cbz-kpi"><div class="k">' + _cbzEsc(k) + '</div><div class="v ' + (cls || "") + '">' + v + "</div>" +
    (s ? '<div class="s">' + _cbzEsc(s) + "</div>" : "") + "</div>";
}

/* trae la ficha (una llamada por código) y deja todo junto en _cbz.ficha */
async function cbzFichaTraer(g) {
  var rr = await Promise.all(g.cods.map(function (c) { return _cbzRpc("gv_cobranza_ficha", { p_emp: c.empresa, p_cod: c.cod_cliente }); }));
  var f = { porCod: {}, deuda: [], recibos: [], entregas: [], cab: {}, tot: { deuda: 0, vencida: 0, comprobantes: 0, dias: 0 }, ancla: null, err: null };
  rr.forEach(function (r, i) {
    var c = g.cods[i];
    if (r.error) { f.err = r.error; return; }
    var d = r.data;
    if (Array.isArray(d)) d = d[0];           // PostgREST devuelve el jsonb pelado o en array
    if (!d) return;
    f.porCod[c.empresa + "|" + c.cod_cliente] = d;
    var marcar = function (x) { x._emp = c.empresa; x._cod = c.cod_cliente; return x; };
    (d.deuda || []).forEach(function (x) { f.deuda.push(marcar(x)); });
    (d.recibos || []).forEach(function (x) { f.recibos.push(marcar(x)); });
    (d.entregas || []).forEach(function (x) { f.entregas.push(marcar(x)); });
    var t = d.totales || {};
    f.tot.deuda += _cbzNum(t.deuda); f.tot.vencida += _cbzNum(t.vencida);
    f.tot.comprobantes += _cbzNum(t.comprobantes);
    f.tot.dias = Math.max(f.tot.dias, _cbzNum(t.dias_mas_vieja));
    if (t.ancla && (!f.ancla || t.ancla > f.ancla)) f.ancla = t.ancla;
    var cab = d.cabecera || {};
    Object.keys(cab).forEach(function (k) { if (f.cab[k] == null && cab[k] != null) f.cab[k] = cab[k]; });
  });
  var pf = function (k) { return function (a, b) { return String(b[k] || "").localeCompare(String(a[k] || "")); }; };
  f.deuda.sort(pf("fecha")); f.recibos.sort(pf("fecha_pago")); f.entregas.sort(pf("facturado_at"));
  return f;
}

async function cbzFichaCargar() {
  var g = cbzGrupo(); if (!g) return;
  if (!_cbz.ficha) {
    var f = await cbzFichaTraer(g);
    if ((f.err || (!f.deuda.length && !f.recibos.length && !f.entregas.length)) && _cbz.demo) {
      f.deuda = _CBZ_DEMO_DEUDA.slice(); f.recibos = _CBZ_DEMO_PAGOS.slice(); f.entregas = _CBZ_DEMO_ENTREGAS.slice();
      f.tot = { deuda: g.deuda, vencida: g.vencida, comprobantes: g.abiertos, dias: g.dias };
    }
    _cbz.ficha = f;
    if (_cbz.sel === g.key) { var w = document.getElementById("cbzWrap"); if (w) w.innerHTML = cbzFichaHtml(); }
  }
  var pan = document.getElementById("cbzPanel"); if (!pan) return;
  if (_cbz.sub === "resumen") {
    if (!_cbz.ops) { var key = g.key; _cbz.ops = await cbzOpsTraer(g); if (_cbz.sel !== key) return; }
    pan = document.getElementById("cbzPanel"); if (pan && _cbz.sub === "resumen") pan.innerHTML = cbzResumenHtml();
    return;
  }
  if (_cbz.sub === "deuda")    { pan.innerHTML = cbzDeudaHtml(); return; }
  if (_cbz.sub === "pagos")    { pan.innerHTML = cbzPagosHtml(); return; }
  if (_cbz.sub === "entregas") { pan.innerHTML = cbzEntregasHtml(); return; }
  if (_cbz.sub === "comp") {
    if (_cbz.comp) { pan.innerHTML = cbzCompHtml(); return; }
    var rr = await Promise.all(g.cods.map(function (c) { return _cbzRpc("gv_cobranza_cliente", { p_emp: c.empresa, p_cod: c.cod_cliente }); }));
    var filas = [], err = null;
    rr.forEach(function (r, i) {
      if (r.error) { err = r.error; return; }
      (r.data || []).forEach(function (x) { x._emp = g.cods[i].empresa; x._cod = g.cods[i].cod_cliente; filas.push(x); });
    });
    if ((err || !filas.length) && _cbz.demo) filas = _CBZ_DEMO_COMP.slice();
    filas.sort(function (a, b) { return String(b.orden || b.fecha || "").localeCompare(String(a.orden || a.fecha || "")); });
    _cbz.comp = filas; _cbz.compErr = err;
    pan.innerHTML = cbzCompHtml();
    return;
  }
  if (_cbz.cta) { pan.innerHTML = cbzCtaHtml(); return; }
  var r2 = await Promise.all(g.cods.map(function (c) { return _cbzRpc("gv_cobranza_cuenta", { p_emp: c.empresa, p_cod: c.cod_cliente }); }));
  var mov = [], err2 = null;
  r2.forEach(function (r, i) {
    if (r.error) { err2 = r.error; return; }
    (r.data || []).forEach(function (x) { x._emp = g.cods[i].empresa; mov.push(x); });
  });
  if ((err2 || !mov.length) && _cbz.demo) mov = _CBZ_DEMO_CTA.slice();
  _cbz.cta = mov; _cbz.ctaErr = err2;
  pan.innerHTML = cbzCtaHtml();
}

/* ---- DEUDA (Excel de Cuarentena + ISIS − banco) -------------------------- */
function cbzDeudaHtml() {
  var f = _cbz.ficha; if (!f) return '<div class="cbz-vacio">Cargando…</div>';
  if (f.err && !f.deuda.length) return '<div class="cbz-vacio">No pude leer: ' + _cbzEsc(f.err) + "</div>";
  if (!f.deuda.length) return '<div class="cbz-vacio">Sin deuda abierta. 👌</div>';
  var multi = (cbzGrupo() || { cods: [] }).cods.length > 1;
  var h = '<table class="cbz-t"><thead><tr><th style="text-align:left;">Comprobante</th>' + (multi ? "<th>Emp</th>" : "") +
    "<th>Fecha</th><th>Vence</th><th>Días</th><th style='text-align:left;'>Condición</th>" +
    "<th>De lista</th><th>Del Excel</th><th>Cobrado banco</th><th>Pendiente</th><th>Origen</th></tr></thead><tbody>";
  h += f.deuda.map(function (r) {
    var venc = r.vencido;
    return '<tr' + (venc ? ' style="background:#fff7f7;"' : "") + '>' +
      '<td class="l"><b>' + _cbzEsc(r.comprobante || "") + "</b></td>" +
      (multi ? '<td><span class="cbz-chip ' + (r._emp === "chef" ? "cbz-ch" : "cbz-lk") + '">' + _cbzEmpLabel(r._emp) + "</span></td>" : "") +
      "<td>" + _cbzFecha(r.fecha) + "</td>" +
      '<td class="' + (venc ? "cbz-rojo" : "") + '">' + _cbzFecha(r.vence) + "</td>" +
      "<td>" + (r.dias != null ? r.dias : "—") + "</td>" +
      '<td class="l" style="color:#64748b;">' + _cbzEsc(r.condicion || "—") +
        (_cbzNum(r.dto_cond) ? " · −" + _cbzPlata(_cbzNum(r.dto_cond) * 100, 0) + " %" : "") + "</td>" +
      "<td>" + (r.lista != null ? _cbzPlata(r.lista) : "—") + "</td>" +
      "<td>" + (r.pendiente_ancla != null ? _cbzPlata(r.pendiente_ancla) : "—") + "</td>" +
      '<td class="cbz-verde">' + (_cbzNum(r.cancelado_banco) ? _cbzPlata(r.cancelado_banco) : "—") +
        (r.recibos_banco ? '<div style="font-size:10.5px;color:#94a3b8;">' + _cbzEsc(r.recibos_banco) + "</div>" : "") + "</td>" +
      '<td><b class="' + (venc ? "cbz-rojo" : "") + '">' + _cbzPlata(r.pendiente) + "</b></td>" +
      '<td><span class="cbz-chip ' + (String(r.origen || "").indexOf("isis") >= 0 ? "cbz-info" : "cbz-lk") + '">' + _cbzEsc(r.origen || "—") + "</span></td></tr>";
  }).join("");
  h += "</tbody></table>";
  h += '<div class="cbz-nota">«Del Excel» es lo que decía el archivo de deuda de la Cuarentena; «Cobrado banco» lo que la conciliación ' +
    "encontró después. La fila <b>isis nuevo</b> es una factura posterior al Excel, que el archivo todavía no tenía.</div>";
  return h;
}

/* ---- PAGOS: cada recibo del banco contra las facturas que cancela -------- */
/* «Ret.» NO es una retención medida: es lo que queda de la cuenta después del descuento y las NC,
   1 − pagado / esperado. Positivo = pagó de MENOS (retención de IIBB/Ganancias o un descuento sin
   registrar); negativo = pagó de MÁS. Por eso un e-cheq puede dar las dos (Luis, 29/09). */
function cbzRetHtml(r) {
  var x = _cbzNum(r.retencion);
  if (!x || Math.abs(x) < 0.0005) return "—";
  var rc = _cbzNum(r.ret_cliente) || ((cbzGrupo() || { cods: [] }).cods.reduce(function (m, c) { return Math.max(m, _cbzNum(c.ret_cliente)); }, 0));
  if (x < 0) return '<span class="cbz-chip cbz-info" title="Pagó más de lo que da la cuenta: no hay ND que lo explique">+' + _cbzPlata(-x * 100, 2) + " % de más</span>";
  return '<span title="Pagó menos de lo que da la cuenta: retención o descuento sin registrar' +
    (rc ? "" : ". Este cliente NO figura como agente de retención") + '">' + _cbzPlata(x * 100, 2) + " %" +
    (rc ? "" : ' <span class="cbz-rojo">?</span>') + "</span>";
}
function cbzPagosHtml() {
  var f = _cbz.ficha; if (!f) return '<div class="cbz-vacio">Cargando…</div>';
  if (f.err && !f.recibos.length) return '<div class="cbz-vacio">No pude leer: ' + _cbzEsc(f.err) + "</div>";
  if (!f.recibos.length) return '<div class="cbz-vacio">Sin pagos imputados.</div>';
  var multi = (cbzGrupo() || { cods: [] }).cods.length > 1;
  var h = '<table class="cbz-t"><thead><tr><th>Recibo</th>' + (multi ? "<th>Emp</th>" : "") +
    "<th>Fecha</th><th style='text-align:left;'>Medio</th><th>Pagado</th><th style='text-align:left;'>Facturas</th>" +
    "<th>De lista</th><th>Días</th><th>Dto tomado</th><th>Dto ganado</th><th title=\"1 − pagado ÷ lo que da la cuenta: + pagó de menos, − pagó de más\">Dif.</th><th>A reclamar</th><th>Calidad</th></tr></thead><tbody>";
  h += f.recibos.map(function (r) {
    var mal = _cbzNum(r.a_reclamar) > 0;
    var cal = String(r.calidad || "");
    var chip = cal === "exacta" ? "cbz-ok" : (cal.indexOf("sin imputar") >= 0 ? "cbz-warn" : "cbz-info");
    return "<tr>" +
      "<td><b>" + _cbzEsc(r.recibo || "—") + "</b></td>" +
      (multi ? '<td><span class="cbz-chip ' + (r._emp === "chef" ? "cbz-ch" : "cbz-lk") + '">' + _cbzEmpLabel(r._emp) + "</span></td>" : "") +
      "<td>" + _cbzFecha(r.fecha_pago) + "</td>" +
      '<td class="l" style="color:#64748b;">' + _cbzEsc(r.medio || "—") + "</td>" +
      '<td class="cbz-verde"><b>' + (r.pagado != null ? _cbzPlata(r.pagado) : "—") + "</b></td>" +
      '<td class="l">' + _cbzEsc(r.facturas || "—") + (r.nc ? ' <span class="cbz-chip cbz-info">NC ' + _cbzEsc(r.nc) + "</span>" : "") + "</td>" +
      "<td>" + (r.lista != null ? _cbzPlata(r.lista) : "—") + "</td>" +
      "<td>" + (r.dias != null ? r.dias : "—") +
        (r.atraso != null && _cbzNum(r.atraso) > 0 ? '<div style="font-size:10.5px;" class="cbz-rojo">+' + _cbzPlata(r.atraso) + "</div>" : "") + "</td>" +
      "<td>" + (r.dto_tomado != null ? _cbzPlata(_cbzNum(r.dto_tomado) * 100, 1) + " %" : "—") + "</td>" +
      "<td>" + (r.dto_ganado != null ? _cbzPlata(_cbzNum(r.dto_ganado) * 100, 1) + " %" : "—") + "</td>" +
      "<td>" + cbzRetHtml(r) + "</td>" +
      '<td class="cbz-ambar"><b>' + (mal ? _cbzPlata(r.a_reclamar) : "—") + "</b></td>" +
      '<td><span class="cbz-chip ' + chip + '">' + _cbzEsc(cal || "—") + "</span></td></tr>";
  }).join("");
  h += "</tbody></table>";
  h += '<div class="cbz-nota">Sale de la conciliación bancaria imputada: «Dto tomado» es lo que el cliente se descontó al pagar y ' +
    "«Dto ganado» lo que le correspondía por los días. La diferencia es lo que hay que reclamar. «Dif.» es lo que no cierra de la cuenta: " +
    "positiva = pagó de menos (retención o descuento sin registrar; con <span class=\"cbz-rojo\">?</span> si el cliente no figura como agente), " +
    "negativa = pagó de más. Un recibo que pagó varios juegos de facturas aparece en cada uno con el importe entero. <b>Sin imputar</b> = el pago entró " +
    "al banco pero todavía no se pudo cruzar contra una factura.</div>";
  return h;
}

/* ---- ENTREGAS facturadas por Gestión ------------------------------------ */
function cbzEntregasHtml() {
  var f = _cbz.ficha; if (!f) return '<div class="cbz-vacio">Cargando…</div>';
  if (!f.entregas.length) return '<div class="cbz-vacio">Sin entregas facturadas registradas en Gestión.</div>';
  var multi = (cbzGrupo() || { cods: [] }).cods.length > 1;
  var m3 = f.entregas.reduce(function (s, r) { return s + _cbzNum(r.m3); }, 0);
  var h = '<table class="cbz-t"><thead><tr><th>NP</th>' + (multi ? "<th>Emp</th>" : "") +
    "<th>Tanda</th><th>Salió</th><th>m³</th><th>Facturada</th></tr></thead><tbody>";
  h += f.entregas.map(function (r) {
    return "<tr><td><b>" + _cbzEsc(r.np || "") + "</b></td>" +
      (multi ? '<td><span class="cbz-chip ' + (r._emp === "chef" ? "cbz-ch" : "cbz-lk") + '">' + _cbzEmpLabel(r._emp) + "</span></td>" : "") +
      "<td>" + _cbzEsc(r.tanda || "—") + "</td><td>" + _cbzFecha(r.fecha_salida) + "</td>" +
      "<td>" + (r.m3 != null ? _cbzPlata(r.m3, 3) : "—") + "</td>" +
      "<td>" + _cbzFecha(r.facturado_at) + "</td></tr>";
  }).join("");
  h += "</tbody></table>";
  h += '<div class="cbz-nota">Las últimas ' + f.entregas.length + " entregas facturadas por Gestión · <b>" + _cbzPlata(m3, 3) + " m³</b> en total.</div>";
  return h;
}

/* ---- comprobantes: lo que la planilla de cobranza tiene arriba ---------- */
function cbzCompHtml() {
  var f = _cbz.comp || [];
  if (!f.length) return '<div class="cbz-vacio">' + (_cbz.compErr ? "No pude leer: " + _cbzEsc(_cbz.compErr) : "Sin comprobantes.") + "</div>";
  var multi = (cbzGrupo() || { cods: [] }).cods.length > 1;
  var h = '<table class="cbz-t"><thead><tr>' +
    "<th>Fecha</th>" + (multi ? "<th>Emp</th>" : "") + '<th style="text-align:left;">Comprobante</th>' +
    "<th>Facturado</th><th>Pendiente</th><th>Recibo</th><th>Pagado</th><th>Días</th>" +
    "<th>Dto tomado</th><th>Dto ganado</th><th>A reclamar</th><th>Estado</th></tr></thead><tbody>";
  h += f.map(function (r, i) {
    var mal = _cbzNum(r.a_reclamar) > 0, ab = _cbz.abierta === i;
    var est = String(r.estado || "");
    var chip = est === "debe" ? "cbz-lk" : (est === "mal" ? "cbz-warn" : (est.indexOf("suelto") >= 0 ? "cbz-info" : "cbz-ok"));
    var fila = '<tr class="cbz-clic' + (ab ? " cbz-sel" : "") + '" onclick="cbzFila(' + i + ')">' +
      "<td>" + _cbzFecha(r.fecha) + "</td>" +
      (multi ? '<td><span class="cbz-chip ' + (r._emp === "chef" ? "cbz-ch" : "cbz-lk") + '">' + _cbzEmpLabel(r._emp) + "</span></td>" : "") +
      '<td class="l">' + (r.comprobantes ? _cbzEsc(r.comprobantes) : '<i style="color:#94a3b8;">sin factura</i>') + "</td>" +
      "<td>" + (r.facturado != null ? _cbzPlata(r.facturado) : "—") + "</td>" +
      '<td class="' + (_cbzNum(r.pendiente) ? "cbz-rojo" : "") + '">' + (r.pendiente != null ? _cbzPlata(r.pendiente) : "—") + "</td>" +
      "<td>" + (r.pago_recibo ? _cbzEsc(r.pago_recibo) + '<div style="font-size:10.5px;color:#94a3b8;">' + _cbzFecha(r.pago_fecha) + "</div>" : "—") + "</td>" +
      '<td class="cbz-verde">' + (r.pago_monto != null ? _cbzPlata(r.pago_monto) : "—") + "</td>" +
      "<td>" + (r.dias != null ? r.dias : "—") + "</td>" +
      "<td>" + (r.dto_tomado != null ? _cbzPlata(_cbzNum(r.dto_tomado) * 100, 1) + " %" : "—") + "</td>" +
      "<td>" + (r.dto_ganado != null ? _cbzPlata(_cbzNum(r.dto_ganado) * 100, 1) + " %" : "—") + "</td>" +
      '<td class="cbz-ambar"><b>' + (mal ? _cbzPlata(r.a_reclamar) : "—") + "</b></td>" +
      '<td><span class="cbz-chip ' + chip + '">' + _cbzEsc(est || "—") + "</span></td></tr>";
    if (ab) {
      var cols = multi ? 12 : 11;
      fila += '<tr><td class="cbz-exp" colspan="' + cols + '">' +
        (r.explicacion ? _cbzEsc(r.explicacion) : "Sin explicación cargada.") +
        (r.facturado != null ? '<div style="margin-top:9px;">' + cbzEscalaHtml(_cbzNum(r.facturado), r.dias) + "</div>" : "") +
        "</td></tr>";
    }
    return fila;
  }).join("");
  h += "</tbody></table>";
  h += '<div class="cbz-nota">Tocá un renglón para ver la explicación del pago y qué descuento le correspondía según los días.</div>';
  return h;
}
function cbzFila(i) { _cbz.abierta = (_cbz.abierta === i) ? null : i; var p = document.getElementById("cbzPanel"); if (p) p.innerHTML = cbzCompHtml(); }

/* ---- cuenta corriente --------------------------------------------------- */
function cbzCtaHtml() {
  var m = _cbz.cta || [];
  if (!m.length) return '<div class="cbz-vacio">' + (_cbz.ctaErr ? "No pude leer: " + _cbzEsc(_cbz.ctaErr) : "Sin movimientos.") + "</div>";
  var multi = (cbzGrupo() || { cods: [] }).cods.length > 1;
  var h = '<table class="cbz-t"><thead><tr><th>Fecha</th>' + (multi ? "<th>Emp</th>" : "") +
    '<th>Tipo</th><th style="text-align:left;">Comprobante</th><th style="text-align:left;">Condición</th>' +
    "<th>Debe</th><th>Haber</th><th>Saldo</th><th style='text-align:left;'>Detalle</th></tr></thead><tbody>";
  h += m.map(function (r) {
    var t = String(r.tipo || "");
    return "<tr><td>" + _cbzFecha(r.fecha) + "</td>" +
      (multi ? '<td><span class="cbz-chip ' + (r._emp === "chef" ? "cbz-ch" : "cbz-lk") + '">' + _cbzEmpLabel(r._emp) + "</span></td>" : "") +
      '<td><span class="cbz-chip ' + (t === "Pago" ? "cbz-ok" : t === "NC" ? "cbz-info" : "cbz-lk") + '">' + _cbzEsc(t) + "</span></td>" +
      '<td class="l">' + _cbzEsc(r.comprobante || "") + "</td>" +
      '<td class="l" style="color:#64748b;">' + _cbzEsc(r.condicion || "—") + "</td>" +
      "<td>" + (_cbzNum(r.debe) ? _cbzPlata(r.debe) : "") + "</td>" +
      '<td class="cbz-verde">' + (_cbzNum(r.haber) ? _cbzPlata(r.haber) : "") + "</td>" +
      '<td><b class="' + (_cbzNum(r.saldo) > 0 ? "cbz-rojo" : "cbz-verde") + '">' + _cbzPlata(r.saldo) + "</b></td>" +
      '<td class="l" style="color:#64748b;">' + _cbzEsc(r.detalle || "") + "</td></tr>";
  }).join("");
  return h + "</tbody></table>";
}

/* ---- escala de descuentos (el bloque de abajo de la planilla) ----------- */
var _CBZ_ESC_FALLBACK = [
  { orden: 1, label: "Contado (0-14 días)", dias: 14, dto: 0.25 },
  { orden: 2, label: "15 a 30 días",        dias: 30, dto: 0.20 },
  { orden: 3, label: "31 a 45 días",        dias: 45, dto: 0.15 },
  { orden: 4, label: "46 a 60 días",        dias: 60, dto: 0.10 },
  { orden: 5, label: "E-cheq 90 días",      dias: 90, dto: 0.05 },
  { orden: 6, label: "E-cheq 120 días",     dias: 120, dto: 0.00 }
];
function cbzEscalones() { return (_cbz.escalones && _cbz.escalones.length) ? _cbz.escalones : _CBZ_ESC_FALLBACK; }
async function cbzCargarEscalones() {
  if (_cbz.escalones) return;
  try {
    if (typeof sb !== "undefined" && sb && sb.from) {
      var r = await sb.from("cobranzas_escalones").select("orden,escalon,dias,dto,label").order("orden");
      if (!r.error && r.data && r.data.length) _cbz.escalones = r.data.map(function (x) { return { orden: x.orden, label: x.label, dias: x.dias, dto: _cbzNum(x.dto) }; });
    }
  } catch (_e) {}
  if (_cbz.tab === "escalones") cbzRender();
  cbzCargarCoronitas();
}
/* ---- coronitas (v24.71, Luis) --------------------------------------------
   "Tener coronita" (Thomas) = trato preferencial de plazo: el cliente cobra el descuento de CONTADO
   (−25 %) aunque pague después de los 14 días, hasta su plazo propio (20, 30 o 60 días).
   Vive en cobranzas_excepciones (se cruza por CUIT); la lee el agente de cobranzas. Lectura propia,
   con su propio catch: si falla, la escala se sigue viendo y la lista lo DICE (no queda vacía). */
async function cbzCargarCoronitas() {
  if (_cbz.coronitas || _cbz.coronitasCargando) return;
  _cbz.coronitasCargando = true;
  try {
    var r = await sb.from("cobranzas_excepciones")
      .select("id,deudor_id,cod_cliente,escalon,dias,dto,vigente_desde,vigente_hasta,autorizado_por,motivo").limit(2000);
    if (r.error) throw r.error;
    _cbz.coronitas = (r.data || []).map(function (x) {
      var m = String(x.motivo || ""), mm = m.match(/:\s*(.+?)\s*·\s*(.+)$/);
      var nom = mm ? mm[1] : (m.match(/\(([^)]+)\)/) || [])[1] || "";
      return { cuit: x.deudor_id || "", cod: x.cod_cliente || "", nombre: nom || x.cod_cliente || "—",
               dias: _cbzNum(x.dias), dto: _cbzNum(x.dto), planilla: mm ? mm[2] : m,
               desde: x.vigente_desde, hasta: x.vigente_hasta, aut: x.autorizado_por || "" };
    }).sort(function (a, b) { return (b.dias - a.dias) || a.nombre.localeCompare(b.nombre, "es"); });
    _cbz.coronitasErr = null;
  } catch (e) { _cbz.coronitasErr = (e && e.message) || String(e); }
  _cbz.coronitasCargando = false;
  if (_cbz.tab === "escalones") cbzRender();
}
function cbzCoronitasFiltrar(v) {
  _cbz.coronitasQ = v || "";
  var b = document.getElementById("cbzCorBody"); if (b) b.innerHTML = _cbzCoronitasFilas();
}
function _cbzCoronitasFilas() {
  var q = String(_cbz.coronitasQ || "").toLowerCase().split(/\s+/).filter(Boolean);
  var rows = (_cbz.coronitas || []).filter(function (c) {
    var t = (c.nombre + " " + c.cod + " " + c.cuit).toLowerCase();
    return q.every(function (w) { return t.indexOf(w) >= 0; });
  });
  if (!rows.length) return '<tr><td colspan="6" style="color:#64748b;">Ningún cliente con coronita coincide.</td></tr>';
  return rows.map(function (c) {
    var fd = c.desde ? String(c.desde).slice(8, 10) + "/" + String(c.desde).slice(5, 7) + "/" + String(c.desde).slice(2, 4) : "—";
    return '<tr><td class="l"><b>' + _cbzEsc(c.nombre) + "</b></td><td>" + _cbzEsc(c.cod) + "</td><td>" + _cbzEsc(c.cuit || "—") +
      "</td><td><b>" + _cbzPlata(c.dias) + '</b></td><td class="cbz-verde"><b>−' + _cbzPlata(c.dto * 100, 0) + " %</b></td><td>" + fd +
      (c.hasta ? " → " + _cbzEsc(c.hasta) : "") + "</td></tr>";
  }).join("");
}
function cbzCoronitasHtml() {
  if (_cbz.coronitasErr) return '<div class="cbz-panel" style="margin-top:12px;"><div class="cbz-nota" style="color:#b91c1c;">👑 No se pudo leer la lista de coronitas (' + _cbzEsc(_cbz.coronitasErr) + "). No es que no haya.</div></div>";
  if (!_cbz.coronitas) return '<div class="cbz-panel" style="margin-top:12px;"><div class="cbz-nota">👑 Cargando coronitas…</div></div>';
  var cnt = {}; _cbz.coronitas.forEach(function (c) { cnt[c.dias] = (cnt[c.dias] || 0) + 1; });
  var res = Object.keys(cnt).map(Number).sort(function (a, b) { return b - a; })
    .map(function (d) { return "<b>" + cnt[d] + "</b> a " + d + " días"; }).join(" · ");
  return '<div class="cbz-panel" style="margin-top:12px;">' +
    '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:8px 10px;">' +
      '<b style="font-size:15px;">👑 Coronitas · ' + _cbz.coronitas.length + " clientes</b>" +
      '<span style="font-size:12.5px;color:#475569;">' + res + "</span>" +
      '<input id="cbzCorQ" placeholder="Buscar cliente, código o CUIT" value="' + _cbzEsc(_cbz.coronitasQ || "") +
        '" oninput="cbzCoronitasFiltrar(this.value)" style="margin-left:auto;padding:5px 8px;border:1px solid #cbd5e1;border-radius:7px;font-size:13px;width:240px;max-width:100%;box-sizing:border-box;">' +
    "</div>" +
    '<table class="cbz-t"><thead><tr><th style="text-align:left;">Cliente</th><th>Cód</th><th>CUIT</th><th>Contado<br>hasta (días)</th><th>Dto</th><th>Desde</th></tr></thead>' +
    '<tbody id="cbzCorBody">' + _cbzCoronitasFilas() + "</tbody></table>" +
    '<div class="cbz-nota">“Tener coronita” = cobra el descuento de <b>contado</b> aunque pague después de los 14 días, hasta su plazo. ' +
    'Vive en <code>cobranzas_excepciones</code> (autoriza Thomas) y se cruza por CUIT del padrón.</div></div>';
}
/* dias = en cuántos días se cobró; marca el escalón que le corresponde */
function cbzEscalaHtml(importe, dias) {
  var es = cbzEscalones(), d = (dias == null ? null : _cbzNum(dias));
  var gan = null;
  if (d != null) for (var i = 0; i < es.length; i++) { if (d <= es[i].dias) { gan = es[i].orden; break; } }
  var h = '<div class="cbz-escala">' + es.map(function (e) {
    return '<div class="cbz-esc' + (gan === e.orden ? " on" : "") + '">' +
      '<div class="k">' + _cbzEsc(e.label) + "</div>" +
      '<div class="p">−' + _cbzPlata(e.dto * 100, 0) + " %</div>" +
      '<div class="v">' + (importe ? "$ " + _cbzPlata(importe * e.dto) : "&nbsp;") + "</div></div>";
  }).join("") + "</div>";
  if (d != null) h += '<div style="font-size:12px;color:#64748b;margin-top:6px;">Cobrado a los <b>' + _cbzPlata(d) + " días</b> → le corresponde " +
    (gan ? "<b>" + _cbzEsc(es.filter(function (e) { return e.orden === gan; })[0].label) + "</b>" : "<b>ningún descuento</b>") + ".</div>";
  return h;
}
function cbzEscalonesHtml() {
  var es = cbzEscalones();
  return '<div class="cbz-panel"><table class="cbz-t"><thead><tr><th style="text-align:left;">Escalón</th><th>Hasta (días)</th><th>Descuento</th></tr></thead><tbody>' +
    es.map(function (e) {
      return '<tr><td class="l"><b>' + _cbzEsc(e.label) + "</b></td><td>" + _cbzPlata(e.dias) + '</td><td class="cbz-verde"><b>−' + _cbzPlata(e.dto * 100, 0) + " %</b></td></tr>";
    }).join("") +
    '</tbody></table><div class="cbz-nota">Vive en <code>cobranzas_escalones</code>: cambiarla es un <code>update</code>, no un deploy.</div></div>' +
    cbzCoronitasHtml();
}

/* ============================ RESUMEN (v24.41) ============================
   Luis: "el módulo del cliente abra en un RESUMEN que sea una ficha como esa (pero más linda)" — la
   planilla de cobranza: facturas · pagos con sus días y la ponderación · total · escala de descuentos
   · la NC de descuento y lo que queda a favor o en deuda.
   Una OPERACIÓN es un juego de facturas: las cobradas salen de la imputación de la conciliación
   (gv_cobranza_operaciones → pagadas) y las abiertas de la deuda viva, agrupadas por día de factura.
   La cuenta de la planilla es la del Excel: días ponderados por lo pagado, NC dto = facturado × %,
   saldo = facturado − NC ya emitidas − pagado. */
function _cbzCompDe(txt) {
  var p = String(txt || "").trim().split(/\s+/);
  return { comp: p[0] || "", nro: String(p[p.length - 1] || "").split("-").pop().replace(/^0+/, "") };
}
function _cbzTipoCorto(t) {
  var s = String(t || "").toUpperCase(), l = (/\b([ABCE])\s*$/.exec(s) || [])[1] || "";
  return (/^NC/.test(s) ? "NC" : (/^ND/.test(s) ? "ND" : "FC")) + l;
}
function _cbzDiasDesde(f) { if (!f) return null; var d = new Date(String(f).slice(0, 10) + "T12:00:00"); return Math.max(0, Math.round((Date.now() - d.getTime()) / 86400000)); }
function cbzDtoPorDias(d) {
  if (d == null) return null;
  var es = cbzEscalones();
  for (var i = 0; i < es.length; i++) if (d <= es[i].dias) return es[i];
  return null;
}
function cbzOpAbierta(a, emp, cod) {
  var fac = (a.facturas || []).map(function (x) {
    var c = _cbzCompDe(x.comprobante);
    return { fecha: x.fecha, comp: c.comp, nro: c.nro, importe: _cbzNum(x.lista != null ? x.lista : x.pendiente),
             pendiente: _cbzNum(x.pendiente), condicion: x.condicion, vence: x.vence };
  });
  var pagos = (a.facturas || []).filter(function (x) { return _cbzNum(x.cancelado_banco) > 0; }).map(function (x) {
    return { fecha: null, importe: _cbzNum(x.cancelado_banco), recibo: x.recibos_banco || "", dias: null, obs: "cobro parcial" };
  });
  var imp = fac.reduce(function (s, x) { return s + x.importe; }, 0);
  var pag = pagos.reduce(function (s, x) { return s + x.importe; }, 0);
  var d = _cbzDiasDesde(a.fecha), esc = cbzDtoPorDias(d);
  return { key: "a|" + emp + "|" + a.fecha, tipo: "abierta", emp: emp, cod: cod, fecha: a.fecha, facturas: fac, ncs: [], pagos: pagos,
           importe: imp, ncTotal: 0, pagado: pag, saldo: _cbzNum(a.pendiente), dias: d,
           dtoGanado: esc ? esc.dto : 0, dtoTomado: null, aReclamar: 0, retencion: null, calidad: "abierta" };
}
function cbzOpPagada(p, emp, cod) {
  var fac = (p.facturas || []).map(function (x) {
    return { fecha: x.fecha, comp: _cbzTipoCorto(x.tipo), nro: x.numero, importe: _cbzNum(x.total) };
  });
  if (!fac.length) fac = String(p.facturas_txt || "").split("+").map(function (n, i) {
    return { fecha: p.fecha_fc, comp: "FC", nro: n, importe: i === 0 ? _cbzNum(p.lista) : null };
  });
  var ncs = (p.ncs || []).map(function (x) { return { fecha: x.fecha, comp: _cbzTipoCorto(x.tipo), nro: x.numero, importe: _cbzNum(x.total), gravado: _cbzNum(x.gravado) }; });
  var pagos = (p.pagos || []).map(function (x) {
    return { fecha: x.fecha, importe: _cbzNum(x.pagado), recibo: x.recibo || "", medio: x.medio, dias: x.dias, grupos: _cbzNum(x.grupos) };
  });
  var pag = pagos.reduce(function (s, x) { return s + x.importe; }, 0);
  var dd = pag ? pagos.reduce(function (s, x) { return s + x.importe * _cbzNum(x.dias); }, 0) / pag : null;
  var imp = _cbzNum(p.lista), ncT = Math.abs(_cbzNum(p.lista_nc));
  return { key: "p|" + emp + "|" + p.facturas_txt, tipo: "pagada", emp: emp, cod: cod, fecha: p.fecha_fc || (fac[0] && fac[0].fecha),
           facturas: fac, ncs: ncs, pagos: pagos, importe: imp, ncTotal: ncT, pagado: pag, saldo: imp - ncT - pag,
           dias: dd == null ? null : Math.round(dd), dtoGanado: _cbzNum(p.dto_ganado), dtoTomado: p.dto_tomado == null ? null : _cbzNum(p.dto_tomado),
           plazo: p.plazo == null ? null : _cbzNum(p.plazo),
           aReclamar: _cbzNum(p.a_reclamar), retencion: p.retencion == null ? null : _cbzNum(p.retencion),
           compartido: pagos.some(function (x) { return x.grupos > 1; }), calidad: p.calidad || "", ultimo: p.ultimo_pago };
}
async function cbzOpsTraer(g) {
  var rr = await Promise.all(g.cods.map(function (c) { return _cbzRpc("gv_cobranza_operaciones", { p_emp: c.empresa, p_cod: c.cod_cliente }); }));
  var ab = [], pg = [], err = null;
  rr.forEach(function (r, i) {
    if (r.error) { err = r.error; return; }
    var d = r.data || {}, emp = g.cods[i].empresa, cod = g.cods[i].cod_cliente;
    (d.abiertas || []).forEach(function (a) { ab.push(cbzOpAbierta(a, emp, cod)); });
    (d.pagadas || []).forEach(function (p) { pg.push(cbzOpPagada(p, emp, cod)); });
  });
  if ((err || (!ab.length && !pg.length)) && _cbz.demo) pg = [cbzOpPagada(_CBZ_DEMO_OP, "lk", "4045")];
  ab.sort(function (a, b) { return String(a.fecha).localeCompare(String(b.fecha)); });   // la deuda más vieja primero
  return { ops: ab.concat(pg), err: err };
}
function cbzOpSel(k) { _cbz.opSel = k; var p = document.getElementById("cbzPanel"); if (p) p.innerHTML = cbzResumenHtml(); }

function cbzResumenHtml() {
  var o = _cbz.ops; if (!o) return '<div class="cbz-vacio">Cargando…</div>';
  if (!o.ops.length) return '<div class="cbz-vacio">' + (o.err ? "No pude leer: " + _cbzEsc(o.err) : "Este cliente no tiene operaciones con pagos ni deuda abierta.") + "</div>";
  var sel = o.ops.filter(function (x) { return x.key === _cbz.opSel; })[0] || o.ops[0];
  var multi = (cbzGrupo() || { cods: [] }).cods.length > 1;
  var lista = '<div class="cbz-oplist">' + o.ops.map(function (x, i) {
    var prev = o.ops[i - 1], head = "";
    if (!prev || prev.tipo !== x.tipo) head = '<div class="cbz-oph">' + (x.tipo === "abierta" ? "Deuda abierta" : "Cobradas") + "</div>";
    var nros = x.facturas.map(function (f) { return f.nro; }).filter(Boolean);
    var rot = (x.facturas[0] ? x.facturas[0].comp : "FC") + " " + (nros.length > 2 ? nros[0] + " +" + (nros.length - 1) : nros.join("+"));
    var chip = x.tipo === "abierta" ? '<span class="cbz-chip cbz-lk">' + _cbzPlata(x.dias) + " d</span>"
      : (x.aReclamar > 0.5 ? '<span class="cbz-chip cbz-warn">reclamar</span>' : '<span class="cbz-chip cbz-ok">' + (x.dias != null ? _cbzPlata(x.dias) + " d" : "ok") + "</span>");
    return head + '<button class="cbz-opi' + (x.key === sel.key ? " on" : "") + '" onclick="cbzOpSel(\'' + _cbzEsc(x.key).replace(/'/g, "\\'") + '\')">' +
      '<div class="a">' + (multi ? '<span class="cbz-chip ' + (x.emp === "chef" ? "cbz-ch" : "cbz-lk") + '">' + _cbzEmpLabel(x.emp) + "</span> " : "") + _cbzEsc(rot) + " " + chip + "</div>" +
      '<div class="b">' + _cbzFecha(x.fecha) + " · $ " + _cbzPlata(x.tipo === "abierta" ? x.saldo : x.importe) + "</div></button>";
  }).join("") + "</div>";
  return '<div class="cbz-resgrid">' + lista + '<div style="min-width:0;">' + cbzPlanillaHtml(sel) + "</div></div>";
}

function cbzPlanillaHtml(op) {
  var g = cbzGrupo() || { nombre: "", cods: [] };
  var cod = (op.emp === "chef" ? "CH " : "LK ") + op.cod;
  var abierta = op.tipo === "abierta";
  /* facturas + NC */
  var fh = '<table class="cbz-plx"><thead><tr><th>Fecha FC</th><th>Comp</th><th>Nro</th><th>Importe FC</th></tr></thead><tbody>' +
    op.facturas.map(function (f) {
      return "<tr><td>" + _cbzFecha(f.fecha) + "</td><td>" + _cbzEsc(f.comp) + "</td><td><b>" + _cbzEsc(f.nro) + "</b></td><td>" +
        (f.importe != null ? _cbzPlata(f.importe, 2) : "—") + "</td></tr>";
    }).join("") +
    op.ncs.map(function (n) {
      return '<tr class="nc"><td>' + _cbzFecha(n.fecha) + "</td><td>" + _cbzEsc(n.comp) + "</td><td><b>" + _cbzEsc(n.nro) + "</b></td><td>−" + _cbzPlata(n.importe, 2) + "</td></tr>";
    }).join("") +
    (!op.ncs.length && op.ncTotal ? '<tr class="nc"><td colspan="3">NC ya emitidas</td><td>−' + _cbzPlata(op.ncTotal, 2) + "</td></tr>" : "") +
    "</tbody></table>";
  /* pagos con la ponderación del Excel: pond = días × pagado / total pagado */
  var pag = op.pagado;
  var ph = '<table class="cbz-plx"><thead><tr><th>Fecha pago</th><th>Importe</th><th>Recibo</th><th>Días</th><th>Pond.</th></tr></thead><tbody>' +
    (op.pagos.length ? op.pagos.map(function (x) {
      var pond = (pag && x.dias != null) ? _cbzNum(x.dias) * x.importe / pag : null;
      return "<tr><td>" + (x.fecha ? _cbzFecha(x.fecha) : "—") + "</td><td><b>" + _cbzPlata(x.importe, 2) + "</b>" +
        (x.grupos > 1 ? '<div class="cbz-mini" title="El mismo recibo pagó ' + x.grupos + ' juegos de facturas: el importe es el del recibo entero">↔ recibo compartido</div>' : "") + "</td>" +
        "<td>" + _cbzEsc(x.recibo || x.obs || "—") + (x.medio ? '<div class="cbz-mini">' + _cbzEsc(x.medio) + "</div>" : "") + "</td>" +
        "<td>" + (x.dias != null ? _cbzPlata(x.dias) : "—") + "</td><td>" + (pond != null ? _cbzPlata(pond, 2) : "—") + "</td></tr>";
    }).join("") : '<tr><td colspan="5" style="color:#94a3b8;">' + (abierta ? "Todavía sin pagos" : "—") + "</td></tr>") +
    "</tbody></table>";
  /* total */
  var dias = op.dias;
  var tot = '<div class="cbz-pltot">' +
    '<div><div class="k">Importe FC</div><div class="v">$ ' + _cbzPlata(op.importe, 2) + "</div></div>" +
    '<div class="big"><div class="k">' + (abierta ? "Días al día de hoy" : "Días de cobranza") + '</div><div class="v">' + (dias != null ? _cbzPlata(dias) : "—") + "</div></div>" +
    '<div><div class="k">Importe pagado</div><div class="v cbz-verde">$ ' + _cbzPlata(pag, 2) + "</div></div>" +
    '<div><div class="k">Saldo</div><div class="v">$ ' + _cbzPlata(op.saldo, 2) + "</div></div></div>";
  /* escala: el % de cada escalón sobre lo facturado, y el que le toca marcado */
  /* En una cobrada manda lo que decidió el agente (dto_ganado), no la escala pelada: un cliente
     con PLAZO propio (Cuyana 60 d) que paga en 63 días no gana nada aunque la escala diga −5 %. */
  var es = cbzEscalones(), gan = abierta ? cbzDtoPorDias(dias)
    : (es.filter(function (e) { return Math.abs(e.dto - _cbzNum(op.dtoGanado)) < 0.0001; })[0] || null);
  var esc = '<table class="cbz-plx cbz-plesc"><thead><tr><th>Plazo</th><th>Dto</th><th>Descuento</th><th>' + (abierta ? "A pagar" : "Neto") + "</th></tr></thead><tbody>" +
    es.map(function (e) {
      var on = gan && gan.orden === e.orden;
      return '<tr class="' + (on ? "on" : "") + '"><td>' + _cbzEsc(e.label) + "</td><td>−" + _cbzPlata(e.dto * 100, 0) + " %</td><td>$ " +
        _cbzPlata(op.importe * e.dto, 2) + "</td><td>$ " + _cbzPlata(op.importe * (1 - e.dto) - (abierta ? pag : 0), 2) + "</td></tr>";
    }).join("") + "</tbody></table>";
  /* resultado */
  var ganPct = abierta ? (gan ? gan.dto : 0) : op.dtoGanado;
  var ncDto = op.importe * ganPct;
  /* la NC de descuento que FALTA emitir: lo que le corresponde menos las NC que ya tiene, y nunca más que el saldo */
  var ncFalta = abierta ? 0 : Math.max(0, Math.min(Math.max(op.saldo, 0), ncDto - (op.ncTotal || 0)));
  var res = abierta ? op.saldo : op.saldo - ncFalta;
  var neto = ncFalta / 1.21, iva = ncFalta - neto;
  var r = '<div class="cbz-plres">';
  if (abierta) {
    r += '<div class="lin"><span>Si paga hoy (' + _cbzPlata(dias) + " días)</span><b>" + (gan ? "−" + _cbzPlata(gan.dto * 100, 0) + " %" : "sin descuento") + "</b></div>" +
      '<div class="lin"><span>Paga</span><b>$ ' + _cbzPlata(op.importe * (1 - ganPct) - pag, 2) + "</b></div>";
    var sig = es.filter(function (e) { return dias != null && e.dias >= dias; })[0];
    if (gan && sig) r += '<div class="cbz-mini" style="margin-top:4px;">Mantiene el −' + _cbzPlata(gan.dto * 100, 0) + " % hasta el día " + gan.dias + " (" + _cbzFecha(new Date(new Date(String(op.fecha).slice(0, 10) + "T12:00:00").getTime() + gan.dias * 86400000).toISOString().slice(0, 10)) + ").</div>";
  } else {
    r += '<div class="lin"><span>Le corresponde</span><b>' + (ganPct ? "−" + _cbzPlata(ganPct * 100, 0) + " %" : "sin descuento") + "</b></div>" +
      (op.plazo ? '<div class="lin"><span>Plazo pactado del cliente</span><b>' + _cbzPlata(op.plazo) + " días" +
        (dias != null && dias > op.plazo ? ' <span class="cbz-rojo">· pagó ' + _cbzPlata(dias - op.plazo) + " días tarde</span>" : "") + "</b></div>" : "") +
      (op.dtoTomado != null ? '<div class="lin"><span>Se descontó</span><b class="' + (op.dtoTomado > ganPct + 0.0001 ? "cbz-rojo" : "") + '">−' + _cbzPlata(op.dtoTomado * 100, 1) + " %</b></div>" : "");
    if (ncFalta > 0.5) r += '<div class="cbz-plnc"><div class="t">NC Dto ' + _cbzPlata(ganPct * 100, 0) + ' %</div><div class="v">$ ' + _cbzPlata(ncFalta, 2) + "</div>" +
      '<div class="cbz-mini">N. gravado $ ' + _cbzPlata(neto, 2) + " · IVA $ " + _cbzPlata(iva, 2) + "</div></div>";
    if (op.aReclamar > 0.5) r += '<div class="lin cbz-ambar"><span>Descuento mal tomado</span><b>$ ' + _cbzPlata(op.aReclamar, 2) + "</b></div>";
    if (op.retencion != null && Math.abs(op.retencion) >= 0.001) {
      r += '<div class="cbz-mini" style="margin-top:4px;">' + (op.retencion > 0
        ? "Pagó " + _cbzPlata(op.retencion * 100, 2) + " % menos de lo que da la cuenta: retención (IIBB/Ganancias) o un descuento que no está registrado."
        : "Pagó " + _cbzPlata(-op.retencion * 100, 2) + " % de más: no hay ND que lo explique; puede cubrir parte de otra factura.") + "</div>";
    }
  }
  r += '<div class="cbz-plfin ' + (res > 0.5 ? "deuda" : (res < -0.5 ? "favor" : "ok")) + '"><span>' + (res > 0.5 ? "Deuda" : (res < -0.5 ? "A favor" : "Saldado")) + "</span><b>$ " + _cbzPlata(Math.abs(res), 2) + "</b></div></div>";

  return '<div class="cbz-pl" id="cbzPl">' +
    '<div class="cbz-plhead"><div><div class="k">Razón social</div><div class="n">' + _cbzEsc(g.nombre) + "</div></div>" +
      '<div><div class="k">Cod</div><div class="n">' + _cbzEsc(cod) + "</div></div>" +
      (g.cuit ? '<div><div class="k">CUIT</div><div class="n" style="font-size:14px;">' + _cbzEsc(g.cuit) + "</div></div>" : "") +
      '<button class="cbz-back cbz-noprint" onclick="cbzPlImprimir()">🖨 Imprimir para el cliente</button></div>' +
    '<div class="cbz-plgrid"><div><div class="cbz-plk">Facturas</div>' + fh + '</div><div><div class="cbz-plk">Pagos</div>' + ph + "</div></div>" +
    tot +
    '<div class="cbz-plgrid"><div><div class="cbz-plk">Escala de descuentos</div>' + esc + '</div><div><div class="cbz-plk">Resultado</div>' + r + "</div></div>" +
    "</div>";
}
/* imprime SÓLO la planilla, en un iframe: la app no se toca */
function cbzPlImprimir() {
  var el = document.getElementById("cbzPl"); if (!el) return;
  var css = (document.getElementById("cbzCss") || {}).textContent || "";
  var fr = document.createElement("iframe");
  fr.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  document.body.appendChild(fr);
  var d = fr.contentWindow.document;
  d.open();
  d.write('<!doctype html><html><head><meta charset="utf-8"><title>Cobranza</title><style>' + css +
    "body{font-family:system-ui,Segoe UI,Arial,sans-serif;color:#0f172a;background:#fff;margin:14px;}.cbz-noprint{display:none!important;}</style></head><body>" +
    el.outerHTML + "</body></html>");
  d.close();
  setTimeout(function () { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (_e) {} setTimeout(function () { fr.remove(); }, 1500); }, 250);
}
var _CBZ_DEMO_OP = {
  facturas_txt: "35292", nc_txt: null, lista: 1080583.02, lista_nc: 0, fecha_fc: "2026-07-24", plazo: 60,
  dto_tomado: 0.10, dto_ganado: 0.10, retencion: 0, a_reclamar: 0, calidad: "exacta", ultimo_pago: "2026-09-28",
  facturas: [{ tipo: "FC Electr. A", numero: "35292", fecha: "2026-07-24", total: 1080583.02 }], ncs: [],
  pagos: [{ recibo: "14588", fecha: "2026-09-15", pagado: 500000, medio: "deposito", dias: 53, grupos: 1 },
          { recibo: "14601", fecha: "2026-09-28", pagado: 472524.71, medio: "transferencia", dias: 66, grupos: 1 }]
};
window.cbzOpSel = cbzOpSel;
window.cbzResumenHtml = cbzResumenHtml;
window.cbzPlanillaHtml = cbzPlanillaHtml;
window.cbzPlImprimir = cbzPlImprimir;
window.cbzOpPagada = cbzOpPagada;
window.cbzOpAbierta = cbzOpAbierta;

/* ============================ 3) CONCILIACIÓN ============================
   Hoy la conciliación se hace A MANO en cuatro Excel (Credicoop y Santander, LK y
   Chef): alguien mira el extracto y le escribe al renglón el cliente y el recibo.
   Esa planilla entra a Gestión por la macro y se lee en gv_conciliacion_bancaria.

   Esta pestaña es el tablero de eso: cuánto de cada extracto quedó identificado,
   qué entradas están sin identificar (que son las que el motor de reglas va a tener
   que resolver solo) y de qué archivo salió cada carga.

   Desde la v24.37 esto es la vista «📊 Planillas» de la pestaña; la principal es
   «📥 Extracto» (3b, más abajo), que carga el extracto del banco y lo cruza solo. */
/* v24.41 (Luis, 29/09) — la pestaña se reorganizó:
     🏦 Bancos            una tarjeta por cuenta que abre SU conciliación en un pop-up (planilla,
                          extracto cargado y lo sin identificar) + 4 botones chicos para cargar el
                          extracto de cada banco.
     ✍ Completar datos   lo que el motor no pudo cuadrar solo, de las 4 cuentas juntas. Su número
                          es el badge rojo de la pestaña «Conciliación».
   La planilla (el Excel) llega sola: la macro la sube al guardar. «↻ Actualizar» la vuelve a LEER;
   no hay forma de empujar el Excel desde la web. */
function cbzConcCargar() {
  if (!_cbz.conc && !_cbz.concCargando) cbzConcTablero();
  if (_cbz.cc.vista === "completar" && !_cbz.cc.pend && !_cbz.cc.pendCargando) cbzCcPendTraer();
}
function cbzConcPintar() {
  if (_cbz.tab === "conc") { var w = document.getElementById("cbzWrap"); if (w) w.innerHTML = cbzConcHtml(); }
  cbzCcPopPintar();
}
function cbzConcTablero() {
  _cbz.concCargando = true;
  return Promise.all([_cbzRpc("gv_conc_salud"), _cbzRpc("gv_conc_sin_identificar", { p_dias: 90, p_limit: 300 }), _cbzRpc("gv_conc_tablero")])
    .then(function (rr) {
      _cbz.concCargando = false;
      _cbz.conc = {
        salud: rr[0].error ? [] : (rr[0].data || []),
        sin: rr[1].error ? [] : (rr[1].data || []),
        tab: rr[2].error ? [] : (rr[2].data || []),
        err: rr[0].error || rr[1].error || null
      };
      if (!_cbz.conc.salud.length && _cbz.demo) _cbz.conc.salud = _CBZ_DEMO_CONC.slice();
      cbzTabsPintar(); cbzConcPintar();
    });
}
/* sólo el tablero (el badge): después de resolver algo no hace falta releer las planillas */
function cbzConcTabRefrescar() {
  return _cbzRpc("gv_conc_tablero").then(function (r) {
    if (!r.error && _cbz.conc) _cbz.conc.tab = r.data || [];
    cbzTabsPintar(); cbzConcPintar();
  });
}
function cbzConcPendN(cuentaId) {
  var t = (_cbz.conc && _cbz.conc.tab) || [];
  return t.reduce(function (s, x) {
    if (cuentaId && (x.banco + "|" + x.empresa) !== cuentaId) return s;
    return s + _cbzNum(x.preguntas) + _cbzNum(x.propuestos);
  }, 0);
}
function _cbzCuentaDe(id) { var p = String(id).split("|"); return { banco: p[0], empresa: p[1] }; }
function _cbzCuentaT(id) { var c = _CBZ_CUENTAS.filter(function (x) { return x.id === id; })[0]; return c ? c.t : id; }
function _cbzHace(ts) {
  if (!ts) return "—";
  var d = new Date(ts), min = Math.round((Date.now() - d.getTime()) / 60000);
  var s = d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  return s + (min >= 0 && min < 60 ? " (hace " + min + " min)" : (min < 1440 ? " (hace " + Math.round(min / 60) + " h)" : " (hace " + Math.round(min / 1440) + " d)"));
}

function cbzConcHtml() {
  var cc = _cbz.cc, n = cbzConcPendN();
  var h = '<div class="cbz-buscar" style="justify-content:space-between;">' +
    '<div><b style="font-size:15px;">🏦 Conciliación bancaria</b>' +
    '<div style="color:#64748b;font-size:12px;margin-top:2px;">Lo que cuadra se concilia solo; lo que no, queda en «Completar datos».</div></div>' +
    '<div class="cbz-seg">' +
      '<button class="' + (cc.vista !== "completar" ? "on" : "") + '" onclick="cbzCcSetVista(\'bancos\')">🏦 Bancos</button>' +
      '<button class="' + (cc.vista === "completar" ? "on" : "") + '" onclick="cbzCcSetVista(\'completar\')">✍ Completar datos' +
        (n ? ' <span class="cbz-badge">' + n + "</span>" : "") + "</button>" +
    "</div>" +
    '<button class="cbz-back" onclick="_cbz.conc=null;_cbz.cc.pend=null;cbzConcCargar();" title="Vuelve a leer lo que ya está en la base. La planilla la sube la macro del Excel al guardar: desde la web no se la puede empujar.">↻ Actualizar</button>' +
    "</div>";
  if (cc.msg) h += '<div class="cbz-ccmsg' + (/^⚠/.test(cc.msg) ? " err" : "") + '">' + _cbzEsc(cc.msg) + "</div>";
  return h + (cc.vista === "completar" ? cbzCcCompletarHtml() : cbzConcBancosHtml());
}

function cbzConcBancosHtml() {
  var c = _cbz.conc;
  if (!c) return '<div class="cbz-panel" style="margin-top:12px;"><div class="cbz-vacio">Cargando…</div></div>';
  if (c.err && !c.salud.length) return '<div class="cbz-panel" style="margin-top:12px;"><div class="cbz-vacio">No pude leer: ' + _cbzEsc(c.err) + "</div></div>";
  var tab = {}; (c.tab || []).forEach(function (x) { tab[x.banco + "|" + x.empresa] = x; });
  var sal = {}; (c.salud || []).forEach(function (x) { sal[x.banco + "|" + x.empresa] = x; });
  var h = '<div class="cbz-concgrid">' + _CBZ_CUENTAS.map(function (cu) {
    var r = sal[cu.id], t = tab[cu.id] || {}, cta = _cbzCuentaDe(cu.id);
    var ent = _cbzNum(r && r.entradas), ok = _cbzNum(r && r.con_cliente);
    var pct = ent ? Math.round(ok * 100 / ent) : 0;
    var col = pct >= 90 ? "#047857" : (pct >= 50 ? "#b45309" : "#b91c1c");
    var pend = _cbzNum(t.preguntas) + _cbzNum(t.propuestos);
    return '<button class="cbz-conccard cbz-bank" onclick="cbzCcPopAbrir(\'' + cu.id + '\')">' +
      (pend ? '<span class="cbz-badge cbz-badge-abs" title="Movimientos a completar">' + pend + "</span>" : "") +
      '<div class="t">' + _cbzEsc(cta.banco.toUpperCase()) + " · " +
        '<span class="cbz-chip ' + (cta.empresa === "chef" ? "cbz-ch" : "cbz-lk") + '">' + _cbzEmpLabel(cta.empresa) + "</span></div>" +
      (r ? '<div class="p" style="color:' + col + ';">' + _cbzPlata(pct) + " %</div>" +
           '<div class="s">' + _cbzPlata(ok) + " de " + _cbzPlata(ent) + " entradas con cliente</div>" +
           '<div class="bar"><i style="width:' + pct + "%;background:" + col + ';"></i></div>'
         : '<div class="p" style="color:#94a3b8;">—</div><div class="s">sin planilla cargada</div>') +
      '<div class="s" style="margin-top:6px;">Conciliado al <b>' + (t.conciliado_al ? _cbzFecha(t.conciliado_al) : "—") + "</b>" +
        (t.saldo_linea != null ? " · saldo $ " + _cbzPlata(t.saldo_linea, 2) : "") + "</div>" +
      '<div class="s">Planilla subida: <b>' + _cbzEsc(_cbzHace(t.subido_en || (r && r.cargado_en))) + "</b></div>" +
      '<div class="s">Extracto: ' + (_cbzNum(t.movs_extracto) ? "<b>" + _cbzPlata(t.movs_extracto) + "</b> mov. hasta " + _cbzFecha(t.ultimo_extracto) : "sin cargar") + "</div>" +
      (r && _cbzNum(r.sin_identificar) ? '<div class="s">Sin identificar en la planilla: <b>' + _cbzPlata(r.sin_identificar) + "</b>" +
        (_cbzNum(r.monto_sin_identificar) ? " · $ " + _cbzPlata(r.monto_sin_identificar) : "") + "</div>" : "") +
      '<div class="cbz-bank-abrir">Abrir conciliación →</div>' +
      "</button>";
  }).join("") + "</div>";

  h += '<div class="cbz-cargas"><span class="cbz-cargas-k">📥 Cargar extracto del banco</span>' + _CBZ_CUENTAS.map(function (cu) {
    return '<label class="cbz-cargar-s" title="El .xls tal como lo baja el banco">' + _cbzEsc(cu.t) +
      '<input type="file" accept=".xls,.xlsx,.csv" onchange="cbzCcSubir(\'' + cu.id + '\', this)" style="display:none;"></label>';
  }).join("") + "</div>";

  h += '<div class="cbz-nota" style="border:none;padding:8px 2px 0;">El % dice cuántas entradas de la planilla tienen cliente escrito, no si la conciliación está bien: ' +
    "una transferencia entre cuentas propias, un rechazo o un «No Identificado» cuentan como sin cliente. «Conciliado al» es la línea amarilla del Excel; " +
    "lo que está debajo es proyección, por eso una fecha futura no es un error.</div>";
  return h;
}

/* ------------------------------ Completar datos ------------------------------ */
async function cbzCcPendTraer() {
  _cbz.cc.pendCargando = true;
  var r = await _cbzRpc("gv_conc_pendientes_lista");
  _cbz.cc.pendCargando = false;
  _cbz.cc.pendErr = r.error || null;
  _cbz.cc.pend = r.error ? [] : (Array.isArray(r.data) ? r.data : []);
  cbzConcPintar(); cbzCcTelefonos(_cbz.cc.pend);
}
function cbzCcPendFiltro(f) { _cbz.cc.pendFiltro = f; cbzConcPintar(); }
function cbzCcCompletarHtml() {
  var cc = _cbz.cc;
  if (cc.pendCargando || !cc.pend) return '<div class="cbz-panel" style="margin-top:12px;"><div class="cbz-vacio">Cargando…</div></div>';
  if (cc.pendErr) return '<div class="cbz-panel" style="margin-top:12px;"><div class="cbz-vacio">No pude leer: ' + _cbzEsc(cc.pendErr) + "</div></div>";
  if (!cc.pend.length) return '<div class="cbz-panel" style="margin-top:12px;"><div class="cbz-vacio">No hay nada para completar. 👌<br>' +
    '<span style="font-size:12px;">Cuando se carga un extracto, lo que el motor no puede cuadrar solo aparece acá.</span></div></div>';
  var f = cc.pendFiltro || "todas";
  var cnt = {}; cc.pend.forEach(function (m) { var k = m.banco + "|" + m.empresa; cnt[k] = (cnt[k] || 0) + 1; });
  var ver = cc.pend.filter(function (m) { return f === "todas" || (m.banco + "|" + m.empresa) === f; });
  var prop = ver.filter(function (m) { return m.estado === "propuesto"; });
  var h = '<div class="cbz-ccest"><button class="' + (f === "todas" ? "on" : "") + '" onclick="cbzCcPendFiltro(\'todas\')">Todas <b>' + cc.pend.length + "</b></button>" +
    _CBZ_CUENTAS.filter(function (x) { return cnt[x.id]; }).map(function (x) {
      return '<button class="' + (f === x.id ? "on" : "") + '" onclick="cbzCcPendFiltro(\'' + x.id + '\')">' + _cbzEsc(x.t) + " <b>" + cnt[x.id] + "</b></button>";
    }).join("") +
    (prop.length ? '<button class="cbz-conf" onclick="cbzCcConfirmar([' + prop.map(function (m) { return m.id; }).join(",") + '])">✔ Confirmar los ' + prop.length + " propuestos</button>" : "") +
    '<button class="cbz-back" onclick="cbzCcRecruzar()" title="Vuelve a cruzar todo lo pendiente: sirve después de proyectar algo nuevo en la planilla">↻ Volver a cruzar</button>' +
    "</div>";
  return h + '<div class="cbz-qlist">' + ver.map(cbzCcPreguntaHtml).join("") + "</div>";
}

/* ------------------------------ pop-up de un banco ------------------------------ */
function cbzCcPopAbrir(id) {
  _cbz.cc.cuenta = id; _cbz.cc.movs = null; _cbz.cc.filtro = null; _cbz.cc.abierto = null;
  _cbz.pop = { cuenta: id, tab: "planilla", plan: null, planErr: null };
  var ov = document.getElementById("cbzOv"); if (!ov) return;
  var p = document.getElementById("cbzPop");
  if (!p) { p = document.createElement("div"); p.id = "cbzPop"; ov.appendChild(p); }
  p.style.display = "flex";
  cbzCcPopPintar();
  var c = _cbzCuentaDe(id);
  _cbzRpc("gv_conc_planilla", { p_banco: c.banco, p_empresa: c.empresa, p_dias: 45 }).then(function (r) {
    if (!_cbz.pop || _cbz.pop.cuenta !== id) return;
    _cbz.pop.plan = r.error ? { filas: [] } : (r.data || { filas: [] });
    _cbz.pop.planErr = r.error || null;
    cbzCcPopPintar(); cbzCcPopLinea();
  });
  cbzCcTraer();
}
function cbzCcPopCerrar() { _cbz.pop = null; var p = document.getElementById("cbzPop"); if (p) p.style.display = "none"; cbzConcPintar(); }
function cbzCcPopTab(t) { if (_cbz.pop) { _cbz.pop.tab = t; cbzCcPopPintar(); if (t === "planilla") cbzCcPopLinea(); } }
function cbzCcPopLinea() {
  setTimeout(function () { var l = document.getElementById("cbzPlLinea"); if (l && l.scrollIntoView) l.scrollIntoView({ block: "center" }); }, 0);
}
function cbzCcPopPintar() {
  var p = document.getElementById("cbzPop");
  if (!p || !_cbz.pop || p.style.display === "none") return;
  var pop = _cbz.pop, id = pop.cuenta, c = _cbzCuentaDe(id), cc = _cbz.cc;
  var t = ((_cbz.conc && _cbz.conc.tab) || []).filter(function (x) { return x.banco + "|" + x.empresa === id; })[0] || {};
  var sin = ((_cbz.conc && _cbz.conc.sin) || []).filter(function (x) { return x.banco === c.banco && x.empresa === c.empresa; });
  var nMov = (cc.movs || []).length, pend = _cbzNum(t.preguntas) + _cbzNum(t.propuestos);
  var tabs = [
    { id: "planilla", t: "📒 Planilla" },
    { id: "extracto", t: "🏦 Extracto cargado" + (cc.movs ? " (" + nMov + ")" : "") },
    { id: "sin", t: "❔ Sin identificar (" + sin.length + ")" }
  ];
  var h = '<div class="cbz-pop-card">' +
    '<div class="cbz-pop-head"><div><b style="font-size:16px;">' + _cbzEsc(_cbzCuentaT(id)) + "</b>" +
      '<div style="font-size:12px;color:#64748b;">Conciliado al <b>' + (t.conciliado_al ? _cbzFecha(t.conciliado_al) : "—") + "</b>" +
      (t.saldo_linea != null ? " · saldo $ " + _cbzPlata(t.saldo_linea, 2) : "") +
      " · planilla subida " + _cbzEsc(_cbzHace(t.subido_en)) +
      (pend ? ' · <b class="cbz-rojo">' + pend + " a completar</b>" : "") + "</div></div>" +
      '<div class="cbz-sub" style="margin:0;">' + tabs.map(function (x) {
        return '<button class="' + (pop.tab === x.id ? "on" : "") + '" onclick="cbzCcPopTab(\'' + x.id + '\')">' + x.t + "</button>";
      }).join("") + "</div>" +
      '<label class="cbz-cargar" style="font-size:12px;">📥 Cargar extracto<input type="file" accept=".xls,.xlsx,.csv" onchange="cbzCcSubir(\'' + id + '\', this)" style="display:none;"></label>' +
      '<button class="cbz-x" style="margin-left:0;" onclick="cbzCcPopCerrar()">Cerrar</button></div>' +
    '<div class="cbz-pop-body">';
  if (pop.tab === "planilla") h += cbzCcPlanillaHtml(pop);
  else if (pop.tab === "sin") h += cbzCcSinHtml(sin);
  else h += cbzCcExtractoHtml();
  /* repintar no puede tirar el scroll arriba: la planilla se abre centrada en la línea amarilla
     y el extracto llega DESPUÉS (otra llamada), que vuelve a pintar el pop-up entero */
  var ob = p.querySelector(".cbz-pop-body"), st = (ob && p.getAttribute("data-tab") === pop.tab) ? ob.scrollTop : 0;
  p.innerHTML = h + "</div></div>";
  p.setAttribute("data-tab", pop.tab);
  var nb = p.querySelector(".cbz-pop-body"); if (nb && st) nb.scrollTop = st;
}
function cbzCcPlanillaHtml(pop) {
  if (!pop.plan) return '<div class="cbz-vacio">Cargando la planilla…</div>';
  if (pop.planErr) return '<div class="cbz-vacio">No pude leer la planilla: ' + _cbzEsc(pop.planErr) + "</div>";
  var fil = pop.plan.filas || [];
  if (!fil.length) return '<div class="cbz-vacio">Esta cuenta no tiene planilla cargada.</div>';
  var linea = false;
  var h = '<table class="cbz-t cbz-plt"><thead><tr><th>Fecha</th><th>Operación</th><th>Entrada</th><th>Salida</th><th>Saldo</th>' +
    '<th style="text-align:left;">Detalle</th><th>DET</th><th>Nro OP</th><th>Recibo</th><th>Cliente</th></tr></thead><tbody>';
  fil.forEach(function (r) {
    if (r.proyectado && !linea) {
      linea = true;
      h += '<tr id="cbzPlLinea" class="cbz-linea"><td colspan="10">▲ conciliado al ' + _cbzFecha(pop.plan.conciliado_al) +
        (pop.plan.saldo_linea != null ? " · saldo $ " + _cbzPlata(pop.plan.saldo_linea, 2) : "") + " · ▼ proyectado</td></tr>";
    }
    h += '<tr class="' + (r.proyectado ? "cbz-proy" : "") + (r.mov_id ? " cbz-conext" : "") + '"' + (r.mov_id ? ' title="Cruzado con el extracto cargado"' : "") + ">" +
      "<td>" + _cbzFecha(r.fecha) + '</td><td class="l">' + _cbzEsc(r.operacion || "") + "</td>" +
      '<td class="cbz-verde">' + (_cbzNum(r.entrada) ? _cbzPlata(r.entrada, 2) : "") + "</td>" +
      '<td class="cbz-rojo">' + (_cbzNum(r.salida) ? _cbzPlata(r.salida, 2) : "") + "</td>" +
      "<td>" + (r.saldo != null ? _cbzPlata(r.saldo, 2) : "") + "</td>" +
      '<td class="l">' + _cbzEsc(r.detalle || "") + "</td><td>" + _cbzEsc(r.det || "") + "</td>" +
      "<td>" + _cbzEsc(r.nro_op || "") + "</td><td>" + _cbzEsc(r.nro_recibo || "") + "</td><td>" + _cbzEsc(r.cod_cliente || "") + "</td></tr>";
  });
  return h + '</tbody></table><div class="cbz-nota">Últimos 45 días de la planilla y todo lo proyectado. La franja amarilla es la línea del Excel. ' +
    "Las filas con borde verde ya se cruzaron con un movimiento del extracto cargado.</div>";
}
function cbzCcSinHtml(sin) {
  if (!sin.length) return '<div class="cbz-vacio">Ninguna entrada sin identificar en los últimos 90 días. 👌</div>';
  var tot = sin.reduce(function (s, r) { return s + _cbzNum(r.entrada); }, 0);
  return '<div style="padding:10px 14px;font-size:13px;"><b>' + sin.length + "</b> entrada(s) sin cliente ni recibo en la planilla · <b>$ " + _cbzPlata(tot) + "</b></div>" +
    '<table class="cbz-t"><thead><tr><th>Fecha</th><th>Entrada</th><th style="text-align:left;">Detalle</th><th style="text-align:left;">Operación</th><th>Nro op.</th></tr></thead><tbody>' +
    sin.map(function (r) {
      return "<tr><td>" + _cbzFecha(r.fecha) + '</td><td class="cbz-verde"><b>' + _cbzPlata(r.entrada) + "</b></td>" +
        '<td class="l">' + _cbzEsc(r.detalle || "—") + '</td><td class="l" style="color:#64748b;">' + _cbzEsc(r.operacion || r.tipo || "—") + "</td>" +
        "<td>" + _cbzEsc(r.nro_op || "—") + "</td></tr>";
    }).join("") + "</tbody></table>";
}
function cbzCcExtractoHtml() {
  var cc = _cbz.cc;
  if (cc.cargando || !cc.movs) return '<div class="cbz-vacio">Cargando…</div>';
  if (cc.err) return '<div class="cbz-vacio">No pude leer los movimientos: ' + _cbzEsc(cc.err) + "</div>";
  if (!cc.movs.length) return '<div class="cbz-vacio">Todavía no se cargó ningún extracto de esta cuenta en los últimos 45 días.<br>Subí el .xls tal como lo baja el banco con «📥 Cargar extracto».</div>';
  var cnt = {}; cc.movs.forEach(function (m) { cnt[m.estado] = (cnt[m.estado] || 0) + 1; });
  var f = cc.filtro || "todos";
  var h = '<div class="cbz-ccest" style="padding:8px 10px 0;">' + _CBZ_CC_EST.map(function (e) {
    return '<button class="' + (f === e.id ? "on" : "") + '" onclick="cbzCcFiltro(\'' + e.id + '\')">' + e.t + " <b>" + (cnt[e.id] || 0) + "</b></button>";
  }).join("") + '<button class="' + (f === "todos" ? "on" : "") + '" onclick="cbzCcFiltro(\'todos\')">Todos <b>' + cc.movs.length + "</b></button>" +
    (cnt.propuesto ? '<button class="cbz-conf" onclick="cbzCcConfirmarPropuestos()">✔ Confirmar los ' + cnt.propuesto + " propuestos</button>" : "") +
    '<button class="cbz-back" onclick="cbzCcCopiar()" title="Columnas A–J de la planilla: Fecha · Operación · Entrada · Salida · Saldo · Detalle · DET · Nro OP · Nro Recibo · Cliente">📋 Copiar para la planilla</button></div>';
  var ver = cc.movs.filter(function (m) { return f === "todos" || m.estado === f; });
  if (f === "pregunta" || f === "propuesto") {
    ver.sort(function (a, b) { return _cbzNum(b.credito) - _cbzNum(a.credito); });
    return h + (ver.length ? '<div class="cbz-qlist" style="padding:0 10px 10px;">' + ver.map(cbzCcPreguntaHtml).join("") + "</div>" : '<div class="cbz-vacio">Nada. 👌</div>');
  }
  return h + cbzCcTablaHtml(ver);
}
function cbzCcSubir(id, inp) { _cbz.cc.cuenta = id; return cbzCcArchivo(inp); }

window.cbzConcCargar = cbzConcCargar;
window.cbzConcTablero = cbzConcTablero;
window.cbzCcPopAbrir = cbzCcPopAbrir;
window.cbzCcPopCerrar = cbzCcPopCerrar;
window.cbzCcPopTab = cbzCcPopTab;
window.cbzCcSubir = cbzCcSubir;
window.cbzCcPendFiltro = cbzCcPendFiltro;
window.cbzCcPendTraer = cbzCcPendTraer;

/* ===================== 3b) CONCILIACIÓN — EXTRACTO DEL DÍA =====================
   v24.37 (Luis, 29/09): "el módulo debería resolver automáticamente todo lo que pueda con
   la carga de los extractos de movimientos por día y consultarle al humano por las cosas
   que no puede cuadrar. Quiero un buen motor de cruce en este, esmerate".

   Flujo: se elige la cuenta → 📥 se sube el extracto TAL COMO LO BAJA EL BANCO (.xls de
   Credicoop o de Santander) → el navegador lo lee (vendor/xlsx) → gv_conc_extracto_cargar
   lo guarda sin duplicar (huella) → gv_conc_motor lo cruza DE A 15 (el rol authenticated
   corta a los 8 s; 60 movimientos de Credicoop tardan 13 s) → la pantalla muestra:
     ❓ PREGUNTAS   lo que no cuadró solo, con los candidatos y el teléfono de cada uno
     🟡 PROPUESTOS  cruce por importe con ventaja clara: se confirma de un click
     ✅ AUTOMÁTICOS CUIT, apareo con la planilla, gastos, impuestos, sueldos
   y se copia a la planilla en sus columnas A–J.

   Cómo decide el motor, medido, está en sql/gv_conc_motor_cruce_v2437.sql. Acá no se
   decide nada: la pantalla muestra y la persona resuelve (gv_conc_resolver).
   El Nº de recibo lo genera ISIS (Luis): la pantalla nunca lo inventa. */
var _CBZ_CUENTAS = [
  { id: "credicoop|lk",   t: "Credicoop LK" },
  { id: "santander|chef", t: "Santander CH" },
  { id: "credicoop|chef", t: "Credicoop CH" },
  { id: "santander|lk",   t: "Santander LK" }
];
var _CBZ_CC_EST = [
  { id: "pregunta",        t: "❓ Preguntas",       cls: "cbz-warn" },
  { id: "propuesto",       t: "🟡 Propuestos",      cls: "cbz-amb" },
  { id: "auto",            t: "✅ Automáticos",     cls: "cbz-ok" },
  { id: "confirmado",      t: "👤 Confirmados",     cls: "cbz-info" },
  { id: "no_identificado", t: "⚪ No identificados", cls: "" }
];
var _CBZ_CC_LOTE = 15;

function cbzCcCuenta() { var p = String(_cbz.cc.cuenta).split("|"); return { banco: p[0], empresa: p[1] }; }
function cbzCcSetCuenta(id) { _cbz.cc.cuenta = id; _cbz.cc.movs = null; _cbz.cc.msg = ""; _cbz.cc.abierto = null; cbzCcTraer(); }
function cbzCcSetVista(v) { _cbz.cc.vista = v; cbzConcPintar(); cbzConcCargar(); }
/* después de resolver o cargar: releer lo que está a la vista y el badge */
function cbzCcRefrescar() {
  _cbz.cc.movs = null;
  if (_cbz.pop) cbzCcTraer();
  if (_cbz.cc.vista === "completar" || _cbz.cc.pend) cbzCcPendTraer();
  return cbzConcTabRefrescar();
}
function cbzCcFiltro(f) { _cbz.cc.filtro = f; cbzConcPintar(); }

function _cbzIso(d) { return d.toISOString().slice(0, 10); }
async function cbzCcTraer() {
  var c = cbzCcCuenta(), hoy = new Date();
  var desde = new Date(hoy.getTime() - 45 * 86400000), hasta = new Date(hoy.getTime() + 86400000);
  _cbz.cc.cargando = true; cbzConcPintar();
  var r = await _cbzRpc("gv_conc_movs", { p_banco: c.banco, p_empresa: c.empresa, p_desde: _cbzIso(desde), p_hasta: _cbzIso(hasta) });
  _cbz.cc.cargando = false;
  if (r.error) { _cbz.cc.err = r.error; _cbz.cc.movs = []; }
  else { _cbz.cc.err = null; _cbz.cc.movs = Array.isArray(r.data) ? r.data : []; }
  if (!_cbz.cc.filtro) {
    var hay = function (e) { return _cbz.cc.movs.some(function (m) { return m.estado === e; }); };
    _cbz.cc.filtro = hay("pregunta") ? "pregunta" : (hay("propuesto") ? "propuesto" : "todos");
  }
  cbzConcPintar();
  cbzCcTelefonos();
}

/* ------------------------- lectura del extracto ------------------------- */
function _cbzCcNum(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  var s = String(v).trim().replace(/\$/g, "").replace(/\s/g, "");
  if (!s) return null;
  var neg = /^\(.*\)$/.test(s) || /^-/.test(s);
  s = s.replace(/[()]/g, "").replace(/^-/, "");
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");   // es-AR: 1.234,56
  else s = s.replace(/,/g, "");                                            // 1,234.56 o 1234.56
  var n = Number(s);
  return isFinite(n) ? (neg ? -n : n) : null;
}
function _cbzCcFecha(v) {
  if (v instanceof Date) return _cbzIso(new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate())));
  if (typeof v === "number" && v > 20000 && v < 80000) return _cbzIso(new Date(Math.round((v - 25569) * 86400000)));
  var m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(String(v || "").trim());
  if (!m) return null;
  var y = m[3].length === 2 ? "20" + m[3] : m[3];
  return y + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[1]).slice(-2);
}
function _cbzCcKey(s) { return String(s == null ? "" : s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, ""); }
/* Lee las filas crudas de la hoja. Detecta el formato por los ENCABEZADOS, no por el nombre del
   archivo, y re-detecta cada vez que aparece un encabezado: Santander trae dos bloques
   ("Movimientos del Día" y "Últimos Movimientos") que se pisan. Devuelve {banco, movs}. */
function cbzCcParse(rows) {
  var col = null, banco = null, movs = [], vistos = {};
  (rows || []).forEach(function (r) {
    if (!Array.isArray(r)) return;
    var ks = r.map(_cbzCcKey);
    if (ks.indexOf("fecha") >= 0 && ks.indexOf("concepto") >= 0 && ks.indexOf("saldo") >= 0) {
      col = {};
      ks.forEach(function (k, i) {
        if (k === "fecha") col.fecha = i;
        else if (k === "concepto") col.concepto = i;
        else if (k === "nrocpbte" || k === "referencia") col.ref = i;
        else if (k === "debito") col.deb = i;
        else if (k === "credito") col.cred = i;
        else if (k === "importe") col.imp = i;
        else if (k === "saldo") col.saldo = i;
        else if (k === "cod" || k === "codoperativo") col.codop = i;
        else if (k === "descsucursal") col.suc = i;
      });
      banco = (col.imp != null) ? "santander" : "credicoop";
      return;
    }
    if (!col) return;
    var fe = _cbzCcFecha(r[col.fecha]);
    if (!fe) return;
    var deb = 0, cred = 0;
    if (col.imp != null) {
      var im = _cbzCcNum(r[col.imp]); if (im == null) return;
      if (im < 0) deb = -im; else cred = im;
    } else {
      deb = Math.abs(_cbzCcNum(r[col.deb]) || 0); cred = Math.abs(_cbzCcNum(r[col.cred]) || 0);
      if (!deb && !cred) return;
    }
    var m = {
      fecha: fe,
      concepto: String(r[col.concepto] == null ? "" : r[col.concepto]).replace(/\s+/g, " ").trim(),
      referencia: col.ref != null && r[col.ref] != null ? String(r[col.ref]).trim() : "",
      codop: col.codop != null && r[col.codop] != null ? String(r[col.codop]).trim() : "",
      sucursal: col.suc != null && r[col.suc] != null ? String(r[col.suc]).trim() : "",
      debito: deb, credito: cred, saldo: _cbzCcNum(r[col.saldo])
    };
    var k = [m.fecha, m.referencia, m.debito, m.credito, m.concepto, banco === "credicoop" ? m.saldo : ""].join("|");
    if (vistos[k]) return;
    vistos[k] = 1; movs.push(m);
  });
  return { banco: banco, movs: movs };
}
async function _cbzXlsx() {
  if (window.XLSX) return window.XLSX;
  if (typeof pppLoadXlsx === "function") return pppLoadXlsx();
  return new Promise(function (res, rej) {
    var sc = document.createElement("script"); sc.src = "vendor/xlsx.full.min.js";
    sc.onload = function () { window.XLSX ? res(window.XLSX) : rej(new Error("SheetJS no cargó")); };
    sc.onerror = function () { rej(new Error("No pude cargar SheetJS")); };
    document.head.appendChild(sc);
  });
}
async function cbzCcArchivo(inp) {
  var f = inp && inp.files && inp.files[0]; if (!f) return;
  inp.value = "";
  var c = cbzCcCuenta();
  try {
    _cbz.cc.msg = "Leyendo " + f.name + "…"; cbzConcPintar();
    var X = await _cbzXlsx();
    var wb = X.read(await f.arrayBuffer(), { type: "array" });
    /* raw:false a proposito: el .xls de Santander es HTML y SheetJS lee "(2.070,00)" como -2,07
       (toma la coma por separador de miles). El texto que muestra el banco es la verdad. */
    var rows = X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: null });
    var p = cbzCcParse(rows);
    if (!p.banco || !p.movs.length) { _cbz.cc.msg = "⚠ No reconocí movimientos en " + f.name + ": ¿es el extracto tal como lo baja el banco?"; cbzConcPintar(); return; }
    if (p.banco !== c.banco) {
      _cbz.cc.msg = "⚠ El archivo es un extracto de " + p.banco.toUpperCase() + " y la cuenta elegida es " + c.banco.toUpperCase() + ". No cargué nada.";
      cbzConcPintar(); return;
    }
    await cbzCcCargarMovs(f.name, p.movs);
  } catch (e) { _cbz.cc.msg = "⚠ No pude leer el archivo: " + ((e && e.message) || e); cbzConcPintar(); }
}
async function cbzCcCargarMovs(nombre, movs) {
  var c = cbzCcCuenta();
  _cbz.cc.msg = "Guardando " + movs.length + " movimientos…"; cbzConcPintar();
  var r = await _cbzRpc("gv_conc_extracto_cargar", { p_banco: c.banco, p_empresa: c.empresa, p_cuenta: null, p_archivo: nombre, p_movs: movs });
  if (r.error) { _cbz.cc.msg = "⚠ No se guardó el extracto: " + r.error + ". Probá de nuevo: no quedó nada a medias."; cbzConcPintar(); return; }
  var d = r.data || {}, ids = (d.ids || []).map(Number);
  var repetidos = (d.movimientos || movs.length) - (d.nuevos || 0);
  var fallas = await cbzCcMotor(ids, "Cruzando");
  _cbz.cc.msg = "✔ " + nombre + ": " + (d.nuevos || 0) + " movimientos nuevos" +
    (repetidos ? " · " + repetidos + " ya estaban (no se duplican)" : "") +
    (fallas ? " · ⚠ " + fallas + " lote(s) no se cruzaron: tocá «↻ Volver a cruzar»" : "");
  cbzCcRefrescar();
}
/* De a 15 y en orden. Después, una segunda pasada sobre lo que quedó en pregunta: el cruce
   "junto con otro pago del cliente" necesita que los vecinos ya estén identificados. */
async function cbzCcMotor(ids, rotulo) {
  var fallas = 0;
  for (var i = 0; i < ids.length; i += _CBZ_CC_LOTE) {
    _cbz.cc.msg = (rotulo || "Cruzando") + "… " + Math.min(i + _CBZ_CC_LOTE, ids.length) + " de " + ids.length; cbzConcPintar();
    var r = await _cbzRpc("gv_conc_motor", { p_ids: ids.slice(i, i + _CBZ_CC_LOTE) });
    if (r.error) { r = await _cbzRpc("gv_conc_motor", { p_ids: ids.slice(i, i + _CBZ_CC_LOTE) }); if (r.error) fallas++; }
  }
  return fallas;
}
async function cbzCcRecruzar() {
  var base = (_cbz.cc.vista === "completar" && !_cbz.pop) ? (_cbz.cc.pend || []) : (_cbz.cc.movs || []);
  var ids = base.filter(function (m) { return m.estado === "pregunta" || m.estado === "propuesto"; })
    .map(function (m) { return Number(m.id); });
  if (!ids.length) { _cbz.cc.msg = "No hay nada pendiente para volver a cruzar."; cbzConcPintar(); return; }
  var f = await cbzCcMotor(ids, "Volviendo a cruzar");
  _cbz.cc.msg = f ? "⚠ " + f + " lote(s) no se cruzaron. Probá de nuevo." : "✔ Volví a cruzar " + ids.length + " movimientos.";
  cbzCcRefrescar();
}

/* ------------------------------ resolver ------------------------------- */
async function cbzCcResolver(id, cod) {
  var rec = document.getElementById("cbzRec" + id);
  var r = await _cbzRpc("gv_conc_resolver", { p_id: Number(id), p_cod: cod || null, p_nota: null, p_recordar: !!(rec && rec.checked) });
  if (r.error) { alert("No se guardó: " + r.error); return; }
  var d = r.data || {};
  _cbz.cc.msg = cod ? "✔ Asignado a " + (d.cliente || cod) + (d.alias ? " · el CUIT queda recordado para ese cliente" : "") : "✔ Marcado como No identificado";
  _cbz.cc.abierto = null; cbzCcRefrescar();
}
function cbzCcAsignar(id) {
  var i = document.getElementById("cbzCod" + id), v = i ? String(i.value || "").trim() : "";
  if (!v) { if (i) i.focus(); return; }
  cbzCcResolver(id, v);
}
async function cbzCcConfirmar(ids) {
  if (!ids || !ids.length) return;
  var r = await _cbzRpc("gv_conc_confirmar", { p_ids: ids.map(Number) });
  if (r.error) { alert("No se confirmó: " + r.error); return; }
  _cbz.cc.msg = "✔ Confirmados: " + (typeof r.data === "number" ? r.data : ids.length);
  cbzCcRefrescar();
}
function cbzCcConfirmarPropuestos() {
  cbzCcConfirmar((_cbz.cc.movs || []).filter(function (m) { return m.estado === "propuesto"; }).map(function (m) { return m.id; }));
}
function cbzCcAbrir(id) { _cbz.cc.abierto = (_cbz.cc.abierto === id) ? null : id; cbzConcPintar(); }

/* Teléfono de cada candidato: el mismo lookup por (empresa, cod) del pipeline de clientes
   nuevos. Se pide en SU propia llamada: si falla, la pantalla sigue sin teléfonos. */
async function cbzCcTelefonos(movs) {
  var pedir = {}, lista = [];
  (movs || _cbz.cc.movs || []).forEach(function (m) {
    if (m.estado !== "pregunta" && m.estado !== "propuesto") return;
    ((m.candidatos && m.candidatos.lista) || []).forEach(function (x) {
      var k = String(x.cod || ""); if (!k || pedir[k] || (_cbz.cc.wpp && _cbz.cc.wpp[k] !== undefined)) return;
      pedir[k] = 1; lista.push({ empresa: m.empresa, cod: k });
    });
  });
  if (!lista.length) return;
  var r = await _cbzRpc("gv_cliente_nuevo_wpp_lote", { p_pedidos: lista });
  if (r.error) return;
  _cbz.cc.wpp = _cbz.cc.wpp || {};
  (r.data || []).forEach(function (x) { _cbz.cc.wpp[String(x.cod)] = x.telefono || null; });
  cbzConcPintar();
}

/* ---------------------------- export planilla ---------------------------- */
function _cbzCcXlsNum(v) { var n = _cbzNum(v); return n ? String(n.toFixed(2)).replace(".", ",") : ""; }
function cbzCcTsv() {
  var ms = (_cbz.cc.movs || []).slice().sort(function (a, b) { return String(a.fecha).localeCompare(String(b.fecha)) || (a.id - b.id); });
  return ms.map(function (m) {
    var ident = m.estado !== "pregunta";   // lo que nadie resolvio sale como el Manual manda: No Identificado
    var f = String(m.fecha || "").split("-");
    return [
      f.length === 3 ? f[2] + "/" + f[1] + "/" + f[0] : "", m.operacion || "", _cbzCcXlsNum(m.credito), _cbzCcXlsNum(m.debito), "",
      ident ? (m.detalle || m.operacion || "") : "No Identificado",
      m.det === "?" ? "" : (m.det || ""), m.nro_op || "", m.nro_recibo || "", m.cod_cliente || ""
    ].map(function (x) { return String(x).replace(/[\t\n]/g, " "); }).join("\t");
  }).join("\n");
}
async function cbzCcCopiar() {
  var t = cbzCcTsv(), n = (_cbz.cc.movs || []).length;
  var pend = (_cbz.cc.movs || []).filter(function (m) { return m.estado === "pregunta"; }).length;
  try { await navigator.clipboard.writeText(t); _cbz.cc.msg = "✔ Copiadas " + n + " filas (columnas A–J de la planilla). Pegalas arriba de la línea amarilla."; }
  catch (_e) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([t], { type: "text/tab-separated-values" }));
    a.download = "conciliacion-" + String(_cbz.cc.cuenta).replace("|", "-") + ".tsv"; a.click();
    _cbz.cc.msg = "✔ Bajé " + n + " filas en un .tsv (el navegador no dejó copiar).";
  }
  if (pend) _cbz.cc.msg += " ⚠ Quedan " + pend + " preguntas sin resolver: salen como «No Identificado».";
  cbzConcPintar();
}

/* ------------------------------- pantalla ------------------------------- */
function cbzCcPreguntaHtml(m) {
  var cand = (m.candidatos && m.candidatos.lista) || [], ap = m.candidatos && m.candidatos.apareo;
  var prop = m.estado === "propuesto";
  var h = '<div class="cbz-q' + (prop ? " prop" : "") + '">' +
    '<div class="cbz-qhead"><div><span class="cbz-qimp">$ ' + _cbzPlata(m.credito || m.debito, 2).replace(/,00$/, "") + "</span> " +
      '<span style="color:#64748b;">' + _cbzFecha(m.fecha) + (m.sucursal ? " · " + _cbzEsc(m.sucursal) : "") + "</span>" +
      ' <span class="cbz-chip ' + (m.empresa === "chef" ? "cbz-ch" : "cbz-lk") + '">' + _cbzEsc(_cbzCuentaT(m.banco + "|" + m.empresa)) + "</span>" +
      (m.det === "3" ? ' <span class="cbz-chip cbz-info">cheque</span>' : "") + "</div>" +
      (prop ? '<button class="cbz-conf" onclick="cbzCcConfirmar([' + m.id + '])">✔ Confirmar ' + _cbzEsc(m.cod_cliente || "") + "</button>" : "") +
    "</div>" +
    '<div class="cbz-qtxt">' + _cbzEsc(m.concepto) + "</div>" +
    (m.cuit ? '<div class="cbz-qsub">CUIT <b>' + _cbzEsc(m.cuit) + "</b>" + (m.nombre_banco ? " · " + _cbzEsc(m.nombre_banco) : "") + "</div>" : "") +
    (m.alerta ? '<div class="cbz-qal">' + _cbzEsc(m.alerta) + "</div>" : "") +
    (ap && ap.detalle ? '<div class="cbz-qsub">En la planilla: <b>' + _cbzEsc(ap.detalle) + "</b> (" + _cbzEsc(ap.operacion || "") + ")</div>" : "");
  if (cand.length) {
    h += '<table class="cbz-t cbz-qt"><thead><tr><th style="text-align:left;">Candidato</th><th>Cuadra con</th><th>Dto</th><th>Días</th><th>Coincide</th><th>Tel.</th><th></th></tr></thead><tbody>' +
      cand.slice(0, prop ? 5 : 3).map(function (x) {
        var sc = _cbzNum(x.score), niv = sc < 0.0025 ? ["muy alta", "cbz-verde"] : (sc < 0.006 ? ["alta", "cbz-ambar"] : ["baja", ""]);
        var tel = _cbz.cc.wpp ? _cbz.cc.wpp[String(x.cod)] : undefined;
        var telH = tel ? '<a href="https://wa.me/' + _cbzEsc(String(tel).replace(/\D/g, "")) + '" target="_blank" rel="noopener">📞 ' + _cbzEsc(tel) + "</a>" : (tel === null ? '<span style="color:#94a3b8;">sin tel.</span>' : "—");
        var cuadra = (x.via === "junto" ? "junto con otro pago · " : "") + "FC " + _cbzEsc(x.facturas || "—");
        return '<tr><td class="l"><b>' + _cbzEsc(x.cod) + "</b> " + _cbzEsc(x.cliente || "") +
            (x.geo === "misma" ? ' <span class="cbz-chip cbz-ok" title="El depósito se hizo en su provincia">📍 ' + _cbzEsc((x.provincia || [])[0] || "") + "</span>" : "") + "</td>" +
          "<td>" + cuadra + "</td><td>−" + _cbzPlata(_cbzNum(x.dto) * 100, 0) + " %</td><td>" + _cbzEsc(x.dias == null ? "—" : x.dias) + "</td>" +
          '<td class="' + niv[1] + '"><b>' + niv[0] + "</b></td><td>" + telH + "</td>" +
          '<td><button class="cbz-es" onclick="cbzCcResolver(' + m.id + ",'" + _cbzEsc(x.cod) + "')\">Es este</button></td></tr>";
      }).join("") + "</tbody></table>";
  } else {
    h += '<div class="cbz-qsub" style="margin-top:6px;">Ningún importe de factura impaga lo explica.</div>';
  }
  h += '<div class="cbz-qacc">' +
    '<input id="cbzCod' + m.id + '" class="cbz-inp" style="flex:0 0 120px;min-width:0;padding:6px 9px;font-size:13px;" placeholder="Código" onkeydown="if(event.key===\'Enter\')cbzCcAsignar(' + m.id + ')">' +
    '<button class="cbz-back" onclick="cbzCcAsignar(' + m.id + ')">Asignar</button>' +
    '<button class="cbz-back" onclick="cbzCcResolver(' + m.id + ',null)">No identificado</button>' +
    (m.cuit ? '<label class="cbz-qsub" style="margin:0;"><input type="checkbox" id="cbzRec' + m.id + '"> recordar que este CUIT paga por ese cliente</label>' : "") +
    "</div></div>";
  return h;
}

function cbzCcTablaHtml(ver) {
  var h = '<div class="cbz-panel" style="margin-top:10px;overflow:auto;"><table class="cbz-t"><thead><tr>' +
    "<th>Fecha</th><th>Operación</th><th>Entrada</th><th>Salida</th><th style=\"text-align:left;\">Detalle</th><th>DET</th><th>Nro OP</th><th>Cliente</th><th>Estado</th><th style=\"text-align:left;\">Extracto</th></tr></thead><tbody>";
  h += ver.map(function (m) {
    var e = _CBZ_CC_EST.filter(function (x) { return x.id === m.estado; })[0] || { t: m.estado, cls: "" };
    return '<tr class="cbz-clic" onclick="cbzCcAbrir(' + m.id + ')"><td>' + _cbzFecha(m.fecha) + "</td><td>" + _cbzEsc(m.operacion || "—") + "</td>" +
      '<td class="cbz-verde">' + (_cbzNum(m.credito) ? _cbzPlata(m.credito, 2) : "") + "</td>" +
      '<td class="cbz-rojo">' + (_cbzNum(m.debito) ? _cbzPlata(m.debito, 2) : "") + "</td>" +
      '<td class="l">' + _cbzEsc(m.detalle || "—") + "</td><td>" + _cbzEsc(m.det && m.det !== "?" ? m.det : "—") + "</td>" +
      "<td>" + _cbzEsc(m.nro_op || "—") + "</td><td>" + _cbzEsc(m.cod_cliente || "—") + "</td>" +
      '<td><span class="cbz-chip ' + e.cls + '">' + String(e.t).replace(/s$/, "") + "</span></td>" +
      '<td class="l" style="color:#64748b;max-width:340px;overflow:hidden;text-overflow:ellipsis;" title="' + _cbzEsc(m.concepto) + '">' + _cbzEsc(m.concepto) + "</td></tr>" +
      (_cbz.cc.abierto === m.id ? '<tr><td colspan="10" class="cbz-exp">' + cbzCcDetalle(m) + "</td></tr>" : "");
  }).join("");
  return h + "</tbody></table></div>";
}
function cbzCcDetalle(m) {
  var lin = [];
  lin.push("Cómo lo resolvió: <b>" + _cbzEsc(m.metodo || "—") + "</b>" + (m.confianza != null ? " · confianza " + _cbzPlata(_cbzNum(m.confianza) * 100, 0) + " %" : ""));
  if (m.cuit) lin.push("CUIT del extracto: <b>" + _cbzEsc(m.cuit) + "</b>" + (m.nombre_banco ? " (" + _cbzEsc(m.nombre_banco) + ")" : ""));
  if (m.cancela) lin.push("Cancela la(s) factura(s): <b>" + _cbzEsc(m.cancela) + "</b>");
  if (m.candidatos && m.candidatos.apareo) {
    var a = m.candidatos.apareo;
    lin.push("Fila de la planilla: <b>" + _cbzEsc(a.detalle || "—") + "</b> · " + _cbzEsc(a.operacion || "") + (a.conciliada ? " · ya conciliada por la persona" : " · proyectada") + (a.dias ? " · a " + a.dias + " días" : ""));
  }
  if (m.alerta) lin.push('<span class="cbz-rojo">⚠ ' + _cbzEsc(m.alerta) + "</span>");
  if (m.confirmado_por) lin.push("Confirmó: " + _cbzEsc(m.confirmado_por));
  var puede = m.estado !== "pregunta" && m.estado !== "propuesto";
  return lin.join("<br>") + (puede ? '<div class="cbz-qacc"><input id="cbzCod' + m.id + '" class="cbz-inp" style="flex:0 0 120px;min-width:0;padding:6px 9px;font-size:13px;" placeholder="Otro código"><button class="cbz-back" onclick="event.stopPropagation();cbzCcAsignar(' + m.id + ')">Corregir</button></div>' : cbzCcPreguntaHtml(m));
}

window.cbzConcHtml = cbzConcHtml;
window.cbzCcSetCuenta = cbzCcSetCuenta;
window.cbzCcSetVista = cbzCcSetVista;
window.cbzCcFiltro = cbzCcFiltro;
window.cbzCcArchivo = cbzCcArchivo;
window.cbzCcCargarMovs = cbzCcCargarMovs;
window.cbzCcParse = cbzCcParse;
window.cbzCcRecruzar = cbzCcRecruzar;
window.cbzCcResolver = cbzCcResolver;
window.cbzCcAsignar = cbzCcAsignar;
window.cbzCcConfirmar = cbzCcConfirmar;
window.cbzCcConfirmarPropuestos = cbzCcConfirmarPropuestos;
window.cbzCcAbrir = cbzCcAbrir;
window.cbzCcCopiar = cbzCcCopiar;
window.cbzCcTsv = cbzCcTsv;

var _CBZ_DEMO_CONC = [
  { banco: "credicoop", empresa: "lk", movimientos: 26619, entradas: 13845, con_cliente: 12689, con_recibo: 10506, sin_identificar: 1110, monto_sin_identificar: 1031493020, primera: "2021-01-07", ultima: "2026-09-28", archivo: "CONCILIACION CREDICOOP LOEKE.xls" },
  { banco: "credicoop", empresa: "chef", movimientos: 4444, entradas: 606, con_cliente: 12, con_recibo: 16, sin_identificar: 589, monto_sin_identificar: 1022438804, primera: "2012-03-01", ultima: "2026-09-28", archivo: "BANCO CREDICOOP CHEF.xlsm" }
];

/* ------------------------------ datos DEMO ------------------------------- */
/* Sólo se usan si la base no contesta, y la pantalla lo dice con un chip. */
var _CBZ_DEMO_CLIENTES = [
  { empresa: "lk", cod_cliente: "4045", cuit: "30712345678", cliente: "Bazar Monica S. CAP I SECC IV", deuda: 108058.3, vencida: 0, comprobantes_abiertos: 1, dias_mas_vieja: 59, ultimo_pago: "2026-09-28", ultimo_pago_monto: 472524.71, a_reclamar: 108058.3, ret_cliente: 0, agente_retencion: false },
  { empresa: "chef", cod_cliente: "2211", cuit: "30712345678", cliente: "Bazar Monica SRL", deuda: 331020, vencida: 120400, comprobantes_abiertos: 3, dias_mas_vieja: 41, ultimo_pago: "2026-09-12", ultimo_pago_monto: 250000, a_reclamar: 0, ret_cliente: 0.021, agente_retencion: false },
  { empresa: "lk", cod_cliente: "288", cuit: "30556677889", cliente: "Torres Y Liva S.A Cif", deuda: 44999903, vencida: 13435258, comprobantes_abiertos: 11, dias_mas_vieja: 53, ultimo_pago: "2026-09-18", ultimo_pago_monto: 5693184.16, a_reclamar: 38405798, ret_cliente: 0.021, agente_retencion: false },
  { empresa: "chef", cod_cliente: "2686", cuit: "30998877665", cliente: "Dorinka S.R.L", deuda: 91811721, vencida: 0, comprobantes_abiertos: 19, dias_mas_vieja: 81, ultimo_pago: "2026-09-07", ultimo_pago_monto: 1000, a_reclamar: 0, ret_cliente: 0, agente_retencion: true },
  { empresa: "lk", cod_cliente: "862", cuit: "30111222333", cliente: "Muller y Muller", deuda: 8802249, vencida: 0, comprobantes_abiertos: 2, dias_mas_vieja: 3, ultimo_pago: "2026-09-29", ultimo_pago_monto: 11687939, a_reclamar: 28873448, ret_cliente: 0, agente_retencion: false }
];
var _CBZ_DEMO_COMP = [
  { orden: "2026-07-24", fecha: "2026-07-24", comprobantes: "FCA 0004-00035292", facturado: 1080583.02, pendiente: 108058.31, estado: "mal",
    pago_recibo: "14601", pago_fecha: "2026-09-28", pago_monto: 972524.71, dias: 59, dto_tomado: 0.10, dto_ganado: 0.10, retencion: 0, a_reclamar: 108058.3,
    explicacion: "Dos pagos: $500.000 el 15/09 (53 días) y $472.525 el 28/09 (66 días). Ponderado da 59 días → le corresponde −10 %. Queda una NC de descuento por $108.058 y $0,01 de saldo." },
  { orden: "2026-09-25", fecha: "2026-09-25", comprobantes: "FCA 0004-00036023", facturado: 10603863.77, pendiente: 10603863.77, estado: "debe",
    pago_recibo: null, pago_fecha: null, pago_monto: null, dias: 4, dto_tomado: null, dto_ganado: null, a_reclamar: null,
    explicacion: "Debe $10.603.864 · facturada hace 4 días · vence el 24/11." }
];
var _CBZ_DEMO_DEUDA = [
  { comprobante: "FCA 0004-00035292", fecha: "2026-07-24", vence: "2026-09-22", condicion: "Pago Contado -25%", dto_cond: 0.25,
    lista: 1080583.02, pendiente_ancla: 108058.31, cancelado_banco: 972524.71, pendiente: 108058.31, origen: "excel",
    recibos_banco: "14588+14601", dias: 67, vencido: true },
  { comprobante: "FCA 0004-00035901", fecha: "2026-09-12", vence: "2026-11-11", condicion: "Cta Cte 60", dto_cond: 0,
    lista: 818771.18, pendiente_ancla: 818771.18, cancelado_banco: 0, pendiente: 818771.18, origen: "isis nuevo",
    recibos_banco: null, dias: 17, vencido: false }
];
var _CBZ_DEMO_PAGOS = [
  { recibo: "14601", fecha_pago: "2026-09-28", medio: "transferencia", pagado: 472524.71, facturas: "35292", lista: 1080583.02,
    nc: null, dias: 66, dto_tomado: 0.10, dto_ganado: 0.10, retencion: 0, a_reclamar: 0, calidad: "exacta", plazo: 60, atraso: 6 },
  { recibo: "14588", fecha_pago: "2026-09-15", medio: "deposito", pagado: 500000, facturas: "35292", lista: 1080583.02,
    nc: null, dias: 53, dto_tomado: 0.10, dto_ganado: 0.10, retencion: 0, a_reclamar: 0, calidad: "parcial", plazo: 60, atraso: 0 },
  { recibo: "14512", fecha_pago: "2026-09-08", medio: "e-cheque", pagado: 352168.44, facturas: "35640", lista: 440210.55,
    nc: null, dias: 9, dto_tomado: 0.25, dto_ganado: 0.25, retencion: 0, a_reclamar: 0, calidad: "exacta", plazo: 14, atraso: 0 }
];
var _CBZ_DEMO_ENTREGAS = [
  { np: "LK 0122", tanda: "E30A", fecha_salida: "2026-09-29", m3: 3.119, facturado_at: "2026-09-28" },
  { np: "98619", tanda: "D61A", fecha_salida: "2026-09-08", m3: 4.309, facturado_at: "2026-09-08" }
];
var _CBZ_DEMO_CTA = [
  { fecha: "2026-07-24", tipo: "Factura", comprobante: "FC Electr. A 0004-00035292", condicion: "Pago Contado -25%", debe: 1080583.02, haber: 0, saldo: 1080583.02, detalle: null },
  { fecha: "2026-09-15", tipo: "Pago", comprobante: "Recibo 14588", condicion: null, debe: 0, haber: 500000, saldo: 580583.02, detalle: "Credicoop · Depósito" },
  { fecha: "2026-09-28", tipo: "Pago", comprobante: "Recibo 14601", condicion: null, debe: 0, haber: 472524.71, saldo: 108058.31, detalle: "Santander · Transferencia" },
  { fecha: "2026-09-29", tipo: "NC", comprobante: "NC Dto 10 %", condicion: "a emitir", debe: 0, haber: 108058.3, saldo: 0.01, detalle: "Descuento por pago a 59 días" }
];

/* ------------------------------- exports --------------------------------- */
window.openCobranzas = openCobranzas;
window.cbzClose = cbzClose;
window.cbzSetTab = cbzSetTab;
window.cbzRender = cbzRender;
window.cbzBuscar = cbzBuscar;
window.cbzEmpresa = cbzEmpresa;
window.cbzCargarClientes = cbzCargarClientes;
window.cbzAbrir = cbzAbrir;
window.cbzVolver = cbzVolver;
window.cbzSub = cbzSub;
window.cbzFila = cbzFila;
window.cbzConsolidar = cbzConsolidar;
window.cbzEscalaHtml = cbzEscalaHtml;
window.cbzCoronitasFiltrar = cbzCoronitasFiltrar;
window.cbzDeudaHtml = cbzDeudaHtml;
window.cbzPagosHtml = cbzPagosHtml;
window.cbzEntregasHtml = cbzEntregasHtml;
window.cbzFichaTraer = cbzFichaTraer;
