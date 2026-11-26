-- =============================================================================
-- LOS DÍAS CERRADOS DE LA CAJA, PARA LEERLOS DESPUÉS
-- -----------------------------------------------------------------------------
-- Plan 11 (Tesorería), entrega 11.3, decidido por DKS: Tesorería necesita ver
-- la historia del cierre de caja —qué día se cerró cada cuenta, quién lo cerró
-- y a qué hora, el saldo que daba el sistema, el que decía el estado de cuenta
-- y la diferencia— y Gerencia la consulta con `tesoreria.ver_documentos`, sin
-- llevar la caja. Hasta aquí un cierre solo se veía yendo día por día en la
-- caja diaria, y `cierres_caja` la lee solo quien tiene `tesoreria.caja`.
--
-- Solo lectura. Un cierre no se edita ni se borra (los disparadores de la
-- 20261017200000 lo impiden): el último se reabre con su motivo y queda como
-- evidencia. Por eso la historia trae también los reabiertos, con quién, cuándo
-- y por qué.
--
--   * `historia_cierres_caja(desde, hasta)`: los cierres de todas las cuentas
--     entre esas fechas (hasta 366 días), con la cuenta, quién cerró y quién
--     reabrió, por nombre, y si la cuenta tiene la captura de su saldo de
--     apertura. `security definer` porque Gerencia no lee `cajas` ni
--     `cierres_caja`: la función exige `tesoreria.caja` o
--     `tesoreria.ver_documentos` y no devuelve otra cosa. No toca los montos.
--   * La captura del saldo de apertura (bucket `apertura-caja`) la abre también
--     quien tiene `tesoreria.ver_documentos`, solo si una cuenta la nombra; la
--     suelta, la del alta que no entró, sigue siendo solo de quien la subió.
--     `captura_de_caja(cuenta)` le dice a la ruta que la abre dónde está, con
--     el mismo permiso que la historia.
--
-- `tesoreria.ver_documentos` lo tienen Gerencia, Tesorería y Costos (este
-- último sin cuentas activas el 2026-11-26).
--
-- Idempotente: `create or replace` con la misma firma y la política dentro de
-- `if not exists`.
-- =============================================================================

-- 1. ¿Esta ruta es la captura de una cuenta? -------------------------------------------
-- Para la política de Storage: Gerencia no lee `cajas`, así que la pregunta se
-- hace con los permisos del dueño y devuelve solo sí o no.
create or replace function public.es_captura_de_caja(p_ruta text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.cajas c where c.apertura_ruta = p_ruta);
$$;
comment on function public.es_captura_de_caja(text) is
  'Si la ruta es la captura del saldo de apertura de alguna cuenta de la caja. Solo sí o no: la usa la política de Storage del bucket apertura-caja.';
revoke all on function public.es_captura_de_caja(text) from public, anon;
grant execute on function public.es_captura_de_caja(text) to authenticated;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'apertura_caja_ver_documentos') then
    create policy apertura_caja_ver_documentos on storage.objects for select to authenticated using (
      bucket_id = 'apertura-caja'
      and (select public.tiene_permiso('tesoreria.ver_documentos'))
      and public.es_captura_de_caja(objects.name));
  end if;
end $$;

-- 2. La historia de los cierres --------------------------------------------------------
create or replace function public.historia_cierres_caja(p_desde date, p_hasta date)
returns table (
  id uuid, caja_id uuid, cuenta text, tipo text, banco text, moneda text, cuenta_activa boolean, con_captura boolean,
  fecha date, saldo_inicial numeric, ingresos numeric, egresos numeric, saldo_final numeric, saldo_banco numeric, diferencia numeric,
  observaciones text, cerrado_por text, cerrado_en timestamptz,
  reabierto_por text, reabierto_en timestamptz, motivo_reapertura text
)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not (public.es_admin() or public.tiene_permiso('tesoreria.caja') or public.tiene_permiso('tesoreria.ver_documentos')) then
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
           ua.nombres, k.anulado_en, k.motivo_anulacion
      from public.cierres_caja k
      join public.cajas c on c.id = k.caja_id
      left join public.usuarios uc on uc.id = k.cerrado_por
      left join public.usuarios ua on ua.id = k.anulado_por
     where k.fecha between p_desde and p_hasta
     order by k.fecha desc, c.nombre, k.creado_en desc;
end;
$$;
comment on function public.historia_cierres_caja(date, date) is
  'Los días cerrados de cada cuenta de la caja entre dos fechas (hasta 366 días), con quién cerró, a qué hora, el saldo del sistema, el del estado de cuenta y la diferencia, y los reabiertos con su motivo. Solo lectura. Pide tesoreria.caja o tesoreria.ver_documentos.';
revoke all on function public.historia_cierres_caja(date, date) from public, anon;
grant execute on function public.historia_cierres_caja(date, date) to authenticated;

-- 3. Dónde está la captura de una cuenta, para abrirla desde la historia ---------------------
create or replace function public.captura_de_caja(p_caja uuid)
returns table (nombre text, apertura_ruta text)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not (public.es_admin() or public.tiene_permiso('tesoreria.caja') or public.tiene_permiso('tesoreria.ver_documentos')) then
    raise exception 'No tienes permiso para ver la captura del saldo de la cuenta.' using errcode = 'insufficient_privilege';
  end if;
  return query select c.nombre, c.apertura_ruta from public.cajas c where c.id = p_caja;
end;
$$;
comment on function public.captura_de_caja(uuid) is
  'El nombre de la cuenta y la ruta de la captura de su saldo de apertura, para abrirla. Pide tesoreria.caja o tesoreria.ver_documentos.';
revoke all on function public.captura_de_caja(uuid) from public, anon;
grant execute on function public.captura_de_caja(uuid) to authenticated;
