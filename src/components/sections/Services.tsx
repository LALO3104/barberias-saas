import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { ServiceCard } from "@/components/ui/ServiceCard";
import { ScrollReveal } from "@/components/animations/ScrollReveal";
import type { SectionHeadingContent, Service } from "@/types/content";

interface ServicesProps {
  heading: SectionHeadingContent;
  services: Service[];
}

// El id debe coincidir con el href "#servicios" que arma la data del
// tenant (ver nav en data/tenants/kings.ts) — es un ancla estructural, no
// contenido, por eso no viene por props.
const SECTION_ID = "servicios";

export function Services({ heading, services }: ServicesProps) {
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
          {services.map((service, index) => (
            <ScrollReveal key={service.id} delay={index * 0.06}>
              <ServiceCard service={service} />
            </ScrollReveal>
          ))}
        </div>
      </Container>
    </section>
  );
}
