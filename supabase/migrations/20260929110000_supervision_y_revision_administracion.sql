-- METAL WORK: Supervisión de Producción y Maestranza marca su verificación; Administración revisa los reportes.
insert into public.roles_permisos(rol_id, permiso_codigo)
select id, 'produccion.aprobar_reportes' from public.roles where codigo = 'ADMINISTRACION'
on conflict do nothing;
insert into public.roles_permisos(rol_id, permiso_codigo)
select id, 'ordenes.revisar_taller' from public.roles where codigo = 'ADMINISTRACION'
on conflict do nothing;

drop policy if exists editar_ot_verificaciones on public.ot_verificaciones;
create policy editar_ot_verificaciones on public.ot_verificaciones for update to authenticated
using (public.puede_ver_orden(orden_id) and (public.tiene_permiso('diseno.planos') or exists (
  select 1 from public.usuarios u join public.roles r on r.id = u.rol_id join public.areas a on a.id = u.area_id
  where u.id = public.usuario_actual() and u.activo and r.codigo = 'SUPERVISOR' and a.codigo in ('PRD','MTZ'))))
with check (public.puede_ver_orden(orden_id));

drop policy if exists editar_ot_actividad_avances on public.ot_actividad_avances;
create policy editar_ot_actividad_avances on public.ot_actividad_avances for update to authenticated
using (public.es_admin() or public.tiene_permiso('produccion.aprobar_reportes') or
  (public.tiene_permiso('produccion.registrar') and not (select plan_etapas_manual from public.ordenes_trabajo where id = orden_id)) or
  (public.tiene_permiso('produccion.reportar_tarea') and (select plan_etapas_manual from public.ordenes_trabajo where id = orden_id)))
with check (public.es_admin() or public.tiene_permiso('produccion.aprobar_reportes') or
  (public.tiene_permiso('produccion.registrar') and not (select plan_etapas_manual from public.ordenes_trabajo where id = orden_id)) or
  (public.tiene_permiso('produccion.reportar_tarea') and (select plan_etapas_manual from public.ordenes_trabajo where id = orden_id)));

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
    if v_rol is distinct from 'SUPERVISOR' or not exists (select 1 from public.usuarios u join public.areas a on a.id = u.area_id where u.id = public.usuario_actual() and u.activo and a.codigo = 'PRD') then
      raise exception 'Solo Supervisión de Producción puede marcar su visto bueno.';
    end if;
    new.avance_1_en := case when new.avance_1 then now() else null end;
    new.avance_1_por := case when new.avance_1 then public.usuario_actual() else null end;
  end if;
  if new.avance_2 is distinct from old.avance_2 then
    if old.avance_2 and old.avance_2_por is null then
      raise exception 'Este visto bueno anterior no tiene autor identificado y no se puede retirar.';
    end if;
    if v_rol is distinct from 'SUPERVISOR' or not exists (select 1 from public.usuarios u join public.areas a on a.id = u.area_id where u.id = public.usuario_actual() and u.activo and a.codigo = 'MTZ') then
      raise exception 'Solo Supervisión de Maestranza puede marcar su visto bueno.';
    end if;
    new.avance_2_en := case when new.avance_2 then now() else null end;
    new.avance_2_por := case when new.avance_2 then public.usuario_actual() else null end;
  end if;
  return new;
end;
$$;

create or replace function public.fn_reporte_revision()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_aprueba   constant boolean := public.es_admin() or public.tiene_permiso('produccion.aprobar_reportes');
  v_ignorar   constant text[] := array['revision', 'revisado_por', 'revisado_en', 'observacion',
                                       'corregido_en', 'actualizado_en'];
  v_revisa    boolean;
  v_corrige   boolean;
begin
  if tg_op = 'INSERT' then
    -- Lo que escribe quien aprueba nace aprobado: no tiene a quién pedirle el
    -- visto. Lo que manda el formulario en estas columnas no vale.
    if v_aprueba then
      new.revision := 'APROBADO';
      new.revisado_por := public.usuario_actual();
      new.revisado_en := now();
    else
      new.revision := 'PENDIENTE';
      new.revisado_por := null;
      new.revisado_en := null;
    end if;
    new.observacion := null;
    new.corregido_en := null;
    return new;
  end if;

  v_revisa  := new.revision is distinct from old.revision
            or new.observacion is distinct from old.observacion;
  v_corrige := (to_jsonb(new) - v_ignorar) is distinct from (to_jsonb(old) - v_ignorar);

  if v_revisa then
    if not v_aprueba then
      raise exception 'Administración revisa los reportes de Supervisión.'
        using errcode = 'insufficient_privilege';
    end if;
    if new.revision = 'PENDIENTE' then
      new.revisado_por := null;
      new.revisado_en := null;
    else
      new.revisado_por := public.usuario_actual();
      new.revisado_en := now();
    end if;
  else
    new.revisado_por := old.revisado_por;
    new.revisado_en := old.revisado_en;
  end if;

  if v_corrige then
    -- Aprobado queda firme. Solo quien aprueba lo puede tocar: el visto es suyo.
    if old.revision = 'APROBADO' and not v_aprueba then
      raise exception 'Ese reporte ya fue aprobado: queda como está.'
        using errcode = 'check_violation';
    end if;
    -- En el avance con foto de la orden, el porcentaje mueve la etapa y eso
    -- pasa solo al registrarlo (fn_avance_mueve_etapa): corregirlo aquí dejaría
    -- la etapa diciendo otra cosa. El porcentaje bueno va en un avance nuevo.
    if tg_table_name = 'ot_avances'
       and ((to_jsonb(new) -> 'avance_porcentaje') is distinct from (to_jsonb(old) -> 'avance_porcentaje')
            or (to_jsonb(new) -> 'etapa_id') is distinct from (to_jsonb(old) -> 'etapa_id')) then
      raise exception 'El porcentaje de la etapa no se corrige: registra un avance nuevo con el que va.'
        using errcode = 'check_violation';
    end if;
    new.corregido_en := now();
    -- Corregido un observado, vuelve a pedir el visto: el jefe tiene que ver
    -- lo nuevo. La observación se queda como historia.
    if not v_revisa and old.revision = 'OBSERVADO' then
      new.revision := 'PENDIENTE';
      new.revisado_por := null;
      new.revisado_en := null;
    end if;
  else
    new.corregido_en := old.corregido_en;
  end if;

  return new;
end;
$$;

