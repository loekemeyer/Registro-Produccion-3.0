/* Servidor estático mínimo para las pruebas que necesitan http:// (service workers, rutas relativas entre
   carpetas, redirecciones). Sirve la raíz del repo. Uso: const { servir } = require("./_servidor.cjs"); */
const http = require("http");
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..");
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
};

function servir() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let rel = decodeURIComponent((req.url || "/").split("?")[0]);
      if (rel.endsWith("/")) rel += "index.html";
      const f = path.normalize(path.join(RAIZ, rel));
      if (!f.startsWith(RAIZ) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end("no existe"); return; }
      res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream", "Cache-Control": "no-store" });
      fs.createReadStream(f).pipe(res);
    });
    srv.listen(0, "127.0.0.1", () => resolve({
      url: "http://127.0.0.1:" + srv.address().port,
      cerrar: () => new Promise((r) => srv.close(r)),
    }));
  });
}

module.exports = { servir };
