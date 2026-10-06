import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { ServiceManager } from "@/components/dashboard/services/ServiceManager";

export const metadata: Metadata = {
  title: "Servicios — Dashboard",
  description: "Gestiona los servicios de tu barbería.",
};

/**
 * Página de administración de servicios.
 *
 * Seguridad server-side:
 *  1. Verifica sesión (redirect a /login si no existe)
 *  2. Verifica membresía activa
 *  3. Verifica rol admin (muestra acceso denegado si no)
 *  4. Obtiene servicios filtrados por tenant (RLS + query explícita)
 *
 * El tenant_id proviene de la membresía server-side, NUNCA del cliente.
 */
export default async function ServicesPage() {
  // 1. Auth guard
  const supabase = await getSupabaseServer();
  if (!supabase) redirect("/login");

  const authUser = await getAuthenticatedUser(supabase);
  if (!authUser?.activeMembership) redirect("/login");

  // 2. Role guard — solo admin
  if (authUser.activeMembership.role !== "admin") {
    return <AccessDeniedPage />;
  }

  const tenantId = authUser.activeMembership.tenantId;

  // 3. Moneda del tenant, para mostrar el precio correctamente
  const { data: tenantRow } = await supabase
    .from("tenants")
    .select("currency")
    .eq("id", tenantId)
    .single();

  const currency = tenantRow?.currency ?? "MXN";

  // 4. Obtener servicios del tenant (RLS filtra automáticamente,
  //    pero agregamos .eq explícito por claridad)
  const { data: services, error } = await supabase
    .from("services")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-section font-display text-foreground">
          Servicios
        </h1>
        <div className="rounded-card border border-red-500/30 bg-red-500/10 p-6 text-center">
          <p className="text-body font-sans text-red-400">
            No se pudieron cargar los servicios. Intenta recargar la página.
          </p>
        </div>
      </div>
    );
  }

  return <ServiceManager services={services ?? []} currency={currency} />;
}

// ─── Acceso denegado ─────────────────────────────────────────────────────────

function AccessDeniedPage() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="max-w-md space-y-6 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-border bg-background">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="h-8 w-8 text-muted"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636"
            />
          </svg>
        </div>
        <h1 className="text-section font-display text-foreground">
          Acceso restringido
        </h1>
        <p className="text-body font-sans text-muted">
          Solo los administradores pueden gestionar los servicios.
        </p>
        <Link
          href="/dashboard"
          className="inline-flex items-center justify-center rounded-button bg-accent px-6 py-3 text-body font-sans font-semibold text-background transition-all hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Volver al dashboard
        </Link>
      </div>
    </div>
  );
}
