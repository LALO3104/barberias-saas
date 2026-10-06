/**
 * Tipos para los datos devueltos por las RPC públicas.
 *
 * Estos tipos reflejan EXACTAMENTE la forma del JSON que devuelven las
 * funciones `get_public_tenant`, `get_available_slots` y `book_appointment`
 * del backend (Paso 3). Si cambian las funciones, estos tipos deben
 * actualizarse para mantenerse sincronizados.
 *
 * No se reutilizan los tipos de `content.ts` (que son para datos estáticos
 * de maquetación) — estos representan la respuesta real del backend.
 */

// ─── get_public_tenant ──────────────────────────────────────────────────────

export interface PublicBarber {
  id: string;
  display_name: string;
  role_title: string | null;
  bio: string | null;
  photo_url: string | null;
  sort_order: number;
}

export interface PublicService {
  id: string;
  name: string;
  description: string | null;
  price_cents: number;
  duration_minutes: number;
  sort_order: number;
}

export interface PublicBusinessHours {
  day_of_week: number; // ISO: 1=lunes … 7=domingo
  opens_at: string; // time (HH:MM:SS)
  closes_at: string; // time (HH:MM:SS)
}

export interface PublicTenant {
  name: string;
  slug: string;
  timezone: string;
  currency: string;
  address_line: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  public_phone: string | null;
  logo_url: string | null;
  theme: Record<string, unknown> | null;
  site_content: Record<string, unknown> | null;
  barbers: PublicBarber[];
  services: PublicService[];
  business_hours: PublicBusinessHours[];
}

// ─── get_available_slots ────────────────────────────────────────────────────

/** Cada slot devuelto por get_available_slots */
export interface AvailableSlot {
  slot_start: string; // timestamptz ISO string
}

// ─── book_appointment ───────────────────────────────────────────────────────

export interface BookingConfirmation {
  appointment_id: string;
  status: "pending";
  barber_id: string;
  service: {
    id: string;
    name: string;
    price_cents: number;
    duration_minutes: number;
  };
  start_at: string; // timestamptz ISO string
  end_at: string; // timestamptz ISO string
  client: {
    id: string;
    name: string;
    phone: string;
  };
}
