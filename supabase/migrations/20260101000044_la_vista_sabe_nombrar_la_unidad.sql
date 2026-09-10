-- =============================================================================
-- LA VISTA TAMBIÉN TIENE QUE SABER NOMBRAR LA UNIDAD
-- -----------------------------------------------------------------------------
-- Desde que la placa puede faltar, `nombreDeUnidad()` cae al código interno de
-- fabricación, al número de chasis o a la marca y el modelo. Pero solo puede
-- caer a lo que la consulta le traiga, y `ot_resumen` —la fuente del listado de
-- órdenes y del tablero, las dos pantallas que más se miran— expone únicamente
-- `u.placa`.
--
-- Sin esto, una unidad sin matricular se leería «Unidad sin placa» en el tablero
-- del taller: el mismo hueco de antes, disfrazado de texto. Y el hueco
-- disfrazado es peor, porque parece una respuesta.
--
-- Las cuatro columnas van al final del select a propósito: `create or replace
-- view` no admite meterlas en medio, y el orden de las que ya estaban tiene que
-- quedar intacto o la sentencia se cae.
-- =============================================================================

create or replace view public.ot_resumen as
select
  o.id,
  o.numero,
  o.estado,
  o.prioridad,
  o.tipo_trabajo,
  o.sede_id,
  s.nombre                    as sede,
  o.cliente_id,
  c.razon_social              as cliente,
  c.numero_documento          as cliente_documento,
  o.unidad_id,
  u.placa,
  tc.nombre                   as tipo_carroceria,
  o.descripcion,
  o.fecha_registro,
  o.fecha_inicio_programada,
  o.fecha_fin_programada,
  o.fecha_entrega_comprometida,
  o.fecha_inicio_real,
  o.fecha_fin_real,
  o.avance_porcentaje,
  o.horas_estimadas,
  o.horas_reales,
  (o.horas_reales - o.horas_estimadas)                        as desviacion_horas,
  o.moneda,
  o.monto_presupuestado,
  o.responsable_id,
  (r.nombres || ' ' || r.apellidos)                           as responsable,
  count(e.id)                                                 as etapas_total,
  count(e.id) filter (where e.estado = 'TERMINADA')           as etapas_terminadas,
  count(e.id) filter (where e.estado = 'EN_PROCESO')          as etapas_en_proceso,
  -- Días de atraso frente a lo prometido al cliente; 0 si aún hay plazo o si la
  -- OT ya salió del taller.
  case
    when o.estado in ('ENTREGADA', 'FACTURADA', 'ANULADA') then 0
    when o.fecha_entrega_comprometida is null then 0
    else greatest(current_date - o.fecha_entrega_comprometida, 0)
  end                                                         as dias_atraso,
  -- Y los días de taller que quedan: los domingos y los feriados no cuentan,
  -- porque en esos días la unidad no avanza.
  case
    when o.estado in ('ENTREGADA', 'FACTURADA', 'ANULADA') then null
    when o.fecha_entrega_comprometida is null then null
    else public.dias_habiles_entre(current_date, o.fecha_entrega_comprometida)
  end                                                         as dias_habiles_restantes,
  -- Con qué se nombra la unidad mientras no tenga placa. El taller la llama por
  -- su código de fabricación; un camión recién comprado solo trae su chasis.
  u.codigo_interno,
  u.numero_chasis,
  u.marca,
  u.modelo
from public.ordenes_trabajo o
join public.clientes c        on c.id  = o.cliente_id
join public.sedes s           on s.id  = o.sede_id
left join public.unidades u   on u.id  = o.unidad_id
left join public.tipos_carroceria tc on tc.id = o.tipo_carroceria_id
left join public.usuarios r   on r.id  = o.responsable_id
left join public.ot_etapas e  on e.orden_id = o.id
group by o.id, c.id, s.id, u.id, tc.id, r.id;

comment on view public.ot_resumen is
  'Una fila por OT con cliente, unidad, avance, horas, atraso y días de taller restantes. Trae también con qué nombrar la unidad cuando todavía no tiene placa. Es la fuente del tablero de órdenes.';
