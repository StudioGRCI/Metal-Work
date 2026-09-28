-- Diseño reparte el 100 % de la OT entre etapas responsables. Los reportes
-- de actividades vinculadas mueven el avance, sin una segunda barra manual.
-- Las OT anteriores conservan su ponderación por horas y sus avances.
alter table public.ot_etapas add column if not exists area_id uuid references public.areas(id);
alter table public.ot_etapas add column if not exists peso_pct numeric(5,2);
alter table public.ot_etapas drop constraint if exists ck_ot_etapas_peso_pct;
alter table public.ot_etapas add constraint ck_ot_etapas_peso_pct
  check (peso_pct is null or (peso_pct > 0 and peso_pct <= 100));

alter table public.ot_actividades add column if not exists etapa_id uuid;
alter table public.ot_planos add column if not exists etapa_id uuid;
create unique index if not exists uq_ot_etapas_id_orden on public.ot_etapas(id, orden_id);
alter table public.ot_actividades drop constraint if exists fk_ot_actividad_etapa_orden;
alter table public.ot_actividades add constraint fk_ot_actividad_etapa_orden
  foreign key (etapa_id, orden_id) references public.ot_etapas(id, orden_id);
alter table public.ot_planos drop constraint if exists fk_ot_plano_etapa_orden;
alter table public.ot_planos add constraint fk_ot_plano_etapa_orden
  foreign key (etapa_id, orden_id) references public.ot_etapas(id, orden_id);
-- El cálculo consulta todas las actividades de la etapa por esta columna.
create index if not exists idx_ot_actividades_etapa on public.ot_actividades(etapa_id)
  where etapa_id is not null;

create or replace function public.definir_etapas_ponderadas(p_orden_id uuid, p_config jsonb)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  v_numero text;
  v_estado public.estado_ot;
  v_manual boolean;
  v_total integer;
  v_item jsonb;
  v_pos integer;
  v_catalogo uuid;
  v_area uuid;
  v_peso numeric;
begin
  perform public.exigir_permiso('diseno.planos');
  select numero, estado, plan_etapas_manual into v_numero, v_estado, v_manual
    from public.ordenes_trabajo where id = p_orden_id for update;
  if not found then raise exception 'La OT no existe.'; end if;
  if not v_manual then
    raise exception 'La OT % conserva su plan histórico de etapas.', v_numero;
  end if;
  if v_estado in ('ANULADA', 'ENTREGADA', 'FACTURADA', 'TERMINADA') then
    raise exception 'La OT % ya está cerrada.', v_numero;
  end if;
  if jsonb_typeof(p_config) is distinct from 'array'
     or jsonb_array_length(p_config) = 0 then
    raise exception 'Agrega al menos una etapa.';
  end if;
  if exists (select 1 from public.ot_actividad_avances av
      join public.ot_actividades a on a.id = av.actividad_id
      where a.orden_id = p_orden_id) then
    raise exception 'Esta OT ya tiene reportes; no se puede cambiar el reparto de etapas.';
  end if;
  if exists (select 1 from public.ot_avances where orden_id = p_orden_id) then
    raise exception 'Esta OT ya tiene avances de etapas; no se puede cambiar su reparto.';
  end if;
  if exists (select 1 from public.ot_plano_versiones v
      join public.ot_planos p on p.id = v.plano_id where p.orden_id = p_orden_id) then
    raise exception 'Esta OT ya tiene planos enviados; no se puede cambiar su reparto.';
  end if;
  select count(*), coalesce(sum((x.item->>'peso_pct')::numeric), 0)
    into v_total, v_peso
    from jsonb_array_elements(p_config) as x(item);
  if v_total > 100 or v_peso <> 100 then
    raise exception 'Los pesos de las etapas deben sumar exactamente 100 por ciento con hasta 100 etapas.';
  end if;
  if (select count(distinct (x.item->>'catalogo_id')) from jsonb_array_elements(p_config) as x(item))
      <> v_total then
    raise exception 'No repitas una etapa en la misma OT.';
  end if;
  if exists (select 1 from public.ot_etapas e where e.orden_id = p_orden_id
      and not exists (select 1 from jsonb_array_elements(p_config) as x(item)
        where x.item->>'catalogo_id' = e.etapa_catalogo_id::text)) then
    raise exception 'No se pueden retirar etapas ya registradas.';
  end if;
  for v_item, v_pos in
    select x.item, x.pos::integer
      from jsonb_array_elements(p_config) with ordinality as x(item, pos)
  loop
    v_catalogo := (v_item->>'catalogo_id')::uuid;
    v_area := (v_item->>'area_id')::uuid;
    v_peso := (v_item->>'peso_pct')::numeric;
    if v_peso is null or v_peso <= 0 or v_peso > 100
       or not exists (select 1 from public.etapas_catalogo
          where id = v_catalogo and activo)
       or not exists (select 1 from public.areas where id = v_area and activo) then
      raise exception 'Revisa la etapa, su área y un peso mayor a cero.';
    end if;
    insert into public.ot_etapas
      (orden_id, etapa_catalogo_id, orden_secuencia, horas_estimadas,
       requiere_inspeccion, area_id, peso_pct)
    select p_orden_id, c.id, v_pos, c.horas_estandar, c.requiere_inspeccion,
           v_area, v_peso
      from public.etapas_catalogo c where c.id = v_catalogo
    on conflict (orden_id, etapa_catalogo_id) do update set
      orden_secuencia = excluded.orden_secuencia,
      area_id = excluded.area_id,
      peso_pct = excluded.peso_pct;
  end loop;
  return v_total;
end;
$$;
revoke all on function public.definir_etapas_ponderadas(uuid,jsonb) from public, anon;
grant execute on function public.definir_etapas_ponderadas(uuid,jsonb) to authenticated;

create or replace function public.validar_vinculo_etapa()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_manual boolean; v_area uuid; v_codigo text;
begin
  select plan_etapas_manual into v_manual from public.ordenes_trabajo where id = new.orden_id;
  if v_manual and new.etapa_id is null then
    raise exception 'Elige la etapa de esta OT antes de registrar el trabajo.';
  end if;
  if new.etapa_id is not null then
    select e.area_id, ar.codigo into v_area, v_codigo
      from public.ot_etapas e left join public.areas ar on ar.id = e.area_id
     where e.id = new.etapa_id and e.orden_id = new.orden_id;
    if not found then raise exception 'La etapa no pertenece a esta OT.'; end if;
    if tg_table_name = 'ot_actividades' and v_area is distinct from new.area_id then
      raise exception 'La actividad debe corresponder al área responsable de la etapa.';
    end if;
    if tg_table_name = 'ot_planos' and v_codigo is distinct from 'DIS' then
      raise exception 'Un plano debe vincularse a una etapa del área Diseño.';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.validar_vinculo_etapa() from public, anon, authenticated;
drop trigger if exists trg_validar_actividad_etapa on public.ot_actividades;
create trigger trg_validar_actividad_etapa before insert or update of etapa_id,area_id,orden_id
  on public.ot_actividades for each row execute function public.validar_vinculo_etapa();
drop trigger if exists trg_validar_plano_etapa on public.ot_planos;
create trigger trg_validar_plano_etapa before insert or update of etapa_id,orden_id
  on public.ot_planos for each row execute function public.validar_vinculo_etapa();

create or replace function public.recalcular_etapa_desde_actividades(p_etapa_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_manual boolean; v_peso numeric; v_avance numeric; v_estado public.estado_etapa_ot;
begin
  select o.plan_etapas_manual, e.peso_pct, e.estado
    into v_manual, v_peso, v_estado
    from public.ot_etapas e join public.ordenes_trabajo o on o.id = e.orden_id
   where e.id = p_etapa_id for update of e;
  if not found or not v_manual or v_peso is null or v_estado = 'OMITIDA' then return; end if;
  select coalesce(round(sum(a.peso_pct * least(100, coalesce(av.avance,0)))
                    / nullif(sum(a.peso_pct),0),2),0)
    into v_avance
    from public.ot_actividades a
    left join lateral (
      select sum(x.avance_pct) as avance from public.ot_actividad_avances x
       where x.actividad_id = a.id
    ) av on true
   where a.etapa_id = p_etapa_id;
  -- Si todas las actividades tienen peso cero, cada una pesa igual.
  if exists (select 1 from public.ot_actividades where etapa_id=p_etapa_id)
     and not exists (select 1 from public.ot_actividades where etapa_id=p_etapa_id and peso_pct>0) then
    select round(avg(least(100, coalesce(av.avance,0))),2) into v_avance
      from public.ot_actividades a
      left join lateral (
        select sum(x.avance_pct) as avance from public.ot_actividad_avances x
         where x.actividad_id=a.id
      ) av on true where a.etapa_id=p_etapa_id;
  end if;
  -- Una etapa de Diseño sin tareas de taller se mide por las revisiones de
  -- sus planos: cada área cuenta una sola vez, con su versión más reciente.
  if not exists (select 1 from public.ot_actividades where etapa_id=p_etapa_id)
     and exists (select 1 from public.ot_planos where etapa_id=p_etapa_id) then
    select coalesce(round(sum(coalesce(nullif(p.peso_pct,0),1) *
      case when p.fecha_entrega is null then 0
           else coalesce(v.aprobadas * 100.0 / nullif(v.total,0),0) end)
      / nullif(sum(coalesce(nullif(p.peso_pct,0),1)),0),2),0)
      into v_avance
      from public.ot_planos p
      left join lateral (
        select count(*) as total,
          count(*) filter (where ultimo.estado in ('APROBADO','RECIBIDO')) as aprobadas
          from (select distinct on (area_id) estado
                  from public.ot_plano_versiones where plano_id=p.id
                 order by area_id,revision desc) ultimo
      ) v on true
     where p.etapa_id=p_etapa_id;
  end if;
  update public.ot_etapas set
    avance_porcentaje = v_avance,
    estado = case when v_avance >= 100 then 'TERMINADA'::public.estado_etapa_ot
                  when v_avance > 0 or estado = 'TERMINADA'
                    then 'EN_PROCESO'::public.estado_etapa_ot
                  else estado end
   where id=p_etapa_id and
    (avance_porcentaje is distinct from v_avance
      or (v_avance >= 100 and estado <> 'TERMINADA')
      or (v_avance < 100 and estado = 'TERMINADA'));
end;
$$;
revoke all on function public.recalcular_etapa_desde_actividades(uuid)
  from public, anon, authenticated;

create or replace function public.fn_recalcular_etapa_por_actividad()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_antigua uuid; v_nueva uuid;
begin
  if tg_table_name = 'ot_actividad_avances' then
    if tg_op <> 'INSERT' then
      select etapa_id into v_antigua from public.ot_actividades where id=old.actividad_id;
    end if;
    if tg_op <> 'DELETE' then
      select etapa_id into v_nueva from public.ot_actividades where id=new.actividad_id;
    end if;
  else
    if tg_op <> 'INSERT' then v_antigua := old.etapa_id; end if;
    if tg_op <> 'DELETE' then v_nueva := new.etapa_id; end if;
  end if;
  if v_antigua is not null then perform public.recalcular_etapa_desde_actividades(v_antigua); end if;
  if v_nueva is not null and v_nueva is distinct from v_antigua then
    perform public.recalcular_etapa_desde_actividades(v_nueva);
  elsif tg_op = 'INSERT' and v_nueva is not null then
    perform public.recalcular_etapa_desde_actividades(v_nueva);
  elsif tg_op = 'UPDATE' and v_nueva is not null then
    perform public.recalcular_etapa_desde_actividades(v_nueva);
  end if;
  return null;
end;
$$;
revoke all on function public.fn_recalcular_etapa_por_actividad()
  from public, anon, authenticated;
drop trigger if exists trg_recalcular_etapa_actividades on public.ot_actividades;
create trigger trg_recalcular_etapa_actividades
  after insert or update or delete on public.ot_actividades
  for each row execute function public.fn_recalcular_etapa_por_actividad();
drop trigger if exists trg_recalcular_etapa_reportes on public.ot_actividad_avances;
create trigger trg_recalcular_etapa_reportes
  after insert or update or delete on public.ot_actividad_avances
  for each row execute function public.fn_recalcular_etapa_por_actividad();

create or replace function public.fn_recalcular_etapa_por_plano()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_antes uuid; v_despues uuid;
begin
  if tg_table_name = 'ot_plano_versiones' then
    if tg_op <> 'INSERT' then
      select etapa_id into v_antes from public.ot_planos where id=old.plano_id;
    end if;
    if tg_op <> 'DELETE' then
      select etapa_id into v_despues from public.ot_planos where id=new.plano_id;
    end if;
  else
    if tg_op <> 'INSERT' then v_antes := old.etapa_id; end if;
    if tg_op <> 'DELETE' then v_despues := new.etapa_id; end if;
  end if;
  if v_antes is not null then perform public.recalcular_etapa_desde_actividades(v_antes); end if;
  if v_despues is not null then perform public.recalcular_etapa_desde_actividades(v_despues); end if;
  return null;
end;
$$;
revoke all on function public.fn_recalcular_etapa_por_plano() from public, anon, authenticated;
drop trigger if exists trg_recalcular_etapa_planos on public.ot_planos;
create trigger trg_recalcular_etapa_planos after insert or update or delete on public.ot_planos
  for each row execute function public.fn_recalcular_etapa_por_plano();
drop trigger if exists trg_recalcular_etapa_versiones on public.ot_plano_versiones;
create trigger trg_recalcular_etapa_versiones after insert or update or delete on public.ot_plano_versiones
  for each row execute function public.fn_recalcular_etapa_por_plano();

-- El porcentaje de la OT histórica se mantiene por horas; en un plan nuevo
-- manda el peso que Diseño configuró, aunque las horas estimadas sean distintas.
create or replace function public.ot_recalcular_avance(p_orden_id uuid)
returns void language plpgsql volatile set search_path to 'public' as $$
declare v_avance public.porcentaje; v_estimadas public.cantidad;
        v_reales public.cantidad; v_manual boolean;
begin
  select plan_etapas_manual into v_manual from public.ordenes_trabajo where id=p_orden_id;
  select coalesce(round(
    sum(e.avance_porcentaje *
      case when v_manual then coalesce(e.peso_pct,0)
           else coalesce(nullif(e.horas_estimadas,0),1) end)
      filter (where e.estado <> 'OMITIDA')
    / nullif(sum(
      case when v_manual then coalesce(e.peso_pct,0)
           else coalesce(nullif(e.horas_estimadas,0),1) end)
      filter (where e.estado <> 'OMITIDA'),0),2),0),
    coalesce(sum(e.horas_estimadas) filter (where e.estado <> 'OMITIDA'),0),
    coalesce(sum(e.horas_reales),0)
  into v_avance,v_estimadas,v_reales from public.ot_etapas e where e.orden_id=p_orden_id;
  if not exists (select 1 from public.ot_etapas where orden_id=p_orden_id) then return; end if;
  update public.ordenes_trabajo o set
    avance_porcentaje=v_avance, horas_estimadas=v_estimadas, horas_reales=v_reales
   where o.id=p_orden_id and
    (o.avance_porcentaje is distinct from v_avance
      or o.horas_estimadas is distinct from v_estimadas
      or o.horas_reales is distinct from v_reales);
end;
$$;

create or replace function public.fn_guardar_etapa_ponderada()
returns trigger language plpgsql set search_path to 'public' as $$
declare v_manual boolean;
begin
  select plan_etapas_manual into v_manual from public.ordenes_trabajo where id=new.orden_id;
  if v_manual and current_user <> 'postgres' and
    (new.area_id is distinct from old.area_id
     or new.peso_pct is distinct from old.peso_pct
     or new.avance_porcentaje is distinct from old.avance_porcentaje
     or new.estado is distinct from old.estado) then
    raise exception 'El área y peso los define Diseño; el avance sale de los reportes.';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_guardar_etapa_ponderada() from public, anon, authenticated;
drop trigger if exists trg_guardar_etapa_ponderada on public.ot_etapas;
create trigger trg_guardar_etapa_ponderada before update on public.ot_etapas
  for each row execute function public.fn_guardar_etapa_ponderada();

-- Se expone el vínculo a la pantalla de Actividades sin alterar sus columnas.
create or replace view public.v_ot_actividades as
select a.id, a.orden_id, a.area_id, ar.codigo as area_codigo, ar.nombre as area,
       a.orden_secuencia, a.nombre, a.detalle, a.referencia, a.peso_pct,
       coalesce(av.avanzado,0::numeric) as avance_pct,
       coalesce(av.avanzado,0::numeric)>=100::numeric as terminada,
       av.ultimo as ultimo_reporte, av.reportes, a.creado_por, a.creado_en,
       a.fecha_inicio_plan, a.fecha_fin_plan, o.numero as orden_numero,
       o.estado::text as orden_estado, o.abierta_en_taller, a.etapa_id
  from public.ot_actividades a join public.areas ar on ar.id=a.area_id
  join public.ordenes_trabajo o on o.id=a.orden_id
  left join lateral (
    select sum(x.avance_pct) as avanzado,max(x.fecha) as ultimo,count(*) as reportes
      from public.ot_actividad_avances x where x.actividad_id=a.id
  ) av on true;
alter view public.v_ot_actividades set (security_invoker=on);
grant select on public.v_ot_actividades to authenticated;

-- El disparador existente distingue la edición directa del cálculo interno.
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
    if not (public.es_admin() or public.tiene_permiso('ordenes.editar')) then
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

-- El avance narrativo antiguo sigue registrándose, pero no puede sobrescribir
-- una etapa nueva cuyo porcentaje procede de actividades verificables.
create or replace function public.fn_avance_mueve_etapa()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.avance_porcentaje is not null and exists (
    select 1 from public.ordenes_trabajo o
     where o.id = new.orden_id and o.plan_etapas_manual) then
    raise exception 'El avance de esta OT se reporta en Avance de Taller con tarea y foto.';
  end if;
  if new.avance_porcentaje is not null and new.etapa_id is not null
     and not exists (select 1 from public.ot_etapas e
       join public.ordenes_trabajo o on o.id=e.orden_id
       where e.id=new.etapa_id and o.plan_etapas_manual) then
    update public.ot_etapas set
      avance_porcentaje=new.avance_porcentaje,
      estado=case when estado='PENDIENTE' and new.avance_porcentaje>0
        then 'EN_PROCESO' else estado end,
      fecha_inicio_real=coalesce(fecha_inicio_real,now())
    where id=new.etapa_id and estado not in ('TERMINADA','OMITIDA')
      and avance_porcentaje is distinct from new.avance_porcentaje;
  end if;
  perform public.ot_registrar_evento(new.orden_id,'AVANCE',left(new.descripcion,200),
    jsonb_build_object('avance',new.avance_porcentaje,'impedimento',new.impedimento,
      'fecha',new.fecha),new.etapa_id,new.registrado_por);
  return new;
end;
$$;
revoke all on function public.fn_avance_mueve_etapa() from public, anon, authenticated;
