-- =============================================================================
-- LA CAJA NO PIERDE CUENTAS CON SALDO
-- -----------------------------------------------------------------------------
-- La revisión de la caja diaria (2026-10-17, después de la 20261017200000)
-- encontró que una cuenta desactivada con plata adentro se salía de la tabla
-- de saldos y del consolidado sin ningún aviso: con S/ 300 en la caja chica,
-- «En soles» bajaba S/ 300 de un día para otro y nadie sabía por qué. En el
-- Excel una cuenta no desaparece mientras tenga saldo. Desde aquí:
--
--   * `guardar_caja` no desactiva una cuenta que todavía tiene saldo: primero
--     se pasa con una transferencia. Y el nombre repetido se dice con su
--     propio mensaje, no con el genérico de «ya existe un registro».
--   * `registrar_transferencia_caja` no acepta un dólar fuera de S/ 2 a S/ 6:
--     un cambio de 1.00 era un error de tipeo que entraba igual.
--   * `cerrar_dia_caja` dice que las observaciones van de 10 caracteres cuando
--     se escribió algo más corto, en vez de pedirlas como si estuvieran vacías.
--   * `caja_del_dia` ordena cada banco con los soles antes que los dólares,
--     como el estado de caja.
--   * El ejemplo del mensaje de la descripción ya no usa un número de OC de la
--     serie real (el repositorio es público).
--
-- Solo `create or replace` de funciones que ya existen, con la misma firma.
-- =============================================================================

-- 1. Dar de alta, corregir y desactivar una cuenta --------------------------------------------
create or replace function public.guardar_caja(
  p_id uuid, p_nombre text, p_tipo text, p_banco text, p_moneda text,
  p_saldo_inicial numeric, p_fecha_inicio date, p_activa boolean
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_hoy     date := (now() at time zone 'America/Lima')::date;
  v_nombre  text := regexp_replace(btrim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
  v_banco   text := nullif(regexp_replace(btrim(coalesce(p_banco, '')), '\s+', ' ', 'g'), '');
  v_tipo    text := upper(btrim(coalesce(p_tipo, '')));
  v_moneda  text := upper(btrim(coalesce(p_moneda, '')));
  v_activa  boolean := coalesce(p_activa, true);
  v_previa  public.cajas%rowtype;
  v_existe  boolean;
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
    if row(v_tipo, v_moneda, p_saldo_inicial, p_fecha_inicio)
       is distinct from row(v_previa.tipo, v_previa.moneda, v_previa.saldo_inicial, v_previa.fecha_inicio)
       and (exists (select 1 from public.movimientos_caja where caja_id = p_id)
            or exists (select 1 from public.cierres_caja where caja_id = p_id)) then
      raise exception 'La cuenta % ya tiene movimientos: su tipo, su moneda, su saldo inicial y su fecha no cambian. Si el saldo estaba mal, registra un ingreso o egreso de ajuste.',
        v_previa.nombre using errcode = 'check_violation';
    end if;
  end if;

  -- Una cuenta desactivada sale de la tabla y del consolidado: con plata
  -- adentro, esa plata desaparecería del total sin que nadie la haya movido.
  if not v_activa and (not v_existe or v_previa.activa) then
    v_saldo := p_saldo_inicial + coalesce((
      select sum(case when m.tipo = 'INGRESO' then m.monto else -m.monto end)
        from public.movimientos_caja m
       where m.caja_id = p_id and m.anulado_en is null), 0);
    if v_saldo <> 0 then
      raise exception 'La cuenta % todavía tiene %: pásalo a otra cuenta con una transferencia y después desactívala.',
        coalesce(v_previa.nombre, v_nombre), public.caja_texto_monto(v_saldo, v_moneda) using errcode = 'check_violation';
    end if;
  end if;

  if v_existe then
    update public.cajas
       set nombre = v_nombre, tipo = v_tipo, banco = v_banco, moneda = v_moneda,
           saldo_inicial = p_saldo_inicial, fecha_inicio = p_fecha_inicio, activa = v_activa
     where id = p_id;
  else
    insert into public.cajas (id, nombre, tipo, banco, moneda, saldo_inicial, fecha_inicio, activa)
    values (p_id, v_nombre, v_tipo, v_banco, v_moneda, p_saldo_inicial, p_fecha_inicio, v_activa);
  end if;
  return p_id;
end;
$$;
comment on function public.guardar_caja(uuid, text, text, text, text, numeric, date, boolean) is
  'Tesorería da de alta o corrige una cuenta de la caja (banco o efectivo, moneda, saldo inicial y su día), o la desactiva si ya no tiene saldo. Exige tesoreria.caja.';
revoke all on function public.guardar_caja(uuid, text, text, text, text, numeric, date, boolean) from public, anon;
grant execute on function public.guardar_caja(uuid, text, text, text, text, numeric, date, boolean) to authenticated;

-- 2. Registrar un ingreso o un egreso ------------------------------------------------------------
create or replace function public.registrar_movimiento_caja(
  p_id uuid, p_caja_id uuid, p_fecha date, p_tipo text, p_monto numeric, p_descripcion text,
  p_codigo_interno text, p_operacion text, p_tipo_cambio numeric
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_caja    public.cajas%rowtype;
  v_tipo    text := upper(btrim(coalesce(p_tipo, '')));
  v_desc    text := regexp_replace(btrim(coalesce(p_descripcion, '')), '\s+', ' ', 'g');
  v_codigo  text := public.normalizar_codigo_interno(p_codigo_interno);
  v_op      text := nullif(btrim(coalesce(p_operacion, '')), '');
begin
  perform public.exigir_permiso('tesoreria.caja');
  if p_id is null then
    raise exception 'Vuelve a abrir el formulario del movimiento.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.movimientos_caja where id = p_id) then return p_id; end if;
  if v_tipo not in ('INGRESO', 'EGRESO') then
    raise exception 'Elige si es un ingreso o un egreso.' using errcode = 'check_violation';
  end if;
  if p_monto is null or p_monto <= 0 or p_monto > 999999999 or p_monto <> round(p_monto, 2) then
    raise exception 'El monto va mayor que cero, con dos decimales como máximo.' using errcode = 'check_violation';
  end if;
  if char_length(v_desc) not between 3 and 300 then
    raise exception 'Describe el movimiento como en el estado de cuenta, de 3 a 300 caracteres: «ITF», «OC-0001-MW Ferretería…».'
      using errcode = 'check_violation';
  end if;
  if v_codigo is not null and char_length(v_codigo) not between 2 and 60 then
    raise exception 'El código interno va de 2 a 60 caracteres.' using errcode = 'check_violation';
  end if;
  if v_op is not null and char_length(v_op) > 60 then
    raise exception 'El número de operación pasa de 60 caracteres.' using errcode = 'check_violation';
  end if;
  if p_tipo_cambio is not null and (p_tipo_cambio <= 0 or p_tipo_cambio >= 100) then
    raise exception 'El tipo de cambio va en soles por dólar, como 3.750.' using errcode = 'check_violation';
  end if;
  v_caja := public.caja_dia_abierto(p_caja_id, p_fecha);
  if not v_caja.activa then
    raise exception 'La cuenta % está desactivada: actívala para registrarle movimientos.', v_caja.nombre using errcode = 'check_violation';
  end if;

  insert into public.movimientos_caja (id, caja_id, fecha, tipo, monto, descripcion, codigo_interno, operacion, tipo_cambio)
  values (p_id, p_caja_id, p_fecha, v_tipo, p_monto, v_desc, v_codigo, v_op, round(p_tipo_cambio, 4));
  return p_id;
end;
$$;
comment on function public.registrar_movimiento_caja(uuid, uuid, date, text, numeric, text, text, text, numeric) is
  'Tesorería registra a mano un ingreso o un egreso de una cuenta, en un día abierto. Exige tesoreria.caja.';
revoke all on function public.registrar_movimiento_caja(uuid, uuid, date, text, numeric, text, text, text, numeric) from public, anon;
grant execute on function public.registrar_movimiento_caja(uuid, uuid, date, text, numeric, text, text, text, numeric) to authenticated;

-- 3. Pasar dinero de una cuenta a otra -----------------------------------------------------------
create or replace function public.registrar_transferencia_caja(
  p_id uuid, p_origen uuid, p_destino uuid, p_fecha date, p_monto numeric, p_monto_destino numeric,
  p_descripcion text, p_operacion text
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_sale    public.cajas%rowtype;
  v_entra   public.cajas%rowtype;
  v_desc    text := nullif(regexp_replace(btrim(coalesce(p_descripcion, '')), '\s+', ' ', 'g'), '');
  v_op      text := nullif(btrim(coalesce(p_operacion, '')), '');
  v_destino numeric;
  v_cambio  numeric;
begin
  perform public.exigir_permiso('tesoreria.caja');
  if p_id is null then
    raise exception 'Vuelve a abrir el formulario de la transferencia.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.movimientos_caja where origen = 'TRANSFERENCIA' and origen_id = p_id) then return p_id; end if;
  if p_origen is null or p_destino is null or p_origen = p_destino then
    raise exception 'Elige la cuenta de la que sale y otra a la que entra.' using errcode = 'check_violation';
  end if;
  if p_monto is null or p_monto <= 0 or p_monto > 999999999 or p_monto <> round(p_monto, 2) then
    raise exception 'El monto va mayor que cero, con dos decimales como máximo.' using errcode = 'check_violation';
  end if;
  if v_desc is not null and char_length(v_desc) not between 3 and 300 then
    raise exception 'La descripción va de 3 a 300 caracteres.' using errcode = 'check_violation';
  end if;
  if v_op is not null and char_length(v_op) > 60 then
    raise exception 'El número de operación pasa de 60 caracteres.' using errcode = 'check_violation';
  end if;
  -- Las dos cuentas se bloquean siempre en el mismo orden.
  if p_origen < p_destino then
    v_sale := public.caja_dia_abierto(p_origen, p_fecha);
    v_entra := public.caja_dia_abierto(p_destino, p_fecha);
  else
    v_entra := public.caja_dia_abierto(p_destino, p_fecha);
    v_sale := public.caja_dia_abierto(p_origen, p_fecha);
  end if;
  if not v_sale.activa or not v_entra.activa then
    raise exception 'La cuenta % está desactivada: actívala para registrarle movimientos.',
      case when not v_sale.activa then v_sale.nombre else v_entra.nombre end using errcode = 'check_violation';
  end if;

  if v_sale.moneda = v_entra.moneda then
    v_destino := p_monto;
  else
    if p_monto_destino is null or p_monto_destino <= 0 or p_monto_destino > 999999999
       or p_monto_destino <> round(p_monto_destino, 2) then
      raise exception 'Escribe cuánto entró a %, en %, como dice el voucher.', v_entra.nombre,
        case when v_entra.moneda = 'USD' then 'dólares' else 'soles' end using errcode = 'check_violation';
    end if;
    v_destino := p_monto_destino;
    v_cambio := round(case when v_sale.moneda = 'PEN' then p_monto / p_monto_destino else p_monto_destino / p_monto end, 4);
    -- Un dólar fuera de S/ 2 a S/ 6 es un monto mal escrito, no un cambio.
    if v_cambio not between 2 and 6 then
      raise exception 'Con esos montos el dólar sale a S/ %: revisa cuánto salió y cuánto entró.', v_cambio
        using errcode = 'check_violation';
    end if;
  end if;
  v_desc := coalesce(v_desc, 'Transferencia entre cuentas');

  insert into public.movimientos_caja (caja_id, fecha, tipo, monto, descripcion, operacion, tipo_cambio, origen, origen_id)
  values (p_origen, p_fecha, 'EGRESO', p_monto, v_desc, v_op, v_cambio, 'TRANSFERENCIA', p_id),
         (p_destino, p_fecha, 'INGRESO', v_destino, v_desc, v_op, v_cambio, 'TRANSFERENCIA', p_id);
  return p_id;
end;
$$;
comment on function public.registrar_transferencia_caja(uuid, uuid, uuid, date, numeric, numeric, text, text) is
  'Tesorería pasa dinero de una cuenta a otra el mismo día: un egreso y un ingreso con el mismo origen_id. Exige tesoreria.caja.';
revoke all on function public.registrar_transferencia_caja(uuid, uuid, uuid, date, numeric, numeric, text, text) from public, anon;
grant execute on function public.registrar_transferencia_caja(uuid, uuid, uuid, date, numeric, numeric, text, text) to authenticated;

-- 4. Cerrar el día contra el estado de cuenta ---------------------------------------------------------
create or replace function public.cerrar_dia_caja(
  p_id uuid, p_caja_id uuid, p_fecha date, p_saldo_banco numeric, p_observaciones text
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_caja      public.cajas%rowtype;
  v_obs       text := nullif(regexp_replace(btrim(coalesce(p_observaciones, '')), '\s+', ' ', 'g'), '');
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
  if exists (select 1 from public.cierres_caja where id = p_id) then return p_id; end if;
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

  insert into public.cierres_caja (id, caja_id, fecha, saldo_inicial, ingresos, egresos, saldo_final, saldo_banco, observaciones)
  values (p_id, p_caja_id, p_fecha, v_inicial, v_ingresos, v_egresos, v_final, p_saldo_banco, v_obs);
  return p_id;
end;
$$;
comment on function public.cerrar_dia_caja(uuid, uuid, date, numeric, text) is
  'Tesorería cierra el día de una cuenta con el saldo de su estado de cuenta; desde ahí ese día no cambia. Exige tesoreria.caja.';
revoke all on function public.cerrar_dia_caja(uuid, uuid, date, numeric, text) from public, anon;
grant execute on function public.cerrar_dia_caja(uuid, uuid, date, numeric, text) to authenticated;

-- 5. La caja de un día: cada banco con los soles antes que los dólares -------------------------------
create or replace function public.caja_del_dia(p_fecha date)
returns table (
  caja_id uuid, nombre text, tipo text, banco text, moneda text, activa boolean, fecha_inicio date, saldo_alta numeric,
  saldo_inicial numeric, ingresos numeric, egresos numeric, saldo_final numeric, movimientos integer,
  cierre_id uuid, saldo_banco numeric, diferencia numeric, observaciones text, cerrado_en timestamptz, cerrado_por text,
  ultimo_cierre date, primer_dia_sin_cerrar date, con_movimientos boolean
) language sql stable set search_path to 'public' as $$
  select c.id, c.nombre, c.tipo, c.banco, c.moneda, c.activa, c.fecha_inicio, c.saldo_inicial,
         case when p_fecha >= c.fecha_inicio then c.saldo_inicial + s.antes end,
         s.ingresos, s.egresos,
         case when p_fecha >= c.fecha_inicio then c.saldo_inicial + s.antes + s.ingresos - s.egresos end,
         s.cuantos,
         k.id, k.saldo_banco, k.diferencia, k.observaciones, k.creado_en, public.puesto_de(k.cerrado_por),
         uc.ultimo, sc.primero,
         -- Con algo registrado, aunque esté anulado, el saldo inicial ya no cambia (`guardar_caja`).
         exists (select 1 from public.movimientos_caja x where x.caja_id = c.id)
           or exists (select 1 from public.cierres_caja x where x.caja_id = c.id)
    from public.cajas c
    cross join lateral (
      select coalesce(sum(case when m.tipo = 'INGRESO' then m.monto else -m.monto end) filter (where m.fecha < p_fecha), 0) as antes,
             coalesce(sum(m.monto) filter (where m.fecha = p_fecha and m.tipo = 'INGRESO'), 0) as ingresos,
             coalesce(sum(m.monto) filter (where m.fecha = p_fecha and m.tipo = 'EGRESO'), 0) as egresos,
             (count(*) filter (where m.fecha = p_fecha))::integer as cuantos
        from public.movimientos_caja m
       where m.caja_id = c.id and m.anulado_en is null and m.fecha <= p_fecha
    ) s
    left join public.cierres_caja k on k.caja_id = c.id and k.fecha = p_fecha and k.anulado_en is null
    cross join lateral (
      select max(x.fecha) as ultimo from public.cierres_caja x where x.caja_id = c.id and x.anulado_en is null
    ) uc
    cross join lateral (
      select min(m.fecha) as primero from public.movimientos_caja m
       where m.caja_id = c.id and m.anulado_en is null and (uc.ultimo is null or m.fecha > uc.ultimo)
    ) sc
   order by c.activa desc, c.tipo, c.banco nulls last, c.moneda = 'USD', c.nombre;
$$;
comment on function public.caja_del_dia(date) is
  'La caja de un día, cuenta por cuenta: saldo al empezar, ingresos, egresos, saldo al terminar, su cierre, el primer día sin cerrar y si ya tiene algo registrado. Lee con el RLS de quien llama (tesoreria.caja).';
revoke all on function public.caja_del_dia(date) from public, anon;
grant execute on function public.caja_del_dia(date) to authenticated;
