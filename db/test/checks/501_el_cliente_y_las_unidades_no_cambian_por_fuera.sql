-- El cliente de la OT y de su cotización, y las unidades que ya pasaron a otro
-- comprador, no cambian por fuera (migración 20261127160000; fallas antiguas que
-- encontraron los auditores del PR 289, StudioGRCI aprobó cerrarlas aparte):
--   1. Con sesión, el cliente de una OT cambia solo con «Poner cliente» (la OT
--      sin cliente) o con «Editar OT / cambiar cliente» (la pasa a la cotización
--      del otro comprador). Un UPDATE directo, con cualquiera de los permisos que
--      dejan editar la OT (Gerencia por `ordenes.anular`, Administración por
--      `ordenes.editar`), se rechaza. Sin sesión (una migración) sigue entrando.
--   2. Ventas no baja la cantidad de unidades por debajo de una unidad cuya OT
--      pasó a otro comprador, ni por la cuenta ni por el número de la unidad.
--   3. Una corrección de Ventas no cambia el cliente de la cotización que tiene
--      su OT, ni de la que la tuvo y pasó a otro comprador. La que no tiene OT, o
--      cuya OT se anuló, se corrige como siempre.
-- Cada paso con la cuenta del puesto que lo hace y `set local role
-- authenticated`. Termina en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social)
select '20100000501', 'PRUEBAS 501 S.A.C.' where not exists (select 1 from public.empresa);
insert into public.sedes (codigo, nombre) values ('QA501', 'Taller prueba 501') on conflict (codigo) do nothing;
select id as sede_id from public.sedes where codigo = 'QA501' \gset
select test.crear_usuario('Gema', 'Gerente', 'gerente501@demo.pe', 'GERENTE', :'sede_id') as gerente_id \gset
select test.crear_usuario('Vico', 'Ventas', 'ventas501@demo.pe', 'VENDEDOR', :'sede_id') as ventas_id \gset
select test.crear_usuario('Olga', 'Oficina', 'oficina501@demo.pe', 'ADMINISTRACION', :'sede_id') as oficina_id \gset
select test.crear_usuario('Alfo', 'Almacén', 'almacen501@demo.pe', 'ALMACENERO', :'sede_id') as almacen_id \gset

insert into public.clientes (tipo_documento, numero_documento, razon_social) values ('RUC', '20990000501', 'QA PRIMER COMPRADOR 501');
insert into public.clientes (tipo_documento, numero_documento, razon_social) values ('RUC', '20990001501', 'QA SEGUNDO COMPRADOR 501');
insert into public.clientes (tipo_documento, numero_documento, razon_social) values ('RUC', '20990002501', 'QA TERCER COMPRADOR 501');

select set_config('prueba.gerente', :'gerente_id', true);
select set_config('prueba.ventas', :'ventas_id', true);
select set_config('prueba.oficina', :'oficina_id', true);
select set_config('prueba.almacen', :'almacen_id', true);
select set_config('prueba.sede', :'sede_id', true);
select set_config('prueba.cliente_a', (select id::text from public.clientes where numero_documento = '20990000501'), true);
select set_config('prueba.cliente_b', (select id::text from public.clientes where numero_documento = '20990001501'), true);
select set_config('prueba.cliente_c', (select id::text from public.clientes where numero_documento = '20990002501'), true);
select set_config('prueba.carroceria', (select id::text from public.tipos_carroceria where activo order by orden_secuencia limit 1), true);
select set_config('prueba.cot_a', gen_random_uuid()::text, true);   -- primer comprador, 3 unidades, sus 3 OT
select set_config('prueba.cot_b', gen_random_uuid()::text, true);   -- segundo comprador, 1 unidad: recibe la unidad 3
select set_config('prueba.cot_c', gen_random_uuid()::text, true);   -- tercer comprador, 1 unidad: su OT pasa a la E
select set_config('prueba.cot_e', gen_random_uuid()::text, true);   -- primer comprador, 1 unidad, recibe la OT de la C
select set_config('prueba.cot_f', gen_random_uuid()::text, true);   -- segundo comprador, 1 unidad, sin OT
select set_config('prueba.cot_g', gen_random_uuid()::text, true);   -- tercer comprador, 1 unidad, su OT se anuló
select set_config('prueba.ot1', gen_random_uuid()::text, true);
select set_config('prueba.ot2', gen_random_uuid()::text, true);
select set_config('prueba.ot3', gen_random_uuid()::text, true);
select set_config('prueba.otc', gen_random_uuid()::text, true);
select set_config('prueba.otg', gen_random_uuid()::text, true);
select set_config('prueba.taller', gen_random_uuid()::text, true);  -- la OT que abrió el taller sin cliente

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

-- Una carga de Administración, con el PDF de su OT ya subido.
create function pg_temp.cargar(p_cot text, p_ot text, p_codigo text, p_numero text) returns uuid
language plpgsql as $$
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('adjuntos-ot', 'ot/' || p_ot || '/orden.pdf', current_setting('prueba.oficina'),
          '{"mimetype": "application/pdf", "size": 100}');
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
    'El cliente cedió la unidad a otro comprador (prueba 501)');
end $$;

-- La corrección de Ventas, como la manda la pantalla: archivo nuevo, motivo, cliente y cantidad.
create function pg_temp.corregir_sql(p_cot text, p_cliente text, p_unidades integer) returns text
language sql as $$
  select format(
    'update public.cotizaciones_pdf set cliente_id = %L, cantidad_unidades = %s, ruta_storage = %L, nombre_archivo = %L,
            motivo_correccion = %L, estado = %L where id = %L',
    p_cliente, p_unidades, 'cot/' || p_cot || '/v' || floor(random() * 1e9)::bigint || '.pdf', 'v2.pdf',
    'Corrección de prueba 501', 'POR_REVISAR', p_cot)
$$;

create function pg_temp.cliente_de_ot(p_ot text) returns uuid
language sql as $$ select cliente_id from public.ordenes_trabajo where id = p_ot::uuid $$;

-- 0. Ventas sube seis cotizaciones, Gerencia las aprueba y Administración carga ----
do $$
declare
  c record;
begin
  perform test.como_usuario(current_setting('prueba.ventas')::uuid);
  set local role authenticated;
  for c in select * from (values
      (current_setting('prueba.cot_a'), 'QA-501-A', current_setting('prueba.cliente_a'), 3),
      (current_setting('prueba.cot_b'), 'QA-501-B', current_setting('prueba.cliente_b'), 1),
      (current_setting('prueba.cot_c'), 'QA-501-C', current_setting('prueba.cliente_c'), 1),
      (current_setting('prueba.cot_e'), 'QA-501-E', current_setting('prueba.cliente_a'), 1),
      (current_setting('prueba.cot_f'), 'QA-501-F', current_setting('prueba.cliente_b'), 1),
      (current_setting('prueba.cot_g'), 'QA-501-G', current_setting('prueba.cliente_c'), 1)) as t(id, numero, cliente, unidades)
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
   where numero in ('QA-501-A', 'QA-501-B', 'QA-501-C', 'QA-501-E', 'QA-501-F', 'QA-501-G');
  reset role;

  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform pg_temp.cargar(current_setting('prueba.cot_a'), current_setting('prueba.ot1'), 'QA-501 A1', '50111');
  perform pg_temp.cargar(current_setting('prueba.cot_a'), current_setting('prueba.ot2'), 'QA-501 A2', '50112');
  perform pg_temp.cargar(current_setting('prueba.cot_a'), current_setting('prueba.ot3'), 'QA-501 A3', '50113');
  perform pg_temp.cargar(current_setting('prueba.cot_c'), current_setting('prueba.otc'), 'QA-501 C1', '50121');
  perform pg_temp.cargar(current_setting('prueba.cot_g'), current_setting('prueba.otg'), 'QA-501 G1', '50131');
  -- La unidad 3 pasa a la de una unidad del segundo comprador; la de la C, a la E del primero.
  perform pg_temp.pasar(current_setting('prueba.ot3'), current_setting('prueba.cot_b'));
  perform pg_temp.pasar(current_setting('prueba.otc'), current_setting('prueba.cot_e'));
  reset role;

  -- Gerencia anula la OT de la unidad 2 y la de la G.
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  update public.ordenes_trabajo set estado = 'ANULADA', motivo_anulacion = 'El cliente desistió de una unidad (prueba 501)'
   where id in (current_setting('prueba.ot2')::uuid, current_setting('prueba.otg')::uuid);
  reset role;

  perform test.afirmar(pg_temp.cliente_de_ot(current_setting('prueba.ot3')) = current_setting('prueba.cliente_b')::uuid
                       and pg_temp.cliente_de_ot(current_setting('prueba.otc')) = current_setting('prueba.cliente_a')::uuid,
    '«Editar OT / cambiar cliente» sigue pasando la OT a otro comprador, con su cliente');
end $$;

-- 1. El cliente de una OT no cambia con un UPDATE directo ---------------------------
do $$
declare
  v integer;
begin
  -- Gerencia (por `ordenes.anular`) y Administración (por `ordenes.editar`) entraban.
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  perform test.debe_fallar(
    format('update public.ordenes_trabajo set cliente_id = %L where id = %L', current_setting('prueba.cliente_c'), current_setting('prueba.ot1')),
    'Gerencia no cambia el cliente de la OT por la API', 'cambia solo con «Editar OT / cambiar cliente»');
  reset role;

  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform test.debe_fallar(
    format('update public.ordenes_trabajo set cliente_id = %L where id = %L', current_setting('prueba.cliente_c'), current_setting('prueba.ot1')),
    'Administración tampoco', 'cambia solo con «Editar OT / cambiar cliente»');
  -- Ni junto con otro cambio que sí puede hacer.
  perform test.debe_fallar(
    format('update public.ordenes_trabajo set cliente_id = %L, prioridad = %L where id = %L',
           current_setting('prueba.cliente_c'), 'ALTA', current_setting('prueba.ot1')),
    'Ni metido en el mismo UPDATE que cambia la prioridad', 'cambia solo con «Editar OT / cambiar cliente»');
  -- Lo demás de la OT lo sigue editando como antes.
  update public.ordenes_trabajo set prioridad = 'ALTA' where id = current_setting('prueba.ot1')::uuid;
  get diagnostics v = row_count;
  reset role;
  perform test.afirmar(v = 1, 'Administración sigue cambiando la prioridad de la OT: ' || v || ' fila');

  -- Ventas y Almacén no editan OT: cero filas.
  perform test.como_usuario(current_setting('prueba.ventas')::uuid);
  set local role authenticated;
  update public.ordenes_trabajo set cliente_id = current_setting('prueba.cliente_c')::uuid where id = current_setting('prueba.ot1')::uuid;
  get diagnostics v = row_count;
  reset role;
  perform test.afirmar(v = 0, 'Ventas no toca la OT');
  perform test.como_usuario(current_setting('prueba.almacen')::uuid);
  set local role authenticated;
  update public.ordenes_trabajo set cliente_id = current_setting('prueba.cliente_c')::uuid where id = current_setting('prueba.ot1')::uuid;
  get diagnostics v = row_count;
  reset role;
  perform test.afirmar(v = 0, 'Almacén tampoco');

  perform test.afirmar(pg_temp.cliente_de_ot(current_setting('prueba.ot1')) = current_setting('prueba.cliente_a')::uuid,
    'La OT sigue siendo del primer comprador');
end $$;

-- 2. «Poner cliente» a la OT que abrió el taller sin cliente sigue entrando ----------
do $$
declare
  v integer;
begin
  -- Una OT de antes, abierta en el taller y todavía sin cliente (hoy el taller ya no abre OT).
  set local session_replication_role = replica;
  insert into public.ordenes_trabajo (id, numero, sede_id, descripcion, abierta_en_taller)
  values (current_setting('prueba.taller')::uuid, '50199-2026', current_setting('prueba.sede')::uuid, 'OT del taller sin cliente 501', true);
  set local session_replication_role = origin;

  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform test.debe_fallar(
    format('update public.ordenes_trabajo set cliente_id = %L where id = %L', current_setting('prueba.cliente_c'), current_setting('prueba.taller')),
    'El cliente de la OT del taller no se pone por la API', 'con «Poner cliente»');
  perform public.poner_cliente_a_orden(current_setting('prueba.taller')::uuid, current_setting('prueba.cliente_c')::uuid);
  reset role;
  perform test.afirmar(pg_temp.cliente_de_ot(current_setting('prueba.taller')) = current_setting('prueba.cliente_c')::uuid,
    '«Poner cliente» le pone el cliente');
  perform test.afirmar(exists (select 1 from public.ot_bitacora e
                                where e.orden_id = current_setting('prueba.taller')::uuid
                                  and e.descripcion like 'Se le puso el cliente: QA TERCER COMPRADOR 501%'),
    'y queda en su historial');
  perform test.afirmar(coalesce(current_setting('metalwork.cliente_de_ot', true), '') = '',
    'La marca de «Poner cliente» no queda puesta después');

  -- Ya con cliente, por la API tampoco se cambia.
  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform test.debe_fallar(
    format('update public.ordenes_trabajo set cliente_id = %L where id = %L', current_setting('prueba.cliente_a'), current_setting('prueba.taller')),
    'Con cliente puesto, tampoco se cambia por la API', 'cambia solo con «Editar OT / cambiar cliente»');
  reset role;

  -- Sin sesión (una migración) sigue entrando, como hasta aquí.
  perform set_config('request.jwt.claim.sub', '', true);
  update public.ordenes_trabajo set cliente_id = current_setting('prueba.cliente_a')::uuid where id = current_setting('prueba.taller')::uuid;
  get diagnostics v = row_count;
  perform test.afirmar(v = 1, 'Sin sesión, una migración sigue pudiendo corregirlo');
end $$;

-- 3. La cantidad no baja de las unidades que pasaron a otro comprador --------------
-- La A: la 1 con su OT, la 2 anulada, la 3 pasó al segundo comprador.
do $$
begin
  perform test.como_usuario(current_setting('prueba.ventas')::uuid);
  set local role authenticated;
  -- Antes entraba: la cuenta miraba solo la OT vigente (1) y su unidad (1).
  perform test.debe_fallar(pg_temp.corregir_sql(current_setting('prueba.cot_a'), current_setting('prueba.cliente_a'), 2),
    'Ventas no baja a 2 una cotización cuya unidad 3 pasó a otro comprador', 'La unidad 3 de la cotización QA-501-A pasó a otro comprador');
  perform test.debe_fallar(pg_temp.corregir_sql(current_setting('prueba.cot_a'), current_setting('prueba.cliente_a'), 1),
    'Ni a 1: tiene una unidad con OT y otra que pasó', 'tiene 1 unidad con OT y 1 que pasó a otro comprador');
  reset role;
  perform test.afirmar((select cantidad_unidades from public.cotizaciones_pdf where id = current_setting('prueba.cot_a')::uuid) = 3,
    'La A sigue siendo de 3 unidades');
end $$;

-- Quien lee las órdenes ve en el aviso cuál OT pasó (Ventas lee las OT de sus ventas).
do $$
begin
  perform test.como_usuario(current_setting('prueba.ventas')::uuid);
  set local role authenticated;
  if public.tiene_permiso('ordenes.ver') then
    perform test.debe_fallar(pg_temp.corregir_sql(current_setting('prueba.cot_a'), current_setting('prueba.cliente_a'), 2),
      'Con permiso de leer las OT, el aviso dice cuál pasó', 'con la OT 50113-');
  else
    perform test.debe_fallar(pg_temp.corregir_sql(current_setting('prueba.cot_a'), current_setting('prueba.cliente_a'), 2),
      'Sin permiso de leer las OT, el aviso no dice su número', 'pasó a otro comprador: no puede quedar');
  end if;
  -- Con 3 o más sigue corrigiéndose.
  execute pg_temp.corregir_sql(current_setting('prueba.cot_a'), current_setting('prueba.cliente_a'), 4);
  reset role;
  perform test.afirmar((select cantidad_unidades from public.cotizaciones_pdf where id = current_setting('prueba.cot_a')::uuid) = 4,
    'Subirla a 4 sigue entrando');
end $$;

-- 4. La corrección no cambia el cliente de la cotización con OT --------------------
do $$
declare
  v integer;
begin
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  update public.cotizaciones_pdf set estado = 'APROBADA' where id = current_setting('prueba.cot_a')::uuid;
  reset role;

  perform test.como_usuario(current_setting('prueba.ventas')::uuid);
  set local role authenticated;
  perform test.debe_fallar(pg_temp.corregir_sql(current_setting('prueba.cot_a'), current_setting('prueba.cliente_c'), 4),
    'La A tiene su OT de la unidad 1: no cambia de cliente', 'ya tiene su OT: una corrección no le cambia el cliente');
  perform test.debe_fallar(pg_temp.corregir_sql(current_setting('prueba.cot_b'), current_setting('prueba.cliente_c'), 1),
    'La B tiene la OT que le llegó de la A: tampoco', 'ya tiene su OT: una corrección no le cambia el cliente');
  perform test.debe_fallar(pg_temp.corregir_sql(current_setting('prueba.cot_c'), current_setting('prueba.cliente_a'), 1),
    'La C, cuya OT pasó a otro comprador, tampoco', 'pasó a otro comprador: la venta quedó anotada con este cliente');
  -- La que no tiene OT, o cuya OT se anuló, se sigue corrigiendo con otro cliente.
  execute pg_temp.corregir_sql(current_setting('prueba.cot_f'), current_setting('prueba.cliente_c'), 1);
  get diagnostics v = row_count;
  perform test.afirmar(v = 1, 'La F, sin OT, cambia de cliente con su corrección');
  execute pg_temp.corregir_sql(current_setting('prueba.cot_g'), current_setting('prueba.cliente_a'), 1);
  get diagnostics v = row_count;
  perform test.afirmar(v = 1, 'La G, cuya OT se anuló, también');
  -- Y la A se corrige igual si conserva su cliente.
  execute pg_temp.corregir_sql(current_setting('prueba.cot_a'), current_setting('prueba.cliente_a'), 4);
  get diagnostics v = row_count;
  perform test.afirmar(v = 1, 'La A se corrige conservando su cliente');
  reset role;

  perform test.afirmar(
    (select cliente_id from public.cotizaciones_pdf where id = current_setting('prueba.cot_a')::uuid) = current_setting('prueba.cliente_a')::uuid
    and (select cliente_id from public.cotizaciones_pdf where id = current_setting('prueba.cot_b')::uuid) = current_setting('prueba.cliente_b')::uuid
    and (select cliente_id from public.cotizaciones_pdf where id = current_setting('prueba.cot_c')::uuid) = current_setting('prueba.cliente_c')::uuid
    and (select cliente_id from public.cotizaciones_pdf where id = current_setting('prueba.cot_f')::uuid) = current_setting('prueba.cliente_c')::uuid,
    'Cada cotización quedó con el cliente que debía');

  -- Ni sin sesión: ninguna función cambia el cliente de una cotización con OT.
  perform set_config('request.jwt.claim.sub', '', true);
  perform test.debe_fallar(
    format('update public.cotizaciones_pdf set cliente_id = %L where id = %L', current_setting('prueba.cliente_c'), current_setting('prueba.cot_b')),
    'Sin sesión tampoco', 'ya tiene su OT');
end $$;

-- 5. Las funciones nuevas no se llaman desde la API -------------------------------
do $$
begin
  perform test.afirmar(
    not has_function_privilege('authenticated', 'public.fn_ot_cliente_cambia_solo_por_su_camino()', 'execute')
    and not has_function_privilege('authenticated', 'public.fn_cotizacion_con_ot_conserva_su_cliente()', 'execute')
    and not has_function_privilege('anon', 'public.poner_cliente_a_orden(uuid,uuid)', 'execute')
    and has_function_privilege('authenticated', 'public.poner_cliente_a_orden(uuid,uuid)', 'execute'),
    'Los disparadores no se llaman desde la API, y «Poner cliente» sigue abierto solo con sesión');
end $$;

rollback;
