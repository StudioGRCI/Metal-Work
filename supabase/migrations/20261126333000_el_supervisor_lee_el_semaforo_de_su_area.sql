-- =============================================================================
-- EL SUPERVISOR LEE EL SEMÁFORO DE LAS ETAPAS DE SU ÁREA
-- -----------------------------------------------------------------------------
-- Plan 1 (Supervisión), entrega 1.3. DKS pidió que en «Planos y etapas» el
-- supervisor vea los códigos abiertos sin reporte de hoy y que el atraso se lea
-- del semáforo de entregas, sin calcularlo otra vez. El semáforo vive en la base
-- (`tiempos_de_entrega_etapas_calculado`, migración 20261125100000): el color y
-- los días hábiles que faltan, con el calendario de taller. Pero lo abre
-- `rrhh.tiempos_entrega`, que el supervisor no tiene, y darle ese permiso le
-- abriría el tablero de todas las áreas.
--
-- Esta función le da solo lo suyo: las etapas sin terminar de SU área, de los
-- códigos que siguen en el tablero (los ya entregados o facturados sin otra OT
-- abierta no entran, como en el tablero de RR. HH.), con su semáforo, sus días
-- hábiles y el último reporte de su área. Nada de otras áreas, ni planos,
-- materiales o costos. La exige `reporte_diario.registrar`: es para quien
-- reporta el día.
--
-- Solo lectura. Sin DROP: el conector de producción no deja pasar ninguno.
-- Idempotente: `create or replace`.
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
       and e.codigo in (select c.codigo from public.tiempos_de_entrega_codigos_calculado(null) c)
     order by e.codigo, e.orden, e.id;
end;
$$;

comment on function public.etapas_abiertas_de_mi_area() is
  'Las etapas sin terminar del área de quien llama, de los códigos que siguen en el tablero de tiempos de entrega, con su semáforo (semaforo_de_fecha), los días hábiles que faltan (negativo si venció) y el último reporte del área. Para «Sin reporte de hoy» en Planos y etapas (Plan 1, entrega 1.3). Exige reporte_diario.registrar.';

revoke all on function public.etapas_abiertas_de_mi_area() from public, anon;
grant execute on function public.etapas_abiertas_de_mi_area() to authenticated;
