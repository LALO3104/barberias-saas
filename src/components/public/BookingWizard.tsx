"use client";

import Image from "next/image";
import { useReducer, useCallback, useRef, useEffect } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import {
  fetchAvailableSlots,
  bookAppointment,
  PublicApiError,
  ERROR_CODES,
} from "@/lib/public-api";
import {
  formatPrice,
  formatDuration,
  formatSlotTime,
  getUpcomingDates,
} from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import type { PublicTenant, PublicBarber, PublicService, BookingConfirmation } from "@/types/public";

// ─── Steps ──────────────────────────────────────────────────────────────────

const STEPS = ["barbero", "servicio", "fecha", "datos", "confirmar"] as const;
type Step = (typeof STEPS)[number];

const STEP_LABELS: Record<Step, string> = {
  barbero: "Barbero",
  servicio: "Servicio",
  fecha: "Fecha y hora",
  datos: "Tus datos",
  confirmar: "Confirmar",
};

// ─── State ──────────────────────────────────────────────────────────────────

interface WizardState {
  step: Step;
  barberId: string | null;
  serviceId: string | null;
  date: string | null; // YYYY-MM-DD
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
  | { type: "SELECT_SERVICE"; serviceId: string }
  | { type: "SELECT_DATE"; date: string }
  | { type: "SELECT_SLOT"; slotStart: string }
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
  serviceId: null,
  date: null,
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

function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "SELECT_BARBER":
      return {
        ...state,
        barberId: action.barberId,
        // Limpiar slots al cambiar barbero (spec §19)
        slotStart: null,
        slots: [],
        slotsError: null,
        step: "servicio",
      };
    case "SELECT_SERVICE":
      return {
        ...state,
        serviceId: action.serviceId,
        // Limpiar slots al cambiar servicio (spec §20)
        slotStart: null,
        slots: [],
        slotsError: null,
        step: "fecha",
      };
    case "SELECT_DATE":
      return {
        ...state,
        date: action.date,
        slotStart: null,
        slots: [],
        slotsError: null,
      };
    case "SELECT_SLOT":
      return { ...state, slotStart: action.slotStart, step: "datos" };
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
    case "SLOTS_LOADED":
      return { ...state, slotsLoading: false, slots: action.slots };
    case "SLOTS_ERROR":
      return { ...state, slotsLoading: false, slotsError: action.error, slots: [] };
    case "SUBMIT_START":
      return { ...state, submitting: true, submitError: null };
    case "SUBMIT_ERROR":
      return { ...state, submitting: false, submitError: action.error };
    case "REFRESH_SLOTS":
      return { ...state, slotStart: null, slots: [], step: "fecha" };
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
  const selectedService = tenant.services.find((s) => s.id === state.serviceId);
  const dates = getUpcomingDates(tenant.timezone, 14);

  // ── Fetch slots when date changes ────────────────────────────────────────
  useEffect(() => {
    if (!state.barberId || !state.serviceId || !state.date) return;

    const supabase = getSupabaseClient();
    if (!supabase) return;

    let cancelled = false;

    async function loadSlots() {
      dispatch({ type: "SLOTS_LOADING" });
      try {
        const slots = await fetchAvailableSlots(
          supabase!,
          tenant.slug,
          state.barberId!,
          state.serviceId!,
          state.date!
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
  }, [state.barberId, state.serviceId, state.date, tenant.slug]);

  // ── Submit booking ───────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (!state.barberId || !state.serviceId || !state.slotStart) return;
    if (!state.clientName.trim() || !state.clientPhone.trim()) return;

    const supabase = getSupabaseClient();
    if (!supabase) return;

    dispatch({ type: "SUBMIT_START" });
    try {
      const confirmation = await bookAppointment(supabase, {
        slug: tenant.slug,
        barberId: state.barberId,
        serviceId: state.serviceId,
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
            selectedId={state.serviceId}
            currency={currency}
            onSelect={(id) => dispatch({ type: "SELECT_SERVICE", serviceId: id })}
            onBack={() => dispatch({ type: "GO_TO_STEP", step: "barbero" })}
          />
        )}

        {state.step === "fecha" && (
          <StepDateTime
            dates={dates}
            selectedDate={state.date}
            slots={state.slots}
            selectedSlot={state.slotStart}
            timezone={tenant.timezone}
            loading={state.slotsLoading}
            error={state.slotsError}
            onSelectDate={(d) => dispatch({ type: "SELECT_DATE", date: d })}
            onSelectSlot={(s) => dispatch({ type: "SELECT_SLOT", slotStart: s })}
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
            service={selectedService!}
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
  selectedId,
  currency,
  onSelect,
  onBack,
}: {
  services: PublicService[];
  selectedId: string | null;
  currency: string;
  onSelect: (id: string) => void;
  onBack: () => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <BackButton onClick={onBack} />
        <h3 className="text-lg font-display text-foreground">
          Elige el servicio
        </h3>
      </div>
      <p className="mt-1 text-body font-sans text-muted">
        ¿Qué servicio necesitas?
      </p>
      <div className="mt-6 space-y-0">
        {services.map((service) => (
          <button
            key={service.id}
            type="button"
            onClick={() => onSelect(service.id)}
            className={cn(
              "flex w-full items-center justify-between gap-4 border-b border-border px-2 py-4 text-left transition-colors last:border-b-0",
              "hover:bg-accent/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background-secondary rounded-sm",
              selectedId === service.id && "bg-accent/5"
            )}
          >
            <div className="min-w-0">
              <p className="font-display text-foreground">{service.name}</p>
              {service.description && (
                <p className="mt-0.5 text-sm font-sans text-muted truncate">
                  {service.description}
                </p>
              )}
              <p className="mt-1 text-label font-sans uppercase tracking-label text-muted">
                {formatDuration(service.duration_minutes)}
              </p>
            </div>
            <span className="shrink-0 text-lg font-display text-accent">
              {formatPrice(service.price_cents, currency)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Step: Fecha y Hora ─────────────────────────────────────────────────────

function StepDateTime({
  dates,
  selectedDate,
  slots,
  selectedSlot,
  timezone,
  loading,
  error,
  onSelectDate,
  onSelectSlot,
  onBack,
}: {
  dates: { value: string; label: string; isToday: boolean }[];
  selectedDate: string | null;
  slots: string[];
  selectedSlot: string | null;
  timezone: string;
  loading: boolean;
  error: string | null;
  onSelectDate: (date: string) => void;
  onSelectSlot: (slot: string) => void;
  onBack: () => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <BackButton onClick={onBack} />
        <h3 className="text-lg font-display text-foreground">
          Fecha y horario
        </h3>
      </div>
      <p className="mt-1 text-body font-sans text-muted">
        Elige un día y después selecciona el horario disponible.
      </p>

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

      {/* Time slots */}
      {selectedDate && (
        <div className="mt-6">
          <p className="text-label font-sans uppercase tracking-label text-muted mb-3">
            Horarios disponibles
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
          {!loading && !error && slots.length === 0 && (
            <p className="py-8 text-body font-sans text-muted">
              No hay horarios disponibles para este día. Prueba con otra fecha.
            </p>
          )}
          {!loading && !error && slots.length > 0 && (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6" role="radiogroup">
              {slots.map((slot) => (
                <button
                  key={slot}
                  type="button"
                  role="radio"
                  aria-checked={selectedSlot === slot}
                  onClick={() => onSelectSlot(slot)}
                  className={cn(
                    "rounded-button border px-3 py-2.5 text-sm font-sans font-medium transition-all",
                    "hover:border-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background-secondary",
                    selectedSlot === slot
                      ? "border-accent bg-accent text-background"
                      : "border-border text-foreground"
                  )}
                >
                  {formatSlotTime(slot, timezone)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
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
  service,
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
  service: PublicService;
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
        <ConfirmRow label="Servicio" value={service.name} />
        <ConfirmRow
          label="Precio"
          value={formatPrice(service.price_cents, currency)}
        />
        <ConfirmRow
          label="Duración"
          value={formatDuration(service.duration_minutes)}
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

// ─── Shared sub-components ──────────────────────────────────────────────────

function ConfirmRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-1.5">
      <span className="text-body font-sans text-muted">{label}</span>
      <span className="text-body font-sans text-foreground text-right capitalize">
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
