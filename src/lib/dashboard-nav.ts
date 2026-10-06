/**
 * Configuración de navegación del dashboard según rol.
 *
 * Los ítems son placeholders para Steps futuros.
 * La funcionalidad de cada sección se implementará después.
 */

import type { MemberRole } from "@/lib/auth";

export interface NavItem {
  label: string;
  href: string;
  /** Nombre del icono SVG (heroicons outline) */
  icon: string;
}

const ADMIN_NAV: NavItem[] = [
  { label: "Inicio", href: "/dashboard", icon: "home" },
  { label: "Citas", href: "/dashboard/citas", icon: "calendar" },
  { label: "Clientes", href: "/dashboard/clientes", icon: "users" },
  { label: "Barberos", href: "/dashboard/barberos", icon: "scissors" },
  { label: "Servicios", href: "/dashboard/servicios", icon: "sparkles" },
  { label: "Horarios", href: "/dashboard/horarios", icon: "clock" },
  { label: "Estadísticas", href: "/dashboard/estadisticas", icon: "chart" },
  { label: "Configuración", href: "/dashboard/configuracion", icon: "cog" },
];

const BARBER_NAV: NavItem[] = [
  { label: "Inicio", href: "/dashboard", icon: "home" },
  { label: "Mis citas", href: "/dashboard/mis-citas", icon: "calendar" },
  { label: "Mi horario", href: "/dashboard/horarios", icon: "clock" },
  { label: "Mi agenda", href: "/dashboard/mi-agenda", icon: "clock" },
];

export function getNavForRole(role: MemberRole): NavItem[] {
  return role === "admin" ? ADMIN_NAV : BARBER_NAV;
}
