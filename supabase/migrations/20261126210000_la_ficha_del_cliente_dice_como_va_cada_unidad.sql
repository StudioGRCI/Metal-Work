-- =============================================================================
-- LA FICHA DEL CLIENTE DICE CÓMO VA CADA UNIDAD (Plan 9, entrega 9.2)
-- -----------------------------------------------------------------------------
-- El cliente llama y pregunta «¿para cuándo está mi unidad?». El vendedor abre
-- la ficha del cliente y ve sus vehículos, pero no en qué va cada uno ni la
-- fecha que se le prometió: eso está en la OT y en el código interno, junto con
-- el costo, el avance por área y los planos, que no son de Ventas.
--
-- Esta función devuelve solo eso, unidad por unidad: la OT vigente, su estado
-- en una palabra y la fecha de entrega comprometida (la que Administración pone
-- al cargar la OT). Nada más: ni costo, ni margen, ni avance por área, ni
-- porcentaje, ni el id de la OT. Quien la llama no gana ningún permiso sobre la
-- orden; la lee quien ya lee la ficha del cliente (`clientes.ver`, la política
-- de `clientes` y de `unidades`).
--
-- El estado sale de lo que ya existe, en este orden:
--   ENTREGADA       la OT está ENTREGADA o FACTURADA, tiene su acta
--                   (`ot_entregas`), o Portería anotó la salida del vehículo
--                   (`registro_vehiculos`) después de abrirse la OT, no fue al
--                   arenado y no volvió a entrar. El acta pide la OT TERMINADA, y la OT de una
--                   cotización se queda en APROBADA: sin mirar la salida, esa
--                   unidad diría «Terminada» después de irse.
--   TERMINADA       la OT está TERMINADA, o el avance de su código llegó a 100
--   PAUSADA         la OT está pausada
--   EN_FABRICACION  la OT está en proceso o en control de calidad, o su código
--                   ya tiene avance
--   APROBADA        tiene OT aprobada (o programada) y todavía no empieza
-- La OT en BORRADOR no cuenta: todavía no la aprueban y su fecha no se le
-- prometió a nadie. Tampoco tapa a la vigente que la unidad ya tenga.
-- La OT de una cotización se queda en APROBADA aunque el taller avance (su
-- avance es el de su código interno, migración 20261026160000); por eso se mira
-- el avance del código, con el mismo cálculo que `avance_de_ordenes`. El
-- porcentaje se usa para decidir la palabra y no sale de aquí.
--
-- No toca el semáforo de entregas de RR. HH. (20261125100000): la fecha es la
-- misma columna, sin colores.
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
  if p_cliente is null then
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
       and o.estado not in ('ANULADA', 'BORRADOR')
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
           else 'APROBADA'
         end,
         ot.fecha_entrega_comprometida
    from ot
    left join avance a on a.codigo = ot.codigo;
end;
$$;

comment on function public.unidades_del_cliente_con_su_entrega(uuid) is
  'Para la ficha del cliente (Plan 9.2): de cada unidad del cliente con OT vigente, el número de la OT, su estado en una palabra (ENTREGADA, TERMINADA, PAUSADA, EN_FABRICACION, APROBADA) y la fecha de entrega comprometida. Sin costo, margen, avance ni id de la OT. Exige clientes.ver.';

revoke all on function public.unidades_del_cliente_con_su_entrega(uuid) from public, anon;
grant execute on function public.unidades_del_cliente_con_su_entrega(uuid) to authenticated;
