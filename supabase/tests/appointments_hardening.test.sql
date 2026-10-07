-- =============================================================================
-- Pruebas — Step 9.1 hardening de citas (migración 20261007174600)
-- -----------------------------------------------------------------------------
-- SOLO para una base LOCAL o desechable con todas las migraciones aplicadas
-- (supabase start, o Postgres local con roles anon/authenticated, auth.users y
-- auth.uid()). Nunca contra producción.
--
-- Todo ocurre en UNA transacción que termina en ROLLBACK: no deja datos.
-- Si alguna prueba falla, el bloque final lanza una excepción (código de
-- salida distinto de 0 con psql -v ON_ERROR_STOP=1).
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/appointments_hardening.test.sql
--
-- No es pgTAP: es SQL plano con su propio reporte PASS/FAIL.
-- =============================================================================

begin;

-- ─── Utilidades ──────────────────────────────────────────────────────────────
create temp table _results (n serial primary key, ok boolean not null, label text not null, detail text);
grant all on _results to public;
grant usage on sequence _results_n_seq to public;

-- Actuar como un usuario autenticado (o anon si _uid es null).
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

-- La sentencia debe fallar con el SQLSTATE indicado.
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

-- La sentencia debe ejecutarse sin error.
create function pg_temp.expect_ok(_label text, _sql text) returns void language plpgsql as $$
begin
  execute _sql;
  perform pg_temp.check(_label, true);
exception when others then
  perform pg_temp.check(_label, false, sqlstate || ' "' || sqlerrm || '"');
end $$;

-- La sentencia (UPDATE/DELETE) debe afectar exactamente _n filas, sin error.
create function pg_temp.expect_rows(_label text, _sql text, _n int) returns void language plpgsql as $$
declare _got int;
begin
  execute _sql;
  get diagnostics _got = row_count;
  perform pg_temp.check(_label, _got = _n, format('%s fila(s), se esperaba %s', _got, _n));
exception when others then
  perform pg_temp.check(_label, false, sqlstate || ' "' || sqlerrm || '"');
end $$;

-- ─── Datos de prueba (como postgres) ─────────────────────────────────────────
-- Barbería A (Kings) y B (Alpha).
--   adminA, adminX (2º admin de A, se borra al final), barA1, barA2 | adminB
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000001', 'admin-a@test'),
  ('a0000000-0000-0000-0000-000000000009', 'admin-x@test'),
  ('a0000000-0000-0000-0000-000000000002', 'barbero-a1@test'),
  ('a0000000-0000-0000-0000-000000000003', 'barbero-a2@test'),
  ('b0000000-0000-0000-0000-000000000001', 'admin-b@test');

insert into public.tenants (id, slug, name, plan_code, timezone) values
  ('10000000-0000-0000-0000-00000000000a', 'test-kings', 'Kings', 'barbershop', 'America/Mexico_City'),
  ('10000000-0000-0000-0000-00000000000b', 'test-alpha', 'Alpha', 'barbershop', 'America/Mexico_City');

insert into public.tenant_members (tenant_id, user_id, role) values
  ('10000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000001', 'admin'),
  ('10000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000009', 'admin'),
  ('10000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000002', 'barber'),
  ('10000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003', 'barber'),
  ('10000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-000000000001', 'admin');

insert into public.barbers (id, tenant_id, user_id, display_name) values
  ('ba000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000002', 'Barbero A1'),
  ('ba000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000003', 'Barbero A2'),
  ('bb000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000b', null, 'Barbero B1');

insert into public.services (id, tenant_id, name, price_cents, duration_minutes, is_active) values
  ('5a000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a', 'Corte',    25000, 30, true),
  ('5a000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-00000000000a', 'Barba',    15000, 20, true),
  ('5a000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-00000000000a', 'Retirado',  9900, 15, false),
  ('5b000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000b', 'Corte B',  20000, 30, true);

insert into public.business_hours (tenant_id, day_of_week, opens_at, closes_at)
  select '10000000-0000-0000-0000-00000000000a', d, time '06:00', time '23:00' from generate_series(1, 7) d;
insert into public.barber_working_hours (tenant_id, barber_id, day_of_week, opens_at, closes_at)
  select '10000000-0000-0000-0000-00000000000a', 'ba000000-0000-0000-0000-000000000001', d, time '06:00', time '23:00' from generate_series(1, 7) d;

insert into public.clients (id, tenant_id, full_name, phone) values
  ('ca000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a', 'Cliente A1', '+525500000001'),
  ('ca000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-00000000000a', 'Cliente A2', '+525500000002'),
  ('cb000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000b', 'Cliente B',  '+525500000003');

-- Citas (2030, sin traslapes). Todas de A1 salvo indicación.
--   c…01 pending   (UPDATE directo de campos protegidos)
--   c…02 pending   (cancelación por UPDATE directo)
--   c…03 pending   (cancelación por la función)
--   c…04 confirmed (completar)
--   c…05 pending   (servicios)
--   c…06 pending   barbero A2
--   c…07 pending   barbería B
--   c…08 pending   (cancelada por adminX → borrado de cuenta)
--   c…09 pending   created_by = adminX (borrado de cuenta)
insert into public.appointments (id, tenant_id, barber_id, client_id, start_at, end_at, status, source, created_by) values
  ('c0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000a', 'ba000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001', '2030-03-04 15:00Z', '2030-03-04 15:30Z', 'pending',   'online', null),
  ('c0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-00000000000a', 'ba000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001', '2030-03-04 16:00Z', '2030-03-04 16:30Z', 'pending',   'online', null),
  ('c0000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-00000000000a', 'ba000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001', '2030-03-04 17:00Z', '2030-03-04 17:30Z', 'pending',   'online', null),
  ('c0000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-00000000000a', 'ba000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001', '2030-03-04 18:00Z', '2030-03-04 18:30Z', 'confirmed', 'online', null),
  ('c0000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-00000000000a', 'ba000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001', '2030-03-04 19:00Z', '2030-03-04 19:30Z', 'pending',   'online', null),
  ('c0000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-00000000000a', 'ba000000-0000-0000-0000-000000000002', 'ca000000-0000-0000-0000-000000000001', '2030-03-04 15:00Z', '2030-03-04 15:30Z', 'pending',   'online', null),
  ('c0000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-00000000000b', 'bb000000-0000-0000-0000-000000000001', 'cb000000-0000-0000-0000-000000000001', '2030-03-04 15:00Z', '2030-03-04 15:30Z', 'pending',   'online', null),
  ('c0000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-00000000000a', 'ba000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001', '2030-03-04 20:00Z', '2030-03-04 20:30Z', 'pending',   'online', null),
  ('c0000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-00000000000a', 'ba000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001', '2030-03-04 21:00Z', '2030-03-04 21:30Z', 'pending',   'staff',  'a0000000-0000-0000-0000-000000000009');

-- Línea del catálogo para la cita a completar y para la cita de servicios.
insert into public.appointment_services (tenant_id, appointment_id, service_id, service_name, price_cents, duration_minutes, position) values
  ('10000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000004', '5a000000-0000-0000-0000-000000000001', 'Corte', 25000, 30, 0),
  ('10000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000005', '5a000000-0000-0000-0000-000000000001', 'Corte', 25000, 30, 0);

-- =============================================================================
-- 1. INSERT directo de citas (bloqueado para authenticated)
-- =============================================================================
select pg_temp.as_user('a0000000-0000-0000-0000-000000000002');  -- barbero A1

select pg_temp.expect_error('INSERT barbero: cita ya completed', $q$
  insert into public.appointments (tenant_id, barber_id, client_id, start_at, end_at, status, source, completed_at)
  values ('10000000-0000-0000-0000-00000000000a', 'ba000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001',
          '2030-05-01 15:00Z', '2030-05-01 15:30Z', 'completed', 'staff', '2000-01-01')
$q$, '42501');

select pg_temp.expect_error('INSERT barbero: cita ya cancelled', $q$
  insert into public.appointments (tenant_id, barber_id, client_id, start_at, end_at, status, source, cancelled_at, cancellation_reason)
  values ('10000000-0000-0000-0000-00000000000a', 'ba000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001',
          '2030-05-01 16:00Z', '2030-05-01 16:30Z', 'cancelled', 'staff', now(), 'x')
$q$, '42501');

select pg_temp.expect_error('INSERT barbero: source = online falso', $q$
  insert into public.appointments (tenant_id, barber_id, client_id, start_at, end_at, status, source)
  values ('10000000-0000-0000-0000-00000000000a', 'ba000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001',
          '2030-05-01 17:00Z', '2030-05-01 17:30Z', 'pending', 'online')
$q$, '42501');

select pg_temp.expect_error('INSERT barbero: created_by de otro usuario', $q$
  insert into public.appointments (tenant_id, barber_id, client_id, start_at, end_at, status, source, created_by)
  values ('10000000-0000-0000-0000-00000000000a', 'ba000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001',
          '2030-05-01 18:00Z', '2030-05-01 18:30Z', 'pending', 'staff', 'a0000000-0000-0000-0000-000000000001')
$q$, '42501');

select pg_temp.expect_error('INSERT barbero: created_at antiguo', $q$
  insert into public.appointments (tenant_id, barber_id, client_id, start_at, end_at, status, source, created_at)
  values ('10000000-0000-0000-0000-00000000000a', 'ba000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001',
          '2030-05-01 19:00Z', '2030-05-01 19:30Z', 'pending', 'staff', '2020-01-01')
$q$, '42501');

select pg_temp.as_user('a0000000-0000-0000-0000-000000000001');  -- admin A
select pg_temp.expect_error('INSERT admin: cita pending normal (también bloqueado)', $q$
  insert into public.appointments (tenant_id, barber_id, client_id, start_at, end_at, status, source)
  values ('10000000-0000-0000-0000-00000000000a', 'ba000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001',
          '2030-05-01 20:00Z', '2030-05-01 20:30Z', 'pending', 'staff')
$q$, '42501');

select pg_temp.as_user(null);  -- anon
select pg_temp.expect_error('INSERT anon', $q$
  insert into public.appointments (tenant_id, barber_id, client_id, start_at, end_at, status, source)
  values ('10000000-0000-0000-0000-00000000000a', 'ba000000-0000-0000-0000-000000000001', 'ca000000-0000-0000-0000-000000000001',
          '2030-05-01 21:00Z', '2030-05-01 21:30Z', 'pending', 'online')
$q$, '42501');

-- =============================================================================
-- 2. book_appointment sigue funcionando (anon y authenticated)
-- =============================================================================
select pg_temp.as_user(null);
do $$
declare _res jsonb; _id uuid; _a record; _l record;
  _start timestamptz := (((now() at time zone 'America/Mexico_City')::date + 1) + time '10:00') at time zone 'America/Mexico_City';
begin
  _res := public.book_appointment('test-kings', 'ba000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000002',
                                  _start, 'Reserva Pública', '55 1234 5678', 'nota');
  _id := (_res->>'appointment_id')::uuid;
  perform pg_temp.as_postgres();
  select * into _a from public.appointments where id = _id;
  select * into _l from public.appointment_services where appointment_id = _id;
  perform pg_temp.check('book_appointment (anon): crea la cita', _a.id is not null);
  perform pg_temp.check('book_appointment: status = pending', _a.status = 'pending', _a.status::text);
  perform pg_temp.check('book_appointment: source = online', _a.source = 'online', _a.source::text);
  perform pg_temp.check('book_appointment: created_by NULL (reserva pública)', _a.created_by is null);
  perform pg_temp.check('book_appointment: línea copiada del catálogo (Barba, 15000, 20)',
    _l.service_name = 'Barba' and _l.price_cents = 15000 and _l.duration_minutes = 20,
    format('%s %s %s', _l.service_name, _l.price_cents, _l.duration_minutes));
  perform pg_temp.check('book_appointment: comisión NULL', _l.commission_rate_bps is null);
  perform pg_temp.check('book_appointment: duración de la cita = servicio (20 min)', _a.end_at - _a.start_at = interval '20 minutes');
  perform pg_temp.check('book_appointment: teléfono normalizado',
    exists (select 1 from public.clients where id = _a.client_id and phone = '+525512345678'));
exception when others then
  perform pg_temp.as_postgres();
  perform pg_temp.check('book_appointment (anon) funciona', false, sqlstate || ' ' || sqlerrm);
end $$;

select pg_temp.as_user('a0000000-0000-0000-0000-000000000002');  -- un usuario con sesión también puede reservar
select pg_temp.expect_ok('book_appointment (authenticated) funciona', $q$
  select public.book_appointment('test-kings', 'ba000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000001',
    (((now() at time zone 'America/Mexico_City')::date + 1) + time '12:00') at time zone 'America/Mexico_City',
    'Otra Persona', '5598765432', null)
$q$);

select pg_temp.as_user(null);
select pg_temp.expect_error('book_appointment: el traslape sigue rechazado (P0003)', $q$
  select public.book_appointment('test-kings', 'ba000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000001',
    (((now() at time zone 'America/Mexico_City')::date + 1) + time '10:00') at time zone 'America/Mexico_City',
    'Choque', '5511112222', null)
$q$, 'P0003');

-- =============================================================================
-- 3. UPDATE directo de campos protegidos (barbero y admin)
-- =============================================================================
select pg_temp.as_user('a0000000-0000-0000-0000-000000000002');  -- barbero A1, su propia cita c…01
select pg_temp.expect_error('UPDATE barbero: id',           $q$update public.appointments set id = gen_random_uuid() where id = 'c0000000-0000-0000-0000-000000000001'$q$, '42501');
select pg_temp.expect_error('UPDATE barbero: tenant_id',    $q$update public.appointments set tenant_id = '10000000-0000-0000-0000-00000000000b' where id = 'c0000000-0000-0000-0000-000000000001'$q$, '42501');
select pg_temp.expect_error('UPDATE barbero: barber_id',    $q$update public.appointments set barber_id = 'ba000000-0000-0000-0000-000000000002' where id = 'c0000000-0000-0000-0000-000000000001'$q$, '42501');
select pg_temp.expect_error('UPDATE barbero: client_id',    $q$update public.appointments set client_id = 'ca000000-0000-0000-0000-000000000002' where id = 'c0000000-0000-0000-0000-000000000001'$q$, '42501');
select pg_temp.expect_error('UPDATE barbero: start_at',     $q$update public.appointments set start_at = start_at + interval '1 day' where id = 'c0000000-0000-0000-0000-000000000001'$q$, '42501');
select pg_temp.expect_error('UPDATE barbero: end_at',       $q$update public.appointments set end_at = end_at + interval '5 hours' where id = 'c0000000-0000-0000-0000-000000000001'$q$, '42501');
select pg_temp.expect_error('UPDATE barbero: source',       $q$update public.appointments set source = 'walk_in' where id = 'c0000000-0000-0000-0000-000000000001'$q$, '42501');
select pg_temp.expect_error('UPDATE barbero: created_at',   $q$update public.appointments set created_at = '2000-01-01' where id = 'c0000000-0000-0000-0000-000000000001'$q$, '42501');
select pg_temp.expect_error('UPDATE barbero: created_by',   $q$update public.appointments set created_by = 'a0000000-0000-0000-0000-000000000001' where id = 'c0000000-0000-0000-0000-000000000001'$q$, '42501');
select pg_temp.expect_error('UPDATE barbero: updated_at',   $q$update public.appointments set updated_at = '2000-01-01' where id = 'c0000000-0000-0000-0000-000000000001'$q$, '42501');
select pg_temp.expect_error('UPDATE barbero: completed_at', $q$update public.appointments set completed_at = now() where id = 'c0000000-0000-0000-0000-000000000001'$q$, '42501');
select pg_temp.expect_error('UPDATE barbero: cancelled_at', $q$update public.appointments set cancelled_at = now() where id = 'c0000000-0000-0000-0000-000000000001'$q$, '42501');
select pg_temp.expect_error('UPDATE barbero: cancelled_by', $q$update public.appointments set cancelled_by = 'a0000000-0000-0000-0000-000000000001' where id = 'c0000000-0000-0000-0000-000000000001'$q$, '42501');
select pg_temp.expect_error('UPDATE barbero: client_note',  $q$update public.appointments set client_note = 'editada' where id = 'c0000000-0000-0000-0000-000000000001'$q$, '42501');

select pg_temp.as_user('a0000000-0000-0000-0000-000000000001');  -- admin A: también bloqueado (D2)
select pg_temp.expect_error('UPDATE admin: barber_id (reasignar)', $q$update public.appointments set barber_id = 'ba000000-0000-0000-0000-000000000002' where id = 'c0000000-0000-0000-0000-000000000001'$q$, '42501');
select pg_temp.expect_error('UPDATE admin: client_id',             $q$update public.appointments set client_id = 'ca000000-0000-0000-0000-000000000002' where id = 'c0000000-0000-0000-0000-000000000001'$q$, '42501');
select pg_temp.expect_error('UPDATE admin: start_at/end_at',       $q$update public.appointments set start_at = start_at + interval '1 day', end_at = end_at + interval '1 day' where id = 'c0000000-0000-0000-0000-000000000001'$q$, '42501');
select pg_temp.expect_error('UPDATE admin: source',                $q$update public.appointments set source = 'staff' where id = 'c0000000-0000-0000-0000-000000000001'$q$, '42501');
select pg_temp.expect_error('UPDATE admin: created_by',            $q$update public.appointments set created_by = null where id = 'c0000000-0000-0000-0000-000000000009'$q$, '42501');

-- Defensa en profundidad: aunque alguien con privilegios totales (postgres /
-- service_role / SQL Editor) lo intente, la auditoría es inmutable.
select pg_temp.as_postgres();
select pg_temp.expect_error('UPDATE postgres: source',     $q$update public.appointments set source = 'staff' where id = 'c0000000-0000-0000-0000-000000000001'$q$, '42501');
select pg_temp.expect_error('UPDATE postgres: created_at', $q$update public.appointments set created_at = '2000-01-01' where id = 'c0000000-0000-0000-0000-000000000001'$q$, '42501');
select pg_temp.expect_error('UPDATE postgres: tenant_id',  $q$update public.appointments set tenant_id = '10000000-0000-0000-0000-00000000000b' where id = 'c0000000-0000-0000-0000-000000000001'$q$, '42501');

select pg_temp.check('la cita c…01 sigue intacta tras todos los intentos',
  exists (select 1 from public.appointments
          where id = 'c0000000-0000-0000-0000-000000000001' and status = 'pending' and source = 'online'
            and barber_id = 'ba000000-0000-0000-0000-000000000001' and client_id = 'ca000000-0000-0000-0000-000000000001'
            and start_at = '2030-03-04 15:00Z' and end_at = '2030-03-04 15:30Z' and client_note is null));

-- =============================================================================
-- 4. Cancelación: motivo obligatorio e inmutable
-- =============================================================================
select pg_temp.as_user('a0000000-0000-0000-0000-000000000002');  -- barbero A1
select pg_temp.expect_error('UPDATE directo a cancelled con motivo NULL',        $q$update public.appointments set status = 'cancelled' where id = 'c0000000-0000-0000-0000-000000000002'$q$, 'BA002');
select pg_temp.expect_error('UPDATE directo a cancelled con motivo vacío',       $q$update public.appointments set status = 'cancelled', cancellation_reason = '' where id = 'c0000000-0000-0000-0000-000000000002'$q$, 'BA002');
select pg_temp.expect_error('UPDATE directo a cancelled con motivo "   "',       $q$update public.appointments set status = 'cancelled', cancellation_reason = '   ' where id = 'c0000000-0000-0000-0000-000000000002'$q$, 'BA002');
select pg_temp.expect_error('UPDATE directo a cancelled con tabulador/salto',    $q$update public.appointments set status = 'cancelled', cancellation_reason = E'\t\n ' where id = 'c0000000-0000-0000-0000-000000000002'$q$, 'BA002');
select pg_temp.expect_error('UPDATE directo a cancelled con motivo > 500',       $q$update public.appointments set status = 'cancelled', cancellation_reason = repeat('x', 501) where id = 'c0000000-0000-0000-0000-000000000002'$q$, 'BA002');
select pg_temp.expect_error('set_appointment_status a cancelled sin motivo',     $q$select public.set_appointment_status('c0000000-0000-0000-0000-000000000003', 'cancelled', null)$q$, 'BA002');
select pg_temp.expect_error('set_appointment_status a cancelled con "   "',      $q$select public.set_appointment_status('c0000000-0000-0000-0000-000000000003', 'cancelled', '   ')$q$, 'BA002');
select pg_temp.expect_error('UPDATE directo: escribir motivo sin cancelar',      $q$update public.appointments set cancellation_reason = 'x' where id = 'c0000000-0000-0000-0000-000000000002'$q$, '42501');
select pg_temp.expect_error('UPDATE directo: motivo junto con confirmar',        $q$update public.appointments set status = 'confirmed', cancellation_reason = 'x' where id = 'c0000000-0000-0000-0000-000000000002'$q$, '42501');

select pg_temp.expect_ok('Cancelación legítima por la función (con motivo)', $q$
  select public.set_appointment_status('c0000000-0000-0000-0000-000000000003', 'cancelled', '  Cliente avisó que no llega  ')
$q$);
select pg_temp.expect_ok('Cancelación legítima por UPDATE directo (con motivo)', $q$
  update public.appointments set status = 'cancelled', cancellation_reason = ' Barbero enfermo ' where id = 'c0000000-0000-0000-0000-000000000002'
$q$);

select pg_temp.as_postgres();
select pg_temp.check('cancelada por la función: motivo recortado, cancelled_at y cancelled_by = barbero',
  exists (select 1 from public.appointments where id = 'c0000000-0000-0000-0000-000000000003'
          and status = 'cancelled' and cancellation_reason = 'Cliente avisó que no llega'
          and cancelled_at is not null and cancelled_by = 'a0000000-0000-0000-0000-000000000002'));
select pg_temp.check('cancelada por UPDATE directo: motivo recortado y auditoría fijada por el trigger',
  exists (select 1 from public.appointments where id = 'c0000000-0000-0000-0000-000000000002'
          and status = 'cancelled' and cancellation_reason = 'Barbero enfermo'
          and cancelled_at is not null and cancelled_by = 'a0000000-0000-0000-0000-000000000002'));

select pg_temp.as_user('a0000000-0000-0000-0000-000000000002');
select pg_temp.expect_error('Después de cancelar: reescribir el motivo (barbero)', $q$update public.appointments set cancellation_reason = 'otro motivo' where id = 'c0000000-0000-0000-0000-000000000003'$q$, '42501');
select pg_temp.expect_error('Después de cancelar: borrar el motivo (barbero)',     $q$update public.appointments set cancellation_reason = null where id = 'c0000000-0000-0000-0000-000000000003'$q$, '42501');
select pg_temp.expect_error('Después de cancelar: cancelled_by falso',             $q$update public.appointments set cancelled_by = 'a0000000-0000-0000-0000-000000000003' where id = 'c0000000-0000-0000-0000-000000000003'$q$, '42501');
select pg_temp.expect_error('Después de cancelar: cancelled_at falso',             $q$update public.appointments set cancelled_at = '2000-01-01' where id = 'c0000000-0000-0000-0000-000000000003'$q$, '42501');
select pg_temp.as_user('a0000000-0000-0000-0000-000000000001');
select pg_temp.expect_error('Después de cancelar: reescribir el motivo (admin)',   $q$update public.appointments set cancellation_reason = 'otro motivo' where id = 'c0000000-0000-0000-0000-000000000003'$q$, '42501');
select pg_temp.as_postgres();
select pg_temp.expect_error('Después de cancelar: reescribir el motivo (postgres)', $q$update public.appointments set cancellation_reason = 'otro motivo' where id = 'c0000000-0000-0000-0000-000000000003'$q$, '42501');
select pg_temp.expect_error('Después de cancelar: cancelled_by falso (postgres)',   $q$update public.appointments set cancelled_by = 'a0000000-0000-0000-0000-000000000003' where id = 'c0000000-0000-0000-0000-000000000003'$q$, '42501');

-- Cambio de estado + campos de auditoría falsos en la misma sentencia (postgres)
select pg_temp.expect_error('postgres: cancelar enviando cancelled_by/cancelled_at falsos', $q$
  update public.appointments set status = 'cancelled', cancellation_reason = 'x',
         cancelled_by = 'a0000000-0000-0000-0000-000000000003', cancelled_at = '2000-01-01'
  where id = 'c0000000-0000-0000-0000-000000000001'
$q$, '42501');

-- =============================================================================
-- 5. Transiciones (siguen exactamente igual)
-- =============================================================================
select pg_temp.as_user('a0000000-0000-0000-0000-000000000001');  -- admin A
select pg_temp.expect_error('pending → completed (salto) bloqueada',       $q$select public.set_appointment_status('c0000000-0000-0000-0000-000000000001', 'completed')$q$, 'BA001');
select pg_temp.expect_error('pending → completed por UPDATE directo',      $q$update public.appointments set status = 'completed' where id = 'c0000000-0000-0000-0000-000000000001'$q$, 'BA001');
select pg_temp.expect_error('cancelled → confirmed bloqueada',             $q$select public.set_appointment_status('c0000000-0000-0000-0000-000000000003', 'confirmed')$q$, 'BA001');
select pg_temp.expect_error('cancelled → completed por UPDATE directo',    $q$update public.appointments set status = 'completed' where id = 'c0000000-0000-0000-0000-000000000003'$q$, 'BA001');
select pg_temp.expect_ok   ('admin confirma la cita de A2 (pending → confirmed)', $q$select public.set_appointment_status('c0000000-0000-0000-0000-000000000006', 'confirmed')$q$);
select pg_temp.expect_ok   ('confirmed → no_show',                         $q$select public.set_appointment_status('c0000000-0000-0000-0000-000000000006', 'no_show')$q$);
select pg_temp.expect_error('no_show → confirmed bloqueada',               $q$select public.set_appointment_status('c0000000-0000-0000-0000-000000000006', 'confirmed')$q$, 'BA001');

-- =============================================================================
-- 6. appointment_services: el catálogo manda
-- =============================================================================
select pg_temp.as_user('a0000000-0000-0000-0000-000000000002');  -- barbero A1
select pg_temp.expect_ok('Barbero agrega un servicio a su cita no completada', $q$
  insert into public.appointment_services
    (tenant_id, appointment_id, service_id, service_name, price_cents, duration_minutes, commission_rate_bps, position)
  values ('10000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000005', '5a000000-0000-0000-0000-000000000002',
          'Inventado', 1, 5, 10000, 1)
$q$);
select pg_temp.as_postgres();
select pg_temp.check('...con precio/nombre/duración del CATÁLOGO y comisión NULL (no los enviados)',
  exists (select 1 from public.appointment_services
          where appointment_id = 'c0000000-0000-0000-0000-000000000005' and position = 1
            and service_name = 'Barba' and price_cents = 15000 and duration_minutes = 20 and commission_rate_bps is null),
  (select format('%s %s %s %s', service_name, price_cents, duration_minutes, commission_rate_bps)
     from public.appointment_services where appointment_id = 'c0000000-0000-0000-0000-000000000005' and position = 1));
select pg_temp.check('ninguna línea con los valores manipulados quedó en la base',
  not exists (select 1 from public.appointment_services
              where service_name = 'Inventado' or price_cents = 1 or duration_minutes = 5 or commission_rate_bps = 10000));

select pg_temp.as_user('a0000000-0000-0000-0000-000000000002');
select pg_temp.expect_error('Servicio de OTRA barbería', $q$
  insert into public.appointment_services (tenant_id, appointment_id, service_id, service_name, price_cents, duration_minutes, position)
  values ('10000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000005', '5b000000-0000-0000-0000-000000000001', 'x', 1, 5, 2)
$q$, '23503');
select pg_temp.expect_error('Servicio inexistente', $q$
  insert into public.appointment_services (tenant_id, appointment_id, service_id, service_name, price_cents, duration_minutes, position)
  values ('10000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000005', '5a000000-0000-0000-0000-0000000000ff', 'x', 1, 5, 2)
$q$, '23503');
select pg_temp.expect_error('Servicio inactivo', $q$
  insert into public.appointment_services (tenant_id, appointment_id, service_id, service_name, price_cents, duration_minutes, position)
  values ('10000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000005', '5a000000-0000-0000-0000-000000000003', 'x', 1, 5, 2)
$q$, 'BA003');
select pg_temp.expect_error('Línea en la cita de OTRO barbero (no la ve)', $q$
  insert into public.appointment_services (tenant_id, appointment_id, service_id, service_name, price_cents, duration_minutes, position)
  values ('10000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000006', '5a000000-0000-0000-0000-000000000001', 'x', 1, 5, 2)
$q$, '23503');
select pg_temp.expect_error('Línea en una cita de OTRA barbería', $q$
  insert into public.appointment_services (tenant_id, appointment_id, service_id, service_name, price_cents, duration_minutes, position)
  values ('10000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-000000000007', '5b000000-0000-0000-0000-000000000001', 'x', 1, 5, 2)
$q$, '23503');
select pg_temp.expect_rows('Barbero DELETE de una línea de su cita (0 filas: solo admin)',
  $q$delete from public.appointment_services where appointment_id = 'c0000000-0000-0000-0000-000000000005'$q$, 0);
select pg_temp.expect_rows('Barbero UPDATE de precio de su línea (0 filas: solo admin)',
  $q$update public.appointment_services set price_cents = 1 where appointment_id = 'c0000000-0000-0000-0000-000000000005'$q$, 0);

select pg_temp.as_user('a0000000-0000-0000-0000-000000000001');  -- admin A
select pg_temp.expect_ok('Admin agrega un servicio enviando valores manipulados', $q$
  insert into public.appointment_services
    (tenant_id, appointment_id, service_id, service_name, price_cents, duration_minutes, commission_rate_bps, position)
  values ('10000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000001',
          'Gratis', 0, 1, 9999, 0)
$q$);
select pg_temp.check('...el admin también recibe el snapshot del catálogo y comisión NULL',
  exists (select 1 from public.appointment_services
          where appointment_id = 'c0000000-0000-0000-0000-000000000001'
            and service_name = 'Corte' and price_cents = 25000 and duration_minutes = 30 and commission_rate_bps is null));
select pg_temp.expect_error('Admin: una línea no puede cambiar de cita', $q$
  update public.appointment_services set appointment_id = 'c0000000-0000-0000-0000-000000000004'
  where appointment_id = 'c0000000-0000-0000-0000-000000000001'
$q$, '42501');
select pg_temp.expect_rows('Admin conserva: ajustar precio de una línea de cita no completada',
  $q$update public.appointment_services set price_cents = 20000 where appointment_id = 'c0000000-0000-0000-0000-000000000001'$q$, 1);
select pg_temp.expect_rows('Admin conserva: borrar una línea de cita no completada',
  $q$delete from public.appointment_services where appointment_id = 'c0000000-0000-0000-0000-000000000001'$q$, 1);

-- =============================================================================
-- 7. Completar y candado de la cita completada
-- =============================================================================
select pg_temp.as_user('a0000000-0000-0000-0000-000000000002');  -- barbero A1
select pg_temp.expect_ok('confirmed → completed (barbero, su cita)', $q$
  select public.set_appointment_status('c0000000-0000-0000-0000-000000000004', 'completed')
$q$);
select pg_temp.check('completed_at fijado por el servidor',
  exists (select 1 from public.appointments where id = 'c0000000-0000-0000-0000-000000000004'
          and status = 'completed' and completed_at > now() - interval '1 minute' and completed_at <= now()));

select pg_temp.expect_error('Completada: barbero agrega servicio', $q$
  insert into public.appointment_services (tenant_id, appointment_id, service_id, service_name, price_cents, duration_minutes, position)
  values ('10000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000004', '5a000000-0000-0000-0000-000000000002', 'x', 1, 5, 1)
$q$, 'BA004');
select pg_temp.expect_error('Completada: completed_at (barbero)', $q$update public.appointments set completed_at = '2000-01-01' where id = 'c0000000-0000-0000-0000-000000000004'$q$, '42501');
select pg_temp.expect_error('Completada: volver a pending',       $q$update public.appointments set status = 'pending' where id = 'c0000000-0000-0000-0000-000000000004'$q$, 'BA001');

select pg_temp.as_user('a0000000-0000-0000-0000-000000000001');  -- admin A
select pg_temp.expect_error('Completada: admin agrega servicio', $q$
  insert into public.appointment_services (tenant_id, appointment_id, service_id, service_name, price_cents, duration_minutes, position)
  values ('10000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000004', '5a000000-0000-0000-0000-000000000002', 'x', 1, 5, 1)
$q$, 'BA004');
select pg_temp.expect_error('Completada: admin cambia precio de la línea', $q$update public.appointment_services set price_cents = 1 where appointment_id = 'c0000000-0000-0000-0000-000000000004'$q$, 'BA004');
select pg_temp.expect_error('Completada: admin pone comisión en la línea', $q$update public.appointment_services set commission_rate_bps = 10000 where appointment_id = 'c0000000-0000-0000-0000-000000000004'$q$, 'BA004');
select pg_temp.expect_error('Completada: admin borra la línea',            $q$delete from public.appointment_services where appointment_id = 'c0000000-0000-0000-0000-000000000004'$q$, 'BA004');
select pg_temp.expect_error('Completada: admin cambia completed_at',       $q$update public.appointments set completed_at = '2000-01-01' where id = 'c0000000-0000-0000-0000-000000000004'$q$, '42501');

select pg_temp.as_postgres();
select pg_temp.expect_error('Completada: postgres cambia completed_at', $q$update public.appointments set completed_at = '2000-01-01' where id = 'c0000000-0000-0000-0000-000000000004'$q$, '42501');
select pg_temp.expect_error('Completada: postgres borra la línea',      $q$delete from public.appointment_services where appointment_id = 'c0000000-0000-0000-0000-000000000004'$q$, 'BA004');
select pg_temp.check('Completada: la línea original sigue intacta (Corte, 25000, 30, comisión NULL)',
  exists (select 1 from public.appointment_services where appointment_id = 'c0000000-0000-0000-0000-000000000004'
          and service_name = 'Corte' and price_cents = 25000 and duration_minutes = 30 and commission_rate_bps is null)
  and (select count(*) from public.appointment_services where appointment_id = 'c0000000-0000-0000-0000-000000000004') = 1);

-- =============================================================================
-- 8. Aislamiento (sin regresiones)
-- =============================================================================
select pg_temp.as_user('a0000000-0000-0000-0000-000000000002');  -- barbero A1
select pg_temp.expect_error('Barbero cambia estado de cita de OTRO barbero',   $q$select public.set_appointment_status('c0000000-0000-0000-0000-000000000006', 'cancelled', 'x')$q$, 'P0002');
select pg_temp.expect_rows ('Barbero UPDATE directo sobre cita de OTRO barbero (0 filas)', $q$update public.appointments set status = 'cancelled', cancellation_reason = 'x' where id = 'c0000000-0000-0000-0000-000000000006'$q$, 0);
select pg_temp.as_user('b0000000-0000-0000-0000-000000000001');  -- admin B
select pg_temp.expect_error('Admin B cambia estado de cita de la barbería A',   $q$select public.set_appointment_status('c0000000-0000-0000-0000-000000000005', 'confirmed')$q$, 'P0002');
select pg_temp.expect_rows ('Admin B UPDATE masivo sobre la barbería A (0 filas)', $q$update public.appointments set status = 'confirmed' where tenant_id = '10000000-0000-0000-0000-00000000000a'$q$, 0);
select pg_temp.as_user(null);
select pg_temp.expect_error('anon ejecuta set_appointment_status', $q$select public.set_appointment_status('c0000000-0000-0000-0000-000000000005', 'confirmed')$q$, '42501');
select pg_temp.expect_error('anon UPDATE directo',                 $q$update public.appointments set status = 'confirmed'$q$, '42501');

-- =============================================================================
-- 9. Procesos internos legítimos que NO deben romperse
-- =============================================================================
-- a) Borrar una cuenta: ON DELETE SET NULL limpia created_by / cancelled_by.
select pg_temp.as_user('a0000000-0000-0000-0000-000000000009');  -- adminX cancela c…08
select pg_temp.expect_ok('adminX cancela una cita', $q$select public.set_appointment_status('c0000000-0000-0000-0000-000000000008', 'cancelled', 'cierre del local')$q$);
select pg_temp.as_postgres();
delete from public.tenant_members where user_id = 'a0000000-0000-0000-0000-000000000009';
select pg_temp.expect_ok('Borrar la cuenta de adminX (referenciada en created_by y cancelled_by)',
  $q$delete from auth.users where id = 'a0000000-0000-0000-0000-000000000009'$q$);
select pg_temp.check('...cancelled_by y created_by pasan a NULL; el resto de la auditoría se conserva',
  exists (select 1 from public.appointments where id = 'c0000000-0000-0000-0000-000000000008'
          and cancelled_by is null and cancelled_at is not null and cancellation_reason = 'cierre del local')
  and exists (select 1 from public.appointments where id = 'c0000000-0000-0000-0000-000000000009' and created_by is null));

-- b) Borrados en cascada: el candado de "cita completada" no debe impedirlos.
--    Cita completada de A con su línea (c…04): borrar la cita (operación de
--    plataforma) arrastra la línea por la FK ON DELETE CASCADE.
select pg_temp.expect_ok('Cascada: borrar (postgres) una cita completada arrastra sus líneas',
  $q$delete from public.appointments where id = 'c0000000-0000-0000-0000-000000000004'$q$);
select pg_temp.check('...la línea de la cita completada se borró por cascada',
  not exists (select 1 from public.appointment_services where appointment_id = 'c0000000-0000-0000-0000-000000000004'));

--    Purga completa de la barbería B con una cita completada y sus líneas.
--    trg_protect_last_admin (migración 6, previo a este Step) impide purgar
--    una barbería que aún tiene admin; se desactiva SOLO dentro de esta
--    transacción de prueba para aislar la cascada de citas.
insert into public.appointment_services (tenant_id, appointment_id, service_id, service_name, price_cents, duration_minutes, position)
  values ('10000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-000000000007', '5b000000-0000-0000-0000-000000000001', 'x', 0, 1, 0);
update public.appointments set status = 'confirmed' where id = 'c0000000-0000-0000-0000-000000000007';
update public.appointments set status = 'completed' where id = 'c0000000-0000-0000-0000-000000000007';
alter table public.tenant_members disable trigger trg_protect_last_admin;
select pg_temp.expect_ok('Cascada: purgar la barbería B (cita completada + líneas)',
  $q$delete from public.tenants where id = '10000000-0000-0000-0000-00000000000b'$q$);
alter table public.tenant_members enable trigger trg_protect_last_admin;
select pg_temp.check('...no quedan citas ni líneas de la barbería B',
  not exists (select 1 from public.appointments where tenant_id = '10000000-0000-0000-0000-00000000000b')
  and not exists (select 1 from public.appointment_services where tenant_id = '10000000-0000-0000-0000-00000000000b'));

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
    raise exception 'appointments_hardening: % de % pruebas FALLARON', _fail, _total;
  end if;
  raise notice 'appointments_hardening: % de % pruebas PASARON', _total, _total;
end $$;

rollback;
