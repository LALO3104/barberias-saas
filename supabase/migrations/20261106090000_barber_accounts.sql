-- =============================================================================
-- Step 17 — WhatsApp de cada barbero y cuentas por invitación
-- -----------------------------------------------------------------------------
-- 1. barbers.whatsapp_phone: número del barbero (E.164). No se expone en la
--    página pública; book_appointment lo devuelve solo tras reservar con él.
-- 2. barber_invites: enlaces de un solo uso (7 días). Se guarda el hash del
--    token, nunca el token.
-- 3. create_barber_invite (admin), get_barber_invite (público, con token) y
--    accept_barber_invite (con sesión): ligan la cuenta al perfil del barbero.
-- 4. set_barber_whatsapp: admin o el propio barbero (normaliza el teléfono).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Número del barbero
-- -----------------------------------------------------------------------------
alter table public.barbers
  add column whatsapp_phone text,
  add constraint barbers_whatsapp_e164
    check (whatsapp_phone is null or whatsapp_phone ~ '^\+[1-9][0-9]{7,14}$');

comment on column public.barbers.whatsapp_phone is
  'WhatsApp del barbero (E.164). Lo ven los miembros de la barbería; al público solo tras reservar con él.';

-- -----------------------------------------------------------------------------
-- 2. Invitaciones
-- -----------------------------------------------------------------------------
create table public.barber_invites (
  id          uuid        primary key default gen_random_uuid(),
  tenant_id   uuid        not null references public.tenants (id) on delete cascade,
  barber_id   uuid        not null,
  token_hash  text        not null unique,
  created_by  uuid        references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '7 days',
  used_at     timestamptz,
  used_by     uuid        references auth.users (id) on delete set null,
  revoked_at  timestamptz,

  constraint barber_invites_barber_fkey
    foreign key (tenant_id, barber_id) references public.barbers (tenant_id, id) on delete cascade
);

comment on table public.barber_invites is
  'Invitaciones de un solo uso para ligar una cuenta a un barbero. Solo se accede por funciones.';

-- Una invitación vigente por barbero.
create unique index barber_invites_one_active
  on public.barber_invites (barber_id)
  where used_at is null and revoked_at is null;

create index barber_invites_tenant_idx on public.barber_invites (tenant_id);

alter table public.barber_invites enable row level security;
revoke all on table public.barber_invites from public, anon, authenticated;

-- Ligar la cuenta cambia barbers.user_id con la sesión del propio barbero. Solo
-- se permite si acaba de canjear una invitación de ese perfil.
create or replace function private.restrict_barber_self_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Admin: sin restricción de columnas
  if (select private.is_admin(new.tenant_id)) then
    return new;
  end if;

  -- Barbero editándose: solo puede cambiar bio, photo_url y whatsapp_phone
  if new.display_name  is distinct from old.display_name
     or new.role_title is distinct from old.role_title
     or new.is_active  is distinct from old.is_active
     or new.sort_order is distinct from old.sort_order
     or new.tenant_id  is distinct from old.tenant_id
  then
    raise exception 'Solo puedes modificar tu biografía y foto de perfil';
  end if;

  if new.user_id is distinct from old.user_id and not (
    old.user_id is null
    and new.user_id = (select auth.uid())
    and exists (
      select 1
      from public.barber_invites i
      where i.barber_id = new.id
        and i.used_by = new.user_id
        and i.used_at is not null
    )
  ) then
    raise exception 'Solo puedes modificar tu biografía y foto de perfil';
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Funciones de invitación
-- -----------------------------------------------------------------------------
-- Devuelve el token una sola vez. Una invitación nueva revoca la anterior.
create or replace function public.create_barber_invite(_barber_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid     uuid := (select auth.uid());
  _barber  public.barbers;
  _token   text;
  _expires timestamptz;
begin
  if _uid is null then
    raise exception 'Inicia sesión para invitar barberos'
      using errcode = '42501';
  end if;

  select b.* into _barber
  from public.barbers b
  join public.tenants t on t.id = b.tenant_id and t.status = 'active'
  where b.id = _barber_id
  for update of b;

  if not found or not private.is_admin(_barber.tenant_id) then
    raise exception 'Barbero no encontrado'
      using errcode = 'P0002';
  end if;

  if not _barber.is_active then
    raise exception 'Activa al barbero antes de invitarlo'
      using errcode = '23514';
  end if;

  if _barber.user_id is not null then
    raise exception 'Este barbero ya tiene cuenta'
      using errcode = 'BA014';
  end if;

  update public.barber_invites i
     set revoked_at = now()
   where i.barber_id = _barber_id
     and i.used_at is null
     and i.revoked_at is null;

  -- Dos UUID v4: 244 bits aleatorios, 64 caracteres.
  _token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  insert into public.barber_invites (tenant_id, barber_id, token_hash, created_by)
  values (_barber.tenant_id, _barber_id, encode(sha256(convert_to(_token, 'UTF8')), 'hex'), _uid)
  returning expires_at into _expires;

  return jsonb_build_object('token', _token, 'expires_at', _expires);
end;
$$;

comment on function public.create_barber_invite(uuid) is
  'Admin: crea el enlace de invitación de un barbero sin cuenta (revoca el anterior).';

revoke all on function public.create_barber_invite(uuid) from public, anon;
grant execute on function public.create_barber_invite(uuid) to authenticated;

-- Para la página de invitación. Token inválido, usado o vencido → P0002.
create or replace function public.get_barber_invite(_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _result jsonb;
begin
  select jsonb_build_object('barber_name', b.display_name, 'tenant_name', t.name)
    into _result
  from public.barber_invites i
  join public.barbers b on b.id = i.barber_id
  join public.tenants t on t.id = i.tenant_id and t.status = 'active'
  where i.token_hash = encode(sha256(convert_to(coalesce(_token, ''), 'UTF8')), 'hex')
    and i.used_at is null
    and i.revoked_at is null
    and i.expires_at > now()
    and b.is_active
    and b.user_id is null;

  if _result is null then
    raise exception 'Invitación no válida'
      using errcode = 'P0002';
  end if;

  return _result;
end;
$$;

comment on function public.get_barber_invite(text) is
  'Público con token: nombre del barbero y de la barbería de una invitación vigente.';

revoke all on function public.get_barber_invite(text) from public;
grant execute on function public.get_barber_invite(text) to anon, authenticated;

-- Canjea la invitación con la cuenta de la sesión.
create or replace function public.accept_barber_invite(
  _token    text,
  _whatsapp text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid       uuid := (select auth.uid());
  _raw_phone text := nullif(btrim(coalesce(_whatsapp, '')), '');
  _phone     text;
  _invite    public.barber_invites;
  _barber    public.barbers;
begin
  if _uid is null then
    raise exception 'Inicia sesión para activar tu cuenta'
      using errcode = '42501';
  end if;

  if _raw_phone is not null then
    _phone := private.normalize_phone_mx(_raw_phone);
    if _phone is null then
      raise exception 'El WhatsApp no es válido: usa 10 dígitos o el formato +52…'
        using errcode = '23514';
    end if;
  end if;

  select i.* into _invite
  from public.barber_invites i
  join public.tenants t on t.id = i.tenant_id and t.status = 'active'
  where i.token_hash = encode(sha256(convert_to(coalesce(_token, ''), 'UTF8')), 'hex')
    and i.used_at is null
    and i.revoked_at is null
    and i.expires_at > now()
  for update of i;

  if not found then
    raise exception 'Invitación no válida'
      using errcode = 'P0002';
  end if;

  select b.* into _barber
  from public.barbers b
  where b.id = _invite.barber_id
  for update;

  if not _barber.is_active then
    raise exception 'Invitación no válida'
      using errcode = 'P0002';
  end if;

  if _barber.user_id is not null or exists (
    select 1 from public.tenant_members m
    where m.tenant_id = _invite.tenant_id and m.user_id = _uid
  ) then
    raise exception 'Esta cuenta o este barbero ya están registrados en la barbería'
      using errcode = 'BA014';
  end if;

  insert into public.tenant_members (tenant_id, user_id, role)
  values (_invite.tenant_id, _uid, 'barber');

  update public.barber_invites i
     set used_at = now(),
         used_by = _uid
   where i.id = _invite.id;

  update public.barbers b
     set user_id        = _uid,
         whatsapp_phone = coalesce(_phone, b.whatsapp_phone)
   where b.id = _barber.id;

  return jsonb_build_object('barber_id', _barber.id, 'tenant_id', _invite.tenant_id);
end;
$$;

comment on function public.accept_barber_invite(text, text) is
  'Liga la cuenta de la sesión al barbero de la invitación, como miembro con rol barber.';

revoke all on function public.accept_barber_invite(text, text) from public, anon;
grant execute on function public.accept_barber_invite(text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. set_barber_whatsapp
-- -----------------------------------------------------------------------------
-- Vacío = sin número. Fuera de alcance → P0002.
create or replace function public.set_barber_whatsapp(
  _barber_id uuid,
  _phone     text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid       uuid := (select auth.uid());
  _raw_phone text := nullif(btrim(coalesce(_phone, '')), '');
  _clean     text;
  _barber    public.barbers;
begin
  if _uid is null then
    raise exception 'Inicia sesión para guardar tu WhatsApp'
      using errcode = '42501';
  end if;

  select b.* into _barber from public.barbers b where b.id = _barber_id;

  if not found or not (private.is_admin(_barber.tenant_id) or _barber.user_id = _uid) then
    raise exception 'Barbero no encontrado'
      using errcode = 'P0002';
  end if;

  if _raw_phone is not null then
    _clean := private.normalize_phone_mx(_raw_phone);
    if _clean is null then
      raise exception 'El WhatsApp no es válido: usa 10 dígitos o el formato +52…'
        using errcode = '23514';
    end if;
  end if;

  update public.barbers b
     set whatsapp_phone = _clean
   where b.id = _barber_id;

  return _clean;
end;
$$;

comment on function public.set_barber_whatsapp(uuid, text) is
  'WhatsApp de un barbero: admin de su barbería o el propio barbero.';

revoke all on function public.set_barber_whatsapp(uuid, text) from public, anon;
grant execute on function public.set_barber_whatsapp(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. book_appointment: devuelve el WhatsApp del barbero de la cita
-- -----------------------------------------------------------------------------
create or replace function public.book_appointment(
  _slug         text,
  _barber_id    uuid,
  _service_ids  uuid[],
  _start_at     timestamptz,
  _client_name  text,
  _client_phone text,
  _client_note  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _tenant_id      uuid;
  _tz             text;
  _duration       bigint;
  _end_at         timestamptz;
  _local_start    timestamp;
  _client_id      uuid;
  _appointment_id uuid;
  _services       jsonb;
  _total_price    bigint;
  _total_duration bigint;
  _active         integer;
begin
  -- ── Validación de entrada del cliente (igual que hoy) ──────────────────
  if _client_name is null or btrim(_client_name) = '' then
    raise exception 'El nombre del cliente es obligatorio'
      using errcode = 'check_violation';
  end if;

  if char_length(btrim(_client_name)) > 120 then
    raise exception 'El nombre no puede superar 120 caracteres'
      using errcode = 'check_violation';
  end if;

  if char_length(coalesce(_client_note, '')) > 500 then
    raise exception 'La nota no puede superar 500 caracteres'
      using errcode = 'check_violation';
  end if;

  _client_phone := private.normalize_phone_mx(_client_phone);

  if _client_phone is null then
    raise exception 'El teléfono debe tener 10 dígitos (ej: 55 1234 5678) o formato internacional (ej: +52 55 1234 5678)'
      using errcode = 'check_violation';
  end if;

  -- ── Tenant activo ──────────────────────────────────────────────────────
  select t.id, t.timezone into _tenant_id, _tz
  from public.tenants t
  where t.slug = _slug
    and t.status = 'active';

  if not found then
    raise exception 'Barbería no encontrada o inactiva'
      using errcode = 'P0002';
  end if;

  -- ── Barbero ────────────────────────────────────────────────────────────
  if not exists (
    select 1 from public.barbers b
    where b.id = _barber_id
      and b.tenant_id = _tenant_id
      and b.is_active = true
  ) then
    raise exception 'Barbero no encontrado o inactivo'
      using errcode = 'P0002';
  end if;

  -- ── Servicios: bloquear (FOR SHARE) y validar la lista ─────────────────
  -- El lock impide que el catálogo cambie (precio, duración, is_active) entre
  -- la validación y el INSERT de las líneas.
  perform 1
  from public.services s
  where s.tenant_id = _tenant_id
    and s.id = any (_service_ids)
  order by s.id
  for share of s;

  select sum(r.duration_minutes) into _duration
  from private.resolve_booking_services(_tenant_id, _service_ids) as r;

  _end_at := _start_at + pg_catalog.make_interval(mins => _duration::integer);

  -- ── Alineación a 5 minutos en hora local del tenant ────────────────────
  _local_start := _start_at at time zone _tz;
  if extract(minute from _local_start)::integer % 5 <> 0
     or extract(second from _local_start) <> 0 then
    raise exception 'El horario debe estar alineado a intervalos de 5 minutos'
      using errcode = 'check_violation';
  end if;

  -- ── Pasado y anticipación mínima pública (15 min) ──────────────────────
  if _start_at <= now() then
    raise exception 'No se puede reservar en el pasado'
      using errcode = 'check_violation';
  end if;

  if _start_at < now() + interval '15 minutes' then
    raise exception 'Las reservas en línea requieren al menos 15 minutos de anticipación'
      using errcode = 'check_violation';
  end if;

  -- ── Agenda del barbero: lock y revalidación ────────────────────────────
  perform private.lock_barber_agenda(_barber_id);

  if not private.within_business_hours(_tenant_id, _tz, _start_at, _end_at) then
    raise exception 'El horario está fuera del horario comercial'
      using errcode = 'check_violation';
  end if;

  if not private.within_barber_hours(_tenant_id, _barber_id, _tz, _start_at, _end_at) then
    raise exception 'El horario está fuera del horario del barbero'
      using errcode = 'check_violation';
  end if;

  if private.overlaps_schedule_block(_tenant_id, _barber_id, _start_at, _end_at) then
    raise exception 'El horario se traslapa con un bloqueo de agenda'
      using errcode = 'check_violation';
  end if;

  if private.overlaps_active_appointment(
       _tenant_id, _barber_id, _start_at,
       private.appointment_occupied_until(_start_at, _end_at)
     ) then
    raise exception 'El horario seleccionado ya no está disponible. Por favor selecciona otro.'
      using errcode = 'P0003';
  end if;

  -- ── Cliente por teléfono dentro del tenant (igual que hoy) ─────────────
  insert into public.clients (tenant_id, full_name, phone)
  values (_tenant_id, btrim(_client_name), _client_phone)
  on conflict (tenant_id, phone) where phone is not null and deleted_at is null
  do update set
    full_name  = excluded.full_name,
    updated_at = now()
  returning id into _client_id;

  -- ── Anti-spam: máximo 3 citas futuras activas por cliente ──────────────
  -- El lock por cliente evita que dos reservas simultáneas (con barberos
  -- distintos, que no comparten lock de agenda) pasen el límite juntas.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('online-booking:' || _client_id::text, 0));

  select count(*) into _active
  from public.appointments a
  where a.tenant_id = _tenant_id
    and a.client_id = _client_id
    and a.status in ('pending', 'confirmed')
    and a.start_at >= now();

  if _active >= 3 then
    raise exception 'Ya tienes 3 citas próximas en esta barbería'
      using errcode = 'BA013';
  end if;

  -- ── Cita (occupied_until la calcula el trigger) ────────────────────────
  begin
    insert into public.appointments (
      tenant_id, barber_id, client_id,
      start_at, end_at,
      status, source, client_note,
      created_by
    ) values (
      _tenant_id, _barber_id, _client_id,
      _start_at, _end_at,
      'pending'::public.appointment_status,
      'online'::public.appointment_source,
      _client_note,
      null  -- reserva pública, sin usuario autenticado
    )
    returning id into _appointment_id;
  exception
    when exclusion_violation then
      -- 23P01: appointments_no_overlap (última barrera)
      raise exception 'El horario seleccionado ya no está disponible. Por favor selecciona otro.'
        using errcode = 'P0003';
  end;

  -- ── Líneas en el orden del arreglo ─────────────────────────────────────
  -- El trigger appointment_services_enforce_line vuelve a copiar el snapshot
  -- del catálogo (bloqueado FOR SHARE arriba) y fija la comisión en NULL.
  insert into public.appointment_services (
    tenant_id, appointment_id, service_id,
    service_name, price_cents, duration_minutes,
    commission_rate_bps, position
  )
  select _tenant_id, _appointment_id, r.service_id,
         r.service_name, r.price_cents, r.duration_minutes,
         null, r.line_position
  from private.resolve_booking_services(_tenant_id, _service_ids) as r
  order by r.line_position;

  -- ── Respuesta (desde lo guardado) ──────────────────────────────────────
  select jsonb_agg(
           jsonb_build_object(
             'id',               l.service_id,
             'name',             l.service_name,
             'price_cents',      l.price_cents,
             'duration_minutes', l.duration_minutes,
             'position',         l.position
           ) order by l.position
         ),
         sum(l.price_cents),
         sum(l.duration_minutes)
    into _services, _total_price, _total_duration
  from public.appointment_services l
  where l.tenant_id      = _tenant_id
    and l.appointment_id = _appointment_id;

  return jsonb_build_object(
    'appointment_id',         _appointment_id,
    'status',                 'pending',
    'barber_id',              _barber_id,
    'barber_whatsapp',        (select b.whatsapp_phone from public.barbers b where b.id = _barber_id),
    'start_at',               _start_at,
    'end_at',                 _end_at,
    'services',               _services,
    'total_price_cents',      _total_price,
    'total_duration_minutes', _total_duration,
    'client', jsonb_build_object(
      'id',    _client_id,
      'name',  btrim(_client_name),
      'phone', _client_phone
    )
  );
end;
$$;
