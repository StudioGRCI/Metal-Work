-- La edición general aún recibe marca/modelo para comprobar la versión de la
-- unidad. La envolvemos para que un Jefe de Taller no pueda forjar ese cambio.
do $$
begin
  if to_regprocedure('public.editar_ot_con_historial_base(uuid,timestamp with time zone,jsonb,text)') is null then
    alter function public.editar_ot_con_historial(uuid,timestamptz,jsonb,text)
      rename to editar_ot_con_historial_base;
  end if;
end;
$$;
revoke all on function public.editar_ot_con_historial_base(uuid,timestamptz,jsonb,text)
  from public, anon, authenticated;
create or replace function public.editar_ot_con_historial(
  p_orden uuid, p_version timestamptz, p_datos jsonb, p_motivo text
) returns uuid language plpgsql security definer set search_path = 'public' as $$
declare v_unidad public.unidades%rowtype;
begin
  select u.* into v_unidad from public.ordenes_trabajo o
    join public.unidades u on u.id = o.unidad_id where o.id = p_orden;
  if found and (coalesce(v_unidad.marca,'') is distinct from btrim(coalesce(p_datos->>'marca',''))
    or coalesce(v_unidad.modelo,'') is distinct from btrim(coalesce(p_datos->>'modelo','')))
    and not exists (
      select 1 from public.usuarios u join public.roles r on r.id = u.rol_id
       where u.id = public.usuario_actual() and u.activo and r.codigo = 'ADMINISTRACION'
    ) then
    raise exception 'Solo Administración puede corregir los datos del vehículo.'
      using errcode = 'insufficient_privilege';
  end if;
  return public.editar_ot_con_historial_base(p_orden,p_version,p_datos,p_motivo);
end;
$$;
revoke all on function public.editar_ot_con_historial(uuid,timestamptz,jsonb,text)
  from public, anon, authenticated;
grant execute on function public.editar_ot_con_historial(uuid,timestamptz,jsonb,text)
  to authenticated;
