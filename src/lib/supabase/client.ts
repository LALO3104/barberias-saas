import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Cliente de Supabase para el navegador (Client Components).
 *
 * Deliberadamente NO se instancia a nivel de módulo: todavía no hay Auth ni
 * políticas RLS, así que no hay nada que este cliente pueda leer. Las
 * credenciales se leen desde variables de entorno — ver
 * `.env.local.example` — y nunca deben hardcodearse aquí.
 *
 * Tipado con `Database` (generado desde las migraciones de `supabase/`):
 * tablas, columnas y enums se verifican en tiempo de compilación.
 *
 * Devuelve `null` mientras las variables de entorno no estén configuradas,
 * para que el resto de la app pueda compilar y correr antes de conectar el
 * backend real.
 */
export function getSupabaseClient(): SupabaseClient<Database> | null {
  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  return createClient<Database>(supabaseUrl, supabaseAnonKey);
}
