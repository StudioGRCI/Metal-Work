-- Un botón que responde «listo» y no hace nada es peor que uno que falla: el
-- usuario se va convencido. Este check aprieta, como el usuario que le toca,
-- el botón de quitar una partida, y comprueba que la fila se fue de verdad
-- -no que la acción devolviera ok-. (Los de almacén, partes e inspecciones se
-- fueron con sus módulos.)
--
-- Todos corren con `set local role authenticated`: como superusuario cualquiera
-- de estos borrados «funciona», que es exactamente por qué el fallo vivió tanto.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social) values ('20100000019', 'PRUEBAS BOTONES S.A.C.');
insert into public.sedes (codigo, nombre) values ('T1', 'Taller principal');

select test.crear_usuario('Vera',  'Sandoval', 'vera@demo.pe',  'VENDEDOR',    (select id from public.sedes limit 1)) as vendedor_id \gset
select test.crear_usuario('Ana', 'Prueba', 'admin-botones@demo.pe', 'ADMIN', (select id from public.sedes limit 1)) as admin_id \gset

insert into public.clientes (tipo_documento, numero_documento, razon_social)
  values ('RUC', '20607761907', 'TRANSPORTES VEGA PIUNDO S.A.C');

select set_config('prueba.cliente', (select id::text from public.clientes limit 1), false);

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
  perform set_config('prueba.cotizacion', v_cot::text, false);
end $$;

reset role;

-- Gerencia arma y aprueba con la ficha completa; después se prueba de nuevo
-- como Ventas, que no puede alterar el detalle ya aprobado.
select test.como_usuario(:'admin_id');
set local role authenticated;
do $$
declare v_cot uuid := current_setting('prueba.cotizacion')::uuid; v_partida uuid;
begin
  update public.cotizaciones set tipo_carroceria_id =
    (select id from public.tipos_carroceria where codigo='TOLVA_VOLQUETE') where id=v_cot;
  perform public.aplicar_plantilla_ficha(v_cot,
    (select p.id from public.plantillas_ficha p
      join public.tipos_carroceria t on t.id=p.tipo_carroceria_id
     where t.codigo='TOLVA_VOLQUETE' and p.activa limit 1));
  insert into public.cotizacion_partidas (cotizacion_id, descripcion, cantidad, precio_unitario)
  values (v_cot, 'Partida buena', 1, 200) returning id into v_partida;
  update public.cotizaciones set estado='EN_COSTEO' where id=v_cot;
  update public.cotizaciones set estado='EN_REVISION' where id=v_cot;
  update public.cotizaciones set estado='REVISADA' where id=v_cot;
  update public.cotizaciones set estado='ENVIADA' where id=v_cot;
  update public.cotizaciones set estado='APROBADA' where id=v_cot;
  perform set_config('prueba.partida', v_partida::text, false);
end $$;
reset role;

select test.como_usuario(:'vendedor_id');
set local role authenticated;
select test.debe_fallar(
  format('delete from public.cotizacion_partidas where id = %L', current_setting('prueba.partida')),
  'de una cotización aprobada no se quita nada');
reset role;

rollback;
