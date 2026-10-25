import type { Metadata, Viewport } from "next";
import { PwaRegistrar } from "@/components/dashboard/pwa";

/**
 * Pantallas de acceso del personal: también permiten instalar "Mi barbería"
 * (como el inicio de sesión de Fishmar). Las páginas públicas no lo hacen.
 */
export const metadata: Metadata = {
  manifest: "/manifest.webmanifest",
  applicationName: "Mi barbería",
  appleWebApp: {
    capable: true,
    title: "Mi barbería",
    statusBarStyle: "black",
  },
  icons: { apple: "/pwa/icon/apple" },
};

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: "#0b0b0b",
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PwaRegistrar />
      {children}
    </>
  );
}
