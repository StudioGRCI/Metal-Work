---
name: seguridad
description: Convenciones de seguridad de Metal Work — RLS, revokes, secretos y cómo comprobar que una puerta quedó cerrada. Usar antes de escribir cualquier migración, política, función SQL o acción de servidor, y al revisar un diff por seguridad.
---

# Seguridad en Metal Work

El repositorio es **público**. La base tiene los datos reales de una empresa.
Esas dos frases juntas gobiernan todo lo demás.

## Lo que nunca entra al repositorio

- Contraseñas, claves de servicio, cadenas de conexión, correos de cuentas
  reales con su clave. `SUPABASE_SERVICE_ROLE_KEY` no se imprime, no se copia
  a documentos, no se pega en un commit ni en un PR.
- Documentos internos de la empresa (los del OneDrive). Se transcriben a
  migraciones o a `docs/` solo los datos que el sistema necesita, nunca el
  archivo entero.
- Identificadores de sesión o material de autenticación en capturas: revisar
  las capturas antes de subirlas.

## Toda tabla nueva paga el mismo peaje

En la misma migración que la crea, sin excepción:

1. `alter table ... enable row level security`
2. Políticas `select / insert / update / delete` explícitas. La de lectura
   respeta el alcance (`puede_ver_orden`, sede, o permiso); las de escritura
   exigen el permiso del módulo con `public.tiene_permiso('x.y')` o
   `public.es_admin()`.
3. `grant` solo a `authenticated`. **Nunca** a `anon` ni a `public`.
4. `perform public.activar_timestamps(tabla)` — y la tabla debe tener
   `actualizado_en`, porque el trigger se crea igual y revienta después si
   no está (nos pasó con `plantilla_ficha_lineas`).
5. `perform public.activar_auditoria(tabla)` si guarda datos de negocio.

## Toda función nueva

- `set search_path to 'public'` siempre (evita el secuestro de esquema).
- `security definer` solo si de verdad escribe por encima de RLS, y entonces:
  `revoke all on function ... from public, anon;` y `grant execute` solo a
  quien corresponda. Una función de trigger se revoca también a
  `authenticated` — la llama el sistema, no la gente.
- Dentro, el permiso se exige con `public.exigir_permiso('x.y')`, no se
  asume por quién la llama.
- Las vistas que agregan datos llevan `alter view ... set (security_invoker = on)`
  o filtran por sí mismas; una vista sin `security_invoker` corre como dueño
  y salta el RLS de sus tablas.

## Trampas que ya nos mordieron (no repetir)

- **El blindaje reescribe funciones.** `20260101000013_blindaje.sql` reescribe
  `fn_ot_despues_update` para que use la bitácora interna. Si otra migración
  vuelve a definir esa función con el texto original, reabre la guarda sin
  que nada avise. Regla: para engancharse a un evento de OT se crea un
  **trigger propio**, no se redefine el existente.
- **Revocar y devolver a ciegas.** Al barrer permisos con `revoke`, registrar
  antes `has_function_privilege` y devolver solo lo que existía
  (`20260101000022`): la primera versión reabrió `siguiente_correlativo`.
- **Funciones de extensión.** `unaccent`, `pg_trgm` y `btree_gist` viven en
  `public` pero no son nuestras: excluirlas por `pg_depend deptype 'e'` antes
  de tocar sus privilegios.
- **`test.debe_fallar` con INSERT…SELECT.** Si el `select` devuelve cero filas
  el insert «pasa» sin evaluar la política. Pasar los IDs por
  `set_config`/`current_setting` (psql no interpola `:'var'` dentro de `$$`).

## Cómo se comprueba

- `./scripts/db-test.sh` corre todos los checks; los de seguridad viven en
  `db/test/checks/40_seguridad.sql` y `98_puertas_cerradas.sql`.
- Cada módulo nuevo agrega a su check al menos: un usuario sin permiso que
  **no** ve y **no** escribe, y la escritura legítima que sí entra.
- La pauta del check de puertas: ninguna función ejecutable por `anon`,
  ninguna tabla con RLS apagado, ninguna vista `security definer` sin querer.

## Acciones de servidor (Next.js)

- Validar la entrada con `zod` antes de tocar la base; los UUID con
  `z.string().uuid()`.
- Exigir permiso con `exigirPermiso`/`puede` **al principio** de la acción,
  no confiar en que la pantalla escondió el botón.
- Los errores de Postgres pasan por `mensajeDeError` — no filtrar el mensaje
  crudo del motor al usuario.
- El navegador nunca recibe la clave de servicio: `src/lib/supabase/server.ts`
  es `server-only`.

## Cuentas y datos

- Las cuentas de demostración comparten clave: antes de uso real se cambian o
  desactivan, y se activa la protección de contraseñas filtradas en Supabase
  Auth. Esto está anotado en el PDF de pendientes del cliente.
