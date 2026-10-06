"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { WeekSchedule } from "@/lib/schedule";
import {
  saveBarberHoursAction,
  saveBusinessHoursAction,
} from "@/app/(dashboard)/dashboard/horarios/actions";
import { WeekScheduleEditor } from "./WeekScheduleEditor";

export interface ScheduleBarber {
  id: string;
  displayName: string;
  week: WeekSchedule;
  hasHours: boolean;
}

/** Zona horaria del local: los horarios se interpretan siempre en ella. */
export function TimezoneBadge({ timezone }: { timezone: string }) {
  return (
    <div className="inline-flex items-center gap-2 self-start rounded-full border border-border bg-background-secondary px-3 py-1.5 text-xs font-sans text-muted sm:self-auto">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
        className="h-4 w-4 text-accent"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418"
        />
      </svg>
      <span>
        Hora local de la barbería: <span className="text-foreground">{timezone}</span>
      </span>
    </div>
  );
}

interface ScheduleManagerProps {
  timezone: string;
  businessWeek: WeekSchedule;
  barbers: ScheduleBarber[];
}

/**
 * Módulo de horarios: horario general de la barbería + horario individual de
 * cada barbero activo. Los datos llegan del Server Component (page.tsx).
 */
export function ScheduleManager({
  timezone,
  businessWeek,
  barbers,
}: ScheduleManagerProps) {
  const [selectedId, setSelectedId] = useState<string | null>(
    barbers[0]?.id ?? null
  );
  const selected = barbers.find((b) => b.id === selectedId) ?? barbers[0] ?? null;

  return (
    <div className="space-y-10">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-section font-display text-foreground">Horarios</h1>
          <p className="mt-1 text-body font-sans text-muted">
            Define cuándo abre tu barbería y cuándo atiende cada barbero
          </p>
        </div>
        <TimezoneBadge timezone={timezone} />
      </div>

      {/* ── 1. Horario de la barbería ──────────────────────────────────── */}
      <section aria-labelledby="business-hours-title" className="space-y-4">
        <div>
          <p className="text-label font-sans uppercase tracking-label text-accent">
            01
          </p>
          <h2
            id="business-hours-title"
            className="mt-1 text-lg font-display text-foreground"
          >
            Horario de la barbería
          </h2>
          <p className="mt-1 max-w-2xl text-sm font-sans text-muted">
            Cuándo está abierto el local. Usa varios intervalos para turnos
            partidos (por ejemplo, 09:00–14:00 y 16:00–20:00).
          </p>
        </div>

        <WeekScheduleEditor
          initialWeek={businessWeek}
          onSave={(week) => saveBusinessHoursAction(week)}
          saveLabel="Guardar horario de la barbería"
        />
      </section>

      {/* ── 2. Horarios de barberos ────────────────────────────────────── */}
      <section aria-labelledby="barber-hours-title" className="space-y-4">
        <div>
          <p className="text-label font-sans uppercase tracking-label text-accent">
            02
          </p>
          <h2
            id="barber-hours-title"
            className="mt-1 text-lg font-display text-foreground"
          >
            Horarios de barberos
          </h2>
          <p className="mt-1 max-w-2xl text-sm font-sans text-muted">
            Cada barbero solo podrá recibir reservas cuando su horario coincida
            con el de la barbería.
          </p>
        </div>

        {barbers.length === 0 || !selected ? (
          <div className="rounded-card border border-border bg-background-secondary p-[var(--spacing-card)] text-center">
            <h3 className="font-display text-foreground">Sin barberos activos</h3>
            <p className="mx-auto mt-2 max-w-sm text-sm font-sans text-muted">
              Agrega o activa barberos para configurar sus horarios.
            </p>
            <Link
              href="/dashboard/barberos"
              className="mt-5 inline-flex items-center justify-center rounded-button border border-border px-4 py-2 text-sm font-sans text-foreground transition-colors hover:bg-border/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Ir a Barberos
            </Link>
          </div>
        ) : (
          <>
            {/* Selector de barbero */}
            <div
              role="tablist"
              aria-label="Seleccionar barbero"
              className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
            >
              {barbers.map((b) => {
                const isSelected = b.id === selected.id;
                return (
                  <button
                    key={b.id}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    onClick={() => setSelectedId(b.id)}
                    className={cn(
                      "inline-flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-sans transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                      isSelected
                        ? "border-accent bg-accent/10 text-foreground"
                        : "border-border text-muted hover:border-accent/50 hover:text-foreground"
                    )}
                  >
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        b.hasHours ? "bg-green-400" : "bg-amber-400"
                      )}
                      aria-hidden="true"
                    />
                    {b.displayName}
                    {!b.hasHours && <span className="sr-only">(sin horario)</span>}
                  </button>
                );
              })}
            </div>

            {!selected.hasHours && (
              <div className="rounded-button border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm font-sans text-amber-300">
                {selected.displayName} aún no tiene horario: no aparecerá
                disponible para reservas hasta que lo configures.
              </div>
            )}

            <WeekScheduleEditor
              key={selected.id}
              initialWeek={selected.week}
              onSave={(week) => saveBarberHoursAction(selected.id, week)}
              copyFrom={{ label: "Usar horario de la barbería", week: businessWeek }}
              saveLabel={`Guardar horario de ${selected.displayName}`}
            />
          </>
        )}
      </section>
    </div>
  );
}
