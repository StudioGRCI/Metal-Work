-- La revisión del informe semanal de Diseño.
--
-- El colaborador lo envía; no se lo aprueba él mismo ni corrige lo enviado.
-- Diseño lo aprueba con el contenido sellado y ahí termina: desde la
-- migración 20261001213000 Administración ya no lo recibe ni lo ve.
-- Antes este check tomaba las cuentas reales de la base y no corría fuera de
-- producción; ahora crea las suyas.
begin;

select id as sede_id from public.sedes order by nombre limit 1 \gset
select test.crear_usuario('QA','Colaborador','qa-303-colab@demo.pe','DISENO_COLABORADOR', :'sede_id') as colab_id \gset
select test.crear_usuario('QA','Diseño','qa-303-diseno@demo.pe','DISENO', :'sede_id') as diseno_id \gset
select test.crear_usuario('QA','Administración','qa-303-admin@demo.pe','ADMINISTRACION', :'sede_id') as admin_id \gset
select set_config('prueba.informe', gen_random_uuid()::text, true);

set local role authenticated;

select test.como_usuario(:'colab_id');
insert into public.diseno_informes (id, semana_inicio, responsable, resumen, creado_por, actualizado_por)
values (current_setting('prueba.informe')::uuid, '2099-01-05', 'Persona de prueba', 'Resumen completo para ensayo reversible', :'colab_id', :'colab_id');
select public.transitar_informe_diseno(current_setting('prueba.informe')::uuid, 'EN_REVISION');
select test.debe_fallar($$select public.transitar_informe_diseno(current_setting('prueba.informe')::uuid, 'APROBADO')$$,
  'el colaborador no aprueba su propio informe', 'diseno.revisar_informe');
select test.debe_fallar($$update public.diseno_informes set resumen = 'Cambio no autorizado' where id = current_setting('prueba.informe')::uuid$$,
  'el colaborador no corrige lo enviado', 'El informe enviado');

select test.como_usuario(:'diseno_id');
select public.transitar_informe_diseno(current_setting('prueba.informe')::uuid, 'APROBADO');
select test.afirmar(
  (select estado = 'APROBADO' and revisado_por = :'diseno_id'::uuid and contenido_enviado is not null
     from public.diseno_informes where id = current_setting('prueba.informe')::uuid),
  'Diseño aprueba el informe con el contenido sellado');

select test.como_usuario(:'admin_id');
select test.afirmar((select count(*) = 0 from public.diseno_informes where id = current_setting('prueba.informe')::uuid),
  'Administración no ve el informe');

reset role;
select 'OK: el colaborador envía; no se autoaprueba ni corrige lo enviado; Diseño aprueba y ahí termina. Ensayo revertido.' as comprobacion;
rollback;
