import { cn } from "@/lib/utils";

interface SectionHeadingProps {
  eyebrow?: string;
  title: string;
  description?: string;
  className?: string;
}

/**
 * Encabezado de sección reutilizable (eyebrow uppercase + título en
 * font-display + descripción opcional) — el mismo patrón que ya se repetía
 * en el Design System Preview, ahora extraído porque se usa en 4+
 * secciones de la landing.
 */
export function SectionHeading({
  eyebrow,
  title,
  description,
  className,
}: SectionHeadingProps) {
  return (
    <div className={cn("max-w-2xl", className)}>
      {eyebrow && (
        <p className="text-label font-sans uppercase tracking-label text-muted">
          {eyebrow}
        </p>
      )}
      <h2
        className={cn(
          "text-section font-display text-foreground",
          eyebrow && "mt-3"
        )}
      >
        {title}
      </h2>
      {description && (
        <p className="mt-4 text-body font-sans text-muted">{description}</p>
      )}
    </div>
  );
}
