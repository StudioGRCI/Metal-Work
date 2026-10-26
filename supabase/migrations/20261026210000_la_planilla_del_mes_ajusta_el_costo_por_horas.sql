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
-- mes); quien tiene horas en el reporte pero su ficha no tiene costo mensual, por
-- esas horas. Lo que ya entró por horas incluye el recargo de sus horas extras:
-- el costo real del Excel ya las trae. Quien en Personal es de planilla administrativa no entra: su costo ya
-- entra por los pagos de la oficina. Las planillas administrativa y de
-- subcontratos no se reparten: la oficina entra por sus pagos y los
-- subcontratos por Subcontratos.
--
-- El ajuste es una línea más de la mano de obra del código y se recalcula si
-- llegan horas del mes después de cerrar: lo que los códigos suman de cada
-- persona (horas, recargo y ajuste) es su costo real, si ese mes hubo horas en
-- algún código. Desde octubre de 2026, cuando empezó el reporte diario; las
-- planillas cerradas antes con su reparto por OT lo conservan en el costeo de
-- la OT. El cierre del costeo de una unidad espera la planilla de taller cerrada
-- de cada mes en que trabajó.
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
-- Desde cuándo: el reporte diario empezó en octubre de 2026. En una función, y no
-- repetida, para que el check la pueda mover dentro de su transacción.
create or replace function public.planilla_ajuste_desde()
returns date language sql stable set search_path to 'public' as $$ select date '2026-10-01' $$;
comment on function public.planilla_ajuste_desde() is
  'El primer mes cuya planilla de taller ajusta la mano de obra de los códigos por horas: octubre de 2026, cuando empezó el reporte diario. No pide permiso.';
revoke all on function public.planilla_ajuste_desde() from public, anon, authenticated;

-- Sin p_planilla: las de taller cerradas, que son las que entran al costeo. Con
-- ella: esa, esté como esté, para que RR. HH. lo vea antes de cerrar.
-- Desde octubre de 2026, cuando empezó el reporte diario: antes no hay horas
-- por código a las que repartir, y esas planillas se repartían por OT.
-- Lo que ya entró de cada persona en el mes son sus horas a su costo (el tareo)
-- y el recargo de sus horas extras que la planilla diaria pagó y llegó a un
-- código (codigo_interno_lineas_recargo): el costo real del Excel ya trae las
-- extras, así que el ajuste descuenta las dos cosas y lo que los códigos suman
-- de esa persona es su costo real.
drop function if exists public.rrhh_planilla_al_costo(uuid);
drop function if exists public.planilla_al_costo(uuid);
create or replace function public.planilla_al_costo(p_planilla uuid default null)
returns table (planilla_id uuid, periodo date, persona_id uuid, nombre text, trabajador_id uuid, como text,
               costo numeric, horas numeric, costo_horas numeric, recargo numeric, ajuste numeric, codigos integer,
               mes_con_horas boolean)
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
  ), reporte as (
    -- Las horas del reporte que no hicieron tareo: su ficha no tiene costo mensual.
    select l.trabajador_id, date_trunc('month', l.fecha)::date as periodo, sum(l.horas) as horas,
           count(distinct public.normalizar_codigo_interno(r.codigo_interno)) as codigos
      from public.reporte_diario_personal l
      join public.reportes_diarios r on r.id = l.reporte_id
     where r.anulado_en is null
       and l.trabajador_id in (select x.trabajador_id from persona x)
       and not exists (select 1 from public.tareos t where t.reporte_linea_id = l.id)
     group by l.trabajador_id, date_trunc('month', l.fecha)
  ), extra as (
    select d.trabajador_id, d.fecha,
           d.valor_hora * (d.horas_tramo1 * d.recargo_tramo1 + d.horas_tramo2 * d.recargo_tramo2) / 100 as recargo
      from public.planilla_diaria_detalle d
      join public.planilla_diaria_personas pp on pp.id = d.persona_id
      join public.planillas_diarias p on p.id = pp.planilla_id
     where d.concepto = 'EXTRAS' and p.anulado_en is null
       and d.trabajador_id in (select x.trabajador_id from persona x)
  ), jornada as (
    -- Las mismas horas validadas con que codigo_interno_lineas_recargo reparte el recargo.
    select l.trabajador_id, l.fecha, sum(l.horas) as total,
           sum(l.horas) filter (where public.normalizar_codigo_interno(r.codigo_interno) is not null) as con_codigo
      from public.reporte_diario_personal l
      join public.reportes_diarios r on r.id = l.reporte_id
     where r.anulado_en is null and r.observado_en is null
       and r.visto_gerencia_en is not null and r.visto_rrhh_en is not null
       and l.trabajador_id in (select x.trabajador_id from persona x)
     group by l.trabajador_id, l.fecha
  ), recargo as (
    select e.trabajador_id, date_trunc('month', e.fecha)::date as periodo,
           round(sum(e.recargo * coalesce(j.con_codigo, 0) / j.total), 2) as recargo
      from extra e
      join jornada j on j.trabajador_id = e.trabajador_id and j.fecha = e.fecha and j.total > 0
     group by e.trabajador_id, date_trunc('month', e.fecha)
  ), mes as (
    select distinct m.periodo from public.horas_por_codigo_del_mes(null) m
     where m.periodo in (select x.periodo from persona x)
  ), cuenta as (
    select x.*, w.planilla as planilla_ficha,
           case when x.periodo < public.planilla_ajuste_desde() then 'ANTES'
                when x.trabajador_id is null then 'SIN_FICHA'
                when w.planilla = 'ADMINISTRATIVA' then 'OFICINA'
                when coalesce(h.horas, 0) > 0 then 'HORAS'
                when coalesce(r.horas, 0) > 0 then 'SIN_COSTO'
                else 'SIN_HORAS' end as como,
           coalesce(h.horas, r.horas, 0) as horas, coalesce(h.costo, 0) as costo_horas, coalesce(c.recargo, 0) as recargo,
           coalesce(h.codigos, r.codigos, 0) as codigos,
           exists (select 1 from mes m where m.periodo = x.periodo) as mes_con_horas
      from persona x
      left join public.trabajadores w on w.id = x.trabajador_id
      left join hora h on h.trabajador_id = x.trabajador_id and h.periodo = x.periodo
      left join reporte r on r.trabajador_id = x.trabajador_id and r.periodo = x.periodo
      left join recargo c on c.trabajador_id = x.trabajador_id and c.periodo = x.periodo
  )
  select c.planilla_id, c.periodo, c.persona_id, c.nombre, c.trabajador_id, c.como, c.costo, c.horas, c.costo_horas, c.recargo,
         case c.como when 'ANTES' then 0
                     when 'OFICINA' then 0
                     when 'HORAS' then c.costo - c.costo_horas - c.recargo
                     when 'SIN_COSTO' then c.costo - c.recargo
                     else c.costo end,
         c.codigos::integer, c.mes_con_horas
    from cuenta c
$$;
comment on function public.planilla_al_costo(uuid) is
  'Por persona de la planilla de taller (las cerradas, o la de p_planilla): su ficha, cómo entra al costeo (HORAS: el ajuste por sus horas; SIN_COSTO: tiene horas en el reporte pero su ficha no tiene costo mensual, y su costo se reparte por esas horas; SIN_FICHA o SIN_HORAS: su costo entero por las horas de todos en el mes; OFICINA: no entra, va por los pagos de la oficina; ANTES: de antes de octubre de 2026, sin reporte diario), su costo real, sus horas, su costo por horas y el recargo de sus extras que ya entraron, el ajuste y si el mes tiene horas en algún código. No pide permiso.';
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
     where a.como in ('HORAS', 'SIN_COSTO', 'SIN_FICHA', 'SIN_HORAS') and a.ajuste <> 0
  ), suya as (
    -- Las horas de cada persona en cada código: las del tareo y, sin costo
    -- mensual, las del reporte (las mismas que horas_por_codigo_del_mes).
    select t.trabajador_id, date_trunc('month', t.fecha)::date as periodo,
           public.normalizar_codigo_interno(t.codigo_interno) as codigo, sum(t.horas) as horas
      from public.tareos t
     where t.anulado_en is null
       and t.trabajador_id in (select p.trabajador_id from persona p where p.como = 'HORAS')
     group by 1, 2, 3
    union all
    select l.trabajador_id, date_trunc('month', l.fecha)::date, public.normalizar_codigo_interno(r.codigo_interno), sum(l.horas)
      from public.reporte_diario_personal l
      join public.reportes_diarios r on r.id = l.reporte_id
     where r.anulado_en is null
       and l.trabajador_id in (select p.trabajador_id from persona p where p.como = 'SIN_COSTO')
       and not exists (select 1 from public.tareos t where t.reporte_linea_id = l.id)
     group by 1, 2, 3
  ), parte as (
    select p.planilla_id, p.periodo, p.persona_id, s.codigo, p.ajuste * s.horas / p.horas as monto, false as de_todos
      from persona p
      join suya s on s.trabajador_id = p.trabajador_id and s.periodo = p.periodo
     where p.como in ('HORAS', 'SIN_COSTO') and s.codigo is not null
    union all
    select p.planilla_id, p.periodo, p.persona_id, m.codigo, p.ajuste * m.horas / m.total, true
      from persona p
      join public.horas_por_codigo_del_mes(null) m on m.periodo = p.periodo
     where p.como in ('SIN_FICHA', 'SIN_HORAS')
  )
  select x.codigo, 'MANO_OBRA'::text, x.periodo,
         ('Ajuste de la planilla de taller ' || to_char(x.periodo, 'MM/YYYY'))::text,
         -- El mes en curso todavía recibe horas, como los gastos del mes: su parte es provisional.
         (case when x.periodo >= date_trunc('month', now() at time zone 'America/Lima')::date
               then 'Por ahora: el mes no termina. ' else '' end
          || case when bool_and(x.de_todos)
               then 'Costo real (bruto más EsSalud) de quien no cargó horas propias ese mes, repartido por las horas de todos'
               when bool_or(x.de_todos)
               then 'Costo real (bruto más EsSalud) menos lo que ya entró por horas y por el recargo de las extras, repartido por las horas de cada persona; quien no cargó horas propias, por las de todos'
               else 'Costo real (bruto más EsSalud) menos lo que ya entró por horas y por el recargo de las extras, repartido por las horas de cada persona' end)::text,
         count(distinct x.persona_id)::numeric,
         case when count(distinct x.persona_id) = 1 then 'persona' else 'personas' end::text,
         null::numeric, null::numeric, 'PEN'::text, round(sum(x.monto), 2), 0, null::text, x.planilla_id
    from parte x
   where public.normalizar_codigo_interno(p_codigo) is null or x.codigo = public.normalizar_codigo_interno(p_codigo)
   group by x.codigo, x.periodo, x.planilla_id
  having round(sum(x.monto), 2) <> 0
$$;
comment on function public.codigo_interno_lineas_planilla(text) is
  'El ajuste de cada planilla de taller cerrada desde octubre de 2026 (costo real menos lo que entró por horas y por el recargo de las extras), repartido entre los códigos internos por las horas de cada persona ese mes, o por las de todos para quien no tiene ficha o no cargó horas, como líneas de mano de obra sin horas, en soles. No pide permiso: la llama codigo_interno_lineas.';
revoke all on function public.codigo_interno_lineas_planilla(text) from public, anon, authenticated;

-- 4. Lo que RR. HH. ve antes y después de cerrar ---------------------------------------------------------------
-- entra: lo que de verdad llega a los códigos (en un mes sin horas en ningún
-- código, nada), para que la pantalla no prometa el ajuste teórico.
create or replace function public.rrhh_planilla_al_costo(p_planilla uuid)
returns table (persona_id uuid, trabajador_id uuid, trabajador text, como text, costo numeric, horas numeric,
               costo_horas numeric, recargo numeric, ajuste numeric, entra numeric, codigos integer, mes_con_horas boolean)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  perform public.exigir_permiso('rrhh.ver_planillas');
  if p_planilla is null then
    raise exception 'Elige la planilla.' using errcode = 'check_violation';
  end if;
  return query
    select a.persona_id, a.trabajador_id, w.nombres || ' ' || w.apellidos, a.como, a.costo, a.horas, a.costo_horas, a.recargo, a.ajuste,
           case when a.como in ('ANTES', 'OFICINA') then 0
                when a.como in ('SIN_FICHA', 'SIN_HORAS') and not a.mes_con_horas then 0
                when a.como in ('HORAS', 'SIN_COSTO') and a.codigos = 0 then 0
                else a.ajuste end,
           a.codigos, a.mes_con_horas
      from public.planilla_al_costo(p_planilla) a
      left join public.trabajadores w on w.id = a.trabajador_id;
end;
$$;
comment on function public.rrhh_planilla_al_costo(uuid) is
  'Cómo entra al costeo cada persona de una planilla de taller: su ficha, sus horas, su costo por horas y el recargo de sus extras del mes, el ajuste que se reparte al cerrarla y lo que de verdad llega a los códigos. Exige rrhh.ver_planillas.';
revoke all on function public.rrhh_planilla_al_costo(uuid) from public, anon;
grant execute on function public.rrhh_planilla_al_costo(uuid) to authenticated;

-- 5. Cerrar ya no pide el reparto por OT -------------------------------------------------------------------------
-- El reparto por OT que una planilla en preparación ya trajera no se borra: queda
-- en el costeo antiguo de la OT (detalle_costeo_ot), que no es el costo de la
-- unidad y del que salen los meses trabajados de ese costeo. El costo de la
-- unidad es el de su código, que no lo lee.
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
  'RR. HH. cierra la planilla del mes, sin pedir el reparto por OT. La de taller, al cerrarse, reparte entre los códigos internos la diferencia con lo que entró por horas (codigo_interno_lineas_planilla). Exige rrhh.gestionar_planillas.';
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

-- 7. El cierre del costeo espera la planilla de taller de cada mes -------------------------------------------------
-- El ajuste de la planilla de taller es parte de la mano de obra: cerrar el
-- costeo de una unidad antes de que RR. HH. cierre la planilla de un mes en que
-- trabajó la dejaría congelada sin esa parte. Desde octubre de 2026, como el ajuste.
create or replace function public.meses_sin_planilla_taller(p_codigo text)
returns table (periodo date)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_mes date := date_trunc('month', now() at time zone 'America/Lima')::date;
begin
  if public.usuario_actual() is not null
     and not (public.es_admin() or public.tiene_permiso('codigos_internos.cerrar') or public.tiene_permiso('codigos_internos.ver')
              or public.tiene_permiso('costos.ver')) then
    raise exception 'No tiene el permiso codigos_internos.ver, codigos_internos.cerrar ni costos.ver para realizar esta operación'
      using errcode = 'insufficient_privilege';
  end if;
  -- El mes en curso ya lo espera el cierre por su cuenta («que termine el mes»).
  return query
  select distinct h.periodo
    from public.horas_por_codigo_del_mes(null) h
   where h.codigo = public.normalizar_codigo_interno(p_codigo)
     and h.periodo >= public.planilla_ajuste_desde() and h.periodo < v_mes
     and not exists (select 1 from public.planillas p
                      where p.tipo = 'TALLER' and p.estado = 'CERRADA' and p.periodo = h.periodo)
   order by h.periodo;
end;
$$;
comment on function public.meses_sin_planilla_taller(text) is
  'Los meses ya terminados (desde octubre de 2026) en que el código interno tuvo horas y la planilla de taller todavía no está cerrada: su ajuste no entró. El cierre del costeo los espera. Exige codigos_internos.ver, codigos_internos.cerrar o costos.ver.';
revoke all on function public.meses_sin_planilla_taller(text) from public, anon;
grant execute on function public.meses_sin_planilla_taller(text) to authenticated;

-- La misma función vigente (la de la 20261020120000 con las frases de la 20261020174600 y la
-- 20261026160000), con una condición más al final de lo que falta.
create or replace function public.cerrar_costeo_codigo(p_codigo text, p_observacion text default null)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_codigo text := public.normalizar_codigo_interno(p_codigo);
  v_id uuid;
  k record;
  v_falta text[] := '{}';
  v_fuentes jsonb;
  v_meses text;
begin
  perform public.exigir_permiso('codigos_internos.cerrar');
  if v_codigo is null then
    raise exception 'Indica el código interno.' using errcode = 'check_violation';
  end if;
  if v_codigo = 'PLANTA' then
    raise exception 'PLANTA no es una unidad: su costeo no se cierra.' using errcode = 'check_violation';
  end if;
  -- El sistema no sabe todavía cuándo se entrega una unidad: lo dice Gerencia al cerrar.
  if char_length(btrim(coalesce(p_observacion, ''))) not between 10 and 500 then
    raise exception 'Escribe cómo y cuándo se entregó la unidad (de 10 a 500 caracteres).' using errcode = 'check_violation';
  end if;
  -- Un reintento no cierra dos veces.
  select id into v_id from public.codigo_interno_cierres where codigo = v_codigo and reabierto_en is null;
  if found then
    return v_id;
  end if;

  select * into k from public.codigos_internos_costo_calculado(v_codigo) where codigo = v_codigo;
  if not found then
    raise exception 'El código % no tiene costos que cerrar.', v_codigo using errcode = 'check_violation';
  end if;
  if k.materiales_sin_precio > 0 then
    v_falta := v_falta || (k.materiales_sin_precio || case when k.materiales_sin_precio = 1 then ' salida del almacén sin precio (la valoriza Logística)'
                                                      else ' salidas del almacén sin precio (las valoriza Logística)' end);
  end if;
  if k.horas_sin_costo > 0 then
    v_falta := v_falta || (trim(to_char(k.horas_sin_costo, 'FM999990.##')) || ' h de personal sin costo mensual (lo pone RR. HH.)');
  end if;
  if k.lineas_sin_cambio > 0 then
    v_falta := v_falta || (k.lineas_sin_cambio || case when k.lineas_sin_cambio = 1 then ' línea en dólares sin tipo de cambio' else ' líneas en dólares sin tipo de cambio' end
                           || ' (lo registran Contabilidad o Administración)');
  end if;
  -- Con cotización aprobada, el cierre congela también el margen: sin el IGV
  -- confirmado o sin el cambio del día de la venta en dólares quedaría congelado
  -- sin margen, y nada empujaría después a reabrirlo.
  if k.cotizaciones > 0 and k.venta_sin_igv_confirmado > 0 then
    v_falta := v_falta || (case when k.venta_sin_igv_confirmado = 1 then 'confirmar si la cotización incluye IGV'
                                else 'confirmar si ' || k.venta_sin_igv_confirmado || ' cotizaciones incluyen IGV' end
                           || ' (Gerencia o Administración en el expediente de la OT, o Ventas al corregir la cotización)');
  end if;
  if k.cotizaciones > 0 and k.venta_sin_cambio > 0 then
    v_falta := v_falta || 'el tipo de cambio del día en que se aprobó la cotización en dólares (lo registran Contabilidad o Administración)'::text;
  end if;
  -- Los gastos del mes y el sueldo de la oficina se reparten por las horas de
  -- todo el mes (migración 20261020110000): cerrado a mitad de mes, la unidad se
  -- quedaría con una parte que el resto del mes todavía mueve.
  if exists (select 1 from public.horas_por_codigo_del_mes((now() at time zone 'America/Lima')::date) h where h.codigo = v_codigo) then
    v_falta := v_falta || ('que termine el mes ' || to_char(now() at time zone 'America/Lima', 'MM/YYYY')
                           || ': los gastos del mes y el sueldo de la oficina se reparten por las horas de todo el mes');
  end if;
  -- El sueldo de la oficina sale de los pagos que registra RR. HH. (migración
  -- 20261020120000): con días de la oficina sin pago en un mes en que la unidad
  -- trabajó, quedaría congelada sin esa parte.
  -- En una variable aparte: un select into sin filas dejaría v_falta en null y el cierre pasaría.
  select string_agg(to_char(m.periodo, 'MM/YYYY'), ', ' order by m.periodo) into v_meses
    from public.meses_sin_pagos_oficina(v_codigo) m;
  if v_meses is not null then
    v_falta := v_falta || ('registrar los pagos de la oficina de ' || v_meses
                           || ' (RR. HH.: los pagos, o la fecha de ingreso de quien entró después)');
  end if;
  -- El ajuste de la planilla de taller del mes entra al cerrarla (20261026210000).
  v_meses := null;
  select string_agg(to_char(m.periodo, 'MM/YYYY'), ', ' order by m.periodo) into v_meses
    from public.meses_sin_planilla_taller(v_codigo) m;
  if v_meses is not null then
    v_falta := v_falta || ('cerrar la planilla de taller de ' || v_meses
                           || ' (RR. HH., en Planillas: al cerrarla entra el ajuste de la mano de obra)');
  end if;
  if cardinality(v_falta) > 0 then
    raise exception 'El costeo de % todavía no está completo: falta %.', v_codigo, array_to_string(v_falta, '; ')
      using errcode = 'check_violation';
  end if;
  if k.costo_pen <= 0 then
    raise exception 'El código % todavía no tiene costo cargado: no hay nada que congelar.', v_codigo
      using errcode = 'check_violation';
  end if;

  select coalesce(jsonb_object_agg(f.fuente, f.total), '{}'::jsonb) into v_fuentes
    from (select l.fuente, sum(case when l.moneda = 'PEN' then l.monto
                                    else round(l.monto * public.cambio_del_dia(l.fecha, 'VENTA'), 2) end) as total
            from public.codigo_interno_lineas(v_codigo, true) l
           where l.fuente in ('MANO_OBRA', 'RECARGO_EXTRAS', 'MATERIALES', 'SERVICIOS', 'SUBCONTRATOS',
                              'SUBCONTRATOS_POR_PAGAR', 'GASTOS_DEL_MES', 'CAJA', 'GASTOS_OT', 'MERMA')
           group by l.fuente) f;

  insert into public.codigo_interno_cierres (codigo, costo_pen, precio_neto_pen, margen_pen, margen_pct, por_fuente, observacion)
  values (v_codigo, k.costo_pen, k.precio_neto_pen, k.margen_pen, k.margen_pct, v_fuentes, nullif(btrim(coalesce(p_observacion, '')), ''))
  returning id into v_id;
  return v_id;
end;
$$;
comment on function public.cerrar_costeo_codigo(text, text) is
  'Gerencia cierra el costeo de un código interno al entregar la unidad: congela su costo, su precio sin IGV y su margen, con quién, cuándo y cómo se entregó (la observación, obligatoria). Solo con todo lo que suma completo (también los pagos de la oficina y la planilla de taller cerrada de cada mes en que trabajó) y, si tiene cotización, con su precio sin IGV en soles. Un reintento devuelve el cierre vigente. Exige codigos_internos.cerrar.';
revoke all on function public.cerrar_costeo_codigo(text, text) from public, anon;
grant execute on function public.cerrar_costeo_codigo(text, text) to authenticated;
