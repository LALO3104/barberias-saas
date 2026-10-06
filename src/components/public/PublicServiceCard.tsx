interface PublicServiceCardProps {
  name: string;
  description: string | null;
  price: string;
  duration: string;
}

/**
 * Servicio en diseño editorial — no tarjeta genérica.
 * Layout: nombre + dots + precio en una línea, descripción + duración debajo.
 * Server Component.
 */
export function PublicServiceCard({
  name,
  description,
  price,
  duration,
}: PublicServiceCardProps) {
  return (
    <div className="group border-b border-border py-6 first:pt-0 last:border-b-0">
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="text-lg font-display text-foreground transition-colors group-hover:text-accent">
          {name}
        </h3>
        <div className="hidden flex-1 border-b border-dotted border-border/60 sm:block" />
        <span className="shrink-0 text-lg font-display text-accent">
          {price}
        </span>
      </div>
      <div className="mt-2 flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
        {description && (
          <p className="text-body font-sans text-muted">{description}</p>
        )}
        <span className="shrink-0 text-label font-sans uppercase tracking-label text-muted">
          {duration}
        </span>
      </div>
    </div>
  );
}
