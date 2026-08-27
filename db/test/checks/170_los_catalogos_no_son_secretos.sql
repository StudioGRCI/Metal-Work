-- Sin catálogo no hay trabajo: si al vendedor le llega vacío el desplegable de
-- carrocerías, no puede cotizar, y el sistema no sirve para lo que se hizo.
--
-- Este check existe porque el recorrido del banco entra como ADMIN, y ADMIN
-- pasa por es_admin() en vez de por el permiso: todas las pantallas salían
-- llenas en las pruebas y vacías para la gente. Acá se mira con los ojos de
-- cada rol.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social) values ('20100000021', 'PRUEBAS CATALOGOS S.A.C.');
insert into public.sedes (codigo, nombre) values ('T1', 'Taller principal');

select test.crear_usuario('Vera',  'Sandoval', 'vera@demo.pe',  'VENDEDOR',   (select id from public.sedes limit 1)) as vendedor_id \gset
select test.crear_usuario('Rosa',  'Yupanqui', 'rosa@demo.pe',  'JEFE_TALLER',(select id from public.sedes limit 1)) as jefe_id \gset
select test.crear_usuario('Jesus', 'Campos',   'jesus@demo.pe', 'ALMACENERO', (select id from public.sedes limit 1)) as almacenero_id \gset
select test.crear_usuario('Luis',  'Ochoa',    'luis@demo.pe',  'OPERARIO',   (select id from public.sedes limit 1)) as operario_id \gset

-- Lo que de verdad hay en la base, para comparar contra lo que ve cada quien.
select set_config('prueba.carrocerias',
  (select count(*)::text from public.tipos_carroceria), false);

-- ------------------------------------- el vendedor tiene con qué cotizar
select test.como_usuario(:'vendedor_id');
set local role authenticated;

do $$
begin
  perform test.afirmar(
    (select count(*) from public.tipos_carroceria)
      = current_setting('prueba.carrocerias')::int,
    format('el vendedor ve las %s carrocerías del catálogo, no un desplegable vacío',
           current_setting('prueba.carrocerias')));

  perform test.afirmar(
    (select count(*) from public.sedes) > 0,
    'y ve el taller donde se ejecutará la orden');

  -- Verlas no es cambiarlas: el catálogo se administra desde Configuración.
  -- Se comprueba el resultado y no la excepción, porque un UPDATE que el RLS
  -- filtra no revienta: afecta cero filas y calla. Esa es justamente la
  -- trampa que hizo falta esta tanda de arreglos.
  update public.tipos_carroceria set nombre = 'Renombrada por el vendedor';
  perform test.afirmar(
    not exists (select 1 from public.tipos_carroceria
                 where nombre = 'Renombrada por el vendedor'),
    'pero no las renombra: eso sigue siendo de configuración');
end $$;

reset role;

-- ------------------------- el jefe de taller abre la orden con su carrocería
select test.como_usuario(:'jefe_id');
set local role authenticated;

do $$
begin
  perform test.afirmar(
    (select count(*) from public.tipos_carroceria) > 0
      and (select count(*) from public.sedes) > 0,
    'el jefe de taller ve carrocerías y sedes para abrir la orden');
  perform test.afirmar(
    (select count(*) from public.etapas_catalogo) > 0,
    'y las etapas con las que se arma el trabajo');
end $$;

reset role;

-- --------------------------- el almacenero da de alta un material completo
select test.como_usuario(:'almacenero_id');
set local role authenticated;

do $$
begin
  perform test.afirmar(
    (select count(*) from public.unidades_medida) > 0,
    'el almacenero tiene unidades de medida que elegir');
  perform test.afirmar(
    (select count(*) from public.categorias_material) > 0,
    'y categorías de material');
end $$;

reset role;

-- ------------------------- hasta el operario ve el vocabulario de la casa
select test.como_usuario(:'operario_id');
set local role authenticated;

do $$
begin
  perform test.afirmar(
    (select count(*) from public.areas) > 0,
    'el operario ve las áreas del organigrama');
end $$;

reset role;

-- ------------------- lo que sí guarda decisiones sigue cerrado
-- La empresa lleva el IGV congelado y el costo indirecto por hora; los
-- correlativos vivos son de la casa. El membrete que el resto necesita sale
-- por datos_de_empresa(), que devuelve solo lo que va impreso.
select test.como_usuario(:'vendedor_id');
set local role authenticated;

do $$
begin
  perform test.afirmar(
    (select count(*) from public.empresa) = 0,
    'el vendedor no lee la ficha de la empresa con el IGV y los costos');
  perform test.afirmar(
    (select count(*) from public.series_documentarias) = 0,
    'ni los correlativos vivos de la casa');

  perform test.afirmar(
    (select d.ruc from public.datos_de_empresa() d) = '20100000021',
    'pero sí tiene el membrete para imprimir sus documentos');
end $$;

reset role;

rollback;
