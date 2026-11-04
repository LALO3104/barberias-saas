"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { MAX_CLIENT_NAME_LENGTH, MAX_CLIENT_NOTE_LENGTH } from "@/lib/clients";

export type ClientResult = { success?: boolean; error?: string };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SESSION_EXPIRED = "Tu sesión expiró. Vuelve a iniciar sesión.";

/** Sesión + membresía (tenant y rol desde tenant_members, nunca del cliente). */
async function getMemberContext() {
  const supabase = await getSupabaseServer();
  if (!supabase) return { error: SESSION_EXPIRED } as const;
  const authUser = await getAuthenticatedUser(supabase);
  const membership = authUser?.activeMembership;
  if (!membership) return { error: SESSION_EXPIRED } as const;
  return { supabase, role: membership.role } as const;
}

/** Notas internas: admin o barbero que lo atendió (lo exige public.set_client_note). */
export async function saveClientNoteAction(clientId: unknown, notes: unknown): Promise<ClientResult> {
  const ctx = await getMemberContext();
  if ("error" in ctx) return { error: ctx.error };

  if (typeof clientId !== "string" || !UUID_RE.test(clientId)) return { error: "Cliente no válido." };
  const clean = typeof notes === "string" ? notes.trim() : "";
  if (clean.length > MAX_CLIENT_NOTE_LENGTH) {
    return { error: `La nota no puede superar ${MAX_CLIENT_NOTE_LENGTH} caracteres.` };
  }

  const { error } = await ctx.supabase.rpc("set_client_note", { _client_id: clientId, _notes: clean });
  if (error) {
    switch (error.code) {
      case "P0002":
        return { error: "El cliente no existe o no tienes acceso a él." };
      case "23514":
        return { error: error.message };
      default:
        return { error: "No se pudo guardar la nota. Intenta de nuevo." };
    }
  }

  revalidatePath(`/dashboard/clientes/${clientId}`);
  return { success: true };
}

/** Corrige nombre y teléfono (solo admin; public.update_client normaliza el teléfono). */
export async function updateClientAction(input: unknown): Promise<ClientResult> {
  const ctx = await getMemberContext();
  if ("error" in ctx) return { error: ctx.error };
  if (ctx.role !== "admin") return { error: "Solo el administrador puede editar clientes." };

  const data = (input ?? {}) as Record<string, unknown>;
  if (typeof data.clientId !== "string" || !UUID_RE.test(data.clientId)) return { error: "Cliente no válido." };
  const name = typeof data.name === "string" ? data.name.trim() : "";
  if (!name || name.length > MAX_CLIENT_NAME_LENGTH) {
    return { error: `Escribe un nombre de 1 a ${MAX_CLIENT_NAME_LENGTH} caracteres.` };
  }
  const phone = typeof data.phone === "string" ? data.phone.trim() : "";
  if (phone.length > 30) return { error: "El teléfono no es válido." };

  const { error } = await ctx.supabase.rpc("update_client", {
    _client_id: data.clientId,
    _full_name: name,
    _phone: phone,
  });
  if (error) {
    switch (error.code) {
      case "BA012":
        return { error: "Ya hay otro cliente con ese teléfono." };
      case "P0002":
        return { error: "El cliente no existe o no tienes acceso a él." };
      case "23514":
        return { error: error.message };
      default:
        return { error: "No se pudo guardar el cliente. Intenta de nuevo." };
    }
  }

  revalidatePath("/dashboard/clientes");
  revalidatePath(`/dashboard/clientes/${data.clientId}`);
  revalidatePath("/dashboard/citas");
  return { success: true };
}
