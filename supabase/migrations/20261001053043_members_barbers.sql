-- =============================================================================
-- Barberías SaaS — Migración 3/5: tenant_members, barbers, barber_compensation
-- -----------------------------------------------------------------------------
-- tenant_members      : quién tiene acceso a qué barbería y con qué rol.
-- barbers             : recurso agendable; puede o no tener cuenta ligada.
-- barber_compensation : comisión, separada de barbers a propósito (un barbero
--                       no debe poder leer la comisión de sus compañeros).
--
-- Integridad multi-tenant: barbers.user_id referencia a la MEMBRESÍA de la
-- misma barbería con una FK compuesta (tenant_id, user_id), de modo que un
-- barbero de Kings no puede quedar ligado a una cuenta que no pertenece a Kings.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- tenant_members
-- -----------------------------------------------------------------------------
create table public.tenant_members (
  tenant_id   uuid               not null references public.tenants (id) on delete cascade,
  user_id     uuid               not null references auth.users (id) on delete cascade,
  role        public.member_role not null,
  created_at  timestamptz        not null default now(),
  updated_at  timestamptz        not null default now(),

  constraint tenant_members_pkey primary key (tenant_id, user_id)
);

comment on table public.tenant_members is
  'Membresía persona–barbería. El rol es de la relación, no de la persona.';

-- "¿A qué barberías pertenezco?" al iniciar sesión. (La PK cubre las
-- búsquedas por (tenant_id, user_id) que harán las funciones de RLS.)
create index tenant_members_user_id_idx on public.tenant_members (user_id);

create trigger tenant_members_set_updated_at
  before update on public.tenant_members
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- barbers
-- -----------------------------------------------------------------------------
create table public.barbers (
  id            uuid        primary key default gen_random_uuid(),
  tenant_id     uuid        not null references public.tenants (id) on delete cascade,
  -- Cuenta ligada (opcional). Debe ser miembro de ESTA barbería (FK abajo).
  user_id       uuid,
  display_name  text        not null,
  role_title    text,
  bio           text,
  photo_url     text,
  is_active     boolean     not null default true,
  sort_order    smallint    not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- Destino de las FKs compuestas (tenant_id, barber_id) del resto del esquema.
  constraint barbers_tenant_id_id_key        unique (tenant_id, id),
  constraint barbers_display_name_not_blank  check (btrim(display_name) <> ''),

  -- Si se borra la membresía (o la cuenta), el barbero y su historial
  -- sobreviven: solo se anula user_id. SET NULL con lista de columnas
  -- (PostgreSQL 15+) evita intentar anular tenant_id, que es NOT NULL.
  constraint barbers_member_fkey
    foreign key (tenant_id, user_id)
    references public.tenant_members (tenant_id, user_id)
    on delete set null (user_id)
);

comment on table public.barbers is
  'Barbero como recurso agendable y perfil público. No se borra: is_active = false.';

-- Una cuenta = como máximo un barbero por barbería. También es el índice que
-- usará my_barber_id() en las políticas RLS.
create unique index barbers_tenant_id_user_id_key
  on public.barbers (tenant_id, user_id)
  where user_id is not null;

create trigger barbers_set_updated_at
  before update on public.barbers
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- barber_compensation
-- -----------------------------------------------------------------------------
create table public.barber_compensation (
  barber_id            uuid        primary key,
  tenant_id            uuid        not null references public.tenants (id) on delete cascade,
  -- Puntos base: 4000 = 40 %.
  commission_rate_bps  integer     not null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint barber_compensation_rate_range
    check (commission_rate_bps between 0 and 10000),

  -- Misma barbería garantizada. NO ACTION: los barberos no se borran; una
  -- purga en cascada desde tenants sí funciona porque se verifica al final
  -- de la sentencia.
  constraint barber_compensation_barber_fkey
    foreign key (tenant_id, barber_id)
    references public.barbers (tenant_id, id)
);

comment on table public.barber_compensation is
  'Comisión vigente del barbero, separada de barbers por seguridad. La tasa histórica se copia en appointment_services.';

create trigger barber_compensation_set_updated_at
  before update on public.barber_compensation
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS y privilegios
-- -----------------------------------------------------------------------------
alter table public.tenant_members      enable row level security;
alter table public.barbers             enable row level security;
alter table public.barber_compensation enable row level security;

revoke all on table
  public.tenant_members, public.barbers, public.barber_compensation
from anon;
