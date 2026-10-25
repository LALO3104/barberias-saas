"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isNavItemActive, type NavItem } from "@/lib/dashboard-nav";
import type { MemberRole } from "@/lib/auth";
import { NavIcon } from "./NavIcon";
import { LogoutButton } from "./LogoutButton";
import { InstallAppPrompt } from "./pwa";

interface SidebarProps {
  tenantName: string;
  userName: string | null;
  role: MemberRole;
  navItems: NavItem[];
}

/**
 * Barra lateral de escritorio (desde `lg`). En el teléfono la navegación es
 * MobileNav (cabecera + barra inferior).
 */
export function Sidebar({ tenantName, userName, role, navItems }: SidebarProps) {
  const pathname = usePathname();
  const roleLabel = role === "admin" ? "Administrador" : "Barbero";

  return (
    <aside className="hidden lg:fixed lg:inset-y-0 lg:z-40 lg:flex lg:w-64 lg:flex-col">
      <div className="flex h-full flex-col border-r border-border bg-background-secondary">
        {/* Logo / Tenant */}
        <div className="flex h-16 items-center border-b border-border px-6">
          <Link
            href="/dashboard"
            className="flex items-center gap-3 text-foreground transition-colors hover:text-accent"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-button bg-accent/20 text-accent">
              <span className="text-sm font-display font-bold">
                {tenantName.charAt(0).toUpperCase()}
              </span>
            </div>
            <span className="text-body font-display truncate">{tenantName}</span>
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Principal">
          <ul className="space-y-1">
            {navItems.map((item) => {
              const isActive = isNavItemActive(item, pathname);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`flex items-center gap-3 rounded-button px-3 py-2.5 text-sm font-sans transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      isActive
                        ? "bg-accent/15 text-accent"
                        : "text-muted hover:bg-border/50 hover:text-foreground"
                    }`}
                    aria-current={isActive ? "page" : undefined}
                  >
                    <NavIcon name={item.icon} className="h-5 w-5 shrink-0" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Footer: user info + install + logout */}
        <div className="border-t border-border p-4">
          <div className="mb-3 space-y-1">
            <p className="truncate text-sm font-sans font-medium text-foreground">
              {userName ?? "Usuario"}
            </p>
            <p className="text-label font-sans uppercase tracking-label text-muted">{roleLabel}</p>
          </div>
          <InstallAppPrompt variant="row" />
          <LogoutButton />
        </div>
      </div>
    </aside>
  );
}
