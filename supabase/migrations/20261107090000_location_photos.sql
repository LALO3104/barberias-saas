-- =============================================================================
-- Step 17 — Ubicación de la barbería y foto de cada barbero
-- -----------------------------------------------------------------------------
-- 1. update_tenant_location: única vía para que el admin cambie la dirección
--    que se publica. authenticated sigue SIN UPDATE sobre esas columnas.
-- 2. barbers.photo_url: solo https (la foto se muestra en la página pública y
--    el barbero la edita con su sesión).
-- =============================================================================

create or replace function public.update_tenant_location(
  _tenant_id    uuid,
  _address_line text,
  _city         text,
  _state        text,
  _postal_code  text
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

  update public.tenants t
     set address_line = _address,
         city         = _clean_city,
         state        = _clean_state,
         postal_code  = _postal
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
    'postal_code',  _postal
  );
end;
$$;

comment on function public.update_tenant_location(uuid, text, text, text, text) is
  'Admin: dirección pública de la barbería.';

revoke all on function public.update_tenant_location(uuid, text, text, text, text) from public, anon;
grant execute on function public.update_tenant_location(uuid, text, text, text, text) to authenticated;

alter table public.barbers
  add constraint barbers_photo_url_https
    check (photo_url is null or (photo_url ~ '^https://[^[:space:]]+$' and char_length(photo_url) <= 1000));
