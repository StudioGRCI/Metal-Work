-- =============================================================================
-- LO QUE SE LE PAGA DE VERDAD A LA OFICINA, Y LA FECHA DE INGRESO Y DE BAJA
-- -----------------------------------------------------------------------------
-- El sueldo de la oficina entra al costeo de cada unidad (20261020110000), y
-- salía del costo mensual fijo que RR. HH. pone en la ficha. StudioGRCI lo
-- corrigió el 2026-10-20: «a veces pagan semanal, a otras personas quincenal,
-- no es fija la paga». Y quien entraba o salía a mitad de mes cargaba el mes
-- entero, porque la ficha no decía cuándo entró ni cuándo salió.
--
-- Eligió «Cada pago»:
--
--   * RR. HH. registra cada pago a una persona de la oficina con el tramo que
--     paga (una semana, una quincena, un mes o los días que sean), lo que se le
--     pagó y los aportes de la empresa. No se borra: se anula con motivo.
--   * El sueldo de la oficina de un mes es la parte de cada pago que cae en ese
--     mes, por días: una semana del 28 de octubre al 3 de noviembre deja 4 de 7
--     partes en octubre y 3 en noviembre. Menos, como antes, lo que esa persona
--     cargó en horas a una unidad ese mes, que ya va en la mano de obra.
--   * La ficha lleva la fecha de ingreso y la de baja. Con ellas la pantalla
--     dice a quién de la oficina le faltan días pagados en el mes, y un pago no
--     cae antes del ingreso ni después de la baja.
--
-- Como un pago es un hecho con fecha, un mes pasado ya no cambia porque hoy
-- cambie un sueldo o un área: lo anotado por mes en 20261020110000
-- (oficina_meses_congelados, oficina_mes_personas y sus disparadores) sobra y se
-- retira. En producción esas tablas estaban vacías: ningún mes tenía horas.
-- =============================================================================

-- 1. La fecha de ingreso y la de baja ------------------------------------------
-- Sin valor por defecto: quien ya estaba registrado no tiene fecha conocida, y
-- ponerle la de hoy diría que no trabajó antes.
alter table public.trabajadores add column if not exists fecha_ingreso date;
alter table public.trabajadores add column if not exists fecha_baja date;
comment on column public.trabajadores.fecha_ingreso is
  'El primer día que trabajó. Vacía en quien se registró antes de que la ficha la pidiera.';
comment on column public.trabajadores.fecha_baja is
  'El último día que trabajó, puesto al darlo de baja. Vacía mientras está de alta.';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_trabajador_fechas') then
    alter table public.trabajadores add constraint ck_trabajador_fechas check (
      (fecha_ingreso is null or fecha_ingreso >= date '1990-01-01')
      and (fecha_baja is null or fecha_ingreso is null or fecha_baja >= fecha_ingreso));
  end if;
end $$;

-- Dar de baja deja la fecha (hoy, si nadie dijo otra) y dar de alta la borra:
-- así ninguna baja, venga de donde venga, queda sin fecha.
-- security definer: lee oficina_pagos aunque quien da de baja no la vea.
create or replace function public.fn_trabajador_fecha_baja()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if old.activo and not new.activo then
    new.fecha_baja := coalesce(new.fecha_baja, (now() at time zone 'America/Lima')::date);
    if new.fecha_ingreso is not null and new.fecha_baja < new.fecha_ingreso then
      raise exception 'La baja (%) no puede ser antes del ingreso (%).',
        to_char(new.fecha_baja, 'DD/MM/YYYY'), to_char(new.fecha_ingreso, 'DD/MM/YYYY')
        using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.oficina_pagos p
                where p.trabajador_id = new.id and p.anulado_en is null and p.hasta > new.fecha_baja) then
      raise exception 'Tiene pagos de la oficina después del %: anúlalos primero o pon una baja posterior.',
        to_char(new.fecha_baja, 'DD/MM/YYYY') using errcode = 'check_violation';
    end if;
  elsif not old.activo and new.activo then
    new.fecha_baja := null;
  end if;
  return new;
end;
$$;
revoke all on function public.fn_trabajador_fecha_baja() from public, anon, authenticated;
create or replace trigger trg_trabajador_baja_con_fecha
  before update on public.trabajadores
  for each row when (old.activo is distinct from new.activo)
  execute function public.fn_trabajador_fecha_baja();

-- Las bajas de antes no tienen fecha: se les pone el día en que se registró la
-- baja, que es lo más cercano que guarda la base (actualizado_en).
update public.trabajadores
   set fecha_baja = (actualizado_en at time zone 'America/Lima')::date
 where not activo and fecha_baja is null
   and (fecha_ingreso is null or (actualizado_en at time zone 'America/Lima')::date >= fecha_ingreso);

create or replace function public.rrhh_guardar_ingreso_trabajador(p_trabajador_id uuid, p_fecha date)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_hoy  date := (now() at time zone 'America/Lima')::date;
  v_baja date;
  v_antes date;
  v      int;
begin
  perform public.exigir_permiso('rrhh.personal');
  if p_fecha is null then
    raise exception 'Pon la fecha de ingreso: el primer día que trabajó.' using errcode = 'check_violation';
  end if;
  if p_fecha < date '1990-01-01' or p_fecha > v_hoy + 31 then
    raise exception 'La fecha de ingreso va desde 1990 hasta un mes adelante (%).', to_char(v_hoy + 31, 'DD/MM/YYYY')
      using errcode = 'check_violation';
  end if;
  -- Bloquear la ficha: un pago que entra a la vez no queda antes del ingreso.
  select fecha_baja into v_baja from public.trabajadores where id = p_trabajador_id for update;
  if v_baja is not null and p_fecha > v_baja then
    raise exception 'El ingreso no puede ser después de la baja (%).', to_char(v_baja, 'DD/MM/YYYY')
      using errcode = 'check_violation';
  end if;
  -- Quien volvió a entrar: el ingreso de ahora va después de la baja anterior.
  select max(q.baja) into v_antes from public.trabajador_periodos q where q.trabajador_id = p_trabajador_id;
  if v_antes is not null and p_fecha <= v_antes then
    raise exception 'Ya trabajó antes hasta el %: el ingreso de ahora va después.', to_char(v_antes, 'DD/MM/YYYY')
      using errcode = 'check_violation';
  end if;
  -- Los pagos de un periodo anterior (antes de volver a entrar) no cuentan aquí.
  if exists (select 1 from public.oficina_pagos p
              where p.trabajador_id = p_trabajador_id and p.anulado_en is null and p.desde < p_fecha
                and not exists (select 1 from public.trabajador_periodos q
                                 where q.trabajador_id = p.trabajador_id
                                   and (q.ingreso is null or p.desde >= q.ingreso) and p.hasta <= q.baja)) then
    raise exception 'Tiene pagos de la oficina antes del %: anúlalos primero o pon una fecha de ingreso anterior.',
      to_char(p_fecha, 'DD/MM/YYYY') using errcode = 'check_violation';
  end if;
  update public.trabajadores set fecha_ingreso = p_fecha where id = p_trabajador_id;
  get diagnostics v = row_count;
  if v = 0 then raise exception 'La persona no existe.'; end if;
  return p_trabajador_id;
end;
$$;
comment on function public.rrhh_guardar_ingreso_trabajador(uuid, date) is
  'RR. HH. pone el primer día que trabajó la persona. Ningún pago de la oficina puede empezar antes.';
revoke all on function public.rrhh_guardar_ingreso_trabajador(uuid, date) from public, anon;
grant execute on function public.rrhh_guardar_ingreso_trabajador(uuid, date) to authenticated;

create or replace function public.rrhh_dar_de_baja_trabajador(p_trabajador_id uuid, p_fecha date)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_hoy     date := (now() at time zone 'America/Lima')::date;
  v_activo  boolean;
  v_ingreso date;
  v         int;
begin
  perform public.exigir_permiso('rrhh.personal');
  select activo, fecha_ingreso into v_activo, v_ingreso from public.trabajadores where id = p_trabajador_id for update;
  if not found then raise exception 'La persona no existe.'; end if;
  if not v_activo then
    raise exception 'Ya está de baja.' using errcode = 'check_violation';
  end if;
  if p_fecha is null then
    raise exception 'Pon la fecha de baja: el último día que trabajó.' using errcode = 'check_violation';
  end if;
  if p_fecha > v_hoy then
    raise exception 'La baja es el último día que trabajó: no puede ser después de hoy.' using errcode = 'check_violation';
  end if;
  if v_ingreso is not null and p_fecha < v_ingreso then
    raise exception 'La baja no puede ser antes del ingreso (%).', to_char(v_ingreso, 'DD/MM/YYYY')
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.oficina_pagos p
              where p.trabajador_id = p_trabajador_id and p.anulado_en is null and p.hasta > p_fecha) then
    raise exception 'Tiene pagos de la oficina después del %: anúlalos primero o pon una baja posterior.',
      to_char(p_fecha, 'DD/MM/YYYY') using errcode = 'check_violation';
  end if;
  update public.trabajadores set activo = false, fecha_baja = p_fecha where id = p_trabajador_id and activo;
  get diagnostics v = row_count;
  if v = 0 then raise exception 'Ya está de baja.'; end if;
  return p_trabajador_id;
end;
$$;
comment on function public.rrhh_dar_de_baja_trabajador(uuid, date) is
  'RR. HH. da de baja a la persona con el último día que trabajó. El portero deja de marcarle desde ya.';
revoke all on function public.rrhh_dar_de_baja_trabajador(uuid, date) from public, anon;
grant execute on function public.rrhh_dar_de_baja_trabajador(uuid, date) to authenticated;

-- 2. Lo anotado por mes ya no hace falta ---------------------------------------
drop trigger if exists trg_costo_nuevo_congela_oficina on public.trabajador_costos;
drop trigger if exists trg_costo_congela_oficina on public.trabajador_costos;
drop trigger if exists trg_trabajador_congela_oficina on public.trabajadores;
drop trigger if exists trg_area_congela_oficina on public.areas;
drop function if exists public.fn_congelar_oficina();
drop function if exists public.congelar_oficina();
drop table if exists public.oficina_mes_personas;
drop table if exists public.oficina_meses_congelados;

-- 3. Los pagos de la oficina ----------------------------------------------------
-- Sin índice aparte por trabajador_id: el de abajo empieza por él; nadie filtra
-- por registrado_por ni anulado_por, y un usuario no se borra.
create table if not exists public.oficina_pagos (
  id                uuid primary key default gen_random_uuid(),
  trabajador_id     uuid not null references public.trabajadores(id) on delete restrict,
  desde             date not null,
  hasta             date not null,
  monto             numeric(12, 2) not null,
  aportes           numeric(12, 2) not null default 0,
  nota              text,
  registrado_por    uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  anulado_por       uuid references public.usuarios(id) on delete restrict,
  anulado_en        timestamptz,
  motivo_anulacion  text,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),
  constraint ck_oficina_pago_tramo check (desde >= date '2020-01-01' and hasta >= desde and hasta - desde <= 61),
  constraint ck_oficina_pago_montos check (monto > 0 and monto <= 100000 and aportes >= 0 and aportes <= 100000),
  constraint ck_oficina_pago_nota check (nota is null or char_length(btrim(nota)) between 2 and 200),
  constraint ck_oficina_pago_anulado check (
    anulado_en is null
    or (anulado_por is not null and char_length(btrim(coalesce(motivo_anulacion, ''))) between 10 and 500))
);
comment on table public.oficina_pagos is
  'Cada pago a una persona de la oficina, con el tramo de días que paga (semana, quincena, mes…). De aquí sale el sueldo de la oficina del costeo. Solo RR. HH. lo lee; no se borra, se anula.';
comment on column public.oficina_pagos.monto is 'Lo que se le pagó por ese tramo: sueldo, asignación, bonos.';
comment on column public.oficina_pagos.aportes is 'Lo que la empresa aporta por ese pago (EsSalud y otros): también es costo.';
-- Se lee por persona y tramo (los cruces) y por mes (el costeo).
create index if not exists ix_oficina_pagos_persona on public.oficina_pagos (trabajador_id, desde) where anulado_en is null;
create index if not exists ix_oficina_pagos_tramo on public.oficina_pagos (desde, hasta) where anulado_en is null;
select public.activar_timestamps('oficina_pagos');
-- Sin activar_auditoria: audit_log lo leen puestos que no deben ver cada pago
-- (Gerencia, con auditoria.ver), y la fila ya guarda quién la registró y quién,
-- cuándo y por qué la anuló, sin admitir otro cambio.
drop trigger if exists trg_auditoria on public.oficina_pagos;
select public.activar_registro_de_prueba('oficina_pagos');

create or replace function public.fn_oficina_pago_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Un pago de la oficina no se borra: se anula, con motivo.' using errcode = 'check_violation';
  end if;
  if old.anulado_en is not null then
    raise exception 'Ese pago ya está anulado: queda como estaba.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_oficina_pago_guardia() from public, anon, authenticated;
create or replace trigger trg_oficina_pago_guardia
  before update or delete on public.oficina_pagos
  for each row execute function public.fn_oficina_pago_guardia();

alter table public.oficina_pagos enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'oficina_pagos' and policyname = 'ver_oficina_pagos') then
    create policy ver_oficina_pagos on public.oficina_pagos for select to authenticated
      using ((select public.es_admin()) or (select public.tiene_permiso('rrhh.personal')));
  end if;
end $$;
revoke all on public.oficina_pagos from public, anon, authenticated;
grant select on public.oficina_pagos to authenticated;

-- Los periodos que una persona ya trabajó y cerró con su baja, cuando vuelve a
-- entrar: el ingreso y la baja de la ficha son los de ahora, y sin esto los meses
-- en que no estuvo saldrían como pagos que faltan, y los pagos de antes quedarían
-- fuera de su ingreso nuevo. Los anota rrhh_dar_de_alta_trabajador; no se cambian.
create table if not exists public.trabajador_periodos (
  id             uuid primary key default gen_random_uuid(),
  trabajador_id  uuid not null references public.trabajadores(id) on delete restrict,
  ingreso        date,
  baja           date not null,
  registrado_por uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint ck_trabajador_periodo check (ingreso is null or baja >= ingreso)
);
comment on table public.trabajador_periodos is
  'Cada periodo que una persona trabajó y cerró con su baja antes de volver a entrar (ingreso vacío: no se sabía). Lo lee RR. HH.; no se cambia ni se borra.';
-- (b) La cuenta de las faltas y la validación de cada pago buscan por persona.
create index if not exists ix_trabajador_periodos on public.trabajador_periodos (trabajador_id, baja);
select public.activar_timestamps('trabajador_periodos');
-- Sin activar_auditoria: la fila no cambia nunca y ya dice quién la anotó y cuándo.
select public.activar_registro_de_prueba('trabajador_periodos');

create or replace function public.fn_trabajador_periodo_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  raise exception 'Un periodo trabajado no se cambia ni se borra.' using errcode = 'check_violation';
end;
$$;
revoke all on function public.fn_trabajador_periodo_guardia() from public, anon, authenticated;
create or replace trigger trg_trabajador_periodo_guardia
  before update or delete on public.trabajador_periodos
  for each row execute function public.fn_trabajador_periodo_guardia();

alter table public.trabajador_periodos enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'trabajador_periodos' and policyname = 'ver_trabajador_periodos') then
    create policy ver_trabajador_periodos on public.trabajador_periodos for select to authenticated
      using ((select public.es_admin()) or (select public.tiene_permiso('rrhh.personal')));
  end if;
end $$;
revoke all on public.trabajador_periodos from public, anon, authenticated;
grant select on public.trabajador_periodos to authenticated;

-- Volver a dar de alta con el día en que vuelve: el periodo anterior queda anotado.
create or replace function public.rrhh_dar_de_alta_trabajador(p_trabajador_id uuid, p_fecha date)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_hoy date := (now() at time zone 'America/Lima')::date;
  v_w   public.trabajadores;
begin
  perform public.exigir_permiso('rrhh.personal');
  select * into v_w from public.trabajadores where id = p_trabajador_id for update;
  if not found then raise exception 'La persona no existe.' using errcode = 'check_violation'; end if;
  if v_w.activo then raise exception 'Ya está de alta.' using errcode = 'check_violation'; end if;
  if p_fecha is null then
    raise exception 'Pon el día en que vuelve a trabajar.' using errcode = 'check_violation';
  end if;
  if p_fecha > v_hoy + 31 then
    raise exception 'El día en que vuelve no puede ir más de un mes adelante.' using errcode = 'check_violation';
  end if;
  if v_w.fecha_baja is not null and p_fecha <= v_w.fecha_baja then
    raise exception 'Dejó de trabajar el %: vuelve después de ese día. Si la baja fue un error, quítala.',
      to_char(v_w.fecha_baja, 'DD/MM/YYYY') using errcode = 'check_violation';
  end if;
  if v_w.fecha_baja is not null then
    insert into public.trabajador_periodos (trabajador_id, ingreso, baja) values (p_trabajador_id, v_w.fecha_ingreso, v_w.fecha_baja);
  end if;
  -- El disparador de la baja la borra al volver de alta.
  update public.trabajadores set activo = true, fecha_ingreso = p_fecha where id = p_trabajador_id;
  return p_trabajador_id;
end;
$$;
comment on function public.rrhh_dar_de_alta_trabajador(uuid, date) is
  'RR. HH. vuelve a dar de alta a quien regresa, con el día en que vuelve: el periodo anterior (ingreso y baja) queda en trabajador_periodos. Exige rrhh.personal.';
revoke all on function public.rrhh_dar_de_alta_trabajador(uuid, date) from public, anon;
grant execute on function public.rrhh_dar_de_alta_trabajador(uuid, date) to authenticated;

create or replace function public.rrhh_registrar_pago_oficina(
  p_id uuid, p_trabajador_id uuid, p_desde date, p_hasta date, p_monto numeric, p_aportes numeric, p_nota text
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_hoy   date := (now() at time zone 'America/Lima')::date;
  v_nota  text := nullif(btrim(coalesce(p_nota, '')), '');
  v_w     public.trabajadores;
  v_ofi   boolean;
  v_previo public.oficina_pagos;
  v_cruce public.oficina_pagos;
begin
  perform public.exigir_permiso('rrhh.personal');
  if p_id is null then
    raise exception 'Vuelve a abrir el formulario del pago.' using errcode = 'check_violation';
  end if;
  -- El reintento del mismo pago devuelve el que ya entró, sin duplicarlo.
  select * into v_previo from public.oficina_pagos where id = p_id;
  if found then
    if v_previo.anulado_en is not null then
      raise exception 'Ese pago ya se anuló: regístralo de nuevo si corresponde.' using errcode = 'check_violation';
    end if;
    return p_id;
  end if;

  -- Bloquear la ficha: dos registros a la vez de la misma persona no se cruzan sin verse.
  select * into v_w from public.trabajadores where id = p_trabajador_id for update;
  if not found then raise exception 'Elige a la persona a quien se le pagó.' using errcode = 'check_violation'; end if;
  -- El mismo envío que llegó dos veces a la vez: el segundo esperó el bloqueo y ya lo encuentra.
  if exists (select 1 from public.oficina_pagos where id = p_id and anulado_en is null) then
    return p_id;
  end if;
  select a.es_oficina into v_ofi from public.areas a where a.id = v_w.area_id;
  if not coalesce(v_ofi, false) then
    raise exception '% % no es de un área de oficina: su costo entra por las horas que carga a cada unidad.',
      v_w.nombres, v_w.apellidos using errcode = 'check_violation';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde then
    raise exception 'Pon desde qué día y hasta qué día paga: el último día no puede ir antes del primero.' using errcode = 'check_violation';
  end if;
  if p_desde < date '2020-01-01' or p_hasta - p_desde > 61 then
    raise exception 'Un pago cubre como mucho dos meses, desde 2020.' using errcode = 'check_violation';
  end if;
  if p_desde > v_hoy + 31 then
    raise exception 'El pago no puede empezar más de un mes adelante.' using errcode = 'check_violation';
  end if;
  -- Dentro del periodo de ahora, o entero dentro de uno anterior (si volvió a entrar).
  if not exists (select 1 from public.trabajador_periodos q
                  where q.trabajador_id = p_trabajador_id and (q.ingreso is null or p_desde >= q.ingreso) and p_hasta <= q.baja) then
    if v_w.fecha_ingreso is not null and p_desde < v_w.fecha_ingreso then
      raise exception '% % entró el %: el pago no puede empezar antes.', v_w.nombres, v_w.apellidos,
        to_char(v_w.fecha_ingreso, 'DD/MM/YYYY') using errcode = 'check_violation';
    end if;
    if v_w.fecha_baja is not null and p_hasta > v_w.fecha_baja then
      raise exception '% % dejó de trabajar el %: el pago no puede pasar de ese día.', v_w.nombres, v_w.apellidos,
        to_char(v_w.fecha_baja, 'DD/MM/YYYY') using errcode = 'check_violation';
    end if;
  end if;
  if p_monto is null or p_monto <= 0 or p_monto > 100000 then
    raise exception 'Escribe lo que se le pagó, en soles, mayor que cero y hasta S/ 100 000.' using errcode = 'check_violation';
  end if;
  if coalesce(p_aportes, 0) < 0 or coalesce(p_aportes, 0) > 100000 then
    raise exception 'Los aportes van en soles, de cero a S/ 100 000.' using errcode = 'check_violation';
  end if;
  if v_nota is not null and char_length(v_nota) not between 2 and 200 then
    raise exception 'La nota va de 2 a 200 caracteres.' using errcode = 'check_violation';
  end if;
  -- Dos pagos del mismo día lo contarían dos veces en el costeo.
  select * into v_cruce from public.oficina_pagos p
   where p.trabajador_id = p_trabajador_id and p.anulado_en is null
     and p.desde <= p_hasta and p.hasta >= p_desde
   order by p.desde limit 1;
  if found then
    raise exception 'Ya hay un pago de % % del % al % que cruza esas fechas: corrige las fechas o anula ese pago.',
      v_w.nombres, v_w.apellidos, to_char(v_cruce.desde, 'DD/MM/YYYY'), to_char(v_cruce.hasta, 'DD/MM/YYYY')
      -- check_violation y no unique_violation: mensajeDeError cambia este último por un texto genérico.
      using errcode = 'check_violation';
  end if;

  insert into public.oficina_pagos (id, trabajador_id, desde, hasta, monto, aportes, nota)
  values (p_id, p_trabajador_id, p_desde, p_hasta, round(p_monto, 2), round(coalesce(p_aportes, 0), 2), v_nota);
  return p_id;
end;
$$;
comment on function public.rrhh_registrar_pago_oficina(uuid, uuid, date, date, numeric, numeric, text) is
  'RR. HH. registra un pago a una persona de la oficina con el tramo de días que paga. Exige rrhh.personal.';
revoke all on function public.rrhh_registrar_pago_oficina(uuid, uuid, date, date, numeric, numeric, text) from public, anon;
grant execute on function public.rrhh_registrar_pago_oficina(uuid, uuid, date, date, numeric, numeric, text) to authenticated;

create or replace function public.rrhh_anular_pago_oficina(p_id uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v int;
begin
  perform public.exigir_permiso('rrhh.personal');
  if char_length(btrim(coalesce(p_motivo, ''))) not between 10 and 500 then
    raise exception 'Escribe por qué se anula (de 10 a 500 caracteres).' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.oficina_pagos where id = p_id and anulado_en is not null) then
    raise exception 'Ese pago ya está anulado.' using errcode = 'check_violation';
  end if;
  update public.oficina_pagos
     set anulado_en = now(), anulado_por = public.usuario_actual(), motivo_anulacion = btrim(p_motivo)
   where id = p_id;
  get diagnostics v = row_count;
  if v = 0 then raise exception 'El pago no existe.'; end if;
  return p_id;
end;
$$;
comment on function public.rrhh_anular_pago_oficina(uuid, text) is
  'RR. HH. anula un pago de la oficina mal registrado, con motivo. Sale del costeo; queda como evidencia.';
revoke all on function public.rrhh_anular_pago_oficina(uuid, text) from public, anon;
grant execute on function public.rrhh_anular_pago_oficina(uuid, text) to authenticated;

-- 4. El sueldo de la oficina, de los pagos ----------------------------------------
-- Una versión anterior de esta migración contaba los días con esta función; ya no se usa.
drop function if exists public.dias_del_mes_entre(date, date, date);

drop function if exists public.gastos_del_mes_oficina(date);
drop function if exists public.sueldos_oficina_del_mes(date);

-- Desde cuándo le faltan pagos a cada persona de la oficina: octubre de 2026, cuando
-- RR. HH. empieza a registrarlos (en producción no hay horas por código antes,
-- consultado el 2026-10-20), o el mes de su primer pago si le registraron uno
-- anterior. Por persona y por mes entero: si fuera el primer pago de todos, una
-- corrección de agosto de una sola persona pondría en falta a toda la oficina, y
-- una primera quincena del 16 borraría la falta del 1 al 15. Cuentan también los
-- anulados: anular el único pago de alguien no puede borrar lo que le falta.
-- sueldos_oficina_del_mes adelanta además el inicio al primer mes con horas por
-- código: RR. HH. puede cargar horas de hasta un año atrás, y ese mes cerraría sin
-- la oficina y sin aviso.
drop function if exists public.rrhh_inicio_registro_pagos_oficina();
drop function if exists public.inicio_registro_pagos_oficina();
create or replace function public.inicio_registro_pagos_oficina(p_trabajador_id uuid)
returns date language sql stable set search_path to 'public' as $$
  select least(date_trunc('month', min(p.desde))::date, date '2026-10-01')
    from public.oficina_pagos p
   where p.trabajador_id = p_trabajador_id
     and not exists (select 1 from public.pruebas_filas f where f.tabla = 'oficina_pagos' and f.fila_id = p.id)
$$;
revoke all on function public.inicio_registro_pagos_oficina(uuid) from public, anon, authenticated;

-- Lo mismo para la pantalla de RR. HH., que no lo recalcula: cada persona con su
-- fecha y los periodos que ya trabajó.
create or replace function public.rrhh_inicio_registro_pagos_oficina()
returns table (trabajador_id uuid, desde date)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  perform public.exigir_permiso('rrhh.personal');
  return query
  select w.id, least(public.inicio_registro_pagos_oficina(w.id), (select min(h.periodo) from public.horas_por_codigo_del_mes(null) h))
    from public.trabajadores w;
end;
$$;
comment on function public.rrhh_inicio_registro_pagos_oficina() is
  'Desde cuándo cuentan los días sin pago de cada persona: inicio_registro_pagos_oficina, o el primer mes con horas por código si es antes. Exige rrhh.personal.';
revoke all on function public.rrhh_inicio_registro_pagos_oficina() from public, anon;
grant execute on function public.rrhh_inicio_registro_pagos_oficina() to authenticated;

-- La parte de cada pago que cae en el mes va por días, redondeada de modo que las
-- partes de un pago sumen el pago al céntimo: lo pagado hasta el fin del mes menos
-- lo pagado hasta el fin del mes anterior. Cada persona, menos lo que ese mes cargó
-- en horas a una unidad. sin_pago: cuántas personas de la oficina tienen en el mes
-- días trabajados que ningún pago cubre todavía. Solo cuenta hasta hoy: un día que
-- no llega no falta, y avisarlo empujaría a registrar un pago que aún no se hizo. Y
-- solo desde inicio_registro_pagos_oficina(persona), y en los días que trabajó.
create or replace function public.sueldos_oficina_del_mes(p_periodo date default null)
returns table (periodo date, personas integer, monto numeric, sin_pago integer)
language sql stable set search_path to 'public' as $$
  with mes as (
    select date_trunc('month', p_periodo)::date as periodo where p_periodo is not null
    union
    select distinct h.periodo from public.horas_por_codigo_del_mes(null) h where p_periodo is null
  ), pago as (
    select m.periodo, p.trabajador_id,
           round((p.monto + p.aportes) * (least(p.hasta, (m.periodo + interval '1 month' - interval '1 day')::date) - p.desde + 1) / (p.hasta - p.desde + 1), 2)
           - round((p.monto + p.aportes) * greatest(0, least(p.hasta, m.periodo - 1) - p.desde + 1) / (p.hasta - p.desde + 1), 2) as parte
      from mes m
      join public.oficina_pagos p on p.anulado_en is null
                                 and p.desde < (m.periodo + interval '1 month')::date and p.hasta >= m.periodo
     where not exists (select 1 from public.pruebas_filas f where f.tabla = 'oficina_pagos' and f.fila_id = p.id)
  ), neto as (
    select g.periodo, g.trabajador_id,
           greatest(sum(g.parte) - coalesce((select sum(t.costo) from public.tareos t
                                               where t.trabajador_id = g.trabajador_id and t.anulado_en is null
                                                 and date_trunc('month', t.fecha)::date = g.periodo
                                                 and public.normalizar_codigo_interno(t.codigo_interno) not in ('PLANTA', 'OFICINA', 'TODOS LOS ACTIVOS')), 0), 0) as monto
      from pago g
     group by g.periodo, g.trabajador_id
  ), horas as (
    -- El primer mes con horas por código: desde ahí también faltan los pagos.
    select min(h.periodo) as desde from public.horas_por_codigo_del_mes(null) h
  ), falta as (
    -- Los días que trabajó en el mes hasta hoy (en el periodo de ahora o en uno
    -- anterior, si volvió a entrar) y que ningún pago cubre.
    select m.periodo, w.id
      from mes m
      cross join horas hh
      join public.trabajadores w on (w.activo or w.fecha_baja is not null)
      join public.areas a on a.id = w.area_id and a.es_oficina
     where not exists (select 1 from public.pruebas_filas f where f.tabla = 'trabajadores' and f.fila_id = w.id)
       and exists (select 1
                     from generate_series(greatest(m.periodo, least(public.inicio_registro_pagos_oficina(w.id), hh.desde)),
                                          least((m.periodo + interval '1 month' - interval '1 day')::date,
                                                (now() at time zone 'America/Lima')::date),
                                          interval '1 day') d(dia)
                    where ((w.fecha_ingreso is null or d.dia::date >= w.fecha_ingreso)
                           and (w.fecha_baja is null or d.dia::date <= w.fecha_baja)
                           or exists (select 1 from public.trabajador_periodos q
                                       where q.trabajador_id = w.id and (q.ingreso is null or d.dia::date >= q.ingreso)
                                         and d.dia::date <= q.baja))
                      and not exists (select 1 from public.oficina_pagos p
                                       where p.trabajador_id = w.id and p.anulado_en is null
                                         and d.dia::date between p.desde and p.hasta
                                         and not exists (select 1 from public.pruebas_filas f
                                                          where f.tabla = 'oficina_pagos' and f.fila_id = p.id)))
  )
  select m.periodo,
         (select count(*) from neto n where n.periodo = m.periodo)::integer,
         coalesce((select round(sum(n.monto), 2) from neto n where n.periodo = m.periodo), 0),
         (select count(*) from falta f where f.periodo = m.periodo)::integer
    from mes m
$$;
comment on function public.sueldos_oficina_del_mes(date) is
  'El sueldo de la oficina de cada mes (o del mes de p_periodo): la parte, por días, de cada pago de oficina_pagos que cae en el mes (con aportes), menos lo que esa persona cargó ese mes en horas a una unidad; y cuántas personas de la oficina tienen días trabajados del mes, desde inicio_registro_pagos_oficina(persona) y hasta hoy, sin pago. No pide permiso: la llaman el costeo y gastos_del_mes_oficina.';
revoke all on function public.sueldos_oficina_del_mes(date) from public, anon, authenticated;

create or replace function public.gastos_del_mes_oficina(p_periodo date)
returns table (monto numeric, sin_pago integer)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  -- El total lo ve quien ve los costos (decisión de DKS, 2026-10-20): el costo de
  -- cada código ya lo lleva dentro y el costeo es el mismo para todo puesto. Con
  -- una o dos personas en la oficina deja adivinar un sueldo; DKS lo sabe.
  -- Cada pago, persona por persona, sigue siendo solo de RR. HH.
  if public.usuario_actual() is not null
     and not (public.es_admin() or public.tiene_permiso('costos.gastos_generales') or public.tiene_permiso('codigos_internos.ver')
              or public.tiene_permiso('costos.ver')) then
    raise exception 'No tiene el permiso costos.ver, costos.gastos_generales ni codigos_internos.ver para realizar esta operación' using errcode = 'insufficient_privilege';
  end if;
  if p_periodo is null then
    return;
  end if;
  return query
  select o.monto, o.sin_pago from public.sueldos_oficina_del_mes(p_periodo) o;
end;
$$;
comment on function public.gastos_del_mes_oficina(date) is
  'El sueldo de la oficina del mes de p_periodo, sumado (de los pagos registrados, sin lo que ya cargaron en horas a una unidad), y a cuántas personas les faltan días pagados. Exige costos.ver, costos.gastos_generales o codigos_internos.ver.';
revoke all on function public.gastos_del_mes_oficina(date) from public, anon;
grant execute on function public.gastos_del_mes_oficina(date) to authenticated;

-- 5. La línea de la oficina en el costeo dice de dónde sale ---------------------------------
-- La misma función de la 20261020110000; solo cambia el texto de la línea de la
-- oficina, que ya no sale del costo mensual sino de los pagos.
create or replace function public.codigo_interno_lineas(p_codigo text, p_mano_obra boolean)
returns table (codigo text, fuente text, fecha date, concepto text, detalle text, cantidad numeric, unidad text,
               horas numeric, precio_unitario numeric, moneda text, monto numeric, sin_precio integer,
               documento text, referencia_id uuid)
language plpgsql stable set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_codigo text := public.normalizar_codigo_interno(p_codigo);
  -- El mes en curso todavía reparte con las horas que van: su parte es provisional.
  v_mes date := date_trunc('month', now() at time zone 'America/Lima')::date;
begin
  return query
  with tareo as (
    select public.normalizar_codigo_interno(t.codigo_interno) as codigo, t.fecha, t.horas, t.costo, t.trabajador_id,
           l.reporte_id, l.trabajo_id, case when l.id is null then t.labor end as labor
      from public.tareos t
      left join public.reporte_diario_personal l on l.id = t.reporte_linea_id
     where p_mano_obra and t.anulado_en is null
  ), espera as (
    -- Una línea de un reporte vigente que no tiene tareo: su persona no tiene costo mensual.
    select public.normalizar_codigo_interno(r.codigo_interno) as codigo, l.fecha, l.horas, l.trabajador_id,
           l.reporte_id, l.trabajo_id, null::text as labor
      from public.reporte_diario_personal l
      join public.reportes_diarios r on r.id = l.reporte_id
     where p_mano_obra and r.anulado_en is null
       and not exists (select 1 from public.tareos t where t.reporte_linea_id = l.id)
  ), horas as (
    select 'MANO_OBRA'::text as fuente, x.codigo, x.fecha, x.horas, x.costo, x.trabajador_id, x.reporte_id, x.trabajo_id, x.labor from tareo x
    union all
    select 'MANO_OBRA_SIN_COSTO', e.codigo, e.fecha, e.horas, null::numeric, e.trabajador_id, e.reporte_id, e.trabajo_id, e.labor from espera e
  ), salida_base as (
    select m.id, m.registrado_en, m.material_id, m.precio_unitario, m.moneda, m.documento_referencia, rq.numero as rq_numero,
           public.normalizar_codigo_interno(coalesce(m.codigo_interno, rq.codigo_interno, u.codigo_interno, uo.codigo_interno,
                                                     case when m.unidad_id is null then m.codigo_unidad end)) as codigo,
           greatest(m.cantidad - coalesce((select sum(x.cantidad) from public.movimientos_materiales x
                                            where x.devolucion_de = m.id), 0), 0)::numeric as cantidad,
           date_trunc('month', m.registrado_en at time zone 'America/Lima')::date as periodo
      from public.movimientos_materiales m
      left join public.requerimiento_lineas rl on rl.id = m.requerimiento_linea_id
      left join public.requerimientos rq on rq.id = rl.requerimiento_id
      left join public.unidades u on u.id = m.unidad_id
      left join public.ordenes_trabajo ot on ot.id = m.orden_id
      left join public.unidades uo on uo.id = ot.unidad_id
     where m.tipo in ('SALIDA', 'DESPACHO')
  ), trabajo as (
    -- Los códigos que trabajaron cada mes: con horas del reporte diario o de
    -- RR. HH., o con una salida del almacén. Es lo que se llama «activo» al
    -- repartir los gastos del mes y lo cargado a TODOS LOS ACTIVOS. Solo dice
    -- qué códigos y qué meses, sin horas ni costos: por eso se arma también
    -- cuando no se pide la mano de obra (el gasto por código de Requerimientos
    -- reparte igual que Gerencia).
    select distinct date_trunc('month', t.fecha)::date as periodo, public.normalizar_codigo_interno(t.codigo_interno) as codigo
      from public.tareos t
     where t.anulado_en is null
    union
    select distinct date_trunc('month', l.fecha)::date, public.normalizar_codigo_interno(r.codigo_interno)
      from public.reporte_diario_personal l
      join public.reportes_diarios r on r.id = l.reporte_id
     where r.anulado_en is null
       and not exists (select 1 from public.tareos t where t.reporte_linea_id = l.id)
    union
    select distinct s.periodo, s.codigo
      from salida_base s
     where s.cantidad > 0
  ), activo as (
    -- Entre quiénes se reparte lo cargado a todos: las unidades. PLANTA y OFICINA
    -- no lo son.
    select t.periodo, t.codigo, count(*) over (partition by t.periodo) as n
      from trabajo t
     where t.codigo is not null and t.codigo not in ('PLANTA', 'OFICINA', 'TODOS LOS ACTIVOS')
  ), movido as (
    -- Entre quiénes se reparten los gastos del mes: los mismos de la
    -- 20261017300000, todos menos PLANTA. TODOS LOS ACTIVOS no recibe: lo suyo ya
    -- está repartido.
    select t.periodo, t.codigo
      from trabajo t
     where t.codigo is not null and t.codigo not in ('PLANTA', 'TODOS LOS ACTIVOS')
  ), salida as (
    select s.id, s.registrado_en, s.material_id, s.precio_unitario, s.moneda, s.documento_referencia, s.rq_numero,
           s.codigo, s.cantidad, null::bigint as entre, false as a_todos
      from salida_base s
     where s.codigo is distinct from 'TODOS LOS ACTIVOS'
    union all
    -- Lo cargado a todos: una parte igual para cada código que trabajó el mes de
    -- la salida. Sin ninguno, la salida entera queda en TODOS LOS ACTIVOS.
    select s.id, s.registrado_en, s.material_id, s.precio_unitario, s.moneda, s.documento_referencia, s.rq_numero,
           coalesce(a.codigo, s.codigo), case when a.n is null then s.cantidad else s.cantidad / a.n end, a.n, true
      from salida_base s
      left join activo a on a.periodo = s.periodo
     where s.codigo = 'TODOS LOS ACTIVOS'
  ), valorizada as (
    -- El mismo orden que el costeo de la OT: precio congelado, último ingreso con
    -- precio hasta ese día, y el precio que fijó Logística (el vigente ese día, o
    -- el primero después).
    select s.*,
           coalesce(s.precio_unitario, ing.precio_unitario, val.precio)::numeric as precio,
           case when s.precio_unitario is not null then coalesce(s.moneda, ing.moneda, val.moneda)
                when ing.precio_unitario is not null then ing.moneda
                else val.moneda end as moneda_val
      from salida s
      left join lateral (
        select i.precio_unitario, i.moneda from public.movimientos_materiales i
         where i.material_id = s.material_id and i.tipo = 'INGRESO' and i.precio_unitario is not null
           and i.moneda in ('PEN', 'USD') and i.registrado_en <= s.registrado_en
         order by i.registrado_en desc, i.id
         limit 1) ing on true
      left join lateral (
        select v.precio, v.moneda from public.valorizaciones_material v
         where v.material_id = s.material_id
         order by (v.vigente_desde > s.registrado_en),
                  case when v.vigente_desde <= s.registrado_en then v.vigente_desde end desc nulls last,
                  v.vigente_desde, v.id
         limit 1) val on true
     where s.codigo is not null and s.cantidad > 0
       and (v_codigo is null or s.codigo = v_codigo)
  ), porcion as (
    -- Lo que faltaba de los insumos que cubre cada línea de OC, por el código de su RQ.
    select rl.orden_compra_detalle_id as detalle_id, public.normalizar_codigo_interno(rq.codigo_interno) as codigo,
           sum(greatest(rl.cantidad - coalesce(rl.cantidad_en_stock, 0), 0))::numeric as falta
      from public.requerimiento_lineas rl
      join public.requerimientos rq on rq.id = rl.requerimiento_id
     where rl.orden_compra_detalle_id is not null
     group by 1, 2
  ), reparto as (
    -- La parte de la línea que va a cada código; si nada faltaba, a partes iguales.
    select p.detalle_id, p.codigo,
           coalesce(p.falta / nullif(sum(p.falta) over (partition by p.detalle_id), 0),
                    1.0 / count(*) over (partition by p.detalle_id))::numeric as parte
      from porcion p
  ), compra_linea as (
    -- La línea sin insumos (la directa, o la OC de antes) va entera al código de la OC.
    select c.id, coalesce(r.codigo, public.normalizar_codigo_interno(c.codigo_interno)) as codigo,
           d.id as detalle_id, d.precio_unitario,
           d.cantidad * d.precio_unitario * coalesce(r.parte, 1) as importe
      from public.ordenes_compra_materiales c
      left join public.orden_compra_material_detalles d on d.orden_compra_id = c.id
      left join reparto r on r.detalle_id = d.id
     where c.aprobacion <> 'RECHAZADA'
  ), compra as (
    select l.codigo, c.id, coalesce(c.numero, c.referencia) as numero,
           (c.creado_en at time zone 'America/Lima')::date as fecha, c.proveedor, c.moneda,
           coalesce(sum(l.importe) filter (where l.precio_unitario is not null), 0)::numeric as monto,
           count(l.detalle_id) filter (where l.precio_unitario is null)::integer as sin_precio,
           count(l.detalle_id)::numeric as lineas
      from compra_linea l
      join public.ordenes_compra_materiales c on c.id = l.id
     where l.codigo is not null
     group by l.codigo, c.id
  ), por_horas as (
    -- Las horas de cada unidad en cada mes: la base del reparto POR HORAS y del
    -- sueldo de la oficina.
    select h.periodo, h.codigo, h.horas, h.total, h.codigos
      from public.horas_por_codigo_del_mes(null) h
     where p_mano_obra
  ), gasto_mes as (
    -- POR HORAS, cada unidad lleva la parte del gasto de sus horas en el mes. Los
    -- registrados antes con TASA llevan esa tasa; en partes iguales, su parte.
    -- La línea lleva el día en que se registró el gasto, no el 1 del mes: el
    -- gasto en dólares toma el cambio de Tesorería de ese día, y cambio_del_dia
    -- solo mira diez días atrás (con el día 1 quedaba sin cambio y trababa el cierre).
    select m.codigo, g.id, g.periodo, (g.creado_en at time zone 'America/Lima')::date as registrado,
           g.descripcion, g.monto, g.moneda, g.reparto, g.tasa, c.nombre,
           count(*) over (partition by g.id) as n, null::numeric as horas, null::numeric as total, null::numeric as parte
      from public.gastos_generales_mes g
      join public.conceptos_gasto_general c on c.codigo = g.concepto
      join movido m on m.periodo = g.periodo
     where p_mano_obra and g.estado = 'ACTIVO' and g.reparto <> 'HORAS'
    union all
    select h.codigo, g.id, g.periodo, (g.creado_en at time zone 'America/Lima')::date,
           g.descripcion, g.monto, g.moneda, g.reparto, g.tasa, c.nombre,
           h.codigos::bigint, h.horas, h.total,
           -- Cada parte al céntimo, y lo que el redondeo deja suelto a la unidad con
           -- más horas: el gasto entero queda repartido, ni un céntimo de más o de menos.
           round(g.monto * h.horas / h.total, 2)
           + case when row_number() over (partition by g.id order by h.horas desc, h.codigo) = 1
                  then g.monto - sum(round(g.monto * h.horas / h.total, 2)) over (partition by g.id) else 0 end as parte
      from public.gastos_generales_mes g
      join public.conceptos_gasto_general c on c.codigo = g.concepto
      join por_horas h on h.periodo = g.periodo
     where p_mano_obra and g.estado = 'ACTIVO' and g.reparto = 'HORAS'
  ), oficina as (
    -- El sueldo de la oficina de cada mes, que se reparte igual que un gasto POR
    -- HORAS, con el residuo del redondeo a la unidad con más horas.
    select o.periodo, o.monto, h.codigo, h.horas, h.total, h.codigos,
           round(o.monto * h.horas / h.total, 2)
           + case when row_number() over (partition by o.periodo order by h.horas desc, h.codigo) = 1
                  then o.monto - sum(round(o.monto * h.horas / h.total, 2)) over (partition by o.periodo) else 0 end as parte
      from public.sueldos_oficina_del_mes(null) o
      join por_horas h on h.periodo = o.periodo
     where p_mano_obra and o.monto > 0
  ), merma as (
    -- La merma que Diseño evaluó en la OT de la unidad va sobre los materiales
    -- con precio del código. Si el código tiene varias OT con merma (una
    -- garantía), manda la última evaluada: sumarlas cobraría dos veces el mismo acero.
    select distinct on (public.normalizar_codigo_interno(u.codigo_interno))
           public.normalizar_codigo_interno(u.codigo_interno) as codigo, mm.id, mm.porcentaje, mm.motivo,
           (mm.registrado_en at time zone 'America/Lima')::date as fecha, o.numero
      from public.ot_mermas mm
      join public.ordenes_trabajo o on o.id = mm.orden_id
      join public.unidades u on u.id = o.unidad_id
     where p_mano_obra and mm.porcentaje > 0 and o.estado::text <> 'ANULADA'
       and public.normalizar_codigo_interno(u.codigo_interno) is not null
     order by public.normalizar_codigo_interno(u.codigo_interno), mm.registrado_en desc, mm.id
  )
  select h.codigo, h.fuente, h.fecha,
         coalesce(tr.descripcion, case when h.reporte_id is not null then 'Personal general del reporte' end,
                  h.labor, 'Horas cargadas por Recursos Humanos')::text,
         coalesce(rd.asunto, 'Cargadas por Recursos Humanos')::text,
         count(distinct h.trabajador_id)::numeric,
         case when count(distinct h.trabajador_id) = 1 then 'persona' else 'personas' end::text,
         sum(h.horas)::numeric, null::numeric, 'PEN'::text,
         case when h.fuente = 'MANO_OBRA' then round(sum(h.costo), 2) end,
         0, null::text, h.reporte_id
    from horas h
    left join public.reporte_diario_trabajos tr on tr.id = h.trabajo_id
    left join public.reportes_diarios rd on rd.id = h.reporte_id
   where h.codigo is not null and (v_codigo is null or h.codigo = v_codigo)
   group by h.codigo, h.fuente, h.fecha, h.reporte_id, h.trabajo_id, h.labor, tr.descripcion, rd.asunto
  union all
  select v.codigo, case when v.precio is null then 'MATERIALES_SIN_PRECIO' else 'MATERIALES' end,
         (v.registrado_en at time zone 'America/Lima')::date, mat.descripcion::text,
         (case when not v.a_todos then v.documento_referencia
               when v.entre is null then concat_ws(' · ', 'Cargado a todos los activos: ningún código trabajó ese mes todavía, se reparte cuando alguno trabaje', v.documento_referencia)
               when v.entre = 1 then concat_ws(' · ', 'Cargado a todos los activos: todo a este código, el único que trabajó ese mes', v.documento_referencia)
               else concat_ws(' · ', 'Cargado a todos los activos: partes iguales entre los ' || v.entre || ' códigos que trabajaron ese mes', v.documento_referencia)
          end)::text,
         v.cantidad, um.codigo::text, null::numeric, v.precio, v.moneda_val::text,
         case when v.precio is null then null else round(v.cantidad * v.precio, 2) end,
         case when v.precio is null then 1 else 0 end, v.rq_numero::text, v.id
    from valorizada v
    join public.materiales mat on mat.id = v.material_id
    left join public.unidades_medida um on um.id = mat.unidad_medida_id
  union all
  select c.codigo, 'COMPRAS', c.fecha, c.proveedor::text, null::text, c.lineas,
         case when c.lineas = 1 then 'línea' else 'líneas' end::text, null::numeric, null::numeric, c.moneda::text,
         round(c.monto, 2), c.sin_precio, c.numero::text, c.id
    from compra c
   where c.codigo is not null and (v_codigo is null or c.codigo = v_codigo)
  union all
  select g.codigo, 'GASTOS_DEL_MES', g.registrado, (g.nombre || ' ' || to_char(g.periodo, 'MM/YYYY'))::text,
         (case when g.reparto = 'TASA' then trim(trailing '.' from to_char(g.tasa, 'FM990.999')) || ' % de ' || g.descripcion
               when g.reparto = 'HORAS' and g.periodo >= v_mes and g.n = 1 then 'Por ahora todo a este código, la única unidad con horas este mes (el mes no termina) · ' || g.descripcion
               when g.reparto = 'HORAS' and g.n = 1 then 'Todo a este código, la única unidad con horas ese mes · ' || g.descripcion
               when g.reparto = 'HORAS' then case when g.periodo >= v_mes then 'Por ahora, por horas: ' else 'Por horas: ' end || trim(trailing '.' from to_char(g.horas, 'FM999,999,990.99')) || ' de ' || trim(trailing '.' from to_char(g.total, 'FM999,999,990.99'))
                                             || ' h del mes, entre ' || g.n || ' unidades · ' || g.descripcion
               when g.n = 1 then 'Todo a este código, el único que trabajó ese mes · ' || g.descripcion
               else 'Partes iguales entre los ' || g.n || ' códigos que trabajaron ese mes · ' || g.descripcion end)::text,
         1::numeric, null::text, null::numeric, g.monto, g.moneda::text,
         case when g.reparto = 'TASA' then round(g.monto * g.tasa / 100, 2)
              when g.reparto = 'HORAS' then g.parte
              else round(g.monto / g.n, 2) end,
         0, null::text, g.id
    from gasto_mes g
   where v_codigo is null or g.codigo = v_codigo
  union all
  select o.codigo, 'GASTOS_DEL_MES', o.periodo, ('Sueldos de la oficina ' || to_char(o.periodo, 'MM/YYYY'))::text,
         (case when o.codigos = 1 and o.periodo >= v_mes then 'Por ahora todo a este código, la única unidad con horas este mes (el mes no termina)'
               when o.codigos = 1 then 'Todo a este código, la única unidad con horas ese mes'
               else case when o.periodo >= v_mes then 'Por ahora, por horas: ' else 'Por horas: ' end || trim(trailing '.' from to_char(o.horas, 'FM999,999,990.99')) || ' de ' || trim(trailing '.' from to_char(o.total, 'FM999,999,990.99'))
                    || ' h del mes, entre ' || o.codigos || ' unidades' end
          || ' · pagos de la oficina registrados por RR. HH.')::text,
         1::numeric, null::text, null::numeric, o.monto, 'PEN'::text,
         o.parte,
         0, null::text, null::uuid
    from oficina o
   where v_codigo is null or o.codigo = v_codigo
  union all
  select v.codigo, 'MERMA', mm.fecha,
         ('Merma de material ' || trim(trailing '.' from to_char(mm.porcentaje, 'FM990.99')) || ' %')::text,
         ('Evaluada por Diseño en la OT ' || mm.numero || ' · ' || mm.motivo)::text,
         1::numeric, null::text, null::numeric, null::numeric, v.moneda_val::text,
         round(sum(round(v.cantidad * v.precio, 2)) * mm.porcentaje / 100, 2),
         0, mm.numero::text, mm.id
    from valorizada v
    join merma mm on mm.codigo = v.codigo
   where v.precio is not null and v.moneda_val in ('PEN', 'USD')
   group by v.codigo, v.moneda_val, mm.id, mm.fecha, mm.porcentaje, mm.motivo, mm.numero
  union all
  select * from public.codigo_interno_lineas_servicio(v_codigo)
  union all
  select * from public.codigo_interno_lineas_subcontrato(v_codigo)
  union all
  select * from public.codigo_interno_lineas_caja(v_codigo) where p_mano_obra
  union all
  select * from public.codigo_interno_lineas_recargo(v_codigo) where p_mano_obra
  union all
  select * from public.codigo_interno_lineas_gastos_ot(v_codigo) where p_mano_obra
   order by 1, 3 desc, 2, 4;
end;
$$;
comment on function public.codigo_interno_lineas(text, boolean) is
  'Las líneas del costeo de un código interno (o de todos), sin pedir permiso: mano de obra, materiales (lo salido con el código TODOS LOS ACTIVOS se reparte en partes iguales entre los códigos que trabajaron ese mes), compras (no van al total; la OC con insumos de varios códigos se reparte entre ellos), órdenes de servicio, recibos por honorarios de los subcontratos y, cuando se pide la mano de obra, los gastos del mes (por horas de cada unidad en el mes, con el sueldo de la oficina; los registrados antes con tasa o en partes iguales, así), los egresos de caja con el código, los gastos aprobados en la OT de la unidad, la merma que Diseño evaluó en ella y el recargo de las horas extras. Solo la llaman codigo_interno_costeo (Gerencia), codigos_internos_costo, codigo_interno_gasto y codigos_internos_gasto (Requerimientos, sin la mano de obra) y codigo_interno_compras.';
revoke all on function public.codigo_interno_lineas(text, boolean) from public, anon, authenticated;

-- 6. El cierre espera los pagos de la oficina --------------------------------------
-- Los meses en que el código tuvo horas y a alguien de la oficina le faltan días
-- pagados. Los usa el cierre, y la pantalla del costeo los muestra antes de cerrar.
create or replace function public.meses_sin_pagos_oficina(p_codigo text)
returns table (periodo date)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  if public.usuario_actual() is not null
     and not (public.es_admin() or public.tiene_permiso('codigos_internos.cerrar') or public.tiene_permiso('codigos_internos.ver')
              or public.tiene_permiso('costos.ver')) then
    raise exception 'No tiene el permiso codigos_internos.ver, codigos_internos.cerrar ni costos.ver para realizar esta operación'
      using errcode = 'insufficient_privilege';
  end if;
  -- Una sola cuenta de todos los meses: mes por mes repetía las horas de todo cada vez.
  return query
  select distinct h.periodo
    from public.horas_por_codigo_del_mes(null) h
   where h.codigo = public.normalizar_codigo_interno(p_codigo)
     and h.periodo in (select o.periodo from public.sueldos_oficina_del_mes(null) o where o.sin_pago > 0)
   order by h.periodo;
end;
$$;
comment on function public.meses_sin_pagos_oficina(text) is
  'Los meses en que el código interno tuvo horas y a alguien de la oficina le faltan días pagados (desde inicio_registro_pagos_oficina(persona) y hasta hoy). El cierre del costeo los espera. Exige codigos_internos.ver, codigos_internos.cerrar o costos.ver.';
revoke all on function public.meses_sin_pagos_oficina(text) from public, anon;
grant execute on function public.meses_sin_pagos_oficina(text) to authenticated;

-- La misma función de la 20261020110000, con una condición más: antes el sueldo de
-- la oficina entraba solo; ahora depende de que RR. HH. registre cada pago, y la
-- quincena se registra después de pagarla. Cerrar antes congelaría la unidad sin
-- esa parte.
create or replace function public.cerrar_costeo_codigo(p_codigo text, p_observacion text default null)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_codigo text := public.normalizar_codigo_interno(p_codigo);
  v_id uuid;
  k record;
  v_falta text[] := '{}';
  v_fuentes jsonb;
  v_meses text;
begin
  perform public.exigir_permiso('codigos_internos.cerrar');
  if v_codigo is null then
    raise exception 'Indica el código interno.' using errcode = 'check_violation';
  end if;
  if v_codigo = 'PLANTA' then
    raise exception 'PLANTA no es una unidad: su costeo no se cierra.' using errcode = 'check_violation';
  end if;
  -- El sistema no sabe todavía cuándo se entrega una unidad: lo dice Gerencia al cerrar.
  if char_length(btrim(coalesce(p_observacion, ''))) not between 10 and 500 then
    raise exception 'Escribe cómo y cuándo se entregó la unidad (de 10 a 500 caracteres).' using errcode = 'check_violation';
  end if;
  -- Un reintento no cierra dos veces.
  select id into v_id from public.codigo_interno_cierres where codigo = v_codigo and reabierto_en is null;
  if found then
    return v_id;
  end if;

  select * into k from public.codigos_internos_costo_calculado(v_codigo) where codigo = v_codigo;
  if not found then
    raise exception 'El código % no tiene costos que cerrar.', v_codigo using errcode = 'check_violation';
  end if;
  if k.materiales_sin_precio > 0 then
    v_falta := v_falta || (k.materiales_sin_precio || case when k.materiales_sin_precio = 1 then ' salida del almacén sin precio (la valoriza Logística)'
                                                      else ' salidas del almacén sin precio (las valoriza Logística)' end);
  end if;
  if k.horas_sin_costo > 0 then
    v_falta := v_falta || (trim(to_char(k.horas_sin_costo, 'FM999990.##')) || ' h de personal sin costo mensual (lo pone RR. HH.)');
  end if;
  if k.lineas_sin_cambio > 0 then
    v_falta := v_falta || (k.lineas_sin_cambio || case when k.lineas_sin_cambio = 1 then ' línea en dólares sin tipo de cambio' else ' líneas en dólares sin tipo de cambio' end
                           || ' (lo carga Tesorería)');
  end if;
  -- Con cotización aprobada, el cierre congela también el margen: sin el IGV
  -- confirmado o sin el cambio del día de la venta en dólares quedaría congelado
  -- sin margen, y nada empujaría después a reabrirlo.
  if k.cotizaciones > 0 and k.venta_sin_igv_confirmado > 0 then
    v_falta := v_falta || (case when k.venta_sin_igv_confirmado = 1 then 'confirmar si la cotización incluye IGV'
                                else 'confirmar si ' || k.venta_sin_igv_confirmado || ' cotizaciones incluyen IGV' end
                           || ' (Gerencia o Administración en el expediente de la OT, o Ventas al corregir la cotización)');
  end if;
  if k.cotizaciones > 0 and k.venta_sin_cambio > 0 then
    v_falta := v_falta || 'el tipo de cambio del día en que se aprobó la cotización en dólares (lo carga Tesorería)'::text;
  end if;
  -- Los gastos del mes y el sueldo de la oficina se reparten por las horas de
  -- todo el mes (migración 20261020110000): cerrado a mitad de mes, la unidad se
  -- quedaría con una parte que el resto del mes todavía mueve.
  if exists (select 1 from public.horas_por_codigo_del_mes((now() at time zone 'America/Lima')::date) h where h.codigo = v_codigo) then
    v_falta := v_falta || ('que termine el mes ' || to_char(now() at time zone 'America/Lima', 'MM/YYYY')
                           || ': los gastos del mes y el sueldo de la oficina se reparten por las horas de todo el mes');
  end if;
  -- El sueldo de la oficina sale de los pagos que registra RR. HH. (migración
  -- 20261020120000): con días de la oficina sin pago en un mes en que la unidad
  -- trabajó, quedaría congelada sin esa parte.
  -- En una variable aparte: un select into sin filas dejaría v_falta en null y el cierre pasaría.
  select string_agg(to_char(m.periodo, 'MM/YYYY'), ', ' order by m.periodo) into v_meses
    from public.meses_sin_pagos_oficina(v_codigo) m;
  if v_meses is not null then
    v_falta := v_falta || ('registrar los pagos de la oficina de ' || v_meses
                           || ' (RR. HH.: los pagos, o la fecha de ingreso de quien entró después)');
  end if;
  if cardinality(v_falta) > 0 then
    raise exception 'El costeo de % todavía no está completo: falta %.', v_codigo, array_to_string(v_falta, '; ')
      using errcode = 'check_violation';
  end if;
  if k.costo_pen <= 0 then
    raise exception 'El código % todavía no tiene costo cargado: no hay nada que congelar.', v_codigo
      using errcode = 'check_violation';
  end if;

  select coalesce(jsonb_object_agg(f.fuente, f.total), '{}'::jsonb) into v_fuentes
    from (select l.fuente, sum(case when l.moneda = 'PEN' then l.monto
                                    else round(l.monto * public.cambio_del_dia(l.fecha, 'VENTA'), 2) end) as total
            from public.codigo_interno_lineas(v_codigo, true) l
           where l.fuente in ('MANO_OBRA', 'RECARGO_EXTRAS', 'MATERIALES', 'SERVICIOS', 'SUBCONTRATOS',
                              'SUBCONTRATOS_POR_PAGAR', 'GASTOS_DEL_MES', 'CAJA', 'GASTOS_OT', 'MERMA')
           group by l.fuente) f;

  insert into public.codigo_interno_cierres (codigo, costo_pen, precio_neto_pen, margen_pen, margen_pct, por_fuente, observacion)
  values (v_codigo, k.costo_pen, k.precio_neto_pen, k.margen_pen, k.margen_pct, v_fuentes, nullif(btrim(coalesce(p_observacion, '')), ''))
  returning id into v_id;
  return v_id;
end;
$$;
comment on function public.cerrar_costeo_codigo(text, text) is
  'Gerencia cierra el costeo de un código interno al entregar la unidad: congela su costo, su precio sin IGV y su margen, con quién, cuándo y cómo se entregó (la observación, obligatoria). Solo con todo lo que suma completo (también los pagos de la oficina de cada mes en que trabajó) y, si tiene cotización, con su precio sin IGV en soles. Un reintento devuelve el cierre vigente. Exige codigos_internos.cerrar.';
revoke all on function public.cerrar_costeo_codigo(text, text) from public, anon;
grant execute on function public.cerrar_costeo_codigo(text, text) to authenticated;
