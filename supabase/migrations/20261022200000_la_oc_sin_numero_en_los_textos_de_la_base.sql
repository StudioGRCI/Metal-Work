-- La OC sin número tampoco pasa por un número de OC en lo que escribe la base.
--
-- En la revisión del #130 con cada puesto salió que una OC de antes de la serie
-- OC-…-MW, que no tiene número de la casa, aparecía como «OC-0001». Esa es la
-- referencia del proveedor (su cotización), y se confunde con un número de OC.
-- La pantalla ya la nombra bien (#154). Lo que arma la base todavía no:
--   * mensajes que la gente lee: «La orden de compra OC-0001 está anulada…»;
--   * avisos: «Compra aprobada: OC-0001», «Compra pagada de más: OC OC-0001»;
--   * lo que se guarda para leer después: «Pago por la boleta de la OC OC-0001
--     del …» en la línea del pago, y el nombre del documento en el historial
--     de correcciones;
--   * los nombres que algunas funciones ya devuelven armados («OC OC-0001») y
--     la pantalla pinta tal cual: «Esperan nota de crédito», «Esperan
--     reposición», la lista de las OC que se pueden anular, y la factura que
--     espera lo pagado por la boleta.
--
-- Ahora todo eso dice el número, o «OC sin número (ref. del proveedor OC-0001)»,
-- con `nombre_de_oc`, igual que `nombreDeOc` en la aplicación. Donde la frase
-- decía «la orden de compra %» o «la compra %», queda «la %»: «La OC-0005-MW
-- está anulada» y «La OC sin número (ref. del proveedor OC-0001) está anulada».
--
-- Lo que la base devuelve como dato suelto (el número o la referencia, sin
-- armar) para que una pantalla lo pinte se queda como está: Aprobación de
-- compras, Gestión de compras, Requerimientos, Almacén y Costeo reciben la
-- referencia aparte o la usan como dato, y se arreglan con sus pantallas.
-- Lo ya guardado (avisos, pagos, correcciones) no se reescribe: queda como se
-- escribió.
--
-- De paso, el aviso «Adquisiciones la ven Contabilidad, Tesorería y Logística»
-- ya no era cierto (Gerencia y Compras también la ven) y nombraba puestos. Pasa a
-- «No tienes permiso para ver Adquisiciones.». Lo mismo con «El pago de la OC lo
-- ven Tesorería y Logística»: también lo ven Gerencia, Costos y Compras.
--
-- Cómo cambia cada función: no se copia entera. Hay hilos que las cambiaron
-- hace poco, y copiar una versión anterior les borraría eso. Se reemplaza solo
-- el fragmento exacto, como en 20261022185000. Si un fragmento no está y
-- tampoco su reemplazo, la función cambió por otro lado: la migración se detiene
-- sin tocar nada para revisarla a mano. Al final se comprueba que no quede
-- ninguna función armando «OC » || referencia.
--
-- Dos cambios van más allá del nombre:
-- * `avisar_pago_directo` daba por leído el aviso viejo comparando el título
--   entero. Con el nombre nuevo, el aviso sin leer de una OC sin número escrito
--   antes de esta migración no calzaría y quedaría para siempre. Ahora busca
--   por el comienzo del título, y sigue filtrando por la misma OC.
-- * La línea de pago que deja la boleta (`conciliar_pago_directo`,
--   `tomar_pago_de_la_boleta`) se corta a 108 letras. Con un nombre largo, el
--   corte caía en medio de la operación y dejaba un número de operación que no
--   existe. Ahora la fecha y la operación van enteras o no van. Si el texto
--   cabe, sale igual que antes.

-- 1. El nombre ------------------------------------------------------------------------------------
create or replace function public.nombre_de_oc(p_numero text, p_referencia text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select coalesce(nullif(btrim(p_numero), ''),
                  case when nullif(btrim(p_referencia), '') is null then 'OC sin número'
                       else 'OC sin número (ref. del proveedor ' || btrim(p_referencia) || ')' end)
$$;
comment on function public.nombre_de_oc(text, text) is
  'Cómo se nombra una OC en lo que lee la gente: su número, o «OC sin número (ref. del proveedor …)» si es de antes de la serie. Igual que nombreDeOc en la aplicación.';
revoke all on function public.nombre_de_oc(text, text) from public, anon;
grant execute on function public.nombre_de_oc(text, text) to authenticated;

-- 2. Cada función, fragmento por fragmento ----------------------------------------------------------
do $$
declare
  v_c       record;
  v_funcion text;
  v_def     text;
  v_antes   text;
  v_quedan  text;
begin
  for v_c in
    select * from (values
      (1, 'anular_pago_compra(uuid,text)',
       $v$coalesce(c.numero, 'OC ' || c.referencia)$v$,
       $v$public.nombre_de_oc(c.numero, c.referencia)$v$),
      (2, 'anular_pago_factura(uuid,text)',
       $v$coalesce(c.numero, 'OC ' || c.referencia)$v$,
       $v$public.nombre_de_oc(c.numero, c.referencia)$v$),
      (3, 'avisar_pago_directo(uuid[])',
       $v$coalesce(c.numero, 'OC ' || c.referencia)$v$,
       $v$public.nombre_de_oc(c.numero, c.referencia)$v$),
      (4, 'avisar_pago_directo(uuid[])',
       $v$       and titulo in ('Compra pagada de más: ' || v_oc.nombre, 'Factura anexada por revisar: ' || v_oc.nombre,$v$,
       $v$       and (titulo like 'Compra pagada de más: %' or titulo like 'Factura anexada por revisar: %'$v$),
      (5, 'avisar_pago_directo(uuid[])',
       $v$                      'Factura en otra moneda: ' || v_oc.nombre)$v$,
       $v$            or titulo like 'Factura en otra moneda: %')$v$),
      (6, 'compra_pagada_fuera_de_la_factura(adquisiciones)',
       $v$coalesce(c.numero, 'OC ' || c.referencia)$v$,
       $v$public.nombre_de_oc(c.numero, c.referencia)$v$),
      (7, 'conciliar_pago_directo(uuid[])',
       $v$coalesce(c.numero, 'OC ' || c.referencia)$v$,
       $v$public.nombre_de_oc(c.numero, c.referencia)$v$),
      (8, 'conciliar_pago_directo(uuid[])',
       $v$    v_ref := left('Pago por la boleta de la ' || v_nombre || ' del ' || to_char(v_pago.fecha_pago, 'DD/MM/YYYY')$v$,
       $v$    v_ref := left('Pago por la boleta de la ' || v_nombre, 108);$v$),
      (9, 'conciliar_pago_directo(uuid[])',
       $v$                  || coalesce(' · op. ' || btrim(v_pago.operacion), ''), 108);$v$,
       $v$    -- La fecha y la operación van enteras o no van: cortadas no se leen.
    if char_length(v_ref) <= 108 - 15 then
      v_ref := v_ref || ' del ' || to_char(v_pago.fecha_pago, 'DD/MM/YYYY');
      if char_length(v_ref || coalesce(' · op. ' || btrim(v_pago.operacion), '')) <= 108 then
        v_ref := v_ref || coalesce(' · op. ' || btrim(v_pago.operacion), '');
      end if;
    end if;$v$),
      (10, 'confirmar_pago_de_la_boleta(uuid,boolean,date,numeric,text)',
       $v$coalesce(v_oc.numero, 'OC ' || v_oc.referencia)$v$,
       $v$public.nombre_de_oc(v_oc.numero, v_oc.referencia)$v$),
      (11, 'confirmar_pago_de_la_boleta(uuid,boolean,date,numeric,text)',
       $v$'Elige el día en que se pagó: entre el % (cuando se emitió la %) y hoy.'$v$,
       $v$'Elige el día en que se pagó: entre el %, cuando se emitió la %, y hoy.'$v$),
      (12, 'fn_compra_pagada_total_fijo()',
       $v$coalesce(c.numero, 'OC ' || c.referencia)$v$,
       $v$public.nombre_de_oc(c.numero, c.referencia)$v$),
      (13, 'fn_factura_sin_pago_directo()',
       $v$coalesce(c.numero, 'OC ' || c.referencia)$v$,
       $v$public.nombre_de_oc(c.numero, c.referencia)$v$),
      (14, 'pago_directo_de_la_factura(uuid)',
       $v$'Adquisiciones la ven Contabilidad, Tesorería, Logística y Gerencia.'$v$,
       $v$'No tienes permiso para ver Adquisiciones.'$v$),
      (15, 'pago_directo_de_la_factura(uuid)',
       $v$coalesce(c.numero, 'OC ' || c.referencia)$v$,
       $v$public.nombre_de_oc(c.numero, c.referencia)$v$),
      (16, 'pasar_compra_a_tesoreria(uuid)',
       $v$coalesce(v_oc.numero, 'OC ' || v_oc.referencia)$v$,
       $v$public.nombre_de_oc(v_oc.numero, v_oc.referencia)$v$),
      (17, 'registrar_pago_compra(uuid,uuid,date,numeric,boolean,text,text,text,uuid,numeric)',
       $v$coalesce(v_oc.numero, 'OC ' || v_oc.referencia)$v$,
       $v$public.nombre_de_oc(v_oc.numero, v_oc.referencia)$v$),
      (18, 'registrar_devolucion_compra(uuid,uuid,date,numeric,text,text,uuid,numeric,boolean)',
       $v$coalesce(v_oc.numero, 'OC ' || v_oc.referencia)$v$,
       $v$public.nombre_de_oc(v_oc.numero, v_oc.referencia)$v$),
      (19, 'anular_devolucion_compra(uuid,text)',
       $v$coalesce(c.numero, 'OC ' || c.referencia)$v$,
       $v$public.nombre_de_oc(c.numero, c.referencia)$v$),
      (20, 'anular_devolucion_compra(uuid,text)',
       $v$lo pagado por la boleta de la % (%) pasaría de su total (%)$v$,
       $v$lo pagado por la boleta de la % sumaría % y pasaría de su total (%)$v$),
      (21, 'soltar_pago_de_la_boleta(uuid,uuid,text)',
       $v$coalesce(c.numero, 'OC ' || c.referencia)$v$,
       $v$public.nombre_de_oc(c.numero, c.referencia)$v$),
      (22, 'tomar_pago_de_la_boleta(uuid,uuid,uuid,numeric,numeric,text)',
       $v$coalesce(v_oc.numero, 'OC ' || v_oc.referencia)$v$,
       $v$public.nombre_de_oc(v_oc.numero, v_oc.referencia)$v$),
      (23, 'tomar_pago_de_la_boleta(uuid,uuid,uuid,numeric,numeric,text)',
       $v$                  || v_nombre || ' del ' || to_char(v_pago.fecha_pago, 'DD/MM/YYYY')$v$,
       $v$                  || v_nombre, 108);$v$),
      (24, 'tomar_pago_de_la_boleta(uuid,uuid,uuid,numeric,numeric,text)',
       $v$                  || coalesce(' · op. ' || btrim(v_pago.operacion), ''), 108);$v$,
       $v$    -- La fecha y la operación van enteras o no van: cortadas no se leen.
    if char_length(v_ref) <= 108 - 15 then
      v_ref := v_ref || ' del ' || to_char(v_pago.fecha_pago, 'DD/MM/YYYY');
      if char_length(v_ref || coalesce(' · op. ' || btrim(v_pago.operacion), '')) <= 108 then
        v_ref := v_ref || coalesce(' · op. ' || btrim(v_pago.operacion), '');
      end if;
    end if;$v$),
      (25, 'corregir_factura_compra(uuid,uuid,text,text,text,jsonb)',
       $v$coalesce(c.numero, 'OC ' || c.referencia)$v$,
       $v$public.nombre_de_oc(c.numero, c.referencia)$v$),
      (26, 'corregir_factura_compra(uuid,uuid,text,text,text,jsonb)',
       $v$|| ' (RUC ' || public.ruc_de_la_compra(c.id) || ')' into v_otra_oc$v$,
       $v$|| ' es del RUC ' || public.ruc_de_la_compra(c.id) into v_otra_oc$v$),
      (27, 'corregir_factura_compra(uuid,uuid,text,text,text,jsonb)',
       $v$'La factura queda con el RUC % y la % es de otro: una factura se liga solo a las OC de su proveedor.'$v$,
       $v$'La factura queda con el RUC % y la %: una factura se liga solo a las OC de su proveedor.'$v$),
      (28, 'fn_adquisicion_anota_ruc()',
       $v$coalesce(c.numero, 'OC ' || c.referencia)$v$,
       $v$public.nombre_de_oc(c.numero, c.referencia)$v$),
      (29, 'fn_adquisicion_factura_unica()',
       $v$coalesce(c.numero, 'OC ' || c.referencia)$v$,
       $v$public.nombre_de_oc(c.numero, c.referencia)$v$),
      (30, 'fn_adquisicion_oc_valida()',
       $v$coalesce(v_oc.numero, v_oc.referencia)$v$,
       $v$public.nombre_de_oc(v_oc.numero, v_oc.referencia)$v$),
      (31, 'fn_adquisicion_oc_valida()',
       $v$'La orden de compra %$v$,
       $v$'La %$v$),
      (32, 'fn_adquisicion_oc_valida()',
       $v$y la orden de compra % es de % (RUC %)$v$,
       $v$y la % es de % (RUC %)$v$),
      (33, 'fn_adquisicion_oc_valida()',
       $v$proveedor: la orden de compra % es de %.$v$,
       $v$proveedor: la % es de %.$v$),
      (34, 'fn_vinculo_con_anexo()',
       $v$coalesce(c.numero, 'OC ' || c.referencia)$v$,
       $v$public.nombre_de_oc(c.numero, c.referencia)$v$),
      (35, 'anular_documento_compra(uuid,text)',
       $v$v_nombre := coalesce(v_oc.numero, 'OC ' || v_oc.referencia);$v$,
       $v$v_nombre := public.nombre_de_oc(v_oc.numero, v_oc.referencia);$v$),
      (36, 'adquisiciones_control(uuid[])',
       $v$'Adquisiciones la ven Contabilidad, Tesorería y Logística.'$v$,
       $v$'No tienes permiso para ver Adquisiciones.'$v$),
      (37, 'compras_sin_factura()',
       $v$'Adquisiciones la ven Contabilidad, Tesorería y Logística.'$v$,
       $v$'No tienes permiso para ver Adquisiciones.'$v$),
      (38, 'facturado_de_compras(uuid[])',
       $v$'Adquisiciones la ven Contabilidad, Tesorería y Logística.'$v$,
       $v$'No tienes permiso para ver Adquisiciones.'$v$),
      (39, 'situacion_de_facturas_anexadas(uuid[])',
       $v$'Adquisiciones la ven Contabilidad, Tesorería, Logística y Gerencia.'$v$,
       $v$'No tienes permiso para ver Adquisiciones.'$v$),
      (40, 'trazabilidad_de_compras()',
       $v$'Adquisiciones la ven Contabilidad, Tesorería, Logística y Gerencia.'$v$,
       $v$'No tienes permiso para ver Adquisiciones.'$v$),
      (41, 'anular_orden_compra(uuid,text)',
       $v$coalesce(v_c.numero, 'OC ' || v_c.referencia)$v$,
       $v$public.nombre_de_oc(v_c.numero, v_c.referencia)$v$),
      (42, 'compras_que_se_pueden_anular()',
       $v$coalesce(c.numero, 'OC ' || c.referencia)$v$,
       $v$public.nombre_de_oc(c.numero, c.referencia)$v$),
      (43, 'motivo_para_no_anular_compra(uuid)',
       $v$coalesce(v_c.numero, 'OC ' || v_c.referencia)$v$,
       $v$public.nombre_de_oc(v_c.numero, v_c.referencia)$v$),
      (44, 'fn_compra_anulada_congelada()',
       $v$coalesce(old.numero, 'OC ' || old.referencia)$v$,
       $v$public.nombre_de_oc(old.numero, old.referencia)$v$),
      (45, 'fn_hijo_de_compra_anulada()',
       $v$coalesce(v_c.numero, 'OC ' || v_c.referencia)$v$,
       $v$public.nombre_de_oc(v_c.numero, v_c.referencia)$v$),
      (46, 'dejar_de_esperar_reposicion(uuid,text)',
       $v$coalesce(v_c.numero, 'OC ' || v_c.referencia)$v$,
       $v$public.nombre_de_oc(v_c.numero, v_c.referencia)$v$),
      (47, 'devoluciones_por_reponer()',
       $v$coalesce(c.numero, 'OC ' || c.referencia)$v$,
       $v$public.nombre_de_oc(c.numero, c.referencia)$v$),
      (48, 'devoluciones_sin_nota_credito()',
       $v$coalesce(c.numero, 'OC ' || c.referencia)$v$,
       $v$public.nombre_de_oc(c.numero, c.referencia)$v$),
      (49, 'devolver_al_proveedor(uuid,uuid,numeric,text,text,boolean)',
       $v$coalesce(v_c.numero, 'OC ' || v_c.referencia)$v$,
       $v$public.nombre_de_oc(v_c.numero, v_c.referencia)$v$),
      (50, 'ingresos_para_devolver()',
       $v$coalesce(c.numero, 'OC ' || c.referencia)$v$,
       $v$public.nombre_de_oc(c.numero, c.referencia)$v$),
      (51, 'recomprar_lo_devuelto(uuid,uuid)',
       $v$coalesce(v_c.numero, 'OC ' || v_c.referencia)$v$,
       $v$public.nombre_de_oc(v_c.numero, v_c.referencia)$v$),
      (52, 'aprobar_compra(uuid)',
       $v$raise exception 'La compra % no está esperando aprobación.', v_compra.referencia using errcode$v$,
       $v$raise exception 'La % no está esperando aprobación.', public.nombre_de_oc(v_compra.numero, v_compra.referencia) using errcode$v$),
      (53, 'aprobar_compra(uuid)',
       $v$'Compra aprobada: ' || coalesce(v_compra.numero, v_compra.referencia)$v$,
       $v$'Compra aprobada: ' || public.nombre_de_oc(v_compra.numero, v_compra.referencia)$v$),
      (54, 'evaluar_aprobacion_compra(uuid)',
       $v$'Compra por aprobar: ' || coalesce(v_compra.numero, v_compra.referencia)$v$,
       $v$'Compra por aprobar: ' || public.nombre_de_oc(v_compra.numero, v_compra.referencia)$v$),
      (55, 'rechazar_compra(uuid,text)',
       $v$raise exception 'La compra % no está esperando aprobación.', coalesce(v_compra.numero, v_compra.referencia) using errcode$v$,
       $v$raise exception 'La % no está esperando aprobación.', public.nombre_de_oc(v_compra.numero, v_compra.referencia) using errcode$v$),
      (56, 'rechazar_compra(uuid,text)',
       $v$'Compra rechazada: ' || coalesce(v_compra.numero, v_compra.referencia)$v$,
       $v$'Compra rechazada: ' || public.nombre_de_oc(v_compra.numero, v_compra.referencia)$v$),
      (57, 'corregir_orden_compra(uuid,uuid,text,text,text,jsonb)',
       $v$raise exception 'La orden % está rechazada: no se corrige. Genera otra.', coalesce(v_oc.numero, v_oc.referencia)$v$,
       $v$raise exception 'La % está rechazada: no se corrige. Genera otra.', public.nombre_de_oc(v_oc.numero, v_oc.referencia)$v$),
      (58, 'corregir_orden_compra(uuid,uuid,text,text,text,jsonb)',
       $v$raise exception 'La orden % está anulada: queda como evidencia y no se corrige. Genera otra.', coalesce(v_oc.numero, v_oc.referencia)$v$,
       $v$raise exception 'La % está anulada: queda como evidencia y no se corrige. Genera otra.', public.nombre_de_oc(v_oc.numero, v_oc.referencia)$v$),
      (59, 'corregir_orden_compra(uuid,uuid,text,text,text,jsonb)',
       $v$raise exception 'La compra % ya tiene su comprobante adjunto: ya no se cambia si viene con factura.',$v$,
       $v$raise exception 'La % ya tiene su comprobante adjunto: ya no se cambia si viene con factura.',$v$),
      (60, 'corregir_orden_compra(uuid,uuid,text,text,text,jsonb)',
       $v$coalesce(v_oc.numero, v_oc.referencia) using errcode = 'check_violation';$v$,
       $v$public.nombre_de_oc(v_oc.numero, v_oc.referencia) using errcode = 'check_violation';$v$),
      (61, 'corregir_orden_compra(uuid,uuid,text,text,text,jsonb)',
       $v$perform public.registrar_correccion(p_correccion, 'ORDEN_COMPRA', p_id, coalesce(v_oc.numero, v_oc.referencia), p_motivo,$v$,
       $v$perform public.registrar_correccion(p_correccion, 'ORDEN_COMPRA', p_id, left(public.nombre_de_oc(v_oc.numero, v_oc.referencia), 80), p_motivo,$v$),
      (62, 'corregir_requerimiento(uuid,uuid,text,text,text,jsonb)',
       $v$select coalesce(c.numero, c.referencia) into v_oc from public.ordenes_compra_materiales c$v$,
       $v$select public.nombre_de_oc(c.numero, c.referencia) into v_oc from public.ordenes_compra_materiales c$v$),
      (63, 'emitir_compra_de_requerimientos(uuid,jsonb,uuid,text,date,text,integer,text,boolean)',
       $v$select string_agg(format('el %s del %s (%s)', l.item, r.numero, coalesce(c.numero, c.referencia)), ', '$v$,
       $v$select string_agg(format('el %s del %s, en la %s', l.item, r.numero, public.nombre_de_oc(c.numero, c.referencia)), '; '$v$),
      (64, 'fijar_datos_compra(uuid,boolean,text)',
       $v$raise exception 'La compra % ya tiene su comprobante adjunto: ya no se cambia si viene con factura.',$v$,
       $v$raise exception 'La % ya tiene su comprobante adjunto: ya no se cambia si viene con factura.',$v$),
      (65, 'fijar_datos_compra(uuid,boolean,text)',
       $v$coalesce(v_compra.numero, v_compra.referencia) using errcode = 'check_violation';$v$,
       $v$public.nombre_de_oc(v_compra.numero, v_compra.referencia) using errcode = 'check_violation';$v$),
      (66, 'fn_compra_con_factura_no_cambia_pago()',
       $v$raise exception 'La orden de compra % ya tiene factura en Adquisiciones: su condición de pago y su moneda no cambian.',$v$,
       $v$raise exception 'La % ya tiene factura en Adquisiciones: su condición de pago y su moneda no cambian.',$v$),
      (67, 'fn_compra_con_factura_no_cambia_pago()',
       $v$coalesce(new.numero, new.referencia) using errcode = 'check_violation';$v$,
       $v$public.nombre_de_oc(new.numero, new.referencia) using errcode = 'check_violation';$v$),
      (68, 'fn_compra_pagada_no_cambia()',
       $v$raise exception 'La OC % ya tiene un pago de Tesorería: no cambia de comprobante ni de moneda mientras ese pago siga vigente.',$v$,
       $v$raise exception 'La % ya tiene un pago de Tesorería: no cambia de comprobante ni de moneda mientras ese pago siga vigente.',$v$),
      (69, 'fn_compra_pagada_no_cambia()',
       $v$coalesce(new.numero, new.referencia) using errcode = 'check_violation';$v$,
       $v$public.nombre_de_oc(new.numero, new.referencia) using errcode = 'check_violation';$v$),
      (70, 'anular_guia_remision(uuid,text)',
       $v$'Guía de remisión anulada: ' || coalesce(v_compra.numero, v_compra.referencia),$v$,
       $v$'Guía de remisión anulada: ' || public.nombre_de_oc(v_compra.numero, v_compra.referencia),$v$),
      (71, 'cargar_guia_remision(uuid,uuid,text,date,text)',
       $v$v_nombre := coalesce(v_compra.numero, v_compra.referencia);$v$,
       $v$v_nombre := public.nombre_de_oc(v_compra.numero, v_compra.referencia);$v$),
      (72, 'cargar_guia_remision(uuid,uuid,text,date,text)',
       $v$'La compra % no va con el conductor: no lleva guía de remisión de recojo.'$v$,
       $v$'La % no va con el conductor: no lleva guía de remisión de recojo.'$v$),
      (73, 'cargar_guia_remision(uuid,uuid,text,date,text)',
       $v$'Logística todavía no pone el peso de la compra %: la guía de remisión se emite con ese peso.'$v$,
       $v$'Logística todavía no pone el peso de la %: la guía de remisión se emite con ese peso.'$v$),
      (74, 'cargar_guia_remision(uuid,uuid,text,date,text)',
       $v$'La compra % ya tiene la guía %: anúlala con su motivo para cargar otra.'$v$,
       $v$'La % ya tiene la guía %: anúlala con su motivo para cargar otra.'$v$),
      (75, 'cargar_guia_remision(uuid,uuid,text,date,text)',
       $v$'La guía no puede ser anterior a la compra %: revisa la fecha.'$v$,
       $v$'La guía no puede ser anterior a la %: revisa la fecha.'$v$),
      (76, 'fn_compra_recojo()',
       $v$'Programa el recojo: ' || coalesce(new.numero, new.referencia),$v$,
       $v$'Programa el recojo: ' || public.nombre_de_oc(new.numero, new.referencia),$v$),
      (77, 'fn_compra_recojo()',
       $v$coalesce(new.numero, new.referencia)$v$,
       $v$public.nombre_de_oc(new.numero, new.referencia)$v$),
      (78, 'fn_compra_recojo()',
       $v$'El recojo de la compra % $v$,
       $v$'El recojo de la % $v$),
      (79, 'fn_compra_recojo()',
       $v$'Logística todavía no programa el recojo de la compra %: espera a que la ponga en tu lista.'$v$,
       $v$'Logística todavía no programa el recojo de la %: espera a que la ponga en tu lista.'$v$),
      (80, 'fn_compra_recojo()',
       $v$'La compra % está con el conductor: la entrega a Almacén se marca cuando él la deja.'$v$,
       $v$'La % está con el conductor: la entrega a Almacén se marca cuando él la deja.'$v$),
      (81, 'mandar_compra_a_recojo(uuid)',
       $v$'La compra % ya se entregó a Almacén.', coalesce(v_compra.numero, v_compra.referencia)$v$,
       $v$'La % ya se entregó a Almacén.', public.nombre_de_oc(v_compra.numero, v_compra.referencia)$v$),
      (82, 'marcar_compra_dejada_almacen(uuid)',
       $v$'Marca primero que recogiste la compra %.', coalesce(v_compra.numero, v_compra.referencia)$v$,
       $v$'Marca primero que recogiste la %.', public.nombre_de_oc(v_compra.numero, v_compra.referencia)$v$),
      (83, 'marcar_compra_dejada_almacen(uuid)',
       $v$'Ingreso por validar: ' || coalesce(v_compra.numero, v_compra.referencia),$v$,
       $v$'Ingreso por validar: ' || public.nombre_de_oc(v_compra.numero, v_compra.referencia),$v$),
      (84, 'marcar_compra_en_recojo(uuid)',
       $v$'La compra % no está mandada a recojo.', coalesce(v_compra.numero, v_compra.referencia)$v$,
       $v$'La % no está mandada a recojo.', public.nombre_de_oc(v_compra.numero, v_compra.referencia)$v$),
      (85, 'marcar_compra_recogida(uuid)',
       $v$'La compra % no está mandada a recojo.', coalesce(v_compra.numero, v_compra.referencia)$v$,
       $v$'La % no está mandada a recojo.', public.nombre_de_oc(v_compra.numero, v_compra.referencia)$v$),
      (86, 'programar_recojo(uuid,numeric,integer)',
       $v$v_nombre := coalesce(v_compra.numero, v_compra.referencia);$v$,
       $v$v_nombre := public.nombre_de_oc(v_compra.numero, v_compra.referencia);$v$),
      (87, 'programar_recojo(uuid,numeric,integer)',
       $v$'La compra % no va con el conductor.'$v$,
       $v$'La % no va con el conductor.'$v$),
      (88, 'programar_recojo(uuid,numeric,integer)',
       $v$'El conductor ya salió a recoger la compra %: su lugar y su peso ya no se cambian.'$v$,
       $v$'El conductor ya salió a recoger la %: su lugar y su peso ya no se cambian.'$v$),
      (89, 'programar_recojo(uuid,numeric,integer)',
       $v$'Escribe el peso de la compra % en kilos: más de cero.'$v$,
       $v$'Escribe el peso de la % en kilos: más de cero.'$v$),
      (90, 'quitar_recojo_de_la_lista(uuid)',
       $v$'El conductor ya salió a recoger la compra %: ya no se saca de su lista.'$v$,
       $v$'El conductor ya salió a recoger la %: ya no se saca de su lista.'$v$),
      (91, 'quitar_recojo_de_la_lista(uuid)',
       $v$coalesce(v_compra.numero, v_compra.referencia) using errcode = 'check_violation';$v$,
       $v$public.nombre_de_oc(v_compra.numero, v_compra.referencia) using errcode = 'check_violation';$v$),
      (92, 'quitar_recojo_de_la_lista(uuid)',
       $v$'Recojo retirado de tu lista: ' || coalesce(v_compra.numero, v_compra.referencia),$v$,
       $v$'Recojo retirado de tu lista: ' || public.nombre_de_oc(v_compra.numero, v_compra.referencia),$v$),
      (93, 'validar_ingresos_compra(uuid,jsonb,text)',
       $v$'Un material no pertenece a la compra %. Vuelve a cargar el kardex.', coalesce(v_compra.numero, v_compra.referencia)$v$,
       $v$'Un material no pertenece a la %. Vuelve a cargar el kardex.', public.nombre_de_oc(v_compra.numero, v_compra.referencia)$v$),
      (94, 'validar_ingresos_compra(uuid,jsonb,text)',
       $v$'Almacén observó la compra ' || coalesce(v_compra.numero, v_compra.referencia),$v$,
       $v$'Almacén observó la ' || public.nombre_de_oc(v_compra.numero, v_compra.referencia),$v$),
      (95, 'mensaje_compra_sin_aprobar(ordenes_compra_materiales)',
       $v$'La compra ' || coalesce(p_compra.numero, p_compra.referencia, 'sin número')$v$,
       $v$'La ' || public.nombre_de_oc(p_compra.numero, p_compra.referencia)$v$),
      (96, 'situacion_de_pago_de_compra(uuid)',
       $v$'El pago de la OC lo ven Tesorería y Logística.'$v$,
       $v$'No tienes permiso para ver el pago de la OC.'$v$)
    ) as c(orden, funcion, viejo, nuevo)
    union all
    select null::integer, null, null, null  -- cierra la última función
    order by 1 nulls last
  loop
    if v_funcion is distinct from v_c.funcion then
      if v_funcion is not null and v_def <> v_antes then
        execute v_def;
      end if;
      exit when v_c.funcion is null;
      v_funcion := v_c.funcion;
      -- Sin los `\r` de un pegado desde Windows: el texto se compara línea por línea.
      v_def := replace(pg_get_functiondef(('public.' || v_funcion)::regprocedure), E'\r', '');
      v_antes := v_def;
    end if;
    if position(v_c.viejo in v_def) > 0 then
      v_def := replace(v_def, v_c.viejo, v_c.nuevo);
    elsif position(v_c.nuevo in v_def) = 0 then
      raise exception '% cambió: no tiene «%» como lo conoce el repositorio. Revisarla a mano antes de seguir.',
        v_funcion, left(v_c.viejo, 120);
    end if;
  end loop;

  -- Ninguna función de la base arma ya «OC » || referencia, ni el aviso viejo de Adquisiciones.
  select string_agg(p.oid::regprocedure::text, ', ' order by 1) into v_quedan
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and (p.prosrc ~ '''OC '' *\|\| *[a-z_]+\.referencia'
          or p.prosrc ~ 'Adquisiciones la ven'
          or p.prosrc ~ 'El pago de la OC lo ven');
  if v_quedan is not null then
    raise exception 'Todavía nombran la OC sin número con su referencia o el aviso viejo: %. Revisarlas a mano.', v_quedan;
  end if;
  -- Y las que la nombraban con coalesce(numero, referencia) en sus mensajes ya no lo hacen.
  select string_agg(p.oid::regprocedure::text, ', ' order by 1) into v_quedan
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = any (array['anular_guia_remision',
                                  'aprobar_compra',
                                  'cargar_guia_remision',
                                  'corregir_orden_compra',
                                  'corregir_requerimiento',
                                  'emitir_compra_de_requerimientos',
                                  'evaluar_aprobacion_compra',
                                  'fijar_datos_compra',
                                  'fn_adquisicion_oc_valida',
                                  'fn_compra_con_factura_no_cambia_pago',
                                  'fn_compra_pagada_no_cambia',
                                  'fn_compra_recojo',
                                  'mandar_compra_a_recojo',
                                  'marcar_compra_dejada_almacen',
                                  'marcar_compra_en_recojo',
                                  'marcar_compra_recogida',
                                  'programar_recojo',
                                  'quitar_recojo_de_la_lista',
                                  'rechazar_compra',
                                  'validar_ingresos_compra'])
     and p.prosrc ~ 'coalesce\([a-z_]+\.numero, *[a-z_]+\.referencia\)';
  if v_quedan is not null then
    raise exception 'Todavía arman el nombre con la referencia: %. Revisarlas a mano.', v_quedan;
  end if;
end $$;
