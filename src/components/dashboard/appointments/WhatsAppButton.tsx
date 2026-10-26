"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { cn } from "@/lib/utils";
import { waLink } from "@/lib/whatsapp";
import { FIELD, LABEL, PRIMARY } from "./AppointmentFormParts";

export interface WhatsAppMessage {
  key: string;
  label: string;
  text: string;
}

interface WhatsAppButtonProps {
  phone: string;
  clientName: string;
  /** Mensajes ya llenados con los datos de la cita (el primero se elige al abrir). */
  messages: WhatsAppMessage[];
}

/** Abre WhatsApp con un mensaje predeterminado para el cliente (wa.me, sin API). */
export function WhatsAppButton({ phone, clientName, messages }: WhatsAppButtonProps) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(messages[0]?.key ?? "");
  const [text, setText] = useState(messages[0]?.text ?? "");

  if (messages.length === 0) return null;

  function choose(key: string) {
    const m = messages.find((x) => x.key === key);
    if (!m) return;
    setSelected(key);
    setText(m.text);
  }

  const href = text.trim() ? waLink(phone, text.trim()) : null;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          choose(messages[0].key);
          setOpen(true);
        }}
        className="inline-flex items-center gap-1.5 rounded-button border border-accent/30 px-3 py-1.5 text-sm font-sans text-accent transition-[background-color,transform] duration-150 ease-out hover:bg-accent/10 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden="true">
          <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.87 9.87 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24a8.24 8.24 0 0 1 8.24 8.25c0 4.54-3.7 8.23-8.24 8.23Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.51.11-.11.25-.29.37-.43.13-.15.17-.25.25-.42.08-.16.04-.31-.02-.43-.06-.13-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.22-.16-.47-.29Z" />
        </svg>
        WhatsApp
      </button>

      <Dialog open={open} onClose={() => setOpen(false)} title={`Mensaje a ${clientName}`}>
        <div className="space-y-5">
          {messages.length > 1 && (
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Tipo de mensaje">
              {messages.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  role="radio"
                  aria-checked={selected === m.key}
                  onClick={() => choose(m.key)}
                  className={cn(
                    "rounded-full border px-3.5 py-1.5 text-sm font-sans transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.97]",
                    selected === m.key
                      ? "border-accent bg-accent/15 text-accent"
                      : "border-border text-muted hover:text-foreground"
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}
          <div>
            <label htmlFor="wa-text" className={LABEL}>
              Mensaje <span className="text-muted/70">(puedes cambiarlo antes de enviarlo)</span>
            </label>
            <textarea
              id="wa-text"
              rows={6}
              value={text}
              onChange={(e) => setText(e.target.value)}
              className={cn(FIELD, "resize-none")}
            />
          </div>
          {href ? (
            <a href={href} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)} className={PRIMARY}>
              Abrir WhatsApp
            </a>
          ) : (
            <p className="text-sm font-sans text-muted">Escribe un mensaje para continuar.</p>
          )}
        </div>
      </Dialog>
    </>
  );
}
