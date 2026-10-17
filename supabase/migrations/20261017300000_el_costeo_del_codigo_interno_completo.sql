-- =============================================================================
-- EL COSTEO DEL CÓDIGO INTERNO, COMPLETO Y CON SU MARGEN
-- -----------------------------------------------------------------------------
-- Gerencia pidió (2026-10-17), antes del manual, revisar si estaba completo el
-- costeo de un código interno. La revisión (informe en la carpeta del
-- proyecto, «costeo-codigo-interno») encontró que el código sumaba bien la
-- mano de obra, los materiales salidos del almacén, las órdenes de servicio y
-- los recibos por honorarios, pero que dejaba fuera cosas que la empresa sí
-- cuenta en su hoja RESUMEN, y que no decía cuánto quedaba entre lo vendido y
-- lo gastado. Aquí entra lo que faltaba:
--
--   * GASTOS DEL MES. Luz, agua, celulares, internet, seguros, seguridad y
--     depreciación, que Administración registra en «Gastos del mes» con la tasa
--     de la hoja. Hasta hoy solo llegaban a la OT. Ahora van a cada código que
--     trabajó ese mes (horas en el reporte diario o de RR. HH., o una salida
--     del almacén): con TASA, cada código lleva esa tasa del gasto (la luz al
--     8 %); en PARTES IGUALES, el gasto se divide entre esos códigos. PLANTA no
--     recibe: es la planta misma.
--   * EGRESOS DE CAJA. El egreso que Tesorería escribe a mano en la caja diaria
--     con el código de una unidad (movilidad, caja chica, un trámite de placas,
--     la comisión de venta) entra a su costo. El que viene de un pago del
--     sistema (OC, OS, recibo, planilla) no, porque ese costo ya está contado;
--     la pantalla de la caja pide no poner el código en el pago de una OC, OS
--     o recibo escrito a mano, por lo mismo.
--   * RECARGO DE LAS HORAS EXTRAS. El tareo cuesta cada hora igual. Lo que la
--     planilla diaria paga de más por las extras (25 % las dos primeras del
--     día, 35 % las demás, o lo que fije RR. HH.) entra como mano de obra de
--     los códigos que esa persona trabajó ese día, en proporción a sus horas.
--   * EL MARGEN. La cotización aprobada del código, sin IGV, menos el costo.
--     Los dólares van a soles con el tipo de cambio de Tesorería: el costo al
--     de venta del día de cada línea, el precio al de compra del día en que se
--     aprobó (la misma regla que el margen de la OT). Con el precio sale
--     también el presupuesto de la hoja (el precio sin IGV menos la utilidad
--     estándar del 15 %) y su semáforo: pasado, excedido; del 90 % en
--     adelante, ajustado. El de la OT miraba además su avance; el del código
--     no, porque el avance del código solo lo ve Gerencia y Administración
--     también lee este semáforo en su Dashboard.
--   * EL CIERRE. Gerencia cierra el costeo del código cuando la unidad se
--     entrega: queda congelado el costo y el margen de ese momento, con quién
--     y cuándo. Lo que llegue después (un recibo tardío, un precio nuevo de
--     Logística) se ve como diferencia contra lo cerrado. Se reabre con motivo.
--
-- Un solo costo: el Dashboard de Administración y la ficha de la unidad leen
-- este mismo costo cuando la OT tiene código interno, en vez del costeo viejo
-- de la OT, que no ve el tareo, las OS por código ni los subcontratos.
--
-- El resumen de la lista y las funciones de servicios y subcontratos no cambian
-- sus columnas: el costo completo sale de `codigos_internos_costo`. Requerimientos
-- sigue viendo solo los materiales y las compras: las líneas nuevas solo salen
-- cuando se pide la mano de obra, que es lo que pide Gerencia.
--
-- Nada se borra ni se reemplaza por otra firma: el conector de producción no lo
-- deja pasar.
-- =============================================================================

-- 1. El permiso de cerrar el costeo ----------------------------------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('codigos_internos.cerrar', 'Costos',
   'Cerrar el costeo de un código interno cuando la unidad se entrega, y reabrirlo con su motivo')
on conflict (codigo) do nothing;

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, 'codigos_internos.cerrar' from public.roles r where r.codigo = 'GERENTE'
on conflict do nothing;

-- 2. Los egresos de caja de un código (o de todos) ---------------------------------------
-- No pide permiso: solo la llama codigo_interno_lineas, que la llama quien pide el suyo.
create or replace function public.codigo_interno_lineas_caja(p_codigo text)
returns table (codigo text, fuente text, fecha date, concepto text, detalle text, cantidad numeric, unidad text,
               horas numeric, precio_unitario numeric, moneda text, monto numeric, sin_precio integer,
               documento text, referencia_id uuid)
language sql stable set search_path to 'public' as $$
  select public.normalizar_codigo_interno(m.codigo_interno), 'CAJA'::text, m.fecha,
         m.descripcion::text, c.nombre::text,
         1::numeric, 'egreso'::text, null::numeric,
         m.monto, c.moneda::text, m.monto, 0, m.operacion::text, m.id
    from public.movimientos_caja m
    join public.cajas c on c.id = m.caja_id
   where m.tipo = 'EGRESO' and m.origen = 'MANUAL' and m.anulado_en is null
     and public.normalizar_codigo_interno(m.codigo_interno) is not null
     and (public.normalizar_codigo_interno(p_codigo) is null
          or public.normalizar_codigo_interno(m.codigo_interno) = public.normalizar_codigo_interno(p_codigo))
$$;
comment on function public.codigo_interno_lineas_caja(text) is
  'Los egresos que Tesorería escribió a mano en la caja diaria con el código interno (o todos), como líneas del costeo, en la moneda de su cuenta. Sin los anulados ni los que deja un pago del sistema (OC, OS, recibo, planilla), que ya están contados. No pide permiso: la llama codigo_interno_lineas.';
revoke all on function public.codigo_interno_lineas_caja(text) from public, anon, authenticated;

-- 3. El recargo de las horas extras pagadas ------------------------------------------------
-- Cada día de extras que entró a una planilla diaria vigente lleva su recargo:
-- la hora de la planilla por las horas de cada tramo y su porcentaje. Se reparte
-- entre los códigos de los reportes validados de esa persona ese día (los mismos
-- que hicieron la jornada, `jornadas_validadas`), por sus horas. Lo de un
-- reporte sin código no va a ninguno.
create or replace function public.codigo_interno_lineas_recargo(p_codigo text)
returns table (codigo text, fuente text, fecha date, concepto text, detalle text, cantidad numeric, unidad text,
               horas numeric, precio_unitario numeric, moneda text, monto numeric, sin_precio integer,
               documento text, referencia_id uuid)
language sql stable set search_path to 'public' as $$
  with extra as (
    select d.id, d.trabajador_id, d.fecha, d.horas, p.id as planilla_id, p.numero,
           d.valor_hora * (d.horas_tramo1 * d.recargo_tramo1 + d.horas_tramo2 * d.recargo_tramo2) / 100 as recargo
      from public.planilla_diaria_detalle d
      join public.planilla_diaria_personas pp on pp.id = d.persona_id
      join public.planillas_diarias p on p.id = pp.planilla_id
     where d.concepto = 'EXTRAS' and p.anulado_en is null
  ), jornada as (
    select l.trabajador_id, l.fecha, public.normalizar_codigo_interno(r.codigo_interno) as codigo, sum(l.horas) as horas
      from public.reporte_diario_personal l
      join public.reportes_diarios r on r.id = l.reporte_id
     where r.anulado_en is null and r.observado_en is null
       and r.visto_gerencia_en is not null and r.visto_rrhh_en is not null
     group by 1, 2, 3
  ), parte as (
    select e.*, j.codigo, j.horas / nullif(sum(j.horas) over (partition by e.id), 0) as parte
      from extra e
      join jornada j on j.trabajador_id = e.trabajador_id and j.fecha = e.fecha
  )
  select x.codigo, 'RECARGO_EXTRAS'::text, x.fecha, 'Recargo de las horas extras pagadas'::text,
         ('Planilla diaria ' || x.numero)::text,
         count(distinct x.trabajador_id)::numeric,
         case when count(distinct x.trabajador_id) = 1 then 'persona' else 'personas' end::text,
         round(sum(x.horas * x.parte), 2), null::numeric, 'PEN'::text,
         round(sum(x.recargo * x.parte), 2), 0, x.numero::text, x.planilla_id
    from parte x
   where x.codigo is not null and x.parte is not null
     and (public.normalizar_codigo_interno(p_codigo) is null or x.codigo = public.normalizar_codigo_interno(p_codigo))
   group by x.codigo, x.fecha, x.numero, x.planilla_id
$$;
comment on function public.codigo_interno_lineas_recargo(text) is
  'Lo que la planilla diaria pagó de recargo por las horas extras, repartido entre los códigos internos que cada persona trabajó ese día según sus horas validadas, como líneas del costeo (en soles). Sin las planillas anuladas. No pide permiso: la llama codigo_interno_lineas.';
revoke all on function public.codigo_interno_lineas_recargo(text) from public, anon, authenticated;

-- 4. El costeo del código, con los gastos del mes, la caja y el recargo ----------------------
-- La misma función de la migración 20261016700000 (con sus servicios y sus
-- subcontratos al final, que se conservan), más las tres fuentes nuevas. Las
-- tres solo salen cuando se pide la mano de obra (Gerencia): el gasto por
-- código de Requerimientos y las OC del código la piden sin ella.
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
  ), movido as (
    -- Los códigos que trabajaron cada mes: con horas del reporte diario o de
    -- RR. HH., o con una salida del almacén. PLANTA no recibe gastos del mes.
    select distinct date_trunc('month', h.fecha)::date as periodo, h.codigo
      from horas h
     where h.codigo is not null and h.codigo <> 'PLANTA'
    union
    select distinct date_trunc('month', s.registrado_en at time zone 'America/Lima')::date, s.codigo
      from salida s
     where p_mano_obra and s.codigo is not null and s.codigo <> 'PLANTA' and s.cantidad > 0
  ), gasto_mes as (
    -- Con TASA, cada código lleva esa tasa del gasto; en partes iguales, su parte.
    select m.codigo, g.id, g.periodo, g.descripcion, g.monto, g.moneda, g.reparto, g.tasa, c.nombre,
           count(*) over (partition by g.id) as n
      from public.gastos_generales_mes g
      join public.conceptos_gasto_general c on c.codigo = g.concepto
      join movido m on m.periodo = g.periodo
     where p_mano_obra and g.estado = 'ACTIVO'
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
  select g.codigo, 'GASTOS_DEL_MES', g.periodo, (g.nombre || ' ' || to_char(g.periodo, 'MM/YYYY'))::text,
         (case when g.reparto = 'TASA' then trim(to_char(g.tasa, 'FM990.999')) || ' % de ' || g.descripcion
               when g.n = 1 then 'Todo a este código, el único que trabajó ese mes · ' || g.descripcion
               else 'Partes iguales entre los ' || g.n || ' códigos que trabajaron ese mes · ' || g.descripcion end)::text,
         1::numeric, null::text, null::numeric, g.monto, g.moneda::text,
         case when g.reparto = 'TASA' then round(g.monto * g.tasa / 100, 2) else round(g.monto / g.n, 2) end,
         0, null::text, g.id
    from gasto_mes g
   where v_codigo is null or g.codigo = v_codigo
  union all
  select * from public.codigo_interno_lineas_servicio(v_codigo)
  union all
  select * from public.codigo_interno_lineas_subcontrato(v_codigo)
  union all
  select * from public.codigo_interno_lineas_caja(v_codigo) where p_mano_obra
  union all
  select * from public.codigo_interno_lineas_recargo(v_codigo) where p_mano_obra
   order by 1, 3 desc, 2, 4;
end;
$$;
comment on function public.codigo_interno_lineas(text, boolean) is
  'Las líneas del costeo de un código interno (o de todos), sin pedir permiso: mano de obra, materiales, compras (no van al total; la OC con insumos de varios códigos se reparte entre ellos), órdenes de servicio, recibos por honorarios de los subcontratos y, cuando se pide la mano de obra, los gastos del mes, los egresos de caja con el código y el recargo de las horas extras. Solo la llaman codigo_interno_costeo (Gerencia), codigos_internos_costo, codigo_interno_gasto y codigos_internos_gasto (Requerimientos, sin la mano de obra) y codigo_interno_compras.';
revoke all on function public.codigo_interno_lineas(text, boolean) from public, anon, authenticated;

comment on function public.codigo_interno_costeo(text) is
  'Las líneas del costeo de un código interno (o de todos): mano de obra con y sin costo, recargo de horas extras, materiales con y sin precio, compras (no van al total), órdenes de servicio, recibos por honorarios de los subcontratos, gastos del mes y egresos de caja con el código. Exige codigos_internos.ver.';

-- 5. El cierre del costeo -------------------------------------------------------------------
-- Una fila por cierre. El vigente es el que no se reabrió; el reabierto queda
-- como evidencia, con su motivo. Se escribe solo por las funciones de abajo.
create table if not exists public.codigo_interno_cierres (
  id                   uuid primary key default gen_random_uuid(),
  codigo               text not null,
  costo_pen            numeric(14, 2) not null,
  precio_neto_pen      numeric(14, 2),
  margen_pen           numeric(14, 2),
  margen_pct           numeric(7, 1),
  -- El costo por fuente al cerrar, para comparar después.
  por_fuente           jsonb not null,
  observacion          text,
  cerrado_por          uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  cerrado_en           timestamptz not null default now(),
  reabierto_por        uuid references public.usuarios(id) on delete restrict,
  reabierto_en         timestamptz,
  motivo_reapertura    text,
  creado_en            timestamptz not null default now(),
  actualizado_en       timestamptz not null default now(),
  constraint ck_codigo_interno_cierre_datos check (
    char_length(codigo) between 2 and 60 and costo_pen >= 0 and jsonb_typeof(por_fuente) = 'object'
    and (observacion is null or char_length(btrim(observacion)) between 1 and 500)),
  constraint ck_codigo_interno_cierre_reabierto check (
    (reabierto_en is null and reabierto_por is null and motivo_reapertura is null)
    or (reabierto_en is not null and reabierto_por is not null
        and char_length(btrim(coalesce(motivo_reapertura, ''))) between 10 and 500))
);
comment on table public.codigo_interno_cierres is
  'El costeo cerrado de cada código interno: el costo, el precio y el margen al entregar la unidad, con quién y cuándo. El reabierto queda con su motivo. No se borra.';
-- Un solo cierre vigente por código; la pantalla lo busca por código (b).
create unique index if not exists uq_codigo_interno_cierre_vigente
  on public.codigo_interno_cierres (codigo) where reabierto_en is null;
alter table public.codigo_interno_cierres enable row level security;
revoke all on public.codigo_interno_cierres from public, anon, authenticated;
grant select on public.codigo_interno_cierres to authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'codigo_interno_cierres'
                    and policyname = 'ver_codigo_interno_cierres') then
    create policy ver_codigo_interno_cierres on public.codigo_interno_cierres for select to authenticated using (
      public.es_admin() or public.tiene_permiso('codigos_internos.ver') or public.tiene_permiso('costos.ver'));
  end if;
end $$;
select public.activar_timestamps('codigo_interno_cierres');
select public.activar_auditoria('codigo_interno_cierres');
select public.activar_registro_de_prueba('codigo_interno_cierres');

-- 6. El costo completo y el margen de cada código, sin pedir permiso ---------------------------
-- La cuenta que comparten la lista, el detalle, el Dashboard de Administración
-- y el cierre. Suman: la mano de obra con costo y su recargo, los materiales con
-- precio, las OS aprobadas, los recibos por honorarios, los gastos del mes y los
-- egresos de caja. Los dólares van a soles al cambio de venta del día de cada
-- línea; la que no tiene cambio cargado se cuenta aparte y no suma.
create or replace function public.codigos_internos_costo_calculado(p_codigo text)
returns table (
  codigo text, mano_obra numeric, recargo_extras numeric,
  gastos_mes_pen numeric, gastos_mes_usd numeric,
  caja_pen numeric, caja_usd numeric, egresos_caja integer,
  costo_pen numeric, usd_sin_cambio numeric, lineas_sin_cambio integer,
  materiales_sin_precio integer, horas_sin_costo numeric,
  cotizaciones integer, moneda_venta text, precio_venta_pen numeric, precio_venta_usd numeric,
  venta_sin_igv_confirmado integer, venta_sin_cambio integer, precio_neto_pen numeric,
  margen_pen numeric, margen_pct numeric,
  presupuesto_pen numeric, consumido_pct numeric, semaforo text,
  cierre_id uuid, cerrado_en timestamptz, cerrado_por text,
  costo_cerrado_pen numeric, margen_cerrado_pen numeric, margen_cerrado_pct numeric
)
language plpgsql stable set search_path to 'public' as $$
#variable_conflict use_column
declare
  -- La tasa del IGV en el Perú desde 2011, y la utilidad estándar de la hoja RESUMEN.
  c_igv constant numeric := 0.18;
  c_utilidad constant numeric := 0.15;
  v_codigo text := public.normalizar_codigo_interno(p_codigo);
begin
  return query
  with linea as (
    select k.*,
           k.fuente in ('MANO_OBRA', 'RECARGO_EXTRAS', 'MATERIALES', 'SERVICIOS', 'SUBCONTRATOS',
                        'SUBCONTRATOS_POR_PAGAR', 'GASTOS_DEL_MES', 'CAJA') as suma,
           case when k.moneda = 'USD' then public.cambio_del_dia(k.fecha, 'VENTA') end as cambio
      from public.codigo_interno_lineas(v_codigo, true) k
     where k.codigo is not null
  ), costo as (
    select l.codigo,
           coalesce(sum(l.monto) filter (where l.fuente = 'MANO_OBRA'), 0)::numeric as mano_obra,
           coalesce(sum(l.monto) filter (where l.fuente = 'RECARGO_EXTRAS'), 0)::numeric as recargo,
           coalesce(sum(l.monto) filter (where l.fuente = 'GASTOS_DEL_MES' and l.moneda = 'PEN'), 0)::numeric as gastos_pen,
           coalesce(sum(l.monto) filter (where l.fuente = 'GASTOS_DEL_MES' and l.moneda = 'USD'), 0)::numeric as gastos_usd,
           coalesce(sum(l.monto) filter (where l.fuente = 'CAJA' and l.moneda = 'PEN'), 0)::numeric as caja_pen,
           coalesce(sum(l.monto) filter (where l.fuente = 'CAJA' and l.moneda = 'USD'), 0)::numeric as caja_usd,
           count(*) filter (where l.fuente = 'CAJA')::integer as egresos_caja,
           coalesce(sum(case when l.moneda = 'PEN' then l.monto else round(l.monto * l.cambio, 2) end)
                      filter (where l.suma and (l.moneda = 'PEN' or l.cambio is not null)), 0)::numeric as costo_pen,
           coalesce(sum(l.monto) filter (where l.suma and l.moneda = 'USD' and l.cambio is null), 0)::numeric as usd_sin_cambio,
           count(*) filter (where l.suma and l.moneda = 'USD' and l.cambio is null)::integer as sin_cambio,
           count(*) filter (where l.fuente = 'MATERIALES_SIN_PRECIO')::integer as sin_precio,
           coalesce(sum(l.horas) filter (where l.fuente = 'MANO_OBRA_SIN_COSTO'), 0)::numeric as horas_sin_costo
      from linea l
     group by l.codigo
  ), cotizacion as (
    -- La cotización aprobada (o aprobada antes de una corrección) de la OT del código.
    select public.codigo_interno_de_cotizacion(c.id) as codigo, c.moneda::text as moneda, c.monto_venta::numeric as monto,
           ig.incluye_igv, (coalesce(c.revisado_en, c.creado_en) at time zone 'America/Lima')::date as fecha
      from public.cotizaciones_pdf c
      left join public.cotizaciones_pdf_igv ig on ig.cotizacion_id = c.id
     where c.estado::text <> 'ANULADA' and c.monto_venta is not null and public.cotizacion_fue_aprobada(c.id)
  ), venta_linea as (
    select v.*,
           case when v.incluye_igv then round(v.monto / (1 + c_igv), 2) when v.incluye_igv = false then v.monto end as neto,
           case when v.moneda = 'USD' then public.cambio_del_dia(v.fecha, 'COMPRA') end as cambio
      from cotizacion v
     where v.codigo is not null and (v_codigo is null or v.codigo = v_codigo)
  ), venta as (
    select v.codigo, count(*)::integer as cotizaciones,
           string_agg(distinct v.moneda, '+' order by v.moneda) as moneda,
           coalesce(sum(v.monto) filter (where v.moneda = 'PEN'), 0)::numeric as pen,
           coalesce(sum(v.monto) filter (where v.moneda = 'USD'), 0)::numeric as usd,
           count(*) filter (where v.incluye_igv is null)::integer as sin_igv,
           count(*) filter (where v.moneda = 'USD' and v.cambio is null)::integer as sin_cambio,
           -- Si falta saber el IGV o el cambio de alguna, el precio no se adivina.
           case when bool_and(v.neto is not null and (v.moneda = 'PEN' or v.cambio is not null))
                then sum(case when v.moneda = 'PEN' then v.neto else round(v.neto * v.cambio, 2) end) end as neto_pen
      from venta_linea v
     group by v.codigo
  ), cierre as (
    select z.* from public.codigo_interno_cierres z
     where z.reabierto_en is null and (v_codigo is null or z.codigo = v_codigo)
  ), codigos as (
    select k.codigo from costo k union select v.codigo from venta v union select z.codigo from cierre z
  )
  select c.codigo,
         coalesce(k.mano_obra, 0), coalesce(k.recargo, 0),
         coalesce(k.gastos_pen, 0), coalesce(k.gastos_usd, 0),
         coalesce(k.caja_pen, 0), coalesce(k.caja_usd, 0), coalesce(k.egresos_caja, 0),
         coalesce(k.costo_pen, 0), coalesce(k.usd_sin_cambio, 0), coalesce(k.sin_cambio, 0),
         coalesce(k.sin_precio, 0), coalesce(k.horas_sin_costo, 0),
         coalesce(v.cotizaciones, 0), v.moneda, v.pen, v.usd,
         coalesce(v.sin_igv, 0), coalesce(v.sin_cambio, 0), v.neto_pen,
         case when v.neto_pen is not null then v.neto_pen - coalesce(k.costo_pen, 0) end,
         case when v.neto_pen > 0 then round((v.neto_pen - coalesce(k.costo_pen, 0)) / v.neto_pen * 100, 1) end,
         p.presupuesto,
         case when p.presupuesto > 0 then round(coalesce(k.costo_pen, 0) / p.presupuesto * 100, 1) end,
         -- Pasado el presupuesto, excedido; del 90 % en adelante, ajustado.
         case when p.presupuesto is null then null
              when coalesce(k.costo_pen, 0) > p.presupuesto then 'EXCEDIDO'
              when coalesce(k.costo_pen, 0) >= p.presupuesto * 0.9 then 'AJUSTADO'
              else 'EN_RANGO' end,
         z.id, z.cerrado_en, public.puesto_de(z.cerrado_por), z.costo_pen, z.margen_pen, z.margen_pct
    from codigos c
    left join costo k on k.codigo = c.codigo
    left join venta v on v.codigo = c.codigo
    left join cierre z on z.codigo = c.codigo
    cross join lateral (select round(v.neto_pen / (1 + c_utilidad), 2) as presupuesto) p
   where c.codigo is not null
   order by 1;
end;
$$;
comment on function public.codigos_internos_costo_calculado(text) is
  'El costo completo de cada código interno (o de uno) en soles, con lo que falta para que esté completo, el precio de su cotización aprobada sin IGV, el margen, el presupuesto con su semáforo y el cierre vigente. Sin pedir permiso: la llaman codigos_internos_costo y cerrar_costeo_codigo.';
revoke all on function public.codigos_internos_costo_calculado(text) from public, anon, authenticated;

-- 7. Lo mismo, por su puerta -----------------------------------------------------------------
-- Gerencia (codigos_internos.ver) y quien ve el costo de las OT (costos.ver: el
-- Dashboard de Administración y la ficha de la unidad). El precio, el margen y
-- el presupuesto solo para quien ve el precio de venta (la misma llave que el
-- margen de la OT).
create or replace function public.codigos_internos_costo(p_codigo text default null)
returns table (
  codigo text, mano_obra numeric, recargo_extras numeric,
  gastos_mes_pen numeric, gastos_mes_usd numeric,
  caja_pen numeric, caja_usd numeric, egresos_caja integer,
  costo_pen numeric, usd_sin_cambio numeric, lineas_sin_cambio integer,
  materiales_sin_precio integer, horas_sin_costo numeric,
  cotizaciones integer, moneda_venta text, precio_venta_pen numeric, precio_venta_usd numeric,
  venta_sin_igv_confirmado integer, venta_sin_cambio integer, precio_neto_pen numeric,
  margen_pen numeric, margen_pct numeric,
  presupuesto_pen numeric, consumido_pct numeric, semaforo text,
  cierre_id uuid, cerrado_en timestamptz, cerrado_por text,
  costo_cerrado_pen numeric, margen_cerrado_pen numeric, margen_cerrado_pct numeric
)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_precio boolean;
begin
  if not (public.es_admin() or public.tiene_permiso('codigos_internos.ver') or public.tiene_permiso('costos.ver')) then
    raise exception 'No tiene el permiso codigos_internos.ver ni costos.ver para realizar esta operación'
      using errcode = 'insufficient_privilege';
  end if;
  v_precio := public.es_admin() or public.tiene_permiso('cotizaciones.ver_pdf_comercial');
  return query
  select k.codigo, k.mano_obra, k.recargo_extras, k.gastos_mes_pen, k.gastos_mes_usd,
         k.caja_pen, k.caja_usd, k.egresos_caja, k.costo_pen, k.usd_sin_cambio, k.lineas_sin_cambio,
         k.materiales_sin_precio, k.horas_sin_costo,
         case when v_precio then k.cotizaciones end, case when v_precio then k.moneda_venta end,
         case when v_precio then k.precio_venta_pen end, case when v_precio then k.precio_venta_usd end,
         case when v_precio then k.venta_sin_igv_confirmado end, case when v_precio then k.venta_sin_cambio end,
         case when v_precio then k.precio_neto_pen end,
         case when v_precio then k.margen_pen end, case when v_precio then k.margen_pct end,
         case when v_precio then k.presupuesto_pen end, case when v_precio then k.consumido_pct end,
         case when v_precio then k.semaforo end,
         k.cierre_id, k.cerrado_en, k.cerrado_por, k.costo_cerrado_pen,
         case when v_precio then k.margen_cerrado_pen end, case when v_precio then k.margen_cerrado_pct end
    from public.codigos_internos_costo_calculado(p_codigo) k;
end;
$$;
comment on function public.codigos_internos_costo(text) is
  'El costo completo de cada código interno (o de uno) en soles, lo que le falta para estar completo y su cierre. El precio de venta, el margen, el presupuesto y el semáforo solo con cotizaciones.ver_pdf_comercial. Exige codigos_internos.ver o costos.ver.';
revoke all on function public.codigos_internos_costo(text) from public, anon;
grant execute on function public.codigos_internos_costo(text) to authenticated;

-- 8. Cerrar y reabrir el costeo ------------------------------------------------------------------
-- Se cierra con todo lo que suma completo: sin salidas sin precio, sin horas sin
-- costo y sin dólares sin cambio. Lo que está por aprobar o por pagar no impide
-- cerrar: lo por pagar ya suma, y la OS por aprobar todavía no es costo.
create or replace function public.cerrar_costeo_codigo(p_codigo text, p_observacion text default null)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_codigo text := public.normalizar_codigo_interno(p_codigo);
  v_id uuid;
  k record;
  v_falta text[] := '{}';
  v_fuentes jsonb;
begin
  perform public.exigir_permiso('codigos_internos.cerrar');
  if v_codigo is null then
    raise exception 'Indica el código interno.' using errcode = 'check_violation';
  end if;
  if v_codigo = 'PLANTA' then
    raise exception 'PLANTA no es una unidad: su costeo no se cierra.' using errcode = 'check_violation';
  end if;
  if p_observacion is not null and char_length(btrim(p_observacion)) > 500 then
    raise exception 'La observación pasa de 500 caracteres.' using errcode = 'check_violation';
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
                           || ' (lo carga Tesorería)');
  end if;
  if cardinality(v_falta) > 0 then
    raise exception 'El costeo de % todavía no está completo: falta %.', v_codigo, array_to_string(v_falta, '; ')
      using errcode = 'check_violation';
  end if;

  select coalesce(jsonb_object_agg(f.fuente, f.total), '{}'::jsonb) into v_fuentes
    from (select l.fuente, sum(case when l.moneda = 'PEN' then l.monto
                                    else round(l.monto * public.cambio_del_dia(l.fecha, 'VENTA'), 2) end) as total
            from public.codigo_interno_lineas(v_codigo, true) l
           where l.fuente in ('MANO_OBRA', 'RECARGO_EXTRAS', 'MATERIALES', 'SERVICIOS', 'SUBCONTRATOS',
                              'SUBCONTRATOS_POR_PAGAR', 'GASTOS_DEL_MES', 'CAJA')
           group by l.fuente) f;

  insert into public.codigo_interno_cierres (codigo, costo_pen, precio_neto_pen, margen_pen, margen_pct, por_fuente, observacion)
  values (v_codigo, k.costo_pen, k.precio_neto_pen, k.margen_pen, k.margen_pct, v_fuentes, nullif(btrim(coalesce(p_observacion, '')), ''))
  returning id into v_id;
  return v_id;
end;
$$;
comment on function public.cerrar_costeo_codigo(text, text) is
  'Gerencia cierra el costeo de un código interno: congela su costo, su precio sin IGV y su margen, con quién y cuándo. Solo con todo lo que suma completo. Un reintento devuelve el cierre vigente. Exige codigos_internos.cerrar.';
revoke all on function public.cerrar_costeo_codigo(text, text) from public, anon;
grant execute on function public.cerrar_costeo_codigo(text, text) to authenticated;

create or replace function public.reabrir_costeo_codigo(p_codigo text, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_codigo text := public.normalizar_codigo_interno(p_codigo);
  v_id uuid;
begin
  perform public.exigir_permiso('codigos_internos.cerrar');
  if char_length(btrim(coalesce(p_motivo, ''))) not between 10 and 500 then
    raise exception 'Escribe por qué se reabre el costeo (de 10 a 500 caracteres).' using errcode = 'check_violation';
  end if;
  update public.codigo_interno_cierres
     set reabierto_por = public.usuario_actual(), reabierto_en = now(), motivo_reapertura = btrim(p_motivo)
   where codigo = v_codigo and reabierto_en is null
  returning id into v_id;
  if v_id is null then
    raise exception 'El costeo de % no está cerrado.', coalesce(v_codigo, 'ese código') using errcode = 'check_violation';
  end if;
  return v_id;
end;
$$;
comment on function public.reabrir_costeo_codigo(text, text) is
  'Gerencia reabre el costeo cerrado de un código interno, con su motivo. El cierre reabierto queda como evidencia. Exige codigos_internos.cerrar.';
revoke all on function public.reabrir_costeo_codigo(text, text) from public, anon;
grant execute on function public.reabrir_costeo_codigo(text, text) to authenticated;
