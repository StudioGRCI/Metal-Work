-- =============================================================================
-- EL RECORRIDO DE CADA DOCUMENTO
-- -----------------------------------------------------------------------------
-- Quien abre un requerimiento o una cotización pregunta siempre lo mismo: por
-- dónde pasó, quién hizo cada paso y cuándo, quién lo tiene ahora y hace cuántos
-- días. Hasta hoy la respuesta estaba repartida: una insignia con el estado, una
-- nota de Almacén, una fecha suelta. Nadie veía el camino entero, y el que
-- esperaba no sabía a quién esperaba.
--
-- El dato ya existe. Cada documento guarda la fecha y la firma de sus pasos
-- (`creado_por`, `revision_stock_por`, `revisado_por`…): esta migración solo los
-- pone en orden, sin tabla nueva de eventos. La bitácora (`audit_log`) se lee en
-- un solo caso, el que no tiene columna: el RQ que ya estaba listo en almacén y
-- volvió a compra porque Almacén devolvió parte al proveedor.
--
-- Es la base de los planes por puesto (Plan 0, entrega 0.1). Aquí van el
-- requerimiento y la cotización, de muestra; las demás (OC, OS, reporte diario)
-- las suma cada plan con la misma forma.
--
-- Las dos funciones devuelven lo mismo, una fila por paso:
--
--   documento   el RQ o la cotización
--   orden       1, 2, 3… primero lo hecho por fecha, después lo que espera y lo que falta
--   paso        la clave del paso; su etiqueta vive en `src/lib/dominio/recorrido.ts`
--   situacion   HECHO, AHORA (lo tiene alguien) o PENDIENTE (todavía no le toca)
--   puesto      de lo hecho, el puesto de la cuenta que lo hizo; de AHORA, quién lo tiene
--   nombre      de lo hecho, el nombre de la cuenta; vacío en lo demás
--   en          cuándo se hizo; de AHORA, desde cuándo espera
--   dias        solo de AHORA: días que lleva esperando, contados por fecha de Lima
--   espera      solo de AHORA: qué se espera (la clave; la frase vive en la aplicación)
--   detalle     un dato corto del paso (el área que pidió, la OC, la OT); nunca un importe
--
-- Quién las lee: quien ya ve el documento, ni uno más. La del RQ exige
-- `puede_ver_requerimientos()`, que es la política de `requerimientos`; la de la
-- cotización repite la política `ver_cotizaciones_pdf` fila por fila. De cada
-- paso sale el puesto y el nombre de la cuenta, nunca un importe ni un dato de
-- RR. HH. (ni DNI, ni costo por hora).
-- =============================================================================

-- =============================================================================
-- 1. LOS DÍAS EN ESPERA, POR FECHA DE LIMA
-- =============================================================================
-- «Hace 3 días» se cuenta por fechas del taller, no por horas: lo que entró ayer
-- a las 6 p. m. lleva un día esta mañana, no cero. La hora del servidor es UTC,
-- y entre las 7 p. m. y la medianoche de Lima ya es mañana allá.
create or replace function public.dias_en_espera(p_desde timestamptz)
returns integer
language sql
stable
set search_path to 'public'
as $$
  -- `greatest` se salta los vacíos: sin hora no hay días, no cero.
  select case when p_desde is not null then
    greatest((now() at time zone 'America/Lima')::date - (p_desde at time zone 'America/Lima')::date, 0)
  end;
$$;

comment on function public.dias_en_espera(timestamptz) is
  'Días que pasaron desde esa hora, contados por fecha de Lima (hoy = 0). Vacío si no hay hora.';

revoke all on function public.dias_en_espera(timestamptz) from public, anon;
grant execute on function public.dias_en_espera(timestamptz) to authenticated;

-- =============================================================================
-- 2. EL RECORRIDO DEL REQUERIMIENTO
-- =============================================================================
-- Registro → (sustento y visto de Diseño, si se pasa del metrado) → Almacén
-- revisa el stock → compra, si falta → listo en almacén → entrega al área.
--
-- Quién lo tiene ahora sale del estado y, en compra, del insumo más atrasado,
-- como lo calcula `avance_de_requerimientos`: si su OC espera a Gerencia, lo
-- tiene Gerencia; si el conductor salió a recogerla, el conductor.
create or replace function public.recorrido_de_requerimientos(p_ids uuid[])
returns table (
  documento uuid,
  orden     integer,
  paso      text,
  situacion text,
  puesto    text,
  nombre    text,
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
begin
  if not public.puede_ver_requerimientos() then
    raise exception 'No tienes permiso para ver los requerimientos.' using errcode = 'insufficient_privilege';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return;
  end if;
  if cardinality(p_ids) > 500 then
    raise exception 'Pide el recorrido de hasta 500 requerimientos a la vez.' using errcode = 'check_violation';
  end if;

  return query
  with rq as (
    select r.id, r.tipo, r.estado, r.creado_por, r.creado_en,
           r.revision_stock_por, r.revision_stock_en, r.en_atencion_por, r.en_atencion_en,
           r.listo_en_almacen_por, r.listo_en_almacen_en, r.entregado_por, r.entregado_en,
           r.faltante_al_entregar, r.anulado_por, r.anulado_en,
           r.estado not in ('ENTREGADO', 'ANULADO') as abierto,
           a.nombre as area
      from public.requerimientos r
      left join public.areas a on a.id = r.area_id
     where r.id = any(p_ids)
  ),
  -- Cada vez que quien pidió sustentó lo que se pasa del metrado, y cada visto de Diseño.
  sustentos as (
    select l.requerimiento_id as rq, s.sustentado_por, s.sustentado_en, s.decidido_por, s.decidido_en, s.decision
      from public.requerimiento_sustentos s
      join public.requerimiento_lineas l on l.id = s.requerimiento_linea_id
     where l.requerimiento_id = any(p_ids)
  ),
  -- Lo que hoy frena el RQ por el metrado: falta el sustento, o lo tiene Diseño.
  freno as (
    select m.requerimiento_id as rq,
           bool_or(m.estado in ('SIN_SUSTENTO', 'RECHAZADO')) as falta_sustento,
           bool_or(m.estado = 'POR_AUTORIZAR') as espera_diseno
      from public.metrado_por_linea(p_ids) m
     group by m.requerimiento_id
  ),
  -- Lo que a cada insumo le falta llegar al almacén, con la misma cuenta que
  -- hace la tarjeta del RQ (`partesDelInsumo`): lo pedido menos lo que ya está
  -- en almacén o ya se entregó. Si a ninguno le falta, el RQ ya no lo tiene quien
  -- compra aunque su orden de compra siga abierta: lo tiene Almacén.
  insumos as (
    select a.requerimiento_id as rq, l.item, l.orden_compra_id,
           x ->> 'etapa' as etapa,
           (x ->> 'porcentaje')::integer as porcentaje,
           nullif(x ->> 'desde', '')::timestamptz as desde,
           greatest(
             greatest(l.cantidad, 0)
             - greatest(
                 case
                   when e.llegado is not null then
                     least(least(greatest(coalesce(l.cantidad_en_stock, 0), 0), greatest(l.cantidad, 0)) + greatest(e.llegado, 0), greatest(l.cantidad, 0))
                   when x ->> 'etapa' in ('EN_KARDEX', 'EN_STOCK', 'LISTO_EN_ALMACEN', 'ENTREGADO') then greatest(l.cantidad, 0)
                   else least(greatest(coalesce(l.cantidad_en_stock, 0), 0), greatest(l.cantidad, 0))
                 end,
                 least(greatest(coalesce(e.entregado, 0), 0), greatest(l.cantidad, 0))),
             0) as por_llegar
      from public.avance_de_requerimientos(p_ids) a
      cross join lateral jsonb_array_elements(a.lineas) x
      join public.requerimiento_lineas l on l.requerimiento_id = a.requerimiento_id and l.item = (x ->> 'item')::integer
      left join public.entregado_de_requerimientos(p_ids) e on e.requerimiento_id = a.requerimiento_id and e.item = l.item
  ),
  -- De los insumos que todavía no llegan, el más atrasado y su orden de compra, si ya va en una.
  atrasado as (
    select distinct on (i.rq) i.rq, i.etapa,
           case when c.id is not null then public.nombre_de_oc(c.numero, c.referencia) end as oc,
           case i.etapa
             when 'POR_COMPRAR' then case c.aprobacion when 'RECHAZADA' then c.rechazado_en when 'ANULADA' then c.anulada_en end
             when 'OC_POR_APROBAR' then coalesce(c.aprobacion_pedida_en, c.creado_en)
             when 'PENDIENTE_RECOJO' then coalesce(c.recojo_pedido_en, c.aprobado_en, c.creado_en)
             when 'EN_RECOJO' then c.en_recojo_en
             when 'RECOGIDO' then c.recogido_en
             when 'EN_STOCK' then null
             else coalesce(c.dejado_en, c.entregado_almacen_en)
           end as desde
      from insumos i
      left join public.ordenes_compra_materiales c on c.id = i.orden_compra_id
     where i.por_llegar > 0
     order by i.rq, i.porcentaje, i.item
  ),
  -- El RQ en compra al que ya no le falta llegar nada, y desde cuándo: lo último que se supo de sus insumos.
  llego as (
    select i.rq, max(i.desde) as desde
      from insumos i
     group by i.rq
    having bool_and(i.por_llegar = 0)
  ),
  -- El único paso sin columna: el RQ listo en almacén que volvió a compra porque
  -- Almacén devolvió parte al proveedor (`reabrir_rq_por_lo_devuelto` borra la
  -- firma de «listo»). La bitácora guarda cuándo y desde qué cuenta.
  vueltas as (
    select b.registro_id as rq, b.usuario_id, b.creado_en
      from public.audit_log b
     where b.tabla = 'requerimientos' and b.registro_id = any(p_ids) and b.accion = 'UPDATE'
       and b.datos_antes ->> 'estado' = 'LISTO_EN_ALMACEN'
       and b.datos_despues ->> 'estado' = 'EN_ATENCION'
  ),
  -- Quién lo tiene ahora, qué se espera de él y desde cuándo.
  ahora as (
    select q.id as rq,
           case
             when coalesce(f.falta_sustento, false) then 'SUSTENTO'
             when coalesce(f.espera_diseno, false) then 'VISTO_DISENO'
             when q.estado = 'POR_ATENDER' then 'REVISION_STOCK'
             when q.estado = 'SIN_STOCK' and g.rq is null then 'COMPRA'
             when q.estado in ('SIN_STOCK', 'EN_ATENCION') then 'LISTO'
             else 'ENTREGA'
           end as paso,
           case
             when coalesce(f.falta_sustento, false) then coalesce(public.puesto_de(q.creado_por), 'Quien lo pidió')
             when coalesce(f.espera_diseno, false) then 'Diseño'
             when q.estado = 'POR_ATENDER' then 'Almacén'
             when q.estado = 'LISTO_EN_ALMACEN' then coalesce(q.area, 'El área que lo pidió')
             when g.rq is not null then 'Almacén'
             -- La compra entró y no alcanzó: el resto no va en ninguna orden y lo pide de nuevo quien hizo el RQ.
             when t.etapa in ('EN_KARDEX', 'EN_STOCK') then coalesce(public.puesto_de(q.creado_por), 'Quien lo pidió')
             when t.etapa = 'OC_POR_APROBAR' then 'Gerencia'
             when t.etapa in ('PENDIENTE_RECOJO', 'EN_RECOJO', 'RECOGIDO') then 'Conductor de Logística'
             when t.etapa in ('POR_VALIDAR', 'OBSERVADO') then 'Almacén'
             when q.tipo = 'ADMINISTRACION' then 'Administración'
             else 'Logística'
           end as puesto,
           case
             when coalesce(f.falta_sustento, false) then 'SUSTENTO'
             when coalesce(f.espera_diseno, false) then 'VISTO_DISENO'
             when q.estado = 'POR_ATENDER' then 'REVISION_STOCK'
             when q.estado = 'LISTO_EN_ALMACEN' then 'RECOJO_DEL_AREA'
             when g.rq is not null then 'YA_LLEGO_TODO'
             when t.etapa in ('EN_KARDEX', 'EN_STOCK') then 'COMPRA_CORTA'
             else coalesce(t.etapa, 'POR_COMPRAR')
           end as espera,
           case
             when coalesce(f.falta_sustento, false) then
               greatest(q.creado_en, (select max(s.decidido_en) from sustentos s where s.rq = q.id))
             when coalesce(f.espera_diseno, false) then
               coalesce((select max(s.sustentado_en) from sustentos s where s.rq = q.id and s.decidido_en is null), q.creado_en)
             when q.estado = 'POR_ATENDER' then
               greatest(q.creado_en, (select max(s.decidido_en) from sustentos s where s.rq = q.id))
             when q.estado = 'LISTO_EN_ALMACEN' then q.listo_en_almacen_en
             else coalesce(t.desde, g.desde,
                           (select max(v.creado_en) from vueltas v where v.rq = q.id),
                           case when q.estado = 'EN_ATENCION' then q.en_atencion_en end,
                           q.revision_stock_en, q.creado_en)
           end as desde,
           case when q.estado in ('SIN_STOCK', 'EN_ATENCION') and not coalesce(f.falta_sustento, false)
                     and not coalesce(f.espera_diseno, false) then t.oc end as detalle
      from rq q
      left join freno f on f.rq = q.id
      left join atrasado t on t.rq = q.id
      left join llego g on g.rq = q.id and q.estado in ('SIN_STOCK', 'EN_ATENCION')
     where q.abierto
  ),
  pasos as (
    -- 10 · Registro
    select q.id as rq, 10 as canon, 'REGISTRO' as paso, 'HECHO' as situacion, q.creado_por as quien, null::text as puesto_fijo,
           q.creado_en as en, null::text as espera, q.area as detalle
      from rq q
    union all
    -- 20 · Cada sustento de lo que se pasa del metrado
    select s.rq, 20, 'SUSTENTO', 'HECHO', s.sustentado_por, null, s.sustentado_en, null, null
      from (select distinct rq, sustentado_por, sustentado_en from sustentos) s
    union all
    -- 30 · Cada visto de Diseño, autorizado o no
    select s.rq, 30, 'VISTO_DISENO', 'HECHO', s.decidido_por, null, s.decidido_en, null, s.decision
      from (select distinct rq, decidido_por, decidido_en, decision from sustentos where decidido_en is not null) s
    union all
    -- 40 · Almacén revisó el stock
    select q.id, 40, 'REVISION_STOCK', 'HECHO', q.revision_stock_por, null, q.revision_stock_en, null, null
      from rq q where q.revision_stock_en is not null
    union all
    -- 50 · Quien compra lo tomó
    select q.id, 50, 'COMPRA', 'HECHO', q.en_atencion_por, null, q.en_atencion_en, null, null
      from rq q where q.en_atencion_en is not null
    union all
    -- 55 · Volvió a compra (de la bitácora)
    select v.rq, 55, 'VUELTA_A_COMPRA', 'HECHO', v.usuario_id, null, v.creado_en, null, null
      from vueltas v
    union all
    -- 60 · Listo en almacén
    select q.id, 60, 'LISTO', 'HECHO', q.listo_en_almacen_por, null, q.listo_en_almacen_en, null, null
      from rq q where q.listo_en_almacen_en is not null
    union all
    -- 70 · Entregado al área
    select q.id, 70, 'ENTREGA', 'HECHO', q.entregado_por, null, q.entregado_en, null,
           case when q.faltante_al_entregar is not null then 'CON_FALTANTE' end
      from rq q where q.entregado_en is not null
    union all
    -- 80 · Anulado
    select q.id, 80, 'ANULACION', 'HECHO', q.anulado_por, null, q.anulado_en, null, null
      from rq q where q.estado = 'ANULADO' and q.anulado_en is not null
    union all
    -- Lo que espera ahora
    select h.rq, case h.paso when 'SUSTENTO' then 20 when 'VISTO_DISENO' then 30 when 'REVISION_STOCK' then 40
                             when 'COMPRA' then 50 when 'LISTO' then 60 else 70 end,
           h.paso, 'AHORA', null, h.puesto, h.desde, h.espera, h.detalle
      from ahora h
    union all
    -- Lo que todavía no le toca a nadie, en el orden del circuito. La compra no
    -- se anuncia antes de la revisión: no se sabe si hará falta.
    select q.id, p.canon, p.paso, 'PENDIENTE', null, null, null, null, null
      from rq q
      join ahora h on h.rq = q.id
      cross join (values (40, 'REVISION_STOCK'), (60, 'LISTO'), (70, 'ENTREGA')) p(canon, paso)
     where p.canon > (case h.paso when 'SUSTENTO' then 20 when 'VISTO_DISENO' then 30 when 'REVISION_STOCK' then 40
                                  when 'COMPRA' then 50 when 'LISTO' then 60 else 70 end)
       and not (p.paso = 'REVISION_STOCK' and q.revision_stock_en is not null)
       and not (p.paso = 'LISTO' and q.listo_en_almacen_en is not null)
  )
  select p.rq,
         (row_number() over (
            partition by p.rq
            order by case p.situacion when 'HECHO' then 0 when 'AHORA' then 1 else 2 end,
                     case when p.situacion = 'HECHO' then p.en end, p.canon))::integer,
         p.paso, p.situacion,
         case when p.situacion = 'HECHO' then public.puesto(u) else p.puesto_fijo end,
         case when p.situacion = 'HECHO' then nullif(btrim(u.nombres || ' ' || u.apellidos), '') end,
         p.en,
         case when p.situacion = 'AHORA' then public.dias_en_espera(p.en) end,
         p.espera, p.detalle
    from pasos p
    left join public.usuarios u on u.id = p.quien;
end;
$$;

comment on function public.recorrido_de_requerimientos(uuid[]) is
  'El recorrido de cada requerimiento, un paso por fila: lo hecho con su puesto, nombre y fecha; quién lo tiene ahora y hace cuántos días (fecha de Lima); y lo que falta. Lo lee quien ve los requerimientos. Sin importes ni datos de RR. HH.';

revoke all on function public.recorrido_de_requerimientos(uuid[]) from public, anon;
grant execute on function public.recorrido_de_requerimientos(uuid[]) to authenticated;

-- =============================================================================
-- 3. EL RECORRIDO DE LA COTIZACIÓN
-- =============================================================================
-- Ventas la sube → Gerencia la revisa (y si la rechaza, Ventas sube la
-- corrección con el mismo número) → Administración le da el código interno y
-- sube la OT → Contabilidad la factura.
--
-- Quién la ve es lo que dice la política `ver_cotizaciones_pdf`, repetida aquí
-- fila por fila: la función corre por encima del RLS para leer la firma de la OT
-- y de la factura, que el vendedor no lee, así que el alcance lo pone ella. El
-- check 458 compara las dos con cada puesto: si la política cambia y esto no, falla.
--
-- La corrección no guarda quién la subió porque solo puede subirla quien
-- registró la cotización (`fn_cotizacion_pdf_revision`): es esa cuenta.
create or replace function public.recorrido_de_cotizaciones(p_ids uuid[])
returns table (
  documento uuid,
  orden     integer,
  paso      text,
  situacion text,
  puesto    text,
  nombre    text,
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
  v_admin     constant boolean := public.es_admin();
  v_comercial constant boolean := public.tiene_permiso('cotizaciones.ver_pdf_comercial');
  v_aprobadas constant boolean := public.tiene_permiso('cotizaciones.ver_aprobadas');
  v_tesoreria constant boolean := public.tiene_permiso('tesoreria.ver_documentos');
  -- El número de la OT lo lee quien lee las órdenes (`puede_ver_orden`); los demás ven el paso sin número.
  v_ordenes   constant boolean := public.es_admin() or public.tiene_permiso('ordenes.ver');
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
           c.archivo_subido_en, c.version, c.anulado_por, c.anulado_en
      from public.cotizaciones_pdf c
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
  -- La OT vigente que salió de ella.
  ot as (
    select distinct on (o.cotizacion_pdf_id) o.cotizacion_pdf_id as cot, o.numero, o.creado_por, o.creado_en
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
  pasos as (
    -- `canon` desempata lo que pasó a la misma hora: cada versión con su revisión
    -- y su corrección, en ese orden, antes que la OT y la factura.
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
    -- La revisión de la versión vigente
    select c.id, c.version * 10 + 20, 'REVISION', 'HECHO', c.revisado_por, null, c.revisado_en, null, c.estado
      from cot c where c.estado in ('APROBADA', 'RECHAZADA') and c.revisado_en is not null
    union all
    select c.id, c.version * 10 + 20, 'REVISION', 'AHORA', null, 'Gerencia', c.archivo_subido_en, 'REVISION', null
      from cot c where c.estado = 'POR_REVISAR'
    union all
    -- Rechazada: vuelve a quien la subió
    select c.id, c.version * 10 + 25, 'CORRECCION', 'AHORA', null, coalesce(public.puesto_de(c.registrado_por), 'Ventas'), c.revisado_en, 'CORRECCION', null
      from cot c where c.estado = 'RECHAZADA'
    union all
    -- Administración le dio el código interno y subió la OT
    select o.cot, 100000, 'CODIGO_Y_OT', 'HECHO', o.creado_por, null, o.creado_en, null, case when v_ordenes then 'OT ' || o.numero end
      from ot o
    union all
    select c.id, 100000, 'CODIGO_Y_OT', 'AHORA', null, 'Administración', c.revisado_en, 'CODIGO_Y_OT', null
      from cot c where c.estado = 'APROBADA' and not exists (select 1 from ot o where o.cot = c.id)
    union all
    select c.id, 100000, 'CODIGO_Y_OT', 'PENDIENTE', null, null, null, null, null
      from cot c where c.estado in ('POR_REVISAR', 'RECHAZADA') and not exists (select 1 from ot o where o.cot = c.id)
    union all
    -- Contabilidad la facturó
    select f.cot, 100010, 'FACTURA', 'HECHO', f.registrado_por, null, f.creado_en, null, null
      from factura f
    union all
    select c.id, 100010, 'FACTURA', 'AHORA', null, 'Contabilidad', o.creado_en, 'FACTURA', null
      from cot c join ot o on o.cot = c.id
     where c.estado = 'APROBADA' and not exists (select 1 from factura f where f.cot = c.id)
    union all
    select c.id, 100010, 'FACTURA', 'PENDIENTE', null, null, null, null, null
      from cot c
     where c.estado <> 'ANULADA' and not exists (select 1 from factura f where f.cot = c.id)
       and not (c.estado = 'APROBADA' and exists (select 1 from ot o where o.cot = c.id))
    union all
    -- Anulada
    select c.id, 100020, 'ANULACION', 'HECHO', c.anulado_por, null, c.anulado_en, null, null
      from cot c where c.estado = 'ANULADA' and c.anulado_en is not null
  )
  select p.cot,
         (row_number() over (
            partition by p.cot
            order by case p.situacion when 'HECHO' then 0 when 'AHORA' then 1 else 2 end,
                     case when p.situacion = 'HECHO' then p.en end, p.canon))::integer,
         p.paso, p.situacion,
         case when p.situacion = 'HECHO' then public.puesto(u) else p.puesto_fijo end,
         case when p.situacion = 'HECHO' then nullif(btrim(u.nombres || ' ' || u.apellidos), '') end,
         p.en,
         case when p.situacion = 'AHORA' then public.dias_en_espera(p.en) end,
         p.espera, p.detalle
    from pasos p
    left join public.usuarios u on u.id = p.quien
   -- La anulada no espera a nadie: queda lo hecho, como evidencia.
   where p.situacion = 'HECHO'
      or (select c.estado from cot c where c.id = p.cot) <> 'ANULADA';
end;
$$;

comment on function public.recorrido_de_cotizaciones(uuid[]) is
  'El recorrido de cada cotización, un paso por fila: lo hecho con su puesto, nombre y fecha; quién la tiene ahora y hace cuántos días (fecha de Lima); y lo que falta. Devuelve solo las que la política ver_cotizaciones_pdf deja ver a quien llama. Sin importes ni datos de RR. HH.';

revoke all on function public.recorrido_de_cotizaciones(uuid[]) from public, anon;
grant execute on function public.recorrido_de_cotizaciones(uuid[]) to authenticated;
