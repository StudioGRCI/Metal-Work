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

rollback;
