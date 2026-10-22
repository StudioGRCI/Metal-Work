-- =============================================================================
-- LA FACTURA SE LIGA POR EL RUC
-- -----------------------------------------------------------------------------
-- DKS lo decidió el 22/10, a la pregunta «¿cómo sabe el sistema que la factura es
-- del proveedor de la OC?»: «Por el RUC. Contabilidad anota el RUC al registrar
-- la factura, y se liga solo a las OC de ese mismo RUC».
--
-- Hasta hoy la factura y la OC se reconocían por el nombre del proveedor,
-- escrito a mano en cada una («S.A.C.» o «SAC», con tilde o sin ella): dos
-- empresas de nombre parecido se confundían, y la misma empresa escrita de dos
-- formas no se encontraba. Desde aquí la factura de compra guarda el RUC de quien
-- la emitió, y cuando la factura y la OC tienen RUC, es el RUC el que manda:
-- - la factura se liga solo a las OC de su RUC, y la que no calza se rechaza
--   diciendo los dos RUC;
-- - el anexo que Logística subió, la factura repetida, lo pagado de más por la
--   boleta y lo que una factura toma de ese pago se buscan por el RUC.
-- El nombre sigue valiendo solo donde falta el RUC de alguna de las dos: la
-- factura registrada antes de hoy, o la OC de un proveedor que no está en el
-- padrón.
--
-- El RUC lo anota Contabilidad; si la factura va a una OC cuyo proveedor está en
-- el padrón, la base lo pone sola desde ahí, y Contabilidad lo corrige si la
-- factura dice otro. La factura de compra no se registra sin él. Las que ya
-- estaban registradas se quedan como están.
--
-- Idempotente. Sin `drop` de funciones ni de políticas: el conector de
-- producción no los deja pasar.
-- =============================================================================

-- 1. El RUC de la factura ----------------------------------------------------------------
alter table public.adquisiciones add column if not exists ruc_proveedor text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'adquisiciones_ruc_proveedor_valido') then
    alter table public.adquisiciones add constraint adquisiciones_ruc_proveedor_valido
      check (ruc_proveedor is null or public.ruc_es_valido(ruc_proveedor));
  end if;
end $$;
comment on column public.adquisiciones.ruc_proveedor is
  'RUC de quien emitió el comprobante (migración 20261022170000). Con él la factura se liga solo a las OC de ese proveedor; sin él, se compara el nombre.';

-- 2. El RUC de una OC: el de su proveedor en el padrón ---------------------------------
-- Null si la OC no tiene proveedor del padrón o si su documento no es un RUC.
create or replace function public.ruc_de_la_compra(p_compra uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select btrim(p.numero_documento)
    from public.ordenes_compra_materiales c
    join public.proveedores p on p.id = c.proveedor_id
   where c.id = p_compra and public.ruc_es_valido(btrim(p.numero_documento));
$$;
revoke all on function public.ruc_de_la_compra(uuid) from public, anon, authenticated;

-- 3. ¿El mismo proveedor? Por el RUC si los dos lo tienen; si no, por el nombre ----------
create or replace function public.mismo_emisor(p_ruc_uno text, p_nombre_uno text, p_ruc_otro text, p_nombre_otro text)
returns boolean
language sql
immutable
parallel safe
set search_path to 'public'
as $$
  select case when nullif(btrim(p_ruc_uno), '') is not null and nullif(btrim(p_ruc_otro), '') is not null
              then btrim(p_ruc_uno) = btrim(p_ruc_otro)
              else public.mismo_proveedor(p_nombre_uno, p_nombre_otro) end;
$$;
revoke all on function public.mismo_emisor(text, text, text, text) from public, anon;
grant execute on function public.mismo_emisor(text, text, text, text) to authenticated;

-- 4. Contabilidad anota el RUC; si va a una OC del padrón, la base lo pone ------------
-- Corre antes que `adquisicion_factura_unica` (el orden es alfabético), que
-- busca la factura repetida y el anexo de Logística ya con el RUC puesto.
create or replace function public.fn_adquisicion_anota_ruc()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_oc   uuid;
  v_otra text;
begin
  new.ruc_proveedor := nullif(regexp_replace(coalesce(new.ruc_proveedor, ''), '[^0-9]', '', 'g'), '');
  if new.ruc_proveedor is null and new.tipo = 'FACTURA_COMPRA' then
    v_oc := coalesce(new.orden_compra_id,
                     (select d.orden_compra_id from public.documentos_compra_material d where d.id = new.documento_compra_id));
    if v_oc is not null then
      new.ruc_proveedor := public.ruc_de_la_compra(v_oc);
    elsif tg_op = 'UPDATE' then
      -- Sin OC principal, el de las OC que ya tiene ligadas, si todas son del mismo RUC.
      select min(r.ruc) into new.ruc_proveedor
        from (select public.ruc_de_la_compra(l.orden_compra_id) as ruc
                from public.adquisiciones_ordenes_compra l
               where l.adquisicion_id = new.id and l.quitada_en is null) r
      having count(distinct r.ruc) = 1 and count(*) = count(r.ruc);
    end if;
  end if;
  if new.ruc_proveedor is not null and not public.ruc_es_valido(new.ruc_proveedor) then
    raise exception 'El RUC % no es válido: son 11 dígitos y el último es de control. Cópialo tal como sale en la factura.', new.ruc_proveedor
      using errcode = 'check_violation';
  end if;
  if new.tipo = 'FACTURA_COMPRA' and new.estado = 'REGISTRADA' and new.ruc_proveedor is null
     and (tg_op = 'INSERT' or old.estado is distinct from 'REGISTRADA' or old.ruc_proveedor is not null) then
    raise exception 'Anota el RUC del proveedor que emitió la factura %: con él se liga solo a las OC de ese proveedor.', new.numero_documento
      using errcode = 'check_violation';
  end if;
  -- La OC principal, y las que ya tiene ligadas si le cambian el RUC.
  if new.ruc_proveedor is not null and new.orden_compra_id is not null
     and (tg_op = 'INSERT' or new.orden_compra_id is distinct from old.orden_compra_id
          or new.ruc_proveedor is distinct from old.ruc_proveedor)
     and public.ruc_de_la_compra(new.orden_compra_id) <> new.ruc_proveedor then
    select coalesce(c.numero, 'OC ' || c.referencia) || ' es de ' || c.proveedor || ' (RUC ' || public.ruc_de_la_compra(c.id) || ')'
      into v_otra from public.ordenes_compra_materiales c where c.id = new.orden_compra_id;
    raise exception 'La factura es del RUC % y la %: una factura se liga solo a las OC de su proveedor.', new.ruc_proveedor, v_otra
      using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and new.ruc_proveedor is not null and new.ruc_proveedor is distinct from old.ruc_proveedor then
    select coalesce(c.numero, 'OC ' || c.referencia) || ' es de ' || c.proveedor || ' (RUC ' || public.ruc_de_la_compra(c.id) || ')'
      into v_otra
      from public.adquisiciones_ordenes_compra l
      join public.ordenes_compra_materiales c on c.id = l.orden_compra_id
     where l.adquisicion_id = new.id and l.quitada_en is null
       and public.ruc_de_la_compra(c.id) <> new.ruc_proveedor
     order by c.numero
     limit 1;
    if v_otra is not null then
      raise exception 'La factura queda con el RUC % y la %: una factura se liga solo a las OC de su proveedor.', new.ruc_proveedor, v_otra
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.fn_adquisicion_anota_ruc() from public, anon, authenticated;
create or replace trigger adquisicion_anota_ruc
  before insert or update on public.adquisiciones
  for each row execute function public.fn_adquisicion_anota_ruc();

-- 5. Las funciones que reconocían al proveedor por el nombre ---------------------------
-- Copia fiel de su versión vigente, con `mismo_emisor` donde comparaban el nombre.

CREATE OR REPLACE FUNCTION public.anexos_de_la_factura(p_factura adquisiciones)
 RETURNS TABLE(documento_id uuid, orden_compra_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
     and public.mismo_emisor(public.ruc_de_la_compra(c.id), c.proveedor, p_factura.ruc_proveedor, p_factura.proveedor);
$function$;

CREATE OR REPLACE FUNCTION public.factura_del_anexo(p_documento uuid)
 RETURNS TABLE(adquisicion_id uuid, estado text, cubre_su_oc boolean, numero text, bucket text, ruta text, pagado numeric, saldo numeric, moneda text, alcanza boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER ROWS 1
 SET search_path TO 'public'
AS $function$
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
             and public.mismo_emisor(x.ruc_proveedor, x.proveedor, public.ruc_de_la_compra(c.id), c.proveedor)
             and x.tipo <> 'OTRO'
        ) m
        join public.adquisiciones a on a.id = m.id
        left join public.documentos_compra_material e on e.id = a.documento_compra_id
       where d.id = p_documento and d.tipo = 'FACTURA' and d.anulado_en is null
       order by a.estado = 'REGISTRADA' desc, cubre desc, a.creado_en
       limit 1
    ) f;
end;
$function$;

CREATE OR REPLACE FUNCTION public.facturas_para_descontar(p_compra uuid)
 RETURNS TABLE(id uuid, numero text, moneda text, fecha_emision date, total numeric, saldo numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
begin
  if not (public.es_admin() or public.tiene_permiso('tesoreria.registrar_pagos')) then
    raise exception 'Lo pagado de más lo descuenta Tesorería.' using errcode = 'insufficient_privilege';
  end if;
  return query
  select a.id, a.numero_documento, a.moneda, a.fecha_emision, a.total,
         (a.total - coalesce((select sum(x.monto) from public.pagos_adquisicion x
                               where x.adquisicion_id = a.id and x.anulado_en is null), 0))::numeric(14, 2)
    from public.ordenes_compra_materiales c
    join public.adquisiciones a on a.estado = 'REGISTRADA' and a.tipo <> 'OTRO'
                               and public.mismo_emisor(a.ruc_proveedor, a.proveedor, public.ruc_de_la_compra(c.id), c.proveedor)
   where c.id = p_compra and not c.con_factura
     and not exists (select 1 from public.facturas_de_la_compra(p_compra) f where f.adquisicion_id = a.id)
     and a.total - coalesce((select sum(x.monto) from public.pagos_adquisicion x
                              where x.adquisicion_id = a.id and x.anulado_en is null), 0) > 0
   order by a.fecha_emision desc, a.creado_en desc
   limit 30;
end;
$function$;

CREATE OR REPLACE FUNCTION public.situacion_de_facturas_anexadas(p_documentos uuid[])
 RETURNS TABLE(documento uuid, registrada boolean, mismo_numero text, factura_de_la_oc text, pagada_directo boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
           where d.id = x.id and not coalesce(public.mismo_emisor(a.ruc_proveedor, a.proveedor, public.ruc_de_la_compra(c.id), c.proveedor), false)
           order by a.creado_en limit 1),
         (select a.numero_documento
            from public.documentos_compra_material d
            join public.ordenes_compra_materiales c on c.id = d.orden_compra_id and not c.con_factura
            join public.adquisiciones_ordenes_compra l on l.orden_compra_id = c.id and l.quitada_en is null and not l.parcial
            join public.adquisiciones a on a.id = l.adquisicion_id and a.estado = 'REGISTRADA' and a.tipo <> 'OTRO'
           where d.id = x.id and a.documento_compra_id is distinct from d.id
           order by a.creado_en limit 1),
         -- Lo neto: si el proveedor devolvió todo, la factura no tiene nada que tomar.
         coalesce((select sum(p.monto)
                     from public.documentos_compra_material d
                     join public.ordenes_compra_materiales c on c.id = d.orden_compra_id and not c.con_factura
                     join public.pagos_orden_compra p on p.orden_compra_id = c.id and p.anulado_en is null
                    where d.id = x.id), 0)
         - coalesce((select sum(v.monto)
                       from public.documentos_compra_material d
                       join public.ordenes_compra_materiales c on c.id = d.orden_compra_id and not c.con_factura
                       join public.devoluciones_orden_compra v on v.orden_compra_id = c.id and v.anulado_en is null
                      where d.id = x.id), 0) > 0
    from unnest(p_documentos) as x(id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.tomar_pago_de_la_boleta(p_id uuid, p_compra uuid, p_factura uuid, p_monto_boleta numeric, p_monto_factura numeric, p_ruta text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cierre  uuid[];
  v_oc      public.ordenes_compra_materiales%rowtype;
  v_adq     public.adquisiciones%rowtype;
  v_nombre  text;
  v_pd      record;
  v_suya    boolean;
  v_saldo   numeric;
  v_cambio  numeric;
  v_resto   numeric;
  v_resto_f numeric;
  v_parte   numeric;
  v_monto   numeric;
  v_p       record;
  v_pago    public.pagos_orden_compra%rowtype;
  v_ref     text;
  v_id      uuid;
  v_primera boolean := true;
  v_s_oc    text;
  v_s_f     text;
  v_obj     storage.objects%rowtype;
begin
  perform public.exigir_permiso('tesoreria.registrar_pagos');
  if p_id is null then raise exception 'Vuelve a abrir la ventana.' using errcode = 'check_violation'; end if;
  if exists (select 1 from public.pagos_adquisicion where id = p_id) then return p_id; end if;
  v_cierre := public.bloquear_cierre(array[p_compra], p_factura);
  if exists (select 1 from public.pagos_adquisicion where id = p_id) then return p_id; end if;
  select * into v_oc from public.ordenes_compra_materiales where id = p_compra;
  if not found or v_oc.con_factura then
    raise exception 'Esa OC con boleta no existe.' using errcode = 'check_violation';
  end if;
  v_nombre := coalesce(v_oc.numero, 'OC ' || v_oc.referencia);
  select * into v_adq from public.adquisiciones where id = p_factura;
  if not found or v_adq.estado <> 'REGISTRADA' or v_adq.tipo = 'OTRO' then
    raise exception 'Elige una factura registrada.' using errcode = 'check_violation';
  end if;
  v_s_oc := case when v_oc.moneda = 'USD' then 'US$ ' else 'S/ ' end;
  v_s_f := case when v_adq.moneda = 'USD' then 'US$ ' else 'S/ ' end;
  if p_monto_boleta is null or p_monto_factura is null or p_monto_boleta <= 0 or p_monto_factura <= 0
     or p_monto_boleta > 999999999 or p_monto_factura > 999999999
     or p_monto_boleta <> round(p_monto_boleta, 2) or p_monto_factura <> round(p_monto_factura, 2) then
    raise exception 'Escribe los dos montos, en dos decimales.' using errcode = 'check_violation';
  end if;
  select * into v_pd from public.pago_directo_de_la_compra(p_compra);
  v_suya := exists (select 1 from public.facturas_de_la_compra(p_compra) f where f.adquisicion_id = p_factura);
  if v_suya then
    if v_adq.moneda = v_oc.moneda then
      raise exception 'La factura % va en la misma moneda que la %: toma lo pagado por la boleta sola.', v_adq.numero_documento, v_nombre
        using errcode = 'check_violation';
    end if;
    if p_monto_boleta > coalesce(v_pd.sin_tomar, 0) then
      raise exception 'Quedan % de lo pagado por la boleta sin pasar a ninguna factura: no toma más.',
        v_s_oc || to_char(coalesce(v_pd.sin_tomar, 0), 'FM999G999G990D00') using errcode = 'check_violation';
    end if;
  else
    if not coalesce(public.mismo_emisor(v_adq.ruc_proveedor, v_adq.proveedor, public.ruc_de_la_compra(v_oc.id), v_oc.proveedor), false) then
      raise exception 'La factura % es de otro proveedor.', v_adq.numero_documento using errcode = 'check_violation';
    end if;
    if coalesce(v_pd.de_mas, 0) <= 0 then
      raise exception 'La % no tiene nada pagado de más que descontar.', v_nombre using errcode = 'check_violation';
    end if;
    if p_monto_boleta > v_pd.de_mas then
      raise exception 'Lo pagado de más de la % es %: no se descuenta más.', v_nombre,
        v_s_oc || to_char(v_pd.de_mas, 'FM999G999G990D00') using errcode = 'check_violation';
    end if;
    if p_ruta is null then
      raise exception 'Adjunta la nota de crédito o el documento donde el proveedor descontó lo pagado de más.' using errcode = 'check_violation';
    end if;
  end if;
  -- El documento del descuento (o el que acompañe a la toma al cambio): subido por quien registra, en la carpeta de la factura.
  if p_ruta is not null then
    if exists (select 1 from public.pagos_adquisicion where archivo_ruta = p_ruta) then
      raise exception 'Ese archivo ya es el de otro pago: adjunta el documento del descuento.' using errcode = 'check_violation';
    end if;
    v_obj := public.archivo_subido_por_mi('pagos-facturas', p_ruta, p_factura,
                                          array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
  end if;
  v_saldo := v_adq.total - coalesce((select sum(x.monto) from public.pagos_adquisicion x
                                      where x.adquisicion_id = p_factura and x.anulado_en is null), 0);
  if p_monto_factura > v_saldo then
    raise exception 'La factura % debe %: no toma más.', v_adq.numero_documento,
      v_s_f || to_char(greatest(v_saldo, 0), 'FM999G999G990D00') using errcode = 'check_violation';
  end if;
  if v_adq.moneda = v_oc.moneda then
    if p_monto_factura <> p_monto_boleta then
      raise exception 'En la misma moneda, lo que toma la factura es lo mismo que sale de la boleta.' using errcode = 'check_violation';
    end if;
  else
    v_cambio := case when v_oc.moneda = 'PEN' then p_monto_boleta / p_monto_factura else p_monto_factura / p_monto_boleta end;
    if v_cambio not between 2 and 6 then
      raise exception 'Con esos montos el dólar sale a S/ %: revisa los dos montos.', round(v_cambio, 3) using errcode = 'check_violation';
    end if;
  end if;

  -- Del último pago hacia atrás, de lo que ninguna factura tomó.
  v_resto := p_monto_boleta;
  v_resto_f := p_monto_factura;
  for v_p in select l.pago_id, greatest(l.para_repartir - l.tomado_solo, 0) as libre
               from public.libre_de_los_pagos_de_compra(p_compra) l
              order by l.orden desc loop
    exit when v_resto <= 0;
    continue when v_p.libre <= 0;
    v_parte := least(v_p.libre, v_resto);
    v_resto := v_resto - v_parte;
    v_monto := case when v_resto <= 0 then v_resto_f else round(p_monto_factura * v_parte / p_monto_boleta, 2) end;
    if v_monto <= 0 then
      raise exception 'Con esos montos no se puede repartir lo que toma la factura entre los pagos de la boleta: revisa los dos montos.'
        using errcode = 'check_violation';
    end if;
    v_resto_f := v_resto_f - v_monto;
    select * into v_pago from public.pagos_orden_compra where id = v_p.pago_id;
    v_id := case when v_primera then p_id else gen_random_uuid() end;
    v_ref := left(case when v_suya then 'Tomado al cambio del pago por la boleta de la '
                       else 'Descontado de lo pagado de más por la boleta de la ' end
                  || v_nombre || ' del ' || to_char(v_pago.fecha_pago, 'DD/MM/YYYY')
                  || coalesce(' · op. ' || btrim(v_pago.operacion), ''), 108);
    -- Otra toma del mismo pago en la misma factura: el sufijo es el de esta fila, que no se repite.
    if exists (select 1 from public.pagos_adquisicion x
                where x.adquisicion_id = p_factura and x.anulado_en is null and x.referencia = v_ref) then
      v_ref := v_ref || ' · ' || left(v_id::text, 8);
    end if;
    perform set_config('metalwork.aplica_pago_directo', v_pago.id::text, true);
    insert into public.pagos_adquisicion (id, adquisicion_id, fecha, monto, referencia, registrado_por,
                                          pago_orden_compra_id, monto_de_la_boleta, archivo_ruta, archivo_mime, archivo_tamano)
    values (v_id, p_factura, v_pago.fecha_pago, v_monto, v_ref,
            public.usuario_actual(), v_pago.id, v_parte,
            case when v_primera then p_ruta end,
            case when v_primera and p_ruta is not null then v_obj.metadata->>'mimetype' end,
            case when v_primera and p_ruta is not null then (v_obj.metadata->>'size')::integer end);
    v_primera := false;
  end loop;
  perform set_config('metalwork.aplica_pago_directo', '', true);
  if v_resto > 0 then
    raise exception 'Quedan % de lo pagado por la boleta sin pasar a ninguna factura: no toma más.',
      v_s_oc || to_char(p_monto_boleta - v_resto, 'FM999G999G990D00') using errcode = 'check_violation';
  end if;

  perform set_config('metalwork.conciliacion_por', 'Tesorería pasó lo pagado por la boleta a la factura ' || v_adq.numero_documento, true);
  perform public.conciliar_pago_directo(v_cierre);
  perform set_config('metalwork.conciliacion_por', '', true);
  return p_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_adquisicion_factura_unica()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
          or new.tipo is distinct from old.tipo
          or new.ruc_proveedor is distinct from old.ruc_proveedor) then
    perform pg_advisory_xact_lock(hashtextextended('adquisicion|' || v_numero || '|' || v_proveedor, 0));
    -- La misma factura escrita con otro nombre se reconoce por el RUC: también se espera a esa.
    if new.ruc_proveedor is not null then
      perform pg_advisory_xact_lock(hashtextextended('adquisicion|' || v_numero || '|ruc|' || new.ruc_proveedor, 0));
    end if;
    select a.estado, a.numero_documento, a.proveedor, a.registrado_por = public.usuario_actual() as mia,
           new.ruc_proveedor is not null and a.ruc_proveedor is not null as por_ruc,
           to_char((a.creado_en at time zone 'America/Lima')::date, 'DD/MM/YYYY') as dia,
           nullif(btrim(coalesce(u.nombres, '') || ' ' || coalesce(u.apellidos, '')), '') as autor into v_otra
      from public.adquisiciones a
      left join public.usuarios u on u.id = a.registrado_por
     where public.clave_numero_comprobante(a.numero_documento) = v_numero
       and (case when new.ruc_proveedor is not null and a.ruc_proveedor is not null
                 then a.ruc_proveedor = new.ruc_proveedor
                 else public.clave_proveedor(a.proveedor) = v_proveedor and public.mismo_proveedor(a.proveedor, new.proveedor) end)
       and a.tipo <> 'OTRO'
       and a.id is distinct from new.id
     order by a.estado = 'REGISTRADA' desc, a.creado_en
     limit 1;
    if found and v_otra.estado = 'BORRADOR' and coalesce(v_otra.mia, false) then
      raise exception 'Ya tienes en borrador el comprobante % de % desde el %: complétalo en vez de darlo de alta otra vez.',
        v_otra.numero_documento, v_otra.proveedor, v_otra.dia using errcode = 'unique_violation';
    elsif found and v_otra.por_ruc and v_otra.estado = 'BORRADOR' then
      raise exception 'El comprobante % del RUC % (%) está en borrador de % desde el %: que lo complete en vez de darlo de alta otra vez.',
        v_otra.numero_documento, new.ruc_proveedor, v_otra.proveedor, coalesce(v_otra.autor, 'otra persona'), v_otra.dia
        using errcode = 'unique_violation';
    elsif found and v_otra.por_ruc then
      raise exception 'El comprobante % del RUC % (%) ya está registrado en Adquisiciones desde el %.',
        v_otra.numero_documento, new.ruc_proveedor, v_otra.proveedor, v_otra.dia using errcode = 'unique_violation';
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
       and public.mismo_emisor(public.ruc_de_la_compra(c.id), c.proveedor, new.ruc_proveedor, new.proveedor)
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
         and public.mismo_emisor(public.ruc_de_la_compra(c.id), c.proveedor, new.ruc_proveedor, new.proveedor)
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
$function$;

CREATE OR REPLACE FUNCTION public.fn_adquisicion_oc_valida()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- Tomada, para no cruzarse con su anulación.
  select * into v_oc from public.ordenes_compra_materiales where id = new.orden_compra_id for key share;
  if not found then raise exception 'Esa orden de compra no existe.' using errcode = 'check_violation'; end if;
  if v_oc.aprobacion = 'RECHAZADA' then
    raise exception 'La orden de compra % está rechazada: no se factura.', coalesce(v_oc.numero, v_oc.referencia) using errcode = 'check_violation';
  end if;
  if v_oc.aprobacion = 'ANULADA' then
    raise exception 'La orden de compra % está anulada: no se factura.', coalesce(v_oc.numero, v_oc.referencia) using errcode = 'check_violation';
  end if;
  if v_oc.condicion_pago <> v_adq.condicion_pago then
    raise exception 'La orden de compra % es al %: la factura tiene que ir igual.', coalesce(v_oc.numero, v_oc.referencia),
      case when v_oc.condicion_pago = 'CREDITO' then 'crédito' else 'contado' end using errcode = 'check_violation';
  end if;
  -- Por el RUC (migración 20261022170000): la factura se liga solo a las OC de su proveedor.
  if v_adq.ruc_proveedor is not null and public.ruc_de_la_compra(v_oc.id) is not null
     and public.ruc_de_la_compra(v_oc.id) <> v_adq.ruc_proveedor then
    raise exception 'La factura es del RUC % y la orden de compra % es de % (RUC %): una factura se liga solo a las OC de su proveedor.',
      v_adq.ruc_proveedor, coalesce(v_oc.numero, v_oc.referencia), v_oc.proveedor, public.ruc_de_la_compra(v_oc.id)
      using errcode = 'check_violation';
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
$function$;

CREATE OR REPLACE FUNCTION public.corregir_factura_compra(p_correccion uuid, p_id uuid, p_motivo text, p_justificante text, p_nombre text, p_cambios jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_a_mano    text;
  v_quitada   text;
  v_otra_oc   text;
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
  -- Lo que Tesorería le pagó y lo que le pasó a mano de una boleta: lo que tomó
  -- sola de la boleta no cuenta, se rehace al final.
  select coalesce(sum(monto), 0) into v_pagado from public.pagos_adquisicion
   where adquisicion_id = p_id and anulado_en is null and (pago_orden_compra_id is null or monto_de_la_boleta is not null);
  select coalesce(c.numero, 'OC ' || c.referencia) into v_a_mano
    from public.pagos_adquisicion x
    join public.pagos_orden_compra p on p.id = x.pago_orden_compra_id
    join public.ordenes_compra_materiales c on c.id = p.orden_compra_id
   where x.adquisicion_id = p_id and x.anulado_en is null and x.monto_de_la_boleta is not null
   order by x.creado_en
   limit 1;
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
    v_nueva.ruc_proveedor := case when p_cambios ? 'ruc_proveedor' then nullif(btrim(p_cambios->>'ruc_proveedor'), '')
                                  else v_adq.ruc_proveedor end;
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
    raise exception 'Tesorería ya pagó % de esta factura: el total no puede quedar por debajo%.', v_pagado,
      case when v_a_mano is not null
           then ' (con lo que tomó a mano de la boleta de la ' || v_a_mano || ': si el cambio estaba mal, Tesorería la deshace primero)'
           else '' end using errcode = 'check_violation';
  end if;
  if v_nueva.moneda is distinct from v_adq.moneda and v_pagado > 0 then
    if v_a_mano is not null then
      raise exception 'La factura tomó a mano lo pagado por la boleta de la %: su moneda no cambia mientras tanto. Tesorería deshace primero esa toma («Deshacer», en «Facturas por pagar»).', v_a_mano
        using errcode = 'check_violation';
    end if;
    raise exception 'La factura ya tiene pagos: su moneda no cambia. Anula primero los pagos.' using errcode = 'check_violation';
  end if;
  -- La OC de cuyos pagos tomó a mano no se le quita: la toma seguiría sin ser de ella.
  select coalesce(c.numero, 'OC ' || c.referencia) into v_quitada
    from public.pagos_adquisicion x
    join public.pagos_orden_compra p on p.id = x.pago_orden_compra_id
    join public.ordenes_compra_materiales c on c.id = p.orden_compra_id
   where x.adquisicion_id = p_id and x.anulado_en is null and x.monto_de_la_boleta is not null
     and (c.id = any (v_actuales) or c.id is not distinct from v_adq.orden_compra_id)
     and not (c.id = any (v_ordenes))
   limit 1;
  if v_quitada is not null then
    raise exception 'La factura tomó a mano lo pagado por la boleta de la %: no se le quita esa OC mientras tanto. Tesorería deshace primero esa toma («Deshacer», en «Facturas por pagar»).', v_quitada
      using errcode = 'check_violation';
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
     set proveedor = v_nueva.proveedor, ruc_proveedor = v_nueva.ruc_proveedor, numero_documento = v_nueva.numero_documento,
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
  select coalesce(c.numero, 'OC ' || c.referencia) || ' (RUC ' || public.ruc_de_la_compra(c.id) || ')' into v_otra_oc
    from public.adquisiciones_ordenes_compra l join public.ordenes_compra_materiales c on c.id = l.orden_compra_id
   where l.adquisicion_id = p_id and l.quitada_en is null and v_nueva.ruc_proveedor is not null
     and public.ruc_de_la_compra(c.id) is distinct from null and public.ruc_de_la_compra(c.id) <> v_nueva.ruc_proveedor
   limit 1;
  if v_otra_oc is not null then
    raise exception 'La factura queda con el RUC % y la % es de otro: una factura se liga solo a las OC de su proveedor.',
      v_nueva.ruc_proveedor, v_otra_oc using errcode = 'check_violation';
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
end $function$;
