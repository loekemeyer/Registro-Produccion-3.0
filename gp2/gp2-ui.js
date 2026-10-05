/* gp2-ui.js — los helpers de PANTALLA de la casa, en un solo lugar.
 *
 * Existe porque cada pantalla GP2 traia su propia copia (auditoria A3 del
 * 2026-09-04): 40 esc() con tres implementaciones distintas, 33 $(), 6 clases
 * por signo, 12 "hoy" con tres semanticas (UTC, hora del dispositivo y zona
 * Argentina — las dos primeras corren el dia despues de las 21:00) y 3
 * exportar a CSV. Ahora la copia es UNA y las pantallas la toman de
 * window.GP2UI. Se carga suelto: no depende de nada. La regla de NUMERO no
 * vive aca sino en gp2-numero.js (GP2N.num / GP2N.fmt): un archivo, una regla.
 *
 *   GP2UI.esc(s)        texto -> HTML seguro (& < > ")
 *   GP2UI.$(id)         document.getElementById(id)
 *   GP2UI.cls(n)        "pos" | "neg" | "cero" segun el signo (clases de gp2-modulo.css)
 *   GP2UI.hoyAR()       hoy, YYYY-MM-DD, en Argentina (no importa el huso del aparato)
 *   GP2UI.hoyAR(-30)    hace 30 dias;  GP2UI.hoyAR(unDate) = ese instante, en fecha AR
 *   GP2UI.fechaAR(iso)  "2026-09-04" (o "2026-09-04T12:00") -> "04/09/2026"; lo que
 *                       no es ISO vuelve tal cual, y null/"" -> ""
 *   GP2UI.esCarton(item)  true si la fila es de carton (sector 10). GP2UI.SECTOR_CARTON
 *                       es ese 10, escrito UNA vez; acepta la fila o el sector_id suelto
 *   GP2UI.exportarCSV(nombre, filas)
 *                       baja un CSV que Excel es-AR abre en columnas: separador ";",
 *                       BOM + "sep=;", toda celda entre comillas, los numeros con
 *                       coma decimal. filas = [[celda, ...], ...] (la primera, el
 *                       encabezado). nombre sin ".csv" lo recibe solo.
 */
(function (global) {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function $(id) { return document.getElementById(id); }

  function cls(n) {
    n = Number(n || 0);
    return n > 0 ? "pos" : (n < 0 ? "neg" : "cero");
  }

  /* 'sv-SE' es el unico locale que Intl imprime directo como YYYY-MM-DD. */
  function hoyAR(x) {
    var d = x instanceof Date ? x : new Date(Date.now() + (Number(x) || 0) * 86400000);
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone: "America/Argentina/Buenos_Aires",
      year: "numeric", month: "2-digit", day: "2-digit"
    }).format(d);
  }

  function fechaAR(f) {
    if (!f) return "";
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(f));
    return m ? (m[3] + "/" + m[2] + "/" + m[1]) : String(f);
  }

  /* La FECHA de un timestamp, en dd/mm/aaaa y decidida en ARGENTINA.
     Distinto de fechaAR, que recorta un "YYYY-MM-DD" que ya viene resuelto: esto convierte de
     verdad. Habia dos copias que hacian new Date(f).toLocaleDateString("es-AR"), que resuelve
     en la zona del APARATO: un movimiento sellado a las 23:30 de Argentina se veia del dia
     siguiente en una tablet en UTC. [2026-09-12, hallazgo 14b del informe de logica duplicada] */
  function fechaTsAR(ts) {
    if (!ts) return "";
    var d = new Date(ts);
    return isNaN(d.getTime()) ? String(ts) : fechaAR(hoyAR(d));
  }

  function exportarCSV(nombre, filas) {
    var celda = function (v) {
      if (v == null) v = "";
      else if (typeof v === "number") v = String(v).replace(".", ",");
      return '"' + String(v).replace(/"/g, '""') + '"';
    };
    var lineas = (filas || []).map(function (f) { return (f || []).map(celda).join(";"); });
    var blob = new Blob(["﻿" + "sep=;\n" + lineas.join("\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = /\.csv$/i.test(nombre || "") ? nombre : ((nombre || "export") + ".csv");
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  /* El carton es el sector 10 y eso estaba escrito a mano en cinco lugares (dos pantallas):
     el dia que el carton deje de ser el 10 hay que tocar UN lugar, no buscar cinco.
     Es un PARCHE a proposito: lo que corresponde es que el bundle emita es_carton y la
     pantalla no sepa de numeros de sector. Mientras tanto el numero vive aca. (idea 7334) */
  var SECTOR_CARTON = 10;
  function esCarton(x) {
    if (x == null) return false;
    var sid = (typeof x === "object") ? x.sector_id : x;
    return Number(sid) === SECTOR_CARTON;
  }

  global.GP2UI = { esc: esc, $: $, cls: cls, hoyAR: hoyAR, fechaAR: fechaAR,
                   fechaTsAR: fechaTsAR, exportarCSV: exportarCSV,
                   SECTOR_CARTON: SECTOR_CARTON, esCarton: esCarton };
})(typeof window !== "undefined" ? window : this);
