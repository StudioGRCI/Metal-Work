-- Mantiene el historial de las OT anuladas fuera de la cola operativa.
create or replace view public.v_atencion_materiales with (security_invoker = true) as
SELECT r.id AS requerimiento_id,
    d.id AS detalle_id,
    r.orden_id,
    o.numero AS numero_ot,
    r.area_destino,
    d.ot_material_id,
    p.numero_plano,
    p.nombre AS plano,
    m.material_id,
    mat.codigo AS material_codigo,
    mat.descripcion AS material,
    um.codigo AS unidad,
    d.cantidad_solicitada,
    COALESCE(compra.cantidad_comprada, 0::numeric)::cantidad AS cantidad_comprada,
    COALESCE(mov.cantidad_recibida, 0::numeric)::cantidad AS cantidad_recibida,
    COALESCE(mov.cantidad_despachada, 0::numeric)::cantidad AS cantidad_despachada,
        CASE
            WHEN COALESCE(mov.cantidad_despachada, 0::numeric) >= d.cantidad_solicitada::numeric THEN 'ATENDIDO'::text
            WHEN COALESCE(mov.cantidad_recibida, 0::numeric) > COALESCE(mov.cantidad_despachada, 0::numeric) THEN 'EN_ALMACEN'::text
            WHEN COALESCE(compra.cantidad_comprada, 0::numeric) > COALESCE(mov.cantidad_recibida, 0::numeric) THEN 'EN_COMPRA'::text
            ELSE 'SOLICITADO'::text
        END AS estado,
    COALESCE(entrega.responsables, ''::text) AS responsables,
    r.solicitado_por,
    r.creado_en
   FROM requerimientos_materiales r
     JOIN requerimiento_material_detalles d ON d.requerimiento_id = r.id
     JOIN ot_materiales m ON m.id = d.ot_material_id
     JOIN materiales mat ON mat.id = m.material_id
     LEFT JOIN unidades_medida um ON um.id = mat.unidad_medida_id
     JOIN ordenes_trabajo o ON o.id = r.orden_id
     LEFT JOIN ot_planos p ON p.id = m.plano_id
     LEFT JOIN LATERAL ( SELECT sum(ocd.cantidad::numeric) AS cantidad_comprada
           FROM orden_compra_material_detalles ocd
          WHERE ocd.requerimiento_detalle_id = d.id) compra ON true
     LEFT JOIN LATERAL ( SELECT sum(x.cantidad::numeric) FILTER (WHERE x.tipo = 'INGRESO'::text) AS cantidad_recibida,
            sum(x.cantidad::numeric) FILTER (WHERE x.tipo = 'DESPACHO'::text) AS cantidad_despachada
           FROM movimientos_materiales x
          WHERE x.requerimiento_detalle_id = d.id) mov ON true
     LEFT JOIN LATERAL ( SELECT string_agg(DISTINCT (u.nombres || ' '::text) || u.apellidos, ', '::text ORDER BY ((u.nombres || ' '::text) || u.apellidos)) AS responsables
           FROM movimientos_materiales x
             JOIN usuarios u ON u.id = x.responsable_id
          WHERE x.requerimiento_detalle_id = d.id AND x.tipo = 'DESPACHO'::text) entrega ON true
where o.estado::text <> 'ANULADA';
