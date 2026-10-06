/**
 * Helpers de autenticación para el área privada.
 *
 * Resuelven la sesión, membresías y rol del usuario usando
 * exclusivamente `tenant_members.role` como fuente de verdad.
 *
 * NUNCA se lee el rol desde user_metadata, app_metadata ni JWT.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";

type Client = SupabaseClient<Database>;

export type MemberRole = Database["public"]["Enums"]["member_role"];

export interface TenantMembership {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  tenantLogo: string | null;
  role: MemberRole;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  memberships: TenantMembership[];
  /** Membership activa (primera para MVP) */
  activeMembership: TenantMembership | null;
}

/**
 * Obtiene el usuario autenticado con sus membresías.
 *
 * Flujo: auth.users → profiles → tenant_members → tenants
 *
 * Devuelve null si no hay sesión o si el usuario no tiene perfil.
 */
export async function getAuthenticatedUser(
  supabase: Client
): Promise<AuthenticatedUser | null> {
  // 1. Verificar sesión
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return null;
  }

  // 2. Obtener perfil
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, avatar_url")
    .eq("id", user.id)
    .single();

  // 3. Obtener membresías con datos del tenant
  const { data: memberships } = await supabase
    .from("tenant_members")
    .select(
      `
      role,
      tenant_id,
      tenants!tenant_members_tenant_id_fkey (
        id,
        name,
        slug,
        logo_url
      )
    `
    )
    .eq("user_id", user.id);

  const resolvedMemberships: TenantMembership[] = (memberships ?? [])
    .filter((m) => m.tenants) // solo membresías con tenant válido
    .map((m) => {
      // El join retorna un objeto o array; normalizar
      const tenant = Array.isArray(m.tenants) ? m.tenants[0] : m.tenants;
      return {
        tenantId: tenant!.id,
        tenantName: tenant!.name,
        tenantSlug: tenant!.slug,
        tenantLogo: tenant!.logo_url,
        role: m.role,
      };
    });

  return {
    id: user.id,
    email: user.email ?? "",
    fullName: profile?.full_name ?? null,
    avatarUrl: profile?.avatar_url ?? null,
    memberships: resolvedMemberships,
    activeMembership: resolvedMemberships[0] ?? null,
  };
}
