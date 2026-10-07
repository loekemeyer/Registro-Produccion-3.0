-- NOTA DE APLICACIÓN (07/10/2026): este archivo es el SQL completo de la Fase 1a. En Supabase se aplicó en 4 migraciones
-- (reg_prod_3_0_fase_1a_parte_1, _parte_2 y _parte_4). La herramienta de Supabase no deja correr DROP ni DELETE (se cuelga):
-- el «7)» entero se aplicó SIN los 3 `drop function` finales. Quedan en public, sin uso y sin permisos para anon:
--   public.reg_prod_3_0_alerta_dispositivo_multi_telegram(), public.reg_prod_3_0_ingreso_log(...) y public.reg_prod_3_0_ip().
-- Se borran a mano con esas 3 sentencias (están al final del bloque 7). El bloque «5b» de tablas se aplicó en la parte 2
-- y el «9» (API) en la parte 4.

-- Registro Producción 3.0 — FASE 1a (07/10/2026, Elías: «schema propio», «las tablas separadas», «plan A»).
-- Parte 1: mudar a un schema propio (reg_prod_3_0) lo del ingreso que está en public.
-- Parte 2: las tablas nuevas (una cruda por sede y una procesada de Cervantes) y una vista que junta las crudas.
-- Parte 3: el pase firmado por la base (secreto en Vault) que van a exigir las funciones de escritura.
-- Parte 4: AUDITORÍA: lo que entra pasada la hora del pase o mucho antes del inicio de la jornada queda en una tabla para revisar.
-- Las 2 funciones que ya llaman las apps quedan en public como ATAJOS que delegan (los celulares cachean la versión vieja).

-- 1) schema propio
create schema if not exists reg_prod_3_0;
grant usage on schema reg_prod_3_0 to anon, authenticated;

-- 2) la tabla (con sus datos, índices, secuencia, RLS y revokes) y la vista se mudan
alter table public.reg_prod_3_0_ingresos set schema reg_prod_3_0;
alter view public.reg_prod_3_0_dispositivo_multi_legajo set schema reg_prod_3_0;

-- 2b) secreto con el que la base firma el pase (queda en Vault; no se muestra en ningún lado)
do $f$
begin
  if not exists (select 1 from vault.secrets where name = 'reg_prod_3_0_pase_secreto') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'reg_prod_3_0_pase_secreto',
                                'Firma del pase de entrada con el código de la TV (Registro Producción 3.0)');
  end if;
end $f$;

-- 2c) horarios (editables) y tabla de auditoría
create table reg_prod_3_0.config (
  clave text primary key,
  valor text not null,
  nota  text
);
alter table reg_prod_3_0.config enable row level security;
revoke all on reg_prod_3_0.config from anon, authenticated;
insert into reg_prod_3_0.config (clave, valor, nota) values
  ('jornada_inicio_cervantes', '08:30', 'Inicio de la jornada en Cervantes (hora de Buenos Aires)'),
  ('jornada_inicio_virgilio',  '08:00', 'Inicio de la jornada en Virgilio (hora de Buenos Aires)'),
  ('anticipo_max_min',         '30',    'Minutos antes del inicio de la jornada desde los cuales un ingreso va a auditoría'),
  ('pase_fin',                 '17:45', 'Hasta esta hora vale el pase; un ingreso posterior va a auditoría y recibe un pase de 3 horas');

create table reg_prod_3_0.auditoria (
  id           bigint      generated always as identity primary key,
  at           timestamptz not null default now(),
  tipo         text        not null,               -- 'fuera_de_horario'
  app          text,
  legajo       text,
  dispositivo  text,
  ip           text,
  ingreso_id   bigint      references reg_prod_3_0.reg_prod_3_0_ingresos (id) on delete set null,
  ok           boolean,                            -- el ingreso salió bien (true) o fue rechazado (false)
  detalle      jsonb,                              -- hora, ventana permitida y motivo
  revisado     boolean     not null default false,
  revisado_por text,
  revisado_at  timestamptz,
  nota         text
);
create index auditoria_at_idx         on reg_prod_3_0.auditoria (at desc);
create index auditoria_pendientes_idx on reg_prod_3_0.auditoria (at desc) where not revisado;
alter table reg_prod_3_0.auditoria enable row level security;
revoke all on reg_prod_3_0.auditoria from anon, authenticated;

-- 3) funciones internas, en el schema nuevo (los cuerpos nombran el schema)
create or replace function reg_prod_3_0.reg_prod_3_0_ip()
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

-- ¿ahora es «mucho antes» del inicio de la jornada o pasó la hora del pase? Devuelve el detalle, o null si está en horario
-- (o si la app no tiene horario definido en reg_prod_3_0.config).
create or replace function reg_prod_3_0.reg_prod_3_0_fuera_de_horario(p_app text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $f$
declare
  v_ahora  timestamp := now() at time zone 'America/Argentina/Buenos_Aires';
  v_hora   time := (now() at time zone 'America/Argentina/Buenos_Aires')::time;
  v_inicio time;
  v_fin    time;
  v_antic  int;
  v_desde  time;
begin
  select valor::time into v_inicio from reg_prod_3_0.config where clave = 'jornada_inicio_' || lower(coalesce(p_app, ''));
  if v_inicio is null then return null; end if;
  select valor::time into v_fin   from reg_prod_3_0.config where clave = 'pase_fin';
  select valor::int  into v_antic from reg_prod_3_0.config where clave = 'anticipo_max_min';
  v_fin   := coalesce(v_fin, time '17:45');
  v_antic := coalesce(v_antic, 30);
  v_desde := v_inicio - make_interval(mins => v_antic);
  if v_hora < v_desde or v_hora > v_fin then
    return jsonb_build_object('dia', to_char(v_ahora, 'YYYY-MM-DD'), 'hora', to_char(v_hora, 'HH24:MI'),
                              'desde', to_char(v_desde, 'HH24:MI'), 'hasta', to_char(v_fin, 'HH24:MI'),
                              'motivo', case when v_hora < v_desde then 'antes_de_la_jornada' else 'despues_del_horario' end);
  end if;
  return null;
end $f$;

-- texto -> fecha y hora; si no es una fecha válida devuelve null (hs_inicio de Cervantes es texto)
create or replace function reg_prod_3_0.reg_prod_3_0_a_timestamptz(p text)
returns timestamptz language plpgsql stable set search_path = ''
as $f$
begin
  return nullif(btrim(p), '')::timestamptz;
exception when others then
  return null;
end $f$;

-- pase firmado: vale hasta la hora de reg_prod_3_0.config (pase_fin, hoy 17:45) de hoy (hora de Buenos Aires); si ya pasaron, 3 horas (horas extra). Va atado al equipo.
create or replace function reg_prod_3_0.reg_prod_3_0_pase_emitir(p_dispositivo text)
returns jsonb language plpgsql security definer set search_path = ''
as $f$
declare
  v_secreto text;
  v_ahora   timestamp := now() at time zone 'America/Argentina/Buenos_Aires';
  v_vence   timestamptz;
  v_carga   text;
  v_fin     time;
begin
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'reg_prod_3_0_pase_secreto';
  if v_secreto is null then raise exception 'Falta el secreto del pase'; end if;
  select valor::time into v_fin from reg_prod_3_0.config where clave = 'pase_fin';
  v_fin := coalesce(v_fin, time '17:45');
  if v_ahora::time < v_fin then
    v_vence := (date_trunc('day', v_ahora) + v_fin) at time zone 'America/Argentina/Buenos_Aires';
  else
    v_vence := now() + interval '3 hours';
  end if;
  v_carga := 'v1|' || floor(extract(epoch from v_vence))::bigint::text || '|' || coalesce(left(p_dispositivo, 80), '');
  return jsonb_build_object(
    'pase', translate(encode(convert_to(v_carga, 'utf8'), 'base64'), E'\n', '') || '.' ||
            encode(extensions.hmac(v_carga, v_secreto, 'sha256'), 'hex'),
    'vence', v_vence);
end $f$;

-- ¿el pase es de esta base, no venció y es de este equipo?
create or replace function reg_prod_3_0.reg_prod_3_0_pase_ok(p_pase text, p_dispositivo text)
returns boolean language plpgsql security definer set search_path = ''
as $f$
declare
  v_secreto text;
  v_partes  text[];
  v_carga   text;
  v_campos  text[];
begin
  if p_pase is null or position('.' in p_pase) = 0 then return false; end if;
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'reg_prod_3_0_pase_secreto';
  if v_secreto is null then return false; end if;
  v_partes := string_to_array(p_pase, '.');
  if array_length(v_partes, 1) <> 2 then return false; end if;
  begin
    v_carga := convert_from(decode(v_partes[1], 'base64'), 'utf8');
  exception when others then
    return false;
  end;
  if encode(extensions.hmac(v_carga, v_secreto, 'sha256'), 'hex') is distinct from v_partes[2] then return false; end if;
  v_campos := string_to_array(v_carga, '|');
  if v_campos[1] is distinct from 'v1' or v_campos[2]::bigint < floor(extract(epoch from now())) then return false; end if;
  return coalesce(v_campos[3], '') = coalesce(left(p_dispositivo, 80), '');
exception when others then
  return false;
end $f$;

create or replace function reg_prod_3_0.reg_prod_3_0_ingreso_log(
  p_app text, p_legajo text, p_nombre text, p_metodo text, p_ok boolean, p_motivo text, p_verificado boolean,
  p_dispositivo text, p_huella text, p_navegador text, p_extra jsonb)
returns bigint language plpgsql security definer set search_path = ''
as $f$
declare
  h jsonb;
  v_ip text := reg_prod_3_0.reg_prod_3_0_ip();
  v_id bigint;
  v_fuera jsonb;
begin
  begin
    h := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  exception when others then
    h := '{}'::jsonb;
  end;
  insert into reg_prod_3_0.reg_prod_3_0_ingresos
    (app, legajo, nombre, metodo, ok, motivo, verificado, ip, xff, red_empresa, dispositivo, huella, navegador, extra)
  values
    (left(coalesce(p_app, ''), 20), left(btrim(coalesce(p_legajo, '')), 20), left(p_nombre, 120), left(p_metodo, 30),
     p_ok, left(p_motivo, 60), p_verificado, v_ip, left(h->>'x-forwarded-for', 300), public.ip_en_red_empresa(v_ip),
     left(p_dispositivo, 80), left(p_huella, 40), left(p_navegador, 400), p_extra)
  returning id into v_id;

  -- fuera de horario (pasada la hora del pase o mucho antes del inicio de la jornada): además queda en la tabla de auditoría
  v_fuera := reg_prod_3_0.reg_prod_3_0_fuera_de_horario(p_app);
  if v_fuera is not null then
    insert into reg_prod_3_0.auditoria (tipo, app, legajo, dispositivo, ip, ingreso_id, ok, detalle)
    values ('fuera_de_horario', left(coalesce(p_app, ''), 20), left(btrim(coalesce(p_legajo, '')), 20),
            left(p_dispositivo, 80), v_ip, v_id, p_ok, v_fuera);
  end if;
  return v_id;
end $f$;

-- 4) las dos que llaman las apps
create or replace function reg_prod_3_0.reg_prod_3_0_registrar_ingreso(
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
  return reg_prod_3_0.reg_prod_3_0_ingreso_log(p_app, v_leg, p_nombre, p_metodo, v_ok, v_motivo, false,
                                               p_dispositivo, p_huella, p_navegador, p_extra);
end $f$;

create or replace function reg_prod_3_0.reg_prod_3_0_cerv_ingresar(
  p_app text, p_clave text, p_legajo text default null,
  p_dispositivo text default null, p_huella text default null, p_navegador text default null, p_extra jsonb default null)
returns jsonb language plpgsql security definer set search_path = ''
as $f$
declare
  v_leg    text := btrim(coalesce(p_legajo, ''));
  v_ip     text := reg_prod_3_0.reg_prod_3_0_ip();
  v_disp   text := left(p_dispositivo, 80);
  v_f_disp int := 0;
  v_f_ip   int := 0;
  v_nombre text;
begin
  if v_disp is not null then
    select count(*) into v_f_disp from reg_prod_3_0.reg_prod_3_0_ingresos
     where not ok and motivo = 'codigo' and at > now() - interval '10 minutes' and dispositivo = v_disp;
  end if;
  if v_ip is not null then
    select count(*) into v_f_ip from reg_prod_3_0.reg_prod_3_0_ingresos
     where not ok and motivo = 'codigo' and at > now() - interval '10 minutes' and ip = v_ip;
  end if;
  if v_f_disp >= 10 or v_f_ip >= 40 then
    perform reg_prod_3_0.reg_prod_3_0_ingreso_log(p_app, v_leg, null, 'clave_tv', false, 'bloqueo', true,
                                                  p_dispositivo, p_huella, p_navegador, p_extra);
    return jsonb_build_object('ok', false, 'error', 'bloqueo');
  end if;

  if coalesce(("GP2".monitor_clave_validar(p_clave) ->> 'ok')::boolean, false) is not true then
    perform reg_prod_3_0.reg_prod_3_0_ingreso_log(p_app, v_leg, null, 'clave_tv', false, 'codigo', true,
                                                  p_dispositivo, p_huella, p_navegador, p_extra);
    return jsonb_build_object('ok', false, 'error', 'codigo');
  end if;

  if v_leg <> '' then
    if v_leg ~ '^\d{1,6}$' then
      select btrim(e."Empleado") into v_nombre from public."Empleados" e
       where btrim(e."Legajo") = v_leg and upper(btrim(coalesce(e."Activo", ''))) = 'SI' limit 1;
    end if;
    if v_nombre is null then
      perform reg_prod_3_0.reg_prod_3_0_ingreso_log(p_app, v_leg, null, 'clave_tv', false, 'legajo', true,
                                                    p_dispositivo, p_huella, p_navegador, p_extra);
      return jsonb_build_object('ok', false, 'error', 'legajo');
    end if;
  end if;

  perform reg_prod_3_0.reg_prod_3_0_ingreso_log(p_app, nullif(v_leg, ''), v_nombre, 'clave_tv', true, null, true,
                                                p_dispositivo, p_huella, p_navegador, p_extra);
  return jsonb_build_object('ok', true, 'nombre', v_nombre) || reg_prod_3_0.reg_prod_3_0_pase_emitir(p_dispositivo);
end $f$;

-- 5) alerta por Telegram (la vista ya se mudó)
create or replace function reg_prod_3_0.reg_prod_3_0_alerta_dispositivo_multi_telegram()
returns integer language plpgsql security definer set search_path = ''
as $f$
declare
  r record;
  n int := 0;
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
  for r in select * from reg_prod_3_0.reg_prod_3_0_dispositivo_multi_legajo where dia = v_hoy loop
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

-- 5b) TABLAS NUEVAS. Protegidas: sin permisos para anon/authenticated; se escriben sólo por funciones con pase.
--     Cada sede tiene la suya, con las MISMAS columnas que la vieja (plan A: el día del corte la vieja se renombra y el nombre
--     viejo pasa a ser una vista de compatibilidad) más lo nuevo: anulado, extra, origen e id_origen (para migrar sin duplicar).
create table reg_prod_3_0.crudo_cervantes (
  id          text        primary key,            -- id del toque, lo genera el celular (un reintento no duplica)
  legajo      text        not null,
  opcion      text        not null,
  descripcion text,
  texto       text,
  ts_event    timestamptz not null,
  hs_inicio   text,
  matriz      text,
  created_at  timestamptz not null default now(),
  dispositivo text,                               -- gv_dispositivo
  app_version text,
  extra       jsonb,                              -- lo que no tiene columna (comp_salida_id, golpes…)
  anulado     boolean     not null default false,
  anulado_at  timestamptz,
  origen      text        not null default '3.0', -- '3.0' | 'migrado_cervantes'
  id_origen   text
);
create index crudo_cervantes_legajo_idx       on reg_prod_3_0.crudo_cervantes (legajo);
create index crudo_cervantes_legajo_fecha_idx on reg_prod_3_0.crudo_cervantes (legajo, ts_event);
create index crudo_cervantes_ts_event_idx     on reg_prod_3_0.crudo_cervantes (ts_event);
create unique index crudo_cervantes_origen_uk on reg_prod_3_0.crudo_cervantes (origen, id_origen) where id_origen is not null;

create table reg_prod_3_0.crudo_virgilio (
  id               uuid        primary key default gen_random_uuid(),
  client_id        text        unique,
  legajo           text        not null,
  opcion           text        not null,
  descripcion      text,
  texto            text,
  ts_cliente       timestamptz,
  ts_inicio        timestamptz,
  created_at       timestamptz not null default now(),
  gv_app           text,
  gv_nombre_prueba text,
  gv_dispositivo   text,
  extra            jsonb,
  anulado          boolean     not null default false,
  anulado_at       timestamptz,
  origen           text        not null default '3.0', -- '3.0' | 'migrado_virgilio'
  id_origen        text
);
create index crudo_virgilio_opcion_ts_idx    on reg_prod_3_0.crudo_virgilio (opcion, ts_cliente);
create index crudo_virgilio_pkc_art_idx      on reg_prod_3_0.crudo_virgilio (opcion, upper(btrim(split_part(texto, '|', 2)))) where opcion = 'PKC';
create index crudo_virgilio_created_at_idx   on reg_prod_3_0.crudo_virgilio (created_at desc);
create index crudo_virgilio_legajo_idx       on reg_prod_3_0.crudo_virgilio (legajo);
create index crudo_virgilio_opcion_idx       on reg_prod_3_0.crudo_virgilio (opcion);
create index crudo_virgilio_ts_inicio_idx    on reg_prod_3_0.crudo_virgilio (ts_inicio);
create unique index crudo_virgilio_origen_uk on reg_prod_3_0.crudo_virgilio (origen, id_origen) where id_origen is not null;

create table reg_prod_3_0.procesado_cervantes (
  id                     bigint      generated always as identity primary key,
  crudo_id               text        references reg_prod_3_0.crudo_cervantes (id) on delete set null,
  id_ejecucion           text        not null,          -- ID_Ejecucion del espejo
  fecha                  timestamptz,
  legajo                 text,
  nombre_empleado        text,
  matriz                 text,
  nombre_matriz          text,
  uni                    numeric,
  golpes                 numeric,
  uni_x_golpe            numeric,
  premio                 numeric,
  tiempo_toma            numeric,
  tiempo_historico       numeric,
  hora_inicio            time,
  hora_fin               time,
  fecha_inicio           timestamptz,
  fecha_fin              timestamptz,
  segundos_historico     numeric,
  segundos_trabajados    numeric,
  segundos_tiempo_muerto numeric,
  anular_tiempo          boolean,
  dia                    integer,
  mes                    integer,
  quincena               integer,
  eliminar               text,
  revisado               boolean     not null default false,
  created_at             timestamptz not null default now(),
  origen                 text        not null default '3.0', -- '3.0' | 'migrado_cervantes'
  id_origen              text
);
create unique index procesado_cervantes_ejec_uk   on reg_prod_3_0.procesado_cervantes (id_ejecucion);
create index procesado_cervantes_fecha_idx        on reg_prod_3_0.procesado_cervantes (fecha);
create index procesado_cervantes_legajo_dia_idx   on reg_prod_3_0.procesado_cervantes (legajo, dia, mes);
create index procesado_cervantes_matriz_idx       on reg_prod_3_0.procesado_cervantes (matriz);
create unique index procesado_cervantes_origen_uk on reg_prod_3_0.procesado_cervantes (origen, id_origen) where id_origen is not null;

alter table reg_prod_3_0.crudo_cervantes     enable row level security;
alter table reg_prod_3_0.crudo_virgilio      enable row level security;
alter table reg_prod_3_0.procesado_cervantes enable row level security;
revoke all on reg_prod_3_0.crudo_cervantes, reg_prod_3_0.crudo_virgilio, reg_prod_3_0.procesado_cervantes from anon, authenticated;

-- Las dos crudas juntas, SOLO para leer: las funciones que tienen que mirar las 2 sedes (por ejemplo cuánto duró el viaje de
-- una persona de una sede a la otra, Cambio de Sede) leen esta vista; los datos siguen en tablas separadas.
create or replace view reg_prod_3_0.crudo as
select 'Cervantes'::text as sede, c.id::text as id, c.legajo, c.opcion, c.descripcion, c.texto,
       c.ts_event as ts_evento, reg_prod_3_0.reg_prod_3_0_a_timestamptz(c.hs_inicio) as ts_inicio, c.matriz,
       c.dispositivo, c.anulado, c.created_at
  from reg_prod_3_0.crudo_cervantes c
union all
select 'Virgilio'::text, v.id::text, v.legajo, v.opcion, v.descripcion, v.texto,
       coalesce(v.ts_cliente, v.created_at), v.ts_inicio, null::text,
       v.gv_dispositivo, v.anulado, v.created_at
  from reg_prod_3_0.crudo_virgilio v;
revoke all on reg_prod_3_0.crudo from anon, authenticated;

-- 6) permisos del schema nuevo: las internas no se ejecutan desde afuera; las dos de las apps, sí (con la clave pública)
revoke execute on function reg_prod_3_0.reg_prod_3_0_ip() from public, anon, authenticated;
revoke execute on function reg_prod_3_0.reg_prod_3_0_a_timestamptz(text) from public, anon, authenticated;
revoke execute on function reg_prod_3_0.reg_prod_3_0_fuera_de_horario(text) from public, anon, authenticated;
revoke execute on function reg_prod_3_0.reg_prod_3_0_pase_emitir(text) from public, anon, authenticated;
revoke execute on function reg_prod_3_0.reg_prod_3_0_pase_ok(text, text) from public, anon, authenticated;
revoke execute on function reg_prod_3_0.reg_prod_3_0_ingreso_log(text, text, text, text, boolean, text, boolean, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function reg_prod_3_0.reg_prod_3_0_alerta_dispositivo_multi_telegram() from public, anon, authenticated;
revoke execute on function reg_prod_3_0.reg_prod_3_0_registrar_ingreso(text, text, text, text, text, text, text, jsonb) from public;
revoke execute on function reg_prod_3_0.reg_prod_3_0_cerv_ingresar(text, text, text, text, text, text, jsonb) from public;
grant  execute on function reg_prod_3_0.reg_prod_3_0_registrar_ingreso(text, text, text, text, text, text, text, jsonb) to anon, authenticated;
grant  execute on function reg_prod_3_0.reg_prod_3_0_cerv_ingresar(text, text, text, text, text, text, jsonb) to anon, authenticated;

-- 7) public: las 2 que ya llaman las apps pasan a ser atajos que delegan (mismos permisos); las internas viejas se borran
create or replace function public.reg_prod_3_0_registrar_ingreso(
  p_app text, p_legajo text, p_nombre text default null, p_metodo text default 'clave_tv',
  p_dispositivo text default null, p_huella text default null, p_navegador text default null, p_extra jsonb default null)
returns bigint language sql security definer set search_path = ''
as $f$
  select reg_prod_3_0.reg_prod_3_0_registrar_ingreso(p_app, p_legajo, p_nombre, p_metodo, p_dispositivo, p_huella, p_navegador, p_extra);
$f$;

create or replace function public.reg_prod_3_0_cerv_ingresar(
  p_app text, p_clave text, p_legajo text default null,
  p_dispositivo text default null, p_huella text default null, p_navegador text default null, p_extra jsonb default null)
returns jsonb language sql security definer set search_path = ''
as $f$
  select reg_prod_3_0.reg_prod_3_0_cerv_ingresar(p_app, p_clave, p_legajo, p_dispositivo, p_huella, p_navegador, p_extra);
$f$;

drop function public.reg_prod_3_0_alerta_dispositivo_multi_telegram();
drop function public.reg_prod_3_0_ingreso_log(text, text, text, text, boolean, text, boolean, text, text, text, jsonb);
drop function public.reg_prod_3_0_ip();

-- 8) cron: apunta al schema nuevo
select cron.unschedule('reg-prod-3-0-alerta-dispositivo-multi');
select cron.schedule('reg-prod-3-0-alerta-dispositivo-multi', '7-59/10 * * * *', 'select reg_prod_3_0.reg_prod_3_0_alerta_dispositivo_multi_telegram()');

-- 9) la API (PostgREST) tiene que ver el schema: se AGREGA a la lista que ya está configurada, sin tocar el resto
do $f$
declare
  v text;
begin
  select regexp_replace(c, '^pgrst\.db_schemas=', '') into v
    from pg_roles r, unnest(r.rolconfig) c
   where r.rolname = 'authenticator' and c like 'pgrst.db_schemas=%';
  if v is not null and v !~ '(^|,\s*)reg_prod_3_0\s*(,|$)' then
    execute format('alter role authenticator set pgrst.db_schemas = %L', v || ', reg_prod_3_0');
  end if;
end $f$;
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
