"use client";

import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import {
  DEFAULT_INTERVAL,
  MAX_INTERVALS_PER_DAY,
  dayLabel,
  nextIntervalAfter,
  serializeWeek,
  validateWeek,
  type DaySchedule,
  type TimeInterval,
  type WeekSchedule,
} from "@/lib/schedule";
import type { ScheduleActionState } from "@/app/(dashboard)/dashboard/horarios/actions";

interface WeekScheduleEditorProps {
  initialWeek: WeekSchedule;
  /** Guarda la semana completa. La validación autoritativa vive en el servidor. */
  onSave: (week: WeekSchedule) => Promise<ScheduleActionState>;
  /** Permite copiar otra semana como punto de partida (p. ej. la de la barbería). */
  copyFrom?: { label: string; week: WeekSchedule };
  saveLabel?: string;
}

const TIME_INPUT_CLASS =
  "block w-full min-w-0 rounded-button border border-border bg-background px-3 py-2 text-sm font-sans text-foreground [color-scheme:dark] focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50";

function cloneWeek(week: WeekSchedule): WeekSchedule {
  return week.map((d) => ({ ...d, intervals: d.intervals.map((i) => ({ ...i })) }));
}

/**
 * Editor de una semana de horarios: 7 días, cada uno abierto/cerrado con uno
 * o varios intervalos (turno partido). Guarda la semana completa de una vez.
 */
export function WeekScheduleEditor({
  initialWeek,
  onSave,
  copyFrom,
  saveLabel = "Guardar horario",
}: WeekScheduleEditorProps) {
  const [week, setWeek] = useState<WeekSchedule>(() => cloneWeek(initialWeek));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  const isDirty = serializeWeek(week) !== serializeWeek(initialWeek);

  function updateDay(day: number, updater: (d: DaySchedule) => DaySchedule) {
    setWeek((current) => current.map((d) => (d.day === day ? updater(d) : d)));
    setError(null);
    setSaved(false);
  }

  function toggleDay(day: number) {
    updateDay(day, (d) => {
      const enabled = !d.enabled;
      const intervals =
        enabled && d.intervals.length === 0 ? [{ ...DEFAULT_INTERVAL }] : d.intervals;
      return { ...d, enabled, intervals };
    });
  }

  function updateInterval(
    day: number,
    index: number,
    field: keyof TimeInterval,
    value: string
  ) {
    updateDay(day, (d) => ({
      ...d,
      intervals: d.intervals.map((iv, i) => (i === index ? { ...iv, [field]: value } : iv)),
    }));
  }

  function addInterval(day: number) {
    updateDay(day, (d) => {
      const next = nextIntervalAfter(d.intervals);
      return next ? { ...d, intervals: [...d.intervals, next] } : d;
    });
  }

  function removeInterval(day: number, index: number) {
    updateDay(day, (d) => {
      const intervals = d.intervals.filter((_, i) => i !== index);
      // Sin intervalos, el día queda cerrado.
      return { ...d, intervals, enabled: intervals.length > 0 && d.enabled };
    });
  }

  function handleReset() {
    setWeek(cloneWeek(initialWeek));
    setError(null);
    setSaved(false);
  }

  function handleCopy() {
    if (!copyFrom) return;
    setWeek(cloneWeek(copyFrom.week));
    setError(null);
    setSaved(false);
  }

  function handleSave() {
    // Validación previa para feedback inmediato; el servidor vuelve a validar.
    const check = validateWeek(week);
    if (!check.ok) {
      setError(check.error);
      return;
    }

    setError(null);
    startTransition(async () => {
      const result = await onSave(week);
      if (result.error) {
        setError(result.error);
        setSaved(false);
      } else {
        setSaved(true);
      }
    });
  }

  return (
    <div className="rounded-card border border-border bg-background-secondary">
      {/* ── Días ─────────────────────────────────────────────────────── */}
      <ul className="divide-y divide-border">
        {week.map((d) => {
          const label = dayLabel(d.day);
          const canAdd =
            d.intervals.length < MAX_INTERVALS_PER_DAY &&
            nextIntervalAfter(d.intervals) !== null;

          return (
            <li
              key={d.day}
              className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:gap-6 sm:px-6"
            >
              {/* Día + interruptor */}
              <div className="flex items-center gap-3 sm:w-44 sm:shrink-0 sm:pt-1.5">
                <button
                  type="button"
                  role="switch"
                  aria-checked={d.enabled}
                  aria-label={`${label}: ${d.enabled ? "abierto" : "cerrado"}`}
                  onClick={() => toggleDay(d.day)}
                  disabled={isPending}
                  className={cn(
                    "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50",
                    d.enabled ? "border-accent bg-accent" : "border-border bg-background"
                  )}
                >
                  <span
                    className={cn(
                      "inline-block h-4 w-4 rounded-full transition-transform",
                      d.enabled ? "translate-x-6 bg-background" : "translate-x-1 bg-muted"
                    )}
                  />
                </button>
                <span
                  className={cn(
                    "font-display",
                    d.enabled ? "text-foreground" : "text-muted"
                  )}
                >
                  {label}
                </span>
              </div>

              {/* Intervalos */}
              <div className="flex-1 space-y-2">
                {d.enabled ? (
                  <>
                    {d.intervals.map((iv, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <div className="flex-1 sm:max-w-[9rem]">
                          <input
                            type="time"
                            step={60}
                            value={iv.start}
                            onChange={(e) =>
                              updateInterval(d.day, index, "start", e.target.value)
                            }
                            aria-label={`${label}, intervalo ${index + 1}: apertura`}
                            className={TIME_INPUT_CLASS}
                            disabled={isPending}
                          />
                        </div>
                        <span className="text-muted" aria-hidden="true">
                          –
                        </span>
                        <div className="flex-1 sm:max-w-[9rem]">
                          <input
                            type="time"
                            step={60}
                            value={iv.end}
                            onChange={(e) =>
                              updateInterval(d.day, index, "end", e.target.value)
                            }
                            aria-label={`${label}, intervalo ${index + 1}: cierre`}
                            className={TIME_INPUT_CLASS}
                            disabled={isPending}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => removeInterval(d.day, index)}
                          disabled={isPending}
                          aria-label={`Quitar intervalo ${index + 1} de ${label}`}
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-border/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            fill="none"
                            viewBox="0 0 24 24"
                            strokeWidth={1.5}
                            stroke="currentColor"
                            className="h-4 w-4"
                            aria-hidden="true"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M6 18 18 6M6 6l12 12"
                            />
                          </svg>
                        </button>
                      </div>
                    ))}
                    {canAdd && (
                      <button
                        type="button"
                        onClick={() => addInterval(d.day)}
                        disabled={isPending}
                        className="inline-flex items-center gap-1.5 rounded-button px-1 py-1 text-xs font-sans text-accent transition-colors hover:text-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={2}
                          stroke="currentColor"
                          className="h-3.5 w-3.5"
                          aria-hidden="true"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M12 4.5v15m7.5-7.5h-15"
                          />
                        </svg>
                        Agregar intervalo
                      </button>
                    )}
                  </>
                ) : (
                  <p className="text-sm font-sans text-muted sm:pt-2">Cerrado</p>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {/* ── Mensajes ─────────────────────────────────────────────────── */}
      <div aria-live="polite" className="px-4 sm:px-6">
        {error && (
          <div className="my-4 rounded-button border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-sans text-red-400">
            {error}
          </div>
        )}
      </div>

      {/* ── Acciones ─────────────────────────────────────────────────── */}
      <div className="flex flex-col-reverse gap-3 border-t border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          {copyFrom && (
            <button
              type="button"
              onClick={handleCopy}
              disabled={isPending}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-button border border-border px-4 py-2 text-sm font-sans text-foreground transition-colors hover:bg-border/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 sm:w-auto"
            >
              {copyFrom.label}
            </button>
          )}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {saved && !isDirty && (
            <span className="inline-flex items-center justify-center gap-1.5 text-sm font-sans text-green-400">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                className="h-4 w-4"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
              Horario guardado
            </span>
          )}
          {isDirty && !isPending && (
            <button
              type="button"
              onClick={handleReset}
              className="inline-flex items-center justify-center rounded-button px-4 py-2 text-sm font-sans text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Descartar cambios
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={isPending || !isDirty}
            className="inline-flex items-center justify-center rounded-button bg-accent px-6 py-2.5 text-sm font-sans font-semibold text-background transition-all hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50"
          >
            {isPending ? "Guardando…" : saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
