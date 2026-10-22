-- =============================================================================
-- UNA PERSONA POR MES, POR CUALQUIER VÍA Y AUNQUE SE CARGUE A LA VEZ
-- -----------------------------------------------------------------------------
-- Una persona se cuenta una sola vez en el mes: si ya está en la planilla de
-- taller, no entra en la administrativa. Esa regla vivía solo dentro de
-- `importar_planilla_excel` (migración 20261001203000), y tenía dos huecos que
-- encontró la auditoría del arreglo del Excel corregido (#144):
--
-- 1. Bloqueaba solo la planilla de destino. Si Recursos Humanos importaba el
--    mismo Excel en la de taller y en la administrativa al mismo tiempo —dos
--    pestañas, dos personas de la oficina—, cada carga miraba antes de que la
--    otra terminara y la persona quedaba en las dos, con su costo dos veces.
-- 2. «Agregar persona o subcontrato a mano» y corregir el nombre de alguien no
--    pasaban por esa función: la misma persona entraba en dos planillas del mes
--    sin ningún aviso.
--
-- Ahora la regla la cuida la tabla, en un disparador, para el alta a mano, el
-- cambio de nombre y la importación. Antes de mirar, toma un bloqueo del mes:
-- la segunda carga espera a que la primera termine y entonces ve a la persona.
-- Siempre después de la fila de su planilla (`fn_planilla_abierta` la bloquea
-- primero), así dos cargas no se esperan una a la otra para siempre. La
-- importación toma el mismo bloqueo antes de su propia comprobación, para que
-- su mensaje —con el nombre como venía en el Excel— siga siendo el que se ve.
--
-- Las planillas de subcontratos quedan fuera de lo que se agrega a mano: ahí
-- se anotan proveedores y contratos, y uno puede tener dos en el mes. La
-- importación no cambia: sigue contando las tres planillas, como antes.
-- =============================================================================

-- La llave del mes, igual para todos sin depender de cómo muestre las fechas
-- la sesión.
create or replace function public.bloquear_mes_de_planilla(p_periodo date)
returns void
language sql
volatile
set search_path to 'public'
as $$
  select pg_advisory_xact_lock(hashtextextended('planilla-periodo:' || to_char(p_periodo, 'YYYY-MM-DD'), 0))
$$;

revoke all on function public.bloquear_mes_de_planilla(date) from public, anon, authenticated;

create or replace function public.fn_planilla_persona_una_por_mes()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_periodo date;
  v_tipo    text;
  v_choque  record;
begin
  if tg_op = 'UPDATE' and public.clave_nombre_planilla(new.nombre) = public.clave_nombre_planilla(old.nombre) then
    return new;
  end if;
  select periodo, tipo into v_periodo, v_tipo from public.planillas where id = new.planilla_id;
  if not found or (v_tipo = 'SUBCONTRATOS' and new.importacion_id is null) then
    return new;
  end if;
  perform public.bloquear_mes_de_planilla(v_periodo);
  select p.tipo into v_choque
    from public.planilla_personas pp
    join public.planillas p on p.id = pp.planilla_id and p.periodo = v_periodo
   where pp.id <> new.id
     and public.clave_nombre_planilla(pp.nombre) = public.clave_nombre_planilla(new.nombre)
     and (p.tipo <> 'SUBCONTRATOS' or pp.importacion_id is not null)
   limit 1;
  if found then
    raise exception '% ya está en la planilla % de este mes: una persona se cuenta una sola vez.',
      btrim(new.nombre), lower(case v_choque.tipo when 'TALLER' then 'de taller' when 'ADMINISTRATIVA' then 'administrativa' else 'de subcontratos' end)
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.fn_planilla_persona_una_por_mes() from public, anon, authenticated;

-- Después de `planilla_persona_abierta` (los disparadores van por nombre), que
-- ya bloqueó la fila de la planilla.
create or replace trigger planilla_persona_una_por_mes
  before insert or update of nombre on public.planilla_personas
  for each row execute function public.fn_planilla_persona_una_por_mes();

-- La importación toma el bloqueo del mes antes de su propia comprobación. Se
-- cambia sobre la definición viva, como en la 20261020167000, para no deshacer
-- lo que esa migración le cambió al permiso; si ya lo tiene, no se toca.
do $$
declare
  v_def   text := pg_get_functiondef('public.importar_planilla_excel(uuid, uuid, jsonb)'::regprocedure);
  v_ancla constant text := 'if not found then raise exception ''La planilla no existe.''; end if;';
begin
  if v_def ~ 'bloquear_mes_de_planilla' then
    return;
  end if;
  if position(v_ancla in v_def) = 0 then
    raise exception 'importar_planilla_excel cambió: no se encontró dónde poner el bloqueo del mes.';
  end if;
  execute replace(v_def, v_ancla, v_ancla || E'\n'
    || '  -- El mes entero, para que dos cargas a la vez en planillas distintas no' || E'\n'
    || '  -- dejen a la misma persona en las dos (migración 20261021160000).' || E'\n'
    || '  perform public.bloquear_mes_de_planilla(v_periodo);');
end;
$$;
