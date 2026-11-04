-- =============================================================================
-- Pruebas — Step 16 blindaje del lanzamiento (migración 20261105090000)
-- -----------------------------------------------------------------------------
-- SOLO para una base LOCAL o desechable con todas las migraciones aplicadas.
-- Nunca contra producción. Una transacción que termina en ROLLBACK.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/launch_hardening.test.sql
-- =============================================================================

begin;

-- ─── Utilidades ──────────────────────────────────────────────────────────────
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

create function pg_temp.at(_hhmm text, _days int default 1) returns timestamptz language sql stable as $$
  select (((now() at time zone 'America/Mexico_City')::date + _days) + _hhmm::time) at time zone 'America/Mexico_City'
$$;

create function pg_temp.today() returns date language sql stable as $$
  select (now() at time zone 'America/Mexico_City')::date
$$;

grant execute on function pg_temp.at(text, int) to public;
grant execute on function pg_temp.today() to public;

-- ─── Datos de prueba (como postgres) ─────────────────────────────────────────
insert into auth.users (id, email) values
  ('a9000000-0000-0000-0000-000000000001', 'lh-admin@test');

insert into public.tenants (id, slug, name, plan_code, timezone) values
  ('19000000-0000-0000-0000-00000000000a', 'test-lh-k', 'LH Kings', 'barbershop', 'America/Mexico_City'),
  ('19000000-0000-0000-0000-00000000000b', 'test-lh-o', 'LH Otra',  'barbershop', 'America/Mexico_City');

insert into public.tenant_members (tenant_id, user_id, role) values
  ('19000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-000000000001', 'admin');

insert into public.barbers (id, tenant_id, display_name, is_active) values
  ('b9000000-0000-0000-0000-000000000001', '19000000-0000-0000-0000-00000000000a', 'L1', true),
  ('b9000000-0000-0000-0000-000000000002', '19000000-0000-0000-0000-00000000000a', 'L2', true),
  ('b9000000-0000-0000-0000-000000000009', '19000000-0000-0000-0000-00000000000b', 'LO', true);

insert into public.services (id, tenant_id, name, price_cents, duration_minutes) values
  ('59000000-0000-0000-0000-000000000001', '19000000-0000-0000-0000-00000000000a', 'Corte', 25000, 30),
  ('59000000-0000-0000-0000-000000000009', '19000000-0000-0000-0000-00000000000b', 'Corte O', 20000, 30);

-- Abierto todos los días, 08:00–20:00 (barbería y barberos)
insert into public.business_hours (tenant_id, day_of_week, opens_at, closes_at)
select t, d, '08:00', '20:00'
from unnest(array['19000000-0000-0000-0000-00000000000a', '19000000-0000-0000-0000-00000000000b']::uuid[]) t, generate_series(1, 7) d;

insert into public.barber_working_hours (tenant_id, barber_id, day_of_week, opens_at, closes_at)
select b.tenant_id, b.id, d, '08:00', '20:00'
from public.barbers b, generate_series(1, 7) d
where b.tenant_id in ('19000000-0000-0000-0000-00000000000a', '19000000-0000-0000-0000-00000000000b');

create function pg_temp.book(_slug text, _barber uuid, _service uuid, _hhmm text, _days int, _phone text) returns jsonb language sql as $$
  select public.book_appointment(_slug, _barber, array[_service], pg_temp.at(_hhmm, _days), 'Cliente LH', _phone, null)
$$;
grant execute on function pg_temp.book(text, uuid, uuid, text, int, text) to public;

-- =============================================================================
-- 1. Firmas viejas eliminadas
-- =============================================================================
select pg_temp.check('get_available_slots(uuid) ya no existe',
  to_regprocedure('public.get_available_slots(text, uuid, uuid, date)') is null);
select pg_temp.check('book_appointment(uuid) ya no existe',
  to_regprocedure('public.book_appointment(text, uuid, uuid, timestamptz, text, text, text)') is null);
select pg_temp.check('la firma vigente sigue siendo pública y SECURITY DEFINER',
  has_function_privilege('anon', 'public.book_appointment(text, uuid, uuid[], timestamptz, text, text, text)', 'EXECUTE')
  and (select prosecdef and proconfig @> array['search_path=""'] from pg_proc
       where oid = 'public.book_appointment(text, uuid, uuid[], timestamptz, text, text, text)'::regprocedure));

-- =============================================================================
-- 2. Máximo 3 citas futuras activas por teléfono
-- =============================================================================
select pg_temp.as_user(null);
select pg_temp.expect_ok('1.ª reserva', $q$
  select pg_temp.book('test-lh-k', 'b9000000-0000-0000-0000-000000000001', '59000000-0000-0000-0000-000000000001', '09:00', 2, '5580000001')
$q$);
select pg_temp.expect_ok('2.ª reserva', $q$
  select pg_temp.book('test-lh-k', 'b9000000-0000-0000-0000-000000000001', '59000000-0000-0000-0000-000000000001', '10:00', 2, '5580000001')
$q$);
select pg_temp.expect_ok('3.ª reserva, con otro barbero', $q$
  select pg_temp.book('test-lh-k', 'b9000000-0000-0000-0000-000000000002', '59000000-0000-0000-0000-000000000001', '11:00', 3, '5580000001')
$q$);
select pg_temp.expect_error('4.ª reserva → BA013', $q$
  select pg_temp.book('test-lh-k', 'b9000000-0000-0000-0000-000000000002', '59000000-0000-0000-0000-000000000001', '12:00', 3, '5580000001')
$q$, 'BA013');
select pg_temp.expect_error('mismo número con otro formato también cuenta → BA013', $q$
  select pg_temp.book('test-lh-k', 'b9000000-0000-0000-0000-000000000002', '59000000-0000-0000-0000-000000000001', '13:00', 3, '+52 55 8000 0001')
$q$, 'BA013');
select pg_temp.expect_ok('otro teléfono no se afecta', $q$
  select pg_temp.book('test-lh-k', 'b9000000-0000-0000-0000-000000000002', '59000000-0000-0000-0000-000000000001', '12:00', 3, '5580000002')
$q$);
select pg_temp.expect_ok('el mismo teléfono en otra barbería no se afecta', $q$
  select pg_temp.book('test-lh-o', 'b9000000-0000-0000-0000-000000000009', '59000000-0000-0000-0000-000000000009', '12:00', 3, '5580000001')
$q$);

select pg_temp.as_postgres();
select pg_temp.check('la reserva rechazada no dejó cita',
  (select count(*) = 3 from public.appointments a join public.clients c on c.id = a.client_id
   where c.tenant_id = '19000000-0000-0000-0000-00000000000a' and c.phone = '+525580000001'));

-- Cancelar una libera el lugar
select pg_temp.as_user('a9000000-0000-0000-0000-000000000001');
select public.set_appointment_status(
  (select a.id from public.appointments a join public.clients c on c.id = a.client_id
   where c.phone = '+525580000001' and a.tenant_id = '19000000-0000-0000-0000-00000000000a' order by a.start_at limit 1),
  'cancelled', 'prueba');
select pg_temp.as_user(null);
select pg_temp.expect_ok('al cancelar una, puede reservar de nuevo', $q$
  select pg_temp.book('test-lh-k', 'b9000000-0000-0000-0000-000000000002', '59000000-0000-0000-0000-000000000001', '14:00', 3, '5580000001')
$q$);

-- El personal no tiene límite
select pg_temp.as_user('a9000000-0000-0000-0000-000000000001');
select pg_temp.expect_ok('walk-in del personal a un cliente con 3 citas', $q$
  select public.create_walk_in('b9000000-0000-0000-0000-000000000001', array['59000000-0000-0000-0000-000000000001']::uuid[],
    now() - interval '1 minute', 'Cliente LH', '5580000001', null, true)
$q$);

-- =============================================================================
-- 3. Longitudes
-- =============================================================================
select pg_temp.as_user(null);
select pg_temp.expect_error('nombre de más de 120 → 23514', $q$
  select public.book_appointment('test-lh-k', 'b9000000-0000-0000-0000-000000000002', array['59000000-0000-0000-0000-000000000001']::uuid[],
    pg_temp.at('09:00', 5), repeat('a', 121), '5580000003', null)
$q$, '23514');
select pg_temp.expect_error('nota de más de 500 → 23514', $q$
  select public.book_appointment('test-lh-k', 'b9000000-0000-0000-0000-000000000002', array['59000000-0000-0000-0000-000000000001']::uuid[],
    pg_temp.at('09:00', 5), 'Cliente', '5580000003', repeat('a', 501))
$q$, '23514');
select pg_temp.expect_ok('nombre de 120 y nota de 500 sí pasan', $q$
  select public.book_appointment('test-lh-k', 'b9000000-0000-0000-0000-000000000002', array['59000000-0000-0000-0000-000000000001']::uuid[],
    pg_temp.at('09:00', 5), repeat('a', 120), '5580000003', repeat('a', 500))
$q$);

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
    raise exception 'launch_hardening: % de % pruebas FALLARON', _fail, _total;
  end if;
  raise notice 'launch_hardening: % de % pruebas PASARON', _total, _total;
end $$;

rollback;
