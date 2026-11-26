-- =============================================================================
-- LO FACTURADO DE CADA COTIZACIÓN, EN CADA MONEDA
-- -----------------------------------------------------------------------------
-- Contabilidad puede facturar en soles una cotización en dólares (o al revés):
-- `registrar_factura_venta` deja elegir la moneda. Pero `cotizaciones_para_facturar`
-- sumaba en una sola cifra el total de todas sus facturas y de todos sus cobros,
-- fuera cual fuera su moneda. La pestaña «Factura y cobro» del código decía
-- «Facturado US$ 30,500.00» con US$ 29,500 y S/ 1,000 dentro, y Tesorería, al
-- revisar la salida de un vehículo, veía ese cobro mezclado contra el total de
-- la cotización.
--
-- Ahora `facturado` y `cobrado` son solo lo de la moneda de la cotización, que es
-- con lo que se comparan, y lo de la otra moneda va aparte
-- (`facturado_otra_moneda`, `cobrado_otra_moneda`) para que la pantalla lo diga
-- sin sumarlo. Es la misma regla de `facturacion_pendientes` (20261126470000):
-- una factura en otra moneda no se compara con el total.
--
-- Cambian las columnas que devuelve, así que la función se suelta y se vuelve a
-- crear, con el mismo permiso y el mismo tope. Antes de soltarla se mira la
-- huella de su cuerpo: la de 20261015124000 con el mensaje que le puso la
-- 20261023140000 (la que tiene producción), o la de esta misma migración si se
-- vuelve a correr. Si alguien la cambió a mano, no se pisa. Solo lee. Idempotente.
-- =============================================================================

do $$
declare
  v_md5 text;
begin
  select md5(replace(p.prosrc, E'\r', ''))
    into v_md5
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'cotizaciones_para_facturar';
  -- La de 20261015124000 tras la 20261023140000, o esta misma si la migración se vuelve a correr.
  if v_md5 is not null and v_md5 not in ('369b4c9cb91462e94afb2bb6c45d09ef', '6437a72aa497bf382ccf4106aacf2349') then
    raise exception 'cotizaciones_para_facturar cambió en la base (huella %): revisa antes de reemplazarla.', v_md5;
  end if;
end $$;

drop function if exists public.cotizaciones_para_facturar();

create function public.cotizaciones_para_facturar()
returns table (
  cotizacion_id uuid, numero text, codigo_interno text, cliente_id uuid, cliente text, cliente_documento text,
  cliente_direccion text, carroceria text, moneda text, monto_venta numeric, incluye_igv boolean,
  en_correccion boolean, aprobada_en timestamptz, archivo_ruta text, archivo_mime text, archivo_nombre text,
  facturas integer, facturado numeric, cobrado numeric,
  facturado_otra_moneda numeric, cobrado_otra_moneda numeric
) language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not (public.es_admin() or public.tiene_permiso('contabilidad.facturar') or public.tiene_permiso('cotizaciones.ver_aprobadas')) then
    raise exception 'No tienes permiso para ver las cotizaciones aprobadas.' using errcode = 'insufficient_privilege';
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
           coalesce(fx.facturas, 0), coalesce(fx.facturado, 0), coalesce(fx.cobrado, 0),
           coalesce(fx.facturado_otra, 0), coalesce(fx.cobrado_otra, 0)
      from public.cotizaciones_pdf c
      left join public.clientes cl on cl.id = c.cliente_id
      left join public.tipos_carroceria tc on tc.id = c.tipo_carroceria_id
      left join public.cotizaciones_pdf_igv ig on ig.cotizacion_id = c.id
      left join lateral (
        select v.ruta_storage, v.mime_type, v.nombre_archivo from public.cotizaciones_pdf_versiones v
         where v.cotizacion_id = c.id and v.estado_al_archivar = 'APROBADA'
         order by v.version desc limit 1) va on true
      left join lateral (
        select count(*)::integer as facturas,
               sum(f.total) filter (where f.moneda::text = c.moneda::text)::numeric as facturado,
               sum(f.cobrado) filter (where f.moneda::text = c.moneda::text)::numeric as cobrado,
               sum(f.total) filter (where f.moneda::text <> c.moneda::text)::numeric as facturado_otra,
               sum(f.cobrado) filter (where f.moneda::text <> c.moneda::text)::numeric as cobrado_otra
          from (select f.moneda, f.total,
                       (select coalesce(sum(b.monto), 0) from public.cobros_factura_venta b
                         where b.factura_id = f.id and b.anulado_en is null) as cobrado
                  from public.facturas_venta f
                 where f.cotizacion_pdf_id = c.id and f.anulada_en is null) f) fx on true
     where c.estado::text <> 'ANULADA' and public.cotizacion_fue_aprobada(c.id)
     order by c.revisado_en desc nulls last
     limit 300;
end;
$$;

comment on function public.cotizaciones_para_facturar() is
  'Las cotizaciones aprobadas con su código interno, su cliente y su archivo, y lo facturado y cobrado sin las anuladas: `facturado` y `cobrado` en la moneda de la cotización, y lo de la otra moneda aparte, sin sumarlo (20261126960000). Las 300 más nuevas. La leen Contabilidad, Tesorería, Gerencia y Administración.';

revoke all on function public.cotizaciones_para_facturar() from public, anon;
grant execute on function public.cotizaciones_para_facturar() to authenticated;
