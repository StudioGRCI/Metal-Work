-- La cotización que sale al cliente dice qué se le va a fabricar y cuánto
-- cuesta; el desglose por partida se queda adentro. Acá se comprueba que el
-- concepto se puede escribir, que no admite disparates, y que corregir una
-- partida vuelve a cuadrar los totales.
--
-- Se mira con los ojos del vendedor y con los del almacenero: ADMIN entra por
-- es_admin() y nunca toca el permiso, así que probando solo con él estas
-- puertas parecerían abiertas para todo el mundo.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social) values ('20100000031', 'PRUEBAS CONCEPTO S.A.C.');
insert into public.sedes (codigo, nombre) values ('T1', 'Taller principal');

select test.crear_usuario('Vera',  'Sandoval', 'vera@demo.pe',  'VENDEDOR',   (select id from public.sedes limit 1)) as vendedor_id \gset
select test.crear_usuario('Jesus', 'Campos',   'jesus@demo.pe', 'ALMACENERO', (select id from public.sedes limit 1)) as almacenero_id \gset

insert into public.clientes (tipo_documento, numero_documento, razon_social)
  values ('RUC', '20607761907', 'TRANSPORTES VEGA PIUNDO S.A.C');

-- ------------------------------------------- el vendedor arma su cotización
select test.como_usuario(:'vendedor_id');
set local role authenticated;

insert into public.cotizaciones (cliente_id, sede_id, moneda)
  select c.id, s.id, 'PEN'
    from public.clientes c, public.sedes s
   where c.numero_documento = '20607761907'
   limit 1;

select set_config('prueba.cotizacion',
  (select id::text from public.cotizaciones order by creado_en desc limit 1), false);

insert into public.cotizacion_partidas
  (cotizacion_id, orden_secuencia, descripcion, unidad_medida, cantidad, precio_unitario)
values
  (current_setting('prueba.cotizacion')::uuid, 1, 'Estructura y tolva en acero A36', 'GLB', 1, 78000),
  (current_setting('prueba.cotizacion')::uuid, 2, 'Sistema hidráulico y tiro',        'GLB', 1, 30000);

do $$
declare
  v_id    uuid := current_setting('prueba.cotizacion')::uuid;
  v_total numeric;
begin
  -- ------------------------------------------------ el concepto se escribe
  update public.cotizaciones
     set concepto = 'Fabricación de tolva volquete de 23 m³, 03 ejes, con tiro y suspensión mecánica',
         concepto_cantidad = 1,
         concepto_unidad = 'UND'
   where id = v_id;

  perform test.afirmar(
    (select concepto from public.cotizaciones where id = v_id) like 'Fabricación de tolva%',
    'el vendedor escribe el concepto que va impreso en la cotización');

  -- Un concepto en blanco no es un concepto: o dice algo o queda vacío y el
  -- documento cae a la carrocería.
  perform test.debe_fallar(
    format('update public.cotizaciones set concepto = %L where id = %L', '   ', v_id),
    'un concepto de puros espacios no entra');

  perform test.debe_fallar(
    format('update public.cotizaciones set concepto_cantidad = 0 where id = %L', v_id),
    'ni una cantidad de cero: algo se está cotizando');

  -- ------------------------------------- corregir una partida vuelve a cuadrar
  select total into v_total from public.cotizaciones where id = v_id;
  perform test.afirmar(
    v_total > 0,
    format('los totales salen de las partidas (total %s)', v_total));

  update public.cotizacion_partidas
     set precio_unitario = 90000
   where cotizacion_id = v_id and orden_secuencia = 1;

  perform test.afirmar(
    (select subtotal from public.cotizacion_partidas
      where cotizacion_id = v_id and orden_secuencia = 1) = 90000,
    'al corregir el precio de una partida, la base recalcula su subtotal');

  perform test.afirmar(
    (select total from public.cotizaciones where id = v_id) > v_total,
    'y el total de la cotización sube con ella, sin que la aplicación lo mande');
end $$;

reset role;

-- ------------------- el almacenero no escribe el precio de nadie
-- No tiene cotizaciones.editar. El UPDATE no revienta: el RLS esconde la fila y
-- afecta cero. Por eso se comprueba el resultado, no la excepción.
select test.como_usuario(:'almacenero_id');
set local role authenticated;

do $$
declare
  v_id uuid := current_setting('prueba.cotizacion')::uuid;
begin
  update public.cotizaciones set concepto = 'Lo que se le ocurrió al almacén' where id = v_id;
end $$;

reset role;

select test.como_usuario(:'vendedor_id');
set local role authenticated;

do $$
begin
  perform test.afirmar(
    (select concepto from public.cotizaciones
      where id = current_setting('prueba.cotizacion')::uuid) like 'Fabricación de tolva%',
    'el almacenero no le cambia el concepto a una cotización');
end $$;

reset role;

rollback;
