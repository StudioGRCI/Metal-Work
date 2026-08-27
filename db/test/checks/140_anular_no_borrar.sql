-- Las cotizaciones no se eliminan: se anulan con motivo, y la anulación sella
-- quién y cuándo sin aceptar lo que mande el cliente. Todo lo que se pueda,
-- emitiendo como usuario real (set local role authenticated): la migración 033
-- existe porque una prueba que corre como superusuario no ve lo que ve la gente.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social) values ('20100000018', 'PRUEBAS ANULACION S.A.C.');
insert into public.sedes (codigo, nombre) values ('T1', 'Taller principal');

select test.crear_usuario('Vera',  'Sandoval', 'vera@demo.pe',  'VENDEDOR', (select id from public.sedes limit 1)) as vendedor_id \gset
select test.crear_usuario('Elsa',  'Miranda',  'elsa@demo.pe',  'VENDEDOR', (select id from public.sedes limit 1)) as colega_id \gset
select test.crear_usuario('Diego', 'Requena',  'diego@demo.pe', 'GERENTE',  (select id from public.sedes limit 1)) as gerente_id \gset

insert into public.clientes (tipo_documento, numero_documento, razon_social)
  values ('RUC', '20607761907', 'TRANSPORTES VEGA PIUNDO S.A.C');

select set_config('prueba.cliente', (select id::text from public.clientes limit 1), false);
select set_config('prueba.sede',    (select id::text from public.sedes limit 1), false);
select set_config('prueba.colega',  :'colega_id', false);

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

  -- Borrar no existe, ni siquiera en borrador: al usuario le falta el permiso.
  perform test.debe_fallar(
    format('delete from public.cotizaciones where id = %L', v_id),
    'al usuario le está revocado el borrado de cotizaciones');

  -- Anular sin motivo no es anular.
  perform test.debe_fallar(
    format('update public.cotizaciones set estado = ''ANULADA'' where id = %L', v_id),
    'no hay anulación sin motivo');

  -- El rastro no se escribe a mano fuera de la anulación.
  update public.cotizaciones set anulada_en = now() where id = v_id;
  perform test.afirmar(
    (select anulada_en is null from public.cotizaciones where id = v_id),
    'el sello de anulación no se maquilla a mano');

  -- Y el número emitido es el correlativo de la empresa, no un campo de texto.
  perform test.debe_fallar(
    format('update public.cotizaciones set numero = ''9999-2026'' where id = %L', v_id),
    'el número de una cotización emitida no se reescribe');
end $$;

reset role;

-- ------------------------------- el sello lo pone la base, no quien lo pide
-- Este caso faltaba y por eso el agujero pasó: mandando anulada_por y
-- anulada_en a mano, cualquiera firmaba la anulación con el nombre de un
-- colega y con la fecha que quisiera, y la fila quedaba congelada con la
-- mentira dentro.
select test.como_usuario(:'vendedor_id');
set local role authenticated;

do $$
declare v_fila public.cotizaciones;
begin
  update public.cotizaciones
     set estado = 'ANULADA',
         motivo_anulacion = 'El cliente desistió antes de enviarla',
         anulada_por = current_setting('prueba.colega')::uuid,
         anulada_en  = timestamptz '2020-01-01 00:00'
   where id = current_setting('prueba.cotizacion')::uuid;

  select * into v_fila from public.cotizaciones
   where id = current_setting('prueba.cotizacion')::uuid;

  perform test.afirmar(v_fila.estado = 'ANULADA', 'la cotización quedó anulada');
  perform test.afirmar(v_fila.anulada_por = public.usuario_actual(),
    'la anulación la firma quien la hizo, no a quien se le quiera achacar');
  perform test.afirmar(v_fila.anulada_en > timestamptz '2020-01-02',
    'la fecha de la anulación es la de verdad, no la que se mande');

  -- Y desde ahí es evidencia: nada se toca.
  perform test.debe_fallar(
    format('update public.cotizaciones set nota = ''retoque'' where id = %L', v_fila.id),
    'una cotización anulada queda congelada');
end $$;

reset role;

-- ------------------------------------- ni el dueño de la base puede borrar
-- Acá sí corre el trigger: como superusuario no hay grant que lo detenga antes.
do $$
begin
  perform test.debe_fallar(
    format('delete from public.cotizaciones where id = %L',
           current_setting('prueba.cotizacion')::uuid),
    'el trigger cierra el borrado también para el administrador de la base');
end $$;

-- ------------------------- Gerencia puede aprobar: el botón no es de adorno
-- Antes no podía. La política de escritura solo aceptaba cotizaciones.editar,
-- que GERENTE no tiene, así que el UPDATE afectaba cero filas, la pantalla
-- decía «Estado actualizado» y la cotización se quedaba donde estaba. Un fallo
-- mudo, el mismo que la numeración: por eso se prueba como usuario real.
do $$
declare v_cot uuid;
begin
  insert into public.cotizaciones (cliente_id, fecha_emision)
  values (current_setting('prueba.cliente')::uuid, current_date)
  returning id into v_cot;

  update public.cotizaciones set estado = 'ENVIADA' where id = v_cot;
  perform set_config('prueba.aprobada', v_cot::text, false);
end $$;

select test.como_usuario(:'gerente_id');
set local role authenticated;

do $$
begin
  update public.cotizaciones
     set estado = 'APROBADA'
   where id = current_setting('prueba.aprobada')::uuid;

  perform test.afirmar(
    (select estado = 'APROBADA' from public.cotizaciones
      where id = current_setting('prueba.aprobada')::uuid),
    'Gerencia aprueba de verdad, no solo en el mensaje de la pantalla');
end $$;

reset role;

-- --------------------------- anular una aprobada no es cosa de quien redacta

select test.como_usuario(:'vendedor_id');
set local role authenticated;

do $$
begin
  perform test.debe_fallar(
    format('update public.cotizaciones set estado = ''ANULADA'',
            motivo_anulacion = ''me equivoqué'' where id = %L',
           current_setting('prueba.aprobada')::uuid),
    'un vendedor no anula lo que el cliente ya aprobó');
end $$;

reset role;

select test.como_usuario(:'gerente_id');
set local role authenticated;

do $$
begin
  update public.cotizaciones
     set estado = 'ANULADA', motivo_anulacion = 'Se emitió por duplicado'
   where id = current_setting('prueba.aprobada')::uuid;

  perform test.afirmar(
    (select estado = 'ANULADA' from public.cotizaciones
      where id = current_setting('prueba.aprobada')::uuid),
    'Gerencia sí puede anular una aprobada');
end $$;

reset role;

-- ------------------------------------- con una orden viva, primero la orden
do $$
declare
  v_cot uuid;
  v_ot  uuid;
begin
  insert into public.cotizaciones (cliente_id, fecha_emision)
  values (current_setting('prueba.cliente')::uuid, current_date)
  returning id into v_cot;

  update public.cotizaciones set estado = 'ENVIADA'  where id = v_cot;
  update public.cotizaciones set estado = 'APROBADA' where id = v_cot;

  insert into public.ordenes_trabajo (cliente_id, sede_id, cotizacion_id, descripcion, tipo_trabajo)
  values (current_setting('prueba.cliente')::uuid,
          current_setting('prueba.sede')::uuid,
          v_cot, 'Orden abierta desde la cotización', 'FABRICACION')
  returning id into v_ot;

  perform test.debe_fallar(
    format('update public.cotizaciones set estado = ''ANULADA'',
            motivo_anulacion = ''se cae la venta'' where id = %L', v_cot),
    'no se anula una cotización con una orden de trabajo en curso');

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
