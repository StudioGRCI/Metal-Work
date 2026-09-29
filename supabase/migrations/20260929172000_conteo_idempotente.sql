-- Serializa los conteos del mismo material para que un reintento no duplique el ajuste.
create or replace function public.registrar_conteo_almacen(
  p_id uuid, p_material uuid, p_cantidad_fisica public.cantidad, p_motivo text
) returns uuid language plpgsql security definer set search_path = 'public' as $$
declare v_saldo numeric; v_conteo public.conteos_inventario%rowtype;
begin
  perform public.exigir_permiso('almacen.ver');
  if not exists (select 1 from public.usuarios u join public.areas a on a.id = u.area_id
      where u.id = public.usuario_actual() and u.activo and a.codigo = 'ALM') then
    raise exception 'Solo Almacén registra el conteo físico.' using errcode = 'insufficient_privilege';
  end if;
  if p_id is null or p_material is null or p_cantidad_fisica is null or p_cantidad_fisica < 0
     or length(btrim(coalesce(p_motivo, ''))) not between 10 and 300 then
    raise exception 'Indica cantidad física y un motivo de 10 a 300 caracteres.' using errcode = 'check_violation';
  end if;
  perform 1 from public.materiales where id = p_material and activo for update;
  if not found then raise exception 'El material no está activo.' using errcode = 'check_violation'; end if;
  select * into v_conteo from public.conteos_inventario where id = p_id;
  if found then
    if v_conteo.material_id = p_material and v_conteo.cantidad_fisica = p_cantidad_fisica
       and v_conteo.motivo = btrim(p_motivo) and v_conteo.registrado_por = public.usuario_actual()
       then return p_id; end if;
    raise exception 'El conteo ya existe con otros datos.' using errcode = 'unique_violation';
  end if;
  v_saldo := public.saldo_registrado_material(p_material);
  insert into public.conteos_inventario
    (id, material_id, cantidad_fisica, ajuste, motivo, registrado_por)
  values (p_id, p_material, p_cantidad_fisica, p_cantidad_fisica - v_saldo,
          btrim(p_motivo), public.usuario_actual());
  return p_id;
end;
$$;
revoke all on function public.registrar_conteo_almacen(uuid, uuid, public.cantidad, text) from public, anon;
grant execute on function public.registrar_conteo_almacen(uuid, uuid, public.cantidad, text) to authenticated;
