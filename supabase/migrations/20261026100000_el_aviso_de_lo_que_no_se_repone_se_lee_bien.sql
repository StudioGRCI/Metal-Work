-- El aviso de lo que el proveedor ya no repone se lee bien.
--
-- DKS pidió el 26/10 comprobar el aviso que llega cuando el proveedor no repone lo
-- devuelto, «pues eso se verá». Con la cuenta de Almacén marcando «No lo repone» en el
-- banco local, a Logística le llegaron dos avisos. El de la OC decía
-- «4 Tubo cuadrado 2x2 x 2 mm ya no se reponen: El proveedor ya no tiene ese disco y
-- emite nota de crédito Lo que haga falta vuelve a la lista…»: sin la unidad, y con el
-- motivo pegado a la frase siguiente. Lo mismo le llegaba a Contabilidad en «Espera la
-- nota de crédito». Ahora dice «4 UND de Tubo cuadrado 2x2 x 2 mm ya no se reponen.
-- Motivo: … . Lo que haga falta…», como los otros avisos de la devolución.
--
-- Solo cambia el texto del aviso; quién puede, qué se anota y qué vuelve a la lista de
-- Logística siguen igual. Parte de la versión viva: la de la 20261022185000 con el
-- nombre de la OC de la 20261022220000 y el aviso de permiso de la 20261023140000.

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
  -- «4 UND de Tubo cuadrado…», como el resto de avisos de la devolución, y el motivo
  -- como su propia frase: antes salía «4 Tubo… ya no se reponen: …crédito Lo que haga falta».
  select um.codigo into v_unidad from public.materiales mt join public.unidades_medida um on um.id = mt.unidad_medida_id
   where mt.id = v_dev.material_id;
  v_motivo := btrim(p_motivo);
  if right(v_motivo, 1) not in ('.', '!', '?') then v_motivo := v_motivo || '.'; end if;
  v_texto := format('%s %s de %s ya no se reponen. Motivo: %s', public.cantidad_en_texto(v_dev.cantidad - v_repuesto),
                    coalesce(v_unidad, ''), (select mt.descripcion from public.materiales mt where mt.id = v_dev.material_id), v_motivo);
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
