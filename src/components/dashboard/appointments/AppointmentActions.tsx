"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/Dialog";
import { cn } from "@/lib/utils";
import {
  ACTION_LABELS,
  ALLOWED_TRANSITIONS,
  CANCEL_REASON_MAX,
  type AppointmentStatus,
  type TargetStatus,
} from "@/lib/appointments";
import { changeAppointmentStatusAction } from "@/app/(dashboard)/dashboard/citas/actions";

interface AppointmentActionsProps {
  appointmentId: string;
  status: AppointmentStatus;
  clientName: string;
  timeLabel: string;
}

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-button px-3.5 py-2 text-sm font-sans transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background-secondary disabled:cursor-not-allowed disabled:opacity-50";

const BUTTON_STYLE: Record<TargetStatus, string> = {
  confirmed: "bg-accent font-semibold text-background hover:brightness-110",
  completed: "bg-accent font-semibold text-background hover:brightness-110",
  cancelled: "border border-red-500/30 text-red-400 hover:bg-red-500/10",
  no_show: "border border-border text-muted hover:bg-border/50 hover:text-foreground",
};

/**
 * Botones de cambio de estado de una cita. Solo ofrece transiciones válidas
 * para el estado actual; el servidor las vuelve a validar de todos modos.
 */
export function AppointmentActions({
  appointmentId,
  status,
  clientName,
  timeLabel,
}: AppointmentActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<"cancelled" | "no_show" | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const targets = ALLOWED_TRANSITIONS[status] as TargetStatus[];

  // Estado final (completada / cancelada / no se presentó): sin acciones. Si la
  // cita llegó a este estado porque otro usuario la cambió mientras tanto, se
  // conserva el aviso para que quien intentó la acción sepa qué pasó.
  if (targets.length === 0) {
    return error ? (
      <p role="alert" className="text-sm font-sans text-amber-300">
        {error}
      </p>
    ) : null;
  }

  function run(target: TargetStatus, cancelReason?: string) {
    if (isPending) return; // doble clic
    setError(null);
    startTransition(async () => {
      try {
        const result = await changeAppointmentStatusAction(appointmentId, target, cancelReason);
        if (result.error) {
          setError(result.error);
          if (result.stale) {
            setDialog(null);
            router.refresh();
          }
          return;
        }
        setDialog(null);
        setReason("");
      } catch {
        setError("No se pudo conectar. Revisa tu conexión e intenta de nuevo.");
      }
    });
  }

  function closeDialog() {
    if (isPending) return;
    setDialog(null);
    setError(null);
  }

  const reasonTrimmed = reason.trim();

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {targets.map((target) => (
          <button
            key={target}
            type="button"
            disabled={isPending}
            onClick={() => {
              if (target === "cancelled" || target === "no_show") {
                setError(null);
                setDialog(target);
              } else {
                run(target);
              }
            }}
            className={cn(BUTTON_BASE, BUTTON_STYLE[target])}
          >
            {isPending && dialog === null && (target === "confirmed" || target === "completed")
              ? "Guardando…"
              : ACTION_LABELS[target]}
          </button>
        ))}
      </div>

      {error && dialog === null && (
        <p role="alert" className="text-sm font-sans text-red-400">
          {error}
        </p>
      )}

      {/* ── Cancelar: motivo obligatorio ─────────────────────────────── */}
      <Dialog open={dialog === "cancelled"} onClose={closeDialog} title="Cancelar cita">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (reasonTrimmed) run("cancelled", reasonTrimmed);
          }}
        >
          <p className="text-sm font-sans text-muted">
            {clientName} · {timeLabel}. El horario quedará libre para otra reserva.
          </p>
          <div>
            <label
              htmlFor={`cancel-reason-${appointmentId}`}
              className="mb-1.5 block text-sm font-sans text-muted"
            >
              Motivo <span className="text-accent">*</span>
            </label>
            <textarea
              id={`cancel-reason-${appointmentId}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={CANCEL_REASON_MAX}
              rows={3}
              required
              autoFocus
              disabled={isPending}
              placeholder="Ej.: el cliente avisó que no puede asistir"
              className="block w-full resize-none rounded-button border border-border bg-background px-4 py-3 text-body font-sans text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
            />
            <p className="mt-1 text-right text-xs font-sans text-muted">
              {reason.length}/{CANCEL_REASON_MAX}
            </p>
          </div>
          {error && (
            <p role="alert" className="text-sm font-sans text-red-400">
              {error}
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={closeDialog}
              disabled={isPending}
              className={cn(BUTTON_BASE, "text-muted hover:text-foreground")}
            >
              Volver
            </button>
            <button
              type="submit"
              disabled={isPending || !reasonTrimmed}
              className={cn(BUTTON_BASE, "bg-red-500/90 font-semibold text-white hover:bg-red-500")}
            >
              {isPending ? "Cancelando…" : "Cancelar cita"}
            </button>
          </div>
        </form>
      </Dialog>

      {/* ── No se presentó: confirmación ─────────────────────────────── */}
      <Dialog open={dialog === "no_show"} onClose={closeDialog} title="¿No se presentó?">
        <div className="space-y-4">
          <p className="text-sm font-sans text-muted">
            Marcarás que <span className="text-foreground">{clientName}</span> no llegó a su
            cita de las <span className="text-foreground">{timeLabel}</span>. Esta acción no
            se puede deshacer.
          </p>
          {error && (
            <p role="alert" className="text-sm font-sans text-red-400">
              {error}
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={closeDialog}
              disabled={isPending}
              className={cn(BUTTON_BASE, "text-muted hover:text-foreground")}
            >
              Volver
            </button>
            <button
              type="button"
              onClick={() => run("no_show")}
              disabled={isPending}
              className={cn(BUTTON_BASE, "border border-border font-semibold text-foreground hover:bg-border/50")}
            >
              {isPending ? "Guardando…" : "Sí, no se presentó"}
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
