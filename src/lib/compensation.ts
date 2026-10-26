/**
 * Compensación de barberos (Step 13) — lógica pura compartida.
 *
 * Reglas autoritativas en la base de datos (barber_compensation,
 * charge_appointment, record_barber_payout). Comisión en puntos base
 * (4000 = 40 %); dinero en centavos.
 */

import { formatPrice } from "@/lib/format";

export type PayType = "commission" | "salary";
export type SalaryPeriod = "weekly" | "biweekly" | "monthly";

export const SALARY_PERIODS: SalaryPeriod[] = ["weekly", "biweekly", "monthly"];

export const SALARY_PERIOD_LABELS: Record<SalaryPeriod, string> = {
  weekly: "semanal",
  biweekly: "quincenal",
  monthly: "mensual",
};

export interface Compensation {
  payType: PayType;
  commissionRateBps: number | null;
  salaryCents: number | null;
  salaryPeriod: SalaryPeriod | null;
}

export function isPayType(value: unknown): value is PayType {
  return value === "commission" || value === "salary";
}

export function isSalaryPeriod(value: unknown): value is SalaryPeriod {
  return typeof value === "string" && (SALARY_PERIODS as string[]).includes(value);
}

/** "40" → 4000 · "33.33" → 3333 · "7,5" → 750. Fuera de 0–100 o inválido → null. */
export function parsePercentToBps(raw: string): number | null {
  const trimmed = raw.trim().replace(",", ".");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(trimmed)) return null;
  const [intPart, decPart = ""] = trimmed.split(".");
  const bps = Number(intPart) * 100 + Number(decPart.padEnd(2, "0"));
  return bps <= 10000 ? bps : null;
}

/** 4000 → "40" · 3333 → "33.33" · 750 → "7.5". */
export function bpsToPercent(bps: number): string {
  const whole = Math.floor(bps / 100);
  const rest = bps % 100;
  if (rest === 0) return String(whole);
  return `${whole}.${String(rest).padStart(2, "0").replace(/0$/, "")}`;
}

/** "Comisión 40 %" · "Salario $3,000.00 semanal" · "Sin pago configurado". */
export function describeCompensation(comp: Compensation | null | undefined, currency: string): string {
  if (!comp) return "Sin pago configurado";
  if (comp.payType === "commission" && comp.commissionRateBps !== null) {
    return `Comisión ${bpsToPercent(comp.commissionRateBps)} %`;
  }
  if (comp.payType === "salary" && comp.salaryCents !== null && comp.salaryPeriod) {
    return `Salario ${formatPrice(comp.salaryCents, currency)} ${SALARY_PERIOD_LABELS[comp.salaryPeriod]}`;
  }
  return "Sin pago configurado";
}
