-- Planilla de almacén sin internet (migración 20261001200000). La almacenera
-- carga lo anotado en la planilla con la fecha en que pasó; la base no deja
-- fechas futuras, de hace más de 31 días ni anteriores al último conteo, y
-- volver a cargar la misma fila no la duplica. Todo se deshace al final.
begin;
select set_config('prueba.material', (select m.id::text from public.materiales m
  where m.activo and not m.unidad_pendiente
    and not exists (select 1 from public.ot_materiales om where om.material_id = m.id)
  order by m.codigo limit 1), true);
-- Las unidades de la empresa se nombran por su código de fabricación; la placa
-- llega después. La planilla acepta cualquiera de los dos.
select set_config('prueba.placa', (select coalesce(nullif(btrim(u.placa), ''), u.codigo_interno) from public.unidades u
  where u.activo and coalesce(nullif(btrim(u.placa), ''), u.codigo_interno) is not null
    and (select count(*) from public.unidades x where x.activo
          and (upper(btrim(x.placa)) = upper(btrim(coalesce(nullif(btrim(u.placa), ''), u.codigo_interno)))
            or upper(btrim(x.codigo_interno)) = upper(btrim(coalesce(nullif(btrim(u.placa), ''), u.codigo_interno))))) = 1
  order by 1 limit 1), true);
select set_config('prueba.ingreso', gen_random_uuid()::text, true);
select set_config('prueba.salida', gen_random_uuid()::text, true);
select set_config('u.almacen', (select u.id::text from public.usuarios u join public.roles r on r.id = u.rol_id where r.codigo = 'ALMACENERO' and u.activo limit 1), true);
select set_config('u.costos', (select u.id::text from public.usuarios u join public.roles r on r.id = u.rol_id where r.codigo = 'COSTOS_MATERIALES' and u.activo limit 1), true);
insert into storage.objects(bucket_id, name, owner_id, metadata) values ('evidencias-almacen',
  current_setting('u.almacen') || '/' || current_setting('prueba.salida') || '.jpg', current_setting('u.almacen'),
  '{"mimetype":"image/jpeg","size":100}'::jsonb);

create function pg_temp.como(p_usuario text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_usuario, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_usuario, 'role', 'authenticated')::text, true);
end $$;

-- 1. La almacenera carga un ingreso y una salida de hace tres días.
select pg_temp.como(current_setting('u.almacen'));
set local role authenticated;
do $$
declare v record; v_fecha timestamptz := date_trunc('minute', now() - interval '3 days');
begin
  perform public.registrar_ingreso_planilla(current_setting('prueba.ingreso')::uuid, current_setting('prueba.material')::uuid,
    20, 'INGRESO_GENERAL', 'Guía de prueba sin conexión', null, 'PEN', v_fecha);
  perform public.registrar_salida_planilla(current_setting('prueba.salida')::uuid, current_setting('prueba.material')::uuid,
    5, current_setting('prueba.placa'), 'Vale de prueba sin conexión', 'Persona de prueba',
    auth.uid()::text || '/' || current_setting('prueba.salida') || '.jpg', v_fecha + interval '2 hours');

  select * into v from public.v_kardex_almacen where id = current_setting('prueba.ingreso')::uuid;
  if v.fecha <> v_fecha or not v.desde_planilla or v.cargado_en < now() - interval '1 minute' then
    raise exception 'FAIL: el ingreso no quedó con la fecha de la planilla (% / % / %)', v.fecha, v.desde_planilla, v.cargado_en;
  end if;
  select * into v from public.v_kardex_almacen where id = current_setting('prueba.salida')::uuid;
  if v.fecha <> v_fecha + interval '2 hours' or v.unidad_id is null or v.saldo is null then
    raise exception 'FAIL: la salida no quedó con su fecha o su unidad (% / %)', v.fecha, v.unidad_id;
  end if;

  -- Volver a cargar la misma planilla no duplica.
  if public.registrar_ingreso_planilla(current_setting('prueba.ingreso')::uuid, current_setting('prueba.material')::uuid,
       20, 'INGRESO_GENERAL', 'Guía de prueba sin conexión', null, 'PEN', v_fecha) <> current_setting('prueba.ingreso')::uuid
     or public.registrar_salida_planilla(current_setting('prueba.salida')::uuid, current_setting('prueba.material')::uuid,
       5, current_setting('prueba.placa'), 'Vale de prueba sin conexión', 'Persona de prueba',
       auth.uid()::text || '/' || current_setting('prueba.salida') || '.jpg', v_fecha + interval '2 hours') <> current_setting('prueba.salida')::uuid then
    raise exception 'FAIL: la recarga no devolvió el mismo movimiento';
  end if;
  if (select count(*) from public.movimientos_materiales where id in (current_setting('prueba.ingreso')::uuid, current_setting('prueba.salida')::uuid)) <> 2 then
    raise exception 'FAIL: la recarga duplicó movimientos';
  end if;

  -- Fechas que la base no acepta.
  begin
    perform public.registrar_ingreso_planilla(gen_random_uuid(), current_setting('prueba.material')::uuid, 1, 'INGRESO_GENERAL', 'Futuro', null, 'PEN', now() + interval '1 day');
    raise exception 'FAIL: aceptó una fecha futura';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  begin
    perform public.registrar_ingreso_planilla(gen_random_uuid(), current_setting('prueba.material')::uuid, 1, 'INGRESO_GENERAL', 'Muy antiguo', null, 'PEN', now() - interval '40 days');
    raise exception 'FAIL: aceptó una fecha de hace 40 días';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  begin
    perform public.registrar_ingreso_planilla(gen_random_uuid(), current_setting('prueba.material')::uuid, 1, 'DEVOLUCION', 'Devolución', null, 'PEN', now() - interval '1 day');
    raise exception 'FAIL: aceptó una devolución por planilla';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;

  -- Un conteo cierra lo anterior: nada de antes del conteo entra después.
  perform public.registrar_conteo_almacen(gen_random_uuid(), current_setting('prueba.material')::uuid, 15, 'Conteo de prueba sin conexión');
  begin
    perform public.registrar_ingreso_planilla(gen_random_uuid(), current_setting('prueba.material')::uuid, 1, 'INGRESO_GENERAL', 'Antes del conteo', null, 'PEN', now() - interval '1 day');
    raise exception 'FAIL: aceptó un movimiento anterior al conteo';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
end $$;
reset role;

-- 2. Costos lee el kardex pero no carga planillas.
select pg_temp.como(current_setting('u.costos'));
set local role authenticated;
do $$ begin
  begin
    perform public.registrar_ingreso_planilla(gen_random_uuid(), current_setting('prueba.material')::uuid, 1, 'INGRESO_GENERAL', 'Sin permiso', null, 'PEN', now() - interval '1 hour');
    raise exception 'FAIL: Costos cargó un ingreso';
  exception when insufficient_privilege then null; end;
  if not exists (select 1 from public.v_kardex_almacen where id = current_setting('prueba.ingreso')::uuid and desde_planilla) then
    raise exception 'FAIL: Costos no ve el ingreso de planilla en el kardex';
  end if;
end $$;
reset role;

select 'OK: la planilla carga con su fecha, no duplica, rechaza fechas futuras, antiguas y anteriores al conteo, y solo Almacén la carga. Ensayo revertido.' comprobacion;
rollback;
