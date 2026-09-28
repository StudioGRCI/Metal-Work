-- El permiso genérico ordenes.editar también pertenece a JEFE_TALLER.
-- Las fechas de cada etapa pertenecen exclusivamente a Administración.
create or replace function public.programar_etapa_administracion(
  p_etapa_id uuid, p_inicio date, p_fin date)
returns uuid language plpgsql security definer set search_path to 'public'
as $$
declare
  v_orden text;
  v_orden_id uuid;
  v_estado public.estado_ot;
  v_inicio date;
  v_fin date;
begin
  perform public.exigir_permiso('ordenes.editar');
  if public.mi_rol() is distinct from 'ADMINISTRACION' then
    raise exception 'Solo Administración programa las fechas de las etapas.';
  end if;
  select o.numero, o.id, o.estado into v_orden, v_orden_id, v_estado
    from public.ot_etapas e join public.ordenes_trabajo o on o.id = e.orden_id
   where e.id = p_etapa_id for update of e;
  if not found then raise exception 'La etapa no existe'; end if;
  if v_estado in ('ANULADA', 'ENTREGADA', 'FACTURADA', 'TERMINADA') then
    raise exception 'La OT % ya está cerrada; no se puede programar', v_orden;
  end if;
  if p_inicio is null or p_fin is null or p_fin < p_inicio then
    raise exception 'Indique inicio y fin válidos para la etapa de la OT %', v_orden;
  end if;
  update public.ot_etapas
     set fecha_inicio_programada = p_inicio, fecha_fin_programada = p_fin
   where id = p_etapa_id
     and (fecha_inicio_programada, fecha_fin_programada)
         is distinct from (p_inicio, p_fin);
  if not exists (select 1 from public.ot_etapas where orden_id = v_orden_id
      and (fecha_inicio_programada is null or fecha_fin_programada is null)) then
    select min(fecha_inicio_programada), max(fecha_fin_programada)
      into v_inicio, v_fin from public.ot_etapas where orden_id = v_orden_id;
    update public.ordenes_trabajo set
      fecha_inicio_programada = v_inicio, fecha_fin_programada = v_fin
    where id = v_orden_id
      and (fecha_inicio_programada, fecha_fin_programada)
          is distinct from (v_inicio, v_fin);
  end if;
  return p_etapa_id;
end;
$$;
revoke all on function public.programar_etapa_administracion(uuid,date,date) from public, anon;
grant execute on function public.programar_etapa_administracion(uuid,date,date) to authenticated;

create or replace function public.fn_ot_etapa_responsabilidades()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if new.orden_id is distinct from old.orden_id
     or new.etapa_catalogo_id is distinct from old.etapa_catalogo_id then
    raise exception 'No se puede cambiar la orden ni el catálogo de una etapa ya creada';
  end if;
  if new.horas_estimadas is distinct from old.horas_estimadas
     and not (public.es_admin() or public.tiene_permiso('diseno.planos')) then
    raise exception 'Solo Diseño define las horas previstas de la etapa';
  end if;
  if new.fecha_inicio_programada is distinct from old.fecha_inicio_programada
     or new.fecha_fin_programada is distinct from old.fecha_fin_programada then
    if public.mi_rol() is distinct from 'ADMINISTRACION' then
      raise exception 'Solo Administración programa las fechas de las etapas';
    end if;
  end if;
  if new.orden_secuencia is distinct from old.orden_secuencia
     and not (public.es_admin() or public.tiene_permiso('diseno.planos')) then
    raise exception 'Solo Diseño ordena las etapas de producción';
  end if;
  if new.estado is distinct from old.estado
     or new.avance_porcentaje is distinct from old.avance_porcentaje
     or new.horas_reales is distinct from old.horas_reales then
    if not (current_user = 'postgres' or public.es_admin()
      or public.tiene_permiso('produccion.registrar')) then
      raise exception 'Solo Producción registra el avance de las etapas';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.fn_ot_etapa_responsabilidades() from public, anon, authenticated;
