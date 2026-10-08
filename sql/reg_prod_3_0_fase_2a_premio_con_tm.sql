-- ESTADO: APLICADO el 08/10/2026 (MCP execute_sql). Verificado en transacción deshecha (ver el final de este archivo).
-- Registro Producción 3.0 — FASE 2a (08/10/2026) · EL PREMIO DESCUENTA LOS TIEMPOS MUERTOS, como Registro Producción 2.0
-- [Elías, 08/10: «El premio no descuenta los tiempos muertos: tiene que [ser] como en Reg Prod»].
--
-- Cómo lo hace 2.0 (cervantes/app.js, procesarParaEspejo + recalcularCajonesDelDia):
--   - a cada cajón (uni > 0) le resta los tiempos muertos del MISMO legajo y día que caen ADENTRO de su ventana
--     (inicio del TM >= inicio del cajón y fin del TM <= fin del cajón);
--   - segundos netos = brutos - TM (mínimo 1) · tiempo_toma = netos / uni (2 decimales) ·
--     premio = (1 - netos / (tiempo_historico × uni)) × 10 (2 decimales) · el cajón guarda en segundos_tiempo_muerto los TM que tuvo adentro;
--   - cada vez que entra un tiempo muerto, y cuando se borra uno, recalcula TODOS los cajones del día.
-- En 3.0 (= tablet de GP2) el cajón usaba los segundos brutos: en 60 días de 2.0, 540 de 866 cajones tenían TM adentro (333 h).
--
-- 1) reg_prod_3_0_recalcular_cajones(legajo, día): el recálculo de 2.0, en la base. Los segundos brutos salen de lo que mandó el
--    celular (crudo.extra->>'segundos_trabajados'); si no está, fin - inicio. Interna: no se llama desde la API.
-- 2) reg_prod_3_0_registrar_evento: después de grabar un cajón o un tiempo muerto, recalcula el día; el premio que devuelve es el neto.
-- 3) reg_prod_3_0_anular_evento: después de anular, recalcula el día (si se borra un TM, los cajones que lo tenían adentro suben).
-- Nota: la diferencia con GP2.registrar_evento_prod (tablet vieja, anotada para borrar) es a propósito: GP2 nunca descontó los TM.

-- 1) el recálculo ---------------------------------------------------------------------------------------------------------------------
create or replace function reg_prod_3_0.reg_prod_3_0_recalcular_cajones(p_legajo text, p_dia date)
returns int
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_n int;
begin
  with caj as (
    select c.id, c.uni, c.tiempo_historico th, c.fecha_inicio fi, c.fecha_fin ff,
           greatest(1, coalesce(nullif(k.extra->>'segundos_trabajados', '')::numeric,
                                extract(epoch from c.fecha_fin - c.fecha_inicio)::numeric)) bruto
      from reg_prod_3_0.procesado_cervantes c
      left join reg_prod_3_0.crudo_cervantes k on k.id = c.crudo_id
     where c.legajo = p_legajo and coalesce(c.uni, 0) > 0 and coalesce(c.eliminar, '') <> 'S'
       and (c.fecha at time zone 'America/Argentina/Buenos_Aires')::date = p_dia
  ), calc as (
    select caj.id, caj.uni, caj.th,
           greatest(1, caj.bruto - coalesce((
             select sum(t.segundos_tiempo_muerto) from reg_prod_3_0.procesado_cervantes t
              where t.legajo = p_legajo and coalesce(t.uni, 0) = 0 and coalesce(t.eliminar, '') <> 'S'
                and coalesce(t.segundos_tiempo_muerto, 0) > 0
                and (t.fecha at time zone 'America/Argentina/Buenos_Aires')::date = p_dia
                and t.fecha_inicio >= caj.fi and t.fecha_fin <= caj.ff), 0)) neto,
           coalesce((
             select sum(t.segundos_tiempo_muerto) from reg_prod_3_0.procesado_cervantes t
              where t.legajo = p_legajo and coalesce(t.uni, 0) = 0 and coalesce(t.eliminar, '') <> 'S'
                and coalesce(t.segundos_tiempo_muerto, 0) > 0
                and (t.fecha at time zone 'America/Argentina/Buenos_Aires')::date = p_dia
                and t.fecha_inicio >= caj.fi and t.fecha_fin <= caj.ff), 0) tm
      from caj
  )
  update reg_prod_3_0.procesado_cervantes c
     set segundos_tiempo_muerto = calc.tm,
         segundos_trabajados    = calc.neto,
         tiempo_toma            = round(calc.neto / calc.uni, 2),
         premio                 = case when calc.th > 0
                                       then round(((1 - calc.neto / (calc.th * calc.uni)) * 10)::numeric, 2) end
    from calc
   where c.id = calc.id;
  get diagnostics v_n = row_count;
  return v_n;
end $function$;

revoke all on function reg_prod_3_0.reg_prod_3_0_recalcular_cajones(text, date) from public, anon, authenticated;

-- 2) y 3) registrar y anular llaman al recálculo (cirugía sobre la definición viva: frena si no encuentra el punto exacto) -------------
do $$
declare
  d text; n int;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p
   where p.pronamespace = 'reg_prod_3_0'::regnamespace and p.proname = 'reg_prod_3_0_registrar_evento';
  n := (length(d) - length(replace(d, 'returning id into v_pid;', ''))) / length('returning id into v_pid;');
  if n <> 1 then raise exception 'registrar_evento: «returning id into v_pid;» aparece % veces', n; end if;
  if strpos(d, 'reg_prod_3_0_recalcular_cajones') > 0 then raise exception 'registrar_evento ya recalcula'; end if;
  execute replace(d, 'returning id into v_pid;', 'returning id into v_pid;

  -- premio como Registro Producción 2.0 (fase 2a): un cajón o un tiempo muerto recalculan los cajones del día (TM adentro se descuentan)
  if v_uni > 0 or coalesce(nullif(p->>''segundos_tiempo_muerto'', '''')::numeric, 0) > 0 then
    perform reg_prod_3_0.reg_prod_3_0_recalcular_cajones(v_leg, v_f_ar::date);
    select premio, tiempo_toma into v_premio, v_tt from reg_prod_3_0.procesado_cervantes where id = v_pid;
  end if;');

  select pg_get_functiondef(p.oid) into d from pg_proc p
   where p.pronamespace = 'reg_prod_3_0'::regnamespace and p.proname = 'reg_prod_3_0_anular_evento';
  n := (length(d) - length(replace(d, 'get diagnostics v_n = row_count;', ''))) / length('get diagnostics v_n = row_count;');
  if n <> 1 then raise exception 'anular_evento: «get diagnostics v_n = row_count;» aparece % veces', n; end if;
  if strpos(d, 'reg_prod_3_0_recalcular_cajones') > 0 then raise exception 'anular_evento ya recalcula'; end if;
  execute replace(d, 'get diagnostics v_n = row_count;', 'get diagnostics v_n = row_count;
  -- fase 2a: al borrar un tiempo muerto (o un cajón) se recalculan los cajones de ese legajo y día, como 2.0
  perform reg_prod_3_0.reg_prod_3_0_recalcular_cajones(x.legajo, (x.fecha at time zone ''America/Argentina/Buenos_Aires'')::date)
     from reg_prod_3_0.procesado_cervantes x where x.id_ejecucion = p_id_ejecucion;');
end $$;

-- VERIFICACIÓN (08/10/2026, transacción deshecha con raise exception, legajo 0, matriz 505 = 14,7 s/uni):
--   E 505 a las t0 · PC de t0-10' a t0-5' (AFUERA) · PB de t0+10' a t0+20' (600 s, ADENTRO) · C 200 uni a t0+40' (2.400 s brutos)
--   → cajón: segundos_trabajados 1.800, segundos_tiempo_muerto 600, tiempo_toma 9,00, premio 3,88 (la respuesta de la RPC también 3,88).
--   Anulado el PB → 2.400 s, 0 de TM, premio 1,84 (= sin descontar). El PC de afuera no se descontó nunca.
