\set ON_ERROR_STOP on
-- Los reportes de las tareas del taller dentro de la OT los revisa quien tiene
-- `produccion.aprobar_reportes`, también en el flujo nuevo.
--
-- Hasta el 2026-10-26 los revisaba Administración. DKS decidió ese día que no:
-- la OT de una cotización se sigue por su código interno y los reportes del
-- taller van por Supervisión (migración 20261026160000, que le cambió
-- `produccion.aprobar_reportes` por `produccion.aprobar_sin_orden`). Hoy solo
-- tienen el permiso el Jefe de producción y el Jefe de maestranza, puestos que
-- ya no admiten cuentas («Las jefaturas de taller fueron reemplazadas por
-- Supervisión»), y el supervisor reporta por código en su reporte diario. El
-- circuito de las tareas sigue en la base: como con `ordenes.ver` más abajo, la
-- prueba le presta el permiso a un puesto que no ve la hoja (Contabilidad)
-- solo mientras dure, para seguir cuidando los dos candados, y comprueba que
-- Administración ya no ve la hoja ni la aprueba.
--
-- Cuando Administración tenía el permiso, dos candados se lo negaban sin que
-- nada avisara:
--   · la lectura: `puede_ver_hoja_de_area` no la contaba, y una tarea que el RLS
--     esconde no se ve ni se aprueba —el UPDATE tocaba cero filas—;
--   · el disparador del taller: en una OT del flujo nuevo, aprobar contestaba
--     «El reporte de la tarea corresponde al supervisor» (hoy, «No tienes permiso para
--     registrar ni corregir el reporte de la tarea»).
-- Aquí, con los roles reales: quien tiene el permiso ve la tarea y el reporte, lo
-- observa y lo aprueba, pero no lo corrige; el supervisor no se aprueba solo y
-- su corrección sin foto sigue rechazada; Administración y Tesorería no ven la
-- hoja, y lo que Administración intente aprobar no toca ninguna fila.
begin;

select test.crear_usuario('QA','Admin','qa-323-admin@demo.pe','ADMIN',
  (select id from public.sedes order by nombre limit 1)) as admin_id \gset
select test.crear_usuario('QA','Diseño','qa-323-diseno@demo.pe','DISENO',
  (select id from public.sedes order by nombre limit 1)) as diseno_id \gset
select test.crear_usuario('QA','Producción','qa-323-produccion@demo.pe','SUPERVISOR',
  (select id from public.sedes order by nombre limit 1)) as supervisor_id \gset
select test.crear_usuario('QA','Administración','qa-323-administracion@demo.pe','ADMINISTRACION',
  (select id from public.sedes order by nombre limit 1)) as administracion_id \gset
select test.crear_usuario('QA','Tesorería','qa-323-tesoreria@demo.pe','TESORERIA',
  (select id from public.sedes order by nombre limit 1)) as tesoreria_id \gset
select test.crear_usuario('QA','Revisor','qa-323-revisor@demo.pe','CONTABILIDAD',
  (select id from public.sedes order by nombre limit 1)) as jefe_id \gset
select gen_random_uuid() as orden_id \gset
select gen_random_uuid() as etapa_id \gset

-- El área decide de quién es cada hoja; la pone ADMIN (trigger de personal).
-- Producción admite una sola cuenta de Supervisión: si la base ya trae una, se
-- aparta mientras dure la prueba.
select test.como_usuario(:'admin_id');
update public.usuarios u set activo = false
  from public.roles r
 where r.id = u.rol_id and r.codigo = 'SUPERVISOR' and u.activo
   and u.area_id = (select id from public.areas where codigo = 'PRD');
update public.usuarios set area_id = (select id from public.areas where codigo = 'PRD')
 where id = :'supervisor_id';

-- Desde la migración 20261016120000 el supervisor ya no lee la OT ni le crea
-- tareas con foto: reporta por código en su reporte diario. El circuito de las
-- tareas sigue en la base, y la prueba le devuelve el permiso solo mientras
-- dure, para seguir cuidándolo.
insert into public.roles_permisos (rol_id, permiso_codigo)
select id, 'ordenes.ver' from public.roles where codigo = 'SUPERVISOR'
on conflict do nothing;

-- El revisor de la prueba: Contabilidad, con `produccion.aprobar_reportes`
-- prestado mientras dure la transacción.
insert into public.roles_permisos (rol_id, permiso_codigo)
select id, 'produccion.aprobar_reportes' from public.roles where codigo = 'CONTABILIDAD'
on conflict do nothing;

insert into public.clientes(tipo_documento,numero_documento,razon_social)
values ('RUC','20990000323','QA Administración revisa la hoja');
insert into public.ordenes_trabajo(id,numero,cliente_id,sede_id,tipo_trabajo,
  prioridad,descripcion,estado)
select :'orden_id','9323-2099',c.id,s.id,'FABRICACION','NORMAL',
  'Orden QA de la revisión de Administración','APROBADA'
from public.clientes c cross join public.sedes s
where c.numero_documento='20990000323' order by s.nombre limit 1;

-- La foto de evidencia ya subida: el reporte exige que exista.
insert into storage.objects(bucket_id, name, owner_id, metadata)
values ('fotos-avance', 'ot/' || :'orden_id' || '/taller/qa-323.jpg',
        :'supervisor_id', '{"mimetype":"image/jpeg","size":100}'::jsonb);

select set_config('prueba.ar.orden', :'orden_id', true);
select set_config('prueba.ar.etapa', :'etapa_id', true);
select set_config('prueba.ar.diseno', :'diseno_id', true);
select set_config('prueba.ar.supervisor', :'supervisor_id', true);
select set_config('prueba.ar.administracion', :'administracion_id', true);
select set_config('prueba.ar.tesoreria', :'tesoreria_id', true);
select set_config('prueba.ar.jefe', :'jefe_id', true);

do $test$
declare
  v_orden uuid := current_setting('prueba.ar.orden')::uuid;
  v_etapa uuid := current_setting('prueba.ar.etapa')::uuid;
  v_prd uuid := (select id from public.areas where codigo = 'PRD');
  v_tarea uuid;
  v_reporte uuid;
  n integer;
  r record;
begin
  -- Diseño define la etapa; Supervisión de Producción arma su tarea y reporta.
  perform test.como_usuario(current_setting('prueba.ar.diseno')::uuid);
  set local role authenticated;
  perform public.guardar_etapas_libres(v_orden, jsonb_build_array(
    jsonb_build_object('id', v_etapa, 'nombre', 'Armado y soldadura', 'area_id', v_prd, 'peso_pct', 100)), null);
  reset role;

  perform test.como_usuario(current_setting('prueba.ar.supervisor')::uuid);
  set local role authenticated;
  insert into public.ot_actividades (orden_id, area_id, etapa_id, orden_secuencia, nombre, peso_pct)
  values (v_orden, v_prd, v_etapa, 1, 'Bastidor QA', 100) returning id into v_tarea;
  insert into public.ot_actividad_avances (actividad_id, orden_id, fecha, avance_pct, nota, foto_ruta)
  values (v_tarea, v_orden, current_date, 40, 'Bastidor punteado',
          'ot/' || v_orden || '/taller/qa-323.jpg') returning id into v_reporte;
  reset role;

  -- El supervisor no se revisa solo.
  perform test.como_usuario(current_setting('prueba.ar.supervisor')::uuid);
  set local role authenticated;
  begin
    update public.ot_actividad_avances set revision = 'APROBADO' where id = v_reporte;
    raise exception 'FALLO: el supervisor aprobó su propio reporte';
  exception when others then
    if sqlerrm not like 'No tienes permiso para revisar estos reportes%' then raise; end if;
  end;
  reset role;

  -- Administración ya no revisa la hoja del taller (2026-10-26): no la ve, y
  -- aprobar desde ella no toca ninguna fila.
  perform test.como_usuario(current_setting('prueba.ar.administracion')::uuid);
  set local role authenticated;
  if (select count(*) from public.ot_actividades where id = v_tarea) <> 0
     or (select count(*) from public.ot_actividad_avances where id = v_reporte) <> 0 then
    raise exception 'FALLO: Administración todavía ve la hoja del taller';
  end if;
  update public.ot_actividad_avances set revision = 'APROBADO' where id = v_reporte;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALLO: Administración aprobó % reportes del taller', n; end if;
  reset role;
  if (select revision from public.ot_actividad_avances where id = v_reporte) <> 'PENDIENTE' then
    raise exception 'FALLO: el reporte dejó de estar pendiente sin que lo revisara quien tiene el permiso';
  end if;

  -- El revisor ve la tarea y el reporte.
  perform test.como_usuario(current_setting('prueba.ar.jefe')::uuid);
  set local role authenticated;
  if (select count(*) from public.ot_actividades where id = v_tarea) <> 1
     or (select count(*) from public.ot_actividad_avances where id = v_reporte) <> 1 then
    raise exception 'FALLO: el revisor no ve la tarea o el reporte que tiene que revisar';
  end if;

  -- Lo observa: una fila.
  update public.ot_actividad_avances set revision = 'OBSERVADO', observacion = 'Falta la foto del cordón'
   where id = v_reporte;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FALLO: observar tocó % filas, debía tocar 1', n; end if;

  -- Pero no corrige lo que reportó el supervisor.
  begin
    update public.ot_actividad_avances set nota = 'Corregida por el revisor' where id = v_reporte;
    raise exception 'FALLO: el revisor corrigió la nota del reporte del supervisor';
  exception when others then
    if sqlerrm not like 'No tienes permiso para registrar ni corregir el reporte de la tarea%' then raise; end if;
  end;
  reset role;

  -- El supervisor corrige lo observado, y la corrección sigue pidiendo la foto.
  perform test.como_usuario(current_setting('prueba.ar.supervisor')::uuid);
  set local role authenticated;
  begin
    update public.ot_actividad_avances set foto_ruta = null where id = v_reporte;
    raise exception 'FALLO: el reporte de la tarea quedó sin foto';
  exception when others then
    if sqlerrm not like 'Adjunta una foto%' then raise; end if;
  end;
  reset role;

  -- El revisor lo aprueba: una fila, a su nombre.
  perform test.como_usuario(current_setting('prueba.ar.jefe')::uuid);
  set local role authenticated;
  update public.ot_actividad_avances set revision = 'APROBADO' where id = v_reporte;
  get diagnostics n = row_count;
  select revision, revisado_por into r from public.ot_actividad_avances where id = v_reporte;
  if n <> 1 or r.revision <> 'APROBADO'
     or r.revisado_por is distinct from current_setting('prueba.ar.jefe')::uuid then
    raise exception 'FALLO: aprobar tocó % filas y dejó % por %', n, r.revision, r.revisado_por;
  end if;
  reset role;

  -- Tesorería no aprueba ni produce: no ve la hoja.
  perform test.como_usuario(current_setting('prueba.ar.tesoreria')::uuid);
  set local role authenticated;
  if (select count(*) from public.ot_actividades where id = v_tarea) <> 0
     or (select count(*) from public.ot_actividad_avances where id = v_reporte) <> 0 then
    raise exception 'FALLO: Tesorería ve la hoja del taller';
  end if;
  reset role;

  raise notice '  ok · quien tiene produccion.aprobar_reportes ve, observa y aprueba el reporte del flujo nuevo, sin corregirlo; Administración ya no ve la hoja';
end;
$test$;

rollback;
