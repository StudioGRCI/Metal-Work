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
   funciones con `search_path` suelto, vistas `security definer`. Correrlo
   **después de cada migración**: es la comprobación más barata que existe en
   este proyecto. Sus avisos de **clave foránea sin índice no se atienden** sin
   leer antes «Lo que ya se midió», aquí abajo: ya se midieron, se decidió no
   crearlos, y crearlos igual costó una migración de ida y otra de vuelta.
4. **`query_logs`** — solo cuando lo anterior no explica el síntoma. Sirve para
   ver el error que de verdad devolvió Postgres, no el que llegó a la pantalla.

Antes de aplicar nada: **`list_migrations`**. El historial del proyecto no usa
los mismos sellos de versión que `supabase/migrations/`, así que la única forma
de saber hasta dónde llegó es preguntárselo.

## Lo que ya se midió (2026-08-28)

Está escrito para que nadie lo vuelva a medir, y sobre todo para no repetir una
conclusión falsa que ya se sacó una vez.

**Antes de crear un índice de clave foránea hay que comprobar tres cosas:**
**(a)** que no exista ya un índice cuya **primera columna** coincida, **(b)** que
la aplicación filtre de verdad por esa columna, **(c)** que el padre llegue a
borrarse en algún flujo de este negocio. La migración que lo cree **dice cuál de
las tres cumple**. Si no cumple ninguna, el índice no acelera nada: solo añade
coste de escritura y un aviso más de «índice sin usar» a los 219 que el proyecto
ya arrastra. El 2026-09-01 se crearon 28 así, porque el tablero los pedía, y al
día siguiente hubo que retirarlos con otra migración.

Y es que **el aviso «clave foránea sin índice» del tablero no es un hecho de
rendimiento, es una regla de linter.** Exige que las columnas de la llave sean
prefijo EXACTO de algún índice. Un índice de una sola columna sirve
perfectamente para la sonda de integridad de una llave compuesta que empiece por
esa columna — comprobado con `explain` contra producción:

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

El punto ciego que sí importa va al revés: el tablero **da por cubierta** una
llave que solo tiene un índice PARCIAL, y la integridad referencial no puede
usarlo porque mira todas las filas. Es el caso de `usuarios.area_id`, cubierta
solo por `ix_usuarios_area (… where activo)`. Ninguna herramienta avisa de eso:
lo vigila `db/test/checks/190_las_llaves_que_nadie_vigila.sql`.

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

Sigue pendiente y confirmado por `get_advisors`: 7 tablas de catálogo con dos
políticas permisivas de `select` para `authenticated`, que se evalúan las dos.

## Pantalla vacía: el diagnóstico que casi siempre acierta

Es el síntoma más frecuente y casi nunca es la consulta. Comprobar en este orden:

1. ¿La consulta devuelve filas **sin** RLS? Si no, el problema es el `where` o
   los datos, y ahí termina.
2. ¿Devuelve filas **con** el rol que usa esa pantalla? Si aquí se vacía, es RLS.
   Se prueba con la receta de «Probar con el rol real», aquí abajo. No hay otra.
3. ¿El permiso que la política exige lo tiene **algún** rol? Un permiso sin rol
   asignado es una puerta tapiada: la política es correcta, la tabla está llena y
   todo el mundo ve el vacío. Pasó con `configuracion.ver` y once catálogos. La
   tabla de quién tiene qué está en `docs/PERMISOS.md`.
4. ¿La columna está en el `select` explícito de `src/lib/datos/*`? Si no está en
   la consulta, no llega a la pantalla por muy bien que esté en la base.

Probar los pasos 2 y 3 **como ADMIN no vale**: entra por `es_admin()` y nunca
toca el permiso.

## Probar con el rol real

Es la única forma de comprobar RLS desde aquí, y hay una sola receta. Dos pasos.

**Paso 1 — sacar el usuario del rol que hace ese trabajo.** Nunca el ADMIN:

```sql
select u.id, u.correo, r.codigo as rol
from public.usuarios u
join public.roles r on r.id = u.rol_id
where r.codigo = 'OPERARIO' and u.activo
limit 1;
```

**Paso 2 — suplantarlo dentro de un bloque que se deshace solo**, medir las
filas y fallar si son cero:

```sql
do $$
declare
  v_usuario constant uuid := '<el id del paso 1>';
  v integer;
begin
  perform set_config('request.jwt.claim.sub',  v_usuario::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_usuario, 'role', 'authenticated')::text, true);

  set local role authenticated;   -- SIN ESTA LÍNEA NO SE PROBÓ NADA

  update public.ordenes_trabajo set estado = 'EN_PROCESO'
   where id = '<la orden de prueba>';
  get diagnostics v = row_count;

  if v = 0 then
    raise exception 'FALLO :: afectó cero filas con el rol real (RLS o permiso)';
  end if;

  raise exception 'ROLLBACK OK :: filas afectadas = %', v;
end $$;
```

El `raise exception` final es a propósito: aborta la transacción y deshace todo.
El éxito se lee en el mensaje de error, que empieza por `ROLLBACK OK`.

**Si el bloque no lleva `set local role authenticated`, no probó RLS: probó que
`postgres` puede escribir, que ya lo sabíamos.** `execute_sql` corre como
`postgres`, que tiene `BYPASSRLS` y además es dueño de las tablas; el
`set_config` del `sub` por sí solo no activa ninguna política. Medido el
2026-09-02 sobre `audit_log` con un OPERARIO que **no** tiene `auditoria.ver`:

| Cómo se probó | Filas que «vio» |
| --- | --- |
| solo `set_config` del `sub` | 805 |
| con `set local role authenticated` | 0 |

Ese falso verde cae justo encima del fallo más caro del proyecto —el permiso que
exige la acción y el que acepta la política no coinciden—, que es el que hay que
cazar con esta receta y no con otra.

Un `update` que afecta cero filas **no es un error** para Postgres: por eso el
`get diagnostics` y el `if v = 0`. Sin esa comprobación el bloque «pasa» sin
haber hecho nada, igual que la pantalla que dice «listo» y miente.

## Rendimiento

- **Un índice de clave foránea solo se crea si cumple (a), (b) o (c)** — ver «Lo
  que ya se midió». La creencia de que «la clave foránea sin índice es la causa
  número uno de una pantalla lenta» se midió aquí y salió falsa; crear los 28 que
  pedía el tablero costó una migración de ida y otra de vuelta.
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
