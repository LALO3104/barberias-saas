-- =============================================================================
-- Barberías SaaS — Migración 15: ocupación de citas (Step 10.1, Migration A)
-- -----------------------------------------------------------------------------
-- Separa dos conceptos que hasta ahora eran uno solo (end_at):
--
--   end_at          fin ESTIMADO del servicio.
--   occupied_until  hasta cuándo se considera ocupado al barbero para efectos
--                   de disponibilidad y conflictos.
--
-- Margen operativo (fijo: 10 minutos). NO es descanso del barbero: permite que
-- el siguiente cliente comience antes de que termine por completo la duración
-- estimada de la cita anterior.
--
--   D = end_at − start_at;  M = 10 min
--   ocupación base = min(D, max(D − M, M))
--
--        D:   5   10   15   20   30   45   60  (min)
--   ocupación: 5   10   10   10   20   35   50  (min)
--
-- El mínimo M evita rangos vacíos (una restricción de exclusión nunca choca con
-- un rango vacío) y limita a dos los servicios simultáneos en un instante.
--
-- Finalización anticipada: si la cita está completada y completed_at >=
-- start_at, la ocupación se acorta hasta completed_at, con piso start_at + 1
-- minuto. Nunca crece. Si completed_at < start_at (dato anómalo anterior a esta
-- migración) se usa la ocupación base: no es una finalización anticipada.
--
-- Contenido (en este orden):
--   1. private.appointment_occupied_until(...)  única fuente de la regla.
--   2. appointments.occupied_until              columna (todavía nullable).
--   3. Trigger appointments_occupancy           mantiene occupied_until.
--   4. Backfill de las citas existentes.
--   5. NOT NULL + CHECK occupied_until > start_at.
--   6. enforce_appointment_status_transition    Step 9.1 + occupied_until inmutable.
--   7. appointments_no_overlap                  ahora sobre occupied_until.
--
-- Fuera de alcance (Migrations B/C y Step 10.2): multi-servicio, RPC de
-- disponibilidad y reserva, walk-ins, override de conflictos, locks de agenda.
-- get_available_slots y book_appointment NO cambian: siguen validando con end_at
-- (más estricto que la restricción), por lo que no pueden crear traslapes.
--
-- SEGURIDAD DE APLICACIÓN
--   Debe aplicarse como UNA transacción (ver instrucciones del Step). Aun así,
--   el orden está pensado para que cualquier prefijo del script deje la base en
--   un estado consistente si algo se ejecutara fuera de una transacción:
--     * el trigger existe antes del backfill y antes del NOT NULL, así que
--       ninguna cita nueva queda sin occupied_until;
--     * el backfill desactiva y reactiva el trigger de updated_at dentro de UN
--       solo bloque DO (atómico por sí mismo): no puede quedar desactivado;
--     * la nueva exclusión se crea ANTES de borrar la anterior: la tabla nunca
--       queda sin protección contra doble reserva.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Helper: regla de ocupación
-- -----------------------------------------------------------------------------
-- Una sola expresión SQL; sin acceso a tablas. completed_at no nulo implica
-- status = completed (CHECK appointments_completed_consistency), por eso no
-- recibe el estado. El resultado siempre queda en (start_at, end_at]:
--   * ocupación base > 0 y <= D;
--   * el piso de 1 minuto se recorta a end_at (citas de menos de 1 minuto).
-- Los segundos se suman con make_interval(secs => …): nunca hay componentes de
-- día/mes que dependan de la zona horaria.
create or replace function private.appointment_occupied_until(
  _start_at     timestamptz,
  _end_at       timestamptz,
  _completed_at timestamptz default null
)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select least(
    case
      when _completed_at is not null and _completed_at >= _start_at
        then greatest(least(b.base, _completed_at), _start_at + interval '1 minute')
      else b.base
    end,
    _end_at
  )
  from (
    select _start_at + pg_catalog.make_interval(
             secs => least(d.secs, greatest(d.secs - 600, 600))::double precision
           ) as base
    from (select extract(epoch from (_end_at - _start_at)) as secs) as d
  ) as b;
$$;

comment on function private.appointment_occupied_until(timestamptz, timestamptz, timestamptz) is
  'Hasta cuándo ocupa una cita al barbero: min(D, max(D − 10 min, 10 min)) desde start_at; si completed_at >= start_at se acorta hasta completed_at (piso start_at + 1 min). Siempre en (start_at, end_at].';

-- Puro cálculo, sin acceso a tablas. Se otorga a authenticated porque los
-- triggers de appointments se ejecutan con los privilegios de quien actualiza
-- la cita (p. ej. set_appointment_status es SECURITY INVOKER). authenticated ya
-- tiene USAGE sobre private (migración auth_helpers_triggers); no se cambia el
-- esquema. private no está expuesto por la API; anon nunca la necesita.
revoke all on function private.appointment_occupied_until(timestamptz, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function private.appointment_occupied_until(timestamptz, timestamptz, timestamptz)
  to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Columna occupied_until (nullable hasta el paso 5)
-- -----------------------------------------------------------------------------
alter table public.appointments
  add column occupied_until timestamptz;

comment on column public.appointments.occupied_until is
  'Hasta cuándo se considera ocupado al barbero (disponibilidad y exclusión de traslapes). La calcula el trigger appointments_occupancy; nadie la escribe. end_at sigue siendo el fin estimado.';

-- -----------------------------------------------------------------------------
-- 3. Trigger de ocupación
-- -----------------------------------------------------------------------------
-- BEFORE INSERT OR UPDATE. PostgreSQL dispara los triggers del mismo evento en
-- orden alfabético por nombre:
--
--     appointments_enforce_status_transition   (fija completed_at al completar)
--     appointments_occupancy                   (este: ve completed_at ya fijado)
--     appointments_set_updated_at
--
-- Ignora cualquier occupied_until enviado: siempre lo recalcula desde
-- start_at / end_at / completed_at. Es idempotente: una actualización que no
-- cambia esos datos deja el mismo valor.
create or replace function private.set_appointment_occupancy()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.occupied_until := private.appointment_occupied_until(
    new.start_at, new.end_at, new.completed_at
  );
  return new;
end;
$$;

comment on function private.set_appointment_occupancy() is
  'Trigger BEFORE INSERT OR UPDATE de appointments: calcula occupied_until con private.appointment_occupied_until.';

revoke all on function private.set_appointment_occupancy() from public, anon, authenticated;

create trigger appointments_occupancy
  before insert or update on public.appointments
  for each row execute function private.set_appointment_occupancy();

-- -----------------------------------------------------------------------------
-- 4. Backfill de las citas existentes
-- -----------------------------------------------------------------------------
-- El trigger de updated_at se desactiva solo durante este UPDATE para que
-- ninguna otra columna cambie (la migración no modifica updated_at). Los tres
-- pasos van en un mismo bloque DO: si el UPDATE falla, el bloque completo se
-- revierte y el trigger nunca queda desactivado.
--
-- En este UPDATE: enforce_appointment_status_transition (versión de Step 9.1,
-- todavía sin occupied_until) no ve cambios en campos protegidos ni en status;
-- appointments_occupancy recalcula el mismo valor. La cita histórica con
-- completed_at < start_at recibe la ocupación base. Ningún otro dato cambia.
do $$
begin
  alter table public.appointments disable trigger appointments_set_updated_at;

  update public.appointments
     set occupied_until = private.appointment_occupied_until(start_at, end_at, completed_at);

  alter table public.appointments enable trigger appointments_set_updated_at;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. NOT NULL + CHECK
-- -----------------------------------------------------------------------------
-- Validación: falla si alguna fila quedó sin valor. Desde el paso 3 el trigger
-- llena toda cita nueva o actualizada, así que NOT NULL no rompe la reserva.
alter table public.appointments
  alter column occupied_until set not null;

alter table public.appointments
  add constraint appointments_occupied_until_after_start
  check (occupied_until > start_at);

-- -----------------------------------------------------------------------------
-- 6. Inmutabilidad: occupied_until se agrega a los campos protegidos
-- -----------------------------------------------------------------------------
-- Idéntica a la función de Step 9.1 (migración 20261007174600) salvo una rama
-- nueva en el bloque 1. Va DESPUÉS del backfill (si no, el backfill sería
-- rechazado). Como este trigger se dispara ANTES que appointments_occupancy, en
-- una actualización legítima ve occupied_until sin tocar; quien intente
-- escribirla (API, service_role o SQL Editor) recibe 42501. El trigger de
-- ocupación la recalcula después.
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
  'Transiciones de appointments.status, motivo obligatorio al cancelar, auditoría inmutable (id, tenant_id, source, created_*, completed_at, cancelled_*, occupied_until).';

revoke all on function private.enforce_appointment_status_transition() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 7. Exclusión de traslapes sobre la ocupación
-- -----------------------------------------------------------------------------
-- Misma definición que antes salvo el rango: [start_at, occupied_until) en vez
-- de [start_at, end_at). Mismos estados activos. Los rangos nuevos son un
-- subconjunto de los anteriores, así que ningún dato existente puede violarla.
--
-- Orden: crear la nueva con nombre temporal → borrar la anterior → renombrar.
-- Durante el cambio conviven ambas (la anterior es más estricta), nunca
-- ninguna. RENAME CONSTRAINT renombra también su índice. Se conserva el nombre
-- final appointments_no_overlap para que book_appointment (que atrapa 23P01) y
-- la documentación sigan apuntando a la misma restricción.
alter table public.appointments
  add constraint appointments_no_overlap_occupancy
  exclude using gist (
    barber_id with =,
    tstzrange(start_at, occupied_until, '[)') with &&
  )
  where (status in ('pending', 'confirmed', 'completed'));

alter table public.appointments
  drop constraint appointments_no_overlap;

alter table public.appointments
  rename constraint appointments_no_overlap_occupancy to appointments_no_overlap;

comment on constraint appointments_no_overlap on public.appointments is
  'Sin doble reserva: un barbero no puede tener dos citas pending/confirmed/completed cuyos rangos [start_at, occupied_until) se traslapen.';
