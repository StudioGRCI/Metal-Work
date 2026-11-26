-- La OT se carga sin fecha y queda en los pendientes de Administración (plan 8,
-- entrega 8.1, migración 20261126330000). Cada paso con la cuenta del puesto que
-- lo hace y `set local role authenticated`; el armazón lo pone el administrador.
--
--   * `pendientes_de_las_ot()` da la cotización aprobada sin OT, la OT abierta
--     sin código interno (no la de mantenimiento ni la de garantía, que van por
--     su número) y la OT abierta sin fecha de entrega; ni la anulada ni la
--     entregada. Lo más viejo primero, con sus días por fecha de Lima y el total.
--   * Dice por qué «Editar OT» no puede poner el código (OT sin unidad, unidad
--     de otra OT también) y cuál OT se anuló si la cotización vuelve por eso.
--   * No da la cotización que fue la venta anterior de una OT que pasó a otro
--     comprador, y «Dar código y cargar la OT» no le crea otra.
--   * La pide Administración; Ventas, Diseño, Almacén y Gerencia no.
--   * «Dar código y cargar la OT» sin fecha entra, y el aviso a Diseño dice «por
--     definir». La OT queda en los pendientes hasta que «Editar OT» le pone la
--     fecha.
-- Termina en rollback.
\set ON_ERROR_STOP on
begin;

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

insert into public.empresa (ruc, razon_social)
select '20100000472', 'PRUEBAS 472 S.A.C.' where not exists (select 1 from public.empresa);
insert into public.sedes (codigo, nombre) values ('QA472', 'Taller prueba 472') on conflict (codigo) do nothing;
select id as sede_id from public.sedes where codigo = 'QA472' \gset
select test.crear_usuario('Ada', 'Admin', 'admin472@demo.pe', 'ADMIN', :'sede_id') as admin_id \gset
select test.crear_usuario('Gema', 'Gerente', 'gerente472@demo.pe', 'GERENTE', :'sede_id') as gerente_id \gset
select test.crear_usuario('Vico', 'Ventas', 'ventas472@demo.pe', 'VENDEDOR', :'sede_id') as ventas_id \gset
select test.crear_usuario('Olga', 'Oficina', 'oficina472@demo.pe', 'ADMINISTRACION', :'sede_id') as oficina_id \gset
select test.crear_usuario('Dina', 'Diseño', 'diseno472@demo.pe', 'DISENO', :'sede_id') as diseno_id \gset
select test.crear_usuario('Alfo', 'Almacén', 'almacen472@demo.pe', 'ALMACENERO', :'sede_id') as almacen_id \gset

select set_config('prueba.admin', :'admin_id', true);
select set_config('prueba.gerente', :'gerente_id', true);
select set_config('prueba.ventas', :'ventas_id', true);
select set_config('prueba.oficina', :'oficina_id', true);
select set_config('prueba.diseno', :'diseno_id', true);
select set_config('prueba.almacen', :'almacen_id', true);
select set_config('prueba.sede', :'sede_id', true);
select set_config('prueba.cot', gen_random_uuid()::text, true);
select set_config('prueba.ot_cot', gen_random_uuid()::text, true);
select set_config('prueba.cot_anulada', gen_random_uuid()::text, true);
select set_config('prueba.cot_anterior', gen_random_uuid()::text, true);
select set_config('prueba.ot_anterior', gen_random_uuid()::text, true);
select set_config('prueba.carroceria', (select id::text from public.tipos_carroceria where activo order by orden_secuencia limit 1), true);

-- Armazón: un cliente; una cotización que Ventas sube y Gerencia aprueba; y OT de
-- cada caso, puestas por el administrador.
select test.como_usuario(:'admin_id');
insert into public.clientes (tipo_documento, numero_documento, razon_social)
values ('RUC', '20990000472', 'QA CLIENTE 472') returning id as cliente_id \gset
select set_config('prueba.cliente', :'cliente_id', true);
create or replace function pg_temp.orden(p_numero text, p_unidad uuid, p_tipo text, p_entrega date) returns uuid language sql as $$
  insert into public.ordenes_trabajo (numero, cliente_id, unidad_id, sede_id, tipo_trabajo, prioridad, descripcion,
                                      estado, fecha_entrega_comprometida)
  values (p_numero, current_setting('prueba.cliente')::uuid, p_unidad, current_setting('prueba.sede')::uuid,
          p_tipo::public.tipo_trabajo_ot, 'NORMAL', 'Prueba 472 ' || p_tipo, 'APROBADA', p_entrega) returning id;
$$;
insert into public.unidades (cliente_id, codigo_interno, tipo_vehiculo)
values (:'cliente_id', 'CHK472_CON_CODIGO', 'CAMION') returning id as unidad_con \gset
insert into public.unidades (cliente_id, tipo_vehiculo, placa)
values (:'cliente_id', 'CAMION', 'QAS-472') returning id as unidad_sin \gset
insert into public.unidades (cliente_id, codigo_interno, tipo_vehiculo)
values (:'cliente_id', 'CHK472_COMPLETA', 'CAMION') returning id as unidad_completa \gset
insert into public.unidades (cliente_id, tipo_vehiculo, placa)
values (:'cliente_id', 'CAMION', 'QAN-472') returning id as unidad_anulada \gset
-- Completa: código y fecha. No sale.
select pg_temp.orden('8470-2026', :'unidad_completa', 'FABRICACION', current_date + 20) as completa \gset
-- Sin código interno, con fecha: sale por el código. Su unidad es también de la
-- garantía 9472: desde esta OT no se le puede poner (UNIDAD_COMPARTIDA).
select pg_temp.orden('8471-2026', :'unidad_sin', 'FABRICACION', current_date + 20) as sin_codigo \gset
-- Sin unidad: sale por el código, que no se puede poner desde la OT (SIN_UNIDAD).
select pg_temp.orden('8475-2026', null, 'REPARACION', current_date + 20) as sin_unidad \gset
-- Con su propia unidad sin código: sale, y «Editar OT» sí se lo pone.
insert into public.unidades (cliente_id, tipo_vehiculo, placa)
values (:'cliente_id', 'CAMION', 'QAP-472') returning id as unidad_propia \gset
select pg_temp.orden('8476-2026', :'unidad_propia', 'FABRICACION', current_date + 20) as propia \gset
-- Con código, sin fecha: sale por la fecha. Creada hace 3 días.
select pg_temp.orden('8472-2026', :'unidad_con', 'FABRICACION', null) as sin_fecha \gset
update public.ordenes_trabajo set creado_en = now() - interval '3 days' where id = :'sin_fecha';
-- Mantenimiento sin unidad y con fecha: va por su número, no sale.
select pg_temp.orden('9471-2026', null, 'MANTENIMIENTO', current_date + 5) as mant_con_fecha \gset
-- Garantía de una unidad sin código y sin fecha: sale solo por la fecha.
select pg_temp.orden('9472-2026', :'unidad_sin', 'GARANTIA', null) as garantia_sin_fecha \gset
-- Anulada sin código ni fecha: no sale.
select pg_temp.orden('8473-2026', :'unidad_anulada', 'FABRICACION', null) as anulada \gset
update public.ordenes_trabajo set estado = 'ANULADA', motivo_anulacion = 'Se registró dos veces (prueba 472)' where id = :'anulada';
select set_config('prueba.completa', :'completa', true);
select set_config('prueba.sin_codigo', :'sin_codigo', true);
select set_config('prueba.sin_fecha', :'sin_fecha', true);
select set_config('prueba.mant_con_fecha', :'mant_con_fecha', true);
select set_config('prueba.garantia_sin_fecha', :'garantia_sin_fecha', true);
select set_config('prueba.anulada', :'anulada', true);
reset role;

do $$
declare v_n integer;
begin
  perform test.como_usuario(current_setting('prueba.ventas')::uuid);
  set local role authenticated;
  insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage,
                                       mime_type, tamano_bytes, registrado_por, monto_venta, moneda)
  values (current_setting('prueba.cot')::uuid, 'QA-472', current_setting('prueba.cliente')::uuid,
          current_setting('prueba.carroceria')::uuid, 'QA-472.pdf', 'cot/' || current_setting('prueba.cot') || '/QA-472.pdf',
          'application/pdf', 120, current_setting('prueba.ventas')::uuid, 10000, 'PEN');
  reset role;

  -- Otras dos: la que volverá por su OT anulada y la que fue la venta anterior de una OT.
  insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage,
                                       mime_type, tamano_bytes, registrado_por, monto_venta, moneda)
  select x.id, x.numero, current_setting('prueba.cliente')::uuid, current_setting('prueba.carroceria')::uuid,
         x.numero || '.pdf', 'cot/' || x.id || '/' || x.numero || '.pdf', 'application/pdf', 120,
         current_setting('prueba.ventas')::uuid, 10000, 'PEN'
    from (values (current_setting('prueba.cot_anulada')::uuid, 'QA-472-B'),
                 (current_setting('prueba.cot_anterior')::uuid, 'QA-472-C')) as x(id, numero);
  reset role;

  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  update public.cotizaciones_pdf set estado = 'APROBADA'
   where id in (current_setting('prueba.cot')::uuid, current_setting('prueba.cot_anulada')::uuid,
                current_setting('prueba.cot_anterior')::uuid);
  get diagnostics v_n = row_count;
  reset role;
  perform test.afirmar(v_n = 3, 'Gerencia aprueba las tres cotizaciones');
end $$;

-- La cotización B tuvo su OT y se anuló; la C fue la venta anterior de la OT 8470,
-- que pasó a otro comprador (así lo anota «Editar OT»).
select test.como_usuario(:'admin_id');
insert into public.ordenes_trabajo (numero, cliente_id, sede_id, tipo_trabajo, prioridad, descripcion, estado,
                                    fecha_entrega_comprometida, cotizacion_pdf_id)
values ('8477-2026', :'cliente_id', :'sede_id', 'FABRICACION', 'NORMAL', 'Prueba 472 la que se anuló', 'APROBADA',
        current_date + 20, current_setting('prueba.cot_anulada')::uuid) returning id as ot_anulada \gset
update public.ordenes_trabajo set estado = 'ANULADA', motivo_anulacion = 'El cliente pidió otra medida (prueba 472)'
 where id = :'ot_anulada';
insert into public.ot_ventas_anteriores (orden_id, cliente_id, cotizacion_pdf_id, datos, creado_por)
values (:'completa', :'cliente_id', current_setting('prueba.cot_anterior')::uuid, '{}', :'admin_id');
reset role;

-- 1. Administración ve lo que falta, lo más viejo primero --------------------------
do $$
declare
  v_filas jsonb;
  v_nros text[];
begin
  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  select coalesce(jsonb_agg(to_jsonb(p)), '[]') into v_filas from public.pendientes_de_las_ot() p;
  select array_agg(p.numero order by p.desde, p.numero) into v_nros from public.pendientes_de_las_ot() p;
  reset role;

  perform test.afirmar(
    exists (select 1 from jsonb_array_elements(v_filas) f
             where f->>'numero' = 'QA-472' and f->>'clase' = 'COTIZACION' and (f->>'falta_ot')::boolean
               and f->>'cliente' = 'QA CLIENTE 472' and (f->>'dias')::int = 0),
    'La cotización aprobada sin OT sale, con su cliente, desde hoy');
  perform test.afirmar(
    exists (select 1 from jsonb_array_elements(v_filas) f
             where f->>'numero' = '8471-2026' and (f->>'falta_codigo')::boolean and not (f->>'falta_fecha')::boolean
               and f->>'codigo_bloqueado' = 'UNIDAD_COMPARTIDA'),
    'La OT de fabricación sin código interno sale por el código, y dice que su unidad es también de otra OT');
  perform test.afirmar(
    exists (select 1 from jsonb_array_elements(v_filas) f
             where f->>'numero' = '8475-2026' and (f->>'falta_codigo')::boolean and f->>'codigo_bloqueado' = 'SIN_UNIDAD'),
    'La reparación sin unidad sale por el código, y dice que no tiene unidad');
  perform test.afirmar(
    exists (select 1 from jsonb_array_elements(v_filas) f
             where f->>'numero' = '8476-2026' and (f->>'falta_codigo')::boolean and f->>'codigo_bloqueado' is null),
    'La OT con su propia unidad sin código sale, y «Editar OT» se lo puede poner');
  perform test.afirmar(
    exists (select 1 from jsonb_array_elements(v_filas) f
             where f->>'numero' = 'QA-472-B' and (f->>'falta_ot')::boolean and f->>'ot_anulada' = '8477-2026'),
    'La cotización cuya OT se anuló vuelve, y dice cuál se anuló');
  perform test.afirmar(
    not exists (select 1 from jsonb_array_elements(v_filas) f where f->>'numero' = 'QA-472-C'),
    'La venta anterior de una OT que pasó a otro comprador no sale');
  perform test.afirmar(
    (select bool_and((f->>'total')::int = jsonb_array_length(v_filas)) from jsonb_array_elements(v_filas) f),
    'Cada fila trae el total, que aquí es el de las filas');
  perform test.afirmar(
    exists (select 1 from jsonb_array_elements(v_filas) f
             where f->>'numero' = '8472-2026' and (f->>'falta_fecha')::boolean and not (f->>'falta_codigo')::boolean
               and (f->>'dias')::int = 3),
    'La OT sin fecha sale por la fecha, con los 3 días que lleva');
  perform test.afirmar(
    exists (select 1 from jsonb_array_elements(v_filas) f
             where f->>'numero' = '9472-2026' and (f->>'falta_fecha')::boolean and not (f->>'falta_codigo')::boolean),
    'La garantía sin fecha sale, pero no se le pide código interno');
  perform test.afirmar(
    not exists (select 1 from jsonb_array_elements(v_filas) f
                 where f->>'numero' in ('8470-2026', '9471-2026', '8473-2026')),
    'No salen la OT completa, el mantenimiento con fecha (va por su número) ni la anulada');
  perform test.afirmar(v_nros[1] = '8472-2026', 'Lo más viejo va primero: la OT de hace 3 días');
  perform test.afirmar(
    not exists (select 1 from jsonb_array_elements(v_filas) f, jsonb_object_keys(f) k
                 where k ilike '%monto%' or k ilike '%venta%' or k ilike '%precio%' or k ilike '%importe%'),
    'Sin importes');
end $$;

-- 2. Quien no carga OT no la pide -----------------------------------------
do $$
declare v_quien text;
begin
  foreach v_quien in array array['ventas', 'diseno', 'almacen', 'gerente'] loop
    perform test.como_usuario(current_setting('prueba.' || v_quien)::uuid);
    set local role authenticated;
    perform test.debe_fallar('select * from public.pendientes_de_las_ot()',
      format('%s no ve los pendientes de las OT', v_quien), 'quien carga las OT');
    reset role;
  end loop;
end $$;

-- 3. Administración carga la OT de la cotización sin fecha ---------------------------
do $$
declare
  v_orden uuid;
  v_fila record;
begin
  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('adjuntos-ot', 'ot/' || current_setting('prueba.ot_cot') || '/orden.pdf', current_setting('prueba.oficina'),
          '{"mimetype": "application/pdf", "size": 100}');
  v_orden := public.cargar_codigo_y_ot_de_cotizacion(
    current_setting('prueba.cot')::uuid, current_setting('prueba.ot_cot')::uuid, 'CHK472_NUEVO', '8474',
    'SEMIRREMOLQUE', null, 'ot/' || current_setting('prueba.ot_cot') || '/orden.pdf', 'orden.pdf', 100);
  select * into v_fila from public.pendientes_de_las_ot() p where p.documento = v_orden;
  -- La venta anterior no lleva otra OT, aunque siga aprobada.
  perform test.debe_fallar(format(
    $q$select public.cargar_codigo_y_ot_de_cotizacion(%L, %L, 'CHK472_ANTERIOR', '8478', 'SEMIRREMOLQUE', null, %L, 'orden.pdf', 100)$q$,
    current_setting('prueba.cot_anterior'), current_setting('prueba.ot_anterior'),
    'ot/' || current_setting('prueba.ot_anterior') || '/orden.pdf'),
    'La venta anterior de una OT no lleva otra OT', 'fue la venta anterior de la OT 8470-2026');
  perform test.afirmar(
    not exists (select 1 from public.pendientes_de_las_ot() p where p.numero = 'QA-472'),
    'Con su OT, la cotización sale de los pendientes');
  reset role;

  perform test.afirmar(v_orden = current_setting('prueba.ot_cot')::uuid, 'La OT sin fecha se crea');
  perform test.afirmar(
    (select o.fecha_entrega_comprometida is null and o.estado::text = 'APROBADA' from public.ordenes_trabajo o where o.id = v_orden),
    'Nace aprobada y sin fecha de entrega');
  perform test.afirmar(v_fila.falta_fecha and not v_fila.falta_codigo and v_fila.clase = 'OT',
    'Y queda en los pendientes por la fecha, con su código ya puesto');
  perform test.afirmar(
    exists (select 1 from public.notificaciones n where n.usuario_id = current_setting('prueba.diseno')::uuid
              and n.titulo = 'Código nuevo con su OT' and n.cuerpo like '%Entrega prometida: por definir.%'),
    'Diseño recibe el aviso con la entrega «por definir»');
end $$;

-- 4. «Editar OT» le pone la fecha y sale de los pendientes ------------------------------
do $$
declare
  v_o record;
  v_u timestamptz;
begin
  select o.id, o.actualizado_en, o.descripcion, o.prioridad, u.codigo_interno, u.marca, u.modelo, u.actualizado_en as u_ver
    into v_o
    from public.ordenes_trabajo o join public.unidades u on u.id = o.unidad_id
   where o.id = current_setting('prueba.sin_fecha')::uuid;
  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform public.editar_ot_con_historial(v_o.id, v_o.actualizado_en, jsonb_build_object(
    'descripcion', v_o.descripcion, 'prioridad', v_o.prioridad,
    'fecha_entrega_comprometida', (current_date + 15)::text, 'codigo_interno', v_o.codigo_interno,
    'marca', coalesce(v_o.marca, ''), 'modelo', coalesce(v_o.modelo, ''), 'unidad_version', v_o.u_ver),
    'Fecha confirmada por el cliente (prueba 472)');
  perform test.afirmar(
    not exists (select 1 from public.pendientes_de_las_ot() p where p.numero = '8472-2026'),
    'Con la fecha puesta, la OT sale de los pendientes');
  reset role;
end $$;

rollback;
