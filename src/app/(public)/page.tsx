import type { Metadata } from "next";
import { Barbers } from "@/components/sections/Barbers";
import { BookingCta } from "@/components/sections/BookingCta";
import { Gallery } from "@/components/sections/Gallery";
import { Hero } from "@/components/sections/Hero";
import { HoursLocation } from "@/components/sections/HoursLocation";
import { Services } from "@/components/sections/Services";
import { ValueProposition } from "@/components/sections/ValueProposition";
import { Footer } from "@/components/layout/Footer";
import { Navbar } from "@/components/layout/Navbar";
import { kingsTenant } from "@/data/tenants/kings";
import { buildTenantMetadata } from "@/lib/seo";

export const metadata: Metadata = buildTenantMetadata(kingsTenant);

/**
 * Landing pública — hoy sirve directamente a Barbería Kings (import fijo
 * de `kingsTenant` abajo). Cuando exista multi-tenant real, este es el
 * único archivo que cambia: el import fijo se reemplaza por algo como
 * `getTenantBySlug(params.slug)` y se renderiza igual — ninguna sección
 * ni componente necesita tocarse.
 *
 * Ningún componente importado aquí conoce a "Kings": todos reciben su
 * contenido ya resuelto por props, tomado de `tenant` abajo.
 */
export default function PublicLandingPage() {
  const tenant = kingsTenant;

  return (
    <>
      {/*
        Aviso de contenido demo — ver data/tenants/kings.ts. Se quita en
        cuanto Barbería Kings confirme su contenido real; no es parte del
        sistema reutilizable, por eso vive aquí y no en components/.
      */}
      <p className="border-b border-border bg-background-secondary px-4 py-2 text-center text-label font-sans uppercase tracking-label text-muted">
        Vista previa — contenido de muestra, pendiente de confirmar con
        Barbería Kings
      </p>

      <Navbar
        tenantName={tenant.tenant.name}
        links={tenant.nav}
        cta={{ label: tenant.hero.primaryCta.label, href: tenant.bookingHref }}
      />

      <main>
        <Hero content={tenant.hero} />
        <ValueProposition content={tenant.valueProposition} />
        <Services heading={tenant.servicesSection} services={tenant.services} />
        <Barbers heading={tenant.barbersSection} barbers={tenant.barbers} />
        <Gallery heading={tenant.gallerySection} images={tenant.gallery} />
        <HoursLocation
          heading={tenant.hoursLocationSection}
          hours={tenant.hours}
          location={tenant.location}
        />
        <BookingCta content={tenant.bookingCta} />
      </main>

      <Footer
        tenantName={tenant.tenant.name}
        nav={tenant.nav}
        location={tenant.location}
        footer={tenant.footer}
      />
    </>
  );
}
