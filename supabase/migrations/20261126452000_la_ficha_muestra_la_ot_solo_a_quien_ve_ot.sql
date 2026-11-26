-- =============================================================================
-- LA FICHA DEL CLIENTE MUESTRA LA OT SOLO A QUIEN VE OT O COTIZACIONES
-- -----------------------------------------------------------------------------
-- La 20261126451000 (Plan 9.2) puso en la ficha del cliente, por unidad, el
-- número de la OT, en qué va y la fecha comprometida, para todo puesto con
-- `clientes.ver`. Uno de esos puestos, Supervisión General, dejó de ver las OT
-- de cada cliente y unidad en la 20261016120000, y la ficha se las volvía a
-- mostrar. DKS decidió el 2026-11-26 que lo vea solo quien ve las órdenes
-- (`ordenes.ver`) o las cotizaciones (`cotizaciones.ver_pdf_comercial`).
--
-- A quien solo ve clientes la función le devuelve nada, sin error: la ficha
-- sale como antes de la 9.2, sin decir «No se pudo leer». Ventas, Administración,
-- Gerencia, Gerencia Comercial y Diseño siguen igual. Hoy Supervisión General
-- no tiene cuentas (desde la 20261017310000), así que nadie pierde nada.
-- =============================================================================

create or replace function public.unidades_del_cliente_con_su_entrega(p_cliente uuid)
returns table (
  unidad_id     uuid,
  ot_numero     text,
  estado        text,
  fecha_entrega date
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
begin
  if not (public.es_admin() or public.tiene_permiso('clientes.ver')) then
    raise exception 'No tienes permiso para ver los clientes.' using errcode = 'insufficient_privilege';
  end if;
  -- La OT, su estado y su fecha son de quien ve las órdenes o las cotizaciones:
  -- un puesto que solo ve clientes (Supervisión General, sin `ordenes.ver` desde
  -- la 20261016120000) recibe la ficha sin ellos, sin error.
  if p_cliente is null
     or not (public.es_admin() or public.tiene_permiso('ordenes.ver') or public.tiene_permiso('cotizaciones.ver_pdf_comercial')) then
    return;
  end if;

  return query
  with ot as (
    -- La OT vigente más reciente de cada unidad del cliente.
    select distinct on (o.unidad_id)
           o.id, o.unidad_id, o.numero::text as numero, o.estado::text as estado, o.fecha_entrega_comprometida,
           case when o.cotizacion_pdf_id is not null and upper(btrim(u.codigo_interno)) <> 'PLANTA'
                then nullif(btrim(u.codigo_interno), '') end as codigo,
           o.avance_porcentaje, o.creado_en
      from public.ordenes_trabajo o
      join public.unidades u on u.id = o.unidad_id
     where u.cliente_id = p_cliente
       and o.estado <> 'ANULADA'
       and (o.estado <> 'BORRADOR' or o.abierta_en_taller)
     order by o.unidad_id, o.creado_en desc, o.id
  ),
  avance as materialized (
    -- El mismo cálculo de `avance_de_ordenes` para la OT de una cotización, una vez
    -- por código (`materialized`: si no, se repite por cada unidad del join).
    select c.codigo, coalesce(round(k.de_planos + (100 - k.peso) / 100 * k.resto, 0), 0) as avance
      from (select distinct codigo from ot where codigo is not null) c
      cross join lateral public.codigo_interno_avance_calculado(c.codigo) k
     where k.codigo = c.codigo
  )
  select ot.unidad_id, ot.numero,
         case
           when ot.estado in ('ENTREGADA', 'FACTURADA')
                or exists (select 1 from public.ot_entregas e where e.orden_id = ot.id)
                or (select r.salida_en is not null and not r.sale_al_arenado
                      from public.registro_vehiculos r
                     where r.anulado_en is null
                       and (r.orden_id = ot.id or (r.orden_id is null and r.unidad_id = ot.unidad_id
                                                    and coalesce(r.salida_en, 'infinity') >= ot.creado_en))
                     order by r.ingreso_en desc
                     limit 1) then 'ENTREGADA'
           when ot.estado = 'TERMINADA'
                or coalesce(a.avance, case when ot.codigo is null then ot.avance_porcentaje end, 0) >= 100 then 'TERMINADA'
           when ot.estado = 'PAUSADA' then 'PAUSADA'
           when ot.estado in ('EN_PROCESO', 'CONTROL_CALIDAD')
                or coalesce(a.avance, case when ot.codigo is null then ot.avance_porcentaje end, 0) > 0 then 'EN_FABRICACION'
           when ot.estado = 'BORRADOR' then 'POR_APROBAR'
           else 'APROBADA'
         end,
         ot.fecha_entrega_comprometida
    from ot
    left join avance a on a.codigo = ot.codigo;
end;
$$;

comment on function public.unidades_del_cliente_con_su_entrega(uuid) is
  'Para la ficha del cliente (Plan 9.2): de cada unidad del cliente con OT vigente, el número de la OT, su estado en una palabra (ENTREGADA, TERMINADA, PAUSADA, EN_FABRICACION, POR_APROBAR, APROBADA) y la fecha de entrega comprometida. Sin costo, margen, avance ni id de la OT. Exige clientes.ver; sin ordenes.ver ni cotizaciones.ver_pdf_comercial no devuelve nada.';

revoke all on function public.unidades_del_cliente_con_su_entrega(uuid) from public, anon;
grant execute on function public.unidades_del_cliente_con_su_entrega(uuid) to authenticated;
