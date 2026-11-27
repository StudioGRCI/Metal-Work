-- La OT que pasa a otro comprador toma la unidad libre de su nueva cotización
-- (migración 20261127003000; StudioGRCI, 2026-11-27: «Sí, en un PR aparte»).
-- Hasta aquí la OT conservaba su número de unidad al pasar, y la base rechazaba:
--   * la OT de la unidad 2 o la 3 hacia una cotización de 1 unidad («no tiene
--     unidad 2»),
--   * cualquier OT hacia una cotización que ya tenía una OT («La nueva
--     cotización ya tiene una OT.»), aunque le faltaran unidades.
-- Desde aquí:
--   * toma la primera unidad libre de la cotización nueva (ni con OT vigente ni
--     que pasó a otro comprador), y si vuelve a una cotización donde estuvo, la
--     que tenía allí;
--   * la unidad que dejó queda con su venta anterior, y de ahí la leen la carga
--     (no la vuelve a dar), la tarjeta y Facturación;
--   * la cotización llena la rechaza con el mensaje de siempre;
--   * colgar la OT de otra cotización por fuera de «Editar OT», o cambiar su
--     número a mano, sigue sin poder hacerse.
-- Cada paso con la cuenta del puesto que lo hace (Administración) y `set local
-- role authenticated`, y Ventas y Almacén, que no editan OT, no entran.
-- Termina en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social)
select '20100000499', 'PRUEBAS 499 S.A.C.' where not exists (select 1 from public.empresa);
insert into public.sedes (codigo, nombre) values ('QA499U', 'Taller prueba 499 unidad') on conflict (codigo) do nothing;
select id as sede_id from public.sedes where codigo = 'QA499U' \gset
select test.crear_usuario('Gema', 'Gerente', 'gerente499u@demo.pe', 'GERENTE', :'sede_id') as gerente_id \gset
select test.crear_usuario('Vico', 'Ventas', 'ventas499u@demo.pe', 'VENDEDOR', :'sede_id') as ventas_id \gset
select test.crear_usuario('Olga', 'Oficina', 'oficina499u@demo.pe', 'ADMINISTRACION', :'sede_id') as oficina_id \gset
select test.crear_usuario('Alfo', 'Almacén', 'almacen499u@demo.pe', 'ALMACENERO', :'sede_id') as almacen_id \gset
select test.crear_usuario('Cora', 'Contable', 'contabilidad499u@demo.pe', 'CONTABILIDAD', :'sede_id') as contable_id \gset

insert into public.clientes (tipo_documento, numero_documento, razon_social) values ('RUC', '20990000499', 'QA PRIMER COMPRADOR 499');
insert into public.clientes (tipo_documento, numero_documento, razon_social) values ('RUC', '20990001499', 'QA SEGUNDO COMPRADOR 499');
insert into public.clientes (tipo_documento, numero_documento, razon_social) values ('RUC', '20990002499', 'QA TERCER COMPRADOR 499');

select set_config('prueba.gerente', :'gerente_id', true);
select set_config('prueba.ventas', :'ventas_id', true);
select set_config('prueba.oficina', :'oficina_id', true);
select set_config('prueba.almacen', :'almacen_id', true);
select set_config('prueba.contable', :'contable_id', true);
select set_config('prueba.cliente_a', (select id::text from public.clientes where numero_documento = '20990000499'), true);
select set_config('prueba.cliente_b', (select id::text from public.clientes where numero_documento = '20990001499'), true);
select set_config('prueba.cliente_c', (select id::text from public.clientes where numero_documento = '20990002499'), true);
select set_config('prueba.carroceria', (select id::text from public.tipos_carroceria where activo order by orden_secuencia limit 1), true);
select set_config('prueba.cot_a', gen_random_uuid()::text, true);   -- primer comprador, 3 unidades, sus 3 OT
select set_config('prueba.cot_b', gen_random_uuid()::text, true);   -- segundo comprador, 1 unidad, sin OT
select set_config('prueba.cot_c', gen_random_uuid()::text, true);   -- tercer comprador, 3 unidades, una OT
select set_config('prueba.ot1', gen_random_uuid()::text, true);
select set_config('prueba.ot2', gen_random_uuid()::text, true);
select set_config('prueba.ot3', gen_random_uuid()::text, true);
select set_config('prueba.otc1', gen_random_uuid()::text, true);
select set_config('prueba.otc2', gen_random_uuid()::text, true);
select set_config('prueba.otx', gen_random_uuid()::text, true);

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
    'El cliente cedió la unidad a otro comprador (prueba 499)');
end $$;

create function pg_temp.unidad(p_ot text) returns integer
language sql as $$ select coalesce(numero_de_unidad, 1)::integer from public.ordenes_trabajo where id = p_ot::uuid $$;

create function pg_temp.salieron(p_cot text) returns text
language sql as $$
  select string_agg(e->>'unidad', ',' order by (e->>'unidad')::integer)
    from jsonb_array_elements(public.unidades_que_salieron_de_la_cotizacion(p_cot::uuid)) e
$$;

-- 1. Ventas sube tres cotizaciones, Gerencia las aprueba y Administración carga --
do $$
declare
  c record;
begin
  perform test.como_usuario(current_setting('prueba.ventas')::uuid);
  set local role authenticated;
  for c in select * from (values
      (current_setting('prueba.cot_a'), 'QA-499-A', current_setting('prueba.cliente_a'), 3),
      (current_setting('prueba.cot_b'), 'QA-499-B', current_setting('prueba.cliente_b'), 1),
      (current_setting('prueba.cot_c'), 'QA-499-C', current_setting('prueba.cliente_c'), 3)) as t(id, numero, cliente, unidades)
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
   where id in (current_setting('prueba.cot_a')::uuid, current_setting('prueba.cot_b')::uuid, current_setting('prueba.cot_c')::uuid);
  reset role;

  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform pg_temp.cargar(current_setting('prueba.cot_a'), current_setting('prueba.ot1'), 'QA-499 A1', '49911');
  perform pg_temp.cargar(current_setting('prueba.cot_a'), current_setting('prueba.ot2'), 'QA-499 A2', '49912');
  perform pg_temp.cargar(current_setting('prueba.cot_a'), current_setting('prueba.ot3'), 'QA-499 A3', '49913');
  perform pg_temp.cargar(current_setting('prueba.cot_c'), current_setting('prueba.otc1'), 'QA-499 C1', '49921');
  reset role;

  perform test.afirmar(pg_temp.unidad(current_setting('prueba.ot2')) = 2 and pg_temp.unidad(current_setting('prueba.ot3')) = 3
                       and pg_temp.unidad(current_setting('prueba.otc1')) = 1,
    'Las OT de la de tres unidades son la 1, la 2 y la 3; la de la otra, la 1');
end $$;

-- 2. Ventas y Almacén no pasan una OT a otro comprador ---------------------------
do $$
begin
  perform test.como_usuario(current_setting('prueba.ventas')::uuid);
  set local role authenticated;
  perform test.debe_fallar(
    format('select pg_temp.pasar(%L, %L)', current_setting('prueba.ot2'), current_setting('prueba.cot_b')),
    'Ventas no pasa una OT a otro comprador', 'permiso');
  reset role;
  perform test.como_usuario(current_setting('prueba.almacen')::uuid);
  set local role authenticated;
  perform test.debe_fallar(
    format('select pg_temp.pasar(%L, %L)', current_setting('prueba.ot2'), current_setting('prueba.cot_b')),
    'Almacén no pasa una OT a otro comprador', 'permiso');
  reset role;
  perform test.afirmar(
    (select cotizacion_pdf_id from public.ordenes_trabajo where id = current_setting('prueba.ot2')::uuid) = current_setting('prueba.cot_a')::uuid
    and not exists (select 1 from public.ot_ventas_anteriores where orden_id = current_setting('prueba.ot2')::uuid),
    'Y la OT sigue donde estaba, sin venta anterior');
end $$;

-- 3. La unidad 2 pasa a una cotización de 1 unidad: es su unidad 1 ---------------
do $$
declare
  v record;
begin
  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform pg_temp.pasar(current_setting('prueba.ot2'), current_setting('prueba.cot_b'));
  reset role;

  select o.cotizacion_pdf_id, coalesce(o.numero_de_unidad, 1) as unidad, va.numero_de_unidad as dejo
    into v
    from public.ordenes_trabajo o
    join public.ot_ventas_anteriores va on va.orden_id = o.id and va.cotizacion_pdf_id = current_setting('prueba.cot_a')::uuid
   where o.id = current_setting('prueba.ot2')::uuid;
  perform test.afirmar(v.cotizacion_pdf_id = current_setting('prueba.cot_b')::uuid and v.unidad = 1 and v.dejo = 2,
    format('La OT de la unidad 2 pasó a la cotización de 1 unidad como su unidad 1, y su venta anterior guarda que era la 2 (es %s, dejó %s)',
           v.unidad, v.dejo));
  perform test.afirmar(pg_temp.salieron(current_setting('prueba.cot_a')) = '2',
    'La cotización de antes sabe que salió su unidad 2, no la 1: ' || coalesce(pg_temp.salieron(current_setting('prueba.cot_a')), 'ninguna'));
  perform test.afirmar(public.unidad_que_dejo_la_ot(current_setting('prueba.ot2')::uuid, current_setting('prueba.cot_a')::uuid) = 2,
    'El ayudante del recorrido dice la misma unidad');

  -- La tarjeta, como la lee Administración: la 1 y la 3 con su OT, la 2 pasó.
  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  select * into v from public.v_cotizaciones_pdf where id = current_setting('prueba.cot_a')::uuid;
  perform test.afirmar(v.ordenes_vigentes = 2 and v.ordenes_faltantes = 0
                       and (v.unidades_a_otro_comprador->0->>'unidad')::integer = 2,
    'La tarjeta de la de tres unidades: dos OT, ninguna falta, y la que pasó es la unidad 2');
  select * into v from public.v_cotizaciones_pdf where id = current_setting('prueba.cot_b')::uuid;
  perform test.afirmar(v.ordenes_vigentes = 1 and v.ordenes_faltantes = 0,
    'La cotización nueva tiene su OT');
  reset role;
end $$;

-- 4. La unidad 3 pasa a una cotización de tres que ya tiene una OT ---------------
do $$
begin
  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform pg_temp.pasar(current_setting('prueba.ot3'), current_setting('prueba.cot_c'));
  reset role;
  perform test.afirmar(
    (select cotizacion_pdf_id from public.ordenes_trabajo where id = current_setting('prueba.ot3')::uuid) = current_setting('prueba.cot_c')::uuid
    and pg_temp.unidad(current_setting('prueba.ot3')) = 2,
    'La OT de la unidad 3 entra en la cotización que ya tenía una OT, como su unidad 2 (la primera libre): es '
      || pg_temp.unidad(current_setting('prueba.ot3')));
  perform test.afirmar(pg_temp.salieron(current_setting('prueba.cot_a')) = '2,3',
    'De la primera salieron la 2 y la 3: ' || coalesce(pg_temp.salieron(current_setting('prueba.cot_a')), 'ninguna'));

  -- La carga de la OT que falta en la de tres no vuelve a dar la 2.
  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform pg_temp.cargar(current_setting('prueba.cot_c'), current_setting('prueba.otc2'), 'QA-499 C3', '49923');
  reset role;
  perform test.afirmar(pg_temp.unidad(current_setting('prueba.otc2')) = 3,
    'La OT que Administración carga después en esa cotización es la unidad 3');
end $$;

-- 5. Una cotización llena no recibe otra OT, con el mensaje de siempre ------------
do $$
declare
  v_anio constant text := to_char((now() at time zone 'America/Lima')::date, 'YYYY');
begin
  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform test.debe_fallar(
    format('select pg_temp.pasar(%L, %L)', current_setting('prueba.ot1'), current_setting('prueba.cot_c')),
    'La de tres unidades con sus tres OT no recibe una cuarta',
    'es de 3 unidades y ya tiene sus 3 OT');
  perform test.debe_fallar(
    format('select pg_temp.pasar(%L, %L)', current_setting('prueba.ot1'), current_setting('prueba.cot_b')),
    'La de una unidad con su OT no recibe otra, y dice cuál tiene',
    'ya tiene su OT 49912-' || v_anio);
  -- La primera ya no tiene unidad libre: la 1 con su OT, la 2 y la 3 pasaron.
  perform test.debe_fallar(
    format('select pg_temp.cargar(%L, %L, %L, %L)', current_setting('prueba.cot_a'), current_setting('prueba.otx'), 'QA-499 AX', '49919'),
    'A la primera no se le carga otra OT', 'pasaron a otro comprador');
  reset role;
  perform test.afirmar(
    (select cotizacion_pdf_id from public.ordenes_trabajo where id = current_setting('prueba.ot1')::uuid) = current_setting('prueba.cot_a')::uuid
    and pg_temp.unidad(current_setting('prueba.ot1')) = 1
    and (select count(*) from public.ot_ventas_anteriores where orden_id = current_setting('prueba.ot1')::uuid) = 0,
    'El traspaso rechazado no deja nada: la OT sigue siendo la unidad 1 de la primera, sin venta anterior');
end $$;

-- 6. Si el traspaso fue un error, la OT vuelve a la unidad que tenía --------------
do $$
declare
  v record;
begin
  -- Cada traspaso es su propio envío: el de la sección 3 pasó «hace una hora».
  perform set_config('session_replication_role', 'replica', true);
  update public.ot_ventas_anteriores set creado_en = creado_en - interval '1 hour';
  perform set_config('session_replication_role', 'origin', true);

  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform pg_temp.pasar(current_setting('prueba.ot2'), current_setting('prueba.cot_a'));
  reset role;
  perform test.afirmar(
    (select cotizacion_pdf_id from public.ordenes_trabajo where id = current_setting('prueba.ot2')::uuid) = current_setting('prueba.cot_a')::uuid
    and pg_temp.unidad(current_setting('prueba.ot2')) = 2,
    'La OT que vuelve a su venta vuelve a ser su unidad 2, no la primera libre: es ' || pg_temp.unidad(current_setting('prueba.ot2')));
  perform test.afirmar(pg_temp.salieron(current_setting('prueba.cot_a')) = '3',
    'De la primera ya solo salió la 3: ' || coalesce(pg_temp.salieron(current_setting('prueba.cot_a')), 'ninguna'));
  perform test.afirmar(
    (select va.numero_de_unidad from public.ot_ventas_anteriores va
      where va.orden_id = current_setting('prueba.ot2')::uuid and va.cotizacion_pdf_id = current_setting('prueba.cot_b')::uuid) = 1,
    'Y su paso por la de una unidad queda anotado como su unidad 1');

  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  select * into v from public.v_cotizaciones_pdf where id = current_setting('prueba.cot_b')::uuid;
  perform test.afirmar(v.ordenes_vigentes = 0 and v.ordenes_faltantes = 1 and cardinality(v.ordenes_a_otro_comprador) = 0,
    'La de una unidad, cuya OT volvió, vuelve a esperar su OT');
  reset role;
end $$;

-- 7. Fuera de «Editar OT», nada cambia de unidad ---------------------------------
do $$
begin
  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform test.debe_fallar(
    format('update public.ordenes_trabajo set numero_de_unidad = 3 where id = %L', current_setting('prueba.ot1')),
    'Administración no cambia a mano la unidad de una OT', 'eso no se cambia');
  -- Colgarla de otra cotización por la API, sin venta anterior ni historial:
  -- antes entraba con cualquiera de los permisos de editar la OT.
  perform test.debe_fallar(
    format('update public.ordenes_trabajo set cotizacion_pdf_id = %L where id = %L',
           current_setting('prueba.cot_b'), current_setting('prueba.ot2')),
    'Administración no cuelga la OT de otra cotización por fuera de «Editar OT»',
    'solo con «Editar OT / cambiar cliente»');
  reset role;
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  perform test.debe_fallar(
    format('update public.ordenes_trabajo set cotizacion_pdf_id = %L where id = %L',
           current_setting('prueba.cot_b'), current_setting('prueba.ot1')),
    'Gerencia tampoco', 'solo con «Editar OT / cambiar cliente»');
  -- En dos pasos: primero sin cotización, después otra. El primer paso dejaba
  -- la venta esperando otra OT con su vehículo todavía en el taller.
  perform test.debe_fallar(
    format('update public.ordenes_trabajo set cotizacion_pdf_id = null where id = %L', current_setting('prueba.ot1')),
    'Gerencia no le quita la cotización a la OT', 'solo con «Editar OT / cambiar cliente»');
  -- Anularla y cambiarla en el mismo UPDATE la colgaba, anulada, de otra venta.
  perform test.debe_fallar(
    format('update public.ordenes_trabajo set estado = ''ANULADA'', motivo_anulacion = ''Prueba 499, anular y mover'', cotizacion_pdf_id = %L where id = %L',
           current_setting('prueba.cot_b'), current_setting('prueba.ot1')),
    'Gerencia no la anula y la cambia de cotización a la vez', 'solo con «Editar OT / cambiar cliente»');
  reset role;
  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform test.debe_fallar(
    format('update public.ordenes_trabajo set cotizacion_pdf_id = null where id = %L', current_setting('prueba.ot2')),
    'Administración tampoco le quita la cotización', 'solo con «Editar OT / cambiar cliente»');
  reset role;
  perform test.afirmar(
    (select cotizacion_pdf_id from public.ordenes_trabajo where id = current_setting('prueba.ot1')::uuid) = current_setting('prueba.cot_a')::uuid
    and (select estado from public.ordenes_trabajo where id = current_setting('prueba.ot1')::uuid) <> 'ANULADA',
    'Y la OT sigue en su cotización, sin anular');

  -- Una OT sin cotización tampoco se cuelga por la API: tomaba la unidad 1
  -- aunque esa unidad hubiera salido a otro comprador. Sin sesión (una
  -- migración) sí se le quita.
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  update public.ordenes_trabajo set cotizacion_pdf_id = null where id = current_setting('prueba.ot1')::uuid;
  perform test.afirmar(
    (select cotizacion_pdf_id from public.ordenes_trabajo where id = current_setting('prueba.ot1')::uuid) is null,
    'Sin sesión se le quita la cotización, como antes');
  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform test.debe_fallar(
    format('update public.ordenes_trabajo set cotizacion_pdf_id = %L where id = %L',
           current_setting('prueba.cot_a'), current_setting('prueba.ot1')),
    'Administración no cuelga por la API una OT que no tenía cotización', 'solo con «Editar OT / cambiar cliente»');
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  update public.ordenes_trabajo set cotizacion_pdf_id = current_setting('prueba.cot_a')::uuid where id = current_setting('prueba.ot1')::uuid;
end $$;

-- 8. Contabilidad factura la unidad que llegó por su parte de la cotización nueva --
do $$
begin
  perform test.como_usuario(current_setting('prueba.contable')::uuid);
  set local role authenticated;
  perform test.afirmar(
    (select public.normalizar_codigo_interno(f.codigo_interno) from public.facturacion_por_unidad(array[current_setting('prueba.cot_c')::uuid]) f where f.numero_de_unidad = 2)
      = public.normalizar_codigo_interno('QA-499 A3'),
    'En la cotización nueva, la unidad 2 es la del código de la OT que llegó');
  perform test.afirmar(
    (select f.codigo_interno from public.facturacion_por_unidad(array[current_setting('prueba.cot_a')::uuid]) f where f.numero_de_unidad = 3) is null,
    'En la de antes, la unidad 3 ya no tiene OT');
  reset role;
end $$;

-- 9. La unidad libre con la factura de otro vehículo se deja para el último -------
-- En la de tres, la unidad 2 se facturó y Gerencia anuló su OT: esa factura es
-- de ese vehículo. La OT que llega toma la 3, que no tiene factura, aunque la
-- 2 esté antes. Y su descripción y su historial dicen la cotización y la
-- unidad nuevas.
select set_config('prueba.cot_d', gen_random_uuid()::text, true);
select set_config('prueba.cot_e', gen_random_uuid()::text, true);
select set_config('prueba.otd1', gen_random_uuid()::text, true);
select set_config('prueba.otd2', gen_random_uuid()::text, true);
select set_config('prueba.ote1', gen_random_uuid()::text, true);
select set_config('prueba.fd2', gen_random_uuid()::text, true);
select set_config('prueba.fd2_ruta', current_setting('prueba.fd2') || '/' || gen_random_uuid() || '.pdf', true);
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('facturas-venta', current_setting('prueba.fd2_ruta'), current_setting('prueba.contable'),
        '{"mimetype": "application/pdf", "size": 900}');
do $$
declare
  v_anio constant text := to_char((now() at time zone 'America/Lima')::date, 'YYYY');
  v_hoy  constant date := (now() at time zone 'America/Lima')::date;
  v record;
begin
  perform test.como_usuario(current_setting('prueba.ventas')::uuid);
  set local role authenticated;
  insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage,
                                       mime_type, tamano_bytes, registrado_por, monto_venta, moneda, cantidad_unidades)
  values (current_setting('prueba.cot_d')::uuid, 'QA-499-D', current_setting('prueba.cliente_c')::uuid, current_setting('prueba.carroceria')::uuid,
          'cot.pdf', 'cot/' || current_setting('prueba.cot_d') || '/cot.pdf', 'application/pdf', 120, current_setting('prueba.ventas')::uuid, 9000, 'PEN', 3),
         (current_setting('prueba.cot_e')::uuid, 'QA-499-E', current_setting('prueba.cliente_a')::uuid, current_setting('prueba.carroceria')::uuid,
          'cot.pdf', 'cot/' || current_setting('prueba.cot_e') || '/cot.pdf', 'application/pdf', 120, current_setting('prueba.ventas')::uuid, 9000, 'PEN', 1);
  reset role;
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  update public.cotizaciones_pdf set estado = 'APROBADA'
   where id in (current_setting('prueba.cot_d')::uuid, current_setting('prueba.cot_e')::uuid);
  reset role;

  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform pg_temp.cargar(current_setting('prueba.cot_d'), current_setting('prueba.otd1'), 'QA-499 D1', '49931');
  perform pg_temp.cargar(current_setting('prueba.cot_d'), current_setting('prueba.otd2'), 'QA-499 D2', '49932');
  perform pg_temp.cargar(current_setting('prueba.cot_e'), current_setting('prueba.ote1'), 'QA-499 E1', '49941');
  reset role;

  perform test.como_usuario(current_setting('prueba.contable')::uuid);
  set local role authenticated;
  perform public.registrar_factura_venta_de_unidad(current_setting('prueba.fd2')::uuid, current_setting('prueba.cot_d')::uuid, 'E499-2',
    v_hoy, v_hoy + 30, 'PEN', 3000, null, current_setting('prueba.fd2_ruta'), 'f.pdf', 2);
  reset role;

  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  update public.ordenes_trabajo set estado = 'ANULADA', motivo_anulacion = 'El cliente cambió el vehículo (prueba 499)'
   where id = current_setting('prueba.otd2')::uuid;
  reset role;

  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform pg_temp.pasar(current_setting('prueba.ote1'), current_setting('prueba.cot_d'));
  reset role;

  perform test.afirmar(pg_temp.unidad(current_setting('prueba.ote1')) = 3,
    'La OT que llega toma la unidad 3, sin factura, y no la 2, que tiene la factura de otro vehículo: es '
      || pg_temp.unidad(current_setting('prueba.ote1')));
  select descripcion into v from public.ordenes_trabajo where id = current_setting('prueba.ote1')::uuid;
  perform test.afirmar(v.descripcion like '%cotización QA-499-D · unidad 3 de 3'
                       and v.descripcion not like '%QA-499-E%',
    'Su descripción dice la cotización y la unidad nuevas: ' || v.descripcion);
  perform test.afirmar(
    exists (select 1 from public.ot_bitacora e where e.orden_id = current_setting('prueba.ote1')::uuid
               and e.descripcion like 'Edición de OT.%' and e.descripcion like '%unidad: 1 → 3%'),
    'Y su historial dice el cambio de unidad');
end $$;

-- 10. La descripción escrita a mano no se reescribe ------------------------------
-- Solo se pone al día la que termina como la deja la carga. Una que nombra la
-- cotización en medio del texto queda tal cual.
do $$
declare
  v_texto constant text := 'Según cotización QA-499-D se cambia el piso; ver plano 4';
begin
  perform set_config('request.jwt.claim.sub', '', true);
  update public.ordenes_trabajo set descripcion = v_texto where id = current_setting('prueba.otd1')::uuid;
  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform pg_temp.pasar(current_setting('prueba.otd1'), current_setting('prueba.cot_b'));
  reset role;
  perform test.afirmar(
    (select cotizacion_pdf_id from public.ordenes_trabajo where id = current_setting('prueba.otd1')::uuid) = current_setting('prueba.cot_b')::uuid,
    'La OT pasó a la otra cotización');
  perform test.afirmar(
    (select descripcion from public.ordenes_trabajo where id = current_setting('prueba.otd1')::uuid) = v_texto,
    'Y su descripción escrita a mano sigue igual: '
      || (select descripcion from public.ordenes_trabajo where id = current_setting('prueba.otd1')::uuid));
end $$;

rollback;
