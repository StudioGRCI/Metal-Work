-- =============================================================================
-- LAS PUERTAS QUE QUEDABAN ABIERTAS
-- -----------------------------------------------------------------------------
-- DKS pidió el 2026-10-20 una revisión completa del sistema antes de usarlo de
-- verdad: «que no haya clavos sueltos, la idea es que se pruebe todo». Los
-- auditores de permisos y de formatos encontraron, en la base, siete puertas
-- que la pantalla no ofrece pero que la API deja abiertas:
--
-- 1. Una OT numerada se podía borrar (el administrador, por la API), y con ella
--    en cascada su acta de conformidad, su bitácora y el registro de su PDF. Lo
--    mismo el acta sola. CLAUDE.md lo prohíbe «ni por el administrador»: el
--    hueco en la serie no lo explica nadie después. Desde aquí la OT y el acta
--    no se borran nunca; se anulan.
-- 2. Una cotización aprobada o anulada se podía borrar como administrador. La
--    anulada «queda como evidencia» y la aprobada ya fue papel firmado.
-- 3. La constancia de que Tesorería liberó la salida de una unidad se podía
--    borrar por la API, aunque ninguna pantalla lo hace.
-- 4. Cualquier cuenta activa lee el costo por hora y el DNI de todas las demás
--    (`usuarios`). Eso NO se cierra aquí: quitar esas dos columnas con permisos
--    por columna rompe `puesto(usuarios)`, la columna calculada que usan la
--    lista y el detalle de la OT, el tablero y una docena de vistas (recibe la
--    fila entera, y la fila entera exige leer todas las columnas). Probado en
--    el banco: «permission denied for table usuarios» en Órdenes para todos
--    los puestos. Cerrarlo pide mover esas dos columnas a una tabla aparte, y
--    eso toca el costeo de mano de obra: queda para quien lleva el costeo.
-- 5. La auditoría (`audit_log`) copia la fila entera de cada tabla auditada, y
--    Gerencia la lee con `auditoria.ver`: veía ahí los sueldos, los costos, las
--    cuentas bancarias y las planillas de cada trabajador que RR. HH. le tapa en
--    sus tablas, y el monto de venta de las cotizaciones a quien no lo ve. La
--    caja ya se había tapado así (migración 20261019100000); ahora RR. HH. y
--    las cotizaciones también.
-- 6. Las firmas viejas de `emitir_compra_directa` y `emitir_compra_agrupada`,
--    sin código interno, seguían ejecutables: emitían una OC sin la validación
--    de la firma nueva. La aplicación ya solo llama a las nuevas.
-- 7. Una foto de avance se podía borrar del almacenamiento aunque un reporte ya
--    aprobado la nombre: la fila quedaba apuntando a un archivo que no existe.
--
-- Y dos reglas de datos:
--
-- 8. El correlativo de la OT es global y continuo (ANALISIS-ONEDRIVE §2): no se
--    reinicia cada año. Comparar el número completo dejaba entrar `2922-2025`
--    junto a `2922-2026`.
-- 9. El precio referencial del catálogo de carrocerías lo leía cualquier
--    cuenta. Ninguna pantalla lo usa: ya no lo lee ninguna cuenta (solo las
--    funciones del sistema). OJO: la tabla queda con permiso por columna, así
--    que una columna nueva de `tipos_carroceria` no se lee hasta que se le dé
--    su `grant select (columna)` (está en la skill `esquema` › Trampas).
--
-- Y dos que los checks destaparon rotas desde la migración 20260927234131:
--
-- 10. `datos_de_empresa()` fallaba siempre («column e.firma_nombre does not
--     exist»): la firma se fue de `empresa`. Devuelve lo demás.
-- 11. El historial de la venta anterior (`ot_ventas_anteriores`) pedía
--     `cotizaciones.ver`, un permiso que ya no existe: solo lo leía ADMIN.
--     Ahora lo lee quien ve el precio de venta.
-- 12. El cronograma de la OT (`v_cronograma_ot`) y el tablero (`unidad_tablero`)
--     unían las etapas al catálogo con un INNER JOIN: desde la migración
--     20260928135000 las etapas que define Diseño no tienen etapa del catálogo,
--     y no salían (el cronograma daba 0 de 3). Ahora toman el nombre y el área
--     de la etapa misma, y del catálogo solo si la etapa no los trae. Ninguna
--     pantalla las lee hoy; los checks 95 y 100 sí.
--
-- Más los dos índices que vigila el check 190: `asistencias.trabajador_id` y
-- `tareos.trabajador_id` solo estaban cubiertas por índices parciales, que la
-- integridad referencial no puede usar (criterio (a) de la skill `datos`).
--
-- Todo es aditivo: no borra ni cambia ningún dato.
-- =============================================================================

-- ---------------------------------------------- 1. la OT y el acta no se borran
create or replace function public.fn_documento_numerado_no_se_borra()
returns trigger language plpgsql set search_path to 'public'
as $$
begin
  if tg_table_name = 'ordenes_trabajo' then
    raise exception 'La OT % no se borra: se anula, con su motivo, y queda como evidencia.', old.numero
      using errcode = 'check_violation';
  elsif tg_table_name = 'ot_entregas' then
    raise exception 'El acta de conformidad no se borra: queda como evidencia de la entrega.'
      using errcode = 'check_violation';
  elsif tg_table_name = 'liberaciones_tesoreria' then
    raise exception 'La liberación de Tesorería no se borra: es la constancia de que la unidad podía salir.'
      using errcode = 'check_violation';
  elsif tg_table_name = 'cotizaciones_pdf' then
    if old.estado in ('APROBADA', 'ANULADA') then
      raise exception 'La cotización % no se quita: está %, y queda como evidencia.', old.numero, lower(old.estado::text)
        using errcode = 'check_violation';
    end if;
  end if;
  return old;
end;
$$;
revoke all on function public.fn_documento_numerado_no_se_borra() from public, anon, authenticated;

-- `pruebas_limpiar` apaga los disparadores BEFORE DELETE de las tablas de su
-- lote mientras limpia (migración 105): lo que un lote de prueba creó se sigue
-- llevando. Para nadie más hay borrado.
create or replace trigger trg_ot_no_se_borra
  before delete on public.ordenes_trabajo
  for each row execute function public.fn_documento_numerado_no_se_borra();
create or replace trigger trg_acta_no_se_borra
  before delete on public.ot_entregas
  for each row execute function public.fn_documento_numerado_no_se_borra();
create or replace trigger trg_liberacion_no_se_borra
  before delete on public.liberaciones_tesoreria
  for each row execute function public.fn_documento_numerado_no_se_borra();
create or replace trigger trg_cotizacion_pdf_firmada_no_se_borra
  before delete on public.cotizaciones_pdf
  for each row execute function public.fn_documento_numerado_no_se_borra();

-- Y la puerta cerrada también por permisos: ninguna pantalla borra estas filas.
-- La cotización por revisar o rechazada sí la sigue quitando quien la subió
-- (migración 102), así que esa tabla conserva su permiso.
revoke delete on public.ordenes_trabajo, public.ot_entregas, public.liberaciones_tesoreria
  from authenticated;

-- ----------------------------------------- 5. la auditoría no destapa lo tapado
alter policy ver_audit_log on public.audit_log using (
  public.es_admin() or (
    public.tiene_permiso('auditoria.ver')
    and (tabla <> all (array['cajas', 'movimientos_caja', 'cierres_caja'])
         or public.tiene_permiso('tesoreria.caja'))
    and (tabla <> all (array['trabajador_remuneraciones', 'trabajador_costos', 'tareos',
                             'trabajador_cuentas'])
         or public.tiene_permiso('rrhh.personal'))
    and (tabla <> all (array['planillas', 'planilla_personas', 'planilla_distribuciones'])
         or public.tiene_permiso('rrhh.ver_planillas'))
    and (tabla <> all (array['cotizaciones_pdf', 'cotizaciones_pdf_versiones', 'cotizaciones_pdf_igv'])
         or public.tiene_permiso('cotizaciones.ver_pdf_comercial'))
  )
);

-- ------------------------------------------ 6. las firmas viejas de la compra
do $$
begin
  if to_regprocedure('public.emitir_compra_directa(uuid,uuid,text,text,jsonb,date,text,integer,text)') is not null then
    revoke execute on function public.emitir_compra_directa(uuid,uuid,text,text,jsonb,date,text,integer,text)
      from public, anon, authenticated;
  end if;
  if to_regprocedure('public.emitir_compra_agrupada(uuid,uuid,text,jsonb,date,text,integer,text)') is not null then
    revoke execute on function public.emitir_compra_agrupada(uuid,uuid,text,jsonb,date,text,integer,text)
      from public, anon, authenticated;
  end if;
end;
$$;

-- ------------------------------------------ 7. la foto de un avance se queda
alter policy mw_borrar_fotos_avance on storage.objects using (
  bucket_id = 'fotos-avance'
  and (public.es_admin() or public.tiene_permiso('produccion.cualquier_area')
       or owner_id = (auth.uid())::text)
  and not exists (select 1 from public.ot_avance_fotos f where f.ruta_storage = objects.name)
  and not exists (select 1 from public.flota_avance_fotos f where f.ruta_storage = objects.name)
  and not exists (select 1 from public.ot_actividad_avances a where a.foto_ruta = objects.name)
);

-- --------------------------------------- 8. el correlativo de la OT no se repite
create or replace function public.fn_ot_correlativo_unico()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
declare
  v_otra text;
begin
  if new.numero !~ '^[0-9]+-[0-9]{4}$' then
    return new;
  end if;
  select o.numero into v_otra
    from public.ordenes_trabajo o
   where o.id <> new.id
     and o.numero ~ '^[0-9]+-[0-9]{4}$'
     and split_part(o.numero, '-', 1)::bigint = split_part(new.numero, '-', 1)::bigint
   limit 1;
  if v_otra is not null then
    raise exception 'Ya hay una OT con el correlativo %: la %. El número de OT no se reinicia cada año.',
      split_part(new.numero, '-', 1), v_otra
      using errcode = 'unique_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_ot_correlativo_unico() from public, anon, authenticated;
create or replace trigger trg_ot_correlativo_unico
  before insert or update of numero on public.ordenes_trabajo
  for each row execute function public.fn_ot_correlativo_unico();

-- ------------------------------------- 9. el precio referencial de la carrocería
do $$
declare
  v_columnas text;
begin
  select string_agg(quote_ident(attname), ', ' order by attnum) into v_columnas
    from pg_attribute
   where attrelid = 'public.tipos_carroceria'::regclass and attnum > 0 and not attisdropped
     and attname not in ('precio_referencial', 'moneda_referencial');
  execute 'revoke select on public.tipos_carroceria from authenticated';
  execute format('grant select (%s) on public.tipos_carroceria to authenticated', v_columnas);
end;
$$;

-- ------------------------------------------------ los índices del check 190
create index if not exists ix_asistencias_trabajador on public.asistencias (trabajador_id);
create index if not exists ix_tareos_trabajador on public.tareos (trabajador_id);

-- ------------------------------------------- 10. los datos de la empresa
create or replace function public.datos_de_empresa()
returns table (razon_social text, nombre_comercial text, ruc text, direccion text, distrito text,
               provincia text, departamento text, telefono text, correo text, web text,
               gerente_general text, gerente_general_cargo text)
language plpgsql stable security definer set search_path to 'public'
as $$
begin
  if not public.es_usuario_activo() then
    raise exception 'Tu cuenta no está activa.' using errcode = 'insufficient_privilege';
  end if;
  -- La firma ya no vive en `empresa`: esas dos columnas salen vacías.
  return query
  select e.razon_social, e.nombre_comercial, e.ruc::text, e.direccion,
         e.distrito, e.provincia, e.departamento, e.telefono,
         e.correo::text, e.web, null::text, null::text
    from public.empresa e
   order by e.creado_en
   limit 1;
end;
$$;

-- --------------------------------------- 11. el historial de la venta anterior
alter policy ver_ventas_anteriores on public.ot_ventas_anteriores using (
  public.puede_ver_orden(orden_id)
  and (public.es_admin() or public.tiene_permiso('cotizaciones.ver_pdf_comercial'))
);

-- ------------------------------------- 12. las etapas libres en el cronograma
create or replace view public.v_cronograma_ot with (security_invoker = true) as
 SELECT oe.id AS etapa_id,
    oe.orden_id,
    ec.codigo AS etapa_codigo,
    COALESCE(oe.nombre, ec.nombre) AS etapa,
    ec.color,
    oe.orden_secuencia,
    a.codigo AS area_codigo,
    a.nombre AS area_nombre,
    oe.estado,
    oe.avance_porcentaje,
    oe.fecha_inicio_programada,
    oe.fecha_fin_programada,
    oe.fecha_inicio_real,
    oe.fecha_fin_real,
    (oe.fecha_fin_programada - CURRENT_DATE) AS dias,
    estado_del_plazo(oe.fecha_fin_programada, oe.fecha_fin_real) AS plazo,
    r.texto AS ultimo_reporte,
    r.creado_en AS ultimo_reporte_en
   FROM (((ot_etapas oe
     LEFT JOIN etapas_catalogo ec ON ((ec.id = oe.etapa_catalogo_id)))
     LEFT JOIN areas a ON ((a.id = COALESCE(oe.area_id, ec.area_id))))
     LEFT JOIN LATERAL ( SELECT rr.texto,
            rr.creado_en
           FROM ot_etapa_reportes rr
          WHERE (rr.etapa_id = oe.id)
          ORDER BY rr.creado_en DESC
         LIMIT 1) r ON (true))
  WHERE (oe.estado <> 'OMITIDA'::estado_etapa_ot);

create or replace view public.unidad_tablero with (security_invoker = on) as
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
    puesto_de(o.responsable_id) AS responsable,
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
     LEFT JOIN LATERAL ( SELECT COALESCE(oe.nombre, ec.nombre) AS etapa,
            oe.estado AS estado_etapa,
            oe.avance_porcentaje AS avance_etapa
           FROM (ot_etapas oe
             LEFT JOIN etapas_catalogo ec ON ((ec.id = oe.etapa_catalogo_id)))
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
