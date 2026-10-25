-- =============================================================================
-- Pruebas — Step 10.3 walk-ins (migración 20261025120000)
-- -----------------------------------------------------------------------------
-- SOLO para una base LOCAL o desechable con todas las migraciones aplicadas.
-- Nunca contra producción. Una transacción que termina en ROLLBACK.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/walk_ins.test.sql
--
-- Los walk-ins solo se permiten HOY (zona de la barbería): las horas de prueba
-- se calculan sobre la fecha local actual (pg_temp.today_at).
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

-- Ejecuta y devuelve el DETAIL de un BA007 (o NULL si no hubo BA007).
create function pg_temp.ba007_detail(_sql text) returns jsonb language plpgsql as $$
declare _detail text; _state text;
begin
  execute _sql;
  return null;
exception when others then
  get stacked diagnostics _state = returned_sqlstate, _detail = pg_exception_detail;
  if _state = 'BA007' then return _detail::jsonb; end if;
  return jsonb_build_object('otro_error', _state);
end $$;

-- Hora local de HOY en la zona de la barbería de prueba.
create function pg_temp.today_at(_hhmm text, _days int default 0) returns timestamptz language sql stable as $$
  select (((now() at time zone 'America/Mexico_City')::date + _days) + _hhmm::time) at time zone 'America/Mexico_City'
$$;

-- Atajo: walk-in con valores por defecto.
create function pg_temp.walk_in(
  _barber uuid, _start timestamptz, _services uuid[] default array['53000000-0000-0000-0000-000000000001'::uuid],
  _phone text default '5510000001', _name text default 'Cliente Walk', _ack boolean default false
) returns jsonb language sql as $$
  select public.create_walk_in(_barber, _services, _start, _name, _phone, null, _ack)
$$;
grant execute on function pg_temp.walk_in(uuid, timestamptz, uuid[], text, text, boolean) to public;
grant execute on function pg_temp.today_at(text, int) to public;
grant execute on function pg_temp.ba007_detail(text) to public;

-- ─── Datos de prueba (como postgres) ─────────────────────────────────────────
-- K: barbería principal · O: otra barbería
insert into auth.users (id, email) values
  ('a3000000-0000-0000-0000-000000000001', 'wi-admin-k@test'),
  ('a3000000-0000-0000-0000-000000000002', 'wi-barbero-k1@test'),
  ('a3000000-0000-0000-0000-000000000003', 'wi-barbero-k2@test'),
  ('a3000000-0000-0000-0000-000000000004', 'wi-admin-o@test');

insert into public.tenants (id, slug, name, plan_code, timezone) values
  ('13000000-0000-0000-0000-00000000000a', 'test-wi-k', 'WI Kings', 'barbershop', 'America/Mexico_City'),
  ('13000000-0000-0000-0000-00000000000b', 'test-wi-o', 'WI Otra',  'barbershop', 'America/Mexico_City');

insert into public.tenant_members (tenant_id, user_id, role) values
  ('13000000-0000-0000-0000-00000000000a', 'a3000000-0000-0000-0000-000000000001', 'admin'),
  ('13000000-0000-0000-0000-00000000000a', 'a3000000-0000-0000-0000-000000000002', 'barber'),
  ('13000000-0000-0000-0000-00000000000a', 'a3000000-0000-0000-0000-000000000003', 'barber'),
  ('13000000-0000-0000-0000-00000000000b', 'a3000000-0000-0000-0000-000000000004', 'admin');

insert into public.barbers (id, tenant_id, user_id, display_name, is_active) values
  ('b3000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-00000000000a', 'a3000000-0000-0000-0000-000000000002', 'K1', true),
  ('b3000000-0000-0000-0000-000000000002', '13000000-0000-0000-0000-00000000000a', 'a3000000-0000-0000-0000-000000000003', 'K2 sin horario', true),
  ('b3000000-0000-0000-0000-000000000003', '13000000-0000-0000-0000-00000000000a', null, 'K3 inactivo', false),
  ('b3000000-0000-0000-0000-0000000000b1', '13000000-0000-0000-0000-00000000000b', null, 'O1', true);

insert into public.services (id, tenant_id, name, price_cents, duration_minutes, is_active) values
  ('53000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-00000000000a', 'Corte',    25000, 30, true),
  ('53000000-0000-0000-0000-000000000002', '13000000-0000-0000-0000-00000000000a', 'Barba',    15000, 20, true),
  ('53000000-0000-0000-0000-000000000003', '13000000-0000-0000-0000-00000000000a', 'Ceja',      5000, 10, true),
  ('53000000-0000-0000-0000-000000000004', '13000000-0000-0000-0000-00000000000a', 'Lavado',    8000, 15, true),
  ('53000000-0000-0000-0000-000000000005', '13000000-0000-0000-0000-00000000000a', 'Masaje',   12000, 25, true),
  ('53000000-0000-0000-0000-000000000006', '13000000-0000-0000-0000-00000000000a', 'Tinte',    40000, 60, true),
  ('53000000-0000-0000-0000-000000000009', '13000000-0000-0000-0000-00000000000a', 'Retirado',  9900, 15, false),
  ('53000000-0000-0000-0000-0000000000b1', '13000000-0000-0000-0000-00000000000b', 'Corte O',  20000, 30, true);

-- Local K y barbero K1: 05:00–23:00 todos los días. K2 sin horario.
insert into public.business_hours (tenant_id, day_of_week, opens_at, closes_at)
  select '13000000-0000-0000-0000-00000000000a', d, time '05:00', time '23:00' from generate_series(1, 7) d;
insert into public.barber_working_hours (tenant_id, barber_id, day_of_week, opens_at, closes_at)
  select '13000000-0000-0000-0000-00000000000a', 'b3000000-0000-0000-0000-000000000001', d, time '05:00', time '23:00' from generate_series(1, 7) d;

-- Bloqueo de K1 hoy 08:00–09:00.
insert into public.schedule_blocks (tenant_id, barber_id, starts_at, ends_at, reason) values
  ('13000000-0000-0000-0000-00000000000a', 'b3000000-0000-0000-0000-000000000001', pg_temp.today_at('08:00'), pg_temp.today_at('09:00'), 'comida');

-- Cliente existente.
insert into public.clients (id, tenant_id, full_name, phone) values
  ('c3000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-00000000000a', 'Juan Pérez', '+525599999999');

-- =============================================================================
-- 1. Esquema y privilegios
-- =============================================================================
select pg_temp.check('columnas overrides / overrides_at / overrides_by existen',
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'appointments'
      and column_name in ('overrides', 'overrides_at', 'overrides_by')) = 3);
select pg_temp.check('exclusión excluye solo traslapes aceptados',
  pg_get_constraintdef((select oid from pg_constraint where conname = 'appointments_no_overlap')) like '%overlap%= ANY (overrides)%');
select pg_temp.check('no queda la restricción temporal',
  not exists (select 1 from pg_constraint where conname = 'appointments_no_overlap_walk_ins'));
select pg_temp.check('create_walk_in: SECURITY DEFINER con search_path vacío',
  (select prosecdef and proconfig::text like '%search_path=%' from pg_proc where proname = 'create_walk_in'));
select pg_temp.check('anon NO puede ejecutar create_walk_in ni find_client_by_phone',
  not has_function_privilege('anon', 'public.create_walk_in(uuid, uuid[], timestamptz, text, text, text, boolean)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.find_client_by_phone(uuid, text)', 'EXECUTE'));
select pg_temp.check('authenticated SÍ puede ejecutarlas',
  has_function_privilege('authenticated', 'public.create_walk_in(uuid, uuid[], timestamptz, text, text, text, boolean)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.find_client_by_phone(uuid, text)', 'EXECUTE'));
select pg_temp.check('private.walk_in_tenant sin acceso para authenticated',
  not has_function_privilege('authenticated', 'private.walk_in_tenant(uuid)', 'EXECUTE'));

select pg_temp.as_user(null);
select pg_temp.expect_error('anon no puede crear walk-ins', $q$
  select pg_temp.walk_in('b3000000-0000-0000-0000-000000000001', pg_temp.today_at('06:00'))
$q$, '42501');

-- =============================================================================
-- 2. Creación básica
-- =============================================================================
select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');  -- admin K
select pg_temp.expect_ok('admin registra walk-in para K1 hoy 06:00', $q$
  select pg_temp.walk_in('b3000000-0000-0000-0000-000000000001', pg_temp.today_at('06:00'))
$q$);

select pg_temp.as_postgres();
select pg_temp.check('...confirmed, walk_in, creado por el admin, sin avisos',
  exists (select 1 from public.appointments
          where barber_id = 'b3000000-0000-0000-0000-000000000001' and start_at = pg_temp.today_at('06:00')
            and status = 'confirmed' and source = 'walk_in' and created_by = 'a3000000-0000-0000-0000-000000000001'
            and overrides = '{}' and overrides_at is null and overrides_by is null));
select pg_temp.check('...end_at = inicio + 30 min y ocupación 20 min',
  exists (select 1 from public.appointments
          where barber_id = 'b3000000-0000-0000-0000-000000000001' and start_at = pg_temp.today_at('06:00')
            and end_at = pg_temp.today_at('06:30') and occupied_until = pg_temp.today_at('06:20')));
select pg_temp.check('...cliente nuevo creado con teléfono normalizado y created_by',
  exists (select 1 from public.clients where tenant_id = '13000000-0000-0000-0000-00000000000a'
            and phone = '+525510000001' and full_name = 'Cliente Walk' and created_by = 'a3000000-0000-0000-0000-000000000001'));

select pg_temp.as_user('a3000000-0000-0000-0000-000000000002');  -- barbero K1
select pg_temp.check('hora exacta (10:37) y varios servicios: respuesta con totales',
  (select r->>'status' = 'confirmed' and r->>'source' = 'walk_in'
          and (r->>'total_duration_minutes')::int = 50 and (r->>'total_price_cents')::int = 40000
          and jsonb_array_length(r->'services') = 2
          and (r->'services'->0->>'name') = 'Corte' and (r->'services'->1->>'name') = 'Barba'
          and (r->>'start_at')::timestamptz = pg_temp.today_at('10:37')
   from (select pg_temp.walk_in('b3000000-0000-0000-0000-000000000001', pg_temp.today_at('10:37'),
                array['53000000-0000-0000-0000-000000000001','53000000-0000-0000-0000-000000000002']::uuid[],
                '5510000002', 'Pedro') as r) x));
select pg_temp.check('los segundos se descartan (minuto exacto)',
  (select (r->>'start_at')::timestamptz = pg_temp.today_at('12:15')
   from (select pg_temp.walk_in('b3000000-0000-0000-0000-000000000001', pg_temp.today_at('12:15') + interval '42 seconds',
                array['53000000-0000-0000-0000-000000000003']::uuid[], '5510000003', 'Seg') as r) x));

-- =============================================================================
-- 3. Permisos y aislamiento
-- =============================================================================
select pg_temp.expect_error('barbero K1 NO puede registrar para K2', $q$
  select pg_temp.walk_in('b3000000-0000-0000-0000-000000000002', pg_temp.today_at('06:00'))
$q$, 'P0002');
select pg_temp.as_user('a3000000-0000-0000-0000-000000000004');  -- admin O
select pg_temp.expect_error('admin de OTRA barbería no puede registrar para K1', $q$
  select pg_temp.walk_in('b3000000-0000-0000-0000-000000000001', pg_temp.today_at('06:00'))
$q$, 'P0002');
select pg_temp.expect_error('admin de otra barbería: servicio de K con barbero suyo → P0002', $q$
  select pg_temp.walk_in('b3000000-0000-0000-0000-0000000000b1', pg_temp.today_at('06:00'))
$q$, 'P0002');
select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');  -- admin K
select pg_temp.expect_error('barbero inactivo → P0002', $q$
  select pg_temp.walk_in('b3000000-0000-0000-0000-000000000003', pg_temp.today_at('06:00'))
$q$, 'P0002');
select pg_temp.expect_error('barbero inexistente → P0002', $q$
  select pg_temp.walk_in('b3000000-0000-0000-0000-0000000000ff', pg_temp.today_at('06:00'))
$q$, 'P0002');

-- =============================================================================
-- 4. Validaciones
-- =============================================================================
select pg_temp.expect_error('ayer → 23514', $q$
  select pg_temp.walk_in('b3000000-0000-0000-0000-000000000001', pg_temp.today_at('14:00', -1))
$q$, '23514');
select pg_temp.expect_error('mañana → 23514', $q$
  select pg_temp.walk_in('b3000000-0000-0000-0000-000000000001', pg_temp.today_at('14:00', 1))
$q$, '23514');
select pg_temp.expect_error('hora NULL → 23514', $q$
  select pg_temp.walk_in('b3000000-0000-0000-0000-000000000001', null)
$q$, '23514');
select pg_temp.expect_error('nombre vacío → 23514', $q$
  select pg_temp.walk_in('b3000000-0000-0000-0000-000000000001', pg_temp.today_at('14:00'), _name => '   ')
$q$, '23514');
select pg_temp.expect_error('nombre de más de 120 caracteres → 23514', $q$
  select pg_temp.walk_in('b3000000-0000-0000-0000-000000000001', pg_temp.today_at('14:00'), _name => repeat('x', 121))
$q$, '23514');
select pg_temp.expect_error('teléfono inválido → 23514', $q$
  select pg_temp.walk_in('b3000000-0000-0000-0000-000000000001', pg_temp.today_at('14:00'), _phone => '123')
$q$, '23514');
select pg_temp.expect_error('nota de más de 500 caracteres → 23514', $q$
  select public.create_walk_in('b3000000-0000-0000-0000-000000000001', array['53000000-0000-0000-0000-000000000001']::uuid[],
         pg_temp.today_at('14:00'), 'Nota', '5510000009', repeat('n', 501))
$q$, '23514');
select pg_temp.expect_error('6 servicios → 23514', $q$
  select pg_temp.walk_in('b3000000-0000-0000-0000-000000000001', pg_temp.today_at('14:00'),
         array['53000000-0000-0000-0000-000000000001','53000000-0000-0000-0000-000000000002','53000000-0000-0000-0000-000000000003',
               '53000000-0000-0000-0000-000000000004','53000000-0000-0000-0000-000000000005','53000000-0000-0000-0000-000000000006']::uuid[])
$q$, '23514');
select pg_temp.expect_error('servicio repetido → 23514', $q$
  select pg_temp.walk_in('b3000000-0000-0000-0000-000000000001', pg_temp.today_at('14:00'),
         array['53000000-0000-0000-0000-000000000001','53000000-0000-0000-0000-000000000001']::uuid[])
$q$, '23514');
select pg_temp.expect_error('servicio inactivo → P0002', $q$
  select pg_temp.walk_in('b3000000-0000-0000-0000-000000000001', pg_temp.today_at('14:00'),
         array['53000000-0000-0000-0000-000000000009']::uuid[])
$q$, 'P0002');
select pg_temp.expect_error('servicio de otra barbería → P0002', $q$
  select pg_temp.walk_in('b3000000-0000-0000-0000-000000000001', pg_temp.today_at('14:00'),
         array['53000000-0000-0000-0000-0000000000b1']::uuid[])
$q$, 'P0002');

-- =============================================================================
-- 5. Avisos: traslape, horario y bloqueo
-- =============================================================================
-- Ya existe K1 06:00–06:30 (ocupa hasta 06:20).
select pg_temp.check('traslape sin confirmar → BA007 con warning overlap y la cita en conflicto',
  (select d->'warnings' = '["overlap"]'::jsonb
          and jsonb_array_length(d->'conflicts') = 1
          and (d->'conflicts'->0->>'client_name') = 'Cliente Walk'
          and (d->'conflicts'->0->>'start_at')::timestamptz = pg_temp.today_at('06:00')
   from (select pg_temp.ba007_detail($q$
           select pg_temp.walk_in('b3000000-0000-0000-0000-000000000001', pg_temp.today_at('06:10'), _phone => '5510000004')
         $q$) as d) x),
  (select pg_temp.ba007_detail($q$
     select pg_temp.walk_in('b3000000-0000-0000-0000-000000000001', pg_temp.today_at('06:10'), _phone => '5510000004')
   $q$)::text));
select pg_temp.check('margen de 10 min: a las 06:20 NO hay conflicto',
  (select r->>'status' = 'confirmed' and r->'overrides' = '[]'::jsonb
   from (select pg_temp.walk_in('b3000000-0000-0000-0000-000000000001', pg_temp.today_at('06:20'),
                array['53000000-0000-0000-0000-000000000003']::uuid[], '5510000005') as r) x));
select pg_temp.check('traslape confirmado → se registra con overrides = {overlap}',
  (select r->'overrides' = '["overlap"]'::jsonb
   from (select pg_temp.walk_in('b3000000-0000-0000-0000-000000000001', pg_temp.today_at('06:10'),
                _phone => '5510000004', _ack => true) as r) x));

select pg_temp.as_postgres();
select pg_temp.check('...overrides_at y overrides_by (admin) registrados; la otra cita sigue igual',
  exists (select 1 from public.appointments
          where barber_id = 'b3000000-0000-0000-0000-000000000001' and start_at = pg_temp.today_at('06:10')
            and overrides = '{overlap}' and overrides_at is not null and overrides_by = 'a3000000-0000-0000-0000-000000000001')
  and exists (select 1 from public.appointments
              where barber_id = 'b3000000-0000-0000-0000-000000000001' and start_at = pg_temp.today_at('06:00')
                and status = 'confirmed' and end_at = pg_temp.today_at('06:30')));

select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');  -- admin K
select pg_temp.check('bloqueo de agenda → BA007 schedule_block',
  (select d->'warnings' = '["schedule_block"]'::jsonb
   from (select pg_temp.ba007_detail($q$
           select pg_temp.walk_in('b3000000-0000-0000-0000-000000000001', pg_temp.today_at('08:15'), _phone => '5510000006')
         $q$) as d) x));
select pg_temp.check('barbero sin horario → BA007 outside_barber_hours',
  (select d->'warnings' = '["outside_barber_hours"]'::jsonb and d->'conflicts' = '[]'::jsonb
   from (select pg_temp.ba007_detail($q$
           select pg_temp.walk_in('b3000000-0000-0000-0000-000000000002', pg_temp.today_at('10:00'), _phone => '5510000007')
         $q$) as d) x));
select pg_temp.check('fuera del horario del local y del barbero (04:00) → ambos avisos',
  (select d->'warnings' = '["outside_business_hours", "outside_barber_hours"]'::jsonb
   from (select pg_temp.ba007_detail($q$
           select pg_temp.walk_in('b3000000-0000-0000-0000-000000000001', pg_temp.today_at('04:00'), _phone => '5510000008')
         $q$) as d) x));
select pg_temp.check('confirmado fuera de horario → overrides con ambos avisos',
  (select r->'overrides' = '["outside_business_hours", "outside_barber_hours"]'::jsonb
   from (select pg_temp.walk_in('b3000000-0000-0000-0000-000000000001', pg_temp.today_at('04:00'),
                _phone => '5510000008', _ack => true) as r) x));

select pg_temp.as_user('a3000000-0000-0000-0000-000000000002');  -- barbero K1
select pg_temp.check('el barbero también puede confirmar avisos en su agenda',
  (select r->'overrides' = '["schedule_block"]'::jsonb
   from (select pg_temp.walk_in('b3000000-0000-0000-0000-000000000001', pg_temp.today_at('08:15'),
                _phone => '5510000006', _ack => true) as r) x));

-- =============================================================================
-- 6. Cliente existente: se conserva su nombre
-- =============================================================================
select pg_temp.check('teléfono existente con otro nombre → se usa el cliente guardado',
  (select r->'client'->>'id' = 'c3000000-0000-0000-0000-000000000001'
          and r->'client'->>'name' = 'Juan Pérez' and (r->'client'->>'existing')::boolean
   from (select pg_temp.walk_in('b3000000-0000-0000-0000-000000000001', pg_temp.today_at('15:00'),
                _phone => '55 9999 9999', _name => 'Juanito') as r) x));
select pg_temp.as_postgres();
select pg_temp.check('...el nombre guardado NO cambió',
  (select full_name from public.clients where id = 'c3000000-0000-0000-0000-000000000001') = 'Juan Pérez');

select pg_temp.as_user('a3000000-0000-0000-0000-000000000002');  -- barbero K1
select pg_temp.check('find_client_by_phone: encuentra al cliente existente',
  (select r->>'valid' = 'true' and r->>'phone' = '+525599999999' and r->'client'->>'name' = 'Juan Pérez'
   from (select public.find_client_by_phone('b3000000-0000-0000-0000-000000000001', '5599999999') as r) x));
select pg_temp.check('find_client_by_phone: teléfono nuevo → client null',
  (select r->>'valid' = 'true' and r->'client' = 'null'::jsonb
   from (select public.find_client_by_phone('b3000000-0000-0000-0000-000000000001', '5512345678') as r) x));
select pg_temp.check('find_client_by_phone: teléfono inválido → valid false',
  (select r->>'valid' = 'false' from (select public.find_client_by_phone('b3000000-0000-0000-0000-000000000001', 'abc') as r) x));
select pg_temp.expect_error('find_client_by_phone: barbero ajeno → P0002', $q$
  select public.find_client_by_phone('b3000000-0000-0000-0000-000000000002', '5599999999')
$q$, 'P0002');
select pg_temp.as_user('a3000000-0000-0000-0000-000000000004');  -- admin O
select pg_temp.expect_error('find_client_by_phone: otra barbería → P0002', $q$
  select public.find_client_by_phone('b3000000-0000-0000-0000-000000000001', '5599999999')
$q$, 'P0002');

-- =============================================================================
-- 7. Inmutabilidad de los avisos aceptados
-- =============================================================================
select pg_temp.as_user('a3000000-0000-0000-0000-000000000001');  -- admin K
select pg_temp.expect_error('admin NO puede escribir overrides (sin privilegio)', $q$
  update public.appointments set overrides = '{}' where start_at = pg_temp.today_at('06:10')
$q$, '42501');
select pg_temp.as_postgres();
select pg_temp.expect_error('postgres tampoco: overrides', $q$
  update public.appointments set overrides = '{}', overrides_at = null where start_at = pg_temp.today_at('06:10')
$q$, '42501');
select pg_temp.expect_error('postgres tampoco: overrides_by', $q$
  update public.appointments set overrides_by = 'a3000000-0000-0000-0000-000000000002' where start_at = pg_temp.today_at('06:10')
$q$, '42501');
select pg_temp.expect_error('CHECK: avisos desconocidos no se aceptan', $q$
  insert into public.appointments (tenant_id, barber_id, client_id, start_at, end_at, status, source, overrides, overrides_at)
  values ('13000000-0000-0000-0000-00000000000a', 'b3000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000001',
          pg_temp.today_at('20:00'), pg_temp.today_at('20:30'), 'confirmed', 'walk_in', '{inventado}', now())
$q$, '23514');
select pg_temp.expect_error('CHECK: overrides sin overrides_at no se aceptan', $q$
  insert into public.appointments (tenant_id, barber_id, client_id, start_at, end_at, status, source, overrides)
  values ('13000000-0000-0000-0000-00000000000a', 'b3000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000001',
          pg_temp.today_at('20:00'), pg_temp.today_at('20:30'), 'confirmed', 'walk_in', '{overlap}')
$q$, '23514');

-- =============================================================================
-- 8. La reserva pública sigue estricta frente a citas con traslape aceptado
-- =============================================================================
-- Cita de mañana 10:00–10:30 con traslape aceptado (insertada como postgres).
insert into public.appointments (tenant_id, barber_id, client_id, start_at, end_at, status, source, overrides, overrides_at)
values ('13000000-0000-0000-0000-00000000000a', 'b3000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000001',
        pg_temp.today_at('10:00', 1), pg_temp.today_at('10:30', 1), 'confirmed', 'walk_in', '{overlap}', now());

select pg_temp.as_user(null);
select pg_temp.expect_error('book_appointment encima de una cita con traslape aceptado → P0003', $q$
  select public.book_appointment('test-wi-k', 'b3000000-0000-0000-0000-000000000001',
         array['53000000-0000-0000-0000-000000000001']::uuid[], pg_temp.today_at('10:05', 1), 'Público', '5520000001')
$q$, 'P0003');
-- Corte (30 min) ocupa 20 min: choca con [10:00, 10:20) si empieza entre 09:45 y 10:15.
create temp table _slots_tomorrow as
  select s.slot_start from public.get_available_slots('test-wi-k', 'b3000000-0000-0000-0000-000000000001',
         array['53000000-0000-0000-0000-000000000001']::uuid[], ((now() at time zone 'America/Mexico_City')::date + 1)) s;
select pg_temp.check('get_available_slots no ofrece horarios encima de esa cita (09:45–10:15)',
  not exists (select 1 from _slots_tomorrow
              where slot_start >= pg_temp.today_at('09:45', 1) and slot_start <= pg_temp.today_at('10:15', 1)));
select pg_temp.check('...pero sí los bordes 09:40 y 10:20 (margen de 10 min)',
  exists (select 1 from _slots_tomorrow where slot_start = pg_temp.today_at('09:40', 1))
  and exists (select 1 from _slots_tomorrow where slot_start = pg_temp.today_at('10:20', 1)));

select pg_temp.as_postgres();
select pg_temp.expect_error('exclusión: dos citas normales traslapadas siguen prohibidas (23P01)', $q$
  insert into public.appointments (tenant_id, barber_id, client_id, start_at, end_at, status, source)
  values ('13000000-0000-0000-0000-00000000000a', 'b3000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000001',
          pg_temp.today_at('06:05'), pg_temp.today_at('06:35'), 'confirmed', 'staff')
$q$, '23P01');

-- =============================================================================
-- 9. Ciclo de vida y lock
-- =============================================================================
select pg_temp.as_user('a3000000-0000-0000-0000-000000000002');  -- barbero K1
select pg_temp.expect_ok('el walk-in se puede completar después', $q$
  select public.set_appointment_status(
    (select id from public.appointments where start_at = pg_temp.today_at('06:00')
       and barber_id = 'b3000000-0000-0000-0000-000000000001'), 'completed')
$q$);
select pg_temp.check('create_walk_in tomó el lock de agenda del barbero (pg_locks 10102)',
  exists (select 1 from pg_locks where locktype = 'advisory' and classid = 10102 and granted));

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
    raise exception 'walk_ins: % de % pruebas FALLARON', _fail, _total;
  end if;
  raise notice 'walk_ins: % de % pruebas PASARON', _total, _total;
end $$;

rollback;
