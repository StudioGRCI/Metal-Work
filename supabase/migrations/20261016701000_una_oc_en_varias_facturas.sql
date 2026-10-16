-- =============================================================================
-- UNA ORDEN DE COMPRA EN VARIAS FACTURAS
-- -----------------------------------------------------------------------------
-- Gerencia, el 2026-10-15: «varios RQ para una orden de compra, pero una orden
-- de compra para varias facturas». El proveedor entrega por partes y factura
-- cada parte: la OC de 20 planchas llega en dos viajes, con dos facturas. Hasta
-- hoy una OC salía de «OC que esperan su factura» con la primera, y la segunda
-- ya no la podía nombrar.
--
-- Desde aquí, al registrar la factura, Contabilidad marca las OC que esa
-- factura cubre solo en parte (`parcial`). La OC sigue esperando su factura
-- hasta que una la complete (no parcial) o hasta que lo facturado llegue a su
-- total. Una factura sigue pudiendo cubrir varias OC (20261015122000).
--
-- El detector de la factura (20261016600000) compara contra lo que FALTA
-- facturar de cada OC, no contra su total: la segunda factura de una OC calza si
-- cubre lo que la primera dejó. Una factura parcial sale «Parcial» mientras no
-- pase de lo que falta.
--
-- Lo facturado de cada OC sale de sus facturas registradas: una factura de una
-- sola OC va entera a ella; la de varias, primero a las que completa (su total)
-- y lo que sobra, a las parciales en proporción a su total.
-- Sin DROP ni borrados: el conector de producción no deja pasar ninguno.
-- =============================================================================

-- 1. La factura que cubre solo una parte de la OC -------------------------------------------
alter table public.adquisiciones_ordenes_compra
  add column if not exists parcial boolean not null default false;
comment on column public.adquisiciones_ordenes_compra.parcial is
  'Esta factura cubre solo una parte de la OC: la OC sigue esperando su factura hasta que otra la complete o lo facturado llegue a su total.';

-- Que una OC cubierta solo en parte se marque mientras la factura está en
-- borrador (la principal la enlaza la base sola, al crear el borrador) y, ya
-- registrada, solo en una corrección con su justificante.
create or replace function public.fn_adquisicion_oc_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  -- La corrección de la factura quita una OC, la devuelve o la marca parcial, y nada más cambia.
  if tg_op = 'UPDATE' and current_setting('metalwork.corrigiendo', true) = 'factura'
     and (to_jsonb(new) - 'actualizado_en' - 'quitada_en' - 'quitada_por' - 'parcial')
         = (to_jsonb(old) - 'actualizado_en' - 'quitada_en' - 'quitada_por' - 'parcial') then
    return new;
  end if;
  -- En borrador, quien la registra marca si cubre solo una parte de la OC.
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'actualizado_en' - 'parcial') = (to_jsonb(old) - 'actualizado_en' - 'parcial')
     and exists (select 1 from public.adquisiciones a where a.id = new.adquisicion_id and a.estado = 'BORRADOR') then
    return new;
  end if;
  if tg_op = 'DELETE' or (to_jsonb(new) - 'actualizado_en') is distinct from (to_jsonb(old) - 'actualizado_en') then
    raise exception 'Las OC de una factura registrada no se cambian ni se quitan sin una corrección con su justificante.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_adquisicion_oc_guardia() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'adquisiciones_ordenes_compra'
                    and policyname = 'marcar_parcial_adquisiciones_oc') then
    create policy marcar_parcial_adquisiciones_oc on public.adquisiciones_ordenes_compra for update to authenticated
      using ((select public.tiene_permiso('adquisiciones.registrar'))
             and exists (select 1 from public.adquisiciones a
                          where a.id = adquisiciones_ordenes_compra.adquisicion_id and a.estado = 'BORRADOR'
                            and a.registrado_por = (select public.usuario_actual())))
      with check ((select public.tiene_permiso('adquisiciones.registrar'))
             and exists (select 1 from public.adquisiciones a
                          where a.id = adquisiciones_ordenes_compra.adquisicion_id and a.estado = 'BORRADOR'
                            and a.registrado_por = (select public.usuario_actual())));
  end if;
end $$;
grant update (parcial) on public.adquisiciones_ordenes_compra to authenticated;

-- 2. Lo facturado de cada OC ------------------------------------------------------------------
-- Interna: sin pedir permiso. La llaman compras_sin_factura, adquisiciones_control
-- y facturado_de_compras, que sí lo piden. p_sin deja fuera una factura (la que se mira).
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
    select c.id, c.moneda, public.total_orden_compra(c.id) as total
      from public.ordenes_compra_materiales c
     where c.id in (select e.orden_compra_id from enlace e)
  ), reparto as (
    select e.*, o.total as total_oc,
           sum(o.total) filter (where not e.parcial) over w as completas,
           sum(o.total) filter (where e.parcial) over w as parciales,
           sum(o.total) over w as todas,
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
  )
  select p.orden_compra_id, max(p.total_oc)::numeric, round(coalesce(sum(p.parte), 0), 2)::numeric, bool_or(not p.parcial),
         jsonb_agg(jsonb_build_object('id', p.adquisicion_id, 'numero_documento', p.numero_documento, 'total', p.total_factura,
                                      'moneda', p.moneda_factura, 'parcial', p.parcial, 'parte', round(p.parte, 2))
                   order by p.numero_documento)
    from parte p
   where p_ids is null or p.orden_compra_id = any (p_ids)
   group by p.orden_compra_id;
$$;
comment on function public.compras_facturadas(uuid[], uuid) is
  'Lo facturado de cada OC en sus facturas registradas (sin la p_sin), sin pedir permiso: la llaman compras_sin_factura, adquisiciones_control y facturado_de_compras.';
revoke all on function public.compras_facturadas(uuid[], uuid) from public, anon, authenticated;

create or replace function public.facturado_de_compras(p_ids uuid[])
returns table (orden_compra_id uuid, total numeric, facturado numeric, completa boolean, facturas jsonb)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not (public.es_admin() or public.tiene_permiso('adquisiciones.ver')) then
    raise exception 'Adquisiciones la ven Contabilidad, Tesorería y Logística.' using errcode = 'insufficient_privilege';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return;
  end if;
  return query select * from public.compras_facturadas(p_ids, null);
end;
$$;
comment on function public.facturado_de_compras(uuid[]) is
  'Cuánto de cada OC ya está facturado, en qué facturas y si alguna la completa. Para registrar la segunda factura de una OC. Exige adquisiciones.ver.';
revoke all on function public.facturado_de_compras(uuid[]) from public, anon;
grant execute on function public.facturado_de_compras(uuid[]) to authenticated;

-- 3. Una OC espera su factura hasta que alguna la complete --------------------------------------
-- Las mismas columnas de la 20261016602000.
create or replace function public.compras_sin_factura()
returns table (orden_compra_id uuid, numero text, proveedor text, referencia text, moneda text, total numeric,
               sin_precio boolean, condicion_pago text, numero_ot text, creado_en timestamptz, en_borrador boolean, orden_id uuid)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not (public.es_admin() or public.tiene_permiso('adquisiciones.ver')) then
    raise exception 'Adquisiciones la ven Contabilidad, Tesorería y Logística.' using errcode = 'insufficient_privilege';
  end if;
  return query
    with facturada as (select * from public.compras_facturadas(null, null))
    select c.id, c.numero, c.proveedor, c.referencia, c.moneda, public.total_orden_compra(c.id),
           exists (select 1 from public.orden_compra_material_detalles d
                    where d.orden_compra_id = c.id and d.precio_unitario is null),
           c.condicion_pago, o.numero, c.creado_en,
           exists (select 1 from public.adquisiciones_ordenes_compra l
                     join public.adquisiciones a on a.id = l.adquisicion_id
                    where l.orden_compra_id = c.id and a.estado = 'BORRADOR' and l.quitada_en is null),
           r.orden_id
      from public.ordenes_compra_materiales c
      left join public.requerimientos_materiales r on r.id = c.requerimiento_id
      left join public.ordenes_trabajo o on o.id = r.orden_id
      left join facturada f on f.orden_compra_id = c.id
     where c.con_factura and c.aprobacion in ('NO_REQUERIDA', 'APROBADA')
       and (f.orden_compra_id is null
            or (not f.completa and (f.total is null or f.facturado < f.total - 1)))
     order by c.creado_en desc
     limit 200;
end;
$$;
revoke all on function public.compras_sin_factura() from public, anon;
grant execute on function public.compras_sin_factura() to authenticated;

-- 4. El detector compara con lo que falta facturar de cada OC -----------------------------------
-- Las mismas columnas de la 20261016602000. `total_oc` es lo que faltaba
-- facturar de sus OC sin contar esta factura (su total, si es la primera);
-- `diferencia`, el total de la factura menos eso. Cada OC de `ordenes` dice
-- además si esta factura la cubre en parte y en qué otras facturas está.
create or replace function public.adquisiciones_control(p_ids uuid[])
returns table (adquisicion_id uuid, ordenes jsonb, total_oc numeric, diferencia numeric, control text)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not (public.es_admin() or public.tiene_permiso('adquisiciones.ver')) then
    raise exception 'Adquisiciones la ven Contabilidad, Tesorería y Logística.' using errcode = 'insufficient_privilege';
  end if;
  return query
    with oc as (
      select l.adquisicion_id as adq, l.parcial, c.id, c.numero, c.referencia, c.moneda, c.con_factura,
             public.total_orden_compra(c.id) as total,
             exists (select 1 from public.orden_compra_material_detalles d
                      where d.orden_compra_id = c.id and d.precio_unitario is null) as sin_precio,
             o.numero as numero_ot,
             coalesce(f.facturado, 0) as facturado_otras, f.facturas as otras
        from public.adquisiciones_ordenes_compra l
        join public.ordenes_compra_materiales c on c.id = l.orden_compra_id
        left join public.requerimientos_materiales r on r.id = c.requerimiento_id
        left join public.ordenes_trabajo o on o.id = r.orden_id
        left join lateral public.compras_facturadas(array[c.id], l.adquisicion_id) f on true
       where l.adquisicion_id = any (p_ids) and l.quitada_en is null
    ), cuenta as (
      select a.id, a.total as total_factura, a.moneda,
             coalesce(jsonb_agg(jsonb_build_object('id', oc.id, 'numero', oc.numero, 'referencia', oc.referencia,
                                                   'moneda', oc.moneda, 'total', oc.total, 'sin_precio', oc.sin_precio,
                                                   'con_factura', oc.con_factura, 'numero_ot', oc.numero_ot,
                                                   'parcial', oc.parcial, 'facturado_otras', oc.facturado_otras,
                                                   'otras_facturas', coalesce(oc.otras, '[]'::jsonb))
                                order by oc.numero) filter (where oc.id is not null), '[]'::jsonb) as ordenes,
             count(oc.id) as n,
             bool_or(oc.moneda <> a.moneda) as otra_moneda,
             bool_or(oc.sin_precio) as sin_precio,
             bool_or(oc.parcial) as parcial,
             sum(greatest(oc.total - oc.facturado_otras, 0)) as pendiente
        from public.adquisiciones a
        left join oc on oc.adq = a.id
       where a.id = any (p_ids)
       group by a.id
    )
    select k.id, k.ordenes,
           case when k.n = 0 or k.sin_precio or k.otra_moneda then null else k.pendiente::numeric(14, 2) end,
           case when k.n = 0 or k.sin_precio or k.otra_moneda then null else (k.total_factura - k.pendiente)::numeric(14, 2) end,
           case when k.n = 0 then 'SIN_OC'
                when k.otra_moneda then 'OTRA_MONEDA'
                when k.sin_precio then 'SIN_PRECIO'
                when k.parcial and k.total_factura <= k.pendiente + 1 and k.total_factura < k.pendiente - 1 then 'PARCIAL'
                when abs(k.total_factura - k.pendiente) <= 1 then 'CALZA'
                else 'NO_CALZA' end
      from cuenta k;
end;
$$;
revoke all on function public.adquisiciones_control(uuid[]) from public, anon;
grant execute on function public.adquisiciones_control(uuid[]) to authenticated;

-- 5. La OC que ya tiene su factura completa no entra en otra -------------------------------------
-- La misma función de la 20261015122000, con una regla más al final: lo que
-- antes solo frenaba la pantalla, ahora lo frena la base.
create or replace function public.fn_adquisicion_oc_valida()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_adq   public.adquisiciones%rowtype;
  v_oc    public.ordenes_compra_materiales%rowtype;
  v_base  public.ordenes_compra_materiales%rowtype;
  v_otra  text;
begin
  select * into v_adq from public.adquisiciones where id = new.adquisicion_id;
  if not found or (v_adq.estado <> 'BORRADOR' and current_setting('metalwork.corrigiendo', true) is distinct from 'factura') then
    raise exception 'Las OC de una factura se eligen al registrarla; registrada, ya no cambian sin una corrección con su justificante.' using errcode = 'check_violation';
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
  select a.numero_documento into v_otra
    from public.adquisiciones_ordenes_compra l join public.adquisiciones a on a.id = l.adquisicion_id
   where l.orden_compra_id = new.orden_compra_id and l.adquisicion_id <> new.adquisicion_id
     and l.quitada_en is null and not l.parcial and a.estado = 'REGISTRADA'
   limit 1;
  if v_otra is not null then
    raise exception 'La orden de compra % ya tiene su factura completa (%): si esta es otra parte, corrige aquella y márcala como parcial.',
      coalesce(v_oc.numero, v_oc.referencia), v_otra using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_adquisicion_oc_valida() from public, anon, authenticated;

-- 6. Corregir la factura: también qué OC cubre solo en parte ---------------------------------------
-- La misma función de la 20261016602000, con `parciales` en p_cambios (las OC de
-- la factura que cubre en parte; las demás las completa). Una OC nueva entra si
-- ninguna otra factura registrada la completa.
-- p_cambios: {proveedor?, numero_documento?, fecha_emision?, fecha_vencimiento?, moneda?, total?,
--             condicion_pago?, observacion?, ordenes?: [uuid…] (todas las de la factura),
--             parciales?: [uuid…], pdf_ruta?, lectura?: {fuente, total, moneda, numero, ordenes}}
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
  select coalesce(sum(monto), 0) into v_pagado from public.pagos_adquisicion where adquisicion_id = p_id and anulado_en is null;
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
  perform public.registrar_correccion(p_correccion, 'FACTURA_COMPRA', p_id, v_nueva.numero_documento, p_motivo, p_justificante,
                                      p_nombre, v_antes, v_despues);
  return p_id;
end $$;
revoke all on function public.corregir_factura_compra(uuid, uuid, text, text, text, jsonb) from public, anon;
grant execute on function public.corregir_factura_compra(uuid, uuid, text, text, text, jsonb) to authenticated;
