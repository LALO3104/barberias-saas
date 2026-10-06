import type { Metadata } from "next";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Dashboard — Barberías",
  description: "Panel de administración de tu barbería.",
};

export default async function DashboardPage() {
  const supabase = await getSupabaseServer();
  // El layout ya validó la sesión; si llegamos aquí, hay usuario
  const authUser = supabase ? await getAuthenticatedUser(supabase) : null;
  const membership = authUser?.activeMembership;

  const greeting = authUser?.fullName
    ? `Bienvenido, ${authUser.fullName}`
    : "Bienvenido";

  const roleLabel =
    membership?.role === "admin" ? "Administrador" : "Barbero";

  return (
    <div className="space-y-8">
      {/* Header de bienvenida */}
      <div>
        <h1 className="text-section font-display text-foreground">
          {greeting}
        </h1>
        <p className="mt-1 text-body font-sans text-muted">
          {membership?.tenantName} — {roleLabel}
        </p>
      </div>

      {/* Placeholder cards */}
      <div className="grid gap-[var(--spacing-gutter)] sm:grid-cols-2 lg:grid-cols-3">
        <PlaceholderCard
          title="Citas de hoy"
          value="—"
          description="Próximamente"
        />
        <PlaceholderCard
          title="Clientes registrados"
          value="—"
          description="Próximamente"
        />
        <PlaceholderCard
          title="Ingresos del mes"
          value="—"
          description="Próximamente"
        />
      </div>

      {/* Area principal placeholder */}
      <div className="rounded-card border border-border bg-background-secondary p-[var(--spacing-card)]">
        <div className="flex min-h-[300px] flex-col items-center justify-center text-center">
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
                d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25a2.25 2.25 0 0 1-2.25-2.25v-2.25Z"
              />
            </svg>
          </div>
          <h2 className="mt-4 text-lg font-display text-foreground">
            Panel en construcción
          </h2>
          <p className="mt-2 max-w-sm text-body font-sans text-muted">
            Las funcionalidades del dashboard estarán disponibles próximamente.
            La gestión de citas, clientes, barberos y más se implementará en
            los siguientes pasos.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Placeholder Card ────────────────────────────────────────────────────────

function PlaceholderCard({
  title,
  value,
  description,
}: {
  title: string;
  value: string;
  description: string;
}) {
  return (
    <div className="rounded-card border border-border bg-background-secondary p-[var(--spacing-card)]">
      <p className="text-label font-sans uppercase tracking-label text-muted">
        {title}
      </p>
      <p className="mt-2 text-section font-display text-foreground">{value}</p>
      <p className="mt-1 text-sm font-sans text-muted">{description}</p>
    </div>
  );
}
