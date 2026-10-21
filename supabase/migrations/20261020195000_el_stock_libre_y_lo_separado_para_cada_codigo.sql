-- =============================================================================
-- EL STOCK LIBRE Y LO SEPARADO PARA CADA CÓDIGO INTERNO
-- -----------------------------------------------------------------------------
-- DKS pidió el 2026-10-20 dos cosas que van juntas:
--
--   1. Que el stock de Almacén tenga su apartado y se comparta con los
--      supervisores y con quien hace los requerimientos, para que vean qué hay
--      antes de pedir algo.
--   2. Que al revisar el stock de un requerimiento el sistema le diga a Almacén
--      cuánto hay sin código interno, para usar, «porque hay material que ya va
--      derivado a códigos internos».
--
-- Lo que va derivado a un código es lo que Almacén ya le dio a otro RQ y
-- todavía no entregó: lo que separó al revisar su stock
-- (`requerimiento_lineas.cantidad_en_stock`) y lo que se compró para él y ya
-- entró al kardex. Sigue en el almacén y cuenta en la existencia, pero no está
-- libre: es de ese código. Hasta hoy nada lo restaba —`rq_revisar_stock` no
-- reserva—, así que dos RQ podían separar el mismo stock sin que nadie lo viera.
--
-- `stock_libre_en_almacen()` dice, por material, cuánto hay, cuánto de eso ya
-- es de cada código (con los RQ que lo separaron) y cuánto queda libre. Es de
-- solo lectura, sin precios ni movimientos, con el mismo permiso que el stock
-- de la migración 20261016950000. Es una función nueva y no un cambio de
-- `stock_en_almacen()` porque devuelve otras columnas; aquella se queda igual,
-- para que la versión anterior de la pantalla no se caiga mientras se publica.
--
-- Cuánto de cada línea de un RQ abierto sigue separado en el almacén:
--
--   · RQ «Listo en almacén»: todo lo pedido está ahí para él.
--   · Si no: lo que Almacén separó al revisarlo, más lo que llegó al kardex de
--     su compra (los ingresos de su línea de OC; si esa línea junta insumos de
--     varios RQ, lo que llega se reparte en el orden en que se pidieron: por
--     fecha, y a la misma hora por número de RQ e ítem), sin pasar de lo pedido.
--   · Lo que llegó de la compra cuenta en el material comprado, que puede no
--     ser el pedido (otra marca, otra medida): lo separado de su stock, en el
--     pedido. Si no, lo comprado quedaba libre y el pedido, separado de más.
--   · Menos lo que ya se entregó: cada salida con esa línea, menos lo que de
--     ella volvió, de la parte de su mismo material. Y la línea nunca tiene
--     separado más de lo que le falta entregar, de cualquier material: si
--     salió otro (el pedido en vez del comprado), lo que no salió se suelta,
--     primero lo del stock general y después lo comprado para ella.
--
-- Los accesorios que entraron marcados para una unidad (la regla de la
-- migración 20261013140000) también son de su código; si un código aparece por
-- los dos lados se toma el mayor, para no contar dos veces lo mismo. Lo
-- reservado por los pedidos de OT del circuito anterior tampoco está libre.
-- Lo separado puede pasar lo que hay en el kardex (se separó dos veces lo mismo,
-- o salió por otro lado): entonces lo libre es cero y la pantalla lo avisa.
-- De cada código se dice aparte cuánto ya separaron sus RQ abiertos: al revisar
-- otro RQ del mismo código eso no está disponible para él, solo lo libre y el
-- accesorio que entró para la unidad y ningún RQ tomó.
--
-- Quién lo ve: los supervisores de área y el jefe de producción, que ya tenían
-- `almacen.stock`; quien lleva el kardex (`almacen.ver`), y desde hoy quien pide
-- por requerimiento: Requerimientos (`requerimientos.emitir`, el de operación) y
-- Administración (`requerimientos.administracion`, el de oficina). Reciben
-- `almacen.stock` y nada más: no abren el kardex ni mueven stock. Los números de
-- RQ solo salen a quien puede ver los requerimientos.
--
-- De paso se corrige `v_rq_lineas_para_salida`, la lista con la que Almacén
-- entrega por línea de RQ, que cuenta lo entregado con los mismos movimientos:
-- juntaba cada salida con sus devoluciones y la sumaba una vez por cada una.
-- Con 4 que salieron y dos devoluciones de 1 decía 6 entregados en vez de 2, y
-- `registrar_salida_material`, que se fía de su «pendiente», no dejaba entregar
-- lo que de verdad faltaba. Ahora es cada salida menos lo que de ella volvió.
--
-- Solo agrega: no retira ni borra nada.
-- =============================================================================

insert into public.permisos (codigo, modulo, descripcion) values
  ('almacen.stock', 'Almacén',
   'Ver cuánto hay de cada material en los cuatro almacenes, cuánto está libre y cuánto ya es de cada código interno, sin precios ni movimientos')
on conflict (codigo) do update set descripcion = excluded.descripcion;

-- Quien pide por requerimiento, sea del puesto que sea.
insert into public.roles_permisos (rol_id, permiso_codigo)
select distinct rp.rol_id, 'almacen.stock'
  from public.roles_permisos rp
 where rp.permiso_codigo in ('requerimientos.emitir', 'requerimientos.administracion')
on conflict do nothing;

create or replace function public.stock_libre_en_almacen(p_materiales uuid[] default null)
returns table (material_id uuid, codigo text, descripcion text, unidad text, almacen text, categoria text,
               existencia numeric, stock_minimo numeric, reservado_ot numeric, separado numeric, libre numeric,
               por_codigo jsonb)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_ve_rq boolean;
begin
  if not (public.es_admin() or public.tiene_permiso('almacen.stock') or public.tiene_permiso('almacen.ver')) then
    raise exception 'No tienes permiso para ver el stock de Almacén.' using errcode = 'insufficient_privilege';
  end if;
  v_ve_rq := public.puede_ver_requerimientos();

  return query
  with existencias as (
    select e.* from public.v_existencias_materiales e
     where p_materiales is null or e.material_id = any(p_materiales)
  ),
  -- Toda línea de un RQ abierto con material o con compra (un insumo escrito a
  -- mano antes del catálogo no tiene material, pero lo que llega de su compra
  -- sí es suyo), y las de los RQ ya entregados que comparten una línea de OC
  -- con uno abierto: el reparto de lo que llega de ella mira también a esos
  -- (los demás entregados no cambian nada y con el tiempo serían todo el
  -- histórico). No se filtra por material: lo comprado puede ser otro.
  oc_con_rq_abierto as (
    select distinct l.orden_compra_detalle_id as detalle
      from public.requerimiento_lineas l
      join public.requerimientos r on r.id = l.requerimiento_id
     where l.orden_compra_detalle_id is not null
       and r.estado in ('SIN_STOCK', 'EN_ATENCION', 'LISTO_EN_ALMACEN')
  ),
  lineas as (
    select l.id, l.material_id, l.item, l.cantidad::numeric as cantidad,
           coalesce(l.cantidad_en_stock, 0)::numeric as en_stock,
           l.orden_compra_detalle_id as detalle, r.numero, r.estado, r.creado_en,
           coalesce(public.normalizar_codigo_interno(r.codigo_interno), 'SIN CÓDIGO') as codigo
      from public.requerimiento_lineas l
      join public.requerimientos r on r.id = l.requerimiento_id
     where (l.material_id is not null or l.orden_compra_detalle_id is not null)
       and (r.estado in ('SIN_STOCK', 'EN_ATENCION', 'LISTO_EN_ALMACEN')
            or (r.estado = 'ENTREGADO'
                and l.orden_compra_detalle_id in (select o.detalle from oc_con_rq_abierto o)))
  ),
  -- Cuánto entró al kardex de cada línea de OC, y de qué material es.
  -- Lo que entró y lo que falta comprar se reparten con la misma regla que
  -- `entregado_de_requerimientos` (20261020191000), para que «Stock en almacén»
  -- y el avance del RQ digan lo mismo: si cambia una, cambia la otra.
  recibido as (
    select d.id as detalle, d.material_id,
           coalesce((select sum(m.cantidad::numeric) from public.movimientos_materiales m
                      where m.orden_compra_detalle_id = d.id and m.tipo = 'INGRESO'
                        and m.devolucion_de is null), 0) as cantidad
      from public.orden_compra_material_detalles d
     where d.id in (select l.detalle from lineas l where l.detalle is not null)
  ),
  con_compra as (
    select l.*,
           greatest(l.cantidad - l.en_stock, 0) as por_comprar,
           coalesce(sum(greatest(l.cantidad - l.en_stock, 0)) over (
             partition by l.detalle order by l.creado_en, l.numero, l.item, l.id
             rows between unbounded preceding and 1 preceding), 0) as antes
      from lineas l
  ),
  con_llegado as (
    select c.*, coalesce(rc.material_id, c.material_id) as material_comprado,
           least(c.por_comprar, greatest(coalesce(rc.cantidad, 0) - c.antes, 0)) as llegado
      from con_compra c
      left join recibido rc on rc.detalle = c.detalle
     where c.estado in ('SIN_STOCK', 'EN_ATENCION', 'LISTO_EN_ALMACEN')
  ),
  -- Cada línea abierta en dos partes: la que Almacén separó de su stock, del
  -- material pedido (todo lo que no llegó de la compra, si está listo), y la
  -- que llegó de su compra, del material comprado. Si las dos son del mismo
  -- material, una sola.
  partes as (
    select u.id, u.material_id, u.codigo, u.numero, sum(u.cantidad) as separado, min(u.orden) as orden
      from (select c.id, c.material_id, c.codigo, c.numero, 1 as orden,
                   case when c.estado = 'LISTO_EN_ALMACEN' then c.cantidad - c.llegado else c.en_stock end as cantidad
              from con_llegado c
             where c.material_id is not null
            union all
            select c.id, c.material_comprado, c.codigo, c.numero, 2, c.llegado
              from con_llegado c
             where c.llegado > 0) u
     group by u.id, u.material_id, u.codigo, u.numero
  ),
  -- Lo entregado de cada línea abierta, por material: cada salida con esa
  -- línea, menos lo que de ella volvió.
  entregas as (
    select s.requerimiento_linea_id as id, s.material_id,
           sum(s.cantidad::numeric - coalesce((select sum(d.cantidad::numeric) from public.movimientos_materiales d
                                                where d.devolucion_de = s.id and d.tipo = 'INGRESO'), 0)) as entregado
      from public.movimientos_materiales s
     where s.tipo = 'SALIDA' and s.requerimiento_linea_id in (select c.id from con_llegado c)
     group by s.requerimiento_linea_id, s.material_id
  ),
  -- Lo entregado se descuenta primero de la parte de su mismo material. Y la
  -- línea entera nunca tiene separado más de lo que le falta entregar (lo
  -- pedido menos todo lo entregado, de cualquier material): lo que sobra se
  -- recorta primero de la parte del pedido, que es stock general, y después de
  -- lo comprado para ella. Así, si Almacén entrega el pedido en vez de lo
  -- comprado, o un tercero, lo que no salió no queda separado para siempre; y
  -- si entrega de otro material antes de que llegue la compra, lo que separó
  -- del pedido sigue siendo de la línea mientras le falte.
  restos as (
    select p.id, p.material_id, p.codigo, p.numero, p.orden,
           greatest(p.separado - coalesce(e.entregado, 0), 0) as resto
      from partes p
      left join entregas e on e.id = p.id and e.material_id = p.material_id
  ),
  falta as (
    select c.id, greatest(c.cantidad - coalesce(t.entregado, 0), 0) as cantidad
      from con_llegado c
      left join (select e.id, sum(e.entregado) as entregado from entregas e group by e.id) t on t.id = c.id
  ),
  separado_de_cada_parte as (
    select r.material_id, r.codigo, r.numero,
           greatest(r.resto - greatest(sum(r.resto) over (partition by r.id) - f.cantidad
                                       - coalesce(sum(r.resto) over (partition by r.id order by r.orden
                                                    rows between unbounded preceding and 1 preceding), 0), 0), 0) as cantidad
      from restos r
      join falta f on f.id = r.id
  ),
  separado_por_linea as (
    select s.material_id, s.codigo, s.numero, s.cantidad
      from separado_de_cada_parte s
     where s.material_id in (select x.material_id from existencias x)
  ),
  -- Lo que entró marcado para una unidad: solo los accesorios, que solo salen
  -- para ella. «PLANTA» no es una unidad. La devolución no lleva el código: es
  -- el de la salida que devuelve, y vuelve a ser de esa unidad.
  de_kardex as (
    select u.material_id, u.codigo, sum(u.cantidad) as saldo
      from (select m.material_id,
                   public.normalizar_codigo_interno(coalesce(m.codigo_interno, o.codigo_interno)) as codigo,
                   case when m.tipo = 'INGRESO' then m.cantidad::numeric else -m.cantidad::numeric end as cantidad
              from public.movimientos_materiales m
              join existencias x on x.material_id = m.material_id and x.almacen = 'ACCESORIOS'
              left join public.movimientos_materiales o on o.id = m.devolucion_de) u
     where u.codigo is not null and u.codigo <> 'PLANTA'
     group by u.material_id, u.codigo
  ),
  -- De cada código: lo que es suyo y, aparte, cuánto de eso ya separaron sus
  -- RQ abiertos. Al revisar otro RQ del mismo código solo sirve la diferencia
  -- (el accesorio que entró para la unidad y ningún RQ tomó todavía): lo
  -- separado ya es de aquel RQ, y tomarlo otra vez lo separa dos veces.
  por_codigo as (
    select u.material_id, u.codigo,
           greatest(coalesce(max(u.del_kardex), 0), coalesce(sum(u.del_rq), 0)) as cantidad,
           coalesce(sum(u.del_rq), 0) as de_requerimientos,
           array_agg(distinct u.numero order by u.numero) filter (where u.numero is not null) as requerimientos
      from (select k.material_id, k.codigo, k.saldo as del_kardex, null::numeric as del_rq, null::text as numero
              from de_kardex k where k.saldo > 0
            union all
            select s.material_id, s.codigo, null, s.cantidad, s.numero
              from separado_por_linea s where s.cantidad > 0) u
     group by u.material_id, u.codigo
  )
  select e.material_id, e.codigo, e.descripcion, e.unidad, e.almacen, e.categoria,
         e.existencia::numeric, mat.stock_minimo::numeric, coalesce(e.reservado, 0)::numeric,
         coalesce(t.separado, 0),
         greatest(e.existencia::numeric - coalesce(e.reservado, 0) - coalesce(t.separado, 0), 0),
         coalesce(t.lista, '[]'::jsonb)
    from existencias e
    join public.materiales mat on mat.id = e.material_id
    -- Agrupado una vez y unido por material: dentro de un «lateral», Postgres
    -- rehacía todo el cálculo por cada material (60 s con 3000 materiales,
    -- 6000 líneas abiertas y 248 000 movimientos; así, 1,4 s).
    left join (
      select c.material_id, sum(c.cantidad) as separado,
             jsonb_agg(jsonb_build_object(
               'codigo', c.codigo,
               'cantidad', c.cantidad,
               'de_requerimientos', c.de_requerimientos,
               'requerimientos', case when v_ve_rq then to_jsonb(coalesce(c.requerimientos, '{}'::text[])) else '[]'::jsonb end
             ) order by c.codigo) as lista
        from por_codigo c
       group by c.material_id
    ) t on t.material_id = e.material_id;
end $$;
revoke all on function public.stock_libre_en_almacen(uuid[]) from public, anon;
grant execute on function public.stock_libre_en_almacen(uuid[]) to authenticated;

comment on function public.stock_libre_en_almacen(uuid[]) is
  'El stock de cada material con kardex, sin precios: cuánto hay, cuánto ya es de cada código interno (lo separado para un RQ abierto y no entregado, y los accesorios que entraron para una unidad) y cuánto queda libre. Con almacen.stock (Supervisión, Requerimientos, Administración) o almacen.ver. p_materiales filtra por material.';

-- Lo entregado de cada línea, para la salida del kardex: cada salida, menos lo
-- que de ella volvió. Mismas columnas y en el mismo orden que en la 20261016600000.
create or replace view public.v_rq_lineas_para_salida with (security_invoker = true) as
select l.id as linea_id, r.id as requerimiento_id, r.numero, r.codigo_interno, a.nombre as area, r.estado,
       r.fecha_requerida, l.item, l.descripcion, l.cantidad::numeric as cantidad, um.codigo as unidad,
       c.nombre as categoria, c.almacen,
       coalesce(s.entregado, 0)::numeric as entregado,
       greatest(l.cantidad - coalesce(s.entregado, 0), 0)::numeric as pendiente,
       l.material_id
  from public.requerimiento_lineas l
  join public.requerimientos r on r.id = l.requerimiento_id
  join public.areas a on a.id = r.area_id
  join public.unidades_medida um on um.id = l.unidad_medida_id
  join public.categorias_material c on c.id = l.categoria_id
  left join lateral (
    select sum(m.cantidad - coalesce((select sum(d.cantidad) from public.movimientos_materiales d
                                       where d.devolucion_de = m.id and d.tipo = 'INGRESO'), 0)) as entregado
      from public.movimientos_materiales m
     where m.requerimiento_linea_id = l.id and m.tipo = 'SALIDA') s on true
 where r.estado not in ('ANULADO', 'ENTREGADO');
revoke all on public.v_rq_lineas_para_salida from public, anon;
grant select on public.v_rq_lineas_para_salida to authenticated;
