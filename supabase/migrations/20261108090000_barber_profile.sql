-- =============================================================================
-- Step 17 — El barbero personaliza su tarjeta pública
-- -----------------------------------------------------------------------------
-- El barbero ya editaba bio, foto y WhatsApp; ahora también su nombre y su
-- puesto. Sigue sin poder cambiar lo operativo: is_active, sort_order,
-- tenant_id ni user_id (salvo al canjear su invitación).
-- =============================================================================

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

  -- Barbero editándose: solo su perfil público y su WhatsApp
  if new.is_active     is distinct from old.is_active
     or new.sort_order is distinct from old.sort_order
     or new.tenant_id  is distinct from old.tenant_id
  then
    raise exception 'Solo puedes modificar tu perfil público';
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
    raise exception 'Solo puedes modificar tu perfil público';
  end if;

  return new;
end;
$$;

-- Lo escribe el barbero y se publica: límites también en la base.
alter table public.barbers
  add constraint barbers_public_profile_lengths check (
    char_length(display_name) <= 80
    and (role_title is null or char_length(role_title) <= 80)
    and (bio is null or char_length(bio) <= 300)
  );
