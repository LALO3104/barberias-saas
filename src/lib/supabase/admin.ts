import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";

/**
 * Cliente de Supabase con la llave de servicio (service_role).
 *
 * Bypasses RLS — usar **solo** en el servidor (Server Actions, Route Handlers)
 * y con extrema precaución.
 *
 * NUNCA exponer `SUPABASE_SERVICE_ROLE_KEY` como `NEXT_PUBLIC_*`.
 *
 * Lanza un error si las variables no están configuradas, porque su
 * ausencia indica un problema de despliegue que no debe ignorarse.
 */
export function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY. " +
        "Verifica las variables de entorno del servidor.",
    );
  }

  return createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
