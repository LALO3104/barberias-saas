-- =============================================================================
-- Pruebas — Step 10.1 Migrations B y C: líneas de cita y reserva multi-servicio
-- (migraciones 20261024150000 y 20261024150100)
-- -----------------------------------------------------------------------------
-- SOLO para una base LOCAL o desechable con todas las migraciones aplicadas
-- (supabase start, o Postgres local con roles anon/authenticated, auth.users y
-- auth.uid()). Nunca contra producción.
--
-- Todo ocurre en UNA transacción que termina en ROLLBACK: no deja datos.
-- Si alguna prueba falla, el bloque final lanza una excepción (código de
-- salida distinto de 0 con psql -v ON_ERROR_STOP=1).
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/multi_service_booking.test.sql
--
-- Fechas fijas en 2030 (America/Mexico_City, UTC−6 sin horario de verano):
--   lunes 2030-06-03, martes 2030-06-04, miércoles 2030-06-05.
-- La anticipación mínima se prueba con una barbería abierta 24 h relativa a
-- now().
--
-- La prueba de concurrencia real (dos sesiones) está al final, como
-- procedimiento manual: no puede correr dentro de esta transacción.
-- =============================================================================

begin;

-- ─── Utilidades (mismo estilo que appointments_hardening.test.sql) ───────────
create temp table _results (n serial primary key, ok boolean not null, label text not null, detail text);
grant all on _results to public;
grant usage on sequence _results_n_seq to public;

create function pg_temp.as_user(_uid uuid) returns void language plpgsql as $$
begin
  execute 'reset role';
  if _uid is null then
    execute 'set local role anon';
    perform set_config('request.jwt.claims', '', true);
  else
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
  end if;
end $$;

create function pg_temp.as_postgres() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

create function pg_temp.check(_label text, _ok boolean, _detail text default null) returns void language plpgsql as $$
begin
  insert into _results (ok, label, detail) values (coalesce(_ok, false), _label, _detail);
end $$;

create function pg_temp.expect_error(_label text, _sql text, _code text) returns void language plpgsql as $$
begin
  begin
    execute _sql;
    perform pg_temp.check(_label, false, 'no falló (se esperaba ' || _code || ')');
  exception when others then
    perform pg_temp.check(_label, sqlstate = _code,
      case when sqlstate = _code then sqlstate else 'falló con ' || sqlstate || ' "' || sqlerrm || '", se esperaba ' || _code end);
  end;
end $$;

create function pg_temp.expect_ok(_label text, _sql text) returns void language plpgsql as $$
begin
  execute _sql;
  perform pg_temp.check(_label, true);
exception when others then
  perform pg_temp.check(_label, false, sqlstate || ' "' || sqlerrm || '"');
end $$;

-- Hora local de las barberías de prueba → instante.
create function pg_temp.lt(_local text) returns timestamptz language sql immutable as $$
  select (_local::timestamp) at time zone 'America/Mexico_City'
$$;

-- ¿La lista de slots contiene esa hora local?
create function pg_temp.has_slot(_slug text, _barber uuid, _ids uuid[], _date date, _local text)
returns boolean language sql as $$
  select exists (
    select 1 from public.get_available_slots(_slug, _barber, _ids, _date) s
    where s.slot_start = pg_temp.lt(_date::text || ' ' || _local)
  )
$$;

-- Lista de slots en hora local (para los mensajes de detalle).
create function pg_temp.slot_list(_slug text, _barber uuid, _ids uuid[], _date date)
returns text language sql as $$
  select coalesce(string_agg(to_char(s.slot_start at time zone 'America/Mexico_City', 'HH24:MI'), ' ' order by s.slot_start), '(vacío)')
  from public.get_available_slots(_slug, _barber, _ids, _date) s
$$;

-- Reserva con la firma nueva; devuelve la respuesta.
create function pg_temp.book(_slug text, _barber uuid, _ids uuid[], _start timestamptz, _phone text default '5500000000')
returns jsonb language sql as $$
  select public.book_appointment(_slug, _barber, _ids, _start, 'Cliente Prueba', _phone, null)
$$;

-- ─── Datos de prueba (como postgres) ─────────────────────────────────────────
-- K: barbería principal · O: otra barbería · L: abierta 24 h (anticipación)
insert into auth.users (id, email) values
  ('a2000000-0000-0000-0000-000000000001', 'ms-admin-k@test'),
  ('a2000000-0000-0000-0000-000000000002', 'ms-barbero-k1@test'),
  ('a2000000-0000-0000-0000-000000000003', 'ms-barbero-k2@test'),
  ('a2000000-0000-0000-0000-000000000004', 'ms-admin-o@test');

insert into public.tenants (id, slug, name, plan_code, timezone) values
  ('12000000-0000-0000-0000-00000000000a', 'test-ms-k', 'MS Kings', 'barbershop', 'America/Mexico_City'),
  ('12000000-0000-0000-0000-00000000000b', 'test-ms-o', 'MS Otra',  'barbershop', 'America/Mexico_City'),
  ('12000000-0000-0000-0000-00000000000c', 'test-ms-l', 'MS 24h',   'barbershop', 'America/Mexico_City');

insert into public.tenant_members (tenant_id, user_id, role) values
  ('12000000-0000-0000-0000-00000000000a', 'a2000000-0000-0000-0000-000000000001', 'admin'),
  ('12000000-0000-0000-0000-00000000000a', 'a2000000-0000-0000-0000-000000000002', 'barber'),
  ('12000000-0000-0000-0000-00000000000a', 'a2000000-0000-0000-0000-000000000003', 'barber'),
  ('12000000-0000-0000-0000-00000000000b', 'a2000000-0000-0000-0000-000000000004', 'admin');

insert into public.barbers (id, tenant_id, user_id, display_name, is_active) values
  ('b2000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-00000000000a', 'a2000000-0000-0000-0000-000000000002', 'K1', true),
  ('b2000000-0000-0000-0000-000000000002', '12000000-0000-0000-0000-00000000000a', 'a2000000-0000-0000-0000-000000000003', 'K2', true),
  ('b2000000-0000-0000-0000-000000000003', '12000000-0000-0000-0000-00000000000a', null, 'K3 inactivo', false),
  ('b2000000-0000-0000-0000-0000000000b1', '12000000-0000-0000-0000-00000000000b', null, 'O1', true),
  ('b2000000-0000-0000-0000-0000000000c1', '12000000-0000-0000-0000-00000000000c', null, 'L1', true);

insert into public.services (id, tenant_id, name, price_cents, duration_minutes, is_active) values
  ('52000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-00000000000a', 'Corte',   25000,   30, true),
  ('52000000-0000-0000-0000-000000000002', '12000000-0000-0000-0000-00000000000a', 'Barba',   15000,   20, true),
  ('52000000-0000-0000-0000-000000000003', '12000000-0000-0000-0000-00000000000a', 'Ceja',     5000,   10, true),
  ('52000000-0000-0000-0000-000000000004', '12000000-0000-0000-0000-00000000000a', 'Lavado',   8000,   15, true),
  ('52000000-0000-0000-0000-000000000005', '12000000-0000-0000-0000-00000000000a', 'Masaje',  12000,   25, true),
  ('52000000-0000-0000-0000-000000000006', '12000000-0000-0000-0000-00000000000a', 'Tinte',   40000,   60, true),
  ('52000000-0000-0000-0000-000000000045', '12000000-0000-0000-0000-00000000000a', 'Facial',  30000,   45, true),
  ('52000000-0000-0000-0000-000000000009', '12000000-0000-0000-0000-00000000000a', 'Retirado', 9900,   15, false),
  ('52000000-0000-0000-0000-00000000000a', '12000000-0000-0000-0000-00000000000a', 'Largo 1',      0, 1000, true),
  ('52000000-0000-0000-0000-00000000000b', '12000000-0000-0000-0000-00000000000a', 'Largo 2',      0,  500, true),
  ('52000000-0000-0000-0000-0000000000b1', '12000000-0000-0000-0000-00000000000b', 'Corte O', 20000,   30, true),
  ('52000000-0000-0000-0000-0000000000c1', '12000000-0000-0000-0000-00000000000c', 'Exprés',   1000,    5, true);

-- Horario del local K: lunes 09:00–14:00; resto 00:00–24:00.
insert into public.business_hours (tenant_id, day_of_week, opens_at, closes_at) values
  ('12000000-0000-0000-0000-00000000000a', 1, time '09:00', time '14:00');
insert into public.business_hours (tenant_id, day_of_week, opens_at, closes_at)
  select '12000000-0000-0000-0000-00000000000a', d, time '00:00', time '24:00' from generate_series(2, 7) d;
-- O y L: 00:00–24:00 todos los días.
insert into public.business_hours (tenant_id, day_of_week, opens_at, closes_at)
  select t, d, time '00:00', time '24:00'
  from (values ('12000000-0000-0000-0000-00000000000b'::uuid), ('12000000-0000-0000-0000-00000000000c'::uuid)) as v(t),
       generate_series(1, 7) d;

-- Barberos: K1 lun 08:00–20:00, mar 10:00–12:00, mié 09:00–14:00 · K2 y K3 lun 09:00–14:00
-- O1 y L1: 00:00–24:00 todos los días.
insert into public.barber_working_hours (tenant_id, barber_id, day_of_week, opens_at, closes_at) values
  ('12000000-0000-0000-0000-00000000000a', 'b2000000-0000-0000-0000-000000000001', 1, time '08:00', time '20:00'),
  ('12000000-0000-0000-0000-00000000000a', 'b2000000-0000-0000-0000-000000000001', 2, time '10:00', time '12:00'),
  ('12000000-0000-0000-0000-00000000000a', 'b2000000-0000-0000-0000-000000000001', 3, time '09:00', time '14:00'),
  ('12000000-0000-0000-0000-00000000000a', 'b2000000-0000-0000-0000-000000000002', 1, time '09:00', time '14:00'),
  ('12000000-0000-0000-0000-00000000000a', 'b2000000-0000-0000-0000-000000000003', 1, time '09:00', time '14:00');
insert into public.barber_working_hours (tenant_id, barber_id, day_of_week, opens_at, closes_at)
  select '12000000-0000-0000-0000-00000000000b', 'b2000000-0000-0000-0000-0000000000b1', d, time '00:00', time '24:00' from generate_series(1, 7) d;
insert into public.barber_working_hours (tenant_id, barber_id, day_of_week, opens_at, closes_at)
  select '12000000-0000-0000-0000-00000000000c', 'b2000000-0000-0000-0000-0000000000c1', d, time '00:00', time '24:00' from generate_series(1, 7) d;

-- Bloqueos del lunes: K1 12:30–12:45 · todo el local K 13:00–13:10.
insert into public.schedule_blocks (tenant_id, barber_id, starts_at, ends_at, reason) values
  ('12000000-0000-0000-0000-00000000000a', 'b2000000-0000-0000-0000-000000000001', pg_temp.lt('2030-06-03 12:30'), pg_temp.lt('2030-06-03 12:45'), 'K1'),
  ('12000000-0000-0000-0000-00000000000a', null,                                   pg_temp.lt('2030-06-03 13:00'), pg_temp.lt('2030-06-03 13:10'), 'local');

select pg_temp.check('fixture: 2030-06-03 es lunes, 06-04 martes, 06-05 miércoles',
  extract(isodow from date '2030-06-03') = 1 and extract(isodow from date '2030-06-04') = 2 and extract(isodow from date '2030-06-05') = 3);

-- =============================================================================
-- 1. Esquema y privilegios
-- =============================================================================
select pg_temp.check('UNIQUE (tenant_id, appointment_id, service_id) existe',
  exists (select 1 from pg_constraint where conrelid = 'public.appointment_services'::regclass
          and conname = 'appointment_services_appointment_service_key' and contype = 'u'));

select pg_temp.check('firmas nuevas y antiguas existen (4 funciones)',
  to_regprocedure('public.get_available_slots(text, uuid, uuid[], date)') is not null
  and to_regprocedure('public.get_available_slots(text, uuid, uuid, date)') is not null
  and to_regprocedure('public.book_appointment(text, uuid, uuid[], timestamptz, text, text, text)') is not null
  and to_regprocedure('public.book_appointment(text, uuid, uuid, timestamptz, text, text, text)') is not null);

select pg_temp.check('firmas nuevas: SECURITY DEFINER y search_path vacío',
  (select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
   from pg_proc p
   where p.oid in ('public.get_available_slots(text, uuid, uuid[], date)'::regprocedure,
                   'public.book_appointment(text, uuid, uuid[], timestamptz, text, text, text)'::regprocedure)),
  (select string_agg(p.oid::regprocedure::text || ' ' || p.prosecdef || ' ' || coalesce(p.proconfig::text, 'null'), '; ')
   from pg_proc p
   where p.oid in ('public.get_available_slots(text, uuid, uuid[], date)'::regprocedure,
                   'public.book_appointment(text, uuid, uuid[], timestamptz, text, text, text)'::regprocedure)));

select pg_temp.check('get_available_slots nueva es STABLE; book_appointment nueva es VOLATILE',
  (select provolatile from pg_proc where oid = 'public.get_available_slots(text, uuid, uuid[], date)'::regprocedure) = 's'
  and (select provolatile from pg_proc where oid = 'public.book_appointment(text, uuid, uuid[], timestamptz, text, text, text)'::regprocedure) = 'v');

select pg_temp.check('anon y authenticated pueden ejecutar las 4 funciones públicas',
  has_function_privilege('anon',          'public.get_available_slots(text, uuid, uuid[], date)', 'execute')
  and has_function_privilege('authenticated', 'public.get_available_slots(text, uuid, uuid[], date)', 'execute')
  and has_function_privilege('anon',          'public.book_appointment(text, uuid, uuid[], timestamptz, text, text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.book_appointment(text, uuid, uuid[], timestamptz, text, text, text)', 'execute')
  and has_function_privilege('anon',          'public.get_available_slots(text, uuid, uuid, date)', 'execute')
  and has_function_privilege('anon',          'public.book_appointment(text, uuid, uuid, timestamptz, text, text, text)', 'execute'));

select pg_temp.check('helpers privados: sin EXECUTE para anon ni authenticated',
  not exists (
    select 1
    from unnest(array[
      'private.lock_barber_agenda(uuid)',
      'private.resolve_booking_services(uuid, uuid[])',
      'private.within_business_hours(uuid, text, timestamptz, timestamptz)',
      'private.within_barber_hours(uuid, uuid, text, timestamptz, timestamptz)',
      'private.overlaps_schedule_block(uuid, uuid, timestamptz, timestamptz)',
      'private.overlaps_active_appointment(uuid, uuid, timestamptz, timestamptz)'
    ]) as f(sig)
    cross join (values ('anon'), ('authenticated')) as r(role)
    where has_function_privilege(r.role, f.sig, 'execute')
  ));

select pg_temp.check('helpers privados: SECURITY INVOKER con search_path vacío',
  (select bool_and(not p.prosecdef and p.proconfig @> array['search_path=""'])
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private'
     and p.proname in ('lock_barber_agenda', 'resolve_booking_services', 'within_business_hours',
                       'within_barber_hours', 'overlaps_schedule_block', 'overlaps_active_appointment')));

select pg_temp.as_user(null);
select pg_temp.expect_error('anon no puede llamar un helper privado', $q$
  select * from private.resolve_booking_services('12000000-0000-0000-0000-00000000000a', array['52000000-0000-0000-0000-000000000001'::uuid])
$q$, '42501');
select pg_temp.as_user('a2000000-0000-0000-0000-000000000001');
select pg_temp.expect_error('authenticated (admin) no puede llamar un helper privado', $q$
  select private.lock_barber_agenda('b2000000-0000-0000-0000-000000000001')
$q$, '42501');
select pg_temp.as_postgres();

-- =============================================================================
-- 2. Rejilla de 5 minutos (miércoles, K1 09:00–14:00, sin citas ni bloqueos)
-- =============================================================================
select pg_temp.as_user(null);  -- anon, como el sitio público
do $$
declare _n int; _first timestamptz; _last timestamptz; _misaligned int;
begin
  select count(*), min(slot_start), max(slot_start),
         count(*) filter (where extract(minute from slot_start at time zone 'America/Mexico_City')::int % 5 <> 0
                             or extract(second from slot_start at time zone 'America/Mexico_City') <> 0)
    into _n, _first, _last, _misaligned
  from public.get_available_slots('test-ms-k', 'b2000000-0000-0000-0000-000000000001',
                                  array['52000000-0000-0000-0000-000000000003'::uuid], '2030-06-05');
  perform pg_temp.check('rejilla: servicio de 10 min → 59 slots (09:00 … 13:50)', _n = 59, _n::text);
  perform pg_temp.check('rejilla: primer slot 09:00 local', _first = pg_temp.lt('2030-06-05 09:00'), _first::text);
  perform pg_temp.check('rejilla: último slot 13:50 local (termina a las 14:00)', _last = pg_temp.lt('2030-06-05 13:50'), _last::text);
  perform pg_temp.check('rejilla: todos alineados a 5 min locales', _misaligned = 0, _misaligned::text);
end $$;

-- Firma antigua: misma lista, solo múltiplos de 15 min.
do $$
declare _n int; _bad int; _diff int;
begin
  select count(*),
         count(*) filter (where extract(minute from slot_start at time zone 'America/Mexico_City')::int % 15 <> 0)
    into _n, _bad
  from public.get_available_slots('test-ms-k', 'b2000000-0000-0000-0000-000000000001',
                                  '52000000-0000-0000-0000-000000000003'::uuid, '2030-06-05');
  perform pg_temp.check('envoltorio slots (uuid): 20 slots de 15 min (09:00 … 13:45)', _n = 20 and _bad = 0, format('%s slots, %s no alineados', _n, _bad));

  select count(*) into _diff from (
    (select slot_start from public.get_available_slots('test-ms-k', 'b2000000-0000-0000-0000-000000000001',
                                  '52000000-0000-0000-0000-000000000003'::uuid, '2030-06-05')
     except
     select slot_start from public.get_available_slots('test-ms-k', 'b2000000-0000-0000-0000-000000000001',
                                  array['52000000-0000-0000-0000-000000000003'::uuid], '2030-06-05'))
  ) as d;
  perform pg_temp.check('envoltorio slots (uuid): subconjunto exacto de la firma nueva', _diff = 0, _diff::text);
end $$;

select pg_temp.expect_error('envoltorio slots (uuid): servicio NULL → P0002 (como antes)', $q$
  select * from public.get_available_slots('test-ms-k', 'b2000000-0000-0000-0000-000000000001', null::uuid, '2030-06-05')
$q$, 'P0002');

-- Horario del barbero (martes: local 24 h, K1 10:00–12:00).
select pg_temp.check('horario del barbero: martes con 30 min → 10:00 … 11:30',
  pg_temp.slot_list('test-ms-k', 'b2000000-0000-0000-0000-000000000001', array['52000000-0000-0000-0000-000000000001'::uuid], '2030-06-04')
    = '10:00 10:05 10:10 10:15 10:20 10:25 10:30 10:35 10:40 10:45 10:50 10:55 11:00 11:05 11:10 11:15 11:20 11:25 11:30',
  pg_temp.slot_list('test-ms-k', 'b2000000-0000-0000-0000-000000000001', array['52000000-0000-0000-0000-000000000001'::uuid], '2030-06-04'));

-- =============================================================================
-- 3. Validación de la lista de servicios (slots y reserva)
-- =============================================================================
select pg_temp.expect_error('slots: 0 servicios → 23514',
  $q$select * from public.get_available_slots('test-ms-k', 'b2000000-0000-0000-0000-000000000001', '{}'::uuid[], '2030-06-05')$q$, '23514');
select pg_temp.expect_error('slots: arreglo NULL → 23514',
  $q$select * from public.get_available_slots('test-ms-k', 'b2000000-0000-0000-0000-000000000001', null::uuid[], '2030-06-05')$q$, '23514');
select pg_temp.expect_error('slots: 6 servicios → 23514', $q$
  select * from public.get_available_slots('test-ms-k', 'b2000000-0000-0000-0000-000000000001',
    array['52000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000002','52000000-0000-0000-0000-000000000003',
          '52000000-0000-0000-0000-000000000004','52000000-0000-0000-0000-000000000005','52000000-0000-0000-0000-000000000006']::uuid[], '2030-06-05')
$q$, '23514');
select pg_temp.expect_error('slots: elemento NULL → 23514', $q$
  select * from public.get_available_slots('test-ms-k', 'b2000000-0000-0000-0000-000000000001',
    array['52000000-0000-0000-0000-000000000001'::uuid, null], '2030-06-05')
$q$, '23514');
select pg_temp.expect_error('slots: servicio repetido → 23514', $q$
  select * from public.get_available_slots('test-ms-k', 'b2000000-0000-0000-0000-000000000001',
    array['52000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000001']::uuid[], '2030-06-05')
$q$, '23514');
select pg_temp.expect_error('slots: arreglo de 2 dimensiones → 23514', $q$
  select * from public.get_available_slots('test-ms-k', 'b2000000-0000-0000-0000-000000000001',
    '{{52000000-0000-0000-0000-000000000001},{52000000-0000-0000-0000-000000000002}}'::uuid[], '2030-06-05')
$q$, '23514');
select pg_temp.expect_error('slots: servicio inactivo → P0002', $q$
  select * from public.get_available_slots('test-ms-k', 'b2000000-0000-0000-0000-000000000001',
    array['52000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000009']::uuid[], '2030-06-05')
$q$, 'P0002');
select pg_temp.expect_error('slots: servicio de OTRA barbería → P0002', $q$
  select * from public.get_available_slots('test-ms-k', 'b2000000-0000-0000-0000-000000000001',
    array['52000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-0000000000b1']::uuid[], '2030-06-05')
$q$, 'P0002');
select pg_temp.expect_error('slots: UUID inexistente → P0002', $q$
  select * from public.get_available_slots('test-ms-k', 'b2000000-0000-0000-0000-000000000001',
    array['52000000-0000-0000-0000-0000000000ff']::uuid[], '2030-06-05')
$q$, 'P0002');
select pg_temp.expect_error('slots: duración total > 1440 min → 23514', $q$
  select * from public.get_available_slots('test-ms-k', 'b2000000-0000-0000-0000-000000000001',
    array['52000000-0000-0000-0000-00000000000a','52000000-0000-0000-0000-00000000000b']::uuid[], '2030-06-05')
$q$, '23514');
select pg_temp.expect_ok('slots: un servicio de 1000 min (≤ 1440) es válido (lista vacía, no error)', $q$
  select * from public.get_available_slots('test-ms-k', 'b2000000-0000-0000-0000-000000000001',
    array['52000000-0000-0000-0000-00000000000a']::uuid[], '2030-06-05')
$q$);
select pg_temp.expect_error('slots: barbero de OTRA barbería → P0002', $q$
  select * from public.get_available_slots('test-ms-k', 'b2000000-0000-0000-0000-0000000000b1',
    array['52000000-0000-0000-0000-000000000001']::uuid[], '2030-06-05')
$q$, 'P0002');
select pg_temp.expect_error('slots: barbero inactivo → P0002', $q$
  select * from public.get_available_slots('test-ms-k', 'b2000000-0000-0000-0000-000000000003',
    array['52000000-0000-0000-0000-000000000001']::uuid[], '2030-06-03')
$q$, 'P0002');
select pg_temp.expect_error('slots: slug inexistente → P0002', $q$
  select * from public.get_available_slots('no-existe', 'b2000000-0000-0000-0000-000000000001',
    array['52000000-0000-0000-0000-000000000001']::uuid[], '2030-06-05')
$q$, 'P0002');

-- Reserva (martes 10:00 K1 sería válido; cada caso falla antes de crear nada).
select pg_temp.expect_error('reserva: 0 servicios → 23514',
  $q$select pg_temp.book('test-ms-k', 'b2000000-0000-0000-0000-000000000001', '{}'::uuid[], pg_temp.lt('2030-06-04 10:00'))$q$, '23514');
select pg_temp.expect_error('reserva: arreglo NULL → 23514',
  $q$select pg_temp.book('test-ms-k', 'b2000000-0000-0000-0000-000000000001', null::uuid[], pg_temp.lt('2030-06-04 10:00'))$q$, '23514');
select pg_temp.expect_error('reserva: 6 servicios → 23514', $q$
  select pg_temp.book('test-ms-k', 'b2000000-0000-0000-0000-000000000001',
    array['52000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000002','52000000-0000-0000-0000-000000000003',
          '52000000-0000-0000-0000-000000000004','52000000-0000-0000-0000-000000000005','52000000-0000-0000-0000-000000000006']::uuid[],
    pg_temp.lt('2030-06-04 10:00'))
$q$, '23514');
select pg_temp.expect_error('reserva: elemento NULL → 23514', $q$
  select pg_temp.book('test-ms-k', 'b2000000-0000-0000-0000-000000000001',
    array['52000000-0000-0000-0000-000000000001'::uuid, null], pg_temp.lt('2030-06-04 10:00'))
$q$, '23514');
select pg_temp.expect_error('reserva: servicio repetido → 23514', $q$
  select pg_temp.book('test-ms-k', 'b2000000-0000-0000-0000-000000000001',
    array['52000000-0000-0000-0000-000000000002','52000000-0000-0000-0000-000000000002']::uuid[], pg_temp.lt('2030-06-04 10:00'))
$q$, '23514');
select pg_temp.expect_error('reserva: servicio inactivo → P0002', $q$
  select pg_temp.book('test-ms-k', 'b2000000-0000-0000-0000-000000000001',
    array['52000000-0000-0000-0000-000000000009']::uuid[], pg_temp.lt('2030-06-04 10:00'))
$q$, 'P0002');
select pg_temp.expect_error('reserva: servicio de OTRA barbería → P0002', $q$
  select pg_temp.book('test-ms-k', 'b2000000-0000-0000-0000-000000000001',
    array['52000000-0000-0000-0000-0000000000b1']::uuid[], pg_temp.lt('2030-06-04 10:00'))
$q$, 'P0002');
select pg_temp.expect_error('reserva: duración total > 1440 min → 23514', $q$
  select pg_temp.book('test-ms-k', 'b2000000-0000-0000-0000-000000000001',
    array['52000000-0000-0000-0000-00000000000a','52000000-0000-0000-0000-00000000000b']::uuid[], pg_temp.lt('2030-06-04 10:00'))
$q$, '23514');
select pg_temp.expect_error('reserva: barbero de OTRA barbería (slug K, barbero O) → P0002', $q$
  select pg_temp.book('test-ms-k', 'b2000000-0000-0000-0000-0000000000b1',
    array['52000000-0000-0000-0000-000000000001']::uuid[], pg_temp.lt('2030-06-04 10:00'))
$q$, 'P0002');
select pg_temp.expect_error('reserva: slug O con servicio de K → P0002', $q$
  select pg_temp.book('test-ms-o', 'b2000000-0000-0000-0000-0000000000b1',
    array['52000000-0000-0000-0000-000000000001']::uuid[], pg_temp.lt('2030-06-04 10:00'))
$q$, 'P0002');
select pg_temp.expect_error('reserva: nombre vacío → 23514', $q$
  select public.book_appointment('test-ms-k', 'b2000000-0000-0000-0000-000000000001',
    array['52000000-0000-0000-0000-000000000001']::uuid[], pg_temp.lt('2030-06-04 10:00'), '   ', '5500000000', null)
$q$, '23514');
select pg_temp.expect_error('reserva: teléfono inválido → 23514', $q$
  select public.book_appointment('test-ms-k', 'b2000000-0000-0000-0000-000000000001',
    array['52000000-0000-0000-0000-000000000001']::uuid[], pg_temp.lt('2030-06-04 10:00'), 'X', '123', null)
$q$, '23514');
select pg_temp.expect_error('reserva: no alineada a 5 min (10:02) → 23514', $q$
  select pg_temp.book('test-ms-k', 'b2000000-0000-0000-0000-000000000001',
    array['52000000-0000-0000-0000-000000000001']::uuid[], pg_temp.lt('2030-06-04 10:02'))
$q$, '23514');
select pg_temp.expect_error('reserva: con segundos (10:05:30) → 23514', $q$
  select pg_temp.book('test-ms-k', 'b2000000-0000-0000-0000-000000000001',
    array['52000000-0000-0000-0000-000000000001']::uuid[], pg_temp.lt('2030-06-04 10:05:30'))
$q$, '23514');
select pg_temp.expect_error('reserva: fuera del horario del barbero (martes 09:00) → 23514', $q$
  select pg_temp.book('test-ms-k', 'b2000000-0000-0000-0000-000000000001',
    array['52000000-0000-0000-0000-000000000001']::uuid[], pg_temp.lt('2030-06-04 09:00'))
$q$, '23514');
select pg_temp.expect_error('reserva: termina fuera del horario del barbero (martes 11:45 + 30) → 23514', $q$
  select pg_temp.book('test-ms-k', 'b2000000-0000-0000-0000-000000000001',
    array['52000000-0000-0000-0000-000000000001']::uuid[], pg_temp.lt('2030-06-04 11:45'))
$q$, '23514');

select pg_temp.as_postgres();
select pg_temp.check('ninguna de las reservas inválidas creó citas ni clientes',
  not exists (select 1 from public.appointments where tenant_id in ('12000000-0000-0000-0000-00000000000a', '12000000-0000-0000-0000-00000000000b'))
  and not exists (select 1 from public.clients where tenant_id in ('12000000-0000-0000-0000-00000000000a', '12000000-0000-0000-0000-00000000000b')));

-- =============================================================================
-- 4. Reserva multi-servicio: sumas, orden, snapshot y forma de respuesta
-- =============================================================================
select pg_temp.as_user(null);
do $$
declare _r jsonb; _id uuid; _a record; _n int; _keys text[];
begin
  -- Lunes K1: A = Corte (30) a las 10:00
  _r := pg_temp.book('test-ms-k', 'b2000000-0000-0000-0000-000000000001',
                     array['52000000-0000-0000-0000-000000000001']::uuid[], pg_temp.lt('2030-06-03 10:00'), '5511110001');
  perform pg_temp.check('reserva 1 servicio (anon): creada', _r ? 'appointment_id', _r::text);

  -- Lunes K1: M = Corte + Barba + Ceja (30 + 20 + 10) a las 11:00
  _r := pg_temp.book('test-ms-k', 'b2000000-0000-0000-0000-000000000001',
                     array['52000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000002','52000000-0000-0000-0000-000000000003']::uuid[],
                     pg_temp.lt('2030-06-03 11:00'), '55 1111 0002');
  _id := (_r->>'appointment_id')::uuid;
  perform set_config('test.m_id', _id::text, true);

  select array_agg(k order by k) into _keys from jsonb_object_keys(_r) k;
  perform pg_temp.check('respuesta: claves exactas del contrato',
    _keys = array['appointment_id','barber_id','client','end_at','services','start_at','status','total_duration_minutes','total_price_cents'],
    _keys::text);
  perform pg_temp.check('respuesta: status pending y barber_id', _r->>'status' = 'pending' and (_r->>'barber_id')::uuid = 'b2000000-0000-0000-0000-000000000001');
  perform pg_temp.check('respuesta: total_duration_minutes = 60', (_r->>'total_duration_minutes')::int = 60, _r->>'total_duration_minutes');
  perform pg_temp.check('respuesta: total_price_cents = 45000', (_r->>'total_price_cents')::bigint = 45000, _r->>'total_price_cents');
  perform pg_temp.check('respuesta: start_at 11:00 y end_at 12:00 locales',
    (_r->>'start_at')::timestamptz = pg_temp.lt('2030-06-03 11:00') and (_r->>'end_at')::timestamptz = pg_temp.lt('2030-06-03 12:00'),
    (_r->>'start_at') || ' / ' || (_r->>'end_at'));
  perform pg_temp.check('respuesta: services en el orden del arreglo con position 0..2',
    jsonb_array_length(_r->'services') = 3
    and (_r->'services'->0->>'id')::uuid = '52000000-0000-0000-0000-000000000001' and (_r->'services'->0->>'position')::int = 0
    and (_r->'services'->1->>'id')::uuid = '52000000-0000-0000-0000-000000000002' and (_r->'services'->1->>'position')::int = 1
    and (_r->'services'->2->>'id')::uuid = '52000000-0000-0000-0000-000000000003' and (_r->'services'->2->>'position')::int = 2,
    _r->>'services');
  perform pg_temp.check('respuesta: cada servicio con id, name, price_cents, duration_minutes, position',
    (select bool_and((select array_agg(k order by k) from jsonb_object_keys(e) k) = array['duration_minutes','id','name','position','price_cents'])
     from jsonb_array_elements(_r->'services') e)
    and _r->'services'->1->>'name' = 'Barba' and (_r->'services'->1->>'price_cents')::int = 15000
    and (_r->'services'->1->>'duration_minutes')::int = 20);
  perform pg_temp.check('respuesta: cliente con teléfono normalizado',
    _r->'client'->>'phone' = '+525511110002' and _r->'client'->>'name' = 'Cliente Prueba' and (_r->'client'->>'id') is not null);

  perform pg_temp.as_postgres();
  select * into _a from public.appointments where id = _id;
  perform pg_temp.check('cita: pending, online, created_by NULL', _a.status = 'pending' and _a.source = 'online' and _a.created_by is null);
  perform pg_temp.check('cita: end_at − start_at = 60 min', _a.end_at - _a.start_at = interval '60 minutes');
  perform pg_temp.check('cita: occupied_until = 11:50 (60 − 10)', _a.occupied_until = pg_temp.lt('2030-06-03 11:50'), _a.occupied_until::text);
  select count(*) into _n from public.appointment_services where appointment_id = _id;
  perform pg_temp.check('cita: 3 líneas', _n = 3, _n::text);
  perform pg_temp.check('líneas: snapshot del catálogo, position por orden del arreglo, comisión NULL',
    (select bool_and(l.service_name = s.name and l.price_cents = s.price_cents and l.duration_minutes = s.duration_minutes
                     and l.commission_rate_bps is null and l.tenant_id = s.tenant_id)
     from public.appointment_services l join public.services s on s.id = l.service_id
     where l.appointment_id = _id)
    and (select array_agg(l.service_id order by l.position) from public.appointment_services l where l.appointment_id = _id)
        = array['52000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000002','52000000-0000-0000-0000-000000000003']::uuid[]
    and (select array_agg(l.position order by l.position) from public.appointment_services l where l.appointment_id = _id) = array[0,1,2]::smallint[]);
  perform pg_temp.check('locks: la reserva tomó el advisory lock de agenda del barbero (10102)',
    exists (select 1 from pg_locks
            where locktype = 'advisory' and pid = pg_backend_pid() and classid = 10102 and objsubid = 2
              and objid::bigint = (hashtext('b2000000-0000-0000-0000-000000000001')::bigint & 4294967295)));
  perform pg_temp.check('locks: la inserción de líneas tomó el advisory lock por cita (10101)',
    exists (select 1 from pg_locks
            where locktype = 'advisory' and pid = pg_backend_pid() and classid = 10101 and objsubid = 2
              and objid::bigint = (hashtext(_id::text)::bigint & 4294967295)));
exception when others then
  perform pg_temp.as_postgres();
  perform pg_temp.check('reserva multi-servicio funciona', false, sqlstate || ' ' || sqlerrm);
end $$;

-- 5 servicios en orden inverso al catálogo (lunes K2 09:00): 25+15+10+20+30 = 100 min.
select pg_temp.as_user(null);
do $$
declare _r jsonb; _id uuid;
begin
  _r := pg_temp.book('test-ms-k', 'b2000000-0000-0000-0000-000000000002',
                     array['52000000-0000-0000-0000-000000000005','52000000-0000-0000-0000-000000000004','52000000-0000-0000-0000-000000000003',
                           '52000000-0000-0000-0000-000000000002','52000000-0000-0000-0000-000000000001']::uuid[],
                     pg_temp.lt('2030-06-03 09:00'), '5511110003');
  _id := (_r->>'appointment_id')::uuid;
  perform pg_temp.check('5 servicios: total 100 min y 65000 centavos',
    (_r->>'total_duration_minutes')::int = 100 and (_r->>'total_price_cents')::bigint = 65000,
    (_r->>'total_duration_minutes') || ' / ' || (_r->>'total_price_cents'));
  perform pg_temp.check('5 servicios: end_at 10:40', (_r->>'end_at')::timestamptz = pg_temp.lt('2030-06-03 10:40'), _r->>'end_at');
  perform pg_temp.check('5 servicios: services[0] = Masaje (orden del arreglo, no del catálogo)',
    _r->'services'->0->>'name' = 'Masaje' and _r->'services'->4->>'name' = 'Corte', _r->>'services');
  perform pg_temp.as_postgres();
  perform pg_temp.check('5 servicios: 5 líneas guardadas',
    (select count(*) from public.appointment_services where appointment_id = _id) = 5);
exception when others then
  perform pg_temp.as_postgres();
  perform pg_temp.check('reserva de 5 servicios funciona', false, sqlstate || ' ' || sqlerrm);
end $$;

-- authenticated también puede reservar; created_by sigue NULL (reserva pública).
select pg_temp.as_user('a2000000-0000-0000-0000-000000000002');
do $$
declare _r jsonb;
begin
  _r := pg_temp.book('test-ms-k', 'b2000000-0000-0000-0000-000000000001',
                     array['52000000-0000-0000-0000-000000000002','52000000-0000-0000-0000-000000000003']::uuid[],
                     pg_temp.lt('2030-06-05 12:00'), '5511110004');
  perform pg_temp.as_postgres();
  perform pg_temp.check('reserva (authenticated): created_by NULL, source online',
    exists (select 1 from public.appointments where id = (_r->>'appointment_id')::uuid and created_by is null and source = 'online'));
exception when others then
  perform pg_temp.as_postgres();
  perform pg_temp.check('reserva (authenticated) funciona', false, sqlstate || ' ' || sqlerrm);
end $$;

-- =============================================================================
-- 5. Disponibilidad con ocupación, bloqueos estrictos y cierre (lunes)
-- =============================================================================
-- Lunes K1 (local 09:00–14:00, K1 08:00–20:00 → efectivo 09:00–14:00):
--   A 10:00–10:30 (ocupa hasta 10:20) · M 11:00–12:00 (ocupa hasta 11:50)
--   bloqueo K1 12:30–12:45 · bloqueo del local 13:00–13:10
-- Corte (30 min, ocupa 20):
select pg_temp.as_user(null);
select pg_temp.check('margen: 09:40 disponible (ocupa 09:40–10:00, no toca A)',  pg_temp.has_slot('test-ms-k', 'b2000000-0000-0000-0000-000000000001', array['52000000-0000-0000-0000-000000000001']::uuid[], '2030-06-03', '09:40'));
select pg_temp.check('margen: 09:45 NO disponible',                              not pg_temp.has_slot('test-ms-k', 'b2000000-0000-0000-0000-000000000001', array['52000000-0000-0000-0000-000000000001']::uuid[], '2030-06-03', '09:45'));
select pg_temp.check('margen: 10:15 NO disponible (A ocupa hasta 10:20)',        not pg_temp.has_slot('test-ms-k', 'b2000000-0000-0000-0000-000000000001', array['52000000-0000-0000-0000-000000000001']::uuid[], '2030-06-03', '10:15'));
select pg_temp.check('margen: 10:20 disponible (A 10:00–10:30 ocupa hasta 10:20)', pg_temp.has_slot('test-ms-k', 'b2000000-0000-0000-0000-000000000001', array['52000000-0000-0000-0000-000000000001']::uuid[], '2030-06-03', '10:20'));
select pg_temp.check('margen: 10:40 disponible (ocupa 10:40–11:00)',             pg_temp.has_slot('test-ms-k', 'b2000000-0000-0000-0000-000000000001', array['52000000-0000-0000-0000-000000000001']::uuid[], '2030-06-03', '10:40'));
select pg_temp.check('multi: 10:45 y 11:45 NO disponibles (M ocupa 11:00–11:50)',
  not pg_temp.has_slot('test-ms-k', 'b2000000-0000-0000-0000-000000000001', array['52000000-0000-0000-0000-000000000001']::uuid[], '2030-06-03', '10:45')
  and not pg_temp.has_slot('test-ms-k', 'b2000000-0000-0000-0000-000000000001', array['52000000-0000-0000-0000-000000000001']::uuid[], '2030-06-03', '11:45'));
select pg_temp.check('multi: 11:50 disponible (M 11:00–12:00 ocupa hasta 11:50)', pg_temp.has_slot('test-ms-k', 'b2000000-0000-0000-0000-000000000001', array['52000000-0000-0000-0000-000000000001']::uuid[], '2030-06-03', '11:50'));
select pg_temp.check('bloqueo: 12:00 disponible (termina 12:30, bloqueo [12:30, 12:45))', pg_temp.has_slot('test-ms-k', 'b2000000-0000-0000-0000-000000000001', array['52000000-0000-0000-0000-000000000001']::uuid[], '2030-06-03', '12:00'));
select pg_temp.check('bloqueo estricto: 12:05 NO disponible (su ocupación 12:05–12:25 no toca el bloqueo, el servicio completo sí)',
  not pg_temp.has_slot('test-ms-k', 'b2000000-0000-0000-0000-000000000001', array['52000000-0000-0000-0000-000000000001']::uuid[], '2030-06-03', '12:05'));
select pg_temp.check('bloqueo del local: 12:45 y 13:05 NO disponibles',
  not pg_temp.has_slot('test-ms-k', 'b2000000-0000-0000-0000-000000000001', array['52000000-0000-0000-0000-000000000001']::uuid[], '2030-06-03', '12:45')
  and not pg_temp.has_slot('test-ms-k', 'b2000000-0000-0000-0000-000000000001', array['52000000-0000-0000-0000-000000000001']::uuid[], '2030-06-03', '13:05'));
select pg_temp.check('bloqueo del local: 13:10 disponible',                      pg_temp.has_slot('test-ms-k', 'b2000000-0000-0000-0000-000000000001', array['52000000-0000-0000-0000-000000000001']::uuid[], '2030-06-03', '13:10'));
select pg_temp.check('cierre: 13:30 disponible (30 min terminan 14:00)',         pg_temp.has_slot('test-ms-k', 'b2000000-0000-0000-0000-000000000001', array['52000000-0000-0000-0000-000000000001']::uuid[], '2030-06-03', '13:30'));
select pg_temp.check('cierre: 13:35 NO disponible (usa end_at, no la ocupación)', not pg_temp.has_slot('test-ms-k', 'b2000000-0000-0000-0000-000000000001', array['52000000-0000-0000-0000-000000000001']::uuid[], '2030-06-03', '13:35'));
select pg_temp.check('apertura: 08:55 NO disponible (el local abre 09:00 aunque K1 entra 08:00)',
  not pg_temp.has_slot('test-ms-k', 'b2000000-0000-0000-0000-000000000001', array['52000000-0000-0000-0000-000000000001']::uuid[], '2030-06-03', '08:55'));

-- Facial (45 min) con cierre a las 14:00.
select pg_temp.check('45 min: 13:15 disponible (termina 14:00)',  pg_temp.has_slot('test-ms-k', 'b2000000-0000-0000-0000-000000000001', array['52000000-0000-0000-0000-000000000045']::uuid[], '2030-06-03', '13:15'));
select pg_temp.check('45 min: 13:30 NO aparece (cierre 14:00)',   not pg_temp.has_slot('test-ms-k', 'b2000000-0000-0000-0000-000000000001', array['52000000-0000-0000-0000-000000000045']::uuid[], '2030-06-03', '13:30'));
select pg_temp.check('45 min: 13:20 NO aparece',                  not pg_temp.has_slot('test-ms-k', 'b2000000-0000-0000-0000-000000000001', array['52000000-0000-0000-0000-000000000045']::uuid[], '2030-06-03', '13:20'));

-- K2 con Ceja (10 min): su cita de 5 servicios 09:00–10:40 ocupa hasta 10:30;
-- el bloqueo del local 13:00–13:10 también le aplica.
select pg_temp.check('K2: lista exacta de slots de 10 min',
  pg_temp.slot_list('test-ms-k', 'b2000000-0000-0000-0000-000000000002', array['52000000-0000-0000-0000-000000000003']::uuid[], '2030-06-03')
  = (select string_agg(to_char(t, 'HH24:MI'), ' ' order by t)
     from generate_series(timestamp '2030-06-03 10:30', timestamp '2030-06-03 13:50', interval '5 minutes') t
     where t not in (timestamp '2030-06-03 12:55', timestamp '2030-06-03 13:00', timestamp '2030-06-03 13:05')),
  pg_temp.slot_list('test-ms-k', 'b2000000-0000-0000-0000-000000000002', array['52000000-0000-0000-0000-000000000003']::uuid[], '2030-06-03'));

-- Multi-servicio en los slots: Corte + Barba (50 min, ocupa 40) en K1 lunes.
select pg_temp.check('multi en slots: 09:00 sí (ocupa 09:00–09:40, termina 09:50)',
  pg_temp.has_slot('test-ms-k', 'b2000000-0000-0000-0000-000000000001',
    array['52000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000002']::uuid[], '2030-06-03', '09:00'));
select pg_temp.check('multi en slots: 09:25 NO (ocuparía 09:25–10:05, choca con A)',
  not pg_temp.has_slot('test-ms-k', 'b2000000-0000-0000-0000-000000000001',
    array['52000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000002']::uuid[], '2030-06-03', '09:25'));
select pg_temp.check('multi en slots: 09:20 sí (ocupa 09:20–10:00)',
  pg_temp.has_slot('test-ms-k', 'b2000000-0000-0000-0000-000000000001',
    array['52000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000002']::uuid[], '2030-06-03', '09:20'));

-- =============================================================================
-- 6. La reserva coincide con los slots y nunca crea traslapes
-- =============================================================================
-- Para cada punto de la rejilla del lunes (07:00 … 15:00) se intenta reservar
-- Corte con K1 dentro de una subtransacción que se deshace siempre. La reserva
-- debe tener éxito exactamente en los slots ofrecidos, y fallar en el resto
-- solo con 23514 o P0003.
select pg_temp.as_user(null);
do $$
declare
  _t       timestamptz;
  _offered boolean;
  _booked  boolean;
  _code    text;
  _mismatch text := '';
  _badcode  text := '';
begin
  for _t in select generate_series(pg_temp.lt('2030-06-03 07:00'), pg_temp.lt('2030-06-03 15:00'), interval '5 minutes') loop
    _offered := exists (select 1 from public.get_available_slots('test-ms-k', 'b2000000-0000-0000-0000-000000000001',
                          array['52000000-0000-0000-0000-000000000001']::uuid[], '2030-06-03') s where s.slot_start = _t);
    _code := null;
    begin
      perform pg_temp.book('test-ms-k', 'b2000000-0000-0000-0000-000000000001',
                           array['52000000-0000-0000-0000-000000000001']::uuid[], _t, '5522220000');
      raise exception 'deshacer' using errcode = 'TS001';
    exception
      when sqlstate 'TS001' then _booked := true;
      when others then _booked := false; _code := sqlstate;
    end;
    if _booked is distinct from _offered then
      _mismatch := _mismatch || format(' %s(ofrecido=%s,reservado=%s,%s)', to_char(_t at time zone 'America/Mexico_City', 'HH24:MI'), _offered, _booked, coalesce(_code, '-'));
    end if;
    if not _booked and _code not in ('23514', 'P0003') then
      _badcode := _badcode || format(' %s:%s', to_char(_t at time zone 'America/Mexico_City', 'HH24:MI'), _code);
    end if;
  end loop;
  perform pg_temp.check('reserva ⇔ slot ofrecido en cada punto de 07:00 a 15:00', _mismatch = '', nullif(_mismatch, ''));
  perform pg_temp.check('rechazos solo con 23514 o P0003', _badcode = '', nullif(_badcode, ''));
end $$;

select pg_temp.expect_error('reserva sobre la ocupación de A (10:15) → P0003', $q$
  select pg_temp.book('test-ms-k', 'b2000000-0000-0000-0000-000000000001', array['52000000-0000-0000-0000-000000000001']::uuid[], pg_temp.lt('2030-06-03 10:15'))
$q$, 'P0003');
select pg_temp.expect_error('reserva multi (Corte+Barba+Ceja a las 10:20, ocupa hasta 11:10) choca con M → P0003', $q$
  select pg_temp.book('test-ms-k', 'b2000000-0000-0000-0000-000000000001',
    array['52000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000002','52000000-0000-0000-0000-000000000003']::uuid[],
    pg_temp.lt('2030-06-03 10:20'))
$q$, 'P0003');
select pg_temp.expect_error('reserva con bloqueo estricto (12:05 Corte) → 23514', $q$
  select pg_temp.book('test-ms-k', 'b2000000-0000-0000-0000-000000000001', array['52000000-0000-0000-0000-000000000001']::uuid[], pg_temp.lt('2030-06-03 12:05'))
$q$, '23514');
select pg_temp.expect_error('reserva 45 min a las 13:30 con cierre 14:00 → 23514', $q$
  select pg_temp.book('test-ms-k', 'b2000000-0000-0000-0000-000000000001', array['52000000-0000-0000-0000-000000000045']::uuid[], pg_temp.lt('2030-06-03 13:30'))
$q$, '23514');
select pg_temp.expect_ok('reserva en el margen (10:20 Corte) → permitida', $q$
  select pg_temp.book('test-ms-k', 'b2000000-0000-0000-0000-000000000001', array['52000000-0000-0000-0000-000000000001']::uuid[], pg_temp.lt('2030-06-03 10:20'))
$q$);

select pg_temp.as_postgres();
select pg_temp.check('ningún par de citas activas del mismo barbero se traslapa en su ocupación',
  not exists (
    select 1 from public.appointments a join public.appointments b
      on a.barber_id = b.barber_id and a.id < b.id
    where a.tenant_id = '12000000-0000-0000-0000-00000000000a'
      and a.status in ('pending', 'confirmed', 'completed') and b.status in ('pending', 'confirmed', 'completed')
      and tstzrange(a.start_at, a.occupied_until, '[)') && tstzrange(b.start_at, b.occupied_until, '[)')));

-- =============================================================================
-- 7. Anticipación mínima pública de 15 minutos (barbería L, 24 h, servicio de 5 min)
-- =============================================================================
select pg_temp.as_user(null);
do $$
declare
  _tz        text := 'America/Mexico_City';
  _min       timestamptz := now() + interval '15 minutes';
  _day       date := (_min at time zone _tz)::date;
  _midnight  timestamptz := (_day::timestamp) at time zone _tz;
  _expected  timestamptz := _midnight + make_interval(secs => (ceil(extract(epoch from (_min - _midnight)) / 300) * 300)::double precision);
  _first     timestamptz;
  _early     int;
begin
  -- Se consultan el día del mínimo y el siguiente: si el mínimo cae en los
  -- últimos minutos del día, el primer punto de la rejilla es la medianoche.
  select min(s.slot_start), count(*) filter (where s.slot_start < _min)
    into _first, _early
  from (
    select slot_start from public.get_available_slots('test-ms-l', 'b2000000-0000-0000-0000-0000000000c1',
                                  array['52000000-0000-0000-0000-0000000000c1']::uuid[], _day)
    union all
    select slot_start from public.get_available_slots('test-ms-l', 'b2000000-0000-0000-0000-0000000000c1',
                                  array['52000000-0000-0000-0000-0000000000c1']::uuid[], _day + 1)
  ) as s;
  perform pg_temp.check('anticipación: ningún slot antes de now() + 15 min', _early = 0, _early::text);
  perform pg_temp.check('anticipación: el primer slot es el primer punto de la rejilla ≥ now() + 15 min',
    _first = _expected, format('primero=%s esperado=%s', _first, _expected));

  -- Un punto de la rejilla antes del mínimo (puede ser pasado o dentro de los 15 min): 23514.
  begin
    perform pg_temp.book('test-ms-l', 'b2000000-0000-0000-0000-0000000000c1',
                         array['52000000-0000-0000-0000-0000000000c1']::uuid[], _expected - interval '5 minutes', '5533330001');
    perform pg_temp.check('anticipación: reservar 5 min antes del primer slot → 23514', false, 'no falló');
  exception when others then
    perform pg_temp.check('anticipación: reservar 5 min antes del primer slot → 23514', sqlstate = '23514', sqlstate || ' ' || sqlerrm);
  end;

  begin
    perform pg_temp.book('test-ms-l', 'b2000000-0000-0000-0000-0000000000c1',
                         array['52000000-0000-0000-0000-0000000000c1']::uuid[], _expected, '5533330002');
    perform pg_temp.check('anticipación: reservar en el primer slot → OK', true);
  exception when others then
    perform pg_temp.check('anticipación: reservar en el primer slot → OK', false, sqlstate || ' ' || sqlerrm);
  end;

  begin
    perform pg_temp.book('test-ms-l', 'b2000000-0000-0000-0000-0000000000c1',
                         array['52000000-0000-0000-0000-0000000000c1']::uuid[],
                         date_trunc('hour', now()) - interval '1 hour', '5533330003');
    perform pg_temp.check('pasado: reservar hace 1 h → 23514', false, 'no falló');
  exception when others then
    perform pg_temp.check('pasado: reservar hace 1 h → 23514', sqlstate = '23514', sqlstate || ' ' || sqlerrm);
  end;
end $$;

-- =============================================================================
-- 8. Envoltorio antiguo de book_appointment (firma _service_id uuid)
-- =============================================================================
select pg_temp.as_user(null);
do $$
declare _r jsonb; _keys text[];
begin
  _r := public.book_appointment('test-ms-k', 'b2000000-0000-0000-0000-000000000001', '52000000-0000-0000-0000-000000000002'::uuid,
                                pg_temp.lt('2030-06-05 10:00'), 'Cliente Antiguo', '5544440001', 'nota');
  select array_agg(k order by k) into _keys from jsonb_object_keys(_r) k;
  perform pg_temp.check('envoltorio reserva: claves de la respuesta ANTIGUA',
    _keys = array['appointment_id','barber_id','client','end_at','service','start_at','status'], _keys::text);
  perform pg_temp.check('envoltorio reserva: service = {id, name, price_cents, duration_minutes} sin position',
    (select array_agg(k order by k) from jsonb_object_keys(_r->'service') k) = array['duration_minutes','id','name','price_cents']
    and (_r->'service'->>'id')::uuid = '52000000-0000-0000-0000-000000000002'
    and _r->'service'->>'name' = 'Barba' and (_r->'service'->>'price_cents')::int = 15000
    and (_r->'service'->>'duration_minutes')::int = 20,
    _r->>'service');
  perform pg_temp.check('envoltorio reserva: end_at = start_at + 20 min',
    (_r->>'end_at')::timestamptz - (_r->>'start_at')::timestamptz = interval '20 minutes');
  perform pg_temp.as_postgres();
  perform pg_temp.check('envoltorio reserva: 1 línea, nota guardada',
    (select count(*) from public.appointment_services where appointment_id = (_r->>'appointment_id')::uuid) = 1
    and exists (select 1 from public.appointments where id = (_r->>'appointment_id')::uuid and client_note = 'nota'));
exception when others then
  perform pg_temp.as_postgres();
  perform pg_temp.check('envoltorio reserva funciona', false, sqlstate || ' ' || sqlerrm);
end $$;

select pg_temp.as_user(null);
select pg_temp.expect_error('envoltorio reserva: servicio NULL → P0002 (como antes)', $q$
  select public.book_appointment('test-ms-k', 'b2000000-0000-0000-0000-000000000001', null::uuid,
    pg_temp.lt('2030-06-05 11:00'), 'X', '5544440002', null)
$q$, 'P0002');
select pg_temp.expect_error('envoltorio reserva: servicio inactivo → P0002', $q$
  select public.book_appointment('test-ms-k', 'b2000000-0000-0000-0000-000000000001', '52000000-0000-0000-0000-000000000009'::uuid,
    pg_temp.lt('2030-06-05 11:00'), 'X', '5544440002', null)
$q$, 'P0002');
select pg_temp.expect_error('envoltorio reserva: traslape → P0003', $q$
  select public.book_appointment('test-ms-k', 'b2000000-0000-0000-0000-000000000001', '52000000-0000-0000-0000-000000000001'::uuid,
    pg_temp.lt('2030-06-05 10:00'), 'X', '5544440002', null)
$q$, 'P0003');
-- Comportamiento heredado (documentado): la firma antigua ya no exige 15 min,
-- acepta la rejilla de 5 min de la firma nueva.
select pg_temp.expect_ok('envoltorio reserva: acepta inicio alineado a 5 min (11:05)', $q$
  select public.book_appointment('test-ms-k', 'b2000000-0000-0000-0000-000000000001', '52000000-0000-0000-0000-000000000003'::uuid,
    pg_temp.lt('2030-06-05 11:05'), 'X', '5544440003', null)
$q$);
select pg_temp.expect_error('literal sin tipo en la posición del servicio: ambiguo (42725)', $q$
  select public.book_appointment('test-ms-k', 'b2000000-0000-0000-0000-000000000001', '52000000-0000-0000-0000-000000000003',
    pg_temp.lt('2030-06-05 13:00'), 'X', '5544440004', null)
$q$, '42725');

-- =============================================================================
-- 9. Migration B: tope de 5 líneas y UNIQUE por inserción directa
-- =============================================================================
-- M (lunes 11:00, K1) tiene 3 líneas: Corte, Barba, Ceja.
select pg_temp.as_user('a2000000-0000-0000-0000-000000000002');  -- barbero K1 (dueño)
select pg_temp.expect_ok('barbero: 4ª línea (Lavado) en su cita', format($q$
  insert into public.appointment_services (tenant_id, appointment_id, service_id, service_name, price_cents, duration_minutes, position)
  values ('12000000-0000-0000-0000-00000000000a', %L, '52000000-0000-0000-0000-000000000004', 'x', 1, 1, 3)
$q$, current_setting('test.m_id')));
select pg_temp.expect_error('barbero: servicio repetido (Corte) → 23505', format($q$
  insert into public.appointment_services (tenant_id, appointment_id, service_id, service_name, price_cents, duration_minutes, position)
  values ('12000000-0000-0000-0000-00000000000a', %L, '52000000-0000-0000-0000-000000000001', 'x', 1, 1, 4)
$q$, current_setting('test.m_id')), '23505');

select pg_temp.as_user('a2000000-0000-0000-0000-000000000003');  -- barbero K2 (no es su cita)
select pg_temp.expect_error('otro barbero: línea en la cita de K1 → 23503', format($q$
  insert into public.appointment_services (tenant_id, appointment_id, service_id, service_name, price_cents, duration_minutes, position)
  values ('12000000-0000-0000-0000-00000000000a', %L, '52000000-0000-0000-0000-000000000005', 'x', 1, 1, 4)
$q$, current_setting('test.m_id')), '23503');

select pg_temp.as_user('a2000000-0000-0000-0000-000000000004');  -- admin de O
select pg_temp.expect_error('admin de otra barbería: línea en la cita de K → 23503', format($q$
  insert into public.appointment_services (tenant_id, appointment_id, service_id, service_name, price_cents, duration_minutes, position)
  values ('12000000-0000-0000-0000-00000000000a', %L, '52000000-0000-0000-0000-000000000005', 'x', 1, 1, 4)
$q$, current_setting('test.m_id')), '23503');

select pg_temp.as_user('a2000000-0000-0000-0000-000000000001');  -- admin K
select pg_temp.expect_ok('admin: 5ª línea (Masaje)', format($q$
  insert into public.appointment_services (tenant_id, appointment_id, service_id, service_name, price_cents, duration_minutes, position)
  values ('12000000-0000-0000-0000-00000000000a', %L, '52000000-0000-0000-0000-000000000005', 'x', 1, 1, 4)
$q$, current_setting('test.m_id')));
select pg_temp.expect_error('admin: 6ª línea (Tinte) → BA006', format($q$
  insert into public.appointment_services (tenant_id, appointment_id, service_id, service_name, price_cents, duration_minutes, position)
  values ('12000000-0000-0000-0000-00000000000a', %L, '52000000-0000-0000-0000-000000000006', 'x', 1, 1, 5)
$q$, current_setting('test.m_id')), 'BA006');
select pg_temp.expect_error('admin: UPDATE de una línea a un servicio ya presente → 23505', format($q$
  update public.appointment_services set service_id = '52000000-0000-0000-0000-000000000001'
  where appointment_id = %L and service_id = '52000000-0000-0000-0000-000000000005'
$q$, current_setting('test.m_id')), '23505');

select pg_temp.as_user('a2000000-0000-0000-0000-000000000002');  -- barbero K1
select pg_temp.expect_error('barbero: 6ª línea → BA006', format($q$
  insert into public.appointment_services (tenant_id, appointment_id, service_id, service_name, price_cents, duration_minutes, position)
  values ('12000000-0000-0000-0000-00000000000a', %L, '52000000-0000-0000-0000-000000000006', 'x', 1, 1, 5)
$q$, current_setting('test.m_id')), 'BA006');

select pg_temp.as_postgres();
select pg_temp.expect_error('postgres: 6ª línea → BA006 (aplica a todos)', format($q$
  insert into public.appointment_services (tenant_id, appointment_id, service_id, service_name, price_cents, duration_minutes, position)
  values ('12000000-0000-0000-0000-00000000000a', %L, '52000000-0000-0000-0000-000000000006', 'x', 1, 1, 5)
$q$, current_setting('test.m_id')), 'BA006');
select pg_temp.check('M quedó con exactamente 5 líneas',
  (select count(*) from public.appointment_services where appointment_id = current_setting('test.m_id')::uuid) = 5);

-- INSERT de varias filas en una sola sentencia: la fila que excede el tope
-- aborta la sentencia completa. A (lunes 10:00, K1) tiene 1 línea (Corte).
select pg_temp.as_user('a2000000-0000-0000-0000-000000000001');  -- admin K
select pg_temp.expect_error('admin: INSERT de 5 filas en una cita con 1 línea (total 6) → BA006', $q$
  insert into public.appointment_services (tenant_id, appointment_id, service_id, service_name, price_cents, duration_minutes, position)
  select '12000000-0000-0000-0000-00000000000a', a.id, s.id, 'x', 1, 1, 1
  from public.appointments a
  cross join (values ('52000000-0000-0000-0000-000000000002'::uuid), ('52000000-0000-0000-0000-000000000003'::uuid),
                     ('52000000-0000-0000-0000-000000000004'::uuid), ('52000000-0000-0000-0000-000000000005'::uuid),
                     ('52000000-0000-0000-0000-000000000006'::uuid)) as s(id)
  where a.barber_id = 'b2000000-0000-0000-0000-000000000001' and a.start_at = pg_temp.lt('2030-06-03 10:00')
$q$, 'BA006');
select pg_temp.as_postgres();
select pg_temp.check('...la cita A conserva 1 línea (la sentencia completa se revirtió)',
  (select count(*) from public.appointment_services l join public.appointments a on a.id = l.appointment_id
   where a.barber_id = 'b2000000-0000-0000-0000-000000000001' and a.start_at = pg_temp.lt('2030-06-03 10:00')) = 1);
select pg_temp.as_user('a2000000-0000-0000-0000-000000000001');
select pg_temp.expect_ok('admin: INSERT de 4 filas en una cita con 1 línea (total 5) → OK', $q$
  insert into public.appointment_services (tenant_id, appointment_id, service_id, service_name, price_cents, duration_minutes, position)
  select '12000000-0000-0000-0000-00000000000a', a.id, s.id, 'x', 1, 1, 1
  from public.appointments a
  cross join (values ('52000000-0000-0000-0000-000000000002'::uuid), ('52000000-0000-0000-0000-000000000003'::uuid),
                     ('52000000-0000-0000-0000-000000000004'::uuid), ('52000000-0000-0000-0000-000000000005'::uuid)) as s(id)
  where a.barber_id = 'b2000000-0000-0000-0000-000000000001' and a.start_at = pg_temp.lt('2030-06-03 10:00')
$q$);
select pg_temp.as_postgres();
select pg_temp.check('...snapshot del catálogo también en el INSERT de varias filas',
  not exists (select 1 from public.appointment_services where tenant_id = '12000000-0000-0000-0000-00000000000a' and (service_name = 'x' or price_cents = 1)));

-- =============================================================================
-- Reporte
-- =============================================================================
select pg_temp.as_postgres();
select case when ok then 'PASS' else 'FAIL' end as resultado, label as prueba, coalesce(detail, '') as detalle
from _results order by n;

do $$
declare _total int; _fail int;
begin
  select count(*), count(*) filter (where not ok) into _total, _fail from _results;
  if _fail > 0 then
    raise exception 'multi_service_booking: % de % pruebas FALLARON', _fail, _total;
  end if;
  raise notice 'multi_service_booking: % de % pruebas PASARON', _total, _total;
end $$;

rollback;

-- =============================================================================
-- Concurrencia (procedimiento MANUAL, base local; deja datos: usar una base
-- desechable o borrar después)
-- -----------------------------------------------------------------------------
-- Con datos confirmados (commit) de una barbería, barbero y servicio activos:
--
--   Sesión 1:  begin;
--              select public.book_appointment('<slug>', '<barbero>', array['<servicio>']::uuid[],
--                     '<inicio válido>', 'Uno', '5500000001');
--              -- (no hacer commit todavía)
--   Sesión 2:  begin;
--              select public.book_appointment('<slug>', '<barbero>', array['<servicio>']::uuid[],
--                     '<mismo inicio>', 'Dos', '5500000002');
--              -- queda esperando el lock de agenda del barbero
--   Sesión 1:  commit;
--   Sesión 2:  → ERROR P0003 "El horario seleccionado ya no está disponible…"
--
-- Igual para el tope de líneas: dos sesiones que insertan la 5ª y la 6ª línea
-- de la misma cita (4 líneas confirmadas) → la segunda espera el lock 10101 y
-- al continuar recibe BA006.
-- =============================================================================
