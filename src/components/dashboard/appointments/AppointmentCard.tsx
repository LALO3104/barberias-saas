import { cn } from "@/lib/utils";
import {
  formatClock,
  formatPhoneDisplay,
  minutesBetween,
  type AppointmentStatus,
} from "@/lib/appointments";
import { formatDuration } from "@/lib/format";
import { AppointmentStatusBadge, STATUS_EDGE } from "./AppointmentStatusBadge";
import { AppointmentActions } from "./AppointmentActions";

/** Lo que la agenda necesita para atender una cita. */
export interface AgendaAppointment {
  id: string;
  startIso: string;
  endIso: string;
  status: AppointmentStatus;
  clientName: string;
  clientPhone: string | null;
  services: string[];
  barberName: string | null;
  clientNote: string | null;
  cancellationReason: string | null;
}

interface AppointmentCardProps {
  appointment: AgendaAppointment;
  timezone: string;
  /** Admin viendo "Todos los barberos": muestra quién atiende. */
  showBarber: boolean;
}

export function AppointmentCard({ appointment: a, timezone, showBarber }: AppointmentCardProps) {
  const start = formatClock(a.startIso, timezone);
  const end = formatClock(a.endIso, timezone);
  const closed = a.status === "cancelled" || a.status === "no_show";

  return (
    <article
      className={cn(
        "relative overflow-hidden rounded-card border border-border bg-background-secondary p-4 pl-5 sm:p-5 sm:pl-6",
        "before:absolute before:inset-y-0 before:left-0 before:w-1",
        STATUS_EDGE[a.status]
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:gap-6">
        {/* Hora */}
        <div className="flex items-baseline gap-2 whitespace-nowrap sm:w-28 sm:shrink-0 sm:flex-col sm:gap-0.5">
          <p
            className={cn(
              "font-display text-2xl leading-none text-foreground",
              closed && "text-muted line-through decoration-1"
            )}
          >
            {start}
          </p>
          <p className="text-xs font-sans text-muted">
            {end} · {formatDuration(minutesBetween(a.startIso, a.endIso))}
          </p>
        </div>

        {/* Detalle */}
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
            <div className="min-w-0">
              <h3 className={cn("truncate font-display text-lg text-foreground", closed && "text-muted")}>
                {a.clientName}
              </h3>
              <p className="mt-0.5 text-sm font-sans text-muted">
                {a.services.length > 0 ? a.services.join(" + ") : "Servicio no registrado"}
                {showBarber && a.barberName && (
                  <>
                    <span aria-hidden="true"> · </span>
                    <span className="text-foreground/80">con {a.barberName}</span>
                  </>
                )}
              </p>
            </div>
            <AppointmentStatusBadge status={a.status} />
          </div>

          {a.clientPhone && (
            <a
              href={`tel:${a.clientPhone}`}
              className="inline-flex items-center gap-1.5 rounded-button text-sm font-sans text-foreground/90 transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="h-4 w-4 text-accent"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z"
                />
              </svg>
              <span className="sr-only">Llamar a </span>
              {formatPhoneDisplay(a.clientPhone)}
            </a>
          )}

          {a.clientNote && (
            <blockquote className="border-l-2 border-accent/40 pl-3 text-sm font-sans italic text-muted">
              “{a.clientNote}”
            </blockquote>
          )}

          {a.status === "cancelled" && a.cancellationReason && (
            <p className="text-sm font-sans text-red-400/90">
              <span className="text-muted">Motivo de cancelación: </span>
              {a.cancellationReason}
            </p>
          )}

          <AppointmentActions
            appointmentId={a.id}
            status={a.status}
            clientName={a.clientName}
            timeLabel={start}
          />
        </div>
      </div>
    </article>
  );
}
