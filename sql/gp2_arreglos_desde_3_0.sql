-- ESTADO (08/10/2026): TODO APLICADO, con el «sí» de Elías. Va al schema GP2 (el ORIGINAL), no a reg_prod_3_0.
--   ✅ APLICADO: 1a, 1b, 2, 3a, 3b (verificado con md5 de pg_get_functiondef). Copia y prueba en Gestion-Productiva-2.0:
--      db/migracion_arreglos_reg_prod_3_0_20261007.sql, tests/ui/test_op_e2e.js.
--   ✅ 1c (anular_evento_prod devuelve el stock): lo pegó Elías en el SQL Editor el 08/10; probado en una transacción deshecha.
-- GP2 · los arreglos que se hicieron en Registro Producción 3.0, llevados al original
-- [Elías, 07/10/2026: «los cambios/parches que hicimos arreglando los errores aplicalos también al original»].
--
--   1) ANULAR DEVUELVE EL STOCK. registrar_evento_prod anota en produccion.movimientos qué movimientos de stock hizo cada toque;
--      anular_evento_prod los borra (una sola vez, stock_revertido_at) y el trigger de movimiento (fn_movimiento_aplicar) revierte el
--      inventario. Es lo mismo que ya hace GP2.anular_recepcion. Los toques anteriores no tienen la lista: no se revierten.
--   2) ROLLOS SIN DUPLICADOS. rollo_tomar / rollo_cerrar: lo mismo que tomar_rollo / cerrar_rollo pero con un id que pone la tablet y se
--      repite en cada reintento; si ya llegó, devuelven la respuesta de la primera vez y no descuentan otro rollo ni cierran el siguiente.
--      tomar_rollo / cerrar_rollo quedan como estaban (las tablets viejas siguen andando). El bundle avisa `rollos_antiduplicado`.
--   3) LO ANULADO NO CUENTA para «lo producido con el rollo»: cerrar_rollo y los kg usados de registro_operarios_bundle dejaban sumar
--      los toques anulados (eliminar = 'S').
-- Mismos permisos que las de GP2 que reemplazan o copian (sólo cuentas habilitadas: _exigir_autorizado()).
-- ⚠ El bloque 1c (anular_evento_prod) tiene un DELETE adentro: la herramienta de Claude no lo puede aplicar; va por el SQL Editor.

-- 1a) columnas ------------------------------------------------------------------------------------------------------------------
alter table "GP2".produccion add column if not exists movimientos bigint[];
alter table "GP2".produccion add column if not exists stock_revertido_at timestamptz;

-- 1b) registrar_evento_prod: igual que hoy + anota los movimientos de stock del toque ------------------------------------------------
CREATE OR REPLACE FUNCTION "GP2".registrar_evento_prod(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'GP2'
AS $function$
declare
  v_id bigint; v_f timestamptz; v_f_ar timestamp; v_leg text; v_mat text; v_uni numeric;
  v_mid bigint; v_mname text; v_partes numeric; v_nombre text;
  v_nsal int; v_salida bigint;
  v_movid bigint; v_aviso text;
  v_th numeric; v_tt numeric; v_premio numeric; v_segs numeric;
  v_golpes numeric; v_uxg numeric; v_res jsonb;
  v_movs bigint[];
begin
  perform "GP2"._exigir_autorizado();  -- seguridad punto 1 fase B (2026-09-28)
  v_f   := coalesce(nullif(p->>'fecha','')::timestamptz, now());
  v_f_ar := v_f at time zone 'America/Argentina/Buenos_Aires';
  v_leg := nullif(btrim(coalesce(p->>'legajo','')),'');
  v_mat := nullif(btrim(coalesce(p->>'matriz','')),'');
  v_golpes := nullif(p->>'golpes','')::numeric;
  if v_leg is null then raise exception 'Falta el legajo'; end if;
  if v_mat is null then raise exception 'Falta la matriz/codigo del evento'; end if;

  select nombre into v_nombre from empleado where legajo = v_leg;
  select id, descripcion, partes_por_kilo_de_fleje, tiempo_historico, uni_x_golpe
    into v_mid, v_mname, v_partes, v_th, v_uxg
    from matriz where btrim(n_matriz) = v_mat limit 1;

  -- golpes -> unidades con el factor de la matriz (foto del factor al momento del registro)
  if v_golpes is not null and v_golpes > 0 then
    v_uni := v_golpes * coalesce(v_uxg,1);
  else
    v_golpes := null;
    v_uni := coalesce(nullif(p->>'uni','')::numeric, 0);
  end if;

  -- premio nativo: tiempo_toma = segundos trabajados / uni; premio contra el historico
  if v_uni > 0 then
    v_segs := nullif(p->>'segundos_trabajados','')::numeric;
    v_tt := coalesce(nullif(p->>'tiempo_toma','')::numeric,
                     case when v_segs > 0 then round((v_segs / v_uni)::numeric, 4) end);
    if v_tt is not null and v_th is not null and v_th > 0 then
      v_premio := round(((-(v_tt / v_th) + 1) * 10)::numeric, 2);
    end if;
  end if;

  insert into produccion(
    fecha, legajo, nombre_empleado, matriz_raw, matriz_id, nombre_matriz, uni,
    golpes, uni_x_golpe,
    hora_inicio, hora_fin, tiempo_toma, tiempo_historico, premio,
    segundos_trabajados, segundos_tiempo_muerto,
    dia, mes, quincena, id_ejecucion, origen_created_at
  ) values (
    v_f, v_leg, coalesce(nullif(p->>'nombre_empleado',''), v_nombre), v_mat, v_mid,
    coalesce(nullif(p->>'nombre_matriz',''), v_mname), v_uni,
    v_golpes, case when v_golpes is not null then coalesce(v_uxg,1) end,
    nullif(p->>'hora_inicio','')::time, nullif(p->>'hora_fin','')::time,
    v_tt, case when v_uni > 0 then v_th end, v_premio,
    nullif(p->>'segundos_trabajados','')::numeric,
    nullif(p->>'segundos_tiempo_muerto','')::numeric,
    extract(day from v_f_ar)::int, extract(month from v_f_ar)::int,
    case when extract(day from v_f_ar)::int <= 15 then 1 else 2 end,
    nullif(p->>'id_ejecucion',''), now()
  )
  on conflict (id_ejecucion) where id_ejecucion is not null do nothing
  returning id into v_id;

  -- reintento del mismo evento (id_ejecucion ya registrado): devolver el existente sin tocar stock
  if v_id is null then
    select id into v_id from produccion where id_ejecucion = nullif(p->>'id_ejecucion','');
    return jsonb_build_object('ok',true,'id',v_id,'dup',true);
  end if;

  if v_uni > 0 and v_mid is not null and coalesce(p->>'mover_stock','true') <> 'false' then
    v_salida := nullif(p->>'comp_salida_id','')::bigint;
    if v_salida is not null then
      if not exists(select 1 from ruta_paso where matriz_id=v_mid and comp_salida_id=v_salida) then
        v_aviso := 'Sin stock: la pieza elegida no corresponde a la matriz'; v_salida := null;
      end if;
    else
      select count(distinct comp_salida_id) into v_nsal
        from ruta_paso where matriz_id=v_mid and tipo_paso='matriz' and comp_salida_id is not null;
      if v_nsal = 1 then
        select distinct comp_salida_id into v_salida from ruta_paso
         where matriz_id=v_mid and tipo_paso='matriz' and comp_salida_id is not null;
      elsif v_nsal > 1 then v_aviso := 'Sin stock: la matriz produce varias piezas (falta comp_salida_id)';
      end if;
    end if;
    if v_salida is not null then
      v_res := "GP2".fabricar_stock(v_mid, v_salida, v_uni, v_f);
      v_movid := nullif(v_res->>'movimiento_id','')::bigint;
      if (v_res->>'n_entradas')::int = 0 then v_aviso := coalesce(v_aviso, v_res->>'aviso'); end if;
      -- (arreglo de Registro Producción 3.0, 07/10/2026) los movimientos que acaba de crear ESTA transacción, para devolverlos al anular
      if v_movid is not null then
        select array_agg(id order by id) into v_movs from movimiento
         where id >= v_movid and xmin::text::bigint = (txid_current() % 4294967296);
        update produccion set movimientos = v_movs where id = v_id;
      end if;
    end if;
  end if;

  return jsonb_build_object('ok',true,'id',v_id,'movimiento_id',v_movid,'aviso',v_aviso,
    'premio',v_premio,'uni',v_uni,'golpes',v_golpes,'uni_x_golpe',v_uxg);
end $function$;

-- 1c) anular_evento_prod: igual que hoy + devuelve el stock (⚠ DELETE adentro: va por el SQL Editor) -------------------------------
CREATE OR REPLACE FUNCTION "GP2".anular_evento_prod(p_id_ejecucion text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'GP2'
AS $function$
declare v_n int; v_movs bigint[]; v_rev int := 0;
begin
  perform "GP2"._exigir_autorizado();  -- seguridad punto 1 fase B (2026-09-28)
  if nullif(btrim(coalesce(p_id_ejecucion,'')),'') is null then
    raise exception 'Falta id_ejecucion';
  end if;
  update produccion set eliminar = 'S' where id_ejecucion = p_id_ejecucion;
  get diagnostics v_n = row_count;
  -- (arreglo de Registro Producción 3.0, 07/10/2026) devolver el stock que movió el toque, una sola vez: se borran sus movimientos y
  -- el trigger de movimiento (fn_movimiento_aplicar) revierte el inventario, como en anular_recepcion
  select movimientos into v_movs from produccion
   where id_ejecucion = p_id_ejecucion and movimientos is not null and stock_revertido_at is null
   for update;
  if v_movs is not null then
    delete from movimiento where id = any(v_movs) and tipo_mov = 'fabricacion';
    get diagnostics v_rev = row_count;
    update produccion set stock_revertido_at = now() where id_ejecucion = p_id_ejecucion;
  end if;
  return jsonb_build_object('ok', true, 'anulados', v_n, 'movimientos_revertidos', v_rev);
end $function$;

-- 2) rollos sin duplicados ---------------------------------------------------------------------------------------------------------
create table if not exists "GP2".rollo_llamadas (
  id        text primary key,           -- el id que puso la tablet (se repite en cada reintento)
  fn        text not null,              -- 'tomar' | 'cerrar'
  legajo    text,
  at        timestamptz not null default now(),
  resultado jsonb                       -- la respuesta de la primera vez
);
alter table "GP2".rollo_llamadas enable row level security;
revoke all on "GP2".rollo_llamadas from anon, authenticated;
-- regla D de db/verificar.sql: toda tabla de GP2 tiene RLS y una policy de lectura (acá sin grant: nadie la lee desde la API)
create policy p_gp2_select on "GP2".rollo_llamadas for select to anon, authenticated using (true);

create or replace function "GP2".rollo_tomar(p_id text, p_legajo text, p_comp_id bigint, p_kg_por_rollo numeric,
  p_matriz text default null, p_fecha timestamptz default now())
returns jsonb language plpgsql security definer set search_path to 'GP2'
as $f$
declare v_prev jsonb; v_res jsonb;
begin
  perform "GP2"._exigir_autorizado();
  if nullif(btrim(coalesce(p_id, '')), '') is null then raise exception 'Falta el id de la llamada'; end if;
  insert into rollo_llamadas (id, fn, legajo) values (p_id, 'tomar', p_legajo) on conflict (id) do nothing;
  if not found then                     -- ya llegó antes: la misma respuesta, sin descontar otro rollo
    select resultado into v_prev from rollo_llamadas where id = p_id;
    return coalesce(v_prev, '{}'::jsonb) || jsonb_build_object('dup', true);
  end if;
  v_res := "GP2".tomar_rollo(p_legajo, p_comp_id, p_kg_por_rollo, p_matriz, p_fecha);
  update rollo_llamadas set resultado = v_res where id = p_id;
  return v_res;
end $f$;

create or replace function "GP2".rollo_cerrar(p_id text, p_legajo text, p_quedo_resto boolean,
  p_uni_producidas numeric default null, p_fecha timestamptz default now())
returns jsonb language plpgsql security definer set search_path to 'GP2'
as $f$
declare v_prev jsonb; v_res jsonb;
begin
  perform "GP2"._exigir_autorizado();
  if nullif(btrim(coalesce(p_id, '')), '') is null then raise exception 'Falta el id de la llamada'; end if;
  insert into rollo_llamadas (id, fn, legajo) values (p_id, 'cerrar', p_legajo) on conflict (id) do nothing;
  if not found then                     -- ya llegó antes: no se cierra otra vez (podría cerrar el rollo siguiente)
    select resultado into v_prev from rollo_llamadas where id = p_id;
    return coalesce(v_prev, '{}'::jsonb) || jsonb_build_object('dup', true);
  end if;
  v_res := "GP2".cerrar_rollo(p_legajo, p_quedo_resto, p_uni_producidas, p_fecha);
  update rollo_llamadas set resultado = v_res where id = p_id;
  return v_res;
end $f$;

revoke execute on function "GP2".rollo_tomar(text, text, bigint, numeric, text, timestamptz) from public, anon;
revoke execute on function "GP2".rollo_cerrar(text, text, boolean, numeric, timestamptz) from public, anon;
grant  execute on function "GP2".rollo_tomar(text, text, bigint, numeric, text, timestamptz) to authenticated;
grant  execute on function "GP2".rollo_cerrar(text, text, boolean, numeric, timestamptz) to authenticated;

-- 3a) cerrar_rollo: igual que hoy, pero lo anulado no cuenta como producido con el rollo --------------------------------------------
CREATE OR REPLACE FUNCTION "GP2".cerrar_rollo(p_legajo text, p_quedo_resto boolean, p_uni_producidas numeric DEFAULT NULL::numeric, p_fecha timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'GP2'
AS $function$
declare u record; v_uni numeric; v_ppk numeric; v_esp numeric; v_alerta text;
begin
  perform "GP2"._exigir_autorizado();  -- seguridad punto 1 fase B (2026-09-28)
  select * into u from rollo_uso where legajo=p_legajo and ts_fin is null
   order by ts_inicio desc limit 1;
  if u.id is null then
    return jsonb_build_object('ok',false,'error','No hay rollo abierto para el legajo '||p_legajo);
  end if;
  v_uni := coalesce(p_uni_producidas,
    (select coalesce(sum(uni),0) from produccion
      where legajo=p_legajo and fecha >= u.ts_inicio and fecha <= coalesce(p_fecha,now()) and uni > 0
        and coalesce(eliminar,'') <> 'S'));   -- (arreglo de Registro Producción 3.0) lo anulado no cuenta
  select partes_por_kilo_de_fleje into v_ppk from matriz
   where btrim(n_matriz) = btrim(coalesce(u.matriz_raw,'')) limit 1;
  v_esp := case when v_ppk is not null and v_ppk > 0 then u.kg_por_rollo * v_ppk end;
  if not p_quedo_resto and v_esp is not null then
    if v_uni < v_esp * 0.6 then
      v_alerta := 'Rollo terminado con '||round(v_uni)||' uni, pero un rollo de '||u.kg_por_rollo||
        ' kg deberia dar ~'||round(v_esp)||'. Diferencia grande: revisar.';
    elsif v_uni > v_esp * 1.4 then
      v_alerta := 'Rollo rindio '||round(v_uni)||' uni, bastante mas que las ~'||round(v_esp)||
        ' esperadas. Revisar el parametro piezas/kg.';
    end if;
  end if;
  update rollo_uso set ts_fin=coalesce(p_fecha,now()), quedo_resto=p_quedo_resto,
    uni_producidas=v_uni, uni_esperadas=v_esp where id=u.id;
  -- si quedo resto, el rollo vuelve al stock como devolucion parcial NO se puede
  -- cuantificar en rollos enteros: queda registrado en el uso, no en el ledger.
  return jsonb_build_object('ok',true,'uso_id',u.id,'kg_por_rollo',u.kg_por_rollo,
    'uni_producidas',v_uni,'uni_esperadas',v_esp,'quedo_resto',p_quedo_resto,'alerta',v_alerta);
end $function$;

-- 3b) registro_operarios_bundle: igual que hoy + `rollos_antiduplicado` + los kg usados no cuentan lo anulado --------------------------
CREATE OR REPLACE FUNCTION "GP2".registro_operarios_bundle()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'GP2'
AS $function$
  select jsonb_build_object(
    'rollos_antiduplicado', true,   -- (arreglo de Registro Producción 3.0) la tablet usa rollo_tomar / rollo_cerrar con id
    'registro_en_golpes', (select coalesce((select valor from "GP2".parametro where clave='registro_en_golpes'),'1') = '1'),
    'empleados', (select coalesce(jsonb_object_agg(e.legajo, jsonb_build_object(
        'nombre',e.nombre,'activo',e.activo,'hora_entrada',e.hora_entrada)),'{}'::jsonb)
      from "GP2".empleado e),
    'matrices', (select coalesce(jsonb_agg(jsonb_build_object(
        'n',m.n_matriz,'d',m.descripcion,'ppk',m.partes_por_kilo_de_fleje,
        'uxg',m.uni_x_golpe,'maq',m.maquina,'act',m.activa) order by m.n_matriz),'[]'::jsonb)
      from "GP2".matriz m),
    'matriz_fleje', (select coalesce(jsonb_object_agg(q.n_matriz, jsonb_build_object(
        'comp_id',q.comp_id,'codigo',q.codigo,'descripcion',q.descripcion)),'{}'::jsonb)
      from (
        select distinct on (m.n_matriz) m.n_matriz, c.id comp_id, c.codigo, c.descripcion
        from "GP2".matriz m
        join "GP2".ruta_paso rp on rp.matriz_id=m.id and rp.tipo_paso='matriz' and rp.comp_entrada_id is not null
        join "GP2".componente c on c.id=rp.comp_entrada_id and c.sector_id=5
        order by m.n_matriz, c.id
      ) q),
    -- El fleje que le toca a CADA pieza de salida. Solo importa donde una matriz corta
    -- de mas de un fleje, pero se manda siempre: la app prefiere esto cuando hay pieza
    -- elegida y cae a 'matriz_fleje' si no lo encuentra.
    'matriz_fleje_pieza', (select coalesce(jsonb_object_agg(t.n_matriz, t.porpieza),'{}'::jsonb)
      from (
        select q.n_matriz,
               jsonb_object_agg(q.comp_salida_id::text, jsonb_build_object(
                 'comp_id',q.comp_id,'codigo',q.codigo,'descripcion',q.descripcion)) porpieza
        from (
          select distinct on (m.n_matriz, rp.comp_salida_id)
                 m.n_matriz, rp.comp_salida_id, c.id comp_id, c.codigo, c.descripcion
          from "GP2".matriz m
          join "GP2".ruta_paso rp on rp.matriz_id=m.id and rp.tipo_paso='matriz'
               and rp.comp_entrada_id is not null and rp.comp_salida_id is not null
          join "GP2".componente c on c.id=rp.comp_entrada_id and c.sector_id=5
          order by m.n_matriz, rp.comp_salida_id, c.id
        ) q
        group by q.n_matriz
      ) t),
    -- Matrices que producen MAS de una pieza: la app pregunta cual se fabrica
    -- y manda comp_salida_id en el evento C para que el stock vaya al lugar correcto.
    -- 'etiqueta' (GP2.matriz_salida_etiqueta, 2026-10-07) = lo UNICO que ve el operario en cada opcion;
    -- 'orden' define el orden en pantalla. Sin fila, la tablet cae a codigo + descripcion + arts.
    'matriz_salidas', (select coalesce(jsonb_object_agg(t.n_matriz, t.salidas),'{}'::jsonb)
      from (
        select m.n_matriz,
               jsonb_agg(jsonb_build_object('comp_id',q.comp_salida_id,'codigo',q.codigo,'descripcion',q.descripcion,'arts',q.arts,'etiqueta',e.etiqueta)
                         order by coalesce(e.orden, 9999), q.codigo) salidas
        from (
          select rp.matriz_id, rp.comp_salida_id, c.codigo, c.descripcion,
                 string_agg(distinct a.codigo, ' · ' order by a.codigo) arts
          from "GP2".ruta_paso rp
          join "GP2".componente c on c.id=rp.comp_salida_id
          left join "GP2".ruta r on r.id=rp.ruta_id
          left join "GP2".articulo a on a.id=r.articulo_id
          where rp.tipo_paso='matriz' and rp.comp_salida_id is not null
          group by rp.matriz_id, rp.comp_salida_id, c.codigo, c.descripcion
        ) q
        join "GP2".matriz m on m.id=q.matriz_id
        left join "GP2".matriz_salida_etiqueta e on e.matriz_id=q.matriz_id and e.componente_id=q.comp_salida_id
        group by m.n_matriz
        having count(*) > 1
      ) t),
    -- ENVASADO: matriz que cierra un articulo TERMINADO (sector 12). El operario carga CAJAS y
    -- la app convierte a unidades (cajas x articulos_por_caja) para que fabricar_stock descuente
    -- el BOM de esas unidades. 'salidas' = art/caja por cada comp_salida; 'unica' = art/caja
    -- cuando la matriz cierra un solo articulo (no hace falta elegir pieza). 2026-10-02.
    'envasado', (select coalesce(jsonb_object_agg(q.n_matriz, q.obj),'{}'::jsonb)
      from (
        select n_matriz,
               jsonb_build_object(
                 'unica', case when count(*)=1 then max(apc) end,
                 'salidas', jsonb_object_agg(sid::text, apc)
               ) obj
        from (
          select distinct m.n_matriz, rp.comp_salida_id sid, a.articulos_por_caja apc
          from "GP2".matriz m
          join "GP2".ruta_paso rp on rp.matriz_id=m.id and rp.tipo_paso='matriz' and rp.comp_salida_id is not null
          join "GP2".componente cs on cs.id=rp.comp_salida_id and cs.sector_id=12
          join "GP2".articulo a on a.codigo=cs.codigo
        ) d
        group by n_matriz
      ) q),
    'rollos_saldo', (select coalesce(jsonb_agg(jsonb_build_object(
        'comp_id',v.componente_id,'codigo',v.codigo,'kg_por_rollo',v.kg_por_rollo,'rollos',v.rollos)
        order by v.codigo, v.kg_por_rollo),'[]'::jsonb)
      from "GP2".v_rollo_saldo v where v.rollos <> 0),
    -- Usos de rollo ABIERTOS (ts_fin null): kg usados calculados con lo YA registrado
    -- en produccion; la app suma encima solo lo que tiene en cola sin sincronizar.
    'rollos_abiertos', (select coalesce(jsonb_object_agg(u.legajo, jsonb_build_object(
        'uso_id',u.id,'comp_id',u.componente_id,'codigo',c.codigo,
        'kg_por_rollo',u.kg_por_rollo,'matriz',u.matriz_raw,'ts_inicio',u.ts_inicio,
        'kg_usados', case when m.partes_por_kilo_de_fleje > 0 then round(
            (coalesce((select sum(p.uni) from "GP2".produccion p
                       where p.legajo=u.legajo and p.fecha >= u.ts_inicio and p.uni > 0
                         and coalesce(p.eliminar,'') <> 'S'),0)   -- (arreglo de Registro Producción 3.0) lo anulado no cuenta
            / m.partes_por_kilo_de_fleje)::numeric, 2) else 0 end)),'{}'::jsonb)
      from "GP2".rollo_uso u
      join "GP2".componente c on c.id=u.componente_id
      left join "GP2".matriz m on btrim(m.n_matriz)=btrim(coalesce(u.matriz_raw,''))
      where u.ts_fin is null)
  );
$function$;
