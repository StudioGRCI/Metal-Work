-- Las cotizaciones no se eliminan: se anulan con motivo, y la anulación sella
-- quién y cuándo. Este check emite como usuario real (set role authenticated)
-- porque el borrado y la anulación tienen que fallar o pasar con los permisos
-- de verdad, no con los del superusuario.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social) values ('20100000018', 'PRUEBAS ANULACION S.A.C.');
insert into public.sedes (codigo, nombre) values ('T1', 'Taller principal');

select test.crear_usuario('Vera', 'Sandoval', 'vera@demo.pe', 'VENDEDOR', (select id from public.sedes limit 1)) as vendedor_id \gset

insert into public.clientes (tipo_documento, numero_documento, razon_social)
  values ('RUC', '20607761907', 'TRANSPORTES VEGA PIUNDO S.A.C');

select set_config('prueba.cliente', (select id::text from public.clientes limit 1), false);

-- ------------------------------------- el vendedor emite y luego quiere borrar
select test.como_usuario(:'vendedor_id');
set local role authenticated;

do $$
declare v_id uuid;
begin
  insert into public.cotizaciones (cliente_id, fecha_emision)
  values (current_setting('prueba.cliente')::uuid, current_date)
  returning id into v_id;

  perform set_config('prueba.cotizacion', v_id::text, false);

  -- Borrar no existe, ni siquiera en borrador.
  perform test.debe_fallar(
    format('delete from public.cotizaciones where id = %L', v_id),
    'una cotización en borrador tampoco se borra');

  -- Anular sin motivo no es anular.
  perform test.debe_fallar(
    format('update public.cotizaciones set estado = ''ANULADA'' where id = %L', v_id),
    'no hay anulación sin motivo');

  -- El rastro no se escribe a mano fuera de la anulación.
  update public.cotizaciones set anulada_en = now() where id = v_id;
  perform test.afirmar(
    (select anulada_en is null from public.cotizaciones where id = v_id),
    'el sello de anulación no se maquilla a mano');
end $$;

reset role;

-- ------------------------------------- la anulación de verdad, con su rastro
select test.como_usuario(:'vendedor_id');
set local role authenticated;

do $$
declare v_fila public.cotizaciones;
begin
  update public.cotizaciones
     set estado = 'ANULADA',
         motivo_anulacion = 'El cliente desistió antes de enviarla'
   where id = current_setting('prueba.cotizacion')::uuid;

  select * into v_fila from public.cotizaciones
   where id = current_setting('prueba.cotizacion')::uuid;

  perform test.afirmar(v_fila.estado = 'ANULADA', 'la cotización quedó anulada');
  perform test.afirmar(v_fila.anulada_por = public.usuario_actual(),
    'la anulación sella quién la decidió');
  perform test.afirmar(v_fila.anulada_en is not null,
    'la anulación sella cuándo se decidió');

  -- Y desde ahí es evidencia: nada se toca.
  perform test.debe_fallar(
    format('update public.cotizaciones set nota = ''retoque'' where id = %L', v_fila.id),
    'una cotización anulada queda congelada');
  perform test.debe_fallar(
    format('delete from public.cotizaciones where id = %L', v_fila.id),
    'una cotización anulada tampoco se borra');
end $$;

reset role;

-- ------------------------------------- ni el dueño de la base puede borrar
do $$
begin
  perform test.debe_fallar(
    format('delete from public.cotizaciones where id = %L',
           current_setting('prueba.cotizacion')::uuid),
    'el borrado está cerrado también para el administrador de la base');
end $$;

-- ------------------------------------- con una orden viva, primero la orden
do $$
declare
  v_cot uuid;
  v_ot  uuid;
begin
  insert into public.cotizaciones (cliente_id, fecha_emision, estado)
  values (current_setting('prueba.cliente')::uuid, current_date, 'BORRADOR')
  returning id into v_cot;

  update public.cotizaciones set estado = 'ENVIADA'  where id = v_cot;
  update public.cotizaciones set estado = 'APROBADA' where id = v_cot;

  insert into public.ordenes_trabajo (cliente_id, sede_id, cotizacion_id, descripcion, tipo_trabajo)
  values (current_setting('prueba.cliente')::uuid,
          (select id from public.sedes limit 1),
          v_cot, 'Orden abierta desde la cotización', 'FABRICACION')
  returning id into v_ot;

  perform test.debe_fallar(
    format('update public.cotizaciones set estado = ''ANULADA'',
            motivo_anulacion = ''se cae la venta'' where id = %L', v_cot),
    'no se anula una cotización con una orden de trabajo viva');

  -- Anulada la orden, la cotización sí puede anularse.
  update public.ordenes_trabajo
     set estado = 'ANULADA', motivo_anulacion = 'Prueba: se cayó la venta'
   where id = v_ot;
  update public.cotizaciones
     set estado = 'ANULADA', motivo_anulacion = 'Se cayó la venta'
   where id = v_cot;

  perform test.afirmar(
    (select estado = 'ANULADA' from public.cotizaciones where id = v_cot),
    'con la orden anulada, la cotización se anula');
end $$;

-- ------------------------------------- el membrete responde a cualquier activo
select test.como_usuario(:'vendedor_id');
set local role authenticated;

do $$
declare v_ruc text;
begin
  select d.ruc into v_ruc from public.datos_de_empresa() d;
  perform test.afirmar(v_ruc = '20100000018',
    'el membrete de la empresa responde aunque el vendedor no tenga configuracion.ver');
end $$;

reset role;

rollback;
