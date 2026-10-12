-- =============================================================================
-- LA ORDEN DE COMPRA DIRECTA Y EL CONDUCTOR DE LOGÍSTICA
-- -----------------------------------------------------------------------------
-- Hasta hoy una orden de compra solo podía nacer de un requerimiento de una OT.
-- Pero Logística también compra para el almacén sin que nadie lo haya pedido
-- por una OT: reposición de consumibles, lo que bajó del mínimo, una oferta del
-- proveedor. Eso se hacía en el Excel generador de OC y no quedaba en el
-- sistema. Desde aquí Logística emite una **orden de compra directa**: elige
-- materiales del catálogo de Almacén, el proveedor del padrón, cantidades y
-- precios, y dice por qué compra. Como ningún requerimiento la respalda, la
-- directa **siempre** pasa por Gerencia (el puesto que fija la regla de
-- aprobación), esté encendida o no la regla de monto.
--
-- Aprobada, la orden le llega al **conductor de Logística**, que va al
-- proveedor, la recoge y la deja en el almacén. Marca los dos pasos en su
-- teléfono: «recogido» y «dejado en almacén». Al dejarla, cada línea queda como
-- **ingreso pendiente** en el kardex, y Almacén la valida sin volver a digitarla
-- (el contrato con Almacén está en erp-contratos/ingreso-pendiente.md).
--
-- Además, toda orden de compra nueva lleva desde aquí su número de la casa,
-- `OC-5582-MW` en adelante, el mismo formato que Logística usa en papel. El
-- campo `referencia` sigue guardando el número de la cotización o proforma del
-- proveedor.
-- =============================================================================

-- 1. El permiso y el puesto ------------------------------------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('compras.recojo', 'Logística', 'Recoger las compras donde el proveedor y dejarlas en Almacén')
on conflict (codigo) do update set modulo = excluded.modulo, descripcion = excluded.descripcion;

insert into public.roles (codigo, nombre, descripcion, nivel, es_sistema) values
  ('CONDUCTOR', 'Conductor de Logística',
   'Recoge las órdenes de compra aprobadas donde el proveedor y las deja en Almacén.', 10, true)
on conflict (codigo) do update set nombre = excluded.nombre, descripcion = excluded.descripcion;

-- El conductor solo recoge y deja. No ve precios, ni compras, ni el almacén:
-- todo lo lee y lo escribe por las tres funciones de su bandeja.
insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, 'compras.recojo' from public.roles r where r.codigo = 'CONDUCTOR'
on conflict do nothing;

-- 2. La serie de la casa --------------------------------------------------------
-- La última OC de Metal Work que se ve en el OneDrive es la OC-5581-MW. Si
-- Logística emitió más a mano después, se ajusta `correlativo_actual` antes de
-- la primera orden real.
insert into public.series_documentarias (tipo, serie, prefijo, correlativo_actual, longitud, formato)
select 'ORDEN_COMPRA', '001', 'OC', 5581, 4, 'OC-{numero}-MW'
 where not exists (select 1 from public.series_documentarias where tipo = 'ORDEN_COMPRA' and serie = '001');

-- 3. La cabecera ----------------------------------------------------------------
alter table public.ordenes_compra_materiales alter column requerimiento_id drop not null;
alter table public.ordenes_compra_materiales
  add column if not exists origen text not null default 'REQUERIMIENTO',
  add column if not exists numero text,
  add column if not exists motivo text,
  add column if not exists recojo text,
  add column if not exists recojo_pedido_en timestamptz,
  add column if not exists recojo_pedido_por uuid references public.usuarios(id) on delete restrict,
  add column if not exists recogido_en timestamptz,
  add column if not exists recogido_por uuid references public.usuarios(id) on delete restrict,
  add column if not exists dejado_en timestamptz,
  add column if not exists dejado_por uuid references public.usuarios(id) on delete restrict;

do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.ordenes_compra_materiales'::regclass
                   and conname = 'ck_compra_origen') then
    alter table public.ordenes_compra_materiales add constraint ck_compra_origen check (
      origen in ('REQUERIMIENTO', 'DIRECTA')
      and ((origen = 'DIRECTA') = (requerimiento_id is null))
      and (origen <> 'DIRECTA' or char_length(btrim(coalesce(motivo, ''))) between 5 and 500)
    );
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.ordenes_compra_materiales'::regclass
                   and conname = 'ck_compra_recojo') then
    alter table public.ordenes_compra_materiales add constraint ck_compra_recojo check (
      (recojo is null or recojo in ('POR_RECOGER', 'RECOGIDO', 'DEJADO'))
      and (recojo is null or recojo_pedido_en is not null)
      and (recojo is distinct from 'RECOGIDO' or (recogido_en is not null and recogido_por is not null))
      and (recojo is distinct from 'DEJADO' or (recogido_en is not null and dejado_en is not null and dejado_por is not null
                                                and entregado_almacen_en is not null))
    );
  end if;
end $$;

comment on column public.ordenes_compra_materiales.origen is
  'REQUERIMIENTO (nace de la solicitud de una OT) o DIRECTA (Logística compra para el almacén, sin requerimiento).';
comment on column public.ordenes_compra_materiales.numero is
  'Número de la casa, OC-5582-MW en adelante. Lo pone la base. Las compras anteriores a la serie no lo tienen.';
comment on column public.ordenes_compra_materiales.referencia is
  'Número de la cotización o proforma del proveedor. En la directa, si no se indica, repite el número de la casa.';
comment on column public.ordenes_compra_materiales.motivo is
  'Por qué se compra sin requerimiento. Obligatorio en la directa: es lo que lee Gerencia al aprobar.';
comment on column public.ordenes_compra_materiales.recojo is
  'null (no va con el conductor), POR_RECOGER, RECOGIDO o DEJADO. Solo avanza.';

-- El número de la casa es único; las compras viejas no lo tienen.
create unique index if not exists uq_compra_numero on public.ordenes_compra_materiales (numero) where numero is not null;
-- La bandeja del conductor solo mira lo que está en camino.
create index if not exists ix_compras_en_recojo on public.ordenes_compra_materiales (recojo_pedido_en)
  where recojo in ('POR_RECOGER', 'RECOGIDO');

create or replace function public.fn_compra_numero()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.numero is null then
    new.numero := public.siguiente_correlativo('ORDEN_COMPRA', '001', null);
  end if;
  return new;
end;
$$;
revoke all on function public.fn_compra_numero() from public, anon, authenticated;

create or replace trigger trg_compra_numero
  before insert on public.ordenes_compra_materiales
  for each row execute function public.fn_compra_numero();

-- 4. Las líneas -----------------------------------------------------------------
alter table public.orden_compra_material_detalles alter column requerimiento_id drop not null;
alter table public.orden_compra_material_detalles alter column requerimiento_detalle_id drop not null;
alter table public.orden_compra_material_detalles
  add column if not exists material_id uuid references public.materiales(id) on delete restrict;

do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.orden_compra_material_detalles'::regclass
                   and conname = 'ck_oc_linea_origen') then
    alter table public.orden_compra_material_detalles add constraint ck_oc_linea_origen check (
      ((requerimiento_id is null) = (requerimiento_detalle_id is null))
      and (requerimiento_detalle_id is not null or material_id is not null)
    );
  end if;
end $$;
comment on column public.orden_compra_material_detalles.material_id is
  'Material del catálogo. Obligatorio en la directa; en la de requerimiento lo completa la base desde la solicitud.';

-- Una directa no repite material. (Sin índice aparte para material_id: este
-- empieza por la compra, que es por donde se lee, y el material no se borra.)
create unique index if not exists uq_oc_linea_directa on public.orden_compra_material_detalles (orden_compra_id, material_id)
  where requerimiento_detalle_id is null;

-- La línea directa va solo en una compra directa, y la de requerimiento solo
-- en una de requerimiento. La de requerimiento se queda con su material.
create or replace function public.fn_oc_linea_origen()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_origen text;
begin
  select origen into v_origen from public.ordenes_compra_materiales where id = new.orden_compra_id;
  if new.requerimiento_detalle_id is null then
    if v_origen is distinct from 'DIRECTA' then
      raise exception 'Una línea sin requerimiento solo va en una orden de compra directa.' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.materiales where id = new.material_id and activo) then
      raise exception 'Elige un material activo del catálogo de Almacén.' using errcode = 'check_violation';
    end if;
  else
    if v_origen = 'DIRECTA' then
      raise exception 'Una orden de compra directa no lleva líneas de requerimiento.' using errcode = 'check_violation';
    end if;
    select om.material_id into new.material_id
      from public.requerimiento_material_detalles d
      join public.ot_materiales om on om.id = d.ot_material_id
     where d.id = new.requerimiento_detalle_id;
  end if;
  return new;
end;
$$;
revoke all on function public.fn_oc_linea_origen() from public, anon, authenticated;

create or replace trigger trg_oc_linea_origen
  before insert on public.orden_compra_material_detalles
  for each row execute function public.fn_oc_linea_origen();

-- La línea directa no pasa por la derivación de Almacén: no hay solicitud.
create or replace function public.fn_compra_exige_derivacion()
returns trigger language plpgsql set search_path='public' as $$
declare v_faltante numeric;
begin
 if new.requerimiento_detalle_id is null then return new; end if;
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

-- 5. Quién ve la compra directa -------------------------------------------------
-- La de requerimiento se ve por el área de su solicitud; la directa no tiene
-- área: la ve quien ve las compras.
alter policy ver_ordenes_compra_materiales on public.ordenes_compra_materiales using (
  (public.tiene_permiso('compras.ver') or public.tiene_permiso('almacen.recibir') or public.tiene_permiso('tesoreria.ver_documentos'))
  and (public.tiene_permiso('tesoreria.ver_documentos')
       or requerimiento_id is null
       or exists (select 1 from public.requerimientos_materiales r
                   where r.id = ordenes_compra_materiales.requerimiento_id and public.puede_ver_area_material(r.area_destino)))
);
alter policy ver_orden_compra_material_detalles on public.orden_compra_material_detalles using (
  ((select public.tiene_permiso('compras.ver')) or (select public.tiene_permiso('almacen.recibir')))
  and (requerimiento_id is null
       or exists (select 1 from public.requerimientos_materiales r
                   where r.id = orden_compra_material_detalles.requerimiento_id and public.puede_ver_area_material(r.area_destino)))
);

-- 6. La directa siempre la aprueba Gerencia --------------------------------------
-- Misma evaluación que la migración de aprobación; solo cambia que la directa
-- no mira si la regla está encendida ni el monto.
create or replace function public.evaluar_aprobacion_compra(p_compra uuid)
returns text language plpgsql security definer set search_path to 'public' as $$
declare
  v_compra  public.ordenes_compra_materiales%rowtype;
  v_regla   public.regla_aprobacion_compras%rowtype;
  v_total   numeric;
  v_tc      numeric;
  v_pen     numeric;
  v_directa boolean;
begin
  select * into v_compra from public.ordenes_compra_materiales where id = p_compra for update;
  if not found or v_compra.aprobacion = 'RECHAZADA' then
    return v_compra.aprobacion;
  end if;
  v_directa := v_compra.origen = 'DIRECTA';
  select * into v_regla from public.regla_aprobacion_compras where unica;

  select coalesce(sum(cantidad * coalesce(precio_unitario, 0)), 0) into v_total
    from public.orden_compra_material_detalles where orden_compra_id = p_compra;
  if v_compra.moneda = 'USD' then
    v_tc := public.tipo_cambio_venta(current_date);
    v_pen := case when v_tc is null then null else round(v_total * v_tc, 2) end;
  else
    v_pen := round(v_total, 2);
  end if;

  update public.ordenes_compra_materiales set monto_pen = v_pen where id = p_compra;

  if not coalesce(v_regla.activa, false) and not v_directa then
    return v_compra.aprobacion;
  end if;
  if v_compra.aprobacion = 'APROBADA' and v_pen is not null and v_pen <= v_compra.monto_aprobado_pen then
    return 'APROBADA';
  end if;
  if v_compra.aprobacion = 'NO_REQUERIDA' and v_compra.entregado_almacen_en is not null then
    return 'NO_REQUERIDA';
  end if;
  if not v_directa and v_pen is not null and v_pen < v_regla.monto_desde then
    return v_compra.aprobacion;
  end if;
  if v_compra.aprobacion = 'POR_APROBAR' then
    return 'POR_APROBAR';
  end if;

  update public.ordenes_compra_materiales
     set aprobacion = 'POR_APROBAR', aprobacion_pedida_en = now(),
         aprobado_por = null, aprobado_en = null
   where id = p_compra;

  insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
  select u.id,
         'Compra por aprobar: ' || coalesce(v_compra.numero, v_compra.referencia),
         v_compra.proveedor || ' · ' || coalesce('S/ ' || to_char(v_pen, 'FM999G999G990D00'), v_compra.moneda || ' sin tipo de cambio')
           || case when v_directa then ' · Directa, sin requerimiento' else '' end,
         '/compras/aprobacion', 'ordenes_compra_materiales', p_compra
    from public.usuarios u
   where u.activo and u.rol_id = v_regla.rol_aprobador_id
     and u.id is distinct from v_compra.creado_por;
  return 'POR_APROBAR';
end;
$$;
revoke all on function public.evaluar_aprobacion_compra(uuid) from public, anon, authenticated;

-- Al rechazar, la copia de las líneas también guarda las directas.
create or replace function public.rechazar_compra(p_compra uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_compra public.ordenes_compra_materiales%rowtype; v_lineas jsonb;
begin
  if not public.es_aprobador_compras() then
    raise exception 'Solo el puesto que aprueba las compras puede rechazarlas.' using errcode = 'insufficient_privilege';
  end if;
  if char_length(btrim(coalesce(p_motivo, ''))) not between 10 and 500 then
    raise exception 'Escribe el motivo del rechazo (de 10 a 500 caracteres): Logística lo necesita para corregir la compra.'
      using errcode = 'check_violation';
  end if;
  select * into v_compra from public.ordenes_compra_materiales where id = p_compra for update;
  if not found then
    raise exception 'La compra no existe.';
  end if;
  if v_compra.aprobacion = 'RECHAZADA' then
    return p_compra;
  end if;
  if v_compra.aprobacion <> 'POR_APROBAR' then
    raise exception 'La compra % no está esperando aprobación.', coalesce(v_compra.numero, v_compra.referencia) using errcode = 'check_violation';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'requerimiento_detalle_id', d.requerimiento_detalle_id,
           'material_id', coalesce(d.material_id, om.material_id),
           'orden', o.numero, 'area', r.area_destino,
           'material_codigo', m.codigo, 'material', m.descripcion,
           'cantidad', d.cantidad, 'precio_unitario', d.precio_unitario) order by o.numero nulls first, m.codigo), '[]'::jsonb)
    into v_lineas
    from public.orden_compra_material_detalles d
    left join public.requerimientos_materiales r on r.id = d.requerimiento_id
    left join public.ordenes_trabajo o on o.id = r.orden_id
    left join public.requerimiento_material_detalles rd on rd.id = d.requerimiento_detalle_id
    left join public.ot_materiales om on om.id = rd.ot_material_id
    left join public.materiales m on m.id = coalesce(d.material_id, om.material_id)
   where d.orden_compra_id = p_compra;

  delete from public.orden_compra_material_detalles where orden_compra_id = p_compra;
  update public.ordenes_compra_materiales
     set aprobacion = 'RECHAZADA', rechazado_por = public.usuario_actual(), rechazado_en = now(),
         motivo_rechazo = btrim(p_motivo), lineas_rechazadas = v_lineas
   where id = p_compra;
  perform public.notificar_a_usuario(v_compra.creado_por, 'Compra rechazada: ' || coalesce(v_compra.numero, v_compra.referencia),
    btrim(p_motivo) || case when v_compra.origen = 'DIRECTA' then ' Emite otra orden si todavía hace falta.'
                            else ' Sus líneas volvieron a quedar pendientes de compra.' end,
    '/compras/ordenes', 'ordenes_compra_materiales', p_compra, public.usuario_actual());
  return p_compra;
end;
$$;
revoke all on function public.rechazar_compra(uuid, text) from public, anon;
grant execute on function public.rechazar_compra(uuid, text) to authenticated;

-- 7. Emitir la directa ------------------------------------------------------------
-- p_detalles: [{ "material_id": uuid, "cantidad": n, "precio": n }]
create or replace function public.emitir_compra_directa(
  p_id uuid, p_proveedor_id uuid, p_referencia text, p_motivo text,
  p_detalles jsonb, p_fecha date, p_condicion text, p_dias integer, p_moneda text
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_proveedor public.proveedores%rowtype;
  v_actual    public.ordenes_compra_materiales%rowtype;
  v_linea     record;
  v_numero    text;
begin
  perform public.exigir_permiso('compras.crear');
  if p_id is null or jsonb_typeof(p_detalles) is distinct from 'array' then
    raise exception 'Completa el proveedor y las líneas de la compra.' using errcode = 'check_violation';
  end if;
  if char_length(btrim(coalesce(p_motivo, ''))) not between 5 and 500 then
    raise exception 'Cuenta por qué se compra sin requerimiento (de 5 a 500 caracteres): Gerencia lo lee al aprobar.'
      using errcode = 'check_violation';
  end if;
  if nullif(btrim(p_referencia), '') is not null and char_length(btrim(p_referencia)) not between 2 and 100 then
    raise exception 'La referencia del proveedor va de 2 a 100 caracteres.' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(p_detalles) not between 1 and 100 then
    raise exception 'La compra lleva entre una y cien líneas.' using errcode = 'check_violation';
  end if;
  if p_condicion is null or p_condicion not in ('CONTADO', 'CREDITO') or p_dias is null or p_dias not between 0 and 365
     or (p_condicion = 'CONTADO' and p_dias <> 0) or (p_condicion = 'CREDITO' and p_dias = 0)
     or p_moneda is null or p_moneda not in ('PEN', 'USD') then
    raise exception 'Indica la moneda y el plazo de pago válidos.' using errcode = 'check_violation';
  end if;
  if (select count(distinct x.material_id) from jsonb_to_recordset(p_detalles) x(material_id uuid)) <> jsonb_array_length(p_detalles) then
    raise exception 'No repitas un material en la misma compra: suma las cantidades en una línea.' using errcode = 'check_violation';
  end if;

  select * into v_proveedor from public.proveedores where id = p_proveedor_id;
  if not found then
    raise exception 'Elige un proveedor del padrón.' using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into v_actual from public.ordenes_compra_materiales where id = p_id;
  if found then
    -- Un reintento de la misma compra devuelve la misma compra.
    if v_actual.creado_por = public.usuario_actual() and v_actual.origen = 'DIRECTA'
       and v_actual.proveedor_id = p_proveedor_id and v_actual.motivo = btrim(p_motivo)
       and (select jsonb_agg(jsonb_build_object('m', d.material_id, 'c', d.cantidad, 'p', d.precio_unitario) order by d.material_id)
              from public.orden_compra_material_detalles d where d.orden_compra_id = p_id)
         = (select jsonb_agg(jsonb_build_object('m', x.material_id, 'c', x.cantidad, 'p', x.precio) order by x.material_id)
              from jsonb_to_recordset(p_detalles) x(material_id uuid, cantidad numeric, precio numeric)) then
      return p_id;
    end if;
    raise exception 'Esta compra ya existe con otros datos. Recarga antes de intentar de nuevo.';
  end if;
  if not v_proveedor.activo then
    raise exception 'El proveedor % está dado de baja. Reactívalo en Proveedores o elige otro.', v_proveedor.razon_social;
  end if;
  for v_linea in select * from jsonb_to_recordset(p_detalles) x(material_id uuid, cantidad numeric, precio numeric) loop
    if v_linea.material_id is null or v_linea.cantidad is null or v_linea.cantidad <= 0 or v_linea.cantidad <> round(v_linea.cantidad, 3)
       or v_linea.precio is null or v_linea.precio < 0 or v_linea.precio <> round(v_linea.precio, 2) then
      raise exception 'Cada línea necesita material, cantidad y precio unitario válidos.' using errcode = 'check_violation';
    end if;
  end loop;

  v_numero := public.siguiente_correlativo('ORDEN_COMPRA', '001', null);
  insert into public.ordenes_compra_materiales
    (id, requerimiento_id, origen, numero, proveedor, proveedor_id, referencia, motivo,
     fecha_estimada, creado_por, condicion_pago, dias_credito, moneda)
  values
    (p_id, null, 'DIRECTA', v_numero, v_proveedor.razon_social, p_proveedor_id,
     coalesce(nullif(btrim(p_referencia), ''), v_numero), btrim(p_motivo),
     p_fecha, public.usuario_actual(), p_condicion, p_dias, p_moneda);
  insert into public.orden_compra_material_detalles (orden_compra_id, material_id, cantidad, precio_unitario)
  select p_id, x.material_id, x.cantidad, x.precio
    from jsonb_to_recordset(p_detalles) x(material_id uuid, cantidad numeric, precio numeric)
   order by x.material_id;
  return p_id;
end;
$$;
revoke all on function public.emitir_compra_directa(uuid, uuid, text, text, jsonb, date, text, integer, text) from public, anon;
grant execute on function public.emitir_compra_directa(uuid, uuid, text, text, jsonb, date, text, integer, text) to authenticated;

-- 8. El recojo: solo avanza -----------------------------------------------------
create or replace function public.fn_compra_recojo()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_orden constant text[] := array['POR_RECOGER', 'RECOGIDO', 'DEJADO'];
  v_antes int; v_ahora int;
begin
  -- La directa aprobada sale sola hacia el conductor.
  if new.aprobacion = 'APROBADA' and old.aprobacion is distinct from 'APROBADA'
     and new.origen = 'DIRECTA' and new.recojo is null and new.entregado_almacen_en is null then
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

create or replace trigger trg_compra_recojo
  before update on public.ordenes_compra_materiales
  for each row execute function public.fn_compra_recojo();

-- Logística manda a recojo una compra que no necesitaba aprobación (o ya la
-- tiene) y que el proveedor no va a traer.
create or replace function public.mandar_compra_a_recojo(p_compra uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_compra public.ordenes_compra_materiales%rowtype;
begin
  perform public.exigir_permiso('compras.crear');
  select * into v_compra from public.ordenes_compra_materiales where id = p_compra for update;
  if not found then
    raise exception 'La compra no existe.' using errcode = 'foreign_key_violation';
  end if;
  if v_compra.recojo is not null then
    return p_compra;
  end if;
  if v_compra.entregado_almacen_en is not null then
    raise exception 'La compra % ya se entregó a Almacén.', coalesce(v_compra.numero, v_compra.referencia) using errcode = 'check_violation';
  end if;
  if not public.es_admin() and not exists (
      select 1 from public.usuarios u
        join public.roles_permisos rp on rp.rol_id = u.rol_id and rp.permiso_codigo = 'compras.recojo'
       where u.activo) then
    raise exception 'No hay ningún conductor activo. Da de alta su cuenta antes de mandar compras a recojo.' using errcode = 'check_violation';
  end if;
  update public.ordenes_compra_materiales
     set recojo = 'POR_RECOGER', recojo_pedido_en = now(), recojo_pedido_por = public.usuario_actual()
   where id = p_compra;
  return p_compra;
end;
$$;
revoke all on function public.mandar_compra_a_recojo(uuid) from public, anon;
grant execute on function public.mandar_compra_a_recojo(uuid) to authenticated;

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
  if v_compra.recojo is distinct from 'POR_RECOGER' then
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

-- 9. El ingreso pendiente ---------------------------------------------------------
create table if not exists public.ingresos_pendientes_almacen (
  id                       uuid primary key default gen_random_uuid(),
  orden_compra_id          uuid not null references public.ordenes_compra_materiales(id) on delete restrict,
  orden_compra_detalle_id  uuid not null references public.orden_compra_material_detalles(id) on delete restrict,
  material_id              uuid not null references public.materiales(id) on delete restrict,
  requerimiento_detalle_id uuid references public.requerimiento_material_detalles(id) on delete restrict,
  orden_id                 uuid references public.ordenes_trabajo(id) on delete restrict,
  cantidad                 numeric(14, 3) not null,
  precio_unitario          numeric,
  moneda                   text,
  dejado_por               uuid not null references public.usuarios(id) on delete restrict,
  dejado_en                timestamptz not null,
  estado                   text not null default 'PENDIENTE',
  cantidad_validada        numeric(14, 3),
  movimiento_id            uuid references public.movimientos_materiales(id) on delete restrict,
  validado_por             uuid references public.usuarios(id) on delete restrict,
  validado_en              timestamptz,
  observacion              text,
  creado_en                timestamptz not null default now(),
  actualizado_en           timestamptz not null default now(),
  constraint uq_ingreso_pendiente_linea unique (orden_compra_detalle_id),
  constraint uq_ingreso_pendiente_movimiento unique (movimiento_id),
  constraint ck_ingreso_pendiente_cantidad check (cantidad > 0),
  constraint ck_ingreso_pendiente_moneda check (moneda is null or moneda in ('PEN', 'USD')),
  constraint ck_ingreso_pendiente_estado check (
    estado in ('PENDIENTE', 'VALIDADO', 'OBSERVADO')
    and (cantidad_validada is null or (cantidad_validada > 0 and cantidad_validada <= cantidad))
    and (estado <> 'VALIDADO' or (validado_por is not null and validado_en is not null
                                  and cantidad_validada is not null and movimiento_id is not null))
    and (estado <> 'OBSERVADO' or (validado_por is not null and validado_en is not null
                                   and char_length(btrim(coalesce(observacion, ''))) between 10 and 500))
  )
);
comment on table public.ingresos_pendientes_almacen is
  'Lo que el conductor dejó en el almacén, una fila por línea de la orden de compra. Almacén la valida y la convierte en ingreso del kardex. No se borra.';

-- La bandeja de Almacén lee las pendientes por fecha. (Sin índices aparte para
-- orden_compra_id, material_id ni orden_id: ninguna pantalla filtra por ellos
-- todavía y sus padres no se borran.)
create index if not exists ix_ingresos_pendientes_bandeja on public.ingresos_pendientes_almacen (dejado_en)
  where estado = 'PENDIENTE';

select public.activar_timestamps('ingresos_pendientes_almacen');
select public.activar_auditoria('ingresos_pendientes_almacen');
select public.activar_registro_de_prueba('ingresos_pendientes_almacen');

create or replace function public.fn_ingreso_pendiente_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Un ingreso pendiente no se borra: es la evidencia de lo que el conductor dejó en el almacén.'
      using errcode = 'check_violation';
  end if;
  if new.orden_compra_id is distinct from old.orden_compra_id
     or new.orden_compra_detalle_id is distinct from old.orden_compra_detalle_id
     or new.material_id is distinct from old.material_id
     or new.requerimiento_detalle_id is distinct from old.requerimiento_detalle_id
     or new.orden_id is distinct from old.orden_id
     or new.cantidad is distinct from old.cantidad
     or new.precio_unitario is distinct from old.precio_unitario
     or new.moneda is distinct from old.moneda
     or new.dejado_por is distinct from old.dejado_por
     or new.dejado_en is distinct from old.dejado_en then
    raise exception 'Lo que dejó el conductor no se corrige: valídalo con la cantidad recibida u obsérvalo.'
      using errcode = 'check_violation';
  end if;
  if old.estado <> 'PENDIENTE' and row(new.estado, new.cantidad_validada, new.movimiento_id, new.validado_por, new.validado_en, new.observacion)
       is distinct from row(old.estado, old.cantidad_validada, old.movimiento_id, old.validado_por, old.validado_en, old.observacion) then
    raise exception 'Este ingreso ya fue % y no cambia.', lower(old.estado) using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_ingreso_pendiente_guardia() from public, anon, authenticated;

create or replace trigger trg_ingreso_pendiente_guardia
  before update or delete on public.ingresos_pendientes_almacen
  for each row execute function public.fn_ingreso_pendiente_guardia();

alter table public.ingresos_pendientes_almacen enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ingresos_pendientes_almacen'
                   and policyname = 'ver_ingresos_pendientes_almacen') then
    create policy ver_ingresos_pendientes_almacen on public.ingresos_pendientes_almacen for select to authenticated using (
      (select public.es_admin())
      or (select public.tiene_permiso('almacen.ver'))
      or (select public.tiene_permiso('almacen.recibir'))
      or (select public.tiene_permiso('compras.ver'))
    );
  end if;
end $$;
-- Se escribe solo por funciones: el conductor al dejar, Almacén al validar.
revoke all on public.ingresos_pendientes_almacen from public, anon, authenticated;
grant select on public.ingresos_pendientes_almacen to authenticated;

create or replace function public.marcar_compra_dejada_almacen(p_compra uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_compra public.ordenes_compra_materiales%rowtype; v_lineas int;
begin
  perform public.exigir_permiso('compras.recojo');
  select * into v_compra from public.ordenes_compra_materiales where id = p_compra for update;
  if not found then
    raise exception 'La compra no existe.' using errcode = 'foreign_key_violation';
  end if;
  if v_compra.recojo = 'DEJADO' then
    return p_compra;
  end if;
  if v_compra.recojo is distinct from 'RECOGIDO' then
    raise exception 'Marca primero que recogiste la compra %.', coalesce(v_compra.numero, v_compra.referencia) using errcode = 'check_violation';
  end if;

  update public.ordenes_compra_materiales
     set recojo = 'DEJADO', dejado_en = now(), dejado_por = public.usuario_actual(),
         entregado_almacen_en = coalesce(entregado_almacen_en, now()),
         entregado_almacen_por = coalesce(entregado_almacen_por, public.usuario_actual())
   where id = p_compra;

  -- Una fila por línea, con lo que todavía falta recibir de ella.
  insert into public.ingresos_pendientes_almacen
    (orden_compra_id, orden_compra_detalle_id, material_id, requerimiento_detalle_id, orden_id,
     cantidad, precio_unitario, moneda, dejado_por, dejado_en)
  select p_compra, d.id, coalesce(d.material_id, om.material_id), d.requerimiento_detalle_id, r.orden_id,
         d.cantidad - coalesce(rec.recibido, 0), d.precio_unitario, v_compra.moneda,
         public.usuario_actual(), now()
    from public.orden_compra_material_detalles d
    left join public.requerimientos_materiales r on r.id = d.requerimiento_id
    left join public.requerimiento_material_detalles rd on rd.id = d.requerimiento_detalle_id
    left join public.ot_materiales om on om.id = rd.ot_material_id
    left join lateral (select sum(m.cantidad) as recibido from public.movimientos_materiales m
                        where m.orden_compra_detalle_id = d.id and m.tipo = 'INGRESO') rec on true
   where d.orden_compra_id = p_compra
     and d.cantidad - coalesce(rec.recibido, 0) > 0
  on conflict (orden_compra_detalle_id) do nothing;
  get diagnostics v_lineas = row_count;

  insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
  select u.id, 'Ingreso por validar: ' || coalesce(v_compra.numero, v_compra.referencia),
         v_compra.proveedor || '. ' || v_lineas || case when v_lineas = 1 then ' línea' else ' líneas' end
           || ' dejadas en el almacén por el conductor.',
         '/almacen/kardex', 'ordenes_compra_materiales', p_compra
    from public.usuarios u
    join public.roles_permisos rp on rp.rol_id = u.rol_id and rp.permiso_codigo = 'almacen.recibir'
   where u.activo;
  return p_compra;
end;
$$;
revoke all on function public.marcar_compra_dejada_almacen(uuid) from public, anon;
grant execute on function public.marcar_compra_dejada_almacen(uuid) to authenticated;

-- 10. Lo que se lee ---------------------------------------------------------------
-- La bandeja del conductor: a dónde ir, qué recoger y en qué va. Sin precios.
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
         p.direccion, p.telefono, p.contacto,
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
   where c.recojo in ('POR_RECOGER', 'RECOGIDO')
      or (c.recojo = 'DEJADO' and c.dejado_en > now() - interval '7 days')
   order by case c.recojo when 'RECOGIDO' then 0 when 'POR_RECOGER' then 1 else 2 end,
            coalesce(c.dejado_en, c.recojo_pedido_en) desc
   limit 200;
end;
$$;
revoke all on function public.compras_para_recojo() from public, anon;
grant execute on function public.compras_para_recojo() to authenticated;

-- El listado de Logística: todas sus órdenes, con número, para qué, en qué va.
create or replace function public.ordenes_compra_listado()
returns table (
  id uuid, numero text, referencia text, origen text, proveedor text, proveedor_documento text,
  moneda text, monto numeric, monto_pen numeric, condicion_pago text, dias_credito integer,
  fecha_estimada date, aprobacion text, motivo_rechazo text, recojo text, entregado_almacen_en timestamptz,
  creado_en timestamptz, emitida_por text, motivo text, ordenes text[], unidades text[], lineas integer,
  tiene_factura boolean
) language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not (public.es_admin() or public.tiene_permiso('compras.ver') or public.tiene_permiso('compras.crear')) then
    raise exception 'No tienes permiso para ver las órdenes de compra.' using errcode = 'insufficient_privilege';
  end if;
  return query
  select c.id, coalesce(c.numero, c.referencia), c.referencia, c.origen, c.proveedor, p.numero_documento,
         c.moneda,
         coalesce(l.total, (select sum((x->>'cantidad')::numeric * coalesce((x->>'precio_unitario')::numeric, 0))
                              from jsonb_array_elements(c.lineas_rechazadas) x), 0),
         c.monto_pen, c.condicion_pago, c.dias_credito, c.fecha_estimada, c.aprobacion, c.motivo_rechazo,
         c.recojo, c.entregado_almacen_en, c.creado_en, public.puesto(uc), c.motivo,
         coalesce(l.ordenes, array[]::text[]),
         coalesce(l.unidades, array[]::text[]),
         coalesce(l.n, jsonb_array_length(coalesce(c.lineas_rechazadas, '[]'::jsonb)))::integer,
         exists (select 1 from public.documentos_compra_material dc where dc.orden_compra_id = c.id and dc.tipo = 'FACTURA')
    from public.ordenes_compra_materiales c
    left join public.proveedores p on p.id = c.proveedor_id
    left join public.usuarios uc on uc.id = c.creado_por
    left join lateral (
      select sum(d.cantidad * coalesce(d.precio_unitario, 0)) as total, count(*) as n,
             array_remove(array_agg(distinct o.numero), null) as ordenes,
             array_remove(array_agg(distinct public.nombre_unidad_almacen(u)) filter (where u.id is not null), null) as unidades
        from public.orden_compra_material_detalles d
        left join public.requerimientos_materiales r on r.id = d.requerimiento_id
        left join public.ordenes_trabajo o on o.id = r.orden_id
        left join public.unidades u on u.id = o.unidad_id
       where d.orden_compra_id = c.id
    ) l on true
   order by c.creado_en desc
   limit 300;
end;
$$;
revoke all on function public.ordenes_compra_listado() from public, anon;
grant execute on function public.ordenes_compra_listado() to authenticated;

-- Las OT a las que Logística puede referir una compra directa o un servicio,
-- con su unidad, sin abrirle la tabla de órdenes.
create or replace function public.ots_para_logistica()
returns table (id uuid, numero text, unidad text, estado text)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not (public.es_admin() or public.tiene_permiso('compras.crear')) then
    raise exception 'No tienes permiso para elegir órdenes de trabajo.' using errcode = 'insufficient_privilege';
  end if;
  return query
  select o.id, o.numero, case when u.id is null then null else public.nombre_unidad_almacen(u) end, o.estado::text
    from public.ordenes_trabajo o
    left join public.unidades u on u.id = o.unidad_id
   where o.estado::text not in ('BORRADOR', 'ANULADA', 'ENTREGADA', 'FACTURADA')
   order by o.creado_en desc
   limit 300;
end;
$$;
revoke all on function public.ots_para_logistica() from public, anon;
grant execute on function public.ots_para_logistica() to authenticated;

-- 11. Tesorería: el comprobante de una compra directa no tiene OT obligatoria ----
create or replace function public.fn_proteger_adquisicion()
returns trigger language plpgsql set search_path to 'public' as $$
declare v_orden uuid; v_condicion text; v_directa boolean;
begin
  if tg_op='UPDATE' then
    if old.estado<>'BORRADOR' then raise exception 'El comprobante registrado no se edita; registra una corrección.'; end if;
    new.id:=old.id; new.registrado_por:=old.registrado_por; new.creado_en:=old.creado_en;
  end if;
  if new.orden_compra_id is not null then
    select r.orden_id, c.condicion_pago, c.origen = 'DIRECTA' into v_orden, v_condicion, v_directa
      from public.ordenes_compra_materiales c
      left join public.requerimientos_materiales r on r.id=c.requerimiento_id
     where c.id=new.orden_compra_id;
    if not coalesce(v_directa, false) and (v_orden is null or (new.orden_id is not null and new.orden_id<>v_orden)) then
      raise exception 'El comprobante debe pertenecer a la misma OT que la compra.';
    end if;
    if v_condicion<>new.condicion_pago then
      raise exception 'La condición de pago debe coincidir con la registrada por Logística.';
    end if;
    new.orden_id:=coalesce(new.orden_id, v_orden);
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
end $$;
revoke all on function public.fn_proteger_adquisicion() from public, anon, authenticated;
