import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { BarberCard } from "@/components/ui/BarberCard";
import { ScrollReveal } from "@/components/animations/ScrollReveal";
import type { Barber, SectionHeadingContent } from "@/types/content";

interface BarbersProps {
  heading: SectionHeadingContent;
  barbers: Barber[];
}

// Debe coincidir con el href "#barberos" de la data del tenant.
const SECTION_ID = "barberos";

export function Barbers({ heading, barbers }: BarbersProps) {
  return (
    <section id={SECTION_ID} className="border-t border-border">
      <Container className="py-[var(--spacing-section)]">
        <ScrollReveal>
          <SectionHeading
            eyebrow={heading.eyebrow}
            title={heading.title}
            description={heading.description}
          />
        </ScrollReveal>

        <div className="mt-[var(--spacing-card)] grid gap-[var(--spacing-gutter)] sm:grid-cols-2 lg:grid-cols-3">
          {barbers.map((barber, index) => (
            <ScrollReveal key={barber.id} delay={index * 0.06}>
              <BarberCard barber={barber} />
            </ScrollReveal>
          ))}
        </div>
      </Container>
    </section>
  );
}
