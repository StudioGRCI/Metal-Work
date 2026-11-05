-- Gerencia aprueba la cotización con un toque; Administración le da su código
-- interno y sube su OT (migraciones 20261027200000 y 20261027201000).
-- Hasta el 27/10 Gerencia aprobaba en una sola ventana dando el código y la OT
-- (20261016900000, que este check probaba con otro nombre). Gerencia pidió solo
-- aprobar: el código, el número, el PDF, el tipo, el chasis y la fecha de entrega
-- al cliente los carga Administración, que recibe el aviso de cada aprobada. La
-- carga sigue siendo todo junto o nada. Diseño ve la OT dentro del código, con
-- su PDF; Contabilidad la ve con su código para facturarla. Cada paso con la
-- cuenta del área que lo hace y `set local role authenticated`; ADMIN no prueba
-- nada aquí.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social)
select '20100000390', 'PRUEBAS COTIZACION S.A.C.' where not exists (select 1 from public.empresa);
insert into public.sedes (codigo, nombre) values ('QA90', 'Taller prueba de cotización') on conflict (codigo) do nothing;

select test.crear_usuario('Gema', 'Gerente', 'gerencia390@demo.pe', 'GERENTE', (select id from public.sedes where codigo = 'QA90')) as gerente_id \gset
select test.crear_usuario('Vico', 'Ventas', 'ventas390@demo.pe', 'VENDEDOR', (select id from public.sedes where codigo = 'QA90')) as vendedor_id \gset
select test.crear_usuario('Olga', 'Oficina', 'oficina390@demo.pe', 'ADMINISTRACION', (select id from public.sedes where codigo = 'QA90')) as oficina_id \gset
select test.crear_usuario('Dina', 'Diseño', 'diseno390@demo.pe', 'DISENO', (select id from public.sedes where codigo = 'QA90')) as diseno_id \gset
select test.crear_usuario('Coni', 'Contable', 'contabilidad390@demo.pe', 'CONTABILIDAD', (select id from public.sedes where codigo = 'QA90')) as conta_id \gset

insert into public.clientes (tipo_documento, numero_documento, razon_social) values
  ('RUC', '20990000390', 'QA CLIENTE 390'),
  ('RUC', '20990000391', 'QA OTRO CLIENTE 391');
select id as cliente_id from public.clientes where numero_documento = '20990000390' \gset
select id as otro_cliente_id from public.clientes where numero_documento = '20990000391' \gset
select id as carroceria_id from public.tipos_carroceria where activo order by orden_secuencia limit 1 \gset

select set_config('prueba.gerente', :'gerente_id', true);
select set_config('prueba.vendedor', :'vendedor_id', true);
select set_config('prueba.oficina', :'oficina_id', true);
select set_config('prueba.diseno', :'diseno_id', true);
select set_config('prueba.conta', :'conta_id', true);
select set_config('prueba.cliente', :'cliente_id', true);
select set_config('prueba.otro_cliente', :'otro_cliente_id', true);
select set_config('prueba.carroceria', :'carroceria_id', true);
select set_config('prueba.anio', to_char((now() at time zone 'America/Lima')::date, 'YYYY'), true);
select set_config('prueba.cot_a', gen_random_uuid()::text, true);
select set_config('prueba.cot_b', gen_random_uuid()::text, true);
select set_config('prueba.cot_c', gen_random_uuid()::text, true);
select set_config('prueba.cot_d', gen_random_uuid()::text, true);
select set_config('prueba.ot_a', gen_random_uuid()::text, true);
select set_config('prueba.ot_b', gen_random_uuid()::text, true);
select set_config('prueba.ot_c', gen_random_uuid()::text, true);
select set_config('prueba.ot_d', gen_random_uuid()::text, true);

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

-- Ventas sube cuatro cotizaciones: tres de un cliente y una de otro.
do $$
begin
  perform test.como_usuario(current_setting('prueba.vendedor')::uuid);
  set local role authenticated;
  insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage,
                                       mime_type, tamano_bytes, registrado_por, monto_venta, moneda)
  select x.id::uuid, x.numero, x.cliente::uuid, current_setting('prueba.carroceria')::uuid, x.numero || '.pdf',
         'cot/' || x.id || '/' || x.numero || '.pdf', 'application/pdf', 120,
         current_setting('prueba.vendedor')::uuid, 10000, 'PEN'
    from (values
      (current_setting('prueba.cot_a'), 'QA-390-A', current_setting('prueba.cliente')),
      (current_setting('prueba.cot_b'), 'QA-390-B', current_setting('prueba.cliente')),
      (current_setting('prueba.cot_c'), 'QA-390-C', current_setting('prueba.otro_cliente')),
      (current_setting('prueba.cot_d'), 'QA-390-D', current_setting('prueba.cliente'))
    ) as x(id, numero, cliente);
  reset role;
end $$;

-- 1. Gerencia aprueba con un toque, sin código ni OT ------------------------------
do $$
declare v integer;
begin
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  update public.cotizaciones_pdf set estado = 'APROBADA' where id = current_setting('prueba.cot_a')::uuid;
  get diagnostics v = row_count;
  perform test.afirmar(v = 1, 'Gerencia aprueba la cotización con un toque');
  -- Rechazar sigue igual.
  update public.cotizaciones_pdf set estado = 'RECHAZADA', observacion = 'Falta el plazo'
   where id = current_setting('prueba.cot_b')::uuid;
  get diagnostics v = row_count;
  perform test.afirmar(v = 1, 'Gerencia rechaza con su observación como antes');
  reset role;

  perform test.afirmar(
    (select estado::text = 'APROBADA' and revisado_por = current_setting('prueba.gerente')::uuid
       from public.cotizaciones_pdf where id = current_setting('prueba.cot_a')::uuid)
    and not exists (select 1 from public.ordenes_trabajo where cotizacion_pdf_id = current_setting('prueba.cot_a')::uuid),
    'La cotización queda aprobada por Gerencia y sin OT todavía');
  perform test.afirmar(
    exists (select 1 from public.notificaciones n where n.usuario_id = current_setting('prueba.oficina')::uuid
              and n.titulo = 'Cotización aprobada: falta su código y su OT'
              and n.cuerpo = 'Gerencia aprobó la QA-390-A de QA CLIENTE 390. Dale su código interno y sube su OT.'
              and n.ruta = '/cotizaciones/pdf?estado=APROBADA_SIN_OT#' || current_setting('prueba.cot_a')),
    'Administración recibe el aviso de la aprobada, con el enlace a su fila');
  perform test.afirmar(
    not exists (select 1 from public.notificaciones n
                 where n.titulo = 'Cotización aprobada: falta su código y su OT'
                   and n.usuario_id in (current_setting('prueba.gerente')::uuid, current_setting('prueba.vendedor')::uuid,
                                        current_setting('prueba.diseno')::uuid, current_setting('prueba.conta')::uuid)),
    'Ese aviso no le llega a nadie más');
  perform test.afirmar(
    (select n.cuerpo from public.notificaciones n where n.usuario_id = current_setting('prueba.vendedor')::uuid
       and n.titulo = 'Gerencia aprobó tu cotización' and n.origen_id = current_setting('prueba.cot_a')::uuid)
      = 'La QA-390-A de QA CLIENTE 390. Administración le da su código interno y sube su OT.',
    'Ventas sabe que su cotización se aprobó y que el código llega después');
end $$;

-- 2. Quién da el código y sube la OT --------------------------------------------
do $$
declare
  v_llamada text := format(
    'select public.cargar_codigo_y_ot_de_cotizacion(%L, %L, %L, %L, %L, %L, %L, %L, 100)',
    current_setting('prueba.cot_a'), current_setting('prueba.ot_a'), 'QA-390 A', '12345', 'SEMIRREMOLQUE',
    ((now() at time zone 'America/Lima')::date + 30)::text,
    'ot/' || current_setting('prueba.ot_a') || '/orden.pdf', 'orden.pdf');
begin
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  perform test.debe_fallar(v_llamada, 'Gerencia ya no da el código ni sube la OT', 'No tienes permiso');
  perform test.debe_fallar(
    format('select public.aprobar_cotizacion_con_ot(%L, %L, %L, %L, %L, %L, %L, %L, 100)',
           current_setting('prueba.cot_d'), gen_random_uuid(), 'QA-390 D', '12340', 'SEMIRREMOLQUE',
           ((now() at time zone 'America/Lima')::date + 30)::text, 'ot/' || gen_random_uuid() || '/orden.pdf', 'orden.pdf'),
    'La ventana vieja de aprobar con código y OT quedó cerrada', 'permission denied');
  reset role;

  perform test.como_usuario(current_setting('prueba.vendedor')::uuid);
  set local role authenticated;
  perform test.debe_fallar(v_llamada, 'Ventas no da el código de su cotización', 'No tienes permiso');
  reset role;

  perform test.como_usuario(current_setting('prueba.conta')::uuid);
  set local role authenticated;
  perform test.debe_fallar(v_llamada, 'Contabilidad tampoco', 'No tienes permiso');
  reset role;

  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform test.debe_fallar(
    format('select public.emitir_orden_de_cotizacion(%L, %L, %L, %L, %L, null, null, %L, %L, %L, 100)',
           current_setting('prueba.cot_a'), current_setting('prueba.ot_a'), '12345', 'QA-390 A', 'SEMIRREMOLQUE',
           ((now() at time zone 'America/Lima')::date + 30)::text,
           'ot/' || current_setting('prueba.ot_a') || '/orden.pdf', 'orden.pdf'),
    'La emisión vieja sigue cerrada', 'permission denied');
  reset role;
end $$;

-- 3. Lo que Administración tiene que dar -------------------------------------------
do $$
declare
  v_hoy constant date := (now() at time zone 'America/Lima')::date;
  v_cot constant text := current_setting('prueba.cot_a');
  v_ot constant text := current_setting('prueba.ot_a');
  v_pdf constant text := 'ot/' || current_setting('prueba.ot_a') || '/orden.pdf';
begin
  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format('select public.cargar_codigo_y_ot_de_cotizacion(%L, %L, %L, %L, %L, %L, %L, %L, 100)',
    v_cot, v_ot, '  ', '12345', 'SEMIRREMOLQUE', (v_hoy + 30)::text, v_pdf, 'orden.pdf'),
    'Sin código interno no se carga', 'código interno');
  perform test.debe_fallar(format('select public.cargar_codigo_y_ot_de_cotizacion(%L, %L, %L, %L, %L, %L, %L, %L, 100)',
    v_cot, v_ot, 'planta', '12345', 'SEMIRREMOLQUE', (v_hoy + 30)::text, v_pdf, 'orden.pdf'),
    'PLANTA no es el código de una unidad', 'PLANTA');
  perform test.debe_fallar(format('select public.cargar_codigo_y_ot_de_cotizacion(%L, %L, %L, %L, %L, %L, %L, %L, 100)',
    v_cot, v_ot, 'QA-390 A', 'OT-12', 'SEMIRREMOLQUE', (v_hoy + 30)::text, v_pdf, 'orden.pdf'),
    'El número de la OT es el de su papel', 'papel');
  perform test.debe_fallar(format('select public.cargar_codigo_y_ot_de_cotizacion(%L, %L, %L, %L, %L, null, %L, %L, 100)',
    v_cot, v_ot, 'QA-390 A', '12345', 'SEMIRREMOLQUE', v_pdf, 'orden.pdf'),
    'Sin fecha de entrega al cliente no se carga', 'fecha de entrega');
  perform test.debe_fallar(format('select public.cargar_codigo_y_ot_de_cotizacion(%L, %L, %L, %L, %L, %L, %L, %L, 100)',
    v_cot, v_ot, 'QA-390 A', '12345', 'SEMIRREMOLQUE', (v_hoy + 30)::text, 'ot/' || gen_random_uuid() || '/orden.pdf', 'orden.pdf'),
    'El PDF tiene que estar en la carpeta de su OT', 'PDF de la OT');
  perform test.debe_fallar(format('select public.cargar_codigo_y_ot_de_cotizacion(%L, %L, %L, %L, %L, %L, %L, %L, 100)',
    current_setting('prueba.cot_c'), gen_random_uuid(), 'QA-390 C', '12346', 'SEMIRREMOLQUE', (v_hoy + 30)::text,
    'ot/' || gen_random_uuid() || '/orden.pdf', 'orden.pdf'),
    'La que espera a Gerencia no recibe código ni OT', 'todavía no está aprobada');
  perform test.debe_fallar(format('select public.cargar_codigo_y_ot_de_cotizacion(%L, %L, %L, %L, %L, %L, %L, %L, 100)',
    current_setting('prueba.cot_b'), gen_random_uuid(), 'QA-390 B', '12346', 'SEMIRREMOLQUE', (v_hoy + 30)::text,
    'ot/' || gen_random_uuid() || '/orden.pdf', 'orden.pdf'),
    'La rechazada tampoco, hasta que Ventas la corrija y se apruebe', 'rechazada');
  perform test.afirmar(
    not exists (select 1 from public.ordenes_trabajo where id = v_ot::uuid)
      and not exists (select 1 from public.unidades where codigo_interno like 'QA-390%'),
    'Lo que falla no deja ni OT ni unidad');
  reset role;
end $$;

-- 4. Administración sube el PDF de la OT que va a crear; Gerencia ya no -------------
do $$
begin
  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('adjuntos-ot', 'ot/' || current_setting('prueba.ot_a') || '/orden.pdf', current_setting('prueba.oficina'),
          '{"mimetype": "application/pdf", "size": 100}');
  reset role;

  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format(
    'insert into storage.objects (bucket_id, name, owner_id) values (''adjuntos-ot'', %L, %L)',
    'ot/' || gen_random_uuid() || '/orden.pdf', current_setting('prueba.gerente')),
    'Gerencia ya no sube el PDF de la OT', 'row-level security');
  reset role;

  perform test.como_usuario(current_setting('prueba.vendedor')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format(
    'insert into storage.objects (bucket_id, name, owner_id) values (''adjuntos-ot'', %L, %L)',
    'ot/' || gen_random_uuid() || '/orden.pdf', current_setting('prueba.vendedor')),
    'Ventas no sube la OT', 'row-level security');
  reset role;
end $$;

-- 5. Administración da el código y sube la OT ----------------------------------------
do $$
declare
  v_hoy constant date := (now() at time zone 'America/Lima')::date;
  v_orden uuid;
begin
  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  v_orden := public.cargar_codigo_y_ot_de_cotizacion(
    current_setting('prueba.cot_a')::uuid, current_setting('prueba.ot_a')::uuid, 'qa-390  a', '12345',
    'SEMIRREMOLQUE', v_hoy + 30, 'ot/' || current_setting('prueba.ot_a') || '/orden.pdf', 'orden.pdf', 100,
    'Volvo', 'FH');
  perform test.afirmar(
    exists (select 1 from public.ot_adjuntos a where a.orden_id = v_orden and a.tipo = 'ORDEN'),
    'Administración ve el PDF de la OT que subió');
  reset role;

  perform test.afirmar(v_orden = current_setting('prueba.ot_a')::uuid, 'Devuelve la OT creada');
  perform test.afirmar(
    (select estado::text = 'APROBADA' and revisado_por = current_setting('prueba.gerente')::uuid
       from public.cotizaciones_pdf where id = current_setting('prueba.cot_a')::uuid),
    'La aprobación sigue siendo de Gerencia');
  perform test.afirmar(
    (select o.numero = '12345-' || current_setting('prueba.anio') and o.estado::text = 'APROBADA'
            and o.fecha_entrega_comprometida = v_hoy + 30 and o.tipo_unidad::text = 'SEMIRREMOLQUE'
       from public.ordenes_trabajo o where o.id = v_orden),
    'La OT nace aprobada con el número de su papel, sin cortarlo a cuatro cifras');
  perform test.afirmar(
    (select u.codigo_interno = 'QA-390 A' and u.cliente_id = current_setting('prueba.cliente')::uuid and u.marca = 'Volvo'
       from public.ordenes_trabajo o join public.unidades u on u.id = o.unidad_id where o.id = v_orden),
    'La unidad nace con el código interno, escrito como se normaliza');
  perform test.afirmar(
    exists (select 1 from public.ot_adjuntos a where a.orden_id = v_orden and a.tipo = 'ORDEN'
              and a.ruta_storage = 'ot/' || current_setting('prueba.ot_a') || '/orden.pdf'
              and a.subido_por = current_setting('prueba.oficina')::uuid),
    'El PDF queda pegado a la OT, subido por Administración');
  perform test.afirmar(public.codigo_interno_de_cotizacion(current_setting('prueba.cot_a')::uuid) = 'QA-390 A',
    'La cotización ya tiene código interno');
  perform test.afirmar(
    exists (select 1 from public.notificaciones n where n.usuario_id = current_setting('prueba.diseno')::uuid
              and n.titulo = 'Código nuevo con su OT' and n.ruta = '/diseno/codigo?codigo=QA-390+A'
              and n.cuerpo like 'QA-390 A: OT 12345-%'),
    'Diseño recibe el aviso del código nuevo, con el enlace a su código');
  perform test.afirmar(
    (select n.cuerpo from public.notificaciones n where n.usuario_id = current_setting('prueba.vendedor')::uuid
       and n.titulo = 'Tu cotización ya tiene su código')
      = 'La QA-390-A de QA CLIENTE 390 quedó con el código interno QA-390 A y la OT 12345-' || current_setting('prueba.anio') || '.',
    'Ventas sabe con qué código quedó su cotización');

  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format('select public.cargar_codigo_y_ot_de_cotizacion(%L, %L, %L, %L, %L, %L, %L, %L, 100)',
    current_setting('prueba.cot_a'), gen_random_uuid(), 'QA-390 A', '12399', 'SEMIRREMOLQUE', (v_hoy + 30)::text,
    'ot/' || gen_random_uuid() || '/orden.pdf', 'orden.pdf'),
    'Una cotización no lleva dos OT', 'ya tiene su OT');
  reset role;
end $$;

-- 6. El mismo código para otro trabajo del mismo cliente, y no para otro cliente -------
do $$
declare v_hoy constant date := (now() at time zone 'America/Lima')::date;
begin
  -- Ventas corrige la B (rechazada) y vuelve a Gerencia, que aprueba la B y la C.
  perform test.como_usuario(current_setting('prueba.vendedor')::uuid);
  set local role authenticated;
  update public.cotizaciones_pdf
     set ruta_storage = 'cot/' || current_setting('prueba.cot_b') || '/QA-390-B-v2.pdf',
         nombre_archivo = 'QA-390-B-v2.pdf', motivo_correccion = 'Se agregó el plazo'
   where id = current_setting('prueba.cot_b')::uuid;
  reset role;

  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  update public.cotizaciones_pdf set estado = 'APROBADA'
   where id in (current_setting('prueba.cot_b')::uuid, current_setting('prueba.cot_c')::uuid);
  reset role;

  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform public.cargar_codigo_y_ot_de_cotizacion(
    current_setting('prueba.cot_b')::uuid, current_setting('prueba.ot_b')::uuid, 'QA390A', '2-2099',
    'CARROCERIA_MONTADA', v_hoy + 40, 'ot/' || current_setting('prueba.ot_b') || '/orden-b.pdf', 'orden-b.pdf', 100);
  perform test.debe_fallar(format('select public.cargar_codigo_y_ot_de_cotizacion(%L, %L, %L, %L, %L, %L, %L, %L, 100)',
    current_setting('prueba.cot_c'), current_setting('prueba.ot_c'), 'QA 390 A', '12347', 'SEMIRREMOLQUE', (v_hoy + 30)::text,
    'ot/' || current_setting('prueba.ot_c') || '/orden.pdf', 'orden.pdf'),
    'El código de una unidad de otro cliente no se toma', 'QA CLIENTE 390');
  reset role;

  perform test.afirmar(
    (select count(distinct o.unidad_id) = 1 and count(*) = 2 from public.ordenes_trabajo o
      where o.id in (current_setting('prueba.ot_a')::uuid, current_setting('prueba.ot_b')::uuid)),
    'Un código que ya existe reusa su unidad: la OT nueva se suma a ella');
  perform test.afirmar(
    (select numero from public.ordenes_trabajo where id = current_setting('prueba.ot_b')::uuid) = '0002-2099',
    'El número corto se rellena a cuatro cifras, con el año del papel');
  perform test.afirmar(
    (select estado::text from public.cotizaciones_pdf where id = current_setting('prueba.cot_c')::uuid) = 'APROBADA'
      and not exists (select 1 from public.ordenes_trabajo where cotizacion_pdf_id = current_setting('prueba.cot_c')::uuid),
    'La cotización del otro cliente sigue aprobada y sin OT, esperando su código');
end $$;

-- 7. La corrección de una cotización que ya tiene OT se aprueba igual, sin otro aviso --
do $$
declare v integer;
begin
  perform test.como_usuario(current_setting('prueba.vendedor')::uuid);
  set local role authenticated;
  update public.cotizaciones_pdf
     set ruta_storage = 'cot/' || current_setting('prueba.cot_a') || '/QA-390-A-v2.pdf',
         nombre_archivo = 'QA-390-A-v2.pdf', motivo_correccion = 'Precio actualizado', monto_venta = 11000
   where id = current_setting('prueba.cot_a')::uuid;
  reset role;

  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  update public.cotizaciones_pdf set estado = 'APROBADA' where id = current_setting('prueba.cot_a')::uuid;
  get diagnostics v = row_count;
  reset role;
  perform test.afirmar(v = 1 and (select estado::text from public.cotizaciones_pdf where id = current_setting('prueba.cot_a')::uuid) = 'APROBADA',
    'Gerencia aprueba la corrección con un toque');
  perform test.afirmar(
    (select count(*) from public.notificaciones n where n.titulo = 'Cotización aprobada: falta su código y su OT'
      and n.origen_id = current_setting('prueba.cot_a')::uuid and n.usuario_id = current_setting('prueba.oficina')::uuid) = 1,
    'La corrección que ya tiene OT no le vuelve a pedir el código a Administración');
  perform test.afirmar(
    exists (select 1 from public.notificaciones n where n.usuario_id = current_setting('prueba.vendedor')::uuid
              and n.titulo = 'Gerencia aprobó tu cotización' and n.origen_id = current_setting('prueba.cot_a')::uuid
              and n.cuerpo = 'La QA-390-A de QA CLIENTE 390, con el código interno QA-390 A.'),
    'Y Ventas sabe que la corrección sigue con su código');
end $$;

-- 8. La D: aprobada y con su código, ya está para facturar -------------------------
do $$
declare v_hoy constant date := (now() at time zone 'America/Lima')::date;
begin
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  update public.cotizaciones_pdf set estado = 'APROBADA' where id = current_setting('prueba.cot_d')::uuid;
  reset role;

  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform public.cargar_codigo_y_ot_de_cotizacion(
    current_setting('prueba.cot_d')::uuid, current_setting('prueba.ot_d')::uuid, 'QA-390 D', '12348',
    'SEMIRREMOLQUE', v_hoy + 30, 'ot/' || current_setting('prueba.ot_d') || '/orden-d.pdf', 'orden-d.pdf', 100);
  reset role;
  perform test.afirmar(public.codigo_interno_de_cotizacion(current_setting('prueba.cot_d')::uuid) = 'QA-390 D',
    'La D gana su código y su OT');
end $$;

-- 9. Quién ve la OT dentro del código -------------------------------------------------
do $$
declare v_filas integer; v_pdfs integer;
begin
  perform test.como_usuario(current_setting('prueba.diseno')::uuid);
  set local role authenticated;
  select count(*), count(pdf_ruta) into v_filas, v_pdfs from public.ordenes_de_codigo_interno('qa-390 a');
  reset role;
  perform test.afirmar(v_filas = 2 and v_pdfs = 2, format('Diseño ve las dos OT del código con su PDF (vio %s y %s)', v_filas, v_pdfs));

  perform test.como_usuario(current_setting('prueba.conta')::uuid);
  set local role authenticated;
  select count(pdf_ruta) into v_pdfs from public.ordenes_de_codigo_interno('QA-390 A');
  perform test.afirmar(v_pdfs = 0, 'Contabilidad no ve el PDF de la OT');
  perform test.afirmar(
    (select codigo_interno from public.v_cotizaciones_pdf where id = current_setting('prueba.cot_a')::uuid) = 'QA-390 A',
    'Contabilidad ve la cotización con su código interno');
  perform test.afirmar(
    exists (select 1 from public.cotizaciones_para_facturar() f
             where f.cotizacion_id = current_setting('prueba.cot_d')::uuid and f.codigo_interno = 'QA-390 D'),
    'La aprobada con código ya está para facturar');
  reset role;
end $$;

\echo '✔ 391 Gerencia aprueba y Administración da el código interno y sube la OT'
rollback;
