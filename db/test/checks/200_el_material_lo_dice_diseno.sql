-- La lista de materiales de la orden es de Diseño. Este check aprieta lo que
-- puede mentir: que quien no es Diseño no pueda tocar la lista. Un UPDATE que
-- el RLS esconde afecta cero filas SIN error: por eso se cuenta con
-- `get diagnostics` y no se confía en que la sentencia «pasó». (El pase al
-- almacén y el saldo por requerimientos se fueron con el almacén.)
--
-- El armazón —material, orden— se monta con ADMIN, como manda la skill: si se
-- montara con el rol examinado, la prueba se caería por el armazón.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social) values ('20100000019', 'PRUEBAS MATERIAL S.A.C.');
insert into public.sedes (codigo, nombre) values ('T1', 'Taller principal');

select test.crear_usuario('Aldo',  'Quiroz',  'aldo@demo.pe',  'ADMIN',       (select id from public.sedes limit 1)) as admin_id \gset
select test.crear_usuario('Dina',  'Rojas',   'dina@demo.pe',  'DISENO',      (select id from public.sedes limit 1)) as diseno_id \gset
select test.crear_usuario('Rosa',  'Yupanqui','rosa@demo.pe',  'JEFE_TALLER', (select id from public.sedes limit 1)) as jefe_id \gset

insert into public.clientes (tipo_documento, numero_documento, razon_social)
  values ('RUC', '20607761907', 'TRANSPORTES VEGA PIUNDO S.A.C');
insert into public.unidades_medida (codigo, nombre) values ('KG', 'Kilogramo') on conflict do nothing;
insert into public.categorias_material (codigo, nombre) values ('GEN', 'General') on conflict do nothing;
insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  select 'PL-6', 'Plancha LAC 6 mm',
         (select id from public.categorias_material limit 1),
         (select id from public.unidades_medida where codigo = 'KG' limit 1);

insert into public.ordenes_trabajo (cliente_id, sede_id, descripcion)
  select (select id from public.clientes limit 1),
         (select id from public.sedes limit 1),
         'Tolva de prueba para la lista de materiales';

select set_config('prueba.orden',    (select id::text from public.ordenes_trabajo limit 1), false);
select set_config('prueba.material', (select id::text from public.materiales limit 1), false);

-- --------------------------------------------- Diseño escribe qué lleva la OT
select test.como_usuario(:'diseno_id');
set local role authenticated;

do $$
declare v_linea uuid;
begin
  insert into public.ot_materiales (orden_id, material_id, cantidad, observacion)
  values (current_setting('prueba.orden')::uuid,
          current_setting('prueba.material')::uuid,
          500, 'Piso del cajón')
  returning id into v_linea;

  perform set_config('prueba.linea', v_linea::text, false);

  perform test.afirmar(
    (select cantidad_pendiente from public.v_ot_materiales where id = v_linea) = 500,
    'recién escrita, la línea tiene los 500 kg pendientes');
end $$;

reset role;

-- ------------------------------- el mismo material dos veces es un error de dedo
select test.debe_fallar(
  format($sql$insert into public.ot_materiales (orden_id, material_id, cantidad)
              values (%L, %L, 20)$sql$,
         current_setting('prueba.orden'), current_setting('prueba.material')),
  'el mismo material no entra dos veces en la misma orden',
  'uq_ot_material');

-- ------------------------------------- el taller pide, pero no toca la lista
select test.como_usuario(:'jefe_id');
set local role authenticated;

do $$
declare
  v_filas int;
  v_req   uuid;
begin
  -- El jefe de taller no tiene `diseno.planos`. La política lo esconde, así que
  -- esto NO da error: afecta cero filas. Ese es justamente el fallo que hay que
  -- cazar acá y no en la pantalla.
  update public.ot_materiales set cantidad = 999
   where id = current_setting('prueba.linea')::uuid;
  get diagnostics v_filas = row_count;

  perform test.afirmar(v_filas = 0,
    'quien no es Diseño no cambia la lista de materiales');

  perform test.afirmar(
    (select cantidad from public.ot_materiales where id = current_setting('prueba.linea')::uuid) = 500,
    'y la cantidad quedó como la dejó Diseño');

end $$;

reset role;

-- ------------------------------------------- el operario ve la lista, pero no la escribe
select test.crear_usuario('Pedro', 'Silva', 'pedro@demo.pe', 'OPERARIO',
                          (select id from public.sedes limit 1)) as operario_id \gset
select test.como_usuario(:'operario_id');
set local role authenticated;

do $$
declare v_filas int;
begin
  -- Desde la migración 094 el operario ve las órdenes como todos (ordenes.ver);
  -- lo que sigue cerrado es escribir en la hoja de Diseño.
  perform test.afirmar(
    (select count(*) from public.ot_materiales
      where orden_id = current_setting('prueba.orden')::uuid) = 1,
    'el operario ve la lista de materiales de la orden');

  update public.ot_materiales set cantidad = 1
   where id = current_setting('prueba.linea')::uuid;
  get diagnostics v_filas = row_count;
  perform test.afirmar(v_filas = 0, 'pero no la cambia: cero filas, como manda la política');
end $$;

reset role;

rollback;
