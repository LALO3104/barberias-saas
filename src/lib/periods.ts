/**
 * Periodos de reporte (día, semana lunes–domingo, mes) sobre fechas locales
 * "YYYY-MM-DD" de la barbería. Aritmética de calendario pura (sin zona).
 */

import { addDaysToKey, formatShortDay } from "@/lib/appointments";

export type PeriodView = "dia" | "semana" | "mes";

export const PERIOD_LABELS: Record<PeriodView, string> = {
  dia: "Día",
  semana: "Semana",
  mes: "Mes",
};

export function isPeriodView(value: unknown): value is PeriodView {
  return value === "dia" || value === "semana" || value === "mes";
}

function parts(key: string): [number, number, number] {
  const [y, m, d] = key.split("-").map(Number);
  return [y, m, d];
}

function toKey(y: number, m: number, d: number): string {
  return new Date(Date.UTC(y, m - 1, d, 12)).toISOString().slice(0, 10);
}

/** Rango [from, to] (ambos incluidos) del periodo que contiene `anchor`. */
export function periodRange(view: PeriodView, anchor: string): { from: string; to: string } {
  if (view === "dia") return { from: anchor, to: anchor };
  const [y, m, d] = parts(anchor);
  if (view === "semana") {
    const dow = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay(); // 0 = domingo
    const from = addDaysToKey(anchor, dow === 0 ? -6 : 1 - dow);
    return { from, to: addDaysToKey(from, 6) };
  }
  return { from: toKey(y, m, 1), to: toKey(y, m + 1, 0) };
}

/** Ancla del periodo anterior (-1) o siguiente (+1). */
export function shiftPeriod(view: PeriodView, anchor: string, step: -1 | 1): string {
  if (view === "dia") return addDaysToKey(anchor, step);
  if (view === "semana") return addDaysToKey(anchor, step * 7);
  const [y, m] = parts(anchor);
  return toKey(y, m + step, 1);
}

/** "25 oct" · "20 – 26 oct" · "octubre de 2026". */
export function periodLabel(view: PeriodView, from: string, to: string): string {
  if (view === "dia") return formatShortDay(from);
  if (view === "semana") return `${formatShortDay(from)} – ${formatShortDay(to)}`;
  const [y, m] = parts(from);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("es-MX", { timeZone: "UTC", month: "long", year: "numeric" });
}
