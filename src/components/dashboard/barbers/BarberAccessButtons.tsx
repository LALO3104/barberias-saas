"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/Dialog";
import { cn } from "@/lib/utils";
import { formatPhoneDisplay } from "@/lib/appointments";
import { createBarberInviteAction, setBarberWhatsAppAction } from "@/app/(dashboard)/dashboard/barberos/actions";
import { ErrorText, FIELD, LABEL, PRIMARY, SECONDARY } from "@/components/dashboard/appointments/AppointmentFormParts";

const CONNECTION_ERROR = "No se pudo conectar. Revisa tu conexión e intenta de nuevo.";

const SMALL =
  "inline-flex items-center rounded-button border border-border px-3 py-1.5 text-xs font-sans text-foreground transition-[background-color,transform] duration-150 ease-out hover:bg-border/50 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

/** "Invitar": genera el enlace de un solo uso para que el barbero cree su acceso. */
export function InviteBarberButton({ barberId, barberName }: { barberId: string; barberName: string }) {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function generate() {
    setError(null);
    setCopied(false);
    setLink(null);
    setOpen(true);
    startTransition(async () => {
      try {
        const result = await createBarberInviteAction(barberId);
        if (result.error || !result.link) {
          setError(result.error ?? "No se pudo crear la invitación.");
          return;
        }
        setLink(result.link);
      } catch {
        setError(CONNECTION_ERROR);
      }
    });
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setError("No se pudo copiar. Mantén presionado el enlace para copiarlo.");
    }
  }

  const message = link
    ? `Hola ${barberName}, crea tu acceso a Mi barbería con este enlace (sirve una sola vez y caduca en 7 días): ${link}`
    : "";

  return (
    <>
      <button type="button" onClick={generate} className={cn(SMALL, "border-accent/50 text-accent")}>
        Invitar
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Invitar a ${barberName}`}>
        <div className="space-y-4">
          <p className="text-sm font-sans text-muted">
            Mándale este enlace. Con él crea su acceso y escribe su WhatsApp. Sirve una sola vez y caduca en 7 días; si
            generas otro, el anterior deja de servir.
          </p>
          {isPending && <p className="text-sm font-sans text-muted">Creando invitación…</p>}
          {error && <ErrorText>{error}</ErrorText>}
          {link && (
            <>
              <p className="break-all rounded-button border border-border bg-background p-3 text-sm font-sans text-foreground">{link}</p>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(message)}`}
                target="_blank"
                rel="noopener noreferrer"
                className={PRIMARY}
              >
                Enviar por WhatsApp
              </a>
              <button type="button" onClick={copy} className={SECONDARY}>
                {copied ? "Copiado" : "Copiar enlace"}
              </button>
            </>
          )}
        </div>
      </Dialog>
    </>
  );
}

/** Número de WhatsApp de un barbero (el admin lo puede poner por él). */
export function BarberWhatsAppButton({
  barberId,
  barberName,
  phone,
}: {
  barberId: string;
  barberName: string;
  phone: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    if (isPending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await setBarberWhatsAppAction(barberId, value);
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
        onClick={() => {
          setValue(phone ? formatPhoneDisplay(phone) : "");
          setError(null);
          setOpen(true);
        }}
        className={SMALL}
      >
        WhatsApp
      </button>
      <Dialog open={open} onClose={() => !isPending && setOpen(false)} title={`WhatsApp de ${barberName}`}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <p className="text-sm font-sans text-muted">
            Al reservar con este barbero, el cliente le avisa a este número. Si está vacío, el aviso va al WhatsApp de la
            barbería.
          </p>
          <div>
            <label htmlFor={`wa-${barberId}`} className={LABEL}>
              Número (10 dígitos)
            </label>
            <input
              id={`wa-${barberId}`}
              type="tel"
              inputMode="tel"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              maxLength={30}
              placeholder="55 1234 5678"
              disabled={isPending}
              className={cn(FIELD, "tabular-nums")}
            />
          </div>
          {error && <ErrorText>{error}</ErrorText>}
          <button type="submit" disabled={isPending} className={PRIMARY}>
            {isPending ? "Guardando…" : "Guardar"}
          </button>
        </form>
      </Dialog>
    </>
  );
}
