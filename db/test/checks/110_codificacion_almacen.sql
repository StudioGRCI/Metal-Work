-- La codificación de almacén: el código de cinco segmentos se arma, no se
-- escribe, y la criticidad A/B/C entra a la ficha.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social) values ('20100000015', 'PRUEBAS CODIGO S.A.C.');
insert into public.sedes (codigo, nombre) values ('T1', 'Taller principal');

select test.crear_usuario('Ana',   'Torres', 'ana@demo.pe',   'ADMIN',    (select id from public.sedes limit 1)) as admin_id \gset
select test.crear_usuario('Diego', 'Quispe', 'diego@demo.pe', 'OPERARIO', (select id from public.sedes limit 1), true, 14) as operario_id \gset

select test.como_usuario(:'admin_id');

-- ------------------------------------------------- el catálogo está sembrado
do $$
begin
  perform test.afirmar(
    (select count(*) from public.codificacion_familias) = 12,
    'las doce familias del proyecto del área están cargadas');
  perform test.afirmar(
    (select count(*) from public.codificacion_subfamilias where familia_codigo = 'MP') = 5,
    'materia prima tiene sus cinco subfamilias');
  perform test.afirmar(
    exists (select 1 from public.codificacion_tipos where subfamilia_codigo = 'PL' and codigo = 'HX'),
    'la plancha Hardox existe como tipo');
end $$;

-- ------------------------------------------------- el código se arma solo
do $$
declare
  v_material uuid;
  v_codigo   text;
begin
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  select 'PL-HX-6MM', 'PLANCHA HARDOX 450 6.0MM 1500X6000',
         (select id from public.categorias_material limit 1),
         (select id from public.unidades_medida limit 1)
  returning id into v_material;

  select public.asignar_codigo_almacen(v_material, 'MP', 'PL', 'AC', 'HX') into v_codigo;

  -- El ejemplo real del archivo del área.
  perform test.afirmar(v_codigo = 'MP-PL-AC-HX-0001',
    format('el primer código del grupo es MP-PL-AC-HX-0001: %s', v_codigo));

  -- El segundo material del mismo grupo recibe el siguiente correlativo.
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  select 'PL-HX-8MM', 'PLANCHA HARDOX 450 8.0MM 1500X6000',
         (select id from public.categorias_material limit 1),
         (select id from public.unidades_medida limit 1)
  returning id into v_material;

  select public.asignar_codigo_almacen(v_material, 'MP', 'PL', 'AC', 'HX') into v_codigo;
  perform test.afirmar(v_codigo = 'MP-PL-AC-HX-0002',
    format('el segundo, el correlativo que sigue: %s', v_codigo));

  -- Y un grupo distinto arranca su propio correlativo.
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  select 'BR-1045', 'BARRA REDONDA SAE 1045 2" X 6M',
         (select id from public.categorias_material limit 1),
         (select id from public.unidades_medida limit 1)
  returning id into v_material;

  select public.asignar_codigo_almacen(v_material, 'MP', 'BR', 'AS', 'RS') into v_codigo;
  perform test.afirmar(v_codigo = 'MP-BR-AS-RS-0001',
    format('otro grupo, otro contador: %s', v_codigo));

  -- La criticidad entra y se consulta.
  update public.materiales set criticidad = 'A' where id = v_material;
  perform test.afirmar(
    (select criticidad from public.materiales where id = v_material) = 'A',
    'la criticidad A/B/C queda en la ficha');

  perform set_config('prueba.material', v_material::text, true);
end $$;

-- ------------------------------------------------- las reglas se cumplen
select test.debe_fallar($$
  update public.materiales set criticidad = 'D'
   where id = current_setting('prueba.material')::uuid
$$, 'la criticidad solo puede ser A, B o C');

select test.debe_fallar($$
  update public.materiales set cod_tipo = 'HX'
   where id = current_setting('prueba.material')::uuid
$$, 'un tipo de plancha no se le pone a una barra');

select test.debe_fallar($$
  update public.materiales
     set cod_familia = 'MP', cod_subfamilia = null, cod_material = null,
         cod_tipo = null, cod_correlativo = null
   where id = current_setting('prueba.material')::uuid
$$, 'el código está entero o no está');

select test.debe_fallar($$
  insert into public.codificacion_familias (codigo, nombre) values ('XYZ', 'Inventada')
$$, 'la familia son dos letras, como en el archivo del área');

select test.debe_fallar($$
  update public.materiales set cod_correlativo = 77
   where id = current_setting('prueba.material')::uuid
$$, 'el correlativo no se escribe a mano, lo reparte la función');

select test.debe_fallar($$
  update public.materiales
     set cod_familia = 'CO', cod_subfamilia = null, cod_material = 'AC',
         cod_tipo = 'HX', cod_correlativo = 9
   where id = current_setting('prueba.material')::uuid
$$, 'sin subfamilia no hay tipo que valga');

-- ------------------------------------------------- quién puede codificar
select test.como_usuario(:'operario_id');
set local role authenticated;

do $$
begin
  begin
    perform public.asignar_codigo_almacen(
      current_setting('prueba.material')::uuid, 'MP', 'BR', 'AS', 'RP');
    raise exception 'FALLA: un operario pudo codificar materiales';
  exception when others then
    if sqlerrm like 'FALLA%' then raise; end if;
    raise notice '  ok · codificar materiales exige el permiso de maestros (%)', sqlerrm;
  end;
end $$;

reset role;

rollback;
