---
name: datos
description: Cómo consultar y diagnosticar la base de datos viva de Metal Work — el proyecto Supabase de producción, el orden de diagnóstico, cómo comprobar RLS y rendimiento de verdad, y qué no hacer sobre datos reales. Usar al investigar el estado de los datos, depurar por qué una pantalla sale vacía, revisar índices o comprobar que una migración entró.
---

# Operar la base viva

`esquema` cubre **escribir** migraciones y probarlas. Esta skill cubre **mirar**
la base que ya está en marcha: la del proyecto Supabase de producción, con los
datos reales de la empresa dentro.

De ahí sale la única regla de partida: **leer es libre, escribir se piensa.** Un
`select` mal escrito cuesta unos segundos; un `update` sin `where` no tiene
vuelta atrás y borra el trabajo de gente que lo hizo a mano.

## El orden de diagnóstico

Salta pasos y acabarás adivinando. En orden, cada uno responde algo que el
siguiente da por sabido:

1. **`list_tables`** — la forma real del esquema. Antes de escribir cualquier
   `select`, para no inventar nombres de columna. Es también la primera respuesta
   a «¿esta tabla tiene RLS?».
2. **`execute_sql` con `SELECT`** — el estado de los datos. Siempre con `limit`;
   sobre tablas de movimientos o auditoría, siempre con filtro de fecha.
3. **`get_advisors`** — lo que Supabase ya sabe que está mal: RLS apagado,
   funciones con `search_path` suelto, vistas `security definer`, índices que
   faltan en claves foráneas. Correrlo **después de cada migración**: es la
   comprobación más barata que existe en este proyecto.
4. **`query_logs`** — solo cuando lo anterior no explica el síntoma. Sirve para
   ver el error que de verdad devolvió Postgres, no el que llegó a la pantalla.

Antes de aplicar nada: **`list_migrations`**. El historial del proyecto no usa
los mismos sellos de versión que `supabase/migrations/`, así que la única forma
de saber hasta dónde llegó es preguntárselo.

## Pantalla vacía: el diagnóstico que casi siempre acierta

Es el síntoma más frecuente y casi nunca es la consulta. Comprobar en este orden:

1. ¿La consulta devuelve filas **sin** RLS? Si no, el problema es el `where` o
   los datos, y ahí termina.
2. ¿Devuelve filas **con** el rol que usa esa pantalla? Si aquí se vacía, es RLS.
   Probar de verdad:

   ```sql
   set local role authenticated;
   select set_config('request.jwt.claims', '{"sub":"<id del usuario>"}', true);
   -- la consulta
   reset role;
   ```

3. ¿El permiso que la política exige lo tiene **algún** rol? Un permiso sin rol
   asignado es una puerta tapiada: la política es correcta, la tabla está llena y
   todo el mundo ve el vacío. Pasó con `configuracion.ver` y once catálogos.
4. ¿La columna está en el `select` explícito de `src/lib/datos/*`? Si no está en
   la consulta, no llega a la pantalla por muy bien que esté en la base.

Probar los pasos 2 y 3 **como ADMIN no vale**: entra por `es_admin()` y nunca
toca el permiso.

## Rendimiento

- La clave foránea sin índice es la causa número uno de una pantalla lenta aquí:
  cada listado cruza órdenes con clientes, unidades y etapas. `get_advisors` las
  señala.
- Antes de culpar a una consulta, `explain analyze` con datos reales. Sobre
  cuatro filas de demostración todo parece rápido.
- Los listados paginan en la base, no en el servidor: traer todo para mostrar
  veinte filas funciona hasta el día en que la empresa lleva tres años de OTs.

## Escribir sobre datos reales

Cuando haga falta tocar datos —no esquema— de producción:

- Primero el `select` con el mismo `where` que llevará la escritura, y mirar
  cuántas filas devuelve. Si el número sorprende, parar.
- Dentro de `begin; … rollback;` para ensayar; solo entonces `commit`.
- Nunca un `update` o `delete` sin `where`. Nunca un `delete` sobre un documento
  numerado: se anula (ver `esquema`).
- Las migraciones sí se aplican directamente al proyecto con `apply_migration`,
  y son idempotentes por convención: reaplicar no rompe.

## Después de tocar el esquema

1. `list_migrations` — confirmar que entró.
2. Un `select` contra los catálogos del sistema que compruebe el objeto nuevo
   (que la tabla existe, que tiene RLS, que la política está). Que la migración
   no diera error no significa que hiciera lo que se creía.
3. `get_advisors` — la puerta que se dejó abierta sin querer.
4. `./scripts/generar-tipos.sh` — si no, `src/types/database.ts` miente y
   TypeScript deja pasar columnas que no existen.

## Trampas

*(Sección viva: aquí se anota lo que salió mal al operar la base. Ver `aprender`.)*

- **`list_tables` sobre todo el esquema es caro en contexto.** Pedir solo los
  esquemas que hacen falta; casi siempre `public`.
- **Un `select` que devuelve cero filas no distingue** entre «no hay datos» y «el
  RLS los esconde». Son diagnósticos opuestos: separarlos siempre antes de
  concluir nada.

## Reglas de Postgres que no son de este proyecto

La skill `supabase-postgres-best-practices` (de Supabase, MIT, vendorizada en
`.claude/skills/`) trae 30 reglas de rendimiento con ejemplos: índices, planes,
bloqueos, paginación, N+1. Es un índice: se lee la regla concreta que hace falta
en `references/`, no el paquete entero.

Manda esta skill y `seguridad` cuando discrepen: aquella habla de un proyecto
Supabase genérico con políticas `auth.uid()`, y aquí el control de acceso va por
permisos de módulo (`tiene_permiso`, `es_admin`), que es otro modelo.
