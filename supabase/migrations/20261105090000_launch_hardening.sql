-- =============================================================================
-- Step 16 — Blindaje para el lanzamiento
-- -----------------------------------------------------------------------------
-- 1. Elimina las firmas viejas (_service_id uuid) de get_available_slots y
--    book_appointment: la app ya no las usa y seguían expuestas a anon.
-- 2. book_appointment: máximo 3 citas futuras activas por cliente (BA013) y
--    límites de longitud (nombre 120, nota 500). Solo aplica a la reserva
--    pública; walk-ins y movimientos del personal no tienen este límite.
-- =============================================================================

drop function public.get_available_slots(text, uuid, uuid, date);
drop function public.book_appointment(text, uuid, uuid, timestamptz, text, text, text);

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
  _active         integer;
begin
  -- ── Validación de entrada del cliente (igual que hoy) ──────────────────
  if _client_name is null or btrim(_client_name) = '' then
    raise exception 'El nombre del cliente es obligatorio'
      using errcode = 'check_violation';
  end if;

  if char_length(btrim(_client_name)) > 120 then
    raise exception 'El nombre no puede superar 120 caracteres'
      using errcode = 'check_violation';
  end if;

  if char_length(coalesce(_client_note, '')) > 500 then
    raise exception 'La nota no puede superar 500 caracteres'
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

  -- ── Anti-spam: máximo 3 citas futuras activas por cliente ──────────────
  -- El lock por cliente evita que dos reservas simultáneas (con barberos
  -- distintos, que no comparten lock de agenda) pasen el límite juntas.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('online-booking:' || _client_id::text, 0));

  select count(*) into _active
  from public.appointments a
  where a.tenant_id = _tenant_id
    and a.client_id = _client_id
    and a.status in ('pending', 'confirmed')
    and a.start_at >= now();

  if _active >= 3 then
    raise exception 'Ya tienes 3 citas próximas en esta barbería'
      using errcode = 'BA013';
  end if;

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
  'Reserva pública: 1 a 5 servicios, máximo 3 citas futuras activas por cliente (BA013).';

revoke all on function public.book_appointment(text, uuid, uuid[], timestamptz, text, text, text) from public;
grant execute on function public.book_appointment(text, uuid, uuid[], timestamptz, text, text, text) to anon, authenticated;
