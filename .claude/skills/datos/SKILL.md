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

## Lo que ya se midió (2026-08-28)

Está escrito para que nadie lo vuelva a medir, y sobre todo para no repetir una
conclusión falsa que ya se sacó una vez.

**El truco `(select …)` de Supabase aquí casi no aplica.** La recomendación
conocida —envolver `auth.uid()` en un subselect para que se evalúe una vez y no
por fila— **solo sirve si la expresión no depende de la fila**. Y cuando no
depende, Postgres ya la saca por su cuenta: el plan la muestra como
`One-Time Filter` y la función se llama una sola vez, esté envuelta o no.

De las 274 políticas de `public`, **234 solo llaman a `tiene_permiso('x.y')` o
`es_admin()` con argumento constante**: son independientes de la fila, Postgres
las iza solo, y envolverlas no cambiaría nada. Se llegó a afirmar lo contrario
mirando los archivos de migración con `grep`; el plan de ejecución lo desmintió.
**El catálogo y el `explain` mandan sobre el texto de las migraciones.**

Nótese que el advisor `auth_rls_initplan` de Supabase **nunca avisa de esto**:
solo inspecciona llamadas a `auth.*` y `current_setting`, no las funciones
propias. Para este proyecto su tablero es ciego por diseño.

**Dónde sí cuesta: las 24 políticas que llaman `puede_ver_orden(<columna>)`.**
Esa sí depende de la fila, así que no se puede izar de ninguna manera y se
ejecuta una vez por fila examinada. Coste medido por llamada, con la base casi
vacía:

| Función | µs por llamada |
| --- | --- |
| `tiene_permiso('x.y')` | ~18 |
| `puede_ver_orden(id)` | ~393 |

`puede_ver_orden` es cara porque en cada invocación repite `es_admin()`,
`usuario_actual()` y `tiene_permiso()` —todo ello independiente de la fila— antes
de llegar a los dos `exists` sobre `ot_personal` y `parte_detalle`. A 1.000
órdenes en un listado son ~0,4 s solo de política; a 10.000, ~4 s.

El arreglo **no** es envolver la llamada entera, que es imposible, sino
reestructurar la política para que la parte constante se ice y la variable quede
indexada:

```sql
using (
  (select public.es_admin())
  or (select public.tiene_permiso('ordenes.ver'))
  or exists (select 1 from public.ot_personal p
              where p.orden_id = ordenes_trabajo.id
                and p.usuario_id = (select public.usuario_actual()))
)
```

Hoy nada de esto se nota: la base tiene 1.603 filas en total y la tabla mayor es
`audit_log` con 320. Se nota a partir de unos miles de órdenes. Medir el
rendimiento contra esta base **no prueba nada**, y un `explain analyze` que salga
en microsegundos es un falso verde.

Y una corrección a lo que esta misma skill decía hace un rato: **el aviso «clave
foránea sin índice» del tablero no es un hecho de rendimiento, es una regla de
linter.** Exige que las columnas de la llave sean prefijo EXACTO de algún índice.
Un índice de una sola columna sirve perfectamente para la sonda de integridad de
una llave compuesta que empiece por esa columna — comprobado con `explain`
contra producción:

```
Index Scan using idx_kardex_etapa on kardex
  Index Cond: (etapa_id = ...)
  Filter: (orden_id = ...)
```

De las 19 que reporta, solo **15** carecen de índice que empiece por su primera
columna, y ninguna de esas 15 se justifica hoy: son catálogos acotados
(`tipos_documento`, `series_documentarias`, `roles_permisos`, la codificación de
`materiales`) o columnas de «quién firmó» que la aplicación nunca filtra y cuyo
padre no se borra en ningún flujo —los únicos `.delete()` del código son sobre
líneas de detalle—. Se decidió no crear ninguno el 2026-08-28.

Antes de crear un índice de clave foránea, comprobar tres cosas: **(a)** si ya
existe uno cuya primera columna coincida, **(b)** si la aplicación filtra de
verdad por esa columna, **(c)** si el padre llega a borrarse alguna vez en este
negocio. Si las tres fallan, el índice solo añade coste de escritura y un aviso
más de «índice sin usar» a los 219 que el proyecto ya arrastra.

El punto ciego que sí importa va al revés: el tablero **da por cubierta** una
llave que solo tiene un índice PARCIAL, y la integridad referencial no puede
usarlo porque mira todas las filas. Es el caso de `usuarios.area_id`, cubierta
solo por `ix_usuarios_area (… where activo)`. Ninguna herramienta avisa de eso:
lo vigila `db/test/checks/190_las_llaves_que_nadie_vigila.sql`.

Sigue pendiente y confirmado por `get_advisors`: 7 tablas de catálogo con dos
políticas permisivas de `select` para `authenticated`, que se evalúan las dos.
