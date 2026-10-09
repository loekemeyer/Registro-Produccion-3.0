-- ESTADO: APLICADO el 09/10/2026 (MCP execute_sql), con el «sí» de Elías. Probado en transacción deshecha: 177 en 2.0 → 0,99 deja GP2 en 0,99.
-- Registro Producción 3.0 — FASE 3d · el tiempo histórico de 2.0 (public."Matrices") se copia solo a "GP2".matriz
-- [Elías, 09/10: «tienen que estar iguales; el de 2.0 está actualizado» — y en los 2 casos al revés: «actualizá el de 2.0»].
-- 3.0 calcula el premio con "GP2".matriz.tiempo_historico; los tiempos se corrigen en el admin de 2.0 (Gestión Productiva Entero).
-- Reemplaza a la fase 3c (que 3.0 leyera Matrices), que queda DESCARTADA.
-- Las matrices que existen sólo en 2.0 (325C, 513: GP2 arma las variantes a su manera) no tienen fila en GP2: el trigger no hace nada.

-- datos (antes de crear el trigger): los 2 que 2.0 tenía peor que GP2
update public."Matrices" set "Tiempo_Historico" = 0.73, "updatedAt" = now() where btrim("N_Matriz") = '177' and coalesce("Tiempo_Historico", 0) = 0;  -- 1 fila
update public."Matrices" set "Tiempo_Historico" = 22,   "updatedAt" = now() where btrim("N_Matriz") = '514' and "Tiempo_Historico" is null;         -- 1 fila
-- (antes, con el «sí» de Elías: los 9 que GP2 tenía en 0/vacío se copiaron de 2.0: 509, 512, 64, 182, 63, 21, 325B, 361, 62)

create or replace function reg_prod_3_0.reg_prod_3_0_tiempo_a_gp2() returns trigger language plpgsql
security definer set search_path to '' as $$
begin
  update "GP2".matriz set tiempo_historico = new."Tiempo_Historico"
   where btrim(n_matriz) = btrim(new."N_Matriz")
     and tiempo_historico is distinct from new."Tiempo_Historico"::numeric;
  return null;
end $$;
revoke all on function reg_prod_3_0.reg_prod_3_0_tiempo_a_gp2() from public, anon, authenticated;
create trigger reg_prod_3_0_tiempo_a_gp2 after insert or update of "Tiempo_Historico"
  on public."Matrices" for each row execute function reg_prod_3_0.reg_prod_3_0_tiempo_a_gp2();
