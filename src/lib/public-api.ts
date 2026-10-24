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

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
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

// ─── RPC con lista de servicios (Step 10.1) ─────────────────────────────────

/** Máximo de servicios por cita (el backend también lo valida). */
export const MAX_SERVICES_PER_BOOKING = 5;

/*
 * TODO(Step 10.1): quitar al regenerar tipos.
 *
 * `src/types/supabase.ts` todavía tiene las firmas antiguas de
 * `get_available_slots` y `book_appointment` (con `_service_id`). Hasta
 * regenerarlo, esas dos RPC se llaman a través de esta interfaz mínima con
 * los argumentos nuevos (`_service_ids`). El cast vive SOLO aquí, sin `any`:
 * los argumentos quedan tipados con el contrato del backend y la respuesta
 * se trata como `unknown` hasta mapearla a `@/types/public`.
 */
interface AvailableSlotsArgs {
  _slug: string;
  _barber_id: string;
  _service_ids: string[];
  _target_date: string; // YYYY-MM-DD
}

interface BookAppointmentArgs {
  _slug: string;
  _barber_id: string;
  _service_ids: string[];
  _start_at: string;
  _client_name: string;
  _client_phone: string;
  _client_note?: string;
}

interface RpcResult {
  data: unknown;
  error: PostgrestError | null;
}

interface MultiServiceRpcClient {
  rpc(fn: "get_available_slots", args: AvailableSlotsArgs): PromiseLike<RpcResult>;
  rpc(fn: "book_appointment", args: BookAppointmentArgs): PromiseLike<RpcResult>;
}

function multiServiceRpc(client: Client): MultiServiceRpcClient {
  // Se devuelve el mismo cliente (no el método suelto) para conservar `this`.
  return client as unknown as MultiServiceRpcClient;
}

const INVALID_SERVICES_MESSAGE =
  "La selección de servicios no es válida. Elige de 1 a 5 servicios distintos.";

const UNAVAILABLE_MESSAGE =
  "El barbero o alguno de los servicios ya no está disponible.";

/**
 * Pre-chequeo amable de la lista de servicios (1 a 5, sin repetir). La
 * validación real ocurre en el backend; esto solo evita llamadas inútiles.
 */
function assertValidServiceIds(serviceIds: readonly string[]): void {
  const valid =
    serviceIds.length >= 1 &&
    serviceIds.length <= MAX_SERVICES_PER_BOOKING &&
    serviceIds.every((id) => typeof id === "string" && id.length > 0) &&
    new Set(serviceIds).size === serviceIds.length;

  if (!valid) {
    throw new PublicApiError(INVALID_SERVICES_MESSAGE, ERROR_CODES.VALIDATION);
  }
}

/** Traduce un 23514 (check_violation) según lo que reporte el backend. */
function validationMessage(error: PostgrestError, fallback: string): string {
  const text = `${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
  if (text.includes("teléfono") || text.includes("telefono") || text.includes("phone")) {
    return "Revisa tu teléfono: debe tener 10 dígitos (ej: 55 1234 5678).";
  }
  if (text.includes("servicio") || text.includes("service")) {
    return INVALID_SERVICES_MESSAGE;
  }
  return fallback;
}

// ─── get_available_slots ────────────────────────────────────────────────────

export async function fetchAvailableSlots(
  client: Client,
  slug: string,
  barberId: string,
  serviceIds: string[],
  targetDate: string // YYYY-MM-DD
): Promise<AvailableSlot[]> {
  assertValidServiceIds(serviceIds);

  const { data, error } = await multiServiceRpc(client).rpc(
    "get_available_slots",
    {
      _slug: slug,
      _barber_id: barberId,
      _service_ids: serviceIds,
      _target_date: targetDate,
    }
  );

  if (error) {
    if (error.code === ERROR_CODES.NOT_FOUND) {
      throw new PublicApiError(UNAVAILABLE_MESSAGE, error.code);
    }
    if (error.code === ERROR_CODES.VALIDATION) {
      throw new PublicApiError(
        validationMessage(error, INVALID_SERVICES_MESSAGE),
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
    /** 1 a 5 servicios distintos, en el orden elegido por el cliente. */
    serviceIds: string[];
    startAt: string; // timestamptz ISO string
    clientName: string;
    clientPhone: string;
    clientNote?: string;
  }
): Promise<BookingConfirmation> {
  assertValidServiceIds(params.serviceIds);

  const { data, error } = await multiServiceRpc(client).rpc(
    "book_appointment",
    {
      _slug: params.slug,
      _barber_id: params.barberId,
      _service_ids: params.serviceIds,
      _start_at: params.startAt,
      _client_name: params.clientName,
      _client_phone: params.clientPhone,
      _client_note: params.clientNote || undefined,
    }
  );

  if (error) {
    if (error.code === ERROR_CODES.SLOT_TAKEN) {
      throw new PublicApiError(
        "Este horario acaba de ser reservado. Selecciona otro horario.",
        error.code
      );
    }
    if (error.code === ERROR_CODES.NOT_FOUND) {
      throw new PublicApiError(UNAVAILABLE_MESSAGE, error.code);
    }
    // check_violation — validaciones del backend (teléfono, servicios, etc.)
    if (error.code === ERROR_CODES.VALIDATION) {
      throw new PublicApiError(
        validationMessage(
          error,
          "Los datos de la reserva no son válidos. Revisa la información e intenta de nuevo."
        ),
        error.code
      );
    }
    throw new PublicApiError(
      "No se pudo completar la reserva. Intenta de nuevo.",
      error.code
    );
  }

  return data as BookingConfirmation;
}
