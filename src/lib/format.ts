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
 * Formatea un timestamptz ISO a hora local (24 h) en la timezone del tenant.
 * Ejemplo: formatSlotTime("2026-10-03T15:30:00Z", "America/Mexico_City") → "09:30"
 */
export function formatSlotTime(isoString: string, timezone: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString("es-MX", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

// ─── Agrupación de horarios por hora ────────────────────────────────────────

/** Un horario reservable dentro de un grupo de hora. */
export interface HourSlot {
  /** timestamptz ISO tal como lo devolvió el backend (se envía sin tocar). */
  iso: string;
  /** Hora local del tenant en formato 24 h, p. ej. "10:05". */
  label: string;
}

/** Tramo consecutivo de horarios que comparten la misma hora local. */
export interface SlotHourGroup {
  /**
   * Clave única y estable entre recargas: el instante (ms epoch) en que
   * empieza esa hora local. No depende de qué minutos sigan libres.
   */
  key: string;
  /** Etiqueta de la hora, p. ej. "10:00" (con desfase UTC si se repite). */
  hourLabel: string;
  slots: HourSlot[];
}

/**
 * Agrupa los horarios devueltos por `get_available_slots` por hora local
 * del tenant, para mostrarlos como "hora → minutos".
 *
 * NO calcula disponibilidad: solo reorganiza lo que el backend ya filtró.
 *
 * - La hora y los minutos salen de `Intl.DateTimeFormat` con la `timeZone`
 *   del tenant y `hourCycle: "h23"` (nunca de la zona del navegador).
 * - Se agrupan TRAMOS CONSECUTIVOS, no un Map por etiqueta: en un cambio de
 *   horario que repite una hora (p. ej. 01:00–01:59 dos veces), cada
 *   repetición queda en su propio grupo y no se mezclan instantes distintos.
 *   Si una etiqueta se repite, se le agrega el desfase UTC para distinguirla.
 * - Valores que no sean fechas válidas se ignoran.
 */
export function groupSlotsByHour(
  slots: readonly string[],
  timezone: string
): SlotHourGroup[] {
  const formatter = new Intl.DateTimeFormat("es-MX", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parsed = slots
    .map((iso) => ({ iso, time: new Date(iso).getTime() }))
    .filter((s) => Number.isFinite(s.time))
    .sort((a, b) => a.time - b.time);

  const groups: (SlotHourGroup & { hourStart: number; hour: string })[] = [];

  for (const { iso, time } of parsed) {
    const parts = formatter.formatToParts(new Date(time));
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((p) => p.type === type)?.value ?? "00";
    // Algunos motores devuelven "24" para medianoche aun con h23.
    const hour = get("hour") === "24" ? "00" : get("hour");
    const minute = get("minute");
    const second = Number(get("second"));
    // Instante en que empieza esta hora local: distingue horas repetidas.
    const wholeSecond = time - (((time % 1000) + 1000) % 1000);
    const hourStart = wholeSecond - (Number(minute) * 60 + second) * 1000;

    const last = groups[groups.length - 1];
    if (last && last.hour === hour && last.hourStart === hourStart) {
      last.slots.push({ iso, label: `${hour}:${minute}` });
    } else {
      groups.push({
        key: String(hourStart),
        hour,
        hourStart,
        hourLabel: `${hour}:00`,
        slots: [{ iso, label: `${hour}:${minute}` }],
      });
    }
  }

  // Desambiguar etiquetas repetidas (solo ocurre en cambios de horario).
  const labelCount = new Map<string, number>();
  for (const g of groups) {
    labelCount.set(g.hourLabel, (labelCount.get(g.hourLabel) ?? 0) + 1);
  }

  return groups.map(({ key, hourLabel, slots: groupSlots, hourStart }) => {
    const offset =
      (labelCount.get(hourLabel) ?? 0) > 1
        ? getUtcOffsetLabel(hourStart, timezone)
        : "";
    return {
      key,
      hourLabel: offset ? `${hourLabel} (${offset})` : hourLabel,
      slots: groupSlots,
    };
  });
}

/** Desfase UTC corto de un instante en la zona dada, p. ej. "GMT-6". */
function getUtcOffsetLabel(time: number, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("es-MX", {
      timeZone: timezone,
      timeZoneName: "shortOffset",
    }).formatToParts(new Date(time));
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
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
 * Formatea un horario time (HH:MM:SS) a 24 h.
 * Ejemplo: formatTimeString("09:00:00") → "09:00"
 */
function formatTimeString(time: string): string {
  const [h, m] = time.split(":");
  return `${h.padStart(2, "0")}:${(m ?? "00").padStart(2, "0")}`;
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
/**
 * Pesos escritos por el usuario → centavos enteros, sin punto flotante.
 * "150", "150.5", "150,50" → 15000, 15050, 15050. Vacío → 0. Inválido → null.
 */
export function parsePesosToCents(raw: string): number | null {
  const trimmed = raw.trim().replace(",", ".");
  if (!trimmed) return 0;
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(trimmed)) return null;
  const [intPart, decPart = ""] = trimmed.split(".");
  return Number(intPart) * 100 + Number(decPart.padEnd(2, "0"));
}

/** Centavos → texto para un campo de pesos: 15000 → "150", 15050 → "150.50". */
export function centsToPesosInput(cents: number): string {
  const pesos = Math.floor(cents / 100);
  const rest = cents % 100;
  return rest === 0 ? String(pesos) : `${pesos}.${String(rest).padStart(2, "0")}`;
}
