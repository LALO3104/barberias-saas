"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { useGsapAnimation } from "@/hooks/useGsapAnimation";
import type { HeroContent } from "@/types/content";

interface HeroProps {
  content: HeroContent;
}

/**
 * Única sección con una entrada un poco más elaborada (stagger corto de
 * eyebrow → título → subtítulo → CTAs). El resto de la landing usa el
 * fade + slide sencillo de ScrollReveal — la idea es reservar el momento
 * "especial" para la primera impresión, no repetirlo en cada sección.
 */
export function Hero({ content }: HeroProps) {
  // Container no reenvía refs (es un componente simple, no forwardRef), así
  // que el scope de la animación vive en este div interno en vez de tocar
  // Container solo para este caso.
  const scopeRef = useRef<HTMLDivElement>(null);

  useGsapAnimation(
    ({ gsap }) => {
      gsap
        .timeline({ defaults: { ease: "power3.out", duration: 0.8 } })
        .from(".hero-eyebrow", { opacity: 0, y: 16 })
        .from(".hero-title", { opacity: 0, y: 24 }, "-=0.5")
        .from(".hero-subtitle", { opacity: 0, y: 16 }, "-=0.5")
        .from(".hero-ctas", { opacity: 0, y: 16 }, "-=0.5");
    },
    { scope: scopeRef }
  );

  return (
    <section className="flex min-h-[85vh] items-center">
      <Container className="py-[var(--spacing-section)]">
        <div ref={scopeRef}>
          <p className="hero-eyebrow text-label font-sans uppercase tracking-label text-muted">
            {content.eyebrow}
          </p>
          <h1 className="hero-title mt-4 max-w-3xl text-hero font-display text-foreground">
            {content.title}
          </h1>
          <p className="hero-subtitle mt-6 max-w-xl text-body font-sans text-muted">
            {content.subtitle}
          </p>
          <div className="hero-ctas mt-10 flex flex-wrap items-center gap-4">
            <Button href={content.primaryCta.href} size="lg">
              {content.primaryCta.label}
            </Button>
            {content.secondaryCta && (
              <Button href={content.secondaryCta.href} variant="secondary" size="lg">
                {content.secondaryCta.label}
              </Button>
            )}
          </div>
        </div>
      </Container>
    </section>
  );
}
