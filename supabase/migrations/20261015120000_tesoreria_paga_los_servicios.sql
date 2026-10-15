-- =============================================================================
-- TESORERÍA PAGA LOS SERVICIOS, Y CONTABILIDAD VE EL KARDEX
-- -----------------------------------------------------------------------------
-- Gerencia lo pidió el 2026-10-14: Tesorería ordena su trabajo en cuatro
-- secciones —ADQUISICIONES (todo lo comprado, por factura), CUENTAS POR COBRAR,
-- CUENTAS POR PAGAR y PAGOS DE SERVICIO— y Contabilidad ve el kardex en lectura:
-- los ingresos con su guía, las atenciones y los egresos.
--
-- Pagos de servicio es nuevo: la orden de servicio que Logística emite con su
-- código interno y Gerencia aprueba (arenado, torno, pintura…) la paga
-- Tesorería contra la factura del proveedor, con su comprobante.
--
-- La factura de venta (Administración → Contabilidad → Tesorería) NO va aquí.
-- El 2026-10-15 Gerencia decidió que la referencia de cada trabajo es el código
-- interno y no la OT: esa parte se rehace colgada del código interno.
--
-- Las tablas nuevas se escriben solo por las funciones de abajo.
-- =============================================================================

-- 1. Permisos ---------------------------------------------------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('tesoreria.pagar_servicios', 'Tesorería',
   'Registrar el pago de una orden de servicio con su comprobante')
on conflict (codigo) do nothing;

-- Tesorería paga los servicios; Contabilidad consulta el kardex.
insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, p.codigo from public.roles r cross join public.permisos p
 where (r.codigo = 'CONTABILIDAD' and p.codigo = 'almacen.ver')
    or (r.codigo = 'TESORERIA' and p.codigo = 'tesoreria.pagar_servicios')
on conflict do nothing;

-- 2. El pago de una orden de servicio ----------------------------------------------
-- Tesorería paga contra la factura o el recibo del proveedor (el procedimiento
-- del SIG, §3.2), en uno o varios pagos, cada uno con su comprobante. Quien
-- paga dice si con ese pago la orden queda cancelada: la OS se emite sin IGV y
-- el proveedor cobra lo que dice su comprobante.
create table if not exists public.pagos_orden_servicio (
  id                    uuid primary key default gen_random_uuid(),
  orden_servicio_id     uuid not null references public.ordenes_servicio(id) on delete restrict,
  fecha_pago            date not null,
  moneda                text not null,
  monto                 numeric(14, 2) not null,
  cancela               boolean not null default true,
  operacion             text,
  comprobante_proveedor text,
  archivo_ruta          text not null,
  archivo_mime          text not null,
  archivo_tamano        integer not null,
  registrado_por        uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  anulado_por           uuid references public.usuarios(id) on delete restrict,
  anulado_en            timestamptz,
  motivo_anulacion      text,
  creado_en             timestamptz not null default now(),
  actualizado_en        timestamptz not null default now(),
  constraint uq_pago_servicio_archivo unique (archivo_ruta),
  constraint ck_pago_servicio_valores check (
    moneda in ('PEN', 'USD') and monto > 0 and monto <= 999999999
    and (operacion is null or char_length(btrim(operacion)) between 1 and 60)
    and (comprobante_proveedor is null or char_length(btrim(comprobante_proveedor)) between 3 and 30)
    and archivo_mime in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
    and archivo_tamano between 1 and 10485760),
  constraint ck_pago_servicio_anulado check (
    anulado_en is null
    or (anulado_por is not null and char_length(btrim(coalesce(motivo_anulacion, ''))) between 10 and 500))
);
comment on table public.pagos_orden_servicio is
  'Un pago de Tesorería a una orden de servicio, con su comprobante. No se borra: se anula.';
-- (b) La pantalla de pagos de servicio suma los pagos de cada orden.
create index if not exists ix_pagos_orden_servicio_os on public.pagos_orden_servicio (orden_servicio_id);
select public.activar_timestamps('pagos_orden_servicio');
select public.activar_auditoria('pagos_orden_servicio');
select public.activar_registro_de_prueba('pagos_orden_servicio');

-- 3. Lo que no se borra ni se corrige ---------------------------------------------
create or replace function public.fn_pago_servicio_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
declare
  v_cambian constant text[] := array['anulado_por', 'anulado_en', 'motivo_anulacion', 'actualizado_en'];
begin
  if tg_op = 'DELETE' then
    raise exception 'Un pago no se borra: se anula con su motivo.' using errcode = 'check_violation';
  end if;
  if old.anulado_en is not null then
    raise exception 'Ese pago está anulado: queda como evidencia.' using errcode = 'check_violation';
  end if;
  if (to_jsonb(new) - v_cambian) is distinct from (to_jsonb(old) - v_cambian) then
    raise exception 'Lo que dice el pago no se corrige: anúlalo con su motivo y regístralo de nuevo.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_pago_servicio_guardia() from public, anon, authenticated;
create or replace trigger trg_pago_servicio_guardia
  before update or delete on public.pagos_orden_servicio
  for each row execute function public.fn_pago_servicio_guardia();

-- 4. Quién ve qué ---------------------------------------------------------------------
-- Los pagos de servicio: Tesorería, Gerencia y Logística (que emitió la orden).
alter table public.pagos_orden_servicio enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'pagos_orden_servicio' and policyname = 'ver_pagos_orden_servicio') then
    create policy ver_pagos_orden_servicio on public.pagos_orden_servicio for select to authenticated
      using ((select public.es_admin()) or (select public.tiene_permiso('tesoreria.pagar_servicios'))
             or (select public.tiene_permiso('tesoreria.ver_documentos'))
             or (select public.tiene_permiso('compras.crear')));
  end if;
end $$;
revoke all on public.pagos_orden_servicio from public, anon, authenticated;
grant select on public.pagos_orden_servicio to authenticated;

-- 5. El comprobante en Storage ----------------------------------------------------------
-- Privado, hasta 10 MB, PDF o foto, en `pagos-servicio/{orden de servicio}/…`:
-- lo sube Tesorería. Lo ven quien lo subió y quien ve el pago que lo nombra (la
-- política de la tabla decide); uno suelto, subido y no registrado, lo retira
-- su dueño.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pagos-servicio', 'pagos-servicio', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'pagos_servicio_subir') then
    create policy pagos_servicio_subir on storage.objects for insert to authenticated with check (
      bucket_id = 'pagos-servicio' and owner_id = (select auth.uid())::text
      and (select public.tiene_permiso('tesoreria.pagar_servicios') or public.es_admin()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'pagos_servicio_ver') then
    create policy pagos_servicio_ver on storage.objects for select to authenticated using (
      bucket_id = 'pagos-servicio'
      and (owner_id = (select auth.uid())::text
           or exists (select 1 from public.pagos_orden_servicio p where p.archivo_ruta = objects.name)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'pagos_servicio_quitar_suelto') then
    create policy pagos_servicio_quitar_suelto on storage.objects for delete to authenticated using (
      bucket_id = 'pagos-servicio' and owner_id = (select auth.uid())::text
      and not exists (select 1 from public.pagos_orden_servicio p where p.archivo_ruta = objects.name));
  end if;
end $$;

-- El archivo que quien llama acaba de subir: que exista, que sea suyo y del
-- tipo y tamaño que se aceptan. La llaman solo las funciones que registran.
create or replace function public.archivo_subido_por_mi(p_bucket text, p_ruta text, p_carpeta uuid, p_tipos text[])
returns storage.objects language plpgsql stable set search_path to 'public' as $$
declare v_obj storage.objects%rowtype;
begin
  if p_ruta is null or p_ruta !~ ('^' || p_carpeta::text || '/[0-9a-f-]{36}\.(pdf|jpg|png|webp)$') then
    raise exception 'Vuelve a adjuntar el archivo.' using errcode = 'check_violation';
  end if;
  select * into v_obj from storage.objects where bucket_id = p_bucket and name = p_ruta;
  if not found or v_obj.owner_id is distinct from public.usuario_actual()::text
     or not (v_obj.metadata->>'mimetype' = any (p_tipos))
     or coalesce((v_obj.metadata->>'size')::bigint, 0) not between 1 and 10485760 then
    raise exception 'El archivo no terminó de subir: vuelve a adjuntarlo.' using errcode = 'check_violation';
  end if;
  return v_obj;
end;
$$;
revoke all on function public.archivo_subido_por_mi(text, text, uuid, text[]) from public, anon, authenticated;

-- 6. Los servicios que Tesorería paga ----------------------------------------------------
-- Las órdenes de servicio aprobadas por Gerencia y no anuladas, con su código
-- interno y lo pagado. Cancelada: Tesorería registró un pago vigente que la cancela.
create or replace function public.servicios_por_pagar()
returns table (
  id uuid, numero text, proveedor_id uuid, proveedor text, proveedor_documento text, codigo_interno text, descripcion text,
  moneda text, monto numeric, condicion_pago text, dias_credito integer, estado text, aprobado_en timestamptz,
  conformidad_en timestamptz, pagado numeric, cancelada boolean, ultimo_pago date
) language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not (public.es_admin() or public.tiene_permiso('tesoreria.pagar_servicios') or public.tiene_permiso('tesoreria.ver_documentos')) then
    raise exception 'Los pagos de servicio los lleva Tesorería.' using errcode = 'insufficient_privilege';
  end if;
  return query
    select s.id, s.numero, s.proveedor_id, s.proveedor, p.numero_documento, s.codigo_interno, s.descripcion, s.moneda, s.monto,
           s.condicion_pago, s.dias_credito, s.estado, s.aprobado_en, s.conformidad_en,
           coalesce(sum(g.monto) filter (where g.anulado_en is null), 0)::numeric(14, 2),
           coalesce(bool_or(g.cancela) filter (where g.anulado_en is null), false),
           max(g.fecha_pago) filter (where g.anulado_en is null)
      from public.ordenes_servicio s
      left join public.proveedores p on p.id = s.proveedor_id
      left join public.pagos_orden_servicio g on g.orden_servicio_id = s.id
     where s.aprobacion = 'APROBADA' and s.estado <> 'ANULADA'
     group by s.id, p.numero_documento
     order by s.aprobado_en desc
     limit 300;
end;
$$;
revoke all on function public.servicios_por_pagar() from public, anon;
grant execute on function public.servicios_por_pagar() to authenticated;

create or replace function public.registrar_pago_servicio(
  p_id uuid, p_orden_servicio uuid, p_fecha_pago date, p_monto numeric, p_cancela boolean,
  p_operacion text, p_comprobante text, p_ruta text
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo   uuid := public.usuario_actual();
  v_hoy  date := (now() at time zone 'America/Lima')::date;
  v_os   public.ordenes_servicio%rowtype;
  v_obj  storage.objects%rowtype;
  v_op   text := nullif(btrim(coalesce(p_operacion, '')), '');
  v_comp text := nullif(upper(btrim(coalesce(p_comprobante, ''))), '');
begin
  perform public.exigir_permiso('tesoreria.pagar_servicios');
  if p_id is null then raise exception 'Vuelve a abrir el formulario del pago.' using errcode = 'check_violation'; end if;
  if exists (select 1 from public.pagos_orden_servicio where id = p_id) then return p_id; end if;
  select * into v_os from public.ordenes_servicio where id = p_orden_servicio for update;
  if not found then raise exception 'Esa orden de servicio no existe.' using errcode = 'check_violation'; end if;
  if v_os.estado = 'ANULADA' or v_os.aprobacion <> 'APROBADA' then
    raise exception 'La orden de servicio % no está aprobada por Gerencia: no se paga.', v_os.numero using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.pagos_orden_servicio
              where orden_servicio_id = p_orden_servicio and anulado_en is null and cancela) then
    raise exception 'La orden de servicio % ya está cancelada.', v_os.numero using errcode = 'check_violation';
  end if;
  if p_fecha_pago is null or p_fecha_pago > v_hoy or p_fecha_pago < v_hoy - 365 then
    raise exception 'Elige el día del pago: de hoy hacia atrás.' using errcode = 'check_violation';
  end if;
  if p_monto is null or p_monto <= 0 or p_monto > 999999999 or p_monto <> round(p_monto, 2) then
    raise exception 'Escribe lo que se pagó, en dos decimales.' using errcode = 'check_violation';
  end if;
  if v_op is not null and char_length(v_op) > 60 then
    raise exception 'El número de operación pasa de 60 caracteres.' using errcode = 'check_violation';
  end if;
  if v_comp is not null and char_length(v_comp) not between 3 and 30 then
    raise exception 'El número de la factura o recibo del proveedor va de 3 a 30 caracteres.' using errcode = 'check_violation';
  end if;
  v_obj := public.archivo_subido_por_mi('pagos-servicio', p_ruta, p_orden_servicio,
                                        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

  insert into public.pagos_orden_servicio (id, orden_servicio_id, fecha_pago, moneda, monto, cancela, operacion,
                                           comprobante_proveedor, archivo_ruta, archivo_mime, archivo_tamano, registrado_por)
  values (p_id, p_orden_servicio, p_fecha_pago, v_os.moneda, p_monto, coalesce(p_cancela, true), v_op, v_comp, p_ruta,
          v_obj.metadata->>'mimetype', (v_obj.metadata->>'size')::integer, v_yo);

  perform public.notificar_a_permiso('compras.crear',
    case when coalesce(p_cancela, true) then 'Servicio pagado: ' else 'Pago a cuenta de un servicio: ' end || v_os.numero,
    v_os.proveedor || ' · ' || case when v_os.moneda = 'USD' then 'US$ ' else 'S/ ' end || to_char(p_monto, 'FM999G999G990D00'),
    '/compras/servicios', 'pagos_orden_servicio', p_id, v_yo);
  return p_id;
end;
$$;
revoke all on function public.registrar_pago_servicio(uuid, uuid, date, numeric, boolean, text, text, text) from public, anon;
grant execute on function public.registrar_pago_servicio(uuid, uuid, date, numeric, boolean, text, text, text) to authenticated;

create or replace function public.anular_pago_servicio(p_id uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_pago public.pagos_orden_servicio%rowtype;
begin
  perform public.exigir_permiso('tesoreria.pagar_servicios');
  if char_length(btrim(coalesce(p_motivo, ''))) not between 10 and 500 then
    raise exception 'Cuenta por qué se anula, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_pago from public.pagos_orden_servicio where id = p_id for update;
  if not found then raise exception 'Ese pago no existe.' using errcode = 'check_violation'; end if;
  if v_pago.anulado_en is not null then return p_id; end if;
  update public.pagos_orden_servicio
     set anulado_por = public.usuario_actual(), anulado_en = now(), motivo_anulacion = btrim(p_motivo)
   where id = p_id;
  return p_id;
end;
$$;
revoke all on function public.anular_pago_servicio(uuid, text) from public, anon;
grant execute on function public.anular_pago_servicio(uuid, text) to authenticated;

-- 7. Lo que espera a Tesorería, para el tablero ----------------------------------------
-- Las OS conformes sin un pago que las cancele; a quien no paga servicios, nulo.
create or replace function public.servicios_pendientes_de_pago()
returns integer language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not (public.es_admin() or public.tiene_permiso('tesoreria.pagar_servicios')) then
    return null;
  end if;
  return (select count(*)::integer from public.ordenes_servicio s
           where s.aprobacion = 'APROBADA' and s.estado = 'CONFORME'
             and not exists (select 1 from public.pagos_orden_servicio g
                              where g.orden_servicio_id = s.id and g.anulado_en is null and g.cancela));
end;
$$;
revoke all on function public.servicios_pendientes_de_pago() from public, anon;
grant execute on function public.servicios_pendientes_de_pago() to authenticated;
