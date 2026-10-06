"use client";

import { useActionState } from "react";
import Link from "next/link";
import { loginAction, type LoginState } from "@/app/(auth)/actions";

export function LoginForm() {
  const [state, formAction, isPending] = useActionState<LoginState, FormData>(
    loginAction,
    {}
  );

  return (
    <form action={formAction} className="space-y-6">
      {/* Error global */}
      {state.error && (
        <div
          role="alert"
          className="rounded-button border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400"
        >
          {state.error}
        </div>
      )}

      {/* Email */}
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

      {/* Password */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label
            htmlFor="password"
            className="block text-label font-sans uppercase tracking-label text-muted"
          >
            Contraseña
          </label>
          <Link
            href="/forgot-password"
            className="text-label font-sans text-accent transition-colors hover:text-foreground"
          >
            ¿Olvidaste tu contraseña?
          </Link>
        </div>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          disabled={isPending}
          placeholder="••••••••"
          className="block w-full rounded-button border border-border bg-background px-4 py-3 text-body font-sans text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
        />
      </div>

      {/* Submit */}
      <button
        type="submit"
        disabled={isPending}
        className="flex w-full items-center justify-center rounded-button bg-accent px-6 py-3 text-body font-sans font-semibold text-background transition-all hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50"
      >
        {isPending ? (
          <span className="flex items-center gap-2">
            <LoadingSpinner />
            Iniciando sesión…
          </span>
        ) : (
          "Iniciar sesión"
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
