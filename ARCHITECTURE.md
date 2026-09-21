# Arquitectura

Este documento explica el porqué de cada carpeta y los patrones que hay que
seguir al construir sobre esta base. Nada de lo descrito aquí como "futuro"
está implementado todavía — es intencional.

## Estructura de carpetas

```
src/
├── app/                    # Rutas (Next.js App Router)
│   ├── layout.tsx          # Layout raíz (fuentes, metadata, <html>/<body>)
│   ├── page.tsx            # Página de verificación técnica (temporal)
│   ├── globals.css         # Tailwind + reglas globales (prefers-reduced-motion)
│   ├── (public)/           # Futuro: sitio público de cada barbería
│   ├── (booking)/          # Futuro: flujo de reservas
│   └── (dashboard)/        # Futuro: panel administrativo
├── components/
│   ├── ui/                 # Primitivos genéricos (Button, Container, ...)
│   ├── layout/             # Header/Footer/Sidebar compartidos (vacío por ahora)
│   └── animations/         # Componentes Cliente que encapsulan animaciones GSAP
├── hooks/
│   ├── useGsapAnimation.ts       # Wrapper de @gsap/react + prefers-reduced-motion
│   └── usePrefersReducedMotion.ts
├── lib/
│   ├── gsap/gsap.ts         # Único punto de registro de plugins GSAP
│   ├── supabase/client.ts   # Cliente de Supabase (sin conectar todavía)
│   └── utils.ts             # Helper `cn()` para clases de Tailwind
├── types/
│   ├── supabase.ts          # Placeholder de los tipos que generará Supabase
│   └── tenant.ts            # Forma de datos para multi-tenant (futuro)
└── styles/                  # Reservada para CSS adicional (hojas por feature, etc.)
```

Los tres grupos de rutas — `(public)`, `(booking)`, `(dashboard)` — usan la
sintaxis de [route groups](https://nextjs.org/docs/app/building-your-application/routing/route-groups)
de Next.js: el paréntesis no aparece en la URL, solo sirve para organizar el
código por área de producto sin acoplar la ruta.

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

### Ejemplo: animación con ScrollTrigger

No hay ninguna todavía en el proyecto (para no inventar contenido), pero
así se vería un nuevo componente siguiendo el mismo patrón:

```tsx
"use client";
import { useRef } from "react";
import { useGsapAnimation } from "@/hooks/useGsapAnimation";

export function FadeInOnScroll({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useGsapAnimation(
    ({ gsap }) => {
      gsap.from(ref.current, {
        opacity: 0,
        y: 40,
        scrollTrigger: { trigger: ref.current, start: "top 85%" },
      });
    },
    { scope: ref }
  );

  return <div ref={ref}>{children}</div>;
}
```

### Ejemplo: dividir texto con SplitText

```tsx
useGsapAnimation(({ gsap }) => {
  const split = SplitText.create(headingRef.current, { type: "chars" });
  gsap.from(split.chars, { opacity: 0, y: 20, stagger: 0.02 });
}, { scope: headingRef });
```

(`SplitText` se importa desde `@/lib/gsap/gsap`, igual que `gsap`.)

## Supabase

`src/lib/supabase/client.ts` expone `getSupabaseClient()`, que lee
`NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` desde variables
de entorno y devuelve `null` si todavía no están configuradas. Cuando se
cree el proyecto real de Supabase:

1. Definir el esquema de base de datos (tablas de barberías, servicios,
   citas, etc. — todavía no existe ninguna).
2. Generar tipos con `supabase gen types typescript` y reemplazar el
   contenido de `src/types/supabase.ts`.
3. Decidir autenticación (Supabase Auth vs. otra opción) — hoy no hay nada
   de auth en el proyecto.

## Multi-tenant (futuro)

`src/types/tenant.ts` define la forma mínima de un tenant (una barbería),
pero **cómo se resuelve** el tenant en cada request todavía es una decisión
abierta entre, al menos:

- Subdominio por barbería (`kings.barberias.app`).
- Slug en la URL (`barberias.app/kings`).

Esa decisión afecta directamente a `middleware.ts` (que hoy no existe) y a
las rutas dentro de `(public)`, `(booking)` y `(dashboard)`, así que se deja
para cuando haya al menos una barbería real (Barbería Kings) con la que
validar el enfoque.

## Qué falta a propósito

- Autenticación
- Tablas y esquema de Supabase
- Lógica de reservas
- Dashboard administrativo
- Diseño y contenido de Barbería Kings (o cualquier barbería real)

Cada uno de estos puntos se construye como su propio siguiente paso, sobre
esta misma base.
