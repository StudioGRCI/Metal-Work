-- Una sola jefatura de Maestranza; la cuenta anterior queda inactiva con historial.
-- El trigger de usuarios exige identidad con usuarios.gestionar incluso al aplicar una migración.
select set_config('request.jwt.claim.sub', (
  select u.id::text from public.usuarios u
  join public.roles_permisos rp on rp.rol_id = u.rol_id
  where u.activo and rp.permiso_codigo = 'usuarios.gestionar'
  order by u.id limit 1
), true);

update public.roles set nombre = 'Jefe de maestranza'
 where codigo = 'JEFE_TALLER';

update public.usuarios set rol_id = (select id from public.roles where codigo = 'JEFE_TALLER')
 where id = (select id from auth.users where lower(email) = 'jefe.maestranza@metalworkperusac.com')
   and activo;

update public.usuarios set activo = false
 where id = (select id from auth.users where lower(email) = 'jefe.taller@metalworkperusac.com')
   and activo;

select set_config('request.jwt.claim.sub', '', true);

-- Emitir OT corresponde a Administración; Diseño define materiales, el área los solicita.
delete from public.roles_permisos rp using public.roles r
 where rp.rol_id = r.id
   and ((r.codigo = 'JEFE_TALLER' and rp.permiso_codigo in ('ordenes.crear', 'ordenes.abrir_taller'))
     or (r.codigo = 'DISENO' and rp.permiso_codigo = 'requerimientos.crear'));

create or replace function public.crear_requerimiento_material(
  p_orden_id uuid, p_area_destino text, p_materiales uuid[]
) returns uuid language plpgsql security definer set search_path = 'public' as $$
declare v_requerimiento uuid; v_insertados integer;
begin
  perform public.exigir_permiso('requerimientos.crear');
  if p_area_destino not in ('MTZ', 'PRD', 'ACB') or coalesce(cardinality(p_materiales), 0) = 0
     or cardinality(p_materiales) > 100 then
    raise exception 'Elige un área y al menos un material de la orden.' using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from public.usuarios u join public.areas a on a.id = u.area_id
     where u.id = public.usuario_actual() and u.activo and a.codigo = p_area_destino
  ) then
    raise exception 'Solo el área que utilizará el material puede solicitarlo.' using errcode = 'insufficient_privilege';
  end if;
  if (select count(distinct x) from unnest(p_materiales) x) <> cardinality(p_materiales) then
    raise exception 'Hay materiales repetidos en la solicitud.' using errcode = 'unique_violation';
  end if;
  if not exists (select 1 from public.ordenes_trabajo o where o.id = p_orden_id and o.estado::text <> 'ANULADA') then
    raise exception 'La orden no existe o está anulada.' using errcode = 'foreign_key_violation';
  end if;
  if (select count(*) from public.ot_materiales m
       where m.id = any(p_materiales) and m.orden_id = p_orden_id and m.area_destino = p_area_destino)
       <> cardinality(p_materiales) then
    raise exception 'Cada material debe pertenecer a esta orden y al área elegida.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.requerimiento_material_detalles d
      where d.ot_material_id = any(p_materiales)
        and not exists (select 1 from public.requerimientos_materiales r
          where r.id = d.requerimiento_id and r.orden_id = p_orden_id and r.area_destino = p_area_destino)) then
    raise exception 'Uno de los materiales ya fue solicitado para otra área u orden.' using errcode = 'unique_violation';
  end if;
  insert into public.requerimientos_materiales (orden_id, area_destino, solicitado_por)
  values (p_orden_id, p_area_destino, public.usuario_actual())
  on conflict (orden_id, area_destino) do update set actualizado_en = now()
  returning id into v_requerimiento;
  insert into public.requerimiento_material_detalles (requerimiento_id, ot_material_id, cantidad_solicitada)
  select v_requerimiento, m.id, m.cantidad from public.ot_materiales m
   where m.id = any(p_materiales)
  on conflict (ot_material_id) do nothing;
  get diagnostics v_insertados = row_count;
  if v_insertados = 0 and not exists (
    select 1 from public.requerimiento_material_detalles d
     where d.requerimiento_id = v_requerimiento and d.ot_material_id = any(p_materiales)
  ) then
    raise exception 'No se agregó ningún material al requerimiento.' using errcode = 'check_violation';
  end if;
  return v_requerimiento;
end;
$$;
revoke all on function public.crear_requerimiento_material(uuid, text, uuid[]) from public, anon;
grant execute on function public.crear_requerimiento_material(uuid, text, uuid[]) to authenticated;
