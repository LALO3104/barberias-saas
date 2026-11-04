import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { formatPrice } from "@/lib/format";
import { dateKeyInTimezone, formatPhoneDisplay, formatShortDay } from "@/lib/appointments";
import { CLIENTS_PAGE_SIZE, type ClientDirectory } from "@/lib/clients";

export const metadata: Metadata = {
  title: "Clientes — Dashboard",
  description: "Clientes de tu barbería.",
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Directorio de clientes (public.get_clients).
 *   admin  → todos los de su barbería.
 *   barber → solo los que tiene o tuvo en su agenda, con sus propios números
 *            (lo garantiza RLS, no esta pantalla).
 */
export default async function ClientesPage(props: PageProps) {
  const supabase = await getSupabaseServer();
  if (!supabase) redirect("/login");
  const authUser = await getAuthenticatedUser(supabase);
  if (!authUser?.activeMembership) redirect("/login");

  const { tenantId, role } = authUser.activeMembership;
  const isAdmin = role === "admin";
  const title = isAdmin ? "Clientes" : "Mis clientes";
  const sp = await props.searchParams;

  const q = (first(sp.q) ?? "").trim().slice(0, 80);
  const page = Math.max(1, Math.floor(Number(first(sp.pagina)) || 1));

  const [{ data: tenant }, { data, error }] = await Promise.all([
    supabase.from("tenants").select("timezone, currency").eq("id", tenantId).single(),
    supabase.rpc("get_clients", {
      _tenant_id: tenantId,
      _search: q || undefined,
      _limit: CLIENTS_PAGE_SIZE,
      _offset: (page - 1) * CLIENTS_PAGE_SIZE,
    }),
  ]);

  if (error || !data || !tenant) {
    return (
      <div className="space-y-4">
        <h1 className="text-section font-display text-foreground">{title}</h1>
        <div className="rounded-card border border-red-500/30 bg-red-500/10 p-6 text-center">
          <p className="text-body font-sans text-red-400">No se pudieron cargar los clientes. Intenta recargar la página.</p>
        </div>
      </div>
    );
  }

  const { total, items } = data as unknown as ClientDirectory;
  const pages = Math.max(1, Math.ceil(total / CLIENTS_PAGE_SIZE));
  const pageLink = (n: number) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (n > 1) params.set("pagina", String(n));
    const query = params.toString();
    return query ? `/dashboard/clientes?${query}` : "/dashboard/clientes";
  };
  const day = (iso: string) => formatShortDay(dateKeyInTimezone(iso, tenant.timezone));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-section font-display text-foreground">{title}</h1>
        <p className="mt-1 text-body font-sans text-muted">
          {total === 1 ? "1 cliente" : `${total} clientes`}
          {q ? ` con “${q}”` : ""}
        </p>
      </div>

      <form action="/dashboard/clientes" role="search" className="flex gap-2">
        <label htmlFor="client-search" className="sr-only">
          Buscar por nombre o teléfono
        </label>
        <input
          id="client-search"
          name="q"
          type="search"
          defaultValue={q}
          maxLength={80}
          enterKeyHint="search"
          placeholder="Nombre o teléfono"
          className="block h-12 w-full min-w-0 rounded-button border border-border bg-background px-4 text-base font-sans text-foreground placeholder:text-muted/50 transition-colors duration-150 ease-out focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
        <button
          type="submit"
          className="h-12 shrink-0 rounded-button bg-accent px-5 text-sm font-sans font-semibold text-background transition-[filter,transform] duration-150 ease-out hover:brightness-110 active:scale-[0.97]"
        >
          Buscar
        </button>
      </form>

      {items.length === 0 ? (
        <p className="rounded-card border border-border bg-background-secondary p-[var(--spacing-card)] text-center text-body font-sans text-muted">
          {q ? "Nadie coincide con esa búsqueda." : isAdmin ? "Aún no hay clientes." : "Aún no tienes clientes en tu agenda."}
        </p>
      ) : (
        <ul className="space-y-2.5">
          {items.map((c) => (
            <li key={c.id}>
              <Link
                href={`/dashboard/clientes/${c.id}`}
                className="flex items-center gap-3 rounded-card border border-border bg-background-secondary p-4 transition-[border-color,transform] duration-150 ease-out hover:border-accent/60 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span
                  aria-hidden="true"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent/15 font-display text-lg text-accent"
                >
                  {c.full_name.charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-lg leading-snug text-foreground">{c.full_name}</span>
                  <span className="block truncate text-sm font-sans text-muted">
                    {c.visits === 1 ? "1 visita" : `${c.visits} visitas`}
                    {c.next_visit
                      ? ` · próxima ${day(c.next_visit)}`
                      : c.last_visit
                        ? ` · última ${day(c.last_visit)}`
                        : ""}
                  </span>
                  {c.phone && (
                    <span className="block text-sm font-sans tabular-nums text-muted">{formatPhoneDisplay(c.phone)}</span>
                  )}
                </span>
                {c.spent_cents > 0 && (
                  <span className="shrink-0 font-display tabular-nums text-accent">{formatPrice(c.spent_cents, tenant.currency)}</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {pages > 1 && (
        <nav className="flex items-center justify-between gap-3" aria-label="Páginas">
          {page > 1 ? (
            <Link href={pageLink(page - 1)} className={PAGE_LINK}>
              ← Anterior
            </Link>
          ) : (
            <span />
          )}
          <span className="text-sm font-sans tabular-nums text-muted">
            {page} de {pages}
          </span>
          {page < pages ? (
            <Link href={pageLink(page + 1)} className={PAGE_LINK}>
              Siguiente →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}

const PAGE_LINK =
  "inline-flex h-11 items-center rounded-button border border-border px-4 text-sm font-sans text-foreground transition-[background-color,transform] duration-150 ease-out hover:bg-border/40 active:scale-[0.97]";
