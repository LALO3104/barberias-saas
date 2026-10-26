import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { MESSAGE_KEYS, parseTemplates, templateFor, type MessageKey } from "@/lib/whatsapp";
import { MessagingSettings } from "@/components/dashboard/settings/MessagingSettings";

export const metadata: Metadata = {
  title: "Mi barbería — Dashboard",
  description: "WhatsApp y mensajes de la barbería.",
};

/**
 * Ajustes de la barbería (solo admin): número de WhatsApp y mensajes
 * predeterminados. Se guardan con public.update_tenant_messaging.
 */
export default async function AjustesPage() {
  const supabase = await getSupabaseServer();
  if (!supabase) redirect("/login");
  const authUser = await getAuthenticatedUser(supabase);
  if (!authUser?.activeMembership) redirect("/login");
  if (authUser.activeMembership.role !== "admin") redirect("/dashboard");

  const { data: tenant, error } = await supabase
    .from("tenants")
    .select("name, public_phone, message_templates")
    .eq("id", authUser.activeMembership.tenantId)
    .single();

  if (error || !tenant) {
    return (
      <div className="space-y-4">
        <h1 className="text-section font-display text-foreground">Mi barbería</h1>
        <div className="rounded-card border border-red-500/30 bg-red-500/10 p-6 text-center">
          <p className="text-body font-sans text-red-400">No se pudieron cargar los ajustes. Intenta recargar la página.</p>
        </div>
      </div>
    );
  }

  const custom = parseTemplates(tenant.message_templates);
  const templates = Object.fromEntries(MESSAGE_KEYS.map((k) => [k, templateFor(k, custom)])) as Record<MessageKey, string>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-section font-display text-foreground">Mi barbería</h1>
        <p className="mt-1 text-body font-sans text-muted">WhatsApp y mensajes para tus clientes</p>
      </div>
      <MessagingSettings tenantName={tenant.name} phone={tenant.public_phone} templates={templates} />
    </div>
  );
}
