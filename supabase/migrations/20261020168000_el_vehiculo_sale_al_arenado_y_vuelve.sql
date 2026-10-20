-- =============================================================================
-- EL VEHÍCULO SALE AL ARENADO EXTERNO Y VUELVE
-- -----------------------------------------------------------------------------
-- Desde la migración 20261020166000 el vehículo del trabajo del taller sale
-- solo con el 100 % del avance de su código y el visto de Tesorería, como pidió
-- StudioGRCI el 2026-10-20. Pero el arenado se hace afuera: el vehículo sale a
-- medio trabajo y vuelve con el motivo «Vuelve del arenado externo». Con la
-- regla sola, Requerimientos no podía anotar esa salida, y lo único que le
-- quedaba era anular el ingreso, que borra la evidencia de que estuvo aquí.
--
-- Esta es esa salida: la registra Requerimientos, con sus fotos, sin el 100 %
-- ni Tesorería, y queda marcada como «al arenado», que es lo que dice la lista.
-- El vehículo vuelve a entrar con el motivo Arenado y su mismo código; la
-- salida final sigue pidiendo el 100 % y a Tesorería.
-- =============================================================================

alter table public.registro_vehiculos
  add column if not exists sale_al_arenado boolean not null default false;
comment on column public.registro_vehiculos.sale_al_arenado is
  'La salida fue al arenado externo, a medio trabajo: no pidió el 100 % ni a Tesorería y el vehículo vuelve con el motivo Arenado (migración 20261020168000).';

create or replace function public.registrar_salida_al_arenado(p_id uuid, p_salida_en timestamptz, p_observacion text, p_fotos jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_reg    public.registro_vehiculos%rowtype;
  v_cuando timestamptz := coalesce(p_salida_en, now());
begin
  perform public.exigir_permiso('vehiculos.registrar');
  select * into v_reg from public.registro_vehiculos where id = p_id for update;
  if not found then raise exception 'El registro del vehículo no existe.'; end if;
  if v_reg.anulado_en is not null then
    raise exception 'Ese ingreso está anulado.' using errcode = 'check_violation';
  end if;
  -- Un reintento de la misma salida al arenado devuelve la que ya quedó.
  if v_reg.salida_en is not null then
    if v_reg.sale_al_arenado then return p_id; end if;
    raise exception 'Ese vehículo ya salió.' using errcode = 'check_violation';
  end if;
  if v_reg.unidad_id is null or not public.vehiculo_motivo_exige_codigo(v_reg.motivo) then
    raise exception 'Al arenado sale un vehículo que entró a trabajo con su código interno; este sale con «Marcar salida».'
      using errcode = 'check_violation';
  end if;
  if v_cuando > now() + interval '5 minutes' then
    raise exception 'La hora de salida no puede ser futura.' using errcode = 'check_violation';
  end if;
  if v_cuando < v_reg.ingreso_en then
    raise exception 'La salida no puede ser anterior al ingreso (%).',
      to_char(v_reg.ingreso_en at time zone 'America/Lima', 'DD/MM/YYYY HH24:MI') using errcode = 'check_violation';
  end if;
  if char_length(coalesce(p_observacion, '')) > 500 then
    raise exception 'La observación pasa de 500 caracteres.' using errcode = 'check_violation';
  end if;
  update public.registro_vehiculos
     set salida_en = v_cuando, salida_por = public.usuario_actual(), sale_al_arenado = true,
         observacion_salida = nullif(btrim(coalesce(p_observacion, '')), '')
   where id = p_id;
  perform public.vehiculo_anotar_fotos(p_id, 'SALIDA', p_fotos);
  return p_id;
end;
$$;
comment on function public.registrar_salida_al_arenado(uuid, timestamptz, text, jsonb) is
  'Requerimientos anota la salida al arenado externo de un vehículo de trabajo, sin el 100 % ni Tesorería (migración 20261020168000).';
revoke all on function public.registrar_salida_al_arenado(uuid, timestamptz, text, jsonb) from public, anon;
grant execute on function public.registrar_salida_al_arenado(uuid, timestamptz, text, jsonb) to authenticated;
