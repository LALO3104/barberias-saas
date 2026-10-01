import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { ScrollReveal } from "@/components/animations/ScrollReveal";
import type { BookingCtaContent } from "@/types/content";

interface BookingCtaProps {
  content: BookingCtaContent;
}

/**
 * Bloque final de llamada a la acción. Puramente visual: título, texto y
 * un botón — sin formulario, sin estado, sin lógica de disponibilidad.
 * `content.cta.href` viene centralizado desde data/tenants/kings.ts
 * (bookingHref), así que cuando exista /reservar solo cambia ese valor.
 */
export function BookingCta({ content }: BookingCtaProps) {
  return (
    <section id="reservar" className="border-t border-border bg-background-secondary">
      <Container className="py-[var(--spacing-section)] text-center">
        <ScrollReveal className="mx-auto max-w-xl">
          <p className="text-label font-sans uppercase tracking-label text-muted">
            {content.eyebrow}
          </p>
          <h2 className="mt-3 text-section font-display text-foreground">
            {content.title}
          </h2>
          <p className="mt-4 text-body font-sans text-muted">{content.body}</p>
          <div className="mt-8 flex justify-center">
            <Button href={content.cta.href} size="lg">
              {content.cta.label}
            </Button>
          </div>
        </ScrollReveal>
      </Container>
    </section>
  );
}
