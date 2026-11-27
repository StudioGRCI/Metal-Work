-- =============================================================================
-- EL GASTO OPERATIVO, POR ÁREA Y POR MES
-- -----------------------------------------------------------------------------
-- DKS, 2026-11-27: lo que Producción, Maestranza y Acabados piden para el área
-- «iría como gasto operativo y se sacaría ya con la ganancia de cada
-- movimiento». Entrega 2 del plan del gasto operativo: ver cuánto gastó cada
-- área para trabajar, mes por mes. Gerencia y Administración ven todas las
-- áreas; cada supervisor, la suya (decisión del plan, aprobado el 27/11).
--
-- Qué es gasto operativo: lo que el costeo carga al código PLANTA, que no es
-- ninguna unidad. Se lee de `codigo_interno_lineas('PLANTA', true)`, la misma
-- función que arma el costo de cada código, con la misma regla de qué suma
-- (`codigos_internos_costo_calculado`): lo salido del almacén a su precio, la
-- mano de obra, las OS, los subcontratos y la caja. Lo comprado no suma: entra
-- al almacén y cuenta cuando sale (decisión B del plan). Así la ganancia de
-- Metal Work de la entrega 3 resta el gasto operativo sin contar dos veces nada
-- de lo que ya está en el costo de una unidad.
--
-- De qué área es cada línea:
--   - lo salido del almacén, del área del RQ del área (`para_el_area`);
--   - la mano de obra, del área del reporte diario;
--   - la OS y el subcontrato, del área que llevan;
--   - lo demás (la caja, una salida sin RQ del área), «Planta, sin área».
--
-- El supervisor ve su área sin la mano de obra, como Requerimientos ve el gasto
-- por código (`codigos_internos.gasto`): lo que cuesta cada persona lo ven
-- Gerencia y Administración. Tampoco ve los subcontratos: los de su área los ve
-- sin montos ni recibos desde la 20261020180000, y aquí no se le abren.
--
-- Solo lectura. Sin DROP. Idempotente.
-- =============================================================================

-- 1. Los permisos -----------------------------------------------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('gasto_operativo.ver', 'Costos',
   'Consultar el gasto operativo de todas las áreas, mes por mes: lo que se gastó para trabajar y no se cargó a ninguna unidad (PLANTA), con la mano de obra'),
  ('gasto_operativo.area', 'Costos',
   'Consultar el gasto operativo de su propia área, mes por mes: lo que salió del almacén para el área y sus OS, sin la mano de obra ni los subcontratos')
on conflict (codigo) do update set modulo = excluded.modulo, descripcion = excluded.descripcion;

-- Gerencia y Administración, todo; quien pide para su área (los supervisores y
-- Mantenimiento, que tienen `requerimientos.area`), lo de su área.
insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, p.codigo from public.roles r cross join public.permisos p
 where (r.codigo in ('GERENTE', 'ADMINISTRACION') and p.codigo = 'gasto_operativo.ver')
    or (r.codigo in ('SUPERVISOR', 'MANTENIMIENTO') and p.codigo = 'gasto_operativo.area')
on conflict do nothing;

-- 2. El cálculo, sin permiso: lo llaman la pantalla de esta entrega y el reporte
--    general de la entrega 3. No se le da a nadie.
create or replace function public.gasto_operativo_lineas_calculado(p_desde date, p_hasta date)
returns table (fecha date, area_id uuid, fuente text, grupo text, concepto text, detalle text,
               cantidad numeric, unidad text, moneda text, monto numeric, soles numeric, suma boolean,
               sin_precio integer, documento text, referencia_id uuid, requerimiento_id uuid)
language plpgsql stable set search_path to 'public' as $$
-- plpgsql y no sql: la llaman la pantalla, de mil en mil filas, y el reporte
-- general (skill datos › Rendimiento).
#variable_conflict use_column
begin
  return query
  with k as (
    select k.*,
           -- Las mismas fuentes que suman al costo en `codigos_internos_costo_calculado`.
           k.fuente in ('MANO_OBRA', 'RECARGO_EXTRAS', 'MATERIALES', 'SERVICIOS', 'SUBCONTRATOS',
                        'SUBCONTRATOS_POR_PAGAR', 'GASTOS_DEL_MES', 'CAJA', 'GASTOS_OT', 'MERMA') as suma
      from public.codigo_interno_lineas('PLANTA', true) k
     where k.fuente <> 'COMPRAS'
       and (p_desde is null or k.fecha >= p_desde)
       and (p_hasta is null or k.fecha <= p_hasta)
  )
  select k.fecha,
         case
           when k.fuente in ('MATERIALES', 'MATERIALES_SIN_PRECIO') then
             (select rq.area_id
                from public.movimientos_materiales m
                join public.requerimiento_lineas rl on rl.id = m.requerimiento_linea_id
                join public.requerimientos rq on rq.id = rl.requerimiento_id
               where m.id = k.referencia_id and rq.para_el_area)
           when k.fuente in ('MANO_OBRA', 'MANO_OBRA_SIN_COSTO') then
             (select r.area_id from public.reportes_diarios r where r.id = k.referencia_id)
           when k.fuente in ('SERVICIOS', 'SERVICIOS_POR_APROBAR') then
             (select s.area_id from public.ordenes_servicio s where s.id = k.referencia_id)
           when k.fuente in ('SUBCONTRATOS', 'SUBCONTRATOS_POR_PAGAR') then
             (select s.area_id from public.recibos_honorarios r join public.subcontratos s on s.id = r.subcontrato_id
               where r.id = k.referencia_id)
         end,
         k.fuente,
         case
           when k.fuente in ('MATERIALES', 'MATERIALES_SIN_PRECIO', 'MERMA') then 'MATERIALES'
           when k.fuente in ('MANO_OBRA', 'MANO_OBRA_SIN_COSTO', 'RECARGO_EXTRAS') then 'MANO_OBRA'
           when k.fuente in ('SERVICIOS', 'SERVICIOS_POR_APROBAR') then 'SERVICIOS'
           when k.fuente in ('SUBCONTRATOS', 'SUBCONTRATOS_POR_PAGAR') then 'SUBCONTRATOS'
           when k.fuente = 'CAJA' then 'CAJA'
           else 'OTROS'
         end,
         k.concepto, k.detalle, k.cantidad, k.unidad, k.moneda, k.monto,
         -- En soles como lo pesa el costo: la OS con su monto en soles, lo demás al
         -- cambio de su día. Vacío si todavía no se puede pasar, o si no suma.
         case when not k.suma or k.monto is null then null
              when k.moneda = 'PEN' then k.monto
              when k.moneda = 'USD' then public.soles_de_la_linea_del_costeo(k.fuente, k.referencia_id, k.fecha, k.monto)
         end,
         k.suma, k.sin_precio, k.documento, k.referencia_id,
         -- El RQ de lo salido del almacén, para abrirlo desde la pantalla.
         case when k.fuente in ('MATERIALES', 'MATERIALES_SIN_PRECIO') then
           (select rl.requerimiento_id from public.movimientos_materiales m
              join public.requerimiento_lineas rl on rl.id = m.requerimiento_linea_id
             where m.id = k.referencia_id)
         end
    from k;
end $$;

revoke all on function public.gasto_operativo_lineas_calculado(date, date) from public, anon, authenticated;

-- 3. Lo que ve cada uno ---------------------------------------------------------------
create or replace function public.gasto_operativo(p_desde date, p_hasta date)
returns table (fecha date, area_id uuid, area text, fuente text, grupo text, concepto text, detalle text,
               cantidad numeric, unidad text, moneda text, monto numeric, soles numeric, suma boolean,
               sin_precio integer, documento text, referencia_id uuid, requerimiento_id uuid)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  -- Sin sesión (una migración, la clave de servicio) mira todo, como `exigir_permiso`.
  v_todo boolean := public.usuario_actual() is null or public.es_admin() or public.tiene_permiso('gasto_operativo.ver');
  v_area uuid;
begin
  if not v_todo then
    if not public.tiene_permiso('gasto_operativo.area') then
      raise exception 'No tienes permiso para ver el gasto operativo.' using errcode = 'insufficient_privilege';
    end if;
    select u.area_id into v_area from public.usuarios u where u.id = public.usuario_actual() and u.activo;
    if v_area is null then
      raise exception 'Tu cuenta no tiene área: sin ella no se sabe qué gasto operativo te toca ver.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  if p_desde is not null and p_hasta is not null and p_hasta < p_desde then
    raise exception 'El periodo termina antes de empezar: revisa las fechas.';
  end if;

  return query
  select g.fecha, g.area_id, coalesce(a.nombre, 'Planta, sin área')::text, g.fuente, g.grupo, g.concepto, g.detalle,
         g.cantidad, g.unidad, g.moneda, g.monto, g.soles, g.suma, g.sin_precio, g.documento, g.referencia_id, g.requerimiento_id
    from public.gasto_operativo_lineas_calculado(p_desde, p_hasta) g
    left join public.areas a on a.id = g.area_id
   where v_todo or (g.area_id = v_area and g.grupo not in ('MANO_OBRA', 'SUBCONTRATOS'))
   order by g.fecha desc, 3, g.grupo, g.concepto, g.referencia_id;
end $$;

revoke all on function public.gasto_operativo(date, date) from public, anon;
grant execute on function public.gasto_operativo(date, date) to authenticated;

comment on function public.gasto_operativo(date, date) is
  'El gasto operativo (lo cargado a PLANTA) entre dos fechas, línea por línea, con su área. Con gasto_operativo.ver, todas las áreas; con gasto_operativo.area, solo la suya y sin la mano de obra ni los subcontratos.';
