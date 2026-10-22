-- =============================================================================
-- LA FACTURA DE UNA OC QUE SE DIO POR PAGADA FUERA ESPERA A CONTABILIDAD
-- -----------------------------------------------------------------------------
-- La OC con boleta que Gerencia aprobó antes del 20/10 (`pago_en_tesoreria =
-- false`) se dio por pagada fuera del sistema: no es deuda de nadie. Si después
-- el proveedor manda su factura y Contabilidad la registra para esa OC (por el
-- anexo de Logística), la factura entraba a Cuentas por pagar como cualquier
-- otra, y Tesorería podía pagar dos veces lo mismo.
--
-- DKS lo decidió el 22/10: «La factura queda en espera hasta que Contabilidad
-- diga si esa OC ya se pagó o si falta pagarla». Y cómo sigue: «La factura queda
-- pagada con ese pago. Si la factura es por más, Tesorería paga la diferencia.
-- Si es por menos, se registra la devolución o se descuenta de otra factura del
-- proveedor».
--
-- Desde aquí:
-- - mientras Contabilidad no lo diga, la factura no se paga (`pagos_adquisicion`
--   lo rechaza diciendo por qué) y las pantallas la muestran «en espera»;
-- - «Ya se pagó»: Contabilidad anota cuándo y cuánto se pagó, con una nota de
--   cómo lo sabe; queda como un pago de la OC hecho fuera del sistema (sin
--   voucher y sin mover la caja, que ya lo tiene en su saldo), la OC pasa a
--   Tesorería y la factura toma ese pago como toma el de cualquier boleta: lo que
--   falte lo paga Tesorería en Cuentas por pagar, y lo pagado de más se devuelve o
--   se descuenta de otra factura, por los caminos que ya existen;
-- - «Falta pagarla»: la OC pasa a Tesorería y la factura se paga en Cuentas por
--   pagar como cualquier otra.
-- Ninguna de las dos vuelve atrás: la decisión queda en la auditoría de la OC, y
-- el pago anotado fuera lo anula Tesorería con su motivo si resultó que no salió.
--
-- Idempotente. Sin `drop` de funciones ni de políticas.
-- =============================================================================

-- 1. El pago de la OC que se hizo fuera del sistema ------------------------------------
alter table public.pagos_orden_compra add column if not exists pagado_fuera text;
comment on column public.pagos_orden_compra.pagado_fuera is
  'Si no es null, el pago se hizo fuera del sistema antes del 20/10 y lo anotó Contabilidad al llegar la factura (migración 20261022175000): cómo sabe que se pagó. No lleva voucher ni mueve la caja.';
alter table public.pagos_orden_compra alter column archivo_ruta drop not null;
alter table public.pagos_orden_compra alter column archivo_mime drop not null;
alter table public.pagos_orden_compra alter column archivo_tamano drop not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pagos_orden_compra_con_su_voucher') then
    alter table public.pagos_orden_compra add constraint pagos_orden_compra_con_su_voucher
      check (pagado_fuera is not null
             or (archivo_ruta is not null and archivo_mime is not null and archivo_tamano is not null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pagos_orden_compra_pagado_fuera_largo') then
    alter table public.pagos_orden_compra add constraint pagos_orden_compra_pagado_fuera_largo
      check (pagado_fuera is null or char_length(pagado_fuera) between 10 and 500);
  end if;
end $$;

-- 2. ¿La factura espera a Contabilidad? -------------------------------------------------
-- La primera OC de la factura que va con boleta, está aprobada y se dio por pagada
-- fuera: mientras exista, la factura no se paga.
create or replace function public.compra_pagada_fuera_de_la_factura(p_factura public.adquisiciones)
returns table (orden_compra_id uuid, compra text, total numeric, moneda text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select c.id, coalesce(c.numero, 'OC ' || c.referencia), public.total_orden_compra(c.id), c.moneda
    from public.ordenes_compra_materiales c
   where c.id = any(public.compras_de_la_factura(p_factura))
     and not c.con_factura and not c.pago_en_tesoreria and c.aprobacion in ('APROBADA', 'NO_REQUERIDA')
   order by c.numero, c.id
   limit 1;
$$;
revoke all on function public.compra_pagada_fuera_de_la_factura(public.adquisiciones) from public, anon, authenticated;

-- Para las pantallas: de estas facturas registradas, cuáles esperan y por qué OC.
create or replace function public.facturas_en_espera(p_facturas uuid[])
returns table (adquisicion_id uuid, orden_compra_id uuid, compra text, total numeric, moneda text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select a.id, x.orden_compra_id, x.compra, x.total, x.moneda
    from public.adquisiciones a
   cross join lateral public.compra_pagada_fuera_de_la_factura(a) x
   where a.id = any(coalesce(p_facturas, '{}')) and a.estado = 'REGISTRADA'
     and (public.es_admin() or public.tiene_permiso('adquisiciones.ver') or public.tiene_permiso('adquisiciones.registrar')
          or public.tiene_permiso('tesoreria.registrar_pagos'));
$$;
revoke all on function public.facturas_en_espera(uuid[]) from public, anon;
grant execute on function public.facturas_en_espera(uuid[]) to authenticated;

-- 3. En espera, la factura no se paga --------------------------------------------------
-- Lo que la factura toma de un pago de la boleta (`pago_orden_compra_id`) sí entra:
-- es justamente el «ya se pagó».
create or replace function public.fn_pago_factura_en_espera()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_adq public.adquisiciones%rowtype;
  v_oc  record;
begin
  if new.anulado_en is not null or new.pago_orden_compra_id is not null then return new; end if;
  select * into v_adq from public.adquisiciones where id = new.adquisicion_id;
  if not found then return new; end if;
  select * into v_oc from public.compra_pagada_fuera_de_la_factura(v_adq);
  if found then
    raise exception 'La factura % es de la %, que va con boleta y se dio por pagada fuera del sistema: espera que Contabilidad diga en Adquisiciones si ya se pagó o si falta pagarla.',
      v_adq.numero_documento, v_oc.compra using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_pago_factura_en_espera() from public, anon, authenticated;
create or replace trigger trg_pago_factura_en_espera
  before insert on public.pagos_adquisicion
  for each row execute function public.fn_pago_factura_en_espera();

-- 4. Contabilidad dice si ya se pagó ---------------------------------------------------
-- `p_ya_pagada`: true, se pagó fuera (con su fecha, su monto y la nota de cómo se
-- sabe); false, falta pagarla. Devuelve el pago anotado, o la OC si falta pagarla.
create or replace function public.confirmar_pago_de_la_boleta(p_compra uuid, p_ya_pagada boolean, p_fecha date,
                                                              p_monto numeric, p_nota text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_yo     uuid := public.usuario_actual();
  v_hoy    date := (now() at time zone 'America/Lima')::date;
  v_cierre uuid[];
  v_oc     public.ordenes_compra_materiales%rowtype;
  v_nombre text;
  v_fact   text;
  v_total  numeric;
  v_nota   text := btrim(coalesce(p_nota, ''));
  v_mon    text;
  v_pago   uuid;
begin
  perform public.exigir_permiso('adquisiciones.registrar');
  if p_ya_pagada is null then
    raise exception 'Di si la OC ya se pagó o si falta pagarla.' using errcode = 'check_violation';
  end if;
  if char_length(v_nota) not between 10 and 500 then
    raise exception 'Cuenta cómo lo sabes, en 10 a 500 caracteres: queda anotado con la OC.' using errcode = 'check_violation';
  end if;
  -- Con el cierre de la OC tomado, como cada pago de la boleta.
  v_cierre := public.bloquear_cierre(array[p_compra]);
  select * into v_oc from public.ordenes_compra_materiales where id = p_compra for update;
  if not found then raise exception 'Esa orden de compra no existe.' using errcode = 'check_violation'; end if;
  v_nombre := coalesce(v_oc.numero, 'OC ' || v_oc.referencia);
  if v_oc.con_factura then
    raise exception 'La % va con factura: se paga por su factura en Cuentas por pagar.', v_nombre using errcode = 'check_violation';
  end if;
  if v_oc.pago_en_tesoreria then
    raise exception 'La % ya la lleva Tesorería: lo que falte se paga en Cuentas por pagar.', v_nombre using errcode = 'check_violation';
  end if;
  if v_oc.aprobacion not in ('APROBADA', 'NO_REQUERIDA') then
    raise exception 'La % no está aprobada: no tiene pago que confirmar.', v_nombre using errcode = 'check_violation';
  end if;
  select a.numero_documento into v_fact
    from public.facturas_de_la_compra(p_compra) f
    join public.adquisiciones a on a.id = f.adquisicion_id
   where a.estado = 'REGISTRADA'
   order by a.fecha_emision, a.creado_en
   limit 1;
  if v_fact is null then
    raise exception 'La % todavía no tiene su factura registrada: si no se pagó, que Tesorería la pase a su lista con «No se pagó».', v_nombre
      using errcode = 'check_violation';
  end if;

  if p_ya_pagada then
    v_total := public.total_orden_compra(p_compra);
    v_mon := case when v_oc.moneda = 'USD' then 'US$ ' else 'S/ ' end;
    if p_fecha is null or p_fecha > v_hoy or p_fecha < (v_oc.creado_en at time zone 'America/Lima')::date then
      raise exception 'Elige el día en que se pagó: entre la emisión de la % y hoy.', v_nombre using errcode = 'check_violation';
    end if;
    if p_monto is null or p_monto <= 0 or p_monto <> round(p_monto, 2) then
      raise exception 'Escribe lo que se pagó, en dos decimales.' using errcode = 'check_violation';
    end if;
    if p_monto > v_total then
      raise exception 'La % suma %: lo pagado fuera no pasa de su total.', v_nombre, v_mon || to_char(v_total, 'FM999G999G990D00')
        using errcode = 'check_violation';
    end if;
    v_pago := gen_random_uuid();
    insert into public.pagos_orden_compra (id, orden_compra_id, fecha_pago, moneda, monto, cancela, cancela_sin_completar,
                                           registrado_por, pagado_fuera)
    values (v_pago, p_compra, p_fecha, v_oc.moneda, p_monto, true, p_monto < v_total, v_yo, v_nota);
  end if;

  perform set_config('metalwork.compra_a_tesoreria', p_compra::text, true);
  update public.ordenes_compra_materiales set pago_en_tesoreria = true where id = p_compra;
  perform set_config('metalwork.compra_a_tesoreria', '', true);

  if p_ya_pagada then
    -- La factura toma lo pagado fuera: lo que falte o sobre lo ve Tesorería.
    perform set_config('metalwork.conciliacion_por', 'Contabilidad confirmó que la ' || v_nombre || ' se pagó fuera del sistema', true);
    perform public.conciliar_pago_directo(v_cierre);
    perform set_config('metalwork.conciliacion_por', '', true);
  end if;
  perform public.notificar_a_permiso('tesoreria.registrar_pagos',
    case when p_ya_pagada then 'Se pagó fuera: ' || v_nombre else 'Falta pagar: ' || v_nombre end,
    case when p_ya_pagada
         then 'Contabilidad confirmó que se pagó ' || v_mon || to_char(p_monto, 'FM999G999G990D00') || ' el '
              || to_char(p_fecha, 'DD/MM/YYYY') || ': su factura ' || v_fact || ' toma ese pago, y lo que falte se paga en Cuentas por pagar.'
         else 'Contabilidad confirmó que no se pagó: su factura ' || v_fact || ' se paga en Cuentas por pagar.' end,
    '/tesoreria/por-pagar', 'ordenes_compra_materiales', p_compra, v_yo);
  return coalesce(v_pago, p_compra);
end;
$$;
revoke all on function public.confirmar_pago_de_la_boleta(uuid, boolean, date, numeric, text) from public, anon;
grant execute on function public.confirmar_pago_de_la_boleta(uuid, boolean, date, numeric, text) to authenticated;
