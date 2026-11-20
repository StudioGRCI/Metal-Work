-- =============================================================================
-- STOCK DE SEGURIDAD, COMPRA POR MAYOR Y COMPRAS SIN DUPLICAR
-- -----------------------------------------------------------------------------
-- El documento de Almacén del 20/11/2026 pide dos cosas más:
--
--   3. Mantener un stock mínimo de los consumibles de alta rotación y comprar
--      por mayor los discos de corte, de desbaste y similares, para no quedarse
--      sin ellos ni comprar de emergencia.
--   4. Que las compras entren directo al almacén, el inventario esté al día y no
--      se compre dos veces lo mismo, verificando físicamente lo que llega antes
--      de darlo por disponible.
--
-- Lo que ya había: cada material puede llevar su stock mínimo, que fija
-- Almacén, y al cruzarlo el sistema avisa a Almacén y a Logística
-- (20261012102000). Lo comprado ya entra solo: el conductor lo deja en el
-- almacén, Almacén lo verifica y recién entonces pasa al kardex
-- (20261012120000). Lo que faltaba:
--
--   · Cuánto se compra de una vez al reponer (la compra por mayor), que también
--     fija Almacén junto al mínimo.
--   · Una lista de reposición para Almacén y Logística: cada material con
--     mínimo, compra por mayor o salidas en los últimos 90 días, con lo que hay,
--     lo que ya viene en otra OC (para no comprarlo dos veces), lo que salió en
--     90 días (para fijar bien el mínimo) y cuánto comprar si está bajo el
--     mínimo. Logística (`compras.crear`) recibe `almacen.stock`, el permiso de
--     ver el stock sin precios ni movimientos: compra mirando lo que hay.
--   · El aviso de stock bajo dice cuánto comprar y lleva a esa lista.
--   · Gerencia, al aprobar una OC, ve de cada material cuánto hay en el almacén,
--     cuánto ya viene en otras OC aprobadas y cuánto piden otras que todavía
--     esperan su aprobación, cada cosa aparte: si se leyeran juntas, Gerencia
--     podría rechazar cada una creyendo que las demás ya vienen.
--
-- «Viene en camino» es lo que una OC no rechazada ni anulada pidió y todavía no
-- entró al kardex: la que espera la aprobación, la que está por recoger y la que
-- el conductor dejó y Almacén aún no verificó.
--
-- Idempotente. Sin `drop`. `fn_avisar_stock_minimo` se reemplaza entera solo si
-- está como la dejó el repositorio (20261012102000) o como la deja esta.
-- =============================================================================

-- 1. La compra por mayor ---------------------------------------------------------
alter table public.materiales add column if not exists compra_por_mayor numeric(14, 3);
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.materiales'::regclass
                   and conname = 'ck_materiales_compra_por_mayor') then
    alter table public.materiales add constraint ck_materiales_compra_por_mayor
      check (compra_por_mayor is null or compra_por_mayor > 0);
  end if;
end $$;
comment on column public.materiales.compra_por_mayor is
  'Cuánto se compra de una vez al reponer el material (por caja, por ciento). Vacío: se repone hasta el mínimo. Lo fija Almacén.';

-- El mínimo y la compra por mayor juntos, con el permiso de Almacén, como
-- `fijar_stock_minimo` (que se queda para la pantalla de antes).
create or replace function public.fijar_stock_de_seguridad(p_material uuid, p_minimo numeric, p_por_mayor numeric)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid;
begin
  perform public.exigir_permiso('almacen.recibir');
  if p_minimo is not null and (p_minimo < 0 or p_minimo > 99999999999 or p_minimo <> round(p_minimo, 3)) then
    raise exception 'El stock mínimo es una cantidad de 0 en adelante, con hasta tres decimales.' using errcode = 'check_violation';
  end if;
  if p_por_mayor is not null and (p_por_mayor <= 0 or p_por_mayor > 99999999999 or p_por_mayor <> round(p_por_mayor, 3)) then
    raise exception 'La compra por mayor es una cantidad mayor que cero, con hasta tres decimales.' using errcode = 'check_violation';
  end if;
  update public.materiales set stock_minimo = p_minimo, compra_por_mayor = p_por_mayor
   where id = p_material and activo
  returning id into v_id;
  if v_id is null then
    raise exception 'El material no existe o está dado de baja.';
  end if;
  return v_id;
end;
$$;
revoke all on function public.fijar_stock_de_seguridad(uuid, numeric, numeric) from public, anon;
grant execute on function public.fijar_stock_de_seguridad(uuid, numeric, numeric) to authenticated;

-- 2. Logística ve el stock -------------------------------------------------------
insert into public.roles_permisos (rol_id, permiso_codigo)
select distinct rp.rol_id, 'almacen.stock'
  from public.roles_permisos rp
  join public.roles r on r.id = rp.rol_id
 where rp.permiso_codigo = 'compras.crear' and r.codigo = 'COMPRADOR'
on conflict do nothing;

-- 3. Lo que viene en camino ------------------------------------------------------
-- De cada material, lo que las OC abiertas pidieron y todavía no entró al
-- kardex, y en qué OC viene: aparte lo de las OC aprobadas (o que no la
-- necesitan) y lo de las que esperan a Gerencia. Sin permiso: lo usan las dos
-- funciones de abajo, cada una con el suyo. `p_sin` deja fuera una OC: la que
-- se está aprobando.
create or replace function public.en_camino_por_material(p_sin uuid default null)
returns table (material_id uuid, en_camino numeric, ocs text, por_aprobar numeric, ocs_por_aprobar text)
language sql stable security definer set search_path to 'public' as $$
  with pendiente as (
    select d.material_id, c.id as oc, public.nombre_de_oc(c.numero, c.referencia) as nombre, c.creado_en,
           c.aprobacion = 'POR_APROBAR' as espera,
           greatest(d.cantidad - coalesce((select sum(i.cantidad) from public.movimientos_materiales i
                                            where i.orden_compra_detalle_id = d.id and i.tipo = 'INGRESO'), 0), 0) as falta
      from public.orden_compra_material_detalles d
      join public.ordenes_compra_materiales c on c.id = d.orden_compra_id
     where c.aprobacion in ('NO_REQUERIDA', 'POR_APROBAR', 'APROBADA')
       and d.material_id is not null
       and (p_sin is null or c.id <> p_sin)
  )
  select p.material_id,
         coalesce(sum(p.falta) filter (where not p.espera), 0), string_agg(distinct p.nombre, ', ') filter (where not p.espera),
         coalesce(sum(p.falta) filter (where p.espera), 0), string_agg(distinct p.nombre, ', ') filter (where p.espera)
    from pendiente p
   where p.falta > 0
   group by p.material_id;
$$;
revoke all on function public.en_camino_por_material(uuid) from public, anon, authenticated;

-- 4. La lista de reposición ------------------------------------------------------
-- Cada material activo con mínimo, con compra por mayor o con salidas en los
-- últimos 90 días. Lo que hay es la existencia del kardex (la misma que mira el
-- aviso); lo libre es eso menos lo separado para los RQ y las OT. Lo que salió
-- en 90 días son las salidas menos lo que de ellas volvió. Comprar: si lo que
-- hay más lo que viene (aprobado o esperando a Gerencia, que ya se está
-- comprando) no llega al mínimo, la compra por mayor, o lo que falta
-- para el mínimo si es más (o si no hay compra por mayor); si no, nada.
-- Sin precios. La ven Almacén, Logística y quien ve el stock (`almacen.ver` o
-- `almacen.stock`).
create or replace function public.reposicion_de_stock()
returns table (material_id uuid, codigo text, descripcion text, unidad text, almacen text, categoria text,
               existencia numeric, libre numeric, en_camino numeric, en_camino_ocs text,
               por_aprobar numeric, por_aprobar_ocs text, stock_minimo numeric, compra_por_mayor numeric, salio_90_dias numeric, comprar numeric)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  -- Los mismos permisos que lo libre (`stock_libre_en_almacen`), que se lee aquí.
  if not (public.es_admin() or public.tiene_permiso('almacen.ver') or public.tiene_permiso('almacen.stock')) then
    raise exception 'No tienes permiso para ver la reposición de stock.' using errcode = 'insufficient_privilege';
  end if;
  return query
  with salio as (
    select coalesce(mov.material_id, om.material_id) as material_id,
           sum(case when mov.tipo in ('SALIDA', 'DESPACHO') then mov.cantidad
                    when mov.tipo = 'INGRESO' and mov.origen = 'DEVOLUCION' then -mov.cantidad
                    else 0 end) as cantidad
      from public.movimientos_materiales mov
      left join public.requerimiento_material_detalles d on d.id = mov.requerimiento_detalle_id
      left join public.ot_materiales om on om.id = d.ot_material_id
     where mov.registrado_en >= now() - interval '90 days'
     group by 1
  ), lista as (
    select m.id, m.stock_minimo, m.compra_por_mayor, greatest(coalesce(s.cantidad, 0), 0) as salio
      from public.materiales m
      left join salio s on s.material_id = m.id
     where m.activo and (m.stock_minimo is not null or m.compra_por_mayor is not null or coalesce(s.cantidad, 0) > 0)
  ), stock as (
    select x.* from public.stock_libre_en_almacen(array(select l.id from lista l)) x
  )
  select l.id, mat.codigo::text, mat.descripcion::text, um.codigo::text, cat.almacen::text, cat.nombre::text,
         coalesce(st.existencia, 0), coalesce(st.libre, 0), coalesce(c.en_camino, 0), c.ocs,
         coalesce(c.por_aprobar, 0), c.ocs_por_aprobar,
         l.stock_minimo, l.compra_por_mayor, l.salio,
         -- Lo que espera a Gerencia también cuenta: ya hay quien lo está comprando.
         case when l.stock_minimo is not null
                   and coalesce(st.existencia, 0) + coalesce(c.en_camino, 0) + coalesce(c.por_aprobar, 0) < l.stock_minimo
              then greatest(coalesce(l.compra_por_mayor, 0),
                            l.stock_minimo - coalesce(st.existencia, 0) - coalesce(c.en_camino, 0) - coalesce(c.por_aprobar, 0))
              else 0 end
    from lista l
    join public.materiales mat on mat.id = l.id
    left join public.unidades_medida um on um.id = mat.unidad_medida_id
    left join public.categorias_material cat on cat.id = mat.categoria_id
    left join stock st on st.material_id = l.id
    left join public.en_camino_por_material(null) c on c.material_id = l.id
   order by (l.stock_minimo is not null and coalesce(st.existencia, 0) < l.stock_minimo) desc,
            (l.stock_minimo is null), mat.descripcion;
end;
$$;
revoke all on function public.reposicion_de_stock() from public, anon;
grant execute on function public.reposicion_de_stock() to authenticated;

-- 5. Gerencia lo ve al aprobar ---------------------------------------------------
-- De cada línea de las OC que se le pasan: cuánto hay del material en el
-- almacén, cuánto ya viene en otras OC aprobadas y cuánto piden otras que
-- esperan su aprobación, y en cuáles. Lo ve quien aprueba compras y quien ve el
-- stock.
create or replace function public.stock_al_aprobar_compras(p_compras uuid[])
returns table (orden_compra_id uuid, material_id uuid, codigo text, existencia numeric, en_camino numeric, en_camino_ocs text,
               por_aprobar numeric, por_aprobar_ocs text)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
declare v_oc uuid;
begin
  if not (public.es_admin() or public.es_aprobador_compras() or public.tiene_permiso('almacen.ver')
          or public.tiene_permiso('almacen.stock')) then
    raise exception 'No tienes permiso para ver el stock de Almacén.' using errcode = 'insufficient_privilege';
  end if;
  foreach v_oc in array coalesce(p_compras, '{}') loop
    return query
    select v_oc, d.material_id, m.codigo::text, coalesce(e.existencia, 0)::numeric, coalesce(c.en_camino, 0), c.ocs,
           coalesce(c.por_aprobar, 0), c.ocs_por_aprobar
      from (select distinct x.material_id from public.orden_compra_material_detalles x
             where x.orden_compra_id = v_oc and x.material_id is not null) d
      join public.materiales m on m.id = d.material_id
      left join public.v_existencias_materiales e on e.material_id = d.material_id
      left join public.en_camino_por_material(v_oc) c on c.material_id = d.material_id;
  end loop;
end;
$$;
revoke all on function public.stock_al_aprobar_compras(uuid[]) from public, anon;
grant execute on function public.stock_al_aprobar_compras(uuid[]) to authenticated;

-- 6. El aviso de stock bajo dice cuánto comprar ---------------------------------
do $$
declare v_md5 text;
begin
  select md5(replace(p.prosrc, E'\r', '')) into v_md5 from pg_proc p
   where p.oid = 'public.fn_avisar_stock_minimo()'::regprocedure;
  if v_md5 not in ('c85153cc335ef0eb4eff22713449fdfc', '32c53d26840cd8d74ed14147746732a7') then
    raise exception 'fn_avisar_stock_minimo no está como la conoce el repositorio (md5 %): revísala antes de aplicar esta migración.', v_md5;
  end if;
end $$;

create or replace function public.fn_avisar_stock_minimo()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_material uuid;
  v_baja     numeric;
  v_saldo    numeric;
  v_mat      public.materiales%rowtype;
  v_titulo   text;
  v_cuerpo   text;
begin
  if tg_table_name = 'conteos_inventario' then
    v_material := new.material_id;
    v_baja := -new.ajuste;
  else
    if new.tipo not in ('DESPACHO', 'SALIDA') then
      return null;
    end if;
    v_material := coalesce(new.material_id, (
      select om.material_id from public.requerimiento_material_detalles d
        join public.ot_materiales om on om.id = d.ot_material_id
       where d.id = new.requerimiento_detalle_id));
    v_baja := new.cantidad;
  end if;
  if v_material is null or v_baja <= 0 then
    return null;
  end if;
  select * into v_mat from public.materiales where id = v_material;
  if v_mat.stock_minimo is null then
    return null;
  end if;
  v_saldo := public.saldo_material_interno(v_material);
  -- Solo al cruzar la línea: antes de este movimiento estaba en el mínimo o
  -- por encima, y ahora quedó por debajo.
  if v_saldo >= v_mat.stock_minimo or v_saldo + v_baja < v_mat.stock_minimo then
    return null;
  end if;
  v_titulo := 'Stock bajo: ' || v_mat.codigo;
  -- 12.500 se lee 12.5 y 3.000 se lee 3: sin ceros que no dicen nada.
  v_cuerpo := v_mat.descripcion || '. Quedan '
              || rtrim(rtrim(to_char(v_saldo, 'FM99999999990.000'), '0'), '.')
              || '; el mínimo es '
              || rtrim(rtrim(to_char(v_mat.stock_minimo, 'FM99999999990.000'), '0'), '.') || '.'
              -- La compra por mayor (migración 20261120420000), si Almacén la fijó.
              || coalesce(' Se compra por mayor: '
                          || rtrim(rtrim(to_char(v_mat.compra_por_mayor, 'FM99999999990.000'), '0'), '.') || '.', '');
  -- Un solo aviso por persona aunque tenga los dos permisos, a Almacén y a
  -- Logística y no a Administración (20261026160000). Lleva a la lista de
  -- reposición, que dice lo que viene en camino y cuánto comprar, a quien la
  -- puede abrir (`almacen.ver` o `almacen.stock`); a los demás, a Compras.
  insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
  select u.id, v_titulo, v_cuerpo,
         case when r.codigo = 'ADMIN' or exists (
                     select 1 from public.roles_permisos rp
                      where rp.rol_id = r.id and rp.permiso_codigo in ('almacen.ver', 'almacen.stock'))
              then '/almacen/reposicion'
              else '/compras' end,
         'materiales', v_material
    from public.usuarios u
    join public.roles r on r.id = u.rol_id
   where u.activo
     and (r.codigo = 'ADMIN' or exists (
            select 1 from public.roles_permisos rp
             where rp.rol_id = r.id
               and (rp.permiso_codigo = 'almacen.recibir'
                    or (rp.permiso_codigo = 'compras.crear'
                        and not exists (select 1 from public.roles_permisos x
                                         where x.rol_id = r.id and x.permiso_codigo = 'requerimientos.administracion')))));
  return null;
end;
$$;
revoke all on function public.fn_avisar_stock_minimo() from public, anon, authenticated;
