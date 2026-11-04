-- =============================================================================
-- Pruebas — Step 17 ubicación y fotos (migración 20261107090000)
-- -----------------------------------------------------------------------------
-- SOLO para una base LOCAL o desechable con todas las migraciones aplicadas.
-- Nunca contra producción. Una transacción que termina en ROLLBACK.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/location_photos.test.sql
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
  ('ac000000-0000-0000-0000-000000000001', 'lp-admin-k@test'),
  ('ac000000-0000-0000-0000-000000000002', 'lp-barbero-1@test'),
  ('ac000000-0000-0000-0000-000000000003', 'lp-barbero-2@test'),
  ('ac000000-0000-0000-0000-000000000004', 'lp-admin-o@test');

insert into public.tenants (id, slug, name, plan_code, timezone) values
  ('1c000000-0000-0000-0000-00000000000a', 'test-lp-k', 'LP Kings', 'barbershop', 'America/Mexico_City'),
  ('1c000000-0000-0000-0000-00000000000b', 'test-lp-o', 'LP Otra',  'barbershop', 'America/Mexico_City');

insert into public.tenant_members (tenant_id, user_id, role) values
  ('1c000000-0000-0000-0000-00000000000a', 'ac000000-0000-0000-0000-000000000001', 'admin'),
  ('1c000000-0000-0000-0000-00000000000a', 'ac000000-0000-0000-0000-000000000002', 'barber'),
  ('1c000000-0000-0000-0000-00000000000a', 'ac000000-0000-0000-0000-000000000003', 'barber'),
  ('1c000000-0000-0000-0000-00000000000b', 'ac000000-0000-0000-0000-000000000004', 'admin');

insert into public.barbers (id, tenant_id, user_id, display_name, is_active) values
  ('bc000000-0000-0000-0000-000000000001', '1c000000-0000-0000-0000-00000000000a', 'ac000000-0000-0000-0000-000000000002', 'P1', true),
  ('bc000000-0000-0000-0000-000000000002', '1c000000-0000-0000-0000-00000000000a', 'ac000000-0000-0000-0000-000000000003', 'P2', true);

-- =============================================================================
-- 1. Ubicación
-- =============================================================================
select pg_temp.as_user('ac000000-0000-0000-0000-000000000001');
select pg_temp.expect_ok('admin guarda la dirección', $q$
  select public.update_tenant_location('1c000000-0000-0000-0000-00000000000a', '  Av. Reforma 123  ', 'CDMX', 'Ciudad de México', '06600')
$q$);
select pg_temp.check('quedó guardada y sin espacios',
  (select address_line = 'Av. Reforma 123' and city = 'CDMX' and state = 'Ciudad de México' and postal_code = '06600'
   from public.tenants where id = '1c000000-0000-0000-0000-00000000000a'));
select pg_temp.expect_error('código postal inválido → 23514', $q$
  select public.update_tenant_location('1c000000-0000-0000-0000-00000000000a', 'X', 'Y', 'Z', '123')
$q$, '23514');
select pg_temp.expect_error('dirección de más de 200 → 23514', $q$
  select public.update_tenant_location('1c000000-0000-0000-0000-00000000000a', repeat('a', 201), 'Y', 'Z', null)
$q$, '23514');
select pg_temp.expect_error('ciudad de más de 80 → 23514', $q$
  select public.update_tenant_location('1c000000-0000-0000-0000-00000000000a', 'X', repeat('a', 81), 'Z', null)
$q$, '23514');
select pg_temp.expect_error('UPDATE directo sigue prohibido → 42501', $q$
  update public.tenants set address_line = 'Otra' where id = '1c000000-0000-0000-0000-00000000000a'
$q$, '42501');
select pg_temp.expect_error('admin sobre otra barbería → 42501', $q$
  select public.update_tenant_location('1c000000-0000-0000-0000-00000000000b', 'X', 'Y', 'Z', null)
$q$, '42501');

select pg_temp.as_user('ac000000-0000-0000-0000-000000000002');
select pg_temp.expect_error('barbero → 42501', $q$
  select public.update_tenant_location('1c000000-0000-0000-0000-00000000000a', 'X', 'Y', 'Z', null)
$q$, '42501');
select pg_temp.as_user(null);
select pg_temp.expect_error('anon → 42501', $q$
  select public.update_tenant_location('1c000000-0000-0000-0000-00000000000a', 'X', 'Y', 'Z', null)
$q$, '42501');
select pg_temp.check('la página pública muestra la dirección',
  (select r ->> 'address_line' = 'Av. Reforma 123' and r ->> 'city' = 'CDMX' and r ->> 'postal_code' = '06600'
   from (select public.get_public_tenant('test-lp-k') as r) x));

select pg_temp.as_user('ac000000-0000-0000-0000-000000000001');
select pg_temp.expect_ok('campos vacíos borran la dirección', $q$
  select public.update_tenant_location('1c000000-0000-0000-0000-00000000000a', '  ', '', null, '')
$q$);
select pg_temp.check('quedó en NULL',
  (select address_line is null and city is null and state is null and postal_code is null
   from public.tenants where id = '1c000000-0000-0000-0000-00000000000a'));

-- Punto en el mapa (migración 20261109090000)
select pg_temp.expect_ok('guarda el punto del mapa', $q$
  select public.update_tenant_location('1c000000-0000-0000-0000-00000000000a', 'Calle 1', 'CDMX', null, null, '19.4352236,-99.1412266')
$q$);
select pg_temp.expect_ok('sin _map_query conserva el punto', $q$
  select public.update_tenant_location('1c000000-0000-0000-0000-00000000000a', 'Calle 2', 'CDMX', null, null)
$q$);
select pg_temp.check('el punto sigue y cambió la calle',
  (select map_query = '19.4352236,-99.1412266' and address_line = 'Calle 2' from public.tenants where id = '1c000000-0000-0000-0000-00000000000a'));
select pg_temp.expect_error('punto de más de 300 → 23514', $q$
  select public.update_tenant_location('1c000000-0000-0000-0000-00000000000a', 'X', 'Y', null, null, repeat('a', 301))
$q$, '23514');
select pg_temp.expect_error('UPDATE directo de map_query → 42501', $q$
  update public.tenants set map_query = 'x' where id = '1c000000-0000-0000-0000-00000000000a'
$q$, '42501');
select pg_temp.as_user(null);
select pg_temp.check('la página pública devuelve el punto',
  (select public.get_public_tenant('test-lp-k') ->> 'map_query' = '19.4352236,-99.1412266'));
select pg_temp.as_user('ac000000-0000-0000-0000-000000000001');
select pg_temp.expect_ok('vacío quita el punto', $q$
  select public.update_tenant_location('1c000000-0000-0000-0000-00000000000a', 'Calle 2', 'CDMX', null, null, '')
$q$);
select pg_temp.check('sin punto',
  (select map_query is null from public.tenants where id = '1c000000-0000-0000-0000-00000000000a'));

-- =============================================================================
-- 2. Foto del barbero
-- =============================================================================
select pg_temp.as_user('ac000000-0000-0000-0000-000000000002');
select pg_temp.expect_ok('el barbero pone su foto', $q$
  update public.barbers set photo_url = 'https://example.com/yo.jpg' where id = 'bc000000-0000-0000-0000-000000000001'
$q$);
select pg_temp.check('quedó guardada',
  (select photo_url = 'https://example.com/yo.jpg' from public.barbers where id = 'bc000000-0000-0000-0000-000000000001'));
select pg_temp.expect_error('http sin s → 23514', $q$
  update public.barbers set photo_url = 'http://example.com/yo.jpg' where id = 'bc000000-0000-0000-0000-000000000001'
$q$, '23514');
select pg_temp.expect_error('javascript: → 23514', $q$
  update public.barbers set photo_url = 'javascript:alert(1)' where id = 'bc000000-0000-0000-0000-000000000001'
$q$, '23514');
select pg_temp.expect_error('con espacios → 23514', $q$
  update public.barbers set photo_url = 'https://example.com/a b.jpg' where id = 'bc000000-0000-0000-0000-000000000001'
$q$, '23514');
select pg_temp.expect_error('de más de 1000 → 23514', $q$
  update public.barbers set photo_url = 'https://example.com/' || repeat('a', 1000) where id = 'bc000000-0000-0000-0000-000000000001'
$q$, '23514');
select pg_temp.expect_ok('puede quitarla', $q$
  update public.barbers set photo_url = null where id = 'bc000000-0000-0000-0000-000000000001'
$q$);
update public.barbers set photo_url = 'https://example.com/hack.jpg' where id = 'bc000000-0000-0000-0000-000000000002';
select pg_temp.as_postgres();
select pg_temp.check('no puede cambiar la foto de otro barbero',
  (select photo_url is null from public.barbers where id = 'bc000000-0000-0000-0000-000000000002'));

select pg_temp.as_user('ac000000-0000-0000-0000-000000000001');
select pg_temp.expect_ok('el admin también puede ponerla', $q$
  update public.barbers set photo_url = 'https://example.com/p2.jpg' where id = 'bc000000-0000-0000-0000-000000000002'
$q$);
select pg_temp.as_user(null);
select pg_temp.check('la foto aparece en la página pública',
  (select public.get_public_tenant('test-lp-k')::text like '%https://example.com/p2.jpg%'));

-- =============================================================================
-- 3. El barbero personaliza su tarjeta (migración 20261108090000)
-- =============================================================================
select pg_temp.as_user('ac000000-0000-0000-0000-000000000002');
select pg_temp.expect_ok('cambia nombre, puesto y descripción', $q$
  update public.barbers set display_name = 'Luis', role_title = 'Fades', bio = 'Diez años de oficio'
  where id = 'bc000000-0000-0000-0000-000000000001'
$q$);
select pg_temp.expect_error('nombre vacío → 23514', $q$
  update public.barbers set display_name = '   ' where id = 'bc000000-0000-0000-0000-000000000001'
$q$, '23514');
select pg_temp.expect_error('nombre de más de 80 → 23514', $q$
  update public.barbers set display_name = repeat('a', 81) where id = 'bc000000-0000-0000-0000-000000000001'
$q$, '23514');
select pg_temp.expect_error('puesto de más de 80 → 23514', $q$
  update public.barbers set role_title = repeat('a', 81) where id = 'bc000000-0000-0000-0000-000000000001'
$q$, '23514');
select pg_temp.expect_error('descripción de más de 300 → 23514', $q$
  update public.barbers set bio = repeat('a', 301) where id = 'bc000000-0000-0000-0000-000000000001'
$q$, '23514');
select pg_temp.expect_error('no se desactiva a sí mismo', $q$
  update public.barbers set is_active = false where id = 'bc000000-0000-0000-0000-000000000001'
$q$, 'P0001');
select pg_temp.expect_error('no cambia su orden', $q$
  update public.barbers set sort_order = 99 where id = 'bc000000-0000-0000-0000-000000000001'
$q$, 'P0001');
select pg_temp.expect_error('no se quita la cuenta', $q$
  update public.barbers set user_id = null where id = 'bc000000-0000-0000-0000-000000000001'
$q$, 'P0001');
update public.barbers set display_name = 'Hackeado', bio = 'x' where id = 'bc000000-0000-0000-0000-000000000002';
select pg_temp.as_postgres();
select pg_temp.check('no edita la tarjeta de otro barbero',
  (select display_name = 'P2' and bio is null from public.barbers where id = 'bc000000-0000-0000-0000-000000000002'));
select pg_temp.as_user(null);
select pg_temp.check('la página pública muestra su nombre, puesto y descripción',
  (select r::text like '%Luis%' and r::text like '%Fades%' and r::text like '%Diez años de oficio%'
   from (select public.get_public_tenant('test-lp-k') as r) x));

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
    raise exception 'location_photos: % de % pruebas FALLARON', _fail, _total;
  end if;
  raise notice 'location_photos: % de % pruebas PASARON', _total, _total;
end $$;

rollback;
