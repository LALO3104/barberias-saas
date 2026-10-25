"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/Dialog";
import { cn } from "@/lib/utils";
import { centsToPesosInput, formatPrice, parsePesosToCents } from "@/lib/format";
import {
  DISCOUNT_REASON_MAX,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
} from "@/lib/appointments";
import { chargeAppointmentAction } from "@/app/(dashboard)/dashboard/citas/actions";
import { ErrorText, FIELD, LABEL, PRIMARY } from "./AppointmentFormParts";

export interface ChargeLine {
  name: string;
  priceCents: number;
}

interface ChargeButtonProps {
  appointmentId: string;
  clientName: string;
  lines: ChargeLine[];
  currency: string;
  /** complete: "Completar y cobrar" (cita confirmada) · charge: "Registrar cobro" (completada sin cobro). */
  mode: "complete" | "charge";
  className?: string;
}

/**
 * Botón + panel de cobro. Montos en centavos; los campos aceptan pesos
 * ("150.50"). public.charge_appointment vuelve a validar todo.
 */
export function ChargeButton({ appointmentId, clientName, lines, currency, mode, className }: ChargeButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [discount, setDiscount] = useState("");
  const [reason, setReason] = useState("");
  const [tip, setTip] = useState("");
  const [methods, setMethods] = useState<PaymentMethod[]>(["cash"]);
  const [amounts, setAmounts] = useState<Partial<Record<PaymentMethod, string>>>({});
  const [error, setError] = useState<string | null>(null);

  const subtotal = lines.reduce((sum, l) => sum + l.priceCents, 0);
  const discountCents = parsePesosToCents(discount);
  const tipCents = parsePesosToCents(tip);
  const validNumbers = discountCents !== null && tipCents !== null;
  const discountTooBig = discountCents !== null && discountCents > subtotal;
  const total = validNumbers && !discountTooBig ? subtotal - discountCents + tipCents : null;

  // Con un método, el monto es el total. Con varios, se capturan.
  const paymentCents: Partial<Record<PaymentMethod, number | null>> = {};
  if (total !== null && methods.length === 1) {
    paymentCents[methods[0]] = total;
  } else {
    for (const m of methods) paymentCents[m] = parsePesosToCents(amounts[m] ?? "");
  }
  const assigned = methods.reduce((sum, m) => sum + (paymentCents[m] ?? 0), 0);
  const paymentsValid = methods.every((m) => {
    const v = paymentCents[m];
    return v !== null && v !== undefined && v > 0;
  });
  const isCourtesy = total === 0;
  const balanced = total !== null && (isCourtesy || (paymentsValid && assigned === total));
  const canSubmit = !isPending && total !== null && balanced && (isCourtesy || methods.length > 0);

  function openSheet() {
    setDiscount("");
    setReason("");
    setTip("");
    setMethods(["cash"]);
    setAmounts({});
    setError(null);
    setOpen(true);
  }

  function toggleMethod(m: PaymentMethod) {
    if (methods.includes(m)) {
      if (methods.length > 1) setMethods(methods.filter((x) => x !== m));
      return;
    }
    // Al pasar a pago mixto, el primer método conserva el total como punto de partida.
    if (methods.length === 1 && total !== null) {
      setAmounts({ [methods[0]]: centsToPesosInput(total) });
    }
    setMethods(PAYMENT_METHODS.filter((x) => x === m || methods.includes(x)));
  }

  function submit() {
    if (!canSubmit || total === null || discountCents === null || tipCents === null) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await chargeAppointmentAction({
          appointmentId,
          discountCents,
          discountReason: discountCents > 0 ? reason : "",
          tipCents,
          payments: isCourtesy
            ? []
            : methods.map((m) => ({ method: m, amountCents: paymentCents[m] as number })),
        });
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

  const label = mode === "complete" ? "Completar y cobrar" : "Registrar cobro";
  const remaining = total !== null ? total - assigned : 0;

  return (
    <>
      <button type="button" onClick={openSheet} className={className}>
        {label}
      </button>

      <Dialog open={open} onClose={() => !isPending && setOpen(false)} title={`${label} · ${clientName}`}>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {/* Servicios */}
          <div className="rounded-card border border-border">
            <ul className="divide-y divide-border">
              {lines.map((l, i) => (
                <li key={i} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm font-sans">
                  <span className="min-w-0 truncate text-foreground">{l.name}</span>
                  <span className="shrink-0 tabular-nums text-muted">{formatPrice(l.priceCents, currency)}</span>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-sm font-sans">
              <span className="text-muted">Subtotal</span>
              <span className="tabular-nums text-foreground">{formatPrice(subtotal, currency)}</span>
            </div>
          </div>

          {/* Ajustes */}
          <div className="grid grid-cols-2 gap-3">
            <MoneyField id={`discount-${appointmentId}`} label="Descuento" value={discount} onChange={setDiscount} disabled={isPending} />
            <MoneyField id={`tip-${appointmentId}`} label="Propina" value={tip} onChange={setTip} disabled={isPending} />
          </div>
          {discountCents !== null && discountCents > 0 && (
            <div>
              <label htmlFor={`reason-${appointmentId}`} className={LABEL}>
                Motivo del descuento <span className="text-muted/70">(opcional)</span>
              </label>
              <input
                id={`reason-${appointmentId}`}
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={DISCOUNT_REASON_MAX}
                placeholder="Ej.: cliente frecuente"
                disabled={isPending}
                className={FIELD}
              />
            </div>
          )}
          {!validNumbers && <ErrorText>Escribe los montos en pesos, por ejemplo 150 o 150.50.</ErrorText>}
          {discountTooBig && <ErrorText>El descuento no puede ser mayor que el subtotal.</ErrorText>}

          {/* Total */}
          <div className="flex items-baseline justify-between border-y border-border py-3">
            <span className="text-label font-sans uppercase tracking-label text-muted">Total a cobrar</span>
            <span className="font-display text-3xl tabular-nums text-foreground">
              {total !== null ? formatPrice(total, currency) : "—"}
            </span>
          </div>

          {/* Pago */}
          {isCourtesy ? (
            <p className="text-sm font-sans text-muted">Cortesía: no se registra ningún pago.</p>
          ) : (
            <fieldset className="space-y-3">
              <legend className={LABEL}>Pago (toca varios para dividirlo)</legend>
              <div className="grid grid-cols-3 gap-2">
                {PAYMENT_METHODS.map((m) => {
                  const on = methods.includes(m);
                  return (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleMethod(m)}
                      disabled={isPending}
                      className={cn(
                        "min-h-11 rounded-button border px-2 py-2.5 text-sm font-sans font-medium transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.97]",
                        on ? "border-accent bg-accent/15 text-accent" : "border-border text-foreground hover:border-accent/50"
                      )}
                    >
                      {PAYMENT_METHOD_LABELS[m]}
                    </button>
                  );
                })}
              </div>

              {methods.length > 1 && (
                <div className="space-y-2">
                  {methods.map((m) => (
                    <div key={m} className="flex items-center gap-3">
                      <label htmlFor={`pay-${m}-${appointmentId}`} className="w-28 shrink-0 text-sm font-sans text-muted">
                        {PAYMENT_METHOD_LABELS[m]}
                      </label>
                      <input
                        id={`pay-${m}-${appointmentId}`}
                        type="text"
                        inputMode="decimal"
                        value={amounts[m] ?? ""}
                        onChange={(e) => setAmounts((prev) => ({ ...prev, [m]: e.target.value }))}
                        placeholder="0"
                        disabled={isPending}
                        className={cn(FIELD, "tabular-nums")}
                      />
                    </div>
                  ))}
                  {total !== null && (
                    <p
                      className={cn(
                        "text-sm font-sans tabular-nums",
                        remaining === 0 && paymentsValid ? "text-accent" : "text-amber-300"
                      )}
                      aria-live="polite"
                    >
                      {remaining === 0 && paymentsValid
                        ? "Los pagos cuadran con el total."
                        : remaining > 0
                          ? `Falta asignar ${formatPrice(remaining, currency)}`
                          : remaining < 0
                            ? `Sobran ${formatPrice(-remaining, currency)}`
                            : "Cada pago debe ser mayor a $0."}
                    </p>
                  )}
                </div>
              )}
            </fieldset>
          )}

          {error && <ErrorText>{error}</ErrorText>}

          <button type="submit" disabled={!canSubmit} className={PRIMARY}>
            {isPending
              ? "Guardando…"
              : total !== null
                ? `${mode === "complete" ? "Completar y cobrar" : "Cobrar"} ${formatPrice(total, currency)}`
                : label}
          </button>
        </form>
      </Dialog>
    </>
  );
}

function MoneyField({
  id,
  label,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={LABEL}>{label}</label>
      <div className="relative">
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-body font-sans text-muted">$</span>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0"
          disabled={disabled}
          className={cn(FIELD, "pl-8 tabular-nums")}
        />
      </div>
    </div>
  );
}
