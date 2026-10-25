-- =============================================================================
-- Pruebas — Step 12 cobro manual (migración 20261026090000)
-- -----------------------------------------------------------------------------
-- SOLO para una base LOCAL o desechable con todas las migraciones aplicadas.
-- Nunca contra producción. Una transacción que termina en ROLLBACK.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/charges.test.sql
--
-- El trigger appointments_require_charge es DIFERIDO: se fuerza con
-- SET CONSTRAINTS … IMMEDIATE (pg_temp.expect_deferred_error).
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

-- Ejecuta _sql y fuerza el trigger diferido; se espera el error _code. Todo se
-- revierte (bloque con excepción).
create function pg_temp.expect_deferred_error(_label text, _sql text, _code text) returns void language plpgsql as $$
begin
  begin
    execute _sql;
    set constraints public.appointments_require_charge immediate;
    set constraints public.appointments_require_charge deferred;
    perform pg_temp.check(_label, false, 'no falló (se esperaba ' || _code || ')');
    raise exception 'revertir' using errcode = 'P0001';
  exception when others then
    if sqlstate = 'P0001' then return; end if;
    perform pg_temp.check(_label, sqlstate = _code,
      case when sqlstate = _code then sqlstate else 'falló con ' || sqlstate || ' "' || sqlerrm || '", se esperaba ' || _code end);
  end;
end $$;

create function pg_temp.at(_hhmm text, _days int default 1) returns timestamptz language sql stable as $$
  select (((now() at time zone 'America/Mexico_City')::date + _days) + _hhmm::time) at time zone 'America/Mexico_City'
$$;

create function pg_temp.charge(_appt uuid, _payments jsonb, _discount int default 0, _reason text default null, _tip int default 0)
returns jsonb language sql as $$
  select public.charge_appointment(_appt, _payments, _discount, _reason, _tip)
$$;

grant execute on function pg_temp.at(text, int) to public;
grant execute on function pg_temp.charge(uuid, jsonb, int, text, int) to public;

-- ─── Datos de prueba (como postgres) ─────────────────────────────────────────
insert into auth.users (id, email) values
  ('a5000000-0000-0000-0000-000000000001', 'ch-admin-k@test'),
  ('a5000000-0000-0000-0000-000000000002', 'ch-barbero-k1@test'),
  ('a5000000-0000-0000-0000-000000000003', 'ch-barbero-k2@test'),
  ('a5000000-0000-0000-0000-000000000004', 'ch-admin-o@test');

insert into public.tenants (id, slug, name, plan_code, timezone) values
  ('15000000-0000-0000-0000-00000000000a', 'test-ch-k', 'CH Kings', 'barbershop', 'America/Mexico_City'),
  ('15000000-0000-0000-0000-00000000000b', 'test-ch-o', 'CH Otra',  'barbershop', 'America/Mexico_City');

insert into public.tenant_members (tenant_id, user_id, role) values
  ('15000000-0000-0000-0000-00000000000a', 'a5000000-0000-0000-0000-000000000001', 'admin'),
  ('15000000-0000-0000-0000-00000000000a', 'a5000000-0000-0000-0000-000000000002', 'barber'),
  ('15000000-0000-0000-0000-00000000000a', 'a5000000-0000-0000-0000-000000000003', 'barber'),
  ('15000000-0000-0000-0000-00000000000b', 'a5000000-0000-0000-0000-000000000004', 'admin');

insert into public.barbers (id, tenant_id, user_id, display_name, is_active) values
  ('b5000000-0000-0000-0000-000000000001', '15000000-0000-0000-0000-00000000000a', 'a5000000-0000-0000-0000-000000000002', 'K1', true),
  ('b5000000-0000-0000-0000-000000000002', '15000000-0000-0000-0000-00000000000a', 'a5000000-0000-0000-0000-000000000003', 'K2', true);

insert into public.services (id, tenant_id, name, price_cents, duration_minutes) values
  ('55000000-0000-0000-0000-000000000001', '15000000-0000-0000-0000-00000000000a', 'Corte', 25000, 30),
  ('55000000-0000-0000-0000-000000000002', '15000000-0000-0000-0000-00000000000a', 'Barba', 15000, 20);

insert into public.clients (id, tenant_id, full_name, phone) values
  ('c5000000-0000-0000-0000-000000000001', '15000000-0000-0000-0000-00000000000a', 'Ana', '+525550000001');

-- Citas de mañana (K1 salvo E): A..D confirmadas, P pendiente, X cancelada, E de K2.
insert into public.appointments (id, tenant_id, barber_id, client_id, start_at, end_at, status, source) values
  ('d5000000-0000-0000-0000-00000000000a', '15000000-0000-0000-0000-00000000000a', 'b5000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', pg_temp.at('09:00'), pg_temp.at('09:50'), 'confirmed', 'online'),
  ('d5000000-0000-0000-0000-00000000000b', '15000000-0000-0000-0000-00000000000a', 'b5000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', pg_temp.at('10:00'), pg_temp.at('10:30'), 'confirmed', 'online'),
  ('d5000000-0000-0000-0000-00000000000c', '15000000-0000-0000-0000-00000000000a', 'b5000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', pg_temp.at('11:00'), pg_temp.at('11:30'), 'confirmed', 'online'),
  ('d5000000-0000-0000-0000-00000000000d', '15000000-0000-0000-0000-00000000000a', 'b5000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', pg_temp.at('12:00'), pg_temp.at('12:30'), 'confirmed', 'online'),
  ('d5000000-0000-0000-0000-0000000000a1', '15000000-0000-0000-0000-00000000000a', 'b5000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', pg_temp.at('13:00'), pg_temp.at('13:30'), 'pending',   'online'),
  ('d5000000-0000-0000-0000-0000000000a2', '15000000-0000-0000-0000-00000000000a', 'b5000000-0000-0000-0000-000000000001', 'c5000000-0000-0000-0000-000000000001', pg_temp.at('14:00'), pg_temp.at('14:30'), 'confirmed', 'online'),
  ('d5000000-0000-0000-0000-0000000000e1', '15000000-0000-0000-0000-00000000000a', 'b5000000-0000-0000-0000-000000000002', 'c5000000-0000-0000-0000-000000000001', pg_temp.at('15:00'), pg_temp.at('15:30'), 'confirmed', 'online');

insert into public.appointment_services (tenant_id, appointment_id, service_id, service_name, price_cents, duration_minutes, position)
select '15000000-0000-0000-0000-00000000000a', a, '55000000-0000-0000-0000-000000000001', 'Corte', 25000, 30, 0
from unnest(array['d5000000-0000-0000-0000-00000000000a','d5000000-0000-0000-0000-00000000000b','d5000000-0000-0000-0000-00000000000c',
                  'd5000000-0000-0000-0000-00000000000d','d5000000-0000-0000-0000-0000000000a1','d5000000-0000-0000-0000-0000000000a2',
                  'd5000000-0000-0000-0000-0000000000e1']::uuid[]) a;
-- A además lleva Barba: subtotal 40000.
insert into public.appointment_services (tenant_id, appointment_id, service_id, service_name, price_cents, duration_minutes, position)
values ('15000000-0000-0000-0000-00000000000a', 'd5000000-0000-0000-0000-00000000000a', '55000000-0000-0000-0000-000000000002', 'Barba', 15000, 20, 1);

-- X: cancelada.
update public.appointments set status = 'cancelled', cancellation_reason = 'prueba' where id = 'd5000000-0000-0000-0000-0000000000a2';

-- =============================================================================
-- 1. Esquema y privilegios
-- =============================================================================
select pg_temp.check('charge_appointment y void_charge: SECURITY DEFINER',
  (select bool_and(prosecdef) from pg_proc where proname in ('charge_appointment', 'void_charge')));
select pg_temp.check('anon NO puede ejecutar charge_appointment ni void_charge',
  not has_function_privilege('anon', 'public.charge_appointment(uuid, jsonb, integer, text, integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.void_charge(uuid, text)', 'EXECUTE'));
select pg_temp.check('cobros y pagos: RLS activa; authenticated solo SELECT; anon nada',
  (select bool_and(relrowsecurity) from pg_class where oid in ('public.appointment_charges'::regclass, 'public.charge_payments'::regclass))
  and has_table_privilege('authenticated', 'public.appointment_charges', 'SELECT')
  and not has_table_privilege('authenticated', 'public.appointment_charges', 'INSERT')
  and not has_table_privilege('authenticated', 'public.appointment_charges', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.charge_payments', 'INSERT')
  and not has_table_privilege('anon', 'public.appointment_charges', 'SELECT'));
select pg_temp.check('trigger appointments_require_charge es diferido',
  (select tgdeferrable and tginitdeferred from pg_trigger where tgname = 'appointments_require_charge'));

-- =============================================================================
-- 2. Completar y cobrar
-- =============================================================================
select pg_temp.as_user('a5000000-0000-0000-0000-000000000002');  -- barbero K1
select pg_temp.check('K1 completa y cobra A (40000) con pago mixto efectivo + tarjeta',
  (select (r->>'completed')::boolean and (r->>'subtotal_cents')::int = 40000 and (r->>'total_cents')::int = 40000
          and jsonb_array_length(r->'payments') = 2
   from (select pg_temp.charge('d5000000-0000-0000-0000-00000000000a',
                '[{"method":"cash","amount_cents":25000},{"method":"card","amount_cents":15000}]') as r) x));
select pg_temp.as_postgres();
select pg_temp.check('...A quedó completed con completed_at, y un cobro activo con barber_id y created_by',
  exists (select 1 from public.appointments where id = 'd5000000-0000-0000-0000-00000000000a' and status = 'completed' and completed_at is not null)
  and exists (select 1 from public.appointment_charges where appointment_id = 'd5000000-0000-0000-0000-00000000000a'
                and voided_at is null and barber_id = 'b5000000-0000-0000-0000-000000000001'
                and created_by = 'a5000000-0000-0000-0000-000000000002'));
select pg_temp.check('...pagos guardados por método',
  (select string_agg(method || ':' || amount_cents, ',' order by method) from public.charge_payments cp
     join public.appointment_charges c on c.id = cp.charge_id
    where c.appointment_id = 'd5000000-0000-0000-0000-00000000000a') = 'cash:25000,card:15000');

select pg_temp.as_user('a5000000-0000-0000-0000-000000000001');  -- admin K
select pg_temp.check('descuento 5000 con motivo + propina 3000: total 23000',
  (select (r->>'total_cents')::int = 23000
   from (select pg_temp.charge('d5000000-0000-0000-0000-00000000000b', '[{"method":"transfer","amount_cents":23000}]',
                5000, '  Cliente frecuente  ', 3000) as r) x));
select pg_temp.as_postgres();
select pg_temp.check('...descuento, motivo recortado y propina guardados',
  exists (select 1 from public.appointment_charges where appointment_id = 'd5000000-0000-0000-0000-00000000000b'
            and subtotal_cents = 25000 and discount_cents = 5000 and discount_reason = 'Cliente frecuente'
            and tip_cents = 3000 and total_cents = 23000));

select pg_temp.as_user('a5000000-0000-0000-0000-000000000001');
select pg_temp.check('cortesía: descuento total y sin pagos (total 0)',
  (select (r->>'total_cents')::int = 0 and jsonb_array_length(r->'payments') = 0
   from (select pg_temp.charge('d5000000-0000-0000-0000-00000000000c', '[]', 25000, 'Cortesía') as r) x));

-- =============================================================================
-- 3. Validaciones de montos y pagos (cita D)
-- =============================================================================
select pg_temp.expect_error('pagos que no suman el total → 23514', $q$
  select pg_temp.charge('d5000000-0000-0000-0000-00000000000d', '[{"method":"cash","amount_cents":20000}]')
$q$, '23514');
select pg_temp.expect_error('método repetido → 23514', $q$
  select pg_temp.charge('d5000000-0000-0000-0000-00000000000d', '[{"method":"cash","amount_cents":10000},{"method":"cash","amount_cents":15000}]')
$q$, '23514');
select pg_temp.expect_error('método inválido → 23514', $q$
  select pg_temp.charge('d5000000-0000-0000-0000-00000000000d', '[{"method":"bitcoin","amount_cents":25000}]')
$q$, '23514');
select pg_temp.expect_error('monto 0 → 23514', $q$
  select pg_temp.charge('d5000000-0000-0000-0000-00000000000d', '[{"method":"cash","amount_cents":0},{"method":"card","amount_cents":25000}]')
$q$, '23514');
select pg_temp.expect_error('monto con texto → 23514 (no error de conversión)', $q$
  select pg_temp.charge('d5000000-0000-0000-0000-00000000000d', '[{"method":"cash","amount_cents":"abc"}]')
$q$, '23514');
select pg_temp.expect_error('monto con decimales → 23514', $q$
  select pg_temp.charge('d5000000-0000-0000-0000-00000000000d', '[{"method":"cash","amount_cents":250.5}]')
$q$, '23514');
select pg_temp.expect_error('pagos no es arreglo → 23514', $q$
  select pg_temp.charge('d5000000-0000-0000-0000-00000000000d', '{"method":"cash","amount_cents":25000}')
$q$, '23514');
select pg_temp.expect_error('descuento mayor al subtotal → 23514', $q$
  select pg_temp.charge('d5000000-0000-0000-0000-00000000000d', '[]', 30000)
$q$, '23514');
select pg_temp.expect_error('descuento negativo → 23514', $q$
  select pg_temp.charge('d5000000-0000-0000-0000-00000000000d', '[{"method":"cash","amount_cents":26000}]', -1000)
$q$, '23514');
select pg_temp.expect_error('propina negativa → 23514', $q$
  select pg_temp.charge('d5000000-0000-0000-0000-00000000000d', '[{"method":"cash","amount_cents":24000}]', 0, null, -1000)
$q$, '23514');
select pg_temp.as_postgres();
select pg_temp.check('...tras los errores D sigue confirmada y sin cobro',
  exists (select 1 from public.appointments where id = 'd5000000-0000-0000-0000-00000000000d' and status = 'confirmed')
  and not exists (select 1 from public.appointment_charges where appointment_id = 'd5000000-0000-0000-0000-00000000000d'));

-- =============================================================================
-- 4. Estados y permisos
-- =============================================================================
select pg_temp.as_user('a5000000-0000-0000-0000-000000000001');
select pg_temp.expect_error('cita pendiente → BA009', $q$
  select pg_temp.charge('d5000000-0000-0000-0000-0000000000a1', '[{"method":"cash","amount_cents":25000}]')
$q$, 'BA009');
select pg_temp.expect_error('cita cancelada → BA009', $q$
  select pg_temp.charge('d5000000-0000-0000-0000-0000000000a2', '[{"method":"cash","amount_cents":25000}]')
$q$, 'BA009');
select pg_temp.expect_error('cita ya cobrada → BA009', $q$
  select pg_temp.charge('d5000000-0000-0000-0000-00000000000a', '[{"method":"cash","amount_cents":40000}]')
$q$, 'BA009');

select pg_temp.as_user('a5000000-0000-0000-0000-000000000002');  -- barbero K1
select pg_temp.expect_error('K1 NO puede cobrar una cita de K2', $q$
  select pg_temp.charge('d5000000-0000-0000-0000-0000000000e1', '[{"method":"cash","amount_cents":25000}]')
$q$, 'P0002');
select pg_temp.as_user('a5000000-0000-0000-0000-000000000004');  -- admin O
select pg_temp.expect_error('admin de otra barbería → P0002', $q$
  select pg_temp.charge('d5000000-0000-0000-0000-0000000000e1', '[{"method":"cash","amount_cents":25000}]')
$q$, 'P0002');
select pg_temp.check('admin de otra barbería no ve cobros de K',
  not exists (select 1 from public.appointment_charges where tenant_id = '15000000-0000-0000-0000-00000000000a'));
select pg_temp.as_user('a5000000-0000-0000-0000-000000000003');  -- barbero K2
select pg_temp.check('K2 no ve los cobros de K1',
  not exists (select 1 from public.appointment_charges where barber_id = 'b5000000-0000-0000-0000-000000000001'));
select pg_temp.as_user('a5000000-0000-0000-0000-000000000002');  -- barbero K1
select pg_temp.check('K1 ve sus cobros y sus pagos',
  (select count(*) from public.appointment_charges where barber_id = 'b5000000-0000-0000-0000-000000000001') = 3
  and (select count(*) from public.charge_payments) = 3);
select pg_temp.expect_error('authenticated no puede insertar cobros', $q$
  insert into public.appointment_charges (tenant_id, appointment_id, barber_id, subtotal_cents, total_cents)
  values ('15000000-0000-0000-0000-00000000000a', 'd5000000-0000-0000-0000-00000000000d', 'b5000000-0000-0000-0000-000000000001', 1, 1)
$q$, '42501');

-- =============================================================================
-- 5. Anular y cobrar de nuevo
-- =============================================================================
select pg_temp.expect_error('el barbero NO puede anular (P0002)', $q$
  select public.void_charge((select id from public.appointment_charges where appointment_id = 'd5000000-0000-0000-0000-00000000000a'), 'error')
$q$, 'P0002');
select pg_temp.as_user('a5000000-0000-0000-0000-000000000001');  -- admin K
select pg_temp.expect_error('anular sin motivo → 23514', $q$
  select public.void_charge((select id from public.appointment_charges where appointment_id = 'd5000000-0000-0000-0000-00000000000a'), '   ')
$q$, '23514');
select pg_temp.expect_ok('admin anula el cobro de A con motivo', $q$
  select public.void_charge((select id from public.appointment_charges where appointment_id = 'd5000000-0000-0000-0000-00000000000a'), 'Se cobró mal')
$q$);
select pg_temp.as_postgres();
select pg_temp.check('...anulación con marca del servidor; A sigue completada',
  exists (select 1 from public.appointment_charges where appointment_id = 'd5000000-0000-0000-0000-00000000000a'
            and voided_at is not null and voided_by = 'a5000000-0000-0000-0000-000000000001' and void_reason = 'Se cobró mal')
  and exists (select 1 from public.appointments where id = 'd5000000-0000-0000-0000-00000000000a' and status = 'completed'));
select pg_temp.as_user('a5000000-0000-0000-0000-000000000001');
select pg_temp.expect_error('anular dos veces → BA009', $q$
  select public.void_charge((select id from public.appointment_charges where appointment_id = 'd5000000-0000-0000-0000-00000000000a'), 'otra vez')
$q$, 'BA009');
select pg_temp.check('cobrar de nuevo la cita completada (completed = false en la respuesta)',
  (select not (r->>'completed')::boolean and (r->>'total_cents')::int = 40000
   from (select pg_temp.charge('d5000000-0000-0000-0000-00000000000a', '[{"method":"cash","amount_cents":40000}]') as r) x));
select pg_temp.as_postgres();
select pg_temp.check('...A: 2 cobros, 1 activo',
  (select count(*) from public.appointment_charges where appointment_id = 'd5000000-0000-0000-0000-00000000000a') = 2
  and (select count(*) from public.appointment_charges where appointment_id = 'd5000000-0000-0000-0000-00000000000a' and voided_at is null) = 1);

-- =============================================================================
-- 6. Inmutabilidad
-- =============================================================================
select pg_temp.expect_error('postgres no puede cambiar el total de un cobro', $q$
  update public.appointment_charges set total_cents = 1, subtotal_cents = 1 where appointment_id = 'd5000000-0000-0000-0000-00000000000b'
$q$, '42501');
select pg_temp.expect_error('postgres no puede borrar un cobro', $q$
  delete from public.appointment_charges where appointment_id = 'd5000000-0000-0000-0000-00000000000b'
$q$, '42501');
select pg_temp.expect_error('postgres no puede modificar un pago', $q$
  update public.charge_payments set amount_cents = 1
$q$, '42501');
select pg_temp.expect_error('postgres no puede borrar un pago', $q$
  delete from public.charge_payments
$q$, '42501');
select pg_temp.expect_error('postgres no puede "des-anular" un cobro', $q$
  update public.appointment_charges set voided_at = null, voided_by = null, void_reason = null
  where appointment_id = 'd5000000-0000-0000-0000-00000000000a' and voided_at is not null
$q$, 'BA009');

-- =============================================================================
-- 7. Ninguna cita completada sin cobro (trigger diferido)
-- =============================================================================
select pg_temp.expect_deferred_error('UPDATE directo a completed sin cobro → BA010 al confirmar', $q$
  update public.appointments set status = 'completed' where id = 'd5000000-0000-0000-0000-00000000000d'
$q$, 'BA010');
select pg_temp.as_user('a5000000-0000-0000-0000-000000000001');
select pg_temp.expect_deferred_error('set_appointment_status → completed sin cobro → BA010 al confirmar', $q$
  select public.set_appointment_status('d5000000-0000-0000-0000-00000000000d', 'completed')
$q$, 'BA010');
select pg_temp.as_postgres();
select pg_temp.check('...D sigue confirmada',
  exists (select 1 from public.appointments where id = 'd5000000-0000-0000-0000-00000000000d' and status = 'confirmed'));
select pg_temp.as_user('a5000000-0000-0000-0000-000000000001');
select pg_temp.expect_ok('con charge_appointment el trigger diferido pasa (forzado ahora)', $q$
  select pg_temp.charge('d5000000-0000-0000-0000-00000000000d', '[{"method":"cash","amount_cents":25000}]')
$q$);
select pg_temp.as_postgres();
set constraints public.appointments_require_charge immediate;
select pg_temp.check('...todas las citas completadas de esta prueba tienen cobro activo',
  not exists (
    select 1 from public.appointments a
    where a.tenant_id = '15000000-0000-0000-0000-00000000000a' and a.status = 'completed'
      and not exists (select 1 from public.appointment_charges c where c.appointment_id = a.id and c.voided_at is null)));

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
    raise exception 'charges: % de % pruebas FALLARON', _fail, _total;
  end if;
  raise notice 'charges: % de % pruebas PASARON', _total, _total;
end $$;

rollback;
