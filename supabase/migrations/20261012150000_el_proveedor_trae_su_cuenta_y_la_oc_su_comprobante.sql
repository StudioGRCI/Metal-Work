-- =============================================================================
-- EL PROVEEDOR TRAE SU CUENTA Y LA OC SU COMPROBANTE
-- -----------------------------------------------------------------------------
-- La orden de compra de la casa (la OC-5572 es el modelo que dio la empresa) lleva
-- en «Datos del proveedor» el banco, el titular y el número de cuenta, porque
-- con eso Tesorería le paga. El padrón no los tenía: cada OC los copiaba a mano.
-- Gerencia pidió que se registren al dar de alta al proveedor, con su moneda, y
-- también la dirección donde el conductor recoge, que no siempre es la fiscal.
--
-- En la OC, Logística dice si la compra viene con factura o sin ella. En los
-- dos casos se pide un comprobante: la factura, o la boleta, nota de venta o
-- recibo que dé el proveedor. Hasta que se adjunta, la OC lo muestra pendiente,
-- y el conductor sabe qué pedir en la tienda. La OC lleva también el código
-- interno de la unidad para la que se compra, el mismo dato del requerimiento.
--
-- Quién ve las cuentas: Logística, Contabilidad, Tesorería y Gerencia, con el
-- permiso nuevo `proveedores.ver_cuentas`. Almacén, Costos y Supervisión ven el
-- padrón pero no las cuentas. Quien registra proveedores (`proveedores.editar`)
-- registra sus cuentas. Una cuenta no se borra: se le pagó a ella; se da de
-- baja y deja de salir en la OC.
--
-- Sin DROP: el conector de Supabase se cuelga con ellos. La restricción del
-- tipo de documento se cambia con `alter table … drop constraint`, que sí pasa.
-- =============================================================================

-- 1. El permiso de ver las cuentas, y a quién se da -----------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('proveedores.ver_cuentas', 'Logística', 'Ver las cuentas bancarias de los proveedores')
on conflict (codigo) do update set modulo = excluded.modulo, descripcion = excluded.descripcion;

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, 'proveedores.ver_cuentas'
  from public.roles r
 where r.codigo in ('COMPRADOR', 'CONTABILIDAD', 'GERENTE', 'TESORERIA')
on conflict do nothing;

-- 2. La dirección de recojo del proveedor ---------------------------------------
alter table public.proveedores add column if not exists direccion_recojo text;
comment on column public.proveedores.direccion_recojo is
  'Dónde recoge el conductor (la tienda o el almacén del proveedor). Si está vacía, se usa la dirección fiscal.';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ck_proveedores_direccion_recojo'
                   and conrelid = 'public.proveedores'::regclass) then
    alter table public.proveedores add constraint ck_proveedores_direccion_recojo
      check (char_length(coalesce(direccion_recojo, '')) <= 250);
  end if;
end $$;

create or replace function public.fn_proveedor_normalizar()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  new.numero_documento := upper(regexp_replace(coalesce(new.numero_documento, ''), '\s', '', 'g'));
  new.razon_social     := upper(regexp_replace(btrim(coalesce(new.razon_social, '')), '\s+', ' ', 'g'));
  new.nombre_comercial := nullif(regexp_replace(btrim(coalesce(new.nombre_comercial, '')), '\s+', ' ', 'g'), '');
  new.rubro            := nullif(btrim(coalesce(new.rubro, '')), '');
  new.contacto         := nullif(btrim(coalesce(new.contacto, '')), '');
  new.telefono         := nullif(btrim(coalesce(new.telefono, '')), '');
  new.correo           := nullif(lower(btrim(coalesce(new.correo, ''))), '');
  new.direccion        := nullif(btrim(coalesce(new.direccion, '')), '');
  new.direccion_recojo := nullif(btrim(coalesce(new.direccion_recojo, '')), '');
  new.observaciones    := nullif(btrim(coalesce(new.observaciones, '')), '');
  if tg_op = 'UPDATE' then
    new.creado_por := old.creado_por;
    new.creado_en  := old.creado_en;
  end if;
  return new;
end;
$$;
revoke all on function public.fn_proveedor_normalizar() from public, anon, authenticated;

-- 3. Las cuentas bancarias --------------------------------------------------------
create table if not exists public.proveedor_cuentas (
  id             uuid primary key default gen_random_uuid(),
  proveedor_id   uuid not null references public.proveedores(id) on delete restrict,
  banco          text not null,
  numero_cuenta  text not null,
  titular        text not null,
  moneda         text not null default 'PEN',
  activo         boolean not null default true,
  creado_por     uuid default public.usuario_actual() references public.usuarios(id) on delete set null,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint ck_proveedor_cuentas_banco check (char_length(banco) between 2 and 80),
  constraint ck_proveedor_cuentas_numero check (numero_cuenta ~ '^[0-9]{6,30}$'),
  constraint ck_proveedor_cuentas_titular check (char_length(titular) between 2 and 160),
  constraint ck_proveedor_cuentas_moneda check (moneda in ('PEN', 'USD'))
);
comment on table public.proveedor_cuentas is
  'Cuentas bancarias de cada proveedor, con su moneda. La OC imprime la de su moneda. No se borran: se dan de baja.';
comment on column public.proveedor_cuentas.numero_cuenta is
  'Solo dígitos: los guiones y espacios con que se escribe se quitan al guardar.';

-- La llave (proveedor_id, numero_cuenta) cubre también la llave foránea: el
-- formulario y la OC filtran siempre por proveedor.
create unique index if not exists uq_proveedor_cuentas_numero
  on public.proveedor_cuentas (proveedor_id, numero_cuenta);

create or replace function public.fn_proveedor_cuenta_normalizar()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  new.banco         := upper(regexp_replace(btrim(coalesce(new.banco, '')), '\s+', ' ', 'g'));
  new.numero_cuenta := regexp_replace(coalesce(new.numero_cuenta, ''), '[\s.-]', '', 'g');
  new.titular       := upper(regexp_replace(btrim(coalesce(new.titular, '')), '\s+', ' ', 'g'));
  new.moneda        := upper(btrim(coalesce(new.moneda, 'PEN')));
  if tg_op = 'UPDATE' then
    new.proveedor_id := old.proveedor_id;
    new.creado_por   := old.creado_por;
    new.creado_en    := old.creado_en;
  end if;
  return new;
end;
$$;
revoke all on function public.fn_proveedor_cuenta_normalizar() from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_proveedor_cuenta_normalizar'
                   and tgrelid = 'public.proveedor_cuentas'::regclass) then
    create trigger trg_proveedor_cuenta_normalizar before insert or update on public.proveedor_cuentas
      for each row execute function public.fn_proveedor_cuenta_normalizar();
  end if;
end $$;

select public.activar_timestamps('proveedor_cuentas');
select public.activar_auditoria('proveedor_cuentas');
select public.activar_registro_de_prueba('proveedor_cuentas');

alter table public.proveedor_cuentas enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'proveedor_cuentas' and policyname = 'ver_proveedor_cuentas') then
    create policy ver_proveedor_cuentas on public.proveedor_cuentas for select to authenticated using (
      (select public.es_admin()) or (select public.tiene_permiso('proveedores.ver_cuentas'))
    );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'proveedor_cuentas' and policyname = 'crear_proveedor_cuentas') then
    create policy crear_proveedor_cuentas on public.proveedor_cuentas for insert to authenticated with check (
      (select public.es_admin()) or (select public.tiene_permiso('proveedores.editar'))
    );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'proveedor_cuentas' and policyname = 'editar_proveedor_cuentas') then
    create policy editar_proveedor_cuentas on public.proveedor_cuentas for update to authenticated
      using ((select public.es_admin()) or (select public.tiene_permiso('proveedores.editar')))
      with check ((select public.es_admin()) or (select public.tiene_permiso('proveedores.editar')));
  end if;
end $$;

-- Sin política de borrado ni el privilegio: una cuenta a la que se pagó no se
-- borra, se da de baja.
revoke all on public.proveedor_cuentas from public, anon, authenticated;
grant select, insert, update on public.proveedor_cuentas to authenticated;

-- 4. Guardar las cuentas del formulario del proveedor, de una vez ------------------
-- Recibe la lista completa que quedó en el formulario: corrige las que traen
-- id, da de alta las nuevas (o reactiva la misma cuenta si ya estaba de baja) y
-- da de baja las que se quitaron. Todo o nada.
create or replace function public.guardar_cuentas_proveedor(p_proveedor uuid, p_cuentas jsonb)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  v_cuenta jsonb;
  v_id     uuid;
  v_ids    uuid[] := '{}';
begin
  perform public.exigir_permiso('proveedores.editar');
  if not exists (select 1 from public.proveedores where id = p_proveedor) then
    raise exception 'El proveedor no está en el padrón.';
  end if;
  if p_cuentas is null or jsonb_typeof(p_cuentas) is distinct from 'array' then
    raise exception 'No se reconocieron las cuentas bancarias. Vuelve a cargar la pantalla.' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(p_cuentas) > 6 then
    raise exception 'Un proveedor lleva hasta seis cuentas bancarias.' using errcode = 'check_violation';
  end if;

  for v_cuenta in select value from jsonb_array_elements(p_cuentas) loop
    v_id := null;
    if nullif(v_cuenta->>'id', '') is not null then
      update public.proveedor_cuentas
         set banco = v_cuenta->>'banco', numero_cuenta = v_cuenta->>'numero_cuenta',
             titular = v_cuenta->>'titular', moneda = coalesce(v_cuenta->>'moneda', 'PEN'), activo = true
       where id = (v_cuenta->>'id')::uuid and proveedor_id = p_proveedor
      returning id into v_id;
      if v_id is null then
        raise exception 'Una de las cuentas no es de este proveedor. Vuelve a cargar la pantalla.';
      end if;
    else
      insert into public.proveedor_cuentas (proveedor_id, banco, numero_cuenta, titular, moneda)
      values (p_proveedor, v_cuenta->>'banco', v_cuenta->>'numero_cuenta', v_cuenta->>'titular', coalesce(v_cuenta->>'moneda', 'PEN'))
      on conflict (proveedor_id, numero_cuenta) do update
        set banco = excluded.banco, titular = excluded.titular, moneda = excluded.moneda, activo = true
      returning id into v_id;
    end if;
    if v_id = any(v_ids) then
      raise exception 'Hay una cuenta repetida: cada número va una sola vez.' using errcode = 'check_violation';
    end if;
    v_ids := v_ids || v_id;
  end loop;

  update public.proveedor_cuentas set activo = false
   where proveedor_id = p_proveedor and activo and not (id = any(v_ids));
  return coalesce(array_length(v_ids, 1), 0);
end;
$$;
comment on function public.guardar_cuentas_proveedor(uuid, jsonb) is
  'Deja las cuentas bancarias activas del proveedor como vienen en la lista: corrige, da de alta y da de baja las que faltan.';
revoke all on function public.guardar_cuentas_proveedor(uuid, jsonb) from public, anon;
grant execute on function public.guardar_cuentas_proveedor(uuid, jsonb) to authenticated;

-- 5. La OC dice si viene con factura y para qué unidad es ------------------------
alter table public.ordenes_compra_materiales add column if not exists con_factura boolean not null default true;
comment on column public.ordenes_compra_materiales.con_factura is
  'Si el proveedor da factura. Sin factura se pide otro comprobante (boleta, nota de venta, recibo). En los dos casos se adjunta.';

-- El código interno: el mismo dato y el mismo formato que el del requerimiento
-- (RQ) de «Requerimientos y vehículos»: texto libre de 2 a 60 caracteres con el
-- código de la unidad (PLA_SR_O4_1_26/28…), o PLANTA si no es para una unidad.
-- Es lo que después une la OC con el RQ y con la OT.
alter table public.ordenes_compra_materiales add column if not exists codigo_interno text;
comment on column public.ordenes_compra_materiales.codigo_interno is
  'Código interno de la unidad para la que se compra (PLA_SR_O4_1_26/28…), o PLANTA. Mismo formato que requerimientos.codigo_interno. Vacío en las compras de antes.';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ck_compra_codigo_interno'
                   and conrelid = 'public.ordenes_compra_materiales'::regclass) then
    alter table public.ordenes_compra_materiales add constraint ck_compra_codigo_interno
      check (codigo_interno is null or char_length(codigo_interno) between 2 and 60);
  end if;
end $$;

create or replace function public.validar_datos_de_compra(p_con_factura boolean, p_codigo_interno text)
returns void language plpgsql immutable set search_path to 'public' as $$
begin
  if p_con_factura is null then
    raise exception 'Indica si la compra viene con factura o sin factura.' using errcode = 'check_violation';
  end if;
  if char_length(btrim(coalesce(p_codigo_interno, ''))) not between 2 and 60 then
    raise exception 'Escribe el código interno de la unidad (de 2 a 60 caracteres). Si no es para una unidad, escribe PLANTA.'
      using errcode = 'check_violation';
  end if;
end;
$$;
revoke all on function public.validar_datos_de_compra(boolean, text) from public, anon, authenticated;

-- El comprobante que no es factura se adjunta con su propio tipo.
do $$ begin
  if exists (select 1 from pg_constraint where conname = 'documentos_compra_material_tipo_check'
               and conrelid = 'public.documentos_compra_material'::regclass) then
    alter table public.documentos_compra_material drop constraint documentos_compra_material_tipo_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_documentos_compra_material_tipo'
                   and conrelid = 'public.documentos_compra_material'::regclass) then
    alter table public.documentos_compra_material add constraint ck_documentos_compra_material_tipo
      check (tipo in ('ORDEN_COMPRA', 'ORDEN_PAGO', 'ORDEN_SERVICIO', 'FACTURA', 'COMPROBANTE', 'OTRO'));
  end if;
end $$;

-- ¿Ya tiene su comprobante? La factura vale siempre; sin factura, también el
-- comprobante que la reemplaza.
create or replace function public.compra_tiene_comprobante(p_compra public.ordenes_compra_materiales)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.documentos_compra_material d
     where d.orden_compra_id = p_compra.id
       and (d.tipo = 'FACTURA' or (not p_compra.con_factura and d.tipo = 'COMPROBANTE')));
$$;
revoke all on function public.compra_tiene_comprobante(public.ordenes_compra_materiales) from public, anon, authenticated;

-- Emitir diciendo si viene con factura y para qué unidad es. Las versiones de
-- antes siguen (las usa el código que está en producción hasta que llegue
-- este); estas las envuelven y completan los dos datos.
create or replace function public.emitir_compra_directa(
  p_id uuid, p_proveedor_id uuid, p_referencia text, p_motivo text, p_detalles jsonb,
  p_fecha date, p_condicion text, p_dias integer, p_moneda text, p_con_factura boolean, p_codigo_interno text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.exigir_permiso('compras.crear');
  perform public.validar_datos_de_compra(p_con_factura, p_codigo_interno);
  perform public.emitir_compra_directa(p_id, p_proveedor_id, p_referencia, p_motivo, p_detalles,
                                       p_fecha, p_condicion, p_dias, p_moneda);
  update public.ordenes_compra_materiales
     set con_factura = p_con_factura, codigo_interno = btrim(p_codigo_interno)
   where id = p_id
     and (con_factura is distinct from p_con_factura or codigo_interno is distinct from btrim(p_codigo_interno));
  return p_id;
end;
$$;
revoke all on function public.emitir_compra_directa(uuid, uuid, text, text, jsonb, date, text, integer, text, boolean, text) from public, anon;
grant execute on function public.emitir_compra_directa(uuid, uuid, text, text, jsonb, date, text, integer, text, boolean, text) to authenticated;

create or replace function public.emitir_compra_agrupada(
  p_id uuid, p_proveedor_id uuid, p_referencia text, p_detalles jsonb,
  p_fecha date, p_condicion text, p_dias integer, p_moneda text, p_con_factura boolean, p_codigo_interno text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.exigir_permiso('compras.crear');
  perform public.validar_datos_de_compra(p_con_factura, p_codigo_interno);
  perform public.emitir_compra_agrupada(p_id, p_proveedor_id, p_referencia, p_detalles,
                                        p_fecha, p_condicion, p_dias, p_moneda);
  update public.ordenes_compra_materiales
     set con_factura = p_con_factura, codigo_interno = btrim(p_codigo_interno)
   where id = p_id
     and (con_factura is distinct from p_con_factura or codigo_interno is distinct from btrim(p_codigo_interno));
  return p_id;
end;
$$;
revoke all on function public.emitir_compra_agrupada(uuid, uuid, text, jsonb, date, text, integer, text, boolean, text) from public, anon;
grant execute on function public.emitir_compra_agrupada(uuid, uuid, text, jsonb, date, text, integer, text, boolean, text) to authenticated;

-- Corregir después: la tienda dijo que no hay factura, o que sí, o la compra
-- era para otra unidad. Con o sin factura se cambia mientras la compra no tenga
-- todavía su comprobante; el código interno, siempre (queda en la auditoría).
create or replace function public.fijar_datos_compra(p_compra uuid, p_con_factura boolean, p_codigo_interno text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_compra public.ordenes_compra_materiales%rowtype;
begin
  perform public.exigir_permiso('compras.crear');
  perform public.validar_datos_de_compra(p_con_factura, p_codigo_interno);
  select * into v_compra from public.ordenes_compra_materiales where id = p_compra for update;
  if not found then
    raise exception 'La compra no existe.';
  end if;
  if v_compra.con_factura is distinct from p_con_factura and public.compra_tiene_comprobante(v_compra) then
    raise exception 'La compra % ya tiene su comprobante adjunto: ya no se cambia si viene con factura.',
      coalesce(v_compra.numero, v_compra.referencia) using errcode = 'check_violation';
  end if;
  update public.ordenes_compra_materiales
     set con_factura = p_con_factura, codigo_interno = btrim(p_codigo_interno)
   where id = p_compra
     and (con_factura is distinct from p_con_factura or codigo_interno is distinct from btrim(p_codigo_interno));
  return p_compra;
end;
$$;
revoke all on function public.fijar_datos_compra(uuid, boolean, text) from public, anon;
grant execute on function public.fijar_datos_compra(uuid, boolean, text) to authenticated;

-- 6. El listado de Logística cuenta el comprobante, no solo la factura ------------
-- La columna sigue llamándose `tiene_factura` (cambiarle el nombre obliga a
-- borrar la función); ahora dice si la compra ya tiene su comprobante.
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
         public.compra_tiene_comprobante(c)
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
   -- Lo mismo que deja ver la política de la tabla: Logística todo; quien solo
   -- consulta, las directas y las de las áreas que le tocan.
   where public.es_admin() or public.tiene_permiso('compras.crear') or public.tiene_permiso('tesoreria.ver_documentos')
      or c.requerimiento_id is null
      or exists (select 1 from public.requerimientos_materiales r
                  where r.id = c.requerimiento_id and public.puede_ver_area_material(r.area_destino))
   order by c.creado_en desc
   limit 300;
end;
$$;
revoke all on function public.ordenes_compra_listado() from public, anon;
grant execute on function public.ordenes_compra_listado() to authenticated;

-- 7. El conductor va a la dirección de recojo y sabe qué comprobante pedir --------
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
   where c.recojo in ('POR_RECOGER', 'RECOGIDO')
      or (c.recojo = 'DEJADO' and c.dejado_en > now() - interval '7 days')
   order by case c.recojo when 'RECOGIDO' then 0 when 'POR_RECOGER' then 1 else 2 end,
            coalesce(c.dejado_en, c.recojo_pedido_en) desc
   limit 200;
end;
$$;
revoke all on function public.compras_para_recojo() from public, anon;
grant execute on function public.compras_para_recojo() to authenticated;

-- Lo que la bandeja de antes no traía: si viene con factura, si ya está el
-- comprobante y para qué unidad es. Aparte, porque cambiar las columnas de la
-- otra obliga a borrarla.
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
   where c.recojo in ('POR_RECOGER', 'RECOGIDO')
      or (c.recojo = 'DEJADO' and c.dejado_en > now() - interval '7 days')
   order by case c.recojo when 'RECOGIDO' then 0 when 'POR_RECOGER' then 1 else 2 end,
            coalesce(c.dejado_en, c.recojo_pedido_en) desc
   limit 200;
end;
$$;
revoke all on function public.datos_de_recojo() from public, anon;
grant execute on function public.datos_de_recojo() to authenticated;
