/* =========================================================
   supabase-config.js — la URL y la clave anon de GP2, en UN solo lugar.

   ROTAR LA CLAVE = EDITAR SOLO ESTE ARCHIVO (y bumpear su ?v= en los HTML).
   Antes la clave estaba escrita a mano en 112 archivos: rotarla significaba
   tocarlos todos y rezar que no se escapara ninguno. Mismo criterio que usa
   Produccion Virgilio, que ya lo tenia resuelto asi.

   NO es un secreto: la clave anon viaja igual en el HTML de cada pagina, y
   siempre fue asi. Lo que protege la base es la RLS (anon solo lee) mas que
   toda escritura pase por RPCs SECURITY DEFINER que validan. Esto no cambia
   la seguridad — cambia que haya UN lugar donde tocarla.

   Se expone con los cuatro nombres que ya usaban las pantallas, para no tener
   que reescribir el codigo de cada una:
     SUPABASE_URL / SB_URL          -> la URL del proyecto
     SUPABASE_KEY / SUPABASE_ANON_KEY / SB_ANON -> la clave anon

   Van en self a proposito: en una pagina self===window, asi el codigo las ve como
   variables sueltas (SUPABASE_URL) sin declararlas — que es como ya estaban
   escritas — y ademas el archivo sirve dentro de un service worker (importScripts).
   ========================================================= */
self.SUPABASE_URL = "https://hrxfctzncixxqmpfhskv.supabase.co";
self.SUPABASE_KEY = "sb_publishable_BqpAgZH6ty-9wft10_YMhw_0rcIPuWT";

// Alias: los mismos valores con los otros nombres que ya existian en el codigo.
self.SUPABASE_ANON_KEY = self.SUPABASE_KEY;
self.SB_URL            = self.SUPABASE_URL;
self.SB_ANON           = self.SUPABASE_KEY;

/* El cliente GP2, UNA sola vez (2026-09-05): schema GP2 y sin sesion persistida. Antes cada
   pantalla escribia su propio createClient (40 copias, cinco formas distintas). Se resuelve
   al llamarlo, asi no importa si el CDN de supabase-js se cargo antes o despues de este
   archivo. En un service worker no hay cliente (no hay window.supabase). */
/* GP2_SB() — el cliente GP2, UNO por pagina.
   Desde el 2026-09-28 (seguridad punto 1, fase A) usa la SESION del login: lee la
   que dejo login.html en localStorage, manda su JWT en cada pedido (la base ve al
   usuario, no a un anonimo) y la renueva sola antes de que venza. Antes era
   "sin sesion" y todo llegaba a la base como anon.
   Es un singleton a proposito: dos clientes con sesion en la misma pagina se
   pisan al renovar el mismo refresh_token y el segundo desloguea al usuario.
   Con opts explicitos se arma uno aparte (casos raros, sin tocar la sesion). */
self.GP2_SB = function (opts) {
  if (opts) return self.supabase.createClient(self.SUPABASE_URL, self.SUPABASE_KEY, opts);
  if (!self.__GP2_SB_CLIENT) {
    self.__GP2_SB_CLIENT = self.supabase.createClient(self.SUPABASE_URL, self.SUPABASE_KEY, {
      db: { schema: "GP2" },
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });
    // Sesion caida (refresh_token invalido -> supabase-js emite SIGNED_OUT): al login.
    // Si no, la pantalla sigue como anonimo y recien al grabar tira "permission denied".
    // GP2_IR_AL_LOGIN lo define auth-guard.js solo cuando el login esta prendido.
    var a = self.__GP2_SB_CLIENT.auth;
    if (a && typeof a.onAuthStateChange === "function") {
      a.onAuthStateChange(function (ev) {
        if (ev === "SIGNED_OUT" && typeof self.GP2_IR_AL_LOGIN === "function") self.GP2_IR_AL_LOGIN();
      });
    }
  }
  return self.__GP2_SB_CLIENT;
};
