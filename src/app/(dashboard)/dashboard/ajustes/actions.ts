"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { DEFAULT_TEMPLATES, MAX_TEMPLATE_LENGTH, isMessageKey, type MessageTemplates } from "@/lib/whatsapp";

export type SettingsResult = { success?: boolean; error?: string; phone?: string | null };

/**
 * Guarda el número de WhatsApp y las plantillas de la barbería.
 * Tenant y rol desde la membresía; la función SQL vuelve a exigir admin y
 * normaliza el teléfono (private.normalize_phone_mx).
 */
export async function updateMessagingAction(input: unknown): Promise<SettingsResult> {
  const supabase = await getSupabaseServer();
  if (!supabase) return { error: "Tu sesión expiró. Vuelve a iniciar sesión." };
  const authUser = await getAuthenticatedUser(supabase);
  const membership = authUser?.activeMembership;
  if (!membership) return { error: "Tu sesión expiró. Vuelve a iniciar sesión." };
  if (membership.role !== "admin") return { error: "Solo el administrador puede cambiar los ajustes." };

  const data = (input ?? {}) as Record<string, unknown>;
  const phone = typeof data.phone === "string" ? data.phone.trim() : "";
  if (phone.length > 30) return { error: "El número de WhatsApp no es válido." };

  const raw = data.templates;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "Los mensajes no son válidos." };

  // Solo se guardan los textos que difieren del predeterminado.
  const templates: MessageTemplates = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!isMessageKey(key)) return { error: "Los mensajes no son válidos." };
    if (typeof value !== "string") return { error: "Los mensajes no son válidos." };
    const text = value.trim();
    if (text.length > MAX_TEMPLATE_LENGTH) {
      return { error: `Cada mensaje puede tener hasta ${MAX_TEMPLATE_LENGTH} caracteres.` };
    }
    if (text && text !== DEFAULT_TEMPLATES[key]) templates[key] = text;
  }

  const { data: saved, error } = await supabase.rpc("update_tenant_messaging", {
    _tenant_id: membership.tenantId,
    _whatsapp_phone: phone,
    _templates: templates,
  });

  if (error) {
    switch (error.code) {
      case "23514":
        return { error: error.message };
      case "42501":
        return { error: "Solo el administrador puede cambiar los ajustes." };
      default:
        return { error: "No se pudieron guardar los ajustes. Intenta de nuevo." };
    }
  }

  revalidatePath("/dashboard/ajustes");
  revalidatePath("/dashboard/citas");
  const result = (saved ?? {}) as { public_phone?: string | null };
  return { success: true, phone: result.public_phone ?? null };
}
