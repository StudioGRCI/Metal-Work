-- =============================================================================
-- EL TRABAJO DEL COLABORADOR DE DISEÑO, REUNIDO POR OT
-- -----------------------------------------------------------------------------
-- El colaborador anota cada día lo que hizo (modelado, ploteo, plano de corte
-- DXF…) en el informe semanal MW-IF-DI-01, y cada semana se cierra al enviarse.
-- Para saber todo lo que lleva hecho en una unidad tenía que abrir semana por
-- semana. Esta función le junta, por cada OT de su equipo, sus actividades de
-- todas las semanas, con el día y el tipo (Plan 7, entrega 7.2).
--
-- Solo lectura, de lo que ya está guardado en `diseno_tareas`: no hay tabla
-- nueva ni se copia nada.
--
-- Qué devuelve: una fila por OT, con sus actividades dentro (`actividades`,
-- de la más reciente a la más antigua). Una fila por OT y no por actividad
-- porque la API corta las respuestas en 1000 filas: con una por actividad, al
-- crecer el historial se perdían sin aviso las OT de número más alto.
--
--   * Las OT de su equipo: las que tienen colaboradores de Diseño en
--     `ot_equipo_diseno` (los pone Diseño en la pestaña Planos) y siguen
--     abiertas. Las terminadas, entregadas, facturadas o anuladas salen solo si
--     él anotó algo en ellas: lo que hizo no se pierde. También sale la OT donde
--     anotó algo aunque ya no tenga colaboradores (la persona pasó a otra función).
--   * Solo sus actividades: las que anotó su cuenta (`creado_por`). Las de otro
--     colaborador no salen, aunque sean de la misma OT.
--   * El código interno y si es CM o SR, por `identificacion_ot_diseno`: el
--     colaborador no lee `unidades` (migración 20261001201500).
--
-- Corre con el RLS de quien la llama (`security invoker`): no abre nada que las
-- tablas no dejen ver ya. La pide el permiso de llenar el informe, y además lo
-- que piden las políticas de lectura de `diseno_tareas`, `ordenes_trabajo` y
-- `ot_equipo_diseno`: uno de los permisos de `diseno_tareas_ver` (con el
-- `diseno.ver_informes` de Gerencia, migración 20261126310000) y `ordenes.ver`.
-- Sin ellos la función diría «no anotaste nada» con actividades guardadas, así
-- que lo dice.
-- =============================================================================

create or replace function public.trabajo_de_diseno_por_ot()
returns table (
  orden_id       uuid,
  numero         text,
  codigo_interno text,
  tipo_unidad    text,
  estado_ot      text,
  ultima         date,
  actividades    jsonb
)
language plpgsql
stable
security invoker
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_yo constant uuid := public.usuario_actual();
begin
  if not public.tiene_permiso('diseno.preparar_informe') then
    raise exception 'Solo quien llena el informe semanal de Diseño ve su trabajo por OT.' using errcode = 'insufficient_privilege';
  end if;
  if not (public.tiene_permiso('diseno.planos') or public.tiene_permiso('diseno.subir_pdf')
          or public.tiene_permiso('supervision.general') or public.tiene_permiso('diseno.ver_informes'))
     or not public.tiene_permiso('ordenes.ver') then
    raise exception 'Tu puesto llena el informe de Diseño pero no puede leer sus actividades: avisa al administrador.' using errcode = 'insufficient_privilege';
  end if;

  return query
  with mias as (
    select t.id, t.orden_id, t.integrante_id, t.tipo, t.componente, t.fecha_inicio, t.fecha_entrega,
           t.observacion, t.creado_en
      from public.diseno_tareas t
     where t.creado_por = v_yo
  ),
  ots as (
    select o.id, o.numero, o.estado::text as estado
      from public.ordenes_trabajo o
     where exists (select 1 from mias m where m.orden_id = o.id)
        or (o.estado not in ('ANULADA', 'TERMINADA', 'ENTREGADA', 'FACTURADA')
            and exists (select 1 from public.ot_equipo_diseno e where e.orden_id = o.id and e.funcion = 'COLABORADOR'))
  ),
  ident as (
    select i.orden_id, i.codigo_interno, i.tipo_unidad
      from public.identificacion_ot_diseno((select coalesce(array_agg(x.id), '{}'::uuid[]) from ots x)) i
  ),
  por_ot as (
    select m.orden_id,
           max(m.fecha_inicio) as ultima,
           jsonb_agg(jsonb_build_object(
             'id', m.id, 'tipo', m.tipo, 'componente', m.componente,
             'fecha_inicio', m.fecha_inicio, 'fecha_entrega', m.fecha_entrega,
             'integrante', e.nombre, 'observacion', m.observacion)
             order by m.fecha_inicio desc, m.creado_en desc, m.id) as actividades
      from mias m
      left join public.ot_equipo_diseno e on e.id = m.integrante_id
     group by m.orden_id
  )
  select o.id, o.numero, d.codigo_interno, d.tipo_unidad, o.estado,
         p.ultima, coalesce(p.actividades, '[]'::jsonb)
    from ots o
    left join por_ot p on p.orden_id = o.id
    left join ident d on d.orden_id = o.id
   order by p.ultima desc nulls last, o.numero;
end;
$$;

comment on function public.trabajo_de_diseno_por_ot() is
  'El trabajo del colaborador de Diseño reunido por OT: una fila por cada OT de su equipo (o donde anotó algo), con sus actividades de todas las semanas en `actividades` (de la más reciente a la más antigua). Solo lectura, security invoker; sin leer unidades.';

revoke all on function public.trabajo_de_diseno_por_ot() from public, anon;
grant execute on function public.trabajo_de_diseno_por_ot() to authenticated;
