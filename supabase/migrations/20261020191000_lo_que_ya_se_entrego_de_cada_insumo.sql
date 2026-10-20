-- =============================================================================
-- LO QUE YA SE ENTREGÓ DE CADA INSUMO DEL REQUERIMIENTO
-- -----------------------------------------------------------------------------
-- DKS, el 2026-10-20, mirando la lista de Requerimientos con Maestranza: «que
-- maestranza pueda detectar que ya hay 10 de recojo en almacén, faltarían 5 de
-- logística». La lista decía en qué etapa iba cada insumo, pero no cuánto: el
-- supervisor no sabía si de los 15 que pidió ya podía ir a recoger 10, ni
-- cuántos de esos ya se llevó.
--
-- Lo que hay en almacén y lo que falta comprar ya sale de la revisión de
-- Almacén (`cantidad_en_stock` y `por_comprar` de `avance_de_requerimientos`).
-- Faltaba lo que ya salió del almacén para cada línea: las salidas con su
-- `requerimiento_linea_id`, menos lo que se devolvió de cada una. Es la misma
-- cuenta de `v_rq_lineas_para_salida`, pero salida por salida: dos devoluciones
-- de una misma salida no la cuentan dos veces.
--
-- La vista corre como quien la consulta, y Supervisión no lee los movimientos
-- del almacén (no tiene `almacen.ver`): por eso es una función aparte, con la
-- misma puerta que el avance (`puede_ver_requerimientos`), que devuelve solo la
-- cantidad entregada de cada línea, sin precio, sin quién recibió y sin foto.
-- Va aparte de `avance_de_requerimientos` para no redefinirla.
-- =============================================================================

create or replace function public.entregado_de_requerimientos(p_ids uuid[])
returns table (requerimiento_id uuid, item integer, entregado numeric)
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
  select l.requerimiento_id, l.item,
         coalesce((
           select sum(greatest(m.cantidad - coalesce((
                    select sum(d.cantidad) from public.movimientos_materiales d
                     where d.devolucion_de = m.id and d.tipo = 'INGRESO'), 0), 0))
             from public.movimientos_materiales m
            where m.requerimiento_linea_id = l.id and m.tipo = 'SALIDA'), 0)::numeric
    from public.requerimiento_lineas l
    join public.requerimientos r on r.id = l.requerimiento_id
   where r.id = any(p_ids) and r.estado <> 'ANULADO'
   order by l.requerimiento_id, l.item;
end;
$$;
comment on function public.entregado_de_requerimientos(uuid[]) is
  'Cuánto salió ya del almacén para cada insumo de los requerimientos pedidos (salidas menos sus devoluciones), sin precio ni quién recibió. Para quien ve los requerimientos.';
revoke all on function public.entregado_de_requerimientos(uuid[]) from public, anon;
grant execute on function public.entregado_de_requerimientos(uuid[]) to authenticated;
