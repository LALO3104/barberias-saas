import type { Metadata } from "next";
import { Inter, Playfair_Display } from "next/font/google";
import "./globals.css";

/**
 * Fuentes del sistema visual (ver src/styles/tokens.css → --font-sans /
 * --font-display). Inter cubre body/nav/botones/labels/formularios;
 * Playfair Display es solo para títulos y elementos editoriales.
 */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const playfairDisplay = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Barberías — Base técnica",
  description: "Proyecto SaaS para barberías (en construcción).",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={`${inter.variable} ${playfairDisplay.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
