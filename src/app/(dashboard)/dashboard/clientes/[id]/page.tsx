import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { formatPrice } from "@/lib/format";
import {
  dateKeyInTimezone,
  formatClock,
  formatPhoneDisplay,
  formatShortDay,
} from "@/lib/appointments";
import { waLink } from "@/lib/whatsapp";
import type { ClientDirectory } from "@/lib/clients";
import { AppointmentStatusBadge } from "@/components/dashboard/appointments/AppointmentStatusBadge";
import { ClientNoteEditor, EditClientButton } from "@/components/dashboard/clients/ClientControls";

export const metadata: Metadata = {
  title: "Cliente — Dashboard",
  description: "Historial y notas de un cliente.",
};

interface PageProps {
  params: Promise<{ id: string }>;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const HISTORY_LIMIT = 30;

/**
 * Ficha del cliente: contacto, notas e historial. Un barbero sin citas con
 * este cliente recibe 404, igual que si no existiera (RLS: get_clients no lo
 * devuelve). Sus números e historial son solo los de sus citas.
 */
export default async function ClientePage(props: PageProps) {
  const { id } = await props.params;
  if (!UUID_RE.test(id)) notFound();

  const supabase = await getSupabaseServer();
  if (!supabase) redirect("/login");
  const authUser = await getAuthenticatedUser(supabase);
  if (!authUser?.activeMembership) redirect("/login");

  const { tenantId, role } = authUser.activeMembership;
  const isAdmin = role === "admin";

  const [{ data: tenant }, { data, error }] = await Promise.all([
    supabase.from("tenants").select("timezone, currency").eq("id", tenantId).single(),
    supabase.rpc("get_clients", { _tenant_id: tenantId, _client_id: id, _limit: 1 }),
  ]);
  if (error || !tenant) throw new Error("No se pudo cargar el cliente");
  const client = (data as unknown as ClientDirectory | null)?.items[0];
  if (!client) notFound();

  const { data: appts, error: apptsError } = await supabase
    .from("appointments")
    .select("id, start_at, status, barber_id, client_note, cancellation_reason")
    .eq("tenant_id", tenantId)
    .eq("client_id", id)
    .order("start_at", { ascending: false })
    .limit(HISTORY_LIMIT);
  if (apptsError) throw new Error("No se pudo cargar el historial");

  const rows = appts ?? [];
  const apptIds = rows.map((r) => r.id);
  const barberIds = [...new Set(rows.map((r) => r.barber_id))];

  const [{ data: lines }, { data: charges }, { data: barbers }] = await Promise.all([
    apptIds.length > 0
      ? supabase
          .from("appointment_services")
          .select("appointment_id, service_name, position")
          .eq("tenant_id", tenantId)
          .in("appointment_id", apptIds)
          .order("position", { ascending: true })
      : Promise.resolve({ data: [] }),
    apptIds.length > 0
      ? supabase
          .from("appointment_charges")
          .select("appointment_id, total_cents")
          .eq("tenant_id", tenantId)
          .is("voided_at", null)
          .in("appointment_id", apptIds)
      : Promise.resolve({ data: [] }),
    barberIds.length > 0
      ? supabase.from("barbers").select("id, display_name").eq("tenant_id", tenantId).in("id", barberIds)
      : Promise.resolve({ data: [] }),
  ]);

  const servicesByAppt = new Map<string, string[]>();
  for (const l of lines ?? []) {
    servicesByAppt.set(l.appointment_id, [...(servicesByAppt.get(l.appointment_id) ?? []), l.service_name]);
  }
  const chargeByAppt = new Map((charges ?? []).map((c) => [c.appointment_id, c.total_cents]));
  const barberNames = new Map((barbers ?? []).map((b) => [b.id, b.display_name]));

  const money = (cents: number) => formatPrice(cents, tenant.currency);
  const day = (iso: string) => formatShortDay(dateKeyInTimezone(iso, tenant.timezone));
  const firstName = client.full_name.trim().split(/\s+/)[0];
  const whatsappHref = client.phone ? waLink(client.phone, `Hola ${firstName}`) : null;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard/clientes" className="text-sm font-sans text-muted transition-colors hover:text-accent">
          ← {isAdmin ? "Clientes" : "Mis clientes"}
        </Link>
        <div className="mt-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="break-words text-section font-display text-foreground">{client.full_name}</h1>
            <p className="mt-1 text-sm font-sans text-muted">Cliente desde {day(client.created_at)}</p>
          </div>
          {isAdmin && (
            <EditClientButton
              clientId={client.id}
              name={client.full_name}
              phone={client.phone ? formatPhoneDisplay(client.phone) : ""}
            />
          )}
        </div>
      </div>

      {client.phone && (
        <div className="grid grid-cols-2 gap-2">
          <a href={`tel:${client.phone}`} className={CONTACT}>
            Llamar
          </a>
          {whatsappHref && (
            <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className={CONTACT}>
              WhatsApp
            </a>
          )}
          <p className="col-span-2 text-center text-sm font-sans tabular-nums text-muted">{formatPhoneDisplay(client.phone)}</p>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Visitas" value={String(client.visits)} />
        <Stat label="No llegó" value={String(client.no_shows)} />
        <Stat label="Ha gastado" value={money(client.spent_cents)} />
      </div>
      {!isAdmin && <p className="-mt-3 text-xs font-sans text-muted">Solo cuenta tus citas con este cliente.</p>}

      <section className="rounded-card border border-border bg-background-secondary p-[var(--spacing-card)]">
        <ClientNoteEditor clientId={client.id} initialNote={client.notes ?? ""} />
      </section>

      <section className="space-y-2.5">
        <h2 className="text-sm font-sans font-medium text-foreground">Historial</h2>
        {rows.length === 0 ? (
          <p className="rounded-card border border-border bg-background-secondary p-[var(--spacing-card)] text-center text-body font-sans text-muted">
            Sin citas todavía.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {rows.map((r) => {
              const total = chargeByAppt.get(r.id);
              return (
                <li key={r.id} className="space-y-1.5 rounded-card border border-border bg-background-secondary p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-sans text-foreground">
                      {day(r.start_at)} <span className="tabular-nums text-muted">· {formatClock(r.start_at, tenant.timezone)}</span>
                    </p>
                    <AppointmentStatusBadge status={r.status} />
                  </div>
                  <p className="text-sm font-sans text-muted">
                    {(servicesByAppt.get(r.id) ?? []).join(", ") || "Sin servicios"}
                    {barberNames.get(r.barber_id) ? ` · con ${barberNames.get(r.barber_id)}` : ""}
                  </p>
                  {total !== undefined && <p className="text-sm font-sans tabular-nums text-accent">{money(total)}</p>}
                  {r.client_note && <p className="text-sm font-sans italic text-muted">“{r.client_note}”</p>}
                  {r.cancellation_reason && (
                    <p className="text-sm font-sans text-red-400/90">
                      <span className="text-muted">Motivo: </span>
                      {r.cancellation_reason}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {rows.length === HISTORY_LIMIT && (
          <p className="text-center text-xs font-sans text-muted">Se muestran las últimas {HISTORY_LIMIT} citas.</p>
        )}
      </section>
    </div>
  );
}

const CONTACT =
  "flex h-12 items-center justify-center rounded-button border border-accent/40 text-sm font-sans font-medium text-accent transition-[background-color,transform] duration-150 ease-out hover:bg-accent/10 active:scale-[0.97]";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-card border border-border bg-background-secondary p-3 text-center">
      <p className="truncate font-display text-lg tabular-nums text-foreground">{value}</p>
      <p className="mt-0.5 truncate text-xs font-sans text-muted">{label}</p>
    </div>
  );
}
