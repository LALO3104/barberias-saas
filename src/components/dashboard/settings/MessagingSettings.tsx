"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { formatPhoneDisplay } from "@/lib/appointments";
import {
  DEFAULT_TEMPLATES,
  MAX_TEMPLATE_LENGTH,
  MESSAGE_KEYS,
  MESSAGE_LABELS,
  PLACEHOLDERS,
  fillTemplate,
  type MessageKey,
} from "@/lib/whatsapp";
import { ErrorText, FIELD, LABEL, PRIMARY } from "@/components/dashboard/appointments/AppointmentFormParts";
import { updateMessagingAction } from "@/app/(dashboard)/dashboard/ajustes/actions";

interface MessagingSettingsProps {
  tenantName: string;
  /** E.164 o null. */
  phone: string | null;
  /** Texto vigente de cada plantilla (personalizado o predeterminado). */
  templates: Record<MessageKey, string>;
}

const EXAMPLE = {
  cliente: "Ana",
  barbero: "Luis",
  fecha: "sábado 3 de octubre",
  hora: "16:30",
  servicios: "Corte, Barba",
  motivo: "el barbero se enfermó",
};

/** Número de WhatsApp de la barbería y mensajes predeterminados. */
export function MessagingSettings({ tenantName, phone, templates }: MessagingSettingsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [phoneInput, setPhoneInput] = useState(phone ? formatPhoneDisplay(phone) : "");
  const [texts, setTexts] = useState<Record<MessageKey, string>>(templates);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const phoneDigits = phoneInput.replace(/\D/g, "").length;
  const phoneValid = phoneInput.trim() === "" || (phoneDigits >= 10 && phoneDigits <= 15);
  const tooLong = MESSAGE_KEYS.some((k) => texts[k].trim().length > MAX_TEMPLATE_LENGTH);

  function update(key: MessageKey, value: string) {
    setSaved(false);
    setTexts((prev) => ({ ...prev, [key]: value }));
  }

  function submit() {
    if (!phoneValid || tooLong || isPending) return;
    setError(null);
    setSaved(false);
    startTransition(async () => {
      try {
        const result = await updateMessagingAction({ phone: phoneInput, templates: texts });
        if (result.error) {
          setError(result.error);
          return;
        }
        setPhoneInput(result.phone ? formatPhoneDisplay(result.phone) : "");
        setSaved(true);
        router.refresh();
      } catch {
        setError("No se pudo conectar. Revisa tu conexión e intenta de nuevo.");
      }
    });
  }

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <section className="space-y-3 rounded-card border border-border bg-background-secondary p-[var(--spacing-card)]">
        <h2 className="font-display text-lg text-foreground">WhatsApp de la barbería</h2>
        <p className="text-sm font-sans text-muted">
          Al terminar una reserva en línea, el cliente puede escribir a este número con un mensaje ya listo. Déjalo
          vacío para no mostrar el botón.
        </p>
        <div>
          <label htmlFor="wa-phone" className={LABEL}>
            Número (10 dígitos)
          </label>
          <input
            id="wa-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phoneInput}
            onChange={(e) => {
              setSaved(false);
              setPhoneInput(e.target.value);
            }}
            placeholder="55 1234 5678"
            maxLength={30}
            disabled={isPending}
            className={cn(FIELD, "tabular-nums")}
          />
          {!phoneValid && <ErrorText>Escribe 10 dígitos, por ejemplo 55 1234 5678.</ErrorText>}
        </div>
      </section>

      <section className="space-y-5 rounded-card border border-border bg-background-secondary p-[var(--spacing-card)]">
        <div className="space-y-2">
          <h2 className="font-display text-lg text-foreground">Mensajes para tus clientes</h2>
          <p className="text-sm font-sans text-muted">
            Se abren desde el botón WhatsApp de cada cita. Puedes usar estas palabras entre llaves y se llenan solas:
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {PLACEHOLDERS.map((p) => (
              <li
                key={p.token}
                title={p.description}
                className="rounded-full border border-border px-2.5 py-0.5 text-xs font-sans text-foreground/90"
              >
                {p.token} <span className="text-muted">· {p.description}</span>
              </li>
            ))}
          </ul>
        </div>

        {MESSAGE_KEYS.map((key) => {
          const value = texts[key];
          const isDefault = value.trim() === DEFAULT_TEMPLATES[key];
          return (
            <div key={key} className="space-y-2 border-t border-border pt-5">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor={`tpl-${key}`} className="text-sm font-sans font-medium text-foreground">
                  {MESSAGE_LABELS[key]}
                </label>
                {!isDefault && (
                  <button
                    type="button"
                    onClick={() => update(key, DEFAULT_TEMPLATES[key])}
                    disabled={isPending}
                    className="text-sm font-sans text-muted underline-offset-4 transition-colors hover:text-accent hover:underline"
                  >
                    Usar el predeterminado
                  </button>
                )}
              </div>
              <textarea
                id={`tpl-${key}`}
                rows={4}
                value={value}
                onChange={(e) => update(key, e.target.value)}
                maxLength={MAX_TEMPLATE_LENGTH}
                disabled={isPending}
                className={cn(FIELD, "resize-none")}
              />
              <p className="text-xs font-sans text-muted">
                <span className="text-muted/70">Así se verá: </span>
                {fillTemplate(value.trim() || DEFAULT_TEMPLATES[key], { ...EXAMPLE, barberia: tenantName })}
              </p>
            </div>
          );
        })}
      </section>

      {error && <ErrorText>{error}</ErrorText>}
      {saved && <p className="text-sm font-sans text-accent">Ajustes guardados.</p>}
      <button type="submit" disabled={!phoneValid || tooLong || isPending} className={PRIMARY}>
        {isPending ? "Guardando…" : "Guardar ajustes"}
      </button>
    </form>
  );
}
