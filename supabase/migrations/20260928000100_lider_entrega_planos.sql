-- Nombre de la persona que coordina la entrega de planos en cada OT.
alter table public.ordenes_trabajo
  add column if not exists diseno_lider_entrega_nombre text;

alter table public.ordenes_trabajo
  drop constraint if exists ordenes_trabajo_diseno_lider_entrega_nombre_check;
alter table public.ordenes_trabajo
  add constraint ordenes_trabajo_diseno_lider_entrega_nombre_check
  check (diseno_lider_entrega_nombre is null or
    (length(diseno_lider_entrega_nombre) between 2 and 120 and
     diseno_lider_entrega_nombre = btrim(diseno_lider_entrega_nombre)));

create or replace function public.guardar_lider_entrega_planos(p_orden uuid, p_nombre text)
returns text language plpgsql security definer set search_path = 'public' as $$
declare v_nombre text := nullif(btrim(p_nombre), '');
declare v_filas integer;
begin
  perform public.exigir_permiso('diseno.planos');
  if not public.puede_ver_orden(p_orden) then
    raise exception 'La orden no está dentro de tu alcance.' using errcode = 'insufficient_privilege';
  end if;
  if v_nombre is null or length(v_nombre) < 2 or length(v_nombre) > 120 then
    raise exception 'Escribe el nombre completo del líder (entre 2 y 120 caracteres).' using errcode = 'check_violation';
  end if;
  update public.ordenes_trabajo
     set diseno_lider_entrega_nombre = v_nombre
   where id = p_orden and estado not in ('BORRADOR', 'ENTREGADA', 'FACTURADA', 'ANULADA');
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception 'La orden no está abierta para actualizar el equipo de Diseño.' using errcode = 'check_violation';
  end if;
  return v_nombre;
end;
$$;
revoke all on function public.guardar_lider_entrega_planos(uuid, text) from public, anon;
grant execute on function public.guardar_lider_entrega_planos(uuid, text) to authenticated;
