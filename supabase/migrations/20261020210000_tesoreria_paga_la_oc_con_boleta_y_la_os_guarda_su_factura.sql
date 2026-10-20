-- =============================================================================
-- TESORERÍA PAGA LA OC CON BOLETA Y LA OS GUARDA SU FACTURA
-- -----------------------------------------------------------------------------
-- DKS lo contestó el 20/10, a las dos preguntas de Adquisiciones («¿Tesorería
-- debe registrar el pago de las OC que van con boleta? ¿La OS debe guardar el
-- PDF de su factura?»): «sí, al registrar una OC Tesorería puede visualizar la
-- OC y la factura para ver cuánto pagar, aparte de la cuenta de banco, y sí la
-- OS debe guardar su factura».
--
-- Hasta hoy la OC con boleta, nota de venta o recibo (`con_factura = false`) no
-- tenía pago en el sistema: Contabilidad registra facturas, no boletas, y todo el
-- pago colgaba de una factura registrada. Desde aquí Tesorería la paga directo,
-- como paga la OS: contra la OC, con su voucher y desde una cuenta de la caja,
-- que se mueve sola. La boleta la adjunta Logística (ya era así).
--
-- Las OC con boleta emitidas antes de esta migración se pagaron fuera del
-- sistema y nadie anotó cuándo: no aparecen como deuda. Las marca la columna
-- nueva `pago_en_tesoreria`, falsa para las que ya existían.
--
-- La OS no guardaba su factura: solo el número que Tesorería anotaba al pagar.
-- Desde aquí guarda sus documentos —la factura, la boleta o el recibo del
-- proveedor, y el contrato— en una sola tabla, acordada con el hilo que suma el
-- contrato de la OS. Los adjuntan Logística, que emitió la OS, y Tesorería, si
-- el proveedor se la manda a ella. Nada lleva monto: el documento dice cuánto.
--
-- Y la OC en PDF ya se abre para Tesorería y Contabilidad: la de un RQ de OT
-- leía sus líneas con los permisos de Requerimientos, que ellas no tienen, y
-- salía «No tienes acceso a todas las solicitudes de esta compra».
--
-- Idempotente. Sin `drop` de funciones ni de políticas: el conector de
-- producción no los deja pasar. `drop constraint` sí pasa.
-- =============================================================================

-- 1. ¿Su pago lo registra Tesorería? ------------------------------------------------
-- Las OC que ya existían quedan en falso; las nuevas, en verdadero. Solo cuenta
-- para la OC con boleta: la que va con factura se paga por su factura.
alter table public.ordenes_compra_materiales
  add column if not exists pago_en_tesoreria boolean not null default false;
alter table public.ordenes_compra_materiales alter column pago_en_tesoreria set default true;
comment on column public.ordenes_compra_materiales.pago_en_tesoreria is
  'La OC con boleta la paga Tesorería en el sistema (migración 20261020210000). Falso en las que ya existían: se pagaron fuera.';

-- 2. El pago de una OC con boleta -----------------------------------------------------
-- Calcado del pago de la OS: uno o varios pagos, cada uno con su voucher, y quien
-- paga dice si con ese pago la OC queda cancelada. El que completa el total la
-- cancela solo.
create table if not exists public.pagos_orden_compra (
  id                    uuid primary key default gen_random_uuid(),
  orden_compra_id       uuid not null references public.ordenes_compra_materiales(id) on delete restrict,
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
  constraint uq_pago_compra_archivo unique (archivo_ruta),
  constraint ck_pago_compra_valores check (
    moneda in ('PEN', 'USD') and monto > 0 and monto <= 999999999
    and (operacion is null or char_length(btrim(operacion)) between 1 and 60)
    and (comprobante_proveedor is null or char_length(btrim(comprobante_proveedor)) between 3 and 30)
    and archivo_mime in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
    and archivo_tamano between 1 and 10485760),
  constraint ck_pago_compra_anulado check (
    anulado_en is null
    or (anulado_por is not null and char_length(btrim(coalesce(motivo_anulacion, ''))) between 10 and 500))
);
comment on table public.pagos_orden_compra is
  'Un pago de Tesorería a una OC con boleta, nota de venta o recibo, con su voucher. No se borra: se anula.';
-- (b) Cuentas por pagar y Adquisiciones suman los pagos de cada OC.
create index if not exists ix_pagos_orden_compra_oc on public.pagos_orden_compra (orden_compra_id);
select public.activar_timestamps('pagos_orden_compra');
select public.activar_auditoria('pagos_orden_compra');
select public.activar_registro_de_prueba('pagos_orden_compra');

create or replace function public.fn_pago_compra_guardia()
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
revoke all on function public.fn_pago_compra_guardia() from public, anon, authenticated;
create or replace trigger trg_pago_compra_guardia
  before update or delete on public.pagos_orden_compra
  for each row execute function public.fn_pago_compra_guardia();

-- Los ven Tesorería, Gerencia, Logística (que emitió la OC) y quien ve
-- Adquisiciones, como los pagos de la OS (20261020170000).
alter table public.pagos_orden_compra enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'pagos_orden_compra' and policyname = 'ver_pagos_orden_compra') then
    create policy ver_pagos_orden_compra on public.pagos_orden_compra for select to authenticated
      using ((select public.es_admin()) or (select public.tiene_permiso('tesoreria.registrar_pagos'))
             or (select public.tiene_permiso('tesoreria.ver_documentos'))
             or (select public.tiene_permiso('compras.crear'))
             or (select public.tiene_permiso('adquisiciones.ver')));
  end if;
end $$;
revoke all on public.pagos_orden_compra from public, anon, authenticated;
grant select on public.pagos_orden_compra to authenticated;

-- El voucher: privado, hasta 10 MB, PDF o foto, en `pagos-compras/{OC}/…`. Lo
-- sube quien paga (el mismo permiso que pide `registrar_pago_compra`); lo ven
-- quien lo subió y quien ve el pago que lo nombra; uno suelto lo retira su dueño.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pagos-compras', 'pagos-compras', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'pagos_compras_subir') then
    create policy pagos_compras_subir on storage.objects for insert to authenticated with check (
      bucket_id = 'pagos-compras' and owner_id = (select auth.uid())::text
      and (select public.tiene_permiso('tesoreria.registrar_pagos') or public.es_admin()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'pagos_compras_ver') then
    create policy pagos_compras_ver on storage.objects for select to authenticated using (
      bucket_id = 'pagos-compras'
      and (owner_id = (select auth.uid())::text
           or exists (select 1 from public.pagos_orden_compra p where p.archivo_ruta = objects.name)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'pagos_compras_quitar_suelto') then
    create policy pagos_compras_quitar_suelto on storage.objects for delete to authenticated using (
      bucket_id = 'pagos-compras' and owner_id = (select auth.uid())::text
      and not exists (select 1 from public.pagos_orden_compra p where p.archivo_ruta = objects.name));
  end if;
end $$;

-- Con un pago vigente, la OC ya no cambia de boleta a factura ni de moneda: el
-- pago quedaría colgado de una OC que se paga por otro camino. Y si su pago lo
-- registra Tesorería no se cambia nunca. Un disparador propio, sin tocar los de la OC.
create or replace function public.fn_compra_pagada_no_cambia()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.pago_en_tesoreria is distinct from old.pago_en_tesoreria then
    raise exception 'Si el pago de la OC lo registra Tesorería no se cambia.' using errcode = 'check_violation';
  end if;
  if (new.con_factura, new.moneda) is distinct from (old.con_factura, old.moneda)
     and exists (select 1 from public.pagos_orden_compra where orden_compra_id = new.id and anulado_en is null) then
    raise exception 'La OC % ya tiene un pago de Tesorería: no cambia de comprobante ni de moneda mientras ese pago siga vigente.',
      coalesce(new.numero, new.referencia) using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_compra_pagada_no_cambia() from public, anon, authenticated;
create or replace trigger trg_compra_pagada_no_cambia
  before update on public.ordenes_compra_materiales
  for each row execute function public.fn_compra_pagada_no_cambia();

-- 3. La caja conoce el origen nuevo ------------------------------------------------------
alter table public.movimientos_caja
  drop constraint if exists ck_movimiento_caja_origen,
  add constraint ck_movimiento_caja_origen check (
    origen in ('MANUAL', 'TRANSFERENCIA', 'PAGO_ADQUISICION', 'PAGO_ORDEN_SERVICIO', 'PAGO_ORDEN_COMPRA',
               'PAGO_RECIBO_HONORARIOS', 'PAGO_PLANILLA_DIARIA', 'COBRO_FACTURA_VENTA')
    and ((origen = 'MANUAL') = (origen_id is null)));

-- El mismo cuerpo de la 20261019100000, con el nombre del pago nuevo: si no, el
-- egreso anotado a mano igual a un pago de OC decía «cobro de una factura de venta».
create or replace function public.fn_caja_sin_contar_dos_veces()
returns trigger language plpgsql set search_path to 'public' as $$
declare v_otro record;
begin
  if new.operacion is null or new.origen = 'TRANSFERENCIA' then return new; end if;
  select m.fecha, m.origen into v_otro
    from public.movimientos_caja m
   where m.caja_id = new.caja_id and m.tipo = new.tipo and m.monto = new.monto and m.anulado_en is null
     and m.origen <> 'TRANSFERENCIA' and (m.origen = 'MANUAL') <> (new.origen = 'MANUAL')
     and lower(btrim(m.operacion)) = lower(btrim(new.operacion))
   limit 1;
  if not found then return new; end if;
  if new.origen = 'MANUAL' then
    raise exception 'Ese % ya está en la caja: lo dejó el % con la operación % el %. Los pagos y cobros del sistema entran solos.',
      lower(new.tipo),
      case v_otro.origen when 'PAGO_ADQUISICION' then 'pago de una factura de compra'
                         when 'PAGO_ORDEN_SERVICIO' then 'pago de una orden de servicio'
                         when 'PAGO_ORDEN_COMPRA' then 'pago de una OC con boleta'
                         when 'PAGO_RECIBO_HONORARIOS' then 'pago de un recibo por honorarios'
                         when 'PAGO_PLANILLA_DIARIA' then 'pago de la planilla diaria'
                         else 'cobro de una factura de venta' end,
      btrim(new.operacion), public.caja_texto_fecha(v_otro.fecha) using errcode = 'check_violation';
  end if;
  raise exception 'En esa cuenta ya está anotado a mano un % del mismo monto con la operación % el %: es este mismo %. Anúlalo en Caja diaria y vuelve a registrarlo aquí, que la caja lo toma sola.',
    lower(new.tipo), btrim(new.operacion), public.caja_texto_fecha(v_otro.fecha),
    case when new.origen = 'COBRO_FACTURA_VENTA' then 'cobro' else 'pago' end using errcode = 'check_violation';
end;
$$;
revoke all on function public.fn_caja_sin_contar_dos_veces() from public, anon, authenticated;

-- 4. Las OC con boleta que Tesorería paga ---------------------------------------------------
-- Aprobadas (o sin aprobación que pedir), con su total, lo pagado y su
-- vencimiento: todas las que faltan y las 60 últimas canceladas.
create or replace function public.compras_con_boleta_por_pagar()
returns table (
  id uuid, numero text, referencia text, proveedor_id uuid, proveedor text, proveedor_documento text,
  codigo_interno text, moneda text, total numeric, sin_precio boolean, condicion_pago text, dias_credito integer,
  creado_en timestamptz, vence date, recojo text, pagado numeric, cancelada boolean, ultimo_pago date
) language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  if not (public.es_admin() or public.tiene_permiso('tesoreria.registrar_pagos') or public.tiene_permiso('tesoreria.ver_documentos')) then
    raise exception 'Las OC con boleta las paga Tesorería.' using errcode = 'insufficient_privilege';
  end if;
  return query
  with filas as (
    select c.id, c.numero, c.referencia, c.proveedor_id, c.proveedor, p.numero_documento as ruc, c.codigo_interno, c.moneda,
           public.total_orden_compra(c.id) as total,
           exists (select 1 from public.orden_compra_material_detalles d where d.orden_compra_id = c.id and d.precio_unitario is null) as sin_precio,
           c.condicion_pago, c.dias_credito, c.creado_en,
           ((c.creado_en at time zone 'America/Lima')::date + coalesce(c.dias_credito, 0)) as vence,
           c.recojo, coalesce(g.pagado, 0)::numeric(14, 2) as pagado, coalesce(g.cancelada, false) as cancelada, g.ultimo
      from public.ordenes_compra_materiales c
      left join public.proveedores p on p.id = c.proveedor_id
      left join lateral (
        select sum(x.monto) as pagado, bool_or(x.cancela) as cancelada, max(x.fecha_pago) as ultimo
          from public.pagos_orden_compra x where x.orden_compra_id = c.id and x.anulado_en is null
      ) g on true
     where not c.con_factura and c.pago_en_tesoreria and c.aprobacion in ('APROBADA', 'NO_REQUERIDA')
       -- Si Contabilidad le registró el comprobante, se paga en las facturas; la
       -- que ya tenía pagos aquí se queda, para que se vean.
       and (exists (select 1 from public.pagos_orden_compra x where x.orden_compra_id = c.id and x.anulado_en is null)
            or not exists (select 1 from public.adquisiciones a
                            where a.estado = 'REGISTRADA'
                              and (a.orden_compra_id = c.id
                                   or exists (select 1 from public.adquisiciones_ordenes_compra l
                                               where l.adquisicion_id = a.id and l.orden_compra_id = c.id
                                                 and l.quitada_en is null))))
  )
  select * from (
    select f.id, f.numero, f.referencia, f.proveedor_id, f.proveedor, f.ruc, f.codigo_interno, f.moneda, f.total, f.sin_precio,
           f.condicion_pago, f.dias_credito, f.creado_en, f.vence, f.recojo, f.pagado, f.cancelada, f.ultimo
      from filas f where not f.cancelada
    union all
    (select f.id, f.numero, f.referencia, f.proveedor_id, f.proveedor, f.ruc, f.codigo_interno, f.moneda, f.total, f.sin_precio,
            f.condicion_pago, f.dias_credito, f.creado_en, f.vence, f.recojo, f.pagado, f.cancelada, f.ultimo
       from filas f where f.cancelada order by f.ultimo desc nulls last, f.creado_en desc limit 60)
  ) x
  order by x.cancelada, x.vence, x.creado_en;
end;
$$;
comment on function public.compras_con_boleta_por_pagar() is
  'Las OC con boleta aprobadas que Tesorería paga: las que faltan y las 60 últimas canceladas. Exige tesoreria.registrar_pagos o tesoreria.ver_documentos.';
revoke all on function public.compras_con_boleta_por_pagar() from public, anon;
grant execute on function public.compras_con_boleta_por_pagar() to authenticated;

create or replace function public.registrar_pago_compra(
  p_id uuid, p_orden_compra uuid, p_fecha_pago date, p_monto numeric, p_cancela boolean,
  p_operacion text, p_comprobante text, p_ruta text, p_caja uuid, p_monto_cuenta numeric
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo      uuid := public.usuario_actual();
  v_hoy     date := (now() at time zone 'America/Lima')::date;
  v_oc      public.ordenes_compra_materiales%rowtype;
  v_nombre  text;
  v_total   numeric;
  v_pagado  numeric;
  v_cancela boolean;
  v_fact    text;
  v_obj     storage.objects%rowtype;
  v_op      text := nullif(btrim(coalesce(p_operacion, '')), '');
  v_comp    text := nullif(upper(btrim(coalesce(p_comprobante, ''))), '');
  v_mon     text;
begin
  perform public.exigir_permiso('tesoreria.registrar_pagos');
  if p_id is null then raise exception 'Vuelve a abrir el formulario del pago.' using errcode = 'check_violation'; end if;
  if exists (select 1 from public.pagos_orden_compra where id = p_id) then return p_id; end if;
  select * into v_oc from public.ordenes_compra_materiales where id = p_orden_compra for update;
  if not found then raise exception 'Esa orden de compra no existe.' using errcode = 'check_violation'; end if;
  v_nombre := coalesce(v_oc.numero, 'OC ' || v_oc.referencia);
  if v_oc.con_factura then
    raise exception 'La % va con factura: se paga en Cuentas por pagar cuando Contabilidad la registra.', v_nombre using errcode = 'check_violation';
  end if;
  if not v_oc.pago_en_tesoreria then
    raise exception 'La % es de antes de que Tesorería registrara el pago de las OC con boleta: se pagó fuera del sistema.', v_nombre
      using errcode = 'check_violation';
  end if;
  if v_oc.aprobacion not in ('APROBADA', 'NO_REQUERIDA') then
    raise exception 'La % no está aprobada por Gerencia: no se paga.', v_nombre using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.orden_compra_material_detalles where orden_compra_id = p_orden_compra and precio_unitario is null) then
    raise exception 'La % tiene líneas sin precio: Logística tiene que completarlas antes del pago.', v_nombre using errcode = 'check_violation';
  end if;
  -- Si Contabilidad ya le registró un comprobante, se paga por ahí: dos caminos son dos pagos.
  select a.numero_documento into v_fact
    from public.adquisiciones a
   where a.estado = 'REGISTRADA'
     and (a.orden_compra_id = p_orden_compra
          or exists (select 1 from public.adquisiciones_ordenes_compra l
                      where l.adquisicion_id = a.id and l.orden_compra_id = p_orden_compra and l.quitada_en is null))
   limit 1;
  if v_fact is not null then
    raise exception 'Contabilidad ya registró el comprobante % de la %: se paga en Cuentas por pagar.', v_fact, v_nombre
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.pagos_orden_compra where orden_compra_id = p_orden_compra and anulado_en is null and cancela) then
    raise exception 'La % ya está pagada.', v_nombre using errcode = 'check_violation';
  end if;
  if p_fecha_pago is null or p_fecha_pago > v_hoy or p_fecha_pago < v_hoy - 365 then
    raise exception 'Elige el día del pago: de hoy hacia atrás.' using errcode = 'check_violation';
  end if;
  if p_monto is null or p_monto <= 0 or p_monto > 999999999 or p_monto <> round(p_monto, 2) then
    raise exception 'Escribe lo que se pagó, en dos decimales.' using errcode = 'check_violation';
  end if;
  v_total := public.total_orden_compra(p_orden_compra);
  select coalesce(sum(monto), 0) into v_pagado from public.pagos_orden_compra
   where orden_compra_id = p_orden_compra and anulado_en is null;
  v_mon := case when v_oc.moneda = 'USD' then 'US$ ' else 'S/ ' end;
  if v_pagado + p_monto > v_total then
    raise exception 'Con ese pago la % pasaría de su total (%): le quedan % por pagar.', v_nombre,
      v_mon || to_char(v_total, 'FM999G999G990D00'), v_mon || to_char(greatest(v_total - v_pagado, 0), 'FM999G999G990D00')
      using errcode = 'check_violation';
  end if;
  if v_op is not null and char_length(v_op) > 60 then
    raise exception 'El número de operación pasa de 60 caracteres.' using errcode = 'check_violation';
  end if;
  if v_comp is not null and char_length(v_comp) not between 3 and 30 then
    raise exception 'El número de la boleta, nota de venta o recibo va de 3 a 30 caracteres.' using errcode = 'check_violation';
  end if;
  v_obj := public.archivo_subido_por_mi('pagos-compras', p_ruta, p_orden_compra,
                                        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
  v_cancela := coalesce(p_cancela, false) or v_pagado + p_monto >= v_total;

  insert into public.pagos_orden_compra (id, orden_compra_id, fecha_pago, moneda, monto, cancela, operacion,
                                         comprobante_proveedor, archivo_ruta, archivo_mime, archivo_tamano, registrado_por)
  values (p_id, p_orden_compra, p_fecha_pago, v_oc.moneda, p_monto, v_cancela, v_op, v_comp, p_ruta,
          v_obj.metadata->>'mimetype', (v_obj.metadata->>'size')::integer, v_yo);

  perform public.caja_mover_por_pago('PAGO_ORDEN_COMPRA', p_id, 'EGRESO', p_caja, p_fecha_pago, p_monto, v_oc.moneda, p_monto_cuenta,
    'Pago de la ' || v_nombre || ' · ' || v_oc.proveedor, v_oc.codigo_interno, v_op);

  perform public.notificar_a_permiso('compras.crear',
    case when v_cancela then 'OC pagada: ' else 'Pago a cuenta de una OC: ' end || v_nombre,
    v_oc.proveedor || ' · ' || v_mon || to_char(p_monto, 'FM999G999G990D00'),
    '/compras/ordenes', 'pagos_orden_compra', p_id, v_yo);
  return p_id;
end;
$$;
comment on function public.registrar_pago_compra(uuid, uuid, date, numeric, boolean, text, text, text, uuid, numeric) is
  'Tesorería paga una OC con boleta aprobada con su voucher, desde la cuenta de la caja que elige: deja su egreso en la caja. Exige tesoreria.registrar_pagos.';
revoke all on function public.registrar_pago_compra(uuid, uuid, date, numeric, boolean, text, text, text, uuid, numeric) from public, anon;
grant execute on function public.registrar_pago_compra(uuid, uuid, date, numeric, boolean, text, text, text, uuid, numeric) to authenticated;

create or replace function public.anular_pago_compra(p_id uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_pago public.pagos_orden_compra%rowtype;
begin
  perform public.exigir_permiso('tesoreria.registrar_pagos');
  if char_length(btrim(coalesce(p_motivo, ''))) not between 10 and 500 then
    raise exception 'Cuenta por qué se anula, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_pago from public.pagos_orden_compra where id = p_id for update;
  if not found then raise exception 'Ese pago no existe.' using errcode = 'check_violation'; end if;
  if v_pago.anulado_en is not null then return p_id; end if;
  perform public.caja_anular_por_pago('PAGO_ORDEN_COMPRA', p_id, p_motivo, 'pago');
  update public.pagos_orden_compra
     set anulado_por = public.usuario_actual(), anulado_en = now(), motivo_anulacion = btrim(p_motivo)
   where id = p_id;
  return p_id;
end;
$$;
revoke all on function public.anular_pago_compra(uuid, text) from public, anon;
grant execute on function public.anular_pago_compra(uuid, text) to authenticated;

-- La compra a crédito con boleta no espera factura: salía para siempre en
-- «Compras a crédito sin comprobante». Misma consulta y la misma opción de la
-- vista (20261016602100), más la condición.
create or replace view public.v_compras_credito_sin_comprobante with (security_invoker = true) as
 select c.id as orden_compra_id, r.orden_id, o.numero as numero_ot, c.proveedor, c.referencia,
        c.creado_en::date as fecha_compra, c.creado_en::date + c.dias_credito as fecha_vencimiento,
        case when bool_or(d.precio_unitario is null) then null::numeric
             else round(sum(d.cantidad::numeric * d.precio_unitario), 2)::numeric(14, 2) end as total_estimado,
        c.moneda, c.numero
   from public.ordenes_compra_materiales c
   left join public.requerimientos_materiales r on r.id = c.requerimiento_id
   left join public.ordenes_trabajo o on o.id = r.orden_id
   join public.orden_compra_material_detalles d on d.orden_compra_id = c.id
  where c.condicion_pago = 'CREDITO' and c.con_factura and (c.requerimiento_id is null or o.id is not null)
    and not exists (select 1 from public.adquisiciones_ordenes_compra l
                      join public.adquisiciones a on a.id = l.adquisicion_id
                     where l.orden_compra_id = c.id and a.estado = 'REGISTRADA' and l.quitada_en is null)
  group by c.id, r.orden_id, o.numero;

-- 5. Los documentos de la OS ---------------------------------------------------------------
-- Quién los adjunta: Logística, que emitió la OS (`compras.crear`), y Tesorería
-- (`tesoreria.pagar_servicios`). La misma regla la usan la función que los
-- anota, la que los anula y la política de subida: la acción no puede pedir una
-- cosa y la política aceptar otra.
create or replace function public.puede_adjuntar_documento_servicio()
returns boolean language sql stable set search_path to 'public' as $$
  select public.es_admin() or public.tiene_permiso('compras.crear') or public.tiene_permiso('tesoreria.pagar_servicios');
$$;
revoke all on function public.puede_adjuntar_documento_servicio() from public, anon;
grant execute on function public.puede_adjuntar_documento_servicio() to authenticated;

create table if not exists public.documentos_orden_servicio (
  id                 uuid primary key default gen_random_uuid(),
  orden_servicio_id  uuid not null references public.ordenes_servicio(id) on delete restrict,
  tipo               text not null,
  numero             text,
  nombre_archivo     text not null,
  ruta_storage       text not null,
  mime_type          text not null,
  tamano_bytes       integer not null,
  subido_por         uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  anulado_por        uuid references public.usuarios(id) on delete restrict,
  anulado_en         timestamptz,
  motivo_anulacion   text,
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now(),
  constraint uq_documento_servicio_ruta unique (ruta_storage),
  constraint ck_documento_servicio_valores check (
    tipo in ('FACTURA', 'BOLETA', 'RECIBO', 'CONTRATO', 'OTRO')
    and ((tipo in ('FACTURA', 'BOLETA', 'RECIBO')) = (numero is not null))
    and char_length(btrim(nombre_archivo)) between 1 and 200
    and mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
    and tamano_bytes between 1 and 10485760),
  constraint ck_documento_servicio_anulado check (
    anulado_en is null
    or (anulado_por is not null and char_length(btrim(coalesce(motivo_anulacion, ''))) between 10 and 500))
);
comment on table public.documentos_orden_servicio is
  'La factura, boleta o recibo del proveedor de una OS, su contrato u otro documento, en PDF o foto. No se borra: se anula.';
-- (b) Órdenes de servicio, Pagos de servicio y Adquisiciones los leen por su OS.
create index if not exists ix_documentos_orden_servicio_os on public.documentos_orden_servicio (orden_servicio_id);
select public.activar_timestamps('documentos_orden_servicio');
select public.activar_auditoria('documentos_orden_servicio');
select public.activar_registro_de_prueba('documentos_orden_servicio');

create or replace function public.fn_documento_servicio_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
declare
  v_cambian constant text[] := array['anulado_por', 'anulado_en', 'motivo_anulacion', 'actualizado_en'];
begin
  if tg_op = 'DELETE' then
    raise exception 'Un documento de la orden de servicio no se borra: se anula con su motivo.' using errcode = 'check_violation';
  end if;
  if old.anulado_en is not null then
    raise exception 'Ese documento está anulado: queda como evidencia.' using errcode = 'check_violation';
  end if;
  if (to_jsonb(new) - v_cambian) is distinct from (to_jsonb(old) - v_cambian) then
    raise exception 'Un documento adjunto no se corrige: anúlalo con su motivo y adjunta el bueno.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_documento_servicio_guardia() from public, anon, authenticated;
create or replace trigger trg_documento_servicio_guardia
  before update or delete on public.documentos_orden_servicio
  for each row execute function public.fn_documento_servicio_guardia();

-- Los mismos que ven los pagos de la OS, más Contabilidad por la detracción. No
-- los ve quien solo ve la OS para costear (`costos.ver`): el comprobante y el
-- contrato llevan el dinero del servicio.
alter table public.documentos_orden_servicio enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'documentos_orden_servicio' and policyname = 'ver_documentos_orden_servicio') then
    create policy ver_documentos_orden_servicio on public.documentos_orden_servicio for select to authenticated
      using ((select public.es_admin()) or (select public.tiene_permiso('tesoreria.pagar_servicios'))
             or (select public.tiene_permiso('tesoreria.ver_documentos'))
             or (select public.tiene_permiso('compras.crear'))
             or (select public.tiene_permiso('compras.detraccion'))
             or (select public.tiene_permiso('adquisiciones.ver')));
  end if;
end $$;
revoke all on public.documentos_orden_servicio from public, anon, authenticated;
grant select on public.documentos_orden_servicio to authenticated;

-- Privado, hasta 10 MB, PDF o foto, en `documentos-servicio/{OS}/…`.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documentos-servicio', 'documentos-servicio', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'documentos_servicio_subir') then
    create policy documentos_servicio_subir on storage.objects for insert to authenticated with check (
      bucket_id = 'documentos-servicio' and owner_id = (select auth.uid())::text
      and (select public.puede_adjuntar_documento_servicio()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'documentos_servicio_ver') then
    create policy documentos_servicio_ver on storage.objects for select to authenticated using (
      bucket_id = 'documentos-servicio'
      and (owner_id = (select auth.uid())::text
           or exists (select 1 from public.documentos_orden_servicio d where d.ruta_storage = objects.name)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'documentos_servicio_quitar_suelto') then
    create policy documentos_servicio_quitar_suelto on storage.objects for delete to authenticated using (
      bucket_id = 'documentos-servicio' and owner_id = (select auth.uid())::text
      and not exists (select 1 from public.documentos_orden_servicio d where d.ruta_storage = objects.name));
  end if;
end $$;

-- Anota el archivo que quien llama acaba de subir. La factura, la boleta y el
-- recibo llevan su número; el mismo comprobante del mismo proveedor no va en dos
-- OS, y el mismo archivo no va dos veces con el mismo tipo.
create or replace function public.adjuntar_documento_servicio(
  p_id uuid, p_orden_servicio uuid, p_tipo text, p_numero text, p_nombre text, p_ruta text
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo      uuid := public.usuario_actual();
  v_os      public.ordenes_servicio%rowtype;
  v_obj     storage.objects%rowtype;
  v_num     text;
  v_nombre  text := left(btrim(coalesce(p_nombre, '')), 200);
  v_otra    text;
  v_que     text;
begin
  if not public.puede_adjuntar_documento_servicio() then
    raise exception 'Los documentos de la orden de servicio los adjuntan Logística y Tesorería.' using errcode = 'insufficient_privilege';
  end if;
  if p_id is null then raise exception 'Vuelve a abrir el formulario.' using errcode = 'check_violation'; end if;
  if exists (select 1 from public.documentos_orden_servicio where id = p_id) then return p_id; end if;
  v_que := case p_tipo when 'FACTURA' then 'factura' when 'BOLETA' then 'boleta' when 'RECIBO' then 'recibo'
                       when 'CONTRATO' then 'contrato' when 'OTRO' then 'documento' end;
  if v_que is null then raise exception 'Elige qué documento es.' using errcode = 'check_violation'; end if;
  select * into v_os from public.ordenes_servicio where id = p_orden_servicio;
  if not found then raise exception 'Esa orden de servicio no existe.' using errcode = 'check_violation'; end if;
  if v_os.estado = 'ANULADA' or v_os.aprobacion = 'RECHAZADA' then
    raise exception 'La % está %: no se le adjuntan documentos.', v_os.numero,
      case when v_os.estado = 'ANULADA' then 'anulada' else 'rechazada' end using errcode = 'check_violation';
  end if;
  if char_length(v_nombre) = 0 then raise exception 'Adjunta el archivo.' using errcode = 'check_violation'; end if;
  if p_tipo in ('FACTURA', 'BOLETA', 'RECIBO') then
    v_num := public.normalizar_numero_factura(p_numero);
    if v_num is null then
      raise exception 'Escribe el número de la % con su serie y su número, como F001-123.', v_que using errcode = 'check_violation';
    end if;
    select s.numero into v_otra
      from public.documentos_orden_servicio d join public.ordenes_servicio s on s.id = d.orden_servicio_id
     where d.anulado_en is null and d.tipo = p_tipo and d.numero = v_num
       and coalesce(s.proveedor_id::text, upper(btrim(s.proveedor))) = coalesce(v_os.proveedor_id::text, upper(btrim(v_os.proveedor)))
     limit 1;
    if v_otra is not null then
      raise exception 'La % % de este proveedor ya está adjunta a la %: si es la misma, anúlala allí antes de adjuntarla aquí.',
        v_que, v_num, v_otra using errcode = 'check_violation';
    end if;
  end if;
  v_obj := public.archivo_subido_por_mi('documentos-servicio', p_ruta, p_orden_servicio,
                                        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
  if exists (select 1 from public.documentos_orden_servicio
              where orden_servicio_id = p_orden_servicio and anulado_en is null and tipo = p_tipo
                and nombre_archivo = v_nombre and tamano_bytes = (v_obj.metadata->>'size')::integer) then
    raise exception 'Ese archivo ya está adjunto a la % como %: no hace falta subirlo otra vez.', v_os.numero, v_que
      using errcode = 'check_violation';
  end if;

  insert into public.documentos_orden_servicio (id, orden_servicio_id, tipo, numero, nombre_archivo, ruta_storage,
                                                mime_type, tamano_bytes, subido_por)
  values (p_id, p_orden_servicio, p_tipo, v_num, v_nombre, p_ruta,
          v_obj.metadata->>'mimetype', (v_obj.metadata->>'size')::integer, v_yo);

  -- El comprobante de una OS aprobada es lo que Tesorería espera para pagar.
  if v_num is not null and v_os.aprobacion = 'APROBADA' then
    perform public.notificar_a_permiso('tesoreria.pagar_servicios',
      'Comprobante de servicio por pagar: ' || v_os.numero,
      v_os.proveedor || ' · ' || initcap(v_que) || ' ' || v_num,
      '/tesoreria/pagos-de-servicio', 'documentos_orden_servicio', p_id, v_yo);
  end if;
  return p_id;
end;
$$;
comment on function public.adjuntar_documento_servicio(uuid, uuid, text, text, text, text) is
  'Anota en la OS el PDF o la foto de su factura, boleta, recibo, contrato u otro documento, ya subido a documentos-servicio/{OS}/. Logística o Tesorería.';
revoke all on function public.adjuntar_documento_servicio(uuid, uuid, text, text, text, text) from public, anon;
grant execute on function public.adjuntar_documento_servicio(uuid, uuid, text, text, text, text) to authenticated;

create or replace function public.anular_documento_servicio(p_id uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_doc public.documentos_orden_servicio%rowtype;
begin
  if not public.puede_adjuntar_documento_servicio() then
    raise exception 'Los documentos de la orden de servicio los anulan Logística y Tesorería.' using errcode = 'insufficient_privilege';
  end if;
  if char_length(btrim(coalesce(p_motivo, ''))) not between 10 and 500 then
    raise exception 'Cuenta por qué se anula, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_doc from public.documentos_orden_servicio where id = p_id for update;
  if not found then raise exception 'Ese documento no existe.' using errcode = 'check_violation'; end if;
  if v_doc.anulado_en is not null then return p_id; end if;
  update public.documentos_orden_servicio
     set anulado_por = public.usuario_actual(), anulado_en = now(), motivo_anulacion = btrim(p_motivo)
   where id = p_id;
  return p_id;
end;
$$;
revoke all on function public.anular_documento_servicio(uuid, text) from public, anon;
grant execute on function public.anular_documento_servicio(uuid, text) to authenticated;

-- 6. Las líneas de la OC en papel ------------------------------------------------------------
-- La línea que atiende un RQ de OT se nombraba leyendo `v_atencion_materiales`,
-- que mira con los permisos de Requerimientos: Tesorería y Contabilidad ven la
-- OC (`compras.ver`) pero no el RQ, y su PDF salía con 403. Esta función entrega
-- solo lo que el papel necesita (OT, material, código y unidad) y solo de las
-- líneas que la política de las líneas de la OC ya deja ver a quien llama.
create or replace function public.lineas_de_compra_en_papel(p_compra uuid)
returns table (detalle_id uuid, numero_ot text, material text, material_codigo text, unidad text)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  if not (public.es_admin() or public.tiene_permiso('compras.ver') or public.tiene_permiso('almacen.recibir')) then
    raise exception 'No tiene permiso para ver las órdenes de compra.' using errcode = 'insufficient_privilege';
  end if;
  return query
  select rd.id, o.numero::text, mat.descripcion::text, mat.codigo::text, um.codigo::text
    from public.orden_compra_material_detalles d
    join public.requerimiento_material_detalles rd on rd.id = d.requerimiento_detalle_id
    join public.requerimientos_materiales r on r.id = rd.requerimiento_id
    join public.ot_materiales m on m.id = rd.ot_material_id
    join public.materiales mat on mat.id = m.material_id
    left join public.unidades_medida um on um.id = mat.unidad_medida_id
    join public.ordenes_trabajo o on o.id = r.orden_id
   where d.orden_compra_id = p_compra
     -- Lo mismo que pide `ver_orden_compra_material_detalles`.
     and (d.requerimiento_id is null
          or exists (select 1 from public.requerimientos_materiales x
                      where x.id = d.requerimiento_id and public.puede_ver_area_material(x.area_destino)));
end;
$$;
comment on function public.lineas_de_compra_en_papel(uuid) is
  'La OT, el material, su código y su unidad de cada línea de la OC que atiende un RQ de OT, para su PDF. Exige compras.ver o almacen.recibir.';
revoke all on function public.lineas_de_compra_en_papel(uuid) from public, anon;
grant execute on function public.lineas_de_compra_en_papel(uuid) to authenticated;

-- 7. Adquisiciones: el pago de la boleta y los documentos de la OS -------------------------
-- La misma firma de la 20261020170000. Cambia:
--   · la OC con boleta que paga Tesorería sale POR_PAGAR, PAGO_PARCIAL o PAGADA
--     con sus pagos; SIN_FACTURA queda para las de antes, pagadas fuera.
--   · la OS trae sus documentos.
--   · cada archivo dice en qué bucket está.
create or replace function public.trazabilidad_de_compras()
returns table (
  tipo text, id uuid, numero text, referencia text, descripcion text, creado_en timestamptz, emitido_por text,
  origen text, requerimientos jsonb, ordenes text[], codigos text[], areas text[],
  proveedor text, proveedor_id uuid, moneda text, total numeric, sin_precio boolean,
  condicion_pago text, dias_credito integer, con_factura boolean,
  aprobacion text, aprobado_en timestamptz, motivo_rechazo text,
  estado text, recojo text, entregado_almacen_en timestamptz, ingreso text,
  anulado_en timestamptz, motivo_anulacion text,
  facturado numeric, facturada_entera boolean, facturas jsonb, pagos jsonb, documentos jsonb,
  peso_kg numeric, en_lista boolean, guia jsonb, guias_anuladas integer, pago text
) language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  -- Logística, el conductor y Contabilidad, que con el peso emite la guía.
  v_recojo constant boolean := public.es_admin() or public.tiene_permiso('compras.programar_recojo')
                               or public.tiene_permiso('compras.recojo') or public.tiene_permiso('compras.guia_remision');
begin
  if not (public.es_admin() or public.tiene_permiso('adquisiciones.ver')) then
    raise exception 'Adquisiciones la ven Contabilidad, Tesorería, Logística y Gerencia.' using errcode = 'insufficient_privilege';
  end if;
  return query
  with facturada as (select * from public.compras_facturadas(null, null)),
  -- Cada factura de la OC (también la que está en borrador), con lo pagado y cada pago vigente.
  factura as (
    select l.orden_compra_id,
           jsonb_agg(jsonb_build_object(
             'id', a.id, 'numero', a.numero_documento, 'tipo', a.tipo, 'fecha', a.fecha_emision,
             'vence', a.fecha_vencimiento, 'condicion', a.condicion_pago, 'total', a.total, 'moneda', a.moneda,
             'estado', a.estado, 'parcial', l.parcial,
             'ruta', coalesce(a.ruta_storage, d.ruta_storage),
             'bucket', case when a.ruta_storage is not null then 'comprobantes-financieros'
                            when d.ruta_storage is not null then 'documentos-compras' end,
             'pagado', coalesce(p.pagado, 0), 'saldo', a.total - coalesce(p.pagado, 0),
             'pagos', coalesce(p.pagos, '[]'::jsonb))
             order by a.fecha_emision, a.numero_documento) as facturas,
           count(*) filter (where a.estado = 'REGISTRADA') as registradas,
           coalesce(bool_and(a.total - coalesce(p.pagado, 0) <= 0) filter (where a.estado = 'REGISTRADA'), false) as pagadas,
           coalesce(sum(p.pagado) filter (where a.estado = 'REGISTRADA'), 0) as pagado
      from public.adquisiciones_ordenes_compra l
      join public.adquisiciones a on a.id = l.adquisicion_id
      left join public.documentos_compra_material d on d.id = a.documento_compra_id
      left join lateral (
        select sum(x.monto) as pagado,
               jsonb_agg(jsonb_build_object('id', x.id, 'fecha', x.fecha, 'monto', x.monto,
                                            'referencia', x.referencia, 'ruta', x.archivo_ruta, 'bucket', 'pagos-facturas')
                         order by x.fecha, x.creado_en) as pagos
          from public.pagos_adquisicion x
         where x.adquisicion_id = a.id and x.anulado_en is null
      ) p on true
     where l.quitada_en is null
     group by l.orden_compra_id
  )
  select 'OC'::text, c.id, c.numero, c.referencia, null::text, c.creado_en,
         nullif(btrim(split_part(coalesce(u.nombres, ''), ' ', 1) || ' ' || split_part(coalesce(u.apellidos, ''), ' ', 1)), ''),
         c.origen,
         coalesce(rq.lista, '[]'::jsonb),
         coalesce(rv.ordenes, array[]::text[]),
         case when c.codigo_interno is not null then array[c.codigo_interno] else coalesce(rq.codigos, array[]::text[]) end,
         coalesce(rq.areas, rv.areas, array[]::text[]),
         c.proveedor, c.proveedor_id, c.moneda,
         case when c.aprobacion = 'RECHAZADA' then null else public.total_orden_compra(c.id) end,
         exists (select 1 from public.orden_compra_material_detalles x where x.orden_compra_id = c.id and x.precio_unitario is null),
         c.condicion_pago, c.dias_credito, c.con_factura,
         c.aprobacion, c.aprobado_en, c.motivo_rechazo,
         null::text, c.recojo, c.entregado_almacen_en, ig.ingreso,
         null::timestamptz, null::text,
         fd.facturado, coalesce(fd.completa or fd.facturado >= fd.total - 1, false),
         coalesce(fa.facturas, '[]'::jsonb), coalesce(pb.pagos, '[]'::jsonb), coalesce(dc.documentos, '[]'::jsonb),
         case when v_recojo then pr.peso_kg end, v_recojo and pr.posicion is not null,
         case when g.id is not null then jsonb_build_object('id', g.id, 'numero', g.numero, 'fecha', g.fecha_emision,
                                                             'nombre', g.nombre_archivo, 'cargada_en', g.cargada_en) end,
         coalesce(ga.n, 0),
         case
           when c.aprobacion = 'RECHAZADA' then 'NO_SE_PAGA'
           when c.aprobacion = 'POR_APROBAR' then 'ESPERA_APROBACION'
           when not c.con_factura and not c.pago_en_tesoreria then 'SIN_FACTURA'
           when not c.con_factura and coalesce(pb.cancela, false) then 'PAGADA'
           when not c.con_factura and coalesce(pb.n, 0) > 0 then 'PAGO_PARCIAL'
           -- La boleta que Contabilidad registró como comprobante se paga por ahí (y
           -- `registrar_pago_compra` ya no la deja pagar directo): sigue como factura.
           when not c.con_factura and coalesce(fa.registradas, 0) = 0 then 'POR_PAGAR'
           when coalesce(fa.registradas, 0) = 0 then 'POR_FACTURAR'
           when fa.pagadas and coalesce(fd.completa or fd.facturado >= fd.total - 1, false) then 'PAGADA'
           when fa.pagado > 0 then 'PAGO_PARCIAL'
           else 'POR_PAGAR'
         end
    from public.ordenes_compra_materiales c
    left join public.usuarios u on u.id = c.creado_por
    left join facturada fd on fd.orden_compra_id = c.id
    left join factura fa on fa.orden_compra_id = c.id
    left join public.programacion_recojo pr on pr.orden_compra_id = c.id
    left join public.guias_remision_compra g on g.orden_compra_id = c.id and g.anulada_en is null
    left join lateral (
      select count(*)::integer as n from public.guias_remision_compra a
       where a.orden_compra_id = c.id and a.anulada_en is not null
    ) ga on true
    -- El RQ nuevo (RQ-0001-2026): la OC lo atiende con alguna de sus líneas.
    left join lateral (
      select jsonb_agg(jsonb_build_object('id', x.id, 'numero', x.numero) order by x.numero) as lista,
             array_remove(array_agg(distinct x.codigo_interno), null) as codigos,
             nullif(array_remove(array_agg(distinct x.area), null), array[]::text[]) as areas
        from (select distinct r.id, r.numero, r.codigo_interno, ar.nombre as area
                from public.requerimiento_lineas rl
                join public.requerimientos r on r.id = rl.requerimiento_id
                left join public.areas ar on ar.id = r.area_id
               where rl.orden_compra_id = c.id) x
    ) rq on true
    -- El RQ de antes, por OT y área: en la cabecera o en cada línea.
    left join lateral (
      select array_remove(array_agg(distinct o.numero), null) as ordenes,
             nullif(array_remove(array_agg(distinct case rm.area_destino when 'MTZ' then 'Maestranza'
                                                     when 'PRD' then 'Producción' when 'ACB' then 'Acabados'
                                                     else rm.area_destino end), null), array[]::text[]) as areas
        from public.requerimientos_materiales rm
        left join public.ordenes_trabajo o on o.id = rm.orden_id
       where rm.id = c.requerimiento_id
          or rm.id in (select x.requerimiento_id from public.orden_compra_material_detalles x where x.orden_compra_id = c.id)
    ) rv on true
    left join lateral (
      select case when bool_or(i.estado = 'OBSERVADO') then 'OBSERVADO'
                  when bool_or(i.estado = 'PENDIENTE') then 'PENDIENTE'
                  when count(*) > 0 then 'VALIDADO' end as ingreso
        from public.ingresos_pendientes_almacen i where i.orden_compra_id = c.id
    ) ig on true
    left join lateral (
      select jsonb_agg(jsonb_build_object('id', d.id, 'tipo', d.tipo, 'nombre', d.nombre_archivo, 'ruta', d.ruta_storage,
                                          'numero', d.numero_documento, 'creado_en', d.creado_en, 'bucket', 'documentos-compras')
                       order by d.creado_en) as documentos
        from public.documentos_compra_material d where d.orden_compra_id = c.id
    ) dc on true
    -- El pago de la OC con boleta (sección 2).
    left join lateral (
      select count(*) as n, coalesce(bool_or(x.cancela), false) as cancela,
             jsonb_agg(jsonb_build_object('id', x.id, 'fecha', x.fecha_pago, 'monto', x.monto, 'moneda', x.moneda,
                                          'cancela', x.cancela, 'operacion', x.operacion,
                                          'comprobante', x.comprobante_proveedor, 'ruta', x.archivo_ruta, 'bucket', 'pagos-compras')
                       order by x.fecha_pago, x.creado_en) as pagos
        from public.pagos_orden_compra x
       where x.orden_compra_id = c.id and x.anulado_en is null
    ) pb on true

  union all

  select 'OS'::text, s.id, s.numero, s.referencia, s.descripcion, s.creado_en,
         nullif(btrim(split_part(coalesce(u.nombres, ''), ' ', 1) || ' ' || split_part(coalesce(u.apellidos, ''), ' ', 1)), ''),
         null::text, '[]'::jsonb,
         case when o.numero is not null then array[o.numero] else array[]::text[] end,
         case when s.codigo_interno is not null then array[s.codigo_interno] else array[]::text[] end,
         case when ar.nombre is not null then array[ar.nombre] else array[]::text[] end,
         s.proveedor, s.proveedor_id, s.moneda, round(s.monto * 1.18, 2), false,
         s.condicion_pago, s.dias_credito, null::boolean,
         s.aprobacion, s.aprobado_en, s.motivo_rechazo,
         s.estado, null::text, null::timestamptz, null::text,
         s.anulado_en, s.motivo_anulacion,
         null::numeric, null::boolean, '[]'::jsonb, coalesce(ps.pagos, '[]'::jsonb), coalesce(ds.documentos, '[]'::jsonb),
         null::numeric, false, null::jsonb, 0,
         case
           when s.estado = 'ANULADA' or s.aprobacion = 'RECHAZADA' then 'NO_SE_PAGA'
           when s.aprobacion = 'POR_APROBAR' then 'ESPERA_APROBACION'
           when ps.cancela then 'PAGADA'
           when ps.n > 0 then 'PAGO_PARCIAL'
           else 'POR_PAGAR'
         end
    from public.ordenes_servicio s
    left join public.usuarios u on u.id = s.creado_por
    left join public.ordenes_trabajo o on o.id = s.orden_id
    left join public.areas ar on ar.id = s.area_id
    left join lateral (
      select count(*) as n, coalesce(bool_or(x.cancela), false) as cancela,
             jsonb_agg(jsonb_build_object('id', x.id, 'fecha', x.fecha_pago, 'monto', x.monto, 'moneda', x.moneda,
                                          'cancela', x.cancela, 'operacion', x.operacion,
                                          'comprobante', x.comprobante_proveedor, 'ruta', x.archivo_ruta, 'bucket', 'pagos-servicio')
                       order by x.fecha_pago, x.creado_en) as pagos
        from public.pagos_orden_servicio x
       where x.orden_servicio_id = s.id and x.anulado_en is null
    ) ps on true
    -- Sus documentos vigentes (sección 5).
    left join lateral (
      select jsonb_agg(jsonb_build_object('id', d.id, 'tipo', d.tipo, 'nombre', d.nombre_archivo, 'ruta', d.ruta_storage,
                                          'numero', d.numero, 'creado_en', d.creado_en, 'bucket', 'documentos-servicio')
                       order by d.creado_en) as documentos
        from public.documentos_orden_servicio d where d.orden_servicio_id = s.id and d.anulado_en is null
    ) ds on true

   order by 6 desc, 2;
end;
$$;
comment on function public.trazabilidad_de_compras() is
  'Una fila por OC y por OS: de dónde salió (RQ, OT, código interno), el proveedor, el total impreso, la aprobación, en qué va, sus facturas y pagos con la ruta y el bucket de cada archivo, los PDF de Logística o de la OS y la guía de remisión. Exige adquisiciones.ver.';
revoke all on function public.trazabilidad_de_compras() from public, anon;
grant execute on function public.trazabilidad_de_compras() to authenticated;

-- 8. La auditoría de las tablas nuevas ------------------------------------------------------
-- La auditoría copia la fila entera a `audit_log`, que se lee con `auditoria.ver`:
-- sin esto, Supervisión general leería ahí cuánto se le pagó a cada proveedor, que
-- su política de `pagos_orden_compra` le esconde. Cada tabla, con lo mismo que su
-- política. Es la de 20261020171000 (que conserva la de 20261020165000) más estas
-- dos: quien vuelva a escribir esta política tiene que conservarlas.
alter policy ver_audit_log on public.audit_log using (
  public.es_admin() or (
    public.tiene_permiso('auditoria.ver')
    and (tabla <> all (array['cajas', 'movimientos_caja', 'cierres_caja'])
         or public.tiene_permiso('tesoreria.caja'))
    and (tabla <> all (array['trabajador_remuneraciones', 'trabajador_costos', 'tareos',
                             'trabajador_cuentas', 'trabajadores'])
         or public.tiene_permiso('rrhh.personal'))
    and (tabla <> 'usuario_datos_reservados'
         or public.tiene_permiso('rrhh.personal') or public.tiene_permiso('usuarios.gestionar'))
    -- La auditoría de `usuarios` de antes de la mudanza copió la fila entera,
    -- con el DNI y el costo. Esas filas no se reescriben (son evidencia): las
    -- que llevan alguno de los dos se ven solo con el mismo permiso que la
    -- tabla reservada. Las demás, y todas las de después, siguen a la vista.
    and (tabla <> 'usuarios'
         or public.tiene_permiso('rrhh.personal') or public.tiene_permiso('usuarios.gestionar')
         or (nullif(datos_antes ->> 'documento', '') is null
             and nullif(datos_despues ->> 'documento', '') is null
             and coalesce((datos_antes ->> 'costo_hora')::numeric, 0) = 0
             and coalesce((datos_despues ->> 'costo_hora')::numeric, 0) = 0))
    and (tabla <> all (array['planillas', 'planilla_personas', 'planilla_distribuciones'])
         or public.tiene_permiso('rrhh.ver_planillas'))
    and (tabla <> all (array['cotizaciones_pdf', 'cotizaciones_pdf_versiones', 'cotizaciones_pdf_igv',
                             'ot_presupuestos', 'ot_ventas_anteriores'])
         or public.tiene_permiso('cotizaciones.ver_pdf_comercial'))
    -- Cada tabla, con lo mismo que pide su política de lectura.
    and (tabla <> all (array['facturas_venta', 'cobros_factura_venta'])
         or public.tiene_permiso('contabilidad.facturar') or public.tiene_permiso('cotizaciones.ver_aprobadas')
         or public.tiene_permiso('tesoreria.ver_documentos'))
    and (tabla <> 'cuentas_cobrar_ot'
         or public.tiene_permiso('tesoreria.ver_documentos') or public.tiene_permiso('adquisiciones.ver'))
    and (tabla <> 'proveedor_cuentas' or public.tiene_permiso('proveedores.ver_cuentas'))
    and (tabla <> 'subcontratistas' or public.puede_ver_subcontratos())
    and (tabla <> all (array['planilla_diaria_personas', 'planilla_diaria_detalle'])
         or public.puede_ver_planilla_diaria())
    and (tabla <> 'programacion_recojo'
         or public.tiene_permiso('compras.programar_recojo') or public.tiene_permiso('compras.recojo'))
    and (tabla <> 'pagos_orden_compra'
         or public.tiene_permiso('tesoreria.registrar_pagos') or public.tiene_permiso('tesoreria.ver_documentos')
         or public.tiene_permiso('compras.crear') or public.tiene_permiso('adquisiciones.ver'))
    and (tabla <> 'documentos_orden_servicio'
         or public.tiene_permiso('tesoreria.pagar_servicios') or public.tiene_permiso('tesoreria.ver_documentos')
         or public.tiene_permiso('compras.crear') or public.tiene_permiso('compras.detraccion')
         or public.tiene_permiso('adquisiciones.ver'))
  )
);
