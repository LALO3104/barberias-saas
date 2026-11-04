"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export interface BarDatum {
  key: string;
  /** Texto completo (detalle al tocar y tabla para lectores de pantalla). */
  label: string;
  /** Etiqueta del eje; vacía para no mostrarla. */
  tick: string;
  value: number;
  valueLabel: string;
}

interface BarChartProps {
  title: string;
  data: BarDatum[];
}

/**
 * Barras de una sola serie (el título la nombra; no lleva leyenda). Se toca o
 * se pasa el cursor por una columna para leer su valor: toda la altura de la
 * columna es zona de toque, aunque la barra sea baja.
 */
export function BarChart({ title, data }: BarChartProps) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const max = Math.max(...data.map((d) => d.value), 0);
  const active = data.find((d) => d.key === activeKey) ?? null;

  return (
    <figure>
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-sans font-medium text-foreground">{title}</span>
        <span className="min-w-0 truncate text-sm font-sans tabular-nums text-muted" aria-live="polite">
          {active ? `${active.label}: ${active.valueLabel}` : "Toca una barra"}
        </span>
      </figcaption>

      <div className="mt-3 flex h-36 items-end gap-0.5 border-b border-border" aria-hidden="true">
        {data.map((d) => {
          const height = max > 0 ? (d.value / max) * 100 : 0;
          return (
            <button
              key={d.key}
              type="button"
              tabIndex={-1}
              onClick={() => setActiveKey(d.key === activeKey ? null : d.key)}
              onPointerEnter={(e) => e.pointerType === "mouse" && setActiveKey(d.key)}
              className="flex h-full min-w-0 flex-1 items-end"
            >
              <span
                className={cn(
                  "block w-full rounded-t transition-[background-color] duration-150 ease-out",
                  d.value === 0 ? "bg-border" : active && active.key !== d.key ? "bg-accent/40" : "bg-accent"
                )}
                style={{ height: d.value === 0 ? "2px" : `max(${height}%, 4px)` }}
              />
            </button>
          );
        })}
      </div>

      <div className="mt-1.5 flex gap-0.5" aria-hidden="true">
        {data.map((d) => (
          <span key={d.key} className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center text-[11px] font-sans text-muted">
            {d.tick}
          </span>
        ))}
      </div>

      <table className="sr-only">
        <caption>{title}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.key}>
              <th scope="row">{d.label}</th>
              <td>{d.valueLabel}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
