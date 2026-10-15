-- =============================================================================
-- LAS ÓRDENES DE SERVICIO ENTRAN AL COSTEO DE SU CÓDIGO INTERNO
-- -----------------------------------------------------------------------------
-- Desde la migración 20261015141000 cada orden de servicio lleva el código
-- interno de la unidad. Faltaba que su costo apareciera en el costeo que
-- Gerencia ve de ese código («Códigos internos», migración 20261014220000).
--
-- Un servicio no es como una compra. Lo comprado entra al almacén y se cuenta
-- cuando sale para el código; contarlo también al comprar lo sumaría dos
-- veces. El servicio no pasa por el almacén: el torno, la pintura o el flete se
-- hacen para esa unidad y su costo es de ella. Por eso el servicio sí se suma:
--   * SERVICIOS: la OS aprobada por Gerencia (emitida, en ejecución o
--     conforme). Es un costo comprometido y entra al total del código.
--   * SERVICIOS_POR_APROBAR: la OS que espera a Gerencia. Se muestra aparte y
--     no se suma hasta que la aprueben.
--   * La rechazada y la anulada no aparecen: no costaron nada.
-- El monto es el de la OS sin IGV, en su moneda: el IGV es crédito fiscal y
-- la detracción es parte del pago al proveedor, no un costo más. Los dólares
-- van aparte, sin cambio, igual que los materiales.
--
-- Las líneas de las OS se arman en una sola función interna, que usan el
-- costeo de cada código y la lista de todos. Así las dos pantallas dicen lo
-- mismo. El resumen de la lista no puede cambiar sus columnas sin borrarlo, y
-- el conector de producción no deja borrar: los servicios van en una función
-- aparte, `codigos_internos_servicios`.
--
-- El gasto por código de Requerimientos (migración 20261015160000) no cambia:
-- ve los materiales y las compras, como antes. Su lista de códigos se filtra
-- por esas mismas fuentes para que una OS no la mueva.
--
-- Nada se borra ni se reemplaza por otra firma: el conector de producción no lo deja pasar.
-- =============================================================================

-- 1. Las líneas de las órdenes de servicio de un código (o de todos) -------------------
-- No pide permiso: solo la llaman las funciones de abajo, que piden el suyo.
create or replace function public.codigo_interno_lineas_servicio(p_codigo text)
returns table (codigo text, fuente text, fecha date, concepto text, detalle text, cantidad numeric, unidad text,
               horas numeric, precio_unitario numeric, moneda text, monto numeric, sin_precio integer,
               documento text, referencia_id uuid)
language sql stable set search_path to 'public' as $$
  select public.normalizar_codigo_interno(s.codigo_interno),
         case when s.aprobacion = 'APROBADA' then 'SERVICIOS' else 'SERVICIOS_POR_APROBAR' end,
         (s.creado_en at time zone 'America/Lima')::date,
         s.descripcion::text, s.proveedor::text, 1::numeric, 'servicio'::text, null::numeric,
         s.monto, s.moneda::text, s.monto, 0, s.numero::text, s.id
    from public.ordenes_servicio s
   where s.codigo_interno is not null
     and s.estado <> 'ANULADA' and s.aprobacion <> 'RECHAZADA'
     and (public.normalizar_codigo_interno(p_codigo) is null
          or public.normalizar_codigo_interno(s.codigo_interno) = public.normalizar_codigo_interno(p_codigo))
$$;
comment on function public.codigo_interno_lineas_servicio(text) is
  'Las órdenes de servicio de un código interno (o de todos) como líneas del costeo: SERVICIOS si Gerencia la aprobó, SERVICIOS_POR_APROBAR si espera. Sin IGV, en su moneda. Sin las rechazadas ni las anuladas. No pide permiso: la llaman codigo_interno_lineas y codigos_internos_servicios.';
revoke all on function public.codigo_interno_lineas_servicio(text) from public, anon, authenticated;

-- 2. El costeo de cada código suma sus órdenes de servicio ------------------------------
-- La misma función de la migración 20261015160000, con las OS al final.
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
   order by 1, 3 desc, 2, 4;
end;
$$;
comment on function public.codigo_interno_lineas(text, boolean) is
  'Las líneas del costeo de un código interno (o de todos), sin pedir permiso: mano de obra, materiales, compras (no van al total) y órdenes de servicio. Solo la llaman codigo_interno_costeo (Gerencia), codigo_interno_gasto y codigos_internos_gasto (Requerimientos, sin los servicios) y codigo_interno_compras.';
revoke all on function public.codigo_interno_lineas(text, boolean) from public, anon, authenticated;

-- 3. La lista de Requerimientos sigue con materiales y compras ---------------------------
create or replace function public.codigos_internos_gasto()
returns table (codigo text, requerimientos integer, compras integer, salidas integer, ultima_actividad date,
               materiales_pen numeric, materiales_usd numeric, materiales_sin_precio integer,
               compras_pen numeric, compras_usd numeric, compras_sin_precio integer)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  perform public.exigir_permiso('codigos_internos.gasto');
  return query
  with lineas as (
    select * from public.codigo_interno_lineas(null, false) k
     where k.fuente in ('MATERIALES', 'MATERIALES_SIN_PRECIO', 'COMPRAS')
  ), por_gasto as (
    select k.codigo,
           count(*) filter (where k.fuente = 'COMPRAS')::integer as compras,
           count(*) filter (where k.fuente in ('MATERIALES', 'MATERIALES_SIN_PRECIO'))::integer as salidas,
           coalesce(sum(k.monto) filter (where k.fuente = 'MATERIALES' and k.moneda = 'PEN'), 0)::numeric as materiales_pen,
           coalesce(sum(k.monto) filter (where k.fuente = 'MATERIALES' and k.moneda = 'USD'), 0)::numeric as materiales_usd,
           count(*) filter (where k.fuente = 'MATERIALES_SIN_PRECIO')::integer as materiales_sin_precio,
           coalesce(sum(k.monto) filter (where k.fuente = 'COMPRAS' and k.moneda = 'PEN'), 0)::numeric as compras_pen,
           coalesce(sum(k.monto) filter (where k.fuente = 'COMPRAS' and k.moneda = 'USD'), 0)::numeric as compras_usd,
           coalesce(sum(k.sin_precio) filter (where k.fuente = 'COMPRAS'), 0)::integer as compras_sin_precio,
           max(k.fecha) as ultima
      from lineas k group by k.codigo
  ), por_rq as (
    select public.normalizar_codigo_interno(r.codigo_interno) as codigo,
           count(*) filter (where r.estado <> 'ANULADO')::integer as requerimientos,
           max((r.creado_en at time zone 'America/Lima')::date) as ultima
      from public.requerimientos r
     group by 1
  ), codigos as (
    select g.codigo from por_gasto g union select q.codigo from por_rq q
  )
  select c.codigo, coalesce(q.requerimientos, 0), coalesce(g.compras, 0), coalesce(g.salidas, 0),
         greatest(g.ultima, q.ultima),
         coalesce(g.materiales_pen, 0), coalesce(g.materiales_usd, 0), coalesce(g.materiales_sin_precio, 0),
         coalesce(g.compras_pen, 0), coalesce(g.compras_usd, 0), coalesce(g.compras_sin_precio, 0)
    from codigos c
    left join por_gasto g on g.codigo = c.codigo
    left join por_rq q on q.codigo = c.codigo
   where c.codigo is not null
   order by 5 desc nulls last, 1;
end;
$$;
comment on function public.codigos_internos_gasto() is
  'Todos los códigos internos con lo que se gastó en cada uno: materiales salidos del almacén y compras (aparte), y cuántos requerimientos lo piden. Sin mano de obra. Exige codigos_internos.gasto.';
revoke all on function public.codigos_internos_gasto() from public, anon;
grant execute on function public.codigos_internos_gasto() to authenticated;

-- 4. Los servicios de cada código, para la lista de Gerencia ------------------------------
create or replace function public.codigos_internos_servicios()
returns table (codigo text, servicios integer, servicios_pen numeric, servicios_usd numeric,
               por_aprobar integer, por_aprobar_pen numeric, por_aprobar_usd numeric)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  perform public.exigir_permiso('codigos_internos.ver');
  return query
  select k.codigo,
         count(*) filter (where k.fuente = 'SERVICIOS')::integer,
         coalesce(sum(k.monto) filter (where k.fuente = 'SERVICIOS' and k.moneda = 'PEN'), 0)::numeric,
         coalesce(sum(k.monto) filter (where k.fuente = 'SERVICIOS' and k.moneda = 'USD'), 0)::numeric,
         count(*) filter (where k.fuente = 'SERVICIOS_POR_APROBAR')::integer,
         coalesce(sum(k.monto) filter (where k.fuente = 'SERVICIOS_POR_APROBAR' and k.moneda = 'PEN'), 0)::numeric,
         coalesce(sum(k.monto) filter (where k.fuente = 'SERVICIOS_POR_APROBAR' and k.moneda = 'USD'), 0)::numeric
    from public.codigo_interno_lineas_servicio(null) k
   where k.codigo is not null
   group by k.codigo
   order by 1;
end;
$$;
comment on function public.codigos_internos_servicios() is
  'Por cada código interno, sus órdenes de servicio aprobadas (van al costo) y las que esperan a Gerencia (aparte), sin IGV y por moneda. Las mismas líneas que el costeo del código. Exige codigos_internos.ver.';
revoke all on function public.codigos_internos_servicios() from public, anon;
grant execute on function public.codigos_internos_servicios() to authenticated;
