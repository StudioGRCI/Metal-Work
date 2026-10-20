-- =============================================================================
-- LA PLANILLA DE CADA PERSONA: DE TALLER O ADMINISTRATIVA
-- -----------------------------------------------------------------------------
-- DKS lo pidió el 2026-10-20: «en personal solo debe aparecer personal en los
-- reportes diarios relacionados con producción o maestranza o acabados, además
-- también en recursos humanos deben seleccionar si es planilla administrativa o
-- planilla de taller».
--
-- 1. LA FICHA LLEVA SU PLANILLA. RR. HH. elige en cada persona si va en la
--    planilla de taller (la gente que trabaja en las unidades) o en la
--    administrativa (la oficina). A quien ya estaba registrado se le pone la de
--    su área: administrativa si su área es de la oficina (`areas.es_oficina`),
--    de taller si no. RR. HH. lo corrige en la ficha. En producción había una
--    sola persona, de Recursos Humanos: queda administrativa.
--
-- 2. EL REPORTE DIARIO OFRECE SOLO A LA GENTE DEL TALLER. El supervisor elige
--    su personal entre la gente de planilla de taller de Maestranza, Producción
--    o Acabados. La base no rechaza a otra persona en un reporte: corregir uno
--    viejo que la llevaba no tiene que caerse, y el costeo sigue igual.
--
-- El sueldo de la oficina (20261020110000) sigue contando por el área de cada
-- persona (`areas.es_oficina`), no por esta planilla.
-- =============================================================================

-- 1. La planilla en la ficha ------------------------------------------------------------
-- Solo la primera vez se pone la de su área: al volver a correr la migración no
-- se pisa lo que RR. HH. ya corrigió.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'trabajadores' and column_name = 'planilla') then
    alter table public.trabajadores add column planilla text not null default 'TALLER';
    update public.trabajadores t set planilla = 'ADMINISTRATIVA'
      from public.areas a
     where a.id = t.area_id and a.es_oficina;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_trabajador_planilla') then
    alter table public.trabajadores add constraint ck_trabajador_planilla check (planilla in ('TALLER', 'ADMINISTRATIVA'));
  end if;
end $$;
-- Por columna, como el resto de la ficha que no es reservada: la revisión
-- (20261020165000) le quita a authenticated el select de la tabla entera y
-- devuelve columna por columna; sin esta línea nadie leería la planilla.
grant select (planilla) on public.trabajadores to authenticated;
comment on column public.trabajadores.planilla is
  'En qué planilla va la persona: TALLER (la gente de las unidades, la que el supervisor pone en el reporte diario) o ADMINISTRATIVA (la oficina). La elige RR. HH. en la ficha.';

-- RR. HH. la elige, como la fecha de ingreso, aparte de la ficha: la firma de
-- rrhh_guardar_trabajador no se toca.
create or replace function public.rrhh_guardar_planilla_trabajador(p_trabajador_id uuid, p_planilla text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_planilla text := upper(btrim(coalesce(p_planilla, '')));
begin
  perform public.exigir_permiso('rrhh.personal');
  if v_planilla not in ('TALLER', 'ADMINISTRATIVA') then
    raise exception 'Elige la planilla de la persona: de taller o administrativa.' using errcode = 'check_violation';
  end if;
  update public.trabajadores set planilla = v_planilla where id = p_trabajador_id;
  if not found then
    raise exception 'Esa persona no está registrada. Recarga la pantalla.' using errcode = 'check_violation';
  end if;
  return p_trabajador_id;
end;
$$;
revoke all on function public.rrhh_guardar_planilla_trabajador(uuid, text) from public, anon;
grant execute on function public.rrhh_guardar_planilla_trabajador(uuid, text) to authenticated;
comment on function public.rrhh_guardar_planilla_trabajador(uuid, text) is
  'RR. HH. elige si la persona va en la planilla de taller o en la administrativa. Exige rrhh.personal.';

-- 2. El reporte diario ofrece solo a la gente del taller -------------------------------
create or replace function public.reporte_diario_personal_disponible()
returns table (id uuid, nombres text, apellidos text, cargo text, area_id uuid, area text)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  perform public.exigir_permiso('reporte_diario.registrar');
  return query
    select t.id, t.nombres, t.apellidos, t.cargo, t.area_id, a.nombre
      from public.trabajadores t
      join public.areas a on a.id = t.area_id
     where t.activo
       and t.planilla = 'TALLER'
       and a.codigo in ('MTZ', 'PRD', 'ACB')
     order by t.apellidos, t.nombres;
end;
$$;
revoke all on function public.reporte_diario_personal_disponible() from public, anon;
grant execute on function public.reporte_diario_personal_disponible() to authenticated;
comment on function public.reporte_diario_personal_disponible() is
  'La gente que el supervisor puede poner en su reporte diario: activa, de planilla de taller y de Maestranza, Producción o Acabados. Sin DNI, cuenta ni costo. Exige reporte_diario.registrar.';
