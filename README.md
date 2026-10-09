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
| `/` | **Inicio**: elegir Virgilio o Cervantes | `selector/` de `loekemeyer/Gestion-Virgilio` · `e7a7bbd` | `sw.js` → `inicio-v1.4` | — |
| `virgilio/` | App del operario de **Virgilio**: **sólo la botonera** (picking, armado, carga, remitos, racks, insumos…) | `loekemeyer/Gestion-Virgilio` · `e7a7bbd` (v26.92), recortada | `v30.NN` (hoy `v30.05`) | **sólo el código de la TV** |
| ~~`gp2/`~~ | **Borrada el 08/10/2026** [Elías: «2 si»]: era la copia vieja de la tablet de GP2 (`Operarios_GP2.html` + lo mínimo que necesitaba), sin enlace desde el 07/10 y lo único que seguía llamando a las 4 funciones de GP2 anotadas para borrar. Queda en el historial de git | `loekemeyer/Gestion-Productiva-2.0` · `3a526e8` (v1.245.2) | — | — |
| `cervantes/` | App de **Registro Producción 2.0** (matrices, cajones, tiempos muertos). **Sin enlace desde el 08/10** (la tarjeta «Cervantes» pasó a `cervantes-gp2/`); se abre a mano. **Se borra cuando hayan pasado todos los operarios** a `cervantes-gp2/` [Elías, 08/10]; hasta entonces sigue publicada. Ingreso por el código de la TV antes de entrar y registro del equipo | `loekemeyer/Gestion-Virgilio` · `e7a7bbd`, carpeta `cervantes/` (v1.9.3) | `v3.0.N` | **el código de la TV de Cervantes**, en el primer mensaje del día |
| `cervantes-gp2/` | **La botonera de la tablet de GP2 llevada al celular** (v3.1.8, 08/10/2026; **es la fuente**: se edita acá y GP2 copia): entra con el código de la TV, usa el **pase firmado**, escribe en `reg_prod_3_0` y mueve el stock de GP2 (Fase 1c). **Es lo que abre «Cervantes» en el inicio desde el 08/10** (Inicio v1.4) [Elías: «si»]. Ver «Cervantes · botonera de GP2» | `Produccion/RegistroApp/` de `loekemeyer/Gestion-Productiva-2.0` (hoy `e110890`), portada por script | `v3.1.N` | **el código de la TV de Cervantes** + pase |
| `supabase.js` (raíz) | supabase-js propio, compartido: `virgilio/` y `cervantes/` lo cargan con `../supabase.js` | `loekemeyer/Gestion-Virgilio` | — | — |
| `selector/` | Sólo una redirección a `/` (URL vieja) | — | — | — |
| `tests/` | Pruebas con Playwright (ver «Pruebas») | 8 de `Gestion-Virgilio` + 5 nuevas | — | — |

**Versiones de este repo**: Virgilio usa la serie `v30.NN` (3.0), Cervantes `v3.0.N` y la botonera nueva de Cervantes (`cervantes-gp2/`) `v3.1.N`, para no pisarse con las
`v26/v27` y `v1.9.x` de Gestión Virgilio en los logs. Virgilio compara versiones con `_verNum`, que sólo acepta
`vMAYOR.MENOR`: no se le pueden poner sufijos.

## Hacia dónde va (acordado con Elías, 07/10/2026)

- **Registro Producción 3.0 es la página de los operarios** (Cervantes y Virgilio). **GP2 y Gestión Virgilio quedan sólo como páginas
  de admin.** La botonera de Cervantes pasa a ser la de la tablet de GP2 («como funciona hoy GP2»).
- **Los operarios entran sólo con el código de la TV**, sin Google. **El pase lo firma la base** (HMAC con un secreto en Vault,
  atado al equipo, hasta las 17:45 o 3 horas si ya pasaron): `reg_prod_3_0.reg_prod_3_0_pase_emitir` y `..._pase_ok`. `cervantes/` y `virgilio/`
  todavía lo guardan sólo como marca local. **`cervantes-gp2/` ya lo usa**: guarda el pase que devuelve `reg_prod_3_0_cerv_ingresar` y se lo
  manda a cada función (`p_pase`, `p_dispositivo`). Virgilio (la app vieja) **no tiene pase**: `loginConClaveTv` valida el código con la clave
  pública y guarda el legajo en `localStorage`; la base no verifica nada después.
- **Auditoría de horarios** [Elías, 07/10]: un ingreso pasada la hora del pase (17:45) o **más de 30 minutos antes del inicio de la
  jornada** (08:30 Cervantes, 08:00 Virgilio) no se bloquea: queda además en `reg_prod_3_0.auditoria` para revisar (`revisado`,
  `revisado_por`, `nota`). Los horarios están en `reg_prod_3_0.config` y se pueden cambiar. En la Fase 1b se aplica igual a cada toque.
- **Tablas nuevas en el schema propio `reg_prod_3_0`, separadas por sede** [Elías, 07/10: «tienen que estar separadas»]:
  `crudo_cervantes`, `crudo_virgilio` y `procesado_cervantes` (Virgilio sólo cruda), cada una con las MISMAS columnas que la
  vieja más `anulado`, `extra`, `origen` e `id_origen`. Para lo que tiene que mirar las dos sedes (por ejemplo cuánto duró el
  viaje de Cambio de Sede) está la vista de sólo lectura `reg_prod_3_0.crudo`, que las junta. La procesada la arma la base, en la
  misma transacción que guarda la cruda (como hoy `GP2.registrar_evento_prod`, que no tiene cruda), y mueve el stock de GP2
  (`GP2.fabricar_stock`) [Elías: «sí»]. Todo en tablas protegidas: se escribe sólo por funciones con pase. **Fase 1a aplicada
  el 07/10** (tablas, pase firmado, auditoría) y **Fase 1b aplicada el 07/10** (`reg_prod_3_0_bundle`, `_envasado_articulos`,
  `_registrar_evento`, `_anular_evento`; el SQL está en `sql/reg_prod_3_0_fase_1b.sql`). **Fase 1c aplicada el 07/10** (stock y rollos de GP2 con pase, sin tocar GP2; `sql/reg_prod_3_0_fase_1c.sql`). Falta el front de Virgilio.
- **Mientras se arma, los operarios siguen con las originales** (`Registros Produccion Cervantes`, `db_n8n_espejo`,
  `Registros_Produccion_Virgilio`). Cuando dejen el sistema anterior se migran los registros viejos a las tablas nuevas (con
  `origen` e `id_origen`, para poder repetir la copia sin duplicar) y se reapuntan los lectores.
- **Lo que hay que reapuntar en el corte** (medido el 07/10/2026): de Cervantes, 16 funciones, 1 vista, 1 trigger y 1 cron; de
  Virgilio, 85 funciones, 44 vistas, 19 triggers y 1 cron. **Plan A** [Elías]: las tablas nuevas tienen las mismas columnas, así que
  el día del corte las viejas se renombran y el nombre viejo pasa a ser una vista de compatibilidad sobre las nuevas. **Ojo**: eso
  alcanza para las funciones (buscan la tabla por nombre al ejecutarse), pero **las vistas quedan atadas a la tabla vieja por su
  identidad interna, no por el nombre**: las 44 vistas hay que recrearlas con el mismo texto (con un script) y los 19 triggers
  hay que crearlos sobre las tablas nuevas. Para volver a medirlo:

```sql
with t(nombre, grupo) as (values ('Registros Produccion Cervantes', 'Cervantes'), ('db_n8n_espejo', 'Cervantes'),
                                 ('Registros_Produccion_Virgilio', 'Virgilio')),
dep as (
  select 'función' tipo, n.nspname || '.' || p.proname objeto, t.grupo
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    join t on pg_get_functiondef(p.oid) ilike '%' || t.nombre || '%'
   where n.nspname not in ('pg_catalog', 'information_schema', 'zz_backups') and p.prokind = 'f'
  union
  select 'vista', v.schemaname || '.' || v.viewname, t.grupo from pg_views v join t on v.definition ilike '%' || t.nombre || '%'
   where v.schemaname not in ('pg_catalog', 'information_schema', 'zz_backups')
  union
  select 'cron', j.jobname, t.grupo from cron.job j join t on j.command ilike '%' || t.nombre || '%'
  union
  select 'trigger', c.relname || ' → ' || tg.tgname, t.grupo
    from pg_trigger tg join pg_class c on c.oid = tg.tgrelid join t on t.nombre = c.relname where not tg.tgisinternal)
select grupo, tipo, objeto from dep order by grupo, tipo, objeto;   -- sin la última línea, con count(distinct objeto) por grupo y tipo
```

- **Fase 1c** [Elías: «1 sí … y no se toca GP2»]: el stock (`GP2.fabricar_stock`) y los rollos (`tomar_rollo`, `cerrar_rollo`) los mueven
  las funciones `reg_prod_3_0_*` después de verificar el pase, **sin cambiar nada de GP2** (ver «Cervantes · botonera de GP2»). **Aplicada
  el 07/10.** Sigue abierta una decisión: qué es «la armada» de Virgilio (hoy lo armado sale de triggers y vistas de Gestión Virgilio
  sobre la cruda).

## Cervantes · v3.1.11 (09/10/2026): el sistema de diseño de GP2

[Elías: «Habilito lo de tablet de operarios»] `cervantes-gp2/` toma los tokens de `gp2-modulo.css` de Gestión Productiva 2.0
(v2.0): barra oscura fija con el sello GP2, azul GP2 = acción que avanza, **tinta rellena = elegido** (botonera, matriz, rollo),
avisos con borde a la izquierda, tocables ≥ 44px. Sólo presentación (CSS de `index.html` y los `style` del cartel del código de la
TV en `app.js`); ninguna lógica cambió. `tests/cervantes-gp2.cjs` 126/126 (sólo cambia la versión esperada).

## Cervantes · la botonera de Registro Producción 2.0 (v3.1.9 y v3.1.10, 08/10/2026)

[Elías, 08/10: «2.0», «todo lo del 10 debería ser como Reg Prod», «la 501 pone los kilos», «sacá el editar de momento», «que no se
pueda eliminar el fin de jornada»]. Sobre la botonera de GP2 (que sigue para la E: picker, piezas por etiqueta, rollos) se trajo el
comportamiento de 2.0 (`cervantes/app.js`):

- **Qué botón ve cada uno**: `capsDe()` + `botonVisible()` de 2.0 con los permisos de `public."Empleados"` que trae el catálogo. Nunca un
  legajo fijo: lo que era «de Eduardo» (CT, «¿quedó resto?») es del alimentador. Matricería ve sólo TRM/TL/CM/REM; piedra MOV P; `ve_mm` MM.
- **Tiempos muertos**: con uno abierto sólo se puede tocar ése (los demás grises, como 2.0; antes se podía quedar trabado). PM es tiempo
  muerto (abre con aviso «Paro Matriz»); CM abre con «matriz nueva + balancín» (`reg_prod_3_0_asignar_matriz_balancin`, con pase) y se
  cierra con el 2.º toque; PCM al cerrarse pregunta si la matriz se rompió; TRM/TL/REM/MM/RD como 2.0.
- **RM**: cantidad obligatoria → cierra el cajón → marca la rotura (WhatsApp) → Cambiar Matriz (si tiene permiso); en una matriz de
  alimentador (tipo A) pregunta «Continuar / Cambiar Matriz», igual que al cerrar un cajón ahí. Si se recarga a mitad, se retoma.
- **501 en kilos** (cualquier matriz con `tiempo_unidad` = kg): coma o punto, se guarda con coma; la base calcula el premio en kilos y
  pasa los kilos a unidades de la pieza para el stock (kilos / `kg_x_uni`).
- **Premio** (fase 2a): se descuentan los tiempos muertos que caen adentro del cajón (`reg_prod_3_0_recalcular_cajones`).
- **Llegada tarde** con la hora de entrada de cada uno (Planify, si no Empleados, si no GP2; si no hay, 08:30) y en el historial.
- **WhatsApp** como 2.0 (Matriz sin Tiempo / Paro Matriz / Rompio Matriz), **nunca con el legajo 0** (pruebas).
- Legajo o matriz que no están: se vuelve a pedir el catálogo y se mira de nuevo. Sin «editar». El fin de jornada no se borra.
- **v3.1.10 — contador de cajón** (fase 2c) [Elías: «6 debería, y podés usar lo que tiene GP2 de máximo de unidades por cajón»]: «Faltan
  X unidades para completar el cajón» con `GP2.componente.uni_x_cajon` de la pieza; lo lleva la base al grabar el C (`reg_prod_3_0.
  contador_cajon`, compartido entre operarios; un reintento no suma), y el C tiene la casilla «cajón completo» (vuelve a 0; el excedente
  queda en la auditoría). Fuera, como 2.0: la 501 y el envasado.
- **v3.1.10 — Terminar Día como 2.0** [«8 usar el de Reg Prod y que envíe todo el día como respaldo» · «18 como en 2.0»]: resumen; «ya
  cerraste el día, se reemplaza»; el tiempo muerto abierto se cierra solo; matriz con contador → «¿Hiciste un último cajón?» (Sí: cantidad
  + cajón completo · No: el tiempo muerto desde el último cajón); otra matriz sin cajón → «¿Vas a seguir mañana?». El FJ tiene id fijo
  `fj_<legajo>_<día>` (la base pisa el anterior), lleva el día entero en el texto y después se reenvía el día en segundo plano. Distinto
  de 2.0 a propósito: el «Sí, hice un último cajón» cierra primero el tiempo muerto abierto (en 2.0 se perdía) y la lista de tiempos
  muertos es la del rol del operario.
- **v3.1.10 — «⚡ Continuar»** [«4 se tiene que»]: si ayer dijo «sigo mañana», hoy aparece entre E y C; el cajón suma lo de ayer (hasta
  su hora de salida, que ahora trae el catálogo) + lo de hoy, con `[CONT]`, y se descuentan sólo los tiempos muertos de hoy. Otro botón con
  el «Continuar» a la vista pide el código de Logística.
- **v3.1.10 — errores y envío** [«15 tiene que estar» · «16 como en 2.0»]: cada envío fallido va a `reg_prod_3_0.auditoria`
  (`reg_prod_3_0_registrar_error_envio`, al 1.er intento y cada 5); con algo en la cola se reintenta cada 3 s; y la cola se copia al
  IndexedDB (`rp3c-envio`) para que el service worker la mande con la app cerrada (background sync, con el pase), como 2.0.
- **v3.1.11 — «Sin conexión» en vez de «el legajo no existe»** [Elías, 09/10: «1 si»; auditoría 30/09, el mismo error en 2.0 con la base caída]:
  si el celular todavía no tiene catálogo (celular nuevo o caché borrado, sin señal o con la base caída), el legajo y la matriz no se
  rechazan como inexistentes: avisa «Sin conexión…» y vuelve a pedir el catálogo. Con catálogo, un legajo que no está sigue diciendo
  «no existe». `tests/cervantes-gp2.cjs` §12 (falla con v3.1.10).
- **v3.1.13 — el legajo verdadero** [Elías, 09/10: «guarda su legajo verdadero» · «si hay un legajo que exista de alta al mismo tiempo
  con C y sin C que le pregunte quién es»]: los operarios salen de `reg_prod_3_0.operario` (liquidación de Planify, activo y de planta;
  fases 3e y 3f) con su legajo real (c19 = CHEF SRL). El operario escribe el número; si es de una sola persona entra con su legajo
  real, si es de dos (29 y c29) aparece «¿Quién sos?». Lo que carga se graba con el legajo verdadero. `tests/cervantes-gp2.cjs` §13.
- **v3.1.14–v3.1.15 (Cervantes) / v30.15 (Virgilio) — Cambiar sede** [Elías, 09/10: «te pide confirmar en grande, sí / no; si le da que sí lo
  cambia a la otra sede (con opción de cancelar y regresa a su sede anterior con el tiempo cancelado) … en poner la TV de la otra sede
  inicia el contador de tiempo; al lograr hacer el login en la otra sede, termina»]: «🔁 Cambiar a Virgilio» en la botonera de
  Cervantes y «🔁 Cambiar a Cervantes» en Virgilio (el «← Cambiar planta» de antes). Confirma en grande; con «Sí» abre el código de la
  TV de la otra sede (el pase o la sesión de antes no valen) con «✕ Cancelar el cambio», que vuelve y no graba nada. Al entrar ESE
  operario (código + legajo), la sede a la que llega graba el tiempo muerto «CS · Cambio de Sede» desde el «Sí». No deja cambiar con
  un cajón o un tiempo muerto abierto (Cervantes) ni con algo abierto (Virgilio). Las dos apps comparten el localStorage (mismo sitio):
  el cambio en curso es `rp3_cambio_sede`; el legajo se compara por el número (Virgilio todavía graba 104, Cervantes c104). La copia de
  la tablet de GP2 no muestra el botón ni toma un cambio en curso (sólo dentro de `/cervantes-gp2/`; v3.1.15). `tests/cambio-sede.cjs`.
- **v30.16 (Virgilio) — la misma lista de operarios** [Elías, 09/10: «GP2 y 3.0 Cervantes tienen que tomar del mismo lugar … y el de
  Virgilio también» · «no es anon, tiene que ser al enviar con el token que se obtiene de la pantalla»]: el código de la TV llama a
  `reg_prod_3_0_virgilio_operarios` (schema `reg_prod_3_0`), que devuelve los operarios de `reg_prod_3_0.operario` (los 18 de planta,
  de las dos sedes) en vez de la lista de Gestión Virgilio (los que trabajaron en Virgilio en 15 días, con apodos). Virgilio sigue
  grabando el número (104); viaja también `legajo_verdadero`. Fase 3g: `sql/reg_prod_3_0_fase_3g_una_lista_de_operarios.sql`.
- SQL: `sql/reg_prod_3_0_fase_2a_premio_con_tm.sql`, `sql/reg_prod_3_0_fase_2b_botonera.sql`, `sql/reg_prod_3_0_fase_2c_fin_de_jornada_y_cajon.sql`.
  Prueba: `tests/cervantes-gp2.cjs` §10 y §11.

## Cervantes · botonera de GP2 (`cervantes-gp2/`, v3.1.6, 08/10/2026)

Es la tablet de GP2 (`Produccion/RegistroApp/operarios_gp2.js` + `Operarios_GP2.html` de `loekemeyer/Gestion-Productiva-2.0`) portada al
celular del operario [Elías: «tendría que ser el de GP2, como está funcionando actualmente»]. **Desde el 08/10 es lo que abre la tarjeta
«Cervantes» del inicio** (antes, `cervantes/`, que queda sin enlace).

- **Desde el 08/10 la fuente es ESTE repo** [Elías: «se va a dejar de modificar en GP2 y modificar en este, y GP2 sólo hacer copia y hacer
  modificaciones para testear»]: los cambios se hacen a mano en `cervantes-gp2/app.js` e `index.html` (con el bump `v3.1.N` en `APP_VERSION`,
  `SW_VERSION`, `?v=` y `MI_V`). GP2 copia de acá y prueba en su copia; nada viene de GP2 hacia acá. Hasta la v3.1.6 se **generaba** desde la
  tablet de GP2 con `tools/portar_botonera_gp2.py` (la última, desde GP2 `e110890`, v1.251.1: arreglos de 3.0, chip de la pieza adentro de
  la tarjeta y lista de matrices vacía hasta escribir); el script se borró el 08/10 y queda en el historial de git.
- **Ida y vuelta con GP2** (08/10) [Elías: «hacé que GP2 use el código de la TV»; «cambios en GP2 y cuando están terminados… implementá
  lo nuevo de GP2 a Reg Prod 3.0 en Cervantes, y que no cometa errores»]: la tablet de GP2 es una COPIA exacta de esta (graba igual, en
  `reg_prod_3_0`; lo cargado desde GP2 lleva `app_version` `gp2-…` y `p_app` `gp2`). Ida (3.0 → GP2): `tools/copiar_botonera_de_3_0.py`
  de GP2. Vuelta (lo terminado en GP2 → acá): `tools/traer_de_gp2.py`, con control de vuelta exacta y unión con `git merge-file` si los
  dos lados cambiaron (probado: sin cambios no escribe; cambio simple → v3.1.N y 69/69; punto de la copia tocado → frena; 3.0 cambió
  otra línea → une; misma línea → frena).
- **Cada función de GP2 de la tablet vieja tiene su par acá y hace lo mismo** (08/10) [Elías: «verificá que todas las funciones de GP2
  tengan la función correspondiente en Reg Prod 3.0»]: `sql/verificar_gp2_vs_3_0.sql` corre las dos con los mismos datos en una
  transacción que se deshace (no escribe nada) — 7 casos de toque, anular, duplicado, catálogo y rollos: todo igual. Las 4 de GP2 que
  quedaron sin pantalla están anotadas para borrar en GP2 (`db/PENDIENTE_borrar_funciones_tablet_vieja.sql`); una de las condiciones
  era borrar la copia vieja `gp2/` de este repo, que todavía las llamaba: se borró el 08/10. v3.1.7: los rollos van
  siempre con id anti-duplicado (`reg_prod_3_0_rollo_tomar` / `_rollo_cerrar`).
- **Entrada**: pantalla del código de la TV de Cervantes (misma que `cervantes/`), antes de entrar. La base devuelve un **pase firmado**
  (`reg_prod_3_0_cerv_ingresar` → `{ok, pase, vence}`) que se guarda en el celular (`rp3c_pase`) y vale hasta las 17:45 (3 h si se entra
  más tarde). Sin internet o con la base caída se puede cargar: los toques quedan en la cola con un aviso arriba («esperan el código de
  la TV») y salen cuando haya pase. Si la base responde «Pase inválido o vencido» (venció, o es de otro equipo) el pase se descarta y
  vuelve el código; lo cargado no se pierde.
- **Qué llama**: sólo funciones de `reg_prod_3_0` (cabecera `Content-Profile`), con `p_pase` y `p_dispositivo`: `reg_prod_3_0_bundle`,
  `_registrar_evento`, `_anular_evento`, `_tomar_rollo` y `_cerrar_rollo`. **No llama a ninguna función de GP2** (la prueba lo verifica).
  `registrar_evento` guarda la **cruda** tal cual (`p.toque`: id, opción, texto, hora, versión), arma la **procesada** (unidades, premio,
  `matriz_id`) y **mueve el stock de GP2**, todo en la misma transacción.
- **Stock y rollos (Fase 1c, aplicada el 07/10)**, **sin tocar GP2**: tras verificar el pase, cada función marca el pedido como interno
  (`request.jwt.claims` = `service_role`) sólo durante esa transacción, llama a `GP2.fabricar_stock` / `tomar_rollo` / `cerrar_rollo` y lo
  deja como estaba. Las que hacen la marca (`reg_prod_3_0_gp2_*`) no se pueden llamar desde la API; `reg_prod_3_0_gp2_diagnostico(pase,
  equipo)` es de sólo lectura y dice si la marca anda. El selector de rollo, «¿quedó resto?» y el botón **CT de Eduardo (legajo 19)** se
  ven sólo si el catálogo trae `rollos_activos` (lo trae desde la 1c).
- **Lista de matrices (E / CM) vacía hasta escribir** [Elías, 08/10: «que si no escribo nada no aparezca nada; después de escribir la
  1.ª letra aparezcan cosas»]: sin texto no se ve ninguna ni el rótulo «O elegila de la lista»; desde la 1.ª letra o número aparecen las
  que coinciden por número o nombre (v3.1.5; GP2 hizo lo mismo en su tablet, v1.251.1).
- **Catálogo en el celular**: el bundle se guarda (`rp3c_bundle`) para poder abrir sin señal; con la app abierta se vuelve a pedir cada 30 min.
- **Botonera**: la de GP2 hoy: 13 botones (E, C, PB, BC, MOV, LIMP, Perm, AL, PR, PC, MOV P, PM, RM; + CT para Eduardo), llegada tarde (LT),
  fin de jornada (FJ), historial del día con 🗑 (anula en la base; sin señal o sin pase la baja queda en su cola `rp3c_aqueue`, una sola
  por toque, y sale después de los eventos), días anteriores, y **la pieza se elige por su etiqueta corta**
  (`GP2.matriz_salida_etiqueta`: 105 etiquetas en 42 matrices) como la tablet de GP2 desde el 07/10.
- **Qué botones de la app vieja no están** (uso en los últimos 60 días, `Registros Produccion Cervantes`): **CM** 66 toques, 1 operario
  (último 06/10); **MM** 2 toques, 1 operario (04/09). REM, PCM, TRM, TL y RD no tuvieron ningún toque. La tablet de GP2 sacó CM el
  29/08 («con E alcanza para cambiar de matriz»).
- **Prueba**: `node tests/cervantes-gp2.cjs` (69 chequeos con Supabase simulado: código de la TV, pase, catálogo, E/C, historial y anular, sin
  señal, pase vencido, base caída, etiqueta de pieza, rollos y CT, rollo con respuesta perdida (mismo id), 🗑 sin señal (en cola, una vez, después del toque; rechazo de la base no borra), y que no se llame a GP2). La Fase 1c se probó además en una base local
  (marca y restauración de claims, stock una sola vez, rollback si falla el stock, rollos, pase falso) y por la API real (sin mover stock).

### Revisión contra GP2 (07/10/2026)

- **Igual que GP2** [Seguro, comparado]: el catálogo (los 9 bloques de `GP2.registro_operarios_bundle`, idénticos en la base real);
  unidades, golpes, `tiempo_toma`, `tiempo_historico` y premio (toque de prueba en la base real: 100 golpes, 540 s → `tiempo_toma` 5,4 y
  premio 1,43, la misma fórmula que `GP2.registrar_evento_prod`); qué pieza recibe el stock y cuándo se mueve; `tomar_rollo`; la botonera.
- **Distinto a propósito**: se entra con el código de la TV y el pase, no con Google · se guarda la cruda además de la procesada · anular
  marca también la cruda · `segundos_historico` se llena (GP2 lo deja vacío) · los kg usados del rollo y `cerrar_rollo` suman lo de GP2 y lo
  de 3.0 **sin contar lo anulado** (GP2 cuenta lo anulado) · un error de red deja el toque PENDIENTE (en GP2, ERROR) · los toques fuera de
  horario quedan en `reg_prod_3_0.auditoria` · el catálogo se guarda en el celular.
- **Mejor que GP2: Fase 1d** (`sql/reg_prod_3_0_fase_1d.sql`, **aplicada el 07/10**; la pieza de anular la pegó Elías en el SQL Editor) [Elías: «que devuelva el stock» · «sistema anti duplicado»]:
  anular un toque **devuelve el stock** (se borran sus movimientos, como hace `GP2.anular_recepcion`, y el trigger de `GP2.movimiento`
  revierte el inventario; una sola vez) y tomar/cerrar rollo llevan un **id anti-duplicado** (`reg_prod_3_0.rollo_llamadas`), como ya lo
  tenían los toques: un reintento no descuenta otro rollo ni cierra el siguiente. En GP2 (tablet y base) no existe ninguna de las dos
  cosas. La app usa las funciones nuevas sólo si el catálogo trae `rollos_antiduplicado`.
- **Llevado al original** [Elías: «los cambios/parches … aplicalos también al original»]: `sql/gp2_arreglos_desde_3_0.sql` (los mismos tres
  arreglos en el schema GP2: anular devuelve el stock, rollos con id anti-duplicado, lo anulado no cuenta para el rollo) y, para que GP2
  lea lo de 3.0, la vista `reg_prod_3_0.produccion_gp2` (`sql/reg_prod_3_0_vista_produccion_gp2.sql`, con la forma de `GP2.produccion`).
  **Aplicados el 07/10** (vista incluida); `GP2.anular_evento_prod` con la devolución del stock lo pegó Elías en el SQL Editor el 08/10 y se
  probó en la base dentro de una transacción deshecha: registrar mueve el stock, anular lo deja idéntico y anular dos veces no devuelve de más.
  La tablet de GP2 ya los usa (GP2 `d4c8bf9`, v1.251.0: sin señal = PENDIENTE, 🗑 en cola, rollos con id) y `cervantes-gp2` v3.1.4 sale de ella.
- **Para el corte**: los informes de GP2 leen `GP2.produccion` (15 funciones: `informes_bundle`, `produccion_bundle`, `alertas_bundle`,
  `inicio_bundle`, `problemas_matrices_bundle`…) y **no van a ver lo de 3.0** hasta que se reapunten; por eso la procesada ya guarda
  `matriz_id`. Hoy `GP2.produccion` recibe poco: 41 filas en 30 días, de 1 legajo.
- **`cervantes/` (la app vieja)** pide los nombres de artículo a `GP2.reg_prod_3_0_envasado_articulos`, que **nunca existió en la base**: en
  esa app nunca se vieron (cae a lo de siempre, no rompe nada). GP2 resolvió lo mismo con la etiqueta corta, que es lo que usa `cervantes-gp2/`.

## Qué cambió respecto de la copia (06/10/2026)

1. **Inicio**: la raíz es la pantalla «¿Dónde vas a trabajar hoy?». Virgilio se movió entero a `virgilio/`. En Virgilio
   ya no hay segundo selector de planta: el operario cae directo en su botonera. «Cambiar planta» vuelve a `/`.
2. **Virgilio, login sólo con la TV** (`SOLO_TV` en `virgilio/index.html`): código de 4 dígitos de la TV → nombre de
   una lista. **Desde la v30.07 (Thomas, 06/10) no hay entrada por legajo**: «＋ No estoy en la lista» → nombre y
   apellido → registra el alta (`gv_operario_alta_crear`) y **entra ya** con el legajo compartido 600 y su nombre
   (v30.08, igual que Gestión v27.37); un admin lo valida con su legajo en Gestión Virgilio (⚙️ → Validar Operarios)
   y desde ahí aparece en la lista. La entrevista usa el mismo camino. Una sesión de Google guardada se ignora (y no se borra: el origen se
   comparte con GP2). Los **supervisores no entran por este Virgilio**: su panel sigue en Gestión Virgilio.
3. **Cervantes = `cervantes/`, desde el celular del operario** (inicio v1.3, 07/10) [Elías: «ya no estamos en GP2, no usan la tablet,
   usan su celular personal»]. Entre el 06/10 18:54 y el 07/10 la tarjeta abría la tablet de GP2 (decisión de Nazareno);
   volvió a abrir `cervantes/`. La tablet de GP2 quedó sin enlace (y se borró del repo el 08/10) (con el mismo cambio de envasado, abajo).
4. **Cervantes, ingreso con el código de la TV** (`asegurarEntrada`, `cervantes/app.js` v3.0.5) — reemplaza el login por Wi-Fi
   de v3.0.1–v3.0.3 [Elías, 07/10: «ya no va a ser por wifi»; el código manual de logística también se descartó]. **Se pide
   antes de entrar** [Elías, 07/10: «antes de entrar, al elegir el lugar»]: al abrir `cervantes/` sin pase de hoy aparece una
   pantalla que tapa todo y pide los **4 números del monitor TV de Cervantes** (cambian cada minuto; vale el de este minuto
   y el anterior), con «← Volver al inicio». (En v3.0.4 se pedía en el primer mensaje del día; no llegó a usarse.) El monitor
   lo armó el otro chat (GP2 v1.246.0, `Produccion/MonitorIngreso/MonitorIngreso_GP2.html`, pastilla «🔑 Monitor» del menú de
   GP2) con `GP2.monitor_clave_actual()` (sólo un mail habilitado); este repo sólo valida con `GP2.monitor_clave_validar()`, a
   través de `public.reg_prod_3_0_cerv_ingresar` (ver el punto 7).
   - **Código bien** → entra y queda un *pase* del **equipo**, válido hasta las **17:45** (hora de Buenos Aires): todavía no hay
     legajo, así que el pase no es por legajo. Con el pase, aunque se corte la luz o internet, siguen registrando: la cola
     envía cuando vuelve internet. El pase es sólo local (no guarda el código).
   - **Código mal o vencido** → la pantalla sigue. **Demasiados intentos** → lo dice y la pantalla sigue (el tope lo pone la base).
   - **Sin internet** (o la función caída) → se puede entrar y cargar: el mensaje queda **retenido** en la cola: no pasa al
     IndexedDB (así el service worker no lo manda) y `reconcileQueueWithIDB` no lo da por enviado. **Al volver internet no valida
     solo** (el código vence a los 2 minutos): la pantalla vuelve a aparecer; si no se pudo verificar (función caída) no se abre sola
     por 5 minutos y el aviso fijo de arriba ofrece «Ingresar código» (con «Ahora no»). Con el código bien se libera y se envía todo
     con su hora original.
   - Si se pasan las 17:45 con la app abierta, la pantalla vuelve al volver a ella; y el envío tiene la misma red de seguridad.
   - Cervantes **no usa la sesión de Virgilio** ni rebota al inicio por no tener sesión. La Edge Function `login-operario`
     sigue desplegada pero este repo ya no la llama.
5. **Virgilio recortado a la botonera** (v30.03 y v30.04): ver la sección siguiente.
6. **Nombre del artículo en las matrices de ENVASADO** (07/10/2026; `cervantes/` y, sin enlace, la tablet de GP2 `v1.245.2+3.0.2`), sólo
   para las que cierran un terminado (21 matrices, 42 artículos). Regla [Elías, 07/10]: dentro de una matriz, **si las piezas
   son el mismo artículo (mismo nombre) se muestra sólo la marca; si los nombres son distintos, nombre y marca**. En la 322
   el 394 y el 842 se llaman igual («Espátula Lisa Nylon 1 Pza») y se ven como **LK** y **CH**; en la 389 los nombres
   difieren («Ñoquera Madera Mgo Redondo» y «Ñoquera Madera») y se ve «Art. 229 · Ñoquera Madera» + LK, «Art. 909 · …» + CH.
   La marca va abreviada: **LK** = Loeke (diminutivo de Loekemeyer), **CH** = Chef; las demás tal cual (LOKE). Se ve en las
   tarjetas del selector de pieza, en la línea «Fabricás …» y en la de «matriz activa» (tablet de GP2), y en el aviso de
   «Empecé matriz» / «matriz en uso» (`cervantes/`, donde no hay selector: con el mismo artículo el nombre va una vez y las
   marcas al lado). Los datos salen de la RPC `GP2.reg_prod_3_0_envasado_articulos` (una llamada, ~6 KB). Sin la RPC la
   tablet queda como estaba («Art. 394» con el código del bundle) y `cervantes/` sin nombres.
7. **Registro de quién entra y desde qué equipo** (07/10/2026; `cervantes/` v3.0.5 y `virgilio/` v30.12) [Elías: «que tome la IP o
   MAC del celular / dispositivo, para tener registro de eso»]. Cada ingreso con el código de la TV deja una fila en
   `public.reg_prod_3_0_ingresos`: hora del servidor, app, legajo, nombre, ok / motivo, **IP que ve el servidor**, la cabecera
   `x-forwarded-for` tal cual, si la IP está en `public.red_empresa` (sede), **id del equipo**, huella, navegador y modelo,
   pantalla, zona e idioma. Es un **registro, no un bloqueo**.
   - **La MAC no se puede**: el navegador no la da (ni el IMEI ni la IP local). El equipo se identifica con el id `gv_dispositivo`
     (un UUID que queda en el celular; **es el mismo que ya usa Virgilio** desde v25.25, así un celular se reconoce en las
     dos apps) más una huella de sus características (navegador, pantalla, idioma, zona, núcleos, memoria, modelo).
     Borrar los datos del navegador genera un id nuevo; la huella ayuda a notarlo.
   - **La IP la anota el servidor** (función SQL que lee `request.headers`), no el celular. Detrás del Wi-Fi de la empresa
     todos comparten la misma IP pública: sirve para saber si estaba adentro (`red_empresa`) o afuera (datos móviles), no
     para distinguir personas.
   - **Cervantes** valida el código por `reg_prod_3_0_cerv_ingresar` (fila con `verificado = true`, sin legajo: todavía no hay).
     Al poner el legajo llama a `reg_prod_3_0_registrar_ingreso` (1 vez por legajo, equipo y día): anota qué legajo se usó en ese
     celular. **Virgilio** valida con `gv_tv_clave_validar` en Gestión; después de elegir el nombre llama a la misma
     `reg_prod_3_0_registrar_ingreso`. Esa sólo anota lo que el celular declara (`verificado = false`, no se le puede creer) y
     marca `ok = false` si el legajo no está activo en `Empleados`. Si la llamada falla, el operario entra igual.
   - **Alerta por Telegram** [Elías, 07/10: «sí»]: `reg_prod_3_0_alerta_dispositivo_multi_telegram()` (cron `7-59/10 * * * *`,
     la vista es `reg_prod_3_0_dispositivo_multi_legajo`) avisa cuando un mismo celular entra con **2 o más legajos** el mismo día en
     Cervantes, como ya hace Virgilio (`gv_alerta_dispositivo_multi_operario_telegram`). Mismo chat de Telegram; una alerta nueva
     sólo cuando cambia el conjunto de legajos.
   - Convive con lo de Luis (v25.25): `GV_Dispositivo_Login`, la vista `gv_dispositivos` y la alerta diaria «un mismo celular con N
     operarios» siguen como estaban; esto agrega la IP y a Cervantes.
   - Cómo se lee: `select * from reg_prod_3_0.reg_prod_3_0_ingresos order by at desc;`. Un equipo con varios legajos el mismo día:
     `select dispositivo, count(distinct legajo) from reg_prod_3_0.reg_prod_3_0_ingresos where ok group by 1 having count(distinct legajo) > 1;`.
   - **Ya está creado en la base** (07/10; el SQL exacto está en `sql/reg_prod_3_0_ingresos.sql` y, con la mudanza al schema propio
     `reg_prod_3_0`, en `sql/reg_prod_3_0_fase_1a.sql`): la tabla, las funciones internas, las 2 que llaman las apps, la vista de la
     alerta y el cron. Las 2 funciones que llaman las apps siguen en `public` como **atajos que delegan** (los celulares cachean la
     versión vieja); las apps nuevas llaman al schema `reg_prod_3_0` con la cabecera `Content-Profile: reg_prod_3_0`. **Quedan 3
     funciones viejas en `public`** (`reg_prod_3_0_alerta_dispositivo_multi_telegram`, `reg_prod_3_0_ingreso_log` y `reg_prod_3_0_ip`),
     sin uso y sin permisos para `anon`: la herramienta de Supabase no deja correr `DROP`, hay que borrarlas a mano. Se probó por HTTP con la clave
     pública: código bueno y malo, legajo inexistente, que `anon` no lee la tabla ni llama a las internas, y que la IP **no se
     falsifica** con `X-Forwarded-For` (la fila guarda la IP real en `ip` y el header tal cual en `xff`; sale de `cf-connecting-ip`).
     Dependencias: `GP2.monitor_clave_validar` (de GP2), `tg_enqueue`, `tg_outbox_flush`, `es_legajo_test`, `ip_en_red_empresa`.

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

- **La tablet de GP2 quedó sin enlace** (07/10: los operarios usan su celular) **y se borró el 08/10** [Elías: «2 si»]. Sigue con Google + lista blanca y sin el ingreso por
  la TV; se puede borrar cuando se confirme que no hace falta (la historia queda en git).
- **`cervantes/` es la visual de Registro Producción 2.0** con el ingreso por la TV y el registro de equipo encima. Falta ver con los
  operarios que no les cambia nada más.
- **El código de la TV se puede leer desde cualquier lado**: `gv_tv_clave_actual()` la ejecuta `anon` y la propia TV la
  llama con la clave pública. Hoy la TV sola no prueba presencia.
- **La base sigue abierta**: `Registros Produccion Cervantes`, `db_n8n_espejo` y `Auditoria_Produccion` tienen
  políticas `true` para `anon` (insert, update y delete) y `Empleados` deja insertar y actualizar. El pase de Cervantes
  se chequea sólo en la pantalla; cerrar las políticas es otra etapa (ver `docs/PLAN-LOGIN-OPERARIOS-RED.md` de
  Gestión Virgilio, etapas 3 y 4).
- **Si la TV está apagada, nadie inicia la jornada** (en `cervantes/`): los mensajes quedan retenidos hasta que alguien vea el
  código. Se descartó el código manual de logística [Elías, 07/10]. El código de 4 dígitos tiene 10.000 combinaciones y la
  base valida con tope de intentos sólo por equipo (10 en 10 min) y por IP (40 en 10 min): frena a quien adivina, no a quien
  mira la TV y se la pasa a otro.
- **Reinicio de la tablet sin internet** (en `cervantes/`): el service worker no cachea archivos y `cargarCatalogos` no
  guarda copia de `Empleados`, así que sin internet la página puede no cargar y, si carga, todo legajo da «Legajo no
  encontrado». El pase no lo resuelve (ya está registrado en la auditoría).
- **La RPC `GP2.reg_prod_3_0_envasado_articulos` hay que crearla en la base** (SQL pendiente de aprobación): hasta entonces no
  se ven los nombres de artículo. La marca sale de `GP2.articulo.marca`, que tiene **LOEKE** (115 artículos), **CHEF** (73) y
  **LOKE** (11): LOKE y LOEKE parecen la misma marca escrita de dos maneras (en pantalla, LOEKE se ve LK y LOKE se ve LOKE);
  en envasado hoy sólo hay LOEKE y CHEF.
- **Cambio de sede** (botón en Cervantes y Virgilio que mide el tiempo de viaje): no está hecho.

## ⚠ Lo que NO es lo que parece

- `virgilio/index.html` conserva **nombres de funciones y de tablas de Gestión Virgilio** que ya no se usan acá porque lo
  único que las llamaba era el supervisor; no son un error del recorte. Lo que sí es de este repo está marcado:
  `SOLO_TV` (login) y los comentarios «pantalla de supervisor, no incluida».
- El archivo **ya no tiene el byte nulo** que tenía el original (era el separador de claves de `_pppGeoCod`, código de
  supervisor): `grep` ya no lo trata como binario. Igual, modificarlo con parches y no reescribiéndolo como texto.
- `Registro_GP2.html` (la **Carga Manual Producción** de oficina) se sacó; la carpeta `RegistroApp/` conserva su
  `manifest.json`, `sw.js` y `styles.css`, que comparte con la tablet.
- **Una sola app instalable** desde el 08/10 [Elías: «1 si»]: el inicio, `virgilio/` y `cervantes-gp2/` usan **el mismo manifiesto, el de
  la raíz** (`manifest.json`: id `/Registro-Produccion-3.0/`, alcance y arranque en el inicio, íconos PNG de 192 y 512 en `icons/`,
  sacados de `icon.svg`). Se instale desde donde se instale, es la misma app «Producción», arranca en el inicio (que marca la planta
  de la «Última vez») y Virgilio y Cervantes quedan adentro, sin la barra de Chrome de «página fuera de la app».
  - Antes había 3 apps (cada carpeta con su manifiesto e id, todas con alcance `../`). Una «Producción» instalada desde `virgilio/`
    antes del 08/10 quedó **trabada con el alcance viejo** (sólo `virgilio/`): Chrome sólo actualiza una instalación desde un
    manifiesto con el mismo id, y el id de Virgilio cambió (`/Produccion-Virgilio/` → `/Registro-Produccion-3.0/virgilio/`). Síntoma
    [Elías, 08/10, con captura]: Cervantes con la barra y la X, y la X volvía al login de Virgilio. **Quien tenga esa app tiene que
    desinstalarla e instalar desde el inicio.**
  - La app vieja `cervantes/` (sin enlace) conserva su manifiesto, con alcance en la raíz.
  - `tests/inicio-selector.cjs` lo verifica (`unaSolaApp`, `sinManifiestosPropios`, `manifiestoCubreTodo`, `iconosPng`).

## Enlaces que quedan rotos (están fuera a propósito)

Ninguno desde el 08/10/2026: el único era `gp2/login.html`, que se fue con la carpeta `gp2/`.

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
| `inicio-selector` | `/` con las 2 tarjetas; Virgilio abre `virgilio/` con su login; **Cervantes abre `cervantes/`** y, antes de entrar, muestra la pantalla del código de la TV con «Volver al inicio»; `supabase.js` compartido; redirección de `selector/`; el alcance (`scope`) de las 3 apps instalables cubre el inicio |
| `virgilio-solo-operario` | **el recorte**: los archivos de supervisor no están; la página carga sin 404 ni errores; la botonera tiene sus 20 botones y cada uno se toca sin error; las entradas de supervisor no existen y los 5 cascarones y los paneles están vacíos (51 chequeos). Con el código sin recortar falla en 19 |
| `articulo-envasado` | nombre y marca del artículo en envasado, en `cervantes/` (8 chequeos; la parte de la tablet de GP2 se fue con `gp2/` el 08/10): regla «mismo artículo → sólo marca» (322) y «nombres distintos → nombre y marca» (389), abreviaturas LK/CH, línea colapsada, matriz de una sola pieza, matriz que no es de envasado y la RPC caída |
| `virgilio-solo-tv` | login de Virgilio sólo con TV, sin entrada por legajo y con la entrada por nombre (v30.08); el registro del equipo en cada ingreso (v30.12) y que si falla el operario entra igual (24 chequeos) |
| `cervantes-tv` | entrada de `cervantes/` con el código de la TV (52 chequeos): la pantalla aparece ANTES de la del legajo y la tapa, código mal y bien, qué manda a la base (app, código, id del equipo, huella, navegador, pantalla; sin legajo), anotación de cada legajo en el equipo (1 vez por día), recarga con pase, vigencia 17:44/17:50, 08:00 sin LT, arranque sin internet (retenido) y pantalla sola al volver, internet cortado con la pantalla abierta, «Ingresar código» / «Ahora no», demasiados intentos, función caída o sin crear, 7 códigos malos seguidos |
| `operario-queda-botonera`, `modulo-minimizar-anular`, `tarea-abierta-otro-dia`, `botonera-tm-historial`, `mg-reentrada`, `toggle-anular`, `rr-sin-remitos-cierra`, `encoding-utf8` | de Gestión Virgilio, con las rutas nuevas. `operario-queda-botonera` sin el segundo selector ni `chooseVirgilio` (lo llamaba el selector de planta); `modulo-minimizar-anular` sin el chequeo del monitor |

- `modulo-minimizar-anular` es **intermitente** (falla «BR re-entrar = mismo tramo» algunas corridas): pasa igual en el
  código original de Gestión Virgilio y falló 1 de 3 corridas sin estos cambios. No se tocó.
- **No se probó**: las pruebas de Playwright simulan Supabase (`reg_prod_3_0_cerv_ingresar`, `gv_tv_clave_validar` y las tablas); las funciones nuevas se probaron aparte por HTTP contra la base real, pero la app de punta a punta con un celular y la TV, no, el
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
| Cervantes = botonera de GP2 en el celular (la tarjeta «Cervantes» del inicio) | `/cervantes-gp2/` |
| Registro Producción 2.0 (sin enlace) | `/cervantes/` |

- El origen es el mismo `loekemeyer.github.io` que Gestión Virgilio y GP2: comparten `localStorage` y la sesión de
  Supabase. El login de GP2 vuelve a `origin + pathname`: la URL nueva tiene que estar permitida en Supabase →
  Auth → URL Configuration, o el login con Google devuelve al sitio viejo.
- La app de Play Store (TWA) apunta a `loekemeyer.github.io/Produccion-Virgilio/` (el despliegue actual de
  Virgilio), no a este repo: los operarios no cambian de app hasta que se republique.
