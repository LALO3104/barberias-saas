import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";

/**
 * Página 404 elegante para cuando un slug no corresponde a una barbería
 * activa. Mantiene la estética Dark Luxury del proyecto.
 */
export default function TenantNotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center">
      <Container className="text-center">
        <p className="text-label font-sans uppercase tracking-label text-muted">
          Error 404
        </p>
        <h1 className="mt-4 text-section font-display text-foreground">
          Barbería no encontrada
        </h1>
        <p className="mx-auto mt-4 max-w-md text-body font-sans text-muted">
          La barbería que buscas no existe o ya no está disponible. Verifica la
          dirección e intenta de nuevo.
        </p>
        <div className="mt-8">
          <Button href="/" variant="secondary" size="lg">
            Ir al inicio
          </Button>
        </div>
      </Container>
    </div>
  );
}
