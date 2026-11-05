import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { MESSAGE_KEYS, parseTemplates, templateFor, type MessageKey } from "@/lib/whatsapp";
import { MessagingSettings } from "@/components/dashboard/settings/MessagingSettings";
import { MyWhatsAppForm } from "@/components/dashboard/settings/MyWhatsAppForm";
import { MyProfileForm } from "@/components/dashboard/settings/MyProfileForm";
import { NotificationsToggle } from "@/components/dashboard/settings/NotificationsToggle";
import { LocationForm } from "@/components/dashboard/settings/LocationForm";

export const metadata: Metadata = {
  title: "Mi barbería — Dashboard",
  description: "WhatsApp y mensajes de la barbería.",
};

/**
 * Admin: ubicación, número de WhatsApp de la barbería y mensajes
 * predeterminados. Barbero: "Mi perfil", su tarjeta pública y su WhatsApp.
 */
export default async function AjustesPage() {
  const supabase = await getSupabaseServer();
  if (!supabase) redirect("/login");
  const authUser = await getAuthenticatedUser(supabase);
  if (!authUser?.activeMembership) redirect("/login");

  if (authUser.activeMembership.role !== "admin") {
    const { data: me } = await supabase
      .from("barbers")
      .select("id, display_name, role_title, bio, whatsapp_phone, photo_url")
      .eq("tenant_id", authUser.activeMembership.tenantId)
      .eq("user_id", authUser.id)
      .maybeSingle();
    if (!me) redirect("/dashboard");
    return (
      <div className="space-y-6">
        <h1 className="text-section font-display text-foreground">Mi perfil</h1>
        <NotificationsToggle />
        <MyProfileForm name={me.display_name} role={me.role_title} bio={me.bio} photoUrl={me.photo_url} />
        <MyWhatsAppForm barberId={me.id} phone={me.whatsapp_phone} />
      </div>
    );
  }

  const { data: tenant, error } = await supabase
    .from("tenants")
    .select("name, public_phone, message_templates, address_line, city, state, postal_code, map_query")
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
        <p className="mt-1 text-body font-sans text-muted">Ubicación, WhatsApp y mensajes para tus clientes</p>
      </div>
      <LocationForm
        tenantName={tenant.name}
        mapQuery={tenant.map_query}
        initial={{
          address: tenant.address_line ?? "",
          city: tenant.city ?? "",
          state: tenant.state ?? "",
          postalCode: tenant.postal_code ?? "",
        }}
      />
      <MessagingSettings tenantName={tenant.name} phone={tenant.public_phone} templates={templates} />
    </div>
  );
}
