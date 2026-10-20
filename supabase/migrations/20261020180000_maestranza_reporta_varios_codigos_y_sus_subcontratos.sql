-- =============================================================================
-- EL REPORTE DIARIO CON VARIOS CÓDIGOS, Y LOS SUBCONTRATOS DE MAESTRANZA
-- -----------------------------------------------------------------------------
-- DKS lo pidió el 2026-10-20: «en reporte diario pueden o deben reportar no solo
-- por un código interno si no pueden anexar varios códigos internos y además
-- también según los códigos internos les aparecerá para que vinculen planos y
-- puedan dar el avance de esos planos […], después está sub contratos en donde
-- no visualizarán dinero solo su etapa de inicio y fin donde tendrán que
-- reportar cuál es su progreso del subcontrato».
--
-- 1. VARIOS CÓDIGOS EN UN MISMO REPORTE. El supervisor arma un solo reporte del
--    día con todos los códigos en que trabajó su gente: en cada código, sus
--    planos, subcontratos y actividades, con su avance y su personal. Se guarda
--    UN REPORTE POR CÓDIGO, en la misma transacción (entran todos o ninguno),
--    porque de cada reporte salen las horas que van al costeo de su código: con
--    las horas de Juan repartidas en dos códigos, cada parte va al suyo. Así la
--    validación de Gerencia y RR. HH., la observación, la corrección, la
--    anulación, el avance y el costeo siguen igual, sin tocar nada de lo que ya
--    se probó. Los reportes de un mismo envío comparten quién lo subió y el
--    instante (`creado_en`, que es el de la transacción): así la pantalla los
--    muestra juntos sin otra columna.
--    Las tareas que el plano no traía ya se guardaban como actividades propias
--    del código y vuelven en los reportes siguientes hasta llegar al 100 %
--    (migración 20261020100000); no cambia.
--
-- 2. LOS SUBCONTRATOS TAMBIÉN VAN A MAESTRANZA. Hasta hoy Administración solo
--    podía registrarlos para Producción o Acabados. Ahora también para
--    Maestranza, y el supervisor de cada una ve los suyos SIN MONTOS NI
--    RECIBOS: solo quién, qué, el inicio y el fin, y el avance que su área
--    reportó en el reporte diario (`subcontratos_del_area`). La función de
--    antes (`subcontratos_de_mi_area`, con recibos) queda porque el conector de
--    producción no deja quitar funciones, pero la pantalla ya no la llama.
-- =============================================================================

-- 1. Varios códigos en un mismo reporte -----------------------------------------------------
-- p_codigos: [{"id": "…", "codigo_interno": "…", "trabajos": [...], "personal_general": [...], "fotos": [...]}]
-- Cada elemento es lo que ya recibía registrar_reporte_diario para un código.
create or replace function public.registrar_reportes_diarios(
  p_fecha date, p_asunto text, p_descripcion text, p_codigos jsonb
) returns uuid[] language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo      uuid := public.usuario_actual();
  v_ids     uuid[];
  v_codigo  jsonb;
  v_id      uuid;
  v_norma   text;
  v_vistos  text[] := '{}';
  v_hechos  int;
  v_salida  uuid[] := '{}';
  v_estado  text;
  v_mensaje text;
begin
  perform public.exigir_permiso('reporte_diario.registrar');
  if v_yo is null then
    raise exception 'Vuelve a abrir el formulario del reporte.' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p_codigos) is distinct from 'array' or jsonb_array_length(p_codigos) = 0 then
    raise exception 'Escribe al menos un código interno con su trabajo.' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(p_codigos) > 10 then
    raise exception 'Un reporte lleva hasta 10 códigos internos.' using errcode = 'check_violation';
  end if;

  begin
    select array_agg((e->>'id')::uuid order by n) into v_ids
      from jsonb_array_elements(p_codigos) with ordinality as x(e, n);
  exception when invalid_text_representation then
    v_ids := null;
  end;
  if v_ids is null or array_position(v_ids, null) is not null
     or (select count(distinct i) from unnest(v_ids) i) <> cardinality(v_ids) then
    raise exception 'Vuelve a abrir el formulario del reporte.' using errcode = 'check_violation';
  end if;

  -- El reintento del mismo envío no sube otro: si ya entraron todos y son míos, se devuelven.
  perform pg_advisory_xact_lock(hashtextextended(v_ids[1]::text, 0));
  select count(*) into v_hechos from public.reportes_diarios where id = any(v_ids);
  if v_hechos = cardinality(v_ids)
     and not exists (select 1 from public.reportes_diarios where id = any(v_ids) and registrado_por is distinct from v_yo) then
    return v_ids;
  end if;
  if v_hechos > 0 then
    raise exception 'Ese reporte ya existe: vuelve a abrir el formulario.' using errcode = 'check_violation';
  end if;

  for v_codigo in select e from jsonb_array_elements(p_codigos) with ordinality as x(e, n) order by n loop
    v_norma := public.normalizar_codigo_interno(v_codigo->>'codigo_interno');
    if v_norma is not null and v_norma = any(v_vistos) then
      raise exception 'El código % va dos veces: junta sus trabajos en uno solo.', upper(btrim(v_codigo->>'codigo_interno'))
        using errcode = 'check_violation';
    end if;
    v_vistos := v_vistos || v_norma;
    -- Con varios códigos, el aviso dice en cuál está lo que hay que corregir:
    -- «el trabajo 2» solo no alcanza para encontrarlo.
    begin
      v_id := public.reporte_diario_insertar(
        (v_codigo->>'id')::uuid, p_fecha, v_codigo->>'codigo_interno', p_asunto, p_descripcion,
        v_codigo->'trabajos', v_codigo->'personal_general', v_codigo->'fotos', null);
    exception when others then
      get stacked diagnostics v_estado = returned_sqlstate, v_mensaje = message_text;
      if cardinality(v_ids) = 1 then
        raise;
      end if;
      raise exception 'En %: %',
        coalesce(nullif(upper(btrim(v_codigo->>'codigo_interno')), ''), 'el código ' || cardinality(v_salida) + 1 || ' del reporte'),
        v_mensaje using errcode = v_estado;
    end;
    v_salida := v_salida || v_id;
  end loop;
  return v_salida;
end;
$$;
revoke all on function public.registrar_reportes_diarios(date, text, text, jsonb) from public, anon;
grant execute on function public.registrar_reportes_diarios(date, text, text, jsonb) to authenticated;
comment on function public.registrar_reportes_diarios(date, text, text, jsonb) is
  'El reporte diario del supervisor con varios códigos internos: un reporte por código, todos en la misma transacción o ninguno, con el mismo día, asunto y descripción. Cada código pasa por las mismas reglas que registrar_reporte_diario. Exige reporte_diario.registrar.';

-- Los reportes que subieron juntos: mismo autor, mismo día y mismo instante de la
-- transacción. Sin índice nuevo: ix_reportes_diarios_autor (registrado_por, fecha)
-- ya lleva a los pocos reportes de esa persona ese día.

-- 2. Los subcontratos también van a Maestranza --------------------------------------------
create or replace function public.subcontrato_area(p_area text)
returns uuid language plpgsql stable security definer set search_path to 'public' as $$
declare v_id uuid;
begin
  if p_area is null or upper(btrim(p_area)) not in ('PRD', 'MTZ', 'ACB') then
    raise exception 'Elige para qué área va el subcontrato: Producción, Maestranza o Acabados.' using errcode = 'check_violation';
  end if;
  select a.id into v_id from public.areas a where a.codigo = upper(btrim(p_area));
  if v_id is null then
    raise exception 'El área % no está en el catálogo de áreas. Avisa a Sistemas.', upper(btrim(p_area));
  end if;
  return v_id;
end;
$$;
revoke all on function public.subcontrato_area(text) from public, anon, authenticated;

update public.permisos
   set descripcion = 'Ver, sin montos ni recibos, los subcontratos que Administración registró para su área (Producción, Maestranza o Acabados): quién hace el trabajo, para qué código interno, su inicio, su fin y el avance que reporta su área'
 where codigo = 'subcontratos.area';

-- Lo que ve el supervisor: sin un sol y sin recibos, con el avance que su área
-- reportó en el reporte diario (el último, como lo cuenta el avance del código).
create or replace function public.subcontratos_del_area()
returns table (
  id uuid, numero text, codigo_interno text, descripcion text, estado text,
  area_codigo text, area_nombre text, subcontratista text,
  fecha_inicio date, fecha_fin date, terminado_en timestamptz,
  avance numeric, ultimo_reporte date, reportes integer
) language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  perform public.exigir_permiso('subcontratos.area');
  return query
  with mias as (
    select a.id, a.codigo, a.nombre from public.areas a
     where a.codigo in ('PRD', 'MTZ', 'ACB') and public.puede_hoja_de_area(a.id)
  ), suyos as (
    select s.*, m.codigo as a_codigo, m.nombre as a_nombre
      from public.subcontratos s
      join mias m on m.id = s.area_id
     where s.estado <> 'ANULADO'
  ), avance as (
    select e.subcontrato_id, e.avance, e.ultima_fecha, e.reportes
      from (select distinct public.normalizar_codigo_interno(codigo_interno) as codigo from suyos) c
      cross join lateral public.codigo_interno_actividades_estado(c.codigo) e
     where e.subcontrato_id is not null
  )
  select s.id, s.numero, s.codigo_interno, s.descripcion, s.estado,
         s.a_codigo, s.a_nombre, sc.nombre,
         s.fecha_inicio, s.fecha_fin, s.terminado_en,
         case when s.estado = 'TERMINADO' then 100::numeric else a.avance end,
         a.ultima_fecha, coalesce(a.reportes, 0)
    from suyos s
    join public.subcontratistas sc on sc.id = s.subcontratista_id
    left join avance a on a.subcontrato_id = s.id
   order by s.codigo_interno, s.creado_en desc;
end;
$$;
revoke all on function public.subcontratos_del_area() from public, anon;
grant execute on function public.subcontratos_del_area() to authenticated;
comment on function public.subcontratos_del_area() is
  'Los subcontratos que Administración registró para el área de quien mira (Producción, Maestranza o Acabados), sin anulados, sin montos y sin recibos: quién, qué, inicio, fin y el avance que su área reportó en el reporte diario. Exige subcontratos.area.';
