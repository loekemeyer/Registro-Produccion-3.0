-- VERIFICACIÓN (no escribe nada): ¿cada función de GP2 que usaba la tablet tiene su par en Registro Producción 3.0, y hace lo mismo?
-- [Elías, 08/10/2026: «verificá que todas las funciones de GP2 tengan la función correspondiente en Reg Prod 3.0»]
--
-- Cada bloque corre las dos versiones con los MISMOS datos dentro de una transacción y al final tira un error con el resultado:
-- el error deshace todo (filas, stock, rollos). Se puede correr por MCP execute_sql o en el SQL Editor; el resultado es el texto
-- del error («RESULTADO {...}»). Usa el legajo 94, las matrices 10, 14, 1, 318 y 114, y el fleje 195 de 45 kg (había 2 rollos).
--
-- Pares (la tablet vieja de GP2 e110890 llamaba a 7 funciones):
--   GP2.registro_operarios_bundle()  -> reg_prod_3_0.reg_prod_3_0_bundle(pase, equipo)
--   GP2.registrar_evento_prod(p)     -> reg_prod_3_0.reg_prod_3_0_registrar_evento(pase, equipo, p)
--   GP2.anular_evento_prod(id)       -> reg_prod_3_0.reg_prod_3_0_anular_evento(pase, equipo, id)
--   GP2.rollo_tomar(id, …)           -> reg_prod_3_0.reg_prod_3_0_rollo_tomar(pase, equipo, id, …)   (por dentro llama a GP2.tomar_rollo)
--   GP2.rollo_cerrar(id, …)          -> reg_prod_3_0.reg_prod_3_0_rollo_cerrar(pase, equipo, id, …)  (por dentro, GP2.cerrar_rollo)
--   GP2.tomar_rollo / cerrar_rollo (sin id) -> sin par propio a propósito: 3.0 usa siempre las de id; las de GP2 las usa por dentro.
--
-- Resultado del 08/10/2026 (todo IGUAL):
--   · eventos (E, C por golpes con 1 y 2 por golpe, C envasado por unidades, C con pieza elegida, C sin pieza en matriz de 2 salidas,
--     PB tiempo muerto): misma fila (unidades, golpes, premio, tiempo_toma, histórico, horas, segundos, día/mes/quincena, matriz,
--     cantidad de movimientos), mismo movimiento de stock, mismo aviso, el mismo id dos veces no mueve nada, y anular devuelve lo
--     mismo (en envasado queda una fila de inventario nueva en 0 en los dos: no es diferencia);
--   · catálogo: las 10 secciones de GP2 idénticas; 3.0 agrega `rollos_activos`;
--   · rollos: tomar descuenta 1 rollo en los dos, el uso abierto y el cerrado quedan iguales, la respuesta de cerrar es la misma y el
--     id repetido devuelve dup en los dos.
-- Diferencias A PROPÓSITO (no son errores): 3.0 pide el pase del código de la TV (GP2, la sesión de Google); 3.0 guarda además la
-- cruda y llena segundos_historico; los kg del rollo y cerrar_rollo de 3.0 cuentan también lo cargado en 3.0.

-- 1) eventos: registrar, repetir y anular
do $$
declare
  disp text := 'verificacion-gp2-vs-3-0'; pase text; sal114 bigint; casos jsonb;
  c jsonb; p jsonb; r1 jsonb; r2 jsonb; r3 jsonb; r4 jsonb; rd1 jsonb; rd2 jsonb; id1 text; id2 text;
  inv0 jsonb; inv1 jsonb; inv2 jsonb; inv3 jsonb; inv5 jsonb; d1 jsonb; d2 jsonb; dfin jsonb; f1 jsonb; f2 jsonb;
  res jsonb := '[]'::jsonb;
begin
  pase := reg_prod_3_0.reg_prod_3_0_pase_emitir(disp) ->> 'pase';
  select min(rp.comp_salida_id) into sal114 from "GP2".ruta_paso rp join "GP2".matriz m on m.id = rp.matriz_id
   where m.n_matriz = '114' and rp.tipo_paso = 'matriz' and rp.comp_salida_id is not null;
  casos := jsonb_build_array(
    jsonb_build_object('n','E entrada 10','op','E','p',jsonb_build_object('matriz','10','uni',0,'hora_fin','12:20:00')),
    jsonb_build_object('n','C golpes 14 (2 por golpe)','op','C','p',jsonb_build_object('matriz','14','golpes',100,'hora_inicio','09:00:00','hora_fin','09:10:00','segundos_trabajados',600)),
    jsonb_build_object('n','C golpes 1 (1 por golpe)','op','C','p',jsonb_build_object('matriz','1','golpes',200,'hora_inicio','09:00:00','hora_fin','09:05:00','segundos_trabajados',300)),
    jsonb_build_object('n','C envasado 318 (uni)','op','C','p',jsonb_build_object('matriz','318','uni',24,'hora_inicio','09:00:00','hora_fin','09:10:00','segundos_trabajados',600)),
    jsonb_build_object('n','C 114 con pieza','op','C','p',jsonb_build_object('matriz','114','golpes',50,'comp_salida_id',sal114,'hora_inicio','09:00:00','hora_fin','09:20:00','segundos_trabajados',1200)),
    jsonb_build_object('n','C 114 sin pieza (2 salidas)','op','C','p',jsonb_build_object('matriz','114','golpes',50,'hora_inicio','09:00:00','hora_fin','09:20:00','segundos_trabajados',1200)),
    jsonb_build_object('n','PB tiempo muerto','op','PB','p',jsonb_build_object('matriz','PB','uni',0,'nombre_matriz','Parada Balancin','hora_inicio','10:00:00','hora_fin','10:05:00','segundos_tiempo_muerto',300)));
  for c in select * from jsonb_array_elements(casos) loop
    p := (c->'p') || jsonb_build_object('legajo','94','fecha','2026-10-08T12:20:00-03:00');
    id1 := 'verif-gp2-' || gen_random_uuid(); id2 := 'verif-30-' || gen_random_uuid();
    select jsonb_object_agg(id::text, cantidad) into inv0 from "GP2".inventario;
    r1 := "GP2".registrar_evento_prod(p || jsonb_build_object('id_ejecucion', id1));
    select jsonb_object_agg(id::text, cantidad) into inv1 from "GP2".inventario;
    r2 := reg_prod_3_0.reg_prod_3_0_registrar_evento(pase, disp, p || jsonb_build_object('id_ejecucion', id2,
            'toque', jsonb_build_object('id', id2, 'opcion', c->>'op', 'descripcion', '', 'texto', '', 'ts_event', p->>'fecha', 'app_version', 'verificacion')));
    select jsonb_object_agg(id::text, cantidad) into inv2 from "GP2".inventario;
    rd1 := "GP2".registrar_evento_prod(p || jsonb_build_object('id_ejecucion', id1));
    rd2 := reg_prod_3_0.reg_prod_3_0_registrar_evento(pase, disp, p || jsonb_build_object('id_ejecucion', id2,
            'toque', jsonb_build_object('id', id2, 'opcion', c->>'op', 'descripcion', '', 'texto', '', 'ts_event', p->>'fecha', 'app_version', 'verificacion')));
    select jsonb_object_agg(id::text, cantidad) into inv3 from "GP2".inventario;
    select coalesce(jsonb_object_agg(k, round(coalesce((inv1->>k)::numeric,0) - coalesce((inv0->>k)::numeric,0), 4))
             filter (where coalesce((inv1->>k)::numeric,0) <> coalesce((inv0->>k)::numeric,0)), '{}') into d1
      from (select jsonb_object_keys(inv0) union select jsonb_object_keys(inv1)) t(k);
    select coalesce(jsonb_object_agg(k, round(coalesce((inv2->>k)::numeric,0) - coalesce((inv1->>k)::numeric,0), 4))
             filter (where coalesce((inv2->>k)::numeric,0) <> coalesce((inv1->>k)::numeric,0)), '{}') into d2
      from (select jsonb_object_keys(inv1) union select jsonb_object_keys(inv2)) t(k);
    select to_jsonb(x) into f1 from (select matriz_id, nombre_matriz, round(uni::numeric,4) uni, golpes, uni_x_golpe, round(premio::numeric,2) premio,
        round(tiempo_toma::numeric,4) tiempo_toma, round(tiempo_historico::numeric,4) th, hora_inicio, hora_fin, segundos_trabajados,
        segundos_tiempo_muerto, dia, mes, quincena, coalesce(array_length(movimientos,1),0) nmov from "GP2".produccion where id_ejecucion = id1) x;
    select to_jsonb(x) into f2 from (select matriz_id, nombre_matriz, round(uni::numeric,4) uni, golpes, uni_x_golpe, round(premio::numeric,2) premio,
        round(tiempo_toma::numeric,4) tiempo_toma, round(tiempo_historico::numeric,4) th, hora_inicio, hora_fin, segundos_trabajados,
        segundos_tiempo_muerto, dia, mes, quincena, coalesce(array_length(movimientos,1),0) nmov from reg_prod_3_0.procesado_cervantes where id_ejecucion = id2) x;
    r3 := "GP2".anular_evento_prod(id1);
    r4 := reg_prod_3_0.reg_prod_3_0_anular_evento(pase, disp, id2);
    select jsonb_object_agg(id::text, cantidad) into inv5 from "GP2".inventario;
    select coalesce(jsonb_object_agg(k, coalesce((inv5->>k)::numeric,0) - coalesce((inv0->>k)::numeric,0))
             filter (where coalesce((inv5->>k)::numeric,0) <> coalesce((inv0->>k)::numeric,0)), '{}') into dfin
      from (select jsonb_object_keys(inv0) union select jsonb_object_keys(inv5)) t(k);
    res := res || jsonb_build_object('caso', c->>'n',
      'fila_igual', f1 = f2, 'fila_gp2', case when f1 <> f2 then f1 end, 'fila_30', case when f1 <> f2 then f2 end,
      'stock_igual', d1 = d2, 'mueve_stock', d1 <> '{}'::jsonb, 'aviso_igual', (r1->>'aviso') is not distinct from (r2->>'aviso'),
      'dup_no_mueve', (rd1->>'dup')::boolean and (rd2->>'dup')::boolean and inv3 = inv2,
      'anular_igual', (r3->>'movimientos_revertidos') = (r4->>'movimientos_revertidos'), 'stock_vuelve', dfin = '{}'::jsonb);
  end loop;
  raise exception 'RESULTADO %', res;
end $$;

-- 2) catálogo y rollos
do $$
declare
  disp text := 'verificacion-gp2-vs-3-0'; pase text; bg jsonb; b3 jsonb; k text;
  dif_bundle jsonb := '[]'::jsonb; solo_30 jsonb := '[]'::jsonb;
  s0 numeric; s1 numeric; s2 numeric; s3 numeric; s4 numeric;
  ra jsonb; ra2 jsonb; rb jsonb; rb2 jsonb; rc jsonb; rc2 jsonb; rd jsonb; rd2 jsonb; ua jsonb; uc jsonb; ub jsonb; ud jsonb;
  ida text := 'verif-gp2-t-' || gen_random_uuid(); idb text := 'verif-gp2-c-' || gen_random_uuid();
  idc text := 'verif-30-t-' || gen_random_uuid(); idd text := 'verif-30-c-' || gen_random_uuid();
begin
  pase := reg_prod_3_0.reg_prod_3_0_pase_emitir(disp) ->> 'pase';
  bg := "GP2".registro_operarios_bundle();
  b3 := reg_prod_3_0.reg_prod_3_0_bundle(pase, disp);
  for k in select jsonb_object_keys(bg) loop
    if (bg->k) is distinct from (b3->k) then dif_bundle := dif_bundle || to_jsonb(k); end if;
  end loop;
  for k in select jsonb_object_keys(b3) loop
    if not bg ? k then solo_30 := solo_30 || jsonb_build_object(k, b3->k); end if;
  end loop;
  select coalesce(sum(rollos),0) into s0 from "GP2".v_rollo_saldo where componente_id = 195 and kg_por_rollo = 45;
  ra  := "GP2".rollo_tomar(ida, '94', 195, 45, '14', now() - interval '4 hours');
  ra2 := "GP2".rollo_tomar(ida, '94', 195, 45, '14', now() - interval '4 hours');
  select coalesce(sum(rollos),0) into s1 from "GP2".v_rollo_saldo where componente_id = 195 and kg_por_rollo = 45;
  select jsonb_build_object('comp', componente_id, 'kg', kg_por_rollo, 'matriz', matriz_raw) into ua from "GP2".rollo_uso where legajo = '94' and ts_fin is null;
  rb  := "GP2".rollo_cerrar(idb, '94', false, null, now() - interval '3 hours');
  rb2 := "GP2".rollo_cerrar(idb, '94', false, null, now() - interval '3 hours');
  select jsonb_build_object('quedo_resto', quedo_resto, 'uni', uni_producidas, 'esp', uni_esperadas) into ub from "GP2".rollo_uso where legajo = '94' and ts_fin is not null order by id desc limit 1;
  select coalesce(sum(rollos),0) into s2 from "GP2".v_rollo_saldo where componente_id = 195 and kg_por_rollo = 45;
  rc  := reg_prod_3_0.reg_prod_3_0_rollo_tomar(pase, disp, idc, '94', 195, 45, '14', now() - interval '2 hours');
  rc2 := reg_prod_3_0.reg_prod_3_0_rollo_tomar(pase, disp, idc, '94', 195, 45, '14', now() - interval '2 hours');
  select coalesce(sum(rollos),0) into s3 from "GP2".v_rollo_saldo where componente_id = 195 and kg_por_rollo = 45;
  select jsonb_build_object('comp', componente_id, 'kg', kg_por_rollo, 'matriz', matriz_raw) into uc from "GP2".rollo_uso where legajo = '94' and ts_fin is null;
  rd  := reg_prod_3_0.reg_prod_3_0_rollo_cerrar(pase, disp, idd, '94', false, now() - interval '1 hours');
  rd2 := reg_prod_3_0.reg_prod_3_0_rollo_cerrar(pase, disp, idd, '94', false, now() - interval '1 hours');
  select jsonb_build_object('quedo_resto', quedo_resto, 'uni', uni_producidas, 'esp', uni_esperadas) into ud from "GP2".rollo_uso where legajo = '94' and ts_fin is not null order by id desc limit 1;
  select coalesce(sum(rollos),0) into s4 from "GP2".v_rollo_saldo where componente_id = 195 and kg_por_rollo = 45;
  raise exception 'RESULTADO %', jsonb_build_object(
    'bundle_claves_gp2', (select count(*) from jsonb_object_keys(bg)), 'bundle_claves_distintas', dif_bundle, 'bundle_solo_en_30', solo_30,
    'tomar_descuenta_gp2', s1 - s0, 'tomar_descuenta_30', s3 - s2, 'cerrar_mueve_gp2', s2 - s1, 'cerrar_mueve_30', s4 - s3,
    'uso_abierto_igual', ua = uc, 'uso_cerrado_igual', ub = ud,
    'resp_tomar_igual', (ra - 'uso_id' - 'evento_id' - 'saldo_anterior' - 'saldo_nuevo') = (rc - 'uso_id' - 'evento_id' - 'saldo_anterior' - 'saldo_nuevo'),
    'resp_cerrar_igual', (rb - 'uso_id') = (rd - 'uso_id'),
    'dup_tomar', jsonb_build_array(ra2->'dup', rc2->'dup'), 'dup_cerrar', jsonb_build_array(rb2->'dup', rd2->'dup'));
end $$;
