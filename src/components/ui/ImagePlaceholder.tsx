import { cn } from "@/lib/utils";

interface ImagePlaceholderProps {
  /**
   * Igual que el `alt` que llevará la imagen real más adelante — se usa
   * como nombre accesible del placeholder, así que debe describir el
   * contenido final, no decir "placeholder".
   */
  alt: string;
  className?: string;
}

/**
 * Ocupa el lugar de una imagen real mientras no exista (ver ARCHITECTURE.md
 * → estrategia de imágenes). No depende de ninguna URL externa.
 *
 * El `className` de quien lo use debe traer el `aspect-[...]` que
 * corresponda (retrato para barberos, cuadrado para galería, etc.) — este
 * componente no asume ninguno.
 *
 * Cuando haya fotos reales, se reemplaza por `next/image` con `fill` +
 * `object-cover` dentro del mismo contenedor — el layout no cambia.
 */
export function ImagePlaceholder({ alt, className }: ImagePlaceholderProps) {
  return (
    <div
      role="img"
      aria-label={alt}
      className={cn(
        "flex aspect-[4/5] items-center justify-center rounded-card border border-border bg-gradient-to-br from-background-secondary to-background",
        className
      )}
    >
      <span className="text-label font-sans uppercase tracking-label text-muted">
        Imagen pendiente
      </span>
    </div>
  );
}
