-- =============================================================================
-- EL REQUERIMIENTO DE ADMINISTRACIÓN SE PUEDE CARGAR A TODOS LOS CÓDIGOS ACTIVOS
-- -----------------------------------------------------------------------------
-- DKS lo pidió el 2026-10-19: «en los requerimientos de administración pide
-- cargar a un código interno, pero también se podría la opción de cargar a
-- todos los que están activos». Lo de oficina que pide la administradora —un
-- botiquín, guantes para toda la planta, útiles— no es de una unidad: es de
-- todas las que se están fabricando.
--
-- El requerimiento sigue llevando su código interno como texto. Para cargarlo a
-- todos, lleva el código TODOS LOS ACTIVOS: así lo dicen la lista de
-- requerimientos, la OC que sale de él y la salida del almacén, igual que
-- PLANTA u OFICINA, sin columna nueva ni otra regla en cada pantalla.
--
-- Qué es «activo»: el mismo criterio con que ya se reparten los gastos del mes
-- (migración 20261017300000): un código que trabajó ese mes, con horas en el
-- reporte diario o en el tareo de RR. HH., o con una salida del almacén. PLANTA y
-- OFICINA no son una unidad y no reciben de lo cargado a todos; TODOS LOS ACTIVOS
-- tampoco, claro.
--
-- Cómo entra al costo: lo comprado se cuenta cuando sale del almacén, y así
-- también aquí. Cada salida con el código TODOS LOS ACTIVOS se reparte en partes
-- iguales entre los códigos que trabajaron el mes de la salida: cada uno lleva
-- su parte de la cantidad, a su precio, y la línea dice entre cuántos se
-- repartió. Si ese mes todavía no trabajó ningún código, la salida queda en
-- TODOS LOS ACTIVOS —se ve en Códigos internos y no se pierde— y se reparte
-- sola en cuanto alguno trabaje. La OC del requerimiento se sigue mostrando en
-- TODOS LOS ACTIVOS: las compras no se suman al costo de nadie.
--
-- Los gastos del mes se siguen repartiendo como en la 20261017300000, entre los
-- mismos códigos; lo único nuevo es que TODOS LOS ACTIVOS no recibe.
--
-- Es la misma función de la 20261017300000, con sus servicios, subcontratos,
-- caja, recargo, gastos de la OT y merma al final, que se conservan.
-- =============================================================================

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
     where c.aprobacion <> 'RECHAZADA'
  ), compra as (
    select l.codigo, c.id, coalesce(c.numero, c.referencia) as numero,
           (c.creado_en at time zone 'America/Lima')::date as fecha, c.proveedor, c.moneda,
           coalesce(sum(l.importe) filter (where l.precio_unitario is not null), 0)::numeric as monto,
           count(l.detalle_id) filter (where l.precio_unitario is null)::integer as sin_precio,
           count(l.detalle_id)::numeric as lineas
      from compra_linea l
      join public.ordenes_compra_materiales c on c.id = l.id
     where l.codigo is not null
     group by l.codigo, c.id
  ), gasto_mes as (
    -- Con TASA, cada código lleva esa tasa del gasto; en partes iguales, su parte.
    -- La línea lleva el día en que se registró el gasto, no el 1 del mes: el
    -- gasto en dólares toma el cambio de Tesorería de ese día, y cambio_del_dia
    -- solo mira diez días atrás (con el día 1 quedaba sin cambio y trababa el cierre).
    select m.codigo, g.id, g.periodo, (g.creado_en at time zone 'America/Lima')::date as registrado,
           g.descripcion, g.monto, g.moneda, g.reparto, g.tasa, c.nombre,
           count(*) over (partition by g.id) as n
      from public.gastos_generales_mes g
      join public.conceptos_gasto_general c on c.codigo = g.concepto
      join movido m on m.periodo = g.periodo
     where p_mano_obra and g.estado = 'ACTIVO'
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
               when g.n = 1 then 'Todo a este código, el único que trabajó ese mes · ' || g.descripcion
               else 'Partes iguales entre los ' || g.n || ' códigos que trabajaron ese mes · ' || g.descripcion end)::text,
         1::numeric, null::text, null::numeric, g.monto, g.moneda::text,
         case when g.reparto = 'TASA' then round(g.monto * g.tasa / 100, 2) else round(g.monto / g.n, 2) end,
         0, null::text, g.id
    from gasto_mes g
   where v_codigo is null or g.codigo = v_codigo
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
  select * from public.codigo_interno_lineas_caja(v_codigo) where p_mano_obra
  union all
  select * from public.codigo_interno_lineas_recargo(v_codigo) where p_mano_obra
  union all
  select * from public.codigo_interno_lineas_gastos_ot(v_codigo) where p_mano_obra
   order by 1, 3 desc, 2, 4;
end;
$$;
comment on function public.codigo_interno_lineas(text, boolean) is
  'Las líneas del costeo de un código interno (o de todos), sin pedir permiso: mano de obra, materiales (lo salido con el código TODOS LOS ACTIVOS se reparte en partes iguales entre los códigos que trabajaron ese mes), compras (no van al total; la OC con insumos de varios códigos se reparte entre ellos), órdenes de servicio, recibos por honorarios de los subcontratos y, cuando se pide la mano de obra, los gastos del mes, los egresos de caja con el código, los gastos aprobados en la OT de la unidad, la merma que Diseño evaluó en ella y el recargo de las horas extras. Solo la llaman codigo_interno_costeo (Gerencia), codigos_internos_costo, codigo_interno_gasto y codigos_internos_gasto (Requerimientos, sin la mano de obra) y codigo_interno_compras.';
revoke all on function public.codigo_interno_lineas(text, boolean) from public, anon, authenticated;

-- TODOS LOS ACTIVOS es solo del requerimiento de Administración: el de operación
-- lo pide el supervisor para la unidad que está fabricando, con su código.
create or replace function public.fn_requerimientos_todos_los_activos()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if public.normalizar_codigo_interno(new.codigo_interno) = 'TODOS LOS ACTIVOS' and new.tipo <> 'ADMINISTRACION' then
    raise exception 'Solo el requerimiento de Administración se carga a todos los activos: el de operación va con el código interno de su unidad.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_requerimientos_todos_los_activos() from public, anon, authenticated;

create or replace trigger trg_requerimientos_todos_los_activos
  before insert or update of codigo_interno, tipo on public.requerimientos
  for each row execute function public.fn_requerimientos_todos_los_activos();

-- A dónde fue lo cargado a todos: cuánto le tocó a cada código cada mes, y lo
-- que espera en TODOS LOS ACTIVOS porque ese mes no trabajó ninguno. Sale de las
-- mismas líneas del costeo de cada código, no de otra cuenta. Lo leen quienes
-- ven los códigos internos (Gerencia y Administración).
create or replace function public.codigo_interno_reparto_a_todos()
returns table (periodo date, codigo text, salidas integer, monto_pen numeric, monto_usd numeric, sin_precio integer)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  perform public.exigir_permiso('codigos_internos.ver');
  return query
  select date_trunc('month', l.fecha)::date, l.codigo, count(distinct l.referencia_id)::integer,
         coalesce(sum(l.monto) filter (where l.moneda = 'PEN'), 0), coalesce(sum(l.monto) filter (where l.moneda = 'USD'), 0),
         coalesce(sum(l.sin_precio), 0)::integer
    from public.codigo_interno_lineas(null, false) l
   where l.fuente in ('MATERIALES', 'MATERIALES_SIN_PRECIO')
     and l.referencia_id in (select m.id
                               from public.movimientos_materiales m
                               left join public.requerimiento_lineas rl on rl.id = m.requerimiento_linea_id
                               left join public.requerimientos rq on rq.id = rl.requerimiento_id
                              where m.tipo in ('SALIDA', 'DESPACHO')
                                and public.normalizar_codigo_interno(coalesce(m.codigo_interno, rq.codigo_interno)) = 'TODOS LOS ACTIVOS')
   group by 1, 2
   order by 1 desc, 2;
end;
$$;
comment on function public.codigo_interno_reparto_a_todos() is
  'Lo que salió del almacén con el código TODOS LOS ACTIVOS, por mes y por código que lo recibió; lo que sigue en TODOS LOS ACTIVOS espera un mes con trabajo (migración 20261017401000).';
revoke all on function public.codigo_interno_reparto_a_todos() from public, anon;
grant execute on function public.codigo_interno_reparto_a_todos() to authenticated;

-- TODOS LOS ACTIVOS no es una unidad: su costeo no se cierra. Lo que se cargó a
-- todos ya está en el costeo de cada código que recibió su parte.
create or replace function public.fn_cierre_no_de_todos_los_activos()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if public.normalizar_codigo_interno(new.codigo) = 'TODOS LOS ACTIVOS' then
    raise exception 'TODOS LOS ACTIVOS no es una unidad: su costeo no se cierra. Lo cargado a todos ya está en el costeo de cada código.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_cierre_no_de_todos_los_activos() from public, anon, authenticated;

create or replace trigger trg_cierre_no_de_todos_los_activos
  before insert on public.codigo_interno_cierres
  for each row execute function public.fn_cierre_no_de_todos_los_activos();

-- Y en el almacén: una salida va a todos los activos solo si sale de un
-- requerimiento de Administración cargado así. Escrito a mano en una salida
-- general, el código se repartiría entre todas las unidades sin que nadie lo
-- haya pedido.
create or replace function public.fn_salida_todos_los_activos()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if new.tipo in ('SALIDA', 'DESPACHO') and new.devolucion_de is null
     and public.normalizar_codigo_interno(coalesce(new.codigo_interno, case when new.unidad_id is null then new.codigo_unidad end)) = 'TODOS LOS ACTIVOS'
     and not exists (select 1
                       from public.requerimiento_lineas rl
                       join public.requerimientos rq on rq.id = rl.requerimiento_id
                      where rl.id = new.requerimiento_linea_id
                        and rq.tipo = 'ADMINISTRACION'
                        and public.normalizar_codigo_interno(rq.codigo_interno) = 'TODOS LOS ACTIVOS') then
    raise exception 'TODOS LOS ACTIVOS es solo para lo que sale de un requerimiento de Administración cargado a todos: elige ese requerimiento o escribe el código de la unidad.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_salida_todos_los_activos() from public, anon, authenticated;

create or replace trigger trg_salida_todos_los_activos
  before insert on public.movimientos_materiales
  for each row execute function public.fn_salida_todos_los_activos();
