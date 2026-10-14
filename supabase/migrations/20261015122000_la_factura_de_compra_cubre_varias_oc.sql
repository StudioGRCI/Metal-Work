-- =============================================================================
-- LA FACTURA DE COMPRA CUBRE UNA O VARIAS OC, Y TESORERÍA LA PAGA CON SU VOUCHER
-- -----------------------------------------------------------------------------
-- Gerencia, el 2026-10-14: «una factura puede ser para varios requerimientos»,
-- y «si queremos que Tesorería adjunte el voucher de pago debe ser por la
-- factura, no por la orden de compra». Eligió pagar por factura (22:45 UTC).
-- Hasta hoy el comprobante que Contabilidad registra en Adquisiciones se
-- vinculaba a una sola OC, Tesorería anotaba el pago con una referencia y sin
-- voucher, y los comprobantes al contado no le llegaban.
--
-- Desde aquí:
--   · Cada factura de compra se enlaza a UNA O VARIAS OC del mismo proveedor.
--   · Adquisiciones avisa si el total de la factura no calza con el de sus OC
--     (con IGV si la OC va con factura). Es solo un aviso: la OC no siempre va
--     a la par con la factura, y nada se bloquea por eso. Ahí mismo salen las
--     OC que todavía esperan su factura.
--   · Logística ve Adquisiciones (`adquisiciones.ver`), sin registrar nada.
--   · Tesorería paga cada factura, al contado o a crédito, adjuntando el
--     voucher (bucket privado `pagos-facturas`). Un pago no se borra: se anula
--     con motivo.
--
-- Sin DROP: el conector de producción no deja pasar ninguno. La restricción
-- vieja de la referencia del pago se suelta en la 20261015123000.
-- =============================================================================

-- 1. Logística ve Adquisiciones ----------------------------------------------------
insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, 'adquisiciones.ver' from public.roles r where r.codigo = 'COMPRADOR'
on conflict do nothing;

-- 2. Las OC de cada factura ------------------------------------------------------------
create table if not exists public.adquisiciones_ordenes_compra (
  id               uuid primary key default gen_random_uuid(),
  adquisicion_id   uuid not null references public.adquisiciones(id) on delete restrict,
  orden_compra_id  uuid not null references public.ordenes_compra_materiales(id) on delete restrict,
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now(),
  constraint uq_adquisicion_orden_compra unique (adquisicion_id, orden_compra_id)
);
comment on table public.adquisiciones_ordenes_compra is
  'Las OC que cubre una factura de compra: una o varias, del mismo proveedor. Se fijan al registrar la factura y no cambian.';
-- (b) «OC sin factura» y la lista de Tesorería buscan, por cada OC, si ya tiene factura.
create index if not exists ix_adquisicion_oc_compra on public.adquisiciones_ordenes_compra (orden_compra_id);
select public.activar_timestamps('adquisiciones_ordenes_compra');
select public.activar_auditoria('adquisiciones_ordenes_compra');
select public.activar_registro_de_prueba('adquisiciones_ordenes_compra');

-- Las que ya tenían su OC única, antes de que el disparador de abajo exija borrador.
insert into public.adquisiciones_ordenes_compra (adquisicion_id, orden_compra_id)
select a.id, a.orden_compra_id from public.adquisiciones a where a.orden_compra_id is not null
on conflict (adquisicion_id, orden_compra_id) do nothing;

alter table public.adquisiciones_ordenes_compra enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'adquisiciones_ordenes_compra' and policyname = 'ver_adquisiciones_oc') then
    create policy ver_adquisiciones_oc on public.adquisiciones_ordenes_compra for select to authenticated
      using ((select public.tiene_permiso('adquisiciones.ver')));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'adquisiciones_ordenes_compra' and policyname = 'enlazar_adquisiciones_oc') then
    create policy enlazar_adquisiciones_oc on public.adquisiciones_ordenes_compra for insert to authenticated
      with check ((select public.tiene_permiso('adquisiciones.registrar')) and exists (
        select 1 from public.adquisiciones a
         where a.id = adquisicion_id and a.estado = 'BORRADOR' and a.registrado_por = (select public.usuario_actual())));
  end if;
end $$;
revoke all on public.adquisiciones_ordenes_compra from public, anon, authenticated;
grant select, insert on public.adquisiciones_ordenes_compra to authenticated;

-- Una OC entra a una factura en borrador, si no está rechazada, con la misma
-- condición de pago y del mismo proveedor que la primera OC de la factura.
create or replace function public.fn_adquisicion_oc_valida()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_adq  public.adquisiciones%rowtype;
  v_oc   public.ordenes_compra_materiales%rowtype;
  v_base public.ordenes_compra_materiales%rowtype;
begin
  select * into v_adq from public.adquisiciones where id = new.adquisicion_id;
  if not found or v_adq.estado <> 'BORRADOR' then
    raise exception 'Las OC de una factura se eligen al registrarla; registrada, ya no cambian.' using errcode = 'check_violation';
  end if;
  select * into v_oc from public.ordenes_compra_materiales where id = new.orden_compra_id;
  if not found then raise exception 'Esa orden de compra no existe.' using errcode = 'check_violation'; end if;
  if v_oc.aprobacion = 'RECHAZADA' then
    raise exception 'La orden de compra % está rechazada: no se factura.', coalesce(v_oc.numero, v_oc.referencia) using errcode = 'check_violation';
  end if;
  if v_oc.condicion_pago <> v_adq.condicion_pago then
    raise exception 'La orden de compra % es al %: la factura tiene que ir igual.', coalesce(v_oc.numero, v_oc.referencia),
      case when v_oc.condicion_pago = 'CREDITO' then 'crédito' else 'contado' end using errcode = 'check_violation';
  end if;
  if v_adq.orden_compra_id is not null and v_adq.orden_compra_id <> new.orden_compra_id then
    select * into v_base from public.ordenes_compra_materiales where id = v_adq.orden_compra_id;
    if coalesce(v_base.proveedor_id::text, upper(btrim(v_base.proveedor)))
       is distinct from coalesce(v_oc.proveedor_id::text, upper(btrim(v_oc.proveedor))) then
      raise exception 'Una factura es de un solo proveedor: la orden de compra % es de %.', coalesce(v_oc.numero, v_oc.referencia), v_oc.proveedor
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.fn_adquisicion_oc_valida() from public, anon, authenticated;
create or replace trigger trg_adquisicion_oc_valida
  before insert on public.adquisiciones_ordenes_compra
  for each row execute function public.fn_adquisicion_oc_valida();

create or replace function public.fn_adquisicion_oc_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if tg_op = 'DELETE' or (to_jsonb(new) - 'actualizado_en') is distinct from (to_jsonb(old) - 'actualizado_en') then
    raise exception 'Las OC de una factura no se cambian ni se quitan.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_adquisicion_oc_guardia() from public, anon, authenticated;
create or replace trigger trg_adquisicion_oc_guardia
  before update or delete on public.adquisiciones_ordenes_compra
  for each row execute function public.fn_adquisicion_oc_guardia();

-- La OC que se elige en la factura (la primera) queda enlazada sola.
create or replace function public.fn_adquisicion_enlaza_su_oc()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.orden_compra_id is not null then
    insert into public.adquisiciones_ordenes_compra (adquisicion_id, orden_compra_id)
    values (new.id, new.orden_compra_id)
    on conflict (adquisicion_id, orden_compra_id) do nothing;
  end if;
  return null;
end;
$$;
revoke all on function public.fn_adquisicion_enlaza_su_oc() from public, anon, authenticated;
create or replace trigger trg_adquisicion_enlaza_su_oc
  after insert or update of orden_compra_id on public.adquisiciones
  for each row execute function public.fn_adquisicion_enlaza_su_oc();

-- Logística no cambia la condición ni la moneda de una OC que ya tiene factura,
-- tampoco la de una que entró como segunda o tercera OC de la factura.
create or replace function public.fn_compra_con_factura_no_cambia_pago()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if (new.condicion_pago, new.dias_credito, new.moneda) is distinct from (old.condicion_pago, old.dias_credito, old.moneda)
     and exists (select 1 from public.adquisiciones_ordenes_compra where orden_compra_id = new.id) then
    raise exception 'La orden de compra % ya tiene factura en Adquisiciones: su condición de pago y su moneda no cambian.',
      coalesce(new.numero, new.referencia) using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_compra_con_factura_no_cambia_pago() from public, anon, authenticated;
create or replace trigger trg_compra_con_factura_no_cambia_pago
  before update on public.ordenes_compra_materiales
  for each row execute function public.fn_compra_con_factura_no_cambia_pago();

-- La compra a crédito «sin comprobante» es la que no está en ninguna factura
-- registrada, como primera OC o como una de las demás.
create or replace view public.v_compras_credito_sin_comprobante with (security_invoker = true) as
select c.id as orden_compra_id, r.orden_id, o.numero as numero_ot,
       c.proveedor, c.referencia, c.creado_en::date as fecha_compra,
       (c.creado_en::date + c.dias_credito) as fecha_vencimiento,
       case when bool_or(d.precio_unitario is null) then null::numeric
            else round(sum(d.cantidad::numeric * d.precio_unitario), 2)::numeric(14,2)
       end as total_estimado,
       c.moneda,
       c.numero
  from public.ordenes_compra_materiales c
  left join public.requerimientos_materiales r on r.id = c.requerimiento_id
  left join public.ordenes_trabajo o on o.id = r.orden_id
  join public.orden_compra_material_detalles d on d.orden_compra_id = c.id
 where c.condicion_pago = 'CREDITO'
   and (c.requerimiento_id is null or o.id is not null)
   and not exists (select 1 from public.adquisiciones_ordenes_compra l
                     join public.adquisiciones a on a.id = l.adquisicion_id
                    where l.orden_compra_id = c.id and a.estado = 'REGISTRADA')
 group by c.id, r.orden_id, o.numero;

-- 3. El total de cada OC, como sale impreso ----------------------------------------
-- La suma de los importes de sus líneas (cada uno al céntimo) más el IGV si la
-- OC va con factura: lo mismo que `totalCompra` e `igvCompra` en la aplicación.
create or replace function public.total_orden_compra(p_compra uuid)
returns numeric language sql stable set search_path to 'public' as $$
  select (s.subtotal + case when c.con_factura then round(s.subtotal * 0.18, 2) else 0 end)::numeric(14, 2)
    from public.ordenes_compra_materiales c
    cross join lateral (
      select coalesce(sum(round(d.cantidad::numeric * coalesce(d.precio_unitario, 0), 2)), 0) as subtotal
        from public.orden_compra_material_detalles d where d.orden_compra_id = c.id) s
   where c.id = p_compra;
$$;
revoke all on function public.total_orden_compra(uuid) from public, anon, authenticated;

-- 4. El aviso de Adquisiciones: ¿la factura calza con sus OC? -----------------------
-- CALZA si la diferencia no pasa de 1.00 en la moneda de la factura. SIN_OC,
-- OTRA_MONEDA y SIN_PRECIO dicen por qué no se puede comparar. Solo avisa.
create or replace function public.adquisiciones_control(p_ids uuid[])
returns table (adquisicion_id uuid, ordenes jsonb, total_oc numeric, diferencia numeric, control text)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not (public.es_admin() or public.tiene_permiso('adquisiciones.ver')) then
    raise exception 'Adquisiciones la ven Contabilidad, Tesorería y Logística.' using errcode = 'insufficient_privilege';
  end if;
  return query
    with oc as (
      select l.adquisicion_id as adq, c.id, c.numero, c.referencia, c.moneda, c.con_factura,
             public.total_orden_compra(c.id) as total,
             exists (select 1 from public.orden_compra_material_detalles d
                      where d.orden_compra_id = c.id and d.precio_unitario is null) as sin_precio,
             o.numero as numero_ot
        from public.adquisiciones_ordenes_compra l
        join public.ordenes_compra_materiales c on c.id = l.orden_compra_id
        left join public.requerimientos_materiales r on r.id = c.requerimiento_id
        left join public.ordenes_trabajo o on o.id = r.orden_id
       where l.adquisicion_id = any (p_ids)
    )
    select a.id,
           coalesce(jsonb_agg(jsonb_build_object('id', oc.id, 'numero', oc.numero, 'referencia', oc.referencia,
                                                 'moneda', oc.moneda, 'total', oc.total, 'sin_precio', oc.sin_precio,
                                                 'con_factura', oc.con_factura, 'numero_ot', oc.numero_ot)
                              order by oc.numero) filter (where oc.id is not null), '[]'::jsonb),
           case when count(oc.id) = 0 or bool_or(oc.sin_precio) or bool_or(oc.moneda <> a.moneda) then null
                else sum(oc.total)::numeric(14, 2) end,
           case when count(oc.id) = 0 or bool_or(oc.sin_precio) or bool_or(oc.moneda <> a.moneda) then null
                else (a.total - sum(oc.total))::numeric(14, 2) end,
           case when count(oc.id) = 0 then 'SIN_OC'
                when bool_or(oc.moneda <> a.moneda) then 'OTRA_MONEDA'
                when bool_or(oc.sin_precio) then 'SIN_PRECIO'
                when abs(a.total - sum(oc.total)) <= 1 then 'CALZA'
                else 'NO_CALZA' end
      from public.adquisiciones a
      left join oc on oc.adq = a.id
     where a.id = any (p_ids)
     group by a.id;
end;
$$;
revoke all on function public.adquisiciones_control(uuid[]) from public, anon;
grant execute on function public.adquisiciones_control(uuid[]) to authenticated;

-- Las OC que esperan su factura: aprobadas (o sin aprobación pedida), que van
-- con factura y que no están en ninguna factura registrada. Contabilidad elige
-- de aquí las OC de la factura que registra.
create or replace function public.compras_sin_factura()
returns table (orden_compra_id uuid, numero text, proveedor text, referencia text, moneda text, total numeric,
               sin_precio boolean, condicion_pago text, numero_ot text, creado_en timestamptz, en_borrador boolean)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not (public.es_admin() or public.tiene_permiso('adquisiciones.ver')) then
    raise exception 'Adquisiciones la ven Contabilidad, Tesorería y Logística.' using errcode = 'insufficient_privilege';
  end if;
  return query
    select c.id, c.numero, c.proveedor, c.referencia, c.moneda, public.total_orden_compra(c.id),
           exists (select 1 from public.orden_compra_material_detalles d
                    where d.orden_compra_id = c.id and d.precio_unitario is null),
           c.condicion_pago, o.numero, c.creado_en,
           exists (select 1 from public.adquisiciones_ordenes_compra l
                     join public.adquisiciones a on a.id = l.adquisicion_id
                    where l.orden_compra_id = c.id and a.estado = 'BORRADOR')
      from public.ordenes_compra_materiales c
      left join public.requerimientos_materiales r on r.id = c.requerimiento_id
      left join public.ordenes_trabajo o on o.id = r.orden_id
     where c.con_factura and c.aprobacion in ('NO_REQUERIDA', 'APROBADA')
       and not exists (select 1 from public.adquisiciones_ordenes_compra l
                         join public.adquisiciones a on a.id = l.adquisicion_id
                        where l.orden_compra_id = c.id and a.estado = 'REGISTRADA')
     order by c.creado_en desc
     limit 200;
end;
$$;
revoke all on function public.compras_sin_factura() from public, anon;
grant execute on function public.compras_sin_factura() to authenticated;

-- 5. Tesorería paga la factura con su voucher -----------------------------------------
alter table public.pagos_adquisicion add column if not exists archivo_ruta text;
alter table public.pagos_adquisicion add column if not exists archivo_mime text;
alter table public.pagos_adquisicion add column if not exists archivo_tamano integer;
alter table public.pagos_adquisicion add column if not exists anulado_por uuid references public.usuarios(id) on delete restrict;
alter table public.pagos_adquisicion add column if not exists anulado_en timestamptz;
alter table public.pagos_adquisicion add column if not exists motivo_anulacion text;
alter table public.pagos_adquisicion add column if not exists actualizado_en timestamptz not null default now();
comment on column public.pagos_adquisicion.archivo_ruta is 'El voucher del pago, en el bucket pagos-facturas. Vacío solo en los pagos anotados antes del 2026-10-15.';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'uq_pago_adquisicion_archivo' and conrelid = 'public.pagos_adquisicion'::regclass) then
    alter table public.pagos_adquisicion add constraint uq_pago_adquisicion_archivo unique (archivo_ruta);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_pago_adquisicion_voucher' and conrelid = 'public.pagos_adquisicion'::regclass) then
    alter table public.pagos_adquisicion add constraint ck_pago_adquisicion_voucher check (
      (archivo_ruta is null) = (archivo_mime is null) and (archivo_ruta is null) = (archivo_tamano is null)
      and (archivo_mime is null or archivo_mime in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp'))
      and (archivo_tamano is null or archivo_tamano between 1 and 10485760));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_pago_adquisicion_anulado' and conrelid = 'public.pagos_adquisicion'::regclass) then
    alter table public.pagos_adquisicion add constraint ck_pago_adquisicion_anulado check (
      anulado_en is null
      or (anulado_por is not null and char_length(btrim(coalesce(motivo_anulacion, ''))) between 10 and 500));
  end if;
end $$;
-- La referencia vale una vez por factura entre los pagos vigentes (la
-- 20261015123000 suelta la restricción que la pedía también entre los anulados).
create unique index if not exists uq_pago_adquisicion_referencia_vigente
  on public.pagos_adquisicion (adquisicion_id, referencia) where anulado_en is null;
-- (b) Cuentas por pagar suma los pagos de cada factura; el índice único de
-- arriba ya empieza por adquisicion_id, pero es parcial: este cubre todos.
create index if not exists ix_pagos_adquisicion_adquisicion on public.pagos_adquisicion (adquisicion_id);
select public.activar_timestamps('pagos_adquisicion');
select public.activar_registro_de_prueba('pagos_adquisicion');

-- El saldo se cuenta con los pagos vigentes.
create or replace function public.fn_validar_pago_adquisicion()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_total numeric; v_estado text; v_pagado numeric;
begin
  perform public.exigir_permiso('tesoreria.registrar_pagos');
  select total, estado into v_total, v_estado from public.adquisiciones where id = new.adquisicion_id for update;
  if v_estado <> 'REGISTRADA' then raise exception 'El comprobante debe estar registrado antes del pago.'; end if;
  select coalesce(sum(monto), 0) into v_pagado from public.pagos_adquisicion
   where adquisicion_id = new.adquisicion_id and anulado_en is null;
  if v_pagado + new.monto > v_total then raise exception 'El pago supera el saldo del comprobante.'; end if;
  return new;
end;
$$;

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
  return new;
end;
$$;
revoke all on function public.fn_pago_adquisicion_guardia() from public, anon, authenticated;
create or replace trigger trg_pago_adquisicion_guardia
  before update or delete on public.pagos_adquisicion
  for each row execute function public.fn_pago_adquisicion_guardia();

-- Los pagos entran solo por `registrar_pago_factura`, con su voucher.
revoke insert, update, delete on public.pagos_adquisicion from authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pagos-facturas', 'pagos-facturas', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'pagos_facturas_subir') then
    create policy pagos_facturas_subir on storage.objects for insert to authenticated with check (
      bucket_id = 'pagos-facturas' and owner_id = (select auth.uid())::text
      and (select public.tiene_permiso('tesoreria.registrar_pagos') or public.es_admin()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'pagos_facturas_ver') then
    create policy pagos_facturas_ver on storage.objects for select to authenticated using (
      bucket_id = 'pagos-facturas'
      and (owner_id = (select auth.uid())::text
           or exists (select 1 from public.pagos_adquisicion p where p.archivo_ruta = objects.name)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'pagos_facturas_quitar_suelto') then
    create policy pagos_facturas_quitar_suelto on storage.objects for delete to authenticated using (
      bucket_id = 'pagos-facturas' and owner_id = (select auth.uid())::text
      and not exists (select 1 from public.pagos_adquisicion p where p.archivo_ruta = objects.name));
  end if;
end $$;

create or replace function public.registrar_pago_factura(
  p_id uuid, p_adquisicion uuid, p_fecha date, p_monto numeric, p_referencia text, p_ruta text
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo   uuid := public.usuario_actual();
  v_hoy  date := (now() at time zone 'America/Lima')::date;
  v_adq  public.adquisiciones%rowtype;
  v_obj  storage.objects%rowtype;
  v_ref  text := btrim(coalesce(p_referencia, ''));
begin
  perform public.exigir_permiso('tesoreria.registrar_pagos');
  if p_id is null then raise exception 'Vuelve a abrir el formulario del pago.' using errcode = 'check_violation'; end if;
  if exists (select 1 from public.pagos_adquisicion where id = p_id) then return p_id; end if;
  select * into v_adq from public.adquisiciones where id = p_adquisicion;
  if not found or v_adq.estado <> 'REGISTRADA' then
    raise exception 'Esa factura todavía no está registrada en Adquisiciones.' using errcode = 'check_violation';
  end if;
  if p_fecha is null or p_fecha > v_hoy or p_fecha < v_hoy - 365 then
    raise exception 'Elige el día del pago: de hoy hacia atrás.' using errcode = 'check_violation';
  end if;
  if p_monto is null or p_monto <= 0 or p_monto <> round(p_monto, 2) then
    raise exception 'Escribe lo que se pagó, en dos decimales.' using errcode = 'check_violation';
  end if;
  if char_length(v_ref) not between 3 and 120 then
    raise exception 'Escribe el número de operación del banco, de 3 a 120 caracteres.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.pagos_adquisicion
              where adquisicion_id = p_adquisicion and referencia = v_ref and anulado_en is null) then
    raise exception 'La operación % ya está registrada en esta factura.', v_ref using errcode = 'unique_violation';
  end if;
  -- Mientras siga la restricción vieja (la suelta la 20261015123000).
  if exists (select 1 from public.pagos_adquisicion
              where adquisicion_id = p_adquisicion and referencia = v_ref and anulado_en is not null)
     and exists (select 1 from pg_constraint where conname = 'pagos_adquisicion_adquisicion_id_referencia_key'
                   and conrelid = 'public.pagos_adquisicion'::regclass) then
    raise exception 'La operación % ya se usó en un pago anulado de esta factura: para volver a usarla, el administrador del sistema tiene que liberarla.', v_ref
      using errcode = 'check_violation';
  end if;
  v_obj := public.archivo_subido_por_mi('pagos-facturas', p_ruta, p_adquisicion,
                                        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

  insert into public.pagos_adquisicion (id, adquisicion_id, fecha, monto, referencia, registrado_por,
                                        archivo_ruta, archivo_mime, archivo_tamano)
  values (p_id, p_adquisicion, p_fecha, p_monto, v_ref, v_yo,
          p_ruta, v_obj.metadata->>'mimetype', (v_obj.metadata->>'size')::integer);
  return p_id;
end;
$$;
revoke all on function public.registrar_pago_factura(uuid, uuid, date, numeric, text, text) from public, anon;
grant execute on function public.registrar_pago_factura(uuid, uuid, date, numeric, text, text) to authenticated;

create or replace function public.anular_pago_factura(p_id uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_pago public.pagos_adquisicion%rowtype;
begin
  perform public.exigir_permiso('tesoreria.registrar_pagos');
  if char_length(btrim(coalesce(p_motivo, ''))) not between 10 and 500 then
    raise exception 'Cuenta por qué se anula, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_pago from public.pagos_adquisicion where id = p_id for update;
  if not found then raise exception 'Ese pago no existe.' using errcode = 'check_violation'; end if;
  if v_pago.anulado_en is not null then return p_id; end if;
  update public.pagos_adquisicion
     set anulado_por = public.usuario_actual(), anulado_en = now(), motivo_anulacion = btrim(p_motivo)
   where id = p_id;
  return p_id;
end;
$$;
revoke all on function public.anular_pago_factura(uuid, text) from public, anon;
grant execute on function public.anular_pago_factura(uuid, text) to authenticated;

-- 6. Cuentas por pagar: toda factura registrada, al contado o a crédito --------------
-- La de contado vence el día que se emitió. Las columnas nuevas van al final.
create or replace view public.v_cuentas_pagar with (security_invoker = true) as
select a.id, a.orden_id, o.numero as numero_ot, a.proveedor, a.numero_documento,
       a.fecha_emision, a.fecha_vencimiento, a.moneda, a.total,
       (coalesce(sum(p.monto) filter (where p.anulado_en is null), 0))::numeric(14, 2) as pagado,
       (a.total - coalesce(sum(p.monto) filter (where p.anulado_en is null), 0))::numeric(14, 2) as saldo,
       a.condicion_pago, a.tipo
  from public.adquisiciones a
  left join public.ordenes_trabajo o on o.id = a.orden_id
  left join public.pagos_adquisicion p on p.adquisicion_id = a.id
 where a.estado = 'REGISTRADA'
 group by a.id, o.numero;
revoke all on public.v_cuentas_pagar from public, anon;
grant select on public.v_cuentas_pagar to authenticated;
