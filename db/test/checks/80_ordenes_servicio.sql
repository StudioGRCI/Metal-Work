-- Órdenes de servicio: el documento del subcontrato, su recorrido de estados y
-- cómo entra al costo de la unidad.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social) values ('20100000008', 'PRUEBAS OS S.A.C.');
insert into public.sedes (codigo, nombre) values ('T1', 'Taller principal');

select test.crear_usuario('Ana',   'Torres', 'ana@demo.pe',   'ADMIN',   (select id from public.sedes limit 1)) as admin_id \gset
select test.crear_usuario('Lucía', 'Ferrer', 'lucia@demo.pe', 'CALIDAD', (select id from public.sedes limit 1)) as calidad_id \gset

insert into public.clientes (tipo_documento, numero_documento, razon_social)
  values ('RUC', '20777777777', 'MINERA DEL NORTE S.A.');

insert into public.unidades (cliente_id, placa, tipo_vehiculo)
  values ((select id from public.clientes limit 1), 'ABC-123', 'VOLQUETE');

insert into public.ordenes_trabajo
  (cliente_id, unidad_id, sede_id, tipo_carroceria_id, tipo_trabajo, descripcion, monto_presupuestado)
select (select id from public.clientes limit 1), (select id from public.unidades limit 1),
       (select id from public.sedes limit 1), tc.id, 'FABRICACION', 'Tolva de prueba', 40000
  from public.tipos_carroceria tc limit 1;

insert into public.proveedores (numero_documento, razon_social)
  values ('20999999999', 'ARENADOS DEL NORTE E.I.R.L.');

-- ------------------------------------------------------------- el correlativo
insert into public.servicios_terceros
  (orden_id, proveedor_id, tipo_servicio, descripcion, fecha, fecha_entrega, moneda, monto, tipo_cambio, estado)
values ((select id from public.ordenes_trabajo limit 1),
        (select id from public.proveedores limit 1),
        'ARENADO', 'Arenado comercial SA 2.5 de la tolva',
        current_date, current_date + 3, 'PEN', 1800, 1, 'SOLICITADO');

do $$
declare v_numero text;
begin
  select numero into v_numero from public.servicios_terceros limit 1;

  if v_numero is null or v_numero = '' then
    raise exception 'FALLA: la orden de servicio nació sin número';
  end if;
  if v_numero !~ '^OS-\d{4}-MW$' then
    raise exception 'FALLA: el número no tiene el formato acordado, es %', v_numero;
  end if;
  raise notice '  ok · la orden de servicio se numeró sola: %', v_numero;
end $$;

-- ------------------------------------------------------- no se paga sin recibir
do $$
declare v_os uuid;
begin
  select id into v_os from public.servicios_terceros limit 1;

  begin
    update public.servicios_terceros set estado = 'PAGADO' where id = v_os;
    raise exception 'FALLA: dejó pagar un servicio que nunca volvió del proveedor';
  exception when raise_exception then
    if sqlerrm like 'FALLA:%' then raise; end if;
    raise notice '  ok · no se puede pagar sin conformidad';
  end;
end $$;

-- ---------------------------------------------------------- el costo se mueve
do $$
declare
  v_os          uuid;
  v_costo       numeric;
  v_comprometido numeric;
begin
  select id into v_os from public.servicios_terceros limit 1;

  select costo_servicios, servicios_comprometidos into v_costo, v_comprometido
    from public.v_ot_costo_servicios
   where orden_id = (select id from public.ordenes_trabajo limit 1);

  if v_costo <> 0 or v_comprometido <> 1800 then
    raise exception 'FALLA: pedido debería ser compromiso (costo %, comprometido %)', v_costo, v_comprometido;
  end if;
  raise notice '  ok · lo pedido cuenta como compromiso, no como costo';

  -- La conformidad la da calidad, y queda con nombre y fecha.
  perform set_config('request.jwt.claim.sub', (select id::text from public.usuarios where correo = 'lucia@demo.pe'), true);
  perform public.dar_conformidad_servicio(v_os, 'Arenado uniforme, sin puntos de óxido');

  if not exists (
    select 1 from public.servicios_terceros
     where id = v_os
       and estado = 'CONFORME'
       and fecha_conformidad = current_date
       and conformidad_por = (select id from public.usuarios where correo = 'lucia@demo.pe')
  ) then
    raise exception 'FALLA: la conformidad no quedó con su fecha y su responsable';
  end if;
  raise notice '  ok · la conformidad queda con quién la dio y cuándo';

  select costo_servicios, servicios_comprometidos into v_costo, v_comprometido
    from public.v_ot_costo_servicios
   where orden_id = (select id from public.ordenes_trabajo limit 1);

  if v_costo <> 1800 or v_comprometido <> 0 then
    raise exception 'FALLA: recibido debería ser costo real (costo %, comprometido %)', v_costo, v_comprometido;
  end if;
  raise notice '  ok · al recibir el trabajo pasa a ser costo de la unidad';

  -- Y recién ahora se puede pagar. El sistema además exige la factura: son dos
  -- condiciones distintas, recibir el trabajo y tener el comprobante.
  begin
    update public.servicios_terceros set estado = 'PAGADO' where id = v_os;
    raise exception 'FALLA: dejó pagar sin número de factura';
  exception when check_violation then
    raise notice '  ok · el pago exige además el número de factura';
  end;

  update public.servicios_terceros
     set estado = 'PAGADO', numero_factura = 'F001-00001234', fecha_factura = current_date
   where id = v_os;
  raise notice '  ok · con conformidad y factura, el pago procede';
end $$;

-- --------------------------------------------- la conformidad lleva permiso
do $$
declare v_os uuid;
begin
  insert into public.servicios_terceros
    (orden_id, proveedor_id, tipo_servicio, descripcion, fecha, moneda, monto, tipo_cambio, estado)
  values ((select id from public.ordenes_trabajo limit 1),
          (select id from public.proveedores limit 1),
          'PINTURA', 'Pintura poliuretano', current_date, 'PEN', 900, 1, 'SOLICITADO')
  returning id into v_os;

  -- Un vendedor no inspecciona ni acepta trabajo de taller.
  perform test.crear_usuario('Carla', 'Vega', 'carla@demo.pe', 'VENDEDOR', (select id from public.sedes limit 1));
  perform set_config('request.jwt.claim.sub', (select id::text from public.usuarios where correo = 'carla@demo.pe'), true);

  begin
    perform public.dar_conformidad_servicio(v_os);
    raise exception 'FALLA: un vendedor pudo dar la conformidad de un subcontrato';
  exception when insufficient_privilege then
    raise notice '  ok · la conformidad exige el permiso de calidad';
  end;
end $$;

-- ------------------------------------------------- quién toca el documento
-- La orden de servicio la emite logística y la mira costos: si solo la viera
-- costos, el comprador no podría subcontratar nada.
select test.crear_usuario('Raúl', 'Chávez', 'raul@demo.pe', 'COMPRADOR', (select id from public.sedes limit 1)) as comprador_id \gset

select test.como_usuario(:'comprador_id');
set role authenticated;

do $$
begin
  perform test.afirmar(
    (select count(*) from public.servicios_terceros) = 2,
    'el comprador ve las órdenes de servicio');
  perform test.afirmar(
    (select count(*) from public.os_resumen where orden_numero is not null) = 2,
    'y ve contra qué orden de trabajo se emitieron');
end $$;

insert into public.servicios_terceros
  (orden_id, proveedor_id, tipo_servicio, descripcion, fecha, moneda, monto, tipo_cambio, estado)
values ((select id from public.ordenes_trabajo limit 1),
        (select id from public.proveedores limit 1),
        'TORNO', 'Torneado de bocinas del portalón', current_date, 'PEN', 450, 1, 'SOLICITADO');

do $$
begin
  perform test.afirmar(
    (select count(*) from public.servicios_terceros) = 3,
    'el comprador puede emitir una orden de servicio');
end $$;

reset role;

-- El vendedor no tiene nada que hacer en los subcontratos.
-- Los identificadores viajan por parámetros de sesión porque psql no sustituye
-- sus variables dentro de un bloque entre dólares.
select set_config('prueba.orden',     (select id::text from public.ordenes_trabajo limit 1), false);
select set_config('prueba.proveedor', (select id::text from public.proveedores      limit 1), false);

select test.como_usuario((select id from public.usuarios where correo = 'carla@demo.pe'));
set role authenticated;

do $$
declare
  v_orden     uuid := current_setting('prueba.orden')::uuid;
  v_proveedor uuid := current_setting('prueba.proveedor')::uuid;
begin
  perform test.afirmar(
    (select count(*) from public.servicios_terceros) = 0,
    'el vendedor no ve los subcontratos');
  -- Con los identificadores puestos a mano: si se tomaran con un select, el
  -- vendedor no vería ninguna fila y el INSERT de cero filas pasaría sin que
  -- la política llegue a opinar.
  perform test.debe_fallar(
    format(
      'insert into public.servicios_terceros
         (orden_id, proveedor_id, tipo_servicio, descripcion, fecha, moneda, monto, tipo_cambio, estado)
       values (%L, %L, ''OTRO'', ''servicio colado'', current_date, ''PEN'', 100, 1, ''SOLICITADO'')',
      v_orden, v_proveedor),
    'un vendedor no puede emitir órdenes de servicio');
end $$;

reset role;

rollback;
