import { Container } from "@/components/ui/Container";
import { ImagePlaceholder } from "@/components/ui/ImagePlaceholder";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { ScrollReveal } from "@/components/animations/ScrollReveal";
import type { GalleryImage, SectionHeadingContent } from "@/types/content";

interface GalleryProps {
  heading: SectionHeadingContent;
  images: GalleryImage[];
}

// Debe coincidir con el href "#galeria" de la data del tenant.
const SECTION_ID = "galeria";

export function Gallery({ heading, images }: GalleryProps) {
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

        <div className="mt-[var(--spacing-card)] grid grid-cols-2 gap-[var(--spacing-gutter)] sm:grid-cols-3">
          {images.map((image, index) => (
            <ScrollReveal key={image.id} delay={index * 0.04}>
              <ImagePlaceholder alt={image.alt} className="aspect-square w-full" />
            </ScrollReveal>
          ))}
        </div>
      </Container>
    </section>
  );
}
