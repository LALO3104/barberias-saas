"use client";

import { useActionState } from "react";
import Link from "next/link";
import {
  forgotPasswordAction,
  type ForgotPasswordState,
} from "@/app/(auth)/actions";

export function ForgotPasswordForm() {
  const [state, formAction, isPending] = useActionState<
    ForgotPasswordState,
    FormData
  >(forgotPasswordAction, {});

  if (state.success) {
    return (
      <div className="space-y-6 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-accent/30 bg-accent/10">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="h-8 w-8 text-accent"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
            />
          </svg>
        </div>
        <div>
          <h2 className="text-xl font-display text-foreground">
            Revisa tu correo
          </h2>
          <p className="mt-2 text-body font-sans text-muted">
            Si existe una cuenta con ese correo, recibirás un enlace para
            restablecer tu contraseña.
          </p>
        </div>
        <Link
          href="/login"
          className="inline-block text-body font-sans text-accent transition-colors hover:text-foreground"
        >
          Volver al inicio de sesión
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-6">
      {state.error && (
        <div
          role="alert"
          className="rounded-button border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400"
        >
          {state.error}
        </div>
      )}

      <p className="text-body font-sans text-muted">
        Ingresa tu correo electrónico y te enviaremos un enlace para restablecer
        tu contraseña.
      </p>

      <div className="space-y-2">
        <label
          htmlFor="email"
          className="block text-label font-sans uppercase tracking-label text-muted"
        >
          Correo electrónico
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          disabled={isPending}
          placeholder="tu@correo.com"
          className="block w-full rounded-button border border-border bg-background px-4 py-3 text-body font-sans text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
        />
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="flex w-full items-center justify-center rounded-button bg-accent px-6 py-3 text-body font-sans font-semibold text-background transition-all hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50"
      >
        {isPending ? (
          <span className="flex items-center gap-2">
            <LoadingSpinner />
            Enviando…
          </span>
        ) : (
          "Enviar enlace de recuperación"
        )}
      </button>

      <div className="text-center">
        <Link
          href="/login"
          className="text-body font-sans text-accent transition-colors hover:text-foreground"
        >
          Volver al inicio de sesión
        </Link>
      </div>
    </form>
  );
}

function LoadingSpinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}
