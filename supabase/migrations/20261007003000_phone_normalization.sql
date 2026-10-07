-- =============================================================================
-- Barberías SaaS — Migración 12: normalización del teléfono en la reserva
-- -----------------------------------------------------------------------------
-- Problema: el formulario público sugiere "+52 55 1234 5678", pero
-- book_appointment exigía E.164 exacto (^\+[1-9][0-9]{7,14}$) y rechazaba
-- espacios, guiones y números de 10 dígitos sin "+52".
--
-- Solución (server-side, sin cambiar el modelo de clients):
--   1. private.normalize_phone_mx(text) → E.164 o NULL.
--   2. book_appointment normaliza antes de validar. El resto de la función es
--      idéntico a la migración 9 (public_booking_functions).
--
-- Reglas (el formato destino sigue siendo E.164, definido por
-- clients_phone_e164; no se inventa otro):
--   * se eliminan espacios, guiones, puntos y paréntesis;
--   * "+<7..15 dígitos>"      → sin cambios (ya E.164, de cualquier país);
--   * "<10 dígitos>"          → "+52" + dígitos (número mexicano);
--   * "52" + <10 dígitos>     → "+52" + dígitos;
--   * cualquier otra cosa     → NULL (la reserva se rechaza con mensaje claro).
-- Los teléfonos ya guardados cumplen E.164 por constraint: no se tocan.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. private.normalize_phone_mx
-- -----------------------------------------------------------------------------
create or replace function private.normalize_phone_mx(_raw text)
returns text
language sql
immutable
set search_path = ''
as $$
  with cleaned as (
    select regexp_replace(btrim(coalesce(_raw, '')), '[[:space:]().-]', '', 'g') as v
  )
  select case
    when v ~ '^\+[1-9][0-9]{7,14}$' then v
    when v ~ '^[0-9]{10}$'          then '+52' || v
    when v ~ '^52[0-9]{10}$'        then '+' || v
    else null
  end
  from cleaned;
$$;

comment on function private.normalize_phone_mx(text) is
  'Normaliza un teléfono a E.164. 10 dígitos → +52. Devuelve NULL si no se puede normalizar.';

revoke all on function private.normalize_phone_mx(text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. book_appointment — idéntica a la migración 9 salvo el bloque del teléfono
-- -----------------------------------------------------------------------------
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
security definer
set search_path = ''
as $$
declare
  _tenant_id      uuid;
  _tz             text;
  _service        record;
  _end_at         timestamptz;
  _local_start    timestamp;
  _target_date    date;
  _iso_dow        int;
  _client_id      uuid;
  _appointment_id uuid;
begin
  -- ── Validación de entrada del cliente ──────────────────────────────────
  if _client_name is null or btrim(_client_name) = '' then
    raise exception 'El nombre del cliente es obligatorio'
      using errcode = 'check_violation';
  end if;

  -- Normalización server-side: acepta espacios, guiones, puntos, paréntesis,
  -- 10 dígitos mexicanos y "52" sin "+". El resultado es E.164 (lo que exige
  -- clients_phone_e164). Un valor ya en E.164 no se modifica.
  _client_phone := private.normalize_phone_mx(_client_phone);

  if _client_phone is null then
    raise exception 'El teléfono debe tener 10 dígitos (ej: 55 1234 5678) o formato internacional (ej: +52 55 1234 5678)'
      using errcode = 'check_violation';
  end if;

  -- ── Resolver tenant activo ─────────────────────────────────────────────
  select t.id, t.timezone into _tenant_id, _tz
  from public.tenants t
  where t.slug = _slug
    and t.status = 'active';

  if not found then
    raise exception 'Barbería no encontrada o inactiva'
      using errcode = 'P0002';
  end if;

  -- ── Validar barbero ────────────────────────────────────────────────────
  if not exists (
    select 1 from public.barbers b
    where b.id = _barber_id
      and b.tenant_id = _tenant_id
      and b.is_active = true
  ) then
    raise exception 'Barbero no encontrado o inactivo'
      using errcode = 'P0002';
  end if;

  -- ── Validar servicio y obtener detalles ────────────────────────────────
  select s.name, s.price_cents, s.duration_minutes
  into _service
  from public.services s
  where s.id = _service_id
    and s.tenant_id = _tenant_id
    and s.is_active = true;

  if not found then
    raise exception 'Servicio no encontrado o inactivo'
      using errcode = 'P0002';
  end if;

  -- ── Calcular hora de fin ───────────────────────────────────────────────
  _end_at := _start_at + (_service.duration_minutes * interval '1 minute');

  -- ── Validar alineación a 15 minutos en hora local del tenant ───────────
  _local_start := _start_at at time zone _tz;
  if extract(minute from _local_start)::int % 15 != 0
     or extract(second from _local_start) != 0 then
    raise exception 'El horario debe estar alineado a intervalos de 15 minutos'
      using errcode = 'check_violation';
  end if;

  -- ── Validar que no esté en el pasado ───────────────────────────────────
  if _start_at <= now() then
    raise exception 'No se puede reservar en el pasado'
      using errcode = 'check_violation';
  end if;

  -- ── Derivar fecha local y día de semana ISO ────────────────────────────
  _target_date := _local_start::date;
  _iso_dow     := extract(isodow from _target_date);

  -- ── Validar dentro del horario comercial ───────────────────────────────
  -- La cita completa [_start_at, _end_at] debe caber dentro de una ventana.
  if not exists (
    select 1 from public.business_hours bh
    where bh.tenant_id   = _tenant_id
      and bh.day_of_week = _iso_dow
      and (_target_date + bh.opens_at)  at time zone _tz <= _start_at
      and (_target_date + bh.closes_at) at time zone _tz >= _end_at
  ) then
    raise exception 'El horario está fuera del horario comercial'
      using errcode = 'check_violation';
  end if;

  -- ── Validar dentro del horario del barbero ─────────────────────────────
  if not exists (
    select 1 from public.barber_working_hours bwh
    where bwh.tenant_id   = _tenant_id
      and bwh.barber_id   = _barber_id
      and bwh.day_of_week = _iso_dow
      and (_target_date + bwh.opens_at)  at time zone _tz <= _start_at
      and (_target_date + bwh.closes_at) at time zone _tz >= _end_at
  ) then
    raise exception 'El horario está fuera del horario del barbero'
      using errcode = 'check_violation';
  end if;

  -- ── Validar sin traslape con bloqueos de agenda ────────────────────────
  if exists (
    select 1 from public.schedule_blocks sb
    where sb.tenant_id = _tenant_id
      and (sb.barber_id = _barber_id or sb.barber_id is null)
      and sb.starts_at < _end_at
      and sb.ends_at   > _start_at
  ) then
    raise exception 'El horario se traslapa con un bloqueo de agenda'
      using errcode = 'check_violation';
  end if;

  -- ── Validar sin traslape con citas activas (check pre-INSERT) ──────────
  if exists (
    select 1 from public.appointments a
    where a.tenant_id = _tenant_id
      and a.barber_id = _barber_id
      and a.status in ('pending'::public.appointment_status,
                        'confirmed'::public.appointment_status,
                        'completed'::public.appointment_status)
      and a.start_at < _end_at
      and a.end_at   > _start_at
  ) then
    raise exception 'El horario seleccionado ya no está disponible. Por favor selecciona otro.'
      using errcode = 'P0003';
  end if;

  -- ── Upsert del cliente por teléfono dentro del tenant ──────────────────
  -- Si el teléfono ya existe (y no está anonimizado), actualiza el nombre.
  -- Si es nuevo o estaba anonimizado (deleted_at no-null), crea una fila.
  insert into public.clients (tenant_id, full_name, phone)
  values (_tenant_id, btrim(_client_name), _client_phone)
  on conflict (tenant_id, phone) where phone is not null and deleted_at is null
  do update set
    full_name  = excluded.full_name,
    updated_at = now()
  returning id into _client_id;

  -- ── Insertar cita (con protección de exclusion_violation) ──────────────
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
      -- 23P01: la constraint appointments_no_overlap detectó concurrencia
      raise exception 'El horario seleccionado ya no está disponible. Por favor selecciona otro.'
        using errcode = 'P0003';
  end;

  -- ── Insertar línea del servicio con snapshot ───────────────────────────
  -- Se copia nombre, precio y duración vigentes. commission_rate_bps queda
  -- null; un trigger futuro lo copiará al completar la cita.
  insert into public.appointment_services (
    tenant_id, appointment_id, service_id,
    service_name, price_cents, duration_minutes,
    commission_rate_bps, position
  ) values (
    _tenant_id, _appointment_id, _service_id,
    _service.name, _service.price_cents, _service.duration_minutes,
    null,  -- se copia al completar (trigger futuro)
    0
  );

  -- ── Respuesta de confirmación ──────────────────────────────────────────
  return jsonb_build_object(
    'appointment_id', _appointment_id,
    'status',         'pending',
    'barber_id',      _barber_id,
    'service', jsonb_build_object(
      'id',               _service_id,
      'name',             _service.name,
      'price_cents',      _service.price_cents,
      'duration_minutes', _service.duration_minutes
    ),
    'start_at', _start_at,
    'end_at',   _end_at,
    'client', jsonb_build_object(
      'id',    _client_id,
      'name',  btrim(_client_name),
      'phone', _client_phone
    )
  );
end;
$$;

comment on function public.book_appointment(text, uuid, uuid, timestamptz, text, text, text) is
  'Crea una cita pública (pending, online). Re-valida todo. Doble protección contra doble reserva.';

-- Privilegios sin cambios (CREATE OR REPLACE los conserva); se reafirman.
revoke all on function public.book_appointment(text, uuid, uuid, timestamptz, text, text, text) from public;
grant execute on function public.book_appointment(text, uuid, uuid, timestamptz, text, text, text) to anon, authenticated;
