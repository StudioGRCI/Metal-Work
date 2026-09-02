-- ¿Hay alguna vista que corra con los permisos de su dueño en vez de con los
-- de quien pregunta?
--
-- Una vista sin `security_invoker` se ejecuta como el rol que la creó
-- (`postgres`), así que **salta el RLS de todas sus tablas**: cualquiera que
-- pueda leer la vista lee lo que la vista quiera, sin política que lo filtre.
-- La migración 007 puso `security_invoker` en todas; esta consulta vigila que
-- una vista nueva —o un `create or replace view` que se olvidó de repetir la
-- opción, que es como se pierde— no reabra la puerta.
--
-- Las vistas materializadas aparecen aparte porque **no admiten**
-- `security_invoker`: si hay alguna, su contenido no lo filtra ningún RLS y hay
-- que decidir a quién se le da `select` sobre ella.
--
-- RESULTADO ESPERADO: cero filas.

select case c.relkind
         when 'v' then 'vista sin security_invoker'
         when 'm' then 'vista materializada (no puede tener security_invoker)'
       end                                                    as hallazgo,
       c.relname::text                                        as objeto,
       coalesce(array_to_string(c.reloptions, ', '), '(sin opciones)') as detalle
  from pg_class c
 where c.relnamespace = 'public'::regnamespace
   and c.relkind in ('v', 'm')
   and not exists (
     select 1
       from unnest(coalesce(c.reloptions, '{}'::text[])) o
      where o ilike 'security_invoker=on'
         or o ilike 'security_invoker=true'
   )
 order by 1, 2;
