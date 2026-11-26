-- =============================================================================
-- LA OT PAUSADA NO PIDE EL REPORTE DE HOY
-- -----------------------------------------------------------------------------
-- Plan 1 (Supervisión), después de la entrega 1.3. «Sin reporte de hoy», en
-- Planos y etapas, seguía la regla del tablero de entregas: todo código no
-- entregado con una etapa abierta del área pedía el reporte diario, también el
-- de una OT pausada. En una OT pausada nadie trabaja, y pedirle el reporte cada
-- día es ruido. DKS eligió el 2026-11-26 «Sacar las pausadas»: la OT pausada
-- deja de pedir reporte; la terminada y la que está en control de calidad lo
-- siguen pidiendo hasta que se cierren sus etapas, para que no quede ninguna
-- abierta sin que nadie lo note.
--
-- El estado se lee del tablero (`tiempos_de_entrega_codigos_calculado`), no se
-- vuelve a calcular: sale el código cuya única OT abierta está pausada. Si el
-- código tiene más de una OT abierta, sigue pidiendo el reporte aunque la que
-- manda en el tablero esté pausada, porque la otra puede estar en marcha (el
-- tablero solo da el estado de la que se entrega antes).
--
-- Al salir de esta función, la tarjeta de ese código en Planos y etapas ya no
-- trae el semáforo del tablero para sus etapas: muestra el plazo en días
-- corridos, como cualquier etapa fuera del tablero.
--
-- Solo lectura. Mismas columnas que la 20261126333000: `create or replace`, sin
-- DROP (el conector de producción no deja pasar ninguno). Idempotente.
-- =============================================================================

create or replace function public.etapas_abiertas_de_mi_area()
returns table (id uuid, codigo text, nombre text, padre_id uuid,
               inicio_plan date, fin_plan date, inicio_real date,
               ultimo_reporte date, semaforo text, dias_habiles integer)
language plpgsql
stable
security definer
set search_path to 'public'
rows 50
as $$
declare
  v_area uuid;
begin
  perform public.exigir_permiso('reporte_diario.registrar');
  select u.area_id into v_area from public.usuarios u where u.id = public.usuario_actual();
  if v_area is null then
    return;
  end if;
  return query
    select e.id, e.codigo, e.nombre, e.padre_id, e.inicio_plan, e.fin_plan, e.inicio_real,
           e.ultimo_reporte, e.semaforo, e.dias_habiles
      from public.tiempos_de_entrega_etapas_calculado(null) e
     where e.area_id = v_area
       and e.fin_real is null
       and e.codigo in (
             select c.codigo
               from public.tiempos_de_entrega_codigos_calculado(null) c
              -- La OT pausada no se trabaja: no pide reporte (DKS, 2026-11-26).
              where not (c.ot_estado is not distinct from 'PAUSADA' and c.ots_abiertas = 1))
       -- El código con el costeo cerrado ya no se trabaja: no pide reporte.
       and not exists (select 1 from public.codigo_interno_cierres k where k.codigo = e.codigo and k.reabierto_en is null)
     order by e.codigo, e.orden, e.id;
end;
$$;

comment on function public.etapas_abiertas_de_mi_area() is
  'Las etapas sin terminar del área de quien llama, de los códigos que siguen en el tablero de tiempos de entrega y no están pausados, con su semáforo (semaforo_de_fecha), los días hábiles que faltan (negativo si venció) y el último reporte del área. Para «Sin reporte de hoy» en Planos y etapas (Plan 1, entrega 1.3; la OT pausada sale desde la 20261126335000). Exige reporte_diario.registrar.';

revoke all on function public.etapas_abiertas_de_mi_area() from public, anon;
grant execute on function public.etapas_abiertas_de_mi_area() to authenticated;
