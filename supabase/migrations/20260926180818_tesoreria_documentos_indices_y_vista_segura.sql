-- Completa los índices de las FK y conserva la política de alcance de Diseño
-- con una vista SECURITY INVOKER, aprovechando el RLS de usuarios y planos.
create index if not exists idx_cotizaciones_pdf_liberaciones_liberado_por
  on public.cotizaciones_pdf_liberaciones_tesoreria (liberado_por);
create index if not exists idx_cotizaciones_pdf_observaciones_registrado_por
  on public.cotizaciones_pdf_observaciones_tesoreria (registrado_por);
create index if not exists idx_documentos_compra_material_subido_por
  on public.documentos_compra_material (subido_por);

create or replace view public.v_equipo_diseno_ot
with (security_invoker = true) as
select o.id as orden_id, o.diseno_lider_id,
       nullif(btrim(coalesce(l.nombres, '') || ' ' || coalesce(l.apellidos, '')), '') as lider_nombre,
       p.id as plano_id, p.numero_plano, p.nombre as plano_nombre, p.responsable_diseno_id,
       nullif(btrim(coalesce(r.nombres, '') || ' ' || coalesce(r.apellidos, '')), '') as responsable_nombre
  from public.ordenes_trabajo o
  left join public.usuarios l on l.id = o.diseno_lider_id
  left join public.ot_planos p on p.orden_id = o.id
  left join public.usuarios r on r.id = p.responsable_diseno_id
 where public.es_admin()
    or (public.tiene_permiso('diseno.asignar') and public.puede_ver_orden(o.id));
