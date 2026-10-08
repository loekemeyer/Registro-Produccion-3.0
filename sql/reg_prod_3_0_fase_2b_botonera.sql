-- ESTADO: APLICADO el 08/10/2026 (MCP execute_sql).
-- Registro Producción 3.0 — FASE 2b (08/10/2026) · LA BOTONERA DE CERVANTES COMO REGISTRO PRODUCCIÓN 2.0 (lo que necesita de la base)
-- [Elías, 08/10: «12: 2.0, pensé que ya se había integrado completo, y no sólo para Eduardo» · «10: todo lo del 10 debería ser como
--  Reg Prod» · «17: tiene que ser la llegada tarde del operario de verdad … en planify están los horarios de todos»].
--
-- 1) El catálogo (reg_prod_3_0_bundle) trae, por legajo:
--    · los PERMISOS de public."Empleados" (los mismos que usa capsDe()/botonVisible() de 2.0): es_matriceria, es_piedra,
--      es_alimentador, ve_cm, ve_trm, ve_tl, ve_rem, ve_mm. Si hay más de una fila con el legajo, gana la activa.
--    · la HORA DE ENTRADA de verdad: la de Planify (planify.employees, activo, con hora); si Planify no la tiene, la de
--      public."Empleados"; si tampoco, la de GP2.empleado. La app cae a 08:30 sólo si no viene ninguna.
--    y por matriz el `tipo` de GP2.matriz ('A' = alimentador: al cerrar un cajón pregunta «Continuar / Cambiar Matriz», como 2.0),
--    y la lista de BALANCINES activos (public."Balancines") para el «Cambiar Matriz».
-- 2) reg_prod_3_0_asignar_matriz_balancin(pase, equipo, balancín, matriz): la misma public.asignar_matriz_balancin que llama 2.0, pero
--    con el pase del código de la TV (3.0 no escribe nada sin pase).

-- 1) catálogo ------------------------------------------------------------------------------------------------------------------------
do $$
declare
  d text;
  viejo_emp text := $v$'empleados', (select coalesce(jsonb_object_agg(e.legajo, jsonb_build_object(
        'nombre', e.nombre, 'activo', e.activo, 'hora_entrada', e.hora_entrada)), '{}'::jsonb)
      from "GP2".empleado e),$v$;
  nuevo_emp text := $v$'empleados', (select coalesce(jsonb_object_agg(e.legajo, jsonb_build_object(
        'nombre', e.nombre, 'activo', e.activo,
        -- fase 2b: la hora de entrada de verdad (Planify > Empleados > GP2) y los permisos de public."Empleados" (como 2.0)
        'hora_entrada', coalesce(
           (select pe.hora_entrada from planify.employees pe
             where btrim(pe.legajo) = btrim(e.legajo) and pe.activo and pe.hora_entrada is not null order by pe.id limit 1),
           pu.hora_entrada, e.hora_entrada),
        'hora_entrada_de', case
           when exists (select 1 from planify.employees pe
                         where btrim(pe.legajo) = btrim(e.legajo) and pe.activo and pe.hora_entrada is not null) then 'planify'
           when pu.hora_entrada is not null then 'empleados'
           when e.hora_entrada is not null then 'gp2' end,
        'es_matriceria', coalesce(pu.es_matriceria, false), 'es_piedra', coalesce(pu.es_piedra, false),
        'es_alimentador', coalesce(pu.es_alimentador, false), 've_cm', coalesce(pu.ve_cm, false),
        've_trm', coalesce(pu.ve_trm, false), 've_tl', coalesce(pu.ve_tl, false),
        've_rem', coalesce(pu.ve_rem, false), 've_mm', coalesce(pu.ve_mm, false))), '{}'::jsonb)
      from "GP2".empleado e
      left join lateral (
        select x.hora_entrada, x.es_matriceria, x.es_piedra, x.es_alimentador, x.ve_cm, x.ve_trm, x.ve_tl, x.ve_rem, x.ve_mm
          from public."Empleados" x
         where btrim(x."Legajo"::text) = btrim(e.legajo)
         order by (x."Activo" = 'SI') desc nulls last, x.id
         limit 1) pu on true),
    'balancines', (select coalesce(jsonb_agg(jsonb_build_object('num', b."Num", 'tipo', b."Tipo", 'matriz', b."Matriz")
                     order by case when b."Num" ~ '^[0-9]+$' then lpad(b."Num", 6, '0') else b."Num" end), '[]'::jsonb)
      from public."Balancines" b where coalesce(b."Activo", true)),$v$;
  viejo_mat text := $v$'uxg', m.uni_x_golpe, 'maq', m.maquina, 'act', m.activa) order by m.n_matriz), '[]'::jsonb)$v$;
  nuevo_mat text := $v$'uxg', m.uni_x_golpe, 'maq', m.maquina, 'act', m.activa, 'tipo', m.tipo) order by m.n_matriz), '[]'::jsonb)$v$;
  n int;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p
   where p.pronamespace = 'reg_prod_3_0'::regnamespace and p.proname = 'reg_prod_3_0_bundle';
  if strpos(d, '''balancines''') > 0 then raise exception 'el bundle ya tiene balancines (fase 2b aplicada)'; end if;
  n := (length(d) - length(replace(d, viejo_emp, ''))) / length(viejo_emp);
  if n <> 1 then raise exception 'bundle: el bloque de empleados aparece % veces', n; end if;
  n := (length(d) - length(replace(d, viejo_mat, ''))) / length(viejo_mat);
  if n <> 1 then raise exception 'bundle: el bloque de matrices aparece % veces', n; end if;
  execute replace(replace(d, viejo_emp, nuevo_emp), viejo_mat, nuevo_mat);
end $$;

-- 2) balancín con pase ----------------------------------------------------------------------------------------------------------------
create or replace function reg_prod_3_0.reg_prod_3_0_asignar_matriz_balancin(p_pase text, p_dispositivo text, p_balancin text, p_matriz text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if not reg_prod_3_0.reg_prod_3_0_pase_ok(p_pase, p_dispositivo) then
    raise exception 'Pase inválido o vencido' using errcode = '28000';
  end if;
  if nullif(btrim(coalesce(p_balancin, '')), '') is null or nullif(btrim(coalesce(p_matriz, '')), '') is null then
    raise exception 'Falta el balancín o la matriz' using errcode = '22023';
  end if;
  perform public.asignar_matriz_balancin(btrim(p_balancin), btrim(p_matriz));   -- la de 2.0: libera la matriz de otro balancín y la pone en éste
  return jsonb_build_object('ok', true, 'balancin', btrim(p_balancin), 'matriz', btrim(p_matriz));
end $function$;

revoke all on function reg_prod_3_0.reg_prod_3_0_asignar_matriz_balancin(text, text, text, text) from public;
grant execute on function reg_prod_3_0.reg_prod_3_0_asignar_matriz_balancin(text, text, text, text) to anon, authenticated;

-- 3) (mismo día) MATRIZ QUE SE CARGA EN KILOS (GP2.matriz.tiempo_unidad = 'kg'; hoy sólo la 501, «Afilado Cuchilla») -------------------
--    [Elías, 08/10: «en la matriz 501 no ponen las uni sino los kilos que hacen, por eso acepta coma y punto»]. El operario carga KILOS
--    (2.0 los guarda con coma: «5,6»); el premio sale en kilos (tiempo_historico 7.650 s por kg), pero la pieza que sale (Z23) se cuenta en
--    UNIDADES: el stock de GP2 recibe kilos / kg_x_uni (0,0043 kg por cuchilla → 5,6 kg = 1.302 unidades). Sin kg_x_uni, mueve los kilos
--    como antes. El catálogo trae `th` (tiempo histórico, para el aviso «Matriz sin tiempo» de 2.0) y `tu` (unidad del tiempo).
do $$
declare
  d text; n int;
  viejo_mat text := $v$'act', m.activa, 'tipo', m.tipo) order by m.n_matriz), '[]'::jsonb)$v$;
  nuevo_mat text := $v$'act', m.activa, 'tipo', m.tipo, 'th', m.tiempo_historico, 'tu', m.tiempo_unidad) order by m.n_matriz), '[]'::jsonb)$v$;
  viejo_dec text := $v$  v_res    jsonb;
begin$v$;
  nuevo_dec text := $v$  v_res    jsonb;
  v_uni_stock numeric;   -- fase 2b: matriz en kilos → unidades de la pieza para el stock
begin$v$;
  viejo_fab text := $v$      v_res := reg_prod_3_0.reg_prod_3_0_gp2_fabricar_stock(v_mid, v_salida, v_uni, v_f);$v$;
  nuevo_fab text := $v$      -- fase 2b: matriz que se carga en KILOS (tiempo_unidad 'kg', la 501): la pieza se cuenta en unidades = kilos / kg_x_uni
      if (select lower(coalesce(x.tiempo_unidad, '')) from "GP2".matriz x where x.id = v_mid) = 'kg' then
        select case when lower(coalesce(c.unidad_medida, '')) <> 'kg' and c.kg_x_uni > 0 then round(v_uni / c.kg_x_uni) end
          into v_uni_stock from "GP2".componente c where c.id = v_salida;
      end if;
      v_res := reg_prod_3_0.reg_prod_3_0_gp2_fabricar_stock(v_mid, v_salida, coalesce(v_uni_stock, v_uni), v_f);$v$;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p
   where p.pronamespace = 'reg_prod_3_0'::regnamespace and p.proname = 'reg_prod_3_0_bundle';
  if strpos(d, $v$'th', m.tiempo_historico$v$) > 0 then raise exception 'el bundle ya trae th'; end if;
  n := (length(d) - length(replace(d, viejo_mat, ''))) / length(viejo_mat);
  if n <> 1 then raise exception 'bundle: matrices aparece % veces', n; end if;
  execute replace(d, viejo_mat, nuevo_mat);

  select pg_get_functiondef(p.oid) into d from pg_proc p
   where p.pronamespace = 'reg_prod_3_0'::regnamespace and p.proname = 'reg_prod_3_0_registrar_evento';
  if strpos(d, 'v_uni_stock') > 0 then raise exception 'registrar_evento ya convierte kilos'; end if;
  n := (length(d) - length(replace(d, viejo_dec, ''))) / length(viejo_dec);
  if n <> 1 then raise exception 'registrar_evento: declare aparece % veces', n; end if;
  n := (length(d) - length(replace(d, viejo_fab, ''))) / length(viejo_fab);
  if n <> 1 then raise exception 'registrar_evento: fabricar_stock aparece % veces', n; end if;
  execute replace(replace(d, viejo_dec, nuevo_dec), viejo_fab, nuevo_fab);
end $$;

-- VERIFICACIÓN (08/10/2026, transacciones deshechas con raise exception):
--   catálogo: 19 → es_alimentador + ve_cm; 91 → matricería con ve_trm/ve_tl/ve_rem; 245 hora 08:00 (planify); 237 08:30 (planify);
--   por fuente de la hora: planify 14, empleados 21, ninguna 30 (la app usa 08:30); 28 balancines activos; la 71 trae tipo 'A'.
--   asignar_matriz_balancin(pase, '1', '71') → el balancín 1 quedó con la 71 (deshecho).
--   501: C de 5,6 kg en 12 h → premio −0,08 (en kilos, 7.650 s/kg) y el stock: fabricación Y1 1.302 → Z23 1.302 (5,6 / 0,0043).
