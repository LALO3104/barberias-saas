import { Card } from "@/components/ui/Card";
import type { Service } from "@/types/content";

interface ServiceCardProps {
  service: Service;
}

/**
 * Tarjeta de un servicio. Puramente presentacional — no importa
 * `data/tenants/kings.ts`, recibe el servicio ya resuelto por props.
 */
export function ServiceCard({ service }: ServiceCardProps) {
  return (
    <Card className="flex h-full flex-col">
      <h3 className="text-lg font-display text-foreground">{service.name}</h3>
      <p className="mt-2 flex-1 text-body font-sans text-muted">
        {service.description}
      </p>
      <div className="mt-4 flex items-center justify-between border-t border-border pt-4 text-label font-sans uppercase tracking-label">
        <span className="text-muted">{service.duration}</span>
        <span className="text-accent">{service.price}</span>
      </div>
    </Card>
  );
}
