-- ¿Hay alguna función del esquema público que le conteste a quien no entró?
--
-- Dos preguntas en una:
--   1. Funciones de `public` que `anon` puede ejecutar. La clave anónima viaja
--      al navegador y el repositorio es público: una función abierta a `anon`
--      es una función abierta a internet.
--   2. Funciones de disparador ejecutables a mano por `anon` o `authenticated`.
--      Las llama el sistema al escribir una fila, nunca una persona; si se
--      pueden llamar sueltas, se les puede pasar un `NEW` inventado.
--
-- Las funciones que trajo una extensión (`unaccent`, `pg_trgm`, `btree_gist`)
-- viven en `public` pero no son nuestras: se excluyen por `pg_depend.deptype='e'`.
--
-- RESULTADO ESPERADO: cero filas. Cualquier fila es una puerta abierta.

with nuestras as (
  select p.oid, p.proname, p.prokind, p.prorettype
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and not exists (
       select 1
         from pg_depend d
        where d.objid = p.oid
          and d.classid = 'pg_proc'::regclass
          and d.deptype = 'e'
     )
)
select 'función de public ejecutable por anon' as hallazgo,
       f.oid::regprocedure::text                as objeto,
       'quien no entró la puede llamar'         as detalle
  from nuestras f
 where f.prokind = 'f'
   and has_function_privilege('anon', f.oid, 'execute')

union all

select 'función de disparador llamable a mano',
       f.oid::regprocedure::text,
       concat_ws(' y ',
         case when has_function_privilege('anon', f.oid, 'execute') then 'anon' end,
         case when has_function_privilege('authenticated', f.oid, 'execute') then 'authenticated' end)
       || ' pueden ejecutarla'
  from nuestras f
 where f.prorettype = 'trigger'::regtype
   and (has_function_privilege('anon', f.oid, 'execute')
     or has_function_privilege('authenticated', f.oid, 'execute'))

order by 1, 2;
