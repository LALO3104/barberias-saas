/**
 * "Agregar a mi calendario" sin servicios externos: archivo .ics (iPhone,
 * Android, escritorio) y enlace de Google Calendar. Las horas van en UTC
 * (sufijo Z): cada calendario las muestra en la zona del teléfono.
 */

interface CalendarEvent {
  title: string;
  description: string;
  location: string;
  startIso: string;
  endIso: string;
  uid: string;
}

/** 2026-10-03T15:30:00.000Z → 20261003T153000Z */
function toCalendarUtc(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Escapa texto según RFC 5545 (\ ; , y saltos de línea). */
function escapeIcs(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

export function buildIcs(event: CalendarEvent): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Barberias//Reserva//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${toCalendarUtc(new Date().toISOString())}`,
    `DTSTART:${toCalendarUtc(event.startIso)}`,
    `DTEND:${toCalendarUtc(event.endIso)}`,
    `SUMMARY:${escapeIcs(event.title)}`,
    `DESCRIPTION:${escapeIcs(event.description)}`,
    ...(event.location ? [`LOCATION:${escapeIcs(event.location)}`] : []),
    "BEGIN:VALARM",
    "TRIGGER:-PT1H",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeIcs(event.title)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

/** Descarga/abre el .ics (en el teléfono, el sistema ofrece agregarlo). */
export function downloadIcs(event: CalendarEvent, filename = "cita.ics"): void {
  const blob = new Blob([buildIcs(event)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function googleCalendarUrl(event: CalendarEvent): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${toCalendarUtc(event.startIso)}/${toCalendarUtc(event.endIso)}`,
    details: event.description,
    location: event.location,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
