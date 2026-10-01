-- Fijar el precio del almacén y fijar la merma tienen dueño: Logística y
-- Diseño e Ingeniería. Hasta hoy colgaban de `compras.crear` y `diseno.planos`,
-- que Gerencia también tiene, así que Gerencia podía cambiar el precio de un
-- material o la merma de una OT sin ser de esas áreas. La empresa pidió quitarlo
-- el 2026-10-01: Gerencia mira el costo, no lo arma.
--
-- No se le quitan a Gerencia `compras.crear` ni `diseno.planos`: con ellos lee
-- planos, informes y documentos de compra que hoy consulta. Se crea un permiso
-- por tarea y se da solo al área que la hace:
--
--   almacen.valorizar  Logística (COMPRADOR)            valorizar_material
--   diseno.merma       Diseño e Ingeniería (DISENO,      fijar_merma_ot
--                      DISENO_LIDER)
--
-- Sin DROP: el servidor de Supabase pide confirmarlo y la sesión que aplica la
-- migración se queda colgada (ver la skill `datos`). La política se cambia con
-- ALTER POLICY.

-- 1. Los permisos y a quién se dan -------------------------------------------
insert into public.permisos(codigo, modulo, descripcion) values
  ('almacen.valorizar', 'Almacén', 'Fijar el precio de los materiales del almacén que nunca se compraron por el sistema'),
  ('diseno.merma', 'Diseño', 'Evaluar y fijar el porcentaje de merma de material de una OT')
on conflict (codigo) do nothing;

insert into public.roles_permisos(rol_id, permiso_codigo)
select r.id, p.codigo
  from public.roles r
  join (values ('COMPRADOR', 'almacen.valorizar'), ('DISENO', 'diseno.merma'), ('DISENO_LIDER', 'diseno.merma')) as p(rol, codigo)
    on p.rol = r.codigo
on conflict do nothing;

-- 2. Logística valoriza con su permiso ----------------------------------------
create or replace function public.valorizar_material(p_id uuid, p_material uuid, p_precio numeric, p_moneda text, p_observacion text default '')
returns uuid language plpgsql security definer set search_path = 'public' as $$
declare v public.valorizaciones_material%rowtype;
begin
  perform public.exigir_permiso('almacen.valorizar');
  if p_id is null or p_material is null or p_precio is null or p_precio < 0 or p_precio <> round(p_precio, 4)
     or p_moneda is null or p_moneda not in ('PEN','USD') or length(coalesce(p_observacion, '')) > 300 then
    raise exception 'Indica el material, su precio unitario y la moneda.';
  end if;
  select * into v from public.valorizaciones_material where id = p_id;
  if found then
    if v.material_id = p_material and v.precio = p_precio and v.moneda = p_moneda and v.registrado_por = public.usuario_actual() then
      return p_id;
    end if;
    raise exception 'Ese precio ya se registró con otros datos. Recarga la pantalla.';
  end if;
  perform 1 from public.materiales where id = p_material and activo;
  if not found then raise exception 'El material no está activo.'; end if;
  insert into public.valorizaciones_material(id, material_id, precio, moneda, observacion)
  values (p_id, p_material, p_precio, p_moneda, btrim(coalesce(p_observacion, '')));
  return p_id;
end $$;
revoke all on function public.valorizar_material(uuid, uuid, numeric, text, text) from public, anon;
grant execute on function public.valorizar_material(uuid, uuid, numeric, text, text) to authenticated;

-- La lista la lee quien valoriza, Almacén y Costos.
create or replace function public.materiales_para_valorizar()
returns table (material_id uuid, codigo text, descripcion text, unidad text, existencia numeric,
               ultima_compra numeric, moneda_compra text, precio numeric, moneda text, valorizado_en timestamptz)
language plpgsql stable security definer set search_path = 'public' as $$
begin
  if not (public.es_admin() or public.tiene_permiso('almacen.valorizar') or public.tiene_permiso('almacen.ver') or public.tiene_permiso('costos.ver')) then
    raise exception 'No tienes permiso para ver la valorización del almacén.' using errcode = 'insufficient_privilege';
  end if;
  return query
  select e.material_id, e.codigo, e.descripcion, e.unidad, e.existencia::numeric,
         c.precio_unitario::numeric, c.moneda, v.precio, v.moneda, v.vigente_desde
    from public.v_existencias_materiales e
    left join lateral (
      select cd.precio_unitario, oc.moneda
        from public.orden_compra_material_detalles cd
        join public.ordenes_compra_materiales oc on oc.id = cd.orden_compra_id
        join public.requerimiento_material_detalles rd on rd.id = cd.requerimiento_detalle_id
        join public.ot_materiales om on om.id = rd.ot_material_id
       where om.material_id = e.material_id and cd.precio_unitario is not null
       order by oc.creado_en desc limit 1) c on true
    left join lateral (
      select x.precio, x.moneda, x.vigente_desde from public.valorizaciones_material x
       where x.material_id = e.material_id order by x.vigente_desde desc, x.id desc limit 1) v on true
   order by e.descripcion;
end $$;
revoke all on function public.materiales_para_valorizar() from public, anon;
grant execute on function public.materiales_para_valorizar() to authenticated;

alter policy ver_valorizaciones_material on public.valorizaciones_material using (
  public.es_admin() or public.tiene_permiso('almacen.valorizar') or public.tiene_permiso('compras.ver')
  or public.tiene_permiso('almacen.ver') or public.tiene_permiso('costos.ver'));

-- 3. Diseño fija la merma con su permiso --------------------------------------
create or replace function public.fijar_merma_ot(p_orden uuid, p_porcentaje numeric, p_motivo text)
returns uuid language plpgsql security definer set search_path = 'public' as $$
begin
  perform public.exigir_permiso('diseno.merma');
  if not public.puede_ver_orden(p_orden) then
    raise exception 'No tienes acceso a esta OT.' using errcode = 'insufficient_privilege';
  end if;
  if p_porcentaje is null or p_porcentaje < 0 or p_porcentaje > 100 or p_porcentaje <> round(p_porcentaje, 2)
     or length(btrim(coalesce(p_motivo, ''))) not between 5 and 300 then
    raise exception 'Indica un porcentaje de 0 a 100 y cómo se evaluó (de 5 a 300 caracteres).';
  end if;
  perform 1 from public.ordenes_trabajo where id = p_orden and estado::text not in ('ANULADA','ENTREGADA','FACTURADA');
  if not found then raise exception 'La OT está cerrada; su merma ya no cambia.'; end if;
  insert into public.ot_mermas(orden_id, porcentaje, motivo)
  values (p_orden, p_porcentaje, btrim(p_motivo))
  on conflict (orden_id) do update set porcentaje = excluded.porcentaje, motivo = excluded.motivo,
    registrado_por = public.usuario_actual(), registrado_en = now();
  return p_orden;
end $$;
revoke all on function public.fijar_merma_ot(uuid, numeric, text) from public, anon;
grant execute on function public.fijar_merma_ot(uuid, numeric, text) to authenticated;

-- Quien la fija la ve, además de Diseño y Costos.
alter policy ver_ot_mermas on public.ot_mermas using (
  public.puede_ver_orden(orden_id)
  and (public.es_admin() or public.tiene_permiso('diseno.merma') or public.tiene_permiso('diseno.planos') or public.tiene_permiso('costos.ver')));
