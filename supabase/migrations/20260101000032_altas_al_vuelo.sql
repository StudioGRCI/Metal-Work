-- =============================================================================
-- EL CATÁLOGO DE CARROCERÍAS SE ALIMENTA DESDE DONDE SE COTIZA
-- -----------------------------------------------------------------------------
-- La carrocería nueva aparece justo cuando se está cotizando: el cliente pide
-- algo que el catálogo no tiene —una tolva con tiro, una plataforma especial—
-- y mandar al vendedor a buscar a un administrador para poder seguir es
-- perder la llamada. Quien puede emitir una cotización o abrir una orden
-- puede también dar de alta el tipo; corregirlo o desactivarlo sigue siendo
-- de administración, que es donde se cuida el catálogo.
-- =============================================================================

drop policy if exists crear_tipos_carroceria on public.tipos_carroceria;
create policy crear_tipos_carroceria on public.tipos_carroceria
  for insert to authenticated
  with check (
    public.es_admin()
    or public.tiene_permiso('configuracion.editar')
    or public.tiene_permiso('cotizaciones.crear')
    or public.tiene_permiso('ordenes.crear'));
