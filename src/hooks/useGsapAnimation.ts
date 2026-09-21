"use client";

import { useGSAP } from "@gsap/react";
import type { RefObject } from "react";
import { gsap } from "@/lib/gsap/gsap";

type GsapScope = RefObject<HTMLElement | null> | string;

interface UseGsapAnimationOptions {
  /** Elemento (o selector) al que se limitan las búsquedas con gsap.utils.selector / animaciones. */
  scope?: GsapScope;
  /** Igual que las dependencias de useEffect: si cambian, la animación se vuelve a crear. */
  dependencies?: unknown[];
}

type GsapAnimationCallback = (context: { gsap: typeof gsap }) => void;

/**
 * Punto único para ejecutar animaciones GSAP dentro de Client Components.
 *
 * Qué resuelve, en una sola llamada:
 * 1. Usa `useGSAP` (el hook oficial de @gsap/react), que crea un
 *    `gsap.context()` y limpia automáticamente las animaciones al
 *    desmontar el componente o cuando cambian las `dependencies`.
 * 2. Respeta `prefers-reduced-motion`: si el usuario lo activó, el callback
 *    de animación simplemente no se ejecuta y el contenido queda visible en
 *    su estado final, sin necesidad de repetir ese check en cada componente.
 *
 * Debe usarse solo dentro de componentes marcados con "use client".
 *
 * Ejemplo:
 * ```tsx
 * "use client";
 * const ref = useRef<HTMLDivElement>(null);
 * useGsapAnimation(({ gsap }) => {
 *   gsap.from(ref.current, { opacity: 0, y: 24, duration: 0.8 });
 * }, { scope: ref });
 * ```
 */
export function useGsapAnimation(
  callback: GsapAnimationCallback,
  { scope, dependencies = [] }: UseGsapAnimationOptions = {}
) {
  useGSAP(
    () => {
      const prefersReducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      ).matches;

      if (prefersReducedMotion) {
        return;
      }

      callback({ gsap });
    },
    { scope, dependencies }
  );
}
