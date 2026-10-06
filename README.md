# Registro Producción 3.0

Las apps que usa el **operario** para registrar producción, juntas en un solo repo. La pantalla de inicio (`/`)
separa **Cervantes** y **Virgilio**, y cada una tiene **su propio login**. No hay build: se sirve tal cual como sitio
estático.

El código nació como **copia sin modificar** (05/10/2026, comprobada con `cmp`) de `Gestion-Virgilio` y
`Gestion-Productiva-2.0`. **Desde el 06/10/2026 ya no es una copia**: la estructura y el login de Virgilio y Cervantes
cambiaron (ver «Qué cambió»). Las tres apps hablan con el **mismo proyecto Supabase** (`hrxfctzncixxqmpfhskv`) y usan
claves `sb_publishable_` (públicas por diseño); no hay ningún secreto en el repo.

## Estructura y de dónde sale

| Carpeta | Qué es | Origen (commit) | Versión propia | Login |
|---|---|---|---|---|
| `/` | **Inicio**: elegir Virgilio o Cervantes | `selector/` de `loekemeyer/Gestion-Virgilio` · `e7a7bbd` | `sw.js` → `inicio-v1.1` | — |
| `virgilio/` | App del operario de **Virgilio**: botonera (picking, armado, carga, remitos, racks, insumos…) | `loekemeyer/Gestion-Virgilio` · `e7a7bbd` (v26.92) | `v30.NN` | **sólo el código de la TV** |
| `cervantes/` | App del operario de **Cervantes** (Registro Producción: matrices, cajones, tiempos muertos) | `loekemeyer/Gestion-Virgilio` · `e7a7bbd`, carpeta `cervantes/` (v1.9.3) | `v3.0.N` | **la red (Wi-Fi) de la empresa**, en el primer mensaje del día |
| `gp2/Produccion/RegistroApp/` | **Tablet Operarios** de GP2 (`Operarios_GP2.html`, la que corta en matrices) y la **Carga Manual** (`Registro_GP2.html`) | `loekemeyer/Gestion-Productiva-2.0` · `362ae7d` | la de GP2 | Google + lista blanca (sin cambios) |
| `gp2/` (resto) | Lo mínimo que esa tablet necesita: `login.html`, `auth-guard.js`, `supabase-config.js`, `gp2-ui.js`, `pwa.js`, `sw.js`, `version.js`, manifest e íconos | `loekemeyer/Gestion-Productiva-2.0` · `362ae7d` | la de GP2 | — |
| `supabase.js` (raíz) | supabase-js propio, compartido: `virgilio/` y `cervantes/` lo cargan con `../supabase.js` | `loekemeyer/Gestion-Virgilio` | — | — |
| `selector/` | Sólo una redirección a `/` (URL vieja) | — | — | — |
| `tests/` | Pruebas con Playwright (ver «Pruebas») | 8 de `Gestion-Virgilio` + 3 nuevas | — | — |

**Versiones de este repo**: Virgilio usa la serie `v30.NN` (3.0) y Cervantes `v3.0.N`, para no pisarse con las
`v26/v27` y `v1.9.x` de Gestión Virgilio en los logs. Virgilio compara versiones con `_verNum`, que sólo acepta
`vMAYOR.MENOR`: no se le pueden poner sufijos.

## Qué cambió respecto de la copia (06/10/2026)

1. **Inicio**: la raíz es la pantalla «¿Dónde vas a trabajar hoy?». Virgilio se movió entero a `virgilio/`. En Virgilio
   ya no hay segundo selector de planta: el operario cae directo en su botonera. «Cambiar planta» vuelve a `/`.
2. **Virgilio, login sólo con la TV** (`SOLO_TV` en `virgilio/index.html`): código de 4 dígitos de la TV → nombre de
   una lista, o «＋ No estoy en la lista» + legajo. Sin Google y sin el atajo «Entrar con mi legajo». El legajo sólo se
   acepta con el código recién validado (10 min). Una sesión de Google guardada se ignora (y no se borra: el origen se
   comparte con GP2). Los **supervisores no entran por este Virgilio**: su panel sigue en Gestión Virgilio.
3. **Cervantes, login por la red** (`asegurarPaseRed`, `cervantes/app.js`): en el **primer mensaje del día** (antes de
   la Llegada Tarde, que no existe si llega antes de las 08:30) llama a la Edge Function `login-operario`, que compara
   la IP real con `public.red_empresa` y deja el intento en `public.seg_login_operario_log`.
   - **200** → queda un *pase* del legajo, válido hasta las **17:45** (hora de Buenos Aires). Con el pase, aunque se
     corte la luz o internet, siguen registrando: la cola envía cuando vuelve internet.
   - **403** → fuera de la red: no se envía nada y avisa que hay que usar el Wi-Fi de la empresa.
   - **Sin internet** → el mensaje se acepta pero queda **retenido** en la cola: no pasa al IndexedDB (así el service
     worker no lo manda) y `reconcileQueueWithIDB` no lo da por enviado. Al volver internet se vuelve a preguntar por
     la red y, si es la de la empresa, se libera y se envía. Si no, sigue retenido y hay un aviso fijo arriba.
   - El JWT que devuelve `login-operario` **no se guarda ni se manda**: la base todavía acepta la clave pública. El pase
     es sólo local; la prueba de presencia es la fila `ok` del log del servidor.
   - Cervantes **ya no usa la sesión de Virgilio** ni rebota al inicio por no tener sesión.

## Lo que falta o no coincide (a 06/10/2026)

- **El código de la TV se puede leer desde cualquier lado**: `gv_tv_clave_actual()` la ejecuta `anon` y la propia TV la
  llama con la clave pública. Hoy la TV sola no prueba presencia.
- **La base sigue abierta**: `Registros Produccion Cervantes`, `db_n8n_espejo` y `Auditoria_Produccion` tienen
  políticas `true` para `anon` (insert, update y delete) y `Empleados` deja insertar y actualizar. El pase de Cervantes
  se chequea sólo en la pantalla; cerrar las políticas es otra etapa (ver `docs/PLAN-LOGIN-OPERARIOS-RED.md` de
  Gestión Virgilio, etapas 3 y 4).
- **Las sesiones de operario de `login-operario` se cierran a las 23:30** (cron `cerrar-sesiones-operarios`, 02:30 UTC),
  no a las 17:45. Hoy no importa porque Cervantes no guarda la sesión; sí cuando se mande el JWT.
- **Sin Wi-Fi no hay salida**: sólo sirve cuando no hay internet (el mensaje queda retenido). Con internet pero fuera
  de la red (por ejemplo, datos móviles) el operario queda bloqueado. Falta el código manual de logística.
- **Reinicio de la tablet sin internet**: el service worker de Cervantes no cachea archivos y `cargarCatalogos` no
  guarda copia de `Empleados`, así que sin internet la página puede no cargar y, si carga, todo legajo da «Legajo no
  encontrado». El pase no lo resuelve (ya está registrado en la auditoría).
- **Cambio de sede** (botón en Cervantes y Virgilio que mide el tiempo de viaje): no está hecho.

## ⚠ Lo que NO es lo que parece

- **La app de Virgilio no se pudo separar en módulos.** Es un único `virgilio/index.html` de ~63.300 líneas donde el
  código de operario y el de supervisor están intercalados. Se copió **entero**, con los scripts de supervisor que el
  `index.html` carga con `<script>` (`importacion.js`, `cobranzas.js`, `hotsale.js`, `estadisticas.js`,
  `modulo_talleristas_*.js`). El operario no los usa; sin ellos el supervisor perdería esas pantallas. Recortarlos es un
  refactor. El archivo tiene **un byte nulo legítimo** (separador de claves en `_pppGeoCod`): `grep` lo trata como
  binario (usar `grep -a`), y los cambios se hacen con parches que lo conserven.
- `Registro_GP2.html` es la **Carga Manual Producción** (oficina), no la tablet. Está porque comparte carpeta, manifest y
  service worker con `Operarios_GP2.html`.

## Enlaces que quedan rotos (están fuera a propósito)

| Desde | Apunta a | Qué es |
|---|---|---|
| `virgilio/index.html` | `admin/admin.html` | Panel Web LK (supervisor) |
| `virgilio/index.html` | `monitor/alerta-inactivo.js` | Alarma de la TV del depósito (sólo modo kiosko) |
| `virgilio/index.html` | `cervantes-admin/entero/` | Admin de Cervantes (supervisor) |
| `gp2/.../Operarios_GP2.html` y `Registro_GP2.html` | `GP2_MODULOS.html` | Botón «volver» al menú de GP2 |
| `gp2/login.html` | `GP2_MODULOS.html`, `envios-only.html` | Destinos por defecto cuando el login no trae `?next=` (desde la tablet siempre lo trae) |

## Se dejó afuera

Tablet **Logística** de GP2 (`Tablet/`, `envios-only.html`), `fichada*`, `monitor/`, `admin/`, `cervantes-admin/`,
`impo-comex/`, `docs/`, `sql/`, `supabase/` (Edge Functions), `tools/`, `.github/` y los 429 tests `.cjs` de Gestión
Virgilio (casi todos miden pantallas de supervisor). De esos tests se trajeron los 8 de operario.

## Pruebas

`node tests/<nombre>.cjs` (Playwright; sale 1 si falla). Las que necesitan `http://` usan `tests/_servidor.cjs`.

| Prueba | Qué cubre |
|---|---|
| `inicio-selector` | `/` con las 2 tarjetas, entrada a `virgilio/` y `cervantes/`, `supabase.js` compartido, redirección de `selector/` |
| `virgilio-solo-tv` | login de Virgilio sólo con TV (14 chequeos) |
| `cervantes-red` | login de Cervantes por la red (29 chequeos): fuera de la red, en la red, vigencia 17:44/17:50, antes de las 08:30, sin internet, recarga, vuelta de internet, legajo no habilitado |
| `operario-queda-botonera`, `modulo-minimizar-anular`, `tarea-abierta-otro-dia`, `botonera-tm-historial`, `mg-reentrada`, `toggle-anular`, `rr-sin-remitos-cierra`, `encoding-utf8` | de Gestión Virgilio, con las rutas nuevas (`operario-queda-botonera` actualizado al comportamiento sin segundo selector) |

- `modulo-minimizar-anular` es **intermitente** (falla «BR re-entrar = mismo tramo» algunas corridas): pasa igual en el
  código original de Gestión Virgilio y falló 1 de 3 corridas sin estos cambios. No se tocó.
- **No se probó**: nada contra Supabase real (`login-operario`, `gv_tv_clave_validar` y las tablas están simulados), el
  *background sync* del service worker (en las pruebas está bloqueado), ni el login con Google de GP2.

## Fuente de verdad

Decidido el 05/10/2026 (Nazareno): **se sigue trabajando desde los tres repos** (Gestión Virgilio, Gestión
Productiva 2.0 y este). No hay un origen único y **nada los sincroniza**: un cambio hecho en uno no aparece en los
otros hasta que alguien lo lleve a mano. Este repo además **se separó a propósito** de sus orígenes (arriba).

Para ver cuánto se separó una carpeta de su origen, correr en el repo de origen con el commit de la tabla:

```
git fetch origin main
git log --oneline e7a7bbd..origin/main -- index.html recepcion.js cervantes selector   # Gestión Virgilio
git log --oneline 362ae7d..origin/main -- Produccion/RegistroApp login.html            # Gestión Productiva 2.0
```

Medido el 06/10/2026 (~15:00, un día después de la copia):

- **Gestión Virgilio** (v26.92 → v27.19): 34 commits tocan lo copiado; en `index.html`, `importacion.js`, `recepcion.js`,
  `sw.js` y `version.json` son 776 líneas agregadas y 55 borradas. `cervantes/` y `selector/` no cambiaron. Casi todo es
  de oficina o supervisor; tres commits podrían tocar al operario y no se verificó (comentarios por recepción en
  Pendientes, se saca el OCR de «Cargar foto de Maestro Producción», reintento del puente a LK).
- **Gestión Productiva 2.0** (v1.236.0 → v1.242.0): 14 commits tocan lo copiado; 6 archivos, +32/−9. Hay **un cambio
  de operario**: la tablet muestra los artículos de cada pieza de la matriz 237 (542/543/570, 720/722, 858); y
  `auth-guard.js` ahora borra el token muerto de `localStorage` al volver al login (925 errores 403 en un día).

## Publicación

GitHub Pages está activado desde el 05/10/2026 (rama `main`, carpeta `/ (root)`). Base:
`https://loekemeyer.github.io/Registro-Produccion-3.0/`

| Entrada | Ruta |
|---|---|
| Inicio (elegir planta) | `/` |
| Virgilio (operario) | `/virgilio/` |
| Cervantes (operario) | `/cervantes/` |
| GP2 Tablet Operarios | `/gp2/Produccion/RegistroApp/Operarios_GP2.html` |

- El origen es el mismo `loekemeyer.github.io` que Gestión Virgilio y GP2: comparten `localStorage` y la sesión de
  Supabase. El login de GP2 vuelve a `origin + pathname`: la URL nueva tiene que estar permitida en Supabase →
  Auth → URL Configuration, o el login con Google devuelve al sitio viejo.
- La app de Play Store (TWA) apunta a `loekemeyer.github.io/Produccion-Virgilio/` (el despliegue actual de
  Virgilio), no a este repo: los operarios no cambian de app hasta que se republique.
