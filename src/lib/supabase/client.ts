import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/supabase";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Cliente de Supabase para el navegador (Client Components).
 *
 * Usa `@supabase/ssr` para manejar las cookies de sesión
 * automáticamente. Tipado con `Database` (generado desde las
 * migraciones de `supabase/`).
 *
 * Devuelve `null` mientras las variables de entorno no estén
 * configuradas, para que la app compile antes de conectar el backend.
 */
export function getSupabaseClient() {
  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  return createBrowserClient<Database>(supabaseUrl, supabaseAnonKey);
}
