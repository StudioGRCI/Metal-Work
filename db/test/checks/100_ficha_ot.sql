-- Diseño define los pasos; cada jefe firma solo su columna.
\set ON_ERROR_STOP on
begin;
insert into public.empresa (ruc, razon_social) values ('20100000014', 'PRUEBAS FICHA OT S.A.C.');
insert into public.sedes (codigo, nombre) values ('T1', 'Taller principal');
select test.crear_usuario('Ana', 'Torres', 'ana@demo.pe', 'ADMIN', (select id from public.sedes limit 1)) as admin_id \gset
select test.crear_usuario('Diana', 'Rojas', 'diana@demo.pe', 'DISENO', (select id from public.sedes limit 1)) as diseno_id \gset
select test.crear_usuario('Pedro', 'Quispe', 'pedro@demo.pe', 'JEFE_PRODUCCION', (select id from public.sedes limit 1)) as produccion_id \gset
select test.crear_usuario('Teresa', 'Vega', 'teresa@demo.pe', 'JEFE_TALLER', (select id from public.sedes limit 1)) as taller_id \gset
select test.crear_usuario('Oscar', 'Paz', 'oscar@demo.pe', 'OPERARIO', (select id from public.sedes limit 1)) as operario_id \gset

select test.como_usuario(:'admin_id');
insert into public.clientes (tipo_documento, numero_documento, razon_social)
values ('RUC', '20607761907', 'TRANSPORTES VEGA PIUNDO S.A.C');
insert into public.unidades (cliente_id, placa, tipo_vehiculo, marca, modelo)
select id, 'F2K-908', 'SEMIRREMOLQUE', 'RANDON', 'SR' from public.clientes limit 1;
insert into public.ordenes_trabajo
  (cliente_id, unidad_id, sede_id, descripcion, tipo_trabajo, estado)
select c.id, u.id, s.id, 'Verificación de los jefes', 'FABRICACION', 'APROBADA'
from public.clientes c join public.unidades u on u.cliente_id = c.id
cross join public.sedes s limit 1;
select id as orden_id from public.ordenes_trabajo limit 1 \gset
select set_config('prueba.ot', :'orden_id', true);
select test.afirmar(not exists (
  select 1 from public.ot_verificaciones where orden_id = :'orden_id'::uuid
), 'aprobar la OT no crea pasos');

select test.como_usuario(:'diseno_id');
set local role authenticated;
insert into public.ot_verificaciones (orden_id, numero, descripcion)
values (:'orden_id'::uuid, 1, 'Verificar estructura y funcionamiento');
insert into public.ot_verificaciones (orden_id, numero, descripcion)
values (:'orden_id'::uuid, 2, 'Probar sistema de luces');
select test.afirmar((select count(*) from public.ot_verificaciones
  where orden_id = :'orden_id'::uuid) = 2, 'Diseño crea los pasos');
select test.debe_fallar($$update public.ot_verificaciones set avance_1 = true
  where orden_id = current_setting('prueba.ot')::uuid$$,
  'Diseño no firma por el jefe de producción');
reset role;

select test.como_usuario(:'operario_id');
set local role authenticated;
select test.afirmar((select count(*) from public.ot_verificaciones
  where orden_id = :'orden_id'::uuid) = 2, 'el operario puede leer los pasos');
select test.debe_fallar($$insert into public.ot_verificaciones (orden_id, numero, descripcion)
  values (current_setting('prueba.ot')::uuid, 3, 'Paso ajeno')$$,
  'el operario no crea pasos');
reset role;

select test.como_usuario(:'produccion_id');
set local role authenticated;
update public.ot_verificaciones set avance_1 = true
where orden_id = :'orden_id'::uuid and numero = 1;
select test.afirmar(exists (select 1 from public.ot_verificaciones
  where orden_id = :'orden_id'::uuid and avance_1 and not avance_2
    and avance_1_en is not null and avance_1_por = :'produccion_id'::uuid),
  'el jefe de producción marca solo su columna y queda identificado');
select test.debe_fallar($$update public.ot_verificaciones set avance_2 = true
  where orden_id = current_setting('prueba.ot')::uuid$$,
  'producción no firma por taller');
reset role;

select test.como_usuario(:'taller_id');
set local role authenticated;
update public.ot_verificaciones set avance_2 = true
where orden_id = :'orden_id'::uuid and numero = 1;
update public.ot_verificaciones set avance_2 = true
where orden_id = :'orden_id'::uuid and numero = 2;
select test.afirmar(exists (select 1 from public.ot_verificaciones
  where orden_id = :'orden_id'::uuid and avance_1 and avance_2
    and avance_2_en is not null and avance_2_por = :'taller_id'::uuid
    and avance_1_por = :'produccion_id'::uuid),
  'taller firma sin borrar la firma de producción');
select test.afirmar(exists (select 1 from public.ot_verificaciones
  where orden_id = :'orden_id'::uuid and numero = 2
    and not avance_1 and avance_2 and avance_2_por = :'taller_id'::uuid),
  'taller puede firmar antes que producción');
select test.debe_fallar($$update public.ot_verificaciones set avance_1_por = null
  where orden_id = current_setting('prueba.ot')::uuid$$,
  'no se puede falsificar el autor de una firma');
reset role;
rollback;
