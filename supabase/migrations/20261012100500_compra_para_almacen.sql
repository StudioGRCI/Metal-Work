-- =============================================================================
-- LA COMPRA PARA ALMACÉN, SIN REQUERIMIENTO
-- -----------------------------------------------------------------------------
-- Hasta hoy toda orden de compra nacía de un requerimiento: Diseño desglosa la
-- OT, Almacén deriva lo que falta y Logística lo compra. Pero Logística también
-- compra para tener en almacén —soldadura, discos de corte, pintura de uso
-- diario— sin que ninguna OT lo haya pedido todavía, y esas compras no tenían
-- cómo registrarse: se hacían por fuera y el kardex no las veía entrar.
--
-- Desde aquí una orden de compra puede ir sin requerimiento. Sus líneas nombran
-- el material del catálogo en vez de la línea de un requerimiento, y lo que
-- llega entra al saldo general del almacén, no a una OT. Pasa por lo mismo que
-- cualquier compra: el proveedor sale del padrón, la aprobación la decide la
-- regla de Gerencia y Almacén la recibe en su kardex.
--
-- Lo que no cambia:
--   · Una orden de compra es de una OT o es para almacén, no las dos: lo que pide
--     una OT conserva su requerimiento y su costo.
--   · Las compras ya registradas siguen igual: todas tienen su requerimiento.
--
-- Quién: la emite quien ya emite compras (`compras.crear`, Logística).
-- =============================================================================

-- 1. La cabecera y la línea pueden ir sin requerimiento -----------------------
alter table public.ordenes_compra_materiales alter column requerimiento_id drop not null;
alter table public.orden_compra_material_detalles alter column requerimiento_id drop not null;
alter table public.orden_compra_material_detalles alter column requerimiento_detalle_id drop not null;

alter table public.orden_compra_material_detalles
  add column if not exists material_id uuid references public.materiales(id) on delete restrict;
comment on column public.orden_compra_material_detalles.material_id is
  'Material de una compra para almacén. Vacío en las líneas que vienen de un requerimiento: su material lo dice esa línea.';

-- Una línea viene de un requerimiento o nombra su material, nunca las dos.
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.orden_compra_material_detalles'::regclass
                   and conname = 'ck_oc_linea_origen') then
    alter table public.orden_compra_material_detalles add constraint ck_oc_linea_origen check (
      (requerimiento_detalle_id is not null and requerimiento_id is not null and material_id is null)
      or (requerimiento_detalle_id is null and requerimiento_id is null and material_id is not null));
  end if;
end $$;

-- Un mismo material no se repite en la misma compra para almacén. Este índice
-- es además el de la llave hacia `materiales` para el caso que importa (la
-- compra), y el catálogo no se borra: no hace falta otro.
create unique index if not exists uq_oc_material_directo
  on public.orden_compra_material_detalles (orden_compra_id, material_id)
  where material_id is not null;

-- 2. La línea se comprueba según de dónde viene ------------------------------
-- Es la misma comprobación de siempre para las líneas de un requerimiento; la
-- de almacén exige un material vivo del catálogo, con su unidad.
create or replace function public.fn_compra_exige_derivacion()
returns trigger language plpgsql set search_path='public' as $$
declare v_faltante numeric; v_ancla uuid;
begin
 select requerimiento_id into v_ancla from public.ordenes_compra_materiales where id=new.orden_compra_id;
 if new.requerimiento_detalle_id is null then
   if v_ancla is not null then
     raise exception 'Esta orden de compra es de una OT: lo que se compra para almacén va en una orden aparte.';
   end if;
   if not exists (select 1 from public.materiales where id=new.material_id and activo and not unidad_pendiente) then
     raise exception 'El material no está en el catálogo de Almacén o le falta su unidad.';
   end if;
   return new;
 end if;
 if v_ancla is null then
   raise exception 'Esta orden de compra es para almacén: lo que pide una OT va en su propia orden.';
 end if;
 select d.cantidad_solicitada-coalesce(d.cantidad_stock,0)-coalesce((select sum(cantidad) from public.orden_compra_material_detalles x where x.requerimiento_detalle_id=d.id),0)
 into v_faltante from public.requerimiento_material_detalles d
 join public.requerimientos_materiales r on r.id=d.requerimiento_id join public.ordenes_trabajo o on o.id=r.orden_id
 where d.id=new.requerimiento_detalle_id and d.requerimiento_id=new.requerimiento_id
 and d.aprobacion_diseno='APROBADO' and d.decision_almacen='COMPRA' and o.estado::text<>'ANULADA' for update of d;
 if v_faltante is null then raise exception 'Almacén debe derivar a Logística el material aprobado antes de comprarlo.'; end if;
 if new.cantidad>v_faltante then raise exception 'La cantidad excede lo que falta comprar de esta línea (%).',v_faltante; end if;
 return new;
end $$;
revoke all on function public.fn_compra_exige_derivacion() from public,anon,authenticated;

-- 3. Lo que llega de una compra para almacén entra al kardex ----------------------
-- El ingreso de compra exigía la línea del requerimiento. Ahora basta la línea
-- de la compra, que dice su material. La llave compuesta de antes no comprueba
-- nada cuando el requerimiento va vacío, así que la línea lleva además su
-- llave simple; su índice ya existe (`ix_movimientos_materiales_oc`).
alter table public.movimientos_materiales drop constraint if exists ck_movimiento_material_origen;
alter table public.movimientos_materiales add constraint ck_movimiento_material_origen check (
  (tipo = 'INGRESO' and responsable_id is null and nullif(btrim(documento_referencia), '') is not null
    and ((orden_compra_detalle_id is not null and material_id is not null and origen = 'COMPRA')
      or (orden_compra_detalle_id is null and material_id is not null and origen in ('SALDO_INICIAL', 'INGRESO_GENERAL', 'DEVOLUCION'))))
  or (tipo = 'DESPACHO' and requerimiento_detalle_id is not null and orden_compra_detalle_id is null and responsable_id is not null)
  or (tipo = 'SALIDA' and origen = 'SALIDA_GENERAL' and requerimiento_detalle_id is null and orden_compra_detalle_id is null
    and material_id is not null and nullif(btrim(documento_referencia), '') is not null
    and nullif(btrim(recibido_por_nombre), '') is not null)
);

do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.movimientos_materiales'::regclass
                   and conname = 'fk_mov_material_oc_linea') then
    alter table public.movimientos_materiales add constraint fk_mov_material_oc_linea
      foreign key (orden_compra_detalle_id) references public.orden_compra_material_detalles(id) on delete restrict;
  end if;
end $$;

-- El material del ingreso es el de la línea de compra, venga de donde venga.
-- Corre antes que `identificar_material_movimiento` (orden alfabético), que
-- exige el material cuando no hay requerimiento.
create or replace function public.fn_ingreso_de_linea_de_compra()
returns trigger language plpgsql set search_path to 'public' as $$
declare v_material uuid; v_requerimiento uuid;
begin
  if new.orden_compra_detalle_id is null then
    return new;
  end if;
  select coalesce(d.material_id, om.material_id), d.requerimiento_detalle_id
    into v_material, v_requerimiento
    from public.orden_compra_material_detalles d
    left join public.requerimiento_material_detalles rd on rd.id = d.requerimiento_detalle_id
    left join public.ot_materiales om on om.id = rd.ot_material_id
   where d.id = new.orden_compra_detalle_id;
  if not found then
    raise exception 'La línea de compra no existe.';
  end if;
  if new.material_id is not null and new.material_id <> v_material then
    raise exception 'El material no coincide con la línea de compra.';
  end if;
  if new.requerimiento_detalle_id is distinct from v_requerimiento then
    raise exception 'El ingreso no corresponde a la línea de compra.';
  end if;
  new.material_id := v_material;
  return new;
end;
$$;
revoke all on function public.fn_ingreso_de_linea_de_compra() from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_identificar_linea_de_compra'
                   and tgrelid = 'public.movimientos_materiales'::regclass) then
    create trigger trg_identificar_linea_de_compra before insert on public.movimientos_materiales
      for each row execute function public.fn_ingreso_de_linea_de_compra();
  end if;
end $$;

-- La recepción por línea que ya usa Almacén sirve también para estas compras.
create or replace function public.registrar_recepcion_material(
  p_id uuid, p_orden_compra_detalle_id uuid, p_cantidad public.cantidad,
  p_documento_referencia text
) returns uuid language plpgsql security definer set search_path = 'public' as $$
declare v_req uuid; v_material uuid; v_pendiente numeric;
begin
  perform public.exigir_permiso('almacen.recibir');
  if p_id is null or p_cantidad is null or p_cantidad <= 0
     or length(btrim(coalesce(p_documento_referencia, ''))) not between 2 and 100 then
    raise exception 'Indica una cantidad recibida y el documento del proveedor.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.movimientos_materiales where id = p_id) then return p_id; end if;
  select requerimiento_detalle_id, material_id into v_req, v_material from public.orden_compra_material_detalles
   where id = p_orden_compra_detalle_id for update;
  if not found then raise exception 'La línea de compra no existe.' using errcode = 'foreign_key_violation'; end if;
  select ocd.cantidad - coalesce(sum(m.cantidad) filter (where m.tipo = 'INGRESO'), 0)
    into v_pendiente from public.orden_compra_material_detalles ocd
    left join public.movimientos_materiales m on m.orden_compra_detalle_id = ocd.id
   where ocd.id = p_orden_compra_detalle_id group by ocd.id;
  if p_cantidad > v_pendiente then
    raise exception 'La recepción supera lo pendiente de esta compra (%).', v_pendiente using errcode = 'check_violation';
  end if;
  insert into public.movimientos_materiales
    (id, tipo, requerimiento_detalle_id, orden_compra_detalle_id, material_id, cantidad, documento_referencia, registrado_por)
  values (p_id, 'INGRESO', v_req, p_orden_compra_detalle_id, v_material, p_cantidad,
          btrim(p_documento_referencia), public.usuario_actual());
  return p_id;
end;
$$;
revoke all on function public.registrar_recepcion_material(uuid, uuid, public.cantidad, text) from public, anon;
grant execute on function public.registrar_recepcion_material(uuid, uuid, public.cantidad, text) to authenticated;

-- 4. Quién la ve ----------------------------------------------------------------
-- Las compras de una OT se ven por el área de su requerimiento. La de almacén no
-- tiene área: la ve todo el que ya ve compras (Logística, Almacén, Tesorería).
alter policy ver_ordenes_compra_materiales on public.ordenes_compra_materiales using (
  (public.tiene_permiso('compras.ver') or public.tiene_permiso('almacen.recibir') or public.tiene_permiso('tesoreria.ver_documentos'))
  and (public.tiene_permiso('tesoreria.ver_documentos')
       or ordenes_compra_materiales.requerimiento_id is null
       or exists (select 1 from public.requerimientos_materiales r
                   where r.id = ordenes_compra_materiales.requerimiento_id
                     and public.puede_ver_area_material(r.area_destino)))
);

alter policy ver_orden_compra_material_detalles on public.orden_compra_material_detalles using (
  ((select public.tiene_permiso('compras.ver')) or (select public.tiene_permiso('almacen.recibir')))
  and (orden_compra_material_detalles.requerimiento_id is null
       or exists (select 1 from public.requerimientos_materiales r
                   where r.id = orden_compra_material_detalles.requerimiento_id
                     and public.puede_ver_area_material(r.area_destino)))
);

-- 5. Emitir la compra para almacén ----------------------------------------------
-- Como `emitir_compra_agrupada`: el proveedor sale del padrón, cada línea lleva
-- cantidad y precio sin IGV, y un reintento con los mismos datos no duplica.
create or replace function public.emitir_compra_para_almacen(
  p_id uuid, p_proveedor_id uuid, p_referencia text, p_detalles jsonb,
  p_fecha date, p_condicion text, p_dias integer, p_moneda text
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_proveedor public.proveedores%rowtype; v_actual public.ordenes_compra_materiales%rowtype; v_linea record;
begin
  perform public.exigir_permiso('compras.crear');
  if p_id is null or length(btrim(coalesce(p_referencia, ''))) not between 2 and 100
     or jsonb_typeof(p_detalles) is distinct from 'array' then
    raise exception 'Completa el número de la orden de compra y sus materiales.';
  end if;
  if jsonb_array_length(p_detalles) not between 1 and 100 then
    raise exception 'Agrega entre uno y cien materiales.';
  end if;
  if p_condicion is null or p_condicion not in ('CONTADO', 'CREDITO') or p_dias is null or p_dias not between 0 and 365
     or (p_condicion = 'CONTADO' and p_dias <> 0) or (p_condicion = 'CREDITO' and p_dias = 0)
     or p_moneda is null or p_moneda not in ('PEN', 'USD') then
    raise exception 'Indica la moneda y el plazo de pago válidos.';
  end if;
  if (select count(distinct x.material_id) from jsonb_to_recordset(p_detalles) x(material_id uuid, cantidad numeric, precio numeric))
     <> jsonb_array_length(p_detalles) then
    raise exception 'No repitas un material en la misma compra: suma las cantidades en una sola línea.';
  end if;
  select * into v_proveedor from public.proveedores where id = p_proveedor_id;
  if not found then
    raise exception 'Elige un proveedor del padrón.';
  end if;

  -- Serializa los reintentos antes de mirar si la compra ya existe.
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into v_actual from public.ordenes_compra_materiales where id = p_id;
  if found then
    if v_actual.requerimiento_id is null and v_actual.creado_por = public.usuario_actual()
       and v_actual.proveedor_id = p_proveedor_id and v_actual.referencia = btrim(p_referencia)
       and v_actual.fecha_estimada is not distinct from p_fecha and v_actual.condicion_pago = p_condicion
       and v_actual.dias_credito = p_dias and v_actual.moneda = p_moneda
       and (select jsonb_agg(jsonb_build_object('material_id', d.material_id, 'cantidad', d.cantidad::numeric, 'precio', d.precio_unitario) order by d.material_id)
              from public.orden_compra_material_detalles d where d.orden_compra_id = p_id)
         = (select jsonb_agg(jsonb_build_object('material_id', x.material_id, 'cantidad', x.cantidad, 'precio', x.precio) order by x.material_id)
              from jsonb_to_recordset(p_detalles) x(material_id uuid, cantidad numeric, precio numeric)) then
      return p_id;
    end if;
    raise exception 'Esta compra ya existe con otros datos. Recarga antes de intentar de nuevo.';
  end if;
  if not v_proveedor.activo then
    raise exception 'El proveedor % está dado de baja. Reactívalo en Proveedores o elige otro.', v_proveedor.razon_social;
  end if;

  for v_linea in select * from jsonb_to_recordset(p_detalles) x(material_id uuid, cantidad numeric, precio numeric) loop
    if v_linea.material_id is null or v_linea.cantidad is null or v_linea.cantidad <= 0
       or v_linea.cantidad > 99999999999 or v_linea.cantidad <> round(v_linea.cantidad, 3)
       or v_linea.precio is null or v_linea.precio < 0 or v_linea.precio > 999999999999
       or v_linea.precio <> round(v_linea.precio, 2) then
      raise exception 'Cada material necesita cantidad y precio unitario sin IGV válidos.';
    end if;
  end loop;

  insert into public.ordenes_compra_materiales
    (id, requerimiento_id, proveedor_id, proveedor, referencia, fecha_estimada, creado_por, condicion_pago, dias_credito, moneda)
  values (p_id, null, p_proveedor_id, v_proveedor.razon_social, btrim(p_referencia), p_fecha,
          public.usuario_actual(), p_condicion, p_dias, p_moneda);
  insert into public.orden_compra_material_detalles (orden_compra_id, material_id, cantidad, precio_unitario)
  select p_id, x.material_id, x.cantidad, x.precio
    from jsonb_to_recordset(p_detalles) x(material_id uuid, cantidad numeric, precio numeric)
   order by x.material_id;
  return p_id;
end;
$$;
revoke all on function public.emitir_compra_para_almacen(uuid, uuid, text, jsonb, date, text, integer, text) from public, anon;
grant execute on function public.emitir_compra_para_almacen(uuid, uuid, text, jsonb, date, text, integer, text) to authenticated;

-- 6. Lo que ya leía compras sigue viéndolas -------------------------------------
-- Tesorería: las compras a crédito sin comprobante. La de almacén sale sin OT.
-- `create or replace view` reemplaza también sus opciones: sin repetir
-- `security_invoker` la vista pasaría a correr como su dueña, saltando el RLS.
create or replace view public.v_compras_credito_sin_comprobante with (security_invoker = true) as
 select c.id as orden_compra_id,
    r.orden_id,
    o.numero as numero_ot,
    c.proveedor,
    c.referencia,
    c.creado_en::date as fecha_compra,
    c.creado_en::date + c.dias_credito as fecha_vencimiento,
        case
            when bool_or(d.precio_unitario is null) then null::numeric
            else round(sum(d.cantidad::numeric * d.precio_unitario), 2)::numeric(14,2)
        end as total_estimado,
    c.moneda
   from public.ordenes_compra_materiales c
     left join public.requerimientos_materiales r on r.id = c.requerimiento_id
     left join public.ordenes_trabajo o on o.id = r.orden_id
     join public.orden_compra_material_detalles d on d.orden_compra_id = c.id
  where c.condicion_pago = 'CREDITO'::text and not (exists ( select 1
           from public.adquisiciones a
          where a.orden_compra_id = c.id and a.estado = 'REGISTRADA'::text))
  group by c.id, r.orden_id, o.numero;
revoke all on public.v_compras_credito_sin_comprobante from public, anon;
grant select on public.v_compras_credito_sin_comprobante to authenticated;

-- Contabilidad: el comprobante de una compra de OT va a esa OT; el de una compra
-- para almacén no va a ninguna.
create or replace function public.fn_proteger_adquisicion()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
declare v_orden uuid; v_condicion text; v_para_almacen boolean;
begin
  if tg_op='UPDATE' then
    if old.estado<>'BORRADOR' then raise exception 'El comprobante registrado no se edita; registra una corrección.'; end if;
    new.id:=old.id; new.registrado_por:=old.registrado_por; new.creado_en:=old.creado_en;
  end if;
  if new.orden_compra_id is not null then
    select r.orden_id, c.condicion_pago, c.requerimiento_id is null into v_orden, v_condicion, v_para_almacen
      from public.ordenes_compra_materiales c
      left join public.requerimientos_materiales r on r.id=c.requerimiento_id
     where c.id=new.orden_compra_id;
    if v_para_almacen then
      if new.orden_id is not null then
        raise exception 'La compra es para almacén: su comprobante no va a ninguna OT.';
      end if;
    elsif v_orden is null or (new.orden_id is not null and new.orden_id<>v_orden) then
      raise exception 'El comprobante debe pertenecer a la misma OT que la compra.';
    end if;
    if v_condicion<>new.condicion_pago then
      raise exception 'La condición de pago debe coincidir con la registrada por Logística.';
    end if;
    new.orden_id:=v_orden;
  end if;
  if new.documento_compra_id is not null and not exists (
    select 1 from public.documentos_compra_material d
     where d.id=new.documento_compra_id and d.orden_compra_id=new.orden_compra_id
       and d.tipo='FACTURA'
  ) then
    raise exception 'La factura adjunta debe pertenecer a esta compra.';
  end if;
  if new.orden_id is not null and new.unidad_id is not null and not exists (
    select 1 from public.ordenes_trabajo o where o.id=new.orden_id and o.unidad_id=new.unidad_id
  ) then
    raise exception 'La unidad del comprobante debe ser la de la OT.';
  end if;
  if new.estado='REGISTRADA' and new.ruta_storage is not null and not exists (
    select 1 from storage.objects s where s.bucket_id='comprobantes-financieros' and s.name=new.ruta_storage
      and s.name like 'adquisiciones/'||new.id::text||'/%' and s.metadata->>'mimetype'='application/pdf'
  ) then
    raise exception 'Adjunta primero el PDF del comprobante.';
  end if;
  return new;
end $function$;
revoke all on function public.fn_proteger_adquisicion() from public, anon, authenticated;

-- Logística: el último precio de compra de un material cuenta también el de
-- las compras para almacén.
create or replace function public.materiales_para_valorizar()
 returns table(material_id uuid, codigo text, descripcion text, unidad text, existencia numeric, ultima_compra numeric, moneda_compra text, precio numeric, moneda text, valorizado_en timestamp with time zone)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if not (public.es_admin() or public.tiene_permiso('almacen.valorizar') or public.tiene_permiso('almacen.ver') or public.tiene_permiso('costos.ver')) then
    raise exception 'No tienes permiso para ver la valorización del almacén.' using errcode = 'insufficient_privilege';
  end if;
  return query
  select e.material_id, e.codigo, e.descripcion, e.unidad, e.existencia::numeric,
         c.precio_unitario::numeric, c.moneda, v.precio, v.moneda, v.vigente_desde
    from public.v_existencias_materiales e
    left join lateral (
      select cd.precio_unitario, oc.moneda
        from public.orden_compra_material_detalles cd
        join public.ordenes_compra_materiales oc on oc.id = cd.orden_compra_id
        left join public.requerimiento_material_detalles rd on rd.id = cd.requerimiento_detalle_id
        left join public.ot_materiales om on om.id = rd.ot_material_id
       where coalesce(cd.material_id, om.material_id) = e.material_id and cd.precio_unitario is not null
       order by oc.creado_en desc limit 1) c on true
    left join lateral (
      select x.precio, x.moneda, x.vigente_desde from public.valorizaciones_material x
       where x.material_id = e.material_id order by x.vigente_desde desc, x.id desc limit 1) v on true
   order by e.descripcion;
end $function$;
