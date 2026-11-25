-- =============================================================================
-- RECURSOS HUMANOS LLEVA LOS TIEMPOS DE ENTREGA POR CÓDIGO INTERNO
-- -----------------------------------------------------------------------------
-- DKS pidió (2026-11-25) que la gestión de los tiempos de entrega por código
-- interno pase a Recursos Humanos, para que la lleve con el personal y haya un
-- semáforo de fechas que vaya avisando. Esta es la primera de las entregas del
-- plan que aprobó ese día: el tablero, en lectura.
--
-- Lo que ya había: las etapas de cada código con su fecha comprometida («Control
-- de plazos», las arma Diseño y las marca el supervisor del área) y la fecha de
-- entrega al cliente que Administración pone al cargar la OT. Lo que faltaba:
-- que RR. HH. las viera juntas. Hasta hoy solo las leían Diseño, Gerencia,
-- Administración y los supervisores, con permisos que también abren planos,
-- materiales o costos.
--
--   * Un permiso propio, `rrhh.tiempos_entrega`, para Recursos Humanos y para
--     Gerencia, que consulta. Abre fechas, etapas y avance; no abre planos,
--     materiales ni costos.
--   * El semáforo se decide aquí, una sola vez, para que la pantalla y los
--     avisos que vienen después digan lo mismo:
--         ROJO   la fecha ya pasó y no se terminó
--         AMBAR  vence hoy o faltan 3 días hábiles o menos
--         VERDE  faltan más de 3 días hábiles
--     Los días son de taller: sin domingos ni feriados, con el calendario
--     laboral del sistema (decisión 5 del plan).
--   * La fecha de entrega del código es la de su OT (decisión 1): no se digita
--     dos veces. Las fechas de etapa las sigue poniendo Diseño (decisión 2);
--     aquí nadie escribe nada.
--
-- Sin DROP: el conector de producción no deja pasar ninguno.
-- =============================================================================

-- 1. El permiso ---------------------------------------------------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('rrhh.tiempos_entrega', 'Recursos Humanos',
   'Ver los tiempos de entrega por código interno: la fecha de entrega, las etapas con sus fechas, el semáforo y el avance. Sin planos, materiales ni costos')
on conflict (codigo) do nothing;

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, 'rrhh.tiempos_entrega'
  from public.roles r
 -- GERENTE_PRODUCCION, si ya existe: lo crea otra migración y también consulta.
 where r.codigo in ('RECURSOS_HUMANOS', 'GERENTE', 'GERENTE_PRODUCCION')
on conflict do nothing;

-- 2. Cuántos días hábiles antes se avisa, y el semáforo de una fecha ----------------
create or replace function public.dias_por_vencer()
returns integer language sql immutable set search_path to 'public' as $$
  select 3;
$$;
comment on function public.dias_por_vencer() is
  'Cuántos días hábiles antes de la fecha comprometida una etapa pasa a ámbar (por vencer). Decisión 5 del plan de tiempos de entrega, 2026-11-25.';
revoke all on function public.dias_por_vencer() from public, anon;
grant execute on function public.dias_por_vencer() to authenticated;

-- El último día que todavía es «por vencer» mirado desde hoy. Las pantallas que
-- ya pintaban el semáforo de etapas (Diseño, Códigos internos, Seguimiento)
-- comparan contra esta fecha para decir lo mismo que el tablero de RR. HH.
create or replace function public.limite_por_vencer()
returns date language sql stable set search_path to 'public' as $$
  select public.sumar_dias_habiles(current_date, public.dias_por_vencer());
$$;
comment on function public.limite_por_vencer() is
  'Hoy más los días hábiles de dias_por_vencer(): una fecha comprometida hasta ese día, y no vencida, está por vencer.';
revoke all on function public.limite_por_vencer() from public, anon;
grant execute on function public.limite_por_vencer() to authenticated;

create or replace function public.semaforo_de_fecha(p_fecha date, p_terminada boolean default false)
returns text language sql stable set search_path to 'public' as $$
  select case
    when coalesce(p_terminada, false) then 'TERMINADA'
    when p_fecha is null then 'SIN_FECHA'
    when p_fecha < current_date then 'ROJO'
    when p_fecha <= public.limite_por_vencer() then 'AMBAR'
    else 'VERDE'
  end;
$$;
comment on function public.semaforo_de_fecha(date, boolean) is
  'El semáforo de una fecha comprometida: TERMINADA, SIN_FECHA, ROJO (vencida), AMBAR (vence hoy o en dias_por_vencer() días hábiles o menos) o VERDE.';
revoke all on function public.semaforo_de_fecha(date, boolean) from public, anon;
grant execute on function public.semaforo_de_fecha(date, boolean) to authenticated;

-- 3. Quién ve los tiempos de entrega ------------------------------------------------
create or replace function public.exigir_ver_tiempos_de_entrega()
returns void language plpgsql stable set search_path to 'public' as $$
begin
  if not (public.es_admin() or public.tiene_permiso('rrhh.tiempos_entrega')) then
    raise exception 'No tienes permiso para ver los tiempos de entrega.' using errcode = 'insufficient_privilege';
  end if;
end;
$$;
revoke all on function public.exigir_ver_tiempos_de_entrega() from public, anon;
grant execute on function public.exigir_ver_tiempos_de_entrega() to authenticated;

-- 4. Las etapas de un código, o de todos, con su semáforo ---------------------------
-- El mismo cálculo que ven Diseño y Gerencia (`codigo_interno_etapas_calculado`),
-- con el semáforo y los días hábiles que faltan. Corre como dueño porque RR. HH.
-- no lee `codigo_etapas` ni los reportes de todas las áreas por su cuenta; el
-- permiso se exige adentro.
create or replace function public.tiempos_de_entrega_etapas(p_codigo text default null)
returns table (id uuid, codigo text, orden smallint, nombre text, padre_id uuid, area_id uuid, area text,
               inicio_plan date, fin_plan date, inicio_real date, fin_real date, nota text,
               ultimo_reporte date, avance_reportado numeric, semaforo text, dias_habiles integer)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  perform public.exigir_ver_tiempos_de_entrega();
  return query
  select e.id, e.codigo, e.orden, e.nombre, x.padre_id, e.area_id, e.area,
         e.inicio_plan, e.fin_plan, e.inicio_real, e.fin_real, e.nota,
         e.ultimo_reporte, e.avance_reportado,
         public.semaforo_de_fecha(e.fin_plan, e.fin_real is not null),
         case when e.fin_real is null and e.fin_plan is not null
              then public.dias_habiles_entre(current_date, e.fin_plan) end
    from public.codigo_interno_etapas_calculado(p_codigo) e
    join public.codigo_etapas x on x.id = e.id
   order by e.codigo, e.orden, e.id;
end;
$$;
comment on function public.tiempos_de_entrega_etapas(text) is
  'Las etapas vigentes de un código interno (o de todos) con su fecha comprometida, lo real, el avance que reporta su área, su semáforo y los días hábiles que faltan (negativo si venció). Exige rrhh.tiempos_entrega.';
revoke all on function public.tiempos_de_entrega_etapas(text) from public, anon;
grant execute on function public.tiempos_de_entrega_etapas(text) to authenticated;

-- 5. El tablero: un renglón por código que todavía no se entrega --------------------
-- Entra el código de toda OT que no está entregada, facturada ni anulada, y el
-- que tiene etapas sin terminar aunque no tenga OT abierta. La OT con que se
-- nombra es la abierta que entró primero, como en «Unidades en taller».
-- El semáforo general es el peor de sus etapas sin terminar y de su fecha de
-- entrega; sin ninguna fecha, SIN_FECHA.
create or replace function public.tiempos_de_entrega_codigos()
returns table (codigo text, ot_numero text, ot_estado text, cliente text, unidad text,
               fecha_entrega date, dias_habiles_entrega integer, semaforo_entrega text,
               etapas integer, etapas_terminadas integer, etapas_vencidas integer, etapas_por_vencer integer,
               etapas_sin_fecha integer, etapa_en_curso text, area_en_curso text,
               proxima_fecha date, semaforo text)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  perform public.exigir_ver_tiempos_de_entrega();
  return query
  with ot as (
    select distinct on (c.codigo)
           c.codigo, o.numero::text as numero, o.estado::text as estado, cl.razon_social::text as cliente,
           nullif(concat_ws(' · ', nullif(btrim(coalesce(u.placa::text, '')), ''), tc.nombre::text), '') as unidad,
           o.fecha_entrega_comprometida as fecha_entrega
      from public.ordenes_trabajo o
      join public.unidades u on u.id = o.unidad_id
      cross join lateral (select public.normalizar_codigo_interno(u.codigo_interno) as codigo) c
      left join public.clientes cl on cl.id = o.cliente_id
      left join public.tipos_carroceria tc on tc.id = u.tipo_carroceria_id
     where o.estado not in ('ENTREGADA', 'FACTURADA', 'ANULADA')
       and c.codigo is not null
     order by c.codigo, o.fecha_registro nulls last, o.numero
  ), etapa as (
    select e.codigo, e.orden, e.nombre, e.area, e.padre_id, e.fin_plan, e.inicio_real, e.fin_real, e.semaforo
      from public.tiempos_de_entrega_etapas(null) e
  ), por_codigo as (
    select e.codigo,
           count(*) filter (where e.padre_id is null)::integer as etapas,
           count(*) filter (where e.padre_id is null and e.fin_real is not null)::integer as terminadas,
           count(*) filter (where e.semaforo = 'ROJO')::integer as vencidas,
           count(*) filter (where e.semaforo = 'AMBAR')::integer as por_vencer,
           count(*) filter (where e.semaforo = 'SIN_FECHA')::integer as sin_fecha,
           count(*) filter (where e.fin_real is null)::integer as pendientes,
           min(e.fin_plan) filter (where e.fin_real is null) as proxima
      from etapa e
     group by e.codigo
  ), en_curso as (
    -- La etapa de arriba en que va: la empezada sin terminar; si ninguna, la primera sin terminar.
    select distinct on (e.codigo) e.codigo, e.nombre, e.area
      from etapa e
     where e.padre_id is null and e.fin_real is null
     order by e.codigo, (e.inicio_real is null), e.orden
  ), codigos as (
    select o.codigo from ot o
    union
    select p.codigo from por_codigo p where p.pendientes > 0
  )
  select c.codigo, o.numero, o.estado, o.cliente, o.unidad,
         o.fecha_entrega,
         case when o.fecha_entrega is not null then public.dias_habiles_entre(current_date, o.fecha_entrega) end,
         public.semaforo_de_fecha(o.fecha_entrega),
         coalesce(p.etapas, 0), coalesce(p.terminadas, 0), coalesce(p.vencidas, 0), coalesce(p.por_vencer, 0),
         coalesce(p.sin_fecha, 0), k.nombre, k.area,
         p.proxima,
         case
           when coalesce(p.vencidas, 0) > 0 or public.semaforo_de_fecha(o.fecha_entrega) = 'ROJO' then 'ROJO'
           when coalesce(p.por_vencer, 0) > 0 or public.semaforo_de_fecha(o.fecha_entrega) = 'AMBAR' then 'AMBAR'
           when p.proxima is not null or o.fecha_entrega is not null then 'VERDE'
           else 'SIN_FECHA'
         end
    from codigos c
    left join ot o on o.codigo = c.codigo
    left join por_codigo p on p.codigo = c.codigo
    left join en_curso k on k.codigo = c.codigo
   order by c.codigo;
end;
$$;
comment on function public.tiempos_de_entrega_codigos() is
  'El tablero de tiempos de entrega: cada código interno sin entregar con su OT, su cliente, la fecha de entrega al cliente con su propio semáforo, cuántas etapas lleva, cuántas vencidas y por vencer, en qué etapa va y su semáforo general. Exige rrhh.tiempos_entrega.';
revoke all on function public.tiempos_de_entrega_codigos() from public, anon;
grant execute on function public.tiempos_de_entrega_codigos() to authenticated;

-- 6. Las actividades de un código con su avance -------------------------------------
-- Lo que cada área reporta en su reporte diario para el código: la actividad y
-- hasta dónde llegó. Todavía sin fecha ni responsable propios (los pone la
-- entrega siguiente del plan); aquí RR. HH. ve qué se está haciendo.
create or replace function public.tiempos_de_entrega_actividades(p_codigo text)
returns table (clave text, area text, descripcion text, avance numeric, ultima_fecha date, reportes integer)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_codigo text := public.normalizar_codigo_interno(p_codigo);
begin
  perform public.exigir_ver_tiempos_de_entrega();
  if v_codigo is null then
    return;
  end if;
  return query
  select e.clave, a.nombre::text, e.descripcion, e.avance, e.ultima_fecha, e.reportes
    from public.codigo_interno_actividades_estado(v_codigo) e
    left join public.areas a on a.id = e.area_id
   order by (e.avance >= 100), a.nombre, e.descripcion, e.clave;
end;
$$;
comment on function public.tiempos_de_entrega_actividades(text) is
  'Las actividades vigentes de un código interno con su área, su último avance y la fecha de su último reporte diario; primero las que no terminaron. Exige rrhh.tiempos_entrega.';
revoke all on function public.tiempos_de_entrega_actividades(text) from public, anon;
grant execute on function public.tiempos_de_entrega_actividades(text) to authenticated;
