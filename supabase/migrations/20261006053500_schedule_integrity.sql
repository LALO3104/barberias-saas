-- =============================================================================
-- Barberías SaaS — Migración 10: Integridad de horarios (Step 8)
-- -----------------------------------------------------------------------------
-- Las tablas business_hours y barber_working_hours ya existen (migración 4).
-- Este archivo NO las recrea ni cambia su forma ni sus políticas RLS. Solo
-- agrega lo que faltaba para administrarlas de forma segura:
--
-- 1. Sin solapes ni duplicados por día:
--      business_hours        → por (tenant_id, day_of_week)
--      barber_working_hours  → por (barber_id, day_of_week)
--    Exclusion constraint con btree_gist (ya instalada en la migración 1),
--    igual que appointments_no_overlap. Rango semiabierto [): 09:00–13:00 y
--    13:00–15:00 son válidos; 09:00–13:00 y 12:00–15:00 no. Un duplicado
--    exacto también se solapa, así que queda prohibido. Seguro ante
--    concurrencia: la segunda transacción falla con 23P01.
--
--    Los `time` son hora local de tenants.timezone. Se anclan a una fecha
--    fija solo para construir el rango; no hay conversión a UTC.
--
-- 2. Reemplazo atómico de la semana:
--      set_business_hours(_tenant_id, _intervals)
--      set_barber_working_hours(_tenant_id, _barber_id, _intervals)
--    Borran los intervalos actuales y escriben los nuevos en una sola
--    transacción: si algo falla (solape, hora inválida), no se pierde nada.
--
--    SECURITY INVOKER: se ejecutan con los permisos de quien llama, así que
--    las políticas RLS existentes siguen aplicando. Además exigen admin de
--    forma explícita (private.is_admin), porque son la vía de administración
--    del dashboard.
--
--    Borrado físico de intervalos: es intencional. Las filas son
--    configuración (nada las referencia por FK) y "día sin filas = cerrado"
--    es el modelo documentado en la migración 4 y el que consume
--    get_available_slots. Las políticas DELETE para admin ya existían.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Sin solapes ni duplicados
-- -----------------------------------------------------------------------------
alter table public.business_hours
  add constraint business_hours_no_overlap
  exclude using gist (
    tenant_id   with =,
    day_of_week with =,
    tsrange(date '2000-01-01' + opens_at, date '2000-01-01' + closes_at, '[)') with &&
  );

alter table public.barber_working_hours
  add constraint barber_working_hours_no_overlap
  exclude using gist (
    barber_id   with =,
    day_of_week with =,
    tsrange(date '2000-01-01' + opens_at, date '2000-01-01' + closes_at, '[)') with &&
  );

-- -----------------------------------------------------------------------------
-- 2. set_business_hours — reemplaza el horario semanal del local
-- -----------------------------------------------------------------------------
-- _intervals: arreglo JSON de
--   { "day_of_week": 1..7, "opens_at": "HH:MM", "closes_at": "HH:MM" }
-- Arreglo vacío = todos los días cerrados.
create or replace function public.set_business_hours(
  _tenant_id uuid,
  _intervals jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not (select private.is_admin(_tenant_id)) then
    raise exception 'Solo los administradores pueden modificar el horario'
      using errcode = '42501';
  end if;

  if _intervals is null or jsonb_typeof(_intervals) <> 'array' then
    raise exception 'Formato de horario inválido'
      using errcode = '22023';
  end if;

  delete from public.business_hours
  where tenant_id = _tenant_id;

  insert into public.business_hours (tenant_id, day_of_week, opens_at, closes_at)
  select _tenant_id, x.day_of_week, x.opens_at, x.closes_at
  from jsonb_to_recordset(_intervals)
    as x(day_of_week smallint, opens_at time, closes_at time);
end;
$$;

comment on function public.set_business_hours(uuid, jsonb) is
  'Reemplaza atómicamente el horario semanal del local. Solo admin. RLS aplica (SECURITY INVOKER).';

-- -----------------------------------------------------------------------------
-- 3. set_barber_working_hours — reemplaza el horario semanal de un barbero
-- -----------------------------------------------------------------------------
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
  if not (select private.is_admin(_tenant_id)) then
    raise exception 'Solo los administradores pueden modificar el horario'
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
  'Reemplaza atómicamente el horario semanal de un barbero. Solo admin. RLS aplica (SECURITY INVOKER).';

-- -----------------------------------------------------------------------------
-- 4. Privilegios: solo usuarios autenticados (nunca anon)
-- -----------------------------------------------------------------------------
revoke all on function public.set_business_hours(uuid, jsonb) from public, anon;
revoke all on function public.set_barber_working_hours(uuid, uuid, jsonb) from public, anon;

grant execute on function public.set_business_hours(uuid, jsonb) to authenticated;
grant execute on function public.set_barber_working_hours(uuid, uuid, jsonb) to authenticated;
