import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getSupabaseServer } from "@/lib/supabase/server";
import { LoginForm } from "@/components/auth/LoginForm";
import { InstallAppPrompt } from "@/components/dashboard/pwa";

export const metadata: Metadata = {
  title: "Iniciar sesión — Mi barbería",
  description: "Accede al panel de administración de tu barbería.",
};

export default async function LoginPage() {
  // Si ya tiene sesión, redirigir al dashboard
  const supabase = await getSupabaseServer();
  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      redirect("/dashboard");
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <div className="w-full max-w-md space-y-8">
        {/* Header */}
        <div className="text-center">
          <Link href="/" className="inline-block">
            <h1 className="text-section font-display text-foreground">
              Mi barbería
            </h1>
          </Link>
          <p className="mt-2 text-body font-sans text-muted">
            Accede al panel de tu barbería
          </p>
        </div>

        {/* Card */}
        <div className="rounded-card border border-border bg-background-secondary p-6 shadow-card sm:p-8">
          <LoginForm />
        </div>

        {/* Instalar la app (solo teléfono, si aún no está instalada) */}
        <InstallAppPrompt variant="banner" />

        {/* Footer */}
        <p className="text-center text-label font-sans text-muted">
          Mi barbería — Panel del personal
        </p>
      </div>
    </div>
  );
}
