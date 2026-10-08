-- ESTADO: APLICADO el 08/10/2026 (MCP execute_sql). Verificado en transacción deshecha (ver el final).
-- Registro Producción 3.0 — FASE 2c (08/10/2026) · FIN DE JORNADA, CONTADOR DE CAJÓN Y ERRORES DE ENVÍO COMO REGISTRO PRODUCCIÓN 2.0
-- [Elías, 08/10: «18 como en 2.0» · «el contador de cajón debería [estar] y podés usar lo que tiene GP2 de máximo de unidades por cajón»
--  · «15 tiene que estar» · decisiones «1 sí»].
--
-- 1) CONTADOR DE CAJÓN (el «Faltan X unidades para completar el cajón» de 2.0, public.registrar_unidades): suma las unidades de cada
--    cajón de la PIEZA (no de la matriz: una matriz puede sacar varias) y, cuando llega a lo que entra en el cajón —o el operario marca
--    «cajón completo»—, vuelve a 0; el excedente se descarta y queda en la auditoría (cajon_excedente / cajon_completar). Lo que entra en
--    el cajón es el de GP2: GP2.componente.uni_x_cajon de la pieza. Fuera: envasado (sector 12) y matrices en kilos (la 501), como 2.0.
--    Lo hace reg_prod_3_0_registrar_evento al grabar el C (una sola vez: un reintento del mismo toque no suma). Como 2.0, anular un
--    cajón NO devuelve el contador.
--    · tabla reg_prod_3_0.contador_cajon (comp_id → uni_actual), sin acceso desde la API
--    · el catálogo trae `cajon` { n_matriz: { comp_id: {uxc, act, codigo} } } y reg_prod_3_0_contador_cajon(pase, equipo, matriz) lo trae
--      fresco (es compartido entre operarios: 2.0 también lo relee al elegir la matriz o el C).
-- 2) FIN DE JORNADA como 2.0: un id fijo por legajo y día (fj_<legajo>_<día>); uno nuevo PISA al anterior (texto con el respaldo del
--    día, hora) en vez de sumar otra fila.
-- 3) reg_prod_3_0_registrar_error_envio(app, equipo, legajo, detalle): los errores de envío del celular quedan en reg_prod_3_0.auditoria
--    (tipo error_envio), como el ERROR_ENVIO de Auditoria_Produccion de 2.0. Sin pase a propósito (fallan justo cuando el pase o la base
--    fallan); tope de 60 por equipo y hora.
-- 4) El catálogo trae la HORA DE SALIDA de cada uno (Planify > Empleados), para «Continuar Matriz» (el tiempo de ayer se cuenta hasta la
--    salida, como 2.0).

-- 1) contador -----------------------------------------------------------------------------------------------------------------------
create table if not exists reg_prod_3_0.contador_cajon (
  comp_id    bigint primary key,                -- la pieza (GP2.componente)
  uni_actual numeric not null default 0,        -- lo que hay en el cajón abierto
  updated_at timestamptz not null default now(),
  legajo     text                               -- el último que sumó
);
alter table reg_prod_3_0.contador_cajon enable row level security;
revoke all on reg_prod_3_0.contador_cajon from anon, authenticated;

create or replace function reg_prod_3_0.reg_prod_3_0_contador_de(p_n_matriz text)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(jsonb_object_agg(q.comp_id::text, jsonb_build_object('uxc', q.uxc, 'act', coalesce(k.uni_actual, 0), 'codigo', q.codigo)), '{}'::jsonb)
    from (select distinct c.id comp_id, c.codigo, c.uni_x_cajon uxc
            from "GP2".matriz m
            join "GP2".ruta_paso rp on rp.matriz_id = m.id and rp.tipo_paso = 'matriz' and rp.comp_salida_id is not null
            join "GP2".componente c on c.id = rp.comp_salida_id
           where btrim(m.n_matriz) = btrim(p_n_matriz) and c.uni_x_cajon > 0 and coalesce(c.sector_id, 0) <> 12
             and lower(coalesce(m.tiempo_unidad, '')) <> 'kg') q
    left join reg_prod_3_0.contador_cajon k on k.comp_id = q.comp_id
$function$;
revoke all on function reg_prod_3_0.reg_prod_3_0_contador_de(text) from public, anon, authenticated;

create or replace function reg_prod_3_0.reg_prod_3_0_contador_cajon(p_pase text, p_dispositivo text, p_n_matriz text)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if not reg_prod_3_0.reg_prod_3_0_pase_ok(p_pase, p_dispositivo) then
    raise exception 'Pase inválido o vencido' using errcode = '28000';
  end if;
  return reg_prod_3_0.reg_prod_3_0_contador_de(p_n_matriz);
end $function$;
revoke all on function reg_prod_3_0.reg_prod_3_0_contador_cajon(text, text, text) from public;
grant execute on function reg_prod_3_0.reg_prod_3_0_contador_cajon(text, text, text) to anon, authenticated;

-- 3) errores de envío ------------------------------------------------------------------------------------------------------------------
create or replace function reg_prod_3_0.reg_prod_3_0_registrar_error_envio(p_app text, p_dispositivo text, p_legajo text, p_detalle jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_n int;
begin
  select count(*) into v_n from reg_prod_3_0.auditoria
   where tipo = 'error_envio' and dispositivo = left(coalesce(p_dispositivo, ''), 80) and at > now() - interval '1 hour';
  if v_n >= 60 then
    return jsonb_build_object('ok', false, 'tope', true);
  end if;
  insert into reg_prod_3_0.auditoria (tipo, app, legajo, dispositivo, ip, ok, detalle)
  values ('error_envio', left(coalesce(p_app, ''), 20), left(p_legajo, 20), left(coalesce(p_dispositivo, ''), 80),
          reg_prod_3_0.reg_prod_3_0_ip(), false,
          case when length(coalesce(p_detalle, '{}'::jsonb)::text) > 4000
               then jsonb_build_object('recortado', left(p_detalle::text, 4000)) else p_detalle end);
  return jsonb_build_object('ok', true);
end $function$;
revoke all on function reg_prod_3_0.reg_prod_3_0_registrar_error_envio(text, text, text, jsonb) from public;
grant execute on function reg_prod_3_0.reg_prod_3_0_registrar_error_envio(text, text, text, jsonb) to anon, authenticated;

-- 1, 2 y 4: registrar_evento y el catálogo (cirugía sobre la definición viva; frena si no encuentra el punto exacto) ------------------
do $$
declare
  d text; n int;
  a_dec text := $v$  v_uni_stock numeric;   -- fase 2b: matriz en kilos → unidades de la pieza para el stock
begin$v$;
  b_dec text := $v$  v_uni_stock numeric;   -- fase 2b: matriz en kilos → unidades de la pieza para el stock
  v_cajon  jsonb;          -- fase 2c: contador de cajón
  v_uxc    numeric;
  v_antes  numeric;
  v_total  numeric;
  v_nuevo  numeric;
  v_exc    numeric;
  v_compl  boolean;
  v_forz   boolean;
begin$v$;
  a_fj text := $v$  -- cruda
  insert into reg_prod_3_0.crudo_cervantes$v$;
  b_fj text := $v$  -- fase 2c: FIN DE JORNADA como 2.0: id fijo por legajo y día (fj_<legajo>_<día>); uno nuevo PISA al anterior (el respaldo
  -- del día y la hora) en vez de sumar otra fila.
  if coalesce(nullif(t->>'opcion', ''), v_mat) = 'FJ' and exists (select 1 from reg_prod_3_0.crudo_cervantes where id = v_id) then
    update reg_prod_3_0.crudo_cervantes
       set texto = t->>'texto', ts_event = v_f, extra = p - 'toque', app_version = left(t->>'app_version', 40),
           dispositivo = left(p_dispositivo, 80), anulado = false, anulado_at = null
     where id = v_id;
    update reg_prod_3_0.procesado_cervantes
       set fecha = v_f, fecha_fin = v_f, hora_fin = nullif(p->>'hora_fin', '')::time, eliminar = null,
           dia = extract(day from v_f_ar)::int, mes = extract(month from v_f_ar)::int,
           quincena = case when extract(day from v_f_ar)::int <= 15 then 1 else 2 end
     where id_ejecucion = v_id
    returning id into v_pid;
    if v_pid is not null then
      return jsonb_build_object('ok', true, 'id', v_pid, 'fj_pisado', true);
    end if;
  end if;

  -- cruda
  insert into reg_prod_3_0.crudo_cervantes$v$;
  a_caj text := $v$  -- fuera de horario (por la hora del toque, no la de hoy): una fila por legajo y día$v$;
  b_caj text := $v$  -- fase 2c: CONTADOR DE CAJÓN como 2.0 (public.registrar_unidades), con lo que entra en el cajón según GP2 (uni_x_cajon de la
  -- pieza). Suma; si llega o el operario marcó «cajón completo», vuelve a 0 (el excedente se descarta y queda en la auditoría).
  if coalesce(nullif(t->>'opcion', ''), v_mat) in ('C', 'CT') and v_uni > 0 and v_salida is not null
     and lower(coalesce((select x.tiempo_unidad from "GP2".matriz x where x.id = v_mid), '')) <> 'kg' then
    select c.uni_x_cajon into v_uxc from "GP2".componente c
     where c.id = v_salida and c.uni_x_cajon > 0 and coalesce(c.sector_id, 0) <> 12;
    if v_uxc is not null then
      insert into reg_prod_3_0.contador_cajon (comp_id, uni_actual) values (v_salida, 0) on conflict (comp_id) do nothing;
      select k.uni_actual into v_antes from reg_prod_3_0.contador_cajon k where k.comp_id = v_salida for update;
      v_forz  := coalesce(p->>'cajon_completo', 'false') = 'true';
      v_total := v_antes + v_uni;
      v_compl := v_forz or v_total >= v_uxc;
      v_exc   := case when v_total > v_uxc then v_total - v_uxc else 0 end;
      v_nuevo := case when v_compl then 0 else v_total end;
      update reg_prod_3_0.contador_cajon set uni_actual = v_nuevo, updated_at = now(), legajo = v_leg where comp_id = v_salida;
      v_cajon := jsonb_build_object('comp_id', v_salida, 'uxc', v_uxc, 'antes', v_antes, 'act', v_nuevo,
                                    'completo', v_compl, 'excedente', v_exc, 'forzado', v_forz);
      if v_exc > 0 or v_forz then
        insert into reg_prod_3_0.auditoria (tipo, app, legajo, dispositivo, ip, ok, detalle)
        values (case when v_forz then 'cajon_completar' else 'cajon_excedente' end, 'cervantes', v_leg, left(p_dispositivo, 80),
                reg_prod_3_0.reg_prod_3_0_ip(), true, v_cajon || jsonb_build_object('id_ejecucion', v_id, 'matriz', v_mat));
      end if;
    end if;
  end if;

  -- fuera de horario (por la hora del toque, no la de hoy): una fila por legajo y día$v$;
  a_ret text := $v$'uni_x_golpe', v_uxg);$v$;
  b_ret text := $v$'uni_x_golpe', v_uxg, 'cajon', v_cajon);$v$;
  -- catálogo
  a_sal text := $v$           pu.hora_entrada, e.hora_entrada),
$v$;
  b_sal text := $v$           pu.hora_entrada, e.hora_entrada),
        -- fase 2c: la hora de salida (Planify > Empleados), para «Continuar Matriz»
        'hora_salida', coalesce(
           (select pe.hora_salida from planify.employees pe
             where btrim(pe.legajo) = btrim(e.legajo) and pe.activo and pe.hora_entrada is not null order by pe.id limit 1),
           pu.hora_salida),
$v$;
  a_lat text := $v$        select x.hora_entrada, x.es_matriceria,$v$;
  b_lat text := $v$        select x.hora_entrada, x.hora_salida, x.es_matriceria,$v$;
  a_bal text := $v$      from public."Balancines" b where coalesce(b."Activo", true)),$v$;
  b_bal text := $v$      from public."Balancines" b where coalesce(b."Activo", true)),
    -- fase 2c: el contador de cajón por matriz y pieza (lo que entra según GP2 y lo que ya hay)
    'cajon', (select coalesce(jsonb_object_agg(t.n_matriz, t.piezas), '{}'::jsonb)
      from (select q.n_matriz,
                   jsonb_object_agg(q.comp_id::text, jsonb_build_object('uxc', q.uxc, 'act', coalesce(k.uni_actual, 0), 'codigo', q.codigo)) piezas
              from (select distinct btrim(m.n_matriz) n_matriz, c.id comp_id, c.codigo, c.uni_x_cajon uxc
                      from "GP2".matriz m
                      join "GP2".ruta_paso rp on rp.matriz_id = m.id and rp.tipo_paso = 'matriz' and rp.comp_salida_id is not null
                      join "GP2".componente c on c.id = rp.comp_salida_id
                     where m.activa and c.uni_x_cajon > 0 and coalesce(c.sector_id, 0) <> 12
                       and lower(coalesce(m.tiempo_unidad, '')) <> 'kg') q
              left join reg_prod_3_0.contador_cajon k on k.comp_id = q.comp_id
             group by q.n_matriz) t),$v$;
  procedure_cuenta text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p
   where p.pronamespace = 'reg_prod_3_0'::regnamespace and p.proname = 'reg_prod_3_0_registrar_evento';
  if strpos(d, 'v_cajon') > 0 then raise exception 'registrar_evento ya tiene la fase 2c'; end if;
  foreach procedure_cuenta in array array[a_dec, a_fj, a_caj, a_ret] loop
    n := (length(d) - length(replace(d, procedure_cuenta, ''))) / length(procedure_cuenta);
    if n <> 1 then raise exception 'registrar_evento: % aparece % veces', left(procedure_cuenta, 40), n; end if;
  end loop;
  execute replace(replace(replace(replace(d, a_dec, b_dec), a_fj, b_fj), a_caj, b_caj), a_ret, b_ret);

  select pg_get_functiondef(p.oid) into d from pg_proc p
   where p.pronamespace = 'reg_prod_3_0'::regnamespace and p.proname = 'reg_prod_3_0_bundle';
  if strpos(d, $v$'cajon'$v$) > 0 then raise exception 'el bundle ya tiene la fase 2c'; end if;
  foreach procedure_cuenta in array array[a_sal, a_lat, a_bal] loop
    n := (length(d) - length(replace(d, procedure_cuenta, ''))) / length(procedure_cuenta);
    if n <> 1 then raise exception 'bundle: % aparece % veces', left(procedure_cuenta, 40), n; end if;
  end loop;
  execute replace(replace(replace(d, a_sal, b_sal), a_lat, b_lat), a_bal, b_bal);
end $$;

-- VERIFICACIÓN (08/10/2026, transacciones deshechas con raise exception):
--   catálogo: 73 matrices con contador de cajón (uni_x_cajon de la pieza, sin 501 ni envasado) y hora_salida por empleado.
--   contador: tras el 1.er C quedó en 380; el MISMO toque otra vez no sumó (dup); tras el 2.º C, 385; un C con cajon_completo lo dejó en 0
--     con su fila cajon_completar en la auditoría. (El caso cajon_excedente no se probó aparte.)
--   FJ: el 2.º con el mismo id fj_<legajo>_<día> pisa al 1.º (1 sola fila en la cruda y en la procesada, texto nuevo) y devuelve fj_pisado.
--   reg_prod_3_0_registrar_error_envio('cervantes', equipo, legajo, detalle) → fila error_envio en la auditoría, sin pase.
--   App v3.1.10: tests/cervantes-gp2.cjs §11 (contador, Terminar Día, Continuar, errores, reintento cada 3 s, cola del service worker).
