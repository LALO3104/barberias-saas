import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { getSupabaseServer } from "@/lib/supabase/server";
import { fetchPublicTenant } from "@/lib/public-api";
import { formatPhoneDisplay } from "@/lib/appointments";
import { Container } from "@/components/ui/Container";

interface PrivacyRouteProps {
  params: Promise<{ slug: string }>;
}

export const metadata: Metadata = {
  title: "Aviso de privacidad",
  description: "Cómo se usan tus datos al reservar una cita.",
};

/** Aviso de privacidad de la barbería, con sus datos reales. */
export default async function PrivacyPage(props: PrivacyRouteProps) {
  const { slug } = await props.params;
  const supabase = await getSupabaseServer();
  if (!supabase) notFound();
  const tenant = await fetchPublicTenant(supabase, slug);
  if (!tenant) notFound();

  const address = [tenant.address_line, tenant.city, tenant.state, tenant.postal_code].filter(Boolean).join(", ");
  const contact = tenant.public_phone ? formatPhoneDisplay(tenant.public_phone) : null;

  return (
    <main>
      <Container className="max-w-2xl py-[var(--spacing-section)]">
        <Link href={`/${tenant.slug}`} className="text-sm font-sans text-muted transition-colors hover:text-accent">
          ← {tenant.name}
        </Link>
        <h1 className="mt-4 text-section font-display text-foreground">Aviso de privacidad</h1>
        <p className="mt-2 text-sm font-sans text-muted">Última actualización: noviembre de 2026</p>

        <div className="mt-8 space-y-6 text-body font-sans text-muted">
          <Block title="Quién es responsable de tus datos">
            <p>
              <span className="text-foreground">{tenant.name}</span>
              {address ? `, con domicilio en ${address},` : ""} es responsable del uso de los datos personales que nos
              proporcionas.
            </p>
          </Block>

          <Block title="Qué datos recabamos">
            <p>
              Tu nombre, tu teléfono y, si decides escribirla, una nota sobre tu cita. También guardamos el historial de
              tus citas: fecha, servicios, barbero y lo que pagaste. No pedimos datos sensibles ni datos bancarios.
            </p>
          </Block>

          <Block title="Para qué los usamos">
            <p>
              Para agendar y administrar tus citas, avisarte de confirmaciones o cambios, llevar el registro de tus
              visitas y cobros, y atenderte mejor con notas internas sobre tus preferencias. No usamos tus datos para
              enviarte publicidad.
            </p>
          </Block>

          <Block title="Con quién los compartimos">
            <p>
              No vendemos tus datos. Se guardan con los proveedores que hacen funcionar este sitio (Supabase para la base
              de datos y Cloudflare para el alojamiento), que pueden estar fuera de México. Si nos escribes o te escribimos
              por WhatsApp, esa conversación también se rige por las condiciones de WhatsApp.
            </p>
          </Block>

          <Block title="Tus derechos">
            <p>
              Puedes pedir acceder a tus datos, corregirlos, cancelarlos u oponerte a su uso (derechos ARCO), así como
              revocar tu consentimiento.
              {contact ? ` Escríbenos al ${contact} o acude a la barbería.` : " Acude a la barbería para solicitarlo."}
            </p>
          </Block>

          <Block title="Cambios a este aviso">
            <p>Si este aviso cambia, publicaremos la nueva versión en esta misma página.</p>
          </Block>
        </div>
      </Container>
    </main>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-display text-lg text-foreground">{title}</h2>
      <div className="mt-1.5">{children}</div>
    </section>
  );
}
