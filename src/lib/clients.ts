/**
 * Clientes y estadísticas: forma del JSON de public.get_clients y
 * public.get_business_stats. Las funciones son SECURITY INVOKER, así que para
 * un barbero todo lo que devuelven es solo de sus citas y sus cobros.
 */

export const CLIENTS_PAGE_SIZE = 30;
export const MAX_CLIENT_NOTE_LENGTH = 1000;
export const MAX_CLIENT_NAME_LENGTH = 120;

export interface ClientRow {
  id: string;
  full_name: string;
  phone: string | null;
  notes: string | null;
  created_at: string;
  visits: number;
  no_shows: number;
  last_visit: string | null;
  next_visit: string | null;
  spent_cents: number;
}

export interface ClientDirectory {
  total: number;
  items: ClientRow[];
}

export interface BusinessStats {
  appointments: {
    total: number;
    pending: number;
    confirmed: number;
    completed: number;
    cancelled: number;
    no_show: number;
    walk_in: number;
  };
  revenue: {
    charges: number;
    services_cents: number;
    discount_cents: number;
    tips_cents: number;
    total_cents: number;
    commission_cents: number;
    /** Cobros sin compensación configurada: su comisión cuenta como 0. */
    without_commission: number;
  };
  /** Centavos por método: cash, card, transfer. */
  methods: Record<string, number>;
  daily: { date: string; cents: number }[];
  services: { name: string; count: number; cents: number }[];
  barbers: {
    id: string;
    name: string;
    charges: number;
    services_cents: number;
    commission_cents: number;
    tips_cents: number;
  }[];
  clients: { total: number; served: number; new: number };
  /** 1 = lunes … 7 = domingo. */
  weekdays: { day: number; count: number }[];
  salaries_cents: number;
  /** Solo admin; null para el barbero. */
  profit_cents: number | null;
}
