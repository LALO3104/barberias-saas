# Barberías

Base técnica de un SaaS para barberías. **Todavía no incluye** el diseño de
ningún cliente (p. ej. "Barbería Kings"), autenticación, tablas de Supabase
ni lógica de reservas — es intencional, ver `ARCHITECTURE.md`.

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

## Cómo comprobar que Next.js funciona

Con `npm run dev` corriendo, entra a `http://localhost:3000`. Si ves la
página "Proyecto inicializado correctamente", el servidor de desarrollo, el
App Router y Tailwind están funcionando. También puedes correr una build de
producción real:

```bash
npm run build
npm run start
```

Si ambos comandos terminan sin errores, el proyecto compila correctamente
(incluyendo TypeScript, ya que `next build` falla si hay errores de tipos).

## Cómo comprobar que GSAP quedó bien instalado

En la misma página de inicio, el bloque de texto entra con una animación de
fade + slide apenas carga la página. Esa animación:

- Viene de `src/components/animations/Reveal.tsx`, que usa el hook
  `useGsapAnimation` (`src/hooks/useGsapAnimation.ts`).
- Depende de que `src/lib/gsap/gsap.ts` haya importado `gsap` y registrado
  `ScrollTrigger` y `SplitText` sin errores.

Si la animación se ve, GSAP quedó bien instalado y registrado. Para
confirmarlo también desde la consola del navegador, con la página abierta:

```js
window.gsap; // debería existir y no ser undefined
```

Si activas "reducir movimiento" en tu sistema operativo y recargas, el
mismo texto debe aparecer **sin** animar — esa es la verificación de que se
está respetando `prefers-reduced-motion`.

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
