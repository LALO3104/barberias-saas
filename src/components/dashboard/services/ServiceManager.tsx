"use client";

import { useState, useTransition, useCallback } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { ServiceForm } from "./ServiceForm";
import { toggleServiceStatusAction } from "@/app/(dashboard)/dashboard/servicios/actions";
import { formatPrice, formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Tables } from "@/types/supabase";

type Service = Tables<"services">;

interface ServiceManagerProps {
  services: Service[];
  currency: string;
}

/**
 * Componente principal del módulo de servicios.
 *
 * Renderiza la lista, maneja dialogs de crear/editar,
 * y la acción de activar/desactivar.
 *
 * Es Client Component porque gestiona estado interactivo.
 * Los datos se obtienen en el Server Component padre (page.tsx).
 */
export function ServiceManager({ services, currency }: ServiceManagerProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editService, setEditService] = useState<Service | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleCreateSuccess = useCallback(() => {
    setCreateOpen(false);
    setFormKey((k) => k + 1);
  }, []);

  const handleEditSuccess = useCallback(() => {
    setEditService(null);
    setFormKey((k) => k + 1);
  }, []);

  function handleToggle(service: Service) {
    setToggleError(null);
    startTransition(async () => {
      const result = await toggleServiceStatusAction(
        service.id,
        !service.is_active
      );
      if (result.error) {
        setToggleError(result.error);
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-section font-display text-foreground">
            Servicios
          </h1>
          <p className="mt-1 text-body font-sans text-muted">
            Gestiona los servicios que ofrece tu barbería
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setFormKey((k) => k + 1);
            setCreateOpen(true);
          }}
          className="inline-flex items-center justify-center gap-2 rounded-button bg-accent px-5 py-2.5 text-sm font-sans font-semibold text-background transition-all hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            className="h-4 w-4"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 4.5v15m7.5-7.5h-15"
            />
          </svg>
          Agregar servicio
        </button>
      </div>

      {/* ── Error de toggle ────────────────────────────────────────────── */}
      {toggleError && (
        <div className="rounded-button border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-sans text-red-400 flex items-center justify-between">
          <span>{toggleError}</span>
          <button
            type="button"
            onClick={() => setToggleError(null)}
            className="ml-3 shrink-0 text-red-300 transition-colors hover:text-red-200"
            aria-label="Cerrar error"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="h-4 w-4"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18 18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      )}

      {/* ── Estado vacío ───────────────────────────────────────────────── */}
      {services.length === 0 ? (
        <div className="rounded-card border border-border bg-background-secondary p-[var(--spacing-card)]">
          <div className="flex min-h-[250px] flex-col items-center justify-center text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-border bg-background">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="h-8 w-8 text-muted"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9.53 16.122a3 3 0 0 0-5.78 1.128 2.25 2.25 0 0 1-2.4 2.245 4.5 4.5 0 0 0 8.4-2.245c0-.399-.078-.78-.22-1.128Zm0 0a15.998 15.998 0 0 0 3.388-1.62m-5.043-.025a15.994 15.994 0 0 1 1.622-3.395m3.42 3.42a15.995 15.995 0 0 0 4.764-4.648l3.876-5.814a1.151 1.151 0 0 0-1.597-1.597L14.146 6.32a15.996 15.996 0 0 0-4.649 4.763m3.42 3.42a6.776 6.776 0 0 0-3.42-3.42"
                />
              </svg>
            </div>
            <h2 className="mt-4 text-lg font-display text-foreground">
              Sin servicios registrados
            </h2>
            <p className="mt-2 max-w-sm text-body font-sans text-muted">
              Todavía no has agregado servicios a tu barbería. Comienza
              agregando el primero.
            </p>
            <button
              type="button"
              onClick={() => {
                setFormKey((k) => k + 1);
                setCreateOpen(true);
              }}
              className="mt-6 inline-flex items-center justify-center gap-2 rounded-button bg-accent px-6 py-3 text-body font-sans font-semibold text-background transition-all hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                className="h-4 w-4"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 4.5v15m7.5-7.5h-15"
                />
              </svg>
              Agregar servicio
            </button>
          </div>
        </div>
      ) : (
        /* ── Lista de servicios ────────────────────────────────────────── */
        <div className="space-y-3">
          {services.map((service) => (
            <div
              key={service.id}
              className={cn(
                "flex flex-col gap-4 rounded-card border border-border bg-background-secondary p-[var(--spacing-card)] transition-opacity sm:flex-row sm:items-center",
                !service.is_active && "opacity-60"
              )}
            >
              {/* Nombre + descripción */}
              <div className="min-w-0 sm:w-60">
                <p className="truncate font-display text-foreground">
                  {service.name}
                </p>
                {service.description && (
                  <p className="truncate text-sm font-sans text-muted">
                    {service.description}
                  </p>
                )}
              </div>

              {/* Metadatos */}
              <div className="flex flex-1 flex-wrap items-center gap-x-6 gap-y-2 text-sm font-sans">
                {/* Precio */}
                <span className="font-sans text-foreground">
                  {formatPrice(service.price_cents, currency)}
                </span>

                {/* Duración */}
                <span className="text-muted">
                  {formatDuration(service.duration_minutes)}
                </span>

                {/* Estado */}
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold",
                    service.is_active
                      ? "bg-green-500/10 text-green-400"
                      : "bg-red-500/10 text-red-400"
                  )}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      service.is_active ? "bg-green-400" : "bg-red-400"
                    )}
                  />
                  {service.is_active ? "Activo" : "Inactivo"}
                </span>

                {/* Orden */}
                <span className="text-muted">Orden: {service.sort_order}</span>
              </div>

              {/* Acciones */}
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setFormKey((k) => k + 1);
                    setEditService(service);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-button border border-border px-3 py-1.5 text-xs font-sans text-foreground transition-colors hover:bg-border/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                    className="h-3.5 w-3.5"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10"
                    />
                  </svg>
                  Editar
                </button>
                <button
                  type="button"
                  onClick={() => handleToggle(service)}
                  disabled={isPending}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-button border px-3 py-1.5 text-xs font-sans transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50",
                    service.is_active
                      ? "border-red-500/30 text-red-400 hover:bg-red-500/10"
                      : "border-green-500/30 text-green-400 hover:bg-green-500/10"
                  )}
                >
                  {service.is_active ? "Desactivar" : "Activar"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Dialog crear ───────────────────────────────────────────────── */}
      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Agregar servicio"
      >
        <ServiceForm
          key={`create-${formKey}`}
          currency={currency}
          onSuccess={handleCreateSuccess}
        />
      </Dialog>

      {/* ── Dialog editar ──────────────────────────────────────────────── */}
      <Dialog
        open={!!editService}
        onClose={() => setEditService(null)}
        title="Editar servicio"
      >
        {editService && (
          <ServiceForm
            key={`edit-${editService.id}-${formKey}`}
            service={editService}
            currency={currency}
            onSuccess={handleEditSuccess}
          />
        )}
      </Dialog>
    </div>
  );
}
