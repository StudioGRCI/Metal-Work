-- =============================================================================
-- REQUERIMIENTOS VE EL GASTO DE CADA CÓDIGO INTERNO, NO EL KARDEX NI LOS COSTOS
-- -----------------------------------------------------------------------------
-- La cuenta de Requerimientos nació de la de Costos y Materiales y se llevó lo
-- que esa veía (migración 20261012141000): el kardex, los gastos del mes, la
-- valorización del almacén y el costo de cada OT. Gerencia pidió (2026-10-14)
-- que Requerimientos deje de ver el kardex, los gastos del mes y la
-- valorización: no es su trabajo. Lo que sí tiene que ver es lo que se gastó en
-- cada código interno, que es para lo que pide los insumos.
--
--   * Requerimientos pierde `almacen.ver` (el kardex, sus cuatro almacenes, los
--     saldos y la valorización) y `costos.ver` (los gastos del mes, el costo de
--     cada OT y la valorización). No es solo el menú: la pantalla y la base
--     dejan de dárselo.
--   * Gana `codigos_internos.gasto`: por cada código interno, lo que salió del
--     almacén para él, a su precio, y las órdenes de compra que lo llevan. Sin
--     la mano de obra: las horas y lo que cuestan son de RR. HH. y Gerencia.
--     Las compras se muestran y no se suman, con la misma regla que Gerencia:
--     lo comprado entra al almacén y se cuenta cuando sale para el código.
--   * Los gastos del mes (luz, agua, depreciación) no se anotan por código:
--     se reparten entre las OT. Por eso no entran en el gasto por código.
--   * El costeo de los códigos de Gerencia (migración 20261014220000) se parte
--     en dos: las líneas se arman en una sola función interna y cada pantalla
--     las pide por su puerta. Así Gerencia y Requerimientos no pueden decir
--     números distintos de un mismo código.
--   * Requerimientos conserva lo que hace en la OT por la cuenta de Costos: la
--     ficha vehicular de la entrega y la solicitud de pago a Tesorería. Esa
--     solicitud solo la dejaba leer `costos.ver`: quien la manda ahora la ve
--     con `costos.solicitar_pago`, o la mandaría y no la vería.
--
-- Sin DROP: el conector de producción no deja pasar ninguno.
-- =============================================================================

-- 1. El permiso del gasto por código, para Requerimientos -------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('codigos_internos.gasto', 'Costos',
   'Consultar lo que se gastó en cada código interno: materiales salidos del almacén y compras, sin la mano de obra')
on conflict (codigo) do nothing;

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, 'codigos_internos.gasto' from public.roles r where r.codigo = 'REQUERIMIENTOS'
on conflict do nothing;

-- 2. Requerimientos deja de ver el kardex y los costos ---------------------------------
delete from public.roles_permisos rp
 using public.roles r
 where rp.rol_id = r.id
   and r.codigo = 'REQUERIMIENTOS'
   and rp.permiso_codigo in ('almacen.ver', 'costos.ver');

-- 3. Quien manda la solicitud de pago a Tesorería la ve ---------------------------------
alter policy ver_solicitudes_tesoreria on public.ot_solicitudes_tesoreria using (
  public.puede_ver_orden(orden_id)
  and (public.tiene_permiso('costos.ver') or public.tiene_permiso('costos.solicitar_pago')
       or public.tiene_permiso('tesoreria.ver_documentos') or public.es_admin())
);

-- 4. Las líneas del costeo de un código, una sola vez -----------------------------------
-- Lo mismo que armaba `codigo_interno_costeo`, sin pedir permiso: no la ejecuta
-- nadie de afuera, solo las funciones de abajo, que piden cada una el suyo.
-- Con p_mano_obra = false no arma las horas: el gasto por código no las lleva.
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
   order by 1, 3 desc, 2, 4;
end;
$$;
comment on function public.codigo_interno_lineas(text, boolean) is
  'Las líneas del costeo de un código interno (o de todos), sin pedir permiso. Solo la llaman codigo_interno_costeo (Gerencia) y codigo_interno_gasto (Requerimientos), que piden cada una el suyo.';
revoke all on function public.codigo_interno_lineas(text, boolean) from public, anon, authenticated;

-- 5. Gerencia sigue pidiendo lo mismo, por su puerta --------------------------------------
create or replace function public.codigo_interno_costeo(p_codigo text default null)
returns table (codigo text, fuente text, fecha date, concepto text, detalle text, cantidad numeric, unidad text,
               horas numeric, precio_unitario numeric, moneda text, monto numeric, sin_precio integer,
               documento text, referencia_id uuid)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  perform public.exigir_permiso('codigos_internos.ver');
  return query select * from public.codigo_interno_lineas(p_codigo, true);
end;
$$;
comment on function public.codigo_interno_costeo(text) is
  'Las líneas del costeo de un código interno (o de todos): mano de obra con y sin costo, materiales con y sin precio, y compras, que no van al total. Exige codigos_internos.ver.';
revoke all on function public.codigo_interno_costeo(text) from public, anon;
grant execute on function public.codigo_interno_costeo(text) to authenticated;

-- 6. El gasto de un código para Requerimientos: materiales y compras -----------------------
create or replace function public.codigo_interno_gasto(p_codigo text default null)
returns table (codigo text, fuente text, fecha date, concepto text, detalle text, cantidad numeric, unidad text,
               horas numeric, precio_unitario numeric, moneda text, monto numeric, sin_precio integer,
               documento text, referencia_id uuid)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  perform public.exigir_permiso('codigos_internos.gasto');
  return query select * from public.codigo_interno_lineas(p_codigo, false) k
                where k.fuente in ('MATERIALES', 'MATERIALES_SIN_PRECIO', 'COMPRAS');
end;
$$;
comment on function public.codigo_interno_gasto(text) is
  'Lo que se gastó en un código interno (o en todos): cada salida del almacén con su precio y cada orden de compra sin IGV, que no va al total. Sin mano de obra. Exige codigos_internos.gasto.';
revoke all on function public.codigo_interno_gasto(text) from public, anon;
grant execute on function public.codigo_interno_gasto(text) to authenticated;

-- 7. Las órdenes de compra del código, para las dos pantallas -------------------------------
-- Las compras no son de Gerencia sola: Requerimientos las ve también. El monto
-- sigue saliendo de la línea COMPRAS del costeo.
create or replace function public.codigo_interno_compras(p_codigo text)
returns table (id uuid, numero text, fecha date, proveedor text, aprobacion text, recojo text,
               entregado_almacen_en timestamptz, validaciones text[], moneda text, monto numeric,
               lineas integer, sin_precio integer, requerimientos text)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  if public.usuario_actual() is not null
     and not (public.es_admin() or public.tiene_permiso('codigos_internos.ver') or public.tiene_permiso('codigos_internos.gasto')) then
    raise exception 'No tiene el permiso codigos_internos.ver ni codigos_internos.gasto para realizar esta operación'
      using errcode = 'insufficient_privilege';
  end if;
  if public.normalizar_codigo_interno(p_codigo) is null then
    return;
  end if;
  return query
  select c.id, k.documento, k.fecha, c.proveedor::text, c.aprobacion::text, c.recojo::text, c.entregado_almacen_en,
         coalesce((select array_agg(i.estado::text) from public.ingresos_pendientes_almacen i where i.orden_compra_id = c.id),
                  '{}'::text[]),
         k.moneda, k.monto, k.cantidad::integer, k.sin_precio,
         (select string_agg(distinct q.numero, ', ') from public.requerimiento_lineas rl
            join public.requerimientos q on q.id = rl.requerimiento_id where rl.orden_compra_id = c.id)::text
    from public.codigo_interno_lineas(p_codigo, false) k
    join public.ordenes_compra_materiales c on c.id = k.referencia_id
   where k.fuente = 'COMPRAS'
   order by k.fecha desc, k.documento;
end;
$$;
comment on function public.codigo_interno_compras(text) is
  'Las órdenes de compra de un código interno, sin IGV y sin las rechazadas, con su aprobación, su recojo y su ingreso al almacén. Exige codigos_internos.ver o codigos_internos.gasto.';
revoke all on function public.codigo_interno_compras(text) from public, anon;
grant execute on function public.codigo_interno_compras(text) to authenticated;

-- 8. Todos los códigos con su gasto, uno por fila ---------------------------------------------
-- Los que tienen gasto y los que solo tienen requerimientos: el código aparece
-- apenas se pide algo para él.
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
    select * from public.codigo_interno_lineas(null, false)
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
