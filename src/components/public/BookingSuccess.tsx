"use client";

import { Button } from "@/components/ui/Button";
import { ScrollReveal } from "@/components/animations/ScrollReveal";
import {
  formatPrice,
  formatDuration,
  formatSlotTime,
  formatSlotDate,
} from "@/lib/format";
import type { PublicTenant, BookingConfirmation } from "@/types/public";

// ─── Helpers ───────────────────────────────────────────────────────────────

function getBarberName(
  tenant: PublicTenant,
  barberId: string
): string {
  const barber = tenant.barbers.find((b) => b.id === barberId);
  return barber?.display_name ?? "—";
}

// ─── Component ─────────────────────────────────────────────────────────────

interface BookingSuccessProps {
  confirmation: BookingConfirmation;
  tenant: PublicTenant;
  onNewBooking: () => void;
}

/**
 * Pantalla de éxito post-reserva.
 *
 * Muestra "Reserva recibida" (NO "Cita confirmada" — la cita queda en
 * estado pending hasta que la barbería la apruebe manualmente).
 *
 * Muestra: barbería, barbero, servicio, precio, duración, fecha, hora,
 * nombre del cliente, y una nota explicando el estado pendiente.
 */
export function BookingSuccess({
  confirmation,
  tenant,
  onNewBooking,
}: BookingSuccessProps) {
  const { service, start_at, client, barber_id } = confirmation;

  const rows: { label: string; value: string }[] = [
    { label: "Barbería", value: tenant.name },
    { label: "Barbero", value: getBarberName(tenant, barber_id) },
    { label: "Servicio", value: service.name },
    { label: "Precio", value: formatPrice(service.price_cents, tenant.currency) },
    { label: "Duración", value: formatDuration(service.duration_minutes) },
    { label: "Fecha", value: formatSlotDate(start_at, tenant.timezone) },
    { label: "Hora", value: formatSlotTime(start_at, tenant.timezone) },
    { label: "Cliente", value: client.name },
  ];

  return (
    <ScrollReveal>
      <div className="mx-auto max-w-lg">
        {/* ── Icono + título ─────────────────────────────────── */}
        <div className="text-center">
          <div
            className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-accent/10"
            aria-hidden="true"
          >
            <svg
              className="h-8 w-8 text-accent"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
              />
            </svg>
          </div>
          <h3 className="mt-4 text-2xl font-display text-foreground">
            Reserva recibida
          </h3>
          <p className="mt-2 text-body font-sans text-muted">
            Tu cita ha sido registrada y está pendiente de aprobación por parte
            de la barbería.
          </p>
        </div>

        {/* ── Detalle de la reserva ──────────────────────────── */}
        <div className="mt-8 rounded-card border border-border bg-background-secondary p-6">
          <dl className="divide-y divide-border">
            {rows.map(({ label, value }) => (
              <div
                key={label}
                className="flex items-baseline justify-between gap-4 py-3 first:pt-0 last:pb-0"
              >
                <dt className="text-label font-sans uppercase tracking-label text-muted">
                  {label}
                </dt>
                <dd className="text-right text-body font-sans text-foreground">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        {/* ── Nota de estado pendiente ───────────────────────── */}
        <div className="mt-6 rounded-card border border-accent/20 bg-accent/5 px-5 py-4">
          <p className="text-sm font-sans text-muted">
            <span className="font-medium text-accent">Estado: pendiente.</span>{" "}
            La barbería revisará tu solicitud y te notificará cuando sea
            aprobada. Puedes comunicarte directamente con ellos si tienes alguna
            pregunta.
          </p>
        </div>

        {/* ── Acciones ───────────────────────────────────────── */}
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button onClick={onNewBooking} variant="secondary">
            Hacer otra reserva
          </Button>
          <Button href="#servicios" variant="ghost">
            Ver servicios
          </Button>
        </div>
      </div>
    </ScrollReveal>
  );
}
