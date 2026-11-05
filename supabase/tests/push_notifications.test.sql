-- =============================================================================
-- Pruebas — Step 18 notificaciones push (migración 20261110090000)
-- -----------------------------------------------------------------------------
-- SOLO para una base LOCAL o desechable con todas las migraciones aplicadas.
-- Nunca contra producción. Una transacción que termina en ROLLBACK.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/push_notifications.test.sql
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
  ('ae000000-0000-0000-0000-000000000001', 'pn-admin@test'),
  ('ae000000-0000-0000-0000-000000000002', 'pn-b1@test'),
  ('ae000000-0000-0000-0000-000000000003', 'pn-b2@test'),
  ('ae000000-0000-0000-0000-000000000004', 'pn-otro@test');

insert into public.tenants (id, slug, name, plan_code, timezone) values
  ('1e000000-0000-0000-0000-00000000000a', 'test-pn-k', 'PN Kings', 'barbershop', 'America/Mexico_City'),
  ('1e000000-0000-0000-0000-00000000000b', 'test-pn-o', 'PN Otra',  'barbershop', 'America/Mexico_City');

insert into public.tenant_members (tenant_id, user_id, role) values
  ('1e000000-0000-0000-0000-00000000000a', 'ae000000-0000-0000-0000-000000000001', 'admin'),
  ('1e000000-0000-0000-0000-00000000000a', 'ae000000-0000-0000-0000-000000000002', 'barber'),
  ('1e000000-0000-0000-0000-00000000000a', 'ae000000-0000-0000-0000-000000000003', 'barber'),
  ('1e000000-0000-0000-0000-00000000000b', 'ae000000-0000-0000-0000-000000000004', 'barber');

insert into public.barbers (id, tenant_id, user_id, display_name, is_active) values
  ('be000000-0000-0000-0000-000000000001', '1e000000-0000-0000-0000-00000000000a', 'ae000000-0000-0000-0000-000000000002', 'N1', true),
  ('be000000-0000-0000-0000-000000000002', '1e000000-0000-0000-0000-00000000000a', 'ae000000-0000-0000-0000-000000000003', 'N2', true),
  ('be000000-0000-0000-0000-000000000003', '1e000000-0000-0000-0000-00000000000a', null, 'N3 sin cuenta', true),
  ('be000000-0000-0000-0000-000000000009', '1e000000-0000-0000-0000-00000000000b', 'ae000000-0000-0000-0000-000000000004', 'O1', true);

insert into public.services (id, tenant_id, name, price_cents, duration_minutes) values
  ('5e000000-0000-0000-0000-000000000001', '1e000000-0000-0000-0000-00000000000a', 'Corte', 25000, 30);

insert into public.business_hours (tenant_id, day_of_week, opens_at, closes_at)
select '1e000000-0000-0000-0000-00000000000a', d, '08:00', '20:00' from generate_series(1, 7) d;
insert into public.barber_working_hours (tenant_id, barber_id, day_of_week, opens_at, closes_at)
select b.tenant_id, b.id, d, '08:00', '20:00'
from public.barbers b, generate_series(1, 7) d
where b.tenant_id = '1e000000-0000-0000-0000-00000000000a';

create function pg_temp.book(_barber uuid, _hhmm text, _phone text) returns jsonb language sql as $$
  select public.book_appointment('test-pn-k', _barber, array['5e000000-0000-0000-0000-000000000001']::uuid[], pg_temp.at(_hhmm, 2), 'Cliente PN', _phone, null)
$$;
grant execute on function pg_temp.book(uuid, text, text) to public;

-- =============================================================================
-- 1. Registrar dispositivos
-- =============================================================================
select pg_temp.as_user('ae000000-0000-0000-0000-000000000002');
select pg_temp.expect_ok('barbero registra Android', $q$
  select public.save_push_subscription('1e000000-0000-0000-0000-00000000000a', 'https://fcm.googleapis.com/fcm/send/abc')
$q$);
select pg_temp.expect_ok('barbero registra iPhone', $q$
  select public.save_push_subscription('1e000000-0000-0000-0000-00000000000a', 'https://web.push.apple.com/abc')
$q$);
select pg_temp.expect_ok('registrar dos veces no duplica', $q$
  select public.save_push_subscription('1e000000-0000-0000-0000-00000000000a', 'https://fcm.googleapis.com/fcm/send/abc')
$q$);
select pg_temp.expect_error('dominio ajeno → 23514', $q$
  select public.save_push_subscription('1e000000-0000-0000-0000-00000000000a', 'https://evil.com/push')
$q$, '23514');
select pg_temp.expect_error('dominio parecido → 23514', $q$
  select public.save_push_subscription('1e000000-0000-0000-0000-00000000000a', 'https://fcm.googleapis.com.evil.com/x')
$q$, '23514');
select pg_temp.expect_error('red interna → 23514', $q$
  select public.save_push_subscription('1e000000-0000-0000-0000-00000000000a', 'http://169.254.169.254/latest')
$q$, '23514');
select pg_temp.expect_error('sin https → 23514', $q$
  select public.save_push_subscription('1e000000-0000-0000-0000-00000000000a', 'http://fcm.googleapis.com/fcm/send/x')
$q$, '23514');
select pg_temp.expect_error('barbería ajena → P0002', $q$
  select public.save_push_subscription('1e000000-0000-0000-0000-00000000000b', 'https://fcm.googleapis.com/fcm/send/x')
$q$, 'P0002');
select pg_temp.expect_error('la tabla no se lee por API → 42501', $q$
  select * from public.push_subscriptions
$q$, '42501');
select pg_temp.expect_error('la tabla no se escribe por API → 42501', $q$
  insert into public.push_subscriptions (tenant_id, user_id, endpoint)
  values ('1e000000-0000-0000-0000-00000000000a', 'ae000000-0000-0000-0000-000000000002', 'https://fcm.googleapis.com/fcm/send/z')
$q$, '42501');

select pg_temp.as_user('ae000000-0000-0000-0000-000000000001');
select pg_temp.expect_error('admin sin perfil de barbero → P0002', $q$
  select public.save_push_subscription('1e000000-0000-0000-0000-00000000000a', 'https://fcm.googleapis.com/fcm/send/adm')
$q$, 'P0002');
select pg_temp.as_user(null);
select pg_temp.expect_error('anon → 42501', $q$
  select public.save_push_subscription('1e000000-0000-0000-0000-00000000000a', 'https://fcm.googleapis.com/fcm/send/an')
$q$, '42501');

select pg_temp.as_postgres();
select pg_temp.check('quedan 2 dispositivos de N1',
  (select count(*) = 2 from public.push_subscriptions where user_id = 'ae000000-0000-0000-0000-000000000002'));

-- Límite de 5
select pg_temp.as_user('ae000000-0000-0000-0000-000000000003');
do $$
begin
  for i in 1..7 loop
    perform public.save_push_subscription('1e000000-0000-0000-0000-00000000000a', 'https://fcm.googleapis.com/fcm/send/n2-' || i);
  end loop;
end $$;
select pg_temp.as_postgres();
select pg_temp.check('máximo 5 dispositivos por persona',
  (select count(*) = 5 from public.push_subscriptions where user_id = 'ae000000-0000-0000-0000-000000000003'));

-- Teléfono compartido
select pg_temp.as_user('ae000000-0000-0000-0000-000000000003');
select pg_temp.expect_ok('otra cuenta activa el mismo teléfono', $q$
  select public.save_push_subscription('1e000000-0000-0000-0000-00000000000a', 'https://web.push.apple.com/abc')
$q$);
select pg_temp.as_postgres();
select pg_temp.check('el teléfono pasó a la última cuenta',
  (select user_id = 'ae000000-0000-0000-0000-000000000003' from public.push_subscriptions where endpoint = 'https://web.push.apple.com/abc'));

select pg_temp.as_user('ae000000-0000-0000-0000-000000000002');
select public.delete_push_subscription('https://web.push.apple.com/abc');
select pg_temp.as_postgres();
select pg_temp.check('no se puede quitar el dispositivo de otro',
  (select count(*) = 1 from public.push_subscriptions where endpoint = 'https://web.push.apple.com/abc'));
select pg_temp.as_user('ae000000-0000-0000-0000-000000000003');
select public.delete_push_subscription('https://web.push.apple.com/abc');
select pg_temp.as_postgres();
select pg_temp.check('quita su propio dispositivo',
  (select count(*) = 0 from public.push_subscriptions where endpoint = 'https://web.push.apple.com/abc'));

-- =============================================================================
-- 2. El aviso nunca tumba la reserva
-- =============================================================================
select pg_temp.as_user(null);
select pg_temp.expect_ok('sin pg_net ni Vault la reserva entra igual', $q$
  select pg_temp.book('be000000-0000-0000-0000-000000000001', '09:00', '5570001001')
$q$);

-- Sustitutos de pg_net y Vault
select pg_temp.as_postgres();
create temp table _calls (url text, headers jsonb, body jsonb);
grant all on _calls to public;
create schema net;
create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds integer) returns bigint language plpgsql as $f$
begin
  insert into pg_temp._calls values (url, headers, body);
  return 1;
end $f$;
create schema vault;
create table vault.decrypted_secrets (name text, decrypted_secret text);

select pg_temp.as_user(null);
select pg_temp.expect_ok('sin claves en Vault la reserva entra igual', $q$
  select pg_temp.book('be000000-0000-0000-0000-000000000001', '09:40', '5570001002')
$q$);
select pg_temp.as_postgres();
select pg_temp.check('sin claves no se envía nada', (select count(*) = 0 from _calls));

insert into vault.decrypted_secrets values ('push_webhook_url', 'https://sitio.test/api/push/send'), ('push_webhook_secret', 'secreto');

-- =============================================================================
-- 3. A quién se avisa
-- =============================================================================
select pg_temp.as_user(null);
select pg_temp.expect_ok('reserva con N1', $q$
  select pg_temp.book('be000000-0000-0000-0000-000000000001', '10:20', '5570001003')
$q$);
select pg_temp.as_postgres();
select pg_temp.check('una llamada al servidor con la clave',
  (select count(*) = 1 and bool_and(url = 'https://sitio.test/api/push/send' and headers ->> 'x-push-secret' = 'secreto') from _calls));
select pg_temp.check('solo el dispositivo de N1',
  (select body -> 'endpoints' = '["https://fcm.googleapis.com/fcm/send/abc"]'::jsonb from _calls));
select pg_temp.check('sin datos del cliente en el aviso',
  (select body::text not like '%Cliente PN%' and body::text not like '%5570001003%' from _calls));

truncate _calls;
select pg_temp.as_user(null);
select pg_temp.expect_ok('reserva con barbero sin cuenta', $q$
  select pg_temp.book('be000000-0000-0000-0000-000000000003', '10:20', '5570001004')
$q$);
select pg_temp.as_postgres();
select pg_temp.check('barbero sin dispositivos: no se avisa', (select count(*) = 0 from _calls));

-- Walk-in: lo registra el personal, no avisa
select pg_temp.as_user('ae000000-0000-0000-0000-000000000001');
select pg_temp.expect_ok('walk-in', $q$
  select public.create_walk_in('be000000-0000-0000-0000-000000000001', array['5e000000-0000-0000-0000-000000000001']::uuid[],
    now() - interval '1 minute', 'Sin cita', '5570001005', null, true)
$q$);
select pg_temp.as_postgres();
select pg_temp.check('un walk-in no avisa', (select count(*) = 0 from _calls));

-- Si el envío falla, la reserva sigue
create or replace function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds integer) returns bigint language plpgsql as $f$
begin
  raise exception 'caído';
end $f$;
select pg_temp.as_user(null);
select pg_temp.expect_ok('pg_net falla y la reserva entra igual', $q$
  select pg_temp.book('be000000-0000-0000-0000-000000000001', '11:00', '5570001006')
$q$);

-- =============================================================================
-- 4. Fin de la relación
-- =============================================================================
select pg_temp.as_postgres();
delete from public.barbers where id = 'be000000-0000-0000-0000-000000000002';
delete from public.tenant_members where user_id = 'ae000000-0000-0000-0000-000000000003';
select pg_temp.check('sin membresía se borran sus dispositivos',
  (select count(*) = 0 from public.push_subscriptions where user_id = 'ae000000-0000-0000-0000-000000000003'));

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
    raise exception 'push_notifications: % de % pruebas FALLARON', _fail, _total;
  end if;
  raise notice 'push_notifications: % de % pruebas PASARON', _total, _total;
end $$;

rollback;
