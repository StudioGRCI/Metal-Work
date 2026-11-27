-- =============================================================================
-- LA UNIDAD DE LA OT, Y EL CLIENTE DE LA UNIDAD QUE YA TIENE OT, NO CAMBIAN POR
-- FUERA
-- -----------------------------------------------------------------------------
-- El auditor del PR 294 (el cliente de la OT y de su cotización no cambian por
-- fuera) encontró dos puertas que ya estaban abiertas antes, y StudioGRCI
-- aprobó cerrarlas («Sí, ciérralo», 2026-11-27):
--
--   1. La unidad de una OT cambiaba con un UPDATE directo por la API, con
--      cualquiera de los permisos que dejan editar la OT (también Gerencia, por
--      `ordenes.anular`): la OT quedaba colgada de otro vehículo, con sus
--      planos, su costeo y su entrega, sin historial. Ninguna pantalla lo hace:
--      la OT es de la unidad con la que se cargó, y si es de otra, se anula y se
--      carga la que corresponde. El único camino que la cambia es «Poner
--      cliente» (`poner_cliente_a_orden`), cuando el cliente ya tiene esa misma
--      placa registrada y la OT pasa a su unidad; lo marca en
--      `metalwork.unidad_de_ot`.
--
--   2. Ventas (`clientes.editar`) o Diseño e Ingeniería (`diseno.unidades`)
--      podían cambiar el cliente de una unidad que ya tiene OT con un UPDATE
--      directo: la unidad quedaba de otro cliente y su OT, su cotización y su
--      venta seguían diciendo el de antes, sin historial. La pantalla no lo
--      ofrece (la ficha de la unidad manda el cliente que ya tiene). Desde
--      aquí, con sesión, la unidad que tiene una OT vigente queda del cliente de
--      su OT: cambia de cliente solo con «Editar OT / cambiar cliente», que la
--      pasa con su OT a la cotización del otro comprador y anota la venta
--      anterior (`editar_ot_con_historial_base`), o con «Poner cliente», que se
--      lo pone a la OT sin cliente y a su unidad. Los dos marcan su cambio en
--      `metalwork.cliente_de_unidad`. La unidad sin OT, o cuyas OT se anularon,
--      se sigue corrigiendo como siempre, y la carga de la OT sigue poniéndole
--      el cliente de la cotización a la unidad que no tenía ninguno.
--
-- Lo que corre sin sesión (una migración, la conexión directa) sigue como
-- estaba, como en la 20261127160000.
--
-- En producción, el 2026-11-27: 23 unidades, todas con cliente; 21 con OT;
-- ninguna OT sin unidad y ninguna con un cliente distinto del de su unidad.
-- Nada que arreglar en los datos.
--
-- `editar_ot_con_historial_base` es la de la 20261127003000 y
-- `poner_cliente_a_orden`, la de la 20261127160000; las dos se compararon con
-- producción el 2026-11-27 y se reemplazan solo si siguen siendo esas (o ya son
-- las de esta migración). Cada una cambia solo en las marcas que pone alrededor
-- de su UPDATE. `create or replace` conserva sus permisos.
--
-- Nada se borra. Sin DROP: el conector de producción no deja pasar ninguno.
-- =============================================================================

-- 0. La guarda de la huella -----------------------------------------------------
do $$
declare
  f record;
  huella text;
begin
  for f in
    select * from (values
      ('public.editar_ot_con_historial_base(uuid,timestamptz,jsonb,text)',
       array['52fdcfe044d26f7ccf378a410a5a2e95', 'bc4759f5e1e54c772e115959160761a8']),
      ('public.poner_cliente_a_orden(uuid,uuid)',
       array['5f6c77aef7d0bb85bfa0c0b0d07c5f0b', '6f08fd337ca97fc08622e3200cbef394'])
    ) as t(firma, conocidas)
  loop
    select md5(replace(p.prosrc, E'\r', '')) into huella from pg_proc p where p.oid = to_regprocedure(f.firma);
    if huella is null then
      raise exception 'Falta la función %: esta base no tiene las migraciones anteriores.', f.firma;
    end if;
    if not (huella = any (f.conocidas)) then
      raise exception 'La función % no es la que conoce el repositorio (se cambió a mano): no se reemplaza. Avisa antes de seguir.', f.firma;
    end if;
  end loop;
end $$;

-- 1. La unidad de una OT cambia solo por «Poner cliente» ---------------------------
-- Disparador propio de la OT (la regla del blindaje: no se redefine
-- `fn_ot_antes_update`), sin lista de columnas: un BEFORE que cambiara la
-- unidad no aparece en el SET. No lee tablas: corre como quien escribe.
create or replace function public.fn_ot_unidad_cambia_solo_por_su_camino()
returns trigger
language plpgsql
security invoker
set search_path to 'public'
as $$
begin
  if new.unidad_id is not distinct from old.unidad_id then
    return new;
  end if;
  if coalesce(current_setting('metalwork.unidad_de_ot', true), '') = new.id::text then
    return new;
  end if;
  if public.usuario_actual() is null then
    return new;  -- una migración o la conexión directa, como hasta aquí
  end if;
  if old.unidad_id is null then
    raise exception 'La OT % no tiene unidad y no se le pone por fuera: la OT se carga con su unidad. Si es de una unidad, se anula y se carga con la que corresponde.', old.numero
      using errcode = 'insufficient_privilege';
  end if;
  raise exception 'La OT % es de la unidad con la que se cargó: eso no se cambia por fuera. Si es de otra unidad, se anula y se carga la que corresponde.', old.numero
    using errcode = 'insufficient_privilege';
end;
$$;

revoke all on function public.fn_ot_unidad_cambia_solo_por_su_camino() from public, anon, authenticated;

create or replace trigger trg_ot_unidad_cambia_solo_por_su_camino
  before update on public.ordenes_trabajo
  for each row execute function public.fn_ot_unidad_cambia_solo_por_su_camino();

-- 2. La unidad con OT vigente queda del cliente de su OT ----------------------------
-- Lee las OT por encima del RLS: Diseño y Ventas no leen todas, y la regla vale
-- igual. Cambiar el cliente de la unidad se rechaza solo si deja a una OT
-- vigente con otro cliente que el de su unidad (o sin cliente, la que abrió el
-- taller): la unidad sin OT, la de OT anuladas y la carga que le pone a la
-- unidad sin cliente el de su cotización siguen entrando. El número de la OT,
-- solo a quien lee las órdenes.
create or replace function public.fn_unidad_con_ot_conserva_su_cliente()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ot       text;
  v_sin      boolean;
  v_unidad   text;
begin
  if new.cliente_id is not distinct from old.cliente_id then
    return new;
  end if;
  if coalesce(current_setting('metalwork.cliente_de_unidad', true), '') = new.id::text then
    return new;
  end if;
  if public.usuario_actual() is null then
    return new;  -- una migración o la conexión directa, como hasta aquí
  end if;

  select o.numero, o.cliente_id is null into v_ot, v_sin
    from public.ordenes_trabajo o
   where o.unidad_id = old.id and o.estado <> 'ANULADA'
     and o.cliente_id is distinct from new.cliente_id
   order by (o.cliente_id is null) desc, o.creado_en desc
   limit 1;
  if v_ot is null then
    return new;
  end if;

  v_unidad := coalesce(nullif(btrim(old.codigo_interno), ''), nullif(btrim(old.placa), ''), 'sin placa');
  if not (public.es_admin() or public.tiene_permiso('ordenes.ver') or public.tiene_permiso('ordenes.crear')) then
    v_ot := null;
  end if;
  if v_sin then
    raise exception 'La unidad % es de una OT% que todavía no tiene cliente: el cliente se le pone con «Poner cliente», en el resumen de esa OT, y la unidad queda del mismo.',
      v_unidad, coalesce(' ' || v_ot, '')
      using errcode = 'insufficient_privilege';
  end if;
  raise exception 'La unidad % ya tiene su OT%: su cliente cambia solo con «Editar OT / cambiar cliente», que la pasa con su OT a la cotización aprobada del otro cliente y deja anotada su venta anterior, con su historial.',
    v_unidad, coalesce(' ' || v_ot, '')
    using errcode = 'insufficient_privilege';
end;
$$;

revoke all on function public.fn_unidad_con_ot_conserva_su_cliente() from public, anon, authenticated;

create or replace trigger trg_unidad_con_ot_conserva_su_cliente
  before update on public.unidades
  for each row execute function public.fn_unidad_con_ot_conserva_su_cliente();

-- 3. «Editar OT / cambiar cliente»: la de la 20261127003000, que ahora marca el ---
-- cambio del cliente de la unidad solo mientras la pasa con su OT.
create or replace function public.editar_ot_con_historial_base(p_orden uuid, p_version timestamp with time zone, p_datos jsonb, p_motivo text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  o public.ordenes_trabajo%rowtype;
  u public.unidades%rowtype;
  c public.cotizaciones_pdf%rowtype;
  antes jsonb;
  despues jsonb;
  detalle text;
  nuevo_cliente uuid;
begin
  if public.usuario_actual() is null then raise exception 'Inicia sesión.'; end if;
  perform public.exigir_permiso('ordenes.editar');
  if not public.puede_ver_orden(p_orden) then raise exception 'No puedes editar esta orden.'; end if;
  if length(btrim(coalesce(p_motivo,''))) not between 5 and 1000 then
    raise exception 'Explica el motivo del cambio (5 a 1000 caracteres).';
  end if;
  if jsonb_typeof(p_datos) <> 'object' or p_datos is null then raise exception 'Datos incompletos.'; end if;
  if exists(select 1 from jsonb_object_keys(p_datos) k where k not in
    ('descripcion','prioridad','fecha_entrega_comprometida','codigo_interno','marca','modelo','unidad_version','cotizacion_nueva_id')) then
    raise exception 'El cambio contiene campos no permitidos.';
  end if;
  if length(btrim(coalesce(p_datos->>'descripcion',''))) not between 5 and 5000
    or coalesce(p_datos->>'prioridad','') not in ('BAJA','NORMAL','ALTA','URGENTE')
    or coalesce(p_datos->>'fecha_entrega_comprometida','') !~ '^\d{4}-\d{2}-\d{2}$'
    or length(coalesce(p_datos->>'codigo_interno','')) > 40
    or (nullif(btrim(coalesce(p_datos->>'codigo_interno','')),'') is not null
        and regexp_replace(btrim(p_datos->>'codigo_interno'), '[^A-Za-z0-9]', '', 'g') = '')
    or length(coalesce(p_datos->>'marca','')) > 80 or length(coalesce(p_datos->>'modelo','')) > 80 then
    raise exception 'Revisa descripción, prioridad, fecha y datos del chasis.';
  end if;

  select * into o from public.ordenes_trabajo where id=p_orden for update;
  if not found then raise exception 'No se encontró la orden.'; end if;
  if o.actualizado_en is distinct from p_version then
    raise exception 'La OT cambió mientras la editabas. Recarga y revisa antes de guardar.';
  end if;
  if o.estado in ('ENTREGADA','FACTURADA','ANULADA') then raise exception 'La OT ya está cerrada.'; end if;
  select * into u from public.unidades where id=o.unidad_id for update;
  if u.id is not null and u.actualizado_en is distinct from (p_datos->>'unidad_version')::timestamptz then
    raise exception 'Los datos de la unidad cambiaron. Recarga antes de guardar.';
  end if;

  antes := jsonb_build_object('descripcion',o.descripcion,'prioridad',o.prioridad,
    'fecha_entrega_comprometida',o.fecha_entrega_comprometida,
    'codigo_interno',u.codigo_interno,'marca',u.marca,'modelo',u.modelo,
    'cliente',(select razon_social from public.clientes where id=o.cliente_id),
    'cliente_id',o.cliente_id,'cotizacion_pdf_id',o.cotizacion_pdf_id,
    'unidad',coalesce(o.numero_de_unidad,1));
  nuevo_cliente := o.cliente_id;

  if nullif(p_datos->>'cotizacion_nueva_id','') is not null then
    perform public.exigir_permiso('cotizaciones.ver_pdf_comercial');
    select * into c from public.cotizaciones_pdf
     where id=(p_datos->>'cotizacion_nueva_id')::uuid for update;
    if not found or c.estado <> 'APROBADA' then raise exception 'Elige una nueva cotización aprobada.'; end if;
    if c.cliente_id is not distinct from o.cliente_id then raise exception 'La nueva venta debe corresponder a otro cliente.'; end if;
    if c.tipo_carroceria_id is distinct from o.tipo_carroceria_id then raise exception 'La nueva cotización debe ser de la misma carrocería.'; end if;
    if not exists(select 1 from public.clientes where id=c.cliente_id and activo) then raise exception 'El nuevo cliente no está activo.'; end if;
    if exists(select 1 from public.liberaciones_tesoreria where orden_id=o.id)
       or exists(select 1 from public.ot_entregas where orden_id=o.id) then
      raise exception 'Esta OT ya tiene liberación o entrega registrada. Resuelve esos documentos antes de cambiar de cliente.';
    end if;
    nuevo_cliente := c.cliente_id;
  end if;

  if u.id is not null and (
    nuevo_cliente is distinct from o.cliente_id
    or coalesce(u.codigo_interno,'') is distinct from btrim(coalesce(p_datos->>'codigo_interno',''))
    or coalesce(u.marca,'') is distinct from btrim(coalesce(p_datos->>'marca',''))
    or coalesce(u.modelo,'') is distinct from btrim(coalesce(p_datos->>'modelo',''))
  ) then
    if exists(select 1 from public.ordenes_trabajo where unidad_id=u.id and id<>o.id) then
      raise exception 'La unidad tiene otras OT. No se pueden cambiar sus datos compartidos desde esta orden.';
    end if;
    if exists(select 1 from public.unidades where id<>u.id
      and upper(regexp_replace(btrim(coalesce(codigo_interno,'')), '[^A-Za-z0-9]', '', 'g')) =
          upper(regexp_replace(btrim(coalesce(p_datos->>'codigo_interno','')), '[^A-Za-z0-9]', '', 'g'))
      and nullif(btrim(p_datos->>'codigo_interno'),'') is not null) then
      raise exception 'Ese código interno ya identifica otra unidad.';
    end if;
    -- El disparador del cliente de la unidad reconoce este camino por la marca (20261127183500).
    perform set_config('metalwork.cliente_de_unidad', u.id::text, true);
    update public.unidades set
      codigo_interno=nullif(upper(btrim(p_datos->>'codigo_interno')),''),
      marca=nullif(btrim(p_datos->>'marca'),''), modelo=nullif(btrim(p_datos->>'modelo'),''),
      cliente_id=case when nuevo_cliente is distinct from o.cliente_id then nuevo_cliente else cliente_id end
    where id=u.id;
    perform set_config('metalwork.cliente_de_unidad', '', true);
  end if;

  if c.id is not null then
    insert into public.ot_ventas_anteriores(orden_id,cliente_id,cotizacion_pdf_id,datos,creado_por)
    values(o.id,o.cliente_id,o.cotizacion_pdf_id,antes,public.usuario_actual());
    -- El disparador de la OT reconoce el traspaso por esta marca (20261127003000).
    perform set_config('metalwork.traspaso_de_ot', o.id::text, true);
  end if;

  update public.ordenes_trabajo set
    descripcion=btrim(p_datos->>'descripcion'),
    prioridad=(p_datos->>'prioridad')::public.prioridad_ot,
    fecha_entrega_comprometida=(p_datos->>'fecha_entrega_comprometida')::date,
    cliente_id=nuevo_cliente,
    cotizacion_pdf_id=coalesce(c.id,o.cotizacion_pdf_id)
  where id=o.id;
  perform set_config('metalwork.traspaso_de_ot', '', true);

  select jsonb_build_object('descripcion',ot.descripcion,'prioridad',ot.prioridad,
    'fecha_entrega_comprometida',ot.fecha_entrega_comprometida,
    'codigo_interno',un.codigo_interno,'marca',un.marca,'modelo',un.modelo,
    'cliente',cl.razon_social,'cliente_id',ot.cliente_id,'cotizacion_pdf_id',ot.cotizacion_pdf_id,
    'unidad',coalesce(ot.numero_de_unidad,1))
    into despues from public.ordenes_trabajo ot
    left join public.unidades un on un.id=ot.unidad_id
    left join public.clientes cl on cl.id=ot.cliente_id where ot.id=o.id;
  if antes=despues then raise exception 'No hay cambios para guardar.'; end if;
  select string_agg(format('%s: %s → %s',k,coalesce(antes->>k,'Sin dato'),coalesce(despues->>k,'Sin dato')),E'\n')
    into detalle from jsonb_object_keys(despues) k
   where antes->k is distinct from despues->k and k not in ('cliente_id','cotizacion_pdf_id');
  perform public.ot_registrar_evento_interna(o.id,'COMENTARIO',
    'Edición de OT. Motivo: '||btrim(p_motivo)||E'\n'||coalesce(detalle,''),
    jsonb_build_object('edicion_ot',true,'antes',antes,'despues',despues,'motivo',btrim(p_motivo)));
  return o.id;
end;
$function$;

revoke all on function public.editar_ot_con_historial_base(uuid,timestamptz,jsonb,text) from public, anon, authenticated;

-- 4. «Poner cliente»: la de la 20261127160000, que ahora marca también el cambio --
-- de la unidad de la OT (cuando el cliente ya tiene esa placa) y el del cliente
-- de la unidad, solo mientras los hace.
create or replace function public.poner_cliente_a_orden(p_orden uuid, p_cliente uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_orden   record;
  v_unidad  record;
  v_misma   uuid;
  v_nombre  text;
begin
  perform public.exigir_permiso('ordenes.editar');

  select o.id, o.numero, o.cliente_id, o.unidad_id, o.estado into v_orden
    from public.ordenes_trabajo o where o.id = p_orden
     for update;
  if v_orden.id is null then
    raise exception 'No se encontró la orden.' using errcode = 'foreign_key_violation';
  end if;
  if v_orden.cliente_id is not null then
    raise exception 'La orden % ya tiene cliente.', v_orden.numero using errcode = 'check_violation';
  end if;
  if v_orden.estado in ('ENTREGADA', 'FACTURADA', 'ANULADA') then
    raise exception 'La orden % ya está cerrada.', v_orden.numero using errcode = 'check_violation';
  end if;

  select c.razon_social into v_nombre from public.clientes c where c.id = p_cliente and c.activo;
  if v_nombre is null then
    raise exception 'Elige el cliente de la lista.' using errcode = 'foreign_key_violation';
  end if;

  if v_orden.unidad_id is not null then
    select u.id, u.cliente_id, u.placa into v_unidad
      from public.unidades u where u.id = v_orden.unidad_id
       for update;

    if v_unidad.cliente_id is not null and v_unidad.cliente_id <> p_cliente then
      raise exception 'La unidad % es de otro cliente: la orden no puede ser de %.', v_unidad.placa, rtrim(v_nombre, '.')
        using errcode = 'check_violation';
    end if;

    if v_unidad.cliente_id is null then
      select u.id into v_misma
        from public.unidades u
       where u.cliente_id = p_cliente
         and v_unidad.placa is not null
         and upper(regexp_replace(coalesce(u.placa, ''), '[^A-Za-z0-9]', '', 'g'))
             = upper(regexp_replace(v_unidad.placa, '[^A-Za-z0-9]', '', 'g'))
       limit 1;

      -- Los disparadores de la unidad de la OT y del cliente de la unidad
      -- reconocen este camino por sus marcas (20261127183500).
      if v_misma is not null then
        perform set_config('metalwork.unidad_de_ot', p_orden::text, true);
        update public.ordenes_trabajo set unidad_id = v_misma where id = p_orden;
        perform set_config('metalwork.unidad_de_ot', '', true);
        update public.unidades set activo = false where id = v_unidad.id;
      else
        perform set_config('metalwork.cliente_de_unidad', v_unidad.id::text, true);
        update public.unidades set cliente_id = p_cliente where id = v_unidad.id;
        perform set_config('metalwork.cliente_de_unidad', '', true);
      end if;
    end if;
  end if;

  -- El disparador del cliente de la OT reconoce este camino por la marca (20261127160000).
  perform set_config('metalwork.cliente_de_ot', p_orden::text, true);
  update public.ordenes_trabajo set cliente_id = p_cliente where id = p_orden;
  perform set_config('metalwork.cliente_de_ot', '', true);

  perform public.ot_registrar_evento(
    p_orden, 'COMENTARIO', format('Se le puso el cliente: %s.', rtrim(v_nombre, '.')),
    jsonb_build_object('cliente_id', p_cliente));
end;
$function$;

revoke all on function public.poner_cliente_a_orden(uuid, uuid) from public, anon;
grant execute on function public.poner_cliente_a_orden(uuid, uuid) to authenticated;
