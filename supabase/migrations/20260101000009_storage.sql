-- =============================================================================
-- 0009 · SEGURIDAD DE SUPABASE STORAGE
-- -----------------------------------------------------------------------------
-- Los buckets se crean en la migración de documentos; aquí se controla quién
-- puede leer y escribir cada archivo.
--
-- Convención de rutas, de la que dependen las políticas:
--   documentos/ot/{orden_id}/{documento_id}/{version}.{ext}
--   documentos/{entidad}/{entidad_id}/{documento_id}/{version}.{ext}
--   fotos-avance/ot/{orden_id}/{documento_id}/{version}.{ext}
--
-- Un archivo colgado de una orden hereda la visibilidad de esa orden, de modo
-- que un operario no puede descargar los planos de una OT que no es suya ni
-- adivinando la URL.
-- =============================================================================

do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage.objects no existe: se omiten las políticas de Storage';
    return;
  end if;

  -- Extrae el orden_id de una ruta que empiece por ot/{uuid}/..., o null si la
  -- ruta no sigue esa convención. No usa cast directo para no reventar con
  -- rutas antiguas o mal formadas.
  execute $fn$
    create or replace function public.orden_de_ruta(p_ruta text)
    returns uuid
    language plpgsql
    immutable
    as $cuerpo$
    declare v_partes text[];
    begin
      v_partes := string_to_array(coalesce(p_ruta, ''), '/');

      if array_length(v_partes, 1) is null
         or v_partes[1] <> 'ot'
         or v_partes[2] !~ '^[0-9a-fA-F-]{36}$' then
        return null;
      end if;

      return v_partes[2]::uuid;
    exception when others then
      return null;
    end;
    $cuerpo$;
  $fn$;

  -- En Supabase, storage.objects pertenece a supabase_storage_admin y ya viene
  -- con RLS activo. El intento se hace igual por si el proyecto es autoalojado,
  -- pero no debe abortar la migración si no hay permiso para alterarla.
  begin
    execute 'alter table storage.objects enable row level security';
  exception when insufficient_privilege or wrong_object_type then
    raise notice 'storage.objects ya tiene RLS gestionado por Supabase; se omite';
  end;

  -- --- lectura ---------------------------------------------------------------
  execute 'drop policy if exists mw_leer_documentos on storage.objects';
  execute $pol$
    create policy mw_leer_documentos on storage.objects
      for select to authenticated
      using (
        bucket_id in ('documentos', 'fotos-avance')
        and (public.es_admin() or public.tiene_permiso('documentos.ver'))
        and (
          public.orden_de_ruta(name) is null
          or public.puede_ver_orden(public.orden_de_ruta(name))
        )
      );
  $pol$;

  -- Los logotipos se incrustan en cotizaciones y reportes: bucket público.
  execute 'drop policy if exists mw_leer_logos on storage.objects';
  execute $pol$
    create policy mw_leer_logos on storage.objects
      for select to authenticated, anon
      using (bucket_id = 'logos');
  $pol$;

  -- --- escritura -------------------------------------------------------------
  execute 'drop policy if exists mw_subir_documentos on storage.objects';
  execute $pol$
    create policy mw_subir_documentos on storage.objects
      for insert to authenticated
      with check (
        bucket_id in ('documentos', 'fotos-avance')
        and (public.es_admin() or public.tiene_permiso('documentos.subir'))
      );
  $pol$;

  -- Reemplazar un archivo ya subido rompería la trazabilidad: cada cambio es una
  -- versión nueva. Por eso no hay política de UPDATE sobre los documentos.
  execute 'drop policy if exists mw_borrar_documentos on storage.objects';
  execute $pol$
    create policy mw_borrar_documentos on storage.objects
      for delete to authenticated
      using (
        bucket_id in ('documentos', 'fotos-avance')
        and (public.es_admin() or public.tiene_permiso('documentos.eliminar'))
      );
  $pol$;

  execute 'drop policy if exists mw_gestionar_logos on storage.objects';
  execute $pol$
    create policy mw_gestionar_logos on storage.objects
      for all to authenticated
      using (bucket_id = 'logos' and (public.es_admin() or public.tiene_permiso('configuracion.editar')))
      with check (bucket_id = 'logos' and (public.es_admin() or public.tiene_permiso('configuracion.editar')));
  $pol$;
end;
$$;

comment on function public.orden_de_ruta is
  'Devuelve el orden_id contenido en una ruta de Storage con formato ot/{uuid}/..., o null si la ruta no sigue esa convención. La usan las políticas de storage.objects.';
