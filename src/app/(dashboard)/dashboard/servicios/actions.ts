"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/auth";

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type ServiceActionState = {
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

// ─── Precio: conversión pesos ↔ centavos ────────────────────────────────────

/** Rangos reales de las columnas de Supabase. */
const INT4_MAX = 2147483647; // integer
const SMALLINT_MIN = -32768; // smallint
const SMALLINT_MAX = 32767;

/**
 * Parsea un entero estricto desde un valor de FormData.
 * Acepta únicamente cadenas con formato entero (`/^-?\d+$/`), por lo que
 * rechaza "30abc", "30.5", "1e2", "0x10" y valores vacíos.
 * Devuelve null si no es válido o queda fuera de [min, max].
 */
function parseStrictInteger(
  raw: FormDataEntryValue | null,
  min: number,
  max: number
): number | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;

  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) return null;
  if (value < min || value > max) return null;

  return value;
}

/**
 * Convierte un string de pesos (p. ej. "150.50") a centavos enteros sin
 * aritmética de punto flotante, para evitar errores de redondeo.
 * Devuelve null si el formato no es válido o si el resultado no es un
 * entero seguro que quepa en la columna `price_cents` (integer).
 */
function parsePriceToCents(raw: string): number | null {
  const trimmed = raw.trim().replace(",", ".");
  if (!trimmed) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;

  const [intPart, decPart = ""] = trimmed.split(".");
  const cents =
    Number(intPart) * 100 + Number(decPart.padEnd(2, "0").slice(0, 2));

  if (!Number.isSafeInteger(cents)) return null;
  if (cents > INT4_MAX) return null;

  return cents;
}

// ─── Parseo de errores Supabase ──────────────────────────────────────────────

function parseSupabaseError(error: { message: string }): string {
  if (
    error.message.includes("services_name_not_blank") ||
    error.message.includes("btrim")
  ) {
    return "El nombre del servicio no puede estar vacío.";
  }
  if (error.message.includes("services_duration_positive")) {
    return "La duración debe ser mayor a 0 minutos.";
  }
  if (error.message.includes("services_price_non_negative")) {
    return "El precio no puede ser negativo.";
  }
  return "Ocurrió un error inesperado. Intenta de nuevo.";
}

// ─── Crear servicio ──────────────────────────────────────────────────────────

export async function createServiceAction(
  _prevState: ServiceActionState,
  formData: FormData
): Promise<ServiceActionState> {
  const ctx = await getAdminContext();
  if ("error" in ctx) return { error: ctx.error };

  const name = (formData.get("name") as string)?.trim();
  if (!name) return { error: "El nombre es obligatorio." };

  const description = (formData.get("description") as string)?.trim() || null;

  const priceRaw = (formData.get("price") as string) ?? "";
  const priceCents = parsePriceToCents(priceRaw);
  if (priceCents === null || priceCents < 0) {
    return { error: "El precio no es válido." };
  }

  const durationMinutes = parseStrictInteger(
    formData.get("duration_minutes"),
    1,
    INT4_MAX
  );
  if (durationMinutes === null) {
    return { error: "La duración debe ser un número entero mayor a 0." };
  }

  // Orden: vacío/no proporcionado → 0; si viene, debe ser entero smallint válido
  const sortOrderRaw = formData.get("sort_order");
  const hasSortOrder =
    typeof sortOrderRaw === "string" && sortOrderRaw.trim() !== "";
  const safeSortOrder = hasSortOrder
    ? parseStrictInteger(sortOrderRaw, SMALLINT_MIN, SMALLINT_MAX)
    : 0;
  if (safeSortOrder === null) {
    return { error: "El orden debe ser un número entero válido." };
  }

  const isActive = formData.get("is_active") !== "false";

  const { error } = await ctx.supabase.from("services").insert({
    tenant_id: ctx.tenantId,
    name,
    description,
    price_cents: priceCents,
    duration_minutes: durationMinutes,
    sort_order: safeSortOrder,
    is_active: isActive,
  });

  if (error) return { error: parseSupabaseError(error) };

  revalidatePath("/dashboard/servicios");
  return { success: true };
}

// ─── Editar servicio ─────────────────────────────────────────────────────────

export async function updateServiceAction(
  _prevState: ServiceActionState,
  formData: FormData
): Promise<ServiceActionState> {
  const ctx = await getAdminContext();
  if ("error" in ctx) return { error: ctx.error };

  const serviceId = formData.get("service_id") as string;
  if (!serviceId) return { error: "ID de servicio no proporcionado." };

  const name = (formData.get("name") as string)?.trim();
  if (!name) return { error: "El nombre es obligatorio." };

  const description = (formData.get("description") as string)?.trim() || null;

  const priceRaw = (formData.get("price") as string) ?? "";
  const priceCents = parsePriceToCents(priceRaw);
  if (priceCents === null || priceCents < 0) {
    return { error: "El precio no es válido." };
  }

  const durationMinutes = parseStrictInteger(
    formData.get("duration_minutes"),
    1,
    INT4_MAX
  );
  if (durationMinutes === null) {
    return { error: "La duración debe ser un número entero mayor a 0." };
  }

  // Orden: vacío/no proporcionado → 0; si viene, debe ser entero smallint válido
  const sortOrderRaw = formData.get("sort_order");
  const hasSortOrder =
    typeof sortOrderRaw === "string" && sortOrderRaw.trim() !== "";
  const safeSortOrder = hasSortOrder
    ? parseStrictInteger(sortOrderRaw, SMALLINT_MIN, SMALLINT_MAX)
    : 0;
  if (safeSortOrder === null) {
    return { error: "El orden debe ser un número entero válido." };
  }

  const isActive = formData.get("is_active") !== "false";

  const { error } = await ctx.supabase
    .from("services")
    .update({
      name,
      description,
      price_cents: priceCents,
      duration_minutes: durationMinutes,
      sort_order: safeSortOrder,
      is_active: isActive,
    })
    .eq("id", serviceId)
    .eq("tenant_id", ctx.tenantId);

  if (error) return { error: parseSupabaseError(error) };

  revalidatePath("/dashboard/servicios");
  return { success: true };
}

// ─── Activar / desactivar servicio ───────────────────────────────────────────

export async function toggleServiceStatusAction(
  serviceId: string,
  newIsActive: boolean
): Promise<ServiceActionState> {
  const ctx = await getAdminContext();
  if ("error" in ctx) return { error: ctx.error };

  const { error } = await ctx.supabase
    .from("services")
    .update({ is_active: newIsActive })
    .eq("id", serviceId)
    .eq("tenant_id", ctx.tenantId);

  if (error) return { error: parseSupabaseError(error) };

  revalidatePath("/dashboard/servicios");
  return { success: true };
}
