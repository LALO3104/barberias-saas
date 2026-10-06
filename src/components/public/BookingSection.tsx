"use client";

import { useReducer, useCallback } from "react";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { ScrollReveal } from "@/components/animations/ScrollReveal";
import { BookingWizard } from "@/components/public/BookingWizard";
import { BookingSuccess } from "@/components/public/BookingSuccess";
import type { PublicTenant } from "@/types/public";
import type { BookingConfirmation } from "@/types/public";

// ─── State ──────────────────────────────────────────────────────────────────

interface BookingState {
  status: "booking" | "success";
  confirmation: BookingConfirmation | null;
}

type BookingAction =
  | { type: "SUCCESS"; confirmation: BookingConfirmation }
  | { type: "RESET" };

function bookingReducer(state: BookingState, action: BookingAction): BookingState {
  switch (action.type) {
    case "SUCCESS":
      return { status: "success", confirmation: action.confirmation };
    case "RESET":
      return { status: "booking", confirmation: null };
    default:
      return state;
  }
}

// ─── Component ──────────────────────────────────────────────────────────────

interface BookingSectionProps {
  tenant: PublicTenant;
}

/**
 * Sección de reservas — contiene el wizard completo y la pantalla de éxito.
 * Client Component por la interactividad del flujo de reserva.
 */
export function BookingSection({ tenant }: BookingSectionProps) {
  const [state, dispatch] = useReducer(bookingReducer, {
    status: "booking",
    confirmation: null,
  });

  const handleSuccess = useCallback((confirmation: BookingConfirmation) => {
    dispatch({ type: "SUCCESS", confirmation });
  }, []);

  const handleReset = useCallback(() => {
    dispatch({ type: "RESET" });
  }, []);

  return (
    <section id="reservar" className="border-t border-border">
      <Container className="py-[var(--spacing-section)]">
        <ScrollReveal>
          <SectionHeading
            eyebrow="Reserva tu cita"
            title="Agenda tu visita"
            description={
              state.status === "booking"
                ? "Elige barbero, servicio, fecha y horario para reservar tu cita."
                : undefined
            }
          />
        </ScrollReveal>

        <div className="mt-12">
          {state.status === "booking" ? (
            <BookingWizard tenant={tenant} onSuccess={handleSuccess} />
          ) : (
            <BookingSuccess
              confirmation={state.confirmation!}
              tenant={tenant}
              onNewBooking={handleReset}
            />
          )}
        </div>
      </Container>
    </section>
  );
}
