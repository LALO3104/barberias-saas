"use client";

import { useActionState, useEffect } from "react";
import {
  createBarberAction,
  updateBarberAction,
  type BarberActionState,
} from "@/app/(dashboard)/dashboard/barberos/actions";
import type { Tables } from "@/types/supabase";

type Barber = Tables<"barbers">;

interface BarberFormProps {
  barber?: Barber;
  onSuccess?: () => void;
}

const INPUT_CLASS =
  "block w-full rounded-button border border-border bg-background px-4 py-3 text-body font-sans text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50";

const LABEL_CLASS = "block text-sm font-sans text-muted mb-1.5";

const initialState: BarberActionState = {};

/**
 * Formulario para crear o editar un barbero.
 * Usa useActionState (React 19) y Server Actions.
 */
export function BarberForm({ barber, onSuccess }: BarberFormProps) {
  const isEdit = !!barber;
  const action = isEdit ? updateBarberAction : createBarberAction;
  const [state, formAction, isPending] = useActionState(action, initialState);

  useEffect(() => {
    if (state.success) {
      onSuccess?.();
    }
  }, [state.success, onSuccess]);

  return (
    <form action={formAction} className="space-y-5">
      {isEdit && <input type="hidden" name="barber_id" value={barber.id} />}

      {/* Error global */}
      {state.error && (
        <div className="rounded-button border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-sans text-red-400">
          {state.error}
        </div>
      )}

      {/* Nombre */}
      <div>
        <label htmlFor="display_name" className={LABEL_CLASS}>
          Nombre <span className="text-accent">*</span>
        </label>
        <input
          id="display_name"
          name="display_name"
          type="text"
          required
          defaultValue={barber?.display_name ?? ""}
          placeholder="Nombre del barbero"
          className={INPUT_CLASS}
          disabled={isPending}
        />
      </div>

      {/* Título / Especialidad */}
      <div>
        <label htmlFor="role_title" className={LABEL_CLASS}>
          Título / Especialidad
        </label>
        <input
          id="role_title"
          name="role_title"
          type="text"
          defaultValue={barber?.role_title ?? ""}
          placeholder="Ej: Barbero Senior, Estilista"
          className={INPUT_CLASS}
          disabled={isPending}
        />
      </div>

      {/* Biografía */}
      <div>
        <label htmlFor="bio" className={LABEL_CLASS}>
          Biografía
        </label>
        <textarea
          id="bio"
          name="bio"
          rows={3}
          defaultValue={barber?.bio ?? ""}
          placeholder="Breve descripción del barbero…"
          className={INPUT_CLASS + " resize-none"}
          disabled={isPending}
        />
      </div>

      {/* URL de foto */}
      <div>
        <label htmlFor="photo_url" className={LABEL_CLASS}>
          URL de foto
        </label>
        <input
          id="photo_url"
          name="photo_url"
          type="url"
          defaultValue={barber?.photo_url ?? ""}
          placeholder="https://…"
          className={INPUT_CLASS}
          disabled={isPending}
        />
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
            defaultValue={barber?.sort_order ?? 0}
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
            defaultValue={barber?.is_active !== false ? "true" : "false"}
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
              : "Crear barbero"}
        </button>
      </div>
    </form>
  );
}
