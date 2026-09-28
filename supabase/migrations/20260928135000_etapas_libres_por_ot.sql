-- Diseño define las etapas de cada carrocería directamente en su OT. El
-- catálogo antiguo solo queda para leer el historial de las OT anuladas.
alter table public.ot_etapas add column if not exists nombre text;
alter table public.ot_etapas alter column etapa_catalogo_id drop not null;
alter table public.ot_etapas drop constraint if exists ck_ot_etapas_nombre;
alter table public.ot_etapas add constraint ck_ot_etapas_nombre
  check ((etapa_catalogo_id is not null and nombre is null)
    or (etapa_catalogo_id is null and nombre is not null
      and length(btrim(nombre)) between 2 and 120));

create or replace view public.ot_tablero_etapas with (security_invoker = on) as
select e.id as etapa_id, e.orden_id, o.numero as ot_numero,
       o.estado as ot_estado, o.prioridad, o.sede_id,
       c.razon_social as cliente,
       coalesce(u.placa::text, 'FMI '::text || u.numero_fmi) as placa,
       ec.codigo as etapa_codigo, coalesce(e.nombre,ec.nombre) as etapa, ec.permite_paralelo,
       e.orden_secuencia, e.estado, e.avance_porcentaje, e.horas_estimadas,
       e.fecha_inicio_programada, e.fecha_fin_programada,
       e.fecha_inicio_real, e.fecha_fin_real, e.responsable_id
  from public.ot_etapas e
  join public.ordenes_trabajo o on o.id = e.orden_id
  left join public.etapas_catalogo ec on ec.id = e.etapa_catalogo_id
  left join public.clientes c on c.id = o.cliente_id
  left join public.unidades u on u.id = o.unidad_id
 where o.estado not in ('ENTREGADA', 'FACTURADA', 'ANULADA');

-- La edición directa de nombre, área y peso se cierra: solo la función de
-- Diseño puede cambiarlos. Las fechas siguen bajo Administración.
create or replace function public.fn_guardar_etapa_ponderada()
returns trigger language plpgsql set search_path to 'public' as $$
declare v_manual boolean;
begin
  select plan_etapas_manual into v_manual from public.ordenes_trabajo where id=new.orden_id;
  if v_manual and current_user <> 'postgres' and
    (new.nombre is distinct from old.nombre
     or new.area_id is distinct from old.area_id
     or new.peso_pct is distinct from old.peso_pct
     or new.avance_porcentaje is distinct from old.avance_porcentaje
     or new.estado is distinct from old.estado) then
    raise exception 'El nombre, área y peso los define Diseño; el avance sale de los reportes.';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_guardar_etapa_ponderada() from public, anon, authenticated;

create or replace function public.fn_ot_etapa_bitacora()
returns trigger language plpgsql set search_path to 'public' as $$
declare v_etapa text;
begin
  v_etapa := coalesce(new.nombre,
    (select nombre from public.etapas_catalogo where id=new.etapa_catalogo_id));
  if new.estado is distinct from old.estado then
    perform public.ot_registrar_evento(new.orden_id, 'CAMBIO_ESTADO',
      format('Etapa %s: %s → %s',v_etapa,old.estado,new.estado),
      jsonb_build_object('etapa',v_etapa,'estado_anterior',old.estado,
        'estado_nuevo',new.estado,'avance',new.avance_porcentaje),new.id);
  elsif new.avance_porcentaje is distinct from old.avance_porcentaje then
    perform public.ot_registrar_evento(new.orden_id, 'AVANCE',
      format('Etapa %s al %s%%',v_etapa,new.avance_porcentaje),
      jsonb_build_object('etapa',v_etapa,'avance_anterior',old.avance_porcentaje,
        'avance',new.avance_porcentaje),new.id);
  end if;
  return null;
end;
$$;
revoke all on function public.fn_ot_etapa_bitacora() from public, anon, authenticated;

create or replace function public.guardar_etapas_libres(
  p_orden_id uuid, p_config jsonb, p_etapa_actividad uuid default null)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  v_orden public.ordenes_trabajo%rowtype;
  v_item jsonb;
  v_pos integer;
  v_id uuid;
  v_nombre text;
  v_area uuid;
  v_peso numeric;
  v_total integer;
  v_etapa public.ot_etapas%rowtype;
  v_diseno uuid;
  v_actividad_area uuid;
begin
  perform public.exigir_permiso('diseno.planos');
  select * into v_orden from public.ordenes_trabajo where id=p_orden_id for update;
  if not found then raise exception 'La OT no existe.'; end if;
  if v_orden.estado in ('ANULADA','ENTREGADA','FACTURADA','TERMINADA') then
    raise exception 'La OT % está cerrada.', v_orden.numero;
  end if;
  if jsonb_typeof(p_config) is distinct from 'array'
     or jsonb_array_length(p_config) not between 1 and 100 then
    raise exception 'Agrega entre 1 y 100 etapas.';
  end if;
  select count(*), coalesce(sum((x.item->>'peso_pct')::numeric),0)
    into v_total,v_peso from jsonb_array_elements(p_config) x(item);
  if v_peso <> 100 then raise exception 'Los porcentajes deben sumar 100.'; end if;
  if (select count(distinct x.item->>'id') from jsonb_array_elements(p_config) x(item)) <> v_total
    or (select count(distinct lower(btrim(x.item->>'nombre'))) from jsonb_array_elements(p_config) x(item)) <> v_total then
    raise exception 'No repitas nombres ni identificadores de etapa.';
  end if;
  for v_item in select value from jsonb_array_elements(p_config) loop
    v_id := (v_item->>'id')::uuid;
    v_nombre := btrim(v_item->>'nombre');
    v_area := (v_item->>'area_id')::uuid;
    v_peso := (v_item->>'peso_pct')::numeric;
    if v_id is null or v_nombre is null or length(v_nombre) not between 2 and 120
      or v_peso is null or v_peso <= 0 or v_peso > 100
      or not exists(select 1 from public.areas where id=v_area and activo) then
      raise exception 'Revisa el nombre, área y porcentaje de cada etapa.';
    end if;
    if exists(select 1 from public.ot_etapas where id=v_id and orden_id<>p_orden_id) then
      raise exception 'Una etapa pertenece a otra OT.';
    end if;
  end loop;
  if not v_orden.plan_etapas_manual then
    if p_orden_id <> '78c95158-bddc-4398-b7b5-afa45cd0d8d0'::uuid then
      raise exception 'Esta OT histórica no admite cambios en sus etapas.';
    end if;
    if (select count(*) from public.ot_etapas where orden_id=p_orden_id) not in (0,14) then
      raise exception 'Revisa las etapas anteriores antes de convertir esta OT.';
    end if;
    if exists(select 1 from public.ot_etapas where orden_id=p_orden_id
       and (avance_porcentaje<>0 or horas_reales<>0 or fecha_inicio_real is not null
         or fecha_fin_real is not null))
      or exists(select 1 from public.ot_avances where orden_id=p_orden_id)
      or exists(select 1 from public.ot_etapa_reportes where orden_id=p_orden_id)
      or exists(select 1 from public.ot_actividades a join public.ot_actividad_avances av
        on av.actividad_id=a.id where a.orden_id=p_orden_id) then
      raise exception 'Esta OT ya tiene avances: sus etapas anteriores no se reemplazaron.';
    end if;
    if exists(select 1 from public.ot_planos where orden_id=p_orden_id and etapa_id is not null)
      or exists(select 1 from public.ot_actividades where orden_id=p_orden_id and etapa_id is not null) then
      raise exception 'Revisa los vínculos anteriores antes de convertir la OT.';
    end if;
    select id into v_diseno from public.areas where codigo='DIS' and activo;
    if (select count(*) from jsonb_array_elements(p_config) x(item)
        where x.item->>'area_id'=v_diseno::text) <> 1 then
      raise exception 'Agrega una etapa de Diseño para el plano existente.';
    end if;
    select area_id into v_actividad_area from public.ot_actividades where orden_id=p_orden_id;
    if (select count(*) from public.ot_actividades where orden_id=p_orden_id) <> 1
      or not exists(select 1 from jsonb_array_elements(p_config) x(item)
        where x.item->>'id'=p_etapa_actividad::text
          and x.item->>'area_id'=v_actividad_area::text) then
      raise exception 'Vincula la actividad existente a una etapa de su área.';
    end if;
  end if;
  for v_etapa in select * from public.ot_etapas e where e.orden_id=p_orden_id
    and not exists(select 1 from jsonb_array_elements(p_config) x(item)
      where x.item->>'id'=e.id::text) for update
  loop
    if v_etapa.avance_porcentaje<>0 or v_etapa.horas_reales<>0
       or v_etapa.fecha_inicio_real is not null or v_etapa.fecha_fin_real is not null
       or exists(select 1 from public.ot_avances where etapa_id=v_etapa.id)
       or exists(select 1 from public.ot_etapa_reportes where etapa_id=v_etapa.id)
       or exists(select 1 from public.ot_planos where etapa_id=v_etapa.id)
       or exists(select 1 from public.ot_actividades where etapa_id=v_etapa.id)
       or exists(select 1 from public.ot_materiales where etapa_id=v_etapa.id)
       or exists(select 1 from public.ot_bitacora where etapa_id=v_etapa.id) then
      raise exception 'La etapa % ya tiene avance o trabajo vinculado; reasígnalo antes de quitarla.', v_etapa.nombre;
    end if;
    delete from public.ot_etapas where id=v_etapa.id;
  end loop;
  if not v_orden.plan_etapas_manual then
    perform set_config('metalwork.convirtiendo_etapas', p_orden_id::text, true);
    update public.ordenes_trabajo set plan_etapas_manual=true where id=p_orden_id;
  end if;
  for v_item,v_pos in select value, ordinality::integer
    from jsonb_array_elements(p_config) with ordinality
  loop
    v_id := (v_item->>'id')::uuid;
    v_nombre := btrim(v_item->>'nombre');
    v_area := (v_item->>'area_id')::uuid;
    v_peso := (v_item->>'peso_pct')::numeric;
    insert into public.ot_etapas (id,orden_id,etapa_catalogo_id,nombre,orden_secuencia,area_id,peso_pct)
      values (v_id,p_orden_id,null,v_nombre,v_pos,v_area,v_peso)
    on conflict (id) do update set nombre=excluded.nombre,
      orden_secuencia=excluded.orden_secuencia,area_id=excluded.area_id,peso_pct=excluded.peso_pct;
  end loop;
  if not v_orden.plan_etapas_manual then
    update public.ot_planos set etapa_id=(select e.id from public.ot_etapas e
      join public.areas a on a.id=e.area_id where e.orden_id=p_orden_id and a.codigo='DIS')
      where orden_id=p_orden_id;
    update public.ot_actividades set etapa_id=p_etapa_actividad where orden_id=p_orden_id;
    perform public.recalcular_etapa_desde_actividades(p_etapa_actividad);
    perform public.recalcular_etapa_desde_actividades((select etapa_id from public.ot_planos where orden_id=p_orden_id limit 1));
  end if;
  perform public.ot_recalcular_avance(p_orden_id);
  return v_total;
end;
$$;
revoke all on function public.guardar_etapas_libres(uuid,jsonb,uuid) from public, anon;
grant execute on function public.guardar_etapas_libres(uuid,jsonb,uuid) to authenticated;
revoke all on function public.definir_etapas_ponderadas(uuid,jsonb) from authenticated;
revoke all on function public.definir_etapas_diseno(uuid,uuid[]) from authenticated;
revoke all on function public.reemplazar_etapas_historicas(uuid,jsonb,uuid) from authenticated;
