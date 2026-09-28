-- Diseño define los pasos de cada OT. Los jefes de producción y taller dan
-- vistos buenos independientes; los pasos ya registrados permanecen intactos.

alter table public.ot_verificaciones
  add column if not exists avance_1_por uuid references public.usuarios(id) on delete set null,
  add column if not exists avance_2_por uuid references public.usuarios(id) on delete set null;

alter table public.ot_verificaciones drop constraint if exists ck_verif_orden;

-- La ficha automática conserva los accesorios; ya no inventa pasos al aprobar.
create or replace function public.armar_ficha_ot(p_orden uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_tipo uuid;
  v_plantilla uuid;
begin
  if pg_trigger_depth() = 0 then
    if public.usuario_actual() is null then raise exception 'Inicia sesión.'; end if;
    perform public.exigir_permiso('diseno.planos');
    if not exists (select 1 from public.ordenes_trabajo
      where id = p_orden and estado not in ('ENTREGADA','FACTURADA','ANULADA')) then
      raise exception 'La OT no existe o está cerrada.';
    end if;
  end if;
  if public.usuario_actual() is not null and not (
    public.puede_ver_orden(p_orden) and
    (public.es_admin() or public.tiene_permiso('ordenes.editar')
     or public.tiene_permiso('ordenes.crear')
     or public.tiene_permiso('ordenes.aprobar')
     or public.tiene_permiso('ordenes.cambiar_estado')
     or public.tiene_permiso('produccion.registrar')
     or public.tiene_permiso('diseno.planos'))) then
    raise exception 'No puede armar la ficha de una orden que no le corresponde'
      using errcode = 'insufficient_privilege';
  end if;

  select tipo_carroceria_id into v_tipo from public.ordenes_trabajo where id = p_orden;
  if v_tipo is not null then
    select id into v_plantilla from public.plantillas_ficha
     where tipo_carroceria_id = v_tipo and activa
     order by creado_en desc limit 1;
  end if;
  if v_plantilla is not null
     and not exists (select 1 from public.ot_accesorios where orden_id = p_orden) then
    insert into public.ot_accesorios
      (orden_id, orden, cantidad, unidad, descripcion, incluye_el_accesorio)
    select p_orden, a.orden, a.cantidad, a.unidad, a.descripcion, a.incluye_el_accesorio
      from public.plantilla_ficha_accesorios a where a.plantilla_id = v_plantilla;
  end if;
end;
$$;

drop policy if exists crear_ot_verificaciones on public.ot_verificaciones;
create policy crear_ot_verificaciones on public.ot_verificaciones
  for insert to authenticated with check (
    public.tiene_permiso('diseno.planos') and exists (
      select 1 from public.usuarios u join public.roles r on r.id = u.rol_id
      where u.id = public.usuario_actual() and u.activo and r.codigo = 'DISENO')
    and public.puede_ver_orden(orden_id)
    and exists (select 1 from public.ordenes_trabajo o
      where o.id = orden_id and o.estado not in ('ENTREGADA','FACTURADA','ANULADA'))
  );

drop policy if exists editar_ot_verificaciones on public.ot_verificaciones;
create policy editar_ot_verificaciones on public.ot_verificaciones
  for update to authenticated using (
    public.puede_ver_orden(orden_id) and
    (public.tiene_permiso('diseno.planos') or exists (
      select 1 from public.usuarios u join public.roles r on r.id = u.rol_id
       where u.id = public.usuario_actual() and u.activo
         and r.codigo in ('JEFE_PRODUCCION','JEFE_TALLER')))
  ) with check (public.puede_ver_orden(orden_id));

drop policy if exists borrar_ot_verificaciones on public.ot_verificaciones;
create policy borrar_ot_verificaciones on public.ot_verificaciones
  for delete to authenticated using (
    public.tiene_permiso('diseno.planos') and public.puede_ver_orden(orden_id)
    and not avance_1 and not avance_2
    and exists (select 1 from public.ordenes_trabajo o
      where o.id = orden_id and o.estado not in ('ENTREGADA','FACTURADA','ANULADA'))
  );

create or replace function public.fn_guardar_marcas_verificacion()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_rol text;
begin
  select r.codigo into v_rol from public.usuarios u
    join public.roles r on r.id = u.rol_id
   where u.id = public.usuario_actual() and u.activo;
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.ordenes_trabajo
      where id = new.orden_id and estado not in ('ENTREGADA','FACTURADA','ANULADA')) then
      raise exception 'No se pueden agregar pasos a una OT cerrada.';
    end if;
    if v_rol is distinct from 'DISENO' or not public.tiene_permiso('diseno.planos') then
      raise exception 'Solo Diseño puede crear pasos de verificación.';
    end if;
    if new.avance_1 or new.avance_2 then
      raise exception 'El paso debe crearse sin vistos buenos.';
    end if;
    new.avance_1_en := null; new.avance_2_en := null;
    new.avance_1_por := null; new.avance_2_por := null;
    return new;
  end if;

  if exists (select 1 from public.ordenes_trabajo
    where id = old.orden_id and estado in ('ENTREGADA','FACTURADA','ANULADA')) then
    raise exception 'No se pueden modificar pasos de una OT cerrada.';
  end if;

  if new.orden_id is distinct from old.orden_id
     or new.numero is distinct from old.numero
     or new.descripcion is distinct from old.descripcion
     or new.observaciones is distinct from old.observaciones
     or new.responsable_id is distinct from old.responsable_id then
    if (old.avance_1 or old.avance_2)
       and (new.numero is distinct from old.numero
            or new.descripcion is distinct from old.descripcion) then
      raise exception 'No se puede cambiar un paso que ya tiene un visto bueno.';
    end if;
    if not public.tiene_permiso('diseno.planos') then
      raise exception 'Solo Diseño puede modificar los datos del paso.';
    end if;
  end if;
  if new.avance_1_en is distinct from old.avance_1_en
     or new.avance_2_en is distinct from old.avance_2_en
     or new.avance_1_por is distinct from old.avance_1_por
     or new.avance_2_por is distinct from old.avance_2_por then
    raise exception 'Las fechas y autores de los vistos buenos los registra el sistema.';
  end if;
  if new.avance_1 is distinct from old.avance_1 then
    if old.avance_1 and old.avance_1_por is null then
      raise exception 'Este visto bueno anterior no tiene autor identificado y no se puede retirar.';
    end if;
    if v_rol <> 'JEFE_PRODUCCION' or v_rol is null then
      raise exception 'Solo el jefe de producción puede marcar su visto bueno.';
    end if;
    new.avance_1_en := case when new.avance_1 then now() else null end;
    new.avance_1_por := case when new.avance_1 then public.usuario_actual() else null end;
  end if;
  if new.avance_2 is distinct from old.avance_2 then
    if old.avance_2 and old.avance_2_por is null then
      raise exception 'Este visto bueno anterior no tiene autor identificado y no se puede retirar.';
    end if;
    if v_rol <> 'JEFE_TALLER' or v_rol is null then
      raise exception 'Solo el jefe de taller puede marcar su visto bueno.';
    end if;
    new.avance_2_en := case when new.avance_2 then now() else null end;
    new.avance_2_por := case when new.avance_2 then public.usuario_actual() else null end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guardar_marcas_verificacion on public.ot_verificaciones;
create trigger trg_guardar_marcas_verificacion
  before insert or update on public.ot_verificaciones
  for each row execute function public.fn_guardar_marcas_verificacion();
revoke all on function public.fn_guardar_marcas_verificacion() from public, anon, authenticated;
