-- El área propone un insumo ausente del catálogo desde un plano de la OT.
-- Queda inactivo hasta la aprobación de Diseño; Almacén nunca lo recibe antes.
alter table public.materiales add column if not exists creado_desde_ot uuid
  references public.ordenes_trabajo(id) on delete restrict;
create index if not exists idx_materiales_creado_desde_ot
  on public.materiales(creado_desde_ot) where creado_desde_ot is not null;

create or replace function public.proponer_material_de_area(
  p_orden uuid, p_plano uuid, p_material uuid, p_cantidad public.cantidad,
  p_observacion text default null
) returns uuid language plpgsql security definer set search_path = 'public' as $$
declare v_area text; v_linea uuid; v_requerimiento uuid; v_detalle uuid;
begin
  perform public.exigir_permiso('requerimientos.crear');
  select a.codigo into v_area from public.usuarios u
    join public.areas a on a.id = u.area_id
   where u.id = public.usuario_actual() and u.activo;
  if v_area not in ('MTZ', 'PRD', 'ACB') then
    raise exception 'Solo Maestranza, Producción y Acabados proponen materiales a Diseño.' using errcode = 'insufficient_privilege';
  end if;
  if not public.puede_ver_orden(p_orden) then
    raise exception 'No tienes acceso a esta orden.' using errcode = 'insufficient_privilege';
  end if;
  if p_cantidad is null or p_cantidad <= 0 or length(coalesce(p_observacion, '')) > 500 then
    raise exception 'Indica cantidad positiva y observación de hasta 500 caracteres.' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.ot_planos p join public.ordenes_trabajo o on o.id = p.orden_id
      where p.id = p_plano and p.orden_id = p_orden
        and o.estado::text not in ('BORRADOR', 'ANULADA', 'ENTREGADA', 'FACTURADA')) then
    raise exception 'Elige un plano de una orden activa.' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.materiales
      where id = p_material and (activo or
        (creado_desde_ot = p_orden and creado_por = public.usuario_actual()))) then
    raise exception 'Elige un material del catálogo o propón uno nuevo para esta OT.' using errcode = 'check_violation';
  end if;
  insert into public.ot_materiales
    (orden_id, plano_id, material_id, cantidad, area_destino, observacion, creado_por)
  values (p_orden, p_plano, p_material, p_cantidad, v_area, nullif(btrim(p_observacion), ''), public.usuario_actual())
  returning id into v_linea;
  insert into public.requerimientos_materiales (orden_id, area_destino, solicitado_por)
  values (p_orden, v_area, public.usuario_actual())
  on conflict (orden_id, area_destino) do update set actualizado_en = now()
  returning id into v_requerimiento;
  insert into public.requerimiento_material_detalles
    (requerimiento_id, ot_material_id, cantidad_solicitada)
  values (v_requerimiento, v_linea, p_cantidad) returning id into v_detalle;
  return v_detalle;
end;
$$;
revoke all on function public.proponer_material_de_area(uuid, uuid, uuid, public.cantidad, text) from public, anon;
grant execute on function public.proponer_material_de_area(uuid, uuid, uuid, public.cantidad, text) to authenticated;

create or replace function public.proponer_material_nuevo_de_area(
  p_id uuid, p_orden uuid, p_plano uuid, p_descripcion text,
  p_categoria uuid, p_unidad uuid, p_cantidad public.cantidad,
  p_especificacion text default null
) returns uuid language plpgsql security definer set search_path = 'public' as $$
declare v_area text; v_detalle uuid;
begin
  perform public.exigir_permiso('requerimientos.crear');
  select a.codigo into v_area from public.usuarios u
    join public.areas a on a.id = u.area_id
   where u.id = public.usuario_actual() and u.activo;
  if v_area not in ('MTZ', 'PRD', 'ACB') then
    raise exception 'Solo el área que usará el material puede solicitarlo.' using errcode = 'insufficient_privilege';
  end if;
  if p_id is null or length(btrim(coalesce(p_descripcion, ''))) not between 3 and 200
     or length(coalesce(p_especificacion, '')) > 300
     or p_cantidad is null or p_cantidad <= 0 then
    raise exception 'Indica nombre, cantidad positiva y especificación de hasta 300 caracteres.' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.categorias_material where id = p_categoria and activo)
     or not exists (select 1 from public.unidades_medida where id = p_unidad and activo) then
    raise exception 'Elige una categoría y una unidad activas.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.materiales where id = p_id) then
    select d.id into v_detalle from public.materiales mat
      join public.ot_materiales m on m.material_id = mat.id
      join public.requerimiento_material_detalles d on d.ot_material_id = m.id
     where mat.id = p_id and mat.creado_por = public.usuario_actual()
       and mat.creado_desde_ot = p_orden and m.plano_id = p_plano
       and m.area_destino = v_area and m.cantidad = p_cantidad
       and mat.descripcion = btrim(p_descripcion)
       and mat.categoria_id = p_categoria and mat.unidad_medida_id = p_unidad
       and coalesce(mat.especificacion_tecnica, '') = btrim(coalesce(p_especificacion, ''));
    if v_detalle is not null then return v_detalle; end if;
    raise exception 'Esta solicitud ya existe con otros datos. Recarga la OT.' using errcode = 'unique_violation';
  end if;
  if exists (select 1 from public.materiales
      where lower(btrim(descripcion)) = lower(btrim(p_descripcion))
        and unidad_medida_id = p_unidad and activo) then
    raise exception 'Ese material ya está en el catálogo. Búscalo por nombre antes de crear otro.' using errcode = 'unique_violation';
  end if;
  insert into public.materiales (
    id, codigo, descripcion, categoria_id, unidad_medida_id,
    especificacion_tecnica, activo, creado_por, creado_desde_ot
  ) values (
    p_id, 'SOL-' || left(replace(p_id::text, '-', ''), 24), btrim(p_descripcion),
    p_categoria, p_unidad, nullif(btrim(p_especificacion), ''), false,
    public.usuario_actual(), p_orden
  );
  -- La función existente valida OT, plano y área; si falla se revierte también el catálogo.
  -- La fila sigue inactiva hasta que Diseño la apruebe.
  v_detalle := public.proponer_material_de_area(p_orden, p_plano, p_id, p_cantidad, p_especificacion);
  return v_detalle;
end;
$$;
revoke all on function public.proponer_material_nuevo_de_area(uuid, uuid, uuid, text, uuid, uuid, public.cantidad, text)
  from public, anon;
grant execute on function public.proponer_material_nuevo_de_area(uuid, uuid, uuid, text, uuid, uuid, public.cantidad, text)
  to authenticated;

create or replace function public.resolver_propuesta_material(p_detalle uuid, p_aprobar boolean)
returns uuid language plpgsql security definer set search_path = 'public' as $$
declare v_id uuid; v_material uuid; v_orden uuid;
begin
  perform public.exigir_permiso('diseno.planos');
  select m.material_id, m.orden_id into v_material, v_orden
    from public.requerimiento_material_detalles d
    join public.ot_materiales m on m.id = d.ot_material_id
    join public.ordenes_trabajo o on o.id = m.orden_id
   where d.id = p_detalle and o.estado::text <> 'ANULADA';
  if v_material is null then
    raise exception 'No se puede aprobar material de una OT anulada.' using errcode = 'check_violation';
  end if;
  update public.requerimiento_material_detalles
     set aprobacion_diseno = case when p_aprobar then 'APROBADO' else 'RECHAZADO' end,
         aprobado_por = public.usuario_actual(), aprobado_en = now()
   where id = p_detalle and aprobacion_diseno = 'PROPUESTO'
   returning id into v_id;
  if v_id is null then
    raise exception 'La propuesta no está pendiente de Diseño.' using errcode = 'check_violation';
  end if;
  if p_aprobar then
    update public.materiales set activo = true
     where id = v_material and creado_desde_ot = v_orden and not activo;
  end if;
  return v_id;
end;
$$;
revoke all on function public.resolver_propuesta_material(uuid, boolean) from public, anon;
grant execute on function public.resolver_propuesta_material(uuid, boolean) to authenticated;
