import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { formatPrice, getTodayInTimezone } from "@/lib/format";
import { addDaysToKey, dateKeyInTimezone, formatShortDay, isDateKey, zonedDayStartUtc } from "@/lib/appointments";
import {
  PERIOD_LABELS,
  isPeriodView,
  periodLabel,
  periodRange,
  shiftPeriod,
  type PeriodView,
} from "@/lib/periods";
import { describeCompensation, isPayType, isSalaryPeriod, type Compensation } from "@/lib/compensation";
import { cn } from "@/lib/utils";
import { PayoutButton, PayoutVoidButton } from "@/components/dashboard/earnings/PayoutControls";

export const metadata: Metadata = {
  title: "Ganancias — Dashboard",
  description: "Comisiones, propinas y pagos a barberos.",
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

interface Payout {
  id: string;
  from: string;
  to: string;
  commission: number;
  tips: number;
  salary: number;
  total: number;
  note: string | null;
}

interface BarberSummary {
  id: string;
  name: string;
  compensation: Compensation | null;
  charges: number;
  servicesCents: number;
  commissionCents: number;
  tipsCents: number;
  /** Cobros sin compensación configurada al registrarse (comisión desconocida). */
  unconfigured: number;
  pendingCents: number;
  payouts: Payout[];
}

/**
 * Ganancias.
 *   admin  → reporte del periodo por barbero + "Marcar como pagado".
 *   barber → "Mis ganancias": solo lo suyo (RLS lo garantiza igual).
 * Fechas: días locales de la barbería (tenants.timezone); un cobro cuenta en
 * el día local en que se registró.
 */
export default async function GananciasPage(props: PageProps) {
  const supabase = await getSupabaseServer();
  if (!supabase) redirect("/login");
  const authUser = await getAuthenticatedUser(supabase);
  if (!authUser?.activeMembership) redirect("/login");

  const { tenantId, role } = authUser.activeMembership;
  const isAdmin = role === "admin";
  const title = isAdmin ? "Ganancias" : "Mis ganancias";
  const sp = await props.searchParams;

  const { data: tenant } = await supabase.from("tenants").select("timezone, currency").eq("id", tenantId).single();
  if (!tenant) return <LoadError title={title} />;
  const tz = tenant.timezone;
  const currency = tenant.currency;
  const todayKey = getTodayInTimezone(tz);

  const vista: PeriodView = isPeriodView(first(sp.vista)) ? (first(sp.vista) as PeriodView) : "semana";
  const fechaParam = first(sp.fecha);
  const anchor = isDateKey(fechaParam) ? fechaParam : todayKey;
  const { from, to } = periodRange(vista, anchor);
  const fromIso = zonedDayStartUtc(from, tz).toISOString();
  const toIso = zonedDayStartUtc(addDaysToKey(to, 1), tz).toISOString();

  // Barberos visibles: admin → todos; barbero → él.
  let barbersQuery = supabase
    .from("barbers")
    .select("id, display_name, is_active")
    .eq("tenant_id", tenantId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (!isAdmin) barbersQuery = barbersQuery.eq("user_id", authUser.id);

  let chargesQuery = supabase
    .from("appointment_charges")
    .select("barber_id, subtotal_cents, discount_cents, tip_cents, commission_cents, pay_type, created_at")
    .eq("tenant_id", tenantId)
    .is("voided_at", null)
    .gte("created_at", fromIso)
    .lt("created_at", toIso);

  let payoutsQuery = supabase
    .from("barber_payouts")
    .select("id, barber_id, period_start, period_end, commission_cents, tips_cents, salary_cents, total_cents, note")
    .eq("tenant_id", tenantId)
    .is("voided_at", null)
    .lte("period_start", to)
    .gte("period_end", from)
    .order("period_start", { ascending: true });

  const [barbersRes, compRes] = await Promise.all([
    barbersQuery,
    supabase
      .from("barber_compensation")
      .select("barber_id, pay_type, commission_rate_bps, salary_cents, salary_period")
      .eq("tenant_id", tenantId),
  ]);
  if (barbersRes.error) return <LoadError title={title} />;
  const barbers = barbersRes.data ?? [];
  if (!isAdmin && barbers.length === 0) return <NotLinked />;
  if (!isAdmin) {
    chargesQuery = chargesQuery.eq("barber_id", barbers[0].id);
    payoutsQuery = payoutsQuery.eq("barber_id", barbers[0].id);
  }

  const [chargesRes, payoutsRes] = await Promise.all([chargesQuery, payoutsQuery]);
  if (chargesRes.error || payoutsRes.error) return <LoadError title={title} />;

  const compensations = new Map<string, Compensation>();
  for (const c of compRes.data ?? []) {
    if (!isPayType(c.pay_type)) continue;
    compensations.set(c.barber_id, {
      payType: c.pay_type,
      commissionRateBps: c.commission_rate_bps,
      salaryCents: c.salary_cents,
      salaryPeriod: isSalaryPeriod(c.salary_period) ? c.salary_period : null,
    });
  }

  const payoutsByBarber = new Map<string, Payout[]>();
  for (const p of payoutsRes.data ?? []) {
    payoutsByBarber.set(p.barber_id, [
      ...(payoutsByBarber.get(p.barber_id) ?? []),
      {
        id: p.id,
        from: p.period_start,
        to: p.period_end,
        commission: p.commission_cents,
        tips: p.tips_cents,
        salary: p.salary_cents,
        total: p.total_cents,
        note: p.note,
      },
    ]);
  }

  const summaries = new Map<string, BarberSummary>(
    barbers.map((b) => [
      b.id,
      {
        id: b.id,
        name: b.display_name,
        compensation: compensations.get(b.id) ?? null,
        charges: 0,
        servicesCents: 0,
        commissionCents: 0,
        tipsCents: 0,
        unconfigured: 0,
        pendingCents: 0,
        payouts: payoutsByBarber.get(b.id) ?? [],
      },
    ])
  );

  for (const c of chargesRes.data ?? []) {
    const s = summaries.get(c.barber_id);
    if (!s) continue;
    const earned = (c.commission_cents ?? 0) + c.tip_cents;
    s.charges += 1;
    s.servicesCents += c.subtotal_cents - c.discount_cents;
    s.commissionCents += c.commission_cents ?? 0;
    s.tipsCents += c.tip_cents;
    if (c.pay_type === null) s.unconfigured += 1;
    // Pendiente: lo ganado en días que ningún pago cubre.
    const day = dateKeyInTimezone(c.created_at, tz);
    if (!s.payouts.some((p) => p.from <= day && day <= p.to)) s.pendingCents += earned;
  }

  // Admin: barberos activos siempre; inactivos solo si tuvieron movimiento.
  const list = [...summaries.values()].filter(
    (s) => !isAdmin || barbers.find((b) => b.id === s.id)?.is_active || s.charges > 0 || s.payouts.length > 0
  );

  const totals = list.reduce(
    (t, s) => ({
      services: t.services + s.servicesCents,
      commission: t.commission + s.commissionCents,
      tips: t.tips + s.tipsCents,
      pending: t.pending + s.pendingCents,
    }),
    { services: 0, commission: 0, tips: 0, pending: 0 }
  );

  const payoutTo = to < todayKey ? to : todayKey;
  const link = (v: PeriodView, f: string) => `/dashboard/ganancias?vista=${v}&fecha=${f}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-section font-display text-foreground">{title}</h1>
        <p className="mt-1 text-body font-sans text-muted">
          {isAdmin ? "Comisiones, propinas y pagos a tus barberos" : "Tu comisión y tus propinas"}
        </p>
      </div>

      {/* Periodo */}
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-1 rounded-button border border-border p-1" role="tablist" aria-label="Periodo">
          {(Object.keys(PERIOD_LABELS) as PeriodView[]).map((v) => (
            <Link
              key={v}
              href={link(v, anchor)}
              role="tab"
              aria-selected={vista === v}
              className={cn(
                "rounded-button py-2 text-center text-sm font-sans transition-[background-color,color] duration-150 ease-out",
                vista === v ? "bg-accent/15 text-accent" : "text-muted hover:text-foreground"
              )}
            >
              {PERIOD_LABELS[v]}
            </Link>
          ))}
        </div>
        <div className="flex items-center justify-between gap-3">
          <Link href={link(vista, shiftPeriod(vista, anchor, -1))} aria-label="Periodo anterior" className={NAV_BUTTON}>
            ←
          </Link>
          <p className="text-center font-display text-lg capitalize text-foreground">{periodLabel(vista, from, to)}</p>
          <Link href={link(vista, shiftPeriod(vista, anchor, 1))} aria-label="Periodo siguiente" className={NAV_BUTTON}>
            →
          </Link>
        </div>
      </div>

      {/* Totales (admin) */}
      {isAdmin && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Cobrado por servicios" value={formatPrice(totals.services, currency)} />
          <Stat label="Comisiones" value={formatPrice(totals.commission, currency)} />
          <Stat label="Propinas" value={formatPrice(totals.tips, currency)} />
          <Stat label="Pendiente de pagar" value={formatPrice(totals.pending, currency)} highlight={totals.pending > 0} />
        </div>
      )}

      {/* Por barbero */}
      {list.length === 0 ? (
        <p className="rounded-card border border-border bg-background-secondary p-[var(--spacing-card)] text-center text-body font-sans text-muted">
          No hay barberos para mostrar.
        </p>
      ) : (
        <div className="space-y-4">
          {list.map((s) => (
            <article key={s.id} className="space-y-4 rounded-card border border-border bg-background-secondary p-[var(--spacing-card)]">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="truncate font-display text-lg text-foreground">{s.name}</h2>
                  <p className={cn("text-sm font-sans", s.compensation ? "text-muted" : "text-amber-300")}>
                    {describeCompensation(s.compensation, currency)}
                  </p>
                </div>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-xs font-sans font-medium",
                    s.pendingCents > 0 ? "bg-amber-500/10 text-amber-300" : "bg-accent/10 text-accent"
                  )}
                >
                  {s.pendingCents > 0
                    ? `Pendiente ${formatPrice(s.pendingCents, currency)}`
                    : s.payouts.length > 0
                      ? "Pagado"
                      : s.charges > 0
                        ? "Nada pendiente"
                        : "Sin cobros"}
                </span>
              </div>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm font-sans sm:grid-cols-4">
                <Item label="Servicios cobrados" value={`${formatPrice(s.servicesCents, currency)} · ${s.charges}`} />
                <Item label="Comisión" value={formatPrice(s.commissionCents, currency)} />
                <Item label="Propinas" value={formatPrice(s.tipsCents, currency)} />
                <Item label="Ganado" value={formatPrice(s.commissionCents + s.tipsCents, currency)} strong />
              </dl>

              {s.unconfigured > 0 && (
                <p className="text-sm font-sans text-amber-300">
                  {s.unconfigured === 1 ? "1 cobro" : `${s.unconfigured} cobros`} sin comisión: se registraron cuando{" "}
                  {isAdmin ? "el barbero" : "tu pago"} aún no estaba configurado.
                </p>
              )}

              {s.payouts.length > 0 && (
                <ul className="space-y-2 border-t border-border pt-3">
                  {s.payouts.map((p) => {
                    const label = `Pagado ${formatPrice(p.total, currency)} · ${formatShortDay(p.from)}${p.to !== p.from ? ` – ${formatShortDay(p.to)}` : ""}`;
                    return (
                      <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-sm font-sans">
                        <span className="text-foreground">
                          {label}
                          <span className="text-muted">
                            {[
                              p.commission > 0 ? `comisión ${formatPrice(p.commission, currency)}` : null,
                              p.tips > 0 ? `propinas ${formatPrice(p.tips, currency)}` : null,
                              p.salary > 0 ? `salario ${formatPrice(p.salary, currency)}` : null,
                            ]
                              .filter(Boolean)
                              .map((x) => ` · ${x}`)
                              .join("")}
                            {p.note ? ` · ${p.note}` : ""}
                          </span>
                        </span>
                        {isAdmin && <PayoutVoidButton payoutId={p.id} label={`${s.name} · ${label}`} />}
                      </li>
                    );
                  })}
                </ul>
              )}

              {isAdmin && from <= todayKey && (s.pendingCents > 0 || s.compensation?.payType === "salary") && (
                <PayoutButton
                  barberId={s.id}
                  barberName={s.name}
                  from={from}
                  to={payoutTo}
                  todayKey={todayKey}
                  pendingCents={s.pendingCents}
                  suggestedSalaryCents={s.compensation?.payType === "salary" ? s.compensation.salaryCents : null}
                  currency={currency}
                />
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

const NAV_BUTTON =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-button border border-border text-lg text-foreground transition-[background-color,transform] duration-150 ease-out hover:bg-border/50 active:scale-[0.94]";

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-card border border-border bg-background-secondary p-4">
      <p className="text-label font-sans uppercase tracking-label text-muted">{label}</p>
      <p className={cn("mt-1 font-display text-xl tabular-nums", highlight ? "text-amber-300" : "text-foreground")}>{value}</p>
    </div>
  );
}

function Item({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={cn("tabular-nums", strong ? "font-semibold text-accent" : "text-foreground")}>{value}</dd>
    </div>
  );
}

function LoadError({ title }: { title: string }) {
  return (
    <div className="space-y-4">
      <h1 className="text-section font-display text-foreground">{title}</h1>
      <div className="rounded-card border border-red-500/30 bg-red-500/10 p-6 text-center">
        <p className="text-body font-sans text-red-400">No se pudieron cargar las ganancias. Intenta recargar la página.</p>
      </div>
    </div>
  );
}

function NotLinked() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="max-w-md space-y-4 text-center">
        <h1 className="text-section font-display text-foreground">Perfil de barbero no vinculado</h1>
        <p className="text-body font-sans text-muted">
          Pide al administrador que vincule tu cuenta a un perfil de barbero para ver tus ganancias.
        </p>
      </div>
    </div>
  );
}
