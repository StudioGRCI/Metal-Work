-- =============================================================================
-- LA CASA COTIZA EN DÓLARES Y COSTEA EN SOLES
-- -----------------------------------------------------------------------------
-- La empresa cotiza en dólares. El sistema abría cada cotización en soles y
-- había que acordarse de cambiar el desplegable; el que se olvidaba emitía una
-- cotización de «S/ 40,000» por un trabajo de US$ 40,000.
--
-- Y hay algo peor, que ya estaba y nadie veía: `tipo_cambio_vigente()` devuelve
-- 1 cuando la tabla de cambios está vacía. No porque el dólar valga un sol,
-- sino porque no tiene nada que devolver. Con esa cifra congelada, una
-- cotización de US$ 40,000 abría una orden presupuestada en S/ 40,000 en vez de
-- los S/ 134,000 que de verdad hay que gastar, el margen salía magnífico y el
-- error recién aparecía al comprar el material. Nada fallaba, nada avisaba.
--
-- Desde acá:
--   · las cotizaciones nacen en dólares;
--   · una cotización en soles lleva cambio 1, que ahí sí es la verdad;
--   · una cotización en dólares SIN cambio cargado no se guarda: se explica qué
--     falta y dónde cargarlo. Es preferible que no deje trabajar a que deje
--     trabajar mal;
--   · el cambio se refresca mientras la cotización no haya salido, y se congela
--     cuando se envía al cliente. Un borrador de la semana pasada no se emite
--     con el dólar de la semana pasada.
-- =============================================================================

-- ------------------------------------------------------- de dónde salió la cifra
-- Lo que se carga a mano y lo que trae el servicio de SUNAT valen igual, pero
-- no son lo mismo: dentro de un año, ante una diferencia con el papel del
-- banco, esta columna es la única forma de saber a quién se le preguntó.
alter table public.tipos_cambio
  add column if not exists fuente text not null default 'MANUAL';

comment on column public.tipos_cambio.fuente is
  'De dónde salió la cifra: MANUAL cuando la escribió alguien, o el servicio que la publicó. Sirve para explicar una diferencia meses después.';

-- ------------------------------------------------------- la moneda de la casa
alter table public.cotizaciones alter column moneda set default 'USD';

-- ------------------------------------------- una cifra que no está no vale uno
-- `tipo_cambio_vigente` sigue como estaba —devuelve 1 con la tabla vacía— porque
-- hay informes que la llaman y no deben reventar. Esta otra es la que usan los
-- documentos: distingue «no hay cambio» de «el cambio es uno», que es
-- exactamente la distinción que costaba cara.
create or replace function public.tipo_cambio_exigido(p_fecha date default current_date)
returns numeric
language plpgsql
stable
set search_path to 'public'
as $$
declare
  v_venta numeric;
  v_fecha date;
begin
  select t.venta, t.fecha into v_venta, v_fecha
    from public.tipos_cambio t
   where t.fecha <= p_fecha
   order by t.fecha desc
   limit 1;

  if v_venta is null then
    raise exception
      'No hay tipo de cambio cargado al % y la cotización está en dólares. Cárgalo en Configuración → Tipo de cambio (o pulsa «Traerlo de SUNAT») y vuelve a guardar.',
      to_char(p_fecha, 'DD/MM/YYYY')
      using errcode = 'no_data_found';
  end if;

  return v_venta;
end;
$$;

comment on function public.tipo_cambio_exigido is
  'El tipo de cambio de venta vigente a una fecha, o una excepción si no hay ninguno. La diferencia con tipo_cambio_vigente() es que esta no confunde «no hay dato» con «vale uno».';

grant execute on function public.tipo_cambio_exigido(date) to authenticated;

-- ---------------------------------------------- el cálculo, con la moneda adentro
create or replace function public.fn_cotizacion_calcular()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_base numeric;
  v_tasa numeric;
  v_igv_incluido numeric;
begin
  if tg_op = 'INSERT' then
    if nullif(btrim(new.numero), '') is null then
      begin
        new.numero := public.siguiente_correlativo('COTIZACION', null, new.sede_id);
      exception when no_data_found then
        new.numero := public.siguiente_correlativo('COTIZACION', null, null);
      end;
    end if;

    if new.vendedor_id is null then
      select c.vendedor_id into new.vendedor_id
        from public.clientes c where c.id = new.cliente_id;
    end if;

    if new.creado_por is null then
      new.creado_por := public.usuario_actual();
    end if;
  end if;

  -- El tipo de cambio se resuelve siempre, no solo al insertar. Un borrador
  -- abierto el lunes y enviado el viernes sale con el dólar del viernes, que es
  -- el que va a regir la compra; congelarlo el lunes era congelar una cifra que
  -- nadie eligió. Deja de moverse cuando el documento sale al cliente: desde
  -- ENVIADA en adelante, lo impreso manda.
  if new.moneda = 'PEN' then
    -- En soles el cambio es uno de verdad, no por falta de dato.
    new.tipo_cambio := 1;
  elsif tg_op = 'INSERT'
     or new.tipo_cambio is null
     or new.estado in ('BORRADOR', 'EN_COSTEO', 'EN_REVISION', 'OBSERVADA', 'REVISADA') then
    new.tipo_cambio := public.tipo_cambio_exigido(new.fecha_emision);
  end if;

  if new.igv_porcentaje is null then
    new.igv_porcentaje := coalesce(
      (select e.igv_porcentaje from public.empresa e order by e.creado_en limit 1),
      18);
  end if;

  new.costo_estimado := coalesce(
    (select sum(p.subtotal) from public.cotizacion_partidas p where p.cotizacion_id = new.id),
    0);

  if new.precio_venta is null then
    new.precio_venta := new.costo_estimado;
  end if;

  new.descuento := coalesce(new.descuento, 0);
  v_tasa := new.igv_porcentaje::numeric;

  if new.incluye_igv then
    v_igv_incluido := round(new.precio_venta::numeric * v_tasa / (100 + v_tasa), 2);
    new.subtotal   := round(new.precio_venta::numeric - v_igv_incluido, 2);
  else
    new.subtotal := new.precio_venta::numeric;
  end if;

  if new.descuento::numeric > new.subtotal::numeric then
    raise exception
      'El descuento de la cotización % es mayor que el precio ofrecido. Corrige uno de los dos.',
      new.numero
      using errcode = 'check_violation';
  end if;

  v_base := new.subtotal::numeric - new.descuento::numeric;

  if new.incluye_igv and new.descuento::numeric = 0 then
    new.igv   := round(new.precio_venta::numeric - new.subtotal::numeric, 2);
    new.total := new.precio_venta;
  else
    new.igv   := round(v_base * v_tasa / 100, 2);
    new.total := round(v_base + new.igv::numeric, 2);
  end if;

  if new.estado = 'APROBADA' then
    new.fecha_aprobacion := coalesce(new.fecha_aprobacion, now());
    new.aprobada_por     := coalesce(new.aprobada_por, public.usuario_actual());
  end if;

  return new;
end;
$$;

-- ------------------------------------------- el cambio de hoy, para poder arrancar
-- Sin esta fila, con la moneda por omisión en dólares, nadie podría crear una
-- cotización hasta entrar a Configuración. Es el cambio publicado por SUNAT el
-- 29/08/2026, traído del mismo servicio que usa el botón.
insert into public.tipos_cambio (fecha, compra, venta, fuente)
values (date '2026-08-29', 3.348, 3.356, 'SUNAT vía apis.net.pe')
on conflict (fecha) do nothing;
