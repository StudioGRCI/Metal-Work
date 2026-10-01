-- El almacenero lleva su kardex: cada ingreso y cada salida de material, con el
-- saldo que queda después de cada uno, como el formato «Inventario según
-- kardex» del área (docs/ANALISIS-ONEDRIVE.md §10). Y nada sale del almacén sin
-- decir a qué unidad va: el formato «Entrega de consumibles por unidad» pide la
-- unidad en cada salida.
--
-- Hasta aquí solo existía el despacho de una solicitud de OT. Lo que el taller
-- retira sin solicitud —discos, soldadura, pintura para un vehículo— no tenía
-- dónde registrarse, y el saldo del sistema se alejaba del físico. Esta
-- migración agrega la SALIDA de almacén: se vincula a un vehículo registrado en
-- Unidades o, si la unidad todavía no está registrada, a su código interno de
-- fabricación (VSC_SR_O4_6_26/30) o su placa escrita a mano.
--
-- El despacho de una solicitud también queda vinculado: hereda la unidad de su
-- OT, y si la OT no tiene vehículo ni código se detiene con un aviso claro.
--
-- Las salidas generales no entran al costeo de la OT: ese costeo sigue leyendo
-- solo los despachos de solicitudes, que es lo que Diseño aprobó para la OT.

-- 1. Dónde va cada salida -----------------------------------------------------
alter table public.movimientos_materiales
  add column if not exists unidad_id uuid references public.unidades(id) on delete restrict,
  add column if not exists codigo_unidad text,
  add column if not exists orden_id uuid references public.ordenes_trabajo(id) on delete restrict;

comment on column public.movimientos_materiales.unidad_id is
  'Vehículo registrado al que fue el material. En un despacho es la unidad de su OT.';
comment on column public.movimientos_materiales.codigo_unidad is
  'Cómo se llamaba la unidad al salir el material: placa y código interno, o el código escrito por Almacén. Queda congelado como evidencia.';
comment on column public.movimientos_materiales.orden_id is
  'OT del despacho. Se copia de la solicitud para que el kardex la muestre sin recorrer la solicitud.';

-- Índices de las llaves nuevas: no se crean. (a) no hay índice que empiece por
-- ellas, pero (b) la aplicación no filtra por unidad_id ni por orden_id —el
-- kardex filtra por material, con idx_movimientos_material_directo, y por el
-- texto de codigo_unidad— y (c) ni unidades ni órdenes se borran en ningún
-- flujo: una OT numerada se anula y una unidad se desactiva.

-- Los movimientos anteriores al kardex podían no tener el material puesto.
update public.movimientos_materiales m set material_id = om.material_id
  from public.requerimiento_material_detalles d
  join public.ot_materiales om on om.id = d.ot_material_id
 where m.material_id is null and d.id = m.requerimiento_detalle_id;

-- 2. El nombre de la unidad, el mismo en el kardex y en el formulario --------
-- Placa y código interno juntos cuando están los dos: Almacén conoce la unidad
-- por su código mientras se fabrica y por la placa cuando ya la tiene.
create or replace function public.nombre_unidad_almacen(p_u public.unidades)
returns text language sql stable set search_path = 'public' as $$
  select coalesce(
    nullif(concat_ws(' · ', nullif(btrim((p_u).placa), ''), nullif(btrim((p_u).codigo_interno), '')), ''),
    nullif(btrim((p_u).numero_fmi), ''),
    'Chasis ' || nullif(btrim((p_u).numero_chasis), ''),
    nullif(btrim(concat_ws(' ', nullif(btrim((p_u).marca), ''), nullif(btrim((p_u).modelo), ''))), '') || ', sin placa',
    'Unidad sin placa')
$$;
revoke all on function public.nombre_unidad_almacen(public.unidades) from public, anon, authenticated;

-- 3. Un tipo más de movimiento ------------------------------------------------
alter table public.movimientos_materiales drop constraint if exists movimientos_materiales_tipo_check;
alter table public.movimientos_materiales add constraint movimientos_materiales_tipo_check
  check (tipo in ('INGRESO', 'DESPACHO', 'SALIDA'));

alter table public.movimientos_materiales drop constraint if exists ck_movimiento_material_origen;
alter table public.movimientos_materiales add constraint ck_movimiento_material_origen check (
  (tipo = 'INGRESO' and responsable_id is null and nullif(btrim(documento_referencia), '') is not null
    and ((orden_compra_detalle_id is not null and requerimiento_detalle_id is not null and origen = 'COMPRA')
      or (orden_compra_detalle_id is null and material_id is not null and origen in ('SALDO_INICIAL', 'INGRESO_GENERAL', 'DEVOLUCION'))))
  or (tipo = 'DESPACHO' and requerimiento_detalle_id is not null and orden_compra_detalle_id is null and responsable_id is not null)
  or (tipo = 'SALIDA' and origen = 'SALIDA_GENERAL' and requerimiento_detalle_id is null and orden_compra_detalle_id is null
    and material_id is not null and nullif(btrim(documento_referencia), '') is not null
    and nullif(btrim(recibido_por_nombre), '') is not null)
);

-- Toda salida dice a qué unidad fue. NOT VALID: los despachos registrados antes
-- de esta regla se quedan como están; la regla vale desde hoy.
do $$ begin
  if not exists (select 1 from pg_constraint
                  where conname = 'ck_movimiento_salida_con_unidad'
                    and conrelid = 'public.movimientos_materiales'::regclass) then
    alter table public.movimientos_materiales add constraint ck_movimiento_salida_con_unidad
      check (tipo = 'INGRESO' or length(btrim(coalesce(codigo_unidad, ''))) between 2 and 160) not valid;
  end if;
end $$;

-- 4. El destino lo pone la base, no el formulario -----------------------------
-- Trigger propio (no se redefine identificar_material_movimiento): el despacho
-- hereda la unidad y la OT de su solicitud, la devolución hereda las de la
-- entrega que devuelve, y la unidad registrada pone su nombre.
create or replace function public.fn_destino_movimiento_almacen()
returns trigger language plpgsql set search_path = 'public' as $$
declare
  v_orden uuid;
  v_unidad uuid;
  v_numero text;
  v_original public.movimientos_materiales%rowtype;
begin
  if new.tipo = 'DESPACHO' then
    select r.orden_id, ot.unidad_id, ot.numero into v_orden, v_unidad, v_numero
      from public.requerimiento_material_detalles d
      join public.requerimientos_materiales r on r.id = d.requerimiento_id
      join public.ordenes_trabajo ot on ot.id = r.orden_id
     where d.id = new.requerimiento_detalle_id;
    new.orden_id := v_orden;
    new.unidad_id := coalesce(new.unidad_id, v_unidad);
  elsif new.tipo = 'INGRESO' then
    if new.devolucion_de is not null then
      select * into v_original from public.movimientos_materiales where id = new.devolucion_de;
      new.orden_id := v_original.orden_id;
      new.unidad_id := v_original.unidad_id;
      new.codigo_unidad := v_original.codigo_unidad;
    end if;
    return new;
  end if;

  if new.unidad_id is not null then
    select public.nombre_unidad_almacen(u) into new.codigo_unidad
      from public.unidades u where u.id = new.unidad_id;
  end if;
  new.codigo_unidad := nullif(btrim(new.codigo_unidad), '');

  if new.codigo_unidad is null then
    if new.tipo = 'DESPACHO' then
      raise exception 'La OT % no tiene vehículo ni código de unidad. Pide a Administración que registre la unidad en la OT antes de despachar.', coalesce(v_numero, '');
    end if;
    raise exception 'Indica el vehículo o el código de la unidad que recibe el material.';
  end if;
  return new;
end $$;
revoke all on function public.fn_destino_movimiento_almacen() from public, anon, authenticated;
create or replace trigger trg_destino_movimiento_almacen before insert on public.movimientos_materiales
  for each row execute function public.fn_destino_movimiento_almacen();

-- Los despachos anteriores toman su OT y su unidad cuando se pueden saber.
update public.movimientos_materiales m
   set orden_id = r.orden_id,
       unidad_id = coalesce(m.unidad_id, ot.unidad_id),
       codigo_unidad = coalesce(m.codigo_unidad, (select public.nombre_unidad_almacen(u) from public.unidades u where u.id = ot.unidad_id))
  from public.requerimiento_material_detalles d
  join public.requerimientos_materiales r on r.id = d.requerimiento_id
  join public.ordenes_trabajo ot on ot.id = r.orden_id
 where m.tipo = 'DESPACHO' and m.orden_id is null and d.id = m.requerimiento_detalle_id;

-- 5. Las unidades que Almacén puede elegir ------------------------------------
-- Almacén no lee la tabla de unidades (trae al cliente): recibe solo lo que
-- identifica al vehículo y las OT abiertas que lo nombran.
create or replace function public.unidades_para_salida_almacen()
returns table (id uuid, nombre text, codigo_interno text, placa text, vehiculo text, ordenes text)
language plpgsql stable security definer set search_path = 'public' as $$
begin
  perform public.exigir_permiso('almacen.despachar');
  return query
    select u.id,
           public.nombre_unidad_almacen(u),
           nullif(btrim(u.codigo_interno), ''),
           nullif(btrim(u.placa), ''),
           nullif(btrim(concat_ws(' ', u.marca, u.modelo)), ''),
           (select string_agg(ot.numero, ', ' order by ot.numero)
              from public.ordenes_trabajo ot
             where ot.unidad_id = u.id
               and ot.estado::text not in ('ANULADA', 'ENTREGADA', 'FACTURADA'))
      from public.unidades u
     where u.activo
     order by u.creado_en desc
     limit 1000;
end $$;
revoke all on function public.unidades_para_salida_almacen() from public, anon;
grant execute on function public.unidades_para_salida_almacen() to authenticated;

-- 6. La salida de almacén -----------------------------------------------------
create or replace function public.registrar_salida_almacen(
  p_id uuid, p_material uuid, p_cantidad numeric, p_unidad uuid, p_codigo text,
  p_motivo text, p_recibe text, p_foto text)
returns uuid language plpgsql security definer set search_path = 'public' as $$
declare
  v_codigo text := nullif(upper(regexp_replace(btrim(coalesce(p_codigo, '')), '\s+', ' ', 'g')), '');
  v_unidad uuid := p_unidad;
  v_coincide uuid[];
  v_existente public.movimientos_materiales%rowtype;
  v_objeto storage.objects%rowtype;
  v_reserva numeric;
  v_libre numeric;
begin
  perform public.exigir_permiso('almacen.despachar');
  if p_id is null or p_material is null or p_cantidad is null or p_cantidad <= 0 or p_cantidad <> round(p_cantidad, 3)
     or length(btrim(coalesce(p_motivo, ''))) not between 3 and 200
     or length(btrim(coalesce(p_recibe, ''))) not between 3 and 160
     or p_foto is null
     or p_foto not in (auth.uid()::text || '/' || p_id::text || '.jpg',
                       auth.uid()::text || '/' || p_id::text || '.png',
                       auth.uid()::text || '/' || p_id::text || '.webp') then
    raise exception 'Indica material, cantidad, motivo, quién recibe y la foto de la salida.';
  end if;
  if (v_unidad is null) = (v_codigo is null) then
    raise exception 'Vincula la salida a un vehículo registrado o escribe el código de la unidad, uno de los dos.';
  end if;

  if v_unidad is not null then
    perform 1 from public.unidades where id = v_unidad and activo;
    if not found then raise exception 'La unidad elegida no existe o está desactivada.'; end if;
  else
    if length(v_codigo) not between 3 and 60 then
      raise exception 'El código de la unidad debe tener de 3 a 60 caracteres.';
    end if;
    -- Si el código escrito es el de una unidad registrada, la salida se vincula
    -- a ella: así el mismo vehículo no aparece con dos nombres en el kardex.
    select array_agg(u.id) into v_coincide from public.unidades u
     where u.activo and (upper(btrim(u.codigo_interno)) = v_codigo or upper(btrim(u.placa)) = v_codigo);
    if cardinality(v_coincide) = 1 then
      v_unidad := v_coincide[1];
      v_codigo := null;
    end if;
  end if;

  perform 1 from public.materiales where id = p_material and activo for update;
  if not found then raise exception 'El material no está activo.'; end if;

  select * into v_existente from public.movimientos_materiales where id = p_id;
  if found then
    if v_existente.tipo = 'SALIDA' and v_existente.registrado_por = public.usuario_actual()
       and v_existente.material_id = p_material and v_existente.cantidad = p_cantidad
       and v_existente.foto_ruta = p_foto and v_existente.recibido_por_nombre = btrim(p_recibe)
       and v_existente.documento_referencia = btrim(p_motivo)
       and v_existente.unidad_id is not distinct from v_unidad then
      return p_id;
    end if;
    raise exception 'Esa salida ya existe con otros datos. Recarga el kardex.';
  end if;

  select * into v_objeto from storage.objects where bucket_id = 'evidencias-almacen' and name = p_foto;
  if not found or v_objeto.owner_id is distinct from auth.uid()::text
     or v_objeto.metadata->>'mimetype' not in ('image/jpeg', 'image/png', 'image/webp')
     or coalesce((v_objeto.metadata->>'size')::bigint, 0) not between 1 and 10485760 then
    raise exception 'Carga una foto válida antes de confirmar la salida.';
  end if;

  -- Lo reservado para solicitudes de OT no se entrega por salida general.
  select coalesce(sum(greatest(coalesce(d.cantidad_stock, case when d.decision_almacen = 'STOCK' then d.cantidad_solicitada else 0 end)
                               + coalesce(s.ingresado, 0) - coalesce(s.cantidad, 0), 0)), 0)
    into v_reserva
    from public.requerimiento_material_detalles d
    join public.ot_materiales om on om.id = d.ot_material_id
    join public.ordenes_trabajo ot on ot.id = om.orden_id
    left join lateral (
      select sum(x.cantidad) filter (where x.tipo = 'DESPACHO') cantidad,
             sum(x.cantidad) filter (where x.tipo = 'INGRESO' and x.origen = 'COMPRA') ingresado
        from public.movimientos_materiales x where x.requerimiento_detalle_id = d.id) s on true
   where om.material_id = p_material and d.decision_almacen in ('STOCK', 'COMPRA') and ot.estado::text <> 'ANULADA';
  v_libre := greatest(public.saldo_registrado_material(p_material) - v_reserva, 0);
  if p_cantidad > v_libre then
    raise exception 'Solo hay % libre de este material; lo demás está reservado para solicitudes de OT o no está en almacén.', v_libre;
  end if;

  insert into public.movimientos_materiales(id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por,
    cantidad_de_stock, foto_ruta, recibido_por_nombre, unidad_id, codigo_unidad)
  values (p_id, 'SALIDA', p_material, p_cantidad, 'SALIDA_GENERAL', btrim(p_motivo), public.usuario_actual(),
    p_cantidad, p_foto, btrim(p_recibe), v_unidad, v_codigo);
  return p_id;
end $$;
revoke all on function public.registrar_salida_almacen(uuid, uuid, numeric, uuid, text, text, text, text) from public, anon;
grant execute on function public.registrar_salida_almacen(uuid, uuid, numeric, uuid, text, text, text, text) to authenticated;

-- 7. Una salida general también se puede devolver -----------------------------
-- Mismo texto que la versión vigente (20260930095000), salvo que la entrega
-- original puede ser un despacho de OT o una salida general.
create or replace function public.registrar_ingreso_almacen(p_id uuid, p_material uuid, p_cantidad numeric, p_origen text, p_documento text, p_precio numeric, p_moneda text, p_devolucion uuid default null)
returns uuid language plpgsql security definer set search_path = 'public' as $$
declare v_existente public.movimientos_materiales%rowtype; v_original public.movimientos_materiales%rowtype; v_devuelto numeric;
begin
  perform public.exigir_permiso('almacen.recibir');
  if p_id is null or p_cantidad is null or p_cantidad<=0 or p_cantidad<>round(p_cantidad,3)
     or p_origen is null or p_origen not in ('SALDO_INICIAL','INGRESO_GENERAL','DEVOLUCION')
     or length(btrim(coalesce(p_documento,''))) not between 2 and 100
     or (p_precio is not null and (p_precio<0 or p_precio<>round(p_precio,4))) or p_moneda is null or p_moneda not in ('PEN','USD') then
    raise exception 'Indica material, cantidad, origen, documento y precio válidos.';
  end if;
  perform 1 from public.materiales where id=p_material and activo for update;
  if not found then raise exception 'El material no está activo.'; end if;
  if p_origen='DEVOLUCION' then
    select * into v_original from public.movimientos_materiales where id=p_devolucion and tipo in ('DESPACHO','SALIDA') and material_id=p_material for update;
    if not found then raise exception 'Selecciona la entrega original de este material.'; end if;
    p_precio:=v_original.precio_unitario;
    p_moneda:=coalesce(v_original.moneda,p_moneda);
  elsif p_devolucion is not null then raise exception 'Solo una devolución puede vincularse a una entrega.';
  end if;
  select * into v_existente from public.movimientos_materiales where id=p_id;
  if found then
    if v_existente.registrado_por=public.usuario_actual() and v_existente.material_id=p_material and v_existente.cantidad=p_cantidad
      and v_existente.origen=p_origen and v_existente.documento_referencia=btrim(p_documento)
      and v_existente.precio_unitario is not distinct from p_precio and v_existente.moneda=p_moneda
      and v_existente.devolucion_de is not distinct from p_devolucion then return p_id; end if;
    raise exception 'El ingreso ya existe con otros datos. Recarga antes de volver a intentar.';
  end if;
  if p_origen='DEVOLUCION' then
    select coalesce(sum(cantidad),0) into v_devuelto from public.movimientos_materiales where devolucion_de=p_devolucion;
    if v_devuelto+p_cantidad>v_original.cantidad then raise exception 'La devolución supera lo entregado en la salida original.'; end if;
  end if;
  insert into public.movimientos_materiales(id,tipo,material_id,cantidad,origen,documento_referencia,registrado_por,precio_unitario,moneda,devolucion_de)
    values(p_id,'INGRESO',p_material,p_cantidad,p_origen,btrim(p_documento),public.usuario_actual(),p_precio,p_moneda,p_devolucion);
  return p_id;
end $$;
revoke all on function public.registrar_ingreso_almacen(uuid,uuid,numeric,text,text,numeric,text,uuid) from public, anon;
grant execute on function public.registrar_ingreso_almacen(uuid,uuid,numeric,text,text,numeric,text,uuid) to authenticated;

-- 8. El kardex ----------------------------------------------------------------
-- Una fila por ingreso, salida o ajuste de conteo, con el saldo del material
-- después de ella. security_invoker: quien lo lee necesita almacen.ver en las
-- tablas de abajo; la vista no abre nada que las tablas no abran.
create or replace view public.v_kardex_almacen with (security_invoker = true) as
with eventos as (
  select m.id, m.registrado_en as fecha, m.material_id,
         m.tipo as movimiento, m.origen,
         case when m.tipo = 'INGRESO' then m.cantidad::numeric else 0 end as entrada,
         case when m.tipo <> 'INGRESO' then m.cantidad::numeric else 0 end as salida,
         m.documento_referencia as documento, m.unidad_id, m.codigo_unidad, m.orden_id,
         m.recibido_por_nombre, m.registrado_por, m.precio_unitario, m.moneda,
         m.foto_ruta is not null as con_foto, m.devolucion_de
    from public.movimientos_materiales m
  union all
  select c.id, c.registrado_en, c.material_id,
         'AJUSTE', 'CONTEO',
         greatest(c.ajuste::numeric, 0), greatest(-c.ajuste::numeric, 0),
         c.motivo, null, null, null,
         null, c.registrado_por, null, null,
         false, null
    from public.conteos_inventario c
), con_saldo as (
  select e.*,
         sum(e.entrada - e.salida) over (partition by e.material_id order by e.fecha, e.id
                                         rows between unbounded preceding and current row) as saldo
    from eventos e
)
select k.id, k.fecha, k.material_id,
       mat.codigo as material_codigo, mat.descripcion as material, um.codigo as unidad_medida,
       k.movimiento, k.origen, k.entrada, k.salida, k.saldo,
       k.documento, k.unidad_id, k.codigo_unidad, k.orden_id, ot.numero as orden_numero,
       k.recibido_por_nombre, k.registrado_por,
       nullif(btrim(concat_ws(' ', us.nombres, us.apellidos)), '') as registrado_por_nombre,
       k.precio_unitario, k.moneda, k.con_foto, k.devolucion_de
  from con_saldo k
  left join public.materiales mat on mat.id = k.material_id
  left join public.unidades_medida um on um.id = mat.unidad_medida_id
  left join public.ordenes_trabajo ot on ot.id = k.orden_id
  left join public.usuarios us on us.id = k.registrado_por;
revoke all on public.v_kardex_almacen from public, anon;
grant select on public.v_kardex_almacen to authenticated;
