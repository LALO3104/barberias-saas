"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { validateWeek } from "@/lib/schedule";

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type ScheduleActionState = {
  error?: string;
  success?: boolean;
};

// ─── Contexto autenticado ────────────────────────────────────────────────────

/**
 * Verifica sesión + membresía activa.
 *
 * tenantId, role y userId SIEMPRE provienen de la sesión y de
 * tenant_members.role (server-side); nunca de datos enviados por el cliente.
 */
async function getMemberContext() {
  const supabase = await getSupabaseServer();
  if (!supabase) return { error: "No autorizado." } as const;

  const authUser = await getAuthenticatedUser(supabase);
  if (!authUser?.activeMembership) {
    return { error: "No autorizado." } as const;
  }

  return {
    supabase,
    userId: authUser.id,
    tenantId: authUser.activeMembership.tenantId,
    role: authUser.activeMembership.role,
  } as const;
}

/** Igual que getMemberContext, pero exige rol admin. */
async function getAdminContext() {
  const ctx = await getMemberContext();
  if ("error" in ctx) return ctx;
  if (ctx.role !== "admin") {
    return {
      error: "Solo los administradores pueden realizar esta acción.",
    } as const;
  }
  return ctx;
}

// ─── Errores de base de datos → mensajes claros ─────────────────────────────

function parseScheduleError(error: { code?: string; message: string }): string {
  switch (error.code) {
    case "23P01": // exclusion constraint *_no_overlap
      return "Hay intervalos que se solapan o están repetidos. Revisa el horario.";
    case "23514": // check constraint (día 1..7, cierre > apertura)
      return "Hay un intervalo inválido: la hora de cierre debe ser posterior a la de apertura.";
    case "22007":
    case "22008": // formato de hora inválido
      return "Hay una hora con formato inválido.";
    case "42501": // permiso (función o RLS)
      return "No tienes permiso para modificar este horario.";
    case "P0002": // barbero no encontrado en el tenant
    case "23503": // FK compuesta (tenant_id, barber_id)
      return "El barbero no pertenece a tu barbería.";
    default:
      return "No se pudo guardar el horario. Intenta de nuevo.";
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Horario de la barbería ──────────────────────────────────────────────────

/**
 * Reemplaza el horario semanal de la barbería activa.
 * `week` se recibe como `unknown` y se valida por completo en el servidor.
 */
export async function saveBusinessHoursAction(
  week: unknown
): Promise<ScheduleActionState> {
  const ctx = await getAdminContext();
  if ("error" in ctx) return { error: ctx.error };

  const validation = validateWeek(week);
  if (!validation.ok) return { error: validation.error };

  const { error } = await ctx.supabase.rpc("set_business_hours", {
    _tenant_id: ctx.tenantId,
    _intervals: validation.intervals,
  });

  if (error) return { error: parseScheduleError(error) };

  revalidatePath("/dashboard/horarios");
  return { success: true };
}

// ─── Horario de un barbero ───────────────────────────────────────────────────

/**
 * Reemplaza el horario semanal de un barbero de la barbería activa.
 *
 * Autorización (server-side, sin confiar en el cliente):
 *   - admin  → cualquier barbero de SU tenant.
 *   - barber → solo el barbero vinculado a SU usuario de sesión
 *              (barbers.user_id = auth user id).
 *
 * El barberId es solo un identificador del objetivo. La pertenencia y el
 * permiso se verifican aquí, otra vez en la función de base de datos
 * (is_admin OR my_barber_id), en la RLS y en la FK compuesta
 * (tenant_id, barber_id) → barbers.
 */
export async function saveBarberHoursAction(
  barberId: unknown,
  week: unknown
): Promise<ScheduleActionState> {
  const ctx = await getMemberContext();
  if ("error" in ctx) return { error: ctx.error };

  if (typeof barberId !== "string" || !UUID_RE.test(barberId)) {
    return { error: "Barbero no válido." };
  }

  const { data: barber, error: barberError } = await ctx.supabase
    .from("barbers")
    .select("id, user_id")
    .eq("id", barberId)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();

  if (barberError) {
    return { error: "No se pudo verificar el barbero. Intenta de nuevo." };
  }
  if (!barber) return { error: "El barbero no pertenece a tu barbería." };

  // Un barbero solo puede editar el registro vinculado a su propio usuario.
  if (ctx.role !== "admin" && barber.user_id !== ctx.userId) {
    return { error: "Solo puedes modificar tu propio horario." };
  }

  const validation = validateWeek(week);
  if (!validation.ok) return { error: validation.error };

  const { error } = await ctx.supabase.rpc("set_barber_working_hours", {
    _tenant_id: ctx.tenantId,
    _barber_id: barber.id,
    _intervals: validation.intervals,
  });

  if (error) return { error: parseScheduleError(error) };

  revalidatePath("/dashboard/horarios");
  return { success: true };
}
