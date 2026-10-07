-- ESTADO: NO APLICADO en la base (07/10/2026). Espera el "sí" de Elías; al aplicarlo se cambia esta línea por "APLICADO" y la fecha.
-- Registro Producción 3.0 — FASE 1d (07/10/2026, Elías: «que devuelva el stock» · «sistema anti duplicado»). Sin tocar el código de GP2.
--
-- 1) ANULAR DEVUELVE EL STOCK. Cada toque guarda qué movimientos de stock hizo (procesado_cervantes.movimientos). Al anularlo se borran
--    esos movimientos y el trigger de GP2.movimiento (fn_movimiento_aplicar) revierte el inventario solo: es lo mismo que hace GP2 al anular
--    una recepción (GP2.anular_recepcion). Se hace una sola vez (stock_revertido_at). Los toques registrados antes de esto no tienen la
--    lista y no se revierten (hoy son sólo filas de prueba).
-- 2) ANTI-DUPLICADO DE ROLLOS. El celular manda cada «tomé un rollo» / «cerré el rollo» con un id propio y, si no le llega la respuesta, lo
--    reintenta con el MISMO id. La base anota cada id (reg_prod_3_0.rollo_llamadas): si ya lo vio, devuelve la respuesta de la primera
--    vez y no vuelve a descontar ni a cerrar. Son funciones nuevas (reg_prod_3_0_rollo_tomar / _rollo_cerrar): las de la Fase 1c quedan
--    sin uso y se borran en la limpieza final. El catálogo avisa `rollos_antiduplicado` para que la app use las nuevas.

-- 1) columnas y tabla --------------------------------------------------------------------------------------------------------------
alter table reg_prod_3_0.procesado_cervantes add column if not exists movimientos bigint[];          -- ids de GP2.movimiento que hizo el toque
alter table reg_prod_3_0.procesado_cervantes add column if not exists stock_revertido_at timestamptz;  -- cuándo se devolvió el stock al anularlo

create table if not exists reg_prod_3_0.rollo_llamadas (
  id          text primary key,                 -- el id que puso el celular (se repite en cada reintento)
  fn          text not null,                    -- 'tomar' | 'cerrar'
  legajo      text,
  dispositivo text,
  at          timestamptz not null default now(),
  resultado   jsonb                             -- la respuesta de la primera vez
);
alter table reg_prod_3_0.rollo_llamadas enable row level security;
revoke all on reg_prod_3_0.rollo_llamadas from anon, authenticated;

-- 2) interna: devolver el stock de un toque (borrar sus movimientos de fabricación; el trigger de GP2 revierte el inventario) ------------
create or replace function reg_prod_3_0.reg_prod_3_0_gp2_revertir_movimientos(p_ids bigint[])
returns integer language plpgsql security definer set search_path = ''
as $f$
declare
  v_n int := 0;
begin
  if p_ids is null or array_length(p_ids, 1) is null then return 0; end if;
  delete from "GP2".movimiento where id = any(p_ids) and tipo_mov = 'fabricacion';
  get diagnostics v_n = row_count;
  return v_n;
end $f$;
revoke execute on function reg_prod_3_0.reg_prod_3_0_gp2_revertir_movimientos(bigint[]) from public, anon, authenticated;

-- 3) registrar un toque: igual que la Fase 1c y además anota los movimientos de stock que hizo ---------------------------------------
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
  v_nsal   int;
  v_salida bigint;
  v_movid  bigint;
  v_movs   bigint[];
  v_aviso  text;
  v_res    jsonb;
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
    return jsonb_build_object('ok', true, 'id', v_id, 'dup', true);   -- reintento del mismo toque: no se toca nada (ni el stock)
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
    crudo_id, id_ejecucion, fecha, legajo, nombre_empleado, matriz, matriz_id, nombre_matriz, uni, golpes, uni_x_golpe,
    premio, tiempo_toma, tiempo_historico, hora_inicio, hora_fin, fecha_inicio, fecha_fin,
    segundos_historico, segundos_trabajados, segundos_tiempo_muerto, anular_tiempo, dia, mes, quincena)
  values (
    v_cid, v_id, v_f, v_leg, coalesce(nullif(p->>'nombre_empleado', ''), v_nombre), v_mat, v_mid,
    coalesce(nullif(p->>'nombre_matriz', ''), v_mname), v_uni, v_golpes,
    case when v_golpes is not null then coalesce(v_uxg, 1) end,
    v_premio, v_tt, case when v_uni > 0 then v_th end,
    nullif(p->>'hora_inicio', '')::time, nullif(p->>'hora_fin', '')::time, coalesce(v_ini, v_f), v_f,
    case when v_uni > 0 and v_th is not null then v_th * v_uni end,
    nullif(p->>'segundos_trabajados', '')::numeric, nullif(p->>'segundos_tiempo_muerto', '')::numeric, false,
    extract(day from v_f_ar)::int, extract(month from v_f_ar)::int,
    case when extract(day from v_f_ar)::int <= 15 then 1 else 2 end)
  returning id into v_pid;

  -- stock de GP2 (como GP2.registrar_evento_prod): sólo si hay unidades y la matriz existe; la pieza es la elegida (comp_salida_id) o
  -- la única salida de la matriz. p.mover_stock = false lo saltea (pruebas).
  if v_uni > 0 and v_mid is not null and coalesce(p->>'mover_stock', 'true') <> 'false' then
    v_salida := nullif(p->>'comp_salida_id', '')::bigint;
    if v_salida is not null then
      if not exists (select 1 from "GP2".ruta_paso where matriz_id = v_mid and comp_salida_id = v_salida) then
        v_aviso := 'Sin stock: la pieza elegida no corresponde a la matriz'; v_salida := null;
      end if;
    else
      select count(distinct comp_salida_id) into v_nsal
        from "GP2".ruta_paso where matriz_id = v_mid and tipo_paso = 'matriz' and comp_salida_id is not null;
      if v_nsal = 1 then
        select distinct comp_salida_id into v_salida from "GP2".ruta_paso
         where matriz_id = v_mid and tipo_paso = 'matriz' and comp_salida_id is not null;
      elsif v_nsal > 1 then
        v_aviso := 'Sin stock: la matriz produce varias piezas (falta comp_salida_id)';
      end if;
    end if;
    if v_salida is not null then
      v_res := reg_prod_3_0.reg_prod_3_0_gp2_fabricar_stock(v_mid, v_salida, v_uni, v_f);
      v_movid := nullif(v_res->>'movimiento_id', '')::bigint;
      if (v_res->>'n_entradas')::int = 0 then v_aviso := coalesce(v_aviso, v_res->>'aviso'); end if;
      -- los movimientos que acaba de crear ESTA transacción (para poder devolverlos al anular)
      if v_movid is not null then
        select array_agg(id order by id) into v_movs from "GP2".movimiento
         where id >= v_movid and xmin::text::bigint = (txid_current() % 4294967296);
        update reg_prod_3_0.procesado_cervantes set movimientos = v_movs where id = v_pid;
      end if;
    end if;
  end if;

  -- fuera de horario (por la hora del toque, no la de hoy): una fila por legajo y día
  v_fuera := reg_prod_3_0.reg_prod_3_0_fuera_de_horario('cervantes', v_f);
  if v_fuera is not null and not exists (
       select 1 from reg_prod_3_0.auditoria a
        where a.tipo = 'evento_fuera_de_horario' and a.legajo = v_leg and a.detalle->>'dia' = v_fuera->>'dia') then
    insert into reg_prod_3_0.auditoria (tipo, app, legajo, dispositivo, ip, ok, detalle)
    values ('evento_fuera_de_horario', 'cervantes', v_leg, left(p_dispositivo, 80), reg_prod_3_0.reg_prod_3_0_ip(), true,
            v_fuera || jsonb_build_object('id_ejecucion', v_id, 'opcion', coalesce(nullif(t->>'opcion', ''), v_mat)));
  end if;

  return jsonb_build_object('ok', true, 'id', v_pid, 'movimiento_id', v_movid, 'aviso', v_aviso,
                            'premio', v_premio, 'uni', v_uni, 'golpes', v_golpes, 'uni_x_golpe', v_uxg);
end $f$;

-- 4) anular: la cruda marcada, la procesada con Eliminar = 'S' y, una sola vez, el stock devuelto -------------------------------------
create or replace function reg_prod_3_0.reg_prod_3_0_anular_evento(p_pase text, p_dispositivo text, p_id_ejecucion text)
returns jsonb language plpgsql security definer set search_path = ''
as $f$
declare
  v_n    int;
  v_movs bigint[];
  v_rev  int := 0;
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
  -- devolver el stock (si el toque lo movió y todavía no se devolvió)
  select movimientos into v_movs from reg_prod_3_0.procesado_cervantes
   where id_ejecucion = p_id_ejecucion and movimientos is not null and stock_revertido_at is null
   for update;
  if v_movs is not null then
    v_rev := reg_prod_3_0.reg_prod_3_0_gp2_revertir_movimientos(v_movs);
    update reg_prod_3_0.procesado_cervantes set stock_revertido_at = now() where id_ejecucion = p_id_ejecucion;
  end if;
  return jsonb_build_object('ok', true, 'anulados', v_n, 'movimientos_revertidos', v_rev);
end $f$;

-- 5) rollos con anti-duplicado ----------------------------------------------------------------------------------------------------
create or replace function reg_prod_3_0.reg_prod_3_0_rollo_tomar(
  p_pase text, p_dispositivo text, p_id text, p_legajo text, p_comp_id bigint, p_kg_por_rollo numeric,
  p_matriz text default null, p_fecha timestamptz default now())
returns jsonb language plpgsql security definer set search_path = ''
as $f$
declare
  v_prev jsonb;
  v_res  jsonb;
begin
  if not reg_prod_3_0.reg_prod_3_0_pase_ok(p_pase, p_dispositivo) then
    raise exception 'Pase inválido o vencido' using errcode = '28000';
  end if;
  if nullif(btrim(coalesce(p_id, '')), '') is null then raise exception 'Falta el id de la llamada'; end if;
  insert into reg_prod_3_0.rollo_llamadas (id, fn, legajo, dispositivo) values (p_id, 'tomar', p_legajo, left(p_dispositivo, 80))
  on conflict (id) do nothing;
  if not found then                                   -- ya llegó antes: la misma respuesta, sin descontar otra vez
    select resultado into v_prev from reg_prod_3_0.rollo_llamadas where id = p_id;
    return coalesce(v_prev, '{}'::jsonb) || jsonb_build_object('dup', true);
  end if;
  v_res := reg_prod_3_0.reg_prod_3_0_gp2_tomar_rollo(p_legajo, p_comp_id, p_kg_por_rollo, p_matriz, coalesce(p_fecha, now()));
  update reg_prod_3_0.rollo_llamadas set resultado = v_res where id = p_id;
  return v_res;
end $f$;

create or replace function reg_prod_3_0.reg_prod_3_0_rollo_cerrar(
  p_pase text, p_dispositivo text, p_id text, p_legajo text, p_quedo_resto boolean, p_fecha timestamptz default now())
returns jsonb language plpgsql security definer set search_path = ''
as $f$
declare
  v_prev jsonb;
  v_res  jsonb;
begin
  if not reg_prod_3_0.reg_prod_3_0_pase_ok(p_pase, p_dispositivo) then
    raise exception 'Pase inválido o vencido' using errcode = '28000';
  end if;
  if nullif(btrim(coalesce(p_id, '')), '') is null then raise exception 'Falta el id de la llamada'; end if;
  insert into reg_prod_3_0.rollo_llamadas (id, fn, legajo, dispositivo) values (p_id, 'cerrar', p_legajo, left(p_dispositivo, 80))
  on conflict (id) do nothing;
  if not found then                                   -- ya llegó antes: no se cierra otra vez (podría cerrar el rollo siguiente)
    select resultado into v_prev from reg_prod_3_0.rollo_llamadas where id = p_id;
    return coalesce(v_prev, '{}'::jsonb) || jsonb_build_object('dup', true);
  end if;
  v_res := reg_prod_3_0.reg_prod_3_0_cerrar_rollo(p_pase, p_dispositivo, p_legajo, p_quedo_resto, p_fecha);   -- la de la Fase 1c
  update reg_prod_3_0.rollo_llamadas set resultado = v_res where id = p_id;
  return v_res;
end $f$;

revoke execute on function reg_prod_3_0.reg_prod_3_0_rollo_tomar(text, text, text, text, bigint, numeric, text, timestamptz) from public;
revoke execute on function reg_prod_3_0.reg_prod_3_0_rollo_cerrar(text, text, text, text, boolean, timestamptz) from public;
grant  execute on function reg_prod_3_0.reg_prod_3_0_rollo_tomar(text, text, text, text, bigint, numeric, text, timestamptz) to anon, authenticated;
grant  execute on function reg_prod_3_0.reg_prod_3_0_rollo_cerrar(text, text, text, text, boolean, timestamptz) to anon, authenticated;

-- 6) el catálogo avisa que están las nuevas (la app las usa sólo si viene esto) ---------------------------------------------------------
-- (igual que la Fase 1c, con 'rollos_antiduplicado'; va al final porque es lo que hace que la app use las funciones nuevas)
create or replace function reg_prod_3_0.reg_prod_3_0_bundle(p_pase text, p_dispositivo text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $f$
begin
  if not reg_prod_3_0.reg_prod_3_0_pase_ok(p_pase, p_dispositivo) then
    raise exception 'Pase inválido o vencido' using errcode = '28000';
  end if;
  return jsonb_build_object(
    'rollos_activos', true,   -- la app (cervantes-gp2) muestra el selector de rollo, «¿quedó resto?» y el botón CT sólo si viene esto
    'rollos_antiduplicado', true,   -- Fase 1d: la app usa reg_prod_3_0_rollo_tomar / _rollo_cerrar (con id anti-duplicado)
    'registro_en_golpes', (select coalesce((select valor from "GP2".parametro where clave = 'registro_en_golpes'), '1') = '1'),
    'empleados', (select coalesce(jsonb_object_agg(e.legajo, jsonb_build_object(
        'nombre', e.nombre, 'activo', e.activo, 'hora_entrada', e.hora_entrada)), '{}'::jsonb)
      from "GP2".empleado e),
    'matrices', (select coalesce(jsonb_agg(jsonb_build_object(
        'n', m.n_matriz, 'd', m.descripcion, 'ppk', m.partes_por_kilo_de_fleje,
        'uxg', m.uni_x_golpe, 'maq', m.maquina, 'act', m.activa) order by m.n_matriz), '[]'::jsonb)
      from "GP2".matriz m),
    'matriz_fleje', (select coalesce(jsonb_object_agg(q.n_matriz, jsonb_build_object(
        'comp_id', q.comp_id, 'codigo', q.codigo, 'descripcion', q.descripcion)), '{}'::jsonb)
      from (
        select distinct on (m.n_matriz) m.n_matriz, c.id comp_id, c.codigo, c.descripcion
        from "GP2".matriz m
        join "GP2".ruta_paso rp on rp.matriz_id = m.id and rp.tipo_paso = 'matriz' and rp.comp_entrada_id is not null
        join "GP2".componente c on c.id = rp.comp_entrada_id and c.sector_id = 5
        order by m.n_matriz, c.id
      ) q),
    'matriz_fleje_pieza', (select coalesce(jsonb_object_agg(t.n_matriz, t.porpieza), '{}'::jsonb)
      from (
        select q.n_matriz,
               jsonb_object_agg(q.comp_salida_id::text, jsonb_build_object(
                 'comp_id', q.comp_id, 'codigo', q.codigo, 'descripcion', q.descripcion)) porpieza
        from (
          select distinct on (m.n_matriz, rp.comp_salida_id)
                 m.n_matriz, rp.comp_salida_id, c.id comp_id, c.codigo, c.descripcion
          from "GP2".matriz m
          join "GP2".ruta_paso rp on rp.matriz_id = m.id and rp.tipo_paso = 'matriz'
               and rp.comp_entrada_id is not null and rp.comp_salida_id is not null
          join "GP2".componente c on c.id = rp.comp_entrada_id and c.sector_id = 5
          order by m.n_matriz, rp.comp_salida_id, c.id
        ) q
        group by q.n_matriz
      ) t),
    'matriz_salidas', (select coalesce(jsonb_object_agg(t.n_matriz, t.salidas), '{}'::jsonb)
      from (
        select m.n_matriz,
               jsonb_agg(jsonb_build_object('comp_id', q.comp_salida_id, 'codigo', q.codigo, 'descripcion', q.descripcion, 'arts', q.arts, 'etiqueta', e.etiqueta)
                         order by coalesce(e.orden, 9999), q.codigo) salidas
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
        left join "GP2".matriz_salida_etiqueta e on e.matriz_id = q.matriz_id and e.componente_id = q.comp_salida_id
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
    'rollos_saldo', (select coalesce(jsonb_agg(jsonb_build_object(
        'comp_id', v.componente_id, 'codigo', v.codigo, 'kg_por_rollo', v.kg_por_rollo, 'rollos', v.rollos)
        order by v.codigo, v.kg_por_rollo), '[]'::jsonb)
      from "GP2".v_rollo_saldo v where v.rollos <> 0),
    'rollos_abiertos', (select coalesce(jsonb_object_agg(u.legajo, jsonb_build_object(
        'uso_id', u.id, 'comp_id', u.componente_id, 'codigo', c.codigo,
        'kg_por_rollo', u.kg_por_rollo, 'matriz', u.matriz_raw, 'ts_inicio', u.ts_inicio,
        'kg_usados', case when m.partes_por_kilo_de_fleje > 0 then round((
            (coalesce((select sum(p.uni) from "GP2".produccion p
                        where p.legajo = u.legajo and p.fecha >= u.ts_inicio and p.uni > 0 and coalesce(p.eliminar, '') <> 'S'), 0)
           + coalesce((select sum(x.uni) from reg_prod_3_0.procesado_cervantes x
                        where x.legajo = u.legajo and x.fecha >= u.ts_inicio and x.uni > 0 and coalesce(x.eliminar, '') <> 'S'), 0))
            / m.partes_por_kilo_de_fleje)::numeric, 2) else 0 end)), '{}'::jsonb)
      from "GP2".rollo_uso u
      join "GP2".componente c on c.id = u.componente_id
      left join "GP2".matriz m on btrim(m.n_matriz) = btrim(coalesce(u.matriz_raw, ''))
      where u.ts_fin is null)
  );
end $f$;
