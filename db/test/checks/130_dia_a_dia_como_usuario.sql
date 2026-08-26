-- El día a día con los permisos de verdad: los documentos se emiten con
-- `set role authenticated`, no como superusuario. Este check existe porque la
-- migración 022 rompió la numeración para los usuarios reales y ninguna
-- prueba lo vio: todas insertaban como postgres.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social) values ('20100000017', 'PRUEBAS DIA A DIA S.A.C.');
insert into public.sedes (codigo, nombre) values ('T1', 'Taller principal');

select test.crear_usuario('Vera',  'Sandoval', 'vera@demo.pe',  'VENDEDOR',   (select id from public.sedes limit 1)) as vendedor_id \gset
select test.crear_usuario('Rosa',  'Yupanqui', 'rosa@demo.pe',  'JEFE_TALLER',(select id from public.sedes limit 1)) as jefe_id \gset
select test.crear_usuario('Jesus', 'Campos',   'jesus@demo.pe', 'ALMACENERO', (select id from public.sedes limit 1)) as almacenero_id \gset

insert into public.clientes (tipo_documento, numero_documento, razon_social)
  values ('RUC', '20607761907', 'TRANSPORTES VEGA PIUNDO S.A.C');
insert into public.unidades (cliente_id, placa, tipo_vehiculo)
  select id, 'D7M-330', 'VOLQUETE' from public.clientes limit 1;
insert into public.almacenes (codigo, nombre, sede_id)
  select 'A1', 'Almacén central', id from public.sedes limit 1
  on conflict do nothing;

-- Los IDs viajan como literales por set_config: un insert…select bajo RLS
-- puede alimentarse de cero filas y «pasar» sin insertar nada.
select set_config('prueba.cliente', (select id::text from public.clientes limit 1), false);
select set_config('prueba.unidad',  (select id::text from public.unidades limit 1), false);
select set_config('prueba.sede',    (select id::text from public.sedes limit 1), false);
select set_config('prueba.almacen', (select id::text from public.almacenes limit 1), false);

-- ------------------------------------- el vendedor emite una cotización
select test.como_usuario(:'vendedor_id');
set local role authenticated;

do $$
declare v_numero text;
begin
  insert into public.cotizaciones (cliente_id, unidad_id, fecha_emision)
  values (current_setting('prueba.cliente')::uuid,
          current_setting('prueba.unidad')::uuid, current_date)
  returning numero into v_numero;

  perform test.afirmar(v_numero ~ '^\d+-\d{4}$',
    format('el vendedor emite y el sistema numera: %s', v_numero));
end $$;

reset role;

-- ------------------------------------- el jefe de taller abre una orden
select test.como_usuario(:'jefe_id');
set local role authenticated;

do $$
declare v_numero text;
begin
  insert into public.ordenes_trabajo (cliente_id, unidad_id, sede_id, descripcion, tipo_trabajo)
  values (current_setting('prueba.cliente')::uuid,
          current_setting('prueba.unidad')::uuid,
          current_setting('prueba.sede')::uuid,
          'Cambio de compuerta posterior', 'REPARACION')
  returning numero into v_numero;

  perform test.afirmar(v_numero ~ '^\d+-\d{4}$',
    format('el jefe de taller abre la orden y el sistema numera: %s', v_numero));

  -- Y pide material para ella.
  select id::text into v_numero from public.ordenes_trabajo limit 1;
  insert into public.requerimientos (orden_id, sede_id, solicitante_id, fecha_requerida)
  values (v_numero::uuid, current_setting('prueba.sede')::uuid,
          public.usuario_actual(), current_date + 3)
  returning numero into v_numero;

  perform test.afirmar(v_numero like 'REQ-%',
    format('y el requerimiento se numera solo: %s', v_numero));
end $$;

reset role;

-- ------------------------------------- el almacenero registra un ingreso
select test.como_usuario(:'almacenero_id');
set local role authenticated;

do $$
declare v_numero text;
begin
  insert into public.movimientos_almacen (tipo, almacen_id, motivo)
  values ('INGRESO', current_setting('prueba.almacen')::uuid,
          'Ingreso de prueba del día a día')
  returning numero into v_numero;

  perform test.afirmar(v_numero like 'ING-%',
    format('el almacenero registra y el movimiento se numera: %s', v_numero));
end $$;

reset role;

-- ------------------------------------- y el correlativo sigue cerrado a mano
select test.como_usuario(:'vendedor_id');
set local role authenticated;

do $$
begin
  begin
    perform public.siguiente_correlativo('COTIZACION', null);
    raise exception 'FALLA: el correlativo quedó abierto a la mano del usuario';
  exception when others then
    if sqlerrm like 'FALLA%' then raise; end if;
    raise notice '  ok · numerar sigue siendo del sistema, no del usuario (%)', sqlerrm;
  end;
end $$;

reset role;

rollback;
