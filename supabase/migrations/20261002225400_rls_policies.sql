-- =============================================================================
-- Barberías SaaS — Migración 7: Políticas RLS para las 13 tablas
-- -----------------------------------------------------------------------------
-- Parte del Paso 2 del plan de implementación.
--
-- Convenciones:
--   • RLS ya está habilitada y anon ya tiene REVOKE ALL (migraciones del Paso 1).
--   • Todas las políticas son para el rol authenticated.
--   • Las llamadas a helpers van envueltas en (SELECT ...) para que PostgreSQL
--     las evalúe una sola vez por sentencia, no una vez por fila.
--   • Toda política de escritura lleva WITH CHECK para impedir que una fila
--     sea movida a otro tenant.
--   • L = leer, C = crear, M = modificar, B = borrar.
--
-- Matriz de permisos (sección G de la arquitectura):
--   plans             : L todos
--   tenants           : L miembros, M admin (columnas restringidas aparte)
--   profiles          : L propio + compañeros; M propio
--   tenant_members    : ADMIN L,C,M,B  |  BARBER L propio
--   barbers           : ADMIN L,C,M    |  BARBER L todos, M propio (bio/foto)
--   barber_compensation: ADMIN L,C,M   |  BARBER L propio
--   services          : ADMIN L,C,M    |  BARBER L
--   business_hours    : ADMIN L,C,M,B  |  BARBER L
--   barber_working_hours: ADMIN todo   |  BARBER L todos, C,M,B propios
--   schedule_blocks   : ADMIN todo     |  BARBER L todos, C,M,B propios (no global)
--   clients           : ADMIN L,C,M    |  BARBER L,C
--   appointments      : ADMIN L,C,M    |  BARBER L,C,M propias
--   appointment_services: ADMIN L,C,M,B | BARBER L,C,B propias no completadas
-- =============================================================================

-- ============================================================================
-- 1. plans — Solo lectura para authenticated (catálogo global, sin tenant_id)
-- ============================================================================
create policy plans_select on public.plans
  for select to authenticated
  using (true);

-- ============================================================================
-- 2. tenants — L para miembros; M para admin
-- ============================================================================
-- Columnas restringidas (plan_code, status, slug) en migración aparte.
create policy tenants_select on public.tenants
  for select to authenticated
  using ((select private.is_member(id)));

create policy tenants_update on public.tenants
  for update to authenticated
  using  ((select private.is_admin(id)))
  with check ((select private.is_admin(id)));

-- ============================================================================
-- 3. profiles — L propio + compañeros de barbería; M propio
-- ============================================================================
-- profiles no tiene tenant_id → se usa is_same_tenant (SECURITY DEFINER)
-- para verificar co-membresía sin depender de la RLS de tenant_members.
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or (select private.is_same_tenant(id))
  );

create policy profiles_update on public.profiles
  for update to authenticated
  using  (id = auth.uid())
  with check (id = auth.uid());

-- ============================================================================
-- 4. tenant_members
--    ADMIN: L, C, M, B en su barbería
--    BARBER: L solo su propia fila
-- ============================================================================
create policy tenant_members_select on public.tenant_members
  for select to authenticated
  using (
    (select private.is_admin(tenant_id))
    or user_id = auth.uid()
  );

create policy tenant_members_insert on public.tenant_members
  for insert to authenticated
  with check ((select private.is_admin(tenant_id)));

create policy tenant_members_update on public.tenant_members
  for update to authenticated
  using  ((select private.is_admin(tenant_id)))
  with check ((select private.is_admin(tenant_id)));

create policy tenant_members_delete on public.tenant_members
  for delete to authenticated
  using ((select private.is_admin(tenant_id)));

-- ============================================================================
-- 5. barbers
--    ADMIN: L, C, M (todas las columnas)
--    BARBER: L todos; M solo su propia fila (bio y foto por trigger)
--    Nadie borra barberos (se desactivan con is_active = false).
-- ============================================================================
create policy barbers_select on public.barbers
  for select to authenticated
  using ((select private.is_member(tenant_id)));

create policy barbers_insert on public.barbers
  for insert to authenticated
  with check ((select private.is_admin(tenant_id)));

create policy barbers_update on public.barbers
  for update to authenticated
  using (
    (select private.is_admin(tenant_id))
    or (
      user_id = auth.uid()
      and (select private.is_member(tenant_id))
    )
  )
  with check (
    (select private.is_admin(tenant_id))
    or (
      user_id = auth.uid()
      and (select private.is_member(tenant_id))
    )
  );
-- La restricción de columnas para barbero la aplica trg_restrict_barber_self_update.

-- ============================================================================
-- 6. barber_compensation
--    ADMIN: L, C, M
--    BARBER: L solo la suya
-- ============================================================================
create policy barber_compensation_select on public.barber_compensation
  for select to authenticated
  using (
    (select private.is_admin(tenant_id))
    or barber_id = (select private.my_barber_id(tenant_id))
  );

create policy barber_compensation_insert on public.barber_compensation
  for insert to authenticated
  with check ((select private.is_admin(tenant_id)));

create policy barber_compensation_update on public.barber_compensation
  for update to authenticated
  using  ((select private.is_admin(tenant_id)))
  with check ((select private.is_admin(tenant_id)));

-- ============================================================================
-- 7. services — L para miembros; C, M para admin. Nadie borra.
-- ============================================================================
create policy services_select on public.services
  for select to authenticated
  using ((select private.is_member(tenant_id)));

create policy services_insert on public.services
  for insert to authenticated
  with check ((select private.is_admin(tenant_id)));

create policy services_update on public.services
  for update to authenticated
  using  ((select private.is_admin(tenant_id)))
  with check ((select private.is_admin(tenant_id)));

-- ============================================================================
-- 8. business_hours — L para miembros; C, M, B para admin
-- ============================================================================
create policy business_hours_select on public.business_hours
  for select to authenticated
  using ((select private.is_member(tenant_id)));

create policy business_hours_insert on public.business_hours
  for insert to authenticated
  with check ((select private.is_admin(tenant_id)));

create policy business_hours_update on public.business_hours
  for update to authenticated
  using  ((select private.is_admin(tenant_id)))
  with check ((select private.is_admin(tenant_id)));

create policy business_hours_delete on public.business_hours
  for delete to authenticated
  using ((select private.is_admin(tenant_id)));

-- ============================================================================
-- 9. barber_working_hours
--    ADMIN: todo
--    BARBER: L todos; C, M, B solo los propios
-- ============================================================================
create policy barber_working_hours_select on public.barber_working_hours
  for select to authenticated
  using ((select private.is_member(tenant_id)));

create policy barber_working_hours_insert on public.barber_working_hours
  for insert to authenticated
  with check (
    (select private.is_admin(tenant_id))
    or barber_id = (select private.my_barber_id(tenant_id))
  );

create policy barber_working_hours_update on public.barber_working_hours
  for update to authenticated
  using (
    (select private.is_admin(tenant_id))
    or barber_id = (select private.my_barber_id(tenant_id))
  )
  with check (
    (select private.is_admin(tenant_id))
    or barber_id = (select private.my_barber_id(tenant_id))
  );

create policy barber_working_hours_delete on public.barber_working_hours
  for delete to authenticated
  using (
    (select private.is_admin(tenant_id))
    or barber_id = (select private.my_barber_id(tenant_id))
  );

-- ============================================================================
-- 10. schedule_blocks
--     ADMIN: todo (incluye bloqueos globales con barber_id = NULL)
--     BARBER: L todos; C, M, B propios (barber_id NOT NULL obligatorio)
-- ============================================================================
create policy schedule_blocks_select on public.schedule_blocks
  for select to authenticated
  using ((select private.is_member(tenant_id)));

create policy schedule_blocks_insert on public.schedule_blocks
  for insert to authenticated
  with check (
    (select private.is_admin(tenant_id))
    or (
      barber_id is not null
      and barber_id = (select private.my_barber_id(tenant_id))
    )
  );

create policy schedule_blocks_update on public.schedule_blocks
  for update to authenticated
  using (
    (select private.is_admin(tenant_id))
    or barber_id = (select private.my_barber_id(tenant_id))
  )
  with check (
    (select private.is_admin(tenant_id))
    or (
      barber_id is not null
      and barber_id = (select private.my_barber_id(tenant_id))
    )
  );

create policy schedule_blocks_delete on public.schedule_blocks
  for delete to authenticated
  using (
    (select private.is_admin(tenant_id))
    or barber_id = (select private.my_barber_id(tenant_id))
  );

-- ============================================================================
-- 11. clients — L, C para miembros; M solo admin (incluye anonimización)
-- ============================================================================
-- Nadie borra clientes (se anonimizan con deleted_at + datos genéricos).
create policy clients_select on public.clients
  for select to authenticated
  using ((select private.is_member(tenant_id)));

create policy clients_insert on public.clients
  for insert to authenticated
  with check ((select private.is_member(tenant_id)));

create policy clients_update on public.clients
  for update to authenticated
  using  ((select private.is_admin(tenant_id)))
  with check ((select private.is_admin(tenant_id)));

-- ============================================================================
-- 12. appointments
--     ADMIN: L, C, M (todas las citas de la barbería)
--     BARBER: L, C, M solo las propias (no puede cambiar barber_id)
-- ============================================================================
-- Nadie borra citas (se cancelan).
-- El WITH CHECK para barber impide reasignación: si intenta cambiar barber_id
-- a otro barbero, el NEW.barber_id ya no coincide con my_barber_id() y falla.
create policy appointments_select on public.appointments
  for select to authenticated
  using (
    (select private.is_admin(tenant_id))
    or barber_id = (select private.my_barber_id(tenant_id))
  );

create policy appointments_insert on public.appointments
  for insert to authenticated
  with check (
    (select private.is_admin(tenant_id))
    or barber_id = (select private.my_barber_id(tenant_id))
  );

create policy appointments_update on public.appointments
  for update to authenticated
  using (
    (select private.is_admin(tenant_id))
    or barber_id = (select private.my_barber_id(tenant_id))
  )
  with check (
    (select private.is_admin(tenant_id))
    or barber_id = (select private.my_barber_id(tenant_id))
  );

-- ============================================================================
-- 13. appointment_services
--     ADMIN: L, C, M, B (sin restricciones en la barbería)
--     BARBER: L, C, B en citas propias no completadas
--     (M solo admin — el barbero solo puede agregar y borrar líneas)
-- ============================================================================
-- La verificación de propiedad se hace vía EXISTS en appointments porque
-- appointment_services no tiene barber_id propio.
create policy appointment_services_select on public.appointment_services
  for select to authenticated
  using (
    (select private.is_admin(tenant_id))
    or exists (
      select 1 from public.appointments a
      where a.tenant_id = appointment_services.tenant_id
        and a.id        = appointment_services.appointment_id
        and a.barber_id = (select private.my_barber_id(appointment_services.tenant_id))
    )
  );

create policy appointment_services_insert on public.appointment_services
  for insert to authenticated
  with check (
    (select private.is_admin(tenant_id))
    or exists (
      select 1 from public.appointments a
      where a.tenant_id = appointment_services.tenant_id
        and a.id        = appointment_services.appointment_id
        and a.barber_id = (select private.my_barber_id(appointment_services.tenant_id))
        and a.status   != 'completed'::public.appointment_status
    )
  );

create policy appointment_services_update on public.appointment_services
  for update to authenticated
  using  ((select private.is_admin(tenant_id)))
  with check ((select private.is_admin(tenant_id)));

create policy appointment_services_delete on public.appointment_services
  for delete to authenticated
  using (
    (select private.is_admin(tenant_id))
    or exists (
      select 1 from public.appointments a
      where a.tenant_id = appointment_services.tenant_id
        and a.id        = appointment_services.appointment_id
        and a.barber_id = (select private.my_barber_id(appointment_services.tenant_id))
        and a.status   != 'completed'::public.appointment_status
    )
  );
