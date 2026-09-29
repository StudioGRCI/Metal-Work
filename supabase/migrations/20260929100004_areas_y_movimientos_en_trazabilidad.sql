-- Las etapas de esta OT solo pertenecen a las áreas que participan en su flujo.
create or replace function public.validar_area_etapa_ot()
returns trigger language plpgsql set search_path = 'public' as $$
begin
  if not exists (
    select 1 from public.areas a where a.id = new.area_id
      and a.activo and a.codigo in ('ADM','DIS','PRD','MTZ','ACB')
  ) then
    raise exception 'El área elegida no participa en las etapas de la OT.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.validar_area_etapa_ot() from public, anon, authenticated;
drop trigger if exists trg_validar_area_etapa_ot on public.ot_etapas;
create trigger trg_validar_area_etapa_ot
  before insert or update of area_id on public.ot_etapas
  for each row execute function public.validar_area_etapa_ot();

-- Compra, comprobante y movimiento de almacén forman parte de la historia de la OT.
-- Los documentos ya tienen su auditoría técnica; esta función añade la vista operativa.
create or replace function public.registrar_abastecimiento_en_ot()
returns trigger language plpgsql security definer set search_path = 'public' as $$
declare
  v_fila jsonb;
  v_orden uuid;
  v_nombre text;
  v_actor uuid;
begin
  v_fila := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  if tg_table_name = 'movimientos_materiales' then
    select r.orden_id into v_orden
      from public.requerimiento_material_detalles d
      join public.requerimientos_materiales r on r.id = d.requerimiento_id
     where d.id = (v_fila->>'requerimiento_detalle_id')::uuid;
    if v_orden is null then
      select r.orden_id into v_orden
        from public.orden_compra_material_detalles d
        join public.requerimientos_materiales r on r.id = d.requerimiento_id
       where d.id = (v_fila->>'orden_compra_detalle_id')::uuid;
    end if;
    v_nombre := case v_fila->>'tipo'
      when 'SALIDA' then 'Despacho de almacén'
      when 'ENTRADA' then 'Ingreso a almacén'
      else 'Movimiento de material' end;
    v_actor := coalesce((v_fila->>'registrado_por')::uuid, public.usuario_actual());
  elsif tg_table_name = 'ordenes_compra_materiales' then
    select r.orden_id into v_orden from public.requerimientos_materiales r
     where r.id = (v_fila->>'requerimiento_id')::uuid;
    v_nombre := 'Compra de materiales';
    v_actor := coalesce((v_fila->>'creado_por')::uuid, public.usuario_actual());
  elsif tg_table_name = 'orden_compra_material_detalles' then
    select r.orden_id into v_orden from public.requerimientos_materiales r
     where r.id = (v_fila->>'requerimiento_id')::uuid;
    v_nombre := 'Detalle de compra';
    v_actor := public.usuario_actual();
  elsif tg_table_name = 'documentos_compra_material' then
    select r.orden_id into v_orden
      from public.ordenes_compra_materiales c
      join public.requerimientos_materiales r on r.id = c.requerimiento_id
     where c.id = (v_fila->>'orden_compra_id')::uuid;
    v_nombre := 'Documento de compra';
    v_actor := coalesce((v_fila->>'subido_por')::uuid, public.usuario_actual());
  end if;
  if v_orden is not null then
    insert into public.ot_bitacora (orden_id,tipo_evento,descripcion,datos,usuario_id)
    values (v_orden,'COMENTARIO',v_nombre || case tg_op
      when 'INSERT' then ' registrado'
      when 'UPDATE' then ' actualizado'
      else ' retirado' end,
      jsonb_build_object('tabla',tg_table_name,'registro_id',v_fila->>'id','accion',tg_op),v_actor);
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function public.registrar_abastecimiento_en_ot() from public, anon, authenticated;
drop trigger if exists trg_abastecimiento_bitacora on public.movimientos_materiales;
create trigger trg_abastecimiento_bitacora after insert or update or delete on public.movimientos_materiales
  for each row execute function public.registrar_abastecimiento_en_ot();
drop trigger if exists trg_abastecimiento_bitacora on public.ordenes_compra_materiales;
create trigger trg_abastecimiento_bitacora after insert or update or delete on public.ordenes_compra_materiales
  for each row execute function public.registrar_abastecimiento_en_ot();
drop trigger if exists trg_abastecimiento_bitacora on public.orden_compra_material_detalles;
create trigger trg_abastecimiento_bitacora after insert or update or delete on public.orden_compra_material_detalles
  for each row execute function public.registrar_abastecimiento_en_ot();
drop trigger if exists trg_abastecimiento_bitacora on public.documentos_compra_material;
create trigger trg_abastecimiento_bitacora after insert or update or delete on public.documentos_compra_material
  for each row execute function public.registrar_abastecimiento_en_ot();
