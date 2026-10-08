<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AGENTS.md — Reglas de trabajo para agentes

Repositorio de **Barberías SaaS**, sistema multi-tenant para administrar
barberías. Este archivo define cómo debe comportarse cualquier agente
(Claude Code, Codex, Cursor…). Lo específico del proyecto —arquitectura, mapa
del código, base de datos, citas, códigos de error, pendientes— está en
`CLAUDE.md`. Si ambos parecen contradecirse, gana la regla más restrictiva y
se reporta la contradicción.

El bloque de Next.js de arriba lo mantiene `next dev`: no editarlo ni
moverlo.

## 1. Antes de actuar

1. Leer `CLAUDE.md` y este archivo.
2. `git status` y `git branch --show-current`; no asumir un working tree
   limpio.
3. Inspeccionar los archivos relacionados y buscar implementaciones o
   patrones existentes antes de crear algo nuevo.
4. Revisar las pruebas que cubren el comportamiento.
5. Si toca la base de datos: revisar migraciones, funciones, triggers,
   policies y permisos involucrados.

Nunca implementar a partir de nombres de archivo, comentarios o suposiciones.

## 2. Alcance

Cada solicitud es un Step concreto: hacer solo lo necesario. No agregar
funcionalidades, refactors, correcciones ajenas, cambios de arquitectura, UI
no relacionada, actualizaciones de dependencias ni "mejoras" no pedidas, y
nunca tocar migraciones antiguas.

Un problema fuera de alcance no se corrige: se documenta, se explica por qué
importa y se continúa si es seguro.

## 3. Detenerse y preguntar

Antes de seguir, pedir autorización cuando:

- haya una ambigüedad funcional importante o varias soluciones con
  consecuencias distintas;
- haga falta un refactor grande o cambiar una decisión de arquitectura;
- haya que modificar una migración existente o datos históricos;
- haya que cambiar una regla de seguridad, ampliar permisos/RLS o usar
  `service_role`;
- haya que tocar el Supabase remoto.

Explicar el problema, por qué bloquea, las opciones, la recomendada y su
impacto. Nunca elegir en silencio algo que cambie el comportamiento del
producto.

## 4. Seguridad y aislamiento multi-tenant

Nunca reducir la seguridad para facilitar una implementación:

- no desactivar RLS ni crear policies permisivas;
- no confiar en datos del cliente, y menos en un `tenant_id` enviado por él;
- no saltarse la autorización en Server Actions ni usar `service_role` como
  atajo;
- no ampliar permisos "para que funcione" sin revisar la arquitectura;
- no exponer, imprimir ni subir al repositorio secretos (passwords, tokens,
  API keys, service role keys), ni convertirlos en variables públicas.

La UI no es una barrera: la seguridad se valida en la aplicación **y** en
PostgreSQL. Una operación que funciona para el tenant actual pero permite
llegar a otro es un fallo crítico.

Si el cambio toca RLS, permisos, Server Actions, funciones SQL o datos de
negocio (citas, clientes, barberos, servicios, pagos, comisiones), evaluar
explícitamente: usuario de otra barbería, otro barbero, usuario sin permisos
o desactivado, UUID o `tenant_id` manipulados, campos protegidos, llamada
directa a la API o a una función SQL, y concurrencia.

## 5. Base de datos y Supabase remoto

- Todo cambio estructural = migración nueva. Nunca editar, reordenar, hacer
  squash ni reutilizar timestamps; nunca alterar el esquema a mano "para
  probar"; nunca crear migraciones artificiales para corregir el historial.
- Las migraciones deben poder aplicarse desde cero y van acompañadas de
  pruebas.
- Por defecto se trabaja solo con el repositorio y una base local o
  desechable. **No modificar el Supabase remoto**: nada de `supabase db
  push`, `migration up`, `db reset`, `apply_migration` o equivalentes; no
  modificar ni borrar datos reales; no correr pruebas destructivas contra
  producción. Solo con petición explícita del usuario en la tarea actual.

## 6. Git

- Cada Step en su rama `step-<n>-<tema>`, creada desde `main` actualizado.
  Nunca trabajar directo en `main`.
- `git commit`, `git push` y `git merge` solo con autorización explícita en
  el Step actual; terminar un Step no implica permiso.
- Nunca `git reset --hard`, `git checkout --`, `git clean` ni nada que pueda
  eliminar trabajo local.
- Si hay cambios locales que no creó la tarea actual: detenerse y preguntar.
  Nunca asumir que se pueden descartar.

## 7. Cambios de código

- **Mínima modificación:** el cambio más pequeño que cumpla la tarea, con
  pruebas específicas. Antes de editar, leer el archivo, entender sus
  dependencias y quién lo usa. No reemplazar archivos completos si basta un
  cambio pequeño; no refactorizar código estable por estilo.
- **Archivos generados:** no editarlos a mano si existe un procedimiento
  oficial para regenerarlos.
- **Server Actions:** toda entrada del cliente es no confiable. Validar
  tipos, UUIDs, enums, números, rangos, longitudes, permisos, tenant y estado
  actual del recurso. Sin mass assignment: solo campos explícitos, nunca
  pasar objetos del cliente a la base.
- **Funciones SQL:** antes de crear una, buscar si ya existe una equivalente
  (aunque se llame distinto) y revisar `EXECUTE`, `SECURITY INVOKER/DEFINER`,
  `search_path`, aislamiento por tenant y comportamiento bajo RLS.
- **Errores:** no ocultarlos (`catch {}` vacío) ni devolver éxito si algo
  falló. Conservar información útil, sin secretos, respetando los códigos de
  error del proyecto y traduciéndolos en la capa correcta.
- **UI:** reutilizar `src/components/ui` y los patrones del dashboard; no
  introducir estilos ajenos al sistema. Responsive, mobile-first, accesible,
  textos en español. La funcionalidad va antes que la animación.
- **Dependencias:** ninguna nueva sin autorización. Primero comprobar si lo
  instalado o una API nativa basta, y explicar necesidad e impacto.

## 8. Pruebas y verificación

"Compila" no es "terminado". Según el cambio, correr pruebas SQL, `lint`,
`typecheck` y `build`, cubriendo caminos correctos e incorrectos, permisos,
aislamiento multi-tenant, API directa, estados inválidos, datos maliciosos y
concurrencia cuando aplique.

- Reportar cada verificación como `PASS`, `FAIL` o `NOT RUN`. Un `NOT RUN`
  nunca se convierte en `PASS`.
- Nunca borrar una prueba para que la suite pase; si un cambio intencional
  la invalida, ajustar la expectativa y explicarlo.
- Nunca afirmar sin haberlo comprobado que una prueba pasó, una migración se
  aplicó, una consulta se ejecutó, un build funcionó, un commit o push
  existe, o que Supabase está sincronizado. Solo resultados observados.

## 9. Reporte al terminar

- **Cambios:** qué se hizo y qué no; archivos creados, modificados y
  eliminados.
- **Base de datos:** migraciones; tablas, funciones, triggers, policies y
  permisos tocados.
- **Seguridad:** RLS afectado, validaciones nuevas, escenarios de abuso
  revisados.
- **Pruebas y calidad:** qué se ejecutó y con qué resultado (`lint`,
  `typecheck`, `build`, SQL), incluidos los `NOT RUN`.
- **Git:** rama, estado del working tree, commit actual y si hubo commit,
  push o merge.
- **Pendientes** fuera de alcance y **decisiones** que requieran
  confirmación.

## 10. Prioridades y regla final

Ante un conflicto, en este orden:

**seguridad > integridad de datos > aislamiento multi-tenant > correctitud
funcional > pruebas > mantenibilidad > rendimiento > UI y animaciones.**

Nunca sacrificar una prioridad superior por una inferior. Entre una solución
rápida y permisiva y una explícita y segura, elegir la segura y detenerse si
requiere una decisión de producto.

**Inspeccionar antes de modificar. No asumir. No inventar. No ampliar el
alcance. No destruir trabajo existente. No reducir la seguridad. No modificar
el Supabase remoto ni hacer commit, push o merge sin autorización explícita.
Ante una decisión importante poco clara, detenerse y preguntar.**
