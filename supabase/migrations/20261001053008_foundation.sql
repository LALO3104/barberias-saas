-- =============================================================================
-- Barberías SaaS — Migración 1/5: fundamentos
-- -----------------------------------------------------------------------------
-- Fuente de verdad: "Barberías SaaS — Arquitectura de datos, Auth y RLS"
-- (secciones C, F, G y L).
--
-- Contenido:
--   * Extensión btree_gist (necesaria para la restricción de exclusión que
--     impide la doble reserva en appointments, migración 5).
--   * Esquema `private` para funciones internas. La API de Supabase solo
--     expone `public` y `graphql_public` (supabase/config.toml), así que nada
--     de aquí es invocable desde el navegador.
--   * Funciones de trigger reutilizables.
--   * Enums del MVP.
--   * Privilegios por defecto: ninguna tabla futura de `public` se otorga
--     automáticamente al rol `anon`.
--
-- Fuera de alcance de este paso (según el plan): políticas RLS, funciones
-- públicas (get_public_tenant, get_available_slots, book_appointment),
-- triggers de negocio (alta de perfil, último admin, límites de plan,
-- transiciones de estado, copia de comisión, congelado de líneas).
-- =============================================================================

-- Extensiones ---------------------------------------------------------------

-- Supabase instala las extensiones en el esquema `extensions`.
create extension if not exists btree_gist with schema extensions;

-- Esquema privado -----------------------------------------------------------

create schema if not exists private;

-- Nadie fuera del dueño (postgres) usa este esquema directamente.
revoke all on schema private from public;

-- Funciones de trigger ------------------------------------------------------

-- Mantiene `updated_at` en cada UPDATE. Se usa en todas las tablas que lo
-- tienen, en lugar de depender de que la app lo envíe.
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function private.set_updated_at() is
  'Trigger BEFORE UPDATE: actualiza updated_at a now().';

revoke all on function private.set_updated_at() from public;

-- Enums ---------------------------------------------------------------------

-- Rol de una persona dentro de UNA barbería (tenant_members.role).
-- MVP: solo admin y barber. `owner` / `receptionist` quedan para después
-- (agregar un valor a un enum es una migración trivial).
create type public.member_role as enum ('admin', 'barber');

-- Estados de una cita. La reserva pública entra como `pending` y el admin
-- la aprueba (`confirmed`) o la rechaza (`cancelled`). `completed`,
-- `cancelled` y `no_show` son finales.
create type public.appointment_status as enum (
  'pending',
  'confirmed',
  'completed',
  'cancelled',
  'no_show'
);

-- Canal por el que entró la cita.
create type public.appointment_source as enum ('online', 'staff', 'walk_in');

-- Privilegios por defecto ---------------------------------------------------

-- Supabase otorga por defecto todas las tablas nuevas de `public` a `anon`,
-- `authenticated` y `service_role`. La arquitectura establece que el
-- visitante anónimo NO accede a tablas (solo a funciones específicas, que se
-- otorgarán explícitamente cuando existan). Esto evita que una tabla futura
-- quede expuesta a `anon` por omisión.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
