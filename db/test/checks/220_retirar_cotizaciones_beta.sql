-- El circuito de cotización estructurada sale; el expediente PDF permanece.
\set ON_ERROR_STOP on
begin;

do $$
begin
  perform test.afirmar(to_regclass('public.cotizaciones') is null,
    'no queda la cotización estructurada');
  perform test.afirmar(to_regclass('public.cotizacion_partidas') is null
    and to_regclass('public.cotizacion_especificaciones') is null
    and to_regclass('public.cotizacion_accesorios') is null
    and to_regclass('public.cotizacion_etapas') is null
    and to_regclass('public.pagos_cliente') is null
    and to_regclass('public.clasificaciones_costeo') is null,
    'no quedan las tablas de la cotización beta ni sus pagos');
  perform test.afirmar(to_regclass('public.cotizaciones_pdf') is not null
    and to_regclass('public.v_cotizaciones_pdf') is not null,
    'el expediente y la vista de cotizaciones PDF siguen disponibles');
  perform test.afirmar(not exists (
      select 1 from information_schema.columns
       where table_schema='public' and table_name='ordenes_trabajo'
         and column_name in ('cotizacion_id','monto_presupuestado','moneda')
    ) and exists (
      select 1 from information_schema.columns
       where table_schema='public' and table_name='ordenes_trabajo'
         and column_name='cotizacion_pdf_id'
    ), 'la OT conserva el vínculo PDF y no conserva vínculo ni monto beta');
  perform test.afirmar(not exists (
      select 1 from information_schema.columns
       where table_schema='public' and table_name='ot_ventas_anteriores'
         and column_name='cotizacion_id'
    ), 'el historial de cambios de cliente no conserva el vínculo beta');
  perform test.afirmar(not exists (
      select 1 from public.permisos
       where codigo in ('cotizaciones.ver','cotizaciones.editar','cotizaciones.aprobar',
         'cotizaciones.anular','cotizaciones.costear','pagos.ver','pagos.registrar')
    ), 'no quedan permisos del circuito beta');
  perform test.afirmar(exists (
      select 1 from public.roles r join public.roles_permisos rp on rp.rol_id=r.id
       where r.codigo='VENDEDOR' and rp.permiso_codigo='cotizaciones.ver_pdf_comercial'
    ) and exists (
      select 1 from public.roles r join public.roles_permisos rp on rp.rol_id=r.id
       where r.codigo='GERENTE' and rp.permiso_codigo='cotizaciones.revisar'
    ), 'Ventas y Gerencia conservan los permisos del flujo PDF');
  perform test.afirmar(not exists (
      select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid
       where t.typnamespace='public'::regnamespace and t.typname='tipo_correlativo'
         and e.enumlabel='COTIZACION'
    ) and not exists (
      select 1 from public.series_documentarias where tipo::text='COTIZACION'
    ), 'no queda el correlativo beta de cotización');
  raise notice '  ok · se retiró la beta estructurada y se conservó el circuito PDF';
end $$;

rollback;
