"use client";

import { useEffect, useCallback, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
}

/**
 * Diálogo modal reutilizable.
 *
 * Teléfono: panel que sube desde abajo (bottom sheet) hasta 94dvh, con
 * margen para la barra de inicio del iPhone. Desde `sm`: ventana centrada.
 * Entra con @starting-style (sin JS de animación); con
 * prefers-reduced-motion la transición queda anulada por globals.css.
 *
 * Se cierra con Escape, clic en backdrop, o el botón de cierre.
 * Bloquea scroll del body mientras está abierto.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  className,
}: DialogProps) {
  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (open) {
      document.addEventListener("keydown", handleEscape);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [open, handleEscape]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-200 ease-out starting:opacity-0"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "relative w-full max-h-[94dvh] overflow-y-auto overscroll-contain rounded-t-card border border-b-0 border-border bg-background-secondary pb-[env(safe-area-inset-bottom)] shadow-card",
          "transition-[transform,opacity] duration-300 ease-out starting:translate-y-full",
          "sm:max-h-[90dvh] sm:max-w-lg sm:rounded-card sm:border-b sm:pb-0 sm:starting:translate-y-2 sm:starting:opacity-0",
          className
        )}
      >
        {/* Asa del panel (solo teléfono, decorativa) */}
        <div aria-hidden="true" className="flex justify-center pt-2.5 sm:hidden">
          <span className="h-1 w-10 rounded-full bg-border" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4 sm:px-6">
          <h2 className="text-lg font-display text-foreground">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full text-muted transition-[background-color,color,transform] duration-150 ease-out hover:bg-border/50 hover:text-foreground active:scale-[0.94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label="Cerrar"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="h-5 w-5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18 18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="px-5 py-5 sm:px-6">{children}</div>
      </div>
    </div>
  );
}
