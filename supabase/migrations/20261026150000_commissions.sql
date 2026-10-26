-- =============================================================================
-- Barberías SaaS — Migración 21: comisiones (Step 13)
-- -----------------------------------------------------------------------------
-- Reglas de producto (Eduardo):
--   * el admin elige por barbero: % de comisión o salario fijo (sin comisión);
--   * base de la comisión = lo cobrado por servicios (subtotal − descuento);
--   * propinas: 100% para el barbero que atendió;
--   * salario: monto + periodo (semanal, quincenal, mensual);
--   * admin: reporte por periodo y "marcar como pagado"; barbero: "Mis
--     ganancias" (solo lo suyo).
--
-- Contenido:
--   1. barber_compensation: + pay_type, salary_cents, salary_period
--      (commission_rate_bps pasa a nullable; CHECK de coherencia). La tabla
--      estaba vacía en producción.
--   2. appointment_charges: + pay_type, commission_rate_bps, commission_cents
--      congelados al cobrar (cambiar la tasa después no altera el historial).
--      Cobros anteriores: NULL (no había compensación configurada).
--   3. enforce_charge_immutability y charge_appointment (versión de
--      20261026090000 + las columnas de comisión).
--   4. barber_payouts: pagos del admin al barbero por periodo (comisión +
--      propinas calculadas + salario capturado). Sin traslapes de periodo por
--      barbero (exclusión). Inmutables salvo anular. RLS solo lectura.
--   5. record_barber_payout / void_barber_payout (solo admin).
--
-- Errores: P0002 barbero/pago inexistente o sin permiso · 42501 sin sesión ·
-- 23514 datos inválidos (periodo, montos, nada que pagar) · BA009 pago ya
-- anulado · BA011 ya hay un pago que cubre parte de ese periodo.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Compensación: comisión o salario
-- -----------------------------------------------------------------------------
alter table public.barber_compensation
  add column pay_type      text    not null default 'commission',
  add column salary_cents  integer,
  add column salary_period text,
  alter column commission_rate_bps drop not null;

alter table public.barber_compensation
  add constraint barber_compensation_pay_type_valid check (pay_type in ('commission', 'salary')),
  add constraint barber_compensation_salary_period_valid check (
    salary_period is null or salary_period in ('weekly', 'biweekly', 'monthly')
  ),
  add constraint barber_compensation_consistency check (
    (pay_type = 'commission'
       and commission_rate_bps is not null
       and salary_cents is null and salary_period is null)
    or
    (pay_type = 'salary'
       and commission_rate_bps is null
       and salary_cents between 1 and 100000000
       and salary_period is not null)
  );

comment on column public.barber_compensation.pay_type is
  'commission = % de lo cobrado por servicios (commission_rate_bps) · salary = salario fijo (salary_cents por salary_period). Las propinas son siempre 100% del barbero.';

-- -----------------------------------------------------------------------------
-- 2. Comisión congelada en cada cobro
-- -----------------------------------------------------------------------------
alter table public.appointment_charges
  add column pay_type            text,
  add column commission_rate_bps integer,
  add column commission_cents    integer;

alter table public.appointment_charges
  add constraint appointment_charges_pay_type_valid check (pay_type is null or pay_type in ('commission', 'salary')),
  add constraint appointment_charges_commission_consistency check (
    (pay_type = 'commission'
       and commission_rate_bps between 0 and 10000
       and commission_cents between 0 and (subtotal_cents - discount_cents))
    or
    (pay_type is distinct from 'commission'
       and commission_rate_bps is null and commission_cents is null)
  );

comment on column public.appointment_charges.pay_type is
  'Compensación del barbero al cobrar: commission, salary o NULL (sin configurar). Congelada.';
comment on column public.appointment_charges.commission_cents is
  'Comisión del barbero = (subtotal − descuento) × tasa, redondeada al centavo. NULL si no va a comisión. Congelada.';

-- -----------------------------------------------------------------------------
-- 3. Inmutabilidad y cobro (versiones vigentes + comisión)
-- -----------------------------------------------------------------------------
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
  or new.pay_type             is distinct from old.pay_type
  or new.commission_rate_bps  is distinct from old.commission_rate_bps
  or new.commission_cents     is distinct from old.commission_cents
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
  _pay_type  text;
  _rate      integer;
  _commission bigint;
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

  -- ── Comisión del barbero, congelada en el cobro (Step 13) ──────────────
  -- Base = lo cobrado por servicios (subtotal − descuento); la propina es
  -- 100% del barbero y no entra. Redondeo al centavo más cercano.
  select bc.pay_type, bc.commission_rate_bps into _pay_type, _rate
  from public.barber_compensation bc
  where bc.tenant_id = _appt.tenant_id
    and bc.barber_id = _appt.barber_id;

  if _pay_type = 'commission' then
    _commission := ((_subtotal - _discount) * _rate + 5000) / 10000;
  else
    _rate := null;
    _commission := null;
  end if;

  insert into public.appointment_charges (
    tenant_id, appointment_id, barber_id,
    subtotal_cents, discount_cents, discount_reason, tip_cents, total_cents,
    pay_type, commission_rate_bps, commission_cents,
    created_by
  ) values (
    _appt.tenant_id, _appt.id, _appt.barber_id,
    _subtotal, _discount, _reason, _tip, _total,
    _pay_type, _rate, _commission,
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
    'pay_type',        _pay_type,
    'commission_cents', _commission,
    'payments',        coalesce((
      select jsonb_agg(jsonb_build_object('method', cp.method, 'amount_cents', cp.amount_cents) order by cp.method)
      from public.charge_payments cp where cp.charge_id = _charge_id
    ), '[]'::jsonb)
  );
end;
$$;

comment on function public.charge_appointment(uuid, jsonb, integer, text, integer) is
  'Completa (si está confirmada) y cobra una cita: descuento, propina y pagos por método que deben sumar el total. Congela la compensación del barbero (comisión sobre subtotal − descuento). También cobra de nuevo una cita completada cuyo cobro se anuló. Admin: su barbería; barbero: sus citas.';

revoke all on function public.charge_appointment(uuid, jsonb, integer, text, integer) from public, anon;
grant execute on function public.charge_appointment(uuid, jsonb, integer, text, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Pagos a barberos
-- -----------------------------------------------------------------------------
create table public.barber_payouts (
  id               uuid        primary key default gen_random_uuid(),
  tenant_id        uuid        not null references public.tenants (id) on delete cascade,
  barber_id        uuid        not null,
  -- Fechas locales de la barbería (tenants.timezone), ambas incluidas.
  period_start     date        not null,
  period_end       date        not null,
  commission_cents integer     not null default 0,
  tips_cents       integer     not null default 0,
  salary_cents     integer     not null default 0,
  total_cents      integer     not null,
  note             text,
  paid_at          timestamptz not null default now(),
  paid_by          uuid        references auth.users (id) on delete set null,
  voided_at        timestamptz,
  voided_by        uuid        references auth.users (id) on delete set null,
  void_reason      text,

  constraint barber_payouts_period_order check (period_end >= period_start),
  constraint barber_payouts_amounts_non_negative check (commission_cents >= 0 and tips_cents >= 0 and salary_cents between 0 and 100000000),
  constraint barber_payouts_total_formula check (total_cents = commission_cents + tips_cents + salary_cents),
  constraint barber_payouts_total_positive check (total_cents > 0),
  constraint barber_payouts_note_valid check (note is null or (btrim(note) <> '' and char_length(note) <= 300)),
  constraint barber_payouts_void_consistency check ((voided_at is null) = (void_reason is null)),
  constraint barber_payouts_voided_by_requires_at check (voided_at is not null or voided_by is null),
  constraint barber_payouts_void_reason_valid check (
    void_reason is null or (btrim(void_reason) <> '' and char_length(void_reason) <= 500)
  ),
  constraint barber_payouts_barber_fkey
    foreign key (tenant_id, barber_id) references public.barbers (tenant_id, id),
  -- Un día no se paga dos veces al mismo barbero (los anulados no cuentan).
  constraint barber_payouts_no_overlap
    exclude using gist (
      barber_id with =,
      daterange(period_start, period_end, '[]') with &&
    )
    where (voided_at is null)
);

comment on table public.barber_payouts is
  'Pagos del admin a un barbero por un periodo (fechas locales): comisión y propinas calculadas de los cobros + salario capturado. Inmutables salvo anular.';

create index barber_payouts_tenant_barber_idx
  on public.barber_payouts (tenant_id, barber_id, period_start);

create or replace function private.enforce_payout_immutability()
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
    raise exception 'Un pago no se puede borrar; el admin puede anularlo'
      using errcode = '42501';
  end if;

  if new.id               is distinct from old.id
  or new.tenant_id        is distinct from old.tenant_id
  or new.barber_id        is distinct from old.barber_id
  or new.period_start     is distinct from old.period_start
  or new.period_end       is distinct from old.period_end
  or new.commission_cents is distinct from old.commission_cents
  or new.tips_cents       is distinct from old.tips_cents
  or new.salary_cents     is distinct from old.salary_cents
  or new.total_cents      is distinct from old.total_cents
  or new.note             is distinct from old.note
  or new.paid_at          is distinct from old.paid_at
  or (new.paid_by is distinct from old.paid_by and not (_nested and new.paid_by is null)) then
    raise exception 'Un pago no se puede modificar; el admin puede anularlo y registrar uno nuevo'
      using errcode = '42501';
  end if;

  if old.voided_at is not null then
    if new.voided_at   is distinct from old.voided_at
    or new.void_reason is distinct from old.void_reason
    or (new.voided_by is distinct from old.voided_by and not (_nested and new.voided_by is null)) then
      raise exception 'El pago ya está anulado'
        using errcode = 'BA009';
    end if;
  elsif new.voided_at is not null then
    new.voided_at := now();
    new.voided_by := (select auth.uid());
  elsif new.voided_by is not null or new.void_reason is not null then
    raise exception 'Datos de anulación incompletos'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_payout_immutability() from public, anon, authenticated;

create trigger barber_payouts_immutable
  before update or delete on public.barber_payouts
  for each row execute function private.enforce_payout_immutability();

alter table public.barber_payouts enable row level security;

revoke all on table public.barber_payouts from anon;
revoke insert, update, delete, truncate, references, trigger on table public.barber_payouts from authenticated;

create policy barber_payouts_select on public.barber_payouts
  for select to authenticated
  using (
    (select private.is_admin(tenant_id))
    or barber_id = (select private.my_barber_id(tenant_id))
  );

-- -----------------------------------------------------------------------------
-- 5. Registrar y anular pagos (solo admin)
-- -----------------------------------------------------------------------------
create or replace function public.record_barber_payout(
  _barber_id    uuid,
  _period_start date,
  _period_end   date,
  _salary_cents integer default 0,
  _note         text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid        uuid := (select auth.uid());
  _tenant_id  uuid;
  _tz         text;
  _salary     integer := coalesce(_salary_cents, 0);
  _clean_note text := nullif(btrim(coalesce(_note, '')), '');
  _commission bigint;
  _tips       bigint;
  _charges    integer;
  _payout_id  uuid;
begin
  if _uid is null then
    raise exception 'Inicia sesión para registrar pagos'
      using errcode = '42501';
  end if;

  select b.tenant_id, t.timezone into _tenant_id, _tz
  from public.barbers b
  join public.tenants t on t.id = b.tenant_id and t.status = 'active'
  where b.id = _barber_id;

  if not found or not (select private.is_admin(_tenant_id)) then
    raise exception 'Barbero no encontrado'
      using errcode = 'P0002';
  end if;

  if _period_start is null or _period_end is null or _period_end < _period_start then
    raise exception 'El periodo no es válido'
      using errcode = 'check_violation';
  end if;
  if _period_end > (now() at time zone _tz)::date then
    raise exception 'No puedes registrar pagos de días que aún no pasan'
      using errcode = 'check_violation';
  end if;
  if _period_end - _period_start > 366 then
    raise exception 'El periodo no puede ser mayor a un año'
      using errcode = 'check_violation';
  end if;
  if _salary < 0 or _salary > 100000000 then
    raise exception 'El salario no es válido'
      using errcode = 'check_violation';
  end if;
  if char_length(_clean_note) > 300 then
    raise exception 'La nota es demasiado larga (máximo 300 caracteres)'
      using errcode = 'check_violation';
  end if;

  -- Comisión y propinas de los cobros activos del barbero en el periodo
  -- (fecha local del cobro en la zona de la barbería).
  select coalesce(sum(c.commission_cents), 0), coalesce(sum(c.tip_cents), 0), count(*)
    into _commission, _tips, _charges
  from public.appointment_charges c
  where c.tenant_id = _tenant_id
    and c.barber_id = _barber_id
    and c.voided_at is null
    and (c.created_at at time zone _tz)::date between _period_start and _period_end;

  if _commission + _tips + _salary = 0 then
    raise exception 'No hay nada que pagar en ese periodo'
      using errcode = 'check_violation';
  end if;

  begin
    insert into public.barber_payouts (
      tenant_id, barber_id, period_start, period_end,
      commission_cents, tips_cents, salary_cents, total_cents,
      note, paid_by
    ) values (
      _tenant_id, _barber_id, _period_start, _period_end,
      _commission, _tips, _salary, _commission + _tips + _salary,
      _clean_note, _uid
    )
    returning id into _payout_id;
  exception
    when exclusion_violation then
      raise exception 'Ya hay un pago registrado que cubre parte de ese periodo'
        using errcode = 'BA011';
  end;

  return jsonb_build_object(
    'payout_id',        _payout_id,
    'barber_id',        _barber_id,
    'period_start',     _period_start,
    'period_end',       _period_end,
    'charges',          _charges,
    'commission_cents', _commission,
    'tips_cents',       _tips,
    'salary_cents',     _salary,
    'total_cents',      _commission + _tips + _salary
  );
end;
$$;

comment on function public.record_barber_payout(uuid, date, date, integer, text) is
  'El admin marca como pagado el periodo de un barbero: comisión y propinas se calculan de los cobros activos (fecha local); el salario se captura. Sin traslapes (BA011).';

revoke all on function public.record_barber_payout(uuid, date, date, integer, text) from public, anon;
grant execute on function public.record_barber_payout(uuid, date, date, integer, text) to authenticated;

create or replace function public.void_barber_payout(
  _payout_id uuid,
  _reason    text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid    uuid := (select auth.uid());
  _payout record;
  _clean  text := nullif(btrim(coalesce(_reason, '')), '');
begin
  if _uid is null then
    raise exception 'Inicia sesión para anular pagos'
      using errcode = '42501';
  end if;

  select p.id, p.tenant_id, p.voided_at into _payout
  from public.barber_payouts p
  where p.id = _payout_id
  for update;

  if not found or not (select private.is_admin(_payout.tenant_id)) then
    raise exception 'Pago no encontrado'
      using errcode = 'P0002';
  end if;
  if _payout.voided_at is not null then
    raise exception 'El pago ya está anulado'
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

  update public.barber_payouts
     set voided_at = now(), voided_by = _uid, void_reason = _clean
   where id = _payout.id;

  return jsonb_build_object('payout_id', _payout.id, 'voided', true);
end;
$$;

comment on function public.void_barber_payout(uuid, text) is
  'El admin anula un pago a barbero (con motivo); el periodo queda libre para registrarlo de nuevo.';

revoke all on function public.void_barber_payout(uuid, text) from public, anon;
grant execute on function public.void_barber_payout(uuid, text) to authenticated;
