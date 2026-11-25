-- =============================================================================
-- LA MARCA REPETIDA ES LA MISMA MARCA
-- =============================================================================
-- Plan 14 de Portería (2026-11-25): sin señal, la portería vuelve a tocar
-- «Reintentar» con el mismo envío, y la base no la marca dos veces porque
-- `marcar_asistencia` reconoce su id. Pero lo reconocía solo por el id: si ese
-- envío ya había entrado como otra cosa —el ingreso de otra persona, el ingreso
-- cuando ahora se pide la salida, una marca que después se anuló—, contestaba
-- «listo» sin guardar nada, y la pantalla decía «Salida marcada» con la salida
-- sin marcar. El mismo envío es todo lo que el envío lleva (skill `seguridad`):
-- la persona, si es ingreso o salida, la observación y la cuenta que la registró. Si todo coincide y la
-- marca sigue vigente, es la misma y se devuelve; si no, se dice qué pasó.
--
-- Lo demás de la función queda igual: la hora la pone la base, en Lima; el
-- permiso es el del puesto (`asistencia.marcar`, de la portería).
-- =============================================================================

-- La función se reemplaza entera: antes se mira que sea la que conoce el
-- repositorio (la de la 20261015100000 con el permiso del puesto que le puso la
-- 20261020169000), o esta misma si la migración ya corrió. Si en producción se
-- cambió a mano, se detiene y no la pisa (skill `esquema`, 20261022160000).
do $$
declare
  huella text;
begin
  select md5(replace(p.prosrc, E'\r', '')) into huella
    from pg_proc p where p.oid = to_regprocedure('public.marcar_asistencia(uuid,uuid,text,text)');
  if huella is null then
    raise exception 'Falta la función marcar_asistencia: esta base no tiene las migraciones anteriores.';
  end if;
  if huella not in ('ec56f2e5aeb1fae87ed0272e80b60350', '4e52a0f7e26d5be713da3430e5b0a51e') then
    raise exception 'La función marcar_asistencia no es la que conoce el repositorio (se cambió a mano, huella %): no se reemplaza. Avisa antes de seguir.', huella;
  end if;
end $$;

create or replace function public.marcar_asistencia(p_id uuid, p_trabajador_id uuid, p_tipo text, p_observacion text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_trab     public.trabajadores%rowtype;
  v_regla    public.rrhh_regla_tardanza%rowtype;
  v_ahora    timestamptz := now();
  v_fecha    date := (now() at time zone 'America/Lima')::date;
  v_hora     time := (now() at time zone 'America/Lima')::time;
  v_minutos  int := 0;
  v_tarde    boolean := false;
  v_previa   public.asistencias%rowtype;
  v_de       text;
begin
  perform public.exigir_permiso_del_puesto('asistencia.marcar');
  if p_id is null then
    raise exception 'Vuelve a cargar la pantalla de asistencia.' using errcode = 'check_violation';
  end if;
  if p_tipo not in ('INGRESO', 'SALIDA') then
    raise exception 'Elige si marca ingreso o salida.' using errcode = 'check_violation';
  end if;
  if p_observacion is not null and char_length(p_observacion) > 300 then
    raise exception 'La observación pasa de 300 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_trab from public.trabajadores where id = p_trabajador_id;
  if not found or not v_trab.activo then
    raise exception 'Esa persona no está en el personal activo: pídele a Recursos Humanos que la registre.' using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_trabajador_id::text, 0));
  -- El mismo envío otra vez: misma persona, mismo tipo, misma observación, la
  -- misma cuenta que lo registró y todavía vigente. Si no, ese envío ya fue
  -- otra marca y esta no entra.
  select * into v_previa from public.asistencias where id = p_id;
  if found then
    if v_previa.trabajador_id = p_trabajador_id and v_previa.tipo = p_tipo
       and coalesce(v_previa.observacion, '') = coalesce(nullif(btrim(coalesce(p_observacion, '')), ''), '')
       and v_previa.registrado_por = public.usuario_actual()
       and v_previa.anulado_en is null then
      return p_id;
    end if;
    if v_previa.anulado_en is not null then
      raise exception 'Esa marca ya había entrado y después se anuló: esta no entró. Mira el motivo de la anulación antes de marcarla otra vez.'
        using errcode = 'unique_violation';
    end if;
    select t.nombres || ' ' || t.apellidos into v_de from public.trabajadores t where t.id = v_previa.trabajador_id;
    raise exception 'Esa marca ya había entrado como % de %: esta no entró.',
      case v_previa.tipo when 'INGRESO' then 'el ingreso' else 'la salida' end, coalesce(v_de, 'otra persona')
      using errcode = 'unique_violation';
  end if;

  select * into v_previa from public.asistencias
   where trabajador_id = p_trabajador_id and fecha = v_fecha and tipo = p_tipo and anulado_en is null;
  if found then
    raise exception '% ya marcó % hoy a las %.', v_trab.nombres || ' ' || v_trab.apellidos,
      case p_tipo when 'INGRESO' then 'su ingreso' else 'su salida' end, to_char(v_previa.hora, 'HH24:MI')
      using errcode = 'unique_violation';
  end if;
  if p_tipo = 'SALIDA' and not exists (
      select 1 from public.asistencias
       where trabajador_id = p_trabajador_id and fecha = v_fecha and tipo = 'INGRESO' and anulado_en is null) then
    raise exception '% no tiene ingreso marcado hoy: marca primero el ingreso.', v_trab.nombres || ' ' || v_trab.apellidos
      using errcode = 'check_violation';
  end if;

  if p_tipo = 'INGRESO' and v_hora > v_trab.hora_entrada then
    select * into v_regla from public.rrhh_regla_tardanza where id;
    v_minutos := floor(extract(epoch from (v_hora - v_trab.hora_entrada)) / 60)::int;
    v_tarde := v_minutos > coalesce(v_regla.tolerancia_minutos, 0);
  end if;

  insert into public.asistencias (id, trabajador_id, fecha, tipo, marcado_en, hora, tardanza_minutos, descuento, es_tardanza, observacion)
  values (p_id, p_trabajador_id, v_fecha, p_tipo, v_ahora, v_hora, v_minutos, 0, v_tarde, nullif(btrim(coalesce(p_observacion, '')), ''));
  return p_id;
end;
$$;
revoke all on function public.marcar_asistencia(uuid, uuid, text, text) from public, anon;
grant execute on function public.marcar_asistencia(uuid, uuid, text, text) to authenticated;
