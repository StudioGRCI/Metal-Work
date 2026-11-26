-- =============================================================================
-- EL RECORRIDO DE LA PLANILLA DEL MES Y LO QUE FALTA PARA CERRARLA
-- -----------------------------------------------------------------------------
-- Plan 13 (Recursos Humanos), entrega 13.3. RR. HH. arma tres planillas por mes
-- (taller, administrativa y subcontratos): las crea, importa el Excel, agrega o
-- quita a alguien y las cierra. Hasta hoy la tarjeta decía «En preparación» o
-- «Cerrada», y nada más: no decía quién la creó, cuándo entró el Excel ni quién
-- la cerró, y antes de cerrar había que ir a buscar por otras pantallas si
-- quedaban reportes del mes sin el visto de RR. HH. o gente sin cuenta.
--
-- Dos funciones de solo lectura, sin tabla nueva:
--
-- 1. `recorrido_de_planillas(ids)`, con la misma forma que el recorrido del RQ y
--    de la cotización (migración 20261125130000): creada → cada Excel importado
--    → lo agregado a mano → lo quitado → cerrada. Mientras está en preparación la
--    tiene RR. HH. y se dice hace cuántos días (fecha de Lima). De cada paso, el
--    puesto de quien lo hizo, nunca su nombre ni un importe. Quitar a alguien de
--    la planilla borra su fila, pero la auditoría guarda la copia: el Excel que
--    entró y quién quitó a quién no se pierden del recorrido aunque se quite a
--    todos.
--
-- 2. `planilla_lo_que_falta(planilla)`: mientras está en preparación,
--    - de la de taller, los reportes diarios del mes que esperan el visto de
--      RR. HH. o están observados (sus horas no pasan a la planilla diaria), con
--      los días que llevan esperando;
--    - de la de taller y la administrativa, quien está en la planilla y no
--      tiene cuenta bancaria en su ficha, o no tiene ficha.
--    Solo dice que la cuenta falta: la cuenta misma vive en `trabajador_cuentas`
--    y la sigue leyendo solo `rrhh.personal`.
--
-- Lo que falta se avisa, no frena el cierre: cerrar sigue siendo la decisión de
-- RR. HH. (`cerrar_planilla`, sin cambios). Una planilla cerrada ya no se edita
-- desde antes (`fn_planilla_abierta` en planilla_personas y sus
-- distribuciones, y `planillas` sin política de UPDATE): el check 474 lo
-- prueba con el rol real.
--
-- Las dos las lee quien ya ve las planillas (`rrhh.ver_planillas`, como la
-- política `planillas_lectura`); los reportes, además, solo con
-- `reporte_diario.ver`, como la política de `reportes_diarios`. Son `security
-- definer` porque cruzan con tablas que quien mira no lee directo (las cuentas,
-- el puesto de cada cuenta): por eso el alcance lo ponen ellas.
-- =============================================================================

do $$
begin
  if to_regprocedure('public.dias_en_espera(timestamptz)') is null then
    raise exception 'Aplica antes la migración 20261125130000 (el recorrido de cada documento): esta usa su dias_en_espera.';
  end if;
end $$;

-- =============================================================================
-- 1. EL RECORRIDO DE LA PLANILLA
-- =============================================================================
create or replace function public.recorrido_de_planillas(p_ids uuid[])
returns table (
  documento uuid,
  orden     integer,
  paso      text,
  situacion text,
  puesto    text,
  en        timestamptz,
  dias      integer,
  espera    text,
  detalle   text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
begin
  if not (public.es_admin() or public.tiene_permiso('rrhh.ver_planillas')) then
    raise exception 'No tienes permiso para ver las planillas.' using errcode = 'insufficient_privilege';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return;
  end if;
  if cardinality(p_ids) > 200 then
    raise exception 'Pide el recorrido de hasta 200 planillas a la vez.' using errcode = 'check_violation';
  end if;

  return query
  with pl as (
    select p.id, p.estado, p.registrado_por, p.creado_en, p.cerrado_por, p.cerrado_en
      from public.planillas p
     where p.id = any(p_ids)
  ),
  -- Quien quitó a alguien de la planilla: la auditoría guarda la fila como era.
  quitados as (
    select (a.datos_antes ->> 'planilla_id')::uuid as planilla_id,
           a.datos_antes ->> 'importacion_id' as importacion_id,
           (a.datos_antes ->> 'creado_en')::timestamptz as creado_en,
           (a.datos_antes ->> 'registrado_por')::uuid as registrado_por,
           a.creado_en as quitado_en,
           a.usuario_id as quitado_por
      from public.audit_log a
     where a.tabla = 'planilla_personas' and a.accion = 'DELETE'
       and (a.datos_antes ->> 'planilla_id')::uuid = any(p_ids)
  ),
  -- Todos los que entraron alguna vez: los que siguen y los que se quitaron.
  entraron as (
    select x.planilla_id, x.importacion_id::text as importacion_id, x.creado_en, x.registrado_por
      from public.planilla_personas x
     where x.planilla_id = any(p_ids)
    union all
    select q.planilla_id, q.importacion_id, q.creado_en, q.registrado_por
      from quitados q
  ),
  -- Cada Excel importado es una importación: quién la hizo, cuándo y cuántas personas entraron.
  importaciones as (
    select e.planilla_id, e.importacion_id,
           min(e.creado_en) as en,
           (array_agg(e.registrado_por order by e.creado_en))[1] as por,
           count(*) as personas
      from entraron e
     where e.importacion_id is not null
     group by e.planilla_id, e.importacion_id
  ),
  -- Lo agregado a mano va en un solo paso: la última vez, y cuántas personas.
  a_mano as (
    select e.planilla_id,
           max(e.creado_en) as en,
           (array_agg(e.registrado_por order by e.creado_en desc))[1] as por,
           count(*) as personas
      from entraron e
     where e.importacion_id is null
     group by e.planilla_id
  ),
  -- Lo quitado, también en un solo paso: la última vez, quién, y cuántas personas.
  quitadas as (
    select q.planilla_id,
           max(q.quitado_en) as en,
           (array_agg(q.quitado_por order by q.quitado_en desc))[1] as por,
           count(*) as personas
      from quitados q
     group by q.planilla_id
  ),
  -- Lo último que se le hizo antes de cerrarla: desde ahí espera el cierre.
  ultimo as (
    select pl.id, greatest(pl.creado_en, max(i.en), max(m.en), max(qq.en)) as en,
           exists (select 1 from public.planilla_personas x where x.planilla_id = pl.id) as con_gente
      from pl
      left join importaciones i on i.planilla_id = pl.id
      left join a_mano m on m.planilla_id = pl.id
      left join quitadas qq on qq.planilla_id = pl.id
     group by pl.id, pl.creado_en
  ),
  pasos as (
    select pl.id as doc, pl.creado_en as en, 1 as sub, 'CREADA'::text as paso, 'HECHO'::text as situacion,
           pl.registrado_por as por, null::text as puesto_fijo, null::text as espera, null::text as detalle
      from pl
    union all
    select i.planilla_id, i.en, 2, 'IMPORTACION', 'HECHO', i.por, null, null, i.personas::text
      from importaciones i
    union all
    select m.planilla_id, m.en, 3, 'A_MANO', 'HECHO', m.por, null, null, m.personas::text
      from a_mano m
    union all
    select qq.planilla_id, qq.en, 4, 'QUITADAS', 'HECHO', qq.por, null, null, qq.personas::text
      from quitadas qq
    union all
    select pl.id, pl.cerrado_en, 5, 'CIERRE', 'HECHO', pl.cerrado_por, null, null, null
      from pl where pl.estado = 'CERRADA'
    union all
    select pl.id, u.en, 5, 'CIERRE', 'AHORA', null, 'Recursos Humanos',
           case when u.con_gente then 'CERRAR' else 'IMPORTAR' end, null
      from pl join ultimo u on u.id = pl.id
     where pl.estado = 'BORRADOR'
  )
  select p.doc,
         (row_number() over (partition by p.doc order by p.situacion = 'AHORA', p.en, p.sub))::integer,
         p.paso,
         p.situacion,
         case when p.situacion = 'HECHO' then public.puesto_de(p.por) else p.puesto_fijo end,
         p.en,
         case when p.situacion = 'AHORA' then public.dias_en_espera(p.en) end,
         p.espera,
         p.detalle
    from pasos p
   order by p.doc, 2;
end;
$$;

comment on function public.recorrido_de_planillas(uuid[]) is
  'El recorrido de cada planilla del mes, un paso por fila: creada, cada Excel importado (detalle: cuántas personas entraron), lo agregado a mano, lo quitado (de la auditoría) y el cierre, con el puesto de quien lo hizo y su hora; en preparación, la tiene RR. HH. desde lo último que se le hizo (dias por fecha de Lima). Lo lee quien ve las planillas (rrhh.ver_planillas). Sin importes ni nombres.';

revoke all on function public.recorrido_de_planillas(uuid[]) from public, anon;
grant execute on function public.recorrido_de_planillas(uuid[]) to authenticated;

-- =============================================================================
-- 2. LO QUE FALTA PARA CERRAR LA PLANILLA
-- =============================================================================
create or replace function public.planilla_lo_que_falta(p_planilla uuid)
returns table (
  clase     text,
  documento uuid,
  fecha     date,
  nombre    text,
  detalle   text,
  desde     timestamptz,
  dias      integer
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v public.planillas%rowtype;
  v_hasta date;
begin
  if not (public.es_admin() or public.tiene_permiso('rrhh.ver_planillas')) then
    raise exception 'No tienes permiso para ver las planillas.' using errcode = 'insufficient_privilege';
  end if;
  select * into v from public.planillas where id = p_planilla;
  -- Cerrada ya no le falta nada: lo que quedó, quedó.
  if not found or v.estado <> 'BORRADOR' then
    return;
  end if;
  v_hasta := (v.periodo + interval '1 month')::date;

  -- Los reportes del mes que esperan a RR. HH. (sus horas no van a la planilla
  -- diaria sin su visto) o que el supervisor tiene que corregir. Solo para la de
  -- taller, y solo a quien ya lee los reportes.
  if v.tipo = 'TALLER' and (public.es_admin() or public.tiene_permiso('reporte_diario.ver')) then
    return query
    select case when r.observado_en is not null then 'REPORTE_OBSERVADO' else 'REPORTE_SIN_VISTO' end,
           r.id, r.fecha, r.asunto,
           concat_ws(' · ', a.nombre, r.codigo_interno),
           coalesce(r.observado_en, r.creado_en),
           public.dias_en_espera(coalesce(r.observado_en, r.creado_en))
      from public.reportes_diarios r
      left join public.areas a on a.id = r.area_id
     where r.fecha >= v.periodo and r.fecha < v_hasta
       and r.anulado_en is null
       and (r.observado_en is not null or r.visto_rrhh_en is null)
     order by r.fecha, r.creado_en;
  end if;

  -- Quien está en la planilla y no tiene dónde cobrar: sin cuenta en su ficha, o
  -- sin ficha. La de subcontratos no: no son personal de planta.
  if v.tipo in ('TALLER', 'ADMINISTRATIVA') then
    return query
    with gente as (
      select x.id, x.nombre, public.trabajador_de_planilla(x.nombre, x.documento) as trabajador
        from public.planilla_personas x
       where x.planilla_id = p_planilla
    )
    select case when g.trabajador is null then 'SIN_FICHA' else 'SIN_CUENTA' end,
           coalesce(g.trabajador, g.id), null::date, g.nombre,
           case when g.trabajador is null then 'Sin ficha en Personal' else 'Sin cuenta bancaria en su ficha' end,
           null::timestamptz, null::integer
      from gente g
     where g.trabajador is null
        or not exists (select 1 from public.trabajador_cuentas c where c.trabajador_id = g.trabajador)
     order by g.nombre;
  end if;
end;
$$;

comment on function public.planilla_lo_que_falta(uuid) is
  'Lo que falta para cerrar una planilla en preparación: de la de taller, los reportes diarios del mes sin el visto de RR. HH. u observados (con reporte_diario.ver), con los días que esperan; de la de taller y la administrativa, quien no tiene cuenta bancaria en su ficha o no tiene ficha (sin la cuenta: solo que falta). Avisa; no frena cerrar_planilla. Lo lee quien ve las planillas.';

revoke all on function public.planilla_lo_que_falta(uuid) from public, anon;
grant execute on function public.planilla_lo_que_falta(uuid) to authenticated;
