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
--    cuenta. Ninguna pantalla lo usa: queda para quien ve el precio de venta.
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
                             'trabajador_cuentas', 'usuarios'])
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
