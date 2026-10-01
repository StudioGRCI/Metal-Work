-- La evaluación de desempeño de Diseño: la hace Diseño, la recibe Administración.
--
-- Diseño e ingeniería registra una evaluación (queda en borrador aunque mande
-- otro estado o sellos), la corrige y la envía. En borrador no la ve nadie más:
-- ni Administración, ni el Líder de Diseño. Enviada, queda cerrada: no se
-- corrige ni se borra. Administración la ve, no la puede corregir, no la puede
-- devolver sin explicar, la devuelve con su observación, Diseño la corrige y la
-- reenvía, y Administración la recibe. Recursos Humanos, Supervisión General,
-- Gerencia y el colaborador de Diseño no la ven nunca ni la pueden crear. Un
-- borrador que no salió se borra; nada de esto pasa por `audit_log`, que leen
-- Gerencia y Supervisión General.
begin;

select id as sede_id from public.sedes order by nombre limit 1 \gset
select test.crear_usuario('QA','Diseño','qa-319-diseno@demo.pe','DISENO', :'sede_id') as diseno_id \gset
select test.crear_usuario('QA','Líder','qa-319-lider@demo.pe','DISENO_LIDER', :'sede_id') as lider_id \gset
select test.crear_usuario('QA','Colaborador','qa-319-colab@demo.pe','DISENO_COLABORADOR', :'sede_id') as colab_id \gset
select test.crear_usuario('QA','Oficina','qa-319-oficina@demo.pe','ADMINISTRACION', :'sede_id') as oficina_id \gset
select test.crear_usuario('QA','Personal','qa-319-rrhh@demo.pe','RECURSOS_HUMANOS', :'sede_id') as rrhh_id \gset
select test.crear_usuario('QA','General','qa-319-general@demo.pe','SUPERVISOR_GENERAL', :'sede_id') as general_id \gset
select test.crear_usuario('QA','Gerencia','qa-319-gerencia@demo.pe','GERENTE', :'sede_id') as gerente_id \gset
update public.usuarios set cargo = 'Supervisor de diseño' where id = :'diseno_id';

select set_config('prueba.e.diseno', :'diseno_id', true);
select set_config('prueba.e.oficina', :'oficina_id', true);
select set_config('prueba.e.id', gen_random_uuid()::text, true);
select set_config('prueba.e.borrador', gen_random_uuid()::text, true);

-- Los permisos los tiene quien hace el trabajo, y nadie más.
select test.afirmar(
  (select array_agg(r.codigo order by r.codigo) from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
    where rp.permiso_codigo = 'diseno.evaluar') = array['DISENO', 'DISENO_LIDER'],
  'diseno.evaluar lo tienen Diseño e ingeniería y Líder de Diseño');
select test.afirmar(
  (select array_agg(r.codigo order by r.codigo) from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
    where rp.permiso_codigo = 'administracion.recibir_evaluacion') = array['ADMINISTRACION'],
  'administracion.recibir_evaluacion lo tiene solo Administración');

set local role authenticated;

-- El colaborador y Gerencia no evalúan.
select test.como_usuario(:'colab_id');
select test.debe_fallar($$insert into public.diseno_evaluaciones (evaluado_nombre, puesto, fecha_evaluacion, respuestas, evaluador_id)
  values ('Persona QA', 'Diseñador', '2026-08-31', array_fill(3::smallint, array[20]), public.usuario_actual())$$,
  'el colaborador de Diseño no registra evaluaciones');
select test.como_usuario(:'gerente_id');
select test.debe_fallar($$insert into public.diseno_evaluaciones (evaluado_nombre, puesto, fecha_evaluacion, respuestas, evaluador_id)
  values ('Persona QA', 'Diseñador', '2026-08-31', array_fill(3::smallint, array[20]), public.usuario_actual())$$,
  'Gerencia ya no registra evaluaciones aunque tenga diseno.planos');

-- Diseño la registra. Lo que mande en estado o sellos no vale.
select test.como_usuario(:'diseno_id');
insert into public.diseno_evaluaciones (id, evaluado_nombre, puesto, fecha_ingreso, fecha_evaluacion, respuestas, comentarios,
                                        evaluador_id, estado, enviada_en, recibida_por, recibida_en)
values (current_setting('prueba.e.id')::uuid, 'Persona QA', 'Diseñador', '2026-08-01', '2026-08-31',
        array[2,2,2,2,3,2,3,3,3,2,3,1,2,1,1,3,2,2,2,2]::smallint[], 'Le cuesta el programa.',
        public.usuario_actual(), 'RECIBIDA', now(), public.usuario_actual(), now());
select test.afirmar(
  (select estado = 'BORRADOR' and enviada_en is null and recibida_por is null and recibida_en is null
          and evaluador_nombre = 'QA Diseño' and evaluador_cargo = 'Supervisor de diseño' and area_servicio = 'Ingeniería'
     from public.diseno_evaluaciones where id = current_setting('prueba.e.id')::uuid),
  'nace en borrador, sin sellos, con el nombre y cargo del evaluador copiados');
select test.afirmar(
  (select (select sum(v) from unnest(respuestas) v) = 43 from public.diseno_evaluaciones where id = current_setting('prueba.e.id')::uuid),
  'el puntaje del formato de ejemplo suma 43 sobre 100');
update public.diseno_evaluaciones set comentarios = 'Tiene dificultades con el programa y el rubro.'
 where id = current_setting('prueba.e.id')::uuid;
select test.afirmar(
  (select comentarios like 'Tiene dificultades%' from public.diseno_evaluaciones where id = current_setting('prueba.e.id')::uuid),
  'el evaluador corrige su borrador');

-- En borrador no la ve nadie más, y nadie más la toca.
select test.como_usuario(:'oficina_id');
select test.afirmar((select count(*) = 0 from public.diseno_evaluaciones), 'Administración no ve un borrador');
update public.diseno_evaluaciones set estado = 'RECIBIDA' where id = current_setting('prueba.e.id')::uuid;
select test.como_usuario(:'lider_id');
select test.afirmar((select count(*) = 0 from public.diseno_evaluaciones), 'otro evaluador no ve la evaluación ajena');
update public.diseno_evaluaciones set comentarios = 'Cambio ajeno' where id = current_setting('prueba.e.id')::uuid;
select test.como_usuario(:'diseno_id');
select test.afirmar(
  (select estado = 'BORRADOR' and comentarios like 'Tiene dificultades%' from public.diseno_evaluaciones where id = current_setting('prueba.e.id')::uuid),
  'ni Administración la recibió ni el líder la cambió estando en borrador');

-- Diseño la envía. Enviada, queda cerrada.
select test.debe_fallar($$update public.diseno_evaluaciones set estado = 'RECIBIDA' where id = current_setting('prueba.e.id')::uuid$$,
  'Diseño no se da por recibida su propia evaluación', 'no puede pasar a recibida');
update public.diseno_evaluaciones set estado = 'ENVIADA' where id = current_setting('prueba.e.id')::uuid;
select test.afirmar(
  (select estado = 'ENVIADA' and enviada_en is not null from public.diseno_evaluaciones where id = current_setting('prueba.e.id')::uuid),
  'Diseño la envía y queda sellada la hora');
select test.debe_fallar($$update public.diseno_evaluaciones set respuestas[1] = 5 where id = current_setting('prueba.e.id')::uuid$$,
  'enviada no se corrige', 'ya se envió a Administración');
select test.debe_fallar($$delete from public.diseno_evaluaciones where id = current_setting('prueba.e.id')::uuid$$,
  'enviada no se borra', 'no se borra');
select test.debe_fallar($$update public.diseno_evaluaciones set estado = 'RECIBIDA' where id = current_setting('prueba.e.id')::uuid$$,
  'el evaluador no puede recibirla por Administración', 'administracion.recibir_evaluacion');

-- Recursos Humanos, Supervisión General y Gerencia no la ven nunca.
select test.como_usuario(:'rrhh_id');
select test.afirmar((select count(*) = 0 from public.diseno_evaluaciones), 'Recursos Humanos no ve la evaluación enviada');
select test.como_usuario(:'general_id');
select test.afirmar((select count(*) = 0 from public.diseno_evaluaciones), 'Supervisión General no ve la evaluación enviada');
select test.como_usuario(:'gerente_id');
select test.afirmar((select count(*) = 0 from public.diseno_evaluaciones), 'Gerencia no ve la evaluación enviada');
select test.como_usuario(:'colab_id');
select test.afirmar((select count(*) = 0 from public.diseno_evaluaciones), 'el colaborador de Diseño no ve la evaluación enviada');

-- Administración la ve, no la corrige y no la devuelve sin explicar.
select test.como_usuario(:'oficina_id');
select test.afirmar((select count(*) = 1 from public.diseno_evaluaciones), 'Administración ve la evaluación enviada');
select test.debe_fallar($$update public.diseno_evaluaciones set comentarios = 'Otra cosa' where id = current_setting('prueba.e.id')::uuid$$,
  'Administración no corrige la evaluación', 'diseno.evaluar');
select test.debe_fallar($$update public.diseno_evaluaciones set estado = 'OBSERVADA', observacion = 'Falta' where id = current_setting('prueba.e.id')::uuid$$,
  'no se devuelve sin explicar', 'al menos 10 caracteres');
delete from public.diseno_evaluaciones where id = current_setting('prueba.e.id')::uuid;
select test.afirmar((select count(*) = 1 from public.diseno_evaluaciones), 'Administración no la borra: el borrado no la alcanza');
update public.diseno_evaluaciones set estado = 'OBSERVADA', observacion = '  Falta la fecha de ingreso exacta.  '
 where id = current_setting('prueba.e.id')::uuid;
select test.afirmar(
  (select estado = 'OBSERVADA' and observacion = 'Falta la fecha de ingreso exacta.' and observada_por = current_setting('prueba.e.oficina')::uuid
          and observada_en is not null
     from public.diseno_evaluaciones where id = current_setting('prueba.e.id')::uuid),
  'Administración la devuelve con su observación, firmada');

-- Diseño la corrige y la reenvía; Administración la recibe.
select test.como_usuario(:'diseno_id');
update public.diseno_evaluaciones set fecha_ingreso = '2026-08-03' where id = current_setting('prueba.e.id')::uuid;
update public.diseno_evaluaciones set estado = 'ENVIADA' where id = current_setting('prueba.e.id')::uuid;
select test.como_usuario(:'oficina_id');
update public.diseno_evaluaciones set estado = 'RECIBIDA' where id = current_setting('prueba.e.id')::uuid;
select test.afirmar(
  (select estado = 'RECIBIDA' and recibida_por = current_setting('prueba.e.oficina')::uuid and recibida_en is not null
          and fecha_ingreso = '2026-08-03' and observacion = 'Falta la fecha de ingreso exacta.'
     from public.diseno_evaluaciones where id = current_setting('prueba.e.id')::uuid),
  'corregida, reenviada y recibida; la devolución queda como historia');
select test.debe_fallar($$update public.diseno_evaluaciones set estado = 'OBSERVADA', observacion = 'Ya recibida, otra observación' where id = current_setting('prueba.e.id')::uuid$$,
  'recibida no se devuelve', 'no puede pasar a devuelta');

-- Un borrador que no salió sí se borra.
select test.como_usuario(:'diseno_id');
insert into public.diseno_evaluaciones (id, evaluado_nombre, puesto, fecha_evaluacion, respuestas, evaluador_id)
values (current_setting('prueba.e.borrador')::uuid, 'Otra persona QA', 'Practicante', '2026-08-31',
        array_fill(4::smallint, array[20]), public.usuario_actual());
delete from public.diseno_evaluaciones where id = current_setting('prueba.e.borrador')::uuid;
select test.afirmar(
  (select count(*) = 0 from public.diseno_evaluaciones where id = current_setting('prueba.e.borrador')::uuid),
  'el borrador que nunca salió se borra');

reset role;
select test.afirmar(
  (select count(*) = 0 from public.audit_log where tabla = 'diseno_evaluaciones'),
  'la evaluación no se copia en audit_log');

select 'OK: Diseño evalúa y envía; Administración ve solo lo enviado, devuelve y recibe; RR. HH., Supervisión General y Gerencia no la ven. Ensayo revertido.' as comprobacion;
rollback;
