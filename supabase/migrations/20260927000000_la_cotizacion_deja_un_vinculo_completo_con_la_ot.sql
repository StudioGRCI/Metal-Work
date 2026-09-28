-- Al borrar una cotización sin órdenes activas, PostgreSQL debe encontrar y
-- desvincular también las OTs anuladas. El índice único parcial solo cubre
-- órdenes activas y no sirve para localizar todas las referencias de la FK.
create index if not exists idx_ordenes_trabajo_cotizacion_pdf_fk
  on public.ordenes_trabajo (cotizacion_pdf_id);
