-- Crear la compra y fijar su condición de pago en una sola transacción.
create or replace function public.crear_orden_compra_material_con_pago(
  p_id uuid, p_requerimiento_id uuid, p_proveedor text, p_referencia text,
  p_detalles jsonb, p_fecha_estimada date, p_condicion text,
  p_dias integer, p_moneda text
) returns uuid language plpgsql security definer set search_path='public' as $$
declare v_compra uuid;
begin
  perform public.exigir_permiso('compras.crear');
  v_compra:=public.crear_orden_compra_material(
    p_id=>p_id,p_requerimiento_id=>p_requerimiento_id,p_proveedor=>p_proveedor,
    p_referencia=>p_referencia,p_detalles=>p_detalles,p_fecha_estimada=>p_fecha_estimada
  );
  perform public.fijar_condicion_pago_compra(v_compra,p_condicion,p_dias,p_moneda);
  return v_compra;
end $$;
revoke all on function public.crear_orden_compra_material_con_pago(uuid,uuid,text,text,jsonb,date,text,integer,text) from public,anon;
grant execute on function public.crear_orden_compra_material_con_pago(uuid,uuid,text,text,jsonb,date,text,integer,text) to authenticated;
