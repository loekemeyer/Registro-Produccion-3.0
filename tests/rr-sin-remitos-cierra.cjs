/* Regresión v21.03 (Luis, 2026-09-22) — RR SIN REMITOS TIENE QUE CERRAR EL TOGGLE.

   EL CASO. El operario toca RR, la lista viene VACÍA ("no hay pedidos cargados al camión
   pendientes de control" — correcto), toca el botón y el módulo RR queda MARCADO EN ROJO:
   `updateCoreButtonsState` deshabilita los CORE_CODES mientras haya cualquier toggle abierto,
   así que EP y AP quedan trabados y el operario no puede empezar picking ni armado.

   LA CAUSA. El único botón del caso vacío era `crClose()`, que MINIMIZA a propósito (RR sigue
   abierto, se re-abre tocando RR). El toggle RR ya se había abierto al tocar el botón, y nada
   lo cerraba. CC (`ccEndWithoutLoading`) y CR (`ccrEndWithout`) ya tenían su escape; RR no.

   QUÉ SE PRUEBA, corriendo la pantalla de verdad (un candado de texto no ve si el toggle
   quedó abierto):
     1. lista vacía  → el botón cierra el toggle RR y NO manda ningún CRN;
     2. lista vacía como ADMIN (openRemitosAdmin, legajo "0", sin botonera) → NO emite RR;
     3. error de carga → el operario también puede cerrar el toggle;
     4. con remitos → sigue mandando CRN y cerrando por «Terminé» (no se rompió lo que andaba);
     5. el CHOOSER de Carga Camión (v21.05) → mismo pozo: era la otra pantalla que abría el
        toggle y sólo ofrecía minimizar. Son los TRES módulos cuyo botón RE-ABRE el popup en vez
        de cerrar el toggle (CC, RR, CR); en el resto, tocar el botón de nuevo lo cierra.
   Sale 1 si falla. */
const path = require("path");
let chromium;
try { ({ chromium } = require("/opt/node22/lib/node_modules/playwright")); }
catch (_e) { try { ({ chromium } = require("playwright")); } catch (_e2) { console.error("no playwright"); process.exit(2); } }

(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  p.on("dialog", (d) => d.accept());
  await p.goto("file://" + path.join(__dirname, "..", "virgilio", "index.html"), { waitUntil: "domcontentloaded" });

  const r = await p.evaluate(async () => {
    const out = {};

    // caso: "vacio" | "error" | "conRemitos";  admin: abre como supervisor (legajo "0")
    async function correr(caso, admin) {
      const st = { toggles: admin ? {} : { RR: "2026-09-22T12:00:00.000Z" }, picking: {}, armado: {} };
      const log = { cerroToggle: [], eventos: [] };
      window.getLegajoState = function () { return st; };
      window.toggleStartOrEnd = function (leg, code) { log.cerroToggle.push(code); delete st.toggles[code]; };
      window.enqueueReport = function (pl) { log.eventos.push(pl.opcion); };
      window.trySendOneReport = function () { return Promise.resolve({ ok: false }); };
      window.pushHistoryForLegajo = function () {};
      window.updatePendingIndicator = function () {};
      window.updateCoreButtonsState = function () {};
      window.fetch = function (url) {
        if (String(url).indexOf("gv_vista_control_remitos") >= 0) {
          if (caso === "error") return Promise.resolve({ ok: false, status: 500 });
          const rows = caso === "vacio" ? [] : [{
            np: "LK 0001", tanda: "E12A", first_load: new Date().toISOString(),
            lios: 1, clase: "", cajas: 3, cod_cliente: "123", rs: "PRUEBA", remito: "0001"
          }];
          return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(rows); } });
        }
        return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve([]); } });
      };

      await window.showControlRemitos(admin ? "0" : "12", !!admin);
      const body = document.querySelector("#tandaModal .tanda-modal-body");
      const html = body ? body.innerHTML : "";
      // aprieta el BOTÓN PRINCIPAL (el primero), que es el que tocaría el operario
      const btn = body ? body.querySelector("button") : null;
      const texto = btn ? btn.textContent.trim() : "";
      if (btn) btn.click();
      return { html: html, texto: texto, cerro: log.cerroToggle, ev: log.eventos, rrAbierto: !!st.toggles.RR };
    }

    out.vacio      = await correr("vacio", false);
    out.vacioAdmin = await correr("vacio", true);
    out.error      = await correr("error", false);

    // 4) con remitos: sigue haciendo falta «Terminé» (crFinish), el camino que ya andaba
    const st4 = await correr("conRemitos", false);
    out.conRemitosHtml = st4.html;

    // 5) el chooser de Carga Camión (la 1ª pantalla de CC, antes de saber si hay reparto)
    window.closeTandaModal = function () {};
    window.ccRenderChooser("12");
    const bodyCC = document.querySelector("#tandaModal .tanda-modal-body");
    out.chooserCC = bodyCC ? bodyCC.innerHTML : "";
    return out;
  });

  const fail = [];
  if (errs.length) fail.push("errores de página: " + errs.join(" | "));

  // 1) vacío, operario: el toggle RR tiene que quedar CERRADO y NO se manda ningún CRN
  if (r.vacio.rrAbierto) fail.push("1) lista vacía: el toggle RR quedó ABIERTO (traba EP/AP) — es el bug");
  if (r.vacio.cerro.indexOf("RR") < 0) fail.push("1) lista vacía: no se cerró el toggle RR");
  if (r.vacio.ev.indexOf("CRN") >= 0) fail.push("1) lista vacía: mandó un CRN y no hay nada controlado");
  if (r.vacio.ev.indexOf("RR") < 0) fail.push("1) lista vacía: no se emitió el evento RR de cierre");
  if (!/crEndWithout/.test(r.vacio.html)) fail.push("1) el caso vacío no ofrece crEndWithout");

  // 2) vacío, ADMIN (legajo 0, sin botonera): no puede emitir un RR huérfano
  if (r.vacioAdmin.ev.indexOf("RR") >= 0) fail.push("2) admin: emitió un evento RR sin tener toggle");
  if (r.vacioAdmin.cerro.length) fail.push("2) admin: intentó cerrar un toggle que no existe");

  // 3) error de carga: el operario también tiene que poder cerrar
  if (r.error.rrAbierto) fail.push("3) error de carga: el toggle RR quedó ABIERTO");
  if (r.error.ev.indexOf("RR") < 0) fail.push("3) error de carga: no se emitió el cierre de RR");

  // 4) con remitos NO se cierra solo: sigue haciendo falta «Terminé» (o «Cerrar (sigo después)»)
  if (!/crFinish\(\)/.test(r.conRemitosHtml)) fail.push("4) con remitos: se perdió el botón «Terminé» (crFinish)");
  if (/crEndWithout/.test(r.conRemitosHtml)) fail.push("4) con remitos: NO va el escape — hay que controlar o minimizar");

  // 5) el chooser de CC tiene que ofrecer el cierre de verdad, no sólo minimizar
  if (!/ccEndWithoutLoading/.test(r.chooserCC))
    fail.push("5) el chooser de Carga Camión sólo minimiza: CC queda abierto y traba EP/AP");
  if (!/ccClose\(\)/.test(r.chooserCC))
    fail.push("5) el chooser de Carga Camión perdió el «Cerrar (sigo después)»");

  await b.close();
  if (fail.length) { console.error("RR sin remitos — FALLA:\n - " + fail.join("\n - ")); process.exit(1); }
  console.log("rr-sin-remitos-cierra: OK (vacío cierra el toggle · admin no emite RR · error cierra · con remitos sigue pidiendo «Terminé» · chooser de CC con escape)");
})();
