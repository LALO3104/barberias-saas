import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { formatPrice, getTodayInTimezone } from "@/lib/format";
import { PAYMENT_METHOD_LABELS, formatShortDay, isDateKey, type PaymentMethod } from "@/lib/appointments";
import { isPeriodView, periodRange, type PeriodView } from "@/lib/periods";
import type { BusinessStats } from "@/lib/clients";
import { cn } from "@/lib/utils";
import { PeriodNav } from "@/components/dashboard/PeriodNav";
import { BarChart, type BarDatum } from "@/components/dashboard/stats/BarChart";

export const metadata: Metadata = {
  title: "Estadísticas — Dashboard",
  description: "Cómo va la barbería: citas, cobros, clientes y ganancia.",
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const WEEKDAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

/**
 * Estadísticas de un periodo (public.get_business_stats).
 *   admin  → toda la barbería, ganancia y desglose por barbero.
 *   barber → solo lo suyo (la función es INVOKER: RLS lo garantiza).
 */
export default async function EstadisticasPage(props: PageProps) {
  const supabase = await getSupabaseServer();
  if (!supabase) redirect("/login");
  const authUser = await getAuthenticatedUser(supabase);
  if (!authUser?.activeMembership) redirect("/login");

  const { tenantId, role } = authUser.activeMembership;
  const isAdmin = role === "admin";
  const title = isAdmin ? "Estadísticas" : "Mis estadísticas";
  const sp = await props.searchParams;

  const { data: tenant } = await supabase.from("tenants").select("timezone, currency").eq("id", tenantId).single();
  if (!tenant) return <LoadError title={title} />;
  const currency = tenant.currency;
  const money = (cents: number) => formatPrice(cents, currency);

  const todayKey = getTodayInTimezone(tenant.timezone);
  const vistaParam = first(sp.vista);
  const vista: PeriodView = isPeriodView(vistaParam) ? vistaParam : "mes";
  const fechaParam = first(sp.fecha);
  const anchor = isDateKey(fechaParam) ? fechaParam : todayKey;
  const { from, to } = periodRange(vista, anchor);

  const { data, error } = await supabase.rpc("get_business_stats", { _tenant_id: tenantId, _from: from, _to: to });
  if (error || !data) return <LoadError title={title} />;
  const stats = data as unknown as BusinessStats;

  const { appointments: appts, revenue, clients } = stats;
  const closed = appts.completed + appts.no_show;
  const noShowRate = closed > 0 ? Math.round((appts.no_show / closed) * 100) : 0;
  const ticket = revenue.charges > 0 ? Math.round(revenue.services_cents / revenue.charges) : 0;
  const empty = appts.total === 0 && revenue.charges === 0 && stats.salaries_cents === 0;

  const dailyData: BarDatum[] = stats.daily.map((d, i) => {
    const dayNumber = Number(d.date.slice(8));
    const tick = vista === "semana" ? WEEKDAYS[i]?.charAt(0) ?? "" : dayNumber === 1 || dayNumber % 5 === 0 ? String(dayNumber) : "";
    return { key: d.date, label: formatShortDay(d.date), tick, value: d.cents, valueLabel: money(d.cents) };
  });
  const weekdayData: BarDatum[] = stats.weekdays.map((d) => ({
    key: String(d.day),
    label: WEEKDAYS[d.day - 1],
    tick: WEEKDAYS[d.day - 1].charAt(0),
    value: d.count,
    valueLabel: d.count === 1 ? "1 cita" : `${d.count} citas`,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-section font-display text-foreground">{title}</h1>
        <p className="mt-1 text-body font-sans text-muted">
          {isAdmin ? "Cómo va tu barbería" : "Cómo vas tú"}
        </p>
      </div>

      <PeriodNav basePath="/dashboard/estadisticas" vista={vista} anchor={anchor} from={from} to={to} />

      {empty ? (
        <p className="rounded-card border border-border bg-background-secondary p-[var(--spacing-card)] text-center text-body font-sans text-muted">
          Sin movimiento en este periodo.
        </p>
      ) : (
        <>
          {/* Dinero */}
          {isAdmin && stats.profit_cents !== null ? (
            <section className="rounded-card border border-border bg-background-secondary p-[var(--spacing-card)]">
              <p className="text-label font-sans uppercase tracking-label text-muted">Ganancia de la barbería</p>
              <p className={cn("mt-1 font-display text-4xl tabular-nums", stats.profit_cents < 0 ? "text-red-400" : "text-accent")}>
                {money(stats.profit_cents)}
              </p>
              <dl className="mt-4 space-y-1.5 border-t border-border pt-3 text-sm font-sans">
                <Line label="Cobrado" value={money(revenue.total_cents)} />
                <Line label="− Comisiones" value={money(revenue.commission_cents)} />
                <Line label="− Propinas (de los barberos)" value={money(revenue.tips_cents)} />
                <Line label="− Salarios pagados" value={money(stats.salaries_cents)} />
              </dl>
              <p className="mt-3 text-xs font-sans text-muted">No incluye gastos como renta, luz o productos.</p>
              {revenue.without_commission > 0 && (
                <p className="mt-2 text-sm font-sans text-amber-300">
                  {revenue.without_commission === 1 ? "1 cobro" : `${revenue.without_commission} cobros`} sin pago configurado:
                  no se les restó comisión.
                </p>
              )}
            </section>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Servicios cobrados" value={money(revenue.services_cents)} />
              <Stat label="Comisión" value={money(revenue.commission_cents)} />
              <Stat label="Propinas" value={money(revenue.tips_cents)} />
              <Stat label="Ticket promedio" value={money(ticket)} />
            </div>
          )}

          {isAdmin && (
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Ticket promedio" value={money(ticket)} />
              <Stat label="Descuentos" value={money(revenue.discount_cents)} />
            </div>
          )}

          {/* Evolución */}
          {vista !== "dia" && revenue.charges > 0 && (
            <section className="rounded-card border border-border bg-background-secondary p-[var(--spacing-card)]">
              <BarChart title="Servicios cobrados por día" data={dailyData} />
            </section>
          )}

          {/* Citas y clientes */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Citas atendidas" value={String(appts.completed)} />
            <Stat label="Canceladas" value={String(appts.cancelled)} />
            <Stat label="No llegaron" value={closed > 0 ? `${appts.no_show} · ${noShowRate} %` : String(appts.no_show)} />
            <Stat label="Sin cita (walk-in)" value={String(appts.walk_in)} />
            <Stat label="Clientes atendidos" value={String(clients.served)} />
            <Stat label="Clientes nuevos" value={String(clients.new)} />
          </div>

          {vista !== "dia" && appts.completed > 0 && (
            <section className="rounded-card border border-border bg-background-secondary p-[var(--spacing-card)]">
              <BarChart title="Citas atendidas por día de la semana" data={weekdayData} />
            </section>
          )}

          {/* Servicios */}
          {stats.services.length > 0 && (
            <section className="rounded-card border border-border bg-background-secondary p-[var(--spacing-card)]">
              <h2 className="text-sm font-sans font-medium text-foreground">Servicios más pedidos</h2>
              <ol className="mt-3 space-y-2.5">
                {stats.services.map((s) => (
                  <li key={s.name} className="flex items-baseline justify-between gap-4 text-sm font-sans">
                    <span className="min-w-0 truncate text-foreground">{s.name}</span>
                    <span className="shrink-0 tabular-nums text-muted">
                      {s.count} · {money(s.cents)}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {/* Por barbero */}
          {isAdmin && stats.barbers.length > 0 && (
            <section className="rounded-card border border-border bg-background-secondary p-[var(--spacing-card)]">
              <h2 className="text-sm font-sans font-medium text-foreground">Por barbero</h2>
              <ul className="mt-3 divide-y divide-border">
                {stats.barbers.map((b) => (
                  <li key={b.id} className="py-2.5 first:pt-0 last:pb-0">
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="min-w-0 truncate font-display text-foreground">{b.name}</span>
                      <span className="shrink-0 tabular-nums text-foreground">{money(b.services_cents)}</span>
                    </div>
                    <p className="mt-0.5 text-xs font-sans tabular-nums text-muted">
                      {b.charges === 1 ? "1 cobro" : `${b.charges} cobros`} · comisión {money(b.commission_cents)} · propinas{" "}
                      {money(b.tips_cents)}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Métodos de pago */}
          {isAdmin && Object.keys(stats.methods).length > 0 && (
            <section className="rounded-card border border-border bg-background-secondary p-[var(--spacing-card)]">
              <h2 className="text-sm font-sans font-medium text-foreground">Cómo te pagaron</h2>
              <dl className="mt-3 space-y-1.5 text-sm font-sans">
                {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[])
                  .filter((m) => stats.methods[m])
                  .map((m) => (
                    <Line key={m} label={PAYMENT_METHOD_LABELS[m]} value={money(stats.methods[m])} />
                  ))}
              </dl>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="min-w-0 text-muted">{label}</dt>
      <dd className="shrink-0 tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-border bg-background-secondary p-4">
      <p className="text-xs font-sans text-muted">{label}</p>
      <p className="mt-1 font-display text-xl tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function LoadError({ title }: { title: string }) {
  return (
    <div className="space-y-4">
      <h1 className="text-section font-display text-foreground">{title}</h1>
      <div className="rounded-card border border-red-500/30 bg-red-500/10 p-6 text-center">
        <p className="text-body font-sans text-red-400">No se pudieron cargar las estadísticas. Intenta recargar la página.</p>
      </div>
    </div>
  );
}
