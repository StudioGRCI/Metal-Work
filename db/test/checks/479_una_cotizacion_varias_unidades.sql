-- Una cotización de varias unidades, una OT por cada una (migración 20261126760000).
-- Ventas preguntó el 26/11 qué hacer con una cotización de tres camabajas: hasta
-- aquí la base dejaba una sola OT vigente por cotización. Ventas dice cuántas
-- unidades lleva, Gerencia la aprueba y Administración carga una OT por unidad,
-- cada una con su código. Cada paso con la cuenta del área que lo hace y
-- `set local role authenticated`; ADMIN no prueba nada aquí.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social)
select '20100000474', 'PRUEBAS UNIDADES S.A.C.' where not exists (select 1 from public.empresa);
insert into public.sedes (codigo, nombre) values ('QA74', 'Taller prueba de unidades') on conflict (codigo) do nothing;

select test.crear_usuario('Gema', 'Gerente', 'gerencia474@demo.pe', 'GERENTE', (select id from public.sedes where codigo = 'QA74')) as gerente_id \gset
select test.crear_usuario('Vico', 'Ventas', 'ventas474@demo.pe', 'VENDEDOR', (select id from public.sedes where codigo = 'QA74')) as vendedor_id \gset
select test.crear_usuario('Olga', 'Oficina', 'oficina474@demo.pe', 'ADMINISTRACION', (select id from public.sedes where codigo = 'QA74')) as oficina_id \gset
select test.crear_usuario('Coni', 'Contable', 'contabilidad474@demo.pe', 'CONTABILIDAD', (select id from public.sedes where codigo = 'QA74')) as conta_id \gset
select test.crear_usuario('Alma', 'Almacén', 'almacen474@demo.pe', 'ALMACENERO', (select id from public.sedes where codigo = 'QA74')) as almacen_id \gset

insert into public.clientes (tipo_documento, numero_documento, razon_social) values ('RUC', '20990000474', 'QA CLIENTE 474');
select id as cliente_id from public.clientes where numero_documento = '20990000474' \gset
select id as carroceria_id from public.tipos_carroceria where activo order by orden_secuencia limit 1 \gset

select set_config('prueba.gerente', :'gerente_id', true);
select set_config('prueba.vendedor', :'vendedor_id', true);
select set_config('prueba.oficina', :'oficina_id', true);
select set_config('prueba.conta', :'conta_id', true);
select set_config('prueba.cliente', :'cliente_id', true);
select set_config('prueba.carroceria', :'carroceria_id', true);
select set_config('prueba.cot3', gen_random_uuid()::text, true);
select set_config('prueba.cot1', gen_random_uuid()::text, true);
select set_config('prueba.ot1', gen_random_uuid()::text, true);
select set_config('prueba.ot2', gen_random_uuid()::text, true);
select set_config('prueba.ot3', gen_random_uuid()::text, true);
select set_config('prueba.ot4', gen_random_uuid()::text, true);
select set_config('prueba.ots', gen_random_uuid()::text, true);
select set_config('prueba.ots2', gen_random_uuid()::text, true);
select set_config('prueba.almacen', :'almacen_id', true);
select set_config('prueba.ot5', gen_random_uuid()::text, true);
select set_config('prueba.ot6', gen_random_uuid()::text, true);

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

-- Una carga de Administración, con el PDF de su OT ya subido.
create function pg_temp.cargar(p_cot text, p_ot text, p_codigo text, p_numero text) returns uuid
language plpgsql as $$
begin
  if not exists (select 1 from storage.objects where bucket_id = 'adjuntos-ot' and name = 'ot/' || p_ot || '/orden.pdf') then
    insert into storage.objects (bucket_id, name, owner_id, metadata)
    values ('adjuntos-ot', 'ot/' || p_ot || '/orden.pdf', current_setting('prueba.oficina'),
            '{"mimetype": "application/pdf", "size": 100}');
  end if;
  return public.cargar_codigo_y_ot_de_cotizacion(
    p_cot::uuid, p_ot::uuid, p_codigo, p_numero, 'SEMIRREMOLQUE',
    (now() at time zone 'America/Lima')::date + 30, 'ot/' || p_ot || '/orden.pdf', 'orden.pdf', 100);
end $$;

-- 1. Ventas sube una cotización de tres camabajas, y otra de una -------------------
do $$
begin
  perform test.como_usuario(current_setting('prueba.vendedor')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format(
    'insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage, mime_type, tamano_bytes, registrado_por, monto_venta, moneda, cantidad_unidades) values (%L, %L, %L, %L, %L, %L, %L, 120, %L, 30000, %L, 0)',
    gen_random_uuid(), 'QA-474-X', current_setting('prueba.cliente'), current_setting('prueba.carroceria'), 'x.pdf',
    'cot/' || gen_random_uuid() || '/x.pdf', 'application/pdf', current_setting('prueba.vendedor'), 'PEN'),
    'Una cotización lleva al menos una unidad', 'ck_cotizacion_pdf_cantidad_unidades');
  insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage,
                                       mime_type, tamano_bytes, registrado_por, monto_venta, moneda, cantidad_unidades)
  values (current_setting('prueba.cot3')::uuid, 'QA-474-3', current_setting('prueba.cliente')::uuid,
          current_setting('prueba.carroceria')::uuid, 'tres.pdf', 'cot/' || current_setting('prueba.cot3') || '/tres.pdf',
          'application/pdf', 120, current_setting('prueba.vendedor')::uuid, 30000, 'PEN', 3);
  -- La de siempre: sin decir la cantidad, una unidad.
  insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage,
                                       mime_type, tamano_bytes, registrado_por, monto_venta, moneda)
  values (current_setting('prueba.cot1')::uuid, 'QA-474-1', current_setting('prueba.cliente')::uuid,
          current_setting('prueba.carroceria')::uuid, 'una.pdf', 'cot/' || current_setting('prueba.cot1') || '/una.pdf',
          'application/pdf', 120, current_setting('prueba.vendedor')::uuid, 9000, 'PEN');
  perform public.confirmar_igv_cotizacion(current_setting('prueba.cot3')::uuid, false);
  reset role;

  perform test.afirmar(
    (select cantidad_unidades from public.cotizaciones_pdf where id = current_setting('prueba.cot1')::uuid) = 1,
    'La cotización que no dice cuántas unidades lleva una, como siempre');

  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  update public.cotizaciones_pdf set estado = 'APROBADA'
   where id in (current_setting('prueba.cot3')::uuid, current_setting('prueba.cot1')::uuid);
  reset role;
end $$;

-- El recorrido de la cotización como lo lee Ventas: el código y la OT, y la factura.
-- En la de varias unidades cada paso es de su unidad («2·», migración 20261126998900).
create function pg_temp.camino(p_cot text) returns text
language plpgsql as $$
declare v text;
begin
  reset role;
  perform test.como_usuario(current_setting('prueba.vendedor')::uuid);
  set local role authenticated;
  select string_agg(coalesce(r.unidad || '·', '') || r.paso || ':' || r.situacion || coalesce(':' || r.puesto, '') || coalesce(':' || r.detalle, ''), ' > ' order by r.orden)
    into v
    from public.recorrido_de_cotizaciones(array[p_cot::uuid]) r
   where r.paso in ('CODIGO_Y_OT', 'FACTURA');
  reset role;
  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  return v;
end $$;

-- 2. Administración carga una OT por unidad, cada una con su código -----------------
do $$
declare
  v_anio constant text := to_char((now() at time zone 'America/Lima')::date, 'YYYY');
  v_cot constant text := current_setting('prueba.cot3');
  v record;
begin
  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform pg_temp.cargar(v_cot, current_setting('prueba.ot1'), 'QA-474 A', '47401');

  select * into v from public.v_cotizaciones_pdf where id = v_cot::uuid;
  perform test.afirmar(v.cantidad_unidades = 3 and v.ordenes_vigentes = 1 and v.ordenes_faltantes = 2,
    'Con la primera OT, la cotización de tres espera dos más');
  -- Cada unidad con lo suyo: la que ya tiene su OT espera su factura sin
  -- esperar a las otras dos, que siguen en Administración.
  perform test.afirmar(pg_temp.camino(v_cot) =
      '1·CODIGO_Y_OT:HECHO:Administración:OT 47401-' || v_anio || ' > 1·FACTURA:AHORA:Contabilidad'
      || ' > 2·CODIGO_Y_OT:AHORA:Administración > 2·FACTURA:PENDIENTE'
      || ' > 3·CODIGO_Y_OT:AHORA:Administración > 3·FACTURA:PENDIENTE',
    'Con 1 de 3 OT, la unidad 1 pasa a Contabilidad y las otras dos siguen en Administración: ' || coalesce(pg_temp.camino(v_cot), 'nada'));
  perform test.afirmar(
    (select p.trabajo from public.pendientes_de_las_ot() p where p.documento = v_cot::uuid and p.clase = 'COTIZACION') like '% · faltan 2 de 3 OT',
    'Con 1 de 3 OT sigue en los pendientes de Administración, con cuántas faltan');

  perform test.debe_fallar(format('select pg_temp.cargar(%L, %L, %L, %L)', v_cot, current_setting('prueba.ot2'), 'qa-474  a', '47402'),
    'Dos unidades de la misma cotización no comparten código', 'cada unidad lleva su propio código');
  perform pg_temp.cargar(v_cot, current_setting('prueba.ot2'), 'QA-474 B', '47402');
  perform pg_temp.cargar(v_cot, current_setting('prueba.ot3'), 'QA-474 C', '47403');
  perform test.afirmar(pg_temp.camino(v_cot) =
      '1·CODIGO_Y_OT:HECHO:Administración:OT 47401-' || v_anio || ' > 1·FACTURA:AHORA:Contabilidad'
      || ' > 2·CODIGO_Y_OT:HECHO:Administración:OT 47402-' || v_anio || ' > 2·FACTURA:AHORA:Contabilidad'
      || ' > 3·CODIGO_Y_OT:HECHO:Administración:OT 47403-' || v_anio || ' > 3·FACTURA:AHORA:Contabilidad',
    'Con las 3 OT, cada unidad tiene la suya y las tres esperan a Contabilidad: ' || coalesce(pg_temp.camino(v_cot), 'nada'));
  perform test.afirmar(
    not exists (select 1 from public.pendientes_de_las_ot() p where p.documento = v_cot::uuid),
    'Con las 3 OT sale de los pendientes de Administración');
  perform test.debe_fallar(format('select pg_temp.cargar(%L, %L, %L, %L)', v_cot, current_setting('prueba.ot4'), 'QA-474 D', '47404'),
    'No entra una cuarta OT en una cotización de tres', 'es de 3 unidades y ya tiene sus 3 OT');
  -- La misma carga otra vez (la respuesta se perdió): se dice como duplicado,
  -- no como «ese código ya es de la OT…», para que la acción la reconozca suya.
  perform test.debe_fallar(format('select pg_temp.cargar(%L, %L, %L, %L)', v_cot, current_setting('prueba.ot2'), 'QA-474 B', '47402'),
    'La misma carga repetida se reconoce como la que ya entró', 'ya quedó registrada la primera vez');

  -- La de una unidad, como siempre: una OT y no dos.
  perform test.afirmar(pg_temp.camino(current_setting('prueba.cot1')) = 'CODIGO_Y_OT:AHORA:Administración > FACTURA:PENDIENTE',
    'La de una unidad espera su OT como siempre, sin «0/1»');
  perform pg_temp.cargar(current_setting('prueba.cot1'), current_setting('prueba.ots'), 'QA-474 S', '47410');
  perform test.afirmar(pg_temp.camino(current_setting('prueba.cot1')) = 'CODIGO_Y_OT:HECHO:Administración:OT 47410-' || to_char((now() at time zone 'America/Lima')::date, 'YYYY') || ' > FACTURA:AHORA:Contabilidad',
    'La de una unidad, con su OT, pasa a Contabilidad como siempre: ' || coalesce(pg_temp.camino(current_setting('prueba.cot1')), 'nada'));
  perform test.debe_fallar(format('select pg_temp.cargar(%L, %L, %L, %L)', current_setting('prueba.cot1'), current_setting('prueba.ots2'), 'QA-474 T', '47411'),
    'La cotización de una unidad no lleva dos OT', 'ya tiene su OT');
  reset role;

  perform test.afirmar(
    (select count(*) from public.ordenes_trabajo where cotizacion_pdf_id = v_cot::uuid and estado <> 'ANULADA') = 3
      and not exists (select 1 from public.ordenes_trabajo where id = current_setting('prueba.ot4')::uuid)
      and not exists (select 1 from public.unidades where codigo_interno = 'QA-474 D'),
    'Quedan tres OT, y lo que falló no dejó ni OT ni unidad');
  perform test.afirmar(
    (select string_agg(u.codigo_interno, ',' order by o.numero) from public.ordenes_trabajo o
       join public.unidades u on u.id = o.unidad_id where o.cotizacion_pdf_id = v_cot::uuid) = 'QA-474 A,QA-474 B,QA-474 C',
    'Cada OT con su unidad y su código');
  perform test.afirmar(
    (select descripcion from public.ordenes_trabajo where id = current_setting('prueba.ot2')::uuid) like '%· cotización QA-474-3 · unidad 2 de 3',
    'La OT dice qué unidad de la cotización es');
  perform test.afirmar(
    (select descripcion from public.ordenes_trabajo where id = current_setting('prueba.ots')::uuid) like '%· cotización QA-474-1',
    'La de una unidad no dice «unidad 1 de 1»');
  perform test.afirmar(
    (select string_agg(n.cuerpo, ' | ' order by n.creado_en, n.cuerpo) from public.notificaciones n
      where n.usuario_id = current_setting('prueba.vendedor')::uuid and n.titulo = 'Tu cotización ya tiene su código'
        and n.origen_id = v_cot::uuid)
      = 'La QA-474-3 de QA CLIENTE 474: la unidad 1 de 3 quedó con el código interno QA-474 A y la OT 47401-' || v_anio || '. Faltan 2.'
        || ' | La QA-474-3 de QA CLIENTE 474: la unidad 2 de 3 quedó con el código interno QA-474 B y la OT 47402-' || v_anio || '. Falta 1.'
        || ' | La QA-474-3 de QA CLIENTE 474: la unidad 3 de 3 quedó con el código interno QA-474 C y la OT 47403-' || v_anio || '. Ya están todas.',
    'Ventas sabe qué unidad quedó con qué código y cuántas faltan');
end $$;

-- 3. Lo que cada puesto ve en la lista ---------------------------------------------
do $$
declare v record;
begin
  perform test.como_usuario(current_setting('prueba.vendedor')::uuid);
  set local role authenticated;
  select * into v from public.v_cotizaciones_pdf where id = current_setting('prueba.cot3')::uuid;
  reset role;
  perform test.afirmar(v.ordenes_vigentes = 3 and v.ordenes_faltantes = 0
      and (select string_agg(e ->> 'codigo_interno', ',') from jsonb_array_elements(v.ordenes) e) = 'QA-474 A,QA-474 B,QA-474 C',
    'Ventas ve las tres OT con su código, en el orden en que se cargaron');

  perform test.como_usuario(current_setting('prueba.conta')::uuid);
  set local role authenticated;
  select * into v from public.v_cotizaciones_pdf where id = current_setting('prueba.cot3')::uuid;
  reset role;
  perform test.afirmar(v.ordenes_vigentes = 3 and v.ordenes_faltantes = 0
      and (select count(*) from jsonb_array_elements(v.ordenes) e where e ->> 'codigo_interno' like 'QA-474 _') = 3,
    'Contabilidad cuenta las mismas tres, con sus códigos');
end $$;

-- 4. La cantidad cambia solo con una corrección, y no baja de las OT que tiene ------
do $$
declare v integer;
begin
  perform test.como_usuario(current_setting('prueba.vendedor')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format(
    'update public.cotizaciones_pdf set cantidad_unidades = 4 where id = %L', current_setting('prueba.cot3')),
    'Sin corrección la cantidad no cambia', 'adjunta una nueva versión');
  perform test.debe_fallar(format(
    'update public.cotizaciones_pdf set cantidad_unidades = 2, ruta_storage = %L, nombre_archivo = %L, motivo_correccion = %L, estado = %L where id = %L',
    'cot/' || current_setting('prueba.cot3') || '/v2.pdf', 'v2.pdf', 'El cliente redujo el pedido', 'POR_REVISAR', current_setting('prueba.cot3')),
    'No queda con menos unidades que OT', 'ya tiene 3 OT: no puede quedar con 2 unidades');
  update public.cotizaciones_pdf
     set cantidad_unidades = 4, ruta_storage = 'cot/' || current_setting('prueba.cot3') || '/v2.pdf',
         nombre_archivo = 'v2.pdf', motivo_correccion = 'El cliente pidió una camabaja más', estado = 'POR_REVISAR'
   where id = current_setting('prueba.cot3')::uuid;
  get diagnostics v = row_count;
  perform test.afirmar(v = 1, 'Con una corrección, la cotización sube a cuatro unidades y vuelve a Gerencia');
  perform public.confirmar_igv_cotizacion(current_setting('prueba.cot3')::uuid, false);
  reset role;

  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format('select pg_temp.cargar(%L, %L, %L, %L)', current_setting('prueba.cot3'), current_setting('prueba.ot4'), 'QA-474 D', '47404'),
    'La cuarta espera a que Gerencia apruebe la corrección', 'todavía no está aprobada');
  reset role;

  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  update public.cotizaciones_pdf set estado = 'APROBADA' where id = current_setting('prueba.cot3')::uuid;
  reset role;
  perform test.afirmar(
    (select n.cuerpo from public.notificaciones n
      where n.usuario_id = current_setting('prueba.oficina')::uuid and n.origen_id = current_setting('prueba.cot3')::uuid
        and n.titulo = 'Cotización aprobada: le faltan OT')
      = 'Gerencia aprobó la QA-474-3 de QA CLIENTE 474. Lleva 4 unidades y tiene 3 OT: carga la que falta.',
    'Aprobada la corrección que suma una unidad, a Administración le llega que falta una OT');
  perform test.afirmar(
    (select string_agg(n.cuerpo, ' | ' order by n.cuerpo desc) from public.notificaciones n
      where n.usuario_id = current_setting('prueba.vendedor')::uuid and n.origen_id = current_setting('prueba.cot3')::uuid
        and n.titulo = 'Gerencia aprobó tu cotización')
      = 'La QA-474-3 de QA CLIENTE 474. Lleva 4 unidades y tiene 3 OT: Administración carga la que falta, cada una con su código interno.'
        || ' | La QA-474-3 de QA CLIENTE 474. Lleva 3 unidades: Administración le da a cada una su código interno y sube su OT.',
    'Ventas sabe cuántas OT espera su cotización aprobada, no un solo código');

  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform pg_temp.cargar(current_setting('prueba.cot3'), current_setting('prueba.ot4'), 'QA-474 D', '47404');
  reset role;
  perform test.afirmar(
    (select ordenes_vigentes = 4 and ordenes_faltantes = 0 from public.v_cotizaciones_pdf where id = current_setting('prueba.cot3')::uuid),
    'Aprobada la corrección, entra la cuarta OT');
end $$;

-- 5. El disparador vale para cualquier camino que cree una OT ------------------------
do $$
begin
  perform test.debe_fallar(format(
    'insert into public.ordenes_trabajo (id, numero, cliente_id, unidad_id, tipo_carroceria_id, sede_id, tipo_trabajo, prioridad, descripcion, fecha_entrega_comprometida, estado, cotizacion_pdf_id) select gen_random_uuid(), %L, cliente_id, unidad_id, tipo_carroceria_id, sede_id, tipo_trabajo, prioridad, descripcion, fecha_entrega_comprometida, %L, cotizacion_pdf_id from public.ordenes_trabajo where id = %L',
    '47499-2099', 'APROBADA', current_setting('prueba.ots')),
    'Ni por fuera de la carga entra una segunda OT en la cotización de una unidad', 'ya tiene su OT');
end $$;

-- 6. El precio de cada unidad es su parte del total ----------------------------------
do $$
declare v record;
begin
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  select * into v from public.margen_ot(current_setting('prueba.ot2')::uuid);
  reset role;
  perform test.afirmar(v.precio_venta = 7500.00 and v.precio_neto_pen = 7500.00,
    'El margen de la OT 2 usa su parte: 30 000 entre 4 unidades');

  perform test.afirmar(
    (select string_agg(c.codigo || '=' || c.precio_venta_pen, ',' order by c.codigo)
       from public.codigos_internos_costo_calculado(null) c where c.codigo like 'QA-474 _')
      = 'QA-474 A=7500.00,QA-474 B=7500.00,QA-474 C=7500.00,QA-474 D=7500.00,QA-474 S=9000.00',
    'Cada código recibe su parte de la venta, y el de una unidad, el total');
end $$;

-- 6b. Las partes suman el total, céntimo por céntimo, y mientras una corrección espera a
-- Gerencia se reparte entre las unidades que Gerencia aprobó (entrega 3, 20261127010000).
savepoint el_precio_de_cada_unidad;
do $$
declare v record;
begin
  set local session_replication_role = replica;
  update public.cotizaciones_pdf set monto_venta = 30000.01 where id = current_setting('prueba.cot3')::uuid;
  set local session_replication_role = origin;
  perform test.afirmar(
    (select sum(c.precio_venta_pen) from public.codigos_internos_costo_calculado(null) c where c.codigo like 'QA-474 _' and c.codigo <> 'QA-474 S')
      = 30000.01,
    'las cuatro partes suman el total, sin perder el céntimo del redondeo');
  -- Ventas sube una corrección a 5 unidades y Gerencia todavía no la aprueba.
  set local session_replication_role = replica;
  update public.cotizaciones_pdf set monto_venta = 30000, cantidad_unidades = 5, estado = 'POR_REVISAR'
   where id = current_setting('prueba.cot3')::uuid;
  set local session_replication_role = origin;
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  select * into v from public.margen_ot(current_setting('prueba.ot2')::uuid);
  reset role;
  perform test.afirmar(v.precio_venta = 7500.00,
    format('con la corrección sin aprobar, la OT 2 sigue con su parte de las 4 unidades aprobadas (%s)', v.precio_venta));
end $$;
rollback to savepoint el_precio_de_cada_unidad;

-- 7. Anulada la OT de la unidad 2, la que se carga es la unidad 2 --------------------
do $$
declare v_desc text; v_unidades text;
begin
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  update public.ordenes_trabajo set estado = 'ANULADA', motivo_anulacion = 'Prueba 474: el cliente cambió la unidad 2'
   where id = current_setting('prueba.ot2')::uuid;
  reset role;

  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform pg_temp.cargar(current_setting('prueba.cot3'), current_setting('prueba.ot5'), 'QA-474 E', '47405');
  reset role;
  select descripcion into v_desc from public.ordenes_trabajo where id = current_setting('prueba.ot5')::uuid;
  perform test.afirmar(v_desc like '%· unidad 2 de 4', format('La OT que reemplaza a la anulada es la unidad 2, no otra «4 de 4» (%s)', v_desc));
  select string_agg((o->>'unidad') || '=' || (o->>'codigo_interno'), ',')
    into v_unidades
    from jsonb_array_elements(public.ordenes_de_cotizacion(current_setting('prueba.cot3')::uuid)) o;
  perform test.afirmar(v_unidades = '1=QA-474 A,2=QA-474 E,3=QA-474 C,4=QA-474 D',
    format('La lista sale por unidad, con la nueva en el lugar de la anulada (%s)', v_unidades));

  -- Con la 2 libre y la 4 vigente, la cotización no puede quedar en 3 unidades.
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  update public.ordenes_trabajo set estado = 'ANULADA', motivo_anulacion = 'Prueba 474: otra vez la unidad 2'
   where id = current_setting('prueba.ot5')::uuid;
  reset role;
  -- Con la 2 libre, una OT de la unidad de la 1 tampoco se cuelga por fuera de la carga.
  insert into public.ordenes_trabajo (id, numero, cliente_id, unidad_id, tipo_carroceria_id, sede_id, tipo_trabajo, prioridad,
                                      descripcion, fecha_entrega_comprometida, estado)
  select current_setting('prueba.ot6')::uuid, '47406-2099', cliente_id, unidad_id, tipo_carroceria_id, sede_id, tipo_trabajo, prioridad,
         'Prueba 474: la misma unidad', fecha_entrega_comprometida, 'APROBADA'
    from public.ordenes_trabajo where id = current_setting('prueba.ot1')::uuid;
  -- Con sesión, desde la 20261127003000 ni se intenta: la cotización de una OT
  -- cambia solo con «Editar OT». Sin sesión (una migración) sigue mirando el código.
  perform test.debe_fallar(format('update public.ordenes_trabajo set cotizacion_pdf_id = %L, numero_de_unidad = 2 where id = %L',
    current_setting('prueba.cot3'), current_setting('prueba.ot6')),
    'Con sesión, una OT no se cuelga de la cotización por la API', 'solo con «Editar OT / cambiar cliente»');
  perform set_config('request.jwt.claim.sub', '', true);
  perform test.debe_fallar(format('update public.ordenes_trabajo set cotizacion_pdf_id = %L, numero_de_unidad = 2 where id = %L',
    current_setting('prueba.cot3'), current_setting('prueba.ot6')),
    'Por fuera de la carga tampoco entra otra OT de una unidad que ya está', 'cada unidad lleva su propio código');

  perform test.como_usuario(current_setting('prueba.vendedor')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format(
    'update public.cotizaciones_pdf set cantidad_unidades = 3, ruta_storage = %L, nombre_archivo = %L, motivo_correccion = %L, estado = %L where id = %L',
    'cot/' || current_setting('prueba.cot3') || '/v3.pdf', 'v3.pdf', 'Al final son tres', 'POR_REVISAR', current_setting('prueba.cot3')),
    'No queda con menos unidades que la mayor que ya tiene OT', 'es la unidad 4 de la cotización QA-474-3: no puede quedar con 3 unidades');
  reset role;
end $$;

-- 7b. Qué unidad es cada OT no se cambia por la API --------------------------------
do $$
begin
  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format('update public.ordenes_trabajo set numero_de_unidad = 9 where id = %L', current_setting('prueba.ot3')),
    'Administración no cambia qué unidad es una OT', 'eso no se cambia');
  reset role;
end $$;

-- 8. Quien no ve las órdenes cuenta las mismas OT, sin su número ------------------
do $$
declare v jsonb;
begin
  perform test.como_usuario(current_setting('prueba.almacen')::uuid);
  set local role authenticated;
  v := public.ordenes_de_cotizacion(current_setting('prueba.cot3')::uuid);
  reset role;
  perform test.afirmar(jsonb_array_length(v) = 3
      and not exists (select 1 from jsonb_array_elements(v) o where o->>'id' is not null or o->>'numero' is not null or o->>'estado' is not null)
      and (select bool_and(o->>'codigo_interno' is null) from jsonb_array_elements(v) o),
    format('Sin ordenes.ver ni ver la cotización se cuentan las OT, sin código, id, número ni estado (%s)', v));
end $$;

rollback;
