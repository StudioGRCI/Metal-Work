-- Un solo precio para cada salida del almacén.
--
-- La misma salida tenía tres precios. El costeo del código interno la valorizaba
-- con el precio del último ingreso; la Valorización de Logística y el costeo de la
-- OT buscaban la compra por la OC a través de los materiales de la OT, que los RQ
-- por código interno no llenan. Así Valorización decía «13 sin precio · S/ 0.00»
-- mientras el código cobraba esas mismas salidas, y la pantalla decía «El costeo
-- lo usa» de un precio que el costeo no miraba (revisión del 27/10/2026).
--
-- Desde aquí las tres leen `precio_de_salida`, en este orden:
--   1. el precio congelado en la salida;
--   2. si no hay, el del último ingreso con precio hasta ese día (lo comprado por
--      el sistema entra al almacén con el precio de su OC);
--   3. si no entró con precio y la salida entrega una línea de RQ comprada (del
--      RQ de la OT o del RQ por código), el de la OC de esa misma línea, si
--      Gerencia la aprobó o no lo requería: lo que se entrega directo de la compra;
--   4. si nunca se compró, el que fijó Logística: el vigente ese día o, si lo
--      fijó después, el primero.
-- El costeo del código ya usaba 1, 2 y 4, así que lo que tenía precio no cambia:
-- solo gana precio la entrega directa de una compra, que salía sin él. La
-- Valorización y el costeo de la OT pasan a decir lo mismo que el código.

-- 1. El precio de una salida ----------------------------------------------------------------------------------------
-- Las versiones de prueba de este archivo: no se deja otra al lado.
drop function if exists public.precio_de_salida(uuid, timestamptz, numeric, text);
drop function if exists public.precio_de_salida(uuid, timestamptz, numeric, text, uuid);
create or replace function public.precio_de_salida(
  p_material uuid,
  p_en timestamptz,
  p_precio numeric default null,
  p_moneda text default null,
  p_salida uuid default null
)
returns table (precio numeric, moneda text, origen text)
language sql
stable
set search_path = 'public'
as $$
  select coalesce(p_precio, ing.precio_unitario, oc.precio_unitario, val.precio)::numeric,
         case when p_precio is not null then coalesce(p_moneda, ing.moneda, oc.moneda, val.moneda)
              when ing.precio_unitario is not null then ing.moneda
              when oc.precio_unitario is not null then oc.moneda
              else val.moneda end::text,
         case when p_precio is not null then 'SALIDA'
              when ing.precio_unitario is not null or oc.precio_unitario is not null then 'COMPRA'
              when val.precio is not null then 'LOGISTICA' end
    from (select 1) uno
    left join lateral (
      select i.precio_unitario, i.moneda
        from public.movimientos_materiales i
       where i.material_id = p_material and i.tipo = 'INGRESO' and i.precio_unitario is not null
         and i.moneda in ('PEN', 'USD') and i.registrado_en <= p_en
       order by i.registrado_en desc, i.id
       limit 1) ing on true
    left join lateral (
      -- Solo la OC de la línea de RQ que esta salida entrega: otra OC del material
      -- puede no haber llegado nunca.
      select cd.precio_unitario, c.moneda
        from public.movimientos_materiales m
        left join public.requerimiento_lineas rl on rl.id = m.requerimiento_linea_id
        join public.orden_compra_material_detalles cd
          on cd.requerimiento_detalle_id = m.requerimiento_detalle_id or cd.id = rl.orden_compra_detalle_id
        join public.ordenes_compra_materiales c on c.id = cd.orden_compra_id
       where m.id = p_salida
         and cd.precio_unitario >= 0 and c.moneda in ('PEN', 'USD') and c.creado_en <= p_en
         and c.aprobacion in ('APROBADA', 'NO_REQUERIDA')
       order by c.creado_en desc, cd.id
       limit 1) oc on true
    left join lateral (
      select v.precio, v.moneda
        from public.valorizaciones_material v
       where v.material_id = p_material
       order by (v.vigente_desde > p_en),
                case when v.vigente_desde <= p_en then v.vigente_desde end desc nulls last,
                v.vigente_desde, v.id
       limit 1) val on true
$$;
comment on function public.precio_de_salida(uuid, timestamptz, numeric, text, uuid) is
  'El precio de una salida del almacén: el congelado, el del último ingreso, el de la OC de su línea de RQ o el que fijó Logística, hasta ese día. Lo usan el costeo del código, el de la OT y la Valorización (20261027110000).';
-- Es un cálculo interno: lo llaman las funciones con permiso, nunca la sesión.
revoke all on function public.precio_de_salida(uuid, timestamptz, numeric, text, uuid) from public, anon, authenticated;

-- 2. El costeo del código interno ------------------------------------------------------------------------------
-- La definición viva (la de la 20261026210000), con el precio de la función de
-- arriba. Se conservan todos sus `union all`.

CREATE OR REPLACE FUNCTION public.codigo_interno_lineas(p_codigo text, p_mano_obra boolean)
 RETURNS TABLE(codigo text, fuente text, fecha date, concepto text, detalle text, cantidad numeric, unidad text, horas numeric, precio_unitario numeric, moneda text, monto numeric, sin_precio integer, documento text, referencia_id uuid)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  v_codigo text := public.normalizar_codigo_interno(p_codigo);
  -- El mes en curso todavía reparte con las horas que van: su parte es provisional.
  v_mes date := date_trunc('month', now() at time zone 'America/Lima')::date;
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
  ), salida_base as (
    select m.id, m.registrado_en, m.material_id, m.precio_unitario, m.moneda, m.documento_referencia, rq.numero as rq_numero,
           public.normalizar_codigo_interno(coalesce(m.codigo_interno, rq.codigo_interno, u.codigo_interno, uo.codigo_interno,
                                                     case when m.unidad_id is null then m.codigo_unidad end)) as codigo,
           greatest(m.cantidad - coalesce((select sum(x.cantidad) from public.movimientos_materiales x
                                            where x.devolucion_de = m.id), 0), 0)::numeric as cantidad,
           date_trunc('month', m.registrado_en at time zone 'America/Lima')::date as periodo
      from public.movimientos_materiales m
      left join public.requerimiento_lineas rl on rl.id = m.requerimiento_linea_id
      left join public.requerimientos rq on rq.id = rl.requerimiento_id
      left join public.unidades u on u.id = m.unidad_id
      left join public.ordenes_trabajo ot on ot.id = m.orden_id
      left join public.unidades uo on uo.id = ot.unidad_id
     where m.tipo in ('SALIDA', 'DESPACHO')
  ), trabajo as (
    -- Los códigos que trabajaron cada mes: con horas del reporte diario o de
    -- RR. HH., o con una salida del almacén. Es lo que se llama «activo» al
    -- repartir los gastos del mes y lo cargado a TODOS LOS ACTIVOS. Solo dice
    -- qué códigos y qué meses, sin horas ni costos: por eso se arma también
    -- cuando no se pide la mano de obra (el gasto por código de Requerimientos
    -- reparte igual que Gerencia).
    select distinct date_trunc('month', t.fecha)::date as periodo, public.normalizar_codigo_interno(t.codigo_interno) as codigo
      from public.tareos t
     where t.anulado_en is null
    union
    select distinct date_trunc('month', l.fecha)::date, public.normalizar_codigo_interno(r.codigo_interno)
      from public.reporte_diario_personal l
      join public.reportes_diarios r on r.id = l.reporte_id
     where r.anulado_en is null
       and not exists (select 1 from public.tareos t where t.reporte_linea_id = l.id)
    union
    select distinct s.periodo, s.codigo
      from salida_base s
     where s.cantidad > 0
  ), activo as (
    -- Entre quiénes se reparte lo cargado a todos: las unidades. PLANTA y OFICINA
    -- no lo son.
    select t.periodo, t.codigo, count(*) over (partition by t.periodo) as n
      from trabajo t
     where t.codigo is not null and t.codigo not in ('PLANTA', 'OFICINA', 'TODOS LOS ACTIVOS')
  ), movido as (
    -- Entre quiénes se reparten los gastos del mes: los mismos de la
    -- 20261017300000, todos menos PLANTA. TODOS LOS ACTIVOS no recibe: lo suyo ya
    -- está repartido.
    select t.periodo, t.codigo
      from trabajo t
     where t.codigo is not null and t.codigo not in ('PLANTA', 'TODOS LOS ACTIVOS')
  ), salida as (
    select s.id, s.registrado_en, s.material_id, s.precio_unitario, s.moneda, s.documento_referencia, s.rq_numero,
           s.codigo, s.cantidad, null::bigint as entre, false as a_todos
      from salida_base s
     where s.codigo is distinct from 'TODOS LOS ACTIVOS'
    union all
    -- Lo cargado a todos: una parte igual para cada código que trabajó el mes de
    -- la salida. Sin ninguno, la salida entera queda en TODOS LOS ACTIVOS.
    select s.id, s.registrado_en, s.material_id, s.precio_unitario, s.moneda, s.documento_referencia, s.rq_numero,
           coalesce(a.codigo, s.codigo), case when a.n is null then s.cantidad else s.cantidad / a.n end, a.n, true
      from salida_base s
      left join activo a on a.periodo = s.periodo
     where s.codigo = 'TODOS LOS ACTIVOS'
  ), valorizada as (
    -- El precio de la salida sale de `precio_de_salida`, el mismo que usan el
    -- costeo de la OT y la Valorización de Logística (20261027110000).
    select s.*, p.precio, p.moneda as moneda_val
      from salida s
      left join lateral public.precio_de_salida(s.material_id, s.registrado_en, s.precio_unitario, s.moneda, s.id) p on true
     where s.codigo is not null and s.cantidad > 0
       and (v_codigo is null or s.codigo = v_codigo)
  ), porcion as (
    -- Lo que faltaba de los insumos que cubre cada línea de OC, por el código de su RQ.
    select rl.orden_compra_detalle_id as detalle_id, public.normalizar_codigo_interno(rq.codigo_interno) as codigo,
           sum(greatest(rl.cantidad - coalesce(rl.cantidad_en_stock, 0), 0))::numeric as falta
      from public.requerimiento_lineas rl
      join public.requerimientos rq on rq.id = rl.requerimiento_id
     where rl.orden_compra_detalle_id is not null
     group by 1, 2
  ), reparto as (
    -- La parte de la línea que va a cada código; si nada faltaba, a partes iguales.
    select p.detalle_id, p.codigo,
           coalesce(p.falta / nullif(sum(p.falta) over (partition by p.detalle_id), 0),
                    1.0 / count(*) over (partition by p.detalle_id))::numeric as parte
      from porcion p
  ), compra_linea as (
    -- La línea sin insumos (la directa, o la OC de antes) va entera al código de la OC.
    select c.id, coalesce(r.codigo, public.normalizar_codigo_interno(c.codigo_interno)) as codigo,
           d.id as detalle_id, d.precio_unitario,
           d.cantidad * d.precio_unitario * coalesce(r.parte, 1) as importe
      from public.ordenes_compra_materiales c
      left join public.orden_compra_material_detalles d on d.orden_compra_id = c.id
      left join reparto r on r.detalle_id = d.id
     where c.aprobacion not in ('RECHAZADA', 'ANULADA')
  ), compra as (
    select l.codigo, c.id, public.nombre_de_oc(c.numero, c.referencia) as numero,
           (c.creado_en at time zone 'America/Lima')::date as fecha, c.proveedor, c.moneda,
           coalesce(sum(l.importe) filter (where l.precio_unitario is not null), 0)::numeric as monto,
           count(l.detalle_id) filter (where l.precio_unitario is null)::integer as sin_precio,
           count(l.detalle_id)::numeric as lineas
      from compra_linea l
      join public.ordenes_compra_materiales c on c.id = l.id
     where l.codigo is not null
     group by l.codigo, c.id
  ), por_horas as (
    -- Las horas de cada unidad en cada mes: la base del reparto POR HORAS y del
    -- sueldo de la oficina.
    select h.periodo, h.codigo, h.horas, h.total, h.codigos
      from public.horas_por_codigo_del_mes(null) h
     where p_mano_obra
  ), gasto_mes as (
    -- POR HORAS, cada unidad lleva la parte del gasto de sus horas en el mes. Los
    -- registrados antes con TASA llevan esa tasa; en partes iguales, su parte.
    -- La línea lleva el día en que se registró el gasto, no el 1 del mes: el
    -- gasto en dólares toma el cambio de Tesorería de ese día, y cambio_del_dia
    -- solo mira diez días atrás (con el día 1 quedaba sin cambio y trababa el cierre).
    select m.codigo, g.id, g.periodo, (g.creado_en at time zone 'America/Lima')::date as registrado,
           g.descripcion, g.monto, g.moneda, g.reparto, g.tasa, c.nombre,
           count(*) over (partition by g.id) as n, null::numeric as horas, null::numeric as total, null::numeric as parte
      from public.gastos_generales_mes g
      join public.conceptos_gasto_general c on c.codigo = g.concepto
      join movido m on m.periodo = g.periodo
     where p_mano_obra and g.estado = 'ACTIVO' and g.reparto <> 'HORAS'
    union all
    select h.codigo, g.id, g.periodo, (g.creado_en at time zone 'America/Lima')::date,
           g.descripcion, g.monto, g.moneda, g.reparto, g.tasa, c.nombre,
           h.codigos::bigint, h.horas, h.total,
           -- Cada parte al céntimo, y lo que el redondeo deja suelto a la unidad con
           -- más horas: el gasto entero queda repartido, ni un céntimo de más o de menos.
           round(g.monto * h.horas / h.total, 2)
           + case when row_number() over (partition by g.id order by h.horas desc, h.codigo) = 1
                  then g.monto - sum(round(g.monto * h.horas / h.total, 2)) over (partition by g.id) else 0 end as parte
      from public.gastos_generales_mes g
      join public.conceptos_gasto_general c on c.codigo = g.concepto
      join por_horas h on h.periodo = g.periodo
     where p_mano_obra and g.estado = 'ACTIVO' and g.reparto = 'HORAS'
  ), oficina as (
    -- El sueldo de la oficina de cada mes, que se reparte igual que un gasto POR
    -- HORAS, con el residuo del redondeo a la unidad con más horas.
    select o.periodo, o.monto, h.codigo, h.horas, h.total, h.codigos,
           round(o.monto * h.horas / h.total, 2)
           + case when row_number() over (partition by o.periodo order by h.horas desc, h.codigo) = 1
                  then o.monto - sum(round(o.monto * h.horas / h.total, 2)) over (partition by o.periodo) else 0 end as parte
      from public.sueldos_oficina_del_mes(null) o
      join por_horas h on h.periodo = o.periodo
     where p_mano_obra and o.monto > 0
  ), merma as (
    -- La merma que Diseño evaluó en la OT de la unidad va sobre los materiales
    -- con precio del código. Si el código tiene varias OT con merma (una
    -- garantía), manda la última evaluada: sumarlas cobraría dos veces el mismo acero.
    select distinct on (public.normalizar_codigo_interno(u.codigo_interno))
           public.normalizar_codigo_interno(u.codigo_interno) as codigo, mm.id, mm.porcentaje, mm.motivo,
           (mm.registrado_en at time zone 'America/Lima')::date as fecha, o.numero
      from public.ot_mermas mm
      join public.ordenes_trabajo o on o.id = mm.orden_id
      join public.unidades u on u.id = o.unidad_id
     where p_mano_obra and mm.porcentaje > 0 and o.estado::text <> 'ANULADA'
       and public.normalizar_codigo_interno(u.codigo_interno) is not null
     order by public.normalizar_codigo_interno(u.codigo_interno), mm.registrado_en desc, mm.id
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
         (v.registrado_en at time zone 'America/Lima')::date, mat.descripcion::text,
         (case when not v.a_todos then v.documento_referencia
               when v.entre is null then concat_ws(' · ', 'Cargado a todos los activos: ningún código trabajó ese mes todavía, se reparte cuando alguno trabaje', v.documento_referencia)
               when v.entre = 1 then concat_ws(' · ', 'Cargado a todos los activos: todo a este código, el único que trabajó ese mes', v.documento_referencia)
               else concat_ws(' · ', 'Cargado a todos los activos: partes iguales entre los ' || v.entre || ' códigos que trabajaron ese mes', v.documento_referencia)
          end)::text,
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
  select g.codigo, 'GASTOS_DEL_MES', g.registrado, (g.nombre || ' ' || to_char(g.periodo, 'MM/YYYY'))::text,
         (case when g.reparto = 'TASA' then trim(trailing '.' from to_char(g.tasa, 'FM990.999')) || ' % de ' || g.descripcion
               when g.reparto = 'HORAS' and g.periodo >= v_mes and g.n = 1 then 'Por ahora todo a este código, la única unidad con horas este mes (el mes no termina) · ' || g.descripcion
               when g.reparto = 'HORAS' and g.n = 1 then 'Todo a este código, la única unidad con horas ese mes · ' || g.descripcion
               when g.reparto = 'HORAS' then case when g.periodo >= v_mes then 'Por ahora, por horas: ' else 'Por horas: ' end || trim(trailing '.' from to_char(g.horas, 'FM999,999,990.99')) || ' de ' || trim(trailing '.' from to_char(g.total, 'FM999,999,990.99'))
                                             || ' h del mes, entre ' || g.n || ' unidades · ' || g.descripcion
               when g.n = 1 then 'Todo a este código, el único que trabajó ese mes · ' || g.descripcion
               else 'Partes iguales entre los ' || g.n || ' códigos que trabajaron ese mes · ' || g.descripcion end)::text,
         1::numeric, null::text, null::numeric, g.monto, g.moneda::text,
         case when g.reparto = 'TASA' then round(g.monto * g.tasa / 100, 2)
              when g.reparto = 'HORAS' then g.parte
              else round(g.monto / g.n, 2) end,
         0, null::text, g.id
    from gasto_mes g
   where v_codigo is null or g.codigo = v_codigo
  union all
  select o.codigo, 'GASTOS_DEL_MES', o.periodo, ('Sueldos de la oficina ' || to_char(o.periodo, 'MM/YYYY'))::text,
         (case when o.codigos = 1 and o.periodo >= v_mes then 'Por ahora todo a este código, la única unidad con horas este mes (el mes no termina)'
               when o.codigos = 1 then 'Todo a este código, la única unidad con horas ese mes'
               else case when o.periodo >= v_mes then 'Por ahora, por horas: ' else 'Por horas: ' end || trim(trailing '.' from to_char(o.horas, 'FM999,999,990.99')) || ' de ' || trim(trailing '.' from to_char(o.total, 'FM999,999,990.99'))
                    || ' h del mes, entre ' || o.codigos || ' unidades' end
          || ' · pagos de la oficina registrados por RR. HH.')::text,
         1::numeric, null::text, null::numeric, o.monto, 'PEN'::text,
         o.parte,
         0, null::text, null::uuid
    from oficina o
   where v_codigo is null or o.codigo = v_codigo
  union all
  select v.codigo, 'MERMA', mm.fecha,
         ('Merma de material ' || trim(trailing '.' from to_char(mm.porcentaje, 'FM990.99')) || ' %')::text,
         ('Evaluada por Diseño en la OT ' || mm.numero || ' · ' || mm.motivo)::text,
         1::numeric, null::text, null::numeric, null::numeric, v.moneda_val::text,
         round(sum(round(v.cantidad * v.precio, 2)) * mm.porcentaje / 100, 2),
         0, mm.numero::text, mm.id
    from valorizada v
    join merma mm on mm.codigo = v.codigo
   where v.precio is not null and v.moneda_val in ('PEN', 'USD')
   group by v.codigo, v.moneda_val, mm.id, mm.fecha, mm.porcentaje, mm.motivo, mm.numero
  union all
  select * from public.codigo_interno_lineas_servicio(v_codigo)
  union all
  select * from public.codigo_interno_lineas_subcontrato(v_codigo)
  union all
  select * from public.codigo_interno_lineas_nota_credito(v_codigo)
  union all
  -- El IGV de la boleta de una parte de una OC con factura (20261022210000).
  select * from public.codigo_interno_lineas_igv_de_parte(v_codigo)
  union all
  select * from public.codigo_interno_lineas_caja(v_codigo) where p_mano_obra
  union all
  select * from public.codigo_interno_lineas_recargo(v_codigo) where p_mano_obra
  union all
  select * from public.codigo_interno_lineas_gastos_ot(v_codigo) where p_mano_obra
  union all
  -- El ajuste de la planilla de taller del mes (20261026210000).
  select * from public.codigo_interno_lineas_planilla(v_codigo) where p_mano_obra
   order by 1, 3 desc, 2, 4;
end;
$function$;

-- 3. El costeo de la OT ------------------------------------------------------------------------------------------
-- La definición viva, con el precio de la función de arriba en vez de la OC buscada
-- por los materiales de la OT, que los RQ por código no llenan.
CREATE OR REPLACE FUNCTION public.detalle_costeo_ot(p_orden uuid)
 RETURNS TABLE(fuente text, fecha date, concepto text, detalle text, cantidad numeric, unidad text, precio_unitario numeric, moneda text, monto numeric, referencia text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.exigir_permiso('costos.ver');
  if not public.puede_ver_orden(p_orden) then
    raise exception 'No tienes acceso al costeo de esta OT.' using errcode = 'insufficient_privilege';
  end if;

  return query
  with entregas as (
    select m.id, m.registrado_en, m.precio_unitario as precio_registrado, m.moneda as moneda_registrada,
           m.documento_referencia, d.id as detalle_id, om.material_id,
           case r.area_destino when 'MTZ' then 'Maestranza' when 'PRD' then 'Producción'
                               when 'ACB' then 'Acabados' else r.area_destino end as destino,
           greatest(m.cantidad - coalesce((select sum(x.cantidad) from public.movimientos_materiales x
                                            where x.devolucion_de = m.id), 0), 0)::numeric as cantidad
      from public.movimientos_materiales m
      join public.requerimiento_material_detalles d on d.id = m.requerimiento_detalle_id
      join public.requerimientos_materiales r on r.id = d.requerimiento_id
      join public.ot_materiales om on om.id = d.ot_material_id
     where r.orden_id = p_orden and m.tipo = 'DESPACHO'
    union all
    select m.id, m.registrado_en, m.precio_unitario, m.moneda, m.documento_referencia, null::uuid, m.material_id,
           'Salida a ' || coalesce(m.codigo_unidad, 'la unidad'),
           greatest(m.cantidad - coalesce((select sum(x.cantidad) from public.movimientos_materiales x
                                            where x.devolucion_de = m.id), 0), 0)::numeric
      from public.movimientos_materiales m
     where m.orden_id = p_orden and m.tipo = 'SALIDA'
  ), valorizados as (
    -- El precio de la salida sale de `precio_de_salida`, el mismo que usan el
    -- costeo del código interno y la Valorización de Logística (20261027110000).
    select e.*, p.precio, p.moneda as moneda_val
      from entregas e
      left join lateral public.precio_de_salida(e.material_id, e.registrado_en, e.precio_registrado, e.moneda_registrada, e.id) p on true
     where e.cantidad > 0
  ), materiales as (
    select case when v.precio is null then 'MATERIALES_SIN_PRECIO' else 'MATERIALES' end as fuente,
           (v.registrado_en at time zone 'America/Lima')::date as fecha,
           mat.descripcion::text as concepto, v.destino::text as detalle, v.cantidad, um.codigo::text as unidad,
           v.precio, v.moneda_val::text as moneda,
           case when v.precio is null then null else round(v.cantidad * v.precio, 2) end as monto,
           v.documento_referencia::text as referencia
      from valorizados v
      join public.materiales mat on mat.id = v.material_id
      left join public.unidades_medida um on um.id = mat.unidad_medida_id
  ), merma as (
    select 'MERMA'::text, (mm.registrado_en at time zone 'America/Lima')::date,
           ('Merma de material ' || trim(to_char(mm.porcentaje, 'FM990.99')) || ' %')::text,
           mm.motivo::text, null::numeric, null::text, null::numeric,
           l.moneda, round(sum(l.monto) * mm.porcentaje / 100, 2), null::text
      from materiales l
      join public.ot_mermas mm on mm.orden_id = p_orden
     where l.fuente = 'MATERIALES' and mm.porcentaje > 0
     group by l.moneda, mm.porcentaje, mm.motivo, mm.registrado_en
  ), meses as (
    select distinct p.periodo
      from public.planilla_distribuciones d
      join public.planilla_personas pp on pp.id = d.persona_id
      join public.planillas p on p.id = pp.planilla_id
     where d.orden_id = p_orden and p.estado = 'CERRADA'
  ), trabajadas as (
    select p.periodo, count(distinct d.orden_id) as n
      from public.planillas p
      join public.planilla_personas pp on pp.planilla_id = p.id
      join public.planilla_distribuciones d on d.persona_id = pp.id
     where p.estado = 'CERRADA' and p.periodo in (select periodo from meses)
     group by p.periodo
  )
  select * from materiales
  union all
  select * from merma
  union all
  select 'PLANILLA',
         p.periodo,
         'Planilla ' || case p.tipo when 'TALLER' then 'de taller' when 'ADMINISTRATIVA' then 'administrativa'
                                    when 'SUBCONTRATOS' then 'de subcontratos' else lower(p.tipo) end
           || ' ' || to_char(p.periodo, 'MM/YYYY'),
         count(*)::text || case when count(*) = 1 then ' persona' else ' personas' end,
         null::numeric, null::text, null::numeric,
         p.moneda,
         sum(round(pp.monto * d.porcentaje / 100, 2)),
         null::text
    from public.planilla_distribuciones d
    join public.planilla_personas pp on pp.id = d.persona_id
    join public.planillas p on p.id = pp.planilla_id
   where d.orden_id = p_orden and p.estado = 'CERRADA'
   group by p.id, p.periodo, p.tipo, p.moneda
  union all
  select case when g.tipo in ('TRAMITE', 'COMISION') then 'GASTOS_OPERACION' else 'GASTOS_AREA' end,
         g.fecha,
         g.descripcion,
         case g.tipo when 'SERVICIO' then 'Servicio' when 'TRANSPORTE' then 'Transporte'
                     when 'VIATICO' then 'Viático' when 'SUBCONTRATO' then 'Subcontrato'
                     when 'TRAMITE' then 'Trámites de placas y documentación'
                     when 'COMISION' then 'Comisión de venta' else 'Otro' end
           || coalesce(' · ' || a.nombre, ''),
         null::numeric, null::text, null::numeric,
         g.moneda,
         g.monto,
         g.comprobante_nombre
    from public.ot_gastos_areas g
    left join public.areas a on a.id = g.area_id
   where g.orden_id = p_orden and g.estado = 'APROBADO'
  union all
  select case c.grupo when 'LOCAL' then 'INDIRECTOS' else 'GASTOS_OPERACION' end,
         g.periodo,
         c.nombre || ' ' || to_char(g.periodo, 'MM/YYYY'),
         case g.reparto when 'TASA' then trim(to_char(g.tasa, 'FM990.999')) || ' % de ' || g.descripcion
                        else 'Partes iguales entre ' || t.n || ' OT · ' || g.descripcion end,
         null::numeric, null::text, null::numeric,
         g.moneda,
         case g.reparto when 'TASA' then round(g.monto * g.tasa / 100, 2) else round(g.monto / t.n, 2) end,
         null::text
    from public.gastos_generales_mes g
    join public.conceptos_gasto_general c on c.codigo = g.concepto
    join trabajadas t on t.periodo = g.periodo
   where g.estado = 'ACTIVO'
   order by 1, 2, 3;
end
$function$;

-- 4. La Valorización de Logística ----------------------------------------------------------------------------------
-- «Última compra» es el precio con que el costeo valorizaría hoy una salida sin
-- precio congelado: el del último ingreso. Antes salía de la OC por los materiales
-- de la OT y quedaba vacío para todo lo pedido por código interno.
create or replace function public.materiales_para_valorizar()
returns table (material_id uuid, codigo text, descripcion text, unidad text, existencia numeric,
               ultima_compra numeric, moneda_compra text, precio numeric, moneda text, valorizado_en timestamptz)
language plpgsql stable security definer set search_path = 'public' as $$
begin
  if not (public.es_admin() or public.tiene_permiso('almacen.valorizar') or public.tiene_permiso('almacen.ver') or public.tiene_permiso('costos.ver')) then
    raise exception 'No tienes permiso para ver la valorización del almacén.' using errcode = 'insufficient_privilege';
  end if;
  return query
  select e.material_id, e.codigo, e.descripcion, e.unidad, e.existencia::numeric,
         case when p.origen = 'COMPRA' then p.precio end,
         case when p.origen = 'COMPRA' then p.moneda end,
         v.precio, v.moneda, v.vigente_desde
    from public.v_existencias_materiales e
    left join lateral public.precio_de_salida(e.material_id, now()) p on true
    left join lateral (
      select x.precio, x.moneda, x.vigente_desde from public.valorizaciones_material x
       where x.material_id = e.material_id order by x.vigente_desde desc, x.id desc limit 1) v on true
   order by e.descripcion;
end $$;
revoke all on function public.materiales_para_valorizar() from public, anon;
grant execute on function public.materiales_para_valorizar() to authenticated;
