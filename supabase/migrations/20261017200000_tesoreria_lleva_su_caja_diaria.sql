-- =============================================================================
-- TESORERÍA LLEVA SU CAJA DIARIA
-- -----------------------------------------------------------------------------
-- Gerencia lo pidió el 2026-10-16: la caja diaria de Tesorería «según lo de
-- acá», el libro ESTADO DE CAJA DIARIA que hoy se lleva en Excel con una hoja
-- por día. Cada hoja tiene, por cada cuenta (cada banco, en soles y en
-- dólares), el saldo inicial, lo que salió y lo que entró en el día con su
-- descripción (la OC o la OS que se pagó, la planilla, la caja chica, el ITF,
-- la comisión de mantenimiento, un retiro), el saldo final y la COMPROBACIÓN:
-- el saldo que dice el estado de cuenta del banco, con su diferencia. Abajo
-- va el consolidado de todas las cuentas.
--
-- Aquí entra eso:
--   * `cajas`: cada cuenta de Tesorería —un banco en una moneda, o la caja
--     chica en efectivo— con el saldo con el que empieza en el sistema.
--   * `movimientos_caja`: cada ingreso y cada egreso del día. Hoy los registra
--     Tesorería a mano, porque hay ingresos y egresos que no pasan por el
--     sistema. Cada uno guarda de dónde viene (`origen`, `origen_id`): cuando
--     se conecten los pagos de personal, de las OC y de las OS, cada pago
--     dejará su egreso una sola vez y descontará el saldo sin que nadie lo
--     copie. Por eso la lista de orígenes ya los nombra.
--   * `cierres_caja`: el cierre del día de cada cuenta contra el estado de
--     cuenta. Un día cerrado ya no cambia: lo que faltó se registra en un día
--     abierto, como en el Excel, donde la hoja de ayer no se toca.
--
-- Nada se borra. Un movimiento mal registrado se anula con su motivo, y un
-- cierre se reabre con su motivo, solo el último de cada cuenta.
--
-- Las tablas se escriben solo por las funciones de abajo y las lee quien
-- lleva la caja (`tesoreria.caja`, Tesorería): los saldos de los bancos no son
-- un dato de todos.
--
-- Ninguna llave hacia `usuarios` lleva índice: ni (a) ni (b) ni (c), la
-- aplicación no filtra por quién registró y una cuenta de usuario no se borra.
-- =============================================================================

-- 1. El permiso ----------------------------------------------------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('tesoreria.caja', 'Tesorería',
   'Llevar la caja diaria: las cuentas, sus ingresos y egresos, y el cierre de cada día')
on conflict (codigo) do nothing;

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, 'tesoreria.caja' from public.roles r where r.codigo = 'TESORERIA'
on conflict do nothing;

-- 2. Las cuentas ---------------------------------------------------------------------
-- El saldo inicial es el saldo con el que empieza el día `fecha_inicio`, antes
-- de sus movimientos: el «SALDO INICIAL» de la hoja de ese día.
create table if not exists public.cajas (
  id              uuid primary key default gen_random_uuid(),
  nombre          text not null,
  tipo            text not null,
  banco           text,
  moneda          text not null,
  saldo_inicial   numeric(14, 2) not null,
  fecha_inicio    date not null,
  activa          boolean not null default true,
  creado_por      uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  constraint ck_caja_datos check (
    char_length(btrim(nombre)) between 2 and 60
    and tipo in ('BANCO', 'EFECTIVO')
    and (tipo <> 'BANCO' or char_length(btrim(coalesce(banco, ''))) between 2 and 40)
    and (tipo <> 'EFECTIVO' or banco is null)
    and moneda in ('PEN', 'USD')
    and saldo_inicial between -999999999 and 999999999)
);
comment on table public.cajas is
  'Las cuentas de Tesorería (un banco en una moneda, o la caja chica en efectivo) con el saldo con el que empiezan. No se borran: se desactivan.';
comment on column public.cajas.saldo_inicial is
  'El saldo al empezar el día fecha_inicio, antes de sus movimientos. No cambia cuando la cuenta ya tiene movimientos: lo que estuvo mal se ajusta con un movimiento.';
-- Dos cuentas con el mismo nombre no se distinguirían en la caja.
create unique index if not exists uq_cajas_nombre on public.cajas (lower(btrim(nombre)));
select public.activar_timestamps('cajas');
select public.activar_auditoria('cajas');
select public.activar_registro_de_prueba('cajas');

-- 3. Los movimientos -----------------------------------------------------------------
-- `origen` dice de dónde viene: MANUAL lo escribió Tesorería; TRANSFERENCIA es
-- una de las dos patas de un paso de una cuenta a otra (las dos con el mismo
-- `origen_id`); los demás son el pago o el cobro que lo dejará cuando se
-- conecten: PAGO_ADQUISICION (`pagos_adquisicion`, la factura de compra de las
-- OC), PAGO_ORDEN_SERVICIO (`pagos_orden_servicio`), PAGO_RECIBO_HONORARIOS
-- (`pagos_recibo_honorarios`), PAGO_PLANILLA_DIARIA (`planilla_diaria_pagos`)
-- y COBRO_FACTURA_VENTA (`cobros_factura_venta`).
create table if not exists public.movimientos_caja (
  id                uuid primary key default gen_random_uuid(),
  caja_id           uuid not null references public.cajas(id) on delete restrict,
  fecha             date not null,
  tipo              text not null,
  monto             numeric(14, 2) not null,
  descripcion       text not null,
  codigo_interno    text,
  operacion         text,
  -- Soles por dólar, cuando el movimiento se pactó en la otra moneda.
  tipo_cambio       numeric(7, 4),
  origen            text not null default 'MANUAL',
  origen_id         uuid,
  registrado_por    uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  anulado_por       uuid references public.usuarios(id) on delete restrict,
  anulado_en        timestamptz,
  motivo_anulacion  text,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),
  constraint ck_movimiento_caja_datos check (
    tipo in ('INGRESO', 'EGRESO')
    and monto > 0 and monto <= 999999999
    and char_length(btrim(descripcion)) between 3 and 300
    and (codigo_interno is null or char_length(codigo_interno) between 2 and 60)
    and (operacion is null or char_length(btrim(operacion)) between 1 and 60)
    and (tipo_cambio is null or (tipo_cambio > 0 and tipo_cambio < 100))),
  constraint ck_movimiento_caja_origen check (
    origen in ('MANUAL', 'TRANSFERENCIA', 'PAGO_ADQUISICION', 'PAGO_ORDEN_SERVICIO',
               'PAGO_RECIBO_HONORARIOS', 'PAGO_PLANILLA_DIARIA', 'COBRO_FACTURA_VENTA')
    and ((origen = 'MANUAL') = (origen_id is null))),
  constraint ck_movimiento_caja_anulado check (
    anulado_en is null
    or (anulado_por is not null and char_length(btrim(coalesce(motivo_anulacion, ''))) between 10 and 500))
);
comment on table public.movimientos_caja is
  'Cada ingreso y egreso de una cuenta de Tesorería, con el día en que pasó y de dónde viene. No se borra: se anula. Un día cerrado ya no recibe ni pierde movimientos.';
comment on column public.movimientos_caja.origen is
  'MANUAL (lo escribió Tesorería), TRANSFERENCIA (una pata de un paso entre cuentas) o el pago o cobro del sistema que lo dejó, nombrado por origen_id.';
-- La caja lee cada cuenta día por día y suma lo anterior (b); sirve también a la llave.
create index if not exists ix_movimientos_caja_dia on public.movimientos_caja (caja_id, fecha);
-- Un pago o un cobro deja un solo movimiento vigente; una transferencia, uno de cada tipo.
create unique index if not exists uq_movimiento_caja_origen
  on public.movimientos_caja (origen, origen_id, tipo) where origen_id is not null and anulado_en is null;
select public.activar_timestamps('movimientos_caja');
select public.activar_auditoria('movimientos_caja');
select public.activar_registro_de_prueba('movimientos_caja');

-- 4. El cierre de cada día -------------------------------------------------------------
-- Guarda lo que la caja decía al cerrar —ya no puede cambiar— y lo que dice el
-- estado de cuenta (o el conteo, en la caja chica): la COMPROBACIÓN del Excel.
create table if not exists public.cierres_caja (
  id                uuid primary key default gen_random_uuid(),
  caja_id           uuid not null references public.cajas(id) on delete restrict,
  fecha             date not null,
  saldo_inicial     numeric(14, 2) not null,
  ingresos          numeric(14, 2) not null,
  egresos           numeric(14, 2) not null,
  saldo_final       numeric(14, 2) not null,
  saldo_banco       numeric(14, 2) not null,
  diferencia        numeric(14, 2) generated always as (saldo_banco - saldo_final) stored,
  observaciones     text,
  cerrado_por       uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  anulado_por       uuid references public.usuarios(id) on delete restrict,
  anulado_en        timestamptz,
  motivo_anulacion  text,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),
  constraint ck_cierre_caja_datos check (
    ingresos >= 0 and egresos >= 0
    and saldo_final = saldo_inicial + ingresos - egresos
    and saldo_banco between -999999999 and 999999999
    and char_length(coalesce(observaciones, '')) <= 500),
  constraint ck_cierre_caja_anulado check (
    anulado_en is null
    or (anulado_por is not null and char_length(btrim(coalesce(motivo_anulacion, ''))) between 10 and 500))
);
comment on table public.cierres_caja is
  'El cierre del día de una cuenta de Tesorería contra su estado de cuenta. Un día cerrado ya no cambia. No se borra: se reabre con su motivo, solo el último de cada cuenta.';
-- La caja busca el cierre de cada cuenta en un día y el último de cada una (b);
-- sirve también a la llave, que no puede vivir de un índice parcial (check 190).
create index if not exists ix_cierres_caja_cuenta on public.cierres_caja (caja_id, fecha);
-- Un día se cierra una vez mientras el cierre siga vigente. Empieza por el día
-- para no pasar por índice de la llave sin poder servirle.
create unique index if not exists uq_cierre_caja_vigente
  on public.cierres_caja (fecha, caja_id) where anulado_en is null;
select public.activar_timestamps('cierres_caja');
select public.activar_auditoria('cierres_caja');
select public.activar_registro_de_prueba('cierres_caja');

-- 5. Lo que no se borra ni se corrige por debajo ------------------------------------------
create or replace function public.fn_caja_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  raise exception 'Una cuenta de Tesorería no se borra: se desactiva.' using errcode = 'check_violation';
end;
$$;
revoke all on function public.fn_caja_guardia() from public, anon, authenticated;
create or replace trigger trg_caja_guardia
  before delete on public.cajas
  for each row execute function public.fn_caja_guardia();

-- De un movimiento o de un cierre solo cambia su anulación.
create or replace function public.fn_caja_registro_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
declare
  -- La diferencia del cierre es calculada: en un disparador BEFORE todavía no
  -- tiene su valor nuevo, y sale de columnas que sí se comparan.
  v_cambian constant text[] := array['anulado_por', 'anulado_en', 'motivo_anulacion', 'actualizado_en', 'diferencia'];
begin
  if tg_op = 'DELETE' then
    raise exception 'Un movimiento de caja y un cierre no se borran: se anulan con su motivo.' using errcode = 'check_violation';
  end if;
  if old.anulado_en is not null then
    raise exception 'Eso está anulado: queda como evidencia.' using errcode = 'check_violation';
  end if;
  if (to_jsonb(new) - v_cambian) is distinct from (to_jsonb(old) - v_cambian) then
    raise exception 'Un movimiento o un cierre no se corrige: anúlalo con su motivo y regístralo de nuevo.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_caja_registro_guardia() from public, anon, authenticated;
create or replace trigger trg_movimiento_caja_guardia
  before update or delete on public.movimientos_caja
  for each row execute function public.fn_caja_registro_guardia();
create or replace trigger trg_cierre_caja_guardia
  before update or delete on public.cierres_caja
  for each row execute function public.fn_caja_registro_guardia();

-- 6. Quién ve la caja -------------------------------------------------------------------
alter table public.cajas enable row level security;
alter table public.movimientos_caja enable row level security;
alter table public.cierres_caja enable row level security;
drop policy if exists ver_cajas on public.cajas;
create policy ver_cajas on public.cajas for select to authenticated
  using ((select public.es_admin() or public.tiene_permiso('tesoreria.caja')));
drop policy if exists ver_movimientos_caja on public.movimientos_caja;
create policy ver_movimientos_caja on public.movimientos_caja for select to authenticated
  using ((select public.es_admin() or public.tiene_permiso('tesoreria.caja')));
drop policy if exists ver_cierres_caja on public.cierres_caja;
create policy ver_cierres_caja on public.cierres_caja for select to authenticated
  using ((select public.es_admin() or public.tiene_permiso('tesoreria.caja')));
-- Se escriben solo por las funciones de abajo.
revoke all on public.cajas from public, anon, authenticated;
revoke all on public.movimientos_caja from public, anon, authenticated;
revoke all on public.cierres_caja from public, anon, authenticated;
grant select on public.cajas to authenticated;
grant select on public.movimientos_caja to authenticated;
grant select on public.cierres_caja to authenticated;

-- 7. Ayudantes ----------------------------------------------------------------------------
create or replace function public.caja_texto_fecha(p_fecha date)
returns text language sql immutable set search_path to 'public' as $$
  select to_char(p_fecha, 'DD/MM/YYYY');
$$;
revoke all on function public.caja_texto_fecha(date) from public, anon, authenticated;

create or replace function public.caja_texto_monto(p_monto numeric, p_moneda text)
returns text language sql immutable set search_path to 'public' as $$
  select case when p_moneda = 'USD' then 'US$ ' else 'S/ ' end || to_char(p_monto, 'FM999,999,999,990.00');
$$;
revoke all on function public.caja_texto_monto(numeric, text) from public, anon, authenticated;

-- La cuenta, bloqueada para que nadie cierre el día mientras se le mueve, y la
-- comprobación de que el día está abierto: desde que empieza la cuenta, hasta
-- hoy y después de su último cierre.
create or replace function public.caja_dia_abierto(p_caja uuid, p_fecha date)
returns public.cajas language plpgsql set search_path to 'public' as $$
declare
  v_caja    public.cajas%rowtype;
  v_hoy     date := (now() at time zone 'America/Lima')::date;
  v_cierre  date;
begin
  select * into v_caja from public.cajas where id = p_caja for update;
  if not found then
    raise exception 'Esa cuenta no existe: vuelve a cargar la caja.' using errcode = 'check_violation';
  end if;
  if p_fecha is null or p_fecha > v_hoy then
    raise exception 'Elige el día: hasta hoy.' using errcode = 'check_violation';
  end if;
  if p_fecha < v_caja.fecha_inicio then
    raise exception 'La cuenta % empieza el %: no lleva movimientos antes.', v_caja.nombre, public.caja_texto_fecha(v_caja.fecha_inicio)
      using errcode = 'check_violation';
  end if;
  select max(fecha) into v_cierre from public.cierres_caja where caja_id = p_caja and anulado_en is null;
  if v_cierre is not null and p_fecha <= v_cierre then
    raise exception 'La cuenta % está cerrada hasta el %: lo que faltó va en un día abierto, o reabre ese cierre.',
      v_caja.nombre, public.caja_texto_fecha(v_cierre) using errcode = 'check_violation';
  end if;
  return v_caja;
end;
$$;
revoke all on function public.caja_dia_abierto(uuid, date) from public, anon, authenticated;

-- El saldo de una cuenta al empezar un día: su saldo inicial más lo vigente de antes.
create or replace function public.caja_saldo_al_empezar(p_caja uuid, p_fecha date)
returns numeric language sql stable set search_path to 'public' as $$
  select c.saldo_inicial + coalesce((
           select sum(case when m.tipo = 'INGRESO' then m.monto else -m.monto end)
             from public.movimientos_caja m
            where m.caja_id = c.id and m.anulado_en is null and m.fecha < p_fecha), 0)
    from public.cajas c
   where c.id = p_caja;
$$;
revoke all on function public.caja_saldo_al_empezar(uuid, date) from public, anon, authenticated;

-- 8. Dar de alta, corregir y desactivar una cuenta ---------------------------------------------
-- Con un id nuevo la da de alta; con uno que existe, la corrige. La moneda, el
-- tipo, el saldo inicial y su fecha cambian solo mientras la cuenta no tenga
-- movimientos ni cierres.
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
  v_previa  public.cajas%rowtype;
  v_otra    text;
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

  select nombre into v_otra from public.cajas where lower(btrim(nombre)) = lower(v_nombre) and id <> p_id;
  if found then
    raise exception 'Ya hay una cuenta que se llama %.', v_otra using errcode = 'unique_violation';
  end if;

  select * into v_previa from public.cajas where id = p_id for update;
  if found then
    if row(v_tipo, v_moneda, p_saldo_inicial, p_fecha_inicio)
       is distinct from row(v_previa.tipo, v_previa.moneda, v_previa.saldo_inicial, v_previa.fecha_inicio)
       and (exists (select 1 from public.movimientos_caja where caja_id = p_id)
            or exists (select 1 from public.cierres_caja where caja_id = p_id)) then
      raise exception 'La cuenta % ya tiene movimientos: su tipo, su moneda, su saldo inicial y su fecha no cambian. Si el saldo estaba mal, registra un ingreso o egreso de ajuste.',
        v_previa.nombre using errcode = 'check_violation';
    end if;
    update public.cajas
       set nombre = v_nombre, tipo = v_tipo, banco = v_banco, moneda = v_moneda,
           saldo_inicial = p_saldo_inicial, fecha_inicio = p_fecha_inicio, activa = coalesce(p_activa, true)
     where id = p_id;
  else
    insert into public.cajas (id, nombre, tipo, banco, moneda, saldo_inicial, fecha_inicio, activa)
    values (p_id, v_nombre, v_tipo, v_banco, v_moneda, p_saldo_inicial, p_fecha_inicio, coalesce(p_activa, true));
  end if;
  return p_id;
end;
$$;
comment on function public.guardar_caja(uuid, text, text, text, text, numeric, date, boolean) is
  'Tesorería da de alta o corrige una cuenta de la caja (banco o efectivo, moneda, saldo inicial y su día), o la desactiva. Exige tesoreria.caja.';
revoke all on function public.guardar_caja(uuid, text, text, text, text, numeric, date, boolean) from public, anon;
grant execute on function public.guardar_caja(uuid, text, text, text, text, numeric, date, boolean) to authenticated;

-- 9. Registrar un ingreso o un egreso ------------------------------------------------------------
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
    raise exception 'El tipo de cambio va en soles por dólar, como 3.745.' using errcode = 'check_violation';
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

-- 10. Pasar dinero de una cuenta a otra -----------------------------------------------------------
-- La reposición de la caja chica, el paso de un banco a otro o la compra de
-- dólares: un egreso en una y un ingreso en la otra, el mismo día, con el
-- mismo `origen_id`. Entre monedas distintas se escribe lo que salió y lo que
-- entró, como dice el voucher, y la base saca el cambio.
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
    if v_cambio not between 1 and 10 then
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

-- 11. Anular un movimiento mal registrado ------------------------------------------------------------
-- Solo en un día abierto. Una transferencia se anula entera, con sus dos
-- patas. Lo que dejó un pago o un cobro del sistema se anula anulando ese pago.
create or replace function public.anular_movimiento_caja(p_id uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_mov   public.movimientos_caja%rowtype;
  v_pata  record;
begin
  perform public.exigir_permiso('tesoreria.caja');
  if char_length(btrim(coalesce(p_motivo, ''))) not between 10 and 500 then
    raise exception 'Cuenta por qué se anula, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_mov from public.movimientos_caja where id = p_id;
  if not found then raise exception 'Ese movimiento no existe.' using errcode = 'check_violation'; end if;
  if v_mov.anulado_en is not null then return p_id; end if;
  if v_mov.origen not in ('MANUAL', 'TRANSFERENCIA') then
    raise exception 'Este movimiento lo dejó un pago o un cobro del sistema: se anula anulando ese pago o ese cobro.'
      using errcode = 'check_violation';
  end if;

  -- Cada cuenta que toca, bloqueada y con su día abierto, siempre en el mismo orden.
  for v_pata in
    select m.caja_id, m.fecha from public.movimientos_caja m
     where m.anulado_en is null
       and (m.id = p_id or (v_mov.origen = 'TRANSFERENCIA' and m.origen = 'TRANSFERENCIA' and m.origen_id = v_mov.origen_id))
     order by m.caja_id
  loop
    perform public.caja_dia_abierto(v_pata.caja_id, v_pata.fecha);
  end loop;

  update public.movimientos_caja
     set anulado_por = public.usuario_actual(), anulado_en = now(), motivo_anulacion = btrim(p_motivo)
   where anulado_en is null
     and (id = p_id or (v_mov.origen = 'TRANSFERENCIA' and origen = 'TRANSFERENCIA' and origen_id = v_mov.origen_id));
  return p_id;
end;
$$;
comment on function public.anular_movimiento_caja(uuid, text) is
  'Tesorería anula con su motivo un movimiento manual o una transferencia entera, en un día abierto. Exige tesoreria.caja.';
revoke all on function public.anular_movimiento_caja(uuid, text) from public, anon;
grant execute on function public.anular_movimiento_caja(uuid, text) to authenticated;

-- 12. Cerrar el día contra el estado de cuenta ---------------------------------------------------------
-- Los días se cierran en orden: si un día anterior tiene movimientos sin
-- cerrar, primero ese. Si el banco no dice lo mismo que la caja, se cuenta por
-- qué en las observaciones.
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

  if p_saldo_banco <> v_final and char_length(coalesce(v_obs, '')) < 10 then
    raise exception 'El estado de cuenta dice % y la caja %: cuenta en las observaciones por qué no cuadra.',
      public.caja_texto_monto(p_saldo_banco, v_caja.moneda), public.caja_texto_monto(v_final, v_caja.moneda)
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

-- 13. Reabrir el último cierre --------------------------------------------------------------------------
create or replace function public.reabrir_dia_caja(p_id uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_cierre  public.cierres_caja%rowtype;
  v_caja    public.cajas%rowtype;
  v_despues date;
begin
  perform public.exigir_permiso('tesoreria.caja');
  if char_length(btrim(coalesce(p_motivo, ''))) not between 10 and 500 then
    raise exception 'Cuenta por qué se reabre, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_cierre from public.cierres_caja where id = p_id;
  if not found then raise exception 'Ese cierre no existe.' using errcode = 'check_violation'; end if;
  if v_cierre.anulado_en is not null then return p_id; end if;
  select * into v_caja from public.cajas where id = v_cierre.caja_id for update;
  select min(fecha) into v_despues from public.cierres_caja
   where caja_id = v_cierre.caja_id and anulado_en is null and fecha > v_cierre.fecha;
  if v_despues is not null then
    raise exception 'Solo se reabre el último cierre de %: primero reabre el del %.', v_caja.nombre, public.caja_texto_fecha(v_despues)
      using errcode = 'check_violation';
  end if;
  update public.cierres_caja
     set anulado_por = public.usuario_actual(), anulado_en = now(), motivo_anulacion = btrim(p_motivo)
   where id = p_id;
  return p_id;
end;
$$;
comment on function public.reabrir_dia_caja(uuid, text) is
  'Tesorería reabre con su motivo el último cierre de una cuenta: el cierre queda anulado como evidencia y el día vuelve a aceptar movimientos. Exige tesoreria.caja.';
revoke all on function public.reabrir_dia_caja(uuid, text) from public, anon;
grant execute on function public.reabrir_dia_caja(uuid, text) to authenticated;

-- 14. La caja de un día -----------------------------------------------------------------------------------
-- Cada cuenta con el saldo con que se dio de alta (`saldo_alta`), su saldo al
-- empezar el día, lo que entró, lo que salió, su saldo al terminar, el cierre de ese día si lo tiene, y el primer día con
-- movimientos que todavía no se cerró. Corre con los permisos de quien llama:
-- sin `tesoreria.caja` no devuelve nada.
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
   order by c.activa desc, c.tipo, c.banco nulls last, c.moneda desc, c.nombre;
$$;
comment on function public.caja_del_dia(date) is
  'La caja de un día, cuenta por cuenta: saldo al empezar, ingresos, egresos, saldo al terminar, su cierre, el primer día sin cerrar y si ya tiene algo registrado. Lee con el RLS de quien llama (tesoreria.caja).';
revoke all on function public.caja_del_dia(date) from public, anon;
grant execute on function public.caja_del_dia(date) to authenticated;

-- Los movimientos de un día, también los anulados, con el puesto que los
-- registró (las cuentas son por puesto, migración 109) y, en una
-- transferencia, la otra cuenta. Corre con los permisos de quien llama.
create or replace function public.movimientos_caja_del_dia(p_fecha date)
returns table (
  id uuid, caja_id uuid, tipo text, monto numeric, descripcion text, codigo_interno text, operacion text,
  tipo_cambio numeric, origen text, origen_id uuid, otra_cuenta text, registrado_por text, creado_en timestamptz,
  anulado_en timestamptz, anulado_por text, motivo_anulacion text
) language sql stable set search_path to 'public' as $$
  select m.id, m.caja_id, m.tipo, m.monto, m.descripcion, m.codigo_interno, m.operacion, m.tipo_cambio,
         m.origen, m.origen_id,
         (select c.nombre from public.movimientos_caja o join public.cajas c on c.id = o.caja_id
           where m.origen = 'TRANSFERENCIA' and o.origen = 'TRANSFERENCIA' and o.origen_id = m.origen_id and o.id <> m.id
           limit 1),
         public.puesto_de(m.registrado_por), m.creado_en, m.anulado_en, public.puesto_de(m.anulado_por), m.motivo_anulacion
    from public.movimientos_caja m
   where m.caja_id in (select c.id from public.cajas c) and m.fecha = p_fecha
   order by m.creado_en, m.id;
$$;
comment on function public.movimientos_caja_del_dia(date) is
  'Los movimientos de un día en todas las cuentas, también los anulados, con el puesto que los registró y la otra cuenta de una transferencia. Lee con el RLS de quien llama (tesoreria.caja).';
revoke all on function public.movimientos_caja_del_dia(date) from public, anon;
grant execute on function public.movimientos_caja_del_dia(date) to authenticated;

-- Los cierres reabiertos de un día: quedan como evidencia, con su motivo.
create or replace function public.cierres_caja_reabiertos(p_fecha date)
returns table (id uuid, caja_id uuid, saldo_final numeric, saldo_banco numeric, cerrado_por text, creado_en timestamptz,
               anulado_por text, anulado_en timestamptz, motivo_anulacion text)
language sql stable set search_path to 'public' as $$
  select k.id, k.caja_id, k.saldo_final, k.saldo_banco, public.puesto_de(k.cerrado_por), k.creado_en,
         public.puesto_de(k.anulado_por), k.anulado_en, k.motivo_anulacion
    from public.cierres_caja k
   where k.caja_id in (select c.id from public.cajas c) and k.fecha = p_fecha and k.anulado_en is not null
   order by k.anulado_en;
$$;
revoke all on function public.cierres_caja_reabiertos(date) from public, anon;
grant execute on function public.cierres_caja_reabiertos(date) to authenticated;

-- 15. Los códigos internos que ya se usan, para elegir sin escribirlos mal ----------------------------------
create or replace function public.caja_codigos_internos()
returns table (codigo text) language plpgsql stable security definer set search_path to 'public' as $$
begin
  perform public.exigir_permiso('tesoreria.caja');
  return query
    select c from (
      select public.normalizar_codigo_interno(r.codigo_interno) as c from public.requerimientos r
      union select public.normalizar_codigo_interno(o.codigo_interno) from public.ordenes_compra_materiales o
      union select public.normalizar_codigo_interno(s.codigo_interno) from public.ordenes_servicio s
      union select public.normalizar_codigo_interno(u.codigo_interno) from public.unidades u
      union select public.normalizar_codigo_interno(v.codigo_interno) from public.registro_vehiculos v
      union select x.codigo_interno from public.subcontratos x
      union select m.codigo_interno from public.movimientos_caja m
    ) z
    where char_length(c) between 2 and 60
    order by c
    limit 500;
end;
$$;
revoke all on function public.caja_codigos_internos() from public, anon;
grant execute on function public.caja_codigos_internos() to authenticated;
