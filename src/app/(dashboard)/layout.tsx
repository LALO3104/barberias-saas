import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { getNavForRole } from "@/lib/dashboard-nav";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { MobileNav } from "@/components/dashboard/MobileNav";
import { PwaRegistrar } from "@/components/dashboard/pwa";

/**
 * App instalable "Mi barbería" (solo personal): el manifest se vincula aquí y
 * en el login, no en las páginas públicas de reserva.
 */
export const metadata: Metadata = {
  manifest: "/manifest.webmanifest",
  applicationName: "Mi barbería",
  appleWebApp: {
    capable: true,
    title: "Mi barbería",
    statusBarStyle: "black",
  },
  icons: { apple: "/pwa/icon/apple" },
};

/** Pantalla completa en el teléfono: el contenido respeta notch y barra de inicio. */
export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: "#0b0b0b",
};

/**
 * Layout protegido del dashboard.
 *
 * Seguridad server-side:
 *   1. Verifica sesión → redirect a /login si no existe
 *   2. Resuelve membresías desde tenant_members (fuente de verdad)
 *   3. Si no tiene membresía válida → página de acceso denegado
 *   4. El rol se obtiene SOLO de tenant_members.role, nunca de JWT/metadata
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // 1. Obtener cliente server
  const supabase = await getSupabaseServer();
  if (!supabase) {
    redirect("/login");
  }

  // 2. Obtener usuario autenticado con membresías
  const authUser = await getAuthenticatedUser(supabase);
  if (!authUser) {
    redirect("/login");
  }

  // 3. Verificar que tiene al menos una membresía
  if (!authUser.activeMembership) {
    return <NoAccessPage />;
  }

  const { activeMembership } = authUser;
  const navItems = getNavForRole(activeMembership.role);

  return (
    <div className="min-h-dvh bg-background">
      <PwaRegistrar />
      <MobileNav
        tenantName={activeMembership.tenantName}
        userName={authUser.fullName}
        role={activeMembership.role}
        navItems={navItems}
      />
      <Sidebar
        tenantName={activeMembership.tenantName}
        userName={authUser.fullName}
        role={activeMembership.role}
        navItems={navItems}
      />

      {/* Main content — offset by sidebar on desktop; espacio para la barra
          inferior en el teléfono */}
      <main className="pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-0 lg:pl-64">
        {/* Desktop header */}
        <header className="hidden lg:flex h-16 items-center justify-between border-b border-border bg-background px-8">
          <div />
          <div className="flex items-center gap-4">
            <span className="text-sm font-sans text-muted">
              {authUser.fullName ?? authUser.email}
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/20 text-accent">
              <span className="text-xs font-display font-bold">
                {(authUser.fullName ?? authUser.email).charAt(0).toUpperCase()}
              </span>
            </div>
          </div>
        </header>

        <div className="px-4 py-5 lg:p-8">{children}</div>
      </main>
    </div>
  );
}

// ─── Página de acceso no autorizado ─────────────────────────────────────────

function NoAccessPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="max-w-md text-center space-y-6">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-border bg-background-secondary">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="h-10 w-10 text-muted"
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
          Acceso no autorizado
        </h1>
        <p className="text-body font-sans text-muted">
          Tu cuenta no tiene una membresía activa en ninguna barbería. Contacta
          al administrador de tu barbería para obtener acceso.
        </p>
        <Link
          href="/login"
          className="inline-flex items-center justify-center rounded-button bg-accent px-6 py-3 text-body font-sans font-semibold text-background transition-all hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Volver al inicio de sesión
        </Link>
      </div>
    </div>
  );
}
