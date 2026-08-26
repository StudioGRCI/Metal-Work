-- =============================================================================
-- LAS CINCO REGLAS DE PLAZO QUE LA EMPRESA TIENE ESCRITAS
-- -----------------------------------------------------------------------------
-- De «FECHAS DE LOS PROCESOS DE FABRICACIÓN- ACTUAL.xlsx». La hoja las aplica
-- a mano con fórmulas que saltan domingos; acá se calculan solas:
--
--   · La OS de producción se genera 3 días después de emitida la OT.
--   · El diseño de la unidad: 4 días desde la OT.
--   · La OS de acabados: 1 día antes del arenado.
--   · Los certificados: 2 días hábiles desde el término.
--   · La tarjeta de propiedad y las placas: 15 días hábiles desde el término.
--
-- Todo en días hábiles del calendario laboral (domingos y feriados fuera).
-- Es una vista y no una tabla a propósito: la fecha límite se deriva de la
-- orden, y guardarla sería invitarla a desincronizarse.
-- =============================================================================

-- Restar días hábiles: para «un día antes del arenado». Camina hacia atrás
-- saltando los días sin taller, con el mismo criterio que sumar_dias_habiles.
create or replace function public.restar_dias_habiles(p_desde date, p_dias int)
returns date
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_fecha     date := p_desde;
  v_restantes int  := p_dias;
  v_vueltas   int  := 0;
begin
  if p_desde is null or p_dias is null or p_dias < 0 then
    return null;
  end if;

  while v_restantes > 0 loop
    v_fecha := v_fecha - 1;
    if public.es_laborable(v_fecha) then
      v_restantes := v_restantes - 1;
    end if;
    -- La misma guarda que sumar_dias_habiles: si el calendario quedó sin días
    -- de taller, mejor un error claro que un bucle eterno.
    v_vueltas := v_vueltas + 1;
    if v_vueltas > 4000 then
      raise exception 'El calendario laboral no permite calcular el plazo: revise los días de taller';
    end if;
  end loop;

  -- Con cero se retrocede hasta el laborable más cercano, sin pasar de la fecha.
  while not public.es_laborable(v_fecha) loop
    v_fecha := v_fecha - 1;
    v_vueltas := v_vueltas + 1;
    if v_vueltas > 4000 then
      raise exception 'El calendario laboral no permite calcular el plazo: revise los días de taller';
    end if;
  end loop;

  return v_fecha;
end;
$$;

comment on function public.restar_dias_habiles(date, int) is
  'Retrocede días de taller saltando domingos y feriados. Es el espejo de sumar_dias_habiles.';

revoke all on function public.restar_dias_habiles(date, int) from public, anon;
grant execute on function public.restar_dias_habiles(date, int) to authenticated;

-- ------------------------------------------------------------ las fechas
create or replace view public.ot_fechas_clave as
select
  o.id as orden_id,
  o.numero,
  o.fecha_registro,

  -- Reglas contadas desde la emisión de la OT.
  public.sumar_dias_habiles(o.fecha_registro, 3) as limite_os_produccion,
  public.sumar_dias_habiles(o.fecha_registro, 4) as limite_diseno,

  -- Un día hábil antes del arenado programado; nula mientras no se programe.
  (select public.restar_dias_habiles(e.fecha_inicio_programada, 1)
     from public.ot_etapas e
     join public.etapas_catalogo ec on ec.id = e.etapa_catalogo_id
    where e.orden_id = o.id and ec.codigo = 'ARENADO'
    limit 1) as limite_os_acabados,

  -- Reglas contadas desde el término (programado, o real si ya ocurrió).
  public.sumar_dias_habiles(coalesce(o.fecha_fin_real::date, o.fecha_fin_programada), 2)  as limite_certificados,
  public.sumar_dias_habiles(coalesce(o.fecha_fin_real::date, o.fecha_fin_programada), 15) as limite_tarjeta_placas,

  -- Lo que ya se cumplió, para que la pantalla marque hecho y no vencido:
  -- la primera orden de servicio de producción y la fecha de entrega real.
  (select min(s.fecha) from public.servicios_terceros s
    where s.orden_id = o.id) as primera_os,
  (select min(e.fecha_entrega) from public.ot_entregas e
    where e.orden_id = o.id) as fecha_entrega
from public.ordenes_trabajo o
where o.estado not in ('ANULADA');

comment on view public.ot_fechas_clave is
  'Las fechas límite que las reglas de plazo de la empresa imponen a cada orden, en días hábiles.';

alter view public.ot_fechas_clave set (security_invoker = on);
grant select on public.ot_fechas_clave to authenticated;
