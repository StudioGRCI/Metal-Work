-- =============================================================================
-- LA OS EN DÓLARES TOMA SU TIPO DE CAMBIO CUANDO SE REGISTRA
-- =============================================================================
-- `emitir_orden_servicio` pasa el monto a soles una sola vez, al emitir, con el
-- tipo de cambio de ese día. Si ese día no había ninguno registrado, la OS en
-- dólares quedaba con `monto_pen` vacío para siempre: nada lo volvía a mirar
-- cuando Tesorería, Contabilidad o Administración registraban el cambio
-- después. Y de `monto_pen` salen el total con IGV y la detracción (columnas
-- generadas), así que Tesorería no sabía cuánto detraer. Lo vio Tesorería.
--
-- Ahora, al registrar o corregir un tipo de cambio (lo registran Contabilidad y
-- Administración), cada OS en dólares que siga sin monto en soles lo toma con el cambio de venta del día en que se emitió
-- (fecha de Lima), o el último de los diez días anteriores: `cambio_del_dia`,
-- el mismo criterio del costeo (20261001150000). No se busca hacia adelante: el
-- cambio de otro día dejaría una cifra que depende del orden en que se
-- registran. Si falta el de ese día, la OS sigue sin monto en soles hasta que
-- se registre.
-- No toca la anulada (es evidencia) ni la rechazada (se emite otra).
--
-- Y si el cambio de un día se corrige (un 37,50 escrito por 3,75: la pantalla
-- del tipo de cambio dice «vuelve a guardarlo con la misma fecha»), las OS que
-- se calcularon con el valor equivocado se recalculan con el corregido: las que
-- tienen el monto en soles que da el valor viejo y a las que ese día les toca
-- el nuevo. Salvo la que ya tiene un pago vigente: lo pagado se hizo con esa
-- cifra. Para corregirla, Tesorería anula el pago antes de que se corrija el
-- cambio; anularlo después no la recalcula. Sin esto, la OS conforme quedaba con
-- una detracción mal calculada para siempre: no se anula ni se corrige.
--
-- Dos guardas tenían que dejarlo pasar, y solo a esto:
--   · `fn_os_guardia` congela la OS conforme salvo su detracción: ahora deja
--     también poner su monto en soles, y nada más;
--   · `fn_servicio_no_es_de_administracion` frena a Administración, que también
--     registra el tipo de cambio: el completado lo hace la base, no ella.
-- Las dos lo reconocen por una marca de la transacción que ponen solo las
-- funciones que completan y recalculan, igual que `metalwork.anulando_oc`.
-- Nadie con sesión escribe directo en `ordenes_servicio` (solo tiene `select`),
-- así que la marca sola no abre nada.
--
-- Hoy producción no tiene ninguna OS. Idempotente y sin DROP.

-- 1. Completar lo vacío ----------------------------------------------------------------------
create or replace function public.completar_monto_pen_de_servicios()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_filas integer;
begin
  perform set_config('metalwork.completando_monto_pen', 'si', true);
  update public.ordenes_servicio s
     set monto_pen = round(s.monto * x.tc, 2)
    from (select o.id,
                 public.cambio_del_dia(public.fecha_de_lima(o.creado_en), 'VENTA') as tc
            from public.ordenes_servicio o
           where o.monto_pen is null
             and o.moneda <> 'PEN'
             and o.monto is not null
             and o.estado <> 'ANULADA'
             and o.aprobacion <> 'RECHAZADA') x
   where x.id = s.id
     and x.tc is not null;
  get diagnostics v_filas = row_count;
  perform set_config('metalwork.completando_monto_pen', '', true);
  return v_filas;
end;
$$;
comment on function public.completar_monto_pen_de_servicios() is
  'Pone el monto en soles a las OS en dólares que no lo tenían, con el cambio de venta del día de emisión (cambio_del_dia). Solo lo vacío; sin cambio de ese día, sigue vacío.';
revoke all on function public.completar_monto_pen_de_servicios() from public, anon, authenticated;

-- El cambio de un día se corrigió: las OS calculadas con el valor viejo toman el nuevo.
create or replace function public.recalcular_monto_pen_de_servicios(p_fecha date, p_venta_vieja numeric, p_venta_nueva numeric)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_filas integer;
begin
  if p_venta_vieja is null or p_venta_nueva is null or p_venta_vieja = p_venta_nueva then
    return 0;
  end if;
  perform set_config('metalwork.completando_monto_pen', 'si', true);
  update public.ordenes_servicio s
     set monto_pen = round(s.monto * p_venta_nueva, 2)
   where s.moneda <> 'PEN'
     and s.monto is not null
     and s.estado <> 'ANULADA'
     and s.aprobacion <> 'RECHAZADA'
     and s.monto_pen = round(s.monto * p_venta_vieja, 2)
     -- El cambio corregido es el que le toca al día en que se emitió.
     and public.fecha_de_lima(s.creado_en) >= p_fecha
     and public.fecha_de_lima(s.creado_en) < p_fecha + 10
     and public.cambio_del_dia(public.fecha_de_lima(s.creado_en), 'VENTA') = p_venta_nueva
     and not exists (select 1 from public.pagos_orden_servicio p
                      where p.orden_servicio_id = s.id and p.anulado_en is null);
  get diagnostics v_filas = row_count;
  perform set_config('metalwork.completando_monto_pen', '', true);
  return v_filas;
end;
$$;
comment on function public.recalcular_monto_pen_de_servicios(date, numeric, numeric) is
  'Corregido el cambio de venta de un día, recalcula el monto en soles de las OS en dólares que se calcularon con el valor viejo y a las que ese día les toca. No toca la anulada, la rechazada ni la que tiene un pago vigente.';
revoke all on function public.recalcular_monto_pen_de_servicios(date, numeric, numeric) from public, anon, authenticated;

create or replace function public.fn_tipo_de_cambio_recalcula_servicios()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.recalcular_monto_pen_de_servicios(new.fecha, old.venta, new.venta);
  return null;
end;
$$;
revoke all on function public.fn_tipo_de_cambio_recalcula_servicios() from public, anon, authenticated;

create or replace trigger trg_tipo_de_cambio_recalcula_servicios
  after update of venta on public.tipos_de_cambio
  for each row
  when (old.venta is distinct from new.venta and old.fecha = new.fecha)
  execute function public.fn_tipo_de_cambio_recalcula_servicios();

create or replace function public.fn_tipo_de_cambio_completa_servicios()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.completar_monto_pen_de_servicios();
  return null;
end;
$$;
revoke all on function public.fn_tipo_de_cambio_completa_servicios() from public, anon, authenticated;

create or replace trigger trg_tipo_de_cambio_completa_servicios
  after insert or update of fecha, venta on public.tipos_de_cambio
  for each statement execute function public.fn_tipo_de_cambio_completa_servicios();

-- 2. La guarda de la OS deja poner el monto en soles, y solo eso ---------------------------
do $$
declare
  v_def text;
  v_ancla constant text :=
    $v$  if old.estado = 'ANULADA' then
    raise exception 'La orden de servicio % ya está anulada: queda como evidencia.', old.numero using errcode = 'check_violation';
  end if;$v$;
  v_agregado constant text :=
    $v$
  -- El tipo de cambio que se registró o corrigió después pone el monto en soles
  -- (20261126626000): solo eso, y solo desde las funciones que ponen la marca.
  if current_setting('metalwork.completando_monto_pen', true) = 'si'
     and new.monto_pen is not null
     and (to_jsonb(new) - array['monto_pen', 'total_con_igv_pen', 'detraccion_monto', 'actualizado_en'])
         = (to_jsonb(old) - array['monto_pen', 'total_con_igv_pen', 'detraccion_monto', 'actualizado_en']) then
    return new;
  end if;$v$;
begin
  -- Sin los \r que deja una migración aplicada desde Windows: el ancla es de varias líneas.
  select replace(pg_get_functiondef('public.fn_os_guardia()'::regprocedure), E'\r', '') into v_def;
  if position(v_agregado in v_def) > 0 then
    return;
  end if;
  if position('metalwork.completando_monto_pen' in v_def) > 0 then
    raise exception 'fn_os_guardia tiene otra versión de este bloque: revisa esta migración a mano.';
  end if;
  if position(v_ancla in v_def) = 0 then
    raise exception 'fn_os_guardia ya no tiene el bloque de la OS anulada: revisa esta migración a mano.';
  end if;
  execute replace(v_def, v_ancla, v_ancla || v_agregado);
end $$;

-- 3. Administración registra el cambio; el completado no es suyo -------------------------
create or replace function public.fn_servicio_no_es_de_administracion()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- El monto en soles que pone la base al registrar o corregir un tipo de cambio
  -- no lo cambia Administración (20261126626000).
  if current_setting('metalwork.completando_monto_pen', true) = 'si' and tg_op = 'UPDATE'
     and new.monto_pen is not null
     and (to_jsonb(new) - array['monto_pen', 'total_con_igv_pen', 'detraccion_monto', 'actualizado_en'])
         = (to_jsonb(old) - array['monto_pen', 'total_con_igv_pen', 'detraccion_monto', 'actualizado_en']) then
    return new;
  end if;
  if public.compra_solo_su_rqa() then
    raise exception 'No tienes permiso para emitir ni cambiar órdenes de servicio.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_servicio_no_es_de_administracion() from public, anon, authenticated;

-- 4. Las que ya quedaron vacías ------------------------------------------------------------
select public.completar_monto_pen_de_servicios();
