-- =============================================================================
-- EL CONDUCTOR MARCA QUE SALE A RECOGER Y EL RQ MUESTRA SU AVANCE
-- -----------------------------------------------------------------------------
-- Gerencia pidió (2026-10-13) que el recojo sea un botón para la trazabilidad
-- del requerimiento: ver en qué porcentaje va cada RQ y distinguir los que
-- están PENDIENTES DE RECOJO de los que ya están EN RECOJO. Hasta aquí el
-- conductor solo marcaba «Ya la recogí» y «La dejé en almacén»: entre que
-- Gerencia aprobaba la OC y que él volvía con el material, nadie sabía si ya
-- había salido.
--
-- Desde aquí:
--   * el recojo tiene un paso más, EN_RECOJO, que el conductor marca con
--     «Salgo a recoger» (queda quién y cuándo). Es POR_RECOGER → EN_RECOJO →
--     RECOGIDO → DEJADO; si el conductor no tocó «Salgo a recoger» y marca
--     directo que la recogió, pasa igual y la salida queda en blanco, sin
--     inventar una hora;
--   * `avance_de_requerimientos` calcula el porcentaje de cada RQ a partir de
--     su estado, del estado de la OC de cada insumo y de su recojo. No cambia
--     los estados del RQ ni sus funciones (son del área de Requerimientos);
--     solo los lee. Lo ven todos los que ven requerimientos, aunque no puedan
--     leer las órdenes de compra (Supervisión, Requerimientos): por eso es
--     `security definer` y devuelve solo número de OC y etapa, sin precios.
--
-- Sin DROP: el conector de producción no deja pasar ninguno.
-- =============================================================================

-- 1. Quién salió a recoger y cuándo -----------------------------------------------
-- Sin índice para en_recojo_por: ninguna pantalla filtra por él y el usuario no
-- se borra (se desactiva). Igual que recogido_por y dejado_por.
alter table public.ordenes_compra_materiales
  add column if not exists en_recojo_en  timestamptz,
  add column if not exists en_recojo_por uuid references public.usuarios(id) on delete restrict;

alter table public.ordenes_compra_materiales
  drop constraint if exists ck_compra_recojo,
  add constraint ck_compra_recojo check (
    (recojo is null or recojo in ('POR_RECOGER', 'EN_RECOJO', 'RECOGIDO', 'DEJADO'))
    and (recojo is null or recojo_pedido_en is not null)
    and ((en_recojo_en is null) = (en_recojo_por is null))
    and (recojo is distinct from 'EN_RECOJO' or en_recojo_en is not null)
    and (recojo is distinct from 'RECOGIDO' or (recogido_en is not null and recogido_por is not null))
    and (recojo is distinct from 'DEJADO' or (recogido_en is not null and dejado_en is not null and dejado_por is not null
                                              and entregado_almacen_en is not null))
  );

comment on column public.ordenes_compra_materiales.recojo is
  'null (no va con el conductor), POR_RECOGER, EN_RECOJO (el conductor salió a recogerla), RECOGIDO o DEJADO. Solo avanza; EN_RECOJO se puede saltar.';
comment on column public.ordenes_compra_materiales.en_recojo_en is
  'Cuándo el conductor marcó «Salgo a recoger». Vacía si marcó directo que la recogió.';

-- 2. El disparador del recojo conoce el paso nuevo --------------------------------
-- Igual que en 20261012130000, con EN_RECOJO en el orden, el salto de
-- POR_RECOGER a RECOGIDO permitido y la salida guardada como evidencia.
create or replace function public.fn_compra_recojo()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_orden constant text[] := array['POR_RECOGER', 'EN_RECOJO', 'RECOGIDO', 'DEJADO'];
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

-- 3. «Salgo a recoger» --------------------------------------------------------------
-- Mismo permiso que los otros dos pasos del conductor: compras.recojo.
create or replace function public.marcar_compra_en_recojo(p_compra uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_compra public.ordenes_compra_materiales%rowtype;
begin
  perform public.exigir_permiso('compras.recojo');
  select * into v_compra from public.ordenes_compra_materiales where id = p_compra for update;
  if not found then
    raise exception 'La compra no existe.' using errcode = 'foreign_key_violation';
  end if;
  -- Un segundo toque, o una pantalla vieja, no cambia nada.
  if v_compra.recojo in ('EN_RECOJO', 'RECOGIDO', 'DEJADO') then
    return p_compra;
  end if;
  if v_compra.recojo is distinct from 'POR_RECOGER' then
    raise exception 'La compra % no está mandada a recojo.', coalesce(v_compra.numero, v_compra.referencia) using errcode = 'check_violation';
  end if;
  update public.ordenes_compra_materiales
     set recojo = 'EN_RECOJO', en_recojo_en = now(), en_recojo_por = public.usuario_actual()
   where id = p_compra;
  return p_compra;
end;
$$;
revoke all on function public.marcar_compra_en_recojo(uuid) from public, anon;
grant execute on function public.marcar_compra_en_recojo(uuid) to authenticated;

-- «Ya la recogí» vale desde EN_RECOJO o, si no marcó la salida, desde POR_RECOGER.
create or replace function public.marcar_compra_recogida(p_compra uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_compra public.ordenes_compra_materiales%rowtype;
begin
  perform public.exigir_permiso('compras.recojo');
  select * into v_compra from public.ordenes_compra_materiales where id = p_compra for update;
  if not found then
    raise exception 'La compra no existe.' using errcode = 'foreign_key_violation';
  end if;
  if v_compra.recojo in ('RECOGIDO', 'DEJADO') then
    return p_compra;
  end if;
  if v_compra.recojo is null or v_compra.recojo not in ('POR_RECOGER', 'EN_RECOJO') then
    raise exception 'La compra % no está mandada a recojo.', coalesce(v_compra.numero, v_compra.referencia) using errcode = 'check_violation';
  end if;
  update public.ordenes_compra_materiales
     set recojo = 'RECOGIDO', recogido_en = now(), recogido_por = public.usuario_actual()
   where id = p_compra;
  return p_compra;
end;
$$;
revoke all on function public.marcar_compra_recogida(uuid) from public, anon;
grant execute on function public.marcar_compra_recogida(uuid) to authenticated;

-- 4. La bandeja del conductor muestra también lo que está en recojo -------------
-- Mismas columnas que en 20261012150000; cambia el filtro y el orden: primero
-- lo que lleva encima, después a lo que ya salió, al final lo que falta.
create or replace function public.compras_para_recojo()
returns table (
  id uuid, numero text, referencia text, origen text, proveedor text, proveedor_documento text,
  proveedor_direccion text, proveedor_telefono text, proveedor_contacto text,
  recojo text, pedido_en timestamptz, recogido_en timestamptz, dejado_en timestamptz,
  fecha_estimada date, ordenes text[], lineas jsonb
) language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not (public.es_admin() or public.tiene_permiso('compras.recojo') or public.tiene_permiso('compras.crear')) then
    raise exception 'No tienes permiso para ver los recojos.' using errcode = 'insufficient_privilege';
  end if;
  return query
  select c.id, coalesce(c.numero, c.referencia), c.referencia, c.origen, c.proveedor, p.numero_documento,
         coalesce(p.direccion_recojo, p.direccion), p.telefono, p.contacto,
         c.recojo, c.recojo_pedido_en, c.recogido_en, c.dejado_en, c.fecha_estimada,
         coalesce(l.ordenes, array[]::text[]),
         coalesce(l.lineas, '[]'::jsonb)
    from public.ordenes_compra_materiales c
    left join public.proveedores p on p.id = c.proveedor_id
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
            coalesce(c.dejado_en, c.recojo_pedido_en) desc
   limit 200;
end;
$$;
revoke all on function public.compras_para_recojo() from public, anon;
grant execute on function public.compras_para_recojo() to authenticated;

-- Mismas columnas que en 20261012150000 y el mismo filtro que la de arriba: la
-- pantalla las cruza por id.
create or replace function public.datos_de_recojo()
returns table (id uuid, con_factura boolean, comprobante_adjunto boolean, codigo_interno text)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not (public.es_admin() or public.tiene_permiso('compras.recojo') or public.tiene_permiso('compras.crear')) then
    raise exception 'No tienes permiso para ver los recojos.' using errcode = 'insufficient_privilege';
  end if;
  return query
  select c.id, c.con_factura, public.compra_tiene_comprobante(c), c.codigo_interno
    from public.ordenes_compra_materiales c
   where c.recojo in ('POR_RECOGER', 'EN_RECOJO', 'RECOGIDO')
      or (c.recojo = 'DEJADO' and c.dejado_en > now() - interval '7 days')
   order by case c.recojo when 'RECOGIDO' then 0 when 'EN_RECOJO' then 1 when 'POR_RECOGER' then 2 else 3 end,
            coalesce(c.dejado_en, c.recojo_pedido_en) desc
   limit 200;
end;
$$;
revoke all on function public.datos_de_recojo() from public, anon;
grant execute on function public.datos_de_recojo() to authenticated;

-- La hora en que salió, aparte: cambiar las columnas de las de arriba obliga a
-- borrarlas.
create or replace function public.salidas_a_recojo()
returns table (id uuid, en_recojo_en timestamptz)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not (public.es_admin() or public.tiene_permiso('compras.recojo') or public.tiene_permiso('compras.crear')) then
    raise exception 'No tienes permiso para ver los recojos.' using errcode = 'insufficient_privilege';
  end if;
  return query
  select c.id, c.en_recojo_en
    from public.ordenes_compra_materiales c
   where c.en_recojo_en is not null
     and (c.recojo in ('EN_RECOJO', 'RECOGIDO')
          or (c.recojo = 'DEJADO' and c.dejado_en > now() - interval '7 days'));
end;
$$;
revoke all on function public.salidas_a_recojo() from public, anon;
grant execute on function public.salidas_a_recojo() to authenticated;

-- 5. En qué porcentaje va cada requerimiento --------------------------------------
-- Cada insumo está en una etapa; el RQ va en el promedio de sus insumos y su
-- etapa es la del insumo más atrasado. Las etapas y su porcentaje:
--   POR_REVISAR       10  Almacén revisa el stock (RQ POR_ATENDER)
--   POR_COMPRAR       20  sin OC, o con la OC rechazada
--   OC_POR_APROBAR    30  la OC espera a Gerencia
--   PENDIENTE_RECOJO  45  aprobada: el conductor todavía no sale
--   EN_RECOJO         60  el conductor salió a recogerla
--   RECOGIDO          70  la tiene el conductor, va al almacén
--   OBSERVADO         80  la dejó y Almacén la observó
--   POR_VALIDAR       80  la dejó y Almacén todavía no valida
--   EN_KARDEX         85  Almacén validó el ingreso
--   LISTO_EN_ALMACEN  90  RQ listo: el área puede recogerlo
--   ENTREGADO        100  RQ entregado
-- El RQ anulado no tiene avance.
create or replace function public.avance_de_requerimientos(p_ids uuid[])
returns table (requerimiento_id uuid, porcentaje integer, etapa text, lineas jsonb)
language plpgsql stable security definer set search_path to 'public' as $$
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
           ('OBSERVADO', 80, 7), ('POR_VALIDAR', 80, 8), ('EN_KARDEX', 85, 9),
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
           coalesce(c.aprobacion = 'RECHAZADA', false) as rechazada,
           case
             when r.estado = 'ENTREGADO' then 'ENTREGADO'
             when r.estado = 'LISTO_EN_ALMACEN' then 'LISTO_EN_ALMACEN'
             when r.estado = 'POR_ATENDER' then 'POR_REVISAR'
             when c.id is null or c.aprobacion = 'RECHAZADA' then 'POR_COMPRAR'
             when c.aprobacion = 'POR_APROBAR' then 'OC_POR_APROBAR'
             when c.recojo = 'DEJADO' or (c.recojo is null and c.entregado_almacen_en is not null) then
               case v.estado when 'VALIDADO' then 'EN_KARDEX' when 'OBSERVADO' then 'OBSERVADO' else 'POR_VALIDAR' end
             when c.recojo = 'RECOGIDO' then 'RECOGIDO'
             when c.recojo = 'EN_RECOJO' then 'EN_RECOJO'
             else 'PENDIENTE_RECOJO'
           end as paso,
           case
             when r.estado in ('ENTREGADO', 'LISTO_EN_ALMACEN', 'POR_ATENDER') or c.aprobacion = 'RECHAZADA' then null
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
         jsonb_agg(jsonb_build_object('item', p.item, 'orden_compra', p.compra, 'rechazada', p.rechazada,
                                      'etapa', p.paso, 'porcentaje', e.pct, 'desde', p.desde) order by p.item)
    from por_linea p
    join etapas e on e.codigo = p.paso
   group by p.rq;
end;
$$;
revoke all on function public.avance_de_requerimientos(uuid[]) from public, anon;
grant execute on function public.avance_de_requerimientos(uuid[]) to authenticated;
