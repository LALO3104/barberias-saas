import { getSupabaseServer } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { formatClock } from "@/lib/appointments";
import { formatSlotDate } from "@/lib/format";

const NO_STORE = { "Cache-Control": "no-store" };
const WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Lo pide el service worker al recibir un aviso: la reserva en línea más
 * reciente del barbero con sesión. RLS limita la consulta a sus citas.
 */
export async function GET() {
  const supabase = await getSupabaseServer();
  const authUser = supabase ? await getAuthenticatedUser(supabase) : null;
  const membership = authUser?.activeMembership;
  if (!supabase || !authUser || !membership) return Response.json({}, { status: 401, headers: NO_STORE });

  const { tenantId } = membership;
  const [{ data: tenant }, { data: barber }] = await Promise.all([
    supabase.from("tenants").select("timezone").eq("id", tenantId).single(),
    supabase.from("barbers").select("id").eq("tenant_id", tenantId).eq("user_id", authUser.id).maybeSingle(),
  ]);
  if (!tenant || !barber) return Response.json({}, { headers: NO_STORE });

  const { data: appointment } = await supabase
    .from("appointments")
    .select("id, client_id, start_at")
    .eq("tenant_id", tenantId)
    .eq("barber_id", barber.id)
    .eq("source", "online")
    .eq("status", "pending")
    .gte("created_at", new Date(Date.now() - WINDOW_MS).toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!appointment) return Response.json({}, { headers: NO_STORE });

  const [{ data: client }, { data: lines }] = await Promise.all([
    supabase.from("clients").select("full_name").eq("tenant_id", tenantId).eq("id", appointment.client_id).maybeSingle(),
    supabase
      .from("appointment_services")
      .select("service_name")
      .eq("tenant_id", tenantId)
      .eq("appointment_id", appointment.id)
      .order("position", { ascending: true }),
  ]);

  const when = `${formatSlotDate(appointment.start_at, tenant.timezone)}, ${formatClock(appointment.start_at, tenant.timezone)}`;
  const services = (lines ?? []).map((line) => line.service_name).join(", ");

  return Response.json(
    {
      title: `Nueva cita: ${client?.full_name ?? "Cliente"}`,
      body: services ? `${when} · ${services}` : when,
      tag: appointment.id,
      url: "/dashboard/citas",
    },
    { headers: NO_STORE }
  );
}
