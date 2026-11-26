-- El código de la carrocería no cambia al editarla (migración 20261125300000).
-- Ventas corrige el nombre, la descripción y si está activa por
-- `editar_carroceria_ventas`; el código es el de la empresa (VPC, CIA, FRG…) y
-- antes se volvía a armar del nombre en cada guardado. Con la cuenta de Ventas
-- y `set local role authenticated`, nunca ADMIN. Termina en rollback.
\set ON_ERROR_STOP on
begin;

do $$
declare v_ventas uuid; v_carroceria uuid := gen_random_uuid();
begin
  v_ventas := test.crear_usuario('Ventas', 'Check 458', 'ventas.458@prueba.local', 'VENDEDOR');
  insert into public.tipos_carroceria (id, codigo, nombre, orden_secuencia, activo)
  values (v_carroceria, 'C58', 'Tolva volquete · piso del check', 99, true);
  perform set_config('prueba.ventas', v_ventas::text, true);
  perform set_config('prueba.carroceria', v_carroceria::text, true);
end $$;

-- 1. Ventas cambia el nombre y la descripción: el código se queda.
select set_config('request.jwt.claim.sub', current_setting('prueba.ventas'), true),
       set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.ventas'), 'role', 'authenticated')::text, true);
set local role authenticated;
select test.afirmar(
  public.editar_carroceria_ventas(current_setting('prueba.carroceria')::uuid, '  Tolva para minería del check  ', 'Con piso reforzado', true)
    = current_setting('prueba.carroceria')::uuid,
  'Ventas guarda la carrocería con otro nombre'
);
reset role;
select test.afirmar(
  (select codigo = 'C58' and nombre = 'Tolva para minería del check' and descripcion = 'Con piso reforzado' and activo
     from public.tipos_carroceria where id = current_setting('prueba.carroceria')::uuid),
  'El código sigue siendo C58: no se armó TOLVA_PARA_MINERIA_DEL_CHECK con el nombre'
);

-- 2. Desactivar y reactivar desde el catálogo pasa por la misma función: tampoco lo cambia.
set local role authenticated;
select public.editar_carroceria_ventas(current_setting('prueba.carroceria')::uuid, 'Tolva para minería del check', 'Con piso reforzado', false);
reset role;
select test.afirmar(
  (select codigo = 'C58' and not activo from public.tipos_carroceria where id = current_setting('prueba.carroceria')::uuid),
  'Desactivada por Ventas, conserva su código'
);

-- 3. Un nombre que ya usa otra carrocería no choca: el código no se arma del nombre.
insert into public.tipos_carroceria (codigo, nombre, orden_secuencia, activo)
values ('TOLVA_DEL_CHECK_458', 'Otra tolva', 99, true);
set local role authenticated;
select test.afirmar(
  public.editar_carroceria_ventas(current_setting('prueba.carroceria')::uuid, 'Tolva del check 458', null, true)
    = current_setting('prueba.carroceria')::uuid,
  'Un nombre cuyo código armado ya existe se guarda igual (antes: «Ya existe una carrocería con un nombre parecido»)'
);

-- 4. El nombre corto se rechaza en castellano, y sin nombre también.
select test.debe_fallar(
  format('select public.editar_carroceria_ventas(%L::uuid, %L, null, true)', current_setting('prueba.carroceria'), ' ab '),
  'Un nombre de dos letras no entra',
  'El nombre de la carrocería debe tener entre 3 y 120 caracteres'
);
select test.debe_fallar(
  format('select public.editar_carroceria_ventas(%L::uuid, null, null, true)', current_setting('prueba.carroceria')),
  'Sin nombre no entra',
  'El nombre de la carrocería debe tener entre 3 y 120 caracteres'
);
select test.debe_fallar(
  format('select public.editar_carroceria_ventas(%L::uuid, %L, null, true)', current_setting('prueba.carroceria'), ' — · — '),
  'Un nombre sin letras ni números no entra',
  'El nombre debe incluir letras o números'
);
reset role;

-- 4b. Quien no cotiza no la edita: Almacén no tiene cotizaciones.crear.
do $$
declare v_almacen uuid;
begin
  v_almacen := test.crear_usuario('Almacén', 'Check 458', 'almacen.458@prueba.local', 'ALMACENERO');
  perform set_config('prueba.almacen', v_almacen::text, true);
end $$;
select set_config('request.jwt.claim.sub', current_setting('prueba.almacen'), true),
       set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.almacen'), 'role', 'authenticated')::text, true);
set local role authenticated;
select test.debe_fallar(
  format('select public.editar_carroceria_ventas(%L::uuid, %L, null, true)', current_setting('prueba.carroceria'), 'Nombre de Almacén'),
  'Almacén no edita carrocerías',
  'cotizaciones.crear'
);
reset role;
select test.afirmar(
  (select codigo = 'C58' and nombre = 'Tolva del check 458' from public.tipos_carroceria where id = current_setting('prueba.carroceria')::uuid),
  'Tras los rechazos queda lo último que sí entró, con su código'
);

-- 4c. Dos carrocerías no se llaman igual: ni por Ventas ni por Diseño, aunque
-- cambien tildes, mayúsculas o signos. Lo que ya estaba repetido se sigue
-- pudiendo tocar sin cambiarle el nombre.
insert into public.tipos_carroceria (codigo, nombre, orden_secuencia, activo)
values ('C58B', 'Furgón isotérmico del check', 99, true),
       ('C58C', 'Furgón isotérmico del check', 99, false);
select set_config('request.jwt.claim.sub', current_setting('prueba.ventas'), true),
       set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.ventas'), 'role', 'authenticated')::text, true);
set local role authenticated;
select test.debe_fallar(
  format('select public.editar_carroceria_ventas(%L::uuid, %L, null, true)', current_setting('prueba.carroceria'), 'FURGON  isotermico - del check'),
  'Ventas no la renombra con el nombre de otra',
  'Ya hay otra carrocería con ese nombre: «Furgón isotérmico del check»'
);
select test.afirmar(
  public.editar_carroceria_ventas((select id from public.tipos_carroceria where codigo = 'C58C'), 'Furgón isotérmico del check', 'Desactivada y repetida', true) is not null,
  'La repetida de antes se reactiva y se corrige sin cambiarle el nombre'
);
reset role;
do $$
declare v_diseno uuid;
begin
  v_diseno := test.crear_usuario('Diseño', 'Check 458', 'diseno.458@prueba.local', 'DISENO');
  perform set_config('prueba.diseno', v_diseno::text, true);
end $$;
select set_config('request.jwt.claim.sub', current_setting('prueba.diseno'), true),
       set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.diseno'), 'role', 'authenticated')::text, true);
set local role authenticated;
select test.debe_fallar(
  format('update public.tipos_carroceria set nombre = %L where id = %L::uuid', 'Furgón Isotérmico del Check', current_setting('prueba.carroceria')),
  'Diseño tampoco la renombra con el nombre de otra',
  'Ya hay otra carrocería con ese nombre'
);
reset role;

-- 5. Nadie más arma el código al editar: el cuerpo de la función no lo asigna.
select test.afirmar(
  (select prosrc !~* 'codigo\s*=' from pg_proc
    where oid = 'public.editar_carroceria_ventas(uuid,text,text,boolean)'::regprocedure),
  'editar_carroceria_ventas no asigna el código'
);
select test.afirmar(
  has_function_privilege('authenticated', 'public.editar_carroceria_ventas(uuid,text,text,boolean)', 'execute')
  and not has_function_privilege('anon', 'public.editar_carroceria_ventas(uuid,text,text,boolean)', 'execute'),
  'Se sigue ejecutando solo con sesión'
);

rollback;
