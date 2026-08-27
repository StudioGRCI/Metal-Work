-- =============================================================================
-- QUIEN PUEDE PONER UNA LÍNEA PUEDE QUITARLA, Y QUIEN APRUEBA PUEDE RECHAZAR
-- -----------------------------------------------------------------------------
-- Segunda tanda del mismo fallo mudo de la migración 036: la aplicación deja
-- pasar por un permiso que la política no reconoce, el UPDATE o el DELETE
-- afecta cero filas, y como una fila escondida por RLS no es un error para
-- Postgres, la pantalla responde «listo» sin haber hecho nada.
--
-- Los tres casos que quedaban, todos encontrados apretando los botones con el
-- usuario a quien le toca apretarlos:
-- =============================================================================

-- ------------------------------------- la ficha de la OT: accesorios y repuestos
-- Poner un accesorio o un repuesto lo puede el jefe de taller y el supervisor
-- (ordenes.editar o produccion.registrar); quitarlo, solo el jefe. El
-- supervisor pulsaba «Quitar» sobre un accesorio que no corresponde a esa
-- carrocería y la línea seguía ahí, sin un solo mensaje.
--
-- Quien puede poner puede quitar: el borrado espeja al alta, y de paso recupera
-- el alcance por orden que a la política de borrado se le había olvidado —el
-- alta sí lo exige—, así que ya no se puede borrar de una orden que no se ve.
drop policy if exists borrar_ot_accesorios on public.ot_accesorios;
create policy borrar_ot_accesorios on public.ot_accesorios
  for delete to authenticated
  using (
    (public.es_admin()
     or public.tiene_permiso('ordenes.editar')
     or public.tiene_permiso('produccion.registrar'))
    and public.puede_ver_orden(orden_id));

drop policy if exists borrar_ot_repuestos on public.ot_repuestos;
create policy borrar_ot_repuestos on public.ot_repuestos
  for delete to authenticated
  using (
    (public.es_admin()
     or public.tiene_permiso('ordenes.editar')
     or public.tiene_permiso('produccion.registrar'))
    and public.puede_ver_orden(orden_id));

-- --------------------------------------------- rechazar un requerimiento
-- Es el trabajo del almacenero: le piden material, mira el stock y responde.
-- Tiene requerimientos.aprobar, pero la política solo aceptaba
-- requerimientos.crear -el permiso de quien pide, no el de quien responde-, así
-- que al rechazar con su motivo la pantalla decía «Requerimiento rechazado» y
-- el requerimiento seguía pendiente, esperando a alguien que ya lo había visto.
drop policy if exists editar_requerimientos on public.requerimientos;
create policy editar_requerimientos on public.requerimientos
  for update to authenticated
  using (
    public.es_admin()
    or public.tiene_permiso('requerimientos.crear')
    or public.tiene_permiso('requerimientos.aprobar'))
  with check (
    public.es_admin()
    or public.tiene_permiso('requerimientos.crear')
    or public.tiene_permiso('requerimientos.aprobar'));

-- ------------------------------------- la ficha de documento que quedó vacía
-- Cuando se adjunta un archivo y la subida de la versión falla, la aplicación
-- borra la ficha recién creada para no dejar un documento sin archivo que
-- confunda y bloquee el cierre de la orden. Ese borrado exigía
-- `documentos.eliminar`, que no lo tiene ningún rol: la limpieza nunca ocurría
-- y quedaba la ficha fantasma.
--
-- No se reparte el permiso de borrar documentos -eso sí es historia-: se
-- permite exactamente lo que hace falta, que cada quien retire la ficha que
-- acaba de crear mientras siga sin ningún archivo dentro.
drop policy if exists borrar_documentos on public.documentos;
create policy borrar_documentos on public.documentos
  for delete to authenticated
  using (
    public.es_admin()
    or public.tiene_permiso('documentos.eliminar')
    or (creado_por = public.usuario_actual()
        and not exists (select 1 from public.documento_versiones v
                         where v.documento_id = documentos.id)));
