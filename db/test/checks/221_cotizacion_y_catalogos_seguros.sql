-- El total comercial viaja con la cotización; los catálogos conservan su historial.
\set ON_ERROR_STOP on
begin;

select test.afirmar(
  exists (select 1 from information_schema.columns where table_schema='public' and table_name='cotizaciones_pdf' and column_name='monto_venta')
  and exists (select 1 from information_schema.columns where table_schema='public' and table_name='cotizaciones_pdf' and column_name='moneda'),
  'La cotización guarda monto total y moneda'
);

select test.afirmar(
  coalesce((select reloptions @> array['security_invoker=on'] from pg_class where oid='public.v_cotizaciones_pdf'::regclass), false),
  'La vista de cotizaciones conserva RLS del usuario'
);

select test.afirmar(
  has_function_privilege('authenticated', 'public.editar_carroceria_ventas(uuid,text,text,boolean)', 'execute')
  and not has_function_privilege('anon', 'public.editar_carroceria_ventas(uuid,text,text,boolean)', 'execute')
  and not exists (
    select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
     where p.oid='public.editar_carroceria_ventas(uuid,text,text,boolean)'::regprocedure
       and a.grantee=0 and a.privilege_type='EXECUTE'
  ),
  'La edición comercial de carrocerías solo se ejecuta con sesión'
);

select test.afirmar(
  (select count(*)=3 from pg_trigger where not tgisinternal and tgname in (
    'proteger_borrado_cliente_con_historial',
    'proteger_borrado_unidad_con_historial',
    'proteger_borrado_carroceria_con_historial'
  )),
  'Clientes, unidades y carrocerías protegen las referencias antes de borrar'
);

rollback;
