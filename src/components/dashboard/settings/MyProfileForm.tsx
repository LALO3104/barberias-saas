"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { setMyProfileAction } from "@/app/(dashboard)/dashboard/barberos/actions";
import { ErrorText, FIELD, LABEL, PRIMARY } from "@/components/dashboard/appointments/AppointmentFormParts";

interface MyProfileFormProps {
  name: string;
  role: string | null;
  bio: string | null;
  photoUrl: string | null;
}

const MAX_BIO = 300;

/** El barbero edita lo que aparece en su tarjeta de la página pública. */
export function MyProfileForm({ name, role, bio, photoUrl }: MyProfileFormProps) {
  const router = useRouter();
  const [values, setValues] = useState({
    name,
    role: role ?? "",
    bio: bio ?? "",
    photoUrl: photoUrl ?? "",
  });
  const [broken, setBroken] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  const preview = values.photoUrl.trim().startsWith("https://") ? values.photoUrl.trim() : null;

  function set(key: keyof typeof values, value: string) {
    setSaved(false);
    if (key === "photoUrl") setBroken(false);
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function submit() {
    if (isPending || !values.name.trim()) return;
    setError(null);
    setSaved(false);
    startTransition(async () => {
      try {
        const result = await setMyProfileAction(values);
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
      className="space-y-5 rounded-card border border-border bg-background-secondary p-[var(--spacing-card)]"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div>
        <h2 className="font-display text-lg text-foreground">Tu tarjeta en la página</h2>
        <p className="mt-1 text-sm font-sans text-muted">Esto es lo que ven los clientes de ti.</p>
      </div>

      {/* Vista previa de la tarjeta pública */}
      <div className="overflow-hidden rounded-card border border-border bg-background">
        {preview && !broken ? (
          // eslint-disable-next-line @next/next/no-img-element -- fotos de barberos con <img> (CLAUDE.md §10)
          <img
            src={preview}
            alt="Vista previa de tu foto"
            onError={() => setBroken(true)}
            className="aspect-[4/3] w-full object-cover"
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex aspect-[4/3] w-full items-center justify-center bg-accent/10 font-display text-5xl text-accent"
          >
            {values.name.trim().charAt(0).toUpperCase()}
          </div>
        )}
        <div className="p-4">
          <p className="break-words font-display text-lg text-foreground">{values.name.trim() || "Tu nombre"}</p>
          {values.role.trim() && (
            <p className="mt-1 break-words text-label font-sans uppercase tracking-label text-accent">{values.role.trim()}</p>
          )}
          {values.bio.trim() && <p className="mt-3 line-clamp-3 break-words text-body font-sans text-muted">{values.bio.trim()}</p>}
        </div>
      </div>

      <div>
        <label htmlFor="my-name" className={LABEL}>
          Nombre
        </label>
        <input
          id="my-name"
          type="text"
          value={values.name}
          onChange={(e) => set("name", e.target.value)}
          maxLength={80}
          required
          disabled={isPending}
          className={FIELD}
        />
      </div>
      <div>
        <label htmlFor="my-role" className={LABEL}>
          Puesto o especialidad <span className="text-muted/70">(opcional)</span>
        </label>
        <input
          id="my-role"
          type="text"
          value={values.role}
          onChange={(e) => set("role", e.target.value)}
          maxLength={80}
          placeholder="Ej.: Especialista en fades"
          disabled={isPending}
          className={FIELD}
        />
      </div>
      <div>
        <label htmlFor="my-bio" className={LABEL}>
          Sobre ti <span className="text-muted/70">(opcional)</span>
        </label>
        <textarea
          id="my-bio"
          rows={3}
          value={values.bio}
          onChange={(e) => set("bio", e.target.value)}
          maxLength={MAX_BIO}
          placeholder="Cuéntales a tus clientes qué te distingue"
          disabled={isPending}
          className={cn(FIELD, "resize-none")}
        />
        <p className="mt-1 text-right text-xs font-sans tabular-nums text-muted">
          {values.bio.length}/{MAX_BIO}
        </p>
      </div>
      <div>
        <label htmlFor="my-photo" className={LABEL}>
          Enlace de tu foto <span className="text-muted/70">(opcional)</span>
        </label>
        <input
          id="my-photo"
          type="url"
          inputMode="url"
          autoCapitalize="none"
          value={values.photoUrl}
          onChange={(e) => set("photoUrl", e.target.value)}
          maxLength={1000}
          placeholder="https://…"
          disabled={isPending}
          className={FIELD}
        />
        {preview && broken ? (
          <p className="mt-1.5 text-sm font-sans text-amber-300">
            Esa dirección no abre como imagen. Busca el enlace directo a la foto (suele terminar en .jpg o .png).
          </p>
        ) : (
          <p className="mt-1.5 text-sm font-sans text-muted">Enlace directo a una imagen, que empiece con https://</p>
        )}
      </div>

      {error && <ErrorText>{error}</ErrorText>}
      {saved && <p className="text-sm font-sans text-accent">Tu tarjeta quedó guardada.</p>}
      <button type="submit" disabled={isPending || !values.name.trim()} className={PRIMARY}>
        {isPending ? "Guardando…" : "Guardar mi tarjeta"}
      </button>
    </form>
  );
}
