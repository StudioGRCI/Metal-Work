-- El trabajo del colaborador de Diseño reunido por OT (migración 20261126320000).
--
--   1. Por cada OT de su equipo salen sus actividades de todas las semanas, con
--      día y tipo, con el código interno y si es CM o SR, sin leer `unidades`.
--   2. Solo las suyas: las de otro colaborador en la misma OT no salen, y al
--      otro no le salen las del primero.
--   3. Una fila por OT. La abierta de su equipo sin actividades sale vacía; la
--      terminada o la anulada sale solo si anotó algo en ella.
--   4. Una semana enviada no cambia lo que se ve: es lo guardado.
--   5. Quien no llena el informe no la lee (Recursos Humanos, Diseño), y un
--      puesto que lo llena sin poder leer las actividades recibe un error, no
--      una tarjeta vacía que diga que no anotó nada.
--   6. Todo puesto que llena el informe puede leer sus actividades.
--
-- Cada lectura con la cuenta del puesto —nunca ADMIN— y `set local role
-- authenticated`. Termina en rollback.
\set ON_ERROR_STOP on
begin;

select id as sede_id from public.sedes order by nombre limit 1 \gset
select test.crear_usuario('QA473','Colaborador','qa-473-colab@demo.pe','DISENO_COLABORADOR', :'sede_id') as colab_id \gset
select test.crear_usuario('QA473','Otro colaborador','qa-473-colab2@demo.pe','DISENO_COLABORADOR', :'sede_id') as colab2_id \gset
select test.crear_usuario('QA473','Diseño','qa-473-diseno@demo.pe','DISENO', :'sede_id') as diseno_id \gset
select test.crear_usuario('QA473','Personal','qa-473-rrhh@demo.pe','RECURSOS_HUMANOS', :'sede_id') as rrhh_id \gset

select set_config('prueba.t.colab', :'colab_id', true), set_config('prueba.t.colab2', :'colab2_id', true);

do $ids$
declare v text;
begin
  foreach v in array array['ot_a', 'ot_b', 'ot_terminada', 'ot_terminada_mia', 'ot_anulada', 'ot_sin_equipo', 'per_a', 'per_b', 'per_t', 'per_tm', 'per_n'] loop
    perform set_config('prueba.t.' || v, gen_random_uuid()::text, true);
  end loop;
end $ids$;

-- Armazón: cinco OT con su unidad, sin pasar por las reglas de esas tablas.
set local session_replication_role = replica;
do $armazon$
declare
  v_cliente uuid := gen_random_uuid();
  v_sede uuid := (select id from public.sedes order by nombre limit 1);
  v record;
begin
  insert into public.clientes (id, tipo_documento, numero_documento, razon_social)
  values (v_cliente, 'RUC', '20990000473', 'QA TRABAJO POR OT');
  for v in select * from (values
      ('ot_a', 'QXA-473', '9473-2099', 'QA_CM_N2_1_26/73', 'CARROCERIA_MONTADA', 'EN_PROCESO'),
      ('ot_b', 'QXB-474', '9474-2099', 'QA_SR_N3_1_26/74', 'SEMIRREMOLQUE', 'EN_PROCESO'),
      ('ot_terminada', 'QXC-475', '9475-2099', 'QA_CM_N2_1_26/75', 'CARROCERIA_MONTADA', 'TERMINADA'),
      ('ot_terminada_mia', 'QXF-478', '9478-2099', 'QA_CM_N2_1_26/78', 'CARROCERIA_MONTADA', 'TERMINADA'),
      ('ot_anulada', 'QXD-476', '9476-2099', 'QA_CM_N2_1_26/76', 'CARROCERIA_MONTADA', 'ANULADA'),
      ('ot_sin_equipo', 'QXE-477', '9477-2099', 'QA_CM_N2_1_26/77', 'CARROCERIA_MONTADA', 'EN_PROCESO')
    ) x(clave, placa, numero, codigo, tipo, estado) loop
    insert into public.unidades (id, cliente_id, placa, codigo_interno, tipo_vehiculo, marca, modelo)
    values (gen_random_uuid(), v_cliente, v.placa, v.codigo, 'CAMION', 'Volvo', 'FMX');
    insert into public.ordenes_trabajo (id, numero, cliente_id, sede_id, unidad_id, tipo_unidad, tipo_trabajo, prioridad,
                                        descripcion, estado, motivo_anulacion, fecha_registro)
    values (current_setting('prueba.t.' || v.clave)::uuid, v.numero, v_cliente, v_sede,
            (select id from public.unidades where codigo_interno = v.codigo), v.tipo::public.tipo_unidad_carroceria, 'FABRICACION', 'NORMAL',
            'Orden QA del trabajo por OT', v.estado::public.estado_ot,
            case when v.estado = 'ANULADA' then 'Anulada en la prueba 473' end, current_date);
  end loop;
  insert into public.ot_equipo_diseno (id, orden_id, nombre, funcion) values
    (current_setting('prueba.t.per_a')::uuid, current_setting('prueba.t.ot_a')::uuid, 'Persona A QA473', 'COLABORADOR'),
    (current_setting('prueba.t.per_b')::uuid, current_setting('prueba.t.ot_b')::uuid, 'Persona B QA473', 'COLABORADOR'),
    (current_setting('prueba.t.per_t')::uuid, current_setting('prueba.t.ot_terminada')::uuid, 'Persona T QA473', 'COLABORADOR'),
    (current_setting('prueba.t.per_tm')::uuid, current_setting('prueba.t.ot_terminada_mia')::uuid, 'Persona TM QA473', 'COLABORADOR'),
    (current_setting('prueba.t.per_n')::uuid, current_setting('prueba.t.ot_anulada')::uuid, 'Persona N QA473', 'COLABORADOR');
  -- Lo anotado en semanas pasadas, por cada colaborador.
  insert into public.diseno_tareas (orden_id, integrante_id, tipo, componente, fecha_inicio, fecha_entrega, creado_por) values
    (current_setting('prueba.t.ot_a')::uuid, current_setting('prueba.t.per_a')::uuid, 'MODELADO_3D', 'Tolva', '2099-03-02', '2099-03-02', current_setting('prueba.t.colab')::uuid),
    (current_setting('prueba.t.ot_a')::uuid, current_setting('prueba.t.per_a')::uuid, 'PLOTEO', 'Tolva', '2099-03-10', '2099-03-10', current_setting('prueba.t.colab')::uuid),
    (current_setting('prueba.t.ot_terminada_mia')::uuid, current_setting('prueba.t.per_tm')::uuid, 'PLOTEO', 'En la terminada', '2099-02-20', '2099-02-20', current_setting('prueba.t.colab')::uuid),
    (current_setting('prueba.t.ot_a')::uuid, current_setting('prueba.t.per_a')::uuid, 'PLANO_CORTE_DXF', 'Del otro colaborador', '2099-03-11', '2099-03-11', current_setting('prueba.t.colab2')::uuid),
    (current_setting('prueba.t.ot_anulada')::uuid, current_setting('prueba.t.per_n')::uuid, 'PLOTEO', 'En la anulada', '2099-03-03', '2099-03-03', current_setting('prueba.t.colab')::uuid);
end;
$armazon$;
set local session_replication_role = origin;

set local role authenticated;

-- 1 y 2. El colaborador ve sus actividades por OT, con día, tipo y código.
select test.como_usuario(:'colab_id');
select test.afirmar(
  (select string_agg((a ->> 'tipo') || '@' || (a ->> 'fecha_inicio'), ' ' order by o)
     from public.trabajo_de_diseno_por_ot() w cross join lateral jsonb_array_elements(w.actividades) with ordinality x(a, o)
    where w.orden_id = current_setting('prueba.t.ot_a')::uuid)
  = 'PLOTEO@2099-03-10 MODELADO_3D@2099-03-02',
  'en la OT A salen sus dos actividades de semanas distintas, con día y tipo, de la más reciente a la más antigua');
select test.afirmar(
  (select count(*) = count(distinct orden_id) from public.trabajo_de_diseno_por_ot()),
  'una fila por OT: la respuesta no crece con las actividades');
select test.afirmar(
  (select bool_and(codigo_interno = 'QA_CM_N2_1_26/73' and tipo_unidad = 'CARROCERIA_MONTADA' and numero = '9473-2099'
                   and a ->> 'integrante' = 'Persona A QA473' and ultima = '2099-03-10')
     from public.trabajo_de_diseno_por_ot() w cross join lateral jsonb_array_elements(w.actividades) a where w.orden_id = current_setting('prueba.t.ot_a')::uuid),
  'cada actividad lleva el código interno, si es CM o SR y a nombre de quién del equipo');
select test.afirmar(
  (select count(*) = 0 from public.trabajo_de_diseno_por_ot() w cross join lateral jsonb_array_elements(w.actividades) a where a ->> 'componente' = 'Del otro colaborador'),
  'la actividad que anotó otro colaborador en la misma OT no le sale');
select test.afirmar(
  (select count(*) = 0 from public.unidades),
  'y no lee la tabla de unidades');

-- 3. La OT abierta sin actividades sale vacía; la terminada o la anulada, solo con actividades suyas.
select test.afirmar(
  (select count(*) = 1 and bool_and(actividades = '[]'::jsonb) and bool_and(tipo_unidad = 'SEMIRREMOLQUE') and bool_and(ultima is null)
     from public.trabajo_de_diseno_por_ot() where orden_id = current_setting('prueba.t.ot_b')::uuid),
  'la OT abierta de su equipo sin actividades sale vacía');
select test.afirmar(
  (select count(*) = 1 from public.trabajo_de_diseno_por_ot() w cross join lateral jsonb_array_elements(w.actividades) a
    where w.orden_id = current_setting('prueba.t.ot_terminada_mia')::uuid and a ->> 'componente' = 'En la terminada'),
  'la OT terminada donde anotó algo sale con su actividad');
select test.afirmar(
  (select count(*) = 1 from public.trabajo_de_diseno_por_ot() w cross join lateral jsonb_array_elements(w.actividades) a
    where w.orden_id = current_setting('prueba.t.ot_anulada')::uuid and w.estado_ot = 'ANULADA'),
  'la anulada donde anotó algo también: lo que hizo no se pierde');
select test.afirmar(
  (select count(*) = 0 from public.trabajo_de_diseno_por_ot()
    where orden_id in (current_setting('prueba.t.ot_terminada')::uuid, current_setting('prueba.t.ot_sin_equipo')::uuid)),
  'no salen la terminada sin actividades suyas ni la OT sin colaboradores de Diseño');

-- 2. El otro colaborador ve solo lo suyo.
select test.como_usuario(:'colab2_id');
select test.afirmar(
  (select string_agg(a ->> 'componente', ',') = 'Del otro colaborador'
     from public.trabajo_de_diseno_por_ot() w cross join lateral jsonb_array_elements(w.actividades) a),
  'el otro colaborador ve solo su actividad, no las del primero');

-- 4. Enviada la semana, lo que se ve es lo guardado.
select test.como_usuario(:'colab_id');
insert into public.diseno_informes (semana_inicio, responsable, resumen, creado_por, actualizado_por)
values ('2099-03-09', 'Persona A QA473', 'Resumen de la semana de prueba 473', public.usuario_actual(), public.usuario_actual());
select public.transitar_informe_diseno((select id from public.diseno_informes where semana_inicio = '2099-03-09'), 'EN_REVISION');
select test.afirmar(
  (select jsonb_array_length(actividades) = 2 from public.trabajo_de_diseno_por_ot() where orden_id = current_setting('prueba.t.ot_a')::uuid),
  'con la semana enviada sigue viendo las mismas actividades');

-- 5. Quien no llena el informe no la lee.
select test.como_usuario(:'rrhh_id');
select test.debe_fallar($$select * from public.trabajo_de_diseno_por_ot()$$,
  'Recursos Humanos no lee el trabajo por OT', 'Solo quien llena el informe');
select test.como_usuario(:'diseno_id');
select test.debe_fallar($$select * from public.trabajo_de_diseno_por_ot()$$,
  'Diseño tampoco: no llena el informe', 'Solo quien llena el informe');

-- 5. Un puesto que llena el informe sin poder leer las actividades: error, no vacío.
reset role;
insert into public.roles (codigo, nombre) values ('QA473_SOLO_INFORME', 'QA473 solo informe');
insert into public.roles_permisos (rol_id, permiso_codigo)
select id, 'diseno.preparar_informe' from public.roles where codigo = 'QA473_SOLO_INFORME';
select test.crear_usuario('QA473','Solo informe','qa-473-solo@demo.pe','QA473_SOLO_INFORME', :'sede_id') as solo_id \gset
set local role authenticated;
select test.como_usuario(:'solo_id');
select test.debe_fallar($$select * from public.trabajo_de_diseno_por_ot()$$,
  'quien llena el informe sin poder leer las actividades recibe un error, no «no anotaste nada»', 'no puede leer sus actividades');

-- 6. Hoy, todo puesto que llena el informe puede leer sus actividades.
reset role;
select test.afirmar(
  (select count(*) = 0 from public.roles r
    where r.codigo <> 'QA473_SOLO_INFORME'
      and exists (select 1 from public.roles_permisos rp where rp.rol_id = r.id and rp.permiso_codigo = 'diseno.preparar_informe')
      and not exists (select 1 from public.roles_permisos rp where rp.rol_id = r.id
                       and rp.permiso_codigo in ('diseno.planos', 'diseno.subir_pdf', 'supervision.general', 'diseno.ver_informes'))
      or (exists (select 1 from public.roles_permisos rp where rp.rol_id = r.id and rp.permiso_codigo = 'diseno.preparar_informe')
          and not exists (select 1 from public.roles_permisos rp where rp.rol_id = r.id and rp.permiso_codigo = 'ordenes.ver')
          and r.codigo <> 'QA473_SOLO_INFORME')),
  'todo puesto con diseno.preparar_informe tiene también un permiso que lee diseno_tareas y ordenes.ver');

select 'OK: el trabajo del colaborador por OT, solo lo suyo y de su equipo, sin leer unidades. Ensayo revertido.' as comprobacion;
rollback;
