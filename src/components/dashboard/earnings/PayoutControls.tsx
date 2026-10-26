"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/Dialog";
import { cn } from "@/lib/utils";
import { centsToPesosInput, formatPrice, parsePesosToCents } from "@/lib/format";
import { recordPayoutAction, voidPayoutAction } from "@/app/(dashboard)/dashboard/ganancias/actions";
import {
  ErrorText,
  FIELD,
  LABEL,
  PRIMARY,
  SECONDARY,
} from "@/components/dashboard/appointments/AppointmentFormParts";

const SMALL_BUTTON =
  "inline-flex items-center justify-center rounded-button px-3.5 py-2 text-sm font-sans transition-[background-color,filter,transform] duration-150 ease-out active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

interface PayoutButtonProps {
  barberId: string;
  barberName: string;
  /** Periodo sugerido (fechas locales, el fin ya recortado a hoy). */
  from: string;
  to: string;
  todayKey: string;
  /** Comisión + propinas pendientes en el periodo (informativo). */
  pendingCents: number;
  /** Salario sugerido (barbero a salario), o null. */
  suggestedSalaryCents: number | null;
  currency: string;
}

/** "Marcar como pagado": registra el pago del periodo (solo admin). */
export function PayoutButton({
  barberId,
  barberName,
  from,
  to,
  todayKey,
  pendingCents,
  suggestedSalaryCents,
  currency,
}: PayoutButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [start, setStart] = useState(from);
  const [end, setEnd] = useState(to);
  const [salary, setSalary] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  function openSheet() {
    setStart(from);
    setEnd(to);
    setSalary(suggestedSalaryCents ? centsToPesosInput(suggestedSalaryCents) : "");
    setNote("");
    setError(null);
    setOpen(true);
  }

  const salaryCents = parsePesosToCents(salary);
  const valid = !!start && !!end && start <= end && end <= todayKey && salaryCents !== null;

  function submit() {
    if (!valid || isPending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await recordPayoutAction({ barberId, from: start, to: end, salaryCents, note });
        if (result.error) {
          setError(result.error);
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
      <button type="button" onClick={openSheet} className={cn(SMALL_BUTTON, "bg-accent font-semibold text-background hover:brightness-110")}>
        Marcar como pagado
      </button>

      <Dialog open={open} onClose={() => !isPending && setOpen(false)} title={`Pago a ${barberName}`}>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <p className="text-sm font-sans text-muted">
            La comisión y las propinas se calculan solas con los cobros del periodo
            {pendingCents > 0 ? ` (pendiente en este periodo: ${formatPrice(pendingCents, currency)})` : ""}.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="min-w-0">
              <label htmlFor={`from-${barberId}`} className={LABEL}>Desde</label>
              <input
                id={`from-${barberId}`}
                type="date"
                value={start}
                max={todayKey}
                onChange={(e) => setStart(e.target.value)}
                disabled={isPending}
                className={cn(FIELD, "tabular-nums")}
              />
            </div>
            <div className="min-w-0">
              <label htmlFor={`to-${barberId}`} className={LABEL}>Hasta</label>
              <input
                id={`to-${barberId}`}
                type="date"
                value={end}
                max={todayKey}
                onChange={(e) => setEnd(e.target.value)}
                disabled={isPending}
                className={cn(FIELD, "tabular-nums")}
              />
            </div>
          </div>
          <div>
            <label htmlFor={`salary-pay-${barberId}`} className={LABEL}>
              Salario incluido en este pago <span className="text-muted/70">(opcional)</span>
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-body font-sans text-muted">$</span>
              <input
                id={`salary-pay-${barberId}`}
                type="text"
                inputMode="decimal"
                value={salary}
                onChange={(e) => setSalary(e.target.value)}
                placeholder="0"
                disabled={isPending}
                className={cn(FIELD, "pl-8 tabular-nums")}
              />
            </div>
          </div>
          <div>
            <label htmlFor={`note-${barberId}`} className={LABEL}>
              Nota <span className="text-muted/70">(opcional)</span>
            </label>
            <input
              id={`note-${barberId}`}
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={300}
              placeholder="Ej.: pagado en efectivo"
              disabled={isPending}
              className={FIELD}
            />
          </div>
          {start > end && <ErrorText>La fecha inicial no puede ser posterior a la final.</ErrorText>}
          {end > todayKey && <ErrorText>No puedes pagar días que aún no pasan.</ErrorText>}
          {salaryCents === null && <ErrorText>Escribe el salario en pesos, por ejemplo 3000.</ErrorText>}
          {error && <ErrorText>{error}</ErrorText>}
          <button type="submit" disabled={!valid || isPending} className={PRIMARY}>
            {isPending ? "Guardando…" : "Registrar pago"}
          </button>
        </form>
      </Dialog>
    </>
  );
}

/** "Anular" un pago registrado (solo admin). */
export function PayoutVoidButton({ payoutId, label }: { payoutId: string; label: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    const clean = reason.trim();
    if (!clean || isPending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await voidPayoutAction(payoutId, clean);
        if (result.error) {
          setError(result.error);
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
      <button
        type="button"
        onClick={() => {
          setReason("");
          setError(null);
          setOpen(true);
        }}
        className="text-sm font-sans text-muted underline-offset-4 transition-colors hover:text-red-400 hover:underline"
      >
        Anular
      </button>
      <Dialog open={open} onClose={() => !isPending && setOpen(false)} title="Anular pago">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <p className="text-sm font-sans text-muted">{label}. El periodo quedará pendiente otra vez.</p>
          <div>
            <label htmlFor={`void-payout-${payoutId}`} className={LABEL}>
              Motivo <span className="text-accent">*</span>
            </label>
            <textarea
              id={`void-payout-${payoutId}`}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              required
              disabled={isPending}
              className={cn(FIELD, "resize-none")}
            />
          </div>
          {error && <ErrorText>{error}</ErrorText>}
          <div className="flex flex-col gap-2">
            <button type="submit" disabled={isPending || !reason.trim()} className={PRIMARY}>
              {isPending ? "Anulando…" : "Anular pago"}
            </button>
            <button type="button" onClick={() => setOpen(false)} disabled={isPending} className={SECONDARY}>
              Volver
            </button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
