"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/Dialog";
import { cn } from "@/lib/utils";
import { formatDuration, formatPrice } from "@/lib/format";
import {
  MAX_SERVICES_PER_APPOINTMENT,
  STATUS_LABELS,
  WALK_IN_NAME_MAX,
  WALK_IN_NOTE_MAX,
  WALK_IN_WARNING_LABELS,
  formatClock,
  nowTimeKey,
} from "@/lib/appointments";
import {
  createWalkInAction,
  lookupWalkInClientAction,
  type WalkInConflict,
} from "@/app/(dashboard)/dashboard/citas/actions";
import type { WalkInWarning } from "@/lib/appointments";

export interface WalkInService {
  id: string;
  name: string;
  priceCents: number;
  durationMinutes: number;
}

interface WalkInLauncherProps {
  timezone: string;
  currency: string;
  /** admin: barberos activos · barber: solo él (sin selector). */
  barbers: { id: string; name: string }[];
  canChooseBarber: boolean;
  services: WalkInService[];
  /** Barbero preseleccionado (p. ej. el filtro actual de la agenda). */
  defaultBarberId?: string | null;
}

type Lookup =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "found"; name: string }
  | { state: "new" }
  | { state: "invalid" };

const FIELD =
  "block w-full rounded-button border border-border bg-background px-4 py-3 text-body font-sans text-foreground placeholder:text-muted/50 transition-colors duration-150 ease-out focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-50";
const LABEL = "mb-1.5 block text-sm font-sans text-muted";
const PRIMARY =
  "inline-flex w-full items-center justify-center rounded-button bg-accent px-5 py-3.5 text-body font-sans font-semibold text-background transition-[filter,transform] duration-150 ease-out hover:brightness-110 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50";
const SECONDARY =
  "inline-flex w-full items-center justify-center rounded-button border border-border px-5 py-3.5 text-body font-sans text-foreground transition-[background-color,transform] duration-150 ease-out hover:bg-border/40 active:scale-[0.98] disabled:opacity-50";

/**
 * Botón "Walk-in" + formulario (panel desde abajo en el teléfono).
 * La validación real ocurre en createWalkInAction → public.create_walk_in.
 */
export function WalkInLauncher({
  timezone,
  currency,
  barbers,
  canChooseBarber,
  services,
  defaultBarberId,
}: WalkInLauncherProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const initialBarber =
    (defaultBarberId && barbers.some((b) => b.id === defaultBarberId) ? defaultBarberId : null) ??
    (barbers.length === 1 ? barbers[0].id : "");
  const [barberId, setBarberId] = useState(initialBarber);
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [time, setTime] = useState("");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [lookup, setLookup] = useState<Lookup>({ state: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ warnings: WalkInWarning[]; conflicts: WalkInConflict[] } | null>(null);
  const lookupSeq = useRef(0);
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selected = useMemo(
    () => serviceIds.map((id) => services.find((s) => s.id === id)).filter((s): s is WalkInService => !!s),
    [serviceIds, services]
  );
  const totalMinutes = selected.reduce((sum, s) => sum + s.durationMinutes, 0);
  const totalCents = selected.reduce((sum, s) => sum + s.priceCents, 0);
  const atLimit = serviceIds.length >= MAX_SERVICES_PER_APPOINTMENT;

  function openSheet() {
    setBarberId(initialBarber);
    setServiceIds([]);
    setTime(nowTimeKey(timezone));
    setPhone("");
    setName("");
    setNote("");
    setLookup({ state: "idle" });
    setError(null);
    setConfirm(null);
    setOpen(true);
  }

  function closeSheet() {
    if (isPending) return;
    if (lookupTimer.current) clearTimeout(lookupTimer.current);
    lookupSeq.current++;
    setOpen(false);
  }

  // Busca el cliente cuando el teléfono tiene 10 dígitos o más (400 ms después
  // de dejar de escribir; solo cuenta la respuesta de la última búsqueda).
  function scheduleLookup(nextPhone: string, nextBarberId: string) {
    if (lookupTimer.current) clearTimeout(lookupTimer.current);
    const seq = ++lookupSeq.current;
    if (!nextBarberId || nextPhone.replace(/\D/g, "").length < 10) {
      setLookup({ state: "idle" });
      return;
    }
    setLookup({ state: "loading" });
    lookupTimer.current = setTimeout(async () => {
      try {
        const result = await lookupWalkInClientAction(nextBarberId, nextPhone);
        if (seq !== lookupSeq.current) return;
        if (!result.valid) setLookup({ state: "invalid" });
        else if (result.existingName) setLookup({ state: "found", name: result.existingName });
        else setLookup({ state: "new" });
      } catch {
        if (seq === lookupSeq.current) setLookup({ state: "idle" });
      }
    }, 400);
  }

  useEffect(() => () => {
    if (lookupTimer.current) clearTimeout(lookupTimer.current);
  }, []);

  function toggleService(id: string) {
    setConfirm(null);
    setServiceIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= MAX_SERVICES_PER_APPOINTMENT ? prev : [...prev, id]
    );
  }

  const clientName = lookup.state === "found" ? lookup.name : name.trim();
  const canSubmit =
    !!barberId && serviceIds.length > 0 && !!time && phone.trim().length > 0 && clientName.length > 0 && !isPending;

  function submit(acknowledgeWarnings: boolean) {
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await createWalkInAction({
          barberId,
          serviceIds,
          time,
          clientName,
          clientPhone: phone,
          clientNote: note,
          acknowledgeWarnings,
        });
        if (result.needsConfirmation) {
          setConfirm({ warnings: result.warnings ?? [], conflicts: result.conflicts ?? [] });
          return;
        }
        if (result.error) {
          setConfirm(null);
          setError(result.error);
          return;
        }
        setOpen(false);
        router.push("/dashboard/citas?vista=dia");
        router.refresh();
      } catch {
        setError("No se pudo conectar. Revisa tu conexión e intenta de nuevo.");
      }
    });
  }

  if (services.length === 0 || barbers.length === 0) return null;

  return (
    <>
      {/* Escritorio */}
      <button
        type="button"
        onClick={openSheet}
        className="hidden items-center gap-2 rounded-button bg-accent px-4 py-2.5 text-sm font-sans font-semibold text-background transition-[filter,transform] duration-150 ease-out hover:brightness-110 active:scale-[0.97] lg:inline-flex"
      >
        <PlusIcon />
        Registrar walk-in
      </button>

      {/* Teléfono: botón flotante sobre la barra inferior */}
      <button
        type="button"
        onClick={openSheet}
        aria-label="Registrar walk-in"
        className="fixed right-4 z-30 inline-flex items-center gap-2 rounded-full bg-accent px-5 py-3.5 text-sm font-sans font-semibold text-background shadow-card transition-[filter,transform] duration-150 ease-out active:scale-[0.95] bottom-[calc(4.5rem+env(safe-area-inset-bottom)+1rem)] lg:hidden"
      >
        <PlusIcon />
        Walk-in
      </button>

      <Dialog open={open} onClose={closeSheet} title={confirm ? "Revisa antes de registrar" : "Registrar walk-in"}>
        {confirm ? (
          <div className="space-y-5">
            <p className="text-body font-sans text-muted">
              Puedes registrarlo de todos modos: ninguna otra cita se moverá ni se cancelará.
            </p>
            <ul className="space-y-2">
              {confirm.warnings.map((w) => (
                <li
                  key={w}
                  className="flex items-start gap-2.5 rounded-button border border-amber-500/30 bg-amber-500/10 px-3.5 py-3 text-sm font-sans text-amber-200"
                >
                  <WarningIcon />
                  {WALK_IN_WARNING_LABELS[w]}
                </li>
              ))}
            </ul>
            {confirm.conflicts.length > 0 && (
              <div>
                <p className="mb-2 text-label font-sans uppercase tracking-label text-muted">Citas que se traslapan</p>
                <ul className="divide-y divide-border rounded-card border border-border">
                  {confirm.conflicts.map((c) => (
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
            {error && <ErrorText>{error}</ErrorText>}
            <div className="flex flex-col gap-2">
              <button type="button" onClick={() => submit(true)} disabled={isPending} className={PRIMARY}>
                {isPending ? "Registrando…" : "Registrar de todos modos"}
              </button>
              <button type="button" onClick={() => setConfirm(null)} disabled={isPending} className={SECONDARY}>
                Volver y cambiar
              </button>
            </div>
          </div>
        ) : (
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              submit(false);
            }}
          >
            {canChooseBarber && (
              <div>
                <label htmlFor="walkin-barber" className={LABEL}>Barbero</label>
                <select
                  id="walkin-barber"
                  value={barberId}
                  onChange={(e) => {
                    setBarberId(e.target.value);
                    scheduleLookup(phone, e.target.value);
                  }}
                  required
                  disabled={isPending}
                  className={FIELD}
                >
                  <option value="" disabled>Elige un barbero</option>
                  {barbers.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
            )}

            <fieldset>
              <legend className={LABEL}>
                Servicios <span className="text-muted/70">(máximo {MAX_SERVICES_PER_APPOINTMENT})</span>
              </legend>
              <div className="flex flex-wrap gap-2">
                {services.map((s) => {
                  const on = serviceIds.includes(s.id);
                  const blocked = !on && atLimit;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      aria-pressed={on}
                      aria-disabled={blocked || undefined}
                      onClick={() => !blocked && toggleService(s.id)}
                      disabled={isPending}
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

            <div>
              <label htmlFor="walkin-time" className={LABEL}>Hora (hoy)</label>
              <div className="flex gap-2">
                <input
                  id="walkin-time"
                  type="time"
                  step={60}
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  required
                  disabled={isPending}
                  className={cn(FIELD, "tabular-nums")}
                />
                <button
                  type="button"
                  onClick={() => setTime(nowTimeKey(timezone))}
                  disabled={isPending}
                  className="shrink-0 rounded-button border border-border px-4 text-sm font-sans text-foreground transition-[background-color,transform] duration-150 ease-out hover:bg-border/40 active:scale-[0.97]"
                >
                  Ahora
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="walkin-phone" className={LABEL}>Teléfono del cliente</label>
              <input
                id="walkin-phone"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                enterKeyHint="next"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  scheduleLookup(e.target.value, barberId);
                }}
                placeholder="55 1234 5678"
                maxLength={30}
                required
                disabled={isPending}
                className={FIELD}
              />
              <p className="mt-1.5 min-h-5 text-sm font-sans" aria-live="polite">
                {lookup.state === "loading" && <span className="text-muted">Buscando cliente…</span>}
                {lookup.state === "found" && (
                  <span className="text-accent">
                    Cliente existente: <strong className="font-semibold">{lookup.name}</strong>
                  </span>
                )}
                {lookup.state === "new" && <span className="text-muted">Cliente nuevo</span>}
                {lookup.state === "invalid" && <span className="text-red-400">Revisa el teléfono: 10 dígitos.</span>}
              </p>
            </div>

            {lookup.state !== "found" && (
              <div>
                <label htmlFor="walkin-name" className={LABEL}>Nombre del cliente</label>
                <input
                  id="walkin-name"
                  type="text"
                  autoComplete="off"
                  autoCapitalize="words"
                  enterKeyHint="next"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={WALK_IN_NAME_MAX}
                  required
                  disabled={isPending}
                  className={FIELD}
                />
              </div>
            )}

            <div>
              <label htmlFor="walkin-note" className={LABEL}>
                Nota <span className="text-muted/70">(opcional)</span>
              </label>
              <textarea
                id="walkin-note"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={WALK_IN_NOTE_MAX}
                disabled={isPending}
                className={cn(FIELD, "resize-none")}
              />
            </div>

            {error && <ErrorText>{error}</ErrorText>}

            <button type="submit" disabled={!canSubmit} className={PRIMARY}>
              {isPending ? "Registrando…" : "Registrar walk-in"}
            </button>
          </form>
        )}
      </Dialog>
    </>
  );
}

function ErrorText({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="text-sm font-sans text-red-400">
      {children}
    </p>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
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
