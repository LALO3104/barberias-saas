-- =============================================================================
-- Pruebas — Step 10.1 Migration A: ocupación de citas (migración 20261008193500)
-- -----------------------------------------------------------------------------
-- SOLO para una base LOCAL o desechable con todas las migraciones aplicadas
-- (supabase start, o Postgres local con roles anon/authenticated, auth.users y
-- auth.uid()). Nunca contra producción.
--
-- Todo ocurre en UNA transacción que termina en ROLLBACK: no deja datos.
-- Si alguna prueba falla, el bloque final lanza una excepción (código de
-- salida distinto de 0 con psql -v ON_ERROR_STOP=1).
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/appointment_occupancy.test.sql
--
-- Cubre: fórmula base (5/10/15/20/30/45/60 min), finalización anticipada, piso
-- de 1 minuto, la ocupación nunca crece, occupied_until inmutable (authenticated
-- y postgres) e ignorada en INSERT, exclusión sobre la ocupación (A 10:00–10:30
-- permite B 10:20 y rechaza B 10:15) y que cancelled/no_show no bloquean.
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

-- Ocupación (en minutos) de una cita guardada.
create function pg_temp.occ_minutes(_id uuid) returns numeric language sql as $$
  select extract(epoch from (occupied_until - start_at)) / 60 from public.appointments where id = _id
$$;

-- ─── Datos de prueba (como postgres) ─────────────────────────────────────────
insert into auth.users (id, email) values
  ('a1000000-0000-0000-0000-000000000001', 'occ-admin@test'),
  ('a1000000-0000-0000-0000-000000000002', 'occ-barbero@test');

insert into public.tenants (id, slug, name, plan_code, timezone) values
  ('11000000-0000-0000-0000-00000000000a', 'test-occ', 'Occ', 'barbershop', 'America/Mexico_City');

insert into public.tenant_members (tenant_id, user_id, role) values
  ('11000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-000000000001', 'admin'),
  ('11000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-000000000002', 'barber');

insert into public.barbers (id, tenant_id, user_id, display_name) values
  ('b1000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-000000000002', 'Barbero Occ 1'),
  ('b1000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-00000000000a', null, 'Barbero Occ 2');

insert into public.clients (id, tenant_id, full_name, phone) values
  ('c1000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-00000000000a', 'Cliente Occ', '+525500001001');

-- =============================================================================
-- 1. Fórmula base: min(D, max(D − 10, 10))
-- =============================================================================
do $$
declare
  _t   timestamptz := '2030-06-03 15:00Z';
  _d   int;
  _exp int;
  _got numeric;
begin
  for _d, _exp in
    select * from (values (5, 5), (10, 10), (15, 10), (20, 10), (30, 20), (45, 35), (60, 50)) as v(d, e)
  loop
    _got := extract(epoch from (private.appointment_occupied_until(_t, _t + make_interval(mins => _d)) - _t)) / 60;
    perform pg_temp.check(format('fórmula: D = %s min → ocupación %s min', _d, _exp), _got = _exp, _got::text);
  end loop;
end $$;

-- La misma fórmula aplicada por el trigger al insertar (barbero 2, sin
-- traslapes: una cita por hora).
insert into public.appointments (id, tenant_id, barber_id, client_id, start_at, end_at, status, source) values
  ('d1000000-0000-0000-0000-000000000005', '11000000-0000-0000-0000-00000000000a', 'b1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', '2030-06-04 13:00Z', '2030-06-04 13:05Z', 'pending', 'online'),
  ('d1000000-0000-0000-0000-000000000010', '11000000-0000-0000-0000-00000000000a', 'b1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', '2030-06-04 14:00Z', '2030-06-04 14:10Z', 'pending', 'online'),
  ('d1000000-0000-0000-0000-000000000015', '11000000-0000-0000-0000-00000000000a', 'b1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', '2030-06-04 15:00Z', '2030-06-04 15:15Z', 'pending', 'online'),
  ('d1000000-0000-0000-0000-000000000020', '11000000-0000-0000-0000-00000000000a', 'b1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', '2030-06-04 16:00Z', '2030-06-04 16:20Z', 'pending', 'online'),
  ('d1000000-0000-0000-0000-000000000030', '11000000-0000-0000-0000-00000000000a', 'b1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', '2030-06-04 17:00Z', '2030-06-04 17:30Z', 'pending', 'online'),
  ('d1000000-0000-0000-0000-000000000045', '11000000-0000-0000-0000-00000000000a', 'b1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', '2030-06-04 18:00Z', '2030-06-04 18:45Z', 'pending', 'online'),
  ('d1000000-0000-0000-0000-000000000060', '11000000-0000-0000-0000-00000000000a', 'b1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001', '2030-06-04 19:00Z', '2030-06-04 20:00Z', 'pending', 'online');

select pg_temp.check('trigger INSERT: 5 → 5',   pg_temp.occ_minutes('d1000000-0000-0000-0000-000000000005') = 5,  pg_temp.occ_minutes('d1000000-0000-0000-0000-000000000005')::text);
select pg_temp.check('trigger INSERT: 10 → 10', pg_temp.occ_minutes('d1000000-0000-0000-0000-000000000010') = 10, pg_temp.occ_minutes('d1000000-0000-0000-0000-000000000010')::text);
select pg_temp.check('trigger INSERT: 15 → 10', pg_temp.occ_minutes('d1000000-0000-0000-0000-000000000015') = 10, pg_temp.occ_minutes('d1000000-0000-0000-0000-000000000015')::text);
select pg_temp.check('trigger INSERT: 20 → 10', pg_temp.occ_minutes('d1000000-0000-0000-0000-000000000020') = 10, pg_temp.occ_minutes('d1000000-0000-0000-0000-000000000020')::text);
select pg_temp.check('trigger INSERT: 30 → 20', pg_temp.occ_minutes('d1000000-0000-0000-0000-000000000030') = 20, pg_temp.occ_minutes('d1000000-0000-0000-0000-000000000030')::text);
select pg_temp.check('trigger INSERT: 45 → 35', pg_temp.occ_minutes('d1000000-0000-0000-0000-000000000045') = 35, pg_temp.occ_minutes('d1000000-0000-0000-0000-000000000045')::text);
select pg_temp.check('trigger INSERT: 60 → 50', pg_temp.occ_minutes('d1000000-0000-0000-0000-000000000060') = 50, pg_temp.occ_minutes('d1000000-0000-0000-0000-000000000060')::text);

-- Siempre en (start_at, end_at]: citas de menos de 1 minuto y de 1 minuto.
select pg_temp.check('fórmula: D = 30 s → ocupación = end_at (30 s)',
  private.appointment_occupied_until('2030-06-03 15:00Z', '2030-06-03 15:00:30Z') = '2030-06-03 15:00:30Z');
select pg_temp.check('fórmula: D = 1 min → ocupación 1 min',
  private.appointment_occupied_until('2030-06-03 15:00Z', '2030-06-03 15:01Z') = '2030-06-03 15:01Z');

-- =============================================================================
-- 2. Finalización anticipada, piso y "nunca crece" (función)
-- =============================================================================
-- D = 60 (base: start + 50 min)
select pg_temp.check('anticipada: completed 10:30 en cita 10:00–11:00 → 10:30',
  private.appointment_occupied_until('2030-06-03 16:00Z', '2030-06-03 17:00Z', '2030-06-03 16:30Z') = '2030-06-03 16:30Z');
select pg_temp.check('piso: completed 10:00:20 → 10:01 (start + 1 min)',
  private.appointment_occupied_until('2030-06-03 16:00Z', '2030-06-03 17:00Z', '2030-06-03 16:00:20Z') = '2030-06-03 16:01Z');
select pg_temp.check('piso: completed = start → start + 1 min',
  private.appointment_occupied_until('2030-06-03 16:00Z', '2030-06-03 17:00Z', '2030-06-03 16:00Z') = '2030-06-03 16:01Z');
select pg_temp.check('nunca crece: completed 10:55 (después de la base 10:50) → 10:50',
  private.appointment_occupied_until('2030-06-03 16:00Z', '2030-06-03 17:00Z', '2030-06-03 16:55Z') = '2030-06-03 16:50Z');
select pg_temp.check('nunca crece: completed después de end_at → base 10:50',
  private.appointment_occupied_until('2030-06-03 16:00Z', '2030-06-03 17:00Z', '2030-06-03 18:00Z') = '2030-06-03 16:50Z');
select pg_temp.check('dato anómalo: completed antes de start → base',
  private.appointment_occupied_until('2030-06-03 16:00Z', '2030-06-03 17:00Z', '2030-06-03 15:00Z') = '2030-06-03 16:50Z');
select pg_temp.check('piso recortado a end_at: cita de 30 s completada al inicio → end_at',
  private.appointment_occupied_until('2030-06-03 16:00Z', '2030-06-03 16:00:30Z', '2030-06-03 16:00Z') = '2030-06-03 16:00:30Z');

-- =============================================================================
-- 3. Finalización anticipada por el flujo real (set_appointment_status)
-- =============================================================================
-- Cita confirmada de 60 min que empezó hace 20 min (barbero 1). Al completarla
-- ahora, completed_at = now() y la ocupación se acorta a now().
insert into public.appointments (id, tenant_id, barber_id, client_id, start_at, end_at, status, source) values
  ('d1000000-0000-0000-0000-0000000000e1', '11000000-0000-0000-0000-00000000000a', 'b1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001',
   now() - interval '20 minutes', now() + interval '40 minutes', 'confirmed', 'online');

select pg_temp.as_user('a1000000-0000-0000-0000-000000000002');  -- barbero 1
select pg_temp.expect_ok('barbero completa su cita (confirmed → completed)',
  $q$select public.set_appointment_status('d1000000-0000-0000-0000-0000000000e1', 'completed')$q$);
select pg_temp.as_postgres();
select pg_temp.check('completada antes de tiempo: occupied_until = completed_at = now()',
  exists (select 1 from public.appointments where id = 'd1000000-0000-0000-0000-0000000000e1'
          and status = 'completed' and completed_at = now() and occupied_until = now()),
  (select format('completed_at=%s occupied_until=%s', completed_at, occupied_until) from public.appointments where id = 'd1000000-0000-0000-0000-0000000000e1'));

-- Insertada ya completada (dato de plataforma): el trigger también acorta.
insert into public.appointments (id, tenant_id, barber_id, client_id, start_at, end_at, status, source, completed_at) values
  ('d1000000-0000-0000-0000-0000000000e2', '11000000-0000-0000-0000-00000000000a', 'b1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001',
   '2030-06-05 15:00Z', '2030-06-05 16:00Z', 'completed', 'online', '2030-06-05 15:30Z');
select pg_temp.check('INSERT completada (completed 15:30, D = 60) → occupied_until 15:30',
  (select occupied_until from public.appointments where id = 'd1000000-0000-0000-0000-0000000000e2') = '2030-06-05 15:30Z');

-- La ocupación liberada por la finalización anticipada se puede usar...
select pg_temp.expect_ok('tras completar 15:00–16:00 a las 15:30: cita a las 15:30 permitida', $q$
  insert into public.appointments (tenant_id, barber_id, client_id, start_at, end_at, status, source) values
  ('11000000-0000-0000-0000-00000000000a', 'b1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001',
   '2030-06-05 15:30Z', '2030-06-05 16:00Z', 'pending', 'online')
$q$);
-- ...pero lo ya ocupado no.
select pg_temp.expect_error('tras completar a las 15:30: cita a las 15:25 rechazada (23P01)', $q$
  insert into public.appointments (tenant_id, barber_id, client_id, start_at, end_at, status, source) values
  ('11000000-0000-0000-0000-00000000000a', 'b1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001',
   '2030-06-05 15:25Z', '2030-06-05 15:30Z', 'pending', 'online')
$q$, '23P01');

-- =============================================================================
-- 4. occupied_until inmutable
-- =============================================================================
-- INSERT: el valor enviado se ignora (postgres).
insert into public.appointments (id, tenant_id, barber_id, client_id, start_at, end_at, status, source, occupied_until) values
  ('d1000000-0000-0000-0000-0000000000f1', '11000000-0000-0000-0000-00000000000a', 'b1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001',
   '2030-06-06 15:00Z', '2030-06-06 15:30Z', 'pending', 'online', '2030-06-06 23:00Z');
select pg_temp.check('INSERT con occupied_until manipulado: se recalcula (15:20)',
  (select occupied_until from public.appointments where id = 'd1000000-0000-0000-0000-0000000000f1') = '2030-06-06 15:20Z');

select pg_temp.as_user('a1000000-0000-0000-0000-000000000001');  -- admin
select pg_temp.expect_error('UPDATE admin: occupied_until (sin privilegio de columna)',
  $q$update public.appointments set occupied_until = occupied_until + interval '1 hour' where id = 'd1000000-0000-0000-0000-0000000000f1'$q$, '42501');
select pg_temp.as_user('a1000000-0000-0000-0000-000000000002');  -- barbero dueño
select pg_temp.expect_error('UPDATE barbero: occupied_until (sin privilegio de columna)',
  $q$update public.appointments set occupied_until = start_at + interval '1 minute' where id = 'd1000000-0000-0000-0000-0000000000f1'$q$, '42501');
select pg_temp.as_user(null);
select pg_temp.expect_error('UPDATE anon: occupied_until',
  $q$update public.appointments set occupied_until = now() where id = 'd1000000-0000-0000-0000-0000000000f1'$q$, '42501');

select pg_temp.as_postgres();
select pg_temp.expect_error('UPDATE postgres: occupied_until (trigger, 42501)',
  $q$update public.appointments set occupied_until = occupied_until + interval '1 hour' where id = 'd1000000-0000-0000-0000-0000000000f1'$q$, '42501');
select pg_temp.expect_error('UPDATE postgres: occupied_until junto con un cambio de estado',
  $q$update public.appointments set status = 'confirmed', occupied_until = start_at + interval '1 minute' where id = 'd1000000-0000-0000-0000-0000000000f1'$q$, '42501');
select pg_temp.check('...occupied_until sigue en 15:20',
  (select occupied_until from public.appointments where id = 'd1000000-0000-0000-0000-0000000000f1') = '2030-06-06 15:20Z');

-- Un UPDATE legítimo (cambio de estado) la conserva / recalcula igual.
select pg_temp.as_user('a1000000-0000-0000-0000-000000000001');
select pg_temp.expect_ok('admin confirma la cita (UPDATE legítimo)',
  $q$select public.set_appointment_status('d1000000-0000-0000-0000-0000000000f1', 'confirmed')$q$);
select pg_temp.as_postgres();
select pg_temp.check('...occupied_until sin cambios tras confirmar',
  (select occupied_until from public.appointments where id = 'd1000000-0000-0000-0000-0000000000f1') = '2030-06-06 15:20Z');

-- =============================================================================
-- 5. Exclusión sobre la ocupación
-- =============================================================================
-- A: 10:00–10:30 local (16:00–16:30Z), ocupación hasta 10:20.
insert into public.appointments (id, tenant_id, barber_id, client_id, start_at, end_at, status, source) values
  ('d1000000-0000-0000-0000-0000000000a1', '11000000-0000-0000-0000-00000000000a', 'b1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001',
   '2030-06-07 16:00Z', '2030-06-07 16:30Z', 'pending', 'online');

select pg_temp.expect_error('A 10:00–10:30: B a las 10:15 rechazada (23P01)', $q$
  insert into public.appointments (tenant_id, barber_id, client_id, start_at, end_at, status, source) values
  ('11000000-0000-0000-0000-00000000000a', 'b1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001',
   '2030-06-07 16:15Z', '2030-06-07 16:45Z', 'pending', 'online')
$q$, '23P01');
select pg_temp.expect_error('A 10:00–10:30: B a las 09:50–10:05 rechazada (23P01)', $q$
  insert into public.appointments (tenant_id, barber_id, client_id, start_at, end_at, status, source) values
  ('11000000-0000-0000-0000-00000000000a', 'b1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001',
   '2030-06-07 15:50Z', '2030-06-07 16:20Z', 'pending', 'online')
$q$, '23P01');
select pg_temp.expect_ok('A 10:00–10:30: B a las 10:20 permitida (margen de 10 min)', $q$
  insert into public.appointments (tenant_id, barber_id, client_id, start_at, end_at, status, source) values
  ('11000000-0000-0000-0000-00000000000a', 'b1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001',
   '2030-06-07 16:20Z', '2030-06-07 16:50Z', 'pending', 'online')
$q$);
select pg_temp.expect_ok('otro barbero a las 10:00 no choca', $q$
  insert into public.appointments (tenant_id, barber_id, client_id, start_at, end_at, status, source) values
  ('11000000-0000-0000-0000-00000000000a', 'b1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001',
   '2030-06-07 16:00Z', '2030-06-07 16:30Z', 'pending', 'online')
$q$);

-- Canceladas y no_show no bloquean.
insert into public.appointments (id, tenant_id, barber_id, client_id, start_at, end_at, status, source) values
  ('d1000000-0000-0000-0000-0000000000a2', '11000000-0000-0000-0000-00000000000a', 'b1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001',
   '2030-06-08 16:00Z', '2030-06-08 16:30Z', 'pending', 'online'),
  ('d1000000-0000-0000-0000-0000000000a3', '11000000-0000-0000-0000-00000000000a', 'b1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001',
   '2030-06-08 18:00Z', '2030-06-08 18:30Z', 'pending', 'online');
update public.appointments set status = 'cancelled', cancellation_reason = 'prueba' where id = 'd1000000-0000-0000-0000-0000000000a2';
update public.appointments set status = 'no_show' where id = 'd1000000-0000-0000-0000-0000000000a3';

select pg_temp.expect_ok('cancelada no bloquea: nueva cita en el mismo horario', $q$
  insert into public.appointments (tenant_id, barber_id, client_id, start_at, end_at, status, source) values
  ('11000000-0000-0000-0000-00000000000a', 'b1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001',
   '2030-06-08 16:00Z', '2030-06-08 16:30Z', 'pending', 'online')
$q$);
select pg_temp.expect_ok('no_show no bloquea: nueva cita en el mismo horario', $q$
  insert into public.appointments (tenant_id, barber_id, client_id, start_at, end_at, status, source) values
  ('11000000-0000-0000-0000-00000000000a', 'b1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001',
   '2030-06-08 18:00Z', '2030-06-08 18:30Z', 'pending', 'online')
$q$);

-- La restricción y el CHECK existen con su definición esperada.
select pg_temp.check('appointments_no_overlap usa tstzrange(start_at, occupied_until)',
  (select pg_get_constraintdef(c.oid) from pg_constraint c
    where c.conrelid = 'public.appointments'::regclass and c.conname = 'appointments_no_overlap')
  like '%tstzrange(start_at, occupied_until%',
  (select pg_get_constraintdef(c.oid) from pg_constraint c
    where c.conrelid = 'public.appointments'::regclass and c.conname = 'appointments_no_overlap'));
select pg_temp.check('occupied_until NOT NULL',
  (select attnotnull from pg_attribute where attrelid = 'public.appointments'::regclass and attname = 'occupied_until'));
select pg_temp.check('no existe la restricción temporal appointments_no_overlap_occupancy',
  not exists (select 1 from pg_constraint where conname = 'appointments_no_overlap_occupancy'));

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
    raise exception 'appointment_occupancy: % de % pruebas FALLARON', _fail, _total;
  end if;
  raise notice 'appointment_occupancy: % de % pruebas PASARON', _total, _total;
end $$;

rollback;
