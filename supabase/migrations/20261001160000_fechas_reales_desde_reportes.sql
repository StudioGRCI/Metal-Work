-- =============================================================================
-- LA ETAPA EMPIEZA Y TERMINA EL DÍA DEL TRABAJO, NO EL DÍA DE LA CARGA
-- -----------------------------------------------------------------------------
-- Las fechas reales de una etapa las ponía `fn_ot_etapa_antes_update` con
-- `now()` al cambiar de estado: el inicio era el momento en que alguien cargó
-- el primer reporte en el sistema y el fin el momento en que se cargó el que
-- la llevó al 100 %. El reporte de taller dice qué día se hizo el trabajo
-- (`ot_actividad_avances.fecha`) y eso se perdía: un supervisor que carga el
-- lunes lo del viernes corría el inicio tres días, y el expediente, el control
-- de plazos y el «terminada el …» de la ficha contaban otra historia que la
-- del taller.
--
-- Además, una etapa reabierta para retrabajo conservaba su fecha de fin: al
-- volver a terminar, seguía diciendo la primera, porque el trigger solo pone
-- el fin si está vacío.
--
-- Ahora, en una etapa que se mide por sus tareas:
--   · inicio real = el día del primer reporte;
--   · fin real    = el día del último reporte, cuando la etapa llega al 100 %;
--   · si baja del 100 % (se reabre, se borra un reporte) el fin se vacía.
-- El reporte guarda un día y no una hora: se guarda el mediodía de Lima, que
-- en pantalla es ese mismo día y no cruza de fecha por la zona horaria.
--
-- La etapa de Diseño que se mide por sus planos no tiene reportes con fecha:
-- sigue con la fecha en que cambió de estado, y también pierde el fin si se
-- reabre.
--
-- Al final se recalculan las fechas de las etapas que ya tienen reportes. Solo
-- toca las fechas reales de etapas por tareas: ni avance ni estado.
-- =============================================================================

create or replace function public.recalcular_etapa_desde_actividades(p_etapa_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_manual boolean;
  v_peso numeric;
  v_avance numeric;
  v_estado public.estado_etapa_ot;
  v_inicio_antes timestamptz;
  v_fin_antes timestamptz;
  v_por_tareas boolean;
  v_primer date;
  v_ultimo date;
  v_inicio timestamptz;
  v_fin timestamptz;
begin
  select o.plan_etapas_manual, e.peso_pct, e.estado, e.fecha_inicio_real, e.fecha_fin_real
    into v_manual, v_peso, v_estado, v_inicio_antes, v_fin_antes
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

  -- Las fechas reales salen de los días que dicen los reportes.
  v_por_tareas := exists (select 1 from public.ot_actividades where etapa_id = p_etapa_id);
  if v_por_tareas then
    select min(x.fecha), max(x.fecha) into v_primer, v_ultimo
      from public.ot_actividad_avances x
      join public.ot_actividades a on a.id = x.actividad_id
     where a.etapa_id = p_etapa_id;
    v_inicio := (v_primer + time '12:00') at time zone 'America/Lima';
    v_fin := case when v_avance >= 100 then (v_ultimo + time '12:00') at time zone 'America/Lima' end;
  else
    -- Por planos: la fecha en que cambió de estado, que pone el trigger.
    v_inicio := v_inicio_antes;
    v_fin := case when v_avance >= 100 then v_fin_antes end;
  end if;

  update public.ot_etapas set
    avance_porcentaje = v_avance,
    estado = case when v_avance >= 100 then 'TERMINADA'::public.estado_etapa_ot
                  when v_avance > 0 or estado = 'TERMINADA'
                    then 'EN_PROCESO'::public.estado_etapa_ot
                  else estado end,
    fecha_inicio_real = v_inicio,
    fecha_fin_real = v_fin
   where id=p_etapa_id and
    (avance_porcentaje is distinct from v_avance
      or (v_avance >= 100 and estado <> 'TERMINADA')
      or (v_avance < 100 and estado = 'TERMINADA')
      or fecha_inicio_real is distinct from v_inicio
      or fecha_fin_real is distinct from v_fin);
end;
$$;

revoke all on function public.recalcular_etapa_desde_actividades(uuid) from public, anon, authenticated;

-- Las etapas que ya tienen reportes toman sus fechas de ellos. Dentro de un
-- bloque: así entra igual por el MCP (ver la skill `datos`). Las OT anuladas
-- quedan como están: sus etapas no se tocan (`fn_ot_etapa_antes_update`).
do $$
begin
  update public.ot_etapas e set
    fecha_inicio_real = (r.primer + time '12:00') at time zone 'America/Lima',
    fecha_fin_real = case when e.estado = 'TERMINADA'
                          then (r.ultimo + time '12:00') at time zone 'America/Lima' end
    from (select a.etapa_id, min(x.fecha) as primer, max(x.fecha) as ultimo
            from public.ot_actividad_avances x
            join public.ot_actividades a on a.id = x.actividad_id
           group by a.etapa_id) r,
         public.ordenes_trabajo o
   where r.etapa_id = e.id
     and o.id = e.orden_id
     and o.plan_etapas_manual
     and o.estado <> 'ANULADA'
     and e.estado <> 'OMITIDA'
     and (e.fecha_inicio_real is distinct from (r.primer + time '12:00') at time zone 'America/Lima'
          or e.fecha_fin_real is distinct from case when e.estado = 'TERMINADA'
                                                    then (r.ultimo + time '12:00') at time zone 'America/Lima' end);
end $$;
