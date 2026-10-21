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
-- Las OC con boleta que Gerencia ya había aprobado antes de esta migración se
-- pagaron fuera del sistema y nadie anotó cuándo: no aparecen como deuda. Las
-- marca la columna nueva `pago_en_tesoreria`, falsa solo para ellas. Si una no
-- se pagó, Tesorería la pasa a su lista desde Adquisiciones.
--
-- Una OC se paga por un solo camino: la que trae factura (registrada, en
-- borrador o anexada por Logística) no se paga directo, y a la que Tesorería ya
-- le pagó directo Contabilidad no le registra un comprobante hasta que ese pago
-- se anule. Con un pago vigente, la OC tampoco cambia su total. Si la factura
-- llega a una OC ya pagada, Tesorería recibe el aviso para anular su pago; una
-- factura anexada que se registró para otra OC no le cierra el pago directo.
--
-- La OS no guardaba su factura: solo el número que Tesorería anotaba al pagar.
-- Desde aquí guarda sus documentos —la factura, la boleta o el recibo del
-- proveedor, y el contrato— en una sola tabla, acordada con el hilo que suma el
-- contrato de la OS. Los adjuntan Logística, que emitió la OS, y Tesorería, si
-- el proveedor se la manda a ella. Nada lleva monto: el documento dice cuánto.
--
-- Idempotente. Sin `drop` de funciones ni de políticas: el conector de
-- producción no los deja pasar. `drop constraint` sí pasa.
-- =============================================================================

-- 1. ¿Su pago lo registra Tesorería? ------------------------------------------------
-- Solo cuenta para la OC con boleta: la que va con factura se paga por su factura.
-- Quedan en falso las que iban con boleta y Gerencia ya había aprobado: esas se
-- pagaron fuera. Las que esperaban su aprobación, las rechazadas y las que van
-- con factura, en verdadero, como las nuevas: nadie las pagó fuera del sistema.
-- La marca se pone una sola vez, al crear la columna, con los disparadores de la
-- OC apagados: no es un cambio de la OC y no deja bitácora ni sello de edición.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'ordenes_compra_materiales' and column_name = 'pago_en_tesoreria') then
    alter table public.ordenes_compra_materiales add column pago_en_tesoreria boolean not null default true;
    alter table public.ordenes_compra_materiales disable trigger user;
    update public.ordenes_compra_materiales set pago_en_tesoreria = false
     where not con_factura and aprobacion in ('APROBADA', 'NO_REQUERIDA');
    alter table public.ordenes_compra_materiales enable trigger user;
  end if;
end $$;
comment on column public.ordenes_compra_materiales.pago_en_tesoreria is
  'La OC con boleta la paga Tesorería en el sistema (migración 20261020210000). Falso en las que Gerencia ya había aprobado con boleta: se pagaron fuera. Si una no se pagó, Tesorería la pasa a verdadero (pasar_compra_a_tesoreria).';

-- 2. El pago de una OC con boleta -----------------------------------------------------
-- Calcado del pago de la OS: uno o varios pagos, cada uno con su voucher, y quien
-- paga dice si con ese pago la OC queda cancelada. El que completa el total la
-- cancela solo.
-- La OC está pagada mientras sus pagos vigentes sumen el total, o mientras siga
-- vigente uno con el que Tesorería la dio por cancelada sin llegar al total
-- (`cancela_sin_completar`). `cancela` dice solo qué pasó al registrarlo: si se
-- anula otro pago, la cuenta se rehace y la OC vuelve a deber lo que falta.
create table if not exists public.pagos_orden_compra (
  id                    uuid primary key default gen_random_uuid(),
  orden_compra_id       uuid not null references public.ordenes_compra_materiales(id) on delete restrict,
  fecha_pago            date not null,
  moneda                text not null,
  monto                 numeric(14, 2) not null,
  cancela               boolean not null default true,
  cancela_sin_completar boolean not null default false,
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
-- La base que ya tenía la tabla de una versión anterior de esta migración.
alter table public.pagos_orden_compra add column if not exists cancela_sin_completar boolean not null default false;
comment on table public.pagos_orden_compra is
  'Un pago de Tesorería a una OC con boleta, nota de venta o recibo, con su voucher. No se borra: se anula.';
comment on column public.pagos_orden_compra.cancela_sin_completar is
  'Tesorería dio la OC por cancelada con este pago sin que sus pagos llegaran al total. Mientras siga vigente, la OC está pagada.';
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
-- pago quedaría colgado de una OC que se paga por otro camino. Y quién registra
-- su pago solo cambia de falso a verdadero, por `pasar_compra_a_tesoreria`: la
-- OC de antes que no se pagó. Un disparador propio, sin tocar los de la OC.
create or replace function public.fn_compra_pagada_no_cambia()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.pago_en_tesoreria is distinct from old.pago_en_tesoreria
     and (old.pago_en_tesoreria or current_setting('metalwork.compra_a_tesoreria', true) is distinct from new.id::text) then
    raise exception 'Quién registra el pago de la OC no se cambia aquí: la de antes que no se pagó la pasa Tesorería desde Adquisiciones.'
      using errcode = 'check_violation';
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

-- Y su total tampoco: la OC es el documento que se paga, y una corrección de
-- cantidad o precio después del pago dejaba «Pagada» una OC con deuda, o pagada
-- de más sin aviso. Lo que no toca el total (la recepción, el vínculo al RQ)
-- sigue libre. Un disparador propio en las líneas, sin lista de columnas.
create or replace function public.fn_compra_pagada_total_fijo()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_compras uuid[];
  v_nombre  text;
begin
  if tg_op = 'UPDATE' and (new.orden_compra_id, new.cantidad, new.precio_unitario)
                          is not distinct from (old.orden_compra_id, old.cantidad, old.precio_unitario) then
    return new;
  end if;
  v_compras := case tg_op when 'INSERT' then array[new.orden_compra_id]
                          when 'DELETE' then array[old.orden_compra_id]
                          else array[new.orden_compra_id, old.orden_compra_id] end;
  select coalesce(c.numero, 'OC ' || c.referencia) into v_nombre
    from public.ordenes_compra_materiales c
   where c.id = any(v_compras)
     and exists (select 1 from public.pagos_orden_compra p where p.orden_compra_id = c.id and p.anulado_en is null)
   limit 1;
  if v_nombre is not null then
    raise exception 'Tesorería ya le registró un pago a la %: su total no cambia. Si hay que corregir cantidades o precios, Tesorería anula antes ese pago.',
      v_nombre using errcode = 'check_violation';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function public.fn_compra_pagada_total_fijo() from public, anon, authenticated;
create or replace trigger trg_compra_pagada_total_fijo
  before insert or update or delete on public.orden_compra_material_detalles
  for each row execute function public.fn_compra_pagada_total_fijo();

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
-- ¿Contabilidad ya registró la factura que Logística anexó a una OC? Sí, si la
-- eligió al registrar (su PDF), o si registró una con el mismo número —escrito
-- con o sin ceros— del mismo proveedor y la ligó a alguna OC: a otra, porque la
-- anexada era de esa, o a esta y una corrección la sacó. La que registró sin
-- ninguna OC no cuenta: la OC con boleta no le sale a Contabilidad entre las
-- casillas, y si contara, Tesorería pagaba la OC directo y la factura encima
-- (la cuarta auditoría lo cobró dos veces en la caja). La regla es la de
-- `facturasDeLogistica`, que la lee de aquí.
create or replace function public.factura_anexada_registrada(p_documento uuid)
returns boolean language sql stable set search_path to 'public' as $$
  select coalesce((
    select exists (select 1 from public.adquisiciones a where a.documento_compra_id = d.id)
        or exists (select 1 from public.adquisiciones a
                    where upper(btrim(a.proveedor)) = upper(btrim(c.proveedor))
                      and (a.numero_documento = d.numero_documento
                           or public.normalizar_numero_factura(a.numero_documento) = public.normalizar_numero_factura(d.numero_documento))
                      and (a.orden_compra_id is not null
                           or exists (select 1 from public.adquisiciones_ordenes_compra l
                                       where l.adquisicion_id = a.id
                                         and (l.quitada_en is null or l.orden_compra_id = d.orden_compra_id))))
      from public.documentos_compra_material d
      join public.ordenes_compra_materiales c on c.id = d.orden_compra_id
     where d.id = p_documento), false);
$$;
comment on function public.factura_anexada_registrada(uuid) is
  'Si Contabilidad ya registró la factura que Logística anexó: por su PDF, o por su número y proveedor en un comprobante ligado a alguna OC. Corre con los permisos de quien la llama.';
revoke all on function public.factura_anexada_registrada(uuid) from public, anon;
grant execute on function public.factura_anexada_registrada(uuid) to authenticated;

-- Las mismas, de a muchas: el desplegable «Factura que anexó Logística» de
-- Adquisiciones ofrece las que no están aquí. Con los permisos de quien la llama.
-- Devuelve una columna con nombre, como las demás de la casa: la aplicación lee
-- `documento` de cada fila, igual en Supabase que en el banco.
create or replace function public.facturas_anexadas_registradas(p_documentos uuid[])
returns table (documento uuid) language sql stable set search_path to 'public' as $$
  select x.id from unnest(p_documentos) as x(id) where public.factura_anexada_registrada(x.id);
$$;
revoke all on function public.facturas_anexadas_registradas(uuid[]) from public, anon;
grant execute on function public.facturas_anexadas_registradas(uuid[]) to authenticated;

-- El comprobante que el proveedor de una OC con boleta ya entregó y que todavía
-- se va a registrar para ella: el que Contabilidad tiene en borrador ligado a la
-- OC (por su cabecera o por un vínculo vigente), o la factura que Logística le
-- anexó y que nadie registró (`factura_anexada_registrada`). Una factura anexada
-- que ya se registró para otra OC, o de la que una corrección sacó a esta, no
-- cuenta: si contara, la OC quedaría sin camino de pago. La usan la lista de
-- Tesorería, el pago directo, Adquisiciones y el aviso a Tesorería. Da una fila
-- o ninguna, y lo dice (`rows 1`): sin eso el planificador esperaba mil por OC,
-- y la lista de Tesorería pasaba de 9 ms a casi un segundo compilando con JIT.
create or replace function public.comprobante_en_camino(p_compra uuid)
returns table (numero text, origen text, bucket text, ruta text, documento_id uuid)
language sql stable security definer rows 1 set search_path to 'public' as $$
  select x.numero, x.origen, x.bucket, x.ruta, x.documento_id from (
    (select a.numero_documento as numero, 'BORRADOR'::text as origen,
            case when a.ruta_storage is not null then 'comprobantes-financieros'
                 when d.ruta_storage is not null then 'documentos-compras' end as bucket,
            coalesce(a.ruta_storage, d.ruta_storage) as ruta, a.documento_compra_id as documento_id, 1 as prioridad
       from public.adquisiciones a
       left join public.documentos_compra_material d on d.id = a.documento_compra_id
      where a.estado = 'BORRADOR'
        and (a.orden_compra_id = p_compra
             or exists (select 1 from public.adquisiciones_ordenes_compra l
                         where l.adquisicion_id = a.id and l.orden_compra_id = p_compra and l.quitada_en is null))
      order by a.creado_en limit 1)
    union all
    (select coalesce(d.numero_documento, d.nombre_archivo), 'LOGISTICA', 'documentos-compras', d.ruta_storage, d.id, 2
       from public.documentos_compra_material d
      where d.orden_compra_id = p_compra and d.tipo = 'FACTURA'
        and not public.factura_anexada_registrada(d.id)
      order by d.creado_en limit 1)
  ) x
  order by x.prioridad
  limit 1;
$$;
comment on function public.comprobante_en_camino(uuid) is
  'El comprobante que el proveedor de la OC con boleta entregó y que todavía se registra para ella (borrador de Contabilidad o factura de Logística sin registrar). Ayudante interno de las funciones de Tesorería y Adquisiciones.';
revoke all on function public.comprobante_en_camino(uuid) from public, anon, authenticated;

-- Aprobadas (o sin aprobación que pedir), con su total, lo pagado y su
-- vencimiento: todas las que faltan, las canceladas que trajeron después su
-- comprobante (Tesorería tiene que anular su pago) y las 60 últimas canceladas.
-- Primero las que piden algo a Tesorería: las pagadas a las que llegó su
-- comprobante, que si no quedaban al fondo, detrás de todas las por pagar.
create or replace function public.compras_con_boleta_por_pagar()
returns table (
  id uuid, numero text, referencia text, proveedor_id uuid, proveedor text, proveedor_documento text,
  codigo_interno text, moneda text, total numeric, sin_precio boolean, condicion_pago text, dias_credito integer,
  creado_en timestamptz, vence date, recojo text, pagado numeric, cancelada boolean, ultimo_pago date,
  comprobante_en_camino text, comprobante_en_camino_origen text, comprobante_en_camino_bucket text,
  comprobante_en_camino_ruta text, estuvo_en_factura text
) language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  if not (public.es_admin() or public.tiene_permiso('tesoreria.registrar_pagos') or public.tiene_permiso('tesoreria.ver_documentos')) then
    raise exception 'Las OC con boleta las paga Tesorería.' using errcode = 'insufficient_privilege';
  end if;
  return query
  with filas as (
    select c.id, c.numero, c.referencia, c.proveedor_id, c.proveedor, p.numero_documento as ruc, c.codigo_interno, c.moneda,
           t.total,
           exists (select 1 from public.orden_compra_material_detalles d where d.orden_compra_id = c.id and d.precio_unitario is null) as sin_precio,
           c.condicion_pago, c.dias_credito, c.creado_en,
           ((c.creado_en at time zone 'America/Lima')::date + coalesce(c.dias_credito, 0)) as vence,
           c.recojo, coalesce(g.pagado, 0)::numeric(14, 2) as pagado,
           -- Pagada: sus pagos vigentes suman el total, o uno vigente la dio por cancelada (sección 2).
           coalesce(g.n > 0 and (g.sin_completar or g.pagado >= t.total), false) as cancelada, g.ultimo,
           -- El proveedor entregó su comprobante: se paga por él, no aquí.
           e.numero as en_camino, e.origen as en_camino_origen, e.bucket as en_camino_bucket, e.ruta as en_camino_ruta,
           -- Una factura ya pagada la cubría y una corrección se la quitó: que Tesorería lo vea antes de pagarla.
           (select a.numero_documento from public.adquisiciones a
              join public.adquisiciones_ordenes_compra l on l.adquisicion_id = a.id
             where l.orden_compra_id = c.id and l.quitada_en is not null and a.estado = 'REGISTRADA'
               and exists (select 1 from public.pagos_adquisicion x where x.adquisicion_id = a.id and x.anulado_en is null)
             order by a.fecha_emision desc limit 1) as estuvo_en
      from public.ordenes_compra_materiales c
      left join public.proveedores p on p.id = c.proveedor_id
      cross join lateral (select public.total_orden_compra(c.id) as total) t
      left join lateral (
        select count(*) as n, sum(x.monto) as pagado, coalesce(bool_or(x.cancela_sin_completar), false) as sin_completar,
               max(x.fecha_pago) as ultimo
          from public.pagos_orden_compra x where x.orden_compra_id = c.id and x.anulado_en is null
      ) g on true
      left join lateral public.comprobante_en_camino(c.id) e on true
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
           f.condicion_pago, f.dias_credito, f.creado_en, f.vence, f.recojo, f.pagado, f.cancelada, f.ultimo,
           f.en_camino, f.en_camino_origen, f.en_camino_bucket, f.en_camino_ruta, f.estuvo_en
      from filas f where not f.cancelada or f.en_camino is not null
    union all
    (select f.id, f.numero, f.referencia, f.proveedor_id, f.proveedor, f.ruc, f.codigo_interno, f.moneda, f.total, f.sin_precio,
            f.condicion_pago, f.dias_credito, f.creado_en, f.vence, f.recojo, f.pagado, f.cancelada, f.ultimo,
            f.en_camino, f.en_camino_origen, f.en_camino_bucket, f.en_camino_ruta, f.estuvo_en
       from filas f where f.cancelada and f.en_camino is null order by f.ultimo desc nulls last, f.creado_en desc limit 60)
  ) x
  order by (x.en_camino is not null and x.pagado > 0) desc, x.cancelada, x.vence, x.creado_en;
end;
$$;
comment on function public.compras_con_boleta_por_pagar() is
  'Las OC con boleta aprobadas que Tesorería paga: las que faltan, las canceladas que trajeron después su comprobante y las 60 últimas canceladas, con el comprobante que el proveedor ya entregó (se paga por él) y la factura pagada que la cubría antes de una corrección. Exige tesoreria.registrar_pagos o tesoreria.ver_documentos.';
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
  v_sin_completar boolean;
  v_cancela boolean;
  v_fact    text;
  v_origen  text;
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
  -- Ni si el proveedor entregó su comprobante y todavía no se registra: se paga por él.
  select e.numero, e.origen into v_fact, v_origen from public.comprobante_en_camino(p_orden_compra) e;
  if v_origen = 'BORRADOR' then
    raise exception 'Contabilidad tiene en borrador el comprobante % de la %: se paga por él en Cuentas por pagar cuando lo registre.', v_fact, v_nombre
      using errcode = 'check_violation';
  elsif v_origen = 'LOGISTICA' then
    raise exception 'Logística anexó a la % la factura % del proveedor: Contabilidad la registra y se paga por ella en Cuentas por pagar.', v_nombre, v_fact
      using errcode = 'check_violation';
  end if;
  -- Pagada: sus pagos vigentes suman el total, o uno vigente la dio por cancelada (sección 2).
  v_total := public.total_orden_compra(p_orden_compra);
  select coalesce(sum(monto), 0), coalesce(bool_or(cancela_sin_completar), false) into v_pagado, v_sin_completar
    from public.pagos_orden_compra
   where orden_compra_id = p_orden_compra and anulado_en is null;
  if v_sin_completar or (v_pagado > 0 and v_pagado >= v_total) then
    raise exception 'La % ya está pagada.', v_nombre using errcode = 'check_violation';
  end if;
  if p_fecha_pago is null or p_fecha_pago > v_hoy or p_fecha_pago < v_hoy - 365 then
    raise exception 'Elige el día del pago: de hoy hacia atrás.' using errcode = 'check_violation';
  end if;
  if p_monto is null or p_monto <= 0 or p_monto > 999999999 or p_monto <> round(p_monto, 2) then
    raise exception 'Escribe lo que se pagó, en dos decimales.' using errcode = 'check_violation';
  end if;
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

  insert into public.pagos_orden_compra (id, orden_compra_id, fecha_pago, moneda, monto, cancela, cancela_sin_completar,
                                         operacion, comprobante_proveedor, archivo_ruta, archivo_mime, archivo_tamano, registrado_por)
  values (p_id, p_orden_compra, p_fecha_pago, v_oc.moneda, p_monto, v_cancela,
          coalesce(p_cancela, false) and v_pagado + p_monto < v_total,
          v_op, v_comp, p_ruta, v_obj.metadata->>'mimetype', (v_obj.metadata->>'size')::integer, v_yo);

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

-- Cómo queda el pago de una OC después de anular uno de sus pagos o de anexarle
-- su factura: el comprobante en camino, cuántos pagos directos siguen vigentes,
-- si está pagada y lo que le falta. Con ella el aviso que lee Tesorería, o
-- Logística, dice lo que la base va a dejar hacer (sin traer la lista entera).
-- La ven quien paga, quien consulta Tesorería y Logística, que emitió la OC: los
-- mismos que leen sus pagos.
create or replace function public.situacion_de_pago_de_compra(p_compra uuid)
returns table (en_camino text, en_camino_origen text, pagos_vigentes integer, cancelada boolean, saldo numeric, moneda text)
language plpgsql stable security definer rows 1 set search_path to 'public' as $$
#variable_conflict use_column
begin
  if not (public.es_admin() or public.tiene_permiso('tesoreria.registrar_pagos') or public.tiene_permiso('tesoreria.ver_documentos')
          or public.tiene_permiso('compras.crear')) then
    raise exception 'El pago de la OC lo ven Tesorería y Logística.' using errcode = 'insufficient_privilege';
  end if;
  return query
  select e.numero, e.origen, g.n::integer,
         coalesce(g.n > 0 and (g.sin_completar or g.pagado >= t.total), false),
         greatest(t.total - coalesce(g.pagado, 0), 0)::numeric(14, 2), c.moneda
    from public.ordenes_compra_materiales c
    cross join lateral (select public.total_orden_compra(c.id) as total) t
    cross join lateral (
      select count(*) as n, sum(x.monto) as pagado, coalesce(bool_or(x.cancela_sin_completar), false) as sin_completar
        from public.pagos_orden_compra x where x.orden_compra_id = c.id and x.anulado_en is null
    ) g
    left join lateral public.comprobante_en_camino(c.id) e on true
   where c.id = p_compra;
end;
$$;
comment on function public.situacion_de_pago_de_compra(uuid) is
  'El pago de una OC: su comprobante en camino, los pagos directos vigentes, si está pagada y su saldo. Exige tesoreria.registrar_pagos, tesoreria.ver_documentos o compras.crear.';
revoke all on function public.situacion_de_pago_de_compra(uuid) from public, anon;
grant execute on function public.situacion_de_pago_de_compra(uuid) to authenticated;

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

-- 6. Una OC, un solo camino de pago ---------------------------------------------------------
-- `registrar_pago_compra` no paga directo la OC que ya trae factura (registrada,
-- en borrador o anexada por Logística). Esto cierra el otro lado: a la OC que Tesorería ya pagó directo no
-- se le liga una factura, ni se registra la factura que ya la tenía ligada, ni
-- se le devuelve en una corrección, ni se le paga una factura encima, mientras
-- ese pago siga vigente. Si el proveedor entregó factura, Tesorería anula el
-- pago y se paga por la factura. Los disparadores van sin lista de columnas:
-- `update of` mira el SET de la sentencia, no lo que cambió (skill esquema).
-- Las OC se toman «for share»: un pago que esté entrando a la misma OC (la toma
-- «for update») termina antes, y esta consulta ya lo ve.
create or replace function public.compra_pagada_directo(p_compras uuid[])
returns text language plpgsql security definer set search_path to 'public' as $$
declare v_nombre text;
begin
  perform 1 from public.ordenes_compra_materiales where id = any(p_compras) order by id for share;
  select coalesce(c.numero, 'OC ' || c.referencia) into v_nombre
    from public.ordenes_compra_materiales c
   where c.id = any(p_compras)
     and exists (select 1 from public.pagos_orden_compra p where p.orden_compra_id = c.id and p.anulado_en is null)
   order by c.numero
   limit 1;
  return v_nombre;
end;
$$;
comment on function public.compra_pagada_directo(uuid[]) is
  'La primera de esas OC que tiene un pago directo de Tesorería vigente, o null. La usan los disparadores de Adquisiciones.';
revoke all on function public.compra_pagada_directo(uuid[]) from public, anon, authenticated;

create or replace function public.fn_factura_sin_pago_directo()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_compras uuid[];
  v_nombre  text;
begin
  if tg_table_name = 'adquisiciones_ordenes_compra' then
    -- Al ligar la OC, al devolverla en una corrección o al cambiarla por otra.
    if new.quitada_en is not null
       or (tg_op = 'UPDATE' and old.quitada_en is null
           and new.orden_compra_id is not distinct from old.orden_compra_id
           and new.adquisicion_id is not distinct from old.adquisicion_id) then
      return new;
    end if;
    v_compras := array[new.orden_compra_id];
  elsif tg_table_name = 'pagos_adquisicion' then
    -- Al pagar la factura: las OC que cubre.
    if new.anulado_en is not null then return new; end if;
    select coalesce(array_agg(l.orden_compra_id), '{}') into v_compras
      from public.adquisiciones_ordenes_compra l where l.adquisicion_id = new.adquisicion_id and l.quitada_en is null;
    v_compras := v_compras || coalesce((select array[a.orden_compra_id] from public.adquisiciones a
                                          where a.id = new.adquisicion_id and a.orden_compra_id is not null), '{}');
  else
    if new.estado <> 'REGISTRADA' then return new; end if;
    if tg_op = 'UPDATE' and old.estado = 'REGISTRADA' then
      -- Ya registrada: solo cuenta la OC de la cabecera, si cambió.
      if new.orden_compra_id is not distinct from old.orden_compra_id or new.orden_compra_id is null then return new; end if;
      v_compras := array[new.orden_compra_id];
    else
      -- Al registrar la factura: las OC que ya tiene ligadas.
      select coalesce(array_agg(l.orden_compra_id), '{}') into v_compras
        from public.adquisiciones_ordenes_compra l where l.adquisicion_id = new.id and l.quitada_en is null;
      if new.orden_compra_id is not null then v_compras := v_compras || new.orden_compra_id; end if;
    end if;
  end if;
  v_nombre := public.compra_pagada_directo(v_compras);
  if v_nombre is not null and tg_table_name = 'pagos_adquisicion' then
    raise exception 'Tesorería ya le pagó la % directo, por su boleta: esta factura no se paga encima. Si el proveedor entregó factura, primero se anula ese pago.',
      v_nombre using errcode = 'check_violation';
  elsif v_nombre is not null then
    raise exception 'Tesorería ya le pagó la % directo, por su boleta: si el proveedor entregó factura, Tesorería anula ese pago antes de que la factura se registre aquí. Dos caminos son dos pagos.',
      v_nombre using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_factura_sin_pago_directo() from public, anon, authenticated;
create or replace trigger trg_adquisicion_oc_sin_pago_directo
  before insert or update on public.adquisiciones_ordenes_compra
  for each row execute function public.fn_factura_sin_pago_directo();
create or replace trigger trg_adquisicion_sin_pago_directo
  before insert or update on public.adquisiciones
  for each row execute function public.fn_factura_sin_pago_directo();
create or replace trigger trg_pago_factura_sin_pago_directo
  before insert on public.pagos_adquisicion
  for each row execute function public.fn_factura_sin_pago_directo();

-- La OC con boleta de antes que no se pagó: Tesorería la pasa a su lista y se
-- paga como las de ahora. Solo de falso a verdadero, y no la que ya tiene
-- comprobante registrado (se paga por ahí). Quién y cuándo quedan en la auditoría.
create or replace function public.pasar_compra_a_tesoreria(p_compra uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_oc     public.ordenes_compra_materiales%rowtype;
  v_nombre text;
  v_fact   text;
begin
  perform public.exigir_permiso('tesoreria.registrar_pagos');
  select * into v_oc from public.ordenes_compra_materiales where id = p_compra for update;
  if not found then raise exception 'Esa orden de compra no existe.' using errcode = 'check_violation'; end if;
  v_nombre := coalesce(v_oc.numero, 'OC ' || v_oc.referencia);
  if v_oc.con_factura then
    raise exception 'La % va con factura: se paga por su factura en Cuentas por pagar.', v_nombre using errcode = 'check_violation';
  end if;
  if v_oc.pago_en_tesoreria then return p_compra; end if;
  select a.numero_documento into v_fact
    from public.adquisiciones a
   where a.estado = 'REGISTRADA'
     and (a.orden_compra_id = p_compra
          or exists (select 1 from public.adquisiciones_ordenes_compra l
                      where l.adquisicion_id = a.id and l.orden_compra_id = p_compra and l.quitada_en is null))
   limit 1;
  if v_fact is not null then
    raise exception 'Contabilidad ya registró el comprobante % de la %: se paga en Cuentas por pagar.', v_fact, v_nombre
      using errcode = 'check_violation';
  end if;
  perform set_config('metalwork.compra_a_tesoreria', p_compra::text, true);
  update public.ordenes_compra_materiales set pago_en_tesoreria = true where id = p_compra;
  perform set_config('metalwork.compra_a_tesoreria', '', true);
  return p_compra;
end;
$$;
comment on function public.pasar_compra_a_tesoreria(uuid) is
  'La OC con boleta de antes de la migración 20261020210000 que no se pagó pasa a la lista de Tesorería. Exige tesoreria.registrar_pagos.';
revoke all on function public.pasar_compra_a_tesoreria(uuid) from public, anon;
grant execute on function public.pasar_compra_a_tesoreria(uuid) to authenticated;

-- La factura que Logística anexó a una OC con boleta se registra eligiéndola en
-- «Factura que anexó Logística», que la liga a su OC. Registrada a mano con su
-- número y su proveedor, quedaba sin OC (la OC con boleta no sale entre las
-- casillas de Contabilidad), y no se podía ligar después: la OC no la cubría y
-- la cuarta auditoría la pagó dos veces. Se ataja al darla de alta y al
-- registrarla; una corrección de la ya registrada sigue su propio camino.
create or replace function public.fn_factura_anexada_con_su_oc()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v record;
begin
  if tg_op = 'UPDATE' and not (old.estado = 'BORRADOR'
                               and (new.estado, new.numero_documento, new.proveedor, new.documento_compra_id, new.orden_compra_id)
                                   is distinct from (old.estado, old.numero_documento, old.proveedor, old.documento_compra_id, old.orden_compra_id)) then
    return new;
  end if;
  if new.orden_compra_id is not null
     or exists (select 1 from public.adquisiciones_ordenes_compra l where l.adquisicion_id = new.id and l.quitada_en is null) then
    return new;
  end if;
  select d.numero_documento, coalesce(c.numero, 'OC ' || c.referencia) as compra,
         public.factura_anexada_registrada(d.id) as registrada into v
    from public.documentos_compra_material d
    join public.ordenes_compra_materiales c on c.id = d.orden_compra_id
   where d.tipo = 'FACTURA' and not c.con_factura
     and d.id is distinct from new.documento_compra_id
     and upper(btrim(c.proveedor)) = upper(btrim(new.proveedor))
     and (d.numero_documento = new.numero_documento
          or public.normalizar_numero_factura(d.numero_documento) = public.normalizar_numero_factura(new.numero_documento))
     and not exists (select 1 from public.adquisiciones a where a.documento_compra_id = d.id and a.id <> new.id)
   order by d.creado_en
   limit 1;
  if found and v.registrada then
    raise exception 'La factura % de ese proveedor ya está registrada en Adquisiciones.', v.numero_documento using errcode = 'unique_violation';
  elsif found then
    raise exception 'Logística anexó la factura % a la %: elígela en «Factura que anexó Logística» para que quede ligada a su OC.',
      v.numero_documento, v.compra using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_factura_anexada_con_su_oc() from public, anon, authenticated;
create or replace trigger trg_adquisicion_factura_anexada_con_su_oc
  before insert or update on public.adquisiciones
  for each row execute function public.fn_factura_anexada_con_su_oc();

-- La factura que llega a una OC que Tesorería ya pagó directo no se puede
-- registrar hasta que ese pago se anule, y la tarjeta que lo dice está en
-- Cuentas por pagar: sin aviso, Contabilidad choca con el rechazo y nadie se
-- entera. Le llega a quien paga cuando Logística la anexa, y también cuando una
-- corrección en Adquisiciones devuelve a la OC una factura que ya no la cubría
-- (cambió el número, el proveedor o las OC de la factura registrada). Uno por
-- persona: si todavía tiene sin leer el mismo aviso de esa OC, no se repite.
create or replace function public.avisar_pago_por_anular(p_compras uuid[])
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_oc     record;
  v_e      record;
  v_n      integer;
  v_lo     text;
  v_titulo text;
  v_cuerpo text;
begin
  for v_oc in select c.id, coalesce(c.numero, 'OC ' || c.referencia) as nombre
                from public.ordenes_compra_materiales c
               where c.id = any(p_compras) and not c.con_factura loop
    select count(*) into v_n from public.pagos_orden_compra p where p.orden_compra_id = v_oc.id and p.anulado_en is null;
    continue when v_n = 0;
    select e.numero, e.origen into v_e from public.comprobante_en_camino(v_oc.id) e;
    continue when not found;
    v_lo := case when v_e.origen = 'LOGISTICA' then 'la' else 'lo' end;
    v_titulo := 'Llegó factura de una OC pagada: ' || v_oc.nombre;
    v_cuerpo := case when v_e.origen = 'LOGISTICA' then 'El proveedor entregó la factura ' || v_e.numero
                     else 'Contabilidad tiene en borrador el comprobante ' || v_e.numero end
             || ' de la ' || v_oc.nombre || ', que ya pagaste por su boleta. '
             || case when v_n = 1 then 'Anula ese pago' else 'Anula esos ' || v_n || ' pagos' end
             || ' en Cuentas por pagar para que Contabilidad ' || v_lo || ' registre; después se paga por '
             || case when v_e.origen = 'LOGISTICA' then 'la factura.' else 'el comprobante.' end;
    insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
    select u.id, v_titulo, v_cuerpo, '/tesoreria/por-pagar#compra-' || v_oc.id, 'ordenes_compra_materiales', v_oc.id
      from public.usuarios u
      join public.roles_permisos rp on rp.rol_id = u.rol_id and rp.permiso_codigo = 'tesoreria.registrar_pagos'
     where u.activo and u.id is distinct from public.usuario_actual()
       and not exists (select 1 from public.notificaciones n
                        where n.usuario_id = u.id and n.origen_id = v_oc.id and n.titulo = v_titulo and n.leida_en is null);
  end loop;
end;
$$;
comment on function public.avisar_pago_por_anular(uuid[]) is
  'Avisa a Tesorería de cada OC con boleta de la lista que tiene un pago directo vigente y su comprobante en camino: tiene que anular ese pago. Ayudante interno de los disparadores.';
revoke all on function public.avisar_pago_por_anular(uuid[]) from public, anon, authenticated;

-- Las OC que pueden haber vuelto a tener su factura en camino: la del documento
-- que Logística anexa; y, al corregir una factura registrada, las OC con boleta
-- a las que Logística anexó una factura con su número y su proveedor de antes, y
-- las OC que la corrección le quitó.
create or replace function public.fn_aviso_factura_de_compra_pagada()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_compras   uuid[];
  v_numero    text;
  v_proveedor text;
begin
  if tg_table_name = 'documentos_compra_material' then
    if new.tipo = 'FACTURA' then perform public.avisar_pago_por_anular(array[new.orden_compra_id]); end if;
    return null;
  elsif tg_table_name = 'adquisiciones' then
    if (new.numero_documento, new.proveedor, new.documento_compra_id, new.orden_compra_id)
       is not distinct from (old.numero_documento, old.proveedor, old.documento_compra_id, old.orden_compra_id) then
      return null;
    end if;
    v_numero := old.numero_documento;
    v_proveedor := old.proveedor;
    v_compras := array_remove(array[old.orden_compra_id,
                                    (select d.orden_compra_id from public.documentos_compra_material d where d.id = old.documento_compra_id)], null);
  else
    if old.quitada_en is not null
       or (new.quitada_en is null and new.orden_compra_id is not distinct from old.orden_compra_id) then
      return null;
    end if;
    select a.numero_documento, a.proveedor into v_numero, v_proveedor from public.adquisiciones a where a.id = old.adquisicion_id;
    v_compras := array[old.orden_compra_id];
  end if;
  v_compras := v_compras || coalesce((
    select array_agg(distinct d.orden_compra_id)
      from public.documentos_compra_material d
      join public.ordenes_compra_materiales c on c.id = d.orden_compra_id
     where d.tipo = 'FACTURA' and not c.con_factura
       and upper(btrim(c.proveedor)) = upper(btrim(v_proveedor))
       and (d.numero_documento = v_numero
            or public.normalizar_numero_factura(d.numero_documento) = public.normalizar_numero_factura(v_numero))), '{}');
  perform public.avisar_pago_por_anular(v_compras);
  return null;
end;
$$;
revoke all on function public.fn_aviso_factura_de_compra_pagada() from public, anon, authenticated;
create or replace trigger trg_aviso_factura_de_compra_pagada
  after insert on public.documentos_compra_material
  for each row execute function public.fn_aviso_factura_de_compra_pagada();
create or replace trigger trg_aviso_pago_por_anular_adquisicion
  after update on public.adquisiciones
  for each row execute function public.fn_aviso_factura_de_compra_pagada();
create or replace trigger trg_aviso_pago_por_anular_vinculo
  after update on public.adquisiciones_ordenes_compra
  for each row execute function public.fn_aviso_factura_de_compra_pagada();

-- 7. Adquisiciones: el pago de la boleta y los documentos de la OS -------------------------
-- La misma firma de la 20261020170000. Cambia:
--   · la OC con boleta que paga Tesorería sale POR_PAGAR, PAGO_PARCIAL o PAGADA
--     con sus pagos; SIN_FACTURA queda para las de antes, pagadas fuera; la que
--     trae su comprobante espera que se registre (POR_FACTURAR) y, si ya tenía
--     un pago directo, PAGO_POR_ANULAR: Tesorería anula ese pago primero.
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
           -- La de antes se pagó fuera, salvo que el proveedor entregara factura: esa se paga por ella.
           when not c.con_factura and not c.pago_en_tesoreria and coalesce(fa.registradas, 0) = 0 and not fc.en_camino then 'SIN_FACTURA'
           -- Tesorería la pagó directo y después llegó su comprobante: tiene que anular ese pago para que se registre.
           when not c.con_factura and coalesce(pb.n, 0) > 0 and fc.en_camino then 'PAGO_POR_ANULAR'
           -- Pagada: sus pagos vigentes suman el total, o uno vigente la dio por cancelada (sección 2).
           when not c.con_factura and coalesce(pb.n, 0) > 0
                and (pb.sin_completar or pb.pagado >= public.total_orden_compra(c.id)) then 'PAGADA'
           when not c.con_factura and coalesce(pb.n, 0) > 0 then 'PAGO_PARCIAL'
           -- La boleta que Contabilidad registró como comprobante se paga por ahí (y
           -- `registrar_pago_compra` ya no la deja pagar directo): sigue como factura.
           -- La que trae factura (en borrador o anexada por Logística) espera que Contabilidad la registre.
           when not c.con_factura and coalesce(fa.registradas, 0) = 0 and not fc.en_camino then 'POR_PAGAR'
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
    -- El proveedor de la OC con boleta entregó su comprobante y todavía se registra para ella.
    left join lateral (select exists (select 1 from public.comprobante_en_camino(c.id)) as en_camino) fc on true
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
      select count(*) as n, sum(x.monto) as pagado, coalesce(bool_or(x.cancela_sin_completar), false) as sin_completar,
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
