-- =============================================================================
-- LA OT PASA POR CONTABILIDAD, Y TESORERÍA ORDENA LO QUE COBRA Y LO QUE PAGA
-- -----------------------------------------------------------------------------
-- Gerencia lo pidió el 2026-10-14: «al realizar la OT primero pasa por
-- Contabilidad». Hasta hoy Administración «liberaba a Tesorería» la cotización
-- aprobada y Tesorería anotaba a mano la factura de cada OT. El procedimiento
-- de cuentas por cobrar de la casa (MW-PR-DA-02) dice otra cosa: Administración
-- emite la OT, CONTABILIDAD FACTURA cada inicial o pago, y Tesorería cobra.
-- Desde aquí el camino es:
--
--   Cotización aprobada → OT → Administración ENVÍA LA COTIZACIÓN A CONTABILIDAD
--   → Contabilidad emite la factura (en SUNAT, fuera del sistema) y la ANEXA:
--     número, fechas, moneda, total y el PDF → la ENVÍA A TESORERÍA
--   → entra a las CUENTAS POR COBRAR de Tesorería, que registra los cobros.
--
-- Una cotización puede llevar varias facturas (la inicial y el saldo, o una
-- por unidad). La factura no se borra: se anula con motivo mientras Tesorería
-- no haya cobrado nada de ella, y su número queda libre para registrarla bien.
-- Tesorería ya no anota facturas a mano: le llegan de Contabilidad.
--
-- En el mismo pedido, Tesorería ordena su trabajo en cuatro: ADQUISICIONES
-- (todo lo comprado, por factura), CUENTAS POR COBRAR, CUENTAS POR PAGAR y PAGOS
-- DE SERVICIO. Lo último es nuevo: la orden de servicio que Logística emite y
-- Gerencia aprueba (arenado, torno, pintura…) la paga Tesorería contra la
-- factura del proveedor, con su comprobante. Y Contabilidad ve el kardex en
-- lectura: los ingresos con su guía, las atenciones y los egresos.
--
-- Las tablas nuevas se escriben solo por las funciones de abajo. Sin DROP: el
-- conector de producción no deja pasar ninguno, ni dentro de un bloque. La
-- restricción vieja de las cuentas por cobrar se suelta en la 20261015121000.
-- =============================================================================

-- 1. Permisos ---------------------------------------------------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('cotizaciones.enviar_contabilidad', 'Administración',
   'Enviar a Contabilidad la cotización aprobada que ya tiene su OT, para que la facture'),
  ('contabilidad.facturar', 'Contabilidad',
   'Anexar la factura de venta de una cotización, enviarla a Tesorería y anularla'),
  ('tesoreria.pagar_servicios', 'Tesorería',
   'Registrar el pago de una orden de servicio con su comprobante')
on conflict (codigo) do nothing;

-- Contabilidad factura (necesita el RUC y la dirección fiscal del cliente) y
-- consulta el kardex; Tesorería paga los servicios.
insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, p.codigo from public.roles r cross join public.permisos p
 where (r.codigo = 'ADMINISTRACION' and p.codigo = 'cotizaciones.enviar_contabilidad')
    or (r.codigo = 'CONTABILIDAD' and p.codigo in ('contabilidad.facturar', 'clientes.ver', 'almacen.ver'))
    or (r.codigo = 'TESORERIA' and p.codigo = 'tesoreria.pagar_servicios')
on conflict do nothing;

update public.permisos set descripcion = 'Liberar a Tesorería una cotización PDF ya aprobada (circuito anterior; hoy va a Contabilidad)'
 where codigo = 'cotizaciones.liberar_tesoreria';

-- 2. La cotización que Administración envía a Contabilidad ------------------------
create table if not exists public.cotizaciones_envios_contabilidad (
  id                 uuid primary key default gen_random_uuid(),
  cotizacion_pdf_id  uuid not null references public.cotizaciones_pdf(id) on delete restrict,
  orden_id           uuid not null references public.ordenes_trabajo(id) on delete restrict,
  enviado_por        uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  enviado_en         timestamptz not null default now(),
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now(),
  constraint uq_envio_contabilidad_cotizacion unique (cotizacion_pdf_id)
);
comment on table public.cotizaciones_envios_contabilidad is
  'Constancia de Administración: la cotización aprobada, con su OT, va a Contabilidad para que la facture. Una por cotización; no se borra.';
select public.activar_timestamps('cotizaciones_envios_contabilidad');
select public.activar_auditoria('cotizaciones_envios_contabilidad');
select public.activar_registro_de_prueba('cotizaciones_envios_contabilidad');

-- 3. La factura de venta que anexa Contabilidad ------------------------------------
-- El número es el de SUNAT (E001-626): serie de 4 y correlativo sin ceros a la
-- izquierda, para que E001-00000626 y E001-626 sean la misma. Cliente y número
-- de cotización se copian al anexarla: la factura dice a quién se le emitió.
create table if not exists public.facturas_venta (
  id                 uuid primary key default gen_random_uuid(),
  cotizacion_pdf_id  uuid not null references public.cotizaciones_pdf(id) on delete restrict,
  orden_id           uuid not null references public.ordenes_trabajo(id) on delete restrict,
  cliente_id         uuid references public.clientes(id) on delete restrict,
  cliente            text not null,
  cotizacion_numero  text not null,
  numero             text not null,
  fecha_emision      date not null,
  fecha_vencimiento  date not null,
  moneda             text not null,
  total              numeric(14, 2) not null,
  concepto           text,
  ruta_storage       text not null,
  nombre_archivo     text not null,
  tamano_bytes       integer not null,
  estado             text not null default 'ANEXADA',
  registrado_por     uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  enviada_por        uuid references public.usuarios(id) on delete restrict,
  enviada_en         timestamptz,
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
    and (concepto is null or char_length(btrim(concepto)) between 2 and 200)
    and char_length(btrim(cliente)) between 2 and 200
    and tamano_bytes between 1 and 10485760),
  constraint ck_factura_venta_estado check (
    estado in ('ANEXADA', 'ENVIADA', 'ANULADA')
    and (estado <> 'ENVIADA' or (enviada_por is not null and enviada_en is not null))
    and (estado <> 'ANULADA' or (anulada_por is not null and anulada_en is not null
                                 and char_length(btrim(coalesce(motivo_anulacion, ''))) between 10 and 500)))
);
comment on table public.facturas_venta is
  'La factura de venta que Contabilidad emite por una cotización con OT y envía a Tesorería, donde entra a cuentas por cobrar. No se borra: se anula.';
-- Un número vale una vez, salvo que la factura con ese número se haya anulado.
create unique index if not exists uq_factura_venta_numero_vigente on public.facturas_venta (numero) where estado <> 'ANULADA';
-- (b) Las pantallas de Contabilidad y de la cotización leen las facturas de cada cotización.
create index if not exists ix_facturas_venta_cotizacion on public.facturas_venta (cotizacion_pdf_id);
select public.activar_timestamps('facturas_venta');
select public.activar_auditoria('facturas_venta');
select public.activar_registro_de_prueba('facturas_venta');

-- 4. La cuenta por cobrar nace de la factura -------------------------------------
-- La factura que Contabilidad anula se lleva su cuenta: queda marcada y deja
-- de salir. El número de la factura vale una vez por OT entre las vigentes
-- (el índice de abajo; la 20261015121000 suelta la restricción que lo pedía
-- también entre las anuladas).
alter table public.cuentas_cobrar_ot add column if not exists factura_venta_id uuid references public.facturas_venta(id) on delete restrict;
alter table public.cuentas_cobrar_ot add column if not exists anulada_en timestamptz;
comment on column public.cuentas_cobrar_ot.factura_venta_id is 'La factura de Contabilidad de la que salió esta cuenta (vacío en las que Tesorería anotó a mano antes).';
comment on column public.cuentas_cobrar_ot.anulada_en is 'Cuándo Contabilidad anuló la factura: la cuenta deja de cobrarse.';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'uq_cuenta_cobrar_factura'
                   and conrelid = 'public.cuentas_cobrar_ot'::regclass) then
    alter table public.cuentas_cobrar_ot add constraint uq_cuenta_cobrar_factura unique (factura_venta_id);
  end if;
end $$;
create unique index if not exists uq_cuenta_cobrar_numero_vigente
  on public.cuentas_cobrar_ot (orden_id, numero_documento) where anulada_en is null;

-- Tesorería ya no anota facturas: las cuentas por cobrar las crea
-- `enviar_factura_a_tesoreria`. La lectura y los cobros siguen igual.
revoke insert on public.cuentas_cobrar_ot from authenticated;

-- Un cobro sobre una factura anulada no entra. Disparador propio: el de la
-- validación del saldo (fn_validar_cobro_ot) no se toca.
create or replace function public.fn_cobro_de_cuenta_vigente()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if exists (select 1 from public.cuentas_cobrar_ot where id = new.cuenta_id and anulada_en is not null) then
    raise exception 'Esa factura está anulada: ya no se cobra.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_cobro_de_cuenta_vigente() from public, anon, authenticated;
create or replace trigger trg_cobro_de_cuenta_vigente
  before insert on public.cobros_ot
  for each row execute function public.fn_cobro_de_cuenta_vigente();

-- La vista de Tesorería: las cuentas vigentes, con la factura que las originó.
-- Las columnas nuevas van al final (create or replace view no deja moverlas).
create or replace view public.v_cuentas_cobrar_ot with (security_invoker = true) as
select c.id, c.orden_id, o.numero as numero_ot, c.numero_documento,
       c.fecha_emision, c.fecha_vencimiento, c.moneda, c.total,
       coalesce(sum(b.monto), 0)::numeric(14, 2) as cobrado,
       (c.total - coalesce(sum(b.monto), 0))::numeric(14, 2) as saldo,
       c.factura_venta_id, f.cliente, f.cotizacion_numero, f.concepto,
       f.ruta_storage as factura_ruta, c.creado_en
  from public.cuentas_cobrar_ot c
  join public.ordenes_trabajo o on o.id = c.orden_id
  left join public.facturas_venta f on f.id = c.factura_venta_id
  left join public.cobros_ot b on b.cuenta_id = c.id
 where c.anulada_en is null
 group by c.id, o.numero, f.id;
revoke all on public.v_cuentas_cobrar_ot from public, anon;
grant select on public.v_cuentas_cobrar_ot to authenticated;

-- 5. El pago de una orden de servicio ----------------------------------------------
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

-- 6. Lo que no se borra ni se corrige ---------------------------------------------
create or replace function public.fn_envio_contabilidad_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'El envío a Contabilidad no se borra: queda como constancia.' using errcode = 'check_violation';
  end if;
  if (to_jsonb(new) - 'actualizado_en') is distinct from (to_jsonb(old) - 'actualizado_en') then
    raise exception 'El envío a Contabilidad no se corrige.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_envio_contabilidad_guardia() from public, anon, authenticated;
create or replace trigger trg_envio_contabilidad_guardia
  before update or delete on public.cotizaciones_envios_contabilidad
  for each row execute function public.fn_envio_contabilidad_guardia();

-- De la factura cambian solo el envío y la anulación; anulada, queda congelada.
create or replace function public.fn_factura_venta_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
declare
  v_cambian constant text[] := array['estado', 'enviada_por', 'enviada_en', 'anulada_por', 'anulada_en',
                                     'motivo_anulacion', 'actualizado_en'];
begin
  if tg_op = 'DELETE' then
    raise exception 'Una factura no se borra: se anula con su motivo.' using errcode = 'check_violation';
  end if;
  if old.estado = 'ANULADA' then
    raise exception 'La factura % está anulada: queda como evidencia.', old.numero using errcode = 'check_violation';
  end if;
  if (to_jsonb(new) - v_cambian) is distinct from (to_jsonb(old) - v_cambian) then
    raise exception 'Lo que dice la factura no se corrige: anúlala con su motivo y anéxala de nuevo.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_factura_venta_guardia() from public, anon, authenticated;
create or replace trigger trg_factura_venta_guardia
  before update or delete on public.facturas_venta
  for each row execute function public.fn_factura_venta_guardia();

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

-- 7. Quién ve qué ---------------------------------------------------------------------
-- El envío lo ven quienes ven la cotización (Ventas, Gerencia, Administración),
-- Contabilidad y Tesorería. La factura, Contabilidad siempre; Tesorería, Gerencia
-- y Administración, desde que se envía a Tesorería. Los pagos de servicio,
-- Tesorería, Gerencia y Logística (que emitió la orden).
alter table public.cotizaciones_envios_contabilidad enable row level security;
alter table public.facturas_venta enable row level security;
alter table public.pagos_orden_servicio enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cotizaciones_envios_contabilidad' and policyname = 'ver_envios_contabilidad') then
    create policy ver_envios_contabilidad on public.cotizaciones_envios_contabilidad for select to authenticated
      using ((select public.es_admin()) or (select public.tiene_permiso('contabilidad.facturar'))
             or (select public.tiene_permiso('cotizaciones.ver_pdf_comercial'))
             or (select public.tiene_permiso('tesoreria.ver_documentos')));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'facturas_venta' and policyname = 'ver_facturas_venta') then
    create policy ver_facturas_venta on public.facturas_venta for select to authenticated
      using ((select public.es_admin()) or (select public.tiene_permiso('contabilidad.facturar'))
             or (enviada_en is not null and ((select public.tiene_permiso('tesoreria.ver_documentos'))
                                             or (select public.tiene_permiso('cotizaciones.enviar_contabilidad')))));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'pagos_orden_servicio' and policyname = 'ver_pagos_orden_servicio') then
    create policy ver_pagos_orden_servicio on public.pagos_orden_servicio for select to authenticated
      using ((select public.es_admin()) or (select public.tiene_permiso('tesoreria.pagar_servicios'))
             or (select public.tiene_permiso('tesoreria.ver_documentos'))
             or (select public.tiene_permiso('compras.crear')));
  end if;
end $$;
revoke all on public.cotizaciones_envios_contabilidad from public, anon, authenticated;
revoke all on public.facturas_venta from public, anon, authenticated;
revoke all on public.pagos_orden_servicio from public, anon, authenticated;
grant select on public.cotizaciones_envios_contabilidad to authenticated;
grant select on public.facturas_venta to authenticated;
grant select on public.pagos_orden_servicio to authenticated;

-- El archivo de la cotización: Contabilidad lo abre desde que se la envían
-- (la versión aprobada y las demás de esa cotización), igual que Tesorería
-- abría las que se le liberaban antes. La política del bucket llama a esta.
create or replace function public.archivo_de_cotizacion_para_finanzas(p_nombre text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select (public.tiene_permiso('tesoreria.ver_documentos') and exists (
            select 1 from public.cotizaciones_pdf_liberaciones_tesoreria l
              join public.cotizaciones_pdf c on c.id = l.cotizacion_pdf_id
             where c.ruta_storage = p_nombre
            union all
            select 1 from public.cotizaciones_pdf_liberaciones_tesoreria l
              join public.cotizaciones_pdf_versiones v on v.cotizacion_id = l.cotizacion_pdf_id
             where v.ruta_storage = p_nombre))
      or (public.tiene_permiso('contabilidad.facturar') and exists (
            select 1 from public.cotizaciones_envios_contabilidad e
              join public.cotizaciones_pdf c on c.id = e.cotizacion_pdf_id
             where c.ruta_storage = p_nombre
            union all
            select 1 from public.cotizaciones_envios_contabilidad e
              join public.cotizaciones_pdf_versiones v on v.cotizacion_id = e.cotizacion_pdf_id
             where v.ruta_storage = p_nombre));
$$;
revoke all on function public.archivo_de_cotizacion_para_finanzas(text) from public, anon;
grant execute on function public.archivo_de_cotizacion_para_finanzas(text) to authenticated;

alter policy mw_leer_cotizaciones_pdf on storage.objects using (
  bucket_id = 'cotizaciones-pdf'
  and (public.es_admin()
       or public.tiene_permiso('cotizaciones.ver_pdf_comercial')
       or public.archivo_de_cotizacion_para_finanzas(objects.name)));

-- 8. Los archivos en Storage ----------------------------------------------------------
-- Privados, hasta 10 MB. La factura, en PDF, en `facturas-venta/{factura}/…`: la
-- sube Contabilidad. El comprobante del pago de un servicio, PDF o foto, en
-- `pagos-servicio/{orden de servicio}/…`: lo sube Tesorería. Cada archivo lo ven
-- quien lo subió y quien ve la fila que lo nombra (la política de la tabla
-- decide); uno suelto, subido y no registrado, lo retira su dueño.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('facturas-venta', 'facturas-venta', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pagos-servicio', 'pagos-servicio', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
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
-- tipo y tamaño que se aceptan. La llaman solo las funciones de abajo.
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

-- 9. Administración envía la cotización a Contabilidad --------------------------------
-- La cotización tiene que estar aprobada (o tener una versión aprobada, si después
-- se corrigió) y tener su OT vigente. Un segundo toque no envía otra.
create or replace function public.enviar_cotizacion_a_contabilidad(p_cotizacion uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo   uuid := public.usuario_actual();
  v_cot  public.cotizaciones_pdf%rowtype;
  v_ot   public.ordenes_trabajo%rowtype;
  v_id   uuid;
  v_cli  text;
begin
  perform public.exigir_permiso('cotizaciones.enviar_contabilidad');
  select * into v_cot from public.cotizaciones_pdf where id = p_cotizacion for update;
  if not found then raise exception 'Esa cotización no existe.' using errcode = 'check_violation'; end if;
  select id into v_id from public.cotizaciones_envios_contabilidad where cotizacion_pdf_id = p_cotizacion;
  if v_id is not null then return v_id; end if;
  if not (v_cot.estado::text = 'APROBADA'
          or exists (select 1 from public.cotizaciones_pdf_versiones v
                      where v.cotizacion_id = p_cotizacion and v.estado_al_archivar = 'APROBADA')) then
    raise exception 'La cotización % todavía no está aprobada por Gerencia.', v_cot.numero using errcode = 'check_violation';
  end if;
  select * into v_ot from public.ordenes_trabajo
   where cotizacion_pdf_id = p_cotizacion and estado <> 'ANULADA' limit 1;
  if not found then
    raise exception 'Primero emite la OT de la cotización %: Contabilidad factura sobre la OT.', v_cot.numero using errcode = 'check_violation';
  end if;

  insert into public.cotizaciones_envios_contabilidad (cotizacion_pdf_id, orden_id, enviado_por)
  values (p_cotizacion, v_ot.id, v_yo)
  returning id into v_id;

  select razon_social into v_cli from public.clientes where id = v_cot.cliente_id;
  perform public.notificar_a_permiso('contabilidad.facturar', 'Cotización por facturar: ' || v_cot.numero,
    coalesce(v_cli, 'Cliente') || ' · OT ' || v_ot.numero, '/contabilidad/facturacion#' || p_cotizacion,
    'cotizaciones_envios_contabilidad', v_id, v_yo);
  return v_id;
end;
$$;
revoke all on function public.enviar_cotizacion_a_contabilidad(uuid) from public, anon;
grant execute on function public.enviar_cotizacion_a_contabilidad(uuid) to authenticated;

-- 10. Lo que Contabilidad tiene por facturar ------------------------------------------
-- Cada cotización enviada, con lo que hace falta para facturarla: el cliente
-- con su documento y su dirección fiscal, la OT, el total de venta y el
-- archivo aprobado (si después llegó una corrección sin aprobar, el anterior).
create or replace function public.facturacion_bandeja()
returns table (
  envio_id uuid, cotizacion_id uuid, numero text, cliente_id uuid, cliente text, cliente_documento text,
  cliente_direccion text, carroceria text, monto_venta numeric, moneda text, orden_id uuid, orden_numero text,
  enviado_en timestamptz, enviado_por text, archivo_ruta text, archivo_mime text, archivo_nombre text
) language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not (public.es_admin() or public.tiene_permiso('contabilidad.facturar')) then
    raise exception 'La facturación la lleva Contabilidad.' using errcode = 'insufficient_privilege';
  end if;
  return query
    select e.id, c.id, c.numero, c.cliente_id, cl.razon_social,
           case when cl.id is null then null else cl.tipo_documento::text || ' ' || cl.numero_documento end,
           nullif(concat_ws(', ', nullif(btrim(cl.direccion_fiscal), ''), nullif(btrim(cl.distrito), ''),
                            nullif(btrim(cl.provincia), ''), nullif(btrim(cl.departamento), '')), ''),
           tc.nombre, c.monto_venta::numeric, c.moneda::text, o.id, o.numero, e.enviado_en, public.puesto_de(e.enviado_por),
           coalesce(case when c.estado::text = 'APROBADA' then c.ruta_storage end, va.ruta_storage),
           coalesce(case when c.estado::text = 'APROBADA' then c.mime_type end, va.mime_type),
           coalesce(case when c.estado::text = 'APROBADA' then c.nombre_archivo end, va.nombre_archivo)
      from public.cotizaciones_envios_contabilidad e
      join public.cotizaciones_pdf c on c.id = e.cotizacion_pdf_id
      join public.ordenes_trabajo o on o.id = e.orden_id
      left join public.clientes cl on cl.id = c.cliente_id
      left join public.tipos_carroceria tc on tc.id = c.tipo_carroceria_id
      left join lateral (
        select v.ruta_storage, v.mime_type, v.nombre_archivo from public.cotizaciones_pdf_versiones v
         where v.cotizacion_id = c.id and v.estado_al_archivar = 'APROBADA'
         order by v.version desc limit 1) va on true
     order by e.enviado_en desc
     limit 300;
end;
$$;
revoke all on function public.facturacion_bandeja() from public, anon;
grant execute on function public.facturacion_bandeja() to authenticated;

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

-- 11. Contabilidad anexa la factura ---------------------------------------------------
-- El PDF ya está en Storage (`{p_id}/{archivo}.pdf`). El id llega de la pantalla:
-- un reintento no anexa otra.
create or replace function public.anexar_factura_venta(
  p_id uuid, p_cotizacion uuid, p_numero text, p_fecha_emision date, p_fecha_vencimiento date,
  p_moneda text, p_total numeric, p_concepto text, p_ruta text, p_nombre_archivo text
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo      uuid := public.usuario_actual();
  v_hoy     date := (now() at time zone 'America/Lima')::date;
  v_envio   public.cotizaciones_envios_contabilidad%rowtype;
  v_cot     public.cotizaciones_pdf%rowtype;
  v_numero  text := public.normalizar_numero_factura(p_numero);
  v_obj     storage.objects%rowtype;
  v_cli     text;
  v_otra    text;
  v_concepto text := nullif(btrim(coalesce(p_concepto, '')), '');
begin
  perform public.exigir_permiso('contabilidad.facturar');
  if p_id is null then raise exception 'Vuelve a abrir el formulario de la factura.' using errcode = 'check_violation'; end if;
  if exists (select 1 from public.facturas_venta where id = p_id) then return p_id; end if;
  select * into v_envio from public.cotizaciones_envios_contabilidad where cotizacion_pdf_id = p_cotizacion;
  if not found then
    raise exception 'Esa cotización no se envió a Contabilidad: Administración la envía cuando emite la OT.' using errcode = 'check_violation';
  end if;
  select * into v_cot from public.cotizaciones_pdf where id = p_cotizacion;
  if v_numero is null then
    raise exception 'Escribe el número de la factura como sale en SUNAT: la serie, un guion y el número (E001-626).' using errcode = 'check_violation';
  end if;
  select cotizacion_numero into v_otra from public.facturas_venta where numero = v_numero and estado <> 'ANULADA';
  if found then
    raise exception 'La factura % ya está anexada a la cotización %.', v_numero, v_otra using errcode = 'unique_violation';
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
  insert into public.facturas_venta (id, cotizacion_pdf_id, orden_id, cliente_id, cliente, cotizacion_numero, numero,
                                     fecha_emision, fecha_vencimiento, moneda, total, concepto, ruta_storage,
                                     nombre_archivo, tamano_bytes, registrado_por)
  values (p_id, p_cotizacion, v_envio.orden_id, v_cot.cliente_id, coalesce(v_cli, 'Cliente sin registrar'), v_cot.numero,
          v_numero, p_fecha_emision, p_fecha_vencimiento, p_moneda, p_total, v_concepto, p_ruta,
          left(coalesce(nullif(btrim(p_nombre_archivo), ''), v_numero || '.pdf'), 200),
          (v_obj.metadata->>'size')::integer, v_yo);
  return p_id;
end;
$$;
revoke all on function public.anexar_factura_venta(uuid, uuid, text, date, date, text, numeric, text, text, text) from public, anon;
grant execute on function public.anexar_factura_venta(uuid, uuid, text, date, date, text, numeric, text, text, text) to authenticated;

-- 12. Contabilidad la envía a Tesorería: nace la cuenta por cobrar ---------------------
create or replace function public.enviar_factura_a_tesoreria(p_factura uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo  uuid := public.usuario_actual();
  v_fac public.facturas_venta%rowtype;
  v_ot  text;
begin
  perform public.exigir_permiso('contabilidad.facturar');
  select * into v_fac from public.facturas_venta where id = p_factura for update;
  if not found then raise exception 'Esa factura no existe.' using errcode = 'check_violation'; end if;
  if v_fac.estado = 'ENVIADA' then return p_factura; end if;
  if v_fac.estado = 'ANULADA' then
    raise exception 'La factura % está anulada: no se envía.', v_fac.numero using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.cuentas_cobrar_ot
              where orden_id = v_fac.orden_id and numero_documento = v_fac.numero and anulada_en is null) then
    raise exception 'Tesorería ya tiene la factura % de esa OT por cobrar.', v_fac.numero using errcode = 'unique_violation';
  end if;
  -- Mientras siga la restricción vieja (la suelta la 20261015121000), el número
  -- de una factura anulada no vuelve a entrar en esa OT: que lo diga claro.
  if exists (select 1 from public.cuentas_cobrar_ot
              where orden_id = v_fac.orden_id and numero_documento = v_fac.numero and anulada_en is not null)
     and exists (select 1 from pg_constraint where conname = 'cuentas_cobrar_ot_orden_id_numero_documento_key'
                   and conrelid = 'public.cuentas_cobrar_ot'::regclass) then
    raise exception 'La factura % ya se envió una vez a esa OT y se anuló: para enviarla otra vez con el mismo número, el administrador del sistema tiene que liberar ese número.', v_fac.numero using errcode = 'check_violation';
  end if;

  update public.facturas_venta set estado = 'ENVIADA', enviada_por = v_yo, enviada_en = now() where id = p_factura;
  insert into public.cuentas_cobrar_ot (orden_id, numero_documento, fecha_emision, fecha_vencimiento, moneda, total,
                                        observacion, registrado_por, factura_venta_id)
  values (v_fac.orden_id, v_fac.numero, v_fac.fecha_emision, v_fac.fecha_vencimiento, v_fac.moneda, v_fac.total,
          coalesce(v_fac.concepto, ''), v_yo, p_factura);

  select numero into v_ot from public.ordenes_trabajo where id = v_fac.orden_id;
  perform public.notificar_a_permiso('tesoreria.registrar_cobros', 'Factura por cobrar: ' || v_fac.numero,
    v_fac.cliente || ' · OT ' || coalesce(v_ot, '—') || ' · ' || case when v_fac.moneda = 'USD' then 'US$ ' else 'S/ ' end
      || to_char(v_fac.total, 'FM999G999G990D00'),
    '/tesoreria/por-cobrar#' || p_factura, 'facturas_venta', p_factura, v_yo);
  return p_factura;
end;
$$;
revoke all on function public.enviar_factura_a_tesoreria(uuid) from public, anon;
grant execute on function public.enviar_factura_a_tesoreria(uuid) to authenticated;

-- 13. Una factura mal anexada o anulada en SUNAT se anula aquí -------------------------
-- Mientras Tesorería no haya cobrado nada de ella. Si ya estaba en Tesorería,
-- su cuenta por cobrar deja de salir y Tesorería recibe el aviso.
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
  if v_fac.estado = 'ANULADA' then return p_factura; end if;
  if exists (select 1 from public.cobros_ot b join public.cuentas_cobrar_ot c on c.id = b.cuenta_id
              where c.factura_venta_id = p_factura) then
    raise exception 'Tesorería ya registró cobros de la factura %: no se anula.', v_fac.numero using errcode = 'check_violation';
  end if;

  update public.facturas_venta
     set estado = 'ANULADA', anulada_por = v_yo, anulada_en = now(), motivo_anulacion = btrim(p_motivo)
   where id = p_factura;
  if v_fac.estado = 'ENVIADA' then
    update public.cuentas_cobrar_ot set anulada_en = now() where factura_venta_id = p_factura;
    perform public.notificar_a_permiso('tesoreria.registrar_cobros', 'Factura anulada: ' || v_fac.numero,
      'Contabilidad la anuló: ' || left(btrim(p_motivo), 200), '/tesoreria/por-cobrar', 'facturas_venta', p_factura, v_yo);
  end if;
  return p_factura;
end;
$$;
revoke all on function public.anular_factura_venta(uuid, text) from public, anon;
grant execute on function public.anular_factura_venta(uuid, text) to authenticated;

-- 14. Los servicios que Tesorería paga ----------------------------------------------------
-- Las órdenes de servicio aprobadas por Gerencia y no anuladas, con lo pagado.
-- Cancelada: Tesorería registró un pago vigente que la cancela.
create or replace function public.servicios_por_pagar()
returns table (
  id uuid, numero text, proveedor_id uuid, proveedor text, proveedor_documento text, orden text, descripcion text,
  moneda text, monto numeric, condicion_pago text, dias_credito integer, estado text, aprobado_en timestamptz,
  conformidad_en timestamptz, pagado numeric, cancelada boolean, ultimo_pago date
) language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not (public.es_admin() or public.tiene_permiso('tesoreria.pagar_servicios') or public.tiene_permiso('tesoreria.ver_documentos')) then
    raise exception 'Los pagos de servicio los lleva Tesorería.' using errcode = 'insufficient_privilege';
  end if;
  return query
    select s.id, s.numero, s.proveedor_id, s.proveedor, p.numero_documento, o.numero, s.descripcion, s.moneda, s.monto,
           s.condicion_pago, s.dias_credito, s.estado, s.aprobado_en, s.conformidad_en,
           coalesce(sum(g.monto) filter (where g.anulado_en is null), 0)::numeric(14, 2),
           coalesce(bool_or(g.cancela) filter (where g.anulado_en is null), false),
           max(g.fecha_pago) filter (where g.anulado_en is null)
      from public.ordenes_servicio s
      left join public.proveedores p on p.id = s.proveedor_id
      left join public.ordenes_trabajo o on o.id = s.orden_id
      left join public.pagos_orden_servicio g on g.orden_servicio_id = s.id
     where s.aprobacion = 'APROBADA' and s.estado <> 'ANULADA'
     group by s.id, p.numero_documento, o.numero
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

-- 15. Lo que espera a cada uno, para el tablero ----------------------------------------
-- Cada número solo para quien lo puede mover; a los demás, nulo.
create or replace function public.finanzas_pendientes()
returns table (por_enviar_contabilidad integer, por_facturar integer, facturas_por_enviar integer, servicios_por_pagar integer)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  return query select
    case when public.es_admin() or public.tiene_permiso('cotizaciones.enviar_contabilidad') then (
      select count(*)::integer from public.cotizaciones_pdf c
        join public.ordenes_trabajo o on o.cotizacion_pdf_id = c.id and o.estado <> 'ANULADA'
       where not exists (select 1 from public.cotizaciones_envios_contabilidad e where e.cotizacion_pdf_id = c.id)
         and (c.estado::text = 'APROBADA'
              or exists (select 1 from public.cotizaciones_pdf_versiones v
                          where v.cotizacion_id = c.id and v.estado_al_archivar = 'APROBADA'))) end,
    case when public.es_admin() or public.tiene_permiso('contabilidad.facturar') then (
      select count(*)::integer from public.cotizaciones_envios_contabilidad e
       where not exists (select 1 from public.facturas_venta f
                          where f.cotizacion_pdf_id = e.cotizacion_pdf_id and f.estado <> 'ANULADA')) end,
    case when public.es_admin() or public.tiene_permiso('contabilidad.facturar') then (
      select count(*)::integer from public.facturas_venta f where f.estado = 'ANEXADA') end,
    case when public.es_admin() or public.tiene_permiso('tesoreria.pagar_servicios') then (
      select count(*)::integer from public.ordenes_servicio s
       where s.aprobacion = 'APROBADA' and s.estado = 'CONFORME'
         and not exists (select 1 from public.pagos_orden_servicio g
                          where g.orden_servicio_id = s.id and g.anulado_en is null and g.cancela)) end;
end;
$$;
revoke all on function public.finanzas_pendientes() from public, anon;
grant execute on function public.finanzas_pendientes() to authenticated;
