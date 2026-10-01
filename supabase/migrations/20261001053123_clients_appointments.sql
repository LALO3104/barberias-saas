-- =============================================================================
-- Barberías SaaS — Migración 5/5: clients, appointments, appointment_services
-- -----------------------------------------------------------------------------
-- Integridad multi-tenant (crítico): toda referencia entre tablas de una
-- barbería es una FK compuesta (tenant_id, <id>). Así la base rechaza:
--   * una cita de Kings que apunte a un barbero o cliente de Alpha;
--   * una línea de cita de Kings que apunte a un servicio de Alpha;
-- sin importar qué código intente insertarla.
--
-- Doble reserva: restricción de exclusión por barbero y rango de tiempo.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- clients
-- -----------------------------------------------------------------------------
-- Pertenecen a UNA barbería. La misma persona en Kings y en Alpha son dos filas
-- independientes (Kings no debe saber que su cliente también va a Alpha).
create table public.clients (
  id          uuid        primary key default gen_random_uuid(),
  tenant_id   uuid        not null references public.tenants (id) on delete cascade,
  full_name   text        not null,
  -- E.164 normalizado (+525512345678). Opcional para walk-ins.
  phone       text,
  email       text,
  -- Notas internas del personal; nunca públicas.
  notes       text,
  -- Nulo = creado desde la reserva pública.
  created_by  uuid        references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Anonimización (dato personal): nombre genérico, contacto a nulo, fecha.
  deleted_at  timestamptz,

  constraint clients_tenant_id_id_key      unique (tenant_id, id),
  constraint clients_full_name_not_blank   check (btrim(full_name) <> ''),
  constraint clients_phone_e164            check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  constraint clients_email_format          check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

comment on table public.clients is
  'Clientes de una barbería. No se borran: se anonimizan (deleted_at). Las citas siguen contando en estadísticas.';

-- Un teléfono identifica a un cliente dentro de su barbería. Los anonimizados
-- quedan fuera de la regla para que el teléfono pueda volver a registrarse.
create unique index clients_tenant_phone_key
  on public.clients (tenant_id, phone)
  where phone is not null and deleted_at is null;

create trigger clients_set_updated_at
  before update on public.clients
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- appointments
-- -----------------------------------------------------------------------------
create table public.appointments (
  id                   uuid                      primary key default gen_random_uuid(),
  tenant_id            uuid                      not null references public.tenants (id) on delete cascade,
  barber_id            uuid                      not null,
  client_id            uuid                      not null,
  start_at             timestamptz               not null,
  end_at               timestamptz               not null,
  -- La reserva pública entra como pending; el admin la aprueba o la rechaza.
  status               public.appointment_status not null default 'pending',
  source               public.appointment_source not null,
  -- Lo que escribió el cliente al reservar.
  client_note          text,
  -- Nulo = reserva pública.
  created_by           uuid                      references auth.users (id) on delete set null,
  completed_at         timestamptz,
  cancelled_at         timestamptz,
  -- Nulo con cancelled_at = canceló el cliente; un usuario = la barbería.
  cancelled_by         uuid                      references auth.users (id) on delete set null,
  cancellation_reason  text,
  created_at           timestamptz               not null default now(),
  updated_at           timestamptz               not null default now(),

  -- Destino de la FK compuesta de appointment_services.
  constraint appointments_tenant_id_id_key unique (tenant_id, id),

  constraint appointments_end_after_start check (end_at > start_at),

  -- Coherencia entre estado y marcas de tiempo (las transiciones válidas
  -- se harán cumplir con un trigger en un paso posterior).
  constraint appointments_completed_consistency
    check ((status = 'completed') = (completed_at is not null)),
  constraint appointments_cancelled_consistency
    check ((status = 'cancelled') = (cancelled_at is not null)),
  constraint appointments_cancel_fields_only_when_cancelled
    check (status = 'cancelled' or (cancelled_by is null and cancellation_reason is null)),

  -- Barbero y cliente de la MISMA barbería. NO ACTION: barberos y clientes no
  -- se borran (se desactivan / anonimizan).
  constraint appointments_barber_fkey
    foreign key (tenant_id, barber_id)
    references public.barbers (tenant_id, id),
  constraint appointments_client_fkey
    foreign key (tenant_id, client_id)
    references public.clients (tenant_id, id),

  -- Sin doble reserva: el mismo barbero no puede tener dos citas vivas cuyos
  -- rangos se traslapen. Rango semiabierto [) => 10:00–11:00 y 11:00–12:00 no
  -- chocan; 10:00–11:00 y 10:30–11:30 sí. Las canceladas y no_show liberan el
  -- horario. Seguro ante concurrencia: la segunda transacción falla con 23P01.
  constraint appointments_no_overlap
    exclude using gist (
      barber_id with =,
      tstzrange(start_at, end_at, '[)') with &&
    )
    where (status in ('pending', 'confirmed', 'completed'))
);

comment on table public.appointments is
  'Citas. Nunca se borran: se cancelan. El total es la suma de sus líneas (no se guarda dos veces).';

-- Agenda del local por día y estadísticas por periodo.
create index appointments_tenant_start_idx  on public.appointments (tenant_id, start_at);
-- "Mis citas de hoy" del barbero, ordenadas.
create index appointments_barber_start_idx  on public.appointments (barber_id, start_at);
-- Historial del cliente; primera visita (nuevo vs. recurrente).
create index appointments_client_start_idx  on public.appointments (client_id, start_at);

create trigger appointments_set_updated_at
  before update on public.appointments
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- appointment_services — líneas de la cita con COPIA de lo vigente
-- -----------------------------------------------------------------------------
-- Si el catálogo cambia ($100 → $120), las líneas ya creadas no cambian.
-- La comisión se copia por línea para permitir, en el futuro, tasas distintas
-- por servicio sin migrar datos.
create table public.appointment_services (
  id                   uuid        primary key default gen_random_uuid(),
  tenant_id            uuid        not null references public.tenants (id) on delete cascade,
  appointment_id       uuid        not null,
  service_id           uuid        not null,
  service_name         text        not null,
  price_cents          integer     not null,
  duration_minutes     integer     not null,
  -- Se copia al completar la cita (trigger en un paso posterior).
  commission_rate_bps  integer,
  position             smallint    not null default 0,
  created_at           timestamptz not null default now(),

  constraint appointment_services_name_not_blank      check (btrim(service_name) <> ''),
  constraint appointment_services_price_non_negative  check (price_cents >= 0),
  constraint appointment_services_duration_positive   check (duration_minutes > 0),
  constraint appointment_services_rate_range
    check (commission_rate_bps is null or commission_rate_bps between 0 and 10000),
  constraint appointment_services_position_non_negative check (position >= 0),

  -- Las líneas son parte de la cita.
  constraint appointment_services_appointment_fkey
    foreign key (tenant_id, appointment_id)
    references public.appointments (tenant_id, id)
    on delete cascade,
  -- Servicio de la MISMA barbería. NO ACTION: los servicios se desactivan.
  constraint appointment_services_service_fkey
    foreign key (tenant_id, service_id)
    references public.services (tenant_id, id)
);

comment on table public.appointment_services is
  'Líneas de una cita: servicio + nombre, precio (centavos), duración y comisión (bps) copiados.';

-- Cargar las líneas de una cita.
create index appointment_services_appointment_idx
  on public.appointment_services (appointment_id);
-- Estadísticas por servicio.
create index appointment_services_tenant_service_idx
  on public.appointment_services (tenant_id, service_id);

-- -----------------------------------------------------------------------------
-- RLS y privilegios
-- -----------------------------------------------------------------------------
alter table public.clients              enable row level security;
alter table public.appointments         enable row level security;
alter table public.appointment_services enable row level security;

revoke all on table
  public.clients, public.appointments, public.appointment_services
from anon;
