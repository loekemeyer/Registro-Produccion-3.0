-- ESTADO: APLICADO el 09/10/2026 (MCP execute_sql), con el «sí» de Elías («1 a b si», «3 si»). Verificado: 19 operarios (18 de la
-- liquidación + el 0 de pruebas), 16 filas de permisos (6 con botones: 245 y c92 piedra · c19 alimentador+CM · c91 y 203 matricería+CM ·
-- 233 piedra+CM+MM), anon no ve las tablas. Trigger probado en transacción deshecha: baja de c19 borra operario y permisos; alta lo vuelve.
-- Registro Producción 3.0 — FASE 3e · los operarios de 3.0 salen de la liquidación de Planify (activo y de planta), sólo legajo y nombre
-- [Elías, 09/10: «que tome los operarios otra tabla y que planify, admin al hacer alta o baja en supa active un trigger para actualizar
--  esta tabla» · «sólo tiene que tomar el legajo y el nombre de la persona. no queremos filtrar datos a través de esta tabla» · «se borra»].
-- Legajo con su letra (c = CHEF SRL), en minúscula: es el legajo verdadero [Elías: «guarda su legajo verdadero»].
-- Los permisos van aparte, por legajo, y se borran con la baja (un número que se reasigna no hereda los botones del anterior: el 282).
-- TODAVÍA NO LO USA LA APP: el bundle y registrar_evento siguen con "GP2".empleado + public."Empleados" hasta el cambio de la app.

-- A) los 5 activos en GP2 que no están en Planify, de baja [«5 si»]
update "GP2".empleado set activo = false where activo and legajo in ('251','400','401','402','271');                 -- 5 filas
update public."Empleados" set "Activo" = 'NO', "updatedAt" = now()
 where "Activo" = 'SI' and btrim("Legajo"::text) in ('251','400','401','402','271');                                    -- 5 filas

-- B) tablas
create table reg_prod_3_0.operario (legajo text primary key, nombre text not null);
create table reg_prod_3_0.operario_permiso (
  legajo text primary key references reg_prod_3_0.operario(legajo) on delete cascade,
  es_matriceria bool not null default false, es_piedra bool not null default false, es_alimentador bool not null default false,
  ve_cm bool not null default false, ve_trm bool not null default false, ve_tl bool not null default false,
  ve_rem bool not null default false, ve_mm bool not null default false);
alter table reg_prod_3_0.operario enable row level security;
alter table reg_prod_3_0.operario_permiso enable row level security;
revoke all on reg_prod_3_0.operario, reg_prod_3_0.operario_permiso from public, anon, authenticated;

insert into reg_prod_3_0.operario (legajo, nombre)
select distinct on (lower(btrim(legajo))) lower(btrim(legajo)), btrim(nombre)
  from planify.empleados_liquidacion where activo and tipo_empleado = 'planta';                                        -- 18 filas
insert into reg_prod_3_0.operario_permiso
select lower(btrim(l.legajo)), o.es_matriceria, o.es_piedra, o.es_alimentador, o.ve_cm, o.ve_trm, o.ve_tl, o.ve_rem, o.ve_mm
  from "GP2".operario o join planify.empleados_liquidacion l on l.employee_id = o.employee_id and l.activo and l.tipo_empleado = 'planta'
 on conflict do nothing;                                                                                               -- 16 filas
insert into reg_prod_3_0.operario (legajo, nombre) values ('0', 'Pruebas (legajo 0)');   -- a mano: no viene de la liquidación

create function reg_prod_3_0.reg_prod_3_0_operario_sync() returns trigger language plpgsql security definer set search_path to '' as $$
declare v text;
begin
  if tg_op in ('UPDATE','DELETE') then
    v := lower(btrim(old.legajo));
    if not exists (select 1 from planify.empleados_liquidacion l where lower(btrim(l.legajo)) = v and l.activo and l.tipo_empleado = 'planta') then
      delete from reg_prod_3_0.operario where legajo = v;
    end if;
  end if;
  if tg_op in ('INSERT','UPDATE') and new.activo and new.tipo_empleado = 'planta' then
    insert into reg_prod_3_0.operario (legajo, nombre) values (lower(btrim(new.legajo)), btrim(new.nombre))
    on conflict (legajo) do update set nombre = excluded.nombre;
  end if;
  return null;
end $$;
revoke all on function reg_prod_3_0.reg_prod_3_0_operario_sync() from public, anon, authenticated;
create trigger reg_prod_3_0_operario_sync after insert or update or delete on planify.empleados_liquidacion
  for each row execute function reg_prod_3_0.reg_prod_3_0_operario_sync();
