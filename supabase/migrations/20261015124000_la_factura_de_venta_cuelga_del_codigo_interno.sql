-- =============================================================================
-- LA FACTURA DE VENTA Y SU COBRO CUELGAN DEL CÓDIGO INTERNO
-- -----------------------------------------------------------------------------
-- Gerencia lo decidió el 2026-10-15: la referencia de cada trabajo ya no es la
-- OT sino el CÓDIGO INTERNO de la unidad, y «la cotización la ven
-- Administración, Gerencia, Tesorería y Contabilidad, porque según lo que diga
-- la cotización Contabilidad hace la factura, y Tesorería gestiona el pago:
-- cuando hay pago, lo carga y queda vinculado».
--
-- Desde aquí el camino es:
--
--   Cotización aprobada por Gerencia → Administración carga la OT con el código
--   interno de la unidad → la cotización aparece en FACTURACIÓN de Contabilidad
--   → Contabilidad emite la factura en SUNAT (fuera del sistema) y la REGISTRA
--     aquí con su PDF: queda colgada del código interno y de la cotización
--   → la factura entra sola a CUENTAS POR COBRAR de Tesorería
--   → Tesorería registra cada cobro CON SU VOUCHER, hasta cancelarla.
--
-- Una cotización puede llevar varias facturas (la inicial y el saldo). Si lo
-- facturado pasa del total de la cotización, la pantalla avisa sin impedirlo.
-- Ni la factura ni el cobro se borran: se anulan con su motivo.
--
-- Las cuentas por cobrar por OT (`cuentas_cobrar_ot`, que Tesorería anotaba a
-- mano) no tienen ninguna fila en producción al 2026-10-15: se dejan quietas y
-- las pantallas ya no las usan. «Liberar a Tesorería» tampoco hace falta:
-- Tesorería ve toda cotización aprobada.
--
-- Las tablas nuevas se escriben solo por las funciones de abajo. Sin DROP.
-- =============================================================================

-- 1. Permisos ---------------------------------------------------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('contabilidad.facturar', 'Contabilidad',
   'Registrar la factura de venta de una cotización aprobada, por su código interno, y anularla'),
  ('cotizaciones.ver_aprobadas', 'Ventas',
   'Ver las cotizaciones aprobadas con su archivo, y las facturas y los cobros de cada código interno')
on conflict (codigo) do nothing;

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, p.codigo from public.roles r cross join public.permisos p
 where (r.codigo = 'CONTABILIDAD' and p.codigo in ('contabilidad.facturar', 'cotizaciones.ver_aprobadas'))
    or (r.codigo in ('TESORERIA', 'ADMINISTRACION', 'GERENTE') and p.codigo = 'cotizaciones.ver_aprobadas')
on conflict do nothing;

update public.permisos
   set descripcion = 'Liberar a Tesorería una cotización PDF ya aprobada (circuito anterior: desde el 2026-10-15 Tesorería ve toda cotización aprobada)'
 where codigo = 'cotizaciones.liberar_tesoreria';

-- 2. El código interno de una cotización ------------------------------------------
-- Hoy lo pone Administración al cargar la OT de la cotización aprobada
-- (`emitir_orden_de_cotizacion`): es el de la unidad de esa OT. Si el código
-- interno pasa a cargarse de otra forma, se cambia aquí y nada más.
create or replace function public.codigo_interno_de_cotizacion(p_cotizacion uuid)
returns text language sql stable security definer set search_path to 'public' as $$
  select public.normalizar_codigo_interno(u.codigo_interno)
    from public.ordenes_trabajo o
    join public.unidades u on u.id = o.unidad_id
   where o.cotizacion_pdf_id = p_cotizacion and o.estado <> 'ANULADA'
     and public.normalizar_codigo_interno(u.codigo_interno) is not null
   order by o.creado_en desc
   limit 1;
$$;
revoke all on function public.codigo_interno_de_cotizacion(uuid) from public, anon;
grant execute on function public.codigo_interno_de_cotizacion(uuid) to authenticated;

-- Aprobada por Gerencia: ahora, o en una versión anterior si después llegó una
-- corrección que todavía no se aprueba (Contabilidad factura la aprobada).
create or replace function public.cotizacion_fue_aprobada(p_cotizacion uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.cotizaciones_pdf c
                  where c.id = p_cotizacion and c.estado = 'APROBADA')
      or exists (select 1 from public.cotizaciones_pdf c
                   join public.cotizaciones_pdf_versiones v on v.cotizacion_id = c.id
                  where c.id = p_cotizacion and c.estado <> 'ANULADA' and v.estado_al_archivar = 'APROBADA');
$$;
revoke all on function public.cotizacion_fue_aprobada(uuid) from public, anon;
grant execute on function public.cotizacion_fue_aprobada(uuid) to authenticated;

-- 3. La factura de venta -------------------------------------------------------------
-- El número es el de SUNAT (E001-626): serie de 4 y correlativo sin ceros a la
-- izquierda, para que E001-00000626 y E001-626 sean la misma. Cliente, código
-- interno y número de cotización se copian al registrarla: la factura dice a
-- quién y por qué trabajo se emitió.
create table if not exists public.facturas_venta (
  id                 uuid primary key default gen_random_uuid(),
  codigo_interno     text not null,
  cotizacion_pdf_id  uuid not null references public.cotizaciones_pdf(id) on delete restrict,
  cotizacion_numero  text not null,
  cliente_id         uuid references public.clientes(id) on delete restrict,
  cliente            text not null,
  numero             text not null,
  fecha_emision      date not null,
  fecha_vencimiento  date not null,
  moneda             text not null,
  total              numeric(14, 2) not null,
  concepto           text,
  ruta_storage       text not null,
  nombre_archivo     text not null,
  tamano_bytes       integer not null,
  registrado_por     uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  anulada_por        uuid references public.usuarios(id) on delete restrict,
  anulada_en         timestamptz,
  motivo_anulacion   text,
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now(),
  constraint uq_factura_venta_ruta unique (ruta_storage),
  constraint ck_factura_venta_numero check (numero ~ '^[A-Z][A-Z0-9]{3}-[1-9][0-9]{0,7}$'),
  constraint ck_factura_venta_valores check (
    moneda in ('PEN', 'USD') and total > 0 and total <= 999999999
    and fecha_vencimiento >= fecha_emision
    and char_length(btrim(codigo_interno)) between 1 and 60
    and (concepto is null or char_length(btrim(concepto)) between 2 and 200)
    and char_length(btrim(cliente)) between 2 and 200
    and tamano_bytes between 1 and 10485760),
  constraint ck_factura_venta_anulada check (
    anulada_en is null
    or (anulada_por is not null and char_length(btrim(coalesce(motivo_anulacion, ''))) between 10 and 500))
);
comment on table public.facturas_venta is
  'La factura de venta que Contabilidad registra por una cotización aprobada, colgada del código interno de la unidad. Entra sola a cuentas por cobrar de Tesorería. No se borra: se anula.';
-- Un número vale una vez, salvo que la factura con ese número se haya anulado.
create unique index if not exists uq_factura_venta_numero_vigente on public.facturas_venta (numero) where anulada_en is null;
-- (b) Facturación suma lo facturado de cada cotización.
create index if not exists ix_facturas_venta_cotizacion on public.facturas_venta (cotizacion_pdf_id);
-- (b) Cuentas por cobrar y la pantalla de cada código interno filtran por él.
create index if not exists ix_facturas_venta_codigo on public.facturas_venta (codigo_interno);
select public.activar_timestamps('facturas_venta');
select public.activar_auditoria('facturas_venta');
select public.activar_registro_de_prueba('facturas_venta');

-- 4. El cobro, con su voucher ---------------------------------------------------------
-- Tesorería registra lo que entró al banco, en uno o varios cobros, cada uno
-- con su voucher. Quien cobra dice si con ese cobro la factura queda cancelada:
-- la detracción o la retención hacen que lo cobrado no llegue al total. Al
-- llegar al total, se cancela sola.
create table if not exists public.cobros_factura_venta (
  id                uuid primary key default gen_random_uuid(),
  factura_id        uuid not null references public.facturas_venta(id) on delete restrict,
  fecha             date not null,
  moneda            text not null,
  monto             numeric(14, 2) not null,
  cancela           boolean not null default false,
  operacion         text,
  archivo_ruta      text not null,
  archivo_mime      text not null,
  archivo_tamano    integer not null,
  registrado_por    uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  anulado_por       uuid references public.usuarios(id) on delete restrict,
  anulado_en        timestamptz,
  motivo_anulacion  text,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),
  constraint uq_cobro_factura_archivo unique (archivo_ruta),
  constraint ck_cobro_factura_valores check (
    moneda in ('PEN', 'USD') and monto > 0 and monto <= 999999999
    and (operacion is null or char_length(btrim(operacion)) between 1 and 60)
    and archivo_mime in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
    and archivo_tamano between 1 and 10485760),
  constraint ck_cobro_factura_anulado check (
    anulado_en is null
    or (anulado_por is not null and char_length(btrim(coalesce(motivo_anulacion, ''))) between 10 and 500))
);
comment on table public.cobros_factura_venta is
  'Un cobro de Tesorería a una factura de venta, con su voucher. No se borra: se anula.';
-- (b) Cuentas por cobrar suma los cobros de cada factura.
create index if not exists ix_cobros_factura_venta_factura on public.cobros_factura_venta (factura_id);
select public.activar_timestamps('cobros_factura_venta');
select public.activar_auditoria('cobros_factura_venta');
select public.activar_registro_de_prueba('cobros_factura_venta');

-- 5. Lo que no se borra ni se corrige ---------------------------------------------
-- De la factura cambia solo la anulación; anulada, queda congelada.
create or replace function public.fn_factura_venta_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
declare
  v_cambian constant text[] := array['anulada_por', 'anulada_en', 'motivo_anulacion', 'actualizado_en'];
begin
  if tg_op = 'DELETE' then
    raise exception 'Una factura no se borra: se anula con su motivo.' using errcode = 'check_violation';
  end if;
  if old.anulada_en is not null then
    raise exception 'La factura % está anulada: queda como evidencia.', old.numero using errcode = 'check_violation';
  end if;
  if (to_jsonb(new) - v_cambian) is distinct from (to_jsonb(old) - v_cambian) then
    raise exception 'Lo que dice la factura no se corrige: anúlala con su motivo y regístrala de nuevo.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_factura_venta_guardia() from public, anon, authenticated;
create or replace trigger trg_factura_venta_guardia
  before update or delete on public.facturas_venta
  for each row execute function public.fn_factura_venta_guardia();

create or replace function public.fn_cobro_factura_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
declare
  v_cambian constant text[] := array['anulado_por', 'anulado_en', 'motivo_anulacion', 'actualizado_en'];
begin
  if tg_op = 'DELETE' then
    raise exception 'Un cobro no se borra: se anula con su motivo.' using errcode = 'check_violation';
  end if;
  if old.anulado_en is not null then
    raise exception 'Ese cobro está anulado: queda como evidencia.' using errcode = 'check_violation';
  end if;
  if (to_jsonb(new) - v_cambian) is distinct from (to_jsonb(old) - v_cambian) then
    raise exception 'Lo que dice el cobro no se corrige: anúlalo con su motivo y regístralo de nuevo.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_cobro_factura_guardia() from public, anon, authenticated;
create or replace trigger trg_cobro_factura_guardia
  before update or delete on public.cobros_factura_venta
  for each row execute function public.fn_cobro_factura_guardia();

-- 6. Quién ve qué ---------------------------------------------------------------------
-- Facturas y cobros: Contabilidad, Tesorería, Administración y Gerencia (y Costos,
-- que lee los documentos de Tesorería).
alter table public.facturas_venta enable row level security;
alter table public.cobros_factura_venta enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'facturas_venta' and policyname = 'ver_facturas_venta') then
    create policy ver_facturas_venta on public.facturas_venta for select to authenticated
      using ((select public.es_admin()) or (select public.tiene_permiso('contabilidad.facturar'))
             or (select public.tiene_permiso('cotizaciones.ver_aprobadas'))
             or (select public.tiene_permiso('tesoreria.ver_documentos')));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cobros_factura_venta' and policyname = 'ver_cobros_factura_venta') then
    create policy ver_cobros_factura_venta on public.cobros_factura_venta for select to authenticated
      using ((select public.es_admin()) or (select public.tiene_permiso('contabilidad.facturar'))
             or (select public.tiene_permiso('cotizaciones.ver_aprobadas'))
             or (select public.tiene_permiso('tesoreria.ver_documentos')));
  end if;
end $$;
revoke all on public.facturas_venta from public, anon, authenticated;
revoke all on public.cobros_factura_venta from public, anon, authenticated;
grant select on public.facturas_venta to authenticated;
grant select on public.cobros_factura_venta to authenticated;

-- Cada factura con lo cobrado. Cancelada: un cobro vigente la cancela; su saldo
-- es cero aunque lo cobrado no llegue al total (detracción, retención).
create or replace view public.v_facturas_venta with (security_invoker = true) as
select f.id, f.codigo_interno, f.cotizacion_pdf_id, f.cotizacion_numero, f.cliente_id, f.cliente, f.numero,
       f.fecha_emision, f.fecha_vencimiento, f.moneda, f.total, f.concepto, f.ruta_storage, f.nombre_archivo,
       f.registrado_por, public.puesto_de(f.registrado_por) as registrado_por_puesto, f.creado_en,
       f.anulada_en, f.motivo_anulacion,
       coalesce(sum(b.monto) filter (where b.anulado_en is null), 0)::numeric(14, 2) as cobrado,
       coalesce(bool_or(b.cancela) filter (where b.anulado_en is null), false) as cancelada,
       case when f.anulada_en is not null or coalesce(bool_or(b.cancela) filter (where b.anulado_en is null), false) then 0
            else greatest(f.total - coalesce(sum(b.monto) filter (where b.anulado_en is null), 0), 0)
       end::numeric(14, 2) as saldo,
       max(b.fecha) filter (where b.anulado_en is null) as ultimo_cobro
  from public.facturas_venta f
  left join public.cobros_factura_venta b on b.factura_id = f.id
 group by f.id;
revoke all on public.v_facturas_venta from public, anon, authenticated;
grant select on public.v_facturas_venta to authenticated;

-- La cotización aprobada la ven también Contabilidad y Tesorería (y su archivo).
-- Se agrega una condición a las políticas que ya había; lo demás queda igual.
alter policy ver_cotizaciones_pdf on public.cotizaciones_pdf using (
  public.es_admin() or public.tiene_permiso('cotizaciones.ver_pdf_comercial')
  or (public.tiene_permiso('tesoreria.ver_documentos')
      and exists (select 1 from public.cotizaciones_pdf_liberaciones_tesoreria l where l.cotizacion_pdf_id = cotizaciones_pdf.id))
  or (public.tiene_permiso('cotizaciones.ver_aprobadas') and public.cotizacion_fue_aprobada(cotizaciones_pdf.id)));
alter policy alcance_cotizacion_pdf_comercial_tesoreria on public.cotizaciones_pdf using (
  public.es_admin() or public.tiene_permiso('cotizaciones.ver_pdf_comercial')
  or (public.tiene_permiso('tesoreria.ver_documentos')
      and exists (select 1 from public.cotizaciones_pdf_liberaciones_tesoreria l where l.cotizacion_pdf_id = cotizaciones_pdf.id))
  or (public.tiene_permiso('cotizaciones.ver_aprobadas') and public.cotizacion_fue_aprobada(cotizaciones_pdf.id)));
alter policy ver_cotizaciones_pdf_versiones on public.cotizaciones_pdf_versiones using (
  public.es_admin() or public.tiene_permiso('cotizaciones.ver_pdf_comercial')
  or (public.tiene_permiso('tesoreria.ver_documentos')
      and exists (select 1 from public.cotizaciones_pdf_liberaciones_tesoreria l where l.cotizacion_pdf_id = cotizaciones_pdf_versiones.cotizacion_id))
  or (public.tiene_permiso('cotizaciones.ver_aprobadas') and public.cotizacion_fue_aprobada(cotizaciones_pdf_versiones.cotizacion_id)));
alter policy alcance_versiones_cotizacion_pdf_comercial_tesoreria on public.cotizaciones_pdf_versiones using (
  public.es_admin() or public.tiene_permiso('cotizaciones.ver_pdf_comercial')
  or (public.tiene_permiso('tesoreria.ver_documentos')
      and exists (select 1 from public.cotizaciones_pdf_liberaciones_tesoreria l where l.cotizacion_pdf_id = cotizaciones_pdf_versiones.cotizacion_id))
  or (public.tiene_permiso('cotizaciones.ver_aprobadas') and public.cotizacion_fue_aprobada(cotizaciones_pdf_versiones.cotizacion_id)));

create or replace function public.archivo_de_cotizacion_aprobada(p_nombre text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.tiene_permiso('cotizaciones.ver_aprobadas') and exists (
    select 1 from public.cotizaciones_pdf c
     where c.ruta_storage = p_nombre and public.cotizacion_fue_aprobada(c.id)
    union all
    select 1 from public.cotizaciones_pdf_versiones v
     where v.ruta_storage = p_nombre and public.cotizacion_fue_aprobada(v.cotizacion_id));
$$;
revoke all on function public.archivo_de_cotizacion_aprobada(text) from public, anon;
grant execute on function public.archivo_de_cotizacion_aprobada(text) to authenticated;

alter policy mw_leer_cotizaciones_pdf on storage.objects using (
  bucket_id = 'cotizaciones-pdf'
  and (public.es_admin() or public.tiene_permiso('cotizaciones.ver_pdf_comercial')
       or (public.tiene_permiso('tesoreria.ver_documentos')
           and exists (select 1 from public.cotizaciones_pdf c
                         join public.cotizaciones_pdf_liberaciones_tesoreria l on l.cotizacion_pdf_id = c.id
                        where c.ruta_storage = objects.name))
       or (public.tiene_permiso('tesoreria.ver_documentos')
           and exists (select 1 from public.cotizaciones_pdf_versiones v
                         join public.cotizaciones_pdf_liberaciones_tesoreria l on l.cotizacion_pdf_id = v.cotizacion_id
                        where v.ruta_storage = objects.name))
       or public.archivo_de_cotizacion_aprobada(objects.name)));

-- 7. Los archivos en Storage ----------------------------------------------------------
-- Privados, hasta 10 MB. La factura, en PDF, en `facturas-venta/{factura}/…`: la
-- sube Contabilidad. El voucher del cobro, PDF o foto, en
-- `cobros-venta/{factura}/…`: lo sube Tesorería. Cada archivo lo ven quien lo
-- subió y quien ve la fila que lo nombra (la política de la tabla decide); uno
-- suelto, subido y no registrado, lo retira su dueño.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('facturas-venta', 'facturas-venta', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cobros-venta', 'cobros-venta', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'facturas_venta_subir') then
    create policy facturas_venta_subir on storage.objects for insert to authenticated with check (
      bucket_id = 'facturas-venta' and owner_id = (select auth.uid())::text
      and (select public.tiene_permiso('contabilidad.facturar') or public.es_admin()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'facturas_venta_ver') then
    create policy facturas_venta_ver on storage.objects for select to authenticated using (
      bucket_id = 'facturas-venta'
      and (owner_id = (select auth.uid())::text
           or exists (select 1 from public.facturas_venta f where f.ruta_storage = objects.name)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'facturas_venta_quitar_suelto') then
    create policy facturas_venta_quitar_suelto on storage.objects for delete to authenticated using (
      bucket_id = 'facturas-venta' and owner_id = (select auth.uid())::text
      and not exists (select 1 from public.facturas_venta f where f.ruta_storage = objects.name));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'cobros_venta_subir') then
    create policy cobros_venta_subir on storage.objects for insert to authenticated with check (
      bucket_id = 'cobros-venta' and owner_id = (select auth.uid())::text
      and (select public.tiene_permiso('tesoreria.registrar_cobros') or public.es_admin()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'cobros_venta_ver') then
    create policy cobros_venta_ver on storage.objects for select to authenticated using (
      bucket_id = 'cobros-venta'
      and (owner_id = (select auth.uid())::text
           or exists (select 1 from public.cobros_factura_venta b where b.archivo_ruta = objects.name)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'cobros_venta_quitar_suelto') then
    create policy cobros_venta_quitar_suelto on storage.objects for delete to authenticated using (
      bucket_id = 'cobros-venta' and owner_id = (select auth.uid())::text
      and not exists (select 1 from public.cobros_factura_venta b where b.archivo_ruta = objects.name));
  end if;
end $$;

-- 8. Lo que Contabilidad tiene por facturar --------------------------------------------
-- Cada cotización aprobada y vigente, con lo que hace falta para facturarla: el
-- código interno (nulo mientras Administración no cargue la OT), el cliente con
-- su documento y su dirección fiscal, el total de venta, si incluye IGV, el
-- archivo aprobado y lo ya facturado y cobrado.
create or replace function public.cotizaciones_para_facturar()
returns table (
  cotizacion_id uuid, numero text, codigo_interno text, cliente_id uuid, cliente text, cliente_documento text,
  cliente_direccion text, carroceria text, moneda text, monto_venta numeric, incluye_igv boolean,
  en_correccion boolean, aprobada_en timestamptz, archivo_ruta text, archivo_mime text, archivo_nombre text,
  facturas integer, facturado numeric, cobrado numeric
) language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not (public.es_admin() or public.tiene_permiso('contabilidad.facturar') or public.tiene_permiso('cotizaciones.ver_aprobadas')) then
    raise exception 'Las cotizaciones aprobadas las ven Administración, Gerencia, Contabilidad y Tesorería.' using errcode = 'insufficient_privilege';
  end if;
  return query
    select c.id, c.numero, public.codigo_interno_de_cotizacion(c.id), c.cliente_id, cl.razon_social,
           case when cl.id is null then null else cl.tipo_documento::text || ' ' || cl.numero_documento end,
           nullif(concat_ws(', ', nullif(btrim(cl.direccion_fiscal), ''), nullif(btrim(cl.distrito), ''),
                            nullif(btrim(cl.provincia), ''), nullif(btrim(cl.departamento), '')), ''),
           tc.nombre, c.moneda::text, c.monto_venta::numeric, ig.incluye_igv,
           c.estado::text <> 'APROBADA', c.revisado_en,
           coalesce(case when c.estado::text = 'APROBADA' then c.ruta_storage end, va.ruta_storage),
           coalesce(case when c.estado::text = 'APROBADA' then c.mime_type end, va.mime_type),
           coalesce(case when c.estado::text = 'APROBADA' then c.nombre_archivo end, va.nombre_archivo),
           coalesce(fx.facturas, 0), coalesce(fx.facturado, 0), coalesce(fx.cobrado, 0)
      from public.cotizaciones_pdf c
      left join public.clientes cl on cl.id = c.cliente_id
      left join public.tipos_carroceria tc on tc.id = c.tipo_carroceria_id
      left join public.cotizaciones_pdf_igv ig on ig.cotizacion_id = c.id
      left join lateral (
        select v.ruta_storage, v.mime_type, v.nombre_archivo from public.cotizaciones_pdf_versiones v
         where v.cotizacion_id = c.id and v.estado_al_archivar = 'APROBADA'
         order by v.version desc limit 1) va on true
      left join lateral (
        select count(*)::integer as facturas, sum(f.total)::numeric as facturado,
               sum((select coalesce(sum(b.monto), 0) from public.cobros_factura_venta b
                     where b.factura_id = f.id and b.anulado_en is null))::numeric as cobrado
          from public.facturas_venta f
         where f.cotizacion_pdf_id = c.id and f.anulada_en is null) fx on true
     where c.estado::text <> 'ANULADA' and public.cotizacion_fue_aprobada(c.id)
     order by c.revisado_en desc nulls last
     limit 300;
end;
$$;
revoke all on function public.cotizaciones_para_facturar() from public, anon;
grant execute on function public.cotizaciones_para_facturar() to authenticated;

-- E001-00000626 → E001-626. Nulo si no tiene la forma de un número de SUNAT.
create or replace function public.normalizar_numero_factura(p_numero text)
returns text language sql immutable set search_path to 'public' as $$
  select case
    when m is null then null
    else m[1] || '-' || (m[2]::bigint)::text
  end
  from (select regexp_match(upper(regexp_replace(coalesce(p_numero, ''), '\s', '', 'g')),
                            '^([A-Z][A-Z0-9]{3})-0*([1-9][0-9]{0,7})$') as m) x;
$$;
revoke all on function public.normalizar_numero_factura(text) from public, anon;
grant execute on function public.normalizar_numero_factura(text) to authenticated;

-- 9. Contabilidad registra la factura ---------------------------------------------------
-- El PDF ya está en Storage (`{p_id}/{archivo}.pdf`). El id llega de la pantalla:
-- un reintento no registra otra. Entra sola a cuentas por cobrar.
create or replace function public.registrar_factura_venta(
  p_id uuid, p_cotizacion uuid, p_numero text, p_fecha_emision date, p_fecha_vencimiento date,
  p_moneda text, p_total numeric, p_concepto text, p_ruta text, p_nombre_archivo text
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo       uuid := public.usuario_actual();
  v_hoy      date := (now() at time zone 'America/Lima')::date;
  v_cot      public.cotizaciones_pdf%rowtype;
  v_codigo   text;
  v_numero   text := public.normalizar_numero_factura(p_numero);
  v_obj      storage.objects%rowtype;
  v_cli      text;
  v_otra     text;
  v_concepto text := nullif(btrim(coalesce(p_concepto, '')), '');
begin
  perform public.exigir_permiso('contabilidad.facturar');
  if p_id is null then raise exception 'Vuelve a abrir el formulario de la factura.' using errcode = 'check_violation'; end if;
  if exists (select 1 from public.facturas_venta where id = p_id) then return p_id; end if;
  select * into v_cot from public.cotizaciones_pdf where id = p_cotizacion for share;
  if not found then raise exception 'Esa cotización no existe.' using errcode = 'check_violation'; end if;
  if v_cot.estado::text = 'ANULADA' or not public.cotizacion_fue_aprobada(p_cotizacion) then
    raise exception 'La cotización % no está aprobada por Gerencia: no se factura.', v_cot.numero using errcode = 'check_violation';
  end if;
  v_codigo := public.codigo_interno_de_cotizacion(p_cotizacion);
  if v_codigo is null then
    raise exception 'La cotización % todavía no tiene código interno: lo pone Administración al cargar la OT.', v_cot.numero
      using errcode = 'check_violation';
  end if;
  if v_numero is null then
    raise exception 'Escribe el número de la factura como sale en SUNAT: la serie, un guion y el número (E001-626).' using errcode = 'check_violation';
  end if;
  select codigo_interno into v_otra from public.facturas_venta where numero = v_numero and anulada_en is null;
  if found then
    raise exception 'La factura % ya está registrada en el código %.', v_numero, v_otra using errcode = 'unique_violation';
  end if;
  if p_fecha_emision is null or p_fecha_emision > v_hoy or p_fecha_emision < v_hoy - 730 then
    raise exception 'Elige la fecha de emisión de la factura: de hoy hacia atrás.' using errcode = 'check_violation';
  end if;
  if p_fecha_vencimiento is null or p_fecha_vencimiento < p_fecha_emision or p_fecha_vencimiento > p_fecha_emision + 730 then
    raise exception 'El vencimiento va desde la fecha de emisión hasta dos años después.' using errcode = 'check_violation';
  end if;
  if p_moneda is null or p_moneda not in ('PEN', 'USD') then
    raise exception 'Elige la moneda de la factura: soles o dólares.' using errcode = 'check_violation';
  end if;
  if p_total is null or p_total <= 0 or p_total > 999999999 or p_total <> round(p_total, 2) then
    raise exception 'Escribe el total de la factura, con IGV, en dos decimales.' using errcode = 'check_violation';
  end if;
  if v_concepto is not null and char_length(v_concepto) not between 2 and 200 then
    raise exception 'El concepto va de 2 a 200 caracteres (por ejemplo, «Inicial 50 %%»).' using errcode = 'check_violation';
  end if;
  v_obj := public.archivo_subido_por_mi('facturas-venta', p_ruta, p_id, array['application/pdf']);

  select razon_social into v_cli from public.clientes where id = v_cot.cliente_id;
  insert into public.facturas_venta (id, codigo_interno, cotizacion_pdf_id, cotizacion_numero, cliente_id, cliente, numero,
                                     fecha_emision, fecha_vencimiento, moneda, total, concepto, ruta_storage,
                                     nombre_archivo, tamano_bytes, registrado_por)
  values (p_id, v_codigo, p_cotizacion, v_cot.numero, v_cot.cliente_id, coalesce(v_cli, 'Cliente sin registrar'), v_numero,
          p_fecha_emision, p_fecha_vencimiento, p_moneda, p_total, v_concepto, p_ruta,
          left(coalesce(nullif(btrim(p_nombre_archivo), ''), v_numero || '.pdf'), 200),
          (v_obj.metadata->>'size')::integer, v_yo);

  perform public.notificar_a_permiso('tesoreria.registrar_cobros', 'Factura por cobrar: ' || v_numero,
    coalesce(v_cli, 'Cliente sin registrar') || ' · código ' || v_codigo || ' · '
      || case when p_moneda = 'USD' then 'US$ ' else 'S/ ' end || to_char(p_total, 'FM999G999G990D00'),
    '/tesoreria/por-cobrar#' || p_id, 'facturas_venta', p_id, v_yo);
  return p_id;
end;
$$;
revoke all on function public.registrar_factura_venta(uuid, uuid, text, date, date, text, numeric, text, text, text) from public, anon;
grant execute on function public.registrar_factura_venta(uuid, uuid, text, date, date, text, numeric, text, text, text) to authenticated;

-- Una factura mal registrada o anulada en SUNAT se anula aquí, mientras
-- Tesorería no tenga un cobro vigente de ella. Su número queda libre.
create or replace function public.anular_factura_venta(p_factura uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo  uuid := public.usuario_actual();
  v_fac public.facturas_venta%rowtype;
begin
  perform public.exigir_permiso('contabilidad.facturar');
  if char_length(btrim(coalesce(p_motivo, ''))) not between 10 and 500 then
    raise exception 'Cuenta por qué se anula, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_fac from public.facturas_venta where id = p_factura for update;
  if not found then raise exception 'Esa factura no existe.' using errcode = 'check_violation'; end if;
  if v_fac.anulada_en is not null then return p_factura; end if;
  if exists (select 1 from public.cobros_factura_venta where factura_id = p_factura and anulado_en is null) then
    raise exception 'Tesorería ya registró cobros de la factura %: para anularla, primero Tesorería anula esos cobros.', v_fac.numero
      using errcode = 'check_violation';
  end if;
  update public.facturas_venta
     set anulada_por = v_yo, anulada_en = now(), motivo_anulacion = btrim(p_motivo)
   where id = p_factura;
  perform public.notificar_a_permiso('tesoreria.registrar_cobros', 'Factura anulada: ' || v_fac.numero,
    'Contabilidad la anuló: ' || left(btrim(p_motivo), 200), '/tesoreria/por-cobrar', 'facturas_venta', p_factura, v_yo);
  return p_factura;
end;
$$;
revoke all on function public.anular_factura_venta(uuid, text) from public, anon;
grant execute on function public.anular_factura_venta(uuid, text) to authenticated;

-- 10. Tesorería registra el cobro con su voucher ------------------------------------------
create or replace function public.registrar_cobro_factura(
  p_id uuid, p_factura uuid, p_fecha date, p_monto numeric, p_cancela boolean, p_operacion text, p_ruta text
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo      uuid := public.usuario_actual();
  v_hoy     date := (now() at time zone 'America/Lima')::date;
  v_fac     public.facturas_venta%rowtype;
  v_cobrado numeric;
  v_cancela boolean;
  v_obj     storage.objects%rowtype;
  v_op      text := nullif(btrim(coalesce(p_operacion, '')), '');
  v_mon     text;
begin
  perform public.exigir_permiso('tesoreria.registrar_cobros');
  if p_id is null then raise exception 'Vuelve a abrir el formulario del cobro.' using errcode = 'check_violation'; end if;
  if exists (select 1 from public.cobros_factura_venta where id = p_id) then return p_id; end if;
  select * into v_fac from public.facturas_venta where id = p_factura for update;
  if not found then raise exception 'Esa factura no existe.' using errcode = 'check_violation'; end if;
  if v_fac.anulada_en is not null then
    raise exception 'La factura % está anulada: no se cobra.', v_fac.numero using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.cobros_factura_venta where factura_id = p_factura and anulado_en is null and cancela) then
    raise exception 'La factura % ya está cobrada.', v_fac.numero using errcode = 'check_violation';
  end if;
  if p_fecha is null or p_fecha > v_hoy or p_fecha < v_hoy - 365 then
    raise exception 'Elige el día del cobro: de hoy hacia atrás.' using errcode = 'check_violation';
  end if;
  if p_monto is null or p_monto <= 0 or p_monto > 999999999 or p_monto <> round(p_monto, 2) then
    raise exception 'Escribe lo que se cobró, en dos decimales.' using errcode = 'check_violation';
  end if;
  select coalesce(sum(monto), 0) into v_cobrado from public.cobros_factura_venta
   where factura_id = p_factura and anulado_en is null;
  v_mon := case when v_fac.moneda = 'USD' then 'US$ ' else 'S/ ' end;
  if v_cobrado + p_monto > v_fac.total then
    raise exception 'Con ese cobro la factura % pasaría de su total: le quedan % por cobrar.',
      v_fac.numero, v_mon || to_char(v_fac.total - v_cobrado, 'FM999G999G990D00') using errcode = 'check_violation';
  end if;
  if v_op is not null and char_length(v_op) > 60 then
    raise exception 'El número de operación pasa de 60 caracteres.' using errcode = 'check_violation';
  end if;
  v_obj := public.archivo_subido_por_mi('cobros-venta', p_ruta, p_factura,
                                        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
  v_cancela := coalesce(p_cancela, false) or v_cobrado + p_monto >= v_fac.total;

  insert into public.cobros_factura_venta (id, factura_id, fecha, moneda, monto, cancela, operacion,
                                           archivo_ruta, archivo_mime, archivo_tamano, registrado_por)
  values (p_id, p_factura, p_fecha, v_fac.moneda, p_monto, v_cancela, v_op, p_ruta,
          v_obj.metadata->>'mimetype', (v_obj.metadata->>'size')::integer, v_yo);

  perform public.notificar_a_permiso('contabilidad.facturar',
    case when v_cancela then 'Factura cobrada: ' else 'Cobro a cuenta: ' end || v_fac.numero,
    v_fac.cliente || ' · código ' || v_fac.codigo_interno || ' · ' || v_mon || to_char(p_monto, 'FM999G999G990D00'),
    '/contabilidad/facturacion#' || p_factura, 'cobros_factura_venta', p_id, v_yo);
  return p_id;
end;
$$;
revoke all on function public.registrar_cobro_factura(uuid, uuid, date, numeric, boolean, text, text) from public, anon;
grant execute on function public.registrar_cobro_factura(uuid, uuid, date, numeric, boolean, text, text) to authenticated;

create or replace function public.anular_cobro_factura(p_id uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_cobro public.cobros_factura_venta%rowtype;
begin
  perform public.exigir_permiso('tesoreria.registrar_cobros');
  if char_length(btrim(coalesce(p_motivo, ''))) not between 10 and 500 then
    raise exception 'Cuenta por qué se anula, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_cobro from public.cobros_factura_venta where id = p_id for update;
  if not found then raise exception 'Ese cobro no existe.' using errcode = 'check_violation'; end if;
  if v_cobro.anulado_en is not null then return p_id; end if;
  update public.cobros_factura_venta
     set anulado_por = public.usuario_actual(), anulado_en = now(), motivo_anulacion = btrim(p_motivo)
   where id = p_id;
  return p_id;
end;
$$;
revoke all on function public.anular_cobro_factura(uuid, text) from public, anon;
grant execute on function public.anular_cobro_factura(uuid, text) to authenticated;

-- 11. Lo que espera, para el tablero ---------------------------------------------------
-- A Contabilidad, las cotizaciones aprobadas con código interno y sin factura
-- vigente; a Tesorería, las facturas vigentes sin cancelar. A quien no le toca, nulo.
create or replace function public.facturacion_pendientes()
returns table (por_facturar integer, por_cobrar integer)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  return query select
    case when public.es_admin() or public.tiene_permiso('contabilidad.facturar') then
      (select count(*)::integer from public.cotizaciones_pdf c
        where c.estado::text <> 'ANULADA' and public.cotizacion_fue_aprobada(c.id)
          and public.codigo_interno_de_cotizacion(c.id) is not null
          and not exists (select 1 from public.facturas_venta f where f.cotizacion_pdf_id = c.id and f.anulada_en is null))
    end,
    case when public.es_admin() or public.tiene_permiso('tesoreria.registrar_cobros') then
      (select count(*)::integer from public.facturas_venta f
        where f.anulada_en is null
          and not exists (select 1 from public.cobros_factura_venta b
                           where b.factura_id = f.id and b.anulado_en is null and b.cancela))
    end;
end;
$$;
revoke all on function public.facturacion_pendientes() from public, anon;
grant execute on function public.facturacion_pendientes() to authenticated;
