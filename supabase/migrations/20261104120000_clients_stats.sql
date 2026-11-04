-- =============================================================================
-- Step 15 — Clientes y estadísticas
-- -----------------------------------------------------------------------------
-- 1. clients_select: el barbero solo ve a los clientes con los que tiene o tuvo
--    una cita (antes veía toda la barbería). El admin ve a todos.
-- 2. get_clients (INVOKER): directorio con visitas y gasto. RLS define el
--    alcance: para el barbero, los números son solo de sus citas.
-- 3. set_client_note (DEFINER): notas internas; admin y barbero que lo atendió.
-- 4. update_client (DEFINER): nombre y teléfono; solo admin.
-- 5. get_business_stats (INVOKER): estadísticas de un periodo. Se calculan en
--    SQL porque PostgREST corta las consultas en 1000 filas.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Visibilidad de clientes
-- -----------------------------------------------------------------------------
drop policy clients_select on public.clients;

create policy clients_select on public.clients
  for select to authenticated
  using (
    (select private.is_admin(tenant_id))
    or exists (
      select 1
      from public.appointments a
      where a.tenant_id = clients.tenant_id
        and a.client_id = clients.id
        and a.barber_id = (select private.my_barber_id(clients.tenant_id))
    )
  );

-- -----------------------------------------------------------------------------
-- 2. get_clients
-- -----------------------------------------------------------------------------
-- _search: nombre (sin distinguir acentos ni mayúsculas) o teléfono.
-- _client_id: un solo cliente (ficha). Fuera de alcance → items vacío.
create or replace function public.get_clients(
  _tenant_id uuid,
  _search    text    default null,
  _client_id uuid    default null,
  _limit     integer default 30,
  _offset    integer default 0
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  _needle text := nullif(translate(lower(btrim(coalesce(_search, ''))), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunaeiouun'), '');
  _digits text := regexp_replace(coalesce(_search, ''), '\D', '', 'g');
  _size   integer := least(greatest(coalesce(_limit, 30), 1), 100);
  _skip   integer := greatest(coalesce(_offset, 0), 0);
  _result jsonb;
begin
  if _tenant_id is null or not private.is_member(_tenant_id) then
    raise exception 'No tienes acceso a esta barbería'
      using errcode = '42501';
  end if;

  with visible as (
    select c.id, c.full_name, c.phone, c.notes, c.created_at
    from public.clients c
    where c.tenant_id = _tenant_id
      and c.deleted_at is null
      and (_client_id is null or c.id = _client_id)
      and (
        _needle is null
        or position(_needle in translate(lower(c.full_name), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunaeiouun')) > 0
        or (_digits <> '' and position(_digits in coalesce(c.phone, '')) > 0)
      )
  ),
  visits as (
    select a.client_id,
           count(*) filter (where a.status = 'completed') as visits,
           count(*) filter (where a.status = 'no_show') as no_shows,
           max(a.start_at) filter (where a.status = 'completed') as last_visit,
           min(a.start_at) filter (where a.status in ('pending', 'confirmed') and a.start_at >= now()) as next_visit
    from public.appointments a
    where a.tenant_id = _tenant_id
    group by a.client_id
  ),
  spent as (
    select a.client_id, sum(ch.total_cents)::bigint as spent_cents
    from public.appointment_charges ch
    join public.appointments a on a.tenant_id = ch.tenant_id and a.id = ch.appointment_id
    where ch.tenant_id = _tenant_id
      and ch.voided_at is null
    group by a.client_id
  ),
  listed as (
    select v.id, v.full_name, v.phone, v.notes, v.created_at,
           coalesce(x.visits, 0) as visits,
           coalesce(x.no_shows, 0) as no_shows,
           x.last_visit,
           x.next_visit,
           coalesce(s.spent_cents, 0) as spent_cents
    from visible v
    left join visits x on x.client_id = v.id
    left join spent s on s.client_id = v.id
  ),
  page as (
    select l.*
    from listed l
    order by coalesce(l.next_visit, l.last_visit, l.created_at) desc, l.full_name, l.id
    limit _size offset _skip
  )
  select jsonb_build_object(
    'total', (select count(*) from listed),
    'items', coalesce(
      (select jsonb_agg(to_jsonb(p) order by coalesce(p.next_visit, p.last_visit, p.created_at) desc, p.full_name, p.id) from page p),
      '[]'::jsonb
    )
  ) into _result;

  return _result;
end;
$$;

comment on function public.get_clients(uuid, text, uuid, integer, integer) is
  'Directorio de clientes con visitas y gasto. INVOKER: RLS limita al barbero a sus clientes y sus citas.';

revoke all on function public.get_clients(uuid, text, uuid, integer, integer) from public, anon;
grant execute on function public.get_clients(uuid, text, uuid, integer, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. set_client_note
-- -----------------------------------------------------------------------------
-- El barbero no tiene UPDATE sobre clients: esta función cambia solo `notes`.
-- Fuera de alcance → P0002, sin distinguir de "no existe".
create or replace function public.set_client_note(
  _client_id uuid,
  _notes     text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid    uuid := (select auth.uid());
  _clean  text := nullif(btrim(coalesce(_notes, '')), '');
  _tenant uuid;
begin
  if _uid is null then
    raise exception 'Inicia sesión para guardar notas'
      using errcode = '42501';
  end if;

  if char_length(coalesce(_clean, '')) > 1000 then
    raise exception 'La nota no puede superar 1000 caracteres'
      using errcode = '23514';
  end if;

  select c.tenant_id into _tenant
  from public.clients c
  join public.tenants t on t.id = c.tenant_id and t.status = 'active'
  where c.id = _client_id
    and c.deleted_at is null;

  if _tenant is null or not (
    private.is_admin(_tenant)
    or exists (
      select 1
      from public.appointments a
      where a.tenant_id = _tenant
        and a.client_id = _client_id
        and a.barber_id = private.my_barber_id(_tenant)
    )
  ) then
    raise exception 'Cliente no encontrado'
      using errcode = 'P0002';
  end if;

  update public.clients c
     set notes = _clean
   where c.id = _client_id;

  return _clean;
end;
$$;

comment on function public.set_client_note(uuid, text) is
  'Notas internas de un cliente: admin de la barbería o barbero que tiene/tuvo cita con él.';

revoke all on function public.set_client_note(uuid, text) from public, anon;
grant execute on function public.set_client_note(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. update_client
-- -----------------------------------------------------------------------------
-- El teléfono se normaliza aquí (private.normalize_phone_mx). Vacío = sin
-- teléfono. Teléfono de otro cliente de la barbería → BA012.
create or replace function public.update_client(
  _client_id uuid,
  _full_name text,
  _phone     text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid       uuid := (select auth.uid());
  _name      text := btrim(coalesce(_full_name, ''));
  _raw_phone text := nullif(btrim(coalesce(_phone, '')), '');
  _clean     text;
  _tenant    uuid;
begin
  if _uid is null then
    raise exception 'Inicia sesión para editar clientes'
      using errcode = '42501';
  end if;

  select c.tenant_id into _tenant
  from public.clients c
  join public.tenants t on t.id = c.tenant_id and t.status = 'active'
  where c.id = _client_id
    and c.deleted_at is null;

  if _tenant is null or not private.is_admin(_tenant) then
    raise exception 'Cliente no encontrado'
      using errcode = 'P0002';
  end if;

  if _name = '' or char_length(_name) > 120 then
    raise exception 'Escribe un nombre de 1 a 120 caracteres'
      using errcode = '23514';
  end if;

  if _raw_phone is not null then
    _clean := private.normalize_phone_mx(_raw_phone);
    if _clean is null then
      raise exception 'El teléfono no es válido: usa 10 dígitos o el formato +52…'
        using errcode = '23514';
    end if;
  end if;

  begin
    update public.clients c
       set full_name = _name,
           phone     = _clean
     where c.id = _client_id;
  exception when unique_violation then
    raise exception 'Ya hay otro cliente con ese teléfono'
      using errcode = 'BA012';
  end;

  return jsonb_build_object('id', _client_id, 'full_name', _name, 'phone', _clean);
end;
$$;

comment on function public.update_client(uuid, text, text) is
  'Admin: corrige nombre y teléfono de un cliente de su barbería.';

revoke all on function public.update_client(uuid, text, text) from public, anon;
grant execute on function public.update_client(uuid, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. get_business_stats
-- -----------------------------------------------------------------------------
-- Periodo en fechas locales del tenant, ambas incluidas (máximo 366 días).
--   Citas: por start_at · Cobros: por created_at · Salarios: por paid_at.
-- INVOKER: el barbero solo suma sus citas y cobros. `profit_cents` (cobrado −
-- comisiones − propinas − salarios pagados) es null si no es admin.
create or replace function public.get_business_stats(
  _tenant_id uuid,
  _from      date,
  _to        date
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  _tz           text;
  _is_admin     boolean;
  _start        timestamptz;
  _end          timestamptz;
  _appointments jsonb;
  _revenue      jsonb;
  _methods      jsonb;
  _daily        jsonb;
  _services     jsonb;
  _barbers      jsonb;
  _clients      jsonb;
  _weekdays     jsonb;
  _salaries     bigint;
begin
  if _tenant_id is null or not private.is_member(_tenant_id) then
    raise exception 'No tienes acceso a esta barbería'
      using errcode = '42501';
  end if;

  if _from is null or _to is null or _to < _from or _to - _from > 366 then
    raise exception 'El periodo no es válido'
      using errcode = '23514';
  end if;

  select t.timezone into _tz from public.tenants t where t.id = _tenant_id;
  if _tz is null then
    raise exception 'Barbería no encontrada'
      using errcode = 'P0002';
  end if;

  _is_admin := private.is_admin(_tenant_id);
  _start := _from::timestamp at time zone _tz;
  _end := (_to + 1)::timestamp at time zone _tz;

  select jsonb_build_object(
    'total',     count(*),
    'pending',   count(*) filter (where a.status = 'pending'),
    'confirmed', count(*) filter (where a.status = 'confirmed'),
    'completed', count(*) filter (where a.status = 'completed'),
    'cancelled', count(*) filter (where a.status = 'cancelled'),
    'no_show',   count(*) filter (where a.status = 'no_show'),
    'walk_in',   count(*) filter (where a.source = 'walk_in')
  ) into _appointments
  from public.appointments a
  where a.tenant_id = _tenant_id
    and a.start_at >= _start
    and a.start_at < _end;

  select jsonb_build_object(
    'charges',        count(*),
    'services_cents', coalesce(sum(c.subtotal_cents - c.discount_cents), 0),
    'discount_cents', coalesce(sum(c.discount_cents), 0),
    'tips_cents',     coalesce(sum(c.tip_cents), 0),
    'total_cents',    coalesce(sum(c.total_cents), 0),
    'commission_cents', coalesce(sum(c.commission_cents), 0),
    'without_commission', count(*) filter (where c.pay_type is null)
  ) into _revenue
  from public.appointment_charges c
  where c.tenant_id = _tenant_id
    and c.voided_at is null
    and c.created_at >= _start
    and c.created_at < _end;

  select coalesce(jsonb_object_agg(m.method, m.cents), '{}'::jsonb) into _methods
  from (
    select p.method, sum(p.amount_cents) as cents
    from public.charge_payments p
    join public.appointment_charges c on c.tenant_id = p.tenant_id and c.id = p.charge_id
    where c.tenant_id = _tenant_id
      and c.voided_at is null
      and c.created_at >= _start
      and c.created_at < _end
    group by p.method
  ) m;

  select coalesce(jsonb_agg(jsonb_build_object('date', d.day, 'cents', coalesce(x.cents, 0)) order by d.day), '[]'::jsonb)
    into _daily
  from (
    select g::date as day
    from generate_series(_from::timestamp, _to::timestamp, interval '1 day') g
  ) d
  left join (
    select (c.created_at at time zone _tz)::date as day,
           sum(c.subtotal_cents - c.discount_cents) as cents
    from public.appointment_charges c
    where c.tenant_id = _tenant_id
      and c.voided_at is null
      and c.created_at >= _start
      and c.created_at < _end
    group by 1
  ) x on x.day = d.day;

  select coalesce(jsonb_agg(jsonb_build_object('name', s.service_name, 'count', s.n, 'cents', s.cents) order by s.n desc, s.cents desc, s.service_name), '[]'::jsonb)
    into _services
  from (
    select l.service_name, count(*) as n, sum(l.price_cents) as cents
    from public.appointment_services l
    join public.appointment_charges c on c.tenant_id = l.tenant_id and c.appointment_id = l.appointment_id
    where c.tenant_id = _tenant_id
      and c.voided_at is null
      and c.created_at >= _start
      and c.created_at < _end
    group by l.service_name
    order by n desc, cents desc, l.service_name
    limit 5
  ) s;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', b.barber_id, 'name', b.display_name, 'charges', b.n,
           'services_cents', b.services, 'commission_cents', b.commission, 'tips_cents', b.tips
         ) order by b.services desc, b.display_name), '[]'::jsonb)
    into _barbers
  from (
    select c.barber_id, br.display_name, count(*) as n,
           sum(c.subtotal_cents - c.discount_cents) as services,
           coalesce(sum(c.commission_cents), 0) as commission,
           sum(c.tip_cents) as tips
    from public.appointment_charges c
    join public.barbers br on br.tenant_id = c.tenant_id and br.id = c.barber_id
    where c.tenant_id = _tenant_id
      and c.voided_at is null
      and c.created_at >= _start
      and c.created_at < _end
    group by c.barber_id, br.display_name
  ) b;

  -- Cliente nuevo: su primera visita completada (dentro del alcance) cae en el periodo.
  select jsonb_build_object(
    'total',  (select count(*) from public.clients c where c.tenant_id = _tenant_id and c.deleted_at is null),
    'served', count(*) filter (where v.in_period),
    'new',    count(*) filter (where v.in_period and v.first_visit >= _start)
  ) into _clients
  from (
    select a.client_id,
           min(a.start_at) as first_visit,
           bool_or(a.start_at >= _start and a.start_at < _end) as in_period
    from public.appointments a
    where a.tenant_id = _tenant_id
      and a.status = 'completed'
    group by a.client_id
  ) v;

  -- Citas atendidas por día de la semana (1 = lunes … 7 = domingo).
  select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'count', coalesce(x.n, 0)) order by d.day), '[]'::jsonb)
    into _weekdays
  from generate_series(1, 7) as d(day)
  left join (
    select extract(isodow from (a.start_at at time zone _tz))::integer as day, count(*) as n
    from public.appointments a
    where a.tenant_id = _tenant_id
      and a.status = 'completed'
      and a.start_at >= _start
      and a.start_at < _end
    group by 1
  ) x on x.day = d.day;

  select coalesce(sum(p.salary_cents), 0) into _salaries
  from public.barber_payouts p
  where p.tenant_id = _tenant_id
    and p.voided_at is null
    and p.paid_at >= _start
    and p.paid_at < _end;

  return jsonb_build_object(
    'appointments', _appointments,
    'revenue',      _revenue,
    'methods',      _methods,
    'daily',        _daily,
    'services',     _services,
    'barbers',      _barbers,
    'clients',      _clients,
    'weekdays',     _weekdays,
    'salaries_cents', _salaries,
    'profit_cents', case
      when _is_admin then
        (_revenue ->> 'total_cents')::bigint
        - (_revenue ->> 'commission_cents')::bigint
        - (_revenue ->> 'tips_cents')::bigint
        - _salaries
    end
  );
end;
$$;

comment on function public.get_business_stats(uuid, date, date) is
  'Estadísticas de un periodo. INVOKER: el barbero solo suma lo suyo; profit_cents solo para admin.';

revoke all on function public.get_business_stats(uuid, date, date) from public, anon;
grant execute on function public.get_business_stats(uuid, date, date) to authenticated;
