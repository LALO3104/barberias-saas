import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Superficie base reutilizable (cards, paneles). La profundidad viene de
 * contraste de fondo + borde sutil + sombra ligera — nada de sombras
 * pesadas. Usa los mismos tokens que el resto del sistema (rounded-card,
 * shadow-card, border-border, bg-background-secondary).
 */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-card border border-border bg-background-secondary p-[var(--spacing-card)] shadow-card",
        className
      )}
      {...props}
    />
  );
}
