-- Una cotización PDF numerada que se usó para probar el circuito no se borra
-- ni se presenta como rechazada: se anula y conserva su número y su archivo.
alter type public.estado_cotizacion_pdf add value if not exists 'ANULADA';
