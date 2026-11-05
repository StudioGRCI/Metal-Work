-- El aviso de lo que el proveedor ya no repone se lee bien.
--
-- DKS pidió el 26/10 comprobar el aviso que llega cuando el proveedor no repone lo
-- devuelto, «pues eso se verá». Con la cuenta de Almacén marcando «No lo repone» en el
-- banco local, a Logística le llegaron dos avisos. El de la OC decía
-- «4 Tubo cuadrado 2x2 x 2 mm ya no se reponen: El proveedor ya no tiene ese disco y
-- emite nota de crédito Lo que haga falta vuelve a la lista…»: sin la unidad, y con el
-- motivo pegado a la frase siguiente. Lo mismo le llegaba a Contabilidad en «Espera la
-- nota de crédito», y al devolver («…llegaron doblados El proveedor lo repone.»). Ahora:
-- «El proveedor ya no repone 4 UND de Tubo cuadrado 2x2 x 2 mm. Motivo: … . Lo que
-- haga falta…» y «Devolución de 4 UND de …. Motivo: … . El proveedor lo repone.».
--
-- Solo cambia el texto de los avisos; quién puede, qué se anota y qué vuelve a la lista
-- de Logística siguen igual. Las dos funciones parten de su versión viva: la de la
-- 20261022185000 con el nombre de la OC de la 20261022220000 y el aviso de permiso de la
-- 20261023140000.

create or replace function public.dejar_de_esperar_reposicion(p_devolucion uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_dev     public.movimientos_materiales%rowtype;
  v_c       public.ordenes_compra_materiales%rowtype;
  v_repuesto numeric;
  v_compra  text;
  v_texto   text;
  v_unidad  text;
  v_motivo  text;
begin
  -- Contabilidad también, sin pedirlo aparte: al registrar la nota de crédito de
  -- esa devolución (`registrar_nota_credito`, migración 20261022190000).
  if public.usuario_actual() is not null
     and current_setting('metalwork.nota_credito', true) is distinct from p_devolucion::text
     and not (public.es_admin() or public.tiene_permiso('almacen.recibir') or public.tiene_permiso('compras.crear')) then
    raise exception 'No tienes permiso para dejar de esperar la reposición.' using errcode = 'insufficient_privilege';
  end if;
  if char_length(btrim(coalesce(p_motivo, ''))) not between 10 and 500 then
    raise exception 'Cuenta por qué ya no se espera (de 10 a 500 letras).' using errcode = 'check_violation';
  end if;
  select * into v_dev from public.movimientos_materiales where id = p_devolucion for update;
  if not found or v_dev.tipo <> 'DEVOLUCION_PROVEEDOR' then
    raise exception 'Esa devolución no existe. Vuelve a cargar la pantalla.' using errcode = 'check_violation';
  end if;
  if not v_dev.se_repone then
    return p_devolucion;
  end if;
  perform 1 from public.orden_compra_material_detalles where id = v_dev.orden_compra_detalle_id for update;
  select coalesce(sum(m.cantidad::numeric), 0) into v_repuesto
    from public.movimientos_materiales m where m.repone_devolucion = p_devolucion;
  if v_repuesto >= v_dev.cantidad then
    raise exception 'Esa devolución ya se repuso entera.' using errcode = 'check_violation';
  end if;
  update public.movimientos_materiales
     set se_repone = false, reposicion_cancelada_en = now(), reposicion_cancelada_por = public.usuario_actual(),
         reposicion_cancelada_motivo = btrim(p_motivo)
   where id = p_devolucion;
  perform public.recomprar_lo_devuelto(v_dev.orden_compra_detalle_id, p_devolucion);

  select c.* into v_c from public.ordenes_compra_materiales c
    join public.orden_compra_material_detalles d on d.orden_compra_id = c.id
   where d.id = v_dev.orden_compra_detalle_id;
  v_compra := public.nombre_de_oc(v_c.numero, v_c.referencia);
  -- «El proveedor ya no repone 4 UND de Tubo cuadrado…», con su unidad, y el motivo
  -- como su propia frase: antes salía «4 Tubo… ya no se reponen: …crédito Lo que haga falta».
  select um.codigo into v_unidad from public.materiales mt join public.unidades_medida um on um.id = mt.unidad_medida_id
   where mt.id = v_dev.material_id;
  v_motivo := btrim(p_motivo);
  if right(v_motivo, 1) not in ('.', '!', '?') then v_motivo := v_motivo || '.'; end if;
  -- Sin unidad, «4 de …» y no «4  de …».
  v_texto := format('El proveedor ya no repone %s de %s. Motivo: %s',
                    public.cantidad_en_texto(v_dev.cantidad - v_repuesto) || coalesce(' ' || v_unidad, ''),
                    (select mt.descripcion from public.materiales mt where mt.id = v_dev.material_id), v_motivo);
  perform public.avisar_a_permiso('compras.crear', 'No repone lo devuelto: ' || v_compra,
    v_texto || ' Lo que haga falta vuelve a la lista para comprarlo en otra OC.', '/compras', 'ordenes_compra_materiales', v_c.id);
  if current_setting('metalwork.nota_credito', true) is distinct from p_devolucion::text then
    perform public.avisar_a_permiso('adquisiciones.registrar', 'Espera la nota de crédito: ' || v_compra,
      v_texto || ' Registra su nota de crédito contra la factura.', '/adquisiciones?vista=facturas#notas-credito',
      'ordenes_compra_materiales', v_c.id);
  end if;
  return p_devolucion;
end;
$$;
revoke all on function public.dejar_de_esperar_reposicion(uuid, text) from public, anon;
grant execute on function public.dejar_de_esperar_reposicion(uuid, text) to authenticated;

-- Al devolver: el aviso «Devuelto al proveedor» y, si no se repone, el de la nota de crédito.
CREATE OR REPLACE FUNCTION public.devolver_al_proveedor(p_id uuid, p_ingreso uuid, p_cantidad numeric, p_documento text, p_motivo text, p_se_repone boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ing     public.movimientos_materiales%rowtype;
  v_d       public.orden_compra_material_detalles%rowtype;
  v_c       public.ordenes_compra_materiales%rowtype;
  v_mat     public.materiales%rowtype;
  v_unidad  text;
  v_devuelto numeric;
  v_saldo   numeric;
  v_neto    numeric;
  v_compra  text;
  v_texto   text;
  v_motivo  text;
begin
  perform public.exigir_permiso('almacen.recibir');
  if p_id is null then
    raise exception 'Vuelve a abrir la ventana.' using errcode = 'check_violation';
  end if;
  -- El mismo envío repetido (la respuesta no llegó) devuelve lo que ya entró; con otros datos no da «listo».
  if exists (select 1 from public.movimientos_materiales where id = p_id) then
    if exists (select 1 from public.movimientos_materiales m
                where m.id = p_id and m.tipo = 'DEVOLUCION_PROVEEDOR' and m.devuelve_ingreso = p_ingreso
                  and m.cantidad::numeric = p_cantidad and m.documento_referencia = btrim(p_documento)
                  and m.motivo_devolucion = btrim(p_motivo) and m.registrado_por = public.usuario_actual()
                  and (m.se_repone = p_se_repone or m.reposicion_cancelada_en is not null)) then
      return p_id;
    end if;
    raise exception 'Esa devolución ya quedó registrada la primera vez que la enviaste: recarga la pantalla para ver cómo quedó.'
      using errcode = 'check_violation';
  end if;
  if p_cantidad is null or p_cantidad <= 0 or p_cantidad <> round(p_cantidad, 3) or p_cantidad > 999999999 then
    raise exception 'Escribe cuánto vuelve al proveedor: más de cero, con hasta tres decimales.' using errcode = 'check_violation';
  end if;
  if char_length(btrim(coalesce(p_documento, ''))) not between 2 and 100 then
    raise exception 'Escribe la guía o el documento con que sale lo devuelto.' using errcode = 'check_violation';
  end if;
  if char_length(btrim(coalesce(p_motivo, ''))) not between 10 and 500 then
    raise exception 'Cuenta por qué se devuelve (de 10 a 500 letras).' using errcode = 'check_violation';
  end if;
  if p_se_repone is null then
    raise exception 'Di si el proveedor lo repone.' using errcode = 'check_violation';
  end if;

  select * into v_ing from public.movimientos_materiales where id = p_ingreso;
  if not found or v_ing.tipo <> 'INGRESO' or v_ing.origen <> 'COMPRA' or v_ing.orden_compra_detalle_id is null then
    raise exception 'Elige un ingreso de una compra.' using errcode = 'check_violation';
  end if;
  if v_ing.requerimiento_detalle_id is not null then
    raise exception 'Ese ingreso es de un pedido de material de OT de antes del requerimiento: no se devuelve por aquí.'
      using errcode = 'check_violation';
  end if;
  -- La línea de OC y el material, tomados: otra devolución u otro ingreso de la misma línea espera.
  select * into v_d from public.orden_compra_material_detalles where id = v_ing.orden_compra_detalle_id for update;
  select * into v_c from public.ordenes_compra_materiales where id = v_d.orden_compra_id;
  select * into v_mat from public.materiales where id = v_ing.material_id for update;
  select um.codigo into v_unidad from public.unidades_medida um where um.id = v_mat.unidad_medida_id;
  v_compra := public.nombre_de_oc(v_c.numero, v_c.referencia);

  select coalesce(sum(m.cantidad::numeric), 0) into v_devuelto
    from public.movimientos_materiales m where m.devuelve_ingreso = p_ingreso;
  if p_cantidad > v_ing.cantidad - v_devuelto then
    raise exception 'De ese ingreso de la % quedan % % por devolver.', v_compra,
      public.cantidad_en_texto(greatest(v_ing.cantidad - v_devuelto, 0)), coalesce(v_unidad, '') using errcode = 'check_violation';
  end if;
  v_saldo := public.saldo_material_interno(v_mat.id);
  if p_cantidad > v_saldo then
    raise exception 'En el almacén hay % % de %: lo que ya salió al taller vuelve primero como devolución del taller.',
      public.cantidad_en_texto(greatest(v_saldo, 0)), coalesce(v_unidad, ''), v_mat.descripcion using errcode = 'check_violation';
  end if;
  -- De la OC, no del material entero: lo que de ella se entregó a sus RQ ya no está aquí.
  v_saldo := public.en_mano_de_la_linea_de_compra(v_d.id);
  if p_cantidad > v_saldo then
    raise exception 'De lo que llegó con la % quedan % % en el almacén: lo que ya se entregó a sus RQ vuelve primero como devolución del taller.',
      v_compra, public.cantidad_en_texto(v_saldo), coalesce(v_unidad, '') using errcode = 'check_violation';
  end if;

  select k.neto into v_neto from public.cuenta_de_la_linea_de_compra(v_d.id) k;
  insert into public.movimientos_materiales
    (id, tipo, origen, orden_compra_detalle_id, material_id, cantidad, documento_referencia, registrado_por,
     precio_unitario, moneda, codigo_interno, requerimiento_linea_id, devuelve_ingreso, se_repone, motivo_devolucion)
  values (p_id, 'DEVOLUCION_PROVEEDOR', 'DEVOLUCION_PROVEEDOR', v_d.id, v_mat.id, p_cantidad, btrim(p_documento),
          public.usuario_actual(), v_ing.precio_unitario, v_ing.moneda, v_ing.codigo_interno, v_ing.requerimiento_linea_id,
          p_ingreso, p_se_repone, btrim(p_motivo));

  perform public.reabrir_rq_por_lo_devuelto(v_d.id, v_neto, v_neto - p_cantidad, v_compra);
  if not p_se_repone then
    perform public.recomprar_lo_devuelto(v_d.id, p_id);
  end if;

  -- «Devolución de 4 UND de …. Motivo: … .», y lo que sigue como otra frase: antes
  -- el motivo se pegaba a «No lo repone: …» o a «El proveedor lo repone.».
  v_motivo := btrim(p_motivo);
  if right(v_motivo, 1) not in ('.', '!', '?') then v_motivo := v_motivo || '.'; end if;
  v_texto := format('Devolución de %s de %s. Motivo: %s', public.cantidad_en_texto(p_cantidad) || coalesce(' ' || v_unidad, ''),
                    v_mat.descripcion, v_motivo);
  perform public.avisar_a_permiso('compras.crear', 'Devuelto al proveedor: ' || v_compra,
    v_texto || case when p_se_repone then ' El proveedor lo repone.'
                    else ' No lo repone: lo que haga falta vuelve a la lista para comprarlo en otra OC.' end,
    '/compras', 'ordenes_compra_materiales', v_c.id);
  if not p_se_repone then
    perform public.avisar_a_permiso('adquisiciones.registrar', 'Espera la nota de crédito: ' || v_compra,
      v_texto || ' El proveedor no lo repone: registra su nota de crédito contra la factura.',
      '/adquisiciones?vista=facturas#notas-credito', 'ordenes_compra_materiales', v_c.id);
  end if;
  return p_id;
end;
$function$;
revoke all on function public.devolver_al_proveedor(uuid, uuid, numeric, text, text, boolean) from public, anon;
grant execute on function public.devolver_al_proveedor(uuid, uuid, numeric, text, text, boolean) to authenticated;
