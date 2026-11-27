-- =============================================================================
-- EL RQ DEL ÁREA ES GASTO OPERATIVO
-- -----------------------------------------------------------------------------
-- DKS, 2026-11-27: «falta algo en producción, maestranza y acabados: pedir
-- herramientas para el área; ese costo iría como gasto operativo». Entrega 1
-- del plan del gasto operativo: el RQ de operación puede ser para una unidad o
-- para el área misma.
--
-- El del área va con el código PLANTA, que el costeo no carga a ninguna
-- unidad. Pero PLANTA ya tenía otro uso: el stock de planta que después sale a
-- una unidad. En la salida del kardex, Almacén elige a qué vehículo va lo de un
-- RQ de PLANTA, y el costo termina en la OT de ese vehículo (lo encontró el
-- auditor de funcionamiento con clic real). Un RQ que dice «gasto operativo» y
-- termina en una OT miente. Por eso:
--
--   1. `requerimientos.para_el_area` marca el RQ del área. Solo lo pone
--      `emitir_requerimiento_del_area`, en la misma transacción que lo registra.
--      Los RQ de PLANTA de antes quedan como estaban: no se marcan.
--   2. Lo que sale del almacén para un RQ del área sale a PLANTA, sin vehículo
--      ni OT: un disparador lo exige en cada salida, la cree quien la cree.
--   3. Si el RQ se corrige a otro código, deja de ser del área.
--
-- Sin DROP. Idempotente.
-- =============================================================================

-- 1. La marca ------------------------------------------------------------------------
alter table public.requerimientos add column if not exists para_el_area boolean not null default false;
comment on column public.requerimientos.para_el_area is
  'El RQ es para el área (herramientas e insumos con que trabaja), no para una unidad: gasto operativo de su área. Va con PLANTA y lo que sale para él va a PLANTA, sin vehículo ni OT. Lo pone emitir_requerimiento_del_area.';

-- Solo puede ser del área un RQ de operación con PLANTA. Corregido a otro
-- código, deja de serlo; registrado así con otro código, no entra.
create or replace function public.fn_rq_del_area_va_con_planta()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if new.para_el_area
     and (new.tipo is distinct from 'OPERACION' or public.normalizar_codigo_interno(new.codigo_interno) is distinct from 'PLANTA') then
    if tg_op = 'UPDATE' and old.para_el_area then
      new.para_el_area := false;
    else
      raise exception 'Un requerimiento para el área es de operación y va con PLANTA.' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.fn_rq_del_area_va_con_planta() from public, anon, authenticated;

create or replace trigger trg_rq_del_area_va_con_planta
  before insert or update on public.requerimientos
  for each row execute function public.fn_rq_del_area_va_con_planta();

-- 2. Registrar el RQ del área ----------------------------------------------------------
-- Lo mismo que `emitir_requerimiento` de operación con PLANTA (permisos, área,
-- numeración, insumos y el mismo envío que no duplica), y además la marca. El
-- permiso se mira primero, antes de leer nada. Si con ese id ya hay un RQ que
-- no es del área, es otro envío: no se marca; si es de la misma persona, la
-- primera vez entró (la respuesta se perdió) y se dice así, como en
-- `emitir_requerimiento` (migración 20261023100000).
create or replace function public.emitir_requerimiento_del_area(
  p_id uuid, p_area_id uuid, p_justificacion text, p_fecha_requerida date, p_lineas jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_antes record;
  v_id uuid;
begin
  perform public.rq_exigir_del_area('OPERACION', 'REGISTRAR', p_area_id, null);
  -- El mismo candado que `emitir_requerimiento`: dos envíos del mismo id a la
  -- vez se esperan, y el segundo ya ve el RQ marcado.
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select r.para_el_area, r.creado_por, r.numero into v_antes from public.requerimientos r where r.id = p_id;
  if found and not v_antes.para_el_area then
    if v_antes.creado_por is distinct from public.usuario_actual() then
      raise exception 'Este requerimiento ya existe con otros datos. Recarga antes de intentar de nuevo.' using errcode = 'unique_violation';
    end if;
    raise exception 'Este requerimiento ya quedó registrado% la primera vez que lo enviaste: recarga la pantalla para ver cómo quedó.',
      coalesce(' como ' || v_antes.numero, '') using errcode = 'unique_violation';
  end if;
  v_id := public.emitir_requerimiento(p_id, 'OPERACION', p_area_id, 'PLANTA', p_justificacion, p_fecha_requerida, p_lineas);
  if v_antes.para_el_area is null then
    -- Recién registrado: la marca tiene que quedar, o sería un RQ de PLANTA que sale a una unidad.
    update public.requerimientos set para_el_area = true where id = v_id and not para_el_area;
    if not found and not exists (select 1 from public.requerimientos r where r.id = v_id and r.para_el_area) then
      raise exception 'No se pudo marcar el requerimiento como gasto operativo del área. Vuelve a intentarlo.';
    end if;
  end if;
  return v_id;
end $$;
revoke all on function public.emitir_requerimiento_del_area(uuid, uuid, text, date, jsonb) from public, anon;
grant execute on function public.emitir_requerimiento_del_area(uuid, uuid, text, date, jsonb) to authenticated;
comment on function public.emitir_requerimiento_del_area(uuid, uuid, text, date, jsonb) is
  'Registra el RQ de operación para el área (gasto operativo): emitir_requerimiento con PLANTA, y lo marca para_el_area. Mismos permisos.';

-- 3. Lo del RQ del área sale a PLANTA ----------------------------------------------------
-- Va al final de los BEFORE (zz): mira el vehículo y la OT que ya pusieron los
-- demás disparadores.
create or replace function public.fn_salida_del_rq_del_area_va_a_planta()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_rq record;
begin
  if new.tipo is distinct from 'SALIDA' or new.requerimiento_linea_id is null then
    return new;
  end if;
  select r.numero, a.nombre as area into v_rq
    from public.requerimiento_lineas l
    join public.requerimientos r on r.id = l.requerimiento_id
    left join public.areas a on a.id = r.area_id
   where l.id = new.requerimiento_linea_id and r.para_el_area;
  if not found then
    return new;
  end if;
  if public.normalizar_codigo_interno(new.codigo_interno) is distinct from 'PLANTA'
     or new.unidad_id is not null or new.orden_id is not null then
    raise exception 'El % es gasto operativo de %: lo que sale para él va a PLANTA, no a una unidad ni a una OT.',
      v_rq.numero, coalesce(v_rq.area, 'su área') using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function public.fn_salida_del_rq_del_area_va_a_planta() from public, anon, authenticated;

create or replace trigger trg_zz_salida_del_rq_del_area_va_a_planta
  before insert or update on public.movimientos_materiales
  for each row execute function public.fn_salida_del_rq_del_area_va_a_planta();
