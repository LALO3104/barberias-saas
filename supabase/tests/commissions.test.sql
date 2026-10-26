-- =============================================================================
-- Pruebas — Step 13 comisiones (migración 20261026150000)
-- -----------------------------------------------------------------------------
-- SOLO para una base LOCAL o desechable con todas las migraciones aplicadas.
-- Nunca contra producción. Una transacción que termina en ROLLBACK.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/commissions.test.sql
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
  ('a6000000-0000-0000-0000-000000000001', 'co-admin-k@test'),
  ('a6000000-0000-0000-0000-000000000002', 'co-barbero-k1@test'),
  ('a6000000-0000-0000-0000-000000000003', 'co-barbero-k2@test'),
  ('a6000000-0000-0000-0000-000000000004', 'co-admin-o@test');

insert into public.tenants (id, slug, name, plan_code, timezone) values
  ('16000000-0000-0000-0000-00000000000a', 'test-co-k', 'CO Kings', 'barbershop', 'America/Mexico_City'),
  ('16000000-0000-0000-0000-00000000000b', 'test-co-o', 'CO Otra',  'barbershop', 'America/Mexico_City');

insert into public.tenant_members (tenant_id, user_id, role) values
  ('16000000-0000-0000-0000-00000000000a', 'a6000000-0000-0000-0000-000000000001', 'admin'),
  ('16000000-0000-0000-0000-00000000000a', 'a6000000-0000-0000-0000-000000000002', 'barber'),
  ('16000000-0000-0000-0000-00000000000a', 'a6000000-0000-0000-0000-000000000003', 'barber'),
  ('16000000-0000-0000-0000-00000000000b', 'a6000000-0000-0000-0000-000000000004', 'admin');

-- K1 comisión · K2 salario · K3 sin configurar
insert into public.barbers (id, tenant_id, user_id, display_name, is_active) values
  ('b6000000-0000-0000-0000-000000000001', '16000000-0000-0000-0000-00000000000a', 'a6000000-0000-0000-0000-000000000002', 'K1', true),
  ('b6000000-0000-0000-0000-000000000002', '16000000-0000-0000-0000-00000000000a', 'a6000000-0000-0000-0000-000000000003', 'K2', true),
  ('b6000000-0000-0000-0000-000000000003', '16000000-0000-0000-0000-00000000000a', null, 'K3', true);

insert into public.services (id, tenant_id, name, price_cents, duration_minutes) values
  ('56000000-0000-0000-0000-000000000001', '16000000-0000-0000-0000-00000000000a', 'Corte', 25000, 30),
  ('56000000-0000-0000-0000-000000000002', '16000000-0000-0000-0000-00000000000a', 'Barba', 15000, 20);

insert into public.clients (id, tenant_id, full_name, phone) values
  ('c6000000-0000-0000-0000-000000000001', '16000000-0000-0000-0000-00000000000a', 'Ana', '+525560000001');

-- Citas confirmadas de mañana: A,B,C de K1 · D de K2 · E de K3
insert into public.appointments (id, tenant_id, barber_id, client_id, start_at, end_at, status, source) values
  ('d6000000-0000-0000-0000-00000000000a', '16000000-0000-0000-0000-00000000000a', 'b6000000-0000-0000-0000-000000000001', 'c6000000-0000-0000-0000-000000000001', pg_temp.at('09:00'), pg_temp.at('09:50'), 'confirmed', 'online'),
  ('d6000000-0000-0000-0000-00000000000b', '16000000-0000-0000-0000-00000000000a', 'b6000000-0000-0000-0000-000000000001', 'c6000000-0000-0000-0000-000000000001', pg_temp.at('10:00'), pg_temp.at('10:30'), 'confirmed', 'online'),
  ('d6000000-0000-0000-0000-00000000000c', '16000000-0000-0000-0000-00000000000a', 'b6000000-0000-0000-0000-000000000001', 'c6000000-0000-0000-0000-000000000001', pg_temp.at('11:00'), pg_temp.at('11:30'), 'confirmed', 'online'),
  ('d6000000-0000-0000-0000-00000000000d', '16000000-0000-0000-0000-00000000000a', 'b6000000-0000-0000-0000-000000000002', 'c6000000-0000-0000-0000-000000000001', pg_temp.at('12:00'), pg_temp.at('12:30'), 'confirmed', 'online'),
  ('d6000000-0000-0000-0000-00000000000e', '16000000-0000-0000-0000-00000000000a', 'b6000000-0000-0000-0000-000000000003', 'c6000000-0000-0000-0000-000000000001', pg_temp.at('13:00'), pg_temp.at('13:30'), 'confirmed', 'online');

insert into public.appointment_services (tenant_id, appointment_id, service_id, service_name, price_cents, duration_minutes, position)
select '16000000-0000-0000-0000-00000000000a', a, '56000000-0000-0000-0000-000000000001', 'Corte', 25000, 30, 0
from unnest(array['d6000000-0000-0000-0000-00000000000a','d6000000-0000-0000-0000-00000000000b','d6000000-0000-0000-0000-00000000000c',
                  'd6000000-0000-0000-0000-00000000000d','d6000000-0000-0000-0000-00000000000e']::uuid[]) a;
insert into public.appointment_services (tenant_id, appointment_id, service_id, service_name, price_cents, duration_minutes, position)
values ('16000000-0000-0000-0000-00000000000a', 'd6000000-0000-0000-0000-00000000000a', '56000000-0000-0000-0000-000000000002', 'Barba', 15000, 20, 1);

-- =============================================================================
-- 1. Compensación: comisión o salario
-- =============================================================================
select pg_temp.as_user('a6000000-0000-0000-0000-000000000001');  -- admin K
select pg_temp.expect_ok('admin: K1 a comisión 40%', $q$
  insert into public.barber_compensation (barber_id, tenant_id, pay_type, commission_rate_bps)
  values ('b6000000-0000-0000-0000-000000000001', '16000000-0000-0000-0000-00000000000a', 'commission', 4000)
$q$);
select pg_temp.expect_ok('admin: K2 a salario $3,000 semanal', $q$
  insert into public.barber_compensation (barber_id, tenant_id, pay_type, salary_cents, salary_period)
  values ('b6000000-0000-0000-0000-000000000002', '16000000-0000-0000-0000-00000000000a', 'salary', 300000, 'weekly')
$q$);
select pg_temp.expect_error('comisión sin tasa → 23514', $q$
  insert into public.barber_compensation (barber_id, tenant_id, pay_type)
  values ('b6000000-0000-0000-0000-000000000003', '16000000-0000-0000-0000-00000000000a', 'commission')
$q$, '23514');
select pg_temp.expect_error('salario con tasa → 23514', $q$
  insert into public.barber_compensation (barber_id, tenant_id, pay_type, commission_rate_bps, salary_cents, salary_period)
  values ('b6000000-0000-0000-0000-000000000003', '16000000-0000-0000-0000-00000000000a', 'salary', 4000, 300000, 'weekly')
$q$, '23514');
select pg_temp.expect_error('salario sin periodo → 23514', $q$
  insert into public.barber_compensation (barber_id, tenant_id, pay_type, salary_cents)
  values ('b6000000-0000-0000-0000-000000000003', '16000000-0000-0000-0000-00000000000a', 'salary', 300000)
$q$, '23514');
select pg_temp.expect_error('periodo inválido → 23514', $q$
  insert into public.barber_compensation (barber_id, tenant_id, pay_type, salary_cents, salary_period)
  values ('b6000000-0000-0000-0000-000000000003', '16000000-0000-0000-0000-00000000000a', 'salary', 300000, 'daily')
$q$, '23514');
select pg_temp.expect_error('tasa mayor a 100% → 23514', $q$
  insert into public.barber_compensation (barber_id, tenant_id, pay_type, commission_rate_bps)
  values ('b6000000-0000-0000-0000-000000000003', '16000000-0000-0000-0000-00000000000a', 'commission', 10001)
$q$, '23514');

select pg_temp.as_user('a6000000-0000-0000-0000-000000000002');  -- barbero K1
select pg_temp.expect_error('el barbero NO puede cambiar su compensación', $q$
  insert into public.barber_compensation (barber_id, tenant_id, pay_type, commission_rate_bps)
  values ('b6000000-0000-0000-0000-000000000003', '16000000-0000-0000-0000-00000000000a', 'commission', 9000)
$q$, '42501');
select pg_temp.check('el barbero ve solo su compensación',
  (select count(*) from public.barber_compensation) = 1
  and exists (select 1 from public.barber_compensation where barber_id = 'b6000000-0000-0000-0000-000000000001'));

-- =============================================================================
-- 2. Comisión congelada en el cobro
-- =============================================================================
select pg_temp.check('K1 (40%): subtotal 40000 − descuento 5000 = base 35000 → comisión 14000; propina aparte',
  (select r->>'pay_type' = 'commission' and (r->>'commission_cents')::int = 14000 and (r->>'total_cents')::int = 38000
   from (select public.charge_appointment('d6000000-0000-0000-0000-00000000000a',
                '[{"method":"cash","amount_cents":38000}]', 5000, null, 3000) as r) x));
select pg_temp.as_postgres();
select pg_temp.check('...el cobro guarda tipo, tasa y comisión',
  exists (select 1 from public.appointment_charges where appointment_id = 'd6000000-0000-0000-0000-00000000000a'
            and pay_type = 'commission' and commission_rate_bps = 4000 and commission_cents = 14000 and tip_cents = 3000));

-- Redondeo: tasa 33.33% sobre 25000 = 8332.5 → 8333
update public.barber_compensation set commission_rate_bps = 3333 where barber_id = 'b6000000-0000-0000-0000-000000000001';
select pg_temp.as_user('a6000000-0000-0000-0000-000000000002');
select pg_temp.check('redondeo al centavo: 33.33% de 25000 → 8333',
  (select (r->>'commission_cents')::int = 8333
   from (select public.charge_appointment('d6000000-0000-0000-0000-00000000000b', '[{"method":"card","amount_cents":25000}]') as r) x));
select pg_temp.as_postgres();
select pg_temp.check('cambiar la tasa NO altera cobros anteriores (A sigue en 4000 / 14000)',
  exists (select 1 from public.appointment_charges where appointment_id = 'd6000000-0000-0000-0000-00000000000a'
            and commission_rate_bps = 4000 and commission_cents = 14000));

select pg_temp.as_user('a6000000-0000-0000-0000-000000000001');  -- admin K
select pg_temp.check('K2 (salario): pay_type salary, sin comisión',
  (select r->>'pay_type' = 'salary' and r->'commission_cents' = 'null'::jsonb
   from (select public.charge_appointment('d6000000-0000-0000-0000-00000000000d',
                '[{"method":"cash","amount_cents":27000}]', 0, null, 2000) as r) x));
select pg_temp.check('K3 (sin configurar): pay_type NULL, sin comisión',
  (select r->'pay_type' = 'null'::jsonb and r->'commission_cents' = 'null'::jsonb
   from (select public.charge_appointment('d6000000-0000-0000-0000-00000000000e', '[{"method":"cash","amount_cents":25000}]') as r) x));

select pg_temp.as_postgres();
select pg_temp.expect_error('la comisión de un cobro es inmutable (también para postgres)', $q$
  update public.appointment_charges set commission_cents = 0 where appointment_id = 'd6000000-0000-0000-0000-00000000000a'
$q$, '42501');
select pg_temp.expect_error('CHECK: comisión mayor que la base → 23514', $q$
  insert into public.appointment_charges (tenant_id, appointment_id, barber_id, subtotal_cents, total_cents, pay_type, commission_rate_bps, commission_cents)
  values ('16000000-0000-0000-0000-00000000000a', 'd6000000-0000-0000-0000-00000000000c', 'b6000000-0000-0000-0000-000000000001', 1000, 1000, 'commission', 4000, 2000)
$q$, '23514');

-- =============================================================================
-- 3. Pagos a barberos
-- =============================================================================
select pg_temp.check('pagos: RLS activa; authenticated solo SELECT',
  (select relrowsecurity from pg_class where oid = 'public.barber_payouts'::regclass)
  and has_table_privilege('authenticated', 'public.barber_payouts', 'SELECT')
  and not has_table_privilege('authenticated', 'public.barber_payouts', 'INSERT')
  and not has_function_privilege('anon', 'public.record_barber_payout(uuid, date, date, integer, text)', 'EXECUTE'));

select pg_temp.as_user('a6000000-0000-0000-0000-000000000002');  -- barbero K1
select pg_temp.expect_error('el barbero NO puede registrar pagos', $q$
  select public.record_barber_payout('b6000000-0000-0000-0000-000000000001', pg_temp.today(), pg_temp.today())
$q$, 'P0002');

select pg_temp.as_user('a6000000-0000-0000-0000-000000000001');  -- admin K
select pg_temp.check('pagar a K1 hoy: comisión 14000 + 8333 y propinas 3000',
  (select (r->>'commission_cents')::int = 22333 and (r->>'tips_cents')::int = 3000
          and (r->>'total_cents')::int = 25333 and (r->>'charges')::int = 2
   from (select public.record_barber_payout('b6000000-0000-0000-0000-000000000001', pg_temp.today(), pg_temp.today()) as r) x));
select pg_temp.expect_error('pagar otra vez el mismo día → BA011', $q$
  select public.record_barber_payout('b6000000-0000-0000-0000-000000000001', pg_temp.today() - 3, pg_temp.today())
$q$, 'BA011');
select pg_temp.check('K2 (salario): propinas 2000 + salario capturado 300000',
  (select (r->>'commission_cents')::int = 0 and (r->>'tips_cents')::int = 2000 and (r->>'total_cents')::int = 302000
   from (select public.record_barber_payout('b6000000-0000-0000-0000-000000000002', pg_temp.today() - 6, pg_temp.today(), 300000, 'Semana') as r) x));
select pg_temp.expect_error('nada que pagar (K3 sin comisión ni propinas, sin salario) → 23514', $q$
  select public.record_barber_payout('b6000000-0000-0000-0000-000000000003', pg_temp.today(), pg_temp.today())
$q$, '23514');
select pg_temp.expect_error('periodo con días futuros → 23514', $q$
  select public.record_barber_payout('b6000000-0000-0000-0000-000000000003', pg_temp.today(), pg_temp.today() + 1, 1000)
$q$, '23514');
select pg_temp.expect_error('periodo invertido → 23514', $q$
  select public.record_barber_payout('b6000000-0000-0000-0000-000000000003', pg_temp.today(), pg_temp.today() - 1, 1000)
$q$, '23514');

select pg_temp.as_user('a6000000-0000-0000-0000-000000000004');  -- admin O
select pg_temp.expect_error('admin de otra barbería → P0002', $q$
  select public.record_barber_payout('b6000000-0000-0000-0000-000000000003', pg_temp.today(), pg_temp.today(), 1000)
$q$, 'P0002');
select pg_temp.check('admin de otra barbería no ve los pagos de K',
  not exists (select 1 from public.barber_payouts where tenant_id = '16000000-0000-0000-0000-00000000000a'));

select pg_temp.as_user('a6000000-0000-0000-0000-000000000003');  -- barbero K2
select pg_temp.check('K2 ve solo su pago',
  (select count(*) from public.barber_payouts) = 1
  and exists (select 1 from public.barber_payouts where barber_id = 'b6000000-0000-0000-0000-000000000002'));

-- Anular y volver a pagar (excluye cobros anulados)
select pg_temp.as_user('a6000000-0000-0000-0000-000000000001');  -- admin K
select pg_temp.expect_ok('anular el pago de K1', $q$
  select public.void_barber_payout((select id from public.barber_payouts where barber_id = 'b6000000-0000-0000-0000-000000000001'), 'Se calculó mal')
$q$);
select pg_temp.expect_error('anularlo dos veces → BA009', $q$
  select public.void_barber_payout((select id from public.barber_payouts where barber_id = 'b6000000-0000-0000-0000-000000000001'), 'otra')
$q$, 'BA009');
select pg_temp.expect_ok('anular el cobro de B (8333)', $q$
  select public.void_charge((select id from public.appointment_charges where appointment_id = 'd6000000-0000-0000-0000-00000000000b'), 'error')
$q$);
select pg_temp.check('volver a pagar a K1: solo cuenta el cobro activo (14000 + 3000)',
  (select (r->>'total_cents')::int = 17000
   from (select public.record_barber_payout('b6000000-0000-0000-0000-000000000001', pg_temp.today(), pg_temp.today()) as r) x));

select pg_temp.as_postgres();
select pg_temp.expect_error('postgres no puede cambiar montos de un pago', $q$
  update public.barber_payouts set total_cents = 1, commission_cents = 1, tips_cents = 0, salary_cents = 0
$q$, '42501');
select pg_temp.expect_error('postgres no puede borrar un pago', $q$
  delete from public.barber_payouts
$q$, '42501');

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
    raise exception 'commissions: % de % pruebas FALLARON', _fail, _total;
  end if;
  raise notice 'commissions: % de % pruebas PASARON', _total, _total;
end $$;

rollback;
