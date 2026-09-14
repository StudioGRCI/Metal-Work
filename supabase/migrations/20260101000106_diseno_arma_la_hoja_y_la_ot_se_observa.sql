-- =============================================================================
-- DISEÑO ARMA LA HOJA DE CADA ÁREA, Y LA ORDEN SE OBSERVA
-- -----------------------------------------------------------------------------
-- «Diseño no puede editar las actividades a reportar para los supervisores, y
-- no puede adjuntar comentarios en la OT por si hay errores.»
--
-- Desde la migración 090 la lista de actividades de cada área la armaba el jefe
-- de esa área. Pero quien desglosa la unidad es Diseño: sabe qué planos lleva,
-- qué piezas habilita Maestranza y qué arma Producción, y lo tenía que dictar.
-- El cliente decidió (2026-09-14) que la lista la arme Diseño para todas las
-- áreas, que los jefes y supervisores puedan seguir ajustando la suya, que el
-- supervisor reporte y que al jefe de producción le llegue un aviso cuando
-- Diseño la cambia.
--
-- Y la orden no tenía dónde decir «esto está mal» con seguimiento. El
-- comentario de la bitácora es una nota suelta: no va a nadie, nadie se entera
-- y no se cierra. Una observación sí: va a un área, les avisa a esa área y al
-- jefe de producción, y queda abierta en el resumen de la orden hasta que
-- alguien la resuelve diciendo qué hizo.
--
-- Cuatro piezas:
--
--   1. `puede_armar_hoja_de_area` — Diseño arma la hoja de cualquier área; el
--      jefe y el supervisor, la suya como antes. Se usa en las políticas de
--      `ot_actividades` y en `cargar_cronograma`. No se le da a Diseño
--      `produccion.actividades`: ese permiso también confirma la salida en
--      portería, registra unidades de flota y sube archivos a la orden.
--      `puede_hoja_de_area` no se toca: decide también quién reporta avance.
--   2. Un disparador propio sobre `ot_actividades` que avisa a quien aprueba
--      reportes cuando la lista la cambia Diseño. Un solo aviso por orden
--      mientras no se lea: veinte actividades no son veinte avisos.
--   3. `ot_observaciones`, que solo se escribe por `levantar_observacion_ot` y
--      `resolver_observacion_ot`. No se borra: es la evidencia de un error.
--   4. `ot_registrar_evento` deja de aceptar lo que le mandaba el navegador.
--      Desde una llamada directa firmaba quien dijera `p_usuario_id` y anotaba
--      el tipo que se pidiera: cualquiera que viera la orden podía dejar una
--      «entrega» firmada por otra persona. Ahora, fuera de un disparador, firma
--      quien llama y solo anota comentarios.
-- =============================================================================

-- =============================================================================
-- 1. QUIÉN ARMA LA HOJA DE UN ÁREA
-- =============================================================================
create or replace function public.puede_armar_hoja_de_area(p_area_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.es_admin()
      or public.tiene_permiso('diseno.planos')
      or (public.tiene_permiso('produccion.actividades') and public.puede_hoja_de_area(p_area_id));
$$;

comment on function public.puede_armar_hoja_de_area(uuid) is
  'Si quien llama puede armar la lista de actividades de un área: Diseño la de cualquiera; el jefe y el supervisor, la de su área (o todas con produccion.cualquier_area).';

revoke all on function public.puede_armar_hoja_de_area(uuid) from public, anon;
grant execute on function public.puede_armar_hoja_de_area(uuid) to authenticated;

drop policy if exists crear_ot_actividades on public.ot_actividades;
create policy crear_ot_actividades on public.ot_actividades
  for insert to authenticated
  with check (public.puede_armar_hoja_de_area(area_id));

drop policy if exists editar_ot_actividades on public.ot_actividades;
create policy editar_ot_actividades on public.ot_actividades
  for update to authenticated
  using (public.puede_armar_hoja_de_area(area_id))
  with check (public.puede_armar_hoja_de_area(area_id));

drop policy if exists borrar_ot_actividades on public.ot_actividades;
create policy borrar_ot_actividades on public.ot_actividades
  for delete to authenticated
  using (public.puede_armar_hoja_de_area(area_id));

update public.permisos
   set descripcion = 'Armar la lista de planos y piezas de una orden, dar por entregado cada plano y armar las actividades de cada área'
 where codigo = 'diseno.planos';

-- El cronograma en Excel es otra forma de armar la misma lista. Definición viva
-- al 2026-09-14; cambian solo el permiso de entrada y el filtro de área.
create or replace function public.cargar_cronograma(p_orden uuid, p_filas jsonb)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
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
  if not (public.es_admin()
          or public.tiene_permiso('produccion.actividades')
          or public.tiene_permiso('diseno.planos')) then
    raise exception 'El cronograma lo carga Diseño, el supervisor del área o el jefe.'
      using errcode = 'insufficient_privilege';
  end if;

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
      or not public.puede_armar_hoja_de_area(c.area_id)
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
$function$;

-- =============================================================================
-- 2. AL JEFE DE PRODUCCIÓN LE AVISAN CUANDO DISEÑO CAMBIA LA LISTA
-- =============================================================================
create or replace function public.fn_actividades_avisan_al_jefe()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_orden  uuid := case when tg_op = 'DELETE' then old.orden_id else new.orden_id end;
  v_yo     uuid := public.usuario_actual();
  v_numero text;
  v_titulo constant text := 'Diseño cambió la lista de actividades';
begin
  -- Solo lo que hace Diseño. Lo que arma el propio taller no se avisa a sí
  -- mismo, y sin sesión (una limpieza, una migración) no hay a quién atribuirlo.
  if v_yo is null
     or not public.tiene_permiso('diseno.planos')
     or public.tiene_permiso('produccion.actividades') then
    return null;
  end if;

  select o.numero into v_numero from public.ordenes_trabajo o where o.id = v_orden;
  if v_numero is null then
    return null;
  end if;

  -- Un aviso por orden mientras no se lea: el que ya está sin leer basta.
  insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
  select u.id, v_titulo,
         format('%s: Diseño armó o cambió actividades de la hoja. Revísala antes de que el taller reporte.', v_numero),
         '/ordenes/' || v_orden || '?vista=actividades', 'ordenes_trabajo', v_orden
    from public.usuarios u
    join public.roles r on r.id = u.rol_id
   where u.activo
     and u.id <> v_yo
     and (r.codigo = 'ADMIN'
          or exists (select 1 from public.roles_permisos rp
                      where rp.rol_id = r.id and rp.permiso_codigo = 'produccion.aprobar_reportes'))
     and not exists (select 1 from public.notificaciones n
                      where n.usuario_id = u.id
                        and n.origen_tabla = 'ordenes_trabajo'
                        and n.origen_id = v_orden
                        and n.titulo = v_titulo
                        and n.leida_en is null);
  return null;
end;
$$;

revoke all on function public.fn_actividades_avisan_al_jefe() from public, anon, authenticated;

drop trigger if exists trg_actividades_avisan_al_jefe on public.ot_actividades;
create trigger trg_actividades_avisan_al_jefe
  after insert or update or delete on public.ot_actividades
  for each row execute function public.fn_actividades_avisan_al_jefe();

-- =============================================================================
-- 3. LAS OBSERVACIONES DE LA ORDEN
-- =============================================================================
create table if not exists public.ot_observaciones (
  id              uuid primary key default gen_random_uuid(),
  orden_id        uuid not null references public.ordenes_trabajo(id) on delete cascade,
  -- A qué área va: la que tiene que corregir, y la que recibe el aviso.
  area_id         uuid not null references public.areas(id) on delete restrict,
  descripcion     text not null,
  registrado_por  uuid not null references public.usuarios(id) default public.usuario_actual(),
  resolucion      text,
  resuelta_por    uuid references public.usuarios(id),
  resuelta_en     timestamptz,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  constraint ck_ot_observacion_descripcion check (length(btrim(descripcion)) between 3 and 2000),
  -- Resuelta es un dato completo: quién, cuándo y qué se hizo. O nada.
  constraint ck_ot_observacion_resuelta check (
    (resuelta_en is null and resuelta_por is null and resolucion is null)
    or (resuelta_en is not null and resuelta_por is not null
        and length(btrim(coalesce(resolucion, ''))) between 3 and 1000))
);

comment on table public.ot_observaciones is
  'Un error o una observación sobre una orden, dirigida a un área. Avisa a esa área y al jefe de producción, y queda abierta hasta que alguien la resuelve diciendo qué hizo. No se borra.';

-- (b) La pantalla la lee siempre por orden, la más reciente primero.
-- `area_id`, `registrado_por` y `resuelta_por` no llevan índice: la pantalla no
-- filtra por ellas y ni las áreas ni las cuentas se borran (se desactivan).
create index if not exists ix_ot_observaciones_orden
  on public.ot_observaciones (orden_id, creado_en desc);

alter table public.ot_observaciones enable row level security;

-- Se ve donde se ve la orden. No hay políticas de escritura: se levanta y se
-- resuelve por sus funciones, que son las que avisan y dejan la traza.
drop policy if exists ver_ot_observaciones on public.ot_observaciones;
create policy ver_ot_observaciones on public.ot_observaciones
  for select to authenticated
  using (public.puede_ver_orden(orden_id));

-- Supabase le da todo a `authenticated` en cada tabla nueva: se le quita y se
-- le devuelve solo la lectura, además de no tener políticas de escritura.
revoke all on public.ot_observaciones from anon, public, authenticated;
grant select on public.ot_observaciones to authenticated;

select public.activar_timestamps('ot_observaciones');
select public.activar_auditoria('ot_observaciones');
select public.activar_registro_de_prueba('ot_observaciones');

-- Con los nombres ya puestos: la tabla tiene tres llaves hacia `usuarios` y un
-- embebido sin nombrar la llave falla entero.
create or replace view public.v_ot_observaciones as
select ob.id,
       ob.orden_id,
       ob.area_id,
       ar.codigo as area_codigo,
       ar.nombre as area,
       ob.descripcion,
       ob.registrado_por,
       nullif(btrim(coalesce(ur.nombres, '') || ' ' || coalesce(ur.apellidos, '')), '') as registrado_por_nombre,
       ob.creado_en,
       ob.resolucion,
       ob.resuelta_por,
       nullif(btrim(coalesce(us.nombres, '') || ' ' || coalesce(us.apellidos, '')), '') as resuelta_por_nombre,
       ob.resuelta_en,
       (ob.resuelta_en is null) as abierta
  from public.ot_observaciones ob
  join public.areas ar on ar.id = ob.area_id
  left join public.usuarios ur on ur.id = ob.registrado_por
  left join public.usuarios us on us.id = ob.resuelta_por;

alter view public.v_ot_observaciones set (security_invoker = on);
revoke all on public.v_ot_observaciones from anon, public, authenticated;
grant select on public.v_ot_observaciones to authenticated;

/**
 * Levantar una observación. La levanta quien ve la orden. Si el mismo texto
 * para la misma área ya está abierto (el doble toque), devuelve esa y no avisa
 * dos veces.
 */
create or replace function public.levantar_observacion_ot(p_orden uuid, p_area uuid, p_descripcion text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_yo     constant uuid := public.usuario_actual();
  v_texto  constant text := btrim(coalesce(p_descripcion, ''));
  v_orden  record;
  v_area   text;
  v_id     uuid;
begin
  if v_yo is null or not public.puede_ver_orden(p_orden) then
    raise exception 'No puedes anotar observaciones en esta orden.' using errcode = 'insufficient_privilege';
  end if;

  select o.numero, o.estado into v_orden from public.ordenes_trabajo o where o.id = p_orden;
  if v_orden.numero is null then
    raise exception 'No se encontró la orden.' using errcode = 'foreign_key_violation';
  end if;
  if v_orden.estado = 'ANULADA' then
    raise exception 'La orden % está anulada: ya no se le anotan observaciones.', v_orden.numero
      using errcode = 'check_violation';
  end if;

  select a.nombre into v_area from public.areas a where a.id = p_area and a.activo;
  if v_area is null then
    raise exception 'Elige a qué área va la observación.' using errcode = 'check_violation';
  end if;

  if length(v_texto) < 3 then
    raise exception 'Cuenta qué está mal: el área tiene que entenderlo sin preguntar.' using errcode = 'check_violation';
  end if;
  if length(v_texto) > 2000 then
    raise exception 'La observación pasa de 2000 caracteres: resúmela.' using errcode = 'check_violation';
  end if;

  select ob.id into v_id
    from public.ot_observaciones ob
   where ob.orden_id = p_orden
     and ob.area_id = p_area
     and ob.resuelta_en is null
     and lower(ob.descripcion) = lower(v_texto)
   limit 1;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.ot_observaciones (orden_id, area_id, descripcion, registrado_por)
  values (p_orden, p_area, v_texto, v_yo)
  returning id into v_id;

  perform public.ot_registrar_evento_interna(
    p_orden, 'COMENTARIO', format('Observación para %s: %s', v_area, left(v_texto, 300)),
    jsonb_build_object('observacion_id', v_id, 'area_id', p_area), null, v_yo);

  -- A la gente del área y a quien aprueba los reportes, una vez cada uno.
  insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
  select u.id,
         format('Observación en la orden %s', v_orden.numero),
         format('Para %s: %s', v_area, left(v_texto, 200)),
         '/ordenes/' || p_orden, 'ot_observaciones', v_id
    from public.usuarios u
    join public.roles r on r.id = u.rol_id
   where u.activo
     and u.id <> v_yo
     and (u.area_id = p_area
          or r.codigo = 'ADMIN'
          or exists (select 1 from public.roles_permisos rp
                      where rp.rol_id = r.id and rp.permiso_codigo = 'produccion.aprobar_reportes'));

  return v_id;
end;
$$;

revoke all on function public.levantar_observacion_ot(uuid, uuid, text) from public, anon;
grant execute on function public.levantar_observacion_ot(uuid, uuid, text) to authenticated;

/**
 * Resolverla: el área a la que va, quien la levantó o el jefe de producción,
 * diciendo qué se hizo. Resuelta queda firme. Repetirla quien ya la resolvió
 * (el doble toque) no hace nada.
 */
create or replace function public.resolver_observacion_ot(p_id uuid, p_resolucion text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_yo     constant uuid := public.usuario_actual();
  v_texto  constant text := btrim(coalesce(p_resolucion, ''));
  v_ob     record;
begin
  select ob.*, o.numero, a.nombre as area
    into v_ob
    from public.ot_observaciones ob
    join public.ordenes_trabajo o on o.id = ob.orden_id
    join public.areas a on a.id = ob.area_id
   where ob.id = p_id
     for update of ob;

  if v_yo is null or v_ob.id is null or not public.puede_ver_orden(v_ob.orden_id) then
    raise exception 'No se encontró la observación.' using errcode = 'foreign_key_violation';
  end if;

  if v_ob.resuelta_en is not null then
    if v_ob.resuelta_por = v_yo then
      return v_ob.id;
    end if;
    raise exception 'Esta observación ya se resolvió el %.', to_char(v_ob.resuelta_en at time zone 'America/Lima', 'DD/MM/YYYY')
      using errcode = 'check_violation';
  end if;

  if not (public.es_admin()
          or v_ob.registrado_por = v_yo
          or public.tiene_permiso('produccion.aprobar_reportes')
          or exists (select 1 from public.usuarios u where u.id = v_yo and u.activo and u.area_id = v_ob.area_id)) then
    raise exception 'La resuelve %, quien la anotó o el jefe de producción.', v_ob.area
      using errcode = 'check_violation';
  end if;

  if length(v_texto) < 3 then
    raise exception 'Cuenta qué se hizo para resolverla.' using errcode = 'check_violation';
  end if;
  if length(v_texto) > 1000 then
    raise exception 'Lo que se hizo pasa de 1000 caracteres: resúmelo.' using errcode = 'check_violation';
  end if;

  update public.ot_observaciones
     set resolucion = v_texto, resuelta_por = v_yo, resuelta_en = now()
   where id = v_ob.id;

  perform public.ot_registrar_evento_interna(
    v_ob.orden_id, 'COMENTARIO', format('Observación resuelta (%s): %s', v_ob.area, left(v_texto, 300)),
    jsonb_build_object('observacion_id', v_ob.id), null, v_yo);

  perform public.notificar_a_usuario(
    v_ob.registrado_por,
    format('Se resolvió tu observación en la orden %s', v_ob.numero),
    left(v_texto, 200),
    '/ordenes/' || v_ob.orden_id, 'ot_observaciones', v_ob.id, v_yo);

  return v_ob.id;
end;
$$;

revoke all on function public.resolver_observacion_ot(uuid, text) from public, anon;
grant execute on function public.resolver_observacion_ot(uuid, text) to authenticated;

-- =============================================================================
-- 4. LA BITÁCORA LA FIRMA QUIEN LLAMA
-- -----------------------------------------------------------------------------
-- Definición viva al 2026-09-14 más la guarda de la llamada directa. Los
-- disparadores (profundidad > 0) siguen igual: `fn_avance_mueve_etapa` firma
-- con quien registró el avance y `crear_etapas_ot` anota la creación. Las
-- llamadas directas que existen —la pantalla, `cargar_cronograma`,
-- `poner_cliente_a_orden`— ya anotan solo comentarios.
-- =============================================================================
create or replace function public.ot_registrar_evento(
  p_orden_id uuid,
  p_tipo public.tipo_evento_ot,
  p_descripcion text default null,
  p_datos jsonb default null,
  p_etapa_id uuid default null,
  p_usuario_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- Nadie anota en la bitácora de una orden que no puede ver. Sin esto, un
  -- operario podía escribir en el historial de cualquier OT del taller.
  if not public.puede_ver_orden(p_orden_id) then
    raise exception 'No puede registrar eventos en una orden que no le corresponde'
      using errcode = 'insufficient_privilege';
  end if;

  -- Fuera de un disparador, lo pide una persona: firma ella y solo comenta.
  if pg_trigger_depth() = 0 then
    if p_tipo is distinct from 'COMENTARIO' then
      raise exception 'Desde la pantalla solo se anotan comentarios en la bitácora.'
        using errcode = 'insufficient_privilege';
    end if;
    return public.ot_registrar_evento_interna(
      p_orden_id, p_tipo, p_descripcion, p_datos, p_etapa_id, null);
  end if;

  return public.ot_registrar_evento_interna(
    p_orden_id, p_tipo, p_descripcion, p_datos, p_etapa_id, p_usuario_id);
end;
$function$;
