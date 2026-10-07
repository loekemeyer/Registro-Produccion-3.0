# Registro Producción 3.0

Las apps que usa el **operario** para registrar producción, juntas en un solo repo. **Sólo la botonera del operario**:
lo que es de supervisor u oficina no está. La pantalla de inicio (`/`) separa **Cervantes** y **Virgilio**, y cada una
tiene **su propio login**. No hay build: se sirve tal cual como sitio estático.

El código nació como **copia sin modificar** (05/10/2026, comprobada con `cmp`) de `Gestion-Virgilio` y
`Gestion-Productiva-2.0`. **Desde el 06/10/2026 ya no es una copia**: cambiaron la estructura, los logins y se recortó
todo lo de supervisor (ver «Qué cambió» y «Qué se recortó»). Las apps hablan con el **mismo proyecto Supabase**
(`hrxfctzncixxqmpfhskv`) y usan claves `sb_publishable_` (públicas por diseño); no hay ningún secreto en el repo.

## Estructura y de dónde sale

| Carpeta | Qué es | Origen (commit) | Versión propia | Login |
|---|---|---|---|---|
| `/` | **Inicio**: elegir Virgilio o Cervantes | `selector/` de `loekemeyer/Gestion-Virgilio` · `e7a7bbd` | `sw.js` → `inicio-v1.2` | — |
| `virgilio/` | App del operario de **Virgilio**: **sólo la botonera** (picking, armado, carga, remitos, racks, insumos…) | `loekemeyer/Gestion-Virgilio` · `e7a7bbd` (v26.92), recortada | `v30.NN` (hoy `v30.05`) | **sólo el código de la TV** |
| `gp2/Produccion/RegistroApp/` | **Tablet de operarios de GP2** (`Operarios_GP2.html`, la que corta en matrices). **Es lo que abre «Cervantes» en el inicio** | `loekemeyer/Gestion-Productiva-2.0` · `3a526e8` (v1.245.2) | la de GP2 | Google + lista blanca (sin cambios) |
| `gp2/` (resto) | Lo mínimo que esa tablet necesita: `login.html`, `auth-guard.js`, `supabase-config.js`, `gp2-ui.js`, `pwa.js`, `sw.js`, `version.js`, manifest e íconos | `loekemeyer/Gestion-Productiva-2.0` · `3a526e8` (v1.245.2) | la de GP2 | — |
| `cervantes/` | App de **Registro Producción 2.0** (matrices, cajones, tiempos muertos). **Desde el 06/10 no tiene enlace desde el inicio**; sigue en el repo sin tocar | `loekemeyer/Gestion-Virgilio` · `e7a7bbd`, carpeta `cervantes/` (v1.9.3) | `v3.0.N` | **la red (Wi-Fi) de la empresa**, en el primer mensaje del día |
| `supabase.js` (raíz) | supabase-js propio, compartido: `virgilio/` y `cervantes/` lo cargan con `../supabase.js` | `loekemeyer/Gestion-Virgilio` | — | — |
| `selector/` | Sólo una redirección a `/` (URL vieja) | — | — | — |
| `tests/` | Pruebas con Playwright (ver «Pruebas») | 8 de `Gestion-Virgilio` + 4 nuevas | — | — |

**Versiones de este repo**: Virgilio usa la serie `v30.NN` (3.0) y Cervantes `v3.0.N`, para no pisarse con las
`v26/v27` y `v1.9.x` de Gestión Virgilio en los logs. Virgilio compara versiones con `_verNum`, que sólo acepta
`vMAYOR.MENOR`: no se le pueden poner sufijos.

## Qué cambió respecto de la copia (06/10/2026)

1. **Inicio**: la raíz es la pantalla «¿Dónde vas a trabajar hoy?». Virgilio se movió entero a `virgilio/`. En Virgilio
   ya no hay segundo selector de planta: el operario cae directo en su botonera. «Cambiar planta» vuelve a `/`.
2. **Virgilio, login sólo con la TV** (`SOLO_TV` en `virgilio/index.html`): código de 4 dígitos de la TV → nombre de
   una lista. **Desde la v30.07 (Thomas, 06/10) no hay entrada por legajo**: «＋ No estoy en la lista» → nombre y
   apellido → registra el alta (`gv_operario_alta_crear`) y **entra ya** con el legajo compartido 600 y su nombre
   (v30.08, igual que Gestión v27.37); un admin lo valida con su legajo en Gestión Virgilio (⚙️ → Validar Operarios)
   y desde ahí aparece en la lista. La entrevista usa el mismo camino. Una sesión de Google guardada se ignora (y no se borra: el origen se
   comparte con GP2). Los **supervisores no entran por este Virgilio**: su panel sigue en Gestión Virgilio.
3. **Cervantes = la tablet de operarios de GP2** (inicio v1.2): la tarjeta «Cervantes» abría `cervantes/` (la visual de
   Registro Producción 2.0); ahora abre `gp2/Produccion/RegistroApp/Operarios_GP2.html`. Sin sesión de Google, el guard
   de GP2 manda a su login y vuelve a la tablet con `?next=`. El botón «Menú» de la tablet apuntaba a `GP2_MODULOS.html`
   (no está acá): ahora vuelve al inicio del sitio. Token de caché de la tablet `20261006k` (el de GP2).
4. **Cervantes, login por la red** (`asegurarPaseRed`, `cervantes/app.js`) — **ya no es la entrada**: sigue en
   `cervantes/` y con su prueba (`cervantes-red`), pero la tablet de GP2 no lo usa. Cómo funciona, por si se vuelve a usar:
   en el **primer mensaje del día** (antes de la Llegada Tarde, que no existe si llega antes de las 08:30) llama a la
   Edge Function `login-operario`, que compara la IP real con `public.red_empresa` y deja el intento en
   `public.seg_login_operario_log`.
   - **200** → queda un *pase* del legajo, válido hasta las **17:45** (hora de Buenos Aires). Con el pase, aunque se
     corte la luz o internet, siguen registrando: la cola envía cuando vuelve internet.
   - **403** → fuera de la red: no se envía nada y avisa que hay que usar el Wi-Fi de la empresa.
   - **Sin internet** → el mensaje se acepta pero queda **retenido** en la cola: no pasa al IndexedDB (así el service
     worker no lo manda) y `reconcileQueueWithIDB` no lo da por enviado. Al volver internet se vuelve a preguntar por
     la red y, si es la de la empresa, se libera y se envía. Si no, sigue retenido y hay un aviso fijo arriba.
   - El JWT que devuelve `login-operario` **no se guarda ni se manda**: la base todavía acepta la clave pública. El pase
     es sólo local; la prueba de presencia es la fila `ok` del log del servidor.
   - Cervantes **no usa la sesión de Virgilio** ni rebota al inicio por no tener sesión.
5. **Virgilio recortado a la botonera** (v30.03 y v30.04): ver la sección siguiente.

## Qué se recortó (Virgilio, 06/10/2026)

El `index.html` de Gestión Virgilio mezclaba operario y supervisor en un solo archivo. Se recortó lo que sólo alcanza el
supervisor (Facturación, PPP y Programación, A Programar, Cuarentena, Stock, Monitor, Cobranzas, Importación, OC,
Configuración, Mapa de góndolas, Estadísticas ISIS, Hot Sale…).

| | Antes | Después |
|---|---|---|
| `virgilio/index.html` | 4.404.744 bytes · 63.314 líneas | 1.161.753 bytes · 17.550 líneas |
| funciones de nivel superior | 2.699 | 810 |
| JS del `<script>` principal | 3.803 KB | 1.037 KB |
| CSS | 397 KB | 67 KB |
| repo completo (sin `.git`) | 8,4 MB | 2,6 MB |

**Cómo se decidió qué queda**: por alcance, con un análisis del código (acorn) desde las raíces de la botonera del
operario. Una función queda si algo del operario la nombra —en código, en un string o en un atributo del HTML— y también
todo nombre que usen `recepcion.js`, `planimetria.js` y `supabase-config.js` (`autoCloseRT`, `anularRecepcionSesion`,
`onRecepcionDraftChange`). No hay llamadas dinámicas por nombre en el JS (se comprobó), así que no se pierde nada por esa
vía. El CSS se podó aparte (commit propio, `v30.04`): una regla se saca sólo si su selector exige una clase o un id que
ningún elemento puede tener; una clase «vive» si aparece como palabra en el HTML o en el JS que queda, o si empieza con un
prefijo que el JS arma por concatenación (170 prefijos).

**Qué quedó como cascarón**: lo que el código del operario todavía nombra y es de supervisor. Son 5 funciones vacías
(`showSupervisor`, `showConteo`, `stkRender`, `pppRenderProg`, `psRender`: refrescos del tipo «si la pantalla de admin está
abierta») y 5 contenedores ocultos sin controles (`supervisorPanel`, `conteoPanel`, `plantSelector`, `cervAdmin`,
`pppOverlay`). Cada función lleva el comentario «pantalla de supervisor, no incluida».

**Se sacó también**: los scripts `importacion.js`, `cobranzas.js`, `hotsale.js`, `estadisticas.js`,
`modulo_talleristas_arts.js` y `modulo_talleristas_edit.js`; las librerías de `virgilio/vendor/` que sólo ellos usaban
(jspdf, autotable, chart, xlsx, html2canvas, leaflet); y la **Carga Manual Producción** de GP2 (`Registro_GP2.html`, de
oficina). En `vendor/` queda sólo `supabase.umd.js`. **Se fue la impresión de supervisor**: la estación de impresión, el
helper y las hojas de picking, armado y facturado. El operario conserva la «Orden de guardado» (`gordenPrint`, abre una
ventana y manda a imprimir).

**Cómo se verificó**
- Los **20 botones** de la botonera (EP, AP, RT, MG, CC, CR, RR, INS, CP, RC, IR, RKBM, MOV, PPP, AT, PB, Limp, Perm, PC,
  CT) dan lo mismo que el original: se tocó cada uno, al seleccionar y al enviar, y se compararon los elementos
  visibles y los errores.
- De los **429 tests de Gestión Virgilio**, corridos con el `index.html` original y con el recortado: **142 pasan igual**
  (todos los de picking, armado, guardado, racks, recepción, completar pedido, toggles y tandas); **281 sólo fallan porque
  miden código de supervisor eliminado** (179 por una función o variable que ya no existe, 20 por un archivo eliminado y 82
  por chequeos del texto o de pantallas de supervisor; se leyó el fallo de cada uno); **6 fallan también con el original**.
- La primera pasada dejó afuera `autoCloseRT`, `anularRecepcionSesion` y `onRecepcionDraftChange` (las usa `recepcion.js`
  por `window.`): la cazó la comparación con los tests y se corrigió antes de subir.
- Poda de CSS: durante esos mismos tests, con el CSS completo, ninguno de los 2.759 selectores descartados coincidió con
  ningún elemento; 78 de 86 capturas (login, botonera, historial y los 20 botones, a 390 y 1280 px) son idénticas byte a
  byte, y las otras 8 difieren en 1 a 3 píxeles sueltos.
- **No cubre**: estados que ninguna prueba arma (por ejemplo, una pantalla que sólo aparece con datos reales de
  producción) ni nada contra Supabase real. Si alguna pantalla del operario se ve distinta o falta un botón, es un error
  del recorte: avisar.

**Cómo portar un cambio de Gestión Virgilio**: ya no se puede copiar el archivo. Se busca la función por nombre en los dos
(`grep -a -n "function nombre" virgilio/index.html`) y se lleva a mano; si la función nueva usa algo que acá es cascarón,
hay que traer esa parte también. Un fix de operario que Gestión Virgilio ya tenga y acá no se mide con los comandos de
«Fuente de verdad».

## Lo que falta o no coincide (a 06/10/2026)

- **La tablet de GP2 (Cervantes) sigue con Google + lista blanca**, no con el login por la red de empresa que se había
  hecho para `cervantes/`. Si Cervantes tiene que entrar por la red, hay que llevar `asegurarPaseRed` a `operarios_gp2.js`.
- **`cervantes/` quedó sin enlace** (la visual de Registro Producción 2.0). Se puede borrar cuando se confirme que no
  hace falta; la historia queda en git.
- **El código de la TV se puede leer desde cualquier lado**: `gv_tv_clave_actual()` la ejecuta `anon` y la propia TV la
  llama con la clave pública. Hoy la TV sola no prueba presencia.
- **La base sigue abierta**: `Registros Produccion Cervantes`, `db_n8n_espejo` y `Auditoria_Produccion` tienen
  políticas `true` para `anon` (insert, update y delete) y `Empleados` deja insertar y actualizar. El pase de Cervantes
  se chequea sólo en la pantalla; cerrar las políticas es otra etapa (ver `docs/PLAN-LOGIN-OPERARIOS-RED.md` de
  Gestión Virgilio, etapas 3 y 4).
- **Las sesiones de operario de `login-operario` se cierran a las 23:30** (cron `cerrar-sesiones-operarios`, 02:30 UTC),
  no a las 17:45. Hoy no importa porque `cervantes/` no guarda la sesión; sí cuando se mande el JWT.
- **Sin Wi-Fi no hay salida** (en `cervantes/`): sólo sirve cuando no hay internet (el mensaje queda retenido). Con
  internet pero fuera de la red (por ejemplo, datos móviles) el operario queda bloqueado. Falta el código manual de
  logística.
- **Reinicio de la tablet sin internet** (en `cervantes/`): el service worker no cachea archivos y `cargarCatalogos` no
  guarda copia de `Empleados`, así que sin internet la página puede no cargar y, si carga, todo legajo da «Legajo no
  encontrado». El pase no lo resuelve (ya está registrado en la auditoría).
- **Cambio de sede** (botón en Cervantes y Virgilio que mide el tiempo de viaje): no está hecho.

## ⚠ Lo que NO es lo que parece

- `virgilio/index.html` conserva **nombres de funciones y de tablas de Gestión Virgilio** que ya no se usan acá porque lo
  único que las llamaba era el supervisor; no son un error del recorte. Lo que sí es de este repo está marcado:
  `SOLO_TV` (login) y los comentarios «pantalla de supervisor, no incluida».
- El archivo **ya no tiene el byte nulo** que tenía el original (era el separador de claves de `_pppGeoCod`, código de
  supervisor): `grep` ya no lo trata como binario. Igual, modificarlo con parches y no reescribiéndolo como texto.
- `Registro_GP2.html` (la **Carga Manual Producción** de oficina) se sacó; la carpeta `RegistroApp/` conserva su
  `manifest.json`, `sw.js` y `styles.css`, que comparte con la tablet.

## Enlaces que quedan rotos (están fuera a propósito)

| Desde | Apunta a | Qué es |
|---|---|---|
| `gp2/login.html` | `GP2_MODULOS.html`, `envios-only.html` | Destinos por defecto cuando el login no trae `?next=` (desde la tablet siempre lo trae) |

`virgilio/index.html` ya no apunta a `admin/`, `monitor/` ni `cervantes-admin/`: ese código se fue con el supervisor.

## Se dejó afuera

Tablet **Logística** de GP2 (`Tablet/`, `envios-only.html`), `fichada*`, `monitor/`, `admin/`, `cervantes-admin/`,
`impo-comex/`, `docs/`, `sql/`, `supabase/` (Edge Functions), `tools/`, `.github/`, todo el supervisor de
`virgilio/index.html` (ver «Qué se recortó») y los 429 tests `.cjs` de Gestión Virgilio (casi todos miden pantallas de
supervisor). De esos tests se trajeron 8 de operario.

## Pruebas

`node tests/<nombre>.cjs` (Playwright; sale 1 si falla). Las que necesitan `http://` usan `tests/_servidor.cjs`.

| Prueba | Qué cubre |
|---|---|
| `inicio-selector` | `/` con las 2 tarjetas; Virgilio abre `virgilio/` con su login; **Cervantes abre la tablet de GP2** (y su login vuelve a ella con `?next=`); el botón «Menú» de la tablet vuelve al inicio; `supabase.js` compartido; redirección de `selector/` |
| `virgilio-solo-operario` | **el recorte**: los archivos de supervisor no están; la página carga sin 404 ni errores; la botonera tiene sus 20 botones y cada uno se toca sin error; las entradas de supervisor no existen y los 5 cascarones y los paneles están vacíos (51 chequeos). Con el código sin recortar falla en 19 |
| `virgilio-solo-tv` | login de Virgilio sólo con TV, sin entrada por legajo y con la entrada por nombre (v30.08) |
| `cervantes-red` | login de `cervantes/` por la red (29 chequeos): fuera de la red, en la red, vigencia 17:44/17:50, antes de las 08:30, sin internet, recarga, vuelta de internet, legajo no habilitado |
| `operario-queda-botonera`, `modulo-minimizar-anular`, `tarea-abierta-otro-dia`, `botonera-tm-historial`, `mg-reentrada`, `toggle-anular`, `rr-sin-remitos-cierra`, `encoding-utf8` | de Gestión Virgilio, con las rutas nuevas. `operario-queda-botonera` sin el segundo selector ni `chooseVirgilio` (lo llamaba el selector de planta); `modulo-minimizar-anular` sin el chequeo del monitor |

- `modulo-minimizar-anular` es **intermitente** (falla «BR re-entrar = mismo tramo» algunas corridas): pasa igual en el
  código original de Gestión Virgilio y falló 1 de 3 corridas sin estos cambios. No se tocó.
- **No se probó**: nada contra Supabase real (`login-operario`, `gv_tv_clave_validar` y las tablas están simulados), el
  *background sync* del service worker (en las pruebas está bloqueado), ni el login con Google de GP2.

## Fuente de verdad

Decidido el 05/10/2026 (Nazareno): **se sigue trabajando desde los tres repos** (Gestión Virgilio, Gestión
Productiva 2.0 y este). No hay un origen único y **nada los sincroniza**: un cambio hecho en uno no aparece en los
otros hasta que alguien lo lleve a mano. Este repo además **se separó a propósito** de sus orígenes (arriba), y desde el
recorte **el `index.html` de Virgilio ya no se puede copiar** de Gestión Virgilio (ver «Cómo portar un cambio»).

Para ver cuánto se separó una carpeta de su origen, correr en el repo de origen con el commit de la tabla:

```
git fetch origin main
git log --oneline e7a7bbd..origin/main -- index.html recepcion.js cervantes selector   # Gestión Virgilio
git log --oneline 3a526e8..origin/main -- Produccion/RegistroApp login.html            # Gestión Productiva 2.0
```

Medido el 06/10/2026 (noche), antes de pasar los operarios a este repo:

- **Virgilio contra Gestión Virgilio v27.57**: se compararon las 1.111 funciones con nombre (también las de adentro de
  los IIFE). **Todas iguales** salvo las del login (sólo código de la TV, a propósito) y los cascarones de supervisor.
  `recepcion.js`, `planimetria.js` y `supabase-config.js` son idénticos byte a byte. De las 79 pruebas de operario de
  Gestión, corridas contra este Virgilio: **63 pasan igual** y las 16 que fallan miden supervisor o archivos que acá no van
  (importación, admin de insumos, monitor, SQL, hoja de picking, freno del supervisor, selector viejo). Las 12 pruebas
  propias de este repo pasan. Los eventos salen con `gv_app = gestion@v30.NN` (la serie dice de qué app vino).
- **Tablet de GP2**: estaba en v1.236.0; se trajo a **v1.245.2** (`3a526e8`): artículos de cada pieza, lo último arriba,
  «Terminar cajón» sin confirmación y el `auth-guard` que borra el token muerto. Se conservó el «← Menú» al inicio.

## Publicación

GitHub Pages está activado desde el 05/10/2026 (rama `main`, carpeta `/ (root)`). Base:
`https://loekemeyer.github.io/Registro-Produccion-3.0/`

| Entrada | Ruta |
|---|---|
| Inicio (elegir planta) | `/` |
| Virgilio (operario) | `/virgilio/` |
| Cervantes = GP2 Tablet Operarios | `/gp2/Produccion/RegistroApp/Operarios_GP2.html` (la tarjeta «Cervantes» del inicio) |
| Registro Producción 2.0 (sin enlace) | `/cervantes/` |

- El origen es el mismo `loekemeyer.github.io` que Gestión Virgilio y GP2: comparten `localStorage` y la sesión de
  Supabase. El login de GP2 vuelve a `origin + pathname`: la URL nueva tiene que estar permitida en Supabase →
  Auth → URL Configuration, o el login con Google devuelve al sitio viejo.
- La app de Play Store (TWA) apunta a `loekemeyer.github.io/Produccion-Virgilio/` (el despliegue actual de
  Virgilio), no a este repo: los operarios no cambian de app hasta que se republique.
