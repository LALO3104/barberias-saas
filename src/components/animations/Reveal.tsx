"use client";

import { useRef, type ReactNode } from "react";
import { useGsapAnimation } from "@/hooks/useGsapAnimation";

interface RevealProps {
  children: ReactNode;
  /** Retraso antes de iniciar la animación, en segundos. */
  delay?: number;
  className?: string;
}

/**
 * Envuelve contenido y lo revela con un fade + slide sutil al montar.
 *
 * Es el ejemplo de referencia de cómo aislar una animación GSAP dentro de un
 * componente reutilizable en lugar de repetir la lógica (y el registro de
 * plugins) dentro de cada sección de la página. Nuevos efectos reutilizables
 * (aparecer al hacer scroll con ScrollTrigger, dividir texto con SplitText,
 * etc.) deberían seguir este mismo patrón: un componente Cliente que usa
 * `useGsapAnimation` internamente.
 */
export function Reveal({ children, delay = 0, className }: RevealProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useGsapAnimation(
    ({ gsap }) => {
      gsap.from(containerRef.current, {
        opacity: 0,
        y: 24,
        duration: 0.8,
        delay,
        ease: "power3.out",
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
