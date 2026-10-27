-- =============================================================================
-- GERENCIA YA NO CARGA LA OT
-- -----------------------------------------------------------------------------
-- Segunda mitad de `20261027200000` (Gerencia aprueba la cotización con un toque
-- y Administración le da su código interno y sube su OT). Aquella sumó lo nuevo;
-- esta cierra el camino de antes, y por eso se aplica cuando la pantalla nueva
-- ya está desplegada: antes, la ventana vieja de Gerencia se quedaría sin poder
-- aprobar.
--
--   · `aprobar_cotizacion_con_ot` deja de estar disponible para las cuentas. Se
--     conserva para no perder su historia, como `emitir_orden_de_cotizacion`.
--   · El PDF de la OT ya no lo sube quien aprueba la cotización: la política de
--     subida a `adjuntos-ot` deja de aceptarlo por `cotizaciones.revisar`.
--     Administración lo sigue subiendo por `ordenes.crear`.
--
-- Lo que ya existe —cotizaciones, OT y códigos— queda como está: nada se borra.
-- =============================================================================

revoke execute on function public.aprobar_cotizacion_con_ot(uuid, uuid, text, text, public.tipo_unidad_carroceria, date, text, text, bigint, text, text)
  from authenticated;

-- La de la migración 20261022113000, sin `cotizaciones.revisar`. Con `alter
-- policy` y no `drop`/`create`: un DROP cuelga el conector de Supabase (skill
-- `datos`).
alter policy mw_subir_adjuntos_ot on storage.objects
  with check (bucket_id = 'adjuntos-ot'
              and public.orden_de_ruta(name) is not null
              and public.puede_ver_orden(public.orden_de_ruta(name))
              and (public.es_admin()
                   or public.tiene_permiso('produccion.actividades')
                   or public.tiene_permiso('ordenes.editar')
                   or public.tiene_permiso('ordenes.crear')
                   or public.tiene_permiso('ordenes.abrir_taller')
                   or (public.tiene_permiso('diseno.planos') and lower(name) like '%.xlsx')));

do $$
begin
  if exists (select 1 from pg_policies
              where schemaname = 'storage' and tablename = 'objects' and policyname = 'mw_subir_adjuntos_ot'
                and with_check like '%cotizaciones.revisar%') then
    raise exception 'mw_subir_adjuntos_ot sigue aceptando a quien aprueba la cotización';
  end if;
  if not exists (select 1 from pg_policies
                  where schemaname = 'storage' and tablename = 'objects' and policyname = 'mw_subir_adjuntos_ot'
                    and with_check like '%ordenes.crear%' and with_check like '%diseno.planos%') then
    raise exception 'mw_subir_adjuntos_ot perdió a Administración o a Diseño';
  end if;
  if has_function_privilege('authenticated',
       'public.aprobar_cotizacion_con_ot(uuid, uuid, text, text, public.tipo_unidad_carroceria, date, text, text, bigint, text, text)',
       'execute') then
    raise exception 'aprobar_cotizacion_con_ot sigue disponible para las cuentas';
  end if;
end $$;
