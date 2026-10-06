"use client";

import { dayLabel, type WeekSchedule } from "@/lib/schedule";
import { saveBarberHoursAction } from "@/app/(dashboard)/dashboard/horarios/actions";
import { TimezoneBadge } from "./ScheduleManager";
import { WeekScheduleEditor } from "./WeekScheduleEditor";

interface MyScheduleProps {
  timezone: string;
  barberId: string;
  displayName: string;
  isActive: boolean;
  week: WeekSchedule;
  hasHours: boolean;
  businessWeek: WeekSchedule;
}

/**
 * Vista "Mi horario" del barbero: edita solo su propia semana con el mismo
 * editor que usa el admin.
 *
 * barberId solo identifica el objetivo; el servidor lo vuelve a resolver
 * desde la sesión y rechaza cualquier barbero que no sea el del usuario.
 */
export function MySchedule({
  timezone,
  barberId,
  displayName,
  isActive,
  week,
  hasHours,
  businessWeek,
}: MyScheduleProps) {
  return (
    <div className="space-y-8">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-section font-display text-foreground">Mi horario</h1>
          <p className="mt-1 text-body font-sans text-muted">
            {displayName}, define los días y horas en que atiendes
          </p>
        </div>
        <TimezoneBadge timezone={timezone} />
      </div>

      {/* ── Avisos ─────────────────────────────────────────────────────── */}
      {!isActive && (
        <div className="rounded-button border border-border bg-background-secondary px-4 py-3 text-sm font-sans text-muted">
          Tu perfil está inactivo: no recibirás reservas aunque tengas horario.
          Solo el administrador puede reactivarlo.
        </div>
      )}
      {isActive && !hasHours && (
        <div className="rounded-button border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm font-sans text-amber-300">
          Aún no tienes horario: no aparecerás disponible para reservas hasta
          que lo configures.
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_16rem]">
        {/* ── Editor (mismo componente que usa el admin) ──────────────── */}
        <section aria-label="Editar mi horario">
          <WeekScheduleEditor
            initialWeek={week}
            onSave={(next) => saveBarberHoursAction(barberId, next)}
            copyFrom={{ label: "Usar horario de la barbería", week: businessWeek }}
            saveLabel="Guardar mi horario"
          />
          <p className="mt-3 text-xs font-sans text-muted">
            Marca un día como cerrado para descansar. Solo recibirás reservas en
            las horas que coincidan con el horario de la barbería.
          </p>
        </section>

        {/* ── Referencia: horario del local (solo lectura) ────────────── */}
        <aside
          aria-labelledby="business-reference-title"
          className="h-fit rounded-card border border-border bg-background-secondary p-5"
        >
          <p className="text-label font-sans uppercase tracking-label text-accent">
            Referencia
          </p>
          <h2
            id="business-reference-title"
            className="mt-1 font-display text-foreground"
          >
            Horario de la barbería
          </h2>
          <dl className="mt-4 space-y-2 text-sm font-sans">
            {businessWeek.map((d) => (
              <div key={d.day} className="flex items-start justify-between gap-3">
                <dt className="text-muted">{dayLabel(d.day)}</dt>
                <dd className="text-right text-foreground">
                  {d.enabled && d.intervals.length > 0 ? (
                    d.intervals.map((iv) => (
                      <span key={`${iv.start}-${iv.end}`} className="block">
                        {iv.start}–{iv.end}
                      </span>
                    ))
                  ) : (
                    <span className="text-muted">Cerrado</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </aside>
      </div>
    </div>
  );
}
