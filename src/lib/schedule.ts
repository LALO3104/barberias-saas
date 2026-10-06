/**
 * Horarios semanales (Step 8).
 *
 * Lógica pura, sin dependencias de servidor ni de React: la usan las Server
 * Actions (validación autoritativa) y el editor del dashboard (validación
 * previa, para dar feedback antes de enviar).
 *
 * Modelo (tablas business_hours / barber_working_hours):
 *   - una fila por intervalo; varios intervalos por día = turno partido;
 *   - día sin filas = cerrado;
 *   - day_of_week ISO: 1 = lunes … 7 = domingo;
 *   - las horas son hora LOCAL de tenants.timezone (columna `time`), nunca UTC
 *     y nunca la zona del navegador.
 */

// ─── Tipos ───────────────────────────────────────────────────────────────────

/** Intervalo en formato estricto "HH:mm" (24 h). */
export interface TimeInterval {
  start: string;
  end: string;
}

export interface DaySchedule {
  /** ISO: 1 = lunes … 7 = domingo */
  day: number;
  /** false = cerrado (los intervalos se conservan en el editor pero no se guardan) */
  enabled: boolean;
  intervals: TimeInterval[];
}

export type WeekSchedule = DaySchedule[];

/** Fila tal como viene de Supabase (`time` → "HH:MM:SS"). */
export type HoursRow = {
  day_of_week: number;
  opens_at: string;
  closes_at: string;
};

/** Fila lista para enviarse a set_business_hours / set_barber_working_hours. */
export type HoursIntervalInput = {
  day_of_week: number;
  opens_at: string;
  closes_at: string;
};

export type WeekValidation =
  | { ok: true; intervals: HoursIntervalInput[] }
  | { ok: false; error: string };

// ─── Constantes ──────────────────────────────────────────────────────────────

export const WEEK_DAYS: { day: number; label: string }[] = [
  { day: 1, label: "Lunes" },
  { day: 2, label: "Martes" },
  { day: 3, label: "Miércoles" },
  { day: 4, label: "Jueves" },
  { day: 5, label: "Viernes" },
  { day: 6, label: "Sábado" },
  { day: 7, label: "Domingo" },
];

/** Suficiente para turnos partidos; evita payloads absurdos. */
export const MAX_INTERVALS_PER_DAY = 4;

export const DEFAULT_INTERVAL: TimeInterval = { start: "09:00", end: "18:00" };

/** "HH:mm" estricto: 00–23 y 00–59, siempre con dos dígitos. */
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const LAST_MINUTE = 23 * 60 + 59;

// ─── Utilidades de hora ──────────────────────────────────────────────────────

export function isValidTime(value: unknown): value is string {
  return typeof value === "string" && TIME_RE.test(value);
}

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":");
  return Number(h) * 60 + Number(m);
}

export function minutesToTime(minutes: number): string {
  const clamped = Math.max(0, Math.min(LAST_MINUTE, minutes));
  const h = String(Math.floor(clamped / 60)).padStart(2, "0");
  const m = String(clamped % 60).padStart(2, "0");
  return `${h}:${m}`;
}

export function dayLabel(day: number): string {
  return WEEK_DAYS.find((d) => d.day === day)?.label ?? `Día ${day}`;
}

/**
 * Intervalo sugerido al pulsar "Agregar intervalo": empieza donde termina el
 * último y dura una hora. Devuelve null si ya no cabe otro en el día.
 */
export function nextIntervalAfter(intervals: TimeInterval[]): TimeInterval | null {
  if (intervals.length === 0) return { ...DEFAULT_INTERVAL };
  const last = intervals[intervals.length - 1];
  if (!isValidTime(last.end)) return null;
  const start = timeToMinutes(last.end);
  if (start >= LAST_MINUTE) return null;
  return {
    start: minutesToTime(start),
    end: minutesToTime(Math.min(start + 60, LAST_MINUTE)),
  };
}

// ─── Conversión DB ↔ editor ──────────────────────────────────────────────────

/** Semana con los 7 días cerrados. */
export function emptyWeek(): WeekSchedule {
  return WEEK_DAYS.map(({ day }) => ({ day, enabled: false, intervals: [] }));
}

/** Convierte filas de Supabase a la semana del editor (7 días, ordenada). */
export function rowsToWeek(rows: HoursRow[]): WeekSchedule {
  return WEEK_DAYS.map(({ day }) => {
    const intervals = rows
      .filter((r) => r.day_of_week === day)
      .map((r) => ({ start: r.opens_at.slice(0, 5), end: r.closes_at.slice(0, 5) }))
      .sort((a, b) => a.start.localeCompare(b.start));
    return { day, enabled: intervals.length > 0, intervals };
  });
}

/**
 * Representación canónica de lo que realmente se guardaría (días abiertos y
 * sus intervalos ordenados). Sirve para detectar cambios sin guardar.
 */
export function serializeWeek(week: WeekSchedule): string {
  return JSON.stringify(
    [...week]
      .sort((a, b) => a.day - b.day)
      .filter((d) => d.enabled)
      .map((d) => [
        d.day,
        [...d.intervals]
          .sort((a, b) => a.start.localeCompare(b.start))
          .map((i) => `${i.start}-${i.end}`),
      ])
  );
}

// ─── Validación estricta ─────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Valida una semana recibida como `unknown` (nunca se confía en el tipo que
 * declara el cliente) y la convierte en filas para la base de datos.
 *
 * Rechaza: estructura inválida, días fuera de 1..7 o repetidos, horas que no
 * sean "HH:mm" estricto (p. ej. "9", "9:0", "25:00", "12:60", "abc"),
 * inicio >= fin, intervalos solapados o duplicados, días abiertos sin
 * intervalos y más de MAX_INTERVALS_PER_DAY intervalos por día.
 *
 * Intervalos contiguos (09:00–13:00 y 13:00–15:00) son válidos, igual que en
 * la exclusion constraint de la base ([) semiabierto).
 */
export function validateWeek(input: unknown): WeekValidation {
  if (!Array.isArray(input) || input.length > WEEK_DAYS.length) {
    return { ok: false, error: "El horario enviado no tiene un formato válido." };
  }

  const seenDays = new Set<number>();
  const result: HoursIntervalInput[] = [];

  for (const rawDay of input) {
    if (!isRecord(rawDay)) {
      return { ok: false, error: "El horario enviado no tiene un formato válido." };
    }

    const day = rawDay.day;
    if (typeof day !== "number" || !Number.isInteger(day) || day < 1 || day > 7) {
      return { ok: false, error: "El horario contiene un día inválido." };
    }
    if (seenDays.has(day)) {
      return { ok: false, error: `${dayLabel(day)} aparece más de una vez.` };
    }
    seenDays.add(day);

    if (typeof rawDay.enabled !== "boolean" || !Array.isArray(rawDay.intervals)) {
      return { ok: false, error: "El horario enviado no tiene un formato válido." };
    }

    // Día cerrado: sus intervalos (si los hay en el editor) no se guardan.
    if (!rawDay.enabled) continue;

    const label = dayLabel(day);

    if (rawDay.intervals.length === 0) {
      return {
        ok: false,
        error: `${label}: agrega al menos un intervalo o marca el día como cerrado.`,
      };
    }
    if (rawDay.intervals.length > MAX_INTERVALS_PER_DAY) {
      return {
        ok: false,
        error: `${label}: máximo ${MAX_INTERVALS_PER_DAY} intervalos por día.`,
      };
    }

    const intervals: TimeInterval[] = [];
    for (const rawInterval of rawDay.intervals) {
      if (!isRecord(rawInterval)) {
        return { ok: false, error: `${label}: hay un intervalo inválido.` };
      }
      const { start, end } = rawInterval;
      if (!isValidTime(start) || !isValidTime(end)) {
        return {
          ok: false,
          error: `${label}: las horas deben tener el formato HH:mm (por ejemplo 09:00).`,
        };
      }
      if (timeToMinutes(start) >= timeToMinutes(end)) {
        return {
          ok: false,
          error: `${label}: la hora de cierre (${end}) debe ser posterior a la de apertura (${start}).`,
        };
      }
      intervals.push({ start, end });
    }

    intervals.sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));

    for (let i = 1; i < intervals.length; i++) {
      const prev = intervals[i - 1];
      const curr = intervals[i];
      if (timeToMinutes(curr.start) < timeToMinutes(prev.end)) {
        return {
          ok: false,
          error: `${label}: los intervalos ${prev.start}–${prev.end} y ${curr.start}–${curr.end} se solapan.`,
        };
      }
    }

    for (const interval of intervals) {
      result.push({
        day_of_week: day,
        opens_at: interval.start,
        closes_at: interval.end,
      });
    }
  }

  return { ok: true, intervals: result };
}
