\set ON_ERROR_STOP on
-- El costo de la OT lo cierra quien lo ve (migración 20261128100000).
--
-- Dos OT terminadas, con un gasto aprobado de S/ 500 cada una. Requerimientos
-- tiene `costos.controlar_ot` y no `costos.ver`: recibe el aviso de la puerta
-- («No tienes permiso para cerrar el costo de la OT.») y no el rechazo del
-- cálculo («No tiene el permiso costos.ver…»), y no queda ningún cierre.
-- Costos y Materiales cierra una y Administración la otra. El Jefe de Taller
-- (`ordenes.editar` sin `costos.ver`) cae por la misma puerta, pero su puesto ya
-- no admite cuentas nuevas (lo reemplazó Supervisión): esa rama se prueba con un
-- puesto de prueba que solo tiene `ordenes.ver` y `ordenes.editar`, y que se
-- va con el rollback. Gerencia ve el costo pero no lo controla: tampoco cierra.
--
-- La bitácora de la OT la lee todo el que ve la OT, así que el evento del
-- cierre no lleva el monto (migración 20261128101000): la cifra queda en
-- `ot_cierres_costo`, que Costos relee con su propio rol.
--
-- Los permisos que se prueban se leen del catálogo: si mañana Requerimientos
-- recibe `costos.ver`, este check lo dice en vez de pasar en falso.
begin;

select id as sede_id from public.sedes order by nombre limit 1 \gset
select test.crear_usuario('QA','Requerimientos','qa-506-req@demo.pe','REQUERIMIENTOS', :'sede_id') as req_id \gset
insert into public.roles (codigo, nombre, descripcion, nivel)
values ('QA_506_EDITA', 'QA edita sin ver el costo', 'Puesto de prueba del check 506', 1);
insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, p from public.roles r, unnest(array['ordenes.ver', 'ordenes.editar']) as p where r.codigo = 'QA_506_EDITA';
select test.crear_usuario('QA','Edita','qa-506-edita@demo.pe','QA_506_EDITA', :'sede_id') as edita_id \gset
select test.crear_usuario('QA','Gerencia','qa-506-gerencia@demo.pe','GERENTE', :'sede_id') as gerencia_id \gset
select test.crear_usuario('QA','Costos','qa-506-costos@demo.pe','COSTOS_MATERIALES', :'sede_id') as costos_id \gset
select test.crear_usuario('QA','Oficina','qa-506-oficina@demo.pe','ADMINISTRACION', :'sede_id') as oficina_id \gset

select set_config('prueba.c.req', :'req_id', true);
select set_config('prueba.c.edita', :'edita_id', true);
select set_config('prueba.c.gerencia', :'gerencia_id', true);
select set_config('prueba.c.costos', :'costos_id', true);
select set_config('prueba.c.oficina', :'oficina_id', true);
select set_config('prueba.c.orden_a', gen_random_uuid()::text, true);
select set_config('prueba.c.orden_b', gen_random_uuid()::text, true);

-- Lo que se prueba depende de estos permisos: si cambian, el check lo dice.
do $catalogo$
declare
  v_sql constant text := 'select exists (select 1 from public.roles r join public.roles_permisos rp on rp.rol_id = r.id where r.codigo = $1 and rp.permiso_codigo = $2)';
  v boolean;
begin
  execute v_sql into v using 'REQUERIMIENTOS', 'costos.controlar_ot';
  perform test.afirmar(v, 'Requerimientos tiene costos.controlar_ot');
  execute v_sql into v using 'REQUERIMIENTOS', 'costos.ver';
  perform test.afirmar(not v, 'Requerimientos no tiene costos.ver');
end;
$catalogo$;

select test.como_usuario(:'costos_id');
set local session_replication_role = replica;

do $armazon$
declare
  v_a uuid := current_setting('prueba.c.orden_a')::uuid;
  v_b uuid := current_setting('prueba.c.orden_b')::uuid;
  v_quien uuid := current_setting('prueba.c.costos')::uuid;
  v_cliente uuid := gen_random_uuid();
  v_mtz uuid := (select id from public.areas where codigo = 'MTZ');
  v_sede uuid := (select id from public.sedes order by nombre limit 1);
begin
  insert into public.clientes (id, tipo_documento, numero_documento, razon_social)
  values (v_cliente, 'RUC', '20990000506', 'QA CIERRE DEL COSTO');

  insert into public.ordenes_trabajo (id, numero, cliente_id, sede_id, tipo_trabajo, prioridad, descripcion, estado, fecha_registro)
  values (v_a, '9506-2099', v_cliente, v_sede, 'FABRICACION', 'NORMAL', 'ORDEN QA DEL CIERRE A', 'TERMINADA', current_date),
         (v_b, '9507-2099', v_cliente, v_sede, 'FABRICACION', 'NORMAL', 'ORDEN QA DEL CIERRE B', 'TERMINADA', current_date);

  insert into public.ot_gastos_areas (id, orden_id, area_id, tipo, descripcion, fecha, monto, moneda, comprobante_ruta, comprobante_nombre, estado, revisado_por, revisado_en)
  select g.id, g.o, v_mtz, 'SERVICIO', 'Servicio QA del cierre', current_date, 500, 'PEN',
         'ot/' || g.o || '/gastos/' || g.id || '.pdf', 'F-QA-506.pdf', 'APROBADO', v_quien, now()
    from (select gen_random_uuid() as id, o from unnest(array[v_a, v_b]) as o) g;
end;
$armazon$;

set local session_replication_role = origin;

do $test$
declare
  v_a uuid := current_setting('prueba.c.orden_a')::uuid;
  v_b uuid := current_setting('prueba.c.orden_b')::uuid;
  v_quien text;
  v_msj text;
  v_n integer;
begin
  -- Quien controla o edita pero no ve el costo recibe el aviso de la puerta,
  -- no el rechazo del cálculo.
  foreach v_quien in array array['req', 'edita', 'gerencia'] loop
    perform test.como_usuario(current_setting('prueba.c.' || v_quien)::uuid);
    set local role authenticated;
    v_msj := null;
    begin
      perform public.cerrar_costo_ot(v_a, 'Cierre QA que no debe entrar');
    exception when others then
      v_msj := sqlerrm;
    end;
    reset role;
    perform test.afirmar(v_msj = 'No tienes permiso para cerrar el costo de la OT.',
      format('%s no cierra el costo y recibe el aviso de la puerta (dio: %s)', v_quien, coalesce(v_msj, 'lo cerró')));
  end loop;

  select count(*) into v_n from public.ot_cierres_costo where orden_id in (v_a, v_b);
  perform test.afirmar(v_n = 0, 'no quedó ningún cierre de quien no ve el costo');

  -- Costos y Materiales y Administración ven el costo y lo cierran.
  perform test.como_usuario(current_setting('prueba.c.costos')::uuid);
  set local role authenticated;
  perform public.cerrar_costo_ot(v_a, 'Cierre QA de Costos');
  -- Lo relee con su rol, como la pantalla después de cerrar.
  select count(*) into v_n from public.ot_cierres_costo where orden_id = v_a and costo_pen = 500;
  reset role;
  perform test.afirmar(v_n = 1, format('Costos relee su cierre con su rol (vio %s)', v_n));

  perform test.como_usuario(current_setting('prueba.c.oficina')::uuid);
  set local role authenticated;
  perform public.cerrar_costo_ot(v_b, 'Cierre QA de Administración');
  reset role;

  select count(*) into v_n from public.ot_cierres_costo
   where (orden_id = v_a and cerrado_por = current_setting('prueba.c.costos')::uuid and costo_pen = 500)
      or (orden_id = v_b and cerrado_por = current_setting('prueba.c.oficina')::uuid and costo_pen = 500);
  perform test.afirmar(v_n = 2, format('Costos y Administración cerraron cada una su OT en S/ 500 (quedaron %s)', v_n));

  -- La bitácora dice que se cerró, no en cuánto.
  select count(*) into v_n from public.ot_bitacora
   where orden_id in (v_a, v_b) and descripcion = 'Costo de la OT cerrado' and not (datos ? 'costo_pen');
  perform test.afirmar(v_n = 2, format('cada cierre deja su evento sin monto en la bitácora (quedaron %s)', v_n));
  select count(*) into v_n from public.ot_bitacora
   where orden_id in (v_a, v_b) and (descripcion like '%S/%' or datos ? 'costo_pen');
  perform test.afirmar(v_n = 0, format('ningún evento de la OT lleva la cifra del costo (hay %s)', v_n));
end;
$test$;

rollback;
