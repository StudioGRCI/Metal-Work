-- =============================================================================
-- EL SUPERVISOR MARCA CUÁNDO EMPEZÓ Y CUÁNDO TERMINÓ DE VERDAD EL SUBCONTRATO
-- -----------------------------------------------------------------------------
-- DKS lo pidió el 2026-10-20, sobre el inicio y el fin de los subcontratos:
-- «también, pero referencial, porque según contrato puede ser diferente».
--
-- Hasta hoy el supervisor de Maestranza, Producción o Acabados solo veía las
-- fechas que Administración pone al registrar el subcontrato, que son las del
-- contrato. Desde aquí marca, aparte, el día en que el subcontratista empezó de
-- verdad y el día en que terminó. Son referenciales: no cambian las fechas del
-- contrato, ni el plazo, ni el estado (terminarlo sigue siendo de
-- Administración). Quedan con quién las marcó y cuándo, y Administración las ve
-- en el subcontrato junto a las pactadas.
--
-- Solo el supervisor de su área (o quien lleva las tres) las marca; no se
-- marcan en el futuro, el fin no va antes del inicio, y un subcontrato anulado
-- ya no se toca (su guardia lo rechaza).
-- =============================================================================

-- 1. Las columnas -----------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'subcontratos' and column_name = 'inicio_real') then
    alter table public.subcontratos
      add column inicio_real date,
      add column fin_real date,
      -- Sin índice: ni (a) ni (b) ni (c). Nadie filtra por quién marcó y un usuario no se borra.
      add column fechas_reales_por uuid constraint subcontratos_fechas_reales_por_fkey references public.usuarios(id) on delete restrict,
      add column fechas_reales_en timestamptz;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_subcontrato_fechas_reales') then
    alter table public.subcontratos add constraint ck_subcontrato_fechas_reales
      check ((fin_real is null or inicio_real is not null) and (fin_real is null or fin_real >= inicio_real));
  end if;
end $$;
comment on column public.subcontratos.inicio_real is
  'El día en que el subcontratista empezó de verdad, según el supervisor del área. Referencial: las fechas del contrato son fecha_inicio y fecha_fin.';
comment on column public.subcontratos.fin_real is
  'El día en que el subcontratista terminó de verdad, según el supervisor del área. Referencial: terminar el subcontrato sigue siendo de Administración.';

-- 2. El supervisor las marca --------------------------------------------------------------
create or replace function public.marcar_fechas_reales_subcontrato(p_id uuid, p_inicio date, p_fin date)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_hoy date := (now() at time zone 'America/Lima')::date;
  v_s   public.subcontratos%rowtype;
begin
  perform public.exigir_permiso('subcontratos.area');
  select * into v_s from public.subcontratos where id = p_id for update;
  if not found or v_s.area_id is null
     or not exists (select 1 from public.areas a where a.id = v_s.area_id and a.codigo in ('PRD', 'MTZ', 'ACB'))
     or not public.puede_hoja_de_area(v_s.area_id) then
    raise exception 'Ese subcontrato no es de tu área. Recarga la pantalla.' using errcode = 'check_violation';
  end if;
  if v_s.estado = 'ANULADO' then
    raise exception 'El subcontrato % está anulado: ya no se le marcan fechas.', v_s.numero using errcode = 'check_violation';
  end if;
  if p_inicio is null and p_fin is not null then
    raise exception 'Marca primero el día en que empezó.' using errcode = 'check_violation';
  end if;
  if p_inicio > v_hoy or p_fin > v_hoy then
    raise exception 'Las fechas reales van de hoy hacia atrás: el día en que de verdad empezó o terminó.' using errcode = 'check_violation';
  end if;
  if p_inicio < date '2020-01-01' then
    raise exception 'Revisa el año del inicio.' using errcode = 'check_violation';
  end if;
  if p_fin < p_inicio then
    raise exception 'No pudo terminar antes de empezar: revisa las dos fechas.' using errcode = 'check_violation';
  end if;
  update public.subcontratos
     set inicio_real = p_inicio, fin_real = p_fin,
         fechas_reales_por = public.usuario_actual(), fechas_reales_en = now()
   where id = p_id;
  return p_id;
end;
$$;
revoke all on function public.marcar_fechas_reales_subcontrato(uuid, date, date) from public, anon;
grant execute on function public.marcar_fechas_reales_subcontrato(uuid, date, date) to authenticated;
comment on function public.marcar_fechas_reales_subcontrato(uuid, date, date) is
  'El supervisor del área marca el día en que el subcontrato empezó y terminó de verdad (referencial; las del contrato no cambian). Vacías, las borra. Exige subcontratos.area y que el subcontrato sea de su área.';

-- 3. Lo que ve el supervisor, ahora con las fechas reales ----------------------------------
-- Una función nueva: las columnas de subcontratos_del_area no cambian sin
-- borrarla. La de antes queda como una vista de esta, con sus mismas columnas.
create or replace function public.subcontratos_del_area_con_fechas_reales()
returns table (
  id uuid, numero text, codigo_interno text, descripcion text, estado text,
  area_codigo text, area_nombre text, subcontratista text,
  fecha_inicio date, fecha_fin date, terminado_en timestamptz,
  avance numeric, ultimo_reporte date, reportes integer,
  inicio_real date, fin_real date, fechas_reales_en timestamptz
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
         a.ultima_fecha, coalesce(a.reportes, 0),
         s.inicio_real, s.fin_real, s.fechas_reales_en
    from suyos s
    join public.subcontratistas sc on sc.id = s.subcontratista_id
    left join avance a on a.subcontrato_id = s.id
   order by s.codigo_interno, s.creado_en desc;
end;
$$;
revoke all on function public.subcontratos_del_area_con_fechas_reales() from public, anon;
grant execute on function public.subcontratos_del_area_con_fechas_reales() to authenticated;
comment on function public.subcontratos_del_area_con_fechas_reales() is
  'Los subcontratos que Administración registró para el área de quien mira (Producción, Maestranza o Acabados), sin anulados, sin montos y sin recibos: quién, qué, las fechas del contrato, las reales que marcó el supervisor y el avance que su área reportó en el reporte diario. Exige subcontratos.area.';

create or replace function public.subcontratos_del_area()
returns table (
  id uuid, numero text, codigo_interno text, descripcion text, estado text,
  area_codigo text, area_nombre text, subcontratista text,
  fecha_inicio date, fecha_fin date, terminado_en timestamptz,
  avance numeric, ultimo_reporte date, reportes integer
) language plpgsql stable security definer set search_path to 'public' as $$
begin
  return query
    select f.id, f.numero, f.codigo_interno, f.descripcion, f.estado, f.area_codigo, f.area_nombre, f.subcontratista,
           f.fecha_inicio, f.fecha_fin, f.terminado_en, f.avance, f.ultimo_reporte, f.reportes
      from public.subcontratos_del_area_con_fechas_reales() f;
end;
$$;
revoke all on function public.subcontratos_del_area() from public, anon;
grant execute on function public.subcontratos_del_area() to authenticated;
comment on function public.subcontratos_del_area() is
  'Lo mismo que subcontratos_del_area_con_fechas_reales sin las fechas reales; queda para quien la llamaba antes. Exige subcontratos.area.';
