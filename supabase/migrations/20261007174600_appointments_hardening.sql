-- =============================================================================
-- Barberías SaaS — Migración 14: hardening de citas (Step 9.1)
-- -----------------------------------------------------------------------------
-- Objetivo: que la integridad de las citas no dependa de la UI ni de las Server
-- Actions. Todo lo de abajo lo hace cumplir PostgreSQL.
--
-- Defensa en capas:
--
--   A. PRIVILEGIOS (rol authenticated = admin y barber vía API)
--      * Sin INSERT directo en appointments. Las citas nacen solo en
--        funciones con privilegios propios (hoy: book_appointment; mañana:
--        walk-ins). book_appointment no cambia.
--      * UPDATE solo en (status, cancellation_reason): el flujo de
--        set_appointment_status sigue igual. Agenda (start_at, end_at),
--        asignación (barber_id), cliente (client_id) y el resto quedan fuera de
--        la API — también para el admin — hasta que existan funciones seguras
--        de reprogramación / reasignación / edición.
--        Nota: SELECT … FOR UPDATE exige UPDATE en al menos una columna;
--        status la cubre.
--
--   B. TRIGGER appointments_enforce_status_transition (cualquier rol, también
--      service_role y SQL Editor):
--      * Inmutables: id, tenant_id, source, created_at, created_by,
--        completed_at, cancelled_at, cancelled_by. Las marcas de auditoría
--        solo las escribe el propio trigger al ocurrir la transición.
--        Excepción: ON DELETE SET NULL de auth.users (created_by /
--        cancelled_by → NULL al borrar una cuenta).
--      * Transiciones válidas sin cambios (pending → confirmed / cancelled /
--        no_show; confirmed → completed / cancelled / no_show).
--      * Cancelar exige motivo con texto (no NULL, no vacío, no solo
--        espacios; máximo 500). Fuera de la cancelación el motivo no se
--        escribe ni se reescribe.
--      barber_id, client_id, start_at y end_at NO se congelan aquí a propósito:
--      los protege la capa A, y las futuras funciones de reprogramación /
--      reasignación (con sus propias validaciones) podrán cambiarlos.
--
--   C. appointment_services (trigger + política):
--      * Toda línea nueva toma service_name, price_cents y duration_minutes
--        del catálogo (public.services) de la MISMA barbería; lo enviado se
--        ignora. El servicio debe existir y estar activo.
--        commission_rate_bps siempre NULL al insertar (el módulo de comisiones
--        lo llenará después).
--      * Las líneas de una cita completada no se insertan, modifican ni borran
--        (nadie, incluido el admin).
--      * Una línea no cambia de cita, barbería, id ni fecha de creación.
--      * DELETE solo admin (el barbero ya no puede borrar y reinsertar).
--      El barbero conserva: agregar servicios del catálogo a sus citas no
--      completadas. El admin conserva: agregar, ajustar y borrar líneas de
--      citas no completadas.
--
-- Errores nuevos (SQLSTATE):
--    42501 campo protegido / sin privilegio
--    BA002 motivo de cancelación faltante, vacío o > 500 (mismo código que la
--          función set_appointment_status, ya traducido por la app)
--    BA003 servicio inactivo
--    BA004 la cita está completada: sus servicios ya no se pueden cambiar
--    23503 el servicio o la cita no existen en esa barbería (igual que la FK)
--
-- No se modifican: book_appointment, set_appointment_status, políticas de
-- appointments, Server Actions ni UI.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A. Privilegios sobre appointments
-- -----------------------------------------------------------------------------
-- Revocar el UPDATE de tabla también revoca los de columna; luego se re-otorga
-- únicamente lo que usa set_appointment_status.
revoke insert on public.appointments from authenticated;
revoke update on public.appointments from authenticated;
grant update (status, cancellation_reason) on public.appointments to authenticated;

-- -----------------------------------------------------------------------------
-- B. Trigger de estados reforzado (mismo nombre: el trigger existente lo usa)
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
  'Transiciones de appointments.status, motivo obligatorio al cancelar, auditoría inmutable (id, tenant_id, source, created_*, completed_at, cancelled_*).';

-- -----------------------------------------------------------------------------
-- C. appointment_services
-- -----------------------------------------------------------------------------
-- SECURITY INVOKER a propósito: las búsquedas pasan por RLS, así que un
-- usuario no puede usar los mensajes de error para sondear servicios o citas
-- de otra barbería.
create or replace function private.enforce_appointment_service_line()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  _tenant_id      uuid;
  _appointment_id uuid;
  _status         public.appointment_status;
  _service        record;
begin
  -- Borrados en cascada (purga de una barbería): no se bloquean.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;

  if tg_op = 'UPDATE' and (
       new.id             is distinct from old.id
    or new.tenant_id      is distinct from old.tenant_id
    or new.appointment_id is distinct from old.appointment_id
    or new.created_at     is distinct from old.created_at
  ) then
    raise exception 'Una línea de servicio no puede cambiar de cita, barbería o fecha de creación'
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    _tenant_id := old.tenant_id;  _appointment_id := old.appointment_id;
  else
    _tenant_id := new.tenant_id;  _appointment_id := new.appointment_id;
  end if;

  -- FOR SHARE: se serializa con set_appointment_status (FOR UPDATE), así una
  -- línea no puede colarse mientras la cita se está completando.
  select a.status into _status
  from public.appointments a
  where a.tenant_id = _tenant_id
    and a.id = _appointment_id
  for share;

  -- Inexistente, de otra barbería o invisible por RLS: misma respuesta que la
  -- FK compuesta (23503), sin revelar cuál de los tres casos es.
  if not found then
    raise exception 'La cita no existe en esta barbería'
      using errcode = '23503';
  end if;

  if _status = 'completed'::public.appointment_status then
    raise exception 'La cita ya está completada: sus servicios no se pueden modificar'
      using errcode = 'BA004';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if tg_op = 'INSERT' then
    select s.name, s.price_cents, s.duration_minutes, s.is_active
      into _service
    from public.services s
    where s.tenant_id = new.tenant_id
      and s.id = new.service_id;

    if not found then
      raise exception 'El servicio no existe en esta barbería'
        using errcode = '23503';
    end if;
    if not _service.is_active then
      raise exception 'El servicio está inactivo'
        using errcode = 'BA003';
    end if;

    -- Snapshot oficial del catálogo; lo enviado por el cliente se ignora.
    new.service_name        := _service.name;
    new.price_cents         := _service.price_cents;
    new.duration_minutes    := _service.duration_minutes;
    new.commission_rate_bps := null;
    new.created_at          := now();
  end if;

  return new;
end;
$$;

comment on function private.enforce_appointment_service_line() is
  'appointment_services: snapshot del catálogo al insertar, comisión NULL, cita completada bloqueada, claves inmutables.';

create trigger appointment_services_enforce_line
  before insert or update or delete on public.appointment_services
  for each row execute function private.enforce_appointment_service_line();

-- DELETE solo admin (antes: admin o barbero dueño de una cita no completada).
drop policy appointment_services_delete on public.appointment_services;
create policy appointment_services_delete on public.appointment_services
  for delete to authenticated
  using ((select private.is_admin(tenant_id)));

-- -----------------------------------------------------------------------------
-- Privilegios de las funciones de trigger: nadie las invoca directamente.
-- -----------------------------------------------------------------------------
revoke all on function private.enforce_appointment_status_transition() from public, anon, authenticated;
revoke all on function private.enforce_appointment_service_line() from public, anon, authenticated;
