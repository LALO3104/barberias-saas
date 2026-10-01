# Barberías

SaaS para barberías. La raíz (`/`) sirve hoy la landing pública de
**Barbería Kings** — con **contenido demo/provisional**, ver
`src/data/tenants/kings.ts` — pensada como la primera implementación de una
plantilla reutilizable para el resto del sistema. **Todavía no incluye**
autenticación, tablas de Supabase, reservas reales ni dashboard —
intencional, ver `ARCHITECTURE.md`.

## Stack

- [Next.js](https://nextjs.org) (App Router) + TypeScript
- [Tailwind CSS v4](https://tailwindcss.com)
- [GSAP](https://gsap.com) + [@gsap/react](https://gsap.com/resources/React) (ScrollTrigger y SplitText registrados)
- [Supabase](https://supabase.com) (cliente preparado, sin conectar todavía)
- Pensado para desplegarse en [Vercel](https://vercel.com)

## Requisitos

- Node.js 20 o superior
- npm (el proyecto se generó con `npm`; si prefieres otro gestor, borra
  `package-lock.json` y usa el tuyo)

## Cómo correrlo en local

```bash
npm install
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000).

## Rutas

- `/` — landing pública de Barbería Kings (contenido demo/provisional, ver
  `src/data/tenants/kings.ts`). El CTA "Reservar cita" navega a `#reservar`
  dentro de la misma página — no hay sistema de reservas todavía.
- `/design-system` — Design System Preview (color, tipografía, botones,
  una tarjeta, espaciado). Referencia viva de los tokens mientras se
  construyen más secciones — no es una página real del sitio.

## Cómo comprobar que Next.js funciona

Con `npm run dev` corriendo, entra a `http://localhost:3000`. Deberías ver
la landing de Barbería Kings (con el aviso "Vista previa — contenido de
muestra..." arriba del todo). Si se ve, el servidor de desarrollo, el App
Router y Tailwind están funcionando. También puedes correr una build de
producción real:

```bash
npm run build
npm run start
```

Si ambos comandos terminan sin errores, el proyecto compila correctamente
(incluyendo TypeScript, ya que `next build` falla si hay errores de tipos).

## Cómo comprobar que GSAP quedó bien instalado

En `/`, el Hero entra con un stagger corto (eyebrow → título → subtítulo →
CTAs) apenas carga la página — usa un timeline de GSAP directamente en
`components/sections/Hero.tsx`. Si bajas por la página, cada sección
siguiente (Experiencia, Servicios, Barberos, Galería, Horarios, CTA final)
aparece con un fade + slide al entrar en el viewport — eso es
`ScrollReveal` (`src/components/animations/ScrollReveal.tsx`) usando
`ScrollTrigger`. Ambos dependen de que `src/lib/gsap/gsap.ts` haya
importado `gsap` y registrado `ScrollTrigger`/`SplitText` sin errores.

Si las animaciones se ven, GSAP quedó bien instalado y registrado. Para
confirmarlo también desde la consola del navegador, con la página abierta:

```js
window.gsap; // debería existir y no ser undefined
```

Si activas "reducir movimiento" en tu sistema operativo y recargas, el
mismo texto debe aparecer **sin** animar — esa es la verificación de que se
está respetando `prefers-reduced-motion`.

## Base de datos (Supabase local)

Requiere Docker Desktop corriendo (en Windows, con WSL2). La CLI de Supabase
ya viene como dependencia de desarrollo.

```bash
npm run db:start   # primera vez: descarga imágenes y aplica las migraciones
npm run db:reset   # recrea la base desde cero con supabase/migrations/
npm run db:types   # regenera src/types/supabase.ts desde la base local
```

Las migraciones viven en `supabase/migrations/` y son la única forma de
cambiar el esquema: nunca editar una base remota sin su migración en Git.

### Proyecto remoto de desarrollo

El proyecto de Supabase `barberias` (ref `ncirywuyzeoyqhtlmisj`) es el
entorno de **desarrollo** y ya tiene aplicadas las migraciones de este
repositorio, con las mismas versiones que los nombres de archivo. Para
trabajar contra él con la CLI:

```bash
npx supabase login
npx supabase link --project-ref ncirywuyzeoyqhtlmisj
npx supabase migration list   # local y remoto deben coincidir
npm run db:types:remote       # regenera los tipos desde el proyecto remoto
```

Cuando exista producción será un proyecto aparte.

## Variables de entorno

Copia `.env.local.example` a `.env.local` y complétalo cuando exista un
proyecto real de Supabase:

```bash
cp .env.local.example .env.local
```

Mientras esas variables no estén definidas, `getSupabaseClient()`
(`src/lib/supabase/client.ts`) devuelve `null` en lugar de fallar.

## Estructura del proyecto

Ver `ARCHITECTURE.md` para el detalle y el razonamiento de cada carpeta.

## Lint

```bash
npm run lint
```
