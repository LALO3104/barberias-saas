import { Card } from "@/components/ui/Card";
import { ImagePlaceholder } from "@/components/ui/ImagePlaceholder";
import type { Barber } from "@/types/content";

interface BarberCardProps {
  barber: Barber;
}

/**
 * Tarjeta de un barbero. Puramente presentacional — recibe el barbero ya
 * resuelto por props, no sabe nada de Kings.
 */
export function BarberCard({ barber }: BarberCardProps) {
  return (
    <Card className="flex flex-col gap-[var(--spacing-gutter)]">
      <ImagePlaceholder alt={barber.photo.alt} className="aspect-[3/4] w-full" />
      <div>
        <h3 className="text-lg font-display text-foreground">{barber.name}</h3>
        <p className="text-label font-sans uppercase tracking-label text-muted">
          {barber.role}
        </p>
        {barber.bio && (
          <p className="mt-3 text-body font-sans text-muted">{barber.bio}</p>
        )}
      </div>
    </Card>
  );
}
