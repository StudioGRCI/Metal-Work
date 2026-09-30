-- Valorización en el momento del despacho y devolución con su costo original.
create or replace function public.identificar_material_movimiento()
returns trigger language plpgsql set search_path='public' as $$
declare v_material uuid;
begin
  if new.requerimiento_detalle_id is not null then
    select om.material_id into v_material from public.requerimiento_material_detalles d
      join public.ot_materiales om on om.id=d.ot_material_id where d.id=new.requerimiento_detalle_id;
    if new.material_id is not null and new.material_id<>v_material then raise exception 'El material no coincide con la solicitud.'; end if;
    new.material_id:=v_material;
  end if;
  if new.material_id is null then raise exception 'Identifica el material del movimiento.'; end if;
  perform 1 from public.materiales where id=new.material_id for update;
  if new.tipo='INGRESO' and new.origen='COMPRA' then
    select d.precio_unitario,c.moneda into new.precio_unitario,new.moneda
      from public.orden_compra_material_detalles d join public.ordenes_compra_materiales c on c.id=d.orden_compra_id
      where d.id=new.orden_compra_detalle_id;
  end if;
  if new.tipo='DESPACHO' then
    -- Mantiene el criterio histórico: última entrada valorizada, priorizando la solicitud propia.
    -- Se congela al despachar, para que una compra posterior no cambie el costo de una OT.
    select m.precio_unitario,m.moneda into new.precio_unitario,new.moneda
      from public.movimientos_materiales m
      where m.material_id=new.material_id and m.tipo='INGRESO' and m.precio_unitario is not null
        and m.moneda in('PEN','USD') and m.registrado_en<=new.registrado_en
      order by case when m.requerimiento_detalle_id=new.requerimiento_detalle_id then 0 else 1 end,m.registrado_en desc,m.id
      limit 1;
  end if;
  return new;
end $$;
CREATE OR REPLACE FUNCTION public.registrar_ingreso_almacen(p_id uuid, p_material uuid, p_cantidad numeric, p_origen text, p_documento text, p_precio numeric, p_moneda text, p_devolucion uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_existente public.movimientos_materiales%rowtype; v_original public.movimientos_materiales%rowtype; v_devuelto numeric;
begin
  perform public.exigir_permiso('almacen.recibir');
  if p_id is null or p_cantidad is null or p_cantidad<=0 or p_cantidad<>round(p_cantidad,3)
     or p_origen is null or p_origen not in ('SALDO_INICIAL','INGRESO_GENERAL','DEVOLUCION')
     or length(btrim(coalesce(p_documento,''))) not between 2 and 100
     or (p_precio is not null and (p_precio<0 or p_precio<>round(p_precio,4))) or p_moneda is null or p_moneda not in ('PEN','USD') then
    raise exception 'Indica material, cantidad, origen, documento y precio válidos.';
  end if;
  perform 1 from public.materiales where id=p_material and activo for update;
  if not found then raise exception 'El material no está activo.'; end if;
  if p_origen='DEVOLUCION' then
    select * into v_original from public.movimientos_materiales where id=p_devolucion and tipo='DESPACHO' and material_id=p_material for update;
    if not found then raise exception 'Selecciona el despacho original de este material.'; end if;
    p_precio:=v_original.precio_unitario;
    p_moneda:=coalesce(v_original.moneda,p_moneda);
  elsif p_devolucion is not null then raise exception 'Solo una devolución puede vincularse a un despacho.';
  end if;
  select * into v_existente from public.movimientos_materiales where id=p_id;
  if found then
    if v_existente.registrado_por=public.usuario_actual() and v_existente.material_id=p_material and v_existente.cantidad=p_cantidad
      and v_existente.origen=p_origen and v_existente.documento_referencia=btrim(p_documento)
      and v_existente.precio_unitario is not distinct from p_precio and v_existente.moneda=p_moneda
      and v_existente.devolucion_de is not distinct from p_devolucion then return p_id; end if;
    raise exception 'El ingreso ya existe con otros datos. Recarga antes de volver a intentar.';
  end if;
  if p_origen='DEVOLUCION' then
    select coalesce(sum(cantidad),0) into v_devuelto from public.movimientos_materiales where devolucion_de=p_devolucion;
    if v_devuelto+p_cantidad>v_original.cantidad then raise exception 'La devolución supera lo entregado en el despacho original.'; end if;
    p_precio:=v_original.precio_unitario;
    p_moneda:=coalesce(v_original.moneda,p_moneda);
  elsif p_devolucion is not null then raise exception 'Solo una devolución puede vincularse a un despacho.';
  end if;
  insert into public.movimientos_materiales(id,tipo,material_id,cantidad,origen,documento_referencia,registrado_por,precio_unitario,moneda,devolucion_de)
    values(p_id,'INGRESO',p_material,p_cantidad,p_origen,btrim(p_documento),public.usuario_actual(),p_precio,p_moneda,p_devolucion);
  return p_id;
end $function$;

CREATE OR REPLACE FUNCTION public.resumen_costeo_ot(p_orden uuid)
 RETURNS TABLE(fuente text, moneda text, monto numeric, pendientes bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.exigir_permiso('costos.ver');
  if not public.puede_ver_orden(p_orden) then
    raise exception 'No tienes acceso al costeo de esta OT.' using errcode='insufficient_privilege';
  end if;
  return query
  with despachos as (
    select m.id, greatest(m.cantidad-coalesce((select sum(x.cantidad) from public.movimientos_materiales x where x.devolucion_de=m.id),0),0)::numeric as cantidad, m.registrado_en, m.precio_unitario as precio_registrado,m.moneda as moneda_registrada,
           d.id as detalle_id, om.material_id
      from public.movimientos_materiales m
      join public.requerimiento_material_detalles d on d.id=m.requerimiento_detalle_id
      join public.requerimientos_materiales r on r.id=d.requerimiento_id
      join public.ot_materiales om on om.id=d.ot_material_id
     where r.orden_id=p_orden and m.tipo='DESPACHO'
  ), valorizados as (
    select d.cantidad, coalesce(d.precio_registrado,precio.precio_unitario)::numeric as precio,
           coalesce(d.moneda_registrada,precio.moneda) as moneda_compra
      from despachos d
      left join lateral (
        select cd.precio_unitario, oc.moneda
          from public.orden_compra_material_detalles cd
          join public.ordenes_compra_materiales oc on oc.id=cd.orden_compra_id
          join public.requerimiento_material_detalles rd on rd.id=cd.requerimiento_detalle_id
          join public.ot_materiales om on om.id=rd.ot_material_id
         where om.material_id=d.material_id and cd.precio_unitario>=0
           and oc.moneda in ('PEN','USD') and oc.creado_en<=d.registrado_en
         order by case when cd.requerimiento_detalle_id=d.detalle_id then 0 else 1 end,
                  oc.creado_en desc,cd.id
         limit 1
      ) precio on true
      where d.cantidad>0
  ), lineas as (
    select 'MATERIALES'::text fuente, v.moneda_compra moneda,
           round(v.cantidad*v.precio,2) monto,0::bigint pendientes
      from valorizados v where v.precio is not null
    union all
    select 'MATERIALES_SIN_PRECIO', null::text,0::numeric,1::bigint
      from valorizados v where v.precio is null
    union all
    select 'PLANILLA',p.moneda,
           round(pp.monto*d.porcentaje/100,2),0::bigint
      from public.planilla_distribuciones d
      join public.planilla_personas pp on pp.id=d.persona_id
      join public.planillas p on p.id=pp.planilla_id
     where d.orden_id=p_orden and p.estado='CERRADA'
    union all
    select 'GASTOS_AREA',g.moneda,g.monto,0::bigint
      from public.ot_gastos_areas g
     where g.orden_id=p_orden and g.estado='APROBADO'
  )
  select l.fuente,l.moneda,sum(l.monto)::numeric,sum(l.pendientes)::bigint
    from lineas l group by l.fuente,l.moneda order by l.fuente,l.moneda;
end $function$;

create or replace function public.notificar_revision_informe_diseno()
returns trigger language plpgsql security definer set search_path='public' as $$
declare v_permiso text; v_titulo text;
begin
 if new.estado=old.estado then return new; end if;
 if new.estado='EN_REVISION' then v_permiso:='diseno.revisar_informe';v_titulo:='Informe de Diseño pendiente de revisión';
 elsif new.estado='APROBADO' then v_permiso:='administracion.recibir_informe';v_titulo:='Informe de Diseño aprobado para Administración';
 elsif new.estado='OBSERVADO' then v_permiso:='diseno.preparar_informe';v_titulo:='Informe de Diseño con observaciones';
 else return new; end if;
 perform public.notificar_a_permiso(v_permiso,v_titulo,'Informe N.º '||new.numero||' · semana '||to_char(new.semana_inicio,'DD/MM/YYYY'),
   '/diseno/informe-semanal?semana='||new.semana_inicio,'diseno_informes',new.id,public.usuario_actual());
 return new;
end $$;
revoke all on function public.notificar_revision_informe_diseno() from public,anon,authenticated;
drop trigger if exists trg_notificar_revision_informe on public.diseno_informes;
create trigger trg_notificar_revision_informe after update of estado on public.diseno_informes for each row execute function public.notificar_revision_informe_diseno();
drop policy if exists diseno_tareas_crear on public.diseno_tareas;
create policy diseno_tareas_crear on public.diseno_tareas for insert to authenticated
with check(creado_por=(select auth.uid()) and public.tiene_permiso('diseno.preparar_informe') and public.puede_ver_orden(orden_id)
 and exists(select 1 from public.ot_equipo_diseno e where e.id=integrante_id and e.orden_id=diseno_tareas.orden_id and e.funcion='COLABORADOR'));

