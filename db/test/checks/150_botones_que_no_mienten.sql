-- Un botón que responde «listo» y no hace nada es peor que uno que falla: el
-- usuario se va convencido. Este check aprieta, como el usuario que le toca,
-- los tres botones de quitar una línea, y comprueba que la fila se fue de
-- verdad -no que la acción devolviera ok-.
--
-- Todos corren con `set local role authenticated`: como superusuario cualquiera
-- de estos borrados «funciona», que es exactamente por qué el fallo vivió tanto.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social) values ('20100000019', 'PRUEBAS BOTONES S.A.C.');
insert into public.sedes (codigo, nombre) values ('T1', 'Taller principal');

select test.crear_usuario('Vera',  'Sandoval', 'vera@demo.pe',  'VENDEDOR',    (select id from public.sedes limit 1)) as vendedor_id \gset
select test.crear_usuario('Jesus', 'Campos',   'jesus@demo.pe', 'ALMACENERO',  (select id from public.sedes limit 1)) as almacenero_id \gset
select test.crear_usuario('Rosa',  'Yupanqui', 'rosa@demo.pe',  'JEFE_TALLER', (select id from public.sedes limit 1)) as jefe_id \gset
select test.crear_usuario('Luis',  'Ochoa',    'luis@demo.pe',  'OPERARIO',    (select id from public.sedes limit 1)) as operario_id \gset
select test.crear_usuario('Ana',   'Bravo',    'ana@demo.pe',   'CALIDAD',     (select id from public.sedes limit 1)) as calidad_id \gset

insert into public.clientes (tipo_documento, numero_documento, razon_social)
  values ('RUC', '20607761907', 'TRANSPORTES VEGA PIUNDO S.A.C');
insert into public.almacenes (codigo, nombre, sede_id)
  select 'A1', 'Almacén central', id from public.sedes limit 1;
insert into public.unidades_medida (codigo, nombre) values ('UND', 'Unidad') on conflict do nothing;
insert into public.categorias_material (codigo, nombre) values ('GEN', 'General') on conflict do nothing;
insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  select 'M1', 'Material de prueba',
         (select id from public.categorias_material limit 1),
         (select id from public.unidades_medida limit 1);

select set_config('prueba.cliente', (select id::text from public.clientes limit 1), false);
select set_config('prueba.sede',    (select id::text from public.sedes limit 1), false);
select set_config('prueba.almacen', (select id::text from public.almacenes limit 1), false);
select set_config('prueba.material', (select id::text from public.materiales limit 1), false);
select set_config('prueba.operario', :'operario_id', false);

-- ------------------- el vendedor quita una partida de la cotización que arma
select test.como_usuario(:'vendedor_id');
set local role authenticated;

do $$
declare
  v_cot     uuid;
  v_partida uuid;
begin
  insert into public.cotizaciones (cliente_id, fecha_emision)
  values (current_setting('prueba.cliente')::uuid, current_date)
  returning id into v_cot;

  insert into public.cotizacion_partidas (cotizacion_id, descripcion, cantidad, precio_unitario)
  values (v_cot, 'Partida que se escribió por error', 1, 100)
  returning id into v_partida;

  delete from public.cotizacion_partidas where id = v_partida;

  perform test.afirmar(
    not exists (select 1 from public.cotizacion_partidas where id = v_partida),
    'el vendedor quita de verdad una partida de su cotización');

  -- Y lo cerrado sigue cerrado: la guarda no se tocó.
  insert into public.cotizacion_partidas (cotizacion_id, descripcion, cantidad, precio_unitario)
  values (v_cot, 'Partida buena', 1, 200)
  returning id into v_partida;

  update public.cotizaciones set estado = 'ENVIADA'  where id = v_cot;
  update public.cotizaciones set estado = 'APROBADA' where id = v_cot;

  perform test.debe_fallar(
    format('delete from public.cotizacion_partidas where id = %L', v_partida),
    'pero de una cotización aprobada no se quita nada');
end $$;

reset role;

-- ------------------ el almacenero quita una línea del movimiento que arma
select test.como_usuario(:'almacenero_id');
set local role authenticated;

do $$
declare
  v_mov   uuid;
  v_linea uuid;
begin
  insert into public.movimientos_almacen (tipo, almacen_id, motivo)
  values ('INGRESO', current_setting('prueba.almacen')::uuid, 'Ingreso en preparación')
  returning id into v_mov;

  insert into public.movimiento_detalle (movimiento_id, material_id, cantidad, costo_unitario)
  values (v_mov, current_setting('prueba.material')::uuid, 5, 20)
  returning id into v_linea;

  delete from public.movimiento_detalle where id = v_linea;

  perform test.afirmar(
    not exists (select 1 from public.movimiento_detalle where id = v_linea),
    'el almacenero quita de verdad una línea del movimiento');
end $$;

reset role;

-- ------------------ el supervisor corrige las horas mal imputadas del parte
do $$
declare v_ot uuid;
begin
  insert into public.ordenes_trabajo (cliente_id, sede_id, descripcion, tipo_trabajo)
  values (current_setting('prueba.cliente')::uuid,
          current_setting('prueba.sede')::uuid,
          'Orden en taller', 'FABRICACION')
  returning id into v_ot;

  update public.ordenes_trabajo set estado = 'APROBADA'   where id = v_ot;
  update public.ordenes_trabajo set estado = 'EN_PROCESO' where id = v_ot;
  perform set_config('prueba.ot', v_ot::text, false);
  perform set_config('prueba.etapa',
    (select id::text from public.ot_etapas where orden_id = v_ot limit 1), false);
end $$;

select test.como_usuario(:'jefe_id');
set local role authenticated;

do $$
declare
  v_parte uuid;
  v_linea uuid;
begin
  insert into public.partes_diarios (sede_id, fecha, responsable_id)
  values (current_setting('prueba.sede')::uuid, current_date, public.usuario_actual())
  returning id into v_parte;

  insert into public.parte_detalle (parte_id, orden_id, etapa_id, usuario_id, horas)
  values (v_parte,
          current_setting('prueba.ot')::uuid,
          current_setting('prueba.etapa')::uuid,
          current_setting('prueba.operario')::uuid, 8)
  returning id into v_linea;

  delete from public.parte_detalle where id = v_linea;

  perform test.afirmar(
    not exists (select 1 from public.parte_detalle where id = v_linea),
    'el supervisor quita de verdad las horas que imputó a la orden equivocada');

  -- Que el parte se haya creado ya es la prueba: antes de este arreglo el
  -- insert moría con «permission denied for function
  -- produccion_siguiente_numero» y el taller no podía cargar su parte del día.
  perform test.afirmar(
    (select numero from public.partes_diarios where id = v_parte) is not null,
    'el supervisor puede cargar el parte diario, y el sistema lo numera');
end $$;

reset role;

-- --------------------------- calidad registra su inspección y queda numerada
select test.como_usuario(:'calidad_id');
set local role authenticated;

do $$
declare v_insp uuid;
begin
  insert into public.ot_inspecciones (orden_id, etapa_id, resultado, inspector_id)
  values (current_setting('prueba.ot')::uuid,
          current_setting('prueba.etapa')::uuid,
          'CONFORME', public.usuario_actual())
  returning id into v_insp;

  perform test.afirmar(
    (select numero from public.ot_inspecciones where id = v_insp) is not null,
    'calidad registra la inspección y el sistema la numera');
end $$;

reset role;

rollback;
