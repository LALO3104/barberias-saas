"use client";

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  APPOINTMENT_STATUSES,
  STATUS_LABELS,
  VIEW_DAYS,
  addDaysToKey,
  type AgendaView,
} from "@/lib/appointments";

export interface AgendaFilters {
  fecha: string;
  vista: AgendaView;
  /** "todos" o id de barbero (solo admin). */
  barbero: string;
  /** "todos" o un estado. */
  estado: string;
}

interface AgendaToolbarProps {
  filters: AgendaFilters;
  todayKey: string;
  rangeLabel: string;
  /** Solo admin: barberos para el filtro. */
  barberOptions?: { id: string; name: string; inactive: boolean }[];
}

const SELECT_CLASS =
  "w-full rounded-button border border-border bg-background px-3 py-2.5 text-sm font-sans text-foreground [color-scheme:dark] focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50 sm:w-auto";

/**
 * Navegación de la agenda (día / semana) y filtros. Todo vive en la URL
 * (?fecha=&vista=&barbero=&estado=) para que el servidor filtre y para que
 * recargar o compartir el enlace conserve la vista.
 */
export function AgendaToolbar({ filters, todayKey, rangeLabel, barberOptions }: AgendaToolbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  function go(changes: Partial<AgendaFilters>) {
    const next = { ...filters, ...changes };
    const params = new URLSearchParams();
    if (next.fecha !== todayKey) params.set("fecha", next.fecha);
    if (next.vista !== "dia") params.set("vista", next.vista);
    if (barberOptions && next.barbero !== "todos") params.set("barbero", next.barbero);
    if (next.estado !== "todos") params.set("estado", next.estado);
    const qs = params.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname));
  }

  const step = VIEW_DAYS[filters.vista];
  const isToday = filters.fecha === todayKey;

  return (
    <div className="space-y-3 rounded-card border border-border bg-background-secondary p-3 sm:p-4">
      {/* Fecha */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <NavButton
            label={filters.vista === "dia" ? "Día anterior" : "Semana anterior"}
            onClick={() => go({ fecha: addDaysToKey(filters.fecha, -step) })}
            disabled={isPending}
            d="M15.75 19.5 8.25 12l7.5-7.5"
          />
          <NavButton
            label={filters.vista === "dia" ? "Día siguiente" : "Semana siguiente"}
            onClick={() => go({ fecha: addDaysToKey(filters.fecha, step) })}
            disabled={isPending}
            d="m8.25 4.5 7.5 7.5-7.5 7.5"
          />
        </div>
        <button
          type="button"
          onClick={() => go({ fecha: todayKey })}
          disabled={isPending || isToday}
          className="rounded-button border border-border px-3 py-2 text-sm font-sans text-foreground transition-colors hover:bg-border/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
        >
          Hoy
        </button>
        <p className="min-w-0 flex-1 truncate px-1 font-display text-lg text-foreground">
          {rangeLabel}
        </p>
        {isPending && (
          <span className="text-xs font-sans text-muted" role="status">
            Actualizando…
          </span>
        )}
      </div>

      {/* Vista + filtros */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div role="group" aria-label="Vista" className="inline-flex rounded-button border border-border p-0.5">
          {(["dia", "semana"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={filters.vista === v}
              disabled={isPending}
              onClick={() => go({ vista: v })}
              className={cn(
                "flex-1 rounded-button px-4 py-1.5 text-sm font-sans transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:flex-none",
                filters.vista === v
                  ? "bg-accent/15 text-foreground"
                  : "text-muted hover:text-foreground"
              )}
            >
              {v === "dia" ? "Día" : "Semana"}
            </button>
          ))}
        </div>

        <label className="sr-only" htmlFor="agenda-fecha">
          Ir a fecha
        </label>
        <input
          id="agenda-fecha"
          type="date"
          value={filters.fecha}
          disabled={isPending}
          onChange={(e) => e.target.value && go({ fecha: e.target.value })}
          className={SELECT_CLASS}
        />

        {barberOptions && (
          <>
            <label className="sr-only" htmlFor="agenda-barbero">
              Barbero
            </label>
            <select
              id="agenda-barbero"
              value={filters.barbero}
              disabled={isPending}
              onChange={(e) => go({ barbero: e.target.value })}
              className={SELECT_CLASS}
            >
              <option value="todos">Todos los barberos</option>
              {barberOptions.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.inactive ? " (inactivo)" : ""}
                </option>
              ))}
            </select>
          </>
        )}

        <label className="sr-only" htmlFor="agenda-estado">
          Estado
        </label>
        <select
          id="agenda-estado"
          value={filters.estado}
          disabled={isPending}
          onChange={(e) => go({ estado: e.target.value })}
          className={SELECT_CLASS}
        >
          <option value="todos">Todos los estados</option>
          {APPOINTMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function NavButton({
  label,
  onClick,
  disabled,
  d,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  d: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex h-9 w-9 items-center justify-center rounded-button border border-border text-foreground transition-colors hover:bg-border/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.75}
        stroke="currentColor"
        className="h-4 w-4"
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d={d} />
      </svg>
    </button>
  );
}
