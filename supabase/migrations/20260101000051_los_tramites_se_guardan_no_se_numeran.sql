-- =============================================================================
-- LOS TRÁMITES SE GUARDAN, NO SE NUMERAN
-- -----------------------------------------------------------------------------
-- En las carpetas de la empresa hay tres series de trámite con su propia
-- numeración —MWP-TP, MWP-CM y MWP-MOD—. La empresa decidió que el sistema no
-- se meta a numerarlas: el número lo sigue poniendo quien hace el trámite, y lo
-- que hace falta es tener el papel guardado y encontrable desde la orden o el
-- cliente.
--
-- Por eso no se toca `series_documentarias`: eso es para lo que el sistema
-- emite y tiene que responder por el correlativo. Estos son tipos de documento
-- que se archivan, y `documentos.numero_externo` es justamente la columna para
-- el número que puso otro. Es la misma cañería que ya guarda la orden de compra
-- del cliente o una factura de proveedor.
--
-- `requiere_aprobacion` queda en falso: un trámite se archiva como llega, no
-- se aprueba adentro. Y `obligatorio_para_cierre` también, porque no todos los
-- trabajos llevan trámite y bloquear el cierre por un papel que a veces no
-- corresponde termina en que alguien cierre la orden con un trámite inventado.
-- =============================================================================

insert into public.tipos_documento
  (codigo, nombre, descripcion, categoria, extensiones_permitidas, orden_visualizacion)
values
  ('TRAM_TP', 'Trámite de tarjeta de propiedad',
   'Serie MWP-TP. El número lo pone quien hace el trámite; acá se guarda el papel y ese número va en «número externo».',
   'ADMINISTRATIVO', array['pdf','jpg','jpeg','png'], 60),
  ('TRAM_CM', 'Trámite de cambio de motor / características',
   'Serie MWP-CM. Se archiva con el número con el que salió, sin renumerar.',
   'ADMINISTRATIVO', array['pdf','jpg','jpeg','png'], 61),
  ('TRAM_MOD', 'Trámite de modificación',
   'Serie MWP-MOD. Se archiva con el número con el que salió, sin renumerar.',
   'ADMINISTRATIVO', array['pdf','jpg','jpeg','png'], 62)
on conflict (codigo) do update
   set nombre      = excluded.nombre,
       descripcion = excluded.descripcion,
       categoria   = excluded.categoria,
       activo      = true;
