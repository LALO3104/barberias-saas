"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { getTodayInTimezone } from "@/lib/format";
import {
  CANCEL_REASON_MAX,
  MAX_SERVICES_PER_APPOINTMENT,
  WALK_IN_NAME_MAX,
  WALK_IN_NOTE_MAX,
  isAppointmentStatus,
  isTargetStatus,
  isTimeKey,
  isWalkInWarning,
  zonedDateTimeToUtc,
  type AppointmentStatus,
  type WalkInWarning,
} from "@/lib/appointments";

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

// ─── Walk-ins ────────────────────────────────────────────────────────────────

export interface WalkInConflict {
  startIso: string;
  endIso: string;
  status: AppointmentStatus;
  clientName: string;
}

export type WalkInResult = {
  success?: boolean;
  error?: string;
  /** Hay avisos: la UI los muestra y puede reenviar con acknowledgeWarnings. */
  needsConfirmation?: boolean;
  warnings?: WalkInWarning[];
  conflicts?: WalkInConflict[];
};

export type WalkInClientLookup = {
  valid: boolean;
  /** Nombre del cliente existente con ese teléfono (se conserva). */
  existingName?: string;
  error?: string;
};

/**
 * Contexto del walk-in: sesión + membresía + barbero objetivo.
 *   admin  → el barbero enviado (create_walk_in verifica que sea de su barbería).
 *   barber → SIEMPRE su propio barbero, resuelto desde la sesión; lo enviado se ignora.
 */
async function getWalkInContext(requestedBarberId: unknown) {
  const supabase = await getSupabaseServer();
  if (!supabase) return { error: "Tu sesión expiró. Vuelve a iniciar sesión." } as const;

  const authUser = await getAuthenticatedUser(supabase);
  const membership = authUser?.activeMembership;
  if (!authUser || !membership) return { error: "Tu sesión expiró. Vuelve a iniciar sesión." } as const;

  if (membership.role === "admin") {
    if (typeof requestedBarberId !== "string" || !UUID_RE.test(requestedBarberId)) {
      return { error: "Elige un barbero." } as const;
    }
    return { supabase, membership, barberId: requestedBarberId } as const;
  }

  if (membership.role === "barber") {
    const { data: own, error } = await supabase
      .from("barbers")
      .select("id")
      .eq("tenant_id", membership.tenantId)
      .eq("user_id", authUser.id)
      .eq("is_active", true)
      .maybeSingle();
    if (error) return { error: "No se pudo verificar tu perfil. Intenta de nuevo." } as const;
    if (!own) return { error: "Tu cuenta no está vinculada a un barbero activo." } as const;
    return { supabase, membership, barberId: own.id } as const;
  }

  return { error: "No tienes permiso para registrar walk-ins." } as const;
}

function parseWalkInDetails(details: string | null | undefined): Pick<WalkInResult, "warnings" | "conflicts"> {
  try {
    const parsed = JSON.parse(details ?? "{}") as { warnings?: unknown; conflicts?: unknown };
    const warnings = Array.isArray(parsed.warnings) ? parsed.warnings.filter(isWalkInWarning) : [];
    const conflicts: WalkInConflict[] = Array.isArray(parsed.conflicts)
      ? parsed.conflicts.flatMap((c) => {
          const r = c as Record<string, unknown>;
          return typeof r.start_at === "string" && typeof r.end_at === "string" && isAppointmentStatus(r.status)
            ? [{
                startIso: r.start_at,
                endIso: r.end_at,
                status: r.status,
                clientName: typeof r.client_name === "string" ? r.client_name : "Cliente",
              }]
            : [];
        })
      : [];
    return { warnings, conflicts };
  } catch {
    return { warnings: [], conflicts: [] };
  }
}

/**
 * Registra un walk-in (cita confirmada creada por el personal).
 * La hora llega como "HH:MM" y se interpreta HOY en la zona de la barbería;
 * create_walk_in vuelve a validar todo (día, permisos, servicios, avisos).
 */
export async function createWalkInAction(input: unknown): Promise<WalkInResult> {
  const data = (input ?? {}) as Record<string, unknown>;

  const ctx = await getWalkInContext(data.barberId);
  if ("error" in ctx) return { error: ctx.error };

  const serviceIds = data.serviceIds;
  if (
    !Array.isArray(serviceIds) ||
    serviceIds.length < 1 ||
    serviceIds.length > MAX_SERVICES_PER_APPOINTMENT ||
    !serviceIds.every((id) => typeof id === "string" && UUID_RE.test(id)) ||
    new Set(serviceIds).size !== serviceIds.length
  ) {
    return { error: `Elige de 1 a ${MAX_SERVICES_PER_APPOINTMENT} servicios distintos.` };
  }

  if (!isTimeKey(data.time)) return { error: "Indica una hora válida." };

  const name = typeof data.clientName === "string" ? data.clientName.trim() : "";
  if (!name) return { error: "Escribe el nombre del cliente." };
  if (name.length > WALK_IN_NAME_MAX) {
    return { error: `El nombre no puede superar ${WALK_IN_NAME_MAX} caracteres.` };
  }

  const phone = typeof data.clientPhone === "string" ? data.clientPhone.trim() : "";
  if (!phone || phone.length > 30) return { error: "Escribe un teléfono válido." };

  const note = typeof data.clientNote === "string" ? data.clientNote.trim() : "";
  if (note.length > WALK_IN_NOTE_MAX) {
    return { error: `La nota no puede superar ${WALK_IN_NOTE_MAX} caracteres.` };
  }

  const { data: tenant, error: tenantError } = await ctx.supabase
    .from("tenants")
    .select("timezone")
    .eq("id", ctx.membership.tenantId)
    .single();
  if (tenantError || !tenant) return { error: "No se pudo cargar tu barbería. Intenta de nuevo." };

  const startAt = zonedDateTimeToUtc(getTodayInTimezone(tenant.timezone), data.time, tenant.timezone);

  const { error } = await ctx.supabase.rpc("create_walk_in", {
    _barber_id: ctx.barberId,
    _service_ids: serviceIds as string[],
    _start_at: startAt.toISOString(),
    _client_name: name,
    _client_phone: phone,
    _client_note: note || undefined,
    _acknowledge_warnings: data.acknowledgeWarnings === true,
  });

  if (error) {
    switch (error.code) {
      case "BA007":
        return { needsConfirmation: true, ...parseWalkInDetails(error.details) };
      case "23514": // validaciones con mensaje propio en español (día, teléfono, servicios…)
        return { error: error.message };
      case "P0002":
        return { error: "El barbero o alguno de los servicios ya no está disponible." };
      case "P0003":
        return { error: "La agenda cambió mientras tanto. Revisa el horario e intenta de nuevo." };
      case "42501":
        return { error: "No tienes permiso para registrar este walk-in." };
      default:
        return { error: "No se pudo registrar el walk-in. Intenta de nuevo." };
    }
  }

  revalidatePath("/dashboard/citas");
  revalidatePath("/dashboard");
  return { success: true };
}

/** "Cliente existente: …" mientras se escribe el teléfono del walk-in. */
export async function lookupWalkInClientAction(
  barberId: unknown,
  phone: unknown
): Promise<WalkInClientLookup> {
  const ctx = await getWalkInContext(barberId);
  if ("error" in ctx) return { valid: false, error: ctx.error };
  if (typeof phone !== "string" || !phone.trim() || phone.length > 30) return { valid: false };

  const { data, error } = await ctx.supabase.rpc("find_client_by_phone", {
    _barber_id: ctx.barberId,
    _phone: phone.trim(),
  });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) return { valid: false };

  const result = data as { valid?: boolean; client?: { name?: string } | null };
  return {
    valid: result.valid === true,
    existingName: typeof result.client?.name === "string" ? result.client.name : undefined,
  };
}
