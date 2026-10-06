-- =============================================================================
-- Barberías SaaS — Migración 6: helpers de autorización, triggers de seguridad
-- -----------------------------------------------------------------------------
-- Parte del Paso 2 del plan de implementación.
--
-- Contenido:
--   1. GRANT USAGE ON SCHEMA private  → authenticated
--   2. Funciones SECURITY DEFINER: is_member, is_admin, my_barber_id,
--      is_same_tenant (con REVOKE/GRANT selectivos)
--   3. Trigger handle_new_user       → crea perfil al registrarse
--   4. Trigger protect_last_admin    → nunca dejar barbería sin admin
--   5. Trigger enforce_member_limit  → límite del plan (FOR UPDATE)
--   6. Trigger enforce_barber_limit  → límite del plan (FOR UPDATE)
--   7. Trigger restrict_barber_self_update → barbero solo edita bio y foto
--
-- Todas las funciones usan SET search_path = '' y referencias completamente
-- calificadas (public.*, auth.*) para evitar suplantación de tablas.
-- =============================================================================

-- ============================================================================
-- 1. GRANT USAGE en esquema private al rol authenticated
-- ============================================================================
-- Las expresiones de RLS necesitan invocar las funciones auxiliares que viven
-- en el esquema private. Sin USAGE, las llamadas fallan con "permission denied".
-- El esquema ya tiene REVOKE ALL FROM public (foundation.sql).
grant usage on schema private to authenticated;

-- ============================================================================
-- 2. Funciones auxiliares de autorización (SECURITY DEFINER)
-- ============================================================================
-- SECURITY DEFINER para que lean tenant_members sin quedar atrapadas en su
-- propia RLS. Se invocan envueltas en (SELECT ...) desde las políticas para
-- que PostgreSQL las evalúe una vez por sentencia, no una vez por fila.

-- 2a. is_member — ¿El usuario actual pertenece a esta barbería?
create or replace function private.is_member(_tenant_id uuid)
returns boolean
language sql stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_members
    where tenant_id = _tenant_id
      and user_id = auth.uid()
  );
$$;

-- 2b. is_admin — ¿Es admin en esta barbería?
create or replace function private.is_admin(_tenant_id uuid)
returns boolean
language sql stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_members
    where tenant_id = _tenant_id
      and user_id = auth.uid()
      and role = 'admin'::public.member_role
  );
$$;

-- 2c. my_barber_id — UUID de la ficha de barbero del usuario en esta barbería
--     Devuelve NULL si no tiene ficha (admin que no corta, por ejemplo).
create or replace function private.my_barber_id(_tenant_id uuid)
returns uuid
language sql stable
security definer
set search_path = ''
as $$
  select id
  from public.barbers
  where tenant_id = _tenant_id
    and user_id = auth.uid();
$$;

-- 2d. is_same_tenant — ¿El usuario _user_id comparte al menos una barbería
--     con auth.uid()? Necesario para políticas de profiles (no tiene tenant_id).
create or replace function private.is_same_tenant(_user_id uuid)
returns boolean
language sql stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_members as a
    inner join public.tenant_members as b
      on a.tenant_id = b.tenant_id
    where a.user_id = auth.uid()
      and b.user_id = _user_id
  );
$$;

-- Permisos selectivos: solo authenticated puede ejecutar los 4 helpers.
-- Nadie más (ni anon ni public) necesita llamarlos.
revoke all on function private.is_member(uuid)      from public;
revoke all on function private.is_admin(uuid)       from public;
revoke all on function private.my_barber_id(uuid)   from public;
revoke all on function private.is_same_tenant(uuid) from public;

grant execute on function private.is_member(uuid)      to authenticated;
grant execute on function private.is_admin(uuid)       to authenticated;
grant execute on function private.my_barber_id(uuid)   to authenticated;
grant execute on function private.is_same_tenant(uuid) to authenticated;

-- ============================================================================
-- 3. Trigger: creación automática de profile al registrarse
-- ============================================================================
-- auth.users → profiles (1:1). Extrae full_name y avatar_url del metadata
-- del proveedor OAuth (Google, GitHub) si existe.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name'
    ),
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function private.handle_new_user();

-- ============================================================================
-- 4. Trigger: protección del último admin
-- ============================================================================
-- Siempre debe quedar al menos un admin por barbería. Se evalúa en:
--   • DELETE de un miembro con rol admin
--   • UPDATE que cambie el rol de admin a otro
create or replace function private.protect_last_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _admin_count int;
begin
  -- DELETE de un admin: verificar que quede otro
  if tg_op = 'DELETE' and old.role = 'admin'::public.member_role then
    select count(*) into _admin_count
    from public.tenant_members
    where tenant_id = old.tenant_id
      and role = 'admin'::public.member_role
      and user_id != old.user_id;

    if _admin_count = 0 then
      raise exception 'No se puede eliminar al último administrador de la barbería';
    end if;

    return old;
  end if;

  -- UPDATE que quita el rol admin: verificar que quede otro
  if tg_op = 'UPDATE'
     and old.role = 'admin'::public.member_role
     and new.role != 'admin'::public.member_role then
    select count(*) into _admin_count
    from public.tenant_members
    where tenant_id = old.tenant_id
      and role = 'admin'::public.member_role
      and user_id != old.user_id;

    if _admin_count = 0 then
      raise exception 'No se puede cambiar el rol del último administrador';
    end if;
  end if;

  -- Para DELETE de no-admin o UPDATE que no toca el rol admin → continuar
  return coalesce(new, old);
end;
$$;

create trigger trg_protect_last_admin
  before delete or update on public.tenant_members
  for each row
  execute function private.protect_last_admin();

-- ============================================================================
-- 5. Trigger: límite de miembros por plan
-- ============================================================================
-- plans.max_members (NULL = sin límite). SELECT … FOR UPDATE serializa
-- inserciones concurrentes en la misma barbería.
create or replace function private.enforce_member_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _max int;
  _current int;
begin
  -- Bloquear la fila del tenant para serializar inserciones concurrentes
  select p.max_members into _max
  from public.tenants t
  inner join public.plans p on p.code = t.plan_code
  where t.id = new.tenant_id
  for update of t;

  -- NULL = sin límite
  if _max is null then
    return new;
  end if;

  select count(*) into _current
  from public.tenant_members
  where tenant_id = new.tenant_id;

  if _current >= _max then
    raise exception 'El plan actual permite máximo % miembro(s)', _max;
  end if;

  return new;
end;
$$;

create trigger trg_enforce_member_limit
  before insert on public.tenant_members
  for each row
  execute function private.enforce_member_limit();

-- ============================================================================
-- 6. Trigger: límite de barberos activos por plan
-- ============================================================================
-- plans.max_barbers (NULL = sin límite). Se evalúa al insertar un barbero
-- activo o al reactivar uno (is_active false → true).
create or replace function private.enforce_barber_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _max int;
  _current int;
begin
  -- No verificar si el resultado será un barbero inactivo
  if new.is_active = false then
    return new;
  end if;

  -- En UPDATE, solo verificar si is_active cambia de false a true
  if tg_op = 'UPDATE' and old.is_active = true then
    return new;
  end if;

  -- Bloquear la fila del tenant para serializar
  select p.max_barbers into _max
  from public.tenants t
  inner join public.plans p on p.code = t.plan_code
  where t.id = new.tenant_id
  for update of t;

  if _max is null then
    return new;
  end if;

  select count(*) into _current
  from public.barbers
  where tenant_id = new.tenant_id
    and is_active = true;

  if _current >= _max then
    raise exception 'El plan actual permite máximo % barbero(s) activo(s)', _max;
  end if;

  return new;
end;
$$;

create trigger trg_enforce_barber_limit
  before insert or update on public.barbers
  for each row
  execute function private.enforce_barber_limit();

-- ============================================================================
-- 7. Trigger: restricción de columnas para barbero que se edita a sí mismo
-- ============================================================================
-- RLS es por fila, no por columna. El admin puede modificar cualquier columna
-- del barbero; el barbero solo su bio y photo_url. Este trigger lo hace cumplir.
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

  -- Barbero editándose: solo puede cambiar bio y photo_url
  if new.display_name  is distinct from old.display_name
     or new.role_title is distinct from old.role_title
     or new.is_active  is distinct from old.is_active
     or new.sort_order is distinct from old.sort_order
     or new.tenant_id  is distinct from old.tenant_id
     or new.user_id    is distinct from old.user_id
  then
    raise exception 'Solo puedes modificar tu biografía y foto de perfil';
  end if;

  return new;
end;
$$;

create trigger trg_restrict_barber_self_update
  before update on public.barbers
  for each row
  execute function private.restrict_barber_self_update();
