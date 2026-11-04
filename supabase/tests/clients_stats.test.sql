-- =============================================================================
-- Pruebas — Step 15 clientes y estadísticas (migración 20261104120000)
-- -----------------------------------------------------------------------------
-- SOLO para una base LOCAL o desechable con todas las migraciones aplicadas.
-- Nunca contra producción. Una transacción que termina en ROLLBACK.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/clients_stats.test.sql
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
  ('a8000000-0000-0000-0000-000000000001', 'cs-admin-k@test'),
  ('a8000000-0000-0000-0000-000000000002', 'cs-barbero-1@test'),
  ('a8000000-0000-0000-0000-000000000003', 'cs-barbero-2@test'),
  ('a8000000-0000-0000-0000-000000000004', 'cs-admin-o@test');

insert into public.tenants (id, slug, name, plan_code, timezone) values
  ('18000000-0000-0000-0000-00000000000a', 'test-cs-k', 'CS Kings', 'barbershop', 'America/Mexico_City'),
  ('18000000-0000-0000-0000-00000000000b', 'test-cs-o', 'CS Otra',  'barbershop', 'America/Mexico_City');

insert into public.tenant_members (tenant_id, user_id, role) values
  ('18000000-0000-0000-0000-00000000000a', 'a8000000-0000-0000-0000-000000000001', 'admin'),
  ('18000000-0000-0000-0000-00000000000a', 'a8000000-0000-0000-0000-000000000002', 'barber'),
  ('18000000-0000-0000-0000-00000000000a', 'a8000000-0000-0000-0000-000000000003', 'barber'),
  ('18000000-0000-0000-0000-00000000000b', 'a8000000-0000-0000-0000-000000000004', 'admin');

insert into public.barbers (id, tenant_id, user_id, display_name, is_active) values
  ('b8000000-0000-0000-0000-000000000001', '18000000-0000-0000-0000-00000000000a', 'a8000000-0000-0000-0000-000000000002', 'B1', true),
  ('b8000000-0000-0000-0000-000000000002', '18000000-0000-0000-0000-00000000000a', 'a8000000-0000-0000-0000-000000000003', 'B2', true),
  ('b8000000-0000-0000-0000-000000000009', '18000000-0000-0000-0000-00000000000b', null, 'BO', true);

insert into public.barber_compensation (barber_id, tenant_id, pay_type, commission_rate_bps, salary_cents, salary_period) values
  ('b8000000-0000-0000-0000-000000000001', '18000000-0000-0000-0000-00000000000a', 'commission', 4000, null, null),
  ('b8000000-0000-0000-0000-000000000002', '18000000-0000-0000-0000-00000000000a', 'salary', null, 300000, 'weekly');

insert into public.services (id, tenant_id, name, price_cents, duration_minutes) values
  ('58000000-0000-0000-0000-000000000001', '18000000-0000-0000-0000-00000000000a', 'Corte', 25000, 30),
  ('58000000-0000-0000-0000-000000000009', '18000000-0000-0000-0000-00000000000b', 'Corte O', 20000, 30);

insert into public.clients (id, tenant_id, full_name, phone) values
  ('c8000000-0000-0000-0000-000000000001', '18000000-0000-0000-0000-00000000000a', 'Ana', '+525570000001'),
  ('c8000000-0000-0000-0000-000000000002', '18000000-0000-0000-0000-00000000000a', 'Beto', '+525570000002'),
  ('c8000000-0000-0000-0000-000000000003', '18000000-0000-0000-0000-00000000000a', 'Carla', '+525570000003'),
  ('c8000000-0000-0000-0000-000000000004', '18000000-0000-0000-0000-00000000000a', 'José Ñandú', '+525570000004'),
  ('c8000000-0000-0000-0000-000000000009', '18000000-0000-0000-0000-00000000000b', 'Zoe', '+525570000009');

-- Mañana: B1 → Ana (x2), Carla · B2 → Beto, Carla (pendiente) · O → Zoe
insert into public.appointments (id, tenant_id, barber_id, client_id, start_at, end_at, status, source) values
  ('d8000000-0000-0000-0000-000000000001', '18000000-0000-0000-0000-00000000000a', 'b8000000-0000-0000-0000-000000000001', 'c8000000-0000-0000-0000-000000000001', pg_temp.at('09:00'), pg_temp.at('09:30'), 'confirmed', 'online'),
  ('d8000000-0000-0000-0000-000000000002', '18000000-0000-0000-0000-00000000000a', 'b8000000-0000-0000-0000-000000000001', 'c8000000-0000-0000-0000-000000000003', pg_temp.at('10:00'), pg_temp.at('10:30'), 'confirmed', 'online'),
  ('d8000000-0000-0000-0000-000000000003', '18000000-0000-0000-0000-00000000000a', 'b8000000-0000-0000-0000-000000000002', 'c8000000-0000-0000-0000-000000000002', pg_temp.at('09:00'), pg_temp.at('09:30'), 'confirmed', 'online'),
  ('d8000000-0000-0000-0000-000000000004', '18000000-0000-0000-0000-00000000000a', 'b8000000-0000-0000-0000-000000000002', 'c8000000-0000-0000-0000-000000000003', pg_temp.at('10:00'), pg_temp.at('10:30'), 'pending', 'online'),
  ('d8000000-0000-0000-0000-000000000005', '18000000-0000-0000-0000-00000000000a', 'b8000000-0000-0000-0000-000000000001', 'c8000000-0000-0000-0000-000000000001', pg_temp.at('11:00'), pg_temp.at('11:30'), 'confirmed', 'online'),
  ('d8000000-0000-0000-0000-000000000009', '18000000-0000-0000-0000-00000000000b', 'b8000000-0000-0000-0000-000000000009', 'c8000000-0000-0000-0000-000000000009', pg_temp.at('09:00'), pg_temp.at('09:30'), 'confirmed', 'online');

insert into public.appointment_services (tenant_id, appointment_id, service_id, service_name, price_cents, duration_minutes, position)
select '18000000-0000-0000-0000-00000000000a', a, '58000000-0000-0000-0000-000000000001', 'Corte', 25000, 30, 0
from unnest(array['d8000000-0000-0000-0000-000000000001','d8000000-0000-0000-0000-000000000002','d8000000-0000-0000-0000-000000000003',
                  'd8000000-0000-0000-0000-000000000004','d8000000-0000-0000-0000-000000000005']::uuid[]) a;

update public.appointments set status = 'no_show' where id = 'd8000000-0000-0000-0000-000000000005';

-- Cobros: Ana $250 + $30 propina · Carla $250 − $50 · Beto $250 (salario)
select pg_temp.as_user('a8000000-0000-0000-0000-000000000001');
select public.charge_appointment('d8000000-0000-0000-0000-000000000001', '[{"method":"cash","amount_cents":28000}]', 0, null, 3000);
select public.charge_appointment('d8000000-0000-0000-0000-000000000002', '[{"method":"card","amount_cents":20000}]', 5000, null, 0);
select public.charge_appointment('d8000000-0000-0000-0000-000000000003', '[{"method":"cash","amount_cents":25000}]');
select public.record_barber_payout('b8000000-0000-0000-0000-000000000002', pg_temp.today(), pg_temp.today(), 300000);

-- =============================================================================
-- 1. Visibilidad de clientes (RLS)
-- =============================================================================
select pg_temp.check('admin ve a todos sus clientes', (select count(*) = 4 from public.clients));

select pg_temp.as_user('a8000000-0000-0000-0000-000000000002');
select pg_temp.check('B1 solo ve a los suyos (Ana, Carla)',
  (select array_agg(full_name order by full_name) = array['Ana', 'Carla'] from public.clients));
select pg_temp.check('B1 no lee a Beto por id',
  (select count(*) = 0 from public.clients where id = 'c8000000-0000-0000-0000-000000000002'));

select pg_temp.as_user('a8000000-0000-0000-0000-000000000003');
select pg_temp.check('B2 solo ve a los suyos (Beto, Carla: también cita pendiente)',
  (select array_agg(full_name order by full_name) = array['Beto', 'Carla'] from public.clients));

select pg_temp.as_user('a8000000-0000-0000-0000-000000000004');
select pg_temp.check('admin de otra barbería no ve clientes de K',
  (select count(*) = 0 from public.clients where tenant_id = '18000000-0000-0000-0000-00000000000a'));

select pg_temp.as_postgres();
insert into public.appointments (id, tenant_id, barber_id, client_id, start_at, end_at, status, source) values
  ('d8000000-0000-0000-0000-000000000006', '18000000-0000-0000-0000-00000000000a', 'b8000000-0000-0000-0000-000000000001', 'c8000000-0000-0000-0000-000000000004', pg_temp.at('12:00', 2), pg_temp.at('12:30', 2), 'pending', 'online');
select pg_temp.as_user('a8000000-0000-0000-0000-000000000002');
select pg_temp.check('una cita nueva le da acceso a ese cliente',
  (select count(*) = 3 from public.clients));

-- =============================================================================
-- 2. get_clients
-- =============================================================================
select pg_temp.as_user('a8000000-0000-0000-0000-000000000001');
select pg_temp.check('admin: total 4',
  (select (public.get_clients('18000000-0000-0000-0000-00000000000a') ->> 'total')::int = 4));
select pg_temp.check('buscar sin acentos encuentra a José Ñandú',
  (select public.get_clients('18000000-0000-0000-0000-00000000000a', 'jose nandu') -> 'items' -> 0 ->> 'full_name' = 'José Ñandú'));
select pg_temp.check('buscar por teléfono con espacios encuentra a Beto',
  (select public.get_clients('18000000-0000-0000-0000-00000000000a', '70 0000 02') -> 'items' -> 0 ->> 'full_name' = 'Beto'));
select pg_temp.check('buscar con % no es comodín',
  (select (public.get_clients('18000000-0000-0000-0000-00000000000a', '%') ->> 'total')::int = 0));
select pg_temp.check('paginación: límite 1, total 4',
  (select jsonb_array_length(r -> 'items') = 1 and (r ->> 'total')::int = 4
   from (select public.get_clients('18000000-0000-0000-0000-00000000000a', null, null, 1, 1) as r) x));
select pg_temp.check('Ana: 1 visita, 1 no-show, gastó $280',
  (select i ->> 'visits' = '1' and i ->> 'no_shows' = '1' and i ->> 'spent_cents' = '28000'
   from (select public.get_clients('18000000-0000-0000-0000-00000000000a', null, 'c8000000-0000-0000-0000-000000000001') -> 'items' -> 0 as i) x));
select pg_temp.check('Carla (admin): 1 visita, próxima cita pendiente con B2',
  (select i ->> 'visits' = '1' and i ->> 'spent_cents' = '20000' and i ->> 'next_visit' is not null
   from (select public.get_clients('18000000-0000-0000-0000-00000000000a', null, 'c8000000-0000-0000-0000-000000000003') -> 'items' -> 0 as i) x));

select pg_temp.as_user('a8000000-0000-0000-0000-000000000003');
select pg_temp.check('Carla (B2): sus números, sin lo de B1',
  (select i ->> 'visits' = '0' and i ->> 'spent_cents' = '0' and i ->> 'next_visit' is not null
   from (select public.get_clients('18000000-0000-0000-0000-00000000000a', null, 'c8000000-0000-0000-0000-000000000003') -> 'items' -> 0 as i) x));
select pg_temp.check('B2 no obtiene la ficha de Ana',
  (select jsonb_array_length(public.get_clients('18000000-0000-0000-0000-00000000000a', null, 'c8000000-0000-0000-0000-000000000001') -> 'items') = 0));

select pg_temp.as_user('a8000000-0000-0000-0000-000000000004');
select pg_temp.expect_error('otra barbería → 42501', $q$
  select public.get_clients('18000000-0000-0000-0000-00000000000a')
$q$, '42501');
select pg_temp.as_user(null);
select pg_temp.expect_error('anon → 42501', $q$
  select public.get_clients('18000000-0000-0000-0000-00000000000a')
$q$, '42501');

-- =============================================================================
-- 3. Notas internas
-- =============================================================================
select pg_temp.as_user('a8000000-0000-0000-0000-000000000002');
select pg_temp.expect_ok('B1 anota a Ana', $q$
  select public.set_client_note('c8000000-0000-0000-0000-000000000001', '  corte bajo  ')
$q$);
select pg_temp.check('la nota se guarda sin espacios',
  (select notes = 'corte bajo' from public.clients where id = 'c8000000-0000-0000-0000-000000000001'));
select pg_temp.expect_error('B1 no anota a Beto → P0002', $q$
  select public.set_client_note('c8000000-0000-0000-0000-000000000002', 'x')
$q$, 'P0002');
select pg_temp.expect_error('id inexistente → P0002', $q$
  select public.set_client_note('c8000000-0000-0000-0000-0000000000ff', 'x')
$q$, 'P0002');
select pg_temp.expect_error('nota de más de 1000 → 23514', $q$
  select public.set_client_note('c8000000-0000-0000-0000-000000000001', repeat('a', 1001))
$q$, '23514');

-- UPDATE directo: RLS deja 0 filas, sin cambios
update public.clients set full_name = 'Hackeado', notes = 'x' where id = 'c8000000-0000-0000-0000-000000000001';
select pg_temp.check('barbero: UPDATE directo no cambia nada',
  (select full_name = 'Ana' and notes = 'corte bajo' from public.clients where id = 'c8000000-0000-0000-0000-000000000001'));

select pg_temp.as_user('a8000000-0000-0000-0000-000000000001');
select pg_temp.expect_ok('admin anota a Beto', $q$
  select public.set_client_note('c8000000-0000-0000-0000-000000000002', 'siempre puntual')
$q$);
select pg_temp.expect_ok('nota vacía la borra', $q$
  select public.set_client_note('c8000000-0000-0000-0000-000000000002', '   ')
$q$);
select pg_temp.check('nota en NULL',
  (select notes is null from public.clients where id = 'c8000000-0000-0000-0000-000000000002'));

select pg_temp.as_user('a8000000-0000-0000-0000-000000000004');
select pg_temp.expect_error('admin de otra barbería → P0002', $q$
  select public.set_client_note('c8000000-0000-0000-0000-000000000001', 'x')
$q$, 'P0002');

select pg_temp.as_user(null);
select pg_temp.expect_error('anon no ejecuta set_client_note → 42501', $q$
  select public.set_client_note('c8000000-0000-0000-0000-000000000001', 'x')
$q$, '42501');

-- =============================================================================
-- 4. Editar cliente (solo admin)
-- =============================================================================
select pg_temp.as_user('a8000000-0000-0000-0000-000000000001');
select pg_temp.expect_ok('admin corrige nombre y teléfono', $q$
  select public.update_client('c8000000-0000-0000-0000-000000000002', ' Alberto ', '55 7000 0022')
$q$);
select pg_temp.check('quedó normalizado',
  (select full_name = 'Alberto' and phone = '+525570000022' from public.clients where id = 'c8000000-0000-0000-0000-000000000002'));
select pg_temp.expect_error('teléfono de otro cliente → BA012', $q$
  select public.update_client('c8000000-0000-0000-0000-000000000002', 'Alberto', '5570000001')
$q$, 'BA012');
select pg_temp.expect_error('teléfono inválido → 23514', $q$
  select public.update_client('c8000000-0000-0000-0000-000000000002', 'Alberto', '123')
$q$, '23514');
select pg_temp.expect_error('nombre vacío → 23514', $q$
  select public.update_client('c8000000-0000-0000-0000-000000000002', '   ', '5570000022')
$q$, '23514');
select pg_temp.expect_ok('teléfono vacío lo quita', $q$
  select public.update_client('c8000000-0000-0000-0000-000000000004', 'José Ñandú', '')
$q$);
select pg_temp.check('sin teléfono',
  (select phone is null from public.clients where id = 'c8000000-0000-0000-0000-000000000004'));

select pg_temp.as_user('a8000000-0000-0000-0000-000000000002');
select pg_temp.expect_error('barbero no edita a su cliente → P0002', $q$
  select public.update_client('c8000000-0000-0000-0000-000000000001', 'Otro', '5570000001')
$q$, 'P0002');
select pg_temp.as_user('a8000000-0000-0000-0000-000000000004');
select pg_temp.expect_error('admin de otra barbería → P0002', $q$
  select public.update_client('c8000000-0000-0000-0000-000000000001', 'Otro', '5570000001')
$q$, 'P0002');

-- =============================================================================
-- 5. Estadísticas
-- =============================================================================
create temp table _stats (who text primary key, s jsonb);
grant all on _stats to public;

select pg_temp.as_user('a8000000-0000-0000-0000-000000000001');
insert into _stats select 'admin', public.get_business_stats('18000000-0000-0000-0000-00000000000a', pg_temp.today(), pg_temp.today() + 1);
select pg_temp.as_user('a8000000-0000-0000-0000-000000000002');
insert into _stats select 'b1', public.get_business_stats('18000000-0000-0000-0000-00000000000a', pg_temp.today(), pg_temp.today() + 1);
select pg_temp.as_postgres();

select pg_temp.check('admin: 5 citas, 3 atendidas, 1 pendiente, 1 no-show',
  (select s #>> '{appointments,total}' = '5' and s #>> '{appointments,completed}' = '3'
      and s #>> '{appointments,pending}' = '1' and s #>> '{appointments,no_show}' = '1' from _stats where who = 'admin'));
select pg_temp.check('admin: cobrado $730, servicios $700, descuento $50, propinas $30',
  (select s #>> '{revenue,total_cents}' = '73000' and s #>> '{revenue,services_cents}' = '70000'
      and s #>> '{revenue,discount_cents}' = '5000' and s #>> '{revenue,tips_cents}' = '3000' from _stats where who = 'admin'));
select pg_temp.check('admin: comisiones $180 (40 % de 250 y de 200)',
  (select s #>> '{revenue,commission_cents}' = '18000' from _stats where who = 'admin'));
select pg_temp.check('admin: efectivo $530, tarjeta $200',
  (select s #>> '{methods,cash}' = '53000' and s #>> '{methods,card}' = '20000' from _stats where who = 'admin'));
select pg_temp.check('admin: salarios pagados $3000',
  (select s ->> 'salaries_cents' = '300000' from _stats where who = 'admin'));
select pg_temp.check('admin: ganancia = 730 − 180 − 30 − 3000 = −2480',
  (select s ->> 'profit_cents' = '-248000' from _stats where who = 'admin'));
select pg_temp.check('admin: 2 días en la serie, la suma coincide con servicios',
  (select jsonb_array_length(s -> 'daily') = 2
      and (select sum((d ->> 'cents')::int) from jsonb_array_elements(s -> 'daily') d) = 70000 from _stats where who = 'admin'));
select pg_temp.check('admin: servicio más pedido Corte x3',
  (select s #>> '{services,0,name}' = 'Corte' and s #>> '{services,0,count}' = '3' from _stats where who = 'admin'));
select pg_temp.check('admin: 2 barberos en el desglose',
  (select jsonb_array_length(s -> 'barbers') = 2 from _stats where who = 'admin'));
select pg_temp.check('admin: 3 clientes atendidos, 3 nuevos, 4 en total',
  (select s #>> '{clients,served}' = '3' and s #>> '{clients,new}' = '3' and s #>> '{clients,total}' = '4' from _stats where who = 'admin'));
select pg_temp.check('admin: 7 días de la semana, suman 3 atendidas',
  (select jsonb_array_length(s -> 'weekdays') = 7
      and (select sum((d ->> 'count')::int) from jsonb_array_elements(s -> 'weekdays') d) = 3 from _stats where who = 'admin'));

select pg_temp.check('B1: solo lo suyo ($480 cobrado, 2 cobros, comisión $180)',
  (select s #>> '{revenue,total_cents}' = '48000' and s #>> '{revenue,charges}' = '2'
      and s #>> '{revenue,commission_cents}' = '18000' from _stats where who = 'b1'));
select pg_temp.check('B1: no ve la ganancia de la barbería',
  (select s -> 'profit_cents' = 'null'::jsonb from _stats where who = 'b1'));
select pg_temp.check('B1: un solo barbero en el desglose (él)',
  (select jsonb_array_length(s -> 'barbers') = 1 and s #>> '{barbers,0,name}' = 'B1' from _stats where who = 'b1'));
select pg_temp.check('B1: no le cuentan los salarios de B2',
  (select s ->> 'salaries_cents' = '0' from _stats where who = 'b1'));

select pg_temp.as_user('a8000000-0000-0000-0000-000000000001');
select pg_temp.expect_ok('anular un cobro lo saca de las estadísticas', $q$
  select public.void_charge((select id from public.appointment_charges where appointment_id = 'd8000000-0000-0000-0000-000000000003'), 'prueba')
$q$);
select pg_temp.check('cobrado baja a $480',
  (select public.get_business_stats('18000000-0000-0000-0000-00000000000a', pg_temp.today(), pg_temp.today() + 1) #>> '{revenue,total_cents}' = '48000'));
select pg_temp.expect_error('periodo al revés → 23514', $q$
  select public.get_business_stats('18000000-0000-0000-0000-00000000000a', pg_temp.today(), pg_temp.today() - 1)
$q$, '23514');
select pg_temp.expect_error('periodo de más de un año → 23514', $q$
  select public.get_business_stats('18000000-0000-0000-0000-00000000000a', pg_temp.today() - 400, pg_temp.today())
$q$, '23514');

select pg_temp.as_user('a8000000-0000-0000-0000-000000000004');
select pg_temp.expect_error('estadísticas de otra barbería → 42501', $q$
  select public.get_business_stats('18000000-0000-0000-0000-00000000000a', pg_temp.today(), pg_temp.today())
$q$, '42501');
select pg_temp.as_user(null);
select pg_temp.expect_error('anon no ve estadísticas → 42501', $q$
  select public.get_business_stats('18000000-0000-0000-0000-00000000000a', pg_temp.today(), pg_temp.today())
$q$, '42501');

-- =============================================================================
-- 6. Anonimizados
-- =============================================================================
select pg_temp.as_postgres();
update public.clients set deleted_at = now(), full_name = 'Anónimo', phone = null where id = 'c8000000-0000-0000-0000-000000000003';
select pg_temp.as_user('a8000000-0000-0000-0000-000000000001');
select pg_temp.check('anonimizado fuera del directorio',
  (select (public.get_clients('18000000-0000-0000-0000-00000000000a') ->> 'total')::int = 3));
select pg_temp.expect_error('anonimizado: no se anota → P0002', $q$
  select public.set_client_note('c8000000-0000-0000-0000-000000000003', 'x')
$q$, 'P0002');

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
    raise exception 'clients_stats: % de % pruebas FALLARON', _fail, _total;
  end if;
  raise notice 'clients_stats: % de % pruebas PASARON', _total, _total;
end $$;

rollback;
