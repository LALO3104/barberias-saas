import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { rowsToWeek } from "@/lib/schedule";
import {
  ScheduleManager,
  type ScheduleBarber,
} from "@/components/dashboard/schedules/ScheduleManager";
import { MySchedule } from "@/components/dashboard/schedules/MySchedule";

export const metadata: Metadata = {
  title: "Horarios — Dashboard",
  description: "Gestiona el horario de tu barbería y de cada barbero.",
};

type ServerClient = NonNullable<Awaited<ReturnType<typeof getSupabaseServer>>>;

/**
 * Página de horarios.
 *
 * Seguridad server-side:
 *  1. Verifica sesión (redirect a /login si no existe)
 *  2. Verifica membresía activa
 *  3. Según tenant_members.role:
 *       admin  → horario del local + horario de todos los barberos
 *       barber → solo SU horario (barbers.user_id = usuario de sesión)
 *  4. Obtiene datos filtrados por tenant (RLS + query explícita)
 *
 * El tenant_id y el rol provienen de la membresía server-side, NUNCA del cliente.
 */
export default async function SchedulesPage() {
  // 1. Auth guard
  const supabase = await getSupabaseServer();
  if (!supabase) redirect("/login");

  const authUser = await getAuthenticatedUser(supabase);
  if (!authUser?.activeMembership) redirect("/login");

  const tenantId = authUser.activeMembership.tenantId;

  // 2. Barbero → solo su propio horario
  if (authUser.activeMembership.role !== "admin") {
    return renderBarberView(supabase, tenantId, authUser.id);
  }

  // 3. Admin — datos del tenant (RLS filtra; el .eq explícito es la segunda barrera)
  const [tenantRes, businessRes, barbersRes, barberHoursRes] = await Promise.all([
    supabase.from("tenants").select("timezone").eq("id", tenantId).single(),
    supabase
      .from("business_hours")
      .select("day_of_week, opens_at, closes_at")
      .eq("tenant_id", tenantId),
    supabase
      .from("barbers")
      .select("id, display_name")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    supabase
      .from("barber_working_hours")
      .select("barber_id, day_of_week, opens_at, closes_at")
      .eq("tenant_id", tenantId),
  ]);

  if (tenantRes.error || businessRes.error || barbersRes.error || barberHoursRes.error) {
    return <LoadError title="Horarios" />;
  }

  const barberHours = barberHoursRes.data ?? [];
  const barbers: ScheduleBarber[] = (barbersRes.data ?? []).map((b) => {
    const rows = barberHours.filter((h) => h.barber_id === b.id);
    return {
      id: b.id,
      displayName: b.display_name,
      week: rowsToWeek(rows),
      hasHours: rows.length > 0,
    };
  });

  return (
    <ScheduleManager
      timezone={tenantRes.data.timezone}
      businessWeek={rowsToWeek(businessRes.data ?? [])}
      barbers={barbers}
    />
  );
}

// ─── Vista del barbero: solo su propio horario ───────────────────────────────

/**
 * Resuelve el barbero vinculado al usuario de sesión (barbers.user_id) dentro
 * del tenant activo. Nunca usa un barber_id enviado por el cliente.
 */
async function renderBarberView(
  supabase: ServerClient,
  tenantId: string,
  userId: string
) {
  const [tenantRes, barberRes, businessRes] = await Promise.all([
    supabase.from("tenants").select("timezone").eq("id", tenantId).single(),
    supabase
      .from("barbers")
      .select("id, display_name, is_active")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("business_hours")
      .select("day_of_week, opens_at, closes_at")
      .eq("tenant_id", tenantId),
  ]);

  if (tenantRes.error || barberRes.error || businessRes.error) {
    return <LoadError title="Mi horario" />;
  }

  const barber = barberRes.data;
  if (!barber) return <NotLinkedPage />;

  const { data: ownHours, error: hoursError } = await supabase
    .from("barber_working_hours")
    .select("day_of_week, opens_at, closes_at")
    .eq("tenant_id", tenantId)
    .eq("barber_id", barber.id);

  if (hoursError) return <LoadError title="Mi horario" />;

  const rows = ownHours ?? [];

  return (
    <MySchedule
      timezone={tenantRes.data.timezone}
      barberId={barber.id}
      displayName={barber.display_name}
      isActive={barber.is_active}
      week={rowsToWeek(rows)}
      hasHours={rows.length > 0}
      businessWeek={rowsToWeek(businessRes.data ?? [])}
    />
  );
}

// ─── Estados auxiliares ──────────────────────────────────────────────────────

function LoadError({ title }: { title: string }) {
  return (
    <div className="space-y-4">
      <h1 className="text-section font-display text-foreground">{title}</h1>
      <div className="rounded-card border border-red-500/30 bg-red-500/10 p-6 text-center">
        <p className="text-body font-sans text-red-400">
          No se pudieron cargar los horarios. Intenta recargar la página.
        </p>
      </div>
    </div>
  );
}

/** Usuario con rol barber cuya cuenta aún no está vinculada a un barbero. */
function NotLinkedPage() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="max-w-md space-y-6 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-border bg-background">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="h-8 w-8 text-muted"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244"
            />
          </svg>
        </div>
        <h1 className="text-section font-display text-foreground">
          Perfil de barbero no vinculado
        </h1>
        <p className="text-body font-sans text-muted">
          Tu cuenta aún no está vinculada a un perfil de barbero. Pide al
          administrador de tu barbería que la vincule para poder gestionar tu
          horario.
        </p>
        <Link
          href="/dashboard"
          className="inline-flex items-center justify-center rounded-button bg-accent px-6 py-3 text-body font-sans font-semibold text-background transition-all hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Volver al dashboard
        </Link>
      </div>
    </div>
  );
}
