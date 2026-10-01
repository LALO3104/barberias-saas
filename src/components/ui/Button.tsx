import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost";
type ButtonSize = "sm" | "md" | "lg";

const variantStyles: Record<ButtonVariant, string> = {
  primary: "bg-accent text-background hover:brightness-110 active:brightness-95",
  secondary:
    "border border-border bg-transparent text-foreground hover:border-accent/60 hover:text-accent",
  ghost: "bg-transparent text-foreground hover:bg-foreground/5",
};

// md/lg cumplen el mínimo de 44px recomendado para objetivos táctiles;
// sm queda un poco debajo a propósito, para acciones secundarias/inline.
const sizeStyles: Record<ButtonSize, string> = {
  sm: "h-9 px-4 text-sm",
  md: "h-11 px-6 text-sm",
  lg: "h-12 px-8 text-base",
};

const baseStyles =
  "inline-flex cursor-pointer items-center justify-center rounded-button font-sans font-medium " +
  "transition-[background-color,border-color,color,filter,transform] duration-200 ease-out " +
  "hover:-translate-y-0.5 active:translate-y-0 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background " +
  "disabled:pointer-events-none disabled:opacity-50 disabled:hover:translate-y-0";

interface ButtonOwnProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}

type ButtonAsButtonProps = ButtonOwnProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> & { href?: undefined };

type ButtonAsAnchorProps = ButtonOwnProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "className"> & { href: string };

export type ButtonProps = ButtonAsButtonProps | ButtonAsAnchorProps;

/**
 * Botón base reutilizable del sistema visual.
 *
 * Con `href` se renderiza como `<a>` — para navegación real: anclas de la
 * misma página hoy (`#servicios`, `#reservar`), rutas reales cuando
 * existan — manteniendo exactamente el mismo estilo. Sin `href`, se
 * renderiza como `<button>`, para acciones de UI (el menú móvil, por
 * ejemplo). Necesario para que "Reservar cita" sea un enlace de verdad y
 * no un botón sin destino navegable.
 *
 * Solo microinteracciones CSS a propósito en este paso (color, brillo,
 * borde y un desplazamiento mínimo en hover/active) — las animaciones con
 * GSAP para botones se agregan más adelante, no aquí.
 */
export function Button({
  className,
  variant = "primary",
  size = "md",
  ...props
}: ButtonProps) {
  const classes = cn(baseStyles, variantStyles[variant], sizeStyles[size], className);

  if (props.href !== undefined) {
    return <a className={classes} {...props} />;
  }

  return <button className={classes} {...props} />;
}
