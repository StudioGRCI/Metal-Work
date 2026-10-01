-- =============================================================================
-- LA VISTA DE DOCUMENTOS DE COMPRA DE TESORERÍA, SIN «SECURITY DEFINER»
-- -----------------------------------------------------------------------------
-- El asesor de seguridad de Supabase marca como ERROR la vista
-- `v_documentos_compra_tesoreria`: es SECURITY DEFINER y se salta el RLS de
-- las tablas que une. Es a propósito (20260930102000_facturas_compras_agrupadas):
-- Tesorería paga las facturas de compra pero no tiene lectura técnica de las
-- solicitudes de cada área, y la vista filtra por permiso en su propio WHERE.
-- Pasarla a `security_invoker` sin más le escondería a Tesorería los vínculos
-- con las OT: las líneas de compra exigen `compras.ver` o `almacen.recibir`.
--
-- El cuerpo pasa a una función SECURITY DEFINER con el mismo filtro y la vista
-- queda como invoker sobre ella. Lo que ve cada puesto no cambia —se comparó
-- fila por fila con Tesorería, Logística y Supervisión en producción, en una
-- transacción deshecha, antes de aplicarla— y la llave queda donde el proyecto
-- las pone: dentro de una función con `search_path` fijo.
-- =============================================================================

create or replace function public.documentos_compra_tesoreria()
returns table (
  id              uuid,
  orden_compra_id uuid,
  tipo            text,
  nombre_archivo  text,
  ruta_storage    text,
  mime_type       text,
  tamano_bytes    bigint,
  subido_por      uuid,
  creado_en       timestamptz,
  proveedor       text,
  referencia      text,
  fecha_estimada  date,
  orden_id        uuid,
  numero_ot       text,
  area_destino    text,
  vinculos_ot     jsonb
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select d.id, d.orden_compra_id, d.tipo, d.nombre_archivo, d.ruta_storage,
         d.mime_type, d.tamano_bytes, d.subido_por, d.creado_en,
         oc.proveedor, oc.referencia, oc.fecha_estimada, r.orden_id, ot.numero as numero_ot, r.area_destino,
         coalesce((select jsonb_agg(jsonb_build_object('orden_id', x.orden_id, 'numero_ot', x.numero_ot, 'area_destino', x.area_destino)
                                    order by x.numero_ot, x.area_destino)
                     from (select distinct rq.orden_id, o.numero as numero_ot, rq.area_destino
                             from public.orden_compra_material_detalles l
                             join public.requerimientos_materiales rq on rq.id = l.requerimiento_id
                             join public.ordenes_trabajo o on o.id = rq.orden_id
                            where l.orden_compra_id = oc.id) x), '[]'::jsonb) as vinculos_ot
    from public.documentos_compra_material d
    join public.ordenes_compra_materiales oc on oc.id = d.orden_compra_id
    left join public.requerimientos_materiales r on r.id = oc.requerimiento_id
    left join public.ordenes_trabajo ot on ot.id = r.orden_id
   where public.es_admin() or public.tiene_permiso('compras.ver') or public.tiene_permiso('tesoreria.ver_documentos')
$$;

revoke all on function public.documentos_compra_tesoreria() from public, anon;
grant execute on function public.documentos_compra_tesoreria() to authenticated;

create or replace view public.v_documentos_compra_tesoreria
with (security_invoker = true) as
select * from public.documentos_compra_tesoreria();

revoke all on public.v_documentos_compra_tesoreria from public, anon;
grant select on public.v_documentos_compra_tesoreria to authenticated;
