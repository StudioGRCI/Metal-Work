-- =============================================================================
-- EL CONTROL DE PLAZOS VE LAS ETAPAS QUE DEFINE DISEÑO
-- -----------------------------------------------------------------------------
-- Desde el 28/09 Diseño define las etapas de cada OT a mano —nombre, área y
-- peso— y esas etapas no tienen fila en `etapas_catalogo`. Las dos vistas del
-- control de plazos seguían uniendo con el catálogo por INNER JOIN, así que
-- toda etapa libre se caía de la consulta: la pantalla «Control de plazos»
-- decía «Todavía no hay etapas que controlar» con las órdenes 2898 y 2919 ya
-- programadas, y el tablero contaba cero etapas vencidas aunque las hubiera.
--
-- La etapa libre ya trae su área (`ot_etapas.area_id`) y su nombre: se usan
-- cuando no hay catálogo. Las etapas de catálogo de las OT históricas siguen
-- saliendo exactamente igual que antes, con el área y el orden del catálogo.
-- Mismas columnas, mismos tipos y `security_invoker`: cada rol sigue viendo
-- solo lo que el RLS de sus tablas le deja ver.
-- =============================================================================

create or replace view public.v_plazos_por_area
with (security_invoker = on) as
select
  oe.id as etapa_id,
  oe.orden_id,
  o.numero as orden_numero,
  a.id as area_id,
  a.codigo as area_codigo,
  a.nombre as area_nombre,
  a.encargado as area_encargado,
  coalesce(oe.nombre, ec.nombre) as etapa_nombre,
  coalesce(ec.orden_secuencia, oe.orden_secuencia) as orden_secuencia,
  coalesce(o.descripcion, oe.nombre, ec.nombre) as unidad,
  c.razon_social as cliente,
  u.codigo_interno,
  coalesce(u.placa::text, 'FMI '::text || u.numero_fmi) as placa,
  oe.fecha_inicio_programada,
  oe.fecha_fin_programada,
  oe.fecha_fin_real,
  oe.estado,
  oe.avance_porcentaje,
  oe.responsable_id,
  oe.fecha_fin_programada - current_date as dias,
  public.estado_del_plazo(oe.fecha_fin_programada, oe.fecha_fin_real) as plazo,
  0::bigint as material_lineas,
  0::numeric as material_monto,
  r.id as ultimo_reporte_id,
  r.texto as ultimo_reporte,
  r.creado_en as ultimo_reporte_en,
  r.verificado_en as ultimo_reporte_verificado_en
from public.ot_etapas oe
join public.ordenes_trabajo o on o.id = oe.orden_id
left join public.etapas_catalogo ec on ec.id = oe.etapa_catalogo_id
left join public.areas a on a.id = coalesce(ec.area_id, oe.area_id)
left join public.clientes c on c.id = o.cliente_id
left join public.unidades u on u.id = o.unidad_id
left join lateral (
  select rr.id, rr.texto, rr.creado_en, rr.verificado_en
    from public.ot_etapa_reportes rr
   where rr.etapa_id = oe.id
   order by rr.creado_en desc
   limit 1
) r on true
where o.estado <> all (array['BORRADOR'::public.estado_ot, 'ANULADA'::public.estado_ot,
                             'ENTREGADA'::public.estado_ot, 'FACTURADA'::public.estado_ot])
  and oe.estado <> 'OMITIDA'::public.estado_etapa_ot;

create or replace view public.v_plazos_resumen
with (security_invoker = on) as
select
  a.codigo as area_codigo,
  a.nombre as area_nombre,
  public.estado_del_plazo(oe.fecha_fin_programada, oe.fecha_fin_real) as plazo,
  count(*)::integer as cantidad
from public.ot_etapas oe
join public.ordenes_trabajo o on o.id = oe.orden_id
left join public.etapas_catalogo ec on ec.id = oe.etapa_catalogo_id
left join public.areas a on a.id = coalesce(ec.area_id, oe.area_id)
where o.estado <> all (array['BORRADOR'::public.estado_ot, 'ANULADA'::public.estado_ot,
                             'ENTREGADA'::public.estado_ot, 'FACTURADA'::public.estado_ot])
  and oe.estado <> 'OMITIDA'::public.estado_etapa_ot
group by a.codigo, a.nombre, public.estado_del_plazo(oe.fecha_fin_programada, oe.fecha_fin_real);

comment on view public.v_plazos_por_area is
  'Control de plazos por área: una fila por etapa viva, de catálogo o definida por Diseño, con su semáforo y el último reporte del área.';
comment on view public.v_plazos_resumen is
  'Cuántas etapas vivas tiene cada área en cada semáforo; incluye las etapas que define Diseño.';
