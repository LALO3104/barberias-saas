-- =============================================================================
-- Barberías SaaS — Migración 4/5: services, business_hours,
--                                  barber_working_hours, schedule_blocks
-- -----------------------------------------------------------------------------
-- Dinero en centavos (integer): $150.00 = 15000. Nunca numeric.
-- Horarios recurrentes como `time` (hora local), interpretados con
-- tenants.timezone. Instantes reales (bloqueos) como `timestamptz`.
-- day_of_week en ISO: 1 = lunes … 7 = domingo.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- services
-- -----------------------------------------------------------------------------
create table public.services (
  id                uuid        primary key default gen_random_uuid(),
  tenant_id         uuid        not null references public.tenants (id) on delete cascade,
  name              text        not null,
  description       text,
  price_cents       integer     not null,
  duration_minutes  integer     not null,
  is_active         boolean     not null default true,
  sort_order        smallint    not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint services_tenant_id_id_key    unique (tenant_id, id),
  constraint services_name_not_blank      check (btrim(name) <> ''),
  constraint services_price_non_negative  check (price_cents >= 0),
  constraint services_duration_positive   check (duration_minutes > 0)
);

comment on table public.services is
  'Catálogo de servicios. No se borra: is_active = false. Las citas copian nombre, precio y duración.';
comment on column public.services.price_cents is
  'Centavos de tenants.currency. $150.00 = 15000.';

create trigger services_set_updated_at
  before update on public.services
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- business_hours — horario semanal del local (lo que se muestra al público)
-- -----------------------------------------------------------------------------
-- Varias filas por día = turno partido (09:00–14:00 y 16:00–20:00).
-- Día sin filas = cerrado.
create table public.business_hours (
  id           uuid        primary key default gen_random_uuid(),
  tenant_id    uuid        not null references public.tenants (id) on delete cascade,
  day_of_week  smallint    not null,
  opens_at     time        not null,
  closes_at    time        not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint business_hours_day_iso        check (day_of_week between 1 and 7),
  constraint business_hours_closes_after   check (closes_at > opens_at)
);

comment on table public.business_hours is
  'Horario semanal del local. time = hora local de tenants.timezone. ISO: 1 = lunes … 7 = domingo.';

create index business_hours_tenant_day_idx
  on public.business_hours (tenant_id, day_of_week);

create trigger business_hours_set_updated_at
  before update on public.business_hours
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- barber_working_hours — horario semanal de cada barbero (lo reservable)
-- -----------------------------------------------------------------------------
create table public.barber_working_hours (
  id           uuid        primary key default gen_random_uuid(),
  tenant_id    uuid        not null references public.tenants (id) on delete cascade,
  barber_id    uuid        not null,
  day_of_week  smallint    not null,
  opens_at     time        not null,
  closes_at    time        not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint barber_working_hours_day_iso       check (day_of_week between 1 and 7),
  constraint barber_working_hours_closes_after  check (closes_at > opens_at),

  -- El horario es parte del barbero y pertenece a su misma barbería.
  constraint barber_working_hours_barber_fkey
    foreign key (tenant_id, barber_id)
    references public.barbers (tenant_id, id)
    on delete cascade
);

comment on table public.barber_working_hours is
  'Horario semanal reservable de un barbero. Misma forma que business_hours.';

create index barber_working_hours_barber_day_idx
  on public.barber_working_hours (barber_id, day_of_week);

create trigger barber_working_hours_set_updated_at
  before update on public.barber_working_hours
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- schedule_blocks — vacaciones, días libres, festivos, bloqueos puntuales
-- -----------------------------------------------------------------------------
create table public.schedule_blocks (
  id          uuid        primary key default gen_random_uuid(),
  tenant_id   uuid        not null references public.tenants (id) on delete cascade,
  -- Nulo = cierra todo el local.
  barber_id   uuid,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  -- Interno; nunca se expone al público.
  reason      text,
  created_by  uuid        references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint schedule_blocks_ends_after check (ends_at > starts_at),

  -- Con barber_id nulo la FK no se evalúa (MATCH SIMPLE): bloqueo del local.
  constraint schedule_blocks_barber_fkey
    foreign key (tenant_id, barber_id)
    references public.barbers (tenant_id, id)
    on delete cascade
);

comment on table public.schedule_blocks is
  'Bloqueos de agenda. barber_id nulo = todo el local cerrado. reason es interno.';

create index schedule_blocks_tenant_starts_idx
  on public.schedule_blocks (tenant_id, starts_at);

create trigger schedule_blocks_set_updated_at
  before update on public.schedule_blocks
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS y privilegios
-- -----------------------------------------------------------------------------
alter table public.services             enable row level security;
alter table public.business_hours       enable row level security;
alter table public.barber_working_hours enable row level security;
alter table public.schedule_blocks      enable row level security;

revoke all on table
  public.services, public.business_hours,
  public.barber_working_hours, public.schedule_blocks
from anon;
