"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { useGsapAnimation } from "@/hooks/useGsapAnimation";

interface TenantHeroProps {
  name: string;
  tagline?: string;
  subtitle?: string;
}

/**
 * Hero para la landing pública del tenant. Datos del backend, no estáticos.
 * Animación staggered con GSAP — misma lógica que Hero.tsx de la maqueta
 * pero alimentado por datos reales del RPC.
 */
export function TenantHero({ name, tagline, subtitle }: TenantHeroProps) {
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
          <p className="hero-eyebrow text-label font-sans uppercase tracking-label text-accent">
            {name}
          </p>
          <h1 className="hero-title mt-4 max-w-4xl text-hero font-display text-foreground">
            {tagline ?? "Tu barbería de confianza"}
          </h1>
          {subtitle && (
            <p className="hero-subtitle mt-6 max-w-xl text-body font-sans text-muted">
              {subtitle}
            </p>
          )}
          <div className="hero-ctas mt-10 flex flex-wrap items-center gap-4">
            <Button href="#reservar" size="lg">
              Reservar cita
            </Button>
            <Button href="#servicios" variant="secondary" size="lg">
              Ver servicios
            </Button>
          </div>
        </div>
      </Container>
    </section>
  );
}
