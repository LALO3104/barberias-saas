import { ImageResponse } from "next/og";

/**
 * Íconos de la app instalable "Mi barbería" (solo personal).
 *
 *   /pwa/icon/192       ícono normal 192×192
 *   /pwa/icon/512       ícono normal 512×512
 *   /pwa/icon/maskable  512×512 con margen de seguridad (Android recorta en círculo)
 *   /pwa/icon/apple     180×180 para la pantalla de inicio del iPhone
 *
 * Colores = tokens de src/styles/tokens.css (--color-background, --color-accent):
 * ImageResponse no lee variables CSS, por eso van como valores.
 */

const BACKGROUND = "#0b0b0b";
const ACCENT = "#c6a15b";

const VARIANTS = {
  "192": { size: 192, padding: 0.18 },
  "512": { size: 512, padding: 0.18 },
  maskable: { size: 512, padding: 0.3 },
  apple: { size: 180, padding: 0.18 },
} as const;

type Variant = keyof typeof VARIANTS;

export const dynamic = "force-static";

export function generateStaticParams() {
  return Object.keys(VARIANTS).map((size) => ({ size }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ size: string }> }
) {
  const { size: key } = await params;
  if (!(key in VARIANTS)) {
    return new Response("Not found", { status: 404 });
  }

  const { size, padding } = VARIANTS[key as Variant];
  const glyph = Math.round(size * (1 - padding * 2));

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: BACKGROUND,
        }}
      >
        {/* Tijeras (mismo trazo que el ícono "scissors" del dashboard). */}
        <svg
          width={glyph}
          height={glyph}
          viewBox="0 0 24 24"
          fill="none"
          stroke={ACCENT}
          strokeWidth={1.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="6" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M20 4 8.12 15.88" />
          <path d="M14.47 14.48 20 20" />
          <path d="M8.12 8.12 12 12" />
        </svg>
      </div>
    ),
    { width: size, height: size }
  );
}
