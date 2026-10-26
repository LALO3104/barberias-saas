/**
 * Configuración de navegación del dashboard según rol.
 *
 * Teléfono: los ítems `primary` van en la barra inferior (al alcance del
 * pulgar) y el resto en la pestaña "Más". Escritorio: todos en la barra lateral.
 *
 * Solo se listan pantallas que existen. Clientes, Estadísticas y
 * Configuración se agregarán cuando se construyan sus Steps (antes daban 404).
 */

import type { MemberRole } from "@/lib/auth";

export interface NavItem {
  label: string;
  /** Texto corto para la barra inferior del teléfono. */
  shortLabel?: string;
  href: string;
  /** Nombre del icono SVG (heroicons outline) */
  icon: string;
  /** Va en la barra inferior del teléfono (máximo 3; la cuarta es "Más"). */
  primary?: boolean;
}

const ADMIN_NAV: NavItem[] = [
  { label: "Inicio", href: "/dashboard", icon: "home", primary: true },
  { label: "Citas", href: "/dashboard/citas", icon: "calendar", primary: true },
  { label: "Horarios", href: "/dashboard/horarios", icon: "clock", primary: true },
  { label: "Barberos", href: "/dashboard/barberos", icon: "scissors" },
  { label: "Servicios", href: "/dashboard/servicios", icon: "sparkles" },
  { label: "Ganancias", href: "/dashboard/ganancias", icon: "chart" },
];

// "Mi agenda" usa la misma ruta que "Citas" del admin: la página filtra por rol
// (el barbero solo ve sus citas).
const BARBER_NAV: NavItem[] = [
  { label: "Inicio", href: "/dashboard", icon: "home", primary: true },
  { label: "Mi agenda", shortLabel: "Agenda", href: "/dashboard/citas", icon: "calendar", primary: true },
  { label: "Mi horario", shortLabel: "Horario", href: "/dashboard/horarios", icon: "clock", primary: true },
  { label: "Mis ganancias", href: "/dashboard/ganancias", icon: "chart" },
];

export function getNavForRole(role: MemberRole): NavItem[] {
  return role === "admin" ? ADMIN_NAV : BARBER_NAV;
}

/** ¿El ítem corresponde a la ruta actual? (Inicio solo en coincidencia exacta.) */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  return item.href === "/dashboard"
    ? pathname === "/dashboard"
    : pathname === item.href || pathname.startsWith(`${item.href}/`);
}
