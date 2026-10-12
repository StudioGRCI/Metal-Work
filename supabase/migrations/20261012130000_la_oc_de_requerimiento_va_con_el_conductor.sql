-- =============================================================================
-- LA OC DE REQUERIMIENTO VA CON EL CONDUCTOR, COMO LA DIRECTA
-- -----------------------------------------------------------------------------
-- La compra que nace del requerimiento de una OT seguía el camino de antes:
-- Logística marcaba «Entregar compra a Almacén» y Almacén la recibía desde los
-- materiales de la OT, sin que nadie dejara constancia de quién la recogió ni
-- cuándo llegó. La directa, en cambio, pasa sola al conductor al aprobarse, él
-- marca que la recogió y que la dejó, y Almacén valida el ingreso sin volver a
-- digitarlo. Gerencia pidió que las dos sigan el mismo circuito.
--
-- Desde esta migración la compra de requerimiento sale sola hacia el conductor
-- en cuanto está lista para comprarse:
--   * si necesita aprobación, cuando Gerencia la aprueba (igual que la directa);
--   * si no la necesita (la regla está apagada o el monto no llega), cuando
--     todas sus líneas tienen precio, que es cuando se sabe si la necesita.
-- Lo demás ya existía: el conductor la ve con su OT, al dejarla nacen los
-- ingresos pendientes con su línea de requerimiento, y la validación de Almacén
-- los registra atados a esa OT. Las compras de antes que todavía no se
-- entregaron no se tocan: Logística las manda con «Mandar a recojo».
-- Sin DROP: las funciones se reemplazan con `create or replace`.
-- =============================================================================

-- 1. Aprobada, sale sola hacia el conductor, sea directa o de requerimiento ------
create or replace function public.fn_compra_recojo()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_orden constant text[] := array['POR_RECOGER', 'RECOGIDO', 'DEJADO'];
  v_antes int; v_ahora int;
begin
  -- La compra aprobada sale sola hacia el conductor.
  if new.aprobacion = 'APROBADA' and old.aprobacion is distinct from 'APROBADA'
     and new.recojo is null and new.entregado_almacen_en is null then
    new.recojo := 'POR_RECOGER';
    new.recojo_pedido_en := now();
    new.recojo_pedido_por := coalesce(new.aprobado_por, public.usuario_actual());
  end if;

  if new.recojo is distinct from old.recojo then
    v_antes := coalesce(array_position(v_orden, old.recojo), 0);
    v_ahora := coalesce(array_position(v_orden, new.recojo), 0);
    if v_ahora <> v_antes + 1 then
      raise exception 'El recojo de la compra % no puede pasar de % a %.',
        coalesce(new.numero, new.referencia), coalesce(old.recojo, 'sin recojo'), coalesce(new.recojo, 'sin recojo')
        using errcode = 'check_violation';
    end if;
    if new.recojo = 'POR_RECOGER' then
      if new.aprobacion in ('POR_APROBAR', 'RECHAZADA') then
        raise exception '%', public.mensaje_compra_sin_aprobar(new) using errcode = 'check_violation';
      end if;
      insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
      select u.id, 'Recojo: ' || coalesce(new.numero, new.referencia),
             new.proveedor || '. Recógela y déjala en el almacén.',
             '/recojos', 'ordenes_compra_materiales', new.id
        from public.usuarios u
        join public.roles_permisos rp on rp.rol_id = u.rol_id and rp.permiso_codigo = 'compras.recojo'
       where u.activo;
    end if;
  end if;

  -- Lo que el conductor marcó queda como evidencia.
  if (old.recogido_en is not null and (new.recogido_en is distinct from old.recogido_en or new.recogido_por is distinct from old.recogido_por))
     or (old.dejado_en is not null and (new.dejado_en is distinct from old.dejado_en or new.dejado_por is distinct from old.dejado_por))
     or (old.recojo_pedido_en is not null and new.recojo_pedido_en is distinct from old.recojo_pedido_en) then
    raise exception 'El recojo de la compra % ya quedó registrado y no se corrige.', coalesce(new.numero, new.referencia)
      using errcode = 'check_violation';
  end if;

  -- Mientras está con el conductor, la entrega a Almacén la marca él al dejarla.
  if new.entregado_almacen_en is not null and old.entregado_almacen_en is null
     and new.recojo in ('POR_RECOGER', 'RECOGIDO') then
    raise exception 'La compra % está con el conductor: la entrega a Almacén se marca cuando él la deja.',
      coalesce(new.numero, new.referencia) using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_compra_recojo() from public, anon, authenticated;

-- 2. Sin aprobación que pedir, sale sola cuando ya tiene todos sus precios -------
-- Es el disparador diferido que evalúa la aprobación al terminar la
-- transacción. Corre una vez por línea insertada o con precio cambiado: la
-- primera que encuentra la compra lista la manda, y las demás ya la ven en
-- recojo y no hacen nada.
create or replace function public.fn_compra_evaluar_aprobacion()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if public.evaluar_aprobacion_compra(new.orden_compra_id) = 'NO_REQUERIDA' then
    update public.ordenes_compra_materiales c
       set recojo = 'POR_RECOGER', recojo_pedido_en = now(),
           recojo_pedido_por = coalesce(public.usuario_actual(), c.creado_por)
     where c.id = new.orden_compra_id
       and c.origen = 'REQUERIMIENTO'
       and c.aprobacion = 'NO_REQUERIDA'
       and c.recojo is null
       and c.entregado_almacen_en is null
       and not exists (select 1 from public.orden_compra_material_detalles d
                        where d.orden_compra_id = c.id and d.precio_unitario is null);
  end if;
  return null;
end;
$$;
revoke all on function public.fn_compra_evaluar_aprobacion() from public, anon, authenticated;

-- 3. El aviso de «espera aprobación» nombra la compra por su número ------------
-- Decía «La compra COT-88…», la referencia del proveedor, y en una directa sin
-- referencia el aviso salía vacío. Ahora usa el número OC-…-MW.
create or replace function public.mensaje_compra_sin_aprobar(p_compra public.ordenes_compra_materiales)
returns text language sql stable security definer set search_path to 'public' as $$
  select case p_compra.aprobacion
    when 'POR_APROBAR' then 'La compra ' || coalesce(p_compra.numero, p_compra.referencia, 'sin número') || ' espera la aprobación de '
         || coalesce((select r.nombre from public.regla_aprobacion_compras g join public.roles r on r.id = g.rol_aprobador_id where g.unica), 'Gerencia')
         || '. Se entrega y se recibe cuando esté aprobada.'
    when 'RECHAZADA' then 'La compra ' || coalesce(p_compra.numero, p_compra.referencia, 'sin número') || ' fue rechazada: ' || coalesce(p_compra.motivo_rechazo, '')
         || '. Emite una nueva orden con las líneas pendientes.'
  end;
$$;
revoke all on function public.mensaje_compra_sin_aprobar(public.ordenes_compra_materiales) from public, anon, authenticated;
