-- Las tres formas que tienen las políticas de mentir.
--
--   1. Una política `ALL` conviviendo con una de lectura. Las dos son
--      permisivas, así que se evalúan **las dos** y basta con que una deje
--      pasar: la `ALL` amplía en silencio lo que la de lectura quería acotar, y
--      leyendo solo la de `SELECT` nadie se entera. Además cuesta el doble en
--      cada fila.
--   2. Una tabla con RLS encendido y **sin política** para algún comando. Para
--      Postgres eso no es un error: simplemente no pasa nadie. La pantalla
--      guarda, no se cae, y afecta cero filas.
--   3. Una política cuyo `qual` (o su `with_check`) es `true`. No filtra nada;
--      está para que la tabla «tenga política». Si es a propósito —un catálogo
--      que todo el que entró puede leer— se deja, pero se mira una por una.
--
-- RESULTADO ESPERADO: cero filas en 1 y 2. En 3, solo las que se hayan
-- aceptado a conciencia; hoy la lista se revisa entera cada vez que crece.

with tablas_con_rls as (
  select c.relname
    from pg_class c
   where c.relnamespace = 'public'::regnamespace
     and c.relkind in ('r', 'p')
     and c.relrowsecurity
),
comandos as (
  select unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as cmd
)
select '1 · política ALL conviviendo con una de lectura' as hallazgo,
       p.tablename || ' · ' || p.policyname               as objeto,
       'también existe ' || l.policyname || ' (SELECT): las dos se evalúan' as detalle
  from pg_policies p
  join pg_policies l
    on l.schemaname = p.schemaname
   and l.tablename  = p.tablename
   and l.cmd = 'SELECT'
 where p.schemaname = 'public'
   and p.cmd = 'ALL'

union all

select '2 · tabla con RLS y sin política para un comando',
       t.relname || ' · ' || c.cmd,
       'nadie puede ejecutar ese comando: afecta cero filas sin error'
  from tablas_con_rls t
 cross join comandos c
 where not exists (
   select 1
     from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = t.relname
      and p.cmd in (c.cmd, 'ALL')
 )

union all

select '3 · política que no filtra nada',
       p.tablename || ' · ' || p.policyname,
       p.cmd || ' para ' || array_to_string(p.roles, ', ')
       || case when btrim(coalesce(p.qual, '')) = 'true' then ' · qual = true' else '' end
       || case when btrim(coalesce(p.with_check, '')) = 'true' then ' · with_check = true' else '' end
  from pg_policies p
 where p.schemaname = 'public'
   and (btrim(coalesce(p.qual, '')) = 'true'
     or btrim(coalesce(p.with_check, '')) = 'true')

order by 1, 2;
