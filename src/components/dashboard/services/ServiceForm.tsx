"use client";

import { useActionState, useEffect } from "react";
import {
  createServiceAction,
  updateServiceAction,
  type ServiceActionState,
} from "@/app/(dashboard)/dashboard/servicios/actions";
import type { Tables } from "@/types/supabase";

type Service = Tables<"services">;

interface ServiceFormProps {
  service?: Service;
  currency: string;
  onSuccess?: () => void;
}

const INPUT_CLASS =
  "block w-full rounded-button border border-border bg-background px-4 py-3 text-body font-sans text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50";

const LABEL_CLASS = "block text-sm font-sans text-muted mb-1.5";

const initialState: ServiceActionState = {};

/**
 * Formulario para crear o editar un servicio.
 * Usa useActionState (React 19) y Server Actions.
 *
 * El precio se captura en pesos (unidad legible para el usuario) y se
 * convierte a centavos server-side en la Server Action, que es donde
 * vive la columna real `price_cents`.
 */
export function ServiceForm({ service, currency, onSuccess }: ServiceFormProps) {
  const isEdit = !!service;
  const action = isEdit ? updateServiceAction : createServiceAction;
  const [state, formAction, isPending] = useActionState(action, initialState);

  useEffect(() => {
    if (state.success) {
      onSuccess?.();
    }
  }, [state.success, onSuccess]);

  const defaultPrice = service ? (service.price_cents / 100).toFixed(2) : "";

  return (
    <form action={formAction} className="space-y-5">
      {isEdit && <input type="hidden" name="service_id" value={service.id} />}

      {/* Error global */}
      {state.error && (
        <div className="rounded-button border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-sans text-red-400">
          {state.error}
        </div>
      )}

      {/* Nombre */}
      <div>
        <label htmlFor="name" className={LABEL_CLASS}>
          Nombre <span className="text-accent">*</span>
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          defaultValue={service?.name ?? ""}
          placeholder="Ej: Corte clásico"
          className={INPUT_CLASS}
          disabled={isPending}
        />
      </div>

      {/* Descripción */}
      <div>
        <label htmlFor="description" className={LABEL_CLASS}>
          Descripción
        </label>
        <textarea
          id="description"
          name="description"
          rows={3}
          defaultValue={service?.description ?? ""}
          placeholder="Breve descripción del servicio…"
          className={INPUT_CLASS + " resize-none"}
          disabled={isPending}
        />
      </div>

      {/* Precio + Duración */}
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="price" className={LABEL_CLASS}>
            Precio ({currency}) <span className="text-accent">*</span>
          </label>
          <input
            id="price"
            name="price"
            type="text"
            inputMode="decimal"
            required
            defaultValue={defaultPrice}
            placeholder="0.00"
            className={INPUT_CLASS}
            disabled={isPending}
          />
        </div>

        <div>
          <label htmlFor="duration_minutes" className={LABEL_CLASS}>
            Duración (minutos) <span className="text-accent">*</span>
          </label>
          <input
            id="duration_minutes"
            name="duration_minutes"
            type="number"
            min={1}
            step={1}
            required
            defaultValue={service?.duration_minutes ?? ""}
            placeholder="Ej: 30"
            className={INPUT_CLASS}
            disabled={isPending}
          />
        </div>
      </div>

      {/* Orden + Estado */}
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="sort_order" className={LABEL_CLASS}>
            Orden
          </label>
          <input
            id="sort_order"
            name="sort_order"
            type="number"
            min={0}
            step={1}
            defaultValue={service?.sort_order ?? 0}
            className={INPUT_CLASS}
            disabled={isPending}
          />
        </div>

        <div>
          <label htmlFor="is_active" className={LABEL_CLASS}>
            Estado
          </label>
          <select
            id="is_active"
            name="is_active"
            defaultValue={service?.is_active !== false ? "true" : "false"}
            className={INPUT_CLASS}
            disabled={isPending}
          >
            <option value="true">Activo</option>
            <option value="false">Inactivo</option>
          </select>
        </div>
      </div>

      {/* Submit */}
      <div className="flex justify-end pt-2">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center justify-center rounded-button bg-accent px-6 py-3 text-body font-sans font-semibold text-background transition-all hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50"
        >
          {isPending
            ? isEdit
              ? "Guardando…"
              : "Creando…"
            : isEdit
              ? "Guardar cambios"
              : "Crear servicio"}
        </button>
      </div>
    </form>
  );
}
