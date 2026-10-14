-- =============================================================================
-- GERENCIA: CADA CÓDIGO INTERNO CON SU AVANCE Y SU COSTEO
-- -----------------------------------------------------------------------------
-- El código interno de la unidad (PLA_SR_O4_1_26/28, o PLANTA para lo que no es
-- de una unidad) ya viaja por todo el sistema: el requerimiento lo pide, la
-- orden de compra lo lleva, Almacén saca el material para él, el supervisor sube
-- su reporte diario por él y RR. HH. costea las horas con él. Pero cada área lo
-- ve en su pantalla y nadie lo ve junto. Gerencia pidió (2026-10-14) ver todos
-- los códigos que hay en el sistema y, por cada uno, sus reportes de avance y su
-- costeo, para saber cómo va cada unidad.
--
-- Esta migración no crea tablas: junta lo que ya existe, código por código.
--
--   * EL CÓDIGO se compara en mayúsculas y sin espacios de más: «pla_sr_o4_1_26/28 »
--     y «PLA_SR_O4_1_26/28» son el mismo. Una salida vieja de Almacén, de antes de
--     que el kardex guardara el código, vale por el código que Almacén escribió.
--   * EL AVANCE sale de los reportes diarios vigentes: cada trabajo con su
--     porcentaje, su día, sus horas y en qué va el reporte (por validar,
--     observado o validado).
--   * EL COSTEO va separado en tres:
--       - MANO DE OBRA: las horas del tareo de RR. HH. con su costo (la hora vale
--         el costo mensual entre 240, escrito al registrarlas). Las horas de un
--         reporte cuya persona todavía no tiene costo mensual van como horas SIN
--         COSTO, no como cero.
--       - MATERIALES: lo que salió del almacén para el código (salidas y
--         despachos, menos lo devuelto) al precio que llevó la salida; si no lo
--         llevó, al del último ingreso con precio de ese material hasta ese día;
--         si tampoco, al precio que fijó Logística. Sin ninguno, SIN PRECIO.
--       - COMPRAS: las órdenes de compra con el código, sin IGV, menos las
--         rechazadas. Se muestran pero NO se suman al total: lo comprado entra al
--         almacén y se cuenta cuando sale para el código; sumarlo también al
--         comprarlo lo contaría dos veces.
--   * Gerencia ve la mano de obra por código y por trabajo, y las horas de cada
--     persona, pero no lo que cuesta cada persona: el costo mensual sigue siendo
--     solo de RR. HH.
--   * La OT y la cotización todavía no se vinculan al código. Hoy solo se llega
--     a ellas si la unidad registrada en Unidades lleva ese código: la OT de esa
--     unidad y la cotización de esa OT se listan como referencia.
--
-- Lo lee solo Gerencia, con un permiso propio. Todo va por funciones security
-- definer que exigen ese permiso y devuelven solo lo que la pantalla muestra.
-- Sin DROP: el conector de producción no deja pasar ninguno.
-- =============================================================================

-- 1. El permiso, solo para Gerencia ------------------------------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('codigos_internos.ver', 'Costos',
   'Consultar todos los códigos internos con sus reportes de avance y su costeo: mano de obra, materiales y compras')
on conflict (codigo) do nothing;

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, 'codigos_internos.ver' from public.roles r where r.codigo = 'GERENTE'
on conflict do nothing;

-- 2. El código, escrito siempre igual ------------------------------------------------
create or replace function public.normalizar_codigo_interno(p text)
returns text language sql immutable set search_path to 'public' as $$
  select nullif(upper(regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g')), '');
$$;
revoke all on function public.normalizar_codigo_interno(text) from public, anon, authenticated;

-- 3. El costeo: una línea por cosa ----------------------------------------------------
-- El resumen de abajo es la suma de estas líneas, así los dos no pueden decir
-- cosas distintas. Sin código, todos los códigos.
--   MANO_OBRA            horas del tareo con su costo, por día y trabajo del reporte
--                        (o por labor, si las cargó RR. HH.); cantidad = personas
--   MANO_OBRA_SIN_COSTO  horas de un reporte que esperan el costo mensual de la persona
--   MATERIALES           cada salida o despacho con su precio
--   MATERIALES_SIN_PRECIO  la que no tiene ningún precio
--   COMPRAS              cada orden de compra, sin IGV; cantidad = líneas,
--                        sin_precio = líneas sin precio. No va al total.
create or replace function public.codigo_interno_costeo(p_codigo text default null)
returns table (codigo text, fuente text, fecha date, concepto text, detalle text, cantidad numeric, unidad text,
               horas numeric, precio_unitario numeric, moneda text, monto numeric, sin_precio integer,
               documento text, referencia_id uuid)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_codigo text := public.normalizar_codigo_interno(p_codigo);
begin
  perform public.exigir_permiso('codigos_internos.ver');
  return query
  with tareo as (
    select public.normalizar_codigo_interno(t.codigo_interno) as codigo, t.fecha, t.horas, t.costo, t.trabajador_id,
           l.reporte_id, l.trabajo_id, case when l.id is null then t.labor end as labor
      from public.tareos t
      left join public.reporte_diario_personal l on l.id = t.reporte_linea_id
     where t.anulado_en is null
  ), espera as (
    -- Una línea de un reporte vigente que no tiene tareo: su persona no tiene costo mensual.
    select public.normalizar_codigo_interno(r.codigo_interno) as codigo, l.fecha, l.horas, l.trabajador_id,
           l.reporte_id, l.trabajo_id, null::text as labor
      from public.reporte_diario_personal l
      join public.reportes_diarios r on r.id = l.reporte_id
     where r.anulado_en is null
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
comment on function public.codigo_interno_costeo(text) is
  'Las líneas del costeo de un código interno (o de todos): mano de obra con y sin costo, materiales con y sin precio, y compras, que no van al total. Exige codigos_internos.ver.';
revoke all on function public.codigo_interno_costeo(text) from public, anon;
grant execute on function public.codigo_interno_costeo(text) to authenticated;

-- 4. El avance: cada trabajo de cada reporte vigente ------------------------------------
-- Con el personal general, las horas son de todo el reporte y no de cada trabajo:
-- van en horas_reporte.
create or replace function public.codigo_interno_avance(p_codigo text default null)
returns table (codigo text, reporte_id uuid, fecha date, asunto text, area text, estado text, creado_en timestamptz,
               personal_general boolean, horas_reporte numeric, trabajo_orden smallint, trabajo text, avance smallint,
               horas numeric, personas integer)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_codigo text := public.normalizar_codigo_interno(p_codigo);
begin
  perform public.exigir_permiso('codigos_internos.ver');
  return query
  select public.normalizar_codigo_interno(r.codigo_interno), r.id, r.fecha, r.asunto, a.nombre::text,
         public.reporte_diario_estado(r), r.creado_en, r.personal_general,
         (select coalesce(sum(l.horas), 0) from public.reporte_diario_personal l where l.reporte_id = r.id)::numeric,
         t.orden, t.descripcion, t.avance,
         (select sum(l.horas) from public.reporte_diario_personal l where l.trabajo_id = t.id)::numeric,
         (select count(distinct l.trabajador_id) from public.reporte_diario_personal l where l.trabajo_id = t.id)::integer
    from public.reportes_diarios r
    join public.reporte_diario_trabajos t on t.reporte_id = r.id
    left join public.areas a on a.id = r.area_id
   where r.anulado_en is null
     and (v_codigo is null or public.normalizar_codigo_interno(r.codigo_interno) = v_codigo)
   order by 1, r.fecha desc, r.creado_en desc, t.orden;
end;
$$;
comment on function public.codigo_interno_avance(text) is
  'Los trabajos de los reportes diarios vigentes de un código interno (o de todos), con su avance, sus horas y en qué va el reporte. Exige codigos_internos.ver.';
revoke all on function public.codigo_interno_avance(text) from public, anon;
grant execute on function public.codigo_interno_avance(text) to authenticated;

-- 5. Las horas de cada persona en el código, sin su costo ---------------------------------
create or replace function public.codigo_interno_personal(p_codigo text)
returns table (trabajador_id uuid, nombre text, cargo text, horas numeric, horas_sin_costo numeric,
               dias integer, primer_dia date, ultimo_dia date)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_codigo text := public.normalizar_codigo_interno(p_codigo);
begin
  perform public.exigir_permiso('codigos_internos.ver');
  if v_codigo is null then
    return;
  end if;
  return query
  with horas as (
    select t.trabajador_id, t.fecha, t.horas, 0::numeric as sin_costo
      from public.tareos t
     where t.anulado_en is null and public.normalizar_codigo_interno(t.codigo_interno) = v_codigo
    union all
    select l.trabajador_id, l.fecha, l.horas, l.horas
      from public.reporte_diario_personal l
      join public.reportes_diarios r on r.id = l.reporte_id
     where r.anulado_en is null and public.normalizar_codigo_interno(r.codigo_interno) = v_codigo
       and not exists (select 1 from public.tareos t where t.reporte_linea_id = l.id)
  )
  select h.trabajador_id, (w.nombres || ' ' || w.apellidos)::text, w.cargo::text,
         sum(h.horas)::numeric, sum(h.sin_costo)::numeric, count(distinct h.fecha)::integer, min(h.fecha), max(h.fecha)
    from horas h
    join public.trabajadores w on w.id = h.trabajador_id
   group by h.trabajador_id, w.nombres, w.apellidos, w.cargo
   order by 4 desc, 2;
end;
$$;
comment on function public.codigo_interno_personal(text) is
  'Las horas de cada persona en un código interno, con las que esperan su costo. Sin el costo de la persona: ese es solo de RR. HH. Exige codigos_internos.ver.';
revoke all on function public.codigo_interno_personal(text) from public, anon;
grant execute on function public.codigo_interno_personal(text) to authenticated;

-- 6. Las órdenes de compra del código, con en qué va cada una -------------------------------
-- El monto sale de la línea COMPRAS del costeo: el mismo número en las dos partes.
create or replace function public.codigo_interno_compras(p_codigo text)
returns table (id uuid, numero text, fecha date, proveedor text, aprobacion text, recojo text,
               entregado_almacen_en timestamptz, validaciones text[], moneda text, monto numeric,
               lineas integer, sin_precio integer, requerimientos text)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  perform public.exigir_permiso('codigos_internos.ver');
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
    from public.codigo_interno_costeo(p_codigo) k
    join public.ordenes_compra_materiales c on c.id = k.referencia_id
   where k.fuente = 'COMPRAS'
   order by k.fecha desc, k.documento;
end;
$$;
comment on function public.codigo_interno_compras(text) is
  'Las órdenes de compra de un código interno, sin IGV y sin las rechazadas, con su aprobación, su recojo y su ingreso al almacén. Exige codigos_internos.ver.';
revoke all on function public.codigo_interno_compras(text) from public, anon;
grant execute on function public.codigo_interno_compras(text) to authenticated;

-- 7. Dónde más aparece el código ----------------------------------------------------------
--   REQUERIMIENTO  los RQ que lo piden, anulados incluidos (con su estado)
--   VEHICULO       los ingresos a la planta registrados con él, menos los anulados
--   UNIDAD         las unidades de Unidades que lo llevan
--   OT             las órdenes de trabajo de esas unidades
--   COTIZACION     la cotización PDF de esas OT
create or replace function public.codigo_interno_documentos(p_codigo text default null)
returns table (codigo text, tipo text, id uuid, numero text, fecha date, estado text, detalle text)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_codigo text := public.normalizar_codigo_interno(p_codigo);
begin
  perform public.exigir_permiso('codigos_internos.ver');
  return query
  with unidad as (
    select public.normalizar_codigo_interno(u.codigo_interno) as codigo, u.*
      from public.unidades u
     where u.codigo_interno is not null
       and (v_codigo is null or public.normalizar_codigo_interno(u.codigo_interno) = v_codigo)
  ), orden as (
    select u.codigo, o.* from public.ordenes_trabajo o join unidad u on u.id = o.unidad_id
  )
  select public.normalizar_codigo_interno(r.codigo_interno), 'REQUERIMIENTO'::text, r.id, r.numero::text,
         (r.creado_en at time zone 'America/Lima')::date, r.estado::text,
         (coalesce(a.nombre, 'Sin área') || ' · ' || (select count(*) from public.requerimiento_lineas l where l.requerimiento_id = r.id)
           || case when (select count(*) from public.requerimiento_lineas l where l.requerimiento_id = r.id) = 1 then ' insumo' else ' insumos' end
           || ' · ' || r.justificacion)::text
    from public.requerimientos r
    left join public.areas a on a.id = r.area_id
   where v_codigo is null or public.normalizar_codigo_interno(r.codigo_interno) = v_codigo
  union all
  select public.normalizar_codigo_interno(v.codigo_interno), 'VEHICULO', v.id,
         coalesce(nullif(btrim(v.placa), ''), nullif(btrim(v.chasis), ''), 'Sin placa')::text,
         (v.ingreso_en at time zone 'America/Lima')::date,
         case when v.salida_en is null then 'EN_PLANTA' else 'SALIO' end,
         (v.unidad || ' · ' || v.empresa)::text
    from public.registro_vehiculos v
   where v.codigo_interno is not null and v.anulado_en is null
     and (v_codigo is null or public.normalizar_codigo_interno(v.codigo_interno) = v_codigo)
  union all
  select u.codigo, 'UNIDAD', u.id,
         coalesce(nullif(btrim(u.placa), ''), nullif(btrim(u.numero_chasis), ''), 'Sin placa')::text,
         (u.creado_en at time zone 'America/Lima')::date,
         case when u.activo then 'ACTIVA' else 'INACTIVA' end,
         nullif(btrim(concat_ws(' ', u.marca, u.modelo)), '')::text
    from unidad u
  union all
  select o.codigo, 'OT', o.id, o.numero::text, o.fecha_registro, o.estado::text, o.descripcion::text
    from orden o
  union all
  select o.codigo, 'COTIZACION', c.id, c.numero::text, (c.creado_en at time zone 'America/Lima')::date, c.estado::text,
         ('De la OT ' || o.numero)::text
    from orden o
    join public.cotizaciones_pdf c on c.id = o.cotizacion_pdf_id
   order by 1, 2, 5 desc;
end;
$$;
comment on function public.codigo_interno_documentos(text) is
  'Dónde más aparece un código interno (o todos): requerimientos, ingresos de vehículos, unidades, y la OT y la cotización de esas unidades. Exige codigos_internos.ver.';
revoke all on function public.codigo_interno_documentos(text) from public, anon;
grant execute on function public.codigo_interno_documentos(text) to authenticated;

-- 8. Todos los códigos, uno por fila ------------------------------------------------------------
-- La suma de las tres funciones de arriba. El avance de un trabajo es el último
-- que se reportó de él: los trabajos se reconocen por su descripción, sin
-- distinguir mayúsculas ni espacios.
create or replace function public.codigos_internos_resumen()
returns table (codigo text, requerimientos integer, compras integer, salidas integer, reportes integer,
               vehiculos integer, unidades integer, ordenes integer, ultima_actividad date, ultimo_reporte date,
               trabajos integer, trabajos_terminados integer, avance_medio numeric,
               horas numeric, horas_sin_costo numeric, mano_obra numeric,
               materiales_pen numeric, materiales_usd numeric, materiales_sin_precio integer,
               compras_pen numeric, compras_usd numeric, compras_sin_precio integer)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  perform public.exigir_permiso('codigos_internos.ver');
  return query
  with costeo as (
    select * from public.codigo_interno_costeo(null)
  ), avance as (
    select * from public.codigo_interno_avance(null)
  ), docs as (
    select * from public.codigo_interno_documentos(null)
  ), ultimo as (
    select distinct on (a.codigo, lower(regexp_replace(btrim(a.trabajo), '\s+', ' ', 'g'))) a.codigo, a.avance
      from avance a
     order by a.codigo, lower(regexp_replace(btrim(a.trabajo), '\s+', ' ', 'g')), a.fecha desc, a.creado_en desc, a.trabajo_orden
  ), por_costeo as (
    select k.codigo,
           count(*) filter (where k.fuente = 'COMPRAS')::integer as compras,
           count(*) filter (where k.fuente in ('MATERIALES', 'MATERIALES_SIN_PRECIO'))::integer as salidas,
           coalesce(sum(k.horas) filter (where k.fuente in ('MANO_OBRA', 'MANO_OBRA_SIN_COSTO')), 0)::numeric as horas,
           coalesce(sum(k.horas) filter (where k.fuente = 'MANO_OBRA_SIN_COSTO'), 0)::numeric as horas_sin_costo,
           coalesce(sum(k.monto) filter (where k.fuente = 'MANO_OBRA'), 0)::numeric as mano_obra,
           coalesce(sum(k.monto) filter (where k.fuente = 'MATERIALES' and k.moneda = 'PEN'), 0)::numeric as materiales_pen,
           coalesce(sum(k.monto) filter (where k.fuente = 'MATERIALES' and k.moneda = 'USD'), 0)::numeric as materiales_usd,
           count(*) filter (where k.fuente = 'MATERIALES_SIN_PRECIO')::integer as materiales_sin_precio,
           coalesce(sum(k.monto) filter (where k.fuente = 'COMPRAS' and k.moneda = 'PEN'), 0)::numeric as compras_pen,
           coalesce(sum(k.monto) filter (where k.fuente = 'COMPRAS' and k.moneda = 'USD'), 0)::numeric as compras_usd,
           coalesce(sum(k.sin_precio) filter (where k.fuente = 'COMPRAS'), 0)::integer as compras_sin_precio,
           max(k.fecha) as ultima
      from costeo k group by k.codigo
  ), por_avance as (
    select a.codigo, count(distinct a.reporte_id)::integer as reportes, max(a.fecha) as ultimo_reporte
      from avance a group by a.codigo
  ), por_trabajo as (
    select u.codigo, count(*)::integer as trabajos, count(*) filter (where u.avance = 100)::integer as terminados,
           round(avg(u.avance))::numeric as avance_medio
      from ultimo u group by u.codigo
  ), por_docs as (
    select d.codigo,
           count(*) filter (where d.tipo = 'REQUERIMIENTO' and d.estado <> 'ANULADO')::integer as requerimientos,
           count(*) filter (where d.tipo = 'VEHICULO')::integer as vehiculos,
           count(*) filter (where d.tipo = 'UNIDAD')::integer as unidades,
           count(*) filter (where d.tipo = 'OT')::integer as ordenes,
           max(d.fecha) as ultima
      from docs d group by d.codigo
  ), codigos as (
    select k.codigo from costeo k union select a.codigo from avance a union select d.codigo from docs d
  )
  select c.codigo,
         coalesce(d.requerimientos, 0), coalesce(k.compras, 0), coalesce(k.salidas, 0), coalesce(a.reportes, 0),
         coalesce(d.vehiculos, 0), coalesce(d.unidades, 0), coalesce(d.ordenes, 0),
         greatest(k.ultima, a.ultimo_reporte, d.ultima), a.ultimo_reporte,
         coalesce(t.trabajos, 0), coalesce(t.terminados, 0), t.avance_medio,
         coalesce(k.horas, 0), coalesce(k.horas_sin_costo, 0), coalesce(k.mano_obra, 0),
         coalesce(k.materiales_pen, 0), coalesce(k.materiales_usd, 0), coalesce(k.materiales_sin_precio, 0),
         coalesce(k.compras_pen, 0), coalesce(k.compras_usd, 0), coalesce(k.compras_sin_precio, 0)
    from codigos c
    left join por_costeo k on k.codigo = c.codigo
    left join por_avance a on a.codigo = c.codigo
    left join por_trabajo t on t.codigo = c.codigo
    left join por_docs d on d.codigo = c.codigo
   where c.codigo is not null
   order by 9 desc nulls last, 1;
end;
$$;
comment on function public.codigos_internos_resumen() is
  'Todos los códigos internos del sistema, uno por fila: dónde aparecen, su avance y su costeo (la suma de codigo_interno_costeo, _avance y _documentos). Exige codigos_internos.ver.';
revoke all on function public.codigos_internos_resumen() from public, anon;
grant execute on function public.codigos_internos_resumen() to authenticated;
