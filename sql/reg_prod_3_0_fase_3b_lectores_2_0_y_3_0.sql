-- ESTADO: APLICADO el 09/10/2026 (MCP execute_sql), con el «sí» de Elías. Verificado: las 5 funciones leen las vistas, toggle con id < 0, cron del
-- reporte cuenta espejo_todas, anon no ve las vistas. FALTA la Edge Function reporte-diario-rendimiento (sigue leyendo sólo db_n8n_espejo).
-- Registro Producción 3.0 — FASE 3b · lo que hoy lee sólo Registro Producción 2.0 pasa a leer 2.0 + 3.0
-- [Elías, 09/10: «si tienen que leer que de momento lean todas» — los operarios de Cervantes pasan a 3.0 el martes 13/10].
--
-- Idea: dos vistas con los MISMOS nombres de columna que las tablas de 2.0, así cada lector cambia sólo el FROM.
--   reg_prod_3_0.espejo_todas  = public.db_n8n_espejo (2.0) + reg_prod_3_0.procesado_cervantes (3.0, id NEGATIVO)
--   reg_prod_3_0.crudo_todas   = public."Registros Produccion Cervantes" (2.0) + reg_prod_3_0.crudo_cervantes (3.0, sin anulados)
-- Tiempos muertos: 2.0 guarda la duración en Segundos_Trabajados Y en Segundos_Tiempo_Muerto; 3.0 sólo en segundos_tiempo_muerto
-- (cervantes-gp2/app.js: rpc.segundos_tiempo_muerto = segs). La vista la copia a "Segundos_Trabajados" en las filas sin unidades.
-- Las vistas NO se exponen a anon/authenticated (datos nominales): sólo postgres y service_role.
--
-- Lectores que se cambian (cirugía sobre la definición viva: frena si el texto a reemplazar no aparece exactamente 1 vez):
--   planify_produccion_dia · planify_operario_mensajes_dia ·
--   gv_monitor_ingresos · gv_monitor_horas_operario_dia · gv_alerta_inactivo_servidor(boolean, timestamptz) · toggle_anular_tiempo (id < 0 = 3.0)
-- + el conteo del cron del reporte de las 18 h.
-- [Elías, 09/10: «3.0 de Cervantes tiene que hacer lo mismo que Reg Prod 2.0 — no estamos hablando de Gestión Productiva»]:
-- costos_sync_produccion y la racha de matrices (gp2_matriz_racha_*) son de GP2 y quedan afuera.
-- La Edge Function reporte-diario-rendimiento se cambia aparte (lee el espejo con supabase-js): sb.schema('reg_prod_3_0').from('espejo_todas').

begin;

-- 1) vistas -----------------------------------------------------------------------------------------------------------------------------
create or replace view reg_prod_3_0.espejo_todas as
select e.id, e."Fecha", e."Legajo", e."Nombre_Matriz", e."Matriz", e."Uni", e."Premio", e."Tiempo_Toma", e."Tiempo_Historico",
       e."Nombre_Empleado", e."Hora_Inicio", e."Hora_Fin", e."Anular_Tiempo", e."Segundos_Historico", e."Segundos_Trabajados",
       e."Segundos_Tiempo_Muerto", e."Dia", e."Mes", e."Quincena", e."ID_Ejecucion", e."Eliminar", e."Revisado",
       e."Fecha_Inicio", e."Fecha_Fin", e.created_at, '2.0'::text as fuente
  from public.db_n8n_espejo e
union all
select -p.id, p.fecha, p.legajo, p.nombre_matriz, p.matriz, p.uni::real, p.premio::double precision, p.tiempo_toma::real,
       p.tiempo_historico::real, p.nombre_empleado, p.hora_inicio, p.hora_fin, p.anular_tiempo, p.segundos_historico,
       case when coalesce(p.uni, 0) = 0 then coalesce(p.segundos_trabajados, p.segundos_tiempo_muerto) else p.segundos_trabajados end,
       p.segundos_tiempo_muerto, p.dia, p.mes, p.quincena, p.id_ejecucion, nullif(p.eliminar, ''), p.revisado,
       p.fecha_inicio, p.fecha_fin, p.created_at, '3.0'::text
  from reg_prod_3_0.procesado_cervantes p;

create or replace view reg_prod_3_0.crudo_todas as
select c.id, c.legajo, c.opcion, c.descripcion, c.texto, c.ts_event, c.hs_inicio, c.matriz, c.created_at, '2.0'::text as fuente
  from public."Registros Produccion Cervantes" c
union all
select k.id, k.legajo, k.opcion, k.descripcion, k.texto, k.ts_event, k.hs_inicio, k.matriz, k.created_at, '3.0'::text
  from reg_prod_3_0.crudo_cervantes k
 where not coalesce(k.anulado, false);

revoke all on reg_prod_3_0.espejo_todas, reg_prod_3_0.crudo_todas from public, anon, authenticated;
grant select on reg_prod_3_0.espejo_todas, reg_prod_3_0.crudo_todas to service_role;

-- 2) cirugía en los lectores --------------------------------------------------------------------------------------------------------
create or replace function pg_temp.cambiar(p_fn regprocedure, p_viejo text, p_nuevo text) returns void language plpgsql as $c$
declare d text; n int;
begin
  d := pg_get_functiondef(p_fn);
  n := (length(d) - length(replace(d, p_viejo, ''))) / length(p_viejo);
  if n <> 1 then raise exception '%: «%» aparece % veces (se esperaba 1)', p_fn, p_viejo, n; end if;
  execute replace(d, p_viejo, p_nuevo);
end $c$;

select pg_temp.cambiar('public.planify_produccion_dia(date)',
  'from public.db_n8n_espejo', 'from reg_prod_3_0.espejo_todas');
select pg_temp.cambiar('public.planify_produccion_dia(date)',
  'from public."Registros Produccion Cervantes"', 'from reg_prod_3_0.crudo_todas');
select pg_temp.cambiar('public.planify_operario_mensajes_dia(text,date)',
  'from public."Registros Produccion Cervantes" c', 'from reg_prod_3_0.crudo_todas c');
select pg_temp.cambiar('public.gv_monitor_ingresos(timestamptz,timestamptz)',
  'from public."Registros Produccion Cervantes" cv', 'from reg_prod_3_0.crudo_todas cv');
select pg_temp.cambiar('public.gv_monitor_horas_operario_dia(date)',
  'from public."Registros Produccion Cervantes" cv', 'from reg_prod_3_0.crudo_todas cv');
-- gv_alerta_inactivo_servidor(boolean) NO se toca: nadie la llama (el cron usa la de 2 argumentos) y ya está rota
-- (usa v_now sin declararlo: «column v_now does not exist»).
select pg_temp.cambiar('public.gv_alerta_inactivo_servidor(boolean,timestamptz)',
  'from public."Registros Produccion Cervantes" cv', 'from reg_prod_3_0.crudo_todas cv');

-- toggle_anular_tiempo: id > 0 = espejo (2.0, como siempre) · id < 0 = procesado_cervantes de 3.0 (misma convención que GP2.v_produccion_todas)
create or replace function public.toggle_anular_tiempo(row_id bigint)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  current_val boolean;
begin
  if row_id < 0 then
    select anular_tiempo into current_val from reg_prod_3_0.procesado_cervantes where id = -row_id;
    if current_val is null then return null; end if;
    update reg_prod_3_0.procesado_cervantes set anular_tiempo = not current_val where id = -row_id;
    return not current_val;
  end if;
  select "Anular_Tiempo" into current_val from "db_n8n_espejo" where id = row_id;
  if current_val is null then
    return null;
  end if;
  update "db_n8n_espejo" set "Anular_Tiempo" = not current_val where id = row_id;
  return not current_val;
end;
$function$;

-- 4) cron del reporte de las 18 h: cuenta 2.0 + 3.0 ----------------------------------------------------------------------------------
select cron.alter_job(j.jobid, command := replace(j.command, 'FROM public.db_n8n_espejo', 'FROM reg_prod_3_0.espejo_todas'))
  from cron.job j
 where j.jobname = 'reporte-diario-rendimiento-18hs'
   and (length(j.command) - length(replace(j.command, 'FROM public.db_n8n_espejo', ''))) / length('FROM public.db_n8n_espejo') = 1;

do $v$ begin
  if (select count(*) from cron.job where jobname = 'reporte-diario-rendimiento-18hs' and command like '%reg_prod_3_0.espejo_todas%') <> 1 then
    raise exception 'el cron del reporte no quedó leyendo espejo_todas';
  end if;
end $v$;

commit;
