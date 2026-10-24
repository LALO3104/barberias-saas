-- =============================================================================
-- Barberías SaaS — Migración 17: reserva pública multi-servicio (Step 10.1, Migration C)
-- -----------------------------------------------------------------------------
-- Nuevas firmas públicas (contrato del frontend):
--
--   public.get_available_slots(_slug text, _barber_id uuid, _service_ids uuid[], _target_date date)
--     returns table (slot_start timestamptz)
--   public.book_appointment(_slug text, _barber_id uuid, _service_ids uuid[], _start_at timestamptz,
--                           _client_name text, _client_phone text, _client_note text default null)
--     returns jsonb
--       { appointment_id, status: 'pending', barber_id, start_at, end_at,
--         services: [{ id, name, price_cents, duration_minutes, position }],
--         total_price_cents, total_duration_minutes,
--         client: { id, name, phone } }
--
-- Reglas:
--   * 1 a 5 servicios, sin NULL ni repetidos (23514); todos de la barbería y
--     activos (si no, P0002, igual que hoy con un servicio).
--   * Duración total D = suma; precio total = suma (bigint). Tope técnico:
--     D > 1440 min → 23514 (no es regla de producto).
--   * end_at = start_at + D. Las líneas se guardan en el orden del arreglo
--     (position 0..n-1).
--   * Rejilla de 5 minutos desde la medianoche local (tenants.timezone).
--   * El servicio completo [inicio, inicio + D) debe caber en
--     business_hours ∩ barber_working_hours, y no tocar schedule_blocks del
--     barbero ni globales.
--   * Conflicto con citas activas (pending/confirmed/completed) usando la
--     ocupación (Migration A): [a.start_at, a.occupied_until) contra
--     [inicio, private.appointment_occupied_until(inicio, inicio + D)). Es el
--     mismo predicado que appointments_no_overlap.
--   * Anticipación mínima pública: 15 minutos (slot >= now() + 15 min). La
--     reserva lo revalida.
--   * book_appointment toma un advisory lock por barbero ANTES de revalidar la
--     agenda; el 23P01 de la exclusión se sigue traduciendo a P0003.
--
-- Helpers privados (reutilizables por Step 10.2 / walk-ins). Todos SECURITY
-- INVOKER, search_path = '', sin EXECUTE para public/anon/authenticated: solo
-- los invocan funciones SECURITY DEFINER (dueño postgres).
--   private.lock_barber_agenda(barber)                      advisory lock de agenda
--   private.resolve_booking_services(tenant, ids[])         valida y ordena la lista
--   private.within_business_hours(tenant, tz, inicio, fin)
--   private.within_barber_hours(tenant, barber, tz, inicio, fin)
--   private.overlaps_schedule_block(tenant, barber, inicio, fin)
--   private.overlaps_active_appointment(tenant, barber, inicio, ocupado_hasta)
--
-- Orden de locks (para que no haya deadlocks cuando walk-ins los reutilice):
--   1. servicios FOR SHARE (orden por id)  2. agenda del barbero (advisory)
--   3. INSERT de la cita y sus líneas (trigger: cita FOR SHARE + lock de líneas)
--
-- Compatibilidad de transición: las firmas antiguas (_service_id uuid) se
-- conservan como envoltorios delgados de las nuevas:
--   * get_available_slots(…, _service_id uuid, …) → solo los slots en
--     múltiplos de 15 minutos locales (la rejilla antigua).
--   * book_appointment(…, _service_id uuid, …)    → misma forma de respuesta
--     antigua (objeto "service" singular, sin services ni totales).
--   Ambos heredan las reglas nuevas (ocupación, anticipación de 15 min). Se
--   eliminarán cuando el frontend migre a las firmas nuevas.
--
-- PostgREST resuelve la sobrecarga por los NOMBRES de los argumentos enviados
-- (_service_id vs _service_ids). En SQL directo, un literal sin tipo en esa
-- posición es ambiguo (42725): hay que tiparlo ('…'::uuid o '{…}'::uuid[]).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Helpers privados
-- -----------------------------------------------------------------------------

-- 1.1 Lock de agenda por barbero (transaccional). Namespace 10102; el 10101 es
--     el de líneas de una cita (Migration B).
create or replace function private.lock_barber_agenda(_barber_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(10102, pg_catalog.hashtext(_barber_id::text));
end;
$$;

comment on function private.lock_barber_agenda(uuid) is
  'Advisory lock de transacción sobre la agenda de un barbero. Toda función que cree o mueva citas debe tomarlo antes de revalidar conflictos.';

-- 1.2 Lista de servicios de una reserva: valida y devuelve las líneas en el
--     orden recibido. No toma locks (es STABLE para poder usarse en
--     get_available_slots); book_appointment bloquea los servicios FOR SHARE
--     antes de llamarla.
create or replace function private.resolve_booking_services(
  _tenant_id   uuid,
  _service_ids uuid[]
)
returns table (
  line_position    integer,
  service_id       uuid,
  service_name     text,
  price_cents      integer,
  duration_minutes integer
)
language plpgsql
stable
set search_path = ''
as $$
declare
  _n        integer := coalesce(pg_catalog.cardinality(_service_ids), 0);
  _found    bigint;
  _duration bigint;
begin
  if _n < 1 or _n > 5 then
    raise exception 'Selecciona entre 1 y 5 servicios'
      using errcode = 'check_violation';
  end if;

  if pg_catalog.array_ndims(_service_ids) <> 1 then
    raise exception 'La lista de servicios no es válida'
      using errcode = 'check_violation';
  end if;

  if pg_catalog.array_position(_service_ids, null) is not null then
    raise exception 'La lista de servicios contiene valores vacíos'
      using errcode = 'check_violation';
  end if;

  if (select count(distinct x) from pg_catalog.unnest(_service_ids) as x) <> _n then
    raise exception 'La lista de servicios contiene servicios repetidos'
      using errcode = 'check_violation';
  end if;

  select count(*), sum(s.duration_minutes)
    into _found, _duration
  from public.services s
  where s.tenant_id = _tenant_id
    and s.id = any (_service_ids)
    and s.is_active = true;

  if _found <> _n then
    raise exception 'Servicio no encontrado o inactivo'
      using errcode = 'P0002';
  end if;

  if _duration > 1440 then
    raise exception 'La duración total de los servicios excede 24 horas'
      using errcode = 'check_violation';
  end if;

  return query
  select (u.ord - 1)::integer, s.id, s.name, s.price_cents, s.duration_minutes
  from pg_catalog.unnest(_service_ids) with ordinality as u(id, ord)
  join public.services s
    on s.tenant_id = _tenant_id
   and s.id = u.id
  order by u.ord;
end;
$$;

comment on function private.resolve_booking_services(uuid, uuid[]) is
  'Valida una lista de 1 a 5 servicios (sin NULL ni repetidos → 23514; inexistentes, de otra barbería o inactivos → P0002; duración total > 1440 → 23514) y la devuelve en el orden recibido (line_position 0..n-1).';

-- 1.3 El rango [inicio, fin] cabe en una ventana del horario del local para el
--     día local de inicio.
create or replace function private.within_business_hours(
  _tenant_id uuid,
  _tz        text,
  _start_at  timestamptz,
  _end_at    timestamptz
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from (select (_start_at at time zone _tz)::date as d) as local_day,
         public.business_hours bh
    where bh.tenant_id   = _tenant_id
      and bh.day_of_week = extract(isodow from local_day.d)::integer
      and (local_day.d + bh.opens_at)  at time zone _tz <= _start_at
      and (local_day.d + bh.closes_at) at time zone _tz >= _end_at
  );
$$;

comment on function private.within_business_hours(uuid, text, timestamptz, timestamptz) is
  'true si [inicio, fin] cabe en una ventana de business_hours del día local (tz) de inicio.';

-- 1.4 Igual, para el horario del barbero.
create or replace function private.within_barber_hours(
  _tenant_id uuid,
  _barber_id uuid,
  _tz        text,
  _start_at  timestamptz,
  _end_at    timestamptz
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from (select (_start_at at time zone _tz)::date as d) as local_day,
         public.barber_working_hours bwh
    where bwh.tenant_id   = _tenant_id
      and bwh.barber_id   = _barber_id
      and bwh.day_of_week = extract(isodow from local_day.d)::integer
      and (local_day.d + bwh.opens_at)  at time zone _tz <= _start_at
      and (local_day.d + bwh.closes_at) at time zone _tz >= _end_at
  );
$$;

comment on function private.within_barber_hours(uuid, uuid, text, timestamptz, timestamptz) is
  'true si [inicio, fin] cabe en una ventana de barber_working_hours del barbero en el día local (tz) de inicio.';

-- 1.5 Bloqueos de agenda (del barbero o de todo el local) que tocan
--     [inicio, fin). Se usa el rango completo del servicio, no la ocupación.
create or replace function private.overlaps_schedule_block(
  _tenant_id uuid,
  _barber_id uuid,
  _start_at  timestamptz,
  _end_at    timestamptz
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.schedule_blocks sb
    where sb.tenant_id = _tenant_id
      and (sb.barber_id = _barber_id or sb.barber_id is null)
      and sb.starts_at < _end_at
      and sb.ends_at   > _start_at
  );
$$;

comment on function private.overlaps_schedule_block(uuid, uuid, timestamptz, timestamptz) is
  'true si algún schedule_block del barbero o global se traslapa con [inicio, fin).';

-- 1.6 Citas activas del barbero cuya ocupación se traslapa con
--     [inicio, ocupado_hasta). Mismo predicado y estados que
--     appointments_no_overlap (puede usar su índice gist).
create or replace function private.overlaps_active_appointment(
  _tenant_id      uuid,
  _barber_id      uuid,
  _start_at       timestamptz,
  _occupied_until timestamptz
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.appointments a
    where a.tenant_id = _tenant_id
      and a.barber_id = _barber_id
      and a.status in ('pending'::public.appointment_status,
                       'confirmed'::public.appointment_status,
                       'completed'::public.appointment_status)
      and tstzrange(a.start_at, a.occupied_until, '[)')
          && tstzrange(_start_at, _occupied_until, '[)')
  );
$$;

comment on function private.overlaps_active_appointment(uuid, uuid, timestamptz, timestamptz) is
  'true si una cita pending/confirmed/completed del barbero ocupa parte de [inicio, ocupado_hasta). Mismo predicado que appointments_no_overlap.';

revoke all on function private.lock_barber_agenda(uuid)                                            from public, anon, authenticated;
revoke all on function private.resolve_booking_services(uuid, uuid[])                              from public, anon, authenticated;
revoke all on function private.within_business_hours(uuid, text, timestamptz, timestamptz)         from public, anon, authenticated;
revoke all on function private.within_barber_hours(uuid, uuid, text, timestamptz, timestamptz)     from public, anon, authenticated;
revoke all on function private.overlaps_schedule_block(uuid, uuid, timestamptz, timestamptz)       from public, anon, authenticated;
revoke all on function private.overlaps_active_appointment(uuid, uuid, timestamptz, timestamptz)   from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. get_available_slots (multi-servicio)
-- -----------------------------------------------------------------------------
create or replace function public.get_available_slots(
  _slug        text,
  _barber_id   uuid,
  _service_ids uuid[],
  _target_date date
)
returns table (slot_start timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _tenant_id  uuid;
  _tz         text;
  _duration   bigint;
  _length     interval;
  _day_start  timestamptz;
  _day_end    timestamptz;
  _earliest   timestamptz := now() + interval '15 minutes';
begin
  -- 1. Tenant activo
  select t.id, t.timezone into _tenant_id, _tz
  from public.tenants t
  where t.slug = _slug
    and t.status = 'active';

  if not found then
    raise exception 'Barbería no encontrada o inactiva'
      using errcode = 'P0002';
  end if;

  -- 2. Barbero del tenant, activo
  if not exists (
    select 1 from public.barbers b
    where b.id = _barber_id
      and b.tenant_id = _tenant_id
      and b.is_active = true
  ) then
    raise exception 'Barbero no encontrado o inactivo'
      using errcode = 'P0002';
  end if;

  -- 3. Servicios (valida la lista) y duración total
  select sum(r.duration_minutes) into _duration
  from private.resolve_booking_services(_tenant_id, _service_ids) as r;

  _length := pg_catalog.make_interval(mins => _duration::integer);

  -- 4. Día local del tenant
  _day_start := (_target_date::timestamp) at time zone _tz;
  _day_end   := ((_target_date + 1)::timestamp) at time zone _tz;

  -- 5. Candidatos cada 5 min desde la medianoche local, filtrados
  return query
  select gs.slot
  from pg_catalog.generate_series(
         _day_start,
         _day_end - interval '1 second',
         interval '5 minutes'
       ) as gs(slot)
  where gs.slot >= _earliest
    and private.within_business_hours(_tenant_id, _tz, gs.slot, gs.slot + _length)
    and private.within_barber_hours(_tenant_id, _barber_id, _tz, gs.slot, gs.slot + _length)
    and not private.overlaps_schedule_block(_tenant_id, _barber_id, gs.slot, gs.slot + _length)
    and not private.overlaps_active_appointment(
          _tenant_id, _barber_id, gs.slot,
          private.appointment_occupied_until(gs.slot, gs.slot + _length)
        )
  order by gs.slot;
end;
$$;

comment on function public.get_available_slots(text, uuid, uuid[], date) is
  'Slots disponibles (rejilla de 5 min, hora local del tenant) para un barbero y 1 a 5 servicios en una fecha. Usa la ocupación de las citas y 15 min de anticipación mínima.';

revoke all on function public.get_available_slots(text, uuid, uuid[], date) from public;
grant execute on function public.get_available_slots(text, uuid, uuid[], date) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. book_appointment (multi-servicio)
-- -----------------------------------------------------------------------------
-- Re-valida TODO (no confía en get_available_slots). Doble protección contra
-- doble reserva: revalidación bajo el lock de agenda + catch de 23P01.
-- El cliente se resuelve/crea por teléfono (nunca se acepta un client_id).
create or replace function public.book_appointment(
  _slug         text,
  _barber_id    uuid,
  _service_ids  uuid[],
  _start_at     timestamptz,
  _client_name  text,
  _client_phone text,
  _client_note  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _tenant_id      uuid;
  _tz             text;
  _duration       bigint;
  _end_at         timestamptz;
  _local_start    timestamp;
  _client_id      uuid;
  _appointment_id uuid;
  _services       jsonb;
  _total_price    bigint;
  _total_duration bigint;
begin
  -- ── Validación de entrada del cliente (igual que hoy) ──────────────────
  if _client_name is null or btrim(_client_name) = '' then
    raise exception 'El nombre del cliente es obligatorio'
      using errcode = 'check_violation';
  end if;

  _client_phone := private.normalize_phone_mx(_client_phone);

  if _client_phone is null then
    raise exception 'El teléfono debe tener 10 dígitos (ej: 55 1234 5678) o formato internacional (ej: +52 55 1234 5678)'
      using errcode = 'check_violation';
  end if;

  -- ── Tenant activo ──────────────────────────────────────────────────────
  select t.id, t.timezone into _tenant_id, _tz
  from public.tenants t
  where t.slug = _slug
    and t.status = 'active';

  if not found then
    raise exception 'Barbería no encontrada o inactiva'
      using errcode = 'P0002';
  end if;

  -- ── Barbero ────────────────────────────────────────────────────────────
  if not exists (
    select 1 from public.barbers b
    where b.id = _barber_id
      and b.tenant_id = _tenant_id
      and b.is_active = true
  ) then
    raise exception 'Barbero no encontrado o inactivo'
      using errcode = 'P0002';
  end if;

  -- ── Servicios: bloquear (FOR SHARE) y validar la lista ─────────────────
  -- El lock impide que el catálogo cambie (precio, duración, is_active) entre
  -- la validación y el INSERT de las líneas.
  perform 1
  from public.services s
  where s.tenant_id = _tenant_id
    and s.id = any (_service_ids)
  order by s.id
  for share of s;

  select sum(r.duration_minutes) into _duration
  from private.resolve_booking_services(_tenant_id, _service_ids) as r;

  _end_at := _start_at + pg_catalog.make_interval(mins => _duration::integer);

  -- ── Alineación a 5 minutos en hora local del tenant ────────────────────
  _local_start := _start_at at time zone _tz;
  if extract(minute from _local_start)::integer % 5 <> 0
     or extract(second from _local_start) <> 0 then
    raise exception 'El horario debe estar alineado a intervalos de 5 minutos'
      using errcode = 'check_violation';
  end if;

  -- ── Pasado y anticipación mínima pública (15 min) ──────────────────────
  if _start_at <= now() then
    raise exception 'No se puede reservar en el pasado'
      using errcode = 'check_violation';
  end if;

  if _start_at < now() + interval '15 minutes' then
    raise exception 'Las reservas en línea requieren al menos 15 minutos de anticipación'
      using errcode = 'check_violation';
  end if;

  -- ── Agenda del barbero: lock y revalidación ────────────────────────────
  perform private.lock_barber_agenda(_barber_id);

  if not private.within_business_hours(_tenant_id, _tz, _start_at, _end_at) then
    raise exception 'El horario está fuera del horario comercial'
      using errcode = 'check_violation';
  end if;

  if not private.within_barber_hours(_tenant_id, _barber_id, _tz, _start_at, _end_at) then
    raise exception 'El horario está fuera del horario del barbero'
      using errcode = 'check_violation';
  end if;

  if private.overlaps_schedule_block(_tenant_id, _barber_id, _start_at, _end_at) then
    raise exception 'El horario se traslapa con un bloqueo de agenda'
      using errcode = 'check_violation';
  end if;

  if private.overlaps_active_appointment(
       _tenant_id, _barber_id, _start_at,
       private.appointment_occupied_until(_start_at, _end_at)
     ) then
    raise exception 'El horario seleccionado ya no está disponible. Por favor selecciona otro.'
      using errcode = 'P0003';
  end if;

  -- ── Cliente por teléfono dentro del tenant (igual que hoy) ─────────────
  insert into public.clients (tenant_id, full_name, phone)
  values (_tenant_id, btrim(_client_name), _client_phone)
  on conflict (tenant_id, phone) where phone is not null and deleted_at is null
  do update set
    full_name  = excluded.full_name,
    updated_at = now()
  returning id into _client_id;

  -- ── Cita (occupied_until la calcula el trigger) ────────────────────────
  begin
    insert into public.appointments (
      tenant_id, barber_id, client_id,
      start_at, end_at,
      status, source, client_note,
      created_by
    ) values (
      _tenant_id, _barber_id, _client_id,
      _start_at, _end_at,
      'pending'::public.appointment_status,
      'online'::public.appointment_source,
      _client_note,
      null  -- reserva pública, sin usuario autenticado
    )
    returning id into _appointment_id;
  exception
    when exclusion_violation then
      -- 23P01: appointments_no_overlap (última barrera)
      raise exception 'El horario seleccionado ya no está disponible. Por favor selecciona otro.'
        using errcode = 'P0003';
  end;

  -- ── Líneas en el orden del arreglo ─────────────────────────────────────
  -- El trigger appointment_services_enforce_line vuelve a copiar el snapshot
  -- del catálogo (bloqueado FOR SHARE arriba) y fija la comisión en NULL.
  insert into public.appointment_services (
    tenant_id, appointment_id, service_id,
    service_name, price_cents, duration_minutes,
    commission_rate_bps, position
  )
  select _tenant_id, _appointment_id, r.service_id,
         r.service_name, r.price_cents, r.duration_minutes,
         null, r.line_position
  from private.resolve_booking_services(_tenant_id, _service_ids) as r
  order by r.line_position;

  -- ── Respuesta (desde lo guardado) ──────────────────────────────────────
  select jsonb_agg(
           jsonb_build_object(
             'id',               l.service_id,
             'name',             l.service_name,
             'price_cents',      l.price_cents,
             'duration_minutes', l.duration_minutes,
             'position',         l.position
           ) order by l.position
         ),
         sum(l.price_cents),
         sum(l.duration_minutes)
    into _services, _total_price, _total_duration
  from public.appointment_services l
  where l.tenant_id      = _tenant_id
    and l.appointment_id = _appointment_id;

  return jsonb_build_object(
    'appointment_id',         _appointment_id,
    'status',                 'pending',
    'barber_id',              _barber_id,
    'start_at',               _start_at,
    'end_at',                 _end_at,
    'services',               _services,
    'total_price_cents',      _total_price,
    'total_duration_minutes', _total_duration,
    'client', jsonb_build_object(
      'id',    _client_id,
      'name',  btrim(_client_name),
      'phone', _client_phone
    )
  );
end;
$$;

comment on function public.book_appointment(text, uuid, uuid[], timestamptz, text, text, text) is
  'Crea una cita pública (pending, online) con 1 a 5 servicios. Re-valida todo bajo un lock de agenda por barbero; 23P01 → P0003.';

revoke all on function public.book_appointment(text, uuid, uuid[], timestamptz, text, text, text) from public;
grant execute on function public.book_appointment(text, uuid, uuid[], timestamptz, text, text, text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. Firmas antiguas: envoltorios delgados (compatibilidad de transición)
-- -----------------------------------------------------------------------------
-- Misma firma, nombres y tipo de retorno que antes: CREATE OR REPLACE conserva
-- los privilegios (se reafirman abajo). _service_id NULL sigue respondiendo
-- P0002 como antes (la firma nueva respondería 23514 por "valor vacío").

-- 4.1 Slots en la rejilla antigua de 15 minutos locales. SECURITY DEFINER
--     solo para leer tenants.timezone (anon no tiene SELECT en tenants).
create or replace function public.get_available_slots(
  _slug        text,
  _barber_id   uuid,
  _service_id  uuid,
  _target_date date
)
returns table (slot_start timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if _service_id is null then
    raise exception 'Servicio no encontrado o inactivo'
      using errcode = 'P0002';
  end if;

  return query
  select s.slot_start
  from public.get_available_slots(_slug, _barber_id, array[_service_id], _target_date) as s
  join public.tenants t
    on t.slug = _slug
  where extract(minute from (s.slot_start at time zone t.timezone))::integer % 15 = 0
  order by s.slot_start;
end;
$$;

comment on function public.get_available_slots(text, uuid, uuid, date) is
  'COMPATIBILIDAD (Step 10.1): envoltorio de get_available_slots(…, uuid[], …) con un servicio, limitado a múltiplos de 15 min locales. Se eliminará cuando el frontend use la firma nueva.';

revoke all on function public.get_available_slots(text, uuid, uuid, date) from public;
grant execute on function public.get_available_slots(text, uuid, uuid, date) to anon, authenticated;

-- 4.2 Reserva con la forma de respuesta antigua. SECURITY INVOKER: no lee
--     tablas; la función nueva (DEFINER) hace todo el trabajo y anon /
--     authenticated tienen EXECUTE sobre ella.
create or replace function public.book_appointment(
  _slug         text,
  _barber_id    uuid,
  _service_id   uuid,
  _start_at     timestamptz,
  _client_name  text,
  _client_phone text,
  _client_note  text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  _r jsonb;
begin
  if _service_id is null then
    raise exception 'Servicio no encontrado o inactivo'
      using errcode = 'P0002';
  end if;

  _r := public.book_appointment(
    _slug, _barber_id, array[_service_id], _start_at,
    _client_name, _client_phone, _client_note
  );

  return (_r - 'services' - 'total_price_cents' - 'total_duration_minutes')
      || jsonb_build_object('service', (_r -> 'services' -> 0) - 'position');
end;
$$;

comment on function public.book_appointment(text, uuid, uuid, timestamptz, text, text, text) is
  'COMPATIBILIDAD (Step 10.1): envoltorio de book_appointment(…, uuid[], …) con un servicio; devuelve la forma antigua (objeto service). Se eliminará cuando el frontend use la firma nueva.';

revoke all on function public.book_appointment(text, uuid, uuid, timestamptz, text, text, text) from public;
grant execute on function public.book_appointment(text, uuid, uuid, timestamptz, text, text, text) to anon, authenticated;
