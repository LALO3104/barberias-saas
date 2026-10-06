"use client";

import { useState, useTransition, useCallback } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { BarberForm } from "./BarberForm";
import { toggleBarberStatusAction } from "@/app/(dashboard)/dashboard/barberos/actions";
import { cn } from "@/lib/utils";
import type { Tables } from "@/types/supabase";

type Barber = Tables<"barbers">;

interface BarberManagerProps {
  barbers: Barber[];
}

/**
 * Componente principal del módulo de barberos.
 *
 * Renderiza la lista, maneja dialogs de crear/editar,
 * y la acción de activar/desactivar.
 *
 * Es Client Component porque gestiona estado interactivo.
 * Los datos se obtienen en el Server Component padre (page.tsx).
 */
export function BarberManager({ barbers }: BarberManagerProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editBarber, setEditBarber] = useState<Barber | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleCreateSuccess = useCallback(() => {
    setCreateOpen(false);
    setFormKey((k) => k + 1);
  }, []);

  const handleEditSuccess = useCallback(() => {
    setEditBarber(null);
    setFormKey((k) => k + 1);
  }, []);

  function handleToggle(barber: Barber) {
    setToggleError(null);
    startTransition(async () => {
      const result = await toggleBarberStatusAction(
        barber.id,
        !barber.is_active
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
            Barberos
          </h1>
          <p className="mt-1 text-body font-sans text-muted">
            Gestiona los barberos de tu barbería
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
          Agregar barbero
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
      {barbers.length === 0 ? (
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
                  d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z"
                />
              </svg>
            </div>
            <h2 className="mt-4 text-lg font-display text-foreground">
              Sin barberos registrados
            </h2>
            <p className="mt-2 max-w-sm text-body font-sans text-muted">
              Todavía no has agregado barberos a tu barbería. Comienza
              agregando al primero.
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
              Agregar barbero
            </button>
          </div>
        </div>
      ) : (
        /* ── Lista de barberos ─────────────────────────────────────────── */
        <div className="space-y-3">
          {barbers.map((barber) => (
            <div
              key={barber.id}
              className={cn(
                "flex flex-col gap-4 rounded-card border border-border bg-background-secondary p-[var(--spacing-card)] transition-opacity sm:flex-row sm:items-center",
                !barber.is_active && "opacity-60"
              )}
            >
              {/* Avatar + nombre */}
              <div className="flex items-center gap-4 sm:w-60">
                {barber.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={barber.photo_url}
                    alt={barber.display_name}
                    width={48}
                    height={48}
                    className="h-12 w-12 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent/10 font-display text-lg text-accent">
                    {barber.display_name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="truncate font-display text-foreground">
                    {barber.display_name}
                  </p>
                  {barber.role_title && (
                    <p className="truncate text-sm font-sans text-muted">
                      {barber.role_title}
                    </p>
                  )}
                </div>
              </div>

              {/* Metadatos */}
              <div className="flex flex-1 flex-wrap items-center gap-x-6 gap-y-2 text-sm font-sans">
                {/* Estado */}
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold",
                    barber.is_active
                      ? "bg-green-500/10 text-green-400"
                      : "bg-red-500/10 text-red-400"
                  )}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      barber.is_active ? "bg-green-400" : "bg-red-400"
                    )}
                  />
                  {barber.is_active ? "Activo" : "Inactivo"}
                </span>

                {/* Cuenta vinculada */}
                <span className="text-muted">
                  {barber.user_id ? (
                    <span className="inline-flex items-center gap-1">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={1.5}
                        stroke="currentColor"
                        className="h-3.5 w-3.5 text-accent"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244"
                        />
                      </svg>
                      Cuenta vinculada
                    </span>
                  ) : (
                    "Sin cuenta"
                  )}
                </span>

                {/* Orden */}
                <span className="text-muted">Orden: {barber.sort_order}</span>
              </div>

              {/* Acciones */}
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setFormKey((k) => k + 1);
                    setEditBarber(barber);
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
                  onClick={() => handleToggle(barber)}
                  disabled={isPending}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-button border px-3 py-1.5 text-xs font-sans transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50",
                    barber.is_active
                      ? "border-red-500/30 text-red-400 hover:bg-red-500/10"
                      : "border-green-500/30 text-green-400 hover:bg-green-500/10"
                  )}
                >
                  {barber.is_active ? "Desactivar" : "Activar"}
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
        title="Agregar barbero"
      >
        <BarberForm
          key={`create-${formKey}`}
          onSuccess={handleCreateSuccess}
        />
      </Dialog>

      {/* ── Dialog editar ──────────────────────────────────────────────── */}
      <Dialog
        open={!!editBarber}
        onClose={() => setEditBarber(null)}
        title="Editar barbero"
      >
        {editBarber && (
          <BarberForm
            key={`edit-${editBarber.id}-${formKey}`}
            barber={editBarber}
            onSuccess={handleEditSuccess}
          />
        )}
      </Dialog>
    </div>
  );
}
