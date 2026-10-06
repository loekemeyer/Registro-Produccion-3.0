/* Candado de ENCODING — los HTML y los .js propios (inicio, virgilio/ y cervantes/) tienen que ser UTF-8 puro.

   POR QUÉ. El archivo es UTF-8 (`<meta charset="UTF-8">`) pero el 22/09 tenía 5 bytes sueltos
   en latin1/cp1252, metidos por sesiones que editaron con herramientas distintas. Dos NO eran
   un detalle de comentario: estaban en un string de JS que va al innerHTML —el chip «Mismo
   pedido» de A Programar— así que el navegador los decodificaba como U+FFFD y el operario veía
   «🧾 Mismo pedido � LK 0001 � $836.909» en vez del separador «·».

   Y ADEMÁS ROMPE LAS HERRAMIENTAS: con un byte inválido, cualquier script que abra el archivo
   como texto UTF-8 explota (UnicodeDecodeError), y abrirlo como latin1 para esquivarlo convierte
   TODOS los acentos buenos en mojibake y los reescribe así. O sea: un byte malo se multiplica.

   ⚠ El NUL de `_pppGeoCod` (separador de claves, escrito como carácter literal) es LEGÍTIMO y
   está contemplado: es UTF-8 válido, sólo hace que `grep` trate al archivo como binario.
   Sale 1 si falla. */
const fs = require("fs");
const path = require("path");

const ARCHIVOS = [
  "index.html", "sw.js",
  "virgilio/index.html", "virgilio/sw.js", "virgilio/recepcion.js", "virgilio/planimetria.js", "virgilio/supabase-config.js",
  "virgilio/cobranzas.js", "virgilio/importacion.js", "virgilio/hotsale.js",
  "cervantes/index.html", "cervantes/app.js", "cervantes/sw.js",
];
const fail = [];

for (const rel of ARCHIVOS) {
  const f = path.join(__dirname, "..", rel);
  if (!fs.existsSync(f)) continue;
  const b = fs.readFileSync(f);
  // Node no avisa: Buffer.toString('utf8') reemplaza lo inválido por U+FFFD en silencio.
  // Se compara el ida y vuelta, que es lo único que detecta el byte roto.
  if (!Buffer.compare(Buffer.from(b.toString("utf8"), "utf8"), b)) continue;

  // hay al menos un byte inválido: ubicarlo para que el mensaje sirva
  let i = 0;
  while (i < b.length) {
    const c = b[i];
    if (c < 0x80) { i++; continue; }
    let ok = false;
    for (const ln of [2, 3, 4]) {
      const trozo = b.subarray(i, i + ln);
      if (!Buffer.compare(Buffer.from(trozo.toString("utf8"), "utf8"), trozo)) { i += ln; ok = true; break; }
    }
    if (!ok) {
      const linea = b.subarray(0, i).toString("latin1").split("\n").length;
      const ctx = b.subarray(Math.max(0, i - 35), i + 35).toString("utf8").replace(/\n/g, "\\n");
      fail.push(`${rel}:${linea} — byte 0x${b[i].toString(16)} no es UTF-8 · …${ctx}…`);
      i++;
    }
  }
}

if (fail.length) {
  console.error("encoding-utf8 — FALLA (escribí el archivo en UTF-8, no en latin1):\n - " + fail.join("\n - "));
  process.exit(1);
}
console.log("encoding-utf8: OK — " + ARCHIVOS.length + " archivos, 0 bytes fuera de UTF-8.");
