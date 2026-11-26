-- =============================================================================
-- LOS TIEMPOS DE ENTREGA AVISAN SOLOS
-- -----------------------------------------------------------------------------
-- Tercera entrega del plan de tiempos de entrega que DKS aprobó el 2026-11-25
-- («hacer el semáforo de actividades o de fechas para que les vaya avisando»).
-- La primera (20261125100000) dio a RR. HH. el tablero con el semáforo; la
-- segunda (20261125310000), quién lleva cada etapa. Esta hace que el sistema
-- avise sin que nadie tenga que entrar a mirar.
--
-- Lo que se acordó en el plan (decisiones 6 y 7):
--   * Una revisión diaria a las 7:00 a. m. (hora de Lima), solo en día
--     laborable del calendario de la empresa. Avisa por etapa de arriba, con lo
--     peor de ella y de sus subetapas, como cuenta el tablero.
--   * Un aviso cuando una etapa pasa a ámbar (vence hoy o en 3 días hábiles o
--     menos), otro cuando vence, y un recordatorio cada 2 días hábiles mientras
--     siga vencida, junto en un aviso por cuenta. No un aviso diario a todos,
--     que cansa y se deja de leer.
--   * Gerencia: cuando una etapa vence, y un resumen los lunes (o el primer
--     día laborable de la semana, si el lunes es feriado).
--   * En el sistema (la campana y el globo del menú), a las cuentas que
--     existen: Recursos Humanos, que lleva los tiempos, y el supervisor del
--     área de la etapa. Las personas del taller no tienen cuenta: les llega por
--     su supervisor. WhatsApp o correo quedan para la entrega 4.
--
-- Solo cuentan las etapas sin terminar de los códigos que siguen en el tablero:
-- la unidad que ya se entregó no avisa más. Si Diseño cambia la fecha de una
-- etapa, el aviso vuelve a salir para la fecha nueva. Cada aviso que sale queda
-- anotado, para no repetirlo y para saber cuándo toca el recordatorio.
-- =============================================================================

-- 1. Lo que ya se avisó -------------------------------------------------------------
create table if not exists public.tiempos_entrega_avisos (
  id          uuid primary key default gen_random_uuid(),
  -- Vacía en el resumen semanal y en la anotación de cada revisión, que no son de una etapa.
  etapa_id    uuid references public.codigo_etapas(id) on delete restrict,
  tipo        text not null,
  -- La fecha comprometida que se avisó: si Diseño la cambia, se avisa de nuevo.
  fin_plan    date,
  fecha       date not null,
  avisados    integer not null default 0,
  creado_en   timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint ck_tiempos_entrega_aviso_tipo check (tipo in ('POR_VENCER', 'VENCIDA', 'RECORDATORIO', 'RESUMEN_SEMANAL', 'REVISION')),
  constraint ck_tiempos_entrega_aviso_etapa check ((tipo in ('RESUMEN_SEMANAL', 'REVISION')) = (etapa_id is null))
);
comment on table public.tiempos_entrega_avisos is
  'Cada aviso de tiempos de entrega que salió: de qué etapa o subetapa (un aviso por etapa de arriba anota cada una de las que cubre), de qué tipo, por qué fecha comprometida y a cuántas cuentas (en el recordatorio, las del aviso agrupado del día). Y cada revisión diaria que corrió (REVISION), para que el tablero diga cuándo fue la última y no prometa avisos que no salen. Lo escribe solo la revisión diaria. Migración 20261126310000.';

-- Un aviso de cada tipo por etapa y fecha comprometida; un recordatorio por día;
-- un resumen por semana y una anotación por día de revisión. Así la revisión se puede correr dos veces sin repetir.
create unique index if not exists uq_tiempos_entrega_aviso_unico
  on public.tiempos_entrega_avisos (etapa_id, tipo, fin_plan) where tipo in ('POR_VENCER', 'VENCIDA');
create unique index if not exists uq_tiempos_entrega_aviso_del_dia
  on public.tiempos_entrega_avisos (etapa_id, fecha) where tipo = 'RECORDATORIO';
create unique index if not exists uq_tiempos_entrega_resumen
  on public.tiempos_entrega_avisos (fecha) where tipo = 'RESUMEN_SEMANAL';
create unique index if not exists uq_tiempos_entrega_revision
  on public.tiempos_entrega_avisos (fecha) where tipo = 'REVISION';
-- La llave hacia la etapa, con índice pleno (check 190); la revisión busca por etapa.
create index if not exists ix_tiempos_entrega_avisos_etapa
  on public.tiempos_entrega_avisos (etapa_id);

alter table public.tiempos_entrega_avisos enable row level security;
revoke all on public.tiempos_entrega_avisos from public, anon, authenticated;
grant select on public.tiempos_entrega_avisos to authenticated;
-- Lo lee quien lleva o consulta los tiempos. Nadie escribe: solo la revisión.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tiempos_entrega_avisos'
                    and policyname = 'ver_tiempos_entrega_avisos') then
    create policy ver_tiempos_entrega_avisos on public.tiempos_entrega_avisos for select to authenticated
      using ((select public.es_admin() or public.tiene_permiso('rrhh.tiempos_entrega')));
  end if;
end $$;

do $$ begin
  perform public.activar_timestamps('tiempos_entrega_avisos');
  perform public.activar_registro_de_prueba('tiempos_entrega_avisos');
end $$;

-- 2. A quién le llega ---------------------------------------------------------------
-- Recursos Humanos (quien asigna) y el supervisor del área de la etapa (y quien
-- supervisa todas las áreas, como el jefe de producción), con la ruta que cada
-- uno puede abrir. Gerencia (quien consulta los tiempos sin asignar), solo si se
-- pide. Sin el administrador: no lleva los tiempos. El código va escapado en la
-- ruta: «OT 2921-2026» lleva espacio y la campana no abre una ruta con espacios.
create or replace function public.avisar_tiempos_de_entrega(
  p_area uuid, p_codigo text, p_titulo text, p_cuerpo text, p_tabla text, p_id uuid, p_gerencia boolean)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  v_codigo text := replace(replace(replace(replace(replace(replace(p_codigo, '%', '%25'), '&', '%26'), '#', '%23'), '+', '%2B'), '/', '%2F'), ' ', '+');
  v_filas integer;
begin
  insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
  select distinct on (u.id) u.id, p_titulo, p_cuerpo,
         case when x.rrhh then '/rrhh/tiempos-de-entrega/codigo?codigo=' || v_codigo else '/planos?q=' || v_codigo end,
         p_tabla, p_id
    from public.usuarios u
    cross join lateral (
      select exists (select 1 from public.roles_permisos rp where rp.rol_id = u.rol_id
                        and rp.permiso_codigo in ('rrhh.tiempos_entrega_asignar', 'rrhh.tiempos_entrega')) as rrhh,
             exists (select 1 from public.roles_permisos rp where rp.rol_id = u.rol_id
                        and rp.permiso_codigo = 'rrhh.tiempos_entrega_asignar') as asigna,
             exists (select 1 from public.roles_permisos rp where rp.rol_id = u.rol_id
                        and rp.permiso_codigo = 'codigos_internos.area') as supervisa,
             exists (select 1 from public.roles_permisos rp where rp.rol_id = u.rol_id
                        and rp.permiso_codigo = 'produccion.cualquier_area') as todas
    ) x
   where u.activo
     and (x.asigna
          or (p_gerencia and x.rrhh)
          or (x.supervisa and (x.todas or (p_area is not null and u.area_id = p_area))))
   order by u.id;
  get diagnostics v_filas = row_count;
  return v_filas;
end;
$$;
comment on function public.avisar_tiempos_de_entrega(uuid, text, text, text, text, uuid, boolean) is
  'Deja el aviso de una etapa a Recursos Humanos y al supervisor de su área (y a Gerencia si se pide), cada uno con la pantalla que puede abrir. La llama solo la revisión diaria.';
revoke all on function public.avisar_tiempos_de_entrega(uuid, text, text, text, text, uuid, boolean) from public, anon, authenticated;

-- 3. La revisión diaria -------------------------------------------------------------
-- `p_hoy` es el día de la revisión (por omisión, hoy): decide si es laborable,
-- si toca el resumen de la semana y cuándo toca el recordatorio. Los checks lo
-- usan para probar el lunes y el recordatorio sin esperar; el color lo sigue
-- dando la fecha real.
--
-- Se avisa por etapa de arriba, con lo peor de ella y de sus subetapas (como
-- cuenta el tablero): una etapa con tres subetapas vencidas es un aviso, no
-- cuatro. El recordatorio va junto, uno por cuenta («Siguen vencidas: 5 etapas
-- en 3 códigos»), para no tapar en la campana los demás avisos.
create or replace function public.revisar_tiempos_de_entrega(p_hoy date default current_date)
returns table (tipo text, avisos integer, cuentas integer)
language plpgsql security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_hoy date := coalesce(p_hoy, current_date);
  e record;
  v_quien text;
  v_cuando text;
  v_ultimo date;
  v_n integer;
  v_recordar uuid[] := '{}';
  v_recordar_cubre uuid[] := '{}';
  v_por_vencer integer := 0; v_c_por_vencer integer := 0;
  v_vencidas integer := 0;   v_c_vencidas integer := 0;
  v_record integer := 0;     v_c_record integer := 0;
  v_resumen integer := 0;    v_c_resumen integer := 0;
  r_vencidos integer; r_por_vencer integer; r_sin_persona integer;
begin
  -- Dos corridas a la vez (la de pg_cron y una a mano) no se duplican: la
  -- segunda espera a la primera y ya encuentra todo anotado.
  perform pg_advisory_xact_lock(hashtext('revisar_tiempos_de_entrega'));

  -- Cada corrida queda anotada, avise o no: el tablero dice cuándo fue la última.
  insert into public.tiempos_entrega_avisos (etapa_id, tipo, fin_plan, fecha, avisados)
  values (null, 'REVISION', null, v_hoy, 0)
  on conflict (fecha) where tipo = 'REVISION' do update set actualizado_en = now();

  -- Solo en día laborable: el domingo y el feriado no hay a quién llamar.
  if not public.es_laborable(v_hoy) then
    return;
  end if;

  for e in
    with por_entregar as materialized (
      select c.codigo from public.tiempos_de_entrega_codigos_calculado(null) c
    ), pendientes as (
      select t.*, coalesce(t.padre_id, t.id) as raiz
        from public.tiempos_de_entrega_etapas_calculado(null) t
        join por_entregar pe on pe.codigo = t.codigo
       where t.fin_real is null and t.semaforo in ('AMBAR', 'ROJO')
         -- La etapa de un lote de prueba no avisa: su aviso colgaría de ella y
         -- `pruebas_limpiar` ya no podría llevársela.
         and not exists (select 1 from public.pruebas_filas f where f.tabla = 'codigo_etapas' and f.fila_id = t.id)
    ), peor as (
      -- Por etapa de arriba, la que vence antes entre ella y sus subetapas.
      -- Y cuáles cubre el aviso: todas las del mismo color que la peor. Lo ya
      -- avisado se anota por cada una con su fecha, no por la de arriba: si la
      -- peor se termina, la que queda ya estaba avisada y no vuelve a salir.
      select distinct on (p.raiz) p.*,
             count(*) over (partition by p.raiz) as cuantas,
             (select array_agg(q.id order by q.id) from pendientes q
               where q.raiz = p.raiz and q.semaforo = p.semaforo) as cubre,
             (select array_agg(q.fin_plan order by q.id) from pendientes q
               where q.raiz = p.raiz and q.semaforo = p.semaforo) as cubre_fin
        from pendientes p
       order by p.raiz, p.fin_plan, p.orden
    )
    select w.raiz as id, w.codigo, r.nombre as etapa, r.orden,
           case when w.id <> w.raiz then w.nombre end as subetapa,
           w.cuantas, w.area_id, w.area, w.fin_plan, w.semaforo, w.dias_habiles, w.cubre, w.cubre_fin,
           coalesce(
             (select tr.apellidos || ', ' || tr.nombres from public.etapa_responsables er
                join public.trabajadores tr on tr.id = er.trabajador_id and tr.activo
               where er.etapa_id = w.id and er.quitado_en is null),
             (select tr.apellidos || ', ' || tr.nombres from public.etapa_responsables er
                join public.trabajadores tr on tr.id = er.trabajador_id and tr.activo
               where er.etapa_id = w.raiz and er.quitado_en is null)) as lleva
      from peor w
      join public.codigo_etapas r on r.id = w.raiz
     order by w.codigo, r.orden
  loop
    v_quien := coalesce('La lleva ' || e.lleva || '.', 'Nadie la tiene a cargo todavía.')
      || case when e.subetapa is not null
              then ' Por la subetapa «' || e.subetapa || '»'
                   || case when e.cuantas > 1 then ' y ' || (e.cuantas - 1) || ' más' else '' end || '.'
              else '' end;

    if e.semaforo = 'AMBAR' then
      -- Ya avisada si cada una de las que cubre ya se avisó con su fecha.
      continue when not exists (select 1 from unnest(e.cubre, e.cubre_fin) c(id, fin)
                                 where not exists (select 1 from public.tiempos_entrega_avisos a
                                                    where a.etapa_id = c.id and a.tipo = 'POR_VENCER' and a.fin_plan = c.fin));
      v_cuando := case when e.fin_plan = v_hoy then 'Vence hoy'
                       when e.fin_plan = v_hoy + 1 then 'Vence mañana'
                       else 'Vence el ' || to_char(e.fin_plan, 'DD/MM/YYYY') || ', en ' || e.dias_habiles
                            || case when e.dias_habiles = 1 then ' día hábil' else ' días hábiles' end end;
      v_n := public.avisar_tiempos_de_entrega(e.area_id, e.codigo,
               'Por vencer: ' || e.codigo || ' · ' || e.etapa,
               v_cuando || coalesce(' (' || e.area || ')', '') || '. ' || v_quien,
               'codigo_etapas', e.id, false);
      insert into public.tiempos_entrega_avisos (etapa_id, tipo, fin_plan, fecha, avisados)
      select c.id, 'POR_VENCER', c.fin, v_hoy, v_n from unnest(e.cubre, e.cubre_fin) c(id, fin)
      on conflict do nothing;
      v_por_vencer := v_por_vencer + 1; v_c_por_vencer := v_c_por_vencer + v_n;

    elsif exists (select 1 from unnest(e.cubre, e.cubre_fin) c(id, fin)
                   where not exists (select 1 from public.tiempos_entrega_avisos a
                                      where a.etapa_id = c.id and a.tipo = 'VENCIDA' and a.fin_plan = c.fin)) then
      -- Recién vencida (ella o una subetapa que no se había avisado): también a Gerencia.
      v_n := public.avisar_tiempos_de_entrega(e.area_id, e.codigo,
               'Vencida: ' || e.codigo || ' · ' || e.etapa,
               'Venció el ' || to_char(e.fin_plan, 'DD/MM/YYYY') || coalesce(' (' || e.area || ')', '') || '. ' || v_quien,
               'codigo_etapas', e.id, true);
      insert into public.tiempos_entrega_avisos (etapa_id, tipo, fin_plan, fecha, avisados)
      select c.id, 'VENCIDA', c.fin, v_hoy, v_n from unnest(e.cubre, e.cubre_fin) c(id, fin)
      on conflict do nothing;
      v_vencidas := v_vencidas + 1; v_c_vencidas := v_c_vencidas + v_n;

    else
      -- Sigue vencida: toca recordarla cada 2 días hábiles desde el último aviso.
      select max(a.fecha) into v_ultimo
        from public.tiempos_entrega_avisos a
        join unnest(e.cubre, e.cubre_fin) c(id, fin) on c.id = a.etapa_id and c.fin = a.fin_plan
       where a.tipo in ('VENCIDA', 'RECORDATORIO');
      continue when public.sumar_dias_habiles(v_ultimo, 2) > v_hoy;
      insert into public.tiempos_entrega_avisos (etapa_id, tipo, fin_plan, fecha, avisados)
      select c.id, 'RECORDATORIO', c.fin, v_hoy, 0 from unnest(e.cubre, e.cubre_fin) c(id, fin)
      on conflict do nothing;
      v_recordar := v_recordar || e.id;
      v_recordar_cubre := v_recordar_cubre || e.cubre;
    end if;
  end loop;

  -- Los recordatorios, uno por cuenta: a Recursos Humanos todos, con el
  -- tablero en «Vencidos»; al supervisor, los de su área, con «Planos».
  if cardinality(v_recordar) > 0 then
    with recordadas as (
      select r.id, r.codigo_interno as codigo, coalesce(
               (select s.area_id from public.codigo_etapas s
                 where (s.id = r.id or s.padre_id = r.id) and s.quitada_en is null and s.fin_real is null
                 order by s.fin_plan nulls last limit 1), r.area_id) as area_id
        from public.codigo_etapas r where r.id = any (v_recordar)
    ), destino as (
      select u.id as usuario_id, x.asigna, d.id as etapa_id, d.codigo
        from public.usuarios u
        cross join lateral (
          select exists (select 1 from public.roles_permisos rp where rp.rol_id = u.rol_id
                            and rp.permiso_codigo = 'rrhh.tiempos_entrega_asignar') as asigna,
                 exists (select 1 from public.roles_permisos rp where rp.rol_id = u.rol_id
                            and rp.permiso_codigo = 'codigos_internos.area') as supervisa,
                 exists (select 1 from public.roles_permisos rp where rp.rol_id = u.rol_id
                            and rp.permiso_codigo = 'produccion.cualquier_area') as todas
        ) x
        join recordadas d on x.asigna or (x.supervisa and (x.todas or u.area_id = d.area_id))
       where u.activo
    )
    insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
    select d.usuario_id,
           case when count(*) = 1 then 'Sigue vencida: ' || min(d.codigo)
                else 'Siguen vencidas: ' || count(*) || ' etapas' end,
           count(*) || case when count(*) = 1 then ' etapa sigue vencida' else ' etapas siguen vencidas' end
             || case when count(distinct d.codigo) = 1 then ', en ' || min(d.codigo)
                     else ' en ' || count(distinct d.codigo) || ' códigos: ' || string_agg(distinct d.codigo, ', ') end
             || '. Se recuerda cada 2 días hábiles hasta que se marque o Diseño cambie la fecha.',
           case when bool_or(d.asigna) then '/rrhh/tiempos-de-entrega?ver=vencidos' else '/planos' end,
           'tiempos_entrega_avisos', null
      from destino d
     group by d.usuario_id;
    get diagnostics v_c_record = row_count;
    v_record := cardinality(v_recordar);
    update public.tiempos_entrega_avisos a set avisados = v_c_record
     where a.tipo = 'RECORDATORIO' and a.fecha = v_hoy and a.etapa_id = any (v_recordar_cubre);
  end if;

  -- El resumen de la semana, a Gerencia (quien consulta los tiempos sin
  -- asignar): el primer día laborable de la semana, el lunes si no es feriado.
  if not exists (select 1 from generate_series((v_hoy - (extract(isodow from v_hoy)::int - 1))::timestamp, v_hoy - 1, interval '1 day') d
                  where public.es_laborable(d::date))
     and not exists (select 1 from public.tiempos_entrega_avisos a
                      where a.tipo = 'RESUMEN_SEMANAL' and a.fecha = v_hoy) then
    select count(*) filter (where c.semaforo = 'ROJO'), count(*) filter (where c.semaforo = 'AMBAR')
      into r_vencidos, r_por_vencer
      from public.tiempos_de_entrega_codigos_calculado(null) c;
    select count(*) into r_sin_persona
      from public.tiempos_de_entrega_etapas_calculado(null) t
      join public.tiempos_de_entrega_codigos_calculado(null) c on c.codigo = t.codigo
     where t.fin_real is null and t.padre_id is null
       and not exists (select 1 from public.pruebas_filas f where f.tabla = 'codigo_etapas' and f.fila_id = t.id)
       and not exists (select 1 from public.etapa_responsables r
                         join public.trabajadores tr on tr.id = r.trabajador_id and tr.activo
                        where r.etapa_id = t.id and r.quitado_en is null);

    insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
    select u.id, 'Resumen de la semana: tiempos de entrega',
           case when r_vencidos + r_por_vencer = 0 then 'Ningún código vencido ni por vencer.'
                else r_vencidos || case when r_vencidos = 1 then ' código vencido' else ' códigos vencidos' end
                     || ' y ' || r_por_vencer || ' por vencer.' end
           || case when r_sin_persona > 0
                   then ' ' || r_sin_persona || case when r_sin_persona = 1 then ' etapa sigue' else ' etapas siguen' end || ' sin nadie a cargo.'
                   else '' end,
           '/rrhh/tiempos-de-entrega', 'tiempos_entrega_avisos', null
      from public.usuarios u
     where u.activo
       and exists (select 1 from public.roles_permisos rp where rp.rol_id = u.rol_id and rp.permiso_codigo = 'rrhh.tiempos_entrega')
       and not exists (select 1 from public.roles_permisos rp where rp.rol_id = u.rol_id and rp.permiso_codigo = 'rrhh.tiempos_entrega_asignar');
    get diagnostics v_n = row_count;
    insert into public.tiempos_entrega_avisos (etapa_id, tipo, fin_plan, fecha, avisados)
    values (null, 'RESUMEN_SEMANAL', null, v_hoy, v_n);
    v_resumen := 1; v_c_resumen := v_n;
  end if;

  update public.tiempos_entrega_avisos a
     set avisados = v_c_por_vencer + v_c_vencidas + v_c_record + v_c_resumen
   where a.tipo = 'REVISION' and a.fecha = v_hoy;

  return query values
    ('POR_VENCER', v_por_vencer, v_c_por_vencer),
    ('VENCIDA', v_vencidas, v_c_vencidas),
    ('RECORDATORIO', v_record, v_c_record),
    ('RESUMEN_SEMANAL', v_resumen, v_c_resumen);
end;
$$;
comment on function public.revisar_tiempos_de_entrega(date) is
  'La revisión diaria de los tiempos de entrega (7:00 a. m. de Lima, día laborable): por cada etapa de arriba, con lo peor de ella y de sus subetapas, avisa cuando pasa a ámbar y cuando vence (también a Gerencia); recuerda cada 2 días hábiles las que siguen vencidas, en un solo aviso por cuenta; y el primer día laborable de la semana manda el resumen a Gerencia. No repite: anota cada aviso, y cada corrida, en tiempos_entrega_avisos. La corre pg_cron; cerrada a la gente.';
revoke all on function public.revisar_tiempos_de_entrega(date) from public, anon, authenticated;

-- 4. La hora ------------------------------------------------------------------------
-- pg_cron corre en UTC: las 12:00 UTC son las 7:00 en Lima (sin horario de
-- verano). Todos los días: la función decide con el calendario de la empresa
-- (`es_laborable`) si ese día avisa. Volver a programar con el mismo nombre
-- reemplaza el horario, así que esto se puede correr de nuevo. Donde no hay
-- pg_cron (la base local de pruebas) solo se avisa.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('revisar-tiempos-de-entrega', '0 12 * * *', 'select public.revisar_tiempos_de_entrega()');
  else
    raise notice 'Sin pg_cron en esta base: la revisión diaria no queda programada.';
  end if;
end $$;
