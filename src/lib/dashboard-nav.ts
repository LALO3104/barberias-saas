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

// "Mi agenda" usa la misma ruta que "Citas" del admin: la página filtra por rol
// (el barbero solo ve sus citas). Reemplaza a los antiguos "Mis citas" y
// "Mi agenda", que apuntaban a rutas inexistentes.
const BARBER_NAV: NavItem[] = [
  { label: "Inicio", href: "/dashboard", icon: "home" },
  { label: "Mi agenda", href: "/dashboard/citas", icon: "calendar" },
  { label: "Mi horario", href: "/dashboard/horarios", icon: "clock" },
];

export function getNavForRole(role: MemberRole): NavItem[] {
  return role === "admin" ? ADMIN_NAV : BARBER_NAV;
}
