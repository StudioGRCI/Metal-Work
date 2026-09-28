-- La edición por Ventas se limita al permiso comercial ya validado por la base.
create or replace function public.editar_carroceria_ventas(p_id uuid, p_nombre text, p_descripcion text, p_activo boolean)
returns uuid
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_id uuid;
begin
  perform public.exigir_permiso('cotizaciones.crear');
  if length(btrim(p_nombre)) < 3 or length(p_nombre) > 120 then
    raise exception 'El nombre de la carrocería debe tener entre 3 y 120 caracteres.' using errcode = '22023';
  end if;
  update public.tipos_carroceria
     set nombre = btrim(p_nombre), descripcion = nullif(btrim(p_descripcion), ''), activo = p_activo
   where id = p_id
   returning id into v_id;
  if v_id is null then
    raise exception 'No se encontró la carrocería o tu perfil no tiene acceso.' using errcode = 'P0002';
  end if;
  return v_id;
end;
$$;
revoke all on function public.editar_carroceria_ventas(uuid,text,text,boolean) from public, anon;
grant execute on function public.editar_carroceria_ventas(uuid,text,text,boolean) to authenticated;
