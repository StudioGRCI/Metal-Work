-- =============================================================================
-- LO QUE YA SE ENTREGÓ DE CADA INSUMO DEL REQUERIMIENTO, Y LO QUE YA LLEGÓ DE SU COMPRA
-- -----------------------------------------------------------------------------
-- DKS, el 2026-10-20, mirando la lista de Requerimientos con Maestranza: «que
-- maestranza pueda detectar que ya hay 10 de recojo en almacén, faltarían 5 de
-- logística». La lista decía en qué etapa iba cada insumo, pero no cuánto: el
-- supervisor no sabía si de los 15 que pidió ya podía ir a recoger 10, ni
-- cuántos de esos ya se llevó.
--
-- Lo que Almacén tenía y lo que falta comprar ya sale de la revisión de Almacén
-- (`cantidad_en_stock` y `por_comprar` de `avance_de_requerimientos`). Faltaban
-- dos cifras:
--
--   · `entregado`: lo que ya salió del almacén para cada línea, las salidas con
--     su `requerimiento_linea_id` menos lo que se devolvió de cada una. Es la
--     misma cuenta de `v_rq_lineas_para_salida`, pero salida por salida: dos
--     devoluciones de una misma salida no la cuentan dos veces.
--   · `llegado`: de lo que se compró para la línea, cuánto entró ya al kardex.
--     La etapa de la OC no alcanza: si el proveedor trajo 3 de 5 y Almacén lo
--     validó con observación, la etapa dice «Observado» y la lista daba los 5
--     por faltantes; si la OC compró menos de lo que faltaba, al validarla daba
--     todo por llegado. Se cuenta lo que ingresó por la línea de la OC del
--     insumo. Cuando esa línea junta insumos de varios RQ (migración
--     20261016700000), lo ingresado se reparte en el orden en que se pidieron,
--     cada uno hasta lo que le faltaba. Es null en los insumos que no están
--     enlazados a una línea de OC (los de antes de esa migración): ahí la
--     pantalla sigue con la etapa.
--
-- La vista corre como quien la consulta, y Supervisión no lee los movimientos
-- del almacén (no tiene `almacen.ver`): por eso es una función aparte, con la
-- misma puerta que el avance (`puede_ver_requerimientos`), que devuelve solo
-- cantidades, sin precio, sin proveedor, sin quién recibió y sin foto. Va
-- aparte de `avance_de_requerimientos` para no redefinirla.
-- =============================================================================

create or replace function public.entregado_de_requerimientos(p_ids uuid[])
returns table (requerimiento_id uuid, item integer, entregado numeric, llegado numeric)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  if not public.puede_ver_requerimientos() then
    raise exception 'No tienes permiso para ver los requerimientos.' using errcode = 'insufficient_privilege';
  end if;
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
  -- Todos los insumos que comparten la línea de OC, también los de RQ que no se
  -- pidieron aquí: lo que ingresó se reparte entre ellos en el orden en que se pidieron.
  compartidas as (
    select l.id,
           greatest(l.cantidad - coalesce(l.cantidad_en_stock, 0), 0) as falta,
           coalesce(sum(greatest(l.cantidad - coalesce(l.cantidad_en_stock, 0), 0)) over (
             partition by l.orden_compra_detalle_id order by r.creado_en, r.numero, l.item
             rows between unbounded preceding and 1 preceding), 0) as antes,
           l.orden_compra_detalle_id as detalle
      from public.requerimiento_lineas l
      join public.requerimientos r on r.id = l.requerimiento_id
     where l.orden_compra_detalle_id in (select p.detalle from pedidas p where p.detalle is not null)
       and r.estado <> 'ANULADO'
  ),
  ingresado as (
    select m.orden_compra_detalle_id as detalle, sum(m.cantidad) as cantidad
      from public.movimientos_materiales m
     where m.tipo = 'INGRESO' and m.devolucion_de is null
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
         case when p.detalle is not null then
           least(c.falta, greatest(coalesce(i.cantidad, 0) - c.antes, 0))::numeric
         end
    from pedidas p
    left join compartidas c on c.id = p.id
    left join ingresado i on i.detalle = p.detalle
   order by p.requerimiento_id, p.item;
end;
$$;
comment on function public.entregado_de_requerimientos(uuid[]) is
  'Cuánto salió ya del almacén para cada insumo de los requerimientos pedidos (salidas menos sus devoluciones) y cuánto de lo que se le compró entró ya al kardex (null si no está enlazado a una línea de OC), sin precio ni quién recibió. Para quien ve los requerimientos.';
revoke all on function public.entregado_de_requerimientos(uuid[]) from public, anon;
grant execute on function public.entregado_de_requerimientos(uuid[]) to authenticated;
