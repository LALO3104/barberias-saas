-- =============================================================================
-- Barberías SaaS — Migración 16: integridad de líneas de cita (Step 10.1, Migration B)
-- -----------------------------------------------------------------------------
-- Prepara appointment_services para citas con varios servicios:
--
--   1. UNIQUE (tenant_id, appointment_id, service_id): un servicio aparece a lo
--      sumo una vez por cita. Error: 23505 (unique_violation).
--   2. Máximo 5 líneas por cita, en el trigger de líneas
--      (private.enforce_appointment_service_line). Error: BA006.
--      Dos INSERT concurrentes en la misma cita se serializan con un advisory
--      lock de transacción por cita, así que no pueden contar 4 a la vez y
--      terminar en 6.
--
-- Errores nuevos (SQLSTATE):
--    BA006 la cita ya tiene el máximo de 5 servicios
--          (BA005 queda reservado para "completar antes de la hora").
--    23505 servicio repetido en la misma cita (por la restricción UNIQUE)
--
-- Nada más cambia: el resto de la función de trigger es idéntico a Step 9.1
-- (migración 20261007174600). No se tocan políticas, privilegios ni otras
-- funciones.
--
-- Datos existentes: la restricción UNIQUE se valida al crearse; si hubiera
-- duplicados la migración falla completa (datos reales revisados: 0).
-- Ninguna cita existente tiene más de 1 línea (las reservas públicas crean
-- una), y el tope solo se evalúa en INSERT: no afecta filas ya guardadas.
--
-- Espacio de advisory locks (clave de dos enteros: namespace, hashtext(id)):
--    10101  líneas de una cita    (esta migración)
--    10102  agenda de un barbero  (Migration C: private.lock_barber_agenda)
-- Una colisión de hashtext entre dos citas solo serializa de más, nunca
-- permite de menos.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Un servicio por cita, una sola vez
-- -----------------------------------------------------------------------------
alter table public.appointment_services
  add constraint appointment_services_appointment_service_key
  unique (tenant_id, appointment_id, service_id);

comment on constraint appointment_services_appointment_service_key on public.appointment_services is
  'Un servicio aparece a lo sumo una vez en cada cita.';

-- -----------------------------------------------------------------------------
-- 2. Trigger de líneas: Step 9.1 + tope de 5 líneas por cita
-- -----------------------------------------------------------------------------
-- Idéntica a la versión de Step 9.1 salvo el bloque marcado "Step 10.1".
-- Sigue siendo SECURITY INVOKER: el conteo pasa por RLS, pero quien llega a
-- ese punto ya ve la cita (si no, 23503) y quien ve una cita ve todas sus
-- líneas (admin: toda la barbería; barbero: sus citas; funciones DEFINER:
-- todo), así que el conteo es exacto.
--
-- Visibilidad: la función es VOLATILE (por omisión), por lo que el conteo ve
--   * las líneas confirmadas por otras transacciones al momento de contar
--     (READ COMMITTED: cada sentencia toma un snapshot nuevo, y el conteo
--     ocurre DESPUÉS de obtener el lock);
--   * las líneas insertadas antes por la misma sentencia (INSERT de varias
--     filas) o la misma transacción.
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
  _line_count     bigint;
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
    -- ── Step 10.1: máximo 5 líneas por cita ────────────────────────────────
    -- El lock se toma después de comprobar que la cita es visible (no sirve
    -- para sondear citas ajenas) y se libera al terminar la transacción.
    -- Solo INSERT puede aumentar el número de líneas: appointment_id es
    -- inmutable en UPDATE.
    perform pg_catalog.pg_advisory_xact_lock(10101, pg_catalog.hashtext(_appointment_id::text));

    select count(*) into _line_count
    from public.appointment_services l
    where l.tenant_id      = _tenant_id
      and l.appointment_id = _appointment_id;

    if _line_count >= 5 then
      raise exception 'Una cita admite como máximo 5 servicios'
        using errcode = 'BA006';
    end if;
    -- ── fin Step 10.1 ──────────────────────────────────────────────────────

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
  'appointment_services: snapshot del catálogo al insertar, comisión NULL, máximo 5 líneas por cita (BA006, serializado por cita), cita completada bloqueada, claves inmutables.';

-- CREATE OR REPLACE conserva los privilegios; se reafirma que nadie la invoca
-- directamente.
revoke all on function private.enforce_appointment_service_line() from public, anon, authenticated;
