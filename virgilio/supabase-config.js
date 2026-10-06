/* =========================================================================
   CONFIG COMPARTIDA SUPABASE — proyecto Virgilio ("Control Partes Talleristas",
   hrxfctzncixxqmpfhskv). Idea normalizar-datos (TOP-10, v11.101).

   ÚNICO lugar del repo donde vive la URL + publishable key de Virgilio.
   Rotar la key = editar SOLO este archivo (+ bump APP_VERSION/SW_VERSION y los
   ?v= de este script para invalidar cache).

   Consumidores (los 6 que antes tenían la key hardcodeada):
   - index.html        → <script src="supabase-config.js?v=...">
   - recepcion.js      → módulo, lee los globals (index.html ya cargó esto antes)
   - sw.js             → importScripts("supabase-config.js")
   - fichada.html      → carga esto antes de fichada-config.js
   - fichadas-monitor.html / productividad.html → <script src>

   ⚠ La key de LK (kwkclwhmoygunqmlegrg) es OTRA y vive en admin/admin.js
   (index.html tuvo una copia propia para el viejo módulo Deuda — se borró
   2026-09-01 al reemplazarlo por Deudores, que no toca LK) — no la mezcla acá.
   ========================================================================= */
(function (g) {
  g.VIR_SUPABASE_URL = "https://hrxfctzncixxqmpfhskv.supabase.co";
  g.VIR_SUPABASE_KEY = "sb_publishable_BqpAgZH6ty-9wft10_YMhw_0rcIPuWT";
})(typeof self !== "undefined" ? self : globalThis);

/* ═══════════════════════════════════════════════════════════════════════════
   v20.52 (Luis, 2026-09-21) — EL TOPE DE 1.000 FILAS DE PostgREST, TAPADO PARA
   TODA LA APP, SIN TOCAR LA CONFIGURACIÓN DEL PROYECTO
   ═══════════════════════════════════════════════════════════════════════════
   Pedido: *"quiero que esto quede cubierto sin el cambio global al proyecto"*.

   EL PROBLEMA. PostgREST corta toda respuesta en 1.000 filas (`db-max-rows`) y
   el `limit=` de la URL NO lo levanta: un `limit=20000` contesta **200** con las
   primeras 1.000 y **nada dice que falten**. No hay error, no hay 403. Es lo que
   se comió la v20.45 (`LK 0027` quedaba afuera del corte y el pedido a Misiones
   no se pintaba) y lo que puede comerse cualquier pantalla el día que su tabla
   crezca.

   POR QUÉ NO SE SUBE `db-max-rows`. Es configuración del PROYECTO, y contra esta
   misma base pegan también Producción Virgilio y los admin de Cervantes. Subirlo
   haría que una consulta sin `limit` sobre `Movimientos_Stock` (63 mil filas)
   pase de traer 1.000 a traer todo. El riesgo no es de esta app y el arreglo sí
   puede serlo.

   LA SOLUCIÓN. Se envuelve `fetch` UNA vez, acá, que es el único archivo que
   cargan TODAS las páginas (index, monitor/tv, fichada, fichadas-monitor,
   productividad) y también el service worker. Si una respuesta de `/rest/v1/`
   llega justo con 1.000 filas, se piden las que faltan con `offset` y se
   devuelve una Response con todo junto. El que llamó no se entera: recibe su
   array completo.

   CUÁNDO COMPLETA, Y CUÁNDO NO (la regla que evita romper a los que sí querían
   un tope):
     · sin `limit=` en la URL, o con `limit=` MAYOR a 1.000  → completa.
       Ese número era el techo que el autor CREYÓ estar pidiendo.
     · con `limit=` menor o igual a 1.000 → NO toca nada: el que llamó pidió
       esa cantidad y la recibió. Por eso `gvRestTodo`, que pagina a mano con
       `limit=1000`, no entra acá y no hay recursión posible.

   CÓMO SE DA CUENTA, Y POR QUÉ ES BARATO. Por el header `Content-Range`
   (`0-999/*`), que PostgREST manda siempre y que **el navegador puede leer**:
   medido el 21/09 con un `Origin` real, `Access-Control-Expose-Headers` incluye
   `Content-Range`. Cuando la respuesta NO llegó al tope —que es siempre— el
   costo es leer un header y nada más: no se toca el body.

   `offset` anda igual en una tabla, en una vista y en un `rpc` POST (medido:
   `rpc/gv_np_destino_lista?offset=500` → `Content-Range: 500-899/*`).

   ⚠ Si algo sale mal adentro del envoltorio, devuelve la respuesta original sin
   tocarla. Nunca puede dejar una pantalla sin datos por su culpa.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (g) {
  if (!g || typeof g.fetch !== "function" || g.__GV_REST_TOPE__) return;
  g.__GV_REST_TOPE__ = true;
  /* El tope real del proyecto. Si algún día se sube `db-max-rows`, este número
     sigue siendo seguro: sólo dejaría de hacer falta. */
  var TOPE = 1000;
  var MAX_PAGINAS = 200;            // 200.000 filas; guarda anti-loop
  var orig = g.fetch.bind(g);

  function urlDe(input) {
    if (typeof input === "string") return input;
    if (input && typeof input.url === "string") return input.url;
    try { return String(input); } catch (_e) { return ""; }
  }
  /* El `limit=` que pidió el que llamó, o null si no pidió ninguno. */
  function limitDe(url) {
    var m = /[?&]limit=(\d+)/.exec(url);
    return m ? parseInt(m[1], 10) : null;
  }
  function conOffset(url, off) {
    var base = url.replace(/([?&])offset=\d+&?/g, "$1").replace(/[?&]$/, "");
    return base + (base.indexOf("?") >= 0 ? "&" : "?") + "offset=" + off;
  }

  g.fetch = function (input, init) {
    var pedido = orig(input, init);
    return pedido.then(function (resp) {
      try {
        var url = urlDe(input);
        if (!url || url.indexOf("/rest/v1/") < 0) return resp;
        if (!resp || !resp.ok) return resp;
        var cr = resp.headers && resp.headers.get && resp.headers.get("content-range");
        var m = cr && /^(\d+)-(\d+)\//.exec(cr);
        if (!m) return resp;                               // sin rango: no es una lista
        var ini = parseInt(m[1], 10), fin = parseInt(m[2], 10);
        if (fin - ini + 1 < TOPE) return resp;             // no llegó al tope: nada que hacer
        var lim = limitDe(url);
        if (lim !== null && lim <= TOPE) return resp;      // pidió ese tope a propósito
        return completar(resp, url, init, ini, fin);
      } catch (_e) { return resp; }
    });
  };

  function completar(resp, url, init, ini, fin) {
    return resp.text().then(function (txt) {
      var filas;
      try { filas = JSON.parse(txt); } catch (_e) { return new Response(txt, resp); }
      if (!Array.isArray(filas)) return new Response(txt, resp);
      var off = fin + 1, paginas = 0;
      function siguiente() {
        if (paginas++ >= MAX_PAGINAS) return Promise.resolve();
        return orig(conOffset(url, off), init).then(function (r) {
          if (!r || !r.ok) return;
          return r.json().then(function (p) {
            if (!Array.isArray(p) || !p.length) return;
            for (var i = 0; i < p.length; i++) filas.push(p[i]);
            off += p.length;
            if (p.length >= TOPE) return siguiente();
          });
        }).catch(function () { /* lo que se juntó hasta acá es mejor que nada */ });
      }
      return siguiente().then(function () {
        var h = new Headers(resp.headers);
        try { h.set("content-range", ini + "-" + (ini + filas.length - 1) + "/*"); } catch (_e) {}
        try { h.set("x-gv-completado", String(filas.length)); } catch (_e) {}
        return new Response(JSON.stringify(filas),
          { status: resp.status, statusText: resp.statusText, headers: h });
      });
    }).catch(function () { return resp; });
  }
})(typeof self !== "undefined" ? self : globalThis);
