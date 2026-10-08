-- ESTADO: NO APLICADO (08/10/2026). Va por el SQL Editor de Supabase (tiene DELETE y DROP: la herramienta de Claude se cuelga).
-- Registro Producción 3.0 · limpieza final de lo que quedó de las pruebas [Elías: «cuando terminemos» → 08/10: «si»].
--
-- Medido en la base el 08/10 antes de escribir esto:
--   · 2 toques de prueba de la Fase 1b (prueba-1b-e1, prueba-1b-c1; legajo 1). NO movieron stock (movimientos vacío: la 1b
--     todavía no tocaba stock). Salen también de las vistas reg_prod_3_0.crudo y reg_prod_3_0.produccion_gp2.
--   · 3 ingresos de prueba (app = 'prueba', ids 10, 11 y 12; equipo prueba-disp-9). Ninguna fila de auditoria los apunta.
--   · 1 llamada de rollo de prueba (prueba-1d-cerrar-1): no cerró nada («No hay rollo abierto para el legajo 1»).
--   · 5 funciones sin uso:
--       public.reg_prod_3_0_alerta_dispositivo_multi_telegram · public.reg_prod_3_0_ingreso_log · public.reg_prod_3_0_ip
--         (las copias viejas de public; el cron y las apps usan las de reg_prod_3_0; ninguna función las llama);
--       reg_prod_3_0.reg_prod_3_0_tomar_rollo (Fase 1c, sin id: la app usa _rollo_tomar desde v3.1.7 y ninguna función la llama);
--       reg_prod_3_0.reg_prod_3_0_envasado_articulos (ninguna app la llama: GP2 cambió los nombres por la etiqueta).
-- Lo que NO se borra, a propósito:
--   · reg_prod_3_0.reg_prod_3_0_cerrar_rollo: la usa por dentro reg_prod_3_0_rollo_cerrar (la anti-duplicado).
--   · public.reg_prod_3_0_cerv_ingresar y public.reg_prod_3_0_registrar_ingreso: las llaman la app vieja cervantes/ y Virgilio.
-- Si algún número no coincide (alguien tocó algo), se cancela TODO y no se borra nada.

do $$
declare n int;
begin
  delete from reg_prod_3_0.procesado_cervantes
   where id_ejecucion in ('prueba-1b-e1', 'prueba-1b-c1') and movimientos is null;
  get diagnostics n = row_count;
  if n <> 2 then raise exception 'procesado_cervantes: se esperaban 2 toques de prueba y hay %', n; end if;

  delete from reg_prod_3_0.crudo_cervantes where id in ('prueba-1b-e1', 'prueba-1b-c1');
  get diagnostics n = row_count;
  if n <> 2 then raise exception 'crudo_cervantes: se esperaban 2 toques de prueba y hay %', n; end if;

  delete from reg_prod_3_0.reg_prod_3_0_ingresos where app = 'prueba' and id in (10, 11, 12);
  get diagnostics n = row_count;
  if n <> 3 then raise exception 'reg_prod_3_0_ingresos: se esperaban 3 ingresos de prueba y hay %', n; end if;

  delete from reg_prod_3_0.rollo_llamadas where id = 'prueba-1d-cerrar-1';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'rollo_llamadas: se esperaba 1 llamada de prueba y hay %', n; end if;

  drop function public.reg_prod_3_0_alerta_dispositivo_multi_telegram();
  drop function public.reg_prod_3_0_ingreso_log(text, text, text, text, boolean, text, boolean, text, text, text, jsonb);
  drop function public.reg_prod_3_0_ip();
  drop function reg_prod_3_0.reg_prod_3_0_tomar_rollo(text, text, text, bigint, numeric, text, timestamp with time zone);
  drop function reg_prod_3_0.reg_prod_3_0_envasado_articulos(text, text);
end $$;

-- Verificación (tiene que dar todo 0):
select (select count(*) from reg_prod_3_0.procesado_cervantes where id_ejecucion like 'prueba%') toques_prueba,
       (select count(*) from reg_prod_3_0.crudo_cervantes where id like 'prueba%') crudos_prueba,
       (select count(*) from reg_prod_3_0.reg_prod_3_0_ingresos where app = 'prueba') ingresos_prueba,
       (select count(*) from reg_prod_3_0.rollo_llamadas where id like 'prueba%') rollos_prueba,
       (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
         where (s.nspname = 'public' and p.proname in ('reg_prod_3_0_alerta_dispositivo_multi_telegram', 'reg_prod_3_0_ingreso_log', 'reg_prod_3_0_ip'))
            or (s.nspname = 'reg_prod_3_0' and p.proname in ('reg_prod_3_0_tomar_rollo', 'reg_prod_3_0_envasado_articulos'))) funciones;
