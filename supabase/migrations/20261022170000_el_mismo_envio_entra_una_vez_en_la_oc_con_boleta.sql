-- El mismo envío repetido entra una vez, también en la OC con boleta y la OS.
--
-- La 20261022160000 lo arregló en los cobros, los pagos, la factura de venta, el
-- recibo por honorarios y el contrato del subcontrato. El PR #130 trajo cuatro
-- funciones más con el mismo id que da la pantalla y el mismo «si el id ya
-- existe, se devuelve»: el pago de la OC con boleta, la devolución del
-- proveedor, el documento de la OS y lo pagado por la boleta que se pasa a una
-- factura con su nota de crédito. Las cuatro reciben el archivo que
-- `subirArchivoFinanzas` sube a una ruta nueva en cada envío: un segundo envío
-- desde la misma ventana (se perdió la respuesta, dijo «mira si quedó» y se
-- volvió a pulsar) recibía «registrado» con otro voucher que ninguna fila
-- nombra, suelto para siempre, y con el monto que se hubiera cambiado sin
-- guardar. Lo encontró la revisión de la rama del PR #148 al traer main.
--
-- Igual que allá: el id existente se reconoce solo si la fila nombra el mismo
-- archivo y la anotó la misma persona. Si no, se rechaza, y la pantalla quita
-- el archivo nuevo, que ninguna fila nombra. Lo pasado a una factura sin
-- documento («la factura lo toma al cambio») no lleva archivo: sin archivo en
-- la fila ni en el envío, es el mismo.
--
-- Cada función va entera, tal como la dejó la 20261020210000; cambia solo la
-- línea que reconoce el id (dos en las que la miran otra vez después de tomar
-- los candados). `create or replace` conserva sus permisos y su comentario.
--
-- Antes de reemplazarlas se mira que cada una sea la que el repositorio conoce
-- (su texto antes o después de este cambio, sin los `\r` de un pegado desde
-- Windows). Si alguna se cambió a mano en la base, la migración se detiene en
-- vez de pisar ese cambio sin que nadie lo vea.
do $$
declare
  conocidas constant jsonb := '{
    "registrar_pago_compra(uuid,uuid,date,numeric,boolean,text,text,text,uuid,numeric)": ["21ec90982ea47c46f62a4e4be1932cc0", "97b17f92d8b237f10429abdb2589817a"],
    "registrar_devolucion_compra(uuid,uuid,date,numeric,text,text,uuid,numeric,boolean)": ["c5c3e1636b39d9c418f65ed5fe6f6c27", "af6731f33836183a5eea00ee578d0cdc"],
    "adjuntar_documento_servicio(uuid,uuid,text,text,text,text)": ["1ec020d5302de240d7c982b10f0466e8", "aa6c0d599e2a8a054f16d9cb3d008d24"],
    "tomar_pago_de_la_boleta(uuid,uuid,uuid,numeric,numeric,text)": ["9b408f5334accc1f39ef0cb37087f0d9", "294b1cdcd3abf22d8085a87c22afee9a"]
  }';
  firma text;
  huella text;
begin
  for firma in select jsonb_object_keys(conocidas) loop
    select md5(replace(p.prosrc, E'\r', '')) into huella
      from pg_proc p where p.oid = to_regprocedure('public.' || firma);
    if huella is null then
      raise exception 'Falta la función %: esta base no tiene las migraciones anteriores.', firma;
    end if;
    if not conocidas -> firma ? huella then
      raise exception 'La función % no es la que conoce el repositorio (se cambió a mano): no se reemplaza. Avisa antes de seguir.', firma;
    end if;
  end loop;
end $$;

-- registrar_pago_compra: pagos_orden_compra.archivo_ruta
create or replace function public.registrar_pago_compra(
  p_id uuid, p_orden_compra uuid, p_fecha_pago date, p_monto numeric, p_cancela boolean,
  p_operacion text, p_comprobante text, p_ruta text, p_caja uuid, p_monto_cuenta numeric
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo      uuid := public.usuario_actual();
  v_hoy     date := (now() at time zone 'America/Lima')::date;
  v_oc      public.ordenes_compra_materiales%rowtype;
  v_nombre  text;
  v_total   numeric;
  v_pagado  numeric;
  v_sin_completar boolean;
  v_cancela boolean;
  v_fact    text;
  v_origen  text;
  v_alcanza boolean;
  v_obj     storage.objects%rowtype;
  v_op      text := nullif(btrim(coalesce(p_operacion, '')), '');
  v_comp    text := nullif(upper(btrim(coalesce(p_comprobante, ''))), '');
  v_mon     text;
begin
  perform public.exigir_permiso('tesoreria.registrar_pagos');
  if p_id is null then raise exception 'Vuelve a abrir el formulario del pago.' using errcode = 'check_violation'; end if;
  -- El mismo envío repetido (la respuesta se perdió) se reconoce por su
  -- archivo y por quién lo anotó; otro envío con el mismo id, no.
  if exists (select 1 from public.pagos_orden_compra where id = p_id) then
    if exists (select 1 from public.pagos_orden_compra
               where id = p_id and archivo_ruta = p_ruta and registrado_por = public.usuario_actual()) then
      return p_id;
    end if;
    raise exception 'Ese pago ya quedó registrado con otro voucher: recarga la pantalla para verlo.' using errcode = 'check_violation';
  end if;
  select * into v_oc from public.ordenes_compra_materiales where id = p_orden_compra for update;
  if not found then raise exception 'Esa orden de compra no existe.' using errcode = 'check_violation'; end if;
  v_nombre := coalesce(v_oc.numero, 'OC ' || v_oc.referencia);
  if v_oc.con_factura then
    raise exception 'La % va con factura: se paga en Cuentas por pagar cuando Contabilidad la registra.', v_nombre using errcode = 'check_violation';
  end if;
  if not v_oc.pago_en_tesoreria then
    raise exception 'La % es de antes de que Tesorería registrara el pago de las OC con boleta: se pagó fuera del sistema.', v_nombre
      using errcode = 'check_violation';
  end if;
  if v_oc.aprobacion not in ('APROBADA', 'NO_REQUERIDA') then
    raise exception 'La % no está aprobada por Gerencia: no se paga.', v_nombre using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.orden_compra_material_detalles where orden_compra_id = p_orden_compra and precio_unitario is null) then
    raise exception 'La % tiene líneas sin precio: Logística tiene que completarlas antes del pago.', v_nombre using errcode = 'check_violation';
  end if;
  -- Si Contabilidad ya le registró su factura (ligada, o la del anexo que alcanza
  -- para ella), se paga por ahí: dos caminos son dos pagos.
  select a.numero_documento into v_fact
    from public.facturas_de_la_compra(p_orden_compra) f
    join public.adquisiciones a on a.id = f.adquisicion_id
   order by a.fecha_emision, a.creado_en
   limit 1;
  if v_fact is not null then
    raise exception 'Contabilidad ya registró el comprobante % de la %: lo que falte se paga por él en «Facturas por pagar».', v_fact, v_nombre
      using errcode = 'check_violation';
  end if;
  -- Ni si el proveedor entregó su comprobante y todavía no se registra: se paga por él.
  select e.numero, e.origen, e.alcanza into v_fact, v_origen, v_alcanza from public.comprobante_en_camino(p_orden_compra) e;
  if v_origen = 'BORRADOR' then
    raise exception 'Contabilidad tiene en borrador el comprobante % de la %: se paga por él en Cuentas por pagar cuando lo registre.', v_fact, v_nombre
      using errcode = 'check_violation';
  elsif v_origen = 'REGISTRADA' then
    raise exception 'Logística anexó a la % la factura %, que Contabilidad registró para otras OC y que no alcanza para esta: si el anexo fue por error, que Logística lo anule y la OC se paga por su boleta.', v_nombre, v_fact
      using errcode = 'check_violation';
  elsif v_origen = 'LOGISTICA' then
    raise exception 'Logística anexó a la % la factura % del proveedor: Contabilidad la registra y se paga por ella en Cuentas por pagar.', v_nombre, v_fact
      using errcode = 'check_violation';
  end if;
  -- Pagada: sus pagos vigentes, menos lo que el proveedor devolvió, suman el
  -- total, o lo último que dijo Tesorería (un pago o una devolución) la dio por
  -- cancelada (sección 2), como la cuentan la lista y la situación. Lo devuelto se puede
  -- volver a pagar: el tope es lo neto.
  v_total := public.total_orden_compra(p_orden_compra);
  select coalesce(sum(monto), 0) into v_pagado
    from public.pagos_orden_compra
   where orden_compra_id = p_orden_compra and anulado_en is null;
  select coalesce(x.sin_completar, false) into v_sin_completar from public.pago_que_cancela_la_compra(p_orden_compra, null) x;
  v_pagado := v_pagado - coalesce((select sum(monto) from public.devoluciones_orden_compra
                                    where orden_compra_id = p_orden_compra and anulado_en is null), 0);
  if v_pagado > 0 and (v_sin_completar or v_pagado >= v_total) then
    raise exception 'La % ya está pagada.', v_nombre using errcode = 'check_violation';
  end if;
  if p_fecha_pago is null or p_fecha_pago > v_hoy or p_fecha_pago < v_hoy - 365 then
    raise exception 'Elige el día del pago: de hoy hacia atrás.' using errcode = 'check_violation';
  end if;
  if p_monto is null or p_monto <= 0 or p_monto > 999999999 or p_monto <> round(p_monto, 2) then
    raise exception 'Escribe lo que se pagó, en dos decimales.' using errcode = 'check_violation';
  end if;
  v_mon := case when v_oc.moneda = 'USD' then 'US$ ' else 'S/ ' end;
  if v_pagado + p_monto > v_total then
    raise exception 'Con ese pago la % pasaría de su total (%): le quedan % por pagar.', v_nombre,
      v_mon || to_char(v_total, 'FM999G999G990D00'), v_mon || to_char(greatest(v_total - v_pagado, 0), 'FM999G999G990D00')
      using errcode = 'check_violation';
  end if;
  if v_op is not null and char_length(v_op) > 60 then
    raise exception 'El número de operación pasa de 60 caracteres.' using errcode = 'check_violation';
  end if;
  if v_comp is not null and char_length(v_comp) not between 3 and 30 then
    raise exception 'El número de la boleta, nota de venta o recibo va de 3 a 30 caracteres.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.devoluciones_orden_compra where archivo_ruta = p_ruta) then
    raise exception 'Esa constancia es la de una devolución: adjunta el voucher del pago.' using errcode = 'check_violation';
  end if;
  v_obj := public.archivo_subido_por_mi('pagos-compras', p_ruta, p_orden_compra,
                                        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
  v_cancela := coalesce(p_cancela, false) or v_pagado + p_monto >= v_total;

  insert into public.pagos_orden_compra (id, orden_compra_id, fecha_pago, moneda, monto, cancela, cancela_sin_completar,
                                         operacion, comprobante_proveedor, archivo_ruta, archivo_mime, archivo_tamano, registrado_por)
  values (p_id, p_orden_compra, p_fecha_pago, v_oc.moneda, p_monto, v_cancela,
          coalesce(p_cancela, false) and v_pagado + p_monto < v_total,
          v_op, v_comp, p_ruta, v_obj.metadata->>'mimetype', (v_obj.metadata->>'size')::integer, v_yo);

  perform public.caja_mover_por_pago('PAGO_ORDEN_COMPRA', p_id, 'EGRESO', p_caja, p_fecha_pago, p_monto, v_oc.moneda, p_monto_cuenta,
    'Pago de la ' || v_nombre || ' · ' || v_oc.proveedor, v_oc.codigo_interno, v_op);

  perform public.notificar_a_permiso('compras.crear',
    case when v_cancela then 'OC pagada: ' else 'Pago a cuenta de una OC: ' end || v_nombre,
    v_oc.proveedor || ' · ' || v_mon || to_char(p_monto, 'FM999G999G990D00'),
    '/compras/ordenes', 'pagos_orden_compra', p_id, v_yo);
  return p_id;
end;
$$;

-- registrar_devolucion_compra: devoluciones_orden_compra.archivo_ruta
create or replace function public.registrar_devolucion_compra(
  p_id uuid, p_orden_compra uuid, p_fecha date, p_monto numeric, p_operacion text, p_ruta text,
  p_caja uuid, p_monto_cuenta numeric, p_deja_pagada boolean
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo     uuid := public.usuario_actual();
  v_hoy    date := (now() at time zone 'America/Lima')::date;
  v_cierre uuid[];
  v_oc     public.ordenes_compra_materiales%rowtype;
  v_nombre text;
  v_pd     record;
  v_tope   numeric;
  v_desde  date;
  v_op     text := nullif(btrim(coalesce(p_operacion, '')), '');
  v_obj    storage.objects%rowtype;
  v_mon    text;
  v_queda  numeric;
  v_total  numeric;
  v_sin_factura boolean;
begin
  perform public.exigir_permiso('tesoreria.registrar_pagos');
  if p_id is null then raise exception 'Vuelve a abrir el formulario de la devolución.' using errcode = 'check_violation'; end if;
  -- El mismo envío repetido (la respuesta se perdió) se reconoce por su
  -- archivo y por quién lo anotó; otro envío con el mismo id, no.
  if exists (select 1 from public.devoluciones_orden_compra where id = p_id) then
    if exists (select 1 from public.devoluciones_orden_compra
               where id = p_id and archivo_ruta = p_ruta and registrado_por = public.usuario_actual()) then
      return p_id;
    end if;
    raise exception 'Esa devolución ya quedó registrada con otra constancia: recarga la pantalla para verla.' using errcode = 'check_violation';
  end if;
  v_cierre := public.bloquear_cierre(array[p_orden_compra]);
  -- Otra vez, ya con los candados: el mismo envío pudo entrar mientras tanto.
  if exists (select 1 from public.devoluciones_orden_compra where id = p_id) then
    if exists (select 1 from public.devoluciones_orden_compra
               where id = p_id and archivo_ruta = p_ruta and registrado_por = public.usuario_actual()) then
      return p_id;
    end if;
    raise exception 'Esa devolución ya quedó registrada con otra constancia: recarga la pantalla para verla.' using errcode = 'check_violation';
  end if;
  select * into v_oc from public.ordenes_compra_materiales where id = p_orden_compra;
  if not found then raise exception 'Esa orden de compra no existe.' using errcode = 'check_violation'; end if;
  v_nombre := coalesce(v_oc.numero, 'OC ' || v_oc.referencia);
  if v_oc.con_factura then
    raise exception 'La % va con factura: aquí se registra lo devuelto de lo pagado por la boleta.', v_nombre using errcode = 'check_violation';
  end if;
  v_mon := case when v_oc.moneda = 'USD' then 'US$ ' else 'S/ ' end;
  select * into v_pd from public.pago_directo_de_la_compra(p_orden_compra);
  v_tope := coalesce(v_pd.pagado, 0) - coalesce(v_pd.devuelto, 0) - coalesce(v_pd.a_mano, 0);
  if v_tope <= 0 then
    if coalesce(v_pd.a_mano, 0) > 0 then
      raise exception 'Lo que queda pagado por la boleta de la % lo tomó a mano una factura: deshaz esa toma en «Facturas por pagar» antes de registrar la devolución.', v_nombre
        using errcode = 'check_violation';
    end if;
    raise exception 'La % no tiene pagos vigentes por su boleta: no hay nada que devolver.', v_nombre using errcode = 'check_violation';
  end if;
  select min(fecha_pago) into v_desde from public.pagos_orden_compra where orden_compra_id = p_orden_compra and anulado_en is null;
  if p_fecha is null or p_fecha > v_hoy or p_fecha < v_desde then
    raise exception 'Elige el día en que entró la devolución: desde el primer pago (%) hasta hoy.', to_char(v_desde, 'DD/MM/YYYY')
      using errcode = 'check_violation';
  end if;
  if p_monto is null or p_monto <= 0 or p_monto > 999999999 or p_monto <> round(p_monto, 2) then
    raise exception 'Escribe lo que devolvió el proveedor, en dos decimales.' using errcode = 'check_violation';
  end if;
  if p_monto > v_tope then
    raise exception 'La devolución pasa de lo que queda pagado por la boleta de la %: como mucho, %.', v_nombre,
      v_mon || to_char(v_tope, 'FM999G999G990D00') using errcode = 'check_violation';
  end if;
  if v_op is not null and char_length(v_op) > 60 then
    raise exception 'El número de operación pasa de 60 caracteres.' using errcode = 'check_violation';
  end if;
  -- Con lo que queda, ¿la OC queda pagada? Solo sin factura y si queda algo sin llegar al total.
  v_queda := coalesce(v_pd.pagado, 0) - coalesce(v_pd.devuelto, 0) - p_monto;
  v_total := public.total_orden_compra(p_orden_compra);
  v_sin_factura := not exists (select 1 from public.facturas_de_la_compra(p_orden_compra))
                   and not exists (select 1 from public.comprobante_en_camino(p_orden_compra) e where e.origen is not null);
  if p_deja_pagada then
    if not v_sin_factura then
      raise exception 'La % ya tiene su factura: cuánto se le paga lo dice la factura, no la devolución.', v_nombre
        using errcode = 'check_violation';
    elsif v_queda <= 0 then
      raise exception 'Con esta devolución no queda nada pagado por la boleta de la %: no puede quedar pagada.', v_nombre
        using errcode = 'check_violation';
    elsif v_queda >= v_total then
      raise exception 'Con lo que queda, la % sigue pagada entera: no hace falta decirlo.', v_nombre
        using errcode = 'check_violation';
    end if;
  elsif p_deja_pagada is null and v_sin_factura and v_queda > 0 and v_queda < v_total then
    raise exception 'Di si con los % que quedan pagados la % queda pagada o debe lo que falta.',
      v_mon || to_char(v_queda, 'FM999G999G990D00'), v_nombre using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.pagos_orden_compra where archivo_ruta = p_ruta) then
    raise exception 'Esa constancia ya es el voucher de un pago: adjunta la de la devolución.' using errcode = 'check_violation';
  end if;
  v_obj := public.archivo_subido_por_mi('pagos-compras', p_ruta, p_orden_compra,
                                        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

  insert into public.devoluciones_orden_compra (id, orden_compra_id, fecha, moneda, monto, operacion, deja_pagada,
                                                archivo_ruta, archivo_mime, archivo_tamano, registrado_por)
  values (p_id, p_orden_compra, p_fecha, v_oc.moneda, p_monto, v_op, coalesce(p_deja_pagada, false),
          p_ruta, v_obj.metadata->>'mimetype', (v_obj.metadata->>'size')::integer, v_yo);

  perform public.caja_mover_por_pago('DEVOLUCION_ORDEN_COMPRA', p_id, 'INGRESO', p_caja, p_fecha, p_monto, v_oc.moneda, p_monto_cuenta,
    'Devolución del proveedor por la ' || v_nombre || ' · ' || v_oc.proveedor, v_oc.codigo_interno, v_op);

  perform set_config('metalwork.conciliacion_por', 'el proveedor devolvió ' || v_mon || to_char(p_monto, 'FM999G999G990D00')
                                                   || ' el ' || to_char(p_fecha, 'DD/MM/YYYY'), true);
  perform public.conciliar_pago_directo(v_cierre);
  perform set_config('metalwork.conciliacion_por', '', true);
  return p_id;
end;
$$;

-- adjuntar_documento_servicio: documentos_orden_servicio.ruta_storage
create or replace function public.adjuntar_documento_servicio(
  p_id uuid, p_orden_servicio uuid, p_tipo text, p_numero text, p_nombre text, p_ruta text
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo      uuid := public.usuario_actual();
  v_os      public.ordenes_servicio%rowtype;
  v_obj     storage.objects%rowtype;
  v_num     text;
  v_nombre  text := left(btrim(coalesce(p_nombre, '')), 200);
  v_otra    text;
  v_que     text;
begin
  if not public.puede_adjuntar_documento_servicio() then
    raise exception 'Los documentos de la orden de servicio los adjuntan Logística y Tesorería.' using errcode = 'insufficient_privilege';
  end if;
  if p_id is null then raise exception 'Vuelve a abrir el formulario.' using errcode = 'check_violation'; end if;
  -- El mismo envío repetido (la respuesta se perdió) se reconoce por su
  -- archivo y por quién lo anotó; otro envío con el mismo id, no.
  if exists (select 1 from public.documentos_orden_servicio where id = p_id) then
    if exists (select 1 from public.documentos_orden_servicio
               where id = p_id and ruta_storage = p_ruta and subido_por = public.usuario_actual()) then
      return p_id;
    end if;
    raise exception 'Ese documento ya quedó adjuntado con otro archivo: recarga la pantalla para verlo.' using errcode = 'check_violation';
  end if;
  v_que := case p_tipo when 'FACTURA' then 'factura' when 'BOLETA' then 'boleta' when 'RECIBO' then 'recibo'
                       when 'CONTRATO' then 'contrato' when 'OTRO' then 'documento' end;
  if v_que is null then raise exception 'Elige qué documento es.' using errcode = 'check_violation'; end if;
  select * into v_os from public.ordenes_servicio where id = p_orden_servicio;
  if not found then raise exception 'Esa orden de servicio no existe.' using errcode = 'check_violation'; end if;
  if v_os.estado = 'ANULADA' or v_os.aprobacion = 'RECHAZADA' then
    raise exception 'La % está %: no se le adjuntan documentos.', v_os.numero,
      case when v_os.estado = 'ANULADA' then 'anulada' else 'rechazada' end using errcode = 'check_violation';
  end if;
  if char_length(v_nombre) = 0 then raise exception 'Adjunta el archivo.' using errcode = 'check_violation'; end if;
  if p_tipo in ('FACTURA', 'BOLETA', 'RECIBO') then
    v_num := public.normalizar_numero_factura(p_numero);
    if v_num is null then
      raise exception 'Escribe el número de la % con su serie y su número, como F001-123.', v_que using errcode = 'check_violation';
    end if;
    select s.numero into v_otra
      from public.documentos_orden_servicio d join public.ordenes_servicio s on s.id = d.orden_servicio_id
     where d.anulado_en is null and d.tipo = p_tipo and d.numero = v_num
       and coalesce(s.proveedor_id::text, upper(btrim(s.proveedor))) = coalesce(v_os.proveedor_id::text, upper(btrim(v_os.proveedor)))
     limit 1;
    if v_otra is not null then
      raise exception 'La % % de este proveedor ya está adjunta a la %: si es la misma, anúlala allí antes de adjuntarla aquí.',
        v_que, v_num, v_otra using errcode = 'check_violation';
    end if;
  end if;
  v_obj := public.archivo_subido_por_mi('documentos-servicio', p_ruta, p_orden_servicio,
                                        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
  if exists (select 1 from public.documentos_orden_servicio
              where orden_servicio_id = p_orden_servicio and anulado_en is null and tipo = p_tipo
                and nombre_archivo = v_nombre and tamano_bytes = (v_obj.metadata->>'size')::integer) then
    raise exception 'Ese archivo ya está adjunto a la % como %: no hace falta subirlo otra vez.', v_os.numero, v_que
      using errcode = 'check_violation';
  end if;

  insert into public.documentos_orden_servicio (id, orden_servicio_id, tipo, numero, nombre_archivo, ruta_storage,
                                                mime_type, tamano_bytes, subido_por)
  values (p_id, p_orden_servicio, p_tipo, v_num, v_nombre, p_ruta,
          v_obj.metadata->>'mimetype', (v_obj.metadata->>'size')::integer, v_yo);

  -- El comprobante de una OS aprobada es lo que Tesorería espera para pagar.
  if v_num is not null and v_os.aprobacion = 'APROBADA' then
    perform public.notificar_a_permiso('tesoreria.pagar_servicios',
      'Comprobante de servicio por pagar: ' || v_os.numero,
      v_os.proveedor || ' · ' || initcap(v_que) || ' ' || v_num,
      '/tesoreria/pagos-de-servicio', 'documentos_orden_servicio', p_id, v_yo);
  end if;
  return p_id;
end;
$$;

-- tomar_pago_de_la_boleta: pagos_adquisicion.archivo_ruta, en la primera fila
create or replace function public.tomar_pago_de_la_boleta(
  p_id uuid, p_compra uuid, p_factura uuid, p_monto_boleta numeric, p_monto_factura numeric, p_ruta text default null
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_cierre  uuid[];
  v_oc      public.ordenes_compra_materiales%rowtype;
  v_adq     public.adquisiciones%rowtype;
  v_nombre  text;
  v_pd      record;
  v_suya    boolean;
  v_saldo   numeric;
  v_cambio  numeric;
  v_resto   numeric;
  v_resto_f numeric;
  v_parte   numeric;
  v_monto   numeric;
  v_p       record;
  v_pago    public.pagos_orden_compra%rowtype;
  v_ref     text;
  v_id      uuid;
  v_primera boolean := true;
  v_s_oc    text;
  v_s_f     text;
  v_obj     storage.objects%rowtype;
begin
  perform public.exigir_permiso('tesoreria.registrar_pagos');
  if p_id is null then raise exception 'Vuelve a abrir la ventana.' using errcode = 'check_violation'; end if;
  -- El mismo envío repetido (la respuesta se perdió) se reconoce por su
  -- archivo y por quién lo anotó; otro envío con el mismo id, no.
  if exists (select 1 from public.pagos_adquisicion where id = p_id) then
    if exists (select 1 from public.pagos_adquisicion
               where id = p_id and archivo_ruta is not distinct from p_ruta and registrado_por = public.usuario_actual()) then
      return p_id;
    end if;
    raise exception 'Eso ya quedó registrado con otro documento: recarga la pantalla para verlo.' using errcode = 'check_violation';
  end if;
  v_cierre := public.bloquear_cierre(array[p_compra], p_factura);
  -- Otra vez, ya con los candados: el mismo envío pudo entrar mientras tanto.
  if exists (select 1 from public.pagos_adquisicion where id = p_id) then
    if exists (select 1 from public.pagos_adquisicion
               where id = p_id and archivo_ruta is not distinct from p_ruta and registrado_por = public.usuario_actual()) then
      return p_id;
    end if;
    raise exception 'Eso ya quedó registrado con otro documento: recarga la pantalla para verlo.' using errcode = 'check_violation';
  end if;
  select * into v_oc from public.ordenes_compra_materiales where id = p_compra;
  if not found or v_oc.con_factura then
    raise exception 'Esa OC con boleta no existe.' using errcode = 'check_violation';
  end if;
  v_nombre := coalesce(v_oc.numero, 'OC ' || v_oc.referencia);
  select * into v_adq from public.adquisiciones where id = p_factura;
  if not found or v_adq.estado <> 'REGISTRADA' or v_adq.tipo = 'OTRO' then
    raise exception 'Elige una factura registrada.' using errcode = 'check_violation';
  end if;
  v_s_oc := case when v_oc.moneda = 'USD' then 'US$ ' else 'S/ ' end;
  v_s_f := case when v_adq.moneda = 'USD' then 'US$ ' else 'S/ ' end;
  if p_monto_boleta is null or p_monto_factura is null or p_monto_boleta <= 0 or p_monto_factura <= 0
     or p_monto_boleta > 999999999 or p_monto_factura > 999999999
     or p_monto_boleta <> round(p_monto_boleta, 2) or p_monto_factura <> round(p_monto_factura, 2) then
    raise exception 'Escribe los dos montos, en dos decimales.' using errcode = 'check_violation';
  end if;
  select * into v_pd from public.pago_directo_de_la_compra(p_compra);
  v_suya := exists (select 1 from public.facturas_de_la_compra(p_compra) f where f.adquisicion_id = p_factura);
  if v_suya then
    if v_adq.moneda = v_oc.moneda then
      raise exception 'La factura % va en la misma moneda que la %: toma lo pagado por la boleta sola.', v_adq.numero_documento, v_nombre
        using errcode = 'check_violation';
    end if;
    if p_monto_boleta > coalesce(v_pd.sin_tomar, 0) then
      raise exception 'Quedan % de lo pagado por la boleta sin pasar a ninguna factura: no toma más.',
        v_s_oc || to_char(coalesce(v_pd.sin_tomar, 0), 'FM999G999G990D00') using errcode = 'check_violation';
    end if;
  else
    if not coalesce(public.mismo_proveedor(v_adq.proveedor, v_oc.proveedor), false) then
      raise exception 'La factura % es de otro proveedor.', v_adq.numero_documento using errcode = 'check_violation';
    end if;
    if coalesce(v_pd.de_mas, 0) <= 0 then
      raise exception 'La % no tiene nada pagado de más que descontar.', v_nombre using errcode = 'check_violation';
    end if;
    if p_monto_boleta > v_pd.de_mas then
      raise exception 'Lo pagado de más de la % es %: no se descuenta más.', v_nombre,
        v_s_oc || to_char(v_pd.de_mas, 'FM999G999G990D00') using errcode = 'check_violation';
    end if;
    if p_ruta is null then
      raise exception 'Adjunta la nota de crédito o el documento donde el proveedor descontó lo pagado de más.' using errcode = 'check_violation';
    end if;
  end if;
  -- El documento del descuento (o el que acompañe a la toma al cambio): subido por quien registra, en la carpeta de la factura.
  if p_ruta is not null then
    if exists (select 1 from public.pagos_adquisicion where archivo_ruta = p_ruta) then
      raise exception 'Ese archivo ya es el de otro pago: adjunta el documento del descuento.' using errcode = 'check_violation';
    end if;
    v_obj := public.archivo_subido_por_mi('pagos-facturas', p_ruta, p_factura,
                                          array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
  end if;
  v_saldo := v_adq.total - coalesce((select sum(x.monto) from public.pagos_adquisicion x
                                      where x.adquisicion_id = p_factura and x.anulado_en is null), 0);
  if p_monto_factura > v_saldo then
    raise exception 'La factura % debe %: no toma más.', v_adq.numero_documento,
      v_s_f || to_char(greatest(v_saldo, 0), 'FM999G999G990D00') using errcode = 'check_violation';
  end if;
  if v_adq.moneda = v_oc.moneda then
    if p_monto_factura <> p_monto_boleta then
      raise exception 'En la misma moneda, lo que toma la factura es lo mismo que sale de la boleta.' using errcode = 'check_violation';
    end if;
  else
    v_cambio := case when v_oc.moneda = 'PEN' then p_monto_boleta / p_monto_factura else p_monto_factura / p_monto_boleta end;
    if v_cambio not between 2 and 6 then
      raise exception 'Con esos montos el dólar sale a S/ %: revisa los dos montos.', round(v_cambio, 3) using errcode = 'check_violation';
    end if;
  end if;

  -- Del último pago hacia atrás, de lo que ninguna factura tomó.
  v_resto := p_monto_boleta;
  v_resto_f := p_monto_factura;
  for v_p in select l.pago_id, greatest(l.para_repartir - l.tomado_solo, 0) as libre
               from public.libre_de_los_pagos_de_compra(p_compra) l
              order by l.orden desc loop
    exit when v_resto <= 0;
    continue when v_p.libre <= 0;
    v_parte := least(v_p.libre, v_resto);
    v_resto := v_resto - v_parte;
    v_monto := case when v_resto <= 0 then v_resto_f else round(p_monto_factura * v_parte / p_monto_boleta, 2) end;
    if v_monto <= 0 then
      raise exception 'Con esos montos no se puede repartir lo que toma la factura entre los pagos de la boleta: revisa los dos montos.'
        using errcode = 'check_violation';
    end if;
    v_resto_f := v_resto_f - v_monto;
    select * into v_pago from public.pagos_orden_compra where id = v_p.pago_id;
    v_id := case when v_primera then p_id else gen_random_uuid() end;
    v_ref := left(case when v_suya then 'Tomado al cambio del pago por la boleta de la '
                       else 'Descontado de lo pagado de más por la boleta de la ' end
                  || v_nombre || ' del ' || to_char(v_pago.fecha_pago, 'DD/MM/YYYY')
                  || coalesce(' · op. ' || btrim(v_pago.operacion), ''), 108);
    -- Otra toma del mismo pago en la misma factura: el sufijo es el de esta fila, que no se repite.
    if exists (select 1 from public.pagos_adquisicion x
                where x.adquisicion_id = p_factura and x.anulado_en is null and x.referencia = v_ref) then
      v_ref := v_ref || ' · ' || left(v_id::text, 8);
    end if;
    perform set_config('metalwork.aplica_pago_directo', v_pago.id::text, true);
    insert into public.pagos_adquisicion (id, adquisicion_id, fecha, monto, referencia, registrado_por,
                                          pago_orden_compra_id, monto_de_la_boleta, archivo_ruta, archivo_mime, archivo_tamano)
    values (v_id, p_factura, v_pago.fecha_pago, v_monto, v_ref,
            public.usuario_actual(), v_pago.id, v_parte,
            case when v_primera then p_ruta end,
            case when v_primera and p_ruta is not null then v_obj.metadata->>'mimetype' end,
            case when v_primera and p_ruta is not null then (v_obj.metadata->>'size')::integer end);
    v_primera := false;
  end loop;
  perform set_config('metalwork.aplica_pago_directo', '', true);
  if v_resto > 0 then
    raise exception 'Quedan % de lo pagado por la boleta sin pasar a ninguna factura: no toma más.',
      v_s_oc || to_char(p_monto_boleta - v_resto, 'FM999G999G990D00') using errcode = 'check_violation';
  end if;

  perform set_config('metalwork.conciliacion_por', 'Tesorería pasó lo pagado por la boleta a la factura ' || v_adq.numero_documento, true);
  perform public.conciliar_pago_directo(v_cierre);
  perform set_config('metalwork.conciliacion_por', '', true);
  return p_id;
end;
$$;
