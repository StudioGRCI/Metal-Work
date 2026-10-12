-- Almacén registra un ingreso escribiendo el material, sin buscarlo en el catálogo.
--
-- El catálogo importado no tiene todo lo que entra al almacén, y obligar a
-- elegirlo frenaba el ingreso: lo que no estaba no se podía registrar y, sin
-- saldo, tampoco se podía sacar. Desde hoy el almacenero escribe el nombre y la
-- unidad; si ya existe un material activo con ese nombre y esa unidad se usa
-- ese, y si no, se da de alta en «POR CLASIFICAR» con un código provisional.
-- Desde ese momento tiene saldo y aparece en las salidas como cualquier otro.
-- Ordenarlo en su categoría y con su código definitivo queda para después.

insert into public.categorias_material (codigo, nombre, activo)
values ('ALM_POR_CLASIFICAR', 'POR CLASIFICAR', true)
on conflict (codigo) do nothing;

create or replace function public.registrar_ingreso_material_libre(
  p_id uuid, p_material_nuevo uuid, p_descripcion text, p_unidad uuid,
  p_cantidad numeric, p_origen text, p_documento text, p_precio numeric, p_moneda text
) returns uuid language plpgsql security definer set search_path = 'public' as $$
declare
  v_descripcion text := upper(regexp_replace(btrim(coalesce(p_descripcion, '')), '\s+', ' ', 'g'));
  v_material uuid;
  v_categoria uuid;
begin
  perform public.exigir_permiso('almacen.recibir');
  if p_id is null or p_material_nuevo is null or length(v_descripcion) not between 3 and 200 then
    raise exception 'Escribe el nombre del material (de 3 a 200 letras).' using errcode = 'check_violation';
  end if;
  if p_origen is null or p_origen not in ('SALDO_INICIAL', 'INGRESO_GENERAL') then
    raise exception 'Un material escrito a mano entra como ingreso general o saldo inicial.' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.unidades_medida where id = p_unidad and activo) then
    raise exception 'Elige la unidad en que se cuenta el material.' using errcode = 'check_violation';
  end if;

  -- Reintento del mismo envío: el ingreso ya entró.
  if exists (select 1 from public.movimientos_materiales where id = p_id) then
    select material_id into v_material from public.movimientos_materiales where id = p_id;
    return public.registrar_ingreso_almacen(p_id, v_material, p_cantidad, p_origen, p_documento, p_precio, p_moneda, null);
  end if;

  -- El mismo nombre con la misma unidad es el mismo material: no se duplica.
  select id into v_material from public.materiales
   where activo and unidad_medida_id = p_unidad
     and upper(regexp_replace(btrim(descripcion), '\s+', ' ', 'g')) = v_descripcion
   order by creado_en limit 1;

  if v_material is null then
    select id into v_categoria from public.categorias_material where codigo = 'ALM_POR_CLASIFICAR';
    insert into public.materiales (id, codigo, descripcion, categoria_id, unidad_medida_id, activo, creado_por, observaciones)
    values (p_material_nuevo, 'PROV-' || upper(left(replace(p_material_nuevo::text, '-', ''), 10)), v_descripcion,
            v_categoria, p_unidad, true, public.usuario_actual(),
            'Dado de alta por Almacén al registrar un ingreso; falta clasificarlo.')
    on conflict (id) do nothing;
    v_material := p_material_nuevo;
  end if;

  return public.registrar_ingreso_almacen(p_id, v_material, p_cantidad, p_origen, p_documento, p_precio, p_moneda, null);
end;
$$;
revoke all on function public.registrar_ingreso_material_libre(uuid, uuid, text, uuid, numeric, text, text, numeric, text) from public, anon;
grant execute on function public.registrar_ingreso_material_libre(uuid, uuid, text, uuid, numeric, text, text, numeric, text) to authenticated;
