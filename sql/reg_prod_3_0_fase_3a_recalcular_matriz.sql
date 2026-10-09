-- ESTADO: PROPUESTO (09/10/2026), sin aplicar.
-- Registro Producción 3.0 — FASE 3a · public.recalcular_matriz también recalcula lo cargado en 3.0
-- [Elías, 09/10: «si tienen que leer que de momento lean todas» — los operarios pasan a 3.0 el martes 13/10].
--
-- Hoy recalcular_matriz(matriz, tiempo) sólo actualiza public.db_n8n_espejo (2.0). Se le agrega el mismo UPDATE sobre
-- reg_prod_3_0.procesado_cervantes, con la misma fórmula: en 3.0 segundos_trabajados ya es NETO (fase 2a), igual que en el espejo.
-- Nombres de 3.0: matriz, uni, segundos_trabajados, tiempo_historico, segundos_historico, tiempo_toma, premio, anular_tiempo, eliminar.
-- Devuelve la suma de filas tocadas en las dos tablas (antes: sólo el espejo).

create or replace function public.recalcular_matriz(p_matriz text, p_nuevo_tiempo numeric)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  updated integer := 0;
  n3 integer := 0;
begin
  update "db_n8n_espejo"
  set
    "Tiempo_Historico" = p_nuevo_tiempo,
    "Segundos_Historico" = p_nuevo_tiempo * "Uni",
    "Tiempo_Toma" = round(cast("Segundos_Trabajados"::numeric / "Uni" as numeric), 2),
    "Premio" = case
      when p_nuevo_tiempo > 0 then round(cast((-("Segundos_Trabajados"::numeric / "Uni" / p_nuevo_tiempo) + 1) * 10 as numeric), 2)
      else 0
    end,
    "Anular_Tiempo" = case when p_nuevo_tiempo > 0 then false else true end
  where "Matriz" = p_matriz
    and "Uni" > 0
    and ("Eliminar" is null or "Eliminar" != 'S');
  get diagnostics updated = row_count;

  -- Registro Producción 3.0 (fase 3a): lo mismo sobre lo procesado de Cervantes
  update reg_prod_3_0.procesado_cervantes
  set
    tiempo_historico   = p_nuevo_tiempo,
    segundos_historico = p_nuevo_tiempo * uni,
    tiempo_toma        = round(segundos_trabajados::numeric / uni, 2),
    premio             = case
      when p_nuevo_tiempo > 0 then round(((1 - segundos_trabajados::numeric / uni / p_nuevo_tiempo) * 10)::numeric, 2)
      else 0
    end,
    anular_tiempo      = case when p_nuevo_tiempo > 0 then false else true end
  where btrim(matriz) = btrim(p_matriz)
    and uni > 0
    and coalesce(eliminar, '') <> 'S';
  get diagnostics n3 = row_count;

  return updated + n3;
end;
$function$;
