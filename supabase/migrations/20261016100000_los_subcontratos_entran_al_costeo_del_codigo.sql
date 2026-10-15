-- =============================================================================
-- LOS SUBCONTRATOS ENTRAN AL COSTEO DE SU CÓDIGO INTERNO
-- -----------------------------------------------------------------------------
-- Gerencia lo pidió el 2026-10-15: en «Códigos internos» ve todo lo de cada
-- unidad. Desde la migración 20261015221000 Administración registra cada
-- subcontrato con el código interno de la unidad (o PLANTA) y sube sus recibos
-- por honorarios, y Tesorería los paga con su voucher. Faltaba que ese costo
-- apareciera en el costeo del código.
--
-- Un subcontrato es como una orden de servicio: el trabajo lo hace alguien de
-- fuera para esa unidad y no pasa por el almacén, así que su costo es de ella.
-- Lo que se suma es cada RECIBO POR HONORARIOS vigente, por su monto BRUTO:
-- es lo que cuesta el trabajo; la retención de cuarta categoría es parte de
-- los honorarios, que Tesorería entrega a SUNAT en vez de al subcontratista.
--   * SUBCONTRATOS: el recibo que Tesorería ya pagó.
--   * SUBCONTRATOS_POR_PAGAR: el recibo que espera su pago. También suma: el
--     recibo ya se emitió y se debe, igual que la OS aprobada que todavía no
--     se paga. Se muestra aparte para que Gerencia sepa cuánto falta pagar.
--   * El recibo anulado no aparece. Un subcontrato sin recibos todavía no
--     costó nada: lo pactado se ve en la pantalla de Subcontratos.
-- En su moneda, sin cambio, como los materiales y los servicios.
--
-- Las líneas salen de una función interna que usan el costeo de cada código y
-- la lista de todos, para que las dos pantallas digan lo mismo. Igual que con
-- los servicios, el resumen de la lista no puede cambiar sus columnas sin
-- borrarlo, y el conector de producción no deja borrar: lo de cada código va
-- en una función aparte, `codigos_internos_subcontratos`.
--
-- El gasto por código de Requerimientos no cambia: sigue viendo solo los
-- materiales y las compras, porque filtra las líneas por su fuente.
--
-- Nada se borra ni se reemplaza por otra firma: el conector de producción no lo deja pasar.
-- =============================================================================

-- 1. Los recibos por honorarios de un código (o de todos) ------------------------------
-- No pide permiso: solo la llaman las funciones de abajo, que piden el suyo.
create or replace function public.codigo_interno_lineas_subcontrato(p_codigo text)
returns table (codigo text, fuente text, fecha date, concepto text, detalle text, cantidad numeric, unidad text,
               horas numeric, precio_unitario numeric, moneda text, monto numeric, sin_precio integer,
               documento text, referencia_id uuid)
language sql stable set search_path to 'public' as $$
  select public.normalizar_codigo_interno(s.codigo_interno),
         case when p.id is null then 'SUBCONTRATOS_POR_PAGAR' else 'SUBCONTRATOS' end,
         r.fecha_emision,
         coalesce(nullif(btrim(r.concepto), ''), s.descripcion)::text,
         (s.numero || ' · ' || x.nombre)::text,
         1::numeric, 'recibo'::text, null::numeric,
         r.monto_bruto, r.moneda::text, r.monto_bruto, 0, r.numero::text, r.id
    from public.recibos_honorarios r
    join public.subcontratos s on s.id = r.subcontrato_id
    join public.subcontratistas x on x.id = s.subcontratista_id
    left join public.pagos_recibo_honorarios p on p.recibo_id = r.id and p.anulado_en is null
   where r.anulado_en is null
     and (public.normalizar_codigo_interno(p_codigo) is null
          or public.normalizar_codigo_interno(s.codigo_interno) = public.normalizar_codigo_interno(p_codigo))
$$;
comment on function public.codigo_interno_lineas_subcontrato(text) is
  'Los recibos por honorarios vigentes de los subcontratos de un código interno (o de todos) como líneas del costeo, por su monto bruto y en su moneda: SUBCONTRATOS si Tesorería ya lo pagó, SUBCONTRATOS_POR_PAGAR si no. Los dos suman al costo. Sin los anulados. No pide permiso: la llaman codigo_interno_lineas y codigos_internos_subcontratos.';
revoke all on function public.codigo_interno_lineas_subcontrato(text) from public, anon, authenticated;

-- 2. El costeo de cada código suma los recibos de sus subcontratos ---------------------
-- La misma función de la migración 20261015180000, con los subcontratos al final.
create or replace function public.codigo_interno_lineas(p_codigo text, p_mano_obra boolean)
returns table (codigo text, fuente text, fecha date, concepto text, detalle text, cantidad numeric, unidad text,
               horas numeric, precio_unitario numeric, moneda text, monto numeric, sin_precio integer,
               documento text, referencia_id uuid)
language plpgsql stable set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_codigo text := public.normalizar_codigo_interno(p_codigo);
begin
  return query
  with tareo as (
    select public.normalizar_codigo_interno(t.codigo_interno) as codigo, t.fecha, t.horas, t.costo, t.trabajador_id,
           l.reporte_id, l.trabajo_id, case when l.id is null then t.labor end as labor
      from public.tareos t
      left join public.reporte_diario_personal l on l.id = t.reporte_linea_id
     where p_mano_obra and t.anulado_en is null
  ), espera as (
    -- Una línea de un reporte vigente que no tiene tareo: su persona no tiene costo mensual.
    select public.normalizar_codigo_interno(r.codigo_interno) as codigo, l.fecha, l.horas, l.trabajador_id,
           l.reporte_id, l.trabajo_id, null::text as labor
      from public.reporte_diario_personal l
      join public.reportes_diarios r on r.id = l.reporte_id
     where p_mano_obra and r.anulado_en is null
       and not exists (select 1 from public.tareos t where t.reporte_linea_id = l.id)
  ), horas as (
    select 'MANO_OBRA'::text as fuente, x.codigo, x.fecha, x.horas, x.costo, x.trabajador_id, x.reporte_id, x.trabajo_id, x.labor from tareo x
    union all
    select 'MANO_OBRA_SIN_COSTO', e.codigo, e.fecha, e.horas, null::numeric, e.trabajador_id, e.reporte_id, e.trabajo_id, e.labor from espera e
  ), salida as (
    select m.id, m.registrado_en, m.material_id, m.precio_unitario, m.moneda, m.documento_referencia, rq.numero as rq_numero,
           public.normalizar_codigo_interno(coalesce(m.codigo_interno, rq.codigo_interno, u.codigo_interno, uo.codigo_interno,
                                                     case when m.unidad_id is null then m.codigo_unidad end)) as codigo,
           greatest(m.cantidad - coalesce((select sum(x.cantidad) from public.movimientos_materiales x
                                            where x.devolucion_de = m.id), 0), 0)::numeric as cantidad
      from public.movimientos_materiales m
      left join public.requerimiento_lineas rl on rl.id = m.requerimiento_linea_id
      left join public.requerimientos rq on rq.id = rl.requerimiento_id
      left join public.unidades u on u.id = m.unidad_id
      left join public.ordenes_trabajo ot on ot.id = m.orden_id
      left join public.unidades uo on uo.id = ot.unidad_id
     where m.tipo in ('SALIDA', 'DESPACHO')
  ), valorizada as (
    -- El mismo orden que el costeo de la OT: precio congelado, último ingreso con
    -- precio hasta ese día, y el precio que fijó Logística (el vigente ese día, o
    -- el primero después).
    select s.*,
           coalesce(s.precio_unitario, ing.precio_unitario, val.precio)::numeric as precio,
           case when s.precio_unitario is not null then coalesce(s.moneda, ing.moneda, val.moneda)
                when ing.precio_unitario is not null then ing.moneda
                else val.moneda end as moneda_val
      from salida s
      left join lateral (
        select i.precio_unitario, i.moneda from public.movimientos_materiales i
         where i.material_id = s.material_id and i.tipo = 'INGRESO' and i.precio_unitario is not null
           and i.moneda in ('PEN', 'USD') and i.registrado_en <= s.registrado_en
         order by i.registrado_en desc, i.id
         limit 1) ing on true
      left join lateral (
        select v.precio, v.moneda from public.valorizaciones_material v
         where v.material_id = s.material_id
         order by (v.vigente_desde > s.registrado_en),
                  case when v.vigente_desde <= s.registrado_en then v.vigente_desde end desc nulls last,
                  v.vigente_desde, v.id
         limit 1) val on true
     where s.codigo is not null and s.cantidad > 0
       and (v_codigo is null or s.codigo = v_codigo)
  ), compra as (
    select public.normalizar_codigo_interno(c.codigo_interno) as codigo, c.id, coalesce(c.numero, c.referencia) as numero,
           (c.creado_en at time zone 'America/Lima')::date as fecha, c.proveedor, c.moneda,
           coalesce(sum(d.cantidad * d.precio_unitario) filter (where d.precio_unitario is not null), 0)::numeric as monto,
           count(d.id) filter (where d.precio_unitario is null)::integer as sin_precio,
           count(d.id)::numeric as lineas
      from public.ordenes_compra_materiales c
      left join public.orden_compra_material_detalles d on d.orden_compra_id = c.id
     where c.codigo_interno is not null and c.aprobacion <> 'RECHAZADA'
     group by c.id
  )
  select h.codigo, h.fuente, h.fecha,
         coalesce(tr.descripcion, case when h.reporte_id is not null then 'Personal general del reporte' end,
                  h.labor, 'Horas cargadas por Recursos Humanos')::text,
         coalesce(rd.asunto, 'Cargadas por Recursos Humanos')::text,
         count(distinct h.trabajador_id)::numeric,
         case when count(distinct h.trabajador_id) = 1 then 'persona' else 'personas' end::text,
         sum(h.horas)::numeric, null::numeric, 'PEN'::text,
         case when h.fuente = 'MANO_OBRA' then round(sum(h.costo), 2) end,
         0, null::text, h.reporte_id
    from horas h
    left join public.reporte_diario_trabajos tr on tr.id = h.trabajo_id
    left join public.reportes_diarios rd on rd.id = h.reporte_id
   where h.codigo is not null and (v_codigo is null or h.codigo = v_codigo)
   group by h.codigo, h.fuente, h.fecha, h.reporte_id, h.trabajo_id, h.labor, tr.descripcion, rd.asunto
  union all
  select v.codigo, case when v.precio is null then 'MATERIALES_SIN_PRECIO' else 'MATERIALES' end,
         (v.registrado_en at time zone 'America/Lima')::date, mat.descripcion::text, v.documento_referencia::text,
         v.cantidad, um.codigo::text, null::numeric, v.precio, v.moneda_val::text,
         case when v.precio is null then null else round(v.cantidad * v.precio, 2) end,
         case when v.precio is null then 1 else 0 end, v.rq_numero::text, v.id
    from valorizada v
    join public.materiales mat on mat.id = v.material_id
    left join public.unidades_medida um on um.id = mat.unidad_medida_id
  union all
  select c.codigo, 'COMPRAS', c.fecha, c.proveedor::text, null::text, c.lineas,
         case when c.lineas = 1 then 'línea' else 'líneas' end::text, null::numeric, null::numeric, c.moneda::text,
         round(c.monto, 2), c.sin_precio, c.numero::text, c.id
    from compra c
   where c.codigo is not null and (v_codigo is null or c.codigo = v_codigo)
  union all
  select * from public.codigo_interno_lineas_servicio(v_codigo)
  union all
  select * from public.codigo_interno_lineas_subcontrato(v_codigo)
   order by 1, 3 desc, 2, 4;
end;
$$;
comment on function public.codigo_interno_lineas(text, boolean) is
  'Las líneas del costeo de un código interno (o de todos), sin pedir permiso: mano de obra, materiales, compras (no van al total), órdenes de servicio y recibos por honorarios de los subcontratos. Solo la llaman codigo_interno_costeo (Gerencia), codigo_interno_gasto y codigos_internos_gasto (Requerimientos, sin los servicios ni los subcontratos) y codigo_interno_compras.';
revoke all on function public.codigo_interno_lineas(text, boolean) from public, anon, authenticated;

-- 3. Gerencia lee lo mismo, por su puerta ---------------------------------------------------
comment on function public.codigo_interno_costeo(text) is
  'Las líneas del costeo de un código interno (o de todos): mano de obra con y sin costo, materiales con y sin precio, compras (no van al total), órdenes de servicio y recibos por honorarios de los subcontratos. Exige codigos_internos.ver.';

-- 4. Los subcontratos de cada código, para la lista de Gerencia ----------------------------
create or replace function public.codigos_internos_subcontratos()
returns table (codigo text, recibos integer, subcontratos_pen numeric, subcontratos_usd numeric,
               por_pagar integer, por_pagar_pen numeric, por_pagar_usd numeric)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  perform public.exigir_permiso('codigos_internos.ver');
  return query
  select k.codigo,
         count(*)::integer,
         coalesce(sum(k.monto) filter (where k.moneda = 'PEN'), 0)::numeric,
         coalesce(sum(k.monto) filter (where k.moneda = 'USD'), 0)::numeric,
         count(*) filter (where k.fuente = 'SUBCONTRATOS_POR_PAGAR')::integer,
         coalesce(sum(k.monto) filter (where k.fuente = 'SUBCONTRATOS_POR_PAGAR' and k.moneda = 'PEN'), 0)::numeric,
         coalesce(sum(k.monto) filter (where k.fuente = 'SUBCONTRATOS_POR_PAGAR' and k.moneda = 'USD'), 0)::numeric
    from public.codigo_interno_lineas_subcontrato(null) k
   where k.codigo is not null
   group by k.codigo
   order by 1;
end;
$$;
comment on function public.codigos_internos_subcontratos() is
  'Por cada código interno, sus recibos por honorarios vigentes (todos suman al costo, por su bruto y en su moneda) y cuántos esperan el pago de Tesorería. Las mismas líneas que el costeo del código. Exige codigos_internos.ver.';
revoke all on function public.codigos_internos_subcontratos() from public, anon;
grant execute on function public.codigos_internos_subcontratos() to authenticated;
