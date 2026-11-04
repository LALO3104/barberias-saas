-- =============================================================================
-- Step 14 — Avisos por WhatsApp (enlaces wa.me, sin API ni costo)
-- -----------------------------------------------------------------------------
-- 1. tenants.message_templates: plantillas de los mensajes que el personal
--    envía al cliente (confirmación, recordatorio, cancelación, cambio).
--    Solo se guardan las personalizadas; una clave ausente = texto por defecto
--    de la app. Las ven los miembros de la barbería (tenants_select); no se
--    exponen en la página pública (get_public_tenant lista sus campos).
-- 2. public.update_tenant_messaging: única vía para que el admin cambie el
--    número de WhatsApp de la barbería (public_phone, normalizado a E.164) y
--    las plantillas. authenticated sigue SIN UPDATE sobre esas columnas.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Plantillas
-- -----------------------------------------------------------------------------
create or replace function private.valid_message_templates(_t jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(_t) = 'object'
     and not exists (
       select 1
       from jsonb_each(_t) e
       where e.key not in ('confirm', 'reminder', 'cancel', 'reschedule')
          or jsonb_typeof(e.value) <> 'string'
          or char_length(btrim(e.value #>> '{}')) = 0
          or char_length(e.value #>> '{}') > 1000
     );
$$;

comment on function private.valid_message_templates(jsonb) is
  'Plantillas de WhatsApp: objeto con claves confirm|reminder|cancel|reschedule y textos de 1 a 1000 caracteres.';

-- authenticated la necesita: el CHECK se evalúa con los permisos de quien
-- actualiza la fila (p. ej. el admin al cambiar name o site_content). Es pura
-- y no lee tablas.
revoke all on function private.valid_message_templates(jsonb) from public, anon;
grant execute on function private.valid_message_templates(jsonb) to authenticated;

alter table public.tenants
  add column message_templates jsonb not null default '{}'::jsonb,
  add constraint tenants_message_templates_valid
    check (private.valid_message_templates(message_templates));

comment on column public.tenants.message_templates is
  'Plantillas de WhatsApp personalizadas por el admin (solo las que cambió). Se editan con update_tenant_messaging.';

-- -----------------------------------------------------------------------------
-- 2. update_tenant_messaging
-- -----------------------------------------------------------------------------
-- _whatsapp_phone: NULL o vacío = sin número; si no, se normaliza (10 dígitos
-- → +52). _templates: NULL = sin cambios a las plantillas; un objeto reemplaza
-- todas (los textos vacíos o solo espacios se descartan = volver al defecto).
create or replace function public.update_tenant_messaging(
  _tenant_id      uuid,
  _whatsapp_phone text,
  _templates      jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _uid       uuid := (select auth.uid());
  _raw_phone text := nullif(btrim(coalesce(_whatsapp_phone, '')), '');
  _phone     text;
  _clean     jsonb;
  _row       public.tenants;
begin
  if _uid is null then
    raise exception 'Inicia sesión para cambiar los ajustes'
      using errcode = '42501';
  end if;

  if _tenant_id is null or not private.is_admin(_tenant_id) then
    raise exception 'Solo el administrador puede cambiar los ajustes de la barbería'
      using errcode = '42501';
  end if;

  if _raw_phone is not null then
    _phone := private.normalize_phone_mx(_raw_phone);
    if _phone is null then
      raise exception 'El número de WhatsApp no es válido: usa 10 dígitos o el formato +52…'
        using errcode = '23514';
    end if;
  end if;

  if _templates is not null then
    if jsonb_typeof(_templates) <> 'object' then
      raise exception 'Las plantillas no son válidas'
        using errcode = '23514';
    end if;
    -- Descarta textos vacíos (vuelven al defecto); el resto lo valida el CHECK.
    select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
      into _clean
    from jsonb_each(_templates) e
    where not (jsonb_typeof(e.value) = 'string' and btrim(e.value #>> '{}') = '');

    if not private.valid_message_templates(_clean) then
      raise exception 'Las plantillas no son válidas (máximo 1000 caracteres cada una)'
        using errcode = '23514';
    end if;
  end if;

  update public.tenants t
     set public_phone      = _phone,
         message_templates = coalesce(_clean, t.message_templates)
   where t.id = _tenant_id
     and t.status = 'active'
  returning * into _row;

  if not found then
    raise exception 'Barbería no encontrada'
      using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'public_phone',      _row.public_phone,
    'message_templates', _row.message_templates
  );
end;
$$;

comment on function public.update_tenant_messaging(uuid, text, jsonb) is
  'Admin: número de WhatsApp (public_phone, E.164) y plantillas de mensajes de la barbería.';

revoke all on function public.update_tenant_messaging(uuid, text, jsonb) from public, anon;
grant execute on function public.update_tenant_messaging(uuid, text, jsonb) to authenticated;
