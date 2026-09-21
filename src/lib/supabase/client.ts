import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Cliente de Supabase para el navegador (Client Components).
 *
 * Deliberadamente NO se instancia a nivel de módulo ni se conecta a nada
 * todavía: este proyecto aún no tiene backend real en Supabase (sin tablas,
 * sin auth). Las credenciales se leen desde variables de entorno — ver
 * `.env.local.example` — y nunca deben hardcodearse aquí.
 *
 * Devuelve `null` mientras las variables de entorno no estén configuradas,
 * para que el resto de la app pueda compilar y correr antes de conectar el
 * backend real.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  return createClient(supabaseUrl, supabaseAnonKey);
}
