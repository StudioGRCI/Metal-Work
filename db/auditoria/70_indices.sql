-- Índices: lo que sobra y el punto ciego que no avisa nadie.
--
-- ⚠ ANTES DE TOCAR NADA: los avisos de «clave foránea sin índice» del tablero
-- de Supabase **no se atienden aquí**. No son un hecho de rendimiento, son una
-- regla de linter: exigen que las columnas de la llave sean prefijo EXACTO de
-- algún índice, cuando un índice de una sola columna sirve perfectamente para
-- la sonda de integridad de una llave compuesta que empiece por esa columna
-- (comprobado con `explain` contra producción). Ya se midieron una por una el
-- 2026-08-28 y se decidió no crear ninguno; crearlos igual costó una migración
-- de ida y otra de vuelta, con 28 índices. La medición está en la skill `datos`,
-- sección «Lo que ya se midió» — leerla antes de crear un índice de llave
-- foránea, y que la migración diga cuál de las tres condiciones cumple.
--
-- Lo que sí se mira aquí:
--
--   1. Índices que nunca se han usado (`idx_stat_user_indexes.idx_scan = 0`).
--      Cada uno cuesta en cada escritura y no devuelve nada. Los contadores se
--      acumulan desde el último `pg_stat_reset()`, así que un cero recién
--      desplegado no prueba nada: se mira sobre una base que lleva semanas
--      atendiendo. Se excluyen los que respaldan una clave primaria o única,
--      que están para garantizar la unicidad y no para buscar.
--   2. El punto ciego de verdad: llaves foráneas cubiertas **solo por un índice
--      parcial** (`pg_index.indpred is not null`). El tablero las da por
--      atendidas y no lo están: la comprobación de integridad mira todas las
--      filas y no puede usar un índice que solo guarda unas cuantas. Es el caso
--      de `usuarios.area_id`, cubierta solo por `ix_usuarios_area (… where
--      activo)`. Ninguna herramienta avisa de esto; lo vigila también
--      `db/test/checks/190_las_llaves_que_nadie_vigila.sql`.
--
-- RESULTADO ESPERADO: cero filas en 2 (es un fallo). En 1, el inventario del
-- día: se lee, no se borra a ciegas.

-- Los índices sin uso se agrupan por tabla a propósito: sueltos son casi
-- doscientas filas que nadie lee.
select '1 · índices que nunca se han usado' as hallazgo,
       s.relname::text || ' (' || count(*) || ')' as objeto,
       string_agg(s.indexrelname::text, ', ' order by s.indexrelname) as detalle
  from pg_stat_user_indexes s
  join pg_index i on i.indexrelid = s.indexrelid
 where s.schemaname = 'public'
   and s.idx_scan = 0
   and not i.indisprimary
   and not i.indisunique
 group by s.relname

union all

select '2 · llave foránea cubierta solo por un índice parcial',
       c.conrelid::regclass::text || ' · ' || c.conname,
       'la integridad no puede usar un índice parcial: ' ||
       (select string_agg(i.indexrelid::regclass::text, ', ')
          from pg_index i
         where i.indrelid = c.conrelid
           and i.indisvalid
           and i.indpred is not null
           and (i.indkey::int2[])[0] = c.conkey[1])
  from pg_constraint c
 where c.contype = 'f'
   and c.connamespace = 'public'::regnamespace
   -- No hay ningún índice PLENO que empiece por la primera columna de la llave…
   and not exists (
     select 1 from pg_index i
      where i.indrelid = c.conrelid
        and i.indisvalid and i.indpred is null
        and (i.indkey::int2[])[0] = c.conkey[1]
   )
   -- …pero sí hay uno PARCIAL, que es lo que engaña al tablero.
   and exists (
     select 1 from pg_index i
      where i.indrelid = c.conrelid
        and i.indisvalid and i.indpred is not null
        and (i.indkey::int2[])[0] = c.conkey[1]
   )

order by 1, 2;
