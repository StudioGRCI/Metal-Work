-- =============================================================================
-- SUPERVISIÓN, ALMACÉN Y REQUERIMIENTOS TRABAJAN POR CÓDIGO INTERNO
-- -----------------------------------------------------------------------------
-- Gerencia decidió (2026-10-15) que el código interno es el centro del trabajo
-- desde que se aprueba la cotización, y que la OT es un documento de Diseño.
-- Almacén, Requerimientos y Supervisión la conservaban hasta tener su
-- reemplazo en el código; Gerencia pidió hacerlo el mismo día. Lo que cada una
-- hacía en la OT, desde aquí:
--
--   * Supervisión de área ya sube su reporte diario por código y ve los planos
--     y las etapas de su área (migración 20261015200000). Las tareas con foto
--     de la OT las reemplaza ese reporte: aquí no cambia nada suyo.
--   * Supervisión general y Almacén ven, sin cambiar nada, lo que Diseño lleva
--     en cada código: los planos, la lista de materiales con lo pedido, lo
--     comprado y lo salido, y las etapas con su avance
--     (`codigos_internos.seguimiento`). Almacén lo usa para tener a tiempo el
--     material de cada unidad; lo demás de su trabajo ya va por requerimiento
--     y por kardex.
--   * Requerimientos llenaba en la OT la ficha única de ingreso y salida del
--     vehículo (SIG-FCLIV-001) y desde ahí le pedía a Tesorería la revisión
--     para la salida. Las dos pasan al registro de vehículos, que ya lleva el
--     código interno y las fotos (`registro_vehiculo_fichas` y
--     `registro_vehiculo_revisiones`). Se escriben solo por funciones.
--
-- Las tablas de la OT (ot_control_vehicular, ot_solicitudes_tesoreria) quedan
-- como estaban: en producción no tienen filas. Sin DROP ni DELETE: el conector
-- de producción no deja pasar ninguno.
-- =============================================================================

-- 1. El permiso de seguimiento --------------------------------------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('codigos_internos.seguimiento', 'Producción',
   'Ver por código interno, sin cambiar nada, los planos, la lista de materiales con lo pedido y lo salido, y las etapas con su avance')
on conflict (codigo) do nothing;

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, 'codigos_internos.seguimiento'
  from public.roles r
 where r.codigo in ('SUPERVISOR_GENERAL', 'ALMACENERO')
on conflict do nothing;

-- Quién lee lo que Diseño carga por código: Diseño, Gerencia, los supervisores
-- y, desde aquí, Supervisión general y Almacén. Escribir sigue siendo de Diseño
-- (y de cada supervisor en su área): las funciones que escriben piden su propio
-- permiso.
create or replace function public.puede_ver_codigos_de_diseno()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.es_admin() or public.tiene_permiso('diseno.codigos') or public.tiene_permiso('codigos_internos.ver')
      or public.tiene_permiso('codigos_internos.area') or public.tiene_permiso('codigos_internos.seguimiento');
$$;
revoke all on function public.puede_ver_codigos_de_diseno() from public, anon;
grant execute on function public.puede_ver_codigos_de_diseno() to authenticated;

-- Los planos de todas las áreas, como Gerencia: el supervisor sigue viendo solo los de la suya.
alter policy ver_codigo_planos on public.codigo_planos
  using ((select public.es_admin()) or (select public.tiene_permiso('diseno.codigos'))
         or (select public.tiene_permiso('codigos_internos.ver'))
         or (select public.tiene_permiso('codigos_internos.seguimiento'))
         or ((select public.tiene_permiso('codigos_internos.area')) and public.puede_hoja_de_area(area_id)));

-- Copia de 20261015200000 con un cambio: con el seguimiento se ven los planos de todas las áreas.
create or replace function public.codigo_interno_planos(p_codigo text default null)
returns table (id uuid, codigo text, numero text, nombre text, area_id uuid, area text, area_codigo text,
               observacion text, creado_en timestamptz, anulado_en timestamptz, motivo_anulacion text,
               revisiones integer, revision_id uuid, revision smallint, nombre_archivo text, tamano_bytes integer,
               cambios text, subido_en timestamptz, recibido_en timestamptz, recibido_por_area text)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_codigo text := public.normalizar_codigo_interno(p_codigo);
  v_todo   boolean := public.usuario_actual() is null or public.es_admin() or public.tiene_permiso('diseno.codigos')
                      or public.tiene_permiso('codigos_internos.ver') or public.tiene_permiso('codigos_internos.seguimiento');
begin
  perform public.exigir_ver_codigos_de_diseno();
  return query
  select p.id, p.codigo_interno, p.numero, p.nombre, p.area_id, a.nombre::text, a.codigo::text, p.observacion, p.creado_en,
         p.anulado_en, p.motivo_anulacion,
         (select count(*)::integer from public.codigo_plano_revisiones x where x.plano_id = p.id),
         r.id, r.revision, r.nombre_archivo, r.tamano_bytes, r.cambios, r.subido_en, r.recibido_en,
         (select ar.nombre::text from public.usuarios u join public.areas ar on ar.id = u.area_id where u.id = r.recibido_por)
    from public.codigo_planos p
    join public.areas a on a.id = p.area_id
    left join lateral (
      select x.* from public.codigo_plano_revisiones x where x.plano_id = p.id order by x.revision desc limit 1) r on true
   where (v_codigo is null or p.codigo_interno = v_codigo)
     and (v_todo or public.puede_hoja_de_area(p.area_id))
   order by p.codigo_interno, p.anulado_en nulls first, a.nombre, p.numero;
end;
$$;
revoke all on function public.codigo_interno_planos(text) from public, anon;
grant execute on function public.codigo_interno_planos(text) to authenticated;

-- Copia de 20261015200000 con un cambio: la lista de códigos la leen también Supervisión general y Almacén.
create or replace function public.codigos_internos_de_diseno()
returns table (codigo text, unidad text, planos integer, planos_por_recibir integer, materiales integer,
               etapas integer, etapas_terminadas integer, etapas_vencidas integer, etapa_actual text,
               etapa_actual_area text, etapa_actual_fin date, ultimo_cambio timestamptz)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_hoy date := (now() at time zone 'America/Lima')::date;
begin
  if public.usuario_actual() is not null
     and not (public.es_admin() or public.tiene_permiso('diseno.codigos') or public.tiene_permiso('codigos_internos.ver')
              or public.tiene_permiso('codigos_internos.seguimiento')) then
    raise exception 'No tienes permiso para ver los códigos internos de Diseño.' using errcode = 'insufficient_privilege';
  end if;
  return query
  with conocido as (
    select public.normalizar_codigo_interno(u.codigo_interno) as codigo from public.unidades u where u.activo and u.codigo_interno is not null
    union select public.normalizar_codigo_interno(r.codigo_interno) from public.requerimientos r where r.estado <> 'ANULADO'
    union select public.normalizar_codigo_interno(c.codigo_interno) from public.ordenes_compra_materiales c
           where c.codigo_interno is not null and c.aprobacion <> 'RECHAZADA'
    union select public.normalizar_codigo_interno(s.codigo_interno) from public.ordenes_servicio s
           where s.codigo_interno is not null and s.estado <> 'ANULADA'
    union select public.normalizar_codigo_interno(d.codigo_interno) from public.reportes_diarios d where d.anulado_en is null
    union select public.normalizar_codigo_interno(v.codigo_interno) from public.registro_vehiculos v
           where v.codigo_interno is not null and v.anulado_en is null
    union select p.codigo_interno from public.codigo_planos p
    union select m.codigo_interno from public.codigo_materiales m where m.quitado_en is null
    union select e.codigo_interno from public.codigo_etapas e where e.quitada_en is null
  ), unidad as (
    select public.normalizar_codigo_interno(u.codigo_interno) as codigo,
           string_agg(distinct nullif(concat_ws(' · ', nullif(btrim(u.placa), ''), nullif(btrim(concat_ws(' ', u.marca, u.modelo)), '')), ''), ', ') as texto
      from public.unidades u where u.codigo_interno is not null group by 1
  ), plano as (
    select p.codigo_interno as codigo, count(*)::integer as planos,
           count(*) filter (where r.recibido_en is null)::integer as por_recibir,
           max(greatest(p.actualizado_en, r.subido_en, r.recibido_en)) as cambio
      from public.codigo_planos p
      left join lateral (select x.* from public.codigo_plano_revisiones x where x.plano_id = p.id order by x.revision desc limit 1) r on true
     where p.anulado_en is null
     group by p.codigo_interno
  ), material as (
    select m.codigo_interno as codigo, count(*)::integer as materiales, max(m.actualizado_en) as cambio
      from public.codigo_materiales m where m.quitado_en is null group by m.codigo_interno
  ), etapa as (
    select e.codigo_interno as codigo, count(*)::integer as etapas,
           count(*) filter (where e.fin_real is not null)::integer as terminadas,
           count(*) filter (where e.fin_real is null and e.fin_plan < v_hoy)::integer as vencidas,
           max(e.actualizado_en) as cambio
      from public.codigo_etapas e where e.quitada_en is null group by e.codigo_interno
  ), actual as (
    select distinct on (e.codigo_interno) e.codigo_interno as codigo, e.nombre, a.nombre as area, e.fin_plan
      from public.codigo_etapas e
      left join public.areas a on a.id = e.area_id
     where e.quitada_en is null and e.fin_real is null
     order by e.codigo_interno, e.orden
  )
  select c.codigo, u.texto, coalesce(p.planos, 0), coalesce(p.por_recibir, 0), coalesce(m.materiales, 0),
         coalesce(e.etapas, 0), coalesce(e.terminadas, 0), coalesce(e.vencidas, 0), ac.nombre::text, ac.area::text, ac.fin_plan,
         nullif(greatest(coalesce(p.cambio, '-infinity'), coalesce(m.cambio, '-infinity'), coalesce(e.cambio, '-infinity')), '-infinity')
    from conocido c
    left join unidad u on u.codigo = c.codigo
    left join plano p on p.codigo = c.codigo
    left join material m on m.codigo = c.codigo
    left join etapa e on e.codigo = c.codigo
    left join actual ac on ac.codigo = c.codigo
   where c.codigo is not null and c.codigo <> 'PLANTA'
   order by 12 desc nulls last, 1;
end;
$$;
comment on function public.codigos_internos_de_diseno() is
  'Los códigos de unidad que conoce el sistema con los planos, materiales y etapas que Diseño lleva en cada uno. Para Diseño (diseno.codigos), Gerencia (codigos_internos.ver), Supervisión general y Almacén (codigos_internos.seguimiento).';
revoke all on function public.codigos_internos_de_diseno() from public, anon;
grant execute on function public.codigos_internos_de_diseno() to authenticated;

-- 2. La ficha única de ingreso y salida, por vehículo ----------------------------------
-- La misma ficha que se llenaba en la OT (20260929225000), ahora colgada del
-- ingreso del vehículo a la planta: una por cada vez que entra. La placa y el
-- código interno son los del registro.
create table if not exists public.registro_vehiculo_fichas (
  id                   uuid primary key default gen_random_uuid(),
  registro_id          uuid not null,
  marca                text not null default '',
  conductor_ingreso    text not null default '',
  dni_ingreso          text not null default '',
  fecha_ingreso        date,
  combustible_ingreso  text not null default '',
  conductor_salida     text not null default '',
  dni_salida           text not null default '',
  fecha_salida         date,
  combustible_salida   text not null default '',
  adicionales          text not null default '',
  trabajos             text not null default '',
  observacion_ingreso  text not null default '',
  observacion_salida   text not null default '',
  -- {"FARO_DEL_D": {"ingreso": "CONFORME", "salida": "OBSERVADO"}, …}, con los puntos de control_vehicular_items.
  items                jsonb not null default '{}'::jsonb,
  ingreso_cerrado_en   timestamptz,
  salida_cerrada_en    timestamptz,
  -- El escaneo firmado: {registro}/{archivo}.pdf en el bucket fichas-vehiculos.
  escaneo_ruta         text,
  escaneo_nombre       text,
  registrado_por       uuid not null default public.usuario_actual(),
  actualizado_por      uuid,
  creado_en            timestamptz not null default now(),
  actualizado_en       timestamptz not null default now(),
  -- También es el índice de la llave hacia el registro.
  constraint uq_registro_vehiculo_ficha unique (registro_id),
  constraint uq_registro_vehiculo_ficha_escaneo unique (escaneo_ruta),
  constraint registro_vehiculo_fichas_registro_id_fkey foreign key (registro_id) references public.registro_vehiculos(id) on delete restrict,
  constraint registro_vehiculo_fichas_registrado_por_fkey foreign key (registrado_por) references public.usuarios(id) on delete restrict,
  constraint registro_vehiculo_fichas_actualizado_por_fkey foreign key (actualizado_por) references public.usuarios(id) on delete restrict,
  constraint ck_registro_vehiculo_ficha check (
    char_length(marca) <= 80
    and char_length(conductor_ingreso) <= 120 and char_length(dni_ingreso) <= 20 and char_length(combustible_ingreso) <= 40
    and char_length(conductor_salida) <= 120 and char_length(dni_salida) <= 20 and char_length(combustible_salida) <= 40
    and char_length(adicionales) <= 2000 and char_length(trabajos) <= 2000
    and char_length(observacion_ingreso) <= 2000 and char_length(observacion_salida) <= 2000
    and jsonb_typeof(items) = 'object'
    and (fecha_ingreso is null or fecha_salida is null or fecha_salida >= fecha_ingreso)
    and (salida_cerrada_en is null or ingreso_cerrado_en is not null)
    and (escaneo_ruta is null or (salida_cerrada_en is not null
         and escaneo_ruta ~ ('^' || registro_id::text || '/[0-9a-f-]{36}\.pdf$')))
    and (escaneo_nombre is null or char_length(escaneo_nombre) <= 200))
);
comment on table public.registro_vehiculo_fichas is
  'La ficha única de ingreso y salida (SIG-FCLIV-001) de cada ingreso de un vehículo: conductor, combustible y los puntos de inspección al entrar y al salir, y el escaneo firmado. La llena Requerimientos (vehiculos.registrar) con guardar_ficha_vehiculo; no se borra.';

select public.activar_timestamps('registro_vehiculo_fichas');
select public.activar_auditoria('registro_vehiculo_fichas');
select public.activar_registro_de_prueba('registro_vehiculo_fichas');

-- Las reglas de la ficha de la OT, iguales: el ingreso cerrado queda fijo, la
-- salida cerrada solo admite el escaneo, y para cerrar cada parte tienen que
-- estar el conductor, la fecha y todos los puntos.
create or replace function public.fn_registro_vehiculo_ficha_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
declare
  v_codigo  text;
  v_entrada text;
  v_salida  text;
begin
  if tg_op = 'DELETE' then
    raise exception 'La ficha del vehículo no se borra: queda como evidencia.' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' then
    if old.salida_cerrada_en is not null
       and (to_jsonb(new) - array['escaneo_ruta', 'escaneo_nombre', 'actualizado_en', 'actualizado_por'])
           is distinct from (to_jsonb(old) - array['escaneo_ruta', 'escaneo_nombre', 'actualizado_en', 'actualizado_por']) then
      raise exception 'La ficha con la salida cerrada solo admite adjuntar el escaneo firmado.' using errcode = 'check_violation';
    end if;
    if old.escaneo_ruta is not null and new.escaneo_ruta is distinct from old.escaneo_ruta then
      raise exception 'El escaneo firmado ya está adjunto y no se reemplaza.' using errcode = 'check_violation';
    end if;
    if old.ingreso_cerrado_en is not null then
      if row(new.marca, new.conductor_ingreso, new.dni_ingreso, new.fecha_ingreso, new.combustible_ingreso, new.observacion_ingreso,
             new.ingreso_cerrado_en)
         is distinct from row(old.marca, old.conductor_ingreso, old.dni_ingreso, old.fecha_ingreso, old.combustible_ingreso,
             old.observacion_ingreso, old.ingreso_cerrado_en) then
        raise exception 'El ingreso cerrado queda fijo: si hay un error, anótalo en la observación de salida.' using errcode = 'check_violation';
      end if;
      for v_codigo in select codigo from public.control_vehicular_items loop
        if new.items -> v_codigo ->> 'ingreso' is distinct from old.items -> v_codigo ->> 'ingreso' then
          raise exception 'Los puntos del ingreso cerrado ya no se cambian.' using errcode = 'check_violation';
        end if;
      end loop;
    end if;
    if row(new.registro_id, new.registrado_por, new.creado_en) is distinct from row(old.registro_id, old.registrado_por, old.creado_en) then
      raise exception 'La ficha no cambia de vehículo ni de autor.' using errcode = 'check_violation';
    end if;
  end if;

  for v_codigo in select key from jsonb_each(new.items) loop
    if not exists (select 1 from public.control_vehicular_items where codigo = v_codigo) then
      raise exception 'La ficha trae un punto que no es del formato de Metal Work.' using errcode = 'check_violation';
    end if;
    v_entrada := new.items -> v_codigo ->> 'ingreso';
    v_salida := new.items -> v_codigo ->> 'salida';
    if (v_entrada is not null and v_entrada not in ('CONFORME', 'NO_TIENE', 'OBSERVADO'))
       or (v_salida is not null and v_salida not in ('CONFORME', 'NO_TIENE', 'OBSERVADO')) then
      raise exception 'Un punto de la ficha tiene un estado que no se reconoce.' using errcode = 'check_violation';
    end if;
  end loop;

  if new.ingreso_cerrado_en is not null and (tg_op = 'INSERT' or old.ingreso_cerrado_en is null) then
    if btrim(new.conductor_ingreso) = '' or new.fecha_ingreso is null
       or exists (select 1 from public.control_vehicular_items i where new.items -> i.codigo ->> 'ingreso' is null) then
      raise exception 'Para cerrar el ingreso faltan el conductor, la fecha o algún punto de inspección.' using errcode = 'check_violation';
    end if;
  end if;
  if new.salida_cerrada_en is not null and (tg_op = 'INSERT' or old.salida_cerrada_en is null) then
    if new.ingreso_cerrado_en is null or btrim(new.conductor_salida) = '' or new.fecha_salida is null
       or exists (select 1 from public.control_vehicular_items i where new.items -> i.codigo ->> 'salida' is null) then
      raise exception 'Para cerrar la salida tienen que estar el ingreso cerrado, el conductor, la fecha y todos los puntos de salida.'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.fn_registro_vehiculo_ficha_guardia() from public, anon, authenticated;
create or replace trigger trg_registro_vehiculo_ficha_guardia
  before insert or update or delete on public.registro_vehiculo_fichas
  for each row execute function public.fn_registro_vehiculo_ficha_guardia();

-- La ve quien ve el registro de vehículos y Tesorería, que revisa la salida.
alter table public.registro_vehiculo_fichas enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'registro_vehiculo_fichas'
                   and policyname = 'ver_registro_vehiculo_fichas') then
    create policy ver_registro_vehiculo_fichas on public.registro_vehiculo_fichas for select to authenticated
      using ((select public.es_admin()) or (select public.tiene_permiso('vehiculos.ver'))
             or (select public.tiene_permiso('vehiculos.registrar')) or (select public.tiene_permiso('tesoreria.liberar')));
  end if;
end $$;
revoke all on public.registro_vehiculo_fichas from public, anon, authenticated;
grant select on public.registro_vehiculo_fichas to authenticated;

-- Los puntos del formato los lee también quien llena o consulta la ficha del vehículo.
alter policy ver_control_vehicular_items on public.control_vehicular_items
  using (public.tiene_permiso('costos.ver') or public.tiene_permiso('costos.controlar_ot')
         or public.tiene_permiso('vehiculos.registrar') or public.tiene_permiso('vehiculos.ver')
         or public.tiene_permiso('tesoreria.liberar'));

-- Guardar avance, cerrar el ingreso o cerrar la salida. p_datos trae los campos
-- de la pantalla y `items` con lo marcado; lo del ingreso cerrado se conserva
-- aunque venga otra cosa (una pestaña vieja), y un punto de salida sin marcar
-- deja el que ya estaba.
create or replace function public.guardar_ficha_vehiculo(p_registro uuid, p_accion text, p_datos jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_registro public.registro_vehiculos%rowtype;
  v_ficha    public.registro_vehiculo_fichas%rowtype;
  v_nueva    public.registro_vehiculo_fichas%rowtype;
  v_items    jsonb;
  v_marcado  jsonb := coalesce(p_datos -> 'items', '{}'::jsonb);
  v_punto    text;
  v_ingreso  text;
  v_salida   text;
  v_cerrado  boolean;
begin
  perform public.exigir_permiso('vehiculos.registrar');
  if p_accion not in ('GUARDAR', 'CERRAR_INGRESO', 'CERRAR_SALIDA') then
    raise exception 'No se reconoce qué se quiere hacer con la ficha.' using errcode = 'check_violation';
  end if;
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' or jsonb_typeof(v_marcado) <> 'object'
     or exists (select 1 from jsonb_object_keys(p_datos) k
                 where k not in ('marca', 'conductor_ingreso', 'dni_ingreso', 'fecha_ingreso', 'combustible_ingreso',
                                 'conductor_salida', 'dni_salida', 'fecha_salida', 'combustible_salida', 'adicionales',
                                 'trabajos', 'observacion_ingreso', 'observacion_salida', 'items')) then
    raise exception 'La ficha trae datos que no son del formato.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from jsonb_object_keys(v_marcado) k
              where not exists (select 1 from public.control_vehicular_items i where i.codigo = k)) then
    raise exception 'La ficha trae un punto que no es del formato de Metal Work.' using errcode = 'check_violation';
  end if;

  select * into v_registro from public.registro_vehiculos where id = p_registro for update;
  if not found then
    raise exception 'Ese ingreso de vehículo no está. Vuelve a cargar la pantalla.' using errcode = 'check_violation';
  end if;
  if v_registro.anulado_en is not null then
    raise exception 'Ese ingreso está anulado: su ficha ya no se llena.' using errcode = 'check_violation';
  end if;

  select * into v_ficha from public.registro_vehiculo_fichas where registro_id = p_registro for update;
  if found and v_ficha.salida_cerrada_en is not null then
    raise exception 'La ficha ya tiene la salida cerrada: solo falta adjuntar el escaneo firmado.' using errcode = 'check_violation';
  end if;
  v_cerrado := found and v_ficha.ingreso_cerrado_en is not null;

  -- Los puntos: el ingreso, si está cerrado, no se toca; la salida sin marcar deja la anterior.
  v_items := '{}'::jsonb;
  for v_punto in select codigo from public.control_vehicular_items order by orden loop
    v_ingreso := case when v_cerrado then v_ficha.items -> v_punto ->> 'ingreso'
                      else nullif(v_marcado -> v_punto ->> 'ingreso', '') end;
    v_salida := coalesce(nullif(v_marcado -> v_punto ->> 'salida', ''), v_ficha.items -> v_punto ->> 'salida');
    if v_ingreso is not null or v_salida is not null then
      v_items := v_items || jsonb_build_object(v_punto, jsonb_strip_nulls(jsonb_build_object('ingreso', v_ingreso, 'salida', v_salida)));
    end if;
  end loop;

  v_nueva.marca := case when v_cerrado then v_ficha.marca else btrim(coalesce(p_datos ->> 'marca', '')) end;
  v_nueva.conductor_ingreso := case when v_cerrado then v_ficha.conductor_ingreso else btrim(coalesce(p_datos ->> 'conductor_ingreso', '')) end;
  v_nueva.dni_ingreso := case when v_cerrado then v_ficha.dni_ingreso else btrim(coalesce(p_datos ->> 'dni_ingreso', '')) end;
  v_nueva.fecha_ingreso := case when v_cerrado then v_ficha.fecha_ingreso else nullif(p_datos ->> 'fecha_ingreso', '')::date end;
  v_nueva.combustible_ingreso := case when v_cerrado then v_ficha.combustible_ingreso else btrim(coalesce(p_datos ->> 'combustible_ingreso', '')) end;
  v_nueva.observacion_ingreso := case when v_cerrado then v_ficha.observacion_ingreso else btrim(coalesce(p_datos ->> 'observacion_ingreso', '')) end;
  v_nueva.conductor_salida := btrim(coalesce(p_datos ->> 'conductor_salida', ''));
  v_nueva.dni_salida := btrim(coalesce(p_datos ->> 'dni_salida', ''));
  v_nueva.fecha_salida := nullif(p_datos ->> 'fecha_salida', '')::date;
  v_nueva.combustible_salida := btrim(coalesce(p_datos ->> 'combustible_salida', ''));
  v_nueva.adicionales := btrim(coalesce(p_datos ->> 'adicionales', ''));
  v_nueva.trabajos := btrim(coalesce(p_datos ->> 'trabajos', ''));
  v_nueva.observacion_salida := btrim(coalesce(p_datos ->> 'observacion_salida', ''));

  if v_ficha.id is null then
    insert into public.registro_vehiculo_fichas (
      registro_id, marca, conductor_ingreso, dni_ingreso, fecha_ingreso, combustible_ingreso, conductor_salida, dni_salida,
      fecha_salida, combustible_salida, adicionales, trabajos, observacion_ingreso, observacion_salida, items,
      ingreso_cerrado_en, actualizado_por)
    values (
      p_registro, v_nueva.marca, v_nueva.conductor_ingreso, v_nueva.dni_ingreso, v_nueva.fecha_ingreso, v_nueva.combustible_ingreso,
      v_nueva.conductor_salida, v_nueva.dni_salida, v_nueva.fecha_salida, v_nueva.combustible_salida, v_nueva.adicionales,
      v_nueva.trabajos, v_nueva.observacion_ingreso, v_nueva.observacion_salida, v_items,
      case when p_accion = 'CERRAR_INGRESO' then now() end, public.usuario_actual())
    returning * into v_ficha;
  else
    update public.registro_vehiculo_fichas
       set marca = v_nueva.marca, conductor_ingreso = v_nueva.conductor_ingreso, dni_ingreso = v_nueva.dni_ingreso,
           fecha_ingreso = v_nueva.fecha_ingreso, combustible_ingreso = v_nueva.combustible_ingreso,
           conductor_salida = v_nueva.conductor_salida, dni_salida = v_nueva.dni_salida, fecha_salida = v_nueva.fecha_salida,
           combustible_salida = v_nueva.combustible_salida, adicionales = v_nueva.adicionales, trabajos = v_nueva.trabajos,
           observacion_ingreso = v_nueva.observacion_ingreso, observacion_salida = v_nueva.observacion_salida, items = v_items,
           ingreso_cerrado_en = case when p_accion = 'CERRAR_INGRESO' and ingreso_cerrado_en is null then now() else ingreso_cerrado_en end,
           salida_cerrada_en = case when p_accion = 'CERRAR_SALIDA' then now() else salida_cerrada_en end,
           actualizado_por = public.usuario_actual()
     where id = v_ficha.id
    returning * into v_ficha;
  end if;

  if p_accion = 'CERRAR_SALIDA' and v_ficha.salida_cerrada_en is null then
    -- Recién insertada: la salida se cierra en un segundo paso, con el ingreso ya cerrado.
    raise exception 'Cierra primero el ingreso de la ficha.' using errcode = 'check_violation';
  end if;
  return v_ficha.id;
end;
$$;
comment on function public.guardar_ficha_vehiculo(uuid, text, jsonb) is
  'Guarda la ficha única de ingreso y salida de un ingreso de vehículo (GUARDAR), o la guarda y cierra el ingreso (CERRAR_INGRESO) o la salida (CERRAR_SALIDA). Requerimientos (vehiculos.registrar).';
revoke all on function public.guardar_ficha_vehiculo(uuid, text, jsonb) from public, anon;
grant execute on function public.guardar_ficha_vehiculo(uuid, text, jsonb) to authenticated;

-- El escaneo firmado, en su bucket. Un PDF de un formato escaneado pesa poco.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fichas-vehiculos', 'fichas-vehiculos', false, 15728640, array['application/pdf'])
on conflict (id) do nothing;

-- La ruta es {registro}/{archivo}.pdf. Lo sube Requerimientos; lo ve quien lo
-- subió y quien ve la ficha que lo nombra. Uno suelto lo retira su dueño
-- mientras ninguna ficha lo nombre.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'ficha_vehiculo_subir') then
    create policy ficha_vehiculo_subir on storage.objects for insert to authenticated with check (
      bucket_id = 'fichas-vehiculos' and owner_id = (select auth.uid())::text
      and (select public.tiene_permiso('vehiculos.registrar'))
      and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.pdf$');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'ficha_vehiculo_ver') then
    create policy ficha_vehiculo_ver on storage.objects for select to authenticated using (
      bucket_id = 'fichas-vehiculos'
      and (owner_id = (select auth.uid())::text
           or exists (select 1 from public.registro_vehiculo_fichas f where f.escaneo_ruta = objects.name)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'ficha_vehiculo_quitar_suelta') then
    create policy ficha_vehiculo_quitar_suelta on storage.objects for delete to authenticated using (
      bucket_id = 'fichas-vehiculos' and owner_id = (select auth.uid())::text
      and not exists (select 1 from public.registro_vehiculo_fichas f where f.escaneo_ruta = objects.name));
  end if;
end $$;

-- El PDF ya subió a {registro}/{archivo}.pdf: se comprueba que es de quien lo
-- anota, PDF y de hasta 15 MB, y se anota en la ficha con la salida cerrada.
create or replace function public.adjuntar_ficha_vehiculo_firmada(p_registro uuid, p_ruta text, p_nombre text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_ficha  public.registro_vehiculo_fichas%rowtype;
  v_objeto storage.objects%rowtype;
begin
  perform public.exigir_permiso('vehiculos.registrar');
  select * into v_ficha from public.registro_vehiculo_fichas where registro_id = p_registro for update;
  if not found or v_ficha.salida_cerrada_en is null then
    raise exception 'Cierra la salida de la ficha antes de adjuntar el escaneo firmado.' using errcode = 'check_violation';
  end if;
  if v_ficha.escaneo_ruta is not null then
    if v_ficha.escaneo_ruta = p_ruta then
      return v_ficha.id;
    end if;
    raise exception 'La ficha ya tiene su escaneo firmado.' using errcode = 'check_violation';
  end if;
  if p_ruta is null or p_ruta !~ ('^' || p_registro::text || '/[0-9a-f-]{36}\.pdf$') then
    raise exception 'Vuelve a adjuntar el escaneo firmado.' using errcode = 'check_violation';
  end if;
  select * into v_objeto from storage.objects where bucket_id = 'fichas-vehiculos' and name = p_ruta;
  if not found or v_objeto.owner_id is distinct from public.usuario_actual()::text
     or v_objeto.metadata ->> 'mimetype' is distinct from 'application/pdf'
     or coalesce((v_objeto.metadata ->> 'size')::bigint, 0) not between 1 and 15728640 then
    raise exception 'El escaneo no terminó de subir: vuelve a adjuntarlo.' using errcode = 'check_violation';
  end if;
  update public.registro_vehiculo_fichas
     set escaneo_ruta = p_ruta, escaneo_nombre = left(nullif(btrim(coalesce(p_nombre, '')), ''), 200),
         actualizado_por = public.usuario_actual()
   where id = v_ficha.id;
  return v_ficha.id;
end;
$$;
comment on function public.adjuntar_ficha_vehiculo_firmada(uuid, text, text) is
  'Anota el escaneo firmado de la ficha de un ingreso de vehículo, ya subido al bucket fichas-vehiculos, cuando la ficha tiene la salida cerrada. Requerimientos (vehiculos.registrar).';
revoke all on function public.adjuntar_ficha_vehiculo_firmada(uuid, text, text) from public, anon;
grant execute on function public.adjuntar_ficha_vehiculo_firmada(uuid, text, text) to authenticated;

-- 3. La revisión de Tesorería para la salida, por vehículo -------------------------------
-- Con la salida de la ficha cerrada y su escaneo firmado, Requerimientos le pide
-- a Tesorería que revise la salida del vehículo (si el cliente está al día) y
-- Tesorería la da por atendida o la observa. Si la observa, se vuelve a pedir:
-- cada pedido queda en el historial del ingreso.
create table if not exists public.registro_vehiculo_revisiones (
  id               uuid primary key default gen_random_uuid(),
  registro_id      uuid not null,
  concepto         text not null,
  estado           text not null default 'PENDIENTE',
  respuesta        text,
  solicitado_por   uuid not null default public.usuario_actual(),
  atendido_por     uuid,
  atendido_en      timestamptz,
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now(),
  constraint registro_vehiculo_revisiones_registro_id_fkey foreign key (registro_id) references public.registro_vehiculos(id) on delete restrict,
  constraint registro_vehiculo_revisiones_solicitado_por_fkey foreign key (solicitado_por) references public.usuarios(id) on delete restrict,
  constraint registro_vehiculo_revisiones_atendido_por_fkey foreign key (atendido_por) references public.usuarios(id) on delete restrict,
  constraint ck_registro_vehiculo_revision check (
    estado in ('PENDIENTE', 'ATENDIDA', 'OBSERVADA')
    and char_length(btrim(concepto)) between 3 and 2000
    and (respuesta is null or char_length(btrim(respuesta)) between 3 and 2000)
    and ((estado = 'PENDIENTE') = (atendido_en is null))
    and ((atendido_en is null) = (atendido_por is null))
    and (estado = 'PENDIENTE' or respuesta is not null))
);
comment on table public.registro_vehiculo_revisiones is
  'Los pedidos de Requerimientos a Tesorería para revisar la salida de un vehículo de la planta, con la respuesta de Tesorería (ATENDIDA u OBSERVADA). Se escriben con solicitar_revision_salida y responder_revision_salida; no se borran.';

-- (b) Requerimientos y Tesorería leen los pedidos de cada ingreso, del último al primero.
create index if not exists idx_registro_vehiculo_revisiones_registro
  on public.registro_vehiculo_revisiones (registro_id, creado_en desc);
-- Un solo pedido pendiente por ingreso; es también la lista de lo que espera a Tesorería.
create unique index if not exists uq_registro_vehiculo_revision_pendiente
  on public.registro_vehiculo_revisiones (registro_id) where estado = 'PENDIENTE';

select public.activar_timestamps('registro_vehiculo_revisiones');
select public.activar_auditoria('registro_vehiculo_revisiones');
select public.activar_registro_de_prueba('registro_vehiculo_revisiones');

create or replace function public.fn_registro_vehiculo_revision_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Un pedido de revisión a Tesorería no se borra: queda en el historial.' using errcode = 'check_violation';
  end if;
  if old.estado <> 'PENDIENTE' then
    raise exception 'Tesorería ya respondió ese pedido: si hace falta, pide otra revisión.' using errcode = 'check_violation';
  end if;
  if row(new.registro_id, new.concepto, new.solicitado_por, new.creado_en)
     is distinct from row(old.registro_id, old.concepto, old.solicitado_por, old.creado_en) then
    raise exception 'El pedido de revisión no se corrige: Tesorería lo responde.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_registro_vehiculo_revision_guardia() from public, anon, authenticated;
create or replace trigger trg_registro_vehiculo_revision_guardia
  before update or delete on public.registro_vehiculo_revisiones
  for each row execute function public.fn_registro_vehiculo_revision_guardia();

alter table public.registro_vehiculo_revisiones enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'registro_vehiculo_revisiones'
                   and policyname = 'ver_registro_vehiculo_revisiones') then
    create policy ver_registro_vehiculo_revisiones on public.registro_vehiculo_revisiones for select to authenticated
      using ((select public.es_admin()) or (select public.tiene_permiso('vehiculos.ver'))
             or (select public.tiene_permiso('vehiculos.registrar')) or (select public.tiene_permiso('tesoreria.liberar')));
  end if;
end $$;
revoke all on public.registro_vehiculo_revisiones from public, anon, authenticated;
grant select on public.registro_vehiculo_revisiones to authenticated;

-- Pedir la revisión: el vehículo sigue en la planta, la ficha tiene la salida
-- cerrada y el escaneo firmado, y no hay otro pedido esperando. Con el mismo
-- p_id, un reintento devuelve el pedido que ya entró. Le avisa a Tesorería.
create or replace function public.solicitar_revision_salida(p_id uuid, p_registro uuid, p_concepto text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_registro public.registro_vehiculos%rowtype;
  v_concepto text := nullif(regexp_replace(btrim(coalesce(p_concepto, '')), '\s+', ' ', 'g'), '');
  v_nombre   text;
begin
  perform public.exigir_permiso('vehiculos.registrar');
  if p_id is null then
    raise exception 'Vuelve a cargar la pantalla.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.registro_vehiculo_revisiones where id = p_id and registro_id = p_registro) then
    return p_id;
  end if;
  select * into v_registro from public.registro_vehiculos where id = p_registro for update;
  if not found or v_registro.anulado_en is not null then
    raise exception 'Ese ingreso de vehículo no está o está anulado.' using errcode = 'check_violation';
  end if;
  if v_registro.salida_en is not null then
    raise exception 'El vehículo ya salió de la planta: la revisión se pide antes de que salga.' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.registro_vehiculo_fichas f
                  where f.registro_id = p_registro and f.salida_cerrada_en is not null and f.escaneo_ruta is not null) then
    raise exception 'Cierra la salida de la ficha y adjunta su escaneo firmado antes de pedir la revisión a Tesorería.'
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.registro_vehiculo_revisiones where registro_id = p_registro and estado = 'PENDIENTE') then
    raise exception 'Ya hay un pedido de revisión esperando a Tesorería para este vehículo.' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(v_concepto, '')) not between 3 and 2000 then
    raise exception 'Escribe qué tiene que revisar Tesorería (de 3 a 2000 caracteres).' using errcode = 'check_violation';
  end if;

  insert into public.registro_vehiculo_revisiones (id, registro_id, concepto) values (p_id, p_registro, v_concepto);

  -- El aviso va a Tesorería, la que cobra (no a Gerencia ni a Administración,
  -- que también pueden responder pero no llevan la cobranza).
  v_nombre := coalesce(v_registro.placa, v_registro.chasis, v_registro.codigo_interno, v_registro.unidad);
  insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
  select u.id, 'Revisar la salida de ' || v_nombre,
         coalesce('Código ' || v_registro.codigo_interno || '. ', '') || v_concepto,
         '/tesoreria/por-cobrar', 'registro_vehiculo_revisiones', p_id
    from public.usuarios u
    join public.roles_permisos rp on rp.rol_id = u.rol_id and rp.permiso_codigo = 'tesoreria.liberar'
   where u.activo and u.id is distinct from public.usuario_actual()
     and exists (select 1 from public.roles_permisos c where c.rol_id = u.rol_id and c.permiso_codigo = 'tesoreria.registrar_cobros');
  return p_id;
end;
$$;
comment on function public.solicitar_revision_salida(uuid, uuid, text) is
  'Requerimientos (vehiculos.registrar) le pide a Tesorería revisar la salida de un vehículo que sigue en la planta, con la ficha de salida cerrada y escaneada. Avisa a Tesorería.';
revoke all on function public.solicitar_revision_salida(uuid, uuid, text) from public, anon;
grant execute on function public.solicitar_revision_salida(uuid, uuid, text) to authenticated;

-- Tesorería responde: atendida u observada, siempre con su respuesta. Le avisa a quien la pidió.
create or replace function public.responder_revision_salida(p_id uuid, p_estado text, p_respuesta text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_revision  public.registro_vehiculo_revisiones%rowtype;
  v_registro  public.registro_vehiculos%rowtype;
  v_respuesta text := nullif(regexp_replace(btrim(coalesce(p_respuesta, '')), '\s+', ' ', 'g'), '');
begin
  perform public.exigir_permiso('tesoreria.liberar');
  if p_estado not in ('ATENDIDA', 'OBSERVADA') then
    raise exception 'La revisión queda atendida u observada.' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(v_respuesta, '')) not between 3 and 2000 then
    raise exception 'Escribe la respuesta para Requerimientos (de 3 a 2000 caracteres).' using errcode = 'check_violation';
  end if;
  select * into v_revision from public.registro_vehiculo_revisiones where id = p_id for update;
  if not found then
    raise exception 'Ese pedido de revisión no está. Vuelve a cargar la pantalla.' using errcode = 'check_violation';
  end if;
  if v_revision.estado <> 'PENDIENTE' then
    if v_revision.estado = p_estado and v_revision.respuesta = v_respuesta then
      return p_id;
    end if;
    raise exception 'Ese pedido ya tiene respuesta.' using errcode = 'check_violation';
  end if;

  update public.registro_vehiculo_revisiones
     set estado = p_estado, respuesta = v_respuesta, atendido_por = public.usuario_actual(), atendido_en = now()
   where id = p_id;

  select * into v_registro from public.registro_vehiculos where id = v_revision.registro_id;
  insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
  select v_revision.solicitado_por,
         case p_estado when 'ATENDIDA' then 'Tesorería revisó la salida de ' else 'Tesorería observó la salida de ' end
           || coalesce(v_registro.placa, v_registro.chasis, v_registro.codigo_interno, v_registro.unidad),
         v_respuesta, '/vehiculos/' || v_revision.registro_id::text, 'registro_vehiculo_revisiones', p_id
   where v_revision.solicitado_por is distinct from public.usuario_actual();
  return p_id;
end;
$$;
comment on function public.responder_revision_salida(uuid, text, text) is
  'Tesorería (tesoreria.liberar) da por atendido u observa un pedido de revisión de la salida de un vehículo, con su respuesta. Avisa a quien lo pidió.';
revoke all on function public.responder_revision_salida(uuid, text, text) from public, anon;
grant execute on function public.responder_revision_salida(uuid, text, text) to authenticated;

-- Lo que espera a Tesorería, con el vehículo: Tesorería no ve el registro de vehículos.
create or replace function public.revisiones_de_salida_pendientes()
returns table (id uuid, registro_id uuid, placa text, chasis text, codigo_interno text, unidad text, empresa text,
               ingreso_en timestamptz, concepto text, solicitante text, creado_en timestamptz, escaneo_ruta text)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  perform public.exigir_permiso('tesoreria.liberar');
  return query
  select r.id, v.id, v.placa, v.chasis, v.codigo_interno, v.unidad, v.empresa, v.ingreso_en, r.concepto,
         nullif(btrim(concat_ws(' ', u.nombres, u.apellidos)), '')::text, r.creado_en, f.escaneo_ruta
    from public.registro_vehiculo_revisiones r
    join public.registro_vehiculos v on v.id = r.registro_id
    left join public.registro_vehiculo_fichas f on f.registro_id = v.id
    left join public.usuarios u on u.id = r.solicitado_por
   where r.estado = 'PENDIENTE'
   order by r.creado_en;
end;
$$;
comment on function public.revisiones_de_salida_pendientes() is
  'Los pedidos de revisión de salida de vehículos que esperan a Tesorería (tesoreria.liberar), con el vehículo, su código interno y el escaneo firmado de la ficha.';
revoke all on function public.revisiones_de_salida_pendientes() from public, anon;
grant execute on function public.revisiones_de_salida_pendientes() to authenticated;
