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
--    para que ningún otro camino al INSERT lo salte. Pasan solo lo que la factura
--    toma del pago de la boleta de una de sus OC (ese pago ya exigió la
--    aprobación) y el descuento de una nota de crédito de la misma factura; lo
--    pagado de más en otra OC o lo que el proveedor tiene a favor en otra factura
--    espera a Gerencia como cualquier pago. La OC anulada tampoco se paga.
--
-- 2. `audit_log` copia la fila entera, con sus montos, y se lee con
--    `auditoria.ver`. Varias tablas con montos o datos del personal no estaban
--    en su política: quien tiene `auditoria.ver` y no la llave de la tabla (hoy,
--    Supervisión general) leía ahí los subcontratos con su monto, cada recibo
--    por honorarios con bruto, retención y neto, las facturas de compra y sus
--    pagos, y los permisos y observaciones del personal. Cada tabla se lee ahora
--    en el historial con la misma llave que pide su propia política de lectura.
--    Es la política de la 20261020210000 más estas: quien vuelva a escribirla
--    tiene que conservarlas todas. Cada llamada va en `(select …)`, que se evalúa
--    una vez por consulta y no fila por fila.
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

  -- Las OC de la factura: la de la columna vieja, las de la tabla puente que no se
  -- quitaron y las que la anexaron. Se paga lo que el pago de la boleta deja
  -- pagar: aprobada o sin aprobación requerida.
  select o.numero, o.referencia, o.aprobacion into v_oc
    from public.ordenes_compra_materiales o
   where (o.id = v_adq.orden_compra_id
          or exists (select 1 from public.adquisiciones_ordenes_compra l
                      where l.adquisicion_id = v_adq.id and l.orden_compra_id = o.id and l.quitada_en is null)
          or o.id in (select a.orden_compra_id from public.anexos_de_la_factura(v_adq) a))
     and coalesce(o.aprobacion, '') not in ('APROBADA', 'NO_REQUERIDA')
   order by case o.aprobacion when 'RECHAZADA' then 0 when 'ANULADA' then 1 else 2 end, o.numero
   limit 1;
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
  'Rechaza el pago de una factura de compra mientras alguna de sus OC espera a Gerencia, fue rechazada o está anulada (migración 20261027100000).';
revoke all on function public.fn_pago_factura_oc_aprobada() from public, anon, authenticated;

drop trigger if exists trg_pago_factura_oc_aprobada on public.pagos_adquisicion;
create trigger trg_pago_factura_oc_aprobada
  before insert on public.pagos_adquisicion
  for each row execute function public.fn_pago_factura_oc_aprobada();

-- -----------------------------------------------------------------------------
-- 2. El historial, con la llave de cada tabla
-- -----------------------------------------------------------------------------
alter policy ver_audit_log on public.audit_log using (
  (select public.es_admin()) or (
    (select public.tiene_permiso('auditoria.ver'))
    and (tabla <> all (array['cajas', 'movimientos_caja', 'cierres_caja'])
         or (select public.tiene_permiso('tesoreria.caja')))
    and (tabla <> all (array['trabajador_remuneraciones', 'trabajador_costos', 'tareos',
                             'trabajador_cuentas', 'trabajadores'])
         or (select public.tiene_permiso('rrhh.personal')))
    and (tabla <> 'usuario_datos_reservados'
         or (select public.tiene_permiso('rrhh.personal')) or (select public.tiene_permiso('usuarios.gestionar')))
    -- La auditoría de `usuarios` de antes de la mudanza copió la fila entera,
    -- con el DNI y el costo. Esas filas no se reescriben (son evidencia): las
    -- que llevan alguno de los dos se ven solo con el mismo permiso que la
    -- tabla reservada. Las demás, y todas las de después, siguen a la vista.
    and (tabla <> 'usuarios'
         or (select public.tiene_permiso('rrhh.personal')) or (select public.tiene_permiso('usuarios.gestionar'))
         or (nullif(datos_antes ->> 'documento', '') is null
             and nullif(datos_despues ->> 'documento', '') is null
             and coalesce((datos_antes ->> 'costo_hora')::numeric, 0) = 0
             and coalesce((datos_despues ->> 'costo_hora')::numeric, 0) = 0))
    and (tabla <> all (array['planillas', 'planilla_personas', 'planilla_distribuciones'])
         or (select public.tiene_permiso('rrhh.ver_planillas')))
    and (tabla <> all (array['cotizaciones_pdf', 'cotizaciones_pdf_versiones', 'cotizaciones_pdf_igv',
                             'ot_presupuestos', 'ot_ventas_anteriores'])
         or (select public.tiene_permiso('cotizaciones.ver_pdf_comercial')))
    -- Cada tabla, con lo mismo que pide su política de lectura.
    and (tabla <> all (array['facturas_venta', 'cobros_factura_venta'])
         or (select public.tiene_permiso('contabilidad.facturar')) or (select public.tiene_permiso('cotizaciones.ver_aprobadas'))
         or (select public.tiene_permiso('tesoreria.ver_documentos')))
    and (tabla <> 'cuentas_cobrar_ot'
         or (select public.tiene_permiso('tesoreria.ver_documentos')) or (select public.tiene_permiso('adquisiciones.ver')))
    and (tabla <> 'proveedor_cuentas' or (select public.tiene_permiso('proveedores.ver_cuentas')))
    and (tabla <> 'subcontratistas' or (select public.puede_ver_subcontratos()))
    and (tabla <> all (array['planilla_diaria_personas', 'planilla_diaria_detalle'])
         or (select public.puede_ver_planilla_diaria()))
    and (tabla <> 'programacion_recojo'
         or (select public.tiene_permiso('compras.programar_recojo')) or (select public.tiene_permiso('compras.recojo')))
    and (tabla <> 'pagos_orden_compra'
         or (select public.tiene_permiso('tesoreria.registrar_pagos')) or (select public.tiene_permiso('tesoreria.ver_documentos'))
         or (select public.tiene_permiso('compras.crear')) or (select public.tiene_permiso('adquisiciones.ver')))
    and (tabla <> 'devoluciones_orden_compra'
         or (select public.tiene_permiso('tesoreria.registrar_pagos')) or (select public.tiene_permiso('tesoreria.ver_documentos'))
         or (select public.tiene_permiso('compras.crear')) or (select public.tiene_permiso('adquisiciones.ver')))
    and (tabla <> 'documentos_orden_servicio'
         or (select public.tiene_permiso('tesoreria.pagar_servicios')) or (select public.tiene_permiso('tesoreria.ver_documentos'))
         or (select public.tiene_permiso('compras.crear')) or (select public.tiene_permiso('compras.detraccion'))
         or (select public.tiene_permiso('adquisiciones.ver')))
    -- Desde la 20261027100000: las demás tablas con montos o datos del personal.
    -- Subcontratos y recibos por honorarios: montos, retención y neto.
    and (tabla <> all (array['subcontratos', 'subcontrato_contratos', 'recibos_honorarios', 'pagos_recibo_honorarios'])
         or (select public.puede_ver_subcontratos()))
    -- Facturas de compra y sus pagos.
    and (tabla <> all (array['adquisiciones', 'pagos_adquisicion', 'adquisiciones_ordenes_compra'])
         or (select public.tiene_permiso('adquisiciones.ver')))
    and (tabla <> all (array['notas_credito_compra', 'reembolsos_nota_credito'])
         or (select public.tiene_permiso('adquisiciones.ver')) or (select public.tiene_permiso('tesoreria.registrar_pagos'))
         or (select public.tiene_permiso('tesoreria.ver_documentos')))
    and (tabla <> 'compras_pagadas_fuera_confirmadas'
         or (select public.tiene_permiso('tesoreria.registrar_pagos')) or (select public.tiene_permiso('tesoreria.ver_documentos'))
         or (select public.tiene_permiso('compras.crear')) or (select public.tiene_permiso('adquisiciones.ver')))
    and (tabla <> 'cobros_ot'
         or (select public.tiene_permiso('tesoreria.ver_documentos')) or (select public.tiene_permiso('adquisiciones.ver')))
    -- Órdenes de compra y de servicio, con sus precios.
    and (tabla <> 'ordenes_compra_materiales'
         or (select public.tiene_permiso('compras.ver')) or (select public.tiene_permiso('almacen.recibir'))
         or (select public.tiene_permiso('tesoreria.ver_documentos')))
    and (tabla <> 'orden_compra_material_detalles'
         or (select public.tiene_permiso('compras.ver')) or (select public.tiene_permiso('almacen.recibir')))
    and (tabla <> 'documentos_compra_material'
         or (select public.tiene_permiso('compras.ver')) or (select public.tiene_permiso('tesoreria.ver_documentos'))
         or (select public.tiene_permiso('adquisiciones.ver')))
    and (tabla <> 'ordenes_servicio'
         or (select public.tiene_permiso('compras.ver')) or (select public.tiene_permiso('compras.crear'))
         or (select public.tiene_permiso('compras.detraccion')) or (select public.tiene_permiso('tesoreria.ver_documentos'))
         or (select public.tiene_permiso('costos.ver')) or (select public.es_aprobador_compras()))
    and (tabla <> 'pagos_orden_servicio'
         or (select public.tiene_permiso('tesoreria.pagar_servicios')) or (select public.tiene_permiso('tesoreria.ver_documentos'))
         or (select public.tiene_permiso('compras.crear')) or (select public.tiene_permiso('adquisiciones.ver')))
    and (tabla <> 'regla_aprobacion_compras'
         or (select public.tiene_permiso('compras.ver')) or (select public.tiene_permiso('compras.configurar_aprobacion'))
         or (select public.es_aprobador_compras()))
    and (tabla <> 'valorizaciones_material'
         or (select public.tiene_permiso('almacen.valorizar')) or (select public.tiene_permiso('compras.ver'))
         or (select public.tiene_permiso('almacen.ver')) or (select public.tiene_permiso('costos.ver')))
    -- Costos de la OT y gastos del mes.
    and (tabla <> 'gastos_generales_mes'
         or (select public.tiene_permiso('costos.gastos_generales')) or (select public.tiene_permiso('costos.ver')))
    and (tabla <> 'ot_cierres_costo' or (select public.tiene_permiso('costos.ver')))
    and (tabla <> 'ot_control_vehicular'
         or (select public.tiene_permiso('costos.ver')) or (select public.tiene_permiso('costos.controlar_ot')))
    and (tabla <> 'ot_gastos_areas'
         or (select public.tiene_permiso('costos.ver')) or (select public.tiene_permiso('costos.revisar_gasto'))
         or (select public.tiene_permiso('costos.registrar_gasto')))
    and (tabla <> 'ot_solicitudes_tesoreria'
         or (select public.tiene_permiso('costos.ver')) or (select public.tiene_permiso('costos.solicitar_pago'))
         or (select public.tiene_permiso('tesoreria.ver_documentos')))
    and (tabla <> 'cotizaciones_pdf_liberaciones_tesoreria'
         or (select public.tiene_permiso('tesoreria.ver_documentos')) or (select public.tiene_permiso('cotizaciones.ver_pdf_comercial')))
    -- El personal: asistencia, permisos, observaciones y la planilla diaria.
    and (tabla <> 'asistencias' or (select public.puede_ver_trabajadores()))
    and (tabla <> all (array['permisos_personal', 'permisos_descontados'])
         or (select public.tiene_permiso('rrhh.permisos')) or (select public.tiene_permiso('asistencia.ver')))
    and (tabla <> 'observaciones_personal'
         or (select public.tiene_permiso('rrhh.personal')) or (select public.tiene_permiso('asistencia.ver')))
    and (tabla <> all (array['horas_extras_decisiones', 'horas_compensadas', 'rrhh_regla_horas_extras'])
         or (select public.tiene_permiso('planilla_diaria.preparar')) or (select public.tiene_permiso('planilla_diaria.ver')))
    and (tabla <> all (array['planillas_diarias', 'planilla_diaria_pagos'])
         or (select public.puede_ver_planilla_diaria()))
    -- Clientes y proveedores.
    and (tabla <> all (array['clientes', 'contactos_cliente']) or (select public.tiene_permiso('clientes.ver')))
    and (tabla <> 'proveedores'
         or (select public.tiene_permiso('proveedores.ver')) or (select public.tiene_permiso('compras.crear'))
         or (select public.tiene_permiso('adquisiciones.registrar')))
    -- El reporte diario, las entregas de la unidad (con el documento de quien
    -- recibe), las guías de las compras, lo que espera entrar al almacén (con su
    -- precio) y los informes de Diseño.
    and (tabla <> all (array['reportes_diarios', 'reporte_diario_personal', 'reporte_diario_trabajos', 'reporte_diario_fotos'])
         or (select public.tiene_permiso('reporte_diario.ver')))
    and (tabla <> 'ot_entregas' or (select public.tiene_permiso('ordenes.ver')))
    and (tabla <> 'guias_remision_compra'
         or (select public.tiene_permiso('compras.programar_recojo')) or (select public.tiene_permiso('compras.guia_remision'))
         or (select public.tiene_permiso('compras.recojo')) or (select public.tiene_permiso('adquisiciones.ver')))
    and (tabla <> 'ingresos_pendientes_almacen'
         or (select public.tiene_permiso('almacen.ver')) or (select public.tiene_permiso('almacen.recibir')) or (select public.tiene_permiso('compras.ver')))
    and (tabla <> 'diseno_informes'
         or (select public.tiene_permiso('diseno.planos')) or (select public.tiene_permiso('diseno.subir_pdf')) or (select public.tiene_permiso('supervision.general')))
    -- Las correcciones copian el documento entero (la factura con su total y su
    -- RUC, la OC con sus precios): cada una con la llave de su documento, como
    -- su tabla.
    and (tabla <> 'correcciones'
         or (coalesce(datos_despues ->> 'documento', datos_antes ->> 'documento') = 'REQUERIMIENTO'
             and (select public.puede_ver_requerimientos()))
         or (coalesce(datos_despues ->> 'documento', datos_antes ->> 'documento') = 'ORDEN_COMPRA'
             and ((select public.tiene_permiso('compras.ver')) or (select public.tiene_permiso('compras.crear'))
                  or (select public.tiene_permiso('tesoreria.ver_documentos'))))
         or (coalesce(datos_despues ->> 'documento', datos_antes ->> 'documento') = 'FACTURA_COMPRA'
             and (select public.tiene_permiso('adquisiciones.ver'))))
    -- Las tablas de la OT se abren además por OT (`puede_ver_orden`); eso no lo
    -- resuelve una llave por tabla: el historial las deja a quien tiene su llave.
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
