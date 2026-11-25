-- Gerencia Comercial y Gerencia de Producción (migración 20261125200000).
--
-- Con las cuentas que crea la migración y `set local role authenticated`:
--   · Gerencia Comercial lee clientes, cotizaciones y OT, y no registra ni
--     corrige nada de Ventas ni da vistos.
--   · Gerencia de Producción da el visto de Gerencia al reporte diario y lee
--     el avance por código, sin cotizaciones ni costos.
-- Termina en rollback.
\set ON_ERROR_STOP on
begin;

select u.id as gco_id from public.usuarios u where u.correo = 'gerencia.comercial@metalworkperusac.com' \gset
select u.id as gpr_id from public.usuarios u where u.correo = 'gerencia.produccion@metalworkperusac.com' \gset

select test.afirmar(
  (select r.codigo from public.usuarios u join public.roles r on r.id = u.rol_id where u.id = :'gco_id') = 'GERENTE_COMERCIAL'
  and (select a.codigo from public.usuarios u join public.areas a on a.id = u.area_id where u.id = :'gco_id') = 'GCO',
  'la cuenta de Gerencia Comercial es de su puesto y del área GCO');
select test.afirmar(
  (select r.codigo from public.usuarios u join public.roles r on r.id = u.rol_id where u.id = :'gpr_id') = 'GERENTE_PRODUCCION'
  and (select a.codigo from public.usuarios u join public.areas a on a.id = u.area_id where u.id = :'gpr_id') = 'GOP',
  'la cuenta de Gerencia de Producción es de su puesto y del área GOP');

-- Ninguno de los dos registra: ningún permiso de escritura salvo el visto del reporte.
select test.afirmar(not exists (
    select 1 from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
     where r.codigo in ('GERENTE_COMERCIAL', 'GERENTE_PRODUCCION')
       and rp.permiso_codigo not in ('clientes.ver', 'cotizaciones.ver_pdf_comercial', 'ordenes.listar', 'ordenes.ver',
                                     'reporte_diario.ver', 'reporte_diario.validar_gerencia',
                                     'codigos_internos.seguimiento', 'produccion.ver', 'rrhh.tiempos_entrega')),
  'los dos puestos solo consultan, salvo el visto de Gerencia al reporte');

-- Un cliente, una cotización y un reporte diario de prueba, sin pasar por sus disparadores.
set local session_replication_role = replica;
insert into public.clientes (id, razon_social, tipo_documento, numero_documento)
values ('46000000-0000-4000-8000-000000000001', 'CLIENTE PRUEBA 460 SAC', 'RUC', '20460460460')
on conflict do nothing;
insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, estado, nombre_archivo, ruta_storage, registrado_por)
values ('46000000-0000-4000-8000-000000000003', '4600-2026', '46000000-0000-4000-8000-000000000001',
        (select id from public.tipos_carroceria order by codigo limit 1), 'APROBADA', 'cotizacion-4600.pdf', 'cot/46000000-0000-4000-8000-000000000003/cotizacion-4600.pdf',
        (select id from public.usuarios where correo = 'gerencia.comercial@metalworkperusac.com'));
insert into public.ordenes_trabajo (id, sede_id, descripcion, cliente_id)
values ('46000000-0000-4000-8000-000000000004', (select id from public.sedes order by creado_en limit 1), 'OT de prueba 460',
        '46000000-0000-4000-8000-000000000001');
insert into public.reportes_diarios (id, fecha, codigo_interno, asunto, descripcion, registrado_por)
values ('46000000-0000-4000-8000-000000000002', (now() at time zone 'America/Lima')::date, 'CHK460', 'Prueba', 'Armado del cajón',
        (select id from public.usuarios where correo = 'gerencia.comercial@metalworkperusac.com'));
set local session_replication_role = origin;

-- Gerencia Comercial ---------------------------------------------------------
select test.como_usuario(:'gco_id');
set local role authenticated;
select test.afirmar((select count(*) from public.clientes where id = '46000000-0000-4000-8000-000000000001') = 1,
  'Gerencia Comercial ve los clientes');
select test.afirmar((select count(*) from public.cotizaciones_pdf where id = '46000000-0000-4000-8000-000000000003') = 1,
  'Gerencia Comercial ve la cotización');
select test.afirmar((select count(*) from public.ordenes_trabajo where id = '46000000-0000-4000-8000-000000000004') = 1,
  'y la OT');
select test.debe_fallar(
  $q$update public.cotizaciones_pdf set estado = 'RECHAZADA', observacion = 'Prueba 460' where id = '46000000-0000-4000-8000-000000000003'$q$,
  'Gerencia Comercial no aprueba ni rechaza cotizaciones', 'No tienes permiso');
do $$
declare v integer;
begin
  update public.clientes set razon_social = 'OTRA' where id = '46000000-0000-4000-8000-000000000001';
  get diagnostics v = row_count;
  perform test.afirmar(v = 0, 'Gerencia Comercial no corrige clientes');
end $$;
select test.debe_fallar(
  $q$insert into public.clientes (razon_social, tipo_documento, numero_documento) values ('NUEVO 460', 'RUC', '20460460461')$q$,
  'Gerencia Comercial no registra clientes');
select test.debe_fallar(
  $q$select public.validar_reporte_diario('46000000-0000-4000-8000-000000000002', 'GERENCIA')$q$,
  'Gerencia Comercial no da el visto del reporte diario');
reset role;

-- Gerencia de Producción -----------------------------------------------------
select test.como_usuario(:'gpr_id');
set local role authenticated;
select test.afirmar((select count(*) from public.reportes_diarios where id = '46000000-0000-4000-8000-000000000002') = 1,
  'Gerencia de Producción ve el reporte diario de cualquiera');
select public.validar_reporte_diario('46000000-0000-4000-8000-000000000002', 'GERENCIA');
select test.afirmar((select visto_gerencia_por from public.reportes_diarios where id = '46000000-0000-4000-8000-000000000002') = :'gpr_id',
  'Gerencia de Producción da el visto de Gerencia');
select test.debe_fallar(
  $q$select public.validar_reporte_diario('46000000-0000-4000-8000-000000000002', 'RRHH')$q$,
  'pero no el de RR. HH.');
select test.afirmar((select count(*) from public.cotizaciones_pdf where id = '46000000-0000-4000-8000-000000000003') = 0,
  'Gerencia de Producción no ve las cotizaciones');
select test.afirmar((select count(*) from public.clientes where id = '46000000-0000-4000-8000-000000000001') = 0,
  'ni los clientes');
select test.afirmar((select count(*) from public.ordenes_trabajo where id = '46000000-0000-4000-8000-000000000004') = 0,
  'ni las OT');
select test.debe_fallar($q$select * from public.codigos_internos_costo()$q$,
  'ni el costo de los códigos');
reset role;

rollback;
