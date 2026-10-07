import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { getTodayInTimezone } from "@/lib/format";
import {
  VIEW_DAYS,
  addDaysToKey,
  dateKeyInTimezone,
  formatDayHeading,
  formatShortDay,
  formatStatusCount,
  isAgendaView,
  isAppointmentStatus,
  isDateKey,
  zonedDayStartUtc,
  type AppointmentStatus,
} from "@/lib/appointments";
import { TimezoneBadge } from "@/components/dashboard/schedules/ScheduleManager";
import { AgendaToolbar, type AgendaFilters } from "@/components/dashboard/appointments/AgendaToolbar";
import {
  AppointmentCard,
  type AgendaAppointment,
} from "@/components/dashboard/appointments/AppointmentCard";

export const metadata: Metadata = {
  title: "Agenda — Dashboard",
  description: "Citas de tu barbería.",
};

interface CitasPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Agenda de citas.
 *   admin  → "Citas": todas las citas del tenant, con filtro por barbero.
 *   barber → "Mi agenda": solo sus citas (barber_id resuelto desde la sesión;
 *            cualquier ?barbero= en la URL se ignora). RLS lo garantiza igual.
 *
 * Fechas: el día siempre es el día local del tenant (tenants.timezone).
 */
export default async function CitasPage(props: CitasPageProps) {
  // 1. Sesión y membresía
  const supabase = await getSupabaseServer();
  if (!supabase) redirect("/login");

  const authUser = await getAuthenticatedUser(supabase);
  if (!authUser?.activeMembership) redirect("/login");

  const { tenantId, role } = authUser.activeMembership;
  const isAdmin = role === "admin";
  const title = isAdmin ? "Citas" : "Mi agenda";
  const sp = await props.searchParams;

  // 2. Zona horaria del tenant
  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .select("timezone")
    .eq("id", tenantId)
    .single();
  if (tenantError || !tenant) return <LoadError title={title} />;

  const tz = tenant.timezone;
  const todayKey = getTodayInTimezone(tz);

  // 3. Filtros (validados; un valor inválido vuelve al predeterminado)
  const fechaParam = first(sp.fecha);
  const vistaParam = first(sp.vista);
  const estadoParam = first(sp.estado);
  const fecha = isDateKey(fechaParam) ? fechaParam : todayKey;
  const vista = isAgendaView(vistaParam) ? vistaParam : "dia";
  const estado: AppointmentStatus | "todos" = isAppointmentStatus(estadoParam)
    ? estadoParam
    : "todos";

  // 4. Alcance por rol
  let barberFilter: string | null = null;
  let barberOptions: { id: string; name: string; inactive: boolean }[] | undefined;
  const barberNames = new Map<string, string>();

  if (isAdmin) {
    const { data: barbers, error } = await supabase
      .from("barbers")
      .select("id, display_name, is_active")
      .eq("tenant_id", tenantId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) return <LoadError title={title} />;

    barberOptions = (barbers ?? []).map((b) => ({
      id: b.id,
      name: b.display_name,
      inactive: !b.is_active,
    }));
    for (const b of barberOptions) barberNames.set(b.id, b.name);

    const requested = first(sp.barbero);
    if (requested && barberNames.has(requested)) barberFilter = requested;
  } else {
    const { data: own, error } = await supabase
      .from("barbers")
      .select("id, display_name")
      .eq("tenant_id", tenantId)
      .eq("user_id", authUser.id)
      .maybeSingle();
    if (error) return <LoadError title={title} />;
    if (!own) return <NotLinkedPage />;
    barberFilter = own.id;
    barberNames.set(own.id, own.display_name);
  }

  // 5. Citas del rango (día o semana local del tenant)
  const days = VIEW_DAYS[vista];
  const fromIso = zonedDayStartUtc(fecha, tz).toISOString();
  const toIso = zonedDayStartUtc(addDaysToKey(fecha, days), tz).toISOString();

  let apptQuery = supabase
    .from("appointments")
    .select("id, barber_id, client_id, start_at, end_at, status, client_note, cancellation_reason")
    .eq("tenant_id", tenantId)
    .gte("start_at", fromIso)
    .lt("start_at", toIso)
    .order("start_at", { ascending: true });
  if (barberFilter) apptQuery = apptQuery.eq("barber_id", barberFilter);
  if (estado !== "todos") apptQuery = apptQuery.eq("status", estado);

  let pendingQuery = supabase
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("status", "pending")
    .gte("start_at", new Date().toISOString());
  if (barberFilter) pendingQuery = pendingQuery.eq("barber_id", barberFilter);

  const [apptRes, pendingRes] = await Promise.all([apptQuery, pendingQuery]);
  if (apptRes.error) return <LoadError title={title} />;
  const rows = apptRes.data ?? [];
  const pendingUpcoming = pendingRes.count ?? 0;

  // 6. Clientes y servicios de esas citas
  const clientIds = [...new Set(rows.map((r) => r.client_id))];
  const apptIds = rows.map((r) => r.id);

  const clients = new Map<string, { name: string; phone: string | null }>();
  const services = new Map<string, string[]>();

  if (clientIds.length > 0) {
    const { data, error } = await supabase
      .from("clients")
      .select("id, full_name, phone")
      .eq("tenant_id", tenantId)
      .in("id", clientIds);
    if (error) return <LoadError title={title} />;
    for (const c of data ?? []) clients.set(c.id, { name: c.full_name, phone: c.phone });
  }

  if (apptIds.length > 0) {
    const { data, error } = await supabase
      .from("appointment_services")
      .select("appointment_id, service_name, position")
      .eq("tenant_id", tenantId)
      .in("appointment_id", apptIds)
      .order("position", { ascending: true });
    if (error) return <LoadError title={title} />;
    for (const s of data ?? []) {
      services.set(s.appointment_id, [...(services.get(s.appointment_id) ?? []), s.service_name]);
    }
  }

  const appointments: AgendaAppointment[] = rows.map((r) => ({
    id: r.id,
    startIso: r.start_at,
    endIso: r.end_at,
    status: r.status,
    clientName: clients.get(r.client_id)?.name ?? "Cliente",
    clientPhone: clients.get(r.client_id)?.phone ?? null,
    services: services.get(r.id) ?? [],
    barberName: barberNames.get(r.barber_id) ?? null,
    clientNote: r.client_note,
    cancellationReason: r.cancellation_reason,
  }));

  // 7. Agrupar por día local
  const dayKeys = Array.from({ length: days }, (_, i) => addDaysToKey(fecha, i));
  const byDay = new Map<string, AgendaAppointment[]>(dayKeys.map((k) => [k, []]));
  for (const a of appointments) byDay.get(dateKeyInTimezone(a.startIso, tz))?.push(a);

  const filters: AgendaFilters = {
    fecha,
    vista,
    barbero: barberFilter && isAdmin ? barberFilter : "todos",
    estado,
  };
  const rangeLabel =
    vista === "dia"
      ? `${formatDayHeading(fecha)}${fecha === todayKey ? " · hoy" : ""}`
      : `${formatShortDay(fecha)} – ${formatShortDay(addDaysToKey(fecha, days - 1))}`;
  const showBarber = isAdmin && !barberFilter;
  const filtered = estado !== "todos" || (isAdmin && barberFilter !== null);

  return (
    <div className="space-y-6">
      {/* ── Encabezado ─────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-section font-display text-foreground">{title}</h1>
          <p className="mt-1 text-body font-sans text-muted">
            {isAdmin
              ? "Confirma, completa o cancela las citas de tu barbería"
              : "Tus citas y lo que necesitas para atenderlas"}
          </p>
        </div>
        <TimezoneBadge timezone={tz} />
      </div>

      {pendingUpcoming > 0 && estado !== "pending" && (
        <Link
          href={`/dashboard/citas?vista=semana&estado=pending${filters.barbero !== "todos" ? `&barbero=${filters.barbero}` : ""}`}
          className="flex items-center justify-between gap-3 rounded-button border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm font-sans text-amber-300 transition-colors hover:bg-amber-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <span>
            {pendingUpcoming === 1
              ? "1 cita próxima está pendiente de confirmar"
              : `${pendingUpcoming} citas próximas están pendientes de confirmar`}
          </span>
          <span aria-hidden="true">Ver →</span>
        </Link>
      )}

      <AgendaToolbar
        filters={filters}
        todayKey={todayKey}
        rangeLabel={rangeLabel}
        barberOptions={barberOptions}
      />

      {appointments.length > 0 && estado === "todos" && <Summary appointments={appointments} />}

      {/* ── Agenda ─────────────────────────────────────────────────────── */}
      {vista === "dia" ? (
        appointments.length === 0 ? (
          <EmptyState filtered={filtered} isToday={fecha === todayKey} />
        ) : (
          <div className="space-y-3">
            {appointments.map((a) => (
              <AppointmentCard key={a.id} appointment={a} timezone={tz} showBarber={showBarber} />
            ))}
          </div>
        )
      ) : (
        <div className="space-y-8">
          {dayKeys.map((key) => {
            const list = byDay.get(key) ?? [];
            return (
              <section key={key} aria-labelledby={`dia-${key}`} className="space-y-3">
                <h2
                  id={`dia-${key}`}
                  className="flex items-baseline gap-3 border-b border-border pb-2 font-display text-lg text-foreground"
                >
                  {formatDayHeading(key)}
                  {key === todayKey && (
                    <span className="text-label font-sans normal-case tracking-label text-accent">HOY</span>
                  )}
                  <span className="ml-auto text-sm font-sans normal-case text-muted">
                    {list.length === 0 ? "Sin citas" : list.length === 1 ? "1 cita" : `${list.length} citas`}
                  </span>
                </h2>
                {list.map((a) => (
                  <AppointmentCard key={a.id} appointment={a} timezone={tz} showBarber={showBarber} />
                ))}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Resumen del rango ───────────────────────────────────────────────────────

function Summary({ appointments }: { appointments: AgendaAppointment[] }) {
  const counts = new Map<AppointmentStatus, number>();
  for (const a of appointments) counts.set(a.status, (counts.get(a.status) ?? 0) + 1);
  const order: AppointmentStatus[] = ["pending", "confirmed", "completed", "cancelled", "no_show"];

  return (
    <p className="text-sm font-sans text-muted">
      <span className="text-foreground">
        {appointments.length === 1 ? "1 cita" : `${appointments.length} citas`}
      </span>
      {order
        .filter((s) => counts.get(s))
        .map((s) => (
          <span key={s}>
            <span aria-hidden="true"> · </span>
            {formatStatusCount(s, counts.get(s) ?? 0)}
          </span>
        ))}
    </p>
  );
}

// ─── Estados auxiliares ──────────────────────────────────────────────────────

function EmptyState({ filtered, isToday }: { filtered: boolean; isToday: boolean }) {
  return (
    <div className="rounded-card border border-border bg-background-secondary p-[var(--spacing-card)]">
      <div className="flex min-h-[220px] flex-col items-center justify-center text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full border border-border bg-background">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="h-7 w-7 text-muted"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5"
            />
          </svg>
        </div>
        <h2 className="mt-4 font-display text-lg text-foreground">
          {filtered ? "Sin citas con estos filtros" : isToday ? "Sin citas para hoy" : "Sin citas este día"}
        </h2>
        <p className="mt-2 max-w-sm text-sm font-sans text-muted">
          {filtered
            ? "Prueba con otro estado, otro barbero o la vista de semana."
            : "Las reservas que hagan tus clientes desde la página pública aparecerán aquí."}
        </p>
      </div>
    </div>
  );
}

function LoadError({ title }: { title: string }) {
  return (
    <div className="space-y-4">
      <h1 className="text-section font-display text-foreground">{title}</h1>
      <div className="rounded-card border border-red-500/30 bg-red-500/10 p-6 text-center">
        <p className="text-body font-sans text-red-400">
          No se pudo cargar la agenda. Intenta recargar la página.
        </p>
      </div>
    </div>
  );
}

/** Usuario con rol barber cuya cuenta aún no está vinculada a un barbero. */
function NotLinkedPage() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="max-w-md space-y-6 text-center">
        <h1 className="text-section font-display text-foreground">Perfil de barbero no vinculado</h1>
        <p className="text-body font-sans text-muted">
          Tu cuenta aún no está vinculada a un perfil de barbero. Pide al administrador de tu
          barbería que la vincule para ver tu agenda.
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
