"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/Dialog";
import { formatPrice } from "@/lib/format";
import { PAYMENT_METHOD_LABELS, VOID_REASON_MAX, type PaymentMethod } from "@/lib/appointments";
import { voidChargeAction } from "@/app/(dashboard)/dashboard/citas/actions";
import { ChargeButton, type ChargeLine } from "./ChargeButton";
import { ErrorText, FIELD, LABEL, PRIMARY, SECONDARY } from "./AppointmentFormParts";
import { NEUTRAL_ACTION_CLASS } from "./AppointmentActions";

export interface AgendaCharge {
  id: string;
  totalCents: number;
  discountCents: number;
  tipCents: number;
  payments: { method: PaymentMethod; amountCents: number }[];
}

interface ChargeSummaryProps {
  appointmentId: string;
  clientName: string;
  lines: ChargeLine[];
  currency: string;
  charge: AgendaCharge | null;
  /** Solo el admin anula cobros. */
  canVoid: boolean;
}

/** Cobro de una cita completada: resumen + anular (admin), o "Registrar cobro". */
export function ChargeSummary({ appointmentId, clientName, lines, currency, charge, canVoid }: ChargeSummaryProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!charge) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-sans text-amber-300">Sin cobro registrado</span>
        <ChargeButton
          appointmentId={appointmentId}
          clientName={clientName}
          lines={lines}
          currency={currency}
          mode="charge"
          className={NEUTRAL_ACTION_CLASS}
        />
      </div>
    );
  }

  const detail = [
    charge.payments.length === 0
      ? "Cortesía"
      : charge.payments.map((p) => `${PAYMENT_METHOD_LABELS[p.method]} ${formatPrice(p.amountCents, currency)}`).join(" · "),
    charge.discountCents > 0 ? `descuento ${formatPrice(charge.discountCents, currency)}` : null,
    charge.tipCents > 0 ? `propina ${formatPrice(charge.tipCents, currency)}` : null,
  ].filter(Boolean);

  function submitVoid() {
    const clean = reason.trim();
    if (!clean || isPending || !charge) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await voidChargeAction(charge.id, clean);
        if (result.error) {
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
    <div className="space-y-2">
      <p className="text-sm font-sans text-foreground">
        <span className="text-accent">Cobrado {formatPrice(charge.totalCents, currency)}</span>
        <span className="text-muted"> · {detail.join(" · ")}</span>
      </p>
      {canVoid && (
        <button
          type="button"
          onClick={() => {
            setReason("");
            setError(null);
            setOpen(true);
          }}
          className="text-sm font-sans text-muted underline-offset-4 transition-colors hover:text-red-400 hover:underline"
        >
          Anular cobro
        </button>
      )}

      <Dialog open={open} onClose={() => !isPending && setOpen(false)} title="Anular cobro">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submitVoid();
          }}
        >
          <p className="text-sm font-sans text-muted">
            {clientName} · {formatPrice(charge.totalCents, currency)}. El cobro queda en el historial como anulado y
            podrás registrarlo de nuevo.
          </p>
          <div>
            <label htmlFor={`void-${charge.id}`} className={LABEL}>
              Motivo <span className="text-accent">*</span>
            </label>
            <textarea
              id={`void-${charge.id}`}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={VOID_REASON_MAX}
              required
              placeholder="Ej.: se registró en efectivo pero pagó con tarjeta"
              disabled={isPending}
              className={`${FIELD} resize-none`}
            />
          </div>
          {error && <ErrorText>{error}</ErrorText>}
          <div className="flex flex-col gap-2">
            <button type="submit" disabled={isPending || !reason.trim()} className={PRIMARY}>
              {isPending ? "Anulando…" : "Anular cobro"}
            </button>
            <button type="button" onClick={() => setOpen(false)} disabled={isPending} className={SECONDARY}>
              Volver
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
