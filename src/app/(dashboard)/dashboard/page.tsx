import type { Metadata } from "next";
import Link from "next/link";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { formatPrice, getTodayInTimezone } from "@/lib/format";
import {
  addDaysToKey,
  formatStatusCount,
  zonedDayStartUtc,
  type AppointmentStatus,
} from "@/lib/appointments";
import { periodRange } from "@/lib/periods";
import type { BusinessStats } from "@/lib/clients";
import { StatusIcon } from "@/components/dashboard/appointments/AppointmentStatusBadge";
import { InstallAppPrompt } from "@/components/dashboard/pwa";

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

  const isAdmin = membership?.role === "admin";
  const [today, month] =
    supabase && membership
      ? await Promise.all([getTodayCounts(supabase, membership.tenantId), getMonthSummary(supabase, membership.tenantId)])
      : [null, null];

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

      {/* Instalar la app (solo teléfono, si aún no está instalada) */}
      <InstallAppPrompt variant="banner" />

      <div className="grid gap-[var(--spacing-gutter)] sm:grid-cols-2 lg:grid-cols-3">
        <TodayAppointmentsCard
          counts={today}
          agendaLabel={isAdmin ? "Ver citas" : "Ver mi agenda"}
        />
        <SummaryCard
          href="/dashboard/clientes"
          title={isAdmin ? "Clientes registrados" : "Mis clientes"}
          value={month ? String(month.clients) : "—"}
          action={isAdmin ? "Ver clientes" : "Ver mis clientes"}
        />
        <SummaryCard
          href="/dashboard/estadisticas"
          title={isAdmin ? "Cobrado este mes" : "Mis cobros del mes"}
          value={month ? month.collected : "—"}
          action={isAdmin ? "Ver estadísticas" : "Ver mis estadísticas"}
        />
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

// ─── Resumen del mes ─────────────────────────────────────────────────────────

/** Clientes y cobrado del mes en curso. RLS: el barbero solo cuenta lo suyo. */
async function getMonthSummary(supabase: ServerClient, tenantId: string) {
  const { data: tenant } = await supabase
    .from("tenants")
    .select("timezone, currency")
    .eq("id", tenantId)
    .single();
  if (!tenant) return null;

  const { from, to } = periodRange("mes", getTodayInTimezone(tenant.timezone));
  const { data, error } = await supabase.rpc("get_business_stats", { _tenant_id: tenantId, _from: from, _to: to });
  if (error || !data) return null;

  const stats = data as unknown as BusinessStats;
  return {
    clients: stats.clients.total,
    collected: formatPrice(stats.revenue.total_cents, tenant.currency),
  };
}

function SummaryCard({
  href,
  title,
  value,
  action,
}: {
  href: string;
  title: string;
  value: string;
  action: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-card border border-border bg-background-secondary p-[var(--spacing-card)] transition-colors hover:border-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <p className="text-label font-sans uppercase tracking-label text-muted">{title}</p>
      <p className="mt-2 text-section font-display tabular-nums text-foreground">{value}</p>
      <p className="mt-3 text-sm font-sans text-accent group-hover:underline">{action} →</p>
    </Link>
  );
}
