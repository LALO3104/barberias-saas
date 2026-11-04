-- =============================================================================
-- Step 17 — Punto de la barbería en Google Maps
-- -----------------------------------------------------------------------------
-- tenants.map_query: coordenadas o nombre del lugar, sacados del enlace que el
-- admin copia de Google Maps. La página pública lo muestra en un mapa incrustado.
-- =============================================================================

alter table public.tenants
  add column map_query text,
  add constraint tenants_map_query_valid
    check (map_query is null or (btrim(map_query) <> '' and char_length(map_query) <= 300));

comment on column public.tenants.map_query is
  'Punto en Google Maps: "lat,lng" o nombre del lugar. Público. Se edita con update_tenant_location.';

drop function public.update_tenant_location(uuid, text, text, text, text);

create or replace function public.update_tenant_location(
  _tenant_id    uuid,
  _address_line text,
  _city         text,
  _state        text,
  _postal_code  text,
  _map_query    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid     uuid := (select auth.uid());
  _address text := nullif(btrim(coalesce(_address_line, '')), '');
  _clean_city  text := nullif(btrim(coalesce(_city, '')), '');
  _clean_state text := nullif(btrim(coalesce(_state, '')), '');
  _postal  text := nullif(btrim(coalesce(_postal_code, '')), '');
  _map     text := nullif(btrim(coalesce(_map_query, '')), '');
begin
  if _uid is null then
    raise exception 'Inicia sesión para cambiar los ajustes'
      using errcode = '42501';
  end if;

  if _tenant_id is null or not private.is_admin(_tenant_id) then
    raise exception 'Solo el administrador puede cambiar los ajustes de la barbería'
      using errcode = '42501';
  end if;

  if char_length(coalesce(_address, '')) > 200 then
    raise exception 'La dirección no puede superar 200 caracteres'
      using errcode = '23514';
  end if;

  if char_length(coalesce(_clean_city, '')) > 80 or char_length(coalesce(_clean_state, '')) > 80 then
    raise exception 'La ciudad y el estado no pueden superar 80 caracteres'
      using errcode = '23514';
  end if;

  if _postal is not null and _postal !~ '^[0-9]{5}$' then
    raise exception 'El código postal debe tener 5 dígitos'
      using errcode = '23514';
  end if;

  if char_length(coalesce(_map, '')) > 300 then
    raise exception 'La ubicación del mapa no es válida'
      using errcode = '23514';
  end if;

  update public.tenants t
     set address_line = _address,
         city         = _clean_city,
         state        = _clean_state,
         postal_code  = _postal,
         -- NULL = sin cambios; vacío = quitar el punto del mapa.
         map_query    = case when _map_query is null then t.map_query else _map end
   where t.id = _tenant_id
     and t.status = 'active';

  if not found then
    raise exception 'Barbería no encontrada'
      using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'address_line', _address,
    'city',         _clean_city,
    'state',        _clean_state,
    'postal_code',  _postal,
    'map_query',    (select t.map_query from public.tenants t where t.id = _tenant_id)
  );
end;
$$;

comment on function public.update_tenant_location(uuid, text, text, text, text, text) is
  'Admin: dirección pública y punto en el mapa de la barbería.';

revoke all on function public.update_tenant_location(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.update_tenant_location(uuid, text, text, text, text, text) to authenticated;

create or replace function public.get_public_tenant(_slug text)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  _tenant record;
  _result jsonb;
begin
  -- Resolver tenant activo por slug
  select id, name, slug, timezone, currency,
         address_line, city, state, postal_code,
         public_phone, logo_url, theme, site_content, map_query
  into _tenant
  from public.tenants
  where slug = _slug
    and status = 'active';

  if not found then
    raise exception 'Barbería no encontrada o inactiva'
      using errcode = 'P0002';
  end if;

  -- Construir respuesta con subobjetos anidados
  _result := jsonb_build_object(
    'name',          _tenant.name,
    'slug',          _tenant.slug,
    'timezone',      _tenant.timezone,
    'currency',      _tenant.currency,
    'address_line',  _tenant.address_line,
    'city',          _tenant.city,
    'state',         _tenant.state,
    'postal_code',   _tenant.postal_code,
    'map_query',     _tenant.map_query,
    'public_phone',  _tenant.public_phone,
    'logo_url',      _tenant.logo_url,
    'theme',         _tenant.theme,
    'site_content',  _tenant.site_content,
    -- Barberos activos (perfil público, sin user_id ni compensación)
    'barbers', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id',           b.id,
          'display_name', b.display_name,
          'role_title',   b.role_title,
          'bio',          b.bio,
          'photo_url',    b.photo_url,
          'sort_order',   b.sort_order
        ) order by b.sort_order, b.display_name
      ), '[]'::jsonb)
      from public.barbers b
      where b.tenant_id = _tenant.id
        and b.is_active = true
    ),
    -- Servicios activos (catálogo público)
    'services', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'id',               s.id,
          'name',             s.name,
          'description',      s.description,
          'price_cents',      s.price_cents,
          'duration_minutes', s.duration_minutes,
          'sort_order',       s.sort_order
        ) order by s.sort_order, s.name
      ), '[]'::jsonb)
      from public.services s
      where s.tenant_id = _tenant.id
        and s.is_active = true
    ),
    -- Horario comercial semanal (ISO: 1=lunes … 7=domingo)
    'business_hours', (
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'day_of_week', bh.day_of_week,
          'opens_at',    bh.opens_at,
          'closes_at',   bh.closes_at
        ) order by bh.day_of_week, bh.opens_at
      ), '[]'::jsonb)
      from public.business_hours bh
      where bh.tenant_id = _tenant.id
    )
  );

  return _result;
end;
$$;
