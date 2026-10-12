-- =============================================================================
-- EL CONDUCTOR RECOGE LA COMPRA Y ALMACÉN VALIDA SU INGRESO
-- -----------------------------------------------------------------------------
-- Logística tiene un conductor que va donde el proveedor a recoger lo comprado y
-- lo deja en el almacén. Hasta hoy la orden aprobada se le pasaba por WhatsApp,
-- nadie podía saber si ya la había recogido, y cuando llegaba Almacén volvía a
-- escribir en el kardex, material por material, lo que ya decía la orden de
-- compra.
--
-- Desde aquí:
--   1. Cuando una compra queda lista —aprobada por Gerencia, o sin aprobación
--      porque no llegó al monto— le llega al conductor, con el proveedor, su
--      dirección y lo que tiene que recoger.
--   2. El conductor marca dos pasos: «recogida» donde el proveedor y «dejada en
--      almacén», con el número de la guía o factura con que se la entregaron.
--   3. Almacén la ve en su kardex como ingreso por validar, con sus materiales
--      y cantidades, y la valida sin volver a escribirla. Si llegó menos, corrige
--      la cantidad; lo que falta queda pendiente. Lo validado entra al kardex
--      con el precio de la compra.
--
-- Lo que no cambia: Logística puede seguir entregando ella misma la compra a
-- Almacén (con su factura adjunta), y Almacén puede seguir recibiendo línea por
-- línea donde ya lo hacía.
--
-- Quién hace qué:
--   compras.recoger   Conductor de Logística, puesto nuevo.
--   almacen.recibir   Almacén valida el ingreso: el mismo permiso con el que ya
--                     recibe compras.
-- =============================================================================

-- 1. El puesto y su permiso ---------------------------------------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('compras.recoger', 'Logística', 'Recoger donde el proveedor las compras listas y dejarlas en almacén')
on conflict (codigo) do update set modulo = excluded.modulo, descripcion = excluded.descripcion;

insert into public.roles (codigo, nombre, descripcion, nivel, es_sistema) values
  ('CONDUCTOR', 'Conductor de Logística', 'Recoge las compras listas donde el proveedor y las deja en almacén', 20, true)
on conflict (codigo) do update set nombre = excluded.nombre, descripcion = excluded.descripcion;

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, 'compras.recoger' from public.roles r where r.codigo = 'CONDUCTOR'
on conflict do nothing;

-- 2. Lo que se anota en la compra ---------------------------------------------------
-- «Dejada en almacén» es la entrega a Almacén que ya existía
-- (`entregado_almacen_en`): así todo lo que ya la exigía —la recepción, los
-- pendientes de Almacén— la reconoce sin cambiar.
alter table public.ordenes_compra_materiales
  add column if not exists recogido_en timestamptz,
  add column if not exists recogido_por uuid references public.usuarios(id) on delete restrict,
  add column if not exists documento_entrega text;
-- Sin índice para `recogido_por`: nadie filtra compras por quién las recogió y
-- una cuenta no se borra, se desactiva (skill `datos`, «Lo que ya se midió»).

do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.ordenes_compra_materiales'::regclass
                   and conname = 'ck_compra_recojo') then
    alter table public.ordenes_compra_materiales add constraint ck_compra_recojo check (
      (recogido_en is null) = (recogido_por is null)
      and (documento_entrega is null or char_length(btrim(documento_entrega)) between 2 and 100));
  end if;
end $$;

comment on column public.ordenes_compra_materiales.recogido_en is
  'Cuándo el conductor marcó que recogió la compra donde el proveedor.';
comment on column public.ordenes_compra_materiales.documento_entrega is
  'Guía de remisión o factura con la que el proveedor entregó la compra. La anota el conductor al dejarla en almacén y Almacén la usa al validar el ingreso.';

-- 3. Avisar al conductor cuando la compra está lista ------------------------------
-- Una sola vez por compra y por persona, aunque la base vuelva a evaluar la
-- compra cuando cambia un precio.
create or replace function public.avisar_compra_por_recoger(p_compra uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_compra public.ordenes_compra_materiales%rowtype; v_direccion text;
begin
  select * into v_compra from public.ordenes_compra_materiales where id = p_compra;
  if not found or v_compra.aprobacion not in ('NO_REQUERIDA', 'APROBADA')
     or v_compra.entregado_almacen_en is not null or v_compra.recogido_en is not null then
    return;
  end if;
  select direccion into v_direccion from public.proveedores where id = v_compra.proveedor_id;
  insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
  select u.id, 'Compra por recoger: ' || v_compra.referencia,
         v_compra.proveedor || coalesce(' · ' || v_direccion, ''),
         '/recojos', 'ordenes_compra_materiales', p_compra
    from public.usuarios u
    join public.roles r on r.id = u.rol_id
   where u.activo and r.codigo <> 'ADMIN'
     and exists (select 1 from public.roles_permisos rp where rp.rol_id = r.id and rp.permiso_codigo = 'compras.recoger')
     and not exists (select 1 from public.notificaciones n
                      where n.usuario_id = u.id and n.origen_tabla = 'ordenes_compra_materiales'
                        and n.origen_id = p_compra and n.ruta = '/recojos');
end;
$$;
revoke all on function public.avisar_compra_por_recoger(uuid) from public, anon, authenticated;

-- Al cerrar la transacción que crea la compra, después de que la regla de
-- aprobación la evaluó: los disparadores diferidos de una misma fila corren en
-- orden alfabético, y `trg_compra_evaluar_aprobacion` va antes que este.
create or replace function public.fn_compra_lista_para_recoger()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_table_name = 'orden_compra_material_detalles' then
    perform public.avisar_compra_por_recoger(new.orden_compra_id);
  elsif new.aprobacion = 'APROBADA' and old.aprobacion is distinct from 'APROBADA' then
    perform public.avisar_compra_por_recoger(new.id);
  end if;
  return null;
end;
$$;
revoke all on function public.fn_compra_lista_para_recoger() from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_compra_lista_para_recoger'
                   and tgrelid = 'public.orden_compra_material_detalles'::regclass) then
    create constraint trigger trg_compra_lista_para_recoger
      after insert or update of cantidad, precio_unitario on public.orden_compra_material_detalles
      deferrable initially deferred
      for each row execute function public.fn_compra_lista_para_recoger();
  end if;
  -- `after update` a secas: la aprobación la escribe una función, y el
  -- disparador decide adentro si cambió (skill `esquema`, trampas).
  if not exists (select 1 from pg_trigger where tgname = 'trg_compra_aprobada_por_recoger'
                   and tgrelid = 'public.ordenes_compra_materiales'::regclass) then
    create trigger trg_compra_aprobada_por_recoger
      after update on public.ordenes_compra_materiales
      for each row execute function public.fn_compra_lista_para_recoger();
  end if;
end $$;

-- 4. Lo que ve el conductor ---------------------------------------------------------
-- No necesita ver compras, precios ni almacén: necesita a dónde ir, qué recoger y
-- qué le falta marcar. Una sola función con una sola puerta.
create or replace function public.recojos_de_compras()
returns table (
  id uuid, referencia text, proveedor text, proveedor_documento text, proveedor_direccion text,
  proveedor_telefono text, proveedor_contacto text, fecha_estimada date, estado text,
  recogido_en timestamptz, recogido_por text, dejado_en timestamptz, dejado_por text,
  documento_entrega text, ingresado boolean, lineas jsonb
) language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not (public.es_admin() or public.tiene_permiso('compras.recoger')) then
    raise exception 'No tienes permiso para ver los recojos de compras.' using errcode = 'insufficient_privilege';
  end if;
  return query
  select c.id, c.referencia, c.proveedor, p.numero_documento, p.direccion, p.telefono, p.contacto,
         c.fecha_estimada,
         case when c.entregado_almacen_en is not null then 'EN_ALMACEN'
              when c.recogido_en is not null then 'EN_CAMINO'
              else 'POR_RECOGER' end,
         c.recogido_en, ur.nombres || ' ' || ur.apellidos,
         c.entregado_almacen_en, ue.nombres || ' ' || ue.apellidos,
         c.documento_entrega,
         coalesce(l.pendiente, 0) <= 0,
         coalesce(l.lineas, '[]'::jsonb)
    from public.ordenes_compra_materiales c
    left join public.proveedores p on p.id = c.proveedor_id
    left join public.usuarios ur on ur.id = c.recogido_por
    left join public.usuarios ue on ue.id = c.entregado_almacen_por
    left join lateral (
      select jsonb_agg(jsonb_build_object(
               'material_codigo', m.codigo, 'material', m.descripcion, 'unidad', um.codigo,
               'cantidad', d.cantidad) order by m.descripcion) as lineas,
             sum(d.cantidad - coalesce((select sum(x.cantidad) from public.movimientos_materiales x
                                         where x.orden_compra_detalle_id = d.id and x.tipo = 'INGRESO'), 0)) as pendiente
        from public.orden_compra_material_detalles d
        left join public.requerimiento_material_detalles rd on rd.id = d.requerimiento_detalle_id
        left join public.ot_materiales om on om.id = rd.ot_material_id
        join public.materiales m on m.id = coalesce(d.material_id, om.material_id)
        left join public.unidades_medida um on um.id = m.unidad_medida_id
       where d.orden_compra_id = c.id
    ) l on true
   where c.aprobacion in ('NO_REQUERIDA', 'APROBADA')
     and (c.entregado_almacen_en is null or c.entregado_almacen_en > now() - interval '7 days')
   order by case when c.entregado_almacen_en is not null then 2 when c.recogido_en is not null then 0 else 1 end,
            c.fecha_estimada nulls last, c.creado_en
   limit 100;
end;
$$;
revoke all on function public.recojos_de_compras() from public, anon;
grant execute on function public.recojos_de_compras() to authenticated;

-- 5. Los dos pasos del conductor ----------------------------------------------------
create or replace function public.marcar_compra_recogida(p_compra uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_compra public.ordenes_compra_materiales%rowtype; v_nombre text;
begin
  perform public.exigir_permiso('compras.recoger');
  select * into v_compra from public.ordenes_compra_materiales where id = p_compra for update;
  if not found then
    raise exception 'La compra no existe.';
  end if;
  if v_compra.aprobacion in ('POR_APROBAR', 'RECHAZADA') then
    raise exception '%', public.mensaje_compra_sin_aprobar(v_compra) using errcode = 'check_violation';
  end if;
  if v_compra.recogido_en is not null then
    return p_compra;
  end if;
  if v_compra.entregado_almacen_en is not null then
    raise exception 'La compra % ya está en almacén.', v_compra.referencia using errcode = 'check_violation';
  end if;
  update public.ordenes_compra_materiales
     set recogido_en = now(), recogido_por = public.usuario_actual()
   where id = p_compra;
  select nombres || ' ' || apellidos into v_nombre from public.usuarios where id = public.usuario_actual();
  perform public.notificar_a_usuario(v_compra.creado_por, 'Compra recogida: ' || v_compra.referencia,
    coalesce(v_nombre, 'El conductor') || ' la recogió donde ' || v_compra.proveedor || '.',
    '/compras', 'ordenes_compra_materiales', p_compra, public.usuario_actual());
  return p_compra;
end;
$$;
revoke all on function public.marcar_compra_recogida(uuid) from public, anon;
grant execute on function public.marcar_compra_recogida(uuid) to authenticated;

create or replace function public.marcar_compra_dejada_en_almacen(p_compra uuid, p_documento text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_compra public.ordenes_compra_materiales%rowtype; v_nombre text; v_lineas int;
begin
  perform public.exigir_permiso('compras.recoger');
  if char_length(btrim(coalesce(p_documento, ''))) not between 2 and 100 then
    raise exception 'Anota el número de la guía o la factura con que el proveedor entregó la compra.'
      using errcode = 'check_violation';
  end if;
  select * into v_compra from public.ordenes_compra_materiales where id = p_compra for update;
  if not found then
    raise exception 'La compra no existe.';
  end if;
  if v_compra.entregado_almacen_en is not null then
    if v_compra.documento_entrega = btrim(p_documento) then
      return p_compra;
    end if;
    raise exception 'La compra % ya fue dejada en almacén.', v_compra.referencia using errcode = 'check_violation';
  end if;
  if v_compra.aprobacion in ('POR_APROBAR', 'RECHAZADA') then
    raise exception '%', public.mensaje_compra_sin_aprobar(v_compra) using errcode = 'check_violation';
  end if;
  if v_compra.recogido_en is null then
    raise exception 'Marca primero que recogiste la compra %.', v_compra.referencia using errcode = 'check_violation';
  end if;
  -- El ingreso entra al kardex con el precio de la compra: sin precio no se
  -- puede valorizar.
  if exists (select 1 from public.orden_compra_material_detalles
              where orden_compra_id = p_compra and precio_unitario is null) then
    raise exception 'A la compra % le falta el precio de un material. Avisa a Logística antes de dejarla.', v_compra.referencia
      using errcode = 'check_violation';
  end if;

  update public.ordenes_compra_materiales
     set entregado_almacen_en = now(), entregado_almacen_por = public.usuario_actual(),
         documento_entrega = btrim(p_documento)
   where id = p_compra;

  select nombres || ' ' || apellidos into v_nombre from public.usuarios where id = public.usuario_actual();
  select count(*) into v_lineas from public.orden_compra_material_detalles where orden_compra_id = p_compra;
  -- A Almacén, que tiene que validarla, y a quien la emitió.
  insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
  select u.id, 'Ingreso por validar: ' || v_compra.referencia,
         v_compra.proveedor || ' · ' || v_lineas || case when v_lineas = 1 then ' material' else ' materiales' end
           || ' · la dejó ' || coalesce(v_nombre, 'el conductor') || ' con ' || btrim(p_documento),
         '/almacen/kardex#por-validar', 'ordenes_compra_materiales', p_compra
    from public.usuarios u
    join public.roles r on r.id = u.rol_id
   where u.activo and r.codigo <> 'ADMIN' and u.id is distinct from public.usuario_actual()
     and exists (select 1 from public.roles_permisos rp where rp.rol_id = r.id and rp.permiso_codigo = 'almacen.recibir');
  perform public.notificar_a_usuario(v_compra.creado_por, 'Compra en almacén: ' || v_compra.referencia,
    coalesce(v_nombre, 'El conductor') || ' la dejó en almacén con ' || btrim(p_documento) || '. Almacén valida el ingreso.',
    '/compras', 'ordenes_compra_materiales', p_compra, public.usuario_actual());
  return p_compra;
end;
$$;
revoke all on function public.marcar_compra_dejada_en_almacen(uuid, text) from public, anon;
grant execute on function public.marcar_compra_dejada_en_almacen(uuid, text) to authenticated;

-- 6. Lo que Almacén tiene por validar -----------------------------------------------
create or replace function public.ingresos_por_validar()
returns table (
  id uuid, referencia text, proveedor text, ordenes text[], dejado_en timestamptz, dejado_por text,
  recogido_por text, documento_entrega text, lineas jsonb
) language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not (public.es_admin() or public.tiene_permiso('almacen.recibir')) then
    raise exception 'No tienes permiso para validar ingresos de compras.' using errcode = 'insufficient_privilege';
  end if;
  return query
  select c.id, c.referencia, c.proveedor, l.ordenes, c.entregado_almacen_en,
         ue.nombres || ' ' || ue.apellidos, ur.nombres || ' ' || ur.apellidos,
         c.documento_entrega, l.lineas
    from public.ordenes_compra_materiales c
    left join public.usuarios ue on ue.id = c.entregado_almacen_por
    left join public.usuarios ur on ur.id = c.recogido_por
    join lateral (
      select coalesce(array_agg(distinct x.numero order by x.numero) filter (where x.numero is not null), '{}') as ordenes,
             jsonb_agg(jsonb_build_object(
               'id', x.id, 'material_codigo', x.codigo, 'material', x.descripcion, 'unidad', x.unidad,
               'orden', x.numero, 'comprado', x.cantidad, 'recibido', x.recibido,
               'pendiente', x.cantidad - x.recibido) order by x.descripcion) as lineas
        from (
          select d.id, d.cantidad::numeric as cantidad, m.codigo, m.descripcion, um.codigo as unidad, o.numero,
                 coalesce((select sum(mv.cantidad) from public.movimientos_materiales mv
                            where mv.orden_compra_detalle_id = d.id and mv.tipo = 'INGRESO'), 0) as recibido
            from public.orden_compra_material_detalles d
            left join public.requerimiento_material_detalles rd on rd.id = d.requerimiento_detalle_id
            left join public.ot_materiales om on om.id = rd.ot_material_id
            left join public.requerimientos_materiales r on r.id = d.requerimiento_id
            left join public.ordenes_trabajo o on o.id = r.orden_id
            join public.materiales m on m.id = coalesce(d.material_id, om.material_id)
            left join public.unidades_medida um on um.id = m.unidad_medida_id
           where d.orden_compra_id = c.id
        ) x
      having sum(x.cantidad - x.recibido) > 0
    ) l on true
   where c.entregado_almacen_en is not null
     and c.aprobacion not in ('POR_APROBAR', 'RECHAZADA')
   order by c.entregado_almacen_en
   limit 100;
end;
$$;
revoke all on function public.ingresos_por_validar() from public, anon;
grant execute on function public.ingresos_por_validar() to authenticated;

-- 7. Validar el ingreso ---------------------------------------------------------------
-- Sin `p_lineas` entra todo lo pendiente. Con `p_lineas` ([{id, cantidad}]) entra
-- lo que de verdad llegó; una línea que no se nombra no entra y sigue pendiente.
-- Cada movimiento toma su id de la operación y de la línea: un segundo toque con
-- la misma operación no ingresa dos veces.
create or replace function public.validar_ingreso_compra(
  p_operacion uuid, p_compra uuid, p_documento text, p_lineas jsonb default null
) returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  v_compra    public.ordenes_compra_materiales%rowtype;
  v_documento text;
  v_linea     record;
  v_cantidad  numeric;
  v_hechos    int := 0;
  v_pendiente numeric;
begin
  perform public.exigir_permiso('almacen.recibir');
  if p_operacion is null then
    raise exception 'Falta el identificador de la operación. Recarga la pantalla.';
  end if;
  select * into v_compra from public.ordenes_compra_materiales where id = p_compra for update;
  if not found then
    raise exception 'La compra no existe.';
  end if;
  -- Reintento de la misma operación: ya quedó.
  select count(*) into v_hechos from public.movimientos_materiales m
    join public.orden_compra_material_detalles d on d.id = m.orden_compra_detalle_id
   where d.orden_compra_id = p_compra and m.id = md5(p_operacion::text || d.id::text)::uuid;
  if v_hechos > 0 then
    return v_hechos;
  end if;
  if v_compra.entregado_almacen_en is null then
    raise exception 'La compra % todavía no llegó: el conductor o Logística la marca al dejarla en almacén.', v_compra.referencia
      using errcode = 'check_violation';
  end if;
  v_documento := coalesce(nullif(btrim(coalesce(p_documento, '')), ''), v_compra.documento_entrega);
  if char_length(coalesce(v_documento, '')) not between 2 and 100 then
    raise exception 'Indica la guía o factura con la que llegó la compra.' using errcode = 'check_violation';
  end if;
  if p_lineas is not null and (jsonb_typeof(p_lineas) <> 'array'
     or exists (select 1 from jsonb_to_recordset(p_lineas) x(id uuid, cantidad numeric)
                 where x.id is null or not exists (select 1 from public.orden_compra_material_detalles d
                                                    where d.id = x.id and d.orden_compra_id = p_compra))) then
    raise exception 'Una de las líneas no es de esta compra. Recarga la pantalla.';
  end if;

  for v_linea in
    select d.id, d.requerimiento_detalle_id, d.cantidad::numeric as cantidad,
           coalesce((select sum(m.cantidad) from public.movimientos_materiales m
                      where m.orden_compra_detalle_id = d.id and m.tipo = 'INGRESO'), 0) as recibido
      from public.orden_compra_material_detalles d
     where d.orden_compra_id = p_compra
     order by d.id
     for update of d
  loop
    v_pendiente := v_linea.cantidad - v_linea.recibido;
    if p_lineas is null then
      v_cantidad := v_pendiente;
    else
      select coalesce(sum(x.cantidad), 0) into v_cantidad
        from jsonb_to_recordset(p_lineas) x(id uuid, cantidad numeric) where x.id = v_linea.id;
    end if;
    if v_cantidad < 0 or v_cantidad <> round(v_cantidad, 3) then
      raise exception 'Las cantidades van de 0 en adelante, con hasta tres decimales.' using errcode = 'check_violation';
    end if;
    if v_cantidad > v_pendiente then
      raise exception 'Llegó más de lo pendiente en una línea (quedaban %). Revisa la cantidad.', trim_scale(v_pendiente)
        using errcode = 'check_violation';
    end if;
    if v_cantidad > 0 then
      insert into public.movimientos_materiales
        (id, tipo, origen, requerimiento_detalle_id, orden_compra_detalle_id, cantidad, documento_referencia, registrado_por)
      values (md5(p_operacion::text || v_linea.id::text)::uuid, 'INGRESO', 'COMPRA', v_linea.requerimiento_detalle_id,
              v_linea.id, v_cantidad, v_documento, public.usuario_actual());
      v_hechos := v_hechos + 1;
    end if;
  end loop;

  if v_hechos = 0 then
    raise exception 'No hay nada que ingresar: indica la cantidad que llegó.' using errcode = 'check_violation';
  end if;
  perform public.notificar_a_usuario(v_compra.creado_por, 'Ingreso validado: ' || v_compra.referencia,
    'Almacén ingresó ' || v_hechos || case when v_hechos = 1 then ' material' else ' materiales' end || ' al kardex.',
    '/compras', 'ordenes_compra_materiales', p_compra, public.usuario_actual());
  return v_hechos;
end;
$$;
revoke all on function public.validar_ingreso_compra(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.validar_ingreso_compra(uuid, uuid, text, jsonb) to authenticated;
