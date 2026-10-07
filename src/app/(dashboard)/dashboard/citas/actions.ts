"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { CANCEL_REASON_MAX, isTargetStatus } from "@/lib/appointments";

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type AppointmentActionResult = {
  success?: boolean;
  error?: string;
  /** La cita cambió en otro lado: la UI debe recargar los datos. */
  stale?: boolean;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Errores de base de datos → mensajes claros ─────────────────────────────

function mapStatusError(error: { code?: string; message: string }): AppointmentActionResult {
  switch (error.code) {
    case "P0002": // cita inexistente o fuera del alcance (RLS)
      return { error: "La cita no existe o no tienes acceso a ella.", stale: true };
    case "42501":
      return { error: "No tienes permiso para modificar esta cita." };
    case "BA001": // transición inválida o ya cambiada por otro usuario
      return {
        error: "Esta cita cambió de estado mientras tanto. Actualizamos la agenda.",
        stale: true,
      };
    case "BA002":
      return { error: "Indica el motivo de la cancelación (máximo 500 caracteres)." };
    default:
      return { error: "No se pudo actualizar la cita. Intenta de nuevo." };
  }
}

// ─── Cambio de estado ────────────────────────────────────────────────────────

/**
 * Cambia el estado de una cita (confirmar, completar, cancelar, no se presentó).
 *
 * Autorización en capas, sin confiar en el cliente:
 *   1. Sesión + membresía activa (tenant y rol desde tenant_members).
 *   2. La cita debe pertenecer al tenant activo (consulta con RLS: un barbero
 *      solo "ve" sus propias citas, así que la de otro barbero no aparece).
 *   3. set_appointment_status (SECURITY INVOKER) vuelve a verificar permiso,
 *      bloquea la fila y valida la transición contra el estado ACTUAL.
 *   4. El trigger de la tabla valida la transición en cualquier otra ruta.
 */
export async function changeAppointmentStatusAction(
  appointmentId: unknown,
  newStatus: unknown,
  reason?: unknown
): Promise<AppointmentActionResult> {
  const supabase = await getSupabaseServer();
  if (!supabase) return { error: "Tu sesión expiró. Vuelve a iniciar sesión." };

  const authUser = await getAuthenticatedUser(supabase);
  const membership = authUser?.activeMembership;
  if (!membership) return { error: "Tu sesión expiró. Vuelve a iniciar sesión." };
  if (membership.role !== "admin" && membership.role !== "barber") {
    return { error: "No tienes permiso para modificar citas." };
  }

  if (typeof appointmentId !== "string" || !UUID_RE.test(appointmentId)) {
    return { error: "Cita no válida." };
  }
  if (!isTargetStatus(newStatus)) {
    return { error: "Acción no válida." };
  }

  let cleanReason: string | undefined;
  if (newStatus === "cancelled") {
    cleanReason = typeof reason === "string" ? reason.trim() : "";
    if (!cleanReason) return { error: "Indica el motivo de la cancelación." };
    if (cleanReason.length > CANCEL_REASON_MAX) {
      return { error: `El motivo no puede superar ${CANCEL_REASON_MAX} caracteres.` };
    }
  }

  // La cita debe ser del tenant activo y visible para este usuario (RLS).
  const { data: appointment, error: lookupError } = await supabase
    .from("appointments")
    .select("id")
    .eq("id", appointmentId)
    .eq("tenant_id", membership.tenantId)
    .maybeSingle();

  if (lookupError) {
    return { error: "No se pudo verificar la cita. Intenta de nuevo." };
  }
  if (!appointment) {
    return { error: "La cita no existe o no tienes acceso a ella.", stale: true };
  }

  const { error } = await supabase.rpc("set_appointment_status", {
    _appointment_id: appointment.id,
    _new_status: newStatus,
    _reason: cleanReason,
  });

  if (error) {
    revalidatePath("/dashboard/citas");
    return mapStatusError(error);
  }

  revalidatePath("/dashboard/citas");
  revalidatePath("/dashboard");
  return { success: true };
}
