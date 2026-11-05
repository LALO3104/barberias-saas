-- =============================================================================
-- Step 18 — Notificaciones push al barbero por reservas en línea
-- -----------------------------------------------------------------------------
-- 1. push_subscriptions: dispositivos del barbero (solo la dirección de push; la
--    notificación viaja vacía y el teléfono pide los detalles con su sesión, así
--    los datos del cliente no pasan por el servicio de push).
-- 2. save/delete_push_subscription: únicas vías de escritura.
-- 3. Trigger: tras una reserva en línea encola, con pg_net, un aviso al servidor
--    con las direcciones del barbero. Se envía solo si la transacción confirma y,
--    pase lo que pase, nunca hace fallar la reserva.
-- Las claves viven en Vault (push_webhook_url, push_webhook_secret), no aquí.
-- =============================================================================

do $$
begin
  -- No existe en una base local sin Supabase; las pruebas usan un sustituto.
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
    revoke all on all functions in schema net from public, anon, authenticated;
    revoke usage on schema net from public, anon, authenticated;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 1. Suscripciones
-- -----------------------------------------------------------------------------
create table public.push_subscriptions (
  id         uuid        primary key default gen_random_uuid(),
  tenant_id  uuid        not null,
  user_id    uuid        not null,
  endpoint   text        not null unique,
  created_at timestamptz not null default now(),

  -- Solo servicios de push conocidos: el servidor envía a esta dirección.
  constraint push_subscriptions_endpoint_valid check (
    char_length(endpoint) <= 1000
    and endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)/[^[:space:]]+$'
  ),
  -- Si deja de ser miembro, su dispositivo deja de recibir avisos.
  constraint push_subscriptions_member_fkey
    foreign key (tenant_id, user_id)
    references public.tenant_members (tenant_id, user_id)
    on delete cascade
);

comment on table public.push_subscriptions is
  'Dispositivos que reciben avisos de reservas. Solo se accede por funciones.';

create index push_subscriptions_user_idx on public.push_subscriptions (tenant_id, user_id);

alter table public.push_subscriptions enable row level security;
revoke all on table public.push_subscriptions from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Funciones
-- -----------------------------------------------------------------------------
create or replace function public.save_push_subscription(
  _tenant_id uuid,
  _endpoint  text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := (select auth.uid());
begin
  if _uid is null then
    raise exception 'Inicia sesión para activar las notificaciones'
      using errcode = '42501';
  end if;

  if _tenant_id is null or private.my_barber_id(_tenant_id) is null then
    raise exception 'Solo los barberos reciben notificaciones'
      using errcode = 'P0002';
  end if;

  -- Un teléfono compartido queda con la última cuenta que lo activó.
  delete from public.push_subscriptions s where s.endpoint = _endpoint;

  insert into public.push_subscriptions (tenant_id, user_id, endpoint)
  values (_tenant_id, _uid, _endpoint);

  -- Máximo 5 dispositivos por persona: se conservan los más recientes.
  delete from public.push_subscriptions s
  where s.id in (
    select x.id
    from public.push_subscriptions x
    where x.tenant_id = _tenant_id and x.user_id = _uid
    order by x.created_at desc, x.id
    offset 5
  );
end;
$$;

comment on function public.save_push_subscription(uuid, text) is
  'El barbero registra su dispositivo para recibir avisos de reservas.';

revoke all on function public.save_push_subscription(uuid, text) from public, anon;
grant execute on function public.save_push_subscription(uuid, text) to authenticated;

create or replace function public.delete_push_subscription(_endpoint text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid uuid := (select auth.uid());
begin
  if _uid is null then
    raise exception 'Inicia sesión para cambiar las notificaciones'
      using errcode = '42501';
  end if;

  delete from public.push_subscriptions s
  where s.endpoint = _endpoint and s.user_id = _uid;
end;
$$;

comment on function public.delete_push_subscription(text) is
  'Quita un dispositivo propio.';

revoke all on function public.delete_push_subscription(text) from public, anon;
grant execute on function public.delete_push_subscription(text) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Aviso tras una reserva en línea
-- -----------------------------------------------------------------------------
create or replace function private.notify_online_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _endpoints jsonb;
  _url       text;
  _secret    text;
begin
  select jsonb_agg(s.endpoint) into _endpoints
  from public.barbers b
  join public.push_subscriptions s
    on s.tenant_id = b.tenant_id and s.user_id = b.user_id
  where b.id = new.barber_id;

  if _endpoints is null then
    return new;
  end if;

  -- Un aviso que falla nunca debe tumbar la reserva.
  begin
    select max(d.decrypted_secret) filter (where d.name = 'push_webhook_url'),
           max(d.decrypted_secret) filter (where d.name = 'push_webhook_secret')
      into _url, _secret
    from vault.decrypted_secrets d
    where d.name in ('push_webhook_url', 'push_webhook_secret');

    if _url is not null and _secret is not null then
      perform net.http_post(
        url := _url,
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', _secret),
        body := jsonb_build_object('endpoints', _endpoints),
        timeout_milliseconds := 5000
      );
    end if;
  exception when others then
    raise warning 'No se pudo encolar el aviso de la cita %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

revoke all on function private.notify_online_booking() from public, anon, authenticated;

create trigger appointments_notify_online_booking
  after insert on public.appointments
  for each row
  when (new.source = 'online')
  execute function private.notify_online_booking();
