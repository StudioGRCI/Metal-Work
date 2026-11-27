-- =============================================================================
-- SSOMA: LA LECTURA DE GERENCIA
-- -----------------------------------------------------------------------------
-- Plan 15, entrega 15.6 (DKS, 2026-11-25): «lectura de Gerencia: días sin
-- accidentes, reportes abiertos y acciones vencidas por área.»
--
-- Gerencia consulta, no registra: lo que lee sale de lo que ya anotaron la gente
-- (15.1), SSOMA al clasificar y encargar (15.2) y las inspecciones (15.4). Esta
-- migración no crea tablas ni cambia ninguna fila: solo dos lecturas.
--
--   * DÍAS SIN ACCIDENTES. Desde el último accidente, el día en que pasó en
--     Lima, no el día en que se reportó. Accidente es lo que SSOMA clasificó como
--     accidente leve, incapacitante o mortal (la última clasificación vale), y
--     mientras no lo clasifique, lo que la gente reportó como accidente. Lo que
--     SSOMA reclasificó como incidente deja de contar, y un reporte anulado
--     también. Si nunca hubo uno, se cuenta desde el primer reporte que hay en el
--     sistema: antes de eso no hay registro y no se puede decir que no lo hubo.
--   * REPORTES ABIERTOS. Los que siguen vivos: por clasificar o clasificados con
--     acciones todavía abiertas (o sin ninguna encargada). Ni cerrados ni
--     anulados.
--   * ACCIONES VENCIDAS. Las abiertas cuya fecha límite ya pasó en Lima, salgan
--     de un reporte o del hallazgo de una inspección, en el área de la acción
--     (`ssoma_acciones.area_id`, que se guardó para esto en la 15.2).
--   * POR ÁREA. Cada área activa, y la que se dio de baja mientras le quede un
--     reporte o una acción abierta: si no, lo pendiente se perdería de vista.
--
-- Lo leen SSOMA y Gerencia (`puede_ver_reportes_ssoma()`); a los demás, nada.
-- No devuelve quién reportó ni la causa: solo fechas y cuentas.
--
-- Sin DROP: el conector de producción no deja pasar ninguno.
-- =============================================================================

-- 1. Los accidentes que cuentan ---------------------------------------------------------
-- Ayudante interno de las dos lecturas: no se abre a la gente.
create or replace function public.ssoma_accidentes()
returns table (reporte_id uuid, area_id uuid, fecha date)
language sql stable set search_path to 'public' as $$
  select r.id, r.area_id, (r.ocurrido_en at time zone 'America/Lima')::date
    from public.ssoma_reportes r
    left join lateral (
      select c.clasificacion from public.ssoma_clasificaciones c
       where c.reporte_id = r.id
       order by c.creado_en desc, c.id desc
       limit 1) c on true
   where r.estado <> 'ANULADO'
     and coalesce(c.clasificacion like 'ACCIDENTE\_%', r.tipo = 'ACCIDENTE');
$$;
comment on function public.ssoma_accidentes() is
  'Los reportes vigentes que son un accidente: los que SSOMA clasificó como accidente (la última clasificación) y, sin clasificar, los reportados como accidente; con el día en que pasó en Lima. Ayudante de ssoma_seguridad_de_la_planta y ssoma_seguridad_por_area.';
revoke all on function public.ssoma_accidentes() from public, anon, authenticated;

-- Desde cuándo hay registro: el día del primer hecho o del primer reporte.
create or replace function public.ssoma_registro_desde()
returns date language sql stable set search_path to 'public' as $$
  select min((least(r.ocurrido_en, r.creado_en) at time zone 'America/Lima')::date) from public.ssoma_reportes r;
$$;
comment on function public.ssoma_registro_desde() is
  'El primer día del que hay registro de seguridad: el del hecho más antiguo o el del primer reporte, lo que sea antes. Vacío si no hay ningún reporte.';
revoke all on function public.ssoma_registro_desde() from public, anon, authenticated;

-- 2. La planta entera -----------------------------------------------------------------------
create or replace function public.ssoma_seguridad_de_la_planta()
returns table (
  ultimo_accidente date, area_del_ultimo text, registro_desde date, dias_sin_accidentes integer,
  reportes_abiertos integer, por_clasificar integer, acciones_abiertas integer, acciones_vencidas integer)
language plpgsql stable security definer set search_path to 'public' rows 1 as $$
declare
  v_hoy   constant date := public.ssoma_hoy();
  v_desde date;
  v_fecha date;
  v_area  text;
begin
  if not public.puede_ver_reportes_ssoma() then
    return;
  end if;
  v_desde := public.ssoma_registro_desde();
  select a.fecha, ar.nombre into v_fecha, v_area
    from public.ssoma_accidentes() a
    join public.areas ar on ar.id = a.area_id
   order by a.fecha desc
   limit 1;
  return query
  select v_fecha, v_area, v_desde,
         -- `greatest` pasa por alto el vacío: sin registro, sin días.
         case when coalesce(v_fecha, v_desde) is not null then greatest(v_hoy - coalesce(v_fecha, v_desde), 0) end,
         (select count(*)::integer from public.ssoma_reportes r where r.estado in ('REPORTADO', 'CLASIFICADO')),
         (select count(*)::integer from public.ssoma_reportes r where r.estado = 'REPORTADO'),
         (select count(*)::integer from public.ssoma_acciones x where x.estado = 'ABIERTA'),
         (select count(*)::integer from public.ssoma_acciones x where x.estado = 'ABIERTA' and x.fecha_limite < v_hoy);
end;
$$;
comment on function public.ssoma_seguridad_de_la_planta() is
  'La lectura de Gerencia de toda la planta: el último accidente y su área, los días sin accidentes (desde el primer registro si nunca hubo uno), los reportes abiertos y por clasificar, y las acciones correctivas abiertas y vencidas. Solo para SSOMA y Gerencia; a los demás, ninguna fila.';
revoke all on function public.ssoma_seguridad_de_la_planta() from public, anon;
grant execute on function public.ssoma_seguridad_de_la_planta() to authenticated;

-- 3. Por área ---------------------------------------------------------------------------------
create or replace function public.ssoma_seguridad_por_area()
returns table (
  area_id uuid, area text, activa boolean, ultimo_accidente date, dias_sin_accidentes integer,
  reportes_abiertos integer, por_clasificar integer, acciones_abiertas integer, acciones_vencidas integer,
  vencida_mas_antigua date)
language sql stable security definer set search_path to 'public' rows 30 as $$
  with hoy as (
    select public.ssoma_hoy() as d, public.ssoma_registro_desde() as desde
  ), acc as (
    select a.area_id, max(a.fecha) as fecha from public.ssoma_accidentes() a group by a.area_id
  ), rep as (
    select r.area_id,
           count(*)::integer as abiertos,
           (count(*) filter (where r.estado = 'REPORTADO'))::integer as por_clasificar
      from public.ssoma_reportes r
     where r.estado in ('REPORTADO', 'CLASIFICADO')
     group by r.area_id
  ), act as (
    select x.area_id,
           count(*)::integer as abiertas,
           (count(*) filter (where x.fecha_limite < hoy.d))::integer as vencidas,
           min(x.fecha_limite) filter (where x.fecha_limite < hoy.d) as mas_antigua
      from public.ssoma_acciones x cross join hoy
     where x.estado = 'ABIERTA'
     group by x.area_id
  )
  select a.id, a.nombre, a.activo, acc.fecha,
         case when coalesce(acc.fecha, hoy.desde) is not null then greatest(hoy.d - coalesce(acc.fecha, hoy.desde), 0) end,
         coalesce(rep.abiertos, 0), coalesce(rep.por_clasificar, 0),
         coalesce(act.abiertas, 0), coalesce(act.vencidas, 0), act.mas_antigua
    from public.areas a
    cross join hoy
    left join acc on acc.area_id = a.id
    left join rep on rep.area_id = a.id
    left join act on act.area_id = a.id
   where public.puede_ver_reportes_ssoma()
     and (a.activo or rep.area_id is not null or act.area_id is not null)
   order by a.orden_secuencia, a.nombre;
$$;
comment on function public.ssoma_seguridad_por_area() is
  'La lectura de Gerencia por área: el último accidente y los días sin accidentes, los reportes abiertos y por clasificar, y las acciones correctivas abiertas y vencidas (con la fecha límite más vieja que pasó). Cada área activa, y la dada de baja mientras le quede algo abierto. Solo para SSOMA y Gerencia; a los demás, nada.';
revoke all on function public.ssoma_seguridad_por_area() from public, anon;
grant execute on function public.ssoma_seguridad_por_area() to authenticated;
