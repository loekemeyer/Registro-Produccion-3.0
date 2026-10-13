-- ESTADO: APLICADO el 13/10/2026 (MCP execute_sql), con el «sí» de Elías («1 si»). Antes, compilado en una transacción deshecha.
-- Registro Producción 3.0 — FASE 3h · E con «empiezo con el cajón vacío»
-- [Elías, 13/10: «faltaría un tilde de si empiezo con el cajón vacío (no en caso de envasado y piedra)»].
--
-- La app (Cervantes v3.1.17) manda p.cajon_vacio = true en el E. La base pone en 0 el contador de cajón de la pieza
-- (reg_prod_3_0.contador_cajon), con las mismas condiciones que el C: la pieza es la elegida (comp_salida_id) o la única salida de la
-- matriz; no en matrices en kilos (la 501) ni en piezas sin uni_x_cajon o de envasado (sector 12). Si tenía algo, queda en la
-- auditoría ('cajon_vaciar', con cuánto había). No toca stock ni producción.
-- Cirugía sobre la definición viva: frena si el texto a reemplazar no aparece exactamente 1 vez.

do $$
declare d text; n int;
  ancla constant text := '  -- fuera de horario (por la hora del toque, no la de hoy): una fila por legajo y día';
  nuevo constant text := $n$  /* fase 3h: E con «empiezo con el cajón vacío»: el contador de la pieza vuelve a 0 */
  if coalesce(nullif(t->>'opcion', ''), v_mat) = 'E' and coalesce(p->>'cajon_vacio', 'false') = 'true' and v_mid is not null
     and lower(coalesce((select x.tiempo_unidad from "GP2".matriz x where x.id = v_mid), '')) <> 'kg' then
    v_salida := nullif(p->>'comp_salida_id', '')::bigint;
    if v_salida is null then
      select count(distinct comp_salida_id) into v_nsal
        from "GP2".ruta_paso where matriz_id = v_mid and tipo_paso = 'matriz' and comp_salida_id is not null;
      if v_nsal = 1 then
        select distinct comp_salida_id into v_salida from "GP2".ruta_paso
         where matriz_id = v_mid and tipo_paso = 'matriz' and comp_salida_id is not null;
      end if;
    end if;
    if v_salida is not null and exists (select 1 from "GP2".componente c
                                         where c.id = v_salida and c.uni_x_cajon > 0 and coalesce(c.sector_id, 0) <> 12) then
      insert into reg_prod_3_0.contador_cajon (comp_id, uni_actual) values (v_salida, 0) on conflict (comp_id) do nothing;
      select k.uni_actual into v_antes from reg_prod_3_0.contador_cajon k where k.comp_id = v_salida for update;
      update reg_prod_3_0.contador_cajon set uni_actual = 0, updated_at = now(), legajo = v_leg where comp_id = v_salida;
      v_cajon := jsonb_build_object('comp_id', v_salida, 'antes', coalesce(v_antes, 0), 'act', 0, 'vaciado', true);
      if coalesce(v_antes, 0) > 0 then
        insert into reg_prod_3_0.auditoria (tipo, app, legajo, dispositivo, ip, ok, detalle)
        values ('cajon_vaciar', 'cervantes', v_leg, left(p_dispositivo, 80), reg_prod_3_0.reg_prod_3_0_ip(), true,
                v_cajon || jsonb_build_object('id_ejecucion', v_id, 'matriz', v_mat));
      end if;
    end if;
  end if;

$n$;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p
   where p.pronamespace = 'reg_prod_3_0'::regnamespace and p.proname = 'reg_prod_3_0_registrar_evento';
  if strpos(d, 'fase 3h') > 0 then raise exception 'registrar_evento ya tiene la fase 3h'; end if;
  n := (length(d) - length(replace(d, ancla, ''))) / length(ancla);
  if n <> 1 then raise exception 'registrar_evento: el ancla aparece % veces', n; end if;
  execute replace(d, ancla, nuevo || ancla);
end $$;
