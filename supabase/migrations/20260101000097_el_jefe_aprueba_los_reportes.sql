-- =============================================================================
-- EL JEFE DE PRODUCCIÓN APRUEBA LOS REPORTES
-- -----------------------------------------------------------------------------
-- «Que el jefe de producción apruebe. Corregir y destrabar.» Tres cosas que
-- van juntas porque se pisan:
--
-- 1. Todo reporte del día nace «por aprobar». El jefe de producción lo aprueba
--    o lo observa con un motivo. Aprobado queda firme; observado vuelve a quien
--    lo escribió, con aviso en la campana, y al corregirlo vuelve a pedir el
--    visto. El avance cuenta desde que se reporta —el taller no espera al
--    jefe—: la aprobación es el visto bueno, no la llave del porcentaje.
--    Lo que escribe quien aprueba nace aprobado.
--
-- 2. Corregir: el autor corrige su reporte mientras no esté aprobado —el
--    sistema lo pedía («corrige el de hoy») y no había cómo—. Quién puede tocar
--    qué fila lo siguen diciendo las políticas; este disparador dice qué pasa
--    con la revisión al corregir.
--
-- 3. Destrabar: la traba vigente es la del ÚLTIMO reporte, no la última que se
--    escribió. Antes la vista buscaba el último reporte con traba, y un
--    reporte posterior que decía «Nada» no la quitaba: la unidad quedaba
--    trabada para siempre.
--
-- Son tres tablas de reporte y las tres llevan lo mismo: la hoja por área
-- (ot_actividad_avances), el avance con foto de la orden (ot_avances) y el de
-- los trabajos sin orden (flota_avances).
-- =============================================================================

-- =============================================================================
-- 1. EL PERMISO
-- -----------------------------------------------------------------------------
-- Un permiso y no un rol escrito a mano en la política. Se reparte en la misma
-- migración: un permiso sin rol es una puerta tapiada.
-- =============================================================================
insert into public.permisos (codigo, modulo, descripcion) values
  ('produccion.aprobar_reportes', 'Producción',
   'Aprobar u observar los reportes del día del taller')
on conflict (codigo) do update set descripcion = excluded.descripcion;

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, 'produccion.aprobar_reportes'
  from public.roles r
 where r.codigo in ('JEFE_PRODUCCION', 'JEFE_TALLER')
on conflict do nothing;

-- =============================================================================
-- 2. EL ESTADO DE LA REVISIÓN, EN LAS TRES TABLAS
-- =============================================================================
do $$
begin
  if not exists (select 1 from pg_type
                  where typname = 'estado_revision' and typnamespace = 'public'::regnamespace) then
    create type public.estado_revision as enum ('PENDIENTE', 'APROBADO', 'OBSERVADO');
  end if;
end $$;

comment on type public.estado_revision is
  'En qué va un reporte del día con el jefe de producción: por aprobar, aprobado (firme) u observado (vuelve a quien lo escribió, con el motivo).';

-- Lo que ya estaba escrito antes de esta regla se da por visto: el jefe no
-- arranca con semanas de reportes por aprobar. La columna nace con APROBADO
-- —así se llenan las filas que ya existen sin disparar nada ni ensuciar la
-- auditoría— y enseguida el valor por defecto pasa a PENDIENTE, aunque quien
-- manda al insertar es el disparador de la sección 3.
do $$
declare t text;
begin
  foreach t in array array['ot_actividad_avances', 'ot_avances', 'flota_avances'] loop
    execute format('alter table public.%I add column if not exists revision public.estado_revision not null default ''APROBADO''', t);
    execute format('alter table public.%I alter column revision set default ''PENDIENTE''', t);
    execute format('alter table public.%I add column if not exists revisado_por uuid references public.usuarios(id)', t);
    execute format('alter table public.%I add column if not exists revisado_en timestamptz', t);
    execute format('alter table public.%I add column if not exists observacion text', t);
    execute format('alter table public.%I add column if not exists corregido_en timestamptz', t);

    execute format('alter table public.%I drop constraint if exists %I', t, 'ck_' || t || '_observado_con_motivo');
    execute format('alter table public.%I add constraint %I check (revision <> ''OBSERVADO'' or length(btrim(coalesce(observacion, ''''))) >= 3)',
                   t, 'ck_' || t || '_observado_con_motivo');

    execute format('comment on column public.%I.revision is %L', t,
      'Por aprobar, aprobado u observado. La sella la base: nadie la escribe a mano sin produccion.aprobar_reportes.');
    execute format('comment on column public.%I.observacion is %L', t,
      'Lo que el jefe pidió corregir. Se queda como historia aunque después se apruebe.');
    execute format('comment on column public.%I.corregido_en is %L', t,
      'La última vez que se cambió lo que dice el reporte después de escrito.');
  end loop;
end $$;

-- La hoja por área no tenía autor por defecto, las otras dos sí: un reporte sin
-- autor no tiene a quién avisarle cuando el jefe lo observa.
alter table public.ot_actividad_avances alter column reportado_por set default public.usuario_actual();

-- =============================================================================
-- 3. LA REGLA DE LA REVISIÓN
-- -----------------------------------------------------------------------------
-- Uno para las tres tablas. «Qué cambió» se mira comparando la fila entera
-- menos las columnas de la revisión, así que vale igual para las tres aunque
-- cada una tenga sus campos.
-- =============================================================================
create or replace function public.fn_reporte_revision()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_aprueba   constant boolean := public.es_admin() or public.tiene_permiso('produccion.aprobar_reportes');
  v_ignorar   constant text[] := array['revision', 'revisado_por', 'revisado_en', 'observacion',
                                       'corregido_en', 'actualizado_en'];
  v_revisa    boolean;
  v_corrige   boolean;
begin
  if tg_op = 'INSERT' then
    -- Lo que escribe quien aprueba nace aprobado: no tiene a quién pedirle el
    -- visto. Lo que manda el formulario en estas columnas no vale.
    if v_aprueba then
      new.revision := 'APROBADO';
      new.revisado_por := public.usuario_actual();
      new.revisado_en := now();
    else
      new.revision := 'PENDIENTE';
      new.revisado_por := null;
      new.revisado_en := null;
    end if;
    new.observacion := null;
    new.corregido_en := null;
    return new;
  end if;

  v_revisa  := new.revision is distinct from old.revision
            or new.observacion is distinct from old.observacion;
  v_corrige := (to_jsonb(new) - v_ignorar) is distinct from (to_jsonb(old) - v_ignorar);

  if v_revisa then
    if not v_aprueba then
      raise exception 'El visto bueno de los reportes lo da el jefe de producción.'
        using errcode = 'insufficient_privilege';
    end if;
    if new.revision = 'PENDIENTE' then
      new.revisado_por := null;
      new.revisado_en := null;
    else
      new.revisado_por := public.usuario_actual();
      new.revisado_en := now();
    end if;
  else
    new.revisado_por := old.revisado_por;
    new.revisado_en := old.revisado_en;
  end if;

  if v_corrige then
    -- Aprobado queda firme. Solo quien aprueba lo puede tocar: el visto es suyo.
    if old.revision = 'APROBADO' and not v_aprueba then
      raise exception 'Ese reporte ya lo aprobó el jefe de producción: queda como está.'
        using errcode = 'check_violation';
    end if;
    -- En el avance con foto de la orden, el porcentaje mueve la etapa y eso
    -- pasa solo al registrarlo (fn_avance_mueve_etapa): corregirlo aquí dejaría
    -- la etapa diciendo otra cosa. El porcentaje bueno va en un avance nuevo.
    if tg_table_name = 'ot_avances'
       and ((to_jsonb(new) -> 'avance_porcentaje') is distinct from (to_jsonb(old) -> 'avance_porcentaje')
            or (to_jsonb(new) -> 'etapa_id') is distinct from (to_jsonb(old) -> 'etapa_id')) then
      raise exception 'El porcentaje de la etapa no se corrige: registra un avance nuevo con el que va.'
        using errcode = 'check_violation';
    end if;
    new.corregido_en := now();
    -- Corregido un observado, vuelve a pedir el visto: el jefe tiene que ver
    -- lo nuevo. La observación se queda como historia.
    if not v_revisa and old.revision = 'OBSERVADO' then
      new.revision := 'PENDIENTE';
      new.revisado_por := null;
      new.revisado_en := null;
    end if;
  else
    new.corregido_en := old.corregido_en;
  end if;

  return new;
end;
$$;

revoke all on function public.fn_reporte_revision() from public, anon, authenticated;

-- El aviso a quien escribió el reporte cuando el jefe lo observa. Corre como
-- dueño porque el taller no puede escribir avisos a otros; revocado a todos.
create or replace function public.fn_reporte_observado_avisa()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_fila  constant jsonb := to_jsonb(new);
  v_autor uuid := coalesce((v_fila ->> 'registrado_por')::uuid, (v_fila ->> 'reportado_por')::uuid);
  v_ruta  text;
  v_sobre text;
begin
  if new.revision <> 'OBSERVADO'
     or (old.revision = 'OBSERVADO' and new.observacion is not distinct from old.observacion) then
    return null;
  end if;

  if tg_table_name = 'flota_avances' then
    v_ruta := '/avance/trabajos/' || (v_fila ->> 'flota_id');
    select coalesce(f.placa, f.descripcion) into v_sobre
      from public.flota_unidades f where f.id = (v_fila ->> 'flota_id')::uuid;
  else
    v_ruta := case when tg_table_name = 'ot_avances'
                   then '/avance/' || (v_fila ->> 'orden_id')
                   else '/ordenes/' || (v_fila ->> 'orden_id') || '?vista=actividades' end;
    select o.numero into v_sobre
      from public.ordenes_trabajo o where o.id = (v_fila ->> 'orden_id')::uuid;
  end if;

  perform public.notificar_a_usuario(
    v_autor,
    'El jefe observó tu reporte',
    format('%s, del %s: «%s»', coalesce(v_sobre, 'Reporte'), to_char(new.fecha, 'DD/MM'), new.observacion),
    v_ruta,
    tg_table_name,
    new.id,
    public.usuario_actual());

  return null;
end;
$$;

revoke all on function public.fn_reporte_observado_avisa() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['ot_actividad_avances', 'ot_avances', 'flota_avances'] loop
    execute format('drop trigger if exists trg_reporte_revision on public.%I', t);
    execute format('create trigger trg_reporte_revision before insert or update on public.%I
                      for each row execute function public.fn_reporte_revision()', t);
    execute format('drop trigger if exists trg_reporte_observado_avisa on public.%I', t);
    execute format('create trigger trg_reporte_observado_avisa after update of revision, observacion on public.%I
                      for each row execute function public.fn_reporte_observado_avisa()', t);
  end loop;
end $$;

-- =============================================================================
-- 4. QUIÉN PUEDE TOCAR LA FILA
-- -----------------------------------------------------------------------------
-- Las políticas de corregir se quedan como estaban y suman a quien aprueba. Si
-- no, la acción de aprobar exigiría un permiso que la política no conoce y el
-- UPDATE afectaría cero filas sin error —la falla más cara del proyecto—.
-- Hoy los dos jefes pasan igual por cualquier_area o planificar; esto es para
-- el día en que alguien apruebe sin tener esos otros permisos.
--
-- Y el autor corrige lo suyo hasta el día siguiente, como antes, salvo que el
-- jefe se lo haya observado: lo observado se corrige cuando llegue el aviso,
-- aunque sea de la semana pasada. Si no, el aviso pediría algo imposible.
-- =============================================================================
drop policy if exists editar_flota_avances on public.flota_avances;
create policy editar_flota_avances on public.flota_avances
  for update to authenticated
  using (public.es_admin()
         or public.tiene_permiso('produccion.cualquier_area')
         or public.tiene_permiso('produccion.aprobar_reportes')
         or (registrado_por = public.usuario_actual()
             and (fecha >= current_date - 1 or revision = 'OBSERVADO')
             and public.puede_hoja_de_area(area_id)))
  with check (public.es_admin()
              or public.tiene_permiso('produccion.cualquier_area')
              or public.tiene_permiso('produccion.aprobar_reportes')
              or (registrado_por = public.usuario_actual() and public.puede_hoja_de_area(area_id)));

drop policy if exists editar_ot_avances on public.ot_avances;
create policy editar_ot_avances on public.ot_avances
  for update to authenticated
  using (public.es_admin()
         or (registrado_por = public.usuario_actual() and (fecha >= current_date - 1 or revision = 'OBSERVADO'))
         or public.tiene_permiso('produccion.planificar')
         or public.tiene_permiso('produccion.aprobar_reportes'))
  with check (public.puede_ver_orden(orden_id));

drop policy if exists editar_ot_actividad_avances on public.ot_actividad_avances;
create policy editar_ot_actividad_avances on public.ot_actividad_avances
  for update to authenticated
  using (public.es_admin()
         or public.tiene_permiso('produccion.aprobar_reportes')
         or (public.tiene_permiso('produccion.registrar') and public.puede_hoja_de_actividad(actividad_id)))
  with check (public.es_admin()
              or public.tiene_permiso('produccion.aprobar_reportes')
              or (public.tiene_permiso('produccion.registrar') and public.puede_hoja_de_actividad(actividad_id)));

-- =============================================================================
-- 5. DESTRABAR: LA TRABA ES LA DEL ÚLTIMO REPORTE
-- -----------------------------------------------------------------------------
-- Las dos vistas se reescriben iguales salvo el `trabado`, que ya no filtra
-- `impedimento is not null`: toma el del último reporte, y si ese dice nada,
-- no hay traba.
-- =============================================================================
create or replace view public.unidad_tablero as
select o.id as orden_id,
       o.numero as orden_numero,
       o.estado as orden_estado,
       o.prioridad,
       o.sede_id,
       o.unidad_id,
       u.placa,
       u.tipo_vehiculo,
       u.marca,
       u.modelo,
       c.id as cliente_id,
       c.razon_social as cliente,
       tc.nombre as tipo_carroceria,
       o.descripcion,
       o.avance_porcentaje,
       o.fecha_entrega_comprometida,
       public.dias_habiles_entre(current_date, o.fecha_entrega_comprometida) as dias_habiles_restantes,
       (r.nombres || ' '::text) || r.apellidos as responsable,
       actual.etapa as etapa_actual,
       actual.estado_etapa,
       actual.avance_etapa,
       ultimo.fecha as ultimo_avance_fecha,
       ultimo.descripcion as ultimo_avance,
       current_date - ultimo.fecha as dias_sin_avance,
       ultimo.impedimento,
       coalesce(fotos.total, 0) as fotos
  from public.ordenes_trabajo o
  left join public.clientes c on c.id = o.cliente_id
  left join public.unidades u on u.id = o.unidad_id
  left join public.tipos_carroceria tc on tc.id = o.tipo_carroceria_id
  left join public.usuarios r on r.id = o.responsable_id
  left join lateral (
    select ec.nombre as etapa, oe.estado as estado_etapa, oe.avance_porcentaje as avance_etapa
      from public.ot_etapas oe
      join public.etapas_catalogo ec on ec.id = oe.etapa_catalogo_id
     where oe.orden_id = o.id and oe.estado = any (array['EN_PROCESO'::public.estado_etapa_ot, 'PENDIENTE'::public.estado_etapa_ot])
     order by (oe.estado = 'EN_PROCESO'::public.estado_etapa_ot) desc, oe.orden_secuencia
     limit 1
  ) actual on true
  left join lateral (
    select a.fecha, a.descripcion, a.impedimento
      from public.ot_avances a
     where a.orden_id = o.id
     order by a.fecha desc, a.creado_en desc
     limit 1
  ) ultimo on true
  left join lateral (
    select count(*)::integer as total
      from public.ot_avances a
      join public.ot_avance_fotos f on f.avance_id = a.id
     where a.orden_id = o.id
  ) fotos on true
 where o.estado = any (array['APROBADA'::public.estado_ot, 'PROGRAMADA'::public.estado_ot, 'EN_PROCESO'::public.estado_ot,
                             'PAUSADA'::public.estado_ot, 'CONTROL_CALIDAD'::public.estado_ot, 'TERMINADA'::public.estado_ot]);

alter view public.unidad_tablero set (security_invoker = on);
grant select on public.unidad_tablero to authenticated;

create or replace view public.v_flota_unidades as
select f.id,
       f.placa,
       f.placa_clave,
       f.descripcion,
       f.cliente,
       f.trajo,
       f.trabajo,
       f.estado::text as estado,
       f.ingreso,
       (f.ingreso at time zone 'America/Lima')::date as ingreso_fecha,
       f.lista_en,
       f.salio_en,
       f.retiro,
       f.sede_id,
       f.registrado_por,
       nullif(btrim(coalesce(u.nombres, '') || ' ' || coalesce(u.apellidos, '')), '') as registrado_por_nombre,
       ultimo.fecha as ultimo_avance_fecha,
       ultimo.descripcion as ultimo_avance,
       ultimo.area_id as area_actual_id,
       ultimo.area as area_actual,
       ultimo.avance_porcentaje,
       current_date - coalesce(ultimo.fecha, (f.ingreso at time zone 'America/Lima')::date) as dias_sin_avance,
       current_date - (f.ingreso at time zone 'America/Lima')::date as dias_en_taller,
       ultimo.impedimento,
       coalesce(fotos.total, 0) as fotos,
       coalesce(reportes.total, 0) as reportes
  from public.flota_unidades f
  left join public.usuarios u on u.id = f.registrado_por
  left join lateral (
    select a.fecha, a.descripcion, a.avance_porcentaje, a.impedimento, a.area_id, ar.nombre as area
      from public.flota_avances a
      join public.areas ar on ar.id = a.area_id
     where a.flota_id = f.id
     order by a.fecha desc, a.creado_en desc
     limit 1
  ) ultimo on true
  left join lateral (
    select count(*)::integer as total
      from public.flota_avances a
      join public.flota_avance_fotos ff on ff.avance_id = a.id
     where a.flota_id = f.id
  ) fotos on true
  left join lateral (
    select count(*)::integer as total from public.flota_avances a where a.flota_id = f.id
  ) reportes on true;

alter view public.v_flota_unidades set (security_invoker = on);
grant select on public.v_flota_unidades to authenticated;

-- =============================================================================
-- 6. LA REVISIÓN, A LA VISTA
-- -----------------------------------------------------------------------------
-- Las tres vistas de reportes suman al final la revisión y quién la dio.
-- `create or replace` solo deja agregar columnas al final: las de antes quedan
-- en su lugar.
-- =============================================================================
create or replace view public.v_flota_avance_diario as
select a.id,
       a.flota_id,
       a.fecha,
       a.descripcion,
       a.avance_porcentaje,
       a.impedimento,
       a.creado_en,
       a.area_id,
       ar.codigo as area_codigo,
       ar.nombre as area,
       f.placa,
       f.descripcion as unidad,
       f.cliente,
       f.trabajo,
       f.estado::text as estado,
       a.registrado_por,
       nullif(btrim(coalesce(u.nombres, '') || ' ' || coalesce(u.apellidos, '')), '') as registrado_por_nombre,
       coalesce(fotos.total, 0) as fotos,
       a.revision::text as revision,
       a.observacion,
       a.revisado_en,
       nullif(btrim(coalesce(rv.nombres, '') || ' ' || coalesce(rv.apellidos, '')), '') as revisado_por_nombre,
       a.corregido_en
  from public.flota_avances a
  join public.flota_unidades f on f.id = a.flota_id
  join public.areas ar on ar.id = a.area_id
  left join public.usuarios u on u.id = a.registrado_por
  left join public.usuarios rv on rv.id = a.revisado_por
  left join lateral (
    select count(*)::integer as total from public.flota_avance_fotos ff where ff.avance_id = a.id
  ) fotos on true;

alter view public.v_flota_avance_diario set (security_invoker = on);
grant select on public.v_flota_avance_diario to authenticated;

create or replace view public.ot_avance_resumen as
select a.id,
       a.orden_id,
       o.numero as orden_numero,
       o.estado as orden_estado,
       c.razon_social as cliente,
       u.placa,
       a.etapa_id,
       e.nombre as etapa,
       a.fecha,
       a.descripcion,
       a.avance_porcentaje,
       a.impedimento,
       a.registrado_por,
       (p.nombres || ' '::text) || p.apellidos as registrado_por_nombre,
       a.creado_en,
       coalesce(f.fotos, 0) as fotos,
       a.revision::text as revision,
       a.observacion,
       a.revisado_en,
       nullif(btrim(coalesce(rv.nombres, '') || ' ' || coalesce(rv.apellidos, '')), '') as revisado_por_nombre,
       a.corregido_en
  from public.ot_avances a
  join public.ordenes_trabajo o on o.id = a.orden_id
  left join public.clientes c on c.id = o.cliente_id
  left join public.unidades u on u.id = o.unidad_id
  left join public.ot_etapas oe on oe.id = a.etapa_id
  left join public.etapas_catalogo e on e.id = oe.etapa_catalogo_id
  left join public.usuarios p on p.id = a.registrado_por
  left join public.usuarios rv on rv.id = a.revisado_por
  left join lateral (
    select count(*)::integer as fotos from public.ot_avance_fotos ff where ff.avance_id = a.id
  ) f on true;

alter view public.ot_avance_resumen set (security_invoker = on);
grant select on public.ot_avance_resumen to authenticated;

create or replace view public.v_ot_avance_diario as
select av.id,
       av.fecha,
       av.avance_pct,
       av.nota,
       av.creado_en,
       a.id as actividad_id,
       a.nombre as actividad,
       a.referencia,
       a.peso_pct,
       ar.id as area_id,
       ar.codigo as area_codigo,
       ar.nombre as area,
       o.id as orden_id,
       o.numero as orden_numero,
       o.estado::text as orden_estado,
       o.descripcion as orden_descripcion,
       av.reportado_por,
       nullif(btrim(coalesce(u.nombres, '') || ' ' || coalesce(u.apellidos, '')), '') as reportado_por_nombre,
       (select sum(x.avance_pct) from public.ot_actividad_avances x where x.actividad_id = a.id) as acumulado_pct,
       av.revision::text as revision,
       av.observacion,
       av.revisado_en,
       nullif(btrim(coalesce(rv.nombres, '') || ' ' || coalesce(rv.apellidos, '')), '') as revisado_por_nombre,
       av.corregido_en
  from public.ot_actividad_avances av
  join public.ot_actividades a on a.id = av.actividad_id
  join public.areas ar on ar.id = a.area_id
  join public.ordenes_trabajo o on o.id = a.orden_id
  left join public.usuarios u on u.id = av.reportado_por
  left join public.usuarios rv on rv.id = av.revisado_por;

alter view public.v_ot_avance_diario set (security_invoker = on);
grant select on public.v_ot_avance_diario to authenticated;

-- =============================================================================
-- 7. COMPROBACIONES
-- =============================================================================
do $$
declare v_falta text;
begin
  if not exists (select 1 from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
                  where rp.permiso_codigo = 'produccion.aprobar_reportes' and r.codigo = 'JEFE_PRODUCCION') then
    raise exception 'El jefe de producción quedó sin produccion.aprobar_reportes';
  end if;

  select string_agg(t, ', ') into v_falta
    from unnest(array['ot_actividad_avances', 'ot_avances', 'flota_avances']) as t
   where not exists (select 1 from pg_trigger
                      where tgname = 'trg_reporte_revision' and tgrelid = ('public.' || t)::regclass)
      or not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = t and column_name = 'revision');
  if v_falta is not null then
    raise exception 'Les falta la revisión a: %', v_falta;
  end if;

  select string_agg(c.relname, ', ') into v_falta
    from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
     and c.relname in ('unidad_tablero', 'v_flota_unidades', 'v_flota_avance_diario', 'ot_avance_resumen', 'v_ot_avance_diario')
     and coalesce(array_to_string(c.reloptions, ','), '') not similar to '%security_invoker=(on|true)%';
  if v_falta is not null then
    raise exception 'Estas vistas corren como su dueño y se saltan el RLS: %', v_falta;
  end if;
end $$;
