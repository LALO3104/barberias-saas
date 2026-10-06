import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextProxy } from "next/server";

/**
 * Proxy de sesión — refresca los tokens de Supabase en cada request.
 *
 * En Next.js 16 este archivo reemplaza a `middleware.ts`.
 * Sin él, los tokens expirados provocan cierres de sesión inesperados.
 *
 * Lógica:
 *   1. Lee las cookies de sesión del request entrante.
 *   2. Llama a `getUser()` para que @supabase/ssr renueve tokens si
 *      están próximos a expirar.
 *   3. Propaga las cookies actualizadas tanto al request (para Server
 *      Components downstream) como a la respuesta (para el navegador).
 *
 * La autorización real ocurre en RLS (base de datos) y en el servidor
 * (Server Actions / Route Handlers). Aquí solo se mantiene la sesión viva.
 */
export const proxy: NextProxy = async (request) => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Sin credenciales → continuar sin refrescar sesión
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.next();
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // 1. Actualizar cookies en el request para Server Components downstream
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }

        // 2. Crear nueva respuesta con las cookies actualizadas
        supabaseResponse = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          supabaseResponse.cookies.set(name, value, options);
        }
      },
    },
  });

  // Refrescar la sesión — el resultado no se usa aquí;
  // cada página/acción verificará la sesión según necesite.
  await supabase.auth.getUser();

  return supabaseResponse;
};

export const config = {
  matcher: [
    /*
     * Ejecutar en todas las rutas EXCEPTO:
     * - _next/static (archivos estáticos de Next.js)
     * - _next/image (optimización de imágenes)
     * - favicon.ico, sitemap.xml, robots.txt
     * - Archivos con extensiones de imagen/fuente comunes
     */
    "/((?!_next/static|_next/image|favicon\\.ico|sitemap\\.xml|robots\\.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2)$).*)",
  ],
};
