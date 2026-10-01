import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { ScrollReveal } from "@/components/animations/ScrollReveal";
import type { ValuePropositionContent } from "@/types/content";

interface ValuePropositionProps {
  content: ValuePropositionContent;
}

/**
 * Propuesta de valor / experiencia. Server Component: solo el wrapper de
 * animación (ScrollReveal) es cliente, el contenido en sí no necesita
 * interactividad.
 */
export function ValueProposition({ content }: ValuePropositionProps) {
  return (
    <section className="border-t border-border">
      <Container className="py-[var(--spacing-section)]">
        <ScrollReveal>
          <SectionHeading
            eyebrow={content.eyebrow}
            title={content.title}
            description={content.body}
          />
        </ScrollReveal>

        <div className="mt-[var(--spacing-card)] grid gap-[var(--spacing-gutter)] sm:grid-cols-3">
          {content.pillars.map((pillar, index) => (
            <ScrollReveal key={pillar.title} delay={index * 0.08}>
              <Card className="h-full">
                <h3 className="text-lg font-display text-foreground">
                  {pillar.title}
                </h3>
                <p className="mt-2 text-body font-sans text-muted">
                  {pillar.description}
                </p>
              </Card>
            </ScrollReveal>
          ))}
        </div>
      </Container>
    </section>
  );
}
