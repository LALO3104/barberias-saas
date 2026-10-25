-- =============================================================================
-- Pruebas — Step 11 mover citas (migración 20261025180000)
-- -----------------------------------------------------------------------------
-- SOLO para una base LOCAL o desechable con todas las migraciones aplicadas.
-- Nunca contra producción. Una transacción que termina en ROLLBACK.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/move_appointment.test.sql
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

-- Hora local en la zona de la barbería: hoy + _days.
create function pg_temp.at(_hhmm text, _days int default 1) returns timestamptz language sql stable as $$
  select (((now() at time zone 'America/Mexico_City')::date + _days) + _hhmm::time) at time zone 'America/Mexico_City'
$$;

create function pg_temp.mv(_appt uuid, _barber uuid, _start timestamptz, _services uuid[], _ack boolean default false)
returns jsonb language sql as $$
  select public.move_appointment(_appt, _barber, _start, _services, _ack)
$$;

-- Servicios de una cita, en orden.
create function pg_temp.lines(_appt uuid) returns text language sql stable as $$
  select string_agg(service_name || ':' || price_cents || ':' || duration_minutes, ',' order by position)
  from public.appointment_services where appointment_id = _appt
$$;

grant execute on function pg_temp.at(text, int) to public;
grant execute on function pg_temp.mv(uuid, uuid, timestamptz, uuid[], boolean) to public;
grant execute on function pg_temp.ba007_detail(text) to public;
grant execute on function pg_temp.lines(uuid) to public;

-- ─── Datos de prueba (como postgres) ─────────────────────────────────────────
insert into auth.users (id, email) values
  ('a4000000-0000-0000-0000-000000000001', 'mv-admin-k@test'),
  ('a4000000-0000-0000-0000-000000000002', 'mv-barbero-k1@test'),
  ('a4000000-0000-0000-0000-000000000003', 'mv-barbero-k2@test'),
  ('a4000000-0000-0000-0000-000000000004', 'mv-admin-o@test');

insert into public.tenants (id, slug, name, plan_code, timezone) values
  ('14000000-0000-0000-0000-00000000000a', 'test-mv-k', 'MV Kings', 'barbershop', 'America/Mexico_City'),
  ('14000000-0000-0000-0000-00000000000b', 'test-mv-o', 'MV Otra',  'barbershop', 'America/Mexico_City');

insert into public.tenant_members (tenant_id, user_id, role) values
  ('14000000-0000-0000-0000-00000000000a', 'a4000000-0000-0000-0000-000000000001', 'admin'),
  ('14000000-0000-0000-0000-00000000000a', 'a4000000-0000-0000-0000-000000000002', 'barber'),
  ('14000000-0000-0000-0000-00000000000a', 'a4000000-0000-0000-0000-000000000003', 'barber'),
  ('14000000-0000-0000-0000-00000000000b', 'a4000000-0000-0000-0000-000000000004', 'admin');

insert into public.barbers (id, tenant_id, user_id, display_name, is_active) values
  ('b4000000-0000-0000-0000-000000000001', '14000000-0000-0000-0000-00000000000a', 'a4000000-0000-0000-0000-000000000002', 'K1', true),
  ('b4000000-0000-0000-0000-000000000002', '14000000-0000-0000-0000-00000000000a', 'a4000000-0000-0000-0000-000000000003', 'K2', true),
  ('b4000000-0000-0000-0000-000000000003', '14000000-0000-0000-0000-00000000000a', null, 'K3 inactivo', false),
  ('b4000000-0000-0000-0000-0000000000b1', '14000000-0000-0000-0000-00000000000b', null, 'O1', true);

insert into public.services (id, tenant_id, name, price_cents, duration_minutes, is_active) values
  ('54000000-0000-0000-0000-000000000001', '14000000-0000-0000-0000-00000000000a', 'Corte',  25000, 30, true),
  ('54000000-0000-0000-0000-000000000002', '14000000-0000-0000-0000-00000000000a', 'Barba',  15000, 20, true),
  ('54000000-0000-0000-0000-000000000003', '14000000-0000-0000-0000-00000000000a', 'Ceja',    5000, 10, true),
  ('54000000-0000-0000-0000-000000000004', '14000000-0000-0000-0000-00000000000a', 'Lavado',  8000, 15, true),
  ('54000000-0000-0000-0000-000000000005', '14000000-0000-0000-0000-00000000000a', 'Masaje', 12000, 25, true),
  ('54000000-0000-0000-0000-000000000006', '14000000-0000-0000-0000-00000000000a', 'Tinte',  40000, 60, true),
  ('54000000-0000-0000-0000-000000000007', '14000000-0000-0000-0000-00000000000a', 'Afeitado', 20000, 30, true),
  ('54000000-0000-0000-0000-000000000008', '14000000-0000-0000-0000-00000000000a', 'Perfilado', 9000, 20, true);

insert into public.business_hours (tenant_id, day_of_week, opens_at, closes_at)
  select '14000000-0000-0000-0000-00000000000a', d, time '05:00', time '23:00' from generate_series(1, 7) d;
insert into public.barber_working_hours (tenant_id, barber_id, day_of_week, opens_at, closes_at)
  select '14000000-0000-0000-0000-00000000000a', b, d, time '05:00', time '23:00'
  from generate_series(1, 7) d,
       (values ('b4000000-0000-0000-0000-000000000001'::uuid), ('b4000000-0000-0000-0000-000000000002'::uuid)) v(b);

-- Bloqueo de K2 mañana 12:00–13:00.
insert into public.schedule_blocks (tenant_id, barber_id, starts_at, ends_at, reason) values
  ('14000000-0000-0000-0000-00000000000a', 'b4000000-0000-0000-0000-000000000002', pg_temp.at('12:00'), pg_temp.at('13:00'), 'comida');

insert into public.clients (id, tenant_id, full_name, phone) values
  ('c4000000-0000-0000-0000-000000000001', '14000000-0000-0000-0000-00000000000a', 'Ana',  '+525540000001'),
  ('c4000000-0000-0000-0000-000000000002', '14000000-0000-0000-0000-00000000000a', 'Beto', '+525540000002');

-- Citas de mañana (Corte 30 min): A K1 10:00 · B K1 14:00 · C K1 16:00 completada… (la completamos después)
insert into public.appointments (id, tenant_id, barber_id, client_id, start_at, end_at, status, source) values
  ('d4000000-0000-0000-0000-00000000000a', '14000000-0000-0000-0000-00000000000a', 'b4000000-0000-0000-0000-000000000001', 'c4000000-0000-0000-0000-000000000001', pg_temp.at('10:00'), pg_temp.at('10:30'), 'confirmed', 'online'),
  ('d4000000-0000-0000-0000-00000000000b', '14000000-0000-0000-0000-00000000000a', 'b4000000-0000-0000-0000-000000000001', 'c4000000-0000-0000-0000-000000000002', pg_temp.at('14:00'), pg_temp.at('14:30'), 'pending',   'online'),
  ('d4000000-0000-0000-0000-00000000000c', '14000000-0000-0000-0000-00000000000a', 'b4000000-0000-0000-0000-000000000001', 'c4000000-0000-0000-0000-000000000002', pg_temp.at('16:00'), pg_temp.at('16:30'), 'confirmed', 'online'),
  ('d4000000-0000-0000-0000-00000000000d', '14000000-0000-0000-0000-00000000000a', 'b4000000-0000-0000-0000-000000000002', 'c4000000-0000-0000-0000-000000000001', pg_temp.at('18:00'), pg_temp.at('18:30'), 'confirmed', 'online');

insert into public.appointment_services (tenant_id, appointment_id, service_id, service_name, price_cents, duration_minutes, position)
select '14000000-0000-0000-0000-00000000000a', a, '54000000-0000-0000-0000-000000000001', 'Corte', 25000, 30, 0
from unnest(array['d4000000-0000-0000-0000-00000000000a','d4000000-0000-0000-0000-00000000000b',
                  'd4000000-0000-0000-0000-00000000000c','d4000000-0000-0000-0000-00000000000d']::uuid[]) a;

-- La cita C queda completada (no se podrá mover).
update public.appointments set status = 'completed' where id = 'd4000000-0000-0000-0000-00000000000c';

-- =============================================================================
-- 1. Esquema y privilegios
-- =============================================================================
select pg_temp.check('move_appointment: SECURITY DEFINER con search_path vacío',
  (select prosecdef and proconfig::text like '%search_path=%' from pg_proc where proname = 'move_appointment'));
select pg_temp.check('anon NO puede ejecutar move_appointment; authenticated sí',
  not has_function_privilege('anon', 'public.move_appointment(uuid, uuid, timestamptz, uuid[], boolean)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.move_appointment(uuid, uuid, timestamptz, uuid[], boolean)', 'EXECUTE'));
select pg_temp.check('helper overlaps_other_appointment sin acceso para authenticated',
  not has_function_privilege('authenticated', 'private.overlaps_other_appointment(uuid, uuid, timestamptz, timestamptz, uuid)', 'EXECUTE'));
select pg_temp.check('appointment_changes: RLS activa; authenticated solo SELECT',
  (select relrowsecurity from pg_class where oid = 'public.appointment_changes'::regclass)
  and has_table_privilege('authenticated', 'public.appointment_changes', 'SELECT')
  and not has_table_privilege('authenticated', 'public.appointment_changes', 'INSERT')
  and not has_table_privilege('authenticated', 'public.appointment_changes', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.appointment_changes', 'DELETE')
  and not has_table_privilege('anon', 'public.appointment_changes', 'SELECT'));

-- =============================================================================
-- 2. Reprogramar (admin)
-- =============================================================================
select pg_temp.as_user('a4000000-0000-0000-0000-000000000001');  -- admin K
select pg_temp.expect_ok('admin mueve A de 10:00 a 11:00 (mismo barbero y servicio)', $q$
  select pg_temp.mv('d4000000-0000-0000-0000-00000000000a', 'b4000000-0000-0000-0000-000000000001', pg_temp.at('11:00'),
         array['54000000-0000-0000-0000-000000000001']::uuid[])
$q$);
select pg_temp.as_postgres();
select pg_temp.check('...start/end/ocupación recalculados',
  exists (select 1 from public.appointments where id = 'd4000000-0000-0000-0000-00000000000a'
            and start_at = pg_temp.at('11:00') and end_at = pg_temp.at('11:30') and occupied_until = pg_temp.at('11:20')
            and status = 'confirmed' and overrides = '{}' and overrides_at is null));
select pg_temp.check('...historial registrado con origen, destino y quién',
  exists (select 1 from public.appointment_changes where appointment_id = 'd4000000-0000-0000-0000-00000000000a'
            and old_start_at = pg_temp.at('10:00') and new_start_at = pg_temp.at('11:00')
            and old_barber_id = new_barber_id and changed_by = 'a4000000-0000-0000-0000-000000000001'
            and acknowledged = '{}'));

-- =============================================================================
-- 3. Servicios: los que siguen conservan su precio; se recalcula la duración
-- =============================================================================
update public.services set price_cents = 30000 where id = '54000000-0000-0000-0000-000000000001';  -- Corte sube de precio
select pg_temp.as_user('a4000000-0000-0000-0000-000000000001');
select pg_temp.check('agregar Barba: Corte conserva 25000, Barba al precio actual, fin +20 min',
  (select (r->>'total_duration_minutes')::int = 50 and (r->>'total_price_cents')::int = 40000
          and (r->>'end_at')::timestamptz = pg_temp.at('11:50')
   from (select pg_temp.mv('d4000000-0000-0000-0000-00000000000a', 'b4000000-0000-0000-0000-000000000001', pg_temp.at('11:00'),
                array['54000000-0000-0000-0000-000000000001','54000000-0000-0000-0000-000000000002']::uuid[]) as r) x));
select pg_temp.check('...líneas: Corte:25000:30, Barba:15000:20',
  pg_temp.lines('d4000000-0000-0000-0000-00000000000a') = 'Corte:25000:30,Barba:15000:20',
  pg_temp.lines('d4000000-0000-0000-0000-00000000000a'));
-- (Cada verificación de líneas va en su propia sentencia: pg_temp.lines es
-- STABLE y dentro de la misma sentencia vería los datos de antes de mover.)
select pg_temp.check('quitar Corte → solo Barba: fin 11:20',
  (select (r->>'end_at')::timestamptz = pg_temp.at('11:20')
   from (select pg_temp.mv('d4000000-0000-0000-0000-00000000000a', 'b4000000-0000-0000-0000-000000000001', pg_temp.at('11:00'),
                array['54000000-0000-0000-0000-000000000002']::uuid[]) as r) x));
select pg_temp.check('...líneas: Barba:15000:20 (conserva su snapshot)',
  pg_temp.lines('d4000000-0000-0000-0000-00000000000a') = 'Barba:15000:20',
  pg_temp.lines('d4000000-0000-0000-0000-00000000000a'));
select pg_temp.check('cambiar Barba por Perfilado (misma duración, misma hora): mismo horario',
  (select (r->>'start_at')::timestamptz = pg_temp.at('11:00') and (r->>'end_at')::timestamptz = pg_temp.at('11:20')
   from (select pg_temp.mv('d4000000-0000-0000-0000-00000000000a', 'b4000000-0000-0000-0000-000000000001', pg_temp.at('11:00'),
                array['54000000-0000-0000-0000-000000000008']::uuid[]) as r) x));
select pg_temp.check('...líneas: Perfilado:9000:20',
  pg_temp.lines('d4000000-0000-0000-0000-00000000000a') = 'Perfilado:9000:20',
  pg_temp.lines('d4000000-0000-0000-0000-00000000000a'));
select pg_temp.expect_error('sin cambios → 23514', $q$
  select pg_temp.mv('d4000000-0000-0000-0000-00000000000a', 'b4000000-0000-0000-0000-000000000001',
         (select start_at from public.appointments where id = 'd4000000-0000-0000-0000-00000000000a'),
         (select array_agg(service_id order by position) from public.appointment_services where appointment_id = 'd4000000-0000-0000-0000-00000000000a'))
$q$, '23514');
select pg_temp.expect_error('6 servicios → 23514', $q$
  select pg_temp.mv('d4000000-0000-0000-0000-00000000000a', 'b4000000-0000-0000-0000-000000000001', pg_temp.at('11:00'),
         array['54000000-0000-0000-0000-000000000001','54000000-0000-0000-0000-000000000002','54000000-0000-0000-0000-000000000003',
               '54000000-0000-0000-0000-000000000004','54000000-0000-0000-0000-000000000005','54000000-0000-0000-0000-000000000006']::uuid[])
$q$, '23514');

-- =============================================================================
-- 4. Fechas
-- =============================================================================
select pg_temp.expect_error('a un día anterior → 23514', $q$
  select pg_temp.mv('d4000000-0000-0000-0000-00000000000b', 'b4000000-0000-0000-0000-000000000001', pg_temp.at('14:00', -1),
         array['54000000-0000-0000-0000-000000000001']::uuid[])
$q$, '23514');
select pg_temp.expect_ok('a HOY a una hora ya pasada (05:30) sí se permite', $q$
  select pg_temp.mv('d4000000-0000-0000-0000-00000000000b', 'b4000000-0000-0000-0000-000000000001', pg_temp.at('05:30', 0),
         array['54000000-0000-0000-0000-000000000001']::uuid[])
$q$);
select pg_temp.expect_ok('...y de vuelta a mañana 14:00', $q$
  select pg_temp.mv('d4000000-0000-0000-0000-00000000000b', 'b4000000-0000-0000-0000-000000000001', pg_temp.at('14:00'),
         array['54000000-0000-0000-0000-000000000001']::uuid[])
$q$);

-- =============================================================================
-- 5. Avisos: traslape con confirmación (y nada queda a medias)
-- =============================================================================
-- A está en K1 11:00–11:20 (Perfilado 20 min, ocupa hasta 11:10). Mover B a 11:05 → choca.
select pg_temp.check('mover B encima de A sin confirmar → BA007 overlap con A (no con ella misma)',
  (select d->'warnings' = '["overlap"]'::jsonb and jsonb_array_length(d->'conflicts') = 1
          and d->'conflicts'->0->>'id' = 'd4000000-0000-0000-0000-00000000000a'
   from (select pg_temp.ba007_detail($q$
           select pg_temp.mv('d4000000-0000-0000-0000-00000000000b', 'b4000000-0000-0000-0000-000000000001', pg_temp.at('11:05'),
                  array['54000000-0000-0000-0000-000000000001','54000000-0000-0000-0000-000000000003']::uuid[])
         $q$) as d) x));
select pg_temp.check('...tras BA007 la cita B sigue igual (hora y servicios)',
  exists (select 1 from public.appointments where id = 'd4000000-0000-0000-0000-00000000000b' and start_at = pg_temp.at('14:00'))
  and pg_temp.lines('d4000000-0000-0000-0000-00000000000b') = 'Corte:25000:30');
select pg_temp.check('confirmado → overrides {overlap} con marca del servidor',
  (select r->'overrides' = '["overlap"]'::jsonb
   from (select pg_temp.mv('d4000000-0000-0000-0000-00000000000b', 'b4000000-0000-0000-0000-000000000001', pg_temp.at('11:05'),
                array['54000000-0000-0000-0000-000000000001']::uuid[], true) as r) x));
select pg_temp.as_postgres();
select pg_temp.check('...overrides_at y overrides_by (admin) fijados; A no se movió',
  exists (select 1 from public.appointments where id = 'd4000000-0000-0000-0000-00000000000b'
            and overrides = '{overlap}' and overrides_at is not null and overrides_by = 'a4000000-0000-0000-0000-000000000001')
  and exists (select 1 from public.appointments where id = 'd4000000-0000-0000-0000-00000000000a' and start_at = pg_temp.at('11:00')));
select pg_temp.check('...historial guarda el aviso aceptado',
  exists (select 1 from public.appointment_changes where appointment_id = 'd4000000-0000-0000-0000-00000000000b'
            and acknowledged = '{overlap}' and new_start_at = pg_temp.at('11:05')));

select pg_temp.as_user('a4000000-0000-0000-0000-000000000001');
select pg_temp.expect_ok('moverla a un horario libre limpia los avisos', $q$
  select pg_temp.mv('d4000000-0000-0000-0000-00000000000b', 'b4000000-0000-0000-0000-000000000001', pg_temp.at('15:00'),
         array['54000000-0000-0000-0000-000000000001']::uuid[])
$q$);
select pg_temp.as_postgres();
select pg_temp.check('...overrides vacío y sin marca',
  exists (select 1 from public.appointments where id = 'd4000000-0000-0000-0000-00000000000b'
            and overrides = '{}' and overrides_at is null and overrides_by is null));

select pg_temp.as_user('a4000000-0000-0000-0000-000000000001');
select pg_temp.check('desplazarla 5 min no choca consigo misma',
  (select r->'overrides' = '[]'::jsonb
   from (select pg_temp.mv('d4000000-0000-0000-0000-00000000000b', 'b4000000-0000-0000-0000-000000000001', pg_temp.at('15:05'),
                array['54000000-0000-0000-0000-000000000001']::uuid[]) as r) x));
select pg_temp.check('reasignar a K2 en su bloqueo → BA007 schedule_block',
  (select d->'warnings' = '["schedule_block"]'::jsonb
   from (select pg_temp.ba007_detail($q$
           select pg_temp.mv('d4000000-0000-0000-0000-00000000000b', 'b4000000-0000-0000-0000-000000000002', pg_temp.at('12:15'),
                  array['54000000-0000-0000-0000-000000000001']::uuid[])
         $q$) as d) x));
select pg_temp.check('fuera de horario (04:00) → avisos de local y barbero',
  (select d->'warnings' = '["outside_business_hours", "outside_barber_hours"]'::jsonb
   from (select pg_temp.ba007_detail($q$
           select pg_temp.mv('d4000000-0000-0000-0000-00000000000b', 'b4000000-0000-0000-0000-000000000001', pg_temp.at('04:00'),
                  array['54000000-0000-0000-0000-000000000001']::uuid[])
         $q$) as d) x));

-- =============================================================================
-- 6. Permisos: barbero mueve las suyas, también a otro barbero
-- =============================================================================
select pg_temp.as_user('a4000000-0000-0000-0000-000000000003');  -- barbero K2
select pg_temp.expect_error('K2 NO puede mover una cita de K1', $q$
  select pg_temp.mv('d4000000-0000-0000-0000-00000000000b', 'b4000000-0000-0000-0000-000000000002', pg_temp.at('19:00'),
         array['54000000-0000-0000-0000-000000000001']::uuid[])
$q$, 'P0002');
select pg_temp.as_user('a4000000-0000-0000-0000-000000000002');  -- barbero K1
select pg_temp.expect_ok('K1 pasa su cita B a K2 a las 19:00', $q$
  select pg_temp.mv('d4000000-0000-0000-0000-00000000000b', 'b4000000-0000-0000-0000-000000000002', pg_temp.at('19:00'),
         array['54000000-0000-0000-0000-000000000001']::uuid[])
$q$);
select pg_temp.check('...tomó los locks de agenda de AMBOS barberos',
  (select count(*) from pg_locks where locktype = 'advisory' and classid = 10102 and granted) >= 2);
select pg_temp.expect_error('...y ya no puede moverla (ahora es de K2)', $q$
  select pg_temp.mv('d4000000-0000-0000-0000-00000000000b', 'b4000000-0000-0000-0000-000000000001', pg_temp.at('20:00'),
         array['54000000-0000-0000-0000-000000000001']::uuid[])
$q$, 'P0002');
select pg_temp.as_user('a4000000-0000-0000-0000-000000000003');  -- barbero K2
select pg_temp.expect_ok('K2 sí puede moverla ahora', $q$
  select pg_temp.mv('d4000000-0000-0000-0000-00000000000b', 'b4000000-0000-0000-0000-000000000002', pg_temp.at('19:30'),
         array['54000000-0000-0000-0000-000000000001']::uuid[])
$q$);
select pg_temp.check('historial visible para K2 (destino)',
  exists (select 1 from public.appointment_changes where appointment_id = 'd4000000-0000-0000-0000-00000000000b'
            and new_barber_id = 'b4000000-0000-0000-0000-000000000002'));
select pg_temp.expect_error('authenticated no puede escribir el historial', $q$
  insert into public.appointment_changes (tenant_id, appointment_id, old_barber_id, new_barber_id, old_start_at, new_start_at,
    old_end_at, new_end_at, old_service_ids, new_service_ids)
  values ('14000000-0000-0000-0000-00000000000a', 'd4000000-0000-0000-0000-00000000000b',
    'b4000000-0000-0000-0000-000000000001', 'b4000000-0000-0000-0000-000000000001', now(), now(), now(), now(), '{}', '{}')
$q$, '42501');

select pg_temp.as_user('a4000000-0000-0000-0000-000000000004');  -- admin O
select pg_temp.expect_error('admin de otra barbería → P0002', $q$
  select pg_temp.mv('d4000000-0000-0000-0000-00000000000d', 'b4000000-0000-0000-0000-000000000002', pg_temp.at('20:00'),
         array['54000000-0000-0000-0000-000000000001']::uuid[])
$q$, 'P0002');
select pg_temp.check('admin de otra barbería no ve el historial',
  not exists (select 1 from public.appointment_changes where tenant_id = '14000000-0000-0000-0000-00000000000a'));

select pg_temp.as_user('a4000000-0000-0000-0000-000000000001');  -- admin K
select pg_temp.expect_error('barbero destino inactivo → P0002', $q$
  select pg_temp.mv('d4000000-0000-0000-0000-00000000000d', 'b4000000-0000-0000-0000-000000000003', pg_temp.at('20:00'),
         array['54000000-0000-0000-0000-000000000001']::uuid[])
$q$, 'P0002');
select pg_temp.expect_error('barbero destino de otra barbería → P0002', $q$
  select pg_temp.mv('d4000000-0000-0000-0000-00000000000d', 'b4000000-0000-0000-0000-0000000000b1', pg_temp.at('20:00'),
         array['54000000-0000-0000-0000-000000000001']::uuid[])
$q$, 'P0002');
select pg_temp.expect_error('cita inexistente → P0002', $q$
  select pg_temp.mv('d4000000-0000-0000-0000-0000000000ff', 'b4000000-0000-0000-0000-000000000001', pg_temp.at('20:00'),
         array['54000000-0000-0000-0000-000000000001']::uuid[])
$q$, 'P0002');

-- =============================================================================
-- 7. Estados e inmutabilidad
-- =============================================================================
select pg_temp.expect_error('cita completada → BA008', $q$
  select pg_temp.mv('d4000000-0000-0000-0000-00000000000c', 'b4000000-0000-0000-0000-000000000001', pg_temp.at('20:00'),
         array['54000000-0000-0000-0000-000000000001']::uuid[])
$q$, 'BA008');
select pg_temp.as_postgres();
select pg_temp.expect_error('trigger: ni postgres mueve una cita completada (BA008)', $q$
  update public.appointments set start_at = start_at + interval '1 hour', end_at = end_at + interval '1 hour'
  where id = 'd4000000-0000-0000-0000-00000000000c'
$q$, 'BA008');
select pg_temp.expect_error('trigger: overrides sigue inmutable si la cita no se mueve', $q$
  update public.appointments set overrides = '{overlap}' where id = 'd4000000-0000-0000-0000-00000000000d'
$q$, '42501');
select pg_temp.as_user('a4000000-0000-0000-0000-000000000001');
select pg_temp.expect_error('authenticated sigue sin poder escribir start_at por API', $q$
  update public.appointments set start_at = start_at + interval '1 hour' where id = 'd4000000-0000-0000-0000-00000000000d'
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
    raise exception 'move_appointment: % de % pruebas FALLARON', _fail, _total;
  end if;
  raise notice 'move_appointment: % de % pruebas PASARON', _total, _total;
end $$;

rollback;
