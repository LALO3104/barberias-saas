import type { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";

export const metadata: Metadata = {
  title: "Nueva contraseña — Barberías",
  description: "Establece una nueva contraseña para tu cuenta.",
};

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-8">
        {/* Header */}
        <div className="text-center">
          <Link href="/" className="inline-block">
            <h1 className="text-section font-display text-foreground">
              Barberías
            </h1>
          </Link>
          <h2 className="mt-4 text-xl font-display text-foreground">
            Nueva contraseña
          </h2>
        </div>

        {/* Card */}
        <div className="rounded-card border border-border bg-background-secondary p-8 shadow-card">
          <ResetPasswordForm />
        </div>

        {/* Footer */}
        <p className="text-center text-label font-sans text-muted">
          Barberías SaaS — Panel de administración
        </p>
      </div>
    </div>
  );
}
