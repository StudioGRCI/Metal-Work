-- Lo que queda al alcance de quien no entró.
--
--   1. Tablas de `public` con RLS **apagado**. Sin RLS no hay política que
--      valga: cualquiera que tenga `select` sobre la tabla la lee entera. Toda
--      tabla nueva paga el peaje de la skill `seguridad` en la misma migración
--      que la crea.
--   2. Permisos sobre tablas o vistas concedidos a `anon` o a `PUBLIC`. La
--      clave anónima viaja al navegador y el repositorio es público: un
--      `grant select … to anon` es un `select` abierto a internet. En este
--      proyecto los grants van **solo** a `authenticated`.
--
--      Cuidado con el origen: Supabase traía de fábrica
--      `alter default privileges in schema public grant all on tables to anon,
--      authenticated, service_role`, así que **toda tabla o vista nueva nacía
--      con permisos para `anon`**. Esta consulta encontró 41 objetos así el
--      2026-09-02 —de los 122 del esquema, con INSERT, UPDATE, DELETE y
--      TRUNCATE incluidos—. No había fuga, porque el RLS los frenaba: todas
--      las políticas del proyecto son `to authenticated`. Pero estaba a una
--      línea de distancia: el día que a una tabla se le apagara el RLS, o que
--      una política se escribiera sin `to authenticated`, quedaba pública.
--
--      La migración `080` revocó lo dado **y la regla que lo daba**
--      (`alter default privileges … revoke all … from anon`), así que las
--      tablas nuevas ya no lo heredan. Si esta consulta vuelve a devolver
--      filas, alguien repuso esa regla por omisión o dio el permiso a mano.
--
-- Se lee de `pg_class.relacl` con `aclexplode`, no de `information_schema`:
-- ahí solo salen los permisos que involucran al usuario de la conexión.
--
-- RESULTADO ESPERADO: cero filas.

select '1 · tabla sin RLS' as hallazgo,
       c.relname::text     as objeto,
       'cualquiera con select la lee entera' as detalle
  from pg_class c
 where c.relnamespace = 'public'::regnamespace
   and c.relkind in ('r', 'p')
   and not c.relrowsecurity

union all

select '2 · permiso sobre tabla o vista para quien no entró',
       c.relname::text || ' (' || case c.relkind when 'v' then 'vista' when 'm' then 'vista materializada' else 'tabla' end || ')',
       string_agg(distinct
         case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end
         || ':' || a.privilege_type, ', ')
  from pg_class c
 cross join lateral aclexplode(coalesce(c.relacl, '{}'::aclitem[])) a
 where c.relnamespace = 'public'::regnamespace
   and c.relkind in ('r', 'p', 'v', 'm')
   and (a.grantee = 0 or a.grantee::regrole::text = 'anon')
 group by c.relname, c.relkind

order by 1, 2;
