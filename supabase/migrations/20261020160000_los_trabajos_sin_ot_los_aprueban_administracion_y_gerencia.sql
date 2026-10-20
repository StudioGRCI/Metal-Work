-- =============================================================================
-- LOS TRABAJOS SIN OT LOS APRUEBAN ADMINISTRACIÓN Y GERENCIA
-- -----------------------------------------------------------------------------
-- DKS decidió (2026-10-20) que los reportes de las unidades que entran sin
-- orden de trabajo los aprueba Administración, y también Gerencia.
--
-- Administración ya tenía el permiso de aprobar (`produccion.aprobar_reportes`)
-- y la política de UPDATE de `flota_avances` lo aceptaba, pero las de lectura
-- pedían `produccion.ver`, que Administración no tiene: la fila le quedaba
-- oculta, el UPDATE afectaba cero filas sin error y la pantalla decía «no se
-- tocó nada». Lo cazó el check 230. Aquí la lectura de la unidad, del reporte
-- y de sus fotos acepta también a quien aprueba, que es lo mínimo para
-- aprobar: no se le abre el resto de Producción.
--
-- Gerencia recibe `produccion.aprobar_reportes`: con él aprueba u observa los
-- reportes del taller, igual que Administración, y le llegan en sus
-- pendientes. Ya leía la producción entera (`produccion.ver`).
--
-- Va también el índice que pide el check 190 para `oficina_pagos`
-- (migración 20261020120000): su llave hacia `trabajadores` solo estaba
-- cubierta por un índice parcial, que la integridad referencial no usa
-- (criterio (a) de la skill `datos`).
--
-- Todo es aditivo: no borra ni cambia ningún dato.
-- =============================================================================

alter policy ver_flota_unidades on public.flota_unidades using (
  public.es_admin() or public.tiene_permiso('produccion.ver')
  or public.tiene_permiso('produccion.aprobar_reportes')
);

alter policy ver_flota_avances on public.flota_avances using (
  public.es_admin() or public.tiene_permiso('produccion.ver')
  or public.tiene_permiso('produccion.aprobar_reportes')
);

alter policy ver_flota_avance_fotos on public.flota_avance_fotos using (
  public.es_admin() or public.tiene_permiso('produccion.ver')
  or public.tiene_permiso('produccion.aprobar_reportes')
);

-- La foto en el almacenamiento: la de una unidad sin orden no tiene OT en la
-- ruta, así que `puede_ver_orden` no entra en juego para ella.
alter policy mw_leer_fotos_avance on storage.objects using (
  bucket_id = 'fotos-avance'
  and (public.es_admin() or public.tiene_permiso('produccion.ver')
       or public.tiene_permiso('produccion.aprobar_reportes'))
  and (public.orden_de_ruta(name) is null or public.puede_ver_orden(public.orden_de_ruta(name)))
);

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, 'produccion.aprobar_reportes'
  from public.roles r
 where r.codigo = 'GERENTE'
on conflict do nothing;

create index if not exists ix_oficina_pagos_trabajador on public.oficina_pagos (trabajador_id);
