"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Dialog } from "@/components/ui/Dialog";
import { cn } from "@/lib/utils";
import { isNavItemActive, type NavItem } from "@/lib/dashboard-nav";
import type { MemberRole } from "@/lib/auth";
import { NavIcon } from "./NavIcon";
import { LogoutButton } from "./LogoutButton";
import { InstallAppPrompt } from "./pwa";

interface MobileNavProps {
  tenantName: string;
  userName: string | null;
  role: MemberRole;
  navItems: NavItem[];
}

/**
 * Navegación del teléfono (oculta desde `lg`), estilo app:
 *   - cabecera compacta con el nombre de la barbería (respeta el notch);
 *   - barra inferior fija al alcance del pulgar: ítems `primary` + "Más";
 *   - "Más" abre un panel desde abajo con el resto, instalar y cerrar sesión.
 *
 * El contenido del layout reserva espacio para la barra
 * (`pb-[calc(4.5rem+env(safe-area-inset-bottom))]`).
 */
export function MobileNav({ tenantName, userName, role, navItems }: MobileNavProps) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  const primary = navItems.filter((i) => i.primary).slice(0, 3);
  const secondary = navItems.filter((i) => !primary.includes(i));
  const moreActive = secondary.some((i) => isNavItemActive(i, pathname));
  const roleLabel = role === "admin" ? "Administrador" : "Barbero";

  return (
    <>
      {/* Cabecera */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 pt-[env(safe-area-inset-top)] backdrop-blur-md lg:hidden">
        <div className="flex h-14 items-center gap-3 px-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-button bg-accent/20 text-accent">
            <span className="text-sm font-display font-bold">{tenantName.charAt(0).toUpperCase()}</span>
          </div>
          <span className="min-w-0 truncate text-body font-display text-foreground">{tenantName}</span>
        </div>
      </header>

      {/* Barra inferior */}
      <nav
        aria-label="Principal"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
      >
        <ul className="mx-auto grid h-[4.5rem] max-w-lg grid-cols-4 px-2">
          {primary.map((item) => {
            const active = isNavItemActive(item, pathname);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={tabClass(active)}
                >
                  <TabIcon name={item.icon} active={active} />
                  <span className="truncate">{item.shortLabel ?? item.label}</span>
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              className={tabClass(moreActive || moreOpen)}
            >
              <TabIcon name="menu" active={moreActive || moreOpen} />
              <span>Más</span>
            </button>
          </li>
        </ul>
      </nav>

      {/* Panel "Más" */}
      <Dialog open={moreOpen} onClose={() => setMoreOpen(false)} title="Más">
        <div className="-mx-2 space-y-1">
          {secondary.map((item) => {
            const active = isNavItemActive(item, pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMoreOpen(false)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-button px-3 py-3 text-body font-sans transition-[background-color,color] duration-150 ease-out",
                  active ? "bg-accent/15 text-accent" : "text-foreground hover:bg-border/50 active:bg-border/60"
                )}
              >
                <NavIcon name={item.icon} className="h-5 w-5 shrink-0" />
                {item.label}
              </Link>
            );
          })}
          <InstallAppPrompt variant="row" />
        </div>

        <div className="mt-4 border-t border-border pt-4">
          <p className="truncate text-sm font-sans font-medium text-foreground">{userName ?? "Usuario"}</p>
          <p className="mb-3 text-label font-sans uppercase tracking-label text-muted">{roleLabel}</p>
          <div className="-mx-3">
            <LogoutButton />
          </div>
        </div>
      </Dialog>
    </>
  );
}

function tabClass(active: boolean) {
  return cn(
    "flex h-full w-full flex-col items-center justify-center gap-1 rounded-button text-[0.6875rem] font-sans font-medium",
    "transition-[color,transform] duration-150 ease-out active:scale-[0.94]",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
    active ? "text-accent" : "text-muted"
  );
}

function TabIcon({ name, active }: { name: string; active: boolean }) {
  return (
    <span
      className={cn(
        "flex h-7 w-12 items-center justify-center rounded-full transition-colors duration-150 ease-out",
        active && "bg-accent/15"
      )}
    >
      <NavIcon name={name} className="h-[1.375rem] w-[1.375rem]" />
    </span>
  );
}
