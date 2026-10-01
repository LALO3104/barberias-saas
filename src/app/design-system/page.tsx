import type { Metadata } from "next";
import { Reveal } from "@/components/animations/Reveal";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";

export const metadata: Metadata = {
  title: "Barbería Kings — Design System Preview",
};

const colorTokens = [
  { name: "Background", variable: "--color-background" },
  { name: "Background 2", variable: "--color-background-secondary" },
  { name: "Foreground", variable: "--color-foreground" },
  { name: "Muted", variable: "--color-muted" },
  { name: "Accent", variable: "--color-accent" },
  { name: "Border", variable: "--color-border" },
] as const;

const spacingTokens = [
  { name: "Gutter", variable: "--spacing-gutter" },
  { name: "Card", variable: "--spacing-card" },
  { name: "Container", variable: "--spacing-container" },
  { name: "Section", variable: "--spacing-section" },
] as const;

/**
 * ⚠️ PÁGINA TEMPORAL — "Design System Preview".
 *
 * Esto NO es el sitio de Barbería Kings. Es solo una vista de
 * comprobación del sistema visual base (color, tipografía, espaciado,
 * botones, superficies) construido en este paso. Se reemplaza por el
 * Hero y las secciones reales en el siguiente paso.
 *
 * No hay datos dinámicos, ScrollTrigger, SplitText ni imágenes reales
 * aquí a propósito — eso llega después, componente por componente.
 */
export default function Home() {
  return (
    <main className="flex-1">
      <Container className="py-[var(--spacing-section)]">
        {/* Encabezado */}
        <Reveal>
          <p className="text-label font-sans uppercase tracking-label text-muted">
            Barbería Kings
          </p>
          <h1 className="mt-3 text-hero font-display text-foreground">
            Design System
          </h1>
          <p className="mt-4 max-w-xl text-body font-sans text-muted">
            Vista previa temporal del sistema visual base: color,
            tipografía, espaciado, botones y superficies. Todavía no es la
            página de la barbería.
          </p>
        </Reveal>

        <hr className="my-16 border-border" />

        {/* Color */}
        <section>
          <h2 className="text-section font-display text-foreground">
            Color
          </h2>
          <div className="mt-6 grid grid-cols-2 gap-[var(--spacing-gutter)] sm:grid-cols-3 lg:grid-cols-6">
            {colorTokens.map((token) => (
              <div key={token.name} className="space-y-2">
                <div
                  className="h-16 rounded-card border border-border"
                  style={{ background: `var(${token.variable})` }}
                />
                <p className="text-label font-sans uppercase tracking-label text-muted">
                  {token.name}
                </p>
              </div>
            ))}
          </div>
        </section>

        <hr className="my-16 border-border" />

        {/* Tipografía */}
        <section>
          <h2 className="text-section font-display text-foreground">
            Tipografía
          </h2>
          <div className="mt-6 space-y-4">
            <p className="text-label font-sans uppercase tracking-label text-muted">
              Label uppercase — Inter
            </p>
            <p className="text-body font-sans text-foreground">
              Body — Inter. Limpio y muy legible para párrafos, formularios
              y contenido secundario.
            </p>
            <p className="text-section font-display text-foreground">
              Section title — Playfair Display
            </p>
          </div>
        </section>

        <hr className="my-16 border-border" />

        {/* Botones */}
        <section>
          <h2 className="text-section font-display text-foreground">
            Botones
          </h2>
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <Button size="sm">Small</Button>
            <Button size="md">Medium</Button>
            <Button size="lg">Large</Button>
          </div>
        </section>

        <hr className="my-16 border-border" />

        {/* Superficie / Card */}
        <section>
          <h2 className="text-section font-display text-foreground">
            Superficie
          </h2>
          <Card className="mt-6 max-w-sm">
            <p className="text-label font-sans uppercase tracking-label text-muted">
              Ejemplo
            </p>
            <p className="mt-2 text-body font-sans text-foreground">
              Esta tarjeta usa los tokens de borde, radio y sombra del
              sistema — nada hardcodeado por componente.
            </p>
          </Card>
        </section>

        <hr className="my-16 border-border" />

        {/* Espaciado */}
        <section>
          <h2 className="text-section font-display text-foreground">
            Espaciado
          </h2>
          <p className="mt-2 text-body font-sans text-muted">
            Cada barra mide el valor real del token en tu viewport actual —
            redimensiona la ventana para ver cómo escalan.
          </p>
          <div className="mt-6 space-y-4">
            {spacingTokens.map((token) => (
              <div key={token.name} className="flex items-center gap-4">
                <span className="w-28 shrink-0 text-label font-sans uppercase tracking-label text-muted">
                  {token.name}
                </span>
                <div
                  className="h-3 rounded-full bg-accent/60"
                  style={{ width: `var(${token.variable})` }}
                />
              </div>
            ))}
          </div>
        </section>
      </Container>
    </main>
  );
}
