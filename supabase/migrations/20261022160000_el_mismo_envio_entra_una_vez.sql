-- El mismo envío repetido entra una vez; otro envío con el mismo id, no.
--
-- Los cobros, los pagos, la factura de venta, el recibo por honorarios y el
-- contrato del subcontrato llevan un id que da la pantalla, para que un
-- reintento no duplique: si el id ya existe, la función devolvía ese id como
-- si acabara de registrarlo. Pero la pantalla sube el archivo a una ruta nueva
-- en cada envío (`subirArchivoFinanzas`, `subirArchivoPlanilla`,
-- `subirArchivoSubcontrato`), así que un segundo envío desde la misma ventana
-- —se perdió la respuesta, dijo «mira si quedó» y se volvió a pulsar— recibía
-- un «registrado» con otro voucher que ninguna fila nombra: quedaba suelto para
-- siempre, y si se había cambiado el monto, la pantalla confirmaba un dato que
-- no se guardó. Lo encontraron los auditores de realización y de
-- funcionamiento el 2026-10-22.
--
-- Ahora el id existente se reconoce solo si la fila nombra el mismo archivo y
-- la anotó la misma persona: es el mismo envío, que la pantalla repite cuando
-- no le llegó la respuesta (`anotarSinDejarloSuelto`). Si no, se rechaza, y la
-- pantalla quita el archivo nuevo, que ninguna fila nombra.
--
-- Cada función va entera, tal como queda después de todas las migraciones
-- anteriores; cambia solo la línea que reconoce el id. `create or replace`
-- conserva los permisos de cada una.
--
-- Antes de reemplazarlas se mira que cada una sea la que el repositorio conoce
-- (su texto antes o después de este cambio, sin los `\r` de un pegado desde
-- Windows). Si alguna se cambió a mano en la base, la migración se detiene en
-- vez de pisar ese cambio sin que nadie lo vea.
do $$
declare
  conocidas constant jsonb := '{
    "adjuntar_contrato_subcontrato(uuid,uuid,text,text)": ["b261941b5013cc7a1117b1581c21a8ab", "8965e8b1597e5a1c2eda7a2271f9ff7c"],
    "registrar_cobro_factura(uuid,uuid,date,numeric,boolean,text,text,uuid,numeric)": ["2d0a6f12e62ea3a6467d937e85d0ad91", "46faf5ed5453c35aad46841d69914e9a"],
    "registrar_factura_venta(uuid,uuid,text,date,date,text,numeric,text,text,text)": ["9fd0af54ac1650f00d0a577a79a67341", "f4c5a4085f59d983e2a3899ee812d566"],
    "registrar_pago_factura(uuid,uuid,date,numeric,text,text,uuid,numeric)": ["94daf26e021bce8cce96b49fb0eb34c7", "79019d81d2f6fa6521ff16b2512c8aa9"],
    "registrar_pago_planilla_diaria(uuid,uuid,uuid[],date,text,text,uuid,numeric)": ["3e8e026fe554d720c04c1da6133a7021", "3a1733a12ca7419d9615d7be5c99ba3b"],
    "registrar_pago_recibo_honorarios(uuid,uuid,date,text,text,uuid,numeric)": ["1f8e7341ac5071b91260205fd3d75c2c", "083803d7bb04f48a4cfe6be441548815"],
    "registrar_pago_servicio(uuid,uuid,date,numeric,boolean,text,text,text,uuid,numeric)": ["c66392cac12567c324e6451f513d1694", "e75dd19a0f0c9e7f0b07b6096683598f"],
    "registrar_recibo_honorarios(uuid,uuid,text,date,text,numeric,boolean,text)": ["425853aa63a6900939adcb94c252e890", "4d15db4cb62dfc98ad62e661be1b996a"]
  }';
  firma text;
  huella text;
begin
  for firma in select jsonb_object_keys(conocidas) loop
    select md5(replace(p.prosrc, E'\r', '')) into huella
      from pg_proc p where p.oid = to_regprocedure('public.' || firma);
    if huella is null then
      raise exception 'Falta la función % : esta base no tiene las migraciones anteriores.', firma;
    end if;
    if not conocidas -> firma ? huella then
      raise exception 'La función % no es la que conoce el repositorio (se cambió a mano): no se reemplaza. Avisa antes de seguir.', firma;
    end if;
  end loop;
end $$;

-- registrar_cobro_factura: cobros_factura_venta.archivo_ruta
create or replace function public.registrar_cobro_factura(p_id uuid, p_factura uuid, p_fecha date, p_monto numeric, p_cancela boolean, p_operacion text, p_ruta text, p_caja uuid, p_monto_cuenta numeric)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_yo      uuid := public.usuario_actual();
  v_hoy     date := (now() at time zone 'America/Lima')::date;
  v_fac     public.facturas_venta%rowtype;
  v_cobrado numeric;
  v_cancela boolean;
  v_obj     storage.objects%rowtype;
  v_op      text := nullif(btrim(coalesce(p_operacion, '')), '');
  v_mon     text;
begin
  perform public.exigir_permiso('tesoreria.registrar_cobros');
  if p_id is null then raise exception 'Vuelve a abrir el formulario del cobro.' using errcode = 'check_violation'; end if;
  -- El mismo envío repetido (la respuesta se perdió) se reconoce por su
  -- archivo y por quién lo anotó; otro envío con el mismo id, no.
  if exists (select 1 from public.cobros_factura_venta where id = p_id) then
    if exists (select 1 from public.cobros_factura_venta
               where id = p_id and archivo_ruta = p_ruta and registrado_por = public.usuario_actual()) then
      return p_id;
    end if;
    raise exception 'Ese cobro ya quedó registrado con otro voucher: recarga la pantalla para verlo.' using errcode = 'check_violation';
  end if;
  select * into v_fac from public.facturas_venta where id = p_factura for update;
  if not found then raise exception 'Esa factura no existe.' using errcode = 'check_violation'; end if;
  if v_fac.anulada_en is not null then
    raise exception 'La factura % está anulada: no se cobra.', v_fac.numero using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.cobros_factura_venta where factura_id = p_factura and anulado_en is null and cancela) then
    raise exception 'La factura % ya está cobrada.', v_fac.numero using errcode = 'check_violation';
  end if;
  if p_fecha is null or p_fecha > v_hoy or p_fecha < v_hoy - 365 then
    raise exception 'Elige el día del cobro: de hoy hacia atrás.' using errcode = 'check_violation';
  end if;
  if p_monto is null or p_monto <= 0 or p_monto > 999999999 or p_monto <> round(p_monto, 2) then
    raise exception 'Escribe lo que se cobró, en dos decimales.' using errcode = 'check_violation';
  end if;
  select coalesce(sum(monto), 0) into v_cobrado from public.cobros_factura_venta
   where factura_id = p_factura and anulado_en is null;
  v_mon := case when v_fac.moneda = 'USD' then 'US$ ' else 'S/ ' end;
  if v_cobrado + p_monto > v_fac.total then
    raise exception 'Con ese cobro la factura % pasaría de su total: le quedan % por cobrar.',
      v_fac.numero, v_mon || to_char(v_fac.total - v_cobrado, 'FM999G999G990D00') using errcode = 'check_violation';
  end if;
  if v_op is not null and char_length(v_op) > 60 then
    raise exception 'El número de operación pasa de 60 caracteres.' using errcode = 'check_violation';
  end if;
  v_obj := public.archivo_subido_por_mi('cobros-venta', p_ruta, p_factura,
                                        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
  v_cancela := coalesce(p_cancela, false) or v_cobrado + p_monto >= v_fac.total;

  insert into public.cobros_factura_venta (id, factura_id, fecha, moneda, monto, cancela, operacion,
                                           archivo_ruta, archivo_mime, archivo_tamano, registrado_por)
  values (p_id, p_factura, p_fecha, v_fac.moneda, p_monto, v_cancela, v_op, p_ruta,
          v_obj.metadata->>'mimetype', (v_obj.metadata->>'size')::integer, v_yo);

  perform public.caja_mover_por_pago('COBRO_FACTURA_VENTA', p_id, 'INGRESO', p_caja, p_fecha, p_monto, v_fac.moneda, p_monto_cuenta,
    'Cobro de la factura ' || v_fac.numero || ' · ' || v_fac.cliente, v_fac.codigo_interno, v_op);

  perform public.notificar_a_permiso('contabilidad.facturar',
    case when v_cancela then 'Factura cobrada: ' else 'Cobro a cuenta: ' end || v_fac.numero,
    v_fac.cliente || ' · código ' || v_fac.codigo_interno || ' · ' || v_mon || to_char(p_monto, 'FM999G999G990D00'),
    '/contabilidad/facturacion#' || p_factura, 'cobros_factura_venta', p_id, v_yo);
  return p_id;
end;
$$;

-- registrar_pago_factura: pagos_adquisicion.archivo_ruta
create or replace function public.registrar_pago_factura(p_id uuid, p_adquisicion uuid, p_fecha date, p_monto numeric, p_referencia text, p_ruta text, p_caja uuid, p_monto_cuenta numeric)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_yo   uuid := public.usuario_actual();
  v_hoy  date := (now() at time zone 'America/Lima')::date;
  v_adq  public.adquisiciones%rowtype;
  v_obj  storage.objects%rowtype;
  v_ref  text := btrim(coalesce(p_referencia, ''));
begin
  perform public.exigir_permiso('tesoreria.registrar_pagos');
  if p_id is null then raise exception 'Vuelve a abrir el formulario del pago.' using errcode = 'check_violation'; end if;
  -- El mismo envío repetido (la respuesta se perdió) se reconoce por su
  -- archivo y por quién lo anotó; otro envío con el mismo id, no.
  if exists (select 1 from public.pagos_adquisicion where id = p_id) then
    if exists (select 1 from public.pagos_adquisicion
               where id = p_id and archivo_ruta = p_ruta and registrado_por = public.usuario_actual()) then
      return p_id;
    end if;
    raise exception 'Ese pago ya quedó registrado con otro comprobante: recarga la pantalla para verlo.' using errcode = 'check_violation';
  end if;
  select * into v_adq from public.adquisiciones where id = p_adquisicion;
  if not found or v_adq.estado <> 'REGISTRADA' then
    raise exception 'Esa factura todavía no está registrada en Adquisiciones.' using errcode = 'check_violation';
  end if;
  if p_fecha is null or p_fecha > v_hoy or p_fecha < v_hoy - 365 then
    raise exception 'Elige el día del pago: de hoy hacia atrás.' using errcode = 'check_violation';
  end if;
  if p_monto is null or p_monto <= 0 or p_monto > 999999999 or p_monto <> round(p_monto, 2) then
    raise exception 'Escribe lo que se pagó, en dos decimales.' using errcode = 'check_violation';
  end if;
  if char_length(v_ref) not between 3 and 120 then
    raise exception 'Escribe el número de operación del banco, de 3 a 120 caracteres.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.pagos_adquisicion
              where adquisicion_id = p_adquisicion and referencia = v_ref and anulado_en is null) then
    raise exception 'La operación % ya está registrada en esta factura.', v_ref using errcode = 'unique_violation';
  end if;
  -- Mientras siga la restricción vieja (la suelta la 20261015123000).
  if exists (select 1 from public.pagos_adquisicion
              where adquisicion_id = p_adquisicion and referencia = v_ref and anulado_en is not null)
     and exists (select 1 from pg_constraint where conname = 'pagos_adquisicion_adquisicion_id_referencia_key'
                   and conrelid = 'public.pagos_adquisicion'::regclass) then
    raise exception 'La operación % ya se usó en un pago anulado de esta factura: para volver a usarla, el administrador del sistema tiene que liberarla.', v_ref
      using errcode = 'check_violation';
  end if;
  v_obj := public.archivo_subido_por_mi('pagos-facturas', p_ruta, p_adquisicion,
                                        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

  insert into public.pagos_adquisicion (id, adquisicion_id, fecha, monto, referencia, registrado_por,
                                        archivo_ruta, archivo_mime, archivo_tamano)
  values (p_id, p_adquisicion, p_fecha, p_monto, v_ref, v_yo,
          p_ruta, v_obj.metadata->>'mimetype', (v_obj.metadata->>'size')::integer);

  perform public.caja_mover_por_pago('PAGO_ADQUISICION', p_id, 'EGRESO', p_caja, p_fecha, p_monto, v_adq.moneda, p_monto_cuenta,
    'Pago de la factura ' || v_adq.numero_documento || ' · ' || v_adq.proveedor, null, v_ref);
  return p_id;
end;
$$;

-- registrar_pago_servicio: pagos_orden_servicio.archivo_ruta
create or replace function public.registrar_pago_servicio(p_id uuid, p_orden_servicio uuid, p_fecha_pago date, p_monto numeric, p_cancela boolean, p_operacion text, p_comprobante text, p_ruta text, p_caja uuid, p_monto_cuenta numeric)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_yo   uuid := public.usuario_actual();
  v_hoy  date := (now() at time zone 'America/Lima')::date;
  v_os   public.ordenes_servicio%rowtype;
  v_obj  storage.objects%rowtype;
  v_op   text := nullif(btrim(coalesce(p_operacion, '')), '');
  v_comp text := nullif(upper(btrim(coalesce(p_comprobante, ''))), '');
begin
  perform public.exigir_permiso('tesoreria.pagar_servicios');
  if p_id is null then raise exception 'Vuelve a abrir el formulario del pago.' using errcode = 'check_violation'; end if;
  -- El mismo envío repetido (la respuesta se perdió) se reconoce por su
  -- archivo y por quién lo anotó; otro envío con el mismo id, no.
  if exists (select 1 from public.pagos_orden_servicio where id = p_id) then
    if exists (select 1 from public.pagos_orden_servicio
               where id = p_id and archivo_ruta = p_ruta and registrado_por = public.usuario_actual()) then
      return p_id;
    end if;
    raise exception 'Ese pago ya quedó registrado con otro comprobante: recarga la pantalla para verlo.' using errcode = 'check_violation';
  end if;
  select * into v_os from public.ordenes_servicio where id = p_orden_servicio for update;
  if not found then raise exception 'Esa orden de servicio no existe.' using errcode = 'check_violation'; end if;
  if v_os.estado = 'ANULADA' or v_os.aprobacion <> 'APROBADA' then
    raise exception 'La orden de servicio % no está aprobada por Gerencia: no se paga.', v_os.numero using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.pagos_orden_servicio
              where orden_servicio_id = p_orden_servicio and anulado_en is null and cancela) then
    raise exception 'La orden de servicio % ya está cancelada.', v_os.numero using errcode = 'check_violation';
  end if;
  if p_fecha_pago is null or p_fecha_pago > v_hoy or p_fecha_pago < v_hoy - 365 then
    raise exception 'Elige el día del pago: de hoy hacia atrás.' using errcode = 'check_violation';
  end if;
  if p_monto is null or p_monto <= 0 or p_monto > 999999999 or p_monto <> round(p_monto, 2) then
    raise exception 'Escribe lo que se pagó, en dos decimales.' using errcode = 'check_violation';
  end if;
  if v_op is not null and char_length(v_op) > 60 then
    raise exception 'El número de operación pasa de 60 caracteres.' using errcode = 'check_violation';
  end if;
  if v_comp is not null and char_length(v_comp) not between 3 and 30 then
    raise exception 'El número de la factura o recibo del proveedor va de 3 a 30 caracteres.' using errcode = 'check_violation';
  end if;
  v_obj := public.archivo_subido_por_mi('pagos-servicio', p_ruta, p_orden_servicio,
                                        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

  insert into public.pagos_orden_servicio (id, orden_servicio_id, fecha_pago, moneda, monto, cancela, operacion,
                                           comprobante_proveedor, archivo_ruta, archivo_mime, archivo_tamano, registrado_por)
  values (p_id, p_orden_servicio, p_fecha_pago, v_os.moneda, p_monto, coalesce(p_cancela, true), v_op, v_comp, p_ruta,
          v_obj.metadata->>'mimetype', (v_obj.metadata->>'size')::integer, v_yo);

  perform public.caja_mover_por_pago('PAGO_ORDEN_SERVICIO', p_id, 'EGRESO', p_caja, p_fecha_pago, p_monto, v_os.moneda, p_monto_cuenta,
    'Pago de la ' || v_os.numero || ' · ' || v_os.proveedor, v_os.codigo_interno, v_op);

  perform public.notificar_a_permiso('compras.crear',
    case when coalesce(p_cancela, true) then 'Servicio pagado: ' else 'Pago a cuenta de un servicio: ' end || v_os.numero,
    v_os.proveedor || ' · ' || case when v_os.moneda = 'USD' then 'US$ ' else 'S/ ' end || to_char(p_monto, 'FM999G999G990D00'),
    '/compras/servicios', 'pagos_orden_servicio', p_id, v_yo);
  return p_id;
end;
$$;

-- registrar_pago_recibo_honorarios: pagos_recibo_honorarios.voucher_ruta
create or replace function public.registrar_pago_recibo_honorarios(p_id uuid, p_recibo_id uuid, p_fecha_pago date, p_operacion text, p_ruta text, p_caja uuid, p_monto_cuenta numeric)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_yo   uuid := public.usuario_actual();
  v_hoy  date := (now() at time zone 'America/Lima')::date;
  v_rec  public.recibos_honorarios%rowtype;
  v_sc   public.subcontratos%rowtype;
  v_sub  public.subcontratistas%rowtype;
  v_obj  storage.objects%rowtype;
  v_op   text := nullif(btrim(coalesce(p_operacion, '')), '');
begin
  perform public.exigir_permiso('subcontratos.pagar');
  if p_id is null then
    raise exception 'Vuelve a abrir el formulario del pago.' using errcode = 'check_violation';
  end if;
  -- El mismo envío repetido (la respuesta se perdió) se reconoce por su
  -- archivo y por quién lo anotó; otro envío con el mismo id, no.
  if exists (select 1 from public.pagos_recibo_honorarios where id = p_id) then
    if exists (select 1 from public.pagos_recibo_honorarios
               where id = p_id and voucher_ruta = p_ruta and registrado_por = public.usuario_actual()) then
      return p_id;
    end if;
    raise exception 'Ese pago ya quedó registrado con otro voucher: recarga la pantalla para verlo.' using errcode = 'check_violation';
  end if;
  select * into v_rec from public.recibos_honorarios where id = p_recibo_id for update;
  if not found then raise exception 'Ese recibo no existe.' using errcode = 'check_violation'; end if;
  if v_rec.anulado_en is not null then
    raise exception 'El recibo % está anulado: no se paga.', v_rec.numero using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.pagos_recibo_honorarios where recibo_id = p_recibo_id and anulado_en is null) then
    raise exception 'El recibo % ya está pagado. Si el pago salió mal, anúlalo y regístralo de nuevo.', v_rec.numero
      using errcode = 'check_violation';
  end if;
  if p_fecha_pago is null or p_fecha_pago > v_hoy or p_fecha_pago < v_rec.fecha_emision then
    raise exception 'Elige el día del pago: desde la fecha del recibo hasta hoy.' using errcode = 'check_violation';
  end if;
  if v_op is not null and char_length(v_op) > 60 then
    raise exception 'El número de operación pasa de 60 caracteres.' using errcode = 'check_violation';
  end if;
  v_obj := public.subcontrato_archivo(v_rec.subcontrato_id, p_ruta);

  insert into public.pagos_recibo_honorarios (id, recibo_id, fecha_pago, monto, operacion, voucher_ruta, voucher_mime, voucher_tamano, registrado_por)
  values (p_id, p_recibo_id, p_fecha_pago, v_rec.monto_neto, v_op, p_ruta, v_obj.metadata->>'mimetype',
          (v_obj.metadata->>'size')::integer, v_yo);

  select * into v_sc from public.subcontratos where id = v_rec.subcontrato_id;
  select * into v_sub from public.subcontratistas where id = v_rec.subcontratista_id;

  perform public.caja_mover_por_pago('PAGO_RECIBO_HONORARIOS', p_id, 'EGRESO', p_caja, p_fecha_pago, v_rec.monto_neto, v_rec.moneda,
    p_monto_cuenta, 'Pago del recibo por honorarios ' || v_rec.numero || ' · ' || v_sub.nombre, v_sc.codigo_interno, v_op);

  perform public.notificar_a_permiso('subcontratos.gestionar', 'Recibo por honorarios pagado: ' || v_rec.numero,
    v_sub.nombre || ' · ' || v_sc.numero || ' · Tesorería adjuntó el voucher.',
    '/subcontratos/' || v_sc.id, 'recibos_honorarios', p_recibo_id, v_yo);
  return p_id;
end;
$$;

-- registrar_pago_planilla_diaria: planilla_diaria_pagos.comprobante_ruta
create or replace function public.registrar_pago_planilla_diaria(p_id uuid, p_planilla_id uuid, p_personas uuid[], p_fecha_pago date, p_operacion text, p_ruta text, p_caja uuid, p_monto_cuenta numeric)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_yo    uuid := public.usuario_actual();
  v_hoy   date := (now() at time zone 'America/Lima')::date;
  v_pla   public.planillas_diarias%rowtype;
  v_obj   storage.objects%rowtype;
  v_n     int;
  v_op    text := nullif(btrim(coalesce(p_operacion, '')), '');
  v_total numeric;
begin
  perform public.exigir_permiso('planilla_diaria.pagar');
  if p_id is null then
    raise exception 'Vuelve a abrir el formulario del pago.' using errcode = 'check_violation';
  end if;
  -- El mismo envío repetido (la respuesta se perdió) se reconoce por su
  -- archivo y por quién lo anotó; otro envío con el mismo id, no.
  if exists (select 1 from public.planilla_diaria_pagos where id = p_id) then
    if exists (select 1 from public.planilla_diaria_pagos
               where id = p_id and comprobante_ruta = p_ruta and registrado_por = public.usuario_actual()) then
      return p_id;
    end if;
    raise exception 'Ese pago ya quedó registrado con otro comprobante: recarga la pantalla para verlo.' using errcode = 'check_violation';
  end if;
  select * into v_pla from public.planillas_diarias where id = p_planilla_id for update;
  if not found then raise exception 'Esa planilla no existe.' using errcode = 'check_violation'; end if;
  if v_pla.anulado_en is not null then
    raise exception 'La planilla % está anulada: no se paga.', v_pla.numero using errcode = 'check_violation';
  end if;
  if p_personas is null or cardinality(p_personas) = 0 then
    raise exception 'Marca a quién le pagaste.' using errcode = 'check_violation';
  end if;
  if p_fecha_pago is null or p_fecha_pago > v_hoy or p_fecha_pago < v_pla.fecha - 7 then
    raise exception 'Elige el día del pago: desde que llegó la planilla hasta hoy.' using errcode = 'check_violation';
  end if;
  if v_op is not null and char_length(v_op) > 60 then
    raise exception 'El número de operación pasa de 60 caracteres.' using errcode = 'check_violation';
  end if;
  select count(*) into v_n from public.planilla_diaria_personas
   where planilla_id = p_planilla_id and id = any(p_personas) and pago_id is null;
  if v_n <> cardinality(array(select distinct unnest(p_personas))) then
    raise exception 'Alguna de las personas marcadas ya está pagada o no es de esta planilla: recarga la pantalla.' using errcode = 'check_violation';
  end if;
  v_obj := public.planilla_diaria_archivo(p_planilla_id, p_ruta);
  if exists (select 1 from public.planilla_diaria_pagos where comprobante_ruta = p_ruta)
     or exists (select 1 from public.planilla_diaria_personas where boleta_ruta = p_ruta) then
    raise exception 'Ese archivo ya está adjunto: sube el comprobante de este pago.' using errcode = 'check_violation';
  end if;

  insert into public.planilla_diaria_pagos (id, planilla_id, fecha_pago, operacion, comprobante_ruta, comprobante_mime, comprobante_tamano, registrado_por)
  values (p_id, p_planilla_id, p_fecha_pago, v_op, p_ruta, v_obj.metadata->>'mimetype', (v_obj.metadata->>'size')::integer, v_yo);
  update public.planilla_diaria_personas set pago_id = p_id
   where planilla_id = p_planilla_id and id = any(p_personas) and pago_id is null;

  -- La cuenta se pide siempre; un pago de S/ 0 no mueve plata.
  select coalesce(sum(total), 0) into v_total from public.planilla_diaria_personas where pago_id = p_id;
  if p_caja is null then
    raise exception 'Elige la cuenta de la que salió el pago.' using errcode = 'check_violation';
  end if;
  if v_total > 0 then
    perform public.caja_mover_por_pago('PAGO_PLANILLA_DIARIA', p_id, 'EGRESO', p_caja, p_fecha_pago, v_total, 'PEN', p_monto_cuenta,
      'Pago de la planilla diaria ' || v_pla.numero || ' · ' || v_n || case when v_n = 1 then ' persona' else ' personas' end,
      null, v_op);
  end if;

  if not exists (select 1 from public.planilla_diaria_personas where planilla_id = p_planilla_id and pago_id is null) then
    perform public.notificar_a_permiso('planilla_diaria.preparar', 'Planilla diaria pagada: ' || v_pla.numero,
      'Tesorería pagó a todos y adjuntó los comprobantes.', '/planilla-diaria/' || p_planilla_id, 'planillas_diarias', p_planilla_id, v_yo);
  end if;
  return p_id;
end;
$$;

-- registrar_factura_venta: facturas_venta.ruta_storage
create or replace function public.registrar_factura_venta(p_id uuid, p_cotizacion uuid, p_numero text, p_fecha_emision date, p_fecha_vencimiento date, p_moneda text, p_total numeric, p_concepto text, p_ruta text, p_nombre_archivo text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_yo       uuid := public.usuario_actual();
  v_hoy      date := (now() at time zone 'America/Lima')::date;
  v_cot      public.cotizaciones_pdf%rowtype;
  v_codigo   text;
  v_numero   text := public.normalizar_numero_factura(p_numero);
  v_obj      storage.objects%rowtype;
  v_cli      text;
  v_otra     text;
  v_concepto text := nullif(btrim(coalesce(p_concepto, '')), '');
begin
  perform public.exigir_permiso('contabilidad.facturar');
  if p_id is null then raise exception 'Vuelve a abrir el formulario de la factura.' using errcode = 'check_violation'; end if;
  -- El mismo envío repetido (la respuesta se perdió) se reconoce por su
  -- archivo y por quién lo anotó; otro envío con el mismo id, no.
  if exists (select 1 from public.facturas_venta where id = p_id) then
    if exists (select 1 from public.facturas_venta
               where id = p_id and ruta_storage = p_ruta and registrado_por = public.usuario_actual()) then
      return p_id;
    end if;
    raise exception 'Esa factura ya quedó registrada con otro PDF: recarga la pantalla para verla.' using errcode = 'check_violation';
  end if;
  select * into v_cot from public.cotizaciones_pdf where id = p_cotizacion for share;
  if not found then raise exception 'Esa cotización no existe.' using errcode = 'check_violation'; end if;
  if v_cot.estado::text = 'ANULADA' or not public.cotizacion_fue_aprobada(p_cotizacion) then
    raise exception 'La cotización % no está aprobada por Gerencia: no se factura.', v_cot.numero using errcode = 'check_violation';
  end if;
  v_codigo := public.codigo_interno_de_cotizacion(p_cotizacion);
  if v_codigo is null then
    raise exception 'La cotización % todavía no tiene código interno: lo pone Administración al cargar la OT.', v_cot.numero
      using errcode = 'check_violation';
  end if;
  if v_numero is null then
    raise exception 'Escribe el número de la factura como sale en SUNAT: la serie, un guion y el número (E001-626).' using errcode = 'check_violation';
  end if;
  select codigo_interno into v_otra from public.facturas_venta where numero = v_numero and anulada_en is null;
  if found then
    raise exception 'La factura % ya está registrada en el código %.', v_numero, v_otra using errcode = 'unique_violation';
  end if;
  if p_fecha_emision is null or p_fecha_emision > v_hoy or p_fecha_emision < v_hoy - 730 then
    raise exception 'Elige la fecha de emisión de la factura: de hoy hacia atrás.' using errcode = 'check_violation';
  end if;
  if p_fecha_vencimiento is null or p_fecha_vencimiento < p_fecha_emision or p_fecha_vencimiento > p_fecha_emision + 730 then
    raise exception 'El vencimiento va desde la fecha de emisión hasta dos años después.' using errcode = 'check_violation';
  end if;
  if p_moneda is null or p_moneda not in ('PEN', 'USD') then
    raise exception 'Elige la moneda de la factura: soles o dólares.' using errcode = 'check_violation';
  end if;
  if p_total is null or p_total <= 0 or p_total > 999999999 or p_total <> round(p_total, 2) then
    raise exception 'Escribe el total de la factura, con IGV, en dos decimales.' using errcode = 'check_violation';
  end if;
  if v_concepto is not null and char_length(v_concepto) not between 2 and 200 then
    raise exception 'El concepto va de 2 a 200 caracteres (por ejemplo, «Inicial 50 %%»).' using errcode = 'check_violation';
  end if;
  v_obj := public.archivo_subido_por_mi('facturas-venta', p_ruta, p_id, array['application/pdf']);

  select razon_social into v_cli from public.clientes where id = v_cot.cliente_id;
  insert into public.facturas_venta (id, codigo_interno, cotizacion_pdf_id, cotizacion_numero, cliente_id, cliente, numero,
                                     fecha_emision, fecha_vencimiento, moneda, total, concepto, ruta_storage,
                                     nombre_archivo, tamano_bytes, registrado_por)
  values (p_id, v_codigo, p_cotizacion, v_cot.numero, v_cot.cliente_id, coalesce(v_cli, 'Cliente sin registrar'), v_numero,
          p_fecha_emision, p_fecha_vencimiento, p_moneda, p_total, v_concepto, p_ruta,
          left(coalesce(nullif(btrim(p_nombre_archivo), ''), v_numero || '.pdf'), 200),
          (v_obj.metadata->>'size')::integer, v_yo);

  perform public.notificar_a_permiso('tesoreria.registrar_cobros', 'Factura por cobrar: ' || v_numero,
    coalesce(v_cli, 'Cliente sin registrar') || ' · código ' || v_codigo || ' · '
      || case when p_moneda = 'USD' then 'US$ ' else 'S/ ' end || to_char(p_total, 'FM999G999G990D00'),
    '/tesoreria/por-cobrar#' || p_id, 'facturas_venta', p_id, v_yo);
  return p_id;
end;
$$;

-- registrar_recibo_honorarios: recibos_honorarios.archivo_ruta
create or replace function public.registrar_recibo_honorarios(p_id uuid, p_subcontrato_id uuid, p_numero text, p_fecha_emision date, p_concepto text, p_monto_bruto numeric, p_retencion boolean, p_ruta text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_yo      uuid := public.usuario_actual();
  v_hoy     date := (now() at time zone 'America/Lima')::date;
  v_sc      public.subcontratos%rowtype;
  v_sub     public.subcontratistas%rowtype;
  v_obj     storage.objects%rowtype;
  v_numero  text := upper(regexp_replace(coalesce(p_numero, ''), '\s', '', 'g'));
  v_neto    numeric;
begin
  perform public.exigir_permiso('subcontratos.gestionar');
  if p_id is null then
    raise exception 'Vuelve a abrir el formulario del recibo.' using errcode = 'check_violation';
  end if;
  -- El mismo envío repetido (la respuesta se perdió) se reconoce por su
  -- archivo y por quién lo anotó; otro envío con el mismo id, no.
  if exists (select 1 from public.recibos_honorarios where id = p_id) then
    if exists (select 1 from public.recibos_honorarios
               where id = p_id and archivo_ruta = p_ruta and registrado_por = public.usuario_actual()) then
      return p_id;
    end if;
    raise exception 'Ese recibo ya quedó registrado con otro archivo: recarga la pantalla para verlo.' using errcode = 'check_violation';
  end if;
  select * into v_sc from public.subcontratos where id = p_subcontrato_id for update;
  if not found then raise exception 'Ese subcontrato no existe.' using errcode = 'check_violation'; end if;
  if v_sc.estado <> 'VIGENTE' then
    raise exception 'El subcontrato % está %: no recibe recibos.', v_sc.numero,
      case when v_sc.estado = 'ANULADO' then 'anulado' else 'terminado (reábrelo si falta un recibo)' end using errcode = 'check_violation';
  end if;
  if v_numero !~ '^[A-Z0-9]{1,4}-[0-9]{1,8}$' then
    raise exception 'Escribe el número del recibo como sale en él: la serie, un guion y el número, por ejemplo E001-25.'
      using errcode = 'check_violation';
  end if;
  if p_fecha_emision is null or p_fecha_emision > v_hoy or p_fecha_emision < v_hoy - 365 then
    raise exception 'Elige la fecha de emisión del recibo: de hoy hacia atrás, dentro del último año.' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(btrim(p_concepto), '')) > 300 then
    raise exception 'El concepto pasa de 300 caracteres.' using errcode = 'check_violation';
  end if;
  if p_monto_bruto is null or p_monto_bruto <= 0 or p_monto_bruto > 999999999 or p_monto_bruto <> round(p_monto_bruto, 2) then
    raise exception 'Escribe el monto bruto del recibo (el total de honorarios), en dos decimales.' using errcode = 'check_violation';
  end if;
  if p_retencion is null then
    raise exception 'Indica si el recibo lleva retención del 8 %%: lo dice el mismo recibo.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.recibos_honorarios
              where subcontratista_id = v_sc.subcontratista_id and numero = v_numero and anulado_en is null) then
    raise exception 'El recibo % de este subcontratista ya está registrado.', v_numero using errcode = 'unique_violation';
  end if;
  v_obj := public.subcontrato_archivo(p_subcontrato_id, p_ruta);

  insert into public.recibos_honorarios (id, subcontrato_id, subcontratista_id, numero, fecha_emision, concepto, moneda,
                                         monto_bruto, retencion_porcentaje, archivo_ruta, archivo_mime, archivo_tamano, registrado_por)
  values (p_id, p_subcontrato_id, v_sc.subcontratista_id, v_numero, p_fecha_emision, nullif(btrim(coalesce(p_concepto, '')), ''),
          v_sc.moneda, p_monto_bruto, case when p_retencion then 8 else 0 end,
          p_ruta, v_obj.metadata->>'mimetype', (v_obj.metadata->>'size')::integer, v_yo)
  returning monto_neto into v_neto;

  select * into v_sub from public.subcontratistas where id = v_sc.subcontratista_id;
  perform public.notificar_a_permiso('subcontratos.pagar', 'Recibo por honorarios por pagar: ' || v_numero,
    v_sub.nombre || ' · ' || v_sc.numero || ' · ' || v_sc.codigo_interno || ' · neto '
      || case when v_sc.moneda = 'USD' then 'US$ ' else 'S/ ' end || to_char(v_neto, 'FM999G999G990D00'),
    '/tesoreria/recibos-por-honorarios', 'recibos_honorarios', p_id, v_yo);
  return p_id;
end;
$$;

-- adjuntar_contrato_subcontrato: subcontrato_contratos.archivo_ruta
create or replace function public.adjuntar_contrato_subcontrato(p_id uuid, p_subcontrato_id uuid, p_ruta text, p_nombre text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_sc     public.subcontratos%rowtype;
  v_obj    storage.objects%rowtype;
  v_nombre text := nullif(left(btrim(coalesce(p_nombre, '')), 200), '');
begin
  perform public.exigir_permiso('subcontratos.gestionar');
  if p_id is null then
    raise exception 'Vuelve a adjuntar el contrato.' using errcode = 'check_violation';
  end if;
  -- El reintento del mismo contrato devuelve el que ya entró.
  -- El mismo envío repetido (la respuesta se perdió) se reconoce por su
  -- archivo y por quién lo anotó; otro envío con el mismo id, no.
  if exists (select 1 from public.subcontrato_contratos where id = p_id) then
    if exists (select 1 from public.subcontrato_contratos
               where id = p_id and archivo_ruta = p_ruta and subido_por = public.usuario_actual()) then
      return p_id;
    end if;
    raise exception 'Ese contrato ya quedó adjuntado con otro archivo: recarga la pantalla para verlo.' using errcode = 'check_violation';
  end if;
  select * into v_sc from public.subcontratos where id = p_subcontrato_id for update;
  if not found then raise exception 'Ese subcontrato no existe. Recarga la pantalla.' using errcode = 'check_violation'; end if;
  if v_sc.estado = 'ANULADO' then
    raise exception 'El subcontrato % está anulado: queda como evidencia y ya no recibe contratos.', v_sc.numero using errcode = 'check_violation';
  end if;
  v_obj := public.subcontrato_archivo(p_subcontrato_id, p_ruta);
  insert into public.subcontrato_contratos (id, subcontrato_id, archivo_ruta, archivo_nombre, archivo_mime, archivo_tamano)
  values (p_id, p_subcontrato_id, p_ruta, v_nombre, v_obj.metadata->>'mimetype', (v_obj.metadata->>'size')::integer);
  return p_id;
end;
$$;
