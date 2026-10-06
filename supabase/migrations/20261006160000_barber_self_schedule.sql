-- =============================================================================
-- Barberías SaaS — Migración 11: el barbero edita su propio horario
-- -----------------------------------------------------------------------------
-- Regla de negocio: el admin gestiona el horario de cualquier barbero de su
-- barbería; cada barbero puede gestionar SOLO el suyo.
--
-- La RLS de barber_working_hours (migración rls_policies) YA implementa esa
-- regla para INSERT / UPDATE / DELETE:
--     is_admin(tenant_id) OR barber_id = my_barber_id(tenant_id)
-- No se modifica ninguna política.
--
-- Lo único que la bloqueaba era la función set_barber_working_hours
-- (migración 10), que exigía is_admin. Aquí se reemplaza SOLO esa función
-- para que su chequeo sea idéntico al de la RLS. Firma, comportamiento
-- atómico, SECURITY INVOKER y privilegios no cambian.
--
-- set_business_hours (horario del local) sigue siendo solo admin.
-- =============================================================================

create or replace function public.set_barber_working_hours(
  _tenant_id uuid,
  _barber_id uuid,
  _intervals jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Admin del tenant, o el barbero dueño del registro (misma regla que la RLS).
  -- my_barber_id devuelve NULL si el usuario no tiene barbero en ese tenant;
  -- coalesce evita que NULL se trate como "permitido".
  if not (
    (select private.is_admin(_tenant_id))
    or coalesce(_barber_id = (select private.my_barber_id(_tenant_id)), false)
  ) then
    raise exception 'Solo puedes modificar tu propio horario'
      using errcode = '42501';
  end if;

  if _intervals is null or jsonb_typeof(_intervals) <> 'array' then
    raise exception 'Formato de horario inválido'
      using errcode = '22023';
  end if;

  -- Mensaje claro; la FK compuesta (tenant_id, barber_id) lo garantiza igual.
  if not exists (
    select 1 from public.barbers b
    where b.id = _barber_id
      and b.tenant_id = _tenant_id
  ) then
    raise exception 'Barbero no encontrado'
      using errcode = 'P0002';
  end if;

  delete from public.barber_working_hours
  where tenant_id = _tenant_id
    and barber_id = _barber_id;

  insert into public.barber_working_hours
    (tenant_id, barber_id, day_of_week, opens_at, closes_at)
  select _tenant_id, _barber_id, x.day_of_week, x.opens_at, x.closes_at
  from jsonb_to_recordset(_intervals)
    as x(day_of_week smallint, opens_at time, closes_at time);
end;
$$;

comment on function public.set_barber_working_hours(uuid, uuid, jsonb) is
  'Reemplaza atómicamente el horario semanal de un barbero. Admin del tenant o el propio barbero. RLS aplica (SECURITY INVOKER).';

-- Privilegios sin cambios (CREATE OR REPLACE los conserva); se reafirman.
revoke all on function public.set_barber_working_hours(uuid, uuid, jsonb) from public, anon;
grant execute on function public.set_barber_working_hours(uuid, uuid, jsonb) to authenticated;
