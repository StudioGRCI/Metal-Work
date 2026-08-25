-- Costeo real de una orden de trabajo: materiales, mano de obra, servicios y
-- la comprobación de que ningún join multiplica importes.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social) values ('20100000005', 'PRUEBAS COSTOS S.A.C.');
insert into public.sedes (codigo, nombre) values ('T1', 'Taller principal');
insert into public.almacenes (codigo, nombre, sede_id)
  select 'ALM01', 'Almacén central', id from public.sedes limit 1;

select test.crear_usuario('Diego', 'Quispe', 'diego@demo.pe', 'OPERARIO',
         (select id from public.sedes limit 1), true, 14.00) as op1 \gset
select test.crear_usuario('Elsa', 'Mendoza', 'elsa@demo.pe', 'OPERARIO',
         (select id from public.sedes limit 1), true, 16.00) as op2 \gset

insert into public.clientes (tipo_documento, numero_documento, razon_social)
  values ('RUC', '20444444444', 'MINERA CENTRAL S.A.');
insert into public.proveedores (numero_documento, razon_social)
  values ('20333333333', 'ARENADOS DEL SUR E.I.R.L.');

insert into public.ordenes_trabajo (cliente_id, sede_id, descripcion, monto_presupuestado)
  select c.id, s.id, 'Tolva 18 m3 para costeo', 1000
    from public.clientes c cross join public.sedes s limit 1;
update public.ordenes_trabajo set estado = 'APROBADA';
update public.ordenes_trabajo set estado = 'EN_PROCESO';

insert into public.ot_personal (orden_id, usuario_id, rol)
  select id, :'op1', 'SOLDADOR' from public.ordenes_trabajo limit 1;
insert into public.ot_personal (orden_id, usuario_id, rol)
  select id, :'op2', 'ARMADOR' from public.ordenes_trabajo limit 1;

-- --- materiales: dos ingresos y dos consumos --------------------------------
insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  select 'PL-A36-6', 'Plancha LAC A36 6 mm', c.id, u.id
    from public.categorias_material c, public.unidades_medida u
   where c.codigo = 'ACERO_LAC' and u.codigo = 'KG';
insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  select 'ELE-7018', 'Electrodo 7018 de 1/8"', c.id, u.id
    from public.categorias_material c, public.unidades_medida u
   where c.codigo = 'SOLDADURA' and u.codigo = 'KG';

do $$
declare v_mov uuid; v_ot uuid;
begin
  select id into v_ot from public.ordenes_trabajo limit 1;

  insert into public.movimientos_almacen (tipo, almacen_id)
    select 'INGRESO', id from public.almacenes limit 1 returning id into v_mov;
  insert into public.movimiento_detalle (movimiento_id, material_id, cantidad, costo_unitario)
    select v_mov, id, 100, 5.00 from public.materiales where codigo = 'PL-A36-6';
  insert into public.movimiento_detalle (movimiento_id, material_id, cantidad, costo_unitario)
    select v_mov, id, 20, 12.00 from public.materiales where codigo = 'ELE-7018';
  perform public.confirmar_movimiento_almacen(v_mov);

  -- Consumo: 50 kg de plancha (250.00) y 5 kg de electrodo (60.00) = 310.00
  insert into public.movimientos_almacen (tipo, almacen_id, orden_id)
    select 'SALIDA_OT', id, v_ot from public.almacenes limit 1 returning id into v_mov;
  insert into public.movimiento_detalle (movimiento_id, material_id, cantidad)
    select v_mov, id, 50 from public.materiales where codigo = 'PL-A36-6';
  insert into public.movimiento_detalle (movimiento_id, material_id, cantidad)
    select v_mov, id, 5 from public.materiales where codigo = 'ELE-7018';
  perform public.confirmar_movimiento_almacen(v_mov);
end $$;

do $$
begin
  perform test.afirmar(
    (select costo_materiales from public.v_ot_costo_materiales limit 1) = 310.00,
    format('materiales consumidos: %s', (select costo_materiales from public.v_ot_costo_materiales limit 1)));
end $$;

-- --- mano de obra: dos operarios, con horas extra ----------------------------
do $$
declare
  v_parte uuid;
  v_ot    uuid;
  v_etapa uuid;
begin
  select id into v_ot from public.ordenes_trabajo limit 1;
  select e.id into v_etapa
    from public.ot_etapas e join public.etapas_catalogo c on c.id = e.etapa_catalogo_id
   where e.orden_id = v_ot and c.codigo = 'SOLDADURA';

  insert into public.partes_diarios (fecha, sede_id)
    select current_date, id from public.sedes limit 1 returning id into v_parte;

  -- Diego: 8 h normales a 14.00 = 112.00, más 2 h extra a 17.50 = 35.00
  insert into public.parte_detalle (parte_id, orden_id, etapa_id, usuario_id, horas, horas_extra)
    values (v_parte, v_ot, v_etapa, (select id from public.usuarios where correo = 'diego@demo.pe'), 8, 2);
  -- Elsa: 8 h normales a 16.00 = 128.00
  insert into public.parte_detalle (parte_id, orden_id, etapa_id, usuario_id, horas)
    values (v_parte, v_ot, v_etapa, (select id from public.usuarios where correo = 'elsa@demo.pe'), 8);

  perform test.afirmar(
    coalesce((select costo_mano_obra from public.v_ot_costo_mano_obra where orden_id = v_ot), 0) = 0,
    'un parte sin aprobar no cuesta nada todavía');

  update public.partes_diarios set estado = 'CERRADO' where id = v_parte;
  update public.partes_diarios set estado = 'APROBADO' where id = v_parte;

  perform test.afirmar(
    (select costo_mano_obra from public.v_ot_costo_mano_obra where orden_id = v_ot) = 275.00,
    format('mano de obra: 112 + 35 de recargo + 128 = 275, resultó %s',
           (select costo_mano_obra from public.v_ot_costo_mano_obra where orden_id = v_ot)));
  perform test.afirmar(
    (select horas_totales from public.v_ot_costo_mano_obra where orden_id = v_ot) = 18,
    'las horas totales son 18');
end $$;

-- --- servicio de terceros ----------------------------------------------------
-- Un servicio solicitado todavía es compromiso, no costo incurrido.
insert into public.servicios_terceros (orden_id, proveedor_id, descripcion, monto)
  select o.id, p.id, 'Arenado y granallado de la tolva', 300.00
    from public.ordenes_trabajo o cross join public.proveedores p limit 1;

do $$
begin
  perform test.afirmar(
    (select costo_servicios from public.v_ot_costo_servicios limit 1) = 0
      and (select servicios_comprometidos from public.v_ot_costo_servicios limit 1) = 300.00,
    'un servicio solicitado es compromiso, no costo incurrido');
end $$;

-- Al ejecutarse pasa a ser costo real de la orden.
update public.servicios_terceros set estado = 'EJECUTADO';

-- --- el costo total suma sin duplicar ---------------------------------------
do $$
declare c public.v_ot_costo_total;
begin
  select * into c from public.v_ot_costo_total limit 1;

  perform test.afirmar(c.costo_materiales = 310.00, 'componente materiales: ' || c.costo_materiales);
  perform test.afirmar(c.costo_mano_obra = 275.00, 'componente mano de obra: ' || c.costo_mano_obra);
  perform test.afirmar(c.costo_servicios = 300.00, 'componente servicios: ' || c.costo_servicios);
  perform test.afirmar(
    c.costo_total = 885.00,
    format('el costo total es la suma exacta de los componentes: %s', c.costo_total));
  perform test.afirmar(
    (select count(*) from public.v_ot_costo_total) = 1,
    'la vista devuelve una sola fila por orden, sin multiplicar por los joins');
  perform test.afirmar(c.presupuesto = 1000.00, 'toma el presupuesto de la cabecera de la OT');
  perform test.afirmar(c.desviacion = -115.00, format('desviación bajo presupuesto: %s', c.desviacion));
  perform test.afirmar(
    c.consumo_presupuesto_porcentaje = 88.50,
    format('se consumió el 88.5%% del presupuesto: %s', c.consumo_presupuesto_porcentaje));
end $$;

-- --- una OT sin movimientos aparece en cero, no desaparece -------------------
do $$
begin
  insert into public.ordenes_trabajo (cliente_id, sede_id, descripcion)
    select c.id, s.id, 'Orden recién creada sin costos'
      from public.clientes c cross join public.sedes s limit 1;

  perform test.afirmar(
    (select count(*) from public.v_ot_costo_total) = 2,
    'una orden sin movimientos sigue apareciendo en el costeo');
  perform test.afirmar(
    (select costo_total from public.v_ot_costo_total
      where numero = (select numero from public.ordenes_trabajo
                       where descripcion like '%sin costos%')) = 0,
    'y su costo es cero, no nulo');
end $$;

rollback;
