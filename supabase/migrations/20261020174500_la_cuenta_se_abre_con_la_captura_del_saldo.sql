-- =============================================================================
-- LA CUENTA SE ABRE CON LA CAPTURA DE SU SALDO
-- -----------------------------------------------------------------------------
-- DKS lo pidió el 2026-10-20 al ver la ventana «Agregar una cuenta» de la caja
-- diaria: «falta anexar imagen de apertura de caja por cuenta donde se pueda
-- ver el saldo del aplicativo». El saldo inicial con el que una cuenta empieza
-- en el sistema hoy es un número que alguien escribió; desde aquí lleva su
-- respaldo, la pantalla del aplicativo del banco con el saldo de ese día, y se
-- puede volver a mirar desde la cuenta.
--
--   * `cajas.apertura_ruta`: la captura, en el bucket privado `apertura-caja`,
--     en `{cuenta}/{archivo}.{jpg|png|webp|pdf}`. La lee quien lleva la caja
--     (`tesoreria.caja`), como la cuenta misma.
--   * Una cuenta de banco nueva no se da de alta sin su captura, ni pasa a
--     ser de banco sin ella la que era de efectivo. La caja chica en efectivo
--     no tiene aplicativo: la foto del conteo es opcional.
--   * Las cuentas que ya existen no se tocan. Se les adjunta la captura al
--     corregirlas, tengan o no movimientos.
--   * La captura se cambia mientras la cuenta no tenga movimientos, que es
--     mientras su saldo inicial todavía se corrige. Con movimientos queda como
--     respaldo de ese saldo y ya no cambia, igual que el saldo.
--
-- `guardar_caja` gana `p_apertura_ruta` al final. La versión de ocho
-- parámetros se queda con su nombre y llama a la nueva sin captura: una
-- pantalla abierta desde antes corrige sus cuentas igual, y al dar de alta un
-- banco recibe el mensaje que pide la captura. Sin valor por omisión en el
-- parámetro nuevo, para que PostgREST no dude entre las dos.
--
-- La columna no lleva índice: la política de Storage la busca por la ruta, y
-- la tabla tiene una fila por cuenta de Tesorería (diez, no diez mil).
--
-- Idempotente: `add column if not exists`, `on conflict`, políticas dentro de
-- `if not exists` y `create or replace` con la misma firma.
-- =============================================================================

-- 1. Dónde queda la captura -------------------------------------------------------------
alter table public.cajas
  add column if not exists apertura_ruta text
    constraint ck_caja_apertura_ruta
    check (apertura_ruta is null or apertura_ruta ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$');
comment on column public.cajas.apertura_ruta is
  'La captura del aplicativo del banco (o la foto del conteo de la caja chica) con el saldo inicial, en el bucket apertura-caja. Obligatoria al dar de alta una cuenta de banco; no cambia cuando la cuenta ya tiene movimientos.';

-- Privado, hasta 10 MB, foto o PDF. Lo sube Tesorería; lo ven quien lleva la
-- caja (la política de `cajas` decide qué fila se ve) y quien lo subió mientras
-- ninguna cuenta lo nombra, para poder retirarlo si el alta no entró.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('apertura-caja', 'apertura-caja', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'apertura_caja_subir') then
    create policy apertura_caja_subir on storage.objects for insert to authenticated with check (
      bucket_id = 'apertura-caja' and owner_id = (select auth.uid())::text
      and (select public.es_admin() or public.tiene_permiso('tesoreria.caja')));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'apertura_caja_ver') then
    create policy apertura_caja_ver on storage.objects for select to authenticated using (
      bucket_id = 'apertura-caja'
      and (select public.es_admin() or public.tiene_permiso('tesoreria.caja'))
      and (owner_id = (select auth.uid())::text
           or exists (select 1 from public.cajas c where c.apertura_ruta = objects.name)));
  end if;
  -- La que ninguna cuenta nombra: la del alta que no entró, o la que se cambió.
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'apertura_caja_quitar_suelta') then
    create policy apertura_caja_quitar_suelta on storage.objects for delete to authenticated using (
      bucket_id = 'apertura-caja' and owner_id = (select auth.uid())::text
      and (select public.es_admin() or public.tiene_permiso('tesoreria.caja'))
      and not exists (select 1 from public.cajas c where c.apertura_ruta = objects.name));
  end if;
end $$;

-- 2. Dar de alta, corregir y desactivar una cuenta, con su captura ---------------------------
create or replace function public.guardar_caja(
  p_id uuid, p_nombre text, p_tipo text, p_banco text, p_moneda text,
  p_saldo_inicial numeric, p_fecha_inicio date, p_activa boolean, p_apertura_ruta text
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_hoy     date := (now() at time zone 'America/Lima')::date;
  v_nombre  text := regexp_replace(btrim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
  v_banco   text := nullif(regexp_replace(btrim(coalesce(p_banco, '')), '\s+', ' ', 'g'), '');
  v_tipo    text := upper(btrim(coalesce(p_tipo, '')));
  v_moneda  text := upper(btrim(coalesce(p_moneda, '')));
  v_activa  boolean := coalesce(p_activa, true);
  v_ruta    text := nullif(btrim(coalesce(p_apertura_ruta, '')), '');
  v_previa  public.cajas%rowtype;
  v_existe  boolean;
  v_con_mov boolean := false;
  v_otra    text;
  v_saldo   numeric;
begin
  perform public.exigir_permiso('tesoreria.caja');
  if p_id is null then
    raise exception 'Vuelve a abrir el formulario de la cuenta.' using errcode = 'check_violation';
  end if;
  if char_length(v_nombre) not between 2 and 60 then
    raise exception 'Ponle un nombre a la cuenta, de 2 a 60 caracteres: «BCP soles», «Caja chica».' using errcode = 'check_violation';
  end if;
  if v_tipo not in ('BANCO', 'EFECTIVO') then
    raise exception 'Elige si la cuenta es de un banco o en efectivo.' using errcode = 'check_violation';
  end if;
  if v_tipo = 'BANCO' and char_length(coalesce(v_banco, '')) not between 2 and 40 then
    raise exception 'Escribe el banco de la cuenta: BCP, BBVA…' using errcode = 'check_violation';
  end if;
  if v_tipo = 'EFECTIVO' then v_banco := null; end if;
  if v_moneda not in ('PEN', 'USD') then
    raise exception 'Elige la moneda de la cuenta.' using errcode = 'check_violation';
  end if;
  if p_saldo_inicial is null or p_saldo_inicial not between -999999999 and 999999999
     or p_saldo_inicial <> round(p_saldo_inicial, 2) then
    raise exception 'Escribe el saldo inicial con dos decimales como máximo.' using errcode = 'check_violation';
  end if;
  if p_fecha_inicio is null or p_fecha_inicio > v_hoy then
    raise exception 'Elige el día de ese saldo inicial: hasta hoy.' using errcode = 'check_violation';
  end if;

  -- check_violation y no unique_violation: este mensaje es para la persona, y
  -- `mensajeDeError` cambia cualquier unique_violation por uno genérico.
  select nombre into v_otra from public.cajas where lower(btrim(nombre)) = lower(v_nombre) and id <> p_id;
  if found then
    raise exception 'Ya hay una cuenta que se llama %: ponle otro nombre.', v_otra using errcode = 'check_violation';
  end if;

  select * into v_previa from public.cajas where id = p_id for update;
  v_existe := found;
  if v_existe then
    v_con_mov := exists (select 1 from public.movimientos_caja where caja_id = p_id)
                 or exists (select 1 from public.cierres_caja where caja_id = p_id);
    if row(v_tipo, v_moneda, p_saldo_inicial, p_fecha_inicio)
       is distinct from row(v_previa.tipo, v_previa.moneda, v_previa.saldo_inicial, v_previa.fecha_inicio)
       and v_con_mov then
      raise exception 'La cuenta % ya tiene movimientos: su tipo, su moneda, su saldo inicial y su fecha no cambian. Si el saldo estaba mal, registra un ingreso o egreso de ajuste.',
        v_previa.nombre using errcode = 'check_violation';
    end if;
  end if;

  -- La captura del saldo: obligatoria al dar de alta un banco, y al pasar a
  -- banco la que era de efectivo (su foto del conteo no es la del aplicativo).
  -- Sin una nueva, se queda la que tenía. Con movimientos, la que ya tiene no
  -- se cambia.
  -- Un banco que se abre, o la caja chica que pasa a banco, trae una captura
  -- nueva: la foto del conteo que ya tenía no es la pantalla del aplicativo.
  if v_tipo = 'BANCO' and (not v_existe or v_previa.tipo <> 'BANCO')
     and (v_ruta is null or v_ruta is not distinct from v_previa.apertura_ruta) then
    raise exception 'Adjunta la captura del aplicativo del banco con el saldo de ese día: es el respaldo del saldo inicial.'
      using errcode = 'check_violation';
  end if;
  if v_ruta is null then
    v_ruta := v_previa.apertura_ruta;
  elsif v_existe and v_ruta is not distinct from v_previa.apertura_ruta then
    null;
  else
    if v_existe and v_previa.apertura_ruta is not null and v_con_mov then
      raise exception 'La cuenta % ya tiene movimientos: la captura de su saldo inicial queda como respaldo y no se cambia.',
        v_previa.nombre using errcode = 'check_violation';
    end if;
    -- Que esté subida, que sea de quien guarda, de esta cuenta, foto o PDF y hasta 10 MB.
    perform public.archivo_subido_por_mi('apertura-caja', v_ruta, p_id,
      array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
  end if;

  -- Una cuenta desactivada sale de la tabla y del consolidado: con plata
  -- adentro, esa plata desaparecería del total sin que nadie la haya movido.
  if not v_activa and (not v_existe or v_previa.activa) then
    v_saldo := p_saldo_inicial + coalesce((
      select sum(case when m.tipo = 'INGRESO' then m.monto else -m.monto end)
        from public.movimientos_caja m
       where m.caja_id = p_id and m.anulado_en is null), 0);
    if v_saldo > 0 then
      raise exception 'La cuenta % todavía tiene %: pásalo a otra cuenta con una transferencia y después desactívala.',
        coalesce(v_previa.nombre, v_nombre), public.caja_texto_monto(v_saldo, v_moneda) using errcode = 'check_violation';
    elsif v_saldo < 0 then
      raise exception 'La cuenta % está sobregirada en %: cúbrelo con una transferencia desde otra cuenta y después desactívala.',
        coalesce(v_previa.nombre, v_nombre), public.caja_texto_monto(-v_saldo, v_moneda) using errcode = 'check_violation';
    end if;
  end if;

  if v_existe then
    update public.cajas
       set nombre = v_nombre, tipo = v_tipo, banco = v_banco, moneda = v_moneda,
           saldo_inicial = p_saldo_inicial, fecha_inicio = p_fecha_inicio, activa = v_activa,
           apertura_ruta = v_ruta
     where id = p_id;
  else
    insert into public.cajas (id, nombre, tipo, banco, moneda, saldo_inicial, fecha_inicio, activa, apertura_ruta)
    values (p_id, v_nombre, v_tipo, v_banco, v_moneda, p_saldo_inicial, p_fecha_inicio, v_activa, v_ruta);
  end if;
  return p_id;
end;
$$;
comment on function public.guardar_caja(uuid, text, text, text, text, numeric, date, boolean, text) is
  'Tesorería da de alta o corrige una cuenta de la caja (banco o efectivo, moneda, saldo inicial y su día, y la captura que lo respalda: obligatoria para un banco nuevo), o la desactiva si ya no tiene saldo. Exige tesoreria.caja.';
revoke all on function public.guardar_caja(uuid, text, text, text, text, numeric, date, boolean, text) from public, anon;
grant execute on function public.guardar_caja(uuid, text, text, text, text, numeric, date, boolean, text) to authenticated;

-- La de ocho parámetros, de una pantalla abierta desde antes: la nueva, sin captura.
create or replace function public.guardar_caja(
  p_id uuid, p_nombre text, p_tipo text, p_banco text, p_moneda text,
  p_saldo_inicial numeric, p_fecha_inicio date, p_activa boolean
) returns uuid language sql set search_path to 'public' as $$
  select public.guardar_caja(p_id, p_nombre, p_tipo, p_banco, p_moneda, p_saldo_inicial, p_fecha_inicio, p_activa, null::text);
$$;
comment on function public.guardar_caja(uuid, text, text, text, text, numeric, date, boolean) is
  'La versión sin captura, para una pantalla abierta antes de la migración 20261020174500: corrige una cuenta como antes, y no da de alta un banco sin su captura.';
revoke all on function public.guardar_caja(uuid, text, text, text, text, numeric, date, boolean) from public, anon;
grant execute on function public.guardar_caja(uuid, text, text, text, text, numeric, date, boolean) to authenticated;
