"use strict";

/* ============================================================
   app.js — Registro Producción 3.0 · Cervantes · botonera de GP2 (v3.1.1)
   Es la tablet de GP2 (gp2/Produccion/RegistroApp/operarios_gp2.js) llevada al celular del operario:
     · se entra con el CÓDIGO DE LA TV (4 números), no con Google. La base devuelve un PASE firmado, atado a este
       equipo, que vale hasta las 17:45 (o 3 h si se entra más tarde);
     · todo va por funciones del schema reg_prod_3_0 (cabecera Content-Profile) que exigen ese pase:
         reg_prod_3_0_bundle · reg_prod_3_0_envasado_articulos · reg_prod_3_0_registrar_evento · reg_prod_3_0_anular_evento
       La base guarda la CRUDA tal cual vino y arma la PROCESADA en la misma transacción;
     · sin internet se carga igual: los toques quedan en la cola del celular y se envían, con su hora original, cuando hay
       pase e internet. El catálogo (empleados, matrices, envasado) se guarda en el celular para poder abrir sin señal;
     · STOCK Y ROLLOS (Fase 1c): los mueve la base, en la misma transacción que el toque (reg_prod_3_0_registrar_evento →
       GP2.fabricar_stock) y con reg_prod_3_0_tomar_rollo / _cerrar_rollo, siempre con el pase. Mientras la base no lo tenga, el
       catálogo no trae `rollos_activos` y el selector de rollo, «¿quedó resto?» y el botón CT de Eduardo quedan apagados.
   Eduardo Barrionuevo (legajo "19"): CT button + rollo en E/PR (apagado, ver arriba).
   ============================================================ */

const APP_VERSION = "v3.1.1";
const LEGAJO_EDUARDO = "19";

const SUPABASE_URL = "https://hrxfctzncixxqmpfhskv.supabase.co";
const SUPABASE_KEY = "sb_publishable_BqpAgZH6ty-9wft10_YMhw_0rcIPuWT";
const SCHEMA = "reg_prod_3_0";
const RPC_TIMEOUT_MS = 20000;
const PASE_FIN_MIN = 17 * 60 + 45;   // el pase vale hasta las 17:45 (la hora de vencimiento la pone la base)

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
    fondo.style.cssText = "position:fixed;inset:0;z-index:400;background:#f1f5f9;display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto;";
    const caja = document.createElement("div");
    caja.style.cssText = "background:#fff;border-radius:14px;padding:22px 20px;max-width:340px;width:100%;box-shadow:0 10px 30px rgba(15,23,42,.25);text-align:center;font-family:inherit;";
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
    inp.style.cssText = "width:100%;box-sizing:border-box;font-size:34px;letter-spacing:12px;text-align:center;padding:8px;border:2px solid #cbd5e1;border-radius:10px;font-weight:800;";
    const err = document.createElement("div");
    err.id = "tvClaveError";
    err.style.cssText = "min-height:20px;margin:8px 0;font-size:14px;font-weight:700;color:#b91c1c;";
    err.textContent = aviso || "";
    const fila = document.createElement("div");
    fila.style.cssText = "display:flex;gap:8px;";
    const ok = document.createElement("button");
    ok.id = "tvClaveOk"; ok.type = "button"; ok.textContent = "Entrar";
    ok.style.cssText = "flex:1;padding:12px;border-radius:10px;border:none;background:#1e40af;color:#fff;font-size:17px;font-weight:800;";
    if (cancelable) {
      const no = document.createElement("button");
      no.id = "tvClaveNo"; no.type = "button"; no.textContent = "Ahora no";
      no.style.cssText = "flex:1;padding:12px;border-radius:10px;border:1px solid #cbd5e1;background:#f8fafc;font-size:16px;font-weight:700;";
      no.addEventListener("click", () => cerrar(null));
      fila.append(no);
    }
    fila.append(ok);
    caja.append(t, d, inp, err, fila);
    const volver = document.createElement("a");
    volver.id = "tvClaveVolver"; volver.href = "../"; volver.textContent = "← Volver al inicio";
    volver.style.cssText = "display:inline-block;margin-top:14px;font-size:14px;font-weight:600;color:#0e7490;text-decoration:none;";
    caja.append(volver);
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
  cargarBundle().catch(() => {});
  cargarArticulosEnvasado().catch(() => {});
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
/* Shape real de reg_prod_3_0_bundle() (el mismo de registro_operarios_bundle() de GP2, con los rollos vacíos hasta la Fase 1c):
   empleados    { legajo -> {nombre, activo, hora_entrada} }
   matrices     [ {n, d, ppk, uxg, maq, act} ]   uxg = unidades por golpe, act = activa
   registro_en_golpes  true = el cajon se cierra anotando GOLPES del contador
   matriz_fleje { n_matriz -> {comp_id, codigo, descripcion} }          (fallback)
   matriz_fleje_pieza { n_matriz -> { comp_salida_id -> {comp_id, codigo, descripcion} } }
   envasado     { n_matriz -> {unica: art/caja o null, salidas: {comp_salida_id -> art/caja}} }
                 (matriz que cierra un terminado: el operario carga CAJAS, no golpes)
   rollos_saldo [ {comp_id, codigo, kg_por_rollo, rollos} ]              */
let D = {};

/* ARTÍCULO DE CADA PIEZA DE ENVASADO (v3.0.1, Registro Producción 3.0) — sólo matrices de ENVASADO (las que cierran un
   terminado, sector 12). El selector de pieza decía «Art. 394» (el código); ahora lleva el NOMBRE del artículo y la MARCA,
   porque hay artículos que se llaman igual y se distinguen sólo por la marca (322: «Espátula Lisa Nylon 1 Pza» es el 394
   LOEKE y el 842 CHEF). Viene de la RPC reg_prod_3_0_envasado_articulos (una sola llamada, ~6 KB; con pase):
     { n_matriz: [ { pieza_codigo, pieza_desc, arts: [ { codigo, nombre, marca } ] } ] }
   Si la RPC no está o falla, queda lo de siempre («Art. 394» con el código que trae el bundle). */
let ENV_ARTS = {};

const LS_ENVASADO = "rp3c_envasado";
const LS_BUNDLE = "rp3c_bundle";
const CATALOGO_REFRESCO_MS = 30 * 60 * 1000;   // con la app abierta, el catálogo se vuelve a pedir cada 30 min
let _catalogoAt = 0;
let _bundleTimer = null;

function leerCache(clave) { try { return JSON.parse(localStorage.getItem(clave) || "null"); } catch { return null; } }
function guardarCache(clave, data) { try { localStorage.setItem(clave, JSON.stringify({ at: isoNow(), data })); } catch { /* storage lleno: sin caché */ } }

async function cargarArticulosEnvasado() {
  if (!Object.keys(ENV_ARTS).length) {                       // primero lo guardado en el celular (abre sin señal)
    const c = leerCache(LS_ENVASADO);
    if (c && c.data && typeof c.data === "object") ENV_ARTS = c.data;
  }
  if (!paseVigente() || navigator.onLine === false) return;
  const { data, error } = await rpc("reg_prod_3_0_envasado_articulos");
  if (error) {
    if (error.code === "28000") pasePerdido();
    else console.warn("Artículos de envasado (se sigue sin nombres):", error.message);
    return;
  }
  ENV_ARTS = (data && typeof data === "object") ? data : {};
  guardarCache(LS_ENVASADO, ENV_ARTS);
  if (selected && ["E", "CM"].includes(selected.code)) {   // repintar lo que ya estuviera en pantalla
    renderMatrizPicker();
    renderPiezaPicker(String($("textInput").value || "").trim());
  }
}
function piezasEnvasado(n) { return ENV_ARTS[String(n || "").trim()] || []; }
function artsDePieza(n, codigoPieza) {
  const p = piezasEnvasado(n).find(x => String(x.pieza_codigo || "").trim() === String(codigoPieza || "").trim());
  return (p && p.arts) || [];
}
// Marca como la ve el operario [usuario 07/10/2026]: LK = Loeke (diminutivo de Loekemeyer), CH = Chef; las demás, tal cual (LOKE).
const MARCA_CORTA = { "LOEKE": "LK", "CHEF": "CH" };
function marcaCorta(m) { const k = String(m || "").trim(); return MARCA_CORTA[k.toUpperCase()] || k; }
// ¿Todas las piezas de esa matriz son el MISMO artículo (mismo nombre)? Entonces el nombre no distingue nada y se muestra
// sólo la MARCA [usuario 07/10/2026]; si los nombres son distintos, nombre y marca. Sin marca no se puede: nombre y código.
function soloMarcaDe(n) {
  const arts = piezasEnvasado(n).flatMap(p => p.arts || []);
  if (arts.length < 2 || !arts.every(a => a.marca)) return false;
  const norm = s => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
  return new Set(arts.map(a => norm(a.nombre))).size === 1;
}
// Un artículo por línea: «Art. 394 · Espátula Lisa Nylon 1 Pza» y debajo la marca corta (LK / CH), o sólo la marca (ver soloMarcaDe).
function lineasArt(arts, soloMarca) {
  return (arts || []).map(a => soloMarca
    ? `<div class="mz-m solo">${esc(marcaCorta(a.marca))}</div>`
    : `<div class="mz-a">Art. ${esc(a.codigo || "")}${a.nombre ? " · " + esc(a.nombre) : ""}</div>` +
      (a.marca ? `<div class="mz-m">${esc(marcaCorta(a.marca))}</div>` : "")).join("");
}
// Lo mismo en una línea de texto: «Art. 394 · Espátula Lisa Nylon 1 Pza (LOEKE)», o sólo «LOEKE».
function textoArt(arts, soloMarca) {
  return (arts || []).map(a => soloMarca
    ? marcaCorta(a.marca)
    : `Art. ${a.codigo || ""}${a.nombre ? " · " + a.nombre : ""}${a.marca ? " (" + marcaCorta(a.marca) + ")" : ""}`).join(" / ");
}

function armarBundle(d) {
  const x = (d && typeof d === "object") ? d : {};
  x.matricesMap = new Map((x.matrices || []).map(m => [String(m.n || "").trim(), m]));
  return x;
}
function repintarCatalogo() { if (selected && ["E", "CM"].includes(selected.code)) renderMatrizPicker(); }

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
  cargarArticulosEnvasado().catch(() => {});
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
  // row 1
  { code: "E",  desc: "Empece Matriz",     row: 1, needsInput: true,  label: "Ingresa el número", validate: /^[0-9]+[A-Za-z]?$/ },
  { code: "C",  desc: "Cajon",             row: 1, needsInput: true,  label: "Ingresa los GOLPES del contador", validate: /^[0-9]+$/ },
  // row 2
  { code: "PB",   desc: "Pare Bano",       row: 2, needsInput: false },
  { code: "BC",   desc: "Busque Cajon",    row: 2, needsInput: false },
  { code: "MOV",  desc: "Movimiento",      row: 2, needsInput: false },
  { code: "LIMP", desc: "Limpieza",        row: 2, needsInput: false },
  { code: "Perm", desc: "Permiso",         row: 2, needsInput: false },
  // row 3
  { code: "AL",    desc: "Ayuda Logistica",     row: 3, needsInput: false },
  { code: "PR",    desc: "Pare Carga Rollo",     row: 3, needsInput: false },
  { code: "PC",    desc: "Pare Comida",          row: 3, needsInput: false },
  { code: "MOV P", desc: "Movimiento Piedra",    row: 3, needsInput: false },
  // row 4
  // Sacados 2026-08-29 (uso historico): RD (0 usos), CM (nada desde abril; con E
  // alcanza para cambiar de matriz), REM (13 usos en la vida).
  { code: "PM",  desc: "Pare Matriz",      row: 4, needsInput: false },
  { code: "RM",  desc: "Rotura Matriz",    row: 4, needsInput: false },
];

const CT_OPTION = { code: "CT", desc: "Cajon Termine", row: 1, needsInput: false, isCT: true };

const NON_DOWNTIME = new Set(["E", "C", "CT", "RM", "PM", "RD", "LT"]);
const isDowntime = (op) => !NON_DOWNTIME.has(op);
const sameDowntime = (a, b) => a && b && a.opcion === b.opcion && (a.texto || "") === (b.texto || "");

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
    s.last2.push({ ...payload, status: "queued" });
    writeState(legajo, s); return;
  }
  if (["RM", "PM", "RD"].includes(op)) {
    s.lastDowntime = null;
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

function enqueue(payload) {
  const q = readQueue();
  if (!q.some(x => x.id === payload.id)) q.push(payload);
  writeQueue(q);
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
  if (["E", "CM"].includes(op)) matriz = p.texto || "";
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

  if (["C", "CT"].includes(op)) {
    const env = envasadoDe(matriz);
    if (env) {
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
    rpc.nombre_matriz = ["E", "CM"].includes(op) ? (nombreMatriz(matriz) || undefined) : p.descripcion;
  }

  const segs = (p.hs_inicio && p.ts_event)
    ? Math.max(0, Math.round((new Date(p.ts_event) - new Date(p.hs_inicio)) / 1000))
    : null;
  if (segs !== null) {
    if (["C", "CT"].includes(op)) rpc.segundos_trabajados = segs;
    else if (isDowntime(op)) rpc.segundos_tiempo_muerto = segs;
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
    if (!q.length && !readRolloQueue().length) return;
    if (!paseVigente()) { verificarEntrada(); return; }       // sin pase no se manda: queda en la cola y se pide el código
    const enviados = new Set();
    for (const payload of q) {
      const { error } = await rpc("reg_prod_3_0_registrar_evento", { p: eventoParaEnviar(payload) });
      if (!error) { markSent(payload.legajo, payload.id); enviados.add(payload.id); continue; }
      if (error.code === "28000") { pasePerdido(); break; }   // pase vencido o de otro equipo: vuelve el código, nada se pierde
      if (!esRechazoDefinitivo(error)) break;                 // sin señal / base caída: se reintenta
      markFailed(payload.legajo, payload.id, error.message);
    }
    // Re-leer la cola: pudo haber items nuevos encolados mientras se enviaba
    if (enviados.size) writeQueue(readQueue().filter(x => !enviados.has(x.id)));
    // Rollos pendientes (tomar/cerrar que no pudieron salir): FIFO, corta al primer fallo de red o de pase.
    let rq = readRolloQueue();
    while (rq.length) {
      const { error } = await rpc(rq[0].fn, rq[0].args);
      if (error && error.code === "28000") { pasePerdido(); break; }
      if (error && !esRechazoDefinitivo(error)) break;
      rq = readRolloQueue(); rq.shift(); writeRolloQueue(rq);
    }
  } finally { flushing = false; }
}

/* ============================================================
   LLEGADA TARDE
   ============================================================ */
function maybeSendLateArrival(legajo) {
  const s = readState(legajo);
  const isFirst = !s.last2.length && !s.lastMatrix && !s.lastCajon && !s.lastDowntime;
  if (!isFirst || s.lateArrivalSent || s.lateArrivalDiscarded) return;

  if (nowMinutesAR() <= 8 * 60 + 30) {
    s.lateArrivalDiscarded = true; writeState(legajo, s); return;
  }
  const day = dayKeyAR();
  const payload = {
    id: uuidv4(), legajo, opcion: "LT", descripcion: "Llegada Tarde",
    texto: "", ts_event: isoNow(), hs_inicio: `${day}T08:30:00-03:00`, matriz: ""
  };
  s.lateArrivalSent = true; writeState(legajo, s);
  enqueue(payload);
}

/* ============================================================
   ROLLOS (Eduardo)
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
async function tomarRollo(legajo, comp_id, kg_por_rollo, matriz) {
  await llamarRollo("reg_prod_3_0_tomar_rollo", {
    p_legajo: String(legajo), p_comp_id: Number(comp_id), p_kg_por_rollo: Number(kg_por_rollo), p_matriz: String(matriz), p_fecha: isoNow()
  });
}
async function cerrarRollo(legajo, quedoResto) {
  await llamarRollo("reg_prod_3_0_cerrar_rollo", { p_legajo: String(legajo), p_quedo_resto: !!quedoResto, p_fecha: isoNow() });
}

/* ============================================================
   UI helpers
   ============================================================ */
const $ = id => document.getElementById(id);
let selected = null;

// Escapar texto libre de la BD antes de meterlo en innerHTML (mismo esc que Registro_GP2)
function esc(s) { return (s == null ? "" : String(s)).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

function legajoKey() { return String($("legajoInput").value || "").trim(); }
function isEduardo()  { return legajoKey() === LEGAJO_EDUARDO; }

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
            <span style="font-weight:900;font-size:34px;">${it.opcion}${it.texto ? `: ${it.texto}` : ""}</span>
            ${badge(it.status)}
            <span class="hist-btn hist-del" data-idx="${idx}" title="Eliminar">🗑</span>
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
  const q = readQueue().concat(readRolloQueue());
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
  if (!selected || !["C", "CT", "RM", "PM", "RD", "CM"].includes(selected.code)) {
    el.classList.add("hidden"); return;
  }
  const s = readState(legajoKey());
  if (!s.lastMatrix?.texto) { el.classList.add("hidden"); return; }
  const nm = s.lastMatrix.texto;
  const desc = nombreMatriz(nm);
  el.classList.remove("hidden");
  const pieza = s.lastMatrix.pieza ? ` · Pieza: ${esc(s.lastMatrix.pieza)}` : "";
  // v3.0.1: artículo (nombre y marca) si es una matriz de envasado. Con una sola pieza no hay pieza guardada: es esa.
  const piezasEnv = piezasEnvasado(nm);
  const artsAct = s.lastMatrix.pieza ? artsDePieza(nm, s.lastMatrix.pieza) : (piezasEnv.length === 1 ? piezasEnv[0].arts : []);
  const artTxt = artsAct && artsAct.length ? `<br><b>${esc(textoArt(artsAct, soloMarcaDe(nm)))}</b>` : "";
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
  el.innerHTML = `<b>Matriz activa: ${esc(nm)}</b>${desc ? ` — ${esc(desc)}` : ""}${pieza}${artTxt}${rollo}`;
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
    // v3.0.1: matriz de envasado con UNA sola pieza → el artículo va en la card (con varias, se ve al elegir la pieza)
    const piezasEnv = piezasEnvasado(n);
    const artLinea = piezasEnv.length === 1 ? lineasArt(piezasEnv[0].arts) : "";
    const cuerpo = `<div class="mz-main"><div class="mz-n">${esc(n)}</div><div class="mz-d">${esc(m.d || "")}</div>${artLinea}</div>`;
    const chip = conPieza ? `<div class="mz-chip">${esc(piezaSel.codigo || "")}<small>acá va el stock</small></div>` : "";
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
  if (selected?.code === "E") actualizarRolloPicker(n);
}

/* ============================================================
   SELECTOR DE PIEZA (matrices con varias salidas)
   La pieza elegida viaja como comp_salida_id en el C para que
   el stock se sume en el componente correcto.
   ============================================================ */
let piezaSel = null; // {comp_id, codigo, descripcion}
let rolloSel = null; // {comp_id, codigo, kg_por_rollo} — rollo elegido (antes era el value del <select>)

function salidasDeMatriz(n) {
  return (D.matriz_salidas || {})[String(n || "").trim()] || [];
}

function renderPiezaPicker(n) {
  const wrap = $("piezaPicker"), grid = $("piezaGrid");
  if (!wrap || !grid) return;
  const salidas = (selected && ["E", "CM"].includes(selected.code)) ? salidasDeMatriz(n) : [];
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
    // v3.0.1: nombre y marca del artículo (RPC de envasado); sin RPC, el código que trae el bundle, como antes
    const artsSel = artsDePieza(n, piezaSel.codigo);
    const arts = artsSel.length ? ` (${esc(textoArt(artsSel, soloMarcaDe(n)))})` : (piezaSel.arts ? ` (art. ${esc(piezaSel.arts)})` : "");
    btn.innerHTML = `Fabricás <b>${esc(piezaSel.codigo || "")}</b> · ${esc(piezaSel.descripcion || "")}${arts} — <u>cambiar</u>`;
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
    // v3.0.1: nombre y marca (RPC de envasado); sin RPC, el código que trae el bundle, como antes
    const arts = lineasArt(artsDePieza(n, sa.codigo), soloMarcaDe(n)) || (sa.arts ? `<div class="mz-a">Art. ${esc(sa.arts)}</div>` : "");
    el.innerHTML = `<div class="mz-n">${esc(sa.codigo || "")}</div><div class="mz-d">${esc(sa.descripcion || "")}</div>${arts}`;
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
  const isEd = isEduardo();
  [1, 2, 3, 4].forEach(r => { $(`row${r}`).innerHTML = ""; });

  const all = (isEd && rollosActivos()) ? [...OPTIONS, CT_OPTION] : OPTIONS;
  all.forEach(opt => {
    const el = document.createElement("div");
    el.className = "box" + (opt.isCT ? " ct-btn" : "");
    el.dataset.code = opt.code;
    el.innerHTML = `<div style="font-size:18px;font-weight:900;">${opt.code}</div><div style="font-size:11px;font-weight:600;color:inherit;margin-top:3px;">${opt.desc}</div>`;
    el.addEventListener("click", () => selectOption(opt));
    $(`row${opt.row}`).appendChild(el);
  });
}

function mostrarBotones(mostrar) {
  [1, 2, 3, 4].forEach(r => $(`row${r}`).classList.toggle("hidden", !mostrar));
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

  const inputArea = $("inputArea");
  const textInput = $("textInput");
  if (opt.needsInput) {
    $("inputLabel").innerText = opt.label || "Ingresa valor";
    textInput.value = "";
    inputArea.classList.remove("hidden");
    setTimeout(() => textInput.focus(), 50);
  } else {
    inputArea.classList.add("hidden");
    textInput.value = "";
  }

  // Listado de matrices para E / CM
  const matrizPicker = $("matrizPicker");
  piezaSel = null;
  if (["E", "CM"].includes(opt.code)) {
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
    textInput.oninput = opt.code === "CM"
      ? () => {
          renderMatrizPicker();
          renderPiezaPicker(textInput.value.trim());
        }
      : null;
  }

  // Cajon: se anotan GOLPES (o CAJAS si la matriz es de envasado) y se muestra en vivo cuantas
  // unidades salen.
  const gh = $("golpeHint");
  if (gh) {
    const nMatC = opt.code === "C" ? String(readState(legajoKey()).lastMatrix?.texto || "").trim() : "";
    const envC = opt.code === "C" ? envasadoDe(nMatC) : null;
    if (opt.code === "C" && envC) {
      // Matriz de envasado: el operario carga CAJAS.
      $("inputLabel").innerText = "¿Cuántas CAJAS armaste?";
      const apc = apcEnvase(nMatC, readState(legajoKey()).lastMatrix?.comp_salida_id) || 1;
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

  // Eduardo: quedoResto para PR
  const quedoRestoWrap = $("quedoRestoWrap");
  if (rollosActivos() && isEduardo() && opt.code === "PR") {
    quedoRestoWrap.classList.remove("hidden");
    $("quedoRestoChk").checked = false;
  } else {
    quedoRestoWrap.classList.add("hidden");
  }

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
  if (s?.lastDowntime && selected) return; // downtime abierto: hay que enviar el mismo, no se sale
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
  document.querySelectorAll(".box.selected").forEach(x => x.classList.remove("selected"));
}

/* ============================================================
   ENVIAR
   ============================================================ */
async function sendFast() {
  if (!selected) return;
  const legajo = legajoKey();
  if (!legajo) { alert("Ingresa el número de legajo"); return; }

  maybeSendLateArrival(legajo);

  const texto = String($("textInput").value || "").trim();
  const s = readState(legajo);

  // Validaciones
  if (selected.needsInput) {
    if (!selected.validate?.test(texto)) {
      $("error").innerText = "Solo se permiten números"; return;
    }
  }

  if (selected.code === "E") {
    if (s.matrixNeedsC) {
      alert('Antes de iniciar una nueva matriz (E), enviá al menos 1 Cajón (C).'); return;
    }
    if (!D.matricesMap?.has(texto)) {
      alert(`La matriz ${texto} no existe. Verifica el número.`); return;
    }
    if (!matrizActiva(texto)) {
      alert(`La matriz ${texto} está dada de baja, no se usa más.`); return;
    }
  }
  if (selected.code === "CM") {
    if (!D.matricesMap?.has(texto)) {
      alert(`La matriz ${texto} no existe.`); return;
    }
    if (!matrizActiva(texto)) {
      alert(`La matriz ${texto} está dada de baja, no se usa más.`); return;
    }
  }
  if (["E", "CM"].includes(selected.code) && salidasDeMatriz(texto).length > 1 && !piezaSel) {
    $("error").innerText = "Esta matriz hace varias piezas. Elegí cuál vas a fabricar.";
    return;
  }
  if (["C", "CT", "RM", "PM", "RD"].includes(selected.code)) {
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
    texto, ts_event: tsEvent, hs_inicio: "", matriz: ""
  };

  if (["E", "CM"].includes(payload.opcion) && piezaSel) {
    payload.comp_salida_id = piezaSel.comp_id;
    payload.pieza = piezaSel.codigo || "";
  }
  if (payload.opcion === "E" && rolloInfo) {
    payload.rollo = rolloInfo;   // {comp_id, codigo, kg_por_rollo} -> queda en el estado
  }
  if (["C", "CT", "RM", "PM", "RD"].includes(payload.opcion)) {
    payload.matriz = s.lastMatrix?.texto || "";
    if (["C", "CT"].includes(payload.opcion) && s.lastMatrix?.comp_salida_id) {
      payload.comp_salida_id = s.lastMatrix.comp_salida_id;
      payload.pieza = s.lastMatrix.pieza || "";
    }
  }
  if (payload.opcion === "C" || payload.opcion === "CT") {
    payload.hs_inicio = computeHsInicio(s);
  }
  if (["RM", "PM", "RD"].includes(payload.opcion)) {
    payload.hs_inicio = tsEvent;
  }
  if (s.lastDowntime && sameDowntime(s.lastDowntime, payload)) {
    payload.hs_inicio = s.lastDowntime.ts || "";
  }

  $("btnEnviar").disabled = true;
  $("btnEnviar").innerText = "Enviando...";

  // Tomar rollo: cualquier operario que eligio uno en E lo descuenta del stock.
  if (selected.code === "E" && rolloInfo) {
    await tomarRollo(legajo, rolloInfo.comp_id, rolloInfo.kg_por_rollo, texto);
  }
  // Cerrar rollo: los eventos especiales de Eduardo (CT / PR con quedo-resto)
  if (isEduardo()) {
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
  renderSummary();

  selected = null;
  $("selectedArea").classList.add("hidden");
  $("optionsScreen").classList.add("hidden");
  $("legajoScreen").classList.remove("hidden");
  $("matrizInfo").classList.add("hidden");
  $("error").innerText = "";
  document.querySelectorAll(".box.selected").forEach(x => x.classList.remove("selected"));

  try {
    await flushQueue();
    renderSyncBadge();
    renderSummary();
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

  // Baja logica en la base (si ya se habia enviado). Va por RPC: con RLS activo
  // la clave anon ya no puede tocar la tabla produccion directo.
  if (item.id && item.status === "sent") {
    try {
      const { error } = await rpc("reg_prod_3_0_anular_evento", { p_id_ejecucion: item.id });
      if (error) throw error;
    } catch (e) {
      console.warn("No se pudo marcar eliminado:", e);
      if (e && e.code === "28000") { pasePerdido(); alert("Hace falta el código de la TV para eliminar. Ingresalo y probá de nuevo."); return; }
      // Si el server no lo anulo, NO borrarlo localmente: quedaria vivo en la BD
      // (produccion + stock) mientras aca figura como eliminado.
      alert("No se pudo eliminar en el servidor (¿sin señal?). Probá de nuevo cuando vuelva la conexión.");
      return;
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

  renderSummary();
  renderSyncBadge();
}

/* ============================================================
   TERMINAR DIA
   ============================================================ */
function openTerminarDia() {
  const legajo = legajoKey();
  const s = readState(legajo);
  const cont = $("terminarDiaContent");

  if (s.lastDowntime) {
    cont.innerHTML = `<p>Hay un <b>Tiempo Muerto abierto (${s.lastDowntime.opcion})</b>. Cerralo antes de terminar el día.</p>`;
    $("btnConfirmTD").disabled = true;
  } else if (s.matrixNeedsC) {
    cont.innerHTML = `<p>Hay una <b>Matriz abierta (${s.lastMatrix?.texto})</b> sin cajón. Si terminaste, enviá el cajón (C) primero.</p>`;
    $("btnConfirmTD").disabled = true;
  } else {
    cont.innerHTML = `<p>¿Confirmás que terminaste el día?</p>`;
    $("btnConfirmTD").disabled = false;
  }
  $("terminarDiaModal").classList.remove("hidden");
}

async function confirmarTerminarDia() {
  const legajo = legajoKey();
  const payload = {
    id: uuidv4(), legajo, opcion: "FJ", descripcion: "Fin Jornada",
    texto: "", ts_event: isoNow(), hs_inicio: "", matriz: ""
  };
  const s = readState(legajo);
  s.last2.push({ ...payload, status: "queued" });
  writeState(legajo, s);
  enqueue(payload);

  $("terminarDiaModal").classList.add("hidden");
  await flushQueue();
  renderSummary();
  renderSyncBadge();
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
      ${d.items.map(it => `<div style="font-size:14px;padding:4px 0;border-bottom:1px solid #f1f5f9;">${it.opcion}${it.texto ? ` ${it.texto}` : ""} — ${formatDateTimeAR(it.ts_event)}</div>`).join("")}
    </div>`).join("") : '<p style="color:#94a3b8;">Sin historial.</p>');
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  document.getElementById("closeHistDias").onclick = () => overlay.remove();
  overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
}

/* ============================================================
   NAVEGACION
   ============================================================ */
function goToOptions() {
  const legajo = legajoKey();
  if (!legajo) { alert("Ingresa el número de legajo"); return; }
  if (!D.empleados?.[legajo]) {
    alert(`El legajo ${legajo} no existe en el sistema.`); return;
  }
  const emp = D.empleados[legajo];
  const nombre = typeof emp === "string" ? emp : (emp?.nombre || "");
  $("btnBackLabel").innerText = `${nombre} · Legajo ${legajo}`;
  registrarLegajoEnEquipo(legajo, nombre);
  $("legajoScreen").classList.add("hidden");
  $("optionsScreen").classList.remove("hidden");
  renderOptions();
  resetSelection();
}

function goToLegajo() {
  $("optionsScreen").classList.add("hidden");
  $("legajoScreen").classList.remove("hidden");
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
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") chequearVersion(); });
  chequearVersion();
}

/* ============================================================
   INIT
   ============================================================ */
document.addEventListener("DOMContentLoaded", () => {
  cleanupOldStates();

  // Antes de entrar: el código de la TV (si falta el pase). Hasta que haya pase, el catálogo sale de lo guardado en el celular.
  verificarEntrada();
  cargarBundle().catch(e => console.warn("Bundle:", e));
  cargarArticulosEnvasado().catch(() => {});   // nombre y marca de los artículos de envasado (sin la RPC, sigue sin nombres)
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
  $("btnCancelTD").addEventListener("click", () => $("terminarDiaModal").classList.add("hidden"));
  $("btnConfirmTD").addEventListener("click", confirmarTerminarDia);

  $("editCancel").addEventListener("click", () => $("editModal").classList.add("hidden"));

  renderSummary();
  renderSyncBadge();

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
    cargarArticulosEnvasado().catch(() => {});
    flushQueue().then(() => { renderSyncBadge(); renderSummary(); });
  });
  window.addEventListener("offline", renderSyncBadge);
});
