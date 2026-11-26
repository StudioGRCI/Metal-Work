-- De la cotización al cobro, en la cabecera del código interno (plan 12,
-- entrega 12.3).
--
-- Gerencia quiere ver, arriba de cada código, qué cotización lo vendió, qué OT
-- lo fabrica, cuánto va costando contra el presupuesto, cuánto se facturó y
-- cuánto se cobró. Las cifras ya las dan el costeo (`codigos_internos_costo`) y
-- lo facturado (`v_facturas_venta`). Lo que faltaba es decir **cuál** cotización
-- y **cuál** OT: la lista de documentos del código trae todas las OT de la
-- unidad, también la de garantía que llega después de entregarla, y la
-- cotización de una OT anulada. Elegirlas en la pantalla salía mal: la
-- garantía en borrador quedaba como «la OT» del código, con la fecha de
-- entrega de la de fabricación.
--
-- Esta función las elige con la misma regla del costeo:
-- - la cotización es la que `codigo_interno_de_cotizacion` le da al código
--   (la de su OT no anulada más reciente), no anulada, y entre varias, la
--   aprobada (`cotizacion_fue_aprobada`) más reciente;
-- - la OT es la que lleva esa cotización (no anulada, la más reciente); si el
--   código no tiene cotización, la OT no anulada más reciente que no sea de
--   garantía, y si solo hay garantías, la más reciente;
-- - la entrega es el acta de **esa** OT, no la de cualquier OT del código.
-- Dice además cuántas cotizaciones y OT más tiene el código, para que la
-- pantalla no las calle.
--
-- Solo lectura, sin montos. La pide `codigos_internos.ver`, como la lista de
-- documentos del código. Volver a correrla deja lo mismo (`create or replace`;
-- las dos funciones son nuevas, sin `drop`, que cuelga `apply_migration`).
--
-- Al final, `codigo_interno_lo_vendido`: lo vendido y lo facturado de cada
-- cotización del código, para que la cabecera compare como la bandeja de
-- Contabilidad sin pasar por su tope de 300 cotizaciones.

create or replace function public.codigo_interno_recorrido(p_codigo text)
returns table (
  cotizacion_id     uuid,
  cotizacion_numero text,
  cotizacion_estado text,
  cotizacion_fecha  date,
  cotizaciones      integer,  -- las del código, no anuladas, contando la elegida
  ot_id             uuid,
  ot_numero         text,
  ot_estado         text,
  ot_tipo           text,
  ot_del_taller     boolean,  -- la abrió el taller: en borrador, espera que la revisen
  ot_entregada_el   date,     -- el acta de entrega de esta OT
  ordenes           integer   -- las OT no anuladas del código, contando la elegida
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_codigo constant text := public.normalizar_codigo_interno(p_codigo);
begin
  perform public.exigir_permiso('codigos_internos.ver');
  if v_codigo is null then
    return;
  end if;

  return query
  with ot as (
    select o.id, o.numero::text as numero, o.estado::text as estado, o.tipo_trabajo::text as tipo,
           o.abierta_en_taller, o.cotizacion_pdf_id, o.creado_en
      from public.ordenes_trabajo o
      join public.unidades u on u.id = o.unidad_id
     where public.normalizar_codigo_interno(u.codigo_interno) = v_codigo
       and o.estado::text <> 'ANULADA'
  ), cot as (
    -- Las cotizaciones del código, con la regla del costeo: su OT no anulada más reciente es de este código.
    select c.id, c.numero::text as numero, c.estado::text as estado,
           (c.creado_en at time zone 'America/Lima')::date as fecha,
           public.cotizacion_fue_aprobada(c.id) as aprobada, c.creado_en
      from public.cotizaciones_pdf c
     where c.id in (select cotizacion_pdf_id from ot where cotizacion_pdf_id is not null)
       and c.estado::text <> 'ANULADA'
       and public.codigo_interno_de_cotizacion(c.id) = v_codigo
  ), la_cot as (
    select * from cot order by aprobada desc, creado_en desc limit 1
  ), la_ot as (
    select o.* from ot o
     order by (o.cotizacion_pdf_id is not distinct from (select id from la_cot)) desc,
              (o.tipo = 'GARANTIA') asc,
              o.creado_en desc
     limit 1
  )
  select k.id, k.numero, k.estado, k.fecha, (select count(*)::integer from cot),
         o.id, o.numero, o.estado, o.tipo, o.abierta_en_taller,
         (select max(e.fecha_entrega) from public.ot_entregas e where e.orden_id = o.id),
         (select count(*)::integer from ot)
    from (select 1) x
    left join la_cot k on true
    left join la_ot o on true;
end;
$$;

comment on function public.codigo_interno_recorrido(text) is
  'La cotización y la OT que cuentan la historia de un código interno, con la regla del costeo, y el acta de entrega de esa OT. Sin montos; pide codigos_internos.ver. Plan 12, entrega 12.3.';

revoke all on function public.codigo_interno_recorrido(text) from public, anon;
grant execute on function public.codigo_interno_recorrido(text) to authenticated;

-- Lo vendido y lo facturado de cada cotización del código, para comparar en la
-- cabecera como compara la bandeja de Contabilidad (`estadoDe`, cotización por
-- cotización). La bandeja lee `cotizaciones_para_facturar`, que trae las 300
-- más recientes: un código viejo no entraba y lo facturado salía como hecho
-- sin haberse comparado. Esta la lee por código, sin tope, con la misma puerta
-- que la bandeja (`contabilidad.facturar` o `cotizaciones.ver_aprobadas`) y las
-- mismas cotizaciones: no anuladas, aprobadas alguna vez y de este código.
create or replace function public.codigo_interno_lo_vendido(p_codigo text)
returns table (
  cotizacion_id          uuid,
  numero                 text,
  moneda                 text,
  monto_venta            numeric,
  incluye_igv            boolean,  -- null: Ventas no lo confirmó
  facturas               integer,  -- las vigentes
  facturado_en_su_moneda numeric,  -- lo facturado en la moneda de la cotización
  en_otra_moneda         boolean   -- alguna factura vigente va en otra moneda
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_codigo constant text := public.normalizar_codigo_interno(p_codigo);
begin
  if not (public.es_admin() or public.tiene_permiso('contabilidad.facturar') or public.tiene_permiso('cotizaciones.ver_aprobadas')) then
    raise exception 'No tienes permiso para ver las cotizaciones aprobadas.' using errcode = 'insufficient_privilege';
  end if;
  if v_codigo is null then
    return;
  end if;

  return query
  select c.id, c.numero::text, c.moneda::text, c.monto_venta::numeric, ig.incluye_igv,
         coalesce(fx.facturas, 0), coalesce(fx.en_su_moneda, 0), coalesce(fx.otra, false)
    from public.cotizaciones_pdf c
    left join public.cotizaciones_pdf_igv ig on ig.cotizacion_id = c.id
    left join lateral (
      select count(*)::integer as facturas,
             sum(f.total) filter (where f.moneda::text = c.moneda::text)::numeric as en_su_moneda,
             bool_or(f.moneda::text <> c.moneda::text) as otra
        from public.facturas_venta f
       where f.cotizacion_pdf_id = c.id and f.anulada_en is null) fx on true
   where c.estado::text <> 'ANULADA'
     and public.cotizacion_fue_aprobada(c.id)
     and public.codigo_interno_de_cotizacion(c.id) = v_codigo
   order by c.creado_en;
end;
$$;

comment on function public.codigo_interno_lo_vendido(text) is
  'Lo vendido y lo facturado de cada cotización aprobada de un código, sin tope, para la cabecera del código. La misma puerta que cotizaciones_para_facturar. Plan 12, entrega 12.3.';

revoke all on function public.codigo_interno_lo_vendido(text) from public, anon;
grant execute on function public.codigo_interno_lo_vendido(text) to authenticated;
