-- =============================================================================
-- Barberías SaaS — Migración 9: Reservas públicas y disponibilidad (Paso 3)
-- -----------------------------------------------------------------------------
-- Tres funciones SECURITY DEFINER en el esquema `public` que son la ÚNICA vía
-- por la que el rol `anon` accede a datos. No se crean políticas RLS para anon;
-- no se otorga SELECT sobre ninguna tabla.
--
-- 1. get_public_tenant(_slug)       → jsonb con info pública + barberos,
--                                     servicios y horarios activos.
-- 2. get_available_slots(...)       → TABLE(slot_start timestamptz) con slots
--                                     libres en pasos de 15 min.
-- 3. book_appointment(...)          → jsonb con confirmación de la cita creada.
--
-- Seguridad:
--   • SECURITY DEFINER + SET search_path = '' + referencias completamente
--     calificadas (public.*, pg_catalog.*).
--   • REVOKE ALL FROM public; GRANT EXECUTE solo a anon + authenticated.
--   • book_appointment: doble protección contra doble reserva (SELECT check +
--     catch de exclusion_violation 23P01 por la constraint existente).
--   • Nunca se confía en un client_id externo; el cliente se resuelve o crea
--     internamente por teléfono.
--
-- Disponibilidad dinámica (NO tabla de slots):
--   business_hours ∩ barber_working_hours − schedule_blocks − citas activas
--   en resolución de 15 minutos, respetando la duración del servicio.
--
-- Zona horaria:
--   Todas las conversiones usan tenants.timezone (IANA). Los horarios
--   recurrentes (time) se interpretan en esa zona. Los instantes son
--   timestamptz. Nunca se suman/restan horas manualmente.
-- =============================================================================

-- ============================================================================
-- 1. get_public_tenant — Información pública de la barbería
-- ============================================================================
-- Devuelve un JSON con datos del tenant, barberos activos, servicios activos
-- y horario comercial. NO expone: tenant_id interno, plan_code, status,
-- created_at, updated_at, user_ids, compensación, clientes, citas, membresías.
create or replace function public.get_public_tenant(_slug text)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  _tenant record;
  _result jsonb;
begin
  -- Resolver tenant activo por slug
  select id, name, slug, timezone, currency,
         address_line, city, state, postal_code,
         public_phone, logo_url, theme, site_content
  into _tenant
  from public.tenants
  where slug = _slug
    and status = 'active';

  if not found then
    raise exception 'Barbería no encontrada o inactiva'
      using errcode = 'P0002';
  end if;

  -- Construir respuesta con subobjetos anidados
  _result := jsonb_build_object(
    'name',          _tenant.name,
    'slug',          _tenant.slug,
    'timezone',      _tenant.timezone,
    'currency',      _tenant.currency,
    'address_line',  _tenant.address_line,
    'city',          _tenant.city,
    'state',         _tenant.state,
    'postal_code',   _tenant.postal_code,
    'public_phone',  _tenant.public_phone,
    'logo_url',      _tenant.logo_url,
    'theme',         _tenant.theme,
    'site_content',  _tenant.site_content,
    -- Barberos activos (perfil público, sin user_id ni compensación)
    'barbers', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id',           b.id,
          'display_name', b.display_name,
          'role_title',   b.role_title,
          'bio',          b.bio,
          'photo_url',    b.photo_url,
          'sort_order',   b.sort_order
        ) order by b.sort_order, b.display_name
      ), '[]'::jsonb)
      from public.barbers b
      where b.tenant_id = _tenant.id
        and b.is_active = true
    ),
    -- Servicios activos (catálogo público)
    'services', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id',               s.id,
          'name',             s.name,
          'description',      s.description,
          'price_cents',      s.price_cents,
          'duration_minutes', s.duration_minutes,
          'sort_order',       s.sort_order
        ) order by s.sort_order, s.name
      ), '[]'::jsonb)
      from public.services s
      where s.tenant_id = _tenant.id
        and s.is_active = true
    ),
    -- Horario comercial semanal (ISO: 1=lunes … 7=domingo)
    'business_hours', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'day_of_week', bh.day_of_week,
          'opens_at',    bh.opens_at,
          'closes_at',   bh.closes_at
        ) order by bh.day_of_week, bh.opens_at
      ), '[]'::jsonb)
      from public.business_hours bh
      where bh.tenant_id = _tenant.id
    )
  );

  return _result;
end;
$$;

comment on function public.get_public_tenant(text) is
  'Devuelve la información pública de una barbería por slug: datos generales, barberos activos, servicios activos y horario comercial.';

-- ============================================================================
-- 2. get_available_slots — Slots libres para un barbero, servicio y fecha
-- ============================================================================
-- Calcula dinámicamente la disponibilidad:
--   1. Intersección de business_hours y barber_working_hours para el día.
--   2. Generación de candidatos cada 15 min dentro de cada ventana efectiva.
--   3. Filtrado: schedule_blocks, citas activas (pending/confirmed/completed),
--      slots en el pasado, y que el servicio quepa entero en la ventana.
--
-- Los slots se generan desde medianoche local en pasos de 15 min reales,
-- garantizando alineación a cuartos de hora (:00, :15, :30, :45).
create or replace function public.get_available_slots(
  _slug        text,
  _barber_id   uuid,
  _service_id  uuid,
  _target_date date
)
returns table (slot_start timestamptz)
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  _tenant_id        uuid;
  _tz               text;
  _duration_minutes int;
  _iso_dow          int;
  _day_start        timestamptz;
  _day_end          timestamptz;
begin
  -- 1. Resolver tenant activo
  select t.id, t.timezone into _tenant_id, _tz
  from public.tenants t
  where t.slug = _slug
    and t.status = 'active';

  if not found then
    raise exception 'Barbería no encontrada o inactiva'
      using errcode = 'P0002';
  end if;

  -- 2. Validar barbero (pertenece al tenant, activo)
  if not exists (
    select 1 from public.barbers b
    where b.id = _barber_id
      and b.tenant_id = _tenant_id
      and b.is_active = true
  ) then
    raise exception 'Barbero no encontrado o inactivo'
      using errcode = 'P0002';
  end if;

  -- 3. Validar servicio y obtener duración
  select s.duration_minutes into _duration_minutes
  from public.services s
  where s.id = _service_id
    and s.tenant_id = _tenant_id
    and s.is_active = true;

  if not found then
    raise exception 'Servicio no encontrado o inactivo'
      using errcode = 'P0002';
  end if;

  -- 4. Límites del día en la zona horaria del tenant
  --    _target_date::timestamp da medianoche sin zona; AT TIME ZONE lo
  --    interpreta como hora local del tenant y devuelve el instante UTC.
  _day_start := (_target_date::timestamp) at time zone _tz;
  _day_end   := ((_target_date + 1)::timestamp) at time zone _tz;

  -- 5. Día de la semana ISO (1 = lunes … 7 = domingo)
  _iso_dow := extract(isodow from _target_date);

  -- 6. Generar y filtrar slots
  return query
  with
  -- Ventanas del horario comercial para este día, como timestamptz
  bh_windows as (
    select
      (_target_date + bh.opens_at)  at time zone _tz as win_start,
      (_target_date + bh.closes_at) at time zone _tz as win_end
    from public.business_hours bh
    where bh.tenant_id  = _tenant_id
      and bh.day_of_week = _iso_dow
  ),
  -- Ventanas del horario del barbero para este día
  bwh_windows as (
    select
      (_target_date + bwh.opens_at)  at time zone _tz as win_start,
      (_target_date + bwh.closes_at) at time zone _tz as win_end
    from public.barber_working_hours bwh
    where bwh.tenant_id  = _tenant_id
      and bwh.barber_id  = _barber_id
      and bwh.day_of_week = _iso_dow
  ),
  -- Intersección: ventanas efectivas donde el barbero puede trabajar
  effective_windows as (
    select
      greatest(bh.win_start, bwh.win_start) as win_start,
      least(bh.win_end, bwh.win_end)        as win_end
    from bh_windows bh
    cross join bwh_windows bwh
    where bh.win_start < bwh.win_end
      and bwh.win_start < bh.win_end
  ),
  -- Candidatos: cada 15 min desde medianoche local, filtrados a ventanas
  -- efectivas y acotados para que el servicio quepa entero.
  -- Usar medianoche garantiza alineación a :00, :15, :30, :45.
  all_quarter_hours as (
    select gs as slot
    from generate_series(
      _day_start,
      _day_end - interval '1 second',
      interval '15 minutes'
    ) as gs
  ),
  candidate_slots as (
    select aqh.slot
    from all_quarter_hours aqh
    where exists (
      select 1 from effective_windows ew
      where aqh.slot >= ew.win_start
        and aqh.slot + (_duration_minutes * interval '1 minute') <= ew.win_end
    )
  ),
  -- Bloqueos de agenda que tocan este día (del barbero o globales)
  blocks as (
    select sb.starts_at, sb.ends_at
    from public.schedule_blocks sb
    where sb.tenant_id = _tenant_id
      and (sb.barber_id = _barber_id or sb.barber_id is null)
      and sb.starts_at < _day_end
      and sb.ends_at   > _day_start
  ),
  -- Citas activas del barbero que tocan este día
  active_appts as (
    select a.start_at, a.end_at
    from public.appointments a
    where a.tenant_id = _tenant_id
      and a.barber_id = _barber_id
      and a.status in ('pending'::public.appointment_status,
                        'confirmed'::public.appointment_status,
                        'completed'::public.appointment_status)
      and a.start_at < _day_end
      and a.end_at   > _day_start
  )
  select cs.slot as slot_start
  from candidate_slots cs
  where
    -- No en el pasado
    cs.slot > now()
    -- Sin traslape con bloqueos de agenda
    and not exists (
      select 1 from blocks bl
      where bl.starts_at < cs.slot + (_duration_minutes * interval '1 minute')
        and bl.ends_at   > cs.slot
    )
    -- Sin traslape con citas activas
    and not exists (
      select 1 from active_appts ap
      where ap.start_at < cs.slot + (_duration_minutes * interval '1 minute')
        and ap.end_at   > cs.slot
    )
  order by cs.slot;
end;
$$;

comment on function public.get_available_slots(text, uuid, uuid, date) is
  'Devuelve los slots disponibles (timestamptz) para un barbero y servicio en una fecha. Resolución: 15 min. Disponibilidad dinámica.';

-- ============================================================================
-- 3. book_appointment — Crear una cita pública
-- ============================================================================
-- Re-valida TODOS los parámetros (no confía en get_available_slots).
-- Doble protección contra doble reserva:
--   a) SELECT check de citas activas (mensaje amigable inmediato).
--   b) Catch de exclusion_violation (23P01) en el INSERT (concurrencia).
-- El cliente se resuelve/crea internamente por teléfono — nunca se acepta
-- un client_id enviado por el usuario anónimo.
-- La cita entra como pending + source = online + created_by = null.
-- appointment_services copia nombre, precio y duración del servicio vigente.
-- commission_rate_bps queda null (se copia al completar con trigger futuro).
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

  if _client_phone is null or _client_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'El teléfono debe estar en formato E.164 (ej: +525512345678)'
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

-- ============================================================================
-- 4. Grants — Solo ejecución para anon y authenticated
-- ============================================================================
-- Revocar el permiso por defecto otorgado a public (que incluye a todos).
revoke all on function public.get_public_tenant(text) from public;
revoke all on function public.get_available_slots(text, uuid, uuid, date) from public;
revoke all on function public.book_appointment(text, uuid, uuid, timestamptz, text, text, text) from public;

-- Otorgar EXECUTE solo a los roles que lo necesitan.
-- anon: visitante del sitio público.
-- authenticated: admin/barbero que también puede ver la vista pública o reservar.
grant execute on function public.get_public_tenant(text) to anon, authenticated;
grant execute on function public.get_available_slots(text, uuid, uuid, date) to anon, authenticated;
grant execute on function public.book_appointment(text, uuid, uuid, timestamptz, text, text, text) to anon, authenticated;
