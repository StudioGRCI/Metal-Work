-- La cuenta bancaria del personal la lee solo Recursos Humanos (plan 13, regla
-- «la cuenta bancaria vive aparte y solo la lee rrhh.personal»; StudioGRCI lo
-- aprobó el 2026-11-26).
--
-- Desde la 20261013160000 la política de `trabajador_cuentas` dejaba pasar al
-- administrador por `es_admin()`, y `audit_log` le entregaba además la historia
-- de cada cuenta (su política empieza con `es_admin() or …`). El administrador
-- mira el sistema, pero el número de cuenta de cada persona no es suyo: lo pone
-- y lo lee RR. HH. (`rrhh.personal`). Para pagar la planilla diaria, Tesorería
-- (`planilla_diaria.pagar`) y quien la arma (`planilla_diaria.preparar`) la
-- siguen leyendo por `planilla_diaria_cuentas`, que tampoco se la da ya al
-- administrador.
--
-- Qué cambia:
-- 1. `ver_trabajador_cuentas`: solo `rrhh.personal`.
-- 2. `audit_log`: una política restrictiva aparte, `cuentas_solo_rrhh`, que
--    exige `rrhh.personal` para las filas de `trabajador_cuentas`. Restrictiva
--    para no reescribir la política grande de lectura, que va por permisos de
--    cada módulo y cambia seguido.
-- 3. `planilla_diaria_cuentas`: sin el atajo de `es_admin()`.
-- 4. `planilla_lo_que_falta`: «sin cuenta bancaria en su ficha» solo para
--    `rrhh.personal`; «sin ficha» lo sigue viendo el administrador, que no dice
--    nada de la cuenta.
--
-- No toca datos. Idempotente: `alter policy`, la restrictiva dentro de un
-- `if not exists`, y `create or replace` de las dos funciones. Antes de
-- reemplazarlas se compara el texto que tienen con el que se conoce (el de
-- antes o el de esta migración): si otra migración las cambió entretanto, se
-- detiene en vez de pisarla.

-- Las dos funciones tienen que estar como se las conoce: la de antes o esta.
do $$
declare v text;
begin
  select md5(replace(prosrc, E'\r', '')) into v from pg_proc
   where oid = 'public.planilla_diaria_cuentas(uuid)'::regprocedure;
  if v not in ('f470906460841f00b7f8f64b3105ab87', 'e363b4076a2c6e5bd799b228ed0522f0') then
    raise exception 'planilla_diaria_cuentas cambió desde que se escribió esta migración (md5 %): revisarla antes de reemplazarla.', v;
  end if;
  select md5(replace(prosrc, E'\r', '')) into v from pg_proc
   where oid = 'public.planilla_lo_que_falta(uuid)'::regprocedure;
  if v not in ('b367d744290e220a7508464e9c021ea7', 'd43a9947f22c4bfcd80d12928d51b07b') then
    raise exception 'planilla_lo_que_falta cambió desde que se escribió esta migración (md5 %): revisarla antes de reemplazarla.', v;
  end if;
end $$;

alter policy ver_trabajador_cuentas on public.trabajador_cuentas
  using ((select public.tiene_permiso('rrhh.personal')));

do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'audit_log' and policyname = 'cuentas_solo_rrhh') then
    create policy cuentas_solo_rrhh on public.audit_log as restrictive for select to authenticated
      using (tabla <> 'trabajador_cuentas' or (select public.tiene_permiso('rrhh.personal')));
  end if;
end $$;

create or replace function public.planilla_diaria_cuentas(p_planilla_id uuid)
returns table (persona_id uuid, banco text, tipo_cuenta text, numero_cuenta text, cci text)
language plpgsql
stable security definer
set search_path to 'public'
as $$
begin
  -- Sin `es_admin()`: la cuenta la lee quien paga o arma la planilla, no el administrador.
  if not (public.tiene_permiso('planilla_diaria.pagar') or public.tiene_permiso('planilla_diaria.preparar')) then
    raise exception 'No tienes permiso para ver las cuentas de la planilla.' using errcode = 'insufficient_privilege';
  end if;
  return query
    select pp.id, c.banco, c.tipo_cuenta, c.numero_cuenta, c.cci
      from public.planilla_diaria_personas pp
      join public.planillas_diarias p on p.id = pp.planilla_id and p.anulado_en is null
      left join public.trabajador_cuentas c on c.trabajador_id = pp.trabajador_id
     where pp.planilla_id = p_planilla_id;
end;
$$;
revoke all on function public.planilla_diaria_cuentas(uuid) from public, anon;
grant execute on function public.planilla_diaria_cuentas(uuid) to authenticated;

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
  -- sin ficha. La de subcontratos no: no son personal de planta. «Sin ficha» lo
  -- ve también el administrador; «sin cuenta», solo quien lee las cuentas
  -- (`rrhh.personal`, como la política de `trabajador_cuentas`, sin el atajo de
  -- `es_admin()`, 20261126620000): decir quién no la tiene es leerla.
  if v.tipo in ('TALLER', 'ADMINISTRATIVA') and (public.es_admin() or public.tiene_permiso('rrhh.personal')) then
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
        or (public.tiene_permiso('rrhh.personal')
            and not exists (select 1 from public.trabajador_cuentas c where c.trabajador_id = g.trabajador))
     order by g.nombre;
  end if;
end;
$$;

comment on function public.planilla_lo_que_falta(uuid) is
  'Lo que falta para cerrar una planilla en preparación: de la de taller, los reportes diarios del mes sin el visto de RR. HH. u observados (con reporte_diario.ver), con los días que esperan; de la de taller y la administrativa, quien no tiene ficha (con rrhh.personal o el administrador) y quien no tiene cuenta bancaria en su ficha (solo con rrhh.personal, sin la cuenta: solo que falta; 20261126620000). Avisa; no frena cerrar_planilla. Lo lee quien ve las planillas.';

revoke all on function public.planilla_lo_que_falta(uuid) from public, anon;
grant execute on function public.planilla_lo_que_falta(uuid) to authenticated;

comment on policy ver_trabajador_cuentas on public.trabajador_cuentas is
  'La cuenta bancaria del personal la lee solo Recursos Humanos (rrhh.personal); el administrador no (20261126620000).';
