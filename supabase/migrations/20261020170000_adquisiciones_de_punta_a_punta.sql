-- =============================================================================
-- ADQUISICIONES DE PUNTA A PUNTA: CADA OC Y CADA OS, DE DÓNDE SALIÓ HASTA SU PAGO
-- -----------------------------------------------------------------------------
-- DKS pidió el 2026-10-20 que Adquisiciones sea «una tabla donde estén todas
-- las OC y OS con su vinculación de RQ, proveedor y demás, y se pueda observar
-- desde dónde se generó hasta si se pagó y sus respectivos comprobantes».
--
-- Hasta aquí Adquisiciones iba por factura: cada factura con sus OC, y al final
-- las OC que esperaban la suya. Las OC sin factura (boleta), las que esperaban
-- a Gerencia, las rechazadas y todas las órdenes de servicio no salían; y debajo
-- había una lista suelta de los PDF que adjunta Logística, cada uno con el tipo
-- que se eligió a mano, sin decir a qué compra ni en qué paso iba.
--
-- Desde aquí:
--   * `trazabilidad_de_compras()` da una fila por OC y por OS con lo que la
--     cuenta entera: el RQ o la OT de donde salió, el código interno, el
--     proveedor, el total impreso, la aprobación, en qué va (recojo, almacén,
--     ejecución), sus facturas con lo pagado y cada voucher, los pagos de la OS,
--     los PDF que adjuntó Logística y la guía de remisión. La lee quien ya ve
--     Adquisiciones (`adquisiciones.ver`: Contabilidad, Tesorería, Logística y
--     Gerencia), igual que las demás funciones de la pantalla;
--   * los archivos que esa fila nombra se abren con la sesión de quien mira, así
--     que las políticas de los PDF de Logística y de los pagos de la OS aceptan
--     también `adquisiciones.ver`: quien ve la fila abre lo que nombra. Los PDF
--     de Logística ya los abría quien tenía `compras.ver`; los pagos de la OS,
--     Contabilidad no los veía, porque no paga servicios ni lee los documentos
--     de Tesorería;
--   * el peso y el lugar en la lista del conductor salen solo para quien lleva
--     el recojo o carga la guía (la lista la leen Logística y el conductor,
--     migración 20261020171000); a Tesorería y a Gerencia les salen vacíos;
--   * la cotización del proveedor se adjunta con su propio tipo. Hasta aquí iba
--     como «Orden de compra» u «Otro», y en la captura del 2026-10-20 una misma
--     compra tenía tres PDF «Orden de compra»: dos eran la cotización.
--
-- Sin DROP de funciones ni de políticas: el conector de producción no deja
-- pasar ninguno. Las políticas se cambian con `alter policy`.
-- =============================================================================

-- 1. La cotización, con su tipo -------------------------------------------------------
do $$ begin
  if exists (select 1 from pg_constraint where conname = 'ck_documentos_compra_material_tipo'
               and conrelid = 'public.documentos_compra_material'::regclass
               and pg_get_constraintdef(oid) not like '%COTIZACION%') then
    alter table public.documentos_compra_material drop constraint ck_documentos_compra_material_tipo;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_documentos_compra_material_tipo'
                   and conrelid = 'public.documentos_compra_material'::regclass) then
    alter table public.documentos_compra_material add constraint ck_documentos_compra_material_tipo
      check (tipo in ('COTIZACION', 'ORDEN_COMPRA', 'ORDEN_PAGO', 'ORDEN_SERVICIO', 'FACTURA', 'COMPROBANTE', 'OTRO'));
  end if;
end $$;

-- 2. Lo que la fila nombra, lo abre quien ve Adquisiciones ------------------------------
-- Los PDF que adjunta Logística (la cotización, la factura, la boleta…): antes
-- solo Logística (compras.ver), Tesorería y Gerencia (tesoreria.ver_documentos).
alter policy ver_documentos_compra_material on public.documentos_compra_material using (
  (select public.es_admin()) or (select public.tiene_permiso('compras.ver'))
  or (select public.tiene_permiso('tesoreria.ver_documentos'))
  or (select public.tiene_permiso('adquisiciones.ver')));

alter policy mw_leer_documentos_compra on storage.objects using (
  bucket_id = 'documentos-compras' and exists (
    select 1 from public.documentos_compra_material d
     where d.ruta_storage = objects.name
       and ((select public.es_admin()) or (select public.tiene_permiso('compras.ver'))
            or (select public.tiene_permiso('tesoreria.ver_documentos'))
            or (select public.tiene_permiso('adquisiciones.ver')))));

-- Los pagos de la OS y su voucher (el voucher sigue a esta política por su
-- `exists`, migración 20261015120000): antes Contabilidad veía la OS pero no si
-- se pagó.
alter policy ver_pagos_orden_servicio on public.pagos_orden_servicio using (
  (select public.es_admin()) or (select public.tiene_permiso('tesoreria.pagar_servicios'))
  or (select public.tiene_permiso('tesoreria.ver_documentos'))
  or (select public.tiene_permiso('compras.crear'))
  or (select public.tiene_permiso('adquisiciones.ver')));

-- 3. Una fila por OC y por OS -------------------------------------------------------------
-- `pago` resume si ya se pagó:
--   PAGADA            la OC con todas sus facturas registradas pagadas y facturada
--                     entera; la OS con un pago vigente que la cancela.
--   PAGO_PARCIAL      algo pagado, falta otra parte (o falta facturar el resto).
--   POR_PAGAR         la factura está registrada (o la OS aprobada) y no hay pago.
--   POR_FACTURAR      la OC va con factura y Contabilidad todavía no registra ninguna.
--   SIN_FACTURA       la OC va con boleta, nota de venta o recibo: su pago no se
--                     registra en el sistema, solo su comprobante adjunto.
--   ESPERA_APROBACION Gerencia todavía no la aprueba.
--   NO_SE_PAGA        rechazada o anulada.
-- `total` es el impreso: la OC con IGV si va con factura (total_orden_compra) y la
-- OS con IGV, en su moneda. Las rutas de los archivos van sin firmar: la pantalla
-- firma solo las de la página que muestra, con la sesión de quien mira.
create or replace function public.trazabilidad_de_compras()
returns table (
  tipo text, id uuid, numero text, referencia text, descripcion text, creado_en timestamptz, emitido_por text,
  origen text, requerimientos jsonb, ordenes text[], codigos text[], areas text[],
  proveedor text, proveedor_id uuid, moneda text, total numeric, sin_precio boolean,
  condicion_pago text, dias_credito integer, con_factura boolean,
  aprobacion text, aprobado_en timestamptz, motivo_rechazo text,
  estado text, recojo text, entregado_almacen_en timestamptz, ingreso text,
  anulado_en timestamptz, motivo_anulacion text,
  facturado numeric, facturada_entera boolean, facturas jsonb, pagos jsonb, documentos jsonb,
  peso_kg numeric, en_lista boolean, guia jsonb, guias_anuladas integer, pago text
) language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  -- Logística, el conductor y Contabilidad, que con el peso emite la guía.
  v_recojo constant boolean := public.es_admin() or public.tiene_permiso('compras.programar_recojo')
                               or public.tiene_permiso('compras.recojo') or public.tiene_permiso('compras.guia_remision');
begin
  if not (public.es_admin() or public.tiene_permiso('adquisiciones.ver')) then
    raise exception 'Adquisiciones la ven Contabilidad, Tesorería, Logística y Gerencia.' using errcode = 'insufficient_privilege';
  end if;
  return query
  with facturada as (select * from public.compras_facturadas(null, null)),
  -- Cada factura de la OC (también la que está en borrador), con lo pagado y cada pago vigente.
  factura as (
    select l.orden_compra_id,
           jsonb_agg(jsonb_build_object(
             'id', a.id, 'numero', a.numero_documento, 'tipo', a.tipo, 'fecha', a.fecha_emision,
             'vence', a.fecha_vencimiento, 'condicion', a.condicion_pago, 'total', a.total, 'moneda', a.moneda,
             'estado', a.estado, 'parcial', l.parcial,
             'ruta', coalesce(a.ruta_storage, d.ruta_storage),
             'bucket', case when a.ruta_storage is not null then 'comprobantes-financieros'
                            when d.ruta_storage is not null then 'documentos-compras' end,
             'pagado', coalesce(p.pagado, 0), 'saldo', a.total - coalesce(p.pagado, 0),
             'pagos', coalesce(p.pagos, '[]'::jsonb))
             order by a.fecha_emision, a.numero_documento) as facturas,
           count(*) filter (where a.estado = 'REGISTRADA') as registradas,
           coalesce(bool_and(a.total - coalesce(p.pagado, 0) <= 0) filter (where a.estado = 'REGISTRADA'), false) as pagadas,
           coalesce(sum(p.pagado) filter (where a.estado = 'REGISTRADA'), 0) as pagado
      from public.adquisiciones_ordenes_compra l
      join public.adquisiciones a on a.id = l.adquisicion_id
      left join public.documentos_compra_material d on d.id = a.documento_compra_id
      left join lateral (
        select sum(x.monto) as pagado,
               jsonb_agg(jsonb_build_object('id', x.id, 'fecha', x.fecha, 'monto', x.monto,
                                            'referencia', x.referencia, 'ruta', x.archivo_ruta)
                         order by x.fecha, x.creado_en) as pagos
          from public.pagos_adquisicion x
         where x.adquisicion_id = a.id and x.anulado_en is null
      ) p on true
     where l.quitada_en is null
     group by l.orden_compra_id
  )
  select 'OC'::text, c.id, c.numero, c.referencia, null::text, c.creado_en,
         nullif(btrim(split_part(coalesce(u.nombres, ''), ' ', 1) || ' ' || split_part(coalesce(u.apellidos, ''), ' ', 1)), ''),
         c.origen,
         coalesce(rq.lista, '[]'::jsonb),
         coalesce(rv.ordenes, array[]::text[]),
         case when c.codigo_interno is not null then array[c.codigo_interno] else coalesce(rq.codigos, array[]::text[]) end,
         coalesce(rq.areas, rv.areas, array[]::text[]),
         c.proveedor, c.proveedor_id, c.moneda,
         case when c.aprobacion = 'RECHAZADA' then null else public.total_orden_compra(c.id) end,
         exists (select 1 from public.orden_compra_material_detalles x where x.orden_compra_id = c.id and x.precio_unitario is null),
         c.condicion_pago, c.dias_credito, c.con_factura,
         c.aprobacion, c.aprobado_en, c.motivo_rechazo,
         null::text, c.recojo, c.entregado_almacen_en, ig.ingreso,
         null::timestamptz, null::text,
         fd.facturado, coalesce(fd.completa or fd.facturado >= fd.total - 1, false),
         coalesce(fa.facturas, '[]'::jsonb), '[]'::jsonb, coalesce(dc.documentos, '[]'::jsonb),
         case when v_recojo then pr.peso_kg end, v_recojo and pr.posicion is not null,
         case when g.id is not null then jsonb_build_object('id', g.id, 'numero', g.numero, 'fecha', g.fecha_emision,
                                                             'nombre', g.nombre_archivo, 'cargada_en', g.cargada_en) end,
         coalesce(ga.n, 0),
         case
           when c.aprobacion = 'RECHAZADA' then 'NO_SE_PAGA'
           when c.aprobacion = 'POR_APROBAR' then 'ESPERA_APROBACION'
           when not c.con_factura then 'SIN_FACTURA'
           when coalesce(fa.registradas, 0) = 0 then 'POR_FACTURAR'
           when fa.pagadas and coalesce(fd.completa or fd.facturado >= fd.total - 1, false) then 'PAGADA'
           when fa.pagado > 0 then 'PAGO_PARCIAL'
           else 'POR_PAGAR'
         end
    from public.ordenes_compra_materiales c
    left join public.usuarios u on u.id = c.creado_por
    left join facturada fd on fd.orden_compra_id = c.id
    left join factura fa on fa.orden_compra_id = c.id
    left join public.programacion_recojo pr on pr.orden_compra_id = c.id
    left join public.guias_remision_compra g on g.orden_compra_id = c.id and g.anulada_en is null
    left join lateral (
      select count(*)::integer as n from public.guias_remision_compra a
       where a.orden_compra_id = c.id and a.anulada_en is not null
    ) ga on true
    -- El RQ nuevo (RQ-0001-2026): la OC lo atiende con alguna de sus líneas.
    left join lateral (
      select jsonb_agg(jsonb_build_object('id', x.id, 'numero', x.numero) order by x.numero) as lista,
             array_remove(array_agg(distinct x.codigo_interno), null) as codigos,
             nullif(array_remove(array_agg(distinct x.area), null), array[]::text[]) as areas
        from (select distinct r.id, r.numero, r.codigo_interno, ar.nombre as area
                from public.requerimiento_lineas rl
                join public.requerimientos r on r.id = rl.requerimiento_id
                left join public.areas ar on ar.id = r.area_id
               where rl.orden_compra_id = c.id) x
    ) rq on true
    -- El RQ de antes, por OT y área: en la cabecera o en cada línea.
    left join lateral (
      select array_remove(array_agg(distinct o.numero), null) as ordenes,
             nullif(array_remove(array_agg(distinct case rm.area_destino when 'MTZ' then 'Maestranza'
                                                     when 'PRD' then 'Producción' when 'ACB' then 'Acabados'
                                                     else rm.area_destino end), null), array[]::text[]) as areas
        from public.requerimientos_materiales rm
        left join public.ordenes_trabajo o on o.id = rm.orden_id
       where rm.id = c.requerimiento_id
          or rm.id in (select x.requerimiento_id from public.orden_compra_material_detalles x where x.orden_compra_id = c.id)
    ) rv on true
    left join lateral (
      select case when bool_or(i.estado = 'OBSERVADO') then 'OBSERVADO'
                  when bool_or(i.estado = 'PENDIENTE') then 'PENDIENTE'
                  when count(*) > 0 then 'VALIDADO' end as ingreso
        from public.ingresos_pendientes_almacen i where i.orden_compra_id = c.id
    ) ig on true
    left join lateral (
      select jsonb_agg(jsonb_build_object('id', d.id, 'tipo', d.tipo, 'nombre', d.nombre_archivo, 'ruta', d.ruta_storage,
                                          'numero', d.numero_documento, 'creado_en', d.creado_en)
                       order by d.creado_en) as documentos
        from public.documentos_compra_material d where d.orden_compra_id = c.id
    ) dc on true

  union all

  select 'OS'::text, s.id, s.numero, s.referencia, s.descripcion, s.creado_en,
         nullif(btrim(split_part(coalesce(u.nombres, ''), ' ', 1) || ' ' || split_part(coalesce(u.apellidos, ''), ' ', 1)), ''),
         null::text, '[]'::jsonb,
         case when o.numero is not null then array[o.numero] else array[]::text[] end,
         case when s.codigo_interno is not null then array[s.codigo_interno] else array[]::text[] end,
         case when ar.nombre is not null then array[ar.nombre] else array[]::text[] end,
         s.proveedor, s.proveedor_id, s.moneda, round(s.monto * 1.18, 2), false,
         s.condicion_pago, s.dias_credito, null::boolean,
         s.aprobacion, s.aprobado_en, s.motivo_rechazo,
         s.estado, null::text, null::timestamptz, null::text,
         s.anulado_en, s.motivo_anulacion,
         null::numeric, null::boolean, '[]'::jsonb, coalesce(ps.pagos, '[]'::jsonb), '[]'::jsonb,
         null::numeric, false, null::jsonb, 0,
         case
           when s.estado = 'ANULADA' or s.aprobacion = 'RECHAZADA' then 'NO_SE_PAGA'
           when s.aprobacion = 'POR_APROBAR' then 'ESPERA_APROBACION'
           when ps.cancela then 'PAGADA'
           when ps.n > 0 then 'PAGO_PARCIAL'
           else 'POR_PAGAR'
         end
    from public.ordenes_servicio s
    left join public.usuarios u on u.id = s.creado_por
    left join public.ordenes_trabajo o on o.id = s.orden_id
    left join public.areas ar on ar.id = s.area_id
    left join lateral (
      select count(*) as n, coalesce(bool_or(x.cancela), false) as cancela,
             jsonb_agg(jsonb_build_object('id', x.id, 'fecha', x.fecha_pago, 'monto', x.monto, 'moneda', x.moneda,
                                          'cancela', x.cancela, 'operacion', x.operacion,
                                          'comprobante', x.comprobante_proveedor, 'ruta', x.archivo_ruta)
                       order by x.fecha_pago, x.creado_en) as pagos
        from public.pagos_orden_servicio x
       where x.orden_servicio_id = s.id and x.anulado_en is null
    ) ps on true

   order by 6 desc, 2;
end;
$$;
comment on function public.trazabilidad_de_compras() is
  'Una fila por OC y por OS: de dónde salió (RQ, OT, código interno), el proveedor, el total impreso, la aprobación, en qué va, sus facturas y pagos con la ruta de cada archivo, los PDF de Logística y la guía de remisión. Exige adquisiciones.ver.';
revoke all on function public.trazabilidad_de_compras() from public, anon;
grant execute on function public.trazabilidad_de_compras() to authenticated;
