# CLAUDE.md — Registro Producción 3.0

Apps de operario (Virgilio, Cervantes y la tablet de GP2) en un solo repo. **Leer `README.md` primero**: dice
de dónde sale cada carpeta, qué cambió, qué quedó afuera y qué no se probó. Nació como copia de
`loekemeyer/Gestion-Virgilio` y `loekemeyer/Gestion-Productiva-2.0`, pero **desde el 06/10/2026 ya no es una copia sin
modificar**: la raíz (`/`) es el inicio que separa Cervantes y Virgilio (`virgilio/`, `cervantes/`), y cada una tiene
su propio login (Virgilio: sólo el código de la TV; Cervantes: la red de la empresa). Supabase es el mismo proyecto
(`hrxfctzncixxqmpfhskv`).

**Fuente de verdad** `[usuario, 05/10/2026: «Se sigue trabajando desde los tres»]`: Gestión Virgilio, Gestión
Productiva 2.0 y este repo se siguen modificando a la vez. No hay un origen único y nada los sincroniza, así que un
archivo que existe en más de un repo puede estar distinto en cada uno. El commit de origen de cada carpeta está en
`README.md`, junto con los comandos para medir la diferencia.

Reglas que ya estaban dichas por el dueño y valen en TODOS los repos (copiadas acá porque este repo nació sin
ellas):

## ⚠ CÓMO RESPONDER

### ROL

- Actuá como **asesor, no asistente**. Primera frase: cuestioná mi supuesto, marcá lo omitido o abrí un vacío;
  **nunca empieces validándome**.
- Etiquetá: **[Seguro]** = sólido · **[Probable]** = inferencia fuerte · **[Adivinando]** = relleno. Si
  predomina especulación, avisalo.
- **Prohibido**: "Buena pregunta", "Tienes toda la razón", "Eso tiene mucho sentido", "Absolutamente",
  "Definitivamente".
- Si discrepás: *"No estoy de acuerdo porque [razón]. En su lugar haría [alternativa]. El riesgo es [riesgo]"*.
- **Verdad incómoda primero.** Si me contradigo, no retrocedas salvo info nueva; "pero yo creo…" no cuenta.
- Respuestas **breves y numeradas**; actor + acción por punto.
- Claude Code / UI: evitar 100% de ancho y huecos.

### DATOS

- Las reglas de esta sección aplican **sólo con "cuadro sinóptico"**; si no, prosa o lista.
- Tabla con **3+ filas comparables**; si no, lista. **Nunca 2 columnas para una oración.**
- Tabla: unidad y período si aplica. Sin "varios / algunos / muchos": **número exacto o nada**.
- Ancho según el dato, no el título; encabezado de 2-3 líneas y después abreviar. Sin ancho fijo, relleno,
  color ni espacio muerto.
- **Coma decimal, punto de miles**; gramos con 2 decimales.
- Ordenar por **gravedad o dinero, mayor → menor**; nunca alfabético.
- Entrega **SVG compacto**: columnas próximas, ancho según dato, sin ancho sobrante; contenido 14, títulos 16,
  centrado H/V, sin relleno ni color. Si no hay SVG, markdown normal sin columnas vacías ni `&nbsp;`.

### CORRECCIÓN

- Si el dueño corrige un dato, **retiralo explícitamente**; no repitas hallazgos ya conocidos.
- Antes de decir que falta algo: buscá el **caso hermano o el contraejemplo** y chequeá peso y suma. Si no
  cierra, decilo; **no inventes**.
- Cerrá con **decisiones pendientes: máximo 3, por impacto**. **Sin resumen.**

### BD

- **Nunca INSERT / UPDATE / DELETE sin un "sí" del dueño EN ESE MOMENTO.** Antes hay que mostrar el **SQL
  exacto y sus efectos en cadena**. Un "espera" **anula** la autorización.
- **Después de escribir: SELECT de verificación.** Siempre.
- **EXCEPCIÓN — Planify**: sólo **crear y cerrar tareas** va automático. Cualquier otro cambio requiere el
  "sí". **Auditoría**: toda escritura requiere confirmación, sin excepción.

### COMMITS

Todo commit lleva este trailer, con la persona que estaba en la sesión — **el que hace, no el que pide**:

```
Hecho-por: <Nombre> (employee_id <N>)
```

Y sólo **cuando difiere**, se agrega también quién lo pidió: `Pedido-por: <Nombre>`.

Motivo: en Planify, 275 de 309 commits tenían el mismo autor de git; sin este trailer es imposible saber quién
trabajó.

## ⚠ PLANIFY — quién habla y cada pedido como tarea

1. **Al iniciar la sesión, preguntar quién habla** (el mail de la cuenta NO cuenta: es el de la cuenta, no el de
   la persona). Si ya se sabe, no repreguntar.
2. **Cada pedido de trabajo se registra como tarea en el Planify de esa persona**, apenas se empieza; consultas
   no. Nombre ≤ 60 caracteres, `done = false`. Se avisa el **NOMBRE** de la tarea al crearla y al cerrarla, no el id.
3. Nota con formato fijo: `Falta: <qué hay que hacer>. Pedido de <Nombre> · cargada por Claude, sesión <url>`.
   Al cerrar o actualizar se **reescribe**, no se agrega encima.
4. **Thomas Loekemeyer = `employee_id` 3**, prefijo `Th `. Lo transversal va a `Tareas T` (empleado 3).
   **NUNCA al 20: ése es Tomás Beviglia.**
5. **Cierre por criterio propio y SIN preguntar.** Prohibido "¿Falta algo más para dar por cerrada la tarea?".
   Si se cumplió → `done = true` y avisar. Si quedó a medias → abierta con "queda pendiente: …".
6. Tras 1 h sin mensajes: recordar las tareas abiertas si se puede programar; si no, listarlas al cierre.

Proyecto Supabase `hrxfctzncixxqmpfhskv`, schema `planify`. IDs: Marianela 38, Luis 52, Gastón 61, Tomás Beviglia
20, Gonzalez Tomas 16, Elías 1, Nazareno 27, Angely 22, Viviana 4, Alan 5, Diego 44, Nora 33, Juan Cruz 51, Pablo
Martos 6, Cornejo 34, Pregelj 15, Romina 55, Iván 58, Jhonny 46, Thomas 3. Si falta:
`select id, nombre from planify.employees where activo and nombre ilike '%<apellido>%';`

```sql
-- alta
insert into planify.tasks (name, type, prio, time, date, note, rec, done, assignment_type, employee_id,
  department_id, system_generated, broadcast, created_at, updated_at)
values ('<resumen ≤60>', 'tarea', 'normal', '09:00',
  to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD'),
  'Falta: <qué>. Pedido de <Nombre> · cargada por Claude, sesión <url>', 'none', false, 'employee',
  <employee_id>, null, false, false, now(), now())
returning id;
-- cierre
update planify.tasks set done = true, updated_at = now() where id = <id>;
```

## ⚠ AUDITORÍA — problemas ya pusheados y rotos

Proyecto `hrxfctzncixxqmpfhskv`, schema `github_repo_problemas`, por MCP `execute_sql` (no con la anon key).

- **Sólo** lo que YA está pusheado y roto: bug que llegó al usuario, dato o migración corrupta, config o
  credencial rota o filtrada, performance degradada, derivada desincronizada.
- **No**: feature, cambio, refactor, bug arreglado antes de pushear, ajuste de estilo o texto.
- Antes de escribir: mostrar el SQL exacto y pedir "sí". Detectado → proponer `registrar_problema` antes de
  tocar; fix pusheado → proponer `cerrar_problema` con el SHA; commits extra → `agregar_commit`. 1 problema =
  N commits. Sin fix → queda `abierto`. Se avisa el **TÍTULO** del problema, no el id.
- Estados: `abierto`, `en_curso`, `corregido`, `no_corregible`, `descartado`. `corregido` exige `correccion` +
  `corregido_en`. No se borra.

```sql
select github_repo_problemas.registrar_problema(p_repo=>'loekemeyer/registro-produccion-3.0',
  p_titulo=>'<síntoma ≤120>', p_descripcion=>'<rotura>', p_categoria=>'<bug|datos|seguridad|performance|config|ux|deuda_tecnica|documentacion>',
  p_severidad=>'<critico|alto|medio|bajo>', p_modulo=>'<módulo>', p_archivos=>array['<ruta>'],
  p_sesion_id=>'<sesión>', p_detectado_por=>'<usuario> (claude-remote)', p_detectado_en=>now());
select github_repo_problemas.cerrar_problema(p_id=><id>, p_correccion=>'<cambio>', p_commit_sha=>'<sha>',
  p_branch=>'<branch>', p_commit_url=>'https://github.com/loekemeyer/registro-produccion-3.0/commit/<sha>',
  p_causa_raiz=>'<causa>', p_corregido_por=>'<usuario> (claude-remote)', p_mensaje=>'<commit>');
select github_repo_problemas.agregar_commit(<id>, '<sha>', '<branch>', '<url>', '<mensaje>', '<autor>');
select * from github_repo_problemas.v_problemas order by detectado_en desc;
```

## Reglas heredadas de los repos de origen

- **Claves de Supabase**: sólo `sb_publishable_` en el front. Nunca escribir código nuevo con la `anon` legacy
  (JWT `eyJhbGciOiJIUzI1NiIs…`) ni dejar una `sb_secret_` / `service_role` en un archivo de este repo.
- **Todo cambio de JS/CSS/HTML de una app bumpea su versión** en el mismo commit (los celulares cachean fuerte):
  `?v=` del `<script>`/`<link>` y la versión propia de esa app (`APP_VERSION` en `virgilio/index.html`, `SW_VERSION` en
  `virgilio/sw.js` y `virgilio/version.json`; `LOCAL_VERSION` + `CACHE_VERSION` en `cervantes/`; `SW_VERSION` en el
  `sw.js` de la raíz; `version.js` en `gp2/`).
- **Series de versión de este repo**: Virgilio `v30.NN`, Cervantes `v3.0.N`. Virgilio las compara con `_verNum`, que sólo
  acepta `vMAYOR.MENOR`: no agregar sufijos.

## Convenciones de este repo

- **Funciones de Supabase que se creen para este repo** `[usuario, 06/10/2026]`: se llaman `Reg_Prod_3_0_<nombre>`
  (sin punto, para no tener que usar comillas dobles). Sin comillas Postgres las guarda en minúsculas
  (`reg_prod_3_0_<nombre>`), y desde el cliente se llaman así. Las Edge Functions llevan el mismo prefijo.
- **Pruebas**: `node tests/<nombre>.cjs` (Playwright). Correr las que toquen lo modificado antes de commitear;
  `modulo-minimizar-anular` es intermitente en el código original también.
- **`virgilio/index.html` tiene un byte nulo legítimo**: `grep -a`, y modificarlo con parches que lo conserven (no con
  herramientas que reescriban el archivo como texto).
- **Cambios en `main`** `[usuario, 06/10/2026]`: se hacen directo en `main`, sin pull request, salvo que se pida otra cosa.
