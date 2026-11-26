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
--
-- No toca datos. Idempotente: `alter policy`, la restrictiva dentro de un
-- `if not exists`, y `create or replace` de la función.

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

comment on policy ver_trabajador_cuentas on public.trabajador_cuentas is
  'La cuenta bancaria del personal la lee solo Recursos Humanos (rrhh.personal); el administrador no (20261126620000).';
