-- =============================================================================
-- Barberías SaaS — Migración 19: mover citas (Step 11)
-- -----------------------------------------------------------------------------
-- Reprogramar (hora y fecha), reasignar (otro barbero) y cambiar servicios de
-- una cita, en una sola operación. Reglas de producto (Eduardo):
--   * admin → cualquier cita de su barbería; barbero → sus propias citas,
--     también hacia otro barbero activo de la misma barbería;
--   * solo citas pending o confirmed;
--   * a HOY (cualquier hora, para corregir) o días futuros; nunca al pasado;
--   * 1 a 5 servicios; end_at y la ocupación se recalculan desde las líneas;
--   * traslape, fuera de horario o bloqueo → AVISO (BA007, igual que los
--     walk-ins); el personal decide. Nunca se mueve ninguna otra cita.
--
-- Contenido:
--   1. enforce_appointment_status_transition (versión de 20261025120000 +):
--      - mover (cambiar barber_id, start_at o end_at) solo en pending/confirmed
--        → BA008, en cualquier ruta;
--      - overrides solo cambia cuando la cita se mueve; overrides_at/_by los
--        fija el trigger en ese momento. Sin mover, siguen inmutables.
--   2. private.overlaps_other_appointment: como overlaps_active_appointment,
--      excluyendo la propia cita.
--   3. public.appointment_changes: historial de movimientos (solo lectura).
--   4. public.move_appointment.
--
-- Líneas de servicio: las que siguen conservan su snapshot (precio y duración
-- con que se reservaron); las nuevas toman el catálogo vigente; las que salen
-- se borran. Todo pasa por el trigger de líneas de Step 9.1 / 10.1-B.
--
-- Errores: P0002 cita o barbero inexistente, de otra barbería o sin permiso ·
-- 42501 sin sesión · BA008 la cita ya no se puede mover (estado) · 23514
-- validación (día anterior, sin cambios, servicios) · BA007 necesita
-- confirmación (detail JSON con warnings y conflicts) · P0003 la agenda cambió.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Trigger de estados: reglas de movimiento
-- -----------------------------------------------------------------------------
create or replace function private.enforce_appointment_status_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  -- > 1 = la actualización la origina otro trigger (p. ej. ON DELETE SET NULL
  -- de una llave foránea), no un usuario.
  _nested boolean := pg_trigger_depth() > 1;
  -- La cita cambia de horario o de barbero (reprogramar / reasignar).
  _moved  boolean := new.barber_id is distinct from old.barber_id
                  or new.start_at  is distinct from old.start_at
                  or new.end_at    is distinct from old.end_at;
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
  -- Los avisos aceptados describen el horario actual: solo cambian al moverla.
  elsif not _moved and new.overrides    is distinct from old.overrides    then _field := 'overrides';
  elsif not _moved and new.overrides_at is distinct from old.overrides_at then _field := 'overrides_at';
  elsif not _moved and new.overrides_by is distinct from old.overrides_by
        and not (_nested and new.overrides_by is null) then _field := 'overrides_by';
  end if;

  if _field is not null then
    raise exception 'El campo % de una cita no se puede modificar directamente', _field
      using errcode = '42501';
  end if;

  -- 1b. Mover: solo citas vivas; la marca de los avisos la fija el servidor.
  if _moved then
    if old.status not in ('pending'::public.appointment_status, 'confirmed'::public.appointment_status)
       or new.status not in ('pending'::public.appointment_status, 'confirmed'::public.appointment_status) then
      raise exception 'Solo se pueden mover citas pendientes o confirmadas'
        using errcode = 'BA008';
    end if;
    if pg_catalog.cardinality(new.overrides) > 0 then
      new.overrides_at := now();
      new.overrides_by := (select auth.uid());
    else
      new.overrides_at := null;
      new.overrides_by := null;
    end if;
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
  'Transiciones de appointments.status, motivo obligatorio al cancelar, auditoría inmutable (id, tenant_id, source, created_*, completed_at, cancelled_*, occupied_until); mover solo pending/confirmed (BA008); overrides solo cambia al mover y su marca la fija el servidor.';

revoke all on function private.enforce_appointment_status_transition() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Traslape con OTRAS citas (al mover, la propia no cuenta)
-- -----------------------------------------------------------------------------
create or replace function private.overlaps_other_appointment(
  _tenant_id      uuid,
  _barber_id      uuid,
  _start_at       timestamptz,
  _occupied_until timestamptz,
  _exclude_id     uuid
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
      and a.id <> _exclude_id
      and a.status in ('pending'::public.appointment_status,
                       'confirmed'::public.appointment_status,
                       'completed'::public.appointment_status)
      and tstzrange(a.start_at, a.occupied_until, '[)')
          && tstzrange(_start_at, _occupied_until, '[)')
  );
$$;

comment on function private.overlaps_other_appointment(uuid, uuid, timestamptz, timestamptz, uuid) is
  'Como overlaps_active_appointment, sin contar la cita _exclude_id (para moverla).';

revoke all on function private.overlaps_other_appointment(uuid, uuid, timestamptz, timestamptz, uuid)
  from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Historial de movimientos
-- -----------------------------------------------------------------------------
create table public.appointment_changes (
  id              uuid        primary key default gen_random_uuid(),
  tenant_id       uuid        not null references public.tenants (id) on delete cascade,
  appointment_id  uuid        not null,
  changed_by      uuid        references auth.users (id) on delete set null,
  changed_at      timestamptz not null default now(),
  old_barber_id   uuid        not null,
  new_barber_id   uuid        not null,
  old_start_at    timestamptz not null,
  new_start_at    timestamptz not null,
  old_end_at      timestamptz not null,
  new_end_at      timestamptz not null,
  old_service_ids uuid[]      not null,
  new_service_ids uuid[]      not null,
  acknowledged    text[]      not null default '{}',

  constraint appointment_changes_appointment_fkey
    foreign key (tenant_id, appointment_id)
    references public.appointments (tenant_id, id)
    on delete cascade
);

comment on table public.appointment_changes is
  'Historial de movimientos de citas (reprogramar, reasignar, cambiar servicios). Lo escribe solo move_appointment; nadie lo edita.';

create index appointment_changes_appointment_idx
  on public.appointment_changes (tenant_id, appointment_id, changed_at);

alter table public.appointment_changes enable row level security;

-- Solo lectura por API: admin de la barbería, o el barbero de origen o destino.
revoke all on table public.appointment_changes from anon;
revoke insert, update, delete, truncate, references, trigger on table public.appointment_changes from authenticated;

create policy appointment_changes_select on public.appointment_changes
  for select to authenticated
  using (
    (select private.is_admin(tenant_id))
    or old_barber_id = (select private.my_barber_id(tenant_id))
    or new_barber_id = (select private.my_barber_id(tenant_id))
  );

-- -----------------------------------------------------------------------------
-- 4. move_appointment
-- -----------------------------------------------------------------------------
create or replace function public.move_appointment(
  _appointment_id       uuid,
  _barber_id            uuid,
  _start_at             timestamptz,
  _service_ids          uuid[],
  _acknowledge_warnings boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid            uuid := (select auth.uid());
  _appt           record;
  _tz             text;
  _start          timestamptz;
  _old_services   uuid[];
  _duration       bigint;
  _end_at         timestamptz;
  _occupied_until timestamptz;
  _warnings       text[] := '{}';
  _moved_slot     boolean;
  _conflicts      jsonb;
  _services       jsonb;
  _total_price    bigint;
begin
  if _uid is null then
    raise exception 'Inicia sesión para mover citas'
      using errcode = '42501';
  end if;

  -- ── Cita (bloqueada) y permiso ─────────────────────────────────────────
  select a.id, a.tenant_id, a.barber_id, a.start_at, a.end_at, a.status
    into _appt
  from public.appointments a
  join public.tenants t on t.id = a.tenant_id and t.status = 'active'
  where a.id = _appointment_id
  for update of a;

  if not found or not (
       (select private.is_admin(_appt.tenant_id))
    or exists (
         select 1 from public.barbers b
         where b.id = _appt.barber_id
           and b.tenant_id = _appt.tenant_id
           and b.is_active = true
           and b.id = (select private.my_barber_id(_appt.tenant_id))
       )
  ) then
    raise exception 'Cita no encontrada'
      using errcode = 'P0002';
  end if;

  if _appt.status not in ('pending'::public.appointment_status, 'confirmed'::public.appointment_status) then
    raise exception 'Solo se pueden mover citas pendientes o confirmadas'
      using errcode = 'BA008';
  end if;

  -- ── Barbero destino: activo y de la misma barbería ─────────────────────
  if not exists (
    select 1 from public.barbers b
    where b.id = _barber_id
      and b.tenant_id = _appt.tenant_id
      and b.is_active = true
  ) then
    raise exception 'Barbero no encontrado o inactivo'
      using errcode = 'P0002';
  end if;

  select t.timezone into _tz from public.tenants t where t.id = _appt.tenant_id;

  -- ── Nueva hora: al minuto; hoy o después ───────────────────────────────
  if _start_at is null then
    raise exception 'Indica la nueva fecha y hora'
      using errcode = 'check_violation';
  end if;
  _start := pg_catalog.date_trunc('minute', _start_at);
  if (_start at time zone _tz)::date < (now() at time zone _tz)::date then
    raise exception 'No puedes mover una cita a un día anterior'
      using errcode = 'check_violation';
  end if;

  -- ── Servicios (mismo orden de locks que book_appointment) ──────────────
  perform 1
  from public.services s
  where s.tenant_id = _appt.tenant_id
    and s.id = any (_service_ids)
  order by s.id
  for share of s;

  perform 1 from private.resolve_booking_services(_appt.tenant_id, _service_ids);  -- valida 1–5, activos, sin repetir

  select coalesce(array_agg(l.service_id order by l.position, l.created_at), '{}')
    into _old_services
  from public.appointment_services l
  where l.tenant_id = _appt.tenant_id
    and l.appointment_id = _appt.id;

  if _barber_id = _appt.barber_id
     and _start = _appt.start_at
     and _service_ids = _old_services then
    raise exception 'No hay cambios que guardar'
      using errcode = 'check_violation';
  end if;

  -- ── Agendas de origen y destino (orden fijo: sin interbloqueos) ────────
  perform private.lock_barber_agenda(b)
  from (select distinct unnest(array[_appt.barber_id, _barber_id]) as b order by 1) as x;

  -- ── Líneas: salen las quitadas, entran las nuevas, se reordenan ────────
  delete from public.appointment_services l
  where l.tenant_id = _appt.tenant_id
    and l.appointment_id = _appt.id
    and not (l.service_id = any (_service_ids));

  insert into public.appointment_services (
    tenant_id, appointment_id, service_id,
    service_name, price_cents, duration_minutes,
    commission_rate_bps, position
  )
  select _appt.tenant_id, _appt.id, r.service_id,
         r.service_name, r.price_cents, r.duration_minutes,
         null, r.line_position
  from private.resolve_booking_services(_appt.tenant_id, _service_ids) as r
  where not exists (
    select 1 from public.appointment_services l
    where l.tenant_id = _appt.tenant_id
      and l.appointment_id = _appt.id
      and l.service_id = r.service_id
  )
  order by r.line_position;

  update public.appointment_services l
     set position = (u.ord - 1)::smallint
    from pg_catalog.unnest(_service_ids) with ordinality as u(service_id, ord)
   where l.tenant_id = _appt.tenant_id
     and l.appointment_id = _appt.id
     and l.service_id = u.service_id
     and l.position <> (u.ord - 1);

  -- Duración desde las líneas (las que siguen conservan su snapshot).
  select sum(l.duration_minutes) into _duration
  from public.appointment_services l
  where l.tenant_id = _appt.tenant_id
    and l.appointment_id = _appt.id;

  if _duration > 1440 then
    raise exception 'La duración total de los servicios excede 24 horas'
      using errcode = 'check_violation';
  end if;

  _end_at         := _start + pg_catalog.make_interval(mins => _duration::integer);
  _occupied_until := private.appointment_occupied_until(_start, _end_at);
  -- ¿Cambia de horario o de barbero? (Solo reordenar o cambiar un servicio por
  -- otro de igual duración no la mueve: sus avisos aceptados siguen igual.)
  _moved_slot := _barber_id <> _appt.barber_id or _start <> _appt.start_at or _end_at <> _appt.end_at;

  -- ── Avisos en el nuevo horario ─────────────────────────────────────────
  if _moved_slot then
    if not private.within_business_hours(_appt.tenant_id, _tz, _start, _end_at) then
      _warnings := _warnings || 'outside_business_hours'::text;
    end if;
    if not private.within_barber_hours(_appt.tenant_id, _barber_id, _tz, _start, _end_at) then
      _warnings := _warnings || 'outside_barber_hours'::text;
    end if;
    if private.overlaps_schedule_block(_appt.tenant_id, _barber_id, _start, _end_at) then
      _warnings := _warnings || 'schedule_block'::text;
    end if;
    if private.overlaps_other_appointment(_appt.tenant_id, _barber_id, _start, _occupied_until, _appt.id) then
      _warnings := _warnings || 'overlap'::text;
    end if;
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
    where a.tenant_id = _appt.tenant_id
      and a.barber_id = _barber_id
      and a.id <> _appt.id
      and a.status in ('pending'::public.appointment_status,
                       'confirmed'::public.appointment_status,
                       'completed'::public.appointment_status)
      and tstzrange(a.start_at, a.occupied_until, '[)')
          && tstzrange(_start, _occupied_until, '[)');

    -- Esta excepción revierte también los cambios de líneas de arriba.
    raise exception 'Mover esta cita necesita tu confirmación'
      using errcode = 'BA007',
            detail  = jsonb_build_object('warnings', _warnings, 'conflicts', _conflicts)::text;
  end if;

  -- ── Cita ───────────────────────────────────────────────────────────────
  begin
    if _moved_slot then
      update public.appointments
         set barber_id = _barber_id,
             start_at  = _start,
             end_at    = _end_at,
             overrides = _warnings
       where id = _appt.id;
    end if;
  exception
    when exclusion_violation then
      raise exception 'La agenda cambió mientras tanto. Revisa el horario e intenta de nuevo.'
        using errcode = 'P0003';
  end;

  insert into public.appointment_changes (
    tenant_id, appointment_id, changed_by,
    old_barber_id, new_barber_id,
    old_start_at, new_start_at,
    old_end_at, new_end_at,
    old_service_ids, new_service_ids,
    acknowledged
  ) values (
    _appt.tenant_id, _appt.id, _uid,
    _appt.barber_id, _barber_id,
    _appt.start_at, _start,
    _appt.end_at, _end_at,
    _old_services, _service_ids,
    _warnings
  );

  select jsonb_agg(jsonb_build_object(
           'id',               l.service_id,
           'name',             l.service_name,
           'price_cents',      l.price_cents,
           'duration_minutes', l.duration_minutes,
           'position',         l.position
         ) order by l.position),
         sum(l.price_cents)
    into _services, _total_price
  from public.appointment_services l
  where l.tenant_id      = _appt.tenant_id
    and l.appointment_id = _appt.id;

  return jsonb_build_object(
    'appointment_id',         _appt.id,
    'status',                 _appt.status,
    'barber_id',              _barber_id,
    'start_at',               _start,
    'end_at',                 _end_at,
    'services',               _services,
    'total_price_cents',      _total_price,
    'total_duration_minutes', _duration,
    'overrides',              (select to_jsonb(a.overrides) from public.appointments a where a.id = _appt.id)
  );
end;
$$;

comment on function public.move_appointment(uuid, uuid, timestamptz, uuid[], boolean) is
  'Reprograma, reasigna y/o cambia servicios de una cita pending/confirmed (admin: su barbería; barbero: sus citas). Hoy o después. Avisos → BA007 salvo _acknowledge_warnings. Registra el movimiento en appointment_changes.';

revoke all on function public.move_appointment(uuid, uuid, timestamptz, uuid[], boolean) from public, anon;
grant execute on function public.move_appointment(uuid, uuid, timestamptz, uuid[], boolean) to authenticated;
