-- =============================================================================
-- VENTAS VE DÓNDE VA SU COTIZACIÓN (Plan 9, entrega 9.1)
-- -----------------------------------------------------------------------------
-- El cliente llama y pregunta: «¿ya aprobaron mi cotización?, ¿cuándo empiezan?».
-- El vendedor tenía que llamar a Gerencia o a Administración para saberlo. El
-- recorrido de la cotización (migración 20261125130000) ya dice quién la tiene
-- y hace cuántos días; le faltaba decir cuánto tardó cada paso que ya pasó, y
-- la campana callaba una de las respuestas de Gerencia.
--
-- 1. El recorrido de la cotización da también los días de cada paso hecho:
--    cuántas fechas de Lima pasaron desde el paso anterior («Aprobada a los
--    2 días»). La columna `dias` ya existe; hasta hoy solo la llenaba el paso
--    que espera (AHORA). El del requerimiento no cambia. No sale ningún dato
--    nuevo: solo una resta entre fechas que el vendedor ya ve.
--
-- 2. La campana del vendedor cuando Gerencia responde:
--    - Al anularla, Gerencia no le avisaba nada: el aviso no distinguía la
--      anulación del rechazo y, para no decir «rechazó», en la migración
--      20260928143100 se le quitó a la anulada. Ahora dice que la anuló y por
--      qué, y el disparador vuelve a correr con ella.
--    - El de la anulada lleva al filtro de anuladas, donde está su tarjeta:
--      la lista que se abre sin filtro es la de vigentes, y no la trae. Los
--      demás siguen con `/cotizaciones/pdf`; la campana les suma el `#id` de
--      su cotización (`destinoAviso`) y la pantalla baja hasta ella.
--
-- «Liberada» no es un paso aparte: desde la migración 20261027200000 nadie la
-- libera a mano; Contabilidad y Tesorería ven toda cotización aprobada. La
-- pantalla lo dice en el paso «Aprobada».
--
-- Las dos funciones se reemplazan enteras. Antes se comprueba que producción
-- tenga el texto que conoce el repositorio (el de antes o el de esta
-- migración): si alguien las cambió a mano, la migración se detiene.
-- =============================================================================

do $$
declare
  conocidas constant jsonb := jsonb_build_object(
    'recorrido_de_cotizaciones(uuid[])', jsonb_build_array('b2ad46d40d0b717f394402e5e5ced606', '2387f7bbd95c071e866c7b7da5659a1a'),
    'fn_cotizacion_pdf_avisa()',         jsonb_build_array('15bfd0c95cdf0b5bc8ffa6c873d82137', '899ecdee38949ebf55c6c4979e53b796'));
  firma text;
  huella text;
begin
  for firma in select jsonb_object_keys(conocidas) loop
    select md5(replace(p.prosrc, E'\r', '')) into huella
      from pg_proc p where p.oid = to_regprocedure('public.' || firma);
    if huella is null then
      raise exception 'Falta la función %: esta base no tiene las migraciones anteriores.', firma;
    end if;
    if not conocidas -> firma ? huella then
      raise exception 'La función % no es la que conoce el repositorio (se cambió a mano): no se reemplaza. Avisa antes de seguir.', firma;
    end if;
  end loop;
end $$;

-- =============================================================================
-- 1. EL RECORRIDO DE LA COTIZACIÓN, CON LOS DÍAS DE CADA PASO
-- =============================================================================
-- Igual que en la 20261125130000, salvo la selección final: el paso hecho lleva
-- en `dias` las fechas de Lima desde el paso hecho anterior. El alcance (quién
-- ve qué cotización) no cambia y lo sigue vigilando el check 458.
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
           c.archivo_subido_en, c.version, c.anulado_por, c.anulado_en
      from public.cotizaciones_pdf c
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
  -- La OT vigente que salió de ella.
  ot as (
    select distinct on (o.cotizacion_pdf_id) o.cotizacion_pdf_id as cot, o.numero, o.creado_por, o.creado_en
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
  pasos as (
    -- `canon` desempata lo que pasó a la misma hora: cada versión con su revisión
    -- y su corrección, en ese orden, antes que la OT y la factura.
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
    -- Contabilidad la facturó
    select f.cot, 100010, 'FACTURA', 'HECHO', f.registrado_por, null, f.creado_en, null, null
      from factura f
    union all
    select c.id, 100010, 'FACTURA', 'AHORA', null, 'Contabilidad', o.creado_en, 'FACTURA', null
      from cot c join ot o on o.cot = c.id
     where c.estado = 'APROBADA' and not exists (select 1 from factura f where f.cot = c.id)
    union all
    select c.id, 100010, 'FACTURA', 'PENDIENTE', null, null, null, null, null
      from cot c
     where c.estado <> 'ANULADA' and not exists (select 1 from factura f where f.cot = c.id)
       and not (c.estado = 'APROBADA' and exists (select 1 from ot o where o.cot = c.id))
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
  'El recorrido de cada cotización, un paso por fila: lo hecho con el puesto de quien lo hizo, su fecha y los días (fecha de Lima) desde el paso hecho anterior; quién la tiene ahora y hace cuántos días; y lo que falta. Devuelve solo las que la política ver_cotizaciones_pdf deja ver a quien llama. Sin importes ni datos de RR. HH.';

revoke all on function public.recorrido_de_cotizaciones(uuid[]) from public, anon;
grant execute on function public.recorrido_de_cotizaciones(uuid[]) to authenticated;

-- =============================================================================
-- 2. LA CAMPANA DEL VENDEDOR CUANDO GERENCIA RESPONDE
-- =============================================================================
-- Igual que en la 20261027200000, salvo el aviso al vendedor: la anulación
-- tiene su frase y lleva al filtro de anuladas.
create or replace function public.fn_cotizacion_pdf_avisa()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cliente text;
  v_quien   text;
  v_codigo  text;
  v_con_ot  boolean;
begin
  select c.razon_social into v_cliente from public.clientes c where c.id = new.cliente_id;
  v_quien := public.puesto_de(new.registrado_por);

  if tg_op = 'INSERT' then
    perform public.notificar_a_permiso(
      'cotizaciones.revisar',
      'Cotización por revisar',
      format('%s subió la %s de %s', coalesce(v_quien, 'Ventas'), new.numero, public.con_punto_final(coalesce(v_cliente, 'un cliente'))),
      '/cotizaciones/pdf', 'cotizaciones_pdf', new.id, public.usuario_actual());
    return null;
  end if;

  if new.estado is not distinct from old.estado then
    return null;
  end if;

  if new.estado = 'POR_REVISAR' then
    if new.version > old.version then
      perform public.notificar_a_permiso(
        'cotizaciones.revisar',
        'Cotización corregida',
        format('%s subió la corrección de la %s de %s (versión %s). Lo que habías observado: %s',
               coalesce(v_quien, 'Ventas'), new.numero, coalesce(v_cliente, 'un cliente'), new.version,
               coalesce(old.observacion, 'sin observación')),
        '/cotizaciones/pdf', 'cotizaciones_pdf', new.id, public.usuario_actual());
    end if;
    return null;
  end if;

  if new.estado = 'APROBADA' then
    v_codigo := public.codigo_interno_de_cotizacion(new.id);
    v_con_ot := exists (select 1 from public.ordenes_trabajo o
                         where o.cotizacion_pdf_id = new.id and o.estado <> 'ANULADA');
    if not v_con_ot then
      perform public.notificar_a_permiso(
        'ordenes.crear',
        'Cotización aprobada: falta su código y su OT',
        format('Gerencia aprobó la %s de %s Dale su código interno y sube su OT.',
               new.numero, public.con_punto_final(coalesce(v_cliente, 'un cliente'))),
        '/cotizaciones/pdf?estado=APROBADA_SIN_OT#' || new.id, 'cotizaciones_pdf', new.id, public.usuario_actual());
    end if;
  end if;

  -- Al vendedor que la subió: aprobada, rechazada o anulada, cada una con su
  -- frase. La anulada sale de la lista de vigentes: su tarjeta está en el
  -- filtro de anuladas (la campana le suma el #id a la que no lo trae).
  perform public.notificar_a_usuario(
    new.registrado_por,
    case new.estado when 'APROBADA' then 'Gerencia aprobó tu cotización'
                    when 'ANULADA'  then 'Gerencia anuló tu cotización'
                    else 'Gerencia rechazó tu cotización' end,
    case when new.estado = 'APROBADA' and v_codigo is not null
         then public.con_punto_final(format('La %s de %s, con el código interno %s', new.numero, coalesce(v_cliente, 'un cliente'), v_codigo))
         when new.estado = 'APROBADA'
         then format('La %s de %s Administración le da su código interno y sube su OT.',
                     new.numero, public.con_punto_final(coalesce(v_cliente, 'un cliente')))
         when new.estado = 'ANULADA'
         then format('La %s de %s Motivo: %s El número se conserva.',
                     new.numero, public.con_punto_final(coalesce(v_cliente, 'un cliente')),
                     public.con_punto_final(coalesce(nullif(btrim(new.observacion), ''), 'sin motivo')))
         else format('La %s: %s Corrígela y sube la corrección.', new.numero, public.con_punto_final(coalesce(nullif(btrim(new.observacion), ''), 'Sin motivo'))) end,
    case when new.estado = 'ANULADA' then '/cotizaciones/pdf?estado=ANULADA' else '/cotizaciones/pdf' end,
    'cotizaciones_pdf', new.id, public.usuario_actual());

  return null;
end;
$function$;

revoke all on function public.fn_cotizacion_pdf_avisa() from public, anon, authenticated;

-- La anulada vuelve a pasar por el aviso: ahora tiene su propia frase. Solo
-- cambia la condición; el resto del disparador es el de la 20260928143100.
create or replace trigger trg_cotizacion_pdf_avisa_update
  after update of estado on public.cotizaciones_pdf
  for each row execute function public.fn_cotizacion_pdf_avisa();
