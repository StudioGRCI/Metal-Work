-- El recorrido del informe semanal de Diseño (migraciones 20261126300000 y
-- 20261126311000).
--
--   1. El colaborador empieza el informe: lo tiene él y falta la revisión.
--   2. Lo envía: lo tiene Diseño.
--   3. Diseño lo devuelve con su motivo: al colaborador le llega a la campana
--      con el motivo y el número de tres cifras, y el recorrido dice el motivo.
--   4. Lo corrige y lo envía otra vez: el motivo de la primera devolución sigue
--      en el recorrido aunque la columna ya se vació (sale de la bitácora).
--   5. Diseño lo aprueba: dos envíos, una devolución y la aprobación, en orden,
--      con el puesto de cada uno y sin nombres; ya no espera a nadie.
--   6. Lo lee quien ve el informe (el colaborador, Diseño, el Supervisor
--      General); Recursos Humanos no. El aviso de la devolución le llega a quien
--      hizo el informe, no a otro colaborador que no tuvo nada que ver.
--   6b. Un informe sin bitácora (anterior a la auditoría de la tabla) no pierde
--      su última vuelta: sale de sus columnas.
--   7. «Tus semanas» trae la del colaborador y no la ajena: otro colaborador,
--      que no la empezó ni anotó nada en ella, no la ve en la suya.
--
-- Cada lectura con la cuenta del puesto —nunca ADMIN— y `set local role
-- authenticated`. Termina en rollback.
\set ON_ERROR_STOP on
begin;

select id as sede_id from public.sedes order by nombre limit 1 \gset
select test.crear_usuario('QA472','Colaborador','qa-472-colab@demo.pe','DISENO_COLABORADOR', :'sede_id') as colab_id \gset
select test.crear_usuario('QA472','Otro colaborador','qa-472-colab2@demo.pe','DISENO_COLABORADOR', :'sede_id') as colab2_id \gset
select test.crear_usuario('QA472','Diseño','qa-472-diseno@demo.pe','DISENO', :'sede_id') as diseno_id \gset
select test.crear_usuario('QA472','Personal','qa-472-rrhh@demo.pe','RECURSOS_HUMANOS', :'sede_id') as rrhh_id \gset
select test.crear_usuario('QA472','Supervisor','qa-472-super@demo.pe','SUPERVISOR_GENERAL', :'sede_id') as super_id \gset
-- Cómo nombra el recorrido a quien revisa: el puesto de la cuenta activa de
-- Diseño, como en los pasos hechos.
select coalesce((select public.puesto(u) from public.usuarios u join public.roles r on r.id = u.rol_id
                  where r.codigo = 'DISENO' and u.activo order by u.creado_en limit 1),
                (select nombre from public.roles where codigo = 'DISENO')) as puesto_diseno \gset

select set_config('prueba.r.orden', gen_random_uuid()::text, true);
select set_config('prueba.r.persona', gen_random_uuid()::text, true);
select set_config('prueba.r.informe', gen_random_uuid()::text, true);

-- Armazón: la OT con su unidad y el equipo de Diseño, sin pasar por las reglas
-- de esas tablas (tienen sus propios checks).
set local session_replication_role = replica;
do $armazon$
declare
  v_orden uuid := current_setting('prueba.r.orden')::uuid;
  v_cliente uuid := gen_random_uuid();
  v_unidad uuid := gen_random_uuid();
  v_sede uuid := (select id from public.sedes order by nombre limit 1);
begin
  insert into public.clientes (id, tipo_documento, numero_documento, razon_social)
  values (v_cliente, 'RUC', '20990000472', 'QA RECORRIDO DEL INFORME');
  insert into public.unidades (id, cliente_id, placa, codigo_interno, tipo_vehiculo, marca, modelo)
  values (v_unidad, v_cliente, 'QAX-472', 'QA_CM_N2_1_26/72', 'CAMION', 'Volvo', 'FMX');
  insert into public.ordenes_trabajo (id, numero, cliente_id, sede_id, unidad_id, tipo_unidad, tipo_trabajo, prioridad,
                                      descripcion, estado, fecha_registro)
  values (v_orden, '9472-2099', v_cliente, v_sede, v_unidad, 'CARROCERIA_MONTADA', 'FABRICACION', 'NORMAL',
          'Orden QA del recorrido del informe', 'EN_PROCESO', current_date);
  insert into public.ot_equipo_diseno (id, orden_id, nombre, funcion) values
    (current_setting('prueba.r.persona')::uuid, v_orden, 'Persona QA472', 'COLABORADOR');
end;
$armazon$;
set local session_replication_role = origin;

set local role authenticated;

-- 1. El colaborador anota una actividad y empieza el informe.
select test.como_usuario(:'colab_id');
insert into public.diseno_tareas (orden_id, integrante_id, tipo, componente, fecha_inicio, fecha_entrega, creado_por)
values (current_setting('prueba.r.orden')::uuid, current_setting('prueba.r.persona')::uuid, 'PLOTEO',
        'Ploteo de la tolva', '2099-02-02', '2099-02-02', public.usuario_actual());
insert into public.diseno_informes (id, semana_inicio, responsable, resumen, creado_por, actualizado_por)
values (current_setting('prueba.r.informe')::uuid, '2099-02-02', 'Persona QA472', 'Resumen de la semana de prueba 472',
        public.usuario_actual(), public.usuario_actual());

select test.afirmar(
  (select string_agg(paso || ':' || situacion, ' > ' order by orden)
     from public.recorrido_de_informes_diseno(array[current_setting('prueba.r.informe')::uuid]))
  = 'REGISTRO:HECHO > ENVIO:AHORA > REVISION:PENDIENTE',
  'en borrador: lo empezó, falta enviarlo y después la revisión');
select test.afirmar(
  (select puesto = 'Colaboradores de Diseño' and dias = 0 and espera = 'ENVIO'
     from public.recorrido_de_informes_diseno(array[current_setting('prueba.r.informe')::uuid]) where situacion = 'AHORA'),
  'en borrador lo tiene el colaborador, desde hoy');

-- 2. Lo envía: lo tiene Diseño.
select public.transitar_informe_diseno(current_setting('prueba.r.informe')::uuid, 'EN_REVISION');
select test.afirmar(
  (select string_agg(paso || ':' || situacion, ' > ' order by orden)
     from public.recorrido_de_informes_diseno(array[current_setting('prueba.r.informe')::uuid]))
  = 'REGISTRO:HECHO > ENVIO:HECHO > REVISION:AHORA',
  'enviado: lo tiene Diseño');
select test.afirmar(
  (select puesto = :'puesto_diseno' and espera = 'REVISION'
     from public.recorrido_de_informes_diseno(array[current_setting('prueba.r.informe')::uuid]) where situacion = 'AHORA'),
  'enviado, lo tiene el puesto que lo revisa');

-- 3. Diseño lo devuelve con su motivo.
select test.como_usuario(:'diseno_id');
select public.transitar_informe_diseno(current_setting('prueba.r.informe')::uuid, 'OBSERVADO',
  'Falta registrar el ploteo del miércoles y el plano de corte.');

select test.como_usuario(:'colab_id');
select test.afirmar(
  (select count(*) = 1 from public.notificaciones
    where usuario_id = public.usuario_actual() and titulo = 'Informe de Diseño devuelto para corregir'
      and cuerpo = 'Informe N.º ' || lpad((select numero::text from public.diseno_informes where id = current_setting('prueba.r.informe')::uuid), 3, '0')
                   || ' · semana del 02/02/2099. Motivo: Falta registrar el ploteo del miércoles y el plano de corte.'
      and ruta = '/diseno/informe-semanal?semana=2099-02-02'),
  'la campana le avisa al colaborador que se lo devolvieron, con el motivo y el número de tres cifras');
select test.como_usuario(:'colab2_id');
select test.afirmar(
  (select count(*) = 0 from public.notificaciones
    where usuario_id = public.usuario_actual() and origen_id = current_setting('prueba.r.informe')::uuid),
  'al otro colaborador, que no hizo el informe, no le llega el aviso');
select test.como_usuario(:'colab_id');
select test.afirmar(
  (select string_agg(paso || ':' || situacion, ' > ' order by orden)
     from public.recorrido_de_informes_diseno(array[current_setting('prueba.r.informe')::uuid]))
  = 'REGISTRO:HECHO > ENVIO:HECHO > DEVOLUCION:HECHO > CORRECCION:AHORA > REVISION:PENDIENTE',
  'devuelto: lo tiene el colaborador para corregirlo');
select test.afirmar(
  (select detalle = 'Falta registrar el ploteo del miércoles y el plano de corte.'
          and puesto = (select nombre from public.roles where codigo = 'DISENO')
     from public.recorrido_de_informes_diseno(array[current_setting('prueba.r.informe')::uuid]) where paso = 'DEVOLUCION'),
  'la devolución dice su motivo y el puesto que la hizo');

-- 4. Lo corrige y lo envía otra vez: la columna del motivo se vacía.
select public.transitar_informe_diseno(current_setting('prueba.r.informe')::uuid, 'EN_REVISION');
select test.afirmar(
  (select observacion_revision is null from public.diseno_informes where id = current_setting('prueba.r.informe')::uuid),
  'al reenviarlo, la columna del motivo queda vacía');
select test.afirmar(
  (select detalle = 'Falta registrar el ploteo del miércoles y el plano de corte.'
     from public.recorrido_de_informes_diseno(array[current_setting('prueba.r.informe')::uuid]) where paso = 'DEVOLUCION'),
  'el motivo de la devolución sigue en el recorrido: sale de la bitácora');

-- 5. Diseño lo aprueba.
select test.como_usuario(:'diseno_id');
select public.transitar_informe_diseno(current_setting('prueba.r.informe')::uuid, 'APROBADO');
select test.como_usuario(:'colab_id');
select test.afirmar(
  (select string_agg(paso || ':' || situacion, ' > ' order by orden)
     from public.recorrido_de_informes_diseno(array[current_setting('prueba.r.informe')::uuid]))
  = 'REGISTRO:HECHO > ENVIO:HECHO > DEVOLUCION:HECHO > ENVIO:HECHO > APROBACION:HECHO',
  'aprobado: las dos vueltas en orden y ya no espera a nadie');
select test.afirmar(
  (select count(*) = 1 from public.notificaciones
    where usuario_id = public.usuario_actual() and titulo = 'Informe de Diseño aprobado'
      and cuerpo not like '%Motivo%'),
  'la campana le avisa que se aprobó');
select test.como_usuario(:'colab2_id');
select test.afirmar(
  (select count(*) = 0 from public.notificaciones
    where usuario_id = public.usuario_actual() and origen_id = current_setting('prueba.r.informe')::uuid),
  'al otro colaborador tampoco le llega el aviso de aprobado');
select test.como_usuario(:'colab_id');
select test.afirmar(
  (select bool_and(coalesce(puesto, '') not like '%QA472%' and coalesce(detalle, '') not like '%QA472%')
     from public.recorrido_de_informes_diseno(array[current_setting('prueba.r.informe')::uuid])),
  'ningún paso dice el nombre de la persona: solo su puesto');

-- 6. Lo lee quien ve el informe; Recursos Humanos no.
select test.como_usuario(:'diseno_id');
select test.afirmar(
  (select count(*) = 5 from public.recorrido_de_informes_diseno(array[current_setting('prueba.r.informe')::uuid])),
  'Diseño lee el recorrido entero');
select test.como_usuario(:'super_id');
select test.afirmar(
  (select count(*) = 5 from public.recorrido_de_informes_diseno(array[current_setting('prueba.r.informe')::uuid])),
  'el Supervisor General también: ve el informe');
select test.como_usuario(:'rrhh_id');
select test.debe_fallar($$select * from public.recorrido_de_informes_diseno(array[current_setting('prueba.r.informe')::uuid])$$,
  'Recursos Humanos no lee el recorrido del informe', 'No tienes permiso');

-- 6b. Sin bitácora, la última vuelta sale de sus columnas.
reset role;
create temp table qa472_bitacora on commit drop as
  select * from public.audit_log where tabla = 'diseno_informes' and registro_id = current_setting('prueba.r.informe')::uuid;
delete from public.audit_log where tabla = 'diseno_informes' and registro_id = current_setting('prueba.r.informe')::uuid;
set local role authenticated;
select test.como_usuario(:'colab_id');
select test.afirmar(
  (select string_agg(paso || ':' || situacion || ':' || coalesce(puesto, '-'), ' > ' order by orden)
     from public.recorrido_de_informes_diseno(array[current_setting('prueba.r.informe')::uuid]))
  = 'REGISTRO:HECHO:' || public.puesto_de(:'colab_id'::uuid)
    || ' > ENVIO:HECHO:' || public.puesto_de(:'colab_id'::uuid)
    || ' > APROBACION:HECHO:' || (select nombre from public.roles where codigo = 'DISENO'),
  'sin bitácora quedan el envío y la aprobación de sus columnas, con el puesto de cada uno');
reset role;
insert into public.audit_log select * from qa472_bitacora;
set local role authenticated;

-- 7. Las semanas del colaborador.
select test.como_usuario(:'colab_id');
select test.afirmar(
  (select count(*) = 1 from public.informes_de_diseno_propios() where id = current_setting('prueba.r.informe')::uuid),
  'el colaborador ve su semana en «Tus semanas»');
select test.como_usuario(:'colab2_id');
select test.afirmar(
  (select count(*) = 0 from public.informes_de_diseno_propios() where id = current_setting('prueba.r.informe')::uuid),
  'otro colaborador no la ve en las suyas: no la empezó ni anotó nada en ella');

reset role;
select 'OK: recorrido del informe con sus vueltas y motivos, aviso con motivo, solo para quien ve el informe, y las semanas propias. Ensayo revertido.' as comprobacion;
rollback;
