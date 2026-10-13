-- Almacén carga la planilla escribiendo solo la descripción y la cantidad.
--
-- El 13/10/2026 Almacén llenó la planilla con lo que contó en el almacén de
-- accesorios: el nombre de cada material copiado del catálogo y cuánto hay,
-- sin código, sin fecha y sin guía. La planilla lo rechazó entera, fila por
-- fila, porque exigía el código. Y aunque lo hubiera tenido, casi todos esos
-- materiales son del catálogo importado con la unidad todavía provisional, y
-- la planilla solo buscaba entre los de unidad confirmada.
--
-- Desde hoy una fila de ingresos puede traer solo la descripción y la
-- cantidad. La aplicación busca el material por su nombre en todo el catálogo
-- activo y, si no lo encuentra o hay varios parecidos, Almacén elige antes de
-- registrar. Esta función hace lo que queda en la base, en una sola
-- transacción:
--
--   * Con el material elegido: si su unidad seguía provisional, contarlo es
--     confirmarla (la que escribió Almacén, o la que ya tenía). Desde ese
--     momento aparece en salidas, conteos y planillas como cualquier otro.
--   * Sin material: igual que el ingreso libre, se busca uno activo con el
--     mismo nombre y la misma unidad, y si no hay se da de alta en «POR
--     CLASIFICAR» con un código provisional.
--
-- El ingreso en sí pasa por `registrar_ingreso_planilla`, que comprueba el
-- permiso, la fecha, que no haya un conteo posterior y que volver a cargar la
-- misma fila no la duplique.

create or replace function public.registrar_ingreso_planilla_libre(
  p_id uuid, p_material uuid, p_material_nuevo uuid, p_descripcion text, p_unidad uuid,
  p_cantidad numeric, p_origen text, p_documento text, p_precio numeric, p_moneda text, p_fecha timestamptz
) returns uuid language plpgsql security definer set search_path = 'public' as $$
declare
  v_descripcion text := upper(regexp_replace(btrim(coalesce(p_descripcion, '')), '\s+', ' ', 'g'));
  v_material uuid;
  v_categoria uuid;
  v_actual public.materiales%rowtype;
begin
  perform public.exigir_permiso('almacen.recibir');
  if p_id is null then
    raise exception 'La fila de la planilla no tiene identificador. Vuelve a cargarla.' using errcode = 'check_violation';
  end if;

  -- Reintento de la misma fila: el ingreso ya entró, se devuelve el mismo.
  select material_id into v_material from public.movimientos_materiales where id = p_id;
  if found then
    return public.registrar_ingreso_planilla(p_id, v_material, p_cantidad, p_origen, p_documento, p_precio, p_moneda, p_fecha);
  end if;

  if p_unidad is not null and not exists (select 1 from public.unidades_medida where id = p_unidad and activo) then
    raise exception 'La unidad escrita en la planilla no está registrada.' using errcode = 'check_violation';
  end if;

  if p_material is not null then
    select * into v_actual from public.materiales where id = p_material and activo for update;
    if not found then
      raise exception 'El material elegido ya no está activo. Vuelve a cargar la planilla.' using errcode = 'check_violation';
    end if;
    v_material := p_material;
  else
    if p_material_nuevo is null or length(v_descripcion) not between 3 and 200 then
      raise exception 'Escribe la descripción del material (de 3 a 200 letras).' using errcode = 'check_violation';
    end if;
    if p_unidad is null then
      raise exception 'Indica la unidad en que se cuenta el material nuevo.' using errcode = 'check_violation';
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
              'Dado de alta por Almacén al cargar la planilla; falta clasificarlo.')
      on conflict (id) do nothing;
      v_material := p_material_nuevo;
    end if;
    select * into v_actual from public.materiales where id = v_material for update;
  end if;

  -- Contarlo confirma la unidad que seguía provisional.
  if v_actual.unidad_pendiente then
    if p_unidad is not null and p_unidad <> v_actual.unidad_medida_id
       and exists (select 1 from public.movimientos_materiales where material_id = v_material) then
      raise exception 'El material % ya tiene movimientos en su unidad: no se puede cambiar desde la planilla.', v_actual.codigo
        using errcode = 'check_violation';
    end if;
    update public.materiales
       set unidad_medida_id = coalesce(p_unidad, unidad_medida_id), unidad_pendiente = false
     where id = v_material;
  elsif p_unidad is not null and p_unidad <> v_actual.unidad_medida_id then
    raise exception 'El material % se cuenta en otra unidad. Corrige la unidad en la planilla o déjala vacía.', v_actual.codigo
      using errcode = 'check_violation';
  end if;

  return public.registrar_ingreso_planilla(p_id, v_material, p_cantidad, p_origen, p_documento, p_precio, p_moneda, p_fecha);
end;
$$;
revoke all on function public.registrar_ingreso_planilla_libre(uuid, uuid, uuid, text, uuid, numeric, text, text, numeric, text, timestamptz) from public, anon;
grant execute on function public.registrar_ingreso_planilla_libre(uuid, uuid, uuid, text, uuid, numeric, text, text, numeric, text, timestamptz) to authenticated;
