import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getSupabaseServer } from "@/lib/supabase/server";
import { fetchPublicTenant } from "@/lib/public-api";
import { formatPrice, formatDuration, formatBusinessHours } from "@/lib/format";
import type { PublicTenant } from "@/types/public";

import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { ScrollReveal } from "@/components/animations/ScrollReveal";
import { TenantHero } from "@/components/public/TenantHero";
import { PublicServiceCard } from "@/components/public/PublicServiceCard";
import { PublicBarberCard } from "@/components/public/PublicBarberCard";
import { BookingSection } from "@/components/public/BookingSection";

// ─── Route props (generadas por Next.js al correr dev/build) ───────────────

interface SlugRouteProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// ─── Metadata dinámica por tenant ───────────────────────────────────────────

export async function generateMetadata(
  props: SlugRouteProps
): Promise<Metadata> {
  const { slug } = await props.params;
  const supabase = await getSupabaseServer();
  if (!supabase) return { title: "Barbería" };

  const tenant = await fetchPublicTenant(supabase, slug);
  if (!tenant) return { title: "Barbería no encontrada" };

  const siteContent = tenant.site_content as Record<string, string> | null;
  const tagline = siteContent?.tagline ?? siteContent?.hero_title ?? "";
  const title = tagline ? `${tenant.name} — ${tagline}` : tenant.name;
  const description =
    siteContent?.description ??
    `Reserva tu cita en ${tenant.name}. Servicios de barbería premium.`;

  return {
    title,
    description,
    openGraph: { title, description, type: "website" },
  };
}

// ─── Page Component ─────────────────────────────────────────────────────────

export default async function TenantPublicPage(
  props: SlugRouteProps
) {
  const { slug } = await props.params;

  const supabase = await getSupabaseServer();
  if (!supabase) notFound();

  const tenant = await fetchPublicTenant(supabase, slug);
  if (!tenant) notFound();

  const siteContent = (tenant.site_content ?? {}) as Record<string, string>;
  const currency = tenant.currency ?? "MXN";

  // Construir nav y datos de la landing a partir de los datos reales del tenant
  const nav = [
    { label: "Servicios", href: "#servicios" },
    ...(tenant.barbers.length > 0
      ? [{ label: "Barberos", href: "#barberos" }]
      : []),
    { label: "Horarios", href: "#horarios" },
    { label: "Reservar", href: "#reservar" },
  ];

  const businessHours = formatBusinessHours(tenant.business_hours);

  return (
    <>
      <Navbar
        tenantName={tenant.name}
        links={nav}
        cta={{ label: "Reservar cita", href: "#reservar" }}
      />

      <main>
        {/* ── Hero ──────────────────────────────────────────────────── */}
        <TenantHero
          name={tenant.name}
          tagline={siteContent.tagline ?? siteContent.hero_title}
          subtitle={siteContent.hero_subtitle ?? siteContent.description}
        />

        {/* ── Servicios ────────────────────────────────────────────── */}
        {tenant.services.length > 0 && (
          <section id="servicios" className="border-t border-border">
            <Container className="py-[var(--spacing-section)]">
              <ScrollReveal>
                <SectionHeading
                  eyebrow="Servicios"
                  title="Lo que ofrecemos"
                />
              </ScrollReveal>
              <div className="mt-12 space-y-0">
                {tenant.services.map((service, i) => (
                  <ScrollReveal key={service.id} delay={i * 0.06}>
                    <PublicServiceCard
                      name={service.name}
                      description={service.description}
                      price={formatPrice(service.price_cents, currency)}
                      duration={formatDuration(service.duration_minutes)}
                    />
                  </ScrollReveal>
                ))}
              </div>
            </Container>
          </section>
        )}

        {/* ── Barberos ─────────────────────────────────────────────── */}
        {tenant.barbers.length > 0 && (
          <section id="barberos" className="border-t border-border">
            <Container className="py-[var(--spacing-section)]">
              <ScrollReveal>
                <SectionHeading
                  eyebrow="El equipo"
                  title="Nuestros barberos"
                />
              </ScrollReveal>
              <div className="mt-12 grid gap-[var(--spacing-gutter)] sm:grid-cols-2 lg:grid-cols-3">
                {tenant.barbers.map((barber, i) => (
                  <ScrollReveal key={barber.id} delay={i * 0.06}>
                    <PublicBarberCard
                      name={barber.display_name}
                      role={barber.role_title}
                      bio={barber.bio}
                      photoUrl={barber.photo_url}
                    />
                  </ScrollReveal>
                ))}
              </div>
            </Container>
          </section>
        )}

        {/* ── Horarios y ubicación ──────────────────────────────────── */}
        <HoursSection
          tenant={tenant}
          businessHours={businessHours}
        />

        {/* ── Reservar cita ─────────────────────────────────────────── */}
        <BookingSection tenant={tenant} />
      </main>

      <Footer
        tenantName={tenant.name}
        nav={nav}
        location={{
          addressLine: [tenant.address_line, tenant.city, tenant.state]
            .filter(Boolean)
            .join(", ") || "Dirección no disponible",
          phone: tenant.public_phone ?? undefined,
        }}
        footer={{
          tagline: siteContent.footer_tagline ?? `${tenant.name} — Barbería premium`,
          socialLinks: parseSocialLinks(siteContent),
        }}
      />
    </>
  );
}

// ─── Helpers internos ───────────────────────────────────────────────────────

function parseSocialLinks(
  siteContent: Record<string, string>
): { label: string; href: string }[] {
  const links: { label: string; href: string }[] = [];
  if (siteContent.instagram_url) {
    links.push({ label: "Instagram", href: siteContent.instagram_url });
  }
  if (siteContent.facebook_url) {
    links.push({ label: "Facebook", href: siteContent.facebook_url });
  }
  if (siteContent.tiktok_url) {
    links.push({ label: "TikTok", href: siteContent.tiktok_url });
  }
  return links;
}

// ─── Hours Section (Server Component) ───────────────────────────────────────

function HoursSection({
  tenant,
  businessHours,
}: {
  tenant: PublicTenant;
  businessHours: { day: string; hours: string }[];
}) {
  if (businessHours.length === 0) return null;

  const address = [tenant.address_line, tenant.city, tenant.state]
    .filter(Boolean)
    .join(", ");

  return (
    <section id="horarios" className="border-t border-border">
      <Container className="py-[var(--spacing-section)]">
        <ScrollReveal>
          <SectionHeading
            eyebrow="Visítanos"
            title="Horarios y ubicación"
          />
        </ScrollReveal>

        <div className="mt-12 grid gap-[var(--spacing-gutter)] md:grid-cols-2">
          <ScrollReveal>
            <div className="rounded-card border border-border bg-background-secondary p-[var(--spacing-card)]">
              <h3 className="text-lg font-display text-foreground">Horario</h3>
              <dl className="mt-4 space-y-2">
                {businessHours.map((entry) => (
                  <div
                    key={entry.day}
                    className="flex justify-between text-body font-sans"
                  >
                    <dt className="text-foreground">{entry.day}</dt>
                    <dd className="text-muted">{entry.hours}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </ScrollReveal>

          <ScrollReveal delay={0.06}>
            <div className="rounded-card border border-border bg-background-secondary p-[var(--spacing-card)]">
              <h3 className="text-lg font-display text-foreground">Ubicación</h3>
              <div className="mt-4 space-y-2 text-body font-sans text-muted">
                {address && <p>{address}</p>}
                {tenant.postal_code && <p>C.P. {tenant.postal_code}</p>}
                {tenant.public_phone && (
                  <p>
                    <a
                      href={`tel:${tenant.public_phone}`}
                      className="text-accent transition-colors hover:text-foreground"
                    >
                      {tenant.public_phone}
                    </a>
                  </p>
                )}
              </div>
            </div>
          </ScrollReveal>
        </div>
      </Container>
    </section>
  );
}
