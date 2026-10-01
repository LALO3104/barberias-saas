-- =============================================================================
-- Barberías SaaS — Migración 2/5: plans, tenants, profiles
-- -----------------------------------------------------------------------------
-- plans    : catálogo global de planes, sembrado aquí (no editable desde la app).
-- tenants  : una fila por barbería; raíz del aislamiento multi-tenant.
-- profiles : datos de la persona que no viven en auth.users (1:1).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- plans (global, sin tenant_id)
-- -----------------------------------------------------------------------------
create table public.plans (
  code         text        primary key,
  name         text        not null,
  -- Cuentas con acceso a la barbería; null = sin límite.
  max_members  integer,
  -- Barberos activos; null = sin límite.
  max_barbers  integer,
  -- Banderas de funciones premium futuras. Vacío en el MVP.
  features     jsonb       not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint plans_code_format     check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint plans_name_not_blank  check (btrim(name) <> ''),
  constraint plans_max_members_pos check (max_members is null or max_members > 0),
  constraint plans_max_barbers_pos check (max_barbers is null or max_barbers > 0),
  constraint plans_features_object check (jsonb_typeof(features) = 'object')
);

comment on table public.plans is
  'Catálogo global de planes. Los límites los hará cumplir la base (triggers en un paso posterior).';

create trigger plans_set_updated_at
  before update on public.plans
  for each row execute function private.set_updated_at();

-- Catálogo inicial. Plan Barbería sin límite de barberos hasta que se
-- definan precios (decisión 12 del documento de arquitectura).
insert into public.plans (code, name, max_members, max_barbers) values
  ('individual', 'Barbero individual', 1, 1),
  ('barbershop', 'Barbería', null, null);

-- -----------------------------------------------------------------------------
-- tenants
-- -----------------------------------------------------------------------------
create table public.tenants (
  id            uuid        primary key default gen_random_uuid(),
  slug          text        not null,
  name          text        not null,
  -- Solo editable por la plataforma; el bloqueo por columna para el rol
  -- `authenticated` llega con las políticas RLS.
  plan_code     text        not null references public.plans (code),
  status        text        not null default 'active',
  -- Nombre IANA, nunca un desfase fijo (ver trigger de validación abajo).
  timezone      text        not null default 'America/Mexico_City',
  currency      char(3)     not null default 'MXN',
  address_line  text,
  city          text,
  state         text,
  postal_code   text,
  -- E.164, p. ej. +525512345678
  public_phone  text,
  logo_url      text,
  -- Los 6 colores del sistema visual (src/styles/tokens.css) en hex.
  theme         jsonb       not null default '{}'::jsonb,
  -- Textos editoriales públicos (hero, propuesta de valor, encabezados, redes).
  site_content  jsonb       not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint tenants_slug_key            unique (slug),
  constraint tenants_slug_format         check (slug ~ '^[a-z0-9-]{3,40}$'),
  constraint tenants_name_not_blank      check (btrim(name) <> ''),
  constraint tenants_status_valid        check (status in ('active', 'suspended')),
  constraint tenants_currency_format     check (currency ~ '^[A-Z]{3}$'),
  constraint tenants_public_phone_e164   check (public_phone is null or public_phone ~ '^\+[1-9][0-9]{7,14}$'),
  constraint tenants_site_content_object check (jsonb_typeof(site_content) = 'object'),
  -- Solo las 6 llaves de color conocidas, y cada valor un hex #RRGGBB.
  -- Evita inyección de CSS cuando el tema se aplique como variables CSS.
  constraint tenants_theme_valid check (
    jsonb_typeof(theme) = 'object'
    and (theme - array[
      'background', 'background_secondary', 'foreground',
      'muted', 'accent', 'border'
    ]) = '{}'::jsonb
    and not jsonb_path_exists(
      theme,
      '$.* ? (@.type() != "string" || !(@ like_regex "^#[0-9A-Fa-f]{6}$"))'
    )
  )
);

comment on table public.tenants is
  'Una fila por barbería. Raíz del aislamiento multi-tenant; nunca se borra desde la app (status = suspended).';
comment on column public.tenants.timezone is
  'Zona horaria IANA (p. ej. America/Mexico_City, America/Tijuana). Interpreta los horarios recurrentes (time).';
comment on column public.tenants.theme is
  'Llaves permitidas: background, background_secondary, foreground, muted, accent, border. Valores #RRGGBB.';

-- Valida que la zona horaria sea un nombre IANA reconocido por PostgreSQL.
-- (Un CHECK no puede consultar pg_timezone_names, por eso es trigger.)
create or replace function private.validate_tenant_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from pg_catalog.pg_timezone_names where name = new.timezone
  ) then
    raise exception 'Zona horaria no válida: %. Usa un nombre IANA, p. ej. America/Mexico_City.', new.timezone
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function private.validate_tenant_timezone() from public;

create trigger tenants_validate_timezone
  before insert or update of timezone on public.tenants
  for each row execute function private.validate_tenant_timezone();

create trigger tenants_set_updated_at
  before update on public.tenants
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- profiles (global, sin tenant_id; 1:1 con auth.users)
-- -----------------------------------------------------------------------------
-- El correo NO se copia aquí: vive en auth.users.
create table public.profiles (
  id          uuid        primary key references auth.users (id) on delete cascade,
  full_name   text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.profiles is
  'Datos de la persona (1:1 con auth.users). El trigger de alta automática llega con el paso de Auth.';

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS y privilegios
-- -----------------------------------------------------------------------------
-- RLS activado desde ya: sin políticas, ningún rol de la API (anon,
-- authenticated) puede leer ni escribir. Las políticas llegan en su paso.
alter table public.plans    enable row level security;
alter table public.tenants  enable row level security;
alter table public.profiles enable row level security;

-- El visitante anónimo nunca accede a tablas.
revoke all on table public.plans, public.tenants, public.profiles from anon;
