-- =============================================================================
-- CADA DÍA SE CIERRA CON LA CAPTURA DE SU ESTADO DE CUENTA
-- -----------------------------------------------------------------------------
-- Plan 11 (Tesorería), entrega 11.3. StudioGRCI eligió el 2026-11-26, en la
-- tarjeta «¿Cada cierre del día guarda su propia captura del estado de
-- cuenta?», la opción «Sí, captura al cerrar». Hasta aquí el cierre guardaba
-- el saldo que Tesorería escribía y nada más: la única captura era la del
-- saldo con que se abrió la cuenta, que no dice nada del día que se cierra.
-- La historia de los días cerrados mostraba esa captura en cada fila y se
-- leía como si fuera la del día.
--
--   * `cierres_caja.captura_ruta`: la captura del aplicativo del banco con el
--     saldo de ese día (o la foto del conteo de la caja chica), en el bucket
--     privado `cierre-caja`, en `{cuenta}/{archivo}.{jpg|png|webp|pdf}`.
--   * Un día de una cuenta de banco no se cierra sin su captura. La caja chica
--     no tiene aplicativo: la foto del conteo es opcional, como al abrirla
--     (20261020174500).
--   * Los cierres de antes no se tocan: quedan sin captura y la historia lo
--     dice. Un cierre no se corrige (`fn_caja_registro_guardia`): la captura
--     entra con él y no cambia; si estaba mal, se reabre el día con su motivo
--     y se cierra otra vez con la buena. La del cierre reabierto se queda como
--     evidencia.
--   * La ven quien lleva la caja (`tesoreria.caja`) y Gerencia, que la
--     consulta (`tesoreria.ver_caja`, 20261126310000); Costos no
--     (StudioGRCI, 2026-11-26).
--
-- `cerrar_dia_caja` gana `p_captura_ruta` al final, sin valor por omisión para
-- que PostgREST no dude entre las dos. La de cinco parámetros no se toca aquí:
-- la pantalla que hoy está en producción la usa, y esta migración se aplica
-- antes de desplegar la que pide la captura. Recién después del despliegue, la
-- 20261126551000 la convierte en la nueva sin captura.
--
-- `historia_cierres_caja` devuelve además si el cierre tiene su captura: cambia
-- lo que devuelve, así que se suelta y se vuelve a crear (es de esta entrega y
-- solo la lee la historia).
--
-- La columna no lleva índice: la política de Storage la busca por la ruta en
-- una tabla de una fila por cuenta y día (seis cuentas, unas 1 500 filas al año).
--
-- Idempotente: `add column if not exists`, `on conflict`, políticas dentro de
-- `if not exists`, `create or replace` con la misma firma y `drop … if exists`
-- antes de crear la historia.
-- =============================================================================

-- 1. Dónde queda la captura del día ---------------------------------------------------
alter table public.cierres_caja
  add column if not exists captura_ruta text
    constraint ck_cierre_caja_captura_ruta
    check (captura_ruta is null or captura_ruta ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$');
comment on column public.cierres_caja.captura_ruta is
  'La captura del aplicativo del banco (o la foto del conteo de la caja chica) con el saldo del día que se cierra, en el bucket cierre-caja. Obligatoria al cerrar un banco desde la migración 20261126550000; los cierres de antes no la tienen.';

-- Privado, hasta 10 MB, foto o PDF. Lo sube quien lleva la caja; lo ven quien
-- lleva la caja y Gerencia (la política de `cierres_caja` decide qué fila se
-- ve), y quien lo subió mientras ningún cierre lo nombra, para poder retirarlo
-- si el cierre no entró.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cierre-caja', 'cierre-caja', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'cierre_caja_subir') then
    create policy cierre_caja_subir on storage.objects for insert to authenticated with check (
      bucket_id = 'cierre-caja' and owner_id = (select auth.uid())::text
      and (select public.es_admin() or public.tiene_permiso('tesoreria.caja')));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'cierre_caja_ver') then
    create policy cierre_caja_ver on storage.objects for select to authenticated using (
      bucket_id = 'cierre-caja'
      and (select public.es_admin() or public.tiene_permiso('tesoreria.caja') or public.tiene_permiso('tesoreria.ver_caja'))
      and (owner_id = (select auth.uid())::text
           or exists (select 1 from public.cierres_caja k where k.captura_ruta = objects.name)));
  end if;
  -- La que ningún cierre nombra: la del cierre que no entró.
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'cierre_caja_quitar_suelta') then
    create policy cierre_caja_quitar_suelta on storage.objects for delete to authenticated using (
      bucket_id = 'cierre-caja' and owner_id = (select auth.uid())::text
      and (select public.es_admin() or public.tiene_permiso('tesoreria.caja'))
      and not exists (select 1 from public.cierres_caja k where k.captura_ruta = objects.name));
  end if;
end $$;

-- 2. Cerrar el día con su captura ------------------------------------------------------
create or replace function public.cerrar_dia_caja(
  p_id uuid, p_caja_id uuid, p_fecha date, p_saldo_banco numeric, p_observaciones text, p_captura_ruta text
) returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare
  v_previo    public.cierres_caja%rowtype;
  v_caja      public.cajas%rowtype;
  v_obs       text := nullif(regexp_replace(btrim(coalesce(p_observaciones, '')), '\s+', ' ', 'g'), '');
  v_ruta      text := nullif(btrim(coalesce(p_captura_ruta, '')), '');
  v_ultimo    date;
  v_pendiente date;
  v_inicial   numeric;
  v_ingresos  numeric;
  v_egresos   numeric;
  v_final     numeric;
begin
  perform public.exigir_permiso('tesoreria.caja');
  if p_id is null then
    raise exception 'Vuelve a abrir el formulario del cierre.' using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into v_previo from public.cierres_caja where id = p_id;
  if found then
    if v_previo.cerrado_por is distinct from public.usuario_actual() then
      raise exception 'Este cierre del día ya existe con otros datos. Recarga antes de intentar de nuevo.';
    end if;
    -- Anulado después, lo repetido no lo revive ni dice que quedó como está.
    if v_previo.anulado_en is not null then
      raise exception 'Este cierre del día ya quedó registrado la primera vez que lo enviaste, y después se reabrió el día: recarga la pantalla para ver cómo quedó.';
    end if;
    -- El mismo envío repetido devuelve lo que ya quedó. Con algo cambiado ya no
    -- es el mismo: el primero quedó y lo nuevo no se guarda.
    if v_previo.caja_id = p_caja_id and v_previo.fecha = p_fecha
       and v_previo.saldo_banco = p_saldo_banco and v_previo.observaciones is not distinct from v_obs
       and v_previo.captura_ruta is not distinct from v_ruta then
      return p_id;
    end if;
    raise exception 'Este cierre del día ya quedó registrado la primera vez que lo enviaste: recarga la pantalla para ver cómo quedó.';
  end if;
  if p_saldo_banco is null or p_saldo_banco not between -999999999 and 999999999
     or p_saldo_banco <> round(p_saldo_banco, 2) then
    raise exception 'Escribe el saldo que dice el estado de cuenta, con dos decimales como máximo.' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(v_obs, '')) > 500 then
    raise exception 'Las observaciones pasan de 500 caracteres.' using errcode = 'check_violation';
  end if;
  v_caja := public.caja_dia_abierto(p_caja_id, p_fecha);

  select max(fecha) into v_ultimo from public.cierres_caja where caja_id = p_caja_id and anulado_en is null;
  select min(fecha) into v_pendiente from public.movimientos_caja
   where caja_id = p_caja_id and anulado_en is null and fecha < p_fecha
     and (v_ultimo is null or fecha > v_ultimo);
  if v_pendiente is not null then
    raise exception 'Primero cierra el % de %: tiene movimientos sin cerrar.', public.caja_texto_fecha(v_pendiente), v_caja.nombre
      using errcode = 'check_violation';
  end if;

  v_inicial := public.caja_saldo_al_empezar(p_caja_id, p_fecha);
  select coalesce(sum(monto) filter (where tipo = 'INGRESO'), 0), coalesce(sum(monto) filter (where tipo = 'EGRESO'), 0)
    into v_ingresos, v_egresos
    from public.movimientos_caja where caja_id = p_caja_id and fecha = p_fecha and anulado_en is null;
  v_final := v_inicial + v_ingresos - v_egresos;

  if p_saldo_banco <> v_final and v_obs is null then
    raise exception 'El estado de cuenta dice % y la caja %: cuenta en las observaciones por qué no cuadra.',
      public.caja_texto_monto(p_saldo_banco, v_caja.moneda), public.caja_texto_monto(v_final, v_caja.moneda)
      using errcode = 'check_violation';
  end if;
  if p_saldo_banco <> v_final and char_length(v_obs) < 10 then
    raise exception 'Cuenta un poco más por qué no cuadra: las observaciones van de 10 caracteres como mínimo.'
      using errcode = 'check_violation';
  end if;

  -- La captura del día, al final de lo que se revisa: obligatoria en un banco;
  -- en la caja chica, si la hay.
  if v_ruta is null and v_caja.tipo = 'BANCO' then
    raise exception 'Adjunta la captura del aplicativo del banco con el saldo del %: es el respaldo del cierre.',
      public.caja_texto_fecha(p_fecha) using errcode = 'check_violation';
  end if;
  if v_ruta is not null then
    -- Que esté subida, que sea de quien cierra, de esta cuenta, foto o PDF y hasta 10 MB.
    perform public.archivo_subido_por_mi('cierre-caja', v_ruta, p_caja_id,
      array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
    if exists (select 1 from public.cierres_caja where captura_ruta = v_ruta) then
      raise exception 'Esa captura ya es la de otro cierre: adjunta la de este día.' using errcode = 'check_violation';
    end if;
  end if;

  insert into public.cierres_caja (id, caja_id, fecha, saldo_inicial, ingresos, egresos, saldo_final, saldo_banco, observaciones, captura_ruta)
  values (p_id, p_caja_id, p_fecha, v_inicial, v_ingresos, v_egresos, v_final, p_saldo_banco, v_obs, v_ruta);
  return p_id;
end;
$function$;
comment on function public.cerrar_dia_caja(uuid, uuid, date, numeric, text, text) is
  'Tesorería cierra el día de una cuenta contra su estado de cuenta, con la captura del aplicativo de ese día (obligatoria en un banco; en la caja chica, la foto del conteo si la hay). Exige tesoreria.caja.';
revoke all on function public.cerrar_dia_caja(uuid, uuid, date, numeric, text, text) from public, anon;
grant execute on function public.cerrar_dia_caja(uuid, uuid, date, numeric, text, text) to authenticated;

-- 3. La historia dice si cada cierre tiene su captura -----------------------------------
drop function if exists public.historia_cierres_caja(date, date);
create function public.historia_cierres_caja(p_desde date, p_hasta date)
returns table (
  id uuid, caja_id uuid, cuenta text, tipo text, banco text, moneda text, cuenta_activa boolean, con_captura boolean,
  fecha date, saldo_inicial numeric, ingresos numeric, egresos numeric, saldo_final numeric, saldo_banco numeric, diferencia numeric,
  observaciones text, cerrado_por text, cerrado_en timestamptz,
  reabierto_por text, reabierto_en timestamptz, motivo_reapertura text,
  con_captura_del_dia boolean
)
language plpgsql stable security invoker set search_path to 'public' as $$
begin
  if not (public.es_admin() or public.tiene_permiso('tesoreria.caja') or public.tiene_permiso('tesoreria.ver_caja')) then
    raise exception 'No tienes permiso para ver los días cerrados de la caja.' using errcode = 'insufficient_privilege';
  end if;
  if p_desde is null or p_hasta is null or p_desde > p_hasta then
    raise exception 'Elige desde qué día y hasta qué día ver los cierres.' using errcode = 'check_violation';
  end if;
  if p_hasta - p_desde > 366 then
    raise exception 'Se ven hasta 366 días a la vez: acorta las fechas.' using errcode = 'check_violation';
  end if;
  return query
    select k.id, k.caja_id, c.nombre, c.tipo, c.banco, c.moneda, c.activa, c.apertura_ruta is not null,
           k.fecha, k.saldo_inicial, k.ingresos, k.egresos, k.saldo_final, k.saldo_banco, k.diferencia,
           k.observaciones, uc.nombres, k.creado_en,
           ua.nombres, k.anulado_en, k.motivo_anulacion,
           k.captura_ruta is not null
      from public.cierres_caja k
      join public.cajas c on c.id = k.caja_id
      left join public.usuarios uc on uc.id = k.cerrado_por
      left join public.usuarios ua on ua.id = k.anulado_por
     where k.fecha between p_desde and p_hasta
     order by k.fecha desc, c.nombre, k.creado_en desc;
end;
$$;
comment on function public.historia_cierres_caja(date, date) is
  'Los días cerrados de cada cuenta de la caja entre dos fechas (hasta 366 días), con quién cerró, a qué hora, el saldo del sistema, el del estado de cuenta, la diferencia y si el cierre tiene su captura, y los reabiertos con su motivo. Solo lectura. Pide tesoreria.caja o tesoreria.ver_caja (Tesorería y Gerencia; Costos no, decisión de StudioGRCI del 2026-11-26).';
revoke all on function public.historia_cierres_caja(date, date) from public, anon;
grant execute on function public.historia_cierres_caja(date, date) to authenticated;
