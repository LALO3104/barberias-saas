import type { Metadata } from "next";
import Link from "next/link";
import { getSupabaseServer } from "@/lib/supabase/server";
import { InviteForm } from "@/components/auth/InviteForm";

export const metadata: Metadata = {
  title: "Activa tu cuenta — Mi barbería",
  description: "Crea tu acceso al panel de la barbería.",
  robots: { index: false },
};

interface PageProps {
  params: Promise<{ token: string }>;
}

const TOKEN_RE = /^[0-9a-f]{64}$/;

/** Enlace de invitación de un barbero (public.get_barber_invite). */
export default async function InvitacionPage(props: PageProps) {
  const { token } = await props.params;
  const supabase = await getSupabaseServer();

  let invite: { barber_name: string; tenant_name: string } | null = null;
  if (supabase && TOKEN_RE.test(token)) {
    const { data, error } = await supabase.rpc("get_barber_invite", { _token: token });
    if (!error && data) invite = data as unknown as { barber_name: string; tenant_name: string };
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <div className="w-full max-w-md space-y-8 py-8">
        <div className="text-center">
          <h1 className="text-section font-display text-foreground">
            {invite ? `Hola, ${invite.barber_name}` : "Invitación no válida"}
          </h1>
          <p className="mt-2 text-body font-sans text-muted">
            {invite
              ? `Crea tu acceso a ${invite.tenant_name}`
              : "Este enlace ya se usó, caducó o fue reemplazado. Pide uno nuevo al administrador."}
          </p>
        </div>

        {invite ? (
          <div className="rounded-card border border-border bg-background-secondary p-6 shadow-card sm:p-8">
            <InviteForm token={token} />
          </div>
        ) : (
          <p className="text-center">
            <Link href="/login" className="text-sm font-sans text-accent transition-colors hover:text-foreground">
              Ir a iniciar sesión
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
