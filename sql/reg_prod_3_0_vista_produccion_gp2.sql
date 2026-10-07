-- ESTADO: NO APLICADO en la base (07/10/2026). Espera el "sí" de Elías.
-- Registro Producción 3.0 — la producción de 3.0 CON LA FORMA DE GP2.produccion, para que GP2 lea de acá
-- [Elías, 07/10/2026: «algo propio del schema de registro producción 3.0 y que después se modifica GP2 para leer de ahí»].
--
-- Es sólo una VISTA (no copia nada, no escribe nada): las mismas 26 columnas, con los mismos nombres y tipos que GP2.produccion,
-- sacadas de reg_prod_3_0.procesado_cervantes. Así un informe de GP2 puede hacer
--     select ... from "GP2".produccion  union all  select ... from reg_prod_3_0.produccion_gp2
-- sin cambiar nada más. Columna extra al final: `fuente` = 'reg_prod_3_0' (las de GP2.produccion no la tienen).
-- ⚠ Los `id` de acá son de otra secuencia: pueden repetir un id de GP2.produccion. Para editar o anular desde GP2 hay que mirar
--   `fuente` (o `id_ejecucion`, que sí es único entre los dos).
-- Cerrada a la API (anon / authenticated): la leen las funciones de GP2 (SECURITY DEFINER), no las pantallas directo.

create or replace view reg_prod_3_0.produccion_gp2 as
select p.id,
       p.fecha,
       p.legajo,
       p.nombre_empleado,
       p.matriz                       as matriz_raw,
       p.nombre_matriz,
       p.matriz_id,
       p.uni::real                    as uni,
       p.premio::double precision     as premio,
       p.tiempo_toma::real            as tiempo_toma,
       p.tiempo_historico::real       as tiempo_historico,
       p.hora_inicio,
       p.hora_fin,
       p.anular_tiempo,
       p.segundos_historico,
       p.segundos_trabajados,
       p.segundos_tiempo_muerto,
       p.dia,
       p.mes,
       p.quincena,
       p.id_ejecucion,
       p.eliminar,
       p.revisado,
       p.created_at                   as origen_created_at,
       p.golpes,
       p.uni_x_golpe,
       'reg_prod_3_0'::text           as fuente
  from reg_prod_3_0.procesado_cervantes p;

revoke all on reg_prod_3_0.produccion_gp2 from anon, authenticated;
