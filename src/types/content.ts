import type { Tenant } from "@/types/tenant";

/**
 * Formas de contenido genéricas para la landing pública de una barbería.
 *
 * Ningún tipo de este archivo menciona "Kings" ni ninguna barbería en
 * particular a propósito: son el contrato que cualquier barbería del SaaS
 * debe cumplir. El contenido real de cada una vive en `src/data/tenants/`
 * (hoy solo `kings.ts`), nunca aquí.
 */

export interface NavLink {
  label: string;
  href: string;
}

export interface CtaLink {
  label: string;
  href: string;
}

export interface HeroContent {
  eyebrow: string;
  title: string;
  subtitle: string;
  primaryCta: CtaLink;
  secondaryCta?: CtaLink;
}

export interface ValuePillar {
  title: string;
  description: string;
}

export interface ValuePropositionContent {
  eyebrow: string;
  title: string;
  body: string;
  pillars: ValuePillar[];
}

export interface Service {
  id: string;
  name: string;
  description: string;
  /** Texto libre para mostrar como precio (ej. "$XX" o "Desde $XX") — no asumir moneda ni formato. */
  price: string;
  duration: string;
}

export interface Barber {
  id: string;
  name: string;
  role: string;
  bio?: string;
  photo: {
    /** Obligatorio incluso mientras no haya foto real: describe a quién representa. */
    alt: string;
    /** Sin valor todavía = se usa un placeholder visual (ver ImagePlaceholder). */
    src?: string;
  };
}

export interface GalleryImage {
  id: string;
  alt: string;
  src?: string;
}

/**
 * Encabezado de una sección (eyebrow + título + descripción opcional).
 * Es contenido, no presentación: incluso el texto del título de "Servicios"
 * o "Barberos" viene de aquí, no hardcodeado en el componente de sección,
 * para que una barbería futura pueda llamar a sus secciones distinto.
 */
export interface SectionHeadingContent {
  eyebrow?: string;
  title: string;
  description?: string;
}

export interface HoursEntry {
  day: string;
  hours: string;
}

export interface LocationContent {
  addressLine: string;
  phone?: string;
  mapUrl?: string;
}

export interface BookingCtaContent {
  eyebrow: string;
  title: string;
  body: string;
  cta: CtaLink;
}

export interface SocialLink {
  label: string;
  href: string;
}

export interface FooterContent {
  tagline: string;
  socialLinks: SocialLink[];
}

/**
 * Contenido completo de la landing pública de una barbería. `kings.ts` (y,
 * más adelante, cada archivo nuevo en `data/tenants/`) exporta un valor de
 * este tipo. `app/(public)/page.tsx` es el único lugar que decide cuál se
 * renderiza.
 */
export interface TenantContent {
  tenant: Tenant;
  nav: NavLink[];
  bookingHref: string;
  hero: HeroContent;
  valueProposition: ValuePropositionContent;
  servicesSection: SectionHeadingContent;
  services: Service[];
  barbersSection: SectionHeadingContent;
  barbers: Barber[];
  gallerySection: SectionHeadingContent;
  gallery: GalleryImage[];
  hoursLocationSection: SectionHeadingContent;
  hours: HoursEntry[];
  location: LocationContent;
  bookingCta: BookingCtaContent;
  footer: FooterContent;
}
