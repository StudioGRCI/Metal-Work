# Auditoría del catálogo

Las preguntas de seguridad que antes se escribían a mano cada vez —y por eso se
olvidaban a medias— viven aquí, una por archivo. Cada archivo es **una consulta
de solo lectura sobre el catálogo de Postgres**, con una cabecera que dice qué
busca, por qué duele y qué resultado se espera. Casi siempre: **cero filas**.

No sustituyen a `db/test/checks/`, que prueban comportamiento dentro de una
transacción con el rol real. Esto mira la **forma** de la base: quién puede
ejecutar qué, qué política falta, qué permiso no tiene dueño.

| Archivo | Pregunta |
| --- | --- |
| `10_funciones_abiertas.sql` | ¿Alguna función le contesta a `anon`? ¿Alguna de disparador se puede llamar a mano? |
| `20_vistas_sin_invoker.sql` | ¿Alguna vista corre con los permisos de su dueño en vez de los de quien pregunta? |
| `30_politicas.sql` | Políticas `ALL` que conviven con una de lectura, tablas con RLS y sin política para algún comando, políticas que no filtran nada. |
| `40_permisos_sin_rol.sql` | La puerta tapiada: un permiso que una política exige y ningún rol tiene. Y su contraria, el permiso declarado que nadie usa. |
| `50_tablas_sin_rls.sql` | Tablas con RLS apagado y permisos concedidos a `anon` o `PUBLIC`. |
| `60_vistas_que_esconden_filas.sql` | Vistas con un cruce interno a una tabla cuya lectura exige un permiso: devuelven cero filas sin dar error. |
| `70_indices.sql` | Índices que nunca se usan y llaves foráneas cubiertas solo por un índice parcial. |

## Cuándo se corre

**Después de cada migración**, junto con `get_advisors`. Son las dos
comprobaciones más baratas que tiene el proyecto y miran cosas distintas:
`get_advisors` trae lo que Supabase ya sabe; esto trae lo que su tablero no
mira —el permiso sin dueño, la vista que se vacía en un cruce, la llave
cubierta solo por un índice parcial—.

Y antes de un despliegue que toque políticas, funciones o grants.

## Cómo se corre

No hay guion que las encadene, y es a propósito: aquí no hay `psql`. Se abre el
archivo, se copia la consulta —todo lo que va después de la cabecera— y se pega
en `execute_sql` contra el proyecto Supabase (`usnbwnemfqyjjkzdizgv`). La receta
de conexión y el orden de diagnóstico están en la skill `datos`.

Cada fila que devuelva una consulta es un hallazgo: se lee la cabecera del
archivo, que explica qué significa esa fila, y se decide si se arregla o se
justifica por escrito. Ninguna se «acepta» en silencio.

## Lo que aquí NO se atiende

Los avisos de **«clave foránea sin índice»** del tablero de Supabase. Ya se
midieron una por una, se decidió no crearlos, y crearlos igual costó una
migración de ida y otra de vuelta con 28 índices. Está escrito en la skill
`datos`, sección «Lo que ya se midió», y repetido en la cabecera de
`70_indices.sql`.
