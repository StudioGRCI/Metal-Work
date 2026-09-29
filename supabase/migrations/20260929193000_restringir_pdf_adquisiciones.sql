-- El PDF pertenece al borrador de quien lo sube; ningún otro usuario de Contabilidad
-- puede ocupar el nombre del archivo de una adquisición ajena.
drop policy if exists comprobantes_financieros_subir on storage.objects;
create policy comprobantes_financieros_subir on storage.objects for insert to authenticated
with check (
  bucket_id='comprobantes-financieros'
  and public.tiene_permiso('adquisiciones.registrar')
  and name ~ '^adquisiciones/[0-9a-f-]{36}/comprobante\.pdf$'
  and exists (
    select 1 from public.adquisiciones a
    where a.id::text=split_part(name,'/',2)
      and a.registrado_por=public.usuario_actual()
      and a.estado='BORRADOR'
  )
);
