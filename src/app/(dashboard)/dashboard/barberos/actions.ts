"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { isPayType, isSalaryPeriod } from "@/lib/compensation";

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

// ─── Compensación: comisión o salario (Step 13) ─────────────────────────────

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Define cómo se le paga a un barbero: comisión (puntos base, 0–10000) o
 * salario fijo (centavos + periodo). Solo admin (getAdminContext + RLS de
 * barber_compensation). El cambio aplica a cobros futuros: cada cobro congela
 * la compensación vigente al registrarse.
 */
export async function setBarberCompensationAction(input: unknown): Promise<BarberActionState> {
  const ctx = await getAdminContext();
  if ("error" in ctx) return { error: ctx.error };

  const data = (input ?? {}) as Record<string, unknown>;
  if (typeof data.barberId !== "string" || !UUID_RE.test(data.barberId)) {
    return { error: "Barbero no válido." };
  }
  if (!isPayType(data.payType)) return { error: "Elige comisión o salario." };

  let row: {
    pay_type: "commission" | "salary";
    commission_rate_bps: number | null;
    salary_cents: number | null;
    salary_period: string | null;
  };
  if (data.payType === "commission") {
    const bps = data.commissionRateBps;
    if (typeof bps !== "number" || !Number.isInteger(bps) || bps < 0 || bps > 10000) {
      return { error: "La comisión debe estar entre 0 % y 100 %." };
    }
    row = { pay_type: "commission", commission_rate_bps: bps, salary_cents: null, salary_period: null };
  } else {
    const cents = data.salaryCents;
    if (typeof cents !== "number" || !Number.isInteger(cents) || cents < 1 || cents > 100_000_000) {
      return { error: "Escribe un salario válido." };
    }
    if (!isSalaryPeriod(data.salaryPeriod)) return { error: "Elige el periodo del salario." };
    row = { pay_type: "salary", commission_rate_bps: null, salary_cents: cents, salary_period: data.salaryPeriod };
  }

  // El barbero debe ser de la barbería del admin (además de la FK compuesta).
  const { data: barber, error: barberError } = await ctx.supabase
    .from("barbers")
    .select("id")
    .eq("id", data.barberId)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (barberError) return { error: "No se pudo verificar el barbero. Intenta de nuevo." };
  if (!barber) return { error: "El barbero no pertenece a tu barbería." };

  const { error } = await ctx.supabase
    .from("barber_compensation")
    .upsert({ barber_id: barber.id, tenant_id: ctx.tenantId, ...row }, { onConflict: "barber_id" });

  if (error) {
    return {
      error: error.code === "23514"
        ? "Los datos de pago no son válidos."
        : "No se pudo guardar el pago del barbero. Intenta de nuevo.",
    };
  }

  revalidatePath("/dashboard/barberos");
  revalidatePath("/dashboard/ganancias");
  return { success: true };
}
