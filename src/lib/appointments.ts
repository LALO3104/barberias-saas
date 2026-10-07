/**
 * Citas (Step 9) — lógica pura compartida por servidor y cliente.
 *
 * Las reglas autoritativas viven en la base de datos:
 *   - trigger appointments_enforce_status_transition
 *   - función public.set_appointment_status
 * Aquí solo se replican para decidir qué botones mostrar y validar entradas
 * antes de llamar al servidor.
 *
 * Fechas: las citas son timestamptz. "Un día" siempre es el día local del
 * tenant (tenants.timezone), nunca el del navegador ni UTC.
 */

import type { Database } from "@/types/supabase";

// ─── Estados ─────────────────────────────────────────────────────────────────

export type AppointmentStatus = Database["public"]["Enums"]["appointment_status"];

export const APPOINTMENT_STATUSES: AppointmentStatus[] = [
  "pending",
  "confirmed",
  "completed",
  "cancelled",
  "no_show",
];

export function isAppointmentStatus(value: unknown): value is AppointmentStatus {
  return (
    typeof value === "string" &&
    (APPOINTMENT_STATUSES as string[]).includes(value)
  );
}

export const STATUS_LABELS: Record<AppointmentStatus, string> = {
  pending: "Pendiente",
  confirmed: "Confirmada",
  completed: "Completada",
  cancelled: "Cancelada",
  no_show: "No se presentó",
};

const STATUS_COUNT_LABELS: Record<AppointmentStatus, [singular: string, plural: string]> = {
  pending: ["pendiente", "pendientes"],
  confirmed: ["confirmada", "confirmadas"],
  completed: ["completada", "completadas"],
  cancelled: ["cancelada", "canceladas"],
  no_show: ["no se presentó", "no se presentaron"],
};

/** "1 confirmada", "3 confirmadas". */
export function formatStatusCount(status: AppointmentStatus, count: number): string {
  const [singular, plural] = STATUS_COUNT_LABELS[status];
  return `${count} ${count === 1 ? singular : plural}`;
}

/** Mismo flujo que la base de datos (migración appointment_status). */
export const ALLOWED_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  pending: ["confirmed", "cancelled", "no_show"],
  confirmed: ["completed", "cancelled", "no_show"],
  completed: [],
  cancelled: [],
  no_show: [],
};

export function canTransition(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Estados a los que una acción del dashboard puede llevar una cita. */
export type TargetStatus = "confirmed" | "completed" | "cancelled" | "no_show";

export function isTargetStatus(value: unknown): value is TargetStatus {
  return (
    value === "confirmed" ||
    value === "completed" ||
    value === "cancelled" ||
    value === "no_show"
  );
}

export const ACTION_LABELS: Record<TargetStatus, string> = {
  confirmed: "Confirmar",
  completed: "Completar",
  cancelled: "Cancelar",
  no_show: "No se presentó",
};

export const CANCEL_REASON_MAX = 500;

// ─── Fechas en la zona horaria del tenant ────────────────────────────────────

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" válido (rechaza 2026-02-30, etc.). */
export function isDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_KEY_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

/** Suma días a una fecha "YYYY-MM-DD" (aritmética de calendario, sin zona). */
export function addDaysToKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days, 12));
  return date.toISOString().slice(0, 10);
}

/** Desfase (ms) de una zona IANA en un instante dado. */
function timezoneOffsetMs(utcMs: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second")
  );
  return asUtc - utcMs;
}

/**
 * Instante UTC de la medianoche local de `key` en `timezone`.
 * Ej.: ("2026-10-07", "America/Mexico_City") → 2026-10-07T06:00:00.000Z
 * Corrige una segunda vez para días con cambio de horario.
 */
export function zonedDayStartUtc(key: string, timezone: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  let ts = guess - timezoneOffsetMs(guess, timezone);
  ts = guess - timezoneOffsetMs(ts, timezone);
  return new Date(ts);
}

/** Fecha local "YYYY-MM-DD" de un instante en la zona del tenant. */
export function dateKeyInTimezone(iso: string, timezone: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: timezone });
}

/** "Martes, 7 de octubre" para una fecha "YYYY-MM-DD" (solo la inicial en mayúscula). */
export function formatDayHeading(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const text = new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("es-MX", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "7 oct" para encabezados compactos. */
export function formatShortDay(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("es-MX", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
  });
}

/** "9:30" en 24 h, en la zona del tenant (compacto para la agenda). */
export function formatClock(iso: string, timezone: string): string {
  return new Date(iso).toLocaleTimeString("es-MX", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Minutos entre dos instantes. */
export function minutesBetween(startIso: string, endIso: string): number {
  return Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000);
}

/** "+525512345678" → "55 1234 5678" (solo números mexicanos; el resto, tal cual). */
export function formatPhoneDisplay(phone: string): string {
  const mx = /^\+52(\d{2})(\d{4})(\d{4})$/.exec(phone);
  return mx ? `${mx[1]} ${mx[2]} ${mx[3]}` : phone;
}

// ─── Vistas de la agenda ─────────────────────────────────────────────────────

export type AgendaView = "dia" | "semana";

export const VIEW_DAYS: Record<AgendaView, number> = { dia: 1, semana: 7 };

export function isAgendaView(value: unknown): value is AgendaView {
  return value === "dia" || value === "semana";
}
