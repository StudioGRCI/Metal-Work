-- Almacén valida lo que dejó el conductor (migración 20261012120000), con el
-- rol real: ALMACENERO del área ALM y `set local role authenticated`. Un
-- supervisor de taller como quien no puede validar. Termina en rollback.
--
-- Armazón por el camino real: Logística emite una OC directa (dos líneas) y una
-- de requerimiento (una), Gerencia aprueba la directa y el conductor recoge y
-- deja las dos. Las tablas se preparan como dueño; cada paso, con su rol.
begin;

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['COMPRADOR', 'GERENTE', 'SUPERVISOR', 'CONDUCTOR'] loop
    perform set_config('prueba.' || lower(v), (
      select u.id::text from public.usuarios u join public.roles r on r.id = u.rol_id
       where r.codigo = v and u.activo order by u.creado_en limit 1), true);
    if current_setting('prueba.' || lower(v)) = '' then
      raise exception 'FALLA: no hay una cuenta activa con el rol % para probar', v;
    end if;
  end loop;
  perform set_config('prueba.almacenero', (
    select u.id::text from public.usuarios u join public.roles r on r.id = u.rol_id
      join public.areas a on a.id = u.area_id
     where r.codigo = 'ALMACENERO' and a.codigo = 'ALM' and u.activo order by u.creado_en limit 1), true);
  if current_setting('prueba.almacenero') = '' then
    raise exception 'FALLA: no hay un almacenero activo del área ALM para probar';
  end if;
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;

do $$
declare v_ot uuid; v_req uuid; v_mat uuid; v_om uuid; v_det uuid; i int; v_cat uuid; v_und uuid;
begin
  select id into v_cat from public.categorias_material order by 1 limit 1;
  select id into v_und from public.unidades_medida where codigo = 'UND';
  insert into public.proveedores (numero_documento, razon_social)
  values ('20100047218', 'PROVEEDOR DE PRUEBA 328')
  on conflict (tipo_documento, numero_documento) do update set activo = true
  returning id into v_mat;
  perform set_config('prueba.proveedor', v_mat::text, true);
  for i in 1..2 loop
    insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
    values ('CHK328-' || i, 'Material directo ' || i, v_cat, v_und) returning id into v_mat;
    perform set_config('prueba.mat' || i, v_mat::text, true);
  end loop;
  insert into public.ordenes_trabajo (cliente_id, abierta_en_taller, sede_id, descripcion)
  values (null, true, (select id from public.sedes order by creado_en limit 1), 'Prueba de ingreso por conductor · check 328')
  returning id into v_ot;
  insert into public.requerimientos_materiales (orden_id, area_destino, solicitado_por)
  values (v_ot, 'PRD', current_setting('prueba.supervisor')::uuid) returning id into v_req;
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK328-R', 'Material de OT', v_cat, v_und) returning id into v_mat;
  perform set_config('prueba.mat_r', v_mat::text, true);
  insert into public.ot_materiales (orden_id, material_id, cantidad, area_destino)
  values (v_ot, v_mat, 6, 'PRD') returning id into v_om;
  insert into public.requerimiento_material_detalles (requerimiento_id, ot_material_id, cantidad_solicitada)
  values (v_req, v_om, 6) returning id into v_det;
  update public.requerimiento_material_detalles
     set aprobacion_diseno = 'APROBADO', decision_almacen = 'COMPRA', cantidad_stock = 0 where id = v_det;
  perform set_config('prueba.det', v_det::text, true);
  update public.regla_aprobacion_compras set activa = false where unica;
  perform set_config('prueba.oc_directa', gen_random_uuid()::text, true);
  perform set_config('prueba.oc_req', gen_random_uuid()::text, true);
end $$;

select pg_temp.como('comprador');
set local role authenticated;
select public.emitir_compra_directa(current_setting('prueba.oc_directa')::uuid, current_setting('prueba.proveedor')::uuid, 'COT-328',
  'Reposición de stock del almacén', jsonb_build_array(
    jsonb_build_object('material_id', current_setting('prueba.mat1'), 'cantidad', 10, 'precio', 12.5),
    jsonb_build_object('material_id', current_setting('prueba.mat2'), 'cantidad', 10, 'precio', 12.5)),
  null, 'CONTADO', 0, 'PEN');
select public.emitir_compra_agrupada(current_setting('prueba.oc_req')::uuid, current_setting('prueba.proveedor')::uuid, 'COT-328R',
  jsonb_build_array(jsonb_build_object('id', current_setting('prueba.det'), 'cantidad', 6, 'precio', 30)),
  null, 'CONTADO', 0, 'PEN');
select public.mandar_compra_a_recojo(current_setting('prueba.oc_req')::uuid);
reset role;
set constraints all immediate;

select pg_temp.como('gerente');
set local role authenticated;
select public.aprobar_compra(current_setting('prueba.oc_directa')::uuid);
reset role;

select pg_temp.como('conductor');
set local role authenticated;
select public.marcar_compra_recogida(current_setting('prueba.oc_directa')::uuid);
select public.marcar_compra_dejada_almacen(current_setting('prueba.oc_directa')::uuid);
select public.marcar_compra_recogida(current_setting('prueba.oc_req')::uuid);
select public.marcar_compra_dejada_almacen(current_setting('prueba.oc_req')::uuid);
reset role;

do $$
declare i int;
begin
  for i in 1..2 loop
    perform set_config('prueba.pend' || i, (select id::text from public.ingresos_pendientes_almacen
      where orden_compra_id = current_setting('prueba.oc_directa')::uuid and material_id = current_setting('prueba.mat' || i)::uuid), true);
    perform set_config('prueba.linea' || i, (select orden_compra_detalle_id::text from public.ingresos_pendientes_almacen
      where id = current_setting('prueba.pend' || i)::uuid), true);
  end loop;
  perform set_config('prueba.pend_r', (select id::text from public.ingresos_pendientes_almacen
    where orden_compra_id = current_setting('prueba.oc_req')::uuid), true);
  perform set_config('prueba.num_directa', (select numero from public.ordenes_compra_materiales where id = current_setting('prueba.oc_directa')::uuid), true);
  perform set_config('prueba.num_req', (select numero from public.ordenes_compra_materiales where id = current_setting('prueba.oc_req')::uuid), true);
  if current_setting('prueba.pend1') = '' or current_setting('prueba.pend_r') = '' then
    raise exception 'FALLA: el conductor no dejó los pendientes que la prueba espera';
  end if;
end $$;

-- 1. El supervisor no ve la bandeja ni valida.
select pg_temp.como('supervisor');
set local role authenticated;
do $$ begin
  perform public.ingresos_por_validar();
  raise exception 'FALLA: un supervisor leyó la bandeja de Almacén';
exception when others then if sqlerrm like 'FALLA:%' then raise; end if;
end $$;
do $$ begin
  perform public.validar_ingresos_compra(current_setting('prueba.oc_directa')::uuid,
    jsonb_build_array(jsonb_build_object('id', current_setting('prueba.pend1'), 'movimiento_id', gen_random_uuid(), 'cantidad', 10)));
  raise exception 'FALLA: un supervisor validó un ingreso';
exception when others then if sqlerrm like 'FALLA:%' then raise; end if;
end $$;
reset role;

-- 2. Almacén ve las tres líneas en su bandeja, con la OC aunque sea directa.
select pg_temp.como('almacenero');
set local role authenticated;
do $$ declare v int; begin
  select count(*) into v from public.ingresos_por_validar()
   where orden_compra_id in (current_setting('prueba.oc_directa')::uuid, current_setting('prueba.oc_req')::uuid)
     and referencia in (current_setting('prueba.num_directa'), current_setting('prueba.num_req'));
  if v <> 3 then raise exception 'FALLA: Almacén ve % líneas por validar y debían ser 3', v; end if;
end $$;

-- 3. La recepción a mano no registra lo que el conductor dejó.
do $$ begin
  perform public.registrar_recepcion_material(gen_random_uuid(), current_setting('prueba.linea1')::uuid, 10, 'GR 326');
  raise exception 'FALLA: se registró a mano una línea que espera validación';
exception when others then
  if sqlerrm like 'FALLA:%' then raise; end if;
  if sqlerrm not like '%Ingresos por validar%' then raise exception 'FALLA: la recepción a mano cayó por otra cosa: %', sqlerrm; end if;
end $$;

-- 4. Llegó menos sin decir por qué: no pasa.
do $$ begin
  perform public.validar_ingresos_compra(current_setting('prueba.oc_directa')::uuid, jsonb_build_array(
    jsonb_build_object('id', current_setting('prueba.pend1'), 'movimiento_id', gen_random_uuid(), 'cantidad', 10),
    jsonb_build_object('id', current_setting('prueba.pend2'), 'movimiento_id', gen_random_uuid(), 'cantidad', 7)));
  raise exception 'FALLA: se validó una falta sin observación';
exception when others then
  if sqlerrm like 'FALLA:%' then raise; end if;
  if sqlerrm not like 'Cuenta qué faltó%' then raise exception 'FALLA: la falta sin observación cayó por otra cosa: %', sqlerrm; end if;
end $$;

-- 5. La OC directa: una línea completa y otra con falta observada, de una vez.
do $$
declare v int; v_p1 public.ingresos_pendientes_almacen%rowtype; v_p2 public.ingresos_pendientes_almacen%rowtype; v_saldo numeric;
begin
  perform set_config('prueba.mov1', gen_random_uuid()::text, true);
  perform set_config('prueba.mov2', gen_random_uuid()::text, true);
  v := public.validar_ingresos_compra(current_setting('prueba.oc_directa')::uuid, jsonb_build_array(
    jsonb_build_object('id', current_setting('prueba.pend1'), 'movimiento_id', current_setting('prueba.mov1'), 'cantidad', 10),
    jsonb_build_object('id', current_setting('prueba.pend2'), 'movimiento_id', current_setting('prueba.mov2'), 'cantidad', 7,
                       'observacion', 'Llegaron 7, el proveedor manda 3 el lunes')), 'GR 001-3280');
  if v <> 2 then raise exception 'FALLA: se validaron % líneas y debían ser 2', v; end if;
  select * into v_p1 from public.ingresos_pendientes_almacen where id = current_setting('prueba.pend1')::uuid;
  select * into v_p2 from public.ingresos_pendientes_almacen where id = current_setting('prueba.pend2')::uuid;
  if v_p1.estado <> 'VALIDADO' or v_p1.cantidad_validada <> 10 or v_p1.movimiento_id <> current_setting('prueba.mov1')::uuid
     or v_p1.validado_por <> current_setting('prueba.almacenero')::uuid then
    raise exception 'FALLA: la línea completa no quedó VALIDADA con su ingreso y quién la validó';
  end if;
  if v_p2.estado <> 'OBSERVADO' or v_p2.cantidad_validada <> 7 or v_p2.observacion is null then
    raise exception 'FALLA: la línea con falta no quedó OBSERVADA con lo que llegó';
  end if;
  if not exists (select 1 from public.movimientos_materiales where id = current_setting('prueba.mov1')::uuid
      and tipo = 'INGRESO' and origen = 'COMPRA' and requerimiento_detalle_id is null
      and material_id = current_setting('prueba.mat1')::uuid and precio_unitario = 12.5 and moneda = 'PEN'
      and documento_referencia = 'GR 001-3280' and registrado_por = current_setting('prueba.almacenero')::uuid) then
    raise exception 'FALLA: el ingreso de la línea directa no quedó como compra con su precio, guía y quién lo registró';
  end if;
  select existencia into v_saldo from public.v_existencias_materiales where material_id = current_setting('prueba.mat2')::uuid;
  if v_saldo is distinct from 7::numeric then raise exception 'FALLA: el saldo del material con falta es % y debía ser 7', v_saldo; end if;
  if (select count(*) from public.v_kardex_almacen where id in (current_setting('prueba.mov1')::uuid, current_setting('prueba.mov2')::uuid)) <> 2 then
    raise exception 'FALLA: los ingresos validados no aparecen en el kardex de Almacén';
  end if;

  -- Reintento del mismo envío: no duplica.
  v := public.validar_ingresos_compra(current_setting('prueba.oc_directa')::uuid, jsonb_build_array(
    jsonb_build_object('id', current_setting('prueba.pend1'), 'movimiento_id', current_setting('prueba.mov1'), 'cantidad', 10)));
  if (select count(*) from public.movimientos_materiales where orden_compra_detalle_id = current_setting('prueba.linea1')::uuid) <> 1 then
    raise exception 'FALLA: el reintento duplicó el ingreso';
  end if;
  -- Otro envío sobre lo ya validado: se rechaza.
  begin
    perform public.validar_ingresos_compra(current_setting('prueba.oc_directa')::uuid, jsonb_build_array(
      jsonb_build_object('id', current_setting('prueba.pend1'), 'movimiento_id', gen_random_uuid(), 'cantidad', 10)));
    raise exception 'FALLA: se validó dos veces la misma línea';
  exception when others then if sqlerrm like 'FALLA:%' then raise; end if;
  end;
end $$;

-- 6. La OC de requerimiento: llega todo y el ingreso queda atado a la OT.
do $$ declare v int; begin
  perform set_config('prueba.mov_r', gen_random_uuid()::text, true);
  v := public.validar_ingresos_compra(current_setting('prueba.oc_req')::uuid, jsonb_build_array(
    jsonb_build_object('id', current_setting('prueba.pend_r'), 'movimiento_id', current_setting('prueba.mov_r'), 'cantidad', 6)));
  if v <> 1 or not exists (select 1 from public.movimientos_materiales where id = current_setting('prueba.mov_r')::uuid
      and requerimiento_detalle_id is not null and material_id = current_setting('prueba.mat_r')::uuid
      and documento_referencia = current_setting('prueba.num_req')) then
    raise exception 'FALLA: el ingreso de la OC de requerimiento no quedó con su línea de OT y la OC como documento';
  end if;
  if exists (select 1 from public.ingresos_por_validar() where orden_compra_id in
      (current_setting('prueba.oc_directa')::uuid, current_setting('prueba.oc_req')::uuid)) then
    raise exception 'FALLA: lo validado sigue en la bandeja';
  end if;
end $$;
reset role;

-- 7. Logística se entera de lo observado.
select test.afirmar(exists (select 1 from public.notificaciones where usuario_id = current_setting('prueba.comprador')::uuid
  and origen_id = current_setting('prueba.oc_directa')::uuid and titulo = 'Almacén observó la compra ' || current_setting('prueba.num_directa')),
  'quien emitió la OC recibe el aviso de lo observado');

do $$ begin raise notice 'OK 328: Almacén valida lo que dejó el conductor, con su rol'; end $$;
rollback;
