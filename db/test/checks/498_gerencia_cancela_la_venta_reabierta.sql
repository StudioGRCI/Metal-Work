-- Gerencia también cancela la venta que se reabrió, y Facturación sabe cuántas
-- unidades pasaron a otro comprador (migración 20261126998600; StudioGRCI,
-- 2026-11-26: «Sí, también Gerencia» y «Avisar a Contabilidad»).
--
--   * La venta reabierta (su OT pasó a otro comprador y allí se anuló) la cancela
--     quien la registró o Gerencia, con su motivo; nadie más. Queda anulada, no
--     borrada, con quién y cuándo.
--   * Gerencia tampoco la cancela con una factura vigente (Contabilidad primero),
--     ni usa esta puerta para una venta que no se reabrió.
--   * Si quien la registró ya no tiene cuenta activa, el aviso de que la venta
--     volvió a esperar su OT le llega a Gerencia, y solo entonces.
--   * Facturación sabe de qué cotizaciones de varias unidades pasó alguna a otro
--     comprador, y cuántas; no de la que las perdió todas (esa es la «venta
--     cerrada») ni de la que no perdió ninguna.
-- Cada paso con la cuenta del puesto que lo hace y `set local role authenticated`.
-- Termina en rollback.
\set ON_ERROR_STOP on

begin;

insert into public.empresa (ruc, razon_social)
select '20100000498', 'PRUEBAS 498 S.A.C.' where not exists (select 1 from public.empresa);
insert into public.sedes (codigo, nombre) values ('QA498', 'Taller prueba 498') on conflict (codigo) do nothing;
select id as sede_id from public.sedes where codigo = 'QA498' \gset
select test.crear_usuario('Ada', 'Admin', 'admin498@demo.pe', 'ADMIN', :'sede_id') as admin_id \gset
select test.crear_usuario('Gema', 'Gerente', 'gerente498@demo.pe', 'GERENTE', :'sede_id') as gerente_id \gset
select test.crear_usuario('Gala', 'Gerente Comercial', 'comercial498@demo.pe', 'GERENTE_COMERCIAL', :'sede_id') as comercial_id \gset
select test.crear_usuario('Vico', 'Ventas', 'ventas498@demo.pe', 'VENDEDOR', :'sede_id') as ventas_id \gset
select test.crear_usuario('Vera', 'Vendedora que se fue', 'ventas498b@demo.pe', 'VENDEDOR', :'sede_id') as ventas2_id \gset
select test.crear_usuario('Olga', 'Oficina', 'oficina498@demo.pe', 'ADMINISTRACION', :'sede_id') as oficina_id \gset
select test.crear_usuario('Alfo', 'Almacén', 'almacen498@demo.pe', 'ALMACENERO', :'sede_id') as almacen_id \gset
select test.crear_usuario('Cora', 'Contable', 'contabilidad498@demo.pe', 'CONTABILIDAD', :'sede_id') as contable_id \gset

insert into public.clientes (tipo_documento, numero_documento, razon_social) values ('RUC', '20990000498', 'QA PRIMER COMPRADOR 498');
insert into public.clientes (tipo_documento, numero_documento, razon_social) values ('RUC', '20990001498', 'QA OTRO COMPRADOR 498');
select id as cliente_a from public.clientes where numero_documento = '20990000498' \gset
select id as cliente_b from public.clientes where numero_documento = '20990001498' \gset

select set_config('prueba.admin', :'admin_id', true);
select set_config('prueba.gerente', :'gerente_id', true);
select set_config('prueba.comercial', :'comercial_id', true);
select set_config('prueba.ventas', :'ventas_id', true);
select set_config('prueba.ventas2', :'ventas2_id', true);
select set_config('prueba.oficina', :'oficina_id', true);
select set_config('prueba.almacen', :'almacen_id', true);
select set_config('prueba.contable', :'contable_id', true);
select set_config('prueba.cliente_a', :'cliente_a', true);
select set_config('prueba.cliente_b', :'cliente_b', true);
select set_config('prueba.carroceria', (select id::text from public.tipos_carroceria where activo order by orden_secuencia limit 1), true);
select set_config('prueba.g1', gen_random_uuid()::text, true);   -- de Vico: se reabre y la cancela Gerencia
select set_config('prueba.h1', gen_random_uuid()::text, true);   -- su otro comprador
select set_config('prueba.g2', gen_random_uuid()::text, true);   -- de Vera, que ya no está: se reabre con factura
select set_config('prueba.h2', gen_random_uuid()::text, true);
select set_config('prueba.g3', gen_random_uuid()::text, true);   -- aprobada sin OT: no se reabrió
select set_config('prueba.g4', gen_random_uuid()::text, true);   -- con su OT vigente
select set_config('prueba.m', gen_random_uuid()::text, true);    -- tres unidades: una pasa a otro comprador
select set_config('prueba.n', gen_random_uuid()::text, true);
select set_config('prueba.k', gen_random_uuid()::text, true);    -- una unidad que pasa: la venta cerrada
select set_config('prueba.l', gen_random_uuid()::text, true);
select set_config('prueba.ot1', gen_random_uuid()::text, true);
select set_config('prueba.ot2', gen_random_uuid()::text, true);
select set_config('prueba.ot4', gen_random_uuid()::text, true);
select set_config('prueba.otm', gen_random_uuid()::text, true);
select set_config('prueba.otk', gen_random_uuid()::text, true);

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
    'El cliente cedió la unidad a otro comprador (prueba 498)');
end $$;

-- 1. Las cotizaciones, sus OT y los traspasos ----------------------------------------
do $$
declare
  c record;
begin
  for c in select * from (values
      (current_setting('prueba.g1'), 'QA-498-G1', current_setting('prueba.cliente_a'), 1, current_setting('prueba.ventas')),
      (current_setting('prueba.h1'), 'QA-498-H1', current_setting('prueba.cliente_b'), 1, current_setting('prueba.ventas')),
      (current_setting('prueba.g2'), 'QA-498-G2', current_setting('prueba.cliente_a'), 1, current_setting('prueba.ventas2')),
      (current_setting('prueba.h2'), 'QA-498-H2', current_setting('prueba.cliente_b'), 1, current_setting('prueba.ventas')),
      (current_setting('prueba.g3'), 'QA-498-G3', current_setting('prueba.cliente_a'), 1, current_setting('prueba.ventas')),
      (current_setting('prueba.g4'), 'QA-498-G4', current_setting('prueba.cliente_a'), 1, current_setting('prueba.ventas')),
      (current_setting('prueba.m'), 'QA-498-M', current_setting('prueba.cliente_a'), 3, current_setting('prueba.ventas')),
      (current_setting('prueba.n'), 'QA-498-N', current_setting('prueba.cliente_b'), 1, current_setting('prueba.ventas')),
      (current_setting('prueba.k'), 'QA-498-K', current_setting('prueba.cliente_a'), 1, current_setting('prueba.ventas')),
      (current_setting('prueba.l'), 'QA-498-L', current_setting('prueba.cliente_b'), 1, current_setting('prueba.ventas'))
    ) as t(id, numero, cliente, unidades, autor)
  loop
    perform test.como_usuario(c.autor::uuid);
    set local role authenticated;
    insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage,
                                         mime_type, tamano_bytes, registrado_por, monto_venta, moneda, cantidad_unidades)
    values (c.id::uuid, c.numero, c.cliente::uuid, current_setting('prueba.carroceria')::uuid, 'cot.pdf',
            'cot/' || c.id || '/cot.pdf', 'application/pdf', 120, c.autor::uuid, 9000, 'PEN', c.unidades);
    reset role;
  end loop;

  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  update public.cotizaciones_pdf set estado = 'APROBADA' where numero like 'QA-498-%';
  reset role;

  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform pg_temp.cargar(current_setting('prueba.g1'), current_setting('prueba.ot1'), 'QA-498 A', '49801');
  perform pg_temp.pasar(current_setting('prueba.ot1'), current_setting('prueba.h1'));
  perform pg_temp.cargar(current_setting('prueba.g2'), current_setting('prueba.ot2'), 'QA-498 B', '49802');
  perform pg_temp.pasar(current_setting('prueba.ot2'), current_setting('prueba.h2'));
  perform pg_temp.cargar(current_setting('prueba.g4'), current_setting('prueba.ot4'), 'QA-498 D', '49804');
  perform pg_temp.cargar(current_setting('prueba.m'), current_setting('prueba.otm'), 'QA-498 M', '49805');
  perform pg_temp.pasar(current_setting('prueba.otm'), current_setting('prueba.n'));
  perform pg_temp.cargar(current_setting('prueba.k'), current_setting('prueba.otk'), 'QA-498 K', '49806');
  perform pg_temp.pasar(current_setting('prueba.otk'), current_setting('prueba.l'));
  reset role;
end $$;

-- 2. Facturación sabe cuántas unidades pasaron a otro comprador ----------------------
do $$
declare
  v_m constant uuid := current_setting('prueba.m')::uuid;
  v_todas constant uuid[] := array[
    current_setting('prueba.m')::uuid, current_setting('prueba.n')::uuid, current_setting('prueba.k')::uuid,
    current_setting('prueba.l')::uuid, current_setting('prueba.g3')::uuid, current_setting('prueba.g4')::uuid];
  v record;
  v_n integer;
begin
  perform test.como_usuario(current_setting('prueba.contable')::uuid);
  set local role authenticated;
  select count(*) into v_n from public.unidades_que_pasaron_a_otro_comprador(v_todas);
  select u.cotizacion_id, u.pasaron, u.unidades into v from public.unidades_que_pasaron_a_otro_comprador(v_todas) u;
  perform test.afirmar(v_n = 1 and v.cotizacion_id = v_m and v.pasaron = 1 and v.unidades = 3,
    'Contabilidad lee que de la de tres unidades pasó 1 a otro comprador, y de ninguna otra: '
      || v_n || ' fila(s), ' || coalesce(v.pasaron::text, '?') || ' de ' || coalesce(v.unidades::text, '?'));
  perform test.afirmar(
    exists (select 1 from public.cotizaciones_para_facturar() f where f.cotizacion_id = v_m and f.monto_venta = 9000),
    'Y Facturación la sigue listando con el total de la cotización entera, sin descontar nada');
  perform test.afirmar(
    exists (select 1 from public.ventas_cerradas_por_otro_comprador(v_todas) c where c.cotizacion_id = current_setting('prueba.k')::uuid)
    and not exists (select 1 from public.ventas_cerradas_por_otro_comprador(v_todas) c where c.cotizacion_id = v_m),
    'La que perdió su única unidad sigue siendo la «venta cerrada», y la de tres no lo es');
  reset role;

  perform test.como_usuario(current_setting('prueba.almacen')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format('select * from public.unidades_que_pasaron_a_otro_comprador(array[%L]::uuid[])', v_m),
    'Almacén no pregunta por las unidades que pasaron', 'No tienes permiso para ver las cotizaciones aprobadas');
  reset role;
  perform test.afirmar(not has_function_privilege('anon', 'public.unidades_que_pasaron_a_otro_comprador(uuid[])', 'execute'),
    'Sin sesión no se ejecuta');
end $$;

-- 3. La venta de Vico se reabre: el aviso es para él, no para Gerencia ---------------
do $$
declare
  v_g1 constant uuid := current_setting('prueba.g1')::uuid;
  v_motivo constant text := 'El cliente desistió y el vendedor ya no está (prueba 498)';
  v record;
  v_n integer;
begin
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  update public.ordenes_trabajo set estado = 'ANULADA', motivo_anulacion = 'El otro comprador desistió (prueba 498)'
   where id = current_setting('prueba.ot1')::uuid;
  reset role;
  perform test.afirmar(
    (select count(*) from public.notificaciones n
      where n.origen_id = v_g1 and n.titulo = 'Tu venta volvió a esperar su OT' and n.usuario_id = current_setting('prueba.ventas')::uuid) = 1
    and not exists (select 1 from public.notificaciones n where n.origen_id = v_g1 and n.titulo = 'Una venta volvió a esperar su OT'),
    'Con el vendedor activo, el aviso le llega a él y a Gerencia no');

  -- Quien no la registró ni es Gerencia no la cancela.
  perform test.como_usuario(current_setting('prueba.comercial')::uuid);
  set local role authenticated;
  perform test.afirmar(not public.puede_cancelar_la_venta(v_g1), 'Gerencia Comercial no puede cancelarla');
  perform test.debe_fallar(format('select public.cancelar_venta_reabierta(%L, %L)', v_g1, v_motivo),
    'Gerencia Comercial no cancela la venta', 'quien registró la cotización QA-498-G1, o Gerencia General');
  reset role;
  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format('select public.cancelar_venta_reabierta(%L, %L)', v_g1, v_motivo),
    'Administración tampoco', 'quien registró la cotización QA-498-G1, o Gerencia General');
  reset role;
  perform test.como_usuario(current_setting('prueba.contable')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format('select public.cancelar_venta_reabierta(%L, %L)', v_g1, v_motivo),
    'Ni Contabilidad', 'quien registró la cotización QA-498-G1, o Gerencia General');
  reset role;
  perform test.afirmar((select estado = 'APROBADA' from public.cotizaciones_pdf where id = v_g1), 'La venta sigue aprobada');

  -- Quien la registró la sigue pudiendo cancelar.
  perform test.como_usuario(current_setting('prueba.ventas')::uuid);
  set local role authenticated;
  perform test.afirmar(public.puede_cancelar_la_venta(v_g1), 'Quien la registró sigue pudiendo cancelarla');
  reset role;

  -- Gerencia: con las mismas condiciones.
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  perform test.afirmar(public.puede_cancelar_la_venta(v_g1), 'Gerencia puede cancelar la venta reabierta que no registró');
  perform test.afirmar(
    (select (reabierta_por_ot_anulada->>'sin_quien_la_registro')::boolean from public.v_cotizaciones_pdf where id = v_g1) is false,
    'Con el vendedor activo, a Gerencia la lista no le dice que le toca a ella');
  reset role;
  -- Si la cuenta se da de baja después de la reapertura (el aviso ya salió para esa
  -- persona), a Gerencia se lo dice la lista; a los demás no.
  perform test.como_usuario(current_setting('prueba.admin')::uuid);
  update public.usuarios set activo = false where id = current_setting('prueba.ventas')::uuid;
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  perform test.afirmar(
    (select (reabierta_por_ot_anulada->>'sin_quien_la_registro')::boolean from public.v_cotizaciones_pdf where id = v_g1) is true,
    'Si quien la registró se da de baja después de la reapertura, a Gerencia se lo dice la lista');
  reset role;
  perform test.afirmar(
    (select count(*) from public.notificaciones n
      where n.origen_id = v_g1 and n.titulo = 'Una venta volvió a esperar su OT'
        and n.usuario_id = current_setting('prueba.gerente')::uuid
        and n.cuerpo like 'La QA-498-G1 de %ya no tiene cuenta activa o cambió de puesto.%cancélala con «Cancelar la venta».') = 1,
    'Y en ese momento le llega el aviso a Gerencia, que es quien puede cancelarla');
  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform test.afirmar(
    (select reabierta_por_ot_anulada is not null and (reabierta_por_ot_anulada->>'sin_quien_la_registro')::boolean is false
       from public.v_cotizaciones_pdf where id = v_g1),
    'A Administración la lista le dice que se reabrió, no quién sigue con cuenta');
  reset role;
  perform test.como_usuario(current_setting('prueba.comercial')::uuid);
  set local role authenticated;
  perform test.afirmar(
    (select (reabierta_por_ot_anulada->>'sin_quien_la_registro')::boolean is false from public.v_cotizaciones_pdf where id = v_g1),
    'Ni a Gerencia Comercial');
  reset role;
  perform test.como_usuario(current_setting('prueba.admin')::uuid);
  update public.usuarios set activo = true where id = current_setting('prueba.ventas')::uuid;
  perform test.afirmar(
    (select count(*) from public.notificaciones n
      where n.origen_id = v_g1 and n.titulo = 'Una venta volvió a esperar su OT'
        and n.usuario_id = current_setting('prueba.gerente')::uuid) = 1,
    'Devolverle la cuenta no avisa otra vez');
  -- Lo mismo si pasa a un puesto que no registra cotizaciones: el aviso suyo le pediría algo que ya no puede hacer.
  update public.usuarios set rol_id = (select id from public.roles where codigo = 'ALMACENERO')
   where id = current_setting('prueba.ventas')::uuid;
  perform test.afirmar(
    (select count(*) from public.notificaciones n
      where n.origen_id = v_g1 and n.titulo = 'Una venta volvió a esperar su OT'
        and n.usuario_id = current_setting('prueba.gerente')::uuid) = 2,
    'Si quien la registró pasa a un puesto que no registra cotizaciones, también se le avisa a Gerencia');
  perform test.como_usuario(current_setting('prueba.ventas')::uuid);
  set local role authenticated;
  perform test.afirmar(not public.puede_cancelar_la_venta(v_g1), 'En su puesto nuevo ya no puede cancelarla');
  reset role;
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  perform test.afirmar(
    (select (reabierta_por_ot_anulada->>'sin_quien_la_registro')::boolean from public.v_cotizaciones_pdf where id = v_g1) is true,
    'Y la lista le dice a Gerencia que le toca a ella');
  reset role;
  perform test.como_usuario(current_setting('prueba.admin')::uuid);
  update public.usuarios set rol_id = (select id from public.roles where codigo = 'VENDEDOR')
   where id = current_setting('prueba.ventas')::uuid;
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  perform test.afirmar(
    not public.puede_cancelar_la_venta(current_setting('prueba.g3')::uuid)
    and not public.puede_cancelar_la_venta(current_setting('prueba.g4')::uuid)
    and not public.puede_cancelar_la_venta(current_setting('prueba.k')::uuid),
    'Y no la que no se reabrió: ni la que espera su primera OT, ni la que tiene su OT, ni la cerrada');
  perform test.debe_fallar(format('select public.cancelar_venta_reabierta(%L, %L)', v_g1, 'corto'),
    'A Gerencia también se le pide el motivo', 'al menos 10 caracteres');
  perform test.debe_fallar(format('select public.cancelar_venta_reabierta(%L, %L)', current_setting('prueba.g3'), v_motivo),
    'Esta puerta no es para la venta que no se reabrió', 'es solo para la venta que se reabrió');
  perform test.debe_fallar(format('select public.cancelar_venta_reabierta(%L, %L)', current_setting('prueba.k'), v_motivo),
    'Ni para la venta cerrada', 'es solo para la venta que se reabrió');
  perform test.debe_fallar(format('select public.cancelar_venta_reabierta(%L, %L)', current_setting('prueba.g4'), v_motivo),
    'Ni para la que tiene su OT vigente', 'vigente: la venta sigue');

  perform public.cancelar_venta_reabierta(v_g1, '  ' || v_motivo || '  ');
  perform public.cancelar_venta_reabierta(v_g1, v_motivo);   -- el mismo envío otra vez no falla
  perform test.debe_fallar(format('select public.cancelar_venta_reabierta(%L, %L)', v_g1, 'Otro motivo distinto del primero'),
    'El reenvío con otro motivo dice que ya quedó con el primero', 'ya quedó cancelada la primera vez que la enviaste');
  reset role;

  select c.estado::text as estado, c.motivo_anulacion, c.anulado_por, c.anulado_en, c.revisado_por, c.numero, c.registrado_por
    into v from public.cotizaciones_pdf c where c.id = v_g1;
  perform test.afirmar(
    v.estado = 'ANULADA' and v.motivo_anulacion = v_motivo and v.anulado_por = current_setting('prueba.gerente')::uuid
    and v.anulado_en is not null and v.numero = 'QA-498-G1' and v.registrado_por = current_setting('prueba.ventas')::uuid,
    'La venta que canceló Gerencia queda anulada con su motivo, quién y cuándo; conserva su número y quién la registró');

  -- Y quien la registró se entera de que Gerencia la canceló, con el motivo.
  perform test.afirmar(
    (select count(*) from public.notificaciones n
      where n.origen_id = v_g1 and n.usuario_id = current_setting('prueba.ventas')::uuid
        and n.titulo = 'Gerencia anuló tu cotización' and n.cuerpo like '%Motivo: ' || v_motivo || '%'
        and n.ruta = '/cotizaciones/pdf?estado=ANULADA') = 1,
    'A quien la registró le llega el aviso de que Gerencia la anuló, con el motivo');

  perform test.afirmar(
    (select count(*) > 0 and count(*) filter (where n.leida_en is null) = 0 from public.notificaciones n
      where n.origen_id = v_g1 and n.titulo like '%volvió a esperar su OT'),
    'Cancelada la venta, los avisos de que volvió a esperar su OT se dan por leídos: ya no piden nada');

  -- El vendedor, que no la canceló, lee que ya está anulada.
  perform test.como_usuario(current_setting('prueba.ventas')::uuid);
  set local role authenticated;
  perform test.debe_fallar(format('select public.cancelar_venta_reabierta(%L, %L)', v_g1, v_motivo),
    'Si después la envía quien la registró, lee que ya está anulada', 'ya está anulada');
  perform test.afirmar(
    (select estado = 'ANULADA' from public.v_cotizaciones_pdf where id = v_g1) and not public.puede_cancelar_la_venta(v_g1),
    'Y en su lista figura anulada, sin nada que cancelar');
  reset role;

  perform test.como_usuario(current_setting('prueba.oficina')::uuid);
  set local role authenticated;
  perform test.afirmar(not exists (select 1 from public.pendientes_de_las_ot() p where p.documento = v_g1),
    'Y sale de «Por completar» de Administración');
  reset role;
end $$;

-- 4. La venta de quien ya no está: el aviso va a Gerencia, y la factura primero ------
do $$
declare
  v_g2 constant uuid := current_setting('prueba.g2')::uuid;
  v_motivo constant text := 'La vendedora ya no trabaja aquí y el cliente desistió (prueba 498)';
  v_factura uuid;
  v record;
  v_n integer;
begin
  -- Vera deja de tener cuenta activa, y la venta ya tenía una factura.
  perform test.como_usuario(current_setting('prueba.admin')::uuid);
  update public.usuarios set activo = false where id = current_setting('prueba.ventas2')::uuid;
  perform set_config('session_replication_role', 'replica', true);
  insert into public.facturas_venta (codigo_interno, cotizacion_pdf_id, cotizacion_numero, cliente, numero, fecha_emision,
                                     fecha_vencimiento, moneda, total, ruta_storage, nombre_archivo, tamano_bytes, registrado_por)
  values ('QA-498 B', v_g2, 'QA-498-G2', 'QA PRIMER COMPRADOR 498', 'E001-4982', current_date - 3, current_date + 27,
          'PEN', 500, 'fv/qa-498-2.pdf', 'qa-498-2.pdf', 120, current_setting('prueba.contable')::uuid)
  returning id into v_factura;
  perform set_config('session_replication_role', 'origin', true);

  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  update public.ordenes_trabajo set estado = 'ANULADA', motivo_anulacion = 'El otro comprador desistió (prueba 498)'
   where id = current_setting('prueba.ot2')::uuid;
  reset role;

  perform test.afirmar(
    not exists (select 1 from public.notificaciones n where n.origen_id = v_g2 and n.titulo like '%volvió a esperar su OT'
                   and n.usuario_id = current_setting('prueba.ventas2')::uuid),
    'A quien ya no tiene cuenta activa no se le avisa');
  -- `notificar_a_permiso` avisa a quien tiene el permiso y al administrador del sistema: a nadie más.
  select count(*) filter (where n.usuario_id = current_setting('prueba.gerente')::uuid) as a_gerencia,
         count(*) filter (where n.usuario_id = current_setting('prueba.admin')::uuid) as al_admin,
         count(*) filter (where r.codigo not in ('GERENTE', 'ADMIN')) as a_otros,
         max(n.cuerpo) as cuerpo, max(n.ruta) as ruta
    into v
    from public.notificaciones n
    join public.usuarios u on u.id = n.usuario_id
    join public.roles r on r.id = u.rol_id
   where n.origen_id = v_g2 and n.titulo = 'Una venta volvió a esperar su OT';
  perform test.afirmar(v.a_gerencia = 1 and v.al_admin = 1 and v.a_otros = 0,
    'El aviso le llega a Gerencia, una vez y aunque fue ella quien anuló la OT, y al administrador del sistema; a ningún otro puesto: '
      || v.a_gerencia || ' a Gerencia, ' || v.al_admin || ' al administrador, ' || v.a_otros || ' a otros');
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  perform test.afirmar(
    (select (reabierta_por_ot_anulada->>'sin_quien_la_registro')::boolean from public.v_cotizaciones_pdf where id = v_g2) is true,
    'Y la lista le dice a Gerencia que quien la registró ya no tiene cuenta activa');
  reset role;
  perform test.afirmar(
    v.cuerpo like 'La QA-498-G2 de QA PRIMER COMPRADOR 498.%quien registró la cotización ya no tiene cuenta activa o cambió de puesto.%Contabilidad anula primero su factura%'
    and v.ruta = '/cotizaciones/pdf?estado=APROBADA_SIN_OT#' || v_g2,
    'Dice de qué venta es, por qué le llega a Gerencia y que la factura va primero, y lleva a su tarjeta: ' || coalesce(v.cuerpo, 'nada'));

  -- Con la factura vigente, Gerencia tampoco la cancela por esta puerta.
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  perform test.afirmar(not public.puede_cancelar_la_venta(v_g2), 'Con una factura vigente, Gerencia todavía no puede cancelarla');
  perform test.debe_fallar(format('select public.cancelar_venta_reabierta(%L, %L)', v_g2, v_motivo),
    'Con una factura vigente no se cancela', 'Contabilidad la anula primero');
  reset role;

  perform set_config('session_replication_role', 'replica', true);
  update public.facturas_venta set anulada_en = now(), anulada_por = current_setting('prueba.contable')::uuid,
         motivo_anulacion = 'Se emitió por error (prueba 498)' where id = v_factura;
  perform set_config('session_replication_role', 'origin', true);

  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  perform test.afirmar(public.puede_cancelar_la_venta(v_g2), 'Anulada la factura, Gerencia sí puede');
  perform public.cancelar_venta_reabierta(v_g2, v_motivo);
  reset role;
  select count(*) into v_n from public.cotizaciones_pdf c
   where c.id = v_g2 and c.estado = 'ANULADA' and c.motivo_anulacion = v_motivo
     and c.anulado_por = current_setting('prueba.gerente')::uuid and c.numero = 'QA-498-G2';
  perform test.afirmar(v_n = 1, 'La venta de quien ya no está queda anulada por Gerencia, con su motivo y su número');
end $$;

-- 5. La unidad que pasó y se anuló ya no cuenta para Facturación ----------------------
do $$
declare
  v_m constant uuid := current_setting('prueba.m')::uuid;
begin
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  update public.ordenes_trabajo set estado = 'ANULADA', motivo_anulacion = 'El otro comprador desistió (prueba 498)'
   where id = current_setting('prueba.otm')::uuid;
  reset role;
  perform test.como_usuario(current_setting('prueba.contable')::uuid);
  set local role authenticated;
  perform test.afirmar(
    not exists (select 1 from public.unidades_que_pasaron_a_otro_comprador(array[v_m])),
    'Anulada la OT que había pasado, a esa cotización ya no le pasó ninguna unidad: Facturación deja de avisarlo');
  reset role;
end $$;

rollback;
