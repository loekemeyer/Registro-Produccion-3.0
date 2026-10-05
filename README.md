# Registro Producción 3.0

Las apps que usa el **operario** para registrar producción, juntas en un solo repo. Es una **copia sin
modificar** (cada archivo es idéntico al de su origen, comprobado con `cmp`) tomada el 05/10/2026.
No hay build: se sirve tal cual como sitio estático.

Las tres apps hablan con el **mismo proyecto Supabase** (`hrxfctzncixxqmpfhskv`) y usan claves
`sb_publishable_` (públicas por diseño); no hay ningún secreto en el repo.

## Qué hay y de dónde sale

| Carpeta | Qué es | Origen (commit) |
|---|---|---|
| `/` (raíz) | App del operario de **Virgilio**: botonera (picking, armado, carga, remitos, racks, insumos…) | `loekemeyer/Gestion-Virgilio` · `e7a7bbd` (v26.92) |
| `cervantes/` | App del operario de **Cervantes** (Registro Producción: matrices, cajones, tiempos muertos) | `loekemeyer/Gestion-Virgilio` · `e7a7bbd`, carpeta `cervantes/` (v1.9.3) |
| `selector/` | Pantalla «¿Dónde vas a trabajar hoy?» (Virgilio / Cervantes) | `loekemeyer/Gestion-Virgilio` · `e7a7bbd` |
| `gp2/Produccion/RegistroApp/` | **Tablet Operarios** de GP2 (`Operarios_GP2.html`, la que corta en matrices) y la **Carga Manual** (`Registro_GP2.html`) | `loekemeyer/Gestion-Productiva-2.0` · `362ae7d` |
| `gp2/` (resto) | Lo mínimo que esa tablet necesita para correr: `login.html`, `auth-guard.js`, `supabase-config.js`, `gp2-ui.js`, `pwa.js`, `sw.js`, `version.js`, manifest e íconos | `loekemeyer/Gestion-Productiva-2.0` · `362ae7d` |

El layout de la raíz, `cervantes/` y `selector/` es **el mismo que en Gestión Virgilio** a propósito: los
enlaces relativos entre ellos (`../`, `../supabase.js`, `../cervantes/`) siguen valiendo sin tocar código.
GP2 va aparte en `gp2/` porque sus `supabase-config.js`, `sw.js` e `index.html` chocan con los de Virgilio.

## ⚠ Lo que NO es lo que parece

- **La app de Virgilio no se pudo separar en módulos.** Es un único `index.html` de 63.297 líneas donde el
  código de operario y el de supervisor están intercalados (por ejemplo, Guardado a góndola de operario en
  la línea 27776 y Stock admin en la 16131). Se copió **entero**, con los scripts de supervisor que el
  `index.html` carga con `<script>` (`importacion.js`, `cobranzas.js`, `hotsale.js`, `estadisticas.js`,
  `modulo_talleristas_*.js`). El operario no los usa; sin ellos el supervisor perdería esas pantallas.
  Recortarlos es un refactor, no una copia.
- `Registro_GP2.html` es la **Carga Manual Producción** (oficina), no la tablet. Está porque comparte carpeta,
  manifest y service worker con `Operarios_GP2.html`.

## Enlaces que quedan rotos (están fuera a propósito)

| Desde | Apunta a | Qué es |
|---|---|---|
| `index.html` | `admin/admin.html` | Panel Web LK (supervisor) |
| `index.html` | `monitor/alerta-inactivo.js` | Alarma de la TV del depósito (sólo modo kiosko) |
| `gp2/.../Operarios_GP2.html` y `Registro_GP2.html` | `GP2_MODULOS.html` | Botón «volver» al menú de GP2 |
| `gp2/login.html` | `GP2_MODULOS.html`, `envios-only.html` | Destinos por defecto cuando el login no trae `?next=` (desde la tablet siempre lo trae) |

## Se dejó afuera

Tablet **Logística** de GP2 (`Tablet/`, `envios-only.html`; no es de operario según el propio menú de GP2),
`fichada*` (reemplazada por el número de legajo), `monitor/`, `admin/`, `cervantes-admin/`, `impo-comex/`,
`docs/`, `sql/`, `supabase/` (Edge Functions), `tools/` (helper de impresión), `.github/` y los 429 tests
`.cjs` de Gestión Virgilio (casi todos miden pantallas de supervisor; copiarlos dejaría la suite en rojo desde
el día 1).

## Verificación hecha (05/10/2026)

1. 62 de 62 archivos idénticos a su origen (`cmp`).
2. Sin secretos (JWT legacy, `sb_secret_`, claves privadas): 0 hallazgos.
3. Las 5 páginas de entrada abren igual que en el original (mismo destino final, 0 requests locales con error,
   mismos errores de JS). Sólo faltan los 3 archivos de la tabla de arriba.
4. 8 tests de operario del original (`operario-queda-botonera`, `modulo-minimizar-anular`,
   `tarea-abierta-otro-dia`, `botonera-tm-historial`, `mg-reentrada`, `toggle-anular`,
   `rr-sin-remitos-cierra`, `encoding-utf8`) corridos contra una copia temporal de este repo: 8 verdes.

**No se probó:** nada con sesión iniciada (login con Google, entrada por legajo) ni escritura contra Supabase.

## Fuente de verdad

Decidido el 05/10/2026 (Nazareno): **se sigue trabajando desde los tres repos** (Gestión Virgilio, Gestión
Productiva 2.0 y este). No hay un origen único y **nada los sincroniza**: un cambio hecho en uno no aparece en los
otros hasta que alguien lo lleve a mano.

Para ver cuánto se separó una carpeta de su origen, correr en el repo de origen con el commit de la tabla de arriba:

```
git fetch origin main
git log --oneline e7a7bbd..origin/main -- index.html recepcion.js cervantes selector   # Gestión Virgilio
git log --oneline 362ae7d..origin/main -- Produccion/RegistroApp login.html            # Gestión Productiva 2.0
```

Medido a las pocas horas de la copia (05/10/2026): 7 commits nuevos en Gestión Virgilio (v26.92 → v26.97), que en
lo copiado cambian `index.html` (+52 / −17 líneas), `sw.js` y `version.json`; y 4 en GP2, que en lo copiado sólo
cambian `login.html` y `version.js` (1 línea cada uno). Ninguno de esos cambios toca flujos de operario: son el
formato del Excel de OCs, el texto del pop-up de día ocupado y números de versión.

## Antes de publicar

- Si se sirve por GitHub Pages, el origen es el mismo `loekemeyer.github.io` que Gestión Virgilio y GP2: comparten
  `localStorage` y la sesión de Supabase. El login de GP2 vuelve a `origin + pathname`: la URL nueva tiene que estar
  permitida en Supabase → Auth → URL Configuration, o el login con Google devuelve al sitio viejo.
- La app de Play Store (TWA) apunta a `loekemeyer.github.io/Produccion-Virgilio/` (el despliegue actual de
  Virgilio), no a este repo: los operarios no cambian de app hasta que se republique.
