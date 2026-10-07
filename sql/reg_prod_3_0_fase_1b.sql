-- ESTADO: NO APLICADO en la base (07/10/2026). Espera el "sí" de Elías; al aplicarlo se cambia esta línea por "APLICADO" y la fecha.
-- Registro Producción 3.0 — FASE 1b (07/10/2026, Elías: «1b … con las tablas de crudo y procesado»).
-- Las funciones que usa el operario: traer el catálogo, registrar un toque (cruda + procesada en la misma transacción) y anularlo.
-- TODAS exigen el pase firmado de la Fase 1a y van atadas al equipo. Quedan en el schema reg_prod_3_0.
-- Lo que NO está acá (Fase 1c): mover el stock de GP2 (GP2.fabricar_stock) y los rollos (tomar_rollo / cerrar_rollo). Esas funciones de
-- GP2 exigen una cuenta de Google habilitada (GP2._exigir_autorizado) y desde acá no se pueden llamar: hace falta un cambio en GP2.

-- 0) la regla de horario sirve ahora para un momento cualquiera (los toques que vuelven de la cola traen su hora original)
create or replace function reg_prod_3_0.reg_prod_3_0_fuera_de_horario(p_app text, p_cuando timestamptz)
returns jsonb language plpgsql stable security definer set search_path = ''
as $f$
declare
  v_ahora  timestamp := p_cuando at time zone 'America/Argentina/Buenos_Aires';
  v_hora   time := (p_cuando at time zone 'America/Argentina/Buenos_Aires')::time;
  v_inicio time;
  v_fin    time;
  v_antic  int;
  v_desde  time;
begin
  select valor::time into v_inicio from reg_prod_3_0.config where clave = 'jornada_inicio_' || lower(coalesce(p_app, ''));
  if v_inicio is null then return null; end if;
  select valor::time into v_fin   from reg_prod_3_0.config where clave = 'pase_fin';
  select valor::int  into v_antic from reg_prod_3_0.config where clave = 'anticipo_max_min';
  v_fin   := coalesce(v_fin, time '17:45');
  v_antic := coalesce(v_antic, 30);
  v_desde := v_inicio - make_interval(mins => v_antic);
  if v_hora < v_desde or v_hora > v_fin then
    return jsonb_build_object('dia', to_char(v_ahora, 'YYYY-MM-DD'), 'hora', to_char(v_hora, 'HH24:MI'),
                              'desde', to_char(v_desde, 'HH24:MI'), 'hasta', to_char(v_fin, 'HH24:MI'),
                              'motivo', case when v_hora < v_desde then 'antes_de_la_jornada' else 'despues_del_horario' end);
  end if;
  return null;
end $f$;

create or replace function reg_prod_3_0.reg_prod_3_0_fuera_de_horario(p_app text)
returns jsonb language sql stable security definer set search_path = ''
as $f$
  select reg_prod_3_0.reg_prod_3_0_fuera_de_horario(p_app, now());
$f$;

revoke execute on function reg_prod_3_0.reg_prod_3_0_fuera_de_horario(text, timestamptz) from public, anon, authenticated;

-- 1) catálogo del operario (empleados, matrices, envasado…): el mismo que registro_operarios_bundle de GP2, con el pase.
--    Los rollos (fleje, saldo, abiertos) van vacíos hasta la Fase 1c.
create or replace function reg_prod_3_0.reg_prod_3_0_bundle(p_pase text, p_dispositivo text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $f$
begin
  if not reg_prod_3_0.reg_prod_3_0_pase_ok(p_pase, p_dispositivo) then
    raise exception 'Pase inválido o vencido' using errcode = '28000';
  end if;
  return jsonb_build_object(
    'registro_en_golpes', (select coalesce((select valor from "GP2".parametro where clave = 'registro_en_golpes'), '1') = '1'),
    'empleados', (select coalesce(jsonb_object_agg(e.legajo, jsonb_build_object(
        'nombre', e.nombre, 'activo', e.activo, 'hora_entrada', e.hora_entrada)), '{}'::jsonb)
      from "GP2".empleado e),
    'matrices', (select coalesce(jsonb_agg(jsonb_build_object(
        'n', m.n_matriz, 'd', m.descripcion, 'ppk', m.partes_por_kilo_de_fleje,
        'uxg', m.uni_x_golpe, 'maq', m.maquina, 'act', m.activa) order by m.n_matriz), '[]'::jsonb)
      from "GP2".matriz m),
    'matriz_fleje', '{}'::jsonb,
    'matriz_fleje_pieza', '{}'::jsonb,
    'matriz_salidas', (select coalesce(jsonb_object_agg(t.n_matriz, t.salidas), '{}'::jsonb)
      from (
        select m.n_matriz,
               jsonb_agg(jsonb_build_object('comp_id', q.comp_salida_id, 'codigo', q.codigo, 'descripcion', q.descripcion, 'arts', q.arts)
                         order by q.codigo) salidas
        from (
          select rp.matriz_id, rp.comp_salida_id, c.codigo, c.descripcion,
                 string_agg(distinct a.codigo, ' · ' order by a.codigo) arts
          from "GP2".ruta_paso rp
          join "GP2".componente c on c.id = rp.comp_salida_id
          left join "GP2".ruta r on r.id = rp.ruta_id
          left join "GP2".articulo a on a.id = r.articulo_id
          where rp.tipo_paso = 'matriz' and rp.comp_salida_id is not null
          group by rp.matriz_id, rp.comp_salida_id, c.codigo, c.descripcion
        ) q
        join "GP2".matriz m on m.id = q.matriz_id
        group by m.n_matriz
        having count(*) > 1
      ) t),
    'envasado', (select coalesce(jsonb_object_agg(q.n_matriz, q.obj), '{}'::jsonb)
      from (
        select n_matriz,
               jsonb_build_object(
                 'unica', case when count(*) = 1 then max(apc) end,
                 'salidas', jsonb_object_agg(sid::text, apc)
               ) obj
        from (
          select distinct m.n_matriz, rp.comp_salida_id sid, a.articulos_por_caja apc
          from "GP2".matriz m
          join "GP2".ruta_paso rp on rp.matriz_id = m.id and rp.tipo_paso = 'matriz' and rp.comp_salida_id is not null
          join "GP2".componente cs on cs.id = rp.comp_salida_id and cs.sector_id = 12
          join "GP2".articulo a on a.codigo = cs.codigo
        ) d
        group by n_matriz
      ) q),
    'rollos_saldo', '[]'::jsonb,
    'rollos_abiertos', '{}'::jsonb
  );
end $f$;

-- 2) nombre y marca del artículo de cada pieza de ENVASADO (lo que pide la tablet: sólo el nombre si es el mismo artículo, etc.)
create or replace function reg_prod_3_0.reg_prod_3_0_envasado_articulos(p_pase text, p_dispositivo text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $f$
begin
  if not reg_prod_3_0.reg_prod_3_0_pase_ok(p_pase, p_dispositivo) then
    raise exception 'Pase inválido o vencido' using errcode = '28000';
  end if;
  return (
    select coalesce(jsonb_object_agg(q.n_matriz, q.piezas), '{}'::jsonb)
    from (
      select btrim(m.n_matriz) n_matriz,
             jsonb_agg(jsonb_build_object(
               'pieza_codigo', cs.codigo, 'pieza_desc', cs.descripcion,
               'arts', (select coalesce(jsonb_agg(jsonb_build_object('codigo', a.codigo, 'nombre', a.descripcion, 'marca', a.marca)
                                                  order by a.codigo), '[]'::jsonb)
                          from "GP2".articulo a where a.codigo = cs.codigo)) order by cs.codigo) piezas
        from (select distinct rp.matriz_id, rp.comp_salida_id from "GP2".ruta_paso rp
               where rp.tipo_paso = 'matriz' and rp.comp_salida_id is not null) x
        join "GP2".matriz m      on m.id = x.matriz_id
        join "GP2".componente cs on cs.id = x.comp_salida_id and cs.sector_id = 12
       group by btrim(m.n_matriz)
    ) q);
end $f$;

-- 3) registrar un toque: guarda la CRUDA tal cual vino y arma la PROCESADA (unidades, tiempo por unidad y premio contra el histórico,
--    como GP2.registrar_evento_prod). Una sola transacción: nunca queda una sin la otra. Un reintento del mismo toque no duplica.
--    p = { id_ejecucion, fecha, legajo, matriz, uni | golpes, segundos_trabajados, segundos_tiempo_muerto, hora_inicio, hora_fin,
--          nombre_matriz, comp_salida_id, toque: { id, opcion, descripcion, texto, ts_event, hs_inicio, matriz, app_version } }
create or replace function reg_prod_3_0.reg_prod_3_0_registrar_evento(p_pase text, p_dispositivo text, p jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $f$
declare
  t        jsonb := coalesce(p->'toque', '{}'::jsonb);
  v_id     text;
  v_cid    text;
  v_f      timestamptz;
  v_f_ar   timestamp;
  v_leg    text;
  v_mat    text;
  v_golpes numeric;
  v_uni    numeric;
  v_mid    bigint;
  v_mname  text;
  v_nombre text;
  v_th     numeric;
  v_uxg    numeric;
  v_tt     numeric;
  v_premio numeric;
  v_segs   numeric;
  v_ini    timestamptz;
  v_pid    bigint;
  v_fuera  jsonb;
begin
  if not reg_prod_3_0.reg_prod_3_0_pase_ok(p_pase, p_dispositivo) then
    raise exception 'Pase inválido o vencido' using errcode = '28000';
  end if;
  v_id := nullif(btrim(coalesce(p->>'id_ejecucion', t->>'id', '')), '');
  if v_id is null then raise exception 'Falta el id del toque'; end if;
  v_f    := coalesce(nullif(p->>'fecha', '')::timestamptz, nullif(t->>'ts_event', '')::timestamptz, now());
  v_f_ar := v_f at time zone 'America/Argentina/Buenos_Aires';
  v_leg  := nullif(btrim(coalesce(p->>'legajo', '')), '');
  v_mat  := nullif(btrim(coalesce(p->>'matriz', '')), '');
  if v_leg is null then raise exception 'Falta el legajo'; end if;
  if v_mat is null then raise exception 'Falta la matriz/código del evento'; end if;

  -- cruda
  insert into reg_prod_3_0.crudo_cervantes
    (id, legajo, opcion, descripcion, texto, ts_event, hs_inicio, matriz, dispositivo, app_version, extra)
  values
    (v_id, v_leg, coalesce(nullif(t->>'opcion', ''), v_mat), t->>'descripcion', t->>'texto', v_f,
     nullif(t->>'hs_inicio', ''), nullif(t->>'matriz', ''), left(p_dispositivo, 80), left(t->>'app_version', 40), p - 'toque')
  on conflict (id) do nothing
  returning id into v_cid;
  if v_cid is null then
    return jsonb_build_object('ok', true, 'id', v_id, 'dup', true);
  end if;

  -- procesada
  select nombre into v_nombre from "GP2".empleado where legajo = v_leg;
  select id, descripcion, tiempo_historico, uni_x_golpe into v_mid, v_mname, v_th, v_uxg
    from "GP2".matriz where btrim(n_matriz) = v_mat limit 1;
  v_golpes := nullif(p->>'golpes', '')::numeric;
  if v_golpes is not null and v_golpes > 0 then
    v_uni := v_golpes * coalesce(v_uxg, 1);
  else
    v_golpes := null;
    v_uni := coalesce(nullif(p->>'uni', '')::numeric, 0);
  end if;
  if v_uni > 0 then
    v_segs := nullif(p->>'segundos_trabajados', '')::numeric;
    v_tt := coalesce(nullif(p->>'tiempo_toma', '')::numeric,
                     case when v_segs > 0 then round((v_segs / v_uni)::numeric, 4) end);
    if v_tt is not null and v_th is not null and v_th > 0 then
      v_premio := round(((-(v_tt / v_th) + 1) * 10)::numeric, 2);
    end if;
  end if;
  v_ini := reg_prod_3_0.reg_prod_3_0_a_timestamptz(t->>'hs_inicio');

  insert into reg_prod_3_0.procesado_cervantes (
    crudo_id, id_ejecucion, fecha, legajo, nombre_empleado, matriz, nombre_matriz, uni, golpes, uni_x_golpe,
    premio, tiempo_toma, tiempo_historico, hora_inicio, hora_fin, fecha_inicio, fecha_fin,
    segundos_historico, segundos_trabajados, segundos_tiempo_muerto, anular_tiempo, dia, mes, quincena)
  values (
    v_cid, v_id, v_f, v_leg, coalesce(nullif(p->>'nombre_empleado', ''), v_nombre), v_mat,
    coalesce(nullif(p->>'nombre_matriz', ''), v_mname), v_uni, v_golpes,
    case when v_golpes is not null then coalesce(v_uxg, 1) end,
    v_premio, v_tt, case when v_uni > 0 then v_th end,
    nullif(p->>'hora_inicio', '')::time, nullif(p->>'hora_fin', '')::time, coalesce(v_ini, v_f), v_f,
    case when v_uni > 0 and v_th is not null then v_th * v_uni end,
    nullif(p->>'segundos_trabajados', '')::numeric, nullif(p->>'segundos_tiempo_muerto', '')::numeric, false,
    extract(day from v_f_ar)::int, extract(month from v_f_ar)::int,
    case when extract(day from v_f_ar)::int <= 15 then 1 else 2 end)
  returning id into v_pid;

  -- fuera de horario (por la hora del toque, no la de hoy): una fila por legajo y día
  v_fuera := reg_prod_3_0.reg_prod_3_0_fuera_de_horario('cervantes', v_f);
  if v_fuera is not null and not exists (
       select 1 from reg_prod_3_0.auditoria a
        where a.tipo = 'evento_fuera_de_horario' and a.legajo = v_leg and a.detalle->>'dia' = v_fuera->>'dia') then
    insert into reg_prod_3_0.auditoria (tipo, app, legajo, dispositivo, ip, ok, detalle)
    values ('evento_fuera_de_horario', 'cervantes', v_leg, left(p_dispositivo, 80), reg_prod_3_0.reg_prod_3_0_ip(), true,
            v_fuera || jsonb_build_object('id_ejecucion', v_id, 'opcion', coalesce(nullif(t->>'opcion', ''), v_mat)));
  end if;

  return jsonb_build_object('ok', true, 'id', v_pid, 'premio', v_premio, 'uni', v_uni, 'golpes', v_golpes, 'uni_x_golpe', v_uxg);
end $f$;

-- 4) anular un toque (el botón de borrar del historial): la cruda queda marcada y la procesada, con Eliminar = 'S'
create or replace function reg_prod_3_0.reg_prod_3_0_anular_evento(p_pase text, p_dispositivo text, p_id_ejecucion text)
returns jsonb language plpgsql security definer set search_path = ''
as $f$
declare
  v_n int;
begin
  if not reg_prod_3_0.reg_prod_3_0_pase_ok(p_pase, p_dispositivo) then
    raise exception 'Pase inválido o vencido' using errcode = '28000';
  end if;
  if nullif(btrim(coalesce(p_id_ejecucion, '')), '') is null then
    raise exception 'Falta id_ejecucion';
  end if;
  update reg_prod_3_0.crudo_cervantes set anulado = true, anulado_at = now() where id = p_id_ejecucion and not anulado;
  update reg_prod_3_0.procesado_cervantes set eliminar = 'S' where id_ejecucion = p_id_ejecucion;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'anulados', v_n);
end $f$;

-- 5) permisos: las 4 las llaman las apps con la clave pública (el pase es lo que las protege)
revoke execute on function reg_prod_3_0.reg_prod_3_0_bundle(text, text) from public;
revoke execute on function reg_prod_3_0.reg_prod_3_0_envasado_articulos(text, text) from public;
revoke execute on function reg_prod_3_0.reg_prod_3_0_registrar_evento(text, text, jsonb) from public;
revoke execute on function reg_prod_3_0.reg_prod_3_0_anular_evento(text, text, text) from public;
grant  execute on function reg_prod_3_0.reg_prod_3_0_bundle(text, text) to anon, authenticated;
grant  execute on function reg_prod_3_0.reg_prod_3_0_envasado_articulos(text, text) to anon, authenticated;
grant  execute on function reg_prod_3_0.reg_prod_3_0_registrar_evento(text, text, jsonb) to anon, authenticated;
grant  execute on function reg_prod_3_0.reg_prod_3_0_anular_evento(text, text, text) to anon, authenticated;
