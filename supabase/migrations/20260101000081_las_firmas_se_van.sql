-- =============================================================================
-- LAS FIRMAS SE VAN
-- -----------------------------------------------------------------------------
-- El circuito de firma de documentos —pedir la firma, firmar en cadena, la
-- bandeja de «lo que espera tu firma»— sale del sistema por decisión del
-- cliente. En el taller la conformidad se da en el papel; el sistema guarda el
-- documento, no la firma.
--
-- Se va entero y de una vez, porque a medias es peor: una tabla de firmas que
-- nadie alimenta deja documentos «esperando» para siempre y, sobre todo, deja a
-- `documentos_obligatorios_faltantes` exigiendo una aprobación que ya nadie
-- puede dar —y esa función es la que decide si una orden se puede cerrar—.
-- Ahí, el circuito muerto no sería una pantalla de menos: sería una orden que
-- no cierra y nadie sabe por qué.
--
-- La tabla `aprobaciones` está vacía (0 filas al 2026-09-04), así que no se
-- pierde ninguna firma dada. Lo que hubo antes sigue en `audit_log`, que no se
-- toca: la bitácora de la casa no se reescribe.
--
-- Idempotente: todo va con `if exists` y las vistas se recrean completas.
-- =============================================================================

-- ------------------------------------------------------- lo que las mostraba
drop view if exists public.mis_firmas_pendientes;
drop view if exists public.documento_firmas;
drop view if exists public.v_documentos_por_aprobar;

-- ------------------------------------------------------ las puertas de entrada
-- Las dos funciones por las que se pedía y se daba una firma. Al irse, el
-- `supabase.rpc('solicitar_firmas' | 'firmar_documento')` de la aplicación deja
-- de existir en los tipos generados, que es justo lo que se busca: que el
-- código que las llamaba no compile en vez de fallar en producción.
drop function if exists public.solicitar_firmas(uuid, uuid[]);
drop function if exists public.firmar_documento(uuid, text, text);

-- ------------------------------------------------------------------- la tabla
-- Con ella caen sus políticas, sus triggers y su auditoría.
drop table if exists public.aprobaciones;

drop function if exists public.fn_aprobacion_dueno();
drop function if exists public.fn_aprobacion_antes();
drop function if exists public.fn_aprobacion_sincronizar();

-- --------------------------------------------- la versión nueva ya no rearma
-- `fn_version_despues_insert` volvía a poner en PENDIENTE las firmas de un
-- documento al subirle una versión —nadie aprobó un archivo que no vio—. Sin
-- tabla que tocar, se queda solo con lo suyo: mover el número de versión.
create or replace function public.fn_version_despues_insert()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  update public.documentos d
     set version_actual = new.version,
         actualizado_en = now()
   where d.id = new.documento_id;

  return null;
end;
$$;

-- ------------------------------------------- las vistas que nombran la columna
-- Antes de soltar `documentos.estado_aprobacion` hay que sacarla de todo lo que
-- la nombra, o el `drop column` se estrella contra la dependencia.
--
-- `v_ot_timeline` la llevaba dentro del jsonb de cada documento; se recrea
-- igual salvo esa clave, porque de ella cuelga la bitácora de la orden y
-- cambiarle las columnas rompería la pantalla.
create or replace view public.v_ot_timeline as
select b.orden_id,
    b.creado_en as ocurrido_en,
    'BITACORA'::text as categoria,
    replace(b.tipo_evento::text, '_'::text, ' '::text) as titulo,
    b.descripcion as detalle,
    b.usuario_id,
    'ot_bitacora'::text as referencia_tabla,
    b.id as referencia_id,
    b.id::text as referencia_clave,
    b.datos
   from public.ot_bitacora b
union all
 select d.orden_id,
    coalesce(v.subido_en, d.creado_en) as ocurrido_en,
    'DOCUMENTO'::text as categoria,
    (t.nombre || ': '::text) || d.titulo as titulo,
    concat_ws(' · '::text, 'v'::text || d.version_actual, nullif(v.nombre_archivo, ''::text), nullif(d.numero_externo, ''::text), nullif(d.descripcion, ''::text)) as detalle,
    coalesce(v.subido_por, d.creado_por) as usuario_id,
    'documentos'::text as referencia_tabla,
    d.id as referencia_id,
    d.id::text as referencia_clave,
    jsonb_build_object('tipo', t.codigo, 'categoria', t.categoria, 'version', d.version_actual, 'estado', d.estado, 'confidencial', d.es_confidencial, 'etiquetas', to_jsonb(d.etiquetas)) as datos
   from public.documentos d
     left join public.tipos_documento t on t.id = d.tipo_documento_id
     left join public.documento_versiones v on v.documento_id = d.id and v.version = d.version_actual
  where d.orden_id is not null and d.estado <> 'ANULADO'::public.estado_documento
union all
 select m.orden_id,
    coalesce(m.fecha_confirmacion, m.fecha::timestamp with time zone) as ocurrido_en,
    'ALMACEN'::text as categoria,
    (replace(m.tipo::text, '_'::text, ' '::text) || ' '::text) || m.numero as titulo,
    concat_ws(' · '::text, a.nombre, 'valorizado '::text || to_char(m.total_valorizado::numeric, 'FM999G999G990D00'::text), nullif(m.documento_referencia, ''::text), nullif(m.motivo, ''::text)) as detalle,
    coalesce(m.confirmado_por, m.responsable_id) as usuario_id,
    'movimientos_almacen'::text as referencia_tabla,
    m.id as referencia_id,
    m.id::text as referencia_clave,
    jsonb_build_object('tipo', m.tipo, 'numero', m.numero, 'almacen', a.codigo, 'total_valorizado', m.total_valorizado) as datos
   from public.movimientos_almacen m
     left join public.almacenes a on a.id = m.almacen_id
  where m.orden_id is not null and m.estado = 'CONFIRMADO'::public.estado_movimiento_almacen
union all
 select i.orden_id,
    i.fecha as ocurrido_en,
    'CALIDAD'::text as categoria,
    (('Inspección '::text || i.numero) || ' · '::text) || i.resultado::text as titulo,
    concat_ws(' · '::text, nullif(i.observaciones, ''::text), nullif(i.acciones_correctivas, ''::text)) as detalle,
    i.inspector_id as usuario_id,
    'ot_inspecciones'::text as referencia_tabla,
    i.id as referencia_id,
    i.id::text as referencia_clave,
    jsonb_build_object('resultado', i.resultado, 'numero', i.numero, 'etapa_id', i.etapa_id, 'levantada', i.fecha_levantamiento is not null) as datos
   from public.ot_inspecciones i
union all
 select l.registro_id as orden_id,
    l.creado_en as ocurrido_en,
    'AUDITORIA'::text as categoria,
        case l.accion
            when 'INSERT'::public.accion_auditoria then 'Orden registrada'::text
            when 'UPDATE'::public.accion_auditoria then 'Modificación de la orden'::text
            else 'Orden eliminada'::text
        end as titulo,
        case
            when l.campos_modificados is not null then 'Campos: '::text || array_to_string(l.campos_modificados, ', '::text)
            else null::text
        end as detalle,
    l.usuario_id,
    'audit_log'::text as referencia_tabla,
    null::uuid as referencia_id,
    l.id::text as referencia_clave,
    jsonb_strip_nulls(jsonb_build_object('accion', l.accion, 'campos', to_jsonb(l.campos_modificados))) as datos
   from public.audit_log l
  where l.tabla = 'ordenes_trabajo'::text and l.registro_id is not null;

alter view public.v_ot_timeline set (security_invoker = true);

-- `v_documentos_vigentes` sí pierde dos columnas, así que no vale un
-- `create or replace`: se tira y se levanta.
drop view if exists public.v_documentos_vigentes;

create view public.v_documentos_vigentes as
select d.id,
    d.tipo_documento_id,
    t.codigo as tipo_codigo,
    t.nombre as tipo_nombre,
    t.categoria,
    d.titulo,
    d.descripcion,
    d.numero_externo,
    d.fecha_documento,
    d.entidad_tabla,
    d.entidad_id,
    d.orden_id,
    o.numero as orden_numero,
    d.estado,
    d.es_confidencial,
    d.etiquetas,
    d.version_actual,
    d.vence_en,
    d.vence_en is not null and d.vence_en < current_date as vencido,
    v.id as version_id,
    v.bucket,
    v.ruta_storage,
    v.nombre_archivo,
    v.extension,
    v.tamano_bytes,
    v.mime_type,
    v.hash_sha256,
    v.subido_por,
    v.subido_en,
    d.creado_por,
    d.creado_en
   from public.documentos d
     join public.tipos_documento t on t.id = d.tipo_documento_id
     left join public.documento_versiones v on v.documento_id = d.id and v.version = d.version_actual
     left join public.ordenes_trabajo o on o.id = d.orden_id;

alter view public.v_documentos_vigentes set (security_invoker = on);
grant select on public.v_documentos_vigentes to authenticated;

-- --------------------------------------------- lo que la orden exige al cerrar
-- Este es el punto que había que arreglar sí o sí. La función decidía que un
-- documento obligatorio estaba cumplido solo si, además de existir, venía
-- APROBADO cuando su tipo lo requería. Sin circuito de firmas eso no se puede
-- cumplir nunca: la orden no cerraría jamás y el mensaje no diría por qué.
-- Ahora basta con que el documento exista, esté vigente y tenga archivo.
create or replace function public.documentos_obligatorios_faltantes(p_orden_id uuid)
returns table(tipo_documento_id uuid, codigo text, nombre text)
language sql
stable
set search_path to 'public'
as $$
  select t.id, t.codigo, t.nombre
    from public.tipos_documento t
   where t.activo
     and t.obligatorio_para_cierre
     and not exists (
       select 1
         from public.documentos d
        where d.tipo_documento_id = t.id
          and d.orden_id = p_orden_id
          and d.estado = 'VIGENTE'
          and d.version_actual > 0
     )
   order by t.orden_visualizacion, t.codigo;
$$;

comment on function public.documentos_obligatorios_faltantes(uuid) is
  'Los tipos de documento obligatorios que le faltan a una orden para cerrarse. Desde que no hay circuito de firmas, cumple con existir, estar vigente y tener archivo.';

-- ------------------------------------------------- las columnas que sobraban
alter table public.documentos       drop column if exists estado_aprobacion;
alter table public.documentos       drop column if exists aprobado_en;
alter table public.tipos_documento  drop column if exists requiere_aprobacion;

drop type if exists public.estado_aprobacion;

-- ------------------------------------------------------------- el permiso
-- `documentos.aprobar` solo servía para pedir y dar firmas; lo tenía GERENTE.
-- Un permiso sin nada que abrir es peor que ninguno: aparece en la pantalla de
-- roles y hace creer que concede algo.
delete from public.roles_permisos where permiso_codigo = 'documentos.aprobar';
delete from public.permisos        where codigo        = 'documentos.aprobar';
