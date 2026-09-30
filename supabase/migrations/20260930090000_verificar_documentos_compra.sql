-- Logística debe poder comprobar su PDF recién cargado antes de registrarlo.
-- El archivo continúa privado; no se amplía el acceso a otros puestos.
drop policy if exists mw_verificar_documento_compra_propio on storage.objects;
create policy mw_verificar_documento_compra_propio on storage.objects
for select to authenticated using (
  bucket_id = 'documentos-compras'
  and owner_id = (select auth.uid())::text
  and (select public.tiene_permiso('compras.crear'))
  and exists (select 1 from public.ordenes_compra_materiales oc
    where oc.id = public.orden_compra_de_ruta(objects.name))
);

create or replace function public.comprobar_archivo_compra()
returns trigger language plpgsql security definer set search_path = 'public' as $$
declare v_objeto storage.objects%rowtype;
begin
  perform public.exigir_permiso('compras.crear');
  if new.subido_por <> public.usuario_actual()
     or new.ruta_storage <> 'compra/' || new.orden_compra_id::text || '/' || new.id::text || '.pdf' then
    raise exception 'El PDF debe pertenecer a esta compra y al usuario que lo adjunta.';
  end if;
  select * into v_objeto from storage.objects
    where bucket_id = 'documentos-compras' and name = new.ruta_storage;
  if not found or v_objeto.owner_id is distinct from auth.uid()::text then
    raise exception 'Carga el PDF antes de adjuntarlo a la compra.';
  end if;
  if v_objeto.metadata->>'mimetype' is distinct from 'application/pdf'
     or (v_objeto.metadata->>'size')::bigint is distinct from new.tamano_bytes then
    raise exception 'El tamaño o tipo del PDF no coincide con el archivo cargado.';
  end if;
  return new;
end;
$$;
revoke all on function public.comprobar_archivo_compra() from public, anon, authenticated;
drop trigger if exists trg_comprobar_archivo_compra on public.documentos_compra_material;
create trigger trg_comprobar_archivo_compra before insert on public.documentos_compra_material
for each row execute function public.comprobar_archivo_compra();
