-- Costeo con todas las manos (migración 20261001110000). Cada parte la pone su
-- responsable con su propio usuario, y nadie más puede: Almacén saca material a
-- la unidad, Logística le pone precio, Diseño la merma, RR. HH. la planilla,
-- Administración los gastos del mes y los trámites. Costos ve la suma, y el
-- resumen cuadra con el detalle. Todo se deshace con el rollback final.
begin;
-- Armazón: dos OT abiertas con unidad, un material sin solicitudes y las fotos.
select set_config('prueba.orden', (select o.id::text from public.ordenes_trabajo o
  where o.estado::text not in ('ANULADA','ENTREGADA','FACTURADA') and o.unidad_id is not null
    and (select count(*) from public.ordenes_trabajo x where x.unidad_id = o.unidad_id
          and x.estado::text not in ('ANULADA','ENTREGADA','FACTURADA')) = 1
  order by o.numero limit 1), true);
select set_config('prueba.otra', (select o.id::text from public.ordenes_trabajo o
  where o.estado::text not in ('ANULADA','ENTREGADA','FACTURADA') and o.id <> current_setting('prueba.orden')::uuid
  order by o.numero limit 1), true);
select set_config('prueba.unidad', (select unidad_id::text from public.ordenes_trabajo where id = current_setting('prueba.orden')::uuid), true);
select set_config('prueba.material', (select m.id::text from public.materiales m
  where m.activo and not m.unidad_pendiente
    and not exists (select 1 from public.ot_materiales om where om.material_id = m.id)
  order by m.codigo limit 1), true);
select set_config('prueba.salida', gen_random_uuid()::text, true);
select set_config('prueba.periodo', '2030-01-01', true);
select set_config('u.almacen', (select u.id::text from public.usuarios u join public.roles r on r.id = u.rol_id where r.codigo = 'ALMACENERO' and u.activo limit 1), true);
select set_config('u.logistica', (select u.id::text from public.usuarios u join public.roles r on r.id = u.rol_id where r.codigo = 'COMPRADOR' and u.activo limit 1), true);
select set_config('u.diseno', (select u.id::text from public.usuarios u join public.roles r on r.id = u.rol_id where r.codigo = 'DISENO' and u.activo limit 1), true);
select set_config('u.rrhh', (select u.id::text from public.usuarios u join public.roles r on r.id = u.rol_id where r.codigo = 'RECURSOS_HUMANOS' and u.activo limit 1), true);
select set_config('u.admin', (select u.id::text from public.usuarios u join public.roles r on r.id = u.rol_id where r.codigo = 'ADMINISTRACION' and u.activo limit 1), true);
select set_config('u.costos', (select u.id::text from public.usuarios u join public.roles r on r.id = u.rol_id where r.codigo = 'COSTOS_MATERIALES' and u.activo limit 1), true);
select set_config('u.gerente', (select u.id::text from public.usuarios u join public.roles r on r.id = u.rol_id where r.codigo = 'GERENTE' and u.activo limit 1), true);
select set_config('u.supervisor', (select u.id::text from public.usuarios u join public.roles r on r.id = u.rol_id where r.codigo = 'SUPERVISOR' and u.activo limit 1), true);
insert into storage.objects(bucket_id, name, owner_id, metadata) values ('evidencias-almacen',
  current_setting('u.almacen') || '/' || current_setting('prueba.salida') || '.jpg', current_setting('u.almacen'),
  '{"mimetype":"image/jpeg","size":100}'::jsonb);

create function pg_temp.como(p_usuario text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_usuario, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_usuario, 'role', 'authenticated')::text, true);
end $$;

-- 1. Almacén: entra sin precio y sale a la unidad; la salida cae en su OT.
select pg_temp.como(current_setting('u.almacen'));
set local role authenticated;
do $$ begin
  perform public.registrar_ingreso_almacen(gen_random_uuid(), current_setting('prueba.material')::uuid, 10, 'INGRESO_GENERAL', 'ENSAYO REVERTIDO', null, 'PEN');
  perform public.registrar_salida_almacen(current_setting('prueba.salida')::uuid, current_setting('prueba.material')::uuid, 4,
    current_setting('prueba.unidad')::uuid, null, 'Consumo de prueba', 'Persona de prueba',
    auth.uid()::text || '/' || current_setting('prueba.salida') || '.jpg');
  if (select orden_id from public.v_kardex_almacen where id = current_setting('prueba.salida')::uuid) is distinct from current_setting('prueba.orden')::uuid then
    raise exception 'FAIL: la salida no quedó en la OT abierta de su unidad';
  end if;
  begin
    perform public.valorizar_material(gen_random_uuid(), current_setting('prueba.material')::uuid, 1, 'PEN', '');
    raise exception 'FAIL: Almacén puso precio';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- 2. Sin precio, el costo avisa que falta valorizar.
select pg_temp.como(current_setting('u.costos'));
set local role authenticated;
do $$ begin
  if (select coalesce(sum(pendientes), 0) from public.resumen_costeo_ot(current_setting('prueba.orden')::uuid) where fuente = 'MATERIALES_SIN_PRECIO') <> 1 then
    raise exception 'FAIL: la salida sin precio no se marcó pendiente';
  end if;
end $$;
reset role;

-- 3. Logística valoriza; el material de la OT vale 4 × 12.50.
select pg_temp.como(current_setting('u.logistica'));
set local role authenticated;
do $$ begin
  perform public.valorizar_material(gen_random_uuid(), current_setting('prueba.material')::uuid, 12.5, 'PEN', 'Precio de reposición');
  if not exists (select 1 from public.materiales_para_valorizar() where material_id = current_setting('prueba.material')::uuid and precio = 12.5) then
    raise exception 'FAIL: Logística no ve el precio que fijó';
  end if;
end $$;
reset role;

-- 4. Diseño fija la merma; Costos no puede.
select pg_temp.como(current_setting('u.diseno'));
set local role authenticated;
select public.fijar_merma_ot(current_setting('prueba.orden')::uuid, 10, 'Recortes de plancha evaluados');
reset role;
select pg_temp.como(current_setting('u.costos'));
set local role authenticated;
do $$ begin
  begin
    perform public.fijar_merma_ot(current_setting('prueba.orden')::uuid, 50, 'Intento sin permiso');
    raise exception 'FAIL: Costos fijó la merma';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- 4b. Gerencia ve la merma y el precio, pero no los fija (migración 20261001120000).
select pg_temp.como(current_setting('u.gerente'));
set local role authenticated;
do $$ begin
  if not exists (select 1 from public.ot_mermas where orden_id = current_setting('prueba.orden')::uuid and porcentaje = 10) then
    raise exception 'FAIL: Gerencia no ve la merma';
  end if;
  if not exists (select 1 from public.materiales_para_valorizar() where material_id = current_setting('prueba.material')::uuid and precio = 12.5) then
    raise exception 'FAIL: Gerencia no ve el precio';
  end if;
  begin
    perform public.fijar_merma_ot(current_setting('prueba.orden')::uuid, 50, 'Intento de Gerencia');
    raise exception 'FAIL: Gerencia fijó la merma';
  exception when insufficient_privilege then null; end;
  begin
    perform public.valorizar_material(gen_random_uuid(), current_setting('prueba.material')::uuid, 99, 'PEN', '');
    raise exception 'FAIL: Gerencia fijó un precio';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- 5. RR. HH.: planilla del mes repartida entre las dos OT, y se cierra.
select pg_temp.como(current_setting('u.rrhh'));
set local role authenticated;
do $$
declare v_planilla uuid := gen_random_uuid(); v_a uuid := gen_random_uuid(); v_b uuid := gen_random_uuid();
begin
  insert into public.planillas(id, tipo, periodo, moneda) values (v_planilla, 'TALLER', current_setting('prueba.periodo')::date, 'PEN');
  insert into public.planilla_personas(id, planilla_id, nombre, monto) values (v_a, v_planilla, 'Persona A de prueba', 2000), (v_b, v_planilla, 'Persona B de prueba', 1000);
  insert into public.planilla_distribuciones(persona_id, orden_id, porcentaje) values
    (v_a, current_setting('prueba.orden')::uuid, 100), (v_b, current_setting('prueba.otra')::uuid, 100);
  perform public.cerrar_planilla(v_planilla);
end $$;
reset role;

-- 6. Administración: gastos del mes y un trámite de la OT; Supervisión no puede.
select pg_temp.como(current_setting('u.admin'));
set local role authenticated;
do $$
declare v_anulado uuid := gen_random_uuid(); v_tramite uuid := gen_random_uuid(); v_area uuid;
begin
  perform public.registrar_gasto_general(gen_random_uuid(), current_setting('prueba.periodo')::date, 'ELECTRICIDAD', 'Recibo de luz', 1000, 'PEN', 'TASA', 8);
  perform public.registrar_gasto_general(gen_random_uuid(), current_setting('prueba.periodo')::date, 'AGUA', 'Recibo de agua', 300, 'PEN', 'PARTES_IGUALES', null);
  perform public.registrar_gasto_general(gen_random_uuid(), current_setting('prueba.periodo')::date, 'DEPRECIACION_MAQUINARIA', 'Depreciación del mes', 5000, 'PEN', 'TASA', 2);
  perform public.registrar_gasto_general(v_anulado, current_setting('prueba.periodo')::date, 'CELULARES', 'Recibo duplicado', 999, 'PEN', 'TASA', 10);
  perform public.anular_gasto_general(v_anulado, 'Recibo cargado dos veces');
  select area_id into v_area from public.usuarios where id = auth.uid();
  insert into public.ot_gastos_areas(id, orden_id, area_id, tipo, descripcion, fecha, monto, moneda, comprobante_ruta, comprobante_nombre, estado, registrado_por)
  values (v_tramite, current_setting('prueba.orden')::uuid, v_area, 'TRAMITE', 'Tarjeta de propiedad y placas de prueba', current_date, 250, 'PEN',
          'ot/' || current_setting('prueba.orden') || '/gastos/' || v_tramite || '.pdf', 'tramite.pdf', 'PENDIENTE', public.usuario_actual());
  update public.ot_gastos_areas set estado = 'APROBADO' where id = v_tramite;
end $$;
reset role;
select pg_temp.como(current_setting('u.supervisor'));
set local role authenticated;
do $$ begin
  begin
    perform public.registrar_gasto_general(gen_random_uuid(), current_setting('prueba.periodo')::date, 'AGUA', 'Intento sin permiso', 1, 'PEN', 'PARTES_IGUALES', null);
    raise exception 'FAIL: Supervisión registró un gasto del mes';
  exception when insufficient_privilege then null; end;
  if (select count(*) from public.gastos_generales_mes) <> 0 then raise exception 'FAIL: Supervisión lee los gastos del mes'; end if;
end $$;
reset role;
select pg_temp.como(current_setting('u.almacen'));
set local role authenticated;
do $$
declare v uuid := gen_random_uuid(); v_area uuid;
begin
  select area_id into v_area from public.usuarios where id = auth.uid();
  begin
    insert into public.ot_gastos_areas(id, orden_id, area_id, tipo, descripcion, fecha, monto, moneda, comprobante_ruta, comprobante_nombre, estado, registrado_por)
    values (v, current_setting('prueba.orden')::uuid, v_area, 'COMISION', 'Comisión que no le toca a Almacén', current_date, 10, 'PEN',
            'ot/' || current_setting('prueba.orden') || '/gastos/' || v || '.pdf', 'x.pdf', 'PENDIENTE', public.usuario_actual());
    raise exception 'FAIL: Almacén registró una comisión de venta';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; if sqlerrm not like 'Los trámites de placas%' then raise; end if; end;
end $$;
reset role;

-- 7. Costos ve la suma, y el resumen cuadra con el detalle.
select pg_temp.como(current_setting('u.costos'));
set local role authenticated;
do $$
declare v_dif int; v_mat numeric; v_merma numeric; v_planilla numeric; v_indirectos numeric; v_operacion numeric;
begin
  select coalesce(sum(monto) filter (where fuente = 'MATERIALES'), 0), coalesce(sum(monto) filter (where fuente = 'MERMA'), 0),
         coalesce(sum(monto) filter (where fuente = 'PLANILLA'), 0), coalesce(sum(monto) filter (where fuente = 'INDIRECTOS'), 0),
         coalesce(sum(monto) filter (where fuente = 'GASTOS_OPERACION'), 0)
    into v_mat, v_merma, v_planilla, v_indirectos, v_operacion
    from public.resumen_costeo_ot(current_setting('prueba.orden')::uuid) where moneda = 'PEN';
  if v_mat <> 50 then raise exception 'FAIL: material %', v_mat; end if;
  if v_merma <> 5 then raise exception 'FAIL: merma %', v_merma; end if;
  if v_planilla <> 2000 then raise exception 'FAIL: planilla %', v_planilla; end if;
  -- Luz 8 % de 1000 y agua 300 en partes iguales entre las 2 OT del mes.
  if v_indirectos <> 80 + 150 then raise exception 'FAIL: indirectos %', v_indirectos; end if;
  -- Depreciación 2 % de 5000 y el trámite de 250; el recibo anulado no cuenta.
  if v_operacion <> 350 then raise exception 'FAIL: gastos de operación %', v_operacion; end if;
  select count(*) into v_dif from (
    select fuente, moneda, sum(monto) s from public.detalle_costeo_ot(current_setting('prueba.orden')::uuid)
     where fuente <> 'MATERIALES_SIN_PRECIO' group by 1, 2
    except
    select fuente, moneda, monto from public.resumen_costeo_ot(current_setting('prueba.orden')::uuid)
     where fuente <> 'MATERIALES_SIN_PRECIO') x;
  if v_dif <> 0 then raise exception 'FAIL: el resumen no cuadra con el detalle'; end if;
end $$;
reset role;
select 'OK: salida a la OT de su unidad; Logística valoriza; Diseño fija la merma; RR. HH. reparte la planilla; Administración carga luz, agua, depreciación y trámite; nadie más puede; el resumen cuadra con el detalle. Ensayo revertido.' comprobacion;
rollback;
