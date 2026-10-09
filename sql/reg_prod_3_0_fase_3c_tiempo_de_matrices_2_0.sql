-- ESTADO: DESCARTADO (09/10/2026), nunca aplicado. Lo reemplaza la fase 3d: el tiempo de 2.0 se copia solo a GP2 y 3.0 sigue leyendo GP2.
-- Registro Producción 3.0 — FASE 3c · el tiempo histórico y las unidades por golpe salen de public."Matrices", como en 2.0
-- [Elías, 09/10: «3.0 de Cervantes tiene que hacer lo mismo que Reg Prod 2.0 — no estamos hablando de Gestión Productiva»;
--  los tiempos se cambian «actualmente en 2.0»].
--
-- Hoy reg_prod_3_0_registrar_evento toma tiempo_historico y uni_x_golpe de "GP2".matriz; 2.0 los toma de public."Matrices".
-- Se agrega, justo después de esa lectura, la de Matrices, que manda cuando la matriz existe ahí:
--   tiempo_historico = Matrices."Tiempo_Historico" (aunque sea 0: en 2.0 un 0 es «sin premio» y así queda)
--   uni_x_golpe      = Matrices."Uni_X_Golpe" si es > 0 (en 2.0 un 0 se lee como 1; GP2 guarda 1)
-- Diferencias reales al 09/10: tiempo, sólo la 177 (GP2 0,73 / 2.0 0); unidades por golpe, sólo la 344 (GP2 4 / 2.0 3).
-- El id de la matriz (stock) y el nombre siguen saliendo de GP2: no cambian.

do $$
declare
  d text; n int;
  viejo constant text := 'from "GP2".matriz where btrim(n_matriz) = v_mat limit 1;';
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p
   where p.pronamespace = 'reg_prod_3_0'::regnamespace and p.proname = 'reg_prod_3_0_registrar_evento';
  if strpos(d, 'public."Matrices"') > 0 then raise exception 'registrar_evento ya lee Matrices (fase 3c aplicada)'; end if;
  n := (length(d) - length(replace(d, viejo, ''))) / length(viejo);
  if n <> 1 then raise exception 'registrar_evento: «%» aparece % veces', viejo, n; end if;
  execute replace(d, viejo, viejo || '
  -- fase 3c: el tiempo y las unidades por golpe, de public."Matrices" como Registro Producción 2.0
  -- (bloque propio: un SELECT INTO sin fila pondría NULL; si la matriz no está en Matrices queda lo de GP2)
  declare x_th numeric; x_uxg numeric;
  begin
    select m."Tiempo_Historico"::numeric, nullif(m."Uni_X_Golpe", 0)::numeric into x_th, x_uxg
      from public."Matrices" m where btrim(m."N_Matriz") = v_mat limit 1;
    if found then
      v_th := x_th;
      v_uxg := coalesce(x_uxg, v_uxg);
    end if;
  end;');
end $$;
