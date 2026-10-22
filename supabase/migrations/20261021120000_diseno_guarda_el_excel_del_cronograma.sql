-- =============================================================================
-- DISEÑO GUARDA EL EXCEL DEL CRONOGRAMA EN LA ORDEN
-- -----------------------------------------------------------------------------
-- StudioGRCI lo decidió el 2026-10-21: «sí», Diseño guarda el Excel del
-- cronograma en la orden.
--
-- Diseño carga el cronograma de una orden (`cargar_cronograma` lo deja entrar
-- por `diseno.planos`, migración 106), y la ventana le ofrece «Guardar también
-- el Excel en la orden», marcado de entrada. Pero el archivo no entraba: la
-- política de Storage y la de `ot_adjuntos` solo aceptaban a quien carga
-- actividades, a la oficina que hace órdenes y a quien las abre desde el
-- taller. El cronograma quedaba cargado y el Excel no, y la pantalla le echaba
-- la culpa a la señal.
--
-- Desde aquí Diseño guarda el Excel del cronograma, y solo eso: la fila con
-- `tipo = 'CRONOGRAMA'` y en Storage un `.xlsx` de la orden. El PDF de la orden
-- lo sigue subiendo quien lo subía. Lo que Diseño guarda lo puede quitar él,
-- como todo el que sube un archivo (`subido_por` y `owner_id`, migración 099).
-- =============================================================================

alter policy crear_ot_adjuntos on public.ot_adjuntos
  with check ((public.es_admin()
               or public.tiene_permiso('produccion.actividades')
               or public.tiene_permiso('ordenes.editar')
               or public.tiene_permiso('ordenes.crear')
               or public.tiene_permiso('ordenes.abrir_taller')
               or (tipo = 'CRONOGRAMA' and public.tiene_permiso('diseno.planos')))
              and public.puede_ver_orden(orden_id)
              and subido_por = public.usuario_actual());

-- La de la migración 20261020206000, con Diseño y su `.xlsx`. Con `alter
-- policy` y no `drop`/`create`: un DROP cuelga el conector de Supabase (skill
-- `datos`), y así la migración entra igual por cualquier camino.
alter policy mw_subir_adjuntos_ot on storage.objects
  with check (bucket_id = 'adjuntos-ot'
              and public.orden_de_ruta(name) is not null
              and public.puede_ver_orden(public.orden_de_ruta(name))
              and (public.es_admin()
                   or public.tiene_permiso('produccion.actividades')
                   or public.tiene_permiso('ordenes.editar')
                   or public.tiene_permiso('ordenes.crear')
                   or public.tiene_permiso('ordenes.abrir_taller')
                   or public.tiene_permiso('cotizaciones.revisar')
                   or (public.tiene_permiso('diseno.planos') and lower(name) like '%.xlsx')));

do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'ot_adjuntos' and policyname = 'crear_ot_adjuntos'
                    and with_check like '%diseno.planos%') then
    raise exception 'crear_ot_adjuntos no quedó con Diseño';
  end if;
  if not exists (select 1 from pg_policies
                  where schemaname = 'storage' and tablename = 'objects' and policyname = 'mw_subir_adjuntos_ot'
                    and with_check like '%diseno.planos%' and with_check like '%cotizaciones.revisar%') then
    raise exception 'mw_subir_adjuntos_ot no quedó con Diseño y con Gerencia';
  end if;
end $$;
