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

-- ============================================================================================================================
-- C) 09/10, el mismo día [Elías: «que el trigger busque bien y no pase lo de Kevin»]. APLICADO. Probado en transacción deshecha:
--    Kevin (504, Agencia, sin vínculo a planify.employees) baja en liquidación → sale, alta → vuelve · Eduardo (c19) baja SÓLO en
--    la ficha de Planify → sale, alta → vuelve · resync completo → 0 cambios (la tabla ya coincidía).
--    «Lo de Kevin» fue buscar en planify.employees y no en la liquidación. La regla única, en UNA función:
--      vale = activo y de planta en planify.empleados_liquidacion (legajo en minúscula, sin espacios)
--             y, si la fila está vinculada a planify.employees, ese empleado también activo.
--    Los 2 triggers (liquidación y employees) y un cron nocturno de red de seguridad llaman a la misma función.
--    ⚠ La baja borra también los permisos (decisión de Elías): una baja por error en Planify hace perder los botones.
-- ============================================================================================================================
create or replace function reg_prod_3_0.reg_prod_3_0_operario_resync(p_legajo text default null)
returns table(accion text, op_legajo text, op_nombre text) language plpgsql security definer set search_path to '' as $$
begin
  return query
  with fuente as (
    select distinct on (lower(btrim(l.legajo))) lower(btrim(l.legajo)) as leg, btrim(l.nombre) as nom
      from planify.empleados_liquidacion l
      left join planify.employees e on e.id = l.employee_id
     where l.activo and l.tipo_empleado = 'planta' and coalesce(btrim(l.legajo), '') <> ''
       and (l.employee_id is null or coalesce(e.activo, false))
       and (p_legajo is null or lower(btrim(l.legajo)) = lower(btrim(p_legajo)))
     order by lower(btrim(l.legajo)), l.updated_at desc nulls last
  ), borrados as (
    delete from reg_prod_3_0.operario o
     where o.legajo <> '0' and (p_legajo is null or o.legajo = lower(btrim(p_legajo)))
       and not exists (select 1 from fuente f where f.leg = o.legajo)
    returning 'baja'::text, o.legajo, o.nombre
  ), puestos as (
    insert into reg_prod_3_0.operario as o (legajo, nombre)
    select f.leg, f.nom from fuente f
     where not exists (select 1 from reg_prod_3_0.operario x where x.legajo = f.leg and x.nombre = f.nom)
    on conflict on constraint operario_pkey do update set nombre = excluded.nombre
    returning 'alta o nombre'::text, o.legajo, o.nombre
  )
  select * from borrados union all select * from puestos;
end $$;
revoke all on function reg_prod_3_0.reg_prod_3_0_operario_resync(text) from public, anon, authenticated;

create or replace function reg_prod_3_0.reg_prod_3_0_operario_sync() returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if tg_op in ('UPDATE','DELETE') and coalesce(btrim(old.legajo), '') <> '' then perform reg_prod_3_0.reg_prod_3_0_operario_resync(old.legajo); end if;
  if tg_op in ('INSERT','UPDATE') and coalesce(btrim(new.legajo), '') <> '' then perform reg_prod_3_0.reg_prod_3_0_operario_resync(new.legajo); end if;
  return null;
end $$;

create or replace function reg_prod_3_0.reg_prod_3_0_operario_sync_emp() returns trigger language plpgsql security definer set search_path to '' as $$
declare r record;
begin
  for r in select l.legajo from planify.empleados_liquidacion l
            where l.employee_id = (case when tg_op = 'DELETE' then old.id else new.id end) and coalesce(btrim(l.legajo), '') <> '' loop
    perform reg_prod_3_0.reg_prod_3_0_operario_resync(r.legajo);
  end loop;
  return null;
end $$;
revoke all on function reg_prod_3_0.reg_prod_3_0_operario_sync_emp() from public, anon, authenticated;
create trigger reg_prod_3_0_operario_sync_emp after update of activo or delete on planify.employees
  for each row execute function reg_prod_3_0.reg_prod_3_0_operario_sync_emp();

select cron.schedule('reg-prod-3-0-operarios-resync', '10 6 * * *', 'select reg_prod_3_0.reg_prod_3_0_operario_resync(null)');
