-- Los planos nuevos del flujo manual indican quién los elaboró.
-- Los planos históricos sin autor siguen consultables y pueden asignarse después.
create or replace function public.validar_integrante_plano()
returns trigger language plpgsql security definer set search_path = 'public' as $$
begin
  if tg_op = 'UPDATE' and new.integrante_diseno_id is not distinct from old.integrante_diseno_id then
    return new;
  end if;
  perform public.exigir_permiso('diseno.planos');
  if new.integrante_diseno_id is null and exists (
    select 1 from public.ordenes_trabajo where id = new.orden_id and plan_etapas_manual
  ) then
    raise exception 'Indica quién elaboró el plano.' using errcode = 'check_violation';
  end if;
  if new.integrante_diseno_id is not null and not exists (
    select 1 from public.ot_equipo_diseno e
     where e.id = new.integrante_diseno_id and e.orden_id = new.orden_id
  ) then
    raise exception 'El integrante de Diseño debe pertenecer a esta OT.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.validar_integrante_plano() from public, anon, authenticated;
