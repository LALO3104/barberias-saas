import Image from "next/image";
import { ImagePlaceholder } from "@/components/ui/ImagePlaceholder";

interface PublicBarberCardProps {
  name: string;
  role: string | null;
  bio: string | null;
  photoUrl: string | null;
}

/**
 * Tarjeta de barbero para la landing pública. Reutiliza ImagePlaceholder
 * cuando no hay foto. Server Component.
 */
export function PublicBarberCard({
  name,
  role,
  bio,
  photoUrl,
}: PublicBarberCardProps) {
  return (
    <div className="group rounded-card border border-border bg-background-secondary overflow-hidden">
      {photoUrl ? (
        <div className="relative aspect-[3/4] overflow-hidden">
          <Image
            src={photoUrl}
            alt={name}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="object-cover transition-transform duration-500 group-hover:scale-105"
            unoptimized
          />
        </div>
      ) : (
        <ImagePlaceholder
          alt={`${name} — foto pendiente`}
          className="aspect-[3/4]"
        />
      )}
      <div className="p-[var(--spacing-card)]">
        <h3 className="text-lg font-display text-foreground">{name}</h3>
        {role && (
          <p className="mt-1 text-label font-sans uppercase tracking-label text-accent">
            {role}
          </p>
        )}
        {bio && (
          <p className="mt-3 text-body font-sans text-muted line-clamp-3">
            {bio}
          </p>
        )}
      </div>
    </div>
  );
}
