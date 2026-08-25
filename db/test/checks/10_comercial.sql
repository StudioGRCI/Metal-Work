-- Reglas de negocio del dominio comercial.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social, igv_porcentaje)
  values ('20100000001', 'PRUEBAS S.A.C.', 18);

insert into public.clientes (tipo_documento, numero_documento, razon_social)
  values ('RUC', '20999999999', 'TRANSPORTES DEL SUR S.A.C.');

insert into public.unidades (cliente_id, placa, tipo_vehiculo, marca)
  select id, 'V2G-841', 'VOLQUETE', 'VOLVO' from public.clientes limit 1;

-- --- correlativo y cálculo de totales -------------------------------------
insert into public.cotizaciones (cliente_id, unidad_id, fecha_emision)
  select c.id, u.id, current_date
    from public.clientes c join public.unidades u on u.cliente_id = c.id limit 1;

do $$
declare v public.cotizaciones;
begin
  select * into v from public.cotizaciones limit 1;
  perform test.afirmar(v.numero like 'COT-001-%', 'la cotización recibe correlativo automático');
  perform test.afirmar(v.estado = 'BORRADOR', 'nace en borrador');
  perform test.afirmar(v.total = 0, 'sin partidas el total es cero');
end $$;

-- --- las partidas recalculan la cabecera ----------------------------------
insert into public.cotizacion_partidas (cotizacion_id, descripcion, cantidad, precio_unitario, tipo_costo)
  select id, 'Tolva volquete 15 m3 en acero A36', 1, 38000, 'MATERIAL' from public.cotizaciones limit 1;
insert into public.cotizacion_partidas (cotizacion_id, descripcion, cantidad, precio_unitario, tipo_costo)
  select id, 'Instalación de sistema hidráulico', 1, 12000, 'SERVICIO' from public.cotizaciones limit 1;

do $$
declare v public.cotizaciones;
begin
  select * into v from public.cotizaciones limit 1;
  perform test.afirmar(v.subtotal = 50000, 'el subtotal suma las partidas: ' || v.subtotal);
  perform test.afirmar(v.igv = 9000, 'el IGV se calcula al 18%: ' || v.igv);
  perform test.afirmar(v.total = 59000, 'el total incluye IGV: ' || v.total);
end $$;

-- --- transiciones de estado ------------------------------------------------
do $$
declare v_id uuid;
begin
  select id into v_id from public.cotizaciones limit 1;
  perform test.debe_fallar(
    format('update public.cotizaciones set estado = ''APROBADA'' where id = %L', v_id),
    'no se puede aprobar una cotización que nunca se envió');

  update public.cotizaciones set estado = 'ENVIADA' where id = v_id;
  update public.cotizaciones set estado = 'APROBADA' where id = v_id;
  perform test.afirmar(
    (select fecha_aprobacion is not null from public.cotizaciones where id = v_id),
    'al aprobar se sella la fecha de aprobación');

  perform test.debe_fallar(
    format('update public.cotizaciones set estado = ''BORRADOR'' where id = %L', v_id),
    'una cotización aprobada no vuelve a borrador');
end $$;

-- --- una cotización aprobada queda congelada -------------------------------
do $$
declare v_id uuid;
begin
  select id into v_id from public.cotizaciones limit 1;
  perform test.debe_fallar(
    format('insert into public.cotizacion_partidas (cotizacion_id, descripcion, cantidad, precio_unitario)
            values (%L, ''Partida colada'', 1, 100)', v_id),
    'no se agregan partidas a una cotización aprobada');
  perform test.debe_fallar(
    format('delete from public.cotizaciones where id = %L', v_id),
    'una cotización aprobada no se borra, se anula');
end $$;

-- --- validaciones de datos -------------------------------------------------
do $$
begin
  perform test.debe_fallar(
    'insert into public.clientes (tipo_documento, numero_documento, razon_social)
     values (''RUC'', ''123'', ''RUC INVÁLIDO'')',
    'el RUC debe tener 11 dígitos');
  perform test.debe_fallar(
    format('insert into public.unidades (cliente_id, placa, tipo_vehiculo)
            values (%L, ''XX'', ''VOLQUETE'')', (select id from public.clientes limit 1)),
    'la placa debe tener formato peruano');
end $$;

rollback;
