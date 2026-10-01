"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import type { CtaLink, NavLink } from "@/types/content";

interface NavbarProps {
  tenantName: string;
  links: NavLink[];
  cta: CtaLink;
}

/**
 * Navbar genérico del sistema — recibe todo por props, no sabe qué
 * barbería se muestra. Sin animación de entrada a propósito: es chrome de
 * UI persistente, no contenido editorial que deba "revelarse".
 */
export function Navbar({ tenantName, links, cta }: NavbarProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    if (!isMenuOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsMenuOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isMenuOpen]);

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur">
      <Container className="flex h-16 items-center justify-between sm:h-20">
        <a href="#" className="text-lg font-display text-foreground">
          {tenantName}
        </a>

        <nav aria-label="Principal" className="hidden items-center gap-8 md:flex">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-label font-sans uppercase tracking-label text-muted transition-colors hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="hidden md:block">
          <Button href={cta.href} size="sm">
            {cta.label}
          </Button>
        </div>

        <button
          type="button"
          className="inline-flex h-11 w-11 items-center justify-center rounded-button text-foreground md:hidden"
          aria-expanded={isMenuOpen}
          aria-controls="mobile-menu"
          aria-label={isMenuOpen ? "Cerrar menú" : "Abrir menú"}
          onClick={() => setIsMenuOpen((open) => !open)}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
            className="text-foreground"
          >
            {isMenuOpen ? (
              <path
                d="M4 4l12 12M16 4L4 16"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            ) : (
              <path
                d="M3 5h14M3 10h14M3 15h14"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            )}
          </svg>
        </button>
      </Container>

      {isMenuOpen && (
        <nav
          id="mobile-menu"
          aria-label="Principal (móvil)"
          className="border-t border-border md:hidden"
        >
          <Container className="flex flex-col gap-1 py-[var(--spacing-gutter)]">
            {links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setIsMenuOpen(false)}
                className="py-2 text-label font-sans uppercase tracking-label text-muted transition-colors hover:text-foreground"
              >
                {link.label}
              </a>
            ))}
            <Button href={cta.href} size="md" className="mt-3 w-full">
              {cta.label}
            </Button>
          </Container>
        </nav>
      )}
    </header>
  );
}
