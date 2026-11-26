-- =============================================================================
-- LAS FUNCIONES DEL RQ QUE RECIBEN IDS MIRAN EL ÁREA
-- -----------------------------------------------------------------------------
-- Plan «Las demás áreas», entrega A.3 (Mantenimiento de unidades), segunda
-- parte de la 20261126996000. Aquella dejó que quien tiene `requerimientos.area`
-- y nada más —hoy, solo Mantenimiento— lea de las tablas los RQ de su área. Pero
-- las funciones que dan el avance, lo entregado, el metrado, el recorrido y las
-- salidas de los RQ que se les pasan, y las dos que dan la foto de una salida,
-- seguían contestando por el id a cualquiera que trabaja con RQ. Y Mantenimiento
-- recibe ids de RQ de otras áreas en la ventana «Enlazar RQ» de una avería. El
-- auditor de funcionamiento lo recorrió de punta a punta: con esos ids, por la
-- API, salían el material, quién lo recibió, el N.º de la OC y hasta la foto de
-- la salida de otra área. No es lo que pidió DKS: «cada puesto ve y registra
-- solo lo suyo».
--
-- Qué cambia: las cinco funciones filtran la lista que reciben con
-- `rq_que_leo()` apenas pasan su permiso, y las dos de la foto preguntan
-- `leo_el_rq_de_la_linea()`. Para quien lee todos los RQ (Requerimientos,
-- Administración, Logística, Almacén, Gerencia, Diseño, los supervisores) las
-- dos devuelven lo mismo que entra: no les cambia nada.
--
-- Las cinco funciones son COPIA EXACTA de las que tiene la base (sacadas con
-- `pg_get_functiondef`, por eso van con su formato) más UNA línea cada una, la
-- que sigue a la guarda del permiso. No se reescribieron a mano.
--
-- Lo que sigue igual, a propósito: `averias_rq_para_enlazar()` le lista a
-- Mantenimiento los RQ vivos de todas las áreas para enlazarlos a una avería
-- (20261126950000, plan de Mantenimiento de equipos).
--
-- Sin DROP. Idempotente.
-- =============================================================================

-- 0. Las funciones que se reescriben son las que el repositorio conoce -----------------------
-- Valen la huella de antes y la de esta migración (volver a correrla).
do $$
declare
  v record;
begin
  if to_regprocedure('public.area_de_mis_requerimientos()') is null
     or to_regprocedure('public.puede_ver_todos_los_requerimientos()') is null then
    raise exception 'Falta la 20261126996000 (Mantenimiento de unidades): se aplica antes que esta.';
  end if;
  for v in
    select f.firma, f.huellas, md5(replace(p.prosrc, E'\r', '')) as huella
      from (values
        ('public.avance_de_requerimientos(uuid[])',          array['fb5259c90c1abe1372f0159664445ce5', '03e1446b2fb178c6bd4516a571d20ce1']),
        ('public.entregado_de_requerimientos(uuid[])',       array['e86997bda15e47c9caac77a375b0b122', '26fdbeaa461e7041341f0bfb02f1b39a']),
        ('public.metrado_de_requerimientos(uuid[])',         array['8dfbaebb7e9f66e80f3d58906e25bc33', '4808cc21e7b3bd2bf03194533a0baccf']),
        ('public.recorrido_de_requerimientos(uuid[])',       array['f320678f00131d86766bbbb60cda222f', '48f71e4188ae7798592004ab58e2dadf']),
        ('public.salidas_de_requerimientos(uuid[])',         array['3297801f36210aac8ff71219306fb2b6', 'b886b507ea7b6fd795a82fbca021662f']),
        ('public.es_foto_de_salida_de_requerimiento(text)',  array['de2add48065b25c9e76ea505e996d5eb', '406bac29865fdca716b956c43bb56310']),
        ('public.foto_de_salida_de_requerimiento(uuid)',     array['0a870ab5b0719d3dc028c24fe164920a', '4abdf4fb9d199b6228c00c83c23ebe39'])
      ) as f(firma, huellas)
      left join pg_proc p on p.oid = to_regprocedure(f.firma)
  loop
    if v.huella is null then
      raise exception 'Falta %: esta base no tiene los requerimientos al día.', v.firma;
    end if;
    if not (v.huella = any (v.huellas)) then
      raise exception '% no es la que conoce el repositorio (se cambió a mano, huella %): no se reemplaza. Avisa antes de seguir.', v.firma, v.huella;
    end if;
  end loop;
end $$;

-- 1. Qué RQ lee quien pregunta ------------------------------------------------------------
-- Quien tiene `requerimientos.area` y ningún permiso que dé todos lee solo los
-- de su área. A los demás no se les filtra nada: cada función ya les exigió su
-- permiso. Hoy el único puesto así es Mantenimiento. Si algún día un puesto
-- juntara `requerimientos.area` con `requerimientos.autorizar_metrado` y nada
-- más, el metrado se le filtraría por área aunque la tabla de sustentos se los
-- deje leer todos: hoy ningún rol combina esos dos permisos.
create or replace function public.solo_leo_los_rq_de_mi_area()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.tiene_permiso('requerimientos.area') and not public.puede_ver_todos_los_requerimientos();
$$;
revoke all on function public.solo_leo_los_rq_de_mi_area() from public, anon;
grant execute on function public.solo_leo_los_rq_de_mi_area() to authenticated;
comment on function public.solo_leo_los_rq_de_mi_area() is
  'Si quien pregunta lee los RQ solo de su área: tiene requerimientos.area y ningún permiso que dé los de todas.';

create or replace function public.rq_que_leo(p_ids uuid[])
returns uuid[] language sql stable security definer set search_path to 'public' as $$
  select case
           when p_ids is null or not public.solo_leo_los_rq_de_mi_area() then p_ids
           else array(select r.id from public.requerimientos r
                       where r.id = any(p_ids) and r.area_id = public.area_de_mis_requerimientos())
         end;
$$;
revoke all on function public.rq_que_leo(uuid[]) from public, anon;
grant execute on function public.rq_que_leo(uuid[]) to authenticated;
comment on function public.rq_que_leo(uuid[]) is
  'De una lista de RQ, los que puede leer quien pregunta: todos, o solo los de su área si lee solo esos. Para las funciones que reciben ids.';

create or replace function public.leo_el_rq_de_la_linea(p_linea uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select not public.solo_leo_los_rq_de_mi_area()
      or exists (select 1 from public.requerimiento_lineas l
                   join public.requerimientos r on r.id = l.requerimiento_id
                  where l.id = p_linea and r.area_id = public.area_de_mis_requerimientos());
$$;
revoke all on function public.leo_el_rq_de_la_linea(uuid) from public, anon;
grant execute on function public.leo_el_rq_de_la_linea(uuid) to authenticated;
comment on function public.leo_el_rq_de_la_linea(uuid) is
  'Si quien pregunta puede leer el RQ de ese insumo: siempre, salvo que lea solo los de su área y el RQ sea de otra.';

-- 2. La foto de una salida ---------------------------------------------------------------
-- Las dos de la 20261126521000 con el RQ de la salida de por medio: la de la
-- política de Storage y la que usa la ruta `/requerimientos/salidas/<id>/foto`.
create or replace function public.es_foto_de_salida_de_requerimiento(p_nombre text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.puede_ver_requerimientos()
     and exists (select 1 from public.movimientos_materiales m
                  where m.foto_ruta = p_nombre and m.tipo = 'SALIDA' and m.requerimiento_linea_id is not null
                    and public.leo_el_rq_de_la_linea(m.requerimiento_linea_id));
$$;

create or replace function public.foto_de_salida_de_requerimiento(p_movimiento uuid)
returns text language sql stable security definer set search_path to 'public' as $$
  select m.foto_ruta from public.movimientos_materiales m
   where m.id = p_movimiento and m.tipo = 'SALIDA' and m.requerimiento_linea_id is not null
     and public.puede_ver_requerimientos()
     and public.leo_el_rq_de_la_linea(m.requerimiento_linea_id);
$$;

-- 3. Las cinco que reciben ids ---------------------------------------------------------------
-- Copia de la base más la línea `… := public.rq_que_leo(…);`. Sus permisos de
-- ejecución no cambian: `create or replace` los conserva.
CREATE OR REPLACE FUNCTION public.avance_de_requerimientos(p_ids uuid[])
 RETURNS TABLE(requerimiento_id uuid, porcentaje integer, etapa text, lineas jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
#variable_conflict use_column
begin
  if not public.puede_ver_requerimientos() then
    raise exception 'No tienes permiso para ver los requerimientos.' using errcode = 'insufficient_privilege';
  end if;
  -- Quien lee solo los RQ de su área recibe solo los de su área (20261126996500).
  p_ids := public.rq_que_leo(p_ids);
  if p_ids is null or cardinality(p_ids) = 0 then
    return;
  end if;
  if cardinality(p_ids) > 500 then
    raise exception 'Pide el avance de hasta 500 requerimientos a la vez.' using errcode = 'check_violation';
  end if;

  return query
  with etapas (codigo, pct, orden) as (
    values ('POR_REVISAR', 10, 1), ('POR_COMPRAR', 20, 2), ('OC_POR_APROBAR', 30, 3),
           ('PENDIENTE_RECOJO', 45, 4), ('EN_RECOJO', 60, 5), ('RECOGIDO', 70, 6),
           ('OBSERVADO', 80, 7), ('POR_VALIDAR', 80, 8), ('POR_REPONER', 80, 8), ('EN_KARDEX', 85, 9), ('EN_STOCK', 85, 9),
           ('LISTO_EN_ALMACEN', 90, 10), ('ENTREGADO', 100, 11)
  ),
  validacion as (
    select i.orden_compra_id as compra,
           case when bool_or(i.estado = 'PENDIENTE') then 'PENDIENTE'
                when bool_or(i.estado = 'OBSERVADO') then 'OBSERVADO'
                else 'VALIDADO' end as estado
      from public.ingresos_pendientes_almacen i
     where i.orden_compra_id in (select rl.orden_compra_id from public.requerimiento_lineas rl
                                  where rl.requerimiento_id = any(p_ids) and rl.orden_compra_id is not null)
     group by i.orden_compra_id
  ),
  llegado as (
    select e.requerimiento_id, e.item, e.llegado from public.entregado_de_requerimientos(p_ids) e
  ),
  por_linea as (
    select r.id as rq, l.item as item,
           case when c.id is not null then public.nombre_de_oc(c.numero, c.referencia) end as compra,
           coalesce(c.aprobacion in ('RECHAZADA', 'ANULADA'), false) as rechazada,
           coalesce(c.aprobacion = 'ANULADA', false) as anulada,
           l.cantidad_en_stock as en_stock,
           case when l.cantidad_en_stock is not null then greatest(l.cantidad - l.cantidad_en_stock, 0) end as por_comprar,
           case
             when r.estado = 'ENTREGADO' then 'ENTREGADO'
             when r.estado = 'LISTO_EN_ALMACEN' then 'LISTO_EN_ALMACEN'
             when r.estado = 'POR_ATENDER' then 'POR_REVISAR'
             when l.cantidad_en_stock is not null and l.cantidad_en_stock >= l.cantidad then 'EN_STOCK'
             when c.id is null or c.aprobacion in ('RECHAZADA', 'ANULADA') then 'POR_COMPRAR'
             when c.aprobacion = 'POR_APROBAR' then 'OC_POR_APROBAR'
             -- Almacén devolvió parte y el proveedor la repone: al insumo todavía le falta (migración 20261022185000).
             when (c.recojo = 'DEJADO' or (c.recojo is null and c.entregado_almacen_en is not null)) and v.estado = 'VALIDADO'
                  and l.orden_compra_detalle_id is not null
                  and (select k.por_reponer from public.cuenta_de_la_linea_de_compra(l.orden_compra_detalle_id) k) > 0
                  and coalesce(ll.llegado, 0) < coalesce(greatest(l.cantidad - l.cantidad_en_stock, 0), l.cantidad) then 'POR_REPONER'
             when c.recojo = 'DEJADO' or (c.recojo is null and c.entregado_almacen_en is not null) then
               case v.estado when 'VALIDADO' then 'EN_KARDEX' when 'OBSERVADO' then 'OBSERVADO' else 'POR_VALIDAR' end
             when c.recojo = 'RECOGIDO' then 'RECOGIDO'
             when c.recojo = 'EN_RECOJO' then 'EN_RECOJO'
             else 'PENDIENTE_RECOJO'
           end as paso,
           case
             when r.estado in ('ENTREGADO', 'LISTO_EN_ALMACEN', 'POR_ATENDER') or c.aprobacion in ('RECHAZADA', 'ANULADA') then null
             when l.cantidad_en_stock is not null and l.cantidad_en_stock >= l.cantidad then l.stock_revisado_en
             when c.recojo = 'DEJADO' then c.dejado_en
             when c.recojo = 'RECOGIDO' then c.recogido_en
             when c.recojo = 'EN_RECOJO' then c.en_recojo_en
             when c.recojo = 'POR_RECOGER' then c.recojo_pedido_en
           end as desde
      from public.requerimientos r
      join public.requerimiento_lineas l on l.requerimiento_id = r.id
      left join public.ordenes_compra_materiales c on c.id = l.orden_compra_id
      left join validacion v on v.compra = c.id
      left join llegado ll on ll.requerimiento_id = r.id and ll.item = l.item
     where r.id = any(p_ids) and r.estado <> 'ANULADO'
  )
  select p.rq,
         round(avg(e.pct))::integer,
         (array_agg(p.paso order by e.orden, p.item))[1],
         jsonb_agg(jsonb_build_object('item', p.item, 'orden_compra', p.compra, 'rechazada', p.rechazada, 'anulada', p.anulada,
                                      'etapa', p.paso, 'porcentaje', e.pct, 'desde', p.desde,
                                      'en_stock', p.en_stock, 'por_comprar', p.por_comprar) order by p.item)
    from por_linea p
    join etapas e on e.codigo = p.paso
   group by p.rq;
end;
$$;

CREATE OR REPLACE FUNCTION public.entregado_de_requerimientos(p_ids uuid[])
 RETURNS TABLE(requerimiento_id uuid, item integer, entregado numeric, llegado numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
#variable_conflict use_column
begin
  if not public.puede_ver_requerimientos() then
    raise exception 'No tienes permiso para ver los requerimientos.' using errcode = 'insufficient_privilege';
  end if;
  -- Quien lee solo los RQ de su área recibe solo los de su área (20261126996500).
  p_ids := public.rq_que_leo(p_ids);
  if p_ids is null or cardinality(p_ids) = 0 then
    return;
  end if;
  if cardinality(p_ids) > 500 then
    raise exception 'Pide lo entregado de hasta 500 requerimientos a la vez.' using errcode = 'check_violation';
  end if;

  return query
  with pedidas as (
    select l.id, l.requerimiento_id, l.item, l.orden_compra_detalle_id as detalle
      from public.requerimiento_lineas l
      join public.requerimientos r on r.id = l.requerimiento_id
     where r.id = any(p_ids) and r.estado <> 'ANULADO'
  ),
  ingresado as (
    select m.orden_compra_detalle_id as detalle,
           sum(case when m.tipo = 'INGRESO' then m.cantidad::numeric else -m.cantidad::numeric end) as cantidad
      from public.movimientos_materiales m
     where m.tipo in ('INGRESO', 'DEVOLUCION_PROVEEDOR') and m.devolucion_de is null
       and m.orden_compra_detalle_id in (select p.detalle from pedidas p where p.detalle is not null)
     group by m.orden_compra_detalle_id
  )
  select p.requerimiento_id, p.item::integer,
         coalesce((
           select sum(greatest(m.cantidad - coalesce((
                    select sum(d.cantidad) from public.movimientos_materiales d
                     where d.devolucion_de = m.id and d.tipo = 'INGRESO'), 0), 0))
             from public.movimientos_materiales m
            where m.requerimiento_linea_id = p.id and m.tipo = 'SALIDA'), 0)::numeric,
         -- Lo que ingresó se reparte entre todos los insumos de la línea de OC, también
         -- los de RQ que no se pidieron aquí: primero lo que ya se le entregó a cada uno.
         case when p.detalle is not null then
           (select x.llegado from public.llegado_de_la_linea_de_compra(p.detalle, coalesce(i.cantidad, 0)) x where x.linea_id = p.id)
         end
    from pedidas p
    left join ingresado i on i.detalle = p.detalle
   order by p.requerimiento_id, p.item;
end;
$$;

CREATE OR REPLACE FUNCTION public.metrado_de_requerimientos(p_requerimientos uuid[])
 RETURNS TABLE(linea_id uuid, requerimiento_id uuid, item smallint, estado text, metrado numeric, pedido_antes numeric, exceso numeric, planos text, sustento text, sustentado_por text, sustentado_en timestamp with time zone, decision text, nota_decision text, decidido_por text, decidido_en timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
#variable_conflict use_column
begin
  if not (public.puede_ver_requerimientos() or public.tiene_permiso('requerimientos.autorizar_metrado')) then
    raise exception 'No tienes permiso para ver los requerimientos.' using errcode = 'insufficient_privilege';
  end if;
  -- Quien lee solo los RQ de su área recibe solo los de su área (20261126996500).
  p_requerimientos := public.rq_que_leo(p_requerimientos);
  return query
  select m.linea_id, m.requerimiento_id, m.item, m.estado, m.metrado, m.pedido_antes, m.exceso,
         (select string_agg(distinct p.numero || coalesce(' R' || (select max(v.revision) from public.codigo_plano_revisiones v
                                                                     where v.plano_id = p.id), ''), ', ')
            from public.codigo_materiales c
            join public.codigo_planos p on p.id = c.plano_id and p.anulado_en is null
            join public.requerimiento_lineas l on l.id = m.linea_id
            join public.requerimientos r on r.id = l.requerimiento_id
           where c.quitado_en is null and c.material_id = l.material_id
             and c.codigo_interno = public.normalizar_codigo_interno(r.codigo_interno)),
         s.sustento, nullif(btrim(concat_ws(' ', us.nombres, us.apellidos)), ''), s.sustentado_en,
         s.decision, s.nota_decision, nullif(btrim(concat_ws(' ', ud.nombres, ud.apellidos)), ''), s.decidido_en
    from public.metrado_por_linea(p_requerimientos) m
    left join public.requerimiento_sustentos s on s.id = m.sustento_id
    left join public.usuarios us on us.id = s.sustentado_por
    left join public.usuarios ud on ud.id = s.decidido_por
   order by m.requerimiento_id, m.item;
end;
$$;

CREATE OR REPLACE FUNCTION public.recorrido_de_requerimientos(p_ids uuid[])
 RETURNS TABLE(documento uuid, orden integer, paso text, situacion text, puesto text, en timestamp with time zone, dias integer, espera text, detalle text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
#variable_conflict use_column
begin
  if not public.puede_ver_requerimientos() then
    raise exception 'No tienes permiso para ver los requerimientos.' using errcode = 'insufficient_privilege';
  end if;
  -- Quien lee solo los RQ de su área recibe solo los de su área (20261126996500).
  p_ids := public.rq_que_leo(p_ids);
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
  -- Y desde cuándo, insumo por insumo: lo que le pasa a uno no les cambia los
  -- días a los demás (20261126160000). El que falta sustentar espera desde lo
  -- último que se lo pidió a él: el registro, el código del RQ, su cantidad
  -- corregida o el último visto de Diseño sobre él. Si su último sustento quedó
  -- sin visto porque la cantidad bajó y se sigue pasando, desde ese sustento: la
  -- hora de la baja no se guarda, así que es lo más cerca que se sabe. El que
  -- tiene Diseño, desde que se sustentó. El RQ, desde el que más espera.
  freno as (
    select m.requerimiento_id as rq,
           bool_or(m.estado in ('SIN_SUSTENTO', 'RECHAZADO')) as falta_sustento,
           bool_or(m.estado = 'POR_AUTORIZAR') as espera_diseno,
           min(greatest(r.creado_en, r.codigo_desde, l.cantidad_desde, s.sustentado_en, s.decidido_en))
             filter (where m.estado in ('SIN_SUSTENTO', 'RECHAZADO')) as sustento_desde,
           min(s.sustentado_en) filter (where m.estado = 'POR_AUTORIZAR') as diseno_desde
      from public.metrado_por_linea(p_ids) m
      join public.requerimiento_lineas l on l.id = m.linea_id
      join public.requerimientos r on r.id = m.requerimiento_id
      left join public.requerimiento_sustentos s on s.id = m.sustento_id
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
  -- Lo que a cada RQ listo le falta sacar del kardex, con la cuenta de la
  -- bandeja (`v_rq_lineas_para_salida`), y su última salida (20261126170000).
  salidas as (
    select v.requerimiento_id as rq,
           bool_or(v.pendiente > 0) as falta_sacar,
           (select max(m.registrado_en)
              from public.movimientos_materiales m
              join public.requerimiento_lineas l on l.id = m.requerimiento_linea_id
             where l.requerimiento_id = v.requerimiento_id and m.tipo = 'SALIDA') as ultima_salida
      from public.v_rq_lineas_para_salida v
     where v.requerimiento_id = any(p_ids) and v.estado = 'LISTO_EN_ALMACEN'
     group by v.requerimiento_id
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
             -- Ya salió todo del kardex: falta que Almacén lo marque entregado.
             when q.estado = 'LISTO_EN_ALMACEN' and not coalesce(x.falta_sacar, true) then 'Almacén'
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
             when q.estado = 'LISTO_EN_ALMACEN' and not coalesce(x.falta_sacar, true) then 'POR_ENTREGAR'
             when q.estado = 'LISTO_EN_ALMACEN' then 'RECOJO_DEL_AREA'
             when g.rq is not null then 'YA_LLEGO_TODO'
             when t.etapa in ('EN_KARDEX', 'EN_STOCK') then 'COMPRA_CORTA'
             else coalesce(t.etapa, 'POR_COMPRAR')
           end as espera,
           case
             -- Desde el insumo que más espera, contado en `freno`.
             when coalesce(f.falta_sustento, false) then coalesce(f.sustento_desde, q.creado_en)
             when coalesce(f.espera_diseno, false) then coalesce(f.diseno_desde, q.creado_en)
             -- Almacén lo tiene desde el registro o desde el último visto de Diseño. Si
             -- lo soltó otra cosa (una cantidad corregida, el metrado ampliado), cuenta
             -- desde antes: el metrado no guarda la hora de su cambio.
             when q.estado = 'POR_ATENDER' then
               greatest(q.creado_en, (select max(s.decidido_en) from sustentos s where s.rq = q.id))
             when q.estado = 'LISTO_EN_ALMACEN' and not coalesce(x.falta_sacar, true) then
               greatest(q.listo_en_almacen_en, x.ultima_salida)
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
      left join salidas x on x.rq = q.id
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

CREATE OR REPLACE FUNCTION public.salidas_de_requerimientos(p_ids uuid[])
 RETURNS TABLE(movimiento_id uuid, requerimiento_id uuid, requerimiento_linea_id uuid, item smallint, cantidad numeric, unidad text, material text, numero_salida text, salio_en timestamp with time zone, recibido_por text, con_foto boolean, puede_anotar boolean, nota_abierta uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
begin
  if not public.puede_ver_requerimientos() then
    raise exception 'No tienes permiso para ver los requerimientos.' using errcode = 'insufficient_privilege';
  end if;
  -- Quien lee solo los RQ de su área recibe solo los de su área (20261126996500).
  p_ids := public.rq_que_leo(p_ids);
  return query
    select m.id, r.id, l.id, l.item, m.cantidad::numeric, um.codigo::text, mat.descripcion::text, m.numero_salida,
           m.registrado_en, m.recibido_por_nombre, m.foto_ruta is not null,
           public.puede_anotar_conformidad(r),
           (select c.id from public.conformidad_salidas c where c.movimiento_id = m.id and c.atendido_en is null)
      from public.movimientos_materiales m
      join public.requerimiento_lineas l on l.id = m.requerimiento_linea_id
      join public.requerimientos r on r.id = l.requerimiento_id
      left join public.materiales mat on mat.id = m.material_id
      left join public.unidades_medida um on um.id = mat.unidad_medida_id
     where m.tipo = 'SALIDA'
       and r.id = any(coalesce(p_ids, '{}'))
     order by r.id, l.item, m.registrado_en, m.id;
end;
$$;
