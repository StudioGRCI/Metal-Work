-- La unidad de la OT, y el cliente de la unidad que ya tiene OT, no cambian por
-- fuera (migración 20261127183500; fallas antiguas que encontró el auditor del
-- PR 294, StudioGRCI aprobó cerrarlas):
--   1. Con sesión, la unidad de una OT no cambia con un UPDATE directo, con
--      ninguno de los permisos que dejan editar la OT (Gerencia por
--      `ordenes.anular`, Administración por `ordenes.editar`). La cambia solo
--      «Poner cliente», cuando el cliente ya tiene esa placa. Sin sesión sigue.
--   2. Ventas (`clientes.editar`) y Diseño (`diseno.unidades`) no cambian el
--      cliente de una unidad con OT vigente; los datos del vehículo, sí. La
--      unidad sin OT, o cuya OT se anuló, cambia de cliente como siempre.
--   3. «Editar OT / cambiar cliente» sigue pasando la unidad con su OT al otro
--      comprador, con su venta anterior y su historial; después, por fuera,
--      tampoco vuelve.
--   4. La unidad de la OT que abrió el taller sin cliente recibe el cliente solo
--      con «Poner cliente», también cuando la OT pasa a la unidad que el cliente
--      ya tenía con esa placa, y la bitácora lo dice.
--   5. La unidad de una OT entregada, o con más de una OT, no cambia de dueño, y
--      el aviso dice que se registra como unidad del otro cliente; la carga no
--      se lleva la unidad de una OT del taller sin cliente.
-- Cada paso con la cuenta del puesto que lo hace y `set local role
-- authenticated`. Termina en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social)
select '20100000502', 'PRUEBAS 502 S.A.C.' where not exists (select 1 from public.empresa);
insert into public.sedes (codigo, nombre) values ('QA502', 'Taller prueba 502') on conflict (codigo) do nothing;
select id as sede_id from public.sedes where codigo = 'QA502' \gset
select test.crear_usuario('Gema', 'Gerente', 'gerente502@demo.pe', 'GERENTE', :'sede_id') as gerente_id \gset
select test.crear_usuario('Vico', 'Ventas', 'ventas502@demo.pe', 'VENDEDOR', :'sede_id') as ventas_id \gset
select test.crear_usuario('Olga', 'Oficina', 'oficina502@demo.pe', 'ADMINISTRACION', :'sede_id') as oficina_id \gset
select test.crear_usuario('Dino', 'Diseño', 'diseno502@demo.pe', 'DISENO', :'sede_id') as diseno_id \gset

insert into public.clientes (tipo_documento, numero_documento, razon_social) values ('RUC', '20990000502', 'QA PRIMER COMPRADOR 502');
insert into public.clientes (tipo_documento, numero_documento, razon_social) values ('RUC', '20990001502', 'QA SEGUNDO COMPRADOR 502');

select set_config('prueba.gerente', :'gerente_id', true);
select set_config('prueba.ventas', :'ventas_id', true);
select set_config('prueba.oficina', :'oficina_id', true);
select set_config('prueba.diseno', :'diseno_id', true);
select set_config('prueba.sede', :'sede_id', true);
select set_config('prueba.cliente_a', (select id::text from public.clientes where numero_documento = '20990000502'), true);
select set_config('prueba.cliente_b', (select id::text from public.clientes where numero_documento = '20990001502'), true);
select set_config('prueba.carroceria', (select id::text from public.tipos_carroceria where activo order by orden_secuencia limit 1), true);
select set_config('prueba.cot_a', gen_random_uuid()::text, true);   -- primer comprador: su OT 1
select set_config('prueba.cot_b', gen_random_uuid()::text, true);   -- segundo comprador: recibe la OT 1
select set_config('prueba.cot_c', gen_random_uuid()::text, true);   -- primer comprador: su OT se anula
select set_config('prueba.cot_d', gen_random_uuid()::text, true);   -- primer comprador: sin OT, para la carga
select set_config('prueba.ot3', gen_random_uuid()::text, true);
select set_config('prueba.taller3', gen_random_uuid()::text, true); -- OT del taller sin cliente, unidad con código
select set_config('prueba.u_taller3', gen_random_uuid()::text, true);
select set_config('prueba.entregada', gen_random_uuid()::text, true);
select set_config('prueba.u_entregada', gen_random_uuid()::text, true);
select set_config('prueba.ot1', gen_random_uuid()::text, true);
select set_config('prueba.ot2', gen_random_uuid()::text, true);
select set_config('prueba.taller', gen_random_uuid()::text, true);  -- OT del taller sin cliente, unidad sin cliente
select set_config('prueba.taller2', gen_random_uuid()::text, true); -- OT del taller cuya placa ya tiene el cliente
select set_config('prueba.u_libre', gen_random_uuid()::text, true); -- unidad del primer comprador sin OT, placa QA5-502
select set_config('prueba.u_taller', gen_random_uuid()::text, true);
select set_config('prueba.u_taller2', gen_random_uuid()::text, true);

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

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
    'El cliente cedió la unidad a otro comprador (prueba 502)');
end $$;

create function pg_temp.unidad_de_ot(p_ot text) returns uuid
language sql as $$ select unidad_id from public.ordenes_trabajo where id = p_ot::uuid $$;
create function pg_temp.cliente_de_unidad(p_unidad uuid) returns uuid
language sql as $$ select cliente_id from public.unidades where id = p_unidad $$;

-- 0. Ventas sube tres cotizaciones, Gerencia las aprueba y Administración carga ----
do $$
declare
  c record;
begin
  perform test.como_usuario(current_setting('prueba.ventas')::uuid);
  set local role authenticated;
  for c in select * from (values
      (current_setting('prueba.cot_a'), 'QA-502-A', current_setting('prueba.cliente_a')),
      (current_setting('prueba.cot_b'), 'QA-502-B', current_setting('prueba.cliente_b')),
      (current_setting('prueba.cot_c'), 'QA-502-C', current_setting('prueba.cliente_a')),
      (current_setting('prueba.cot_d'), 'QA-502-D', current_setting('prueba.cliente_a'))) as t(id, numero, cliente)
  loop
    insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage,
                                         mime_type, tamano_bytes, registrado_por, monto_venta, moneda, cantidad_unidades)
    values (c.id::uuid, c.numero, c.cliente::uuid, current_setting('prueba.carroceria')::uuid, 'cot.pdf',
            'cot/' || c.id || '/cot.pdf', 'application/pdf', 120, current_setting('prueba.ventas')::uuid, 9000, 'PEN', 1);
  end loop;
  -- Una unidad del primer comprador sin OT, registrada por Ventas.
  insert into public.unidades (id, cliente_id, placa, tipo_vehiculo, marca, modelo)
  values (current_setting('prueba.u_libre')::uuid, current_setting('prueba.cliente_a')::uuid, 'QA5-502', 'CAMION', 'VOLVO', 'FH');
  reset role;

  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  update public.cotizaciones_pdf set estado = 'APROBADA' where numero in ('QA-502-A', 'QA-502-B', 'QA-502-C', 'QA-502-D');
  reset role;

  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform pg_temp.cargar(current_setting('prueba.cot_a'), current_setting('prueba.ot1'), 'QA-502 A1', '50211');
  perform pg_temp.cargar(current_setting('prueba.cot_c'), current_setting('prueba.ot2'), 'QA-502 C1', '50212');
  reset role;

  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  update public.ordenes_trabajo set estado = 'ANULADA', motivo_anulacion = 'El cliente desistió (prueba 502)'
   where id = current_setting('prueba.ot2')::uuid;
  reset role;

  perform set_config('prueba.u1', pg_temp.unidad_de_ot(current_setting('prueba.ot1'))::text, true);
  perform set_config('prueba.u2', pg_temp.unidad_de_ot(current_setting('prueba.ot2'))::text, true);
  perform test.afirmar(pg_temp.cliente_de_unidad(current_setting('prueba.u1')::uuid) = current_setting('prueba.cliente_a')::uuid,
    'La carga deja la unidad del cliente de su cotización');
end $$;

-- 1. La unidad de una OT no cambia con un UPDATE directo ---------------------------
do $$
declare
  v integer;
begin
  -- Gerencia (por `ordenes.anular`) y Administración (por `ordenes.editar`) entraban.
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  perform test.debe_fallar(
    format('update public.ordenes_trabajo set unidad_id = %L where id = %L', current_setting('prueba.u_libre'), current_setting('prueba.ot1')),
    'Gerencia no cambia la unidad de la OT por la API', 'es de la unidad con la que se cargó');
  perform test.debe_fallar(
    format('update public.ordenes_trabajo set unidad_id = null where id = %L', current_setting('prueba.ot1')),
    'Ni se la quita', 'es de la unidad con la que se cargó');
  reset role;

  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform test.debe_fallar(
    format('update public.ordenes_trabajo set unidad_id = %L, prioridad = %L where id = %L',
           current_setting('prueba.u_libre'), 'ALTA', current_setting('prueba.ot1')),
    'Administración tampoco, ni metida en el UPDATE que cambia la prioridad', 'es de la unidad con la que se cargó');
  update public.ordenes_trabajo set prioridad = 'ALTA' where id = current_setting('prueba.ot1')::uuid;
  get diagnostics v = row_count;
  reset role;
  perform test.afirmar(v = 1, 'Administración sigue cambiando la prioridad de la OT: ' || v || ' fila');
  perform test.afirmar(pg_temp.unidad_de_ot(current_setting('prueba.ot1')) = current_setting('prueba.u1')::uuid,
    'La OT sigue en su unidad');

  -- Sin sesión (una migración) sigue entrando, como hasta aquí.
  perform set_config('request.jwt.claim.sub', '', true);
  update public.ordenes_trabajo set unidad_id = current_setting('prueba.u_libre')::uuid where id = current_setting('prueba.ot1')::uuid;
  get diagnostics v = row_count;
  perform test.afirmar(v = 1, 'Sin sesión, una migración sigue pudiendo corregirla');
  update public.ordenes_trabajo set unidad_id = current_setting('prueba.u1')::uuid where id = current_setting('prueba.ot1')::uuid;
end $$;

-- 2. El cliente de la unidad con OT no cambia por fuera ----------------------------
do $$
declare
  v integer;
begin
  perform test.como_usuario(current_setting('prueba.ventas')::uuid);
  set local role authenticated;
  perform test.debe_fallar(
    format('update public.unidades set cliente_id = %L where id = %L', current_setting('prueba.cliente_b'), current_setting('prueba.u1')),
    'Ventas no cambia el cliente de la unidad con OT', 'ya tiene su OT 50211-');
  -- Lo que manda la ficha de la unidad: el mismo cliente y los datos del vehículo.
  update public.unidades set cliente_id = current_setting('prueba.cliente_a')::uuid, color = 'BLANCO'
   where id = current_setting('prueba.u1')::uuid;
  get diagnostics v = row_count;
  perform test.afirmar(v = 1, 'Ventas sigue corrigiendo la unidad con su mismo cliente: ' || v || ' fila');
  -- La unidad sin OT y la de la OT anulada cambian de cliente como siempre.
  update public.unidades set cliente_id = current_setting('prueba.cliente_b')::uuid where id = current_setting('prueba.u_libre')::uuid;
  get diagnostics v = row_count;
  perform test.afirmar(v = 1, 'La unidad sin OT cambia de cliente');
  update public.unidades set cliente_id = current_setting('prueba.cliente_a')::uuid where id = current_setting('prueba.u_libre')::uuid;
  update public.unidades set cliente_id = current_setting('prueba.cliente_b')::uuid where id = current_setting('prueba.u2')::uuid;
  get diagnostics v = row_count;
  perform test.afirmar(v = 1, 'La unidad cuya OT se anuló, también');
  reset role;

  perform test.como_usuario(current_setting('prueba.diseno')::uuid);
  set local role authenticated;
  perform test.debe_fallar(
    format('update public.unidades set cliente_id = %L where id = %L', current_setting('prueba.cliente_b'), current_setting('prueba.u1')),
    'Diseño tampoco (desde la 20261127200000, el aviso le dice que no es de su puesto)', 'no se cambia desde tu puesto: eso lo ve Ventas');
  perform test.debe_fallar(
    format('update public.unidades set cliente_id = null where id = %L', current_setting('prueba.u1')),
    'Ni se lo quita', 'no se cambia desde tu puesto: eso lo ve Ventas');
  update public.unidades set marca = 'SCANIA' where id = current_setting('prueba.u1')::uuid;
  get diagnostics v = row_count;
  reset role;
  perform test.afirmar(v = 1, 'Diseño sigue corrigiendo los datos del vehículo: ' || v || ' fila');

  perform test.afirmar(pg_temp.cliente_de_unidad(current_setting('prueba.u1')::uuid) = current_setting('prueba.cliente_a')::uuid,
    'La unidad sigue siendo del primer comprador');

  -- Sin sesión sigue entrando.
  perform set_config('request.jwt.claim.sub', '', true);
  update public.unidades set cliente_id = current_setting('prueba.cliente_b')::uuid where id = current_setting('prueba.u1')::uuid;
  get diagnostics v = row_count;
  perform test.afirmar(v = 1, 'Sin sesión, una migración sigue pudiendo corregirlo');
  update public.unidades set cliente_id = current_setting('prueba.cliente_a')::uuid where id = current_setting('prueba.u1')::uuid;
end $$;

-- 3. «Editar OT / cambiar cliente» pasa la unidad con su OT -----------------------
do $$
begin
  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform pg_temp.pasar(current_setting('prueba.ot1'), current_setting('prueba.cot_b'));
  reset role;
  perform test.afirmar(pg_temp.cliente_de_unidad(current_setting('prueba.u1')::uuid) = current_setting('prueba.cliente_b')::uuid
                       and (select cliente_id from public.ordenes_trabajo where id = current_setting('prueba.ot1')::uuid) = current_setting('prueba.cliente_b')::uuid,
    '«Editar OT / cambiar cliente» pasa la OT y su unidad al segundo comprador');
  perform test.afirmar(exists (select 1 from public.ot_ventas_anteriores va
                                where va.orden_id = current_setting('prueba.ot1')::uuid
                                  and va.cliente_id = current_setting('prueba.cliente_a')::uuid),
    'con su venta anterior');
  perform test.afirmar(exists (select 1 from public.ot_bitacora e
                                where e.orden_id = current_setting('prueba.ot1')::uuid and e.descripcion like 'Edición de OT.%'),
    'y su historial');
  perform test.afirmar(coalesce(current_setting('metalwork.cliente_de_unidad', true), '') = '',
    'La marca de «Editar OT» no queda puesta después');

  -- Ya pasada, por fuera tampoco vuelve.
  perform test.como_usuario(current_setting('prueba.ventas')::uuid);
  set local role authenticated;
  perform test.debe_fallar(
    format('update public.unidades set cliente_id = %L where id = %L', current_setting('prueba.cliente_a'), current_setting('prueba.u1')),
    'Ventas no la devuelve al primer comprador por la API', 'ya tiene su OT');
  reset role;
end $$;

-- 4. La unidad de la OT del taller sin cliente: solo «Poner cliente» ---------------
do $$
declare
  v integer;
begin
  -- Dos OT de antes, abiertas en el taller sin cliente, con su unidad sin cliente
  -- (hoy el taller ya no abre OT). La segunda tiene la placa que el primer
  -- comprador ya registró.
  set local session_replication_role = replica;
  insert into public.unidades (id, placa, tipo_vehiculo) values
    (current_setting('prueba.u_taller')::uuid, 'QA5-503', 'CAMION'),
    (current_setting('prueba.u_taller2')::uuid, 'QA5502', 'CAMION');
  insert into public.ordenes_trabajo (id, numero, sede_id, descripcion, abierta_en_taller, unidad_id) values
    (current_setting('prueba.taller')::uuid, '50298-2026', current_setting('prueba.sede')::uuid, 'OT del taller sin cliente 502', true, current_setting('prueba.u_taller')::uuid),
    (current_setting('prueba.taller2')::uuid, '50299-2026', current_setting('prueba.sede')::uuid, 'OT del taller sin cliente 502 b', true, current_setting('prueba.u_taller2')::uuid);
  set local session_replication_role = origin;

  perform test.como_usuario(current_setting('prueba.ventas')::uuid);
  set local role authenticated;
  perform test.debe_fallar(
    format('update public.unidades set cliente_id = %L where id = %L', current_setting('prueba.cliente_a'), current_setting('prueba.u_taller')),
    'Ventas no le pone cliente por fuera a la unidad de la OT sin cliente', 'con «Poner cliente»');
  reset role;

  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform test.debe_fallar(
    format('update public.ordenes_trabajo set unidad_id = %L where id = %L', current_setting('prueba.u_libre'), current_setting('prueba.taller2')),
    'Administración no la cambia de unidad a mano', 'es de la unidad con la que se cargó');
  perform public.poner_cliente_a_orden(current_setting('prueba.taller')::uuid, current_setting('prueba.cliente_a')::uuid);
  perform public.poner_cliente_a_orden(current_setting('prueba.taller2')::uuid, current_setting('prueba.cliente_a')::uuid);
  reset role;

  perform test.afirmar(pg_temp.cliente_de_unidad(current_setting('prueba.u_taller')::uuid) = current_setting('prueba.cliente_a')::uuid,
    '«Poner cliente» le pone el cliente a la OT y a su unidad');
  perform test.afirmar(pg_temp.unidad_de_ot(current_setting('prueba.taller2')) = current_setting('prueba.u_libre')::uuid
                       and not (select activo from public.unidades where id = current_setting('prueba.u_taller2')::uuid),
    'y pasa la OT a la unidad que el cliente ya tenía con esa placa, desactivando la repetida');
  perform test.afirmar(exists (select 1 from public.ot_bitacora e
                                where e.orden_id = current_setting('prueba.taller2')::uuid
                                  and e.descripcion like '%La OT pasó a la unidad QA5-502 que ese cliente ya tenía registrada.'),
    'y el cambio de unidad queda dicho en su historial');
  perform test.afirmar((select count(*) from public.ot_bitacora e
                         where e.orden_id in (current_setting('prueba.taller')::uuid, current_setting('prueba.taller2')::uuid)
                           and e.descripcion like 'Se le puso el cliente: QA PRIMER COMPRADOR 502%') = 2,
    'Las dos quedan en su historial');
  perform test.afirmar(coalesce(current_setting('metalwork.cliente_de_unidad', true), '') = ''
                       and coalesce(current_setting('metalwork.unidad_de_ot', true), '') = '',
    'Las marcas de «Poner cliente» no quedan puestas después');
end $$;

-- 5. Los casos que ningún botón resuelve, y la carga ---------------------------
do $$
begin
  set local session_replication_role = replica;
  -- La unidad de una OT ya entregada; otra OT, anulada, en la unidad que recibió
  -- la del taller (queda con dos OT); y una OT del taller sin cliente cuya unidad
  -- sin cliente lleva un código interno.
  insert into public.unidades (id, cliente_id, placa, tipo_vehiculo) values
    (current_setting('prueba.u_entregada')::uuid, current_setting('prueba.cliente_a')::uuid, 'QA5-504', 'CAMION');
  insert into public.unidades (id, codigo_interno, tipo_vehiculo) values
    (current_setting('prueba.u_taller3')::uuid, 'QA-502 T3', 'CAMION');
  insert into public.ordenes_trabajo (id, numero, sede_id, descripcion, cliente_id, unidad_id, estado, motivo_anulacion) values
    (current_setting('prueba.entregada')::uuid, '50297-2026', current_setting('prueba.sede')::uuid, 'OT entregada 502',
     current_setting('prueba.cliente_a')::uuid, current_setting('prueba.u_entregada')::uuid, 'ENTREGADA', null),
    (gen_random_uuid(), '50296-2026', current_setting('prueba.sede')::uuid, 'OT anulada 502',
     current_setting('prueba.cliente_a')::uuid, current_setting('prueba.u_libre')::uuid, 'ANULADA', 'Prueba 502');
  insert into public.ordenes_trabajo (id, numero, sede_id, descripcion, abierta_en_taller, unidad_id) values
    (current_setting('prueba.taller3')::uuid, '50295-2026', current_setting('prueba.sede')::uuid, 'OT del taller sin cliente 502 c', true,
     current_setting('prueba.u_taller3')::uuid);
  set local session_replication_role = origin;

  perform test.como_usuario(current_setting('prueba.ventas')::uuid);
  set local role authenticated;
  perform test.debe_fallar(
    format('update public.unidades set cliente_id = %L where id = %L', current_setting('prueba.cliente_b'), current_setting('prueba.u_entregada')),
    'La unidad de la OT entregada no cambia de dueño: se registra como unidad del otro cliente',
    'ya tiene su OT 50297-2026 entregada: su cliente no cambia');
  perform test.debe_fallar(
    format('update public.unidades set cliente_id = %L where id = %L', current_setting('prueba.cliente_b'), current_setting('prueba.u_libre')),
    'Ni la que tiene más de una OT, que «Editar OT» no pasaría', 'ya tiene más de una OT: su cliente no cambia');
  reset role;

  -- La carga ya no se lleva para otro cliente la unidad de la OT del taller sin cliente.
  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform test.debe_fallar(
    format('select pg_temp.cargar(%L, %L, %L, %L)', current_setting('prueba.cot_d'), current_setting('prueba.ot3'), 'QA-502 T3', '50213'),
    'La carga pide antes «Poner cliente» a la OT del taller', 'que todavía no tiene cliente: el cliente se le pone con «Poner cliente», en el resumen de esa OT.');
  -- Con el cliente puesto, la misma carga entra en esa unidad.
  perform public.poner_cliente_a_orden(current_setting('prueba.taller3')::uuid, current_setting('prueba.cliente_a')::uuid);
  perform pg_temp.cargar(current_setting('prueba.cot_d'), current_setting('prueba.ot3'), 'QA-502 T3', '50213');
  reset role;
  perform test.afirmar(pg_temp.unidad_de_ot(current_setting('prueba.ot3')) = current_setting('prueba.u_taller3')::uuid,
    'y la OT nueva queda en esa unidad');
end $$;

-- 6. Los disparadores no se llaman desde la API -----------------------------------
do $$
begin
  perform test.afirmar(
    not has_function_privilege('authenticated', 'public.fn_ot_unidad_cambia_solo_por_su_camino()', 'execute')
    and not has_function_privilege('authenticated', 'public.fn_unidad_con_ot_conserva_su_cliente()', 'execute')
    and not has_function_privilege('authenticated', 'public.editar_ot_con_historial_base(uuid,timestamptz,jsonb,text)', 'execute')
    and not has_function_privilege('anon', 'public.poner_cliente_a_orden(uuid,uuid)', 'execute')
    and has_function_privilege('authenticated', 'public.poner_cliente_a_orden(uuid,uuid)', 'execute'),
    'Los disparadores no se llaman desde la API, y «Poner cliente» sigue abierto solo con sesión');
end $$;

rollback;
