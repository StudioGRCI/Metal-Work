-- =============================================================================
-- LA GESTIÓN DE COMPRAS ES DE LOGÍSTICA Y DEL CONDUCTOR
-- -----------------------------------------------------------------------------
-- DKS lo dijo el 2026-10-20: «gestión de compra no lo tiene por qué ver
-- Contabilidad, si eso solo es para Logística y conductor, nada más, donde
-- podrán ordenar sus compras».
--
-- Hasta aquí la abría quien tuviera `compras.crear` (Logística, pero también
-- Gerencia y Administración, que emiten alguna OC) o `compras.guia_remision`
-- (Contabilidad, que cargaba ahí la guía de remisión). Ocultarla del menú no
-- bastaba: la dirección y la función `compras_en_gestion()` seguían abiertas.
--
-- Desde aquí:
--   * ordenar la lista del conductor tiene permiso propio,
--     `compras.programar_recojo`, y solo lo tiene Logística. La gestión la ven
--     Logística y el conductor (`compras.recojo`), nada más; el administrador
--     sigue entrando por `es_admin()`;
--   * Contabilidad carga y anula la guía de remisión desde Adquisiciones, en la
--     fila de la OC (las funciones `cargar_guia_remision` y
--     `anular_guia_remision` no cambian: siguen pidiendo `compras.guia_remision`).
--     Para saber qué guías le faltan tiene `guias_por_emitir()`, que no muestra
--     la lista del conductor;
--   * los avisos que llevaban a Contabilidad a la gestión la llevan a
--     Adquisiciones, y el de «Programa el recojo» le llega solo a Logística;
--   * la guía de remisión, que es un documento más de la compra, la ve también
--     quien ve Adquisiciones (Tesorería y Gerencia), para seguir la compra de
--     punta a punta (migración 20261020170000);
--   * la lista del conductor tampoco sale por la auditoría: `programacion_recojo`
--     está auditada y Gerencia, con `auditoria.ver`, leía ahí el peso y el lugar
--     de cada recojo que la tabla y `trazabilidad_de_compras()` le tapan.
--
-- Sin DROP de funciones ni de políticas: el conector de producción no deja
-- pasar ninguno.
-- =============================================================================

-- 1. El permiso de Logística ---------------------------------------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('compras.programar_recojo', 'Compras',
   'Ordenar en Gestión de compras qué órdenes de compra recoge el conductor, en qué orden y con qué peso')
on conflict (codigo) do nothing;

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, 'compras.programar_recojo' from public.roles r where r.codigo = 'COMPRADOR'
on conflict do nothing;

-- 2. Quién lee la lista y las guías ------------------------------------------------------
-- La lista del conductor (lugar y peso): Logística y el conductor.
alter policy ver_programacion_recojo on public.programacion_recojo using (
  (select public.es_admin()) or (select public.tiene_permiso('compras.programar_recojo'))
  or (select public.tiene_permiso('compras.recojo')));

-- Las guías: quien las carga (Contabilidad), Logística, el conductor que las
-- lleva y quien sigue la compra en Adquisiciones. Su PDF sigue a esta política
-- por el `exists` de guia_remision_ver (migración 20261015140000).
alter policy ver_guias_remision_compra on public.guias_remision_compra using (
  (select public.es_admin()) or (select public.tiene_permiso('compras.programar_recojo'))
  or (select public.tiene_permiso('compras.guia_remision')) or (select public.tiene_permiso('compras.recojo'))
  or (select public.tiene_permiso('adquisiciones.ver')));

-- La auditoría de la lista, con lo mismo que su política. Es la de
-- 20261020150000 (5. la auditoría no destapa lo tapado) más esa tabla: quien
-- vuelva a escribir esta política tiene que conservar las dos.
alter policy ver_audit_log on public.audit_log using (
  public.es_admin() or (
    public.tiene_permiso('auditoria.ver')
    and (tabla <> all (array['cajas', 'movimientos_caja', 'cierres_caja'])
         or public.tiene_permiso('tesoreria.caja'))
    and (tabla <> all (array['trabajador_remuneraciones', 'trabajador_costos', 'tareos',
                             'trabajador_cuentas'])
         or public.tiene_permiso('rrhh.personal'))
    and (tabla <> all (array['planillas', 'planilla_personas', 'planilla_distribuciones'])
         or public.tiene_permiso('rrhh.ver_planillas'))
    and (tabla <> all (array['cotizaciones_pdf', 'cotizaciones_pdf_versiones', 'cotizaciones_pdf_igv',
                             'ot_presupuestos', 'ot_ventas_anteriores'])
         or public.tiene_permiso('cotizaciones.ver_pdf_comercial'))
    -- Cada tabla, con lo mismo que pide su política de lectura.
    and (tabla <> all (array['facturas_venta', 'cobros_factura_venta'])
         or public.tiene_permiso('contabilidad.facturar') or public.tiene_permiso('cotizaciones.ver_aprobadas')
         or public.tiene_permiso('tesoreria.ver_documentos'))
    and (tabla <> 'cuentas_cobrar_ot'
         or public.tiene_permiso('tesoreria.ver_documentos') or public.tiene_permiso('adquisiciones.ver'))
    and (tabla <> 'proveedor_cuentas' or public.tiene_permiso('proveedores.ver_cuentas'))
    and (tabla <> 'subcontratistas' or public.puede_ver_subcontratos())
    and (tabla <> all (array['planilla_diaria_personas', 'planilla_diaria_detalle'])
         or public.puede_ver_planilla_diaria())
    and (tabla <> 'trabajadores' or public.puede_ver_trabajadores())
    and (tabla <> 'programacion_recojo'
         or public.tiene_permiso('compras.programar_recojo') or public.tiene_permiso('compras.recojo'))
  )
);

-- 3. ¿La cuenta que emitió la OC programa recojos? -----------------------------------------
-- Para decidir a dónde la lleva el aviso de «Compra aprobada».
create or replace function public.usuario_programa_recojos(p_usuario uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.usuarios u
      join public.roles r on r.id = u.rol_id
      left join public.roles_permisos rp on rp.rol_id = u.rol_id and rp.permiso_codigo = 'compras.programar_recojo'
     where u.id = p_usuario and (r.codigo = 'ADMIN' or rp.permiso_codigo is not null));
$$;
revoke all on function public.usuario_programa_recojos(uuid) from public, anon, authenticated;

-- 4. El recojo: el aviso de programarla va solo a Logística --------------------------------
-- Igual que en 20261015140000, con un cambio: «Programa el recojo» se le avisa a
-- quien tiene `compras.programar_recojo`, no a todo el que emite compras.
create or replace function public.fn_compra_recojo()
returns trigger language plpgsql security definer set search_path to 'public' as $$
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

  if new.recojo is distinct from old.recojo then
    v_antes := coalesce(array_position(v_orden, old.recojo), 0);
    v_ahora := coalesce(array_position(v_orden, new.recojo), 0);
    -- Un paso adelante; o de POR_RECOGER a RECOGIDO si no marcó la salida.
    if not (v_ahora = v_antes + 1 or (old.recojo = 'POR_RECOGER' and new.recojo = 'RECOGIDO')) then
      raise exception 'El recojo de la compra % no puede pasar de % a %.',
        coalesce(new.numero, new.referencia), coalesce(old.recojo, 'sin recojo'), coalesce(new.recojo, 'sin recojo')
        using errcode = 'check_violation';
    end if;
    if new.recojo = 'POR_RECOGER' then
      if new.aprobacion in ('POR_APROBAR', 'RECHAZADA') then
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
$$;
revoke all on function public.fn_compra_recojo() from public, anon, authenticated;

-- 5. «Compra aprobada»: a la gestión solo si quien la emitió programa recojos -----------
-- Igual que en 20261015140000. Si la emitió Gerencia o Administración, el aviso
-- ya no la manda a una pantalla que no abre: le dice que la programa Logística,
-- a quien le llega su propio «Programa el recojo».
create or replace function public.aprobar_compra(p_compra uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_compra public.ordenes_compra_materiales%rowtype;
  v_recojo text;
begin
  if not public.es_aprobador_compras() then
    raise exception 'Solo el puesto que aprueba las compras puede aprobarlas.' using errcode = 'insufficient_privilege';
  end if;
  select * into v_compra from public.ordenes_compra_materiales where id = p_compra for update;
  if not found then
    raise exception 'La compra no existe.';
  end if;
  if v_compra.aprobacion = 'APROBADA' then
    return p_compra;
  end if;
  if v_compra.aprobacion <> 'POR_APROBAR' then
    raise exception 'La compra % no está esperando aprobación.', v_compra.referencia using errcode = 'check_violation';
  end if;
  update public.ordenes_compra_materiales
     set aprobacion = 'APROBADA', aprobado_por = public.usuario_actual(), aprobado_en = now(),
         monto_aprobado_pen = monto_pen
   where id = p_compra
  returning recojo into v_recojo;
  if v_recojo = 'POR_RECOGER' and public.usuario_programa_recojos(v_compra.creado_por) then
    perform public.notificar_a_usuario(v_compra.creado_por, 'Compra aprobada: ' || coalesce(v_compra.numero, v_compra.referencia),
      v_compra.proveedor || '. Prográmala en Gestión de compras: su peso y su lugar en la lista del conductor.',
      '/compras/gestion', 'ordenes_compra_materiales', p_compra, public.usuario_actual());
  elsif v_recojo = 'POR_RECOGER' then
    perform public.notificar_a_usuario(v_compra.creado_por, 'Compra aprobada: ' || coalesce(v_compra.numero, v_compra.referencia),
      v_compra.proveedor || '. Logística la programa para que el conductor la recoja.',
      '/compras', 'ordenes_compra_materiales', p_compra, public.usuario_actual());
  else
    perform public.notificar_a_usuario(v_compra.creado_por, 'Compra aprobada: ' || coalesce(v_compra.numero, v_compra.referencia),
      v_compra.proveedor || '. Ya puedes enviarla al proveedor y entregarla a Almacén cuando llegue.',
      '/compras', 'ordenes_compra_materiales', p_compra, public.usuario_actual());
  end if;
  return p_compra;
end;
$$;
revoke all on function public.aprobar_compra(uuid) from public, anon;
grant execute on function public.aprobar_compra(uuid) to authenticated;

-- 6. Programar y sacar de la lista: solo Logística -----------------------------------------
-- Igual que en 20261015140000, con el permiso nuevo y el aviso a Contabilidad
-- llevándola a Adquisiciones.
create or replace function public.programar_recojo(p_compra uuid, p_peso numeric, p_posicion integer default null)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  v_compra  public.ordenes_compra_materiales%rowtype;
  v_antes   public.programacion_recojo%rowtype;
  v_guia    public.guias_remision_compra%rowtype;
  v_cola    uuid[];
  v_n       integer;
  v_lugar   integer;
  v_nombre  text;
  i         integer;
begin
  perform public.exigir_permiso('compras.programar_recojo');
  -- Una lista, un orden: dos personas programando a la vez se esperan.
  perform pg_advisory_xact_lock(hashtext('programacion_recojo'));

  select * into v_compra from public.ordenes_compra_materiales where id = p_compra for update;
  if not found then
    raise exception 'La compra no existe.' using errcode = 'foreign_key_violation';
  end if;
  v_nombre := coalesce(v_compra.numero, v_compra.referencia);
  if v_compra.recojo is null then
    raise exception 'La compra % no va con el conductor.', v_nombre using errcode = 'check_violation';
  end if;
  if v_compra.recojo <> 'POR_RECOGER' then
    raise exception 'El conductor ya salió a recoger la compra %: su lugar y su peso ya no se cambian.', v_nombre
      using errcode = 'check_violation';
  end if;
  if p_peso is null or p_peso <= 0 or p_peso > 100000 then
    raise exception 'Escribe el peso de la compra % en kilos: más de cero.', v_nombre using errcode = 'check_violation';
  end if;
  p_peso := round(p_peso, 2);

  select * into v_antes from public.programacion_recojo where orden_compra_id = p_compra;
  select * into v_guia from public.guias_remision_compra where orden_compra_id = p_compra and anulada_en is null;
  if v_guia.id is not null and v_antes.peso_kg is distinct from p_peso then
    raise exception 'La guía de remisión % ya se emitió con % kg: para cambiar el peso, Contabilidad tiene que anularla primero.',
      v_guia.numero, trim(to_char(v_antes.peso_kg, 'FM999G990D00')) using errcode = 'check_violation';
  end if;

  -- La lista sin esta OC, en su orden; se reescribe 1, 2, 3… con esta en su lugar.
  select coalesce(array_agg(p.orden_compra_id order by p.posicion, p.programado_en, p.orden_compra_id), '{}')
    into v_cola
    from public.programacion_recojo p
    join public.ordenes_compra_materiales c on c.id = p.orden_compra_id
   where c.recojo = 'POR_RECOGER' and p.posicion is not null and p.orden_compra_id <> p_compra;
  v_n := coalesce(array_length(v_cola, 1), 0);
  v_lugar := least(greatest(coalesce(p_posicion, v_n + 1), 1), v_n + 1);

  for i in 1 .. v_n loop
    update public.programacion_recojo
       set posicion = case when i < v_lugar then i else i + 1 end
     where orden_compra_id = v_cola[i]
       and posicion is distinct from (case when i < v_lugar then i else i + 1 end);
  end loop;

  insert into public.programacion_recojo (orden_compra_id, posicion, peso_kg)
  values (p_compra, v_lugar, p_peso)
  on conflict (orden_compra_id) do update
     set posicion = excluded.posicion,
         peso_kg = excluded.peso_kg,
         -- Volver a la lista cuenta como programarla de nuevo.
         programado_por = case when programacion_recojo.posicion is null then public.usuario_actual() else programacion_recojo.programado_por end,
         programado_en = case when programacion_recojo.posicion is null then now() else programacion_recojo.programado_en end
   where programacion_recojo.posicion is distinct from excluded.posicion
      or programacion_recojo.peso_kg is distinct from excluded.peso_kg;

  if v_antes.posicion is null then
    perform public.avisar_a_quien_tiene('compras.recojo',
      'Recojo programado: ' || v_nombre,
      v_compra.proveedor || '. Va ' || v_lugar || '.º en tu lista, ' || trim(to_char(p_peso, 'FM999G990D00')) || ' kg.',
      '/recojos', p_compra);
    if v_guia.id is null then
      perform public.avisar_a_quien_tiene('compras.guia_remision',
        'Guía de remisión por emitir: ' || v_nombre,
        v_compra.proveedor || ', ' || trim(to_char(p_peso, 'FM999G990D00')) || ' kg. Cárgala en Adquisiciones, en la fila de la OC, para que el conductor la lleve.',
        '/adquisiciones?situacion=guia', p_compra);
    end if;
  end if;
  return v_lugar;
end;
$$;
revoke all on function public.programar_recojo(uuid, numeric, integer) from public, anon;
grant execute on function public.programar_recojo(uuid, numeric, integer) to authenticated;

create or replace function public.quitar_recojo_de_la_lista(p_compra uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_compra public.ordenes_compra_materiales%rowtype;
  v_cola   uuid[];
  i        integer;
begin
  perform public.exigir_permiso('compras.programar_recojo');
  perform pg_advisory_xact_lock(hashtext('programacion_recojo'));
  select * into v_compra from public.ordenes_compra_materiales where id = p_compra for update;
  if not found then
    raise exception 'La compra no existe.' using errcode = 'foreign_key_violation';
  end if;
  if v_compra.recojo is distinct from 'POR_RECOGER' then
    raise exception 'El conductor ya salió a recoger la compra %: ya no se saca de su lista.',
      coalesce(v_compra.numero, v_compra.referencia) using errcode = 'check_violation';
  end if;
  -- Un segundo toque no cambia nada.
  if not exists (select 1 from public.programacion_recojo where orden_compra_id = p_compra and posicion is not null) then
    return p_compra;
  end if;
  update public.programacion_recojo set posicion = null where orden_compra_id = p_compra;

  select coalesce(array_agg(p.orden_compra_id order by p.posicion, p.programado_en, p.orden_compra_id), '{}')
    into v_cola
    from public.programacion_recojo p
    join public.ordenes_compra_materiales c on c.id = p.orden_compra_id
   where c.recojo = 'POR_RECOGER' and p.posicion is not null;
  for i in 1 .. coalesce(array_length(v_cola, 1), 0) loop
    update public.programacion_recojo set posicion = i where orden_compra_id = v_cola[i] and posicion <> i;
  end loop;

  perform public.avisar_a_quien_tiene('compras.recojo',
    'Recojo retirado de tu lista: ' || coalesce(v_compra.numero, v_compra.referencia),
    v_compra.proveedor || '. Logística la sacó de tu lista: no salgas a recogerla.',
    '/recojos', p_compra);
  return p_compra;
end;
$$;
revoke all on function public.quitar_recojo_de_la_lista(uuid) from public, anon;
grant execute on function public.quitar_recojo_de_la_lista(uuid) to authenticated;

-- 7. La gestión la ven Logística y el conductor -------------------------------------------
-- Las mismas columnas de 20261015140000; cambia solo quién la lee.
create or replace function public.compras_en_gestion()
returns table (
  id uuid, numero text, referencia text, origen text, proveedor text, proveedor_documento text,
  proveedor_direccion text, proveedor_telefono text, proveedor_contacto text,
  codigo_interno text, con_factura boolean, comprobante_adjunto boolean,
  recojo text, pedido_en timestamptz, en_recojo_en timestamptz, recogido_en timestamptz, dejado_en timestamptz,
  fecha_estimada date, creado_en timestamptz, ordenes text[], requerimientos text[], lineas jsonb,
  en_lista boolean, lugar integer, peso_kg numeric, programado_en timestamptz,
  guia_id uuid, guia_numero text, guia_fecha date, guia_nombre_archivo text, guia_cargada_en timestamptz,
  guias_anuladas integer
) language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  if not (public.es_admin() or public.tiene_permiso('compras.programar_recojo') or public.tiene_permiso('compras.recojo')) then
    raise exception 'La gestión de compras la ven Logística y el conductor.' using errcode = 'insufficient_privilege';
  end if;
  return query
  with lista as (
    select p.orden_compra_id,
           row_number() over (order by p.posicion, p.programado_en, p.orden_compra_id)::integer as lugar
      from public.programacion_recojo p
      join public.ordenes_compra_materiales c on c.id = p.orden_compra_id
     where c.recojo = 'POR_RECOGER' and p.posicion is not null
  )
  select c.id, coalesce(c.numero, c.referencia), c.referencia, c.origen, c.proveedor, pv.numero_documento,
         coalesce(pv.direccion_recojo, pv.direccion), pv.telefono, pv.contacto,
         c.codigo_interno, c.con_factura, public.compra_tiene_comprobante(c),
         c.recojo, c.recojo_pedido_en, c.en_recojo_en, c.recogido_en, c.dejado_en,
         c.fecha_estimada, c.creado_en,
         coalesce(l.ordenes, array[]::text[]),
         coalesce(rq.numeros, array[]::text[]),
         coalesce(l.lineas, '[]'::jsonb),
         pr.posicion is not null, li.lugar, pr.peso_kg, pr.programado_en,
         g.id, g.numero, g.fecha_emision, g.nombre_archivo, g.cargada_en,
         coalesce(ga.n, 0)
    from public.ordenes_compra_materiales c
    left join public.proveedores pv on pv.id = c.proveedor_id
    left join public.programacion_recojo pr on pr.orden_compra_id = c.id
    left join lista li on li.orden_compra_id = c.id
    left join public.guias_remision_compra g on g.orden_compra_id = c.id and g.anulada_en is null
    left join lateral (
      select count(*)::integer as n from public.guias_remision_compra a
       where a.orden_compra_id = c.id and a.anulada_en is not null
    ) ga on true
    left join lateral (
      select array_agg(distinct r.numero order by r.numero) as numeros
        from public.requerimiento_lineas rl
        join public.requerimientos r on r.id = rl.requerimiento_id
       where rl.orden_compra_id = c.id
    ) rq on true
    left join lateral (
      select array_remove(array_agg(distinct o.numero), null) as ordenes,
             jsonb_agg(jsonb_build_object(
               'material_codigo', m.codigo, 'material', m.descripcion, 'unidad', um.codigo,
               'cantidad', d.cantidad, 'orden', o.numero) order by m.descripcion) as lineas
        from public.orden_compra_material_detalles d
        left join public.requerimientos_materiales r on r.id = d.requerimiento_id
        left join public.ordenes_trabajo o on o.id = r.orden_id
        left join public.requerimiento_material_detalles rd on rd.id = d.requerimiento_detalle_id
        left join public.ot_materiales om on om.id = rd.ot_material_id
        left join public.materiales m on m.id = coalesce(d.material_id, om.material_id)
        left join public.unidades_medida um on um.id = m.unidad_medida_id
       where d.orden_compra_id = c.id
    ) l on true
   where c.recojo in ('POR_RECOGER', 'EN_RECOJO', 'RECOGIDO')
      or (c.recojo = 'DEJADO' and c.dejado_en > now() - interval '7 days')
   order by case c.recojo when 'RECOGIDO' then 0 when 'EN_RECOJO' then 1 when 'POR_RECOGER' then 2 else 3 end,
            li.lugar nulls last,
            coalesce(c.dejado_en, c.recojo_pedido_en) desc
   limit 200;
end;
$$;
revoke all on function public.compras_en_gestion() from public, anon;
grant execute on function public.compras_en_gestion() to authenticated;

-- 8. Las guías que le faltan a Contabilidad --------------------------------------------------
-- Las OC que Logística ya programó con su peso (o que el conductor ya lleva) y
-- todavía no tienen guía vigente. Sin el lugar en la lista: eso es de la gestión.
create or replace function public.guias_por_emitir()
returns table (orden_compra_id uuid, numero text, proveedor text, peso_kg numeric, recojo text)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  if not (public.es_admin() or public.tiene_permiso('compras.guia_remision')) then
    raise exception 'Las guías de remisión las carga Contabilidad.' using errcode = 'insufficient_privilege';
  end if;
  return query
  select c.id, coalesce(c.numero, c.referencia), c.proveedor, pr.peso_kg, c.recojo
    from public.ordenes_compra_materiales c
    join public.programacion_recojo pr on pr.orden_compra_id = c.id
   where (c.recojo in ('EN_RECOJO', 'RECOGIDO') or (c.recojo = 'POR_RECOGER' and pr.posicion is not null))
     and not exists (select 1 from public.guias_remision_compra g where g.orden_compra_id = c.id and g.anulada_en is null)
   order by c.recojo_pedido_en, c.id;
end;
$$;
comment on function public.guias_por_emitir() is
  'Las OC con el conductor que ya tienen peso y todavía no tienen guía de remisión vigente. Exige compras.guia_remision.';
revoke all on function public.guias_por_emitir() from public, anon;
grant execute on function public.guias_por_emitir() to authenticated;

-- 9. Los avisos que ya llevaban a la gestión a quien ya no la abre ---------------------------
-- El de la guía, a Adquisiciones; los demás («Programa el recojo», «Compra
-- aprobada… Prográmala»), que les llegaron a Gerencia y a Administración por
-- `compras.crear`, a sus órdenes de compra: si no, el aviso abre «Sin permiso».
-- El texto cambia con la ruta, para que no mande a una pantalla que ya no abren.
do $$ begin
  update public.notificaciones
     set ruta = '/adquisiciones?situacion=guia',
         cuerpo = replace(cuerpo, 'Cárgala en Gestión de compras', 'Cárgala en Adquisiciones, en la fila de la OC,')
   where ruta = '/compras/gestion' and titulo like 'Guía de remisión por emitir:%';
  update public.notificaciones n
     set ruta = '/compras',
         titulo = replace(titulo, 'Programa el recojo:', 'Recojo por programar:'),
         cuerpo = replace(replace(cuerpo,
           'Prográmala en Gestión de compras: su peso y su lugar en la lista del conductor.',
           'Logística la programa para que el conductor la recoja.'),
           'Ponle su peso y su lugar en la lista del conductor.',
           'Logística le pone su peso y su lugar en la lista del conductor.')
   where n.ruta = '/compras/gestion'
     and not public.usuario_programa_recojos(n.usuario_id)
     and not exists (select 1 from public.usuarios u join public.roles_permisos rp on rp.rol_id = u.rol_id
                      where u.id = n.usuario_id and rp.permiso_codigo = 'compras.recojo');
end $$;
