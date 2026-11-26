-- Los cálculos de las pantallas pesadas (el costeo y el avance de cada código
-- interno) siguen en plpgsql, que guarda el plan de cada consulta durante la
-- conexión. Escritos como `language sql`, Postgres 17 los vuelve a planificar
-- en cada llamada, y eso fue lo que pesaba (migración 20261126970000). Una
-- migración que copie la versión vieja de una de ellas pasa todos los demás
-- checks sin cambiar ninguna cifra: solo este lo ve.
\set ON_ERROR_STOP on
begin;

do $$
declare
  v_en_sql text;
  v_faltan text;
  v_abiertas text;
begin
  -- Solo `anexos_de_la_factura` corre como su dueño, desde antes de este cambio.
  with esperadas(nombre, de_su_dueno) as (
    values ('anexos_de_la_factura', true), ('codigo_interno_actividades_estado', false), ('codigo_interno_avance_calculado', false),
           ('codigo_interno_avance_planos_calculado', false), ('codigo_interno_lineas_caja', false), ('codigo_interno_lineas_gastos_ot', false),
           ('codigo_interno_lineas_igv_de_parte', false), ('codigo_interno_lineas_nota_credito', false), ('codigo_interno_lineas_planilla', false),
           ('codigo_interno_lineas_recargo', false), ('codigo_interno_lineas_servicio', false), ('codigo_interno_lineas_subcontrato', false),
           ('codigo_interno_resto_por_area_calculado', false), ('horas_por_codigo_del_mes', false), ('planilla_al_costo', false),
           ('precio_de_salida', false), ('sueldos_oficina_del_mes', false)
  )
  select string_agg(e.nombre, ', ' order by e.nombre) filter (where l.lanname is distinct from 'plpgsql' and p.oid is not null),
         string_agg(e.nombre, ', ' order by e.nombre) filter (where p.oid is null),
         -- El cambio de lenguaje no abre ninguna puerta: cada una corre con el
         -- rol de antes y con su camino de búsqueda fijo.
         string_agg(e.nombre, ', ' order by e.nombre)
           filter (where p.prosecdef is distinct from e.de_su_dueno
                      or not coalesce(p.proconfig @> array['search_path=public'], false))
    into v_en_sql, v_faltan, v_abiertas
    from esperadas e
    left join pg_proc p on p.pronamespace = 'public'::regnamespace and p.proname = e.nombre
    left join pg_language l on l.oid = p.prolang;

  perform test.afirmar(v_faltan is null, 'faltan funciones del costeo y el avance: ' || coalesce(v_faltan, ''));
  perform test.afirmar(v_en_sql is null,
    'volvieron a language sql (se planifican en cada llamada): ' || coalesce(v_en_sql, ''));
  perform test.afirmar(v_abiertas is null, 'cambió la seguridad de: ' || coalesce(v_abiertas, ''));
end $$;

rollback;
