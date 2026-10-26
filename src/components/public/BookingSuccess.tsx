"use client";

import { useEffect, useRef } from "react";
import { Confetti } from "@/components/animations/Confetti";
import { useGsapAnimation } from "@/hooks/useGsapAnimation";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { formatPrice, formatDuration, formatSlotTime, formatSlotDate } from "@/lib/format";
import { waLink } from "@/lib/whatsapp";
import { downloadIcs, googleCalendarUrl } from "@/lib/calendar";
import type { PublicTenant, BookingConfirmation } from "@/types/public";

interface BookingSuccessProps {
  confirmation: BookingConfirmation;
  tenant: PublicTenant;
  onNewBooking: () => void;
}

/**
 * Pantalla de éxito post-reserva: celebración (confeti + palomita) y boleto
 * con la cita. La cita queda "pending" hasta que la barbería la apruebe, por
 * eso el texto habla de reserva registrada, no confirmada. Todo sale de la
 * respuesta de book_appointment.
 */
export function BookingSuccess({ confirmation, tenant, onNewBooking }: BookingSuccessProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const reduceMotion = usePrefersReducedMotion();
  const { services, total_price_cents, total_duration_minutes, start_at, end_at, client, barber_id } = confirmation;

  const orderedServices = [...services].sort((a, b) => a.position - b.position);
  const barberName = tenant.barbers.find((b) => b.id === barber_id)?.display_name ?? "tu barbero";
  const dateStr = formatSlotDate(start_at, tenant.timezone);
  const timeStr = formatSlotTime(start_at, tenant.timezone);
  const firstName = client.name.trim().split(/\s+/)[0] ?? client.name;
  const serviceNames = orderedServices.map((s) => s.name).join(", ");
  const address = [tenant.address_line, tenant.city, tenant.state].filter(Boolean).join(", ");

  // Mensaje ya escrito del cliente a la barbería (wa.me, sin costo).
  const whatsappHref = tenant.public_phone
    ? waLink(
        tenant.public_phone,
        `Hola, acabo de reservar en ${tenant.name}: ${serviceNames} con ${barberName} el ${dateStr} a las ${timeStr}. A nombre de ${client.name}.`
      )
    : null;

  const calendarEvent = {
    uid: `${confirmation.appointment_id}@barberias`,
    title: `Cita en ${tenant.name}`,
    description: `${serviceNames} con ${barberName}.`,
    location: address,
    startIso: start_at,
    endIso: end_at,
  };

  // Al aparecer: la pantalla de éxito a la vista y un toque de vibración (Android).
  useEffect(() => {
    const el = rootRef.current;
    if (el && el.getBoundingClientRect().top < 0) {
      el.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    }
    if (!reduceMotion && typeof navigator !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate([14, 60, 22]);
      } catch {
        // Algunos navegadores lo bloquean sin interacción reciente.
      }
    }
  }, [reduceMotion]);

  useGsapAnimation(
    ({ gsap }) => {
      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
      tl.fromTo("[data-badge]", { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.55, ease: "back.out(1.8)" })
        .fromTo("[data-check]", { strokeDashoffset: 24 }, { strokeDashoffset: 0, duration: 0.4, ease: "power2.out" }, "-=0.25")
        .fromTo("[data-reveal]", { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.5, stagger: 0.07, clearProps: "transform" }, "-=0.2");
    },
    { scope: rootRef }
  );

  return (
    <div ref={rootRef} className="mx-auto max-w-lg scroll-mt-20">
      <Confetti />

      {/* ── Insignia + título ───────────────────────────────── */}
      <div className="text-center">
        <div data-badge className="relative mx-auto flex h-20 w-20 items-center justify-center">
          <span aria-hidden="true" className="absolute inset-0 rounded-full bg-accent/15" />
          <span aria-hidden="true" className="absolute inset-2 rounded-full bg-accent" />
          <svg className="relative h-9 w-9 text-background" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              data-check
              d="M5 12.5 10 17.5 19 7.5"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={24}
            />
          </svg>
        </div>
        <h3 data-reveal className="mt-5 text-3xl font-display text-foreground">
          ¡Listo, {firstName}!
        </h3>
        <p data-reveal className="mt-2 text-body font-sans text-muted">
          Tu reserva quedó registrada. Te esperamos el <span className="text-foreground">{dateStr}</span> a las{" "}
          <span className="tabular-nums text-foreground">{timeStr}</span>.
        </p>
      </div>

      {/* ── Boleto ──────────────────────────────────────────── */}
      <div data-reveal className="relative mt-8 rounded-card border border-border bg-background-secondary shadow-card">
        <div className="flex items-center gap-4 p-5">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-card bg-accent/15">
            <span className="font-display text-2xl leading-none tabular-nums text-accent">{timeStr}</span>
          </div>
          <div className="min-w-0">
            <p className="font-display text-lg capitalize leading-snug text-foreground">{dateStr}</p>
            <p className="mt-0.5 text-sm font-sans text-muted">
              con <span className="text-foreground">{barberName}</span> · {tenant.name}
            </p>
          </div>
        </div>

        {/* Perforación del boleto */}
        <div aria-hidden="true" className="relative h-px">
          <span className="absolute -left-3 -top-3 h-6 w-6 rounded-full border border-border bg-background" />
          <span className="absolute -right-3 -top-3 h-6 w-6 rounded-full border border-border bg-background" />
          <span className="absolute inset-x-5 top-0 border-t border-dashed border-border" />
        </div>

        <div className="p-5">
          <ol className="space-y-2.5">
            {orderedServices.map((s) => (
              <li key={`${s.position}-${s.id}`} className="flex items-baseline justify-between gap-4 text-body font-sans">
                <span className="min-w-0">
                  <span className="block text-foreground">{s.name}</span>
                  <span className="block text-sm text-muted">{formatDuration(s.duration_minutes)}</span>
                </span>
                <span className="shrink-0 tabular-nums text-foreground">{formatPrice(s.price_cents, tenant.currency)}</span>
              </li>
            ))}
          </ol>
          <div className="mt-3 flex items-baseline justify-between gap-4 border-t border-border pt-3">
            <span className="text-sm font-sans text-muted">Total · {formatDuration(total_duration_minutes)}</span>
            <span className="font-display text-xl tabular-nums text-accent">{formatPrice(total_price_cents, tenant.currency)}</span>
          </div>
          {address && <p className="mt-3 text-sm font-sans text-muted">{address}</p>}
        </div>
      </div>

      <p data-reveal className="mt-4 text-center text-sm font-sans text-muted">
        La barbería confirmará tu cita.
        {whatsappHref ? " Avísales por WhatsApp para que la vean al momento." : ""}
      </p>

      {/* ── Acciones ────────────────────────────────────────── */}
      <div data-reveal className="mt-6 space-y-3">
        {whatsappHref && (
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-14 w-full items-center justify-center gap-2 rounded-button bg-accent text-base font-sans font-semibold text-background transition-[filter,transform] duration-150 ease-out hover:brightness-110 active:scale-[0.98]"
          >
            <WhatsAppIcon />
            Avisar por WhatsApp
          </a>
        )}
        <button
          type="button"
          onClick={() => downloadIcs(calendarEvent)}
          className={
            whatsappHref
              ? "flex h-14 w-full items-center justify-center gap-2 rounded-button border border-border text-base font-sans font-medium text-foreground transition-[border-color,background-color,transform] duration-150 ease-out hover:border-accent/60 active:scale-[0.98]"
              : "flex h-14 w-full items-center justify-center gap-2 rounded-button bg-accent text-base font-sans font-semibold text-background transition-[filter,transform] duration-150 ease-out hover:brightness-110 active:scale-[0.98]"
          }
        >
          <CalendarIcon />
          Agregar a mi calendario
        </button>
        <div className="flex items-center justify-center gap-5 pt-1 text-sm font-sans">
          <a
            href={googleCalendarUrl(calendarEvent)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted underline-offset-4 transition-colors hover:text-accent hover:underline"
          >
            Usar Google Calendar
          </a>
          <button
            type="button"
            onClick={onNewBooking}
            className="text-muted underline-offset-4 transition-colors hover:text-accent hover:underline"
          >
            Hacer otra reserva
          </button>
        </div>
      </div>
    </div>
  );
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5" aria-hidden="true">
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.87 9.87 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24a8.24 8.24 0 0 1 8.24 8.25c0 4.54-3.7 8.23-8.24 8.23Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.51.11-.11.25-.29.37-.43.13-.15.17-.25.25-.42.08-.16.04-.31-.02-.43-.06-.13-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.22-.16-.47-.29Z" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-5 w-5" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5M12 12.75v3m-1.5-1.5h3" />
    </svg>
  );
}
