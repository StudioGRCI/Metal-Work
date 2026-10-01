-- Carrocerías y unidades las lleva Diseño; a Administración, solo la evaluación.
--
-- Diseño e ingeniería ve la ficha técnica de una carrocería (antes la escondía
-- un permiso que no tiene ningún puesto), corrige su nombre y sus medidas, y
-- corrige los datos de una unidad. Administración ya no corrige el catálogo
-- —el UPDATE no toca ninguna fila—, pero sigue dando de alta la carrocería que
-- falta al cargar una OT y ve la ficha desde Configuración. Ventas sigue
-- corrigiendo unidades; el colaborador de Diseño no corrige carrocerías ni
-- unidades. El informe semanal termina cuando Diseño lo aprueba: nadie lo
-- pasa a RECIBIDO, Administración no lo ve y el permiso de recibirlo ya no
-- existe.
begin;

select id as sede_id from public.sedes order by nombre limit 1 \gset
select test.crear_usuario('QA','Diseño','qa-322-diseno@demo.pe','DISENO', :'sede_id') as diseno_id \gset
select test.crear_usuario('QA','Administración','qa-322-admin@demo.pe','ADMINISTRACION', :'sede_id') as admin_id \gset
select test.crear_usuario('QA','Ventas','qa-322-ventas@demo.pe','VENDEDOR', :'sede_id') as ventas_id \gset
select test.crear_usuario('QA','Colaborador','qa-322-colab@demo.pe','DISENO_COLABORADOR', :'sede_id') as colab_id \gset

select set_config('prueba.d.carroceria', gen_random_uuid()::text, true);
select set_config('prueba.d.ficha', gen_random_uuid()::text, true);
select set_config('prueba.d.unidad', gen_random_uuid()::text, true);
select set_config('prueba.d.informe', gen_random_uuid()::text, true);

-- Armazón: una carrocería con su ficha de una línea y una unidad de un cliente,
-- sin pasar por las reglas de esas tablas.
set local session_replication_role = replica;
do $armazon$
declare v_cliente uuid := gen_random_uuid();
begin
  insert into public.tipos_carroceria (id, codigo, nombre, activo, orden_secuencia)
  values (current_setting('prueba.d.carroceria')::uuid, 'QA_322_TOLVA', 'Tolva QA 322', true, 99);
  insert into public.plantillas_ficha (id, tipo_carroceria_id, nombre, activa)
  values (current_setting('prueba.d.ficha')::uuid, current_setting('prueba.d.carroceria')::uuid, 'Ficha QA 322', true);
  insert into public.plantilla_ficha_lineas (plantilla_id, seccion, detalle)
  values (current_setting('prueba.d.ficha')::uuid, 'ESTRUCTURA', 'Vigas principales QA');
  insert into public.clientes (id, tipo_documento, numero_documento, razon_social)
  values (v_cliente, 'RUC', '20990000322', 'QA carrocerías y unidades');
  insert into public.unidades (id, cliente_id, placa, tipo_vehiculo, marca, modelo, anio)
  values (current_setting('prueba.d.unidad')::uuid, v_cliente, 'QAD-322', 'VOLQUETE', 'Volvo', 'FMX', 2024);
end;
$armazon$;
set local session_replication_role = origin;

set local role authenticated;

-- Diseño: ve la ficha y corrige la carrocería y la unidad.
select test.como_usuario(:'diseno_id');
select test.afirmar(
  (select count(*) = 1 from public.plantillas_ficha where id = current_setting('prueba.d.ficha')::uuid)
  and (select count(*) = 1 from public.plantilla_ficha_lineas where plantilla_id = current_setting('prueba.d.ficha')::uuid),
  'Diseño ve la ficha técnica de la carrocería y sus líneas');
with x as (
  update public.tipos_carroceria set nombre = 'Tolva QA 322 corregida', largo_m = 6.2, ancho_m = 2.4, alto_m = 1.6
   where id = current_setting('prueba.d.carroceria')::uuid returning 1)
select test.afirmar((select count(*) = 1 from x), 'Diseño corrige el nombre y las medidas de la carrocería');
with x as (
  update public.unidades set numero_chasis = 'QA322CHASIS', activo = false
   where id = current_setting('prueba.d.unidad')::uuid returning 1)
select test.afirmar((select count(*) = 1 from x), 'Diseño corrige los datos de la unidad y la desactiva');

-- Administración: ya no corrige el catálogo; sí da de alta la carrocería que
-- falta al cargar una OT, y ve la ficha desde Configuración.
select test.como_usuario(:'admin_id');
with x as (
  update public.tipos_carroceria set nombre = 'Cambio de Administración'
   where id = current_setting('prueba.d.carroceria')::uuid returning 1)
select test.afirmar((select count(*) = 0 from x), 'Administración ya no corrige el catálogo de carrocerías');
select test.afirmar((select count(*) = 1 from public.plantillas_ficha where id = current_setting('prueba.d.ficha')::uuid),
  'Administración ve la ficha técnica desde Configuración');
insert into public.tipos_carroceria (codigo, nombre, orden_secuencia) values ('QA_322_NUEVA', 'Nueva QA 322', 99);
select test.afirmar((select count(*) = 1 from public.tipos_carroceria where codigo = 'QA_322_NUEVA'),
  'Administración da de alta la carrocería que falta al cargar una OT');

-- Ventas sigue corrigiendo unidades; el colaborador de Diseño, ni una ni otra.
select test.como_usuario(:'ventas_id');
with x as (update public.unidades set color = 'Blanco' where id = current_setting('prueba.d.unidad')::uuid returning 1)
select test.afirmar((select count(*) = 1 from x), 'Ventas sigue corrigiendo unidades');

select test.como_usuario(:'colab_id');
with x as (update public.tipos_carroceria set nombre = 'Cambio del colaborador' where id = current_setting('prueba.d.carroceria')::uuid returning 1)
select test.afirmar((select count(*) = 0 from x), 'el colaborador no corrige carrocerías');
with x as (update public.unidades set color = 'Rojo' where id = current_setting('prueba.d.unidad')::uuid returning 1)
select test.afirmar((select count(*) = 0 from x), 'el colaborador no corrige unidades');

-- El informe: el colaborador lo envía, Diseño lo aprueba y ahí termina.
insert into public.diseno_informes (id, semana_inicio, responsable, resumen, creado_por, actualizado_por)
values (current_setting('prueba.d.informe')::uuid, '2099-01-05', 'Persona QA', 'Resumen completo del ensayo 322', :'colab_id', :'colab_id');
select public.transitar_informe_diseno(current_setting('prueba.d.informe')::uuid, 'EN_REVISION');
select test.como_usuario(:'diseno_id');
select public.transitar_informe_diseno(current_setting('prueba.d.informe')::uuid, 'APROBADO');
select test.debe_fallar($$select public.transitar_informe_diseno(current_setting('prueba.d.informe')::uuid, 'RECIBIDO')$$,
  'nadie pasa el informe a RECIBIDO', 'termina cuando Diseño lo aprueba');
select test.debe_fallar($$update public.diseno_informes set estado = 'RECIBIDO' where id = current_setting('prueba.d.informe')::uuid$$,
  'tampoco escribiendo el estado a mano', 'no corresponde');
select test.como_usuario(:'admin_id');
select test.afirmar((select count(*) = 0 from public.diseno_informes where id = current_setting('prueba.d.informe')::uuid),
  'Administración no ve el informe aprobado');

reset role;
select test.afirmar(not exists (select 1 from public.permisos where codigo = 'administracion.recibir_informe'),
  'el permiso de recibir el informe ya no existe');
select test.afirmar(
  (select count(*) = 4 from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
    where r.codigo in ('DISENO', 'DISENO_LIDER') and rp.permiso_codigo in ('diseno.carrocerias', 'diseno.unidades')),
  'Diseño e ingeniería y Líder de Diseño tienen los dos permisos nuevos');

select 'OK: Diseño ve las fichas y corrige carrocerías y unidades; Administración ya no corrige el catálogo; el informe termina en la aprobación de Diseño. Ensayo revertido.' as comprobacion;
rollback;
