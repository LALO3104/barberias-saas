/**
 * Utilidades de formateo para la vista pública.
 */

/**
 * Formatea centavos a moneda local. El tenant provee la moneda (ISO 4217).
 * Ejemplo: formatPrice(25000, "MXN") → "$250.00"
 */
export function formatPrice(cents: number, currency: string): string {
  const amount = cents / 100;
  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    // Fallback si la moneda no es reconocida
    return `$${amount.toFixed(0)}`;
  }
}

/**
 * Formatea duración en minutos a texto legible.
 * Ejemplo: formatDuration(90) → "1 h 30 min"
 */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

/**
 * Formatea un timestamptz ISO a hora local en la timezone del tenant.
 * Ejemplo: formatSlotTime("2026-10-03T15:30:00Z", "America/Mexico_City") → "9:30 AM"
 */
export function formatSlotTime(isoString: string, timezone: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString("es-MX", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * Formatea un timestamptz ISO a fecha legible en la timezone del tenant.
 * Ejemplo: formatSlotDate("2026-10-03T15:30:00Z", "America/Mexico_City") → "sábado 3 de octubre"
 */
export function formatSlotDate(isoString: string, timezone: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString("es-MX", {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

/**
 * Devuelve la fecha de hoy en la timezone del tenant como YYYY-MM-DD.
 */
export function getTodayInTimezone(timezone: string): string {
  const now = new Date();
  const parts = now
    .toLocaleDateString("en-CA", { timeZone: timezone })
    .split("-");
  // en-CA format is YYYY-MM-DD
  return parts.join("-");
}

/**
 * Genera un array con las próximas N fechas (incluyendo hoy) en la timezone del tenant.
 * Devuelve cada fecha como { value: "YYYY-MM-DD", label: "lun 3 oct" }.
 */
export function getUpcomingDates(
  timezone: string,
  count: number = 14
): { value: string; label: string; isToday: boolean }[] {
  const today = getTodayInTimezone(timezone);
  const dates: { value: string; label: string; isToday: boolean }[] = [];

  for (let i = 0; i < count; i++) {
    const date = new Date(`${today}T12:00:00Z`); // mediodía UTC explícito
    date.setUTCDate(date.getUTCDate() + i);
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, "0");
    const d = String(date.getUTCDate()).padStart(2, "0");
    const value = `${y}-${m}-${d}`;
    const label = date.toLocaleDateString("es-MX", {
      timeZone: "UTC",
      weekday: "short",
      day: "numeric",
      month: "short",
    });
    dates.push({ value, label, isToday: i === 0 });
  }

  return dates;
}

/**
 * Nombre del día de la semana ISO (1=lunes … 7=domingo).
 */
const DAY_NAMES: Record<number, string> = {
  1: "Lunes",
  2: "Martes",
  3: "Miércoles",
  4: "Jueves",
  5: "Viernes",
  6: "Sábado",
  7: "Domingo",
};

/**
 * Formatea un horario time (HH:MM:SS) a formato legible.
 * Ejemplo: formatTimeString("09:00:00") → "9:00 AM"
 */
function formatTimeString(time: string): string {
  const [h, m] = time.split(":");
  const hour = parseInt(h, 10);
  const minute = m ?? "00";
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${h12}:${minute} ${ampm}`;
}

/**
 * Agrupa business_hours por día y devuelve un resumen legible.
 */
export function formatBusinessHours(
  hours: { day_of_week: number; opens_at: string; closes_at: string }[]
): { day: string; hours: string }[] {
  if (!hours.length) return [];

  const byDay = new Map<number, string[]>();
  for (const h of hours) {
    const existing = byDay.get(h.day_of_week) ?? [];
    existing.push(`${formatTimeString(h.opens_at)} – ${formatTimeString(h.closes_at)}`);
    byDay.set(h.day_of_week, existing);
  }

  const result: { day: string; hours: string }[] = [];
  for (let d = 1; d <= 7; d++) {
    const slots = byDay.get(d);
    result.push({
      day: DAY_NAMES[d],
      hours: slots ? slots.join(", ") : "Cerrado",
    });
  }

  return result;
}