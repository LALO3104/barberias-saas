"use client";

import { useRef, type ReactNode } from "react";
import { useGsapAnimation } from "@/hooks/useGsapAnimation";

interface ScrollRevealProps {
  children: ReactNode;
  /** Retraso antes de iniciar la animación, en segundos (para stagger manual entre varios ScrollReveal). */
  delay?: number;
  className?: string;
}

/**
 * Como Reveal, pero dispara al entrar en el viewport (ScrollTrigger) en vez
 * de al montar — pensado para secciones de una landing larga, donde animar
 * "al montar" movería la mitad del contenido fuera de pantalla antes de
 * que el usuario llegue a verlo.
 *
 * Mismo patrón que Reveal: pasa por useGsapAnimation, así que respeta
 * prefers-reduced-motion automáticamente. ScrollTrigger ya está registrado
 * en lib/gsap/gsap.ts, aquí solo se usa.
 */
export function ScrollReveal({ children, delay = 0, className }: ScrollRevealProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useGsapAnimation(
    ({ gsap }) => {
      gsap.from(containerRef.current, {
        opacity: 0,
        y: 32,
        duration: 0.8,
        delay,
        ease: "power3.out",
        scrollTrigger: {
          trigger: containerRef.current,
          start: "top 85%",
        },
      });
    },
    { scope: containerRef }
  );

  return (
    <div ref={containerRef} className={className}>
      {children}
    </div>
  );
}
