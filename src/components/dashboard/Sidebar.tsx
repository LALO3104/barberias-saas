"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavItem } from "@/lib/dashboard-nav";
import type { MemberRole } from "@/lib/auth";
import { NavIcon } from "./NavIcon";
import { LogoutButton } from "./LogoutButton";

interface SidebarProps {
  tenantName: string;
  userName: string | null;
  role: MemberRole;
  navItems: NavItem[];
}

export function Sidebar({ tenantName, userName, role, navItems }: SidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  const roleLabel = role === "admin" ? "Administrador" : "Barbero";

  return (
    <>
      {/* Mobile header bar */}
      <div className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-border bg-background-secondary px-4 lg:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="rounded-button p-2 text-muted transition-colors hover:bg-border/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-label="Abrir menú"
        >
          <NavIcon name="menu" className="h-5 w-5" />
        </button>
        <span className="text-body font-display text-foreground truncate">
          {tenantName}
        </span>
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-50 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Menú de navegación"
        >
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/60"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />

          {/* Drawer */}
          <div className="fixed inset-y-0 left-0 flex w-72 flex-col bg-background-secondary shadow-xl">
            <div className="flex h-14 items-center justify-between border-b border-border px-4">
              <span className="text-body font-display text-foreground">
                {tenantName}
              </span>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="rounded-button p-2 text-muted transition-colors hover:bg-border/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                aria-label="Cerrar menú"
              >
                <NavIcon name="close" className="h-5 w-5" />
              </button>
            </div>

            <SidebarContent
              navItems={navItems}
              pathname={pathname}
              userName={userName}
              roleLabel={roleLabel}
              onLinkClick={() => setMobileOpen(false)}
            />
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
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
              <span className="text-body font-display truncate">
                {tenantName}
              </span>
            </Link>
          </div>

          <SidebarContent
            navItems={navItems}
            pathname={pathname}
            userName={userName}
            roleLabel={roleLabel}
          />
        </div>
      </aside>
    </>
  );
}

// ─── Contenido reutilizado desktop/mobile ──────────────────────────────────

interface SidebarContentProps {
  navItems: NavItem[];
  pathname: string;
  userName: string | null;
  roleLabel: string;
  onLinkClick?: () => void;
}

function SidebarContent({
  navItems,
  pathname,
  userName,
  roleLabel,
  onLinkClick,
}: SidebarContentProps) {
  return (
    <>
      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Principal">
        <ul className="space-y-1">
          {navItems.map((item) => {
            const isActive =
              item.href === "/dashboard"
                ? pathname === "/dashboard"
                : pathname.startsWith(item.href);

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onLinkClick}
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

      {/* Footer: user info + logout */}
      <div className="border-t border-border p-4">
        <div className="mb-3 space-y-1">
          <p className="truncate text-sm font-sans font-medium text-foreground">
            {userName ?? "Usuario"}
          </p>
          <p className="text-label font-sans uppercase tracking-label text-muted">
            {roleLabel}
          </p>
        </div>
        <LogoutButton />
      </div>
    </>
  );
}
