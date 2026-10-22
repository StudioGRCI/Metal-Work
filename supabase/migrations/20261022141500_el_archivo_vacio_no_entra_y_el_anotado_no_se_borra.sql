-- Dos reglas de los archivos que se suben a un documento.
--
-- 1. Un archivo de 0 bytes no es un documento.
--
-- El PDF de la orden, el Excel del cronograma y el PDF de la cotización (con
-- sus versiones corregidas) se anotaban con el tamaño que mandaba la pantalla,
-- y la base aceptaba 0: lo cuidaba solo la validación de la aplicación, y la
-- de los adjuntos de la orden ni siquiera (pedía «0 o más»). La revisión del
-- campo de documentos (PR #143) anotó una cotización con un PDF vacío
-- directamente en la base del banco. Las demás tablas con archivo ya lo
-- exigían (`documentos_compra_material`, `facturas_venta`, las fotos…).
--
-- La regla vale desde ahora. Si alguna fila anterior ya tiene 0 bytes, se
-- queda como está: un documento no se corrige a escondidas, y la restricción
-- queda sin validar en esa tabla, con un aviso, en vez de tumbar la migración.
-- El tamaño puede seguir vacío (`null`) en las filas viejas que no lo anotaron.
--
-- 2. El archivo que una cotización nombra no lo borra nadie, tampoco el
--    administrador.
--
-- Si la respuesta se pierde después de subir un archivo, la pantalla pregunta
-- otra vez y, si no hay un sí, intenta quitarlo: la política de cada bucket
-- deja quitar solo el archivo que ninguna fila nombra, así que el que quedó
-- anotado se queda y el suelto se va (`anotarSinDejarloSuelto`). En
-- `cotizaciones-pdf` el administrador saltaba esa condición: con la respuesta
-- perdida, se le habría borrado el PDF de una cotización registrada. Ningún
-- flujo lo necesita: «Quitar» una cotización borra primero la fila (y sus
-- versiones, en cascada) y después los archivos, ya sueltos.

do $$
declare
  tabla text;
  nombre text;
begin
  foreach tabla in array array['ot_adjuntos', 'cotizaciones_pdf', 'cotizaciones_pdf_versiones'] loop
    nombre := tabla || '_tamano_no_vacio';
    if not exists (
      select 1 from pg_constraint
      where conrelid = format('public.%I', tabla)::regclass and conname = nombre
    ) then
      execute format(
        'alter table public.%I add constraint %I check (tamano_bytes is null or tamano_bytes >= 1) not valid',
        tabla, nombre
      );
    end if;
    begin
      execute format('alter table public.%I validate constraint %I', tabla, nombre);
    exception when check_violation then
      raise notice '%: hay filas anteriores con 0 bytes; se quedan como evidencia y la regla vale para las nuevas.', tabla;
    end;
  end loop;
end $$;

alter policy mw_borrar_cotizaciones_pdf on storage.objects
  using (bucket_id = 'cotizaciones-pdf'
         and (public.es_admin()
              or owner_id = (auth.uid())::text
              or public.tiene_permiso('cotizaciones.revisar'))
         and not exists (select 1 from public.cotizaciones_pdf c
                         where c.ruta_storage = objects.name)
         and not exists (select 1 from public.cotizaciones_pdf_versiones v
                         where v.ruta_storage = objects.name));
