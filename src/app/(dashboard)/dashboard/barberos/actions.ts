"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/auth";

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type BarberActionState = {
  error?: string;
  success?: boolean;
};

// ─── Contexto admin autenticado ──────────────────────────────────────────────

/**
 * Verifica sesión + membresía + rol admin.
 * Devuelve el cliente Supabase y el tenantId si todo es válido,
 * o un objeto con error si falla cualquier validación.
 *
 * El tenant_id SIEMPRE proviene de la membresía server-side,
 * nunca de datos enviados por el cliente.
 */
async function getAdminContext() {
  const supabase = await getSupabaseServer();
  if (!supabase) return { error: "No autorizado." } as const;

  const authUser = await getAuthenticatedUser(supabase);
  if (!authUser?.activeMembership) {
    return { error: "No autorizado." } as const;
  }
  if (authUser.activeMembership.role !== "admin") {
    return {
      error: "Solo los administradores pueden realizar esta acción.",
    } as const;
  }

  return {
    supabase,
    tenantId: authUser.activeMembership.tenantId,
  } as const;
}

// ─── Parseo de errores Supabase ──────────────────────────────────────────────

function parseSupabaseError(error: { message: string }): string {
  if (error.message.includes("plan actual permite")) {
    return "Has alcanzado el límite de barberos activos de tu plan. Actualiza tu plan para agregar más.";
  }
  if (
    error.message.includes("display_name_not_blank") ||
    error.message.includes("btrim")
  ) {
    return "El nombre del barbero no puede estar vacío.";
  }
  if (error.message.includes("barbers_tenant_id_user_id_key")) {
    return "Este usuario ya tiene un perfil de barbero asignado en esta barbería.";
  }
  return "Ocurrió un error inesperado. Intenta de nuevo.";
}

// ─── Crear barbero ───────────────────────────────────────────────────────────

export async function createBarberAction(
  _prevState: BarberActionState,
  formData: FormData
): Promise<BarberActionState> {
  const ctx = await getAdminContext();
  if ("error" in ctx) return { error: ctx.error };

  const displayName = (formData.get("display_name") as string)?.trim();
  if (!displayName) return { error: "El nombre es obligatorio." };

  const roleTitle =
    (formData.get("role_title") as string)?.trim() || null;
  const bio = (formData.get("bio") as string)?.trim() || null;
  const photoUrl =
    (formData.get("photo_url") as string)?.trim() || null;
  const sortOrder =
    parseInt(formData.get("sort_order") as string, 10) || 0;
  const isActive = formData.get("is_active") !== "false";

  const { error } = await ctx.supabase.from("barbers").insert({
    tenant_id: ctx.tenantId,
    display_name: displayName,
    role_title: roleTitle,
    bio,
    photo_url: photoUrl,
    sort_order: sortOrder,
    is_active: isActive,
  });

  if (error) return { error: parseSupabaseError(error) };

  revalidatePath("/dashboard/barberos");
  return { success: true };
}

// ─── Editar barbero ──────────────────────────────────────────────────────────

export async function updateBarberAction(
  _prevState: BarberActionState,
  formData: FormData
): Promise<BarberActionState> {
  const ctx = await getAdminContext();
  if ("error" in ctx) return { error: ctx.error };

  const barberId = formData.get("barber_id") as string;
  if (!barberId) return { error: "ID de barbero no proporcionado." };

  const displayName = (formData.get("display_name") as string)?.trim();
  if (!displayName) return { error: "El nombre es obligatorio." };

  const roleTitle =
    (formData.get("role_title") as string)?.trim() || null;
  const bio = (formData.get("bio") as string)?.trim() || null;
  const photoUrl =
    (formData.get("photo_url") as string)?.trim() || null;
  const sortOrder =
    parseInt(formData.get("sort_order") as string, 10) || 0;
  const isActive = formData.get("is_active") !== "false";

  const { error } = await ctx.supabase
    .from("barbers")
    .update({
      display_name: displayName,
      role_title: roleTitle,
      bio,
      photo_url: photoUrl,
      sort_order: sortOrder,
      is_active: isActive,
    })
    .eq("id", barberId)
    .eq("tenant_id", ctx.tenantId);

  if (error) return { error: parseSupabaseError(error) };

  revalidatePath("/dashboard/barberos");
  return { success: true };
}

// ─── Activar / desactivar barbero ────────────────────────────────────────────

export async function toggleBarberStatusAction(
  barberId: string,
  newIsActive: boolean
): Promise<BarberActionState> {
  const ctx = await getAdminContext();
  if ("error" in ctx) return { error: ctx.error };

  const { error } = await ctx.supabase
    .from("barbers")
    .update({ is_active: newIsActive })
    .eq("id", barberId)
    .eq("tenant_id", ctx.tenantId);

  if (error) return { error: parseSupabaseError(error) };

  revalidatePath("/dashboard/barberos");
  return { success: true };
}
