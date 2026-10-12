-- =============================================================================
-- TESORERÍA VE LA COMPRA DIRECTA A CRÉDITO
-- -----------------------------------------------------------------------------
-- La compra directa (para el almacén, sin requerimiento ni OT) también es una
-- deuda con el proveedor cuando se compra a crédito. La lista de Tesorería
-- «Compras a crédito sin comprobante» unía la compra con su requerimiento y su
-- OT de forma obligatoria, así que la directa no aparecía: Tesorería no se
-- enteraba de que había que pedir la factura ni de cuándo vencía.
--
-- La vista pasa a unir el requerimiento y la OT de forma opcional solo para la
-- directa, que sale sin OT, y suma al final el número OC-…-MW de la compra. La
-- compra de requerimiento sigue exigiendo que quien mira vea su requerimiento y
-- su OT, como antes: lo que ya veía cada puesto no cambia.
-- `create or replace view` reemplaza también sus opciones: se repite
-- `security_invoker`, o la vista correría como su dueña saltando el RLS.
-- =============================================================================

create or replace view public.v_compras_credito_sin_comprobante with (security_invoker = true) as
select c.id as orden_compra_id, r.orden_id, o.numero as numero_ot,
       c.proveedor, c.referencia, c.creado_en::date as fecha_compra,
       (c.creado_en::date + c.dias_credito) as fecha_vencimiento,
       case when bool_or(d.precio_unitario is null) then null::numeric
            else round(sum(d.cantidad::numeric * d.precio_unitario), 2)::numeric(14,2)
       end as total_estimado,
       c.moneda,
       c.numero
  from public.ordenes_compra_materiales c
  left join public.requerimientos_materiales r on r.id = c.requerimiento_id
  left join public.ordenes_trabajo o on o.id = r.orden_id
  join public.orden_compra_material_detalles d on d.orden_compra_id = c.id
 where c.condicion_pago = 'CREDITO'
   and (c.requerimiento_id is null or o.id is not null)
   and not exists (select 1 from public.adquisiciones a
                    where a.orden_compra_id = c.id and a.estado = 'REGISTRADA')
 group by c.id, r.orden_id, o.numero;

revoke all on public.v_compras_credito_sin_comprobante from public, anon;
grant select on public.v_compras_credito_sin_comprobante to authenticated;
