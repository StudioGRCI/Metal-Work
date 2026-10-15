-- =============================================================================
-- SUPERVISIÓN VE EL STOCK DE ALMACÉN
-- -----------------------------------------------------------------------------
-- Maestranza pidió el 2026-10-15 ver el stock de material tal como lo reporta
-- Almacén, para saber qué hay antes de pedirlo y qué le van a entregar. Gerencia
-- lo extendió a todos los supervisores de área.
--
-- El supervisor no tiene `almacen.ver`, y no conviene dárselo: ese permiso abre
-- el kardex entero —cada ingreso y cada salida, quién recibió, los documentos y
-- la planilla—, que es el trabajo del almacenero. Lo que Supervisión necesita es
-- menos: cuánto hay de cada material y en cuál de los cuatro almacenes, sin
-- precios ni movimientos.
--
-- `almacen.stock` da eso y nada más, por una sola función de lectura,
-- `stock_en_almacen()`. Lee el mismo saldo que el kardex
-- (`v_existencias_materiales`: ingresos menos salidas, más los ajustes del
-- conteo físico), así que dice exactamente lo que Almacén ve. Los accesorios
-- entran atados al código interno de la unidad para la que se compraron y solo
-- salen para ella (migración 20261013140000): la función dice cuánto de cada
-- accesorio es de cada código, que es como trabaja Supervisión.
--
-- Lo reciben los supervisores de área (SUPERVISOR) y el jefe de producción
-- (JEFE_PRODUCCION), que hace el mismo trabajo para todas las áreas. Quien ya
-- tiene `almacen.ver` (Almacén, Supervisión general, Gerencia, Contabilidad) la
-- lee también: no ve nada que el kardex no le muestre ya.
--
-- No retira ni borra nada: el conector de producción se cuelga con esas sentencias.
-- =============================================================================

insert into public.permisos (codigo, modulo, descripcion) values
  ('almacen.stock', 'Almacén',
   'Ver cuánto hay de cada material en los cuatro almacenes y de qué código interno es cada accesorio, sin precios ni movimientos')
on conflict (codigo) do nothing;

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, 'almacen.stock'
  from public.roles r
 where r.codigo in ('SUPERVISOR', 'JEFE_PRODUCCION')
on conflict do nothing;

-- El stock de cada material que tiene kardex. `por_codigo` solo para los
-- accesorios: [{"codigo": "MW-0123", "cantidad": 2}, …], lo que entró para cada
-- unidad menos lo que ya salió para ella. Lo que no está en esa lista es libre.
create or replace function public.stock_en_almacen()
returns table (material_id uuid, codigo text, descripcion text, unidad text, almacen text, categoria text,
               existencia numeric, stock_minimo numeric, por_codigo jsonb)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  if not (public.es_admin() or public.tiene_permiso('almacen.stock') or public.tiene_permiso('almacen.ver')) then
    raise exception 'No tienes permiso para ver el stock de Almacén.' using errcode = 'insufficient_privilege';
  end if;

  return query
  with de_codigo as (
    -- La misma cuenta con que `registrar_salida_material` no deja sacar un
    -- accesorio para otra unidad. «PLANTA» no es una unidad.
    select m.material_id, upper(btrim(m.codigo_interno)) as codigo,
           sum(case when m.tipo = 'INGRESO' then m.cantidad::numeric else -m.cantidad::numeric end) as saldo
      from public.movimientos_materiales m
     where m.material_id is not null
       and nullif(btrim(m.codigo_interno), '') is not null
       and upper(btrim(m.codigo_interno)) <> 'PLANTA'
     group by m.material_id, upper(btrim(m.codigo_interno))
  )
  select e.material_id, e.codigo, e.descripcion, e.unidad, e.almacen, e.categoria,
         e.existencia::numeric, mat.stock_minimo::numeric,
         case when e.almacen = 'ACCESORIOS' then
           coalesce((select jsonb_agg(jsonb_build_object('codigo', c.codigo, 'cantidad', c.saldo) order by c.codigo)
                       from de_codigo c
                      where c.material_id = e.material_id and c.saldo > 0), '[]'::jsonb)
         else '[]'::jsonb end
    from public.v_existencias_materiales e
    join public.materiales mat on mat.id = e.material_id;
end $$;
revoke all on function public.stock_en_almacen() from public, anon;
grant execute on function public.stock_en_almacen() to authenticated;

comment on function public.stock_en_almacen() is
  'El stock de cada material con kardex, como lo reporta Almacén, sin precios: con almacen.stock (Supervisión) o almacen.ver.';
