-- Dos reglas de los archivos que se suben a un documento.
--
-- 1. Un archivo de 0 bytes no es un documento.
--
-- El PDF de la orden, el Excel del cronograma y el PDF de la cotización se
-- anotaban con el tamaño que mandaba la pantalla, y la base aceptaba 0: lo
-- cuidaba solo la validación de la aplicación, y la de los adjuntos de la
-- orden ni siquiera (pedía «0 o más»). La revisión del campo de documentos
-- (PR #143) anotó una cotización con un PDF vacío directamente en la base del
-- banco. Las demás tablas con archivo ya lo exigían (`documentos_compra_material`,
-- `facturas_venta`, las fotos…).
--
-- La regla juzga el archivo que llega: al anotarlo y al cambiarlo. No es una
-- restricción `check` porque esa se vuelve a revisar en cualquier cambio de la
-- fila, aunque quede `not valid`: una cotización anterior con 0 bytes no se
-- habría podido rechazar, aprobar ni corregir, y la pantalla habría dicho «El
-- archivo está vacío» de un archivo que nadie estaba subiendo (lo encontraron
-- los auditores el 2026-10-22, con AUD-VACIA en el banco). Las filas viejas con
-- 0 bytes se quedan como están: un documento no se corrige a escondidas. Las
-- versiones de una cotización no llevan la regla: las escribe solo el
-- disparador que archiva la anterior, tal como estaba.
--
-- El tamaño que vale es el que guardó Storage al recibir el archivo, no el que
-- dice el navegador: si el archivo ya está en su bucket, la fila se anota con
-- ese tamaño y con ese se juzga. Si no está (una fila que nombra un archivo que
-- todavía no subió), se juzga el que llega; vacío (`null`) solo lo dejan las
-- filas viejas que no lo anotaron.
--
-- La primera versión de esta migración ponía la restricción; si una base ya la
-- tiene (el banco), aquí se quita.
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

create or replace function public.fn_archivo_no_vacio()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_guardado bigint;
begin
  -- Un cambio que no toca el archivo (el estado, la aprobación) no lo juzga.
  if tg_op = 'UPDATE'
     and new.ruta_storage is not distinct from old.ruta_storage
     and new.tamano_bytes is not distinct from old.tamano_bytes then
    return new;
  end if;
  -- El bucket de cada tabla llega como argumento del disparador.
  select (o.metadata ->> 'size')::bigint into v_guardado
    from storage.objects o
   where o.bucket_id = tg_argv[0] and o.name = new.ruta_storage;
  new.tamano_bytes := coalesce(v_guardado, new.tamano_bytes);
  if new.tamano_bytes is null or new.tamano_bytes >= 1 then
    return new;
  end if;
  raise exception 'El archivo está vacío: elige otro.' using errcode = 'check_violation';
end
$$;

revoke all on function public.fn_archivo_no_vacio() from public, anon, authenticated;

do $$
declare
  tabla text;
  bucket text;
begin
  foreach tabla in array array['ot_adjuntos', 'cotizaciones_pdf', 'cotizaciones_pdf_versiones'] loop
    execute format('alter table public.%I drop constraint if exists %I', tabla, tabla || '_tamano_no_vacio');
  end loop;
  for tabla, bucket in values ('ot_adjuntos', 'adjuntos-ot'), ('cotizaciones_pdf', 'cotizaciones-pdf') loop
    execute format(
      'create or replace trigger trg_archivo_no_vacio before insert or update of ruta_storage, tamano_bytes on public.%I '
      'for each row execute function public.fn_archivo_no_vacio(%L)',
      tabla, bucket
    );
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
