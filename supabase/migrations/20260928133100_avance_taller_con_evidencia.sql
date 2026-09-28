-- Las tareas de taller usan las actividades existentes. El supervisor informa
-- el avance del día con foto y consumo de material ya despachado a la OT.
alter table public.ot_actividad_avances add column if not exists foto_ruta text;
alter table public.ot_actividad_avances add column if not exists materiales_usados jsonb not null default '[]'::jsonb;
alter table public.ot_actividad_avances drop constraint if exists ck_materiales_usados_array;
alter table public.ot_actividad_avances add constraint ck_materiales_usados_array
  check (jsonb_typeof(materiales_usados) = 'array' and jsonb_array_length(materiales_usados) <= 100);

insert into public.permisos(codigo, modulo, descripcion) values
  ('produccion.reportar_tarea', 'Producción', 'Reportar con foto el avance de una tarea del taller')
on conflict (codigo) do update set descripcion = excluded.descripcion;
insert into public.roles_permisos(rol_id, permiso_codigo)
select id, 'produccion.reportar_tarea' from public.roles
where codigo in ('SUPERVISOR','JEFE_TALLER','JEFE_PRODUCCION')
on conflict do nothing;

create or replace function public.validar_reporte_taller()
returns trigger language plpgsql security definer set search_path = 'public' as $$
declare
  v_manual boolean;
  v_area uuid;
  v_item jsonb;
  v_mov uuid;
  v_cantidad numeric;
  v_despachado numeric;
  v_usado numeric;
  v_orden uuid;
begin
  select o.plan_etapas_manual, a.area_id into v_manual, v_area
    from public.ot_actividades a join public.ordenes_trabajo o on o.id = a.orden_id
   where a.id = new.actividad_id and a.orden_id = new.orden_id;
  if not found then raise exception 'La tarea no pertenece a esta OT.'; end if;
  if not v_manual then return new; end if;
  if not public.tiene_permiso('produccion.reportar_tarea') and not public.es_admin() then
    raise exception 'El reporte de la tarea corresponde al supervisor.';
  end if;
  if not public.puede_ver_hoja_de_area(v_area) then
    raise exception 'Esta tarea corresponde a otra área.';
  end if;
  if tg_op = 'INSERT' and new.reportado_por is distinct from public.usuario_actual() then
    raise exception 'El reporte debe quedar a nombre de quien lo registró.';
  end if;
  if tg_op = 'UPDATE' and new.reportado_por is distinct from old.reportado_por then
    raise exception 'No se puede cambiar quién registró el reporte.';
  end if;
  if new.foto_ruta is null or new.foto_ruta not like 'ot/' || new.orden_id::text || '/taller/%'
     or length(new.foto_ruta) > 500 then
    raise exception 'Adjunta una foto de esta OT para reportar la tarea.';
  end if;
  if not exists (select 1 from storage.objects s
    where s.bucket_id = 'fotos-avance' and s.name = new.foto_ruta) then
    raise exception 'La foto de evidencia no se encuentra en el almacenamiento.';
  end if;
  if jsonb_typeof(new.materiales_usados) <> 'array'
     or jsonb_array_length(new.materiales_usados) > 100 then
    raise exception 'Revisa los materiales usados en la tarea.';
  end if;
  if exists (select 1 from jsonb_array_elements(new.materiales_usados) x
    group by x->>'movimiento_id' having count(*) > 1) then
    raise exception 'No repitas un mismo despacho de material.';
  end if;
  for v_item in select value from jsonb_array_elements(new.materiales_usados) loop
    begin
      v_mov := (v_item->>'movimiento_id')::uuid;
      v_cantidad := (v_item->>'cantidad')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Revisa el despacho y la cantidad del material usado.';
    end;
    if v_mov is null or v_cantidad is null or v_cantidad <= 0 then
      raise exception 'Cada material usado necesita un despacho y una cantidad mayor a cero.';
    end if;
    -- Serializa reportes del mismo despacho para que dos envíos simultáneos
    -- no puedan consumir más de lo entregado.
    select r.orden_id, m.cantidad into v_orden, v_despachado
      from public.movimientos_materiales m
      join public.requerimiento_material_detalles d on d.id = m.requerimiento_detalle_id
      join public.requerimientos_materiales r on r.id = d.requerimiento_id
     where m.id = v_mov and m.tipo = 'DESPACHO' and r.orden_id = new.orden_id
       and r.area_destino = (select codigo from public.areas where id = v_area)
     for update of m;
    if not found then raise exception 'El material no fue despachado a esta área y OT.'; end if;
    select coalesce(sum((x.value->>'cantidad')::numeric),0) into v_usado
      from public.ot_actividad_avances av
      cross join lateral jsonb_array_elements(av.materiales_usados) x
     where av.id <> new.id and x.value->>'movimiento_id' = v_mov::text;
    if v_usado + v_cantidad > v_despachado then
      raise exception 'La cantidad usada supera lo despachado para este material.';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.validar_reporte_taller() from public, anon, authenticated;
drop trigger if exists trg_validar_reporte_taller on public.ot_actividad_avances;
create trigger trg_validar_reporte_taller before insert or update
on public.ot_actividad_avances for each row execute function public.validar_reporte_taller();

drop policy if exists crear_ot_actividad_avances on public.ot_actividad_avances;
create policy crear_ot_actividad_avances on public.ot_actividad_avances
for insert to authenticated with check (
  public.es_admin() or
  (public.tiene_permiso('produccion.registrar') and
    not (select plan_etapas_manual from public.ordenes_trabajo where id = orden_id)) or
  (public.tiene_permiso('produccion.reportar_tarea') and
    (select plan_etapas_manual from public.ordenes_trabajo where id = orden_id))
);
drop policy if exists editar_ot_actividad_avances on public.ot_actividad_avances;
create policy editar_ot_actividad_avances on public.ot_actividad_avances
for update to authenticated using (
  public.es_admin() or
  (public.tiene_permiso('produccion.registrar') and
    not (select plan_etapas_manual from public.ordenes_trabajo where id = orden_id)) or
  (public.tiene_permiso('produccion.reportar_tarea') and
    (select plan_etapas_manual from public.ordenes_trabajo where id = orden_id))
) with check (
  public.es_admin() or
  (public.tiene_permiso('produccion.registrar') and
    not (select plan_etapas_manual from public.ordenes_trabajo where id = orden_id)) or
  (public.tiene_permiso('produccion.reportar_tarea') and
    (select plan_etapas_manual from public.ordenes_trabajo where id = orden_id))
);
drop policy if exists crear_ot_actividades on public.ot_actividades;
create policy crear_ot_actividades on public.ot_actividades
for insert to authenticated with check (
  public.es_admin() or public.tiene_permiso('produccion.actividades') or
  (public.tiene_permiso('produccion.registrar') and
   (select plan_etapas_manual from public.ordenes_trabajo where id = orden_id) and
   exists (select 1 from public.usuarios u where u.id = public.usuario_actual() and u.area_id = area_id))
);
