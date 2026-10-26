"use client";

import { useState, useTransition } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { cn } from "@/lib/utils";
import { centsToPesosInput, parsePesosToCents } from "@/lib/format";
import {
  SALARY_PERIODS,
  SALARY_PERIOD_LABELS,
  bpsToPercent,
  describeCompensation,
  parsePercentToBps,
  type Compensation,
  type PayType,
  type SalaryPeriod,
} from "@/lib/compensation";
import { setBarberCompensationAction } from "@/app/(dashboard)/dashboard/barberos/actions";
import { ErrorText, FIELD, LABEL, PRIMARY } from "@/components/dashboard/appointments/AppointmentFormParts";

interface CompensationButtonProps {
  barberId: string;
  barberName: string;
  compensation: Compensation | null;
  currency: string;
}

/** Botón "Pago" + panel para elegir comisión (%) o salario fijo (monto + periodo). */
export function CompensationButton({ barberId, barberName, compensation, currency }: CompensationButtonProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [payType, setPayType] = useState<PayType>("commission");
  const [percent, setPercent] = useState("");
  const [salary, setSalary] = useState("");
  const [period, setPeriod] = useState<SalaryPeriod>("weekly");
  const [error, setError] = useState<string | null>(null);

  function openSheet() {
    setPayType(compensation?.payType ?? "commission");
    setPercent(compensation?.commissionRateBps != null ? bpsToPercent(compensation.commissionRateBps) : "");
    setSalary(compensation?.salaryCents != null ? centsToPesosInput(compensation.salaryCents) : "");
    setPeriod(compensation?.salaryPeriod ?? "weekly");
    setError(null);
    setOpen(true);
  }

  const bps = parsePercentToBps(percent);
  const salaryCents = parsePesosToCents(salary);
  const valid = payType === "commission" ? bps !== null : salaryCents !== null && salaryCents > 0;

  function submit() {
    if (!valid || isPending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await setBarberCompensationAction(
          payType === "commission"
            ? { barberId, payType, commissionRateBps: bps }
            : { barberId, payType, salaryCents, salaryPeriod: period }
        );
        if (result.error) {
          setError(result.error);
          return;
        }
        setOpen(false);
      } catch {
        setError("No se pudo conectar. Revisa tu conexión e intenta de nuevo.");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={openSheet}
        className="inline-flex items-center gap-1.5 rounded-button border border-border px-3 py-1.5 text-xs font-sans text-foreground transition-[background-color,transform] duration-150 ease-out hover:bg-border/50 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        Pago
      </button>

      <Dialog open={open} onClose={() => !isPending && setOpen(false)} title={`Pago de ${barberName}`}>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <p className="text-sm font-sans text-muted">
            Actual: <span className="text-foreground">{describeCompensation(compensation, currency)}</span>. Los cambios
            aplican a los cobros nuevos; las propinas siempre son 100 % del barbero.
          </p>

          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Tipo de pago">
            {(
              [
                { value: "commission", label: "Comisión", hint: "% de lo cobrado" },
                { value: "salary", label: "Salario fijo", hint: "sin comisión" },
              ] as const
            ).map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={payType === o.value}
                onClick={() => setPayType(o.value)}
                disabled={isPending}
                className={cn(
                  "flex min-h-16 flex-col items-center justify-center rounded-card border px-3 py-3 font-sans transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.97]",
                  payType === o.value ? "border-accent bg-accent/15 text-accent" : "border-border text-foreground hover:border-accent/50"
                )}
              >
                <span className="text-body font-semibold">{o.label}</span>
                <span className="text-xs text-muted">{o.hint}</span>
              </button>
            ))}
          </div>

          {payType === "commission" ? (
            <div>
              <label htmlFor={`rate-${barberId}`} className={LABEL}>
                Comisión sobre lo cobrado por servicios (sin propina)
              </label>
              <div className="relative">
                <input
                  id={`rate-${barberId}`}
                  type="text"
                  inputMode="decimal"
                  value={percent}
                  onChange={(e) => setPercent(e.target.value)}
                  placeholder="40"
                  disabled={isPending}
                  className={cn(FIELD, "pr-10 tabular-nums")}
                />
                <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-body font-sans text-muted">%</span>
              </div>
              {percent.trim() !== "" && bps === null && <ErrorText>Escribe un porcentaje entre 0 y 100.</ErrorText>}
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label htmlFor={`salary-${barberId}`} className={LABEL}>Salario</label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-body font-sans text-muted">$</span>
                  <input
                    id={`salary-${barberId}`}
                    type="text"
                    inputMode="decimal"
                    value={salary}
                    onChange={(e) => setSalary(e.target.value)}
                    placeholder="3000"
                    disabled={isPending}
                    className={cn(FIELD, "pl-8 tabular-nums")}
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Periodo del salario">
                {SALARY_PERIODS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    role="radio"
                    aria-checked={period === p}
                    onClick={() => setPeriod(p)}
                    disabled={isPending}
                    className={cn(
                      "min-h-11 rounded-button border px-2 py-2.5 text-sm font-sans capitalize transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.97]",
                      period === p ? "border-accent bg-accent/15 text-accent" : "border-border text-foreground hover:border-accent/50"
                    )}
                  >
                    {SALARY_PERIOD_LABELS[p]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && <ErrorText>{error}</ErrorText>}

          <button type="submit" disabled={!valid || isPending} className={PRIMARY}>
            {isPending ? "Guardando…" : "Guardar"}
          </button>
        </form>
      </Dialog>
    </>
  );
}
