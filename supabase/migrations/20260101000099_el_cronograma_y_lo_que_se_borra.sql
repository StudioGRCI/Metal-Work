-- =============================================================================
-- EL CRONOGRAMA, EL PDF DE LA ORDEN Y LO QUE SE BORRA
-- -----------------------------------------------------------------------------
-- «Permite eliminar registros de avance; no hay para subir en PDF una orden de
-- trabajo, o subir un cronograma de reporte por especialidad.» Tres cosas:
--
-- 1. Borrar un reporte del día. Quien lo escribió lo borra mientras no esté
--    aprobado; el jefe de producción borra cualquiera. Las fotos se van con él
--    (la llave ya era en cascada) y la auditoría deja quién lo borró. El avance
--    con foto que movió una etapa no se borra: la etapa quedaría diciendo un
--    porcentaje que ya nadie reportó. El bueno va en un avance nuevo.
--
-- 2. El cronograma por área, con fechas. Cada actividad de la hoja lleva desde
--    cuándo y hasta cuándo se trabaja; así el sistema le dice a cada supervisor
--    qué le toca reportar hoy y qué se atrasó. Se carga de un Excel, de una vez
--    y todo o nada, con la función cargar_cronograma.
--
-- 3. Los archivos de la orden: el PDF de la orden de trabajo —el de la oficina
--    o el del cliente— y el Excel del cronograma quedan guardados en la orden,
--    como referencia. Es un lugar para el papel, no el repositorio documental
--    que se retiró en la 094.
-- =============================================================================

-- =============================================================================
-- 1. BORRAR UN REPORTE
-- -----------------------------------------------------------------------------
-- Las tres políticas de DELETE eran solo del administrador. Suman al jefe
-- (produccion.aprobar_reportes, el mismo permiso con que aprueba) y al autor
-- mientras el reporte no esté aprobado: lo aprobado queda firme, también para
-- borrarlo.
-- =============================================================================
drop policy if exists borrar_flota_avances on public.flota_avances;
create policy borrar_flota_avances on public.flota_avances
  for delete to authenticated
  using (public.es_admin()
         or public.tiene_permiso('produccion.aprobar_reportes')
         or (registrado_por = public.usuario_actual() and revision <> 'APROBADO'));

drop policy if exists borrar_ot_avances on public.ot_avances;
create policy borrar_ot_avances on public.ot_avances
  for delete to authenticated
  using (public.es_admin()
         or public.tiene_permiso('produccion.aprobar_reportes')
         or (registrado_por = public.usuario_actual() and revision <> 'APROBADO'));

drop policy if exists borrar_ot_actividad_avances on public.ot_actividad_avances;
create policy borrar_ot_actividad_avances on public.ot_actividad_avances
  for delete to authenticated
  using (public.es_admin()
         or public.tiene_permiso('produccion.aprobar_reportes')
         or (reportado_por = public.usuario_actual() and revision <> 'APROBADO'));

create or replace function public.fn_avance_que_movio_la_etapa()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if old.etapa_id is not null and old.avance_porcentaje is not null then
    raise exception 'Este avance puso la etapa al % %%: no se borra. Si estaba mal, registra uno nuevo con el que va.',
      round(old.avance_porcentaje)
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;

revoke all on function public.fn_avance_que_movio_la_etapa() from public, anon, authenticated;

drop trigger if exists trg_avance_que_movio_la_etapa on public.ot_avances;
create trigger trg_avance_que_movio_la_etapa before delete on public.ot_avances
  for each row execute function public.fn_avance_que_movio_la_etapa();

-- =============================================================================
-- 2. EL CRONOGRAMA: DESDE CUÁNDO Y HASTA CUÁNDO
-- =============================================================================
alter table public.ot_actividades
  add column if not exists fecha_inicio_plan date,
  add column if not exists fecha_fin_plan date;

alter table public.ot_actividades drop constraint if exists ck_ot_actividad_plan;
alter table public.ot_actividades add constraint ck_ot_actividad_plan
  check (fecha_inicio_plan is null or fecha_fin_plan is null or fecha_fin_plan >= fecha_inicio_plan);

comment on column public.ot_actividades.fecha_inicio_plan is
  'Desde cuándo se trabaja, según el cronograma. Con ella el taller sabe qué le toca reportar hoy.';
comment on column public.ot_actividades.fecha_fin_plan is
  'Hasta cuándo, según el cronograma. Pasada sin llegar al 100 %, la actividad está atrasada.';

-- La vista de la hoja suma al final las fechas y, para poder decir «qué toca
-- hoy» sin otra consulta, el número y el estado de su orden.
create or replace view public.v_ot_actividades as
select a.id,
       a.orden_id,
       a.area_id,
       ar.codigo as area_codigo,
       ar.nombre as area,
       a.orden_secuencia,
       a.nombre,
       a.detalle,
       a.referencia,
       a.peso_pct,
       coalesce(av.avanzado, 0::numeric) as avance_pct,
       coalesce(av.avanzado, 0::numeric) >= 100::numeric as terminada,
       av.ultimo as ultimo_reporte,
       av.reportes,
       a.creado_por,
       a.creado_en,
       a.fecha_inicio_plan,
       a.fecha_fin_plan,
       o.numero as orden_numero,
       o.estado::text as orden_estado,
       o.abierta_en_taller
  from public.ot_actividades a
  join public.areas ar on ar.id = a.area_id
  join public.ordenes_trabajo o on o.id = a.orden_id
  left join lateral (
    select sum(x.avance_pct) as avanzado, max(x.fecha) as ultimo, count(*) as reportes
      from public.ot_actividad_avances x
     where x.actividad_id = a.id
  ) av on true;

alter view public.v_ot_actividades set (security_invoker = on);
grant select on public.v_ot_actividades to authenticated;

-- -----------------------------------------------------------------------------
-- Cargar el cronograma de una vez. Corre con los permisos de quien la llama
-- (security invoker): la política de ot_actividades sigue decidiendo quién
-- escribe en qué hoja. Antes de tocar nada lo valida todo, para no dejar un
-- cronograma a medias:
--   · cada fila con su área, su actividad y fechas que tengan sentido;
--   · el área tiene que ser de quien carga (el jefe carga todas);
--   · una actividad no se repite dentro del archivo;
--   · por área, lo que trae el archivo más lo que ya estaba y el archivo no
--     nombra no pasa de 100 %.
-- Lo que ya estaba con el mismo nombre se actualiza —peso, referencia y
-- fechas—; lo nuevo se agrega al final de la lista. No se borra nada.
-- -----------------------------------------------------------------------------
create or replace function public.cargar_cronograma(p_orden uuid, p_filas jsonb)
returns jsonb
language plpgsql
set search_path to 'public'
as $$
declare
  v_numero  text;
  v_error   text;
  v_nuevas  integer := 0;
  v_cambios integer := 0;
  v_fila    record;
  v_id      uuid;
  v_sec     integer;
  n         integer;
begin
  perform public.exigir_permiso('produccion.actividades');

  select o.numero into v_numero from public.ordenes_trabajo o where o.id = p_orden;
  if v_numero is null then
    raise exception 'No se encontró la orden.' using errcode = 'foreign_key_violation';
  end if;
  -- Una orden que ya salió del taller, o que se anuló, no tiene qué planear.
  if exists (select 1 from public.ordenes_trabajo o
              where o.id = p_orden and o.estado in ('ENTREGADA', 'FACTURADA', 'ANULADA')) then
    raise exception 'La orden % ya está cerrada: no se le carga cronograma.', v_numero
      using errcode = 'check_violation';
  end if;

  if jsonb_typeof(p_filas) is distinct from 'array' or jsonb_array_length(p_filas) = 0 then
    raise exception 'El cronograma llegó vacío.' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(p_filas) > 500 then
    raise exception 'El cronograma trae más de 500 actividades: pártelo por área.' using errcode = 'check_violation';
  end if;

  create temporary table if not exists pg_temp.cronograma (
    fila integer, area_id uuid, nombre text, referencia text,
    peso numeric, inicio date, fin date, existente uuid
  ) on commit drop;
  truncate pg_temp.cronograma;

  begin
    insert into pg_temp.cronograma (fila, area_id, nombre, referencia, peso, inicio, fin)
    select t.ord::integer,
           (t.f ->> 'area_id')::uuid,
           btrim(t.f ->> 'nombre'),
           nullif(btrim(coalesce(t.f ->> 'referencia', '')), ''),
           coalesce(nullif(t.f ->> 'peso_pct', '')::numeric, 0),
           nullif(t.f ->> 'inicio', '')::date,
           nullif(t.f ->> 'fin', '')::date
      from jsonb_array_elements(p_filas) with ordinality as t(f, ord);
  exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then
    raise exception 'Una fila del cronograma trae un área, un peso o una fecha que no se entienden.'
      using errcode = 'check_violation';
  end;

  select format('Fila %s: %s', c.fila,
                case when c.area_id is null or not exists (select 1 from public.areas a where a.id = c.area_id and a.activo)
                       then 'el área no es una de las del taller'
                     when coalesce(c.nombre, '') = '' then 'falta la actividad'
                     when c.peso < 0 or c.peso > 100 then 'el peso va de 0 a 100'
                     when c.inicio is not null and c.fin is not null and c.fin < c.inicio then 'termina antes de empezar'
                     else 'esa hoja es de otra área' end)
    into v_error
    from pg_temp.cronograma c
   where c.area_id is null
      or not exists (select 1 from public.areas a where a.id = c.area_id and a.activo)
      or coalesce(c.nombre, '') = ''
      or c.peso < 0 or c.peso > 100
      or (c.inicio is not null and c.fin is not null and c.fin < c.inicio)
      or not public.puede_hoja_de_area(c.area_id)
   order by c.fila
   limit 1;
  if v_error is not null then
    raise exception '%', v_error using errcode = 'check_violation';
  end if;

  select format('«%s» está dos veces en %s.', min(c.nombre), min(ar.nombre))
    into v_error
    from pg_temp.cronograma c join public.areas ar on ar.id = c.area_id
   group by c.area_id, lower(c.nombre)
  having count(*) > 1
   limit 1;
  if v_error is not null then
    raise exception '%', v_error using errcode = 'check_violation';
  end if;

  -- Lo que ya estaba con ese nombre en esa área.
  update pg_temp.cronograma c
     set existente = a.id
    from public.ot_actividades a
   where a.orden_id = p_orden and a.area_id = c.area_id and lower(btrim(a.nombre)) = lower(c.nombre);

  select format('En %s el cronograma y lo que ya estaba suman %s %%: entre todas las actividades no pueden pasar de 100.',
                ar.nombre, round(t.total, 1))
    into v_error
    from (
      select x.area_id, sum(x.peso) as total
        from (
          select c.area_id, c.peso from pg_temp.cronograma c
          union all
          select a.area_id, a.peso_pct from public.ot_actividades a
           where a.orden_id = p_orden
             and a.area_id in (select c.area_id from pg_temp.cronograma c)
             and a.id not in (select c.existente from pg_temp.cronograma c where c.existente is not null)
        ) x
       group by x.area_id
    ) t
    join public.areas ar on ar.id = t.area_id
   where t.total > 100
   limit 1;
  if v_error is not null then
    raise exception '%', v_error using errcode = 'check_violation';
  end if;

  -- Primero se ponen en cero los pesos que cambian: el tope de 100 se mira
  -- fila por fila, y así ninguna suma intermedia pasa de la final.
  update public.ot_actividades a
     set peso_pct = 0
    from pg_temp.cronograma c
   where c.existente = a.id;

  for v_fila in select * from pg_temp.cronograma order by fila loop
    if v_fila.existente is not null then
      update public.ot_actividades
         set peso_pct = v_fila.peso,
             referencia = coalesce(v_fila.referencia, referencia),
             fecha_inicio_plan = v_fila.inicio,
             fecha_fin_plan = v_fila.fin
       where id = v_fila.existente;
      get diagnostics n = row_count;
      if n = 0 then
        raise exception 'No se pudo actualizar «%»: vuelve a cargar la pantalla.', v_fila.nombre
          using errcode = 'insufficient_privilege';
      end if;
      v_cambios := v_cambios + 1;
    else
      select coalesce(max(a.orden_secuencia), 0) + 1 into v_sec
        from public.ot_actividades a where a.orden_id = p_orden and a.area_id = v_fila.area_id;
      insert into public.ot_actividades (
        orden_id, area_id, orden_secuencia, nombre, referencia, peso_pct,
        fecha_inicio_plan, fecha_fin_plan, creado_por)
      values (
        p_orden, v_fila.area_id, least(v_sec, 999), v_fila.nombre, v_fila.referencia, v_fila.peso,
        v_fila.inicio, v_fila.fin, public.usuario_actual())
      returning id into v_id;
      if v_id is null then
        raise exception 'No se pudo agregar «%».', v_fila.nombre using errcode = 'insufficient_privilege';
      end if;
      v_nuevas := v_nuevas + 1;
    end if;
  end loop;

  perform public.ot_registrar_evento(
    p_orden, 'COMENTARIO',
    format('Se cargó el cronograma: %s actividades nuevas y %s actualizadas.', v_nuevas, v_cambios),
    jsonb_build_object('nuevas', v_nuevas, 'actualizadas', v_cambios));

  return jsonb_build_object('nuevas', v_nuevas, 'actualizadas', v_cambios);
end;
$$;

revoke all on function public.cargar_cronograma(uuid, jsonb) from public, anon;
grant execute on function public.cargar_cronograma(uuid, jsonb) to authenticated;

-- =============================================================================
-- 3. LOS ARCHIVOS DE LA ORDEN
-- -----------------------------------------------------------------------------
-- El PDF de la orden y el Excel del cronograma, guardados en la orden. La ruta
-- empieza por ot/{orden}/, como las fotos, y con eso las políticas de Storage
-- saben de qué orden es cada archivo y quién puede verlo.
-- =============================================================================
create table if not exists public.ot_adjuntos (
  id              uuid primary key default gen_random_uuid(),
  orden_id        uuid not null references public.ordenes_trabajo(id) on delete cascade,
  tipo            text not null default 'ORDEN',
  nombre_archivo  text not null,
  ruta_storage    text not null,
  mime_type       text,
  tamano_bytes    bigint,
  subido_por      uuid references public.usuarios(id) on delete set null default public.usuario_actual(),
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  constraint ck_ot_adjunto_tipo check (tipo in ('ORDEN', 'CRONOGRAMA')),
  constraint ck_ot_adjunto_ruta check (ruta_storage like 'ot/' || orden_id::text || '/%'),
  constraint uq_ot_adjunto_ruta unique (ruta_storage)
);

comment on table public.ot_adjuntos is
  'El PDF de la orden de trabajo y el Excel del cronograma, guardados en la orden como referencia (bucket adjuntos-ot).';

-- (b): la pantalla de la orden los busca por su orden, siempre.
create index if not exists idx_ot_adjuntos_orden on public.ot_adjuntos (orden_id);

alter table public.ot_adjuntos enable row level security;

drop policy if exists ver_ot_adjuntos on public.ot_adjuntos;
create policy ver_ot_adjuntos on public.ot_adjuntos
  for select to authenticated
  using (public.puede_ver_orden(orden_id));

drop policy if exists crear_ot_adjuntos on public.ot_adjuntos;
create policy crear_ot_adjuntos on public.ot_adjuntos
  for insert to authenticated
  with check ((public.es_admin()
               or public.tiene_permiso('produccion.actividades')
               or public.tiene_permiso('ordenes.editar')
               or public.tiene_permiso('ordenes.crear')
               or public.tiene_permiso('ordenes.abrir_taller'))
              and public.puede_ver_orden(orden_id)
              and subido_por = public.usuario_actual());

drop policy if exists borrar_ot_adjuntos on public.ot_adjuntos;
create policy borrar_ot_adjuntos on public.ot_adjuntos
  for delete to authenticated
  using (public.es_admin()
         or subido_por = public.usuario_actual()
         or public.tiene_permiso('ordenes.editar')
         or public.tiene_permiso('produccion.cualquier_area'));

revoke all on public.ot_adjuntos from anon, public;
grant select, insert, delete on public.ot_adjuntos to authenticated;

select public.activar_timestamps('ot_adjuntos');
select public.activar_auditoria('ot_adjuntos');

-- El bucket: privado, PDF y Excel, hasta 20 MB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('adjuntos-ot', 'adjuntos-ot', false, 20971520,
        array['application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists mw_leer_adjuntos_ot on storage.objects;
create policy mw_leer_adjuntos_ot on storage.objects
  for select to authenticated
  using (bucket_id = 'adjuntos-ot'
         and public.orden_de_ruta(name) is not null
         and public.puede_ver_orden(public.orden_de_ruta(name)));

drop policy if exists mw_subir_adjuntos_ot on storage.objects;
create policy mw_subir_adjuntos_ot on storage.objects
  for insert to authenticated
  with check (bucket_id = 'adjuntos-ot'
              and public.orden_de_ruta(name) is not null
              and public.puede_ver_orden(public.orden_de_ruta(name))
              and (public.es_admin()
                   or public.tiene_permiso('produccion.actividades')
                   or public.tiene_permiso('ordenes.editar')
                   or public.tiene_permiso('ordenes.crear')
                   or public.tiene_permiso('ordenes.abrir_taller')));

drop policy if exists mw_borrar_adjuntos_ot on storage.objects;
create policy mw_borrar_adjuntos_ot on storage.objects
  for delete to authenticated
  using (bucket_id = 'adjuntos-ot'
         and (public.es_admin()
              or owner_id = (auth.uid())::text
              or public.tiene_permiso('ordenes.editar')
              or public.tiene_permiso('produccion.cualquier_area')));

-- =============================================================================
-- 4. COMPROBACIONES
-- =============================================================================
do $$
begin
  if not exists (select 1 from pg_class where oid = 'public.ot_adjuntos'::regclass and relrowsecurity) then
    raise exception 'ot_adjuntos quedó sin seguridad por fila';
  end if;
  if coalesce((select array_to_string(reloptions, ',') from pg_class where oid = 'public.v_ot_actividades'::regclass), '')
       not similar to '%security_invoker=(on|true)%' then
    raise exception 'v_ot_actividades corre como su dueño y se salta el RLS';
  end if;
  if has_function_privilege('anon', 'public.cargar_cronograma(uuid, jsonb)', 'execute') then
    raise exception 'cargar_cronograma quedó abierta al rol anónimo';
  end if;
  if not exists (select 1 from storage.buckets where id = 'adjuntos-ot' and not public) then
    raise exception 'Falta el bucket privado adjuntos-ot';
  end if;
end $$;
