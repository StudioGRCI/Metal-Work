-- La OT 2898-2026 nació con 14 etapas automáticas sin trabajo registrado.
-- Diseño puede sustituirlas una sola vez por su plan ponderado, conservando
-- el plano entregado, su PDF y la actividad de Producción.
create or replace function public.fn_ot_plan_manual_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if tg_op = 'INSERT' then
    new.plan_etapas_manual := true;
  elsif new.plan_etapas_manual is distinct from old.plan_etapas_manual
    and not (old.id = '78c95158-bddc-4398-b7b5-afa45cd0d8d0'::uuid
      and old.plan_etapas_manual = false and new.plan_etapas_manual = true
      and current_user = 'postgres'
      and current_setting('metalwork.convirtiendo_etapas', true) = old.id::text) then
    raise exception 'El origen del plan de etapas de la OT no se puede cambiar';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_ot_plan_manual_guardia() from public, anon, authenticated;

-- El trigger compartido no debe leer area_id de ot_planos, que no tiene esa columna.
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
    if tg_table_name = 'ot_actividades' then
      if v_area is distinct from new.area_id then
        raise exception 'La actividad debe corresponder al área responsable de la etapa.';
      end if;
    elsif tg_table_name = 'ot_planos' and v_codigo is distinct from 'DIS' then
      raise exception 'Un plano debe vincularse a una etapa del área Diseño.';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.validar_vinculo_etapa() from public, anon, authenticated;

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
  if not v_manual then raise exception 'La OT % requiere convertir primero su plan histórico.', v_numero; end if;
  if v_estado in ('ANULADA', 'ENTREGADA', 'FACTURADA', 'TERMINADA') then
    raise exception 'La OT % ya está cerrada.', v_numero;
  end if;
  if jsonb_typeof(p_config) is distinct from 'array' or jsonb_array_length(p_config) = 0 then
    raise exception 'Agrega al menos una etapa.';
  end if;
  if exists (select 1 from public.ot_actividad_avances av
      join public.ot_actividades a on a.id = av.actividad_id where a.orden_id = p_orden_id)
    or exists (select 1 from public.ot_avances where orden_id = p_orden_id) then
    raise exception 'Esta OT ya tiene avances; no se puede cambiar el reparto de etapas.';
  end if;
  select count(*), coalesce(sum((x.item->>'peso_pct')::numeric), 0)
    into v_total, v_peso from jsonb_array_elements(p_config) as x(item);
  if v_total > 100 or v_peso <> 100 then
    raise exception 'Los pesos de las etapas deben sumar exactamente 100 por ciento con hasta 100 etapas.';
  end if;
  if (select count(distinct x.item->>'catalogo_id') from jsonb_array_elements(p_config) as x(item)) <> v_total then
    raise exception 'No repitas una etapa en la misma OT.';
  end if;
  if exists (select 1 from public.ot_etapas e where e.orden_id = p_orden_id
      and not exists (select 1 from jsonb_array_elements(p_config) as x(item)
        where x.item->>'catalogo_id' = e.etapa_catalogo_id::text)) then
    raise exception 'No se pueden retirar etapas ya registradas.';
  end if;
  for v_item, v_pos in
    select x.item, x.pos::integer from jsonb_array_elements(p_config) with ordinality as x(item, pos)
  loop
    v_catalogo := (v_item->>'catalogo_id')::uuid;
    v_area := (v_item->>'area_id')::uuid;
    v_peso := (v_item->>'peso_pct')::numeric;
    if v_peso is null or v_peso <= 0 or v_peso > 100
       or not exists (select 1 from public.etapas_catalogo where id = v_catalogo and activo)
       or not exists (select 1 from public.areas where id = v_area and activo) then
      raise exception 'Revisa la etapa, su área y un peso mayor a cero.';
    end if;
    if exists (select 1 from public.ot_planos p join public.ot_etapas e on e.id = p.etapa_id
       where p.orden_id = p_orden_id and e.etapa_catalogo_id = v_catalogo
         and (select codigo from public.areas where id = v_area) <> 'DIS') then
      raise exception 'La etapa vinculada al plano debe pertenecer a Diseño.';
    end if;
    if exists (select 1 from public.ot_actividades a join public.ot_etapas e on e.id = a.etapa_id
       where a.orden_id = p_orden_id and e.etapa_catalogo_id = v_catalogo and a.area_id <> v_area) then
      raise exception 'El área de la etapa debe coincidir con la actividad vinculada.';
    end if;
    insert into public.ot_etapas
      (orden_id, etapa_catalogo_id, orden_secuencia, horas_estimadas, requiere_inspeccion, area_id, peso_pct)
    select p_orden_id, c.id, v_pos, c.horas_estandar, c.requiere_inspeccion, v_area, v_peso
      from public.etapas_catalogo c where c.id = v_catalogo
    on conflict (orden_id, etapa_catalogo_id) do update set
      orden_secuencia = excluded.orden_secuencia, area_id = excluded.area_id, peso_pct = excluded.peso_pct;
  end loop;
  return v_total;
end;
$$;
revoke all on function public.definir_etapas_ponderadas(uuid,jsonb) from public, anon;
grant execute on function public.definir_etapas_ponderadas(uuid,jsonb) to authenticated;

create or replace function public.reemplazar_etapas_historicas(
  p_orden_id uuid, p_config jsonb, p_etapa_actividad uuid)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  v_area_dis uuid;
  v_plano_etapa uuid;
  v_actividad_etapa uuid;
  v_actividad_area uuid;
  v_total integer;
begin
  perform public.exigir_permiso('diseno.planos');
  if p_orden_id <> '78c95158-bddc-4398-b7b5-afa45cd0d8d0'::uuid then
    raise exception 'Esta conversión solo corresponde a la OT 2898-2026.';
  end if;
  perform 1 from public.ordenes_trabajo where id = p_orden_id and not plan_etapas_manual for update;
  if not found then raise exception 'Las etapas de esta OT ya fueron convertidas.'; end if;
  if (select count(*) from public.ot_etapas where orden_id = p_orden_id) <> 14
    or exists (select 1 from public.ot_etapas where orden_id = p_orden_id
       and (avance_porcentaje <> 0 or fecha_inicio_real is not null or fecha_fin_real is not null))
    or exists (select 1 from public.ot_avances where orden_id = p_orden_id)
    or exists (select 1 from public.ot_actividad_avances av join public.ot_actividades a
       on a.id = av.actividad_id where a.orden_id = p_orden_id)
    or exists (select 1 from public.ot_etapa_reportes r join public.ot_etapas e
       on e.id = r.etapa_id where e.orden_id = p_orden_id)
    or exists (select 1 from public.ot_bitacora b join public.ot_etapas e
       on e.id = b.etapa_id where e.orden_id = p_orden_id)
    or exists (select 1 from public.ot_materiales m join public.ot_etapas e
       on e.id = m.etapa_id where e.orden_id = p_orden_id) then
    raise exception 'Las etapas históricas ya tienen trabajo vinculado; no se reemplazaron.';
  end if;
  if (select count(*) from public.ot_planos where orden_id = p_orden_id) <> 1
    or (select count(*) from public.ot_planos where orden_id = p_orden_id and etapa_id is null) <> 1
    or (select count(*) from public.ot_actividades where orden_id = p_orden_id) <> 1
    or (select count(*) from public.ot_actividades where orden_id = p_orden_id and etapa_id is null) <> 1 then
    raise exception 'Revisa los planos y actividades antes de convertir las etapas.';
  end if;
  select area_id into v_actividad_area from public.ot_actividades where orden_id = p_orden_id;
  if not exists (select 1 from jsonb_array_elements(p_config) as x(item)
    where x.item->>'catalogo_id' = p_etapa_actividad::text
      and x.item->>'area_id' = v_actividad_area::text) then
    raise exception 'Selecciona una etapa de Producción para conservar su actividad.';
  end if;
  select id into v_area_dis from public.areas where codigo = 'DIS' and activo;
  if (select count(*) from jsonb_array_elements(p_config) as x(item)
      where x.item->>'area_id' = v_area_dis::text) <> 1 then
    raise exception 'Selecciona una sola etapa de Diseño para vincular el plano.';
  end if;
  delete from public.ot_etapas where orden_id = p_orden_id;
  perform set_config('metalwork.convirtiendo_etapas', p_orden_id::text, true);
  update public.ordenes_trabajo set plan_etapas_manual = true where id = p_orden_id;
  v_total := public.definir_etapas_ponderadas(p_orden_id, p_config);
  select id into strict v_plano_etapa from public.ot_etapas
    where orden_id = p_orden_id and area_id = v_area_dis;
  select id into strict v_actividad_etapa from public.ot_etapas
    where orden_id = p_orden_id and etapa_catalogo_id = p_etapa_actividad;
  update public.ot_planos set etapa_id = v_plano_etapa where orden_id = p_orden_id;
  update public.ot_actividades set etapa_id = v_actividad_etapa where orden_id = p_orden_id;
  perform public.recalcular_etapa_desde_actividades(v_plano_etapa);
  perform public.recalcular_etapa_desde_actividades(v_actividad_etapa);
  perform public.ot_recalcular_avance(p_orden_id);
  return v_total;
end;
$$;
revoke all on function public.reemplazar_etapas_historicas(uuid,jsonb,uuid) from public, anon;
grant execute on function public.reemplazar_etapas_historicas(uuid,jsonb,uuid) to authenticated;
