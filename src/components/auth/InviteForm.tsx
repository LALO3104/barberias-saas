"use client";

import { useActionState } from "react";
import { acceptInviteAction, type InviteState } from "@/app/(auth)/actions";

const INPUT =
  "block w-full rounded-button border border-border bg-background px-4 py-3 text-body font-sans text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50";
const LABEL = "block text-label font-sans uppercase tracking-label text-muted";

/** Crea el acceso del barbero con su enlace de invitación. */
export function InviteForm({ token }: { token: string }) {
  const [state, formAction, isPending] = useActionState<InviteState, FormData>(acceptInviteAction, {});

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="token" value={token} />

      {state.error && (
        <div role="alert" className="rounded-button border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {state.error}
        </div>
      )}

      <div className="space-y-2">
        <label htmlFor="invite-email" className={LABEL}>
          Correo electrónico
        </label>
        <input
          id="invite-email"
          name="email"
          type="email"
          autoComplete="email"
          autoCapitalize="none"
          required
          disabled={isPending}
          placeholder="tu@correo.com"
          className={INPUT}
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="invite-password" className={LABEL}>
          Crea tu contraseña
        </label>
        <input
          id="invite-password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          disabled={isPending}
          placeholder="Mínimo 8 caracteres"
          className={INPUT}
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="invite-whatsapp" className={LABEL}>
          Tu WhatsApp
        </label>
        <input
          id="invite-whatsapp"
          name="whatsapp"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          maxLength={30}
          disabled={isPending}
          placeholder="55 1234 5678"
          className={`${INPUT} tabular-nums`}
        />
        <p className="text-sm font-sans text-muted">Tus clientes te avisarán a este número al reservar contigo.</p>
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="flex h-12 w-full items-center justify-center rounded-button bg-accent text-base font-sans font-semibold text-background transition-[filter,transform] duration-150 ease-out hover:brightness-110 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
      >
        {isPending ? "Creando tu acceso…" : "Crear mi acceso"}
      </button>
    </form>
  );
}
