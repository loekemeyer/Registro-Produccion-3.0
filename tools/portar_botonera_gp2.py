#!/usr/bin/env python3
"""Porta la botonera de la tablet de GP2 a cervantes-gp2/ (Registro Producción 3.0).

GP2 se sigue modificando en su repo (loekemeyer/Gestion-Productiva-2.0) y nada lo sincroniza con éste. Para traer un cambio de
GP2 NO se copia a mano: se vuelve a correr este script sobre los archivos ACTUALES de GP2 y se revisa el diff.

    python3 tools/portar_botonera_gp2.py --gp2 <clon de Gestion-Productiva-2.0> --version 3.1.N
    git diff cervantes-gp2/        # revisar qué trajo de GP2

Toma Produccion/RegistroApp/operarios_gp2.js y Operarios_GP2.html y les aplica los cambios de 3.0 (código de la TV + pase, funciones
del schema reg_prod_3_0, catálogo guardado en el celular, cola que espera el pase, rollos que prende el catálogo, service worker).
Cada cambio busca un pedazo EXACTO del código de GP2: si GP2 tocó ese pedazo, el script se corta y dice cuál. Ahí hay que mirar
qué cambió en GP2 y actualizar el reemplazo de acá (nunca forzarlo).
"""
import argparse
import os
import re
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)


class Falta(Exception):
    pass


def sub(src, old, new, que):
    n = src.count(old)
    if n != 1:
        raise Falta(f"{que}: se esperaba encontrar 1 vez el pedazo de GP2 y está {n} veces:\n    {old[:120]!r}")
    return src.replace(old, new)


def cut(src, ini, fin, new, que):
    """Reemplaza desde `ini` (incluido) hasta `fin` (excluido)."""
    if src.count(ini) != 1:
        raise Falta(f"{que}: no está (o está repetido) el inicio {ini[:80]!r}")
    i = src.index(ini)
    j = src.find(fin, i)
    if j < 0:
        raise Falta(f"{que}: no está el final {fin[:80]!r}")
    return src[:i] + new + src[j:]


CABECERA = r'''"use strict";

/* ============================================================
   app.js — Registro Producción 3.0 · Cervantes · botonera de GP2 (v@VERSION@)
   GENERADO por tools/portar_botonera_gp2.py desde la tablet de GP2 (Produccion/RegistroApp/operarios_gp2.js de
   loekemeyer/Gestion-Productiva-2.0). Para traer un cambio de GP2 se vuelve a correr el script; no editar a mano lo que
   viene de GP2 (se pierde en el próximo port): lo propio de 3.0 vive en el script.
   Lo que cambia respecto de la tablet:
     · se entra con el CÓDIGO DE LA TV (4 números), no con Google. La base devuelve un PASE firmado, atado a este
       equipo, que vale hasta las 17:45 (o 3 h si se entra más tarde);
     · todo va por funciones del schema reg_prod_3_0 (cabecera Content-Profile) que exigen ese pase:
         reg_prod_3_0_bundle · reg_prod_3_0_registrar_evento · reg_prod_3_0_anular_evento · reg_prod_3_0_rollo_tomar · reg_prod_3_0_rollo_cerrar
       La base guarda la CRUDA tal cual vino y arma la PROCESADA en la misma transacción;
     · sin internet se carga igual: los toques quedan en la cola del celular y se envían, con su hora original, cuando hay
       pase e internet. El catálogo (empleados, matrices, envasado, rollos) se guarda en el celular para poder abrir sin señal;
     · STOCK Y ROLLOS (Fase 1c): los mueve la base, en la misma transacción que el toque (reg_prod_3_0_registrar_evento →
       GP2.fabricar_stock) y con reg_prod_3_0_tomar_rollo / _cerrar_rollo, siempre con el pase. Mientras la base no lo tenga, el
       catálogo no trae `rollos_activos` y el selector de rollo, «¿quedó resto?» y el botón CT de Eduardo quedan apagados.
     · ANULAR (el 🗑 del historial) devuelve el stock que había movido ese toque (Fase 1d, lo hace la base). Los rollos llevan un
       id anti-duplicado: un reintento no descuenta otro rollo ni cierra el siguiente (como los toques, que ya lo tenían).
   Eduardo Barrionuevo (legajo "19"): CT button + rollo en E/PR (sólo con rollos_activos).
   ============================================================ */

const APP_VERSION = "v@VERSION@";
const LEGAJO_EDUARDO = "19";

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
}'''

BUNDLE = '''const LS_BUNDLE = "rp3c_bundle";
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
}

'''

FLUSH = '''/* El toque como lo guarda la base: la fila PROCESADA sale de `p` (lo de toRpcPayload) y la CRUDA es `p.toque`, tal cual lo cargó el operario. */
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
    if (!q.length && !readRolloQueue().length && !readAnularQueue().length) return;
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
  } finally { flushing = false; }
}

'''

ROLLOS = '''/* Los rollos los maneja la base (Fase 1c): sólo se muestran si el catálogo dice rollos_activos. Si no se puede mandar al
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
// ANTI-DUPLICADO (Fase 1d, si el catálogo trae rollos_antiduplicado): cada llamada lleva un id propio que viaja en la cola, así que un
// reintento (la base lo hizo pero la respuesta no llegó) repite el MISMO id y la base no descuenta otro rollo ni cierra el siguiente.
function rollosAntiduplicado() { return D.rollos_antiduplicado === true; }
async function tomarRollo(legajo, comp_id, kg_por_rollo, matriz) {
  const args = { p_legajo: String(legajo), p_comp_id: Number(comp_id), p_kg_por_rollo: Number(kg_por_rollo), p_matriz: String(matriz), p_fecha: isoNow() };
  if (rollosAntiduplicado()) await llamarRollo("reg_prod_3_0_rollo_tomar", Object.assign({ p_id: uuidv4() }, args));
  else await llamarRollo("reg_prod_3_0_tomar_rollo", args);
}
async function cerrarRollo(legajo, quedoResto) {
  const args = { p_legajo: String(legajo), p_quedo_resto: !!quedoResto, p_fecha: isoNow() };
  if (rollosAntiduplicado()) await llamarRollo("reg_prod_3_0_rollo_cerrar", Object.assign({ p_id: uuidv4() }, args));
  else await llamarRollo("reg_prod_3_0_cerrar_rollo", args);
}

'''

SERVICE_WORKER = '''/* ============================================================
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
      const m = (await r.text()).match(/SW_VERSION\\s*=\\s*["']([^"']+)["']/);
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

'''


def portar_js(src, version):
    # 1) cabecera: transporte, equipo, entrada con el código de la TV (reemplaza el cliente de Google de GP2)
    i = src.find('"use strict";')
    j = src.find('const SB = GP2_SB();')
    if i < 0 or j < 0:
        raise Falta('cabecera: no está "use strict" o const SB = GP2_SB();')
    src = src[:i] + CABECERA.replace('@VERSION@', version) + src[j + len('const SB = GP2_SB();'):]
    # 2) catálogo con caché en el celular
    src = cut(src, 'async function cargarBundle() {', 'function nombreMatriz(n)', BUNDLE, 'catálogo')
    src = sub(src, '/* Shape real de registro_operarios_bundle():',
              '/* Shape real de reg_prod_3_0_bundle() (el de registro_operarios_bundle() de GP2, con pase; `rollos_activos` desde la Fase 1c):',
              'comentario del catálogo')
    # 3) claves propias (el origen lo comparten todas las apps del sitio)
    src = sub(src, 'const LS_PREFIX  = "gp2_op_state";', 'const LS_PREFIX  = "rp3c_state";', 'clave del estado')
    src = sub(src, 'const LS_QUEUE   = "gp2_op_queue";', 'const LS_QUEUE   = "rp3c_queue";', 'clave de la cola')
    # 4) la cola de rollos de GP2 se reemplaza por la de 3.0 (va con las funciones de rollo)
    src = cut(src, '/* Cola aparte para las RPCs de rollo', '/* Cola de ANULACIONES', '', 'cola de rollos de GP2')
    src = sub(src, 'const LS_AQUEUE = "gp2_op_aqueue";', 'const LS_AQUEUE = "rp3c_aqueue";', 'clave de la cola de bajas')
    src = sub(src, '(anular_evento_prod devuelve el stock una sola vez)', '(reg_prod_3_0_anular_evento devuelve el stock una sola vez)', 'comentario de la cola de bajas')
    # 5) markSent limpia el último error (GP2 lo trae desde 20261007f; si deja de traerlo, avisar)
    if 'if (item) { item.status = "sent"; item.sentAt = isoNow(); delete item.lastError; }' not in src:
        raise Falta('markSent ya no borra lastError')
    # 6) envío con el pase + toque crudo + cola de rollos
    src = cut(src, 'let flushing = false;', '/* ============================================================\n   LLEGADA TARDE', FLUSH, 'flushQueue')
    # 7) rollos con pase (los prende el catálogo)
    src = cut(src, '/* ROLLOS SIN DUPLICADO', '/* ============================================================\n   UI helpers', ROLLOS, 'rolloLlamada/tomarRollo/cerrarRollo')
    src = sub(src, 'const all = isEd ? [...OPTIONS, CT_OPTION] : OPTIONS;',
              'const all = (isEd && rollosActivos()) ? [...OPTIONS, CT_OPTION] : OPTIONS;', 'botón CT')
    src = sub(src, '''function actualizarRolloPicker(n_matriz) {
  const grid = $("rolloGrid");
  if (!grid) return;''', '''function actualizarRolloPicker(n_matriz) {
  const grid = $("rolloGrid");
  if (!grid) return;
  if (!rollosActivos()) { rolloSel = null; grid.innerHTML = ""; $("rolloPicker")?.classList.add("hidden"); return; }   // sin rollos en la base''',
              'selector de rollo')
    src = sub(src, 'if (isEduardo() && opt.code === "PR") {', 'if (rollosActivos() && isEduardo() && opt.code === "PR") {', '«quedó resto»')
    # 7b) lista de matrices vacía hasta escribir: desde GP2 e110890 (v1.251.1) lo trae la tablet misma; si GP2 lo saca, avisar
    if 'if (!q) { grid.innerHTML = ""; return; }' not in src:
        raise Falta('lista de matrices: GP2 ya no la deja vacía hasta escribir (Elías, 08/10)')
    # 8) badge de la cola + aviso del código
    if 'const q = readQueue().concat(readAnularQueue(), readRolloQueue());' not in src:
        raise Falta('badge: ya no cuenta eventos + bajas + rollos')
    src = sub(src, '''  el.innerText = q.length ? `⚠ ${q.length} sin enviar` : `✓ al día`;''',
              '''  const espera = q.length > 0 && !paseVigente();
  el.innerText = espera ? `📺 ${q.length} esperan el código` : q.length ? `⚠ ${q.length} sin enviar` : `✓ al día`;''', 'badge: texto')
    src = sub(src, '''  el.style.color = q.length ? "#9a3412" : "#475569";
}''', '''  el.style.color = q.length ? "#9a3412" : "#475569";
  actualizarAvisoRed(q.length);
}''', 'badge: aviso')
    # 9) anular en la base (con pase)
    src = cut(src, '''  } else if (item.id && item.status === "sent") {''', '  s.last2.splice(idx, 1);', '''  } else if (item.id && item.status === "sent") {
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

''', 'anular')
    # 10) registro del legajo en el equipo
    src = sub(src, '''  $("btnBackLabel").innerText = `${nombre} · Legajo ${legajo}`;''', '''  $("btnBackLabel").innerText = `${nombre} · Legajo ${legajo}`;
  registrarLegajoEnEquipo(legajo, nombre);''', 'registro del legajo')
    # 11) service worker
    src = sub(src, '''/* ============================================================
   INIT
   ============================================================ */''', SERVICE_WORKER + '''/* ============================================================
   INIT
   ============================================================ */''', 'service worker')
    # 12) INIT: entrada, catálogo, service worker, volver a la app / volver internet
    src = sub(src, '''  // Cargar bundle en background
  cargarBundle().catch(e => console.warn("Bundle GP2:", e));''', '''  // Antes de entrar: el código de la TV (si falta el pase). Hasta que haya pase, el catálogo sale de lo guardado en el celular.
  verificarEntrada();
  cargarBundle().catch(e => console.warn("Bundle:", e));
  registrarServiceWorker();''', 'INIT')
    src = sub(src, '''  setInterval(async () => {
    await flushQueue();
    renderSyncBadge();
    renderSummary();
  }, 60000);''', '''  setInterval(async () => {
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
  window.addEventListener("offline", renderSyncBadge);''', 'INIT: intervalo y eventos')
    # control: no puede quedar nada que hable con GP2 directo
    for prohibido in ('SB.rpc', 'GP2_SB', 'registro_operarios_bundle"', 'registrar_evento_prod"', 'anular_evento_prod"', '"tomar_rollo"', '"cerrar_rollo"'):
        if prohibido in src:
            raise Falta(f'quedó una llamada directa a GP2: {prohibido} (GP2 agregó una llamada nueva: hay que portarla a reg_prod_3_0)')
    return src


def portar_html(src, version):
    src = sub(src, '<script src="../../auth-guard.js?v=20261006b"></script>\n', '', 'auth-guard') if '../../auth-guard.js?v=20261006b' in src \
        else re.sub(r'<script src="\.\./\.\./auth-guard\.js\?v=[^"]*"></script>\n', '', src)
    if 'auth-guard.js' in src:
        raise Falta('html: quedó auth-guard.js')
    src = sub(src, '<meta name="apple-mobile-web-app-title" content="Operarios GP2" />', '<meta name="apple-mobile-web-app-title" content="Registro" />', 'html: título app')
    src = sub(src, '<title>Operarios GP2</title>', '<title>Registro Produccion</title>\n  <link rel="manifest" href="manifest.json" />\n  <link rel="icon" href="data:," />', 'html: título')
    src, n = re.subn(r"var MI_V = '[^']*';", f"var MI_V = '{version}';", src)
    if n != 1:
        raise Falta('html: MI_V')
    src = sub(src, "html.match(/operarios_gp2\\.js\\?v=([\\w.]+)/)", "html.match(/app\\.js\\?v=([\\w.]+)/)", 'html: auto-recarga')
    src = sub(src, "var flag = 'gp2_reload_' + m[1];", "var flag = 'rp3c_reload_' + m[1];", 'html: auto-recarga (flag)')
    src = sub(src, '  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>\n', '', 'html: supabase-js')
    src, n = re.subn(r'<button id="btnMenu" title="[^"]*" onclick="location\.href=\'[^\']*\'">',
                     '<button id="btnMenu" title="Volver al inicio (elegir planta)" onclick="location.href=\'../\'">', src)
    if n != 1:
        raise Falta('html: botón Menú')
    src, n = re.subn(r'<script src="\.\./\.\./supabase-config\.js\?v=[^"]*"></script>\n<script src="operarios_gp2\.js\?v=[^"]*"></script>',
                     f'<script src="app.js?v={version}"></script>', src)
    if n != 1:
        raise Falta('html: scripts del final')
    return src


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--gp2', required=True, help='clon de loekemeyer/Gestion-Productiva-2.0')
    ap.add_argument('--version', required=True, help='versión nueva de cervantes-gp2, serie 3.1.N (sin la v)')
    ap.add_argument('--salida', default=os.path.join(RAIZ, 'cervantes-gp2'))
    a = ap.parse_args()
    if not re.fullmatch(r'3\.1\.\d+', a.version):
        sys.exit('La versión de cervantes-gp2 es de la serie 3.1.N (ej. 3.1.2).')
    origen = os.path.join(a.gp2, 'Produccion', 'RegistroApp')
    js = open(os.path.join(origen, 'operarios_gp2.js'), encoding='utf8').read()
    html = open(os.path.join(origen, 'Operarios_GP2.html'), encoding='utf8').read()
    try:
        js2 = portar_js(js, a.version)
        html2 = portar_html(html, a.version)
    except Falta as e:
        sys.exit('NO SE PORTÓ NADA — GP2 cambió algo que este script reemplaza:\n  ' + str(e))
    open(os.path.join(a.salida, 'app.js'), 'w', encoding='utf8').write(js2)
    open(os.path.join(a.salida, 'index.html'), 'w', encoding='utf8').write(html2)
    sw = os.path.join(a.salida, 'sw.js')
    s = open(sw, encoding='utf8').read()
    s, n = re.subn(r'const SW_VERSION = "v[^"]*";', f'const SW_VERSION = "v{a.version}";', s)
    if n != 1:
        sys.exit('sw.js: no está SW_VERSION')
    open(sw, 'w', encoding='utf8').write(s)
    print(f'cervantes-gp2 portado desde {origen} → v{a.version} (app.js {len(js2.splitlines())} líneas). Revisar con: git diff cervantes-gp2/')


if __name__ == '__main__':
    main()
