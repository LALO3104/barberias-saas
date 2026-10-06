"use client";

import { useActionState } from "react";
import Link from "next/link";
import {
  resetPasswordAction,
  type ResetPasswordState,
} from "@/app/(auth)/actions";

export function ResetPasswordForm() {
  const [state, formAction, isPending] = useActionState<
    ResetPasswordState,
    FormData
  >(resetPasswordAction, {});

  if (state.success) {
    return (
      <div className="space-y-6 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-green-500/30 bg-green-500/10">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="h-8 w-8 text-green-400"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <div>
          <h2 className="text-xl font-display text-foreground">
            Contraseña actualizada
          </h2>
          <p className="mt-2 text-body font-sans text-muted">
            Tu contraseña ha sido actualizada exitosamente.
          </p>
        </div>
        <Link
          href="/dashboard"
          className="inline-flex items-center justify-center rounded-button bg-accent px-6 py-3 text-body font-sans font-semibold text-background transition-all hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Ir al dashboard
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
        Ingresa tu nueva contraseña.
      </p>

      <div className="space-y-2">
        <label
          htmlFor="password"
          className="block text-label font-sans uppercase tracking-label text-muted"
        >
          Nueva contraseña
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={6}
          disabled={isPending}
          placeholder="Mínimo 6 caracteres"
          className="block w-full rounded-button border border-border bg-background px-4 py-3 text-body font-sans text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
        />
      </div>

      <div className="space-y-2">
        <label
          htmlFor="confirmPassword"
          className="block text-label font-sans uppercase tracking-label text-muted"
        >
          Confirmar contraseña
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={6}
          disabled={isPending}
          placeholder="Repite tu contraseña"
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
            Actualizando…
          </span>
        ) : (
          "Actualizar contraseña"
        )}
      </button>
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
