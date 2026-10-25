"use client";

import { cn } from "@/lib/utils";
import { formatDuration, formatPrice } from "@/lib/format";
import {
  MAX_SERVICES_PER_APPOINTMENT,
  STATUS_LABELS,
  WALK_IN_WARNING_LABELS,
  formatClock,
  type WalkInWarning,
} from "@/lib/appointments";
import type { WalkInConflict } from "@/app/(dashboard)/dashboard/citas/actions";

/**
 * Piezas compartidas por los formularios de citas del personal
 * (registrar walk-in, mover cita): estilos, selector de servicios y
 * revisión de avisos (BA007).
 */

export interface FormService {
  id: string;
  name: string;
  priceCents: number;
  durationMinutes: number;
}

export const FIELD =
  "block w-full rounded-button border border-border bg-background px-4 py-3 text-body font-sans text-foreground placeholder:text-muted/50 transition-colors duration-150 ease-out focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-50";
export const LABEL = "mb-1.5 block text-sm font-sans text-muted";
export const PRIMARY =
  "inline-flex w-full items-center justify-center rounded-button bg-accent px-5 py-3.5 text-body font-sans font-semibold text-background transition-[filter,transform] duration-150 ease-out hover:brightness-110 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50";
export const SECONDARY =
  "inline-flex w-full items-center justify-center rounded-button border border-border px-5 py-3.5 text-body font-sans text-foreground transition-[background-color,transform] duration-150 ease-out hover:bg-border/40 active:scale-[0.98] disabled:opacity-50";

/** Servicios como píldoras (máximo 5) con duración y precio totales. */
export function ServicePicker({
  services,
  selectedIds,
  onToggle,
  currency,
  disabled,
}: {
  services: FormService[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  currency: string;
  disabled?: boolean;
}) {
  const atLimit = selectedIds.length >= MAX_SERVICES_PER_APPOINTMENT;
  const selected = selectedIds
    .map((id) => services.find((s) => s.id === id))
    .filter((s): s is FormService => !!s);
  const totalMinutes = selected.reduce((sum, s) => sum + s.durationMinutes, 0);
  const totalCents = selected.reduce((sum, s) => sum + s.priceCents, 0);

  return (
    <fieldset>
      <legend className={LABEL}>
        Servicios <span className="text-muted/70">(máximo {MAX_SERVICES_PER_APPOINTMENT})</span>
      </legend>
      <div className="flex flex-wrap gap-2">
        {services.map((s) => {
          const on = selectedIds.includes(s.id);
          const blocked = !on && atLimit;
          return (
            <button
              key={s.id}
              type="button"
              aria-pressed={on}
              aria-disabled={blocked || undefined}
              onClick={() => !blocked && onToggle(s.id)}
              disabled={disabled}
              className={cn(
                "inline-flex min-h-11 items-center gap-2 rounded-full border px-4 py-2 text-sm font-sans transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.97]",
                on ? "border-accent bg-accent/15 text-accent" : "border-border text-foreground hover:border-accent/50",
                blocked && "opacity-40"
              )}
            >
              {s.name}
              <span className="text-xs text-muted">{formatDuration(s.durationMinutes)}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-sm font-sans text-muted" aria-live="polite">
        {selected.length === 0
          ? "Elige al menos un servicio."
          : `${formatDuration(totalMinutes)} · ${formatPrice(totalCents, currency)}`}
      </p>
    </fieldset>
  );
}

/** Lista de avisos y citas en conflicto (respuesta BA007). */
export function WarningsReview({
  warnings,
  conflicts,
  timezone,
  intro,
}: {
  warnings: WalkInWarning[];
  conflicts: WalkInConflict[];
  timezone: string;
  intro: string;
}) {
  return (
    <div className="space-y-5">
      <p className="text-body font-sans text-muted">{intro}</p>
      <ul className="space-y-2">
        {warnings.map((w) => (
          <li
            key={w}
            className="flex items-start gap-2.5 rounded-button border border-amber-500/30 bg-amber-500/10 px-3.5 py-3 text-sm font-sans text-amber-200"
          >
            <WarningIcon />
            {WALK_IN_WARNING_LABELS[w]}
          </li>
        ))}
      </ul>
      {conflicts.length > 0 && (
        <div>
          <p className="mb-2 text-label font-sans uppercase tracking-label text-muted">Citas que se traslapan</p>
          <ul className="divide-y divide-border rounded-card border border-border">
            {conflicts.map((c) => (
              <li key={c.startIso + c.clientName} className="flex items-center justify-between gap-3 px-3.5 py-3">
                <span className="min-w-0 truncate text-body font-sans text-foreground">{c.clientName}</span>
                <span className="shrink-0 text-sm font-sans tabular-nums text-muted">
                  {formatClock(c.startIso, timezone)}–{formatClock(c.endIso, timezone)} · {STATUS_LABELS[c.status]}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function ErrorText({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="text-sm font-sans text-red-400">
      {children}
    </p>
  );
}

function WarningIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
      />
    </svg>
  );
}
