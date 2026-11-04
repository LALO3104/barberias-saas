-- =============================================================================
-- Pruebas — Step 14 WhatsApp: número y plantillas (migración 20261027090000)
-- -----------------------------------------------------------------------------
-- SOLO para una base LOCAL o desechable con todas las migraciones aplicadas.
-- Nunca contra producción. Una transacción que termina en ROLLBACK.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/whatsapp_settings.test.sql
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
  ('a7000000-0000-0000-0000-000000000001', 'wa-admin-k@test'),
  ('a7000000-0000-0000-0000-000000000002', 'wa-barbero-k@test'),
  ('a7000000-0000-0000-0000-000000000003', 'wa-admin-o@test');

insert into public.tenants (id, slug, name, plan_code, timezone) values
  ('17000000-0000-0000-0000-00000000000a', 'test-wa-k', 'WA Kings', 'barbershop', 'America/Mexico_City'),
  ('17000000-0000-0000-0000-00000000000b', 'test-wa-o', 'WA Otra',  'barbershop', 'America/Mexico_City');

insert into public.tenant_members (tenant_id, user_id, role) values
  ('17000000-0000-0000-0000-00000000000a', 'a7000000-0000-0000-0000-000000000001', 'admin'),
  ('17000000-0000-0000-0000-00000000000a', 'a7000000-0000-0000-0000-000000000002', 'barber'),
  ('17000000-0000-0000-0000-00000000000b', 'a7000000-0000-0000-0000-000000000003', 'admin');

-- =============================================================================
-- 1. Esquema por defecto
-- =============================================================================
select pg_temp.check('message_templates nace como {}',
  (select message_templates = '{}'::jsonb from public.tenants where id = '17000000-0000-0000-0000-00000000000a'));

-- =============================================================================
-- 2. Admin: número y plantillas
-- =============================================================================
select pg_temp.as_user('a7000000-0000-0000-0000-000000000001');
select pg_temp.expect_ok('admin: guarda número de 10 dígitos', $q$
  select public.update_tenant_messaging('17000000-0000-0000-0000-00000000000a', '55 1234-5678', null)
$q$);
select pg_temp.check('número normalizado a +525512345678',
  (select public_phone = '+525512345678' from public.tenants where id = '17000000-0000-0000-0000-00000000000a'));

select pg_temp.expect_ok('admin: guarda plantillas (vacías se descartan)', $q$
  select public.update_tenant_messaging('17000000-0000-0000-0000-00000000000a', '+525512345678',
    '{"confirm":"Hola {cliente}, tu cita es el {fecha} a las {hora}","reminder":"   "}'::jsonb)
$q$);
select pg_temp.check('solo queda confirm',
  (select message_templates = '{"confirm":"Hola {cliente}, tu cita es el {fecha} a las {hora}"}'::jsonb
   from public.tenants where id = '17000000-0000-0000-0000-00000000000a'));

select pg_temp.expect_ok('admin: _templates NULL no cambia plantillas', $q$
  select public.update_tenant_messaging('17000000-0000-0000-0000-00000000000a', '5598765432', null)
$q$);
select pg_temp.check('plantillas intactas y número nuevo',
  (select message_templates ? 'confirm' and public_phone = '+525598765432'
   from public.tenants where id = '17000000-0000-0000-0000-00000000000a'));

select pg_temp.expect_ok('admin: número vacío = sin número', $q$
  select public.update_tenant_messaging('17000000-0000-0000-0000-00000000000a', '   ', '{}'::jsonb)
$q$);
select pg_temp.check('sin número y plantillas por defecto',
  (select public_phone is null and message_templates = '{}'::jsonb
   from public.tenants where id = '17000000-0000-0000-0000-00000000000a'));

select pg_temp.expect_error('número inválido → 23514', $q$
  select public.update_tenant_messaging('17000000-0000-0000-0000-00000000000a', '12345', null)
$q$, '23514');
select pg_temp.expect_error('clave desconocida → 23514', $q$
  select public.update_tenant_messaging('17000000-0000-0000-0000-00000000000a', null, '{"hack":"x"}'::jsonb)
$q$, '23514');
select pg_temp.expect_error('valor no texto → 23514', $q$
  select public.update_tenant_messaging('17000000-0000-0000-0000-00000000000a', null, '{"confirm":5}'::jsonb)
$q$, '23514');
select pg_temp.expect_error('texto de más de 1000 → 23514', $q$
  select public.update_tenant_messaging('17000000-0000-0000-0000-00000000000a', null,
    jsonb_build_object('cancel', repeat('a', 1001)))
$q$, '23514');
select pg_temp.expect_error('plantillas no objeto → 23514', $q$
  select public.update_tenant_messaging('17000000-0000-0000-0000-00000000000a', null, '["x"]'::jsonb)
$q$, '23514');

-- Las columnas siguen sin UPDATE directo
select pg_temp.expect_error('admin: UPDATE directo de public_phone → 42501', $q$
  update public.tenants set public_phone = '+525500000000' where id = '17000000-0000-0000-0000-00000000000a'
$q$, '42501');
select pg_temp.expect_error('admin: UPDATE directo de message_templates → 42501', $q$
  update public.tenants set message_templates = '{}' where id = '17000000-0000-0000-0000-00000000000a'
$q$, '42501');
-- El CHECK nuevo no rompe las columnas que el admin ya podía editar
select pg_temp.expect_ok('admin: sigue pudiendo cambiar el nombre', $q$
  update public.tenants set name = 'WA Kings 2' where id = '17000000-0000-0000-0000-00000000000a'
$q$);
select pg_temp.check('nombre cambiado',
  (select name = 'WA Kings 2' from public.tenants where id = '17000000-0000-0000-0000-00000000000a'));

-- =============================================================================
-- 3. Otros usuarios
-- =============================================================================
select pg_temp.expect_error('admin K sobre la otra barbería → 42501', $q$
  select public.update_tenant_messaging('17000000-0000-0000-0000-00000000000b', '5511112222', null)
$q$, '42501');
select pg_temp.expect_error('tenant inexistente → 42501', $q$
  select public.update_tenant_messaging('17000000-0000-0000-0000-0000000000ff', '5511112222', null)
$q$, '42501');

select pg_temp.as_user('a7000000-0000-0000-0000-000000000003');
select pg_temp.expect_error('admin de la otra barbería sobre K → 42501', $q$
  select public.update_tenant_messaging('17000000-0000-0000-0000-00000000000a', '5511112222', null)
$q$, '42501');

select pg_temp.as_user('a7000000-0000-0000-0000-000000000002');
select pg_temp.expect_error('barbero → 42501', $q$
  select public.update_tenant_messaging('17000000-0000-0000-0000-00000000000a', '5511112222', null)
$q$, '42501');
select pg_temp.check('barbero puede leer las plantillas de su barbería',
  (select count(*) = 1 from public.tenants where id = '17000000-0000-0000-0000-00000000000a' and message_templates is not null));
select pg_temp.check('barbero no ve la otra barbería',
  (select count(*) = 0 from public.tenants where id = '17000000-0000-0000-0000-00000000000b'));

select pg_temp.as_user(null);
select pg_temp.expect_error('anon no puede ejecutar la función → 42501', $q$
  select public.update_tenant_messaging('17000000-0000-0000-0000-00000000000a', '5511112222', null)
$q$, '42501');
select pg_temp.check('la página pública no expone plantillas',
  (select not (public.get_public_tenant('test-wa-k') ? 'message_templates')));

select pg_temp.as_postgres();
select pg_temp.check('la otra barbería sigue sin número',
  (select public_phone is null from public.tenants where id = '17000000-0000-0000-0000-00000000000b'));

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
    raise exception 'whatsapp_settings: % de % pruebas FALLARON', _fail, _total;
  end if;
  raise notice 'whatsapp_settings: % de % pruebas PASARON', _total, _total;
end $$;

rollback;
