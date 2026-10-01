# Arquitectura

Este documento explica el porqué de cada carpeta y los patrones que hay que
seguir al construir sobre esta base. Nada de lo descrito aquí como "futuro"
está implementado todavía — es intencional.

## Estructura de carpetas

```
src/
├── app/                    # Rutas (Next.js App Router)
│   ├── layout.tsx          # Layout raíz (fuentes, metadata, <html>/<body>)
│   ├── globals.css         # Import de tokens + reset/base + prefers-reduced-motion
│   ├── design-system/      # "Design System Preview" (temporal, ver más abajo)
│   ├── (public)/           # Landing pública — hoy sirve a Barbería Kings (ver más abajo)
│   ├── (booking)/          # Futuro: flujo de reservas
│   └── (dashboard)/        # Futuro: panel administrativo
├── components/
│   ├── ui/                 # Primitivos genéricos (Button, Container, Card, SectionHeading, ServiceCard, BarberCard, ImagePlaceholder)
│   ├── layout/              # Navbar, Footer — genéricos, sin contenido de ninguna barbería
│   ├── sections/            # Hero, ValueProposition, Services, Barbers, Gallery, HoursLocation, BookingCta
│   └── animations/          # Reveal (al montar), ScrollReveal (al entrar en viewport)
├── data/
│   └── tenants/
│       └── kings.ts         # Único archivo que sabe que existe "Barbería Kings" — contenido DEMO (ver más abajo)
├── hooks/
│   ├── useGsapAnimation.ts       # Wrapper de @gsap/react + prefers-reduced-motion
│   └── usePrefersReducedMotion.ts
├── lib/
│   ├── gsap/gsap.ts         # Único punto de registro de plugins GSAP
│   ├── supabase/client.ts   # Cliente de Supabase (sin conectar todavía)
│   ├── seo.ts                # `buildTenantMetadata()` — Metadata a partir de un TenantContent
│   └── utils.ts             # Helper `cn()` para clases de Tailwind
├── types/
│   ├── supabase.ts          # Placeholder de los tipos que generará Supabase
│   ├── tenant.ts            # Forma mínima de un tenant (id, slug, name)
│   └── content.ts            # Contrato de contenido de una landing (TenantContent) — sin mencionar Kings
└── styles/
    └── tokens.css           # Única fuente de verdad del sistema visual (ver abajo)
```

Los tres grupos de rutas — `(public)`, `(booking)`, `(dashboard)` — usan la
sintaxis de [route groups](https://nextjs.org/docs/app/building-your-application/routing/route-groups)
de Next.js: el paréntesis no aparece en la URL, solo sirve para organizar el
código por área de producto sin acoplar la ruta. `(public)/page.tsx` resuelve
hoy en `/` (la raíz del proyecto) — es una simplificación temporal de una
sola barbería, ver "Multi-tenant" más abajo.

## Sistema visual (design tokens)

`src/styles/tokens.css` es la única fuente de verdad del sistema visual:
define las variables CSS crudas en `:root` y las conecta a Tailwind v4 vía
`@theme inline`, que es lo que genera las clases utilitarias. `globals.css`
solo importa ese archivo y agrega el reset/base y `prefers-reduced-motion`.

**Color.** `--color-background`, `--color-background-secondary`,
`--color-foreground`, `--color-muted`, `--color-accent`, `--color-border` →
generan `bg-background`, `bg-background-secondary`, `text-foreground`,
`text-muted`, `bg-accent`/`text-accent`/`border-accent`, `border-border`.
Es la paleta actual de la demo (Barbería Kings), pero ningún componente la
referencia por nombre de barbería — solo por rol semántico (fondo, texto,
acento, borde). Ver "Theming futuro" más abajo.

**Tipografía.** `--font-sans` (Inter) y `--font-display` (Playfair
Display), configuradas con `next/font/google` en `layout.tsx` y expuestas
como variables CSS (`--font-inter`, `--font-playfair`). `body` usa
`font-sans` por defecto; `h1`/`h2`/`h3` usan `font-display` en
`@layer base`, así que cualquier encabezado lo hereda sin necesidad de una
clase, pero un componente puede pisarlo con `font-sans` si lo necesita (las
utilidades de Tailwind siempre ganan sobre `@layer base`).

**Escala tipográfica fluida.** `--text-hero`, `--text-section`,
`--text-body`, `--text-label` (con su `--text-*--line-height` asociado) son
todos `clamp()` — escalan solos entre ~360px y pantallas grandes, sin
breakpoints manuales. Generan `text-hero`, `text-section`, `text-body`,
`text-label`.

**Espaciado.** `--spacing-gutter`, `--spacing-card`, `--spacing-container`,
`--spacing-section` — también `clamp()`, de menor a mayor escala. Se usan
como `gap-[var(--spacing-gutter)]`, `p-[var(--spacing-card)]`,
`px-[var(--spacing-container)]`, `py-[var(--spacing-section)]`. El ancho
máximo del contenedor vive aparte en `--container-max-width: 1400px`.

**Radios y sombra.** `--radius-button`, `--radius-card`, `--shadow-card` →
`rounded-button`, `rounded-card`, `shadow-card`. Sombra sutil a propósito
(dos capas, sin blur exagerado); la profundidad real debe venir de
contraste, borde e imágenes, no de sombras pesadas.

**Componentes que usan estos tokens hoy:** `Container` (max-width +
padding), `Button` (variantes `primary`/`secondary`/`ghost`, tamaños
`sm`/`md`/`lg`, solo microinteracciones CSS — sin GSAP todavía; con `href`
se renderiza como `<a>` en vez de `<button>`, para CTAs de navegación),
`Card` (borde + fondo secundario + radio + sombra), `SectionHeading`,
`ServiceCard`, `BarberCard`, `ImagePlaceholder`, todas las secciones de
`components/sections/`, y la página de preview en `app/design-system/`.

### Theming futuro (multi-tenant)

Hoy los seis tokens de color son estáticos en `:root`. Para que cada
barbería tenga su propia paleta sin tocar componentes, la idea (no
implementada todavía) es que esos mismos seis nombres se puedan
sobrescribir por tenant — por ejemplo inyectando un `<style>` o atributos
`style` en el `<html>`/`<body>` a partir de los datos de la barbería en
Supabase — mientras todo lo demás (tipografía, espaciado, radios,
componentes) se queda igual. Por eso ningún componente hardcodea un color
hex directamente: todos pasan por estas seis variables.

## Patrón para animaciones con GSAP

Regla simple: **ningún componente llama a `gsap.registerPlugin` ni importa
`"gsap"` directamente.**

1. `src/lib/gsap/gsap.ts` importa GSAP + `ScrollTrigger` + `SplitText` y los
   registra una sola vez, protegido con `typeof window !== "undefined"` para
   no romper el renderizado en el servidor.
2. `src/hooks/useGsapAnimation.ts` envuelve `useGSAP` (el hook oficial de
   `@gsap/react`, que limpia las animaciones automáticamente al desmontar)
   y además se salta el callback por completo si el usuario tiene activado
   "reducir movimiento".
3. Los componentes de animación reutilizables (como `Reveal`) viven en
   `components/animations/` y son Client Components (`"use client"`) que
   usan `useGsapAnimation` por dentro. El resto de la app los consume sin
   preocuparse de GSAP, SSR ni accesibilidad — ya está resuelto ahí adentro.

### ScrollTrigger: `components/animations/ScrollReveal.tsx`

Mismo patrón que `Reveal`, pero dispara al entrar en el viewport en vez de
al montar — necesario en cuanto hay más de una sección en pantalla, para
que el contenido de abajo no se anime fuera de vista. Es lo que usan todas
las secciones de la landing (`ValueProposition`, `Services`, `Barbers`,
`Gallery`, `HoursLocation`, `BookingCta`), normalmente envolviendo un
`SectionHeading` o una tarjeta, con un `delay` incremental por índice para
lograr el stagger sutil de las grillas (servicios, barberos, galería).

```tsx
"use client";
import { useRef } from "react";
import { useGsapAnimation } from "@/hooks/useGsapAnimation";

export function ScrollReveal({ children, delay = 0, className }: ScrollRevealProps) {
  const ref = useRef<HTMLDivElement>(null);

  useGsapAnimation(
    ({ gsap }) => {
      gsap.from(ref.current, {
        opacity: 0,
        y: 32,
        duration: 0.8,
        delay,
        scrollTrigger: { trigger: ref.current, start: "top 85%" },
      });
    },
    { scope: ref }
  );

  return <div ref={ref} className={className}>{children}</div>;
}
```

`Hero` es la única sección que no usa `ScrollReveal` — tiene su propio
timeline con stagger (eyebrow → título → subtítulo → CTAs) al montar, ya
que siempre está visible de entrada.

### Ejemplo: dividir texto con SplitText

```tsx
useGsapAnimation(({ gsap }) => {
  const split = SplitText.create(headingRef.current, { type: "chars" });
  gsap.from(split.chars, { opacity: 0, y: 20, stagger: 0.02 });
}, { scope: headingRef });
```

(`SplitText` se importa desde `@/lib/gsap/gsap`, igual que `gsap`.)

## Supabase

La fuente de verdad del diseño es el documento "Barberías SaaS —
Arquitectura de datos, Auth y RLS". El esquema vive como migraciones
versionadas en `supabase/migrations/` y se aplica con la CLI de Supabase
(`npm run db:reset` recrea la base local desde cero).

**Implementado:** las 13 tablas del MVP (`plans`, `tenants`, `profiles`,
`tenant_members`, `barbers`, `barber_compensation`, `services`,
`business_hours`, `barber_working_hours`, `schedule_blocks`, `clients`,
`appointments`, `appointment_services`), los enums `member_role`,
`appointment_status` y `appointment_source`, FKs compuestas
`(tenant_id, id)` entre tablas de una misma barbería, la restricción de
exclusión que impide la doble reserva, y RLS **activado sin políticas** en
todas las tablas (nadie lee nada hasta que existan). El rol `anon` no tiene
privilegios sobre ninguna tabla.

**Pendiente (pasos siguientes del plan):** políticas RLS, funciones de
`private` (`is_member`, `is_admin`, `my_barber_id`), triggers de negocio
(alta de perfil, último admin, límites de plan, transiciones de estado,
copia de comisión y congelado de líneas), funciones públicas y Auth en la
app (`@supabase/ssr`).

`src/lib/supabase/client.ts` expone `getSupabaseClient()`, tipado con
`Database` (`src/types/supabase.ts`, **generado**: no editar a mano; se
regenera con `npm run db:types`). Devuelve `null` si las variables de
entorno no están configuradas.

## Contenido vs. presentación (plantilla multi-tenant)

`src/types/content.ts` define `TenantContent`: el contrato completo de
contenido de una landing (nav, hero, propuesta de valor, servicios,
barberos, galería, horarios, ubicación, CTA de reserva, footer) — ningún
tipo ahí menciona "Kings". `src/data/tenants/kings.ts` es el único archivo
de todo el proyecto que exporta un `TenantContent` real con el contenido
(hoy demo) de Barbería Kings.

Ningún componente en `components/` importa `kings.ts`. Todos —
`Navbar`, `Footer`, y cada sección en `components/sections/` — reciben su
contenido ya resuelto por props. El único archivo que decide qué tenant se
renderiza es `src/app/(public)/page.tsx`, con un `import { kingsTenant }`
fijo.

Para agregar una segunda barbería hoy mismo: crear
`src/data/tenants/<slug>.ts` con la misma forma `TenantContent` — ningún
componente cambia. Lo que sí sigue pendiente (no implementado) es **cómo
se resuelve** qué tenant mostrar en cada request, entre al menos:

- Subdominio por barbería (`kings.barberias.app`).
- Slug en la URL — `(public)/[slug]/page.tsx` puede coexistir con
  `(public)/page.tsx` sin conflicto (uno resuelve `/`, el otro
  `/cualquier-slug`), así que no hace falta mover nada cuando se
  implemente.

Esa decisión afecta a `middleware.ts` (que hoy no existe) y se deja para
cuando haya una segunda barbería real con la que validar el enfoque. La
raíz `/` sirviendo directamente a Kings es una simplificación deliberada de
esta etapa, no la arquitectura final — cuando el SaaS necesite su propia
página de marketing, probablemente se quede con la raíz y Kings pase a su
propio slug/subdominio.

### Contenido demo — `data/tenants/kings.ts`

Barbería Kings todavía no dio su contenido real, así que todo lo que hay en
ese archivo es de ejemplo. Precios, nombres de barberos, dirección,
teléfono, horarios y redes sociales están marcados explícitamente como
"(demo)" / "por confirmar" — tanto en el código como en lo que se renderiza
en pantalla — para que no se confundan con datos reales. La landing además
muestra un aviso visible arriba del todo ("Vista previa — contenido de
muestra..."). Ambas cosas se quitan cuando Kings confirme su contenido.

## Qué falta a propósito

- Contenido real de Barbería Kings (precios, barberos, dirección, teléfono,
  horarios, redes sociales, fotos) — hoy todo es demo, ver arriba
- Reviews (no contemplada en esta etapa de la landing)
- SplitText, parallax, pinning, scroll horizontal o transiciones de
  página — llegan después, con criterio, si hace falta
- Imágenes reales (hoy son placeholders visuales, ver
  `ImagePlaceholder.tsx`)
- Autenticación
- Tablas y esquema de Supabase
- Lógica de reservas real (el CTA "Reservar cita" hoy navega a `#reservar`
  dentro de la misma landing, no a una ruta)
- Dashboard administrativo
- Resolución real de multi-tenant (subdominio vs. slug, ver arriba) —
  hoy `(public)/page.tsx` sirve un único tenant fijo (Kings)

Cada uno de estos puntos se construye como su propio siguiente paso, sobre
esta misma base.
