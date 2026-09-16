-- =============================================================================
-- LAS PANTALLAS DICEN EL PUESTO, NO EL NOMBRE
-- -----------------------------------------------------------------------------
-- «Quita los nombres de los perfiles, solo pon el puesto, nada más.»
--
-- Las cuentas del sistema son por puesto —ventas@, gerencia@, diseno@—, y lo
-- que importa al leer «quién aprobó», «quién reportó» o «quién resolvió» es
-- desde qué puesto se hizo, no cómo se llama la persona que ese día tenía la
-- cuenta. Cuando cambie la persona, el registro sigue diciendo lo mismo.
--
-- Lo que se hace:
--
--   1. `puesto(usuarios)` y `puesto_de(uuid)`: el cargo de la cuenta, y si no
--      lo tiene, el nombre de su rol. Una sola definición para la base y para
--      PostgREST, que la expone como columna calculada (`usuarios(puesto)`).
--   2. Dos cargos que eran descripciones y no puestos se corrigen:
--      «Cotización de trabajo y órdenes» → «Administración» e
--      «Ingeniería y planos» → «Diseño».
--   3. Las nueve vistas que concatenaban nombre y apellido pasan a dar el
--      puesto. Conservan sus columnas (`registrado_por_nombre`, `responsable`…)
--      para que ninguna pantalla cambie su consulta.
--   4. Los dos avisos que decían «Karina subió la…» dicen «Ventas subió la…».
--
-- La base sigue guardando qué cuenta hizo cada cosa (`registrado_por`,
-- `revisado_por`…): esto solo cambia lo que se muestra. Los avisos ya enviados
-- con nombre no se reescriben: son historia. El módulo Personal, que da de alta
-- las cuentas, y el PDF de la cotización que se le manda al cliente, siguen
-- con nombre y apellido.
-- =============================================================================

-- =============================================================================
-- 1. EL PUESTO DE UNA CUENTA
-- =============================================================================
create or replace function public.puesto(u public.usuarios)
returns text
language sql
stable
set search_path to 'public'
as $$
  select coalesce(nullif(btrim(u.cargo), ''), (select r.nombre from public.roles r where r.id = u.rol_id));
$$;

comment on function public.puesto(public.usuarios) is
  'El puesto con el que se muestra una cuenta: su cargo, y si no lo tiene, el nombre de su rol. PostgREST la expone como columna calculada de usuarios.';

create or replace function public.puesto_de(p_usuario uuid)
returns text
language sql
stable
set search_path to 'public'
as $$
  select public.puesto(u) from public.usuarios u where u.id = p_usuario;
$$;

comment on function public.puesto_de(uuid) is
  'El puesto de la cuenta con ese identificador, para vistas y avisos. NULL si no existe.';

revoke all on function public.puesto(public.usuarios) from public, anon;
revoke all on function public.puesto_de(uuid) from public, anon;
grant execute on function public.puesto(public.usuarios) to authenticated;
grant execute on function public.puesto_de(uuid) to authenticated;

-- =============================================================================
-- 2. DOS CARGOS QUE NO ERAN PUESTOS
-- =============================================================================
update public.usuarios set cargo = 'Administración' where cargo = 'Cotización de trabajo y órdenes';
update public.usuarios set cargo = 'Diseño' where cargo = 'Ingeniería y planos';

-- =============================================================================
-- 3. LAS VISTAS: MISMAS COLUMNAS, OTRO TEXTO
-- =============================================================================
create or replace view public.ot_avance_resumen as
 SELECT a.id,
    a.orden_id,
    o.numero AS orden_numero,
    o.estado AS orden_estado,
    c.razon_social AS cliente,
    COALESCE((u.placa)::text, ('FMI '::text || u.numero_fmi)) AS placa,
    a.etapa_id,
    e.nombre AS etapa,
    a.fecha,
    a.descripcion,
    a.avance_porcentaje,
    a.impedimento,
    a.registrado_por,
    public.puesto_de(a.registrado_por) AS registrado_por_nombre,
    a.creado_en,
    COALESCE(f.fotos, 0) AS fotos,
    (a.revision)::text AS revision,
    a.observacion,
    a.revisado_en,
    public.puesto_de(a.revisado_por) AS revisado_por_nombre,
    a.corregido_en
   FROM ((((((ot_avances a
     JOIN ordenes_trabajo o ON ((o.id = a.orden_id)))
     LEFT JOIN clientes c ON ((c.id = o.cliente_id)))
     LEFT JOIN unidades u ON ((u.id = o.unidad_id)))
     LEFT JOIN ot_etapas oe ON ((oe.id = a.etapa_id)))
     LEFT JOIN etapas_catalogo e ON ((e.id = oe.etapa_catalogo_id)))
     LEFT JOIN LATERAL ( SELECT (count(*))::integer AS fotos
           FROM ot_avance_fotos ff
          WHERE (ff.avance_id = a.id)) f ON (true));

create or replace view public.ot_resumen as
 SELECT o.id,
    o.numero,
    o.estado,
    o.prioridad,
    o.tipo_trabajo,
    o.sede_id,
    s.nombre AS sede,
    o.cliente_id,
    c.razon_social AS cliente,
    c.numero_documento AS cliente_documento,
    o.unidad_id,
    COALESCE((u.placa)::text, ('FMI '::text || u.numero_fmi)) AS placa,
    tc.nombre AS tipo_carroceria,
    o.descripcion,
    o.fecha_registro,
    o.fecha_inicio_programada,
    o.fecha_fin_programada,
    o.fecha_entrega_comprometida,
    o.fecha_inicio_real,
    o.fecha_fin_real,
    o.avance_porcentaje,
    o.horas_estimadas,
    o.horas_reales,
    ((o.horas_reales)::numeric - (o.horas_estimadas)::numeric) AS desviacion_horas,
    o.moneda,
    o.monto_presupuestado,
    o.responsable_id,
    public.puesto_de(o.responsable_id) AS responsable,
    count(e.id) AS etapas_total,
    count(e.id) FILTER (WHERE (e.estado = 'TERMINADA'::estado_etapa_ot)) AS etapas_terminadas,
    count(e.id) FILTER (WHERE (e.estado = 'EN_PROCESO'::estado_etapa_ot)) AS etapas_en_proceso,
        CASE
            WHEN (o.estado = ANY (ARRAY['ENTREGADA'::estado_ot, 'FACTURADA'::estado_ot, 'ANULADA'::estado_ot])) THEN 0
            WHEN (o.fecha_entrega_comprometida IS NULL) THEN 0
            ELSE GREATEST((CURRENT_DATE - o.fecha_entrega_comprometida), 0)
        END AS dias_atraso,
        CASE
            WHEN (o.estado = ANY (ARRAY['ENTREGADA'::estado_ot, 'FACTURADA'::estado_ot, 'ANULADA'::estado_ot])) THEN NULL::integer
            WHEN (o.fecha_entrega_comprometida IS NULL) THEN NULL::integer
            ELSE dias_habiles_entre(CURRENT_DATE, o.fecha_entrega_comprometida)
        END AS dias_habiles_restantes,
    u.codigo_interno,
    u.numero_chasis,
    u.marca,
    u.modelo,
    o.abierta_en_taller
   FROM (((((ordenes_trabajo o
     LEFT JOIN clientes c ON ((c.id = o.cliente_id)))
     LEFT JOIN sedes s ON ((s.id = o.sede_id)))
     LEFT JOIN unidades u ON ((u.id = o.unidad_id)))
     LEFT JOIN tipos_carroceria tc ON ((tc.id = o.tipo_carroceria_id)))
     LEFT JOIN ot_etapas e ON ((e.orden_id = o.id)))
  GROUP BY o.id, c.id, s.id, u.id, tc.id;

create or replace view public.unidad_tablero as
 SELECT o.id AS orden_id,
    o.numero AS orden_numero,
    o.estado AS orden_estado,
    o.prioridad,
    o.sede_id,
    o.unidad_id,
    COALESCE((u.placa)::text, ('FMI '::text || u.numero_fmi)) AS placa,
    u.tipo_vehiculo,
    u.marca,
    u.modelo,
    c.id AS cliente_id,
    c.razon_social AS cliente,
    tc.nombre AS tipo_carroceria,
    o.descripcion,
    o.avance_porcentaje,
    o.fecha_entrega_comprometida,
    dias_habiles_entre(CURRENT_DATE, o.fecha_entrega_comprometida) AS dias_habiles_restantes,
    public.puesto_de(o.responsable_id) AS responsable,
    actual.etapa AS etapa_actual,
    actual.estado_etapa,
    actual.avance_etapa,
    ultimo.fecha AS ultimo_avance_fecha,
    ultimo.descripcion AS ultimo_avance,
    (CURRENT_DATE - ultimo.fecha) AS dias_sin_avance,
    ultimo.impedimento,
    COALESCE(fotos.total, 0) AS fotos,
    o.abierta_en_taller
   FROM ((((((ordenes_trabajo o
     LEFT JOIN clientes c ON ((c.id = o.cliente_id)))
     LEFT JOIN unidades u ON ((u.id = o.unidad_id)))
     LEFT JOIN tipos_carroceria tc ON ((tc.id = o.tipo_carroceria_id)))
     LEFT JOIN LATERAL ( SELECT ec.nombre AS etapa,
            oe.estado AS estado_etapa,
            oe.avance_porcentaje AS avance_etapa
           FROM (ot_etapas oe
             JOIN etapas_catalogo ec ON ((ec.id = oe.etapa_catalogo_id)))
          WHERE ((oe.orden_id = o.id) AND (oe.estado = ANY (ARRAY['EN_PROCESO'::estado_etapa_ot, 'PENDIENTE'::estado_etapa_ot])))
          ORDER BY (oe.estado = 'EN_PROCESO'::estado_etapa_ot) DESC, oe.orden_secuencia
         LIMIT 1) actual ON (true))
     LEFT JOIN LATERAL ( SELECT a.fecha,
            a.descripcion,
            a.impedimento
           FROM ot_avances a
          WHERE (a.orden_id = o.id)
          ORDER BY a.fecha DESC, a.creado_en DESC
         LIMIT 1) ultimo ON (true))
     LEFT JOIN LATERAL ( SELECT (count(*))::integer AS total
           FROM (ot_avances a
             JOIN ot_avance_fotos f ON ((f.avance_id = a.id)))
          WHERE (a.orden_id = o.id)) fotos ON (true))
  WHERE ((o.estado = ANY (ARRAY['APROBADA'::estado_ot, 'PROGRAMADA'::estado_ot, 'EN_PROCESO'::estado_ot, 'PAUSADA'::estado_ot, 'CONTROL_CALIDAD'::estado_ot, 'TERMINADA'::estado_ot])) OR ((o.estado = 'BORRADOR'::estado_ot) AND o.abierta_en_taller));

create or replace view public.v_cotizaciones_pdf as
 SELECT c.id,
    c.numero,
    (c.estado)::text AS estado,
    c.observacion,
    c.cliente_id,
    cl.razon_social AS cliente,
    c.tipo_carroceria_id,
    tc.nombre AS carroceria,
    c.nombre_archivo,
    c.ruta_storage,
    c.tamano_bytes,
    c.creado_en,
    c.registrado_por,
    public.puesto_de(c.registrado_por) AS registrado_por_nombre,
    c.revisado_en,
    public.puesto_de(c.revisado_por) AS revisado_por_nombre,
    o.id AS orden_id,
    o.numero AS orden_numero,
    (o.estado)::text AS orden_estado,
    (EXISTS ( SELECT 1
           FROM ordenes_trabajo t
          WHERE (t.cotizacion_pdf_id = c.id))) AS tuvo_orden,
    c.version,
    c.mime_type,
    c.archivo_subido_en
   FROM (((cotizaciones_pdf c
     LEFT JOIN clientes cl ON ((cl.id = c.cliente_id)))
     LEFT JOIN tipos_carroceria tc ON ((tc.id = c.tipo_carroceria_id)))
     LEFT JOIN LATERAL ( SELECT o_1.id,
            o_1.numero,
            o_1.estado
           FROM ordenes_trabajo o_1
          WHERE ((o_1.cotizacion_pdf_id = c.id) AND (o_1.estado <> 'ANULADA'::estado_ot))
         LIMIT 1) o ON (true));

create or replace view public.v_cotizaciones_pdf_versiones as
 SELECT v.id,
    v.cotizacion_id,
    v.version,
    v.nombre_archivo,
    v.ruta_storage,
    v.mime_type,
    v.tamano_bytes,
    v.subido_en,
    v.observacion,
    v.rechazado_en,
    public.puesto_de(v.rechazado_por) AS rechazado_por_nombre
   FROM cotizaciones_pdf_versiones v;

create or replace view public.v_flota_avance_diario as
 SELECT a.id,
    a.flota_id,
    a.fecha,
    a.descripcion,
    a.avance_porcentaje,
    a.impedimento,
    a.creado_en,
    a.area_id,
    ar.codigo AS area_codigo,
    ar.nombre AS area,
    f.placa,
    f.descripcion AS unidad,
    f.cliente,
    f.trabajo,
    (f.estado)::text AS estado,
    a.registrado_por,
    public.puesto_de(a.registrado_por) AS registrado_por_nombre,
    COALESCE(fotos.total, 0) AS fotos,
    (a.revision)::text AS revision,
    a.observacion,
    a.revisado_en,
    public.puesto_de(a.revisado_por) AS revisado_por_nombre,
    a.corregido_en
   FROM (((flota_avances a
     JOIN flota_unidades f ON ((f.id = a.flota_id)))
     JOIN areas ar ON ((ar.id = a.area_id)))
     LEFT JOIN LATERAL ( SELECT (count(*))::integer AS total
           FROM flota_avance_fotos ff
          WHERE (ff.avance_id = a.id)) fotos ON (true));

create or replace view public.v_flota_unidades as
 SELECT f.id,
    f.placa,
    f.placa_clave,
    f.descripcion,
    f.cliente,
    f.trajo,
    f.trabajo,
    (f.estado)::text AS estado,
    f.ingreso,
    ((f.ingreso AT TIME ZONE 'America/Lima'::text))::date AS ingreso_fecha,
    f.lista_en,
    f.salio_en,
    f.retiro,
    f.sede_id,
    f.registrado_por,
    public.puesto_de(f.registrado_por) AS registrado_por_nombre,
    ultimo.fecha AS ultimo_avance_fecha,
    ultimo.descripcion AS ultimo_avance,
    ultimo.area_id AS area_actual_id,
    ultimo.area AS area_actual,
    ultimo.avance_porcentaje,
    (CURRENT_DATE - COALESCE(ultimo.fecha, ((f.ingreso AT TIME ZONE 'America/Lima'::text))::date)) AS dias_sin_avance,
    (CURRENT_DATE - ((f.ingreso AT TIME ZONE 'America/Lima'::text))::date) AS dias_en_taller,
    ultimo.impedimento,
    COALESCE(fotos.total, 0) AS fotos,
    COALESCE(reportes.total, 0) AS reportes
   FROM (((flota_unidades f
     LEFT JOIN LATERAL ( SELECT a.fecha,
            a.descripcion,
            a.avance_porcentaje,
            a.impedimento,
            a.area_id,
            ar.nombre AS area
           FROM (flota_avances a
             JOIN areas ar ON ((ar.id = a.area_id)))
          WHERE (a.flota_id = f.id)
          ORDER BY a.fecha DESC, a.creado_en DESC
         LIMIT 1) ultimo ON (true))
     LEFT JOIN LATERAL ( SELECT (count(*))::integer AS total
           FROM (flota_avances a
             JOIN flota_avance_fotos ff ON ((ff.avance_id = a.id)))
          WHERE (a.flota_id = f.id)) fotos ON (true))
     LEFT JOIN LATERAL ( SELECT (count(*))::integer AS total
           FROM flota_avances a
          WHERE (a.flota_id = f.id)) reportes ON (true));

create or replace view public.v_ot_avance_diario as
 SELECT av.id,
    av.fecha,
    av.avance_pct,
    av.nota,
    av.creado_en,
    a.id AS actividad_id,
    a.nombre AS actividad,
    a.referencia,
    a.peso_pct,
    ar.id AS area_id,
    ar.codigo AS area_codigo,
    ar.nombre AS area,
    o.id AS orden_id,
    o.numero AS orden_numero,
    (o.estado)::text AS orden_estado,
    o.descripcion AS orden_descripcion,
    av.reportado_por,
    public.puesto_de(av.reportado_por) AS reportado_por_nombre,
    ( SELECT sum(x.avance_pct) AS sum
           FROM ot_actividad_avances x
          WHERE (x.actividad_id = a.id)) AS acumulado_pct,
    (av.revision)::text AS revision,
    av.observacion,
    av.revisado_en,
    public.puesto_de(av.revisado_por) AS revisado_por_nombre,
    av.corregido_en
   FROM (((ot_actividad_avances av
     JOIN ot_actividades a ON ((a.id = av.actividad_id)))
     JOIN areas ar ON ((ar.id = a.area_id)))
     JOIN ordenes_trabajo o ON ((o.id = a.orden_id)));

create or replace view public.v_ot_observaciones as
 SELECT ob.id,
    ob.orden_id,
    ob.area_id,
    ar.codigo AS area_codigo,
    ar.nombre AS area,
    ob.descripcion,
    ob.registrado_por,
    public.puesto_de(ob.registrado_por) AS registrado_por_nombre,
    ob.creado_en,
    ob.resolucion,
    ob.resuelta_por,
    public.puesto_de(ob.resuelta_por) AS resuelta_por_nombre,
    ob.resuelta_en,
    (ob.resuelta_en IS NULL) AS abierta
   FROM (ot_observaciones ob
     JOIN areas ar ON ((ar.id = ob.area_id)));

-- Las vistas corren como quien mira, y así se quedan.
alter view public.ot_avance_resumen set (security_invoker = on);
alter view public.ot_resumen set (security_invoker = on);
alter view public.unidad_tablero set (security_invoker = on);
alter view public.v_cotizaciones_pdf set (security_invoker = on);
alter view public.v_cotizaciones_pdf_versiones set (security_invoker = on);
alter view public.v_flota_avance_diario set (security_invoker = on);
alter view public.v_flota_unidades set (security_invoker = on);
alter view public.v_ot_avance_diario set (security_invoker = on);
alter view public.v_ot_observaciones set (security_invoker = on);

-- =============================================================================
-- 4. LOS AVISOS DICEN EL PUESTO
-- -----------------------------------------------------------------------------
-- Definiciones vivas al 2026-09-15; cambia solo de dónde sale «quién».
-- =============================================================================
create or replace function public.abrir_orden_del_taller(
  p_placa text,
  p_tipo_vehiculo public.tipo_vehiculo,
  p_marca text,
  p_modelo text,
  p_trabajo text,
  p_tipo_trabajo public.tipo_trabajo_ot default 'REPARACION',
  p_prioridad public.prioridad_ot default 'NORMAL')
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_clave   constant text := upper(regexp_replace(coalesce(p_placa, ''), '[^A-Za-z0-9]', '', 'g'));
  v_placa   text;
  v_unidad  uuid;
  v_cliente uuid;
  v_nombre  text;
  v_abierta text;
  v_sede    uuid;
  v_orden   uuid;
  v_numero  text;
  v_quien   text;
begin
  if public.usuario_actual() is null then
    raise exception 'Hace falta entrar con tu cuenta para abrir una orden.'
      using errcode = 'insufficient_privilege';
  end if;
  perform public.exigir_permiso('ordenes.abrir_taller');

  if length(btrim(coalesce(p_trabajo, ''))) < 5 then
    raise exception 'Cuenta qué se va a hacer.' using errcode = 'check_violation';
  end if;
  if v_clave = '' and nullif(btrim(p_marca), '') is null and nullif(btrim(p_modelo), '') is null then
    raise exception 'Escribe la placa, o la marca y el modelo si todavía no tiene.'
      using errcode = 'check_violation';
  end if;

  -- «abc123» y «ABC-123» son la misma placa: se busca sin guiones ni espacios
  -- entre todas las unidades, y la que se registra queda con el guion de siempre.
  if v_clave <> '' then
    v_placa := case when length(v_clave) = 6 and position('-' in p_placa) = 0
                    then left(v_clave, 3) || '-' || right(v_clave, 3)
                    else upper(btrim(p_placa)) end;

    select u.id, u.cliente_id into v_unidad, v_cliente
      from public.unidades u
     where (upper(regexp_replace(coalesce(u.placa, ''), '[^A-Za-z0-9]', '', 'g')) = v_clave
             or upper(regexp_replace(coalesce(u.numero_fmi, ''), '[^A-Za-z0-9]', '', 'g')) = v_clave)
     order by u.activo desc, u.creado_en desc
     limit 1;
  end if;

  -- Una orden abierta por unidad: si ya está en el taller, se trabaja en esa.
  if v_unidad is not null then
    select o.numero into v_abierta
      from public.ordenes_trabajo o
     where o.unidad_id = v_unidad
       and o.estado not in ('ENTREGADA', 'FACTURADA', 'ANULADA')
     order by o.creado_en desc
     limit 1;
    if v_abierta is not null then
      raise exception 'La unidad % ya tiene la orden % abierta: repórtala ahí.', v_placa, v_abierta
        using errcode = 'unique_violation';
    end if;
  else
    insert into public.unidades (cliente_id, placa, tipo_vehiculo, marca, modelo)
    values (null, v_placa, coalesce(p_tipo_vehiculo, 'OTRO'),
            nullif(btrim(p_marca), ''), nullif(btrim(p_modelo), ''))
    returning id into v_unidad;
  end if;

  v_sede := coalesce(public.mi_sede(),
                     (select s.id from public.sedes s where s.activo order by s.nombre limit 1));

  insert into public.ordenes_trabajo (
    cliente_id, unidad_id, sede_id, tipo_trabajo, prioridad, descripcion,
    estado, abierta_en_taller)
  values (
    v_cliente, v_unidad, v_sede, coalesce(p_tipo_trabajo, 'REPARACION'), coalesce(p_prioridad, 'NORMAL'),
    btrim(p_trabajo), 'BORRADOR', true)
  returning id, numero into v_orden, v_numero;

  v_quien := public.puesto_de(public.usuario_actual());

  v_nombre := coalesce(v_placa, nullif(btrim(concat_ws(' ', nullif(btrim(p_marca), ''), nullif(btrim(p_modelo), ''))), ''));

  perform public.notificar_a_permiso(
    'ordenes.revisar_taller',
    'Orden por revisar',
    format('%s abrió la %s (%s): %s', coalesce(v_quien, 'El taller'), v_numero,
           coalesce(v_nombre, 'sin placa'), left(btrim(p_trabajo), 140)),
    '/ordenes/' || v_orden,
    'ordenes_trabajo',
    v_orden,
    public.usuario_actual());

  return v_orden;
end;
$function$;

create or replace function public.fn_cotizacion_pdf_avisa()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cliente text;
  v_quien   text;
begin
  select c.razon_social into v_cliente from public.clientes c where c.id = new.cliente_id;
  v_quien := public.puesto_de(new.registrado_por);

  if tg_op = 'INSERT' then
    perform public.notificar_a_permiso(
      'cotizaciones.revisar',
      'Cotización por revisar',
      format('%s subió la %s de %s.', coalesce(v_quien, 'Ventas'), new.numero, coalesce(v_cliente, 'un cliente')),
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

  perform public.notificar_a_usuario(
    new.registrado_por,
    case when new.estado = 'APROBADA' then 'Gerencia aprobó tu cotización' else 'Gerencia rechazó tu cotización' end,
    case when new.estado = 'APROBADA'
         then format('La %s de %s: Administración ya puede emitir la orden.', new.numero, coalesce(v_cliente, 'un cliente'))
         else format('La %s: %s. Corrígela y sube la corrección.', new.numero, coalesce(new.observacion, 'sin motivo')) end,
    '/cotizaciones/pdf', 'cotizaciones_pdf', new.id, public.usuario_actual());

  if new.estado = 'APROBADA' then
    perform public.notificar_a_permiso(
      'ordenes.crear',
      'Cotización aprobada: falta la OT',
      format('La %s de %s ya está aprobada: emite la orden de trabajo.', new.numero, coalesce(v_cliente, 'un cliente')),
      '/cotizaciones/pdf', 'cotizaciones_pdf', new.id, public.usuario_actual());
  end if;

  return null;
end;
$function$;
