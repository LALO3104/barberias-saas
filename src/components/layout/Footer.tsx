import { Container } from "@/components/ui/Container";
import { formatPhoneDisplay } from "@/lib/appointments";
import type { FooterContent, LocationContent, NavLink } from "@/types/content";

interface FooterProps {
  tenantName: string;
  nav: NavLink[];
  location: LocationContent;
  footer: FooterContent;
}

const HEADING = "text-label font-sans uppercase tracking-label text-accent";
const LINK =
  "inline-flex min-h-9 items-center text-body font-sans text-foreground/85 transition-colors duration-150 ease-out hover:text-accent active:text-accent";

/**
 * Footer genérico — recibe todo por props, no sabe qué barbería se muestra.
 * Un solo bloque: marca, navegación, contacto y créditos comparten fondo y
 * contenedor. Server Component: sin estado, sin animación.
 */
export function Footer({ tenantName, nav, location, footer }: FooterProps) {
  const hasContact = !!location.addressLine || !!location.phone || footer.socialLinks.length > 0;

  return (
    <footer id="contacto" className="border-t border-border bg-background-secondary pb-[env(safe-area-inset-bottom)]">
      <Container className="pb-8 pt-[var(--spacing-section)]">
        <div className="grid gap-x-[var(--spacing-gutter)] gap-y-10 md:grid-cols-[2fr_1fr_1fr]">
          <div className="max-w-md">
            <p className="text-section font-display text-foreground">{tenantName}</p>
            <p className="mt-3 text-body font-sans text-muted">{footer.tagline}</p>
          </div>

          <nav aria-label="Pie de página">
            <p className={HEADING}>Explora</p>
            <ul className="mt-3">
              {nav.map((link) => (
                <li key={link.href}>
                  <a href={link.href} className={LINK}>
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          {hasContact && (
            <div>
              <p className={HEADING}>Visítanos</p>
              <div className="mt-3 space-y-1">
                {location.addressLine && <p className="text-body font-sans text-foreground/85">{location.addressLine}</p>}
                {location.phone && (
                  <a href={`tel:${location.phone}`} className={`${LINK} tabular-nums`}>
                    {formatPhoneDisplay(location.phone)}
                  </a>
                )}
              </div>
              {footer.socialLinks.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-x-5">
                  {footer.socialLinks.map((social) => (
                    <li key={social.href + social.label}>
                      <a href={social.href} target="_blank" rel="noopener noreferrer" className={LINK}>
                        {social.label}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="mt-14 flex flex-col gap-1 text-sm font-sans text-muted sm:flex-row sm:flex-wrap sm:items-baseline sm:justify-between sm:gap-x-8">
          <p>Hecha con cariño por Eduardo Chavez {"<3"}</p>
          <p>
            Contacto para tu barbería:{" "}
            <a
              href="mailto:edu.3104.ec@gmail.com"
              className="block w-fit text-foreground/85 underline underline-offset-4 sm:inline transition-colors duration-150 ease-out hover:text-accent active:text-accent"
            >
              edu.3104.ec@gmail.com
            </a>
          </p>
        </div>
      </Container>
    </footer>
  );
}
