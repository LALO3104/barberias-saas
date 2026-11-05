import { isPushEndpoint, sameSecret, vapidAuthorization } from "@/lib/push";

const MAX_ENDPOINTS = 20;

/**
 * Lo llama la base de datos (pg_net) tras una reserva en línea, con el secreto
 * compartido guardado en Vault. Envía un aviso vacío a cada dispositivo. No usa
 * la base ni service_role: las direcciones llegan en la petición.
 */
export async function POST(request: Request) {
  const secret = process.env.PUSH_WEBHOOK_SECRET;
  const privateJwk = process.env.VAPID_PRIVATE_JWK;
  if (!secret || !privateJwk) return Response.json({ error: "No configurado" }, { status: 503 });

  if (!(await sameSecret(request.headers.get("x-push-secret") ?? "", secret))) {
    return Response.json({ error: "No autorizado" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { endpoints?: unknown } | null;
  const endpoints = Array.isArray(body?.endpoints) ? body.endpoints.filter(isPushEndpoint).slice(0, MAX_ENDPOINTS) : [];
  if (endpoints.length === 0) return Response.json({ error: "Sin dispositivos válidos" }, { status: 400 });

  const jwk = JSON.parse(privateJwk) as JsonWebKey;
  const results = await Promise.allSettled(
    endpoints.map(async (endpoint) => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: await vapidAuthorization(endpoint, jwk),
          TTL: "43200",
          Urgency: "high",
        },
        signal: AbortSignal.timeout(8000),
      });
      return response.status;
    })
  );

  const statuses = results.map((r) => (r.status === "fulfilled" ? r.value : 0));
  const sent = statuses.filter((status) => status >= 200 && status < 300).length;
  if (sent < statuses.length) console.warn("Avisos push no entregados", statuses);

  return Response.json({ sent, failed: statuses.length - sent });
}
