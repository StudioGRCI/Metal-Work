-- =============================================================================
-- EL IGV DE LA BOLETA DE UNA PARTE VA AL COSTO DEL CÓDIGO
-- -----------------------------------------------------------------------------
-- DKS lo decidió el 22/10 («Sí, sumarlo», a «¿El IGV de la boleta de una parte
-- se suma al costo del código?»).
--
-- En la OC con factura los precios van sin IGV: el IGV de la factura se
-- recupera como crédito fiscal y no es costo. Pero la parte que llega con
-- boleta (20261022200000) paga su IGV dentro del monto de la boleta, y ese IGV
-- no se recupera: es plata que la empresa gastó y el código no la veía. El
-- material de esa parte entra al almacén con el precio de la OC, sin IGV, y así
-- sale al código.
--
-- Desde aquí cada boleta de una parte vigente de una OC con factura suma a los
-- códigos de la OC su IGV: lo que hay en su monto por encima del monto sin IGV
-- (monto − monto / 1.18). Se reparte como el material de la OC: a cada código le
-- toca la parte de la OC que va a ese código (la de su RQ, o la OC entera si es
-- directa), en la moneda de la OC y con la fecha de la boleta. Va como
-- MATERIALES, igual que el descuento de la nota de crédito (20261022190000):
-- entra al total del código y se ve en su tabla de materiales con su motivo.
--
-- No todo comprobante de una parte trae IGV: la nota de venta, el recibo o la
-- boleta de un proveedor del Nuevo RUS no lo llevan, y sumarle un 18 % que nunca
-- se pagó inflaría el costo. Por eso Logística dice al anexarlo si trae IGV
-- (`parte_trae_igv`), y solo el que lo trae suma. Ese dato queda congelado como
-- el monto: si estaba mal, se anula el comprobante y se anexa de nuevo.
--
-- La boleta de una parte de una OC con boleta no suma nada: ahí los precios ya
-- son lo que se paga, con su IGV dentro. La boleta anulada deja de sumar.
--
-- El reparto entre los códigos, por el valor de cada uno en la OC, no lo decidió
-- DKS: es el único posible, porque la boleta no dice qué líneas de la OC trae.
-- =============================================================================

-- 0. Si el comprobante de la parte trae IGV ------------------------------------
-- Las que ya estaban se anexaron como «boleta» de una parte: se toman como con
-- IGV, que es lo que trae una boleta. Si alguna no lo traía, se anula y se anexa
-- de nuevo diciendo que no.
alter table public.documentos_compra_material add column if not exists parte_trae_igv boolean;
update public.documentos_compra_material set parte_trae_igv = true
 where monto_de_la_parte is not null and parte_trae_igv is null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_documento_compra_parte_igv'
                   and conrelid = 'public.documentos_compra_material'::regclass) then
    alter table public.documentos_compra_material add constraint ck_documento_compra_parte_igv check (
      (monto_de_la_parte is null) = (parte_trae_igv is null));
  end if;
end $$;
comment on column public.documentos_compra_material.parte_trae_igv is
  'Solo en la boleta de una parte (20261022210000): si el comprobante trae IGV. El que lo trae suma su IGV al costo de los códigos de la OC con factura; la nota de venta, el recibo o la boleta del Nuevo RUS, no. No se corrige: se anula y se anexa de nuevo.';

-- 1. Las líneas: el IGV de cada boleta de una parte, por código -----------------
create or replace function public.codigo_interno_lineas_igv_de_parte(p_codigo text)
returns table (codigo text, fuente text, fecha date, concepto text, detalle text, cantidad numeric, unidad text,
               horas numeric, precio_unitario numeric, moneda text, monto numeric, sin_precio integer,
               documento text, referencia_id uuid)
language sql stable set search_path to 'public' as $$
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
           coalesce(c.numero, c.referencia) as compra,
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
     and (public.normalizar_codigo_interno(p_codigo) is null or l.codigo = public.normalizar_codigo_interno(p_codigo))
$$;
-- La llama `codigo_interno_lineas`, que solo corre dentro de las funciones que ya exigen su permiso.
revoke all on function public.codigo_interno_lineas_igv_de_parte(text) from public, anon, authenticated;

-- 2. El costeo del código las suma ------------------------------------------------
-- Un parche de texto sobre la última versión de `codigo_interno_lineas`
-- (20261022190000): se agrega la unión, y nada más. Si el texto cambió desde
-- esa migración, se detiene todo.
create or replace function pg_temp.parchar(p_funcion regprocedure, p_cambios text[], p_veces integer[])
returns void language plpgsql as $$
declare
  v_def   text := replace(pg_get_functiondef(p_funcion), E'\r', '');
  v_nueva text;
  v_n     integer;
  i       integer;
begin
  v_nueva := v_def;
  for i in 1 .. array_length(p_veces, 1) loop
    continue when position(p_cambios[2 * i] in v_nueva) > 0;
    v_n := (char_length(v_nueva) - char_length(replace(v_nueva, p_cambios[2 * i - 1], ''))) / char_length(p_cambios[2 * i - 1]);
    if v_n <> p_veces[i] then
      raise exception '% cambió: «%» está % veces y el repositorio la conoce %. Revisarla a mano antes de seguir.',
        p_funcion, left(p_cambios[2 * i - 1], 80), v_n, p_veces[i];
    end if;
    v_nueva := replace(v_nueva, p_cambios[2 * i - 1], p_cambios[2 * i]);
  end loop;
  if v_nueva <> v_def then
    execute v_nueva;
  end if;
end;
$$;

select pg_temp.parchar('public.codigo_interno_lineas(text, boolean)'::regprocedure, array[
  E'  select * from public.codigo_interno_lineas_nota_credito(v_codigo)\n',
  E'  select * from public.codigo_interno_lineas_nota_credito(v_codigo)\n'
  || E'  union all\n'
  || E'  -- El IGV de la boleta de una parte de una OC con factura (20261022210000).\n'
  || E'  select * from public.codigo_interno_lineas_igv_de_parte(v_codigo)\n'
], array[1]);

-- 3. Si trae IGV no se corrige, como el monto ------------------------------------
select pg_temp.parchar('public.fn_parte_con_boleta_valida()'::regprocedure, array[
  E'    if new.monto_de_la_parte is distinct from old.monto_de_la_parte then\n',
  E'    if new.monto_de_la_parte is distinct from old.monto_de_la_parte or new.parte_trae_igv is distinct from old.parte_trae_igv then\n',
  E'      raise exception ''El monto de la boleta de una parte no se corrige: anula la boleta con su motivo y anéxala de nuevo.''\n',
  E'      raise exception ''El monto de la boleta de una parte, y si trae IGV, no se corrigen: anula la boleta con su motivo y anéxala de nuevo.''\n'
], array[1, 1]);

-- 4. «Salidas del almacén» cuenta solo salidas --------------------------------------
-- El IGV de una parte y el descuento de la nota de crédito van como MATERIALES
-- para sumar al costo, pero no salieron del almacén: el resumen de Gerencia y el
-- gasto de Requerimientos los contaban como salidas («11 salidas» en un código
-- sin ninguna). Ahora cuentan solo las líneas que son un movimiento del kardex.
select pg_temp.parchar(p.oid::regprocedure, array[
  E'count(*) filter (where k.fuente in (''MATERIALES'', ''MATERIALES_SIN_PRECIO''))::integer as salidas',
  E'count(*) filter (where k.fuente in (''MATERIALES'', ''MATERIALES_SIN_PRECIO'')\n'
  || E'                             and exists (select 1 from public.movimientos_materiales m where m.id = k.referencia_id))::integer as salidas'
], array[1])
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace and p.proname in ('codigos_internos_resumen', 'codigos_internos_gasto');
