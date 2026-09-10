-- La puerta tapiada, y su contraria.
--
--   1. Un permiso que **alguna política exige** y que **ningún rol tiene** en
--      `roles_permisos`. La política es correcta, la tabla está llena y todo el
--      mundo ve el vacío menos el administrador, que entra por `es_admin()`.
--      Pasó con `configuracion.ver` y once catálogos: el desplegable de
--      carrocerías llegaba vacío a toda la empresa y sin él no se podía
--      cotizar. Es el hallazgo caro de este archivo.
--   2. Un permiso declarado en `public.permisos` que no nombra ninguna política
--      ni ninguna función. Ojo: **esto no es un fallo por sí solo**. La
--      aplicación también los usa (`puede(perfil, 'x.y')` en `src/`) para
--      esconder botones y entradas del menú, así que un permiso puede vivir
--      solo en la pantalla. Es una lista para revisar a mano, no para vaciar.
--
-- Los códigos salen del texto de las políticas y del cuerpo de las funciones
-- (`tiene_permiso('x.y')`, `exigir_permiso('x.y')`), no de una lista escrita a
-- mano: así la consulta sigue valiendo cuando se agregue un módulo.
--
-- RESULTADO ESPERADO: cero filas en 1. En 2, el inventario del día.

with usados_en_politicas as (
  select distinct m[1] as permiso
    from pg_policies p
   cross join lateral regexp_matches(
     coalesce(p.qual, '') || ' ' || coalesce(p.with_check, ''),
     '(?:tiene_permiso|exigir_permiso)\(''([a-z_]+\.[a-z_]+)''',
     'g'
   ) m
   where p.schemaname = 'public'
),
usados_en_funciones as (
  select distinct m[1] as permiso
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   cross join lateral regexp_matches(
     p.prosrc,
     '(?:tiene_permiso|exigir_permiso)\(''([a-z_]+\.[a-z_]+)''',
     'g'
   ) m
   where n.nspname = 'public'
),
usados as (
  select permiso from usados_en_politicas
  union
  select permiso from usados_en_funciones
)
select '1 · permiso que una política exige y ningún rol tiene' as hallazgo,
       u.permiso                                               as objeto,
       (select string_agg(p.tablename || ' · ' || p.policyname, ', ' order by p.tablename)
          from pg_policies p
         where p.schemaname = 'public'
           and (coalesce(p.qual, '') || ' ' || coalesce(p.with_check, ''))
               like '%''' || u.permiso || '''%')              as detalle
  from usados_en_politicas u
 where not exists (
   select 1 from public.roles_permisos rp where rp.permiso_codigo = u.permiso
 )

union all

select '2 · permiso declarado que la base no usa (mirar si lo usa la pantalla)',
       pm.codigo,
       pm.modulo || ' · ' || coalesce(pm.descripcion, '')
  from public.permisos pm
 where not exists (select 1 from usados u where u.permiso = pm.codigo)

order by 1, 2;
