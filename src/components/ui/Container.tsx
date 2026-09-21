import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Contenedor con ancho máximo y padding lateral consistentes.
 * Pensado para envolver secciones completas de página.
 */
export function Container({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8", className)}
      {...props}
    />
  );
}
