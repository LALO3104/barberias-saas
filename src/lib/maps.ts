/**
 * Ubicación en Google Maps sin clave ni costo: el admin pega el enlace de
 * "Compartir" y aquí se obtiene qué mostrar (coordenadas o nombre del lugar).
 */

const MAX_QUERY_LENGTH = 300;

const SHORT_HOSTS = new Set(["maps.app.goo.gl", "goo.gl"]);
const GOOGLE_HOST = /^(www\.|maps\.)?google\.[a-z]{2,3}(\.[a-z]{2})?$/;

/** Solo enlaces https de Google Maps (lo que el servidor puede seguir). */
export function parseGoogleMapsUrl(link: string): URL | null {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.port || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (host === "maps.app.goo.gl") return url;
  if (host === "goo.gl") return url.pathname.startsWith("/maps") ? url : null;
  if (host === "consent.google.com") return url;
  if (!GOOGLE_HOST.test(host)) return null;
  return host.startsWith("maps.") || url.pathname.startsWith("/maps") ? url : null;
}

export function isShortMapsUrl(url: URL): boolean {
  return SHORT_HOSTS.has(url.hostname.toLowerCase());
}

function clean(value: string | null | undefined): string | null {
  const text = value?.replace(/\+/g, " ").replace(/\s+/g, " ").trim();
  return text && text.length <= MAX_QUERY_LENGTH ? text : null;
}

/** Coordenadas o nombre del lugar de un enlace largo de Google Maps; null si no hay. */
export function extractMapQuery(url: URL): string | null {
  const href = decodeURIComponent(url.href);

  // El pin del lugar es más exacto que el centro de la vista (@lat,lng).
  const pin = /!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/.exec(href);
  if (pin) return `${pin[1]},${pin[2]}`;

  for (const key of ["q", "query", "destination", "ll", "center"]) {
    const value = clean(url.searchParams.get(key));
    if (value) return value;
  }

  const view = /@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/.exec(href);
  if (view) return `${view[1]},${view[2]}`;

  const place = /\/maps\/(?:place|search)\/([^/@?]+)/.exec(url.pathname);
  return place ? clean(decodeURIComponent(place[1])) : null;
}

/** Mapa para incrustar en un iframe. */
export function mapEmbedUrl(query: string): string {
  return `https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed`;
}

/** Abre el lugar en Google Maps (la app, en el teléfono). */
export function mapOpenUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
