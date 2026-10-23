-- Los pasos de verificación de la OT: uno los define y cada supervisor firma
-- solo su columna.
--
-- La regla cambió dos veces desde que se escribió este check:
--   · migración 20260929110000: las jefaturas de taller pasan a Supervisión por
--     área; el visto bueno 1 es de Supervisión de Producción y el 2, de
--     Supervisión de Maestranza (la 20260929110100 retira las cuentas de jefe);
--   · migración 20261001222000: los pasos los crea Administración
--     (`ordenes.editar`), no Diseño, que solo los lee.
-- Y desde la 20261016120000 el supervisor ya no lee la OT; como el check 317,
-- la prueba le devuelve `ordenes.ver` solo mientras dure, para seguir cuidando
-- la firma, que sigue en la base.
\set ON_ERROR_STOP on
begin;
insert into public.empresa (ruc, razon_social) values ('20100000014', 'PRUEBAS FICHA OT S.A.C.');
insert into public.sedes (codigo, nombre) values ('T1', 'Taller principal');
select test.crear_usuario('Ana', 'Torres', 'ana@demo.pe', 'ADMIN', (select id from public.sedes limit 1)) as admin_id \gset
select test.crear_usuario('Diana', 'Rojas', 'diana@demo.pe', 'DISENO', (select id from public.sedes limit 1)) as diseno_id \gset
select test.crear_usuario('Olga', 'Ruiz', 'olga@demo.pe', 'ADMINISTRACION', (select id from public.sedes limit 1)) as oficina_id \gset
select test.crear_usuario('Pedro', 'Quispe', 'pedro@demo.pe', 'SUPERVISOR', (select id from public.sedes limit 1)) as produccion_id \gset
select test.crear_usuario('Teresa', 'Vega', 'teresa@demo.pe', 'SUPERVISOR', (select id from public.sedes limit 1)) as taller_id \gset
select test.crear_usuario('Oscar', 'Paz', 'oscar@demo.pe', 'OPERARIO', (select id from public.sedes limit 1)) as operario_id \gset

select test.como_usuario(:'admin_id');
update public.usuarios set area_id = (select id from public.areas where codigo = 'PRD') where id = :'produccion_id';
update public.usuarios set area_id = (select id from public.areas where codigo = 'MTZ') where id = :'taller_id';
insert into public.roles_permisos (rol_id, permiso_codigo)
select id, 'ordenes.ver' from public.roles where codigo = 'SUPERVISOR'
on conflict do nothing;

insert into public.clientes (tipo_documento, numero_documento, razon_social)
values ('RUC', '20607761907', 'TRANSPORTES VEGA PIUNDO S.A.C');
insert into public.unidades (cliente_id, placa, tipo_vehiculo, marca, modelo)
select id, 'F2K-908', 'SEMIRREMOLQUE', 'RANDON', 'SR' from public.clientes limit 1;
insert into public.ordenes_trabajo
  (cliente_id, unidad_id, sede_id, descripcion, tipo_trabajo, estado)
select c.id, u.id, s.id, 'Verificación de Supervisión', 'FABRICACION', 'APROBADA'
from public.clientes c join public.unidades u on u.cliente_id = c.id
cross join public.sedes s limit 1;
select id as orden_id from public.ordenes_trabajo limit 1 \gset
select set_config('prueba.ot', :'orden_id', true);
select test.afirmar(not exists (
  select 1 from public.ot_verificaciones where orden_id = :'orden_id'::uuid
), 'aprobar la OT no crea pasos');

-- Diseño ya no crea los pasos (migración 20261001222000): los lee.
select test.como_usuario(:'diseno_id');
set local role authenticated;
select test.debe_fallar($$insert into public.ot_verificaciones (orden_id, numero, descripcion)
  values (current_setting('prueba.ot')::uuid, 1, 'Paso de Diseño')$$,
  'Diseño ya no crea los pasos: los crea Administración', 'No tienes permiso para crear pasos de verificación');
reset role;

select test.como_usuario(:'oficina_id');
set local role authenticated;
insert into public.ot_verificaciones (orden_id, numero, descripcion)
values (:'orden_id'::uuid, 1, 'Verificar estructura y funcionamiento');
insert into public.ot_verificaciones (orden_id, numero, descripcion)
values (:'orden_id'::uuid, 2, 'Probar sistema de luces');
select test.afirmar((select count(*) from public.ot_verificaciones
  where orden_id = :'orden_id'::uuid) = 2, 'Administración crea los pasos');
select test.debe_fallar($$update public.ot_verificaciones set avance_1 = true
  where orden_id = current_setting('prueba.ot')::uuid$$,
  'Administración no firma por Supervisión de Producción',
  'Solo Supervisión de Producción');
reset role;

-- Diseño lee los pasos, pero no firma: la política ni le alcanza la fila.
select test.como_usuario(:'diseno_id');
set local role authenticated;
select test.afirmar((select count(*) from public.ot_verificaciones
  where orden_id = :'orden_id'::uuid) = 2, 'Diseño lee los pasos');
update public.ot_verificaciones set avance_1 = true
 where orden_id = :'orden_id'::uuid;
reset role;
select test.afirmar(not exists (select 1 from public.ot_verificaciones
  where orden_id = :'orden_id'::uuid and avance_1),
  'Diseño no firma por Supervisión de Producción');

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
  'Supervisión de Producción marca solo su columna y queda identificada');
select test.debe_fallar($$update public.ot_verificaciones set avance_2 = true
  where orden_id = current_setting('prueba.ot')::uuid$$,
  'Producción no firma por Maestranza', 'Solo Supervisión de Maestranza');
-- Firma su columna, pero no cambia lo que escribió Administración en el paso.
select test.debe_fallar($$update public.ot_verificaciones set observaciones = 'La cambia Producción'
  where orden_id = current_setting('prueba.ot')::uuid and numero = 2$$,
  'Producción no cambia los datos del paso', 'No tienes permiso para modificar los datos del paso');
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
  'Maestranza firma sin borrar la firma de Producción');
select test.afirmar(exists (select 1 from public.ot_verificaciones
  where orden_id = :'orden_id'::uuid and numero = 2
    and not avance_1 and avance_2 and avance_2_por = :'taller_id'::uuid),
  'Maestranza puede firmar antes que Producción');
select test.debe_fallar($$update public.ot_verificaciones set avance_1_por = null
  where orden_id = current_setting('prueba.ot')::uuid$$,
  'no se puede falsificar el autor de una firma');
reset role;
rollback;
