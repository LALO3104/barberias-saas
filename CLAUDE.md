@AGENTS.md

# Barberías SaaS — guía para Claude Code

SaaS multi-tenant para barberías: landing pública por barbería con reservas en
línea, y un dashboard para administrar barberos, servicios, horarios y citas.
Primer cliente: **Barbería Kings** (slug `kings`).

- Repositorio: `LALO3104/barberias-saas` (rama principal `main`).
- Supabase: proyecto `ncirywuyzeoyqhtlmisj`.
- Desarrollo en Windows (`cmd`). Los avisos de Git "LF will be replaced by
  CRLF" son normales.

`ARCHITECTURE.md` explica el sistema visual, GSAP y la separación contenido /
presentación, pero sus secciones sobre Supabase, reservas y dashboard como
"futuro" están **desactualizadas**: todo eso ya existe (ver abajo).

---

## Stack y comandos

Next.js 16 (App Router, Server Actions, `src/proxy.ts` en lugar de
middleware) · React 19 · TypeScript · Tailwind CSS v4 · GSAP · Supabase
(Postgres + Auth + RLS).

```
npm run dev         # servidor local
npm run lint        # ESLint
npm run typecheck   # next typegen && tsc --noEmit
npm run build       # build de producción
```

Antes de dar un trabajo por terminado: `lint`, `typecheck` y `build` deben
pasar.

**No ejecutes** `npm run db:types:remote` ni `db:types`: sin token de la CLI
sobrescriben `src/types/supabase.ts` con un error. Ver "Tipos".

---

## Mapa del código

```
src/app/
  (public)/page.tsx            landing raíz (demo)
  [slug]/page.tsx              landing pública de cada barbería (/kings)
  (auth)/                      login, forgot/reset password, callback
  (dashboard)/layout.tsx       sesión + membresía obligatorias; nav por rol
  (dashboard)/dashboard/
    page.tsx                   inicio (tarjeta "Citas de hoy")
    barberos/  servicios/      admin
    horarios/                  admin (barbería + barberos) / barbero (su horario)
    citas/                     admin "Citas" / barbero "Mi agenda" (misma ruta)
src/lib/
  auth.ts                      getAuthenticatedUser() → activeMembership {tenantId, role}
  supabase/server.ts client.ts cliente con sesión del usuario (RLS)
  supabase/admin.ts            service_role — NO usar (ver reglas)
  appointments.ts              estados, transiciones, fechas en zona del tenant
  schedule.ts format.ts        horarios, formatos, getTodayInTimezone()
  public-api.ts                RPC públicas desde el navegador (reserva)
  dashboard-nav.ts             menú por rol
src/components/                ui/ (primitivos), dashboard/*, public/*, sections/, animations/
src/types/supabase.ts          tipos generados de la base
supabase/migrations/           14 migraciones (fuente de verdad del esquema)
supabase/tests/                pruebas SQL (solo base local)
```

---

## Reglas de seguridad (no negociables)

1. **Tenant y rol salen del servidor, nunca del cliente.** Siempre de
   `getAuthenticatedUser(supabase)` → `activeMembership.tenantId` / `.role`
   (que vienen de `tenant_members`). Nunca de formularios, query params,
   JWT metadata ni props.
2. **No usar `service_role`** (`getSupabaseAdmin`) en flujos del dashboard ni
   públicos. Todo pasa por el cliente con la sesión del usuario y RLS. Si una
   tarea parece necesitarlo, detente y pregunta.
3. **RLS siempre activo.** Nunca desactivarlo ni "abrir" una política para que
   algo funcione.
4. **Autorización en capas:** Server Action + RLS + SQL (funciones, triggers,
   permisos por columna). Ocultar un botón en React no es seguridad.
5. **Server Actions:** reciben `unknown`, validan todo (UUIDs, enums, rangos,
   longitudes), filtran por `tenant_id` del contexto y actualizan con objetos
   de campos explícitos. Nunca `.update(formData)` ni pasar objetos del
   cliente directo a la base. Patrón de referencia:
   `dashboard/barberos/actions.ts` (`getAdminContext`) y
   `dashboard/citas/actions.ts`.
6. **No tocar secretos:** ni `.env*` (salvo `.env.local.example` si se pide),
   ni claves en el código, ni exponer `SUPABASE_SERVICE_ROLE_KEY` como
   `NEXT_PUBLIC_*`.

---

## Base de datos y migraciones

- **Todo cambio de esquema = una migración nueva** en `supabase/migrations/`,
  nombre `YYYYMMDDHHMMSS_descripcion.sql` (posterior a la última).
- **Nunca editar migraciones existentes**, ni hacer squash, ni reordenar.
- **Nunca aplicar nada al Supabase remoto.** Eduardo aplica cada migración a
  mano en el SQL Editor. Prohibido `supabase db push`, `db reset` o
  `apply_migration` contra el proyecto real. El historial remoto de
  migraciones está desincronizado (9 registradas vs 14): no intentar
  "arreglarlo" sin que se pida.
- Verificar el remoto solo con consultas de lectura.

### Convenciones SQL

- Funciones con `set search_path = ''` y nombres totalmente calificados
  (`public.x`, `private.x`, `auth.uid()`).
- Helpers de autorización en `private`: `is_member(tenant)`,
  `is_admin(tenant)`, `my_barber_id(tenant)`. En políticas, envolverlos en
  `(select ...)`.
- `SECURITY DEFINER` solo con validaciones explícitas adentro; preferir
  `SECURITY INVOKER` para que RLS aplique. Revocar `EXECUTE` de `public` /
  `anon` y otorgar solo a quien lo necesita.
- Integridad multi-tenant con **FKs compuestas `(tenant_id, id)`**.
- Fechas en `timestamptz`; "un día" es el día local de `tenants.timezone`.
- Dinero en centavos (`price_cents`), comisiones en puntos base (`*_bps`).
- Teléfonos en E.164 (`private.normalize_phone_mx` normaliza la entrada).
- Catálogos no se borran: `is_active = false`. Citas no se borran: se cancelan.

### Códigos de error que la app traduce

| Código | Significado |
|---|---|
| `P0002` | no encontrado / fuera de alcance (sin distinguir) |
| `P0003` | horario ya ocupado (reserva) |
| `42501` | sin permiso / campo protegido |
| `23503` | referencia inexistente en esa barbería |
| `23514` | regla CHECK |
| `BA001` | transición de estado no permitida (o cambió mientras tanto) |
| `BA002` | motivo de cancelación faltante, vacío o > 500 |
| `BA003` | servicio inactivo |
| `BA004` | cita completada: sus servicios ya no cambian |

`P0003`/`P0004` están reservados por PostgreSQL (`P0004` no se puede capturar):
para errores propios usar la clase `BA0xx`.

### Citas (Steps 9 y 9.1)

- Estados: `pending → confirmed → completed`; `pending|confirmed →
  cancelled|no_show`. Finales: `completed`, `cancelled`, `no_show`.
  Lo hace cumplir el trigger `appointments_enforce_status_transition`.
- El único cambio de estado de la app es
  `changeAppointmentStatusAction` → `public.set_appointment_status`
  (SECURITY INVOKER, `FOR UPDATE`).
- `authenticated` **no tiene INSERT** en `appointments` y solo puede hacer
  UPDATE de `status` y `cancellation_reason`. Las citas nacen en
  `public.book_appointment` (reserva pública). Reprogramar, reasignar,
  walk-ins o editar cliente/nota requieren **funciones nuevas con sus
  propias validaciones**, no reabrir permisos.
- Auditoría inmutable para todos (incluido el SQL Editor): `id`, `tenant_id`,
  `source`, `created_*`, `completed_at`, `cancelled_*`.
- `appointment_services`: nombre/precio/duración siempre del catálogo,
  `commission_rate_bps` NULL al insertar, líneas de citas completadas
  bloqueadas, DELETE solo admin.

### Tipos

`src/types/supabase.ts` se genera desde el esquema. Si una migración agrega o
cambia funciones/tablas, pide a Eduardo regenerarlo (o usa el generador del
conector de Supabase) y reemplaza el archivo **completo**. Evita editarlo a
mano; si fuera inevitable, dilo en el reporte.

---

## Pruebas

- `supabase/tests/*.test.sql`: SQL plano, autocontenido, en una transacción
  con `ROLLBACK` y reporte PASS/FAIL. **Solo contra una base local o
  desechable**, nunca contra el remoto:
  `psql "<url-local>" -v ON_ERROR_STOP=1 -f supabase/tests/<archivo>.test.sql`
- Requiere un Postgres local con todas las migraciones (`supabase start`, o
  Postgres con roles `anon`/`authenticated`, `auth.users` y `auth.uid()`).
- Todo cambio de base de datos lleva pruebas, incluidos los casos negativos
  (otro barbero, otra barbería, sin sesión, API directa saltándose la app,
  concurrencia cuando aplique). Correr también las suites existentes.
- Si un cambio de comportamiento hace fallar una prueba antigua a propósito,
  ajusta la expectativa y explícalo en el reporte; nunca la borres para que
  pase.

---

## Interfaz

- Todo el texto de la UI en **español**. Estética dark luxury, mobile-first,
  sin scroll horizontal (probar ~390 px y ~820 px).
- Colores, tipografía y espaciado solo desde `src/styles/tokens.css`
  (`bg-background`, `text-muted`, `text-accent`, `p-[var(--spacing-card)]`…).
- Reutilizar componentes existentes (`ui/Dialog`, `ui/Button`, patrones de
  `dashboard/*`). GSAP solo vía `useGsapAnimation` y respetando
  `prefers-reduced-motion`.
- Fotos de usuario con `<img>` (URLs arbitrarias), no `next/image`.
- Fechas y horas siempre en la zona del tenant (helpers de
  `lib/appointments.ts` y `lib/format.ts`), nunca la del navegador.
- **No agregar dependencias** sin pedirlo.

---

## Forma de trabajar

1. Eduardo envía cada tarea como un "Step" con alcance y reglas. Si el Step
   dice "solo inspección", **no modificar nada**.
2. Inspeccionar antes de cambiar. Si algo exige un refactor grande o tocar la
   arquitectura existente, **detenerse y preguntar**.
3. **No ampliar el alcance** por iniciativa propia; reportar lo que se
   encuentre como pendiente.
4. Trabajar en una rama por Step (`step-<n>-<tema>`), nunca directo en `main`.
5. **No hacer commit, push ni merge sin permiso explícito** en ese Step.
6. Al terminar, reportar: archivos creados/modificados, migraciones, pruebas
   y resultados reales, `lint` / `typecheck` / `build`, pendientes y
   decisiones que Eduardo deba revisar. No inventar resultados.

---

## Pendientes conocidos (no corregir salvo que el Step lo pida)

- Historial de migraciones remoto desincronizado (9 vs 14); 6 funciones
  remotas difieren del repo solo en comentarios.
- `restrict_barber_self_update` bloquea cambios hechos desde la plataforma
  (auth.uid() nulo) y al quitar la membresía de un barbero.
- `trg_protect_last_admin` impide purgar una barbería que aún tiene admin.
- `my_barber_id` no revisa `is_active` (barbero desactivado conserva acceso).
- `activeMembership` toma la primera membresía sin orden fijo.
- Barbero ve y crea clientes de toda la barbería.
- Reservas públicas sin protección anti-spam ni límite de longitud en
  nombre/nota; el nombre del cliente se sobrescribe por teléfono.
- Citas `cancelled`/`no_show` aún aceptan servicios nuevos; agregar un
  servicio no alarga `end_at`.
- El admin puede ajustar precio/comisión de líneas de citas no completadas.
- Completar / "No se presentó" no esperan a la hora de la cita.
- Comisiones, walk-ins, reprogramación, reasignación, estadísticas: no
  existen todavía.
