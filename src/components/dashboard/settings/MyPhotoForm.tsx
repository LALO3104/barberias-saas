"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setMyPhotoAction } from "@/app/(dashboard)/dashboard/barberos/actions";
import { ErrorText, FIELD, LABEL, PRIMARY } from "@/components/dashboard/appointments/AppointmentFormParts";

/** El barbero pone la dirección (URL) de su foto de perfil. */
export function MyPhotoForm({ name, photoUrl }: { name: string; photoUrl: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(photoUrl ?? "");
  const [broken, setBroken] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  const preview = value.trim().startsWith("https://") ? value.trim() : null;

  function submit() {
    if (isPending) return;
    setError(null);
    setSaved(false);
    startTransition(async () => {
      try {
        const result = await setMyPhotoAction(value);
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
        <h2 className="font-display text-lg text-foreground">Tu foto</h2>
        <p className="mt-1 text-sm font-sans text-muted">
          Sale en la página de la barbería. Pega el enlace directo de una imagen, que empiece con https://
        </p>
      </div>
      <div className="flex items-center gap-4">
        {preview && !broken ? (
          // eslint-disable-next-line @next/next/no-img-element -- fotos de barberos con <img> (CLAUDE.md §10)
          <img
            src={preview}
            alt="Vista previa de tu foto"
            onError={() => setBroken(true)}
            className="h-16 w-16 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-accent/15 font-display text-2xl text-accent"
          >
            {name.charAt(0)}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <label htmlFor="my-photo" className={LABEL}>
            Enlace de la foto
          </label>
          <input
            id="my-photo"
            type="url"
            inputMode="url"
            autoCapitalize="none"
            value={value}
            onChange={(e) => {
              setSaved(false);
              setBroken(false);
              setValue(e.target.value);
            }}
            maxLength={1000}
            placeholder="https://…"
            disabled={isPending}
            className={FIELD}
          />
        </div>
      </div>
      {preview && broken && (
        <p className="text-sm font-sans text-amber-300">
          Esa dirección no abre como imagen. Busca el enlace directo a la foto (suele terminar en .jpg o .png).
        </p>
      )}
      {error && <ErrorText>{error}</ErrorText>}
      {saved && <p className="text-sm font-sans text-accent">Foto guardada.</p>}
      <button type="submit" disabled={isPending} className={PRIMARY}>
        {isPending ? "Guardando…" : "Guardar foto"}
      </button>
    </form>
  );
}
