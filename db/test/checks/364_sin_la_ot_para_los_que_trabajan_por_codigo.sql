\set ON_ERROR_STOP on
-- Desde la migración 20261016120000 la base tampoco les da la OT a los cuatro
-- puestos que trabajan por código interno (decisión 15 de Gerencia: la OT es un
-- documento de Diseño). Con los roles reales y `set local role authenticated`:
--   · Supervisión de área, Supervisión general, Almacén y Requerimientos no
--     leen la OT, ni su resumen, ni sus etapas, y no tienen ningún permiso
--     `ordenes.*`;
--   · el supervisor ya no abre una OT desde el taller;
--   · Diseño sigue leyendo la OT, y Gerencia también.
-- Termina en rollback.
begin;

select test.crear_usuario('QA','Admin','qa-364-admin@demo.pe','ADMIN',
  (select id from public.sedes order by nombre limit 1)) as admin_id \gset
select test.crear_usuario('QA','Supervisión','qa-364-sup@demo.pe','SUPERVISOR',
  (select id from public.sedes order by nombre limit 1)) as sup_id \gset
select test.crear_usuario('QA','General','qa-364-general@demo.pe','SUPERVISOR_GENERAL',
  (select id from public.sedes order by nombre limit 1)) as general_id \gset
select test.crear_usuario('QA','Almacén','qa-364-almacen@demo.pe','ALMACENERO',
  (select id from public.sedes order by nombre limit 1)) as almacen_id \gset
select test.crear_usuario('QA','Requerimientos','qa-364-req@demo.pe','REQUERIMIENTOS',
  (select id from public.sedes order by nombre limit 1)) as req_id \gset
select test.crear_usuario('QA','Diseño','qa-364-diseno@demo.pe','DISENO',
  (select id from public.sedes order by nombre limit 1)) as diseno_id \gset
select test.crear_usuario('QA','Gerencia','qa-364-gerencia@demo.pe','GERENTE',
  (select id from public.sedes order by nombre limit 1)) as gerente_id \gset
select gen_random_uuid() as orden_id \gset

-- La OT de la prueba, como dueño.
select test.como_usuario(:'admin_id');
insert into public.clientes(tipo_documento,numero_documento,razon_social)
values ('RUC','20990000364','QA sin la OT por código');
insert into public.ordenes_trabajo(id,numero,cliente_id,sede_id,tipo_trabajo,
  prioridad,descripcion,estado)
select :'orden_id','9364-2099',c.id,s.id,'FABRICACION','NORMAL',
  'Orden QA de los puestos sin OT','APROBADA'
from public.clientes c cross join public.sedes s
where c.numero_documento='20990000364' order by s.nombre limit 1;

select set_config('prueba.orden', :'orden_id', true);
select set_config('prueba.sup', :'sup_id', true);
select set_config('prueba.general', :'general_id', true);
select set_config('prueba.almacen', :'almacen_id', true);
select set_config('prueba.req', :'req_id', true);
select set_config('prueba.diseno', :'diseno_id', true);
select set_config('prueba.gerente', :'gerente_id', true);

-- ===================================== 1. LOS CUATRO PUESTOS NO TIENEN LA OT
do $$
declare
  v_puesto text;
  v_id uuid;
begin
  perform test.afirmar(not exists (
    select 1 from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
     where r.codigo in ('SUPERVISOR', 'SUPERVISOR_GENERAL', 'ALMACENERO', 'REQUERIMIENTOS')
       and rp.permiso_codigo like 'ordenes.%'),
    'ninguno de los cuatro puestos tiene un permiso de la OT');

  foreach v_puesto in array array['sup', 'general', 'almacen', 'req'] loop
    v_id := current_setting('prueba.' || v_puesto)::uuid;
    perform test.como_usuario(v_id);
    set local role authenticated;
    perform test.afirmar(not public.puede_ver_orden(current_setting('prueba.orden')::uuid),
      format('%s no puede ver la OT', v_puesto));
    perform test.afirmar((select count(*) from public.ordenes_trabajo where id = current_setting('prueba.orden')::uuid) = 0,
      format('%s no lee la OT', v_puesto));
    perform test.afirmar((select count(*) from public.ot_resumen where id = current_setting('prueba.orden')::uuid) = 0,
      format('%s no lee su resumen', v_puesto));
    perform test.afirmar((select count(*) from public.ot_etapas where orden_id = current_setting('prueba.orden')::uuid) = 0,
      format('%s no lee sus etapas', v_puesto));
    reset role;
  end loop;
end $$;

-- ============================== 2. EL SUPERVISOR YA NO ABRE UNA OT DESDE EL TALLER
do $$
begin
  perform test.como_usuario(current_setting('prueba.sup')::uuid);
  set local role authenticated;
  perform test.debe_fallar(
    $q$select public.abrir_orden_del_taller('QA-364', 'CAMION', 'Marca', 'Modelo', 'Tolva de prueba', 'FABRICACION', 'NORMAL')$q$,
    'el supervisor no abre una OT desde el taller');
  reset role;
end $$;

-- ===================================== 3. DISEÑO Y GERENCIA SIGUEN LEYENDO LA OT
do $$
declare
  v_puesto text;
begin
  foreach v_puesto in array array['diseno', 'gerente'] loop
    perform test.como_usuario(current_setting('prueba.' || v_puesto)::uuid);
    set local role authenticated;
    perform test.afirmar((select count(*) from public.ordenes_trabajo where id = current_setting('prueba.orden')::uuid) = 1,
      format('%s sigue leyendo la OT', v_puesto));
    reset role;
  end loop;
end $$;

rollback;
