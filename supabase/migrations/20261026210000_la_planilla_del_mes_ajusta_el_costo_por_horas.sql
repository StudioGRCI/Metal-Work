-- =============================================================================
-- LA PLANILLA DEL MES AJUSTA LA MANO DE OBRA DE CADA CÓDIGO, POR SUS HORAS
-- -----------------------------------------------------------------------------
-- DKS lo eligió el 2026-10-26 («Horas y ajuste al cerrar»): la mano de obra
-- sigue entrando a cada código interno por las horas de los reportes diarios
-- (el costo mensual de cada persona entre 240), y al cerrar la planilla de
-- taller del mes la diferencia con el costo real —el bruto más EsSalud que trae
-- el Excel— se reparte entre los códigos por esas mismas horas. La planilla
-- deja de repartirse a mano entre las OT: ese reparto no llegaba al código.
--
-- Por cada persona de la planilla de taller cerrada:
--   · se busca su ficha de Personal, por el DNI si la planilla lo trae o por el
--     nombre (las mismas palabras, en cualquier orden y sin tildes);
--   · ajuste = su costo real − lo que ya entró por sus horas de ese mes;
--   · el ajuste se reparte entre los códigos que trabajó ese mes, por sus horas.
-- Quien no tiene ficha que calce, o no cargó horas ese mes, reparte su costo
-- entero entre las unidades del mes por las horas de todos (como los gastos del
-- mes). Quien en Personal es de planilla administrativa no entra: su costo ya
-- entra por los pagos de la oficina. Las planillas administrativa y de
-- subcontratos no se reparten: la oficina entra por sus pagos y los
-- subcontratos por Subcontratos.
--
-- El ajuste es una línea más de la mano de obra del código y se recalcula si
-- llegan horas del mes después de cerrar: lo que los códigos suman de cada
-- persona es siempre su costo real. Las planillas cerradas antes con su reparto
-- por OT lo conservan en el costeo de la OT.
-- =============================================================================

-- 1. La ficha de cada persona de la planilla ---------------------------------------------------------
create or replace function public.trabajador_de_planilla(p_nombre text, p_documento text)
returns uuid language sql stable set search_path to 'public' as $$
  select coalesce(
    (select t.id from public.trabajadores t
      where nullif(btrim(coalesce(p_documento, '')), '') is not null and t.dni = btrim(p_documento)
      order by t.activo desc, t.creado_en
      limit 1),
    -- Por el nombre, solo si una sola ficha calza.
    (select (array_agg(t.id))[1] from public.trabajadores t
      where public.clave_nombre_planilla(t.nombres || ' ' || t.apellidos) = public.clave_nombre_planilla(p_nombre)
     having count(*) = 1))
$$;
comment on function public.trabajador_de_planilla(text, text) is
  'La ficha de Personal de una persona de la planilla del mes: por su DNI o, sin él, por su nombre (las mismas palabras, sin tildes, en cualquier orden), solo si calza una sola. No pide permiso.';
revoke all on function public.trabajador_de_planilla(text, text) from public, anon, authenticated;

-- 2. Cómo entra cada persona de la planilla de taller ---------------------------------------------------
-- Sin p_planilla: las de taller cerradas, que son las que entran al costeo. Con
-- ella: esa, esté como esté, para que RR. HH. lo vea antes de cerrar.
create or replace function public.planilla_al_costo(p_planilla uuid default null)
returns table (planilla_id uuid, periodo date, persona_id uuid, nombre text, trabajador_id uuid, como text,
               costo numeric, horas numeric, costo_horas numeric, ajuste numeric, codigos integer)
language sql stable set search_path to 'public' as $$
  with persona as (
    select p.id as planilla_id, p.periodo, pp.id as persona_id, pp.nombre, pp.monto as costo,
           public.trabajador_de_planilla(pp.nombre, pp.documento) as trabajador_id
      from public.planillas p
      join public.planilla_personas pp on pp.planilla_id = p.id
     where p.tipo = 'TALLER' and p.moneda = 'PEN'
       and ((p_planilla is null and p.estado = 'CERRADA') or p.id = p_planilla)
  ), hora as (
    select t.trabajador_id, date_trunc('month', t.fecha)::date as periodo, sum(t.horas) as horas, sum(t.costo) as costo,
           count(distinct public.normalizar_codigo_interno(t.codigo_interno)) as codigos
      from public.tareos t
     where t.anulado_en is null
       and t.trabajador_id in (select x.trabajador_id from persona x)
     group by t.trabajador_id, date_trunc('month', t.fecha)
  )
  select x.planilla_id, x.periodo, x.persona_id, x.nombre, x.trabajador_id,
         case when x.trabajador_id is null then 'SIN_FICHA'
              when w.planilla = 'ADMINISTRATIVA' then 'OFICINA'
              when coalesce(h.horas, 0) = 0 then 'SIN_HORAS'
              else 'HORAS' end,
         x.costo, coalesce(h.horas, 0), coalesce(h.costo, 0),
         case when x.trabajador_id is not null and w.planilla = 'ADMINISTRATIVA' then 0
              when coalesce(h.horas, 0) = 0 then x.costo
              else x.costo - h.costo end,
         coalesce(h.codigos, 0)::integer
    from persona x
    left join public.trabajadores w on w.id = x.trabajador_id
    left join hora h on h.trabajador_id = x.trabajador_id and h.periodo = x.periodo
$$;
comment on function public.planilla_al_costo(uuid) is
  'Por persona de la planilla de taller (las cerradas, o la de p_planilla): su ficha, cómo entra al costeo (HORAS: el ajuste por sus horas; SIN_FICHA o SIN_HORAS: su costo entero por las horas de todos en el mes; OFICINA: no entra, va por los pagos de la oficina), su costo real, sus horas y su costo por horas del mes, y el ajuste. No pide permiso.';
revoke all on function public.planilla_al_costo(uuid) from public, anon, authenticated;

-- 3. El ajuste como líneas del costeo del código ------------------------------------------------------------
-- Va como mano de obra (MANO_OBRA), sin horas: las horas ya están en las del
-- reporte, y el costo del código, su cierre y su margen lo suman donde suman la
-- mano de obra.
create or replace function public.codigo_interno_lineas_planilla(p_codigo text)
returns table (codigo text, fuente text, fecha date, concepto text, detalle text, cantidad numeric, unidad text,
               horas numeric, precio_unitario numeric, moneda text, monto numeric, sin_precio integer,
               documento text, referencia_id uuid)
language sql stable set search_path to 'public' as $$
  with persona as (
    select a.* from public.planilla_al_costo(null) a
     where a.como in ('HORAS', 'SIN_FICHA', 'SIN_HORAS') and a.ajuste <> 0
  ), suya as (
    select t.trabajador_id, date_trunc('month', t.fecha)::date as periodo,
           public.normalizar_codigo_interno(t.codigo_interno) as codigo, sum(t.horas) as horas
      from public.tareos t
     where t.anulado_en is null
       and t.trabajador_id in (select p.trabajador_id from persona p where p.como = 'HORAS')
     group by 1, 2, 3
  ), parte as (
    select p.planilla_id, p.periodo, p.persona_id, s.codigo, p.ajuste * s.horas / p.horas as monto, false as de_todos
      from persona p
      join suya s on s.trabajador_id = p.trabajador_id and s.periodo = p.periodo
     where p.como = 'HORAS' and s.codigo is not null
    union all
    select p.planilla_id, p.periodo, p.persona_id, m.codigo, p.ajuste * m.horas / m.total, true
      from persona p
      join public.horas_por_codigo_del_mes(null) m on m.periodo = p.periodo
     where p.como in ('SIN_FICHA', 'SIN_HORAS')
  )
  select x.codigo, 'MANO_OBRA'::text, x.periodo,
         ('Ajuste de la planilla de taller ' || to_char(x.periodo, 'MM/YYYY'))::text,
         (case when bool_and(x.de_todos)
               then 'Costo real (bruto más EsSalud) de quien no cargó horas propias ese mes, repartido por las horas de todos'
               when bool_or(x.de_todos)
               then 'Costo real (bruto más EsSalud) menos lo que ya entró por horas, repartido por las horas de cada persona; quien no cargó horas propias, por las de todos'
               else 'Costo real (bruto más EsSalud) menos lo que ya entró por horas, repartido por las horas de cada persona' end)::text,
         count(distinct x.persona_id)::numeric,
         case when count(distinct x.persona_id) = 1 then 'persona' else 'personas' end::text,
         null::numeric, null::numeric, 'PEN'::text, round(sum(x.monto), 2), 0, null::text, x.planilla_id
    from parte x
   where public.normalizar_codigo_interno(p_codigo) is null or x.codigo = public.normalizar_codigo_interno(p_codigo)
   group by x.codigo, x.periodo, x.planilla_id
  having round(sum(x.monto), 2) <> 0
$$;
comment on function public.codigo_interno_lineas_planilla(text) is
  'El ajuste de cada planilla de taller cerrada (costo real menos lo que entró por horas), repartido entre los códigos internos por las horas de cada persona ese mes, o por las de todos para quien no tiene ficha o no cargó horas, como líneas de mano de obra sin horas, en soles. No pide permiso: la llama codigo_interno_lineas.';
revoke all on function public.codigo_interno_lineas_planilla(text) from public, anon, authenticated;

-- 4. Lo que RR. HH. ve antes y después de cerrar ---------------------------------------------------------------
create or replace function public.rrhh_planilla_al_costo(p_planilla uuid)
returns table (persona_id uuid, trabajador_id uuid, trabajador text, como text, costo numeric, horas numeric,
               costo_horas numeric, ajuste numeric, codigos integer)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  perform public.exigir_permiso('rrhh.ver_planillas');
  if p_planilla is null then
    raise exception 'Elige la planilla.' using errcode = 'check_violation';
  end if;
  return query
    select a.persona_id, a.trabajador_id, w.nombres || ' ' || w.apellidos, a.como, a.costo, a.horas, a.costo_horas, a.ajuste, a.codigos
      from public.planilla_al_costo(p_planilla) a
      left join public.trabajadores w on w.id = a.trabajador_id;
end;
$$;
comment on function public.rrhh_planilla_al_costo(uuid) is
  'Cómo entra al costeo cada persona de una planilla de taller: su ficha, sus horas y su costo por horas del mes, y el ajuste que se reparte al cerrarla. Exige rrhh.ver_planillas.';
revoke all on function public.rrhh_planilla_al_costo(uuid) from public, anon;
grant execute on function public.rrhh_planilla_al_costo(uuid) to authenticated;

-- 5. Cerrar ya no pide el reparto por OT -------------------------------------------------------------------------
create or replace function public.cerrar_planilla(p_planilla uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid;
begin
  perform public.exigir_permiso_del_puesto('rrhh.gestionar_planillas');
  perform 1 from public.planillas where id = p_planilla and estado = 'BORRADOR' for update;
  if not found then raise exception 'La planilla no existe o ya está cerrada.'; end if;
  if not exists (select 1 from public.planilla_personas where planilla_id = p_planilla) then
    raise exception 'Agrega al menos una persona o subcontrato.';
  end if;
  update public.planillas set estado = 'CERRADA', cerrado_por = public.usuario_actual(), cerrado_en = now()
   where id = p_planilla returning id into v_id;
  return v_id;
end $$;
comment on function public.cerrar_planilla(uuid) is
  'RR. HH. cierra la planilla del mes. La de taller, al cerrarse, reparte entre los códigos internos la diferencia con lo que entró por horas (codigo_interno_lineas_planilla). Exige rrhh.gestionar_planillas.';
revoke all on function public.cerrar_planilla(uuid) from public, anon;
grant execute on function public.cerrar_planilla(uuid) to authenticated;

-- 6. El costeo del código, con el ajuste de la planilla -----------------------------------------------------------
-- La definición viva (la de la 20261022190000 con el nombre de la OC de la
-- 20261023130000 y el IGV de la parte de la 20261022210000), con una fuente más
-- al final, solo cuando se pide la mano de obra. Se conservan todos sus
-- `union all`.
create or replace function public.codigo_interno_lineas(p_codigo text, p_mano_obra boolean)
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
