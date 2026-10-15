/* Virgilio de 3.0 al día con la botonera de Gestión Virgilio (D2, Luis 15/10/2026: «sí»).

   Corre tools/traer_de_gv.cjs --revisar contra un clon de Gestion-Virgilio (sólo lo LEE) y falla si GV cambió algo del operario
   que acá todavía no está, o si hay un choque sin resolver. También falla si el script deja de reproducir virgilio/ tal cual
   (la «vuelta exacta»): eso quiere decir que alguien tocó virgilio/ a mano de una forma que el script no sabe leer.

   Dónde busca el clon: $GV_REPO, o ../Gestion-Virgilio al lado de este repo. Compara contra origin/main del clon si existe
   (hacer antes `git -C <clon> fetch origin main`), si no contra HEAD. Sin clon no hay contra qué comparar: dice SALTEADA y sale 0
   (no se inventa un verde ni un rojo).
   Para ponerlo al día: node tools/traer_de_gv.cjs --gv <clon> --hasta origin/main --version 30.NN */
const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const RAIZ = path.join(__dirname, "..");
const gv = process.env.GV_REPO || path.join(RAIZ, "..", "Gestion-Virgilio");
if (!fs.existsSync(path.join(gv, "index.html")) || !fs.existsSync(path.join(gv, ".git"))) {
  console.log(`virgilio-al-dia-con-gv: SALTEADA — no hay clon de Gestion-Virgilio en ${gv} (GV_REPO=…)`);
  process.exit(0);
}
let hasta = "HEAD";
try { cp.execFileSync("git", ["-C", gv, "rev-parse", "--verify", "-q", "origin/main"], { stdio: "ignore" }); hasta = "origin/main"; } catch (_e) {}

const r = cp.spawnSync("node", [path.join(RAIZ, "tools", "traer_de_gv.cjs"), "--gv", gv, "--hasta", hasta, "--revisar"], { encoding: "utf8", maxBuffer: 1 << 28 });
const salida = (r.stdout || "") + (r.stderr || "");
if (r.status === 0) {
  console.log(`virgilio-al-dia-con-gv: al día con GV ${hasta} · ✓ OK`);
  process.exit(0);
}
console.log(salida.split("\n").slice(0, 40).join("\n"));
if (r.status === 3) {
  console.log(`\nvirgilio-al-dia-con-gv: ✗ GV tiene cambios de operario sin traer.\n  node tools/traer_de_gv.cjs --gv ${gv} --hasta ${hasta} --version 30.NN`);
} else {
  console.log("\nvirgilio-al-dia-con-gv: ✗ el script se cortó (ver arriba)");
}
process.exit(1);
