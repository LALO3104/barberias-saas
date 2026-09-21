import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: "bg-foreground text-background hover:opacity-90",
  secondary:
    "bg-transparent border border-foreground/20 hover:bg-foreground/5",
  ghost: "bg-transparent hover:bg-foreground/5",
};

/**
 * Botón base reutilizable. Sin estilos específicos de "Barbería Kings" ni de
 * ninguna barbería en particular: solo las variantes genéricas que cualquier
 * pantalla del proyecto (sitio público, reservas, dashboard) va a necesitar.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center rounded-full px-5 py-2.5 text-sm font-medium transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/50 focus-visible:ring-offset-2",
          "disabled:pointer-events-none disabled:opacity-50",
          variantStyles[variant],
          className
        )}
        {...props}
      />
    );
  }
);

Button.displayName = "Button";
