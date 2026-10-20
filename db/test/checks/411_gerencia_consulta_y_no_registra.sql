-- Gerencia consulta y aprueba; registrar es de cada puesto (migración
-- 20261020206000, decisión de StudioGRCI del 2026-10-20: «Quitar, menos
-- anular»). Con la cuenta de Gerencia y `set local role authenticated`: no
-- registra en el kardex, no emite compras, no da de alta materiales ni trabajos
-- sin orden, y sigue anulando OT, viendo el kardex y las compras, y aprobando
-- los trabajos sin orden. Termina en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.sedes (codigo, nombre) values ('QA411', 'Taller prueba 411') on conflict (codigo) do nothing;
select id as sede_id from public.sedes where codigo = 'QA411' \gset
select test.crear_usuario('Gema', 'Gerente', 'gerencia411@demo.pe', 'GERENTE', :'sede_id') as gerente_id \gset
select test.crear_usuario('Alma', 'Almacen', 'almacen411@demo.pe', 'ALMACENERO', :'sede_id') as almacen_id \gset
select id as categoria_id from public.categorias_material order by 1 limit 1 \gset
select id as unidad_id from public.unidades_medida order by 1 limit 1 \gset
select set_config('prueba.categoria', :'categoria_id', true);
select set_config('prueba.unidad', :'unidad_id', true);

set local role authenticated;
select test.como_usuario(:'gerente_id');

do $$
begin
  perform test.afirmar(not public.tiene_permiso('almacen.recibir'), 'Gerencia ya no registra ingresos al almacén');
  perform test.afirmar(not public.tiene_permiso('almacen.despachar'), 'Gerencia ya no registra salidas del almacén');
  perform test.afirmar(not public.tiene_permiso('compras.crear'), 'Gerencia ya no emite compras');
  perform test.afirmar(not public.tiene_permiso('diseno.planos'), 'Gerencia ya no carga planos ni materiales');
  perform test.afirmar(not public.tiene_permiso('produccion.actividades'), 'Gerencia ya no registra trabajos ni actividades');

  perform test.afirmar(public.tiene_permiso('ordenes.anular'), 'Gerencia sigue anulando una OT');
  perform test.afirmar(public.tiene_permiso('produccion.aprobar_sin_orden'), 'Gerencia sigue aprobando los trabajos sin orden');
  perform test.afirmar(public.tiene_permiso('almacen.ver') and public.tiene_permiso('compras.ver'),
    'Gerencia sigue consultando el kardex y las compras');
end $$;

select test.debe_fallar(
  $$select public.unidades_para_salida_almacen()$$,
  'Gerencia no abre la salida del almacén', 'almacen.despachar');
select test.debe_fallar(
  $$select public.registrar_ingreso_material_libre(gen_random_uuid(), null, 'Plancha 411', current_setting('prueba.unidad')::uuid,
      1, 'COMPRA', 'F001-411', 10, 'PEN')$$,
  'Gerencia no registra un ingreso al almacén', 'almacen.recibir');
select test.debe_fallar(
  $$select public.emitir_compra_directa(gen_random_uuid(), null, 'QA411', 'prueba', '[]'::jsonb, current_date,
      'CONTADO', 0, 'PEN', false, null)$$,
  'Gerencia no emite una OC directa', 'compras.crear');
select test.debe_fallar(
  $$select * from public.compras_en_gestion()$$,
  'Gerencia no entra a la gestión de recojos de Logística', 'gestión de compras');
select test.debe_fallar(
  format($$insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
           values ('QA411', 'Material 411', %L, %L)$$,
         current_setting('prueba.categoria'), current_setting('prueba.unidad')),
  'Gerencia no da de alta un material del catálogo', 'row-level security');
select test.debe_fallar(
  $$insert into public.flota_unidades (trabajo, descripcion) values ('Trabajo 411', 'Sin orden')$$,
  'Gerencia no registra un trabajo sin orden', 'row-level security');

-- Lo que consulta sigue saliendo: el kardex y las compras, igual que para el almacén.
reset role;
select count(*) as kardex_total from public.movimientos_materiales \gset
select count(*) as compras_total from public.ordenes_compra_materiales \gset
select set_config('prueba.kardex', :'kardex_total', true);
select set_config('prueba.compras', :'compras_total', true);
set local role authenticated;
select test.como_usuario(:'gerente_id');
do $$
begin
  perform test.afirmar((select count(*) from public.movimientos_materiales) = current_setting('prueba.kardex')::bigint,
    'Gerencia ve todo el kardex');
  perform test.afirmar((select count(*) from public.ordenes_compra_materiales) = current_setting('prueba.compras')::bigint,
    'Gerencia ve todas las órdenes de compra');
end $$;

-- El almacén, en cambio, sigue registrando: el permiso se le quitó a Gerencia, no al puesto.
select test.como_usuario(:'almacen_id');
do $$
begin
  perform test.afirmar(public.tiene_permiso('almacen.recibir') and public.tiene_permiso('almacen.despachar'),
    'El almacén sigue registrando ingresos y salidas');
  perform public.unidades_para_salida_almacen();
end $$;

reset role;
rollback;
