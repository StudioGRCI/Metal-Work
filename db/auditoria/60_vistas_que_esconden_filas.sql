-- La vista que devuelve cero filas sin dar ningún error.
--
-- Todas las vistas corren con el permiso de quien pregunta (`security_invoker`,
-- migración 007). Entonces una vista que cruza **por dentro** (`JOIN`, no
-- `LEFT JOIN`) con una tabla cuya política de lectura exige un permiso le
-- devuelve CERO FILAS a quien no tiene ese permiso: la fila se cae en el cruce
-- y Postgres no tiene nada que reportar.
--
-- Es el fallo que dejaba el desplegable de etapas vacío justo para el operario
-- y el supervisor —que no tienen `clientes.ver`— y la orden sin etapas para
-- Calidad, Almacén, Compras y Costos. La migración 073 lo arregló en
-- `ot_resumen` y la 077 en las siete que quedaban, convirtiendo el cruce en
-- `LEFT JOIN`: quien no puede ver el nombre del cliente ve la fila con el
-- cliente en blanco, que es exactamente lo que dice su permiso.
--
-- Cada fila que salga aquí es una vista que hay que mirar: o el cruce pasa a
-- `LEFT JOIN`, o se justifica (cruzar con `ordenes_trabajo` para esconder las
-- órdenes ajenas sí es lo que se quiere).
--
-- RESULTADO ESPERADO: cero filas, salvo las excepciones justificadas por
-- escrito en la revisión del día.

with exigentes as (
  select p.tablename,
         string_agg(distinct m[1], ', ') as permisos
    from pg_policies p
   cross join lateral regexp_matches(coalesce(p.qual, ''),
     '(?:tiene_permiso|exigir_permiso)\(''([a-z_]+\.[a-z_]+)''', 'g') m
   where p.schemaname = 'public'
     and p.cmd in ('SELECT', 'ALL')
   group by p.tablename
),
vistas as (
  select c.relname as vista, pg_get_viewdef(c.oid, true) as def
    from pg_class c
   where c.relnamespace = 'public'::regnamespace
     and c.relkind = 'v'
)
select v.vista                                        as vista,
       e.tablename                                    as tabla_cruzada,
       e.permisos                                     as permiso_que_exige_leerla,
       'quien no lo tiene recibe cero filas de esta vista' as detalle
  from vistas v
  join exigentes e
    on v.def ~ ('(?<!LEFT )(?<!RIGHT )(?<!FULL )JOIN ' || e.tablename || '[ (]')
 order by 1, 2;
