-- El código del catálogo siempre corresponde al nombre vigente de la carrocería.
create or replace function public.editar_carroceria_ventas(p_id uuid, p_nombre text, p_descripcion text, p_activo boolean)
returns uuid
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_id uuid;
  v_codigo text;
begin
  perform public.exigir_permiso('cotizaciones.crear');
  if length(btrim(p_nombre)) < 3 or length(p_nombre) > 120 then
    raise exception 'El nombre de la carrocería debe tener entre 3 y 120 caracteres.' using errcode = '22023';
  end if;
  v_codigo := left(trim(both '_' from regexp_replace(upper(public.unaccent(btrim(p_nombre))), '[^A-Z0-9]+', '_', 'g')), 40);
  if v_codigo = '' then
    raise exception 'El nombre debe incluir letras o números.' using errcode = '22023';
  end if;
  if exists (select 1 from public.tipos_carroceria where codigo = v_codigo and id <> p_id) then
    raise exception 'Ya existe una carrocería con un nombre parecido. Revisa el catálogo.' using errcode = '23505';
  end if;
  update public.tipos_carroceria
     set codigo = v_codigo,
         nombre = btrim(p_nombre),
         descripcion = nullif(btrim(p_descripcion), ''),
         activo = p_activo
   where id = p_id
   returning id into v_id;
  if v_id is null then
    raise exception 'No se encontró la carrocería o tu perfil no tiene acceso.' using errcode = 'P0002';
  end if;
  return v_id;
end;
$$;
comment on function public.editar_carroceria_ventas(uuid,text,text,boolean) is
  'SECURITY DEFINER intencional: permite a Ventas editar nombre/descripcion/activo sin abrir los campos de costo; exigir_permiso limita a cotizaciones.crear.';
revoke all on function public.editar_carroceria_ventas(uuid,text,text,boolean) from public, anon;
grant execute on function public.editar_carroceria_ventas(uuid,text,text,boolean) to authenticated;
