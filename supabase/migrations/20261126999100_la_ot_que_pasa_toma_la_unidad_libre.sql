-- =============================================================================
-- LA OT QUE PASA A OTRO COMPRADOR TOMA LA UNIDAD LIBRE DE SU NUEVA COTIZACIÓN
-- -----------------------------------------------------------------------------
-- Con «Editar OT» una OT pasa a la cotización aprobada de otro cliente. Desde
-- que una cotización lleva varias unidades (20261126760000), cada OT guarda qué
-- unidad es y ese número no se cambiaba nunca, tampoco al pasar. Por eso
-- Administración solo podía pasar la OT de la unidad 1 a una cotización de una
-- unidad sin OT; todo lo demás lo rechazaba la base:
--
--   · La OT de la unidad 2 o la 3 a una cotización de 1 unidad: «La cotización
--     … es de 1 unidades: no tiene unidad 2.»
--   · Cualquier OT a una cotización de varias unidades que ya tenía una OT,
--     aunque le faltaran otras: «La nueva cotización ya tiene una OT.»
--
-- Lo encontró el auditor de funcionamiento del plan 8 y StudioGRCI decidió el
-- 2026-11-27: «Sí, en un PR aparte». Desde aquí:
--
--   · Al pasar, la OT toma la primera unidad libre de la cotización nueva: la
--     que no tiene OT vigente ni pasó ella misma a otro comprador. Si la OT
--     vuelve a una cotización donde ya estuvo (el traspaso fue un error), toma
--     la unidad que tenía ahí, si sigue libre.
--   · La unidad que dejó en la cotización de antes se guarda con su venta
--     anterior (`ot_ventas_anteriores.numero_de_unidad`). De ahí la leen la
--     carga de la OT que falta (no vuelve a dar ese número), la tarjeta y
--     Facturación (`unidades_que_salieron_de_la_cotizacion`) y el recorrido
--     (`unidad_que_dejo_la_ot`).
--   · La cotización nueva ya no rechaza la OT por tener otra: la rechaza solo si
--     no le queda ninguna unidad libre, con el mensaje de siempre
--     (`fn_ot_cabe_en_su_cotizacion`).
--   · De las unidades libres, primero la que no tiene una factura propia (de un
--     vehículo cuya OT se anuló): así la OT que llega no se queda con la factura
--     de otro. La descripción que puso la carga («cotización … · unidad 2 de
--     3») se pone al día, y el historial de la OT dice el cambio de unidad.
--   · Una OT pasa a otra cotización solo con «Editar OT»: un UPDATE directo
--     de la columna, que cualquier permiso de editar la OT dejaba hacer, la
--     colgaba de otro cliente sin venta anterior ni historial. El número de
--     unidad sigue sin poder cambiarse a mano (`fn_ot_unidad_no_cambia`).
--
-- Las ventas anteriores que ya existen se anotan con la unidad que tiene hoy su
-- OT: hasta esta migración el número no cambiaba al pasar, así que es la que
-- dejó. En producción no hay ninguna (2026-11-27).
--
-- `unidades_que_salieron_de_la_cotizacion` es la de la 20261126988000 y
-- `editar_ot_con_historial_base`, la de la 20260927234131 (renombrada en la
-- 20260929100001); las dos se compararon con producción el 2026-11-27 y se
-- reemplazan solo si siguen siendo esas. `unidad_que_dejo_la_ot` la crea
-- también la migración del recorrido por unidad (20261126998900, hilo
-- «Facturar por unidad cotizada»), solo si no existe: aquí se reemplaza su
-- cuerpo para que lea la unidad guardada, con la misma firma, si es la de esa
-- migración o la de esta; corran en el orden que corran, queda esta.
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
       array['da2e3b8668ad4ffdbf7fedae9cf12f10', '426129684db2388abfa49ed2491c7267']),
      ('public.unidades_que_salieron_de_la_cotizacion(uuid)',
       array['0bf4296cc324582738e00d94eccfd2d5', '530ad26c7cdfd872698485ce883a9589'])
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

-- El ayudante del recorrido, si ya está, tiene que ser el de la 20261126998900
-- o el de esta.
do $$
declare
  huella text;
begin
  select md5(replace(p.prosrc, E'\r', '')) into huella
    from pg_proc p where p.oid = to_regprocedure('public.unidad_que_dejo_la_ot(uuid,uuid)');
  if huella is not null and not (huella = any (array['8e744f3b6a89dcb80bf3e112ffb9b95d', '67ad69a7a03060724ae3efd6428b5c80'])) then
    raise exception 'La función public.unidad_que_dejo_la_ot(uuid,uuid) no es la que conoce el repositorio (se cambió a mano): no se reemplaza. Avisa antes de seguir.';
  end if;
end $$;

-- 1. La venta anterior guarda qué unidad era --------------------------------------
alter table public.ot_ventas_anteriores
  add column if not exists numero_de_unidad smallint;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_ot_ventas_anteriores_numero_de_unidad') then
    alter table public.ot_ventas_anteriores
      add constraint ck_ot_ventas_anteriores_numero_de_unidad check (numero_de_unidad between 1 and 50);
  end if;
end $$;

comment on column public.ot_ventas_anteriores.numero_de_unidad is
  'La unidad que era la OT en esta cotización cuando pasó a otro comprador: en la cotización nueva toma la unidad libre (migración 20261126999100).';

-- La pone la base con la unidad que la OT tiene en ese momento: la venta
-- anterior se anota antes de mover la OT. No se confía en lo que traiga el insert.
create or replace function public.fn_venta_anterior_guarda_su_unidad()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  select coalesce(o.numero_de_unidad, 1) into new.numero_de_unidad
    from public.ordenes_trabajo o
   where o.id = new.orden_id;
  return new;
end;
$$;

revoke all on function public.fn_venta_anterior_guarda_su_unidad() from public, anon, authenticated;

create or replace trigger trg_venta_anterior_guarda_su_unidad
  before insert on public.ot_ventas_anteriores
  for each row execute function public.fn_venta_anterior_guarda_su_unidad();

-- Las de antes: hasta aquí la OT conservaba su número al pasar, así que el de
-- hoy es el que dejó. Dentro de un bloque: un UPDATE suelto cuelga el conector.
do $$
begin
  update public.ot_ventas_anteriores va
     set numero_de_unidad = coalesce(o.numero_de_unidad, 1)
    from public.ordenes_trabajo o
   where o.id = va.orden_id
     and va.numero_de_unidad is null;
end $$;

-- 2. Qué unidad dejó una OT en una cotización -------------------------------------
-- La de su última salida de esa cotización; las filas sin número (no debería
-- quedar ninguna), la de la OT. Ayudante interno: lo llaman funciones que
-- corren como dueñas. La firma es la de la migración del recorrido por unidad.
create or replace function public.unidad_que_dejo_la_ot(p_orden uuid, p_cotizacion uuid)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
           (select va.numero_de_unidad::integer
              from public.ot_ventas_anteriores va
             where va.orden_id = p_orden and va.cotizacion_pdf_id = p_cotizacion
             order by va.creado_en desc, va.id desc
             limit 1),
           (select coalesce(o.numero_de_unidad, 1)::integer from public.ordenes_trabajo o where o.id = p_orden),
           1);
$$;

comment on function public.unidad_que_dejo_la_ot(uuid, uuid) is
  'Qué unidad era la OT en esa cotización cuando salió de ella: la guardada con su venta anterior (ot_ventas_anteriores.numero_de_unidad), o la de la OT en filas sin número (migraciones 20261126998900 y 20261126999100).';

revoke all on function public.unidad_que_dejo_la_ot(uuid, uuid) from public, anon, authenticated;

-- 3. Al pasar, la OT toma la unidad libre de su nueva cotización ---------------------
-- Corre antes que `trg_ot_cabe_en_su_cotizacion` (los disparadores BEFORE van
-- por nombre), que después juzga si cabe con el número ya puesto. Bloquea la
-- cotización nueva antes de contar, como aquel: dos traspasos a la vez a la
-- misma cotización se ponen en fila. Si no queda ninguna libre, deja la unidad
-- sin número y el disparador de la cotización dice por qué no cabe; sin eso,
-- la OT de la unidad 2 decía «no tiene unidad 2» en vez de «ya tiene su OT».
--
-- Una OT con cotización pasa a otra solo con «Editar OT», que en la misma
-- transacción anota la venta de antes con la unidad que deja y lo marca en
-- `metalwork.traspaso_de_ot`. Hasta aquí un UPDATE directo de la columna, con
-- cualquiera de los permisos que dejan editar la OT, la colgaba de la
-- cotización de otro cliente sin venta anterior, sin historial y sin cambiar
-- el cliente (lo vio el auditor de funcionamiento). Colgar de una cotización la
-- OT que no tenía ninguna sigue como estaba, y también lo que corre sin sesión
-- (una migración, la conexión directa).
--
-- De las unidades libres, primero la que no tiene una factura vigente solo de
-- ella: esa es de un vehículo cuya OT se anuló, y la OT que llega se quedaría
-- con su factura (el mismo caso que la carga avisa con
-- `unidades_libres_ya_facturadas`). Si solo quedan unidades así, toma la
-- primera, como la carga.
--
-- La descripción que puso la carga («… · cotización 3568-2026 · unidad 2 de
-- 3») se pone al día con la cotización y la unidad nuevas; la que se escribió
-- a mano no se toca.
create or replace function public.fn_ot_a_otra_venta_toma_la_unidad_libre()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_cantidad integer;
  v_numero   text;
  v_de_antes text;
  v_ocupadas integer[];
  v_antes    integer;
  v_n        integer;
begin
  if new.cotizacion_pdf_id is null
     or new.cotizacion_pdf_id is not distinct from old.cotizacion_pdf_id
     or new.estado = 'ANULADA' then
    return new;
  end if;
  if coalesce(current_setting('metalwork.traspaso_de_ot', true), '') is distinct from new.id::text then
    if old.cotizacion_pdf_id is not null and public.usuario_actual() is not null then
      raise exception 'La OT % pasa a la cotización de otro comprador solo con «Editar OT / cambiar cliente»: así queda anotada su venta anterior, con su historial.', old.numero
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  select c.cantidad_unidades, c.numero into v_cantidad, v_numero
    from public.cotizaciones_pdf c
   where c.id = new.cotizacion_pdf_id
     for update;
  if not found then
    return new;  -- la llave foránea lo dice
  end if;

  -- Las unidades que tienen OT vigente y las que pasaron a otro comprador,
  -- menos esta misma OT si vuelve a una cotización de la que había salido.
  select coalesce(array_agg(x.k), '{}') into v_ocupadas
    from (select coalesce(o.numero_de_unidad, 1)::integer as k
            from public.ordenes_trabajo o
           where o.cotizacion_pdf_id = new.cotizacion_pdf_id and o.estado <> 'ANULADA' and o.id <> new.id
          union
          select public.unidad_que_dejo_la_ot(s.orden_id, new.cotizacion_pdf_id)
            from public.salidas_de_la_cotizacion(new.cotizacion_pdf_id, new.id) s) x;

  -- Vuelve a una cotización donde ya estuvo: la unidad que tenía, si sigue libre.
  if exists (select 1 from public.ot_ventas_anteriores va
              where va.orden_id = new.id and va.cotizacion_pdf_id = new.cotizacion_pdf_id) then
    v_antes := public.unidad_que_dejo_la_ot(new.id, new.cotizacion_pdf_id);
  end if;
  if v_antes between 1 and v_cantidad and not (v_antes = any (v_ocupadas)) then
    v_n := v_antes;
  else
    select k into v_n
      from generate_series(1, v_cantidad) k
     where not (k = any (v_ocupadas))
     order by exists (select 1
                        from public.facturas_venta_unidades p
                        join public.facturas_venta f on f.id = p.factura_id
                       where f.cotizacion_pdf_id = new.cotizacion_pdf_id and f.anulada_en is null
                         and p.numero_de_unidad = k
                         and (select count(*) from public.facturas_venta_unidades x where x.factura_id = f.id) = 1),
              k
     limit 1;
  end if;
  new.numero_de_unidad := v_n;

  -- La descripción que armó la carga dice de qué cotización y qué unidad era.
  select c.numero into v_de_antes from public.cotizaciones_pdf c where c.id = old.cotizacion_pdf_id;
  if v_n is not null and v_de_antes is not null and position('cotización ' || v_de_antes in new.descripcion) > 0 then
    new.descripcion := regexp_replace(replace(new.descripcion, 'cotización ' || v_de_antes, 'cotización ' || v_numero),
                                      ' · unidad \d+ de \d+$', '')
                       || case when v_cantidad > 1 then format(' · unidad %s de %s', v_n, v_cantidad) else '' end;
  end if;
  return new;
end;
$$;

revoke all on function public.fn_ot_a_otra_venta_toma_la_unidad_libre() from public, anon, authenticated;

create or replace trigger trg_ot_a_otra_venta_toma_la_unidad_libre
  before update of cotizacion_pdf_id on public.ordenes_trabajo
  for each row execute function public.fn_ot_a_otra_venta_toma_la_unidad_libre();

-- 4. Qué unidades salieron de una cotización: la que dejó cada OT -----------------
-- Antes leía el número de la OT, que era el mismo; ahora la OT toma otro en la
-- cotización nueva y el de aquí queda en su venta anterior.
create or replace function public.unidades_que_salieron_de_la_cotizacion(p_cotizacion uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object('unidad', x.unidad, 'numero', case when v.ve then x.numero end)
                            order by x.unidad, x.numero), '[]'::jsonb)
    from (select public.unidad_que_dejo_la_ot(s.orden_id, p_cotizacion) as unidad, o.numero
            from public.salidas_de_la_cotizacion(p_cotizacion, null) s
            join public.ordenes_trabajo o on o.id = s.orden_id) x
    cross join (select public.es_admin() or public.tiene_permiso('ordenes.ver') or public.tiene_permiso('ordenes.crear') as ve) v;
$$;

comment on function public.unidades_que_salieron_de_la_cotizacion(uuid) is
  'Cada unidad de la cotización cuya OT pasó a otro comprador: [{unidad, numero}], la unidad que la OT dejó aquí (ot_ventas_anteriores.numero_de_unidad) y el número de la OT solo para quien lee o carga las órdenes (migraciones 20261126988000 y 20261126999100).';

revoke all on function public.unidades_que_salieron_de_la_cotizacion(uuid) from public, anon;
grant execute on function public.unidades_que_salieron_de_la_cotizacion(uuid) to authenticated;

-- 5. «Editar OT» ya no rechaza la cotización nueva por tener otra OT ----------------
-- La misma función de la 20260927234131 con tres cambios: sin «La nueva
-- cotización ya tiene una OT.» (si no le queda unidad libre, lo dice
-- `fn_ot_cabe_en_su_cotizacion` al mover la OT, y todo vuelve atrás); marca el
-- traspaso para el disparador de la sección 3 solo mientras mueve la OT; y el
-- historial dice también el cambio de unidad («unidad: 2 → 1»).
CREATE OR REPLACE FUNCTION public.editar_ot_con_historial_base(p_orden uuid, p_version timestamp with time zone, p_datos jsonb, p_motivo text)
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
    update public.unidades set
      codigo_interno=nullif(upper(btrim(p_datos->>'codigo_interno')),''),
      marca=nullif(btrim(p_datos->>'marca'),''), modelo=nullif(btrim(p_datos->>'modelo'),''),
      cliente_id=case when nuevo_cliente is distinct from o.cliente_id then nuevo_cliente else cliente_id end
    where id=u.id;
  end if;

  if c.id is not null then
    insert into public.ot_ventas_anteriores(orden_id,cliente_id,cotizacion_pdf_id,datos,creado_por)
    values(o.id,o.cliente_id,o.cotizacion_pdf_id,antes,public.usuario_actual());
    -- El disparador de la OT reconoce el traspaso por esta marca (20261126999100).
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
