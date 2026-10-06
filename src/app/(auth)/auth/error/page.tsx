import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Error de autenticación — Barberías",
};

export default function AuthErrorPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center space-y-6">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-red-500/30 bg-red-500/10">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="h-10 w-10 text-red-400"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
            />
          </svg>
        </div>

        <h1 className="text-section font-display text-foreground">
          Error de autenticación
        </h1>
        <p className="text-body font-sans text-muted">
          No se pudo completar el proceso de autenticación. El enlace puede
          haber expirado o ya fue utilizado.
        </p>

        <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/login"
            className="inline-flex items-center justify-center rounded-button bg-accent px-6 py-3 text-body font-sans font-semibold text-background transition-all hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Iniciar sesión
          </Link>
          <Link
            href="/forgot-password"
            className="inline-flex items-center justify-center rounded-button border border-border px-6 py-3 text-body font-sans text-foreground transition-colors hover:bg-border/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Recuperar contraseña
          </Link>
        </div>
      </div>
    </div>
  );
}
