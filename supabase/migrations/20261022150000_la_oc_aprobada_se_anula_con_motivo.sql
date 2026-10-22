-- =============================================================================
-- LA OC APROBADA SE ANULA CON MOTIVO
-- -----------------------------------------------------------------------------
-- DKS lo decidió el 21/10 («Sí, con motivo» a «¿Se puede anular una OC ya
-- aprobada?»). Hasta hoy una orden de compra solo se podía rechazar mientras
-- esperaba a Gerencia: aprobada, no había vuelta atrás aunque el proveedor no
-- tuviera el material o se comprara a otro, y su PDF seguía saliendo como
-- vigente (hallazgo P1-5 de la revisión del 20/10).
--
-- Desde aquí Gerencia —el puesto que aprueba las compras— la anula con su
-- motivo, quién y cuándo, mientras no haya entrado nada y no haya nada pagado:
--   · nada recogido por el conductor, entregado a Almacén ni con guía de
--     remisión vigente;
--   · nada pagado: ni la factura de Contabilidad ni el anexo de factura de
--     Logística vigentes, y lo que Tesorería pagó por la boleta, devuelto
--     entero por el proveedor (la OC «Devuelta» de Adquisiciones, migración
--     20261020210000, se anula igual: no se le debe nada).
-- Como el rechazo, sus líneas vuelven a quedar por comprar y la OC deja de
-- sumar en el costeo del código; las líneas quedan escritas en la OC
-- (`lineas_anuladas`) y su PDF sale con la marca ANULADA. La OC no se borra
-- nunca: anulada, queda congelada como evidencia, y nada nuevo se le cuelga
-- (pagos, devoluciones, documentos, guías, recojo ni ingreso).
--
-- Idempotente. Sin `drop` de funciones ni de políticas: el conector de
-- producción no los deja pasar. `drop constraint` sí pasa.
-- =============================================================================

-- 1. La anulación en la OC ------------------------------------------------------------
alter table public.ordenes_compra_materiales add column if not exists anulada_por uuid references public.usuarios(id) on delete restrict;
alter table public.ordenes_compra_materiales add column if not exists anulada_en timestamptz;
alter table public.ordenes_compra_materiales add column if not exists motivo_anulacion text;
alter table public.ordenes_compra_materiales add column if not exists lineas_anuladas jsonb;
comment on column public.ordenes_compra_materiales.lineas_anuladas is
  'Las líneas que tenía la OC al anularla (anular_orden_compra), como `lineas_rechazadas`: sus líneas se sueltan para volver a comprarse y su PDF las imprime de aquí.';

alter table public.ordenes_compra_materiales drop constraint if exists ck_compra_aprobacion;
alter table public.ordenes_compra_materiales add constraint ck_compra_aprobacion check (
  aprobacion in ('NO_REQUERIDA', 'POR_APROBAR', 'APROBADA', 'RECHAZADA', 'ANULADA')
  and (aprobacion <> 'APROBADA' or (aprobado_por is not null and aprobado_en is not null))
  and (aprobacion <> 'RECHAZADA' or (rechazado_por is not null and rechazado_en is not null
                                     and char_length(btrim(coalesce(motivo_rechazo, ''))) between 10 and 500))
  and ((aprobacion = 'ANULADA') = (anulada_en is not null))
  and (aprobacion <> 'ANULADA' or (anulada_por is not null
                                   and char_length(btrim(coalesce(motivo_anulacion, ''))) between 10 and 500)));

-- 2. Lo que ya contaba la OC rechazada cuenta también la anulada ------------------------
-- Las definiciones vivas, con la anulada sumada donde se excluía la rechazada:
-- el costeo, lo que falta comprar de cada RQ, el recojo, la entrega a Almacén,
-- la factura que se le liga, la trazabilidad y la lista de Gerencia. Y el aviso
-- de «Compra por aprobar» deja de decir «Directa, sin requerimiento» a la OC que
-- compra insumos de un RQ (hallazgo de la revisión): lo que pide aprobación no
-- cambia, solo el texto.
CREATE OR REPLACE FUNCTION public.fn_compra_entrega_exige_aprobacion()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if new.entregado_almacen_en is not null and old.entregado_almacen_en is null
     and new.aprobacion in ('POR_APROBAR', 'RECHAZADA', 'ANULADA') then
    raise exception '%', public.mensaje_compra_sin_aprobar(new) using errcode = 'check_violation';
  end if;
  if new.aprobacion is distinct from old.aprobacion and old.aprobacion = 'RECHAZADA' then
    raise exception 'Una compra rechazada no vuelve atrás. Emite una nueva orden.' using errcode = 'check_violation';
  end if;
  -- Solo anular_orden_compra la anula: es la que deja el motivo y suelta sus líneas.
  if new.aprobacion = 'ANULADA' and old.aprobacion is distinct from 'ANULADA'
     and current_setting('metalwork.anulando_oc', true) is distinct from new.id::text then
    raise exception 'Una orden de compra se anula desde Aprobación de compras, con su motivo.' using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_compra_recojo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_orden constant text[] := array['POR_RECOGER', 'EN_RECOJO', 'RECOGIDO', 'DEJADO'];
  v_antes int; v_ahora int;
begin
  -- La compra aprobada sale sola hacia el recojo.
  if new.aprobacion = 'APROBADA' and old.aprobacion is distinct from 'APROBADA'
     and new.recojo is null and new.entregado_almacen_en is null then
    new.recojo := 'POR_RECOGER';
    new.recojo_pedido_en := now();
    new.recojo_pedido_por := coalesce(new.aprobado_por, public.usuario_actual());
  end if;

  if new.recojo is distinct from old.recojo
     and not (new.recojo is null and new.aprobacion = 'ANULADA' and old.recojo in ('POR_RECOGER', 'EN_RECOJO')
              and current_setting('metalwork.anulando_oc', true) = new.id::text) then
    v_antes := coalesce(array_position(v_orden, old.recojo), 0);
    v_ahora := coalesce(array_position(v_orden, new.recojo), 0);
    -- Un paso adelante; o de POR_RECOGER a RECOGIDO si no marcó la salida.
    if not (v_ahora = v_antes + 1 or (old.recojo = 'POR_RECOGER' and new.recojo = 'RECOGIDO')) then
      raise exception 'El recojo de la compra % no puede pasar de % a %.',
        coalesce(new.numero, new.referencia), coalesce(old.recojo, 'sin recojo'), coalesce(new.recojo, 'sin recojo')
        using errcode = 'check_violation';
    end if;
    if new.recojo = 'POR_RECOGER' then
      if new.aprobacion in ('POR_APROBAR', 'RECHAZADA', 'ANULADA') then
        raise exception '%', public.mensaje_compra_sin_aprobar(new) using errcode = 'check_violation';
      end if;
      perform public.avisar_a_quien_tiene('compras.programar_recojo',
        'Programa el recojo: ' || coalesce(new.numero, new.referencia),
        new.proveedor || '. Ponle su peso y su lugar en la lista del conductor.',
        '/compras/gestion', new.id,
        case when new.aprobacion = 'APROBADA' and old.aprobacion is distinct from 'APROBADA' then new.creado_por end);
    end if;
    -- El conductor sale a recoger lo que Logística le puso en su lista.
    if old.recojo = 'POR_RECOGER' and new.recojo in ('EN_RECOJO', 'RECOGIDO')
       and not exists (select 1 from public.programacion_recojo p
                        where p.orden_compra_id = new.id and p.posicion is not null) then
      raise exception 'Logística todavía no programa el recojo de la compra %: espera a que la ponga en tu lista.',
        coalesce(new.numero, new.referencia) using errcode = 'check_violation';
    end if;
  end if;

  -- Lo que el conductor marcó queda como evidencia.
  if (old.recogido_en is not null and (new.recogido_en is distinct from old.recogido_en or new.recogido_por is distinct from old.recogido_por))
     or (old.dejado_en is not null and (new.dejado_en is distinct from old.dejado_en or new.dejado_por is distinct from old.dejado_por))
     or (old.en_recojo_en is not null and (new.en_recojo_en is distinct from old.en_recojo_en or new.en_recojo_por is distinct from old.en_recojo_por))
     or (old.recojo_pedido_en is not null and new.recojo_pedido_en is distinct from old.recojo_pedido_en) then
    raise exception 'El recojo de la compra % ya quedó registrado y no se corrige.', coalesce(new.numero, new.referencia)
      using errcode = 'check_violation';
  end if;

  -- Mientras está con el conductor, la entrega a Almacén la marca él al dejarla.
  if new.entregado_almacen_en is not null and old.entregado_almacen_en is null
     and new.recojo in ('POR_RECOGER', 'EN_RECOJO', 'RECOGIDO') then
    raise exception 'La compra % está con el conductor: la entrega a Almacén se marca cuando él la deja.',
      coalesce(new.numero, new.referencia) using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_compra_pagada_total_fijo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_compra  uuid;
  v_nombre  text;
  v_moneda  text;
  v_antes   numeric;
  v_despues numeric;
  v_total   numeric;
  v_neto    numeric;
  v_mon     text;
begin
  if tg_op = 'UPDATE' and (new.orden_compra_id, new.cantidad, new.precio_unitario)
                          is not distinct from (old.orden_compra_id, old.cantidad, old.precio_unitario) then
    return new;
  end if;
  foreach v_compra in array case tg_op when 'INSERT' then array[new.orden_compra_id]
                                       when 'DELETE' then array[old.orden_compra_id]
                                       else array[new.orden_compra_id, old.orden_compra_id] end loop
    continue when not exists (select 1 from public.pagos_orden_compra p where p.orden_compra_id = v_compra and p.anulado_en is null);
    continue when current_setting('metalwork.anulando_oc', true) = v_compra::text;
    select coalesce(c.numero, 'OC ' || c.referencia), c.moneda into v_nombre, v_moneda
      from public.ordenes_compra_materiales c where c.id = v_compra;
    -- Lo que esta línea le pone a esa OC, antes y después.
    v_antes := case when tg_op <> 'INSERT' and old.orden_compra_id = v_compra
                    then round(old.cantidad::numeric * coalesce(old.precio_unitario, 0), 2) else 0 end;
    v_despues := case when tg_op <> 'DELETE' and new.orden_compra_id = v_compra
                      then round(new.cantidad::numeric * coalesce(new.precio_unitario, 0), 2) else 0 end;
    if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.orden_compra_id is distinct from old.orden_compra_id) or v_despues > v_antes then
      raise exception 'Tesorería ya le registró un pago a la %: su total puede bajar, pero no subir. Si ese pago no salió o se registró mal, Tesorería lo anula primero, con su motivo.',
        v_nombre using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.facturas_de_la_compra(v_compra))
       or exists (select 1 from public.comprobante_en_camino(v_compra) e where e.origen is not null) then
      raise exception 'Tesorería ya le registró un pago a la % y el proveedor ya entregó su factura: su total no cambia, lo dice la factura. Si ese pago no salió o se registró mal, Tesorería lo anula primero, con su motivo.',
        v_nombre using errcode = 'check_violation';
    end if;
    v_total := public.total_orden_compra(v_compra) - v_antes + v_despues;
    v_neto := coalesce((select sum(p.monto) from public.pagos_orden_compra p where p.orden_compra_id = v_compra and p.anulado_en is null), 0)
            - coalesce((select sum(d.monto) from public.devoluciones_orden_compra d where d.orden_compra_id = v_compra and d.anulado_en is null), 0);
    if v_neto <= 0 and v_total <= 0 then
      raise exception 'El proveedor le devolvió a Tesorería todo lo pagado por la %: su total puede bajar, pero no a cero.',
        v_nombre using errcode = 'check_violation';
    end if;
    if v_total < v_neto then
      v_mon := case when v_moneda = 'USD' then 'US$ ' else 'S/ ' end;
      raise exception 'Tesorería ya le pagó % a la %: su total no baja de eso. Si el proveedor cobró de más o entregó menos, Tesorería registra primero lo que devuelva y después se corrige la OC.',
        v_mon || to_char(v_neto, 'FM999G999G990D00'), v_nombre using errcode = 'check_violation';
    end if;
  end loop;
  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_recepcion_exige_aprobacion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_compra public.ordenes_compra_materiales%rowtype;
begin
  if new.orden_compra_detalle_id is null then
    return new;
  end if;
  select c.* into v_compra
    from public.orden_compra_material_detalles d
    join public.ordenes_compra_materiales c on c.id = d.orden_compra_id
   where d.id = new.orden_compra_detalle_id;
  if found and v_compra.aprobacion in ('POR_APROBAR', 'RECHAZADA', 'ANULADA') then
    raise exception '%', public.mensaje_compra_sin_aprobar(v_compra) using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_adquisicion_oc_valida()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_adq   public.adquisiciones%rowtype;
  v_oc    public.ordenes_compra_materiales%rowtype;
  v_base  public.ordenes_compra_materiales%rowtype;
  v_otra  text;
begin
  select * into v_adq from public.adquisiciones where id = new.adquisicion_id;
  if not found or (v_adq.estado <> 'BORRADOR' and current_setting('metalwork.corrigiendo', true) is distinct from 'factura') then
    raise exception 'Las OC de una factura se eligen al registrarla; registrada, ya no cambian sin una corrección con su justificante.' using errcode = 'check_violation';
  end if;
  select * into v_oc from public.ordenes_compra_materiales where id = new.orden_compra_id;
  if not found then raise exception 'Esa orden de compra no existe.' using errcode = 'check_violation'; end if;
  if v_oc.aprobacion = 'RECHAZADA' then
    raise exception 'La orden de compra % está rechazada: no se factura.', coalesce(v_oc.numero, v_oc.referencia) using errcode = 'check_violation';
  end if;
  if v_oc.aprobacion = 'ANULADA' then
    raise exception 'La orden de compra % está anulada: no se factura.', coalesce(v_oc.numero, v_oc.referencia) using errcode = 'check_violation';
  end if;
  if v_oc.condicion_pago <> v_adq.condicion_pago then
    raise exception 'La orden de compra % es al %: la factura tiene que ir igual.', coalesce(v_oc.numero, v_oc.referencia),
      case when v_oc.condicion_pago = 'CREDITO' then 'crédito' else 'contado' end using errcode = 'check_violation';
  end if;
  if v_adq.orden_compra_id is not null and v_adq.orden_compra_id <> new.orden_compra_id then
    select * into v_base from public.ordenes_compra_materiales where id = v_adq.orden_compra_id;
    if coalesce(v_base.proveedor_id::text, upper(btrim(v_base.proveedor)))
       is distinct from coalesce(v_oc.proveedor_id::text, upper(btrim(v_oc.proveedor))) then
      raise exception 'Una factura es de un solo proveedor: la orden de compra % es de %.', coalesce(v_oc.numero, v_oc.referencia), v_oc.proveedor
        using errcode = 'check_violation';
    end if;
  end if;
  select a.numero_documento into v_otra
    from public.adquisiciones_ordenes_compra l join public.adquisiciones a on a.id = l.adquisicion_id
   where l.orden_compra_id = new.orden_compra_id and l.adquisicion_id <> new.adquisicion_id
     and l.quitada_en is null and not l.parcial and a.estado = 'REGISTRADA'
   limit 1;
  if v_otra is not null then
    raise exception 'La orden de compra % ya tiene su factura completa (%): si esta es otra parte, corrige aquella y márcala como parcial.',
      coalesce(v_oc.numero, v_oc.referencia), v_otra using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.corregir_orden_compra(p_correccion uuid, p_id uuid, p_motivo text, p_justificante text, p_nombre text, p_cambios jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_oc      public.ordenes_compra_materiales%rowtype;
  v_antes   jsonb;
  v_despues jsonb;
  v_x       jsonb;
  v_det     public.orden_compra_material_detalles%rowtype;
  v_cant    numeric;
  v_precio  numeric;
  v_factura boolean;
  v_codigo  text;
  v_tiene_precio boolean;
  v_por_insumo boolean;
begin
  perform public.exigir_permiso('compras.crear');
  select * into v_oc from public.ordenes_compra_materiales where id = p_id for update;
  if not found then raise exception 'La compra no existe.'; end if;
  if exists (select 1 from public.correcciones where id = p_correccion and documento_id = p_id) then
    return p_id;
  end if;
  if v_oc.aprobacion = 'RECHAZADA' then
    raise exception 'La orden % está rechazada: no se corrige. Genera otra.', coalesce(v_oc.numero, v_oc.referencia)
      using errcode = 'check_violation';
  end if;
  if v_oc.aprobacion = 'ANULADA' then
    raise exception 'La orden % está anulada: queda como evidencia y no se corrige. Genera otra.', coalesce(v_oc.numero, v_oc.referencia)
      using errcode = 'check_violation';
  end if;
  if p_cambios is null or jsonb_typeof(p_cambios) <> 'object' then
    raise exception 'Vuelve a cargar la pantalla.' using errcode = 'check_violation';
  end if;

  v_antes := jsonb_build_object('con_factura', v_oc.con_factura, 'codigo_interno', v_oc.codigo_interno, 'lineas',
    (select coalesce(jsonb_agg(jsonb_build_object('detalle_id', d.id, 'material_id', d.material_id, 'cantidad', d.cantidad,
                                                  'precio_unitario', d.precio_unitario) order by d.creado_en, d.id), '[]'::jsonb)
       from public.orden_compra_material_detalles d where d.orden_compra_id = p_id));

  v_factura := coalesce((p_cambios->>'con_factura')::boolean, v_oc.con_factura);
  v_codigo := coalesce(btrim(p_cambios->>'codigo_interno'), v_oc.codigo_interno);
  v_por_insumo := exists (select 1 from public.requerimiento_lineas rl
                            join public.orden_compra_material_detalles d on d.id = rl.orden_compra_detalle_id
                           where d.orden_compra_id = p_id);
  if v_por_insumo then
    if v_codigo is distinct from v_oc.codigo_interno then
      raise exception 'Cada insumo de la % lleva el código interno de su requerimiento: si está mal, corrige el requerimiento.',
        coalesce(v_oc.numero, v_oc.referencia) using errcode = 'check_violation';
    end if;
    if v_factura is null then
      raise exception 'Indica si la compra viene con factura o sin factura.' using errcode = 'check_violation';
    end if;
  else
    perform public.validar_datos_de_compra(v_factura, v_codigo);
  end if;
  if v_factura is distinct from v_oc.con_factura and public.compra_tiene_comprobante(v_oc) then
    raise exception 'La compra % ya tiene su comprobante adjunto: ya no se cambia si viene con factura.',
      coalesce(v_oc.numero, v_oc.referencia) using errcode = 'check_violation';
  end if;
  update public.ordenes_compra_materiales set con_factura = v_factura, codigo_interno = v_codigo
   where id = p_id and (con_factura is distinct from v_factura or codigo_interno is distinct from v_codigo);

  for v_x in select value from jsonb_array_elements(coalesce(p_cambios->'lineas', '[]'::jsonb)) loop
    begin
      select * into v_det from public.orden_compra_material_detalles
       where id = (v_x->>'detalle_id')::uuid and orden_compra_id = p_id for update;
      v_cant := nullif(v_x->>'cantidad', '')::numeric;
      v_tiene_precio := v_x ? 'precio_unitario';
      v_precio := nullif(v_x->>'precio_unitario', '')::numeric;
    exception when others then
      raise exception 'Revisa las líneas que corriges.' using errcode = 'check_violation';
    end;
    if v_det.id is null then
      raise exception 'Esa línea no es de esta orden. Recarga la pantalla.' using errcode = 'check_violation';
    end if;
    if (v_cant is not null and v_cant is distinct from v_det.cantidad)
       or (v_tiene_precio and v_precio is distinct from v_det.precio_unitario) then
      if exists (select 1 from public.movimientos_materiales m where m.orden_compra_detalle_id = v_det.id) then
        raise exception 'Una línea de la % ya entró al almacén: su cantidad y su precio quedaron en el kardex.',
          coalesce(v_oc.numero, v_oc.referencia) using errcode = 'check_violation';
      end if;
      if v_cant is not null and (v_cant <= 0 or v_cant > 999999999 or v_cant <> round(v_cant, 3)) then
        raise exception 'Cada cantidad debe ser mayor que cero, con hasta tres decimales.' using errcode = 'check_violation';
      end if;
      if v_tiene_precio and (v_precio is null or v_precio < 0 or v_precio > 999999999 or v_precio <> round(v_precio, 2)) then
        raise exception 'Cada precio va en soles o dólares sin IGV, de 0 en adelante, con hasta dos decimales.' using errcode = 'check_violation';
      end if;
      update public.orden_compra_material_detalles
         set cantidad = coalesce(v_cant, cantidad),
             precio_unitario = case when v_tiene_precio then v_precio else precio_unitario end
       where id = v_det.id;
    end if;
    v_det := null;
  end loop;

  select * into v_oc from public.ordenes_compra_materiales where id = p_id;
  v_despues := jsonb_build_object('con_factura', v_oc.con_factura, 'codigo_interno', v_oc.codigo_interno, 'lineas',
    (select coalesce(jsonb_agg(jsonb_build_object('detalle_id', d.id, 'material_id', d.material_id, 'cantidad', d.cantidad,
                                                  'precio_unitario', d.precio_unitario) order by d.creado_en, d.id), '[]'::jsonb)
       from public.orden_compra_material_detalles d where d.orden_compra_id = p_id));
  perform public.registrar_correccion(p_correccion, 'ORDEN_COMPRA', p_id, coalesce(v_oc.numero, v_oc.referencia), p_motivo,
                                      p_justificante, p_nombre, v_antes, v_despues);
  return p_id;
end $function$;

CREATE OR REPLACE FUNCTION public.evaluar_aprobacion_compra(p_compra uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_compra  public.ordenes_compra_materiales%rowtype;
  v_regla   public.regla_aprobacion_compras%rowtype;
  v_total   numeric;
  v_tc      numeric;
  v_pen     numeric;
  v_directa boolean;
  v_de_rq   boolean;
begin
  select * into v_compra from public.ordenes_compra_materiales where id = p_compra for update;
  if not found or v_compra.aprobacion in ('RECHAZADA', 'ANULADA') then
    return v_compra.aprobacion;
  end if;
  v_directa := v_compra.origen = 'DIRECTA';
  v_de_rq := v_compra.origen = 'REQUERIMIENTO'
             or exists (select 1 from public.requerimiento_lineas rl where rl.orden_compra_id = p_compra);
  select * into v_regla from public.regla_aprobacion_compras where unica;

  select coalesce(sum(cantidad * coalesce(precio_unitario, 0)), 0) into v_total
    from public.orden_compra_material_detalles where orden_compra_id = p_compra;
  if v_compra.moneda = 'USD' then
    v_tc := public.tipo_cambio_venta(current_date);
    v_pen := case when v_tc is null then null else round(v_total * v_tc, 2) end;
  else
    v_pen := round(v_total, 2);
  end if;

  update public.ordenes_compra_materiales set monto_pen = v_pen where id = p_compra;

  if not coalesce(v_regla.activa, false) and not v_directa then
    return v_compra.aprobacion;
  end if;
  if v_compra.aprobacion = 'APROBADA' and v_pen is not null and v_pen <= v_compra.monto_aprobado_pen then
    return 'APROBADA';
  end if;
  if v_compra.aprobacion = 'NO_REQUERIDA' and v_compra.entregado_almacen_en is not null then
    return 'NO_REQUERIDA';
  end if;
  if not v_directa and v_pen is not null and v_pen < v_regla.monto_desde then
    return v_compra.aprobacion;
  end if;
  if v_compra.aprobacion = 'POR_APROBAR' then
    return 'POR_APROBAR';
  end if;

  update public.ordenes_compra_materiales
     set aprobacion = 'POR_APROBAR', aprobacion_pedida_en = now(),
         aprobado_por = null, aprobado_en = null
   where id = p_compra;

  insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
  select u.id,
         'Compra por aprobar: ' || coalesce(v_compra.numero, v_compra.referencia),
         v_compra.proveedor || ' · ' || coalesce('S/ ' || to_char(v_pen, 'FM999G999G990D00'), v_compra.moneda || ' sin tipo de cambio')
           || case when v_directa and not v_de_rq then ' · Directa, sin requerimiento' else '' end,
         '/compras/aprobacion', 'ordenes_compra_materiales', p_compra
    from public.usuarios u
   where u.activo and u.rol_id = v_regla.rol_aprobador_id
     and u.id is distinct from v_compra.creado_por;
  return 'POR_APROBAR';
end;
$function$;

CREATE OR REPLACE FUNCTION public.mensaje_compra_sin_aprobar(p_compra ordenes_compra_materiales)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case p_compra.aprobacion
    when 'POR_APROBAR' then 'La compra ' || coalesce(p_compra.numero, p_compra.referencia, 'sin número') || ' espera la aprobación de '
         || coalesce((select r.nombre from public.regla_aprobacion_compras g join public.roles r on r.id = g.rol_aprobador_id where g.unica), 'Gerencia')
         || '. Se entrega y se recibe cuando esté aprobada.'
    when 'ANULADA' then 'La compra ' || coalesce(p_compra.numero, p_compra.referencia, 'sin número') || ' está anulada: ' || coalesce(p_compra.motivo_anulacion, '')
    when 'RECHAZADA' then 'La compra ' || coalesce(p_compra.numero, p_compra.referencia, 'sin número') || ' fue rechazada: ' || coalesce(p_compra.motivo_rechazo, '')
         || '. Emite una nueva orden con las líneas pendientes.'
  end;
$function$;

CREATE OR REPLACE FUNCTION public.avance_de_requerimientos(p_ids uuid[])
 RETURNS TABLE(requerimiento_id uuid, porcentaje integer, etapa text, lineas jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
begin
  if not public.puede_ver_requerimientos() then
    raise exception 'No tienes permiso para ver los requerimientos.' using errcode = 'insufficient_privilege';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return;
  end if;
  if cardinality(p_ids) > 500 then
    raise exception 'Pide el avance de hasta 500 requerimientos a la vez.' using errcode = 'check_violation';
  end if;

  return query
  with etapas (codigo, pct, orden) as (
    values ('POR_REVISAR', 10, 1), ('POR_COMPRAR', 20, 2), ('OC_POR_APROBAR', 30, 3),
           ('PENDIENTE_RECOJO', 45, 4), ('EN_RECOJO', 60, 5), ('RECOGIDO', 70, 6),
           ('OBSERVADO', 80, 7), ('POR_VALIDAR', 80, 8), ('EN_KARDEX', 85, 9), ('EN_STOCK', 85, 9),
           ('LISTO_EN_ALMACEN', 90, 10), ('ENTREGADO', 100, 11)
  ),
  validacion as (
    select i.orden_compra_id as compra,
           case when bool_or(i.estado = 'PENDIENTE') then 'PENDIENTE'
                when bool_or(i.estado = 'OBSERVADO') then 'OBSERVADO'
                else 'VALIDADO' end as estado
      from public.ingresos_pendientes_almacen i
     where i.orden_compra_id in (select rl.orden_compra_id from public.requerimiento_lineas rl
                                  where rl.requerimiento_id = any(p_ids) and rl.orden_compra_id is not null)
     group by i.orden_compra_id
  ),
  por_linea as (
    select r.id as rq, l.item as item,
           coalesce(c.numero, c.referencia) as compra,
           coalesce(c.aprobacion in ('RECHAZADA', 'ANULADA'), false) as rechazada,
           coalesce(c.aprobacion = 'ANULADA', false) as anulada,
           l.cantidad_en_stock as en_stock,
           case when l.cantidad_en_stock is not null then greatest(l.cantidad - l.cantidad_en_stock, 0) end as por_comprar,
           case
             when r.estado = 'ENTREGADO' then 'ENTREGADO'
             when r.estado = 'LISTO_EN_ALMACEN' then 'LISTO_EN_ALMACEN'
             when r.estado = 'POR_ATENDER' then 'POR_REVISAR'
             when l.cantidad_en_stock is not null and l.cantidad_en_stock >= l.cantidad then 'EN_STOCK'
             when c.id is null or c.aprobacion in ('RECHAZADA', 'ANULADA') then 'POR_COMPRAR'
             when c.aprobacion = 'POR_APROBAR' then 'OC_POR_APROBAR'
             when c.recojo = 'DEJADO' or (c.recojo is null and c.entregado_almacen_en is not null) then
               case v.estado when 'VALIDADO' then 'EN_KARDEX' when 'OBSERVADO' then 'OBSERVADO' else 'POR_VALIDAR' end
             when c.recojo = 'RECOGIDO' then 'RECOGIDO'
             when c.recojo = 'EN_RECOJO' then 'EN_RECOJO'
             else 'PENDIENTE_RECOJO'
           end as paso,
           case
             when r.estado in ('ENTREGADO', 'LISTO_EN_ALMACEN', 'POR_ATENDER') or c.aprobacion in ('RECHAZADA', 'ANULADA') then null
             when l.cantidad_en_stock is not null and l.cantidad_en_stock >= l.cantidad then l.stock_revisado_en
             when c.recojo = 'DEJADO' then c.dejado_en
             when c.recojo = 'RECOGIDO' then c.recogido_en
             when c.recojo = 'EN_RECOJO' then c.en_recojo_en
             when c.recojo = 'POR_RECOGER' then c.recojo_pedido_en
           end as desde
      from public.requerimientos r
      join public.requerimiento_lineas l on l.requerimiento_id = r.id
      left join public.ordenes_compra_materiales c on c.id = l.orden_compra_id
      left join validacion v on v.compra = c.id
     where r.id = any(p_ids) and r.estado <> 'ANULADO'
  )
  select p.rq,
         round(avg(e.pct))::integer,
         (array_agg(p.paso order by e.orden, p.item))[1],
         jsonb_agg(jsonb_build_object('item', p.item, 'orden_compra', p.compra, 'rechazada', p.rechazada, 'anulada', p.anulada,
                                      'etapa', p.paso, 'porcentaje', e.pct, 'desde', p.desde,
                                      'en_stock', p.en_stock, 'por_comprar', p.por_comprar) order by p.item)
    from por_linea p
    join etapas e on e.codigo = p.paso
   group by p.rq;
end;
$function$;

CREATE OR REPLACE FUNCTION public.codigo_interno_lineas(p_codigo text, p_mano_obra boolean)
 RETURNS TABLE(codigo text, fuente text, fecha date, concepto text, detalle text, cantidad numeric, unidad text, horas numeric, precio_unitario numeric, moneda text, monto numeric, sin_precio integer, documento text, referencia_id uuid)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
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
     where c.aprobacion not in ('RECHAZADA', 'ANULADA')
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
$function$;

CREATE OR REPLACE FUNCTION public.codigo_interno_materiales_comparados(p_codigo text)
 RETURNS TABLE(material_id uuid, material_codigo text, material text, unidad text, disenado numeric, comprado numeric, salido numeric, en_la_lista boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  v_codigo text := public.normalizar_codigo_interno(p_codigo);
begin
  perform public.exigir_ver_codigos_de_diseno();
  if v_codigo is null then
    return;
  end if;
  return query
  with lista as (
    select m.material_id, sum(m.cantidad) as cantidad
      from public.codigo_materiales m
     where m.codigo_interno = v_codigo and m.quitado_en is null
     group by m.material_id
  ), compra as (
    select d.material_id, sum(d.cantidad) as cantidad
      from public.ordenes_compra_materiales c
      join public.orden_compra_material_detalles d on d.orden_compra_id = c.id
     where public.normalizar_codigo_interno(c.codigo_interno) = v_codigo and c.aprobacion not in ('RECHAZADA', 'ANULADA')
       and d.material_id is not null
     group by d.material_id
  ), salida as (
    select mv.material_id, sum(l.cantidad) as cantidad
      from public.codigo_interno_lineas(v_codigo, false) l
      join public.movimientos_materiales mv on mv.id = l.referencia_id
     where l.fuente in ('MATERIALES', 'MATERIALES_SIN_PRECIO')
     group by mv.material_id
  ), todos as (
    select x.material_id from lista x union select c.material_id from compra c union select s.material_id from salida s
  )
  select t.material_id, mat.codigo::text, mat.descripcion::text, um.codigo::text,
         l.cantidad, coalesce(c.cantidad, 0), coalesce(s.cantidad, 0), l.material_id is not null
    from todos t
    join public.materiales mat on mat.id = t.material_id
    left join public.unidades_medida um on um.id = mat.unidad_medida_id
    left join lista l on l.material_id = t.material_id
    left join compra c on c.material_id = t.material_id
    left join salida s on s.material_id = t.material_id
   order by (l.material_id is null), mat.descripcion;
end;
$function$;

CREATE OR REPLACE FUNCTION public.codigos_internos_de_diseno()
 RETURNS TABLE(codigo text, unidad text, planos integer, planos_por_recibir integer, materiales integer, etapas integer, etapas_terminadas integer, etapas_vencidas integer, etapa_actual text, etapa_actual_area text, etapa_actual_fin date, ultimo_cambio timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  v_hoy date := (now() at time zone 'America/Lima')::date;
begin
  if public.usuario_actual() is not null
     and not (public.es_admin() or public.tiene_permiso('diseno.codigos') or public.tiene_permiso('codigos_internos.ver')
              or public.tiene_permiso('codigos_internos.seguimiento')) then
    raise exception 'No tienes permiso para ver los códigos internos de Diseño.' using errcode = 'insufficient_privilege';
  end if;
  return query
  with conocido as (
    select public.normalizar_codigo_interno(u.codigo_interno) as codigo from public.unidades u where u.activo and u.codigo_interno is not null
    union select public.normalizar_codigo_interno(r.codigo_interno) from public.requerimientos r where r.estado <> 'ANULADO'
    union select public.normalizar_codigo_interno(c.codigo_interno) from public.ordenes_compra_materiales c
           where c.codigo_interno is not null and c.aprobacion not in ('RECHAZADA', 'ANULADA')
    union select public.normalizar_codigo_interno(s.codigo_interno) from public.ordenes_servicio s
           where s.codigo_interno is not null and s.estado <> 'ANULADA'
    union select public.normalizar_codigo_interno(d.codigo_interno) from public.reportes_diarios d where d.anulado_en is null
    union select public.normalizar_codigo_interno(v.codigo_interno) from public.registro_vehiculos v
           where v.codigo_interno is not null and v.anulado_en is null
    union select p.codigo_interno from public.codigo_planos p
    union select m.codigo_interno from public.codigo_materiales m where m.quitado_en is null
    union select e.codigo_interno from public.codigo_etapas e where e.quitada_en is null
  ), unidad as (
    select public.normalizar_codigo_interno(u.codigo_interno) as codigo,
           string_agg(distinct nullif(concat_ws(' · ', nullif(btrim(u.placa), ''), nullif(btrim(concat_ws(' ', u.marca, u.modelo)), '')), ''), ', ') as texto
      from public.unidades u where u.codigo_interno is not null group by 1
  ), plano as (
    select p.codigo_interno as codigo, count(*)::integer as planos,
           count(*) filter (where r.recibido_en is null)::integer as por_recibir,
           max(greatest(p.actualizado_en, r.subido_en, r.recibido_en)) as cambio
      from public.codigo_planos p
      left join lateral (select x.* from public.codigo_plano_revisiones x where x.plano_id = p.id order by x.revision desc limit 1) r on true
     where p.anulado_en is null
     group by p.codigo_interno
  ), material as (
    select m.codigo_interno as codigo, count(*)::integer as materiales, max(m.actualizado_en) as cambio
      from public.codigo_materiales m where m.quitado_en is null group by m.codigo_interno
  ), etapa as (
    select e.codigo_interno as codigo, count(*)::integer as etapas,
           count(*) filter (where e.fin_real is not null)::integer as terminadas,
           count(*) filter (where e.fin_real is null and e.fin_plan < v_hoy)::integer as vencidas,
           max(e.actualizado_en) as cambio
      from public.codigo_etapas e where e.quitada_en is null group by e.codigo_interno
  ), actual as (
    select distinct on (e.codigo_interno) e.codigo_interno as codigo, e.nombre, a.nombre as area, e.fin_plan
      from public.codigo_etapas e
      left join public.areas a on a.id = e.area_id
     where e.quitada_en is null and e.fin_real is null
     order by e.codigo_interno, e.orden
  )
  select c.codigo, u.texto, coalesce(p.planos, 0), coalesce(p.por_recibir, 0), coalesce(m.materiales, 0),
         coalesce(e.etapas, 0), coalesce(e.terminadas, 0), coalesce(e.vencidas, 0), ac.nombre::text, ac.area::text, ac.fin_plan,
         nullif(greatest(coalesce(p.cambio, '-infinity'), coalesce(m.cambio, '-infinity'), coalesce(e.cambio, '-infinity')), '-infinity')
    from conocido c
    left join unidad u on u.codigo = c.codigo
    left join plano p on p.codigo = c.codigo
    left join material m on m.codigo = c.codigo
    left join etapa e on e.codigo = c.codigo
    left join actual ac on ac.codigo = c.codigo
   where c.codigo is not null and c.codigo <> 'PLANTA'
   order by 12 desc nulls last, 1;
end;
$function$;

CREATE OR REPLACE FUNCTION public.codigos_internos_para_elegir()
 RETURNS TABLE(codigo text, unidad text, cerrado boolean, registrada boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
begin
  if not (public.es_admin() or public.tiene_permiso('requerimientos.emitir')
          or public.tiene_permiso('requerimientos.administracion') or public.tiene_permiso('tesoreria.caja')
          or public.tiene_permiso('rrhh.personal') or public.tiene_permiso('reporte_diario.registrar')
          or public.tiene_permiso('compras.crear') or public.tiene_permiso('subcontratos.gestionar')
          or public.tiene_permiso('almacen.despachar')) then
    raise exception 'No tienes permiso para ver la lista de códigos internos.' using errcode = 'insufficient_privilege';
  end if;
  return query
  with conocido as (
    -- Los mismos que conoce Diseño (`codigos_internos_de_diseno`), más las horas
    -- de RR. HH., los subcontratos, las salidas del almacén y la caja con su código.
    select public.normalizar_codigo_interno(u.codigo_interno) as codigo from public.unidades u where u.activo and u.codigo_interno is not null
    union select public.normalizar_codigo_interno(r.codigo_interno) from public.requerimientos r where r.estado <> 'ANULADO'
    union select public.normalizar_codigo_interno(c.codigo_interno) from public.ordenes_compra_materiales c
           where c.codigo_interno is not null and c.aprobacion not in ('RECHAZADA', 'ANULADA')
    union select public.normalizar_codigo_interno(s.codigo_interno) from public.ordenes_servicio s
           where s.codigo_interno is not null and s.estado <> 'ANULADA'
    union select public.normalizar_codigo_interno(d.codigo_interno) from public.reportes_diarios d where d.anulado_en is null
    union select public.normalizar_codigo_interno(v.codigo_interno) from public.registro_vehiculos v
           where v.codigo_interno is not null and v.anulado_en is null
    union select public.normalizar_codigo_interno(t.codigo_interno) from public.tareos t where t.anulado_en is null
    union select public.normalizar_codigo_interno(x.codigo_interno) from public.subcontratos x where x.estado <> 'ANULADO'
    union select public.normalizar_codigo_interno(m.codigo_interno) from public.movimientos_materiales m
           where m.codigo_interno is not null and m.tipo in ('SALIDA', 'DESPACHO')
    union select p.codigo_interno from public.codigo_planos p where p.anulado_en is null
    union select e.codigo_interno from public.codigo_etapas e where e.quitada_en is null
    union select public.normalizar_codigo_interno(k.codigo_interno) from public.movimientos_caja k where k.codigo_interno is not null and k.anulado_en is null
  ), unidad as (
    -- Como en Diseño: la placa y la marca y modelo de la unidad.
    select public.normalizar_codigo_interno(u.codigo_interno) as codigo,
           string_agg(distinct nullif(concat_ws(' · ', nullif(btrim(u.placa), ''), nullif(btrim(concat_ws(' ', u.marca, u.modelo)), '')), ''), ', ') as texto,
           bool_or(u.activo) as activa
      from public.unidades u where u.codigo_interno is not null group by 1
  ), porteria as (
    -- La que no está en Unidades, por lo que anotó la portería la última vez que entró.
    select distinct on (public.normalizar_codigo_interno(v.codigo_interno))
           public.normalizar_codigo_interno(v.codigo_interno) as codigo,
           nullif(concat_ws(' · ', nullif(btrim(v.placa), ''), nullif(btrim(v.unidad), '')), '') as texto
      from public.registro_vehiculos v
     where v.codigo_interno is not null and v.anulado_en is null
     order by public.normalizar_codigo_interno(v.codigo_interno), v.ingreso_en desc
  )
  select c.codigo, coalesce(u.texto, p.texto),
         exists (select 1 from public.codigo_interno_cierres k where k.codigo = c.codigo and k.reabierto_en is null),
         coalesce(u.activa, false)
    from conocido c
    left join unidad u on u.codigo = c.codigo
    left join porteria p on p.codigo = c.codigo
   where c.codigo is not null and char_length(c.codigo) between 2 and 60 and c.codigo <> 'TODOS LOS ACTIVOS'
   order by c.codigo;
end;
$function$;

CREATE OR REPLACE FUNCTION public.corregir_requerimiento(p_correccion uuid, p_id uuid, p_motivo text, p_justificante text, p_nombre text, p_cambios jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rq       public.requerimientos%rowtype;
  v_hoy      date := (now() at time zone 'America/Lima')::date;
  v_antes    jsonb;
  v_despues  jsonb;
  v_x        jsonb;
  v_linea    public.requerimiento_lineas%rowtype;
  v_material public.materiales%rowtype;
  v_cant     numeric;
  v_mat      uuid;
  v_codigo   text;
  v_just     text;
  v_fecha    date;
  v_oc       text;
  v_cargado  text;
begin
  select * into v_rq from public.requerimientos where id = p_id for update;
  if not found then raise exception 'El requerimiento no existe.'; end if;
  perform public.rq_exigir(v_rq.tipo, 'CORREGIR');
  if exists (select 1 from public.correcciones where id = p_correccion and documento_id = p_id) then
    return p_id;  -- un reintento de la misma corrección
  end if;
  if v_rq.estado in ('ENTREGADO', 'ANULADO') then
    raise exception 'El requerimiento % ya está %: queda como evidencia.', v_rq.numero,
      case v_rq.estado when 'ENTREGADO' then 'entregado' else 'anulado' end using errcode = 'check_violation';
  end if;
  if p_cambios is null or jsonb_typeof(p_cambios) <> 'object' then
    raise exception 'Vuelve a cargar la pantalla.' using errcode = 'check_violation';
  end if;

  v_antes := jsonb_build_object('codigo_interno', v_rq.codigo_interno, 'justificacion', v_rq.justificacion,
                                'fecha_requerida', v_rq.fecha_requerida, 'lineas',
    (select coalesce(jsonb_agg(jsonb_build_object('item', l.item, 'descripcion', l.descripcion, 'cantidad', l.cantidad,
                                                  'material_id', l.material_id) order by l.item), '[]'::jsonb)
       from public.requerimiento_lineas l where l.requerimiento_id = p_id));

  v_codigo := coalesce(btrim(p_cambios->>'codigo_interno'), v_rq.codigo_interno);
  v_just := coalesce(btrim(p_cambios->>'justificacion'), v_rq.justificacion);
  begin
    v_fecha := case when p_cambios ? 'fecha_requerida' then nullif(p_cambios->>'fecha_requerida', '')::date else v_rq.fecha_requerida end;
  exception when others then
    raise exception 'Revisa la fecha en que se necesita.' using errcode = 'check_violation';
  end;
  if char_length(v_codigo) not between 2 and 60 then
    raise exception 'Escribe el código interno de la unidad (de 2 a 60 caracteres). Si no es para una unidad, escribe PLANTA u OFICINA.'
      using errcode = 'check_violation';
  end if;
  -- Lo que salió del kardex con el RQ y no volvió quedó cargado al código de su
  -- salida: pasar el RQ a otro código dejaba el costo de lo que salió en uno y
  -- lo que falta en otro. Juntar espacios o pasar a mayúsculas sí se puede: es
  -- el mismo código. Lo que volvió entero ya no está cargado a nadie (como al
  -- anular), y un RQ de PLANTA cuya salida fue a una unidad sí puede pasar al
  -- código de esa unidad: es donde quedó el costo.
  if public.normalizar_codigo_interno(v_codigo) is distinct from public.normalizar_codigo_interno(v_rq.codigo_interno) then
    select min(m.codigo_interno) into v_cargado
      from public.movimientos_materiales m
      join public.requerimiento_lineas l on l.id = m.requerimiento_linea_id
     where l.requerimiento_id = p_id and m.tipo = 'SALIDA' and m.codigo_interno is not null
       and public.normalizar_codigo_interno(m.codigo_interno) is distinct from public.normalizar_codigo_interno(v_codigo)
       and m.cantidad > coalesce((select sum(d.cantidad) from public.movimientos_materiales d
                                   where d.devolucion_de = m.id and d.tipo = 'INGRESO'), 0);
    if v_cargado is not null then
      raise exception 'Del requerimiento % ya salió material del kardex para %: el código interno ya no cambia. Si lo que falta es para otra unidad, registra otro requerimiento.',
        v_rq.numero, v_cargado using errcode = 'check_violation';
    end if;
  end if;
  if char_length(v_just) not between 10 and 1000 then
    raise exception 'La justificación va de 10 a 1000 caracteres.' using errcode = 'check_violation';
  end if;
  if v_fecha is distinct from v_rq.fecha_requerida and v_fecha < v_hoy then
    raise exception 'La fecha en que se necesita no puede ser anterior a hoy.' using errcode = 'check_violation';
  end if;

  perform set_config('metalwork.corrigiendo', 'requerimiento', true);
  update public.requerimientos set codigo_interno = v_codigo, justificacion = v_just, fecha_requerida = v_fecha
   where id = p_id
     and row(codigo_interno, justificacion, fecha_requerida) is distinct from row(v_codigo, v_just, v_fecha);

  for v_x in select value from jsonb_array_elements(coalesce(p_cambios->'lineas', '[]'::jsonb)) loop
    begin
      select * into v_linea from public.requerimiento_lineas
       where requerimiento_id = p_id and item = (v_x->>'item')::int for update;
      v_cant := nullif(v_x->>'cantidad', '')::numeric;
      v_mat := nullif(v_x->>'material_id', '')::uuid;
    exception when others then
      raise exception 'Revisa los insumos que corriges.' using errcode = 'check_violation';
    end;
    if v_linea.id is null then
      raise exception 'Ese insumo no es de este requerimiento. Recarga la pantalla.' using errcode = 'check_violation';
    end if;
    if v_linea.orden_compra_id is not null then
      select coalesce(c.numero, c.referencia) into v_oc from public.ordenes_compra_materiales c
       where c.id = v_linea.orden_compra_id and c.aprobacion not in ('RECHAZADA', 'ANULADA');
      if v_oc is not null then
        raise exception 'El insumo % ya va en la %: corrige la orden de compra.', v_linea.item, v_oc using errcode = 'check_violation';
      end if;
    end if;
    if exists (select 1 from public.movimientos_materiales m where m.requerimiento_linea_id = v_linea.id) then
      raise exception 'Del insumo % ya salió material del almacén: lo que salió queda en el kardex.', v_linea.item
        using errcode = 'check_violation';
    end if;
    if v_cant is not null and (v_cant <= 0 or v_cant > 999999999 or v_cant <> round(v_cant, 3)) then
      raise exception 'La cantidad del insumo % debe ser mayor que cero, con hasta tres decimales.', v_linea.item
        using errcode = 'check_violation';
    end if;
    -- Un RQ listo en almacén tiene separado todo lo pedido: lo de más no lo
    -- separó nadie. Se pide en otro RQ, y lo listo se entrega sin esperar.
    if v_cant is not null and v_cant > v_linea.cantidad and v_rq.estado = 'LISTO_EN_ALMACEN' then
      raise exception 'El requerimiento % ya está listo en almacén con lo pedido del insumo %: la cantidad solo puede bajar. Para pedir más, registra otro requerimiento.',
        v_rq.numero, v_linea.item using errcode = 'check_violation';
    end if;
    if v_mat is not null and v_mat is distinct from v_linea.material_id then
      if v_rq.estado <> 'POR_ATENDER' then
        raise exception 'Almacén ya revisó el stock del requerimiento %: el material del insumo % ya no cambia. Corrige la cantidad, o anúlalo y registra otro.',
          v_rq.numero, v_linea.item using errcode = 'check_violation';
      end if;
      select * into v_material from public.materiales where id = v_mat and activo;
      if not found then
        raise exception 'El material del insumo % ya no está en el catálogo de Almacén. Elige otro.', v_linea.item using errcode = 'check_violation';
      end if;
      update public.requerimiento_lineas
         set material_id = v_material.id, descripcion = left(btrim(v_material.descripcion), 300),
             categoria_id = v_material.categoria_id,
             unidad_medida_id = case when v_material.unidad_pendiente then unidad_medida_id else v_material.unidad_medida_id end
       where id = v_linea.id;
    end if;
    if v_cant is not null and v_cant <> v_linea.cantidad then
      -- Lo que Almacén anotó que tenía no puede pasar de lo pedido.
      update public.requerimiento_lineas
         set cantidad = v_cant,
             cantidad_en_stock = case when cantidad_en_stock is null then null else least(cantidad_en_stock, v_cant) end
       where id = v_linea.id;
    end if;
    v_linea := null;
    v_oc := null;
  end loop;
  perform set_config('metalwork.corrigiendo', '', true);

  if exists (select 1 from public.requerimiento_lineas l where l.requerimiento_id = p_id and l.material_id is not null
              group by l.material_id having count(*) > 1) then
    raise exception 'Un material quedaría dos veces en el requerimiento %: suma las cantidades en un solo insumo.', v_rq.numero
      using errcode = 'check_violation';
  end if;

  select * into v_rq from public.requerimientos where id = p_id;
  v_despues := jsonb_build_object('codigo_interno', v_rq.codigo_interno, 'justificacion', v_rq.justificacion,
                                  'fecha_requerida', v_rq.fecha_requerida, 'lineas',
    (select coalesce(jsonb_agg(jsonb_build_object('item', l.item, 'descripcion', l.descripcion, 'cantidad', l.cantidad,
                                                  'material_id', l.material_id) order by l.item), '[]'::jsonb)
       from public.requerimiento_lineas l where l.requerimiento_id = p_id));
  perform public.registrar_correccion(p_correccion, 'REQUERIMIENTO', p_id, v_rq.numero, p_motivo, p_justificante, p_nombre,
                                      v_antes, v_despues);
  -- A Almacén y a quien compra les llega que cambió, con el motivo.
  perform public.fn_rq_avisar(v_rq, 'Requerimiento corregido: ' || v_rq.numero, left(btrim(p_motivo), 200),
                              case when v_rq.estado = 'POR_ATENDER' then 'ALMACEN' else 'LOGISTICA' end);
  return p_id;
end $function$;

CREATE OR REPLACE FUNCTION public.emitir_compra_de_requerimientos(p_id uuid, p_lineas jsonb, p_proveedor_id uuid, p_referencia text, p_fecha date, p_condicion text, p_dias integer, p_moneda text, p_con_factura boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_insumos  uuid[];
  v_tipos    text[];
  v_codigos  text[];
  v_malo     text;
  v_rqs      integer;
  v_motivo   text;
  v_codigo   text;
  v_numero   text;
  v_n        integer;
  v_rq       record;
begin
  perform public.exigir_permiso('compras.crear');
  if p_id is null or p_lineas is null or jsonb_typeof(p_lineas) <> 'array'
     or jsonb_array_length(p_lineas) not between 1 and 100 then
    raise exception 'Marca los insumos que compra esta orden: de uno a cien materiales.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from jsonb_array_elements(p_lineas) x
              where jsonb_typeof(x) <> 'object' or jsonb_typeof(x->'insumos') is distinct from 'array'
                 or jsonb_array_length(x->'insumos') = 0
                 or coalesce(x->>'material_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception 'Cada material de la orden cubre al menos un insumo de un requerimiento. Vuelve a cargar la pantalla.'
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from jsonb_array_elements(p_lineas) x, jsonb_array_elements(x->'insumos') i
              where jsonb_typeof(i) <> 'string'
                 or (i #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception 'No se reconocieron los insumos marcados. Vuelve a cargar la pantalla.' using errcode = 'check_violation';
  end if;
  select array_agg((i #>> '{}')::uuid) into v_insumos
    from jsonb_array_elements(p_lineas) x, jsonb_array_elements(x->'insumos') i;
  if cardinality(v_insumos) > 300 then
    raise exception 'Una orden cubre hasta 300 insumos.' using errcode = 'check_violation';
  end if;
  if cardinality(v_insumos) <> (select count(distinct u) from unnest(v_insumos) u) then
    raise exception 'Un insumo va en una sola línea de la orden.' using errcode = 'check_violation';
  end if;
  if (select count(*) from public.requerimiento_lineas where id = any (v_insumos)) <> cardinality(v_insumos) then
    raise exception 'Alguno de los insumos marcados ya no está. Recarga la pantalla.' using errcode = 'check_violation';
  end if;

  -- Los RQ se bloquean en orden, para que dos órdenes a la vez no se crucen.
  perform 1 from public.requerimientos r
   where r.id in (select l.requerimiento_id from public.requerimiento_lineas l where l.id = any (v_insumos))
   order by r.id
     for update;

  -- Un tipo por orden, y lo compra quien le toca.
  select array_agg(distinct r.tipo) into v_tipos
    from public.requerimientos r join public.requerimiento_lineas l on l.requerimiento_id = r.id
   where l.id = any (v_insumos);
  if cardinality(v_tipos) > 1 then
    raise exception 'Una orden junta insumos de requerimientos del mismo tipo: los de operación en una y los de Administración en otra.'
      using errcode = 'check_violation';
  end if;
  perform public.rq_exigir(v_tipos[1], 'COMPRAR');

  -- Cada RQ, revisado por Almacén y todavía abierto.
  select string_agg(distinct r.numero, ', ') into v_malo
    from public.requerimientos r join public.requerimiento_lineas l on l.requerimiento_id = r.id
   where l.id = any (v_insumos) and r.estado = 'POR_ATENDER';
  if v_malo is not null then
    raise exception 'Almacén todavía no revisó el stock de %: la orden se genera con lo que falte.', v_malo
      using errcode = 'check_violation';
  end if;
  select string_agg(distinct r.numero || ' (' || lower(replace(r.estado, '_', ' ')) || ')', ', ') into v_malo
    from public.requerimientos r join public.requerimiento_lineas l on l.requerimiento_id = r.id
   where l.id = any (v_insumos) and r.estado not in ('SIN_STOCK', 'EN_ATENCION');
  if v_malo is not null then
    raise exception 'Ya no se compra para %: desmarca sus insumos.', v_malo using errcode = 'check_violation';
  end if;

  -- Lo que Almacén tiene completo no se compra.
  select string_agg(format('el %s del %s', l.item, r.numero), ', ' order by r.numero, l.item) into v_malo
    from public.requerimiento_lineas l join public.requerimientos r on r.id = l.requerimiento_id
   where l.id = any (v_insumos) and l.cantidad_en_stock is not null and l.cantidad_en_stock >= l.cantidad;
  if v_malo is not null then
    raise exception 'Almacén ya tiene completo %: no se compra. Desmárcalo.', v_malo using errcode = 'check_violation';
  end if;

  -- Un insumo que ya tiene su compra viva no se pisa; si esa compra se rechazó, queda libre.
  select string_agg(format('el %s del %s (%s)', l.item, r.numero, coalesce(c.numero, c.referencia)), ', '
                    order by r.numero, l.item) into v_malo
    from public.requerimiento_lineas l
    join public.requerimientos r on r.id = l.requerimiento_id
    join public.ordenes_compra_materiales c on c.id = l.orden_compra_id
   where l.id = any (v_insumos) and c.aprobacion not in ('RECHAZADA', 'ANULADA') and c.id <> p_id;
  if v_malo is not null then
    raise exception 'Ya va en otra orden de compra %: desmárcalo o espera a que Gerencia la rechace.', v_malo
      using errcode = 'check_violation';
  end if;

  -- El motivo dice qué RQ atiende; el código es el de los RQ si es uno solo.
  select count(distinct r.id),
         array_agg(distinct public.normalizar_codigo_interno(r.codigo_interno))
    into v_rqs, v_codigos
    from public.requerimientos r join public.requerimiento_lineas l on l.requerimiento_id = r.id
   where l.id = any (v_insumos);
  if v_rqs = 1 then
    select 'Atiende el requerimiento ' || r.numero || ' de ' || coalesce(a.nombre, 'el área') || ': ' || r.justificacion,
           btrim(r.codigo_interno)
      into v_motivo, v_codigo
      from public.requerimientos r
      left join public.areas a on a.id = r.area_id
     where r.id = (select l.requerimiento_id from public.requerimiento_lineas l where l.id = v_insumos[1]);
  else
    select 'Atiende los requerimientos ' || string_agg(x.numero || ' (' || x.area || ')', ', ' order by x.numero) || '.',
           min(x.codigo)
      into v_motivo, v_codigo
      from (select distinct r.numero, coalesce(a.nombre, 'sin área') as area, btrim(r.codigo_interno) as codigo
              from public.requerimientos r
              join public.requerimiento_lineas l on l.requerimiento_id = r.id
              left join public.areas a on a.id = r.area_id
             where l.id = any (v_insumos)) x;
  end if;

  -- La OC es una directa más: Gerencia la aprueba y el conductor la recoge.
  perform public.emitir_compra_directa(
    p_id, p_proveedor_id, p_referencia, left(v_motivo, 500),
    (select jsonb_agg(jsonb_build_object('material_id', x->>'material_id', 'cantidad', x->'cantidad', 'precio', x->'precio'))
       from jsonb_array_elements(p_lineas) x),
    p_fecha, p_condicion, p_dias, p_moneda, p_con_factura, v_codigo);
  -- Con insumos de varios códigos, la orden no tiene uno propio: es el de cada insumo.
  if cardinality(v_codigos) > 1 then
    update public.ordenes_compra_materiales set codigo_interno = null where id = p_id and codigo_interno is not null;
  end if;
  select numero into v_numero from public.ordenes_compra_materiales where id = p_id;

  -- Cada insumo, a la línea de su material.
  update public.requerimiento_lineas l
     set orden_compra_id = p_id, orden_compra_detalle_id = d.id,
         atendida_en = now(), atendida_por = public.usuario_actual()
    from (select (i #>> '{}')::uuid as insumo, (x->>'material_id')::uuid as material
            from jsonb_array_elements(p_lineas) x, jsonb_array_elements(x->'insumos') i) s
    join public.orden_compra_material_detalles d
      on d.orden_compra_id = p_id and d.material_id = s.material and d.requerimiento_detalle_id is null
   where l.id = s.insumo;
  get diagnostics v_n = row_count;
  if v_n <> cardinality(v_insumos) then
    raise exception 'No se pudieron enlazar todos los insumos a la orden. Recarga la pantalla.' using errcode = 'check_violation';
  end if;

  -- Cada RQ que esperaba su compra pasa a «En compra» (avisa a Almacén).
  for v_rq in
    select distinct r.id from public.requerimientos r join public.requerimiento_lineas l on l.requerimiento_id = r.id
     where l.id = any (v_insumos) and r.estado = 'SIN_STOCK'
  loop
    perform public.rq_marcar_en_atencion(v_rq.id, 'Orden ' || coalesce(v_numero, ''));
  end loop;
  return p_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.emitir_compra_del_requerimiento(p_id uuid, p_requerimiento_id uuid, p_items smallint[], p_proveedor_id uuid, p_referencia text, p_detalles jsonb, p_fecha date, p_condicion text, p_dias integer, p_moneda text, p_con_factura boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rq      public.requerimientos%rowtype;
  v_area    text;
  v_numero  text;
  v_ocupada text;
  v_lleno   text;
  v_n       integer;
begin
  perform public.exigir_permiso('compras.crear');
  select * into v_rq from public.requerimientos where id = p_requerimiento_id for update;
  if not found then raise exception 'El requerimiento no existe.'; end if;
  perform public.rq_exigir(v_rq.tipo, 'COMPRAR');
  if v_rq.estado = 'POR_ATENDER' then
    raise exception 'Almacén todavía no revisó el stock del requerimiento %: la orden se genera con lo que falte.', v_rq.numero
      using errcode = 'check_violation';
  end if;
  if v_rq.estado not in ('SIN_STOCK', 'EN_ATENCION') then
    raise exception 'El requerimiento % ya está %: no se le generan más compras.', v_rq.numero,
      lower(replace(v_rq.estado, '_', ' ')) using errcode = 'check_violation';
  end if;
  if p_items is not null and exists (
       select 1 from unnest(p_items) i where not exists (
         select 1 from public.requerimiento_lineas l where l.requerimiento_id = p_requerimiento_id and l.item = i)) then
    raise exception 'Alguno de los insumos marcados no es de este requerimiento. Recarga la pantalla.' using errcode = 'check_violation';
  end if;
  -- Lo que Almacén tiene completo no se compra.
  if p_items is not null then
    select string_agg(l.item::text, ', ' order by l.item) into v_lleno
      from public.requerimiento_lineas l
     where l.requerimiento_id = p_requerimiento_id and l.item = any (p_items)
       and l.cantidad_en_stock is not null and l.cantidad_en_stock >= l.cantidad;
    if v_lleno is not null then
      raise exception '%', case when position(',' in v_lleno) = 0
        then format('Almacén ya tiene completo el insumo %s: no se compra. Desmárcalo.', v_lleno)
        else format('Almacén ya tiene completos los insumos %s: no se compran. Desmárcalos.', v_lleno) end
        using errcode = 'check_violation';
    end if;
  end if;
  -- Un insumo que ya tiene su compra viva no se pisa; si esa compra se rechazó,
  -- queda libre. Sin lista, se toman los libres y los ocupados se dejan en paz.
  if p_items is not null then
    select string_agg(l.item::text, ', ' order by l.item) into v_ocupada
      from public.requerimiento_lineas l
      join public.ordenes_compra_materiales c on c.id = l.orden_compra_id
     where l.requerimiento_id = p_requerimiento_id and c.aprobacion not in ('RECHAZADA', 'ANULADA') and c.id <> p_id
       and l.item = any (p_items);
    if v_ocupada is not null then
      raise exception 'Los insumos % ya tienen su orden de compra: desmárcalos o espera a que Gerencia la rechace.', v_ocupada
        using errcode = 'check_violation';
    end if;
  end if;
  if not exists (
       select 1 from public.requerimiento_lineas l
       left join public.ordenes_compra_materiales c on c.id = l.orden_compra_id
      where l.requerimiento_id = p_requerimiento_id
        and (p_items is null or l.item = any (p_items))
        and coalesce(l.cantidad_en_stock, 0) < l.cantidad
        and (c.id is null or c.id = p_id or c.aprobacion in ('RECHAZADA', 'ANULADA'))) then
    raise exception 'Lo que falta del requerimiento % ya tiene su orden de compra.', v_rq.numero using errcode = 'check_violation';
  end if;
  -- La OC es una directa más: Gerencia la aprueba y el conductor la recoge. El
  -- motivo y el código interno salen del RQ. Un reintento devuelve la misma OC.
  select nombre into v_area from public.areas where id = v_rq.area_id;
  perform public.emitir_compra_directa(
    p_id, p_proveedor_id, p_referencia,
    left('Atiende el requerimiento ' || v_rq.numero || ' de ' || coalesce(v_area, 'el área') || ': ' || v_rq.justificacion, 500),
    p_detalles, p_fecha, p_condicion, p_dias, p_moneda, p_con_factura, v_rq.codigo_interno);
  select numero into v_numero from public.ordenes_compra_materiales where id = p_id;
  update public.requerimiento_lineas l
     set orden_compra_id = p_id, atendida_en = now(), atendida_por = public.usuario_actual()
   where l.requerimiento_id = p_requerimiento_id
     and (p_items is null or l.item = any (p_items))
     and coalesce(l.cantidad_en_stock, 0) < l.cantidad
     and (l.orden_compra_id is null
          or exists (select 1 from public.ordenes_compra_materiales c where c.id = l.orden_compra_id and c.aprobacion in ('RECHAZADA', 'ANULADA')));
  get diagnostics v_n = row_count;
  -- El RQ pasa a EN ATENCIÓN con la función del circuito (avisa a Almacén).
  if v_rq.estado = 'SIN_STOCK' then
    perform public.rq_marcar_en_atencion(p_requerimiento_id, 'Orden ' || coalesce(v_numero, ''));
  end if;
  return p_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.trazabilidad_de_compras()
 RETURNS TABLE(tipo text, id uuid, numero text, referencia text, descripcion text, creado_en timestamp with time zone, emitido_por text, origen text, requerimientos jsonb, ordenes text[], codigos text[], areas text[], proveedor text, proveedor_id uuid, moneda text, total numeric, sin_precio boolean, condicion_pago text, dias_credito integer, con_factura boolean, aprobacion text, aprobado_en timestamp with time zone, motivo_rechazo text, estado text, recojo text, entregado_almacen_en timestamp with time zone, ingreso text, anulado_en timestamp with time zone, motivo_anulacion text, facturado numeric, facturada_entera boolean, facturas jsonb, pagos jsonb, documentos jsonb, peso_kg numeric, en_lista boolean, guia jsonb, guias_anuladas integer, pago text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  -- Logística, el conductor y Contabilidad, que con el peso emite la guía.
  v_recojo constant boolean := public.es_admin() or public.tiene_permiso('compras.programar_recojo')
                               or public.tiene_permiso('compras.recojo') or public.tiene_permiso('compras.guia_remision');
begin
  if not (public.es_admin() or public.tiene_permiso('adquisiciones.ver')) then
    raise exception 'Adquisiciones la ven Contabilidad, Tesorería, Logística y Gerencia.' using errcode = 'insufficient_privilege';
  end if;
  return query
  with facturada as (select * from public.compras_facturadas(null, null)),
  -- De cada factura que Logística anexó a una OC con boleta, la que es la suya
  -- en Adquisiciones (sección 4). Una vez por anexo: la usan las dos de abajo.
  anexo_factura as materialized (
    select d.id as documento_id, d.orden_compra_id, f.adquisicion_id, f.estado, f.cubre_su_oc, f.numero, f.alcanza, f.pagado
      from public.documentos_compra_material d
      join public.ordenes_compra_materiales c on c.id = d.orden_compra_id
      cross join lateral public.factura_del_anexo(d.id) f
     where d.tipo = 'FACTURA' and d.anulado_en is null and not c.con_factura
  ),
  -- La registrada sin ligarla a la OC: es su factura igual, si alcanza para
  -- ella; si no, es de las otras OC y el anexo está por revisar.
  anexada as (
    select distinct x.orden_compra_id, x.adquisicion_id from anexo_factura x
     where x.estado = 'REGISTRADA' and not x.cubre_su_oc and x.alcanza
  ),
  -- Los documentos de cada OC, con su anulación y, el anexo, con su factura.
  documento as (
    select d.orden_compra_id,
           jsonb_agg(jsonb_build_object('id', d.id, 'tipo', d.tipo, 'nombre', d.nombre_archivo, 'ruta', d.ruta_storage,
                                        'numero', d.numero_documento, 'creado_en', d.creado_en, 'bucket', 'documentos-compras',
                                        'anulado_en', d.anulado_en, 'motivo_anulacion', d.motivo_anulacion,
                                        'factura', case when x.adquisicion_id is not null then
                                                     jsonb_build_object('id', x.adquisicion_id, 'numero', x.numero, 'estado', x.estado,
                                                                        'alcanza', x.alcanza, 'pagado', x.pagado) end)
                     order by d.creado_en) as documentos
      from public.documentos_compra_material d
      left join anexo_factura x on x.documento_id = d.id
     group by d.orden_compra_id
  ),
  -- Cada factura de la OC (también la que está en borrador), con lo pagado y cada pago vigente.
  factura as (
    select l.orden_compra_id,
           jsonb_agg(jsonb_build_object(
             'id', a.id, 'numero', a.numero_documento, 'tipo', a.tipo, 'fecha', a.fecha_emision,
             'vence', a.fecha_vencimiento, 'condicion', a.condicion_pago, 'total', a.total, 'moneda', a.moneda,
             'estado', a.estado, 'parcial', l.parcial, 'anexada', l.anexada,
             'ruta', coalesce(a.ruta_storage, d.ruta_storage),
             'bucket', case when a.ruta_storage is not null then 'comprobantes-financieros'
                            when d.ruta_storage is not null then 'documentos-compras' end,
             'pagado', coalesce(p.pagado, 0), 'saldo', a.total - coalesce(p.pagado, 0),
             'pagos', coalesce(p.pagos, '[]'::jsonb))
             order by a.fecha_emision, a.numero_documento) as facturas,
           count(*) filter (where a.estado = 'REGISTRADA') as registradas,
           coalesce(bool_and(a.total - coalesce(p.pagado, 0) <= 0) filter (where a.estado = 'REGISTRADA'), false) as pagadas,
           coalesce(bool_or(not l.parcial) filter (where a.estado = 'REGISTRADA'), false) as alguna_entera,
           coalesce(sum(p.pagado) filter (where a.estado = 'REGISTRADA'), 0) as pagado
      from (select v.orden_compra_id, v.adquisicion_id, v.parcial, false as anexada
              from public.adquisiciones_ordenes_compra v where v.quitada_en is null
            union all
            select x.orden_compra_id, x.adquisicion_id, false, true from anexada x) l
      join public.adquisiciones a on a.id = l.adquisicion_id
      left join public.documentos_compra_material d on d.id = a.documento_compra_id
      left join lateral (
        select sum(x.monto) as pagado,
               jsonb_agg(jsonb_build_object('id', x.id, 'fecha', x.fecha, 'monto', x.monto, 'referencia', x.referencia,
                                            -- El pago de la boleta que la factura tomó (sección 6) lleva el voucher de ese pago.
                                            'ruta', coalesce(x.archivo_ruta, po.archivo_ruta),
                                            'bucket', case when x.pago_orden_compra_id is not null then 'pagos-compras' else 'pagos-facturas' end,
                                            'boleta', x.pago_orden_compra_id is not null,
                                            -- Lo que consumió de la boleta (en la moneda de la OC) y si Tesorería lo pasó a mano.
                                            'de_la_boleta', x.monto_de_la_boleta, 'a_mano', x.monto_de_la_boleta is not null,
                                            'compra', po.orden_compra_id)
                         order by x.fecha, x.creado_en) as pagos
          from public.pagos_adquisicion x
          left join public.pagos_orden_compra po on po.id = x.pago_orden_compra_id
         where x.adquisicion_id = a.id and x.anulado_en is null
      ) p on true
     group by l.orden_compra_id
  )
  select 'OC'::text, c.id, c.numero, c.referencia, null::text, c.creado_en,
         nullif(btrim(split_part(coalesce(u.nombres, ''), ' ', 1) || ' ' || split_part(coalesce(u.apellidos, ''), ' ', 1)), ''),
         c.origen,
         coalesce(rq.lista, '[]'::jsonb),
         coalesce(rv.ordenes, array[]::text[]),
         case when c.codigo_interno is not null then array[c.codigo_interno] else coalesce(rq.codigos, array[]::text[]) end,
         coalesce(rq.areas, rv.areas, array[]::text[]),
         c.proveedor, c.proveedor_id, c.moneda,
         case when c.aprobacion in ('RECHAZADA', 'ANULADA') then null else tt.total end,
         exists (select 1 from public.orden_compra_material_detalles x where x.orden_compra_id = c.id and x.precio_unitario is null),
         c.condicion_pago, c.dias_credito, c.con_factura,
         c.aprobacion, c.aprobado_en, c.motivo_rechazo,
         null::text, c.recojo, c.entregado_almacen_en, ig.ingreso,
         c.anulada_en, c.motivo_anulacion,
         fd.facturado, coalesce(fd.completa or fd.facturado >= fd.total - 1, false),
         -- La factura de la compra en otra moneda espera que Tesorería le pase al cambio lo pagado por la boleta.
         coalesce((select jsonb_agg(e || jsonb_build_object('espera_boleta', not c.con_factura and coalesce(pd.sin_tomar, 0) >= 1
                                                              and e->>'estado' = 'REGISTRADA' and e->>'moneda' <> c.moneda)
                                    order by ord)
                     from jsonb_array_elements(fa.facturas) with ordinality t(e, ord)), '[]'::jsonb),
         coalesce(pb.pagos, '[]'::jsonb), coalesce(dc.documentos, '[]'::jsonb),
         case when v_recojo then pr.peso_kg end, v_recojo and pr.posicion is not null,
         case when g.id is not null then jsonb_build_object('id', g.id, 'numero', g.numero, 'fecha', g.fecha_emision,
                                                             'nombre', g.nombre_archivo, 'cargada_en', g.cargada_en) end,
         coalesce(ga.n, 0),
         case
           when c.aprobacion in ('RECHAZADA', 'ANULADA') then 'NO_SE_PAGA'
           when c.aprobacion = 'POR_APROBAR' then 'ESPERA_APROBACION'
           -- Logística le anexó una factura registrada para otras OC que no alcanza para esta.
           when not c.con_factura and fe.origen = 'REGISTRADA' then 'ANEXO_POR_REVISAR'
           -- La de antes se pagó fuera, salvo que el proveedor entregara factura: esa se paga por ella.
           when not c.con_factura and not c.pago_en_tesoreria and coalesce(fa.registradas, 0) = 0 and fe.origen is null then 'SIN_FACTURA'
           -- Pagada directo y su factura, que llegó después, no tomó todo lo pagado
           -- (de S/ 1 para arriba): se pide la devolución, o se descuenta de otra factura.
           when not c.con_factura and coalesce(pd.de_mas, 0) > 0 then 'PAGADA_DE_MAS'
           -- Su factura en otra moneda no toma sola lo pagado: espera que Tesorería se lo pase al cambio.
           when not c.con_factura and coalesce(pd.otra_moneda, false) then 'PAGO_PARCIAL'
           -- Sin factura registrada que tome sus pagos directos: pagada si lo neto
           -- (sin lo que el proveedor devolvió) suma el total o uno vigente la dio por
           -- cancelada (sección 2), y si no, pagada en parte; lo que falta, por su
           -- boleta o por la factura que llegue. Con factura, la que tomó el pago,
           -- sale como se paga esa factura (abajo): si es por más, le falta algo.
           when not c.con_factura and coalesce(pd.neto, 0) > 0 and coalesce(fa.registradas, 0) = 0
                and (coalesce(pc.sin_completar, false) or pd.neto >= tt.total) then 'PAGADA'
           when not c.con_factura and coalesce(pd.neto, 0) > 0 and coalesce(fa.registradas, 0) = 0 then 'PAGO_PARCIAL'
           -- El proveedor devolvió todo lo pagado por su boleta: no se le debe hasta que la
           -- vuelva a cobrar, como dice «Devuelta» en Cuentas por pagar.
           when not c.con_factura and coalesce(fa.registradas, 0) = 0 and fe.origen is null
                and coalesce(pd.devuelto, 0) > 0 and coalesce(pd.neto, 0) <= 0 then 'DEVUELTA'
           -- La boleta que Contabilidad registró como comprobante se paga por ahí (y
           -- `registrar_pago_compra` ya no la deja pagar directo): sigue como factura.
           -- La que trae factura (en borrador o anexada por Logística) espera que Contabilidad la registre.
           when not c.con_factura and coalesce(fa.registradas, 0) = 0 and fe.origen is null then 'POR_PAGAR'
           when coalesce(fa.registradas, 0) = 0 then 'POR_FACTURAR'
           -- La OC con boleta se paga por su factura, ligada o anexada: pagada esa, pagada la OC. Si
           -- todas la cubren en parte, como la de factura: pagada cuando ya se facturó entera.
           when not c.con_factura and fa.pagadas
                and (fa.alguna_entera or coalesce(fd.completa or fd.facturado >= fd.total - 1, false)) then 'PAGADA'
           when fa.pagadas and coalesce(fd.completa or fd.facturado >= fd.total - 1, false) then 'PAGADA'
           when fa.pagado > 0 then 'PAGO_PARCIAL'
           else 'POR_PAGAR'
         end
    from public.ordenes_compra_materiales c
    left join public.usuarios u on u.id = c.creado_por
    left join facturada fd on fd.orden_compra_id = c.id
    left join factura fa on fa.orden_compra_id = c.id
    left join public.programacion_recojo pr on pr.orden_compra_id = c.id
    left join public.guias_remision_compra g on g.orden_compra_id = c.id and g.anulada_en is null
    left join lateral (
      select count(*)::integer as n from public.guias_remision_compra a
       where a.orden_compra_id = c.id and a.anulada_en is not null
    ) ga on true
    cross join lateral (select public.total_orden_compra(c.id) as total) tt
    -- El proveedor de la OC con boleta entregó su comprobante y se paga por él, y
    -- su pago directo frente a su factura (sección 4). Solo la OC con boleta: la
    -- condición va afuera de la función y la de factura no la llama.
    left join lateral (select e.origen, e.alcanza from public.comprobante_en_camino(c.id) e where not c.con_factura) fe on true
    left join lateral (select x.de_mas, x.otra_moneda, x.sin_tomar, x.pagado - x.devuelto as neto, x.devuelto
                         from public.pago_directo_de_la_compra(c.id) x where not c.con_factura) pd on true
    -- El RQ nuevo (RQ-0001-2026): la OC lo atiende con alguna de sus líneas.
    left join lateral (
      select jsonb_agg(jsonb_build_object('id', x.id, 'numero', x.numero) order by x.numero) as lista,
             array_remove(array_agg(distinct x.codigo_interno), null) as codigos,
             nullif(array_remove(array_agg(distinct x.area), null), array[]::text[]) as areas
        from (select distinct r.id, r.numero, r.codigo_interno, ar.nombre as area
                from public.requerimiento_lineas rl
                join public.requerimientos r on r.id = rl.requerimiento_id
                left join public.areas ar on ar.id = r.area_id
               where rl.orden_compra_id = c.id) x
    ) rq on true
    -- El RQ de antes, por OT y área: en la cabecera o en cada línea.
    left join lateral (
      select array_remove(array_agg(distinct o.numero), null) as ordenes,
             nullif(array_remove(array_agg(distinct case rm.area_destino when 'MTZ' then 'Maestranza'
                                                     when 'PRD' then 'Producción' when 'ACB' then 'Acabados'
                                                     else rm.area_destino end), null), array[]::text[]) as areas
        from public.requerimientos_materiales rm
        left join public.ordenes_trabajo o on o.id = rm.orden_id
       where rm.id = c.requerimiento_id
          or rm.id in (select x.requerimiento_id from public.orden_compra_material_detalles x where x.orden_compra_id = c.id)
    ) rv on true
    left join lateral (
      select case when bool_or(i.estado = 'OBSERVADO') then 'OBSERVADO'
                  when bool_or(i.estado = 'PENDIENTE') then 'PENDIENTE'
                  when count(*) > 0 then 'VALIDADO' end as ingreso
        from public.ingresos_pendientes_almacen i where i.orden_compra_id = c.id
    ) ig on true
    left join documento dc on dc.orden_compra_id = c.id
    -- El pago de la OC con boleta (sección 2). `cancela`: el que la da por
    -- cancelada (`pago_que_cancela_la_compra`), el mismo que marca Tesorería; en
    -- null si la dio por pagada una devolución, que no es ningún pago, o si el
    -- proveedor devolvió todo lo pagado: ninguno quedó «a cuenta» de nada.
    left join lateral (select x.pago_id, x.sin_completar from public.pago_que_cancela_la_compra(c.id, null) x where not c.con_factura) pc on true
    left join lateral (
      select count(*) as n, sum(y.monto) as pagado,
             jsonb_agg(jsonb_build_object('id', y.id, 'fecha', y.fecha_pago, 'monto', y.monto, 'moneda', y.moneda,
                                          'cancela', case when pc.pago_id is null
                                                                and (pc.sin_completar or (coalesce(pd.devuelto, 0) > 0 and coalesce(pd.neto, 0) <= 0))
                                                          then null
                                                          else y.id is not distinct from pc.pago_id end,
                                          'operacion', y.operacion,
                                          'comprobante', y.comprobante_proveedor, 'ruta', y.archivo_ruta, 'bucket', 'pagos-compras',
                                          -- Las facturas que tomaron este pago: solas, al cambio o descontado.
                                          'tomas', (select coalesce(jsonb_agg(jsonb_build_object(
                                                             'factura_id', a.id, 'numero', a.numero_documento, 'moneda', a.moneda,
                                                             'monto', t.monto, 'de_la_boleta', coalesce(t.monto_de_la_boleta, t.monto),
                                                             'a_mano', t.monto_de_la_boleta is not null,
                                                             'de_la_compra', exists (select 1 from public.facturas_de_la_compra(c.id) f
                                                                                      where f.adquisicion_id = a.id))
                                                           order by t.creado_en, t.id), '[]'::jsonb)
                                                      from public.pagos_adquisicion t
                                                      join public.adquisiciones a on a.id = t.adquisicion_id
                                                     where t.pago_orden_compra_id = y.id and t.anulado_en is null))
                       order by y.fecha_pago, y.creado_en) as pagos
        from (select x.* from public.pagos_orden_compra x
               where x.orden_compra_id = c.id and x.anulado_en is null) y
    ) pb on true

  union all

  select 'OS'::text, s.id, s.numero, s.referencia, s.descripcion, s.creado_en,
         nullif(btrim(split_part(coalesce(u.nombres, ''), ' ', 1) || ' ' || split_part(coalesce(u.apellidos, ''), ' ', 1)), ''),
         null::text, '[]'::jsonb,
         case when o.numero is not null then array[o.numero] else array[]::text[] end,
         case when s.codigo_interno is not null then array[s.codigo_interno] else array[]::text[] end,
         case when ar.nombre is not null then array[ar.nombre] else array[]::text[] end,
         s.proveedor, s.proveedor_id, s.moneda, round(s.monto * 1.18, 2), false,
         s.condicion_pago, s.dias_credito, null::boolean,
         s.aprobacion, s.aprobado_en, s.motivo_rechazo,
         s.estado, null::text, null::timestamptz, null::text,
         s.anulado_en, s.motivo_anulacion,
         null::numeric, null::boolean, '[]'::jsonb, coalesce(ps.pagos, '[]'::jsonb), coalesce(ds.documentos, '[]'::jsonb),
         null::numeric, false, null::jsonb, 0,
         case
           when s.estado = 'ANULADA' or s.aprobacion = 'RECHAZADA' then 'NO_SE_PAGA'
           when s.aprobacion = 'POR_APROBAR' then 'ESPERA_APROBACION'
           when ps.cancela then 'PAGADA'
           when ps.n > 0 then 'PAGO_PARCIAL'
           else 'POR_PAGAR'
         end
    from public.ordenes_servicio s
    left join public.usuarios u on u.id = s.creado_por
    left join public.ordenes_trabajo o on o.id = s.orden_id
    left join public.areas ar on ar.id = s.area_id
    left join lateral (
      select count(*) as n, coalesce(bool_or(x.cancela), false) as cancela,
             jsonb_agg(jsonb_build_object('id', x.id, 'fecha', x.fecha_pago, 'monto', x.monto, 'moneda', x.moneda,
                                          'cancela', x.cancela, 'operacion', x.operacion,
                                          'comprobante', x.comprobante_proveedor, 'ruta', x.archivo_ruta, 'bucket', 'pagos-servicio')
                       order by x.fecha_pago, x.creado_en) as pagos
        from public.pagos_orden_servicio x
       where x.orden_servicio_id = s.id and x.anulado_en is null
    ) ps on true
    -- Sus documentos vigentes (sección 5).
    left join lateral (
      select jsonb_agg(jsonb_build_object('id', d.id, 'tipo', d.tipo, 'nombre', d.nombre_archivo, 'ruta', d.ruta_storage,
                                          'numero', d.numero, 'creado_en', d.creado_en, 'bucket', 'documentos-servicio')
                       order by d.creado_en) as documentos
        from public.documentos_orden_servicio d where d.orden_servicio_id = s.id and d.anulado_en is null
    ) ds on true

   order by 6 desc, 2;
end;
$function$;

CREATE OR REPLACE FUNCTION public.documentos_por_aprobar()
 RETURNS TABLE(tipo text, id uuid, numero text, referencia text, origen text, proveedor text, proveedor_documento text, moneda text, monto numeric, monto_pen numeric, condicion_pago text, dias_credito integer, fecha_estimada date, aprobacion text, pedida_en timestamp with time zone, emitida_por text, decidida_por text, decidida_en timestamp with time zone, motivo_rechazo text, motivo text, ordenes text[], unidades text[], lineas jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (public.es_aprobador_compras() or public.tiene_permiso('compras.ver')
          or public.tiene_permiso('compras.configurar_aprobacion')) then
    raise exception 'No tienes permiso para ver lo que espera aprobación.' using errcode = 'insufficient_privilege';
  end if;
  return query
  select * from (
    select 'OC'::text, c.id, coalesce(c.numero, c.referencia), c.referencia, c.origen, c.proveedor, p.numero_documento,
           c.moneda,
           coalesce(l.total, (select sum((x->>'cantidad')::numeric * coalesce((x->>'precio_unitario')::numeric, 0))
                                from jsonb_array_elements(coalesce(c.lineas_rechazadas, c.lineas_anuladas)) x), 0),
           c.monto_pen, c.condicion_pago, c.dias_credito, c.fecha_estimada, c.aprobacion as x_aprobacion,
           coalesce(c.aprobacion_pedida_en, c.creado_en) as x_pedida,
           public.puesto(uc), public.puesto(coalesce(un, ua, ur)), coalesce(c.anulada_en, c.aprobado_en, c.rechazado_en),
           coalesce(c.motivo_anulacion, c.motivo_rechazo), c.motivo,
           coalesce(nullif(l.ordenes, array[]::text[]),
                    array(select distinct x->>'orden' from jsonb_array_elements(coalesce(c.lineas_rechazadas, c.lineas_anuladas)) x
                           where x->>'orden' is not null order by 1)),
           coalesce(l.unidades, array[]::text[]),
           coalesce(l.lineas, c.lineas_rechazadas, c.lineas_anuladas, '[]'::jsonb)
      from public.ordenes_compra_materiales c
      left join public.proveedores p on p.id = c.proveedor_id
      left join public.usuarios uc on uc.id = c.creado_por
      left join public.usuarios ua on ua.id = c.aprobado_por
      left join public.usuarios ur on ur.id = c.rechazado_por
      left join public.usuarios un on un.id = c.anulada_por
      left join lateral (
        select sum(d.cantidad * coalesce(d.precio_unitario, 0)) as total,
               array_remove(array_agg(distinct o.numero), null) as ordenes,
               array_remove(array_agg(distinct public.nombre_unidad_almacen(u)) filter (where u.id is not null), null) as unidades,
               jsonb_agg(jsonb_build_object(
                 'orden', o.numero, 'area', r.area_destino,
                 'material_codigo', m.codigo, 'material', m.descripcion, 'unidad', um.codigo,
                 'cantidad', d.cantidad, 'precio_unitario', d.precio_unitario) order by o.numero nulls first, m.codigo) as lineas
          from public.orden_compra_material_detalles d
          left join public.requerimientos_materiales r on r.id = d.requerimiento_id
          left join public.ordenes_trabajo o on o.id = r.orden_id
          left join public.unidades u on u.id = o.unidad_id
          left join public.requerimiento_material_detalles rd on rd.id = d.requerimiento_detalle_id
          left join public.ot_materiales om on om.id = rd.ot_material_id
          left join public.materiales m on m.id = coalesce(d.material_id, om.material_id)
          left join public.unidades_medida um on um.id = m.unidad_medida_id
         where d.orden_compra_id = c.id
      ) l on true
     where c.aprobacion = 'POR_APROBAR'
        or (c.aprobacion in ('APROBADA', 'RECHAZADA', 'ANULADA')
            and coalesce(c.anulada_en, c.aprobado_en, c.rechazado_en) > now() - interval '30 days')
    union all
    select 'OS'::text, s.id, s.numero, s.referencia, 'SERVICIO'::text, s.proveedor, p.numero_documento,
           s.moneda, s.monto, s.monto_pen, s.condicion_pago, s.dias_credito, s.fecha_fin, s.aprobacion,
           s.creado_en, public.puesto(uc), public.puesto(coalesce(ua, ur)), coalesce(s.aprobado_en, s.rechazado_en),
           s.motivo_rechazo, s.descripcion,
           case when o.numero is null then array[]::text[] else array[o.numero] end,
           case when u.id is null then array[]::text[] else array[public.nombre_unidad_almacen(u)] end,
           '[]'::jsonb
      from public.ordenes_servicio s
      left join public.proveedores p on p.id = s.proveedor_id
      left join public.usuarios uc on uc.id = s.creado_por
      left join public.usuarios ua on ua.id = s.aprobado_por
      left join public.usuarios ur on ur.id = s.rechazado_por
      left join public.ordenes_trabajo o on o.id = s.orden_id
      left join public.unidades u on u.id = o.unidad_id
     where (s.aprobacion = 'POR_APROBAR' and s.estado = 'EMITIDA')
        or (s.aprobacion in ('APROBADA', 'RECHAZADA') and coalesce(s.aprobado_en, s.rechazado_en) > now() - interval '30 days')
  ) t
  order by t.x_aprobacion = 'POR_APROBAR' desc, t.x_pedida desc
  limit 300;
end;
$function$;

CREATE OR REPLACE FUNCTION public.ordenes_compra_listado()
 RETURNS TABLE(id uuid, numero text, referencia text, origen text, proveedor text, proveedor_documento text, moneda text, monto numeric, monto_pen numeric, condicion_pago text, dias_credito integer, fecha_estimada date, aprobacion text, motivo_rechazo text, recojo text, entregado_almacen_en timestamp with time zone, creado_en timestamp with time zone, emitida_por text, motivo text, ordenes text[], unidades text[], lineas integer, tiene_factura boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (public.es_admin() or public.tiene_permiso('compras.ver') or public.tiene_permiso('compras.crear')) then
    raise exception 'No tienes permiso para ver las órdenes de compra.' using errcode = 'insufficient_privilege';
  end if;
  return query
  select c.id, coalesce(c.numero, c.referencia), c.referencia, c.origen, c.proveedor, p.numero_documento,
         c.moneda,
         coalesce(l.total, (select sum((x->>'cantidad')::numeric * coalesce((x->>'precio_unitario')::numeric, 0))
                              from jsonb_array_elements(coalesce(c.lineas_rechazadas, c.lineas_anuladas)) x), 0),
         c.monto_pen, c.condicion_pago, c.dias_credito, c.fecha_estimada, c.aprobacion, coalesce(c.motivo_anulacion, c.motivo_rechazo),
         c.recojo, c.entregado_almacen_en, c.creado_en, public.puesto(uc), c.motivo,
         coalesce(nullif(l.ordenes, array[]::text[]),
                  array(select distinct x->>'orden' from jsonb_array_elements(coalesce(c.lineas_rechazadas, c.lineas_anuladas)) x
                         where x->>'orden' is not null order by 1)),
         coalesce(l.unidades, array[]::text[]),
         coalesce(l.n, jsonb_array_length(coalesce(c.lineas_rechazadas, c.lineas_anuladas, '[]'::jsonb)))::integer,
         public.compra_tiene_comprobante(c)
    from public.ordenes_compra_materiales c
    left join public.proveedores p on p.id = c.proveedor_id
    left join public.usuarios uc on uc.id = c.creado_por
    left join lateral (
      select sum(d.cantidad * coalesce(d.precio_unitario, 0)) as total, nullif(count(*), 0) as n,
             array_remove(array_agg(distinct o.numero), null) as ordenes,
             array_remove(array_agg(distinct public.nombre_unidad_almacen(u)) filter (where u.id is not null), null) as unidades
        from public.orden_compra_material_detalles d
        left join public.requerimientos_materiales r on r.id = d.requerimiento_id
        left join public.ordenes_trabajo o on o.id = r.orden_id
        left join public.unidades u on u.id = o.unidad_id
       where d.orden_compra_id = c.id
    ) l on true
   -- Lo mismo que deja ver la política de la tabla: Logística todo; quien solo
   -- consulta, las directas y las de las áreas que le tocan.
   where public.es_admin() or public.tiene_permiso('compras.crear') or public.tiene_permiso('tesoreria.ver_documentos')
      or c.requerimiento_id is null
      or exists (select 1 from public.requerimientos_materiales r
                  where r.id = c.requerimiento_id and public.puede_ver_area_material(r.area_destino))
   order by c.creado_en desc
   limit 300;
end;
$function$;


-- 3. Por qué una OC no se anula todavía ------------------------------------------------
-- Una sola respuesta para la pantalla y para la anulación: lo primero que lo
-- impide, en palabras de quien la anula, o null si se puede.
create or replace function public.motivo_para_no_anular_compra(p_compra uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_c      public.ordenes_compra_materiales%rowtype;
  v_nombre text;
  v_doc    text;
  v_neto   numeric;
begin
  select * into v_c from public.ordenes_compra_materiales where id = p_compra;
  if not found then
    return 'La compra no existe.';
  end if;
  v_nombre := coalesce(v_c.numero, 'OC ' || v_c.referencia);
  if v_c.aprobacion = 'ANULADA' then
    return format('La %s ya está anulada.', v_nombre);
  end if;
  if v_c.aprobacion = 'POR_APROBAR' then
    return format('La %s espera aprobación: si no va, recházala con su motivo.', v_nombre);
  end if;
  if v_c.aprobacion = 'RECHAZADA' then
    return format('La %s ya está rechazada.', v_nombre);
  end if;
  -- Nada entró.
  if v_c.entregado_almacen_en is not null
     or exists (select 1 from public.ingresos_pendientes_almacen i where i.orden_compra_id = p_compra)
     or exists (select 1 from public.movimientos_materiales m
                  join public.orden_compra_material_detalles d on d.id = m.orden_compra_detalle_id
                 where d.orden_compra_id = p_compra) then
    return format('La %s ya entró a Almacén: no se anula. Si el material se devuelve al proveedor, eso se registra aparte.', v_nombre);
  end if;
  if v_c.recojo in ('RECOGIDO', 'DEJADO') then
    return format('El conductor ya recogió la %s: no se anula con el material en camino.', v_nombre);
  end if;
  select g.numero into v_doc from public.guias_remision_compra g
   where g.orden_compra_id = p_compra and g.anulada_en is null order by g.cargada_en limit 1;
  if found then
    return format('El proveedor ya despachó la %s con la guía %s: si no llega, que Logística anule la guía antes.', v_nombre, v_doc);
  end if;
  -- Nada pagado: ni factura ni lo neto de la boleta.
  select a.numero_documento into v_doc
    from public.adquisiciones a
   where a.orden_compra_id = p_compra
      or exists (select 1 from public.adquisiciones_ordenes_compra l
                  where l.adquisicion_id = a.id and l.orden_compra_id = p_compra and l.quitada_en is null)
   order by a.creado_en limit 1;
  if found then
    return format('Contabilidad registró la factura %s para la %s: que la corrija para quitarle esta OC antes de anularla.',
                  coalesce(v_doc, 'sin número'), v_nombre);
  end if;
  select coalesce(d.numero_documento, d.nombre_archivo) into v_doc from public.documentos_compra_material d
   where d.orden_compra_id = p_compra and d.tipo = 'FACTURA' and d.anulado_en is null order by d.creado_en limit 1;
  if found then
    return format('Logística le anexó a la %s la factura %s: si no corresponde, que anule ese anexo antes.', v_nombre, v_doc);
  end if;
  v_neto := coalesce((select sum(p.monto) from public.pagos_orden_compra p where p.orden_compra_id = p_compra and p.anulado_en is null), 0)
          - coalesce((select sum(x.monto) from public.devoluciones_orden_compra x where x.orden_compra_id = p_compra and x.anulado_en is null), 0);
  if v_neto > 0 then
    return format('Tesorería le pagó %s %s a la %s: el proveedor tiene que devolverlo antes, y Tesorería registra esa devolución.',
                  case when v_c.moneda = 'USD' then 'US$' else 'S/' end, to_char(v_neto, 'FM999G999G990D00'), v_nombre);
  end if;
  return null;
end;
$$;
comment on function public.motivo_para_no_anular_compra(uuid) is
  'Lo primero que impide anular la OC (algo entró, se recogió, se facturó o quedó pagado), o null si Gerencia la puede anular (migración 20261022150000).';
revoke all on function public.motivo_para_no_anular_compra(uuid) from public, anon, authenticated;

-- 4. Anular -----------------------------------------------------------------------------
-- Como el rechazo: guarda sus líneas, las suelta para volver a comprarse y avisa
-- a Logística; si estaba en la lista del conductor, sale de ella y se le avisa.
create or replace function public.anular_orden_compra(p_compra uuid, p_motivo text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_c        public.ordenes_compra_materiales%rowtype;
  v_motivo   text := btrim(coalesce(p_motivo, ''));
  v_no       text;
  v_lineas   jsonb;
  v_en_lista boolean;
  v_nombre   text;
begin
  if not public.es_aprobador_compras() then
    raise exception 'Solo el puesto que aprueba las compras puede anularlas.' using errcode = 'insufficient_privilege';
  end if;
  select * into v_c from public.ordenes_compra_materiales where id = p_compra for update;
  if not found then
    raise exception 'La compra no existe.' using errcode = 'no_data_found';
  end if;
  if v_c.aprobacion = 'ANULADA' then
    return p_compra;
  end if;
  if char_length(v_motivo) not between 10 and 500 then
    raise exception 'Escribe el motivo de la anulación (de 10 a 500 caracteres): queda en la OC y le llega a Logística.'
      using errcode = 'check_violation';
  end if;
  v_no := public.motivo_para_no_anular_compra(p_compra);
  if v_no is not null then
    raise exception '%', v_no using errcode = 'check_violation';
  end if;
  v_nombre := coalesce(v_c.numero, 'OC ' || v_c.referencia);

  select coalesce(jsonb_agg(jsonb_build_object(
           'requerimiento_detalle_id', d.requerimiento_detalle_id,
           'material_id', coalesce(d.material_id, om.material_id),
           'orden', o.numero, 'area', r.area_destino,
           'material_codigo', m.codigo, 'material', m.descripcion, 'unidad', um.codigo,
           'cantidad', d.cantidad, 'precio_unitario', d.precio_unitario) order by o.numero nulls first, m.codigo), '[]'::jsonb)
    into v_lineas
    from public.orden_compra_material_detalles d
    left join public.requerimientos_materiales r on r.id = d.requerimiento_id
    left join public.ordenes_trabajo o on o.id = r.orden_id
    left join public.requerimiento_material_detalles rd on rd.id = d.requerimiento_detalle_id
    left join public.ot_materiales om on om.id = rd.ot_material_id
    left join public.materiales m on m.id = coalesce(d.material_id, om.material_id)
    left join public.unidades_medida um on um.id = m.unidad_medida_id
   where d.orden_compra_id = p_compra;
  v_en_lista := exists (select 1 from public.programacion_recojo p where p.orden_compra_id = p_compra and p.posicion is not null);

  -- Los disparadores de la OC y de sus líneas reconocen esta anulación y ninguna otra.
  perform set_config('metalwork.anulando_oc', p_compra::text, true);
  delete from public.programacion_recojo where orden_compra_id = p_compra;
  delete from public.orden_compra_material_detalles where orden_compra_id = p_compra;
  update public.ordenes_compra_materiales
     set aprobacion = 'ANULADA', anulada_por = public.usuario_actual(), anulada_en = now(),
         motivo_anulacion = v_motivo, lineas_anuladas = v_lineas,
         recojo = case when recojo in ('POR_RECOGER', 'EN_RECOJO') then null else recojo end
   where id = p_compra;
  perform set_config('metalwork.anulando_oc', '', true);

  perform public.notificar_a_usuario(v_c.creado_por, 'Compra anulada: ' || v_nombre,
    v_motivo || case when v_c.origen = 'DIRECTA' and not exists (select 1 from public.requerimiento_lineas rl where rl.orden_compra_id = p_compra)
                     then ' Emite otra orden si todavía hace falta.'
                     else ' Sus líneas volvieron a quedar pendientes de compra.' end,
    '/compras/ordenes', 'ordenes_compra_materiales', p_compra, public.usuario_actual());
  if v_c.recojo = 'EN_RECOJO' or v_en_lista then
    perform public.avisar_a_quien_tiene('compras.recojo', 'No recojas la ' || v_nombre,
      'Gerencia la anuló: ' || v_motivo, '/recojos', p_compra, public.usuario_actual());
  end if;
  return p_compra;
end;
$$;
comment on function public.anular_orden_compra(uuid, text) is
  'Gerencia anula una OC aprobada (o sin aprobación) con su motivo, si nada entró ni quedó pagado; sus líneas vuelven a quedar por comprar y la OC queda congelada (migración 20261022150000).';
revoke all on function public.anular_orden_compra(uuid, text) from public, anon;
grant execute on function public.anular_orden_compra(uuid, text) to authenticated;

-- 5. Las que Gerencia puede anular hoy ---------------------------------------------------
-- La lista de Aprobación de compras: las aprobadas o sin aprobación que todavía no
-- entraron ni se pagaron, con lo que diga si se puede o por qué no.
create or replace function public.compras_que_se_pueden_anular()
returns table(id uuid, numero text, proveedor text, moneda text, monto numeric, con_factura boolean,
              aprobacion text, aprobado_en timestamptz, creado_en timestamptz, recojo text, ordenes text[], codigos text[], impide text)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not public.es_aprobador_compras() then
    raise exception 'Solo el puesto que aprueba las compras puede anularlas.' using errcode = 'insufficient_privilege';
  end if;
  return query
  select c.id, coalesce(c.numero, 'OC ' || c.referencia), c.proveedor, c.moneda,
         coalesce((select sum(d.cantidad * coalesce(d.precio_unitario, 0)) from public.orden_compra_material_detalles d
                    where d.orden_compra_id = c.id), 0)::numeric(14, 2),
         c.con_factura, c.aprobacion, c.aprobado_en, c.creado_en, c.recojo,
         array(select distinct o.numero from public.orden_compra_material_detalles d
                 join public.requerimientos_materiales r on r.id = d.requerimiento_id
                 join public.ordenes_trabajo o on o.id = r.orden_id
                where d.orden_compra_id = c.id order by 1),
         case when c.codigo_interno is not null then array[c.codigo_interno]
              else array(select distinct q.codigo_interno from public.requerimiento_lineas rl
                           join public.requerimientos q on q.id = rl.requerimiento_id
                          where rl.orden_compra_id = c.id and q.codigo_interno is not null order by 1) end,
         public.motivo_para_no_anular_compra(c.id)
    from public.ordenes_compra_materiales c
   where c.aprobacion in ('APROBADA', 'NO_REQUERIDA')
     and c.entregado_almacen_en is null
     and c.recojo is distinct from 'DEJADO'
   order by c.creado_en desc
   limit 200;
end;
$$;
comment on function public.compras_que_se_pueden_anular() is
  'Las OC aprobadas o sin aprobación que no llegaron a Almacén, con lo que impide anularlas (null si se puede). Solo para el puesto que aprueba las compras.';
revoke all on function public.compras_que_se_pueden_anular() from public, anon;
grant execute on function public.compras_que_se_pueden_anular() to authenticated;

-- 6. Anulada, queda como evidencia -------------------------------------------------------
create or replace function public.fn_compra_anulada_congelada()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if old.aprobacion = 'ANULADA' and (to_jsonb(new) - 'actualizado_en') is distinct from (to_jsonb(old) - 'actualizado_en') then
    raise exception 'La % está anulada: queda como evidencia y no cambia.', coalesce(old.numero, 'OC ' || old.referencia)
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_compra_anulada_congelada() from public, anon, authenticated;
create or replace trigger trg_compra_anulada_congelada
  before update on public.ordenes_compra_materiales
  for each row execute function public.fn_compra_anulada_congelada();

-- Ni pagos, devoluciones, documentos, guías, recojo ni ingresos nuevos para una OC
-- anulada; un pago o una devolución que ya tenía tampoco se anula después: lo que
-- quedó en cero se queda en cero.
create or replace function public.fn_hijo_de_compra_anulada()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_c public.ordenes_compra_materiales%rowtype;
begin
  select * into v_c from public.ordenes_compra_materiales where id = new.orden_compra_id;
  if found and v_c.aprobacion = 'ANULADA' then
    raise exception 'La % está anulada: %.', coalesce(v_c.numero, 'OC ' || v_c.referencia),
      case tg_table_name
        when 'pagos_orden_compra' then 'no se le registran ni se le anulan pagos'
        when 'devoluciones_orden_compra' then 'no se le registran ni se le anulan devoluciones'
        when 'documentos_compra_material' then 'no se le adjuntan documentos'
        when 'guias_remision_compra' then 'no se le carga guía'
        when 'programacion_recojo' then 'no va a la lista del conductor'
        else 'no entra a Almacén' end
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_hijo_de_compra_anulada() from public, anon, authenticated;
create or replace trigger trg_pago_de_compra_anulada
  before insert or update on public.pagos_orden_compra
  for each row execute function public.fn_hijo_de_compra_anulada();
create or replace trigger trg_devolucion_de_compra_anulada
  before insert or update on public.devoluciones_orden_compra
  for each row execute function public.fn_hijo_de_compra_anulada();
create or replace trigger trg_documento_de_compra_anulada
  before insert on public.documentos_compra_material
  for each row execute function public.fn_hijo_de_compra_anulada();
create or replace trigger trg_guia_de_compra_anulada
  before insert on public.guias_remision_compra
  for each row execute function public.fn_hijo_de_compra_anulada();
create or replace trigger trg_recojo_de_compra_anulada
  before insert on public.programacion_recojo
  for each row execute function public.fn_hijo_de_compra_anulada();
create or replace trigger trg_ingreso_de_compra_anulada
  before insert on public.ingresos_pendientes_almacen
  for each row execute function public.fn_hijo_de_compra_anulada();
