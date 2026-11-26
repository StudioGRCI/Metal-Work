-- =============================================================================
-- LAS PANTALLAS PESADAS PLANIFICAN SUS CÁLCULOS UNA SOLA VEZ
-- -----------------------------------------------------------------------------
-- El 26/11, entre las 11:18 y las 11:31 (hora de Lima), producción dio error en
-- muchas pantallas. Cada migración hace que la API vuelva a leer el esquema, y
-- esa lectura tiene ocho segundos; con la base ocupada en las pantallas más
-- pesadas a la vez (Códigos internos, el costo de cada código, el avance de las
-- OT en Inicio y en Órdenes), no le alcanzaron. DKS eligió aligerar esas
-- pantallas sin cambiar lo que muestran ni quién las ve.
--
-- Lo que pesaba no eran los datos: con 21 OT el costeo entero son unas
-- decenas de filas. Pesaba volver a planificar, en cada llamada, diecisiete
-- cálculos escritos como funciones `language sql`. Postgres 17 no guarda entre
-- llamadas el plan de una función SQL, y la que lleva `set search_path` tampoco
-- se puede incrustar en la consulta que la llama: la vuelve a preparar cada vez
-- que se usa, y el avance de las OT llamaba al del código 21 veces por página.
-- Una función plpgsql guarda el plan de cada consulta durante la conexión.
--
-- Aquí cada una pasa a plpgsql con el MISMO cuerpo, palabra por palabra,
-- envuelto en `return query`. No cambia ninguna fila, ninguna columna, ningún
-- tipo ni ningún permiso: `create or replace` conserva el dueño, los `grant` y
-- el comentario, y cada una vuelve a declarar su `set search_path`. Medido en producción dentro de una
-- transacción que se deshizo, con la cuenta de Gerencia: la misma huella md5
-- de la lista de códigos, del costo, del resumen y del avance de las OT antes
-- y después; con la conexión ya en uso, la lista de códigos baja de 65 a 34 ms,
-- el costo de 33 a 19 ms y el avance de las 21 OT de 35 a 8 ms. Los tipos de
-- cada cuerpo se compararon con los que declara la función antes de
-- cambiarla: `return query` no convierte tipos como lo hace una función SQL.
--
-- Guarda: si producción tiene otro texto en alguna de ellas (un arreglo pegado
-- a mano en el editor), la migración se detiene y lo dice, en vez de pisarlo.
-- Acepta el texto de antes y el de esta migración, para poder repetirla.
-- El check 490 vigila que sigan en plpgsql: una migración que copie la
-- versión vieja de una de ellas devolvería el costo de planificarla.
-- =============================================================================

do $$
declare
  v record;
  v_actual text;
begin
  for v in
    select * from (values
    ('anexos_de_la_factura', '89a84f28af75d255f50b13b48e5e632f', '1658f44ff3e7933f8701837a918f1148'),
    ('codigo_interno_actividades_estado', '744754829a805d68c4d2592d3642a72a', '1c810f7e940a68f39fe0dc7c425971bc'),
    ('codigo_interno_avance_calculado', '2dd810cd7b5db303dd2ba3e9967d31b4', '636163b04d438a31f9ac1334ab5a2c3b'),
    ('codigo_interno_avance_planos_calculado', '9b36fe2135c02e8821bb9255f978bb27', '785e5da4d05411dd1fb48131c2169092'),
    ('codigo_interno_lineas_caja', 'fc4273898e4d5ba6121c66ddb46f60b1', '49c16fe1636344a29779b504eb9c38d8'),
    ('codigo_interno_lineas_gastos_ot', 'f3c850ad5789986c70ee695be067a6a8', '137e9c479667e1ecbb7d998867d608f0'),
    ('codigo_interno_lineas_igv_de_parte', 'b3177bf7b93c51a519b6384d4a7688aa', 'd2d5e275f22c29843d4057051224c551'),
    ('codigo_interno_lineas_nota_credito', 'e909ac528b8c9e2f7d47276b909f435e', '25a35c410808f07e54707dfda8b35d9b'),
    ('codigo_interno_lineas_planilla', 'b7a27d751786a6fb6fdbaf38a2c9f72d', 'ebbbddb776c9b89ad4dd203a4969b066'),
    ('codigo_interno_lineas_recargo', '94023b9942888688f97e61ef092b00af', '03446d7367d658c8039c7bc6401b1478'),
    ('codigo_interno_lineas_servicio', '078a8ddf4161eacfdb0a800fd5c40c23', '1fed61b528ee23fe13b4d2f6b57d8dec'),
    ('codigo_interno_lineas_subcontrato', '304e51d120922b1b81deb70aae245c18', '9cd399dcc162f4b417c2baf7129e8cd5'),
    ('codigo_interno_resto_por_area_calculado', '5653729310f35c107a80e971e589b06b', 'c6c833145fb14a17aa56e75ff6565507'),
    ('horas_por_codigo_del_mes', 'ba2bfd6ad4128cbda8d591ed11830d4f', 'bda0b38a3ab023c4b3a918da25a1f513'),
    ('planilla_al_costo', '213635d981860eb9c3da26858bbd4a7c', '872545e02b67235abd99c9a2df9da850'),
    ('precio_de_salida', '4b291ab816886df37f695fa4b2d82021', 'ced708f9fb76616e97b5ac6c72ee3497'),
    ('sueldos_oficina_del_mes', '1d6ef6c1ca35cfa9bcbc3367cf9923dc', '020e773c777505f8d635fb065f42f11d')
    ) as t(nombre, antes, despues)
  loop
    select md5(replace(p.prosrc, E'\r', '')) into v_actual
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname = v.nombre;
    if v_actual is null then
      raise exception 'No existe la función public.%: esta migración la espera.', v.nombre;
    end if;
    if v_actual not in (v.antes, v.despues) then
      raise exception 'La función public.% tiene en esta base un texto que el repositorio no conoce (md5 %). Revisar antes de reemplazarla.', v.nombre, v_actual;
    end if;
  end loop;
end $$;

CREATE OR REPLACE FUNCTION public.codigo_interno_actividades_estado(p_codigo text, p_sin uuid DEFAULT NULL::uuid, p_hasta date DEFAULT NULL::date, p_antes_de timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(clave text, actividad_id uuid, codigo text, area_id uuid, descripcion text, plano_id uuid, subcontrato_id uuid, avance numeric, ultima_fecha date, primera_fecha date, reportes integer)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
begin
  return query
  with fila as (
    select public.normalizar_codigo_interno(r.codigo_interno) as codigo,
           coalesce(a.area_id, r.area_id) as area_id, t.actividad_id, t.avance, r.fecha,
           coalesce(r.ubicado_en, r.creado_en) as creado_en, t.orden,
           coalesce(a.descripcion, t.descripcion) as descripcion, a.plano_id, a.subcontrato_id,
           coalesce(t.actividad_id::text,
                    'texto:' || coalesce(r.area_id::text, '') || ':' || lower(regexp_replace(btrim(t.descripcion), '\s+', ' ', 'g'))) as clave
      from public.reporte_diario_trabajos t
      join public.reportes_diarios r on r.id = t.reporte_id
      left join public.codigo_actividades a on a.id = t.actividad_id
     where r.anulado_en is null and r.id is distinct from p_sin
       and (p_hasta is null or r.fecha < p_hasta or (r.fecha = p_hasta and (p_antes_de is null or coalesce(r.ubicado_en, r.creado_en) < p_antes_de)))
       and (public.normalizar_codigo_interno(p_codigo) is null
            or public.normalizar_codigo_interno(r.codigo_interno) = public.normalizar_codigo_interno(p_codigo))
  ), ultimo as (
    select distinct on (f.codigo, f.clave) f.*
      from fila f
     order by f.codigo, f.clave, f.fecha desc, f.avance desc, f.creado_en desc, f.orden
  ), cuenta as (
    select f.codigo, f.clave, min(f.fecha) as primera, count(*)::integer as reportes from fila f group by f.codigo, f.clave
  )
  select u.clave, u.actividad_id, u.codigo, u.area_id, u.descripcion, u.plano_id, u.subcontrato_id,
         case when s.estado = 'TERMINADO' then 100 else u.avance end::numeric,
         u.fecha, c.primera, c.reportes
    from ultimo u
    join cuenta c on c.codigo = u.codigo and c.clave = u.clave
    left join public.subcontratos s on s.id = u.subcontrato_id
    left join public.codigo_planos pl on pl.id = u.plano_id
   where u.codigo is not null
     and (u.plano_id is null or pl.anulado_en is null)
     and (u.subcontrato_id is null or s.estado is distinct from 'ANULADO');
end;
$function$;

CREATE OR REPLACE FUNCTION public.codigo_interno_avance_calculado(p_codigo text)
 RETURNS TABLE(codigo text, peso numeric, de_planos numeric, resto numeric, resto_por text, etapas integer, etapas_terminadas integer, trabajos integer, trabajos_terminados integer, ultimo_reporte date)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
begin
  return query
  -- obs-diseno-2026-11-06
  with actividad as (
    select a.*, exists (select 1 from public.codigo_planos p
                         where p.id = a.plano_id and p.anulado_en is null and p.peso > 0) as de_plano
      from public.codigo_interno_actividades_estado(p_codigo) a
  ), toda_etapa as (
    select e.*, x.padre_id,
           case when e.fin_real is not null then 100 else coalesce(e.avance_reportado, 0) end as valor
      from public.codigo_interno_etapas_calculado(p_codigo) e
      join public.codigo_etapas x on x.id = e.id
  ), de_sus_subetapas as (
    select s.padre_id, avg(s.valor) as valor from toda_etapa s where s.padre_id is not null group by s.padre_id
  ), etapa as (
    select e.codigo,
           count(*)::integer as etapas,
           count(*) filter (where e.fin_real is not null)::integer as terminadas,
           avg(case when e.fin_real is not null then 100 else coalesce(s.valor, e.valor) end) as avance
      from toda_etapa e
      left join de_sus_subetapas s on s.padre_id = e.id
     where e.padre_id is null
     group by e.codigo
  ), trabajo as (
    select a.codigo, count(*)::integer as trabajos, count(*) filter (where a.avance >= 100)::integer as terminados,
           avg(a.avance) filter (where not a.de_plano) as avance, max(a.ultima_fecha) as ultimo
      from actividad a group by a.codigo
  ), plano as (
    select k.codigo, sum(k.peso) as peso, sum(k.peso * k.avance / 100) as aporte
      from public.codigo_interno_avance_planos_calculado(p_codigo) k
     group by k.codigo
     having sum(k.peso) > 0
  ), codigos as (
    select e.codigo from etapa e union select t.codigo from trabajo t union select p.codigo from plano p
  )
  select c.codigo, coalesce(p.peso, 0), coalesce(p.aporte, 0), coalesce(e.avance, t.avance, 0),
         case when e.codigo is not null then 'ETAPAS' else 'ACTIVIDADES' end,
         coalesce(e.etapas, 0), coalesce(e.terminadas, 0),
         coalesce(t.trabajos, 0), coalesce(t.terminados, 0), t.ultimo
    from codigos c
    left join etapa e on e.codigo = c.codigo
    left join trabajo t on t.codigo = c.codigo
    left join plano p on p.codigo = c.codigo
   where c.codigo is not null and c.codigo <> 'PLANTA';
end;
$function$;

CREATE OR REPLACE FUNCTION public.codigo_interno_avance_planos_calculado(p_codigo text)
 RETURNS TABLE(plano_id uuid, codigo text, numero text, nombre text, area_id uuid, area text, peso numeric, avance numeric, aporte numeric, por_etapa boolean, ultima_fecha date, reportes integer)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
begin
  return query
  -- obs-diseno-2026-11-06
  with plano as (
    select p.* from public.codigo_planos p
     where p.anulado_en is null and p.peso is not null
       and (public.normalizar_codigo_interno(p_codigo) is null or p.codigo_interno = public.normalizar_codigo_interno(p_codigo))
  ), etapa_area as (
    select e.codigo_interno as codigo, e.area_id, bool_and(e.fin_real is not null) as terminada
      from public.codigo_etapas e
     where e.quitada_en is null and e.area_id is not null and e.padre_id is null
     group by 1, 2
  ), estado as (
    select * from public.codigo_interno_actividades_estado(p_codigo) where plano_id is not null
  )
  select p.id, p.codigo_interno, p.numero, p.nombre, p.area_id, a.nombre::text, p.peso,
         x.avance, round(p.peso * x.avance / 100, 2), coalesce(ea.terminada, false), e.ultima_fecha, coalesce(e.reportes, 0)
    from plano p
    join public.areas a on a.id = p.area_id
    left join etapa_area ea on ea.codigo = p.codigo_interno and ea.area_id = p.area_id
    left join estado e on e.plano_id = p.id
    cross join lateral (select case when ea.terminada then 100::numeric else coalesce(e.avance, 0) end as avance) x;
end;
$function$;

CREATE OR REPLACE FUNCTION public.codigo_interno_resto_por_area_calculado(p_codigo text)
 RETURNS TABLE(codigo text, area_id uuid, avance numeric)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
begin
  return query
  select a.codigo, a.area_id, round(avg(a.avance))::numeric
    from public.codigo_interno_actividades_estado(p_codigo) a
   where a.area_id is not null
     and not exists (select 1 from public.codigo_planos p
                      where p.id = a.plano_id and p.anulado_en is null and p.peso > 0)
   group by a.codigo, a.area_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.codigo_interno_lineas_caja(p_codigo text)
 RETURNS TABLE(codigo text, fuente text, fecha date, concepto text, detalle text, cantidad numeric, unidad text, horas numeric, precio_unitario numeric, moneda text, monto numeric, sin_precio integer, documento text, referencia_id uuid)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
begin
  return query
  -- Un egreso de una cuenta en dólares con su propio tipo de cambio entra en
  -- soles a ese cambio, el pactado, y no al del día de Tesorería.
  select public.normalizar_codigo_interno(m.codigo_interno), 'CAJA'::text, m.fecha,
         m.descripcion::text,
         (c.nombre || case when x.al_cambio then ' · US$ ' || to_char(m.monto, 'FM999999990.00')
                                                 || ' a ' || trim(trailing '.' from to_char(m.tipo_cambio, 'FM990.9999')) else '' end)::text,
         1::numeric, 'egreso'::text, null::numeric,
         x.monto, x.moneda, x.monto, 0, m.operacion::text, m.id
    from public.movimientos_caja m
    join public.cajas c on c.id = m.caja_id
    cross join lateral (select c.moneda::text = 'USD' and m.tipo_cambio is not null as al_cambio) a
    cross join lateral (
      select a.al_cambio,
             case when a.al_cambio then round(m.monto * m.tipo_cambio, 2) else m.monto end as monto,
             case when a.al_cambio then 'PEN' else c.moneda::text end as moneda) x
   where m.tipo = 'EGRESO' and m.origen = 'MANUAL' and m.anulado_en is null
     and public.normalizar_codigo_interno(m.codigo_interno) is not null
     and (public.normalizar_codigo_interno(p_codigo) is null
          or public.normalizar_codigo_interno(m.codigo_interno) = public.normalizar_codigo_interno(p_codigo));
end;
$function$;

CREATE OR REPLACE FUNCTION public.codigo_interno_lineas_gastos_ot(p_codigo text)
 RETURNS TABLE(codigo text, fuente text, fecha date, concepto text, detalle text, cantidad numeric, unidad text, horas numeric, precio_unitario numeric, moneda text, monto numeric, sin_precio integer, documento text, referencia_id uuid)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
begin
  return query
  with gasto as (
    select g.id, g.fecha, g.tipo, g.descripcion, g.monto, g.moneda, g.area_id, o.numero,
           public.normalizar_codigo_interno(case when o.tipo_trabajo::text in ('MANTENIMIENTO', 'GARANTIA')
                                                 then public.codigo_de_la_ot(o.numero) else u.codigo_interno end) as codigo
      from public.ot_gastos_areas g
      join public.ordenes_trabajo o on o.id = g.orden_id
      left join public.unidades u on u.id = o.unidad_id
     where g.estado = 'APROBADO' and o.estado <> 'ANULADA'
  )
  select x.codigo, 'GASTOS_OT'::text, x.fecha,
         (case x.tipo when 'TRAMITE' then 'Trámite' when 'COMISION' then 'Comisión' when 'SERVICIO' then 'Servicio'
                      when 'TRANSPORTE' then 'Transporte' when 'VIATICO' then 'Viático' when 'SUBCONTRATO' then 'Subcontrato'
                      else 'Gasto' end || ': ' || x.descripcion)::text,
         ('Gasto aprobado en la OT ' || x.numero || coalesce(' · ' || a.nombre, ''))::text,
         1::numeric, 'gasto'::text, null::numeric,
         x.monto, x.moneda::text, x.monto, 0, x.numero::text, x.id
    from gasto x
    left join public.areas a on a.id = x.area_id
   where x.codigo is not null
     and (public.normalizar_codigo_interno(p_codigo) is null or x.codigo = public.normalizar_codigo_interno(p_codigo));
end;
$function$;

CREATE OR REPLACE FUNCTION public.codigo_interno_lineas_igv_de_parte(p_codigo text)
 RETURNS TABLE(codigo text, fuente text, fecha date, concepto text, detalle text, cantidad numeric, unidad text, horas numeric, precio_unitario numeric, moneda text, monto numeric, sin_precio integer, documento text, referencia_id uuid)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
begin
  return query
  with parte as (
    -- El IGV que la boleta trae dentro: la tasa es la misma de total_orden_compra.
    select b.id, b.numero_documento, b.fecha_emision, b.orden_compra_id,
           b.monto_de_la_parte - round(b.monto_de_la_parte / 1.18, 2) as igv
      from public.documentos_compra_material b
      join public.ordenes_compra_materiales c on c.id = b.orden_compra_id
     where b.monto_de_la_parte is not null and b.parte_trae_igv and b.anulado_en is null
       and c.con_factura and c.aprobacion not in ('RECHAZADA', 'ANULADA')
  ), porcion as (
    select rl.orden_compra_detalle_id as detalle_id, public.normalizar_codigo_interno(rq.codigo_interno) as codigo,
           sum(greatest(rl.cantidad - coalesce(rl.cantidad_en_stock, 0), 0))::numeric as falta
      from public.requerimiento_lineas rl
      join public.requerimientos rq on rq.id = rl.requerimiento_id
     where rl.orden_compra_detalle_id is not null
     group by 1, 2
  ), reparto as (
    select p.detalle_id, p.codigo,
           coalesce(p.falta / nullif(sum(p.falta) over (partition by p.detalle_id), 0),
                    1.0 / count(*) over (partition by p.detalle_id))::numeric as parte
      from porcion p
  ), linea as (
    -- Lo de la OC que va a cada código, y lo de toda la OC, con los mismos precios.
    select x.id, x.numero_documento, x.fecha_emision, x.igv, c.moneda,
           public.nombre_de_oc(c.numero, c.referencia) as compra,
           coalesce(r.codigo, public.normalizar_codigo_interno(c.codigo_interno)) as codigo,
           sum(d.cantidad * d.precio_unitario * coalesce(r.parte, 1))::numeric as importe,
           sum(sum(d.cantidad * d.precio_unitario * coalesce(r.parte, 1))) over (partition by x.id)::numeric as base
      from parte x
      join public.ordenes_compra_materiales c on c.id = x.orden_compra_id
      join public.orden_compra_material_detalles d on d.orden_compra_id = c.id and d.precio_unitario is not null
      left join reparto r on r.detalle_id = d.id
     where x.igv > 0
     group by x.id, x.numero_documento, x.fecha_emision, x.igv, c.moneda, c.id, c.numero, c.referencia,
              coalesce(r.codigo, public.normalizar_codigo_interno(c.codigo_interno))
  )
  select l.codigo, 'MATERIALES'::text, l.fecha_emision,
         ('IGV de la boleta ' || l.numero_documento || ' (una parte)')::text,
         ('Pagó IGV que no se recupera: '
          || case when l.importe >= l.base then 'todo va a este código'
                  else trim(trailing '.' from to_char(round(l.importe / l.base * 100, 2), 'FM990.99'))
                       || ' % va a este código, lo de la OC que es suyo' end)::text,
         1::numeric, null::text, null::numeric,
         round(l.igv * l.importe / l.base, 2), l.moneda::text, round(l.igv * l.importe / l.base, 2),
         0, l.compra::text, l.id
    from linea l
   where l.codigo is not null and l.importe > 0 and l.base > 0
     and (public.normalizar_codigo_interno(p_codigo) is null or l.codigo = public.normalizar_codigo_interno(p_codigo));
end;
$function$;

CREATE OR REPLACE FUNCTION public.codigo_interno_lineas_nota_credito(p_codigo text)
 RETURNS TABLE(codigo text, fuente text, fecha date, concepto text, detalle text, cantidad numeric, unidad text, horas numeric, precio_unitario numeric, moneda text, monto numeric, sin_precio integer, documento text, referencia_id uuid)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
begin
  return query
  with nota as (
    select n.id, n.numero, n.fecha_emision, n.monto, a.numero_documento, a.moneda, a.total,
           public.compras_de_la_factura(a) as compras,
           -- Con las OC en otra moneda no se comparan: va sobre el total de la factura.
           greatest(a.total, coalesce((select case when bool_and(c.moneda = a.moneda) then sum(public.total_orden_compra(c.id)) end
                                         from public.ordenes_compra_materiales c
                                        where c.id = any (public.compras_de_la_factura(a))
                                          and c.aprobacion not in ('RECHAZADA', 'ANULADA')), 0)) as base
      from public.notas_credito_compra n
      join public.adquisiciones a on a.id = n.adquisicion_id
     where n.tipo = 'DESCUENTO' and n.anulado_en is null and a.estado = 'REGISTRADA' and a.total > 0
  ), porcion as (
    select rl.orden_compra_detalle_id as detalle_id, public.normalizar_codigo_interno(rq.codigo_interno) as codigo,
           sum(greatest(rl.cantidad - coalesce(rl.cantidad_en_stock, 0), 0))::numeric as falta
      from public.requerimiento_lineas rl
      join public.requerimientos rq on rq.id = rl.requerimiento_id
     where rl.orden_compra_detalle_id is not null
     group by 1, 2
  ), reparto as (
    select p.detalle_id, p.codigo,
           coalesce(p.falta / nullif(sum(p.falta) over (partition by p.detalle_id), 0),
                    1.0 / count(*) over (partition by p.detalle_id))::numeric as parte
      from porcion p
  ), linea as (
    select x.id, x.numero, x.fecha_emision, x.monto, x.numero_documento, x.base, c.moneda, public.nombre_de_oc(c.numero, c.referencia) as nombre_oc,
           coalesce(c.numero, c.referencia) as compra,
           coalesce(r.codigo, public.normalizar_codigo_interno(c.codigo_interno)) as codigo,
           sum(d.cantidad * d.precio_unitario * coalesce(r.parte, 1))::numeric as importe
      from nota x
      cross join lateral unnest(x.compras) o(id)
      join public.ordenes_compra_materiales c on c.id = o.id and c.aprobacion not in ('RECHAZADA', 'ANULADA')
      join public.orden_compra_material_detalles d on d.orden_compra_id = c.id and d.precio_unitario is not null
      left join reparto r on r.detalle_id = d.id
     group by x.id, x.numero, x.fecha_emision, x.monto, x.numero_documento, x.base, c.moneda, c.id, c.numero, c.referencia,
              coalesce(r.codigo, public.normalizar_codigo_interno(c.codigo_interno))
  )
  select l.codigo, 'MATERIALES'::text, l.fecha_emision,
         ('Nota de crédito ' || l.numero || ' (descuento)')::text,
         ('Contra la factura ' || l.numero_documento || ': baja '
          || trim(trailing '.' from to_char(round(l.monto / l.base * 100, 2), 'FM990.99')) || ' % de lo de la '
          || l.nombre_oc || ' que va a este código')::text,
         1::numeric, null::text, null::numeric,
         -round(l.importe * l.monto / l.base, 2), l.moneda::text, -round(l.importe * l.monto / l.base, 2),
         0, l.nombre_oc::text, l.id
    from linea l
   where l.codigo is not null and l.importe > 0
     and (public.normalizar_codigo_interno(p_codigo) is null or l.codigo = public.normalizar_codigo_interno(p_codigo));
end;
$function$;

CREATE OR REPLACE FUNCTION public.codigo_interno_lineas_planilla(p_codigo text)
 RETURNS TABLE(codigo text, fuente text, fecha date, concepto text, detalle text, cantidad numeric, unidad text, horas numeric, precio_unitario numeric, moneda text, monto numeric, sin_precio integer, documento text, referencia_id uuid)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
begin
  return query
  with persona as (
    select a.* from public.planilla_al_costo(null) a
     where a.como in ('HORAS', 'SIN_COSTO', 'SIN_FICHA', 'SIN_HORAS') and a.ajuste <> 0
  ), suya as (
    -- Las horas de cada persona en cada código: las del tareo y, sin costo
    -- mensual, las del reporte (las mismas que horas_por_codigo_del_mes).
    select t.trabajador_id, date_trunc('month', t.fecha)::date as periodo,
           public.normalizar_codigo_interno(t.codigo_interno) as codigo, sum(t.horas) as horas
      from public.tareos t
     where t.anulado_en is null
       and t.trabajador_id in (select p.trabajador_id from persona p where p.como = 'HORAS')
     group by 1, 2, 3
    union all
    select l.trabajador_id, date_trunc('month', l.fecha)::date, public.normalizar_codigo_interno(r.codigo_interno), sum(l.horas)
      from public.reporte_diario_personal l
      join public.reportes_diarios r on r.id = l.reporte_id
     where r.anulado_en is null
       and l.trabajador_id in (select p.trabajador_id from persona p where p.como = 'SIN_COSTO')
       and not exists (select 1 from public.tareos t where t.reporte_linea_id = l.id)
     group by 1, 2, 3
  ), parte as (
    select p.planilla_id, p.periodo, p.persona_id, s.codigo, p.ajuste * s.horas / p.horas as monto, false as de_todos
      from persona p
      join suya s on s.trabajador_id = p.trabajador_id and s.periodo = p.periodo
     where p.como in ('HORAS', 'SIN_COSTO') and s.codigo is not null
    union all
    select p.planilla_id, p.periodo, p.persona_id, m.codigo, p.ajuste * m.horas / m.total, true
      from persona p
      join public.horas_por_codigo_del_mes(null) m on m.periodo = p.periodo
     where p.como in ('SIN_FICHA', 'SIN_HORAS')
  )
  select x.codigo, 'MANO_OBRA'::text, x.periodo,
         ('Ajuste de la planilla de taller ' || to_char(x.periodo, 'MM/YYYY'))::text,
         -- El mes en curso todavía recibe horas, como los gastos del mes: su parte es provisional.
         (case when x.periodo >= date_trunc('month', now() at time zone 'America/Lima')::date
               then 'Por ahora: el mes no termina. ' else '' end
          || case when bool_and(x.de_todos)
               then 'Costo real (bruto más EsSalud) de quien no cargó horas propias ese mes, repartido por las horas de todos'
               when bool_or(x.de_todos)
               then 'Costo real (bruto más EsSalud) menos lo que ya entró por horas y por el recargo de las extras, repartido por las horas de cada persona; quien no cargó horas propias, por las de todos'
               else 'Costo real (bruto más EsSalud) menos lo que ya entró por horas y por el recargo de las extras, repartido por las horas de cada persona' end)::text,
         count(distinct x.persona_id)::numeric,
         case when count(distinct x.persona_id) = 1 then 'persona' else 'personas' end::text,
         null::numeric, null::numeric, 'PEN'::text, round(sum(x.monto), 2), 0, null::text, x.planilla_id
    from parte x
   where public.normalizar_codigo_interno(p_codigo) is null or x.codigo = public.normalizar_codigo_interno(p_codigo)
   group by x.codigo, x.periodo, x.planilla_id
  having round(sum(x.monto), 2) <> 0;
end;
$function$;

CREATE OR REPLACE FUNCTION public.codigo_interno_lineas_recargo(p_codigo text)
 RETURNS TABLE(codigo text, fuente text, fecha date, concepto text, detalle text, cantidad numeric, unidad text, horas numeric, precio_unitario numeric, moneda text, monto numeric, sin_precio integer, documento text, referencia_id uuid)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
begin
  return query
  with extra as (
    select d.id, d.trabajador_id, d.fecha, d.horas, p.id as planilla_id, p.numero,
           d.valor_hora * (d.horas_tramo1 * d.recargo_tramo1 + d.horas_tramo2 * d.recargo_tramo2) / 100 as recargo
      from public.planilla_diaria_detalle d
      join public.planilla_diaria_personas pp on pp.id = d.persona_id
      join public.planillas_diarias p on p.id = pp.planilla_id
     where d.concepto = 'EXTRAS' and p.anulado_en is null
  ), jornada as (
    select l.trabajador_id, l.fecha, public.normalizar_codigo_interno(r.codigo_interno) as codigo, sum(l.horas) as horas
      from public.reporte_diario_personal l
      join public.reportes_diarios r on r.id = l.reporte_id
     where r.anulado_en is null and r.observado_en is null
       and r.visto_gerencia_en is not null and r.visto_rrhh_en is not null
     group by 1, 2, 3
  ), parte as (
    select e.*, j.codigo, j.horas / nullif(sum(j.horas) over (partition by e.id), 0) as parte
      from extra e
      join jornada j on j.trabajador_id = e.trabajador_id and j.fecha = e.fecha
  )
  select x.codigo, 'RECARGO_EXTRAS'::text, x.fecha, 'Recargo de las horas extras pagadas'::text,
         ('Planilla diaria ' || x.numero)::text,
         count(distinct x.trabajador_id)::numeric,
         case when count(distinct x.trabajador_id) = 1 then 'persona' else 'personas' end::text,
         round(sum(x.horas * x.parte), 2), null::numeric, 'PEN'::text,
         round(sum(x.recargo * x.parte), 2), 0, x.numero::text, x.planilla_id
    from parte x
   where x.codigo is not null and x.parte is not null
     and (public.normalizar_codigo_interno(p_codigo) is null or x.codigo = public.normalizar_codigo_interno(p_codigo))
   group by x.codigo, x.fecha, x.numero, x.planilla_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.codigo_interno_lineas_servicio(p_codigo text)
 RETURNS TABLE(codigo text, fuente text, fecha date, concepto text, detalle text, cantidad numeric, unidad text, horas numeric, precio_unitario numeric, moneda text, monto numeric, sin_precio integer, documento text, referencia_id uuid)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
begin
  return query
  select public.normalizar_codigo_interno(s.codigo_interno),
         case when s.aprobacion = 'APROBADA' then 'SERVICIOS' else 'SERVICIOS_POR_APROBAR' end,
         (s.creado_en at time zone 'America/Lima')::date,
         s.descripcion::text, s.proveedor::text, 1::numeric, 'servicio'::text, null::numeric,
         s.monto, s.moneda::text, s.monto, 0, s.numero::text, s.id
    from public.ordenes_servicio s
   where s.codigo_interno is not null
     and s.estado <> 'ANULADA' and s.aprobacion <> 'RECHAZADA'
     and (public.normalizar_codigo_interno(p_codigo) is null
          or public.normalizar_codigo_interno(s.codigo_interno) = public.normalizar_codigo_interno(p_codigo));
end;
$function$;

CREATE OR REPLACE FUNCTION public.codigo_interno_lineas_subcontrato(p_codigo text)
 RETURNS TABLE(codigo text, fuente text, fecha date, concepto text, detalle text, cantidad numeric, unidad text, horas numeric, precio_unitario numeric, moneda text, monto numeric, sin_precio integer, documento text, referencia_id uuid)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
begin
  return query
  select public.normalizar_codigo_interno(s.codigo_interno),
         case when p.id is null then 'SUBCONTRATOS_POR_PAGAR' else 'SUBCONTRATOS' end,
         r.fecha_emision,
         coalesce(nullif(btrim(r.concepto), ''), s.descripcion)::text,
         (s.numero || ' · ' || x.nombre)::text,
         1::numeric, 'recibo'::text, null::numeric,
         r.monto_bruto, r.moneda::text, r.monto_bruto, 0, r.numero::text, r.id
    from public.recibos_honorarios r
    join public.subcontratos s on s.id = r.subcontrato_id
    join public.subcontratistas x on x.id = s.subcontratista_id
    left join public.pagos_recibo_honorarios p on p.recibo_id = r.id and p.anulado_en is null
   where r.anulado_en is null
     and (public.normalizar_codigo_interno(p_codigo) is null
          or public.normalizar_codigo_interno(s.codigo_interno) = public.normalizar_codigo_interno(p_codigo));
end;
$function$;

CREATE OR REPLACE FUNCTION public.horas_por_codigo_del_mes(p_periodo date DEFAULT NULL::date)
 RETURNS TABLE(periodo date, codigo text, horas numeric, total numeric, codigos integer)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
begin
  return query
  with hora as (
    select date_trunc('month', t.fecha)::date as periodo, public.normalizar_codigo_interno(t.codigo_interno) as codigo, t.horas
      from public.tareos t
     where t.anulado_en is null
       and (p_periodo is null or date_trunc('month', t.fecha)::date = date_trunc('month', p_periodo)::date)
    union all
    select date_trunc('month', l.fecha)::date, public.normalizar_codigo_interno(r.codigo_interno), l.horas
      from public.reporte_diario_personal l
      join public.reportes_diarios r on r.id = l.reporte_id
     where r.anulado_en is null
       and not exists (select 1 from public.tareos t where t.reporte_linea_id = l.id)
       and (p_periodo is null or date_trunc('month', l.fecha)::date = date_trunc('month', p_periodo)::date)
  ), por_codigo as (
    select h.periodo, h.codigo, sum(h.horas) as horas
      from hora h
     where h.codigo is not null and h.codigo not in ('PLANTA', 'OFICINA', 'TODOS LOS ACTIVOS')
     group by h.periodo, h.codigo
    having sum(h.horas) > 0
  )
  select c.periodo, c.codigo, c.horas, sum(c.horas) over (partition by c.periodo),
         (count(*) over (partition by c.periodo))::integer
    from por_codigo c;
end;
$function$;

CREATE OR REPLACE FUNCTION public.planilla_al_costo(p_planilla uuid DEFAULT NULL::uuid)
 RETURNS TABLE(planilla_id uuid, periodo date, persona_id uuid, nombre text, trabajador_id uuid, como text, costo numeric, horas numeric, costo_horas numeric, recargo numeric, ajuste numeric, codigos integer, mes_con_horas boolean)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
begin
  return query
  with persona as (
    select p.id as planilla_id, p.periodo, pp.id as persona_id, pp.nombre, pp.monto as costo,
           public.trabajador_de_planilla(pp.nombre, pp.documento) as trabajador_id
      from public.planillas p
      join public.planilla_personas pp on pp.planilla_id = p.id
     where p.tipo = 'TALLER' and p.moneda = 'PEN'
       and ((p_planilla is null and p.estado = 'CERRADA') or p.id = p_planilla)
  ), hora as (
    select t.trabajador_id, date_trunc('month', t.fecha)::date as periodo, sum(t.horas) as horas, sum(t.costo) as costo,
           count(distinct public.normalizar_codigo_interno(t.codigo_interno)) as codigos
      from public.tareos t
     where t.anulado_en is null
       and t.trabajador_id in (select x.trabajador_id from persona x)
     group by t.trabajador_id, date_trunc('month', t.fecha)
  ), reporte as (
    -- Las horas del reporte que no hicieron tareo: su ficha no tiene costo mensual.
    select l.trabajador_id, date_trunc('month', l.fecha)::date as periodo, sum(l.horas) as horas,
           count(distinct public.normalizar_codigo_interno(r.codigo_interno)) as codigos
      from public.reporte_diario_personal l
      join public.reportes_diarios r on r.id = l.reporte_id
     where r.anulado_en is null
       and l.trabajador_id in (select x.trabajador_id from persona x)
       and not exists (select 1 from public.tareos t where t.reporte_linea_id = l.id)
     group by l.trabajador_id, date_trunc('month', l.fecha)
  ), extra as (
    select d.trabajador_id, d.fecha,
           d.valor_hora * (d.horas_tramo1 * d.recargo_tramo1 + d.horas_tramo2 * d.recargo_tramo2) / 100 as recargo
      from public.planilla_diaria_detalle d
      join public.planilla_diaria_personas pp on pp.id = d.persona_id
      join public.planillas_diarias p on p.id = pp.planilla_id
     where d.concepto = 'EXTRAS' and p.anulado_en is null
       and d.trabajador_id in (select x.trabajador_id from persona x)
  ), jornada as (
    -- Las mismas horas validadas con que codigo_interno_lineas_recargo reparte el recargo.
    select l.trabajador_id, l.fecha, sum(l.horas) as total,
           sum(l.horas) filter (where public.normalizar_codigo_interno(r.codigo_interno) is not null) as con_codigo
      from public.reporte_diario_personal l
      join public.reportes_diarios r on r.id = l.reporte_id
     where r.anulado_en is null and r.observado_en is null
       and r.visto_gerencia_en is not null and r.visto_rrhh_en is not null
       and l.trabajador_id in (select x.trabajador_id from persona x)
     group by l.trabajador_id, l.fecha
  ), recargo as (
    select e.trabajador_id, date_trunc('month', e.fecha)::date as periodo,
           round(sum(e.recargo * coalesce(j.con_codigo, 0) / j.total), 2) as recargo
      from extra e
      join jornada j on j.trabajador_id = e.trabajador_id and j.fecha = e.fecha and j.total > 0
     group by e.trabajador_id, date_trunc('month', e.fecha)
  ), mes as (
    select distinct m.periodo from public.horas_por_codigo_del_mes(null) m
     where m.periodo in (select x.periodo from persona x)
  ), cuenta as (
    select x.*, w.planilla as planilla_ficha,
           case when x.periodo < public.planilla_ajuste_desde() then 'ANTES'
                when x.trabajador_id is null then 'SIN_FICHA'
                when w.planilla = 'ADMINISTRATIVA' then 'OFICINA'
                when coalesce(h.horas, 0) > 0 then 'HORAS'
                when coalesce(r.horas, 0) > 0 then 'SIN_COSTO'
                else 'SIN_HORAS' end as como,
           coalesce(h.horas, r.horas, 0) as horas, coalesce(h.costo, 0) as costo_horas, coalesce(c.recargo, 0) as recargo,
           coalesce(h.codigos, r.codigos, 0) as codigos,
           exists (select 1 from mes m where m.periodo = x.periodo) as mes_con_horas
      from persona x
      left join public.trabajadores w on w.id = x.trabajador_id
      left join hora h on h.trabajador_id = x.trabajador_id and h.periodo = x.periodo
      left join reporte r on r.trabajador_id = x.trabajador_id and r.periodo = x.periodo
      left join recargo c on c.trabajador_id = x.trabajador_id and c.periodo = x.periodo
  )
  select c.planilla_id, c.periodo, c.persona_id, c.nombre, c.trabajador_id, c.como, c.costo, c.horas, c.costo_horas, c.recargo,
         case c.como when 'ANTES' then 0
                     when 'OFICINA' then 0
                     when 'HORAS' then c.costo - c.costo_horas - c.recargo
                     when 'SIN_COSTO' then c.costo - c.recargo
                     else c.costo end,
         c.codigos::integer, c.mes_con_horas
    from cuenta c;
end;
$function$;

CREATE OR REPLACE FUNCTION public.precio_de_salida(p_material uuid, p_en timestamp with time zone, p_precio numeric DEFAULT NULL::numeric, p_moneda text DEFAULT NULL::text, p_salida uuid DEFAULT NULL::uuid)
 RETURNS TABLE(precio numeric, moneda text, origen text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
begin
  return query
  select coalesce(p_precio, ing.precio_unitario, oc.precio_unitario, val.precio)::numeric,
         case when p_precio is not null then coalesce(p_moneda, ing.moneda, oc.moneda, val.moneda)
              when ing.precio_unitario is not null then ing.moneda
              when oc.precio_unitario is not null then oc.moneda
              else val.moneda end::text,
         case when p_precio is not null then 'SALIDA'
              when ing.precio_unitario is not null or oc.precio_unitario is not null then 'COMPRA'
              when val.precio is not null then 'LOGISTICA' end
    from (select 1) uno
    left join lateral (
      select i.precio_unitario, i.moneda
        from public.movimientos_materiales i
       where i.material_id = p_material and i.tipo = 'INGRESO' and i.precio_unitario is not null
         and i.moneda in ('PEN', 'USD') and i.registrado_en <= p_en
       order by i.registrado_en desc, i.id
       limit 1) ing on true
    left join lateral (
      -- Solo la OC de la línea de RQ que esta salida entrega: otra OC del material
      -- puede no haber llegado nunca.
      select cd.precio_unitario, c.moneda
        from public.movimientos_materiales m
        left join public.requerimiento_lineas rl on rl.id = m.requerimiento_linea_id
        join public.orden_compra_material_detalles cd
          on cd.requerimiento_detalle_id = m.requerimiento_detalle_id or cd.id = rl.orden_compra_detalle_id
        join public.ordenes_compra_materiales c on c.id = cd.orden_compra_id
       where m.id = p_salida
         and cd.precio_unitario >= 0 and c.moneda in ('PEN', 'USD') and c.creado_en <= p_en
         and c.aprobacion in ('APROBADA', 'NO_REQUERIDA')
       order by c.creado_en desc, cd.id
       limit 1) oc on true
    left join lateral (
      select v.precio, v.moneda
        from public.valorizaciones_material v
       where v.material_id = p_material
       order by (v.vigente_desde > p_en),
                case when v.vigente_desde <= p_en then v.vigente_desde end desc nulls last,
                v.vigente_desde, v.id
       limit 1) val on true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sueldos_oficina_del_mes(p_periodo date DEFAULT NULL::date)
 RETURNS TABLE(periodo date, personas integer, monto numeric, sin_pago integer)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
begin
  return query
  with mes as (
    select date_trunc('month', p_periodo)::date as periodo where p_periodo is not null
    union
    select distinct h.periodo from public.horas_por_codigo_del_mes(null) h where p_periodo is null
  ), pago as (
    -- Los días que el pago cubre dentro del mes: de ahí se restan las horas.
    select m.periodo, p.trabajador_id,
           greatest(p.desde, m.periodo) as desde,
           least(p.hasta, (m.periodo + interval '1 month' - interval '1 day')::date) as hasta,
           round((p.monto + p.aportes) * (least(p.hasta, (m.periodo + interval '1 month' - interval '1 day')::date) - p.desde + 1) / (p.hasta - p.desde + 1), 2)
           - round((p.monto + p.aportes) * greatest(0, least(p.hasta, m.periodo - 1) - p.desde + 1) / (p.hasta - p.desde + 1), 2) as parte
      from mes m
      join public.oficina_pagos p on p.anulado_en is null
                                 and p.desde < (m.periodo + interval '1 month')::date and p.hasta >= m.periodo
     where not exists (select 1 from public.pruebas_filas f where f.tabla = 'oficina_pagos' and f.fila_id = p.id)
  ), neto as (
    -- A lo pagado a cada persona en el mes se le resta lo que cargó en horas a
    -- una unidad en los días que sus pagos cubren, y solo en esos: si pasó a
    -- planilla de taller a mitad de mes, sus horas de después no se comen lo que
    -- se le pagó antes.
    select g.periodo, g.trabajador_id,
           greatest(sum(g.parte) - coalesce((select sum(t.costo) from public.tareos t
                                               where t.trabajador_id = g.trabajador_id and t.anulado_en is null
                                                 and exists (select 1 from pago c
                                                              where c.periodo = g.periodo and c.trabajador_id = g.trabajador_id
                                                                and t.fecha between c.desde and c.hasta)
                                                 and public.normalizar_codigo_interno(t.codigo_interno) not in ('PLANTA', 'OFICINA', 'TODOS LOS ACTIVOS')), 0), 0) as monto
      from pago g
     group by g.periodo, g.trabajador_id
  ), horas as (
    -- El primer mes con horas por código: desde ahí también faltan los pagos.
    select min(h.periodo) as desde from public.horas_por_codigo_del_mes(null) h
  ), falta as (
    -- Los días que trabajó en el mes hasta hoy (en el periodo de ahora o en uno
    -- anterior, si volvió a entrar) y que ningún pago cubre.
    select m.periodo, w.id
      from mes m
      cross join horas hh
      join public.trabajadores w on (w.activo or w.fecha_baja is not null) and w.planilla = 'ADMINISTRATIVA'
     where not exists (select 1 from public.pruebas_filas f where f.tabla = 'trabajadores' and f.fila_id = w.id)
       and exists (select 1
                     from generate_series(greatest(m.periodo, least(public.inicio_registro_pagos_oficina(w.id), hh.desde)),
                                          least((m.periodo + interval '1 month' - interval '1 day')::date,
                                                (now() at time zone 'America/Lima')::date),
                                          interval '1 day') d(dia)
                    where ((w.fecha_ingreso is null or d.dia::date >= w.fecha_ingreso)
                           and (w.fecha_baja is null or d.dia::date <= w.fecha_baja)
                           or exists (select 1 from public.trabajador_periodos q
                                       where q.trabajador_id = w.id and (q.ingreso is null or d.dia::date >= q.ingreso)
                                         and d.dia::date <= q.baja))
                      and not exists (select 1 from public.oficina_pagos p
                                       where p.trabajador_id = w.id and p.anulado_en is null
                                         and d.dia::date between p.desde and p.hasta
                                         and not exists (select 1 from public.pruebas_filas f
                                                          where f.tabla = 'oficina_pagos' and f.fila_id = p.id)))
  )
  select m.periodo,
         (select count(*) from neto n where n.periodo = m.periodo)::integer,
         coalesce((select round(sum(n.monto), 2) from neto n where n.periodo = m.periodo), 0),
         (select count(*) from falta f where f.periodo = m.periodo)::integer
    from mes m;
end;
$function$;

CREATE OR REPLACE FUNCTION public.anexos_de_la_factura(p_factura adquisiciones)
 RETURNS TABLE(documento_id uuid, orden_compra_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
begin
  return query
  select d.id, d.orden_compra_id
    from public.documentos_compra_material d
    join public.ordenes_compra_materiales c on c.id = d.orden_compra_id
   where d.id = p_factura.documento_compra_id and d.tipo = 'FACTURA' and d.anulado_en is null and not c.con_factura
  union
  select d.id, d.orden_compra_id
    from public.documentos_compra_material d
    join public.ordenes_compra_materiales c on c.id = d.orden_compra_id
   where public.clave_numero_comprobante(d.numero_documento) = public.clave_numero_comprobante(p_factura.numero_documento)
     and p_factura.tipo <> 'OTRO'
     and d.tipo = 'FACTURA' and d.anulado_en is null and not c.con_factura
     and public.mismo_emisor(public.ruc_de_la_compra(c.id), c.proveedor, p_factura.ruc_proveedor, p_factura.proveedor);
end;
$function$;
