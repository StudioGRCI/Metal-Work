-- =============================================================================
-- EL PLAZO ARRANCA CON EL PAGO
-- -----------------------------------------------------------------------------
-- «Quien confirma el comienzo es Ventas con el método de desde cuándo inicia, o
-- Administración, o Tesorería, que le llegan los pagos.»
--
-- El sistema tenía la condición escrita —las cotizaciones de la casa dicen
-- «50 % de adelanto y lo demás a la entrega», y el plazo cuenta «después de
-- emitida la orden de compra»— pero no tenía dónde anotar que el adelanto
-- llegó. Sin eso, las catorce etapas de la OT se programaban desde el día en
-- que Gerencia la aprobaba, que es una fecha de oficina: el taller no empieza
-- hasta que entra el dinero, y el cliente no reclama contra esa fecha sino
-- contra la del adelanto.
--
-- Acá se cierra con tres piezas:
--
--   1. `pagos_cliente` — cada pago del cliente contra su cotización: cuánto,
--      cuándo, por qué medio y con qué referencia. Lo anota Tesorería o
--      Administración.
--   2. `cotizaciones.plazo_arranca_en` — el día desde el que corre el plazo. Lo
--      sella el primer pago, y queda escrito para que nadie tenga que
--      acordarse.
--   3. `programar_etapas_ot` cuenta desde ahí. Un cambio de una línea, y es
--      todo lo que hacía falta: la programación ya encadenaba las etapas por
--      días hábiles desde una fecha de arranque; lo que no tenía era la fecha
--      buena.
--
-- El pago NO lleva moneda propia: es la de su cotización. Un pago en dólares
-- contra una cotización en soles obligaría a convertir para saber el saldo, y
-- esa conversión —con qué tipo de cambio, el del día del pago o el de la
-- cotización— es una discusión que la casa no tiene y que el sistema no debe
-- inventar.
-- =============================================================================

-- =============================================================================
-- 1. LOS PAGOS
-- =============================================================================
do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'public' and t.typname = 'tipo_pago_cliente') then
    create type public.tipo_pago_cliente as enum ('ADELANTO', 'PARCIAL', 'SALDO');
  end if;

  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'public' and t.typname = 'medio_pago') then
    create type public.medio_pago as enum
      ('TRANSFERENCIA', 'DEPOSITO', 'CHEQUE', 'EFECTIVO', 'LETRA', 'OTRO');
  end if;
end $$;

create table if not exists public.pagos_cliente (
  id              uuid primary key default gen_random_uuid(),
  cotizacion_id   uuid not null references public.cotizaciones(id) on delete restrict,
  -- La orden puede no existir todavía: el adelanto es justamente lo que hace
  -- que se emita. Se llena cuando ya está, para poder mirar los pagos desde la
  -- OT sin pasar por la cotización.
  orden_id        uuid references public.ordenes_trabajo(id) on delete set null,
  tipo            public.tipo_pago_cliente not null default 'ADELANTO',
  fecha           date not null default current_date,
  monto           numeric(14,2) not null check (monto > 0),
  medio           public.medio_pago not null default 'TRANSFERENCIA',
  -- El número de operación del banco. Es lo que se cruza con el extracto.
  referencia      text,
  observaciones   text,
  registrado_por  uuid references public.usuarios(id) on delete set null,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),

  -- El mismo número de operación no entra dos veces: es el error de dedo que
  -- duplicaría un adelanto y daría por pagado lo que no está.
  constraint uq_pago_referencia unique nulls not distinct (cotizacion_id, referencia)
);

comment on table public.pagos_cliente is
  'Los pagos del cliente contra su cotización: el adelanto que arranca el trabajo, los parciales y el saldo. La moneda es la de la cotización.';
comment on column public.pagos_cliente.referencia is
  'Número de operación del banco, para cruzar con el extracto. No se repite dentro de la misma cotización.';

-- (b) de la regla de índices: la pantalla lee los pagos por cotización siempre.
create index if not exists idx_pagos_cliente_cotizacion
  on public.pagos_cliente(cotizacion_id, fecha);

-- =============================================================================
-- 2. EL DÍA EN QUE ARRANCA EL PLAZO
-- =============================================================================
alter table public.cotizaciones
  add column if not exists plazo_arranca_en date;

comment on column public.cotizaciones.plazo_arranca_en is
  'El día desde el que corre el plazo de fabricación. Lo sella el primer pago del cliente; de acá salen las fechas de las catorce etapas de la orden.';

-- =============================================================================
-- 3. PERMISOS
-- =============================================================================
insert into public.permisos (codigo, modulo, descripcion) values
  ('pagos.ver',       'tesoreria', 'Ver los pagos que hizo el cliente'),
  ('pagos.registrar', 'tesoreria', 'Registrar un pago del cliente y arrancar el plazo')
on conflict (codigo) do update set descripcion = excluded.descripcion;

-- Registra quien recibe el dinero o quien lo administra. Ve además Ventas, que
-- necesita saber si le pagaron para confirmar el trato, y Gerencia.
insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, x.permiso
  from public.roles r
  join (values
    ('COSTOS',         'pagos.registrar'),
    ('ADMINISTRACION', 'pagos.registrar'),
    ('COSTOS',         'pagos.ver'),
    ('ADMINISTRACION', 'pagos.ver'),
    ('VENDEDOR',       'pagos.ver'),
    ('GERENTE',        'pagos.ver')
  ) as x(rol, permiso) on x.rol = r.codigo
on conflict do nothing;

alter table public.pagos_cliente enable row level security;

drop policy if exists ver_pagos_cliente on public.pagos_cliente;
create policy ver_pagos_cliente on public.pagos_cliente
  for select to authenticated
  using (public.es_admin() or public.tiene_permiso('pagos.ver'));

drop policy if exists crear_pagos_cliente on public.pagos_cliente;
create policy crear_pagos_cliente on public.pagos_cliente
  for insert to authenticated
  with check (public.es_admin() or public.tiene_permiso('pagos.registrar'));

drop policy if exists editar_pagos_cliente on public.pagos_cliente;
create policy editar_pagos_cliente on public.pagos_cliente
  for update to authenticated
  using (public.es_admin() or public.tiene_permiso('pagos.registrar'))
  with check (public.es_admin() or public.tiene_permiso('pagos.registrar'));

-- Un pago mal anotado se corrige; borrarlo lo deja fuera de la cuenta sin que
-- nadie pueda explicar el hueco. Solo el administrador, y queda en audit_log.
drop policy if exists borrar_pagos_cliente on public.pagos_cliente;
create policy borrar_pagos_cliente on public.pagos_cliente
  for delete to authenticated
  using (public.es_admin());

grant select, insert, update, delete on public.pagos_cliente to authenticated;

select public.activar_timestamps('pagos_cliente');
select public.activar_auditoria('pagos_cliente');

-- =============================================================================
-- 4. EL PRIMER PAGO ARRANCA EL PLAZO
-- -----------------------------------------------------------------------------
-- Sella la fecha en la cotización y, si la orden ya existe y el taller no la ha
-- empezado, la reprograma desde ese día. Si alguna etapa ya arrancó de verdad
-- no se toca nada: mover el programa debajo de un trabajo en marcha es peor que
-- tener la fecha vieja.
-- =============================================================================
create or replace function public.arrancar_plazo_de_cotizacion(
  p_cotizacion uuid,
  p_fecha      date
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_orden uuid;
begin
  update public.cotizaciones
     set plazo_arranca_en = p_fecha
   where id = p_cotizacion
     and plazo_arranca_en is null;

  select o.id into v_orden
    from public.ordenes_trabajo o
   where o.cotizacion_id = p_cotizacion
     and o.estado not in ('ANULADA', 'ENTREGADA', 'FACTURADA')
   limit 1;

  if v_orden is null then return; end if;

  if exists (
    select 1 from public.ot_etapas e
     where e.orden_id = v_orden
       and (e.fecha_inicio_real is not null or e.estado <> 'PENDIENTE')
  ) then
    return;
  end if;

  update public.ordenes_trabajo
     set fecha_inicio_programada = p_fecha
   where id = v_orden;

  update public.ot_etapas
     set fecha_inicio_programada = null,
         fecha_fin_programada    = null
   where orden_id = v_orden;

  perform public.programar_etapas_ot(v_orden);
end;
$$;

comment on function public.arrancar_plazo_de_cotizacion(uuid, date) is
  'Sella el día desde el que corre el plazo y reprograma las etapas de la orden, si existe y todavía no empezó.';

revoke all on function public.arrancar_plazo_de_cotizacion(uuid, date) from public, anon, authenticated;

create or replace function public.fn_pago_arranca_plazo()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- El primero que entra manda: los parciales siguientes no mueven el plazo.
  perform public.arrancar_plazo_de_cotizacion(new.cotizacion_id, new.fecha);
  return null;
end;
$$;

revoke all on function public.fn_pago_arranca_plazo() from public, anon, authenticated;

drop trigger if exists trg_pago_arranca_plazo on public.pagos_cliente;
create trigger trg_pago_arranca_plazo
  after insert on public.pagos_cliente
  for each row execute function public.fn_pago_arranca_plazo();

-- =============================================================================
-- 5. LA PROGRAMACIÓN CUENTA DESDE EL PAGO
-- -----------------------------------------------------------------------------
-- Único cambio: de dónde sale la fecha de arranque. Antes era la de la orden o,
-- a falta de ella, hoy —el día en que Gerencia aprobaba—. Ahora, si el cliente
-- ya pagó, manda el día del pago.
-- =============================================================================
create or replace function public.programar_etapas_ot(p_orden_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_cotizacion uuid;
  v_cursor     date;
  v_inicio     date;
  v_fin        date;
  v_programadas int := 0;
  r            record;
begin
  select o.cotizacion_id,
         coalesce(o.fecha_inicio_programada, c.plazo_arranca_en, current_date)
    into v_cotizacion, v_cursor
    from public.ordenes_trabajo o
    left join public.cotizaciones c on c.id = o.cotizacion_id
   where o.id = p_orden_id;

  if v_cotizacion is null then return 0; end if;

  for r in
    select e.id, ce.dias
      from public.ot_etapas e
      join public.cotizacion_etapas ce
        on ce.etapa_catalogo_id = e.etapa_catalogo_id
       and ce.cotizacion_id = v_cotizacion
     where e.orden_id = p_orden_id
       and ce.dias > 0
       and e.fecha_inicio_programada is null
     order by e.orden_secuencia
  loop
    v_inicio := public.sumar_dias_habiles(v_cursor, 0);
    v_fin    := public.sumar_dias_habiles(v_inicio, r.dias - 1);

    update public.ot_etapas
       set fecha_inicio_programada = v_inicio,
           fecha_fin_programada    = v_fin
     where id = r.id;

    v_cursor := v_fin + 1;
    v_programadas := v_programadas + 1;
  end loop;

  return v_programadas;
end;
$$;

-- =============================================================================
-- 6. LO QUE LLEVA PAGADO CADA COTIZACIÓN
-- =============================================================================
create or replace view public.v_pagos_cotizacion as
select
  c.id                                   as cotizacion_id,
  c.numero,
  c.moneda,
  c.precio_venta,
  c.plazo_arranca_en,
  coalesce(p.pagado, 0)                  as pagado,
  greatest(coalesce(c.precio_venta, 0) - coalesce(p.pagado, 0), 0) as saldo,
  case
    when coalesce(c.precio_venta, 0) = 0 then null
    else round(coalesce(p.pagado, 0) * 100 / c.precio_venta, 1)
  end                                    as pagado_pct,
  p.cuantos                              as pagos,
  p.primero                              as primer_pago
from public.cotizaciones c
left join lateral (
  select sum(pc.monto) as pagado, count(*) as cuantos, min(pc.fecha) as primero
    from public.pagos_cliente pc
   where pc.cotizacion_id = c.id
) p on true;

comment on view public.v_pagos_cotizacion is
  'Lo que el cliente lleva pagado de cada cotización y lo que falta, en la moneda de la cotización.';

alter view public.v_pagos_cotizacion set (security_invoker = on);
grant select on public.v_pagos_cotizacion to authenticated;
