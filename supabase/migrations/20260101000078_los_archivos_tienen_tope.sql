-- =============================================================================
-- LOS ARCHIVOS TIENEN TOPE, Y LO PONE LA BASE
-- -----------------------------------------------------------------------------
-- «Hasta 10 MB por foto» y «solo imágenes» estaba escrito en el navegador y en
-- ningún sitio más: los tres depósitos aceptaban cualquier tipo de archivo y de
-- cualquier tamaño. Quien suba desde fuera de la pantalla —y la clave anónima
-- viaja al navegador— podía llenar el almacenamiento de la empresa con lo que
-- quisiera.
--
-- El tope se pone donde se cumple. Los valores son los que la aplicación ya
-- promete: 25 MB para los documentos (lo que dice `tipos_documento`), 10 MB
-- para las fotos de avance y 2 MB para el logo, que es una imagen de marca.
-- Volver a correr esto deja lo mismo.
-- =============================================================================

update storage.buckets
   set file_size_limit = 25 * 1024 * 1024,
       allowed_mime_types = array[
         'application/pdf',
         'image/jpeg', 'image/png', 'image/webp',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
         'application/xml', 'text/xml',
         -- Los planos de ingeniería: AutoCAD no declara un tipo propio y cada
         -- navegador manda uno distinto, así que van los tres que se ven.
         'image/vnd.dwg', 'application/acad', 'application/dxf',
         'application/octet-stream'
       ]
 where id = 'documentos';

update storage.buckets
   set file_size_limit = 10 * 1024 * 1024,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
 where id = 'fotos-avance';

update storage.buckets
   set file_size_limit = 2 * 1024 * 1024,
       allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
 where id = 'logos';
