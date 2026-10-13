-- ESTADO: APLICADO el 13/10/2026 (MCP execute_sql), con el «sí» de Elías («3 si»), en tres partes. Medido antes: el recálculo de
-- una matriz tarda ~0,6 s (igual que el del espejo de 2.0). Probado en transacción deshecha: un RM y un PM de 3.0 de otro legajo
-- suman 2 accidentes a la 12 (el PM una vez) y Alertas muestra «RM 12» y el PM.
-- Registro Producción 3.0 — FASE 3i · GP2 ve los RM y PM que se cargan en 3.0
-- [Elías, 13/10: «3 si» — Alertas y «Unidades sin accidente» de GP2 no veían los RM/PM de 3.0].
--
-- 3.0 graba la rotura como matriz = '12', nombre_matriz = 'Rotura Matriz' (2.0: «RM 12»), y el Pare Matriz como tiempo muerto con
-- dos filas (abre: hora_inicio vacía; cierra: con los segundos). Se lee así:
--   1) GP2.alertas_bundle: RM y PM de 3.0 se muestran como «RM 12» / «PM 12» (el PM, una sola vez: la fila que abre). Sin legajo 0.
--   2) public.gp2_matriz_racha_sync: lee reg_prod_3_0.espejo_todas (2.0 + 3.0) en vez de sólo el espejo de 2.0; la matriz de un RM/PM
--      de 3.0 sale de la fila (no se infiere); el PM de 3.0 cuenta una vez; sin legajo 0 (pruebas).
--   3) trigger en reg_prod_3_0.procesado_cervantes: un cajón, un RM o un PM de 3.0 recalculan la racha de ESA matriz (como el espejo).

-- 1) alertas_bundle ------------------------------------------------------------------------------------------------------------
do $$
declare src text; n int;
  v1 constant text := $v$  select nombre_matriz, matriz_raw, legajo, nombre_empleado, fecha,$v$;
  n1 constant text := $v$  select case when fuente = 'reg_prod_3_0' and nombre_matriz = 'Rotura Matriz' then 'RM ' || btrim(matriz_raw)
              when fuente = 'reg_prod_3_0' and nombre_matriz = 'Pare Matriz' and hora_inicio is null then 'PM ' || btrim(matriz_raw)
              else nombre_matriz end as nombre_matriz,   /* fase 3i: RM/PM de Registro 3.0 */
         matriz_raw, legajo, nombre_empleado, fecha,$v$;
  v2 constant text := $v$    and fecha >= (select d from ref) - interval '30 days'$v$;
  n2 constant text := $v$    and fecha >= (select d from ref) - interval '30 days'
    and btrim(coalesce(legajo, '')) <> '0'   /* fase 3i: el legajo 0 es de pruebas */$v$;
begin
  select p.prosrc into src from pg_proc p where p.pronamespace = '"GP2"'::regnamespace and p.proname = 'alertas_bundle';
  if strpos(src, 'fase 3i') > 0 then raise exception 'alertas_bundle ya tiene la fase 3i'; end if;
  foreach n in array array[(length(src) - length(replace(src, v1, ''))) / length(v1),
                           (length(src) - length(replace(src, v2, ''))) / length(v2)] loop
    if n <> 1 then raise exception 'alertas_bundle: un texto aparece % veces', n; end if;
  end loop;
  execute format($f$create or replace function "GP2".alertas_bundle() returns jsonb language sql stable security definer
                    set search_path to "GP2" as $fn$%s$fn$
$f$, replace(replace(src, v1, n1), v2, n2));
end $$;

-- 2) gp2_matriz_racha_sync -----------------------------------------------------------------------------------------------------
do $$
declare d text; n int;
  v1 constant text := $v$           e."Nombre_Empleado" as emp
      from public.db_n8n_espejo e
     where e."Eliminar" is null$v$;
  n1 constant text := $v$           e."Nombre_Empleado" as emp, e.fuente, e."Hora_Inicio" as hi
      from reg_prod_3_0.espejo_todas e   /* fase 3i: Registro 2.0 + 3.0 */
     where e."Eliminar" is null and btrim(coalesce(e."Legajo", '')) <> '0'$v$;
  v2 constant text := $v$             case when e.nm ~ '^(RM|PM)[[:space:]]+[0-9]' then substring(e.nm from '[0-9]+')$v$;
  n2 constant text := $v$             case when e.fuente = '3.0' and e.nm in ('ROTURA MATRIZ','PARE MATRIZ') and e.matriz_prod <> '' then e.matriz_prod
                  when e.nm ~ '^(RM|PM)[[:space:]]+[0-9]' then substring(e.nm from '[0-9]+')$v$;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'gp2_matriz_racha_sync';
  if strpos(d, 'fase 3i') > 0 then raise exception 'gp2_matriz_racha_sync ya tiene la fase 3i'; end if;
  foreach n in array array[(length(d) - length(replace(d, v1, ''))) / length(v1),
                           (length(d) - length(replace(d, v2, ''))) / length(v2)] loop
    if n <> 1 then raise exception 'gp2_matriz_racha_sync: un texto aparece % veces', n; end if;
  end loop;
  d := replace(replace(d, v1, n1), v2, n2);
  -- el PM de 3.0 que CIERRA (con hora de inicio) no es otro accidente
  n := (length(d) - length(replace(d, $v$     where e.nm like 'RM %' or e.nm like 'PM %' or e.nm in ('ROTURA MATRIZ','PARE MATRIZ')$v$, '')))
       / length($v$     where e.nm like 'RM %' or e.nm like 'PM %' or e.nm in ('ROTURA MATRIZ','PARE MATRIZ')$v$);
  if n <> 1 then raise exception 'gp2_matriz_racha_sync: el where de acc_prod aparece % veces', n; end if;
  d := replace(d, $v$     where e.nm like 'RM %' or e.nm like 'PM %' or e.nm in ('ROTURA MATRIZ','PARE MATRIZ')$v$,
               $v$     where not (e.fuente = '3.0' and e.nm = 'PARE MATRIZ' and e.hi is not null)   /* fase 3i */
       and (e.nm like 'RM %' or e.nm like 'PM %' or e.nm in ('ROTURA MATRIZ','PARE MATRIZ')$v$);
  n := (length(d) - length(replace(d, $v$        or e.m  like 'RM %' or e.m  like 'PM %' or e.m  in ('RM','PM')$v$, '')))
       / length($v$        or e.m  like 'RM %' or e.m  like 'PM %' or e.m  in ('RM','PM')$v$);
  if n <> 1 then raise exception 'gp2_matriz_racha_sync: el or de acc_prod aparece % veces', n; end if;
  d := replace(d, $v$        or e.m  like 'RM %' or e.m  like 'PM %' or e.m  in ('RM','PM')$v$,
               $v$        or e.m  like 'RM %' or e.m  like 'PM %' or e.m  in ('RM','PM'))$v$);
  execute d;
end $$;

-- 3) trigger en lo procesado de 3.0 ----------------------------------------------------------------------------------------------
create or replace function reg_prod_3_0.reg_prod_3_0_racha_trg()
returns trigger language plpgsql security definer set search_path to '' as $fn$
begin
  if tg_op in ('UPDATE', 'DELETE') and btrim(coalesce(old.matriz, '')) ~ '^[0-9]'
     and (coalesce(old.uni, 0) > 0 or old.nombre_matriz in ('Rotura Matriz', 'Pare Matriz')) then
    perform public.gp2_matriz_racha_sync(btrim(old.matriz));
  end if;
  if tg_op in ('INSERT', 'UPDATE') and btrim(coalesce(new.matriz, '')) ~ '^[0-9]'
     and (coalesce(new.uni, 0) > 0 or new.nombre_matriz in ('Rotura Matriz', 'Pare Matriz'))
     and (tg_op = 'INSERT' or btrim(coalesce(new.matriz, '')) <> btrim(coalesce(old.matriz, ''))
          or coalesce(new.eliminar, '') <> coalesce(old.eliminar, '') or coalesce(new.uni, 0) <> coalesce(old.uni, 0)) then
    perform public.gp2_matriz_racha_sync(btrim(new.matriz));
  end if;
  return null;
end $fn$;

drop trigger if exists reg_prod_3_0_racha on reg_prod_3_0.procesado_cervantes;
create trigger reg_prod_3_0_racha after insert or delete or update of uni, matriz, nombre_matriz, eliminar
  on reg_prod_3_0.procesado_cervantes for each row execute function reg_prod_3_0.reg_prod_3_0_racha_trg();
