"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { updateLocationAction } from "@/app/(dashboard)/dashboard/ajustes/actions";
import { ErrorText, FIELD, LABEL, PRIMARY } from "@/components/dashboard/appointments/AppointmentFormParts";

export interface LocationValues {
  address: string;
  city: string;
  state: string;
  postalCode: string;
}

/** Dirección que se publica en la página de la barbería. */
export function LocationForm({ initial }: { initial: LocationValues }) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function set(key: keyof LocationValues, value: string) {
    setSaved(false);
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function submit() {
    if (isPending) return;
    setError(null);
    setSaved(false);
    startTransition(async () => {
      try {
        const result = await updateLocationAction(values);
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
        <h2 className="font-display text-lg text-foreground">Ubicación</h2>
        <p className="mt-1 text-sm font-sans text-muted">
          Aparece en tu página, con un botón para abrirla en Google Maps.
        </p>
      </div>
      <div>
        <label htmlFor="loc-address" className={LABEL}>
          Calle y número
        </label>
        <input
          id="loc-address"
          type="text"
          value={values.address}
          onChange={(e) => set("address", e.target.value)}
          maxLength={200}
          autoComplete="street-address"
          placeholder="Av. Reforma 123, Col. Centro"
          disabled={isPending}
          className={FIELD}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <label htmlFor="loc-city" className={LABEL}>
            Ciudad
          </label>
          <input
            id="loc-city"
            type="text"
            value={values.city}
            onChange={(e) => set("city", e.target.value)}
            maxLength={80}
            disabled={isPending}
            className={FIELD}
          />
        </div>
        <div className="min-w-0">
          <label htmlFor="loc-state" className={LABEL}>
            Estado
          </label>
          <input
            id="loc-state"
            type="text"
            value={values.state}
            onChange={(e) => set("state", e.target.value)}
            maxLength={80}
            disabled={isPending}
            className={FIELD}
          />
        </div>
      </div>
      <div>
        <label htmlFor="loc-postal" className={LABEL}>
          Código postal
        </label>
        <input
          id="loc-postal"
          type="text"
          inputMode="numeric"
          value={values.postalCode}
          onChange={(e) => set("postalCode", e.target.value)}
          maxLength={5}
          placeholder="06600"
          disabled={isPending}
          className={cn(FIELD, "tabular-nums")}
        />
      </div>
      {error && <ErrorText>{error}</ErrorText>}
      {saved && <p className="text-sm font-sans text-accent">Ubicación guardada.</p>}
      <button type="submit" disabled={isPending} className={PRIMARY}>
        {isPending ? "Guardando…" : "Guardar ubicación"}
      </button>
    </form>
  );
}
