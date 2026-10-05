/* =========================================================
   pwa.js — hace que cualquier pantalla forme parte de la PWA.

   Incluir con la ruta relativa a la raiz del proyecto y el token de version,
   igual que auth-guard.js:
     <script src="pwa.js?v=20260829h"></script>       (pantallas de la raiz)
     <script src="../pwa.js?v=20260829h"></script>    (pantallas de un modulo)

   Hace tres cosas:
   1. Inyecta <link rel="manifest"> y <meta name="theme-color"> si la pagina
      no los trae, asi una pantalla nueva no necesita tocar el <head>.
   2. Registra sw.js. El scope queda en la raiz del proyecto porque el archivo
      vive ahi, asi que la ventana de la app cubre TODOS los modulos.
   3. Deja window.GP2_PWA para poder ofrecer un boton "Instalar" mas adelante.

   La ruta base se deduce del src de este mismo script (mismo truco que usa
   auth-guard.js para encontrar login.html), asi funciona desde cualquier
   profundidad de carpetas sin hardcodear "../".
   ========================================================= */
(function () {
  var script =
    document.currentScript ||
    document.querySelector('script[src*="pwa.js"]');
  var base = "./";
  if (script) {
    var src = script.getAttribute("src") || "";
    // saca "pwa.js" y el ?v=... y deja el prefijo ("", "../", "../../", ...)
    base = src.replace(/pwa\.js(\?.*)?$/, "");
    if (!base) base = "./";
  }

  // --- 1) manifest + theme-color ---
  if (!document.querySelector('link[rel="manifest"]')) {
    var link = document.createElement("link");
    link.rel = "manifest";
    link.href = base + "manifest.json";
    document.head.appendChild(link);
  }
  if (!document.querySelector('meta[name="theme-color"]')) {
    var meta = document.createElement("meta");
    meta.name = "theme-color";
    meta.content = "#ffffff";
    document.head.appendChild(meta);
  }
  // iOS NO mira el manifest para el icono de "Agregar a inicio": mira
  // <link rel="apple-touch-icon">. Sin eso se inventa uno (el cuadrado negro con
  // la "G"). Se inyecta aca para que ninguna pantalla quede sin el, pero las
  // paginas desde las que se instala igual lo llevan escrito en el <head>: es mas
  // seguro que dependerlo del JS.
  if (!document.querySelector('link[rel="apple-touch-icon"]')) {
    var ati = document.createElement("link");
    ati.rel = "apple-touch-icon";
    ati.href = base + "apple-touch-icon.png?v=20260829j";
    document.head.appendChild(ati);
  }

  // --- 2) service worker ---
  // updateViaCache "none" para que el navegador nunca sirva un sw.js cacheado.
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker
        .register(base + "sw.js", { updateViaCache: "none" })
        .catch(function (e) {
          console.warn("[pwa] no se pudo registrar el service worker:", e);
        });
    });
  }

  // --- 3) instalacion ---
  // Chrome dispara beforeinstallprompt cuando la app cumple los requisitos.
  // Lo guardamos para que una pantalla pueda ofrecer su propio boton.
  var promptGuardado = null;
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    promptGuardado = e;
  });

  window.GP2_PWA = {
    instalable: function () { return !!promptGuardado; },
    instalar: function () {
      if (!promptGuardado) return Promise.resolve(false);
      promptGuardado.prompt();
      return promptGuardado.userChoice.then(function (r) {
        promptGuardado = null;
        return r && r.outcome === "accepted";
      });
    },
    // true cuando corre en ventana propia (instalada o abierta con --app=).
    enVentanaPropia: function () {
      return (
        window.matchMedia("(display-mode: standalone)").matches ||
        window.navigator.standalone === true
      );
    }
  };
})();
