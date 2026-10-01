import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { ScrollReveal } from "@/components/animations/ScrollReveal";
import type {
  HoursEntry,
  LocationContent,
  SectionHeadingContent,
} from "@/types/content";

interface HoursLocationProps {
  heading: SectionHeadingContent;
  hours: HoursEntry[];
  location: LocationContent;
}

// Debe coincidir con el href "#horarios" de la data del tenant.
const SECTION_ID = "horarios";

export function HoursLocation({ heading, hours, location }: HoursLocationProps) {
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

        <div className="mt-[var(--spacing-card)] grid gap-[var(--spacing-gutter)] sm:grid-cols-2">
          <ScrollReveal>
            <Card className="h-full">
              <h3 className="text-lg font-display text-foreground">Horario</h3>
              <dl className="mt-4 space-y-2">
                {hours.map((entry) => (
                  <div
                    key={entry.day}
                    className="flex items-center justify-between gap-4 text-body font-sans"
                  >
                    <dt className="text-foreground">{entry.day}</dt>
                    <dd className="text-muted">{entry.hours}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          </ScrollReveal>

          <ScrollReveal delay={0.08}>
            <Card className="h-full">
              <h3 className="text-lg font-display text-foreground">Ubicación</h3>
              <p className="mt-4 text-body font-sans text-muted">
                {location.addressLine}
              </p>
              {location.phone && (
                <p className="mt-2 text-body font-sans text-muted">
                  {location.phone}
                </p>
              )}
            </Card>
          </ScrollReveal>
        </div>
      </Container>
    </section>
  );
}
