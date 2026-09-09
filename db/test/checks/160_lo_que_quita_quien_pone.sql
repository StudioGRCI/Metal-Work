-- Segunda tanda de botones que respondían «listo» sin hacer nada. Igual que el
-- check 150: se aprieta cada uno con el usuario a quien le toca apretarlo, y se
-- comprueba que la fila cambió de verdad, no que la acción devolviera ok.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social) values ('20100000020', 'PRUEBAS FICHA S.A.C.');
insert into public.sedes (codigo, nombre) values ('T1', 'Taller principal');

select test.crear_usuario('Rosa',  'Yupanqui', 'rosa@demo.pe',  'JEFE_TALLER', (select id from public.sedes limit 1)) as jefe_id \gset
select test.crear_usuario('Ciro',  'Palacios', 'ciro@demo.pe',  'SUPERVISOR',  (select id from public.sedes limit 1)) as supervisor_id \gset

insert into public.clientes (tipo_documento, numero_documento, razon_social)
  values ('RUC', '20607761907', 'TRANSPORTES VEGA PIUNDO S.A.C');
insert into public.ordenes_trabajo (cliente_id, sede_id, descripcion, tipo_trabajo)
  select (select id from public.clientes limit 1), (select id from public.sedes limit 1),
         'Tolva de 15 m3', 'FABRICACION';

select set_config('prueba.sede',   (select id::text from public.sedes limit 1), false);
select set_config('prueba.orden',  (select id::text from public.ordenes_trabajo limit 1), false);
select set_config('prueba.jefe',   :'jefe_id', false);

-- ------------------- el supervisor quita un accesorio que no corresponde
-- Ponerlo lo podía; quitarlo no, y el «Quitar» no decía nada. Quien pone quita.
select test.como_usuario(:'supervisor_id');
set local role authenticated;

do $$
declare v_acc uuid;
begin
  insert into public.ot_accesorios (orden_id, orden, cantidad, unidad, descripcion)
  values (current_setting('prueba.orden')::uuid, 1, 1, 'unid', 'Porta conos que no lleva esta tolva')
  returning id into v_acc;

  delete from public.ot_accesorios where id = v_acc;

  perform test.afirmar(
    not exists (select 1 from public.ot_accesorios where id = v_acc),
    'el supervisor quita de verdad el accesorio que él mismo puso');
end $$;

do $$
declare v_rep uuid;
begin
  insert into public.ot_repuestos (orden_id, orden, cantidad, descripcion, marca)
  values (current_setting('prueba.orden')::uuid, 1, 2, 'Amortiguador que finalmente no se montó', 'MONROE')
  returning id into v_rep;

  delete from public.ot_repuestos where id = v_rep;

  perform test.afirmar(
    not exists (select 1 from public.ot_repuestos where id = v_rep),
    'y también el repuesto que no se llegó a montar');
end $$;

reset role;

rollback;
