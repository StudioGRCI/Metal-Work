-- Retira únicamente el plan automático de la OT activa 2898-2026.
-- Sus planos, versiones PDF y actividades permanecen intactos y sin vínculo
-- hasta que Diseño guarde el nuevo plan en la pantalla de la OT.
do $$
declare
  v_orden uuid;
  v_total integer;
  v_borradas integer;
begin
  select id into v_orden from public.ordenes_trabajo where numero = '2898-2026';
  if v_orden is null then return; end if;
  select count(*) into v_total from public.ot_etapas where orden_id = v_orden;
  if v_total = 0 then return; end if;
  if v_total <> 14 or (select plan_etapas_manual from public.ordenes_trabajo where id = v_orden)
    or exists(select 1 from public.ot_etapas where orden_id = v_orden
      and (avance_porcentaje <> 0 or horas_reales <> 0 or fecha_inicio_real is not null or fecha_fin_real is not null))
    or exists(select 1 from public.ot_avances where orden_id = v_orden)
    or exists(select 1 from public.ot_etapa_reportes where orden_id = v_orden)
    or exists(select 1 from public.ot_planos where orden_id = v_orden and etapa_id is not null)
    or exists(select 1 from public.ot_actividades where orden_id = v_orden and etapa_id is not null)
    or exists(select 1 from public.ot_materiales where orden_id = v_orden and etapa_id is not null)
    or exists(select 1 from public.ot_bitacora where orden_id = v_orden and etapa_id is not null) then
    raise exception 'La OT 2898-2026 tiene avance o vínculos; no se retiró ninguna etapa.';
  end if;
  delete from public.ot_etapas where orden_id = v_orden;
  get diagnostics v_borradas = row_count;
  if v_borradas <> 14 then raise exception 'Se esperaban 14 etapas; se borraron %.', v_borradas; end if;
end;
$$;
