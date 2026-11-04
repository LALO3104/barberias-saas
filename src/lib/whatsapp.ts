/**
 * Avisos por WhatsApp sin costo: enlaces wa.me con el texto ya escrito.
 * El personal abre WhatsApp con el mensaje y lo envía él mismo (no hay API).
 *
 * Las plantillas personalizadas viven en tenants.message_templates (solo las
 * que el admin cambió); una clave ausente usa DEFAULT_TEMPLATES.
 */

import type { AppointmentStatus } from "@/lib/appointments";

export type MessageKey = "confirm" | "reminder" | "cancel" | "reschedule";

export const MESSAGE_KEYS: MessageKey[] = ["confirm", "reminder", "reschedule", "cancel"];

export const MESSAGE_LABELS: Record<MessageKey, string> = {
  confirm: "Confirmación",
  reminder: "Recordatorio",
  reschedule: "Cambio de horario",
  cancel: "Cancelación",
};

export const MAX_TEMPLATE_LENGTH = 1000;

export const DEFAULT_TEMPLATES: Record<MessageKey, string> = {
  confirm:
    "Hola {cliente}, te confirmamos tu cita en {barberia} el {fecha} a las {hora} con {barbero} ({servicios}). ¡Te esperamos!",
  reminder:
    "Hola {cliente}, te recordamos tu cita en {barberia} el {fecha} a las {hora} con {barbero}. Si no puedes venir, avísanos por aquí.",
  reschedule:
    "Hola {cliente}, tu cita en {barberia} quedó para el {fecha} a las {hora} con {barbero} ({servicios}). Si necesitas otro horario, avísanos.",
  cancel:
    "Hola {cliente}, tu cita en {barberia} del {fecha} a las {hora} fue cancelada. Motivo: {motivo}. Escríbenos si quieres agendar otra.",
};

/** Variables que se pueden usar en las plantillas. */
export const PLACEHOLDERS: { token: string; description: string }[] = [
  { token: "{cliente}", description: "nombre del cliente" },
  { token: "{barberia}", description: "nombre de la barbería" },
  { token: "{barbero}", description: "quién atiende" },
  { token: "{fecha}", description: "día de la cita" },
  { token: "{hora}", description: "hora (24 h)" },
  { token: "{servicios}", description: "servicios de la cita" },
  { token: "{motivo}", description: "motivo de cancelación" },
];

export type MessageTemplates = Partial<Record<MessageKey, string>>;

export function isMessageKey(value: unknown): value is MessageKey {
  return value === "confirm" || value === "reminder" || value === "cancel" || value === "reschedule";
}

/** Lee tenants.message_templates (Json) descartando lo que no sea válido. */
export function parseTemplates(json: unknown): MessageTemplates {
  const out: MessageTemplates = {};
  if (!json || typeof json !== "object" || Array.isArray(json)) return out;
  for (const [key, value] of Object.entries(json)) {
    if (isMessageKey(key) && typeof value === "string" && value.trim()) out[key] = value;
  }
  return out;
}

export function templateFor(key: MessageKey, templates: MessageTemplates): string {
  return templates[key] ?? DEFAULT_TEMPLATES[key];
}

/** Sustituye {variable}; las desconocidas se dejan tal cual. */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{([a-z]+)\}/g, (match, name: string) => values[name] ?? match);
}

/** Mensajes que tienen sentido según el estado de la cita. */
export function messagesForStatus(status: AppointmentStatus): MessageKey[] {
  if (status === "pending" || status === "confirmed") return ["confirm", "reminder", "reschedule"];
  if (status === "cancelled") return ["cancel"];
  return [];
}

/** https://wa.me/<dígitos>?text=… (null si el teléfono no sirve). */
export function waLink(phone: string, text: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
