-- =============================================================================
-- EL RECORRIDO DEL REPORTE DIARIO
-- -----------------------------------------------------------------------------
-- El supervisor sube su reporte del día y después no sabe qué pasó con él: si
-- Recursos Humanos ya le dio su visto, si Gerencia lo validó o lo observó, a
-- quién espera y desde cuándo. Para saberlo preguntaba a RR. HH. (Plan 1,
-- Supervisión, entrega 1.1, 2026-11-26).
--
-- El dato ya existe: el reporte guarda quién y cuándo de cada paso
-- (`registrado_por`, `visto_rrhh_por`, `visto_gerencia_por`, `observado_por`,
-- `anulado_por`) y el que lo corrige apunta al observado (`reemplaza_a`). Esta
-- migración solo los pone en orden con la misma forma que el recorrido del RQ y
-- de la cotización (migración 20261125130000), sin tabla nueva y sin leer la
-- bitácora.
--
-- Los pasos: Supervisión lo sube → Recursos Humanos y Gerencia dan su visto,
-- en cualquier orden → validado. Si una de las dos lo observa, vuelve a quien
-- lo subió, que lo corrige y lo sube de nuevo: el observado queda anulado y el
-- recorrido sigue en el corregido.
--
-- Quién la lee: quien ya ve el reporte, ni uno más. Repite fila por fila la
-- política `ver_reportes_diarios` (el administrador, quien tiene
-- `reporte_diario.ver`, o quien lo subió): el supervisor no ve los reportes de
-- otras áreas ni los de otro supervisor. Es `security definer` solo para decir
-- el puesto de cada cuenta (`puesto`), que sale de `usuarios`; por eso el
-- alcance lo pone ella. El check 473 compara las dos con cada puesto.
--
-- De cada paso sale el puesto de quien lo hizo, nunca su nombre (decisión de
-- DKS para el recorrido, 2026-11-25). Nunca horas, personas ni costo: el
-- detalle es solo el área que observó (GERENCIA o RRHH) o que el reporte
-- corrige a otro.
--
-- Sin DROP: el conector de producción no deja pasar ninguno.
-- =============================================================================

create or replace function public.recorrido_de_reportes_diarios(p_ids uuid[])
returns table (
  documento uuid,
  orden     integer,
  paso      text,
  situacion text,
  puesto    text,
  en        timestamptz,
  dias      integer,
  espera    text,
  detalle   text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_admin constant boolean := public.es_admin();
  v_ve    constant boolean := public.tiene_permiso('reporte_diario.ver');
  v_yo    constant uuid    := public.usuario_actual();
begin
  if not (v_admin or v_ve or public.tiene_permiso('reporte_diario.registrar')) then
    raise exception 'No tienes permiso para ver los reportes diarios.' using errcode = 'insufficient_privilege';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return;
  end if;
  if cardinality(p_ids) > 500 then
    raise exception 'Pide el recorrido de hasta 500 reportes a la vez.' using errcode = 'check_violation';
  end if;

  return query
  with rep as (
    select r.id, r.registrado_por, r.creado_en, r.reemplaza_a,
           r.visto_rrhh_por, r.visto_rrhh_en, r.visto_gerencia_por, r.visto_gerencia_en,
           r.observado_por, r.observado_en, r.observacion_area,
           r.anulado_por, r.anulado_en,
           -- El que lo corrigió, si lo observaron y ya se subió de nuevo.
           (select c.creado_en from public.reportes_diarios c where c.reemplaza_a = r.id order by c.creado_en limit 1) as corregido_en,
           (select c.registrado_por from public.reportes_diarios c where c.reemplaza_a = r.id order by c.creado_en limit 1) as corregido_por
      from public.reportes_diarios r
     where r.id = any(p_ids)
       -- La política `ver_reportes_diarios`, tal cual.
       and (v_admin or v_ve or r.registrado_por = v_yo)
  ),
  pasos as (
    -- `canon` desempata lo que pasó a la misma hora: el envío antes que los vistos.
    -- Supervisión lo subió (o subió la corrección de un observado)
    select r.id as rep, 10 as canon, 'ENVIO' as paso, 'HECHO' as situacion, r.registrado_por as quien, null::text as puesto_fijo,
           r.creado_en as en, null::text as espera,
           case when r.reemplaza_a is not null then 'CORRIGE' end as detalle
      from rep r
    union all
    -- Los vistos que ya dieron
    select r.id, 20, 'VISTO_RRHH', 'HECHO', r.visto_rrhh_por, null, r.visto_rrhh_en, null, null
      from rep r where r.visto_rrhh_en is not null
    union all
    select r.id, 30, 'VISTO_GERENCIA', 'HECHO', r.visto_gerencia_por, null, r.visto_gerencia_en, null, null
      from rep r where r.visto_gerencia_en is not null
    union all
    -- Con los dos vistos y sin observación, queda validado: lo cierra el último que lo dio.
    select r.id, 35, 'VALIDACION', 'HECHO',
           case when r.visto_rrhh_en >= r.visto_gerencia_en then r.visto_rrhh_por else r.visto_gerencia_por end, null,
           greatest(r.visto_rrhh_en, r.visto_gerencia_en), null, null
      from rep r
     where r.visto_rrhh_en is not null and r.visto_gerencia_en is not null and r.observado_en is null and r.anulado_en is null
    union all
    -- La observación, con el área que observó
    select r.id, 40, 'OBSERVACION', 'HECHO', r.observado_por, null, r.observado_en, null, r.observacion_area
      from rep r where r.observado_en is not null
    union all
    -- Observado: lo corrige quien lo subió…
    select r.id, 50, 'CORRECCION', 'HECHO', r.corregido_por, null, r.corregido_en, null, null
      from rep r where r.observado_en is not null and r.corregido_en is not null
    union all
    select r.id, 50, 'CORRECCION', 'AHORA', null, coalesce(public.puesto_de(r.registrado_por), 'Supervisión'), r.observado_en, 'CORRECCION', null
      from rep r where r.observado_en is not null and r.corregido_en is null and r.anulado_en is null
    union all
    -- … y el corregido vuelve a pasar por las dos áreas.
    select r.id, 60, 'VALIDACION', 'PENDIENTE', null, null, null, null, null
      from rep r where r.observado_en is not null and r.corregido_en is null and r.anulado_en is null
    union all
    -- Por validar: lo tienen las dos áreas, o la que falta, desde que se subió.
    select r.id, 20, 'VALIDACION', 'AHORA', null, 'Gerencia y Recursos Humanos', r.creado_en, 'VALIDACION', null
      from rep r
     where r.anulado_en is null and r.observado_en is null and r.visto_rrhh_en is null and r.visto_gerencia_en is null
    union all
    select r.id, 20, 'VISTO_RRHH', 'AHORA', null, 'Recursos Humanos', r.creado_en, 'VISTO_RRHH', null
      from rep r
     where r.anulado_en is null and r.observado_en is null and r.visto_rrhh_en is null and r.visto_gerencia_en is not null
    union all
    select r.id, 30, 'VISTO_GERENCIA', 'AHORA', null, 'Gerencia', r.creado_en, 'VISTO_GERENCIA', null
      from rep r
     where r.anulado_en is null and r.observado_en is null and r.visto_gerencia_en is null and r.visto_rrhh_en is not null
    union all
    -- Anulado a mano. El observado que se corrigió también queda anulado, pero
    -- eso ya lo dice el paso de la corrección.
    select r.id, 70, 'ANULACION', 'HECHO', r.anulado_por, null, r.anulado_en, null, null
      from rep r where r.anulado_en is not null and r.corregido_en is null
  )
  select p.rep,
         (row_number() over (
            partition by p.rep
            order by case p.situacion when 'HECHO' then 0 when 'AHORA' then 1 else 2 end,
                     case when p.situacion = 'HECHO' then p.en end, p.canon))::integer,
         p.paso, p.situacion,
         case when p.situacion = 'HECHO' then public.puesto(u) else p.puesto_fijo end,
         p.en,
         case when p.situacion = 'AHORA' then public.dias_en_espera(p.en) end,
         p.espera, p.detalle
    from pasos p
    left join public.usuarios u on u.id = p.quien;
end;
$$;

comment on function public.recorrido_de_reportes_diarios(uuid[]) is
  'El recorrido de cada reporte diario, un paso por fila: lo subió Supervisión, el visto de Recursos Humanos y el de Gerencia, la observación y su corrección, con el puesto de quien hizo cada paso y su hora; quién lo tiene ahora y hace cuántos días (fecha de Lima). Devuelve solo los que la política ver_reportes_diarios deja ver a quien llama. Sin horas, personas ni costo.';

revoke all on function public.recorrido_de_reportes_diarios(uuid[]) from public, anon;
grant execute on function public.recorrido_de_reportes_diarios(uuid[]) to authenticated;
