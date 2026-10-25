-- =============================================================================
-- Barberías SaaS — Migración 18: walk-ins (Step 10.3)
-- -----------------------------------------------------------------------------
-- Citas creadas por el personal desde el dashboard. Reglas de producto
-- (confirmadas por Eduardo):
--   * nace `confirmed`, `source = walk_in`, `created_by` = quien la registra;
--   * hora exacta (sin rejilla), cualquier hora de HOY en tenants.timezone;
--   * 1 a 5 servicios sin repetir (mismas reglas que la reserva pública);
--   * admin → cualquier barbero activo de su barbería; barbero → solo él;
--   * traslape con otra cita, fuera del horario del local o del barbero, o en
--     un bloqueo de agenda: AVISO; el personal decide confirmar. Nunca se
--     mueve ni se cancela otra cita;
--   * cliente por teléfono: si existe, se CONSERVA su nombre guardado.
--
-- Contenido:
--   1. appointments.overrides / overrides_at / overrides_by: avisos aceptados
--      (auditoría). Inmutables para todos.
--   2. enforce_appointment_status_transition: + los tres campos (versión
--      vigente de la migración 20261008193500, sin otros cambios).
--   3. appointments_no_overlap: excluye solo las citas cuyo traslape fue
--      aceptado expresamente ('overlap' en overrides).
--   4. private.walk_in_tenant: barbería y permiso del barbero objetivo.
--   5. public.find_client_by_phone: "Cliente existente: …" en el formulario.
--   6. public.create_walk_in.
--
-- La reserva pública sigue estricta: private.overlaps_active_appointment no
-- filtra overrides, así que book_appointment nunca reserva encima de un
-- walk-in aceptado. Como esas filas quedan fuera de la exclusión, toda función
-- que cree o mueva citas DEBE tomar private.lock_barber_agenda antes de
-- revalidar (book_appointment y create_walk_in lo hacen).
--
-- Errores: P0002 barbero inexistente, inactivo o sin permiso (sin distinguir) ·
-- 42501 sin sesión · 23514 validación (día, nombre, teléfono, nota, servicios) ·
-- BA007 necesita confirmación (detail = JSON con warnings y conflicts) ·
-- P0003 la agenda cambió mientras tanto.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Avisos aceptados por el personal
-- -----------------------------------------------------------------------------
alter table public.appointments
  add column overrides    text[]      not null default '{}',
  add column overrides_at timestamptz,
  add column overrides_by uuid        references auth.users (id) on delete set null;

alter table public.appointments
  add constraint appointments_overrides_valid check (
    overrides <@ array['overlap', 'outside_business_hours', 'outside_barber_hours', 'schedule_block']::text[]
  ),
  add constraint appointments_overrides_consistency check (
    (pg_catalog.cardinality(overrides) = 0) = (overrides_at is null)
  ),
  add constraint appointments_overrides_by_requires_at check (
    overrides_at is not null or overrides_by is null
  );

comment on column public.appointments.overrides is
  'Avisos que el personal aceptó al registrar la cita (walk-in): overlap, outside_business_hours, outside_barber_hours, schedule_block. Vacío = ninguno. Inmutable.';
comment on column public.appointments.overrides_at is
  'Cuándo se aceptaron los avisos (NULL si no hubo). Inmutable.';
comment on column public.appointments.overrides_by is
  'Quién aceptó los avisos. Inmutable (solo pasa a NULL si se borra la cuenta).';

-- -----------------------------------------------------------------------------
-- 2. Inmutabilidad: + overrides, overrides_at, overrides_by
-- -----------------------------------------------------------------------------
-- Idéntica a la versión de la migración 20261008193500 salvo tres ramas nuevas
-- en el bloque 1.
create or replace function private.enforce_appointment_status_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  -- > 1 = la actualización la origina otro trigger (p. ej. ON DELETE SET NULL
  -- de una llave foránea), no un usuario.
  _nested boolean := pg_trigger_depth() > 1;
  _field  text;
begin
  -- 1. Campos inmutables para cualquier rol.
  if    new.id         is distinct from old.id         then _field := 'id';
  elsif new.tenant_id  is distinct from old.tenant_id  then _field := 'tenant_id';
  elsif new.source     is distinct from old.source     then _field := 'source';
  elsif new.created_at is distinct from old.created_at then _field := 'created_at';
  elsif new.created_by is distinct from old.created_by
        and not (_nested and new.created_by is null)  then _field := 'created_by';
  elsif new.completed_at is distinct from old.completed_at then _field := 'completed_at';
  elsif new.cancelled_at is distinct from old.cancelled_at then _field := 'cancelled_at';
  elsif new.cancelled_by is distinct from old.cancelled_by
        and not (_nested and new.cancelled_by is null) then _field := 'cancelled_by';
  elsif new.occupied_until is distinct from old.occupied_until then _field := 'occupied_until';
  elsif new.overrides    is distinct from old.overrides    then _field := 'overrides';
  elsif new.overrides_at is distinct from old.overrides_at then _field := 'overrides_at';
  elsif new.overrides_by is distinct from old.overrides_by
        and not (_nested and new.overrides_by is null) then _field := 'overrides_by';
  end if;

  if _field is not null then
    raise exception 'El campo % de una cita no se puede modificar directamente', _field
      using errcode = '42501';
  end if;

  -- 2. Sin cambio de estado: el motivo de cancelación tampoco cambia.
  if new.status is not distinct from old.status then
    if new.cancellation_reason is distinct from old.cancellation_reason then
      raise exception 'El motivo de cancelación no se puede modificar'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- 3. Transiciones permitidas (sin cambios respecto al Step 9).
  if not (
       (old.status = 'pending'::public.appointment_status
          and new.status in ('confirmed'::public.appointment_status,
                             'cancelled'::public.appointment_status,
                             'no_show'::public.appointment_status))
    or (old.status = 'confirmed'::public.appointment_status
          and new.status in ('completed'::public.appointment_status,
                             'cancelled'::public.appointment_status,
                             'no_show'::public.appointment_status))
  ) then
    raise exception 'Transición de estado no permitida: % → %', old.status, new.status
      using errcode = 'BA001';
  end if;

  -- 4. Efectos de la transición. Las marcas las fija el servidor.
  if new.status = 'cancelled'::public.appointment_status then
    new.cancellation_reason := nullif(btrim(coalesce(new.cancellation_reason, ''), E' \t\r\n'), '');
    if new.cancellation_reason is null then
      raise exception 'Indica el motivo de la cancelación'
        using errcode = 'BA002';
    end if;
    if char_length(new.cancellation_reason) > 500 then
      raise exception 'El motivo de la cancelación es demasiado largo (máximo 500 caracteres)'
        using errcode = 'BA002';
    end if;
    new.cancelled_at := now();
    new.cancelled_by := (select auth.uid());
  else
    if new.cancellation_reason is distinct from old.cancellation_reason then
      raise exception 'El motivo de cancelación solo se registra al cancelar'
        using errcode = '42501';
    end if;
    if new.status = 'completed'::public.appointment_status then
      new.completed_at := now();
    end if;
  end if;

  return new;
end;
$$;

comment on function private.enforce_appointment_status_transition() is
  'Transiciones de appointments.status, motivo obligatorio al cancelar, auditoría inmutable (id, tenant_id, source, created_*, completed_at, cancelled_*, occupied_until, overrides*).';

revoke all on function private.enforce_appointment_status_transition() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Exclusión: fuera solo las citas con traslape aceptado
-- -----------------------------------------------------------------------------
-- Crear la nueva → borrar la anterior → renombrar: la tabla nunca queda sin
-- protección. Los datos existentes tienen overrides = '{}', así que la nueva
-- exclusión es la misma regla que la anterior para ellos.
alter table public.appointments
  add constraint appointments_no_overlap_walk_ins
  exclude using gist (
    barber_id with =,
    tstzrange(start_at, occupied_until, '[)') with &&
  )
  where (
    status in ('pending', 'confirmed', 'completed')
    and not ('overlap' = any (overrides))
  );

alter table public.appointments
  drop constraint appointments_no_overlap;

alter table public.appointments
  rename constraint appointments_no_overlap_walk_ins to appointments_no_overlap;

comment on constraint appointments_no_overlap on public.appointments is
  'Sin doble reserva: un barbero no puede tener dos citas pending/confirmed/completed cuyos rangos [start_at, occupied_until) se traslapen. Excepción: citas cuyo traslape aceptó el personal (overlap en overrides); las funciones que crean citas lo revalidan bajo lock.';

-- -----------------------------------------------------------------------------
-- 4. Barbería y permiso sobre el barbero objetivo
-- -----------------------------------------------------------------------------
-- Admin de la barbería del barbero, o el propio barbero. Barbero inexistente,
-- inactivo, de una barbería suspendida o sin permiso → P0002 (sin distinguir,
-- para no revelar barberos de otras barberías).
create or replace function private.walk_in_tenant(_barber_id uuid)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  _tenant_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Inicia sesión para registrar un walk-in'
      using errcode = '42501';
  end if;

  select b.tenant_id into _tenant_id
  from public.barbers b
  join public.tenants t on t.id = b.tenant_id
  where b.id = _barber_id
    and b.is_active = true
    and t.status = 'active';

  if not found or not (
       (select private.is_admin(_tenant_id))
    or coalesce(_barber_id = (select private.my_barber_id(_tenant_id)), false)
  ) then
    raise exception 'Barbero no encontrado o inactivo'
      using errcode = 'P0002';
  end if;

  return _tenant_id;
end;
$$;

comment on function private.walk_in_tenant(uuid) is
  'Barbería del barbero objetivo si quien llama es admin de esa barbería o el propio barbero (activo); si no, P0002.';

revoke all on function private.walk_in_tenant(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. Buscar cliente por teléfono (formulario de walk-in)
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER solo para poder normalizar el teléfono (normalize_phone_mx
-- es interna). No amplía acceso: la RLS de clients ya permite a cualquier
-- miembro leer los clientes de su barbería (pendiente conocido de CLAUDE.md).
create or replace function public.find_client_by_phone(
  _barber_id uuid,
  _phone     text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _tenant_id uuid := private.walk_in_tenant(_barber_id);
  _normal    text := private.normalize_phone_mx(_phone);
  _client    record;
begin
  if _normal is null then
    return jsonb_build_object('valid', false);
  end if;

  select c.id, c.full_name into _client
  from public.clients c
  where c.tenant_id = _tenant_id
    and c.phone = _normal
    and c.deleted_at is null;

  return jsonb_build_object(
    'valid',  true,
    'phone',  _normal,
    'client', case when found
                then jsonb_build_object('id', _client.id, 'name', _client.full_name)
              end
  );
end;
$$;

comment on function public.find_client_by_phone(uuid, text) is
  'Para el formulario de walk-in: normaliza el teléfono y devuelve el cliente existente de la barbería del barbero (si quien llama puede registrar walk-ins para ese barbero).';

revoke all on function public.find_client_by_phone(uuid, text) from public, anon;
grant execute on function public.find_client_by_phone(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. create_walk_in
-- -----------------------------------------------------------------------------
create or replace function public.create_walk_in(
  _barber_id            uuid,
  _service_ids          uuid[],
  _start_at             timestamptz,
  _client_name          text,
  _client_phone         text,
  _client_note          text    default null,
  _acknowledge_warnings boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid            uuid := (select auth.uid());
  _tenant_id      uuid;
  _tz             text;
  _start          timestamptz;
  _duration       bigint;
  _end_at         timestamptz;
  _occupied_until timestamptz;
  _name           text := btrim(coalesce(_client_name, ''));
  _phone          text;
  _note           text := nullif(btrim(coalesce(_client_note, '')), '');
  _warnings       text[] := '{}';
  _conflicts      jsonb;
  _client_id      uuid;
  _client_name_db text;
  _existing       boolean := true;
  _appointment_id uuid;
  _services       jsonb;
  _total_price    bigint;
  _total_duration bigint;
begin
  -- ── Barbería y permiso (P0002 / 42501) ─────────────────────────────────
  _tenant_id := private.walk_in_tenant(_barber_id);

  select t.timezone into _tz from public.tenants t where t.id = _tenant_id;

  -- ── Datos del cliente ──────────────────────────────────────────────────
  if _name = '' then
    raise exception 'El nombre del cliente es obligatorio'
      using errcode = 'check_violation';
  end if;
  if char_length(_name) > 120 then
    raise exception 'El nombre del cliente es demasiado largo (máximo 120 caracteres)'
      using errcode = 'check_violation';
  end if;

  _phone := private.normalize_phone_mx(_client_phone);
  if _phone is null then
    raise exception 'El teléfono debe tener 10 dígitos (ej: 55 1234 5678) o formato internacional (ej: +52 55 1234 5678)'
      using errcode = 'check_violation';
  end if;

  if char_length(_note) > 500 then
    raise exception 'La nota es demasiado larga (máximo 500 caracteres)'
      using errcode = 'check_violation';
  end if;

  -- ── Hora: exacta al minuto y solo HOY en la zona de la barbería ────────
  if _start_at is null then
    raise exception 'Indica la hora del walk-in'
      using errcode = 'check_violation';
  end if;
  _start := pg_catalog.date_trunc('minute', _start_at);
  if (_start at time zone _tz)::date <> (now() at time zone _tz)::date then
    raise exception 'Solo puedes registrar walk-ins del día de hoy'
      using errcode = 'check_violation';
  end if;

  -- ── Servicios (mismo orden de locks que book_appointment) ──────────────
  perform 1
  from public.services s
  where s.tenant_id = _tenant_id
    and s.id = any (_service_ids)
  order by s.id
  for share of s;

  select sum(r.duration_minutes) into _duration
  from private.resolve_booking_services(_tenant_id, _service_ids) as r;

  _end_at         := _start + pg_catalog.make_interval(mins => _duration::integer);
  _occupied_until := private.appointment_occupied_until(_start, _end_at);

  -- ── Agenda del barbero bloqueada antes de revalidar ────────────────────
  perform private.lock_barber_agenda(_barber_id);

  if not private.within_business_hours(_tenant_id, _tz, _start, _end_at) then
    _warnings := _warnings || 'outside_business_hours'::text;
  end if;
  if not private.within_barber_hours(_tenant_id, _barber_id, _tz, _start, _end_at) then
    _warnings := _warnings || 'outside_barber_hours'::text;
  end if;
  if private.overlaps_schedule_block(_tenant_id, _barber_id, _start, _end_at) then
    _warnings := _warnings || 'schedule_block'::text;
  end if;
  if private.overlaps_active_appointment(_tenant_id, _barber_id, _start, _occupied_until) then
    _warnings := _warnings || 'overlap'::text;
  end if;

  if pg_catalog.cardinality(_warnings) > 0 and not coalesce(_acknowledge_warnings, false) then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id',          a.id,
             'start_at',    a.start_at,
             'end_at',      a.end_at,
             'status',      a.status,
             'source',      a.source,
             'client_name', c.full_name
           ) order by a.start_at), '[]'::jsonb)
      into _conflicts
    from public.appointments a
    join public.clients c
      on c.tenant_id = a.tenant_id
     and c.id = a.client_id
    where a.tenant_id = _tenant_id
      and a.barber_id = _barber_id
      and a.status in ('pending'::public.appointment_status,
                       'confirmed'::public.appointment_status,
                       'completed'::public.appointment_status)
      and tstzrange(a.start_at, a.occupied_until, '[)')
          && tstzrange(_start, _occupied_until, '[)');

    raise exception 'Este walk-in necesita tu confirmación'
      using errcode = 'BA007',
            detail  = jsonb_build_object('warnings', _warnings, 'conflicts', _conflicts)::text;
  end if;

  -- ── Cliente: el existente conserva su nombre ───────────────────────────
  select c.id, c.full_name into _client_id, _client_name_db
  from public.clients c
  where c.tenant_id = _tenant_id
    and c.phone = _phone
    and c.deleted_at is null;

  if not found then
    insert into public.clients (tenant_id, full_name, phone, created_by)
    values (_tenant_id, _name, _phone, _uid)
    on conflict (tenant_id, phone) where phone is not null and deleted_at is null
    do nothing
    returning id, full_name into _client_id, _client_name_db;

    if _client_id is null then
      -- Lo creó otra transacción en este instante: se usa ese registro.
      select c.id, c.full_name into _client_id, _client_name_db
      from public.clients c
      where c.tenant_id = _tenant_id
        and c.phone = _phone
        and c.deleted_at is null;
    else
      _existing := false;
    end if;
  end if;

  -- ── Cita ───────────────────────────────────────────────────────────────
  begin
    insert into public.appointments (
      tenant_id, barber_id, client_id,
      start_at, end_at,
      status, source, client_note,
      created_by,
      overrides, overrides_at, overrides_by
    ) values (
      _tenant_id, _barber_id, _client_id,
      _start, _end_at,
      'confirmed'::public.appointment_status,
      'walk_in'::public.appointment_source,
      _note,
      _uid,
      _warnings,
      case when pg_catalog.cardinality(_warnings) > 0 then now() end,
      case when pg_catalog.cardinality(_warnings) > 0 then _uid end
    )
    returning id into _appointment_id;
  exception
    when exclusion_violation then
      raise exception 'La agenda cambió mientras tanto. Revisa el horario e intenta de nuevo.'
        using errcode = 'P0003';
  end;

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

  select jsonb_agg(jsonb_build_object(
           'id',               l.service_id,
           'name',             l.service_name,
           'price_cents',      l.price_cents,
           'duration_minutes', l.duration_minutes,
           'position',         l.position
         ) order by l.position),
         sum(l.price_cents),
         sum(l.duration_minutes)
    into _services, _total_price, _total_duration
  from public.appointment_services l
  where l.tenant_id      = _tenant_id
    and l.appointment_id = _appointment_id;

  return jsonb_build_object(
    'appointment_id',         _appointment_id,
    'status',                 'confirmed',
    'source',                 'walk_in',
    'barber_id',              _barber_id,
    'start_at',               _start,
    'end_at',                 _end_at,
    'services',               _services,
    'total_price_cents',      _total_price,
    'total_duration_minutes', _total_duration,
    'overrides',              to_jsonb(_warnings),
    'client', jsonb_build_object(
      'id',       _client_id,
      'name',     _client_name_db,
      'phone',    _phone,
      'existing', _existing
    )
  );
end;
$$;

comment on function public.create_walk_in(uuid, uuid[], timestamptz, text, text, text, boolean) is
  'Walk-in del personal: confirmed, hora exacta de hoy, 1 a 5 servicios. Avisos (traslape, fuera de horario, bloqueo) → BA007 con detalle, salvo _acknowledge_warnings. Lock de agenda por barbero.';

revoke all on function public.create_walk_in(uuid, uuid[], timestamptz, text, text, text, boolean) from public, anon;
grant execute on function public.create_walk_in(uuid, uuid[], timestamptz, text, text, text, boolean) to authenticated;
