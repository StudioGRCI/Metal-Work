-- Elegir la carrocería trae la ficha puesta, sin pisar lo escrito a mano; y la
-- sembradora deja cada plantilla igual a lo que se le pasa.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social) values ('20100000015', 'PRUEBAS FICHA PUESTA S.A.C.');
insert into public.sedes (codigo, nombre) values ('T1', 'Taller principal');

select test.crear_usuario('Ana', 'Torres', 'ana@demo.pe', 'ADMIN', (select id from public.sedes limit 1)) as admin_id \gset

insert into public.clientes (tipo_documento, numero_documento, razon_social)
  values ('RUC', '20526331762', 'MENBER INGENIERIA S.A.C.');

select test.como_usuario(:'admin_id');

-- ------------------------------------------------- la ficha baja sola
do $$
declare
  v_cot    uuid;
  v_pla    uuid;
  v_vpc    uuid;
  v_lineas int;
  v_acc    int;
begin
  select id into v_pla from public.tipos_carroceria where codigo = 'PLA';
  select id into v_vpc from public.tipos_carroceria where codigo = 'VPC';

  -- La plataforma dejó el tipo dado de baja y vive en PLA, que sí se elige.
  perform test.afirmar(
    exists (select 1 from public.plantillas_ficha where tipo_carroceria_id = v_pla and activa),
    'la ficha de la plataforma cuelga de la carrocería viva (PLA)');

  insert into public.cotizaciones (cliente_id, sede_id, tipo_carroceria_id, fecha_emision)
  values ((select id from public.clientes limit 1), (select id from public.sedes limit 1), v_pla, current_date)
  returning id into v_cot;

  select count(*) into v_lineas from public.cotizacion_especificaciones where cotizacion_id = v_cot;
  select count(*) into v_acc    from public.cotizacion_accesorios        where cotizacion_id = v_cot;
  perform test.afirmar(v_lineas >= 40 and v_acc >= 12,
    format('al elegir la plataforma la cotización nace con su ficha (%s líneas, %s accesorios)', v_lineas, v_acc));
  raise notice '  ok · elegir la carrocería trae la ficha puesta: % líneas y % accesorios', v_lineas, v_acc;

  -- Cambiar de carrocería no pisa lo que ya está escrito.
  update public.cotizaciones set tipo_carroceria_id = v_vpc where id = v_cot;
  perform test.afirmar(
    (select count(*) from public.cotizacion_especificaciones where cotizacion_id = v_cot) = v_lineas,
    'cambiar de carrocería con ficha escrita no la pisa');
  raise notice '  ok · la ficha escrita no se pisa al cambiar de carrocería';

  -- Sin carrocería no baja nada; al elegirla después, sí.
  insert into public.cotizaciones (cliente_id, sede_id, fecha_emision)
  values ((select id from public.clientes limit 1), (select id from public.sedes limit 1), current_date)
  returning id into v_cot;
  perform test.afirmar(
    (select count(*) from public.cotizacion_especificaciones where cotizacion_id = v_cot) = 0,
    'sin carrocería no hay ficha que bajar');
  update public.cotizaciones
     set tipo_carroceria_id = (select id from public.tipos_carroceria where codigo = 'TOLVA_VOLQUETE')
   where id = v_cot;
  perform test.afirmar(
    (select count(*) from public.cotizacion_especificaciones where cotizacion_id = v_cot) >= 25,
    'al elegir la tolva después, baja su ficha');
  raise notice '  ok · la ficha baja cuando se elige la carrocería, antes o después';
end $$;

-- ------------------------------------------------- la sembradora
do $$
declare
  v_vpc uuid;
  v_p   uuid;
  v_cot uuid;
begin
  select id into v_vpc from public.tipos_carroceria where codigo = 'VPC';

  v_p := public.sembrar_plantilla_ficha('VPC', 'Piso circular 18 m³ (prueba)', 'prueba',
    '[{"seccion":"A","detalle":"a1"},{"seccion":"A","detalle":"a2"},{"seccion":"B","etiqueta":"Piso","detalle":"b1"}]'::jsonb,
    '[{"cantidad":"3","descripcion":"Winches"},{"cantidad":1,"descripcion":"Porta conos","incluye":false}]'::jsonb,
    'CARROCERIA_MONTADA', '18 m³', array['OT 2896'], true);
  perform public.sembrar_plantilla_ficha('VPC', 'Piso circular 24 m³ (prueba)', 'prueba',
    '[{"seccion":"A","detalle":"a"}]'::jsonb, '[]'::jsonb, 'SEMIRREMOLQUE', '24 m³', array['OT 2864'], false);

  -- Numera sección y línea por el orden del JSON.
  perform test.afirmar(
    (select string_agg(orden_seccion || '.' || orden_linea || coalesce(' ' || etiqueta, ''), ',' order by orden_seccion, orden_linea)
       from public.plantilla_ficha_lineas where plantilla_id = v_p) = '1.1,1.2,2.1 Piso',
    'la sembradora numera secciones y líneas en el orden en que llegan');
  perform test.afirmar(
    exists (select 1 from public.plantilla_ficha_accesorios where plantilla_id = v_p and descripcion = 'Porta conos' and not incluye_el_accesorio),
    'el «no incluye accesorio» llega como dato');
  raise notice '  ok · la sembradora respeta el orden y el «sin el accesorio»';

  -- Volver a sembrar reemplaza, no duplica; y la predeterminada es una sola.
  perform public.sembrar_plantilla_ficha('VPC', 'Piso circular 18 m³ (prueba)', 'otra vez',
    '[{"seccion":"A","detalle":"a"}]'::jsonb, '[]'::jsonb, null, null, '{}', true);
  perform test.afirmar(
    (select count(*) from public.plantilla_ficha_lineas where plantilla_id = v_p) = 1,
    'resembrar deja la plantilla igual a lo que se le pasa');
  perform test.afirmar(
    (select count(*) from public.plantillas_ficha where tipo_carroceria_id = v_vpc and predeterminada) = 1,
    'hay una sola predeterminada por carrocería');
  raise notice '  ok · resembrar no duplica y la predeterminada es una sola';

  -- La predeterminada es la que baja a la cotización.
  insert into public.cotizaciones (cliente_id, sede_id, tipo_carroceria_id, fecha_emision)
  values ((select id from public.clientes limit 1), (select id from public.sedes limit 1), v_vpc, current_date)
  returning id into v_cot;
  perform test.afirmar(
    (select count(*) from public.cotizacion_especificaciones where cotizacion_id = v_cot) = 1,
    'baja la predeterminada, con su única línea');
  raise notice '  ok · la predeterminada es la que baja';
end $$;

rollback;
