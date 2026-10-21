-- El día a día con los permisos de verdad: los documentos se emiten con
-- `set role authenticated`, no como superusuario. Este check existe porque la
-- migración 022 rompió la numeración para los usuarios reales y ninguna
-- prueba lo vio: todas insertaban como postgres.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social) values ('20100000017', 'PRUEBAS DIA A DIA S.A.C.');
insert into public.sedes (codigo, nombre) values ('T1', 'Taller principal');

select test.crear_usuario('Vera',  'Sandoval', 'vera@demo.pe',  'VENDEDOR',   (select id from public.sedes limit 1)) as vendedor_id \gset
-- La jefatura de taller que abría órdenes ya no existe (migración
-- 20260929110100) y Supervisión dejó `ordenes.abrir_taller` en la
-- 20261016120000: hoy la OT la abre Administración (`ordenes.crear`).
select test.crear_usuario('Rosa',  'Yupanqui', 'rosa@demo.pe',  'ADMINISTRACION',(select id from public.sedes limit 1)) as jefe_id \gset

insert into public.clientes (tipo_documento, numero_documento, razon_social)
  values ('RUC', '20607761907', 'TRANSPORTES VEGA PIUNDO S.A.C');
insert into public.unidades (cliente_id, placa, tipo_vehiculo)
  select id, 'D7M-330', 'VOLQUETE' from public.clientes limit 1;

-- Los IDs viajan como literales por set_config: un insert…select bajo RLS
-- puede alimentarse de cero filas y «pasar» sin insertar nada.
select set_config('prueba.cliente', (select id::text from public.clientes limit 1), false);
select set_config('prueba.unidad',  (select id::text from public.unidades limit 1), false);
select set_config('prueba.sede',    (select id::text from public.sedes limit 1), false);

-- ------------------------------------- el vendedor conserva acceso al PDF
select test.como_usuario(:'vendedor_id');
set local role authenticated;

do $$
begin
  perform test.afirmar(public.tiene_permiso('cotizaciones.crear'),
    'el vendedor puede registrar su cotización en PDF');
end $$;

reset role;

-- ------------------------------------- Administración abre una orden
-- Desde la migración 20261017402000 la orden sin cotización entra con su PDF
-- por `registrar_orden_sin_cotizacion`; el insert directo queda solo para el
-- administrador del sistema. El PDF ya subido se siembra en Storage.
select gen_random_uuid() as orden_id \gset
select set_config('prueba.orden', :'orden_id', false);
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('adjuntos-ot', 'ot/' || :'orden_id' || '/orden.pdf', :'jefe_id',
        '{"mimetype":"application/pdf","size":2048}');

select test.como_usuario(:'jefe_id');
set local role authenticated;

do $$
declare v_numero text;
begin
  perform test.debe_fallar(
    format($sql$insert into public.ordenes_trabajo (cliente_id, unidad_id, sede_id, descripcion, tipo_trabajo)
                values (%L, %L, %L, 'Orden sin su PDF', 'REPARACION')$sql$,
           current_setting('prueba.cliente'), current_setting('prueba.unidad'), current_setting('prueba.sede')),
    'la orden ya no entra directo por la API, sin su PDF', 'row-level security');

  perform public.registrar_orden_sin_cotizacion(
    current_setting('prueba.orden')::uuid,
    '8130',
    current_setting('prueba.cliente')::uuid,
    current_setting('prueba.unidad')::uuid,
    current_setting('prueba.sede')::uuid,
    null, 'REPARACION', 'NORMAL',
    'Cambio de compuerta posterior', null, null, null, null, null, null,
    'ot/' || current_setting('prueba.orden') || '/orden.pdf', 'orden.pdf', 2048);

  select numero into v_numero from public.ordenes_trabajo
   where id = current_setting('prueba.orden')::uuid;

  perform test.afirmar(v_numero = '8130-' || to_char((now() at time zone 'America/Lima')::date, 'YYYY'),
    format('Administración abre la orden con el número de su papel: %s', v_numero));
end $$;

reset role;

-- ------------------------------------- el correlativo sigue cerrado a mano
select test.como_usuario(:'vendedor_id');
set local role authenticated;

do $$
begin
  begin
    perform public.siguiente_correlativo('ORDEN_TRABAJO', null);
    raise exception 'FALLA: el correlativo quedó abierto a la mano del usuario';
  exception when others then
    if sqlerrm like 'FALLA%' then raise; end if;
    raise notice '  ok · numerar sigue siendo del sistema, no del usuario (%)', sqlerrm;
  end;
end $$;

reset role;

rollback;
