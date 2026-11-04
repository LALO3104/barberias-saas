import Link from "next/link";
import { cn } from "@/lib/utils";
import { PERIOD_LABELS, periodLabel, shiftPeriod, type PeriodView } from "@/lib/periods";

const NAV_BUTTON =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-button border border-border text-lg text-foreground transition-[background-color,transform] duration-150 ease-out hover:bg-border/50 active:scale-[0.94]";

interface PeriodNavProps {
  /** Ruta de la pantalla, p. ej. "/dashboard/ganancias". */
  basePath: string;
  vista: PeriodView;
  anchor: string;
  from: string;
  to: string;
}

/** Día / Semana / Mes y flechas de periodo (navega con ?vista=&fecha=). */
export function PeriodNav({ basePath, vista, anchor, from, to }: PeriodNavProps) {
  const link = (v: PeriodView, f: string) => `${basePath}?vista=${v}&fecha=${f}`;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-1 rounded-button border border-border p-1" role="tablist" aria-label="Periodo">
        {(Object.keys(PERIOD_LABELS) as PeriodView[]).map((v) => (
          <Link
            key={v}
            href={link(v, anchor)}
            role="tab"
            aria-selected={vista === v}
            className={cn(
              "rounded-button py-2 text-center text-sm font-sans transition-[background-color,color] duration-150 ease-out",
              vista === v ? "bg-accent/15 text-accent" : "text-muted hover:text-foreground"
            )}
          >
            {PERIOD_LABELS[v]}
          </Link>
        ))}
      </div>
      <div className="flex items-center justify-between gap-3">
        <Link href={link(vista, shiftPeriod(vista, anchor, -1))} aria-label="Periodo anterior" className={NAV_BUTTON}>
          ←
        </Link>
        <p className="text-center font-display text-lg capitalize text-foreground">{periodLabel(vista, from, to)}</p>
        <Link href={link(vista, shiftPeriod(vista, anchor, 1))} aria-label="Periodo siguiente" className={NAV_BUTTON}>
          →
        </Link>
      </div>
    </div>
  );
}
