"use client";

import {
  useReducer,
  useCallback,
  useRef,
  useEffect,
  useId,
  useMemo,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import {
  fetchAvailableSlots,
  bookAppointment,
  PublicApiError,
  ERROR_CODES,
  MAX_SERVICES_PER_BOOKING,
} from "@/lib/public-api";
import {
  formatPrice,
  formatDuration,
  formatSlotTime,
  formatSlotDate,
  getUpcomingDates,
  groupSlotsByHour,
  type SlotHourGroup,
} from "@/lib/format";
import { useGsapAnimation } from "@/hooks/useGsapAnimation";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { cn } from "@/lib/utils";
import type { PublicTenant, PublicBarber, PublicService, BookingConfirmation } from "@/types/public";

// ─── Steps ──────────────────────────────────────────────────────────────────

const STEPS = ["barbero", "servicio", "fecha", "datos", "confirmar"] as const;
type Step = (typeof STEPS)[number];

const STEP_TITLES: Record<Step, string> = {
  barbero: "¿Con quién te atiendes?",
  servicio: "¿Qué te hacemos?",
  fecha: "¿Cuándo vienes?",
  datos: "¿A nombre de quién?",
  confirmar: "Revisa y confirma",
};

/** Datos del cliente recordados en este teléfono (solo nombre y teléfono). */
const CLIENT_STORAGE_KEY = "barberias:cliente";

// ─── State ──────────────────────────────────────────────────────────────────

interface WizardState {
  step: Step;
  barberId: string | null;
  /** Servicios elegidos, en el orden en que el cliente los eligió (1 a 5). */
  serviceIds: string[];
  date: string | null; // YYYY-MM-DD
  /** Grupo de hora elegido (`SlotHourGroup.key`). */
  hourKey: string | null;
  slotStart: string | null; // timestamptz ISO
  slots: string[]; // timestamptz ISO array
  slotsLoading: boolean;
  slotsError: string | null;
  /** Para qué barbero|servicios|día son los horarios cargados (evita mostrar "sin lugares" antes de tiempo). */
  slotsKey: string | null;
  clientName: string;
  clientPhone: string;
  clientNote: string;
  submitting: boolean;
  submitError: string | null;
}

type WizardAction =
  | { type: "SELECT_BARBER"; barberId: string }
  | { type: "TOGGLE_SERVICE"; serviceId: string }
  | { type: "CONFIRM_SERVICES" }
  | { type: "SELECT_DATE"; date: string }
  | { type: "SELECT_HOUR"; hourKey: string }
  | { type: "SELECT_SLOT"; slotStart: string }
  | { type: "CONFIRM_SLOT" }
  | { type: "SET_CLIENT_NAME"; value: string }
  | { type: "SET_CLIENT_PHONE"; value: string }
  | { type: "SET_CLIENT_NOTE"; value: string }
  | { type: "GO_TO_STEP"; step: Step }
  | { type: "SLOTS_LOADING" }
  | { type: "SLOTS_LOADED"; slots: string[]; key: string }
  | { type: "SLOTS_ERROR"; error: string; key: string }
  | { type: "SUBMIT_START" }
  | { type: "SUBMIT_ERROR"; error: string }
  | { type: "REFRESH_SLOTS" };

const initialState: WizardState = {
  step: "barbero",
  barberId: null,
  serviceIds: [],
  date: null,
  hourKey: null,
  slotStart: null,
  slots: [],
  slotsLoading: false,
  slotsError: null,
  slotsKey: null,
  clientName: "",
  clientPhone: "",
  clientNote: "",
  submitting: false,
  submitError: null,
};

/** Estado inicial con el nombre y teléfono recordados (si los hay). */
function initWizard(base: WizardState): WizardState {
  if (typeof window === "undefined") return base;
  try {
    const saved = JSON.parse(window.localStorage.getItem(CLIENT_STORAGE_KEY) ?? "null") as unknown;
    if (saved && typeof saved === "object") {
      const { name, phone } = saved as Record<string, unknown>;
      return {
        ...base,
        clientName: typeof name === "string" ? name.slice(0, 120) : "",
        clientPhone: typeof phone === "string" ? phone.slice(0, 30) : "",
      };
    }
  } catch {
    // Sin almacenamiento (modo privado, bloqueado): se piden los datos.
  }
  return base;
}

/**
 * Cambiar barbero, servicios o fecha invalida la hora, el minuto y los
 * horarios cargados: se vuelven a pedir al backend al llegar a "fecha".
 */
const CLEARED_SLOTS = {
  hourKey: null,
  slotStart: null,
  slots: [],
  slotsError: null,
  slotsKey: null,
} satisfies Partial<WizardState>;

function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "SELECT_BARBER":
      return {
        ...state,
        ...CLEARED_SLOTS,
        barberId: action.barberId,
        step: "servicio",
      };
    case "TOGGLE_SERVICE": {
      const isSelected = state.serviceIds.includes(action.serviceId);
      if (!isSelected && state.serviceIds.length >= MAX_SERVICES_PER_BOOKING) {
        // Límite alcanzado: la UI ya muestra el aviso; no se agrega.
        return state;
      }
      return {
        ...state,
        ...CLEARED_SLOTS,
        serviceIds: isSelected
          ? state.serviceIds.filter((id) => id !== action.serviceId)
          : [...state.serviceIds, action.serviceId],
      };
    }
    case "CONFIRM_SERVICES":
      if (state.serviceIds.length === 0) return state;
      return { ...state, step: "fecha", submitError: null };
    case "SELECT_DATE":
      return {
        ...state,
        ...CLEARED_SLOTS,
        date: action.date,
      };
    case "SELECT_HOUR":
      return {
        ...state,
        hourKey: action.hourKey,
        // Elegir otra hora obliga a elegir de nuevo el minuto.
        slotStart: state.hourKey === action.hourKey ? state.slotStart : null,
      };
    case "SELECT_SLOT":
      return { ...state, slotStart: action.slotStart };
    case "CONFIRM_SLOT":
      if (!state.slotStart) return state;
      return { ...state, step: "datos", submitError: null };
    case "SET_CLIENT_NAME":
      return { ...state, clientName: action.value };
    case "SET_CLIENT_PHONE":
      return { ...state, clientPhone: action.value };
    case "SET_CLIENT_NOTE":
      return { ...state, clientNote: action.value };
    case "GO_TO_STEP":
      return { ...state, step: action.step, submitError: null };
    case "SLOTS_LOADING":
      return { ...state, slotsLoading: true, slotsError: null };
    case "SLOTS_LOADED": {
      // Al recargar (p. ej. al volver de "Tus datos"), la selección solo se
      // conserva si el backend sigue ofreciendo exactamente ese horario.
      const keep =
        state.slotStart !== null && action.slots.includes(state.slotStart);
      return {
        ...state,
        slotsLoading: false,
        slotsKey: action.key,
        slots: action.slots,
        hourKey: keep ? state.hourKey : null,
        slotStart: keep ? state.slotStart : null,
      };
    }
    case "SLOTS_ERROR":
      return {
        ...state,
        slotsLoading: false,
        slotsKey: action.key,
        slotsError: action.error,
        slots: [],
        hourKey: null,
        slotStart: null,
      };
    case "SUBMIT_START":
      return { ...state, submitting: true, submitError: null };
    case "SUBMIT_ERROR":
      return { ...state, submitting: false, submitError: action.error };
    case "REFRESH_SLOTS":
      // Volver a "fecha" dispara una nueva consulta de horarios.
      return { ...state, ...CLEARED_SLOTS, step: "fecha" };
    default:
      return state;
  }
}

// ─── Component ──────────────────────────────────────────────────────────────

interface BookingWizardProps {
  tenant: PublicTenant;
  onSuccess: (confirmation: BookingConfirmation) => void;
}

export function BookingWizard({ tenant, onSuccess }: BookingWizardProps) {
  const [state, dispatch] = useReducer(wizardReducer, initialState, initWizard);
  const currency = tenant.currency ?? "MXN";
  const rootRef = useRef<HTMLDivElement>(null);
  const stepRef = useRef<HTMLDivElement>(null);
  const reduceMotion = usePrefersReducedMotion();

  const selectedBarber = tenant.barbers.find((b) => b.id === state.barberId);
  const selectedServices = pickServices(tenant.services, state.serviceIds);
  const totals = sumServices(selectedServices);
  const dates = useMemo(() => getUpcomingDates(tenant.timezone, 14), [tenant.timezone]);

  // ── Fetch slots ──────────────────────────────────────────────────────────
  // Se piden al estar en el paso "fecha" y cada vez que cambian barbero,
  // servicios o fecha. Los UUID no contienen comas: la clave es estable.
  const serviceKey = state.serviceIds.join(",");
  const wantsSlots = state.step === "fecha";

  // Al llegar a "fecha" sin día elegido, se propone hoy (un toque menos).
  const firstDate = dates[0]?.value;
  useEffect(() => {
    if (wantsSlots && !state.date && firstDate) dispatch({ type: "SELECT_DATE", date: firstDate });
  }, [wantsSlots, state.date, firstDate]);

  useEffect(() => {
    if (!wantsSlots || !state.barberId || !serviceKey || !state.date) return;

    const supabase = getSupabaseClient();
    if (!supabase) return;

    const barberId = state.barberId;
    const date = state.date;
    const serviceIds = serviceKey.split(",");
    const key = `${barberId}|${serviceKey}|${date}`;
    let cancelled = false;

    async function loadSlots() {
      dispatch({ type: "SLOTS_LOADING" });
      try {
        const slots = await fetchAvailableSlots(
          supabase!,
          tenant.slug,
          barberId,
          serviceIds,
          date
        );
        if (!cancelled) {
          dispatch({
            type: "SLOTS_LOADED",
            key,
            slots: slots.map((s) => s.slot_start),
          });
        }
      } catch (err) {
        if (!cancelled) {
          dispatch({
            type: "SLOTS_ERROR",
            key,
            error:
              err instanceof PublicApiError
                ? err.message
                : "No se pudieron cargar los horarios. Intenta de nuevo.",
          });
        }
      }
    }

    loadSlots();
    return () => {
      cancelled = true;
    };
  }, [wantsSlots, state.barberId, serviceKey, state.date, tenant.slug]);

  // ── Submit booking ───────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (!state.barberId || state.serviceIds.length === 0 || !state.slotStart) return;
    if (!state.clientName.trim() || !state.clientPhone.trim()) return;

    const supabase = getSupabaseClient();
    if (!supabase) return;

    dispatch({ type: "SUBMIT_START" });
    try {
      const confirmation = await bookAppointment(supabase, {
        slug: tenant.slug,
        barberId: state.barberId,
        serviceIds: state.serviceIds,
        startAt: state.slotStart,
        clientName: state.clientName.trim(),
        clientPhone: state.clientPhone.trim(),
        clientNote: state.clientNote.trim() || undefined,
      });
      try {
        window.localStorage.setItem(
          CLIENT_STORAGE_KEY,
          JSON.stringify({ name: state.clientName.trim(), phone: state.clientPhone.trim() })
        );
      } catch {
        // Sin almacenamiento: la próxima vez se vuelven a pedir.
      }
      onSuccess(confirmation);
    } catch (err) {
      if (err instanceof PublicApiError) {
        if (err.code === ERROR_CODES.SLOT_TAKEN) {
          // Refrescar slots y volver al paso de fecha (spec §25)
          dispatch({ type: "REFRESH_SLOTS" });
          dispatch({ type: "SUBMIT_ERROR", error: err.message });
          return;
        }
        dispatch({ type: "SUBMIT_ERROR", error: err.message });
      } else {
        dispatch({
          type: "SUBMIT_ERROR",
          error: "No se pudo completar la reserva. Intenta de nuevo.",
        });
      }
    }
  }, [state, tenant.slug, onSuccess]);

  // ── Transición entre pasos ───────────────────────────────────────────────
  // Hacia adelante entra desde la derecha; al volver, desde la izquierda.
  const stepIndex = STEPS.indexOf(state.step);
  const prevIndexRef = useRef(stepIndex);

  const mountedRef = useRef(false);
  useGsapAnimation(
    ({ gsap }) => {
      const direction = stepIndex >= prevIndexRef.current ? 1 : -1;
      prevIndexRef.current = stepIndex;
      if (!mountedRef.current) return;
      gsap.fromTo(
        stepRef.current,
        { opacity: 0, x: 28 * direction },
        { opacity: 1, x: 0, duration: 0.32, ease: "power3.out", clearProps: "transform" }
      );
    },
    { scope: rootRef, dependencies: [state.step] }
  );

  // En el teléfono, cada paso nuevo empieza a la vista (no a media página).
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    const el = rootRef.current;
    if (el && el.getBoundingClientRect().top < 0) {
      el.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    }
  }, [state.step, reduceMotion]);

  const goTo = (step: Step) => dispatch({ type: "GO_TO_STEP", step });
  const back = stepIndex > 0 ? () => goTo(STEPS[stepIndex - 1]) : undefined;

  return (
    <div ref={rootRef} className="mx-auto max-w-2xl scroll-mt-20">
      <div className="overflow-hidden rounded-card border border-border bg-background-secondary shadow-card">
        <WizardHeader stepIndex={stepIndex} onBack={state.submitting ? undefined : back} />

        {stepIndex > 0 && (
          <SelectionSummary
            barber={selectedBarber}
            services={selectedServices}
            slotStart={stepIndex > 2 ? state.slotStart : null}
            timezone={tenant.timezone}
            onEditBarber={() => goTo("barbero")}
            onEditServices={stepIndex > 1 ? () => goTo("servicio") : undefined}
            onEditDate={stepIndex > 2 ? () => goTo("fecha") : undefined}
            disabled={state.submitting}
          />
        )}

        <div ref={stepRef} className="px-[var(--spacing-card)] pb-[var(--spacing-card)] pt-5">
          {state.step === "barbero" && (
            <StepBarber
              barbers={tenant.barbers}
              selectedId={state.barberId}
              onSelect={(id) => dispatch({ type: "SELECT_BARBER", barberId: id })}
            />
          )}

          {state.step === "servicio" && (
            <StepService
              services={tenant.services}
              selectedIds={state.serviceIds}
              currency={currency}
              onToggle={(id) => dispatch({ type: "TOGGLE_SERVICE", serviceId: id })}
            />
          )}

          {state.step === "fecha" && (
            <StepDateTime
              dates={dates}
              selectedDate={state.date}
              slots={state.slots}
              selectedHour={state.hourKey}
              selectedSlot={state.slotStart}
              timezone={tenant.timezone}
              loading={state.slotsLoading || state.slotsKey !== `${state.barberId}|${serviceKey}|${state.date}`}
              error={state.slotsError}
              notice={state.submitError}
              onSelectDate={(d) => dispatch({ type: "SELECT_DATE", date: d })}
              onSelectHour={(h) => dispatch({ type: "SELECT_HOUR", hourKey: h })}
              onSelectSlot={(s) => dispatch({ type: "SELECT_SLOT", slotStart: s })}
            />
          )}

          {state.step === "datos" && (
            <StepClientData
              name={state.clientName}
              phone={state.clientPhone}
              note={state.clientNote}
              onChangeName={(v) => dispatch({ type: "SET_CLIENT_NAME", value: v })}
              onChangePhone={(v) => dispatch({ type: "SET_CLIENT_PHONE", value: v })}
              onChangeNote={(v) => dispatch({ type: "SET_CLIENT_NOTE", value: v })}
              onSubmit={() => canContinueData(state) && goTo("confirmar")}
            />
          )}

          {state.step === "confirmar" && (
            <StepConfirm
              tenantName={tenant.name}
              barber={selectedBarber!}
              services={selectedServices}
              slotStart={state.slotStart!}
              timezone={tenant.timezone}
              currency={currency}
              clientName={state.clientName}
              clientPhone={state.clientPhone}
              clientNote={state.clientNote}
              error={state.submitError}
              onEditData={() => goTo("datos")}
            />
          )}
        </div>

        {/* Barra de acción: fija abajo en el teléfono mientras se recorre el paso. */}
        {state.step === "servicio" && (
          <ActionBar
            label="Continuar"
            disabled={state.serviceIds.length === 0}
            onClick={() => dispatch({ type: "CONFIRM_SERVICES" })}
            info={
              state.serviceIds.length === 0
                ? "Elige al menos un servicio"
                : `${state.serviceIds.length} ${state.serviceIds.length === 1 ? "servicio" : "servicios"} · ${formatDuration(totals.durationMinutes)}`
            }
            amount={state.serviceIds.length > 0 ? formatPrice(totals.priceCents, currency) : undefined}
          />
        )}
        {state.step === "fecha" && (
          <ActionBar
            label="Continuar"
            disabled={!state.slotStart}
            onClick={() => dispatch({ type: "CONFIRM_SLOT" })}
            info={
              state.slotStart
                ? `${capitalize(formatSlotDate(state.slotStart, tenant.timezone))} · ${formatSlotTime(state.slotStart, tenant.timezone)}`
                : "Elige un horario"
            }
          />
        )}
        {state.step === "datos" && (
          <ActionBar
            label="Revisar reserva"
            disabled={!canContinueData(state)}
            onClick={() => goTo("confirmar")}
          />
        )}
        {state.step === "confirmar" && (
          <ActionBar
            label={state.submitting ? "Reservando…" : "Confirmar reserva"}
            loading={state.submitting}
            disabled={state.submitting}
            onClick={handleSubmit}
            info={formatDuration(totals.durationMinutes)}
            amount={formatPrice(totals.priceCents, currency)}
          />
        )}
      </div>
    </div>
  );
}

function canContinueData(state: WizardState): boolean {
  const digits = state.clientPhone.replace(/\D/g, "").length;
  return state.clientName.trim().length > 0 && digits >= 10 && digits <= 15;
}

// ─── Encabezado: paso, título y progreso ────────────────────────────────────

function WizardHeader({ stepIndex, onBack }: { stepIndex: number; onBack?: () => void }) {
  const progress = (stepIndex + 1) / STEPS.length;
  return (
    <div className="border-b border-border px-[var(--spacing-card)] pb-4 pt-5">
      <div className="flex items-center gap-3">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label="Volver al paso anterior"
            className="-ml-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground transition-[background-color,transform] duration-150 ease-out hover:bg-foreground/5 active:scale-[0.92] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M12.5 15 7.5 10l5-5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="text-label font-sans uppercase tracking-label text-accent">
            Paso {stepIndex + 1} de {STEPS.length}
          </p>
          <h3 className="mt-0.5 text-xl font-display text-foreground" aria-live="polite">
            {STEP_TITLES[STEPS[stepIndex]]}
          </h3>
        </div>
      </div>
      <div
        className="mt-4 h-1 overflow-hidden rounded-full bg-border"
        role="progressbar"
        aria-label="Avance de la reserva"
        aria-valuemin={1}
        aria-valuemax={STEPS.length}
        aria-valuenow={stepIndex + 1}
      >
        <div
          className="h-full origin-left rounded-full bg-accent transition-transform duration-500 ease-out"
          style={{ transform: `scaleX(${progress})` }}
        />
      </div>
    </div>
  );
}

// ─── Resumen de lo elegido (toca para cambiar) ──────────────────────────────

function SelectionSummary({
  barber,
  services,
  slotStart,
  timezone,
  onEditBarber,
  onEditServices,
  onEditDate,
  disabled,
}: {
  barber?: PublicBarber;
  services: PublicService[];
  slotStart: string | null;
  timezone: string;
  onEditBarber: () => void;
  onEditServices?: () => void;
  onEditDate?: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto border-b border-border px-[var(--spacing-card)] py-3 [scrollbar-width:none]">
      {barber && (
        <SummaryChip onClick={onEditBarber} disabled={disabled} label={`Cambiar barbero: ${barber.display_name}`}>
          <Avatar barber={barber} size="xs" />
          {barber.display_name}
        </SummaryChip>
      )}
      {onEditServices && services.length > 0 && (
        <SummaryChip onClick={onEditServices} disabled={disabled} label="Cambiar servicios">
          {services.length === 1 ? services[0].name : `${services.length} servicios`}
        </SummaryChip>
      )}
      {onEditDate && slotStart && (
        <SummaryChip onClick={onEditDate} disabled={disabled} label="Cambiar fecha y hora">
          <span className="capitalize">{formatSlotDate(slotStart, timezone).split(" ").slice(0, 3).join(" ")}</span>
          <span className="tabular-nums">· {formatSlotTime(slotStart, timezone)}</span>
        </SummaryChip>
      )}
    </div>
  );
}

function SummaryChip({
  children,
  onClick,
  disabled,
  label,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-border bg-background px-3 text-sm font-sans text-foreground transition-[border-color,transform] duration-150 ease-out hover:border-accent/60 active:scale-[0.96] disabled:opacity-50"
    >
      {children}
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" className="text-muted">
        <path d="M8.5 1.5 10.5 3.5 4 10H2V8L8.5 1.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

// ─── Barra de acción inferior ───────────────────────────────────────────────

function ActionBar({
  label,
  onClick,
  disabled,
  loading,
  info,
  amount,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  info?: string;
  amount?: string;
}) {
  return (
    <div className="sticky bottom-0 z-10 border-t border-border bg-background-secondary/95 px-[var(--spacing-card)] pb-[calc(0.875rem+env(safe-area-inset-bottom,0px))] pt-3.5 backdrop-blur">
      {(info || amount) && (
        <div className="mb-3 flex items-baseline justify-between gap-3" aria-live="polite">
          <p className="min-w-0 truncate text-sm font-sans text-muted">{info}</p>
          {amount && <p className="shrink-0 font-display text-lg tabular-nums text-accent">{amount}</p>}
        </div>
      )}
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="flex h-14 w-full items-center justify-center gap-2 rounded-button bg-accent text-base font-sans font-semibold text-background transition-[filter,transform,opacity] duration-150 ease-out hover:brightness-110 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
      >
        {loading && <LoadingSpinner className="text-background" />}
        {label}
      </button>
    </div>
  );
}

// ─── Step: Barbero ──────────────────────────────────────────────────────────

function StepBarber({
  barbers,
  selectedId,
  onSelect,
}: {
  barbers: PublicBarber[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {barbers.map((barber) => {
        const selected = selectedId === barber.id;
        return (
          <li key={barber.id}>
            <button
              type="button"
              onClick={() => onSelect(barber.id)}
              aria-pressed={selected}
              className={cn(
                "group flex w-full items-center gap-4 rounded-card border p-4 text-left transition-[background-color,border-color,transform] duration-150 ease-out active:scale-[0.98]",
                "hover:border-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70",
                selected ? "border-accent bg-accent/10" : "border-border bg-background"
              )}
            >
              <Avatar barber={barber} size="lg" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-display text-lg text-foreground">{barber.display_name}</span>
                {barber.role_title && (
                  <span className="mt-0.5 block truncate text-sm font-sans text-muted">{barber.role_title}</span>
                )}
              </span>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true" className="shrink-0 text-muted transition-transform duration-150 ease-out group-hover:translate-x-0.5">
                <path d="m7.5 5 5 5-5 5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Avatar({ barber, size }: { barber: PublicBarber; size: "xs" | "lg" }) {
  const box = size === "lg" ? "h-14 w-14 text-xl" : "h-5 w-5 text-[10px]";
  return barber.photo_url ? (
    // eslint-disable-next-line @next/next/no-img-element -- fotos de barberos con <img> (CLAUDE.md §10)
    <img src={barber.photo_url} alt="" className={cn(box, "shrink-0 rounded-full object-cover")} />
  ) : (
    <span aria-hidden="true" className={cn(box, "flex shrink-0 items-center justify-center rounded-full bg-accent/15 font-display text-accent")}>
      {barber.display_name.charAt(0)}
    </span>
  );
}

// ─── Step: Servicio ─────────────────────────────────────────────────────────

function StepService({
  services,
  selectedIds,
  currency,
  onToggle,
}: {
  services: PublicService[];
  selectedIds: string[];
  currency: string;
  onToggle: (id: string) => void;
}) {
  const headingId = useId();
  const limitReached = selectedIds.length >= MAX_SERVICES_PER_BOOKING;

  return (
    <div>
      <p id={headingId} className="text-body font-sans text-muted">
        Puedes combinar hasta {MAX_SERVICES_PER_BOOKING}. Se hacen en el orden en que los elijas.
      </p>

      <ul className="mt-4 space-y-2.5" aria-labelledby={headingId}>
        {services.map((service) => {
          const position = selectedIds.indexOf(service.id) + 1;
          const isSelected = position > 0;
          const isBlocked = !isSelected && limitReached;

          return (
            <li key={service.id}>
              <button
                type="button"
                aria-pressed={isSelected}
                aria-disabled={isBlocked || undefined}
                onClick={() => {
                  if (!isBlocked) onToggle(service.id);
                }}
                className={cn(
                  "flex w-full items-center gap-4 rounded-card border p-4 text-left transition-[background-color,border-color,transform,opacity] duration-150 ease-out",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70",
                  isSelected ? "border-accent bg-accent/10" : "border-border bg-background",
                  isBlocked ? "cursor-not-allowed opacity-40" : "cursor-pointer hover:border-accent/60 active:scale-[0.98]"
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-sm font-sans font-semibold tabular-nums transition-[background-color,border-color,color,transform] duration-200 ease-out",
                    isSelected ? "scale-100 border-accent bg-accent text-background" : "scale-90 border-border text-transparent"
                  )}
                >
                  {isSelected ? position : ""}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-lg leading-snug text-foreground">{service.name}</span>
                  {service.description && (
                    <span className="mt-0.5 line-clamp-2 block text-sm font-sans text-muted">{service.description}</span>
                  )}
                  <span className="mt-1 block text-sm font-sans text-muted">{formatDuration(service.duration_minutes)}</span>
                  {isSelected && <span className="sr-only">{`, servicio ${position} de la cita`}</span>}
                </span>
                <span className="shrink-0 font-display text-lg tabular-nums text-accent">
                  {formatPrice(service.price_cents, currency)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {limitReached && (
        <p className="mt-4 text-sm font-sans text-accent" role="status">
          Llegaste al máximo de {MAX_SERVICES_PER_BOOKING} servicios. Quita uno para agregar otro.
        </p>
      )}
    </div>
  );
}

// ─── Step: Fecha y Hora ─────────────────────────────────────────────────────

const PERIODS = [
  { key: "manana", label: "Mañana", test: (h: number) => h < 12 },
  { key: "tarde", label: "Tarde", test: (h: number) => h >= 12 && h < 19 },
  { key: "noche", label: "Noche", test: (h: number) => h >= 19 },
] as const;

function StepDateTime({
  dates,
  selectedDate,
  slots,
  selectedHour,
  selectedSlot,
  timezone,
  loading,
  error,
  notice,
  onSelectDate,
  onSelectHour,
  onSelectSlot,
}: {
  dates: { value: string; label: string; isToday: boolean }[];
  selectedDate: string | null;
  slots: string[];
  selectedHour: string | null;
  selectedSlot: string | null;
  timezone: string;
  loading: boolean;
  error: string | null;
  /** Aviso de un intento de reserva fallido (p. ej. horario ocupado). */
  notice: string | null;
  onSelectDate: (date: string) => void;
  onSelectHour: (hourKey: string) => void;
  onSelectSlot: (slot: string) => void;
}) {
  const daysLabelId = useId();

  // Solo agrupa lo que devolvió el backend; no calcula disponibilidad.
  const hourGroups = useMemo(() => groupSlotsByHour(slots, timezone), [slots, timezone]);
  const periods = PERIODS.map((p) => ({
    ...p,
    groups: hourGroups.filter((g) => p.test(Number(g.hourLabel.slice(0, 2)))),
  })).filter((p) => p.groups.length > 0);

  const selectedIndex = dates.findIndex((d) => d.value === selectedDate);
  const nextDate = selectedIndex >= 0 ? dates[selectedIndex + 1] : undefined;
  const empty = !loading && !error && selectedDate && hourGroups.length === 0;

  return (
    <div>
      {notice && (
        <p className="mb-4 rounded-card border border-accent/30 bg-accent/10 px-4 py-3 text-sm font-sans text-accent" role="alert">
          {notice}
        </p>
      )}

      {/* Días: carrusel horizontal con imán */}
      <p id={daysLabelId} className="sr-only">
        Elige un día
      </p>
      <div
        role="radiogroup"
        aria-labelledby={daysLabelId}
        className="-mx-[var(--spacing-card)] flex snap-x snap-mandatory gap-2 overflow-x-auto px-[var(--spacing-card)] pb-1 scroll-px-[var(--spacing-card)] [scrollbar-width:none]"
      >
        {dates.map((d, i) => {
          const checked = selectedDate === d.value;
          const parts = dayParts(d.value);
          return (
            <button
              key={d.value}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={`${i === 0 ? "Hoy, " : i === 1 ? "Mañana, " : ""}${parts.long}`}
              onClick={() => onSelectDate(d.value)}
              className={cn(
                "flex w-[4.25rem] shrink-0 snap-start flex-col items-center rounded-card border py-3 transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.95]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70",
                checked ? "border-accent bg-accent text-background" : "border-border bg-background text-foreground hover:border-accent/60"
              )}
            >
              <span className={cn("text-[11px] font-sans font-medium uppercase tracking-label", checked ? "text-background/80" : "text-muted")}>
                {i === 0 ? "Hoy" : i === 1 ? "Mañ" : parts.weekday}
              </span>
              <span className="mt-0.5 font-display text-2xl leading-none tabular-nums">{parts.day}</span>
              <span className={cn("mt-1 text-[11px] font-sans", checked ? "text-background/80" : "text-muted")}>{parts.month}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-6 min-h-40">
        {loading && <SlotsSkeleton />}

        {!loading && error && (
          <p className="py-6 text-body font-sans text-red-400" role="alert">
            {error}
          </p>
        )}

        {empty && (
          <div className="flex flex-col items-center rounded-card border border-dashed border-border px-4 py-8 text-center">
            <p className="text-body font-sans text-foreground">Este día ya no hay lugares</p>
            <p className="mt-1 text-sm font-sans text-muted">Prueba con otro día.</p>
            {nextDate && (
              <button
                type="button"
                onClick={() => onSelectDate(nextDate.value)}
                className="mt-4 inline-flex h-11 items-center rounded-button border border-accent/50 px-5 text-sm font-sans font-medium text-accent transition-[background-color,transform] duration-150 ease-out hover:bg-accent/10 active:scale-[0.97]"
              >
                Ver el {dayParts(nextDate.value).long}
              </button>
            )}
          </div>
        )}

        {!loading && !error && periods.length > 0 && (
          <div className="space-y-6">
            {periods.map((period) => {
              const active = period.groups.find((g) => g.key === selectedHour) ?? null;
              return (
                <section key={period.key} aria-label={period.label}>
                  <p className="mb-2.5 text-label font-sans uppercase tracking-label text-muted">{period.label}</p>
                  <HourGrid
                    label={`Horas de la ${period.label.toLowerCase()}`}
                    groups={period.groups}
                    value={selectedHour}
                    onChange={onSelectHour}
                  />
                  {active && (
                    <MinutePanel group={active} value={selectedSlot} onChange={onSelectSlot} />
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function dayParts(key: string) {
  const date = new Date(`${key}T12:00:00Z`);
  const fmt = (opts: Intl.DateTimeFormatOptions) => date.toLocaleDateString("es-MX", { timeZone: "UTC", ...opts });
  return {
    weekday: fmt({ weekday: "short" }).replace(".", ""),
    day: fmt({ day: "numeric" }),
    month: fmt({ month: "short" }).replace(".", ""),
    long: fmt({ weekday: "long", day: "numeric", month: "long" }),
  };
}

function HourGrid({
  label,
  groups,
  value,
  onChange,
}: {
  label: string;
  groups: SlotHourGroup[];
  value: string | null;
  onChange: (key: string) => void;
}) {
  return (
    <ChoiceRadioGroup
      label={label}
      value={value}
      onChange={onChange}
      variant="hour"
      options={groups.map((g) => {
        const n = g.slots.length;
        const countLabel = `${n} ${n === 1 ? "lugar" : "lugares"}`;
        return { value: g.key, label: g.hourLabel, sublabel: countLabel, ariaLabel: `${g.hourLabel}, ${countLabel}` };
      })}
    />
  );
}

/** Minutos de la hora elegida, justo debajo de su fila. */
function MinutePanel({
  group,
  value,
  onChange,
}: {
  group: SlotHourGroup;
  value: string | null;
  onChange: (slot: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useGsapAnimation(
    ({ gsap }) => {
      gsap.fromTo(ref.current, { opacity: 0, y: -6 }, { opacity: 1, y: 0, duration: 0.25, ease: "power3.out", clearProps: "transform" });
    },
    { scope: ref, dependencies: [group.key] }
  );

  return (
    <div ref={ref} className="mt-3 rounded-card border border-accent/30 bg-accent/5 p-3">
      <p className="mb-2.5 text-sm font-sans text-muted">
        ¿A qué minuto? <span className="text-foreground">{group.hourLabel.slice(0, 2)} h</span>
      </p>
      <ChoiceRadioGroup
        label={`Minutos de las ${group.hourLabel}`}
        value={value}
        onChange={onChange}
        variant="minute"
        options={group.slots.map((s) => ({ value: s.iso, label: s.label }))}
      />
    </div>
  );
}

function SlotsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Buscando horarios">
      <div className="mb-2.5 h-3 w-16 animate-pulse rounded-full bg-border" />
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="h-14 animate-pulse rounded-button bg-border/60" />
        ))}
      </div>
      <p className="sr-only">Cargando horarios…</p>
    </div>
  );
}

// ─── Radiogroup accesible (hora / minutos) ──────────────────────────────────

interface ChoiceOption {
  value: string;
  label: string;
  sublabel?: string;
  ariaLabel?: string;
}

/**
 * Grupo de botones con semántica de radio: roving tabindex (Tab entra y sale
 * del grupo; flechas, Inicio y Fin mueven el foco y la selección).
 */
function ChoiceRadioGroup({
  label,
  options,
  value,
  onChange,
  variant,
}: {
  label: string;
  options: ChoiceOption[];
  value: string | null;
  onChange: (value: string) => void;
  variant: "hour" | "minute";
}) {
  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = options.findIndex((o) => o.value === value);
  const tabStop = selectedIndex >= 0 ? selectedIndex : 0;

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = options.length - 1;
    let next: number;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = index === last ? 0 : index + 1;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = index === 0 ? last : index - 1;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = last;
        break;
      default:
        return;
    }
    event.preventDefault();
    buttonsRef.current[next]?.focus();
    onChange(options[next].value);
  }

  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-4 gap-2 sm:grid-cols-6">
      {options.map((option, i) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              buttonsRef.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={option.ariaLabel}
            tabIndex={i === tabStop ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(e) => handleKeyDown(e, i)}
            className={cn(
              "flex min-w-0 flex-col items-center justify-center rounded-button border px-1 font-sans font-medium tabular-nums transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.95]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70",
              variant === "hour" ? "h-14 text-base" : "h-11 text-sm",
              checked
                ? variant === "minute"
                  ? "border-accent bg-accent text-background"
                  : "border-accent bg-accent/15 text-accent"
                : "border-border bg-background text-foreground hover:border-accent/60"
            )}
          >
            <span>{option.label}</span>
            {option.sublabel && (
              <span className={cn("text-[11px] font-normal", checked ? "text-accent/80" : "text-muted")}>
                {option.sublabel}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── Step: Datos del cliente ────────────────────────────────────────────────

const INPUT =
  "mt-1.5 block h-14 w-full rounded-button border border-border bg-background px-4 text-base font-sans text-foreground placeholder:text-muted/50 transition-[border-color,box-shadow] duration-150 ease-out focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30";

function StepClientData({
  name,
  phone,
  note,
  onChangeName,
  onChangePhone,
  onChangeNote,
  onSubmit,
}: {
  name: string;
  phone: string;
  note: string;
  onChangeName: (v: string) => void;
  onChangePhone: (v: string) => void;
  onChangeNote: (v: string) => void;
  onSubmit: () => void;
}) {
  // Pre-chequeo amable: al menos 10 dígitos. La normalización y validación
  // real (E.164) ocurren en el servidor, dentro de book_appointment.
  const phoneDigits = phone.replace(/\D/g, "").length;
  const phoneTouched = phone.trim().length > 0;
  const phoneValid = phoneDigits >= 10 && phoneDigits <= 15;

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <p className="text-body font-sans text-muted">Solo para confirmar tu cita. No te enviaremos publicidad.</p>
      <div>
        <label htmlFor="booking-name" className="block text-sm font-sans font-medium text-foreground">
          Tu nombre
        </label>
        <input
          id="booking-name"
          type="text"
          value={name}
          onChange={(e) => onChangeName(e.target.value)}
          placeholder="Nombre y apellido"
          required
          maxLength={120}
          autoComplete="name"
          autoCapitalize="words"
          enterKeyHint="next"
          className={INPUT}
        />
      </div>

      <div>
        <label htmlFor="booking-phone" className="block text-sm font-sans font-medium text-foreground">
          Tu WhatsApp o teléfono
        </label>
        <input
          id="booking-phone"
          type="tel"
          value={phone}
          onChange={(e) => onChangePhone(e.target.value)}
          placeholder="55 1234 5678"
          required
          maxLength={30}
          autoComplete="tel"
          inputMode="tel"
          enterKeyHint="next"
          aria-invalid={phoneTouched && !phoneValid ? true : undefined}
          aria-describedby="booking-phone-help"
          className={cn(INPUT, "tabular-nums")}
        />
        <p id="booking-phone-help" className={cn("mt-1.5 text-sm font-sans", phoneTouched && !phoneValid ? "text-accent" : "text-muted")}>
          {phoneTouched && !phoneValid
            ? `Faltan dígitos: llevas ${phoneDigits} de 10.`
            : "10 dígitos. Ahí te avisamos si hay algún cambio."}
        </p>
      </div>

      <div>
        <label htmlFor="booking-note" className="block text-sm font-sans font-medium text-foreground">
          Nota <span className="font-normal text-muted">(opcional)</span>
        </label>
        <textarea
          id="booking-note"
          value={note}
          onChange={(e) => onChangeNote(e.target.value)}
          placeholder="¿Algo que debamos saber?"
          rows={3}
          maxLength={500}
          enterKeyHint="done"
          className={cn(INPUT, "h-auto resize-none py-3")}
        />
      </div>
      {/* Enter en el teclado del teléfono envía el formulario. */}
      <button type="submit" className="sr-only" tabIndex={-1}>
        Revisar reserva
      </button>
    </form>
  );
}

// ─── Step: Confirmar ────────────────────────────────────────────────────────

function StepConfirm({
  tenantName,
  barber,
  services,
  slotStart,
  timezone,
  currency,
  clientName,
  clientPhone,
  clientNote,
  error,
  onEditData,
}: {
  tenantName: string;
  barber: PublicBarber;
  services: PublicService[];
  slotStart: string;
  timezone: string;
  currency: string;
  clientName: string;
  clientPhone: string;
  clientNote: string;
  error: string | null;
  onEditData: () => void;
}) {
  const dateStr = capitalize(formatSlotDate(slotStart, timezone));
  const timeStr = formatSlotTime(slotStart, timezone);
  // Totales orientativos con el catálogo público; los definitivos los
  // devuelve book_appointment y se muestran en la pantalla de éxito.
  const totals = sumServices(services);

  return (
    <div className="space-y-4">
      <div className="rounded-card border border-border bg-background">
        <div className="flex items-center gap-4 p-4">
          <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-card bg-accent text-background">
            <span className="font-display text-2xl leading-none tabular-nums">{timeStr}</span>
          </div>
          <div className="min-w-0">
            <p className="font-display text-lg leading-snug text-foreground">{dateStr}</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-sm font-sans text-muted">
              con <span className="text-foreground">{barber.display_name}</span> · {tenantName}
            </p>
          </div>
        </div>
        <div className="border-t border-dashed border-border p-4">
          <ol className="space-y-2.5">
            {services.map((s) => (
              <li key={s.id} className="flex items-baseline justify-between gap-4 text-body font-sans">
                <span className="min-w-0">
                  <span className="block text-foreground">{s.name}</span>
                  <span className="block text-sm text-muted">{formatDuration(s.duration_minutes)}</span>
                </span>
                <span className="shrink-0 tabular-nums text-foreground">{formatPrice(s.price_cents, currency)}</span>
              </li>
            ))}
          </ol>
          <div className="mt-3 flex items-baseline justify-between gap-4 border-t border-border pt-3">
            <span className="text-sm font-sans text-muted">Total · {formatDuration(totals.durationMinutes)}</span>
            <span className="font-display text-xl tabular-nums text-accent">{formatPrice(totals.priceCents, currency)}</span>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={onEditData}
        className="flex w-full items-center justify-between gap-3 rounded-card border border-border bg-background p-4 text-left transition-[border-color,transform] duration-150 ease-out hover:border-accent/60 active:scale-[0.99]"
      >
        <span className="min-w-0">
          <span className="block truncate text-body font-sans text-foreground">{clientName}</span>
          <span className="block text-sm font-sans tabular-nums text-muted">{clientPhone}</span>
          {clientNote && <span className="mt-1 line-clamp-2 block text-sm font-sans italic text-muted">“{clientNote}”</span>}
        </span>
        <span className="shrink-0 text-sm font-sans text-accent">Editar</span>
      </button>

      <p className="text-sm font-sans text-muted">Pagas en la barbería. Puedes cancelar avisando por WhatsApp.</p>

      {error && (
        <p className="rounded-card border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-sans text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Servicios del catálogo en el orden de `ids` (ignora ids desconocidos). */
function pickServices(
  catalog: PublicService[],
  ids: readonly string[]
): PublicService[] {
  return ids
    .map((id) => catalog.find((s) => s.id === id))
    .filter((s): s is PublicService => s !== undefined);
}

/** Suma de duración (min) y precio (centavos, enteros) de los servicios. */
function sumServices(services: readonly PublicService[]): {
  durationMinutes: number;
  priceCents: number;
} {
  return services.reduce(
    (acc, s) => ({
      durationMinutes: acc.durationMinutes + s.duration_minutes,
      priceCents: acc.priceCents + s.price_cents,
    }),
    { durationMinutes: 0, priceCents: 0 }
  );
}

function LoadingSpinner({ className }: { className?: string }) {
  return (
    <svg className={cn("h-5 w-5 animate-spin text-accent", className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-20" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
