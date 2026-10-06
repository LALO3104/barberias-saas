import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/supabase";

/**
 * Cliente de Supabase para Server Components, Server Actions y Route Handlers.
 *
 * Lee y escribe las cookies de sesión del request actual.
 * Devuelve `null` si las variables de entorno no están configuradas.
 *
 * Uso:
 * ```ts
 * const supabase = await getSupabaseServer();
 * const { data } = await supabase?.from("tenants").select();
 * ```
 */
export async function getSupabaseServer() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  const cookieStore = await cookies();

  return createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Llamado desde un Server Component: cookies es read-only.
          // El proxy refresca la sesión en cada request, así que
          // es seguro ignorar este error.
        }
      },
    },
  });
}
