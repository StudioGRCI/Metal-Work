-- Equipo nominal de Diseño, edición acotada por Administración y eventos de OT.
-- Destino: METAL WORK (usnbwnemfqyjjkzdizgv).

create table if not exists public.ot_equipo_diseno (
  id uuid primary key default gen_random_uuid(),
  orden_id uuid not null references public.ordenes_trabajo(id) on delete restrict,
  nombre text not null check (length(btrim(nombre)) between 2 and 120),
  funcion text not null check (funcion in ('RESPONSABLE', 'COLABORADOR')),
  creado_por uuid references public.usuarios(id) on delete set null,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create unique index if not exists ux_ot_equipo_diseno_nombre
  on public.ot_equipo_diseno (orden_id, lower(btrim(nombre)));
create unique index if not exists ux_ot_equipo_diseno_responsable
  on public.ot_equipo_diseno (orden_id) where funcion = 'RESPONSABLE';
create index if not exists ix_ot_equipo_diseno_creado_por
  on public.ot_equipo_diseno (creado_por) where creado_por is not null;
select public.activar_timestamps('ot_equipo_diseno');
select public.activar_auditoria('ot_equipo_diseno');

create or replace function public.proteger_equipo_diseno_ot()
returns trigger language plpgsql security definer set search_path = 'public' as $$
declare v_orden uuid;
begin
  perform public.exigir_permiso('diseno.planos');
  v_orden := case when tg_op = 'DELETE' then old.orden_id else new.orden_id end;
  if tg_op = 'UPDATE' and new.orden_id is distinct from old.orden_id then
    raise exception 'El equipo no puede moverse a otra OT.' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.ordenes_trabajo
    where id = v_orden and estado not in ('ENTREGADA','FACTURADA','ANULADA')) then
    raise exception 'La OT está cerrada.' using errcode = 'check_violation';
  end if;
  if tg_op = 'INSERT' then
    new.creado_por := public.usuario_actual();
  elsif tg_op = 'UPDATE' and new.creado_por is distinct from old.creado_por then
    raise exception 'El autor del equipo no puede cambiarse.' using errcode = 'check_violation';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function public.proteger_equipo_diseno_ot() from public, anon, authenticated;
drop trigger if exists trg_proteger_equipo_diseno_ot on public.ot_equipo_diseno;
create trigger trg_proteger_equipo_diseno_ot
  before insert or update or delete on public.ot_equipo_diseno
  for each row execute function public.proteger_equipo_diseno_ot();

alter table public.ot_equipo_diseno enable row level security;
drop policy if exists ver_equipo_diseno_ot on public.ot_equipo_diseno;
create policy ver_equipo_diseno_ot on public.ot_equipo_diseno
  for select to authenticated using (public.puede_ver_orden(orden_id));
drop policy if exists crear_equipo_diseno_ot on public.ot_equipo_diseno;
create policy crear_equipo_diseno_ot on public.ot_equipo_diseno
  for insert to authenticated
  with check (public.tiene_permiso('diseno.planos') and public.puede_ver_orden(orden_id));
drop policy if exists editar_equipo_diseno_ot on public.ot_equipo_diseno;
create policy editar_equipo_diseno_ot on public.ot_equipo_diseno
  for update to authenticated
  using (public.tiene_permiso('diseno.planos') and public.puede_ver_orden(orden_id))
  with check (public.tiene_permiso('diseno.planos') and public.puede_ver_orden(orden_id));
drop policy if exists quitar_equipo_diseno_ot on public.ot_equipo_diseno;
create policy quitar_equipo_diseno_ot on public.ot_equipo_diseno
  for delete to authenticated
  using (public.tiene_permiso('diseno.planos') and public.puede_ver_orden(orden_id));
revoke all on public.ot_equipo_diseno from public, anon, authenticated;
grant select, insert, update, delete on public.ot_equipo_diseno to authenticated;

alter table public.ot_planos
  add column if not exists integrante_diseno_id uuid
  references public.ot_equipo_diseno(id) on delete restrict;
create index if not exists ix_ot_planos_integrante_diseno
  on public.ot_planos (integrante_diseno_id) where integrante_diseno_id is not null;

create or replace function public.validar_integrante_plano()
returns trigger language plpgsql security definer set search_path = 'public' as $$
begin
  if tg_op = 'UPDATE' and new.integrante_diseno_id is not distinct from old.integrante_diseno_id then return new; end if;
  perform public.exigir_permiso('diseno.planos');
  if new.integrante_diseno_id is not null and not exists (
    select 1 from public.ot_equipo_diseno e
     where e.id = new.integrante_diseno_id and e.orden_id = new.orden_id
  ) then
    raise exception 'El integrante de Diseño debe pertenecer a esta OT.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.validar_integrante_plano() from public, anon, authenticated;
drop trigger if exists trg_validar_integrante_plano on public.ot_planos;
create trigger trg_validar_integrante_plano
  before insert or update of integrante_diseno_id on public.ot_planos
  for each row execute function public.validar_integrante_plano();

-- El cambio de estos dos datos se limita al rol Administración y queda en la bitácora.
create or replace function public.editar_resumen_ot_administracion(
  p_orden uuid, p_version timestamptz, p_version_unidad timestamptz,
  p_marca text, p_modelo text, p_anio integer, p_responsable uuid, p_motivo text
) returns uuid language plpgsql security definer set search_path = 'public' as $$
declare
  v_orden public.ordenes_trabajo%rowtype;
  v_unidad public.unidades%rowtype;
  v_antes jsonb;
  v_despues jsonb;
begin
  if not exists (
    select 1 from public.usuarios u join public.roles r on r.id = u.rol_id
     where u.id = public.usuario_actual() and u.activo and r.codigo = 'ADMINISTRACION'
  ) then raise exception 'Solo Administración puede editar vehículo y responsable.' using errcode = 'insufficient_privilege'; end if;
  perform public.exigir_permiso('ordenes.editar');
  if length(btrim(coalesce(p_motivo,''))) not between 5 and 500
    or length(btrim(coalesce(p_marca,''))) > 80
    or length(btrim(coalesce(p_modelo,''))) > 80
    or (p_anio is not null and p_anio not between 1950 and 2100) then
    raise exception 'Revisa el vehículo, el año y el motivo del cambio.' using errcode = 'check_violation';
  end if;
  select * into v_orden from public.ordenes_trabajo where id = p_orden for update;
  if not found or not public.puede_ver_orden(p_orden) then
    raise exception 'La OT no existe o está fuera de tu alcance.' using errcode = 'insufficient_privilege';
  end if;
  if v_orden.estado in ('ENTREGADA','FACTURADA','ANULADA') then
    raise exception 'La OT está cerrada.' using errcode = 'check_violation';
  end if;
  if v_orden.actualizado_en is distinct from p_version then
    raise exception 'La OT cambió. Recarga antes de guardar.' using errcode = 'check_violation';
  end if;
  if v_orden.unidad_id is null then
    raise exception 'Esta OT todavía no tiene una unidad vinculada.' using errcode = 'check_violation';
  end if;
  select * into v_unidad from public.unidades where id = v_orden.unidad_id for update;
  if v_unidad.actualizado_en is distinct from p_version_unidad then
    raise exception 'El vehículo cambió. Recarga antes de guardar.' using errcode = 'check_violation';
  end if;
  if p_responsable is not null and not exists (
    select 1 from public.usuarios where id = p_responsable and activo and not es_operario
  ) then raise exception 'El responsable elegido no está activo.' using errcode = 'check_violation'; end if;
  if exists (select 1 from public.ordenes_trabajo where unidad_id = v_unidad.id and id <> p_orden)
     and (v_unidad.marca is distinct from nullif(btrim(p_marca),'')
       or v_unidad.modelo is distinct from nullif(btrim(p_modelo),'')
       or v_unidad.anio is distinct from p_anio) then
    raise exception 'La unidad pertenece a otra OT; edita sus datos desde el registro de unidades.'
      using errcode = 'check_violation';
  end if;
  v_antes := jsonb_build_object('marca',v_unidad.marca,'modelo',v_unidad.modelo,
    'anio',v_unidad.anio,'responsable_id',v_orden.responsable_id);
  v_despues := jsonb_build_object('marca',nullif(btrim(p_marca),''),
    'modelo',nullif(btrim(p_modelo),''),'anio',p_anio,'responsable_id',p_responsable);
  if v_antes = v_despues then raise exception 'No hay cambios para guardar.' using errcode = 'check_violation'; end if;
  update public.unidades set marca = nullif(btrim(p_marca),''),
    modelo = nullif(btrim(p_modelo),''), anio = p_anio where id = v_unidad.id;
  update public.ordenes_trabajo set responsable_id = p_responsable where id = p_orden;
  perform public.ot_registrar_evento_interna(p_orden,'COMENTARIO',
    'Administración corrigió vehículo y/o responsable. Motivo: ' || btrim(p_motivo),
    jsonb_build_object('edicion_resumen',true,'antes',v_antes,'despues',v_despues,'motivo',btrim(p_motivo)));
  return p_orden;
end;
$$;
revoke all on function public.editar_resumen_ot_administracion(uuid,timestamptz,timestamptz,text,text,integer,uuid,text)
  from public, anon, authenticated;
grant execute on function public.editar_resumen_ot_administracion(uuid,timestamptz,timestamptz,text,text,integer,uuid,text)
  to authenticated;

-- La auditoría ya recibe cambios de estas tablas. Publicamos solo una descripción
-- acotada en la bitácora visible de la OT, sin exponer datos_antes/datos_despues.
create or replace function public.auditoria_a_bitacora_ot()
returns trigger language plpgsql security definer set search_path = 'public' as $$
declare
  v_orden uuid;
  v_titulo text;
begin
  if new.tabla not in ('ot_materiales','requerimientos_materiales',
    'requerimiento_material_detalles','ot_planos','ot_plano_versiones',
    'ot_etapas','ot_actividades','ot_actividad_avances','ot_equipo_diseno') then
    return new;
  end if;
  if new.tabla = 'requerimiento_material_detalles' then
    select r.orden_id into v_orden from public.requerimientos_materiales r
     where r.id = coalesce(new.datos_despues->>'requerimiento_id',
                           new.datos_antes->>'requerimiento_id')::uuid;
  elsif new.tabla = 'ot_actividad_avances' then
    select a.orden_id into v_orden from public.ot_actividades a
     where a.id = coalesce(new.datos_despues->>'actividad_id',
                           new.datos_antes->>'actividad_id')::uuid;
  elsif new.tabla = 'ot_plano_versiones' then
    select p.orden_id into v_orden from public.ot_planos p
     where p.id = coalesce(new.datos_despues->>'plano_id',
                           new.datos_antes->>'plano_id')::uuid;
  else
    v_orden := nullif(coalesce(new.datos_despues->>'orden_id',new.datos_antes->>'orden_id'),'')::uuid;
  end if;
  if v_orden is null then return new; end if;
  v_titulo := case new.tabla
    when 'ot_materiales' then 'Material'
    when 'requerimientos_materiales' then 'Solicitud de materiales'
    when 'requerimiento_material_detalles' then 'Detalle de solicitud'
    when 'ot_planos' then 'Plano'
    when 'ot_plano_versiones' then 'Revisión de plano'
    when 'ot_etapas' then 'Etapa'
    when 'ot_actividades' then 'Tarea de taller'
    when 'ot_actividad_avances' then 'Reporte de avance'
    else 'Equipo de Diseño' end;
  insert into public.ot_bitacora (orden_id,tipo_evento,descripcion,datos,usuario_id)
  values (v_orden,'COMENTARIO',
    v_titulo || case new.accion
      when 'INSERT' then ' agregado'
      when 'UPDATE' then ' modificado'
      else ' retirado' end ||
      case when new.accion = 'UPDATE' and array_length(new.campos_modificados,1) > 0
        then '. Campos: ' || array_to_string(new.campos_modificados, ', ') else '' end,
    jsonb_build_object('tabla',new.tabla,'registro_id',new.registro_id,'accion',new.accion),
    new.usuario_id);
  return new;
end;
$$;
revoke all on function public.auditoria_a_bitacora_ot() from public, anon, authenticated;
drop trigger if exists trg_auditoria_a_bitacora_ot on public.audit_log;
create trigger trg_auditoria_a_bitacora_ot after insert on public.audit_log
  for each row execute function public.auditoria_a_bitacora_ot();
