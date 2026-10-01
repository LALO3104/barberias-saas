import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Contenedor base del sistema visual: limita el ancho máximo y aplica
 * padding lateral responsive. Toda sección futura (Hero, Services,
 * Barbers, etc.) debería envolver su contenido en este componente en vez
 * de definir su propio ancho máximo o padding lateral.
 *
 * El ancho máximo y el padding viven en tokens (--container-max-width y
 * --spacing-container, ver src/styles/tokens.css) — nada está hardcodeado
 * aquí. El padding usa clamp(), así que escala de forma fluida entre
 * 360px y pantallas grandes sin breakpoints manuales, y w-full + max-w
 * evita cualquier overflow horizontal.
 */
export function Container({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "mx-auto w-full max-w-[var(--container-max-width)] px-[var(--spacing-container)]",
        className
      )}
      {...props}
    />
  );
}
