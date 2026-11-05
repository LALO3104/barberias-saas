/**
 * Notificaciones push sin librerías: el aviso viaja vacío (solo firma VAPID) y
 * el teléfono pide los detalles con su sesión. Así no hace falta cifrar nada y
 * los datos del cliente no pasan por Google ni Apple.
 */

/** Llave pública VAPID. La privada es el secreto VAPID_PRIVATE_JWK de Cloudflare. */
export const VAPID_PUBLIC_KEY =
  "BOAWWHKpm74MSPEnAfXtkagShPcUMODqkjR98E5ZMPuaSzw1Tqz76biklibNEEa1wC1NpUYQCg8RtjJjlQHZRIY";

const SITE_SUBJECT = "https://barberias.barberias.workers.dev";

// Igual que el CHECK de push_subscriptions: el servidor solo envía a estos.
const PUSH_ENDPOINT =
  /^https:\/\/(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)\/\S+$/;

export function isPushEndpoint(value: unknown): value is string {
  return typeof value === "string" && value.length <= 1000 && PUSH_ENDPOINT.test(value);
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Texto base64url a bytes (la llave pública para suscribirse). */
export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Encabezado Authorization (RFC 8292) para un servicio de push. */
export async function vapidAuthorization(endpoint: string, privateJwk: JsonWebKey): Promise<string> {
  const encoder = new TextEncoder();
  const part = (value: unknown) => base64Url(encoder.encode(JSON.stringify(value)));
  const unsigned = `${part({ typ: "JWT", alg: "ES256" })}.${part({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: SITE_SUBJECT,
  })}`;

  const key = await crypto.subtle.importKey("jwk", privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(unsigned));

  return `vapid t=${unsigned}.${base64Url(new Uint8Array(signature))}, k=${VAPID_PUBLIC_KEY}`;
}

/** Compara secretos sin revelar por tiempo dónde difieren. */
export async function sameSecret(a: string, b: string): Promise<boolean> {
  const digest = async (text: string) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  const [left, right] = await Promise.all([digest(a), digest(b)]);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}
