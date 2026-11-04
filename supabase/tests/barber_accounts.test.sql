-- =============================================================================
-- Pruebas — Step 17 cuentas y WhatsApp de barberos (migración 20261106090000)
-- -----------------------------------------------------------------------------
-- SOLO para una base LOCAL o desechable con todas las migraciones aplicadas.
-- Nunca contra producción. Una transacción que termina en ROLLBACK.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/barber_accounts.test.sql
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
  ('ab000000-0000-0000-0000-000000000001', 'ba-admin-k@test'),
  ('ab000000-0000-0000-0000-000000000002', 'ba-nuevo@test'),
  ('ab000000-0000-0000-0000-000000000003', 'ba-otro@test'),
  ('ab000000-0000-0000-0000-000000000004', 'ba-admin-o@test'),
  ('ab000000-0000-0000-0000-000000000005', 'ba-barbero-ligado@test');

insert into public.tenants (id, slug, name, plan_code, timezone) values
  ('1b000000-0000-0000-0000-00000000000a', 'test-ba-k', 'BA Kings', 'barbershop', 'America/Mexico_City'),
  ('1b000000-0000-0000-0000-00000000000b', 'test-ba-o', 'BA Otra',  'barbershop', 'America/Mexico_City');

insert into public.tenant_members (tenant_id, user_id, role) values
  ('1b000000-0000-0000-0000-00000000000a', 'ab000000-0000-0000-0000-000000000001', 'admin'),
  ('1b000000-0000-0000-0000-00000000000a', 'ab000000-0000-0000-0000-000000000005', 'barber'),
  ('1b000000-0000-0000-0000-00000000000b', 'ab000000-0000-0000-0000-000000000004', 'admin');

insert into public.barbers (id, tenant_id, user_id, display_name, is_active) values
  ('bb000000-0000-0000-0000-000000000001', '1b000000-0000-0000-0000-00000000000a', null, 'Sin cuenta', true),
  ('bb000000-0000-0000-0000-000000000002', '1b000000-0000-0000-0000-00000000000a', 'ab000000-0000-0000-0000-000000000005', 'Ligado', true),
  ('bb000000-0000-0000-0000-000000000003', '1b000000-0000-0000-0000-00000000000a', null, 'Inactivo', false),
  ('bb000000-0000-0000-0000-000000000004', '1b000000-0000-0000-0000-00000000000a', null, 'Otro sin cuenta', true);

insert into public.services (id, tenant_id, name, price_cents, duration_minutes) values
  ('5b000000-0000-0000-0000-000000000001', '1b000000-0000-0000-0000-00000000000a', 'Corte', 25000, 30);

insert into public.business_hours (tenant_id, day_of_week, opens_at, closes_at)
select '1b000000-0000-0000-0000-00000000000a', d, '08:00', '20:00' from generate_series(1, 7) d;
insert into public.barber_working_hours (tenant_id, barber_id, day_of_week, opens_at, closes_at)
select b.tenant_id, b.id, d, '08:00', '20:00'
from public.barbers b, generate_series(1, 7) d
where b.tenant_id = '1b000000-0000-0000-0000-00000000000a' and b.is_active;

create temp table _tok (who text primary key, token text);
grant all on _tok to public;

-- =============================================================================
-- 1. Crear invitación
-- =============================================================================
select pg_temp.as_user('ab000000-0000-0000-0000-000000000001');
insert into _tok select 'a', public.create_barber_invite('bb000000-0000-0000-0000-000000000001') ->> 'token';
select pg_temp.check('el token tiene 64 caracteres', (select char_length(token) = 64 from _tok where who = 'a'));

select pg_temp.as_postgres();
select pg_temp.check('solo se guarda el hash',
  (select count(*) = 1 and bool_and(i.token_hash <> t.token and char_length(i.token_hash) = 64)
   from public.barber_invites i, _tok t where t.who = 'a'));
select pg_temp.check('vence en 7 días',
  (select expires_at > now() + interval '6 days 23 hours' and expires_at <= now() + interval '7 days' from public.barber_invites));

select pg_temp.as_user('ab000000-0000-0000-0000-000000000001');
select pg_temp.expect_error('barbero con cuenta → BA014', $q$
  select public.create_barber_invite('bb000000-0000-0000-0000-000000000002')
$q$, 'BA014');
select pg_temp.expect_error('barbero inactivo → 23514', $q$
  select public.create_barber_invite('bb000000-0000-0000-0000-000000000003')
$q$, '23514');
select pg_temp.expect_error('admin no lee la tabla directamente → 42501', $q$
  select * from public.barber_invites
$q$, '42501');

select pg_temp.as_user('ab000000-0000-0000-0000-000000000004');
select pg_temp.expect_error('admin de otra barbería → P0002', $q$
  select public.create_barber_invite('bb000000-0000-0000-0000-000000000001')
$q$, 'P0002');
select pg_temp.as_user('ab000000-0000-0000-0000-000000000005');
select pg_temp.expect_error('un barbero no invita → P0002', $q$
  select public.create_barber_invite('bb000000-0000-0000-0000-000000000001')
$q$, 'P0002');
select pg_temp.as_user(null);
select pg_temp.expect_error('anon no invita → 42501', $q$
  select public.create_barber_invite('bb000000-0000-0000-0000-000000000001')
$q$, '42501');

-- =============================================================================
-- 2. Leer invitación (público)
-- =============================================================================
select pg_temp.check('anon lee nombre de barbero y barbería',
  (select r ->> 'barber_name' = 'Sin cuenta' and r ->> 'tenant_name' = 'BA Kings'
   from (select public.get_barber_invite((select token from _tok where who = 'a')) as r) x));
select pg_temp.expect_error('token falso → P0002', $q$
  select public.get_barber_invite('falso')
$q$, 'P0002');
select pg_temp.expect_error('token nulo → P0002', $q$
  select public.get_barber_invite(null)
$q$, 'P0002');

-- Una invitación nueva revoca la anterior
select pg_temp.as_user('ab000000-0000-0000-0000-000000000001');
insert into _tok select 'b', public.create_barber_invite('bb000000-0000-0000-0000-000000000001') ->> 'token';
select pg_temp.as_user(null);
select pg_temp.expect_error('la invitación anterior queda revocada → P0002', $q$
  select public.get_barber_invite((select token from _tok where who = 'a'))
$q$, 'P0002');

-- =============================================================================
-- 3. Aceptar invitación
-- =============================================================================
select pg_temp.expect_error('sin sesión → 42501', $q$
  select public.accept_barber_invite((select token from _tok where who = 'b'), null)
$q$, '42501');

select pg_temp.as_user('ab000000-0000-0000-0000-000000000002');
select pg_temp.check('antes de aceptar no ve ningún cliente ni barbería',
  (select count(*) = 0 from public.barbers));
select pg_temp.expect_error('WhatsApp inválido → 23514', $q$
  select public.accept_barber_invite((select token from _tok where who = 'b'), '123')
$q$, '23514');
select pg_temp.expect_error('token revocado → P0002', $q$
  select public.accept_barber_invite((select token from _tok where who = 'a'), null)
$q$, 'P0002');
select pg_temp.expect_ok('acepta con token vigente', $q$
  select public.accept_barber_invite((select token from _tok where who = 'b'), '55 6000 0001')
$q$);
select pg_temp.check('ahora es miembro con rol barber',
  (select role = 'barber' from public.tenant_members where user_id = 'ab000000-0000-0000-0000-000000000002'));
select pg_temp.check('el perfil quedó ligado con su WhatsApp',
  (select user_id = 'ab000000-0000-0000-0000-000000000002' and whatsapp_phone = '+525560000001'
   from public.barbers where id = 'bb000000-0000-0000-0000-000000000001'));
select pg_temp.check('my_barber_id lo reconoce',
  (select private.my_barber_id('1b000000-0000-0000-0000-00000000000a') = 'bb000000-0000-0000-0000-000000000001'));

select pg_temp.as_user('ab000000-0000-0000-0000-000000000003');
select pg_temp.expect_error('un solo uso: otra cuenta → P0002', $q$
  select public.accept_barber_invite((select token from _tok where who = 'b'), null)
$q$, 'P0002');

-- Admin que abre el enlace con su propia cuenta
select pg_temp.as_user('ab000000-0000-0000-0000-000000000001');
insert into _tok select 'c', public.create_barber_invite('bb000000-0000-0000-0000-000000000004') ->> 'token';
select pg_temp.expect_error('una cuenta que ya es miembro → BA014', $q$
  select public.accept_barber_invite((select token from _tok where who = 'c'), null)
$q$, 'BA014');
select pg_temp.check('...y no cambió su rol ni el perfil',
  (select role = 'admin' from public.tenant_members where user_id = 'ab000000-0000-0000-0000-000000000001'
     and tenant_id = '1b000000-0000-0000-0000-00000000000a')
  and (select user_id is null from public.barbers where id = 'bb000000-0000-0000-0000-000000000004'));

-- Vencida
select pg_temp.as_postgres();
update public.barber_invites set expires_at = now() - interval '1 minute'
where barber_id = 'bb000000-0000-0000-0000-000000000004' and used_at is null and revoked_at is null;
select pg_temp.as_user('ab000000-0000-0000-0000-000000000003');
select pg_temp.expect_error('invitación vencida → P0002', $q$
  select public.accept_barber_invite((select token from _tok where who = 'c'), null)
$q$, 'P0002');

-- Barbero desactivado después de invitar
select pg_temp.as_user('ab000000-0000-0000-0000-000000000001');
insert into _tok select 'd', public.create_barber_invite('bb000000-0000-0000-0000-000000000004') ->> 'token';
update public.barbers set is_active = false where id = 'bb000000-0000-0000-0000-000000000004';
select pg_temp.as_user('ab000000-0000-0000-0000-000000000003');
select pg_temp.expect_error('barbero desactivado → P0002', $q$
  select public.accept_barber_invite((select token from _tok where who = 'd'), null)
$q$, 'P0002');
select pg_temp.as_user('ab000000-0000-0000-0000-000000000001');
update public.barbers set is_active = true where id = 'bb000000-0000-0000-0000-000000000004';

-- Sin invitación no se puede tomar un perfil
select pg_temp.as_user('ab000000-0000-0000-0000-000000000005');
select pg_temp.expect_error('barbero ligado no cambia su user_id', $q$
  update public.barbers set user_id = 'ab000000-0000-0000-0000-000000000003' where id = 'bb000000-0000-0000-0000-000000000002'
$q$, 'P0001');
update public.barbers set user_id = 'ab000000-0000-0000-0000-000000000005' where id = 'bb000000-0000-0000-0000-000000000004';
select pg_temp.as_postgres();
select pg_temp.check('RLS: no puede tomar el perfil de otro barbero',
  (select user_id is null from public.barbers where id = 'bb000000-0000-0000-0000-000000000004'));

-- =============================================================================
-- 4. WhatsApp del barbero
-- =============================================================================
select pg_temp.as_user('ab000000-0000-0000-0000-000000000005');
select pg_temp.expect_ok('el barbero guarda su número', $q$
  select public.set_barber_whatsapp('bb000000-0000-0000-0000-000000000002', '55 6000 0002')
$q$);
select pg_temp.check('número normalizado',
  (select whatsapp_phone = '+525560000002' from public.barbers where id = 'bb000000-0000-0000-0000-000000000002'));
select pg_temp.expect_error('no puede cambiar el de otro → P0002', $q$
  select public.set_barber_whatsapp('bb000000-0000-0000-0000-000000000001', '5560000003')
$q$, 'P0002');
select pg_temp.expect_error('número inválido → 23514', $q$
  select public.set_barber_whatsapp('bb000000-0000-0000-0000-000000000002', '12')
$q$, '23514');
select pg_temp.expect_error('UPDATE directo con formato inválido → 23514', $q$
  update public.barbers set whatsapp_phone = '123' where id = 'bb000000-0000-0000-0000-000000000002'
$q$, '23514');
select pg_temp.expect_error('sigue sin poder cambiar su nombre', $q$
  update public.barbers set display_name = 'Otro' where id = 'bb000000-0000-0000-0000-000000000002'
$q$, 'P0001');

select pg_temp.as_user('ab000000-0000-0000-0000-000000000001');
select pg_temp.expect_ok('el admin guarda el de un barbero sin cuenta', $q$
  select public.set_barber_whatsapp('bb000000-0000-0000-0000-000000000004', '5560000004')
$q$);
select pg_temp.as_user('ab000000-0000-0000-0000-000000000004');
select pg_temp.expect_error('admin de otra barbería → P0002', $q$
  select public.set_barber_whatsapp('bb000000-0000-0000-0000-000000000002', '5560000005')
$q$, 'P0002');
select pg_temp.as_user(null);
select pg_temp.expect_error('anon → 42501', $q$
  select public.set_barber_whatsapp('bb000000-0000-0000-0000-000000000002', '5560000005')
$q$, '42501');

-- =============================================================================
-- 5. Reserva y exposición del número
-- =============================================================================
select pg_temp.check('la página pública no expone el número',
  (select position('5560000002' in public.get_public_tenant('test-ba-k')::text) = 0));
select pg_temp.check('reservar devuelve el WhatsApp del barbero elegido',
  (select public.book_appointment('test-ba-k', 'bb000000-0000-0000-0000-000000000002', array['5b000000-0000-0000-0000-000000000001']::uuid[],
     pg_temp.at('10:00', 2), 'Cliente', '5560009001', null) ->> 'barber_whatsapp' = '+525560000002'));
select pg_temp.as_user('ab000000-0000-0000-0000-000000000001');
select public.set_barber_whatsapp('bb000000-0000-0000-0000-000000000004', '');
select pg_temp.as_user(null);
select pg_temp.check('barbero sin número: barber_whatsapp null',
  (select public.book_appointment('test-ba-k', 'bb000000-0000-0000-0000-000000000004', array['5b000000-0000-0000-0000-000000000001']::uuid[],
     pg_temp.at('11:00', 2), 'Cliente', '5560009002', null) -> 'barber_whatsapp' = 'null'::jsonb));

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
    raise exception 'barber_accounts: % de % pruebas FALLARON', _fail, _total;
  end if;
  raise notice 'barber_accounts: % de % pruebas PASARON', _total, _total;
end $$;

rollback;
