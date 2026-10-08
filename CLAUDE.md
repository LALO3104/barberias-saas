@AGENTS.md

# Barberías SaaS — contexto del proyecto

Las reglas generales de comportamiento (alcance, cuándo detenerse,
seguridad, Git, pruebas, reporte, prioridades) están en `AGENTS.md`, que se
carga arriba. Aquí va lo específico de este proyecto.

SaaS multi-tenant para barberías: landing pública por barbería con reservas en
línea y dashboard privado para administrar barberos, servicios, horarios y
citas. Primer cliente/demo: **Barbería Kings** (`/kings`).

- Repositorio `LALO3104/barberias-saas`, rama principal `main`. Quien
  autoriza commits, push, merge y cambios al remoto es **Eduardo**.
- Desarrollo en Windows (`cmd`). Los avisos de Git `LF will be replaced by
  CRLF` son normales.

## 1. Fuente de verdad

Prioridad: código del repo → `supabase/migrations/` → `supabase/tests/` →
`AGENTS.md` y este archivo → documentación histórica.

`ARCHITECTURE.md` sigue siendo válido para sistema visual, GSAP y separación
contenido/presentación, pero sus secciones que llaman "futuro" a Supabase,
reservas y dashboard están desactualizadas: todo eso ya existe.

El último commit y la última migración se consultan con `git log` y
`supabase/migrations/`; no asumirlos. Steps cerrados al escribir esta guía:
4 (landing + reservas), 5 (auth + dashboard), 6 (barberos), 7 (servicios),
8 (horarios), 9 (agenda/citas), 9.1 (hardening de citas).

## 2. Stack y comandos

Next.js 16 (App Router, Server Actions, `src/proxy.ts` en lugar de
middleware) · React 19 · TypeScript · Tailwind CSS v4 · GSAP · Supabase
(Postgres, Auth, RLS).

```
npm run dev | lint | typecheck | build      # typecheck = next typegen && tsc --noEmit
```

`build` puede fallar en entornos sin red al descargar Inter/Playfair Display
de Google Fonts: es un fallo externo, no del código; reportarlo así.

## 3. Mapa del código

```
src/app/
  (public)/page.tsx               landing raíz (demo)
  [slug]/page.tsx                 landing pública por barbería (/kings)
  (auth)/                         login, forgot/reset password, callback
  (dashboard)/layout.tsx          exige sesión + membresía; nav por rol
  (dashboard)/dashboard/
    page.tsx                      inicio (tarjeta "Citas de hoy")
    barberos/  servicios/         solo admin
    horarios/                     admin: barbería y barberos · barber: su horario
    citas/                        admin "Citas" · barber "Mi agenda" (misma ruta)
src/lib/
  auth.ts                         getAuthenticatedUser() → activeMembership {tenantId, role}
  supabase/server.ts, client.ts   clientes con la sesión del usuario (RLS)
  supabase/admin.ts               service_role — NO usar (§4)
  appointments.ts                 estados, transiciones, fechas en zona del tenant
  schedule.ts, format.ts          horarios, formatos, getTodayInTimezone()
  public-api.ts                   RPC públicas de la reserva (desde el navegador)
  dashboard-nav.ts                menú por rol
src/components/                   ui/, dashboard/*, public/*, sections/, animations/
src/types/supabase.ts             tipos generados del esquema (§6)
supabase/migrations/              esquema esperado (fuente de verdad)
supabase/tests/                   pruebas SQL (§9)
```

## 4. Seguridad en este proyecto

- **Tenant y rol:** siempre `getAuthenticatedUser(supabase)` →
  `activeMembership.tenantId` / `.role` (vienen de `tenant_members`). Nunca
  de formularios, query params, props ni JWT metadata.
- **`getSupabaseAdmin()` (`service_role`)** existe pero no se usa en ningún
  flujo; no introducirlo sin autorización explícita.
- **Server Actions de referencia:** `dashboard/barberos/actions.ts`
  (`getAdminContext`) y `dashboard/citas/actions.ts`.
- **Secretos:** no tocar `.env`, `.env.local`, `.env.production` (la
  plantilla es `.env.local.example`); `SUPABASE_SERVICE_ROLE_KEY` nunca como
  `NEXT_PUBLIC_*`.

## 5. Base de datos

**Migraciones:** `YYYYMMDDHHMMSS_descripcion.sql`, posteriores a la última.
**Eduardo aplica cada una a mano en el SQL Editor**; el agente solo verifica
el remoto con consultas de lectura.

**Historial remoto desincronizado** (repo: 14 migraciones; registradas en el
remoto: 9; además 6 funciones difieren del repo solo en comentarios).
Problema conocido: no tocar `schema_migrations` ni intentar corregirlo fuera
de un Step dedicado. Las migraciones del repo son el esquema correcto.

**Convenciones SQL:**
- `set search_path = ''` y nombres calificados (`public.x`, `private.x`,
  `auth.uid()`); obligatorio en `SECURITY DEFINER`.
- Helpers: `private.is_member(tenant)`, `private.is_admin(tenant)`,
  `private.my_barber_id(tenant)`; en policies, envueltos en `(select …)`.
- Preferir `SECURITY INVOKER`; `SECURITY DEFINER` solo con validaciones
  explícitas de tenant y permisos. Revocar `EXECUTE` de `public`/`anon` salvo
  que se necesite.
- Aislamiento con FKs compuestas `(tenant_id, id)`.

**Datos:**
- Fechas `timestamptz`; el negocio se interpreta en `tenants.timezone`, nunca
  en la zona del navegador (helpers en `lib/appointments.ts`,
  `lib/format.ts`, `lib/schedule.ts`).
- Dinero en centavos (`price_cents`), nunca floats; comisiones en puntos base
  (`*_bps`).
- Teléfonos en E.164; los normaliza `private.normalize_phone_mx` **dentro de
  SQL** (p. ej. en `book_appointment`). Es interna: la app no puede llamarla.
- Catálogos no se borran (`is_active = false`); citas no se borran (cambian
  de estado).

## 6. Tipos de Supabase

`src/types/supabase.ts` se genera del esquema. No ejecutar `npm run db:types`
ni `db:types:remote` sin autorización: sin la configuración correcta de la
CLI sobrescriben el archivo con un error. Si una migración cambia tablas o
funciones: avisar a Eduardo → regenerar con el procedimiento autorizado →
reemplazar el archivo completo → `typecheck`. Si hubo que editarlo a mano,
decirlo en el reporte.

## 7. Citas (Steps 9 y 9.1)

**Estados:** `pending → confirmed → completed`; `pending|confirmed →
cancelled|no_show`. Finales y sin reapertura: `completed`, `cancelled`,
`no_show`. Lo hace cumplir el trigger `appointments_enforce_status_transition`
en cualquier ruta.

**Cambio de estado:** único flujo de la app: `changeAppointmentStatusAction`
→ `public.set_appointment_status` (SECURITY INVOKER, `FOR UPDATE`). No
cambiar estados con UPDATE directo desde una Server Action.

**Creación:** `authenticated` no tiene INSERT en `appointments`; las citas
nacen en `public.book_appointment`. Walk-ins u otras formas de crear citas
requieren una función nueva y segura. No reabrir INSERT.

**UPDATE:** `authenticated` solo puede actualizar `status` y
`cancellation_reason`. Todo lo demás (`id`, `tenant_id`, `barber_id`,
`client_id`, `start_at`, `end_at`, `source`, `client_note`, `created_*`,
`completed_at`, `cancelled_*`) no es editable por API, ni siquiera por el
admin. Reprogramar, reasignar o editar cliente/nota exigen una función
específica; nunca ampliar el UPDATE general.

**Auditoría inmutable para todos** (incluido el SQL Editor): `id`,
`tenant_id`, `source`, `created_at`, `created_by`, `completed_at`,
`cancelled_at`, `cancelled_by`. El motivo de cancelación es obligatorio al
cancelar (sin vacíos ni solo espacios, máximo 500) y no se reescribe después.

**`appointment_services`:** al insertar, el servicio debe existir, ser de la
misma barbería y estar activo; nombre, precio y duración salen del catálogo
(lo enviado se ignora) y `commission_rate_bps` nace NULL. Las líneas de una
cita completada no se insertan, modifican ni borran. UPDATE y DELETE solo
admin, en citas no completadas. No ampliar sin un Step específico.

## 8. Códigos de error que la app traduce

| Código | Significado |
|---|---|
| `P0002` | no encontrado / fuera de alcance (sin distinguir) |
| `P0003` | horario ocupado |
| `42501` | sin permiso / campo protegido |
| `23503` | referencia inexistente en esa barbería |
| `23514` | regla CHECK |
| `BA001` | transición de estado no permitida (o cambió mientras tanto) |
| `BA002` | motivo de cancelación faltante, vacío o > 500 |
| `BA003` | servicio inactivo |
| `BA004` | cita completada: servicios bloqueados |

Errores propios nuevos: clase `BA0xx` (`P0004` es `assert_failure` y no se
puede capturar en PL/pgSQL).

## 9. Pruebas SQL

`supabase/tests/*.test.sql`: SQL plano, autocontenido, en una transacción que
termina en `ROLLBACK`, con reporte PASS/FAIL. **Nunca contra el remoto.**

```
psql "<url-local>" -v ON_ERROR_STOP=1 -f supabase/tests/<archivo>.test.sql
```

Requiere un Postgres local con todas las migraciones (`supabase start` con
Docker, o Postgres con roles `anon`/`authenticated`, `auth.users` y
`auth.uid()`). Sin base local, las pruebas SQL se reportan `NOT RUN`. Hoy el
repo solo contiene `appointments_hardening.test.sql`; las suites anteriores
(Step 9, horarios, integridad) aún no están en el repo.

## 10. Interfaz

- Estética dark luxury / premium barber studio, editorial y cinematográfica.
  Probar ~390 px y ~820 px, sin scroll horizontal.
- Solo tokens de `src/styles/tokens.css` (`bg-background`, `text-muted`,
  `text-accent`, `p-[var(--spacing-card)]`…); sin colores arbitrarios.
  Reutilizar `ui/Dialog`, `ui/Button`, `dashboard/*`.
- GSAP solo vía `useGsapAnimation` y respetando `prefers-reduced-motion`.
- Fotos de usuarios/barberos con `<img>`; no migrar a `next/image`.

## 11. Pendientes conocidos (no corregir salvo que el Step lo pida)

- Historial de migraciones remoto desincronizado (§5).
- `restrict_barber_self_update` bloquea cambios con `auth.uid()` nulo y al
  quitar la membresía de un barbero.
- `trg_protect_last_admin` impide purgar una barbería que aún tiene admin.
- `my_barber_id` no revisa `is_active`.
- `activeMembership` toma la primera membresía sin orden fijo.
- El barbero ve y crea clientes de toda la barbería.
- Reservas públicas sin anti-spam y con límites de longitud mejorables; el
  nombre del cliente se sobrescribe por teléfono.
- Citas `cancelled`/`no_show` aún aceptan servicios; agregar un servicio no
  extiende `end_at`.
- El admin puede ajustar precio/comisión de líneas no completadas.
- Completar / `no_show` no esperan a la hora de la cita.
- No existen todavía: walk-ins, reprogramación, reasignación, pagos/cobros,
  comisiones, estadísticas, ganancias, notificaciones. El orden se decide
  inspeccionando dependencias, no por suposición.
