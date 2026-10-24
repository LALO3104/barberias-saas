"use client";

import Image from "next/image";
import {
  useReducer,
  useCallback,
  useRef,
  useEffect,
  useId,
  useMemo,
  type KeyboardEvent,
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
} from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import type { PublicTenant, PublicBarber, PublicService, BookingConfirmation } from "@/types/public";

// ─── Steps ──────────────────────────────────────────────────────────────────

const STEPS = ["barbero", "servicio", "fecha", "datos", "confirmar"] as const;
type Step = (typeof STEPS)[number];

const STEP_LABELS: Record<Step, string> = {
  barbero: "Barbero",
  servicio: "Servicios",
  fecha: "Fecha y hora",
  datos: "Tus datos",
  confirmar: "Confirmar",
};

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
  | { type: "SLOTS_LOADED"; slots: string[] }
  | { type: "SLOTS_ERROR"; error: string }
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
  clientName: "",
  clientPhone: "",
  clientNote: "",
  submitting: false,
  submitError: null,
};

/**
 * Cambiar barbero, servicios o fecha invalida la hora, el minuto y los
 * horarios cargados: se vuelven a pedir al backend al llegar a "fecha".
 */
const CLEARED_SLOTS = {
  hourKey: null,
  slotStart: null,
  slots: [],
  slotsError: null,
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
        slots: action.slots,
        hourKey: keep ? state.hourKey : null,
        slotStart: keep ? state.slotStart : null,
      };
    }
    case "SLOTS_ERROR":
      return {
        ...state,
        slotsLoading: false,
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
  const [state, dispatch] = useReducer(wizardReducer, initialState);
  const currency = tenant.currency ?? "MXN";
  const sectionRef = useRef<HTMLDivElement>(null);

  const selectedBarber = tenant.barbers.find((b) => b.id === state.barberId);
  const selectedServices = pickServices(tenant.services, state.serviceIds);
  const dates = getUpcomingDates(tenant.timezone, 14);

  // ── Fetch slots ──────────────────────────────────────────────────────────
  // Se piden al estar en el paso "fecha" y cada vez que cambian barbero,
  // servicios o fecha. Los UUID no contienen comas: la clave es estable.
  const serviceKey = state.serviceIds.join(",");
  const wantsSlots = state.step === "fecha";

  useEffect(() => {
    if (!wantsSlots || !state.barberId || !serviceKey || !state.date) return;

    const supabase = getSupabaseClient();
    if (!supabase) return;

    const barberId = state.barberId;
    const date = state.date;
    const serviceIds = serviceKey.split(",");
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
            slots: slots.map((s) => s.slot_start),
          });
        }
      } catch (err) {
        if (!cancelled) {
          dispatch({
            type: "SLOTS_ERROR",
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

  // ── Step indicator ───────────────────────────────────────────────────────
  const currentStepIndex = STEPS.indexOf(state.step);

  return (
    <div ref={sectionRef}>
      {/* Step indicator */}
      <div className="mb-8 flex items-center gap-2 overflow-x-auto pb-2" role="navigation" aria-label="Pasos de la reserva">
        {STEPS.map((step, i) => {
          const isActive = i === currentStepIndex;
          const isCompleted = i < currentStepIndex;
          const isClickable = isCompleted;

          return (
            <button
              key={step}
              type="button"
              disabled={!isClickable}
              onClick={() => isClickable && dispatch({ type: "GO_TO_STEP", step })}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-button px-3 py-2 text-label font-sans uppercase tracking-label transition-colors",
                isActive && "bg-accent/10 text-accent",
                isCompleted && "cursor-pointer text-accent/70 hover:text-accent",
                !isActive && !isCompleted && "cursor-default text-muted/50"
              )}
              aria-current={isActive ? "step" : undefined}
            >
              <span
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium",
                  isActive && "bg-accent text-background",
                  isCompleted && "bg-accent/20 text-accent",
                  !isActive && !isCompleted && "bg-border text-muted/50"
                )}
              >
                {isCompleted ? "✓" : i + 1}
              </span>
              <span className="hidden sm:inline">{STEP_LABELS[step]}</span>
            </button>
          );
        })}
      </div>

      {/* Step content */}
      <div className="rounded-card border border-border bg-background-secondary p-[var(--spacing-card)]">
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
            onContinue={() => dispatch({ type: "CONFIRM_SERVICES" })}
            onBack={() => dispatch({ type: "GO_TO_STEP", step: "barbero" })}
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
            loading={state.slotsLoading}
            error={state.slotsError}
            notice={state.submitError}
            onSelectDate={(d) => dispatch({ type: "SELECT_DATE", date: d })}
            onSelectHour={(h) => dispatch({ type: "SELECT_HOUR", hourKey: h })}
            onSelectSlot={(s) => dispatch({ type: "SELECT_SLOT", slotStart: s })}
            onContinue={() => dispatch({ type: "CONFIRM_SLOT" })}
            onBack={() => dispatch({ type: "GO_TO_STEP", step: "servicio" })}
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
            onContinue={() => dispatch({ type: "GO_TO_STEP", step: "confirmar" })}
            onBack={() => dispatch({ type: "GO_TO_STEP", step: "fecha" })}
          />
        )}

        {state.step === "confirmar" && (
          <StepConfirm
            barber={selectedBarber!}
            services={selectedServices}
            slotStart={state.slotStart!}
            timezone={tenant.timezone}
            currency={currency}
            clientName={state.clientName}
            clientPhone={state.clientPhone}
            clientNote={state.clientNote}
            submitting={state.submitting}
            error={state.submitError}
            onConfirm={handleSubmit}
            onBack={() => dispatch({ type: "GO_TO_STEP", step: "datos" })}
          />
        )}
      </div>
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
    <div>
      <h3 className="text-lg font-display text-foreground">
        Elige tu barbero
      </h3>
      <p className="mt-1 text-body font-sans text-muted">
        Selecciona con quién quieres tu cita.
      </p>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {barbers.map((barber) => (
          <button
            key={barber.id}
            type="button"
            onClick={() => onSelect(barber.id)}
            className={cn(
              "flex items-center gap-4 rounded-card border p-4 text-left transition-all",
              "hover:border-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              selectedId === barber.id
                ? "border-accent bg-accent/5"
                : "border-border bg-background"
            )}
          >
            {barber.photo_url ? (
              <Image
                src={barber.photo_url}
                alt={barber.display_name}
                width={48}
                height={48}
                className="h-12 w-12 shrink-0 rounded-full object-cover"
                unoptimized
              />
            ) : (
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent font-display text-lg">
                {barber.display_name.charAt(0)}
              </div>
            )}
            <div className="min-w-0">
              <p className="font-display text-foreground truncate">
                {barber.display_name}
              </p>
              {barber.role_title && (
                <p className="text-label font-sans text-muted truncate">
                  {barber.role_title}
                </p>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Step: Servicio ─────────────────────────────────────────────────────────

function StepService({
  services,
  selectedIds,
  currency,
  onToggle,
  onContinue,
  onBack,
}: {
  services: PublicService[];
  selectedIds: string[];
  currency: string;
  onToggle: (id: string) => void;
  onContinue: () => void;
  onBack: () => void;
}) {
  const headingId = useId();
  const selected = pickServices(services, selectedIds);
  const totals = sumServices(selected);
  const count = selectedIds.length;
  const limitReached = count >= MAX_SERVICES_PER_BOOKING;

  return (
    <div>
      <div className="flex items-center gap-3">
        <BackButton onClick={onBack} />
        <h3 id={headingId} className="text-lg font-display text-foreground">
          Elige tus servicios
        </h3>
      </div>
      <p className="mt-1 text-body font-sans text-muted">
        Puedes combinar hasta {MAX_SERVICES_PER_BOOKING} servicios en una misma
        cita. Se realizan en el orden en que los elijas.
      </p>

      <ul className="mt-6" aria-labelledby={headingId}>
        {services.map((service) => {
          const position = selectedIds.indexOf(service.id) + 1;
          const isSelected = position > 0;
          const isBlocked = !isSelected && limitReached;

          return (
            <li key={service.id} className="border-b border-border last:border-b-0">
              <button
                type="button"
                aria-pressed={isSelected}
                aria-disabled={isBlocked || undefined}
                onClick={() => {
                  if (!isBlocked) onToggle(service.id);
                }}
                className={cn(
                  "flex w-full items-center gap-4 rounded-sm px-2 py-4 text-left transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background-secondary",
                  isSelected && "bg-accent/5",
                  isBlocked
                    ? "cursor-not-allowed opacity-50"
                    : "cursor-pointer hover:bg-accent/5"
                )}
              >
                {/* Indicador: número de orden cuando está elegido */}
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-button border text-xs font-sans font-medium transition-colors",
                    isSelected
                      ? "border-accent bg-accent text-background"
                      : "border-border text-transparent"
                  )}
                >
                  {isSelected ? position : ""}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-foreground">
                    {service.name}
                  </span>
                  {service.description && (
                    <span className="mt-0.5 block truncate text-sm font-sans text-muted">
                      {service.description}
                    </span>
                  )}
                  <span className="mt-1 block text-label font-sans uppercase tracking-label text-muted">
                    {formatDuration(service.duration_minutes)}
                  </span>
                  {isSelected && (
                    <span className="sr-only">
                      {`, servicio ${position} de la cita`}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-lg font-display text-accent">
                  {formatPrice(service.price_cents, currency)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {/* Resumen de la selección */}
      <div className="mt-6 rounded-card border border-border bg-background px-5 py-4">
        <div aria-live="polite" aria-atomic="true">
          {count === 0 ? (
            <p className="text-body font-sans text-muted">
              Aún no eliges ningún servicio.
            </p>
          ) : (
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="text-label font-sans uppercase tracking-label text-muted">
                {count} de {MAX_SERVICES_PER_BOOKING}{" "}
                {count === 1 ? "servicio" : "servicios"} ·{" "}
                {formatDuration(totals.durationMinutes)}
              </p>
              <p className="text-lg font-display text-accent">
                {formatPrice(totals.priceCents, currency)}
              </p>
            </div>
          )}
          {limitReached && (
            <p className="mt-2 text-sm font-sans text-accent">
              Llegaste al máximo de {MAX_SERVICES_PER_BOOKING} servicios por
              cita. Quita uno para agregar otro.
            </p>
          )}
        </div>
      </div>

      <div className="mt-8">
        <Button
          type="button"
          size="lg"
          disabled={count === 0}
          onClick={onContinue}
        >
          Continuar
        </Button>
      </div>
    </div>
  );
}

// ─── Step: Fecha y Hora ─────────────────────────────────────────────────────

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
  onContinue,
  onBack,
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
  onContinue: () => void;
  onBack: () => void;
}) {
  const hoursLabelId = useId();
  const minutesLabelId = useId();

  // Solo agrupa lo que devolvió el backend; no calcula disponibilidad.
  const hourGroups = useMemo(
    () => groupSlotsByHour(slots, timezone),
    [slots, timezone]
  );
  const activeGroup = hourGroups.find((g) => g.key === selectedHour) ?? null;
  const selectedMinute =
    activeGroup?.slots.find((s) => s.iso === selectedSlot) ?? null;

  return (
    <div>
      <div className="flex items-center gap-3">
        <BackButton onClick={onBack} />
        <h3 className="text-lg font-display text-foreground">
          Fecha y horario
        </h3>
      </div>
      <p className="mt-1 text-body font-sans text-muted">
        Elige un día, después la hora y por último los minutos.
      </p>

      {notice && (
        <p
          className="mt-4 rounded-card border border-accent/20 bg-accent/5 px-5 py-3 text-sm font-sans text-accent"
          role="alert"
        >
          {notice}
        </p>
      )}

      {/* Date picker — horizontal scroll */}
      <div className="mt-6">
        <fieldset>
          <legend className="text-label font-sans uppercase tracking-label text-muted mb-3">
            Selecciona una fecha
          </legend>
          <div className="flex gap-2 overflow-x-auto pb-2" role="radiogroup">
            {dates.map((d) => (
              <button
                key={d.value}
                type="button"
                role="radio"
                aria-checked={selectedDate === d.value}
                onClick={() => onSelectDate(d.value)}
                className={cn(
                  "flex shrink-0 flex-col items-center rounded-card border px-4 py-3 transition-all",
                  "hover:border-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background-secondary",
                  selectedDate === d.value
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border text-muted"
                )}
              >
                <span className="text-sm font-sans font-medium capitalize">
                  {d.label}
                </span>
                {d.isToday && (
                  <span className="mt-0.5 text-[10px] font-sans uppercase tracking-wider text-accent">
                    Hoy
                  </span>
                )}
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      {/* Horarios: hora → minutos */}
      {selectedDate && (
        <div className="mt-6">
          <p
            id={hoursLabelId}
            className="text-label font-sans uppercase tracking-label text-muted mb-3"
          >
            Elige la hora
          </p>
          {loading && (
            <div className="flex items-center gap-3 py-8 text-body font-sans text-muted">
              <LoadingSpinner />
              Cargando horarios...
            </div>
          )}
          {error && (
            <p className="py-8 text-body font-sans text-red-400" role="alert">
              {error}
            </p>
          )}
          {!loading && !error && hourGroups.length === 0 && (
            <p className="py-8 text-body font-sans text-muted">
              No hay horarios disponibles para este día. Prueba con otra fecha.
            </p>
          )}
          {!loading && !error && hourGroups.length > 0 && (
            <>
              <ChoiceRadioGroup
                labelId={hoursLabelId}
                value={selectedHour}
                onChange={onSelectHour}
                variant="hour"
                options={hourGroups.map((g) => {
                  const n = g.slots.length;
                  const countLabel = `${n} ${n === 1 ? "horario" : "horarios"}`;
                  return {
                    value: g.key,
                    label: g.hourLabel,
                    sublabel: countLabel,
                    ariaLabel: `${g.hourLabel}, ${countLabel} disponibles`,
                  };
                })}
              />

              {activeGroup && (
                <div className="mt-6">
                  <p
                    id={minutesLabelId}
                    className="text-label font-sans uppercase tracking-label text-muted mb-3"
                  >
                    Elige los minutos ({activeGroup.hourLabel})
                  </p>
                  <ChoiceRadioGroup
                    labelId={minutesLabelId}
                    value={selectedSlot}
                    onChange={onSelectSlot}
                    variant="minute"
                    options={activeGroup.slots.map((s) => ({
                      value: s.iso,
                      label: s.label,
                    }))}
                  />
                </div>
              )}

              {selectedMinute && (
                <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-body font-sans text-muted" aria-live="polite">
                    <span className="capitalize">
                      {formatSlotDate(selectedMinute.iso, timezone)}
                    </span>{" "}
                    a las{" "}
                    <span className="text-foreground">{selectedMinute.label}</span>
                  </p>
                  <Button type="button" size="lg" onClick={onContinue}>
                    Continuar
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}
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
  labelId,
  options,
  value,
  onChange,
  variant,
}: {
  labelId: string;
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
    <div
      role="radiogroup"
      aria-labelledby={labelId}
      className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6"
    >
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
              "flex min-h-11 min-w-0 flex-col items-center justify-center rounded-button border px-2 py-2.5 text-sm font-sans font-medium tabular-nums transition-all",
              "hover:border-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background-secondary",
              checked
                ? variant === "minute"
                  ? "border-accent bg-accent text-background"
                  : "border-accent bg-accent/10 text-accent"
                : "border-border text-foreground"
            )}
          >
            <span className="break-words text-center">{option.label}</span>
            {option.sublabel && (
              <span
                className={cn(
                  "mt-0.5 text-xs font-normal",
                  checked ? "text-accent/80" : "text-muted"
                )}
              >
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

function StepClientData({
  name,
  phone,
  note,
  onChangeName,
  onChangePhone,
  onChangeNote,
  onContinue,
  onBack,
}: {
  name: string;
  phone: string;
  note: string;
  onChangeName: (v: string) => void;
  onChangePhone: (v: string) => void;
  onChangeNote: (v: string) => void;
  onContinue: () => void;
  onBack: () => void;
}) {
  const nameValid = name.trim().length > 0;
  // Pre-chequeo amable: al menos 10 dígitos. La normalización y validación
  // real (E.164) ocurren en el servidor, dentro de book_appointment.
  const phoneDigits = phone.replace(/\D/g, "").length;
  const phoneValid = phoneDigits >= 10 && phoneDigits <= 15;
  const canContinue = nameValid && phoneValid;

  return (
    <div>
      <div className="flex items-center gap-3">
        <BackButton onClick={onBack} />
        <h3 className="text-lg font-display text-foreground">Tus datos</h3>
      </div>
      <p className="mt-1 text-body font-sans text-muted">
        Necesitamos tu nombre y teléfono para la reserva.
      </p>

      <div className="mt-6 max-w-md space-y-5">
        <div>
          <label
            htmlFor="booking-name"
            className="block text-label font-sans uppercase tracking-label text-muted"
          >
            Nombre *
          </label>
          <input
            id="booking-name"
            type="text"
            value={name}
            onChange={(e) => onChangeName(e.target.value)}
            placeholder="Tu nombre completo"
            required
            autoComplete="name"
            className="mt-1.5 w-full rounded-button border border-border bg-background px-4 py-3 text-body font-sans text-foreground placeholder:text-muted/50 transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
          {name.length > 0 && !nameValid && (
            <p className="mt-1 text-sm text-red-400" role="alert">
              El nombre es obligatorio.
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="booking-phone"
            className="block text-label font-sans uppercase tracking-label text-muted"
          >
            Teléfono *
          </label>
          <input
            id="booking-phone"
            type="tel"
            value={phone}
            onChange={(e) => onChangePhone(e.target.value)}
            placeholder="55 1234 5678"
            required
            autoComplete="tel"
            inputMode="tel"
            className="mt-1.5 w-full rounded-button border border-border bg-background px-4 py-3 text-body font-sans text-foreground placeholder:text-muted/50 transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
          <p className="mt-1 text-sm text-muted">
            10 dígitos. Puedes escribirlo con espacios o guiones.
          </p>
        </div>

        <div>
          <label
            htmlFor="booking-note"
            className="block text-label font-sans uppercase tracking-label text-muted"
          >
            Nota <span className="normal-case tracking-normal">(opcional)</span>
          </label>
          <textarea
            id="booking-note"
            value={note}
            onChange={(e) => onChangeNote(e.target.value)}
            placeholder="¿Algo que debamos saber?"
            rows={3}
            className="mt-1.5 w-full resize-none rounded-button border border-border bg-background px-4 py-3 text-body font-sans text-foreground placeholder:text-muted/50 transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        </div>
      </div>

      <div className="mt-8">
        <Button
          type="button"
          size="lg"
          disabled={!canContinue}
          onClick={onContinue}
        >
          Revisar reserva
        </Button>
      </div>
    </div>
  );
}

// ─── Step: Confirmar ────────────────────────────────────────────────────────

function StepConfirm({
  barber,
  services,
  slotStart,
  timezone,
  currency,
  clientName,
  clientPhone,
  clientNote,
  submitting,
  error,
  onConfirm,
  onBack,
}: {
  barber: PublicBarber;
  services: PublicService[];
  slotStart: string;
  timezone: string;
  currency: string;
  clientName: string;
  clientPhone: string;
  clientNote: string;
  submitting: boolean;
  error: string | null;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const date = new Date(slotStart);
  const dateStr = date.toLocaleDateString("es-MX", {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const timeStr = formatSlotTime(slotStart, timezone);
  // Totales orientativos con el catálogo público; los definitivos los
  // devuelve book_appointment y se muestran en la pantalla de éxito.
  const totals = sumServices(services);

  return (
    <div>
      <div className="flex items-center gap-3">
        <BackButton onClick={onBack} />
        <h3 className="text-lg font-display text-foreground">
          Confirma tu reserva
        </h3>
      </div>
      <p className="mt-1 text-body font-sans text-muted">
        Revisa los datos antes de confirmar.
      </p>

      <div className="mt-6 max-w-lg space-y-4">
        <ConfirmRow label="Barbero" value={barber.display_name} />
        <div className="py-1.5">
          <p className="text-body font-sans text-muted">
            {services.length === 1 ? "Servicio" : "Servicios"}
          </p>
          <ol className="mt-2 space-y-2 border-l border-border pl-4">
            {services.map((s) => (
              <li
                key={s.id}
                className="flex items-baseline justify-between gap-4 text-body font-sans"
              >
                <span className="min-w-0">
                  <span className="block text-foreground">{s.name}</span>
                  <span className="block text-sm text-muted">
                    {formatDuration(s.duration_minutes)}
                  </span>
                </span>
                <span className="shrink-0 text-foreground">
                  {formatPrice(s.price_cents, currency)}
                </span>
              </li>
            ))}
          </ol>
        </div>
        <ConfirmRow
          label="Duración total"
          value={formatDuration(totals.durationMinutes)}
          capitalize={false}
        />
        <ConfirmRow
          label="Precio total"
          value={formatPrice(totals.priceCents, currency)}
          capitalize={false}
        />
        <ConfirmRow label="Fecha" value={dateStr} />
        <ConfirmRow label="Hora" value={timeStr} />
        <div className="border-t border-border pt-4">
          <ConfirmRow label="Nombre" value={clientName} />
          <ConfirmRow label="Teléfono" value={clientPhone} />
          {clientNote && <ConfirmRow label="Nota" value={clientNote} />}
        </div>
      </div>

      {error && (
        <p className="mt-4 text-body font-sans text-red-400" role="alert">
          {error}
        </p>
      )}

      <div className="mt-8 flex flex-wrap gap-3">
        <Button
          type="button"
          size="lg"
          disabled={submitting}
          onClick={onConfirm}
        >
          {submitting ? "Procesando..." : "Confirmar reserva"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="lg"
          disabled={submitting}
          onClick={onBack}
        >
          Volver
        </Button>
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

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

// ─── Shared sub-components ──────────────────────────────────────────────────

function ConfirmRow({
  label,
  value,
  capitalize = true,
}: {
  label: string;
  value: string;
  /** false para valores como "1 h 30 min" que no deben capitalizarse. */
  capitalize?: boolean;
}) {
  return (
    <div className="flex justify-between gap-4 py-1.5">
      <span className="text-body font-sans text-muted">{label}</span>
      <span
        className={cn(
          "text-body font-sans text-foreground text-right",
          capitalize && "capitalize"
        )}
      >
        {value}
      </span>
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Volver al paso anterior"
      className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted transition-colors hover:border-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M10 12L6 8l4-4"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

function LoadingSpinner() {
  return (
    <svg
      className="h-5 w-5 animate-spin text-accent"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
        className="opacity-20"
      />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
