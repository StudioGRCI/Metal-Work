-- Cada área recibe lo suyo.
--
-- Es el paso que cierra el puente que abrió la clasificación. Hasta acá:
--
--   · la partida sabe a qué área va —lo dice su clasificación (migración 66)—,
--   · la etapa de la OT sabe qué área la tiene y cuándo (migraciones 63 y 67),
--
-- pero el presupuesto de la orden caía en una lista plana. Diseño no podía ver
-- lo suyo, Pintura tampoco, y para saber qué material le tocaba a Maestranza
-- había que leer sesenta líneas y clasificarlas de memoria.
--
-- Ahora cada línea del presupuesto cae en su etapa. Con eso el área abre su
-- fila del control de plazos y ve su lista: qué tiene que conseguir o montar y
-- cuánto costaba. Y cuando reporta que va tarde, se ve contra qué.
--
-- El reparto NO se hace al generar el presupuesto: la orden nace en borrador y
-- el presupuesto baja ahí mismo, pero las etapas se instancian recién al
-- aprobarla. Si se intentara antes no habría a qué etapa apuntar. Va en el
-- mismo sitio que el programa de fechas y los responsables.

-- =============================================================================
-- LA LÍNEA DE PRESUPUESTO SABE DE QUÉ ÁREA ES
-- =============================================================================

alter table public.ot_presupuesto
  add column if not exists etapa_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'fk_presupuesto_etapa'
  ) then
    -- La pareja (etapa, orden) y no solo la etapa: garantiza que la etapa
    -- pertenece a ESA orden. Con la clave suelta se podía colgar una línea del
    -- presupuesto de una etapa de otra OT y nadie lo notaba.
    alter table public.ot_presupuesto
      add constraint fk_presupuesto_etapa
      foreign key (etapa_id, orden_id)
      references public.ot_etapas(id, orden_id) on delete set null;
  end if;
end $$;

comment on column public.ot_presupuesto.etapa_id is
  'La etapa de la OT que recibe esta línea. Sale de la clasificación de la partida que la originó.';

create index if not exists idx_presupuesto_etapa on public.ot_presupuesto(etapa_id);

-- =============================================================================
-- EL REPARTO
-- =============================================================================

create or replace function public.repartir_presupuesto_a_areas(p_orden_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_repartidas integer;
begin
  update public.ot_presupuesto op
     set etapa_id = oe.id
    from public.cotizacion_partidas cp
    join public.clasificaciones_costeo cc on cc.id = cp.clasificacion_id
    join public.ot_etapas oe on oe.etapa_catalogo_id = cc.etapa_catalogo_id
   where op.orden_id = p_orden_id
     and op.cotizacion_partida_id = cp.id
     -- La etapa tiene que ser de ESTA orden. Va en el WHERE y no en el JOIN:
     -- la tabla que se actualiza no se puede referenciar dentro del FROM.
     and oe.orden_id = op.orden_id
     -- No se repisa un reparto corregido a mano: el jefe de taller puede mover
     -- una línea a otra área y esa decisión manda sobre el catálogo.
     and op.etapa_id is null;

  get diagnostics v_repartidas = row_count;
  return v_repartidas;
end;
$$;

comment on function public.repartir_presupuesto_a_areas is
  'Cuelga cada línea del presupuesto de la etapa que le toca, según la clasificación de la partida que la originó. No pisa un reparto hecho a mano.';

revoke all on function public.repartir_presupuesto_a_areas(uuid) from public, anon, authenticated;

-- Se engancha donde nacen las etapas, junto al programa y a los responsables.
create or replace function public.crear_etapas_ot(p_orden_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_creadas integer;
begin
  if not exists (select 1 from public.ordenes_trabajo where id = p_orden_id) then
    raise exception 'No existe la orden de trabajo %', p_orden_id
      using errcode = 'foreign_key_violation';
  end if;

  insert into public.ot_etapas (
    orden_id, etapa_catalogo_id, orden_secuencia, horas_estimadas, requiere_inspeccion)
  select p_orden_id, ec.id, ec.orden_secuencia, ec.horas_estandar, ec.requiere_inspeccion
    from public.etapas_catalogo ec
   where ec.activo
   order by ec.orden_secuencia
  on conflict (orden_id, etapa_catalogo_id) do nothing;

  get diagnostics v_creadas = row_count;

  if v_creadas > 0 then
    perform public.ot_registrar_evento(
      p_orden_id, 'CREACION',
      format('Se generaron %s etapas de producción para la OT', v_creadas),
      jsonb_build_object('etapas_creadas', v_creadas));
  end if;

  -- Cuándo le toca a cada área.
  perform public.programar_etapas_ot(p_orden_id);
  -- Quién responde por cada una.
  perform public.asignar_responsables_ot(p_orden_id);
  -- Y qué material y qué servicios le tocan.
  perform public.repartir_presupuesto_a_areas(p_orden_id);

  return v_creadas;
end;
$$;

comment on function public.crear_etapas_ot is
  'Crea las etapas de una OT desde el catálogo activo y les baja el programa de la cotización, el jefe de área como responsable y el material que le toca a cada una.';

revoke all on function public.crear_etapas_ot(uuid) from public, anon, authenticated;

-- =============================================================================
-- LO QUE VE CADA ÁREA
-- -----------------------------------------------------------------------------
-- Una fila por línea de presupuesto, con su área y su etapa. Filtrando por área
-- es la lista de compras y de montaje de esa área para esa unidad.
-- =============================================================================

create or replace view public.v_material_por_area
with (security_invoker = true) as
select
  op.id                    as presupuesto_id,
  op.orden_id,
  o.numero                 as orden_numero,
  coalesce(o.descripcion, '')  as unidad,
  op.etapa_id,
  ec.nombre                as etapa_nombre,
  ec.orden_secuencia,
  a.codigo                 as area_codigo,
  a.nombre                 as area_nombre,
  cc.nombre                as clasificacion,
  op.descripcion,
  op.detalle,
  op.unidad_medida,
  op.cantidad,
  op.monto_presupuestado,
  op.tipo_costo
from public.ot_presupuesto op
join public.ordenes_trabajo o on o.id = op.orden_id
left join public.ot_etapas oe on oe.id = op.etapa_id
left join public.etapas_catalogo ec on ec.id = oe.etapa_catalogo_id
left join public.areas a on a.id = ec.area_id
left join public.cotizacion_partidas cp on cp.id = op.cotizacion_partida_id
left join public.clasificaciones_costeo cc on cc.id = cp.clasificacion_id;

comment on view public.v_material_por_area is
  'El presupuesto de cada orden repartido por área: qué tiene que conseguir o montar cada una y cuánto se presupuestó.';

grant select on public.v_material_por_area to authenticated;

-- =============================================================================
-- Y EL CONTROL DE PLAZOS LO ENSEÑA
-- -----------------------------------------------------------------------------
-- Cada fila del control gana dos cifras: cuántas líneas de presupuesto tiene esa
-- área en esa unidad y cuánto suman. Es lo que convierte «Maestranza va tarde»
-- en «Maestranza va tarde y tiene doce cosas por habilitar».
-- =============================================================================

drop view if exists public.v_plazos_por_area;

create view public.v_plazos_por_area
with (security_invoker = true) as
select
  oe.id                       as etapa_id,
  oe.orden_id,
  o.numero                    as orden_numero,
  a.id                        as area_id,
  a.codigo                    as area_codigo,
  a.nombre                    as area_nombre,
  a.encargado                 as area_encargado,
  ec.nombre                   as etapa_nombre,
  ec.orden_secuencia,
  coalesce(o.descripcion, ec.nombre) as unidad,
  c.razon_social              as cliente,
  u.codigo_interno,
  u.placa,
  oe.fecha_inicio_programada,
  oe.fecha_fin_programada,
  oe.fecha_fin_real,
  oe.estado,
  oe.avance_porcentaje,
  oe.responsable_id,
  (oe.fecha_fin_programada - current_date) as dias,
  public.estado_del_plazo(oe.fecha_fin_programada, oe.fecha_fin_real) as plazo,
  coalesce(m.lineas, 0)       as material_lineas,
  coalesce(m.monto, 0)        as material_monto,
  r.id                        as ultimo_reporte_id,
  r.texto                     as ultimo_reporte,
  r.creado_en                 as ultimo_reporte_en,
  r.verificado_en             as ultimo_reporte_verificado_en
from public.ot_etapas oe
join public.ordenes_trabajo o on o.id = oe.orden_id
join public.etapas_catalogo ec on ec.id = oe.etapa_catalogo_id
left join public.areas a on a.id = ec.area_id
left join public.clientes c on c.id = o.cliente_id
left join public.unidades u on u.id = o.unidad_id
left join lateral (
  select count(*) as lineas, sum(op.monto_presupuestado) as monto
    from public.ot_presupuesto op
   where op.etapa_id = oe.id
) m on true
left join lateral (
  select id, texto, creado_en, verificado_en
    from public.ot_etapa_reportes rr
   where rr.etapa_id = oe.id
   order by rr.creado_en desc
   limit 1
) r on true
where o.estado not in ('BORRADOR', 'ANULADA', 'ENTREGADA', 'FACTURADA')
  and oe.estado <> 'OMITIDA';

comment on view public.v_plazos_por_area is
  'El CONTROL DE PLAZOS de la empresa: una fila por etapa en curso con sus fechas, los días que faltan, el semáforo, lo que le toca de material y el último reporte del área.';

grant select on public.v_plazos_por_area to authenticated;

-- Las órdenes que ya tienen etapas y presupuesto se reparten ahora.
do $$
declare
  o record;
begin
  for o in
    select distinct op.orden_id
      from public.ot_presupuesto op
     where op.etapa_id is null
  loop
    perform public.repartir_presupuesto_a_areas(o.orden_id);
  end loop;
end $$;
