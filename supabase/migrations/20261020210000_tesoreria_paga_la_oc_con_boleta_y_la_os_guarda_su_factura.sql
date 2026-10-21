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
-- borrador o anexada por Logística, la registre Contabilidad ligada a ella, a
-- otra OC o a ninguna) no se paga directo. Y si la factura llega a una OC que
-- Tesorería ya pagó directo, la factura toma ese pago: el dinero salió una vez
-- y nadie anula un pago bien hecho. Si la factura es por más, se paga la
-- diferencia; si es por menos, o ya estaba pagada, lo pagado de más queda a la
-- vista hasta que el proveedor lo devuelva. Con un pago vigente, la OC tampoco
-- cambia su total. La misma factura se reconoce aunque se escriba de otra forma («S.A.C.» o
-- «SAC», «F001-000123» o «F001 123»; «S.A.C.» y «E.I.R.L.» son dos empresas), no
-- entra dos veces a Adquisiciones y, registrada sin OC, se liga sola a la OC con
-- boleta a la que Logística la anexó; si esa OC ya tiene su factura, no entra
-- otra. El anexo equivocado lo anula Logística, con su motivo; no se borra, y no
-- se anula el de la factura que ya se pagó por un camino y quedaría libre para el
-- otro. La factura que Logística anexó a una OC que no es suya (no alcanza para
-- ella) no la da por pagada: la deja por revisar.
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

-- Si el proveedor entrega factura después, la factura toma este pago (sección 6):
-- un pago de la factura que es este mismo, sin caja propia, porque el dinero
-- salió una sola vez. Lo pone y lo quita el sistema.
-- (b) La sección 6 busca por él los pagos de cada OC; casi todas las filas van en null.
alter table public.pagos_adquisicion
  add column if not exists pago_orden_compra_id uuid references public.pagos_orden_compra(id) on delete restrict;
create index if not exists ix_pagos_adquisicion_pago_orden_compra
  on public.pagos_adquisicion (pago_orden_compra_id) where pago_orden_compra_id is not null;
comment on column public.pagos_adquisicion.pago_orden_compra_id is
  'El pago directo de la OC con boleta que esta factura tomó (migración 20261020210000): no movió la caja, la movió ese pago. Lo pone y lo anula el sistema.';

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
-- Si el proveedor de una OC con boleta entrega factura, Logística la anexa a la
-- OC y la OC ya no se paga directo: se paga por esa factura, la registre
-- Contabilidad ligada a esta OC, a otra o a ninguna. Antes, la factura registrada
-- para otra OC le devolvía a esta el pago por boleta, y la factura que cubría
-- las dos se pagaba entera encima (lo cobró la revisión de la sexta vuelta). Si
-- el anexo era de otra OC, Logística lo anula con su motivo —no se borra: queda
-- tachado como evidencia, con quién y cuándo— y lo anexa a la buena.
alter table public.documentos_compra_material
  add column if not exists anulado_en timestamptz,
  add column if not exists anulado_por uuid references public.usuarios(id) on delete restrict,
  add column if not exists motivo_anulacion text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_documento_compra_anulacion'
                   and conrelid = 'public.documentos_compra_material'::regclass) then
    alter table public.documentos_compra_material add constraint ck_documento_compra_anulacion check (
      (anulado_en is null and anulado_por is null and motivo_anulacion is null)
      or (anulado_en is not null and anulado_por is not null and char_length(btrim(motivo_anulacion)) between 10 and 500));
  end if;
end $$;
-- La factura anexada antes del 2026-10-16 no tiene número ni fecha, y la regla
-- que los pide (20261016702000) es NOT VALID: no revisa las filas viejas al
-- crearse, pero sí cada vez que una se actualiza. Anularla chocaba con ella y la
-- OC quedaba esperando una factura que nadie podía registrar ni anular. La misma
-- regla, salvo para la anulada; sigue NOT VALID.
alter table public.documentos_compra_material drop constraint if exists ck_documento_compra_factura_con_numero;
alter table public.documentos_compra_material add constraint ck_documento_compra_factura_con_numero
  check (anulado_en is not null or tipo <> 'FACTURA'
         or (numero_documento is not null and fecha_emision is not null
             and numero_documento = public.normalizar_numero_factura(numero_documento))) not valid;
comment on column public.documentos_compra_material.anulado_en is
  'La factura o la boleta que Logística anexó por error a esta OC (migración 20261020210000): queda como evidencia y ya no cuenta para su pago.';

-- La anulación la pone `anular_documento_compra`, con quien la llama y la hora
-- del servidor. El documento nace vigente: el permiso de alta de la tabla cubre
-- todas sus columnas, y con el de anexar se daba de alta uno ya «anulado» por
-- otra persona hace un mes, con su motivo; la evidencia de quién y cuándo se
-- falsificaba (lo cobró la sexta auditoría).
create or replace function public.fn_documento_compra_nace_vigente()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if new.anulado_en is not null or new.anulado_por is not null or new.motivo_anulacion is not null then
    raise exception 'El documento de la OC se adjunta vigente: si está mal, se anula después, con su motivo.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_documento_compra_nace_vigente() from public, anon, authenticated;
create or replace trigger trg_documento_compra_nace_vigente
  before insert on public.documentos_compra_material
  for each row execute function public.fn_documento_compra_nace_vigente();

-- La misma factura se escribe de muchas formas: «FERRETERÍA EL PERNO S.A.C.» y
-- «Ferreteria El Perno SAC», «F001-000123» y «F001 123». Las dos claves la
-- reconocen. El proveedor: sin tildes ni eñes (antes de pasar a mayúsculas, que
-- con otra intercalación de la base dejaban la Ñ), solo letras y números, y sin
-- el tipo de sociedad solo cuando va como palabra al final («LA CASA» no pierde
-- su «SA»). El número: serie y correlativo sin ceros a la izquierda, con o sin
-- guion; lo que no tiene esa forma queda en mayúsculas y sin signos. Un nombre
-- sin una sola letra latina («深圳市五金») queda como está, sin signos: sin clave
-- no lo cuidaba ninguna guarda. Son `immutable` porque van en índices: si un día
-- cambia su cuerpo, la misma migración hace `reindex` de esos índices (skill
-- esquema). Y no se les quita el `execute` a `authenticated`: Postgres evalúa la
-- expresión del índice con el rol que escribe, y sin él Logística no podía
-- anexar una factura ni Contabilidad dar de alta un comprobante.
create or replace function public.clave_proveedor(p_texto text)
returns text language sql immutable parallel safe set search_path to 'public' as $$
  select coalesce(
           nullif(regexp_replace(
             regexp_replace(
               regexp_replace(upper(translate(coalesce(p_texto, ''), 'áéíóúüñàèìòùÁÉÍÓÚÜÑÀÈÌÒÙ', 'aeiouunaeiouAEIOUUNAEIOU') collate "C"),
                              '[.,]', '', 'g'),
               '\s+(S\s*A\s*C|S\s*A\s*A|S\s*R\s*L|E\s*I\s*R\s*L|S\s*C\s*R\s*L|S\s*A|SOCIEDAD\s+ANONIMA(\s+CERRADA|\s+ABIERTA)?)\s*$', ''),
             '[^A-Z0-9]', '', 'g'), ''),
           nullif(upper(regexp_replace(coalesce(p_texto, ''), '[[:punct:][:space:]]', '', 'g')), ''));
$$;
comment on function public.clave_proveedor(text) is
  'El nombre del proveedor sin tildes, signos, espacios ni tipo de sociedad al final: con ella se reconoce la misma factura escrita de dos formas.';
revoke all on function public.clave_proveedor(text) from public, anon;
grant execute on function public.clave_proveedor(text) to authenticated;

-- Pero «EL PERNO S.A.C.» y «EL PERNO E.I.R.L.» son dos empresas: la clave las
-- junta (así se busca por el índice) y esto las separa cuando las dos dicen su
-- tipo de sociedad y no es el mismo. Si una no lo dice, se toman por la misma.
create or replace function public.sufijo_societario(p_texto text)
returns text language sql immutable parallel safe set search_path to 'public' as $$
  select case regexp_replace(m[1], '\s', '', 'g')
           when 'SOCIEDADANONIMACERRADA' then 'SAC'
           when 'SOCIEDADANONIMAABIERTA' then 'SAA'
           when 'SOCIEDADANONIMA' then 'SA'
           else regexp_replace(m[1], '\s', '', 'g') end
    from regexp_match(regexp_replace(upper(translate(coalesce(p_texto, ''), 'áéíóúüñàèìòùÁÉÍÓÚÜÑÀÈÌÒÙ', 'aeiouunaeiouAEIOUUNAEIOU') collate "C"),
                                     '[.,]', '', 'g'),
                      '\s+(S\s*A\s*C|S\s*A\s*A|S\s*R\s*L|E\s*I\s*R\s*L|S\s*C\s*R\s*L|S\s*A|SOCIEDAD\s+ANONIMA(\s+CERRADA|\s+ABIERTA)?)\s*$') m;
$$;
revoke all on function public.sufijo_societario(text) from public, anon;
grant execute on function public.sufijo_societario(text) to authenticated;

create or replace function public.mismo_proveedor(p_uno text, p_otro text)
returns boolean language sql immutable parallel safe set search_path to 'public' as $$
  select public.clave_proveedor(p_uno) = public.clave_proveedor(p_otro)
         and (public.sufijo_societario(p_uno) is null or public.sufijo_societario(p_otro) is null
              or public.sufijo_societario(p_uno) = public.sufijo_societario(p_otro));
$$;
comment on function public.mismo_proveedor(text, text) is
  'Si dos nombres son del mismo proveedor: la misma clave y, si los dos dicen su tipo de sociedad, el mismo.';
revoke all on function public.mismo_proveedor(text, text) from public, anon;
grant execute on function public.mismo_proveedor(text, text) to authenticated;

create or replace function public.clave_numero_comprobante(p_numero text)
returns text language plpgsql immutable parallel safe set search_path to 'public' as $$
declare
  v_texto text := regexp_replace(upper(coalesce(p_numero, '') collate "C"), '[^A-Z0-9-]', '', 'g');
  v_partes text[];
begin
  if v_texto = '' then return null; end if;
  v_partes := regexp_match(v_texto, '^([A-Z0-9]{1,4})-+0*([0-9]{1,12})$');
  if v_partes is null then v_partes := regexp_match(v_texto, '^([A-Z][A-Z0-9]{3})0*([0-9]{1,12})$'); end if;
  if v_partes is null then return v_texto; end if;
  return case when v_partes[1] ~ '^[0-9]+$' then coalesce(nullif(ltrim(v_partes[1], '0'), ''), '0') else v_partes[1] end
         || '-' || coalesce(nullif(ltrim(v_partes[2], '0'), ''), '0');
end;
$$;
comment on function public.clave_numero_comprobante(text) is
  'El número del comprobante como serie y correlativo sin ceros a la izquierda (F001-123), con o sin guion: con ella se reconoce la misma factura escrita de dos formas.';
revoke all on function public.clave_numero_comprobante(text) from public, anon;
grant execute on function public.clave_numero_comprobante(text) to authenticated;

-- Se busca por las dos claves cada vez que se da de alta, se corrige o se paga
-- un comprobante, y por cada factura anexada en la lista de Tesorería, en
-- Adquisiciones y en el desplegable de Contabilidad (regla b de la skill esquema:
-- la aplicación filtra por ellas). Sin índice, cada búsqueda recorría la tabla.
create index if not exists ix_adquisiciones_clave_comprobante
  on public.adquisiciones (public.clave_numero_comprobante(numero_documento), public.clave_proveedor(proveedor));
create index if not exists ix_documentos_compra_factura_clave
  on public.documentos_compra_material (public.clave_numero_comprobante(numero_documento))
  where tipo = 'FACTURA' and anulado_en is null;

-- ¿La factura alcanza para pagar también esta OC? Si Contabilidad no le ligó
-- otras OC, sí: es el documento que Logística anexó a esta, y si es por menos
-- (un descuento, o una parte), sigue siendo su factura. Con 90 % sobre esta OC,
-- la factura sin OC por menos dejaba de contar, Tesorería la pagaba encima del
-- pago directo y nada lo marcaba (lo cobró la octava auditoría).
-- Si tiene otras OC ligadas, su total tiene que llegar al 90 % de lo que suman
-- con esta, y lo que deja después de las otras tiene que cubrir por lo menos la
-- mitad de esta: si no, es la factura de esas y el anexo está por revisar. Antes
-- bastaba con que pasara en un sol a las otras, y la factura de S/ 430 de una OC
-- de S/ 426.57 pagaba también la OC con boleta de S/ 361.50 a la que se anexó
-- (lo cobró la sexta auditoría). Después se exigió cubrir las dos con un sol de
-- holgura, y la factura de dos OC con un descuento de más de un sol quedaba «por
-- revisar», su anexo se anulaba y la OC se pagaba también por su boleta (lo
-- cobró la séptima). Y con solo el 90 % de la suma, la OC con boleta chica cabía
-- entera en el margen de la factura de una OC grande: salía pagada sin pago y su
-- anexo ya no se anulaba (lo cobró la octava). El 10 % y la mitad son lo que se
-- da por bueno; lo decide DKS. Si cubre alguna de las otras en parte, o hay
-- otra moneda, no se puede saber: en esos casos se toma que sí alcanza. Recibe
-- la fila de la factura y no su id: los disparadores la llaman con la fila
-- nueva, con el total corregido, cuando la tabla todavía tiene la de antes (o
-- ninguna, al darla de alta).
create or replace function public.factura_alcanza_para(p_factura public.adquisiciones, p_compra uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select count(l.id) = 0
         or coalesce(bool_or(l.parcial) or bool_or(c.moneda <> p_factura.moneda), false)
         or (select x.moneda from public.ordenes_compra_materiales x where x.id = p_compra) is distinct from p_factura.moneda
         or (p_factura.total >= 0.9 * (coalesce(sum(public.total_orden_compra(l.orden_compra_id)), 0) + coalesce(public.total_orden_compra(p_compra), 0))
             and p_factura.total - coalesce(sum(public.total_orden_compra(l.orden_compra_id)), 0) >= 0.5 * coalesce(public.total_orden_compra(p_compra), 0))
    from public.adquisiciones_ordenes_compra l
    left join public.ordenes_compra_materiales c on c.id = l.orden_compra_id
   where l.adquisicion_id = p_factura.id and l.quitada_en is null and l.orden_compra_id <> p_compra;
$$;
comment on function public.factura_alcanza_para(public.adquisiciones, uuid) is
  'Si la factura es también la de esta OC: sin otras OC ligadas, sí; con otras, si su total llega al 90 % de todas y lo que deja después de las otras cubre la mitad de esta. Ayudante interno.';
revoke all on function public.factura_alcanza_para(public.adquisiciones, uuid) from public, anon, authenticated;

-- La factura que es la de un anexo de Logística: la adquisición que lo eligió
-- (`documento_compra_id`) o la que tiene su número y el proveedor de su OC, con
-- las claves de arriba. Por el número, no el «Otro»: puede ser la nota de
-- crédito de esa factura, que lleva su número. Primero la registrada y, entre ellas, la que cubre la OC
-- del anexo. Con lo pagado y el saldo de esa factura, para decir si la compra se
-- pagó por los dos caminos, y si alcanza para esta OC. Una sola regla: la usan el
-- comprobante en camino, el desplegable de Contabilidad, Adquisiciones y la
-- anulación del anexo. En plpgsql: así guarda su plan, y en la lista de
-- Tesorería, que la llama por cada OC con boleta, era la mitad del tiempo.
create or replace function public.factura_del_anexo(p_documento uuid)
returns table (adquisicion_id uuid, estado text, cubre_su_oc boolean, numero text, bucket text, ruta text,
               pagado numeric, saldo numeric, moneda text, alcanza boolean)
language plpgsql stable security definer rows 1 set search_path to 'public' as $$
#variable_conflict use_column
begin
  return query
  select f.id, f.estado, f.cubre, f.numero_documento, f.bucket, f.ruta, f.pagado, f.total - f.pagado, f.moneda,
         f.cubre or public.factura_alcanza_para(f.factura, f.orden_compra) as alcanza
    from (
      select a.id, a.estado, a.numero_documento, a.total, a.moneda, a.creado_en, d.orden_compra_id as orden_compra, a as factura,
             a.orden_compra_id is not distinct from d.orden_compra_id
               or exists (select 1 from public.adquisiciones_ordenes_compra l
                           where l.adquisicion_id = a.id and l.orden_compra_id = d.orden_compra_id and l.quitada_en is null) as cubre,
             case when a.ruta_storage is not null then 'comprobantes-financieros'
                  when e.ruta_storage is not null then 'documentos-compras' end as bucket,
             coalesce(a.ruta_storage, e.ruta_storage) as ruta,
             coalesce((select sum(x.monto) from public.pagos_adquisicion x where x.adquisicion_id = a.id and x.anulado_en is null), 0) as pagado
        from public.documentos_compra_material d
        join public.ordenes_compra_materiales c on c.id = d.orden_compra_id
        cross join lateral (
          select x.id from public.adquisiciones x where x.documento_compra_id = d.id
          union
          select x.id from public.adquisiciones x
           where public.clave_numero_comprobante(x.numero_documento) = public.clave_numero_comprobante(d.numero_documento)
             and public.clave_proveedor(x.proveedor) = public.clave_proveedor(c.proveedor)
             and public.mismo_proveedor(x.proveedor, c.proveedor)
             and x.tipo <> 'OTRO'
        ) m
        join public.adquisiciones a on a.id = m.id
        left join public.documentos_compra_material e on e.id = a.documento_compra_id
       where d.id = p_documento and d.tipo = 'FACTURA' and d.anulado_en is null
       order by a.estado = 'REGISTRADA' desc, cubre desc, a.creado_en
       limit 1
    ) f;
end;
$$;
comment on function public.factura_del_anexo(uuid) is
  'La adquisición que es la factura que Logística anexó (la que la eligió, o la de su número y el proveedor de su OC): la registrada antes que el borrador, con lo pagado, el saldo y si alcanza para esa OC. Ayudante interno.';
revoke all on function public.factura_del_anexo(uuid) from public, anon, authenticated;

-- Al revés: los anexos vigentes de OC con boleta de los que una factura es la
-- factura, por el que eligió o por su número y su proveedor (el «Otro», solo por
-- el que eligió). Recibe la fila de la factura, la de antes o la de después de
-- una corrección. Los usan las guardas de Adquisiciones y el pago de la factura.
create or replace function public.anexos_de_la_factura(p_factura public.adquisiciones)
returns table (documento_id uuid, orden_compra_id uuid)
language sql stable security definer set search_path to 'public' as $$
  select d.id, d.orden_compra_id
    from public.documentos_compra_material d
    join public.ordenes_compra_materiales c on c.id = d.orden_compra_id
   where d.id = p_factura.documento_compra_id and d.tipo = 'FACTURA' and d.anulado_en is null and not c.con_factura
  union
  select d.id, d.orden_compra_id
    from public.documentos_compra_material d
    join public.ordenes_compra_materiales c on c.id = d.orden_compra_id
   where public.clave_numero_comprobante(d.numero_documento) = public.clave_numero_comprobante(p_factura.numero_documento)
     and p_factura.tipo <> 'OTRO'
     and d.tipo = 'FACTURA' and d.anulado_en is null and not c.con_factura
     and public.mismo_proveedor(c.proveedor, p_factura.proveedor);
$$;
comment on function public.anexos_de_la_factura(public.adquisiciones) is
  'Los anexos vigentes de OC con boleta de los que esa factura es la factura (por el anexo que eligió o por su número y su proveedor). Ayudante interno.';
revoke all on function public.anexos_de_la_factura(public.adquisiciones) from public, anon, authenticated;

-- Las facturas registradas de una OC con boleta: la que la tiene en su cabecera
-- o ligada (con `parcial`, si la cubre en parte) y la de su anexo que alcanza
-- para ella, aunque Contabilidad no la ligara. La que no alcanza no es suya: su
-- anexo está por revisar. Con ellas la factura toma el pago directo (sección 6)
-- y Tesorería sabe que la OC ya se paga por factura. Por la cabecera, el vínculo
-- y el anexo por separado: con un `or` recorría la tabla.
create or replace function public.facturas_de_la_compra(p_compra uuid)
returns table (adquisicion_id uuid, parcial boolean)
language sql stable security definer rows 2 set search_path to 'public' as $$
  select x.id, coalesce(bool_and(l.parcial), false)
    from (select a.id from public.adquisiciones a where a.orden_compra_id = p_compra
          union
          select l.adquisicion_id from public.adquisiciones_ordenes_compra l
           where l.orden_compra_id = p_compra and l.quitada_en is null
          union
          select f.adquisicion_id
            from public.documentos_compra_material d
            cross join lateral public.factura_del_anexo(d.id) f
           where d.orden_compra_id = p_compra and d.tipo = 'FACTURA' and d.anulado_en is null
             and f.estado = 'REGISTRADA' and f.alcanza) x
    join public.adquisiciones a on a.id = x.id and a.estado = 'REGISTRADA'
    left join public.adquisiciones_ordenes_compra l
      on l.adquisicion_id = a.id and l.orden_compra_id = p_compra and l.quitada_en is null
   group by x.id;
$$;
comment on function public.facturas_de_la_compra(uuid) is
  'Las facturas registradas de una OC con boleta: en su cabecera, ligadas (y si la cubren en parte) o la de su anexo que alcanza para ella. Ayudante interno.';
revoke all on function public.facturas_de_la_compra(uuid) from public, anon, authenticated;

-- El pago directo de una OC con boleta frente a sus facturas (sección 6): la
-- primera factura registrada (para nombrarla y saltar a ella), lo que les falta
-- a las de su moneda, cuánto de los pagos directos tomaron y lo pagado de más:
-- lo que no tomaron, si alguna la cubre entera (si todas la cubren en parte,
-- falta la otra factura, no sobra). Si hay una en otra moneda: esa no toma
-- nada, el sistema no convierte. Y si alguna la cubre entera.
create or replace function public.pago_directo_de_la_compra(p_compra uuid)
returns table (factura_id uuid, factura text, factura_saldo numeric, aplicado numeric, de_mas numeric, otra_moneda boolean,
               entera boolean)
language sql stable security definer rows 1 set search_path to 'public' as $$
  with f as (
    select a.id, a.numero_documento, a.moneda, a.fecha_emision, a.creado_en, x.parcial,
           a.total - coalesce((select sum(p.monto) from public.pagos_adquisicion p
                                where p.adquisicion_id = a.id and p.anulado_en is null), 0) as saldo
      from public.facturas_de_la_compra(p_compra) x
      join public.adquisiciones a on a.id = x.adquisicion_id
  ),
  d as (select coalesce(sum(p.monto), 0) as pagado, count(*) as n
          from public.pagos_orden_compra p where p.orden_compra_id = p_compra and p.anulado_en is null),
  t as (select coalesce(sum(x.monto), 0) as aplicado
          from public.pagos_orden_compra p
          join public.pagos_adquisicion x on x.pago_orden_compra_id = p.id and x.anulado_en is null
         where p.orden_compra_id = p_compra)
  select (select f.id from f order by f.fecha_emision, f.creado_en, f.id limit 1),
         (select f.numero_documento from f order by f.fecha_emision, f.creado_en, f.id limit 1),
         (select sum(greatest(f.saldo, 0)) from f where f.moneda = c.moneda)::numeric(14, 2),
         t.aplicado::numeric(14, 2),
         case when exists (select 1 from f where f.moneda = c.moneda and not f.parcial)
              then greatest(d.pagado - t.aplicado, 0) else 0 end::numeric(14, 2),
         d.n > 0 and exists (select 1 from f where f.moneda <> c.moneda),
         exists (select 1 from f where not f.parcial)
    from public.ordenes_compra_materiales c cross join d cross join t
   where c.id = p_compra and not c.con_factura;
$$;
comment on function public.pago_directo_de_la_compra(uuid) is
  'De una OC con boleta: su primera factura registrada, lo que les falta a las de su moneda, cuánto del pago directo tomaron, lo pagado de más (si alguna la cubre entera), si alguna va en otra moneda y si alguna la cubre entera. Ayudante interno.';
revoke all on function public.pago_directo_de_la_compra(uuid) from public, anon, authenticated;

-- El desplegable «Factura que anexó Logística» de Adquisiciones: de cada anexo,
-- si ya tiene factura (registrada o en borrador: no se ofrece, porque se
-- registraría dos veces); si su OC con boleta ya tiene otra factura completa
-- (la de un anexo con el número mal escrito, casi siempre: se corrige esa, no se
-- registra otra); y el proveedor de otra factura con su mismo número, para que
-- Contabilidad mire antes de registrarla: si el proveedor se escribió de otra
-- forma, la clave no lo reconoce. Y si su OC con boleta ya tiene un pago directo
-- vigente: registrada, la factura toma ese pago (sección 6), y Contabilidad lo
-- sabe antes de registrarla. Columnas con nombre, como las demás que se llaman
-- por `rpc` (skill esquema).
create or replace function public.situacion_de_facturas_anexadas(p_documentos uuid[])
returns table (documento uuid, registrada boolean, mismo_numero text, factura_de_la_oc text, pagada_directo boolean)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  if not (public.es_admin() or public.tiene_permiso('adquisiciones.ver')) then
    raise exception 'Adquisiciones la ven Contabilidad, Tesorería, Logística y Gerencia.' using errcode = 'insufficient_privilege';
  end if;
  return query
  select x.id,
         exists (select 1 from public.factura_del_anexo(x.id)),
         (select a.proveedor
            from public.documentos_compra_material d
            join public.ordenes_compra_materiales c on c.id = d.orden_compra_id
            join public.adquisiciones a
              on public.clave_numero_comprobante(a.numero_documento) = public.clave_numero_comprobante(d.numero_documento)
             and a.tipo <> 'OTRO'
           where d.id = x.id and not coalesce(public.mismo_proveedor(a.proveedor, c.proveedor), false)
           order by a.creado_en limit 1),
         (select a.numero_documento
            from public.documentos_compra_material d
            join public.ordenes_compra_materiales c on c.id = d.orden_compra_id and not c.con_factura
            join public.adquisiciones_ordenes_compra l on l.orden_compra_id = c.id and l.quitada_en is null and not l.parcial
            join public.adquisiciones a on a.id = l.adquisicion_id and a.estado = 'REGISTRADA' and a.tipo <> 'OTRO'
           where d.id = x.id and a.documento_compra_id is distinct from d.id
           order by a.creado_en limit 1),
         exists (select 1
                   from public.documentos_compra_material d
                   join public.ordenes_compra_materiales c on c.id = d.orden_compra_id and not c.con_factura
                   join public.pagos_orden_compra p on p.orden_compra_id = c.id and p.anulado_en is null
                  where d.id = x.id)
    from unnest(p_documentos) as x(id);
end;
$$;
comment on function public.situacion_de_facturas_anexadas(uuid[]) is
  'Para el desplegable de Contabilidad: de cada factura anexada, si ya tiene factura en Adquisiciones, la factura completa que ya tiene su OC con boleta, el proveedor de otra con su mismo número y si su OC con boleta tiene un pago directo vigente (la factura lo toma al registrarla). Exige adquisiciones.ver.';
revoke all on function public.situacion_de_facturas_anexadas(uuid[]) from public, anon;
grant execute on function public.situacion_de_facturas_anexadas(uuid[]) to authenticated;

-- El comprobante que el proveedor de una OC con boleta ya entregó y que todavía
-- no es su factura registrada, con prioridad:
--   1. BORRADOR: el que Contabilidad tiene en borrador ligado a la OC.
--   2. REGISTRADA: la factura que Logística le anexó y que Contabilidad registró
--      para otras OC, y que no alcanza para esta: el anexo está por revisar.
--   3. LOGISTICA: la factura que Logística le anexó y que nadie registró.
-- La factura anexada que Contabilidad registró y que alcanza para esta OC, ligada
-- o no, no da fila: es su factura (`facturas_de_la_compra`) y toma su pago directo
-- (sección 6). La OC con factura tampoco: no se paga directo y, sin esto,
-- Adquisiciones calculaba esto para cada una. Da una fila o ninguna, y lo dice
-- (`rows 1`): sin eso el planificador esperaba mil por OC y la lista de Tesorería
-- compilaba con JIT. El borrador se busca por la cabecera y por el vínculo por
-- separado: con un `or` recorría la tabla.
create or replace function public.comprobante_en_camino(p_compra uuid)
returns table (numero text, origen text, bucket text, ruta text, documento_id uuid, alcanza boolean)
language sql stable security definer rows 1 set search_path to 'public' as $$
  select x.numero, x.origen, x.bucket, x.ruta, x.documento_id, x.alcanza
    from (
    (select a.numero_documento as numero, 'BORRADOR'::text as origen,
            case when a.ruta_storage is not null then 'comprobantes-financieros'
                 when d.ruta_storage is not null then 'documentos-compras' end as bucket,
            coalesce(a.ruta_storage, d.ruta_storage) as ruta, a.documento_compra_id as documento_id,
            null::boolean as alcanza, 1 as prioridad
       from (select b.id from public.adquisiciones b where b.orden_compra_id = p_compra and b.estado = 'BORRADOR'
             union
             select l.adquisicion_id from public.adquisiciones_ordenes_compra l
               join public.adquisiciones b on b.id = l.adquisicion_id
              where l.orden_compra_id = p_compra and l.quitada_en is null and b.estado = 'BORRADOR') ids
       join public.adquisiciones a on a.id = ids.id
       left join public.documentos_compra_material d on d.id = a.documento_compra_id
      order by a.creado_en limit 1)
    union all
    (select case when f.estado = 'REGISTRADA' then f.numero else coalesce(d.numero_documento, d.nombre_archivo) end,
            case when f.estado = 'REGISTRADA' then 'REGISTRADA' else 'LOGISTICA' end,
            case when f.estado = 'REGISTRADA' then f.bucket else 'documentos-compras' end,
            case when f.estado = 'REGISTRADA' then f.ruta else d.ruta_storage end,
            d.id,
            case when f.estado = 'REGISTRADA' then false end,
            case when f.estado = 'REGISTRADA' then 2 else 3 end
       from public.documentos_compra_material d
       left join lateral public.factura_del_anexo(d.id) f on true
      where d.orden_compra_id = p_compra and d.tipo = 'FACTURA' and d.anulado_en is null
        and not coalesce(f.estado = 'REGISTRADA' and f.alcanza, false)
      order by case when f.estado = 'REGISTRADA' then 2 else 3 end, d.creado_en limit 1)
  ) x
  join public.ordenes_compra_materiales c on c.id = p_compra and not c.con_factura
  order by x.prioridad
  limit 1;
$$;
comment on function public.comprobante_en_camino(uuid) is
  'El comprobante de una OC con boleta que todavía no es su factura registrada: el borrador de Contabilidad ligado a ella, la factura anexada que Contabilidad registró para otras OC y no alcanza para esta (`alcanza` en falso: el anexo está por revisar) o la anexada que nadie registró. Ayudante interno de las funciones de Tesorería y Adquisiciones.';
revoke all on function public.comprobante_en_camino(uuid) from public, anon, authenticated;

-- Logística anula la factura o la boleta que anexó por error a una OC. Con su
-- motivo, quién y cuándo; el PDF queda como evidencia. Lo puede quien anexa
-- (`compras.crear`, el permiso de la política de alta de la tabla). Si con eso la
-- OC con boleta vuelve a pagarse por su boleta, se le avisa a Tesorería; si
-- Contabilidad tenía registrada o en borrador esa factura, se le avisa a ella.
-- Lo que cambia en el pago (la factura que deja de tomar el pago directo, los
-- avisos que ya no corren) lo rehace la sección 6 al anularse el documento.
-- No se anula el anexo de la factura que ya se pagó por un camino y quedaría
-- libre para pagarse por el otro: la que alcanza para esta OC, ligada a ella o
-- no, si Tesorería ya le pagó algo a esa factura o le pagó directo a la OC (la
-- factura registrada toma ese pago; la que está en borrador, al registrarla).
-- Anulado el anexo, nada los relacionaba: la OC se pagaba por su boleta encima de
-- la factura, o la factura encima del pago directo (lo cobró la revisión de la
-- sexta vuelta). Y la ligada, porque sin el anexo la corrección ya le podía
-- quitar la OC (lo cobró la sexta auditoría). Si el número está mal escrito,
-- Contabilidad corrige la factura, que sigue siendo la del anexo; si de verdad no
-- es de esta OC, la anula el administrador del sistema, que lo puede todo. La
-- factura que no alcanza para esta OC (es de las otras que tiene ligadas) sí se
-- anula: ese anexo es el error.
-- Los candados, en el orden de Adquisiciones: primero las facturas (el borrador
-- que eligió el anexo y las registradas de la OC, que la sección 6 va a tocar),
-- después la clave de la factura, el documento y la OC «for update», como al
-- pagarla: un pago directo que esté entrando termina antes, o espera a que esto
-- termine. Con el documento antes que la clave, el alta de la factura que lo
-- elige y esta anulación se esperaban la una a la otra (lo cobró la séptima
-- auditoría); con el borrador después de la OC, también (40P01, la octava).
-- El borrador de Contabilidad que eligió este anexo lo suelta: el anexo ya no
-- cuenta, y el borrador no se podía completar, ni corregir, ni darse de alta
-- otra vez, y su OC no se pagaba por ningún lado (lo cobró la séptima). Sigue
-- con su OC: si la factura no es de esa OC, Contabilidad la corrige al
-- registrarla.
create or replace function public.anular_documento_compra(p_id uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_doc     public.documentos_compra_material%rowtype;
  v_oc      public.ordenes_compra_materiales%rowtype;
  v_nombre  text;
  v_numero  text;
  v_factura record;
  v_antes   boolean;
  v_queda   boolean;
  v_pagos   integer;
  v_tomado  numeric;
  v_motivo  text := btrim(coalesce(p_motivo, ''));
begin
  if not (public.es_admin() or public.tiene_permiso('compras.crear')) then
    raise exception 'Anular un documento de compra corresponde a Logística.' using errcode = 'insufficient_privilege';
  end if;
  if char_length(v_motivo) not between 10 and 500 then
    raise exception 'Cuenta por qué se anula, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_doc from public.documentos_compra_material where id = p_id;
  if not found then raise exception 'Ese documento no existe.' using errcode = 'check_violation'; end if;
  select * into v_oc from public.ordenes_compra_materiales where id = v_doc.orden_compra_id;
  perform 1 from public.adquisiciones where documento_compra_id = p_id and estado = 'BORRADOR' order by id for update;
  perform public.bloquear_facturas_de_las_compras(array[v_doc.orden_compra_id]);
  if public.clave_numero_comprobante(v_doc.numero_documento) is not null and public.clave_proveedor(v_oc.proveedor) is not null then
    perform pg_advisory_xact_lock(hashtextextended('adquisicion|' || public.clave_numero_comprobante(v_doc.numero_documento)
                                                   || '|' || public.clave_proveedor(v_oc.proveedor), 0));
  end if;
  select * into v_doc from public.documentos_compra_material where id = p_id for update;
  if v_doc.anulado_en is not null then return p_id; end if;
  if v_doc.tipo not in ('FACTURA', 'COMPROBANTE') then
    raise exception 'Se anulan la factura y la boleta que entregó el proveedor; los demás documentos solo acompañan a la OC.'
      using errcode = 'check_violation';
  end if;
  select * into v_oc from public.ordenes_compra_materiales where id = v_doc.orden_compra_id for update;
  v_nombre := coalesce(v_oc.numero, 'OC ' || v_oc.referencia);
  v_numero := coalesce(v_doc.numero_documento, v_doc.nombre_archivo);
  select * into v_factura from public.factura_del_anexo(p_id);
  select count(*) into v_pagos from public.pagos_orden_compra p where p.orden_compra_id = v_oc.id and p.anulado_en is null;
  -- Lo que esa factura tomó de los pagos por la boleta de esta OC (sección 6).
  select coalesce(sum(x.monto), 0) into v_tomado
    from public.pagos_adquisicion x
    join public.pagos_orden_compra p on p.id = x.pago_orden_compra_id and p.orden_compra_id = v_oc.id
   where x.adquisicion_id = v_factura.adquisicion_id and x.anulado_en is null;
  v_antes := exists (select 1 from public.comprobante_en_camino(v_oc.id))
             or exists (select 1 from public.facturas_de_la_compra(v_oc.id));

  if v_doc.tipo = 'FACTURA' and not v_oc.con_factura and v_factura.adquisicion_id is not null
     and v_factura.alcanza and (v_factura.pagado > 0 or v_pagos > 0)
     and not public.es_admin() then
    raise exception '%', case
      when v_tomado > 0 then
        'No se anula: la factura ' || v_factura.numero || ' de este anexo ya está registrada'
        || case when v_factura.cubre_su_oc then ' para la ' || v_nombre else '' end
        || ' y tomó lo que Tesorería pagó por la boleta de la ' || v_nombre
        || '; anulado el anexo, la factura volvería a deber y se pagaría también.'
      when v_factura.pagado > 0 then
        'No se anula: la factura ' || v_factura.numero || ' de este anexo ya está registrada'
        || case when v_factura.cubre_su_oc then ' para la ' || v_nombre else '' end
        || ' y Tesorería le pagó '
        || case when v_factura.moneda = 'USD' then 'US$ ' else 'S/ ' end || to_char(v_factura.pagado, 'FM999G999G990D00')
        || '; anulado el anexo, la ' || v_nombre || ' se podría pagar otra vez por su boleta.'
      when v_factura.estado = 'BORRADOR' then
        'No se anula: Tesorería ya pagó la ' || v_nombre || ' por su boleta y la factura ' || v_factura.numero
        || ' de este anexo está en borrador en Adquisiciones: registrada, toma ese pago; anulado el anexo, se pagaría también la factura.'
      else
        -- La registrada en otra moneda: no toma el pago, y sin el anexo se pagaría también.
        'No se anula: Tesorería ya pagó la ' || v_nombre || ' por su boleta y la factura ' || v_factura.numero
        || ' de este anexo ya está registrada; anulado el anexo, se pagaría también la factura.'
      end
      || ' Si el número está mal escrito, Contabilidad corrige la factura: sigue siendo la de este anexo. Si de verdad no es de esta OC, que lo anule el administrador del sistema.'
      using errcode = 'check_violation';
  end if;

  update public.documentos_compra_material
     set anulado_en = now(), anulado_por = public.usuario_actual(), motivo_anulacion = v_motivo
   where id = p_id;
  update public.adquisiciones set documento_compra_id = null
   where documento_compra_id = p_id and estado = 'BORRADOR';
  v_queda := exists (select 1 from public.comprobante_en_camino(v_oc.id))
             or exists (select 1 from public.facturas_de_la_compra(v_oc.id));

  if v_factura.adquisicion_id is not null then
    perform public.notificar_a_permiso('adquisiciones.registrar',
      'Logística anuló una factura que anexó: ' || v_nombre,
      'Anuló la factura ' || v_numero || ' que había anexado a la ' || v_nombre || ': «' || v_motivo || '». '
        || case when v_factura.estado = 'BORRADOR'
                then 'En Adquisiciones está en borrador la ' || v_factura.numero || ', que ya no lleva ese anexo: quien la registró la completa con su PDF y, si no es de esa OC, la corrige después.'
                else 'En Adquisiciones está registrada la ' || v_factura.numero || ': si no es de esa OC, corrígela.' end,
      '/adquisiciones', 'documentos_compra_material', p_id, public.usuario_actual());
  end if;
  -- La OC con boleta que esperaba esta factura vuelve a pagarse por su boleta o,
  -- si Tesorería ya le pagó directo, sigue pagada así: no se le dice «otra vez».
  -- Si la factura era la suya (solo el administrador llega aquí con pago
  -- directo), ya no toma ese pago y vuelve a deber. Si no alcanzaba para ella y
  -- es de otras OC, puede que esta OC fuera parte de ella: Tesorería lo revisa
  -- antes de pagarla por su boleta.
  if v_doc.tipo = 'FACTURA' and not v_oc.con_factura and v_oc.pago_en_tesoreria and v_antes and not v_queda then
    perform public.notificar_a_permiso('tesoreria.registrar_pagos',
      case when v_pagos > 0 then 'La OC queda pagada por su boleta: ' else 'La OC vuelve a pagarse por su boleta: ' end || v_nombre,
      'Logística anuló la factura ' || v_numero || ' que había anexado a la ' || v_nombre || ': «' || v_motivo || '».'
        || case when v_pagos > 0 and v_factura.estado = 'REGISTRADA' and v_factura.alcanza
                then ' La factura ' || v_factura.numero || ' ya no toma lo que pagaste por la boleta y vuelve a deber lo que tomaba: si sí era de esta OC, no la pagues dos veces.'
                when v_factura.alcanza then ''
                when v_factura.pagado > 0 and not v_factura.cubre_su_oc
                then ' Ojo: la factura ' || v_factura.numero || ' ya tiene pagos de '
                     || case when v_factura.moneda = 'USD' then 'US$ ' else 'S/ ' end || to_char(v_factura.pagado, 'FM999G999G990D00')
                     || case when v_pagos > 0 then '; si esta OC era parte de ella (Contabilidad lo ve en la factura), se pagó dos veces: pide al proveedor la devolución.'
                             else '; si esta OC era parte de ella (Contabilidad lo ve en la factura), paga por su boleta solo lo que la factura no cubrió.' end
                -- Sin pagos todavía, la factura de otras OC también puede incluir esta
                -- (un descuento que no le deja su parte): que nadie la pague dos veces.
                when v_factura.estado = 'REGISTRADA' and not v_factura.cubre_su_oc
                     and exists (select 1 from public.adquisiciones a
                                  where a.id = v_factura.adquisicion_id
                                    and (a.orden_compra_id <> v_oc.id
                                         or exists (select 1 from public.adquisiciones_ordenes_compra l
                                                     where l.adquisicion_id = a.id and l.quitada_en is null and l.orden_compra_id <> v_oc.id)))
                then ' Ojo: la factura ' || v_factura.numero || ' está registrada para otras OC; si esta OC era parte de ella (Contabilidad lo ve en la factura), no la pagues dos veces: pregúntale a Contabilidad antes de pagarla por su boleta.'
                else '' end,
      '/tesoreria/por-pagar#compra-' || v_oc.id, 'documentos_compra_material', p_id, public.usuario_actual());
  end if;
  return p_id;
end;
$$;
comment on function public.anular_documento_compra(uuid, text) is
  'Logística anula, con su motivo, la factura o la boleta que anexó por error a una OC: queda como evidencia y deja de contar para su pago. No la factura ya pagada por un camino que quedaría libre para el otro, salvo el administrador. Exige compras.crear.';
revoke all on function public.anular_documento_compra(uuid, text) from public, anon;
grant execute on function public.anular_documento_compra(uuid, text) to authenticated;

-- Los demás que leen los anexos tampoco cuentan el anulado: el listado de OC y
-- sus candados de corrección (`compra_tiene_comprobante`) decían que la OC tenía
-- comprobante, y la entrega a Almacén aceptaba la factura anulada. Las mismas
-- funciones de 20261012150000 y 20260928132000, con `anulado_en is null`.
create or replace function public.compra_tiene_comprobante(p_compra public.ordenes_compra_materiales)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.documentos_compra_material d
     where d.orden_compra_id = p_compra.id and d.anulado_en is null
       and (d.tipo = 'FACTURA' or (not p_compra.con_factura and d.tipo = 'COMPROBANTE')));
$$;

create or replace function public.marcar_compra_entregada_almacen(p_compra uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid;
begin
  perform public.exigir_permiso('compras.crear');
  if exists (select 1 from public.orden_compra_material_detalles
      where orden_compra_id = p_compra and precio_unitario is null) then
    raise exception 'Registra el precio unitario de cada insumo antes de entregar la compra a Almacén.'
      using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.documentos_compra_material
      where orden_compra_id = p_compra and tipo = 'FACTURA' and anulado_en is null) then
    raise exception 'Adjunta la factura de la compra para Tesorería antes de entregarla a Almacén.'
      using errcode = 'check_violation';
  end if;
  update public.ordenes_compra_materiales
     set entregado_almacen_en = now(), entregado_almacen_por = public.usuario_actual()
   where id = p_compra and entregado_almacen_en is null returning id into v_id;
  if v_id is null then
    if exists (select 1 from public.ordenes_compra_materiales where id = p_compra
      and entregado_almacen_en is not null) then return p_compra; end if;
    raise exception 'La compra no existe.' using errcode = 'foreign_key_violation';
  end if;
  return v_id;
end;
$$;

-- La bitácora de la OT anotaba la anulación como «Documento de compra
-- actualizado», a nombre de quien subió el archivo. La de 20260930092000, con
-- la anulación escrita como tal, con su motivo y a nombre de quien la anuló.
create or replace function public.registrar_abastecimiento_en_ot()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_fila jsonb; v_orden uuid; v_nombre text; v_actor uuid; v_compra uuid; v_anulado boolean;
begin
 v_fila:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 if tg_table_name='movimientos_materiales' then
   select r.orden_id into v_orden from public.requerimiento_material_detalles d join public.requerimientos_materiales r on r.id=d.requerimiento_id where d.id=(v_fila->>'requerimiento_detalle_id')::uuid;
   if v_orden is null and v_fila->>'devolucion_de' is not null then
     select r.orden_id into v_orden from public.movimientos_materiales m join public.requerimiento_material_detalles d on d.id=m.requerimiento_detalle_id
     join public.requerimientos_materiales r on r.id=d.requerimiento_id where m.id=(v_fila->>'devolucion_de')::uuid;
   end if;
   v_nombre:=case v_fila->>'tipo' when 'DESPACHO' then 'Despacho de almacén' when 'INGRESO' then 'Ingreso a almacén' else 'Movimiento de material' end;
   v_actor:=(v_fila->>'registrado_por')::uuid;
 elsif tg_table_name='orden_compra_material_detalles' then
   select orden_id into v_orden from public.requerimientos_materiales where id=(v_fila->>'requerimiento_id')::uuid;
   v_nombre:='Detalle de compra';
 elsif tg_table_name in('ordenes_compra_materiales','documentos_compra_material') then
   v_compra:=case when tg_table_name='ordenes_compra_materiales' then (v_fila->>'id')::uuid else (v_fila->>'orden_compra_id')::uuid end;
   v_anulado:=tg_table_name='documentos_compra_material' and tg_op='UPDATE'
              and (to_jsonb(old)->>'anulado_en') is null and (v_fila->>'anulado_en') is not null;
   v_nombre:=case when tg_table_name='ordenes_compra_materiales' then 'Compra de materiales' else 'Documento de compra' end;
   v_actor:=case when v_anulado then (v_fila->>'anulado_por')::uuid
                 else coalesce((v_fila->>'subido_por')::uuid,(v_fila->>'creado_por')::uuid,public.usuario_actual()) end;
   for v_orden in select distinct r.orden_id from public.orden_compra_material_detalles d join public.requerimientos_materiales r on r.id=d.requerimiento_id where d.orden_compra_id=v_compra loop
     insert into public.ot_bitacora(orden_id,tipo_evento,descripcion,datos,usuario_id)
     values(v_orden,'COMENTARIO',case when v_anulado then 'Documento de compra anulado: '||(v_fila->>'motivo_anulacion')
                                      else v_nombre||case when tg_op='INSERT' then ' registrado' else ' actualizado' end end,
       jsonb_build_object('tabla',tg_table_name,'registro_id',v_fila->>'id','accion',tg_op),v_actor);
   end loop;
   return case when tg_op='DELETE' then old else new end;
 end if;
 if v_orden is not null then
   insert into public.ot_bitacora(orden_id,tipo_evento,descripcion,datos,usuario_id)
   values(v_orden,'COMENTARIO',v_nombre||case when tg_op='INSERT' then ' registrado' else ' actualizado' end,
     jsonb_build_object('tabla',tg_table_name,'registro_id',v_fila->>'id','accion',tg_op,'cantidad',v_fila->>'cantidad','destinatario',v_fila->>'recibido_por_nombre'),coalesce(v_actor,public.usuario_actual()));
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;

-- Aprobadas (o sin aprobación que pedir), con su total, lo pagado y su
-- vencimiento: todas las que faltan o piden algo y las 60 últimas canceladas.
-- Con el comprobante que el proveedor ya entregó y todavía no es su factura (se
-- espera: no se paga por la boleta) y con su factura registrada, si la tiene:
-- cuánto de lo pagado directo tomó, lo que le falta (se paga en «Facturas por
-- pagar») y lo pagado de más (sección 6). La que se paga por su factura sin
-- pagos directos no sale: está en las facturas. Primero lo que le pide algo a
-- Tesorería: lo pagado de más (pedir la devolución) y la factura en otra moneda,
-- que no toma el pago. La que Logística anexó a una factura registrada para
-- otras OC que no alcanza para ella se queda a la vista: no se paga por esa
-- factura, y alguien tiene que revisar el anexo.
-- Cancelada: sus pagos directos la cubren, o su factura entera ya no debe nada.
create or replace function public.compras_con_boleta_por_pagar()
returns table (
  id uuid, numero text, referencia text, proveedor_id uuid, proveedor text, proveedor_documento text,
  codigo_interno text, moneda text, total numeric, sin_precio boolean, condicion_pago text, dias_credito integer,
  creado_en timestamptz, vence date, recojo text, pagado numeric, cancelada boolean, ultimo_pago date,
  comprobante_en_camino text, comprobante_en_camino_origen text, comprobante_en_camino_bucket text,
  comprobante_en_camino_ruta text, comprobante_en_camino_alcanza boolean, estuvo_en_factura text,
  factura text, factura_id uuid, factura_saldo numeric, aplicado numeric, de_mas numeric, otra_moneda boolean
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
           c.recojo, coalesce(g.n, 0) as n, coalesce(g.pagado, 0)::numeric(14, 2) as pagado,
           -- Pagos directos que la cubren (sección 2), o su factura entera ya pagada.
           coalesce(g.n > 0 and (g.sin_completar or g.pagado >= t.total), false)
             or (pd.factura is not null and pd.entera and not pd.otra_moneda and coalesce(pd.factura_saldo, 0) <= 0) as cancelada,
           g.ultimo,
           e.numero as en_camino, e.origen as en_camino_origen, e.bucket as en_camino_bucket, e.ruta as en_camino_ruta,
           e.alcanza as en_camino_alcanza,
           -- Una factura ya pagada la cubría y una corrección se la quitó: que Tesorería lo vea antes de pagarla.
           (select a.numero_documento from public.adquisiciones a
              join public.adquisiciones_ordenes_compra l on l.adquisicion_id = a.id
             where l.orden_compra_id = c.id and l.quitada_en is not null and a.estado = 'REGISTRADA'
               and exists (select 1 from public.pagos_adquisicion x where x.adquisicion_id = a.id and x.anulado_en is null)
               and not exists (select 1 from public.facturas_de_la_compra(c.id) y where y.adquisicion_id = a.id)
             order by a.fecha_emision desc limit 1) as estuvo_en,
           pd.factura, pd.factura_id, pd.factura_saldo, coalesce(pd.aplicado, 0)::numeric(14, 2) as aplicado,
           coalesce(pd.de_mas, 0)::numeric(14, 2) as de_mas, coalesce(pd.otra_moneda, false) as otra_moneda
      from public.ordenes_compra_materiales c
      left join public.proveedores p on p.id = c.proveedor_id
      cross join lateral (select public.total_orden_compra(c.id) as total) t
      left join lateral (
        select count(*) as n, sum(x.monto) as pagado, coalesce(bool_or(x.cancela_sin_completar), false) as sin_completar,
               max(x.fecha_pago) as ultimo
          from public.pagos_orden_compra x where x.orden_compra_id = c.id and x.anulado_en is null
      ) g on true
      left join lateral public.comprobante_en_camino(c.id) e on true
      left join lateral public.pago_directo_de_la_compra(c.id) pd on true
     where not c.con_factura and c.pago_en_tesoreria and c.aprobacion in ('APROBADA', 'NO_REQUERIDA')
  ),
  -- La que se paga por su factura registrada, sin pagos directos, está en las facturas.
  visibles as (select * from filas f where f.n > 0 or f.factura is null),
  -- Lo que pide algo o todavía debe; lo demás, las 60 últimas.
  pendientes as (
    select f.*, f.de_mas > 0 or f.otra_moneda or not f.cancelada or f.en_camino is not null as pide from visibles f
  )
  select * from (
    select f.id, f.numero, f.referencia, f.proveedor_id, f.proveedor, f.ruc, f.codigo_interno, f.moneda, f.total, f.sin_precio,
           f.condicion_pago, f.dias_credito, f.creado_en, f.vence, f.recojo, f.pagado, f.cancelada, f.ultimo,
           f.en_camino, f.en_camino_origen, f.en_camino_bucket, f.en_camino_ruta, f.en_camino_alcanza, f.estuvo_en,
           f.factura, f.factura_id, f.factura_saldo, f.aplicado, f.de_mas, f.otra_moneda
      from pendientes f where f.pide
    union all
    (select f.id, f.numero, f.referencia, f.proveedor_id, f.proveedor, f.ruc, f.codigo_interno, f.moneda, f.total, f.sin_precio,
            f.condicion_pago, f.dias_credito, f.creado_en, f.vence, f.recojo, f.pagado, f.cancelada, f.ultimo,
            f.en_camino, f.en_camino_origen, f.en_camino_bucket, f.en_camino_ruta, f.en_camino_alcanza, f.estuvo_en,
            f.factura, f.factura_id, f.factura_saldo, f.aplicado, f.de_mas, f.otra_moneda
       from pendientes f where not f.pide order by f.ultimo desc nulls last, f.creado_en desc limit 60)
  ) x
  -- Primero lo que le pide algo a Tesorería: lo pagado de más y la factura en
  -- otra moneda. El anexo por revisar no le pide nada (lo revisa Logística) y va
  -- con las demás.
  order by (x.de_mas > 0 or x.otra_moneda) desc, x.cancelada, x.vence, x.creado_en;
end;
$$;
comment on function public.compras_con_boleta_por_pagar() is
  'Las OC con boleta aprobadas que Tesorería paga: las que faltan o piden algo y las 60 últimas canceladas, con el comprobante que el proveedor ya entregó y todavía no es su factura, su factura registrada (cuánto del pago directo tomó, lo que le falta y lo pagado de más) y la factura pagada que la cubría antes de una corrección. Exige tesoreria.registrar_pagos o tesoreria.ver_documentos.';
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
  v_alcanza boolean;
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
  -- Si Contabilidad ya le registró su factura (ligada, o la del anexo que alcanza
  -- para ella), se paga por ahí: dos caminos son dos pagos.
  select a.numero_documento into v_fact
    from public.facturas_de_la_compra(p_orden_compra) f
    join public.adquisiciones a on a.id = f.adquisicion_id
   order by a.fecha_emision, a.creado_en
   limit 1;
  if v_fact is not null then
    raise exception 'Contabilidad ya registró el comprobante % de la %: lo que falte se paga por él en «Facturas por pagar».', v_fact, v_nombre
      using errcode = 'check_violation';
  end if;
  -- Ni si el proveedor entregó su comprobante y todavía no se registra: se paga por él.
  select e.numero, e.origen, e.alcanza into v_fact, v_origen, v_alcanza from public.comprobante_en_camino(p_orden_compra) e;
  if v_origen = 'BORRADOR' then
    raise exception 'Contabilidad tiene en borrador el comprobante % de la %: se paga por él en Cuentas por pagar cuando lo registre.', v_fact, v_nombre
      using errcode = 'check_violation';
  elsif v_origen = 'REGISTRADA' then
    raise exception 'Logística anexó a la % la factura %, que Contabilidad registró para otras OC y que no alcanza para esta: si el anexo fue por error, que Logística lo anule y la OC se paga por su boleta.', v_nombre, v_fact
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

-- Tesorería anula el pago directo que estuvo mal, o el que el proveedor le
-- devolvió. Si la factura que llegó después lo había tomado, deja de tomarlo y
-- vuelve a deber lo que no cubren los demás (sección 6). Los candados, en el
-- orden de Adquisiciones: las facturas de la OC, la OC y el pago; con el pago
-- primero, Contabilidad registrando la factura a la vez y esta anulación se
-- esperaban la una a la otra.
create or replace function public.anular_pago_compra(p_id uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_pago public.pagos_orden_compra%rowtype;
begin
  perform public.exigir_permiso('tesoreria.registrar_pagos');
  if char_length(btrim(coalesce(p_motivo, ''))) not between 10 and 500 then
    raise exception 'Cuenta por qué se anula, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_pago from public.pagos_orden_compra where id = p_id;
  if not found then raise exception 'Ese pago no existe.' using errcode = 'check_violation'; end if;
  perform public.bloquear_facturas_de_las_compras(array[v_pago.orden_compra_id]);
  perform 1 from public.ordenes_compra_materiales where id = v_pago.orden_compra_id for no key update;
  select * into v_pago from public.pagos_orden_compra where id = p_id for update;
  if v_pago.anulado_en is not null then return p_id; end if;
  perform public.caja_anular_por_pago('PAGO_ORDEN_COMPRA', p_id, p_motivo, 'pago');
  update public.pagos_orden_compra
     set anulado_por = public.usuario_actual(), anulado_en = now(), motivo_anulacion = btrim(p_motivo)
   where id = p_id;
  perform public.conciliar_pago_directo(array[v_pago.orden_compra_id]);
  return p_id;
end;
$$;
comment on function public.anular_pago_compra(uuid, text) is
  'Tesorería anula, con su motivo, un pago directo de una OC con boleta: su egreso sale de la caja y, si una factura lo había tomado, deja de tomarlo. Exige tesoreria.registrar_pagos.';
revoke all on function public.anular_pago_compra(uuid, text) from public, anon;
grant execute on function public.anular_pago_compra(uuid, text) to authenticated;

-- Cómo queda el pago de una OC después de anular uno de sus pagos o de anexarle
-- su factura: el comprobante en camino, cuántos pagos directos siguen vigentes,
-- si están completos y lo que le falta, y su factura registrada: cuánto de esos
-- pagos tomó, lo que le falta y lo pagado de más (sección 6). Con ella el aviso
-- que lee Tesorería, o Logística, dice lo que la base va a dejar hacer (sin
-- traer la lista entera). La ven quien paga, quien consulta Tesorería y
-- Logística, que emitió la OC: los mismos que leen sus pagos.
create or replace function public.situacion_de_pago_de_compra(p_compra uuid)
returns table (en_camino text, en_camino_origen text, en_camino_alcanza boolean,
               pagos_vigentes integer, cancelada boolean, saldo numeric, moneda text,
               factura text, factura_saldo numeric, aplicado numeric, de_mas numeric, otra_moneda boolean)
language plpgsql stable security definer rows 1 set search_path to 'public' as $$
#variable_conflict use_column
begin
  if not (public.es_admin() or public.tiene_permiso('tesoreria.registrar_pagos') or public.tiene_permiso('tesoreria.ver_documentos')
          or public.tiene_permiso('compras.crear')) then
    raise exception 'El pago de la OC lo ven Tesorería y Logística.' using errcode = 'insufficient_privilege';
  end if;
  return query
  select e.numero, e.origen, e.alcanza, g.n::integer,
         coalesce(g.n > 0 and (g.sin_completar or g.pagado >= t.total), false),
         greatest(t.total - coalesce(g.pagado, 0), 0)::numeric(14, 2), c.moneda,
         pd.factura, pd.factura_saldo, coalesce(pd.aplicado, 0)::numeric(14, 2), coalesce(pd.de_mas, 0)::numeric(14, 2),
         coalesce(pd.otra_moneda, false)
    from public.ordenes_compra_materiales c
    cross join lateral (select public.total_orden_compra(c.id) as total) t
    cross join lateral (
      select count(*) as n, sum(x.monto) as pagado, coalesce(bool_or(x.cancela_sin_completar), false) as sin_completar
        from public.pagos_orden_compra x where x.orden_compra_id = c.id and x.anulado_en is null
    ) g
    left join lateral public.comprobante_en_camino(c.id) e on true
    left join lateral public.pago_directo_de_la_compra(c.id) pd on true
   where c.id = p_compra;
end;
$$;
comment on function public.situacion_de_pago_de_compra(uuid) is
  'El pago de una OC: su comprobante en camino (y si es un anexo por revisar), los pagos directos vigentes, si la cubren y su saldo, y su factura registrada: cuánto del pago directo tomó, lo que le falta, lo pagado de más y si va en otra moneda. Exige tesoreria.registrar_pagos, tesoreria.ver_documentos o compras.crear.';
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
-- en borrador o anexada por Logística). Y si la factura llega después a una OC
-- que Tesorería ya pagó directo, la factura toma ese pago: un pago de la factura
-- (`pagos_adquisicion.pago_orden_compra_id`) que es el mismo de la boleta, sin
-- caja propia, porque el dinero salió una vez. Antes Tesorería anulaba el pago
-- de la boleta y pagaba la factura «con el mismo voucher», y entre los dos pasos
-- el dinero que ya había salido no lo veía nadie: por tres caminos se volvía a
-- pagar (lo cobró la novena auditoría). Ahora nadie anula un pago bien hecho:
--   · La factura toma, en orden de fecha, lo que los pagos directos de la OC
--     alcanzan a cubrir de lo que le falta. Si es por más, el resto se paga en
--     «Facturas por pagar»; si es por menos, o ya la habían pagado, lo que no
--     toma queda como pagado de más (`pago_directo_de_la_compra`, sección 4).
--   · Se rehace sola cada vez que cambia algo de lo que la sostiene: la factura
--     se registra o se corrige, se liga o se quita una OC, Logística anexa o
--     anula la factura, Tesorería anula un pago directo o un pago de la factura.
--     Lo que ya no corresponde se anula con su motivo (queda como evidencia) y
--     lo que falta se agrega.
--   · Solo el sistema la pone y la quita: el permiso de pagar no basta, y no se
--     anula a mano en la factura (se anula el pago de la boleta).
--   · La factura en otra moneda no toma nada (el sistema no convierte): no se
--     paga encima mientras el pago de la boleta siga vigente.
-- Lo pagado de más se resuelve anulando el pago que el proveedor devolvió: el de
-- la factura, si la pagaron también, o el de la boleta; la cuenta se rehace.

-- Las facturas que la conciliación va a tocar, «for update» y en orden: las
-- registradas de cada OC y las que tienen tomado un pago directo suyo. Se toman
-- antes que la OC, como al registrar o corregir la factura en Adquisiciones
-- (primero la factura, después la OC): al revés, la anulación de un pago o de
-- un anexo y el registro de la factura se esperaban la una a la otra.
create or replace function public.bloquear_facturas_de_las_compras(p_compras uuid[])
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  perform 1 from public.adquisiciones a
   where a.id in (select f.adquisicion_id from unnest(p_compras) c(id) cross join lateral public.facturas_de_la_compra(c.id) f
                  union
                  select x.adquisicion_id from public.pagos_adquisicion x
                    join public.pagos_orden_compra p on p.id = x.pago_orden_compra_id
                   where p.orden_compra_id = any(p_compras) and x.anulado_en is null)
   order by a.id
     for update;
end;
$$;
comment on function public.bloquear_facturas_de_las_compras(uuid[]) is
  'Toma «for update», en orden, las facturas registradas de esas OC y las que tienen tomado un pago directo suyo. Ayudante interno.';
revoke all on function public.bloquear_facturas_de_las_compras(uuid[]) from public, anon, authenticated;

-- Las OC que una factura puede estar pagando: la de su cabecera, las ligadas (y
-- las que se le quitaron), las de los anexos de los que es la factura y las que
-- ya le dieron un pago directo. Con su fila de antes y la de después, la
-- conciliación sabe a quién mirar cuando la factura cambia.
create or replace function public.compras_de_la_factura(p_factura public.adquisiciones)
returns uuid[] language sql stable security definer set search_path to 'public' as $$
  select coalesce(array_agg(distinct x.id) filter (where x.id is not null), '{}')
    from (select p_factura.orden_compra_id as id
          union all
          select l.orden_compra_id from public.adquisiciones_ordenes_compra l where l.adquisicion_id = p_factura.id
          union all
          select a.orden_compra_id from public.anexos_de_la_factura(p_factura) a
          union all
          select p.orden_compra_id from public.pagos_adquisicion x
            join public.pagos_orden_compra p on p.id = x.pago_orden_compra_id
           where x.adquisicion_id = p_factura.id and x.anulado_en is null) x;
$$;
comment on function public.compras_de_la_factura(public.adquisiciones) is
  'Las OC que esa factura puede estar pagando: cabecera, vínculos, anexos de los que es la factura y las que le dieron un pago directo. Ayudante interno.';
revoke all on function public.compras_de_la_factura(public.adquisiciones) from public, anon, authenticated;

-- El pago de una factura lo registra quien paga, hasta su saldo (la de la
-- 20261015122000). El pago de la boleta que la factura toma lo pone la
-- conciliación aunque quien registra la factura sea Contabilidad, sin el
-- permiso de pagar: solo con la marca que la conciliación deja para ese pago y
-- que nadie más pone. Sin ella, quien tiene el permiso de pagar daba por pagada
-- una factura con el pago de cualquier OC, sin que saliera nada de la caja.
create or replace function public.fn_validar_pago_adquisicion()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_total numeric; v_estado text; v_pagado numeric;
begin
  if new.pago_orden_compra_id is null then
    perform public.exigir_permiso('tesoreria.registrar_pagos');
  elsif current_setting('metalwork.aplica_pago_directo', true) is distinct from new.pago_orden_compra_id::text then
    raise exception 'El pago de la boleta que toma la factura lo anota el sistema solo.' using errcode = 'insufficient_privilege';
  end if;
  select total, estado into v_total, v_estado from public.adquisiciones where id = new.adquisicion_id for update;
  if v_estado <> 'REGISTRADA' then raise exception 'El comprobante debe estar registrado antes del pago.'; end if;
  select coalesce(sum(monto), 0) into v_pagado from public.pagos_adquisicion
   where adquisicion_id = new.adquisicion_id and anulado_en is null;
  if v_pagado + new.monto > v_total then raise exception 'El pago supera el saldo del comprobante.'; end if;
  return new;
end;
$$;
revoke all on function public.fn_validar_pago_adquisicion() from public, anon, authenticated;

-- El pago no se borra ni se corrige (la de la 20261015122000), y el que es el
-- de la boleta lo anula solo la conciliación: si el pago de la boleta estuvo
-- mal, o el proveedor lo devolvió, se anula ese, y la factura deja de tomarlo.
create or replace function public.fn_pago_adquisicion_guardia()
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
  if old.pago_orden_compra_id is not null
     and current_setting('metalwork.aplica_pago_directo', true) is distinct from old.pago_orden_compra_id::text then
    raise exception 'Ese es el pago que se hizo por la boleta de la OC, y la factura lo tomó: no se anula aquí. Si estuvo mal, o el proveedor lo devolvió, Tesorería lo anula en «OC con boleta» y la factura vuelve a deber.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_pago_adquisicion_guardia() from public, anon, authenticated;

-- La conciliación: para cada OC con boleta, qué toma cada una de sus facturas
-- de sus pagos directos. Los pagos, del primero al último; las facturas de su
-- moneda, de la más antigua a la más nueva, cada una con lo que le queda libre
-- (su total menos lo pagado que no es un pago directo de esta OC: sus pagos
-- propios y lo que tomó de otras OC). Cada pago llena lo que puede y lo que
-- sobra pasa a la siguiente. Lo tomado que ya no calza (el pago se anuló, la
-- factura cambió o dejó de ser la de la OC) se anula con su motivo, y lo que
-- falta se agrega, con la fecha del pago de la boleta y quien lo registró. Las
-- facturas y la OC se toman antes de mirar nada: dos conciliaciones de la misma
-- OC no se cruzan, y un pago que esté entrando termina antes. La OC «for no key
-- update»: así no espera a quien le está anexando un documento (que la toma
-- «for key share»), que puede estar esperando esta misma factura.
create or replace function public.conciliar_pago_directo(p_compras uuid[])
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_compras  uuid[] := array(select distinct x from unnest(p_compras) x where x is not null order by 1);
  v_oc       record;
  v_pagos    uuid[];
  v_montos   numeric[];
  v_facturas uuid[];
  v_libres   numeric[];
  v_d_pago   uuid[];
  v_d_fact   uuid[];
  v_d_monto  numeric[];
  v_toma     numeric;
  v_hay      boolean;
  v_x        record;
  v_pago     public.pagos_orden_compra%rowtype;
  v_ref      text;
  i          integer;
  j          integer;
  k          integer;
begin
  if cardinality(v_compras) = 0 then return; end if;
  perform public.bloquear_facturas_de_las_compras(v_compras);
  for v_oc in select c.id, coalesce(c.numero, 'OC ' || c.referencia) as nombre, c.moneda
                from public.ordenes_compra_materiales c
               where c.id = any(v_compras) and not c.con_factura
               order by c.id
                 for no key update loop
    select coalesce(array_agg(p.id order by p.fecha_pago, p.creado_en, p.id), '{}'),
           coalesce(array_agg(p.monto order by p.fecha_pago, p.creado_en, p.id), '{}')
      into v_pagos, v_montos
      from public.pagos_orden_compra p where p.orden_compra_id = v_oc.id and p.anulado_en is null;
    select coalesce(array_agg(a.id order by a.fecha_emision, a.creado_en, a.id), '{}'),
           coalesce(array_agg(a.total - coalesce((select sum(x.monto) from public.pagos_adquisicion x
                                                    where x.adquisicion_id = a.id and x.anulado_en is null
                                                      and not exists (select 1 from public.pagos_orden_compra p
                                                                       where p.id = x.pago_orden_compra_id
                                                                         and p.orden_compra_id = v_oc.id)), 0)
                              order by a.fecha_emision, a.creado_en, a.id), '{}')
      into v_facturas, v_libres
      from public.facturas_de_la_compra(v_oc.id) f
      join public.adquisiciones a on a.id = f.adquisicion_id
     where a.moneda = v_oc.moneda;

    v_d_pago := '{}'; v_d_fact := '{}'; v_d_monto := '{}';
    i := 1; j := 1;
    while i <= cardinality(v_pagos) and j <= cardinality(v_facturas) loop
      if v_libres[j] <= 0 then j := j + 1; continue; end if;
      v_toma := least(v_montos[i], v_libres[j]);
      v_d_pago := v_d_pago || v_pagos[i];
      v_d_fact := v_d_fact || v_facturas[j];
      v_d_monto := v_d_monto || v_toma;
      v_montos[i] := v_montos[i] - v_toma;
      v_libres[j] := v_libres[j] - v_toma;
      if v_montos[i] <= 0 then i := i + 1; end if;
    end loop;

    -- Lo que ya está tomado y calza se queda; lo demás se anula.
    for v_x in select x.id, x.pago_orden_compra_id, x.adquisicion_id, x.monto, x.registrado_por,
                      p.anulado_en as pago_anulado, p.motivo_anulacion as motivo_pago
                 from public.pagos_adquisicion x
                 join public.pagos_orden_compra p on p.id = x.pago_orden_compra_id
                where p.orden_compra_id = v_oc.id and x.anulado_en is null
                order by x.creado_en, x.id loop
      v_hay := false;
      for k in 1 .. cardinality(v_d_pago) loop
        if v_d_monto[k] is not null and v_d_pago[k] = v_x.pago_orden_compra_id
           and v_d_fact[k] = v_x.adquisicion_id and v_d_monto[k] = v_x.monto then
          v_d_monto[k] := null;
          v_hay := true;
          exit;
        end if;
      end loop;
      continue when v_hay;
      perform set_config('metalwork.aplica_pago_directo', v_x.pago_orden_compra_id::text, true);
      update public.pagos_adquisicion
         set anulado_en = now(), anulado_por = coalesce(public.usuario_actual(), v_x.registrado_por),
             motivo_anulacion = left(case when v_x.pago_anulado is not null
                                          then 'Se anuló el pago de la boleta de la ' || v_oc.nombre || ': «' || coalesce(v_x.motivo_pago, '') || '»'
                                          else 'La factura ya no toma así el pago de la boleta de la ' || v_oc.nombre
                                               || ': cambió la factura, su anexo o sus pagos.' end, 500)
       where id = v_x.id;
    end loop;

    -- Lo que falta tomar.
    for k in 1 .. cardinality(v_d_pago) loop
      continue when v_d_monto[k] is null;
      select * into v_pago from public.pagos_orden_compra where id = v_d_pago[k];
      v_ref := left('Pago por la boleta de la ' || v_oc.nombre || ' del ' || to_char(v_pago.fecha_pago, 'DD/MM/YYYY')
                    || coalesce(' · op. ' || btrim(v_pago.operacion), ''), 110);
      if exists (select 1 from public.pagos_adquisicion x
                  where x.adquisicion_id = v_d_fact[k] and x.anulado_en is null and x.referencia = v_ref) then
        v_ref := v_ref || ' · ' || left(v_pago.id::text, 8);
      end if;
      perform set_config('metalwork.aplica_pago_directo', v_pago.id::text, true);
      insert into public.pagos_adquisicion (adquisicion_id, fecha, monto, referencia, registrado_por, pago_orden_compra_id)
      values (v_d_fact[k], v_pago.fecha_pago, v_d_monto[k], v_ref, v_pago.registrado_por, v_pago.id);
    end loop;
    perform set_config('metalwork.aplica_pago_directo', '', true);
  end loop;
  perform public.avisar_pago_directo(v_compras);
end;
$$;
comment on function public.conciliar_pago_directo(uuid[]) is
  'Rehace, para cada OC con boleta, qué toman sus facturas registradas de sus pagos directos: anula con su motivo lo que ya no calza, agrega lo que falta y avisa a Tesorería. La llaman los disparadores y las funciones que cambian la factura, el anexo o los pagos. Ayudante interno.';
revoke all on function public.conciliar_pago_directo(uuid[]) from public, anon, authenticated;

-- Lo que Tesorería tiene que saber de cada OC con boleta pagada directo, sin
-- repetirlo (uno por persona mientras no lo lea), y dando por leído lo que ya no
-- corre:
--   · Pagada de más: la factura que llegó después ya estaba pagada, o es por
--     menos. Se pide la devolución; devuelta, se anula el pago que el proveedor
--     devolvió (el de la factura o el de la boleta) y la cuenta se rehace. Si la
--     factura es por menos, se anula el de la boleta y la factura se paga con
--     ese mismo voucher por lo que tomaba.
--   · El anexo por revisar: Logística le anexó una factura que Contabilidad
--     registró para otras OC y que no alcanza para esta. La factura no toma el
--     pago; si la OC sí era parte de ella, que no se pague dos veces.
--   · La factura en otra moneda: no toma el pago, y no se paga encima.
create or replace function public.avisar_pago_directo(p_compras uuid[])
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_oc     record;
  v_pd     record;
  v_e      record;
  v_n      integer;
  v_monto  numeric;
  v_propio numeric;
  v_s      text;
  v_titulo text;
  v_cuerpo text;
begin
  for v_oc in select c.id, coalesce(c.numero, 'OC ' || c.referencia) as nombre, c.moneda
                from public.ordenes_compra_materiales c
               where c.id = any(p_compras) and not c.con_factura loop
    select count(*), coalesce(sum(p.monto), 0) into v_n, v_monto
      from public.pagos_orden_compra p where p.orden_compra_id = v_oc.id and p.anulado_en is null;
    select * into v_pd from public.pago_directo_de_la_compra(v_oc.id);
    select e.numero, e.origen into v_e from public.comprobante_en_camino(v_oc.id) e;
    v_s := case when v_oc.moneda = 'USD' then 'US$ ' else 'S/ ' end;
    v_titulo := null;
    if v_n > 0 and coalesce(v_pd.de_mas, 0) > 0 then
      -- Lo que Tesorería le pagó a la factura misma, no lo que tomó de las boletas.
      select coalesce(sum(x.monto), 0) into v_propio
        from public.facturas_de_la_compra(v_oc.id) f
        join public.pagos_adquisicion x on x.adquisicion_id = f.adquisicion_id
       where x.anulado_en is null and x.pago_orden_compra_id is null;
      v_titulo := 'Compra pagada de más: ' || v_oc.nombre;
      v_cuerpo := 'La ' || v_oc.nombre || ' se pagó por su boleta (' || v_s || to_char(v_monto, 'FM999G999G990D00') || ')'
               || case when v_propio > 0
                       then ' y también por su factura ' || v_pd.factura || ', que Tesorería ya había pagado: se pagaron '
                            || v_s || to_char(v_pd.de_mas, 'FM999G999G990D00') || ' de más. Pide al proveedor la devolución; cuando la devuelva, anula el pago que te devolvió (el de la factura, en «Facturas por pagar», o el de la boleta, en «OC con boleta») y la cuenta se rehace.'
                       else ' y su factura ' || v_pd.factura || ', que llegó después, es por menos: la factura tomó '
                            || v_s || to_char(v_pd.aplicado, 'FM999G999G990D00') || ' de ese pago y se pagaron '
                            || v_s || to_char(v_pd.de_mas, 'FM999G999G990D00') || ' de más. Pide al proveedor la devolución; cuando la devuelva, anula el pago de la boleta en «OC con boleta» y paga la factura con ese mismo voucher por '
                            || v_s || to_char(v_pd.aplicado, 'FM999G999G990D00') || '.' end;
    elsif v_n > 0 and v_e.origen = 'REGISTRADA' then
      v_titulo := 'Factura anexada por revisar: ' || v_oc.nombre;
      v_cuerpo := 'Logística anexó a la ' || v_oc.nombre || ', que pagaste por su boleta, la factura ' || v_e.numero
               || ', que Contabilidad registró para otras OC y que no alcanza para esta: la factura no toma ese pago. Si el anexo fue por error, que Logística lo anule. Si la OC sí era parte de esa factura, no la pagues dos veces: pregúntale a Contabilidad.';
    elsif v_n > 0 and coalesce(v_pd.otra_moneda, false) then
      v_titulo := 'Factura en otra moneda: ' || v_oc.nombre;
      v_cuerpo := 'La ' || v_oc.nombre || ' se pagó por su boleta en ' || case when v_oc.moneda = 'USD' then 'dólares' else 'soles' end
               || ' y su factura ' || v_pd.factura || ' va en ' || case when v_oc.moneda = 'USD' then 'soles' else 'dólares' end
               || ': el sistema no la da por pagada con ese pago, y no se paga encima. Si la factura reemplaza a la boleta, anula ese pago en «OC con boleta» y paga la factura con el mismo voucher.';
    end if;
    update public.notificaciones set leida_en = now()
     where origen_id = v_oc.id and leida_en is null
       and titulo in ('Compra pagada de más: ' || v_oc.nombre, 'Factura anexada por revisar: ' || v_oc.nombre,
                      'Factura en otra moneda: ' || v_oc.nombre)
       and titulo is distinct from v_titulo;
    continue when v_titulo is null;
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
comment on function public.avisar_pago_directo(uuid[]) is
  'Avisa a Tesorería de cada OC con boleta pagada directo cuya factura la dejó pagada de más, cuyo anexo está por revisar o cuya factura va en otra moneda, y da por leídos los avisos de esa OC que ya no corren. Ayudante interno de la conciliación.';
revoke all on function public.avisar_pago_directo(uuid[]) from public, anon, authenticated;

-- La factura en otra moneda que la OC con boleta que Tesorería ya pagó directo
-- no toma ese pago (el sistema no convierte): no se paga encima mientras ese
-- pago siga vigente. Las demás facturas de una OC pagada directo ya lo tomaron y
-- solo deben lo que les falta: basta la validación de su saldo.
create or replace function public.fn_factura_sin_pago_directo()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_adq    public.adquisiciones%rowtype;
  v_nombre text;
begin
  if tg_table_name <> 'pagos_adquisicion' or new.anulado_en is not null or new.pago_orden_compra_id is not null then
    return new;
  end if;
  select * into v_adq from public.adquisiciones where id = new.adquisicion_id;
  select coalesce(c.numero, 'OC ' || c.referencia) into v_nombre
    from public.ordenes_compra_materiales c
   where c.id = any(public.compras_de_la_factura(v_adq)) and not c.con_factura and c.moneda <> v_adq.moneda
     and exists (select 1 from public.facturas_de_la_compra(c.id) f where f.adquisicion_id = v_adq.id)
     and exists (select 1 from public.pagos_orden_compra p where p.orden_compra_id = c.id and p.anulado_en is null)
   order by c.numero
   limit 1;
  if v_nombre is not null then
    raise exception 'Tesorería ya pagó la % directo, por su boleta, en otra moneda que esta factura: el sistema no la da por pagada con ese pago, y no se paga encima. Si la factura reemplaza a la boleta, primero se anula ese pago en «OC con boleta» y después se paga aquí con el mismo voucher.',
      v_nombre using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_factura_sin_pago_directo() from public, anon, authenticated;
create or replace trigger trg_pago_factura_sin_pago_directo
  before insert on public.pagos_adquisicion
  for each row execute function public.fn_factura_sin_pago_directo();

-- Anulado un pago propio de la factura (el proveedor lo devolvió, o estuvo mal),
-- la factura vuelve a tener lugar: si una OC con boleta suya quedó pagada de más
-- por la boleta, la factura lo toma.
create or replace function public.fn_conciliar_por_pago_de_factura()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_adq public.adquisiciones%rowtype;
begin
  if new.pago_orden_compra_id is not null or old.anulado_en is not null or new.anulado_en is null then return null; end if;
  select * into v_adq from public.adquisiciones where id = new.adquisicion_id;
  perform public.conciliar_pago_directo(public.compras_de_la_factura(v_adq));
  return null;
end;
$$;
revoke all on function public.fn_conciliar_por_pago_de_factura() from public, anon, authenticated;
create or replace trigger trg_conciliar_por_pago_de_factura
  after update on public.pagos_adquisicion
  for each row execute function public.fn_conciliar_por_pago_de_factura();

-- La OC con boleta de antes que no se pagó: Tesorería la pasa a su lista y se
-- paga como las de ahora. Solo de falso a verdadero, y no la que ya tiene
-- comprobante registrado o en camino (se paga por ahí). Quién y cuándo quedan
-- en la auditoría.
create or replace function public.pasar_compra_a_tesoreria(p_compra uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_oc     public.ordenes_compra_materiales%rowtype;
  v_nombre text;
  v_fact   text;
  v_origen text;
  v_alcanza boolean;
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
    from public.facturas_de_la_compra(p_compra) f
    join public.adquisiciones a on a.id = f.adquisicion_id
   order by a.fecha_emision, a.creado_en
   limit 1;
  if v_fact is not null then
    raise exception 'Contabilidad ya registró el comprobante % de la %: se paga por él en «Facturas por pagar».', v_fact, v_nombre
      using errcode = 'check_violation';
  end if;
  select e.numero, e.origen, e.alcanza into v_fact, v_origen, v_alcanza from public.comprobante_en_camino(p_compra) e;
  if v_origen = 'BORRADOR' then
    raise exception 'Contabilidad tiene en borrador el comprobante % de la %: se paga por él en Cuentas por pagar cuando lo registre.', v_fact, v_nombre
      using errcode = 'check_violation';
  elsif v_origen = 'REGISTRADA' then
    raise exception 'Logística anexó a la % la factura %, que Contabilidad registró para otras OC y que no alcanza para esta: si el anexo fue por error, que Logística lo anule.', v_nombre, v_fact
      using errcode = 'check_violation';
  elsif v_origen = 'LOGISTICA' then
    raise exception 'Logística anexó a la % la factura % del proveedor: Contabilidad la registra y se paga por ella en Cuentas por pagar.', v_nombre, v_fact
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

-- La misma factura no entra dos veces a Adquisiciones, y la que Logística anexó
-- a una OC con boleta queda ligada a ella. Antes se pedía elegirla en «Factura
-- que anexó Logística» y se rechazaba a mano: con el proveedor escrito de otra
-- forma, o el número sin guion, entraba igual y la quinta auditoría la pagó dos
-- veces. Corre antes que `proteger_adquisicion` (los disparadores del mismo
-- momento van por orden de nombre), que valida la OC que este le pone. Quien no
-- registra comprobantes no pasa de aquí sin que el RLS lo rechace con su
-- mensaje, así que con él no se busca nada.
--   · El anexo elegido: que Logística no lo haya anulado, al elegirlo y al pasar
--     el borrador a registrada (lo pudo anular entre los dos pasos); al darla de
--     alta, su proveedor pasa a ser el de la OC (así su clave es la del anexo).
--   · Duplicado: otra con el mismo número y el mismo proveedor, por las claves de
--     la sección 4 (y su tipo de sociedad, si las dos lo dicen), al darla de alta
--     o al cambiarle número o proveedor. Con candado por la clave: dos altas a la
--     vez no se cruzan. Solo los comprobantes con serie y número: «S/N» no es un
--     número, y «Otro» puede ser una nota de crédito con el número de la factura.
--   · Al darla de alta sin OC ni anexo elegido, y no como «Otro» (la nota de
--     crédito lleva el número de su factura): si Logística anexó esa factura a
--     una OC con boleta que la puede llevar (aprobada, en la lista de Tesorería,
--     la misma condición de pago, OT y unidad, sin su factura completa), se liga
--     sola a ella; si Tesorería ya la pagó directo, la factura toma ese pago
--     (sección 6). Si esa OC ya tiene su factura (otra eligió
--     ese anexo, o tiene una completa), se rechaza: es la misma factura con el
--     número corregido, o el anexo está mal; quedaba sin OC y se pagaba dos veces.
--     Si ninguna la puede llevar por otra razón, queda sin OC y la OC se paga por
--     ella igual (sección 4). Solo al darla de alta: el vínculo lo crea el
--     disparador que corre después del INSERT.
--   · Al corregirla: cada OC con boleta de la que era la factura por un anexo lo
--     sigue siendo, por ese anexo o por otro de la misma OC. Si eligió el anexo,
--     lo sigue siendo aunque cambie el número (el PDF es ese), y la serie que
--     deja libre no se da de alta otra vez (el punto de arriba). Si solo la
--     ligaba el número, cambiarlo la soltaba: se rechaza, y si el número estaba
--     mal escrito también en el anexo, Logística anexa primero el bueno. Y no se
--     le quita la OC de la cabecera que tiene anexada esta factura: la OC
--     quedaba atada a una factura que ya no la cubría y nadie la podía pagar.
create or replace function public.fn_adquisicion_factura_unica()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_numero    text;
  v_proveedor text;
  v_doc       record;
  v_otra      record;
  v_suelto    record;
begin
  if not (public.es_admin() or public.tiene_permiso('adquisiciones.registrar')) then return new; end if;

  if new.documento_compra_id is not null
     and (tg_op = 'INSERT' or new.documento_compra_id is distinct from old.documento_compra_id
          or (new.estado = 'REGISTRADA' and old.estado is distinct from 'REGISTRADA')) then
    select d.anulado_en, coalesce(d.numero_documento, d.nombre_archivo) as numero, c.proveedor, c.con_factura,
           coalesce(c.numero, 'OC ' || c.referencia) as compra into v_doc
      from public.documentos_compra_material d
      join public.ordenes_compra_materiales c on c.id = d.orden_compra_id
     where d.id = new.documento_compra_id;
    if found and v_doc.anulado_en is not null then
      raise exception 'Logística anuló la factura % que había anexado a la %: elige otra o adjunta el PDF.', v_doc.numero, v_doc.compra
        using errcode = 'check_violation';
    end if;
    if found and tg_op = 'INSERT' and not v_doc.con_factura and nullif(btrim(v_doc.proveedor), '') is not null then
      new.proveedor := btrim(v_doc.proveedor);
    end if;
  end if;

  v_numero := public.clave_numero_comprobante(new.numero_documento);
  v_proveedor := public.clave_proveedor(new.proveedor);
  if new.tipo <> 'OTRO' and v_numero ~ '^[A-Z0-9]{1,4}-[0-9]+$' and v_proveedor is not null
     and (tg_op = 'INSERT'
          or v_numero is distinct from public.clave_numero_comprobante(old.numero_documento)
          or v_proveedor is distinct from public.clave_proveedor(old.proveedor)
          or public.sufijo_societario(new.proveedor) is distinct from public.sufijo_societario(old.proveedor)
          or new.tipo is distinct from old.tipo) then
    perform pg_advisory_xact_lock(hashtextextended('adquisicion|' || v_numero || '|' || v_proveedor, 0));
    select a.estado, a.numero_documento, a.proveedor, a.registrado_por = public.usuario_actual() as mia,
           to_char((a.creado_en at time zone 'America/Lima')::date, 'DD/MM/YYYY') as dia,
           nullif(btrim(coalesce(u.nombres, '') || ' ' || coalesce(u.apellidos, '')), '') as autor into v_otra
      from public.adquisiciones a
      left join public.usuarios u on u.id = a.registrado_por
     where public.clave_numero_comprobante(a.numero_documento) = v_numero
       and public.clave_proveedor(a.proveedor) = v_proveedor
       and public.mismo_proveedor(a.proveedor, new.proveedor)
       and a.tipo <> 'OTRO'
       and a.id is distinct from new.id
     order by a.estado = 'REGISTRADA' desc, a.creado_en
     limit 1;
    if found and v_otra.estado = 'BORRADOR' and coalesce(v_otra.mia, false) then
      raise exception 'Ya tienes en borrador el comprobante % de % desde el %: complétalo en vez de darlo de alta otra vez.',
        v_otra.numero_documento, v_otra.proveedor, v_otra.dia using errcode = 'unique_violation';
    elsif found and v_otra.estado = 'BORRADOR' then
      raise exception 'El comprobante % de % está en borrador de % desde el %: que lo complete. Si es de otra empresa con el mismo nombre, las dos tienen que llevar su razón social completa, con su S.A.C. o E.I.R.L.',
        v_otra.numero_documento, v_otra.proveedor, coalesce(v_otra.autor, 'otra persona'), v_otra.dia using errcode = 'unique_violation';
    elsif found then
      raise exception 'El comprobante % de % ya está registrado en Adquisiciones desde el %. Si es de otra empresa con el mismo nombre, las dos tienen que llevar su razón social completa, con su S.A.C. o E.I.R.L.: corrige la que no la tenga.',
        v_otra.numero_documento, v_otra.proveedor, v_otra.dia using errcode = 'unique_violation';
    end if;
  end if;

  if tg_op = 'INSERT' and new.orden_compra_id is null and new.documento_compra_id is null and new.tipo <> 'OTRO'
     and v_numero is not null and v_proveedor is not null then
    select d.id as documento_id, d.orden_compra_id into v_suelto
      from public.documentos_compra_material d
      join public.ordenes_compra_materiales c on c.id = d.orden_compra_id
      left join public.requerimientos_materiales r on r.id = c.requerimiento_id
     where public.clave_numero_comprobante(d.numero_documento) = v_numero
       and d.tipo = 'FACTURA' and d.anulado_en is null
       and not c.con_factura and c.pago_en_tesoreria and c.aprobacion in ('APROBADA', 'NO_REQUERIDA')
       and public.mismo_proveedor(c.proveedor, new.proveedor)
       and c.condicion_pago = new.condicion_pago
       and (c.origen = 'DIRECTA' or (r.orden_id is not null and (new.orden_id is null or new.orden_id = r.orden_id)))
       and (new.unidad_id is null or coalesce(new.orden_id, r.orden_id) is null
            or exists (select 1 from public.ordenes_trabajo o
                        where o.id = coalesce(new.orden_id, r.orden_id) and o.unidad_id = new.unidad_id))
       and not exists (select 1 from public.adquisiciones x where x.documento_compra_id = d.id)
       and not exists (select 1 from public.adquisiciones_ordenes_compra l
                         join public.adquisiciones a on a.id = l.adquisicion_id
                        where l.orden_compra_id = c.id and l.quitada_en is null and not l.parcial and a.estado = 'REGISTRADA')
     order by d.creado_en
     limit 1;
    if found then
      new.orden_compra_id := v_suelto.orden_compra_id;
      new.documento_compra_id := v_suelto.documento_id;
    else
      select coalesce(d.numero_documento, d.nombre_archivo) as numero, coalesce(c.numero, 'OC ' || c.referencia) as compra,
             coalesce(x.numero_documento, y.numero_documento) as suya into v_otra
        from public.documentos_compra_material d
        join public.ordenes_compra_materiales c on c.id = d.orden_compra_id
        left join lateral (select a.numero_documento from public.adquisiciones a where a.documento_compra_id = d.id
                            order by a.estado = 'REGISTRADA' desc, a.creado_en limit 1) x on true
        left join lateral (select a.numero_documento
                             from public.adquisiciones_ordenes_compra l
                             join public.adquisiciones a on a.id = l.adquisicion_id
                            where l.orden_compra_id = c.id and l.quitada_en is null and not l.parcial and a.estado = 'REGISTRADA'
                            order by a.creado_en limit 1) y on true
       where public.clave_numero_comprobante(d.numero_documento) = v_numero
         and d.tipo = 'FACTURA' and d.anulado_en is null and not c.con_factura
         and public.mismo_proveedor(c.proveedor, new.proveedor)
         and coalesce(x.numero_documento, y.numero_documento) is not null
       order by d.creado_en
       limit 1;
      if found then
        raise exception 'Logística anexó la factura % a la %, que ya tiene su factura % en Adquisiciones: si es la misma con el número o el proveedor corregido, corrige esa en vez de registrarla otra vez; si es otra parte de la compra, corrige esa para marcar la OC como parcial y registra esta eligiéndola en «Factura que anexó Logística».',
          v_otra.numero, v_otra.compra, v_otra.suya using errcode = 'unique_violation';
      end if;
    end if;
  end if;

  if tg_op = 'UPDATE' and old.estado = 'REGISTRADA'
     and (new.numero_documento, new.proveedor, new.documento_compra_id, new.orden_compra_id, new.tipo)
         is distinct from (old.numero_documento, old.proveedor, old.documento_compra_id, old.orden_compra_id, old.tipo) then
    select coalesce(d.numero_documento, d.nombre_archivo) as numero, coalesce(c.numero, 'OC ' || c.referencia) as compra into v_doc
      from public.anexos_de_la_factura(old) x
      join public.documentos_compra_material d on d.id = x.documento_id
      join public.ordenes_compra_materiales c on c.id = x.orden_compra_id
     where not exists (select 1 from public.anexos_de_la_factura(new) y
                        where y.orden_compra_id = x.orden_compra_id)
     order by d.creado_en
     limit 1;
    if found then
      raise exception 'Esta factura es la % que Logística anexó a la %: si el número está mal escrito también en el anexo, que Logística anexe primero a esa OC la factura con el número bueno; si no es de esa OC, que anule ese anexo antes de corregirla.',
        v_doc.numero, v_doc.compra using errcode = 'check_violation';
    end if;
    if old.orden_compra_id is not null and new.orden_compra_id is distinct from old.orden_compra_id then
      select coalesce(d.numero_documento, d.nombre_archivo) as numero, coalesce(c.numero, 'OC ' || c.referencia) as compra into v_doc
        from public.anexos_de_la_factura(new) x
        join public.documentos_compra_material d on d.id = x.documento_id
        join public.ordenes_compra_materiales c on c.id = x.orden_compra_id
       where x.orden_compra_id = old.orden_compra_id
       order by d.creado_en
       limit 1;
      if found then
        raise exception 'La % tiene anexada esta factura (%): si no es de esa OC, que Logística anule ese anexo antes de quitársela.',
          v_doc.compra, v_doc.numero using errcode = 'check_violation';
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.fn_adquisicion_factura_unica() from public, anon, authenticated;
create or replace trigger adquisicion_factura_unica
  before insert or update on public.adquisiciones
  for each row execute function public.fn_adquisicion_factura_unica();

-- Lo mismo cuando la corrección le quita a la factura una OC que no es la de su
-- cabecera: `corregir_factura_compra` escribe primero la factura y después los
-- vínculos, así que aquí se mira la factura ya corregida.
create or replace function public.fn_vinculo_con_anexo()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_sale uuid;
  v_adq  public.adquisiciones%rowtype;
  v_doc  record;
begin
  if old.quitada_en is not null then return new; end if;
  v_sale := case when new.quitada_en is not null or new.orden_compra_id is distinct from old.orden_compra_id
                 then old.orden_compra_id end;
  if v_sale is null then return new; end if;
  select * into v_adq from public.adquisiciones where id = old.adquisicion_id;
  if v_adq.estado is distinct from 'REGISTRADA' then return new; end if;
  select coalesce(d.numero_documento, d.nombre_archivo) as numero, coalesce(c.numero, 'OC ' || c.referencia) as compra into v_doc
    from public.anexos_de_la_factura(v_adq) x
    join public.documentos_compra_material d on d.id = x.documento_id
    join public.ordenes_compra_materiales c on c.id = x.orden_compra_id
   where x.orden_compra_id = v_sale
   order by d.creado_en
   limit 1;
  if found then
    raise exception 'La % tiene anexada esta factura (%): si no es de esa OC, que Logística anule ese anexo antes de quitársela.',
      v_doc.compra, v_doc.numero using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_vinculo_con_anexo() from public, anon, authenticated;
create or replace trigger trg_vinculo_con_anexo
  before update on public.adquisiciones_ordenes_compra
  for each row execute function public.fn_vinculo_con_anexo();

-- Las OC cuya factura pudo cambiar, para conciliar su pago directo y avisar a
-- Tesorería: la del documento que Logística anexa o anula; las de la factura que
-- se registra o se corrige, con su fila de antes y la de después; y la del
-- vínculo que se agrega, se quita o cambia, con las de su factura. La
-- corrección de Adquisiciones escribe la factura y después sus vínculos:
-- concilia una sola vez, al final (`corregir_factura_compra`), y no a cada paso
-- con la factura a medio corregir.
create or replace function public.fn_conciliar_pago_directo()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_compras uuid[];
  v_adq     public.adquisiciones%rowtype;
begin
  if current_setting('metalwork.corrigiendo', true) = 'factura' then return null; end if;
  if tg_table_name = 'documentos_compra_material' then
    if new.tipo <> 'FACTURA' or (tg_op = 'UPDATE' and new.anulado_en is not distinct from old.anulado_en) then
      return null;
    end if;
    v_compras := array[new.orden_compra_id];
  elsif tg_table_name = 'adquisiciones' then
    if tg_op = 'INSERT' then
      if new.estado <> 'REGISTRADA' then return null; end if;
      v_compras := public.compras_de_la_factura(new);
    else
      if 'REGISTRADA' not in (new.estado, old.estado)
         or (new.estado, new.total, new.moneda, new.numero_documento, new.proveedor, new.documento_compra_id,
             new.orden_compra_id, new.tipo, new.fecha_emision)
            is not distinct from (old.estado, old.total, old.moneda, old.numero_documento, old.proveedor, old.documento_compra_id,
                                  old.orden_compra_id, old.tipo, old.fecha_emision) then
        return null;
      end if;
      v_compras := public.compras_de_la_factura(old) || public.compras_de_la_factura(new);
    end if;
  else
    if tg_op = 'UPDATE' and (new.quitada_en, new.orden_compra_id, new.adquisicion_id, new.parcial)
                            is not distinct from (old.quitada_en, old.orden_compra_id, old.adquisicion_id, old.parcial) then
      return null;
    end if;
    select * into v_adq from public.adquisiciones a where a.id = new.adquisicion_id;
    if v_adq.estado is distinct from 'REGISTRADA' then return null; end if;
    v_compras := array[new.orden_compra_id] || public.compras_de_la_factura(v_adq)
              || case when tg_op = 'UPDATE' then array[old.orden_compra_id] else '{}'::uuid[] end;
  end if;
  perform public.conciliar_pago_directo(v_compras);
  return null;
end;
$$;
revoke all on function public.fn_conciliar_pago_directo() from public, anon, authenticated;
create or replace trigger trg_conciliar_pago_directo_documento
  after insert or update on public.documentos_compra_material
  for each row execute function public.fn_conciliar_pago_directo();
create or replace trigger trg_conciliar_pago_directo_adquisicion
  after insert or update on public.adquisiciones
  for each row execute function public.fn_conciliar_pago_directo();
create or replace trigger trg_conciliar_pago_directo_vinculo
  after insert or update on public.adquisiciones_ordenes_compra
  for each row execute function public.fn_conciliar_pago_directo();

-- Corregir la factura: la de la 20261016701000 con dos cambios por la sección 6.
-- El total no baja de lo que Tesorería le pagó, y la moneda no cambia si le
-- pagó algo, pero el pago de la boleta que la factura tomó no cuenta para eso:
-- con él, Contabilidad no podía corregir el total mal escrito de la factura de
-- una OC pagada directo. Y la conciliación corre una vez, al final, con las OC
-- de antes y las de después: los disparadores no la corren a cada paso, con la
-- factura escrita y sus vínculos todavía sin escribir.
create or replace function public.corregir_factura_compra(
  p_correccion uuid, p_id uuid, p_motivo text, p_justificante text, p_nombre text, p_cambios jsonb
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_adq       public.adquisiciones%rowtype;
  v_nueva     public.adquisiciones%rowtype;
  v_antes     jsonb;
  v_despues   jsonb;
  v_pagado    numeric;
  v_ordenes   uuid[];
  v_actuales  uuid[];
  v_parciales uuid[];
  v_parciales_antes uuid[];
  v_oc        uuid;
  v_otra      text;
  v_principal uuid;
  v_doc_oc    uuid;
  v_lectura   jsonb;
  v_compras   uuid[];
begin
  perform public.exigir_permiso('adquisiciones.registrar');
  select * into v_adq from public.adquisiciones where id = p_id for update;
  if not found then raise exception 'El comprobante no existe.'; end if;
  if exists (select 1 from public.correcciones where id = p_correccion and documento_id = p_id) then
    return p_id;
  end if;
  if v_adq.estado <> 'REGISTRADA' then
    raise exception 'El comprobante % está en borrador: complétalo, no hace falta corregirlo.', v_adq.numero_documento
      using errcode = 'check_violation';
  end if;
  if p_cambios is null or jsonb_typeof(p_cambios) <> 'object' then
    raise exception 'Vuelve a cargar la pantalla.' using errcode = 'check_violation';
  end if;
  -- Lo que Tesorería le pagó: el pago de la boleta que tomó no cuenta, se rehace al final.
  select coalesce(sum(monto), 0) into v_pagado from public.pagos_adquisicion
   where adquisicion_id = p_id and anulado_en is null and pago_orden_compra_id is null;
  v_compras := public.compras_de_la_factura(v_adq);
  v_actuales := array(select l.orden_compra_id from public.adquisiciones_ordenes_compra l
                       where l.adquisicion_id = p_id and l.quitada_en is null order by l.creado_en);
  v_parciales_antes := array(select l.orden_compra_id from public.adquisiciones_ordenes_compra l
                              where l.adquisicion_id = p_id and l.quitada_en is null and l.parcial order by l.creado_en);
  v_antes := to_jsonb(v_adq) - 'actualizado_en' - 'lectura_en'
             || jsonb_build_object('ordenes', to_jsonb(v_actuales), 'parciales', to_jsonb(v_parciales_antes));

  v_nueva := v_adq;
  begin
    v_nueva.proveedor := coalesce(btrim(p_cambios->>'proveedor'), v_adq.proveedor);
    v_nueva.numero_documento := coalesce(btrim(p_cambios->>'numero_documento'), v_adq.numero_documento);
    v_nueva.fecha_emision := coalesce((p_cambios->>'fecha_emision')::date, v_adq.fecha_emision);
    v_nueva.fecha_vencimiento := coalesce((p_cambios->>'fecha_vencimiento')::date, v_adq.fecha_vencimiento);
    v_nueva.moneda := coalesce(p_cambios->>'moneda', v_adq.moneda);
    v_nueva.total := coalesce((p_cambios->>'total')::numeric, v_adq.total);
    v_nueva.condicion_pago := coalesce(p_cambios->>'condicion_pago', v_adq.condicion_pago);
    v_nueva.observacion := coalesce(p_cambios->>'observacion', v_adq.observacion);
    v_nueva.ruta_storage := coalesce(nullif(p_cambios->>'pdf_ruta', ''), v_adq.ruta_storage);
    v_ordenes := case when p_cambios ? 'ordenes'
                      then array(select distinct x::uuid from jsonb_array_elements_text(p_cambios->'ordenes') x)
                      else v_actuales end;
    v_parciales := case when p_cambios ? 'parciales'
                        then array(select distinct x::uuid from jsonb_array_elements_text(p_cambios->'parciales') x)
                        else v_parciales_antes end;
  exception when others then
    raise exception 'Revisa los datos de la corrección.' using errcode = 'check_violation';
  end;
  v_parciales := array(select p from unnest(v_parciales) p where p = any (v_ordenes));
  if v_nueva.total <= 0 or v_nueva.total <> round(v_nueva.total, 2) then
    raise exception 'El total va con IGV, mayor que cero, con hasta dos decimales.' using errcode = 'check_violation';
  end if;
  if v_nueva.total < v_pagado then
    raise exception 'Tesorería ya pagó % de esta factura: el total no puede quedar por debajo.', v_pagado using errcode = 'check_violation';
  end if;
  if v_nueva.moneda is distinct from v_adq.moneda and v_pagado > 0 then
    raise exception 'La factura ya tiene pagos: su moneda no cambia. Anula primero los pagos.' using errcode = 'check_violation';
  end if;
  if v_nueva.condicion_pago = 'CONTADO' and v_nueva.fecha_vencimiento <> v_nueva.fecha_emision then
    v_nueva.fecha_vencimiento := v_nueva.fecha_emision;
  end if;
  if cardinality(v_ordenes) > 40 then
    raise exception 'Una factura cubre hasta 40 OC.' using errcode = 'check_violation';
  end if;
  if v_nueva.ruta_storage is distinct from v_adq.ruta_storage
     and v_nueva.ruta_storage !~ ('^adquisiciones/' || p_id::text || '/correccion-[0-9a-f-]{36}\.pdf$') then
    raise exception 'Vuelve a adjuntar el PDF corregido de la factura.' using errcode = 'check_violation';
  end if;

  -- Cada OC nueva, o que esta factura pasa a completar, no la completa otra factura registrada.
  foreach v_oc in array v_ordenes loop
    if v_oc = any (v_actuales) and (v_oc = any (v_parciales) or not (v_oc = any (v_parciales_antes))) then continue; end if;
    select a.numero_documento into v_otra
      from public.adquisiciones_ordenes_compra l join public.adquisiciones a on a.id = l.adquisicion_id
     where l.orden_compra_id = v_oc and l.quitada_en is null and not l.parcial and a.estado = 'REGISTRADA' and a.id <> p_id limit 1;
    if v_otra is not null then
      raise exception 'Una de las OC ya tiene su factura completa (%): corrige esa factura primero.', v_otra using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.ordenes_compra_materiales c where c.id = v_oc and c.con_factura) then
      raise exception 'Una de las OC no existe o va sin factura.' using errcode = 'check_violation';
    end if;
  end loop;

  -- La principal fija la OT y el PDF de Logística: si sale, otra de las que quedan.
  v_principal := case when v_adq.orden_compra_id = any (v_ordenes) then v_adq.orden_compra_id else v_ordenes[1] end;
  if v_nueva.documento_compra_id is not null then
    select d.orden_compra_id into v_doc_oc from public.documentos_compra_material d where d.id = v_nueva.documento_compra_id;
    if v_doc_oc = any (v_ordenes) then
      v_principal := v_doc_oc;
    elsif v_nueva.ruta_storage is not null then
      v_nueva.documento_compra_id := null;
    else
      raise exception 'Esta factura usa el PDF que Logística subió a una OC que quitas: adjunta el PDF de la factura.'
        using errcode = 'check_violation';
    end if;
  end if;
  v_nueva.orden_compra_id := v_principal;
  if v_principal is null then v_nueva.orden_id := null; end if;

  v_lectura := p_cambios->'lectura';
  perform set_config('metalwork.corrigiendo', 'factura', true);
  update public.adquisiciones
     set proveedor = v_nueva.proveedor, numero_documento = v_nueva.numero_documento,
         fecha_emision = v_nueva.fecha_emision, fecha_vencimiento = v_nueva.fecha_vencimiento,
         moneda = v_nueva.moneda, total = v_nueva.total, condicion_pago = v_nueva.condicion_pago,
         observacion = v_nueva.observacion, ruta_storage = v_nueva.ruta_storage,
         documento_compra_id = v_nueva.documento_compra_id, orden_compra_id = v_nueva.orden_compra_id,
         orden_id = case when v_nueva.orden_compra_id is distinct from v_adq.orden_compra_id then null else orden_id end,
         lectura_fuente = case when jsonb_typeof(v_lectura) = 'object' then v_lectura->>'fuente' else lectura_fuente end,
         lectura_total = case when jsonb_typeof(v_lectura) = 'object' then (v_lectura->>'total')::numeric else lectura_total end,
         lectura_moneda = case when jsonb_typeof(v_lectura) = 'object' then v_lectura->>'moneda' else lectura_moneda end,
         lectura_numero = case when jsonb_typeof(v_lectura) = 'object' then v_lectura->>'numero' else lectura_numero end,
         lectura_ordenes = case when jsonb_typeof(v_lectura) = 'object'
                                then array(select jsonb_array_elements_text(coalesce(v_lectura->'ordenes', '[]'::jsonb)))
                                else lectura_ordenes end
   where id = p_id;
  -- Las que salen quedan quitadas; las que vuelven se reactivan; las nuevas se enlazan.
  update public.adquisiciones_ordenes_compra set quitada_en = now(), quitada_por = public.usuario_actual()
   where adquisicion_id = p_id and quitada_en is null and not (orden_compra_id = any (v_ordenes));
  update public.adquisiciones_ordenes_compra set quitada_en = null, quitada_por = null
   where adquisicion_id = p_id and quitada_en is not null and orden_compra_id = any (v_ordenes);
  insert into public.adquisiciones_ordenes_compra (adquisicion_id, orden_compra_id, parcial)
  select p_id, o, o = any (v_parciales) from unnest(v_ordenes) o
   where not exists (select 1 from public.adquisiciones_ordenes_compra l where l.adquisicion_id = p_id and l.orden_compra_id = o)
  on conflict (adquisicion_id, orden_compra_id) do nothing;
  update public.adquisiciones_ordenes_compra set parcial = (orden_compra_id = any (v_parciales))
   where adquisicion_id = p_id and quitada_en is null and parcial is distinct from (orden_compra_id = any (v_parciales));
  perform set_config('metalwork.corrigiendo', '', true);

  -- Que todas las OC que quedan sean del mismo proveedor y la misma condición que la factura.
  if exists (select 1 from public.adquisiciones_ordenes_compra l
               join public.ordenes_compra_materiales c on c.id = l.orden_compra_id
              where l.adquisicion_id = p_id and l.quitada_en is null and c.condicion_pago <> v_nueva.condicion_pago) then
    raise exception 'Las OC de la factura tienen que ir con la misma condición de pago que ella.' using errcode = 'check_violation';
  end if;
  if (select count(distinct coalesce(c.proveedor_id::text, upper(btrim(c.proveedor))))
        from public.adquisiciones_ordenes_compra l join public.ordenes_compra_materiales c on c.id = l.orden_compra_id
       where l.adquisicion_id = p_id and l.quitada_en is null) > 1 then
    raise exception 'Una factura es de un solo proveedor: sus OC tienen que ser del mismo.' using errcode = 'check_violation';
  end if;

  select * into v_nueva from public.adquisiciones where id = p_id;
  v_despues := to_jsonb(v_nueva) - 'actualizado_en' - 'lectura_en'
    || jsonb_build_object(
         'ordenes', to_jsonb(array(select l.orden_compra_id from public.adquisiciones_ordenes_compra l
                                    where l.adquisicion_id = p_id and l.quitada_en is null order by l.creado_en)),
         'parciales', to_jsonb(array(select l.orden_compra_id from public.adquisiciones_ordenes_compra l
                                      where l.adquisicion_id = p_id and l.quitada_en is null and l.parcial order by l.creado_en)));
  perform public.conciliar_pago_directo(v_compras || public.compras_de_la_factura(v_nueva));
  perform public.registrar_correccion(p_correccion, 'FACTURA_COMPRA', p_id, v_nueva.numero_documento, p_motivo, p_justificante,
                                      p_nombre, v_antes, v_despues);
  return p_id;
end $$;
revoke all on function public.corregir_factura_compra(uuid, uuid, text, text, text, jsonb) from public, anon;
grant execute on function public.corregir_factura_compra(uuid, uuid, text, text, text, jsonb) to authenticated;

-- 7. Adquisiciones: el pago de la boleta y los documentos de la OS -------------------------
-- La misma firma de la 20261020170000. Cambia:
--   · la OC con boleta que paga Tesorería sale POR_PAGAR, PAGO_PARCIAL o PAGADA
--     con sus pagos; SIN_FACTURA queda para las de antes, pagadas fuera; la que
--     trae su comprobante espera que se registre (POR_FACTURAR). Si ya tenía un
--     pago directo, su factura lo toma (sección 6): sale como se paga la factura
--     y, si la factura no tomó todo lo que se pagó, PAGADA_DE_MAS.
--   · la OS trae sus documentos.
--   · cada archivo dice en qué bucket está.
--   · (sexta vuelta) la factura que Logística anexó a una OC con boleta y que
--     Contabilidad registró sin ligarla entra entre sus facturas, marcada
--     `anexada`: la OC se paga por ella (sección 4), y pagada esa factura, la OC
--     con boleta sale PAGADA aunque `compras_facturadas` no la cuente. Si no
--     alcanza para ella (es de las otras OC que tiene ligadas), no entra y la OC
--     sale ANEXO_POR_REVISAR: no la pagaba nadie y decía PAGADA; los
--     documentos traen su anulación; cada pago dice si fue el que canceló la OC
--     (el que llegó al total, o el que la dio por cancelada), no lo que se pensó
--     al registrarlo: si se anula uno de antes, el que sigue ya no es «a cuenta».
--   · (sexta auditoría) pagada su factura parcial, la OC con boleta sale
--     PAGO_PARCIAL, como la de factura: decía PAGADA. Cada factura
--     anexada trae la factura registrada que es la suya (número, si alcanza y
--     lo pagado), para que Adquisiciones diga si el anexo se puede anular y no
--     la muestre dos veces.
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
  -- De cada factura que Logística anexó a una OC con boleta, la que es la suya
  -- en Adquisiciones (sección 4). Una vez por anexo: la usan las dos de abajo.
  anexo_factura as materialized (
    select d.id as documento_id, d.orden_compra_id, f.adquisicion_id, f.estado, f.cubre_su_oc, f.numero, f.alcanza, f.pagado
      from public.documentos_compra_material d
      join public.ordenes_compra_materiales c on c.id = d.orden_compra_id
      cross join lateral public.factura_del_anexo(d.id) f
     where d.tipo = 'FACTURA' and d.anulado_en is null and not c.con_factura
  ),
  -- La registrada sin ligarla a la OC: es su factura igual, si alcanza para
  -- ella; si no, es de las otras OC y el anexo está por revisar.
  anexada as (
    select distinct x.orden_compra_id, x.adquisicion_id from anexo_factura x
     where x.estado = 'REGISTRADA' and not x.cubre_su_oc and x.alcanza
  ),
  -- Los documentos de cada OC, con su anulación y, el anexo, con su factura.
  documento as (
    select d.orden_compra_id,
           jsonb_agg(jsonb_build_object('id', d.id, 'tipo', d.tipo, 'nombre', d.nombre_archivo, 'ruta', d.ruta_storage,
                                        'numero', d.numero_documento, 'creado_en', d.creado_en, 'bucket', 'documentos-compras',
                                        'anulado_en', d.anulado_en, 'motivo_anulacion', d.motivo_anulacion,
                                        'factura', case when x.adquisicion_id is not null then
                                                     jsonb_build_object('id', x.adquisicion_id, 'numero', x.numero, 'estado', x.estado,
                                                                        'alcanza', x.alcanza, 'pagado', x.pagado) end)
                     order by d.creado_en) as documentos
      from public.documentos_compra_material d
      left join anexo_factura x on x.documento_id = d.id
     group by d.orden_compra_id
  ),
  -- Cada factura de la OC (también la que está en borrador), con lo pagado y cada pago vigente.
  factura as (
    select l.orden_compra_id,
           jsonb_agg(jsonb_build_object(
             'id', a.id, 'numero', a.numero_documento, 'tipo', a.tipo, 'fecha', a.fecha_emision,
             'vence', a.fecha_vencimiento, 'condicion', a.condicion_pago, 'total', a.total, 'moneda', a.moneda,
             'estado', a.estado, 'parcial', l.parcial, 'anexada', l.anexada,
             'ruta', coalesce(a.ruta_storage, d.ruta_storage),
             'bucket', case when a.ruta_storage is not null then 'comprobantes-financieros'
                            when d.ruta_storage is not null then 'documentos-compras' end,
             'pagado', coalesce(p.pagado, 0), 'saldo', a.total - coalesce(p.pagado, 0),
             'pagos', coalesce(p.pagos, '[]'::jsonb))
             order by a.fecha_emision, a.numero_documento) as facturas,
           count(*) filter (where a.estado = 'REGISTRADA') as registradas,
           coalesce(bool_and(a.total - coalesce(p.pagado, 0) <= 0) filter (where a.estado = 'REGISTRADA'), false) as pagadas,
           coalesce(bool_or(not l.parcial) filter (where a.estado = 'REGISTRADA'), false) as alguna_entera,
           coalesce(sum(p.pagado) filter (where a.estado = 'REGISTRADA'), 0) as pagado
      from (select v.orden_compra_id, v.adquisicion_id, v.parcial, false as anexada
              from public.adquisiciones_ordenes_compra v where v.quitada_en is null
            union all
            select x.orden_compra_id, x.adquisicion_id, false, true from anexada x) l
      join public.adquisiciones a on a.id = l.adquisicion_id
      left join public.documentos_compra_material d on d.id = a.documento_compra_id
      left join lateral (
        select sum(x.monto) as pagado,
               jsonb_agg(jsonb_build_object('id', x.id, 'fecha', x.fecha, 'monto', x.monto, 'referencia', x.referencia,
                                            -- El pago de la boleta que la factura tomó (sección 6) lleva el voucher de ese pago.
                                            'ruta', coalesce(x.archivo_ruta, po.archivo_ruta),
                                            'bucket', case when x.pago_orden_compra_id is not null then 'pagos-compras' else 'pagos-facturas' end,
                                            'boleta', x.pago_orden_compra_id is not null)
                         order by x.fecha, x.creado_en) as pagos
          from public.pagos_adquisicion x
          left join public.pagos_orden_compra po on po.id = x.pago_orden_compra_id
         where x.adquisicion_id = a.id and x.anulado_en is null
      ) p on true
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
         case when c.aprobacion = 'RECHAZADA' then null else tt.total end,
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
           -- Logística le anexó una factura registrada para otras OC que no alcanza para esta.
           when not c.con_factura and fe.origen = 'REGISTRADA' then 'ANEXO_POR_REVISAR'
           -- La de antes se pagó fuera, salvo que el proveedor entregara factura: esa se paga por ella.
           when not c.con_factura and not c.pago_en_tesoreria and coalesce(fa.registradas, 0) = 0 and fe.origen is null then 'SIN_FACTURA'
           -- Pagada directo y su factura, que llegó después, no tomó todo lo pagado: se pide la devolución.
           when not c.con_factura and coalesce(pb.n, 0) > 0 and coalesce(pd.de_mas, 0) > 0 then 'PAGADA_DE_MAS'
           -- Sin factura registrada que tome sus pagos directos (o con una en otra
           -- moneda, que no toma nada): pagada si suman el total o uno vigente la dio
           -- por cancelada (sección 2), y si no, pagada en parte; lo que falta, por su
           -- boleta o por la factura que llegue. Con factura, la que tomó el pago,
           -- sale como se paga esa factura (abajo): si es por más, le falta algo.
           when not c.con_factura and coalesce(pb.n, 0) > 0 and (coalesce(fa.registradas, 0) = 0 or coalesce(pd.otra_moneda, false))
                and (pb.sin_completar or pb.pagado >= tt.total) then 'PAGADA'
           when not c.con_factura and coalesce(pb.n, 0) > 0 and (coalesce(fa.registradas, 0) = 0 or coalesce(pd.otra_moneda, false)) then 'PAGO_PARCIAL'
           -- La boleta que Contabilidad registró como comprobante se paga por ahí (y
           -- `registrar_pago_compra` ya no la deja pagar directo): sigue como factura.
           -- La que trae factura (en borrador o anexada por Logística) espera que Contabilidad la registre.
           when not c.con_factura and coalesce(fa.registradas, 0) = 0 and fe.origen is null then 'POR_PAGAR'
           when coalesce(fa.registradas, 0) = 0 then 'POR_FACTURAR'
           -- La OC con boleta se paga por su factura, ligada o anexada: pagada esa, pagada la OC. Si
           -- todas la cubren en parte, como la de factura: pagada cuando ya se facturó entera.
           when not c.con_factura and fa.pagadas
                and (fa.alguna_entera or coalesce(fd.completa or fd.facturado >= fd.total - 1, false)) then 'PAGADA'
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
    cross join lateral (select public.total_orden_compra(c.id) as total) tt
    -- El proveedor de la OC con boleta entregó su comprobante y se paga por él, y
    -- su pago directo frente a su factura (sección 4). Solo la OC con boleta: la
    -- condición va afuera de la función y la de factura no la llama.
    left join lateral (select e.origen, e.alcanza from public.comprobante_en_camino(c.id) e where not c.con_factura) fe on true
    left join lateral (select x.de_mas, x.otra_moneda from public.pago_directo_de_la_compra(c.id) x where not c.con_factura) pd on true
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
    left join documento dc on dc.orden_compra_id = c.id
    -- El pago de la OC con boleta (sección 2). `cancela`: el último que la dio por
    -- cancelada sin llegar al total o, si ninguno, el que llegó al total.
    left join lateral (
      select count(*) as n, sum(y.monto) as pagado, coalesce(bool_or(y.cancela_sin_completar), false) as sin_completar,
             jsonb_agg(jsonb_build_object('id', y.id, 'fecha', y.fecha_pago, 'monto', y.monto, 'moneda', y.moneda,
                                          'cancela', case when y.ultimo_sin_completar is not null then y.creado_en = y.ultimo_sin_completar and y.cancela_sin_completar
                                                          else y.acumulado >= tt.total and y.acumulado - y.monto < tt.total end,
                                          'operacion', y.operacion,
                                          'comprobante', y.comprobante_proveedor, 'ruta', y.archivo_ruta, 'bucket', 'pagos-compras')
                       order by y.fecha_pago, y.creado_en) as pagos
        from (select x.*, sum(x.monto) over (order by x.fecha_pago, x.creado_en, x.id) as acumulado,
                     max(x.creado_en) filter (where x.cancela_sin_completar) over () as ultimo_sin_completar
                from public.pagos_orden_compra x
               where x.orden_compra_id = c.id and x.anulado_en is null) y
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
