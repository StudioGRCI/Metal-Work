-- En el flujo manual, Diseño define etapas y planos; Supervisión crea las
-- tareas de su propia área. La política anterior admitía cualquier área en
-- INSERT y conservaba a Diseño en UPDATE/DELETE.
create or replace function public.puede_editar_tarea_ot(p_orden_id uuid, p_area_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select case when o.plan_etapas_manual then
    public.tiene_permiso('produccion.registrar') and exists (
      select 1 from public.usuarios u
      join public.roles r on r.id = u.rol_id
      where u.id = public.usuario_actual() and u.activo
        and r.codigo = 'SUPERVISOR' and u.area_id = p_area_id
    )
  else public.puede_armar_hoja_de_area(p_area_id) end
  from public.ordenes_trabajo o where o.id = p_orden_id;
$$;
revoke all on function public.puede_editar_tarea_ot(uuid, uuid) from public, anon;
grant execute on function public.puede_editar_tarea_ot(uuid, uuid) to authenticated;

drop policy if exists crear_ot_actividades on public.ot_actividades;
create policy crear_ot_actividades on public.ot_actividades
for insert to authenticated
with check (coalesce(public.puede_editar_tarea_ot(orden_id, area_id), false));

drop policy if exists editar_ot_actividades on public.ot_actividades;
create policy editar_ot_actividades on public.ot_actividades
for update to authenticated
using (coalesce(public.puede_editar_tarea_ot(orden_id, area_id), false))
with check (coalesce(public.puede_editar_tarea_ot(orden_id, area_id), false));

drop policy if exists borrar_ot_actividades on public.ot_actividades;
create policy borrar_ot_actividades on public.ot_actividades
for delete to authenticated
using (coalesce(public.puede_editar_tarea_ot(orden_id, area_id), false));

-- También se comprueba en el disparador: protege la misma regla cuando una
-- función de servidor escribe con privilegios superiores al RLS.
create or replace function public.validar_editor_tarea_ot()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and
     not coalesce(public.puede_editar_tarea_ot(old.orden_id, old.area_id), false) then
    raise exception 'Solo Supervisión del área puede modificar esta tarea.';
  end if;
  if tg_op in ('INSERT', 'UPDATE') and
     not coalesce(public.puede_editar_tarea_ot(new.orden_id, new.area_id), false) then
    raise exception 'Solo Supervisión del área puede crear o modificar esta tarea.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.validar_editor_tarea_ot() from public, anon, authenticated;
drop trigger if exists trg_validar_editor_tarea_ot on public.ot_actividades;
create trigger trg_validar_editor_tarea_ot before insert or update or delete
on public.ot_actividades for each row execute function public.validar_editor_tarea_ot();
