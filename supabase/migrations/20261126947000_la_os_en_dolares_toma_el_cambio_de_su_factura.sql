-- =============================================================================
-- LA OS EN DÓLARES TOMA EL TIPO DE CAMBIO DE SU FACTURA
-- =============================================================================
-- La detracción de una orden de servicio en dólares se calcula sobre su monto
-- en soles, y ese monto salía del tipo de cambio del día en que Logística emitió
-- la OS. La factura del proveedor llega días después, con otra fecha, y la
-- detracción que Contabilidad deposita va con el cambio de la fecha de la
-- factura. El 2026-11-26 DKS decidió: «Cuando la OS tenga su factura, el monto
-- en soles y la detracción se recalculan con el cambio de la fecha de esa
-- factura».
--
-- Qué cambia:
--
--   1. La factura, la boleta y el recibo de una OS guardan su fecha de emisión.
--      La factura de una OS en dólares la exige: sin ella no se sabe qué cambio
--      le toca.
--   2. La OS guarda el día de su tipo de cambio (`fecha_cambio`): el de su
--      factura vigente. Vacío es «el día en que se emitió», como hasta hoy.
--   3. Al adjuntar la factura, la OS toma el cambio de ese día. Si ese día no
--      tiene cambio registrado, queda sin monto en soles y Tesorería ve de qué
--      día falta: no se paga una detracción con el cambio equivocado. Al
--      registrarlo Contabilidad, se completa sola (ya lo hacía la 20261126626000).
--   4. Si la factura se anula, la OS vuelve al cambio de la que quede o al del
--      día en que se emitió.
--   5. La OS con un pago vigente no se mueve: lo pagado, pagado está. Si ese
--      pago se anula, toma el cambio de su factura.
--
-- Las funciones que ya existían se cambian buscando su texto exacto: si otra
-- migración las cambió, se detiene y pide revisarlas a mano. Idempotente y sin
-- DROP.

-- 1. Las columnas -------------------------------------------------------------

alter table public.documentos_orden_servicio add column if not exists fecha_emision date;
comment on column public.documentos_orden_servicio.fecha_emision is
  'La fecha de emisión que dice el comprobante (factura, boleta o recibo). La de la factura vigente de una OS en dólares decide su tipo de cambio (20261126947000).';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_documento_servicio_fecha_emision') then
    alter table public.documentos_orden_servicio
      add constraint ck_documento_servicio_fecha_emision
      check (fecha_emision is null or tipo in ('FACTURA', 'BOLETA', 'RECIBO'));
  end if;
end $$;

alter table public.ordenes_servicio add column if not exists fecha_cambio date;
comment on column public.ordenes_servicio.fecha_cambio is
  'El día cuyo tipo de cambio le toca a la OS en otra moneda: la fecha de emisión de su factura vigente. Vacío: el día en que se emitió la OS. Lo pone la base al adjuntar o anular la factura (20261126947000).';

-- 2. Las guardas dejan pasar el día del cambio ---------------------------------
-- Las dos guardas de la OS ya dejaban que la base pusiera el monto en soles con
-- la marca `metalwork.completando_monto_pen`. Ahora, con la misma marca, dejan
-- poner también el día del cambio, y dejar el monto vacío cuando ese día no
-- tiene cambio registrado.

do $$
declare
  v_funcion text;
  v_def     text;
  c_viejo_1 constant text := $v$     and new.monto_pen is not null
$v$;
  c_nuevo_1 constant text := $v$     and (new.monto_pen is not null or new.fecha_cambio is not null or old.fecha_cambio is not null)
$v$;
  c_viejo_2 constant text := $v$array['monto_pen', 'total_con_igv_pen', 'detraccion_monto', 'actualizado_en']$v$;
  c_nuevo_2 constant text := $v$array['monto_pen', 'total_con_igv_pen', 'detraccion_monto', 'fecha_cambio', 'actualizado_en']$v$;
begin
  foreach v_funcion in array array['public.fn_os_guardia()', 'public.fn_servicio_no_es_de_administracion()'] loop
    select replace(pg_get_functiondef(v_funcion::regprocedure), E'\r', '') into v_def;
    if position(c_nuevo_1 in v_def) > 0 and position(c_nuevo_2 in v_def) > 0
       and position(c_viejo_1 in v_def) = 0 and position(c_viejo_2 in v_def) = 0 then
      continue;
    end if;
    if (length(v_def) - length(replace(v_def, c_viejo_1, ''))) <> length(c_viejo_1)
       or (length(v_def) - length(replace(v_def, c_viejo_2, ''))) <> 2 * length(c_viejo_2) then
      raise exception '% ya no tiene la guarda del monto en soles que esta migración cambia: revísala a mano.', v_funcion;
    end if;
    execute replace(replace(v_def, c_viejo_1, c_nuevo_1), c_viejo_2, c_nuevo_2);
  end loop;
end $$;

-- 3. La OS toma el cambio de su factura -----------------------------------------

create or replace function public.cambio_de_la_factura_de_servicio(p_orden_servicio uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_os    public.ordenes_servicio%rowtype;
  v_fecha date;
  v_tc    numeric;
begin
  select * into v_os from public.ordenes_servicio where id = p_orden_servicio for update;
  if not found or v_os.moneda = 'PEN' or v_os.monto is null
     or v_os.estado = 'ANULADA' or v_os.aprobacion = 'RECHAZADA' then
    return;
  end if;
  -- Lo pagado, pagado está: si ese pago se anula, se vuelve a mirar.
  if exists (select 1 from public.pagos_orden_servicio p
              where p.orden_servicio_id = p_orden_servicio and p.anulado_en is null) then
    return;
  end if;
  -- La factura vigente que dice su fecha; si hay más de una, la última que se adjuntó.
  select d.fecha_emision into v_fecha
    from public.documentos_orden_servicio d
   where d.orden_servicio_id = p_orden_servicio
     and d.anulado_en is null
     and d.tipo = 'FACTURA'
     and d.fecha_emision is not null
   order by d.creado_en desc, d.id desc
   limit 1;
  if v_fecha is not distinct from v_os.fecha_cambio then
    return;
  end if;
  -- Sin factura vuelve al día en que se emitió. Si el día que toca no tiene
  -- cambio registrado, queda sin monto en soles: se completa al registrarlo.
  v_tc := public.cambio_del_dia(coalesce(v_fecha, public.fecha_de_lima(v_os.creado_en)), 'VENTA');
  perform set_config('metalwork.completando_monto_pen', 'si', true);
  update public.ordenes_servicio
     set fecha_cambio = v_fecha,
         monto_pen = round(monto * v_tc, 2)
   where id = p_orden_servicio;
  perform set_config('metalwork.completando_monto_pen', '', true);
end;
$$;

revoke all on function public.cambio_de_la_factura_de_servicio(uuid) from public, anon, authenticated;

comment on function public.cambio_de_la_factura_de_servicio(uuid) is
  'Pone en la OS en otra moneda el día de su tipo de cambio (la fecha de su factura vigente; sin factura, el día en que se emitió) y su monto en soles con el cambio de ese día. No toca la que tiene un pago vigente, la anulada ni la rechazada. La llaman los disparadores de los documentos y del pago anulado; nadie más (20261126947000).';

create or replace function public.fn_documento_servicio_aplica_cambio()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.tipo = 'FACTURA' then
    perform public.cambio_de_la_factura_de_servicio(new.orden_servicio_id);
  end if;
  return null;
end;
$$;

revoke all on function public.fn_documento_servicio_aplica_cambio() from public, anon, authenticated;

create or replace trigger trg_documento_servicio_aplica_cambio
  after insert or update of anulado_en on public.documentos_orden_servicio
  for each row execute function public.fn_documento_servicio_aplica_cambio();

-- 4. Adjuntar con la fecha de emisión ------------------------------------------
-- La función nueva sale de la que ya está en la base, con la fecha de más: así
-- lleva lo que otra migración le haya agregado. La de antes queda para la
-- pestaña que no se recargó, y pide recargar si lo que adjunta es la factura de
-- una OS en dólares.

do $$
declare
  v_def text;
  c_firma_vieja constant text := $v$adjuntar_documento_servicio(p_id uuid, p_orden_servicio uuid, p_tipo text, p_numero text, p_nombre text, p_ruta text)$v$;
  c_firma_nueva constant text := $v$adjuntar_documento_servicio(p_id uuid, p_orden_servicio uuid, p_tipo text, p_numero text, p_nombre text, p_ruta text, p_fecha_emision date)$v$;
  c_antes constant text := $v$  if p_tipo in ('FACTURA', 'BOLETA', 'RECIBO') then
    v_num := public.normalizar_numero_factura(p_numero);
$v$;
  c_fecha constant text := $v$  if p_fecha_emision is not null and p_tipo not in ('FACTURA', 'BOLETA', 'RECIBO') then
    raise exception 'La fecha de emisión va solo con la factura, la boleta o el recibo.' using errcode = 'check_violation';
  end if;
  if p_fecha_emision > public.fecha_de_lima(now()) then
    raise exception 'La fecha de emisión de la % no puede ser de un día que todavía no llega.', v_que using errcode = 'check_violation';
  end if;
  if p_fecha_emision < public.fecha_de_lima(v_os.creado_en) - 365 then
    raise exception 'La fecha de emisión de la % es de más de un año antes de la %: revísala.', v_que, v_os.numero using errcode = 'check_violation';
  end if;
  if p_tipo = 'FACTURA' and v_os.moneda <> 'PEN' and p_fecha_emision is null then
    raise exception 'Escribe la fecha de emisión de la factura: la % está en otra moneda y toma el tipo de cambio de ese día.', v_os.numero
      using errcode = 'check_violation';
  end if;
$v$;
  c_insert_viejo constant text := $v$                                                mime_type, tamano_bytes, subido_por)
  values (p_id, p_orden_servicio, p_tipo, v_num, v_nombre, p_ruta,
          v_obj.metadata->>'mimetype', (v_obj.metadata->>'size')::integer, v_yo);$v$;
  c_insert_nuevo constant text := $v$                                                mime_type, tamano_bytes, subido_por, fecha_emision)
  values (p_id, p_orden_servicio, p_tipo, v_num, v_nombre, p_ruta,
          v_obj.metadata->>'mimetype', (v_obj.metadata->>'size')::integer, v_yo, p_fecha_emision);$v$;
begin
  if to_regprocedure('public.adjuntar_documento_servicio(uuid,uuid,text,text,text,text,date)') is null then
    select replace(pg_get_functiondef('public.adjuntar_documento_servicio(uuid,uuid,text,text,text,text)'::regprocedure), E'\r', '')
      into v_def;
    if (length(v_def) - length(replace(v_def, c_firma_vieja, ''))) <> length(c_firma_vieja)
       or (length(v_def) - length(replace(v_def, c_antes, ''))) <> length(c_antes)
       or (length(v_def) - length(replace(v_def, c_insert_viejo, ''))) <> length(c_insert_viejo) then
      raise exception 'adjuntar_documento_servicio ya no tiene el texto que esta migración cambia: revísala a mano.';
    end if;
    v_def := replace(v_def, c_firma_vieja, c_firma_nueva);
    v_def := replace(v_def, c_antes, c_fecha || c_antes);
    v_def := replace(v_def, c_insert_viejo, c_insert_nuevo);
    execute v_def;
  end if;
end $$;

revoke all on function public.adjuntar_documento_servicio(uuid, uuid, text, text, text, text, date) from public, anon;
grant execute on function public.adjuntar_documento_servicio(uuid, uuid, text, text, text, text, date) to authenticated;

comment on function public.adjuntar_documento_servicio(uuid, uuid, text, text, text, text, date) is
  'Anota un documento de la OS ya subido a Storage, con la fecha de emisión del comprobante. La factura de una OS en otra moneda la exige: con ella la OS toma el tipo de cambio de ese día (20261126947000). Mismo permiso que antes: puede_adjuntar_documento_servicio().';

create or replace function public.adjuntar_documento_servicio(
  p_id uuid, p_orden_servicio uuid, p_tipo text, p_numero text, p_nombre text, p_ruta text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- La pestaña que no se recargó no tiene dónde escribir la fecha. El mismo
  -- envío repetido de un documento que ya entró sigue contestando su id.
  if p_tipo = 'FACTURA'
     and not exists (select 1 from public.documentos_orden_servicio where id = p_id)
     and exists (select 1 from public.ordenes_servicio s where s.id = p_orden_servicio and s.moneda <> 'PEN')
     and public.puede_adjuntar_documento_servicio() then
    raise exception 'La factura de una orden en otra moneda lleva su fecha de emisión: recarga la pantalla para escribirla.'
      using errcode = 'check_violation';
  end if;
  return public.adjuntar_documento_servicio(p_id, p_orden_servicio, p_tipo, p_numero, p_nombre, p_ruta, null::date);
end;
$$;

revoke all on function public.adjuntar_documento_servicio(uuid, uuid, text, text, text, text) from public, anon;
grant execute on function public.adjuntar_documento_servicio(uuid, uuid, text, text, text, text) to authenticated;

-- 5. El cambio que se registra o se corrige mira el día que le toca a la OS -----
-- `completar_monto_pen_de_servicios`, `recalcular_monto_pen_de_servicios` y el
-- pago anulado (20261126945000) miraban el día en que se emitió. Ahora miran el
-- de la factura si la OS lo tiene. El pago anulado, además, le da a la OS el
-- cambio de la factura que se adjuntó mientras estaba pagada.

do $$
declare
  v_cambio record;
  v_def    text;
  v_veces  integer;
begin
  for v_cambio in
    select * from (values
      ('public.completar_monto_pen_de_servicios()', 1,
       $v$public.cambio_del_dia(public.fecha_de_lima(o.creado_en), 'VENTA') as tc$v$,
       $v$public.cambio_del_dia(coalesce(o.fecha_cambio, public.fecha_de_lima(o.creado_en)), 'VENTA') as tc$v$),
      ('public.recalcular_monto_pen_de_servicios(date,numeric,numeric)', 3,
       $v$public.fecha_de_lima(s.creado_en)$v$,
       $v$coalesce(s.fecha_cambio, public.fecha_de_lima(s.creado_en))$v$),
      ('public.fn_pago_anulado_recalcula_servicio()', 2,
       $v$public.fecha_de_lima(o.creado_en)$v$,
       $v$coalesce(o.fecha_cambio, public.fecha_de_lima(o.creado_en))$v$),
      ('public.fn_pago_anulado_recalcula_servicio()', 1,
       $v$  perform set_config('metalwork.completando_monto_pen', '', true);
  return null;$v$,
       $v$  perform set_config('metalwork.completando_monto_pen', '', true);
  -- La factura que se adjuntó mientras estaba pagada (20261126947000).
  perform public.cambio_de_la_factura_de_servicio(new.orden_servicio_id);
  return null;$v$)
    ) as x(funcion, veces, viejo, nuevo)
  loop
    select replace(pg_get_functiondef(v_cambio.funcion::regprocedure), E'\r', '') into v_def;
    -- Ya cambiada: el texto nuevo está las veces que toca. El viejo puede
    -- seguir dentro del nuevo (la fecha de Lima va dentro del coalesce).
    if (length(v_def) - length(replace(v_def, v_cambio.nuevo, ''))) = v_cambio.veces * length(v_cambio.nuevo) then
      continue;
    end if;
    v_veces := (length(v_def) - length(replace(v_def, v_cambio.viejo, ''))) / length(v_cambio.viejo);
    if v_veces <> v_cambio.veces or position(v_cambio.nuevo in v_def) > 0 then
      raise exception '% ya no tiene el texto que esta migración cambia (se esperaba % vez o veces, hay %): revísala a mano.',
        v_cambio.funcion, v_cambio.veces, v_veces;
    end if;
    execute replace(v_def, v_cambio.viejo, v_cambio.nuevo);
  end loop;
end $$;

comment on function public.completar_monto_pen_de_servicios() is
  'Pone el monto en soles de las OS en otra moneda que no lo tienen, con el cambio del día que les toca: el de su factura (fecha_cambio) o, sin factura, el día en que se emitieron (20261126626000, 20261126947000).';
