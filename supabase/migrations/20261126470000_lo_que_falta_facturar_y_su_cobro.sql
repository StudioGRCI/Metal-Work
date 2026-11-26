-- =============================================================================
-- LO QUE FALTA FACTURAR, DESDE CUÁNDO, Y SU COBRO
-- -----------------------------------------------------------------------------
-- Contabilidad abre Facturación y quiere saber, sin recorrer tarjeta por
-- tarjeta, qué tiene por facturar y desde cuándo lo tiene (Plan 10, entrega
-- 10.1). Por facturar es la cotización aprobada que ya tiene su OT con código
-- interno y no tiene factura vigente, o la tiene por una parte del total.
--
-- La espera se cuenta desde que la OT tiene código interno (DKS lo decidió en el
-- plan): antes de eso la factura no se puede registrar, porque cuelga del
-- código. Hoy el código nace con la OT —Administración los carga juntos—, pero la
-- unidad puede recibirlo después; por eso se mira también cuándo lo recibió la
-- unidad, en la bitácora. Los días los cuenta la base con la fecha de Lima.
--
-- El recorrido de la cotización llegaba hasta la factura. Ahora sigue hasta el
-- cobro, que es lo que cierra el circuito para Contabilidad y Tesorería:
--
--   FACTURA_RESTO  la cotización facturada en parte espera la factura de lo que
--                  falta (sin decir cuánto: el recorrido no lleva importes).
--   COBRO          Tesorería tiene por cobrar alguna factura vigente; hecho
--                  cuando todas quedaron cobradas.
--
-- El paso del cobro lo ve solo quien ya lee los cobros (la política
-- `ver_cobros_factura_venta`): Contabilidad, Tesorería, Administración y
-- Gerencia. Ventas ve la cotización y su factura, pero no si se cobró: para ella
-- el recorrido termina en la factura, como hasta hoy.
-- =============================================================================

-- =============================================================================
-- 1. DESDE CUÁNDO LA OT DE LA COTIZACIÓN TIENE CÓDIGO INTERNO
-- =============================================================================
-- La misma OT que da el código en `codigo_interno_de_cotizacion` (la vigente más
-- nueva cuya unidad tiene código): desde que existe esa OT y su unidad tiene
-- código, lo último de las dos. Cuándo lo recibió la unidad sale de la bitácora
-- (la primera vez que su fila lo trae); la unidad de antes de la bitácora lo
-- tiene desde que se creó. Ayudante interno: lo llaman las funciones de abajo,
-- que ya exigen su permiso.
create or replace function public.codigo_interno_de_cotizacion_desde(p_cotizacion uuid)
returns timestamptz
language sql
stable
security invoker
set search_path to 'public'
as $$
  select greatest(o.creado_en,
                  coalesce((select min(b.creado_en) from public.audit_log b
                             where b.tabla = 'unidades' and b.registro_id = u.id
                               and public.normalizar_codigo_interno(b.datos_despues ->> 'codigo_interno') is not null
                               -- La fila que lo trae nuevo: el alta, o el cambio que se lo puso. Si no,
                               -- la unidad cargada sin bitácora tomaría la fecha de cualquier cambio.
                               and (b.accion = 'INSERT'
                                    or public.normalizar_codigo_interno(b.datos_antes ->> 'codigo_interno') is null)),
                           u.creado_en))
    from public.ordenes_trabajo o
    join public.unidades u on u.id = o.unidad_id
   where o.cotizacion_pdf_id = p_cotizacion and o.estado <> 'ANULADA'
     and public.normalizar_codigo_interno(u.codigo_interno) is not null
   order by o.creado_en desc
   limit 1;
$$;

comment on function public.codigo_interno_de_cotizacion_desde(uuid) is
  'Desde cuándo la OT de la cotización tiene código interno: lo último entre la OT y el código de su unidad (bitácora). Ayudante interno.';

revoke all on function public.codigo_interno_de_cotizacion_desde(uuid) from public, anon, authenticated;

-- =============================================================================
-- 2. LOS DÍAS QUE LLEVA ESPERANDO SU FACTURA CADA COTIZACIÓN
-- =============================================================================
-- Para la lista de arriba de Facturación. Lo lee quien lee las cotizaciones
-- aprobadas (lo mismo que exige `cotizaciones_para_facturar`), y solo de las
-- cotizaciones que esa función le da: aprobadas y no anuladas. Devuelve desde
-- cuándo y cuántos días; qué cotización está por facturar lo decide la pantalla
-- con sus facturas, como lo decidía antes.
create or replace function public.facturacion_en_espera(p_ids uuid[])
returns table (cotizacion uuid, desde timestamptz, dias integer)
language plpgsql
stable
security definer
set search_path to 'public'
rows 50
as $$
begin
  if not (public.es_admin() or public.tiene_permiso('contabilidad.facturar') or public.tiene_permiso('cotizaciones.ver_aprobadas')) then
    raise exception 'No tienes permiso para ver las cotizaciones aprobadas.' using errcode = 'insufficient_privilege';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return;
  end if;
  if cardinality(p_ids) > 500 then
    raise exception 'Pide la espera de hasta 500 cotizaciones a la vez.' using errcode = 'check_violation';
  end if;
  return query
    select c.id, d.desde, public.dias_en_espera(d.desde)
      from public.cotizaciones_pdf c
      cross join lateral (select public.codigo_interno_de_cotizacion_desde(c.id) as desde) d
     where c.id = any(p_ids)
       and c.estado::text <> 'ANULADA' and public.cotizacion_fue_aprobada(c.id)
       and d.desde is not null;
end;
$$;

comment on function public.facturacion_en_espera(uuid[]) is
  'Desde cuándo cada cotización aprobada tiene su OT con código interno, y los días (fecha de Lima). Lo lee quien lee las cotizaciones aprobadas.';

revoke all on function public.facturacion_en_espera(uuid[]) from public, anon;
grant execute on function public.facturacion_en_espera(uuid[]) to authenticated;

-- =============================================================================
-- 3. EL GLOBO DEL MENÚ CUENTA LO MISMO QUE LA LISTA
-- =============================================================================
-- «Por facturar» del menú contaba solo las que no tienen ninguna factura; la
-- facturada en parte también espera la factura de lo que falta, y la lista de
-- arriba de Facturación la cuenta. Con el total con IGV, como Facturación
-- (`totalConIgv`); con una factura en otra moneda no se compara y no se cuenta.
-- La que Ventas está corrigiendo también cuenta, como en la lista: espera su
-- factura aunque no se pueda registrar hasta que Gerencia apruebe la versión
-- nueva. Lo de Tesorería queda igual.
do $$
declare v_md5 text;
begin
  select md5(replace(p.prosrc, E'\r', '')) into v_md5
    from pg_proc p where p.oid = 'public.facturacion_pendientes()'::regprocedure;
  if v_md5 not in ('b897173384b66f45eb8acbcdb2d6774b', '3d3540342785bc9757f912d140e84bdf') then
    raise exception 'facturacion_pendientes no está como la conoce el repositorio (md5 %): revísala antes de aplicar esta migración.', v_md5;
  end if;
end $$;

create or replace function public.facturacion_pendientes()
returns table (por_facturar integer, por_cobrar integer)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  return query select
    case when public.es_admin() or public.tiene_permiso('contabilidad.facturar') then
      (select count(*)::integer from public.cotizaciones_pdf c
         left join public.cotizaciones_pdf_igv ig on ig.cotizacion_id = c.id
         left join lateral (
           select count(*) as facturas,
                  coalesce(sum(f.total) filter (where f.moneda::text = c.moneda::text), 0) as en_su_moneda,
                  coalesce(bool_or(f.moneda::text <> c.moneda::text), false) as en_otra_moneda
             from public.facturas_venta f
            where f.cotizacion_pdf_id = c.id and f.anulada_en is null) fx on true
        where c.estado::text <> 'ANULADA' and public.cotizacion_fue_aprobada(c.id)
          and public.codigo_interno_de_cotizacion(c.id) is not null
          and (fx.facturas = 0
               or (c.monto_venta is not null and not fx.en_otra_moneda
                   and fx.en_su_moneda < (case when ig.incluye_igv = false then round(c.monto_venta::numeric * 1.18, 2)
                                               else c.monto_venta::numeric end) - 0.005)))
    end,
    case when public.es_admin() or public.tiene_permiso('tesoreria.registrar_cobros') then
      (select count(*)::integer from public.facturas_venta f
        where f.anulada_en is null
          and not exists (select 1 from public.cobros_factura_venta b
                           where b.factura_id = f.id and b.anulado_en is null and b.cancela))
    end;
end;
$$;

-- =============================================================================
-- 4. EL RECORRIDO DE LA COTIZACIÓN, HASTA EL COBRO
-- =============================================================================
-- Producción pudo cambiarla a mano: si no está como la dejó la 20261126450000
-- (Ventas, Plan 9.1) o como la deja esta, se detiene antes de pisarla.
do $$
declare v_md5 text;
begin
  select md5(replace(p.prosrc, E'\r', '')) into v_md5
    from pg_proc p where p.oid = 'public.recorrido_de_cotizaciones(uuid[])'::regprocedure;
  if v_md5 not in ('2387f7bbd95c071e866c7b7da5659a1a', 'a1d4192f42b2d6b1e567676788b41357') then
    raise exception 'recorrido_de_cotizaciones no está como la conoce el repositorio (md5 %): revísala antes de aplicar esta migración.', v_md5;
  end if;
end $$;

-- Copiada de la 20261126450000 (la de la 20261125130000 con los días de cada
-- paso hecho, Plan 9.1). Cambia: la factura espera desde que la OT tiene código
-- interno (antes, desde la OT), y se suman la factura de lo que falta y el cobro.
create or replace function public.recorrido_de_cotizaciones(p_ids uuid[])
returns table (
  documento uuid,
  orden     integer,
  paso      text,
  situacion text,
  puesto    text,
  en        timestamptz,
  dias      integer,
  espera    text,
  detalle   text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_admin     constant boolean := public.es_admin();
  v_comercial constant boolean := public.tiene_permiso('cotizaciones.ver_pdf_comercial');
  v_aprobadas constant boolean := public.tiene_permiso('cotizaciones.ver_aprobadas');
  v_tesoreria constant boolean := public.tiene_permiso('tesoreria.ver_documentos');
  -- El número de la OT lo lee quien lee las órdenes (`puede_ver_orden`); los demás ven el paso sin número.
  v_ordenes   constant boolean := public.es_admin() or public.tiene_permiso('ordenes.ver');
  -- El cobro lo ve quien lee los cobros: la política `ver_cobros_factura_venta`, tal cual.
  v_cobros    constant boolean := v_admin or public.tiene_permiso('contabilidad.facturar') or v_aprobadas or v_tesoreria;
begin
  if not (v_admin or v_comercial or v_aprobadas or v_tesoreria) then
    raise exception 'No tienes permiso para ver las cotizaciones.' using errcode = 'insufficient_privilege';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return;
  end if;
  if cardinality(p_ids) > 500 then
    raise exception 'Pide el recorrido de hasta 500 cotizaciones a la vez.' using errcode = 'check_violation';
  end if;

  return query
  with cot as (
    select c.id, c.estado::text as estado, c.registrado_por, c.creado_en, c.revisado_por, c.revisado_en,
           c.archivo_subido_en, c.version, c.anulado_por, c.anulado_en, c.moneda::text as moneda,
           -- El total con IGV, como lo cuenta Facturación (`totalConIgv`): sin IGV, se le suma el 18 %.
           case when c.monto_venta is null then null
                when ig.incluye_igv = false then round(c.monto_venta::numeric * 1.18, 2)
                else c.monto_venta::numeric end as total
      from public.cotizaciones_pdf c
      left join public.cotizaciones_pdf_igv ig on ig.cotizacion_id = c.id
     where c.id = any(p_ids)
       -- La política `ver_cotizaciones_pdf`, tal cual.
       and (v_admin or v_comercial
            or (v_tesoreria and exists (select 1 from public.cotizaciones_pdf_liberaciones_tesoreria l
                                         where l.cotizacion_pdf_id = c.id))
            or (v_aprobadas and public.cotizacion_fue_aprobada(c.id)))
  ),
  -- Cada versión que se archivó al corregir, con cuándo se subió la siguiente.
  versiones as (
    select v.cotizacion_id as cot, v.version, v.rechazado_por, v.rechazado_en, v.estado_al_archivar,
           coalesce(lead(v.subido_en) over (partition by v.cotizacion_id order by v.version), c.archivo_subido_en) as corregida_en
      from public.cotizaciones_pdf_versiones v
      join cot c on c.id = v.cotizacion_id
  ),
  -- La OT vigente que salió de ella, y desde cuándo tiene código interno.
  ot as (
    select distinct on (o.cotizacion_pdf_id) o.cotizacion_pdf_id as cot, o.numero, o.creado_por, o.creado_en,
           public.codigo_interno_de_cotizacion_desde(o.cotizacion_pdf_id) as con_codigo_en
      from public.ordenes_trabajo o
      join cot c on c.id = o.cotizacion_pdf_id
     where o.estado <> 'ANULADA'
     order by o.cotizacion_pdf_id, o.creado_en
  ),
  -- Su primera factura vigente: solo quién y cuándo, sin número ni monto.
  factura as (
    select distinct on (f.cotizacion_pdf_id) f.cotizacion_pdf_id as cot, f.registrado_por, f.creado_en
      from public.facturas_venta f
      join cot c on c.id = f.cotizacion_pdf_id
     where f.anulada_en is null
     order by f.cotizacion_pdf_id, f.creado_en
  ),
  -- Cada factura vigente con su cobro, como lo cuenta `v_facturas_venta`:
  -- cobrada si un cobro vigente la cancela o si lo cobrado alcanza su total.
  facturas as (
    select f.cotizacion_pdf_id as cot, f.id, f.moneda::text as moneda, f.total, f.creado_en,
           coalesce(bool_or(b.cancela) filter (where b.anulado_en is null), false)
             or coalesce(sum(b.monto) filter (where b.anulado_en is null), 0) >= f.total as cobrada,
           count(b.id) filter (where b.anulado_en is null) as cobros
      from public.facturas_venta f
      join cot c on c.id = f.cotizacion_pdf_id
      left join public.cobros_factura_venta b on b.factura_id = f.id
     where f.anulada_en is null
     group by f.id
  ),
  -- Lo facturado de cada cotización en su moneda, y si alguna factura va en otra.
  facturado as (
    select c.id as cot,
           coalesce(sum(x.total) filter (where x.moneda = c.moneda), 0) as en_su_moneda,
           bool_or(x.moneda <> c.moneda) as en_otra_moneda
      from cot c join facturas x on x.cot = c.id
     group by c.id
  ),
  -- Facturada en parte: le falta facturar lo que no cubren sus facturas, esté
  -- aprobada o en corrección. Con una factura en otra moneda no se compara, como
  -- en Facturación.
  falta_resto as (
    select c.id as cot
      from cot c
      join facturado x on x.cot = c.id
     where c.estado <> 'ANULADA' and c.total is not null
       and not x.en_otra_moneda and x.en_su_moneda < c.total - 0.005
  ),
  -- El último cobro vigente, el que la dejó cobrada: quién y cuándo, sin monto.
  ultimo_cobro as (
    select distinct on (x.cot) x.cot, b.registrado_por, b.creado_en
      from facturas x
      join public.cobros_factura_venta b on b.factura_id = x.id and b.anulado_en is null
     order by x.cot, b.fecha desc, b.creado_en desc
  ),
  pasos as (
    -- `canon` desempata lo que pasó a la misma hora: cada versión con su revisión
    -- y su corrección, en ese orden, antes que la OT, la factura y el cobro.
    -- Ventas la subió
    select c.id as cot, 10 as canon, 'SUBIDA' as paso, 'HECHO' as situacion, c.registrado_por as quien, null::text as puesto_fijo,
           c.creado_en as en, null::text as espera, null::text as detalle
      from cot c
    union all
    -- La revisión de cada versión anterior
    select v.cot, v.version * 10 + 20, 'REVISION', 'HECHO', v.rechazado_por, null, v.rechazado_en, null, v.estado_al_archivar
      from versiones v where v.rechazado_en is not null
    union all
    -- La corrección que la reemplazó
    select v.cot, v.version * 10 + 25, 'CORRECCION', 'HECHO', c.registrado_por, null, v.corregida_en, null, 'versión ' || (v.version + 1)
      from versiones v join cot c on c.id = v.cot
    union all
    -- La revisión de la versión vigente. La anulada conserva quién la revisó y
    -- cuándo; cómo terminó esa revisión (aprobada o rechazada) ya no está en
    -- ninguna columna y sale de la bitácora, del estado que tenía al anularse.
    select c.id, c.version * 10 + 20, 'REVISION', 'HECHO', c.revisado_por, null, c.revisado_en, null,
           case when c.estado = 'ANULADA' then
                  (select b.datos_antes ->> 'estado' from public.audit_log b
                    where b.tabla = 'cotizaciones_pdf' and b.registro_id = c.id and b.accion = 'UPDATE'
                      and b.datos_despues ->> 'estado' = 'ANULADA'
                    order by b.creado_en desc limit 1)
                else c.estado end
      from cot c where c.estado in ('APROBADA', 'RECHAZADA', 'ANULADA') and c.revisado_en is not null
    union all
    select c.id, c.version * 10 + 20, 'REVISION', 'AHORA', null, 'Gerencia', c.archivo_subido_en, 'REVISION', null
      from cot c where c.estado = 'POR_REVISAR'
    union all
    -- Rechazada: vuelve a quien la subió, y después Gerencia revisa la corrección
    select c.id, c.version * 10 + 25, 'CORRECCION', 'AHORA', null, coalesce(public.puesto_de(c.registrado_por), 'Ventas'), c.revisado_en, 'CORRECCION', null
      from cot c where c.estado = 'RECHAZADA'
    union all
    select c.id, c.version * 10 + 30, 'REVISION', 'PENDIENTE', null, null, null, null, null
      from cot c where c.estado = 'RECHAZADA'
    union all
    -- Administración le dio el código interno y subió la OT
    select o.cot, 100000, 'CODIGO_Y_OT', 'HECHO', o.creado_por, null, o.creado_en, null, case when v_ordenes then 'OT ' || o.numero end
      from ot o
    union all
    select c.id, 100000, 'CODIGO_Y_OT', 'AHORA', null, 'Administración', c.revisado_en, 'CODIGO_Y_OT', null
      from cot c where c.estado = 'APROBADA' and not exists (select 1 from ot o where o.cot = c.id)
    union all
    select c.id, 100000, 'CODIGO_Y_OT', 'PENDIENTE', null, null, null, null, null
      from cot c where c.estado in ('POR_REVISAR', 'RECHAZADA') and not exists (select 1 from ot o where o.cot = c.id)
    union all
    -- Contabilidad la facturó. A quien lee las facturas le dice si fue solo una parte.
    select f.cot, 100010, 'FACTURA', 'HECHO', f.registrado_por, null, f.creado_en, null,
           case when v_cobros and exists (select 1 from falta_resto r where r.cot = f.cot) then 'EN_PARTE' end
      from factura f
    union all
    -- Espera su factura desde que la OT tiene código interno (DKS, Plan 10).
    select c.id, 100010, 'FACTURA', 'AHORA', null, 'Contabilidad', coalesce(o.con_codigo_en, o.creado_en), 'FACTURA', null
      from cot c join ot o on o.cot = c.id
     where c.estado = 'APROBADA' and not exists (select 1 from factura f where f.cot = c.id)
    union all
    select c.id, 100010, 'FACTURA', 'PENDIENTE', null, null, null, null, null
      from cot c
     where c.estado <> 'ANULADA' and not exists (select 1 from factura f where f.cot = c.id)
       and not (c.estado = 'APROBADA' and exists (select 1 from ot o where o.cot = c.id))
    union all
    -- Facturada en parte: espera la factura de lo que falta, desde la misma hora.
    -- Cuánto se facturó solo lo ve quien lee las facturas: Ventas no.
    select r.cot, 100015, 'FACTURA_RESTO', 'AHORA', null, 'Contabilidad', coalesce(o.con_codigo_en, o.creado_en), 'FACTURA_RESTO', null
      from falta_resto r
      join cot c on c.id = r.cot
      join ot o on o.cot = r.cot
     where v_cobros and c.estado = 'APROBADA'
    union all
    -- Tesorería la cobró: todas sus facturas vigentes quedaron cobradas y no falta
    -- facturar nada. Cobrado el adelanto, el cobro del resto sigue pendiente.
    select u.cot, 100018, 'COBRO', 'HECHO', u.registrado_por, null, u.creado_en, null, null
      from ultimo_cobro u
     where v_cobros and not exists (select 1 from facturas x where x.cot = u.cot and not x.cobrada)
       and not exists (select 1 from falta_resto r where r.cot = u.cot)
    union all
    select r.cot, 100018, 'COBRO', 'PENDIENTE', null, null, null, null, null
      from falta_resto r
     where v_cobros and not exists (select 1 from facturas x where x.cot = r.cot and not x.cobrada)
    union all
    -- Alguna factura vigente espera su cobro: desde la más vieja de las que faltan.
    select x.cot, 100018, 'COBRO', 'AHORA', null, 'Tesorería', min(x.creado_en), 'COBRO',
           case when sum(x.cobros) > 0 then 'EN_PARTE' end
      from facturas x
     where v_cobros and not x.cobrada
     group by x.cot
    union all
    select c.id, 100018, 'COBRO', 'PENDIENTE', null, null, null, null, null
      from cot c
     where v_cobros and c.estado <> 'ANULADA' and not exists (select 1 from facturas x where x.cot = c.id)
    union all
    -- Anulada
    select c.id, 100020, 'ANULACION', 'HECHO', c.anulado_por, null, c.anulado_en, null, null
      from cot c where c.estado = 'ANULADA' and c.anulado_en is not null
  )
  -- Los días de cada paso hecho: cuántas fechas de Lima pasaron desde el paso
  -- hecho anterior (la subida no tiene anterior). Así el vendedor ve cuánto
  -- tardó Gerencia en responder y cuánto tardó la OT, sin hacer la cuenta.
  select x.cot, x.n, x.paso, x.situacion, x.puesto, x.en,
         case when x.situacion = 'AHORA' then public.dias_en_espera(x.en)
              when x.situacion = 'HECHO' and x.en is not null and x.previo is not null
              then greatest((x.en at time zone 'America/Lima')::date - (x.previo at time zone 'America/Lima')::date, 0)
         end,
         x.espera, x.detalle
    from (
      select p.cot,
             (row_number() over (
                partition by p.cot
                order by case p.situacion when 'HECHO' then 0 when 'AHORA' then 1 else 2 end,
                         case when p.situacion = 'HECHO' then p.en end, p.canon))::integer as n,
             p.paso, p.situacion,
             case when p.situacion = 'HECHO' then public.puesto(u) else p.puesto_fijo end as puesto,
             p.en,
             -- El paso hecho justo antes, en el mismo orden en que se muestran.
             lag(p.en) over (partition by p.cot, p.situacion = 'HECHO' order by p.en, p.canon) as previo,
             p.espera, p.detalle
        from pasos p
        left join public.usuarios u on u.id = p.quien
       -- La anulada no espera a nadie: queda lo hecho, como evidencia.
       where p.situacion = 'HECHO'
          or (select c.estado from cot c where c.id = p.cot) <> 'ANULADA'
    ) x;
end;
$$;

comment on function public.recorrido_de_cotizaciones(uuid[]) is
  'El recorrido de cada cotización, un paso por fila, de la subida al cobro: lo hecho con el puesto de quien lo hizo y su fecha; quién la tiene ahora y hace cuántos días (fecha de Lima); y lo que falta. Devuelve solo las que la política ver_cotizaciones_pdf deja ver a quien llama; el cobro, solo a quien lee los cobros. Sin importes ni datos de RR. HH.';

revoke all on function public.recorrido_de_cotizaciones(uuid[]) from public, anon;
grant execute on function public.recorrido_de_cotizaciones(uuid[]) to authenticated;
