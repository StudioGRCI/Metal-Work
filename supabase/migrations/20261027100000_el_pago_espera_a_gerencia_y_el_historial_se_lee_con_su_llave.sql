-- =============================================================================
-- La factura de una OC que Gerencia no aprobó no se paga, y el historial no
-- deja leer lo que la tabla tapa.
--
-- Lo halló la revisión del 27/10/2026 (hilo «Mejorar el diseño y mostrar
-- porcentaje y costo», auditoría de funcionalidad, P1-2 y P1-3):
--
-- 1. Gerencia aprueba toda compra desde S/ 0 (DKS, 12/10). El pago de la OC con
--    boleta ya lo exige (`registrar_pago_compra`), pero el de la factura no:
--    Tesorería pagó entera la F001-002317 con su OC-5583 «Por aprobar». Ahora el
--    pago de una factura espera a que Gerencia apruebe todas sus OC, y la
--    rechazada no se paga. Va como trigger y no dentro de `registrar_pago_factura`
--    para que ningún otro camino al INSERT lo salte. Lo que el sistema anota solo
--    (lo que la factura toma del pago de la boleta, el descuento de una nota de
--    crédito) no pasa por aquí: el pago de la boleta ya exigió la aprobación.
--
-- 2. `audit_log` copia la fila entera, con sus montos, y se lee con
--    `auditoria.ver`. Varias tablas con montos o datos del personal no estaban
--    en su política: quien tiene `auditoria.ver` y no la llave de la tabla (hoy,
--    Supervisión general) leía ahí los subcontratos con su monto, cada recibo
--    por honorarios con bruto, retención y neto, las facturas de compra y sus
--    pagos, y los permisos y observaciones del personal. Cada tabla se lee ahora
--    en el historial con la misma llave que pide su propia política de lectura.
--    Es la política de la 20261020210000 más estas: quien vuelva a escribirla
--    tiene que conservarlas todas.
--
-- 3. Cuentas por pagar mostraba «Registrar pago» en esa factura. Ahora
--    `adquisiciones_control` trae la aprobación de cada OC y la factura dice que
--    espera a Gerencia, o que Gerencia rechazó su OC.
--
-- Idempotente: create or replace, drop trigger if exists y alter policy.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. El pago de la factura espera a Gerencia
-- -----------------------------------------------------------------------------
create or replace function public.fn_pago_factura_oc_aprobada()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_adq public.adquisiciones%rowtype;
  v_oc  record;
begin
  -- Lo anulado, lo que descuenta una nota de crédito y lo que la factura toma
  -- del pago de la boleta (que ya exigió la aprobación) pasan.
  if new.anulado_en is not null or new.nota_credito_id is not null or new.pago_orden_compra_id is not null then
    return new;
  end if;
  select * into v_adq from public.adquisiciones where id = new.adquisicion_id;
  if not found then return new; end if;

  -- Las OC de la factura: la de la columna vieja y las de la tabla puente.
  select o.numero, o.referencia, o.aprobacion into v_oc
    from public.ordenes_compra_materiales o
   where o.aprobacion in ('POR_APROBAR', 'RECHAZADA')
     and (o.id = v_adq.orden_compra_id
          or exists (select 1 from public.adquisiciones_ordenes_compra l
                      where l.adquisicion_id = v_adq.id and l.orden_compra_id = o.id and l.quitada_en is null))
   order by o.aprobacion = 'RECHAZADA' desc, o.numero
   limit 1;
  if found then
    if v_oc.aprobacion = 'RECHAZADA' then
      raise exception 'La factura % es de la %, que Gerencia rechazó: no se paga.',
        v_adq.numero_documento, public.nombre_de_oc(v_oc.numero, v_oc.referencia) using errcode = 'check_violation';
    end if;
    raise exception 'La factura % es de la %, que todavía espera la aprobación de Gerencia: se paga cuando Gerencia la apruebe.',
      v_adq.numero_documento, public.nombre_de_oc(v_oc.numero, v_oc.referencia) using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
comment on function public.fn_pago_factura_oc_aprobada() is
  'Rechaza el pago de una factura de compra mientras alguna de sus OC espera a Gerencia o fue rechazada (migración 20261027100000).';
revoke all on function public.fn_pago_factura_oc_aprobada() from public, anon, authenticated;

drop trigger if exists trg_pago_factura_oc_aprobada on public.pagos_adquisicion;
create trigger trg_pago_factura_oc_aprobada
  before insert on public.pagos_adquisicion
  for each row execute function public.fn_pago_factura_oc_aprobada();

-- -----------------------------------------------------------------------------
-- 2. El historial, con la llave de cada tabla
-- -----------------------------------------------------------------------------
alter policy ver_audit_log on public.audit_log using (
  public.es_admin() or (
    public.tiene_permiso('auditoria.ver')
    and (tabla <> all (array['cajas', 'movimientos_caja', 'cierres_caja'])
         or public.tiene_permiso('tesoreria.caja'))
    and (tabla <> all (array['trabajador_remuneraciones', 'trabajador_costos', 'tareos',
                             'trabajador_cuentas', 'trabajadores'])
         or public.tiene_permiso('rrhh.personal'))
    and (tabla <> 'usuario_datos_reservados'
         or public.tiene_permiso('rrhh.personal') or public.tiene_permiso('usuarios.gestionar'))
    -- La auditoría de `usuarios` de antes de la mudanza copió la fila entera,
    -- con el DNI y el costo. Esas filas no se reescriben (son evidencia): las
    -- que llevan alguno de los dos se ven solo con el mismo permiso que la
    -- tabla reservada. Las demás, y todas las de después, siguen a la vista.
    and (tabla <> 'usuarios'
         or public.tiene_permiso('rrhh.personal') or public.tiene_permiso('usuarios.gestionar')
         or (nullif(datos_antes ->> 'documento', '') is null
             and nullif(datos_despues ->> 'documento', '') is null
             and coalesce((datos_antes ->> 'costo_hora')::numeric, 0) = 0
             and coalesce((datos_despues ->> 'costo_hora')::numeric, 0) = 0))
    and (tabla <> all (array['planillas', 'planilla_personas', 'planilla_distribuciones'])
         or public.tiene_permiso('rrhh.ver_planillas'))
    and (tabla <> all (array['cotizaciones_pdf', 'cotizaciones_pdf_versiones', 'cotizaciones_pdf_igv',
                             'ot_presupuestos', 'ot_ventas_anteriores'])
         or public.tiene_permiso('cotizaciones.ver_pdf_comercial'))
    -- Cada tabla, con lo mismo que pide su política de lectura.
    and (tabla <> all (array['facturas_venta', 'cobros_factura_venta'])
         or public.tiene_permiso('contabilidad.facturar') or public.tiene_permiso('cotizaciones.ver_aprobadas')
         or public.tiene_permiso('tesoreria.ver_documentos'))
    and (tabla <> 'cuentas_cobrar_ot'
         or public.tiene_permiso('tesoreria.ver_documentos') or public.tiene_permiso('adquisiciones.ver'))
    and (tabla <> 'proveedor_cuentas' or public.tiene_permiso('proveedores.ver_cuentas'))
    and (tabla <> 'subcontratistas' or public.puede_ver_subcontratos())
    and (tabla <> all (array['planilla_diaria_personas', 'planilla_diaria_detalle'])
         or public.puede_ver_planilla_diaria())
    and (tabla <> 'programacion_recojo'
         or public.tiene_permiso('compras.programar_recojo') or public.tiene_permiso('compras.recojo'))
    and (tabla <> 'pagos_orden_compra'
         or public.tiene_permiso('tesoreria.registrar_pagos') or public.tiene_permiso('tesoreria.ver_documentos')
         or public.tiene_permiso('compras.crear') or public.tiene_permiso('adquisiciones.ver'))
    and (tabla <> 'devoluciones_orden_compra'
         or public.tiene_permiso('tesoreria.registrar_pagos') or public.tiene_permiso('tesoreria.ver_documentos')
         or public.tiene_permiso('compras.crear') or public.tiene_permiso('adquisiciones.ver'))
    and (tabla <> 'documentos_orden_servicio'
         or public.tiene_permiso('tesoreria.pagar_servicios') or public.tiene_permiso('tesoreria.ver_documentos')
         or public.tiene_permiso('compras.crear') or public.tiene_permiso('compras.detraccion')
         or public.tiene_permiso('adquisiciones.ver'))
    -- Desde la 20261027100000: las demás tablas con montos o datos del personal.
    -- Subcontratos y recibos por honorarios: montos, retención y neto.
    and (tabla <> all (array['subcontratos', 'subcontrato_contratos', 'recibos_honorarios', 'pagos_recibo_honorarios'])
         or public.puede_ver_subcontratos())
    -- Facturas de compra y sus pagos.
    and (tabla <> all (array['adquisiciones', 'pagos_adquisicion', 'adquisiciones_ordenes_compra'])
         or public.tiene_permiso('adquisiciones.ver'))
    and (tabla <> all (array['notas_credito_compra', 'reembolsos_nota_credito'])
         or public.tiene_permiso('adquisiciones.ver') or public.tiene_permiso('tesoreria.registrar_pagos')
         or public.tiene_permiso('tesoreria.ver_documentos'))
    and (tabla <> 'compras_pagadas_fuera_confirmadas'
         or public.tiene_permiso('tesoreria.registrar_pagos') or public.tiene_permiso('tesoreria.ver_documentos')
         or public.tiene_permiso('compras.crear') or public.tiene_permiso('adquisiciones.ver'))
    and (tabla <> 'cobros_ot'
         or public.tiene_permiso('tesoreria.ver_documentos') or public.tiene_permiso('adquisiciones.ver'))
    -- Órdenes de compra y de servicio, con sus precios.
    and (tabla <> 'ordenes_compra_materiales'
         or public.tiene_permiso('compras.ver') or public.tiene_permiso('almacen.recibir')
         or public.tiene_permiso('tesoreria.ver_documentos'))
    and (tabla <> 'orden_compra_material_detalles'
         or public.tiene_permiso('compras.ver') or public.tiene_permiso('almacen.recibir'))
    and (tabla <> 'documentos_compra_material'
         or public.tiene_permiso('compras.ver') or public.tiene_permiso('tesoreria.ver_documentos')
         or public.tiene_permiso('adquisiciones.ver'))
    and (tabla <> 'ordenes_servicio'
         or public.tiene_permiso('compras.ver') or public.tiene_permiso('compras.crear')
         or public.tiene_permiso('compras.detraccion') or public.tiene_permiso('tesoreria.ver_documentos')
         or public.tiene_permiso('costos.ver') or public.es_aprobador_compras())
    and (tabla <> 'pagos_orden_servicio'
         or public.tiene_permiso('tesoreria.pagar_servicios') or public.tiene_permiso('tesoreria.ver_documentos')
         or public.tiene_permiso('compras.crear') or public.tiene_permiso('adquisiciones.ver'))
    and (tabla <> 'regla_aprobacion_compras'
         or public.tiene_permiso('compras.ver') or public.tiene_permiso('compras.configurar_aprobacion')
         or public.es_aprobador_compras())
    and (tabla <> 'valorizaciones_material'
         or public.tiene_permiso('almacen.valorizar') or public.tiene_permiso('compras.ver')
         or public.tiene_permiso('almacen.ver') or public.tiene_permiso('costos.ver'))
    -- Costos de la OT y gastos del mes.
    and (tabla <> 'gastos_generales_mes'
         or public.tiene_permiso('costos.gastos_generales') or public.tiene_permiso('costos.ver'))
    and (tabla <> 'ot_cierres_costo' or public.tiene_permiso('costos.ver'))
    and (tabla <> 'ot_control_vehicular'
         or public.tiene_permiso('costos.ver') or public.tiene_permiso('costos.controlar_ot'))
    and (tabla <> 'ot_gastos_areas'
         or public.tiene_permiso('costos.ver') or public.tiene_permiso('costos.revisar_gasto')
         or public.tiene_permiso('costos.registrar_gasto'))
    and (tabla <> 'ot_solicitudes_tesoreria'
         or public.tiene_permiso('costos.ver') or public.tiene_permiso('costos.solicitar_pago')
         or public.tiene_permiso('tesoreria.ver_documentos'))
    and (tabla <> 'cotizaciones_pdf_liberaciones_tesoreria'
         or public.tiene_permiso('tesoreria.ver_documentos') or public.tiene_permiso('cotizaciones.ver_pdf_comercial'))
    -- El personal: asistencia, permisos, observaciones y la planilla diaria.
    and (tabla <> 'asistencias' or public.puede_ver_trabajadores())
    and (tabla <> all (array['permisos_personal', 'permisos_descontados'])
         or public.tiene_permiso('rrhh.permisos') or public.tiene_permiso('asistencia.ver'))
    and (tabla <> 'observaciones_personal'
         or public.tiene_permiso('rrhh.personal') or public.tiene_permiso('asistencia.ver'))
    and (tabla <> all (array['horas_extras_decisiones', 'horas_compensadas', 'rrhh_regla_horas_extras'])
         or public.tiene_permiso('planilla_diaria.preparar') or public.tiene_permiso('planilla_diaria.ver'))
    and (tabla <> all (array['planillas_diarias', 'planilla_diaria_pagos'])
         or public.puede_ver_planilla_diaria())
    -- Clientes y proveedores.
    and (tabla <> all (array['clientes', 'contactos_cliente']) or public.tiene_permiso('clientes.ver'))
    and (tabla <> 'proveedores'
         or public.tiene_permiso('proveedores.ver') or public.tiene_permiso('compras.crear')
         or public.tiene_permiso('adquisiciones.registrar'))
  )
);

-- 3. Cuentas por pagar dice a quién espera la factura -------------------------------------------------------------
-- La definición viva de `adquisiciones_control`, con la aprobación de Gerencia de
-- cada OC: en vez de «Registrar pago», Tesorería lee que la factura espera a Gerencia.
CREATE OR REPLACE FUNCTION public.adquisiciones_control(p_ids uuid[])
 RETURNS TABLE(adquisicion_id uuid, ordenes jsonb, total_oc numeric, diferencia numeric, control text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (public.es_admin() or public.tiene_permiso('adquisiciones.ver')) then
    raise exception 'No tienes permiso para ver Adquisiciones.' using errcode = 'insufficient_privilege';
  end if;
  return query
    with oc as (
      select l.adquisicion_id as adq, l.parcial, c.id, c.numero, c.referencia, c.moneda, c.con_factura, c.aprobacion,
             public.total_orden_compra(c.id) as total,
             exists (select 1 from public.orden_compra_material_detalles d
                      where d.orden_compra_id = c.id and d.precio_unitario is null) as sin_precio,
             o.numero as numero_ot,
             coalesce(f.facturado, 0) as facturado_otras, f.facturas as otras
        from public.adquisiciones_ordenes_compra l
        join public.ordenes_compra_materiales c on c.id = l.orden_compra_id
        left join public.requerimientos_materiales r on r.id = c.requerimiento_id
        left join public.ordenes_trabajo o on o.id = r.orden_id
        left join lateral public.compras_facturadas(array[c.id], l.adquisicion_id) f on true
       where l.adquisicion_id = any (p_ids) and l.quitada_en is null
    ), cuenta as (
      select a.id, a.total as total_factura, a.moneda,
             coalesce(jsonb_agg(jsonb_build_object('id', oc.id, 'numero', oc.numero, 'referencia', oc.referencia,
                                                   'moneda', oc.moneda, 'total', oc.total, 'sin_precio', oc.sin_precio,
                                                   'con_factura', oc.con_factura, 'numero_ot', oc.numero_ot,
                                                   'parcial', oc.parcial, 'facturado_otras', oc.facturado_otras,
                                                   'otras_facturas', coalesce(oc.otras, '[]'::jsonb),
                                                   'aprobacion', oc.aprobacion)
                                order by oc.numero) filter (where oc.id is not null), '[]'::jsonb) as ordenes,
             count(oc.id) as n,
             bool_or(oc.moneda <> a.moneda) as otra_moneda,
             bool_or(oc.sin_precio) as sin_precio,
             bool_or(oc.parcial) as parcial,
             sum(greatest(oc.total - oc.facturado_otras, 0)) as pendiente
        from public.adquisiciones a
        left join oc on oc.adq = a.id
       where a.id = any (p_ids)
       group by a.id
    )
    select k.id, k.ordenes,
           case when k.n = 0 or k.sin_precio or k.otra_moneda then null else k.pendiente::numeric(14, 2) end,
           case when k.n = 0 or k.sin_precio or k.otra_moneda then null else (k.total_factura - k.pendiente)::numeric(14, 2) end,
           case when k.n = 0 then 'SIN_OC'
                when k.otra_moneda then 'OTRA_MONEDA'
                when k.sin_precio then 'SIN_PRECIO'
                when k.parcial and k.total_factura <= k.pendiente + 1 and k.total_factura < k.pendiente - 1 then 'PARCIAL'
                when abs(k.total_factura - k.pendiente) <= 1 then 'CALZA'
                else 'NO_CALZA' end
      from cuenta k;
end;
$function$;
