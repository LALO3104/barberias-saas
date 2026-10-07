-- =============================================================================
-- Barberías SaaS — Migración 13: estados de citas (Step 9)
-- -----------------------------------------------------------------------------
-- Flujo permitido (cualquier otro cambio de status se rechaza):
--
--     pending ──► confirmed ──► completed
--        │            │
--        ├──► cancelled ◄──┤
--        └──► no_show   ◄──┘
--
-- 1. Trigger appointments_enforce_status_transition (BEFORE UPDATE):
--    valida la transición en CUALQUIER ruta — la función de abajo, la API
--    directa con el JWT del usuario o un script —. Además fija en el servidor
--    las marcas que antes podía escribir el cliente:
--      completed  → completed_at = now()
--      cancelled  → cancelled_at = now(), cancelled_by = auth.uid()
--    (cancelled_by NULL con cancelled_at = canceló el cliente, como documenta
--    la migración 5; hoy no existe esa vía).
--
-- 2. public.set_appointment_status(_appointment_id, _new_status, _reason):
--    el único camino que usa la app. SECURITY INVOKER: la RLS existente de
--    appointments sigue aplicando (admin → todo su tenant; barbero → solo sus
--    citas). No se crean ni modifican políticas.
--    Concurrencia: SELECT … FOR UPDATE bloquea la fila; si dos usuarios
--    cambian la misma cita a la vez, el segundo espera, relee el estado ya
--    actualizado y su transición se valida contra ESE estado.
--
-- Errores (SQLSTATE) que la app traduce a mensajes claros:
--    P0002 cita inexistente o fuera del alcance del usuario (no se distingue,
--          para no revelar citas de otros barberos o tenants)
--    42501 sin permiso
--    BA001 transición no permitida (incluye "otro usuario ya la cambió")
--    BA002 motivo de cancelación faltante o demasiado largo
--    (Clase propia "BA": P0003/P0004 están reservados por PostgreSQL —
--     P0004 es assert_failure y no se puede capturar en PL/pgSQL.)
--
-- Fuera de alcance (Step posterior de endurecimiento): restringir qué otras
-- columnas de appointments puede editar un barbero por API directa.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Trigger de transiciones
-- -----------------------------------------------------------------------------
create or replace function private.enforce_appointment_status_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

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

  -- Las marcas de tiempo y la auditoría las fija el servidor, no el cliente.
  if new.status = 'completed'::public.appointment_status then
    new.completed_at := now();
  elsif new.status = 'cancelled'::public.appointment_status then
    new.cancelled_at := now();
    new.cancelled_by := (select auth.uid());
  end if;

  return new;
end;
$$;

comment on function private.enforce_appointment_status_transition() is
  'Valida transiciones de appointments.status y fija completed_at / cancelled_at / cancelled_by.';

create trigger appointments_enforce_status_transition
  before update on public.appointments
  for each row execute function private.enforce_appointment_status_transition();

-- -----------------------------------------------------------------------------
-- 2. set_appointment_status
-- -----------------------------------------------------------------------------
create or replace function public.set_appointment_status(
  _appointment_id uuid,
  _new_status     public.appointment_status,
  _reason         text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  _appt   record;
  _reason_clean text := nullif(btrim(coalesce(_reason, '')), '');
begin
  -- Bloquea la fila. Con RLS (SECURITY INVOKER) solo es visible si el usuario
  -- es admin del tenant o el barbero dueño de la cita.
  select a.id, a.tenant_id, a.barber_id, a.status
    into _appt
  from public.appointments a
  where a.id = _appointment_id
  for update;

  if not found then
    raise exception 'Cita no encontrada'
      using errcode = 'P0002';
  end if;

  -- Defensa explícita (misma regla que la RLS).
  if not (
    (select private.is_admin(_appt.tenant_id))
    or coalesce(_appt.barber_id = (select private.my_barber_id(_appt.tenant_id)), false)
  ) then
    raise exception 'No tienes permiso para modificar esta cita'
      using errcode = '42501';
  end if;

  -- Transición validada contra el estado ACTUAL (ya bloqueado).
  if not (
       (_appt.status = 'pending'::public.appointment_status
          and _new_status in ('confirmed'::public.appointment_status,
                              'cancelled'::public.appointment_status,
                              'no_show'::public.appointment_status))
    or (_appt.status = 'confirmed'::public.appointment_status
          and _new_status in ('completed'::public.appointment_status,
                              'cancelled'::public.appointment_status,
                              'no_show'::public.appointment_status))
  ) then
    raise exception 'Transición de estado no permitida: % → %', _appt.status, _new_status
      using errcode = 'BA001';
  end if;

  if _new_status = 'cancelled'::public.appointment_status then
    if _reason_clean is null then
      raise exception 'Indica el motivo de la cancelación'
        using errcode = 'BA002';
    end if;
    if char_length(_reason_clean) > 500 then
      raise exception 'El motivo de la cancelación es demasiado largo (máximo 500 caracteres)'
        using errcode = 'BA002';
    end if;
  else
    _reason_clean := null;
  end if;

  -- completed_at / cancelled_at / cancelled_by los fija el trigger.
  update public.appointments
     set status = _new_status,
         cancellation_reason = case
           when _new_status = 'cancelled'::public.appointment_status then _reason_clean
           else cancellation_reason
         end
   where id = _appointment_id
     and status = _appt.status;

  if not found then
    raise exception 'La cita cambió de estado mientras tanto'
      using errcode = 'BA001';
  end if;

  return jsonb_build_object(
    'id',              _appointment_id,
    'previous_status', _appt.status,
    'status',          _new_status
  );
end;
$$;

comment on function public.set_appointment_status(uuid, public.appointment_status, text) is
  'Cambia el estado de una cita con transiciones validadas y bloqueo de fila. Admin del tenant o barbero dueño. RLS aplica (SECURITY INVOKER).';

-- -----------------------------------------------------------------------------
-- 3. Privilegios: solo usuarios autenticados (nunca anon)
-- -----------------------------------------------------------------------------
revoke all on function private.enforce_appointment_status_transition() from public, anon, authenticated;
revoke all on function public.set_appointment_status(uuid, public.appointment_status, text) from public, anon;
grant execute on function public.set_appointment_status(uuid, public.appointment_status, text) to authenticated;
