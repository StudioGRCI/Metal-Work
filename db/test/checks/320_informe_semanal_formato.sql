-- El informe semanal de Diseño con los datos del formato MW-IF-DI-01.
--
-- Una OT de carrocería montada con código interno QA_CM_N2_1_26/43 y su equipo
-- de Diseño (un colaborador y la responsable). El colaborador registra una
-- tarea del formato («creación de plano de corte DXF») y el avance de planos:
-- 8 planos y 8 piezas entregados a Maestranza y Producción. Ve el código y el
-- tipo de la OT; Recursos Humanos no. No se puede cargar una entrega
-- culminada sin decir a quién, ni fuera de su semana, ni a nombre de la
-- responsable. Corrige y quita lo suyo; otra cuenta no. Enviado el informe,
-- la copia lleva código, tipo y entregas, y la semana queda cerrada hasta que
-- Diseño lo devuelve. La serie de informes sigue en el 022 y no abre las
-- semanas que ya se hicieron en Word.
begin;

select id as sede_id from public.sedes order by nombre limit 1 \gset
select test.crear_usuario('QA','Colaborador','qa-320-colab@demo.pe','DISENO_COLABORADOR', :'sede_id') as colab_id \gset
select test.crear_usuario('QA','Otro colaborador','qa-320-colab2@demo.pe','DISENO_COLABORADOR', :'sede_id') as colab2_id \gset
select test.crear_usuario('QA','Diseño','qa-320-diseno@demo.pe','DISENO', :'sede_id') as diseno_id \gset
select test.crear_usuario('QA','Personal','qa-320-rrhh@demo.pe','RECURSOS_HUMANOS', :'sede_id') as rrhh_id \gset

select set_config('prueba.i.colab', :'colab_id', true);
select set_config('prueba.i.orden', gen_random_uuid()::text, true);
select set_config('prueba.i.persona', gen_random_uuid()::text, true);
select set_config('prueba.i.jefa', gen_random_uuid()::text, true);
select set_config('prueba.i.entrega', gen_random_uuid()::text, true);
select set_config('prueba.i.entrega2', gen_random_uuid()::text, true);
select set_config('prueba.i.informe', gen_random_uuid()::text, true);

-- Armazón: la OT con su unidad y el equipo de Diseño, sin pasar por las reglas
-- de esas tablas (tienen sus propios checks).
set local session_replication_role = replica;
do $armazon$
declare
  v_orden uuid := current_setting('prueba.i.orden')::uuid;
  v_cliente uuid := gen_random_uuid();
  v_unidad uuid := gen_random_uuid();
  v_sede uuid := (select id from public.sedes order by nombre limit 1);
begin
  insert into public.clientes (id, tipo_documento, numero_documento, razon_social)
  values (v_cliente, 'RUC', '20990000320', 'QA informe semanal');
  insert into public.unidades (id, cliente_id, placa, codigo_interno, tipo_vehiculo, marca, modelo)
  values (v_unidad, v_cliente, 'QAX-320', 'QA_CM_N2_1_26/43', 'CAMION', 'Volvo', 'FMX');
  insert into public.ordenes_trabajo (id, numero, cliente_id, sede_id, unidad_id, tipo_unidad, tipo_trabajo, prioridad,
                                      descripcion, estado, fecha_registro)
  values (v_orden, '9320-2099', v_cliente, v_sede, v_unidad, 'CARROCERIA_MONTADA', 'FABRICACION', 'NORMAL',
          'Orden QA del informe semanal', 'EN_PROCESO', current_date);
  insert into public.ot_equipo_diseno (id, orden_id, nombre, funcion) values
    (current_setting('prueba.i.persona')::uuid, v_orden, 'Persona QA', 'COLABORADOR'),
    (current_setting('prueba.i.jefa')::uuid, v_orden, 'Jefa QA', 'RESPONSABLE');
end;
$armazon$;
set local session_replication_role = origin;

set local role authenticated;

-- El colaborador ve el código interno y el tipo; Recursos Humanos no.
select test.como_usuario(:'colab_id');
select test.afirmar(
  (select codigo_interno = 'QA_CM_N2_1_26/43' and tipo_unidad = 'CARROCERIA_MONTADA' and numero = '9320-2099'
     from public.identificacion_ot_diseno(array[current_setting('prueba.i.orden')::uuid])),
  'el colaborador lee el código interno y que es carrocería montada');
select test.como_usuario(:'rrhh_id');
select test.afirmar(
  (select count(*) = 0 from public.identificacion_ot_diseno(array[current_setting('prueba.i.orden')::uuid])),
  'Recursos Humanos no lee la identificación de la OT');

-- Tareas del formato.
select test.como_usuario(:'colab_id');
insert into public.diseno_tareas (orden_id, integrante_id, tipo, componente, fecha_inicio, fecha_entrega, creado_por)
values (current_setting('prueba.i.orden')::uuid, current_setting('prueba.i.persona')::uuid, 'PLANO_CORTE_DXF',
        'Tolva granelera / vigas principales', '2099-01-05', '2099-01-06', public.usuario_actual());
select test.afirmar((select count(*) = 1 from public.diseno_tareas where tipo = 'PLANO_CORTE_DXF'), 'la tarea «plano de corte DXF» entra');
select test.debe_fallar($$insert into public.diseno_tareas (orden_id, integrante_id, tipo, componente, fecha_inicio, fecha_entrega, creado_por)
  values (current_setting('prueba.i.orden')::uuid, current_setting('prueba.i.persona')::uuid, 'INVENTADA', 'Algo', '2099-01-05', '2099-01-05', public.usuario_actual())$$,
  'un tipo de tarea fuera del formato no entra', 'diseno_tareas_tipo_check');

-- Avance de planos.
insert into public.diseno_entregas_planos (id, semana_inicio, orden_id, integrante_id, tipo_plano, n_planos, n_piezas,
                                           fecha_entrega, estado, entregado_a, creado_por)
values (current_setting('prueba.i.entrega')::uuid, '2099-01-05', current_setting('prueba.i.orden')::uuid,
        current_setting('prueba.i.persona')::uuid, 'HAB/ARM envolturas y tapas', 8, 8, '2099-01-06', 'CULMINADO',
        array['MTZ', 'PRD'], public.usuario_actual());
insert into public.diseno_entregas_planos (id, semana_inicio, orden_id, integrante_id, tipo_plano, n_planos, n_piezas,
                                           fecha_entrega, estado, entregado_a, creado_por)
values (current_setting('prueba.i.entrega2')::uuid, '2099-01-05', current_setting('prueba.i.orden')::uuid,
        current_setting('prueba.i.persona')::uuid, 'Plano cargado por error', 1, 1, null, 'EN_PROCESO', '{}', public.usuario_actual());
select test.debe_fallar($$insert into public.diseno_entregas_planos (semana_inicio, orden_id, integrante_id, tipo_plano, n_planos, estado, entregado_a, creado_por)
  values ('2099-01-05', current_setting('prueba.i.orden')::uuid, current_setting('prueba.i.persona')::uuid, 'Sin destino', 2, 'CULMINADO', '{}', public.usuario_actual())$$,
  'una entrega culminada dice a qué área se entregó', 'ck_diseno_entrega_culminada');
select test.debe_fallar($$insert into public.diseno_entregas_planos (semana_inicio, orden_id, integrante_id, tipo_plano, n_planos, fecha_entrega, estado, entregado_a, creado_por)
  values ('2099-01-05', current_setting('prueba.i.orden')::uuid, current_setting('prueba.i.persona')::uuid, 'Fuera de semana', 2, '2099-01-20', 'CULMINADO', array['MTZ'], public.usuario_actual())$$,
  'la fecha de entrega cae dentro de su semana', 'ck_diseno_entrega_fecha');
select test.debe_fallar($$insert into public.diseno_entregas_planos (semana_inicio, orden_id, integrante_id, tipo_plano, n_planos, estado, entregado_a, creado_por)
  values ('2099-01-05', current_setting('prueba.i.orden')::uuid, current_setting('prueba.i.jefa')::uuid, 'A nombre de la jefa', 2, 'CULMINADO', array['MTZ'], public.usuario_actual())$$,
  'el colaborador no carga entregas a nombre de la responsable');

update public.diseno_entregas_planos set n_piezas = 9 where id = current_setting('prueba.i.entrega')::uuid;
select test.afirmar((select n_piezas = 9 from public.diseno_entregas_planos where id = current_setting('prueba.i.entrega')::uuid),
  'el colaborador corrige su entrega');

-- Otra cuenta no toca lo ajeno; Recursos Humanos ni lo ve.
select test.como_usuario(:'colab2_id');
delete from public.diseno_entregas_planos where id = current_setting('prueba.i.entrega2')::uuid;
select test.como_usuario(:'colab_id');
select test.afirmar((select count(*) = 1 from public.diseno_entregas_planos where id = current_setting('prueba.i.entrega2')::uuid),
  'otro colaborador no borra la entrega ajena');
delete from public.diseno_entregas_planos where id = current_setting('prueba.i.entrega2')::uuid;
select test.afirmar((select count(*) = 0 from public.diseno_entregas_planos where id = current_setting('prueba.i.entrega2')::uuid),
  'el colaborador quita la entrega que cargó por error');
select test.como_usuario(:'rrhh_id');
select test.afirmar((select count(*) = 0 from public.diseno_entregas_planos), 'Recursos Humanos no ve el avance de planos');

-- La serie sigue la de papel.
select test.como_usuario(:'colab_id');
select test.debe_fallar($$insert into public.diseno_informes (semana_inicio, responsable, resumen, creado_por, actualizado_por)
  values ('2026-09-21', 'Persona QA', 'Semana ya hecha en Word', public.usuario_actual(), public.usuario_actual())$$,
  'las semanas hechas en Word no se abren en el sistema', 'en Word');
insert into public.diseno_informes (id, semana_inicio, responsable, resumen, creado_por, actualizado_por)
values (current_setting('prueba.i.informe')::uuid, '2099-01-05', 'Persona QA', 'Resumen de la semana de prueba',
        public.usuario_actual(), public.usuario_actual());
select test.afirmar((select numero >= 22 from public.diseno_informes where id = current_setting('prueba.i.informe')::uuid),
  'el informe sigue la serie de la empresa: del 022 en adelante');

-- Enviado: la copia lleva código, tipo y entregas, y la semana se cierra.
select public.transitar_informe_diseno(current_setting('prueba.i.informe')::uuid, 'EN_REVISION');
select test.afirmar(
  (select contenido_enviado->'entregas'->0->>'n_planos' = '8'
          and contenido_enviado->'entregas'->0->>'n_piezas' = '9'
          and contenido_enviado->'entregas'->0->>'codigo_interno' = 'QA_CM_N2_1_26/43'
          and contenido_enviado->'entregas'->0->>'tipo_unidad' = 'CARROCERIA_MONTADA'
          and contenido_enviado->'entregas'->0->'entregado_a' = '["MTZ", "PRD"]'::jsonb
          and contenido_enviado->'tareas'->0->>'tipo' = 'PLANO_CORTE_DXF'
          and contenido_enviado->'tareas'->0->>'codigo_interno' = 'QA_CM_N2_1_26/43'
          and jsonb_array_length(contenido_enviado->'entregas') = 1
     from public.diseno_informes where id = current_setting('prueba.i.informe')::uuid),
  'la copia enviada lleva las entregas, el código interno y el tipo');
select test.debe_fallar($$insert into public.diseno_tareas (orden_id, integrante_id, tipo, componente, fecha_inicio, fecha_entrega, creado_por)
  values (current_setting('prueba.i.orden')::uuid, current_setting('prueba.i.persona')::uuid, 'PLOTEO', 'Después de enviar', '2099-01-07', '2099-01-07', public.usuario_actual())$$,
  'enviada la semana, no entran tareas nuevas', 'ya se envió');
select test.debe_fallar($$delete from public.diseno_entregas_planos where id = current_setting('prueba.i.entrega')::uuid$$,
  'enviada la semana, no se quitan entregas', 'ya se envió');

-- Diseño lo devuelve y la semana se vuelve a abrir.
select test.como_usuario(:'diseno_id');
select public.transitar_informe_diseno(current_setting('prueba.i.informe')::uuid, 'OBSERVADO', 'Falta registrar el ploteo del miércoles.');
select test.como_usuario(:'colab_id');
insert into public.diseno_tareas (orden_id, integrante_id, tipo, componente, fecha_inicio, fecha_entrega, creado_por)
values (current_setting('prueba.i.orden')::uuid, current_setting('prueba.i.persona')::uuid, 'PLOTEO',
        'Ploteo del miércoles', '2099-01-07', '2099-01-07', public.usuario_actual());
select test.afirmar((select count(*) = 2 from public.diseno_tareas where orden_id = current_setting('prueba.i.orden')::uuid),
  'devuelto el informe, el colaborador completa lo que faltaba');

reset role;
select 'OK: tareas y avance de planos del formato, código interno y CM/SR, semana cerrada al enviar y serie desde el 022. Ensayo revertido.' as comprobacion;
rollback;
