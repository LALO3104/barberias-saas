/**
 * Funciones auxiliares para las RPC públicas de Supabase.
 *
 * Abstraen las llamadas `supabase.rpc(...)` y tipan las respuestas con los
 * tipos de `@/types/public`. El frontend público SOLO debe acceder a datos
 * a través de estas funciones — nunca con SELECT directo a tablas.
 *
 * Se usa el cliente anon (server o browser según el contexto). Nunca se
 * expone `service_role` aquí.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import type {
  PublicTenant,
  AvailableSlot,
  BookingConfirmation,
} from "@/types/public";

type Client = SupabaseClient<Database>;

// ─── Errores tipados ────────────────────────────────────────────────────────

export class PublicApiError extends Error {
  constructor(
    message: string,
    public readonly code: string | null
  ) {
    super(message);
    this.name = "PublicApiError";
  }
}

/** Errores conocidos del backend */
export const ERROR_CODES = {
  NOT_FOUND: "P0002",
  SLOT_TAKEN: "P0003",
  VALIDATION: "23514", // check_violation
} as const;

// ─── get_public_tenant ──────────────────────────────────────────────────────

export async function fetchPublicTenant(
  client: Client,
  slug: string
): Promise<PublicTenant | null> {
  const { data, error } = await client.rpc("get_public_tenant", {
    _slug: slug,
  });

  if (error) {
    if (error.code === ERROR_CODES.NOT_FOUND) {
      return null;
    }
    throw new PublicApiError(
      "No se pudo cargar la información de la barbería",
      error.code
    );
  }

  return data as unknown as PublicTenant;
}

// ─── get_available_slots ────────────────────────────────────────────────────

export async function fetchAvailableSlots(
  client: Client,
  slug: string,
  barberId: string,
  serviceId: string,
  targetDate: string // YYYY-MM-DD
): Promise<AvailableSlot[]> {
  const { data, error } = await client.rpc("get_available_slots", {
    _slug: slug,
    _barber_id: barberId,
    _service_id: serviceId,
    _target_date: targetDate,
  });

  if (error) {
    if (error.code === ERROR_CODES.NOT_FOUND) {
      throw new PublicApiError(
        "Barbero o servicio no encontrado",
        error.code
      );
    }
    throw new PublicApiError(
      "No se pudieron cargar los horarios disponibles",
      error.code
    );
  }

  return (data ?? []) as AvailableSlot[];
}

// ─── book_appointment ───────────────────────────────────────────────────────

export async function bookAppointment(
  client: Client,
  params: {
    slug: string;
    barberId: string;
    serviceId: string;
    startAt: string; // timestamptz ISO string
    clientName: string;
    clientPhone: string;
    clientNote?: string;
  }
): Promise<BookingConfirmation> {
  const { data, error } = await client.rpc("book_appointment", {
    _slug: params.slug,
    _barber_id: params.barberId,
    _service_id: params.serviceId,
    _start_at: params.startAt,
    _client_name: params.clientName,
    _client_phone: params.clientPhone,
    _client_note: params.clientNote || undefined,
  });

  if (error) {
    if (error.code === ERROR_CODES.SLOT_TAKEN) {
      throw new PublicApiError(
        "Este horario acaba de ser reservado. Selecciona otro horario.",
        error.code
      );
    }
    if (error.code === ERROR_CODES.NOT_FOUND) {
      throw new PublicApiError(
        "Barbero o servicio no encontrado",
        error.code
      );
    }
    // check_violation — validaciones del backend
    if (error.code === ERROR_CODES.VALIDATION || error.code === "23514") {
      throw new PublicApiError(
        error.message?.includes("E.164")
          ? "El teléfono debe estar en formato internacional (ej: +525512345678)"
          : "Los datos de la reserva no son válidos. Revisa la información e intenta de nuevo.",
        error.code
      );
    }
    throw new PublicApiError(
      "No se pudo completar la reserva. Intenta de nuevo.",
      error.code
    );
  }

  return data as unknown as BookingConfirmation;
}
