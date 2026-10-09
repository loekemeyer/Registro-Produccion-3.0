-- ESTADO: APLICADO el 09/10/2026 (MCP execute_sql), con el «sí» de Elías («Activa 3»). Verificado: Virgilio con el código bueno trae 18
-- operarios y con uno malo {ok:false}; operarios_lista y problemas_matrices_bundle rechazan a anon y a una cuenta no habilitada (42501);
-- reg_prod_3_0.operario sigue sin SELECT para anon. OJO: problemas_matrices_bundle era LANGUAGE sql (sin begin): se aplicó como plpgsql
-- con «perform _exigir_autorizado(); return (<la misma consulta>);» (el paso 3 de abajo, tal cual, no corre sobre una función sql).
-- Registro Producción 3.0 — FASE 3g · una sola lista de operarios para Cervantes 3.0, Virgilio 3.0 y el admin de GP2
-- [Elías, 09/10: «GP2 y 3.0 Cervantes tienen que tomar del mismo lugar» · «y el de Virgilio también» ·
--  «no es anon, tiene que ser al enviar con el token que se obtiene de la pantalla»].
--
-- El lugar es reg_prod_3_0.operario (legajo verdadero + nombre, alimentada por Planify, fase 3e). La tabla NO se abre:
-- sigue sin GRANT a anon ni a authenticated. Cada app la lee con una función que exige SU token:
--   Cervantes 3.0 → el PASE (reg_prod_3_0_bundle, ya lo hace desde la fase 3f).
--   Virgilio 3.0  → el CÓDIGO DE LA TV (reg_prod_3_0_virgilio_operarios, nueva; mismo control que gv_tv_clave_validar).
--   Admin de GP2  → el login de Gmail con la whitelist ("GP2".operarios_lista, nueva; "GP2"._exigir_autorizado).
-- problemas_matrices_bundle (GP2) también lista operarios: pasa a la tabla nueva y exige el login (hoy la puede llamar anon).

-- 1) Virgilio 3.0: el código de la TV devuelve los operarios de la tabla nueva.
--    'legajo' = el número sin la letra (lo que Virgilio graba hoy en Registros_Produccion_Virgilio; Gestión Virgilio lo
--    lee así). 'legajo_verdadero' viaja también: el día que Virgilio pase a grabar c104, cambia sólo la app.
create or replace function reg_prod_3_0.reg_prod_3_0_virgilio_operarios(p_clave text)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_t bigint := floor(extract(epoch from now()) / 60)::bigint;
  v_c text := regexp_replace(coalesce(p_clave, ''), '\D', '', 'g');
begin
  if v_c = '' or (v_c <> public.gv_tv_clave_de(v_t) and v_c <> public.gv_tv_clave_de(v_t - 1)) then
    return jsonb_build_object('ok', false);
  end if;
  return jsonb_build_object('ok', true, 'operarios', coalesce((
    select jsonb_agg(jsonb_build_object('legajo', regexp_replace(o.legajo, '^c', ''), 'legajo_verdadero', o.legajo,
                                        'nombre', o.nombre) order by o.nombre)
      from reg_prod_3_0.operario o
     where o.legajo <> '0'), '[]'::jsonb));
end $function$;
revoke all on function reg_prod_3_0.reg_prod_3_0_virgilio_operarios(text) from public;
grant execute on function reg_prod_3_0.reg_prod_3_0_virgilio_operarios(text) to anon, authenticated;

-- 2) Admin de GP2: la lista, sólo con una cuenta habilitada (sin login → error 42501, como las RPC de oficina).
create or replace function "GP2".operarios_lista()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  perform "GP2"._exigir_autorizado();
  return coalesce((select jsonb_agg(jsonb_build_object('legajo', o.legajo, 'nombre', o.nombre) order by o.nombre)
                     from reg_prod_3_0.operario o
                    where o.legajo <> '0'), '[]'::jsonb);
end $function$;
revoke all on function "GP2".operarios_lista() from public, anon;
grant execute on function "GP2".operarios_lista() to authenticated;

-- 3) problemas_matrices_bundle: exige el login y lista los operarios de la tabla nueva (cirugía, frena si no calza).
--    El nombre de cada evento sigue saliendo de lo grabado (nombre_empleado); si falta, de la tabla nueva por legajo
--    verdadero o por número (c19 = 19), y recién después de "GP2".empleado (los históricos de la Carga Manual).
do $$
declare d text; n int;
  v1 constant text := 'left join empleado e on e.legajo = a.legajo';
  n1 constant text := 'left join empleado e on e.legajo = a.legajo
    left join reg_prod_3_0.operario o3 on o3.legajo = lower(btrim(a.legajo))
                                       or o3.legajo = ''c'' || lower(btrim(a.legajo))   /* fase 3g */';
  v2 constant text := 'coalesce(a.nombre_empleado, e.nombre)';
  n2 constant text := 'coalesce(a.nombre_empleado, o3.nombre, e.nombre)';
  v3 constant text := 'from empleado where activo)';
  n3 constant text := 'from reg_prod_3_0.operario where legajo <> ''0'')   /* fase 3g */';
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p
   where p.pronamespace = '"GP2"'::regnamespace and p.proname = 'problemas_matrices_bundle';
  if strpos(d, 'reg_prod_3_0.operario') > 0 then raise exception 'problemas_matrices_bundle ya usa la tabla nueva (fase 3g aplicada)'; end if;
  foreach n in array array[
      (length(d) - length(replace(d, v1, ''))) / length(v1),
      (length(d) - length(replace(d, v2, ''))) / length(v2),
      (length(d) - length(replace(d, v3, ''))) / length(v3)] loop
    if n <> 1 then raise exception 'problemas_matrices_bundle: un texto a reemplazar aparece % veces', n; end if;
  end loop;
  d := replace(replace(replace(d, v1, n1), v2, n2), v3, n3);
  -- el login, al principio del cuerpo
  if strpos(d, E'begin\n') = 0 then raise exception 'problemas_matrices_bundle: no encuentro el begin'; end if;
  d := regexp_replace(d, E'\nbegin\n', E'\nbegin\n  perform "GP2"._exigir_autorizado();   /* fase 3g */\n');
  execute d;
end $$;
revoke execute on function "GP2".problemas_matrices_bundle(date, date) from anon;
