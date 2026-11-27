-- =============================================================================
-- EL RECORRIDO DE LA COTIZACIÓN, UNIDAD POR UNIDAD
-- -----------------------------------------------------------------------------
-- La cotización de varias unidades lleva una OT y un código por unidad
-- (20261126760000) y cada factura dice de qué unidad es (20261126998000). El
-- recorrido seguía contando la cotización como una sola cosa: «Con código
-- interno y OT» recién cuando estaban todas, y una sola «Factura» y un solo
-- «Cobro». Con tres camabajas, una podía estar cobrada y otra sin OT, y el
-- recorrido no decía cuál.
--
-- DKS decidió el 2026-11-26: «OT, factura y cobro por unidad. Cada unidad
-- muestra su OT, su factura y su cobro, con quién la tiene y hace cuántos
-- días. Con una sola unidad se ve igual que hoy.»
--
--   · `recorrido_de_cotizaciones` da dos columnas más, `unidad` y `unidades`.
--     La cotización de una unidad da los mismos pasos de siempre, con las dos
--     vacías. La de varias da los pasos de toda la cotización (subida,
--     revisión, corrección, anulación) y, por cada unidad, su OT, su factura y
--     su cobro: quién lo hizo y cuándo, o quién lo tiene ahora y desde cuándo.
--   · Se sigue por unidad desde que Gerencia la aprueba, o antes si ya tiene
--     una OT, una factura o una unidad que pasó a otro comprador. Mientras
--     nadie hizo nada de eso, lo que falta se dice una vez, como siempre.
--   · La factura por toda la cotización cuenta en cada unidad que cubre, con
--     su parte (`facturas_venta_unidades`); su cobro, igual.
--   · La unidad cuya OT pasó a otro comprador (20261126988000) lo dice en su
--     unidad y ya no espera OT ni factura.
--   · La unidad espera su OT desde la aprobación; si ya tuvo una y se anuló
--     (aquí, o allá donde había pasado, y la venta se reabrió), desde esa
--     anulación: los días que Administración no la tuvo no se le cuentan.
--   · Quién ve qué no cambia: la factura dice solo quién y cuándo; «en parte»,
--     lo que falta facturar y el cobro, solo a quien lee los cobros; el número
--     de la OT, solo a quien lee las órdenes.
--
-- `codigo_interno_recorrido` (la ficha del código) decía «Sin cotización» en
-- las unidades que no eran la última: buscaba la cotización por el código de su
-- OT más nueva. Ahora la cotización de varias unidades es de cada uno de sus
-- códigos, y la función dice qué unidad es (`cotizacion_unidad`,
-- `cotizacion_unidades`) para que la ficha muestre el recorrido de esa unidad.
--
-- La parte de una factura no se queda sin su unidad: la cotización con una
-- factura vigente no se corrige (`fn_cotizacion_pdf_revision`), así que su
-- cantidad de unidades no baja mientras la tenga. El check 498 lo vigila.
--
-- Las dos funciones cambian sus columnas de salida, así que se quitan y se
-- vuelven a crear en la misma transacción, con sus permisos. Solo si siguen
-- siendo las que conoce el repositorio (la guarda de la huella).
-- =============================================================================

-- 0. La guarda de la huella -----------------------------------------------------
do $$
declare
  f record;
  huella text;
begin
  for f in
    select * from (values
      -- La de la 20261126988000, y la de esta migración.
      ('public.recorrido_de_cotizaciones(uuid[])', array['dd8275d9fb006291102445a6d2e83a84', 'e5a553a26cd019f52826f33ac472c0fa']),
      -- La de la 20261126640000, y la de esta.
      ('public.codigo_interno_recorrido(text)', array['ddee94a2eaf1d16f79d9314f760230ab', '3560c133732a6ff3ee8b64e044814868'])
    ) as t(firma, conocidas)
  loop
    select md5(replace(p.prosrc, E'\r', '')) into huella from pg_proc p where p.oid = to_regprocedure(f.firma);
    if huella is null then
      raise exception 'Falta la función %: esta base no tiene las migraciones anteriores.', f.firma;
    end if;
    if not (huella = any (f.conocidas)) then
      raise exception 'La función % no es la que conoce el repositorio (huella %): no se reemplaza. Avisa antes de seguir.', f.firma, huella;
    end if;
  end loop;
  if to_regclass('public.facturas_venta_unidades') is null then
    raise exception 'Falta la tabla facturas_venta_unidades: aplica antes la migración 20261126998000.';
  end if;
end $$;

-- 0b. Qué unidad dejó en una venta la OT que pasó a otro comprador -------------
-- Hoy la OT que pasa conserva su número de unidad (20261126988000), así que es
-- el de la OT. Se lee en un solo lugar a propósito: si la OT llega a tomar otra
-- unidad en la venta nueva, esta función pasa a leer la que dejó, y el
-- recorrido sigue diciendo la unidad correcta sin tocarlo. Esa migración
-- (la de Administración, posterior) la redefine; por eso aquí solo se crea si
-- todavía no existe: volver a correr esta no le pisa el cuerpo.
do $crear$
begin
  if to_regprocedure('public.unidad_que_dejo_la_ot(uuid, uuid)') is null then
    create function public.unidad_que_dejo_la_ot(p_orden uuid, p_cotizacion uuid)
    returns integer
    language sql
    stable
    set search_path to 'public'
    as $$
  select coalesce(o.numero_de_unidad, 1)::integer from public.ordenes_trabajo o where o.id = p_orden;
$$;
  end if;
end $crear$;

comment on function public.unidad_que_dejo_la_ot(uuid, uuid) is
  'La unidad que la OT ocupaba en la cotización p_cotizacion antes de pasar a otro comprador. Ayudante interno del recorrido.';

revoke all on function public.unidad_que_dejo_la_ot(uuid, uuid) from public, anon, authenticated;

-- 1. El recorrido de la cotización, con sus unidades ----------------------------
drop function if exists public.recorrido_de_cotizaciones(uuid[]);

create function public.recorrido_de_cotizaciones(p_ids uuid[])
returns table (
  documento uuid,
  orden     integer,
  paso      text,
  situacion text,
  puesto    text,
  en        timestamptz,
  dias      integer,
  espera    text,
  detalle   text,
  unidad    integer,
  unidades  integer
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_admin     constant boolean := public.es_admin();
  v_comercial constant boolean := public.tiene_permiso('cotizaciones.ver_pdf_comercial');
  v_aprobadas constant boolean := public.tiene_permiso('cotizaciones.ver_aprobadas');
  v_tesoreria constant boolean := public.tiene_permiso('tesoreria.ver_documentos');
  -- El número de la OT lo lee quien lee las órdenes (`puede_ver_orden`); los demás ven el paso sin número.
  v_ordenes   constant boolean := public.es_admin() or public.tiene_permiso('ordenes.ver');
  -- El cobro lo ve quien lee los cobros: la política `ver_cobros_factura_venta`, tal cual.
  v_cobros    constant boolean := v_admin or public.tiene_permiso('contabilidad.facturar') or v_aprobadas or v_tesoreria;
begin
  if not (v_admin or v_comercial or v_aprobadas or v_tesoreria) then
    raise exception 'No tienes permiso para ver las cotizaciones.' using errcode = 'insufficient_privilege';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return;
  end if;
  if cardinality(p_ids) > 500 then
    raise exception 'Pide el recorrido de hasta 500 cotizaciones a la vez.' using errcode = 'check_violation';
  end if;

  return query
  with cot as (
    select c.id, c.estado::text as estado, c.registrado_por, c.creado_en, c.revisado_por, c.revisado_en,
           c.archivo_subido_en, c.version, c.anulado_por, c.anulado_en, c.moneda::text as moneda,
           coalesce(c.cantidad_unidades, 1) as unidades,
           -- Las OT que fueron su venta y pasaron a otro comprador: su unidad ya no
           -- lleva OT (20261126988000). Sin ninguna vigente y todas así, la venta se cerró.
           cardinality(public.ordenes_que_salieron_de_la_cotizacion(c.id, null)) as salieron,
           (cardinality(public.ordenes_que_salieron_de_la_cotizacion(c.id, null)) >= coalesce(c.cantidad_unidades, 1)
            and not exists (select 1 from public.ordenes_trabajo t where t.cotizacion_pdf_id = c.id and t.estado <> 'ANULADA')) as cerrada,
           -- La de varias unidades se sigue unidad por unidad desde que Gerencia la
           -- aprueba, o antes si ya tiene una OT, una factura o una unidad que pasó
           -- a otro comprador. Mientras nadie hizo nada de eso, lo que falta se dice
           -- una vez, como en la de una unidad.
           (coalesce(c.cantidad_unidades, 1) > 1
            and (c.estado::text in ('APROBADA', 'ANULADA')
                 or exists (select 1 from public.ordenes_trabajo t where t.cotizacion_pdf_id = c.id and t.estado <> 'ANULADA')
                 or exists (select 1 from public.facturas_venta f where f.cotizacion_pdf_id = c.id and f.anulada_en is null)
                 or cardinality(public.ordenes_que_salieron_de_la_cotizacion(c.id, null)) > 0)) as por_unidad,
           -- El total con IGV, como lo cuenta Facturación (`totalConIgv`): sin IGV, se le suma el 18 %.
           case when c.monto_venta is null then null
                when ig.incluye_igv = false then round(c.monto_venta::numeric * 1.18, 2)
                else c.monto_venta::numeric end as total
      from public.cotizaciones_pdf c
      left join public.cotizaciones_pdf_igv ig on ig.cotizacion_id = c.id
     where c.id = any(p_ids)
       -- La política `ver_cotizaciones_pdf`, tal cual.
       and (v_admin or v_comercial
            or (v_tesoreria and exists (select 1 from public.cotizaciones_pdf_liberaciones_tesoreria l
                                         where l.cotizacion_pdf_id = c.id))
            or (v_aprobadas and public.cotizacion_fue_aprobada(c.id)))
  ),
  -- Cada versión que se archivó al corregir, con cuándo se subió la siguiente.
  versiones as (
    select v.cotizacion_id as cot, v.version, v.rechazado_por, v.rechazado_en, v.estado_al_archivar,
           coalesce(lead(v.subido_en) over (partition by v.cotizacion_id order by v.version), c.archivo_subido_en) as corregida_en
      from public.cotizaciones_pdf_versiones v
      join cot c on c.id = v.cotizacion_id
  ),
  -- La primera OT vigente que salió de ella, desde cuándo tiene código interno,
  -- y cuántas vigentes tiene: con varias unidades, el paso queda hecho cuando
  -- están todas (migración 20261126760000).
  ot as (
    select distinct on (o.cotizacion_pdf_id) o.cotizacion_pdf_id as cot, o.numero, o.creado_por, o.creado_en,
           public.codigo_interno_de_cotizacion_desde(o.cotizacion_pdf_id) as con_codigo_en,
           (count(*) over (partition by o.cotizacion_pdf_id))::integer as vigentes,
           max(o.creado_en) over (partition by o.cotizacion_pdf_id) as ultima_en
      from public.ordenes_trabajo o
      join cot c on c.id = o.cotizacion_pdf_id
     where o.estado <> 'ANULADA'
     order by o.cotizacion_pdf_id, o.creado_en
  ),
  -- Su primera factura vigente: solo quién y cuándo, sin número ni monto.
  factura as (
    select distinct on (f.cotizacion_pdf_id) f.cotizacion_pdf_id as cot, f.registrado_por, f.creado_en
      from public.facturas_venta f
      join cot c on c.id = f.cotizacion_pdf_id
     where f.anulada_en is null
     order by f.cotizacion_pdf_id, f.creado_en
  ),
  -- Cada factura vigente con su cobro, como lo cuenta `v_facturas_venta`:
  -- cobrada si un cobro vigente la cancela o si lo cobrado alcanza su total.
  facturas as (
    select f.cotizacion_pdf_id as cot, f.id, f.moneda::text as moneda, f.total, f.creado_en, f.registrado_por,
           coalesce(bool_or(b.cancela) filter (where b.anulado_en is null), false)
             or coalesce(sum(b.monto) filter (where b.anulado_en is null), 0) >= f.total as cobrada,
           count(b.id) filter (where b.anulado_en is null) as cobros
      from public.facturas_venta f
      join cot c on c.id = f.cotizacion_pdf_id
      left join public.cobros_factura_venta b on b.factura_id = f.id
     where f.anulada_en is null
     group by f.id
  ),
  -- Lo facturado de cada cotización en su moneda, y si alguna factura va en otra.
  facturado as (
    select c.id as cot,
           coalesce(sum(x.total) filter (where x.moneda = c.moneda), 0) as en_su_moneda,
           bool_or(x.moneda <> c.moneda) as en_otra_moneda
      from cot c join facturas x on x.cot = c.id
     group by c.id
  ),
  -- Facturada en parte: le falta facturar lo que no cubren sus facturas, esté
  -- aprobada o en corrección. Con una factura en otra moneda no se compara, como
  -- en Facturación.
  falta_resto as (
    select c.id as cot
      from cot c
      join facturado x on x.cot = c.id
     where c.estado <> 'ANULADA' and c.total is not null
       -- La venta cerrada no se factura más: lo cobrado de su factura la deja cobrada (20261126988000).
       and not c.cerrada
       and not x.en_otra_moneda and x.en_su_moneda < c.total - 0.005
  ),
  -- El último cobro vigente, el que la dejó cobrada: quién y cuándo, sin monto.
  ultimo_cobro as (
    select distinct on (x.cot) x.cot, b.registrado_por, b.creado_en
      from facturas x
      join public.cobros_factura_venta b on b.factura_id = x.id and b.anulado_en is null
     order by x.cot, b.fecha desc, b.creado_en desc
  ),
  -- Los pasos de la cotización contada como una sola cosa: los de siempre. Es
  -- el cuerpo de la 20261126988000 sin tocar, para que la de una unidad salga
  -- idéntica. De la que se sigue por unidad solo quedan, más abajo, los pasos de
  -- toda la cotización: lo que aquí se arma con varias unidades para la OT, la
  -- factura y el cobro (el detalle «lleva/de», «N OT») ya no llega a nadie.
  pasos_de_toda as (
    -- `canon` desempata lo que pasó a la misma hora: cada versión con su revisión
    -- y su corrección, en ese orden, antes que la OT, la factura y el cobro.
    -- Ventas la subió
    select c.id as cot, 10 as canon, 'SUBIDA' as paso, 'HECHO' as situacion, c.registrado_por as quien, null::text as puesto_fijo,
           c.creado_en as en, null::text as espera, null::text as detalle
      from cot c
    union all
    -- La revisión de cada versión anterior
    select v.cot, v.version * 10 + 20, 'REVISION', 'HECHO', v.rechazado_por, null, v.rechazado_en, null, v.estado_al_archivar
      from versiones v where v.rechazado_en is not null
    union all
    -- La corrección que la reemplazó
    select v.cot, v.version * 10 + 25, 'CORRECCION', 'HECHO', c.registrado_por, null, v.corregida_en, null, 'versión ' || (v.version + 1)
      from versiones v join cot c on c.id = v.cot
    union all
    -- La revisión de la versión vigente. La anulada conserva quién la revisó y
    -- cuándo; cómo terminó esa revisión (aprobada o rechazada) ya no está en
    -- ninguna columna y sale de la bitácora, del estado que tenía al anularse.
    select c.id, c.version * 10 + 20, 'REVISION', 'HECHO', c.revisado_por, null, c.revisado_en, null,
           case when c.estado = 'ANULADA' then
                  (select b.datos_antes ->> 'estado' from public.audit_log b
                    where b.tabla = 'cotizaciones_pdf' and b.registro_id = c.id and b.accion = 'UPDATE'
                      and b.datos_despues ->> 'estado' = 'ANULADA'
                    order by b.creado_en desc limit 1)
                else c.estado end
      from cot c where c.estado in ('APROBADA', 'RECHAZADA', 'ANULADA') and c.revisado_en is not null
    union all
    select c.id, c.version * 10 + 20, 'REVISION', 'AHORA', null, 'Gerencia', c.archivo_subido_en, 'REVISION', null
      from cot c where c.estado = 'POR_REVISAR'
    union all
    -- Rechazada: vuelve a quien la subió, y después Gerencia revisa la corrección
    select c.id, c.version * 10 + 25, 'CORRECCION', 'AHORA', null, coalesce(public.puesto_de(c.registrado_por), 'Ventas'), c.revisado_en, 'CORRECCION', null
      from cot c where c.estado = 'RECHAZADA'
    union all
    select c.id, c.version * 10 + 30, 'REVISION', 'PENDIENTE', null, null, null, null, null
      from cot c where c.estado = 'RECHAZADA'
    union all
    -- Administración le dio el código interno y subió la OT. Con varias
    -- unidades, cuando cargó la de la última: hasta entonces la sigue teniendo.
    -- Con una sola OT, su número; con varias, cuántas.
    select o.cot, 100000, 'CODIGO_Y_OT', 'HECHO', o.creado_por, null, o.ultima_en, null,
           case when c.unidades > 1 then o.vigentes || ' OT' when v_ordenes then 'OT ' || o.numero end
      from ot o join cot c on c.id = o.cot
     where o.vigentes + c.salieron >= c.unidades or c.estado = 'ANULADA'
    union all
    -- Su OT pasó a otro comprador con «Editar OT» (20261126988000): esa unidad ya
    -- no lleva OT. El número, solo a quien lee las órdenes.
    select c.id, 99990, 'OTRO_COMPRADOR', 'HECHO', va.creado_por, null, va.creado_en, null,
           case when v_ordenes then array_to_string(public.ordenes_que_salieron_de_la_cotizacion(c.id, null), ', ') end
      from cot c
      cross join lateral (
        select v.creado_por, v.creado_en from public.ot_ventas_anteriores v
          join public.ordenes_trabajo t on t.id = v.orden_id
         where v.cotizacion_pdf_id = c.id and t.cotizacion_pdf_id is distinct from c.id
         order by v.creado_en desc limit 1
      ) va
     where c.salieron > 0
    union all
    -- Espera desde la aprobación, tenga ya algunas o ninguna. El detalle dice
    -- cuántas lleva de cuántas («1/3») cuando la cotización es de varias.
    select c.id, 100000, 'CODIGO_Y_OT', 'AHORA', null, 'Administración', c.revisado_en, 'CODIGO_Y_OT',
           -- «lleva/de», y «/pasaron» si alguna pasó a otro comprador.
           case when c.unidades > 1 then coalesce(o.vigentes, 0) || '/' || c.unidades
                || case when c.salieron > 0 then '/' || c.salieron else '' end end
      from cot c left join ot o on o.cot = c.id
     where c.estado = 'APROBADA' and coalesce(o.vigentes, 0) + c.salieron < c.unidades
    union all
    select c.id, 100000, 'CODIGO_Y_OT', 'PENDIENTE', null, null, null, null, null
      from cot c left join ot o on o.cot = c.id
     where c.estado in ('POR_REVISAR', 'RECHAZADA') and coalesce(o.vigentes, 0) + c.salieron < c.unidades
    union all
    -- Contabilidad la facturó. A quien lee las facturas le dice si fue solo una parte.
    select f.cot, 100010, 'FACTURA', 'HECHO', f.registrado_por, null, f.creado_en, null,
           case when v_cobros and exists (select 1 from falta_resto r where r.cot = f.cot) then 'EN_PARTE' end
      from factura f
    union all
    -- Espera su factura desde que la OT tiene código interno (DKS, Plan 10). Con
    -- varias unidades, cuando están todas sus OT, desde la última.
    select c.id, 100010, 'FACTURA', 'AHORA', null, 'Contabilidad',
           case when c.unidades > 1 then o.ultima_en else coalesce(o.con_codigo_en, o.creado_en) end, 'FACTURA', null
      from cot c join ot o on o.cot = c.id
     where c.estado = 'APROBADA' and o.vigentes + c.salieron >= c.unidades
       and not exists (select 1 from factura f where f.cot = c.id)
    union all
    select c.id, 100010, 'FACTURA', 'PENDIENTE', null, null, null, null, null
      from cot c
     where c.estado <> 'ANULADA' and not c.cerrada and not exists (select 1 from factura f where f.cot = c.id)
       and not (c.estado = 'APROBADA' and exists (select 1 from ot o where o.cot = c.id and o.vigentes + c.salieron >= c.unidades))
    union all
    -- Facturada en parte: espera la factura de lo que falta, desde la misma hora.
    -- Cuánto se facturó solo lo ve quien lee las facturas: Ventas no.
    select r.cot, 100015, 'FACTURA_RESTO', 'AHORA', null, 'Contabilidad', coalesce(o.con_codigo_en, o.creado_en), 'FACTURA_RESTO', null
      from falta_resto r
      join cot c on c.id = r.cot
      join ot o on o.cot = r.cot
     where v_cobros and c.estado = 'APROBADA'
    union all
    -- Tesorería la cobró: todas sus facturas vigentes quedaron cobradas y no falta
    -- facturar nada. Cobrado el adelanto, el cobro del resto sigue pendiente.
    select u.cot, 100018, 'COBRO', 'HECHO', u.registrado_por, null, u.creado_en, null, null
      from ultimo_cobro u
     where v_cobros and not exists (select 1 from facturas x where x.cot = u.cot and not x.cobrada)
       and not exists (select 1 from falta_resto r where r.cot = u.cot)
    union all
    select r.cot, 100018, 'COBRO', 'PENDIENTE', null, null, null, null, null
      from falta_resto r
     where v_cobros and not exists (select 1 from facturas x where x.cot = r.cot and not x.cobrada)
    union all
    -- Alguna factura vigente espera su cobro: desde la más vieja de las que faltan.
    select x.cot, 100018, 'COBRO', 'AHORA', null, 'Tesorería', min(x.creado_en), 'COBRO',
           case when sum(x.cobros) > 0 then 'EN_PARTE' end
      from facturas x
     where v_cobros and not x.cobrada
     group by x.cot
    union all
    select c.id, 100018, 'COBRO', 'PENDIENTE', null, null, null, null, null
      from cot c
     where v_cobros and c.estado <> 'ANULADA' and not c.cerrada and not exists (select 1 from facturas x where x.cot = c.id)
    union all
    -- Anulada
    select c.id, 100020, 'ANULACION', 'HECHO', c.anulado_por, null, c.anulado_en, null, null
      from cot c where c.estado = 'ANULADA' and c.anulado_en is not null
  ),
  -- Desde aquí, lo de la cotización que se sigue unidad por unidad -------------
  -- Cada unidad, con lo que le toca del total (`parte_de_unidad`, como Facturación).
  uni as (
    select c.id as cot, k.unidad, c.unidades, c.estado, c.revisado_en, c.moneda,
           public.parte_de_unidad(c.total, c.unidades::integer, k.unidad) as parte
      from cot c
      cross join lateral generate_series(1, c.unidades::integer) as k(unidad)
     where c.por_unidad
  ),
  -- La OT vigente de cada unidad y desde cuándo tiene su código interno.
  u_ot as (
    select distinct on (o.cotizacion_pdf_id, coalesce(o.numero_de_unidad, 1))
           o.cotizacion_pdf_id as cot, coalesce(o.numero_de_unidad, 1)::integer as unidad,
           o.numero, o.creado_por, o.creado_en, public.codigo_interno_de_ot_desde(o.id) as con_codigo_en
      from public.ordenes_trabajo o
      join cot c on c.id = o.cotizacion_pdf_id
     where c.por_unidad and o.estado <> 'ANULADA'
     order by o.cotizacion_pdf_id, coalesce(o.numero_de_unidad, 1), o.creado_en desc
  ),
  -- La unidad cuya OT pasó a otro comprador: la que dejó en esta venta
  -- (`unidad_que_dejo_la_ot`). Quién la pasó y cuándo salió de esta venta.
  u_salio as (
    select distinct on (c.id, k.unidad)
           c.id as cot, k.unidad, t.numero, s.salio_en as en,
           (select va.creado_por from public.ot_ventas_anteriores va
             where va.orden_id = s.orden_id and va.cotizacion_pdf_id = c.id
             order by va.creado_en desc limit 1) as por
      from cot c
      cross join lateral public.salidas_de_la_cotizacion(c.id, null) s
      join public.ordenes_trabajo t on t.id = s.orden_id
      cross join lateral (select public.unidad_que_dejo_la_ot(t.id, c.id) as unidad) k
     where c.por_unidad and c.salieron > 0
       and not exists (select 1 from u_ot o where o.cot = c.id and o.unidad = k.unidad)
     order by c.id, k.unidad, s.salio_en desc
  ),
  -- Cuándo perdió la unidad su última OT: la anulación de una OT suya, aquí o
  -- allá donde había pasado. La OT anulada no acepta más cambios, así que su
  -- `actualizado_en` es la hora en que se anuló (como en
  -- `ot_anulada_que_reabre_la_venta`).
  u_anulaciones as (
    select x.cot, x.unidad, x.en
      from (
        select o.cotizacion_pdf_id as cot, coalesce(o.numero_de_unidad, 1)::integer as unidad, o.actualizado_en as en
          from public.ordenes_trabajo o
          join cot c on c.id = o.cotizacion_pdf_id
         where c.por_unidad and o.estado = 'ANULADA'
        union all
        select c.id, public.unidad_que_dejo_la_ot(t.id, c.id), t.actualizado_en
          from cot c
          cross join lateral public.camino_de_las_salidas(c.id, null) s
          join public.ordenes_trabajo t on t.id = s.orden_id
         where c.por_unidad and s.anulada
           and exists (select 1 from public.ot_ventas_anteriores va where va.cotizacion_pdf_id = c.id)
      ) x
  ),
  u_sin_ot_desde as (
    select a.cot, a.unidad, max(a.en) as en from u_anulaciones a group by a.cot, a.unidad
  ),
  -- Cada factura vigente en la unidad que cubre, con su parte. La factura por
  -- toda la cotización sale una vez por unidad.
  u_facturas as (
    select x.cot, p.numero_de_unidad::integer as unidad, x.id, x.moneda, p.monto, x.creado_en, x.registrado_por, x.cobrada, x.cobros
      from facturas x
      join cot c on c.id = x.cot
      join public.facturas_venta_unidades p on p.factura_id = x.id
     where c.por_unidad
  ),
  -- Lo facturado de cada unidad en la moneda de la cotización, y si algo va en otra.
  u_facturado as (
    select f.cot, f.unidad,
           coalesce(sum(f.monto) filter (where f.moneda = c.moneda), 0) as en_su_moneda,
           bool_or(f.moneda <> c.moneda) as en_otra_moneda
      from u_facturas f join cot c on c.id = f.cot
     group by f.cot, f.unidad
  ),
  -- La unidad facturada en parte: le falta lo que sus facturas no cubren de lo
  -- suyo. La que pasó a otro comprador no se factura más.
  u_falta_resto as (
    select u.cot, u.unidad
      from uni u
      join u_facturado x on x.cot = u.cot and x.unidad = u.unidad
     where u.estado <> 'ANULADA' and u.parte is not null
       and not exists (select 1 from u_salio s where s.cot = u.cot and s.unidad = u.unidad)
       and not x.en_otra_moneda and x.en_su_moneda < u.parte - 0.005
  ),
  -- El último cobro vigente de las facturas de la unidad: quién y cuándo, sin monto.
  u_ultimo_cobro as (
    select distinct on (f.cot, f.unidad) f.cot, f.unidad, b.registrado_por, b.creado_en
      from u_facturas f
      join public.cobros_factura_venta b on b.factura_id = f.id and b.anulado_en is null
     order by f.cot, f.unidad, b.fecha desc, b.creado_en desc
  ),
  pasos_de_unidad as (
    -- Administración le dio su código interno y subió su OT.
    select o.cot, o.unidad, 100000 as canon, 'CODIGO_Y_OT' as paso, 'HECHO' as situacion, o.creado_por as quien, null::text as puesto_fijo,
           o.creado_en as en, null::text as espera, case when v_ordenes then 'OT ' || o.numero end as detalle
      from u_ot o join uni u on u.cot = o.cot and u.unidad = o.unidad
    union all
    -- Su OT pasó a otro comprador: esta unidad ya no lleva OT.
    select s.cot, s.unidad, 99990, 'OTRO_COMPRADOR', 'HECHO', s.por, null, s.en, null, case when v_ordenes then s.numero end
      from u_salio s join uni u on u.cot = s.cot and u.unidad = s.unidad
    union all
    -- Espera su OT desde la aprobación; si ya tuvo una y se anuló, desde entonces.
    select u.cot, u.unidad, 100000, 'CODIGO_Y_OT', 'AHORA', null, 'Administración',
           greatest(u.revisado_en, (select d.en from u_sin_ot_desde d where d.cot = u.cot and d.unidad = u.unidad)),
           'CODIGO_Y_OT', null
      from uni u
     where u.estado = 'APROBADA'
       and not exists (select 1 from u_ot o where o.cot = u.cot and o.unidad = u.unidad)
       and not exists (select 1 from u_salio s where s.cot = u.cot and s.unidad = u.unidad)
    union all
    select u.cot, u.unidad, 100000, 'CODIGO_Y_OT', 'PENDIENTE', null, null, null, null, null
      from uni u
     where u.estado in ('POR_REVISAR', 'RECHAZADA')
       and not exists (select 1 from u_ot o where o.cot = u.cot and o.unidad = u.unidad)
       and not exists (select 1 from u_salio s where s.cot = u.cot and s.unidad = u.unidad)
    union all
    -- Contabilidad la facturó: su primera factura, de la unidad o de toda la
    -- cotización. A quien lee las facturas le dice si cubre solo una parte de lo suyo.
    select f.cot, f.unidad, 100010, 'FACTURA', 'HECHO', f.registrado_por, null, f.creado_en, null,
           case when v_cobros and exists (select 1 from u_falta_resto r where r.cot = f.cot and r.unidad = f.unidad) then 'EN_PARTE' end
      from (select distinct on (x.cot, x.unidad) x.cot, x.unidad, x.registrado_por, x.creado_en
              from u_facturas x order by x.cot, x.unidad, x.creado_en) f
      join uni u on u.cot = f.cot and u.unidad = f.unidad
    union all
    -- Espera su factura desde que su OT tiene código interno, sin esperar a las
    -- demás unidades (DKS, 2026-11-26).
    select u.cot, u.unidad, 100010, 'FACTURA', 'AHORA', null, 'Contabilidad', coalesce(o.con_codigo_en, o.creado_en), 'FACTURA', null
      from uni u join u_ot o on o.cot = u.cot and o.unidad = u.unidad
     where u.estado = 'APROBADA'
       and not exists (select 1 from u_facturas x where x.cot = u.cot and x.unidad = u.unidad)
    union all
    select u.cot, u.unidad, 100010, 'FACTURA', 'PENDIENTE', null, null, null, null, null
      from uni u
     where u.estado <> 'ANULADA'
       and not exists (select 1 from u_salio s where s.cot = u.cot and s.unidad = u.unidad)
       and not exists (select 1 from u_facturas x where x.cot = u.cot and x.unidad = u.unidad)
       and not (u.estado = 'APROBADA' and exists (select 1 from u_ot o where o.cot = u.cot and o.unidad = u.unidad))
    union all
    -- Facturada en parte: espera la factura de lo que le falta a la unidad.
    select r.cot, r.unidad, 100015, 'FACTURA_RESTO', 'AHORA', null, 'Contabilidad', coalesce(o.con_codigo_en, o.creado_en), 'FACTURA_RESTO', null
      from u_falta_resto r
      join uni u on u.cot = r.cot and u.unidad = r.unidad
      join u_ot o on o.cot = r.cot and o.unidad = r.unidad
     where v_cobros and u.estado = 'APROBADA'
    union all
    -- Facturada en parte y todavía sin su OT (la factura por toda la cotización
    -- llegó antes): lo que le falta facturar no se pierde de vista, queda pendiente.
    select r.cot, r.unidad, 100015, 'FACTURA_RESTO', 'PENDIENTE', null, null, null, null, null
      from u_falta_resto r
      join uni u on u.cot = r.cot and u.unidad = r.unidad
     where v_cobros
       and not (u.estado = 'APROBADA' and exists (select 1 from u_ot o where o.cot = r.cot and o.unidad = r.unidad))
    union all
    -- Tesorería la cobró: las facturas de la unidad quedaron cobradas y no le
    -- falta facturar nada.
    select b.cot, b.unidad, 100018, 'COBRO', 'HECHO', b.registrado_por, null, b.creado_en, null, null
      from u_ultimo_cobro b join uni u on u.cot = b.cot and u.unidad = b.unidad
     where v_cobros and not exists (select 1 from u_facturas x where x.cot = b.cot and x.unidad = b.unidad and not x.cobrada)
       and not exists (select 1 from u_falta_resto r where r.cot = b.cot and r.unidad = b.unidad)
    union all
    select r.cot, r.unidad, 100018, 'COBRO', 'PENDIENTE', null, null, null, null, null
      from u_falta_resto r
     where v_cobros and not exists (select 1 from u_facturas x where x.cot = r.cot and x.unidad = r.unidad and not x.cobrada)
    union all
    -- Alguna factura de la unidad espera su cobro: desde la más vieja de las que faltan.
    select x.cot, x.unidad, 100018, 'COBRO', 'AHORA', null, 'Tesorería', min(x.creado_en), 'COBRO',
           case when sum(x.cobros) > 0 then 'EN_PARTE' end
      from u_facturas x join uni u on u.cot = x.cot and u.unidad = x.unidad
     where v_cobros and not x.cobrada
     group by x.cot, x.unidad
    union all
    select u.cot, u.unidad, 100018, 'COBRO', 'PENDIENTE', null, null, null, null, null
      from uni u
     where v_cobros and u.estado <> 'ANULADA'
       and not exists (select 1 from u_salio s where s.cot = u.cot and s.unidad = u.unidad)
       and not exists (select 1 from u_facturas x where x.cot = u.cot and x.unidad = u.unidad)
  ),
  -- Todo junto. `bloque` ordena la de varias unidades: primero lo de toda la
  -- cotización, después cada unidad con lo suyo y al final la anulación. En la
  -- de una unidad todo va en el mismo bloque, como siempre.
  pasos as (
    select p.cot, null::integer as unidad, null::integer as unidades,
           case when c.por_unidad and p.paso = 'ANULACION' then 2 else 0 end as bloque,
           p.canon, p.paso, p.situacion, p.quien, p.puesto_fijo, p.en, p.espera, p.detalle
      from pasos_de_toda p
      join cot c on c.id = p.cot
     where not (c.por_unidad and p.paso in ('CODIGO_Y_OT', 'OTRO_COMPRADOR', 'FACTURA', 'FACTURA_RESTO', 'COBRO'))
    union all
    select p.cot, p.unidad, u.unidades::integer, 1, p.canon, p.paso, p.situacion, p.quien, p.puesto_fijo, p.en, p.espera, p.detalle
      from pasos_de_unidad p
      join uni u on u.cot = p.cot and u.unidad = p.unidad
  )
  -- Los días de cada paso hecho: cuántas fechas de Lima pasaron desde el paso
  -- hecho anterior (la subida no tiene anterior). Así el vendedor ve cuánto
  -- tardó Gerencia en responder y cuánto tardó la OT, sin hacer la cuenta. En
  -- cada unidad, desde su paso anterior; el primero, desde la aprobación o desde
  -- la anulación de la OT que tenía antes. La
  -- anulación de la que va por unidad, desde lo último que se hizo en cualquiera.
  select x.cot, x.n, x.paso, x.situacion, x.puesto, x.en,
         case when x.situacion = 'AHORA' then public.dias_en_espera(x.en)
              when x.situacion = 'HECHO' and x.en is not null and x.previo is not null
              then greatest((x.en at time zone 'America/Lima')::date - (x.previo at time zone 'America/Lima')::date, 0)
         end,
         x.espera, x.detalle, x.unidad, x.unidades
    from (
      select p.cot,
             (row_number() over (
                partition by p.cot
                order by p.bloque, coalesce(p.unidad, 0),
                         case p.situacion when 'HECHO' then 0 when 'AHORA' then 1 else 2 end,
                         case when p.situacion = 'HECHO' then p.en end, p.canon))::integer as n,
             p.paso, p.situacion,
             case when p.situacion = 'HECHO' then public.puesto(u) else p.puesto_fijo end as puesto,
             p.en,
             -- El paso hecho justo antes, en el mismo orden en que se muestran.
             case when p.bloque = 2
                  then (select max(q.en) from pasos q
                         where q.cot = p.cot and q.bloque < 2 and q.situacion = 'HECHO' and q.en <= p.en)
                  else coalesce(lag(p.en) over (partition by p.cot, p.unidad, p.situacion = 'HECHO' order by p.en, p.canon),
                                -- El primero de la unidad, desde la aprobación; si antes perdió una
                                -- OT, desde esa anulación (la OT que se volvió a cargar).
                                case when p.unidad is not null then
                                  greatest((select c.revisado_en from cot c where c.id = p.cot),
                                           (select max(a.en) from u_anulaciones a
                                             where a.cot = p.cot and a.unidad = p.unidad and a.en <= p.en))
                                end)
             end as previo,
             p.espera, p.detalle, p.unidad, p.unidades
        from pasos p
        left join public.usuarios u on u.id = p.quien
       -- La anulada no espera a nadie: queda lo hecho, como evidencia.
       where p.situacion = 'HECHO'
          or (select c.estado from cot c where c.id = p.cot) <> 'ANULADA'
    ) x;
end;
$$;

comment on function public.recorrido_de_cotizaciones(uuid[]) is
  'El recorrido de cada cotización que quien llama ya puede ver: lo hecho con el puesto de quien lo hizo y su hora, quién la tiene ahora y hace cuántos días, y lo que falta. La de varias unidades da, además, la OT, la factura y el cobro de cada unidad (unidad, unidades); en la de una, esas dos columnas van vacías. Migraciones 20261125130000 y 20261126998900.';

revoke all on function public.recorrido_de_cotizaciones(uuid[]) from public, anon;
grant execute on function public.recorrido_de_cotizaciones(uuid[]) to authenticated;

-- 2. La cotización del código, también en las unidades que no son la última -----
drop function if exists public.codigo_interno_recorrido(text);

create function public.codigo_interno_recorrido(p_codigo text)
returns table (
  cotizacion_id       uuid,
  cotizacion_numero   text,
  cotizacion_estado   text,
  cotizacion_fecha    date,
  cotizaciones        integer,
  ot_id               uuid,
  ot_numero           text,
  ot_estado           text,
  ot_tipo             text,
  ot_del_taller       boolean,
  ot_entregada_el     date,
  ordenes             integer,
  cotizacion_unidad   integer,
  cotizacion_unidades integer
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
           o.abierta_en_taller, o.cotizacion_pdf_id, o.creado_en, coalesce(o.numero_de_unidad, 1)::integer as unidad
      from public.ordenes_trabajo o
      join public.unidades u on u.id = o.unidad_id
     where public.normalizar_codigo_interno(u.codigo_interno) = v_codigo
       and o.estado::text <> 'ANULADA'
  ), cot as (
    -- Las cotizaciones del código. La de una unidad, con la regla del costeo: su
    -- OT no anulada más reciente es de este código. La de varias unidades es de
    -- cada uno de sus códigos: basta que una OT vigente suya lo lleve, y esa OT
    -- dice qué unidad es.
    select c.id, c.numero::text as numero, c.estado::text as estado,
           (c.creado_en at time zone 'America/Lima')::date as fecha,
           public.cotizacion_fue_aprobada(c.id) as aprobada, c.creado_en,
           case when c.cantidad_unidades > 1 then
             (select o.unidad from ot o where o.cotizacion_pdf_id = c.id order by o.creado_en desc limit 1) end as unidad,
           c.cantidad_unidades::integer as unidades
      from public.cotizaciones_pdf c
     where c.id in (select cotizacion_pdf_id from ot where cotizacion_pdf_id is not null)
       and c.estado::text <> 'ANULADA'
       and (c.cantidad_unidades > 1 or public.codigo_interno_de_cotizacion(c.id) = v_codigo)
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
         (select count(*)::integer from ot),
         k.unidad, case when k.unidades > 1 then k.unidades end
    from (select 1) x
    left join la_cot k on true
    left join la_ot o on true;
end;
$$;

comment on function public.codigo_interno_recorrido(text) is
  'La cotización y la OT que cuentan la historia del código, elegidas con la regla del costeo; de la cotización de varias unidades, qué unidad es este código (cotizacion_unidad de cotizacion_unidades). Lo lee quien ve los códigos internos. Migraciones 20261126640000 y 20261126998900.';

revoke all on function public.codigo_interno_recorrido(text) from public, anon;
grant execute on function public.codigo_interno_recorrido(text) to authenticated;

notify pgrst, 'reload schema';
