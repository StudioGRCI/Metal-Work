-- =============================================================================
-- LA OC QUE LLEGA EN PARTES: UNAS CON BOLETA Y OTRAS CON FACTURA
-- -----------------------------------------------------------------------------
-- DKS lo eligió el 22/10 («En el sistema», a «¿Registro en el sistema las
-- devoluciones al proveedor, las notas de crédito y las entregas parciales
-- mixtas?»). La entrega parcial mixta es la OC que el proveedor entrega en
-- partes: una parte llega con boleta y la otra con factura.
--
-- Hasta hoy una OC se pagaba por un solo camino (20261020210000): la que va con
-- factura, solo por sus facturas; la que va con boleta, directo por Tesorería, y
-- si después llegaba una factura, la factura tomaba lo pagado por la boleta,
-- porque se daba por hecho que era el comprobante de lo mismo. En la entrega
-- mixta eso falla: la factura es de otra parte, lo pagado por la boleta no es
-- suyo, y la parte de la boleta se quedaba sin camino para pagarse (en la OC con
-- factura no había pago directo; en la de boleta, la factura se lo comía).
--
-- Desde aquí:
--   · Logística anexa la boleta de esa parte como «Boleta, nota de venta o
--     recibo», con su número, su fecha y su monto. Es lo que la distingue de la
--     boleta de toda la OC: la boleta de una parte lleva monto.
--   · Tesorería paga cada boleta de una parte directo, hasta su monto, con su
--     voucher y desde una cuenta de la caja, en «Boletas de una parte».
--   · Lo demás de la OC se paga por su factura, como siempre. Ninguna factura
--     toma lo pagado por la boleta de una parte, y lo facturado de la OC cuenta
--     esas boletas: la OC deja de esperar factura cuando sus facturas y sus
--     boletas de una parte la cubren, y el control de Adquisiciones dice que la
--     factura del resto calza.
--   · La OC está pagada cuando sus facturas y sus boletas de una parte lo están.
--
-- La boleta de una parte deja siempre algo para la factura (si todo vino con
-- boleta, no es una entrega mixta), y no se anexa a una OC con boleta que
-- Tesorería ya empezó a pagar por su boleta entera: ese pago ya cuenta para la
-- factura que llegue, como antes. Mientras la OC tenga una boleta de una parte,
-- tampoco se le paga directo la boleta entera: serían dos caminos para lo mismo.
--
-- El costeo del código no cambia: se arma con las líneas de la OC, no con sus
-- comprobantes.
--
-- Idempotente. Sin `drop` de funciones ni de políticas. Las funciones de otros
-- se cambian por reemplazo de texto (como la 20261022185000): si no están como
-- las conoce el repositorio, la migración se detiene y lo dice.
-- =============================================================================

-- 1. El monto de la boleta de una parte -------------------------------------------------------
alter table public.documentos_compra_material add column if not exists monto_de_la_parte numeric(14, 2);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_documento_compra_parte'
                   and conrelid = 'public.documentos_compra_material'::regclass) then
    alter table public.documentos_compra_material add constraint ck_documento_compra_parte check (
      monto_de_la_parte is null
      or (tipo = 'COMPROBANTE' and monto_de_la_parte > 0 and monto_de_la_parte <= 999999999
          and numero_documento is not null and fecha_emision is not null));
  end if;
end $$;
comment on column public.documentos_compra_material.monto_de_la_parte is
  'La boleta, nota de venta o recibo de una parte de la OC (entrega mixta, migración 20261022200000): lo que dice ese comprobante, en la moneda de la OC. Tesorería lo paga directo; lo demás de la OC va por su factura. En null, el comprobante es el de toda la OC.';

-- 2. El pago de la boleta de una parte --------------------------------------------------------
-- Como el pago de la OC con boleta, pero colgado de la boleta y no de la OC:
-- ninguna factura lo toma y no cuenta para la boleta entera. No se borra: se anula.
create table if not exists public.pagos_parte_con_boleta (
  id                  uuid primary key default gen_random_uuid(),
  documento_compra_id uuid not null references public.documentos_compra_material(id) on delete restrict,
  orden_compra_id     uuid not null references public.ordenes_compra_materiales(id) on delete restrict,
  fecha_pago          date not null,
  moneda              text not null,
  monto               numeric(14, 2) not null,
  operacion           text,
  archivo_ruta        text not null,
  archivo_mime        text not null,
  archivo_tamano      integer not null,
  registrado_por      uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  anulado_por         uuid references public.usuarios(id) on delete restrict,
  anulado_en          timestamptz,
  motivo_anulacion    text,
  creado_en           timestamptz not null default now(),
  actualizado_en      timestamptz not null default now(),
  constraint uq_pago_parte_archivo unique (archivo_ruta),
  constraint ck_pago_parte_valores check (
    moneda in ('PEN', 'USD') and monto > 0 and monto <= 999999999
    and (operacion is null or char_length(btrim(operacion)) between 1 and 60)
    and archivo_mime in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
    and archivo_tamano between 1 and 10485760),
  constraint ck_pago_parte_anulado check (
    anulado_en is null
    or (anulado_por is not null and char_length(btrim(coalesce(motivo_anulacion, ''))) between 10 and 500))
);
comment on table public.pagos_parte_con_boleta is
  'Un pago de Tesorería a la boleta de una parte de una OC (entrega mixta, migración 20261022200000), con su voucher. Ninguna factura lo toma. No se borra: se anula.';
-- (b) La lista de Tesorería y Adquisiciones suman los pagos de cada boleta.
create index if not exists ix_pagos_parte_con_boleta_documento on public.pagos_parte_con_boleta (documento_compra_id);
-- (b) La OC se mira por sus pagos al anularla y al cambiarle el total.
create index if not exists ix_pagos_parte_con_boleta_oc on public.pagos_parte_con_boleta (orden_compra_id);
select public.activar_timestamps('pagos_parte_con_boleta');
select public.activar_registro_de_prueba('pagos_parte_con_boleta');
-- Sin `activar_auditoria`: la fila guarda quién lo registró, quién lo anuló,
-- cuándo y por qué, y no se borra; su egreso queda en la caja, que sí se audita.
-- Auditada, el monto saldría por `audit_log` a quien tiene `auditoria.ver` y no
-- ve los pagos (skill seguridad).

-- Lo que suman las boletas de una parte vigentes de una OC y lo que Tesorería les pagó.
create or replace function public.partes_con_boleta_de_la_compra(p_compra uuid)
returns table (n integer, monto numeric, pagado numeric)
language sql stable security definer rows 1 set search_path to 'public' as $$
  select count(*)::integer,
         coalesce(sum(d.monto_de_la_parte), 0)::numeric(14, 2),
         coalesce(sum(least(coalesce(p.pagado, 0), d.monto_de_la_parte)), 0)::numeric(14, 2)
    from public.documentos_compra_material d
    left join lateral (
      select sum(x.monto) as pagado from public.pagos_parte_con_boleta x
       where x.documento_compra_id = d.id and x.anulado_en is null
    ) p on true
   where d.orden_compra_id = p_compra and d.monto_de_la_parte is not null and d.anulado_en is null;
$$;
revoke all on function public.partes_con_boleta_de_la_compra(uuid) from public, anon, authenticated;

create or replace function public.fn_pago_parte_guardia()
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
revoke all on function public.fn_pago_parte_guardia() from public, anon, authenticated;
create or replace trigger trg_pago_parte_guardia
  before update or delete on public.pagos_parte_con_boleta
  for each row execute function public.fn_pago_parte_guardia();

-- Los ven quienes ven el pago de la OC con boleta. Se escriben solo por las funciones.
alter table public.pagos_parte_con_boleta enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'pagos_parte_con_boleta' and policyname = 'ver_pagos_parte_con_boleta') then
    create policy ver_pagos_parte_con_boleta on public.pagos_parte_con_boleta for select to authenticated
      using ((select public.es_admin()) or (select public.tiene_permiso('tesoreria.registrar_pagos'))
             or (select public.tiene_permiso('tesoreria.ver_documentos'))
             or (select public.tiene_permiso('compras.crear'))
             or (select public.tiene_permiso('adquisiciones.ver')));
  end if;
end $$;
revoke all on public.pagos_parte_con_boleta from public, anon, authenticated;
grant select on public.pagos_parte_con_boleta to authenticated;

-- El voucher va en el bucket del pago de la OC (`pagos-compras/{OC}/…`): lo ven
-- quienes ven el pago que lo nombra y no se quita mientras uno lo nombre. Las
-- dos políticas de la 20261020210000, con esta tabla.
alter policy pagos_compras_ver on storage.objects using (
  bucket_id = 'pagos-compras'
  and (owner_id = (select auth.uid())::text
       or exists (select 1 from public.pagos_orden_compra p where p.archivo_ruta = objects.name)
       or exists (select 1 from public.devoluciones_orden_compra d where d.archivo_ruta = objects.name)
       or exists (select 1 from public.pagos_parte_con_boleta x where x.archivo_ruta = objects.name)));
alter policy pagos_compras_quitar_suelto on storage.objects using (
  bucket_id = 'pagos-compras' and owner_id = (select auth.uid())::text
  and not exists (select 1 from public.pagos_orden_compra p where p.archivo_ruta = objects.name)
  and not exists (select 1 from public.devoluciones_orden_compra d where d.archivo_ruta = objects.name)
  and not exists (select 1 from public.pagos_parte_con_boleta x where x.archivo_ruta = objects.name));

-- La caja conoce el origen nuevo: la 20261022190000 con uno más.
alter table public.movimientos_caja drop constraint if exists ck_movimiento_caja_origen;
alter table public.movimientos_caja add constraint ck_movimiento_caja_origen check (
  origen in ('MANUAL', 'TRANSFERENCIA', 'PAGO_ADQUISICION', 'PAGO_ORDEN_SERVICIO', 'PAGO_ORDEN_COMPRA',
             'PAGO_RECIBO_HONORARIOS', 'PAGO_PLANILLA_DIARIA', 'COBRO_FACTURA_VENTA', 'DEVOLUCION_ORDEN_COMPRA',
             'REEMBOLSO_NOTA_CREDITO', 'PAGO_PARTE_BOLETA')
  and ((origen = 'MANUAL') = (origen_id is null))
);

-- Reemplaza en una función, de una vez, cada texto viejo por el nuevo. Cada par
-- dice cuántas veces tiene que estar el viejo; si el nuevo ya está, ese par ya
-- se aplicó. Si un viejo no está esas veces, la función cambió desde la última
-- migración que el repositorio conoce y se detiene todo.
create or replace function pg_temp.parchar(p_funcion regprocedure, p_cambios text[], p_veces integer[])
returns void language plpgsql as $$
declare
  v_def   text := replace(pg_get_functiondef(p_funcion), E'\r', '');
  v_nueva text;
  v_n     integer;
  i       integer;
begin
  v_nueva := v_def;
  for i in 1 .. array_length(p_veces, 1) loop
    continue when position(p_cambios[2 * i] in v_nueva) > 0;
    v_n := (char_length(v_nueva) - char_length(replace(v_nueva, p_cambios[2 * i - 1], ''))) / char_length(p_cambios[2 * i - 1]);
    if v_n <> p_veces[i] then
      raise exception '% cambió: «%» está % veces y el repositorio la conoce %. Revisarla a mano antes de seguir.',
        p_funcion, left(p_cambios[2 * i - 1], 80), v_n, p_veces[i];
    end if;
    v_nueva := replace(v_nueva, p_cambios[2 * i - 1], p_cambios[2 * i]);
  end loop;
  if v_nueva <> v_def then
    execute v_nueva;
  end if;
end;
$$;

-- El egreso anotado a mano igual al pago de una boleta de una parte lo nombra bien.
select pg_temp.parchar('public.fn_caja_sin_contar_dos_veces()'::regprocedure, array[
  E'                         when ''PAGO_ORDEN_COMPRA'' then ''pago de una OC con boleta''\n',
  E'                         when ''PAGO_ORDEN_COMPRA'' then ''pago de una OC con boleta''\n'
  || E'                         when ''PAGO_PARTE_BOLETA'' then ''pago de la boleta de una parte de una OC''\n'
], array[1]);

-- 3. Las reglas de la boleta de una parte ----------------------------------------------------
-- Al anexarla: la OC aprobada y con precio, pagada en el sistema; su número, su
-- fecha y su monto; que deje algo para la factura y que, con lo ya facturado y
-- las otras boletas, no pase del total; y en la OC con boleta, que Tesorería no
-- haya empezado a pagar la boleta entera. Su monto no cambia después, y no se
-- anula mientras tenga un pago vigente. Con la OC «for update», como el pago
-- directo: un pago de la boleta entera que entra a la vez espera.
create or replace function public.fn_parte_con_boleta_valida()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_oc     public.ordenes_compra_materiales%rowtype;
  v_nombre text;
  v_total  numeric;
  v_partes numeric;
  v_factur numeric;
  v_mon    text;
  v_hoy    date := (now() at time zone 'America/Lima')::date;
begin
  if tg_op = 'UPDATE' then
    if new.monto_de_la_parte is distinct from old.monto_de_la_parte then
      raise exception 'El monto de la boleta de una parte no se corrige: anula la boleta con su motivo y anéxala de nuevo.'
        using errcode = 'check_violation';
    end if;
    if old.monto_de_la_parte is not null and old.anulado_en is null and new.anulado_en is not null
       and exists (select 1 from public.pagos_parte_con_boleta x where x.documento_compra_id = old.id and x.anulado_en is null) then
      raise exception 'Tesorería ya le pagó algo a la boleta %: primero se anula ese pago, con su motivo, y después la boleta.',
        old.numero_documento using errcode = 'check_violation';
    end if;
    -- Anulada la boleta, Tesorería deja de deberla: que lo sepa.
    if old.monto_de_la_parte is not null and old.anulado_en is null and new.anulado_en is not null then
      perform public.notificar_a_permiso('tesoreria.registrar_pagos',
        'Boleta de una parte anulada: ' || old.numero_documento,
        coalesce(new.motivo_anulacion, 'Logística la anuló.'),
        '/tesoreria/por-pagar#partes-con-boleta', 'documentos_compra_material', old.id, public.usuario_actual());
    end if;
    return new;
  end if;
  if new.monto_de_la_parte is null then
    return new;
  end if;
  select * into v_oc from public.ordenes_compra_materiales where id = new.orden_compra_id for update;
  if not found then raise exception 'Esa orden de compra no existe.' using errcode = 'check_violation'; end if;
  v_nombre := coalesce(v_oc.numero, 'OC ' || v_oc.referencia);
  if v_oc.aprobacion not in ('APROBADA', 'NO_REQUERIDA') then
    raise exception 'La % no está aprobada: la boleta de una parte se anexa a una OC aprobada.', v_nombre using errcode = 'check_violation';
  end if;
  if not v_oc.pago_en_tesoreria then
    raise exception 'La % es de antes de que Tesorería registrara el pago de las OC con boleta: se pagó fuera del sistema.', v_nombre
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.orden_compra_material_detalles where orden_compra_id = v_oc.id and precio_unitario is null) then
    raise exception 'La % tiene líneas sin precio: Logística las completa antes de repartirla entre boleta y factura.', v_nombre
      using errcode = 'check_violation';
  end if;
  if new.monto_de_la_parte <> round(new.monto_de_la_parte, 2) then
    raise exception 'Escribe el monto de la boleta en dos decimales.' using errcode = 'check_violation';
  end if;
  if new.fecha_emision > v_hoy then
    raise exception 'La fecha de la boleta no puede ser posterior a hoy.' using errcode = 'check_violation';
  end if;
  new.numero_documento := upper(btrim(new.numero_documento));
  if exists (select 1 from public.documentos_compra_material d
              where d.orden_compra_id = v_oc.id and d.monto_de_la_parte is not null and d.anulado_en is null
                and public.clave_numero_comprobante(d.numero_documento) = public.clave_numero_comprobante(new.numero_documento)) then
    raise exception 'La boleta % ya está anexada a la % como la de una parte.', new.numero_documento, v_nombre using errcode = 'check_violation';
  end if;
  -- Ni es un comprobante que Contabilidad ya registró en Adquisiciones: se pagaría por él y aquí.
  -- El mismo candado que toma `fn_adquisicion_no_es_boleta_de_una_parte`: las dos no se cruzan.
  perform pg_advisory_xact_lock(hashtextextended('parte|' || public.clave_numero_comprobante(new.numero_documento), 0));
  if exists (select 1 from public.adquisiciones a
              left join public.proveedores p on p.id = v_oc.proveedor_id
              where public.clave_numero_comprobante(a.numero_documento) = public.clave_numero_comprobante(new.numero_documento)
                and (case when a.ruc_proveedor is not null and p.numero_documento is not null then a.ruc_proveedor = p.numero_documento
                          else public.mismo_proveedor(a.proveedor, v_oc.proveedor) end)) then
    raise exception 'El comprobante % ya está registrado en Adquisiciones: se paga por ahí. Si es la boleta de una parte, Contabilidad lo corrige primero.',
      new.numero_documento using errcode = 'check_violation';
  end if;
  if not v_oc.con_factura
     and exists (select 1 from public.pagos_orden_compra p where p.orden_compra_id = v_oc.id and p.anulado_en is null) then
    raise exception 'Tesorería ya empezó a pagar la % por su boleta entera: ese pago cuenta para la factura que llegue. Si la entrega fue mixta, Tesorería anula ese pago con su motivo y la boleta de la parte se anexa antes de pagarla.',
      v_nombre using errcode = 'check_violation';
  end if;
  v_total := public.total_orden_compra(v_oc.id);
  select x.monto into v_partes from public.partes_con_boleta_de_la_compra(v_oc.id) x;
  -- Lo facturado ya cuenta las boletas de una parte (sección 4).
  v_factur := coalesce((select f.facturado from public.compras_facturadas(array[v_oc.id], null) f), v_partes);
  v_mon := case when v_oc.moneda = 'USD' then 'US$ ' else 'S/ ' end;
  if v_partes + new.monto_de_la_parte > v_total - 1 then
    raise exception 'Con esa boleta las de una parte de la % sumarían % de su total de %: tiene que quedar algo para la factura. Si todo vino con boleta, no es una entrega mixta.',
      v_nombre, v_mon || to_char(v_partes + new.monto_de_la_parte, 'FM999G999G990D00'), v_mon || to_char(v_total, 'FM999G999G990D00')
      using errcode = 'check_violation';
  end if;
  if v_factur + new.monto_de_la_parte > v_total + 1 then
    raise exception 'La % ya tiene facturado y en boletas %: con esa boleta pasaría de su total de %.',
      v_nombre, v_mon || to_char(v_factur, 'FM999G999G990D00'), v_mon || to_char(v_total, 'FM999G999G990D00')
      using errcode = 'check_violation';
  end if;
  perform public.notificar_a_permiso('tesoreria.registrar_pagos',
    'Boleta de una parte por pagar: ' || v_nombre,
    v_oc.proveedor || ' · ' || new.numero_documento || ' · ' || v_mon || to_char(new.monto_de_la_parte, 'FM999G999G990D00'),
    '/tesoreria/por-pagar#partes-con-boleta', 'documentos_compra_material', new.id, public.usuario_actual());
  return new;
end;
$$;
revoke all on function public.fn_parte_con_boleta_valida() from public, anon, authenticated;
create or replace trigger trg_parte_con_boleta_valida
  before insert or update on public.documentos_compra_material
  for each row execute function public.fn_parte_con_boleta_valida();

-- Con una boleta de una parte, la boleta entera no se paga directo: serían dos caminos.
create or replace function public.fn_pago_compra_sin_partes()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if exists (select 1 from public.documentos_compra_material d
              where d.orden_compra_id = new.orden_compra_id and d.monto_de_la_parte is not null and d.anulado_en is null) then
    raise exception 'La % llegó en partes, con boleta y con factura: cada boleta se paga en «Boletas de una parte» y lo demás, por su factura.',
      (select coalesce(c.numero, 'OC ' || c.referencia) from public.ordenes_compra_materiales c where c.id = new.orden_compra_id)
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_pago_compra_sin_partes() from public, anon, authenticated;
create or replace trigger trg_pago_compra_sin_partes
  before insert on public.pagos_orden_compra
  for each row execute function public.fn_pago_compra_sin_partes();

-- Con una boleta de una parte la OC no cambia de moneda (la boleta va en la suya)
-- ni pasa de con factura a con boleta o al revés: su total ganaría o perdería el
-- IGV y quedaría por debajo de lo que suman sus boletas, o la boleta entera se
-- pagaría directo además de sus partes. Con un pago vigente a una de ellas no se
-- anula: el dinero ya salió.
create or replace function public.fn_compra_con_partes_no_cambia()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_nombre text := coalesce(new.numero, 'OC ' || new.referencia);
begin
  if (new.moneda is distinct from old.moneda or new.con_factura is distinct from old.con_factura)
     and exists (select 1 from public.documentos_compra_material d
                  where d.orden_compra_id = new.id and d.monto_de_la_parte is not null and d.anulado_en is null) then
    raise exception 'La % tiene anexada la boleta de una parte: no cambia de moneda ni de factura a boleta mientras esa boleta siga vigente. Si la boleta estaba mal, Logística la anula primero, con su motivo.',
      v_nombre using errcode = 'check_violation';
  end if;
  if new.aprobacion = 'ANULADA' and old.aprobacion is distinct from 'ANULADA'
     and exists (select 1 from public.pagos_parte_con_boleta x where x.orden_compra_id = new.id and x.anulado_en is null) then
    raise exception 'Tesorería ya le pagó a la % la boleta de una parte: no se anula mientras ese pago siga vigente.',
      v_nombre using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_compra_con_partes_no_cambia() from public, anon, authenticated;
create or replace trigger trg_compra_con_partes_no_cambia
  before update on public.ordenes_compra_materiales
  for each row execute function public.fn_compra_con_partes_no_cambia();

-- Y su total no baja de lo que suman sus boletas de una parte, más algo para la
-- factura. Va después de cada línea, cuando el total de la OC ya la trae con su
-- IGV.
create or replace function public.fn_compra_con_partes_total()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_compra uuid;
  v_partes numeric;
  v_oc     record;
begin
  if tg_op = 'UPDATE' and (new.orden_compra_id, new.cantidad, new.precio_unitario)
                          is not distinct from (old.orden_compra_id, old.cantidad, old.precio_unitario) then
    return null;
  end if;
  foreach v_compra in array case tg_op when 'INSERT' then array[new.orden_compra_id]
                                       when 'DELETE' then array[old.orden_compra_id]
                                       else array[new.orden_compra_id, old.orden_compra_id] end loop
    select x.monto into v_partes from public.partes_con_boleta_de_la_compra(v_compra) x;
    continue when coalesce(v_partes, 0) = 0;
    -- Después de la fila, el total ya trae el cambio con su IGV: no se recalcula aparte.
    if public.total_orden_compra(v_compra) < v_partes + 1 then
      select coalesce(c.numero, 'OC ' || c.referencia) as nombre, c.moneda into v_oc
        from public.ordenes_compra_materiales c where c.id = v_compra;
      raise exception 'Las boletas de una parte de la % suman %: su total no baja de eso y tiene que quedar algo para la factura. Si la boleta estaba mal, Logística la anula primero, con su motivo.',
        v_oc.nombre, case when v_oc.moneda = 'USD' then 'US$ ' else 'S/ ' end || to_char(v_partes, 'FM999G999G990D00')
        using errcode = 'check_violation';
    end if;
  end loop;
  return null;
end;
$$;
revoke all on function public.fn_compra_con_partes_total() from public, anon, authenticated;
drop trigger if exists trg_compra_con_partes_total on public.orden_compra_material_detalles;
create trigger trg_compra_con_partes_total
  after insert or update or delete on public.orden_compra_material_detalles
  for each row execute function public.fn_compra_con_partes_total();

-- 4. Lo facturado de la OC cuenta sus boletas de una parte -----------------------------------
-- La de la 20261016701000, que nadie más cambió, con las boletas de una parte
-- sumadas: lo facturado de la OC es lo que cubren sus comprobantes. Así la OC
-- deja de esperar factura cuando la cubren entre facturas y boletas
-- (`compras_sin_factura`), la factura del resto calza en el control
-- (`adquisiciones_control`) y Adquisiciones la da por facturada entera
-- (`trazabilidad_de_compras`). La boleta sale en la lista de comprobantes como
-- «boleta B001-45», con `boleta` en verdadero. No cambia `completa`, que dice si
-- alguna factura la cubre entera. La factura de varias OC se reparte sobre lo que
-- sus facturas cubren de cada una, su total menos sus boletas. La OC con boletas
-- de una parte y sin factura también sale, con lo de sus boletas.
create or replace function public.compras_facturadas(p_ids uuid[], p_sin uuid)
returns table (orden_compra_id uuid, total numeric, facturado numeric, completa boolean, facturas jsonb)
language sql stable set search_path to 'public' as $$
  with enlace as (
    -- Las facturas registradas de esas OC, con todas sus OC (para repartir su total).
    select l.adquisicion_id, l.orden_compra_id, l.parcial, a.total as total_factura, a.moneda as moneda_factura,
           a.numero_documento
      from public.adquisiciones_ordenes_compra l
      join public.adquisiciones a on a.id = l.adquisicion_id
     where l.quitada_en is null and a.estado = 'REGISTRADA' and a.id is distinct from p_sin
       and (p_ids is null or l.adquisicion_id in (select x.adquisicion_id from public.adquisiciones_ordenes_compra x
                                                   where x.orden_compra_id = any (p_ids) and x.quitada_en is null))
  ), oc as (
    -- `base`: lo que las facturas cubren de la OC, su total menos sus boletas de una parte.
    -- Con ella se reparte la factura de varias OC: si no, lo facturado pasaba del total.
    select c.id, c.moneda, public.total_orden_compra(c.id) as total,
           public.total_orden_compra(c.id) - coalesce((select sum(d.monto_de_la_parte) from public.documentos_compra_material d
                                                       where d.orden_compra_id = c.id and d.monto_de_la_parte is not null
                                                         and d.anulado_en is null), 0) as base
      from public.ordenes_compra_materiales c
     where c.id in (select e.orden_compra_id from enlace e)
  ), reparto as (
    select e.*, o.base as total_oc, o.total as total_real,
           sum(o.base) filter (where not e.parcial) over w as completas,
           sum(o.base) filter (where e.parcial) over w as parciales,
           sum(o.base) over w as todas,
           bool_or(o.moneda <> e.moneda_factura) over w as otra_moneda
      from enlace e join oc o on o.id = e.orden_compra_id
    window w as (partition by e.adquisicion_id)
  ), parte as (
    select r.*,
           case when r.otra_moneda then null
                -- Ninguna parcial: el total de la factura, en proporción al de cada OC.
                when coalesce(r.parciales, 0) = 0 then r.total_factura * r.total_oc / nullif(r.todas, 0)
                -- La que completa, su total; lo que sobra, a las parciales.
                when not r.parcial then r.total_oc
                else greatest(r.total_factura - coalesce(r.completas, 0), 0) * r.total_oc / r.parciales
           end as parte
      from reparto r
  ), por_factura as (
    select p.orden_compra_id, max(p.total_real)::numeric as total, round(coalesce(sum(p.parte), 0), 2)::numeric as facturado,
           bool_or(not p.parcial) as completa,
           jsonb_agg(jsonb_build_object('id', p.adquisicion_id, 'numero_documento', p.numero_documento, 'total', p.total_factura,
                                        'moneda', p.moneda_factura, 'parcial', p.parcial, 'parte', round(p.parte, 2),
                                        'boleta', false)
                     order by p.numero_documento) as facturas
      from parte p
     where p_ids is null or p.orden_compra_id = any (p_ids)
     group by p.orden_compra_id
  ), por_boleta as (
    -- Las boletas de una parte vigentes (migración 20261022200000), en la moneda de su OC.
    select d.orden_compra_id, sum(d.monto_de_la_parte)::numeric as monto,
           jsonb_agg(jsonb_build_object('id', d.id, 'numero_documento', 'boleta ' || d.numero_documento,
                                        'total', d.monto_de_la_parte, 'moneda', c.moneda, 'parcial', true,
                                        'parte', d.monto_de_la_parte, 'boleta', true)
                     order by d.numero_documento) as boletas
      from public.documentos_compra_material d
      join public.ordenes_compra_materiales c on c.id = d.orden_compra_id
     where d.monto_de_la_parte is not null and d.anulado_en is null
       and (p_ids is null or d.orden_compra_id = any (p_ids))
     group by d.orden_compra_id
  )
  select coalesce(f.orden_compra_id, b.orden_compra_id),
         coalesce(f.total, public.total_orden_compra(b.orden_compra_id)),
         (coalesce(f.facturado, 0) + coalesce(b.monto, 0))::numeric,
         coalesce(f.completa, false),
         coalesce(f.facturas, '[]'::jsonb) || coalesce(b.boletas, '[]'::jsonb)
    from por_factura f
    full join por_boleta b on b.orden_compra_id = f.orden_compra_id;
$$;
comment on function public.compras_facturadas(uuid[], uuid) is
  'Lo facturado de cada OC en sus facturas registradas (sin la p_sin) y en sus boletas de una parte, sin pedir permiso: la llaman compras_sin_factura, adquisiciones_control, facturado_de_compras, trazabilidad_de_compras y compras_con_boleta_por_pagar.';
revoke all on function public.compras_facturadas(uuid[], uuid) from public, anon, authenticated;

-- 5. Tesorería paga la boleta de una parte ---------------------------------------------------
-- Con su voucher, desde la cuenta de la caja que elige, hasta lo que dice la
-- boleta: uno o varios pagos. El id llega de la pantalla: el mismo envío dos
-- veces entra una vez; con otro dato, se rechaza.
create or replace function public.registrar_pago_parte_con_boleta(
  p_id uuid, p_documento uuid, p_fecha_pago date, p_monto numeric, p_operacion text, p_ruta text,
  p_caja uuid, p_monto_cuenta numeric
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo     uuid := public.usuario_actual();
  v_hoy    date := (now() at time zone 'America/Lima')::date;
  v_doc    public.documentos_compra_material%rowtype;
  v_oc     public.ordenes_compra_materiales%rowtype;
  v_previo public.pagos_parte_con_boleta%rowtype;
  v_nombre text;
  v_pagado numeric;
  v_mon    text;
  v_op     text := nullif(btrim(coalesce(p_operacion, '')), '');
  v_obj    storage.objects%rowtype;
begin
  perform public.exigir_permiso('tesoreria.registrar_pagos');
  if p_id is null then raise exception 'Vuelve a abrir el formulario del pago.' using errcode = 'check_violation'; end if;
  select * into v_previo from public.pagos_parte_con_boleta where id = p_id;
  if found then
    if (v_previo.documento_compra_id, v_previo.fecha_pago, v_previo.monto, v_previo.operacion, v_previo.archivo_ruta, v_previo.registrado_por)
       is not distinct from (p_documento, p_fecha_pago, p_monto, v_op, p_ruta, v_yo) then
      return p_id;
    end if;
    raise exception 'Ese pago ya quedó registrado la primera vez que lo enviaste: recarga la pantalla y míralo antes de registrar otro.'
      using errcode = 'check_violation';
  end if;
  select * into v_doc from public.documentos_compra_material where id = p_documento;
  if not found or v_doc.monto_de_la_parte is null then
    raise exception 'Esa boleta no es la de una parte de una OC.' using errcode = 'check_violation';
  end if;
  select * into v_oc from public.ordenes_compra_materiales where id = v_doc.orden_compra_id for update;
  select * into v_doc from public.documentos_compra_material where id = p_documento;
  v_nombre := coalesce(v_oc.numero, 'OC ' || v_oc.referencia);
  if v_doc.anulado_en is not null then
    raise exception 'Logística anuló la boleta % de la %: no se paga.', v_doc.numero_documento, v_nombre using errcode = 'check_violation';
  end if;
  if v_oc.aprobacion not in ('APROBADA', 'NO_REQUERIDA') then
    raise exception 'La % no está aprobada: no se paga.', v_nombre using errcode = 'check_violation';
  end if;
  if p_fecha_pago is null or p_fecha_pago > v_hoy or p_fecha_pago < v_hoy - 365 then
    raise exception 'Elige el día del pago: de hoy hacia atrás.' using errcode = 'check_violation';
  end if;
  if p_monto is null or p_monto <= 0 or p_monto > 999999999 or p_monto <> round(p_monto, 2) then
    raise exception 'Escribe lo que se pagó, en dos decimales.' using errcode = 'check_violation';
  end if;
  v_mon := case when v_oc.moneda = 'USD' then 'US$ ' else 'S/ ' end;
  select coalesce(sum(x.monto), 0) into v_pagado
    from public.pagos_parte_con_boleta x where x.documento_compra_id = p_documento and x.anulado_en is null;
  if v_pagado >= v_doc.monto_de_la_parte then
    raise exception 'La boleta % de la % ya está pagada.', v_doc.numero_documento, v_nombre using errcode = 'check_violation';
  end if;
  if v_pagado + p_monto > v_doc.monto_de_la_parte then
    raise exception 'Con ese pago la boleta % pasaría de su monto (%): le quedan % por pagar.', v_doc.numero_documento,
      v_mon || to_char(v_doc.monto_de_la_parte, 'FM999G999G990D00'),
      v_mon || to_char(v_doc.monto_de_la_parte - v_pagado, 'FM999G999G990D00') using errcode = 'check_violation';
  end if;
  if v_op is not null and char_length(v_op) > 60 then
    raise exception 'El número de operación pasa de 60 caracteres.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.pagos_orden_compra where archivo_ruta = p_ruta)
     or exists (select 1 from public.devoluciones_orden_compra where archivo_ruta = p_ruta)
     or exists (select 1 from public.pagos_parte_con_boleta where archivo_ruta = p_ruta) then
    raise exception 'Ese voucher ya es el de otro pago: adjunta el de este.' using errcode = 'check_violation';
  end if;
  v_obj := public.archivo_subido_por_mi('pagos-compras', p_ruta, v_oc.id,
                                        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

  insert into public.pagos_parte_con_boleta (id, documento_compra_id, orden_compra_id, fecha_pago, moneda, monto, operacion,
                                             archivo_ruta, archivo_mime, archivo_tamano, registrado_por)
  values (p_id, p_documento, v_oc.id, p_fecha_pago, v_oc.moneda, p_monto, v_op,
          p_ruta, v_obj.metadata->>'mimetype', (v_obj.metadata->>'size')::integer, v_yo);

  perform public.caja_mover_por_pago('PAGO_PARTE_BOLETA', p_id, 'EGRESO', p_caja, p_fecha_pago, p_monto, v_oc.moneda, p_monto_cuenta,
    'Pago de la boleta ' || v_doc.numero_documento || ' de la ' || v_nombre || ' · ' || v_oc.proveedor, v_oc.codigo_interno, v_op);

  perform public.notificar_a_permiso('compras.crear',
    case when v_pagado + p_monto >= v_doc.monto_de_la_parte then 'Boleta de una parte pagada: ' else 'Pago a cuenta de la boleta de una parte: ' end
      || v_nombre,
    v_oc.proveedor || ' · ' || v_doc.numero_documento || ' · ' || v_mon || to_char(p_monto, 'FM999G999G990D00'),
    '/compras/ordenes', 'pagos_parte_con_boleta', p_id, v_yo);
  return p_id;
end;
$$;
comment on function public.registrar_pago_parte_con_boleta(uuid, uuid, date, numeric, text, text, uuid, numeric) is
  'Tesorería paga la boleta de una parte de una OC (entrega mixta), con su voucher y desde la cuenta de la caja que elige, hasta lo que dice la boleta. Exige tesoreria.registrar_pagos (y tesoreria.caja, por la caja).';
revoke all on function public.registrar_pago_parte_con_boleta(uuid, uuid, date, numeric, text, text, uuid, numeric) from public, anon;
grant execute on function public.registrar_pago_parte_con_boleta(uuid, uuid, date, numeric, text, text, uuid, numeric) to authenticated;

-- Anular el pago que no salió o que se registró mal: queda con su motivo y la caja anula su egreso.
create or replace function public.anular_pago_parte_con_boleta(p_id uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_pago public.pagos_parte_con_boleta%rowtype;
begin
  perform public.exigir_permiso('tesoreria.registrar_pagos');
  if char_length(btrim(coalesce(p_motivo, ''))) not between 10 and 500 then
    raise exception 'Cuenta por qué se anula, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_pago from public.pagos_parte_con_boleta where id = p_id;
  if not found then raise exception 'Ese pago no existe.' using errcode = 'check_violation'; end if;
  perform 1 from public.ordenes_compra_materiales where id = v_pago.orden_compra_id for update;
  select * into v_pago from public.pagos_parte_con_boleta where id = p_id;
  if v_pago.anulado_en is not null then
    -- Un segundo clic: ya estaba anulado.
    return p_id;
  end if;
  perform public.caja_anular_por_pago('PAGO_PARTE_BOLETA', p_id, p_motivo, 'pago');
  update public.pagos_parte_con_boleta
     set anulado_por = public.usuario_actual(), anulado_en = now(), motivo_anulacion = btrim(p_motivo)
   where id = p_id;
  return p_id;
end;
$$;
comment on function public.anular_pago_parte_con_boleta(uuid, text) is
  'Tesorería anula, con su motivo, el pago de la boleta de una parte que no salió o se registró mal: su egreso sale de la caja. Exige tesoreria.registrar_pagos (y tesoreria.caja, por la caja).';
revoke all on function public.anular_pago_parte_con_boleta(uuid, text) from public, anon;
grant execute on function public.anular_pago_parte_con_boleta(uuid, text) to authenticated;

-- La lista de Tesorería: cada boleta de una parte vigente de una OC aprobada,
-- con lo pagado y lo que falta, y sus pagos. Las que deben, todas; las pagadas,
-- las 60 últimas. Vence a los días de crédito de su OC contados desde la boleta.
create or replace function public.partes_con_boleta_por_pagar()
returns table (
  documento_id uuid, orden_compra_id uuid, numero text, referencia text, proveedor_id uuid, proveedor text,
  proveedor_documento text, codigo_interno text, moneda text, total_oc numeric, con_factura boolean,
  condicion_pago text, dias_credito integer, boleta text, fecha_boleta date, ruta text, nombre_archivo text,
  monto numeric, pagado numeric, saldo numeric, vence date, ultimo_pago date, pagos jsonb
) language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  if not (public.es_admin() or public.tiene_permiso('tesoreria.registrar_pagos') or public.tiene_permiso('tesoreria.ver_documentos')) then
    raise exception 'Las boletas de una parte las paga Tesorería.' using errcode = 'insufficient_privilege';
  end if;
  return query
  with filas as (
    select d.id as documento_id, c.id as orden_compra_id, c.numero, c.referencia, c.proveedor_id, c.proveedor,
           p.numero_documento as ruc, c.codigo_interno, c.moneda, public.total_orden_compra(c.id) as total_oc, c.con_factura,
           c.condicion_pago, c.dias_credito, d.numero_documento as boleta, d.fecha_emision, d.ruta_storage, d.nombre_archivo,
           d.monto_de_la_parte as monto, coalesce(g.pagado, 0)::numeric(14, 2) as pagado,
           greatest(d.monto_de_la_parte - coalesce(g.pagado, 0), 0)::numeric(14, 2) as saldo,
           d.fecha_emision + coalesce(c.dias_credito, 0) as vence, g.ultimo, coalesce(g.pagos, '[]'::jsonb) as pagos,
           d.creado_en
      from public.documentos_compra_material d
      join public.ordenes_compra_materiales c on c.id = d.orden_compra_id
      left join public.proveedores p on p.id = c.proveedor_id
      left join lateral (
        select sum(x.monto) as pagado, max(x.fecha_pago) as ultimo,
               jsonb_agg(jsonb_build_object('id', x.id, 'fecha', x.fecha_pago, 'monto', x.monto, 'operacion', x.operacion,
                                            'ruta', x.archivo_ruta, 'bucket', 'pagos-compras')
                         order by x.fecha_pago, x.creado_en) as pagos
          from public.pagos_parte_con_boleta x where x.documento_compra_id = d.id and x.anulado_en is null
      ) g on true
     where d.monto_de_la_parte is not null and d.anulado_en is null and c.aprobacion in ('APROBADA', 'NO_REQUERIDA')
  )
  select f.documento_id, f.orden_compra_id, f.numero, f.referencia, f.proveedor_id, f.proveedor, f.ruc, f.codigo_interno,
         f.moneda, f.total_oc, f.con_factura, f.condicion_pago, f.dias_credito, f.boleta, f.fecha_emision, f.ruta_storage,
         f.nombre_archivo, f.monto, f.pagado, f.saldo, f.vence, f.ultimo, f.pagos
    from (
      select f.*, 0 as grupo from filas f where f.saldo > 0
      union all
      (select f.*, 1 from filas f where f.saldo <= 0 order by f.ultimo desc nulls last, f.creado_en desc limit 60)
    ) f
   order by f.grupo, f.vence, f.creado_en;
end;
$$;
comment on function public.partes_con_boleta_por_pagar() is
  'Las boletas de una parte vigentes de OC aprobadas (entrega mixta): las que deben y las 60 últimas pagadas, con lo pagado, lo que falta, cuándo vence y sus pagos. Exige tesoreria.registrar_pagos o tesoreria.ver_documentos.';
revoke all on function public.partes_con_boleta_por_pagar() from public, anon;
grant execute on function public.partes_con_boleta_por_pagar() to authenticated;

-- 6. Lo que ya existía, al tanto de las partes -----------------------------------------------
-- La OC con boleta que llegó en partes no sale entre las que se pagan directo
-- por su boleta entera: sus boletas salen en «Boletas de una parte».
select pg_temp.parchar('public.compras_con_boleta_por_pagar()'::regprocedure, array[
  E'     where not c.con_factura and c.pago_en_tesoreria and c.aprobacion in (''APROBADA'', ''NO_REQUERIDA'')\n',
  E'     where not c.con_factura and c.pago_en_tesoreria and c.aprobacion in (''APROBADA'', ''NO_REQUERIDA'')\n'
  || E'       -- La que llegó en partes paga cada boleta en «Boletas de una parte» (20261022200000).\n'
  || E'       and not exists (select 1 from public.documentos_compra_material x\n'
  || E'                        where x.orden_compra_id = c.id and x.monto_de_la_parte is not null and x.anulado_en is null)\n'
], array[1]);

-- Adquisiciones: pagada cuando sus facturas y sus boletas de una parte lo están;
-- pagada en parte si ya tiene su factura y alguna boleta de una parte tiene pago
-- (sin factura sigue esperándola, o por pagar si es con boleta). Y cada boleta de una
-- parte, entre los documentos de la OC, con su monto, lo pagado y sus pagos.
select pg_temp.parchar('public.trazabilidad_de_compras()'::regprocedure, array[
  E'                                        ''anulado_en'', d.anulado_en, ''motivo_anulacion'', d.motivo_anulacion,\n',
  E'                                        ''anulado_en'', d.anulado_en, ''motivo_anulacion'', d.motivo_anulacion,\n'
  || E'                                        -- La boleta de una parte (20261022200000): su monto y lo que Tesorería le pagó.\n'
  || E'                                        ''monto_de_la_parte'', d.monto_de_la_parte,\n'
  || E'                                        ''pagos_de_la_parte'', case when d.monto_de_la_parte is not null then\n'
  || E'                                          (select coalesce(jsonb_agg(jsonb_build_object(''id'', y.id, ''fecha'', y.fecha_pago, ''monto'', y.monto,\n'
  || E'                                                                                        ''operacion'', y.operacion, ''ruta'', y.archivo_ruta,\n'
  || E'                                                                                        ''bucket'', ''pagos-compras'')\n'
  || E'                                                                     order by y.fecha_pago, y.creado_en), ''[]''::jsonb)\n'
  || E'                                             from public.pagos_parte_con_boleta y\n'
  || E'                                            where y.documento_compra_id = d.id and y.anulado_en is null) end,\n',
  E'           when not c.con_factura and fa.pagadas\n',
  E'           when not c.con_factura and fa.pagadas and coalesce(pt.pagado, 0) >= coalesce(pt.monto, 0)\n',
  E'           when fa.pagadas and coalesce(fd.completa',
  E'           when fa.pagadas and coalesce(pt.pagado, 0) >= coalesce(pt.monto, 0) and coalesce(fd.completa',
  E'           when fa.pagado > 0 then ''PAGO_PARCIAL''\n',
  E'           when fa.pagado > 0 or coalesce(pt.pagado, 0) > 0 then ''PAGO_PARCIAL''\n',
  E'    left join documento dc on dc.orden_compra_id = c.id\n',
  E'    left join documento dc on dc.orden_compra_id = c.id\n'
  || E'    -- Lo que suman sus boletas de una parte y lo que Tesorería les pagó (20261022200000).\n'
  || E'    left join lateral public.partes_con_boleta_de_la_compra(c.id) pt on true\n'
], array[1, 1, 1, 1, 1]);

-- Pagada de más entre su factura y sus boletas de una parte: la factura que
-- Contabilidad registró por toda la OC cuando una parte ya venía con boleta. El
-- control ya dice «no calza», pero pagadas las dos la OC salía «Pagada».
select pg_temp.parchar('public.trazabilidad_de_compras()'::regprocedure, array[
  E'           -- La OC con boleta se paga por su factura, ligada o anexada: pagada esa, pagada la OC. Si\n',
  E'           -- Entre su factura y sus boletas de una parte se facturó y se pagó más que su total (20261022200000).\n'
  || E'           when fa.pagadas and coalesce(pt.monto, 0) > 0 and coalesce(pt.pagado, 0) >= pt.monto\n'
  || E'                and coalesce(fd.facturado, 0) > coalesce(fd.total, 0) + 1 then ''PAGADA_DE_MAS''\n'
  || E'           -- La OC con boleta se paga por su factura, ligada o anexada: pagada esa, pagada la OC. Si\n'
], array[1]);

-- Gerencia no anula una OC con una boleta de una parte vigente: primero
-- Logística anula la boleta (y, si tiene pagos, Tesorería antes esos pagos).
-- Sin esto la OC salía como anulable y al anularla saltaba otro error.
select pg_temp.parchar('public.motivo_para_no_anular_compra(uuid)'::regprocedure, array[
  E'  -- La OC con boleta que Gerencia aprobó antes del 20/10 se dio por pagada fuera del\n',
  E'  -- La boleta de una parte (20261022200000): primero se anula ella, y antes sus pagos.\n'
  || E'  select d.numero_documento into v_doc from public.documentos_compra_material d\n'
  || E'   where d.orden_compra_id = p_compra and d.monto_de_la_parte is not null and d.anulado_en is null order by d.creado_en limit 1;\n'
  || E'  if found then\n'
  || E'    return format(''La %s tiene anexada la boleta %s de una parte: que Logística la anule antes%s.'', v_nombre, v_doc,\n'
  || E'                  case when exists (select 1 from public.pagos_parte_con_boleta x where x.orden_compra_id = p_compra and x.anulado_en is null)\n'
  || E'                       then '', y antes Tesorería anule lo que le pagó'' else '''' end);\n'
  || E'  end if;\n'
  || E'  -- La OC con boleta que Gerencia aprobó antes del 20/10 se dio por pagada fuera del\n'
], array[1]);

-- La boleta de una parte no se registra además como comprobante en
-- Adquisiciones: Tesorería la pagaría dos veces, por ella y por el comprobante.
create or replace function public.fn_adquisicion_no_es_boleta_de_una_parte()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_numero text := public.clave_numero_comprobante(new.numero_documento);
  v_doc    record;
begin
  if v_numero is null
     or (tg_op = 'UPDATE' and v_numero is not distinct from public.clave_numero_comprobante(old.numero_documento)
         and new.proveedor is not distinct from old.proveedor and new.ruc_proveedor is not distinct from old.ruc_proveedor) then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('parte|' || v_numero, 0));
  select d.numero_documento, coalesce(c.numero, 'OC ' || c.referencia) as compra into v_doc
    from public.documentos_compra_material d
    join public.ordenes_compra_materiales c on c.id = d.orden_compra_id
    left join public.proveedores p on p.id = c.proveedor_id
   where d.monto_de_la_parte is not null and d.anulado_en is null
     and public.clave_numero_comprobante(d.numero_documento) = v_numero
     and (case when new.ruc_proveedor is not null and p.numero_documento is not null then p.numero_documento = new.ruc_proveedor
               else public.mismo_proveedor(c.proveedor, new.proveedor) end)
   limit 1;
  if found then
    raise exception 'El comprobante % es la boleta de una parte que Logística anexó a la %: Tesorería la paga ahí, en «Boletas de una parte». No se registra otra vez.',
      v_doc.numero_documento, v_doc.compra using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_adquisicion_no_es_boleta_de_una_parte() from public, anon, authenticated;
create or replace trigger trg_adquisicion_no_es_boleta_de_una_parte
  before insert or update of numero_documento, proveedor, ruc_proveedor on public.adquisiciones
  for each row execute function public.fn_adquisicion_no_es_boleta_de_una_parte();
