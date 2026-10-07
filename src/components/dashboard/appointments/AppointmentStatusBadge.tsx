import { cn } from "@/lib/utils";
import { STATUS_LABELS, type AppointmentStatus } from "@/lib/appointments";

/**
 * Estado visual de una cita: ícono + texto + color. Nunca depende solo del
 * color para distinguirse.
 */

export const STATUS_TONE: Record<AppointmentStatus, string> = {
  pending: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  confirmed: "border-accent/40 bg-accent/10 text-accent",
  completed: "border-green-500/30 bg-green-500/10 text-green-400",
  cancelled: "border-red-500/30 bg-red-500/10 text-red-400",
  no_show: "border-border bg-background text-muted",
};

/** Franja lateral de la tarjeta, para escanear la agenda de un vistazo. */
export const STATUS_EDGE: Record<AppointmentStatus, string> = {
  pending: "before:bg-amber-400",
  confirmed: "before:bg-accent",
  completed: "before:bg-green-400",
  cancelled: "before:bg-red-400/60",
  no_show: "before:bg-muted/40",
};

const ICON_PATHS: Record<AppointmentStatus, string> = {
  // reloj
  pending: "M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  // check en círculo
  confirmed: "M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  // insignia con check
  completed:
    "M9 12.75 11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 0 1-1.043 3.296 3.745 3.745 0 0 1-3.296 1.043A3.745 3.745 0 0 1 12 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 0 1-3.296-1.043 3.745 3.745 0 0 1-1.043-3.296A3.745 3.745 0 0 1 3 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 0 1 1.043-3.296 3.746 3.746 0 0 1 3.296-1.043A3.746 3.746 0 0 1 12 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 0 1 3.296 1.043 3.746 3.746 0 0 1 1.043 3.296A3.745 3.745 0 0 1 21 12Z",
  // x en círculo
  cancelled: "m9.75 9.75 4.5 4.5m0-4.5-4.5 4.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  // persona con signo menos
  no_show:
    "M22 10.5h-6m-2.25-4.125a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0ZM4 19.235v-.11a6.375 6.375 0 0 1 12.75 0v.109A12.318 12.318 0 0 1 10.374 21c-2.331 0-4.512-.645-6.374-1.766Z",
};

export function StatusIcon({
  status,
  className = "h-3.5 w-3.5",
}: {
  status: AppointmentStatus;
  className?: string;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.75}
      stroke="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d={ICON_PATHS[status]} />
    </svg>
  );
}

export function AppointmentStatusBadge({
  status,
  className,
}: {
  status: AppointmentStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-sans font-semibold",
        STATUS_TONE[status],
        className
      )}
    >
      <StatusIcon status={status} />
      {STATUS_LABELS[status]}
    </span>
  );
}
