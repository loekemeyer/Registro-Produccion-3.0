-- ESTADO: APLICADO el 09/10/2026 (MCP execute_sql). Probado antes en transacción deshecha (compila). Bundle, registrar_evento, cerv_ingresar y registrar_ingreso usan reg_prod_3_0.operario.
-- Registro Producción 3.0 — FASE 3f · 3.0 usa la tabla de operarios nueva (fase 3e) y graba el legajo VERDADERO (c19, no 19)
-- [Elías, 09/10: «guarda su legajo verdadero» · «si hay un legajo que exista de alta al mismo tiempo con C y sin C que le pregunte
--  quién es» · «en GP2 no lo están usando los operarios, así que podés hacer cambios sin miramientos»].
--
-- 1) reg_prod_3_0_bundle: 'empleados' sale de reg_prod_3_0.operario (clave = legajo verdadero, en minúscula) + operario_permiso.
--    Hora de entrada/salida: Planify (por el legajo verdadero) > Empleados (por el número) > GP2 (por el número), como antes.
--    Permisos: medido antes de cambiar, operario_permiso da EXACTAMENTE lo mismo que Empleados para los 19 operarios.
-- 2) reg_prod_3_0_registrar_evento: el nombre del operario sale de reg_prod_3_0.operario (antes "GP2".empleado por número).
-- 3) reg_prod_3_0_cerv_ingresar y reg_prod_3_0_registrar_ingreso: validan el legajo contra reg_prod_3_0.operario
--    (antes public."Empleados" con Activo = 'SI', sólo números: «c19» no pasaba).
-- Todo por cirugía sobre la definición viva: frena si el texto a reemplazar no aparece exactamente 1 vez.

do $$
declare
  d text; i int; j int; n int;
  viejo_emp_ini constant text := '''empleados'', (select coalesce(jsonb_object_agg(e.legajo, jsonb_build_object(';
  viejo_emp_fin constant text := 'limit 1) pu on true),';
  nuevo_emp constant text := $n$'empleados', (select coalesce(jsonb_object_agg(o.legajo, jsonb_build_object(
        -- fase 3f: los operarios salen de reg_prod_3_0.operario (liquidación de Planify, activo y de planta); clave = legajo verdadero
        'nombre', o.nombre, 'activo', true,
        'hora_entrada', coalesce(pe.hora_entrada, pu.hora_entrada, ge.hora_entrada),
        'hora_salida', coalesce(pe.hora_salida, pu.hora_salida),
        'hora_entrada_de', case when pe.hora_entrada is not null then 'planify'
                                when pu.hora_entrada is not null then 'empleados'
                                when ge.hora_entrada is not null then 'gp2' end,
        'es_matriceria', coalesce(op.es_matriceria, false), 'es_piedra', coalesce(op.es_piedra, false),
        'es_alimentador', coalesce(op.es_alimentador, false), 've_cm', coalesce(op.ve_cm, false),
        've_trm', coalesce(op.ve_trm, false), 've_tl', coalesce(op.ve_tl, false),
        've_rem', coalesce(op.ve_rem, false), 've_mm', coalesce(op.ve_mm, false))), '{}'::jsonb)
      from reg_prod_3_0.operario o
      left join reg_prod_3_0.operario_permiso op on op.legajo = o.legajo
      left join lateral (
        select pe.hora_entrada, pe.hora_salida from planify.employees pe
         where lower(btrim(pe.legajo)) = o.legajo and pe.activo and pe.hora_entrada is not null order by pe.id limit 1) pe on true
      left join lateral (
        select x.hora_entrada, x.hora_salida from public."Empleados" x
         where btrim(x."Legajo"::text) = regexp_replace(o.legajo, '^c', '')
         order by (x."Activo" = 'SI') desc nulls last, x.id limit 1) pu on true
      left join lateral (
        select g.hora_entrada from "GP2".empleado g where btrim(g.legajo) = regexp_replace(o.legajo, '^c', '') limit 1) ge on true),$n$;
begin
  -- 1) bundle
  select pg_get_functiondef(p.oid) into d from pg_proc p
   where p.pronamespace = 'reg_prod_3_0'::regnamespace and p.proname = 'reg_prod_3_0_bundle';
  if strpos(d, 'from reg_prod_3_0.operario o') > 0 then raise exception 'bundle ya usa reg_prod_3_0.operario (fase 3f aplicada)'; end if;
  n := (length(d) - length(replace(d, viejo_emp_ini, ''))) / length(viejo_emp_ini);
  if n <> 1 then raise exception 'bundle: inicio del bloque empleados aparece % veces', n; end if;
  i := strpos(d, viejo_emp_ini);
  j := strpos(substr(d, i), viejo_emp_fin);
  if j = 0 then raise exception 'bundle: no encuentro el fin del bloque empleados'; end if;
  if strpos(substr(d, i, j), '''balancines''') > 0 then raise exception 'bundle: el bloque empleados se pasa de largo'; end if;
  execute substr(d, 1, i - 1) || nuevo_emp || substr(d, i + j - 1 + length(viejo_emp_fin));

  -- 2) registrar_evento: el nombre
  select pg_get_functiondef(p.oid) into d from pg_proc p
   where p.pronamespace = 'reg_prod_3_0'::regnamespace and p.proname = 'reg_prod_3_0_registrar_evento';
  n := (length(d) - length(replace(d, 'select nombre into v_nombre from "GP2".empleado where legajo = v_leg;', '')))
       / length('select nombre into v_nombre from "GP2".empleado where legajo = v_leg;');
  if n <> 1 then raise exception 'registrar_evento: la lectura del nombre aparece % veces', n; end if;
  execute replace(d, 'select nombre into v_nombre from "GP2".empleado where legajo = v_leg;',
    'select o.nombre into v_nombre from reg_prod_3_0.operario o where o.legajo = lower(btrim(v_leg));   /* fase 3f */');

  -- 3a) cerv_ingresar: valida contra reg_prod_3_0.operario
  select pg_get_functiondef(p.oid) into d from pg_proc p
   where p.pronamespace = 'reg_prod_3_0'::regnamespace and p.proname = 'reg_prod_3_0_cerv_ingresar';
  n := (length(d) - length(replace(d, 'if v_leg ~ ', ''))) / length('if v_leg ~ ');
  if n <> 1 then raise exception 'cerv_ingresar: «if v_leg ~» aparece % veces', n; end if;
  i := strpos(d, 'if v_leg ~ ');
  j := strpos(substr(d, i), 'end if;');
  if strpos(substr(d, i, j), 'public."Empleados"') = 0 then raise exception 'cerv_ingresar: el bloque no es el de Empleados'; end if;
  execute substr(d, 1, i - 1)
       || 'select o.nombre into v_nombre from reg_prod_3_0.operario o where o.legajo = lower(v_leg) limit 1;   /* fase 3f */'
       || substr(d, i + j - 1 + length('end if;'));

  -- 3b) registrar_ingreso: valida contra reg_prod_3_0.operario
  select pg_get_functiondef(p.oid) into d from pg_proc p
   where p.pronamespace = 'reg_prod_3_0'::regnamespace and p.proname = 'reg_prod_3_0_registrar_ingreso';
  n := (length(d) - length(replace(d, 'select 1 from public."Empleados" e', ''))) / length('select 1 from public."Empleados" e');
  if n <> 1 then raise exception 'registrar_ingreso: el chequeo de Empleados aparece % veces', n; end if;
  i := strpos(d, 'select 1 from public."Empleados" e');
  j := strpos(substr(d, i), '''SI'')');
  if j = 0 or j > 200 then raise exception 'registrar_ingreso: no encuentro el fin del chequeo'; end if;
  execute substr(d, 1, i - 1)
       || 'select 1 from reg_prod_3_0.operario o where o.legajo = lower(v_leg))   /* fase 3f */'
       || substr(d, i + j - 1 + length('''SI'')'));
end $$;
