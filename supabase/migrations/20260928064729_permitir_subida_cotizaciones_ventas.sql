-- La política INSERT de documentos-compras evalúa esta función incluso al
-- subir a otros buckets. Revocar EXECUTE a authenticated bloqueó toda subida
-- (incluidas las cotizaciones). Solo convierte una ruta en UUID; no lee datos.
grant execute on function public.orden_compra_de_ruta(text) to authenticated;
