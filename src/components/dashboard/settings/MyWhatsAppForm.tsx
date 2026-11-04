"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { formatPhoneDisplay } from "@/lib/appointments";
import { setBarberWhatsAppAction } from "@/app/(dashboard)/dashboard/barberos/actions";
import { ErrorText, FIELD, LABEL, PRIMARY } from "@/components/dashboard/appointments/AppointmentFormParts";

/** El barbero guarda su propio WhatsApp. */
export function MyWhatsAppForm({ barberId, phone }: { barberId: string; phone: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(phone ? formatPhoneDisplay(phone) : "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function submit() {
    if (isPending) return;
    setError(null);
    setSaved(false);
    startTransition(async () => {
      try {
        const result = await setBarberWhatsAppAction(barberId, value);
        if (result.error) {
          setError(result.error);
          return;
        }
        setSaved(true);
        router.refresh();
      } catch {
        setError("No se pudo conectar. Revisa tu conexión e intenta de nuevo.");
      }
    });
  }

  return (
    <form
      className="space-y-4 rounded-card border border-border bg-background-secondary p-[var(--spacing-card)]"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div>
        <h2 className="font-display text-lg text-foreground">Tu WhatsApp</h2>
        <p className="mt-1 text-sm font-sans text-muted">
          Al reservar contigo, el cliente te avisa a este número. No se muestra en la página pública.
        </p>
      </div>
      <div>
        <label htmlFor="my-whatsapp" className={LABEL}>
          Número (10 dígitos)
        </label>
        <input
          id="my-whatsapp"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={value}
          onChange={(e) => {
            setSaved(false);
            setValue(e.target.value);
          }}
          maxLength={30}
          placeholder="55 1234 5678"
          disabled={isPending}
          className={cn(FIELD, "tabular-nums")}
        />
      </div>
      {error && <ErrorText>{error}</ErrorText>}
      {saved && <p className="text-sm font-sans text-accent">Guardado.</p>}
      <button type="submit" disabled={isPending} className={PRIMARY}>
        {isPending ? "Guardando…" : "Guardar"}
      </button>
    </form>
  );
}
