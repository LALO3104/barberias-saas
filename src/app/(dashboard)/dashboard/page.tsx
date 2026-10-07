import type { Metadata } from "next";
import Link from "next/link";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { getTodayInTimezone } from "@/lib/format";
import {
  addDaysToKey,
  formatStatusCount,
  zonedDayStartUtc,
  type AppointmentStatus,
} from "@/lib/appointments";
import { StatusIcon } from "@/components/dashboard/appointments/AppointmentStatusBadge";

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

  const today = supabase && membership ? await getTodayCounts(supabase, membership.tenantId) : null;

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
        <TodayAppointmentsCard
          counts={today}
          agendaLabel={membership?.role === "admin" ? "Ver citas" : "Ver mi agenda"}
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

// ─── Citas de hoy ────────────────────────────────────────────────────────────

type ServerClient = NonNullable<Awaited<ReturnType<typeof getSupabaseServer>>>;
type TodayCounts = { total: number; byStatus: Partial<Record<AppointmentStatus, number>> };

/**
 * Cuenta las citas del día local del tenant. RLS limita el alcance: el admin
 * cuenta todas las de su barbería y el barbero solo las suyas.
 */
async function getTodayCounts(supabase: ServerClient, tenantId: string): Promise<TodayCounts | null> {
  const { data: tenant } = await supabase
    .from("tenants")
    .select("timezone")
    .eq("id", tenantId)
    .single();
  if (!tenant) return null;

  const todayKey = getTodayInTimezone(tenant.timezone);
  const { data, error } = await supabase
    .from("appointments")
    .select("status")
    .eq("tenant_id", tenantId)
    .gte("start_at", zonedDayStartUtc(todayKey, tenant.timezone).toISOString())
    .lt("start_at", zonedDayStartUtc(addDaysToKey(todayKey, 1), tenant.timezone).toISOString());
  if (error) return null;

  const byStatus: TodayCounts["byStatus"] = {};
  for (const row of data ?? []) byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
  return { total: data?.length ?? 0, byStatus };
}

function TodayAppointmentsCard({
  counts,
  agendaLabel,
}: {
  counts: TodayCounts | null;
  agendaLabel: string;
}) {
  const lines: AppointmentStatus[] = ["pending", "confirmed", "completed", "cancelled", "no_show"];

  return (
    <Link
      href="/dashboard/citas"
      className="group rounded-card border border-border bg-background-secondary p-[var(--spacing-card)] transition-colors hover:border-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <p className="text-label font-sans uppercase tracking-label text-muted">Citas de hoy</p>
      {counts === null ? (
        <>
          <p className="mt-2 text-section font-display text-foreground">—</p>
          <p className="mt-1 text-sm font-sans text-muted">No se pudo cargar</p>
        </>
      ) : (
        <>
          <p className="mt-2 text-section font-display text-foreground">
            {counts.total}{" "}
            <span className="text-body font-sans text-muted">
              {counts.total === 1 ? "cita" : "citas"}
            </span>
          </p>
          {counts.total > 0 && (
            <ul className="mt-2 space-y-1 text-sm font-sans text-muted">
              {lines
                .filter((s) => counts.byStatus[s])
                .map((s) => (
                  <li key={s} className="flex items-center gap-2">
                    <StatusIcon status={s} className="h-3.5 w-3.5" />
                    {formatStatusCount(s, counts.byStatus[s] ?? 0)}
                  </li>
                ))}
            </ul>
          )}
        </>
      )}
      <p className="mt-3 text-sm font-sans text-accent group-hover:underline">{agendaLabel} →</p>
    </Link>
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
