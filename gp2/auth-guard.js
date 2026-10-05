/* ============================================================
   INTERRUPTOR DEL LOGIN — una sola linea prende y apaga todo.

     false = SUELTO. No pide login: se entra directo al menu.
     true  = con login de Google + whitelist (HOY).

   APAGADO el 2026-08-29 ("la pagina ya esta privada... prefiero que este
   suelto") y PRENDIDO DE NUEVO el 2026-09-28 por el usuario, como fase A del
   punto 1 de la auditoria de seguridad (SEGURIDAD_GP2_2026-09-28.md).

   POR QUE MOLESTABA ANTES y ya no: el guard viejo deslogueaba apenas vencia el
   token de acceso (dura 1 hora), y como las pantallas usaban un cliente SIN
   sesion, nadie lo renovaba -> Google de nuevo cada hora. Ahora GP2_SB() usa la
   sesion guardada y la renueva sola, y el guard solo pide login si no hay
   sesion (no hay refresh_token). Un token de acceso vencido es normal: el
   cliente lo renueva con el refresh_token al primer pedido.

   Al volver del login se regresa a la MISMA pantalla (?next=), asi un monitor
   o una tablet que se reinicia no queda parado en el menu.

   OJO, lo que este interruptor NO cambia: el login siempre fue una tranquera
   de PANTALLA, no una barrera de datos. La clave anon viaja en el HTML de
   cada pagina, asi que quien tenga la URL siempre pudo llamar a las RPCs.
   Lo que de verdad protege la base es la RLS + que toda escritura pase por
   RPCs SECURITY DEFINER que validan. Eso sigue igual, prendido o apagado.
   ============================================================ */
var GP2_AUTH_ON = true;
window.GP2_AUTH_ON = GP2_AUTH_ON;

(function() {
  // 0) Login apagado -> no se controla nada, se entra suelto.
  if (!GP2_AUTH_ON) return;

  // 0b) Abierto como ARCHIVO (file://) -> no se controla. Asi abren las pantallas los
  //     tests de UI (Supabase stubeado); la app real va por https (Vercel) o http (Live
  //     Server) y ahi el guard actua siempre. Quien abre el HTML desde el disco ya tiene
  //     el codigo y la clave: el guard no le protege nada. test_login_flow.js prende
  //     GP2_GUARD_EN_FILE para probar el login de verdad.
  if (window.location.protocol === 'file:' && !window.GP2_GUARD_EN_FILE) return;

  // 1) Sin sesion guardada (no hay refresh_token) -> login. Supabase v2 guarda la
  //    sesion en localStorage bajo "sb-<projectref>-auth-token". Que el access_token
  //    este vencido NO es motivo: el cliente lo renueva con el refresh_token.
  if (!haySesionGuardada()) {
    sessionStorage.clear();
    redirigirLogin();
    return;
  }

  // 2) Pestana nueva (sessionStorage vacio): login la re-valida contra la whitelist
  //    y fija el rol SIN pedir Google (la sesion ya esta), y vuelve aca por ?next=.
  if (sessionStorage.getItem('gp_auth') !== 'ok') {
    redirigirLogin();
    return;
  }

  // 2b) Pantalla aceptada: si DESPUES se cae la sesion (el refresh_token deja de valer y
  //     supabase-js la descarta), GP2_SB() llama a esto y se vuelve al login. Sin esto la
  //     pantalla seguia andando como anonimo: leia bien y al grabar la base contestaba
  //     "permission denied for function ..." (29/09, Tablet recibiendo Charcas).
  window.GP2_IR_AL_LOGIN = function () { sessionStorage.clear(); redirigirLogin(); };

  // 3) Si el role es "envios", restringir las paginas accesibles.
  var role = sessionStorage.getItem('gp_role') || 'admin';
  if (role === 'envios') {
    var path = decodeURIComponent(window.location.pathname).toLowerCase();
    var permitidos = [
      'envios-only.html',
      // Tall
      'talleristas/envios/enviostalleristas_gp2.html',
      'talleristas/recepcion/entregastalleristas_gp2.html',
      'talleristas/recepcion/recepcionvirgilio_gp2.html',
      'talleristas/recepcion/devolucioncervantes_gp2.html',
      // Prov Serv
      'prov serv/envios/enviosps_gp2.html',
      'prov serv/entregas/entregaps_gp2.html',
      // Recepción Insumos (GP2; la vieja StockFlejes/recepcion.html se borro el 2026-09-12)
      'stockflejes/recepcioninsumos_gp2.html',
      // Relevamiento (insumos - logística): el GP2 nativo, el viejo se borro el 2026-09-04
      'relevamiento/relevamiento_gp2.html',
      // Avanzado (solo pantalla grande, gated por CSS en envios-only.html)
      'produccion/monitor_gp2.html',
      'produccion/maestro_gp2.html',
      // Calculadoras
      'calculadora.html',
      'calculadora-basica.html',
      'calcularcajones_gp2.html',
      'login.html'
    ];
    var ok = permitidos.some(function(p){ return path.indexOf(p) !== -1; });
    if (!ok) {
      var script2 = document.querySelector('script[src*="auth-guard"]');
      var src2 = script2.getAttribute('src');
      window.location.replace(src2.replace('auth-guard.js', 'envios-only.html'));
    }
  }

  // ---- helpers ----

  function redirigirLogin(qs) {
    var script = document.querySelector('script[src*="auth-guard"]');
    var src = script.getAttribute('src');
    var dst = src.replace(/auth-guard\.js.*$/, 'login.html');
    var next = window.location.pathname + window.location.search;
    var q = (qs ? qs + '&' : '') + 'next=' + encodeURIComponent(next);
    dst += (dst.indexOf('?') === -1 ? '?' : '&') + q;
    window.location.replace(dst);
  }

  // Solo cuenta la sesion de ESTE proyecto (sb-<ref>-auth-token). Antes servia cualquier
  // "sb-*-auth-token": en loekemeyer.github.io el localStorage es uno solo para todas las
  // apps del dueno, y el token de otra app (otro proyecto Supabase) dejaba pasar la
  // pantalla sin sesion GP2.
  function haySesionGuardada() {
    try {
      var ses = JSON.parse(localStorage.getItem('sb-hrxfctzncixxqmpfhskv-auth-token') || 'null');
      // supabase-js v2 guarda {access_token, refresh_token, ...}; versiones viejas
      // lo anidaban en currentSession.
      ses = ses && (ses.currentSession || ses);
      if (ses && ses.refresh_token) return true;
    } catch (e) { console.warn('[auth-guard] sesion ilegible:', e); }
    return false;
  }

})();
