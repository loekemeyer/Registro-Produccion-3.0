"use strict";

/* ============================================================
   app.js — Registro Producción 3.0 · Cervantes · botonera de GP2 (v3.1.15)
   ESTE ARCHIVO ES LA FUENTE de la botonera de Cervantes desde el 08/10/2026 [Elías: «se va a dejar de modificar en GP2 y
   modificar en este, y GP2 sólo hacer copia y hacer modificaciones para testear»]: los cambios se hacen ACÁ, a mano.
   Nació de la tablet de GP2 (Produccion/RegistroApp/operarios_gp2.js de loekemeyer/Gestion-Productiva-2.0, commit e110890,
   v1.251.1) con tools/portar_botonera_gp2.py, que se retiró (está en el historial de git).
   Lo que cambia respecto de la tablet:
     · se entra con el CÓDIGO DE LA TV (4 números), no con Google. La base devuelve un PASE firmado, atado a este
       equipo, que vale hasta las 17:45 (o 3 h si se entra más tarde);
     · todo va por funciones del schema reg_prod_3_0 (cabecera Content-Profile) que exigen ese pase:
         reg_prod_3_0_bundle · reg_prod_3_0_registrar_evento · reg_prod_3_0_anular_evento · reg_prod_3_0_rollo_tomar · reg_prod_3_0_rollo_cerrar
       La base guarda la CRUDA tal cual vino y arma la PROCESADA en la misma transacción;
     · sin internet se carga igual: los toques quedan en la cola del celular y se envían, con su hora original, cuando hay
       pase e internet. El catálogo (empleados, matrices, envasado, rollos) se guarda en el celular para poder abrir sin señal;
     · STOCK Y ROLLOS (Fase 1c): los mueve la base, en la misma transacción que el toque (reg_prod_3_0_registrar_evento →
       GP2.fabricar_stock) y con reg_prod_3_0_rollo_tomar / _rollo_cerrar, siempre con el pase. Mientras la base no lo tenga, el
       catálogo no trae `rollos_activos` y el selector de rollo, «¿quedó resto?» y el botón CT del alimentador quedan apagados.
     · ANULAR (el 🗑 del historial) devuelve el stock que había movido ese toque (Fase 1d, lo hace la base). Los rollos llevan un
       id anti-duplicado: un reintento no descuenta otro rollo ni cierra el siguiente (como los toques, que ya lo tenían).
   QUÉ BOTONES VE CADA UNO, como Registro Producción 2.0 (v3.1.9, Elías 08/10: «pensé que ya se había integrado completo, y no sólo
   para Eduardo»): capsDe() + botonVisible() con los permisos de public."Empleados" que trae el catálogo (es_matriceria, es_piedra,
   es_alimentador, ve_cm, ve_trm, ve_tl, ve_rem, ve_mm). Nunca un legajo fijo: lo que antes era «de Eduardo» (CT y «¿quedó resto?»
   del rollo) es del ALIMENTADOR. Y los botones se portan igual que en 2.0: CM (matriz nueva + balancín, tiempo muerto), PM tiempo
   muerto, RM con su recorrido (cierra el cajón, marca la rotura, abre Cambiar Matriz), PCM (al cerrar pregunta si se rompió),
   TRM/TL/REM de matricería, MM, RD; con un tiempo muerto abierto sólo se puede tocar ése (los demás quedan grises).
   v3.1.10, también como 2.0: CONTADOR DE CAJÓN («Faltan X unidades», con el uni_x_cajon de GP2, y «cajón completo»), TERMINAR DÍA
   (último cajón / ¿seguís mañana?, FJ con id fijo que pisa al anterior y lleva el día entero, reenvío del día), «⚡ CONTINUAR» (cajón
   de ayer), los errores de envío a la auditoría, reintento cada 3 s y envío en segundo plano por el service worker.
   ============================================================ */

const APP_VERSION = "v3.1.15";

const SUPABASE_URL = "https://hrxfctzncixxqmpfhskv.supabase.co";
const SUPABASE_KEY = "sb_publishable_BqpAgZH6ty-9wft10_YMhw_0rcIPuWT";
const SCHEMA = "reg_prod_3_0";
const RPC_TIMEOUT_MS = 20000;

/* ============================================================
   TRANSPORTE: la clave pública + el PASE. Devuelve { data, error } como supabase-js; error.red = sin señal / base caída.
   ============================================================ */
async function rpc(fn, args, opts) {
  const o = opts || {};
  const body = Object.assign({}, args || {});
  if (o.pase !== false) { body.p_pase = paseActual(); body.p_dispositivo = idDispositivo(); }
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), o.timeout || RPC_TIMEOUT_MS) : null;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY, "Content-Profile": SCHEMA },
      body: JSON.stringify(body),
      signal: ctl ? ctl.signal : undefined
    });
    let j = null;
    try { j = await r.json(); } catch { /* sin cuerpo */ }
    if (!r.ok) {
      return { data: null, error: { code: String((j && j.code) || ("HTTP" + r.status)), message: String((j && j.message) || ("HTTP " + r.status)), status: r.status } };
    }
    return { data: j, error: null };
  } catch (e) {
    return { data: null, error: { code: "", message: String((e && e.message) || e || "sin red"), red: true } };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/* ============================================================
   EQUIPO: id guardado en el celular (el MISMO gv_dispositivo de Virgilio y Cervantes) + huella + navegador + modelo
   ============================================================ */
const LS_DISPOSITIVO = "gv_dispositivo";
const LS_LEG_REG = "rp3c_legreg";            // + "::" + día + "::" + legajo (ya anotado en el registro de ingresos)
let _dispMemoria = "";
function idDispositivo() {
  try {
    let id = localStorage.getItem(LS_DISPOSITIVO);
    if (!id || id.length < 8) {
      id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
        : ("d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
      localStorage.setItem(LS_DISPOSITIVO, id);
    }
    return id;
  } catch {
    if (!_dispMemoria) _dispMemoria = "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    return _dispMemoria;   // sin storage: vale mientras no se recargue
  }
}
async function huellaDe(txt) {
  try {
    if (window.crypto && crypto.subtle && window.TextEncoder) {
      const b = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(txt)));
      return Array.from(b.slice(0, 8)).map(x => x.toString(16).padStart(2, "0")).join("");
    }
  } catch { /* cae al hash simple */ }
  let h = 2166136261;
  for (let i = 0; i < txt.length; i++) { h ^= txt.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, "0");
}
let _infoDisp = null;
async function infoDispositivo() {
  if (_infoDisp) return _infoDisp;
  const n = navigator, s = window.screen || {};
  let zona = "";
  try { zona = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { /* sin Intl */ }
  const extra = {
    pantalla: (s.width || 0) + "x" + (s.height || 0) + "@" + (window.devicePixelRatio || 1),
    idioma: n.language || "", zona, plataforma: n.platform || "",
    nucleos: n.hardwareConcurrency || null, memoria_gb: n.deviceMemory || null, tactil: n.maxTouchPoints || 0
  };
  try {
    if (n.userAgentData && n.userAgentData.getHighEntropyValues) {
      const h = await n.userAgentData.getHighEntropyValues(["model", "platform", "platformVersion"]);
      extra.modelo = h.model || "";
      extra.so = ((h.platform || "") + " " + (h.platformVersion || "")).trim();
    }
  } catch { /* el navegador no da el modelo */ }
  const navegador = String(n.userAgent || "").slice(0, 300);
  const huella = await huellaDe([navegador, extra.pantalla, extra.idioma, extra.zona, extra.plataforma,
    extra.nucleos, extra.memoria_gb, extra.modelo || ""].join("|"));
  _infoDisp = { dispositivo: idDispositivo(), huella, navegador, extra };
  return _infoDisp;
}
const _infoVacia = () => ({ dispositivo: idDispositivo(), huella: "", navegador: "", extra: {} });

// Anota «este legajo se usó en este equipo» (1 vez por legajo, equipo y día): alimenta el aviso de un celular con 2+ legajos.
// Best-effort: si falla no pasa nada. Es un REGISTRO, no bloquea.
async function registrarLegajoEnEquipo(legajo, nombre) {
  try {
    const leg = String(legajo || "").trim();
    if (!leg || navigator.onLine === false) return;
    const clave = LS_LEG_REG + "::" + dayKeyAR() + "::" + leg;
    try { if (localStorage.getItem(clave)) return; } catch { /* sin storage: se anota cada vez */ }
    const info = await infoDispositivo().catch(_infoVacia);
    const { error } = await rpc("reg_prod_3_0_registrar_ingreso", {
      p_app: "cervantes", p_legajo: leg, p_nombre: String(nombre || "").trim() || null, p_metodo: "legajo",
      p_dispositivo: info.dispositivo, p_huella: info.huella, p_navegador: info.navegador, p_extra: info.extra
    }, { pase: false });
    if (!error) { try { localStorage.setItem(clave, "1"); } catch { /* sin storage */ } }
  } catch { /* best-effort */ }
}

/* ============================================================
   ENTRADA CON EL CÓDIGO DE LA TV + PASE
   Al abrir (y al volver a la app, y al volver internet) si no hay un pase vigente aparece, entera, la pantalla del código:
   4 números que cambian cada minuto (vale el de este minuto y el anterior). La base los valida
   (reg_prod_3_0_cerv_ingresar), deja el ingreso registrado (hora del servidor, IP, equipo) y devuelve el pase.
     · código malo o vencido → la pantalla sigue; demasiados intentos → lo dice y sigue.
     · sin internet / base caída → se puede entrar y cargar: los toques quedan en la cola y se mandan cuando haya pase.
     · el pase vence a las 17:45: pasada esa hora vuelve a pedir el código (y lo que se cargue queda en la auditoría).
   ============================================================ */
const LS_PASE = "rp3c_pase";
const ENTRADA_POSPONER_MS = 5 * 60 * 1000;   // tras «no se pudo verificar», no se vuelve a abrir sola por 5 min
let _entradaEnCurso = null;
let _entradaPospuestaHasta = 0;

function leerPase() { try { return JSON.parse(localStorage.getItem(LS_PASE) || "null"); } catch { return null; } }
function paseActual() { const p = leerPase(); return (p && p.pase) || ""; }
function paseVigente() {
  const p = leerPase();
  if (!(p && p.pase)) return false;
  const v = Date.parse(p.vence || "");
  return v > Date.now();
}
function guardarPase(j) {
  try { localStorage.setItem(LS_PASE, JSON.stringify({ pase: j.pase, vence: j.vence, at: isoNow() })); } catch { /* sin storage: se vuelve a pedir */ }
}
function borrarPase() { try { localStorage.removeItem(LS_PASE); } catch { /* sin storage */ } }

// Pantalla del código. Entera (tapa todo) mientras no haya pase. -> "1234" | null (canceló; sólo si es cancelable)
function pedirClaveTv(aviso, cancelable) {
  return new Promise((resolve) => {
    const viejo = document.getElementById("tvClaveModal");
    if (viejo) viejo.remove();
    const fondo = document.createElement("div");
    fondo.id = "tvClaveModal";
    fondo.style.cssText = "position:fixed;inset:0;z-index:400;background:#eef1f5;display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto;";
    const caja = document.createElement("div");
    caja.style.cssText = "background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:22px 20px;max-width:340px;width:100%;box-shadow:0 6px 24px rgba(15,23,42,.12);text-align:center;font-family:inherit;";
    const t = document.createElement("div");
    t.style.cssText = "font-size:22px;font-weight:800;color:#0f172a;margin-bottom:6px;";
    t.textContent = "📺 Código de la TV";
    const d = document.createElement("div");
    d.style.cssText = "font-size:15px;color:#475569;margin-bottom:14px;";
    d.textContent = "Mirá la TV de Cervantes y poné los 4 números para entrar (cambian cada minuto).";
    const inp = document.createElement("input");
    inp.id = "tvClaveInput";
    inp.type = "text"; inp.inputMode = "numeric"; inp.maxLength = 4; inp.autocomplete = "one-time-code";
    inp.setAttribute("pattern", "[0-9]*");
    inp.style.cssText = "width:100%;box-sizing:border-box;font-size:34px;letter-spacing:12px;text-align:center;padding:8px;border:1.5px solid #cbd5e1;border-radius:10px;font-weight:800;";
    const err = document.createElement("div");
    err.id = "tvClaveError";
    err.style.cssText = "min-height:20px;margin:8px 0;font-size:14px;font-weight:700;color:#b91c1c;";
    err.textContent = aviso || "";
    const fila = document.createElement("div");
    fila.style.cssText = "display:flex;gap:8px;";
    const ok = document.createElement("button");
    ok.id = "tvClaveOk"; ok.type = "button"; ok.textContent = "Entrar";
    ok.style.cssText = "flex:1;min-height:52px;padding:12px;border-radius:10px;border:none;background:#163e98;color:#fff;font-size:17px;font-weight:700;";
    if (cancelable) {
      const no = document.createElement("button");
      no.id = "tvClaveNo"; no.type = "button"; no.textContent = "Ahora no";
      no.style.cssText = "flex:1;min-height:52px;padding:12px;border-radius:10px;border:1.5px solid #cbd5e1;background:#fff;font-size:16px;font-weight:600;";
      no.addEventListener("click", () => cerrar(null));
      fila.append(no);
    }
    fila.append(ok);
    caja.append(t, d, inp, err, fila);
    const cambio = cambioHaciaAca();
    if (cambio) {
      // Cambio de sede: el tiempo ya corre; «Cancelar» vuelve a la sede de antes y no graba nada.
      d.textContent = "Cambio de sede: mirá la TV de Cervantes y poné los 4 números (cambian cada minuto).";
      const cancelar = document.createElement("button");
      cancelar.id = "tvClaveCancelarCambio"; cancelar.type = "button";
      cancelar.textContent = cambio.desde === "virgilio" ? "✕ Cancelar el cambio y volver a Virgilio" : "✕ Cancelar el cambio";
      cancelar.style.cssText = "display:block;width:100%;margin-top:14px;min-height:52px;padding:12px;border-radius:10px;border:1.5px solid #b91c1c;background:#fff;color:#b91c1c;font-size:16px;font-weight:700;";
      cancelar.addEventListener("click", cancelarCambioSede);
      caja.append(cancelar);
    } else {
      const volver = document.createElement("a");
      volver.id = "tvClaveVolver"; volver.href = "../"; volver.textContent = "← Volver al inicio";
      volver.style.cssText = "display:inline-block;margin-top:14px;font-size:14px;font-weight:600;color:#163e98;text-decoration:none;";
      caja.append(volver);
    }
    fondo.appendChild(caja);
    document.body.appendChild(fondo);

    function cerrar(v) { fondo.remove(); resolve(v); }
    const enviar = () => {
      const v = inp.value.replace(/\D/g, "");
      if (v.length !== 4) { err.textContent = "Son 4 números."; return; }
      cerrar(v);
    };
    inp.addEventListener("input", () => { inp.value = inp.value.replace(/\D/g, "").slice(0, 4); });
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") enviar(); });
    ok.addEventListener("click", enviar);
    setTimeout(() => { try { inp.focus(); } catch { /* sin foco */ } }, 50);
  });
}

// Manda el código a la base. -> { estado: "ok" | "codigo" | "bloqueo" | "sin_red" }
async function consultarClaveTv(clave) {
  if (navigator.onLine === false) return { estado: "sin_red" };
  const info = await infoDispositivo().catch(_infoVacia);
  const { data, error } = await rpc("reg_prod_3_0_cerv_ingresar", {
    p_app: "cervantes", p_clave: clave,
    p_dispositivo: info.dispositivo, p_huella: info.huella, p_navegador: info.navegador, p_extra: info.extra
  }, { pase: false, timeout: 12000 });
  if (error) return { estado: "sin_red" };   // 404 (función sin crear) / 5xx / sin señal: no se pudo verificar; no es culpa del operario
  if (data && data.ok && data.pase) { guardarPase(data); return { estado: "ok" }; }
  if (data && data.ok) return { estado: "sin_red" };   // la base no devolvió pase: no se puede seguir
  return { estado: String((data && data.error) || "") === "bloqueo" ? "bloqueo" : "codigo" };
}

// Con el pase conseguido: catálogo al día y lo que estaba en cola se manda.
function alTenerPase() {
  if (typeof espejarColaSW === "function") espejarColaSW();   // el service worker manda con el pase nuevo
  cargarBundle().catch(() => {});
  flushQueue().then(() => { renderSyncBadge(); renderSummary(); }).catch(() => {});
  renderSyncBadge();
}

// Asegura el pase del equipo (muestra la pantalla del código si hace falta).
// -> { ok: true, pendiente: false } | { ok: true, pendiente: true } (sin internet o sin poder verificar: se carga igual y
//    queda en la cola) | { ok: false } (canceló: sólo si opts.cancelable)
function asegurarEntrada(opts) {
  const cancelable = !!(opts && opts.cancelable);
  if (paseVigente()) return Promise.resolve({ ok: true, pendiente: false });
  if (_entradaEnCurso) return _entradaEnCurso;
  if (!(opts && opts.forzar) && Date.now() < _entradaPospuestaHasta) return Promise.resolve({ ok: true, pendiente: true });
  const p = (async () => {
    if (navigator.onLine === false) return { ok: true, pendiente: true };
    let aviso = "";
    for (;;) {
      const clave = await pedirClaveTv(aviso, cancelable);
      if (clave == null) return { ok: false };
      const r = await consultarClaveTv(clave);
      if (r.estado === "ok") { alTenerPase(); return { ok: true, pendiente: false }; }
      if (r.estado === "sin_red") { _entradaPospuestaHasta = Date.now() + ENTRADA_POSPONER_MS; return { ok: true, pendiente: true }; }
      aviso = r.estado === "bloqueo"
        ? "Demasiados intentos con el código. Esperá unos minutos y probá de nuevo."
        : "Código incorrecto o vencido: mirá la TV y probá de nuevo.";
    }
  })().finally(() => { _entradaEnCurso = null; renderSyncBadge(); });
  _entradaEnCurso = p;
  return p;
}

// Al abrir la app, al volver a ella y al volver internet: si falta el pase, aparece la pantalla del código.
function verificarEntrada() {
  if (paseVigente() || navigator.onLine === false || Date.now() < _entradaPospuestaHasta) return;
  asegurarEntrada().catch(() => {});
}

// La base dijo «Pase inválido o vencido» (venció, o es de otro equipo): se descarta y vuelve el código. Lo cargado queda en la cola.
function pasePerdido() {
  borrarPase();
  _entradaPospuestaHasta = 0;
  renderSyncBadge();
  return asegurarEntrada({ forzar: true }).catch(() => {});
}

// Botón del aviso: pide el código para mandar lo que quedó en la cola (se puede dejar para después).
async function ingresarCodigo() {
  _entradaPospuestaHasta = 0;
  await asegurarEntrada({ cancelable: true, forzar: true });
  renderSyncBadge();
}

// Aviso fijo arriba mientras haya toques esperando el código de la TV.
function actualizarAvisoRed(pendientes) {
  let el = document.getElementById("redAviso");
  const espera = pendientes > 0 && !paseVigente();
  if (!espera) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement("div");
    el.id = "redAviso";
    el.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:200;padding:8px 12px;font-size:14px;font-weight:700;text-align:center;background:#fef3c7;color:#92400e;border-bottom:2px solid #f59e0b;";
    const txt = document.createElement("span");
    txt.id = "redAvisoTxt";
    const btn = document.createElement("button");
    btn.id = "redAvisoBtn"; btn.type = "button"; btn.textContent = "Ingresar código";
    btn.style.cssText = "margin-left:10px;padding:4px 12px;border-radius:8px;border:1px solid #b45309;background:#fff;color:#92400e;font-size:14px;font-weight:800;";
    btn.addEventListener("click", ingresarCodigo);
    el.append(txt, btn);
    document.body.appendChild(el);
  }
  const sinRed = navigator.onLine === false;
  el.querySelector("#redAvisoTxt").textContent = sinRed
    ? `📺 ${pendientes} registro(s) esperan: cuando vuelva internet ingresá el código de la TV.`
    : `📺 ${pendientes} registro(s) esperan el código de la TV para enviarse.`;
  el.querySelector("#redAvisoBtn").style.display = sinRed ? "none" : "";
}

/* ============================================================
   DATOS (cargados una vez desde bundle)
   ============================================================ */
/* Shape real de reg_prod_3_0_bundle() (el de registro_operarios_bundle() de GP2, con pase; `rollos_activos` desde la Fase 1c):
   empleados    { legajo -> {nombre, activo, hora_entrada} }
   matrices     [ {n, d, ppk, uxg, maq, act} ]   uxg = unidades por golpe, act = activa
   registro_en_golpes  true = el cajon se cierra anotando GOLPES del contador
   matriz_fleje { n_matriz -> {comp_id, codigo, descripcion} }          (fallback)
   matriz_fleje_pieza { n_matriz -> { comp_salida_id -> {comp_id, codigo, descripcion} } }
   envasado     { n_matriz -> {unica: art/caja o null, salidas: {comp_salida_id -> art/caja}} }
                 (matriz que cierra un terminado: el operario carga CAJAS, no golpes)
   rollos_saldo [ {comp_id, codigo, kg_por_rollo, rollos} ]              */
let D = {};

const LS_BUNDLE = "rp3c_bundle";
const CATALOGO_REFRESCO_MS = 30 * 60 * 1000;   // con la app abierta, el catálogo se vuelve a pedir cada 30 min
let _catalogoAt = 0;
let _bundleTimer = null;

function leerCache(clave) { try { return JSON.parse(localStorage.getItem(clave) || "null"); } catch { return null; } }
function guardarCache(clave, data) { try { localStorage.setItem(clave, JSON.stringify({ at: isoNow(), data })); } catch { /* storage lleno: sin caché */ } }
function armarBundle(d) {
  const x = (d && typeof d === "object") ? d : {};
  x.matricesMap = new Map((x.matrices || []).map(m => [String(m.n || "").trim(), m]));
  return x;
}
function repintarCatalogo() { if (selected && selected.code === "E") renderMatrizPicker(); }

async function cargarBundle() {
  clearTimeout(_bundleTimer);
  if (!D.matricesMap) {                                      // primero lo guardado en el celular (abre sin señal)
    const c = leerCache(LS_BUNDLE);
    if (c && c.data) { D = armarBundle(c.data); _catalogoAt = Date.parse(c.at) || 0; repintarCatalogo(); }
  }
  if (!paseVigente() || navigator.onLine === false) return;  // el pase y el internet los traen verificarEntrada() y "online"
  const { data, error } = await rpc("reg_prod_3_0_bundle");
  if (error) {
    console.error("Bundle error:", error);
    if (error.code === "28000") pasePerdido();
    else _bundleTimer = setTimeout(() => { cargarBundle().catch(() => {}); }, 15000);   // sin catálogo la app rechaza todo: reintenta
    return;
  }
  guardarCache(LS_BUNDLE, data);
  D = armarBundle(data);
  _catalogoAt = Date.now();
  repintarCatalogo();
}
function refrescarCatalogos() {
  if (navigator.onLine === false || !paseVigente() || Date.now() - _catalogoAt < CATALOGO_REFRESCO_MS) return;
  cargarBundle().catch(() => {});
}

function nombreMatriz(n) { return D.matricesMap?.get(String(n).trim())?.d || ""; }

/* GOLPES -> UNIDADES. El contador de la matriz (alimentador o balancin) cuenta GOLPES,
   y hay matrices que escupen mas de una pieza por golpe (la 348 saca 2 cuchillitos, la
   16 saca 4 arandelas). El operario anota los golpes y el factor lo pone la base
   (GP2.matriz.uni_x_golpe): asi el dia que se cambia la matriz se toca UN numero y no
   hay que reeducar a nadie. Si el bundle todavia no cargo, el factor es 1 (no inventa). */
function uniXGolpe(n) {
  const v = Number(D.matricesMap?.get(String(n || "").trim())?.uxg);
  return v > 0 ? v : 1;
}
function pideGolpes() { return D.registro_en_golpes !== false; }
/* Matriz dada de baja: sigue en el diccionario para poder ponerle nombre a un registro
   viejo, pero no se ofrece para elegir ni se acepta tipeada. */
function matrizActiva(n) {
  const m = D.matricesMap?.get(String(n || "").trim());
  return !!m && m.act !== false;
}
function golpesAUni(nMatriz, golpes) {
  const g = Number(golpes) || 0;
  return pideGolpes() ? g * uniXGolpe(nMatriz) : g;
}

/* ENVASADO: la matriz cierra un articulo terminado. El operario carga CAJAS (no golpes) y
   la base descuenta las UNIDADES = cajas * articulos_por_caja. El bundle manda, por matriz,
   { unica: art/caja (cuando cierra UN solo articulo), salidas: { comp_salida_id -> art/caja } }. */
function envasadoDe(n) { return (D.envasado || {})[String(n || "").trim()] || null; }
function apcEnvase(n, compSalidaId) {
  const e = envasadoDe(n);
  if (!e) return null;
  if (compSalidaId != null && e.salidas && e.salidas[String(compSalidaId)] != null) return Number(e.salidas[String(compSalidaId)]);
  if (e.unica != null) return Number(e.unica);
  const vals = e.salidas ? Object.values(e.salidas) : [];
  return vals.length === 1 ? Number(vals[0]) : null;
}

/* ============================================================
   OPCIONES (botones)
   ============================================================ */
const OPTIONS = [
  // row 1 (los botones de matricería también van arriba, como 2.0)
  { code: "E",  desc: "Empece Matriz",     row: 1, needsInput: true,  label: "Ingresa el número", validate: /^[0-9]+[A-Za-z]?$/ },
  { code: "C",  desc: "Cajon",             row: 1, needsInput: true,  label: "Ingresa los GOLPES del contador", validate: /^[0-9]+$/ },
  { code: "TRM", desc: "Trabajando en Matriz", row: 1, needsInput: true, label: "Número de la matriz", validate: /^[0-9]+[A-Za-z]?$/ },
  { code: "TL",  desc: "Taller",            row: 1, needsInput: false },
  // row 2
  { code: "PB",   desc: "Pare Bano",       row: 2, needsInput: false },
  { code: "BC",   desc: "Busque Cajon",    row: 2, needsInput: false },
  { code: "MOV",  desc: "Movimiento",      row: 2, needsInput: false },
  { code: "LIMP", desc: "Limpieza",        row: 2, needsInput: false },
  { code: "Perm", desc: "Permiso",         row: 2, needsInput: false },
  // row 3
  { code: "AL",    desc: "Ayuda Logistica",       row: 3, needsInput: false },
  { code: "PR",    desc: "Pare Carga Rollo",      row: 3, needsInput: false },
  { code: "PC",    desc: "Pare Comida",           row: 3, needsInput: false },
  { code: "RD",    desc: "Rollo Fleje Doblado",   row: 3, needsInput: false },
  { code: "MOV P", desc: "Movimiento Piedra",     row: 3, needsInput: false },
  { code: "MM",    desc: "Movimiento Matriceria", row: 3, needsInput: false },
  // row 4
  { code: "CM",  desc: "Cambiar Matriz",       row: 4, needsInput: false },   // abre con el cartel matriz nueva + balancín
  { code: "PM",  desc: "Pare Matriz",          row: 4, needsInput: false },
  { code: "RM",  desc: "Rotura Matriz",        row: 4, needsInput: false },
  { code: "REM", desc: "Reparando Matriz",     row: 4, needsInput: false },
  { code: "PCM", desc: "Pare Consulta Matriz", row: 4, needsInput: false },
];

const CT_OPTION = { code: "CT", desc: "Cajon Termine", row: 1, needsInput: false, isCT: true };

// Como 2.0: E, C, RM, RD y LT son puntuales; todo lo demás (PM, CM, PCM, TRM, TL, REM, MM, PB…) es TIEMPO MUERTO: el 1.er toque lo
// abre y el 2.º (el MISMO) lo cierra midiendo la duración. CT es el cajón de cierre del alimentador (puntual).
const NON_DOWNTIME = new Set(["E", "C", "CT", "RM", "RD", "LT"]);
const isDowntime = (op) => !NON_DOWNTIME.has(op);
const sameDowntime = (a, b) => a && b && a.opcion === b.opcion && (a.texto || "") === (b.texto || "");

/* ============================================================
   QUIÉN VE QUÉ BOTÓN — capsDe() + botonVisible() de Registro Producción 2.0 (cervantes/app.js, v1.8.54), con los permisos de
   public."Empleados" que trae el catálogo. El orden importa: matricería se pregunta primero (un matricero ve SÓLO sus botones).
   ============================================================ */
const NORMAL_BASE = new Set(["E", "C", "PB", "BC", "LIMP", "Perm", "AL", "PC", "PM", "RM", "PCM"]);
function capsDe(legajo) {
  const e = (D.empleados || {})[String(legajo || "").trim()] || {};
  const alimentador = e.es_alimentador === true;
  return {
    matriceria: e.es_matriceria === true,
    piedra: e.es_piedra === true,
    alimentador,
    cm: e.ve_cm === true || alimentador,   // el alimentador ya implica CM
    pr_rd: alimentador,                     // PR + RD = rol alimentador
    trm: e.ve_trm === true,
    tl: e.ve_tl === true,
    rem: e.ve_rem === true,
    mm: e.ve_mm === true                    // Movimiento Matricería (piedra que también hace matricería)
  };
}
function puedeCM(legajo) { return capsDe(legajo).cm; }
function botonVisible(code, caps) {
  if (caps.matriceria) {
    if (code === "TRM") return caps.trm;
    if (code === "TL") return caps.tl;
    if (code === "CM") return caps.cm;
    if (code === "REM") return caps.rem;
    return false;                           // matricería no ve los botones normales
  }
  if (code === "CT") return caps.alimentador && rollosActivos();   // cierre de cajón con rollo: del alimentador
  if (code === "MOV") return !caps.piedra;
  if (code === "MOV P") return caps.piedra;
  if (code === "MM") return caps.mm;
  if (code === "CM") return caps.cm;
  if (code === "PR" || code === "RD") return caps.pr_rd;
  if (code === "TRM" || code === "TL" || code === "REM") return false;
  return NORMAL_BASE.has(code);
}
// Matriz de alimentador (GP2.matriz.tipo = 'A', el Tipo_Matriz de 2.0): al cerrar un cajón pregunta «Continuar / Cambiar Matriz».
function esMatrizAlimentador(n) { return String(D.matricesMap?.get(String(n || "").trim())?.tipo || "").trim().toUpperCase() === "A"; }
// 501: el operario no carga golpes sino los KILOS que hizo, con coma o punto; se guarda con coma (como 2.0) y viaja como uni.
function es501(n) {
  const k = String(n || "").trim();
  return k === "501" || String(D.matricesMap?.get(k)?.tu || "").trim().toLowerCase() === "kg";
}
function normalizarComa(v) { return String(v || "").trim().replace(/\./g, ","); }
function kilos501(v) { return Number(String(v || "").trim().replace(",", ".")) || 0; }

/* ============================================================
   CONTADOR DE CAJÓN, como 2.0 («Faltan X unidades para completar el cajón»), con lo que entra en el cajón según GP2
   (componente.uni_x_cajon de la pieza). Lo lleva la base al grabar cada C (fase 2c); acá se muestra. Es compartido entre
   operarios: al elegir la matriz o el C se relee (reg_prod_3_0_contador_cajon), como 2.0.
   D.cajon = { n_matriz: { comp_id: {uxc, act, codigo} } }
   ============================================================ */
function contadorDe(n, compId) {
  const m = (D.cajon || {})[String(n || "").trim()];
  if (!m) return null;
  if (compId != null && m[String(compId)]) return { comp_id: String(compId), ...m[String(compId)] };
  const ks = Object.keys(m);
  return ks.length === 1 ? { comp_id: ks[0], ...m[ks[0]] } : null;   // varias piezas y ninguna elegida: no se sabe cuál
}
function textoFaltante(c) {
  if (!c || !(Number(c.uxc) > 0)) return "";
  const act = Number(c.act) || 0;
  const falta = Math.max(Number(c.uxc) - act, 0);
  return `Faltan ${falta.toLocaleString("es-AR")} unidades para completar el cajón` + (act > 0 ? ` (ya hay ${act.toLocaleString("es-AR")})` : "");
}
function aplicarContador(n, info) {
  if (!info || info.comp_id == null) return;
  const k = String(n || "").trim();
  D.cajon = D.cajon || {};
  D.cajon[k] = D.cajon[k] || {};
  const prev = D.cajon[k][String(info.comp_id)] || {};
  D.cajon[k][String(info.comp_id)] = { ...prev, uxc: info.uxc != null ? info.uxc : prev.uxc, act: info.act };
}
let _contadorPedido = {};
async function refrescarContador(n) {
  const k = String(n || "").trim();
  if (!k || !(D.cajon || {})[k] || !paseVigente() || navigator.onLine === false) return false;
  if (Date.now() - (_contadorPedido[k] || 0) < 5000) return false;
  _contadorPedido[k] = Date.now();
  const { data, error } = await rpc("reg_prod_3_0_contador_cajon", { p_n_matriz: k });
  if (error || !data || typeof data !== "object") return false;
  D.cajon[k] = data;
  return true;
}
// Mientras la base no contesta, el contador se mueve en el celular con lo que se acaba de cargar (la respuesta de la base lo corrige).
function contadorOptimista(payload) {
  if (!["C", "CT"].includes(payload.opcion)) return;
  const n = String(payload.matriz || "").trim();
  if (!n || es501(n)) return;
  const c = contadorDe(n, payload.comp_salida_id);
  if (!c) return;
  const r = toRpcPayload(payload);
  const uni = Number(r.uni) > 0 ? Number(r.uni) : (Number(r.golpes) || 0) * uniXGolpe(n);
  const tot = (Number(c.act) || 0) + uni;
  aplicarContador(n, { comp_id: c.comp_id, act: (payload.cajon_completo || tot >= Number(c.uxc)) ? 0 : tot });
}

/* ============================================================
   TIEMPO / ZONA AR
   ============================================================ */
function isoNow() { return new Date().toISOString(); }

function formatDateTimeAR(iso) {
  try {
    return new Date(iso).toLocaleString("es-AR", {
      timeZone: "America/Argentina/Buenos_Aires", hour12: false
    });
  } catch { return ""; }
}

function dayKeyAR() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  const y = parts.find(p => p.type === "year")?.value || "0000";
  const m = parts.find(p => p.type === "month")?.value || "00";
  const d = parts.find(p => p.type === "day")?.value || "00";
  return `${y}-${m}-${d}`;
}

function nowMinutesAR() {
  const parts = new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    hour: "2-digit", minute: "2-digit", hour12: false
  }).formatToParts(new Date());
  return Number(parts.find(p => p.type === "hour")?.value || 0) * 60 +
         Number(parts.find(p => p.type === "minute")?.value || 0);
}

function uuidv4() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  const b = new Uint8Array(16);
  (window.crypto || window.msCrypto).getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

/* ============================================================
   ESTADO POR LEGAJO (localStorage)
   ============================================================ */
const LS_PREFIX  = "rp3c_state";
const LS_QUEUE   = "rp3c_queue";

function stateKey(legajo) { return `${LS_PREFIX}::${dayKeyAR()}::${String(legajo).trim()}`; }

function freshState() {
  return { lastMatrix: null, lastCajon: null, lastDowntime: null, last2: [],
           lateArrivalSent: false, lateArrivalDiscarded: false, matrixNeedsC: false };
}

function readState(legajo) {
  try {
    const raw = localStorage.getItem(stateKey(legajo));
    if (!raw) return freshState();
    const s = JSON.parse(raw);
    if (!s || typeof s !== "object") return freshState();
    s.last2 = Array.isArray(s.last2) ? s.last2 : [];
    s.lastMatrix = s.lastMatrix || null;
    s.lastCajon  = s.lastCajon  || null;
    s.lastDowntime = s.lastDowntime || null;
    s.matrixNeedsC = !!s.matrixNeedsC;
    s.rollo = s.rollo || null;
    return s;
  } catch { return freshState(); }
}

function writeState(legajo, state) {
  localStorage.setItem(stateKey(legajo), JSON.stringify(state));
}

function updateStateAfterSend(legajo, payload) {
  const s = readState(legajo);
  const op = payload.opcion;

  if (op === "E") {
    if (s.lastMatrix && s.lastMatrix.texto !== payload.texto) s.lastCajon = null;
    s.lastMatrix = { opcion: "E", texto: payload.texto || "", ts: payload.ts_event,
                     comp_salida_id: payload.comp_salida_id || null, pieza: payload.pieza || null };
    // Rollo que agarro para esta matriz: se le van descontando kg con cada cajon.
    if (payload.rollo) s.rollo = { ...payload.rollo, kg_usados: 0 };
    s.lastDowntime = null; s.matrixNeedsC = true;
    s.last2.push({ ...payload, status: "queued" });
    writeState(legajo, s); return;
  }
  if (op === "C" || op === "CT") {
    s.lastCajon = { opcion: op, texto: payload.texto || "", ts: payload.ts_event };
    // Descontar del rollo en uso los kg de este cajon: uni / ppk (piezas por kg
    // de fleje de la matriz activa). Si la matriz no tiene ppk no se estima.
    // OJO: lo que tipeo el operario son GOLPES, hay que pasarlos a unidades primero.
    if (s.rollo) {
      const nMat = String(s.lastMatrix?.texto || "").trim();
      const ppk = Number(D.matricesMap?.get(nMat)?.ppk) || 0;
      const uni = golpesAUni(nMat, payload.texto);
      if (ppk > 0 && uni > 0) s.rollo.kg_usados = (Number(s.rollo.kg_usados) || 0) + uni / ppk;
    }
    s.lastDowntime = null; s.matrixNeedsC = false;
    if (s.cajonContinuado) s.cajonContinuado = null;    // ya se mandó el C que completa el cajón de ayer
    s.last2.push({ ...payload, status: "queued" });
    writeState(legajo, s); return;
  }
  if (["RM", "RD", "LT", "CS"].includes(op)) {  // puntuales (PM es tiempo muerto desde la v3.1.9, como 2.0); CS llega ya cerrado
    if (op !== "LT" && op !== "CS") s.lastDowntime = null;
    s.last2.push({ ...payload, status: "queued" });
    writeState(legajo, s); return;
  }
  if (isDowntime(op)) {
    const item = { opcion: op, texto: payload.texto || "", ts: payload.ts_event };
    if (!s.lastDowntime) s.lastDowntime = item;
    else if (sameDowntime(s.lastDowntime, payload)) s.lastDowntime = null;
    else s.lastDowntime = item;
  }
  s.last2.push({ ...payload, status: "queued" });
  writeState(legajo, s);
}

function markSent(legajo, id) {
  const s = readState(legajo);
  const item = s.last2.find(x => x.id === id);
  if (item) { item.status = "sent"; item.sentAt = isoNow(); delete item.lastError; }
  writeState(legajo, s);
}

function markFailed(legajo, id, err) {
  const s = readState(legajo);
  const item = s.last2.find(x => x.id === id);
  if (item) { item.status = "failed"; item.lastError = String(err || ""); }
  writeState(legajo, s);
}

/* ============================================================
   COLA OFFLINE
   ============================================================ */
function readQueue()  { try { return JSON.parse(localStorage.getItem(LS_QUEUE) || "[]"); } catch { return []; } }
function writeQueue(q) { localStorage.setItem(LS_QUEUE, JSON.stringify(q || [])); }

/* Cola de ANULACIONES (arreglo de Registro Produccion 3.0, 2026-10-07 [usuario: "en cola, pero asegurate de que no se tome
   su duplicado"]): un 🗑 sin señal ya no obliga a repetirlo; la baja queda guardada y sale sola en flushQueue, DESPUES de los
   eventos (asi nunca llega antes que el alta). Sin duplicados: una sola por toque (por id_ejecucion) y la base anula una sola
   vez (reg_prod_3_0_anular_evento devuelve el stock una sola vez). */
const LS_AQUEUE = "rp3c_aqueue";
function readAnularQueue()  { try { return JSON.parse(localStorage.getItem(LS_AQUEUE) || "[]"); } catch { return []; } }
function writeAnularQueue(q) { localStorage.setItem(LS_AQUEUE, JSON.stringify(q || [])); }
function enqueueAnular(id) { const aq = readAnularQueue(); if (!aq.includes(id)) { aq.push(id); writeAnularQueue(aq); } }

function enqueue(payload) {
  // El fin de jornada tiene id fijo por legajo y día: uno nuevo reemplaza al que estuviera esperando (como 2.0).
  const q = readQueue().filter(x => !(payload.opcion === "FJ" && x.id === payload.id));
  if (!q.some(x => x.id === payload.id)) q.push(payload);
  writeQueue(q);
  if (typeof espejarColaSW === "function") espejarColaSW();   // copia para el envío en segundo plano (si hay service worker)
}

/* ERRORES DE ENVÍO a la auditoría de la base (como el ERROR_ENVIO de 2.0 en Auditoria_Produccion): al primer intento fallido de
   cada toque y después cada 5. Sin pase a propósito (falla justo cuando el pase o la base fallan); si no hay señal, tampoco llega. */
function anotarErrorEnvio(payload, error) {
  const q = readQueue();
  const it = q.find(x => x.id === payload.id);
  const n = ((it && it._intentos) || 0) + 1;
  const rechazo = esRechazoDefinitivo(error);
  if (it) { it._intentos = n; if (rechazo) it._rechazado = true; writeQueue(q); }
  if (n !== 1 && (rechazo || n % 5 !== 0)) return;   // un rechazo por los datos se anota una sola vez
  rpc("reg_prod_3_0_registrar_error_envio", {
    p_app: "cervantes", p_dispositivo: idDispositivo(), p_legajo: String(payload.legajo || ""),
    p_detalle: { id: payload.id, opcion: payload.opcion, intentos: n, codigo: String((error && error.code) || ""),
                 error: String((error && error.message) || "").slice(0, 300), estado: (error && error.status) || null,
                 sin_red: !!(error && error.red), online: navigator.onLine !== false }
  }, { pase: false, timeout: 8000 }).catch(() => {});
}

function horaAR(iso) {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Argentina/Buenos_Aires",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
    }).format(new Date(iso));
  } catch { return ""; }
}

/* Traduce el evento local al shape que espera GP2.registrar_evento_prod(p jsonb).
   `matriz` es obligatorio del lado SQL: para E/CM es el numero tipeado, para los
   eventos de matriz activa es el guardado en el payload, y para los tiempos
   muertos se manda el codigo del evento (queda en matriz_raw, sin matriz_id). */
function toRpcPayload(p) {
  const op = String(p.opcion || "").toUpperCase();
  let matriz;
  if (op === "E") matriz = p.texto || "";
  else if (op === "CM" || op === "TRM") matriz = op;     // como 2.0: la matriz que se cambia / se repara va en el texto
  else if (p.matriz) matriz = p.matriz;
  else matriz = op;

  const rpc = {
    fecha: p.ts_event,
    legajo: String(p.legajo || ""),
    matriz: String(matriz || "").trim(),
    id_ejecucion: p.id,
    hora_fin: horaAR(p.ts_event)
  };
  if (p.hs_inicio) rpc.hora_inicio = horaAR(p.hs_inicio);
  if (p.comp_salida_id) rpc.comp_salida_id = p.comp_salida_id;

  if (p.balancin) rpc.balancin = p.balancin;            // CM: en qué balancín quedó la matriz (va a la cruda)
  if (p.cajon_completo) rpc.cajon_completo = true;      // «cajón completo»: el contador vuelve a 0 (como 2.0)
  if (["C", "CT"].includes(op)) {
    const env = envasadoDe(matriz);
    if (es501(matriz)) {
      // 501: KILOS (con coma, como 2.0). La base calcula el premio en kilos y pasa los kilos a unidades para el stock.
      rpc.uni = kilos501(p.texto);
    } else if (env) {
      // ENVASADO: el operario carga CAJAS; unidades = cajas x articulos_por_caja. Se manda uni
      // directo (no golpes) para que fabricar_stock descuente el BOM de esas unidades.
      const apc = apcEnvase(matriz, p.comp_salida_id) || 1;
      rpc.uni = (Number(p.texto) || 0) * apc;
    } else if (pideGolpes()) {
      // Se manda lo que el operario conto (golpes) y la RPC lo multiplica por matriz.uni_x_golpe.
      rpc.golpes = Number(p.texto) || 0;
    } else {
      rpc.uni = Number(p.texto) || 0;
    }
    rpc.nombre_matriz = nombreMatriz(matriz) || undefined;
  } else {
    rpc.uni = 0;
    rpc.nombre_matriz = op === "E" ? (nombreMatriz(matriz) || undefined)
      : op === "CM" ? `Cambiar Matriz a ${p.texto || ""}`.trim()
      : op === "TRM" ? `Trabajando en Matriz ${p.texto || ""}`.trim()
      : p.descripcion;
  }

  const segs = (p.hs_inicio && p.ts_event)
    ? Math.max(0, Math.round((new Date(p.ts_event) - new Date(p.hs_inicio)) / 1000))
    : null;
  if (segs !== null) {
    if (["C", "CT"].includes(op)) rpc.segundos_trabajados = segs;
    else if (isDowntime(op)) rpc.segundos_tiempo_muerto = segs;
  }
  // CAJÓN CONTINUADO de ayer (como 2.0): segundos = hoy (desde que se tocó «Continuar») + lo de ayer hasta la hora de salida;
  // la hora de inicio es la del cajón de ayer y el nombre lleva [CONT]. Los tiempos muertos que se descuentan son sólo los de hoy.
  if (op === "C" && p.cajon_continuado) {
    const cc = p.cajon_continuado;
    const hoy = Math.max(1, Math.round((new Date(p.ts_event) - new Date(cc.tsActivacion || p.hs_inicio || p.ts_event)) / 1000));
    rpc.segundos_trabajados = hoy + (Number(cc.segPostAyer) || 0);
    if (cc.tsInicioCajon) rpc.hora_inicio = horaAR(cc.tsInicioCajon);
    rpc.nombre_matriz = `[CONT] ${nombreMatriz(matriz) || ""}`.trim();
    rpc.cajon_continuado = cc;
  }
  return rpc;
}

/* El toque como lo guarda la base: la fila PROCESADA sale de `p` (lo de toRpcPayload) y la CRUDA es `p.toque`, tal cual lo cargó el operario. */
function eventoParaEnviar(payload) {
  const p = toRpcPayload(payload);
  p.toque = {
    id: payload.id, opcion: payload.opcion, descripcion: payload.descripcion || "", texto: payload.texto || "",
    ts_event: payload.ts_event, hs_inicio: payload.hs_inicio || "", matriz: payload.matriz || "", app_version: APP_VERSION
  };
  return p;
}
// Rechazo de la base por los datos (SQLSTATE de 5 caracteres, 4xx): no se arregla reintentando. Sin señal, 5xx o función
// inexistente (PGRST…): se reintenta y el toque queda PENDIENTE.
function esRechazoDefinitivo(e) {
  return !!e && e.status >= 400 && e.status < 500 && /^[0-9A-Z]{5}$/.test(String(e.code || ""));
}

let flushing = false; // guard: interval de 60s, syncBadge, sendFast y Terminar Dia no deben solaparse (duplicarian inserts)
async function flushQueue() {
  if (flushing) return;
  flushing = true;
  try {
    const q = readQueue();
    if (!q.length && !readRolloQueue().length && !readAnularQueue().length && !readBalancinQueue().length) return;
    if (!paseVigente()) { verificarEntrada(); return; }       // sin pase no se manda: queda en la cola y se pide el código
    const enviados = new Set();
    for (const payload of q) {
      const { data, error } = await rpc("reg_prod_3_0_registrar_evento", { p: eventoParaEnviar(payload) });
      if (!error) {
        markSent(payload.legajo, payload.id); enviados.add(payload.id);
        if (data && data.cajon) aplicarContador(payload.matriz, data.cajon);   // el contador como quedó en la base
        continue;
      }
      if (error.code === "28000") { pasePerdido(); break; }   // pase vencido o de otro equipo: vuelve el código, nada se pierde
      anotarErrorEnvio(payload, error);
      if (!esRechazoDefinitivo(error)) break;                 // sin señal / base caída: se reintenta
      markFailed(payload.legajo, payload.id, error.message);
    }
    // Re-leer la cola: pudo haber items nuevos encolados mientras se enviaba
    if (enviados.size) {
      writeQueue(readQueue().filter(x => !enviados.has(x.id)));
      if (typeof espejarColaSW === "function") espejarColaSW();   // lo enviado sale también de la copia del service worker
    }
    // Bajas pendientes (🗑 sin señal o sin pase), una por toque, DESPUÉS de los eventos: nunca llegan antes que el alta. La base anula
    // y devuelve el stock una sola vez, así que repetirla no hace daño; un rechazo por los datos se descarta.
    let aq = readAnularQueue();
    while (aq.length && paseVigente()) {
      const id = aq[0];
      const { error } = await rpc("reg_prod_3_0_anular_evento", { p_id_ejecucion: id });
      if (error && error.code === "28000") { pasePerdido(); break; }
      if (error && !esRechazoDefinitivo(error)) break;
      aq = readAnularQueue().filter(x => x !== id); writeAnularQueue(aq);
    }
    // Rollos pendientes (tomar/cerrar que no pudieron salir): FIFO, corta al primer fallo de red o de pase.
    let rq = readRolloQueue();
    while (rq.length) {
      const { error } = await rpc(rq[0].fn, rq[0].args);
      if (error && error.code === "28000") { pasePerdido(); break; }
      if (error && !esRechazoDefinitivo(error)) break;
      rq = readRolloQueue(); rq.shift(); writeRolloQueue(rq);
    }
    // Balancines (CM: en qué balancín quedó la matriz), FIFO igual que los rollos.
    let bq = readBalancinQueue();
    while (bq.length && paseVigente()) {
      const { error } = await rpc("reg_prod_3_0_asignar_matriz_balancin", bq[0]);
      if (error && error.code === "28000") { pasePerdido(); break; }
      if (error && !esRechazoDefinitivo(error)) break;
      bq = readBalancinQueue(); bq.shift(); writeBalancinQueue(bq);
    }
  } finally { flushing = false; }
}

/* ============================================================
   LLEGADA TARDE
   ============================================================ */
// La hora de entrada DE CADA OPERARIO (catálogo: Planify, si no Empleados, si no GP2) [Elías, 08/10: «tiene que ser la llegada tarde
// del operario de verdad»]. Sin hora en ningún lado, 08:30 como antes.
function horaEntradaDe(legajo) {
  const h = String(((D.empleados || {})[String(legajo || "").trim()] || {}).hora_entrada || "").trim();
  const m = h.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return { min: 8 * 60 + 30, hhmm: "08:30" };
  return { min: Number(m[1]) * 60 + Number(m[2]), hhmm: m[1].padStart(2, "0") + ":" + m[2] };
}
function maybeSendLateArrival(legajo) {
  const s = readState(legajo);
  const isFirst = !s.last2.length && !s.lastMatrix && !s.lastCajon && !s.lastDowntime;
  if (!isFirst || s.lateArrivalSent || s.lateArrivalDiscarded) return;

  const entrada = horaEntradaDe(legajo);
  if (nowMinutesAR() <= entrada.min) {
    s.lateArrivalDiscarded = true; writeState(legajo, s); return;
  }
  const day = dayKeyAR();
  const payload = {
    id: uuidv4(), legajo, opcion: "LT", descripcion: "Llegada Tarde",
    texto: "", ts_event: isoNow(), hs_inicio: `${day}T${entrada.hhmm}:00-03:00`, matriz: ""
  };
  s.lateArrivalSent = true; writeState(legajo, s);
  updateStateAfterSend(legajo, payload);   // queda en el historial (como 2.0)
  enqueue(payload);
}

/* ============================================================
   CONTINUAR MATRIZ (el cajón del día anterior), como 2.0 [Elías, 08/10: «4: se tiene que»]
   Si ayer, al terminar el día, el operario dijo «sigo mañana con esta matriz» (terminoConContinuacion) y la matriz quedó sin
   cajón, hoy aparece «⚡ Continuar Matriz» al lado de E. Al tocarlo, la matriz de ayer queda activa y el cajón que cierre suma
   lo de ayer (desde el inicio del cajón hasta su HORA DE SALIDA) + lo de hoy (desde que tocó Continuar); los tiempos muertos que
   se descuentan son sólo los de hoy. Tocar otro botón con el «Continuar» a la vista pide el código de Logística (151515) y
   después el botón ya no aparece.
   ============================================================ */
function horaSalidaDe(legajo) {
  const h = String(((D.empleados || {})[String(legajo || "").trim()] || {}).hora_salida || "").trim();
  const m = h.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}:${m[3] || "00"}` : "";
}
function stateAnteriorConMatrizAbierta(legajo) {
  const leg = String(legajo || "").trim();
  const hoy = dayKeyAR();
  let mejor = null;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(LS_PREFIX + "::")) continue;
    const parts = k.split("::");
    if (parts.length < 3 || parts[2] !== leg || parts[1] >= hoy) continue;
    try {
      const s = JSON.parse(localStorage.getItem(k));
      if (!s || !s.lastMatrix?.texto || !s.matrixNeedsC) continue;
      if (!mejor || parts[1] > mejor.dia) mejor = { dia: parts[1], state: s };
    } catch { /* estado roto: se saltea */ }
  }
  return mejor;
}
function evaluarBannerContinuar(legajo) {
  const leg = String(legajo || "").trim();
  if (!leg) return null;
  const st = readState(leg);
  if (st.lastMatrix || st.lastCajon || st.continuacionConsultada) return null;
  const salida = horaSalidaDe(leg);
  if (!salida) return null;
  const ant = stateAnteriorConMatrizAbierta(leg);
  if (!ant || !ant.state.terminoConContinuacion) return null;
  const lm = ant.state.lastMatrix, lc = ant.state.lastCajon;
  const matriz = String(lm.texto || "").trim();
  if (!matriz) return null;
  const tsLM = lm.ts || "", tsLC = lc?.ts || "";
  const tsInicioCajon = (tsLC && tsLC > tsLM) ? tsLC : tsLM;
  if (!tsInicioCajon) return null;
  const dSalida = new Date(`${ant.dia}T${salida}-03:00`), dIni = new Date(tsInicioCajon);
  if (isNaN(dSalida) || isNaN(dIni)) return null;
  return {
    legajo: leg, matriz, fechaAyer: ant.dia, tsInicioCajon, horaSalidaAyer: salida,
    segPostAyer: Math.max(0, Math.floor((dSalida - dIni) / 1000)),
    comp_salida_id: lm.comp_salida_id || null, pieza: lm.pieza || null
  };
}
function hayContinuarPendiente() { return !!evaluarBannerContinuar(legajoKey()); }

const CODIGO_LOGISTICA_IGNORAR_CONT = "151515";
function mostrarAdvertenciaIgnorarContinuar(onConfirm) {
  const viejo = document.getElementById("advIgnorarContModal");
  if (viejo) viejo.remove();
  const modal = document.createElement("div");
  modal.id = "advIgnorarContModal";
  modal.className = "adv-cont-modal";
  modal.innerHTML =
    '<div class="adv-cont-card">' +
    '  <div class="adv-cont-header">⚠ Cajón pendiente de continuar</div>' +
    '  <div class="adv-cont-body">' +
    '    <p>Tenés un cajón pendiente del día anterior.</p>' +
    '    <p>Si seguís con otra opción, <b>perdés la posibilidad de continuar el cajón</b> (no va a aparecer más el botón).</p>' +
    '    <p><b>Avisá a Logística</b> antes de seguir. Te van a dar un código:</p>' +
    '    <input type="text" id="advIgnorarContCodigo" inputmode="numeric" placeholder="Código de Logística" autocomplete="off">' +
    '    <div class="adv-cont-fb" id="advIgnorarContFb"></div>' +
    '  </div>' +
    '  <div class="adv-cont-footer">' +
    '    <button type="button" class="adv-cont-cancel" id="advIgnorarContCancel">Cancelar</button>' +
    '    <button type="button" class="adv-cont-ok" id="advIgnorarContOk">Continuar con otra opción</button>' +
    '  </div>' +
    '</div>';
  document.body.appendChild(modal);
  const input = modal.querySelector("#advIgnorarContCodigo");
  const fb = modal.querySelector("#advIgnorarContFb");
  modal.querySelector("#advIgnorarContCancel").addEventListener("click", () => modal.remove());
  modal.querySelector("#advIgnorarContOk").addEventListener("click", () => {
    if (String(input.value || "").trim() !== CODIGO_LOGISTICA_IGNORAR_CONT) {
      fb.innerText = "Código incorrecto. Pedile el código a Logística."; return;
    }
    const leg = legajoKey();
    if (leg) { const s = readState(leg); s.continuacionConsultada = true; writeState(leg, s); }
    modal.remove();
    renderOptions();
    if (typeof onConfirm === "function") onConfirm();
  });
  setTimeout(() => { try { input.focus(); } catch { /* sin foco */ } }, 50);
}

// «⚡ Continuar Matriz»: la matriz de ayer queda activa (con su pieza) y el próximo C es el cajón continuado.
async function handleClickBotonContinuar(info) {
  if (!info) return;
  const leg = info.legajo;
  if (!paseVigente()) await asegurarEntrada();
  const tsActivacion = isoNow();
  const s = readState(leg);
  s.lastMatrix = { opcion: "E", texto: info.matriz, ts: tsActivacion, comp_salida_id: info.comp_salida_id, pieza: info.pieza };
  s.lastCajon = { opcion: "C", texto: info.matriz, ts: tsActivacion };
  s.matrixNeedsC = true;
  s.continuacionConsultada = true;
  s.cajonContinuado = { matriz: info.matriz, fechaAyer: info.fechaAyer, tsInicioCajon: info.tsInicioCajon,
                        segPostAyer: info.segPostAyer, tsActivacion };
  writeState(leg, s);
  // Llegada Tarde con la hora de entrada DEL OPERARIO (como el resto de la app), si llegó un minuto o más tarde.
  if (!s.lateArrivalSent && !s.lateArrivalDiscarded) {
    const ent = horaEntradaDe(leg);
    const dEnt = new Date(`${dayKeyAR()}T${ent.hhmm}:00-03:00`);
    const s2 = readState(leg);
    if (Date.parse(tsActivacion) - dEnt >= 60000) {
      s2.lateArrivalSent = true; writeState(leg, s2);
      const lt = { id: uuidv4(), legajo: leg, opcion: "LT", descripcion: "Llegada Tarde", texto: "", ts_event: tsActivacion,
                   hs_inicio: `${dayKeyAR()}T${ent.hhmm}:00-03:00`, matriz: "" };
      updateStateAfterSend(leg, lt);
      enqueue(lt);
    } else { s2.lateArrivalDiscarded = true; writeState(leg, s2); }
  }
  renderOptions();
  renderSummary();
  const av = $("avisoBotones");
  if (av) { av.textContent = `Continuando Matriz ${info.matriz}: apretá C cuando termines el cajón.`; av.classList.remove("hidden"); }
  despacharCola();
}

/* ============================================================
   ROLLOS (todos eligen en E; el alimentador cierra con CT o PR)
   ============================================================ */
/* El fleje NO depende solo de la matriz: hay matrices que cortan de dos flejes distintos
   segun la pieza. La 28 saca A15 del Fleje N° 94 (inox) y J2/J5 del Fleje N° 13; la 37
   igual con F3/F3A. Antes se devolvia UN fleje por matriz y el operario que elegia A15
   terminaba agarrando un rollo del otro fleje -> el stock se descontaba del equivocado.
   [usuario 2026-08-31] */
function flejeParaMatriz(n_matriz, comp_salida_id) {
  const n = String(n_matriz || "").trim();
  const porPieza = (D.matriz_fleje_pieza || {})[n];
  if (porPieza && comp_salida_id != null) {
    const f = porPieza[String(comp_salida_id)];
    if (f?.comp_id) return f;
  }
  return (D.matriz_fleje || {})[n] || null;   // matriz de un solo fleje, o bundle viejo
}
/* Cuantos flejes DISTINTOS corta la matriz: con mas de uno, sin pieza elegida no se
   puede saber que rollo ofrecer. */
function flejesDeMatriz(n_matriz) {
  const porPieza = (D.matriz_fleje_pieza || {})[String(n_matriz || "").trim()] || {};
  return new Set(Object.values(porPieza).map(f => f && f.comp_id).filter(Boolean)).size;
}
/* Matriz conocida que no corta de ningun fleje: no hay rollo que elegir y el cartel
   sobra (hoy son 346 de las 407 matrices; 401 Env Cucharas Inox Imp, por ejemplo).
   Con un bundle viejo, sin matriz_fleje, no se puede saber: no se oculta nada.
   [usuario 2026-10-01] */
function matrizSinFleje(n_matriz) {
  const n = String(n_matriz || "").trim();
  if (!n || !D.matricesMap?.has(n)) return false;
  if (!D.matriz_fleje && !D.matriz_fleje_pieza) return false;
  return !flejeParaMatriz(n, null) && flejesDeMatriz(n) === 0;
}
function rollosParaMatriz(n_matriz, comp_salida_id) {
  const fleje = flejeParaMatriz(n_matriz, comp_salida_id);
  if (!fleje?.comp_id) return [];
  return (D.rollos_saldo || []).filter(r => r.comp_id === fleje.comp_id && Number(r.rollos) > 0);
}
/* Sin pieza elegida en una matriz de dos flejes: se ofrecen los rollos de TODOS sus
   flejes, con el codigo a la vista, en vez de dejar al operario sin ninguno. */
function rollosDeTodosLosFlejes(n_matriz) {
  const porPieza = (D.matriz_fleje_pieza || {})[String(n_matriz || "").trim()] || {};
  const ids = new Set(Object.values(porPieza).map(f => f && f.comp_id).filter(Boolean));
  return (D.rollos_saldo || []).filter(r => ids.has(r.comp_id) && Number(r.rollos) > 0);
}

/* Los rollos los maneja la base (Fase 1c): sólo se muestran si el catálogo dice rollos_activos. Si no se puede mandar al
   momento (sin pase, sin señal), la llamada espera en su cola (FIFO, para respetar el orden tomar → cerrar) y sale con la
   fecha original. */
function rollosActivos() { return D.rollos_activos === true; }

const LS_RQUEUE = "rp3c_rqueue";
function readRolloQueue()  { try { return JSON.parse(localStorage.getItem(LS_RQUEUE) || "[]"); } catch { return []; } }
function writeRolloQueue(q) { try { localStorage.setItem(LS_RQUEUE, JSON.stringify(q || [])); } catch { /* storage lleno */ } }
function enqueueRollo(fn, args) { const rq = readRolloQueue(); rq.push({ fn, args }); writeRolloQueue(rq); }

async function llamarRollo(fn, args) {
  if (paseVigente()) {
    const { error } = await rpc(fn, args);
    if (!error) return;
    if (error.code === "28000") pasePerdido();
    else if (esRechazoDefinitivo(error)) { console.warn(fn + ":", error.message); return; }   // la base lo rechazó por los datos: no se reintenta
    else console.error(fn + ":", error);
  }
  enqueueRollo(fn, args);
}
// ANTI-DUPLICADO (Fase 1d): cada llamada lleva un id propio que viaja en la cola, así que un reintento (la base lo hizo pero la
// respuesta no llegó) repite el MISMO id y la base no descuenta otro rollo ni cierra el siguiente. v3.1.7: siempre con id (las de
// la Fase 1c sin id ya no se llaman; reg_prod_3_0_tomar_rollo se borra en la limpieza final).
async function tomarRollo(legajo, comp_id, kg_por_rollo, matriz) {
  await llamarRollo("reg_prod_3_0_rollo_tomar", { p_id: uuidv4(), p_legajo: String(legajo), p_comp_id: Number(comp_id),
    p_kg_por_rollo: Number(kg_por_rollo), p_matriz: String(matriz), p_fecha: isoNow() });
}
async function cerrarRollo(legajo, quedoResto) {
  await llamarRollo("reg_prod_3_0_rollo_cerrar", { p_id: uuidv4(), p_legajo: String(legajo), p_quedo_resto: !!quedoResto, p_fecha: isoNow() });
}

/* ============================================================
   UI helpers
   ============================================================ */
const $ = id => document.getElementById(id);
let selected = null;

// Escapar texto libre de la BD antes de meterlo en innerHTML (mismo esc que Registro_GP2)
function esc(s) { return (s == null ? "" : String(s)).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

/* EL LEGAJO VERDADERO [Elías, 09/10: «guarda su legajo verdadero» · «si hay un legajo que exista de alta al mismo tiempo con C y sin
   C que le pregunte quién es»]. El catálogo trae los operarios con su legajo real (c19 = CHEF SRL, 19 = Loekemeyer), en minúscula.
   El operario escribe el número (o con la c): si ese número es de una sola persona, es ella; si es de dos (29 y c29), «¿Quién sos?». */
let _legajoElegido = "";   // lo que eligió en «¿Quién sos?»
const numLegajo = (l) => String(l || "").trim().toLowerCase().replace(/^c/, "");
function candidatosLegajo(t) {
  const n = numLegajo(t);
  return n ? Object.keys(D.empleados || {}).filter((k) => numLegajo(k) === n) : [];
}
function legajoKey() {
  const t = String($("legajoInput").value || "").trim().toLowerCase();
  if (!t) return "";
  if (/^c/.test(t)) return t;                                  // escribió la letra: es ése
  const c = candidatosLegajo(t);
  if (c.length === 1) return c[0];                             // un solo dueño del número
  if (c.length > 1 && c.includes(_legajoElegido)) return _legajoElegido;
  return t;                                                    // nadie, o dos sin elegir todavía (goToOptions pregunta)
}
function esAlimentadorLeg() { return capsDe(legajoKey()).alimentador; }   // lo que antes era «de Eduardo» (legajo fijo)

/* ============================================================
   CAMBIAR SEDE [Elías, 09/10: «te pide confirmar en grande, sí / no; si le da que sí lo cambia a la otra sede (con opción de
   cancelar y regresa a su sede anterior con el tiempo cancelado) … en poner la TV de la otra sede inicia el contador de tiempo;
   al lograr hacer el login en la otra sede, termina»].
   Cervantes y Virgilio están en el mismo sitio y comparten el localStorage: el cambio en curso queda en LS_CAMBIO_SEDE y lo lee la
   otra app. El tiempo muerto «CS · Cambio de Sede» lo graba la sede a la que LLEGA, cuando ESE operario termina de entrar (código de
   la TV + legajo), desde que tocó «Sí» hasta ahí. «Cancelar» lo borra y no queda nada grabado.
   El legajo se compara por el número (c104 = 104): Virgilio todavía graba el número.
   Sólo en Registro Producción 3.0: la copia de la tablet de GP2 no tiene a dónde ir (el botón aparece sólo dentro de /cervantes-gp2/).
   ============================================================ */
const LS_CAMBIO_SEDE = "rp3_cambio_sede";
const hayOtraSede = () => /\/cervantes-gp2\//.test(location.pathname);
function leerCambioSede() {
  try {
    const c = JSON.parse(localStorage.getItem(LS_CAMBIO_SEDE) || "null");
    return c && c.dia === dayKeyAR() ? c : null;     // uno de otro día ya no vale
  } catch { return null; }
}
function cambioHaciaAca() {
  if (!hayOtraSede()) return null;   // la copia de la tablet de GP2 comparte el dominio (y el localStorage): ahí no hay cambio de sede
  const c = leerCambioSede();
  return c && c.hacia === "cervantes" ? c : null;
}
function borrarCambioSede() { try { localStorage.removeItem(LS_CAMBIO_SEDE); } catch { /* sin storage */ } }
function cancelarCambioSede() {
  const c = cambioHaciaAca();
  borrarCambioSede();
  location.href = c && c.desde === "virgilio" ? "../virgilio/" : "../";
}

async function cambiarSede() {
  const leg = legajoKey();
  if (!leg || !D.empleados?.[leg]) return;
  const s = readState(leg);
  if (s.matrixNeedsC) { alert("Antes de cambiar de sede cerrá el cajón con C."); return; }
  if (s.lastDowntime) { alert(`Antes de cambiar de sede cerrá «${s.lastDowntime.opcion}»: tocalo de nuevo.`); return; }
  const op = await elegirOpcion("¿Te cambiás a Virgilio?",
    [{ val: "si", label: "Sí, me voy a Virgilio" }, { val: "no", label: "No" }], true);
  if (!op || op.val !== "si") return;
  const emp = D.empleados[leg];
  try {
    localStorage.setItem(LS_CAMBIO_SEDE, JSON.stringify({
      desde: "cervantes", hacia: "virgilio", legajo: leg, nombre: (emp && emp.nombre) || "", inicio: isoNow(), dia: dayKeyAR()
    }));
  } catch { alert("No se pudo guardar el cambio en este celular."); return; }
  location.href = "../virgilio/";
}

// Llegó desde Virgilio: hay que poner el código de la TV de Cervantes (el pase que hubiera de antes no vale) y el legajo ya queda escrito.
function prepararLlegadaCambioSede() {
  const c = cambioHaciaAca();
  if (!c) return;
  if (!c.paseBorrado) {
    borrarPase();
    c.paseBorrado = true;
    try { localStorage.setItem(LS_CAMBIO_SEDE, JSON.stringify(c)); } catch { /* sin storage */ }
  }
  $("legajoInput").value = numLegajo(c.legajo);
}

// Ese operario terminó de entrar: se graba el tiempo muerto del viaje y el cambio queda cerrado.
function cerrarCambioSede(legajo) {
  const c = cambioHaciaAca();
  if (!c || numLegajo(c.legajo) !== numLegajo(legajo)) return;   // entró otro: el cambio sigue esperando a su dueño
  borrarCambioSede();
  // ya no está en Virgilio: si vuelve, que entre con el código de esa TV (y no con la sesión de hoy guardada en el celular)
  if (c.desde === "virgilio") { try { localStorage.removeItem("vir_legajo_auth"); } catch { /* sin storage */ } }
  const payload = {
    id: uuidv4(), legajo, opcion: "CS", descripcion: "Cambio de Sede",
    texto: c.desde === "virgilio" ? "desde Virgilio" : "", ts_event: isoNow(), hs_inicio: c.inicio, matriz: ""
  };
  updateStateAfterSend(legajo, payload);
  enqueue(payload);
  despacharCola();
}

function computeHsInicio(state) {
  if (state.lastCajon?.ts) return state.lastCajon.ts;
  if (state.lastMatrix?.ts) return state.lastMatrix.ts;
  return "";
}

function renderSummary() {
  const leg = legajoKey();
  const el = $("daySummary");
  if (!leg) { el.className = "history-empty"; el.innerText = "Ingresa tu legajo para ver el resumen"; return; }
  const s = readState(leg);
  if (!s.last2.length) {
    el.className = ""; el.innerHTML = '<div class="day-item"><div class="t1">Historial del día</div><div class="t2">Sin registros</div></div>';
    return;
  }
  const badge = st => {
    if (st === "sent")   return '<span style="padding:2px 8px;border-radius:999px;background:#e8fff0;color:#0b6b2c;font-weight:800;font-size:12px;">ENVIADO</span>';
    if (st === "queued") return '<span style="padding:2px 8px;border-radius:999px;background:#fff7e6;color:#8a5a00;font-weight:800;font-size:12px;">PENDIENTE</span>';
    if (st === "failed") return '<span style="padding:2px 8px;border-radius:999px;background:#ffecec;color:#9b1c1c;font-weight:800;font-size:12px;">ERROR</span>';
    return "";
  };
  el.className = "";
  // Lo ultimo arriba y lo primero abajo [usuario 2026-10-06]. last2 se guarda en orden de carga
  // (el mas viejo primero) y se invierte SOLO al dibujar: el idx del 🗑 sigue siendo el real.
  el.innerHTML = `<div class="day-item">
    <div class="t1">Historial del día (${s.last2.length})</div>
    <div class="t2" style="max-height:360px;overflow:auto;">
      ${s.last2.map((it, idx) => ({ it, idx })).reverse().map(({ it, idx }) => `
        <div style="margin-top:10px;padding-bottom:10px;border-bottom:1px solid rgba(0,0,0,.08);">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <span style="font-weight:900;font-size:34px;">${esc(it.opcion)}${it.texto && String(it.opcion || "").toUpperCase() !== "FJ" ? `: ${esc(it.texto)}` : ""}</span>
            ${badge(it.status)}
            ${String(it.opcion || "").toUpperCase() === "FJ" ? "" : `<span class="hist-btn hist-del" data-idx="${idx}" title="Eliminar">🗑</span>`}
          </div>
          ${it.ts_event ? `<div style="color:#555;">${formatDateTimeAR(it.ts_event)}</div>` : ""}
          ${it.lastError ? `<div style="color:#9b1c1c;font-size:12px;">${esc(it.lastError)}</div>` : ""}
        </div>`).join("")}
    </div>
  </div>`;

  el.querySelectorAll(".hist-del").forEach(btn => {
    btn.addEventListener("click", () => deleteHistItem(leg, parseInt(btn.dataset.idx)));
  });
}

function renderSyncBadge() {
  const q = readQueue().concat(readAnularQueue(), readRolloQueue());
  const el = $("syncBadge");
  // El badge NO muestra version [usuario 2026-08-31]: solo el estado de la cola. Toca para
  // forzar el envio. La version del cache vive en el ?v= del <script>, no a la vista.
  // Es el UNICO aviso de cola: el cartel "Pendientes en cola" se saco [usuario 2026-10-05].
  const espera = q.length > 0 && !paseVigente();
  el.innerText = espera ? `📺 ${q.length} esperan el código` : q.length ? `⚠ ${q.length} sin enviar` : `✓ al día`;
  el.style.background = q.length ? "#fff7ed" : "#f1f5f9";
  el.style.color = q.length ? "#9a3412" : "#475569";
  actualizarAvisoRed(q.length);
}

function renderMatrizInfo() {
  const el = $("matrizInfo");
  if (!selected || !["C", "CT", "RM", "PM", "RD", "PCM"].includes(selected.code)) {
    el.classList.add("hidden"); return;
  }
  const s = readState(legajoKey());
  if (!s.lastMatrix?.texto) { el.classList.add("hidden"); return; }
  const nm = s.lastMatrix.texto;
  const desc = nombreMatriz(nm);
  el.classList.remove("hidden");
  // La pieza se muestra con su etiqueta corta si la matriz la tiene; lo guardado en el estado sigue siendo el codigo.
  const piezaTxt = etiquetaDeSalida(nm, s.lastMatrix.comp_salida_id) || s.lastMatrix.pieza;
  const pieza = piezaTxt ? ` · Pieza: ${esc(piezaTxt)}` : "";
  // Rollo en uso: cuanto queda, estimado con lo producido (uni / ppk por cajon).
  // Si la tablet perdio el estado (otro dia, otro equipo o storage borrado), cae
  // al uso abierto persistido en el servidor: rollos_abiertos trae kg_usados
  // calculados de la produccion ya sincronizada.
  let rollo = "";
  const rSrv = (D.rollos_abiertos || {})[legajoKey()];
  const r = s.rollo || (rSrv ? { codigo: rSrv.codigo, kg_por_rollo: rSrv.kg_por_rollo, kg_usados: rSrv.kg_usados } : null);
  if (r?.kg_por_rollo) {
    const queda = Number(r.kg_por_rollo) - (Number(r.kg_usados) || 0);
    const fmt1 = n => (Math.round(n * 10) / 10).toLocaleString("es-AR");
    const color = queda <= Number(r.kg_por_rollo) * 0.15 ? "#b45309" : "#166534";
    rollo = `<br>🧻 Rollo de ${fmt1(r.kg_por_rollo)} kg (${esc(r.codigo || "fleje")}): ` +
            `<b style="color:${color}">quedan ~${fmt1(Math.max(0, queda))} kg</b>`;
  }
  const falta = textoFaltante(contadorDe(nm, s.lastMatrix.comp_salida_id));
  const cont = s.cajonContinuado ? `<br>⚡ Continuando el cajón de ayer (${Math.round((Number(s.cajonContinuado.segPostAyer) || 0) / 60)} min de ayer)` : "";
  el.innerHTML = `<b>Matriz activa: ${esc(nm)}</b>${desc ? ` — ${esc(desc)}` : ""}${pieza}${rollo}${cont}` +
    (falta ? `<div class="cajon-faltante">${esc(falta)}</div>` : "");
}

/* ============================================================
   LISTADO DE MATRICES (E / CM)
   ============================================================ */
function renderMatrizPicker(filtro) {
  const grid = $("matrizGrid");
  if (!grid) return;
  // El campo de arriba ("Ingresa el número") ya filtra por numero Y por nombre, asi que
  // el buscador de abajo era una segunda caja para lo mismo. Se saco. [usuario 2026-08-31]
  const elegida = String($("textInput").value || "").trim();
  const q = String(filtro != null ? filtro : elegida).trim().toLowerCase();
  // Sin nada escrito NO se muestra la lista (ni su titulo): aparece recien cuando se escribe algo. [usuario 2026-10-08:
  // "que cuando no escribi nada no aparezca nada, que recien aparezca cuando escribi algo"]
  const lbl = $("mpLabel");
  if (lbl) lbl.classList.toggle("hidden", !q);
  if (!q) { grid.innerHTML = ""; return; }
  let matrices = (D.matrices || []).filter(m => {
    if (m.act === false) return false;          // matriz dada de baja: no se ofrece
    if (!q) return true;
    return String(m.n || "").toLowerCase().includes(q) ||
           String(m.d || "").toLowerCase().includes(q);
  });
  // Si lo tipeado matchea EXACTO el numero de una matriz, mostrar SOLO esa: elegiste la 1,
  // no hace falta que sigan apareciendo la 10, 11, 112... [usuario 2026-08-31]
  const exacta = matrices.find(m => String(m.n || "").trim().toLowerCase() === q);
  if (exacta) matrices = [exacta];

  if (!matrices.length) {
    grid.innerHTML = `<div class="mz-empty">${(D.matrices || []).length ? "Sin resultados" : "Cargando matrices..."}</div>`;
    return;
  }

  grid.innerHTML = "";
  matrices.forEach(m => {
    const n = String(m.n || "").trim();
    const el = document.createElement("div");
    const esElegida = n === elegida;
    const conPieza = esElegida && piezaSel && salidasDeMatriz(n).length >= 2;
    el.className = "mz" + (esElegida ? " sel" : "") + (conPieza ? " has-chip" : "");
    el.dataset.n = n;
    const cuerpo = `<div class="mz-main"><div class="mz-n">${esc(n)}</div><div class="mz-d">${esc(m.d || "")}</div></div>`;
    const chip = conPieza ? `<div class="mz-chip">${esc(piezaSel.etiqueta || piezaSel.codigo || "")}<small>acá va el stock</small></div>` : "";
    el.innerHTML = cuerpo + chip;
    el.addEventListener("click", () => elegirMatriz(n));
    grid.appendChild(el);
  });
}

function elegirMatriz(n) {
  $("textInput").value = n;
  $("error").innerText = "";
  document.querySelectorAll("#matrizGrid .mz").forEach(x => {
    x.classList.toggle("sel", x.dataset.n === n);
  });
  renderPiezaPicker(n);
  if (selected?.code === "E") { actualizarRolloPicker(n); refrescarContador(n).catch(() => {}); }
}

/* ============================================================
   SELECTOR DE PIEZA (matrices con varias salidas)
   La pieza elegida viaja como comp_salida_id en el C para que
   el stock se sume en el componente correcto.
   ============================================================ */
let piezaSel = null; // {comp_id, codigo, descripcion, arts, etiqueta}
let rolloSel = null; // {comp_id, codigo, kg_por_rollo} — rollo elegido (antes era el value del <select>)

function salidasDeMatriz(n) {
  return (D.matriz_salidas || {})[String(n || "").trim()] || [];
}

// Etiqueta CORTA de una salida (GP2.matriz_salida_etiqueta, bundle.matriz_salidas[n][i].etiqueta): es lo UNICO que
// ve el operario al elegir la pieza [usuario 2026-10-07: "solo le aparezca esto al operario"]. Sin etiqueta
// (matriz nueva o bundle viejo cacheado en la tablet) devuelve "" y la pantalla cae a codigo + descripcion + arts.
function etiquetaDeSalida(n, compId) {
  const sa = salidasDeMatriz(n).find(x => x.comp_id === compId);
  return (sa && String(sa.etiqueta || "").trim()) || "";
}

function renderPiezaPicker(n) {
  const wrap = $("piezaPicker"), grid = $("piezaGrid");
  if (!wrap || !grid) return;
  const salidas = (selected && selected.code === "E") ? salidasDeMatriz(n) : [];
  if (salidas.length < 2) {
    piezaSel = null; wrap.classList.add("hidden"); grid.innerHTML = "";
    $("btnEnviar").disabled = false;
    return;
  }
  if (piezaSel && !salidas.some(x => x.comp_id === piezaSel.comp_id)) piezaSel = null;
  wrap.classList.remove("hidden");
  grid.innerHTML = "";

  // Ya elegida: colapsar a UNA linea (la pieza tambien queda en la card de la matriz,
  // a la derecha del numero) para achicar la pantalla. Tocar la linea vuelve a abrir.
  if (piezaSel) {
    wrap.classList.add("collapsed");
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "pieza-cambiar";
    if (piezaSel.etiqueta) {
      btn.innerHTML = `Fabricás <b>${esc(piezaSel.etiqueta)}</b> — <u>cambiar</u>`;
    } else {
      const arts = piezaSel.arts ? ` (art. ${esc(piezaSel.arts)})` : "";
      btn.innerHTML = `Fabricás <b>${esc(piezaSel.codigo || "")}</b> · ${esc(piezaSel.descripcion || "")}${arts} — <u>cambiar</u>`;
    }
    btn.addEventListener("click", () => {
      piezaSel = null;
      renderPiezaPicker(n);
      renderMatrizPicker();
      if (selected?.code === "E") actualizarRolloPicker(n);
    });
    grid.appendChild(btn);
    $("btnEnviar").disabled = false;
    return;
  }

  wrap.classList.remove("collapsed");
  salidas.forEach(sa => {
    const el = document.createElement("div");
    el.className = "mz";
    // Los articulos que usan esa pieza (la 237 saca 3 piezas para 542/543/570, 720/722 y 858):
    // el operario piensa en el articulo, no en el codigo del intermedio. [usuario 2026-10-05]
    // Con etiqueta (GP2.matriz_salida_etiqueta) la tarjeta dice SOLO eso: ni codigo, ni descripcion, ni articulos.
    if (sa.etiqueta) {
      el.classList.add("mz-et");
      el.innerHTML = `<div class="mz-n">${esc(sa.etiqueta)}</div>`;
    } else {
      const arts = sa.arts ? `<div class="mz-a">Art. ${esc(sa.arts)}</div>` : "";
      el.innerHTML = `<div class="mz-n">${esc(sa.codigo || "")}</div><div class="mz-d">${esc(sa.descripcion || "")}</div>${arts}`;
    }
    el.addEventListener("click", () => {
      piezaSel = sa; $("error").innerText = "";
      renderPiezaPicker(n);
      renderMatrizPicker();              // la card de la matriz muestra la pieza a la derecha
      // la pieza define el fleje: recien ahora se sabe que rollos ofrecer
      if (selected?.code === "E") actualizarRolloPicker(n);
    });
    grid.appendChild(el);
  });
  // Sin pieza elegida no se puede Enviar (el stock no sabria a que componente ir)
  $("btnEnviar").disabled = !piezaSel;
}

/* ============================================================
   RENDERIZAR BOTONES
   ============================================================ */
function renderOptions() {
  const leg = legajoKey();
  const st = leg ? readState(leg) : null;
  const pendiente = st?.lastDowntime || null;
  const caps = capsDe(leg);
  [1, 2, 3, 4].forEach(r => { $(`row${r}`).innerHTML = ""; });

  [...OPTIONS, CT_OPTION].forEach(opt => {
    if (!botonVisible(opt.code, caps)) return;            // cada uno ve los de SU rol (como 2.0)
    const el = document.createElement("div");
    el.className = "box" + (opt.isCT ? " ct-btn" : "");
    el.dataset.code = opt.code;
    el.innerHTML = `<div style="font-size:18px;font-weight:900;">${opt.code}</div><div style="font-size:11px;font-weight:600;color:inherit;margin-top:3px;">${opt.desc}</div>`;
    // Como 2.0: con un tiempo muerto abierto sólo se puede tocar ÉSE (los demás quedan grises: así nadie queda trabado);
    // E gris mientras falte el cajón de la matriz en curso; C / CT grises sin matriz.
    const permitido = (!pendiente || opt.code === pendiente.opcion)
      && (opt.code !== "E" || !st?.matrixNeedsC)
      && (!["C", "CT"].includes(opt.code) || !!st?.lastMatrix);
    if (!permitido) {
      el.classList.add("bloq");
      el.setAttribute("aria-disabled", "true");
    } else {
      el.addEventListener("click", () => {
        const proceder = () => {
          const s2 = readState(legajoKey());
          // CM: el 1.er toque abre el cartel «matriz nueva + balancín»; el 2.º (con el CM abierto) lo cierra por el camino normal.
          if (opt.code === "CM" && !(s2.lastDowntime && s2.lastDowntime.opcion === "CM")) { abrirCambiarMatriz(); return; }
          selectOption(opt);
        };
        // Con «Continuar Matriz» a la vista, otro botón pide el código de Logística (como 2.0).
        if (hayContinuarPendiente()) { mostrarAdvertenciaIgnorarContinuar(proceder); return; }
        proceder();
      });
    }
    $(`row${opt.row}`).appendChild(el);
  });

  // «⚡ Continuar Matriz» (cajón de ayer): entre E y C, como 2.0.
  const cont = evaluarBannerContinuar(leg);
  if (cont) {
    const b = document.createElement("div");
    b.className = "box box-cont";
    b.id = "btnContinuarMatriz";
    b.innerHTML = `<div style="font-size:18px;font-weight:900;">⚡ Continuar</div><div style="font-size:11px;font-weight:600;margin-top:3px;">Mat ${esc(cont.matriz)} — ayer ${Math.round(cont.segPostAyer / 60)} min</div>`;
    b.addEventListener("click", () => handleClickBotonContinuar(cont));
    const row1 = $("row1");
    const cBox = row1.querySelector('.box[data-code="C"]');
    if (cBox) row1.insertBefore(b, cBox); else row1.appendChild(b);
  }

  const av = $("avisoBotones");
  if (av) {
    av.textContent = pendiente
      ? `Hay un tiempo muerto abierto (${pendiente.opcion}): tocalo para cerrarlo.`
      : (st?.matrixNeedsC ? "Para iniciar una nueva matriz (E), primero terminá la cantidad de la matriz en curso (C)." : "");
  }
  mostrarBotones(true);
}

function mostrarBotones(mostrar) {
  // Las filas sin botones (por el rol) no se muestran: sin huecos.
  [1, 2, 3, 4].forEach(r => { const row = $(`row${r}`); row.classList.toggle("hidden", !mostrar || !row.childElementCount); });
  const av = $("avisoBotones");
  if (av) av.classList.toggle("hidden", !mostrar || !av.textContent);
}

function selectOption(opt) {
  selected = opt;
  document.querySelectorAll(".box.selected").forEach(x => x.classList.remove("selected"));
  const box = document.querySelector(`.box[data-code="${opt.code}"]`);
  if (box) box.classList.add("selected");
  mostrarBotones(false); // se vuelven a ver con la flecha ← de la seleccion

  $("selectedBox").innerText = opt.code;
  $("selectedDesc").innerText = opt.desc;
  $("selectedArea").classList.remove("hidden");

  const st = readState(legajoKey());
  // CM / TRM: el 2.º toque cierra el tiempo muerto con el MISMO texto (la matriz) y no pide nada (como 2.0).
  const cerrando = ["CM", "TRM"].includes(opt.code) && st.lastDowntime?.opcion === opt.code;
  const c501 = opt.code === "C" && es501(st.lastMatrix?.texto);

  const inputArea = $("inputArea");
  const textInput = $("textInput");
  textInput.inputMode = c501 ? "decimal" : "numeric";
  if (opt.needsInput && !cerrando) {
    $("inputLabel").innerText = c501 ? "Ingresá los KILOS que hiciste" : (opt.label || "Ingresa valor");
    textInput.value = "";
    inputArea.classList.remove("hidden");
    setTimeout(() => textInput.focus(), 50);
  } else {
    inputArea.classList.add("hidden");
    textInput.value = cerrando ? (st.lastDowntime.texto || "") : "";
  }

  // Listado de matrices para E
  const matrizPicker = $("matrizPicker");
  piezaSel = null;
  if (opt.code === "E") {
    matrizPicker.classList.remove("hidden");
    renderMatrizPicker("");
    renderPiezaPicker("");
  } else {
    matrizPicker.classList.add("hidden");
    renderPiezaPicker("");
  }

  // Rollo picker para E: TODOS los operarios eligen de que kilaje agarran
  // (los rollos salen de la recepcion de insumos via rollos_saldo).
  const rolloPicker = $("rolloPicker");
  if (opt.code === "E") {
    rolloPicker.classList.remove("hidden");
    rolloSel = null;
    textInput.oninput = () => {
      renderMatrizPicker();
      renderPiezaPicker(textInput.value.trim());
      actualizarRolloPicker(textInput.value.trim());
    };
    actualizarRolloPicker("");
  } else {
    rolloPicker.classList.add("hidden");
    textInput.oninput = null;
  }

  // Cajon: se anotan GOLPES (o CAJAS si la matriz es de envasado, o KILOS en la 501) y se muestra en vivo cuantas unidades salen.
  const gh = $("golpeHint");
  if (gh) {
    const nMatC = opt.code === "C" ? String(st.lastMatrix?.texto || "").trim() : "";
    const envC = opt.code === "C" ? envasadoDe(nMatC) : null;
    if (c501) {
      gh.className = "golpe-hint";
      gh.innerText = `Matriz ${nMatC}: se cargan los KILOS hechos, con coma o punto (ej: 5,6).`;
      gh.classList.remove("hidden");
    } else if (opt.code === "C" && envC) {
      // Matriz de envasado: el operario carga CAJAS.
      $("inputLabel").innerText = "¿Cuántas CAJAS armaste?";
      const apc = apcEnvase(nMatC, st.lastMatrix?.comp_salida_id) || 1;
      const pintarC = () => {
        const c = Number(textInput.value.trim()) || 0;
        gh.className = "golpe-hint";
        gh.innerText = `Matriz ${nMatC} (envasado): ${apc} unidades por caja.` + (c > 0 ? ` ${c} cajas = ${c * apc} unidades.` : "");
      };
      pintarC();
      gh.classList.remove("hidden");
      const prevC = textInput.oninput;
      textInput.oninput = (ev) => { if (prevC) prevC(ev); pintarC(); };
    } else if (opt.code === "C" && pideGolpes()) {
      const nMat = nMatC;
      const f = uniXGolpe(nMat);
      const pintar = () => {
        const g = Number(textInput.value.trim()) || 0;
        gh.className = "golpe-hint" + (f === 1 ? " x1" : "");
        gh.innerText = f === 1
          ? (nombreMatriz(nMat) ? `Matriz ${nMat}: 1 golpe = 1 unidad.` : "1 golpe = 1 unidad.")
          : `Matriz ${nMat}: cada golpe saca ${f} unidades.` + (g > 0 ? ` ${g} golpes = ${g * f} unidades.` : "");
      };
      pintar();
      gh.classList.remove("hidden");
      const prev = textInput.oninput;
      textInput.oninput = (ev) => { if (prev) prev(ev); pintar(); };
    } else {
      gh.classList.add("hidden");
      gh.innerText = "";
    }
  }

  // Alimentador: «¿quedó resto?» en PR (antes era sólo el legajo 19)
  const quedoRestoWrap = $("quedoRestoWrap");
  if (rollosActivos() && esAlimentadorLeg() && opt.code === "PR") {
    quedoRestoWrap.classList.remove("hidden");
    $("quedoRestoChk").checked = false;
  } else {
    quedoRestoWrap.classList.add("hidden");
  }

  // Contador de cajón (como 2.0): en C, «cajón completo» (no hay más material: el contador vuelve a 0) y el faltante al día.
  const ccWrap = $("cajonCompletoWrap");
  const nMatCC = String(st.lastMatrix?.texto || "").trim();
  const conContador = opt.code === "C" && !es501(nMatCC) && !!contadorDe(nMatCC, st.lastMatrix?.comp_salida_id);
  if (ccWrap) { ccWrap.classList.toggle("hidden", !conContador); $("cajonCompletoChk").checked = false; }
  if (conContador) refrescarContador(nMatCC).then((ok) => { if (ok && selected === opt) renderMatrizInfo(); }).catch(() => {});

  renderMatrizInfo();
  $("error").innerText = "";
}

function actualizarRolloPicker(n_matriz) {
  const grid = $("rolloGrid");
  if (!grid) return;
  if (!rollosActivos()) { rolloSel = null; grid.innerHTML = ""; $("rolloPicker")?.classList.add("hidden"); return; }   // sin rollos en la base
  const n = String(n_matriz || "").trim();
  const msg = (t) => { grid.innerHTML = `<div class="rl-msg">${esc(t)}</div>`; rolloSel = null; };
  // Matriz sin fleje: no hay rollo que elegir, el cartel entero se va. Se vuelve a
  // mostrar apenas se elige una matriz que si lo lleva.
  const wrap = $("rolloPicker");
  if (matrizSinFleje(n)) { rolloSel = null; grid.innerHTML = ""; wrap?.classList.add("hidden"); return; }
  wrap?.classList.remove("hidden");
  // Matriz que corta de dos flejes: hasta que no se elija la pieza no se sabe cual va,
  // y ofrecer el equivocado descuenta stock del fleje que no es. Si la pantalla va a
  // pedir la pieza (2+ salidas), se espera a que la elija; si no la va a pedir, se
  // ofrecen los rollos de los dos flejes con el codigo a la vista — nunca ninguno.
  let rollos;
  if (n && flejesDeMatriz(n) > 1 && !piezaSel) {
    if (salidasDeMatriz(n).length >= 2) { msg("Elegí primero qué pieza vas a fabricar"); return; }
    rollos = rollosDeTodosLosFlejes(n);
  } else {
    rollos = n ? rollosParaMatriz(n, piezaSel?.comp_id) : [];
  }
  if (!rollos.length) { msg(n && D.matricesMap?.has(n) ? "Sin rollos disponibles" : "Elegí una matriz"); return; }
  // si el rollo elegido ya no esta en la lista (cambio de matriz/pieza), se deselecciona
  if (rolloSel && !rollos.some(r => r.comp_id === rolloSel.comp_id && r.kg_por_rollo === rolloSel.kg_por_rollo)) rolloSel = null;
  grid.innerHTML = "";
  rollos.forEach(r => {
    const el = document.createElement("div");
    const sel = rolloSel && rolloSel.comp_id === r.comp_id && rolloSel.kg_por_rollo === r.kg_por_rollo;
    el.className = "rl" + (sel ? " sel" : "");
    el.innerHTML = `<div class="rl-kg">${esc(r.kg_por_rollo)} kg</div>` +
                   `<div class="rl-sub">${esc(r.codigo || "Fleje")} · ${esc(r.rollos)} disp.</div>`;
    el.addEventListener("click", () => {
      rolloSel = { comp_id: r.comp_id, codigo: r.codigo || "", kg_por_rollo: r.kg_por_rollo };
      actualizarRolloPicker(n);   // repinta para marcar el elegido
    });
    grid.appendChild(el);
  });
}

function resetSelection() {
  const s = readState(legajoKey());
  // Elegido el tiempo muerto que está abierto: hay que enviarlo para cerrarlo (como 2.0). Cualquier otra cosa se puede soltar.
  if (s?.lastDowntime && selected && selected.code === s.lastDowntime.opcion) return;
  selected = null;
  mostrarBotones(true);
  $("selectedArea").classList.add("hidden");
  $("btnEnviar").disabled = false;
  $("error").innerText = "";
  $("matrizInfo").classList.add("hidden");
  $("matrizPicker").classList.add("hidden");
  $("piezaPicker").classList.add("hidden");
  piezaSel = null; rolloSel = null;
  $("rolloPicker").classList.add("hidden");
  $("quedoRestoWrap").classList.add("hidden");
  $("cajonCompletoWrap")?.classList.add("hidden");
  document.querySelectorAll(".box.selected").forEach(x => x.classList.remove("selected"));
}

// Después de enviar (o de un cartel de 2.0): vuelve a la pantalla del legajo, como siempre.
function volverAInicio() {
  selected = null;
  $("selectedArea").classList.add("hidden");
  $("optionsScreen").classList.add("hidden");
  $("legajoScreen").classList.remove("hidden");
  $("matrizInfo").classList.add("hidden");
  $("error").innerText = "";
  $("btnEnviar").disabled = false;
  $("btnEnviar").innerText = "Enviar";
  document.querySelectorAll(".box.selected").forEach(x => x.classList.remove("selected"));
  renderSummary();
}
async function despacharCola() {
  try { await flushQueue(); } catch { /* queda en la cola */ }
  renderSyncBadge(); renderSummary();
}

/* ============================================================
   CATÁLOGO AL DÍA CUANDO FALTA ALGO [Elías, 08/10: «si no encuentra el legajo o la matriz, que actualice»]
   Además del refresco cada 30 min: si el legajo o la matriz no están, se vuelve a pedir el catálogo UNA vez (como mucho cada
   20 s) y se mira de nuevo. Sin pase o sin señal no hay a quién preguntar: se queda con lo guardado.
   ============================================================ */
let _refrescoPorFaltaAt = 0;
async function refrescarCatalogoSiFalta() {
  if (!paseVigente() || navigator.onLine === false) return false;
  if (Date.now() - _refrescoPorFaltaAt < 20000) return false;
  _refrescoPorFaltaAt = Date.now();
  const antes = _catalogoAt;
  try { await cargarBundle(); } catch { /* sin catálogo nuevo */ }
  return _catalogoAt !== antes;
}
// Sin catálogo (celular nuevo o caché borrado, con la base caída o sin señal) no se puede decir que un legajo o una matriz
// «no existe»: hay que decir que no hay conexión [auditoría 30/09, «Legajo no encontrado» con la base caída en 2.0; Elías 09/10: «1 si»].
const AVISO_SIN_CATALOGO = "Sin conexión: todavía no se pudo bajar la lista de legajos y matrices. Probá de nuevo en unos segundos.";
function hayCatalogo() { return !!(D.empleados && Object.keys(D.empleados).length && D.matricesMap && D.matricesMap.size); }
async function matrizConocida(n) {
  if (D.matricesMap?.has(n)) return true;
  if (await refrescarCatalogoSiFalta()) return !!D.matricesMap?.has(n);
  return false;
}

/* ============================================================
   AVISOS POR WHATSAPP, como 2.0 (Edge Function send-whatsapp): «Matriz sin Tiempo» al empezar una matriz sin tiempo
   histórico, «Paro Matriz» al abrir un PM y «Rompio Matriz» en la rotura. El legajo 0 (pruebas) no avisa a nadie
   [Elías, 08/10: «con la exclusión de no mandar si se está usando el legajo 0 (testeo)»].
   ============================================================ */
const EDGE_WA = SUPABASE_URL + "/functions/v1/send-whatsapp";
function avisarWA(legajo, problema, matriz) {
  const leg = String(legajo || "").trim();
  if (!leg || leg === "0") return;
  let plantilla = "problemas_en_matriz_reducido";
  try { plantilla = localStorage.getItem("wa_plantilla_activa") || plantilla; } catch { /* sin storage */ }
  const emp = (D.empleados || {})[leg];
  const operario = (emp && emp.nombre) || ("Legajo " + leg);
  const hora = new Date().toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });
  const desc = nombreMatriz(matriz) || "";
  const parametros = plantilla === "problema_en_matriz_completo"
    ? [problema, String(matriz || "?"), desc, operario, hora]
    : [problema, String(matriz || "?"), desc, hora];
  fetch(EDGE_WA, {
    method: "POST",
    headers: { "Authorization": "Bearer " + SUPABASE_KEY, "apikey": SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ parametros, plantilla, idioma: "es_AR" })
  }).catch((e) => console.warn("Aviso WhatsApp:", e));
}
function avisarSiMatrizSinTiempo(legajo, n) {
  const m = D.matricesMap?.get(String(n || "").trim());
  if (m && "th" in m && !(Number(m.th) > 0)) avisarWA(legajo, "Matriz sin Tiempo", n);
}

/* ============================================================
   CARTELES DE 2.0 (elegir, cantidad del cajón, matriz nueva + balancín)
   ============================================================ */
function elegirOpcion(pregunta, opciones, sinCancelar) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "rp-modal";
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:350;display:flex;align-items:center;justify-content:center;padding:16px;";
    const modal = document.createElement("div");
    modal.style.cssText = "background:#fff;border-radius:16px;padding:24px 20px;max-width:440px;width:100%;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.3);";
    const t = document.createElement("p");
    t.style.cssText = "font-size:24px;font-weight:800;margin:0 0 18px;line-height:1.25;";
    t.textContent = pregunta;
    modal.appendChild(t);
    opciones.forEach((op) => {
      const btn = document.createElement("button");
      btn.type = "button"; btn.className = "rp-op"; btn.dataset.val = op.val; btn.textContent = op.label;
      btn.style.cssText = "display:block;width:100%;padding:20px;margin-bottom:12px;border:1px solid #c9d1d9;border-radius:14px;font-size:22px;font-weight:800;background:#f8f9fa;";
      btn.onclick = () => { overlay.remove(); resolve(op); };
      modal.appendChild(btn);
    });
    if (!sinCancelar) {
      const no = document.createElement("button");
      no.type = "button"; no.className = "rp-cancelar"; no.textContent = "Cancelar";
      no.style.cssText = "display:block;width:100%;padding:12px;border:none;background:transparent;color:#64748b;font-size:17px;";
      no.onclick = () => { overlay.remove(); resolve(null); };
      modal.appendChild(no);
    }
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  });
}

// Cantidad para cerrar el cajón en la rotura: OBLIGATORIA (sin cancelar), en la unidad de esa matriz (golpes, cajas o kilos).
function pedirCantidadCajon(matriz) {
  const kilos = es501(matriz);
  const env = !kilos && envasadoDe(matriz);
  const titulo = kilos ? "KILOS hechos para cerrar el cajón"
    : env ? "CAJAS armadas para cerrar el cajón"
    : (pideGolpes() ? "GOLPES del contador para cerrar el cajón" : "Unidades hechas para cerrar el cajón");
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.id = "cantidadCajonModal";
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:350;display:flex;align-items:center;justify-content:center;padding:16px;";
    const modal = document.createElement("div");
    modal.style.cssText = "background:#fff;border-radius:16px;padding:24px 20px;max-width:440px;width:100%;text-align:center;";
    const t = document.createElement("p");
    t.style.cssText = "font-size:24px;font-weight:800;margin:0 0 16px;line-height:1.25;";
    t.textContent = titulo;
    const inp = document.createElement("input");
    inp.id = "cantidadCajonInput";
    inp.type = "text"; inp.inputMode = kilos ? "decimal" : "numeric";
    inp.placeholder = kilos ? "Ej: 5,6" : "Ej: 1500";
    inp.style.cssText = "width:100%;box-sizing:border-box;padding:16px;font-size:28px;text-align:center;border:2px solid #c9d1d9;border-radius:14px;margin-bottom:8px;";
    const err = document.createElement("div");
    err.style.cssText = "color:#dc2626;font-size:16px;min-height:20px;margin-bottom:12px;";
    const ok = document.createElement("button");
    ok.id = "cantidadCajonOk"; ok.type = "button"; ok.textContent = "Confirmar y cerrar cajón";
    ok.style.cssText = "display:block;width:100%;padding:20px;border:1px solid #1aa34a;border-radius:14px;font-size:22px;font-weight:800;background:#eafff1;color:#0b6b2c;";
    const re = kilos ? /^\d+(?:[.,]\d+)?$/ : /^\d+$/;
    const confirmar = () => {
      const v = String(inp.value || "").trim();
      if (!re.test(v)) { err.textContent = kilos ? "Número válido (coma o punto)" : "Sólo números enteros"; return; }
      overlay.remove(); resolve(v);
    };
    ok.onclick = confirmar;
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") confirmar(); });
    modal.append(t, inp, err, ok);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    setTimeout(() => { try { inp.focus(); } catch { /* sin foco */ } }, 50);
  });
}

// Cambiar Matriz: el número de la matriz nueva Y el balancín donde se coloca (los activos del catálogo). -> {matriz, balancin} | null
function pedirMatrizYBalancin() {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.id = "cmModal";
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:350;display:flex;align-items:center;justify-content:center;padding:16px;";
    const modal = document.createElement("div");
    modal.style.cssText = "background:#fff;border-radius:16px;padding:24px 20px;max-width:440px;width:100%;text-align:center;";
    const t = document.createElement("p");
    t.style.cssText = "font-size:24px;font-weight:800;margin:0 0 16px;";
    t.textContent = "Cambiar Matriz";
    const lm = document.createElement("div");
    lm.style.cssText = "font-size:18px;font-weight:700;color:#334155;text-align:left;margin-bottom:6px;";
    lm.textContent = "Matriz nueva";
    const inp = document.createElement("input");
    inp.id = "cmMatriz"; inp.type = "text"; inp.inputMode = "numeric"; inp.placeholder = "Ej: 110";
    inp.style.cssText = "width:100%;box-sizing:border-box;padding:16px;font-size:26px;text-align:center;border:2px solid #c9d1d9;border-radius:14px;margin-bottom:12px;";
    const lb = document.createElement("div");
    lb.style.cssText = lm.style.cssText;
    lb.textContent = "En qué balancín";
    const sel = document.createElement("select");
    sel.id = "cmBalancin";
    sel.style.cssText = "width:100%;box-sizing:border-box;padding:14px;font-size:20px;border:2px solid #c9d1d9;border-radius:14px;margin-bottom:8px;background:#fff;";
    const bals = D.balancines || [];
    const ph = document.createElement("option");
    ph.value = ""; ph.textContent = bals.length ? "Elegí un balancín…" : "(no hay balancines cargados)";
    sel.appendChild(ph);
    bals.forEach((b) => {
      const o = document.createElement("option");
      o.value = String(b.num);
      o.textContent = (String(b.tipo || "") === String(b.num)) ? String(b.num) : ((b.tipo || "Balancín") + " " + b.num);
      sel.appendChild(o);
    });
    const err = document.createElement("div");
    err.id = "cmError";
    err.style.cssText = "color:#dc2626;font-size:16px;min-height:20px;margin-bottom:12px;";
    const ok = document.createElement("button");
    ok.id = "cmOk"; ok.type = "button"; ok.textContent = "Enviar";
    ok.style.cssText = "display:block;width:100%;padding:20px;margin-bottom:8px;border:1px solid #1d4ed8;border-radius:14px;font-size:22px;font-weight:800;background:#eff6ff;color:#1e3a8a;";
    const no = document.createElement("button");
    no.id = "cmCancelar"; no.type = "button"; no.textContent = "Cancelar";
    no.style.cssText = "display:block;width:100%;padding:12px;border:none;background:transparent;color:#64748b;font-size:17px;";
    const confirmar = async () => {
      const m = String(inp.value || "").trim();
      if (!/^[0-9]+[A-Za-z]?$/.test(m)) { err.textContent = "Matriz: sólo números"; return; }
      if (!(await matrizConocida(m))) { err.textContent = hayCatalogo() ? "La matriz " + m + " no existe" : AVISO_SIN_CATALOGO; return; }
      if (!matrizActiva(m)) { err.textContent = "La matriz " + m + " está dada de baja"; return; }
      const b = String(sel.value || "").trim();
      if (!b) { err.textContent = "Elegí el balancín"; return; }
      overlay.remove(); resolve({ matriz: m, balancin: b });
    };
    ok.onclick = confirmar;
    no.onclick = () => { overlay.remove(); resolve(null); };
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") confirmar(); });
    modal.append(t, lm, inp, lb, sel, err, ok, no);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    setTimeout(() => { try { inp.focus(); } catch { /* sin foco */ } }, 50);
  });
}

/* Balancín: misma lógica que 2.0 (public.asignar_matriz_balancin: libera la matriz de otro balancín y la pone en éste), con el pase.
   Sin señal o sin pase espera en su cola y sale en flushQueue. */
const LS_BQUEUE = "rp3c_balq";
function readBalancinQueue()  { try { return JSON.parse(localStorage.getItem(LS_BQUEUE) || "[]"); } catch { return []; } }
function writeBalancinQueue(q) { try { localStorage.setItem(LS_BQUEUE, JSON.stringify(q || [])); } catch { /* storage lleno */ } }
function asignarMatrizBalancin(balancin, matriz) {
  const q = readBalancinQueue();
  q.push({ p_balancin: String(balancin), p_matriz: String(matriz) });
  writeBalancinQueue(q);
}

/* ============================================================
   RECORRIDOS DE 2.0: Cambiar Matriz, Rotura Matriz, Pare Consulta Matriz, cajón de alimentador
   ============================================================ */
// CM (apertura): cartel matriz nueva + balancín → balancín asignado → CM abierto (tiempo muerto; se cierra tocando CM otra vez).
async function abrirCambiarMatriz() {
  const legajo = legajoKey();
  const res = await pedirMatrizYBalancin();
  if (!res) {
    const s = readState(legajo);
    if (s.pendingRM) { s.pendingRM = null; writeState(legajo, s); }   // canceló: termina el recorrido de rotura
    volverAInicio();
    return;
  }
  maybeSendLateArrival(legajo);
  asignarMatrizBalancin(res.balancin, res.matriz);
  const p = {
    id: uuidv4(), legajo, opcion: "CM", descripcion: "Cambiar Matriz",
    texto: res.matriz, ts_event: isoNow(), hs_inicio: "", matriz: "", balancin: res.balancin
  };
  updateStateAfterSend(legajo, p);
  enqueue(p);
  const s2 = readState(legajo);
  if (s2.pendingRM) { s2.pendingRM = null; writeState(legajo, s2); }
  volverAInicio();
  await despacharCola();
}

// Matriz de alimentador (tipo 'A'), al cerrar un cajón o en la rotura: «Continuar Produciendo» o «Cambiar Matriz».
async function popupAlimentadorCajon(legajo, opts) {
  const desdeRotura = !!(opts && opts.desdeRotura);
  const el = await elegirOpcion(desdeRotura ? "Rotura registrada. ¿Qué querés hacer?" : "Cajón cerrado. ¿Qué querés hacer?", [
    { label: desdeRotura ? "No cambiar matriz" : "Continuar Produciendo", val: "SEGUIR" },
    { label: "Cambiar Matriz", val: "CM" }
  ], true);
  if (el && el.val === "CM") { await abrirCambiarMatriz(); return; }
  if (desdeRotura) {
    const s = readState(legajo);
    if (s.pendingRM) { s.pendingRM = null; writeState(legajo, s); }
  }
  volverAInicio();
}

// RM: no es tiempo muerto. Pide la cantidad (obligatoria) → cierra el cajón → marca la rotura (+ WhatsApp) → Cambiar Matriz (si
// tiene permiso). Si se recarga a mitad, se retoma (state.pendingRM), como 2.0.
async function ejecutarFlujoRM(legajo) {
  const s0 = readState(legajo);
  const matriz = s0.lastMatrix?.texto || "";
  if (!matriz) { alert('Primero enviá "E (Empecé Matriz)" para registrar una matriz.'); return; }
  s0.pendingRM = { matriz, cajonHecho: false };
  writeState(legajo, s0);
  await pasoCantidadYCajonRM(legajo);
}
async function pasoCantidadYCajonRM(legajo) {
  const s = readState(legajo);
  const matriz = s.lastMatrix?.texto || s.pendingRM?.matriz || "";
  if (!matriz) { volverAInicio(); return; }
  const cant = await pedirCantidadCajon(matriz);
  maybeSendLateArrival(legajo);
  const cajon = {
    id: uuidv4(), legajo, opcion: "C", descripcion: "Cajon",
    texto: es501(matriz) ? normalizarComa(cant) : cant, ts_event: isoNow(),
    hs_inicio: computeHsInicio(s) || (s.last2[0]?.ts_event || ""), matriz
  };
  if (s.lastMatrix?.comp_salida_id) { cajon.comp_salida_id = s.lastMatrix.comp_salida_id; cajon.pieza = s.lastMatrix.pieza || ""; }
  if (s.cajonContinuado) cajon.cajon_continuado = { ...s.cajonContinuado };
  updateStateAfterSend(legajo, cajon);
  enqueue(cajon);
  contadorOptimista(cajon);
  const ts = isoNow();
  const rm = { id: uuidv4(), legajo, opcion: "RM", descripcion: "Rotura Matriz", texto: "", ts_event: ts, hs_inicio: ts, matriz };
  updateStateAfterSend(legajo, rm);
  enqueue(rm);
  avisarWA(legajo, "Rompio Matriz", matriz);
  const s2 = readState(legajo);
  if (s2.pendingRM) { s2.pendingRM.cajonHecho = true; writeState(legajo, s2); }
  renderSummary();
  despacharCola();
  await finalizarFlujoRM(legajo);
}
async function finalizarFlujoRM(legajo) {
  if (puedeCM(legajo)) {
    const s0 = readState(legajo);
    const rota = s0.pendingRM?.matriz || s0.lastMatrix?.texto || "";
    if (esMatrizAlimentador(rota)) { await popupAlimentadorCajon(legajo, { desdeRotura: true }); return; }
    await abrirCambiarMatriz();
    return;
  }
  const s = readState(legajo);
  if (s.pendingRM) { s.pendingRM = null; writeState(legajo, s); }
  volverAInicio();
}
async function resumirFlujoRMSiHace(legajo) {
  const s = readState(legajo);
  if (!s.pendingRM) return false;
  if (!s.pendingRM.cajonHecho) await pasoCantidadYCajonRM(legajo);
  else await finalizarFlujoRM(legajo);
  return true;
}

// PCM: al cerrarla (2.º toque) pregunta si la matriz se rompió. Rota → cierra la PCM y sigue con la rotura; no rota → sólo la cierra.
function cerrarPCM(legajo) {
  const s = readState(legajo);
  const dt = s.lastDowntime;
  const cierre = {
    id: uuidv4(), legajo, opcion: "PCM", descripcion: "Pare Consulta Matriz",
    texto: "", ts_event: isoNow(), hs_inicio: (dt && dt.opcion === "PCM") ? (dt.ts || "") : "", matriz: ""
  };
  updateStateAfterSend(legajo, cierre);
  enqueue(cierre);
  renderSummary();
}
async function manejarCierrePCM(legajo) {
  const el = await elegirOpcion("¿La matriz se rompió?", [
    { label: "Matriz Rota (RM)", val: "RM" },
    { label: "Matriz no Rota (continúa)", val: "NO" }
  ]);
  if (!el) return;                       // canceló: la PCM sigue abierta
  cerrarPCM(legajo);
  if (el.val !== "RM") { volverAInicio(); await despacharCola(); return; }
  await ejecutarFlujoRM(legajo);
}

/* ============================================================
   ENVIAR
   ============================================================ */
async function sendFast() {
  if (!selected) return;
  const legajo = legajoKey();
  if (!legajo) { alert("Ingresa el número de legajo"); return; }

  maybeSendLateArrival(legajo);

  let texto = String($("textInput").value || "").trim();
  const s = readState(legajo);

  // RM no es un envío normal ni un tiempo muerto: su recorrido (como 2.0).
  if (selected.code === "RM") { await ejecutarFlujoRM(legajo); return; }
  // PCM: el 2.º toque pregunta si la matriz se rompió.
  if (selected.code === "PCM" && s.lastDowntime?.opcion === "PCM") { await manejarCierrePCM(legajo); return; }

  const cerrando = !!(s.lastDowntime && s.lastDowntime.opcion === selected.code);
  if (cerrando && ["CM", "TRM"].includes(selected.code)) texto = s.lastDowntime.texto || "";
  const c501 = selected.code === "C" && es501(s.lastMatrix?.texto);

  // Validaciones
  if (selected.needsInput && !cerrando) {
    const ok = c501 ? /^\d+(?:[.,]\d+)?$/.test(texto) : !!selected.validate?.test(texto);
    if (!ok) { $("error").innerText = c501 ? "Matriz 501: kilos con coma o punto (ej: 5,6)" : "Solo se permiten números"; return; }
  }

  if (selected.code === "E") {
    if (s.matrixNeedsC) {
      alert('Antes de iniciar una nueva matriz (E), enviá al menos 1 Cajón (C).'); return;
    }
    if (!(await matrizConocida(texto))) {
      alert(hayCatalogo() ? `La matriz ${texto} no existe. Verifica el número.` : AVISO_SIN_CATALOGO); return;
    }
    if (!matrizActiva(texto)) {
      alert(`La matriz ${texto} está dada de baja, no se usa más.`); return;
    }
  }
  if (selected.code === "TRM" && !cerrando && !(await matrizConocida(texto))) {
    alert(hayCatalogo() ? `La matriz ${texto} no existe.` : AVISO_SIN_CATALOGO); return;
  }
  if (selected.code === "E" && salidasDeMatriz(texto).length > 1 && !piezaSel) {
    $("error").innerText = "Esta matriz hace varias piezas. Elegí cuál vas a fabricar.";
    return;
  }
  if (["C", "CT", "PM", "RD", "PCM"].includes(selected.code)) {
    if (!s.lastMatrix?.texto) {
      alert('Primero enviá "E (Empecé Matriz)" para registrar una matriz.'); return;
    }
  }
  if (s.lastDowntime && !sameDowntime(s.lastDowntime, { opcion: selected.code, texto })) {
    alert(`Hay un Tiempo Muerto pendiente (${s.lastDowntime.opcion}). Enviá el MISMO para cerrarlo.`);
    return;
  }
  // Terminar cajon (C) NO pide confirmacion al Enviar [usuario 2026-10-06]. La cuenta (golpes x
  // factor / cajas x unidades) ya se ve en pantalla en el aviso #golpeHint mientras se tipea.

  // Rollo elegido en E (cualquier operario): ahora sale de un boton, no de un <select>
  let rolloInfo = null;
  if (selected.code === "E" && rolloSel) rolloInfo = rolloSel;

  const tsEvent = isoNow();
  const payload = {
    id: uuidv4(), legajo, opcion: selected.code, descripcion: selected.desc,
    texto: c501 ? normalizarComa(texto) : texto, ts_event: tsEvent, hs_inicio: "", matriz: ""
  };

  if (payload.opcion === "E" && piezaSel) {
    payload.comp_salida_id = piezaSel.comp_id;
    payload.pieza = piezaSel.codigo || "";
  }
  if (payload.opcion === "E" && rolloInfo) {
    payload.rollo = rolloInfo;   // {comp_id, codigo, kg_por_rollo} -> queda en el estado
  }
  if (["C", "CT", "PM", "RD"].includes(payload.opcion)) {
    payload.matriz = s.lastMatrix?.texto || "";
    if (["C", "CT"].includes(payload.opcion) && s.lastMatrix?.comp_salida_id) {
      payload.comp_salida_id = s.lastMatrix.comp_salida_id;
      payload.pieza = s.lastMatrix.pieza || "";
    }
  }
  if (payload.opcion === "C" || payload.opcion === "CT") {
    payload.hs_inicio = computeHsInicio(s) || (s.last2[0]?.ts_event || "");
  }
  if (payload.opcion === "C") {
    if ($("cajonCompletoChk")?.checked && !$("cajonCompletoWrap")?.classList.contains("hidden")) payload.cajon_completo = true;
    // Cajón continuado de ayer: el inicio es el «Continuar» de hoy (los tiempos muertos que se descuentan son los de hoy) y la
    // base recibe los segundos de ayer aparte (cajon_continuado), como 2.0.
    if (s.cajonContinuado) payload.cajon_continuado = { ...s.cajonContinuado };
  }
  if (payload.opcion === "RD") payload.hs_inicio = tsEvent;          // puntual
  if (cerrando) payload.hs_inicio = s.lastDowntime.ts || "";          // cierre de tiempo muerto: se mide desde que se abrió

  if (payload.opcion === "E") avisarSiMatrizSinTiempo(legajo, texto);
  if (payload.opcion === "PM" && !cerrando) avisarWA(legajo, "Paro Matriz", payload.matriz);

  $("btnEnviar").disabled = true;
  $("btnEnviar").innerText = "Enviando...";

  // Tomar rollo: cualquier operario que eligio uno en E lo descuenta del stock.
  if (selected.code === "E" && rolloInfo) {
    await tomarRollo(legajo, rolloInfo.comp_id, rolloInfo.kg_por_rollo, texto);
  }
  // Cerrar rollo: el alimentador, con CT o con PR «¿quedó resto?» (antes era sólo el legajo 19)
  if (esAlimentadorLeg() && rollosActivos()) {
    if (selected.code === "CT") {
      await cerrarRollo(legajo, false);
    }
    if (selected.code === "PR") {
      const quedoResto = !!$("quedoRestoChk")?.checked;
      await cerrarRollo(legajo, quedoResto);
    }
  }

  updateStateAfterSend(legajo, payload);
  enqueue(payload);
  contadorOptimista(payload);
  renderSummary();

  // Matriz de alimentador (tipo 'A'): al cerrar un cajón pregunta «Continuar Produciendo / Cambiar Matriz» (como 2.0).
  if (payload.opcion === "C" && esMatrizAlimentador(payload.matriz) && puedeCM(legajo)) {
    volverAInicio();
    despacharCola();
    await popupAlimentadorCajon(legajo, { desdeRotura: false });
    return;
  }

  volverAInicio();
  $("btnEnviar").disabled = true;
  $("btnEnviar").innerText = "Enviando...";
  try {
    await despacharCola();
  } finally {
    $("btnEnviar").disabled = false;
    $("btnEnviar").innerText = "Enviar";
  }
}

/* ============================================================
   ELIMINAR ITEM DEL HISTORIAL
   ============================================================ */
async function deleteHistItem(legajo, idx) {
  if (!confirm("¿Eliminar este registro?")) return;
  const s = readState(legajo);
  const item = s.last2[idx];
  if (!item) return;
  const op = String(item.opcion || "").toUpperCase();
  if (op === "FJ") return;   // el fin de jornada no se borra (se pisa con uno nuevo)

  // Baja logica en la base (si ya se habia enviado). Va por RPC: con RLS activo
  // la clave anon ya no puede tocar la tabla produccion directo.
  if (item.id && item.status !== "sent" && flushing) {
    // Estaba saliendo justo ahora: puede llegar a la base aunque aca figure pendiente. La baja va a la cola y
    // sale DESPUES del alta (flushQueue manda primero los eventos).
    enqueueAnular(item.id);
  } else if (item.id && item.status === "sent") {
    const { error } = await rpc("reg_prod_3_0_anular_evento", { p_id_ejecucion: item.id });
    if (error) {
      console.warn("No se pudo marcar eliminado:", error);
      if (error.code === "28000") pasePerdido();          // sin pase: la baja espera en la cola y sale al ingresar el código
      else if (esRechazoDefinitivo(error)) {
        // La base lo rechazo por el dato: NO borrarlo localmente (quedaria vivo en la BD mientras aca figura eliminado).
        alert("No se pudo eliminar en el servidor: " + (error.message || error.code));
        return;
      }
      enqueueAnular(item.id);                             // sin señal o sin pase: sale sola, una vez, después de los eventos
    }
  }

  s.last2.splice(idx, 1);
  if (op === "E") {
    if (s.lastMatrix?.texto === (item.texto || "")) { s.lastMatrix = null; s.matrixNeedsC = false; }
  } else if (op === "C" || op === "CT") {
    // Reconstruir con el ULTIMO C/CT que quedo DESPUES del E de la matriz activa
    // (con su ts: computeHsInicio lo necesita para no contar el dia entero de nuevo).
    const ops = s.last2.map(x => String(x.opcion || "").toUpperCase());
    const iE = ops.lastIndexOf("E");
    let ult = null;
    for (let i = s.last2.length - 1; i > iE; i--) {
      if (ops[i] === "C" || ops[i] === "CT") { ult = s.last2[i]; break; }
    }
    s.lastCajon = ult ? { opcion: ult.opcion, texto: ult.texto || "", ts: ult.ts_event } : null;
    s.matrixNeedsC = !!s.lastMatrix && !ult;
  }
  writeState(legajo, s);

  const q = readQueue().filter(x => x.id !== item.id);
  writeQueue(q);
  if (typeof espejarColaSW === "function") espejarColaSW();

  renderSummary();
  renderSyncBadge();
}

/* ============================================================
   TERMINAR DÍA, como 2.0 [Elías, 08/10: «8: usar el de Reg Prod y que envíe todo el día como respaldo» · «18: como en 2.0»]
   · resumen del día; si ya lo cerró, avisa que el nuevo REEMPLAZA al anterior (id fijo fj_<legajo>_<día>: la base lo pisa,
     fase 2c), y el FJ no se puede borrar;
   · un tiempo muerto abierto se cierra solo;
   · matriz con contador de cajón: «¿Hiciste un último cajón?» (Sí: cantidad + «cajón completo» · No: qué estuvo haciendo, como
     tiempo muerto desde el fin del último cajón) y termina en un solo paso;
   · otra matriz sin cajón: «¿Vas a seguir mañana?» (Sí: mañana aparece «⚡ Continuar» · No: la cantidad O un tiempo muerto);
   · el FJ lleva en el texto el día entero ({counts, events}) y después se reenvía el día en segundo plano, por si se perdió algún
     mensaje (la base no duplica: cada toque tiene su id).
   ============================================================ */
const DESC_EXTRA = { LT: "Llegada Tarde", FJ: "Fin de Jornada", CT: "Cajon Termine" };
function descDe(code) { return (OPTIONS.find(o => o.code === code) || {}).desc || DESC_EXTRA[code] || ""; }
function resumenDelDia(legajo) {
  const counts = {};
  let total = 0;
  for (const it of readState(legajo).last2) {
    if (String(it.opcion || "").toUpperCase() === "FJ") continue;
    counts[it.opcion] = (counts[it.opcion] || 0) + 1;
    total++;
  }
  return { total, counts };
}
// Los tiempos muertos que se pueden cargar al cerrar el día: los del rol del operario (sin CM ni TRM, que piden una matriz).
function opcionesTM(legajo) {
  const caps = capsDe(legajo);
  return OPTIONS.filter(o => isDowntime(o.code) && !["CM", "TRM"].includes(o.code) && botonVisible(o.code, caps));
}
// La cantidad del cajón en la unidad de esa matriz (la misma que pide el botón C).
function unidadCajon(matriz) {
  if (es501(matriz)) return { txt: "KILOS hechos", re: /^\d+(?:[.,]\d+)?$/, im: "decimal", err: "Kilos: un número con coma o punto (ej: 5,6)." };
  if (envasadoDe(matriz)) return { txt: "CAJAS armadas", re: /^\d+$/, im: "numeric", err: "Sólo números enteros." };
  return { txt: pideGolpes() ? "GOLPES del contador" : "Unidades hechas", re: /^\d+$/, im: "numeric", err: "Sólo números enteros." };
}
function inicioDesdeUltimoCajon(s) {
  const tsLM = s.lastMatrix?.ts || "", tsLC = s.lastCajon?.ts || "";
  return (tsLC && tsLC > tsLM) ? tsLC : tsLM;
}
// El tiempo muerto abierto se cierra solo al terminar el día (como 2.0). Va ANTES de cargar el último cajón: el C limpia el tiempo
// muerto abierto del estado y quedaba sin cerrar (en 2.0 pasa: el «Sí, hice un último cajón» pierde el tiempo muerto abierto).
function cerrarTMAbiertoTD(legajo) {
  const s0 = readState(legajo);
  const ld = s0.lastDowntime;
  if (!ld) return;
  const cierre = { id: uuidv4(), legajo, opcion: ld.opcion, descripcion: descDe(ld.opcion), texto: ld.texto || "",
                   ts_event: isoNow(), hs_inicio: ld.ts || "", matriz: ld.opcion === "PM" ? (s0.lastMatrix?.texto || "") : "" };
  updateStateAfterSend(legajo, cierre);
  enqueue(cierre);
}
// Carga lo que faltaba al cerrar el día: el último cajón (C) o el tiempo muerto desde el fin del último cajón. -> texto para mostrar
function cargarCierreTD(legajo, tipo, valor, completo) {
  cerrarTMAbiertoTD(legajo);
  const s = readState(legajo);
  const lm = s.lastMatrix;
  const ini = inicioDesdeUltimoCajon(s);
  const ahora = isoNow();
  if (tipo === "C") {
    const p = { id: uuidv4(), legajo, opcion: "C", descripcion: "Cajon", texto: es501(lm.texto) ? normalizarComa(valor) : valor,
                ts_event: ahora, hs_inicio: ini, matriz: lm.texto };
    if (lm.comp_salida_id) { p.comp_salida_id = lm.comp_salida_id; p.pieza = lm.pieza || ""; }
    if (completo) p.cajon_completo = true;
    if (s.cajonContinuado) p.cajon_continuado = { ...s.cajonContinuado };
    updateStateAfterSend(legajo, p);
    enqueue(p);
    contadorOptimista(p);
    return `Último cajón: ${p.texto} ${unidadCajon(lm.texto).txt.split(" ")[0].toLowerCase()} (Matriz ${lm.texto})${completo ? " — completo" : ""}`;
  }
  // Tiempo muerto ya cerrado (inicio y fin): va al historial sin dejar nada abierto.
  const p = { id: uuidv4(), legajo, opcion: tipo, descripcion: descDe(tipo), texto: "", ts_event: ahora, hs_inicio: ini,
              matriz: tipo === "PM" ? lm.texto : "" };
  const s2 = readState(legajo);
  s2.last2.push({ ...p, status: "queued" });
  writeState(legajo, s2);
  enqueue(p);
  return `Tiempo Muerto: ${descDe(tipo) || tipo}`;
}
function avisoTD(id, txt, ok) {
  const e = $(id);
  if (e) { e.style.color = ok ? "#15803d" : "#b91c1c"; e.innerText = txt || ""; }
}

function openTerminarDia() {
  const legajo = legajoKey();
  if (!legajo) { alert("Falta el número de legajo"); return; }
  const s = readState(legajo);
  const res = resumenDelDia(legajo);
  let html = "";
  if (s.last2.some(it => String(it.opcion || "").toUpperCase() === "FJ")) {
    html += '<div class="td-fj-warn"><b>⚠ Ya cerraste el día hoy.</b><br>Si confirmás, se reemplaza el reporte anterior.</div>';
  }
  html += `<div class="td-section"><div><b>Legajo:</b> ${esc(legajo)}</div><div><b>Eventos hoy:</b> ${res.total}</div>`;
  const ops = Object.keys(res.counts).sort((a, b) => res.counts[b] - res.counts[a]);
  html += ops.length
    ? "<ul>" + ops.map(op => `<li><b>${esc(op)}</b>${descDe(op) ? " — " + esc(descDe(op)) : ""}: ${res.counts[op]}</li>`).join("") + "</ul>"
    : '<div style="color:#64748b;">Sin reportes hoy.</div>';
  html += "</div>";
  if (s.lastDowntime) {
    const ld = s.lastDowntime;
    html += `<div class="td-warn-tm"><div class="td-warn-tm-title">⛔ Tiempo Muerto abierto</div>` +
            `<div>Se cierra automáticamente: <b>${esc(ld.opcion)}</b>${descDe(ld.opcion) ? " — " + esc(descDe(ld.opcion)) : ""}${ld.texto ? ` (${esc(ld.texto)})` : ""}</div></div>`;
  }

  const matriz = String(s.lastMatrix?.texto || "").trim();
  const usarUltimo = !!(matriz && !es501(matriz) && contadorDe(matriz, s.lastMatrix?.comp_salida_id));
  const yaCargo = !!(s.tdCargaPreviaListo && s.tdCargaPreviaInfo);
  const cant = matriz ? unidadCajon(matriz) : null;
  const optsTM = opcionesTM(legajo).map(o => `<option value="${esc(o.code)}">${esc(o.code)} — ${esc(o.desc)}</option>`).join("");
  const matTxt = matriz ? `Matriz <b>${esc(matriz)}</b>${nombreMatriz(matriz) ? " — " + esc(nombreMatriz(matriz)) : ""}` : "";
  let modo = "simple";
  if (usarUltimo) {
    modo = "ultimo";
    if (yaCargo) {
      html += `<div class="td-cont-pregunta"><div class="td-cont-title">✓ Ya cargaste el cierre</div>` +
              `<div class="td-cont-ok">${esc(s.tdCargaPreviaInfo.texto || "")}</div>` +
              `<button type="button" id="btnUltFinalizar" class="td-confirm-btn">Finalizar día</button></div>`;
    } else {
      const falta = textoFaltante(contadorDe(matriz, s.lastMatrix?.comp_salida_id));
      html += `<div class="td-cont-pregunta" id="tdUltBox">
        <div class="td-cont-title">¿Hiciste un último cajón?</div>
        <div class="td-cont-mat">${matTxt}${falta ? `<br><small>${esc(falta)}</small>` : ""}</div>
        <div class="td-cont-btns"><button type="button" id="btnUltSi" class="td-cont-btn-si">Sí</button><button type="button" id="btnUltNo" class="td-cont-btn-no">No</button></div>
        <div class="td-cont-no-form hidden" id="tdUltSiForm">
          <div class="td-cont-no-row"><label for="tdUltUni">${esc(cant.txt)} en ese último cajón:</label><input type="text" id="tdUltUni" inputmode="${cant.im}" autocomplete="off"></div>
          <div class="td-cont-no-row"><label class="td-chk"><input type="checkbox" id="tdUltCompleto"> Cajón completo (no hay más material: el contador vuelve a 0)</label></div>
          <button type="button" id="btnUltSiCargar" class="td-cont-no-cargar">Cargar y finalizar día</button>
        </div>
        <div class="td-cont-no-form hidden" id="tdUltNoForm">
          <div class="td-cont-no-title">¿Qué estuviste haciendo en ese tiempo?</div>
          <div class="td-cont-no-row"><select id="tdUltNoTM"><option value="">-- elegí --</option>${optsTM}</select></div>
          <button type="button" id="btnUltNoCargar" class="td-cont-no-cargar">Cargar y finalizar día</button>
        </div>
        <div class="td-cont-no-feedback" id="tdUltFb"></div>
      </div>`;
    }
  } else if (matriz && s.matrixNeedsC) {
    modo = "seguir";
    if (yaCargo) {
      html += `<div class="td-cont-pregunta"><div class="td-cont-title">✓ Ya cargaste lo que faltaba</div>` +
              `<div class="td-cont-ok">${esc(s.tdCargaPreviaInfo.texto || "")}</div><div>Apretá <b>Sí, terminar día</b> para finalizar.</div></div>`;
    } else {
      html += `<div class="td-cont-pregunta" id="tdContPregunta">
        <div class="td-cont-title">¿Vas a seguir mañana con esta matriz?</div>
        <div class="td-cont-mat">${matTxt}</div>
        <div class="td-cont-btns"><button type="button" id="btnContSi" class="td-cont-btn-si">Sí, sigo mañana</button><button type="button" id="btnContNo" class="td-cont-btn-no">No</button></div>
        <div class="td-cont-feedback" id="tdContFeedback"></div>
      </div>
      <div class="td-cont-no-form hidden" id="tdContNoForm">
        <div class="td-cont-no-title">Antes de terminar, completá lo que falta (una sola cosa):</div>
        <div class="td-cont-no-row"><label for="tdContNoUni">${esc(cant.txt)} del cajón (Matriz ${esc(matriz)}):</label><input type="text" id="tdContNoUni" inputmode="${cant.im}" autocomplete="off" placeholder="o vacío si fue tiempo muerto"></div>
        <div class="td-cont-no-row"><label for="tdContNoTM">O un Tiempo Muerto:</label><select id="tdContNoTM"><option value="">-- ninguno --</option>${optsTM}</select></div>
        <button type="button" id="btnContNoCargar" class="td-cont-no-cargar">Cargar y habilitar Terminar Día</button>
        <div class="td-cont-no-feedback" id="tdContNoFeedback"></div>
      </div>`;
    }
  }

  $("terminarDiaContent").innerHTML = html;
  const btn = $("btnConfirmTD");
  btn.textContent = "Sí, terminar día";
  btn.style.display = modo === "ultimo" ? "none" : "";          // el último cajón tiene su propio botón (cargar y finalizar)
  btn.disabled = modo === "seguir" && !(s.terminoConContinuacion || s.tdCargaPreviaListo);

  if (modo === "ultimo") {
    const cerrarConCarga = (tipo, v, completo) => {
      ["btnUltSiCargar", "btnUltNoCargar"].forEach(id => { if ($(id)) $(id).disabled = true; });
      const s0 = readState(legajo);
      if (!s0.tdCargaPreviaListo) {
        const info = cargarCierreTD(legajo, tipo, v, completo);
        const s2 = readState(legajo);
        s2.tdCargaPreviaListo = true; s2.tdCargaPreviaInfo = { tipo, texto: info };
        writeState(legajo, s2);
      }
      avisoTD("tdUltFb", "Finalizando día…", true);
      confirmarTerminarDia();
    };
    $("btnUltSi")?.addEventListener("click", () => {
      $("tdUltSiForm").classList.remove("hidden"); $("tdUltNoForm").classList.add("hidden"); avisoTD("tdUltFb", "");
      setTimeout(() => { try { $("tdUltUni").focus(); } catch { /* sin foco */ } }, 50);
    });
    $("btnUltNo")?.addEventListener("click", () => {
      $("tdUltNoForm").classList.remove("hidden"); $("tdUltSiForm").classList.add("hidden"); avisoTD("tdUltFb", "");
    });
    $("btnUltSiCargar")?.addEventListener("click", () => {
      const v = String($("tdUltUni").value || "").trim();
      if (!cant.re.test(v)) { avisoTD("tdUltFb", cant.err); return; }
      cerrarConCarga("C", v, !!$("tdUltCompleto").checked);
    });
    $("btnUltNoCargar")?.addEventListener("click", () => {
      const tm = String($("tdUltNoTM").value || "");
      if (!tm) { avisoTD("tdUltFb", "Elegí qué estuviste haciendo."); return; }
      cerrarConCarga(tm, "", false);
    });
    $("btnUltFinalizar")?.addEventListener("click", () => confirmarTerminarDia());
  } else if (modo === "seguir") {
    $("btnContSi")?.addEventListener("click", () => {
      const s2 = readState(legajo); s2.terminoConContinuacion = true; writeState(legajo, s2);
      avisoTD("tdContFeedback", "OK. Mañana al entrar va a aparecer el botón «⚡ Continuar».", true);
      $("btnContSi").disabled = true; $("btnContNo").disabled = true; $("tdContNoForm").classList.add("hidden");
      $("btnConfirmTD").disabled = false;
    });
    $("btnContNo")?.addEventListener("click", () => {
      const s2 = readState(legajo); s2.terminoConContinuacion = false; writeState(legajo, s2);
      avisoTD("tdContFeedback", "Cargá abajo lo que faltaba antes de terminar.");
      $("btnContSi").disabled = true; $("btnContNo").disabled = true; $("tdContNoForm").classList.remove("hidden");
    });
    $("btnContNoCargar")?.addEventListener("click", () => {
      if (readState(legajo).tdCargaPreviaListo) { avisoTD("tdContNoFeedback", "Ya cargaste un evento. Apretá Terminar Día o Cancelá."); return; }
      const v = String($("tdContNoUni").value || "").trim(), tm = String($("tdContNoTM").value || "");
      if (!v && !tm) { avisoTD("tdContNoFeedback", "Cargá la cantidad o elegí un tiempo muerto (uno solo)."); return; }
      if (v && tm) { avisoTD("tdContNoFeedback", "Cargá UNA sola opción: cantidad O tiempo muerto, no las dos."); return; }
      if (v && !cant.re.test(v)) { avisoTD("tdContNoFeedback", cant.err); return; }
      const info = cargarCierreTD(legajo, v ? "C" : tm, v, false);
      const s2 = readState(legajo);
      s2.tdCargaPreviaListo = true; s2.tdCargaPreviaInfo = { tipo: v ? "C" : tm, texto: info };
      writeState(legajo, s2);
      avisoTD("tdContNoFeedback", "OK. Ya podés apretar Terminar Día.", true);
      $("btnContNoCargar").disabled = true;
      $("btnConfirmTD").disabled = false;
      renderSummary();
    });
  }
  $("terminarDiaModal").classList.remove("hidden");
}

// El día entero otra vez, en segundo plano (después del FJ), por si se perdió algún mensaje. La base no duplica (cada toque tiene su
// id); lo que está en la cola lo manda flushQueue y lo rechazado por los datos no se repite.
let _reenviandoDia = false;
async function reenviarDia(legajo) {
  if (_reenviandoDia || !paseVigente() || navigator.onLine === false) return;
  _reenviandoDia = true;
  try {
    const enCola = new Set(readQueue().map(x => x.id));
    for (const it of readState(legajo).last2) {
      if (!it || !it.id || String(it.opcion || "").toUpperCase() === "FJ" || enCola.has(it.id) || it.status === "failed") continue;
      const { error } = await rpc("reg_prod_3_0_registrar_evento", { p: eventoParaEnviar(it) });
      if (error) {
        if (error.code === "28000") { pasePerdido(); break; }
        if (!esRechazoDefinitivo(error)) break;            // sin señal: lo que falte, la próxima vez
        continue;
      }
      if (it.status !== "sent") markSent(legajo, it.id);  // se había perdido de la cola y ahora llegó
    }
  } finally { _reenviandoDia = false; }
}

let _cerrandoDia = false;
async function confirmarTerminarDia() {
  const legajo = legajoKey();
  const modal = $("terminarDiaModal");
  if (!legajo) { modal.classList.add("hidden"); return; }
  if (_cerrandoDia) return;
  _cerrandoDia = true;
  const btn = $("btnConfirmTD");
  btn.disabled = true; btn.textContent = "Procesando...";
  try {
    // 1) El tiempo muerto abierto se cierra solo (como 2.0).
    cerrarTMAbiertoTD(legajo);
    // 2) El FJ: id fijo por legajo y día (uno nuevo pisa al anterior) y el día entero en el texto, para ver si se perdió algo.
    const res = resumenDelDia(legajo);
    const s1 = readState(legajo);
    const events = s1.last2.filter(it => it && String(it.opcion || "").toUpperCase() !== "FJ").map(it => ({
      id: it.id, opcion: it.opcion, descripcion: it.descripcion || "", texto: it.texto || "", ts: it.ts_event || "",
      hsInicio: it.hs_inicio || "", matriz: it.matriz || "", status: it.status || "", sentAt: it.sentAt || "" }));
    const fj = { id: `fj_${legajo}_${dayKeyAR()}`, legajo, opcion: "FJ", descripcion: "Fin de Jornada",
                 texto: JSON.stringify({ counts: res.counts, events }), ts_event: isoNow(), hs_inicio: "", matriz: "" };
    s1.last2 = s1.last2.filter(it => String(it.opcion || "").toUpperCase() !== "FJ");
    s1.last2.push({ ...fj, status: "queued" });
    s1.tdCargaPreviaListo = false; s1.tdCargaPreviaInfo = null;
    writeState(legajo, s1);
    enqueue(fj);
    // 3) Se manda, con 10 s de tope: lo que no salga queda en la cola y sale solo (cada 3 s, o el service worker).
    await Promise.race([flushQueue(), new Promise(r => setTimeout(r, 10000))]);
    // 4) Respaldo: el día entero otra vez, en segundo plano.
    reenviarDia(legajo).catch(() => {});
    const pend = readQueue().length;
    modal.classList.add("hidden");
    goToLegajo();
    renderSyncBadge();
    if (pend > 0) alert(`El cierre del día quedó guardado, pero ${pend} registro(s) esperan para enviarse. Se reintenta solo cuando haya señal.`);
  } finally {
    _cerrandoDia = false;
    btn.disabled = false; btn.textContent = "Sí, terminar día";
  }
}

/* ============================================================
   HISTORIAL DIAS ANTERIORES
   ============================================================ */
function openHistDias() {
  const leg = legajoKey();
  if (!leg) { alert("Ingresa tu legajo primero"); return; }
  const today = dayKeyAR();
  const dias = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k?.startsWith(LS_PREFIX + "::")) continue;
    const parts = k.split("::");
    const dia = parts[1]; const legStored = parts[2];
    if (legStored !== leg || dia === today) continue;
    try {
      const s = JSON.parse(localStorage.getItem(k));
      if (s?.last2?.length) dias.push({ dia, items: s.last2 });
    } catch {}
  }
  dias.sort((a, b) => b.dia.localeCompare(a.dia));

  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:300;overflow-y:auto;padding:20px;";
  const box = document.createElement("div");
  box.style.cssText = "background:#fff;border-radius:14px;max-width:480px;margin:0 auto;padding:20px;";
  box.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
    <b style="font-size:18px;">Historial días anteriores</b>
    <button id="closeHistDias" style="background:none;border:none;font-size:24px;cursor:pointer;">×</button>
  </div>` + (dias.length ? dias.map(d => `
    <div style="margin-bottom:16px;">
      <div style="font-weight:700;color:#475569;margin-bottom:6px;">${d.dia}</div>
      ${d.items.map(it => `<div style="font-size:14px;padding:4px 0;border-bottom:1px solid #f1f5f9;">${esc(it.opcion)}${it.texto && String(it.opcion || "").toUpperCase() !== "FJ" ? ` ${esc(it.texto)}` : ""} — ${formatDateTimeAR(it.ts_event)}</div>`).join("")}
    </div>`).join("") : '<p style="color:#94a3b8;">Sin historial.</p>');
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  document.getElementById("closeHistDias").onclick = () => overlay.remove();
  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
}

/* ============================================================
   NAVEGACION
   ============================================================ */
async function goToOptions() {
  let legajo = legajoKey();
  if (!legajo) { alert("Ingresa el número de legajo"); return; }
  if (!D.empleados?.[legajo] && !candidatosLegajo(legajo).length) await refrescarCatalogoSiFalta();
  const cands = candidatosLegajo($("legajoInput").value);
  if (cands.length > 1 && !/^c/i.test(String($("legajoInput").value || "").trim()) && !cands.includes(_legajoElegido)) {
    const op = await elegirOpcion("¿Quién sos?", cands.map((k) => ({ val: k, label: `${D.empleados[k].nombre} · ${k}` })));
    if (!op) return;
    _legajoElegido = op.val;
  }
  legajo = legajoKey();
  if (!D.empleados?.[legajo]) {
    if (!hayCatalogo()) { cargarBundle().catch(() => {}); alert(AVISO_SIN_CATALOGO); return; }
    alert(`El legajo ${legajo} no existe en el sistema.`); return;
  }
  const emp = D.empleados[legajo];
  const nombre = typeof emp === "string" ? emp : (emp?.nombre || "");
  $("btnBackLabel").innerText = `${nombre} · Legajo ${legajo}`;
  registrarLegajoEnEquipo(legajo, nombre);
  cerrarCambioSede(legajo);
  $("legajoScreen").classList.add("hidden");
  $("optionsScreen").classList.remove("hidden");
  selected = null;
  $("btnCambiarSede")?.classList.toggle("hidden", !hayOtraSede());
  renderOptions();
  resetSelection();
  resumirFlujoRMSiHace(legajo);   // una rotura que quedó a medias (se recargó la página): se retoma
}

function goToLegajo() {
  selected = null;
  $("terminarDiaModal")?.classList.add("hidden");                // como 2.0: al volver al legajo se suelta lo elegido (no queda nada trabado)
  $("selectedArea").classList.add("hidden");
  $("optionsScreen").classList.add("hidden");
  $("legajoScreen").classList.remove("hidden");
  renderSummary();
}

/* ============================================================
   LIMPIEZA DIARIA (retiene 14 dias)
   ============================================================ */
function cleanupOldStates() {
  const keep = new Set();
  const today = new Date();
  for (let i = 0; i < 14; i++) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    keep.add(`${y}-${m}-${dd}`);
  }
  const toDel = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k?.startsWith(LS_PREFIX + "::")) continue;
    const dia = k.split("::")[1];
    if (dia && !keep.has(dia)) toDel.push(k);
  }
  toDel.forEach(k => localStorage.removeItem(k));
}

/* ============================================================
   SERVICE WORKER
   Sin caché de estáticos (mismo patrón que Virgilio y Cervantes). Brave Android ignora updateViaCache:"none", así que además
   se compara a mano el SW_VERSION de sw.js con APP_VERSION y se recarga si cambió (con enfriamiento, por si el CDN va a mitad
   de un deploy).
   ============================================================ */
let __swReloading = false;
function registrarServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const habiaControlador = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!habiaControlador || __swReloading) return;      // el primer registro no es una actualización
    __swReloading = true; setTimeout(() => location.reload(), 300);
  });
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then((reg) => {
    if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
    reg.addEventListener("updatefound", () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener("statechange", () => {
        if (nw.state === "installed" && navigator.serviceWorker.controller) nw.postMessage({ type: "SKIP_WAITING" });
      });
    });
  }).catch((err) => console.warn("SW no se pudo registrar:", err));
  navigator.serviceWorker.addEventListener("message", (event) => {
    const d = event.data || {};
    if (d.type === "SW_UPDATED" && d.version !== APP_VERSION && !__swReloading) { __swReloading = true; setTimeout(() => location.reload(), 300); }
  });
  const CLAVE_RECARGA = "rp3c_ultima_recarga";
  async function chequearVersion() {
    try {
      const r = await fetch("sw.js?_t=" + Date.now(), { cache: "no-store" });
      if (!r.ok) return;
      const m = (await r.text()).match(/SW_VERSION\s*=\s*["']([^"']+)["']/);
      if (!m || m[1] === APP_VERSION || __swReloading) return;
      const ult = parseInt(sessionStorage.getItem(CLAVE_RECARGA) || "0", 10);
      if (ult > 0 && Date.now() - ult < 60000) return;
      __swReloading = true; sessionStorage.setItem(CLAVE_RECARGA, String(Date.now()));
      setTimeout(() => location.reload(), 300);
    } catch { /* sin red */ }
  }
  setInterval(chequearVersion, 60000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { chequearVersion(); recogerEnviadosSW(); } });
  chequearVersion();
  // Envío en segundo plano: lo que el service worker mandó con la app cerrada se da por enviado; la cola se vuelve a copiar.
  navigator.serviceWorker.addEventListener("message", (event) => {
    if ((event.data || {}).type === "SW_ENVIADOS") recogerEnviadosSW();
  });
  recogerEnviadosSW().finally(() => espejarColaSW());
}

/* ENVÍO EN SEGUNDO PLANO, como 2.0 (background sync) [Elías, 08/10: «16: como en 2.0»]: la cola se copia al IndexedDB ya lista para
   mandar (el cuerpo del toque + el pase + el equipo) y el service worker (sw.js) la manda cuando vuelve la señal, aunque la app esté
   cerrada. Lo que manda lo anota en «enviados» y la app, al volver, lo da por enviado (confirmación positiva: nunca se da por enviado
   algo por no encontrarlo). La base no duplica (id del toque), así que si salen los dos no pasa nada. */
const IDB_ENVIO = "rp3c-envio";
let _idbEnvio = null;
function idbEnvio() {
  if (_idbEnvio) return _idbEnvio;
  _idbEnvio = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) { reject(new Error("sin IndexedDB")); return; }
    const req = indexedDB.open(IDB_ENVIO, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      ["cola", "enviados"].forEach((n) => { if (!db.objectStoreNames.contains(n)) db.createObjectStore(n, { keyPath: "id" }); });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "k" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  _idbEnvio.catch(() => { _idbEnvio = null; });
  return _idbEnvio;
}
function idbTx(stores, modo, fn) {
  return idbEnvio().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(stores, modo);
    const r = fn(tx);
    tx.oncomplete = () => resolve(r ? r.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}
let _espejoTimer = null;
function espejarColaSW() {
  clearTimeout(_espejoTimer);
  _espejoTimer = setTimeout(async () => {
    try {
      const q = readQueue();
      const pase = leerPase() || {};
      await idbTx(["cola", "meta"], "readwrite", (tx) => {
        const cola = tx.objectStore("cola");
        cola.clear();
        q.forEach((p) => { try { cola.put({ id: p.id, legajo: String(p.legajo || ""), matriz: p.matriz || "", cuerpo: eventoParaEnviar(p) }); } catch { /* se manda desde la app */ } });
        tx.objectStore("meta").put({ k: "envio", pase: pase.pase || "", vence: pase.vence || "", dispositivo: idDispositivo() });
      });
      if (q.length && "serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.ready;
        if (reg && reg.sync) await reg.sync.register("rp3c-enviar");
      }
    } catch { /* sin IndexedDB o sin background sync: la app manda sola cuando está abierta */ }
  }, 300);
}
async function recogerEnviadosSW() {
  let lista = [];
  try { lista = (await idbTx(["enviados"], "readonly", (tx) => tx.objectStore("enviados").getAll())) || []; } catch { return; }
  if (!lista.length) return;
  const ids = new Set(lista.map((x) => x.id));
  const q = readQueue();
  q.filter((x) => ids.has(x.id)).forEach((x) => markSent(x.legajo, x.id));
  writeQueue(q.filter((x) => !ids.has(x.id)));
  lista.forEach((x) => { if (x.cajon) aplicarContador(x.matriz, x.cajon); });
  try { await idbTx(["enviados"], "readwrite", (tx) => { lista.forEach((x) => tx.objectStore("enviados").delete(x.id)); }); } catch { /* se recoge la próxima */ }
  renderSyncBadge(); renderSummary();
}

/* ============================================================
   INIT
   ============================================================ */
document.addEventListener("DOMContentLoaded", () => {
  cleanupOldStates();
  prepararLlegadaCambioSede();   // viene de Virgilio con «Cambiar sede»: código de la TV de Cervantes y el legajo ya escrito

  // Antes de entrar: el código de la TV (si falta el pase). Hasta que haya pase, el catálogo sale de lo guardado en el celular.
  verificarEntrada();
  cargarBundle().catch(e => console.warn("Bundle:", e));
  registrarServiceWorker();

  // Legajo input: render summary on change
  $("legajoInput").addEventListener("input", () => { renderSummary(); });

  $("btnContinuar").addEventListener("click", goToOptions);
  $("legajoInput").addEventListener("keydown", e => { if (e.key === "Enter") goToOptions(); });

  $("btnBackTop").addEventListener("click", goToLegajo);
  $("btnBackLabel").addEventListener("click", goToLegajo);
  $("btnResetSelection").addEventListener("click", resetSelection);
  $("btnEnviar").addEventListener("click", sendFast);

  $("syncBadge").addEventListener("click", async () => {
    $("syncBadge").innerText = "Enviando...";
    await flushQueue();
    renderSummary(); renderSyncBadge();
  });

  $("btnHistDias").addEventListener("click", openHistDias);
  $("btnTerminarDia").addEventListener("click", openTerminarDia);
  $("btnCambiarSede")?.addEventListener("click", cambiarSede);
  $("btnCancelTD").addEventListener("click", () => $("terminarDiaModal").classList.add("hidden"));
  $("btnConfirmTD").addEventListener("click", confirmarTerminarDia);

  renderSummary();
  renderSyncBadge();

  // Como 2.0: mientras quede algo en la cola, se reintenta cada 3 s (con señal y con pase).
  setInterval(() => {
    if (flushing || navigator.onLine === false || !paseVigente()) return;
    // lo que la base rechazó por los datos no apura el reintento (sigue en el de cada 60 s): sólo lo que espera señal o base
    if (!readQueue().some(x => !x._rechazado) && !readAnularQueue().length && !readRolloQueue().length && !readBalancinQueue().length) return;
    flushQueue().then(() => { renderSyncBadge(); renderSummary(); }).catch(() => {});
  }, 3000);

  // Flush periodico (cada 60s)
  setInterval(async () => {
    verificarEntrada();      // el pase vence a las 17:45: pasada esa hora vuelve el código
    refrescarCatalogos();
    await flushQueue();
    renderSyncBadge();
    renderSummary();
  }, 60000);

  // Al volver a la app y al volver internet: pase, catálogo y cola al día.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    verificarEntrada(); refrescarCatalogos();
    flushQueue().then(() => { renderSyncBadge(); renderSummary(); });
  });
  window.addEventListener("online", () => {
    verificarEntrada();
    cargarBundle().catch(() => {});
    flushQueue().then(() => { renderSyncBadge(); renderSummary(); });
  });
  window.addEventListener("offline", renderSyncBadge);
});
