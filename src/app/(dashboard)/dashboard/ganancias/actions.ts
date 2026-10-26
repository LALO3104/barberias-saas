"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { isDateKey } from "@/lib/appointments";

export type PayoutResult = { success?: boolean; error?: string };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Sesión + membresía + rol admin (tenant desde tenant_members, nunca del cliente). */
async function getAdminContext() {
  const supabase = await getSupabaseServer();
  if (!supabase) return { error: "Tu sesión expiró. Vuelve a iniciar sesión." } as const;
  const authUser = await getAuthenticatedUser(supabase);
  const membership = authUser?.activeMembership;
  if (!membership) return { error: "Tu sesión expiró. Vuelve a iniciar sesión." } as const;
  if (membership.role !== "admin") return { error: "Solo el administrador puede registrar pagos." } as const;
  return { supabase, tenantId: membership.tenantId } as const;
}

/**
 * Marca como pagado el periodo de un barbero. La comisión y las propinas las
 * calcula public.record_barber_payout de los cobros activos; el salario se
 * captura (centavos).
 */
export async function recordPayoutAction(input: unknown): Promise<PayoutResult> {
  const ctx = await getAdminContext();
  if ("error" in ctx) return { error: ctx.error };

  const data = (input ?? {}) as Record<string, unknown>;
  if (typeof data.barberId !== "string" || !UUID_RE.test(data.barberId)) return { error: "Barbero no válido." };
  if (!isDateKey(data.from) || !isDateKey(data.to) || data.to < data.from) {
    return { error: "El periodo no es válido." };
  }
  const salary = data.salaryCents ?? 0;
  if (typeof salary !== "number" || !Number.isInteger(salary) || salary < 0 || salary > 100_000_000) {
    return { error: "El salario no es válido." };
  }
  const note = typeof data.note === "string" ? data.note.trim() : "";
  if (note.length > 300) return { error: "La nota no puede superar 300 caracteres." };

  const { error } = await ctx.supabase.rpc("record_barber_payout", {
    _barber_id: data.barberId,
    _period_start: data.from,
    _period_end: data.to,
    _salary_cents: salary,
    _note: note || undefined,
  });

  if (error) {
    switch (error.code) {
      case "BA011":
        return { error: "Ya hay un pago registrado que cubre parte de ese periodo." };
      case "23514":
        return { error: error.message };
      case "P0002":
        return { error: "El barbero no pertenece a tu barbería." };
      default:
        return { error: "No se pudo registrar el pago. Intenta de nuevo." };
    }
  }

  revalidatePath("/dashboard/ganancias");
  return { success: true };
}

/** El admin anula un pago (con motivo); el periodo queda libre de nuevo. */
export async function voidPayoutAction(payoutId: unknown, reason: unknown): Promise<PayoutResult> {
  const ctx = await getAdminContext();
  if ("error" in ctx) return { error: ctx.error };

  if (typeof payoutId !== "string" || !UUID_RE.test(payoutId)) return { error: "Pago no válido." };
  const clean = typeof reason === "string" ? reason.trim() : "";
  if (!clean) return { error: "Indica el motivo de la anulación." };
  if (clean.length > 500) return { error: "El motivo no puede superar 500 caracteres." };

  const { error } = await ctx.supabase.rpc("void_barber_payout", { _payout_id: payoutId, _reason: clean });
  if (error) {
    switch (error.code) {
      case "BA009":
        return { error: "Este pago ya estaba anulado." };
      case "P0002":
        return { error: "El pago no existe o no tienes acceso a él." };
      case "23514":
        return { error: error.message };
      default:
        return { error: "No se pudo anular el pago. Intenta de nuevo." };
    }
  }

  revalidatePath("/dashboard/ganancias");
  return { success: true };
}
