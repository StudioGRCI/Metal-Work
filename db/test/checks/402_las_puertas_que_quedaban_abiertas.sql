-- Las puertas que cerró la migración 20261020150000, probadas con los puestos
-- reales y `set local role authenticated`, y como dueño de las tablas donde la
-- regla tiene que valer incluso para quien se salta el RLS:
--
--   · la OT, el acta y la liberación de Tesorería no se borran, ni como dueño;
--     la cotización aprobada o anulada tampoco; la que está por revisar, sí;
--   · el correlativo de la OT no se repite en otro año;
--   · la auditoría no le muestra a Gerencia lo que RR. HH., la caja y el precio
--     de venta le tapan, y al administrador sí;
--   · las firmas viejas de la compra ya no se pueden llamar;
--   · el precio referencial de la carrocería no lo lee nadie con su cuenta, y
--     el resto del catálogo sí;
--   · una foto de avance que un reporte nombra no se borra del almacenamiento.
--
-- Termina en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.sedes (codigo, nombre) values ('QA402', 'Taller prueba 402') on conflict (codigo) do nothing;
select id as sede_id from public.sedes where codigo = 'QA402' \gset
select test.crear_usuario('Gema', 'Gerente', 'gerencia402@demo.pe', 'GERENTE', :'sede_id') as gerente_id \gset
select test.crear_usuario('Pedro', 'Portero', 'porteria402@demo.pe', 'PORTERO', :'sede_id') as portero_id \gset
select test.crear_usuario('Adela', 'Admin', 'admin402@demo.pe', 'ADMIN', :'sede_id') as admin_id \gset
select test.crear_usuario('Tea', 'Tesoro', 'tesoreria402@demo.pe', 'TESORERIA', :'sede_id') as teso_id \gset

insert into public.clientes (tipo_documento, numero_documento, razon_social)
values ('RUC', '20607761907', 'TRANSPORTES PRUEBA 402 S.A.C.')
on conflict do nothing;
insert into public.unidades (cliente_id, placa, tipo_vehiculo, marca, modelo)
select id, 'Q40-201', 'VOLQUETE', 'VOLVO', 'FMX' from public.clientes where numero_documento = '20607761907';
insert into public.tipos_carroceria (codigo, nombre, orden_secuencia) values ('QA_402', 'Tolva QA 402', 99);

-- Dos OT, como dueño de las tablas.
insert into public.ordenes_trabajo (cliente_id, unidad_id, sede_id, descripcion, tipo_trabajo, estado)
select c.id, u.id, :'sede_id', 'Tolva de prueba 402 (' || n || ')', 'FABRICACION', 'APROBADA'
  from public.clientes c join public.unidades u on u.cliente_id = c.id and u.placa = 'Q40-201'
 cross join generate_series(1, 2) n;
select id as ot1 from public.ordenes_trabajo where descripcion = 'Tolva de prueba 402 (1)' \gset
select id as ot2 from public.ordenes_trabajo where descripcion = 'Tolva de prueba 402 (2)' \gset
select set_config('prueba.ot1', :'ot1', true);
select set_config('prueba.ot2', :'ot2', true);

-- ------------------------------------------------ la OT y el acta no se borran
select test.afirmar(
  not has_table_privilege('authenticated', 'public.ordenes_trabajo', 'delete')
  and not has_table_privilege('authenticated', 'public.ot_entregas', 'delete')
  and not has_table_privilege('authenticated', 'public.liberaciones_tesoreria', 'delete'),
  'ninguna cuenta tiene permiso de borrar OT, actas ni liberaciones');

select test.debe_fallar($$
  delete from public.ordenes_trabajo where id = current_setting('prueba.ot1')::uuid
$$, 'ni el dueño de las tablas borra una OT numerada', 'se anula');

select test.como_usuario(:'admin_id');
set local role authenticated;
select test.debe_fallar($$
  delete from public.ordenes_trabajo where id = current_setting('prueba.ot1')::uuid
$$, 'el administrador tampoco borra una OT por la API', 'permission denied');
reset role;

select test.como_usuario(:'teso_id');
set local role authenticated;
insert into public.liberaciones_tesoreria (orden_id, observacion)
values (:'ot1', 'Al día');
reset role;
select test.debe_fallar($$
  delete from public.liberaciones_tesoreria where orden_id = current_setting('prueba.ot1')::uuid
$$, 'la liberación de Tesorería no se borra', 'constancia');

-- El acta se pone sin sus reglas de entrada (la OT tendría que estar
-- terminada): aquí solo se prueba que, una vez puesta, no se borra.
set local session_replication_role = replica;
insert into public.ot_entregas (orden_id, recibe_nombre, recibe_documento, garantia_meses)
values (:'ot1', 'Julio Ramírez', '41255678', 12);
set local session_replication_role = origin;
select test.debe_fallar($$
  delete from public.ot_entregas where orden_id = current_setting('prueba.ot1')::uuid
$$, 'el acta de conformidad no se borra', 'evidencia');

-- -------------------------------------- la cotización firmada no se quita
-- Puestas ya en su estado, sin el circuito de revisión que las lleva ahí.
set local session_replication_role = replica;
insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage, estado)
select n.id, n.numero, c.id, t.id, n.numero || '.pdf', 'cot/' || n.id || '/' || n.numero || '.pdf', n.estado::public.estado_cotizacion_pdf
  from (values (gen_random_uuid(), 'COT-402-A', 'APROBADA'), (gen_random_uuid(), 'COT-402-B', 'POR_REVISAR')) n(id, numero, estado)
 cross join (select id from public.clientes where numero_documento = '20607761907') c
 cross join (select id from public.tipos_carroceria where codigo = 'QA_402') t;
set local session_replication_role = origin;
select test.afirmar((select estado from public.cotizaciones_pdf where numero = 'COT-402-A') = 'APROBADA',
  'la cotización de prueba quedó aprobada');
select test.debe_fallar($$
  delete from public.cotizaciones_pdf where numero = 'COT-402-A'
$$, 'una cotización aprobada no se quita', 'evidencia');
delete from public.cotizaciones_pdf where numero = 'COT-402-B';
select test.afirmar(not exists (select 1 from public.cotizaciones_pdf where numero = 'COT-402-B'),
  'la cotización por revisar sí se sigue quitando');

-- ------------------------------------- el correlativo no se reinicia cada año
-- El número de una OT ya puesta no se cambia; se prueba al darlo de entrada,
-- como hace la OT que trae su número del papel.
select numero as numero_ot1 from public.ordenes_trabajo where id = :'ot1' \gset
select set_config('prueba.repetido', split_part(:'numero_ot1', '-', 1) || '-'
  || (split_part(:'numero_ot1', '-', 2)::int - 1), true);
select test.debe_fallar($$
  insert into public.ordenes_trabajo (numero, cliente_id, unidad_id, sede_id, descripcion, tipo_trabajo, estado)
  select current_setting('prueba.repetido'), cliente_id, unidad_id, sede_id, 'Repetida 402', 'FABRICACION', 'APROBADA'
    from public.ordenes_trabajo where id = current_setting('prueba.ot1')::uuid
$$, 'el mismo correlativo en otro año se rechaza', 'no se reinicia');
insert into public.ordenes_trabajo (numero, cliente_id, unidad_id, sede_id, descripcion, tipo_trabajo, estado)
select '940202-' || split_part(numero, '-', 2), cliente_id, unidad_id, sede_id, 'Nueva 402', 'FABRICACION', 'APROBADA'
  from public.ordenes_trabajo where id = :'ot1';
select test.afirmar(exists (select 1 from public.ordenes_trabajo where descripcion = 'Nueva 402'),
  'un correlativo que no se repite sí entra');

-- ------------------------------------------- la auditoría no destapa lo tapado
insert into public.audit_log (tabla, registro_id, accion, datos_despues)
values ('tareos', gen_random_uuid(), 'INSERT', '{"costo": 99}'),
       ('planillas', gen_random_uuid(), 'INSERT', '{"neto": 1500}'),
       ('cotizaciones_pdf', gen_random_uuid(), 'INSERT', '{"monto": 80000}'),
       ('movimientos_caja', gen_random_uuid(), 'INSERT', '{"monto": 300}'),
       ('clientes', gen_random_uuid(), 'INSERT', '{"razon_social": "X"}');

select test.como_usuario(:'gerente_id');
set local role authenticated;
select test.afirmar(public.tiene_permiso('auditoria.ver'), 'Gerencia consulta la auditoría');
select test.afirmar(
  (select count(*) from public.audit_log where tabla in ('tareos', 'planillas', 'movimientos_caja')) = 0,
  'Gerencia no ve en la auditoría los tareos, las planillas ni la caja');
-- La cotización sí: Gerencia ve su monto (`cotizaciones.ver_pdf_comercial`).
select test.afirmar((select count(*) from public.audit_log where tabla in ('clientes', 'cotizaciones_pdf')) >= 2,
  'Gerencia sí sigue viendo la auditoría de lo demás, la cotización incluida');
reset role;

-- Supervisión General también tiene `auditoria.ver`, pero no lee la venta, las
-- cuentas bancarias, la planilla diaria ni los trabajadores. Ya no se dan de
-- alta cuentas de ese puesto: se le cambia el puesto a una de prueba como
-- dueño de las tablas, sin sus reglas de alta.
insert into public.audit_log (tabla, registro_id, accion, datos_despues)
values ('facturas_venta', gen_random_uuid(), 'INSERT', '{"total": 5000}'),
       ('proveedor_cuentas', gen_random_uuid(), 'INSERT', '{"numero_cuenta": "191-0000"}'),
       ('planilla_diaria_personas', gen_random_uuid(), 'INSERT', '{"valor_hora": 12}'),
       ('trabajadores', gen_random_uuid(), 'INSERT', '{"documento": "41255678"}');
select test.crear_usuario('Sergio', 'General', 'supgeneral402@demo.pe', 'GERENTE', :'sede_id') as sg_id \gset
set local session_replication_role = replica;
update public.usuarios set rol_id = (select id from public.roles where codigo = 'SUPERVISOR_GENERAL') where id = :'sg_id';
set local session_replication_role = origin;
select test.como_usuario(:'sg_id');
set local role authenticated;
select test.afirmar(public.tiene_permiso('auditoria.ver'), 'Supervisión General consulta la auditoría');
select test.afirmar(
  (select count(*) from public.audit_log
    where tabla in ('facturas_venta', 'proveedor_cuentas', 'planilla_diaria_personas', 'trabajadores',
                    'cotizaciones_pdf', 'tareos', 'planillas', 'movimientos_caja')) = 0,
  'Supervisión General no ve en la auditoría la venta, las cuentas, la planilla diaria ni los trabajadores');
select test.afirmar((select count(*) from public.audit_log where tabla = 'clientes') >= 1,
  'Supervisión General sí ve la auditoría de lo demás');
reset role;

select test.como_usuario(:'gerente_id');
set local role authenticated;
select test.afirmar((select count(*) from public.audit_log where tabla = 'facturas_venta') >= 1,
  'Gerencia, que lee las facturas de venta, sí las ve en la auditoría');
reset role;

select test.como_usuario(:'admin_id');
set local role authenticated;
select test.afirmar(
  (select count(*) from public.audit_log where tabla in ('tareos', 'planillas', 'cotizaciones_pdf', 'movimientos_caja')) >= 4,
  'el administrador ve la auditoría completa');
reset role;

-- --------------------------------------------- las firmas viejas de la compra
select test.afirmar(
  coalesce(not has_function_privilege('authenticated',
    to_regprocedure('public.emitir_compra_directa(uuid,uuid,text,text,jsonb,date,text,integer,text)'), 'execute'), true)
  and coalesce(not has_function_privilege('authenticated',
    to_regprocedure('public.emitir_compra_agrupada(uuid,uuid,text,jsonb,date,text,integer,text)'), 'execute'), true),
  'las firmas viejas de emitir la compra ya no se pueden llamar');

-- ------------------------------------------ el precio referencial del catálogo
select test.como_usuario(:'portero_id');
set local role authenticated;
select test.debe_fallar($$ select precio_referencial from public.tipos_carroceria $$,
  'Portería no lee el precio referencial de la carrocería', 'permission denied');
select test.afirmar((select count(*) from public.tipos_carroceria where codigo = 'QA_402') = 1,
  'el resto del catálogo de carrocerías se sigue leyendo');
reset role;

-- ------------------------------------------------- la foto del avance se queda
select test.afirmar(
  (select qual from pg_policies where schemaname = 'storage' and policyname = 'mw_borrar_fotos_avance')
    ~ 'ot_avance_fotos' ,
  'la política de borrar fotos de avance mira si un reporte las nombra');

-- ------------------------------------------------ la lista de órdenes sigue
-- Cerrar columnas de `usuarios` rompería `puesto(usuarios)` y con él la lista
-- de OT para todos (se probó y se deshizo): que no vuelva a pasar.
select test.como_usuario(:'gerente_id');
set local role authenticated;
select test.afirmar((select count(*) from (select * from public.ot_resumen) r) >= 2,
  'la lista de órdenes se lee entera con la cuenta de Gerencia');
select test.afirmar((select count(*) from (select * from public.unidad_tablero) r) >= 0,
  'el tablero de unidades se lee entero con la cuenta de Gerencia');
reset role;

rollback;
