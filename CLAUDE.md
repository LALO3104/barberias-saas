@AGENTS.md

# Barberías SaaS — contexto del proyecto

Las reglas generales de comportamiento (alcance, cuándo detenerse,
seguridad, Git, pruebas, reporte, prioridades) están en `AGENTS.md`, que se
carga arriba. Aquí va lo específico de este proyecto.

SaaS multi-tenant para barberías: landing pública por barbería con reservas en
línea y dashboard privado para administrar barberos, servicios, horarios y
citas. Primer cliente real: **Barbería Charly's** (`/charlys`), que reemplazó a la
demo Barbería Kings en producción.

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
8 (horarios), 9 (agenda/citas), 9.1 (hardening de citas), 10.1 (ocupación,
varios servicios por cita, horarios cada 5 min), 10.2 (app "Mi barbería" para
el teléfono), 10.3 (walk-ins), 11 (mover citas), 12 (cobro manual), 13 (comisiones y pagos a barberos), 14 (avisos por WhatsApp), 15 (clientes y estadísticas), 16 (blindaje y publicación), 17 (cuentas y WhatsApp de barberos).

## 2. Stack y comandos

Next.js 16 (App Router, Server Actions, `src/proxy.ts` en lugar de
middleware) · React 19 · TypeScript · Tailwind CSS v4 · GSAP · Supabase
(Postgres, Auth, RLS).

```
npm run dev | lint | typecheck | build      # typecheck = next typegen && tsc --noEmit
npm run cf:build | cf:preview | cf:deploy   # Cloudflare (OpenNext), ver §12
```

`build` puede fallar en entornos sin red al descargar Inter/Playfair Display
de Google Fonts: es un fallo externo, no del código; reportarlo así.

## 3. Mapa del código

```
src/app/
  (public)/page.tsx               redirige a /charlys
  [slug]/page.tsx                 landing pública por barbería (/charlys)
  [slug]/privacidad/page.tsx      aviso de privacidad con los datos de la barbería
  (auth)/                         login, forgot/reset password, callback, invitacion/[token]
  (dashboard)/layout.tsx          exige sesión + membresía; nav por rol; manifest PWA
  pwa/icon/[size]/route.tsx       íconos de la app instalable (192, 512, maskable, apple)
  (dashboard)/dashboard/
    page.tsx                      inicio (tarjeta "Citas de hoy")
    barberos/  servicios/         solo admin
    horarios/                     admin: barbería y barberos · barber: su horario
    citas/                        admin "Citas" · barber "Mi agenda" (misma ruta)
    ganancias/                    admin "Ganancias" (reporte + pagos) · barber "Mis ganancias"
    ajustes/                      admin "Mi barbería": ubicación, WhatsApp, mensajes · barber "Mi perfil": tarjeta pública, WhatsApp
    clientes/  clientes/[id]/     admin "Clientes" · barber "Mis clientes" (ficha, notas, historial)
    estadisticas/                 admin "Estadísticas" · barber "Mis estadísticas"
src/lib/
  auth.ts                         getAuthenticatedUser() → activeMembership {tenantId, role}
  supabase/server.ts, client.ts   clientes con la sesión del usuario (RLS)
  supabase/admin.ts               service_role — NO usar (§4)
  appointments.ts                 estados, transiciones, fechas en zona del tenant
  schedule.ts, format.ts          horarios, formatos, getTodayInTimezone()
  public-api.ts                   RPC públicas de la reserva (desde el navegador)
  dashboard-nav.ts                menú por rol
  whatsapp.ts                     plantillas, variables y enlaces wa.me
  clients.ts                      forma del JSON de get_clients y get_business_stats
  maps.ts                         lee enlaces de Google Maps; URLs del mapa incrustado
  periods.ts                      periodos día/semana/mes (fechas locales)
src/components/                   ui/, dashboard/*, public/*, sections/, animations/
  dashboard/MobileNav.tsx         teléfono: cabecera + barra inferior + panel "Más"
  dashboard/Sidebar.tsx           escritorio (lg+)
  dashboard/pwa.tsx               registro del service worker, aviso sin conexión, instalar app
public/manifest.webmanifest, sw.js, offline.html   app "Mi barbería" (solo personal)
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
Desde Step 10.1 Eduardo autoriza que el agente las aplique: probarlas antes en
una base local (§9), pre-chequeo de solo lectura, aplicar cada archivo en una
transacción explícita con `npx supabase db query --linked -f <archivo>`
(`begin;` … `commit;` alrededor) y verificar con consultas de lectura. Nunca
`supabase db push` ni la herramienta `apply_migration` (registran en
`schema_migrations`). Ante dudas, preguntar a Eduardo.

**Historial remoto desincronizado** (repo: 28 migraciones, todas aplicadas;
registradas en el remoto: 9; además algunas funciones difieren del repo solo
en comentarios).
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
nacen en `public.book_appointment` (reserva pública) o `public.create_walk_in`
(personal). Otras formas de crear citas requieren una función nueva y segura.
No reabrir INSERT.

**Walk-ins (Step 10.3):** `create_walk_in` (SECURITY DEFINER): `confirmed`,
`source = walk_in`, hora exacta de HOY (zona del tenant), 1 a 5 servicios;
admin → barbero activo de su barbería, barbero → solo él
(`private.walk_in_tenant`). Traslape, fuera de horario o bloqueo → `BA007`
con `detail` JSON (`warnings`, `conflicts`); con `_acknowledge_warnings` se
registra y los avisos quedan en `overrides`/`overrides_at`/`overrides_by`.
`appointments_no_overlap` excluye solo las citas con `'overlap'` aceptado, por
eso toda función que cree o mueva citas debe tomar `lock_barber_agenda` y
revalidar con `overlaps_active_appointment` (que sí las ve). El cliente
existente por teléfono conserva su nombre (`find_client_by_phone`).

**Mover citas (Step 11):** `move_appointment` (SECURITY DEFINER) cambia hora,
barbero y servicios en una operación. Admin → cualquier cita de su barbería;
barbero → sus propias citas, también hacia otro barbero activo. Solo
`pending`/`confirmed` (BA008, también en el trigger para cualquier ruta); a
hoy o después; avisos → `BA007` como los walk-ins. Toma el lock de agenda de
origen y destino (orden fijo). Las líneas que siguen conservan su snapshot,
las nuevas toman el catálogo; `end_at` = suma de las líneas. Cada movimiento
queda en `appointment_changes` (solo lectura por API).

**Cobro (Step 12):** se cobra al completar. `charge_appointment` (SECURITY
DEFINER) completa la cita confirmada y registra el cobro en la misma
transacción, o cobra de nuevo una completada cuyo cobro se anuló. Cobro =
`appointment_charges` (subtotal = suma de las líneas, descuento con motivo
opcional, propina, total; `barber_id` de quien atendió) + `charge_payments`
(uno por método: `cash`, `card`, `transfer`; deben sumar el total; total 0 =
cortesía sin pagos). Admin → su barbería; barbero → sus citas. Inmutables:
solo el admin anula con `void_charge` (motivo obligatorio). El trigger
diferido `appointments_require_charge` impide, por cualquier ruta, que una
cita pase a `completed` sin cobro activo al confirmar la transacción (BA010):
"Completar" sin cobro ya no existe. Las citas completadas antes de este Step
no tienen cobro y se pueden registrar desde la agenda.

**Comisiones (Step 13):** el admin configura por barbero en
`barber_compensation` comisión (`commission_rate_bps`) o salario fijo
(`salary_cents` + `salary_period` semanal/quincenal/mensual). Al cobrar,
`charge_appointment` congela en el cobro `pay_type`, `commission_rate_bps` y
`commission_cents` = (subtotal − descuento) × tasa, redondeado; la propina es
100 % del barbero y no lleva comisión. Cambiar la configuración no altera cobros
anteriores; los cobros previos al Step o sin configuración tienen comisión NULL.
Pagos = `barber_payouts` (periodo en fechas locales, comisión y propinas
calculadas de los cobros activos del periodo, salario capturado; inmutables,
sin traslape por barbero → BA011). Solo el admin registra
(`record_barber_payout`) y anula (`void_barber_payout`, motivo obligatorio);
el barbero solo ve los suyos. Pantalla `/dashboard/ganancias`.

**WhatsApp (Step 14):** sin API ni costo: enlaces `wa.me` con texto ya escrito
(`lib/whatsapp.ts`). En la agenda, botón WhatsApp por cita (confirmación,
recordatorio, cambio de horario; cancelación si está cancelada), editable antes
de enviar. Al terminar una reserva pública, botón para escribir a
`tenants.public_phone`. Plantillas en `tenants.message_templates` (solo las
personalizadas; claves `confirm|reminder|cancel|reschedule`, ≤ 1000, no se
exponen en la página pública). Número y plantillas solo se cambian con
`update_tenant_messaging` (admin; normaliza el teléfono); `authenticated`
sigue sin UPDATE sobre esas columnas.

**Clientes (Step 15):** `clients_select`: el admin ve a todos; el barbero solo a
quienes tienen o tuvieron cita con él (la cartera no se expone si se va).
`get_clients` y `get_business_stats` son INVOKER: RLS define el alcance, y para
el barbero los números son solo de sus citas y cobros. Notas internas con
`set_client_note` (admin o barbero que lo atendió; ≤ 1000); nombre y teléfono con
`update_client` (solo admin; teléfono de otro cliente → BA012).

**Estadísticas (Step 15):** `get_business_stats`: citas por `start_at`, cobros por
`created_at`, salarios por `paid_at`. Ganancia = cobrado − comisiones − propinas −
salarios pagados (sin gastos; `profit_cents` null para el barbero). Lo que suma
muchas filas va en SQL o por páginas: PostgREST corta cada consulta en 1000 filas.

**Cuentas de barberos (Step 17):** el admin toca "Invitar" (`create_barber_invite`,
solo barberos activos sin cuenta) y comparte `/invitacion/<token>`: un solo uso, 7
días, se guarda solo el hash, y otro enlace revoca el anterior. El barbero crea
correo y contraseña; `accept_barber_invite` lo vuelve miembro `barber` y liga
`barbers.user_id` (el trigger de autoedición solo lo permite con invitación
canjeada). Una cuenta que ya es miembro → BA014. El registro abierto de Supabase
no da acceso a nada: sin invitación no hay membresía. WhatsApp del barbero en
`barbers.whatsapp_phone` (`set_barber_whatsapp`: admin o él mismo). No está en la
página pública: `book_appointment` lo devuelve solo tras reservar con él, y el
botón final del cliente le escribe a él (si no, a `tenants.public_phone`).

**Ubicación y fotos (Step 17):** la dirección pública solo cambia con
`update_tenant_location` (admin). El punto del mapa va en `tenants.map_query`: se
saca del enlace de Compartir de Google Maps (`lib/maps.ts`; el servidor solo sigue
dominios de Google) y se muestra con un iframe sin clave de API, que no es una
interfaz oficial documentada. Mover un pin dentro de la app exigiría una clave con
tarjeta. `barbers.photo_url` solo acepta `https://`. El
barbero edita su tarjeta pública (nombre, puesto, descripción, foto) con su sesión
(RLS + trigger, que le impiden tocar `is_active`, `sort_order`, `tenant_id` y
`user_id`); límites 80/80/300 también en la base. El admin edita cualquiera.

**UPDATE:** `authenticated` solo puede actualizar `status` y
`cancellation_reason`. Todo lo demás (`id`, `tenant_id`, `barber_id`,
`client_id`, `start_at`, `end_at`, `source`, `client_note`, `created_*`,
`completed_at`, `cancelled_*`) no es editable por API, ni siquiera por el
admin. Reprogramar y reasignar van por `move_appointment`; editar
cliente/nota exigiría otra función específica; nunca ampliar el UPDATE general.

**Auditoría inmutable para todos** (incluido el SQL Editor): `id`,
`tenant_id`, `source`, `created_at`, `created_by`, `completed_at`,
`cancelled_at`, `cancelled_by`, `occupied_until`. `overrides` solo cambia al
mover la cita, y su marca (`overrides_at`/`_by`) la fija el trigger. El motivo
de cancelación es obligatorio al cancelar (sin vacíos ni solo espacios,
máximo 500) y no se reescribe después.

**`appointment_services`:** al insertar, el servicio debe existir, ser de la
misma barbería y estar activo; nombre, precio y duración salen del catálogo
(lo enviado se ignora) y `commission_rate_bps` nace NULL. Las líneas de una
cita completada no se insertan, modifican ni borran. UPDATE y DELETE solo
admin, en citas no completadas. Máximo 5 líneas por cita (BA006) y un
servicio a lo sumo una vez por cita (UNIQUE). No ampliar sin un Step específico.

**Ocupación (Step 10.1):** `end_at` = fin estimado (inicio + suma de
duraciones); `occupied_until` = hasta cuándo ocupa al barbero. Ocupación base
`min(D, max(D − 10 min, 10 min))` (margen fijo de 10 min); al completar antes
se acorta hasta `completed_at` (piso inicio + 1 min) y nunca crece. La calcula
el trigger `appointments_occupancy` con `private.appointment_occupied_until`;
es inmutable para todos. `appointments_no_overlap` usa
`[start_at, occupied_until)`.

**Reserva pública (Step 10.1):** `get_available_slots(…, _service_ids uuid[], …)`
y `book_appointment(…, _service_ids uuid[], …)`: 1 a 5 servicios, rejilla de
5 min en la zona del tenant, anticipación mínima de 15 min, lock por barbero
(`private.lock_barber_agenda`) antes de revalidar. Helpers privados
reutilizables para walk-ins: `resolve_booking_services`, `within_business_hours`,
`within_barber_hours`, `overlaps_schedule_block`, `overlaps_active_appointment`.
Anti-spam (Step 16): máximo 3 citas futuras activas por cliente en
`book_appointment` (BA013, con lock por cliente); nombre ≤ 120, nota ≤ 500. Solo
aplica a la reserva pública; el personal no tiene ese límite.

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
| `BA006` | más de 5 servicios en una cita |
| `BA007` | walk-in o movimiento con avisos: necesita confirmación del personal (`detail` JSON) |
| `BA008` | la cita ya no se puede mover (no está pendiente ni confirmada) |
| `BA009` | la cita no se puede cobrar (estado o ya tiene cobro activo) / cobro ya anulado |
| `BA010` | cita completada sin cobro activo (trigger diferido) |
| `BA011` | ya hay un pago a ese barbero que cubre parte del periodo |
| `BA012` | ya hay otro cliente con ese teléfono |
| `BA013` | reserva pública: ese cliente ya tiene 3 citas futuras activas |
| `BA014` | ese barbero ya tiene cuenta, o la cuenta ya es miembro de la barbería |

Errores propios nuevos: clase `BA0xx` (`P0004` es `assert_failure` y no se
puede capturar en PL/pgSQL).

## 9. Pruebas SQL

`supabase/tests/*.test.sql`: SQL plano, autocontenido, en una transacción que
termina en `ROLLBACK`, con reporte PASS/FAIL. **Nunca contra el remoto.**

```
psql "<url-local>" -v ON_ERROR_STOP=1 -f supabase/tests/<archivo>.test.sql
```

Requiere un Postgres local con todas las migraciones (`supabase start` con
Docker, o Postgres con roles `anon`/`authenticated`/`service_role`,
`auth.users` y `auth.uid()`). Sin Docker funciona PostgreSQL 17 portable (zip
de EDB) + PostgREST v14.5 en una carpeta temporal, sin instalar nada. Sin base
local, las pruebas SQL se reportan `NOT RUN`. En Windows, correr `psql` con
`PGCLIENTENCODING=UTF8` o los acentos de los archivos llegan deformados. Suites actuales:
`appointments_hardening`, `appointment_occupancy`, `multi_service_booking`,
`walk_ins`, `move_appointment`, `charges`, `commissions`, `whatsapp_settings`, `clients_stats`, `launch_hardening`, `barber_accounts`, `location_photos`;
las anteriores (Step 9, horarios, integridad) aún no están en el repo.

## 10. Interfaz

- **Primero el teléfono** (~390 px): el personal usa la app instalable "Mi
  barbería" (PWA, solo dashboard y login; las páginas públicas no se instalan).
  Navegación en barra inferior (`primary` en `dashboard-nav.ts`, máx. 3 + "Más"),
  `ui/Dialog` es panel desde abajo en teléfono, áreas seguras con
  `env(safe-area-inset-*)`, alturas con `dvh`/`svh`. El service worker nunca
  guarda páginas (traen datos de clientes): solo `/_next/static` y la página
  offline.
- Horas siempre en 24 h (`09:30`), en la zona del tenant.
- Curvas de movimiento en tokens (`ease-out`, `ease-in-out` en `tokens.css`);
  controles con estado `active:` al presionar.
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
- El barbero aún puede crear clientes por API directa (`clients_insert`); la app no lo usa.
- Reservas públicas: el límite por teléfono no frena números inventados (no hay
  captcha ni verificación); el nombre del cliente se sobrescribe por teléfono.
- Citas `cancelled`/`no_show` aún aceptan servicios; agregar un servicio por
  inserción directa (no por `move_appointment`) no extiende `end_at`.
- El admin puede ajustar precio/comisión de líneas no completadas.
- Completar / `no_show` no esperan a la hora de la cita.
- No existen todavía: registro de gastos del negocio. El orden se decide
  inspeccionando dependencias, no por suposición.
- Avisos de rendimiento de Supabase sin atender (no urgentes a esta escala):
  índices de llaves foráneas y `auth.uid()` sin `(select …)` en 4 policies.
- El aviso de privacidad es un texto base sin revisión legal.

## 12. Publicación (Step 16)

Publicado en https://barberias.barberias.workers.dev (Cloudflare Workers con
OpenNext + Supabase Free). El soporte de `proxy.ts` en
OpenNext es experimental: tras actualizar Next o el adaptador, probar con
`cf:preview` y con sesión iniciada. Vercel Hobby no permite uso comercial.

- `NEXT_PUBLIC_*` se fijan al compilar: `npm run cf:deploy` lee `.env.local`, y
  `NEXT_PUBLIC_SITE_URL` debe apuntar a la dirección pública.
- En Supabase (Authentication → URL Configuration), la dirección pública debe
  estar como Site URL y en Redirect URLs, o falla la recuperación de contraseña.
- Auth: "Confirm email" va desactivado (la invitación ya prueba quién es). El
  correo por defecto de Supabase solo llega a direcciones autorizadas del equipo y
  a 2 por hora: "Olvidé mi contraseña" no le llega a los barberos sin SMTP propio.
- Supabase Free: se pausa tras 7 días sin actividad (`keepalive.yml` lo evita visitando
  la página; si cambia la dirección, actualizarla ahí) y **no tiene respaldos automáticos**.
  Con clientes reales, recomendar Supabase Pro.
