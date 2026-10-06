-- =============================================================================
-- Barberías SaaS — Migración 8: Seguridad a nivel de columna
-- -----------------------------------------------------------------------------
-- RLS es por fila, no por columna. Para impedir que incluso un admin modifique
-- plan_code, status o slug desde la API, se usa GRANT/REVOKE a nivel de columna.
--
-- Estas tres columnas solo se cambian desde la plataforma (service_role/panel
-- de Supabase), nunca desde la app del usuario.
--
-- Pasos:
--   1. Revocar UPDATE a nivel de tabla para authenticated.
--   2. Re-otorgar UPDATE solo en las columnas permitidas.
--
-- La política RLS tenants_update ya restringe a admins. Este GRANT restringe
-- QUÉ columnas puede tocar ese admin.
-- =============================================================================

-- Revocar el UPDATE genérico (que incluye todas las columnas)
revoke update on public.tenants from authenticated;

-- Re-otorgar UPDATE solo en las columnas que el admin puede modificar
grant update (name, timezone, theme, site_content) on public.tenants to authenticated;
