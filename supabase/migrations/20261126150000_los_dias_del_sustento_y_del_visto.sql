-- =============================================================================
-- LOS DÍAS DEL SUSTENTO Y DEL VISTO DE DISEÑO
-- -----------------------------------------------------------------------------
-- El recorrido del RQ (20261125130000) contaba mal los días en dos casos del
-- metrado de Diseño. Los vio el hilo de Diseño (plan 6):
--
--   1. Falta el sustento de un insumo y Diseño autoriza otro: los días del que
--      sigue sin sustento volvían a cero, porque se contaban desde cualquier
--      visto de Diseño. Ahora, solo desde un visto que no lo autorizó: ese sí
--      vuelve a pedir el sustento.
--   2. Diseño tiene dos sustentos y llega un tercero: los días volvían a cero,
--      porque se contaban desde el más nuevo. Ahora, desde el más antiguo que
--      todavía no ve.
--
-- Lo demás de la función queda igual. La bandeja de atención y la tarjeta del
-- RQ toman los días de aquí, así que se arreglan solas.
-- =============================================================================

do $$
begin
  if to_regprocedure('public.recorrido_de_requerimientos(uuid[])') is null then
    raise exception 'Aplica antes la migración 20261125130000 (el recorrido de cada documento).';
  end if;
end $$;

create or replace function public.recorrido_de_requerimientos(p_ids uuid[])
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
    select r.id, r.tipo, r.estado, r.creado_por, r.creado_en, r.codigo_desde,
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
    select l.requerimiento_id as rq, l.item, s.sustentado_por, s.sustentado_en, s.decidido_por, s.decidido_en, s.decision
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
    -- La OC aprobada que Logística todavía no programó con el conductor es de
    -- Logística (`POR_PROGRAMAR`): el conductor no la ve en sus recojos hasta
    -- que está en su lista, con posición, en `programacion_recojo`. La que
    -- Logística sacó de la lista (`quitar_recojo_de_la_lista` deja la fila sin
    -- posición) vuelve a ser de Logística. Con varias OC en el mismo punto, la
    -- que falta programar va primero: mientras quede una, el RQ es de Logística
    -- aunque el conductor ya tenga otra. Igual lo observado antes que lo que
    -- Almacén tiene por validar.
    select distinct on (i.rq) i.rq,
           case when i.etapa = 'PENDIENTE_RECOJO' and pr.programado_en is null then 'POR_PROGRAMAR' else i.etapa end as etapa,
           case when c.id is not null then public.nombre_de_oc(c.numero, c.referencia) end as oc,
           case i.etapa
             when 'POR_COMPRAR' then case c.aprobacion when 'RECHAZADA' then c.rechazado_en when 'ANULADA' then c.anulada_en end
             when 'OC_POR_APROBAR' then coalesce(c.aprobacion_pedida_en, c.creado_en)
             when 'PENDIENTE_RECOJO' then coalesce(pr.programado_en, c.recojo_pedido_en, c.aprobado_en, c.creado_en)
             when 'EN_RECOJO' then c.en_recojo_en
             when 'RECOGIDO' then c.recogido_en
             when 'EN_STOCK' then null
             -- Lo observado lo tiene quien compra desde que Almacén lo observó, no desde que se dejó.
             when 'OBSERVADO' then coalesce(
               (select max(ip.validado_en) from public.ingresos_pendientes_almacen ip
                 where ip.orden_compra_id = c.id and ip.estado = 'OBSERVADO'),
               c.dejado_en, c.entregado_almacen_en)
             else coalesce(c.dejado_en, c.entregado_almacen_en)
           end as desde
      from insumos i
      left join public.ordenes_compra_materiales c on c.id = i.orden_compra_id
      left join lateral (select max(p.programado_en) as programado_en from public.programacion_recojo p
                          where p.orden_compra_id = c.id and p.posicion is not null) pr on true
     where i.por_llegar > 0
     order by i.rq, i.porcentaje,
              (i.etapa = 'PENDIENTE_RECOJO' and pr.programado_en is not null),
              -- Al mismo punto (80 %), lo observado antes que lo que Almacén tiene por validar, como la tarjeta.
              (i.etapa is distinct from 'OBSERVADO'),
              i.item
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
  -- firma de «listo»). La bitácora guarda cuándo, desde qué cuenta, y la firma
  -- del «listo» que se borró.
  vueltas as (
    select b.registro_id as rq, b.usuario_id, b.creado_en,
           nullif(b.datos_antes ->> 'listo_en_almacen_por', '')::uuid as listo_por,
           nullif(b.datos_antes ->> 'listo_en_almacen_en', '')::timestamptz as listo_en
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
             -- Programar el recojo es solo de Logística (compras.programar_recojo), también el de un RQA.
             when t.etapa = 'POR_PROGRAMAR' then 'Logística'
             when t.etapa in ('PENDIENTE_RECOJO', 'EN_RECOJO', 'RECOGIDO') then 'Conductor de Logística'
             when t.etapa = 'POR_VALIDAR' then 'Almacén'
             -- Lo observado (no llegó completo) lo trae quien compra, como dice la tarjeta.
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
             -- El sustento falta desde lo último que lo pidió: el registro, el código o
             -- una cantidad corregidos, o un visto de Diseño que no lo autorizó. Solo el
             -- que no lo autorizó: autorizar otro insumo no vuelve a pedir nada
             -- (20261126150000).
             when coalesce(f.falta_sustento, false) then
               greatest(q.creado_en, q.codigo_desde,
                        (select max(l.cantidad_desde) from public.requerimiento_lineas l where l.requerimiento_id = q.id),
                        (select max(s.decidido_en) from sustentos s where s.rq = q.id and s.decision = 'RECHAZADO'))
             -- Diseño lo tiene desde el sustento más antiguo que todavía no ve: uno
             -- nuevo no le quita los días al que ya esperaba (20261126150000).
             when coalesce(f.espera_diseno, false) then
               coalesce((select min(s.sustentado_en) from sustentos s where s.rq = q.id and s.decidido_en is null), q.creado_en)
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
    -- 20 · Cada sustento de lo que se pasa del metrado, con los insumos que
    -- sustentó en ese momento (detalle: «1,2»). Lo de un mismo minuto es un envío.
    select s.rq, 20, 'SUSTENTO', 'HECHO', s.sustentado_por, null, min(s.sustentado_en), null,
           string_agg(distinct s.item::text, ',')
      from sustentos s
     group by s.rq, s.sustentado_por, date_trunc('minute', s.sustentado_en)
    union all
    -- 30 · Cada visto de Diseño, autorizado o no, con sus insumos (detalle:
    -- «AUTORIZADO:1,2»): dos vistos del mismo minuto sobre insumos distintos no
    -- se leen como si el RQ se hubiera autorizado y rechazado a la vez.
    select s.rq, 30, 'VISTO_DISENO', 'HECHO', s.decidido_por, null, min(s.decidido_en), null,
           s.decision || ':' || string_agg(distinct s.item::text, ',')
      from sustentos s
     where s.decidido_en is not null
     group by s.rq, s.decidido_por, s.decision, date_trunc('minute', s.decidido_en)
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
    -- 60 · Listo en almacén; y el de antes de cada vuelta a compra, que la vuelta borró (de la bitácora)
    select q.id, 60, 'LISTO', 'HECHO', q.listo_en_almacen_por, null, q.listo_en_almacen_en, null, null
      from rq q where q.listo_en_almacen_en is not null
    union all
    select v.rq, 60, 'LISTO', 'HECHO', v.listo_por, null, v.listo_en, null, null
      from vueltas v where v.listo_en is not null
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
         p.en,
         case when p.situacion = 'AHORA' then public.dias_en_espera(p.en) end,
         p.espera, p.detalle
    from pasos p
    left join public.usuarios u on u.id = p.quien;
end;
$$;

comment on function public.recorrido_de_requerimientos(uuid[]) is
  'El recorrido de cada requerimiento, un paso por fila: lo hecho con el puesto de quien lo hizo y su fecha; quién lo tiene ahora y hace cuántos días (fecha de Lima); y lo que falta. Lo lee quien ve los requerimientos. En compra, el detalle lleva la OC del insumo más atrasado ya nombrada con nombre_de_oc(numero, referencia). Sin importes ni datos de RR. HH.';

revoke all on function public.recorrido_de_requerimientos(uuid[]) from public, anon;
grant execute on function public.recorrido_de_requerimientos(uuid[]) to authenticated;
