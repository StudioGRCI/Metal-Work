-- Lo que Gerencia ya decidió (plan 12, entrega 12.2).
--
-- Gerencia aprueba o devuelve cotizaciones, compras y servicios, da el visto a
-- los reportes diarios, aprueba los trabajos sin orden, cierra el costeo de los
-- códigos y aprueba o anula órdenes de trabajo. Cada pantalla guarda su
-- decisión, pero nada las reunía: para saber qué decidió en noviembre había que
-- abrir seis pantallas y buscar fila por fila.
--
-- Esta función las reúne en lectura, de las columnas que ya guardan quién y
-- cuándo. La bitácora entra solo donde no hay columna: la OT no guarda quién la
-- aprobó ni quién la anuló (`ot_bitacora`), y la cotización anulada ya no dice
-- cómo terminó su revisión (`audit_log`, el estado que tenía al anularse, como
-- `recorrido_de_cotizaciones`).
--
-- Cada puesto ve lo que decidió su puesto, no lo de los demás: la Gerencia
-- General, lo de Gerencia General. No lleva montos: dice qué documento, de qué
-- código, qué se decidió, cuándo y con qué motivo, y la pantalla de cada
-- documento dice el resto con su permiso. La pide la misma puerta que «Por
-- decidir» (`cotizaciones.revisar` o `codigos_internos.cerrar`).
--
-- La bitácora (`audit_log`) entra también donde la columna se borra después:
-- - el trabajo sin orden devuelto: al corregirlo, el supervisor deja en nulo
--   quién lo observó;
-- - la aprobación de una OC que después sube de monto y vuelve a pedir
--   aprobación (`evaluar_aprobacion_compra` deja en nulo quién la aprobó);
-- - la cotización devuelta y después anulada: la anulación escribe su motivo
--   encima de la observación de la devolución.
-- La cotización corregida archiva cada versión revisada y sale entera.
--
-- El nombre de la OC sale de `nombre_de_oc(numero, referencia)`, el mismo que
-- usan sus pantallas.
--
-- Cambia la forma de lo que devuelve (la columna `codigo`): se quita antes de
-- crearla, y volver a correr la migración deja lo mismo.

drop function if exists public.decisiones_tomadas(date, date);

create function public.decisiones_tomadas(p_desde date, p_hasta date)
returns table (
  tipo        text,         -- COTIZACION, COMPRA, SERVICIO, REPORTE_DIARIO, TRABAJO_SIN_ORDEN, CIERRE_CODIGO, ORDEN_TRABAJO
  documento   uuid,
  nombre      text,         -- el número o el nombre del documento
  detalle     text,         -- de quién o de qué es (cliente, proveedor, fecha y área)
  codigo      text,         -- el código interno, si el documento lleva uno
  decision    text,         -- APROBADO, DEVUELTO, ANULADO, VISTO, CERRADO, REABIERTO
  decidido_en timestamptz,
  puesto      text,         -- el puesto de quien decidió
  motivo      text,
  enlace      text          -- lo que la pantalla necesita para el salto (estado de la cotización, unidad de flota)
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_rol   constant text := public.mi_rol();
  v_desde constant timestamptz := (p_desde::timestamp at time zone 'America/Lima');
  v_hasta constant timestamptz := ((p_hasta + 1)::timestamp at time zone 'America/Lima');
begin
  if not (public.es_admin()
          or public.tiene_permiso('cotizaciones.revisar')
          or public.tiene_permiso('codigos_internos.cerrar')) then
    raise exception 'No tienes permiso para ver las decisiones de Gerencia.' using errcode = 'insufficient_privilege';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde then
    raise exception 'Elige un periodo: desde y hasta, en ese orden.' using errcode = 'check_violation';
  end if;
  if p_hasta - p_desde > 366 then
    raise exception 'Pide las decisiones de hasta un año a la vez.' using errcode = 'check_violation';
  end if;
  if v_rol is null then
    return;
  end if;

  return query
  with
  -- Quiénes son del puesto de quien pregunta: lo que decidieron es «lo de Gerencia».
  del_puesto as (
    select u.id from public.usuarios u join public.roles r on r.id = u.rol_id where r.codigo = v_rol
  ),
  d as (
    -- Cotización: cada versión revisada que se archivó al corregirla. El motivo es
    -- el de la devolución; la aprobada que después se corrigió lleva el de quien la
    -- corrigió, que no es de Gerencia.
    select 'COTIZACION'::text as tipo, c.id as documento, c.numero::text as nombre, cl.razon_social::text as detalle,
           null::text as codigo,
           case v.estado_al_archivar when 'APROBADA' then 'APROBADO' else 'DEVUELTO' end as decision,
           v.rechazado_en as en, v.rechazado_por as por,
           case when v.estado_al_archivar = 'RECHAZADA' then nullif(btrim(v.observacion), '') end as motivo,
           c.estado::text as enlace
      from public.cotizaciones_pdf_versiones v
      join public.cotizaciones_pdf c on c.id = v.cotizacion_id
      left join public.clientes cl on cl.id = c.cliente_id
     where v.rechazado_en >= v_desde and v.rechazado_en < v_hasta
       and v.estado_al_archivar in ('APROBADA', 'RECHAZADA')
    union all
    -- Cotización: la revisión de la versión vigente. La anulada dice cómo terminó
    -- su revisión, y con qué motivo, por la fila que tenía al anularse: la
    -- anulación escribe su propio motivo en `observacion`.
    select 'COTIZACION', c.id, c.numero::text, cl.razon_social::text, null,
           case r.estado when 'APROBADA' then 'APROBADO' when 'RECHAZADA' then 'DEVUELTO' end,
           c.revisado_en, c.revisado_por,
           case when r.estado = 'RECHAZADA' then nullif(btrim(r.observacion), '') end, c.estado::text
      from public.cotizaciones_pdf c
      left join public.clientes cl on cl.id = c.cliente_id
      cross join lateral (
        select coalesce(a.estado, c.estado::text) as estado,
               case when c.estado = 'ANULADA' then a.observacion else c.observacion end as observacion
          from (select null) x
          left join lateral (
            select b.datos_antes ->> 'estado' as estado, b.datos_antes ->> 'observacion' as observacion
              from public.audit_log b
             where c.estado = 'ANULADA'
               and b.tabla = 'cotizaciones_pdf' and b.registro_id = c.id and b.accion = 'UPDATE'
               and b.datos_despues ->> 'estado' = 'ANULADA'
             order by b.creado_en desc limit 1
          ) a on true
      ) r
     where c.revisado_en >= v_desde and c.revisado_en < v_hasta
       and r.estado in ('APROBADA', 'RECHAZADA')
    union all
    select 'COTIZACION', c.id, c.numero::text, cl.razon_social::text, null, 'ANULADO', c.anulado_en, c.anulado_por,
           nullif(btrim(c.motivo_anulacion), ''), c.estado::text
      from public.cotizaciones_pdf c
      left join public.clientes cl on cl.id = c.cliente_id
     where c.anulado_en >= v_desde and c.anulado_en < v_hasta
    union all
    -- Orden de compra: la aprobación vigente, de su columna.
    select 'COMPRA', o.id, public.nombre_de_oc(o.numero, o.referencia), coalesce(p.razon_social, o.proveedor)::text, o.codigo_interno::text, 'APROBADO',
           o.aprobado_en, o.aprobado_por, null, null
      from public.ordenes_compra_materiales o
      left join public.proveedores p on p.id = o.proveedor_id
     where o.aprobado_en >= v_desde and o.aprobado_en < v_hasta
    union all
    -- Y la que se borró porque la OC subió de monto y volvió a pedir aprobación: de
    -- `audit_log`, la fila que la quitó (antes APROBADA, después ya no), salvo
    -- que sea la misma que sigue en la columna.
    select 'COMPRA', o.id, public.nombre_de_oc(o.numero, o.referencia), coalesce(p.razon_social, o.proveedor)::text, o.codigo_interno::text, 'APROBADO',
           (b.datos_antes ->> 'aprobado_en')::timestamptz, (b.datos_antes ->> 'aprobado_por')::uuid, null, null
      from public.audit_log b
      join public.ordenes_compra_materiales o on o.id = b.registro_id
      left join public.proveedores p on p.id = o.proveedor_id
     where b.tabla = 'ordenes_compra_materiales' and b.accion = 'UPDATE'
       and b.datos_antes ->> 'aprobacion' = 'APROBADA'
       and b.datos_despues ->> 'aprobacion' is distinct from 'APROBADA'
       and b.datos_antes ->> 'aprobado_en' is not null
       and b.datos_despues ->> 'aprobado_en' is null
       and (b.datos_antes ->> 'aprobado_en')::timestamptz >= v_desde and (b.datos_antes ->> 'aprobado_en')::timestamptz < v_hasta
       and (b.datos_antes ->> 'aprobado_en')::timestamptz is distinct from o.aprobado_en
    union all
    select 'COMPRA', o.id, public.nombre_de_oc(o.numero, o.referencia), coalesce(p.razon_social, o.proveedor)::text, o.codigo_interno::text, 'DEVUELTO',
           o.rechazado_en, o.rechazado_por, nullif(btrim(o.motivo_rechazo), ''), null
      from public.ordenes_compra_materiales o
      left join public.proveedores p on p.id = o.proveedor_id
     where o.rechazado_en >= v_desde and o.rechazado_en < v_hasta
    union all
    select 'COMPRA', o.id, public.nombre_de_oc(o.numero, o.referencia), coalesce(p.razon_social, o.proveedor)::text, o.codigo_interno::text, 'ANULADO',
           o.anulada_en, o.anulada_por, nullif(btrim(o.motivo_anulacion), ''), null
      from public.ordenes_compra_materiales o
      left join public.proveedores p on p.id = o.proveedor_id
     where o.anulada_en >= v_desde and o.anulada_en < v_hasta
    union all
    -- Orden de servicio
    select 'SERVICIO', s.id, s.numero::text, coalesce(p.razon_social, s.proveedor)::text, s.codigo_interno::text, 'APROBADO',
           s.aprobado_en, s.aprobado_por, null, null
      from public.ordenes_servicio s
      left join public.proveedores p on p.id = s.proveedor_id
     where s.aprobado_en >= v_desde and s.aprobado_en < v_hasta
    union all
    select 'SERVICIO', s.id, s.numero::text, coalesce(p.razon_social, s.proveedor)::text, s.codigo_interno::text, 'DEVUELTO',
           s.rechazado_en, s.rechazado_por, nullif(btrim(s.motivo_rechazo), ''), null
      from public.ordenes_servicio s
      left join public.proveedores p on p.id = s.proveedor_id
     where s.rechazado_en >= v_desde and s.rechazado_en < v_hasta
    union all
    select 'SERVICIO', s.id, s.numero::text, coalesce(p.razon_social, s.proveedor)::text, s.codigo_interno::text, 'ANULADO',
           s.anulado_en, s.anulado_por, nullif(btrim(s.motivo_anulacion), ''), null
      from public.ordenes_servicio s
      left join public.proveedores p on p.id = s.proveedor_id
     where s.anulado_en >= v_desde and s.anulado_en < v_hasta
    union all
    -- Reporte diario: el visto, la observación y la anulación. Se nombra por su
    -- asunto: dos reportes del mismo día y la misma área no se distinguían.
    -- `observacion_area` dice quién observó (GERENCIA, RRHH), no por qué.
    select 'REPORTE_DIARIO', r.id, coalesce(nullif(btrim(r.asunto), ''), to_char(r.fecha, 'DD/MM/YYYY')),
           concat_ws(' · ', to_char(r.fecha, 'DD/MM/YYYY'), a.nombre::text), r.codigo_interno::text, 'VISTO',
           r.visto_gerencia_en, r.visto_gerencia_por, null, null
      from public.reportes_diarios r
      left join public.areas a on a.id = r.area_id
     where r.visto_gerencia_en >= v_desde and r.visto_gerencia_en < v_hasta
    union all
    select 'REPORTE_DIARIO', r.id, coalesce(nullif(btrim(r.asunto), ''), to_char(r.fecha, 'DD/MM/YYYY')),
           concat_ws(' · ', to_char(r.fecha, 'DD/MM/YYYY'), a.nombre::text), r.codigo_interno::text, 'DEVUELTO',
           r.observado_en, r.observado_por, nullif(btrim(r.observacion), ''), null
      from public.reportes_diarios r
      left join public.areas a on a.id = r.area_id
     where r.observado_en >= v_desde and r.observado_en < v_hasta
    union all
    select 'REPORTE_DIARIO', r.id, coalesce(nullif(btrim(r.asunto), ''), to_char(r.fecha, 'DD/MM/YYYY')),
           concat_ws(' · ', to_char(r.fecha, 'DD/MM/YYYY'), a.nombre::text), r.codigo_interno::text, 'ANULADO',
           r.anulado_en, r.anulado_por, nullif(btrim(r.motivo_anulacion), ''), null
      from public.reportes_diarios r
      left join public.areas a on a.id = r.area_id
     where r.anulado_en >= v_desde and r.anulado_en < v_hasta
    union all
    -- Trabajo sin orden (avance de flota): la aprobación, de su columna. La devolución,
    -- de `audit_log`: cuando el supervisor corrige el reporte observado (o lo quita), la
    -- base deja en nulo quién y cuándo lo revisó, y la devolución desaparecería.
    -- El detalle lleva qué se hizo: dos trabajos de la misma unidad y el mismo día se distinguen.
    select 'TRABAJO_SIN_ORDEN', f.id, coalesce(u.placa, u.descripcion)::text || ' · ' || to_char(f.fecha, 'DD/MM/YYYY'),
           concat_ws(' · ', a.nombre::text, nullif(left(btrim(f.descripcion), 80), '')),
           null, 'APROBADO', f.revisado_en, f.revisado_por, null, f.flota_id::text
      from public.flota_avances f
      left join public.flota_unidades u on u.id = f.flota_id
      left join public.areas a on a.id = f.area_id
     where f.revisado_en >= v_desde and f.revisado_en < v_hasta
       and f.revision = 'APROBADO'
    union all
    select 'TRABAJO_SIN_ORDEN', b.registro_id,
           coalesce(u.placa, u.descripcion)::text || ' · ' || to_char((b.datos_despues ->> 'fecha')::date, 'DD/MM/YYYY'),
           concat_ws(' · ', a.nombre::text, nullif(left(btrim(b.datos_despues ->> 'descripcion'), 80), '')),
           null, 'DEVUELTO', (b.datos_despues ->> 'revisado_en')::timestamptz, (b.datos_despues ->> 'revisado_por')::uuid,
           nullif(btrim(b.datos_despues ->> 'observacion'), ''), b.datos_despues ->> 'flota_id'
      from public.audit_log b
      left join public.flota_unidades u on u.id = (b.datos_despues ->> 'flota_id')::uuid
      left join public.areas a on a.id = (b.datos_despues ->> 'area_id')::uuid
     where b.tabla = 'flota_avances' and b.accion = 'UPDATE'
       and b.creado_en >= v_desde and b.creado_en < v_hasta
       and b.datos_despues ->> 'revision' = 'OBSERVADO'
       and b.datos_antes ->> 'revision' is distinct from 'OBSERVADO'
    union all
    -- Cierre del costeo de un código
    select 'CIERRE_CODIGO', k.id, k.codigo::text, null, k.codigo::text, 'CERRADO', k.cerrado_en, k.cerrado_por,
           nullif(btrim(k.observacion), ''), null
      from public.codigo_interno_cierres k
     where k.cerrado_en >= v_desde and k.cerrado_en < v_hasta
    union all
    select 'CIERRE_CODIGO', k.id, k.codigo::text, null, k.codigo::text, 'REABIERTO', k.reabierto_en, k.reabierto_por,
           nullif(btrim(k.motivo_reapertura), ''), null
      from public.codigo_interno_cierres k
     where k.reabierto_en >= v_desde and k.reabierto_en < v_hasta
    union all
    -- Orden de trabajo: la OT no guarda quién la aprobó ni quién la anuló; lo dice su
    -- bitácora. La anulada desde «pausada» se anota como REANUDACION: se mira el
    -- estado nuevo, no el tipo. Aprobarla es salir del borrador: volver a APROBADA
    -- desde otro estado (PROGRAMADA) no es una aprobación de Gerencia.
    select 'ORDEN_TRABAJO', o.id, o.numero::text, cl.razon_social::text, un.codigo_interno::text,
           case b.datos ->> 'estado_nuevo' when 'APROBADA' then 'APROBADO' else 'ANULADO' end,
           b.creado_en, b.usuario_id,
           case when b.datos ->> 'estado_nuevo' = 'ANULADA'
                then nullif(btrim(coalesce(b.datos ->> 'motivo', o.motivo_anulacion)), '') end,
           null
      from public.ot_bitacora b
      join public.ordenes_trabajo o on o.id = b.orden_id
      left join public.clientes cl on cl.id = o.cliente_id
      left join public.unidades un on un.id = o.unidad_id
     where b.etapa_id is null
       and b.tipo_evento in ('CAMBIO_ESTADO', 'REANUDACION')
       and (b.datos ->> 'estado_nuevo' = 'ANULADA'
            or (b.datos ->> 'estado_nuevo' = 'APROBADA' and b.datos ->> 'estado_anterior' = 'BORRADOR'))
       and b.creado_en >= v_desde and b.creado_en < v_hasta
  )
  select d.tipo, d.documento, d.nombre, d.detalle, d.codigo, d.decision, d.en, public.puesto_de(d.por), d.motivo, d.enlace
    from d
   where d.por in (select id from del_puesto)
   order by d.en desc, d.tipo, d.nombre;
end;
$$;

comment on function public.decisiones_tomadas(date, date) is
  'Lo que el puesto de quien pregunta ya decidió (aprobó, devolvió, anuló, dio el visto, cerró o reabrió) entre dos fechas de Lima, con el código interno y sin montos. El nombre de la OC sale de nombre_de_oc. Exige cotizaciones.revisar o codigos_internos.cerrar, como «Por decidir». Plan 12, entrega 12.2.';

revoke all on function public.decisiones_tomadas(date, date) from public, anon;
grant execute on function public.decisiones_tomadas(date, date) to authenticated;
