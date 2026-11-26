-- =============================================================================
-- QUÉ OC TRABA EL PAGO DE CADA FACTURA, DICHO POR LA MISMA REGLA QUE LO RECHAZA
-- -----------------------------------------------------------------------------
-- Plan 11 (Tesorería), entrega 11.2: en Cuentas por pagar cada factura dice qué
-- le falta y de quién. La pantalla lo calculaba con las OC de la tabla puente
-- (`adquisiciones_control`), pero el pago lo rechaza `fn_pago_factura_oc_aprobada`
-- (20261027100000) mirando además la OC de la columna vieja y las que la
-- anexaron (`anexos_de_la_factura`). La auditoría del 2026-11-26 lo encontró:
-- una factura cuya OC estaba aprobada, pero que Logística había anexado a una OC
-- con boleta por aprobar, decía «Falta el pago · Te toca», y al pagar la base
-- respondía que esperaba a Gerencia.
--
-- Ahora la pregunta la contesta una sola función, la que usan los dos:
--
--   * `oc_que_traba_el_pago(factura)`: la primera OC de la factura que no está
--     aprobada ni exenta, la rechazada primero, después la anulada y después la
--     que espera. Interna: solo la llaman el disparador y la lista.
--   * `fn_pago_factura_oc_aprobada` la usa en lugar de su consulta (el mismo
--     texto, movido): lo que rechaza no cambia.
--   * `ocs_que_traban_las_facturas(ids)`: lo mismo para varias facturas, con el
--     nombre de la OC y desde cuándo espera a Gerencia, para la pantalla. La
--     llaman quienes ven Cuentas por pagar: Tesorería (`tesoreria.registrar_pagos`
--     o `tesoreria.ver_documentos`) y Gerencia (`adquisiciones.ver`).
--
-- No cambia ningún dato. Idempotente: `create or replace` con la misma firma.
-- =============================================================================

-- 1. La regla, en un solo lugar ---------------------------------------------------------
create or replace function public.oc_que_traba_el_pago(p_factura public.adquisiciones)
returns table (orden_compra_id uuid, numero text, referencia text, aprobacion text, pedida_en timestamptz)
language sql stable security definer set search_path to 'public' rows 1 as $$
  -- Las OC de la factura: la de la columna vieja, las de la tabla puente que no se
  -- quitaron y las que la anexaron. Se paga lo que el pago de la boleta deja
  -- pagar: aprobada o sin aprobación requerida.
  select o.id, o.numero, o.referencia, o.aprobacion, o.aprobacion_pedida_en
    from public.ordenes_compra_materiales o
   where (o.id = p_factura.orden_compra_id
          or exists (select 1 from public.adquisiciones_ordenes_compra l
                      where l.adquisicion_id = p_factura.id and l.orden_compra_id = o.id and l.quitada_en is null)
          or o.id in (select a.orden_compra_id from public.anexos_de_la_factura(p_factura) a))
     and coalesce(o.aprobacion, '') not in ('APROBADA', 'NO_REQUERIDA')
   order by case o.aprobacion when 'RECHAZADA' then 0 when 'ANULADA' then 1 else 2 end, o.numero
   limit 1;
$$;
comment on function public.oc_que_traba_el_pago(public.adquisiciones) is
  'La OC de la factura que impide pagarla (rechazada, anulada o por aprobar), en el orden en que lo dice fn_pago_factura_oc_aprobada. Interna (migración 20261126560000).';
revoke all on function public.oc_que_traba_el_pago(public.adquisiciones) from public, anon, authenticated;

-- 2. El disparador la usa: lo que rechaza no cambia -------------------------------------
create or replace function public.fn_pago_factura_oc_aprobada()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_adq public.adquisiciones%rowtype;
  v_oc  record;
begin
  if new.anulado_en is not null then return new; end if;
  select * into v_adq from public.adquisiciones where id = new.adquisicion_id;
  if not found then return new; end if;

  -- Pasa lo que la factura toma del pago de la boleta de una de SUS OC (ese pago
  -- ya exigió la aprobación) y el descuento de una nota de crédito de la misma
  -- factura. Lo pagado de más en otra OC, o lo que el proveedor tiene a favor en
  -- otra factura, salda esta igual que un pago: espera a Gerencia como él.
  if new.pago_orden_compra_id is not null
     and exists (select 1 from public.pagos_orden_compra p
                  cross join lateral public.facturas_de_la_compra(p.orden_compra_id) f
                  where p.id = new.pago_orden_compra_id and f.adquisicion_id = v_adq.id) then
    return new;
  end if;
  if new.nota_credito_id is not null
     and exists (select 1 from public.notas_credito_compra n
                  where n.id = new.nota_credito_id and n.adquisicion_id = v_adq.id) then
    return new;
  end if;

  -- La OC que traba, la misma que ve Cuentas por pagar (20261126560000).
  select t.numero, t.referencia, t.aprobacion into v_oc from public.oc_que_traba_el_pago(v_adq) t;
  if found then
    if v_oc.aprobacion = 'RECHAZADA' then
      raise exception 'La factura % es de la %, que Gerencia rechazó: no se paga.',
        v_adq.numero_documento, public.nombre_de_oc(v_oc.numero, v_oc.referencia) using errcode = 'check_violation';
    elsif v_oc.aprobacion = 'ANULADA' then
      raise exception 'La factura % es de la %, que está anulada: no se paga.',
        v_adq.numero_documento, public.nombre_de_oc(v_oc.numero, v_oc.referencia) using errcode = 'check_violation';
    end if;
    raise exception 'La factura % es de la %, que todavía espera la aprobación de Gerencia: se paga cuando Gerencia la apruebe.',
      v_adq.numero_documento, public.nombre_de_oc(v_oc.numero, v_oc.referencia) using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
comment on function public.fn_pago_factura_oc_aprobada() is
  'Rechaza el pago de una factura de compra mientras alguna de sus OC espera a Gerencia, fue rechazada o está anulada (migración 20261027100000; la OC la dice oc_que_traba_el_pago desde la 20261126560000).';
revoke all on function public.fn_pago_factura_oc_aprobada() from public, anon, authenticated;

-- 3. Lo mismo, para la lista de Cuentas por pagar ---------------------------------------
create or replace function public.ocs_que_traban_las_facturas(p_ids uuid[])
returns table (adquisicion_id uuid, orden_compra_id uuid, nombre text, aprobacion text, pedida_en timestamptz)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not (public.es_admin() or public.tiene_permiso('tesoreria.registrar_pagos')
          or public.tiene_permiso('tesoreria.ver_documentos') or public.tiene_permiso('adquisiciones.ver')) then
    raise exception 'No tienes permiso para ver qué traba el pago de las facturas.' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(cardinality(p_ids), 0) > 1000 then
    raise exception 'Se piden hasta 1000 facturas a la vez.' using errcode = 'check_violation';
  end if;
  return query
    select a.id, t.orden_compra_id, public.nombre_de_oc(t.numero, t.referencia), t.aprobacion, t.pedida_en
      from public.adquisiciones a
      cross join lateral public.oc_que_traba_el_pago(a) t
     where a.id = any (p_ids);
end;
$$;
comment on function public.ocs_que_traban_las_facturas(uuid[]) is
  'Para cada factura pedida, la OC que impide pagarla (la misma que rechaza fn_pago_factura_oc_aprobada), con su nombre, su aprobación y desde cuándo espera. Para Cuentas por pagar: Tesorería y Gerencia (migración 20261126560000).';
revoke all on function public.ocs_que_traban_las_facturas(uuid[]) from public, anon;
grant execute on function public.ocs_que_traban_las_facturas(uuid[]) to authenticated;
