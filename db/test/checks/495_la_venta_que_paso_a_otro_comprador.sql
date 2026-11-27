-- La venta que pasó a otro comprador ya no lleva otra OT (migración
-- 20261126988000; DKS, 2026-11-26: «Cerrarla: no lleva otra OT»). Con «Editar
-- OT» una OT pasa a la cotización de otro cliente y la de antes queda anotada
-- como su venta anterior. Hasta aquí esa cotización volvía a esperar su OT.
--
--   * Administración ya no le puede cargar otra OT: ni con «Dar código y cargar
--     la OT» ni colgando otra OT de ella por otro camino.
--   * Sale de «Por completar»; la tarjeta no la cuenta como faltante y dice de
--     qué OT fue la venta (el número, solo a quien lee o carga las órdenes:
--     Ventas lo lee; Almacén, que no, sabe que pasó sin el número).
--   * El recorrido dice «Pasó a otro comprador» y no espera a nadie.
--   * La de varias unidades cuenta como cargada la unidad que pasó, y sigue
--     esperando la OT de las demás, con su número de unidad.
--   * Si la OT vuelve a su venta, la cotización del medio no queda cerrada.
--   * Volver a aprobarla no pide otra OT, y Facturación no la lista.
-- Cada paso con la cuenta del puesto que lo hace y `set local role authenticated`.
-- Termina en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social)
select '20100000495', 'PRUEBAS 495 S.A.C.' where not exists (select 1 from public.empresa);
insert into public.sedes (codigo, nombre) values ('QA495', 'Taller prueba 495') on conflict (codigo) do nothing;
select id as sede_id from public.sedes where codigo = 'QA495' \gset
select test.crear_usuario('Ada', 'Admin', 'admin495@demo.pe', 'ADMIN', :'sede_id') as admin_id \gset
select test.crear_usuario('Gema', 'Gerente', 'gerente495@demo.pe', 'GERENTE', :'sede_id') as gerente_id \gset
select test.crear_usuario('Vico', 'Ventas', 'ventas495@demo.pe', 'VENDEDOR', :'sede_id') as ventas_id \gset
select test.crear_usuario('Olga', 'Oficina', 'oficina495@demo.pe', 'ADMINISTRACION', :'sede_id') as oficina_id \gset
select test.crear_usuario('Alfo', 'Almacén', 'almacen495@demo.pe', 'ALMACENERO', :'sede_id') as almacen_id \gset

insert into public.clientes (tipo_documento, numero_documento, razon_social) values ('RUC', '20990000495', 'QA PRIMER COMPRADOR 495');
insert into public.clientes (tipo_documento, numero_documento, razon_social) values ('RUC', '20990001495', 'QA OTRO COMPRADOR 495');
select id as cliente_a from public.clientes where numero_documento = '20990000495' \gset
select id as cliente_b from public.clientes where numero_documento = '20990001495' \gset

select set_config('prueba.gerente', :'gerente_id', true);
select set_config('prueba.ventas', :'ventas_id', true);
select set_config('prueba.oficina', :'oficina_id', true);
select set_config('prueba.almacen', :'almacen_id', true);
select set_config('prueba.cliente_a', :'cliente_a', true);
select set_config('prueba.cliente_b', :'cliente_b', true);
select set_config('prueba.carroceria', (select id::text from public.tipos_carroceria where activo order by orden_secuencia limit 1), true);
select set_config('prueba.cot1', gen_random_uuid()::text, true);     -- una unidad: su OT pasa a otro comprador
select set_config('prueba.cot3', gen_random_uuid()::text, true);     -- tres unidades: una OT pasa a otro comprador
select set_config('prueba.nueva1', gen_random_uuid()::text, true);   -- la venta nueva de la primera OT
select set_config('prueba.nueva3', gen_random_uuid()::text, true);   -- la venta nueva de la OT de la de tres
select set_config('prueba.ot1', gen_random_uuid()::text, true);
select set_config('prueba.ot2', gen_random_uuid()::text, true);
select set_config('prueba.ot3', gen_random_uuid()::text, true);
select set_config('prueba.ot4', gen_random_uuid()::text, true);
select set_config('prueba.ot5', gen_random_uuid()::text, true);
select set_config('prueba.ot6', gen_random_uuid()::text, true);
select set_config('prueba.cot5', gen_random_uuid()::text, true);     -- una unidad: su OT pasa y no vuelve
select set_config('prueba.nueva5', gen_random_uuid()::text, true);
select set_config('prueba.ot7', gen_random_uuid()::text, true);

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

-- «Editar OT» la pasa a la cotización de otro cliente, como lo hace Administración.
create function pg_temp.pasar(p_ot text, p_cot text) returns void
language plpgsql as $$
declare v record;
begin
  select o.id, o.actualizado_en, o.descripcion, o.prioridad, o.fecha_entrega_comprometida, u.codigo_interno, u.marca, u.modelo,
         u.actualizado_en as u_ver
    into v
    from public.ordenes_trabajo o join public.unidades u on u.id = o.unidad_id
   where o.id = p_ot::uuid;
  perform public.editar_ot_con_historial(v.id, v.actualizado_en, jsonb_build_object(
    'descripcion', v.descripcion, 'prioridad', v.prioridad,
    'fecha_entrega_comprometida', v.fecha_entrega_comprometida::text, 'codigo_interno', v.codigo_interno,
    'marca', coalesce(v.marca, ''), 'modelo', coalesce(v.modelo, ''), 'unidad_version', v.u_ver,
    'cotizacion_nueva_id', p_cot),
    'El cliente cedió la unidad a otro comprador (prueba 495)');
end $$;

-- El recorrido de la cotización como lo lee Ventas. En la de varias unidades
-- cada paso es de su unidad («2·», migración 20261126998900).
create function pg_temp.camino(p_cot text) returns text
language plpgsql as $$
declare v text;
begin
  reset role;
  perform test.como_usuario(current_setting('prueba.ventas')::uuid);
  set local role authenticated;
  select string_agg(coalesce(r.unidad || '·', '') || r.paso || ':' || r.situacion || coalesce(':' || r.puesto, '') || coalesce(':' || r.detalle, ''), ' > ' order by r.orden)
    into v
    from public.recorrido_de_cotizaciones(array[p_cot::uuid]) r
   where r.paso in ('OTRO_COMPRADOR', 'CODIGO_Y_OT', 'FACTURA', 'COBRO');
  reset role;
  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  return v;
end $$;

-- 1. Ventas sube cuatro cotizaciones y Gerencia las aprueba -------------------------
do $$
declare
  c record;
begin
  perform test.como_usuario(current_setting('prueba.ventas')::uuid);
  set local role authenticated;
  for c in select * from (values
      (current_setting('prueba.cot1'), 'QA-495-1', current_setting('prueba.cliente_a'), 1),
      (current_setting('prueba.cot3'), 'QA-495-3', current_setting('prueba.cliente_a'), 3),
      (current_setting('prueba.nueva1'), 'QA-495-N1', current_setting('prueba.cliente_b'), 1),
      (current_setting('prueba.nueva3'), 'QA-495-N3', current_setting('prueba.cliente_b'), 1),
      (current_setting('prueba.cot5'), 'QA-495-5', current_setting('prueba.cliente_a'), 1),
      (current_setting('prueba.nueva5'), 'QA-495-N5', current_setting('prueba.cliente_b'), 1)) as t(id, numero, cliente, unidades)
  loop
    insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage,
                                         mime_type, tamano_bytes, registrado_por, monto_venta, moneda, cantidad_unidades)
    values (c.id::uuid, c.numero, c.cliente::uuid, current_setting('prueba.carroceria')::uuid, 'cot.pdf',
            'cot/' || c.id || '/cot.pdf', 'application/pdf', 120, current_setting('prueba.ventas')::uuid, 9000, 'PEN', c.unidades);
  end loop;
  reset role;

  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  update public.cotizaciones_pdf set estado = 'APROBADA'
   where id in (current_setting('prueba.cot1')::uuid, current_setting('prueba.cot3')::uuid,
                current_setting('prueba.nueva1')::uuid, current_setting('prueba.nueva3')::uuid,
                current_setting('prueba.cot5')::uuid, current_setting('prueba.nueva5')::uuid);
  reset role;
end $$;

-- 2. Administración carga las OT y dos pasan a otro comprador ----------------------
do $$
begin
  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform pg_temp.cargar(current_setting('prueba.cot1'), current_setting('prueba.ot1'), 'QA-495 A', '49501');
  perform pg_temp.cargar(current_setting('prueba.cot3'), current_setting('prueba.ot2'), 'QA-495 B', '49502');
  perform pg_temp.cargar(current_setting('prueba.cot3'), current_setting('prueba.ot3'), 'QA-495 C', '49503');
  perform pg_temp.pasar(current_setting('prueba.ot1'), current_setting('prueba.nueva1'));
  perform pg_temp.pasar(current_setting('prueba.ot2'), current_setting('prueba.nueva3'));
  perform pg_temp.cargar(current_setting('prueba.cot5'), current_setting('prueba.ot7'), 'QA-495 G', '49507');
  perform pg_temp.pasar(current_setting('prueba.ot7'), current_setting('prueba.nueva5'));
  reset role;

  -- Todo el check va en una transacción, y `now()` es el mismo para cada
  -- traspaso: estos pasaron «hace una hora», para que la vuelta de la sección 3
  -- vaya después, como pasa en la pantalla, donde cada uno es su propio envío.
  perform set_config('session_replication_role', 'replica', true);
  update public.ot_ventas_anteriores set creado_en = creado_en - interval '1 hour';
  perform set_config('session_replication_role', 'origin', true);

  perform test.afirmar(
    (select cotizacion_pdf_id from public.ordenes_trabajo where id = current_setting('prueba.ot1')::uuid) = current_setting('prueba.nueva1')::uuid
    and exists (select 1 from public.ot_ventas_anteriores where orden_id = current_setting('prueba.ot1')::uuid
                 and cotizacion_pdf_id = current_setting('prueba.cot1')::uuid),
    'La OT 49501 pasó a la cotización del otro comprador y la de antes quedó como su venta anterior');
end $$;

-- 3. La de una unidad: ya no lleva otra OT -----------------------------------------
do $$
declare
  v record;
  v_anio constant text := to_char((now() at time zone 'America/Lima')::date, 'YYYY');
begin
  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform test.debe_fallar(
    format('select pg_temp.cargar(%L, %L, %L, %L)', current_setting('prueba.cot1'), current_setting('prueba.ot4'), 'QA-495 D', '49504'),
    'Administración no le carga otra OT a la venta que pasó a otro comprador',
    'fue la venta de la OT 49501-' || v_anio || ', que pasó a otro comprador: ya no lleva otra OT');

  select * into v from public.v_cotizaciones_pdf where id = current_setting('prueba.cot1')::uuid;
  perform test.afirmar(v.ordenes_vigentes = 0 and v.ordenes_faltantes = 0,
    'La tarjeta no la cuenta como faltante: no ofrece cargar la OT');
  perform test.afirmar(v.ordenes_a_otro_comprador = array['49501-' || v_anio] and v.tuvo_orden,
    'La tarjeta dice de qué OT fue la venta, y que tuvo OT (Ventas no la puede quitar)');
  perform test.afirmar(
    not exists (select 1 from public.pendientes_de_las_ot() p where p.documento = current_setting('prueba.cot1')::uuid),
    'Sale de «Por completar» de Administración');
  perform test.afirmar(
    pg_temp.camino(current_setting('prueba.cot1')) = 'OTRO_COMPRADOR:HECHO:Administración:49501-' || v_anio,
    'El recorrido dice que pasó a otro comprador y no espera a nadie (ni OT ni factura): '
      || coalesce(pg_temp.camino(current_setting('prueba.cot1')), 'nada'));
  reset role;

  -- Ventas lee las órdenes: ve el número. Quien no las lee (Almacén) sabe que
  -- pasó, sin el número.
  perform test.como_usuario(current_setting('prueba.ventas')::uuid);
  set local role authenticated;
  select * into v from public.v_cotizaciones_pdf where id = current_setting('prueba.cot1')::uuid;
  perform test.afirmar(v.ordenes_a_otro_comprador = array['49501-' || v_anio] and v.ordenes_faltantes = 0,
    'Ventas ve de qué OT fue la venta y que no falta ninguna');
  reset role;
  perform test.como_usuario(current_setting('prueba.almacen')::uuid);
  set local role authenticated;
  perform test.afirmar(
    public.ordenes_que_salieron_de_la_cotizacion(current_setting('prueba.cot1')::uuid, null) = array[null::text],
    'Quien no lee las órdenes sabe que pasó una, sin el número');
  reset role;

  -- Ni por fuera de la carga: colgar una OT de esa cotización no entra, aunque
  -- quien lo intente sea Administración, que sí escribe en las OT.
  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform test.debe_fallar(
    format('update public.ordenes_trabajo set cotizacion_pdf_id = %L, numero_de_unidad = 1 where id = %L',
           current_setting('prueba.cot1'), current_setting('prueba.ot3')),
    'Ninguna OT se cuelga de la venta que pasó a otro comprador (desde la 20261127003000, ni de ninguna otra por fuera de «Editar OT»)',
    'solo con «Editar OT / cambiar cliente»');
  reset role;

  -- Si el traspaso fue un error, la misma OT vuelve con «Editar OT»: es la suya.
  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform pg_temp.pasar(current_setting('prueba.ot1'), current_setting('prueba.cot1'));
  select * into v from public.v_cotizaciones_pdf where id = current_setting('prueba.cot1')::uuid;
  perform test.afirmar(v.ordenes_vigentes = 1 and v.ordenes_faltantes = 0 and cardinality(v.ordenes_a_otro_comprador) = 0,
    'La OT que pasó puede volver a su venta, y ya no figura como pasada');
  perform test.afirmar(
    pg_temp.camino(current_setting('prueba.cot1')) like 'CODIGO_Y_OT:HECHO%FACTURA:AHORA:Contabilidad',
    'Y el recorrido vuelve a esperar su factura: ' || coalesce(pg_temp.camino(current_setting('prueba.cot1')), 'nada'));
  reset role;
end $$;

-- 4. La de tres unidades: la que pasó cuenta como cargada ---------------------------
do $$
declare
  v record;
  v_cot constant text := current_setting('prueba.cot3');
begin
  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  select * into v from public.v_cotizaciones_pdf where id = v_cot::uuid;
  perform test.afirmar(v.ordenes_vigentes = 1 and v.ordenes_faltantes = 1 and cardinality(v.ordenes_a_otro_comprador) = 1,
    'De tres unidades, con una OT vigente y otra que pasó, falta una');
  perform test.afirmar(v.unidades_a_otro_comprador = jsonb_build_array(jsonb_build_object('unidad', 1, 'numero',
                         '49502-' || to_char((now() at time zone 'America/Lima')::date, 'YYYY'))),
    'La tarjeta sabe que la que pasó era la unidad 1, y su OT');
  perform test.afirmar(
    (select p.trabajo from public.pendientes_de_las_ot() p where p.documento = v_cot::uuid) like '% · falta 1 de 3 OT',
    'Sigue en «Por completar» con la que falta');
  perform test.afirmar(
    pg_temp.camino(v_cot) = '1·OTRO_COMPRADOR:HECHO:Administración:49502-' || to_char((now() at time zone 'America/Lima')::date, 'YYYY')
                            || ' > 2·CODIGO_Y_OT:HECHO:Administración:OT 49503-' || to_char((now() at time zone 'America/Lima')::date, 'YYYY')
                            || ' > 2·FACTURA:AHORA:Contabilidad'
                            || ' > 3·CODIGO_Y_OT:AHORA:Administración > 3·FACTURA:PENDIENTE',
    'El recorrido dice que la unidad 1 pasó y ya no espera nada, que la 2 espera su factura y la 3 su OT: ' || coalesce(pg_temp.camino(v_cot), 'nada'));

  perform pg_temp.cargar(v_cot, current_setting('prueba.ot5'), 'QA-495 E', '49505');
  perform test.afirmar(
    (select numero_de_unidad from public.ordenes_trabajo where id = current_setting('prueba.ot5')::uuid) = 3,
    'La OT nueva es la unidad 3: la 1 pasó a otro comprador y la 2 tiene la suya');
  perform test.afirmar(
    not exists (select 1 from public.pendientes_de_las_ot() p where p.documento = v_cot::uuid),
    'Con la que faltaba, sale de «Por completar»');
  perform test.afirmar(
    pg_temp.camino(v_cot) like '1·OTRO_COMPRADOR:HECHO% > 2·CODIGO_Y_OT:HECHO% > 2·FACTURA:AHORA:Contabilidad > 3·CODIGO_Y_OT:HECHO% > 3·FACTURA:AHORA:Contabilidad'
    and pg_temp.camino(v_cot) not like '%1·FACTURA%',
    'Y las dos que tienen su OT esperan su factura; la que pasó, no: ' || coalesce(pg_temp.camino(v_cot), 'nada'));
  perform test.debe_fallar(
    format('select pg_temp.cargar(%L, %L, %L, %L)', v_cot, current_setting('prueba.ot6'), 'QA-495 F', '49506'),
    'No lleva una cuarta OT',
    'es de 3 unidades: 2 ya tienen su OT y 1 pasó a otro comprador');
  reset role;
end $$;

-- 5. La cotización nueva se porta como cualquier otra -------------------------------
do $$
begin
  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform test.afirmar(
    (select ordenes_vigentes = 1 and ordenes_faltantes = 0 and cardinality(ordenes_a_otro_comprador) = 0
       from public.v_cotizaciones_pdf where id = current_setting('prueba.nueva3')::uuid),
    'La venta nueva tiene su OT y nada pasó a otro comprador');
  -- La OT volvió a su venta (sección 3): el traspaso fue un error, y la
  -- cotización del medio no se cierra: vuelve a esperar su OT.
  perform test.afirmar(
    (select ordenes_vigentes = 0 and ordenes_faltantes = 1 and cardinality(ordenes_a_otro_comprador) = 0
       from public.v_cotizaciones_pdf where id = current_setting('prueba.nueva1')::uuid),
    'La venta nueva cuya OT volvió a la de antes no queda cerrada: le falta su OT');
  perform test.afirmar(
    exists (select 1 from public.pendientes_de_las_ot() p where p.documento = current_setting('prueba.nueva1')::uuid
               and p.venta_anterior_de is null),
    'Y vuelve a «Por completar», sin decir que su OT pasó a otro comprador');
  reset role;
end $$;

-- 5b. Contabilidad no la tiene para facturar -------------------------------------
select test.crear_usuario('Cora', 'Contable', 'contabilidad495@demo.pe', 'CONTABILIDAD', :'sede_id') as contable_id \gset
select set_config('prueba.contable', :'contable_id', true);
do $$
begin
  perform test.como_usuario(current_setting('prueba.contable')::uuid);
  set local role authenticated;
  perform test.afirmar(
    not exists (select 1 from public.cotizaciones_para_facturar() f where f.cotizacion_id = current_setting('prueba.cot5')::uuid),
    'Facturación no lista la venta cerrada sin facturas (no hay OT que esperar ni nada que facturar)');
  perform test.afirmar(
    exists (select 1 from public.cotizaciones_para_facturar() f where f.cotizacion_id = current_setting('prueba.cot3')::uuid)
    and exists (select 1 from public.cotizaciones_para_facturar() f where f.cotizacion_id = current_setting('prueba.cot1')::uuid),
    'Y sí las que tienen OT, aunque una de sus unidades haya pasado');
  reset role;
end $$;

-- 5c. Facturadas las dos unidades que quedan, la venta espera solo su cobro -----------
-- (20261126998900) La unidad que pasó no espera a nadie; cada una de las otras dos,
-- con su factura, pasa de Contabilidad a Tesorería. Se deshace al terminar: las
-- secciones que siguen cuentan con la de tres todavía sin facturas.
savepoint las_dos_facturadas;
do $$
declare
  v_cot constant uuid := current_setting('prueba.cot3')::uuid;
  v_factura uuid;
  v_camino text;
  o record;
begin
  perform set_config('session_replication_role', 'replica', true);
  for o in select t.numero_de_unidad as unidad, public.codigo_de_la_unidad_de_cotizacion(v_cot, t.numero_de_unidad) as codigo
             from public.ordenes_trabajo t where t.cotizacion_pdf_id = v_cot and t.estado <> 'ANULADA' loop
    insert into public.facturas_venta (codigo_interno, cotizacion_pdf_id, cotizacion_numero, cliente, numero, fecha_emision,
                                       fecha_vencimiento, moneda, total, ruta_storage, nombre_archivo, tamano_bytes, registrado_por)
    values (o.codigo, v_cot, 'QA-495-3', 'QA PRIMER COMPRADOR 495', 'E001-4953' || o.unidad, current_date, current_date + 30,
            'PEN', 3000, 'fv/qa-495-3-' || o.unidad || '.pdf', 'f.pdf', 120, current_setting('prueba.contable')::uuid)
    returning id into v_factura;
    insert into public.facturas_venta_unidades (factura_id, numero_de_unidad, de_unidades, codigo_interno, monto)
    values (v_factura, o.unidad, 3, o.codigo, 3000);
  end loop;
  perform set_config('session_replication_role', 'origin', true);

  -- Como Contabilidad, que ve los cobros.
  perform test.como_usuario(current_setting('prueba.contable')::uuid);
  set local role authenticated;
  select string_agg(r.unidad || '·' || r.paso || ':' || r.situacion || case when r.situacion = 'AHORA' then ':' || r.puesto else '' end,
                    ' > ' order by r.orden) into v_camino
    from public.recorrido_de_cotizaciones(array[v_cot]) r where r.unidad is not null;
  reset role;
  perform test.afirmar(
    v_camino = '1·OTRO_COMPRADOR:HECHO'
               || ' > 2·CODIGO_Y_OT:HECHO > 2·FACTURA:HECHO > 2·COBRO:AHORA:Tesorería'
               || ' > 3·CODIGO_Y_OT:HECHO > 3·FACTURA:HECHO > 3·COBRO:AHORA:Tesorería',
    'Facturadas las dos que quedan, la que pasó no espera a nadie y las otras dos esperan solo su cobro: ' || coalesce(v_camino, 'nada'));
end $$;
rollback to savepoint las_dos_facturadas;
release savepoint las_dos_facturadas;

-- 5d. Lo que dice la base de la unidad que pasó, y la OT que llegó de otra venta -----
-- (entrega 3, 20261127010000) Contabilidad no la factura y se le dice por qué; la
-- factura de toda la cotización tampoco, porque una unidad ya no es de esta venta;
-- Administración no la elige para cargarle otra OT. Y en la venta nueva, la OT que
-- llegó cuenta desde que llegó, no desde que se creó en la de antes.
savepoint lo_de_la_que_paso;
do $$
declare
  v_cot constant uuid := current_setting('prueba.cot3')::uuid;
  v_en timestamptz;
  v_llego timestamptz;
begin
  perform test.como_usuario(current_setting('prueba.contable')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format(
    'select public.registrar_factura_venta_de_unidad(gen_random_uuid(), %L, %L, current_date, current_date + 30, %L, 3000, null, %L, %L, 1)',
    v_cot, 'E001-49590', 'PEN', 'fv/qa-495-x.pdf', 'f.pdf'),
    'la unidad que pasó a otro comprador no se factura aquí, y se dice por qué',
    'pasó a otro comprador con su OT: ya no se factura en esta cotización');
  perform test.debe_fallar(format(
    'select public.registrar_factura_venta_de_unidad(gen_random_uuid(), %L, %L, current_date, current_date + 30, %L, 9000, null, %L, %L, 0)',
    v_cot, 'E001-49591', 'PEN', 'fv/qa-495-y.pdf', 'f.pdf'),
    'ni la factura de toda la cotización: una unidad ya no es de esta venta',
    'pasaron unidades a otro comprador: factura por separado cada unidad que sigue en la venta');
  reset role;

  -- Con una unidad libre (se anula la OT 49503), la que pasó tampoco se elige.
  perform set_config('session_replication_role', 'replica', true);
  update public.ordenes_trabajo set estado = 'ANULADA', motivo_anulacion = 'Prueba del check 495'
   where id = current_setting('prueba.ot3')::uuid;
  perform set_config('session_replication_role', 'origin', true);
  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format(
    'select public.cargar_codigo_y_ot_de_cotizacion(%L, %L, %L, %L, %L, null, %L, %L, 100, null, null, 1)',
    v_cot, '49590000-0000-4000-8000-000000000001', 'QA-495 X', '49590', 'SEMIRREMOLQUE',
    'ot/49590000-0000-4000-8000-000000000001/orden.pdf', 'orden.pdf'),
    'Administración no elige la unidad que pasó para cargarle otra OT',
    'pasó a otro comprador: ya no lleva otra OT');
  reset role;

  -- La OT 49502 se creó hace diez días en la venta de antes y pasó a la nueva después.
  perform set_config('session_replication_role', 'replica', true);
  update public.ordenes_trabajo set creado_en = now() - interval '10 days' where id = current_setting('prueba.ot2')::uuid;
  perform set_config('session_replication_role', 'origin', true);
  select max(v.creado_en) into v_llego from public.ot_ventas_anteriores v where v.orden_id = current_setting('prueba.ot2')::uuid;
  perform test.como_usuario(current_setting('prueba.contable')::uuid);
  set local role authenticated;
  select r.en into v_en from public.recorrido_de_cotizaciones(array[current_setting('prueba.nueva3')::uuid]) r
   where r.paso = 'CODIGO_Y_OT' and r.situacion = 'HECHO';
  perform test.afirmar(v_en = v_llego,
    format('en la venta nueva, su OT cuenta desde que llegó (%s), no desde que se creó allá hace diez días (%s)', v_llego, v_en));
  -- Y su factura espera desde entonces: no «hace 10 días».
  select r.en into v_en from public.recorrido_de_cotizaciones(array[current_setting('prueba.nueva3')::uuid]) r
   where r.paso = 'FACTURA' and r.situacion = 'AHORA';
  reset role;
  perform test.afirmar(v_en >= v_llego,
    format('y su factura espera desde que llegó (%s), no desde que se creó allá (%s)', v_llego, v_en));
end $$;
rollback to savepoint lo_de_la_que_paso;
release savepoint lo_de_la_que_paso;

-- 6. Volver a aprobarla no le pide otra OT a Administración ------------------------
-- Ventas la corrige (vuelve a «Por revisar») y Gerencia la aprueba otra vez.
do $$
declare
  v_cot constant uuid := current_setting('prueba.cot5')::uuid;
begin
  perform set_config('session_replication_role', 'replica', true);
  update public.cotizaciones_pdf set estado = 'POR_REVISAR', version = version + 1 where id = v_cot;
  perform set_config('session_replication_role', 'origin', true);
  delete from public.notificaciones where origen_id = v_cot;

  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  update public.cotizaciones_pdf set estado = 'APROBADA' where id = v_cot;
  reset role;

  perform test.afirmar(
    not exists (select 1 from public.notificaciones n where n.origen_id = v_cot and n.titulo like 'Cotización aprobada%'),
    'Administración no recibe «falta su código y su OT» de la venta cerrada');
  perform test.afirmar(
    exists (select 1 from public.notificaciones n where n.origen_id = v_cot
               and n.usuario_id = current_setting('prueba.ventas')::uuid
               and n.cuerpo = 'La QA-495-5 de QA PRIMER COMPRADOR 495. Su OT pasó a otro comprador: ya no lleva otra OT.'),
    'Y a Ventas le dice que su OT pasó a otro comprador: '
      || coalesce((select string_agg(n.cuerpo, ' | ') from public.notificaciones n where n.origen_id = v_cot), 'ninguno'));
end $$;

-- La de tres unidades, con dos OT y una que pasó: tampoco pide otra.
do $$
declare
  v_cot constant uuid := current_setting('prueba.cot3')::uuid;
begin
  perform set_config('session_replication_role', 'replica', true);
  update public.cotizaciones_pdf set estado = 'POR_REVISAR', version = version + 1 where id = v_cot;
  perform set_config('session_replication_role', 'origin', true);
  delete from public.notificaciones where origen_id = v_cot;

  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  update public.cotizaciones_pdf set estado = 'APROBADA' where id = v_cot;
  reset role;

  perform test.afirmar(
    not exists (select 1 from public.notificaciones n where n.origen_id = v_cot and n.titulo like 'Cotización aprobada%'),
    'Administración no recibe aviso de OT que falten en la de tres');
  perform test.afirmar(
    exists (select 1 from public.notificaciones n where n.origen_id = v_cot
               and n.usuario_id = current_setting('prueba.ventas')::uuid
               and n.cuerpo = 'La QA-495-3 de QA PRIMER COMPRADOR 495. Lleva 3 unidades: 2 con su OT y 1 pasó a otro comprador. Ya no lleva otra OT.'),
    'Y a Ventas le cuenta las dos OT y la que pasó: '
      || coalesce((select string_agg(n.cuerpo, ' | ') from public.notificaciones n where n.origen_id = v_cot), 'ninguno'));
end $$;

-- 7. La que se facturó antes de pasar: Facturación la tiene para cobrar, sin pedir OT --
-- La factura se anota como estaba antes de que la OT pasara (sin disparadores).
do $$
declare
  v_cot constant uuid := current_setting('prueba.cot5')::uuid;
  v_ids uuid[];
  v_ordenes text[];
begin
  perform set_config('session_replication_role', 'replica', true);
  insert into public.facturas_venta (codigo_interno, cotizacion_pdf_id, cotizacion_numero, cliente, numero, fecha_emision,
                                     fecha_vencimiento, moneda, total, ruta_storage, nombre_archivo, tamano_bytes, registrado_por)
  values ('QA-495 G', v_cot, 'QA-495-5', 'QA PRIMER COMPRADOR 495', 'E001-495', current_date - 3, current_date + 27,
          'PEN', 1000, 'fv/qa-495.pdf', 'qa-495.pdf', 120, current_setting('prueba.contable')::uuid);
  perform set_config('session_replication_role', 'origin', true);

  perform test.como_usuario(current_setting('prueba.contable')::uuid);
  set local role authenticated;
  perform test.afirmar(
    exists (select 1 from public.cotizaciones_para_facturar() f where f.cotizacion_id = v_cot and f.facturas = 1),
    'Con su factura, la venta cerrada sigue en Facturación para cobrarla o anularla');
  select array_agg(v.cotizacion_id) into v_ids
    from public.ventas_cerradas_por_otro_comprador(array[v_cot, current_setting('prueba.cot3')::uuid, current_setting('prueba.cot1')::uuid]) v;
  select v.ordenes into v_ordenes from public.ventas_cerradas_por_otro_comprador(array[v_cot]) v;
  perform test.afirmar(v_ids = array[v_cot],
    'De las tres, solo la de la OT que pasó está cerrada: la de tres unidades y la que recuperó su OT no: ' || coalesce(v_ids::text, 'ninguna'));
  perform test.afirmar(v_ordenes = array['49507-' || extract(year from current_date)::text],
    'Y dice de qué OT fue la venta (Contabilidad lee las órdenes): ' || coalesce(v_ordenes::text, 'nada'));
  reset role;

  perform test.como_usuario(current_setting('prueba.almacen')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format('select * from public.ventas_cerradas_por_otro_comprador(array[%L]::uuid[])', v_cot),
    'Almacén no pregunta por las ventas de Facturación');
  reset role;
end $$;

-- 8. De A a B, de vuelta a A y otra vez a B: A sí se cierra ------------------------
-- Cada traspaso es su propio envío: los de antes van un minuto atrás.
do $$
declare
  v_cot1   constant uuid := current_setting('prueba.cot1')::uuid;
  v_nueva1 constant uuid := current_setting('prueba.nueva1')::uuid;
  v_anio   constant text := extract(year from current_date)::text;
begin
  perform set_config('session_replication_role', 'replica', true);
  update public.ot_ventas_anteriores set creado_en = creado_en - interval '1 minute'
   where orden_id = current_setting('prueba.ot1')::uuid;
  perform set_config('session_replication_role', 'origin', true);

  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform pg_temp.pasar(current_setting('prueba.ot1'), current_setting('prueba.nueva1'));
  perform test.afirmar(
    public.ordenes_que_salieron_de_la_cotizacion(v_cot1, null) = array['49501-' || v_anio]
    and cardinality(public.ordenes_que_salieron_de_la_cotizacion(v_nueva1, null)) = 0,
    'La venta de origen se cierra aunque la OT ya hubiera vuelto una vez; la nueva tiene su OT');
  perform test.afirmar(
    not exists (select 1 from public.pendientes_de_las_ot() p where p.documento = v_cot1),
    'La de origen no vuelve a «Por completar»');
  perform test.debe_fallar(
    format('select pg_temp.cargar(%L, %L, %L, %L)', v_cot1, current_setting('prueba.ot4'), 'QA-495 D', '49504'),
    'Ni se le carga otra OT',
    'fue la venta de la OT 49501-' || v_anio || ', que pasó a otro comprador');
  reset role;
end $$;

-- 9. El recorrido de la venta cerrada, facturada en parte y cobrada no espera nada --
do $$
declare
  v_cot constant uuid := current_setting('prueba.cot5')::uuid;
  v_factura uuid;
  v_camino text;
begin
  select id into v_factura from public.facturas_venta where cotizacion_pdf_id = v_cot and anulada_en is null;
  perform set_config('session_replication_role', 'replica', true);
  insert into public.cobros_factura_venta (factura_id, fecha, moneda, monto, cancela, archivo_ruta, archivo_mime, archivo_tamano, registrado_por)
  values (v_factura, current_date, 'PEN', 1000, true, 'cv/qa-495.pdf', 'application/pdf', 120, current_setting('prueba.contable')::uuid);
  perform set_config('session_replication_role', 'origin', true);
  -- Como Contabilidad, que ve los cobros.
  perform test.como_usuario(current_setting('prueba.contable')::uuid);
  set local role authenticated;
  select string_agg(r.paso || ':' || r.situacion || coalesce(':' || r.detalle, ''), ' > ' order by r.orden) into v_camino
    from public.recorrido_de_cotizaciones(array[v_cot]) r where r.paso in ('OTRO_COMPRADOR', 'FACTURA', 'COBRO');
  reset role;
  perform test.afirmar(
    v_camino like 'OTRO_COMPRADOR:HECHO%FACTURA:HECHO%COBRO:HECHO%' and v_camino not like '%PENDIENTE%'
    and v_camino not like '%AHORA%' and v_camino not like '%EN_PARTE%',
    'Cobrada su factura, la venta cerrada no espera el cobro del resto ni se dice facturada en parte: ' || coalesce(v_camino, 'nada'));
end $$;

-- 10. Si la OT que pasó se anula, la venta de origen se reabre -----------------------
-- StudioGRCI, 2026-11-26: «sí se reabre hasta que el vendedor intervenga y
-- cancele la venta». La OT 49501 está en la cotización del otro comprador
-- (sección 8) y Gerencia la anula.
do $$
declare
  v_cot1 constant uuid := current_setting('prueba.cot1')::uuid;
  v_anio constant text := extract(year from current_date)::text;
  v_n integer;
begin
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  update public.ordenes_trabajo set estado = 'ANULADA', motivo_anulacion = 'El otro comprador desistió (prueba 495)'
   where id = current_setting('prueba.ot1')::uuid;
  get diagnostics v_n = row_count;
  reset role;
  perform test.afirmar(v_n = 1, 'Gerencia anula la OT que había pasado a otro comprador');

  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform test.afirmar(
    (select ordenes_faltantes = 1 and cardinality(ordenes_a_otro_comprador) = 0
       from public.v_cotizaciones_pdf where id = v_cot1),
    'La venta de origen se reabre: le falta su OT y ya nada pasó a otro comprador');
  perform test.afirmar(
    exists (select 1 from public.pendientes_de_las_ot() p
             where p.documento = v_cot1 and p.ot_anulada = '49501-' || v_anio and p.venta_anterior_de = '49501-' || v_anio),
    'Y vuelve a «Por completar» diciendo que la OT que pasó a otro comprador se anuló');
  perform test.afirmar(
    exists (select 1 from public.pendientes_de_las_ot() p
             where p.documento = current_setting('prueba.nueva1')::uuid and p.ot_anulada = '49501-' || v_anio
               and p.venta_anterior_de is null),
    'La del otro comprador también espera su OT, con la nota de siempre: su OT se anuló');
  reset role;
  perform test.afirmar(
    (select count(*) from public.notificaciones n
      where n.usuario_id = current_setting('prueba.ventas')::uuid and n.titulo = 'Tu venta volvió a esperar su OT') = 1
    and exists (select 1 from public.notificaciones n
                 where n.usuario_id = current_setting('prueba.ventas')::uuid and n.titulo = 'Tu venta volvió a esperar su OT'
                   and n.origen_id = v_cot1 and n.cuerpo like '%Si la venta ya no sigue, cancélala con «Cancelar la venta».'),
    'Ventas recibe un solo aviso: el de la venta de origen, no el de la del otro comprador');
end $$;

-- 11. Ventas cancela la venta que se reabrió, y solo esa ----------------------------
-- La decisión de StudioGRCI (2026-11-26): botón «Cancelar la venta» en Ventas.
-- La cotización QA-495-1 se reabrió en la sección 10; la registró Ventas.
select test.crear_usuario('Vera', 'Otra vendedora', 'ventas495b@demo.pe', 'VENDEDOR', :'sede_id') as ventas2_id \gset
select set_config('prueba.ventas2', :'ventas2_id', true);
do $$
declare
  v_cot1 constant uuid := current_setting('prueba.cot1')::uuid;
  v_cot3 constant uuid := current_setting('prueba.cot3')::uuid;
  v_cot5 constant uuid := current_setting('prueba.cot5')::uuid;
  v_anio constant text := extract(year from current_date)::text;
  v_motivo constant text := 'El cliente desistió de la compra (prueba 495)';
  v record;
  v_n integer;
  v_factura uuid;
begin
  -- La tarjeta sabe que se reabrió, y por qué OT.
  perform test.como_usuario(current_setting('prueba.ventas')::uuid);
  set local role authenticated;
  perform test.afirmar(
    (select reabierta_por_ot_anulada->>'numero' from public.v_cotizaciones_pdf where id = v_cot1) = '49501-' || v_anio,
    'La tarjeta de la venta reabierta dice qué OT se anuló');
  perform test.afirmar(
    (select reabierta_por_ot_anulada is null from public.v_cotizaciones_pdf where id = v_cot3)
    and (select reabierta_por_ot_anulada is null from public.v_cotizaciones_pdf where id = v_cot5)
    and (select reabierta_por_ot_anulada is null from public.v_cotizaciones_pdf where id = current_setting('prueba.nueva1')::uuid),
    'Las demás no figuran como reabiertas: ni la de tres, ni la cerrada, ni la del otro comprador con su OT anulada');
  perform test.afirmar(public.puede_cancelar_la_venta(v_cot1) and not public.puede_cancelar_la_venta(v_cot5),
    'Quien la registró puede cancelar la reabierta, y no la cerrada');

  -- Lo que Ventas no cancela.
  perform test.debe_fallar(format('select public.cancelar_venta_reabierta(%L, %L)', v_cot3, v_motivo),
    'Ventas no cancela la venta que tiene OT vigentes', 'vigente: la venta sigue');
  perform test.debe_fallar(format('select public.cancelar_venta_reabierta(%L, %L)', v_cot5, v_motivo),
    'Ni la que no se reabrió', 'anularla le toca a Gerencia');
  perform test.debe_fallar(
    format('update public.cotizaciones_pdf set estado = ''ANULADA'', observacion = %L where id = %L', v_motivo, v_cot5),
    'Ni por un UPDATE directo: anular sigue siendo de Gerencia', 'No tienes permiso para aprobar ni rechazar');
  perform test.debe_fallar(format('select public.cancelar_venta_reabierta(%L, %L)', v_cot1, 'corto'),
    'Cancelar pide el motivo', 'al menos 10 caracteres');
  perform test.debe_fallar(
    format('update public.cotizaciones_pdf set estado = ''ANULADA'', observacion = %L where id = %L', 'x', v_cot1),
    'También por un UPDATE directo', 'al menos 10 caracteres');
  reset role;

  -- Quien no la registró no la cancela.
  perform test.como_usuario(current_setting('prueba.ventas2')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format('select public.cancelar_venta_reabierta(%L, %L)', v_cot1, v_motivo),
    'Otra vendedora no cancela la venta que no registró', 'quien registró la cotización');
  update public.cotizaciones_pdf set estado = 'ANULADA', observacion = v_motivo where id = v_cot1;
  get diagnostics v_n = row_count;
  reset role;
  perform test.afirmar(v_n = 0 and (select estado = 'APROBADA' from public.cotizaciones_pdf where id = v_cot1),
    'Ni con un UPDATE directo: no toca ninguna fila');

  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format('select public.cancelar_venta_reabierta(%L, %L)', v_cot1, v_motivo),
    'Administración no cancela la venta', 'quien registró la cotización');
  reset role;
  perform test.como_usuario(current_setting('prueba.almacen')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format('select public.cancelar_venta_reabierta(%L, %L)', v_cot1, v_motivo),
    'Almacén tampoco', 'quien registró la cotización');
  reset role;

  -- Con una factura vigente, primero la anula Contabilidad.
  perform set_config('session_replication_role', 'replica', true);
  insert into public.facturas_venta (codigo_interno, cotizacion_pdf_id, cotizacion_numero, cliente, numero, fecha_emision,
                                     fecha_vencimiento, moneda, total, ruta_storage, nombre_archivo, tamano_bytes, registrado_por)
  values ('QA-495 A', v_cot1, 'QA-495-1', 'QA PRIMER COMPRADOR 495', 'E001-4951', current_date - 3, current_date + 27,
          'PEN', 500, 'fv/qa-495-1.pdf', 'qa-495-1.pdf', 120, current_setting('prueba.contable')::uuid)
  returning id into v_factura;
  perform set_config('session_replication_role', 'origin', true);
  perform test.como_usuario(current_setting('prueba.ventas')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format('select public.cancelar_venta_reabierta(%L, %L)', v_cot1, v_motivo),
    'Con una factura vigente no se cancela', 'Contabilidad la anula primero');
  perform test.debe_fallar(
    format('update public.cotizaciones_pdf set estado = ''ANULADA'', observacion = %L where id = %L', v_motivo, v_cot1),
    'Ni por un UPDATE directo', 'No tienes permiso para aprobar ni rechazar');
  reset role;
  perform set_config('session_replication_role', 'replica', true);
  update public.facturas_venta set anulada_en = now(), anulada_por = current_setting('prueba.contable')::uuid,
         motivo_anulacion = 'Se emitió por error (prueba 495)' where id = v_factura;
  perform set_config('session_replication_role', 'origin', true);

  -- Ventas la cancela: la cotización queda anulada, con su motivo, quién y cuándo.
  perform test.como_usuario(current_setting('prueba.ventas')::uuid);
  set local role authenticated;
  perform public.cancelar_venta_reabierta(v_cot1, '  ' || v_motivo || '  ');
  perform public.cancelar_venta_reabierta(v_cot1, v_motivo);   -- el mismo envío otra vez no falla
  perform test.debe_fallar(format('select public.cancelar_venta_reabierta(%L, %L)', v_cot1, 'Otro motivo distinto del primero'),
    'El reenvío con otro motivo dice que ya quedó con el primero', 'ya quedó cancelada la primera vez que la enviaste');
  reset role;
  select c.estado::text as estado, c.motivo_anulacion, c.anulado_por, c.anulado_en, c.revisado_por, c.numero
    into v from public.cotizaciones_pdf c where c.id = v_cot1;
  perform test.afirmar(
    v.estado = 'ANULADA' and v.motivo_anulacion = v_motivo and v.anulado_por = current_setting('prueba.ventas')::uuid
    and v.anulado_en is not null and v.revisado_por = current_setting('prueba.gerente')::uuid and v.numero = 'QA-495-1',
    'La venta cancelada queda anulada con su motivo, quién y cuándo; conserva su número y quién la aprobó');

  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform test.afirmar(
    not exists (select 1 from public.pendientes_de_las_ot() p where p.documento = v_cot1),
    'Y sale de «Por completar» de Administración');
  perform test.debe_fallar(
    format('select pg_temp.cargar(%L, %L, %L, %L)', v_cot1, current_setting('prueba.ot4'), 'QA-495 D', '49504'),
    'A la venta cancelada no se le carga OT');
  reset role;
end $$;

-- 12. La regla de la pila también para la OT anulada, y la venta que siguió ----------
-- Dos casos que encontró la revisión del 2026-11-26:
--  a) De A a B y de vuelta a A (el traspaso fue un error), y la OT se anula en A:
--     B, la del medio, no dice que su OT se anuló ni se reabre.
--  b) C se reabrió (su OT pasó a D y allí se anuló), Administración le cargó otra
--     OT y esa se anuló en C: ahora espera por su propia OT anulada, que es el
--     caso de siempre. Ventas ya no la cancela: anular le toca a Gerencia.
select set_config('prueba.cotp', gen_random_uuid()::text, true);
select set_config('prueba.cotq', gen_random_uuid()::text, true);
select set_config('prueba.cotr', gen_random_uuid()::text, true);
select set_config('prueba.cots', gen_random_uuid()::text, true);
select set_config('prueba.otx', gen_random_uuid()::text, true);
select set_config('prueba.oty', gen_random_uuid()::text, true);
select set_config('prueba.otz', gen_random_uuid()::text, true);
do $$
declare
  c record;
  v_p constant uuid := current_setting('prueba.cotp')::uuid;
  v_q constant uuid := current_setting('prueba.cotq')::uuid;
  v_r constant uuid := current_setting('prueba.cotr')::uuid;
  v_anio constant text := extract(year from current_date)::text;
  v_antes integer;
begin
  perform test.como_usuario(current_setting('prueba.ventas')::uuid);
  set local role authenticated;
  for c in select * from (values
      (current_setting('prueba.cotp'), 'QA-495-P', current_setting('prueba.cliente_a')),
      (current_setting('prueba.cotq'), 'QA-495-Q', current_setting('prueba.cliente_b')),
      (current_setting('prueba.cotr'), 'QA-495-R', current_setting('prueba.cliente_a')),
      (current_setting('prueba.cots'), 'QA-495-S', current_setting('prueba.cliente_b'))) as t(id, numero, cliente)
  loop
    insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage,
                                         mime_type, tamano_bytes, registrado_por, monto_venta, moneda, cantidad_unidades)
    values (c.id::uuid, c.numero, c.cliente::uuid, current_setting('prueba.carroceria')::uuid, 'cot.pdf',
            'cot/' || c.id || '/cot.pdf', 'application/pdf', 120, current_setting('prueba.ventas')::uuid, 9000, 'PEN', 1);
  end loop;
  reset role;
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  update public.cotizaciones_pdf set estado = 'APROBADA'
   where id in (v_p, v_q, v_r, current_setting('prueba.cots')::uuid);
  reset role;

  -- a) A → B → A, y la OT se anula en A.
  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform pg_temp.cargar(current_setting('prueba.cotp'), current_setting('prueba.otx'), 'QA-495 X', '49511');
  perform pg_temp.pasar(current_setting('prueba.otx'), current_setting('prueba.cotq'));
  reset role;
  perform set_config('session_replication_role', 'replica', true);
  update public.ot_ventas_anteriores set creado_en = creado_en - interval '1 hour'
   where orden_id = current_setting('prueba.otx')::uuid;
  perform set_config('session_replication_role', 'origin', true);
  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform pg_temp.pasar(current_setting('prueba.otx'), current_setting('prueba.cotp'));
  reset role;
  select count(*) into v_antes from public.notificaciones
   where usuario_id = current_setting('prueba.ventas')::uuid and titulo = 'Tu venta volvió a esperar su OT';
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  update public.ordenes_trabajo set estado = 'ANULADA', motivo_anulacion = 'Se cargó por error (prueba 495)'
   where id = current_setting('prueba.otx')::uuid;
  reset role;
  perform test.afirmar(
    (select count(*) from public.notificaciones
      where usuario_id = current_setting('prueba.ventas')::uuid and titulo = 'Tu venta volvió a esperar su OT') = v_antes,
    'La OT que se anula en su propia venta no avisa de ninguna venta reabierta');

  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform test.afirmar(
    exists (select 1 from public.pendientes_de_las_ot() p
             where p.documento = v_p and p.ot_anulada = '49511-' || v_anio and p.venta_anterior_de is null),
    'La venta a la que volvió la OT dice que su OT se anuló');
  perform test.afirmar(
    exists (select 1 from public.pendientes_de_las_ot() p
             where p.documento = v_q and p.ot_anulada is null and p.venta_anterior_de is null),
    'La del medio, cuyo traspaso se deshizo, espera su OT sin decir que se le anuló ninguna');
  perform test.afirmar(
    (select reabierta_por_ot_anulada is null from public.v_cotizaciones_pdf where id = v_q)
    and (select reabierta_por_ot_anulada is null from public.v_cotizaciones_pdf where id = v_p),
    'Y ninguna de las dos figura como reabierta');
  reset role;

  -- b) C se reabre, Administración le carga otra OT y esa se anula en C.
  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform pg_temp.cargar(current_setting('prueba.cotr'), current_setting('prueba.oty'), 'QA-495 Y', '49512');
  perform pg_temp.pasar(current_setting('prueba.oty'), current_setting('prueba.cots'));
  reset role;
  -- Ya tenía una factura: el aviso no promete un botón que la tarjeta no ofrece.
  perform set_config('session_replication_role', 'replica', true);
  insert into public.facturas_venta (codigo_interno, cotizacion_pdf_id, cotizacion_numero, cliente, numero, fecha_emision,
                                     fecha_vencimiento, moneda, total, ruta_storage, nombre_archivo, tamano_bytes, registrado_por)
  values ('QA-495 Y', v_r, 'QA-495-R', 'QA PRIMER COMPRADOR 495', 'E001-4952', current_date - 3, current_date + 27,
          'PEN', 500, 'fv/qa-495-r.pdf', 'qa-495-r.pdf', 120, current_setting('prueba.contable')::uuid);
  perform set_config('session_replication_role', 'origin', true);
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  update public.ordenes_trabajo set estado = 'ANULADA', motivo_anulacion = 'El otro comprador desistió (prueba 495)'
   where id = current_setting('prueba.oty')::uuid;
  reset role;
  perform test.afirmar(
    (select count(*) from public.notificaciones n
      where n.usuario_id = current_setting('prueba.ventas')::uuid and n.titulo = 'Tu venta volvió a esperar su OT'
        and n.origen_id = v_r and n.ruta = '/cotizaciones/pdf?estado=APROBADA_SIN_OT#' || v_r
        and n.cuerpo like 'La QA-495-R de %Contabilidad anula primero su factura y después la cancelas con «Cancelar la venta».'
        and n.cuerpo not like '%49512%') = 1,
    'Quien registró la venta recibe el aviso de que volvió a esperar su OT, con su ruta, sin el número de la OT y diciendo que primero va la factura');
  -- La OT que pasó se anuló «hace una hora»: en la pantalla cada anulación es su envío.
  perform set_config('session_replication_role', 'replica', true);
  update public.ordenes_trabajo set actualizado_en = actualizado_en - interval '1 hour'
   where id = current_setting('prueba.oty')::uuid;
  perform set_config('session_replication_role', 'origin', true);

  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform test.afirmar(
    exists (select 1 from public.pendientes_de_las_ot() p
             where p.documento = v_r and p.ot_anulada = '49512-' || v_anio and p.venta_anterior_de = '49512-' || v_anio)
    and exists (select 1 from public.pendientes_de_las_ot() p
             where p.documento = current_setting('prueba.cots')::uuid and p.ot_anulada = '49512-' || v_anio
               and p.venta_anterior_de is null),
    '«Por completar» distingue la venta reabierta (la OT que pasó y se anuló) de la del otro comprador');
  perform pg_temp.cargar(current_setting('prueba.cotr'), current_setting('prueba.otz'), 'QA-495 Z', '49513');
  perform test.afirmar(
    (select reabierta_por_ot_anulada is null from public.v_cotizaciones_pdf where id = v_r),
    'Con su OT nueva, la venta ya no figura como reabierta');
  reset role;
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  update public.ordenes_trabajo set estado = 'ANULADA', motivo_anulacion = 'Se cargó con datos de otra unidad (prueba 495)'
   where id = current_setting('prueba.otz')::uuid;
  reset role;

  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform test.afirmar(
    exists (select 1 from public.pendientes_de_las_ot() p
             where p.documento = v_r and p.ot_anulada = '49513-' || v_anio and p.venta_anterior_de is null),
    'Anulada su OT nueva, «Por completar» nombra esa y no la que había pasado');
  reset role;
  perform test.como_usuario(current_setting('prueba.ventas')::uuid);
  set local role authenticated;
  perform test.afirmar(
    (select reabierta_por_ot_anulada is null from public.v_cotizaciones_pdf where id = v_r)
    and not public.puede_cancelar_la_venta(v_r),
    'La tarjeta ya no la da por reabierta ni deja cancelarla');
  perform test.debe_fallar(
    format('select public.cancelar_venta_reabierta(%L, %L)', v_r, 'El cliente desistió de la compra (prueba 495)'),
    'Ventas no cancela la venta que espera por su propia OT anulada', 'anularla le toca a Gerencia');
  perform test.debe_fallar(
    format('update public.cotizaciones_pdf set estado = ''ANULADA'', observacion = %L where id = %L',
           'El cliente desistió de la compra (prueba 495)', v_r),
    'Ni por un UPDATE directo', 'No tienes permiso para aprobar ni rechazar');
  reset role;
end $$;

--  c) T se reabrió, Administración le cargó otra OT y esa también pasó a otro
--     comprador: T está cerrada otra vez. No figura como reabierta ni la cancela
--     Ventas (lo encontró la revisión: la tarjeta decía «volvió a esperar su OT»
--     de una venta a la que la base no deja cargarle ninguna).
select set_config('prueba.cott', gen_random_uuid()::text, true);
select set_config('prueba.cotu', gen_random_uuid()::text, true);
select set_config('prueba.cotv', gen_random_uuid()::text, true);
select set_config('prueba.otw1', gen_random_uuid()::text, true);
select set_config('prueba.otw2', gen_random_uuid()::text, true);
do $$
declare
  c record;
  v_t constant uuid := current_setting('prueba.cott')::uuid;
  v_anio constant text := extract(year from current_date)::text;
begin
  perform test.como_usuario(current_setting('prueba.ventas')::uuid);
  set local role authenticated;
  for c in select * from (values
      (current_setting('prueba.cott'), 'QA-495-T', current_setting('prueba.cliente_a')),
      (current_setting('prueba.cotu'), 'QA-495-U', current_setting('prueba.cliente_b')),
      (current_setting('prueba.cotv'), 'QA-495-V', current_setting('prueba.cliente_b'))) as t(id, numero, cliente)
  loop
    insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage,
                                         mime_type, tamano_bytes, registrado_por, monto_venta, moneda, cantidad_unidades)
    values (c.id::uuid, c.numero, c.cliente::uuid, current_setting('prueba.carroceria')::uuid, 'cot.pdf',
            'cot/' || c.id || '/cot.pdf', 'application/pdf', 120, current_setting('prueba.ventas')::uuid, 9000, 'PEN', 1);
  end loop;
  reset role;
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  update public.cotizaciones_pdf set estado = 'APROBADA'
   where id in (v_t, current_setting('prueba.cotu')::uuid, current_setting('prueba.cotv')::uuid);
  reset role;

  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform pg_temp.cargar(current_setting('prueba.cott'), current_setting('prueba.otw1'), 'QA-495 W', '49521');
  perform pg_temp.pasar(current_setting('prueba.otw1'), current_setting('prueba.cotu'));
  reset role;
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  update public.ordenes_trabajo set estado = 'ANULADA', motivo_anulacion = 'El otro comprador desistió (prueba 495)'
   where id = current_setting('prueba.otw1')::uuid;
  reset role;
  perform test.como_usuario(current_setting('prueba.ventas')::uuid);
  set local role authenticated;
  perform test.afirmar(
    (select reabierta_por_ot_anulada->>'numero' from public.v_cotizaciones_pdf where id = v_t) = '49521-' || v_anio
    and public.puede_cancelar_la_venta(v_t),
    'La venta se reabre y quien la registró puede cancelarla');
  reset role;

  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform pg_temp.cargar(current_setting('prueba.cott'), current_setting('prueba.otw2'), 'QA-495 V', '49522');
  perform pg_temp.pasar(current_setting('prueba.otw2'), current_setting('prueba.cotv'));
  perform test.afirmar(
    (select ordenes_faltantes = 0 and ordenes_a_otro_comprador = array['49522-' || v_anio] and reabierta_por_ot_anulada is null
       from public.v_cotizaciones_pdf where id = v_t)
    and not exists (select 1 from public.pendientes_de_las_ot() p where p.documento = v_t),
    'Con su OT nueva en otro comprador, la venta está cerrada otra vez: ni reabierta ni en «Por completar»');
  reset role;
  perform test.como_usuario(current_setting('prueba.ventas')::uuid);
  set local role authenticated;
  perform test.afirmar(
    (select reabierta_por_ot_anulada is null from public.v_cotizaciones_pdf where id = v_t)
    and not public.puede_cancelar_la_venta(v_t),
    'Ventas ya no la ve como reabierta ni puede cancelarla');
  perform test.debe_fallar(
    format('select public.cancelar_venta_reabierta(%L, %L)', v_t, 'El cliente desistió de la compra (prueba 495)'),
    'La función la rechaza', 'anularla le toca a Gerencia');
  perform test.debe_fallar(
    format('update public.cotizaciones_pdf set estado = ''ANULADA'', observacion = %L where id = %L',
           'El cliente desistió de la compra (prueba 495)', v_t),
    'Y el UPDATE directo también', 'No tienes permiso para aprobar ni rechazar');
  reset role;
end $$;

--  d) La de dos unidades: la OT de la unidad 1 pasó a otro comprador y allí se
--     anuló, y Administración volvió a cargar esa unidad. Falta la 2, que nunca
--     tuvo OT: la fila de «Por completar» no dice que la venta «volvió a esperar
--     su OT» (no se reabrió: tiene una OT vigente), y Almacén no lee nada de la
--     función que la arma.
select set_config('prueba.cotm', gen_random_uuid()::text, true);
select set_config('prueba.cotn', gen_random_uuid()::text, true);
select set_config('prueba.otm1', gen_random_uuid()::text, true);
select set_config('prueba.otm2', gen_random_uuid()::text, true);
do $$
declare
  c record;
  v_m constant uuid := current_setting('prueba.cotm')::uuid;
  v_anio constant text := extract(year from current_date)::text;
begin
  perform test.como_usuario(current_setting('prueba.ventas')::uuid);
  set local role authenticated;
  for c in select * from (values
      (current_setting('prueba.cotm'), 'QA-495-M', current_setting('prueba.cliente_a'), 2),
      (current_setting('prueba.cotn'), 'QA-495-N', current_setting('prueba.cliente_b'), 1)) as t(id, numero, cliente, unidades)
  loop
    insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage,
                                         mime_type, tamano_bytes, registrado_por, monto_venta, moneda, cantidad_unidades)
    values (c.id::uuid, c.numero, c.cliente::uuid, current_setting('prueba.carroceria')::uuid, 'cot.pdf',
            'cot/' || c.id || '/cot.pdf', 'application/pdf', 120, current_setting('prueba.ventas')::uuid, 9000, 'PEN', c.unidades);
  end loop;
  reset role;
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  update public.cotizaciones_pdf set estado = 'APROBADA' where id in (v_m, current_setting('prueba.cotn')::uuid);
  reset role;

  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform pg_temp.cargar(current_setting('prueba.cotm'), current_setting('prueba.otm1'), 'QA-495 M', '49531');
  perform pg_temp.pasar(current_setting('prueba.otm1'), current_setting('prueba.cotn'));
  reset role;
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  update public.ordenes_trabajo set estado = 'ANULADA', motivo_anulacion = 'El otro comprador desistió (prueba 495)'
   where id = current_setting('prueba.otm1')::uuid;
  reset role;

  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform test.afirmar(
    exists (select 1 from public.pendientes_de_las_ot() p
             where p.documento = v_m and p.ot_anulada = '49531-' || v_anio and p.venta_anterior_de = '49531-' || v_anio),
    'La de dos unidades, sin ninguna OT vigente, se reabre: «Por completar» lo dice');
  perform pg_temp.cargar(current_setting('prueba.cotm'), current_setting('prueba.otm2'), 'QA-495 N', '49532');
  perform test.afirmar(
    exists (select 1 from public.pendientes_de_las_ot() p
             where p.documento = v_m and p.trabajo like '%falta 1 de 2 OT' and p.venta_anterior_de is null),
    'Con esa unidad cargada otra vez, sigue en «Por completar» por la que falta, sin decir que volvió a esperar su OT');
  perform test.afirmar(
    (select reabierta_por_ot_anulada is null from public.v_cotizaciones_pdf where id = v_m),
    'Y la tarjeta no la da por reabierta');
  perform test.afirmar(
    (select count(*) from public.ultima_ot_anulada_de_la_venta(v_m)) = 1,
    'Quien carga las OT lee cuál fue la última anulada');
  reset role;
  perform test.como_usuario(current_setting('prueba.almacen')::uuid);
  set local role authenticated;
  perform test.afirmar(
    (select count(*) from public.ultima_ot_anulada_de_la_venta(v_m)) = 0,
    'Almacén no lee nada de la última OT anulada de una cotización');
  reset role;
end $$;

rollback;
