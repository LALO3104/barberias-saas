"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { mapEmbedUrl, mapOpenUrl } from "@/lib/maps";
import { updateLocationAction } from "@/app/(dashboard)/dashboard/ajustes/actions";
import { ErrorText, FIELD, LABEL, PRIMARY } from "@/components/dashboard/appointments/AppointmentFormParts";

export interface LocationValues {
  address: string;
  city: string;
  state: string;
  postalCode: string;
}

/** Dirección que se publica en la página de la barbería. */
export function LocationForm({
  initial,
  tenantName,
  mapQuery,
}: {
  initial: LocationValues;
  tenantName: string;
  /** Punto guardado en el mapa, o null. */
  mapQuery: string | null;
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [mapLink, setMapLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function set(key: keyof LocationValues, value: string) {
    setSaved(false);
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  const address = [values.address, values.city, values.state].map((v) => v.trim()).filter(Boolean).join(", ");
  // La vista previa usa lo guardado: con lo que se escribe se recargaría en cada tecla.
  const savedAddress = [initial.address, initial.city, initial.state].filter(Boolean).join(", ");
  const shownOnMap = mapQuery ?? (savedAddress ? `${tenantName}, ${savedAddress}` : null);

  function submit(clearMap = false) {
    if (isPending) return;
    setError(null);
    setSaved(false);
    startTransition(async () => {
      try {
        const result = await updateLocationAction({ ...values, mapLink: clearMap ? "" : mapLink, clearMap });
        if (result.error) {
          setError(result.error);
          return;
        }
        setMapLink("");
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
          Aparece en tu página con un mapa de Google y un botón para llegar.
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

      <div className="space-y-3 border-t border-border pt-4">
        <div>
          <p className="text-sm font-sans font-medium text-foreground">Tu punto exacto en Google Maps</p>
          <ol className="mt-1.5 list-decimal space-y-0.5 pl-5 text-sm font-sans text-muted">
            <li>Abre Google Maps y busca tu barbería, o mantén presionado el lugar exacto.</li>
            <li>Toca Compartir y copia el enlace.</li>
            <li>Pégalo aquí y guarda.</li>
          </ol>
        </div>
        <a
          href={mapOpenUrl(address || tenantName)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-11 items-center rounded-button border border-accent/50 px-4 text-sm font-sans font-medium text-accent transition-[background-color,transform] duration-150 ease-out hover:bg-accent/10 active:scale-[0.97]"
        >
          Abrir Google Maps
        </a>
        <div>
          <label htmlFor="loc-map" className={LABEL}>
            Enlace de Google Maps
          </label>
          <input
            id="loc-map"
            type="url"
            inputMode="url"
            autoCapitalize="none"
            value={mapLink}
            onChange={(e) => {
              setSaved(false);
              setMapLink(e.target.value);
            }}
            maxLength={2000}
            placeholder="https://maps.app.goo.gl/…"
            disabled={isPending}
            className={FIELD}
          />
        </div>
        {shownOnMap && (
          <iframe
            key={shownOnMap}
            src={mapEmbedUrl(shownOnMap)}
            title="Vista previa del mapa"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            className="aspect-video w-full rounded-button border border-border"
          />
        )}
        {mapQuery && (
          <button
            type="button"
            onClick={() => submit(true)}
            disabled={isPending}
            className="text-sm font-sans text-muted underline-offset-4 transition-colors hover:text-accent hover:underline"
          >
            Quitar el punto y usar la dirección escrita
          </button>
        )}
      </div>

      {error && <ErrorText>{error}</ErrorText>}
      {saved && <p className="text-sm font-sans text-accent">Ubicación guardada.</p>}
      <button type="submit" disabled={isPending} className={PRIMARY}>
        {isPending ? "Guardando…" : "Guardar ubicación"}
      </button>
    </form>
  );
}
