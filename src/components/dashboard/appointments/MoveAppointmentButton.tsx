"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/Dialog";
import { cn } from "@/lib/utils";
import {
  MAX_SERVICES_PER_APPOINTMENT,
  dateKeyInTimezone,
  timeKeyInTimezone,
  type WalkInWarning,
} from "@/lib/appointments";
import {
  moveAppointmentAction,
  type WalkInConflict,
} from "@/app/(dashboard)/dashboard/citas/actions";
import {
  ErrorText,
  FIELD,
  LABEL,
  PRIMARY,
  SECONDARY,
  ServicePicker,
  WarningsReview,
  type FormService,
} from "./AppointmentFormParts";

/** Lo que el panel "Mover" necesita de la agenda (igual para todas las citas). */
export interface MoveOptions {
  timezone: string;
  currency: string;
  /** Fecha local de hoy en la barbería ("YYYY-MM-DD"). */
  todayKey: string;
  /** Barberos activos de la barbería (destino posible). */
  barbers: { id: string; name: string }[];
  /** Servicios activos del catálogo. */
  services: FormService[];
}

interface MoveAppointmentButtonProps {
  appointmentId: string;
  clientName: string;
  barberId: string;
  serviceIds: string[];
  startIso: string;
  options: MoveOptions;
  className?: string;
}

/**
 * Botón "Mover" + panel para reprogramar, reasignar o cambiar servicios.
 * La validación real ocurre en moveAppointmentAction → public.move_appointment.
 */
export function MoveAppointmentButton({
  appointmentId,
  clientName,
  barberId: currentBarberId,
  serviceIds: currentServiceIds,
  startIso,
  options,
  className,
}: MoveAppointmentButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const { timezone, currency, todayKey, barbers, services } = options;

  const [barberId, setBarberId] = useState(currentBarberId);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ warnings: WalkInWarning[]; conflicts: WalkInConflict[] } | null>(null);

  function openSheet() {
    const currentDate = dateKeyInTimezone(startIso, timezone);
    setBarberId(barbers.some((b) => b.id === currentBarberId) ? currentBarberId : "");
    setDate(currentDate < todayKey ? todayKey : currentDate);
    setTime(timeKeyInTimezone(startIso, timezone));
    // Solo servicios que siguen activos en el catálogo.
    setServiceIds(currentServiceIds.filter((id) => services.some((s) => s.id === id)));
    setError(null);
    setConfirm(null);
    setOpen(true);
  }

  function closeSheet() {
    if (!isPending) setOpen(false);
  }

  function toggleService(id: string) {
    setConfirm(null);
    setServiceIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= MAX_SERVICES_PER_APPOINTMENT ? prev : [...prev, id]
    );
  }

  const canSubmit = !!barberId && !!date && date >= todayKey && !!time && serviceIds.length > 0 && !isPending;

  function submit(acknowledgeWarnings: boolean) {
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await moveAppointmentAction({
          appointmentId,
          barberId,
          date,
          time,
          serviceIds,
          acknowledgeWarnings,
        });
        if (result.needsConfirmation) {
          setConfirm({ warnings: result.warnings ?? [], conflicts: result.conflicts ?? [] });
          return;
        }
        if (result.error) {
          setConfirm(null);
          setError(result.error);
          if (result.stale) router.refresh();
          return;
        }
        setOpen(false);
        router.refresh();
      } catch {
        setError("No se pudo conectar. Revisa tu conexión e intenta de nuevo.");
      }
    });
  }

  return (
    <>
      <button type="button" onClick={openSheet} className={className}>
        Mover
      </button>

      <Dialog open={open} onClose={closeSheet} title={confirm ? "Revisa antes de mover" : `Mover cita · ${clientName}`}>
        {confirm ? (
          <div className="space-y-5">
            <WarningsReview
              warnings={confirm.warnings}
              conflicts={confirm.conflicts}
              timezone={timezone}
              intro="Puedes moverla de todos modos: ninguna otra cita se moverá ni se cancelará."
            />
            {error && <ErrorText>{error}</ErrorText>}
            <div className="flex flex-col gap-2">
              <button type="button" onClick={() => submit(true)} disabled={isPending} className={PRIMARY}>
                {isPending ? "Guardando…" : "Mover de todos modos"}
              </button>
              <button type="button" onClick={() => setConfirm(null)} disabled={isPending} className={SECONDARY}>
                Volver y cambiar
              </button>
            </div>
          </div>
        ) : (
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              submit(false);
            }}
          >
            <div>
              <label htmlFor={`move-barber-${appointmentId}`} className={LABEL}>Barbero</label>
              <select
                id={`move-barber-${appointmentId}`}
                value={barberId}
                onChange={(e) => {
                  setBarberId(e.target.value);
                  setConfirm(null);
                }}
                required
                disabled={isPending}
                className={FIELD}
              >
                <option value="" disabled>Elige un barbero</option>
                {barbers.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="min-w-0">
                <label htmlFor={`move-date-${appointmentId}`} className={LABEL}>Fecha</label>
                <input
                  id={`move-date-${appointmentId}`}
                  type="date"
                  min={todayKey}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                  disabled={isPending}
                  className={cn(FIELD, "tabular-nums")}
                />
              </div>
              <div className="min-w-0">
                <label htmlFor={`move-time-${appointmentId}`} className={LABEL}>Hora</label>
                <input
                  id={`move-time-${appointmentId}`}
                  type="time"
                  step={60}
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  required
                  disabled={isPending}
                  className={cn(FIELD, "tabular-nums")}
                />
              </div>
            </div>

            <ServicePicker
              services={services}
              selectedIds={serviceIds}
              onToggle={toggleService}
              currency={currency}
              disabled={isPending}
            />

            {error && <ErrorText>{error}</ErrorText>}

            <button type="submit" disabled={!canSubmit} className={PRIMARY}>
              {isPending ? "Guardando…" : "Guardar cambios"}
            </button>
          </form>
        )}
      </Dialog>
    </>
  );
}
