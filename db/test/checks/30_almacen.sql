-- Kardex valorizado por promedio ponderado y control de existencias.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social) values ('20100000003', 'PRUEBAS ALMACEN S.A.C.');
insert into public.sedes (codigo, nombre) values ('T1', 'Taller principal');
insert into public.almacenes (codigo, nombre, sede_id, tipo)
  select 'ALM01', 'Almacén central', id, 'PRINCIPAL' from public.sedes limit 1;

insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id, espesor_mm, calidad_acero)
  select 'PL-A36-6', 'Plancha LAC A36 6 mm 1.20 x 2.40 m', c.id, u.id, 6, 'ASTM A36'
    from public.categorias_material c, public.unidades_medida u
   where c.codigo = 'ACERO_LAC' and u.codigo = 'KG';

-- --- primer ingreso: 100 kg a S/ 4.00 ---------------------------------------
do $$
declare v_mov uuid;
begin
  insert into public.movimientos_almacen (tipo, almacen_id, documento_referencia)
    select 'INGRESO', id, 'Guía 001-1234' from public.almacenes limit 1
    returning id into v_mov;

  insert into public.movimiento_detalle (movimiento_id, material_id, cantidad, costo_unitario)
    select v_mov, id, 100, 4.00 from public.materiales limit 1;

  perform test.afirmar(
    (select cantidad from public.almacen_stock
      where material_id = (select id from public.materiales limit 1)) is null,
    'un movimiento en borrador todavía no afecta el stock');

  perform public.confirmar_movimiento_almacen(v_mov);

  perform test.afirmar(
    (select cantidad from public.almacen_stock
      where material_id = (select id from public.materiales limit 1)) = 100,
    'al confirmar el ingreso el stock sube a 100');
  perform test.afirmar(
    (select costo_promedio from public.materiales limit 1) = 4.00,
    'el costo promedio queda en 4.00');
end $$;

-- --- segundo ingreso a otro precio: el promedio se ponderа ------------------
do $$
declare v_mov uuid;
begin
  insert into public.movimientos_almacen (tipo, almacen_id, documento_referencia)
    select 'INGRESO', id, 'Guía 001-1290' from public.almacenes limit 1
    returning id into v_mov;

  insert into public.movimiento_detalle (movimiento_id, material_id, cantidad, costo_unitario)
    select v_mov, id, 100, 6.00 from public.materiales limit 1;

  perform public.confirmar_movimiento_almacen(v_mov);

  perform test.afirmar(
    (select costo_promedio from public.materiales limit 1) = 5.00,
    format('100 kg a 4.00 más 100 kg a 6.00 dan promedio 5.00: %s',
           (select costo_promedio from public.materiales limit 1)));
  perform test.afirmar(
    (select saldo_valor from public.kardex order by secuencia desc limit 1) = 1000.00,
    'el saldo valorizado del kardex es 1000.00');
end $$;

-- --- salida a una OT: se valoriza al promedio, no al costo que se escriba ---
do $$
declare
  v_mov uuid;
  v_ot  uuid;
begin
  insert into public.clientes (tipo_documento, numero_documento, razon_social)
    values ('RUC', '20777777777', 'CONSTRUCTORA DEL NORTE S.A.');
  insert into public.ordenes_trabajo (cliente_id, sede_id, descripcion)
    select c.id, s.id, 'Tolva 15 m3' from public.clientes c cross join public.sedes s limit 1
    returning id into v_ot;
  update public.ordenes_trabajo set estado = 'APROBADA' where id = v_ot;
  update public.ordenes_trabajo set estado = 'EN_PROCESO' where id = v_ot;

  insert into public.movimientos_almacen (tipo, almacen_id, orden_id)
    select 'SALIDA_OT', id, v_ot from public.almacenes limit 1
    returning id into v_mov;

  -- Se propone a propósito un costo absurdo: la confirmación debe ignorarlo.
  insert into public.movimiento_detalle (movimiento_id, material_id, cantidad, costo_unitario)
    select v_mov, id, 50, 999.00 from public.materiales limit 1;

  perform public.confirmar_movimiento_almacen(v_mov);

  perform test.afirmar(
    (select costo_unitario from public.kardex where tipo_movimiento = 'SALIDA_OT' order by secuencia desc limit 1) = 5.00,
    'la salida se valoriza al promedio ponderado, no al costo propuesto');
  perform test.afirmar(
    (select costo_total from public.kardex where tipo_movimiento = 'SALIDA_OT' order by secuencia desc limit 1) = 250.00,
    '50 kg a 5.00 son 250.00 cargados a la OT');
  perform test.afirmar(
    (select cantidad from public.almacen_stock
      where material_id = (select id from public.materiales limit 1)) = 150,
    'quedan 150 kg en stock');
  perform test.afirmar(
    (select costo_promedio from public.materiales limit 1) = 5.00,
    'una salida no altera el costo promedio');
end $$;

-- --- el stock no puede quedar negativo --------------------------------------
do $$
declare
  v_mov uuid;
  v_ot  uuid;
begin
  select id into v_ot from public.ordenes_trabajo limit 1;

  insert into public.movimientos_almacen (tipo, almacen_id, orden_id)
    select 'SALIDA_OT', id, v_ot from public.almacenes limit 1
    returning id into v_mov;

  insert into public.movimiento_detalle (movimiento_id, material_id, cantidad, costo_unitario)
    select v_mov, id, 500, 0 from public.materiales limit 1;

  perform test.debe_fallar(
    format('select public.confirmar_movimiento_almacen(%L)', v_mov),
    'no se puede sacar más material del que hay en el almacén');

  perform test.afirmar(
    (select cantidad from public.almacen_stock
      where material_id = (select id from public.materiales limit 1)) = 150,
    'tras el intento fallido el stock sigue intacto');
end $$;

-- --- un movimiento no se confirma dos veces ---------------------------------
do $$
declare v_mov uuid;
begin
  select id into v_mov from public.movimientos_almacen
   where estado = 'CONFIRMADO' order by creado_en limit 1;

  perform test.debe_fallar(
    format('select public.confirmar_movimiento_almacen(%L)', v_mov),
    'un movimiento ya confirmado no se vuelve a confirmar');
end $$;

-- --- el kardex es inmutable --------------------------------------------------
do $$
declare v_id uuid;
begin
  select id into v_id from public.kardex limit 1;
  perform test.debe_fallar(
    format('update public.kardex set cantidad = 1 where id = %L', v_id),
    'el kardex no se puede modificar: las correcciones van por ajuste');
  perform test.debe_fallar(
    format('delete from public.kardex where id = %L', v_id),
    'el kardex no se puede borrar');
end $$;

-- --- la devolución del taller repone el stock -------------------------------
do $$
declare
  v_mov uuid;
  v_ot  uuid;
begin
  select id into v_ot from public.ordenes_trabajo limit 1;

  insert into public.movimientos_almacen (tipo, almacen_id, orden_id)
    select 'DEVOLUCION_OT', id, v_ot from public.almacenes limit 1
    returning id into v_mov;

  insert into public.movimiento_detalle (movimiento_id, material_id, cantidad, costo_unitario)
    select v_mov, id, 10, 0 from public.materiales limit 1;

  perform public.confirmar_movimiento_almacen(v_mov);

  perform test.afirmar(
    (select cantidad from public.almacen_stock
      where material_id = (select id from public.materiales limit 1)) = 160,
    'la devolución de 10 kg deja el stock en 160');
end $$;

-- --- consumo neto imputado a la OT ------------------------------------------
do $$
declare v_neto numeric;
begin
  select coalesce(sum(case when tipo_movimiento = 'SALIDA_OT' then costo_total
                           when tipo_movimiento = 'INGRESO_DEVOLUCION' then -costo_total
                           else 0 end), 0)
    into v_neto
    from public.kardex
   where orden_id = (select id from public.ordenes_trabajo limit 1);

  perform test.afirmar(
    v_neto = 200.00,
    format('el consumo neto de la OT es 250 menos 50 devueltos: %s', v_neto));
end $$;

rollback;
