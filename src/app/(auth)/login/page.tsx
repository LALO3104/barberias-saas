import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getSupabaseServer } from "@/lib/supabase/server";
import { LoginForm } from "@/components/auth/LoginForm";

export const metadata: Metadata = {
  title: "Iniciar sesión — Barberías",
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
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-8">
        {/* Header */}
        <div className="text-center">
          <Link href="/" className="inline-block">
            <h1 className="text-section font-display text-foreground">
              Barberías
            </h1>
          </Link>
          <p className="mt-2 text-body font-sans text-muted">
            Accede al panel de tu barbería
          </p>
        </div>

        {/* Card */}
        <div className="rounded-card border border-border bg-background-secondary p-8 shadow-card">
          <LoginForm />
        </div>

        {/* Footer */}
        <p className="text-center text-label font-sans text-muted">
          Barberías SaaS — Panel de administración
        </p>
      </div>
    </div>
  );
}
