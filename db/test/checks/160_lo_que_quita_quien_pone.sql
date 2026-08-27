-- Segunda tanda de botones que respondían «listo» sin hacer nada. Igual que el
-- check 150: se aprieta cada uno con el usuario a quien le toca apretarlo, y se
-- comprueba que la fila cambió de verdad, no que la acción devolviera ok.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social) values ('20100000020', 'PRUEBAS FICHA S.A.C.');
insert into public.sedes (codigo, nombre) values ('T1', 'Taller principal');

select test.crear_usuario('Rosa',  'Yupanqui', 'rosa@demo.pe',  'JEFE_TALLER', (select id from public.sedes limit 1)) as jefe_id \gset
select test.crear_usuario('Ciro',  'Palacios', 'ciro@demo.pe',  'SUPERVISOR',  (select id from public.sedes limit 1)) as supervisor_id \gset
select test.crear_usuario('Ana',   'Bravo',    'ana@demo.pe',   'CALIDAD',     (select id from public.sedes limit 1)) as calidad_id \gset
select test.crear_usuario('Jesus', 'Campos',   'jesus@demo.pe', 'ALMACENERO',  (select id from public.sedes limit 1)) as almacenero_id \gset

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

-- ------------------- calidad marca el visto bueno, pero no arma la ficha
select test.como_usuario(:'jefe_id');
set local role authenticated;

do $$
declare v_acc uuid;
begin
  insert into public.ot_accesorios (orden_id, orden, cantidad, unidad, descripcion)
  values (current_setting('prueba.orden')::uuid, 2, 1, 'unid', 'Parachoque posterior')
  returning id into v_acc;
  perform set_config('prueba.accesorio', v_acc::text, false);
end $$;

reset role;

select test.como_usuario(:'calidad_id');
set local role authenticated;

do $$
begin
  -- Como lo hace la pantalla: el visto bueno lleva quién y cuándo.
  update public.ot_accesorios
     set verificado = true,
         verificado_por = public.usuario_actual(),
         verificado_en = now()
   where id = current_setting('prueba.accesorio')::uuid;

  perform test.afirmar(
    (select verificado from public.ot_accesorios
      where id = current_setting('prueba.accesorio')::uuid),
    'calidad pone el visto bueno sobre lo que el taller montó');

  -- Pero armar la ficha no es su trabajo, y la base lo dice igual que la
  -- pantalla: sin cero filas silenciosas.
  delete from public.ot_accesorios where id = current_setting('prueba.accesorio')::uuid;
  perform test.afirmar(
    exists (select 1 from public.ot_accesorios
             where id = current_setting('prueba.accesorio')::uuid),
    'calidad no quita líneas de la ficha: las arma el taller');
end $$;

reset role;

-- ------------------------ el almacenero rechaza lo que no puede atender
-- Es su trabajo -tiene requerimientos.aprobar- pero la política solo aceptaba
-- el permiso de quien pide, así que el rechazo se perdía en silencio y el
-- requerimiento seguía esperando a alguien que ya lo había visto.
select test.como_usuario(:'jefe_id');
set local role authenticated;

do $$
declare v_req uuid;
begin
  insert into public.requerimientos (sede_id, solicitante_id, fecha_requerida)
  values (current_setting('prueba.sede')::uuid, public.usuario_actual(), current_date + 3)
  returning id into v_req;
  perform set_config('prueba.requerimiento', v_req::text, false);
end $$;

reset role;

select test.como_usuario(:'almacenero_id');
set local role authenticated;

do $$
begin
  update public.requerimientos
     set estado = 'RECHAZADO',
         motivo_rechazo = 'No hay stock ni proveedor que lo traiga a tiempo'
   where id = current_setting('prueba.requerimiento')::uuid;

  perform test.afirmar(
    (select estado = 'RECHAZADO' from public.requerimientos
      where id = current_setting('prueba.requerimiento')::uuid),
    'el almacenero rechaza de verdad el requerimiento que no puede atender');
end $$;

reset role;

-- ---------------- la ficha de documento que quedó sin archivo se retira
-- La limpieza exigía documentos.eliminar, que no lo tiene ningún rol, así que
-- nunca ocurría: quedaba un documento sin archivo bloqueando el cierre.
select test.como_usuario(:'jefe_id');
set local role authenticated;

do $$
declare
  v_doc  uuid;
  v_tipo uuid;
begin
  select id into v_tipo from public.tipos_documento limit 1;

  insert into public.documentos (tipo_documento_id, titulo, entidad_tabla, entidad_id, orden_id)
  values (v_tipo, 'Plano que no llegó a subir', 'ordenes_trabajo',
          current_setting('prueba.orden')::uuid, current_setting('prueba.orden')::uuid)
  returning id into v_doc;

  -- Sin ninguna versión dentro: es una ficha vacía, no un documento.
  delete from public.documentos where id = v_doc;

  perform test.afirmar(
    not exists (select 1 from public.documentos where id = v_doc),
    'quien creó la ficha vacía la puede retirar');
end $$;

reset role;

rollback;
