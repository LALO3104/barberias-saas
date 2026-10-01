import { Container } from "@/components/ui/Container";
import type { FooterContent, LocationContent, NavLink } from "@/types/content";

interface FooterProps {
  tenantName: string;
  nav: NavLink[];
  location: LocationContent;
  footer: FooterContent;
}

/**
 * Footer genérico — recibe todo por props, no sabe qué barbería se
 * muestra. Server Component: sin estado, sin animación.
 */
export function Footer({ tenantName, nav, location, footer }: FooterProps) {
  return (
    <footer className="border-t border-border">
      <Container className="grid gap-[var(--spacing-gutter)] py-[var(--spacing-card)] sm:grid-cols-3">
        <div>
          <p className="text-lg font-display text-foreground">{tenantName}</p>
          <p className="mt-2 text-body font-sans text-muted">{footer.tagline}</p>
        </div>

        <nav aria-label="Footer" className="flex flex-col gap-2">
          {nav.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-label font-sans uppercase tracking-label text-muted transition-colors hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="text-body font-sans text-muted">
          <p>{location.addressLine}</p>
          {location.phone && <p className="mt-1">{location.phone}</p>}
          <div className="mt-3 flex flex-wrap gap-4">
            {footer.socialLinks.map((social) => (
              <a
                key={social.href + social.label}
                href={social.href}
                className="text-label font-sans uppercase tracking-label text-muted transition-colors hover:text-foreground"
              >
                {social.label}
              </a>
            ))}
          </div>
        </div>
      </Container>
    </footer>
  );
}
