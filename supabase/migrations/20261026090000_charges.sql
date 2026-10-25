-- =============================================================================
-- Barberías SaaS — Migración 20: cobro manual (Step 12)
-- -----------------------------------------------------------------------------
-- Reglas de producto (Eduardo):
--   * se cobra AL COMPLETAR la cita ("Completar y cobrar"); ninguna cita
--     completada queda sin cobro;
--   * descuento (con motivo opcional) y propina, aparte;
--   * pago mixto: uno o más pagos por cita, cada uno con su método
--     (efectivo, tarjeta en terminal, transferencia);
--   * admin → cualquier cita de su barbería; barbero → sus propias citas;
--   * un cobro no se edita ni se borra: solo el admin lo ANULA (con motivo) y
--     después se registra de nuevo.
--
-- Contenido:
--   1. enum payment_method.
--   2. appointment_charges (cobro) y charge_payments (pagos del cobro), con
--      CHECKs de montos, inmutabilidad por trigger y RLS de solo lectura.
--   3. Trigger diferido en appointments: una cita que pasa a `completed` debe
--      tener un cobro activo al confirmar la transacción (BA010), por
--      cualquier ruta (también UPDATE directo o set_appointment_status).
--   4. public.charge_appointment: completa (si está confirmada) y cobra; o
--      cobra de nuevo una cita completada cuyo cobro se anuló.
--   5. public.void_charge: el admin anula un cobro.
--
-- Montos en centavos (integer). subtotal = suma de las líneas de la cita (ya
-- congeladas al completarla); total = subtotal − descuento + propina; la suma
-- de los pagos = total (total 0 → sin pagos: cortesía).
--
-- Errores: P0002 cita/cobro inexistente o sin permiso · 42501 sin sesión ·
-- BA009 la cita no se puede cobrar (estado o ya tiene cobro activo / cobro ya
-- anulado) · BA010 cita completada sin cobro · 23514 montos o datos inválidos.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Métodos de pago
-- -----------------------------------------------------------------------------
create type public.payment_method as enum ('cash', 'card', 'transfer');

comment on type public.payment_method is
  'cash = efectivo · card = tarjeta en terminal · transfer = transferencia.';

-- -----------------------------------------------------------------------------
-- 2. Cobros y pagos
-- -----------------------------------------------------------------------------
create table public.appointment_charges (
  id               uuid        primary key default gen_random_uuid(),
  tenant_id        uuid        not null references public.tenants (id) on delete cascade,
  appointment_id   uuid        not null,
  -- Barbero que atendió (la cita completada ya no se mueve). Base de comisiones.
  barber_id        uuid        not null,
  subtotal_cents   integer     not null,
  discount_cents   integer     not null default 0,
  discount_reason  text,
  tip_cents        integer     not null default 0,
  total_cents      integer     not null,
  created_by       uuid        references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  voided_at        timestamptz,
  voided_by        uuid        references auth.users (id) on delete set null,
  void_reason      text,

  constraint appointment_charges_tenant_id_id_key unique (tenant_id, id),
  constraint appointment_charges_subtotal_non_negative check (subtotal_cents >= 0),
  constraint appointment_charges_discount_range check (discount_cents between 0 and subtotal_cents),
  constraint appointment_charges_tip_range check (tip_cents between 0 and 10000000),
  constraint appointment_charges_total_formula check (total_cents = subtotal_cents - discount_cents + tip_cents),
  constraint appointment_charges_discount_reason_valid check (
    discount_reason is null or (btrim(discount_reason) <> '' and char_length(discount_reason) <= 200)
  ),
  constraint appointment_charges_void_consistency check ((voided_at is null) = (void_reason is null)),
  constraint appointment_charges_voided_by_requires_at check (voided_at is not null or voided_by is null),
  constraint appointment_charges_void_reason_valid check (
    void_reason is null or (btrim(void_reason) <> '' and char_length(void_reason) <= 500)
  ),

  -- Misma barbería. NO ACTION: citas y barberos no se borran; la purga en
  -- cascada desde tenants funciona porque se verifica al final de la sentencia.
  constraint appointment_charges_appointment_fkey
    foreign key (tenant_id, appointment_id) references public.appointments (tenant_id, id),
  constraint appointment_charges_barber_fkey
    foreign key (tenant_id, barber_id) references public.barbers (tenant_id, id)
);

comment on table public.appointment_charges is
  'Cobro manual de una cita completada. Un solo cobro activo por cita (los anulados quedan como historial). Inmutable salvo la anulación.';

-- Un solo cobro activo por cita.
create unique index appointment_charges_active_key
  on public.appointment_charges (appointment_id)
  where voided_at is null;
-- Corte de caja y reportes por periodo / barbero.
create index appointment_charges_tenant_created_idx
  on public.appointment_charges (tenant_id, created_at);
create index appointment_charges_tenant_barber_created_idx
  on public.appointment_charges (tenant_id, barber_id, created_at);

create table public.charge_payments (
  id            uuid                  primary key default gen_random_uuid(),
  tenant_id     uuid                  not null references public.tenants (id) on delete cascade,
  charge_id     uuid                  not null,
  method        public.payment_method not null,
  amount_cents  integer               not null,
  created_at    timestamptz           not null default now(),

  constraint charge_payments_amount_range check (amount_cents between 1 and 20000000),
  constraint charge_payments_one_per_method unique (charge_id, method),
  constraint charge_payments_charge_fkey
    foreign key (tenant_id, charge_id) references public.appointment_charges (tenant_id, id)
);

comment on table public.charge_payments is
  'Pagos que forman un cobro (pago mixto): uno por método. Inmutables.';

create index charge_payments_charge_idx on public.charge_payments (charge_id);

-- Inmutabilidad de cobros: solo se permite anular una vez; nada se borra
-- (salvo la purga en cascada de una barbería).
create or replace function private.enforce_charge_immutability()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  _nested boolean := pg_trigger_depth() > 1;
begin
  if tg_op = 'DELETE' then
    if _nested then
      return old;
    end if;
    raise exception 'Un cobro no se puede borrar; el admin puede anularlo'
      using errcode = '42501';
  end if;

  if new.id              is distinct from old.id
  or new.tenant_id       is distinct from old.tenant_id
  or new.appointment_id  is distinct from old.appointment_id
  or new.barber_id       is distinct from old.barber_id
  or new.subtotal_cents  is distinct from old.subtotal_cents
  or new.discount_cents  is distinct from old.discount_cents
  or new.discount_reason is distinct from old.discount_reason
  or new.tip_cents       is distinct from old.tip_cents
  or new.total_cents     is distinct from old.total_cents
  or new.created_at      is distinct from old.created_at
  or (new.created_by is distinct from old.created_by and not (_nested and new.created_by is null)) then
    raise exception 'Un cobro no se puede modificar; el admin puede anularlo y registrar uno nuevo'
      using errcode = '42501';
  end if;

  if old.voided_at is not null then
    if new.voided_at   is distinct from old.voided_at
    or new.void_reason is distinct from old.void_reason
    or (new.voided_by is distinct from old.voided_by and not (_nested and new.voided_by is null)) then
      raise exception 'El cobro ya está anulado'
        using errcode = 'BA009';
    end if;
  elsif new.voided_at is not null then
    -- Anulación: la marca la fija el servidor.
    new.voided_at := now();
    new.voided_by := (select auth.uid());
  elsif new.voided_by is not null or new.void_reason is not null then
    raise exception 'Datos de anulación incompletos'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_charge_immutability() from public, anon, authenticated;

create trigger appointment_charges_immutable
  before update or delete on public.appointment_charges
  for each row execute function private.enforce_charge_immutability();

create or replace function private.enforce_payment_immutability()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;  -- purga en cascada de una barbería
  end if;
  raise exception 'Los pagos de un cobro no se modifican ni se borran; el admin puede anular el cobro'
    using errcode = '42501';
end;
$$;

revoke all on function private.enforce_payment_immutability() from public, anon, authenticated;

create trigger charge_payments_immutable
  before update or delete on public.charge_payments
  for each row execute function private.enforce_payment_immutability();

-- RLS: solo lectura por API (admin → su barbería; barbero → sus cobros).
alter table public.appointment_charges enable row level security;
alter table public.charge_payments     enable row level security;

revoke all on table public.appointment_charges, public.charge_payments from anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.appointment_charges, public.charge_payments from authenticated;

create policy appointment_charges_select on public.appointment_charges
  for select to authenticated
  using (
    (select private.is_admin(tenant_id))
    or barber_id = (select private.my_barber_id(tenant_id))
  );

create policy charge_payments_select on public.charge_payments
  for select to authenticated
  using (
    (select private.is_admin(tenant_id))
    or exists (
      select 1 from public.appointment_charges c
      where c.tenant_id = charge_payments.tenant_id
        and c.id = charge_payments.charge_id
        and c.barber_id = (select private.my_barber_id(charge_payments.tenant_id))
    )
  );

-- -----------------------------------------------------------------------------
-- 3. Ninguna cita completada sin cobro (verificación al confirmar)
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER solo para leer appointment_charges sin depender de la RLS
-- de quien completa. Diferido: charge_appointment completa la cita y después
-- inserta el cobro en la misma transacción.
create or replace function private.require_charge_on_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.appointment_charges c
    where c.tenant_id = new.tenant_id
      and c.appointment_id = new.id
      and c.voided_at is null
  ) then
    raise exception 'Registra el cobro para completar la cita'
      using errcode = 'BA010';
  end if;
  return null;
end;
$$;

revoke all on function private.require_charge_on_completion() from public, anon, authenticated;

create constraint trigger appointments_require_charge
  after update of status on public.appointments
  deferrable initially deferred
  for each row
  when (new.status = 'completed'::public.appointment_status
        and old.status is distinct from 'completed'::public.appointment_status)
  execute function private.require_charge_on_completion();

-- -----------------------------------------------------------------------------
-- 4. charge_appointment
-- -----------------------------------------------------------------------------
-- _payments: arreglo JSON de { "method": "cash"|"card"|"transfer",
--                              "amount_cents": entero > 0 }, un método a lo sumo una vez.
create or replace function public.charge_appointment(
  _appointment_id  uuid,
  _payments        jsonb,
  _discount_cents  integer default 0,
  _discount_reason text    default null,
  _tip_cents       integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid       uuid := (select auth.uid());
  _appt      record;
  _completed boolean := false;
  _subtotal  bigint;
  _discount  integer := coalesce(_discount_cents, 0);
  _tip       integer := coalesce(_tip_cents, 0);
  _reason    text := nullif(btrim(coalesce(_discount_reason, '')), '');
  _total     bigint;
  _n         integer;
  _sum       bigint;
  _charge_id uuid;
begin
  if _uid is null then
    raise exception 'Inicia sesión para cobrar'
      using errcode = '42501';
  end if;

  -- ── Cita (bloqueada) y permiso: admin o el barbero de la cita ──────────
  select a.id, a.tenant_id, a.barber_id, a.status
    into _appt
  from public.appointments a
  join public.tenants t on t.id = a.tenant_id and t.status = 'active'
  where a.id = _appointment_id
  for update of a;

  if not found or not (
       (select private.is_admin(_appt.tenant_id))
    or exists (
         select 1 from public.barbers b
         where b.id = _appt.barber_id
           and b.tenant_id = _appt.tenant_id
           and b.is_active = true
           and b.id = (select private.my_barber_id(_appt.tenant_id))
       )
  ) then
    raise exception 'Cita no encontrada'
      using errcode = 'P0002';
  end if;

  if _appt.status = 'completed'::public.appointment_status then
    if exists (
      select 1 from public.appointment_charges c
      where c.tenant_id = _appt.tenant_id and c.appointment_id = _appt.id and c.voided_at is null
    ) then
      raise exception 'Esta cita ya tiene un cobro registrado'
        using errcode = 'BA009';
    end if;
  elsif _appt.status <> 'confirmed'::public.appointment_status then
    raise exception 'Solo se pueden cobrar citas confirmadas (o completadas sin cobro)'
      using errcode = 'BA009';
  end if;

  -- ── Montos ─────────────────────────────────────────────────────────────
  select coalesce(sum(l.price_cents), 0) into _subtotal
  from public.appointment_services l
  where l.tenant_id = _appt.tenant_id
    and l.appointment_id = _appt.id;

  if _discount < 0 or _discount > _subtotal then
    raise exception 'El descuento debe estar entre 0 y el precio de los servicios'
      using errcode = 'check_violation';
  end if;
  if _discount = 0 then
    _reason := null;
  elsif char_length(_reason) > 200 then
    raise exception 'El motivo del descuento es demasiado largo (máximo 200 caracteres)'
      using errcode = 'check_violation';
  end if;
  if _tip < 0 or _tip > 10000000 then
    raise exception 'La propina no es válida'
      using errcode = 'check_violation';
  end if;

  _total := _subtotal - _discount + _tip;

  -- ── Pagos ──────────────────────────────────────────────────────────────
  if _payments is null or jsonb_typeof(_payments) <> 'array' then
    raise exception 'Los pagos no son válidos'
      using errcode = 'check_violation';
  end if;

  _n := jsonb_array_length(_payments);
  if _n > 3 then
    raise exception 'Usa como máximo un pago por método'
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1 from jsonb_array_elements(_payments) p
    where jsonb_typeof(p) <> 'object'
       or coalesce(p->>'method', '') not in ('cash', 'card', 'transfer')
       -- CASE: la conversión solo ocurre si el formato ya es válido.
       or case when coalesce(p->>'amount_cents', '') ~ '^[0-9]{1,9}$'
               then (p->>'amount_cents')::bigint < 1
               else true
          end
  ) then
    raise exception 'Cada pago necesita un método válido y un monto mayor a 0'
      using errcode = 'check_violation';
  end if;

  if (select count(distinct p->>'method') from jsonb_array_elements(_payments) p) <> _n then
    raise exception 'Usa como máximo un pago por método'
      using errcode = 'check_violation';
  end if;

  select coalesce(sum((p->>'amount_cents')::bigint), 0) into _sum
  from jsonb_array_elements(_payments) p;

  if _sum <> _total then
    raise exception 'Los pagos (% centavos) no suman el total a cobrar (% centavos)', _sum, _total
      using errcode = 'check_violation';
  end if;

  -- ── Completar (si estaba confirmada) y registrar ───────────────────────
  if _appt.status = 'confirmed'::public.appointment_status then
    update public.appointments
       set status = 'completed'::public.appointment_status
     where id = _appt.id;
    _completed := true;
  end if;

  insert into public.appointment_charges (
    tenant_id, appointment_id, barber_id,
    subtotal_cents, discount_cents, discount_reason, tip_cents, total_cents,
    created_by
  ) values (
    _appt.tenant_id, _appt.id, _appt.barber_id,
    _subtotal, _discount, _reason, _tip, _total,
    _uid
  )
  returning id into _charge_id;

  insert into public.charge_payments (tenant_id, charge_id, method, amount_cents)
  select _appt.tenant_id, _charge_id, (p->>'method')::public.payment_method, (p->>'amount_cents')::integer
  from jsonb_array_elements(_payments) p;

  return jsonb_build_object(
    'charge_id',       _charge_id,
    'appointment_id',  _appt.id,
    'completed',       _completed,
    'subtotal_cents',  _subtotal,
    'discount_cents',  _discount,
    'tip_cents',       _tip,
    'total_cents',     _total,
    'payments',        coalesce((
      select jsonb_agg(jsonb_build_object('method', cp.method, 'amount_cents', cp.amount_cents) order by cp.method)
      from public.charge_payments cp where cp.charge_id = _charge_id
    ), '[]'::jsonb)
  );
end;
$$;

comment on function public.charge_appointment(uuid, jsonb, integer, text, integer) is
  'Completa (si está confirmada) y cobra una cita: descuento, propina y pagos por método que deben sumar el total. También cobra de nuevo una cita completada cuyo cobro se anuló. Admin: su barbería; barbero: sus citas.';

revoke all on function public.charge_appointment(uuid, jsonb, integer, text, integer) from public, anon;
grant execute on function public.charge_appointment(uuid, jsonb, integer, text, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. void_charge (solo admin)
-- -----------------------------------------------------------------------------
create or replace function public.void_charge(
  _charge_id uuid,
  _reason    text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid    uuid := (select auth.uid());
  _charge record;
  _clean  text := nullif(btrim(coalesce(_reason, '')), '');
begin
  if _uid is null then
    raise exception 'Inicia sesión para anular cobros'
      using errcode = '42501';
  end if;

  select c.id, c.tenant_id, c.appointment_id, c.voided_at
    into _charge
  from public.appointment_charges c
  where c.id = _charge_id
  for update;

  if not found or not (select private.is_admin(_charge.tenant_id)) then
    raise exception 'Cobro no encontrado'
      using errcode = 'P0002';
  end if;

  if _charge.voided_at is not null then
    raise exception 'El cobro ya está anulado'
      using errcode = 'BA009';
  end if;

  if _clean is null then
    raise exception 'Indica el motivo de la anulación'
      using errcode = 'check_violation';
  end if;
  if char_length(_clean) > 500 then
    raise exception 'El motivo es demasiado largo (máximo 500 caracteres)'
      using errcode = 'check_violation';
  end if;

  update public.appointment_charges
     set voided_at = now(),
         voided_by = _uid,
         void_reason = _clean
   where id = _charge.id;

  return jsonb_build_object('charge_id', _charge.id, 'appointment_id', _charge.appointment_id, 'voided', true);
end;
$$;

comment on function public.void_charge(uuid, text) is
  'El admin anula un cobro con motivo (queda como historial). Después la cita puede cobrarse de nuevo con charge_appointment.';

revoke all on function public.void_charge(uuid, text) from public, anon;
grant execute on function public.void_charge(uuid, text) to authenticated;
