-- =============================================================================
-- QUITAR A UNA PERSONA DE LA PLANILLA MIENTRAS ESTÁ EN BORRADOR
-- -----------------------------------------------------------------------------
-- Recursos Humanos importa la planilla del mes del Excel o agrega personas a
-- mano. Si se equivocaba —eligió a alguien que no iba, o el Excel traía un
-- nombre mal escrito que después corrigió—, no había forma de sacarlo: la
-- persona se quedaba con su costo en el reparto de las OT, y la ventana de
-- importar solo podía avisar que no se eligiera otra vez. Lo pidió el dueño el
-- 21/10, al arreglar la carga del Excel corregido (#144).
--
-- Quitar es corregir la carga, no dar de baja: la baja de quien dejó de
-- trabajar está en RR. HH. › Personal. Por eso solo se quita mientras la
-- planilla está en borrador; cerrada, su costo ya está repartido y queda como
-- está. Se va la persona con su reparto entre las OT, en un solo paso, y la
-- auditoría de las dos tablas guarda qué se quitó, quién y cuándo.
-- =============================================================================

create or replace function public.quitar_persona_de_planilla(p_persona uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_planilla uuid;
  v_estado   text;
  v_n        int;
begin
  perform public.exigir_permiso_del_puesto('rrhh.gestionar_planillas');
  select planilla_id into v_planilla from public.planilla_personas where id = p_persona;
  if not found then
    raise exception 'Esa persona ya no está en la planilla. Recarga la página.';
  end if;
  select estado into v_estado from public.planillas where id = v_planilla for update;
  if v_estado <> 'BORRADOR' then
    raise exception 'La planilla ya está cerrada: su costo ya se repartió y nadie se quita.';
  end if;
  delete from public.planilla_distribuciones where persona_id = p_persona;
  delete from public.planilla_personas where id = p_persona;
  -- Otra pestaña pudo quitarla mientras esta esperaba la planilla: no se dice
  -- «quitada» si no se quitó nada.
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'Esa persona ya no está en la planilla. Recarga la página.';
  end if;
  return p_persona;
end;
$$;

revoke all on function public.quitar_persona_de_planilla(uuid) from public, anon;
grant execute on function public.quitar_persona_de_planilla(uuid) to authenticated;
