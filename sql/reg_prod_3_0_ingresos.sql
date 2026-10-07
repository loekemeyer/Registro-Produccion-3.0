-- Registro Producción 3.0 — ingreso con el código de la TV + registro de IP y equipo (07/10/2026, Elías).
-- Lo llaman cervantes/ (v3.0.5) y virgilio/ (v30.12). Nombres con el prefijo reg_prod_3_0_ (Postgres los guarda en minúsculas).

-- 1) Tabla propia. Sin políticas y sin permisos para anon/authenticated: sólo la tocan las funciones de abajo
--    (SECURITY DEFINER) y el rol de servicio / SQL Editor.
create table public.reg_prod_3_0_ingresos (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  app         text        not null,              -- 'cervantes' | 'virgilio'
  legajo      text,
  nombre      text,
  metodo      text,                              -- 'clave_tv' (o 'nombre' = alta en Virgilio)
  ok          boolean     not null,
  motivo      text,                              -- null si ok; 'codigo' | 'legajo' | 'bloqueo'
  verificado  boolean     not null default false,-- true = la base validó el código; false = lo declaró el celular
  ip          text,                              -- IP que ve el servidor (cf-connecting-ip, o la 1.ª de x-forwarded-for)
  xff         text,                              -- x-forwarded-for tal cual llegó
  red_empresa text,                              -- sede si la IP está en public.red_empresa; null si no
  dispositivo text,                              -- id guardado en el celular (gv_dispositivo)
  huella      text,                              -- hash de las características del equipo
  navegador   text,
  extra       jsonb                              -- pantalla, idioma, zona, modelo, memoria, núcleos…
);
create index reg_prod_3_0_ingresos_at_idx   on public.reg_prod_3_0_ingresos (at desc);
create index reg_prod_3_0_ingresos_leg_idx  on public.reg_prod_3_0_ingresos (legajo, at desc);
create index reg_prod_3_0_ingresos_disp_idx on public.reg_prod_3_0_ingresos (dispositivo, at desc);
alter table public.reg_prod_3_0_ingresos enable row level security;
revoke all on public.reg_prod_3_0_ingresos from anon, authenticated;

-- 2) IP que ve el servidor (la pone el gateway; el celular no puede decirla). Interna.
create or replace function public.reg_prod_3_0_ip()
returns text language plpgsql stable security definer set search_path = ''
as $f$
declare
  h jsonb;
begin
  begin
    h := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  exception when others then
    h := '{}'::jsonb;
  end;
  return coalesce(
    nullif(btrim(h->>'cf-connecting-ip'), ''),
    nullif(btrim(split_part(coalesce(h->>'x-forwarded-for', ''), ',', 1)), ''),
    nullif(btrim(h->>'x-real-ip'), ''));
end $f$;

-- 3) Escribe una fila. Interna: no se ejecuta desde afuera.
create or replace function public.reg_prod_3_0_ingreso_log(
  p_app text, p_legajo text, p_nombre text, p_metodo text, p_ok boolean, p_motivo text, p_verificado boolean,
  p_dispositivo text, p_huella text, p_navegador text, p_extra jsonb)
returns bigint language plpgsql security definer set search_path = ''
as $f$
declare
  h jsonb;
  v_ip text := public.reg_prod_3_0_ip();
  v_id bigint;
begin
  begin
    h := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  exception when others then
    h := '{}'::jsonb;
  end;
  insert into public.reg_prod_3_0_ingresos
    (app, legajo, nombre, metodo, ok, motivo, verificado, ip, xff, red_empresa, dispositivo, huella, navegador, extra)
  values
    (left(coalesce(p_app, ''), 20), left(btrim(coalesce(p_legajo, '')), 20), left(p_nombre, 120), left(p_metodo, 30),
     p_ok, left(p_motivo, 60), p_verificado, v_ip, left(h->>'x-forwarded-for', 300), public.ip_en_red_empresa(v_ip),
     left(p_dispositivo, 80), left(p_huella, 40), left(p_navegador, 400), p_extra)
  returning id into v_id;
  return v_id;
end $f$;

-- 4) Registrar el legajo que se usó en un equipo (lo llaman Cervantes al poner el legajo y Virgilio después de elegir el nombre).
--    Sólo anota lo que el celular declara (verificado = false). Un legajo que no está activo en Empleados se anota con ok = false.
create or replace function public.reg_prod_3_0_registrar_ingreso(
  p_app text, p_legajo text, p_nombre text default null, p_metodo text default 'clave_tv',
  p_dispositivo text default null, p_huella text default null, p_navegador text default null, p_extra jsonb default null)
returns bigint language plpgsql security definer set search_path = ''
as $f$
declare
  v_leg    text := btrim(coalesce(p_legajo, ''));
  v_ok     boolean := true;
  v_motivo text;
begin
  if v_leg <> '' and not exists (
       select 1 from public."Empleados" e
        where btrim(e."Legajo") = v_leg and upper(btrim(coalesce(e."Activo", ''))) = 'SI') then
    v_ok := false;
    v_motivo := 'legajo';
  end if;
  return public.reg_prod_3_0_ingreso_log(p_app, v_leg, p_nombre, p_metodo, v_ok, v_motivo, false,
                                         p_dispositivo, p_huella, p_navegador, p_extra);
end $f$;

-- 5) Cervantes: valida el código de la TV (GP2.monitor_clave_validar) y anota todo. Se pide ANTES de entrar, así que
--    todavía no hay legajo (p_legajo es opcional: si viene, se exige que esté activo en Empleados).
--    Tope de códigos malos en 10 min: 10 por equipo y 40 por IP (la planta comparte una IP pública).
create or replace function public.reg_prod_3_0_cerv_ingresar(
  p_app text, p_clave text, p_legajo text default null,
  p_dispositivo text default null, p_huella text default null, p_navegador text default null, p_extra jsonb default null)
returns jsonb language plpgsql security definer set search_path = ''
as $f$
declare
  v_leg    text := btrim(coalesce(p_legajo, ''));
  v_ip     text := public.reg_prod_3_0_ip();
  v_disp   text := left(p_dispositivo, 80);
  v_f_disp int := 0;
  v_f_ip   int := 0;
  v_nombre text;
begin
  if v_disp is not null then
    select count(*) into v_f_disp from public.reg_prod_3_0_ingresos
     where not ok and motivo = 'codigo' and at > now() - interval '10 minutes' and dispositivo = v_disp;
  end if;
  if v_ip is not null then
    select count(*) into v_f_ip from public.reg_prod_3_0_ingresos
     where not ok and motivo = 'codigo' and at > now() - interval '10 minutes' and ip = v_ip;
  end if;
  if v_f_disp >= 10 or v_f_ip >= 40 then
    perform public.reg_prod_3_0_ingreso_log(p_app, v_leg, null, 'clave_tv', false, 'bloqueo', true,
                                            p_dispositivo, p_huella, p_navegador, p_extra);
    return jsonb_build_object('ok', false, 'error', 'bloqueo');
  end if;

  if coalesce(("GP2".monitor_clave_validar(p_clave) ->> 'ok')::boolean, false) is not true then
    perform public.reg_prod_3_0_ingreso_log(p_app, v_leg, null, 'clave_tv', false, 'codigo', true,
                                            p_dispositivo, p_huella, p_navegador, p_extra);
    return jsonb_build_object('ok', false, 'error', 'codigo');
  end if;

  if v_leg <> '' then
    if v_leg ~ '^\d{1,6}$' then
      select btrim(e."Empleado") into v_nombre from public."Empleados" e
       where btrim(e."Legajo") = v_leg and upper(btrim(coalesce(e."Activo", ''))) = 'SI' limit 1;
    end if;
    if v_nombre is null then
      perform public.reg_prod_3_0_ingreso_log(p_app, v_leg, null, 'clave_tv', false, 'legajo', true,
                                              p_dispositivo, p_huella, p_navegador, p_extra);
      return jsonb_build_object('ok', false, 'error', 'legajo');
    end if;
  end if;

  perform public.reg_prod_3_0_ingreso_log(p_app, nullif(v_leg, ''), v_nombre, 'clave_tv', true, null, true,
                                          p_dispositivo, p_huella, p_navegador, p_extra);
  return jsonb_build_object('ok', true, 'nombre', v_nombre);
end $f$;

-- 6) Permisos: las internas no se ejecutan desde afuera; las dos de las apps, sí (con la clave pública).
revoke execute on function public.reg_prod_3_0_ip() from public, anon, authenticated;
revoke execute on function public.reg_prod_3_0_ingreso_log(text, text, text, text, boolean, text, boolean, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.reg_prod_3_0_registrar_ingreso(text, text, text, text, text, text, text, jsonb) from public;
revoke execute on function public.reg_prod_3_0_cerv_ingresar(text, text, text, text, text, text, jsonb) from public;
grant  execute on function public.reg_prod_3_0_registrar_ingreso(text, text, text, text, text, text, text, jsonb) to anon, authenticated;
grant  execute on function public.reg_prod_3_0_cerv_ingresar(text, text, text, text, text, text, jsonb) to anon, authenticated;

-- 7) Alerta por Telegram (mismo molde que la de Virgilio): un mismo celular con 2 o más legajos distintos el mismo día en Cervantes.
create or replace view public.reg_prod_3_0_dispositivo_multi_legajo as
with q as (
  select i.dispositivo,
         (i.at at time zone 'America/Argentina/Buenos_Aires')::date as dia,
         i.legajo,
         min(i.at) as desde,
         coalesce((select e."Empleado" from public."Empleados" e where btrim(e."Legajo") = i.legajo limit 1),
                  max(i.nombre), i.legajo) as nombre
    from public.reg_prod_3_0_ingresos i
   where i.app = 'cervantes' and i.ok and i.dispositivo is not null and nullif(i.legajo, '') is not null
     and not public.es_legajo_test(i.legajo)
   group by i.dispositivo, (i.at at time zone 'America/Argentina/Buenos_Aires')::date, i.legajo
)
select dispositivo, dia, count(*) as legajos,
       string_agg(nombre || ' (' || legajo || ') desde ' || to_char(desde at time zone 'America/Argentina/Buenos_Aires', 'HH24:MI'),
                  ' · ' order by desde) as quienes,
       min(desde) as primero, max(desde) as ultimo,
       (select x.navegador from public.reg_prod_3_0_ingresos x where x.dispositivo = q.dispositivo order by x.at desc limit 1) as navegador,
       string_agg(legajo, ',' order by legajo) as claves
  from q
 group by dispositivo, dia
having count(*) > 1;
revoke all on public.reg_prod_3_0_dispositivo_multi_legajo from anon, authenticated;

create or replace function public.reg_prod_3_0_alerta_dispositivo_multi_telegram()
returns integer language plpgsql security definer set search_path = 'public', 'pg_temp'
as $f$
declare
  r record;
  n int := 0;
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
  for r in select * from public.reg_prod_3_0_dispositivo_multi_legajo where dia = v_hoy loop
    perform public.tg_enqueue(
      '📱 CERVANTES — UN MISMO CELULAR CON ' || r.legajos || ' LEGAJOS (' || to_char(v_hoy, 'DD/MM') || ')' || E'\n' ||
      r.quienes || E'\n' ||
      'Dispositivo ' || left(r.dispositivo, 8) || coalesce(' · ' || left(r.navegador, 90), ''),
      'rp30_disp_multi_' || r.dispositivo || '_' || v_hoy::text || '_' || md5(r.claves));
    n := n + 1;
  end loop;
  if n > 0 then perform public.tg_outbox_flush(); end if;
  return n;
end $f$;
revoke execute on function public.reg_prod_3_0_alerta_dispositivo_multi_telegram() from public, anon, authenticated;

select cron.schedule('reg-prod-3-0-alerta-dispositivo-multi', '7-59/10 * * * *', 'select public.reg_prod_3_0_alerta_dispositivo_multi_telegram()');
