import { Reveal } from "@/components/animations/Reveal";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";

/**
 * Página raíz temporal: NO es el sitio de ninguna barbería.
 *
 * Sirve como comprobante visual de que la base técnica quedó bien armada:
 * si ves el texto de abajo aparecer con un fade + slide, Next.js, Tailwind
 * y GSAP (con @gsap/react y el registro de plugins) están funcionando de
 * punta a punta, incluyendo la hidratación en el cliente.
 *
 * Se reemplaza por el sitio público real cuando empiece esa etapa.
 */
export default function Home() {
  return (
    <main className="flex flex-1 items-center">
      <Container className="py-24">
        <Reveal>
          <p className="mb-3 text-sm font-medium tracking-wide text-foreground/60 uppercase">
            Barberías · Base técnica
          </p>
          <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
            Proyecto inicializado correctamente
          </h1>
          <p className="mt-4 max-w-xl text-lg text-foreground/70">
            Next.js, TypeScript, Tailwind CSS y GSAP están listos. Este
            bloque de texto entra con una animación (fade + slide) generada
            por GSAP a través de un componente reutilizable
            (<code className="rounded bg-foreground/10 px-1.5 py-0.5 font-mono text-[0.9em]">Reveal</code>).
            Si tu sistema tiene activado &quot;reducir movimiento&quot;, el
            texto aparece directo, sin animar — a propósito.
          </p>
        </Reveal>
        <Reveal delay={0.15} className="mt-8">
          <Button>Botón reutilizable de ejemplo</Button>
        </Reveal>
      </Container>
    </main>
  );
}
