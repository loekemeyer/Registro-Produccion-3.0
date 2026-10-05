/* =========================================================
   recepcion.js — MODO OP de Recepción de Mercadería, integrado en
   Producción Virgilio. Portado de la app "Control-Carga-Remitos-FC"
   (v1.13.0), pruning del modo Admin / Pendientes (eso queda en la otra app).

   Se dispara cuando el operario toca **RT (Recepción Mercadería)** y abre el
   flujo: Talleristas / Prov. Art. Terminado → buscar → línea + fecha →
   N° RTO/FC → grilla de códigos con pop-up de cajas → resumen → confirmar.
   Graba en "Entregas Tallerista Virgilio" / "Entregas Prov AT" + deja el
   pendiente en "Control_Modo_OP" (mismo Supabase que Producción).

   AISLAMIENTO: todo el DOM va dentro de #rcpRoot y todo el CSS está scopeado
   bajo #rcpRoot (con sus propias variables), así no pisa ni lo pisan los
   estilos de Producción (que tiene un `button{}` global, etc.).

   PUENTE CON PRODUCCIÓN: al confirmar un envío, suma las cajas al acumulador
   del día en localStorage ("vir_recepcion_cajas_<legajo>_<día>"). Producción
   lo lee al "Terminar Día" para cerrar RT con esa cantidad sin pedirla a mano.
   La app llama window.openRecepcionOp(legajo, dayKey).
   ========================================================= */
/* v10.24 — supabase-js se sirve desde el repo (vendor/supabase.umd.js), no de esm.sh.
   Lo carga index.html con un <script> clasico ANTES de este modulo, asi que el global
   `supabase` ya esta. Antes esto era un `import` a esm.sh: si ese CDN fallaba, Recepcion
   NO abria. */
const { createClient } = (typeof window !== "undefined" && window.supabase) || {};
if (!createClient) throw new Error("Falta vendor/supabase.umd.js (cargalo antes de recepcion.js)");

/* v11.101: URL + key viven en supabase-config.js (index.html la carga con un
   <script> clásico antes de este módulo, igual que vendor/supabase.umd.js). */
const SUPABASE_URL = window.VIR_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = window.VIR_SUPABASE_KEY;
// ⚠ storageKey PROPIA (v5.21): sin esto, este cliente comparte la key default
// "sb-<ref>-auth-token" con el login Google de index.html y el signInAnonymously
// de abajo PISABA la sesión del supervisor (deslogueos "de la nada"). Además:
// detectSessionInUrl:false para no canjear el ?code= del callback OAuth ajeno.
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storageKey: "sb-hrxfctzncixxqmpfhskv-recepcion",
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false
  }
});

// Sesion anonima silenciosa: las policies RLS de INSERT permiten rol authenticated.
const sessionReady = (async () => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) return session;
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) { console.error("Recepcion: anonymous sign-in failed:", error); return null; }
    return data.session;
  } catch (e) { console.error("Recepcion: auth init exception:", e); return null; }
})();

/* ============== Estado del puente con Producción ============== */
const RECP = { legajo: null, dayKey: null };

/* ===== BORRADOR de la recepción en curso (v7.12) =====
   Si el operario arranca una recepción y se va para atrás / cierra la pantalla,
   NO se pierde: el estado (tallerista, línea, fecha, remito y las cajas ya
   marcadas) queda en localStorage por legajo+día. Producción lo lee para mostrar
   el botón "▶ Reanudar" en "Resumen de hoy" (window.recepcionDraftInfo) y lo
   restaura con window.reanudarRecepcionOp, volviendo al MISMO paso donde estaba.
   El borrador se borra al enviar la recepción o al empezar una nueva. */
const RCP_DRAFT_PREFIX = "vir_recepcion_draft_";
function rcpDraftKey(legajo, dayKey) { return RCP_DRAFT_PREFIX + String(legajo || "") + "_" + String(dayKey || ""); }
function rcpDraftNotify() {
  try { if (typeof window.onRecepcionDraftChange === "function") window.onRecepcionDraftChange(); }
  catch (_e) { /* no-op */ }
}
function rcpDraftClear(silencioso) {
  try { if (RECP.legajo && RECP.dayKey) localStorage.removeItem(rcpDraftKey(RECP.legajo, RECP.dayKey)); }
  catch (_e) { /* no-op */ }
  if (!silencioso) rcpDraftNotify();
}
function rcpDraftSave() {
  // Sólo el flujo del OPERARIO (entró por RT, con legajo). El supervisor que entra
  // por el menú de Administración no deja borrador.
  if (!RECP.legajo || !RECP.dayKey || opState.fromMenu === true) return;
  const cargas = opState.cargas || {};
  const hayAlgo = !!opState.tallNombre || Object.keys(cargas).length > 0;
  if (!hayAlgo) { rcpDraftClear(); return; }   // todavía no eligió nada: no hay qué reanudar
  try {
    localStorage.setItem(rcpDraftKey(RECP.legajo, RECP.dayKey), JSON.stringify({
      v: 1, ts: Date.now(), step: opState.step,
      tipo: opState.tipo, tallCod: opState.tallCod, tallNombre: opState.tallNombre,
      tallCods: opState.tallCods, articulosManual: opState.articulosManual,
      linea: opState.linea, fecha: opState.fecha, remito: opState.remito,
      articulos: opState.articulos, cargas: cargas,
      altaNuevos: opState.altaNuevos || {},
      artExtra: opState.artExtra || {}
    }));
  } catch (_e) { /* localStorage lleno / modo privado: no rompe la carga */ }
  rcpDraftNotify();
}
function rcpDraftLoad(legajo, dayKey) {
  const hoy = String(dayKey || "");
  const pref = RCP_DRAFT_PREFIX + String(legajo || "") + "_";
  let d = null;
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k || k.indexOf(pref) !== 0) continue;
      if (k === pref + hoy) { try { d = JSON.parse(localStorage.getItem(k) || "null"); } catch (_e) { d = null; } }
      // Sólo se limpia lo ANTERIOR al día consultado (YYYY-MM-DD compara bien como
      // texto). Con `!==` una consulta por otro día borraba el borrador de hoy.
      else if (k.slice(pref.length) < hoy) localStorage.removeItem(k);
    }
  } catch (_e) { return null; }
  return (d && typeof d === "object") ? d : null;
}
/* Resumen del borrador para el botón de "Resumen de hoy" (lo llama index.html). */
window.recepcionDraftInfo = function (legajo, dayKey) {
  const d = rcpDraftLoad(legajo, dayKey);
  if (!d) return null;
  const cargas = d.cargas || {};
  const cods = Object.keys(cargas).filter(function (c) { return cargas[c] > 0; });
  let cajas = 0; cods.forEach(function (c) { cajas += Number(cargas[c]) || 0; });
  return {
    nombre: displayName(d.tallNombre || ""), linea: d.linea || "", remito: d.remito || "",
    fecha: d.fecha || "", codigos: cods.length, cajas: cajas, step: d.step || "", ts: d.ts || 0
  };
};
function recpAddCajas(n) {
  try {
    if (!RECP.legajo || !RECP.dayKey || !n) return;
    const k = "vir_recepcion_cajas_" + RECP.legajo + "_" + RECP.dayKey;
    const cur = parseInt(localStorage.getItem(k), 10) || 0;
    localStorage.setItem(k, String(cur + n));
  } catch (e) { /* no-op */ }
}

/* ============== CSS (scopeado bajo #rcpRoot) ============== */
const RCP_CSS = `
#rcpRoot{ --border:#d0d7de; --bg:#fafafa; --danger:#b42318; --ok:#0a7a2f; }
#rcpRoot *{ box-sizing:border-box; }
#rcpRoot button{ width:auto; margin:0; }
#rcpRoot .opSubtitle{ font-size:14px; font-weight:700; color:#555; margin:-6px 0 12px; min-height:18px; }
#rcpRoot .opGrid{ display:grid; gap:10px; }
#rcpRoot .opGrid.codes{ grid-template-columns:repeat(auto-fill,minmax(92px,1fr)); }
#rcpRoot .opTipoBtns{ display:flex; flex-direction:column; gap:16px; max-width:420px; margin:10px auto 0; }
#rcpRoot .opTipoBtn{ height:90px; font-size:22px; font-weight:900; border-radius:14px; border:2px solid var(--border); background:#fff; color:#111; cursor:pointer; }
#rcpRoot .opTipoBtn:hover{ border-color:#111; }
/* Botón secundario (Carga Manual): más chico y apagado (v5.93). */
#rcpRoot .opTipoBtn.opBtnSm{ height:52px; font-size:15px; font-weight:700; color:#64748b; }
#rcpRoot .opLista{ display:grid; grid-template-columns:1fr 1fr; gap:10px; }
#rcpRoot .btnBig{ height:52px; font-size:18px; padding:0 24px; }
#rcpRoot .btnAnular{ border:2px solid var(--danger); background:#fff; color:var(--danger); border-radius:10px; padding:10px 16px; font-weight:900; cursor:pointer; }
#rcpRoot .resHeader{ font-size:24px; font-weight:900; margin-bottom:12px; }
#rcpRoot .resList{ display:flex; flex-direction:column; gap:8px; }
#rcpRoot .resItem{ display:flex; align-items:center; justify-content:space-between; border:2px solid var(--border); border-radius:10px; padding:12px 16px; }
#rcpRoot .resCod{ font-size:24px; font-weight:900; color:#111; }
#rcpRoot .resCajas{ font-size:18px; font-weight:900; color:var(--ok); }
#rcpRoot .resTotal{ margin-top:14px; font-size:16px; font-weight:900; color:#333; }
#rcpRoot .cajasCodLine{ font-size:20px; margin-bottom:4px; }
#rcpRoot .cajasCodLine strong{ font-size:34px; }
#rcpRoot .cajasOc{ font-size:13px; font-weight:800; color:#a06000; background:#fff7e6; border:1px solid #ffd98a; border-radius:9px; padding:7px 10px; margin:6px 0 2px; }
#rcpRoot .cajasLabel{ display:block; font-weight:900; font-size:18px; margin:6px 0 10px; }
#rcpRoot .cajasRow{ display:flex; align-items:stretch; gap:12px; }
#rcpRoot .modalCard input[type="text"].cajasInput{ width:104px; height:104px; font-size:48px; font-weight:900; text-align:center; letter-spacing:normal; padding:0; border:2px solid var(--border); border-radius:12px; box-sizing:border-box; flex:0 0 auto; }
#rcpRoot .cajasNext{ flex:1; font-size:24px; font-weight:900; border:0; border-radius:12px; background:#111; color:#fff; cursor:pointer; }
#rcpRoot .cajasActions{ margin-top:12px; display:flex; justify-content:flex-end; }
#rcpRoot .opFechaBox{ position:relative; }
#rcpRoot .opFechaTxt{ display:block; height:64px; line-height:64px; text-align:center; font-size:32px; font-weight:900; border:2px solid var(--border); border-radius:10px; background:#f5f5f5; color:#111; }
#rcpRoot .opFechaHidden{ position:absolute; inset:0; width:100%; height:100%; opacity:0; border:0; margin:0; cursor:pointer; }
#rcpRoot .opNameBtn{ padding:18px 12px; font-weight:900; font-size:16px; border:2px solid var(--border); border-radius:12px; background:#fff; cursor:pointer; text-align:center; line-height:1.2; }
#rcpRoot .opNameBtn:hover{ border-color:#111; }
#rcpRoot .opNameBtn .tag{ display:block; font-size:11px; font-weight:800; color:#a06000; margin-top:4px; }
#rcpRoot input[type="text"].opSearch{ width:100%; height:50px; font-size:18px; letter-spacing:normal; text-align:left; border-radius:10px; border:2px solid var(--border); padding:0 14px; box-sizing:border-box; margin-bottom:14px; }
#rcpRoot .opCodeBtn{ aspect-ratio:1/1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px; font-weight:900; font-size:18px; border:2px solid var(--border); border-radius:12px; background:#fff; cursor:pointer; padding:6px; text-align:center; min-width:0; overflow-wrap:anywhere; }
#rcpRoot .opCodeBtn .cnt{ font-size:12px; font-weight:800; color:var(--ok); }
#rcpRoot .opCodeBtn.loaded{ background:#eef7ee; border-color:var(--ok); color:#333; }
/* v7.07 — detalle de la OC vigente en el botón del código (cuánto se pidió) y
   marca roja cuando lo recibido excede la OC en más de 20%. */
#rcpRoot .opCodeBtn .ocq{ font-size:11px; font-weight:800; color:#a06000; line-height:1.15; }
#rcpRoot .opCodeBtn.exceso{ border-color:var(--danger); background:#fff5f4; }
#rcpRoot .opCodeBtn.exceso .cnt{ color:var(--danger); }
#rcpRoot .opCodeBtn.opCodeAdd{ border:2px dashed var(--ok); color:var(--ok); background:#f6fff8; }
#rcpRoot .opCodeAddPlus{ font-size:34px; line-height:1; font-weight:900; }
/* v21.30 — "Introducir codigo diferente": va para TODOS los proveedores, no solo Log/Fabr. */
#rcpRoot .opCodeOtro{ width:100%; margin-top:14px; padding:18px; font-size:18px; font-weight:900;
  border:2px dashed var(--ok); border-radius:14px; background:#f6fff8; color:var(--ok); cursor:pointer; }
#rcpRoot .opCodeOtroHint{ margin-top:6px; text-align:center; font-size:13px; color:#6b7280; }
#rcpRoot .opLineRow{ display:flex; gap:14px; margin-top:14px; }
#rcpRoot .opLineBtn{ flex:1; height:90px; font-size:24px; font-weight:900; border-radius:14px; border:2px solid var(--border); background:#fff; cursor:pointer; }
#rcpRoot .opLineBtn.active{ background:#111; color:#fff; border-color:#111; }
#rcpRoot .opField{ margin-top:14px; }
#rcpRoot .opField label{ display:block; font-weight:900; margin-bottom:6px; }
#rcpRoot input[type="text"].opRtoInput{ width:100%; height:56px; font-size:30px; letter-spacing:8px; text-align:center; border-radius:10px; border:2px solid var(--border); box-sizing:border-box; }
#rcpRoot .opEmpty{ padding:10px; color:#666; }
#rcpRoot .opOk{ padding:14px; color:var(--ok); font-weight:900; font-size:18px; }
#rcpRoot .opPage{ position:fixed; inset:0; background:var(--bg); overflow:auto; display:none; z-index:1300; }
#rcpRoot .opPage.open{ display:block; }
#rcpRoot .opPageInner{ max-width:780px; margin:0 auto; padding:16px; min-height:100%; box-sizing:border-box; display:flex; flex-direction:column; }
#rcpRoot .opHeader{ display:flex; align-items:center; justify-content:space-between; gap:10px; padding:8px 0 14px; margin-bottom:14px; border-bottom:1px solid var(--border); position:sticky; top:0; background:var(--bg); z-index:6; }
#rcpRoot .opPageTitle{ flex:1; text-align:center; font-size:22px; font-weight:900; }
#rcpRoot .opNav{ background:#fff; border:2px solid var(--border); border-radius:12px; padding:14px 20px; font-size:18px; font-weight:900; cursor:pointer; white-space:nowrap; }
#rcpRoot .opPageBody{ flex:1; }
#rcpRoot .opPageActions{ margin-top:18px; display:flex; flex-wrap:wrap; align-items:center; justify-content:flex-end; gap:10px; position:sticky; bottom:0; background:var(--bg); padding:12px 0; }
#rcpRoot .opPageActions .btnSend{ height:52px; font-size:18px; padding:0 24px; }
#rcpRoot .opPageActions .btnCancel, #rcpRoot .opPageActions .btnAnular{ height:52px; padding:0 16px; }
/* v7.15 — "Anular recepción": salida clara de una sesión abierta por error (mismo
   criterio que el "Anular picking"). Barra propia ABAJO DE TODO, fuera de #opBody y
   de #opActions, así no la pisa ningún render de paso. */
#rcpRoot .opAnularBar:empty{ display:none; }
#rcpRoot .opAnularBar{ padding:4px 0 16px; }
#rcpRoot button.opAnular{ width:100%; margin:0; padding:16px 14px; font-size:19px; font-weight:900; background:#dc2626; color:#fff; border:0; border-radius:12px; cursor:pointer; }
#rcpRoot button.opAnular:hover{ background:#b91c1c; }
#rcpRoot button.opAnular small{ display:block; font-size:12px; font-weight:700; opacity:.9; margin-top:2px; }
#rcpRoot .modal{ position:fixed; inset:0; background:rgba(0,0,0,.45); display:none; align-items:flex-start; justify-content:center; padding:24px; overflow:auto; z-index:1400; }
#rcpRoot .modal.open{ display:flex; }
#rcpRoot .modalCard{ background:#fff; border-radius:14px; padding:20px; width:100%; max-width:360px; max-height:90vh; display:flex; flex-direction:column; }
#rcpRoot .modalHeader{ display:flex; align-items:center; justify-content:space-between; margin-bottom:14px; }
#rcpRoot .modalTitle{ font-size:22px; font-weight:900; }
#rcpRoot .arBusInput{ width:100%; height:48px; font-size:18px; text-align:left; letter-spacing:normal; border-radius:10px; border:2px solid var(--border); padding:0 12px; box-sizing:border-box; }
#rcpRoot .arBusList{ margin-top:12px; overflow-y:auto; flex:1 1 auto; min-height:120px; }
#rcpRoot .arBusRow{ display:flex; align-items:center; gap:10px; width:100%; text-align:left; background:#fff; border:1px solid var(--border); border-radius:10px; padding:10px 12px; margin-bottom:8px; cursor:pointer; font:inherit; }
#rcpRoot .arBusRow:active{ background:#f1f5f9; }
#rcpRoot .arBusCod{ font-weight:900; font-size:17px; flex:0 0 auto; }
#rcpRoot .arBusDesc{ color:#555; font-size:14px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
#rcpRoot .arBusNada{ padding:12px 0; color:#666; font-size:15px; }
#rcpRoot .arBusIgual{ width:100%; margin-top:10px; padding:14px; border-radius:10px; border:2px solid #b45309; background:#fffbeb; color:#7c2d12; font-weight:800; font-size:16px; cursor:pointer; }
/* v18.08 (Luis): la × se veía descentrada y apenas se distinguía del fondo. El botón no tenía
   display:flex, así que la centraba el user-agent con su padding propio, y era un círculo blanco
   con borde gris clarito arriba de una tarjeta blanca. Ahora: gris suave sin borde, la × centrada
   de verdad y legible, y con estados de toque — esto lo usa un operario con el celular en la mano. */
#rcpRoot .modalClose{ display:flex; align-items:center; justify-content:center; flex:0 0 auto;
  width:34px; height:34px; padding:0; line-height:1; border:none; border-radius:50%;
  background:#eef2f7; color:#475569; font-size:22px; font-weight:700; cursor:pointer;
  transition:background .12s, color .12s; -webkit-tap-highlight-color:transparent;
  touch-action:manipulation; }
#rcpRoot .modalClose:hover{ background:#e2e8f0; color:#0f172a; }
#rcpRoot .modalClose:active{ background:#cbd5e1; }
#rcpRoot .modalClose:focus-visible{ outline:2px solid #1e6bd6; outline-offset:2px; }
/* v17.27 — aviso a Thomas por lo que entró por encima de la OC: va en la pantalla de
   resumen, debajo de la foto, y es obligatorio igual que la foto. */
#rcpRoot .opExcSection{ margin:16px 0 4px; text-align:center; }
#rcpRoot .opExcWaBtn{ width:100%; padding:18px; font-size:18px; font-weight:900; border:2px dashed #25d366; border-radius:14px; background:#fff; color:#12813f; cursor:pointer; }
#rcpRoot .opExcWaBtn.has{ border-style:solid; background:#e9f9ef; }
#rcpRoot .opExcHint{ font-size:13px; color:#b91c1c; font-weight:700; margin-top:6px; }
#rcpRoot .btnCancel{ padding:10px 16px; border-radius:10px; border:1px solid var(--border); background:#fff; font-weight:900; cursor:pointer; }
#rcpRoot .btnSend{ padding:10px 16px; border-radius:10px; border:0; background:#111; color:#fff; font-weight:900; cursor:pointer; }
/* Pendientes (Marianela) = TARJETAS verticales (sin scroll horizontal): tilde + No
   corresponde + foto (adjuntar/arrastrar) + Enviar (código). */
#rcpRoot .opPage.pendWide .opPageInner{ max-width:none; }   /* PC: usa todo el ancho */
#rcpRoot .pendCards{ display:grid; grid-template-columns:repeat(auto-fill, minmax(min(100%, 360px), 360px)); gap:12px; align-items:start; }
#rcpRoot .pendCard{ border:2px solid var(--border); border-radius:14px; background:#fff; padding:12px 14px; }
#rcpRoot .pendCard.sentRow{ border-color:var(--ok); background:#f6fff8; }
#rcpRoot .pcHead{ display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
#rcpRoot .pcName{ font-size:18px; font-weight:900; color:#111; }
#rcpRoot .pcTag{ font-size:11px; font-weight:800; color:#a06000; background:#fff7e6; border:1px solid #ffd98a; border-radius:999px; padding:2px 8px; }
#rcpRoot .pcRto{ margin-left:auto; font-size:13px; font-weight:800; color:#475569; white-space:nowrap; }
#rcpRoot .pcMeta{ font-size:13px; color:#666; margin-top:3px; }
#rcpRoot .pcDemora{ font-weight:900; color:#b45309; font-size:14px; }
#rcpRoot .pcEntrega{ font-size:14px; color:#333; margin-top:6px; font-variant-numeric:tabular-nums; word-break:break-word; }
#rcpRoot .pcActs{ margin-top:10px; border-top:1px solid #eee; padding-top:10px; display:flex; flex-direction:column; gap:10px; }
#rcpRoot .pcRow{ display:flex; align-items:center; gap:12px; }
#rcpRoot .pcRow.pcFotoRow{ flex-wrap:wrap; }
#rcpRoot .pcLbl{ font-size:16px; font-weight:800; color:#111; }
#rcpRoot .tickBtn{ width:28px; height:28px; border-radius:8px; border:2px solid #cbd5e1; background:#fff; font-size:0; cursor:pointer; position:relative; padding:0; flex:0 0 auto; }
#rcpRoot .tickBtn.on{ background:var(--ok); border-color:var(--ok); }
#rcpRoot .tickBtn.on::after{ content:""; position:absolute; left:50%; top:46%; width:7px; height:13px; border:solid #fff; border-width:0 3px 3px 0; transform:translate(-50%,-50%) rotate(45deg); }
#rcpRoot .noBtn{ margin-left:auto; padding:8px 12px; font-size:12px; font-weight:800; border:2px solid var(--border); border-radius:9px; background:#fff; color:#111; cursor:pointer; white-space:nowrap; }
#rcpRoot .noBtn.on{ background:var(--danger); border-color:var(--danger); color:#fff; }
#rcpRoot .pcFotoRow .fotoDrop{ flex:1; }
#rcpRoot .fotoDrop{ display:inline-flex; align-items:center; justify-content:center; min-width:160px; min-height:46px; padding:8px 12px; border:2px dashed #cbd5e1; border-radius:10px; background:#fff; cursor:pointer; font-weight:800; font-size:13px; color:#475569; }
#rcpRoot .fotoDrop.has{ border-style:solid; border-color:var(--ok); color:var(--ok); background:#eef7ee; }
#rcpRoot .fotoDrop.drag{ border-color:#1e6bd6; background:#eff6ff; }
/* v11.xx — Foto del operario en resumen */
#rcpRoot .opFotoSection{ margin:16px 0 4px; text-align:center; }
#rcpRoot .opFotoBtn{ width:100%; padding:18px; font-size:18px; font-weight:900; border:2px dashed #94a3b8; border-radius:14px; background:#fff; color:#475569; cursor:pointer; }
#rcpRoot .opFotoBtn.has{ border-style:solid; border-color:var(--ok); color:var(--ok); background:#eef7ee; }
#rcpRoot .opFotoPreview{ margin-top:10px; }
#rcpRoot .opFotoPreview img{ max-width:100%; max-height:220px; border-radius:10px; border:2px solid var(--ok); }
#rcpRoot .opFotoHint{ font-size:13px; color:#b91c1c; font-weight:700; margin-top:6px; }
/* v11.xx — Admin: visor de foto (en pendientes) */
#rcpRoot .fotoViewBtn{ display:inline-flex; align-items:center; gap:6px; padding:8px 14px; border:2px solid #cbd5e1; border-radius:10px; background:#fff; font-weight:800; font-size:13px; color:#475569; cursor:pointer; flex:1; justify-content:center; min-height:46px; }
#rcpRoot .fotoViewBtn.viewed{ border-color:var(--ok); color:var(--ok); background:#eef7ee; }
#rcpRoot .fotoViewBtn.noFoto{ border-color:#e5e7eb; color:#9ca3af; cursor:default; font-style:italic; }
#rcpRoot .fotoViewBtn.noFoto.addFoto{ cursor:pointer; border-style:dashed; color:#475569; }
#rcpRoot .pcFotoPost{ flex-basis:100%; font-size:12px; font-weight:700; color:#475569; }
#rcpRoot .rcbFile{ margin-top:10px; width:100%; font-size:14px; }
#rcpRoot .fotoOverlay{ position:fixed; inset:0; background:rgba(0,0,0,.88); display:flex; align-items:center; justify-content:center; z-index:1500; padding:16px; overflow:auto; }
#rcpRoot .fotoOverlay img{ max-width:100%; max-height:88vh; border-radius:8px; object-fit:contain; }
#rcpRoot .fotoOverlayClose{ position:absolute; top:14px; right:14px; width:48px; height:48px; border-radius:50%; background:#fff; border:0; font-size:22px; font-weight:900; cursor:pointer; display:flex; align-items:center; justify-content:center; box-shadow:0 2px 8px rgba(0,0,0,.3); z-index:2; }
/* v12.07 — La foto y lo que cargó el operario, JUNTOS en el mismo visor. Antes había
   que cerrar la foto para leer los códigos/cajas y volver a abrirla para cotejar. */
#rcpRoot .fotoOverlayBox{ display:flex; align-items:center; justify-content:center; gap:14px; width:100%; max-width:1280px; margin:auto; }
#rcpRoot .fotoOverlayImg{ flex:1 1 auto; min-width:0; display:flex; align-items:center; justify-content:center; }
#rcpRoot .fotoOverlayInfo{ flex:0 0 330px; max-width:330px; max-height:88vh; overflow:auto; background:#fff; border-radius:12px; padding:14px 16px; box-shadow:0 2px 14px rgba(0,0,0,.4); }
#rcpRoot .fovName{ font-size:19px; font-weight:900; color:#111; }
#rcpRoot .fovMeta{ font-size:13px; font-weight:700; color:#475569; margin-top:2px; }
#rcpRoot .fovRto{ font-size:14px; font-weight:900; color:#111; margin-top:4px; }
#rcpRoot .fovTit{ font-size:12px; font-weight:900; color:#64748b; text-transform:uppercase; letter-spacing:.5px; margin:12px 0 6px; border-top:1px solid #e5e7eb; padding-top:10px; }
#rcpRoot .fovItem{ display:flex; align-items:baseline; justify-content:space-between; gap:10px; padding:5px 0; border-bottom:1px dashed #eef2f7; font-variant-numeric:tabular-nums; }
#rcpRoot .fovCod{ font-size:16px; font-weight:900; color:#111; word-break:break-word; }
#rcpRoot .fovCaj{ font-size:17px; font-weight:900; color:#0a7a2f; white-space:nowrap; }
#rcpRoot .fovTotal{ display:flex; align-items:baseline; justify-content:space-between; gap:10px; margin-top:10px; padding-top:9px; border-top:2px solid #111; font-size:17px; font-weight:900; color:#111; font-variant-numeric:tabular-nums; }
#rcpRoot .fovRaw{ font-size:15px; font-weight:800; color:#111; word-break:break-word; }
@media (max-width:860px){
  #rcpRoot .fotoOverlayBox{ flex-direction:column; align-items:stretch; gap:10px; }
  #rcpRoot .fotoOverlayInfo{ flex:0 0 auto; max-width:none; max-height:38vh; }
  #rcpRoot .fotoOverlay img{ max-height:46vh; }
}
#rcpRoot .pcFoot{ margin-top:10px; display:flex; align-items:center; justify-content:flex-end; gap:12px; }
#rcpRoot .enviarBtn{ padding:11px 22px; font-size:16px; font-weight:900; border:0; border-radius:11px; background:#111; color:#fff; cursor:pointer; }
#rcpRoot .enviarBtn:disabled{ opacity:.4; cursor:default; }
/* v22.48 (Luis, 25/09) — botón «Recibido» en Pendientes + cuadro de quién recibe. */
#rcpRoot .pcRecHint{ font-size:12px; font-weight:700; color:#64748b; }
/* v24.89 (Mel, 30/09) — «No recibido» a la derecha de Recibido, mismo criterio que «No corresponde».
   El rótulo y el quién/cuándo van apilados para que el botón entre en la misma fila. */
#rcpRoot .pcRecLblBox{ display:flex; flex-direction:column; min-width:0; }
#rcpRoot .pcActs .noBtn{ min-width:128px; text-align:center; }
#rcpRoot .tickBtn:disabled{ opacity:.45; cursor:default; }
#rcpRoot .rcbOverlay{ position:fixed; inset:0; background:rgba(15,23,42,.45); display:flex; align-items:center; justify-content:center; z-index:9999; padding:16px; }
#rcpRoot .rcbBox{ background:#fff; border-radius:14px; padding:16px; width:100%; max-width:380px; }
#rcpRoot .rcbT{ font-size:17px; font-weight:900; color:#111; }
#rcpRoot .rcbSub{ font-size:13px; color:#555; margin-top:4px; }
#rcpRoot .rcbOps{ display:flex; gap:8px; flex-wrap:wrap; margin-top:12px; }
#rcpRoot .rcbOp{ padding:9px 16px; border-radius:999px; border:2px solid var(--border); background:#fff; font-weight:800; font-size:15px; cursor:pointer; }
#rcpRoot .rcbOp.on{ background:#111; border-color:#111; color:#fff; }
#rcpRoot .rcbOtro{ width:100%; margin-top:10px; padding:10px; font-size:15px; border:2px solid var(--border); border-radius:10px; box-sizing:border-box; }
#rcpRoot .rcbErr{ color:var(--danger); font-size:13px; font-weight:700; margin-top:8px; min-height:1em; }
#rcpRoot .rcbBtns{ display:flex; gap:8px; justify-content:flex-end; margin-top:12px; }
#rcpRoot .codigoBox{ font-size:26px; font-weight:900; letter-spacing:4px; color:#0a7a2f; font-variant-numeric:tabular-nums; }
/* Histórico de recepción (v6.41): barra de filtros + tabla. */
#rcpRoot .histBar{ display:flex; flex-wrap:wrap; gap:10px; align-items:flex-end; margin-bottom:10px; }
#rcpRoot .histField{ display:flex; flex-direction:column; gap:4px; }
#rcpRoot .histField label{ font-size:12px; font-weight:800; color:#475569; }
#rcpRoot .histField input{ height:44px; border:2px solid var(--border); border-radius:10px; padding:0 12px; font-size:16px; font-weight:700; background:#fff; box-sizing:border-box; }
#rcpRoot input[type="text"].histCod{ width:150px; letter-spacing:normal; text-align:left; }
#rcpRoot .histField input.histDate{ width:158px; }
#rcpRoot .histBtns{ display:flex; gap:8px; }
#rcpRoot .histBtn{ height:44px; padding:0 18px; border-radius:10px; border:2px solid var(--border); background:#fff; font-weight:900; font-size:15px; cursor:pointer; }
#rcpRoot .histBtn.pri{ background:#111; color:#fff; border-color:#111; }
/* v6.55: "+" que despliega los filtros extra (Quién entregó / Remito / Cajas mín.).
   v6.56: va a la DERECHA del buscador principal, en dos líneas: "+" arriba, "filtros" abajo. */
#rcpRoot .histBtn.plus{ padding:0 12px; display:flex; flex-direction:column; align-items:center; justify-content:center; line-height:1.05; }
#rcpRoot .histBtn.plus .plusIco{ font-size:15px; font-weight:900; }
#rcpRoot .histBtn.plus .plusTxt{ font-size:10px; font-weight:800; color:#475569; }
#rcpRoot .histBtn.plus.on{ border-color:#111; background:#f1f5f9; }
#rcpRoot .histMore{ display:none; }
#rcpRoot .histMore.show{ display:flex; }
#rcpRoot .histPresets{ display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px; }
#rcpRoot .histChip{ padding:7px 14px; border-radius:999px; border:2px solid var(--border); background:#fff; font-weight:800; font-size:13px; cursor:pointer; color:#334155; }
#rcpRoot .histChip:hover{ border-color:#111; }
#rcpRoot .histSummary{ font-size:14px; font-weight:800; color:#0f172a; margin-bottom:8px; }
#rcpRoot .histSummary b{ color:var(--ok); }
#rcpRoot .histNote{ font-size:12.5px; color:#b45309; font-weight:700; margin-bottom:10px; }
#rcpRoot .histTblWrap{ overflow-x:auto; -webkit-overflow-scrolling:touch; border:1px solid var(--border); border-radius:12px; }
#rcpRoot table.histTbl{ width:100%; border-collapse:collapse; font-size:14px; min-width:520px; }
#rcpRoot table.histTbl th.histSortTh{ cursor:pointer; user-select:none; white-space:nowrap; }
#rcpRoot table.histTbl th.histSortTh.on{ color:#111; }
#rcpRoot .histSortIco{ font-size:10px; opacity:.7; }
#rcpRoot table.histTbl th{ text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.04em; color:#64748b; font-weight:900; padding:10px 12px; background:#f1f5f9; position:sticky; top:0; }
#rcpRoot table.histTbl td{ padding:9px 12px; border-top:1px solid #eef2f6; vertical-align:top; }
#rcpRoot .histCodCell{ font-weight:900; color:#111; font-family:Consolas,Menlo,monospace; white-space:nowrap; }
#rcpRoot .histCaj{ font-weight:900; color:var(--ok); text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
#rcpRoot .histFe{ white-space:nowrap; color:#334155; font-weight:700; }
#rcpRoot .histWho{ color:#334155; }
#rcpRoot .histWho .provTag{ font-size:10px; font-weight:800; color:#a06000; background:#fff7e6; border:1px solid #ffd98a; border-radius:999px; padding:1px 7px; margin-right:5px; }
#rcpRoot .histWho .histDesc{ color:#94a3b8; }
#rcpRoot .histRto{ color:#64748b; font-variant-numeric:tabular-nums; white-space:nowrap; }
#rcpRoot .histRcb{ color:#15803d; font-weight:700; white-space:nowrap; }
#rcpRoot .histDem{ text-align:right; font-weight:800; color:#b45309; font-variant-numeric:tabular-nums; white-space:nowrap; }
#rcpRoot .histLoading, #rcpRoot .histEmpty{ padding:26px; text-align:center; color:#64748b; font-weight:700; }
`;

/* ============== DOM (inyectado dentro de #rcpRoot) ============== */
const RCP_HTML = `
<div id="opPage" class="opPage">
  <div class="opPageInner">
    <div class="opHeader">
      <button id="opBack" class="opNav" style="display:none">‹ Atrás</button>
      <div id="opTitle" class="opPageTitle">Recepción</div>
      <button id="opClose" class="opNav">✕ Salir</button>
    </div>
    <div id="opSubtitle" class="opSubtitle"></div>
    <div id="opBody" class="opPageBody"></div>
    <div id="opActions" class="opPageActions"></div>
    <div id="opAnularBar" class="opAnularBar"></div>
  </div>
</div>
<div id="arBusModal" class="modal" role="dialog" aria-modal="true">
  <div class="modalCard">
    <div class="modalHeader">
      <div class="modalTitle">Agregar artículo</div>
      <button id="arBusClose" class="modalClose" aria-label="Cerrar">×</button>
    </div>
    <input id="arBusInput" class="arBusInput" type="text" inputmode="text" autocomplete="off"
           placeholder="Código o nombre del artículo…" />
    <div id="arBusList" class="arBusList"></div>
  </div>
</div>
<div id="opCajasModal" class="modal" role="dialog" aria-modal="true">
  <div class="modalCard">
    <div class="modalHeader">
      <div class="modalTitle" id="opCajasTit">Cajas entregadas</div>
      <button id="opCajasClose" class="modalClose" aria-label="Cerrar">×</button>
    </div>
    <div class="cajasCodLine">Código <strong id="opCajasCod"></strong></div>
    <div id="opCajasOc" class="cajasOc" style="display:none"></div>
    <label for="opCajasInput" class="cajasLabel" id="opCajasLbl">¿Cuántas cajas?</label>
    <div class="cajasRow">
      <input id="opCajasInput" class="cajasInput" type="text" inputmode="numeric" />
      <button id="opCajasNext" class="cajasNext">Siguiente</button>
    </div>
    <div class="cajasActions">
      <button id="opCajasDelete" class="btnCancel" style="display:none">Quitar</button>
    </div>
  </div>
</div>
`;

const rcpRoot = document.createElement("div");
rcpRoot.id = "rcpRoot";
rcpRoot.innerHTML = RCP_HTML;
const rcpStyle = document.createElement("style");
rcpStyle.textContent = RCP_CSS;
document.head.appendChild(rcpStyle);
document.body.appendChild(rcpRoot);

/* ============== Refs ============== */
const opPage = document.getElementById("opPage");
const opTitle = document.getElementById("opTitle");
const opSubtitle = document.getElementById("opSubtitle");
const opBody = document.getElementById("opBody");
const opActions = document.getElementById("opActions");
const opBack = document.getElementById("opBack");
const opClose = document.getElementById("opClose");
const opCajasModal = document.getElementById("opCajasModal");
const opCajasCod = document.getElementById("opCajasCod");
const opCajasInput = document.getElementById("opCajasInput");
const opCajasNext = document.getElementById("opCajasNext");
const opCajasDelete = document.getElementById("opCajasDelete");
const opCajasClose = document.getElementById("opCajasClose");
const opCajasOc = document.getElementById("opCajasOc");
const opAnularBar = document.getElementById("opAnularBar");
const arBusModal = document.getElementById("arBusModal");
const arBusInput = document.getElementById("arBusInput");
const arBusList = document.getElementById("arBusList");
const arBusClose = document.getElementById("arBusClose");

const opState = {
  step: null,
  tipo: null,        // 'tallerista' | 'prov_at'
  entidades: null,   // lista completa para el buscador
  tallCod: null, tallNombre: null,
  tallCods: null,    // { LK:codigo, CH:codigo } del tallerista (prov_at: {LK:true,CH:true})
  articulosManual: null,
  linea: null, fecha: null,
  remito: "",
  articulos: null,   // [{Cod_Art, Desc}]
  cargas: {},        // { Cod_Art: cajas }
  cajasCod: null,    // codigo abierto en el popup
  excesoAvisado: null, // v17.27: firma cod:cajas del exceso ya avisado a Thomas por WhatsApp
  excesoGond: null,    // v17.27: { codNorm: {cap,gond} } para el mensaje de WhatsApp
  excesoGondFirma: null, // v18.02: firma para la que ya se pidió la góndola (no repetir)
  listaTipo: null,
  ocPorCod: null,    // v7.07: OCs vigentes del proveedor { codNorm: {ped,rec,pend,fecha} } (null = sin cargar)
  ocOk: false,       // v17.99: true sólo si la RPC de OCs contestó (sin eso no se exige el aviso)
  ocAjena: null,     // v19.57: códigos que NO están en SU OC pero sí en la de otro { codNorm: {otros,pend,...} }
  artExtra: null     // v21.30: { codNorm: true } de los códigos que el operario agregó a mano
                     //          con "Introducir código diferente" (NO estaban asignados a este proveedor)
};

/* v3.81-fix: usar TZ Argentina (igual que getTodayKey() en index.html) en
   vez de la hora LOCAL del dispositivo. Si la tablet tiene TZ mal configurada
   (UTC, etc.), el operario veía "hoy" en fecha incorrecta y descuadraba la
   ventana de OC vigente y el Dia_mes grabado en Entregas Tallerista. */
function opTodayStr() {
  try {
    const d = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Argentina/Buenos_Aires" }));
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return yyyy + "-" + mm + "-" + dd;
  } catch (_e) {
    // Fallback: hora local del dispositivo (mejor que nada)
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return yyyy + "-" + mm + "-" + dd;
  }
}

/* ===== v7.15 — ANULAR la sesión de recepción =====
   "✕ Salir" sólo cierra la pantalla: el toggle RT sigue ABIERTO en Supabase (y el
   operario, al volver a tocar RT, cae en el cierre "Indicar Cantidad"). Esto la anula
   de verdad: tira el borrador y le pide a Producción que cierre el RT y borre el
   apertura (window.anularRecepcionSesion). v25.63: ya no se borra la apertura: se registra el
   cierre del RT con texto ANULADO.
   La barra vive fuera de #opBody/#opActions, así queda en TODOS los pasos del
   operario; el supervisor (menú de Administración) no la ve. */
function opAnularBarRender(mostrar) {
  if (!opAnularBar) return;
  opAnularBar.innerHTML = (mostrar && RECP.legajo)
    ? '<button type="button" class="opAnular">✕ Anular recepción<small>descarta lo cargado y cierra la sesión</small></button>'
    : "";
  const b = opAnularBar.querySelector("button");
  if (b) b.onclick = opAnularSesion;
}
async function opAnularSesion() {
  const legajo = RECP.legajo;
  const cargados = Object.keys(opState.cargas || {}).filter(function (c) { return opState.cargas[c] > 0; }).length;
  if (!confirm("¿ANULAR esta recepción?\n\n" +
      (cargados ? "Se descartan los " + cargados + " código(s) que marcaste y se " : "Se ") +
      "cierra la sesión de Recepción (RT).\n\nNo se puede deshacer.")) return;
  let hecho = true;
  try {
    if (typeof window.anularRecepcionSesion === "function") hecho = await window.anularRecepcionSesion(legajo);
  } catch (e) { console.warn("anularRecepcionSesion:", e); }
  if (hecho === false) return;   // Producción lo frenó (2ª confirmación cancelada)
  opResetState();                // deja el estado vacío → closeOp borra el borrador
  closeOp();
  alert("✕ Recepción anulada.");
}

/* ============== Navegación ============== */
function opResetState() {
  opState.t0 = Date.now();      // v23.71: inicio de ESTA carga (tramo de RT si se envía con RT cerrado)
  opState.step = null;
  opState.tipo = null;
  opState.entidades = null;
  opState.tallCod = null; opState.tallNombre = null; opState.tallCods = null;
  opState.articulosManual = null;
  opState.linea = null; opState.fecha = opTodayStr();
  opState.remito = ""; opState.articulos = null; opState.cargas = {};
  opState.altaNuevos = {};      // v15.36: altas del "+" esperando el OK de Thomas
  opState.artExtra = {};        // v21.30: códigos agregados a mano en esta recepción
  opState.ocPorCod = null; opState.ocOk = false; opState.ocAjena = null;   // v19.57
  opState.excesoAvisado = null; opState.excesoGond = null; opState.excesoGondFirma = null;   // v18.02
  opState.fotoFile = null;
  if (opState.fotoPreviewUrl) { try { URL.revokeObjectURL(opState.fotoPreviewUrl); } catch(_e){} }
  opState.fotoPreviewUrl = null;
}
function openOp() {
  opResetState();
  opState.fromMenu = false;     // operario (RT) entra directo a la carga, sin menú
  rcpDraftClear(true);          // v7.12: recepción NUEVA → el borrador anterior ya no sirve
  opPage.classList.remove("pendWide");
  opPage.classList.add("open");
  opAnularBarRender(true);
  renderTipoElegir();
}
/* v7.12 — REANUDAR: vuelve a la recepción que el operario dejó por la mitad, en el
   MISMO paso en el que estaba (lo llama el botón "▶ Reanudar" de "Resumen de hoy").
   Sin borrador cae al flujo normal, así el botón nunca deja al operario colgado. */
window.reanudarRecepcionOp = function (legajo, dayKey) {
  RECP.legajo = String(legajo || "").trim() || null;
  RECP.dayKey = dayKey || opTodayStr();
  const d = rcpDraftLoad(RECP.legajo, RECP.dayKey);
  if (!d) { openOp(); return; }
  opResetState();
  opState.fromMenu = false;
  opState.tipo = d.tipo || null;
  opState.tallCod = d.tallCod || null;
  opState.tallNombre = d.tallNombre || null;
  opState.tallCods = d.tallCods || null;
  opState.articulosManual = d.articulosManual || null;
  opState.linea = d.linea || null;
  opState.fecha = d.fecha || opTodayStr();
  opState.remito = d.remito || "";
  opState.articulos = d.articulos || null;
  opState.cargas = d.cargas || {};
  opState.altaNuevos = d.altaNuevos || {};   // v15.36: altas pendientes de OK
  opState.artExtra = d.artExtra || {};       // v21.30: códigos agregados a mano
  if (Object.keys(opState.altaNuevos).some(function (c) { return opState.altaNuevos[c].estado === "pendiente"; })) altaPollStart();
  opPage.classList.remove("pendWide");
  opPage.classList.add("open");
  opAnularBarRender(true);
  if (d.step === "resumen" && Object.keys(opState.cargas).length) renderResumen();
  else if (d.step === "articulos" && opState.linea) renderArticulos();
  else if (d.step === "remito" && opState.linea) renderRemito();
  else if (opState.tallNombre) renderLinea();
  else renderTipoElegir();
};
let _pendTimer = null;   // timer del "hace X hs" en vivo de Pendientes
let _deepLinkRemito = null;  // remito a resaltar al abrir Pendientes desde Planify
function closeOp() {
  rcpDraftSave();   // v7.12: salir NO pierde la recepción a medio cargar
  opAnularBarRender(false);
  opPage.classList.remove("open");
  if (_pendTimer) { clearInterval(_pendTimer); _pendTimer = null; }
}
opClose.onclick = closeOp;

opBack.onclick = () => {
  if (opState.step === "tipo" || opState.step === "pend" || opState.step === "racks" || opState.step === "hist" || opState.step === "histbaj") renderMenu();
  else if (opState.step === "lista") renderTipoElegir();
  else if (opState.step === "linea") renderLista(opState.tipo);
  else if (opState.step === "tipoDoc") renderLinea();
  else if (opState.step === "docFields") renderTipoDoc();
  else if (opState.step === "remito") renderLinea();
  else if (opState.step === "articulos") renderDocFields();
  else if (opState.step === "resumen") renderArticulos();
};

function opSetBack(show) { opBack.style.display = show ? "" : "none"; }

function opNorm(s) { return (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
function displayName(s) {
  return (s || "").replace(/\S+/g, w => /[a-z]/.test(w) ? w : (w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()));
}

const ORDEN_TALL = ["Poly", "Martin", "Lucho", "Rafael", "Carlos", "Garcia", "Pedernera", "German", "BlistPack", "Log/Fabr"];
const OCULTAR_TALL = ["Ester", "Aguirre Carlos Rodolfo"];
const OCULTAR_PROV = ["Rafael"];
const PROV_MANUAL = [
  { nombre: "Kuffo", cod_factura: null, articulos: ["193"] }
];
function claveTall(n) { return opNorm(n).replace(/[\s\-\/.]/g, ""); }

const ALIAS_NOMBRE = [
  { de: "Pettofrezza", a: "Rafael" }
];
function aliasNombre(n) {
  const k = claveTall(n);
  for (const x of ALIAS_NOMBRE) { if (k.includes(claveTall(x.de))) return x.a; }
  return n;
}

const ordenTallMap = {};
ORDEN_TALL.forEach((n, i) => { ordenTallMap[claveTall(n)] = i; });
const ocultarTallSet = new Set(OCULTAR_TALL.map(claveTall));
const ocultarProvSet = new Set(OCULTAR_PROV.map(claveTall));

const MESES_CORTO = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function fechaCorta(yyyymmdd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyymmdd || "");
  if (!m) return "—";
  return m[3] + "/" + MESES_CORTO[parseInt(m[2], 10) - 1] + "/" + m[1].slice(2);
}

/* ============== Carga de entidades ============== */
async function cargarEntidades() {
  // v10.25: usa vista_entidades_recepcion (join talleristas + proveedores hecho en backend)
  const res = await supabase
    .from("vista_entidades_recepcion")
    .select("tipo,nombre,cod_lk,cod_ch,cod_default,cod_factura")
    .order("nombre");
  if (res.error) { opState.entidades = null; return res.error.message; }

  const entidades = [];
  const vistosProv = new Set();
  (res.data || []).forEach(r => {
    const nom = aliasNombre((r.nombre || "").trim());
    if (!nom) return;
    if (r.tipo === 'tallerista') {
      entidades.push({
        tipo: 'tallerista', Nombre: nom,
        cods: { LK: r.cod_lk || r.cod_default || null, CH: r.cod_ch || r.cod_default || null }
      });
    } else if (r.tipo === 'prov_at' && !vistosProv.has(opNorm(nom))) {
      vistosProv.add(opNorm(nom));
      entidades.push({ tipo: 'prov_at', Nombre: nom, cod: r.cod_factura, cods: { LK: true, CH: true } });
    }
  });

  PROV_MANUAL.forEach(p => {
    if (vistosProv.has(opNorm(p.nombre))) return;
    vistosProv.add(opNorm(p.nombre));
    entidades.push({
      tipo: 'prov_at', Nombre: p.nombre, cod: p.cod_factura || null,
      cods: { LK: true, CH: true },
      articulos: p.articulos.map(a => ({ Cod_Art: String(a), Desc: "" }))
    });
  });

  opState.entidades = entidades;
  return null;
}

function listaPorTipo(tipo, filtro) {
  const f = opNorm(filtro || "").trim();
  let arr = (opState.entidades || []).filter(e => e.tipo === tipo);
  if (tipo === 'tallerista') arr = arr.filter(e => !ocultarTallSet.has(claveTall(e.Nombre)));
  else if (tipo === 'prov_at') arr = arr.filter(e => !ocultarProvSet.has(claveTall(e.Nombre)));
  if (f) arr = arr.filter(e => opNorm(e.Nombre).includes(f));
  arr = arr.slice().sort((a, b) => {
    if (tipo === 'tallerista') {
      const ia = ordenTallMap[claveTall(a.Nombre)] != null ? ordenTallMap[claveTall(a.Nombre)] : 999;
      const ib = ordenTallMap[claveTall(b.Nombre)] != null ? ordenTallMap[claveTall(b.Nombre)] : 999;
      if (ia !== ib) return ia - ib;
    } else if (f) {
      const aw = opNorm(a.Nombre).startsWith(f) ? 0 : 1;
      const bw = opNorm(b.Nombre).startsWith(f) ? 0 : 1;
      if (aw !== bw) return aw - bw;
    }
    return a.Nombre.localeCompare(b.Nombre, 'es');
  });
  return arr;
}

/* ============== Paso 1: elegir tipo ============== */
async function renderTipoElegir() {
  opState.step = "tipo";
  opSetBack(opState.fromMenu === true);   // sólo muestra "Atrás" si se entró por el menú (supervisor)
  opTitle.textContent = "¿Qué vas a cargar?";
  opSubtitle.textContent = "";
  opActions.innerHTML = "";

  if (opState.entidades === null) {
    opBody.innerHTML = '<div class="opEmpty">Cargando…</div>';
    const err = await cargarEntidades();
    if (opState.step !== "tipo") return;
    if (err) { opBody.innerHTML = '<div class="opEmpty" style="color:var(--danger)">Error: ' + err + '</div>'; return; }
  }

  const nTall = listaPorTipo('tallerista').length;
  const nProv = listaPorTipo('prov_at').length;
  opBody.innerHTML = "";
  const cont = document.createElement("div");
  cont.className = "opTipoBtns";
  const bt = document.createElement("button");
  bt.type = "button"; bt.className = "opTipoBtn";
  bt.textContent = "Talleristas (" + nTall + ")";
  bt.onclick = () => renderLista('tallerista');
  const bp = document.createElement("button");
  bp.type = "button"; bp.className = "opTipoBtn";
  bp.textContent = "Prov. Art. Terminado (" + nProv + ")";
  bp.onclick = () => renderLista('prov_at');
  cont.appendChild(bt); cont.appendChild(bp);
  opBody.appendChild(cont);
}

/* ============== Paso 2: lista del tipo ============== */
function renderLista(tipo) {
  opState.step = "lista";
  opState.listaTipo = tipo;
  opSetBack(true);
  opTitle.textContent = tipo === 'tallerista' ? "Talleristas" : "Prov. Art. Terminado";
  opSubtitle.textContent = "";
  opActions.innerHTML = "";

  opBody.innerHTML = "";
  const search = document.createElement("input");
  search.className = "opSearch";
  search.type = "text";
  search.placeholder = "🔍 Buscar por nombre…";
  search.oninput = () => drawLista(search.value);
  opBody.appendChild(search);
  const grid = document.createElement("div");
  grid.id = "opListaGrid";
  grid.className = "opLista";
  opBody.appendChild(grid);
  // Al REANUDAR se entra directo a un paso interno, así que la lista de
  // talleristas puede no estar cargada todavía: se trae acá si falta.
  if (opState.entidades === null) {
    grid.innerHTML = '<div class="opEmpty">Cargando…</div>';
    cargarEntidades().then(function () { if (opState.step === "lista") drawLista(search.value); });
    return;
  }
  drawLista("");
}

function drawLista(filter) {
  const grid = document.getElementById("opListaGrid");
  if (!grid) return;
  grid.innerHTML = "";
  const lista = listaPorTipo(opState.listaTipo, filter);
  if (lista.length === 0) { grid.innerHTML = '<div class="opEmpty">Nada coincide.</div>'; return; }
  lista.forEach(e => grid.appendChild(opEntBtn(e)));
}

function seleccionarEntidad(e) {
  opState.tipo = e.tipo;
  opState.tallNombre = e.Nombre;
  opState.tallCods = e.cods;
  opState.tallCod = e.tipo === 'prov_at' ? (e.cod || null) : null;
  opState.articulosManual = e.articulos || null;
  opState.linea = null;
  opState.articulos = null;
  opState.cargas = {};
  opState.ocPorCod = null; opState.ocOk = false;
  opState.ocAjena = null;   // v19.57 — las ajenas también son POR proveedor → se recargan
  renderLinea();
}

function opEntBtn(e) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "opNameBtn";
  b.textContent = displayName(e.Nombre);
  b.onclick = () => seleccionarEntidad(e);
  return b;
}

/* ============== Paso 2: fecha + línea ============== */
function renderLinea() {
  opState.step = "linea";
  opSetBack(true);
  opTitle.textContent = displayName(opState.tallNombre);
  opSubtitle.textContent = "Fecha y línea";
  opActions.innerHTML = "";

  opBody.innerHTML = "";
  const fField = document.createElement("div");
  fField.className = "opField";
  fField.innerHTML = '<label>Fecha</label>';
  const fBox = document.createElement("div");
  fBox.className = "opFechaBox";
  const fTxt = document.createElement("span");
  fTxt.className = "opFechaTxt";
  fTxt.textContent = fechaCorta(opState.fecha);
  const fInput = document.createElement("input");
  fInput.type = "date";
  fInput.className = "opFechaHidden";
  fInput.value = opState.fecha;
  fInput.oninput = () => { opState.fecha = fInput.value; fTxt.textContent = fechaCorta(fInput.value); };
  fBox.appendChild(fTxt);
  fBox.appendChild(fInput);
  fField.appendChild(fBox);
  opBody.appendChild(fField);

  const lbl = document.createElement("div");
  lbl.className = "opField";
  lbl.innerHTML = '<label>Línea</label>';
  opBody.appendChild(lbl);

  const cods = opState.tallCods || {};
  const row = document.createElement("div");
  row.className = "opLineRow";
  [["LK", "Loeke"], ["CH", "Chef"]].forEach(([lineCode, nom]) => {
    const tieneCod = !!cods[lineCode];
    const b = document.createElement("button");
    b.type = "button";
    b.className = "opLineBtn" + (opState.linea === lineCode ? " active" : "");
    b.innerHTML = lineCode + '<br><span style="font-size:13px;font-weight:700">' + nom + '</span>';
    b.disabled = !tieneCod;
    if (!tieneCod) { b.style.opacity = ".35"; b.style.cursor = "not-allowed"; b.title = "Este tallerista no trabaja para " + nom; }
    b.onclick = () => {
      if (!tieneCod) return;
      if (opState.linea !== lineCode) { opState.articulos = null; opState.cargas = {}; }
      opState.linea = lineCode;
      if (opState.tipo === 'tallerista') opState.tallCod = cods[lineCode];
      renderTipoDoc();
    };
    row.appendChild(b);
  });
  opBody.appendChild(row);
  rcpDraftSave();
}

/* ============== Paso 3: ¿Qué documentación recibís? ============== */
function renderTipoDoc() {
  opState.step = "tipoDoc";
  opSetBack(true);
  opTitle.textContent = displayName(opState.tallNombre);
  opSubtitle.textContent = opState.linea + " · " + fechaCorta(opState.fecha);
  opBody.innerHTML = "";

  const heading = document.createElement("div");
  heading.style.cssText = "font-size:15px;font-weight:700;color:#475569;margin-bottom:14px;";
  heading.textContent = "¿Qué documentación recibís?";
  opBody.appendChild(heading);

  const tipos = [
    { key: "remito", label: "📄 Remito", color: "#4f46e5" },
    { key: "factura", label: "🧾 Factura", color: "#0d9488" },
    { key: "remito_factura", label: "📄🧾 Remito y Factura", color: "#1e6bd6" }
  ];
  tipos.forEach(t => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = t.label;
    b.style.cssText = "width:100%;padding:18px;margin-bottom:10px;border:none;border-radius:12px;background:" + t.color + ";color:#fff;font-size:17px;font-weight:800;cursor:pointer;text-align:left;";
    b.onclick = () => { opState.tipoDoc = t.key; renderDocFields(); };
    opBody.appendChild(b);
  });

  opActions.innerHTML = "";
  rcpDraftSave();
}

/* ============== Paso 3b: Campos de documentación ============== */
function renderDocFields() {
  opState.step = "docFields";
  opSetBack(true);
  opTitle.textContent = displayName(opState.tallNombre);
  opSubtitle.textContent = opState.linea + " · " + fechaCorta(opState.fecha);
  opBody.innerHTML = "";

  const hasRemito = opState.tipoDoc === 'remito' || opState.tipoDoc === 'remito_factura';
  const hasFactura = opState.tipoDoc === 'factura' || opState.tipoDoc === 'remito_factura';

  // Defaults hoy AR
  var _hoyAR = "";
  try { _hoyAR = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Argentina/Buenos_Aires" }); } catch (_e) {}
  if (hasRemito && !opState.nroRemito) opState.nroRemito = "";
  if (hasRemito && !opState.fechaRemito) opState.fechaRemito = _hoyAR;
  if (hasFactura && !opState.nroFactura) opState.nroFactura = "";
  if (hasFactura && !opState.fechaFactura) opState.fechaFactura = _hoyAR;

  // Botón Continuar arriba a la derecha
  const actRow = document.createElement("div");
  actRow.style.cssText = "display:flex;justify-content:flex-end;margin-bottom:16px;";
  const cont = document.createElement("button");
  cont.className = "btnSend btnBig";
  cont.textContent = "Continuar";
  cont.disabled = true;
  cont.onclick = () => {
    // Backwards compat: opState.remito para dedup/ref
    opState.remito = opState.nroRemito || opState.nroFactura || "";
    renderArticulos();
  };
  actRow.appendChild(cont);
  opBody.appendChild(actRow);

  function _updateCont() {
    var ok = true;
    if (hasRemito && (!opState.nroRemito || !opState.fechaRemito)) ok = false;
    if (hasFactura && (!opState.nroFactura || !opState.fechaFactura)) ok = false;
    cont.disabled = !ok;
    cont.classList.toggle("enabled", ok);
  }

  if (hasRemito) {
    var f1 = document.createElement("div"); f1.className = "opField";
    f1.innerHTML = '<label for="opNroRemito">N° de Remito</label>';
    var inp1 = document.createElement("input"); inp1.id = "opNroRemito";
    inp1.type = "text"; inp1.inputMode = "numeric";
    inp1.style.cssText = "width:100%;padding:12px;border:1.5px solid #cbd5e1;border-radius:10px;font-size:16px;box-sizing:border-box;background:#fff;";
    inp1.value = opState.nroRemito;
    inp1.oninput = () => { opState.nroRemito = inp1.value.replace(/\D/g, ""); inp1.value = opState.nroRemito; _updateCont(); };
    f1.appendChild(inp1); opBody.appendChild(f1);

    var f2 = document.createElement("div"); f2.className = "opField";
    f2.innerHTML = '<label for="opFechaRemito">Fecha de Remito</label>';
    var inp2 = document.createElement("input"); inp2.id = "opFechaRemito"; inp2.type = "date";
    inp2.style.cssText = "width:100%;padding:12px;border:1.5px solid #cbd5e1;border-radius:10px;font-size:16px;box-sizing:border-box;background:#fff;";
    inp2.value = opState.fechaRemito;
    inp2.onchange = () => { opState.fechaRemito = inp2.value; _updateCont(); };
    f2.appendChild(inp2); opBody.appendChild(f2);
  }

  if (hasFactura) {
    var f3 = document.createElement("div"); f3.className = "opField";
    f3.innerHTML = '<label for="opNroFactura">N° de Factura</label>';
    var inp3 = document.createElement("input"); inp3.id = "opNroFactura";
    inp3.type = "text"; inp3.inputMode = "numeric";
    inp3.style.cssText = "width:100%;padding:12px;border:1.5px solid #cbd5e1;border-radius:10px;font-size:16px;box-sizing:border-box;background:#fff;";
    inp3.value = opState.nroFactura;
    inp3.oninput = () => { opState.nroFactura = inp3.value.replace(/\D/g, ""); inp3.value = opState.nroFactura; _updateCont(); };
    f3.appendChild(inp3); opBody.appendChild(f3);

    var f4 = document.createElement("div"); f4.className = "opField";
    f4.innerHTML = '<label for="opFechaFactura">Fecha de Factura</label>';
    var inp4 = document.createElement("input"); inp4.id = "opFechaFactura"; inp4.type = "date";
    inp4.style.cssText = "width:100%;padding:12px;border:1.5px solid #cbd5e1;border-radius:10px;font-size:16px;box-sizing:border-box;background:#fff;";
    inp4.value = opState.fechaFactura;
    inp4.onchange = () => { opState.fechaFactura = inp4.value; _updateCont(); };
    f4.appendChild(inp4); opBody.appendChild(f4);
  }

  _updateCont();
  opActions.innerHTML = "";
  rcpDraftSave();
}

/* Compat: renderRemito redirige al nuevo flujo */
function renderRemito() { renderTipoDoc(); }

/* ============== Órdenes de Compra vigentes (v7.07) ==============
   El operario, al marcar la mercadería que recibe, ve en cada botón de código
   CUÁNTO se le pidió a ese tallerista/proveedor en la OC vigente ("OC 100"). Si
   carga más del +20% de esa cantidad NO se le interrumpe (nada de pop-up): el
   botón queda marcado en rojo y, al enviar, sale el aviso por Telegram (evento
   ROC → trigger `trg_recepcion_excede_oc_telegram`).

   FUENTE: tabla `Ordenes_Compra` — la MISMA que llena el generador de OCs desde el
   PPP (index.html → "📑 Órdenes de Compra" → "⚙ Generar OCs": A pedir = máx(0,
   Máximo + Pedidos PPP − Stock) por proveedor). O sea: lo que se muestra acá se
   alimenta solo con cada generación de OCs; no hay tabla ni carga aparte. Lectura
   con la anon key (policy `select_all`).

   VIGENTE = línea con estado ≠ 'recibida' y pedido > recibido, de los últimos
   OC_DIAS_VIGENCIA días. Si hay varias generaciones del mismo artículo se toma
   SOLO la más nueva (sumando sus líneas), para no acumular OCs viejas que ya se
   reemplazaron por una nueva corrida del generador.

   PROVEEDOR: `Ordenes_Compra.proveedor` viene de `OC_Maximos` y no siempre es
   idéntico al nombre del tallerista ("Martin C" = Martin, "Carlos E" = Carlos,
   "Pettofrezza" = Rafael por ALIAS_NOMBRE) y puede ser COMPARTIDO ("Garcia /
   Lucho", "Pintos / Maspoli" → la OC aplica a los dos). ocProvCoincide() parte por
   "/" y compara con la misma clave normalizada de los talleristas. */
const OC_EXCESO_PCT = 0.20;        // margen tolerado sobre lo pedido en la OC
const OC_DIAS_VIGENCIA = 120;      // más viejo que esto ya no se considera vigente

function ocSplitProv(prov) {
  const t = String(prov || "").trim();
  // El nombre ENTERO primero: hay proveedores que llevan "/" adentro y NO son
  // compartidos ("Log/ Fabr"). Después las partes, para las OCs de a dos.
  const keys = [claveTall(aliasNombre(t))];
  t.split(/[\/,+&]|\sy\s/i).forEach(function (s) { keys.push(claveTall(aliasNombre(s.trim()))); });
  return keys.filter(function (s, i) { return !!s && keys.indexOf(s) === i; });
}
function ocProvCoincide(prov, nombreEnt) {
  const k = claveTall(aliasNombre(nombreEnt || ""));
  if (!k) return false;
  return ocSplitProv(prov).some(function (p) {
    if (p === k) return true;
    // "Martin C" / "Carlos E": mismo nombre + una inicial de apellido pegada en la
    // config de OC. Se aceptan hasta 2 caracteres de diferencia, no más (para que
    // "Poly" no matchee cualquier cosa que empiece igual).
    const largo = p.length > k.length ? p : k, corto = p.length > k.length ? k : p;
    return largo.length - corto.length <= 2 && largo.indexOf(corto) === 0;
  });
}
function ocDiaLimite() {
  const d = new Date(); d.setDate(d.getDate() - OC_DIAS_VIGENCIA);
  const p = function (n) { return String(n).padStart(2, "0"); };
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}
/* Carga las OCs vigentes del proveedor elegido en opState.ocPorCod (clave = código
   normalizado). Best-effort: si falla, queda {} y la pantalla funciona como antes. */
async function cargarOCVigentes() {
  /* v10.10 — reemplaza fetch de 5000 OC rows + filtro client-side por RPC server-side
     oc_vigentes_por_proveedor(nombre). La RPC aplica alias (Pettofrezza→Rafael),
     split por delimitadores (/,+& y), y prefix match con ≤2 chars de slack. */
  /* v11.74 — usa supabase.rpc() en vez de fetch manual. El fetch usaba la publishable
     key como Bearer token (no es JWT) → PostgREST podía rechazarlo silenciosamente.
     supabase.rpc() usa el token de sesión real (de signInAnonymously). */
  const nombre = opState.tallNombre;
  try {
    await sessionReady;
    const { data: rows, error } = await supabase.rpc('oc_vigentes_por_proveedor', { nombre_ent: nombre });
    if (error) throw new Error(error.message);
    const porCod = {};
    (rows || []).forEach(function (r) {
      const k = String(r.cod || ""); if (!k) return;
      porCod[k] = { fecha: r.fecha || "", ped: Number(r.ped) || 0, rec: Number(r.rec) || 0, pend: Number(r.pend) || 0 };
    });
    if (opState.tallNombre !== nombre) return;
    opState.ocPorCod = porCod;
    opState.ocOk = true;    // v17.99: las OCs se leyeron de verdad (aunque no haya ninguna)
  } catch (e) {
    console.warn("OCs vigentes (sigue sin el detalle):", e);
    // v17.99 — ojo: acá NO se sabe si el proveedor no tiene OCs o si falló la red. Queda
    // ocOk = false y el aviso de "sin OC = OC 0" NO se exige, para no trabar la recepción
    // entera de todos los proveedores cuando el que falla es el servidor.
    if (opState.tallNombre === nombre) { opState.ocPorCod = {}; opState.ocOk = false; }
  }
}
function ocDeCod(cod) {
  const m = opState.ocPorCod;
  if (!m) return null;
  /* v19.84 (problema 430) - la OC de un codigo DUAL viene con la empresa pegada ("437E CH"),
     porque es lo que se compra: el 437E de Loeke y el de Chef son dos productos distintos y
     ahora cada uno tiene su linea de OC. Se busca primero con la LINEA que eligio el operario
     y despues pelado, que es lo que vale para los codigos comunes y para las OC viejas. */
  const k = _ocgNorm(cod), lin = String(opState.linea || "").toUpperCase().trim();
  if (lin && m[k + " " + lin]) return m[k + " " + lin];
  return m[k] || null;
}
/* ============== v19.57 — ENTREGA AJENA: "esto no está en SU orden de compra" =========
   Pedido de Thomas (2026-09-17): *"si pasa que un proveedor entrega mercadería que no le
   corresponde, tiene que avisarme de otra manera... 'está entregando un proveedor algo que
   no está en su orden de compra', por fuera de que él tiene la orden de compra"*.

   Es OTRA cosa que el exceso: el exceso dice "entró más de lo que la OC habilita"; esto dice
   "esto no es de él, la OC la tiene otro". Pueden pasar juntos o por separado.

   El aviso que le llega a Thomas lo manda el BACKEND (`gv_oc_aplicar_recepcion` → Telegram),
   así que NO depende de que el operario toque ningún botón. Lo de acá es sólo el cartel, para
   que el que recibe vea de quién es la OC en el momento — igual que el resto de los avisos.

   Medido el 17/09 sobre 13/07–17/09: 83 entregas / 7.553 cajas / 28 códigos entraron por un
   proveedor que no tenía ese código en ninguna OC, teniéndola otro. */
function ocAjenaDe(cod) {
  const m = opState.ocAjena;
  if (!m) return null;
  return m[_ocgNorm(cod)] || null;
}
/* Trae, para los códigos de la lista, los que NO están en la OC de ESTE proveedor pero sí en
   la de otro. Best-effort: si falla queda {} y la pantalla funciona como antes (el gate de
   exceso no depende de esto). */
async function cargarOCAjenas(cods) {
  const nombre = opState.tallNombre;
  const ks = (cods || []).map(function (c) { return String(c || "").trim(); }).filter(Boolean);
  if (!nombre || !ks.length) return;
  try {
    await sessionReady;
    const { data: rows, error } = await supabase.rpc('gv_oc_entrega_ajena', {
      p_nombre: nombre, p_cods: ks
    });
    if (error) throw new Error(error.message);
    if (opState.tallNombre !== nombre) return;
    const out = {};
    (rows || []).forEach(function (r) {
      // `otros` null = el código no está en la OC de NADIE: eso ya lo dice el aviso de
      // exceso ("SIN OC generada"), no es una entrega ajena.
      if (!r || !r.otros) return;
      const k = _ocgNorm(r.cod); if (!k) return;
      out[k] = { otros: String(r.otros), pend: Number(r.pend_otros) || 0,
                 fecha: r.fecha_otra || "", config: r.prov_config || "" };
    });
    opState.ocAjena = out;
  } catch (e) {
    console.warn("OC ajenas (sigue sin el detalle):", e);
    if (opState.tallNombre === nombre) opState.ocAjena = {};
  }
}
/* Cantidad de referencia de la OC: lo que FALTA recibir (= lo pedido mientras no se
   haya marcado nada recibido en el módulo de OCs). */
function ocRef(oc) { return (oc && oc.pend > 0) ? oc.pend : (oc ? oc.ped : 0); }
function ocExcede(cod, cajas) {
  const oc = ocDeCod(cod);
  const ref = ocRef(oc);
  return (ref > 0 && cajas > ref * (1 + OC_EXCESO_PCT));
}
function ocPctExceso(cod, cajas) {
  const ref = ocRef(ocDeCod(cod));
  return ref > 0 ? Math.round((cajas / ref - 1) * 100) : 0;
}

/* v9.63 (idea 3239) — AVISO "no entra en góndola / capaz se devuelve". Al recibir, marca (NO
   bloquea) los artículos que cumplen LAS TRES: (1) NO estaban en la OC vigente, (2) NO entran en
   góndola por mucho ((góndola actual + lo recibido) > capacidad × 1.20), (3) baja rotación
   (proyección < 50 caj/mes). El operario tiene que pedir confirmación de que no se devuelve.
   Best-effort: si no hay capacidad cargada para el código, NO avisa (evita falsos positivos).
   Datos: Capacidad_Sector (góndola máx), vista_saldos_stock.terminado (góndola actual),
   gv_proyeccion_articulo.proy_cajas_mes (rotación: la Est. Madre ÚNICA, la misma de Stocks — v25.82;
   antes leía la cruda `proyeccion_madre`, sin la familia), opState.ocPorCod (lo pedido en la OC). */
const GOND_EXCESO_FACTOR = 1.20;   // "por mucho" = 20% arriba de la capacidad de góndola
const GOND_BAJA_ROT = 50;          // baja rotación = menos de 50 cajas/mes de proyección
/* v16.30 (tramo 4) — saldo de góndola por código, PURA y testeable (tests/gond-exceso-dual.cjs).
   Recibe las filas crudas de `vista_saldos_stock` y la línea de la recepción, y devuelve
   { codNormalizado: cajas }.

   · código DUAL  → sólo la fila de la góndola de ESA empresa. El 809E en la góndola de Loeke
     (J13-J14) es un Corta Pizza y en la de Chef (M13-M15) un Corta Queso: sumar las dos no
     significa nada. Cómo se sabe que es dual sin pedir nada más: la vista lo delata sola, su
     `clave` difiere del `cod_art` (para el resto son iguales).
   · código común → todas las filas sumadas, igual que antes de la v16.30 (la vista agrupa por
     (código, empresa), así que un código común igual puede volver en varias filas). */
function gondAcumPorCod(rows, linea, norm, valorDe) {
  const val = valorDe || function (r) { return Number(r.terminado) || 0; };
  const lin = String(linea || "").toUpperCase();
  const porCod = {}, out = {};
  (rows || []).forEach(function (r) {
    const k = norm(r.cod_art || r.clave); if (!k) return;
    (porCod[k] || (porCod[k] = [])).push(r);
  });
  Object.keys(porCod).forEach(function (k) {
    const arr = porCod[k];
    const esDual = arr.some(function (r) { return String(r.clave || "") !== String(r.cod_art || ""); });
    const usar = esDual
      ? arr.filter(function (r) { return String(r.empresa || "").toUpperCase() === lin; })
      : arr;
    out[k] = usar.reduce(function (a, r) { return a + val(r); }, 0);
  });
  return out;
}
/* v16.51 (problema 92) — el conjunto de códigos DUALES según la vista de saldos: su `clave`
   difiere del `cod_art` (para el resto son iguales). Se saca aparte porque ahora lo necesitan
   DOS cosas: el saldo de góndola (gondAcumPorCod) y la capacidad (gondCapPorCod). */
function gondDualesDe(rows, norm) {
  const set = {};
  (rows || []).forEach(function (r) {
    if (String(r.clave || "") !== String(r.cod_art || "")) {
      const k = norm(r.cod_art || r.clave); if (k) set[k] = true;
    }
  });
  return set;
}

/* v16.51 (problema 92) — CAPACIDAD de góndola por código, pura y testeable.
   Para un DUAL sólo cuentan las celdas de SU empresa: el 809E tiene 100 cajas en la góndola de
   Loeke (J13-J14) y 288 en la de Chef (M13-M15). Hasta la v16.50 el saldo ya salía filtrado por
   empresa (v16.30) pero la capacidad seguía siendo la SUMA de las dos, así que el aviso comparaba
   una góndola contra la capacidad de dos: por LK el umbral quedaba en 388×1,20 = 465,6 cuando la
   góndola de Loeke aguanta 100, y el aviso no saltaba nunca.
   Para un código común suma todas sus celdas, igual que antes: conducta idéntica.
   `LOKE` cuenta como `LK` (así está cargado el 439E en Ñ53-Ñ54). */
function gondCapPorCod(capRows, duales, linea, norm) {
  const lin = String(linea || "").toUpperCase();
  const out = {};
  (capRows || []).forEach(function (r) {
    const k = norm(r.cod); if (!k) return;
    if (duales && duales[k]) {
      let e = String(r.empresa || "").toUpperCase().trim();
      if (e === "LOKE") e = "LK";
      if (e !== lin) return;
    }
    out[k] = (out[k] || 0) + (Number(r.cajas_max) || 0);
  });
  return out;
}
async function gondReturnCheck(items) {
  try {
    await sessionReady;
    const cods = [];
    (items || []).forEach(function (it) { const c = String(it.cod || "").trim(); if (c && cods.indexOf(c) < 0) cods.push(c); });
    if (!cods.length) return [];
    const res = await Promise.all([
      supabase.from("Capacidad_Sector").select("cod,cajas_max,empresa"),
      supabase.from("vista_saldos_stock").select("cod_art,clave,empresa,terminado").in("cod_art", cods),
      supabase.from("gv_proyeccion_articulo").select("cod,proy_cajas_mes,es_secundario,principal")
    ]);
    const cap = {}, gond = {}, proy = {};
    const _saldoRows = (res[1] && res[1].data) || [];
    // v16.51 — la capacidad de un DUAL es la de SU góndola, no la suma de las dos (ver gondCapPorCod).
    Object.assign(cap, gondCapPorCod((res[0] && res[0].data) || [], gondDualesDe(_saldoRows, _ocgNorm), opState.linea, _ocgNorm));
    // v15.71 — ACUMULA: `vista_saldos_stock` agrupa por (código, empresa), así que un código
    // vuelve en varias filas; con el `=` el aviso comparaba contra el saldo de UNA de ellas.
    //
    // v16.30 (tramo 4) — y para los 4 códigos DUALES no alcanza con sumar: el saldo que
    // importa es el de la góndola de ESTA recepción. El 809E en la góndola de Loeke (J13-J14)
    // es un Corta Pizza y en la de Chef (M13-M15) un Corta Queso; sumar las dos no significa
    // nada. Hasta la v16.29 el filtro iba por `clave` contra códigos PELADOS, así que para un
    // dual no matcheaba ninguna fila, la góndola daba 0 y el aviso de exceso NUNCA saltaba.
    //
    // Cómo se sabe que un código es dual sin pedir nada más: la vista lo dice sola — es dual
    // si su `clave` difiere del `cod_art` (para el resto son iguales). Así que:
    //   · código dual  → sólo la fila cuya `empresa` es la línea que eligió el operario
    //   · código común → todas las filas sumadas, igual que antes (conducta idéntica)
    Object.assign(gond, gondAcumPorCod(_saldoRows, opState.linea, _ocgNorm));
    // v25.82 — la rotación es la Est. Madre ÚNICA (gv_proyeccion_articulo). Un SECUNDARIO va en 0
    // ahí (su venta está en el principal), así que rota lo que rota su PRINCIPAL: es el mismo producto.
    const _pRows = (res[2] && res[2].data) || [], _pPpal = {};
    _pRows.forEach(function (r) { if (r.es_secundario) return; const k = _ocgNorm(r.cod); if (k) _pPpal[k] = Number(r.proy_cajas_mes) || 0; });
    _pRows.forEach(function (r) {
      const k = _ocgNorm(r.cod); if (!k) return;
      proy[k] = r.es_secundario ? (_pPpal[_ocgNorm(r.principal)] || 0) : (Number(r.proy_cajas_mes) || 0);
    });
    const flag = [];
    (items || []).forEach(function (it) {
      const k = _ocgNorm(it.cod);
      const c = cap[k] || 0; if (c <= 0) return;             // sin capacidad conocida → no aviso (evita falso positivo)
      if (ocDeCod(it.cod)) return;                           // estaba en la OC → no aviso
      const p = proy[k] || 0; if (p >= GOND_BAJA_ROT) return; // rota bien → no aviso
      const g = gond[k] || 0;
      if ((g + Number(it.cajas || 0)) > c * GOND_EXCESO_FACTOR) flag.push({ cod: it.cod, cajas: it.cajas, cap: c, gond: g, proy: p });
    });
    return flag;
  } catch (_e) { return []; }
}
// v16.30 — `gondAcumPorCod` (arriba) es la parte pura y es la que testea
// tests/gond-exceso-dual.cjs. El módulo es `type="module"` y no carga por file://, así que
// el test lee el fuente, aísla esa función y la corre en Node.

/* ============== Paso 4: grilla de códigos ============== */
async function renderArticulos() {
  opState.step = "articulos";
  opSetBack(true);
  opTitle.textContent = displayName(opState.tallNombre);
  opSubtitle.textContent = opState.linea + " · " + fechaCorta(opState.fecha) + " · RTO/FC " + opState.remito;
  opActions.innerHTML = "";

  // v7.07: las OCs vigentes se traen EN PARALELO (no bloquean la grilla); cuando
  // llegan se repinta para que aparezca el detalle "OC N" en cada botón.
  if (opState.ocPorCod === null) {
    cargarOCVigentes().then(function () {
      if (opState.step === "articulos") drawArticulosGrid();
    });
  }

  if (opState.articulos === null) {
    opBody.innerHTML = '<div class="opEmpty">Cargando códigos…</div>';
    let lista = [], error = null;

    if (opState.articulosManual) {
      lista = opState.articulosManual.map(a => ({ Cod_Art: a.Cod_Art, Desc: a.Desc || "" }));
    } else if (opState.tipo === 'prov_at') {
      // v10.25: usa vista_articulos_prov_at (join ya hecho en el backend)
      const res = await supabase
        .from("vista_articulos_prov_at")
        .select("cod_art,descripcion")
        .eq("proveedor", opState.tallNombre)
        .eq("linea", opState.linea)
        .order("cod_art");
      error = res.error;
      if (res.data) {
        lista = res.data.map(r => ({ Cod_Art: r.cod_art, Desc: r.descripcion || "" }));
      }
    } else {
      const res = await supabase
        .from("Articulos Virgilio X Tallerista")
        .select("Cod_Art")
        .eq("Cod_Tallerista", opState.tallCod)
        .eq("Linea", opState.linea)
        .order("Cod_Art");
      error = res.error;
      if (res.data) lista = res.data.map(r => ({ Cod_Art: r.Cod_Art, Desc: "" }));
    }

    if (opState.step !== "articulos") return;
    if (error) { opBody.innerHTML = '<div class="opEmpty" style="color:var(--danger)">Error: ' + error.message + '</div>'; return; }
    const vistos = new Set();
    opState.articulos = [];
    // En Log/Fabr no aplicamos el filtro "empieza con número" (ahí van los
    // códigos agregados a mano con "+", que ya viven en la misma tabla).
    const permitirNoNum = arEsLogFabr();
    lista.forEach(r => {
      const codArt = String(r.Cod_Art || "").trim();
      if (codArt && (permitirNoNum || /^[0-9]/.test(codArt)) && !vistos.has(r.Cod_Art)) {
        vistos.add(r.Cod_Art);
        opState.articulos.push({ Cod_Art: r.Cod_Art, Desc: r.Desc || "" });
      }
    });
  }

  drawArticulosGrid();
}

function drawArticulosGrid() {
  opBody.innerHTML = "";
  const hayArts = opState.articulos && opState.articulos.length > 0;
  /* v19.57 — las AJENAS se piden una vez, con todos los códigos de la lista del proveedor, y
     cuando llegan se repinta (igual que las OC vigentes). Va acá y no en renderArticulos
     porque la lista de códigos se resuelve recién al final de esa función. */
  if (opState.ocAjena === null && hayArts) {
    opState.ocAjena = {};   // marca "pedido" para no disparar dos veces en los repintados
    cargarOCAjenas(opState.articulos.map(function (a) { return a.Cod_Art; })).then(function () {
      if (opState.step === "articulos") drawArticulosGrid();
    });
  }
  // v21.30 — sin códigos ya NO se corta acá: el aviso va arriba y abajo queda el botón
  // "Introducir código diferente", que ahora existe para TODOS los proveedores. Antes el
  // return dejaba al operario sin ninguna salida salvo en Log/Fabr.
  if (!hayArts) {
    const vac = document.createElement("div");
    vac.className = "opEmpty";
    vac.textContent = "No hay códigos asignados a este proveedor para la línea " + opState.linea + ".";
    opBody.appendChild(vac);
    opBody.appendChild(_arBotonOtro());
    opActions.innerHTML = "";
    return;
  }
  const grid = document.createElement("div");
  grid.className = "opGrid codes";
  // Orden numérico por código (el agregado a mano queda en su lugar, no al final).
  const numKey = c => { const m = String(c).match(/^(\d+)/); return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER; };
  const artsOrden = (opState.articulos || []).slice().sort((a, b) =>
    (numKey(a.Cod_Art) - numKey(b.Cod_Art))
    || (String(a.Cod_Art) < String(b.Cod_Art) ? -1 : String(a.Cod_Art) > String(b.Cod_Art) ? 1 : 0)
  );
  artsOrden.forEach(a => {
    const cajas = opState.cargas[a.Cod_Art];
    const oc = ocDeCod(a.Cod_Art);
    const exc = cajas > 0 && ocExcede(a.Cod_Art, cajas);
    const b = document.createElement("button");
    b.type = "button";
    b.className = "opCodeBtn" + (cajas > 0 ? " loaded" : "") + (exc ? " exceso" : "");
    // v7.07: detalle de la OC vigente del proveedor. "OC 100" = pedidas 100 cajas;
    // si ya hay recibido parcial cargado en el módulo de OCs → "OC 40/100" (faltan/pedidas).
    let ocHtml = "";
    if (oc) {
      const txt = String((oc.rec > 0) ? oc.pend : oc.ped);   // v22.58 (Luis): sólo lo que falta recibir
      const title = "Orden de compra vigente (" + fechaCorta(oc.fecha) + "): " + oc.ped + " caja(s) pedidas" +
        (oc.rec > 0 ? ", " + oc.rec + " ya recibida(s) → faltan " + oc.pend : "");
      ocHtml = '<span class="ocq" title="' + escapeHtmlRcp(title) + '">OC ' + escapeHtmlRcp(txt) + '</span>';
    }
    // v15.36 — alta nueva esperando (o sin) el OK de Thomas: se marca en el botón.
    let altaHtml = "";
    const _alta = (opState.altaNuevos || {})[_ocgNorm(a.Cod_Art)];
    if (_alta && _alta.estado === "pendiente") {
      altaHtml = '<span class="ocq" title="Alta nueva: le avisamos a Thomy, todavía no contestó (no traba nada)">🆕</span>';
    } else if (_alta && _alta.estado === "ok") {
      altaHtml = '<span class="ocq" title="Alta nueva: Thomy la aprobó">🆕 ✅</span>';
    } else if (_alta && _alta.estado === "rechazado") {
      altaHtml = '<span class="ocq" title="Alta nueva: Thomy dijo que NO">🆕 ⛔</span>';
    }
    b.innerHTML = '<span>' + a.Cod_Art + '</span>' + ocHtml + altaHtml +
      (cajas > 0 ? '<span class="cnt">' + cajas + _rcpUd(a.Cod_Art, cajas) + (exc ? ' ⚠' : '') + '</span>' : '');
    b.onclick = () => openCajas(a.Cod_Art);
    grid.appendChild(b);
  });
  opBody.appendChild(grid);
  // v21.30 — el "+" de Log/Fabr pasó a ser un botón grande y vale para TODOS los proveedores.
  opBody.appendChild(_arBotonOtro());

  const total = Object.values(opState.cargas).filter(n => n > 0).length;
  opActions.innerHTML = "";
  const enviarBtn = document.createElement("button");
  enviarBtn.className = "btnSend btnBig";
  enviarBtn.textContent = "Enviar" + (total > 0 ? " (" + total + ")" : "");
  enviarBtn.disabled = total === 0;
  enviarBtn.onclick = renderResumen;
  opActions.appendChild(enviarBtn);
  rcpDraftSave();
}

/* ============== Agregar artículo a Log/Fabr (botón "+") ==============
   Solo para el tallerista Log/Fabr. El código nuevo se inserta en la MISMA tabla
   que lee la grilla ("Articulos Virgilio X Tallerista"), para las dos líneas de
   Log/Fabr → queda fijo y compartido entre dispositivos, SIN tablas extra. */
function arEsLogFabr() {
  return opState.tipo === 'tallerista' && claveTall(opState.tallNombre || "") === claveTall("Log/Fabr");
}
/* ====== v21.30 — "Introducir código diferente", para TODOS los proveedores ==========
   Pedido de Luis (2026-09-22): *"cuando se elige al tallerista deberían aparecer los
   códigos asignados a el como proveedor y un botón más grande que diga «Introducir
   Código diferente» que le permita al operario escribir un código (pero solo elegir de
   una lista de sugerencias que consiste en los códigos existentes)"*.

   La lista de sugerencias YA existe: es el buscador de `arAddCode` (v15.76), que filtra
   los activos de `OC_Maximos` y sólo deja escribir libre por la puerta de escape
   "Cargar igual", que dispara el WhatsApp a Thomas. Lo único que cambia es que ese
   buscador dejó de ser exclusivo de Log/Fabr.

   ⚠ Y el código agregado así NO se guarda fijo en el padrón, salvo en Log/Fabr — ver
   `arSaveCodeRemote`. Si se guardara, la próxima entrega entraría en silencio y nadie
   se enteraría: es justo el aviso que Luis pide. */
function _arBotonOtro() {
  const wrap = document.createElement("div");
  const b = document.createElement("button");
  b.type = "button";
  b.className = "opCodeOtro";
  b.id = "opCodeOtro";
  b.textContent = "🔍 Introducir código diferente";
  b.onclick = arAddCode;
  wrap.appendChild(b);
  const h = document.createElement("div");
  h.className = "opCodeOtroHint";
  h.textContent = arEsLogFabr()
    ? "Buscá el código en la lista de activos."
    : "Buscá el código en la lista de activos. Si no es de este proveedor, le avisamos a Thomy y seguís igual.";
  wrap.appendChild(h);
  return wrap;
}
/* Guarda el código en "Articulos Virgilio X Tallerista" (best-effort).
   MAESTRO: busca una fila existente del MISMO código (cualquier tallerista) y
   COPIA todas sus columnas (Desc, UxB y cualquier otro dato del artículo);
   solo cambia Cod_Tallerista + Línea. Así el alta queda con la descripción y
   demás datos que el sistema usa después, sin dejar nada vacío. Inserta una fila
   por cada línea de Log/Fabr (LK y CH) → aparece en ambas y en cualquier device.
   Si el código no existe en ningún lado, cae a un alta mínima (Desc: ""). */
async function arSaveCodeRemote(cod) {
  // v21.30 — el alta FIJA en el padrón sigue siendo sólo de Log/Fabr. Para el resto de
  // los proveedores el código agregado a mano vale para ESTA recepción y nada más: si
  // quedara asignado, la próxima entrega del mismo código entraría sin que nadie se
  // entere, y el aviso a Thomas que pidió Luis dejaría de salir.
  if (!arEsLogFabr()) return;
  let base = null;
  try {
    const res = await supabase.from("Articulos Virgilio X Tallerista")
      .select("*").eq("Cod_Art", cod).limit(1);
    if (!res.error && res.data && res.data.length) base = res.data[0];
  } catch (e) { /* sin red: alta mínima */ }

  const cods = opState.tallCods || {};
  const dest = [];
  if (cods.LK) dest.push({ codTall: cods.LK, linea: "LK" });
  if (cods.CH) dest.push({ codTall: cods.CH, linea: "CH" });
  if (!dest.length && opState.tallCod) dest.push({ codTall: opState.tallCod, linea: opState.linea });
  if (!dest.length) return;

  const rows = dest.map(function (d) {
    const row = base ? Object.assign({}, base) : { Cod_Art: cod, Desc: "" };
    delete row.id; delete row.created_at; delete row.updated_at;   // PK/auto: que las genere la DB
    row.Cod_Art = cod;
    row.Cod_Tallerista = d.codTall;
    row.Linea = d.linea;
    return row;
  });
  try {
    const ins = await supabase.from("Articulos Virgilio X Tallerista").insert(rows);
    if (ins && ins.error) {
      console.warn("alta artículo Log/Fabr:", ins.error.message);
      alert("El código quedó para esta carga, pero NO se pudo guardar fijo en la base:\n" +
            ins.error.message + "\n\nAvisá al admin.");
    }
  } catch (e) { /* no-op */ }
}
/* idea 3521: MISMA normalización de códigos que index.html (_ocgNorm = upper + trim +
   sin ceros a la izquierda). recepcion.js es un módulo (scope propio) y no ve el
   _ocgNorm de index.html, así que replicamos el canónico acá para que "027" cruce
   con "27" y no se dupliquen artículos. */
function _ocgNorm(c) { return String(c == null ? "" : c).toUpperCase().trim().replace(/^0+(?=.)/, ""); }

/* ============== v15.39 — alta de artículo nuevo: AVISO a Thomas por WhatsApp =========
   Pedido del dueño (2026-09-11): *"si están por recibir un artículo nuevo que no
   figuraba en la planimetría, me mandan un mensaje directo a WhatsApp a mi teléfono,
   'hola Thomy, estoy creando un artículo nuevo, que es el tanto, ¿me confirmás que
   está bien?'"*.

   ⚠ **NO traba la recepción** (corrección del dueño, mismo día): *"no quiero que quede
   bloqueado a que yo les conteste, porque capaz les contesto una hora después. Quiero
   que quede asentado el mensaje y que una vez que lo mandan ellos sí puedan seguir
   dando la recepción"*. O sea: se manda el WhatsApp, queda la fila, y el operario
   sigue de largo. La v15.36 trababa el `Enviar` hasta la respuesta — eso se sacó.

   Esto nació del remito 38087 (02/09): el operario cargó 599, 943 y 948 con el botón
   "+", sin la E — los códigos reales son 599E, 943E y 948E. El "+" daba de alta
   cualquier cosa sin validar ni avisarle a nadie.

   La fila de `GV_Alta_Articulo_Aprobacion` es el asiento: queda quién lo creó, cuándo,
   en qué remito, si el WhatsApp salió, y después la respuesta de Thomas. Con la anon
   key sólo se puede LEER; escribe la Edge Function `gv-alta-articulo` (service_role),
   que es la que manda el WhatsApp. La respuesta de Thomas es información (se ve en el
   botón), no un permiso.
   v23.39 — la anon key ya NO ve la columna `token` (con él se contesta el link de
   WhatsApp como si fuera Thomas). Por eso acá se pide sólo cod y estado. */
const ALTA_FN_URL = SUPABASE_URL + "/functions/v1/gv-alta-articulo";

/* Altas del "+" de esta recepción y el estado del aviso. Vive en el borrador para que
   sobreviva a un refresh o a cerrar la app. NO condiciona el envío: es informativo. */
function altaPendGet() {
  return (opState.altaNuevos && typeof opState.altaNuevos === "object") ? opState.altaNuevos : (opState.altaNuevos = {});
}
function altaEnPlanimetria(cod) {
  const G = (typeof window !== "undefined" && window.GONDOLA) ? window.GONDOLA : null;
  if (!G) return true;   // sin planimetría cargada no trabamos a nadie
  return !!G[_ocgNorm(cod)];
}
/* Avisa a Thomas y deja el asiento. Devuelve el estado ('pendiente' | 'ok' |
   'rechazado') o null si no se pudo avisar. El operario sigue igual en los dos casos. */
async function altaAvisar(cod) {
  try {
    const res = await fetch(ALTA_FN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cod: cod,
        remito: opState.remito || "",
        legajo: String(RECP.legajo || ""),
        tall: opState.tallNombre || "",
        linea: opState.linea || ""
      })
    });
    const d = await res.json();
    if (!res.ok || !d || !d.token) return null;
    altaPendGet()[cod] = { token: d.token, estado: d.estado || "pendiente", wa_ok: d.wa_ok !== false };
    rcpDraftSave();
    return d.estado || "pendiente";
  } catch (_e) { return null; }
}
/* Relee los estados desde la tabla (anon sólo lee). Devuelve true si cambió algo. */
async function altaRefrescar() {
  const pend = altaPendGet();
  const cods = Object.keys(pend).filter(c => pend[c].estado === "pendiente");
  if (!cods.length) return false;
  let cambio = false;
  try {
    const res = await supabase.from("GV_Alta_Articulo_Aprobacion")
      .select("cod,estado").in("cod", cods);
    ((res && res.data) || []).forEach(function (r) {
      const c = _ocgNorm(r.cod);
      if (pend[c] && pend[c].estado !== r.estado) {
        pend[c].estado = r.estado;
        cambio = true;
      }
    });
  } catch (_e) { /* sin red: sigue pendiente */ }
  if (cambio) rcpDraftSave();
  return cambio;
}
/* Altas de esta recepción todavía sin respuesta de Thomas. Se usa SÓLO para mostrar
   (el badge del botón y una línea en el resumen): no traba nada. */
function altaSinRespuesta() {
  const pend = altaPendGet();
  const cargas = opState.cargas || {};
  return Object.keys(cargas)
    .filter(c => cargas[c] > 0)
    .map(_ocgNorm)
    .filter(c => pend[c] && pend[c].estado === "pendiente")
    .map(c => ({ cod: c, estado: pend[c].estado }));
}
/* Mientras haya pendientes, repregunta cada 8 s y repinta cuando Thomas contesta. */
let _altaTimer = null;
function altaPollStart() {
  altaPollStop();
  _altaTimer = setInterval(async function () {
    const hay = Object.keys(altaPendGet()).some(c => altaPendGet()[c].estado === "pendiente");
    if (!hay) { altaPollStop(); return; }
    const cambio = await altaRefrescar();
    if (cambio && opState.step === "articulos") drawArticulosGrid();
  }, 8000);
}
function altaPollStop() { if (_altaTimer) { clearInterval(_altaTimer); _altaTimer = null; } }

/* ============== v15.76 — el "+" de Log/Fabr es un BUSCADOR de códigos activos =======
   Pedido del dueño (2026-09-11): *"si están por recibir un artículo, si no lo tienen en
   su listado activo, en lugar de que ellos escriban y nada más, que escriban sobre un
   buscador de códigos activos. Si no encuentra ninguno con lo que ellos tipean, que los
   deje cargarlos pero con la misma pauta de recepción de mercadería sin OC: que me
   manden un WhatsApp a mí"*.

   Antes el "+" era un `prompt()` libre: el operario tipeaba cualquier cosa y entraba.
   De ahí salieron los 599 / 943 / 948 sin la E del remito 38087 (02/09). Ahora:

   1. Tipea → filtra el catálogo de ACTIVOS por código o por descripción.
   2. Toca un resultado → se agrega, SIN WhatsApp (es un código que ya existe).
   3. Nada coincide → aparece "Cargar igual: XXX", que lo deja entrar PERO dispara el
      aviso a Thomas (`altaAvisar`, v15.39), igual que antes.

   El catálogo de activos sale de `OC_Maximos` (activo = true), que es la lista curada
   que la base ya usa como canónica para el código (trigger `fn_canon_cod_art`).
   Si no se puede cargar (sin red), NO se traba a nadie: el buscador deja escribir
   libre y el aviso vuelve a decidirse por la planimetría, como en la v15.39. */
let _arCatalogo = null;      // [{cod, desc, codNorm, busq}] · null = sin cargar
let _arCatalogoProm = null;  // promesa en vuelo (que dos toques no pidan dos veces)

function arCatalogoCargar() {
  if (_arCatalogo) return Promise.resolve(_arCatalogo);
  if (_arCatalogoProm) return _arCatalogoProm;
  _arCatalogoProm = (async function () {
    try {
      const res = await supabase.from("OC_Maximos")
        .select("cod,descripcion").eq("activo", true);
      if (res.error || !res.data) return null;
      const vistos = {};
      const out = [];
      res.data.forEach(function (r) {
        const cn = _ocgNorm(r.cod);
        if (!cn || vistos[cn]) return;
        vistos[cn] = 1;
        const desc = String(r.descripcion || "").trim();
        out.push({ cod: cn, desc: desc, busq: opNorm(cn + " " + desc) });
      });
      out.sort(function (a, b) { return a.cod < b.cod ? -1 : a.cod > b.cod ? 1 : 0; });
      // Catálogo VACÍO = no lo tomamos por bueno. Si RLS o la red lo dejan en cero, dar
      // por "fuera de lista" a TODOS los códigos mandaría un WhatsApp por cada alta.
      // Con null se cae a la regla vieja (planimetría), que es la de la v15.39.
      if (!out.length) return null;
      _arCatalogo = out;
      return out;
    } catch (_e) { return null; }
    finally { _arCatalogoProm = null; }
  })();
  return _arCatalogoProm;
}
/* ¿El código está en el listado de activos? true / false / null (catálogo sin cargar). */
function arCatalogoTiene(cod) {
  if (!_arCatalogo) return null;
  const cn = _ocgNorm(cod);
  return _arCatalogo.some(function (a) { return a.cod === cn; });
}
/* v18.31 — ¿hay un activo que se le PAREZCA? Sólo diferencias de LETRAS al final:
   582 → 582E, 438EL → 438E. Un dígito distinto es OTRO artículo y no se sugiere nunca.
   Existe porque el 15/09 aparecieron 7 recepciones cargadas con el código sin la E
   (582, 583, 584, 599, 727, 943, 948) cuando el artículo real era el importado: el
   operario tipea el número de memoria, se come la letra, y el sistema lo toma como un
   artículo nuevo — le manda el WhatsApp de alta a Thomas y la entrega queda con un
   código que no existe, así que después no cruza con ninguna OC. */
function arCatalogoParecidos(cod) {
  if (!_arCatalogo) return [];
  const cn = _ocgNorm(cod);
  if (!cn) return [];
  return _arCatalogo.filter(function (a) {
    if (a.cod === cn) return false;
    const larg = a.cod.length > cn.length ? a.cod : cn;
    const cort = a.cod.length > cn.length ? cn : a.cod;
    if (larg.indexOf(cort) !== 0) return false;             // uno es prefijo del otro
    const resto = larg.slice(cort.length);
    return resto.length <= 2 && /^[A-Z]+$/.test(resto);     // y lo que sobra son letras
  }).slice(0, 4);
}
/* Códigos activos que matchean lo tipeado (por código o por descripción).
   v18.41 — busca por lo tipeado TAL CUAL y, además, por el código normalizado. El
   catálogo se guarda con `_ocgNorm` (sin ceros de adelante), así que tipear "0582" no
   encontraba nada y el operario caía derecho en "Cargar igual: 582" con el 582E ahí al
   lado, invisible. Es el mismo bug de los ceros que ya se arregló en Stocks. */
function arCatalogoBuscar(txt) {
  if (!_arCatalogo) return [];
  const raw = String(txt || "").trim();
  const q = opNorm(raw);
  if (!q) return _arCatalogo.slice(0, 60);
  const qn = opNorm(_ocgNorm(raw));                        // "0582" -> "582"
  return _arCatalogo.filter(function (a) {
    return a.busq.indexOf(q) >= 0 || (qn && qn !== q && a.busq.indexOf(qn) >= 0);
  }).slice(0, 60);
}

function arBusCerrar() {
  arBusModal.classList.remove("open");
  arBusInput.value = "";
  arBusList.innerHTML = "";
}
function arBusDibujar() {
  const txt = arBusInput.value;
  const cod = _ocgNorm(txt);
  arBusList.innerHTML = "";

  if (!_arCatalogo) {
    // Sin catálogo (sin red o falló la consulta): no se traba: se deja cargar a mano.
    const av = document.createElement("div");
    av.className = "arBusNada";
    av.textContent = "No se pudo traer la lista de códigos activos. Podés escribirlo igual.";
    arBusList.appendChild(av);
    if (cod) arBusList.appendChild(arBusBotonIgual(cod));
    return;
  }

  const res = arCatalogoBuscar(txt);
  res.forEach(function (a) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "arBusRow";
    b.innerHTML = '<span class="arBusCod">' + escapeHtmlRcp(a.cod) + '</span>' +
                  '<span class="arBusDesc">' + escapeHtmlRcp(a.desc) + '</span>';
    b.onclick = function () { arBusCerrar(); arAddCodeAplicar(a.cod, false); };
    arBusList.appendChild(b);
  });

  if (!res.length) {
    const nada = document.createElement("div");
    nada.className = "arBusNada";
    nada.textContent = cod
      ? "Ningún artículo activo coincide con “" + cod + "”."
      : "Escribí el código o el nombre del artículo.";
    arBusList.appendChild(nada);
    if (cod) arBusList.appendChild(arBusBotonIgual(cod));
  }
}
/* Botón de escape: lo deja cargar aunque no esté en la lista, avisándole a Thomas. */
function arBusBotonIgual(cod) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "arBusIgual";
  b.textContent = "➕ Cargar igual: " + cod + " (le avisamos a Thomy)";
  b.onclick = function () { arBusCerrar(); arAddCodeAplicar(cod, true); };
  return b;
}
function arAddCode() {
  arBusInput.value = "";
  arBusList.innerHTML = '<div class="arBusNada">Cargando códigos activos…</div>';
  arBusModal.classList.add("open");
  try { arBusInput.focus(); } catch (_e) {}
  arCatalogoCargar().then(function () {
    if (arBusModal.classList.contains("open")) arBusDibujar();
  });
}

/* Agrega el código a la recepción. `fueraDeLista` = lo tipeó y no matcheó ningún activo
   → se le avisa a Thomas. Si el catálogo no se pudo cargar, cae a la regla vieja
   (planimetría), para no mandar WhatsApp de más ni de menos por una falla de red. */
async function arAddCodeAplicar(cod, fueraDeLista) {
  cod = _ocgNorm(cod);
  if (!cod) return;

  const enActivos = arCatalogoTiene(cod);          // true | false | null
  const avisar = (enActivos === null) ? !altaEnPlanimetria(cod) : (enActivos === false);

  // v18.31 — antes de darlo por artículo nuevo: ¿no será que se comió una letra? Se
  // pregunta UNA vez, y la decisión es del operario. Si acepta, se carga el bueno y no
  // sale ningún WhatsApp, porque ése sí está en la lista.
  if (avisar) {
    const par = arCatalogoParecidos(cod);
    if (par.length) {
      const otros = par.length > 1
        ? "\n\n(También existen: " + par.slice(1).map(function (a) { return a.cod; }).join(", ") + ")"
        : "";
      const ok = confirm(
        "El código " + cod + " no está en la lista de activos.\n\n" +
        "¿Quisiste decir " + par[0].cod + (par[0].desc ? " — " + par[0].desc : "") + "?" + otros + "\n\n" +
        "Aceptar = cargo " + par[0].cod + "\n" +
        "Cancelar = sigo con " + cod + " y le aviso a Thomy que es un artículo nuevo");
      if (ok) { await arAddCodeAplicar(par[0].cod, false); return; }
    }
  }

  if (avisar) {
    const ya = altaPendGet()[cod];
    if (!ya) {
      const estado = await altaAvisar(cod);
      if (estado === null) {
        // Sin red no frenamos la recepción: se avisa que el mensaje no salió. El aviso
        // igual no se pierde — al enviar sale el evento RSP, que dispara su Telegram.
        alert("⚠ No se pudo avisarle a Thomy (sin conexión).\n\n" +
              "Podés seguir con la recepción igual, pero decile vos que estás creando el " + cod + ".");
      } else {
        const w = altaPendGet()[cod];
        alert("📲 Listo, le mandé el WhatsApp a Thomy:\n\n" +
              "\"Hola Thomy, estoy creando un artículo nuevo, que es el " + cod + ".\n" +
              "¿Me confirmás que está bien?\"\n\n" +
              (w && w.wa_ok === false ? "⚠ El WhatsApp falló, le llegó por Telegram.\n\n" : "") +
              "Seguí con la recepción normal. No hace falta esperar la respuesta.");
        altaPollStart();
      }
    } else if (ya.estado === "rechazado") {
      // Ya contestó que no: se avisa, pero la decisión de cargarlo es del operario.
      alert("⚠ Ojo: Thomy ya había dicho que NO al alta de " + cod + ".");
    }
  }

  if (!opState.articulos) opState.articulos = [];
  const existe = opState.articulos.some(a => _ocgNorm(a.Cod_Art) === cod);
  if (!existe) {
    // v21.30 — queda marcado como "no asignado a este proveedor" para que el WhatsApp
    // del resumen lo diga con todas las letras (no es "se pasó de la OC": no es de él).
    if (!opState.artExtra) opState.artExtra = {};
    opState.artExtra[cod] = true;
    opState.articulos.push({ Cod_Art: cod, Desc: "" });   // mostrar al instante
    arSaveCodeRemote(cod);                                  // Log/Fabr: guardar fijo
    rcpDraftSave();
  }
  drawArticulosGrid();
  openCajas(cod);                                // que le cargue las cajas ya mismo
}

/* ============== Paso 5: resumen ============== */
function renderResumen() {
  const items = Object.entries(opState.cargas)
    .filter(([, n]) => n > 0)
    .map(([cod, n]) => ({ cod, cajas: n }));
  if (items.length === 0) { alert("Cargá al menos un código con cajas."); return; }

  opState.step = "resumen";
  opSetBack(true);
  opTitle.textContent = "Confirmá el envío";
  opSubtitle.textContent = opState.linea + " · " + fechaCorta(opState.fecha) + " · RTO/FC " + opState.remito;

  opBody.innerHTML = "";
  const h = document.createElement("div");
  h.className = "resHeader";
  h.textContent = displayName(opState.tallNombre);
  opBody.appendChild(h);

  const list = document.createElement("div");
  list.className = "resList";
  items.forEach(i => {
    const r = document.createElement("div");
    r.className = "resItem";
    const c = document.createElement("span"); c.className = "resCod"; c.textContent = i.cod;
    const q = document.createElement("span"); q.className = "resCajas"; q.textContent = i.cajas + _rcpUd(i.cod, i.cajas);
    r.appendChild(c); r.appendChild(q);
    list.appendChild(r);
  });
  opBody.appendChild(list);

  const tot = document.createElement("div");
  tot.className = "resTotal";
  // v22.27: los artículos en UNIDADES no se suman a las cajas: van aparte.
  const totalCajas = items.reduce((s, i) => s + (_esCodDecimal(i.cod) ? 0 : i.cajas), 0);
  const totalUni = items.reduce((s, i) => s + (_esCodDecimal(i.cod) ? i.cajas : 0), 0);
  tot.textContent = "Total: " + items.length + " código(s) · " + totalCajas + " cajas" + (totalUni ? " + " + totalUni + " unidades" : "");
  opBody.appendChild(tot);

  // v15.39 — altas nuevas avisadas a Thomy. Es información: NO traba el envío.
  const _sinResp = altaSinRespuesta();
  if (_sinResp.length) {
    const av = document.createElement("div");
    av.className = "resTotal";
    av.style.fontSize = "13px";
    av.style.opacity = ".85";
    av.textContent = "🆕 Artículo nuevo avisado a Thomy: " +
      _sinResp.map(x => x.cod).join(", ") + " — podés enviar igual.";
    opBody.appendChild(av);
  }

  // v11.xx — Foto obligatoria de la mercadería (se sube al confirmar)
  const fotoSec = document.createElement("div");
  fotoSec.className = "opFotoSection";
  const fotoInput = document.createElement("input");
  fotoInput.type = "file"; fotoInput.accept = "image/*";
  fotoInput.setAttribute("capture", "environment");
  fotoInput.style.display = "none";
  const fotoBtn = document.createElement("button");
  fotoBtn.type = "button"; fotoBtn.className = "opFotoBtn" + (opState.fotoFile ? " has" : "");
  fotoBtn.textContent = opState.fotoFile ? "📷 ✓ Foto sacada — tocá para cambiar" : "📷 Sacar foto de la mercadería";
  const fotoPreview = document.createElement("div");
  fotoPreview.className = "opFotoPreview";
  if (opState.fotoPreviewUrl) { const pi = document.createElement("img"); pi.src = opState.fotoPreviewUrl; fotoPreview.appendChild(pi); }
  const fotoHint = document.createElement("div");
  fotoHint.className = "opFotoHint";
  fotoHint.textContent = opState.fotoFile ? "" : "Obligatorio: sacá una foto antes de enviar";
  fotoHint.style.display = opState.fotoFile ? "none" : "";
  fotoBtn.onclick = function() { fotoInput.click(); };
  fotoInput.onchange = function() {
    if (fotoInput.files && fotoInput.files[0]) {
      opState.fotoFile = fotoInput.files[0];
      fotoBtn.textContent = "📷 ✓ Foto sacada — tocá para cambiar";
      fotoBtn.classList.add("has");
      fotoHint.style.display = "none";
      try {
        if (opState.fotoPreviewUrl) URL.revokeObjectURL(opState.fotoPreviewUrl);
        opState.fotoPreviewUrl = URL.createObjectURL(opState.fotoFile);
        fotoPreview.innerHTML = "";
        const pi = document.createElement("img"); pi.src = opState.fotoPreviewUrl; fotoPreview.appendChild(pi);
      } catch(_e){}
      _opConfActualizar();
    }
  };
  fotoSec.appendChild(fotoInput); fotoSec.appendChild(fotoBtn); fotoSec.appendChild(fotoPreview); fotoSec.appendChild(fotoHint);
  opBody.appendChild(fotoSec);

  // v17.27 — igual que la foto, si entró MÁS mercadería que la habilitada por OC hay que
  // avisarle a Thomas por WhatsApp ANTES de enviar. El botón aparece sólo en ese caso y
  // "Confirmar y enviar" queda bloqueado hasta que se toque.
  opBody.appendChild(_opExcesoSeccion());

  opActions.innerHTML = "";
  const volver = document.createElement("button");
  volver.className = "btnCancel btnBig";
  volver.textContent = "‹ Volver";
  volver.onclick = () => renderArticulos();
  const conf = document.createElement("button");
  conf.className = "btnSend btnBig";
  conf.id = "opConfirmar";
  conf.textContent = "✓ Confirmar y enviar";
  conf.onclick = opEnviar;
  opActions.appendChild(volver);
  opActions.appendChild(conf);
  _opConfActualizar();

  // v18.02 — si las OCs todavía no se leyeron, traerlas ACÁ y repintar. Pasa al reanudar un
  // borrador que quedó en el paso "resumen" (`recepcionReanudar` va derecho a esta pantalla
  // sin pasar por la grilla, que es la que las carga): sin esto `ocOk` quedaba en false, el
  // aviso a Thomas no se exigía y el operario enviaba el exceso sin avisar.
  if (opState.ocPorCod === null) {
    cargarOCVigentes().then(function () {
      if (opState.step === "resumen") renderResumen();
    });
  }
  // v19.57 — mismo caso para las ajenas: al reanudar un borrador parado en el resumen no pasó
  // por la grilla, que es la que las pide. Acá alcanza con los códigos cargados.
  if (opState.ocAjena === null) {
    opState.ocAjena = {};
    cargarOCAjenas(Object.keys(opState.cargas || {})).then(function () {
      if (opState.step === "resumen") renderResumen();
    });
  }
  rcpDraftSave();
}

/* ============== Popup de cajas ============== */
function openCajas(cod) {
  opState.cajasCod = cod;
  opCajasCod.textContent = cod;
  const actual = opState.cargas[cod];
  opCajasInput.value = actual > 0 ? String(actual) : "";
  opCajasDelete.style.display = actual > 0 ? "" : "none";
  // v7.07: recordatorio de la OC vigente mientras carga las cajas.
  const oc = ocDeCod(cod);
  opState.cajasOc = oc || null;   // v8.60 — guardado para el aviso de exceso en vivo
  /* v18.08 (Luis: "no pone cartel cuando el código no tiene OC"): la caja se muestra SIEMPRE que
     se hayan podido leer las OCs. Antes, sin OC, se escondía entera y el operario cargaba a ciegas
     — y recién en el resumen se enteraba de que tenía que avisarle a Thomas (gate de la v17.99). */
  if (opCajasOc) {
    opCajasOc.style.display = "";
    opCajasOc.style.background = ""; opCajasOc.style.borderColor = "";
    // v19.57 — el cartel suma la nota de "esto no está en TU OC, es de <otro>".
    if (oc) opCajasOc.innerHTML = _opCajasOcTexto(cod, oc);
    else if (opState.ocOk === true) opCajasOc.innerHTML = _opCajasOcTexto(cod, null);
    else if (ocAjenaDe(cod)) opCajasOc.innerHTML = _opCajasAjena(cod).replace(/^<br>/, "");
    else { opCajasOc.style.display = "none"; opCajasOc.innerHTML = ""; }
  }
  // v11.78: teclado con punto decimal para códigos fraccionarios
  opCajasInput.inputMode = _esCodDecimal(cod) ? "decimal" : "numeric";
  // v22.27 (Marianela 24/09): 55215/55219/55289 se reciben en UNIDADES, no en cajas.
  const _tit = document.getElementById("opCajasTit"), _lbl = document.getElementById("opCajasLbl");
  if (_tit) _tit.textContent = _esCodDecimal(cod) ? "Unidades entregadas" : "Cajas entregadas";
  if (_lbl) _lbl.textContent = _esCodDecimal(cod) ? "¿Cuántas unidades?" : "¿Cuántas cajas?";
  opCajasModal.classList.add("open");
  setTimeout(() => { opCajasInput.focus(); _opCajasExceso(); }, 50);
}
/* v18.08 — el codigo no tiene ninguna OC vigente: lo habilitado es CERO. */
const _OC_SIN = "📑 Este código <b>no tiene OC vigente</b>: no hay cajas habilitadas.";
/* v8.60 — texto base del recordatorio de OC. */
function _opCajasOcBase(oc) {
  return "📑 OC vigente (" + escapeHtmlRcp(fechaCorta(oc.fecha)) + "): <b>" + oc.ped + "</b> caja(s) pedidas" +
    (oc.rec > 0 ? " · <b>" + oc.pend + "</b> por recibir" : "");
}
/* v19.57 — la línea de ENTREGA AJENA: el código no está en la OC de este proveedor, pero sí en
   la de otro. Se suma al cartel que ya estaba (no lo reemplaza): el operario tiene que ver las
   dos cosas — que no hay OC suya, y de quién es. "" si no aplica. */
function _opCajasAjena(cod) {
  const a = ocAjenaDe(cod);
  if (!a) return "";
  return '<br><b style="color:#b45309;">📋 Ojo: este código no está en la OC de ' +
    escapeHtmlRcp(displayName(opState.tallNombre || "")) + '. La OC es de <u>' +
    escapeHtmlRcp(a.otros) + '</u>' + (a.pend > 0 ? ' (' + a.pend + ' pendientes)' : '') +
    '.</b>';
}
/* Texto completo del cartel de OC del pop-up de cajas (OC propia + nota de ajena). */
function _opCajasOcTexto(cod, oc) {
  return (oc ? _opCajasOcBase(oc) : _OC_SIN) + _opCajasAjena(cod);
}
/* v8.60 — aviso EN VIVO si lo tipeado supera lo que falta recibir por OC (caza typos tipo 500 vs 50
   antes de enviar; sin pop-up, no bloquea — mismo espíritu que el aviso ROC pero visible al momento). */
function _opCajasExceso() {
  if (!opCajasOc) return;
  const oc = opState.cajasOc;
  /* v18.08 — el límite es `ocRef(oc)`, EL MISMO que usa `opExcesoItems()` para trabar el envío:
     lo que falta por recibir, o lo pedido si la OC ya se recibió entera, o CERO si no hay OC.
     Antes esto salía temprano con `!oc || !(oc.pend > 0)` y dejaba dos casos mudos — código sin
     OC, y OC ya recibida entera— que el gate del resumen SÍ contaba como exceso (problema 217).
     Si las OCs no se pudieron leer no se afirma nada, igual que el gate. */
  if (opState.ocOk !== true) return;
  const ref = ocRef(oc);
  const n = _esCodDecimal(opState.cajasCod) ? (parseFloat(opCajasInput.value) || 0) : (parseInt(opCajasInput.value, 10) || 0);
  if (n > ref) {
    opCajasOc.style.background = "#fef2f2"; opCajasOc.style.borderColor = "#fca5a5";
    // v17.17 / v17.27 — el aviso queda, pero SIN botón: el operario carga todo de corrido
    // y el aviso a Thomas se pide UNA vez en la pantalla de resumen, con el botón
    // "📲 Enviar WhatsApp a Thomas" (_opExcesoSeccion), que además traba el envío hasta
    // que se toque. Antes (v14.61) el botón estaba acá y lo interrumpía código por código.
    opCajasOc.innerHTML = _opCajasOcTexto(opState.cajasCod, oc) +
      '<br><b style="color:#b91c1c;">⚠ Estás recibiendo más mercadería que la que tenés habilitada: cargás ' +
      n + (ref > 0 ? ' y por OC faltan ' + ref + '.' : ' y este código no tiene ninguna OC.') + '</b>';
  } else {
    opCajasOc.style.background = ""; opCajasOc.style.borderColor = "";
    opCajasOc.innerHTML = _opCajasOcTexto(opState.cajasCod, oc);
  }
}

/* ============== v17.27 — lo que entró de MÁS que la OC: WhatsApp obligatorio ============
   Pedido de Luis (2026-09-14): *"tal y como es obligatorio sacar una foto de la mercadería,
   pone un botón abajo de eso que sea 'Enviar WhatsApp a Thomas' que aparezca cuando se
   selecciona una cantidad de cajas superior a lo que hay en OCs. Que el botón enviar no se
   pueda apretar hasta que no se carga la imagen y hasta que no se aprieta el botón de
   enviar mensaje a Thomas"*. Reemplaza al pop-up de la v17.17, que se sacó.

   Criterio de exceso: MAYOR a lo que falta recibir por OC (`ocRef`), el mismo que el aviso
   en vivo del pop-up de cajas — NO el +20% de `ocExcede`, que es el umbral del aviso por
   Telegram (evento ROC) y sigue como estaba.

   `opState.excesoAvisado` guarda la firma `cod:cajas` de lo que se avisó: si el operario
   vuelve atrás y cambia cantidades, el botón se vuelve a exigir. */
const WA_THOMAS = "5491162521635";
const WA_MARIAN = "5491131181186";   // v24.89: «No recibido» de Pendientes
/* Artículos cargados que superan lo que falta recibir por OC. */
function opExcesoItems() {
  // v17.99 (Luis): un código SIN OC vigente es OC = 0, así que CUALQUIER cantidad es
  // excedente y también hay que avisar. Requiere que las OCs se hayan podido leer
  // (`ocOk`): si la RPC falló no se sabe si el proveedor no tiene OCs o si no hubo red,
  // y ahí no se traba nada.
  if (opState.ocOk !== true) return [];
  return Object.entries(opState.cargas)
    .filter(function (e) { return e[1] > 0; })
    .map(function (e) {
      const cod = e[0], cajas = e[1], oc = ocDeCod(cod), ref = ocRef(oc);
      // v19.57 — `ajena` = el código no está en SU OC pero sí en la de otro proveedor.
      // v21.30 — `noAsig` = lo agregó el operario con "Introducir código diferente", o sea
      // que ese código NO está asignado a este proveedor. Es el caso que pidió Luis y por
      // eso el aviso a Thomas es el mismo que el del exceso de OC (sin OC propia, ref = 0,
      // así que ya entraba por acá: lo que faltaba era decirlo por su nombre).
      return { cod: cod, cajas: cajas, oc: oc, ref: ref, exced: cajas - ref, sinOc: !oc,
               ajena: ocAjenaDe(cod),
               noAsig: !!(opState.artExtra || {})[_ocgNorm(cod)] };
    })
    .filter(function (i) { return i.cajas > i.ref; });
}
/* Firma de lo que hay que avisar. "" = no hay exceso, no hay nada que avisar. */
function opExcesoFirma() {
  return opExcesoItems().map(function (i) { return i.cod + ":" + i.cajas; }).join("|");
}
/* ¿Falta avisarle a Thomas? (hay exceso y todavía no se tocó el botón para ESTA carga). */
function opExcesoPendiente() {
  const f = opExcesoFirma();
  return !!f && opState.excesoAvisado !== f;
}
/* Bloque de la pantalla de resumen: aviso + botón de WhatsApp. Devuelve el nodo siempre
   (vacío y escondido si no hay exceso), así renderResumen no se ramifica. */
function _opExcesoSeccion() {
  const sec = document.createElement("div");
  sec.className = "opExcSection";
  sec.id = "opExcSection";
  const exc = opExcesoItems();
  if (!exc.length) { sec.style.display = "none"; return sec; }

  // v17.30 (Luis): sin cartel de detalle — el operario ya lo vio al cargar las cajas y el
  // desglose viaja en el WhatsApp. Acá va sólo el botón y el aviso de que es obligatorio.
  const firma = opExcesoFirma();
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "opExcWaBtn" + (opState.excesoAvisado === firma ? " has" : "");
  btn.id = "opExcWa";
  btn.textContent = opState.excesoAvisado === firma
    ? "📲 ✓ Mensaje enviado a Thomas — tocá para reenviar"
    : "📲 Enviar WhatsApp a Thomas";
  btn.onclick = function () {
    opWhatsExceso(exc);
    opState.excesoAvisado = firma;
    btn.classList.add("has");
    btn.textContent = "📲 ✓ Mensaje enviado a Thomas — tocá para reenviar";
    const h = document.getElementById("opExcHint");
    if (h) h.style.display = "none";
    _opConfActualizar();
    rcpDraftSave();
  };
  sec.appendChild(btn);

  const hint = document.createElement("div");
  hint.className = "opExcHint";
  hint.id = "opExcHint";
  hint.textContent = "Obligatorio: avisale a Thomas antes de enviar";
  hint.style.display = opState.excesoAvisado === firma ? "none" : "";
  sec.appendChild(hint);

  // Góndola de los códigos en exceso, para el mensaje (best-effort, en paralelo: si todavía
  // no llegó cuando tocan el botón, el mensaje dice "s/dato"). v18.02: se pide UNA vez por
  // firma — esta pantalla se repinta varias veces (foto, WhatsApp, volver) y antes cada
  // repintado tiraba las dos consultas de nuevo y reseteaba lo ya traído a {}.
  if (opState.excesoGondFirma !== firma) {
    opState.excesoGondFirma = firma;
    opState.excesoGond = {};
    try { _opPrefetchGond(exc.map(function (i) { return i.cod; })); } catch (_e) {}
  }
  return sec;
}
/* "Confirmar y enviar" se habilita sólo con la foto sacada Y, si hubo exceso, el WhatsApp
   a Thomas ya mandado. Un solo lugar decide, así no se desincroniza con el onchange de la
   foto ni con el botón de WhatsApp. */
function _opConfActualizar() {
  const cb = document.getElementById("opConfirmar");
  if (!cb) return;
  // v18.02 — mientras las OCs no se hayan leído (`ocPorCod === null`) no se sabe si hay
  // exceso, así que no se habilita: son los ms que tarda la consulta al reanudar un
  // borrador. Si la consulta FALLA, `ocPorCod` queda en {} y el envío se libera.
  cb.disabled = !opState.fotoFile || opState.ocPorCod === null || opExcesoPendiente();
}
/* v14.61 — precarga stock de góndola (vista_saldos_stock.terminado) y capacidad
   (Capacidad_Sector.cajas_max) de los códigos en exceso, para el mensaje a Thomas.
   Best-effort: si no hay dato, el mensaje dice "s/dato". */
async function _opPrefetchGond(cods) {
  const ks = (cods || []).map(function (c) { return String(c || "").trim(); }).filter(Boolean);
  if (!ks.length) return;
  try {
    await sessionReady;
    // v16.51 (problema 92) — se pide `cod_art` en vez de `clave`: para un DUAL la vista emite
    // "809E LK" / "809E CH", así que el `eq("clave", k)` con el código pelado no matcheaba
    // NINGUNA fila y el cartel decía "s/dato" siempre. Y la capacidad se filtra por empresa,
    // que es lo mismo que hace el aviso de exceso (gondCapPorCod / gondAcumPorCod).
    const res = await Promise.all([
      supabase.from("Capacidad_Sector").select("cod,cajas_max,empresa").in("cod", ks),
      supabase.from("vista_saldos_stock").select("cod_art,clave,empresa,terminado,excedente,separar_pedidos,a_facturar,a_guardar,racks,para_envasar,racks_ch").in("cod_art", ks)
    ]);
    const _rowsCap = (res[0] && res[0].data) || [], _rowsG = (res[1] && res[1].data) || [];
    const _dual = gondDualesDe(_rowsG, _ocgNorm);
    const _capX = gondCapPorCod(_rowsCap, _dual, opState.linea, _ocgNorm);
    const _gondX = gondAcumPorCod(_rowsG, opState.linea, _ocgNorm);
    // v22.58 (Luis): lo que compite por la góndola es el stock TOTAL menos lo comprometido
    // (pickeados + a facturar), no sólo lo que está hoy en la góndola.
    const _n = function (v) { return Number(v) || 0; };
    const _totX = gondAcumPorCod(_rowsG, opState.linea, _ocgNorm, function (r) {
      return _n(r.terminado) + _n(r.excedente) + _n(r.separar_pedidos) + _n(r.a_facturar) +
             _n(r.a_guardar) + _n(r.racks) + _n(r.para_envasar) + _n(r.racks_ch); });
    const _compX = gondAcumPorCod(_rowsG, opState.linea, _ocgNorm, function (r) {
      return _n(r.separar_pedidos) + _n(r.a_facturar); });
    const out = {};
    ks.forEach(function (k) {
      const _k = _ocgNorm(k);
      const hasCap = _rowsCap.some(function (r) { return _ocgNorm(r.cod) === _k; });
      const hasG = _rowsG.some(function (r) { return _ocgNorm(r.cod_art) === _k; });
      out[_k] = { cap: hasCap ? (_capX[_k] || 0) : null, gond: hasG ? (_gondX[_k] || 0) : null,
                  total: hasG ? (_totX[_k] || 0) : null, comp: hasG ? (_compX[_k] || 0) : null };
    });
    opState.excesoGond = out;
  } catch (_e) { /* best-effort: queda {} → "s/dato" */ }
}
/* v22.58 (Luis) — ¿entra en góndola? Se compara la CAPACIDAD contra el stock que queda para
   guardar: total − pickeados − a facturar (lo comprometido ya se va) + lo que se recibe ahora.
   Antes se miraba sólo la góndola (terminado) y el 066 decía "entra, 1 libre" con 425 cajas. */
function opExcesoEntraTxt(d, recibo) {
  d = d || {};
  if (d.cap == null || d.total == null) return "s/dato cap.";
  // v25.30 (Luis: "mucho texto") — la cuenta entera no va: stock − comprometidas + lo que recibo
  // queda resumido en "ocupado/capacidad". El cálculo es el mismo de la v22.58.
  const queda = d.total - (d.comp || 0) + (Number(recibo) || 0);
  return queda <= d.cap
    ? ("entra " + queda + "/" + d.cap)
    : ("NO entra " + queda + "/" + d.cap + ", sobran " + (queda - d.cap));
}
/* v14.61 / v17.17 — WhatsApp a Thomas (dueño) con el resumen de TODO lo que entró de más. */
function opWhatsExceso(exc) {
  const g = opState.excesoGond || {};
  // v19.57 — si hay alguna ajena, el título lo dice: no es "se pasó de la OC", es "esto no es
  // de él". El backend además manda su propio aviso por Telegram, que no depende de este botón.
  const hayAjena = (exc || []).some(function (i) { return !!i.ajena; });
  // v21.30 — y el caso de Luis: un código que NO está asignado a este proveedor.
  const hayNoAsig = (exc || []).some(function (i) { return !!i.noAsig && !i.ajena; });
  // v25.30 (Luis: "mucho texto en esas notificaciones") — una línea de título, una de remito
  // y una por código. Los cuatro casos se siguen distinguiendo (sin OC · se pasó · OC de otro ·
  // no asignado); lo que se fue es la cuenta de góndola desarrollada.
  const prov = (opState.tallNombre || "?");
  const L = [
    (hayAjena ? "Thomas, código de otro proveedor (" : hayNoAsig ? "Thomas, código no asignado (" :
      "Thomas, entró de más (") + prov + ")",
    "RTO " + (opState.remito || "s/remito") + " · " + (opState.linea || "") + " · " + fechaCorta(opState.fecha)
  ];
  exc.forEach(function (i) {
    const d = g[_ocgNorm(i.cod)] || {};
    const entra = opExcesoEntraTxt(d, i.cajas);
    L.push("• " + i.cod + ": " + i.cajas + (i.ajena
      ? (", OC de " + i.ajena.otros + (i.ajena.pend > 0 ? " (" + i.ajena.pend + " pend.)" : ""))
      : i.noAsig ? ", no asignado a " + prov
      : i.sinOc ? " sin OC"
      : (", OC " + i.ref + " → " + i.exced + " de más")) + " · " + entra);
  });
  L.push("¿Lo recibo?");
  const url = "https://wa.me/" + WA_THOMAS + "?text=" + encodeURIComponent(L.join("\n"));
  // v18.02 — si el navegador BLOQUEA el pop-up, `window.open` devuelve null sin tirar error:
  // antes se marcaba el aviso como hecho y el WhatsApp nunca salía. Ahí se navega a la URL.
  let w = null;
  try { w = window.open(url, "_blank"); } catch (_e) { w = null; }
  if (!w) { try { location.href = url; } catch (_e2) {} }
}
function closeCajas() { opCajasModal.classList.remove("open"); opState.cajasCod = null; }
// v11.78: códigos con decimales permitidos (cajas fraccionarias)
const _CODS_DECIMAL = ["55215","55219","55289"];
const _esCodDecimal = (c) => _CODS_DECIMAL.indexOf(String(c).replace(/\D/g,"")) >= 0;
// v22.27: esos tres van en UNIDADES en todo el sistema (uxb 1): la etiqueta lo dice.
function _rcpUd(cod, n) { return _esCodDecimal(cod) ? " u" : (" caja" + (n === 1 ? "" : "s")); }
opCajasInput.oninput = () => {
  if (_esCodDecimal(opState.cajasCod)) {
    opCajasInput.value = opCajasInput.value.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
  } else {
    opCajasInput.value = opCajasInput.value.replace(/\D/g, "");
  }
  _opCajasExceso();
};
opCajasInput.addEventListener("keydown", e => {
  if (e.key === "Enter") { e.preventDefault(); opCajasNext.click(); }
});
opCajasClose.onclick = closeCajas;
/* v15.76 — buscador de códigos activos del "+" de Log/Fabr. */
arBusClose.onclick = arBusCerrar;
arBusModal.onclick = function (e) { if (e.target === arBusModal) arBusCerrar(); };
arBusInput.oninput = arBusDibujar;
arBusInput.onkeydown = function (e) { if (e.key === "Escape") arBusCerrar(); };
// Antes: tocar el fondo oscuro cerraba el pop-up. Lo sacamos para que NO se cierre
// solo si el empleado tarda en cargar / toca fuera sin querer — solo se cierra con
// la ✕ o al cargar el número. (Pedido: "que se mantenga".)
opCajasNext.onclick = () => {
  const n = _esCodDecimal(opState.cajasCod) ? (parseFloat(opCajasInput.value) || 0) : (parseInt(opCajasInput.value, 10) || 0);
  if (n > 0) opState.cargas[opState.cajasCod] = n;
  else delete opState.cargas[opState.cajasCod];
  closeCajas();
  drawArticulosGrid();
};
opCajasDelete.onclick = () => {
  delete opState.cargas[opState.cajasCod];
  closeCajas();
  drawArticulosGrid();
};

/* ============== Verificación de código (v9.26) ============== */
/* Genera código de 4 dígitos al azar */
function generateVerificationCode() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

/* Modal de verificación: pide escribir el código antes de enviar */
async function showVerificationModal() {
  const code = generateVerificationCode();

  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.id = "rcpVerifyOverlay";
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.5); z-index: 9999;
      display: flex; align-items: center; justify-content: center;
      font-family: inherit;
    `;

    const modal = document.createElement("div");
    modal.style.cssText = `
      background: white; border-radius: 12px; padding: 24px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      max-width: 400px; width: 90vw; text-align: center;
      font-family: inherit;
    `;

    const title = document.createElement("h2");
    title.textContent = "Verificación de Remito";
    title.style.cssText = `margin: 0 0 16px 0; font-size: 18px; color: #1f2937;`;
    modal.appendChild(title);

    const instruction = document.createElement("p");
    instruction.textContent = "Escribí este código en el remito y copialo acá:";
    instruction.style.cssText = `margin: 0 0 16px 0; color: #6b7280; font-size: 14px;`;
    modal.appendChild(instruction);

    const codeDisplay = document.createElement("div");
    codeDisplay.textContent = code;
    codeDisplay.style.cssText = `
      background: #f3f4f6; padding: 16px; border-radius: 8px;
      font-size: 32px; font-weight: bold; letter-spacing: 8px;
      margin: 0 0 8px 0; font-family: 'Courier New', monospace;
      color: #1f2937;
    `;
    modal.appendChild(codeDisplay);

    const codeHint = document.createElement("p");
    codeHint.textContent = "✏️ Escribir en el remito físico";
    codeHint.style.cssText = `
      margin: 0 0 20px 0; color: #9ca3af; font-size: 13px; font-style: italic;
    `;
    modal.appendChild(codeHint);

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Escribí el código";
    input.maxLength = "4";
    input.style.cssText = `
      width: 100%; padding: 12px; font-size: 18px; border: 2px solid #e5e7eb;
      border-radius: 8px; box-sizing: border-box; margin: 0 0 16px 0;
      font-family: 'Courier New', monospace; letter-spacing: 4px;
      text-align: center;
    `;
    input.oninput = () => {
      input.value = input.value.replace(/[^0-9]/g, "");
    };
    modal.appendChild(input);

    const buttonContainer = document.createElement("div");
    buttonContainer.style.cssText = `
      display: flex; gap: 10px; margin-top: 16px;
    `;

    const confirmBtn = document.createElement("button");
    confirmBtn.textContent = "✓ Confirmar";
    confirmBtn.style.cssText = `
      flex: 1; padding: 12px; background: #2563eb; color: white;
      border: none; border-radius: 8px; font-size: 14px; font-weight: bold;
      cursor: pointer; transition: background 0.2s;
    `;
    confirmBtn.onmouseover = () => { confirmBtn.style.background = "#1d4ed8"; };
    confirmBtn.onmouseout = () => { confirmBtn.style.background = "#2563eb"; };
    confirmBtn.onclick = () => {
      if (input.value === code) {
        overlay.remove();
        resolve(true);
      } else {
        input.style.borderColor = "#ef4444";
        input.style.background = "#fee2e2";
        setTimeout(() => {
          input.style.borderColor = "#e5e7eb";
          input.style.background = "white";
          input.value = "";
          input.focus();
        }, 1000);
      }
    };
    buttonContainer.appendChild(confirmBtn);

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "✕ Cancelar";
    cancelBtn.style.cssText = `
      flex: 1; padding: 12px; background: #e5e7eb; color: #1f2937;
      border: none; border-radius: 8px; font-size: 14px; font-weight: bold;
      cursor: pointer; transition: background 0.2s;
    `;
    cancelBtn.onmouseover = () => { cancelBtn.style.background = "#d1d5db"; };
    cancelBtn.onmouseout = () => { cancelBtn.style.background = "#e5e7eb"; };
    cancelBtn.onclick = () => {
      overlay.remove();
      resolve(false);
    };
    buttonContainer.appendChild(cancelBtn);

    modal.appendChild(buttonContainer);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    input.focus();
  });
}

/* Exponer showVerificationModal globalmente para acceso desde index.html (MG, etc.) */
if (typeof window !== "undefined") {
  window.showVerificationModal = showVerificationModal;
}

/* ============== Enviar (graba todo) ============== */
async function opEnviar() {
  // v18.02 — guard del aviso a Thomas. El gate real es el botón deshabilitado
  // (`_opConfActualizar`); esto es la red de contención para cualquier camino que llegue acá
  // con el exceso sin avisar (un repintado viejo, una carrera con la carga de las OCs).
  if (opExcesoPendiente()) {
    alert("Entró mercadería que la OC no habilita.\n\nTocá 📲 Enviar WhatsApp a Thomas antes de confirmar.");
    _opConfActualizar();
    return;
  }
  // v10.11 — SACADA la "Verificación de Remito" (código a escribir en el remito ANTES de enviar):
  // la recepción da UN SOLO código, el de confirmación del final (pendGenCodigo, más abajo).
  const descPorCod = {};
  (opState.articulos || []).forEach(a => { descPorCod[a.Cod_Art] = a.Desc || ""; });
  const items = Object.entries(opState.cargas)
    .filter(([, n]) => n > 0)
    .map(([cod, n]) => ({ cod, cajas: n, desc: descPorCod[cod] || "" }));
  if (items.length === 0) { alert("Cargá al menos un código con cajas."); return; }

  // v20.58 - sin fecha no se graba. Antes, con opState.fecha vacio, Dia_mes entraba como ""
  // y la entrega quedaba sin fecha sin que nada avisara. Centinela: gv_fechas_carga_invalidas.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(opState.fecha || ""))) {
    alert("Falta la fecha de la recepci\u00f3n. Elegila antes de confirmar.");
    return;
  }

  const totalCajas = items.reduce((s, i) => s + i.cajas, 0);

  const btn = document.getElementById("opConfirmar");
  btn.disabled = true;
  const prev = btn.textContent;
  btn.textContent = "Enviando…";

  const session = await sessionReady;
  if (!session) {
    btn.disabled = false; btn.textContent = prev;
    alert("No se pudo iniciar sesión anónima. Avisá al admin y refrescá la página.");
    return;
  }

  /* v22.51 (Luis, 25/09) — la foto es OBLIGATORIA y se sube PRIMERO, antes de grabar la
     entrega. Antes se subía al final y, si fallaba, el catch seguía "sin foto": así entró
     Poly 38845 (24/09) con la foto sacada y sin foto en Pendientes. Si no sube, no se graba
     nada y el operario reintenta. */
  if (!opState.fotoFile) {
    btn.disabled = false; btn.textContent = prev;
    alert("Falta la foto de la mercadería. Sacala antes de confirmar.");
    return;
  }
  let fotoUrl = null, fotoErr = null;
  for (let intento = 0; intento < 3 && !fotoUrl; intento++) {
    try {
      const fId = "op_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
      fotoUrl = await pendUploadFoto(fId, opState.fotoFile);
    } catch (e) { fotoErr = e; if (intento < 2) await new Promise(r => setTimeout(r, 1500)); }
  }
  if (!fotoUrl) {
    btn.disabled = false; btn.textContent = prev;
    alert("No se pudo subir la foto (" + ((fotoErr && fotoErr.message) || "sin respuesta") + ").\n\nNo se grabó nada. Revisá la señal y tocá Confirmar de nuevo.");
    return;
  }

  let tabla, rows;
  if (opState.tipo === 'prov_at') {
    tabla = "Entregas Prov AT";
    // v20.58 - la fecha va con ANIO (dd/mm/aa). Hasta aca se guardaba "18-09": el anio se
    // tiraba SIEMPRE, y a las 41 filas que quedaron asi hubo que datarlas despues mirando
    // Fecha_RTO / Fecha_Factura, con 4 que no se pudieron. Comparar con la rama de abajo,
    // que para "Entregas Tallerista Virgilio" siempre guardo la fecha entera.
    const partes = (opState.fecha || "").split("-");
    const diaMes = (partes.length === 3)
      ? (partes[2] + "/" + partes[1] + "/" + partes[0].slice(-2))
      : "";
    rows = items.map(i => ({
      Dia_mes: diaMes,
      Proveedor: opState.tallNombre,
      Cod_Art: i.cod,
      Descripcion: i.desc,
      Cantidad: i.cajas,
      Remito: opState.remito,
      Tipo_Entrega: opState.tipoDoc || null,
      Fecha_RTO: opState.fechaRemito || null,
      Numero_Factura: opState.nroFactura || null,
      Fecha_Factura: opState.fechaFactura || null
    }));
  } else {
    tabla = "Entregas Tallerista Virgilio";
    rows = items.map(i => ({
      Fecha: opState.fecha,
      Codigo_Tall: opState.tallCod,
      Nombre_Tall: opState.tallNombre,
      Cod: i.cod,
      Cajas: i.cajas,
      // v22.37: la empresa (línea elegida) viaja con la entrega, así la OC de un dual
      // ("437E CH") se imputa sola con gv_oc_recompute_recibido.
      gv_empresa: opState.linea || null,
      Remito: opState.remito,
      Tipo_Entrega: opState.tipoDoc || null,
      Fecha_RTO: opState.fechaRemito || null,
      Numero_Factura: opState.nroFactura || null,
      Fecha_Factura: opState.fechaFactura || null
    }));
  }

  // idea 9047 + v14.57: dedup de remito. Reenviar el mismo remito (timeout ambiguo /
  // recarga con mala señal de depósito) duplicaba cajas en Movimientos_Stock y filas de
  // Entregas. Antes de insertar avisamos si ese remito ya está cargado. Dos chequeos, UN
  // solo aviso blando (deja seguir si confirma):
  //  (a) HOY en Control_Modo_OP por remito + línea → es lo que el supervisor ve repetido
  //      en Pendientes; mostramos el código ya asignado y la hora de la carga previa.
  //  (b) histórico en la tabla de Entregas por remito + tallerista/proveedor (idea 9047).
  // Falla ABIERTO: si el chequeo no se puede hacer (red), no bloquea la carga.
  if (String(opState.remito || "").trim()) {
    let aviso = null;
    // (a) mismo remito + línea, cargado hoy (Control_Modo_OP → Pendientes). Comparamos
    //     ARTÍCULOS: repetir un código que ya se cargó hoy DUPLICA stock (aviso fuerte);
    //     cargar SOLO códigos nuevos del mismo remito es un complemento legítimo —ej.: un
    //     artículo fuera de la OC que el dueño recién habilita y se carga aparte una vez
    //     autorizado— así que ahí el aviso es informativo, no de duplicado.
    try {
      const desde = opTodayStr() + "T00:00:00-03:00";
      let qc = supabase.from("Control_Modo_OP")
        .select("codigo,created_at,detalle")
        .eq("remito", opState.remito)
        .neq("estado", "anulado")
        .gte("created_at", desde)
        .order("created_at", { ascending: true });
      if (opState.linea) qc = qc.eq("linea", opState.linea);
      const { data: cmo } = await qc;
      if (cmo && cmo.length) {
        // Códigos ya cargados hoy para este remito+línea (parse del `detalle`: "COD → N · COD → N").
        const yaCods = new Set();
        cmo.forEach(function (r) {
          String(r.detalle || "").split("·").forEach(function (p) {
            const cod = p.split("→")[0].trim();
            if (cod) yaCods.add(cod);
          });
        });
        const repetidos = items.filter(function (i) { return yaCods.has(String(i.cod).trim()); }).map(function (i) { return i.cod; });
        const nuevos = items.filter(function (i) { return !yaCods.has(String(i.cod).trim()); }).map(function (i) { return i.cod; });
        const primera = cmo[0];
        let hh = "";
        try { if (primera.created_at) hh = new Date(primera.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" }); } catch (_e) {}
        const ref = "remito " + opState.remito + (opState.linea ? " (" + opState.linea + ")" : "") +
          " ya se cargó hoy" + (hh ? " a las " + hh : "") + "";
        if (repetidos.length) {
          aviso = "⚠ El " + ref + ". Esa carga YA incluía: " + repetidos.join(", ") + "." +
            (nuevos.length ? "\nNuevos en esta carga: " + nuevos.join(", ") + "." : "") +
            "\n\nSi cargás los repetidos se DUPLICAN las cajas y el stock.";
        } else {
          aviso = "ℹ El " + ref + ", con otros artículos.\nAhora vas a AGREGAR: " + nuevos.join(", ") +
            ".\n\nSon códigos distintos: no duplica. (Normal si completás un remito que quedó a medias, ej.: artículos habilitados después.)";
        }
      }
    } catch (_e) { /* chequeo falla abierto: no bloquea la carga */ }
    // (b) histórico por remito + tallerista/proveedor en la tabla de Entregas (idea 9047)
    if (!aviso) {
      try {
        let q = supabase.from(tabla).select("Remito").eq("Remito", opState.remito).limit(1);
        q = (opState.tipo === 'prov_at') ? q.eq("Proveedor", opState.tallNombre) : q.eq("Codigo_Tall", opState.tallCod);
        const { data: yaHay } = await q;
        if (yaHay && yaHay.length) aviso = "⚠ El remito " + opState.remito + " ya figura cargado para " + opState.tallNombre + ".\n\nSi lo reenviás se DUPLICAN las cajas y el stock.";
      } catch (_e) { /* chequeo falla abierto: no bloquea la carga */ }
    }
    if (aviso) {
      const ok = confirm(aviso + "\n\n¿Cargar igual?");
      if (!ok) { btn.disabled = false; btn.textContent = prev; return; }
    }
  }

  const { error } = await supabase.from(tabla).insert(rows);

  if (error) {
    btn.disabled = false; btn.textContent = prev;
    const msg = error.message || "";
    if (/remito/i.test(msg)) {
      alert('Falta crear la columna "Remito" en la tabla "' + tabla + '".\n\n' +
        'Pedile al admin que ejecute en el SQL Editor de Supabase:\n\n' +
        'ALTER TABLE "' + tabla + '" ADD COLUMN "Remito" text;');
    } else {
      alert("Error al guardar: " + msg);
    }
    return;
  }

  // Suma al acumulador del día para que Producción cierre RT con esta cantidad.
  recpAddCajas(totalCajas);
  // v14.59 — descuenta la OC vigente del proveedor al recibir (backend gv_oc_aplicar_recepcion,
  // en cascada, sin negativos). Así las cantidades a recibir BAJAN y la OC deja de figurar/
  // imprimirse cuando se completa — antes cantidad_recibida no se tocaba nunca. Best-effort:
  // si falla, no bloquea la recepción; la OC simplemente no se descuenta esta vez.
  // v22.42 (Luis, 24/09: "tiene que reintentar hasta que esté"). La imputación va a una COLA
  // persistente (localStorage) y se reintenta hasta que la base la acepte, aunque se cierre la
  // app: rcpOcDrain corre también al cargar y al volver la conexión. Normalmente entra a la
  // primera (0,16 s); el 24/09 11:49 falló porque la base estaba saturada. Red extra en el
  // backend: cron gv-oc-recepcion-red recalcula lo recibido en las últimas 36 h.
  try { rcpOcEncolar(opState.tallNombre, items.map(function (i) { return { cod: i.cod, cajas: i.cajas }; })); } catch (_e) {}
  // v11.98: cierra el toggle RT automáticamente (el operario ya no tiene que volver
  // a la botonera para terminar el inicio→fin de Recepción Mercadería).
  try { if (typeof window.autoCloseRT === "function") window.autoCloseRT(RECP.legajo, { inicioMs: opState.t0, cajas: totalCajas }); } catch (_e) {}
  rcpDraftClear();   // v7.12: ya se envió, no hay nada que reanudar

  // v4.06: STOCK — lo recibido ENTRA a "Mercadería a guardar" (Movimientos_Stock).
  // Best-effort; si falla, queda en vir_stock_pend y lo reintenta index.html (stockFlushPend).
  // idea 5490: un client_id ESTABLE por fila; el mismo id se usa en el insert y en la
  // cola offline, así el reintento (POST que llegó pero cuya respuesta se perdió) NO
  // duplica cajas (índice único parcial mov_stock_clientid_dedup + ignore-duplicates).
  const _cid = () => { try { if (typeof crypto !== "undefined" && crypto.randomUUID) return "mst_" + crypto.randomUUID(); } catch (_e) {} return "mst_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10); };
  const stockRows = items.map(i => ({
    cod_art: String(i.cod), descripcion: i.desc || null,
    deposito: 'a_guardar', delta: i.cajas, tipo: 'recepcion', ref: opState.remito || null,
    legajo: RECP.legajo || null,   // idea 7725: legajo para sumar el total del día cruzando dispositivos al cerrar RT
    // v12.38 — empresa de la recepción = línea que eligió el operario (LK/CH). Para los
    // códigos duales (437E/438E/439E/809E) esto ubica el stock recibido en la góndola
    // correcta; para el resto el trigger zz_normalizar_empresa lo fuerza a 'Mixto'. Sin
    // esto un dual recibido quedaba en limbo 'Mixto' (ni LK ni CH). La fuente de verdad
    // sigue siendo el trigger en el backend; esto es la señal correcta que el front manda.
    empresa: opState.linea || null,
    client_id: _cid()
  }));
  try {
    const { error: stErr } = await supabase.from("Movimientos_Stock").insert(stockRows);
    if (stErr) throw stErr;
  } catch (e) {
    console.warn("Movimientos_Stock recepcion (queda pendiente):", e);
    try {
      const p = JSON.parse(localStorage.getItem("vir_stock_pend") || "[]");
      p.push.apply(p, stockRows);   // MISMO client_id → stockFlushPend reintenta idempotente
      localStorage.setItem("vir_stock_pend", JSON.stringify(p.slice(-5000)));
    } catch (_e) {}
  }

  // idea 3239 — AVISO (no bloquea): lo recibido no entra en góndola + no estaba en la OC + baja
  // rotación → pedir confirmación de que no se devuelve. Best-effort, después de registrar.
  gondReturnCheck(items).then(function (flag) {
    if (!flag || !flag.length) return;
    const txt = flag.map(function (f) { return "• " + f.cod + " — llegan " + f.cajas + " (góndola " + Math.round(f.gond) + "/" + Math.round(f.cap) + " máx · proy " + Math.round(f.proy) + " caj/mes)"; }).join("\n");
    try { alert("⚠ OJO: esto NO entra en góndola, es de baja rotación y NO estaba en la OC:\n\n" + txt + "\n\nPedí AUTORIZACIÓN / confirmación de que no se devuelve."); } catch (_e) {}
  }).catch(function () {});

  // v4.61 — AVISO recepción sin planimetría: si llegan códigos que NO tienen lugar en
  // la góndola (window.GONDOLA, planimetría), se emite un evento RSP → trigger Telegram
  // + categoría "sin_planimetria" en el tablero Agentes. Best-effort, no bloquea.
  try {
    const G = (typeof window !== "undefined" && window.GONDOLA) ? window.GONDOLA : null;
    if (G) {
      const seen = {}, sinLugar = [];
      items.forEach(i => { const k = _ocgNorm(i.cod); if (k && !G[k] && !seen[k]) { seen[k] = 1; sinLugar.push(String(i.cod)); } });
      if (sinLugar.length) {
        const cid = "rsp_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        supabase.from("Registros_Produccion_Virgilio").insert({
          client_id: cid, legajo: String(RECP.legajo || ""), opcion: "RSP",
          descripcion: "Recepción sin planimetría",
          texto: (opState.remito || "s/remito") + "|" + sinLugar.join(","),
          ts_cliente: new Date().toISOString()
        }).then(() => {}, () => {});
      }
    }
  } catch (_e) {}

  // v7.07 — AVISO recepción que EXCEDE la OC vigente (+20%): SIN pop-up ni aprobación,
  // al operario no se lo interrumpe. Se emite el evento ROC (mismo patrón que RSP) con
  // proveedor, remito y "cod:recibidas/pedidas"; el trigger
  // trg_recepcion_excede_oc_telegram manda el aviso por Telegram. Best-effort.
  try {
    const exc = items.filter(i => ocExcede(i.cod, i.cajas));
    if (exc.length) {
      const det = exc.map(i => i.cod + ":" + i.cajas + "/" + ocRef(ocDeCod(i.cod))).join(",");
      const cid = "roc_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      supabase.from("Registros_Produccion_Virgilio").insert({
        client_id: cid, legajo: String(RECP.legajo || ""), opcion: "ROC",
        descripcion: "Recepción excede la OC (+" + Math.round(OC_EXCESO_PCT * 100) + "%)",
        texto: (opState.tallNombre || "?") + "|" + (opState.remito || "s/remito") + "|" + det,
        ts_cliente: new Date().toISOString()
      }).then(() => {}, () => {});
    }
  } catch (_e) {}

  // La foto ya se subió al principio (v22.51): fotoUrl está sí o sí.

  // v8.83: generar código de 4 dígitos ANTES de insertar, así el operario lo ve de una.
  let codigoConf = null;
  try { codigoConf = await pendGenCodigo(); } catch (_e) {}

  // Registro para el checklist de Marianela (un renglón por envío). No bloquea.
  let pendId = null;
  try {
    const detalle = items.map(i => i.cod + " → " + i.cajas).join(" · ");
    const insertObj = {
      fecha: opState.fecha,
      tipo: opState.tipo,
      nombre: opState.tallNombre,
      codigo_tall: opState.tallCod || null,
      linea: opState.linea,
      remito: opState.remito,
      detalle: detalle,
      cantidad_total: totalCajas,
      estado: 'pendiente'
    };
    if (fotoUrl) insertObj.foto_url = fotoUrl;
    if (codigoConf) insertObj.codigo = codigoConf;
    const { data: regData, error: errReg } = await supabase.from("Control_Modo_OP").insert(insertObj).select("id").single();
    if (errReg) console.warn("Control_Modo_OP insert error (¿falta crear la tabla?):", errReg);
    else { pendId = regData ? regData.id : null; }
  } catch (e) { console.warn("Control_Modo_OP excepcion:", e); }

  opSetBack(false);
  opTitle.textContent = "Listo";
  opSubtitle.textContent = "";
  opBody.innerHTML = "";
  const ok = document.createElement("div");
  ok.className = "opOk";
  ok.textContent = "✓ Enviado. " + rows.length + " código(s) guardado(s) para " + displayName(opState.tallNombre) +
    " (" + opState.linea + ") · RTO/FC " + opState.remito + ".";
  opBody.appendChild(ok);
  // v22.55 (Luis): el código de confirmación ya no se usa — no se le muestra al operario.

  opActions.innerHTML = "";
  const cerrar = document.createElement("button");
  cerrar.className = "btnCancel";
  cerrar.textContent = "Cerrar";
  cerrar.onclick = closeOp;
  if (pendId != null) {
    const anular = document.createElement("button");
    anular.className = "btnAnular";
    anular.textContent = "✕ Anular este envío";
    anular.onclick = async () => {
      const okAnu = await anularModoOP(pendId);
      if (okAnu) {
        recpAddCajas(-totalCajas);   // revertir el acumulador del día
        opBody.innerHTML = '<div class="opOk" style="color:var(--danger)">✕ Envío anulado. Cargalo de nuevo cuando quieras.</div>';
        opActions.innerHTML = "";
        const c = document.createElement("button"); c.className = "btnSend"; c.textContent = "Cargar de nuevo"; c.onclick = openOp;
        const cc = document.createElement("button"); cc.className = "btnCancel"; cc.textContent = "Cerrar"; cc.onclick = closeOp;
        opActions.appendChild(cc); opActions.appendChild(c);
      }
    };
    opActions.appendChild(anular);
  }
  const otra = document.createElement("button");
  otra.className = "btnSend";
  otra.textContent = "Cargar otra entrega";
  otra.onclick = openOp;
  opActions.appendChild(cerrar);
  opActions.appendChild(otra);
}

async function anularModoOP(pendId) {
  if (pendId == null) { alert("No se puede anular (no se guardó el registro)."); return false; }
  if (!confirm("¿ANULAR esta carga?\n\nSe borra de la base y vas a tener que cargarla de nuevo.")) return false;
  const { data, error } = await supabase.rpc("anular_modo_op", { p_id: pendId });
  if (error) {
    alert("No se pudo anular: " + error.message + "\n\n(Puede que falte crear la función 'anular_modo_op' en Supabase.)");
    return false;
  }
  if (data === 'ok') return true;
  if (data === 'vencido') { alert("Esta carga tiene más de 48 h: no se puede anular desde la app. Pedíselo al admin."); return false; }
  if (data === 'ya_anulado') { alert("Esta carga ya estaba anulada."); return false; }
  alert("No se encontró la carga."); return false;
}

/* ============== Menú (supervisor) + Pendientes ==============
   El supervisor entra por "Carga Recepción Mercadería" → menú LOCAL con dos
   opciones: Carga Manual (el mismo flujo del operario) y Pendientes (checklist
   de las recepciones cargadas, leídas de Control_Modo_OP). Todo embebido, sin
   iframe. "Listo" marca la recepción como revisada (estado='listo'). */
function renderMenu() {
  opState.step = "menu";
  opState.fromMenu = true;
  opAnularBarRender(false);   // supervisor: no hay sesión RT que anular
  opPage.classList.remove("pendWide");
  opSetBack(false);
  opTitle.textContent = "Recepción de Mercadería";
  opSubtitle.textContent = "";
  opActions.innerHTML = "";
  opBody.innerHTML = "";
  const cont = document.createElement("div");
  cont.className = "opTipoBtns";
  // Orden por importancia (pedido del dueño, v5.93): 1º Pendientes (con contador de
  // remitos por cargar), 2º Bajadas Racks, 3º Carga Manual (chico = uso puntual).
  const bp = document.createElement("button");
  bp.type = "button"; bp.className = "opTipoBtn";
  bp.textContent = "📋 Pendientes";
  bp.onclick = () => renderPendientes();
  const br = document.createElement("button");
  br.type = "button"; br.className = "opTipoBtn";
  br.textContent = "📦 Bajadas Racks → góndola";
  br.onclick = () => renderBajadasRacks();
  const bc = document.createElement("button");
  bc.type = "button"; bc.className = "opTipoBtn opBtnSm";
  bc.textContent = "✍️ Carga Manual";
  bc.onclick = () => { opResetState(); renderTipoElegir(); };   // fromMenu sigue true → "Atrás" vuelve al menú
  const bh = document.createElement("button");
  bh.type = "button"; bh.className = "opTipoBtn opBtnSm";
  bh.textContent = "📜 Histórico de recepción";
  bh.onclick = () => renderHistorico();
  const bhb = document.createElement("button");   // v10.15 — histórico de bajadas de racks
  bhb.type = "button"; bhb.className = "opTipoBtn opBtnSm";
  bhb.textContent = "📥 Histórico bajadas de racks";
  bhb.onclick = () => renderHistoricoBajadas();
  cont.appendChild(bp); cont.appendChild(br); cont.appendChild(bc); cont.appendChild(bh); cont.appendChild(bhb);
  opBody.appendChild(cont);
  // Contadores en los botones: remitos pendientes de cargar + bajadas por aprobar.
  pendBadgePend(bp);
  racksBadgePend(br);
}

/* ===== HISTÓRICO de recepción (v6.41) — registro de la mercadería recibida,
   SOLO LECTURA, filtrable por fecha y/o código. Fuentes durables:
   • "Entregas Tallerista Virgilio" (principal): Fecha texto YYYY-MM-DD + created_at,
     Cod, Cajas, Nombre_Tall, Remito. Se filtra por la col Fecha (texto) para
     evitar líos de zona horaria; se ordena Fecha↓ + created_at↓.
   • "Entregas Prov AT" (secundaria): Dia_mes "DD-MM" SIN año → se asume el año en
     curso para filtrar/ordenar (todos los datos son del año actual). Cod_Art,
     Cantidad, Descripcion, Proveedor, Remito.
   El registro lo genera y mantiene Virgilio solo: cada recepción (opEnviar) ya
   graba estas tablas; acá únicamente se consultan. ===== */
function escapeHtmlRcp(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (m) {
    return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m];
  });
}
function histShiftYmd(days) {
  const d = new Date(); d.setDate(d.getDate() + days);
  const p = n => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}
function histMonthStartYmd() {
  const d = new Date(), p = n => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-01";
}
/* v18.80 (Luis, 2026-09-16: "fechas no están ordenadas y formato de fecha inconsistente").
   La fecha del histórico sale de `vista_historial_entregas.fecha`, que es TEXTO porque las dos
   tablas de origen la guardan como texto: `"Entregas Prov AT".Dia_mes` y
   `"Entregas Tallerista Virgilio".Fecha`. Convivían CUATRO formatos (`2026-09-15`, `01/07/26`,
   `01-09` sin año, y una fila con `|||`), y eso rompía tres cosas a la vez: la columna mezclaba
   `01/07/26` con `15/09`, el orden salía mal —comparar fechas como texto pone `0…` DESPUÉS de
   `2026-…`— y los filtros Desde/Hasta (que son `gte`/`lte` sobre ese texto) dejaban 121 filas
   afuera sin avisar.

   **El arreglo vive en el backend**, como manda el protocolo: `gv_fecha_recepcion_norm` normaliza
   todo a `YYYY-MM-DD` dentro de la vista, y lo que no es una fecha devuelve NULL (así no ensucia
   el orden ni los filtros). `sql/gv_vista_historial_entregas_fecha_v1880.sql`.

   `histYmd` es la MISMA regla duplicada acá, y sólo como red de seguridad: si algún día una fila
   llega sin normalizar (una vista vieja, un origen nuevo), la pantalla la sigue ordenando y
   mostrando bien en vez de tirarla al fondo de la tabla. No es la fuente de verdad. */
function histYmd(f) {
  const s = String(f == null ? "" : f).trim();
  let m;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) return m[1] + "-" + m[2] + "-" + m[3];
  const p2 = function (x) { return ("0" + x).slice(-2); };
  if ((m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s))) return m[3] + "-" + p2(m[2]) + "-" + p2(m[1]);
  if ((m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2})$/.exec(s))) return "20" + m[3] + "-" + p2(m[2]) + "-" + p2(m[1]);
  // Sin año: el que está en curso, salvo que caiga en el futuro (un 28-12 leído en enero es
  // del año pasado, no del que viene). Mismo criterio que la función de Supabase.
  if ((m = /^(\d{1,2})[/-](\d{1,2})$/.exec(s))) {
    const hoy = new Date(), y = hoy.getFullYear();
    const cand = new Date(y, Number(m[2]) - 1, Number(m[1]));
    const anio = (cand.getTime() - hoy.getTime() > 30 * 86400000) ? (y - 1) : y;
    return anio + "-" + p2(m[2]) + "-" + p2(m[1]);
  }
  return "";
}
/* La etiqueta de la columna Fecha. `conAnio` lo decide `histRender` mirando TODO el resultado:
   si lo filtrado cae en un solo año va `dd/mm` (lo de siempre), y si cruza de año va `dd/mm/aa`
   en TODAS las filas — nunca mezclado, que es justo lo que se estaba viendo. */
function histFechaTxt(ymd, conAnio) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || "");
  if (!m) return "—";
  return m[3] + "/" + m[2] + (conAnio ? "/" + m[1].slice(2) : "");
}
let _histReqSeq = 0;
function renderHistorico() {
  opState.step = "hist";
  opPage.classList.remove("pendWide");
  opSetBack(true);
  opTitle.textContent = "Histórico de Recepción";
  opSubtitle.textContent = "Mercadería recibida — filtrá por fecha y/o código";
  opActions.innerHTML = "";
  opBody.innerHTML =
    '<div class="histBar">' +
      '<div class="histField"><label for="histDesde">Desde</label><input type="date" id="histDesde" class="histDate"></div>' +
      '<div class="histField"><label for="histHasta">Hasta</label><input type="date" id="histHasta" class="histDate"></div>' +
      '<div class="histField"><label for="histCod">Código o quién entregó</label><input type="text" id="histCod" class="histCod" placeholder="ej. 590 o Rafael" inputmode="text" autocomplete="off"></div>' +
      '<button class="histBtn plus" id="histMas" title="Más filtros"><span class="plusIco">＋</span><span class="plusTxt" id="histMasTxt">filtros</span></button>' +
      '<div class="histBtns"><button class="histBtn pri" id="histBuscar">Buscar</button><button class="histBtn" id="histLimpiar">Limpiar</button></div>' +
    '</div>' +
    '<div class="histBar histMore" id="histMore">' +
      '<div class="histField"><label for="histQuien">Quién entregó</label><input type="text" id="histQuien" class="histCod" placeholder="ej. Pintos" autocomplete="off"></div>' +
      '<div class="histField"><label for="histRemito">Remito</label><input type="text" id="histRemito" class="histCod" placeholder="ej. 37573" autocomplete="off"></div>' +
      '<div class="histField"><label for="histCajMin">Cajas mínimas</label><input type="number" id="histCajMin" class="histCod" placeholder="ej. 50" min="0" inputmode="numeric"></div>' +
    '</div>' +
    '<div class="histPresets">' +
      '<button class="histChip" data-preset="hoy">Hoy</button>' +
      '<button class="histChip" data-preset="7">7 días</button>' +
      '<button class="histChip" data-preset="mes">Este mes</button>' +
      '<button class="histChip" data-preset="todo">Todo</button>' +
    '</div>' +
    '<div id="histResults"><div class="histLoading">Cargando…</div></div>';
  document.getElementById("histBuscar").onclick = () => histBuscar();
  document.getElementById("histLimpiar").onclick = () => {
    ["histDesde", "histHasta", "histCod", "histQuien", "histRemito", "histCajMin"].forEach(function (id) {
      const el = document.getElementById(id); if (el) el.value = "";
    });
    histBuscar();
  };
  // v6.55: "+" despliega/oculta los filtros extra; muestra cuántos están activos.
  document.getElementById("histMas").onclick = () => {
    const more = document.getElementById("histMore"), btn = document.getElementById("histMas");
    if (!more || !btn) return;
    more.classList.toggle("show");
    btn.classList.toggle("on", more.classList.contains("show"));
  };
  ["histCod", "histQuien", "histRemito", "histCajMin"].forEach(function (id) {
    const el = document.getElementById(id);
    if (el) el.onkeydown = (e) => { if (e.key === "Enter") histBuscar(); };
  });
  document.getElementById("histDesde").onchange = () => histBuscar();
  document.getElementById("histHasta").onchange = () => histBuscar();
  opBody.querySelectorAll(".histChip").forEach(function (ch) {
    ch.onclick = function () {
      const p = ch.getAttribute("data-preset");
      const desde = document.getElementById("histDesde"), hasta = document.getElementById("histHasta");
      if (p === "hoy") { desde.value = opTodayStr(); hasta.value = opTodayStr(); }
      else if (p === "7") { desde.value = histShiftYmd(-6); hasta.value = opTodayStr(); }
      else if (p === "mes") { desde.value = histMonthStartYmd(); hasta.value = opTodayStr(); }
      else if (p === "todo") { desde.value = ""; hasta.value = ""; }
      histBuscar();
    };
  });
  histBuscar();   // primera carga: recepciones recientes
}
function histBuscar() {
  const v = function (id) { return ((document.getElementById(id) || {}).value || "").trim(); };
  // v6.55: los filtros extra del "+" se COMBINAN (AND) con el buscador principal.
  const f = { desde: v("histDesde"), hasta: v("histHasta"), cod: v("histCod"),
              quien: v("histQuien"), remito: v("histRemito"), cajasMin: parseInt(v("histCajMin"), 10) || 0 };
  const txt = document.getElementById("histMasTxt");
  if (txt) {
    const n = (f.quien ? 1 : 0) + (f.remito ? 1 : 0) + (f.cajasMin > 0 ? 1 : 0);
    txt.textContent = n ? ("filtros (" + n + ")") : "filtros";
  }
  histLoad(f);
}
async function histLoad(f) {
  const box = document.getElementById("histResults");
  if (box) box.innerHTML = '<div class="histLoading">Cargando…</div>';
  const myseq = ++_histReqSeq;
  await sessionReady;
  if (myseq !== _histReqSeq) return;   // ya hay una búsqueda más nueva en curso
  const CAP = 500, HARD = 1000;
  // v6.54: un solo buscador — matchea CÓDIGO o QUIÉN ENTREGÓ (tallerista/proveedor).
  // Se sanea el término (sin comas/paréntesis) porque va dentro de un filtro .or() de PostgREST.
  const codN = f.cod ? f.cod.toUpperCase().replace(/[,()]/g, " ").trim() : "";
  try {
    // v10.26: una sola query a vista_historial_entregas (antes 2 queries separadas).
    // v18.80 — la vista devuelve `fecha` SIEMPRE como YYYY-MM-DD (gv_fecha_recepcion_norm), así
    // que el `order` de acá y los `gte`/`lte` de Desde/Hasta —que son comparaciones de TEXTO—
    // ordenan y filtran de verdad. Antes, con los formatos mezclados, `01/07/26` caía después de
    // `2026-…` y encima el corte de 1000 filas se llevaba puestas las recientes de ese grupo.
    let q = supabase.from("vista_historial_entregas")
      .select("fuente,fecha,created_at,cod_art,descripcion,cajas,quien,remito,llegada,carga,demora_hs,recibido_por,recibido_at");
    // v22.53 (Luis): lo que sigue en Pendientes todavía no se recepcionó — no va al Histórico.
    q = q.eq("pendiente", false);
    if (f.desde) q = q.gte("fecha", f.desde);
    if (f.hasta) q = q.lte("fecha", f.hasta);
    if (codN) q = q.or("cod_art.ilike.%" + codN + "%,quien.ilike.%" + codN + "%");
    if (f.quien) q = q.ilike("quien", "%" + f.quien + "%");
    if (f.remito) q = q.ilike("remito", "%" + f.remito + "%");
    if (f.cajasMin > 0) q = q.gte("cajas", f.cajasMin);
    q = q.order("fecha", { ascending: false }).order("created_at", { ascending: false, nullsFirst: false }).limit(HARD);

    const res = await q;
    if (myseq !== _histReqSeq) return;
    if (res.error) throw res.error;

    const rows = ((res.data) || []).map(function (r) {
      return {
        ymd: histYmd(r.fecha), ms: r.created_at ? Date.parse(r.created_at) : 0,
        cod: r.cod_art || "—", desc: r.descripcion || "",
        cajas: Number(r.cajas) || 0, quien: r.fuente === "tallerista" ? displayName(r.quien || "—") : (r.quien || "—"),
        remito: r.remito || "", origen: r.fuente === "tallerista" ? "tall" : "prov",
        demoraHs: (r.demora_hs != null) ? Number(r.demora_hs) : null,
        llegada: r.llegada || null, carga: r.carga || null,
        recPor: r.recibido_por || "", recAt: r.recibido_at || null
      };
    });
    rows.sort(function (a, b) { if (a.ymd !== b.ymd) return a.ymd < b.ymd ? 1 : -1; return b.ms - a.ms; });
    histRender(rows, CAP, rows.length >= HARD);
  } catch (e) {
    if (myseq !== _histReqSeq) return;
    console.warn("histLoad error:", e);
    if (box) box.innerHTML = '<div class="histEmpty">No se pudo cargar el histórico. Probá de nuevo.</div>';
  }
}
/* Demora de carga del remito (hora carga operadora − hora llegada), en texto compacto.
   Viene de vista_historial_entregas.demora_hs. Solo existe para recepciones cargadas por
   el flujo de Pendientes (Control_Modo_OP); las viejas o sin match dan "—". */
function histFmtDemora(hs) {
  if (hs == null || isNaN(hs)) return "—";
  if (hs < 0) hs = 0;
  if (hs < 1) return Math.round(hs * 60) + "m";
  if (hs < 24) { const r = Math.round(hs * 10) / 10; return String(r).replace(".", ",") + "h"; }
  const d = Math.round(hs / 24 * 10) / 10; return String(d).replace(".", ",") + "d";
}
function histHoraTip(r) {
  if (!r.llegada || !r.carga) return "";
  try {
    const opt = { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", timeZone: "America/Argentina/Buenos_Aires" };
    return "Llegó " + new Date(r.llegada).toLocaleString("es-AR", opt) + " · Cargó " + new Date(r.carga).toLocaleString("es-AR", opt);
  } catch (_e) { return ""; }
}
/* v22.49 (Luis) — "Recibió": quién tocó «✓ Recibido» en Pendientes y cuándo. */
function histRecibioTxt(r) {
  if (!r.recPor) return "—";
  const ms = r.recAt ? Date.parse(r.recAt) : 0;
  return r.recPor + (ms ? " · " + pendFmtFecha(null, ms) + " " + pendFmtHora(ms) : "");
}
/* v22.57 (Luis): tocar el encabezado ordena por esa columna — 1er toque de mayor a menor
   (fecha / recibido: el más nuevo primero), 2º toque al revés. Los vacíos van siempre al final.
   Ordena lo que ya se trajo; la búsqueda nueva vuelve al orden por fecha. */
const HIST_COLS = [
  { k: "fecha",  t: "Fecha de comprobante", tip: "Fecha del remito / factura" },
  { k: "cod",    t: "Código" },
  { k: "cajas",  t: "Cajas", der: true },
  { k: "quien",  t: "Entregó" },
  { k: "demora", t: "Demora", der: true, tip: "Cuánto tardó en cargarse el remito: hora de carga de la operadora − hora de llegada del remito." },
  { k: "remito", t: "Remito" },
  { k: "recibio", t: "Recibió", tip: "Quién tocó «Recibido» en Pendientes, y cuándo" }
];
let _histSort = null, _histLast = null;
function histSortVal(r, k) {
  switch (k) {
    case "fecha": return r.ymd ? r.ymd + "|" + String(r.ms || 0).padStart(15, "0") : null;
    case "cod": return r.cod && r.cod !== "—" ? r.cod : null;
    case "cajas": return r.cajas;
    case "quien": return r.quien && r.quien !== "—" ? String(r.quien).toLowerCase() : null;
    case "demora": return r.demoraHs == null || isNaN(r.demoraHs) ? null : r.demoraHs;
    case "remito": return r.remito || null;
    case "recibio": return r.recAt ? Date.parse(r.recAt) : null;
  }
  return null;
}
function histOrdenar(rows, st) {
  if (!st) return rows;
  const col = new Intl.Collator("es", { numeric: true, sensitivity: "base" });
  return rows.slice().sort(function (a, b) {
    const va = histSortVal(a, st.k), vb = histSortVal(b, st.k);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    const c = (typeof va === "number" && typeof vb === "number") ? va - vb : col.compare(String(va), String(vb));
    return st.dir === "desc" ? -c : c;
  });
}
function histSortClick(k) {
  if (!_histLast) return;
  _histSort = (_histSort && _histSort.k === k && _histSort.dir === "desc") ? { k: k, dir: "asc" } : { k: k, dir: "desc" };
  histRender(_histLast.rows, _histLast.CAP, _histLast.capped, true);
}
function histRender(rows, CAP, capped, keepSort) {
  const box = document.getElementById("histResults");
  if (!box) return;
  if (!keepSort) _histSort = null;
  _histLast = { rows: rows, CAP: CAP, capped: capped };
  rows = histOrdenar(rows, _histSort);
  const n = rows.length;
  if (!n) { box.innerHTML = '<div class="histEmpty">No hay recepciones para ese filtro.</div>'; return; }
  const total = rows.reduce((s, r) => s + r.cajas, 0);
  const shown = rows.slice(0, CAP);
  // v18.80 — ¿lo que se está mostrando cruza de año? Entonces la columna lleva el año, en todas
  // las filas. Se mira sobre `shown`, que es lo que se ve (no sobre el total traído).
  const anios = {};
  shown.forEach(function (r) { if (r.ymd) anios[r.ymd.slice(0, 4)] = 1; });
  const conAnio = Object.keys(anios).length > 1;
  let html = '<div class="histSummary">' + n + ' recepci' + (n === 1 ? 'ón' : 'ones') + ' · <b>' + total + ' cajas</b></div>';
  if (capped) html += '<div class="histNote">⚠ Hay más de 1000 filas; se muestran las más recientes. Acotá por fecha para ver el resto.</div>';
  else if (n > CAP) html += '<div class="histNote">Mostrando las primeras ' + CAP + ' de ' + n + '. Acotá el filtro para ver menos.</div>';
  html += '<div class="histTblWrap"><table class="histTbl"><thead><tr>';
  HIST_COLS.forEach(function (c) {
    const on = _histSort && _histSort.k === c.k;
    html += '<th class="histSortTh' + (on ? ' on' : '') + '" data-k="' + c.k + '"' + (c.der ? ' style="text-align:right"' : '') +
      (c.tip ? ' title="' + escapeHtmlRcp(c.tip) + '"' : '') + '>' + escapeHtmlRcp(c.t) +
      '<span class="histSortIco">' + (on ? (_histSort.dir === "desc" ? " ▼" : " ▲") : " ↕") + '</span></th>';
  });
  html += '</tr></thead><tbody>';
  shown.forEach(function (r) {
    // v6.54: sin badge "Prov" ni la descripción del artículo — solo el nombre (pedido del dueño).
    const who = escapeHtmlRcp(r.quien);
    const demTxt = histFmtDemora(r.demoraHs);
    const demTip = histHoraTip(r);
    html += '<tr>' +
      '<td class="histFe">' + escapeHtmlRcp(histFechaTxt(r.ymd, conAnio)) + '</td>' +
      '<td class="histCodCell">' + escapeHtmlRcp(r.cod) + '</td>' +
      '<td class="histCaj">' + r.cajas + '</td>' +
      '<td class="histWho">' + who + '</td>' +
      '<td class="histDem"' + (demTip ? ' title="' + escapeHtmlRcp(demTip) + '"' : '') + '>' + escapeHtmlRcp(demTxt) + '</td>' +
      '<td class="histRto">' + escapeHtmlRcp(r.remito || "—") + '</td>' +
      '<td class="histRcb">' + escapeHtmlRcp(histRecibioTxt(r)) + '</td>' +
    '</tr>';
  });
  html += '</tbody></table></div>';
  box.innerHTML = html;
  box.querySelectorAll(".histSortTh").forEach(function (th) {
    th.onclick = function () { histSortClick(th.getAttribute("data-k")); };
  });
}
/* ===== HISTÓRICO de BAJADAS DE RACKS (v10.15) — todas las bajadas de rack a góndola
   (tabla Racks_Bajadas), SOLO LECTURA, filtrable por fecha y por código / descripción /
   sector / quién la hizo. Reusa el estilo del histórico de recepción (clases hist*). ===== */
let _hbReqSeq = 0;
function renderHistoricoBajadas() {
  opState.step = "histbaj";
  opPage.classList.remove("pendWide");
  opSetBack(true);
  opTitle.textContent = "Histórico de Bajadas de Racks";
  opSubtitle.textContent = "Bajadas de rack a góndola — filtrá por fecha y/o código, sector o quién";
  opActions.innerHTML = "";
  opBody.innerHTML =
    '<div class="histBar">' +
      '<div class="histField"><label for="hbDesde">Desde</label><input type="date" id="hbDesde" class="histDate"></div>' +
      '<div class="histField"><label for="hbHasta">Hasta</label><input type="date" id="hbHasta" class="histDate"></div>' +
      '<div class="histField"><label for="hbCod">Código, sector o quién</label><input type="text" id="hbCod" class="histCod" placeholder="ej. 590, A12 o Rafael" autocomplete="off"></div>' +
      '<div class="histBtns"><button class="histBtn pri" id="hbBuscar">Buscar</button><button class="histBtn" id="hbLimpiar">Limpiar</button></div>' +
    '</div>' +
    '<div class="histPresets">' +
      '<button class="histChip" data-preset="hoy">Hoy</button>' +
      '<button class="histChip" data-preset="7">7 días</button>' +
      '<button class="histChip" data-preset="mes">Este mes</button>' +
      '<button class="histChip" data-preset="todo">Todo</button>' +
    '</div>' +
    '<div id="hbResults"><div class="histLoading">Cargando…</div></div>';
  document.getElementById("hbBuscar").onclick = () => hbBuscar();
  document.getElementById("hbLimpiar").onclick = () => {
    ["hbDesde", "hbHasta", "hbCod"].forEach(function (id) { const el = document.getElementById(id); if (el) el.value = ""; });
    hbBuscar();
  };
  document.getElementById("hbCod").onkeydown = (e) => { if (e.key === "Enter") hbBuscar(); };
  document.getElementById("hbDesde").onchange = () => hbBuscar();
  document.getElementById("hbHasta").onchange = () => hbBuscar();
  opBody.querySelectorAll(".histChip").forEach(function (ch) {
    ch.onclick = function () {
      const p = ch.getAttribute("data-preset");
      const desde = document.getElementById("hbDesde"), hasta = document.getElementById("hbHasta");
      if (p === "hoy") { desde.value = opTodayStr(); hasta.value = opTodayStr(); }
      else if (p === "7") { desde.value = histShiftYmd(-6); hasta.value = opTodayStr(); }
      else if (p === "mes") { desde.value = histMonthStartYmd(); hasta.value = opTodayStr(); }
      else if (p === "todo") { desde.value = ""; hasta.value = ""; }
      hbBuscar();
    };
  });
  hbBuscar();
}
function hbBuscar() {
  const v = function (id) { return ((document.getElementById(id) || {}).value || "").trim(); };
  hbLoad({ desde: v("hbDesde"), hasta: v("hbHasta"), cod: v("hbCod") });
}
async function hbLoad(f) {
  const box = document.getElementById("hbResults");
  if (box) box.innerHTML = '<div class="histLoading">Cargando…</div>';
  const myseq = ++_hbReqSeq;
  await sessionReady;
  if (myseq !== _hbReqSeq) return;
  const HARD = 2000;
  const term = f.cod ? f.cod.toUpperCase().replace(/[,()]/g, " ").trim() : "";
  try {
    let q = supabase.from("Racks_Bajadas").select("id,ts,aprobada_at,cod_art,descripcion,cajas,sector,estado,creada_por");
    if (f.desde) q = q.gte("ts", f.desde);
    if (f.hasta) q = q.lte("ts", f.hasta + "T23:59:59.999-03:00");
    if (term) q = q.or("cod_art.ilike.%" + term + "%,descripcion.ilike.%" + term + "%,sector.ilike.%" + term + "%,creada_por.ilike.%" + term + "%");
    q = q.order("ts", { ascending: false }).limit(HARD);
    const r = await q;
    if (myseq !== _hbReqSeq) return;
    if (r && r.error) throw r.error;
    hbRender((r && r.data) || [], HARD);
  } catch (e) {
    if (myseq !== _hbReqSeq) return;
    console.warn("hbLoad error:", e);
    if (box) box.innerHTML = '<div class="histEmpty">No se pudo cargar el histórico de bajadas. Probá de nuevo.</div>';
  }
}
function hbRender(rows, HARD) {
  const box = document.getElementById("hbResults");
  if (!box) return;
  const n = rows.length;
  if (!n) { box.innerHTML = '<div class="histEmpty">No hay bajadas de racks para ese filtro.</div>'; return; }
  const total = rows.reduce(function (s, r) { return s + (Number(r.cajas) || 0); }, 0);
  let html = '<div class="histSummary">' + n + ' bajada' + (n === 1 ? '' : 's') + ' · <b>' + total + ' cajas</b></div>';
  if (n >= HARD) html += '<div class="histNote">⚠ Hay muchas filas; se muestran las más recientes. Acotá por fecha para ver el resto.</div>';
  html += '<div class="histTblWrap"><table class="histTbl"><thead><tr>' +
    '<th>Fecha</th><th>Código</th><th>Sector</th><th style="text-align:right">Cajas</th><th>Quién</th><th>Estado</th>' +
    '</tr></thead><tbody>';
  const fmt = function (ts) { if (!ts) return "—"; const d = new Date(ts); if (isNaN(d.getTime())) return "—"; const p = function (x) { return String(x).padStart(2, "0"); }; return p(d.getDate()) + "/" + p(d.getMonth() + 1) + " " + p(d.getHours()) + ":" + p(d.getMinutes()); };
  const estColor = { aprobada: "#15803d", propuesta: "#b45309", rechazada: "#b91c1c" };
  rows.forEach(function (r) {
    const est = String(r.estado || "—");
    const col = estColor[est] || "#64748b";
    html += '<tr>' +
      '<td class="histFe">' + escapeHtmlRcp(fmt(r.ts)) + '</td>' +
      '<td class="histCodCell">' + escapeHtmlRcp(r.cod_art || "—") + (r.descripcion ? '<br><small style="color:#94a3b8">' + escapeHtmlRcp(r.descripcion) + '</small>' : '') + '</td>' +
      '<td>' + escapeHtmlRcp(r.sector || "—") + '</td>' +
      '<td class="histCaj">' + (Number(r.cajas) || 0) + '</td>' +
      '<td class="histWho">' + escapeHtmlRcp(displayName(r.creada_por || "—")) + '</td>' +
      '<td style="font-weight:800;color:' + col + '">' + escapeHtmlRcp(est) + '</td>' +
    '</tr>';
  });
  html += '</tbody></table></div>';
  box.innerHTML = html;
}
/* v5.93 — Contador de remitos pendientes de cargar en el botón "Pendientes"
   (mismas filas que renderPendientes: Control_Modo_OP con estado='pendiente'). */
async function pendBadgePend(btn) {
  try {
    await sessionReady;
    const r = await supabase.from("Control_Modo_OP").select("id", { count: "exact", head: true }).eq("estado", "pendiente");
    const n = r.count || 0;
    if (n > 0 && btn) btn.textContent = "📋 Pendientes (" + n + ")";
  } catch (_e) {}
}
/* ===== RACKS → góndola (v4.08): Marianela aprueba acá lo que los operarios
   marcaron para bajar. Al aprobar se hace el movimiento entre depósitos
   (racks − / terminado +) en Movimientos_Stock y la bajada queda 'aprobada'
   (si era la última de la orden, la orden pasa a 'bajado' y se apaga la alarma). */
async function racksBadgePend(btn) {
  try {
    await sessionReady;
    const r = await supabase.from("Racks_Bajadas").select("id", { count: "exact", head: true }).eq("estado", "propuesta");
    const n = r.count || 0;
    if (n > 0 && btn) btn.textContent = "📦 Bajadas Racks → góndola (" + n + ")";
  } catch (_e) {}
}
async function renderBajadasRacks() {
  opState.step = "racks";
  opPage.classList.add("pendWide");
  opSetBack(true);
  opTitle.textContent = "Bajadas Racks → góndola";
  opSubtitle.textContent = "Lo que los operarios marcaron para bajar. Revisá y aprobá: recién ahí pasa de racks a góndola.";
  opActions.innerHTML = "";
  opBody.innerHTML = '<div class="opEmpty">Cargando…</div>';
  await sessionReady;
  let res, fres;
  try {
    res = await supabase.from("Racks_Bajadas").select("id,orden_id,cod_art,descripcion,cajas,estado,creada_por,ts,sector").eq("estado", "propuesta").order("ts", { ascending: true }).limit(500);
    fres = await supabase.from("Articulos Virgilio X Tallerista").select("Cod_Art,Cajas_x_Master,Uni_x_Caja").limit(20000);
  } catch (e) { res = { error: e }; }
  if (opState.step !== "racks") return;
  if (res.error) { opBody.innerHTML = '<div class="opEmpty" style="color:var(--danger)">No se pudo leer Racks_Bajadas.<br><small>' + (res.error.message || "") + '</small></div>'; return; }
  const rows = res.data || [];
  _racksFactors = {};
  ((fres && fres.data) || []).forEach(function (x) { const k = String(x.Cod_Art || "").toUpperCase(); if (k && !_racksFactors[k]) _racksFactors[k] = { cajasXMaster: Number(x.Cajas_x_Master) || 0, uniXCaja: Number(x.Uni_x_Caja) || 0 }; });
  if (!rows.length) {
    opBody.innerHTML = '<div class="opOk">✓ No hay bajadas pendientes de aprobar.</div>';
    // Mostrar histórico de aprobadas recientes (últimas 2h) para confirmar que se procesaron
    try {
      const twoHoursAgo = new Date(Date.now() - 2*60*60*1000).toISOString();
      const approved = await supabase.from("Racks_Bajadas").select("id,cod_art,cajas,aprobada_at,creada_por").eq("estado", "aprobada").gt("aprobada_at", twoHoursAgo).order("aprobada_at", { ascending: false }).limit(20);
      if (approved.data && approved.data.length) {
        const hist = document.createElement("div");
        hist.style.cssText = "margin-top:20px;padding-top:15px;border-top:1px solid #e2e8f0;";
        const title = document.createElement("div");
        title.style.cssText = "font-size:13px;color:#64748b;font-weight:700;margin-bottom:8px;";
        title.textContent = "Aprobadas en las últimas 2h:";
        hist.appendChild(title);
        const list = document.createElement("div");
        list.style.cssText = "font-size:12px;color:#475569;line-height:1.6;";
        approved.data.forEach(function (a) {
          const row = document.createElement("div");
          row.style.cssText = "padding:4px 0;";
          const at = a.aprobada_at ? new Date(a.aprobada_at).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hour12: false }) : "—";
          row.textContent = a.cod_art + " · " + a.cajas + " cajas · " + at;
          list.appendChild(row);
        });
        hist.appendChild(list);
        opBody.appendChild(hist);
      }
    } catch (_e) {}
    return;
  }
  opBody.innerHTML = "";
  const list = document.createElement("div"); list.className = "pendCards";
  rows.forEach(function (b) { list.appendChild(racksBajaCard(b)); });
  opBody.appendChild(list);
}
let _racksFactors = {};
function racksFmtUnits(cajas, cod) {
  const f = _racksFactors[String(cod).toUpperCase()] || {}, M = f.cajasXMaster > 0 ? f.cajasXMaster : 0, U = f.uniXCaja > 0 ? f.uniXCaja : 0, p = [];
  if (M) p.push((Math.round((cajas / M) * 100) / 100) + " master");
  if (U) p.push((cajas * U) + " u");
  return p.length ? p.join(" · ") : "";
}
/* Día y hora (Buenos Aires, 24h) de cuándo el operario marcó la bajada. */
function racksBajaFecha(ts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  } catch (_e) { return ""; }
}
function racksBajaCard(b) {
  const card = document.createElement("div"); card.className = "pendCard"; card.setAttribute("data-id", String(b.id));
  const head = document.createElement("div"); head.className = "pcHead";
  const name = document.createElement("span"); name.className = "pcName"; name.textContent = b.cod_art || "—";
  const tag = document.createElement("span"); tag.className = "pcTag"; tag.textContent = b.creada_por ? ("Leg " + b.creada_por) : "operario";
  head.appendChild(name); head.appendChild(tag);
  card.appendChild(head);
  const ent = document.createElement("div"); ent.className = "pcEntrega";
  const u = racksFmtUnits(Number(b.cajas), b.cod_art);
  ent.textContent = (b.descripcion || "") + "   ·   " + b.cajas + " cajas" + (u ? "  (" + u + ")" : "");
  card.appendChild(ent);
  // Sector del rack + día/hora en que el operario la marcó
  const metaParts = [];
  if (b.sector) metaParts.push("📍 Sector " + b.sector);
  const fch = racksBajaFecha(b.ts);
  if (fch) metaParts.push("🕒 " + fch);
  if (metaParts.length) {
    const meta = document.createElement("div");
    meta.style.cssText = "font-size:12.5px;color:#64748b;font-weight:600;margin-top:5px;";
    meta.textContent = metaParts.join("   ·   ");
    card.appendChild(meta);
  }
  const foot = document.createElement("div"); foot.className = "pcFoot";
  const ok = document.createElement("button"); ok.type = "button"; ok.className = "enviarBtn"; ok.textContent = "✓ Aprobar";
  ok.onclick = function () { racksAprobarBaja(b, foot); };
  foot.appendChild(ok);
  card.appendChild(foot);
  return card;
}
async function racksAprobarBaja(b, foot) {
  const btn = foot.querySelector("button");
  if (btn) { btn.disabled = true; btn.textContent = "Aprobando…"; }
  try {
    await sessionReady;
    const ref = "orden " + (b.orden_id || "");
    const mov = await supabase.from("Movimientos_Stock").insert([
      { cod_art: b.cod_art, descripcion: b.descripcion || null, deposito: "racks", delta: -Number(b.cajas), tipo: "baja_racks", ref: ref, legajo: "0" },
      { cod_art: b.cod_art, descripcion: b.descripcion || null, deposito: "terminado", delta: Number(b.cajas), tipo: "baja_racks", ref: ref, legajo: "0" }
    ]);
    if (mov.error) throw mov.error;
    const upd = await supabase.from("Racks_Bajadas").update({ estado: "aprobada", aprobada_at: new Date().toISOString() }).eq("id", b.id);
    if (upd.error) throw upd.error;
    // ¿Era la última propuesta de la orden? Entonces cerramos la orden (apaga la alarma).
    if (b.orden_id) {
      const rest = await supabase.from("Racks_Bajadas").select("id", { count: "exact", head: true }).eq("orden_id", b.orden_id).eq("estado", "propuesta");
      if ((rest.count || 0) === 0) {
        await supabase.from("Racks_Ordenes").update({ estado: "bajado", cerrada_at: new Date().toISOString() }).eq("id", b.orden_id);
      }
    }
    const card = foot.closest(".pendCard");
    if (card) { card.classList.add("sentRow"); foot.innerHTML = '<span class="pcLbl" style="color:var(--ok);font-weight:900">✓ Aprobado — pasó a góndola</span>'; }
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = "✓ Aprobar"; }
    alert("No se pudo aprobar: " + (e.message || e));
  }
}
let _pendRows = {};   // id -> estado vivo (espejo de lo persistido en Supabase). NADA en localStorage.
async function renderPendientes() {
  opState.step = "pend";
  opPage.classList.add("pendWide");   // PC: ancho completo → grilla de tarjetas (menos scroll)
  opSetBack(true);
  opTitle.textContent = "Pendientes";
  opSubtitle.textContent = "Recepciones cargadas. Tildá, adjuntá la foto y tocá Enviar.";
  opActions.innerHTML = "";
  opBody.innerHTML = '<div class="opEmpty">Cargando…</div>';
  await sessionReady;
  let res;
  try {
    res = await supabase.from("Control_Modo_OP")
      .select("id,fecha,tipo,nombre,linea,remito,detalle,cantidad_total,created_at,isis,control_partes,foto_url,foto_vista,codigo,gv_foto_post_por,gv_foto_post_at,gv_recibido_por,gv_recibido_at,gv_no_recibido_at")
      .eq("estado", "pendiente")
      .order("created_at", { ascending: true })
      .limit(300);
  } catch (e) { res = { error: e }; }
  if (opState.step !== "pend") return;
  if (res.error) {
    opBody.innerHTML = '<div class="opEmpty" style="color:var(--danger)">No se pudo leer Pendientes (¿permisos de Control_Modo_OP?).<br><small>' + (res.error.message || "") + '</small></div>';
    return;
  }
  const rows = res.data || [];
  if (!rows.length) { opBody.innerHTML = '<div class="opOk">✓ No hay recepciones pendientes.</div>'; return; }
  _pendRows = {};
  await pendReceptoresCargar();
  if (opState.step !== "pend") return;
  opBody.innerHTML = "";
  const list = document.createElement("div"); list.className = "pendCards";
  rows.forEach(function (r) { list.appendChild(pendCard(r)); });
  opBody.appendChild(list);
  if (_pendTimer) clearInterval(_pendTimer);
  _pendTimer = setInterval(pendTickElapsed, 30000);   // refresca "Demora" en vivo
  // Deep-link desde Planify: resaltar y scrollear al remito específico
  if (_deepLinkRemito) {
    const hl = _deepLinkRemito;
    _deepLinkRemito = null;
    setTimeout(function () {
      const card = Array.from(opBody.querySelectorAll(".pendCard")).find(function (c) {
        const rto = c.querySelector(".pcRto");
        return rto && rto.textContent.toUpperCase().includes(hl.toUpperCase());
      });
      if (card) {
        card.scrollIntoView({ behavior: "smooth", block: "center" });
        card.style.outline = "3px solid #2563eb";
        setTimeout(function () { card.style.outline = ""; }, 3000);
      }
    }, 200);
  }
}
function pendFmtFecha(fecha, tsMs) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(fecha || ""));
  if (m) return m[3] + "-" + m[2];
  if (tsMs) { const d = new Date(tsMs); return String(d.getDate()).padStart(2, "0") + "-" + String(d.getMonth() + 1).padStart(2, "0"); }
  return "";
}
function pendFmtHora(tsMs) {
  if (!tsMs) return "";
  try { return new Date(tsMs).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" }); }
  catch (_e) { const d = new Date(tsMs); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); }
}
function pendFmtDemora(tsMs) {
  let hh = Math.round((Date.now() - tsMs) / 1800000);   // medias horas
  if (hh < 0) hh = 0;
  const h = hh / 2;
  return (Number.isInteger(h) ? String(h) : (Math.floor(h) + ",5")) + "hs";
}
function pendTickElapsed() {
  if (opState.step !== "pend") { if (_pendTimer) { clearInterval(_pendTimer); _pendTimer = null; } return; }
  document.querySelectorAll("#rcpRoot .pendDemora").forEach(function (el) {
    const ts = parseInt(el.getAttribute("data-ts"), 10);
    if (ts) el.textContent = "⏱ " + pendFmtDemora(ts);
  });
}
function pendCard(r) {
  const id = r.id;
  _pendRows[id] = { isis: !!r.isis, partes: r.control_partes || null, foto_url: r.foto_url || null, foto_vista: !!r.foto_vista, codigo: r.codigo || null, recibido: r.gv_recibido_por || null, recibido_at: r.gv_recibido_at || null, no_recibido_at: r.gv_no_recibido_at || null, sent: false, row: r };
  const tsMs = r.created_at ? new Date(r.created_at).getTime() : 0;
  const card = document.createElement("div"); card.className = "pendCard"; card.setAttribute("data-id", String(id));
  const head = document.createElement("div"); head.className = "pcHead";
  const name = document.createElement("span"); name.className = "pcName"; name.textContent = r.nombre || "—";
  const tag = document.createElement("span"); tag.className = "pcTag"; tag.textContent = (r.tipo === "prov_at") ? "Prov. AT" : "Tallerista";
  const rto = document.createElement("span"); rto.className = "pcRto"; rto.textContent = r.remito ? ("RTO/FC " + r.remito) : "";
  head.appendChild(name); head.appendChild(tag); head.appendChild(rto);
  card.appendChild(head);
  const meta = document.createElement("div"); meta.className = "pcMeta";
  const mp = [pendFmtFecha(r.fecha, tsMs)]; if (tsMs) mp.push(pendFmtHora(tsMs)); if (r.linea) mp.push(r.linea);
  meta.textContent = mp.filter(Boolean).join(" · ");
  if (tsMs) {
    const dem = document.createElement("span"); dem.className = "pcDemora pendDemora"; dem.setAttribute("data-ts", String(tsMs));
    dem.textContent = "⏱ " + pendFmtDemora(tsMs);
    meta.appendChild(document.createTextNode(" · ")); meta.appendChild(dem);
  }
  card.appendChild(meta);
  const ent = document.createElement("div"); ent.className = "pcEntrega";
  ent.textContent = (r.detalle || "") + (r.cantidad_total != null ? "   ·   " + r.cantidad_total + " cajas" : "");
  card.appendChild(ent);
  const acts = document.createElement("div"); acts.className = "pcActs";
  acts.appendChild(pendRecibidoRow(id, card));   // v22.53: primero quién lo procesa
  acts.appendChild(pendCheckRow(id, "isis", "Carga ISIS"));
  acts.appendChild(pendPartesRow(id));
  /* v12.03 — se sacó el tilde "Faltantes x Día" (pedido del usuario): ese programa
     ya no se hace, así que no hay nada que tildar y no puede seguir bloqueando el
     botón Enviar. La columna Control_Modo_OP.faltantes queda en la base con lo ya
     cargado — no se toca ni se borra, solo dejó de usarse desde acá. */
  acts.appendChild(pendFotoRow(id));
  card.appendChild(acts);
  const foot = document.createElement("div"); foot.className = "pcFoot";
  /* v10.02 — el código lo genera opEnviar() AL CREAR la fila (v8.83), para que el operario
     lo vea y lo escriba en el remito físico. Por eso tener `codigo` NO significa "ya
     procesada": esta lista trae SOLO estado='pendiente'. Antes el `if (r.codigo)` tapaba
     el botón Enviar en toda fila nueva y nada podía salir de Pendientes. Ahora se muestra
     el código (para cotejar contra el remito) Y el botón al lado. */
  // v22.53 (Luis): el código de 4 dígitos ya no se usa — no se muestra.
  const b = document.createElement("button"); b.type = "button"; b.className = "enviarBtn"; b.textContent = "Enviar"; b.disabled = !pendRowComplete(id);
  b.onclick = function () { pendEnviar(id, foot); };
  foot.appendChild(b);
  card.appendChild(foot);
  return card;
}
/* v22.48/v22.52 (Luis, 25/09) — «Recibido»: un tilde igual al de Carga ISIS. Al tildarlo pide
   quién recibe y guarda QUIÉN y CUÁNDO (se ve en el Histórico). Es un paso más: Enviar lo
   exige y es el que cierra. Sin foto no se puede tildar: primero se agrega. */
function pendRecibidoRow(id, card) {
  const row = document.createElement("div"); row.className = "pcRow pcRecibidoRow";
  const b = document.createElement("button"); b.type = "button"; b.className = "tickBtn";
  const box = document.createElement("span"); box.className = "pcRecLblBox";
  const lbl = document.createElement("span"); lbl.className = "pcLbl"; lbl.textContent = "Recibido";
  const hint = document.createElement("span"); hint.className = "pcRecHint";
  /* v24.89 (Mel, 30/09) — «No recibido»: mismo criterio que «No corresponde» (excluyente con el
     tilde, se destilda tocándolo de nuevo) y al prenderlo abre el WhatsApp a Marian con el
     remito. NO habilita Enviar: la recepción se sigue cerrando sólo con Recibido. */
  const no = document.createElement("button"); no.type = "button"; no.className = "noBtn noRecBtn"; no.textContent = "No recibido";
  no.title = "Avisarle a Marian por WhatsApp que el remito no llegó";
  const sync = function () {
    const st = _pendRows[id], sinFoto = !st.foto_url;
    b.classList.toggle("on", !!st.recibido);
    b.disabled = (sinFoto && !st.recibido) || st.sent;
    no.classList.toggle("on", !!st.no_recibido_at);
    no.disabled = st.sent;
    no.style.display = st.recibido ? "none" : "";   // v24.93 (Mel): ya recibido, no se ofrece
    if (st.recibido) {
      const ms = st.recibido_at ? new Date(st.recibido_at).getTime() : 0;
      hint.textContent = st.recibido + (ms ? " · " + pendFmtFecha(null, ms) + " " + pendFmtHora(ms) : "");
    } else if (st.no_recibido_at) {
      const ms = new Date(st.no_recibido_at).getTime();
      hint.textContent = "avisado" + (ms ? " · " + pendFmtFecha(null, ms) + " " + pendFmtHora(ms) : "");   // corto: entra en una línea
    } else hint.textContent = sinFoto ? "falta la foto" : "";
  };
  b.onclick = async function () {
    const st = _pendRows[id];
    if (st.sent) return;
    if (st.recibido) {   // destildar: borra quién y cuándo
      b.disabled = true;
      try { await pendRecibido(id, card, null); } catch (e) { alert("No se pudo guardar: " + ((e && e.message) || e)); }
      sync(); return;
    }
    if (!st.foto_url) { sync(); return; }
    pendRecibidoAbrir(id, card);
  };
  no.onclick = async function () {
    const st = _pendRows[id];
    if (st.sent) return;
    const prender = !st.no_recibido_at;
    /* El WhatsApp se abre ANTES del await: después de esperar a la base el navegador ya no lo
       toma como un toque y bloquea la ventana. Si igual la bloquea, se navega al final. */
    let w = null, url = "";
    if (prender) {
      url = "https://wa.me/" + WA_MARIAN + "?text=" + encodeURIComponent(pendNoRecibidoMsg(st.row));
      try { w = window.open(url, "_blank"); } catch (_e) { w = null; }
    }
    b.disabled = no.disabled = true;
    const ahora = new Date().toISOString();
    const patch = prender ? { gv_no_recibido_at: ahora, gv_recibido_por: null, gv_recibido_at: null } : { gv_no_recibido_at: null };
    try {
      await pendPersist(id, patch);
      st.no_recibido_at = prender ? ahora : null;
      if (prender) { st.recibido = null; st.recibido_at = null; }
    } catch (e) { alert("No se pudo guardar: " + ((e && e.message) || e)); }
    sync(); pendRefreshEnviar(id);
    if (prender && !w) { try { location.href = url; } catch (_e2) {} }
  };
  row._pendSync = sync;
  box.appendChild(lbl); box.appendChild(hint);
  row.appendChild(b); row.appendChild(box); row.appendChild(no);
  sync();
  return row;
}
/* v24.89 — el mensaje a Marian: día y hora en que se cargó la recepción (cuando llegó), el
   número de remito y quién lo trajo. */
function pendNoRecibidoMsg(r) {
  r = r || {};
  const ms = r.created_at ? new Date(r.created_at).getTime() : 0;
  let dia = "", hora = "";
  if (ms) {
    try {
      // en-GB y no es-AR: es-AR da "23/9" (sin el cero del mes) en Chrome.
      dia = new Date(ms).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });
      hora = new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Argentina/Buenos_Aires" });
    } catch (_e) {
      const d = new Date(ms);
      dia = String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0");
      hora = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    }
  } else {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(r.fecha || ""));
    if (m) dia = m[3] + "/" + m[2];
  }
  return "Hola Marian, no recibí el remito " + (r.remito ? r.remito + " " : "") +
    "que te llegó el día " + (dia || "?") + (hora ? " a las " + hora : "") +
    " de " + (r.nombre || "?") + ", confirmame porfa que lo tenés o si ya lo mandaste";
}
/* Quién recibe: igual que Cuarentena — chips fijos + «Otro…» con texto. OBLIGATORIO y sin
   preselección (un valor puesto de fábrica se confirma sin leerlo). */
const PEND_RECIBE_PERSONAS = ["Nora", "Pablo"];
/* v22.58 (Luis): "pablo" → "Pablo", "juan  cruz" → "Juan Cruz". Igual que gv_nombre_capitalizar
   (trigger en la base): así "pablo" no crea un nombre nuevo, es el Pablo que ya existe. */
function pendNombreCap(s) {
  return String(s || "").trim().replace(/\s+/g, " ").toLowerCase()
    .replace(/(^|[^a-záéíóúüñ])([a-záéíóúüñ])/g, function (m, a, b) { return a + b.toUpperCase(); });
}
/* v22.53 (Luis): el nombre que se escribe en «Otro…» queda como opción (GV_Recepcion_Receptores). */
let _pendReceptores = null;
async function pendReceptoresCargar() {
  try {
    await sessionReady;
    const r = await supabase.from("GV_Recepcion_Receptores").select("nombre").order("created_at", { ascending: true }).limit(200);
    if (!r.error && r.data) _pendReceptores = r.data.map(function (x) { return String(x.nombre || "").trim(); }).filter(Boolean);
  } catch (_e) {}
  return _pendReceptores || [];
}
function pendReceptoresLista() {
  const out = PEND_RECIBE_PERSONAS.slice(), vis = {};
  out.forEach(function (n) { vis[n.toLowerCase()] = 1; });
  (_pendReceptores || []).forEach(function (n) { if (!vis[n.toLowerCase()]) { vis[n.toLowerCase()] = 1; out.push(n); } });
  return out;
}
async function pendReceptorGuardar(nombre) {
  const n = String(nombre || "").trim(); if (!n) return;
  if (pendReceptoresLista().some(function (x) { return x.toLowerCase() === n.toLowerCase(); })) return;
  try {
    await sessionReady;
    const r = await supabase.from("GV_Recepcion_Receptores").insert({ nombre: n });
    if (!r || !r.error) (_pendReceptores = _pendReceptores || []).push(n);
  } catch (_e) {}
}
function pendRecibidoAbrir(id, card) {
  const st = _pendRows[id]; if (!st || st.sent) return;
  const r = st.row || {};
  pendQuienModal({ pregunta: "¿Quién recibe?", sub: (r.nombre || "") + (r.remito ? " · RTO/FC " + r.remito : ""),
    faltaQuien: "Decinos quién recibe (Nora, Pablo u Otro).",
    onOk: function (quien) { return pendRecibido(id, card, quien); } });
}
/* v22.49 — el cuadro de "¿quién?" es uno solo para «Recibido» y para la foto a posteriori.
   Con conFoto:true además exige elegir una imagen antes de habilitar Confirmar. */
function pendQuienModal(o) {
  const root = document.getElementById("rcpRoot") || document.body;
  const ov = document.createElement("div"); ov.className = "rcbOverlay";
  const box = document.createElement("div"); box.className = "rcbBox";
  box.innerHTML = (o.titulo ? '<div class="rcbT">' + escapeHtmlRcp(o.titulo) + '</div>' : '') +
    (o.conFoto ? '<input type="file" accept="image/*" class="rcbFile">' : '') +
    '<div class="rcbT"' + (o.titulo ? ' style="margin-top:12px;font-size:15px"' : '') + '>' + escapeHtmlRcp(o.pregunta) + ' <span style="color:#b42318">*</span></div>' +
    '<div class="rcbSub">' + escapeHtmlRcp(o.sub || "") + '</div>' +
    '<div class="rcbOps"></div><input class="rcbOtro" placeholder="¿Quién? (nombre)" style="display:none">' +
    '<div class="rcbErr"></div>' +
    '<div class="rcbBtns"><button type="button" class="btnCancel">Cancelar</button><button type="button" class="btnSend" disabled>Confirmar</button></div>';
  ov.appendChild(box); root.appendChild(ov);
  const ops = box.querySelector(".rcbOps"), otro = box.querySelector(".rcbOtro"),
        err = box.querySelector(".rcbErr"), ok = box.querySelector(".btnSend"),
        fin = box.querySelector(".rcbFile");
  let sel = "";
  const valor = function () { return sel === "__otro" ? pendNombreCap(otro.value) : sel; };
  const archivo = function () { return fin && fin.files && fin.files[0] ? fin.files[0] : null; };
  const refresh = function () {
    ops.querySelectorAll(".rcbOp").forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-v") === sel); });
    otro.style.display = sel === "__otro" ? "" : "none";
    ok.disabled = !valor() || (!!o.conFoto && !archivo());
  };
  pendReceptoresLista().concat(["__otro"]).forEach(function (n) {
    const b = document.createElement("button"); b.type = "button"; b.className = "rcbOp";
    b.setAttribute("data-v", n); b.textContent = n === "__otro" ? "Otro…" : n;
    b.onclick = function () { sel = (sel === n ? "" : n); err.textContent = ""; refresh(); if (sel === "__otro") otro.focus(); };
    ops.appendChild(b);
  });
  otro.oninput = refresh;
  if (fin) fin.onchange = refresh;
  const cerrar = function () { if (ov.parentNode) ov.parentNode.removeChild(ov); };
  box.querySelector(".btnCancel").onclick = cerrar;
  ok.onclick = async function () {
    const quien = valor();
    if (!quien) { err.textContent = o.faltaQuien || "Decinos quién (Nora, Pablo u Otro)."; return; }
    if (o.conFoto && !archivo()) { err.textContent = "Elegí la foto."; return; }
    ok.disabled = true; ok.textContent = "Guardando…";
    try {
      await o.onOk(quien, archivo());
      if (sel === "__otro") pendReceptorGuardar(quien);   // best-effort: no frena nada
      cerrar();
    } catch (e) {
      ok.disabled = false; ok.textContent = "Confirmar";
      err.textContent = "No se pudo guardar: " + ((e && e.message) || e);
    }
  };
  refresh();
}
/* v22.52 (Luis): Recibido es UN PASO MÁS del checklist, no cierra. Guarda quién y cuándo;
   la recepción se cierra con Enviar como siempre (y Enviar lo exige). Destildar lo borra. */
async function pendRecibido(id, card, quien) {
  const st = _pendRows[id]; if (!st || st.sent) return;
  const ahora = new Date().toISOString();
  const patch = { gv_recibido_por: quien || null, gv_recibido_at: quien ? ahora : null };
  if (quien) patch.gv_no_recibido_at = null;   // v24.89: excluyente con «No recibido»
  await pendPersist(id, patch);
  st.recibido = quien || null; st.recibido_at = quien ? ahora : null;
  if (quien) st.no_recibido_at = null;
  const rr = card && card.querySelector(".pcRecibidoRow"); if (rr && rr._pendSync) rr._pendSync();
  pendRefreshEnviar(id);
}
/* Cada cambio se PERSISTE en Supabase al toque (UPDATE de la fila; no duplica, nada
   en localStorage). Al recargar, la tarjeta vuelve con lo ya guardado. */
async function pendPersist(id, patch) {
  await sessionReady;
  const r = await supabase.from("Control_Modo_OP").update(patch).eq("id", id);
  if (r.error) throw r.error;
}
function pendCheckRow(id, field, label) {
  const row = document.createElement("div"); row.className = "pcRow";
  const b = document.createElement("button"); b.type = "button"; b.className = "tickBtn" + (_pendRows[id][field] ? " on" : "");
  b.onclick = async function () {
    if (_pendRows[id].sent) return;
    const nv = !_pendRows[id][field]; b.disabled = true;
    try { await pendPersist(id, { [field]: nv }); _pendRows[id][field] = nv; b.classList.toggle("on", nv); }
    catch (e) { alert("No se pudo guardar: " + (e.message || e)); }
    b.disabled = false; pendRefreshEnviar(id);
  };
  const lbl = document.createElement("span"); lbl.className = "pcLbl"; lbl.textContent = label;
  row.appendChild(b); row.appendChild(lbl); return row;
}
function pendPartesRow(id) {
  const row = document.createElement("div"); row.className = "pcRow";
  const tick = document.createElement("button"); tick.type = "button"; tick.className = "tickBtn";
  const lbl = document.createElement("span"); lbl.className = "pcLbl"; lbl.textContent = "Control Partes Talleristas";
  const no = document.createElement("button"); no.type = "button"; no.className = "noBtn"; no.textContent = "No corresponde";
  function sync() { const v = _pendRows[id].partes; tick.classList.toggle("on", v === "corresponde"); no.classList.toggle("on", v === "no"); }
  async function setVal(v) {
    if (_pendRows[id].sent) return;
    const nv = (_pendRows[id].partes === v) ? null : v; tick.disabled = no.disabled = true;
    try { await pendPersist(id, { control_partes: nv }); _pendRows[id].partes = nv; sync(); }
    catch (e) { alert("No se pudo guardar: " + (e.message || e)); }
    tick.disabled = no.disabled = false; pendRefreshEnviar(id);
  }
  tick.onclick = function () { setVal("corresponde"); };
  no.onclick = function () { setVal("no"); };
  sync(); row.appendChild(tick); row.appendChild(lbl); row.appendChild(no); return row;
}
function pendFotoRow(id) {
  const row = document.createElement("div"); row.className = "pcRow pcFotoRow";
  const lbl = document.createElement("span"); lbl.className = "pcLbl"; lbl.textContent = "Foto Mercadería";
  const fotoUrl = _pendRows[id].foto_url;
  if (!fotoUrl) {
    /* v22.51 (Luis): sin foto NO se acepta — ni Enviar ni Recibido. Antes se auto-tildaba
       (filas viejas, anteriores a la foto obligatoria); hoy la única así es Poly 38845. */
    _pendRows[id].foto_vista = false;
    /* v22.49 (Luis, 25/09) — "Sin foto" se toca para agregarla a posteriori: pide la imagen y
       quién la agrega, y queda registrado quién y cuándo (gv_foto_post_por / _at). */
    const noF = document.createElement("button"); noF.type = "button"; noF.className = "fotoViewBtn noFoto addFoto";
    noF.textContent = "Sin foto · ＋ agregar"; noF.title = "Agregar la foto a posteriori";
    noF.onclick = function () {
      const r = _pendRows[id].row || {};
      pendQuienModal({ titulo: "Agregar foto a posteriori", pregunta: "¿Quién la agrega?", conFoto: true,
        sub: (r.nombre || "") + (r.remito ? " · RTO/FC " + r.remito : ""),
        onOk: function (quien, file) { return pendFotoPosteriori(id, row, quien, file); } });
    };
    row.appendChild(lbl); row.appendChild(noF); return row;
  }
  const btn = document.createElement("button"); btn.type = "button";
  btn.className = "fotoViewBtn" + (_pendRows[id].foto_vista ? " viewed" : "");
  btn.textContent = _pendRows[id].foto_vista ? "✓ Foto vista" : "👁 Ver foto";
  btn.onclick = function () {
    /* v14.56 — la foto SIEMPRE se puede volver a ver, aunque ya se haya enviado
       todo (antes `if (_pendRows[id].sent) return;` mataba el botón). Ver la foto
       no cambia nada persistido; solo marca foto_vista la primera vez. */
    const ov = document.createElement("div"); ov.className = "fotoOverlay";
    const box = document.createElement("div"); box.className = "fotoOverlayBox";
    const imgWrap = document.createElement("div"); imgWrap.className = "fotoOverlayImg";
    const img = document.createElement("img"); img.src = fotoUrl; img.alt = "Foto mercadería";
    imgWrap.appendChild(img);
    const cl = document.createElement("button"); cl.className = "fotoOverlayClose"; cl.textContent = "✕";
    cl.onclick = async function () {
      ov.remove();
      document.removeEventListener("keydown", esc);
      if (!_pendRows[id].foto_vista) {
        _pendRows[id].foto_vista = true;
        btn.classList.add("viewed"); btn.textContent = "✓ Foto vista";
        try { await pendPersist(id, { foto_vista: true }); } catch(_e){}
        pendRefreshEnviar(id);
      }
    };
    function esc(e) { if (e.key === "Escape") cl.click(); }
    document.addEventListener("keydown", esc);
    ov.onclick = function (e) { if (e.target === ov || e.target === box) cl.click(); };
    box.appendChild(imgWrap);
    box.appendChild(pendFotoInfoPanel(_pendRows[id].row));
    ov.appendChild(box); ov.appendChild(cl);
    document.getElementById("rcpRoot").appendChild(ov);
  };
  row.appendChild(lbl); row.appendChild(btn);
  const post = pendFotoPostTxt(_pendRows[id].row);
  if (post) { const n = document.createElement("div"); n.className = "pcFotoPost"; n.textContent = post; row.appendChild(n); }
  return row;
}
function pendFotoPostTxt(r) {
  if (!r || !r.gv_foto_post_por) return "";
  const ms = r.gv_foto_post_at ? new Date(r.gv_foto_post_at).getTime() : 0;
  return "📎 Agregada después por " + r.gv_foto_post_por + (ms ? " · " + pendFmtFecha(null, ms) + " " + pendFmtHora(ms) : "");
}
async function pendFotoPosteriori(id, rowEl, quien, file) {
  const url = await pendUploadFoto(id, file);
  if (!url) throw new Error("no se obtuvo la URL de la foto");
  const ahora = new Date().toISOString();
  await pendPersist(id, { foto_url: url, foto_vista: true, gv_foto_post_por: quien, gv_foto_post_at: ahora });
  const st = _pendRows[id];
  st.foto_url = url; st.foto_vista = true;
  st.row = Object.assign({}, st.row || {}, { foto_url: url, foto_vista: true, gv_foto_post_por: quien, gv_foto_post_at: ahora });
  if (rowEl && rowEl.parentNode) {
    const card = rowEl.closest(".pendCard");
    rowEl.parentNode.replaceChild(pendFotoRow(id), rowEl);
    const rr = card && card.querySelector(".pcRecibidoRow"); if (rr && rr._pendSync) rr._pendSync();
  }
  pendRefreshEnviar(id);
}
/* v12.07 — Panel que acompaña a la foto en el visor: quién entregó, qué remito y,
   sobre todo, CÓDIGO → CAJAS tal cual lo cargó el operario. El detalle ya viene en
   la fila (`Control_Modo_OP.detalle`, formato "COD → N · COD → N"); acá solo se
   parsea para mostrarlo en columnas. Si algún día el formato cambia, se muestra el
   texto crudo en vez de romper. */
function pendFotoParseDetalle(det) {
  const txt = String(det || "").trim();
  if (!txt) return [];
  const items = [];
  txt.split(/\s*·\s*/).forEach(function (part) {
    const p = part.trim(); if (!p) return;
    const m = /^(.*?)\s*(?:→|->)\s*(.+)$/.exec(p);
    if (m) items.push({ cod: m[1].trim(), cajas: m[2].trim() });
    else items.push({ cod: p, cajas: "" });
  });
  return items;
}
function pendFotoInfoPanel(r) {
  const box = document.createElement("div"); box.className = "fotoOverlayInfo";
  r = r || {};
  const tsMs = r.created_at ? new Date(r.created_at).getTime() : 0;
  const nm = document.createElement("div"); nm.className = "fovName";
  nm.textContent = (typeof displayName === "function" ? displayName(r.nombre || "") : (r.nombre || "")) || "—";
  box.appendChild(nm);
  const mp = [(r.tipo === "prov_at") ? "Prov. AT" : "Tallerista", pendFmtFecha(r.fecha, tsMs)];
  if (tsMs) mp.push(pendFmtHora(tsMs));
  if (r.linea) mp.push(r.linea);
  const mt = document.createElement("div"); mt.className = "fovMeta"; mt.textContent = mp.filter(Boolean).join(" · ");
  box.appendChild(mt);
  if (r.remito) { const rt = document.createElement("div"); rt.className = "fovRto"; rt.textContent = "RTO/FC " + r.remito; box.appendChild(rt); }
  const post = pendFotoPostTxt(r);
  if (post) { const pp = document.createElement("div"); pp.className = "fovMeta"; pp.textContent = post; box.appendChild(pp); }
  const tit = document.createElement("div"); tit.className = "fovTit"; tit.textContent = "Cargado por el operario";
  box.appendChild(tit);
  const items = pendFotoParseDetalle(r.detalle);
  if (!items.length) {
    const raw = document.createElement("div"); raw.className = "fovRaw"; raw.textContent = r.detalle || "—";
    box.appendChild(raw);
  } else {
    items.forEach(function (it) {
      const rowEl = document.createElement("div"); rowEl.className = "fovItem";
      const c = document.createElement("span"); c.className = "fovCod"; c.textContent = it.cod;
      const q = document.createElement("span"); q.className = "fovCaj"; q.textContent = it.cajas ? (it.cajas + " cj") : "";
      rowEl.appendChild(c); rowEl.appendChild(q); box.appendChild(rowEl);
    });
  }
  if (r.cantidad_total != null) {
    const tot = document.createElement("div"); tot.className = "fovTotal";
    const l = document.createElement("span"); l.textContent = "Total";
    const v = document.createElement("span"); v.textContent = r.cantidad_total + " cajas";
    tot.appendChild(l); tot.appendChild(v); box.appendChild(tot);
  }
  return box;
}
async function pendUploadFoto(id, file) {
  await sessionReady;
  const ext = (file.name && file.name.indexOf(".") >= 0) ? file.name.split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "") : "jpg";
  const path = id + "_" + Date.now() + "." + (ext || "jpg");
  // v23.38 — SIN upsert (seguridad). El nombre ya es único (id + hora en ms), así que
  // pisar nunca hizo falta, y el upsert es lo único que obligaba a dejarle a la clave
  // pública las reglas de LISTAR y PISAR fotos del bucket. Sin él, sólo hace falta
  // subir (insert). Si un reintento choca con "ya existe", es que un intento anterior
  // llegó aunque la respuesta se perdiera: la foto está, se sigue.
  const opts = { upsert: false, contentType: file.type || "image/jpeg" };
  const yaEsta = (r) => !!(r && r.error && (String(r.error.statusCode) === "409" ||
    /already exists|duplicate/i.test(String(r.error.message || ""))));
  let up = await supabase.storage.from("remitos").upload(path, file, opts);
  if (up && up.error && !yaEsta(up)) {
    // v6.72 — Fallback anti "row-level security policy": el login anónimo puede vencer
    // o caerse (pasó el 31/07: 0 usuarios anónimos nuevos) y el cliente manda una
    // sesión rota. La RLS del bucket `remitos` (y de Control_Modo_OP) permite rol
    // `anon`, así que renovamos la sesión anónima y, si tampoco, la limpiamos y subimos
    // con la publishable key (rol anon). Así la foto entra igual sin depender del login.
    try { await supabase.auth.signInAnonymously(); } catch (_e) {}
    up = await supabase.storage.from("remitos").upload(path, file, opts);
    if (up && up.error && !yaEsta(up)) {
      try { await supabase.auth.signOut(); } catch (_e) {}
      up = await supabase.storage.from("remitos").upload(path, file, opts);
    }
  }
  if (up.error && !yaEsta(up)) throw up.error;
  const pub = supabase.storage.from("remitos").getPublicUrl(path);
  return (pub && pub.data) ? pub.data.publicUrl : null;
}
function pendRowComplete(id) { const s = _pendRows[id]; return !!(s && s.isis && s.partes && s.foto_vista && s.recibido); }
function pendRefreshEnviar(id) {
  const card = document.querySelector('#rcpRoot .pendCard[data-id="' + id + '"]');
  if (!card) return; const b = card.querySelector(".enviarBtn");
  if (b && !_pendRows[id].sent) b.disabled = !pendRowComplete(id);
}
async function pendEnviar(id, foot) {
  if (!pendRowComplete(id) || _pendRows[id].sent) return;
  const b = foot.querySelector(".enviarBtn"); if (b) { b.disabled = true; b.textContent = "Enviando…"; }
  try {
    /* v10.02 — REUSAR el código que la fila ya trae (el que el operario escribió en el remito
       físico al cargarla). Generar uno nuevo acá dejaba dos códigos distintos para la misma
       recepción. Solo se genera si la fila es vieja (anterior a v8.83) y no tiene. */
    const codigo = _pendRows[id].codigo || await pendGenCodigo();
    await pendPersist(id, { estado: "procesado", procesado_at: new Date().toISOString(), codigo: codigo });
    _pendRows[id].sent = true; _pendRows[id].codigo = codigo;
    foot.innerHTML = '<span class="pcLbl" style="color:var(--ok);font-weight:900">✓ Enviado — pasó al Histórico</span>';
    const card = foot.parentNode; if (card) card.classList.add("sentRow");
  } catch (e) {
    if (b) { b.disabled = false; b.textContent = "Enviar"; }
    alert("No se pudo enviar: " + (e.message || e));
  }
}
async function pendGenCodigo() {
  await sessionReady;
  const usados = new Set();
  try {
    const since = new Date(); since.setHours(0, 0, 0, 0);
    const r = await supabase.from("Control_Modo_OP").select("codigo").gte("created_at", since.toISOString()).not("codigo", "is", null);
    if (r.data) r.data.forEach(function (x) { if (x.codigo) usados.add(String(x.codigo)); });
  } catch (_e) {}
  let c, tries = 0;
  do { c = String(Math.floor(1000 + Math.random() * 9000)); tries++; } while (usados.has(c) && tries < 200);
  return c;
}

/* ============== API pública para Producción ============== */
window.openRecepcionOp = function (legajo, dayKey) {
  RECP.legajo = String(legajo || "").trim() || null;
  RECP.dayKey = dayKey || opTodayStr();
  openOp();
};
/* Menú de Recepción (supervisor "Carga Recepción Mercadería"): Carga / Pendientes, LOCALES. */
window.openRecepcionMenu = function () {
  RECP.legajo = null;
  RECP.dayKey = opTodayStr();
  opPage.classList.add("open");
  renderMenu();
};

/* Deep-link desde Planify: abre el módulo directo en Pendientes y resalta el remito. */
window.recepcionAbrirPendientes = async function (remito) {
  _deepLinkRemito = remito || null;
  RECP.legajo = null;
  RECP.dayKey = opTodayStr();
  opPage.classList.add("open");
  await renderPendientes();
};

/* ── v22.42: cola persistente de imputación a OC (gv_oc_aplicar_recepcion) ───────────────
   supabase.rpc NO rechaza con un 500: resuelve con {error}. Cada envío queda en la cola hasta
   que vuelve sin error; los reintentos se espacian (5 s → 15 s → 30 s → 1 min → tope 2 min).
   Recalcular dos veces no duplica nada: gv_oc_recompute_recibido recalcula desde cero. */
var RCP_OC_KEY = "rcp_oc_pend_v1";
var _rcpOcTimer = null, _rcpOcCorriendo = false;
function rcpOcLeer() {
  try { var a = JSON.parse(localStorage.getItem(RCP_OC_KEY) || "[]"); return Array.isArray(a) ? a : []; }
  catch (_e) { return []; }
}
function rcpOcGuardar(a) { try { localStorage.setItem(RCP_OC_KEY, JSON.stringify(a)); } catch (_e) {} }
function rcpOcEncolar(nombre, items) {
  if (!nombre || !items || !items.length) return;
  var a = rcpOcLeer();
  a.push({ id: Date.now() + "_" + Math.random().toString(36).slice(2, 8), nombre: nombre, items: items, intentos: 0, ts: Date.now() });
  rcpOcGuardar(a);
  rcpOcDrain();
}
function rcpOcProgramar(intentos) {
  var pasos = [5000, 15000, 30000, 60000, 120000];
  var ms = pasos[Math.min(intentos, pasos.length - 1)];
  if (_rcpOcTimer) clearTimeout(_rcpOcTimer);
  _rcpOcTimer = setTimeout(function () { _rcpOcTimer = null; rcpOcDrain(); }, ms);
}
async function rcpOcDrain() {
  if (_rcpOcCorriendo) return;
  var cola = rcpOcLeer();
  if (!cola.length) return;
  if (typeof supabase === "undefined" || !supabase || typeof supabase.rpc !== "function") { rcpOcProgramar(0); return; }
  _rcpOcCorriendo = true;
  var maxIntentos = 0;
  try {
    for (var k = 0; k < cola.length; k++) {
      var e = cola[k], ok = false;
      try {
        var r = await supabase.rpc("gv_oc_aplicar_recepcion", { nombre_ent: e.nombre, items: e.items });
        ok = !!r && !r.error;
      } catch (_e) { ok = false; }
      var a = rcpOcLeer();   // releer: pudo entrar otra recepción mientras tanto
      if (ok) a = a.filter(function (x) { return x.id !== e.id; });
      else a.forEach(function (x) { if (x.id === e.id) { x.intentos = (x.intentos || 0) + 1; maxIntentos = Math.max(maxIntentos, x.intentos); } });
      rcpOcGuardar(a);
      if (!ok) break;   // la base está mal: no seguir martillando, esperar el próximo turno
    }
  } finally { _rcpOcCorriendo = false; }
  if (rcpOcLeer().length) rcpOcProgramar(maxIntentos);
}
try {
  if (typeof window !== "undefined") {
    window.addEventListener("online", function () { rcpOcDrain(); });
    setTimeout(function () { rcpOcDrain(); }, 3000);
  }
} catch (_e) {}
