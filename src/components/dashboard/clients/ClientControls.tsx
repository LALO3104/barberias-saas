"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/Dialog";
import { cn } from "@/lib/utils";
import { MAX_CLIENT_NAME_LENGTH, MAX_CLIENT_NOTE_LENGTH } from "@/lib/clients";
import { saveClientNoteAction, updateClientAction } from "@/app/(dashboard)/dashboard/clientes/actions";
import { ErrorText, FIELD, LABEL, PRIMARY } from "@/components/dashboard/appointments/AppointmentFormParts";

const CONNECTION_ERROR = "No se pudo conectar. Revisa tu conexión e intenta de nuevo.";

/** Notas internas del cliente (nunca públicas). */
export function ClientNoteEditor({ clientId, initialNote }: { clientId: string; initialNote: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [note, setNote] = useState(initialNote);
  const [savedNote, setSavedNote] = useState(initialNote);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty = note.trim() !== savedNote.trim();

  function submit() {
    if (!dirty || isPending) return;
    setError(null);
    setSaved(false);
    startTransition(async () => {
      try {
        const result = await saveClientNoteAction(clientId, note);
        if (result.error) {
          setError(result.error);
          return;
        }
        setSavedNote(note.trim());
        setNote(note.trim());
        setSaved(true);
        router.refresh();
      } catch {
        setError(CONNECTION_ERROR);
      }
    });
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label htmlFor="client-note" className="text-sm font-sans font-medium text-foreground">
        Notas internas
      </label>
      <textarea
        id="client-note"
        rows={4}
        value={note}
        onChange={(e) => {
          setSaved(false);
          setNote(e.target.value);
        }}
        maxLength={MAX_CLIENT_NOTE_LENGTH}
        placeholder="Ej.: corte bajo a los lados, le gusta la barba definida"
        disabled={isPending}
        className={cn(FIELD, "resize-none")}
      />
      <p className="text-xs font-sans text-muted">Solo las ve el personal, nunca el cliente.</p>
      {error && <ErrorText>{error}</ErrorText>}
      {saved && !dirty && <p className="text-sm font-sans text-accent">Nota guardada.</p>}
      {dirty && (
        <button type="submit" disabled={isPending} className={PRIMARY}>
          {isPending ? "Guardando…" : "Guardar nota"}
        </button>
      )}
    </form>
  );
}

/** Corregir nombre y teléfono (solo admin). */
export function EditClientButton({
  clientId,
  name,
  phone,
}: {
  clientId: string;
  name: string;
  /** Teléfono para mostrar, o cadena vacía. */
  phone: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [nameInput, setNameInput] = useState(name);
  const [phoneInput, setPhoneInput] = useState(phone);
  const [error, setError] = useState<string | null>(null);

  function openSheet() {
    setNameInput(name);
    setPhoneInput(phone);
    setError(null);
    setOpen(true);
  }

  function submit() {
    if (!nameInput.trim() || isPending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await updateClientAction({ clientId, name: nameInput, phone: phoneInput });
        if (result.error) {
          setError(result.error);
          return;
        }
        setOpen(false);
        router.refresh();
      } catch {
        setError(CONNECTION_ERROR);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={openSheet}
        className="inline-flex h-11 items-center rounded-button border border-border px-4 text-sm font-sans text-foreground transition-[background-color,transform] duration-150 ease-out hover:bg-border/40 active:scale-[0.97]"
      >
        Editar
      </button>
      <Dialog open={open} onClose={() => !isPending && setOpen(false)} title="Editar cliente">
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div>
            <label htmlFor="client-name" className={LABEL}>
              Nombre
            </label>
            <input
              id="client-name"
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              maxLength={MAX_CLIENT_NAME_LENGTH}
              required
              disabled={isPending}
              className={FIELD}
            />
          </div>
          <div>
            <label htmlFor="client-phone" className={LABEL}>
              Teléfono <span className="text-muted/70">(10 dígitos)</span>
            </label>
            <input
              id="client-phone"
              type="tel"
              inputMode="tel"
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
              maxLength={30}
              placeholder="55 1234 5678"
              disabled={isPending}
              className={cn(FIELD, "tabular-nums")}
            />
          </div>
          {error && <ErrorText>{error}</ErrorText>}
          <button type="submit" disabled={!nameInput.trim() || isPending} className={PRIMARY}>
            {isPending ? "Guardando…" : "Guardar"}
          </button>
        </form>
      </Dialog>
    </>
  );
}
