-- La solicitud exige el mismo acceso al plano que la pantalla del área.
CREATE OR REPLACE FUNCTION public.proponer_material_de_area(p_orden uuid, p_plano uuid, p_material uuid, p_cantidad cantidad, p_observacion text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if not public.puede_ver_plano_tecnico(p_plano) then
    raise exception 'Diseño debe liberar el plano a tu área antes de solicitar sus materiales.' using errcode = 'insufficient_privilege';
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
$function$;
