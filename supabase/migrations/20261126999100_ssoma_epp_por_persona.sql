-- =============================================================================
-- SSOMA: ENTREGA DE EPP POR PERSONA
-- -----------------------------------------------------------------------------
-- Plan 15, entrega 15.5 (DKS, 2026-11-25): «entrega de EPP por persona,
-- enlazada a la salida de Almacén sin cambiar el kardex, con fecha de
-- renovación.»
--
--   * LA SALIDA ES DE ALMACÉN. El casco, los lentes o los guantes salen del
--     almacén de EPP como hoy: Almacén registra la salida, con su número
--     (SA-0001-2026), quién recibe y su formato firmado. Nada de eso cambia: esta
--     migración no toca `movimientos_materiales`, sus funciones ni su vista.
--   * A QUIÉN LE TOCÓ. El kardex dice que salieron cinco pares de guantes; no
--     dice a qué cinco personas. SSOMA lo anota aquí: de cada salida de EPP, a
--     quién de la lista de RR. HH. se le entregó, cuánto y hasta cuándo le dura
--     (la fecha de renovación). De RR. HH. se lee solo nombre, cargo y área.
--   * POR RENOVAR. Lo que cada persona tiene vigente y ya venció, o vence en los
--     próximos 15 días. Una entrega nueva del mismo equipo a la misma persona
--     reemplaza a la anterior; lo que ya no se va a reponer (cambió de puesto, ya
--     no usa ese equipo) SSOMA lo saca de la lista con su motivo.
--   * NO SE BORRA NI SE CORRIGE. Una entrega mal anotada se anula con su motivo,
--     y lo que se le había asignado vuelve a quedar por asignar en esa salida.
--   * LO QUE NO VA POR PERSONA. Del almacén de EPP sale también lo que no es de
--     nadie en particular (lunas de soldar para el área, filtros, un polo para
--     una visita). SSOMA dice de esa salida, con su motivo, que lo que queda no
--     se reparte por persona, y deja de esperar en su lista. Se puede deshacer.
--   * SIN NÚMERO PROPIO. `docs/ANALISIS-ONEDRIVE.md` nombra el formato de EPP de
--     Almacén sin columnas ni numeración: la entrega se identifica con el número
--     de la salida de Almacén. Sigue al registro de equipos de seguridad de la
--     R.M. 050-2013-TR: equipo, persona, área, fecha de entrega y de renovación.
--   * QUIÉN VE: SSOMA registra (`ssoma.gestionar`); SSOMA y Gerencia consultan
--     (`ssoma.ver`). Nadie más. El precio del equipo no se lee nunca.
--
-- Sin DROP: el conector de producción no deja pasar ninguno.
-- =============================================================================

-- 1. La entrega a cada persona --------------------------------------------------------------------
create table if not exists public.ssoma_epp_entregas (
  id                     uuid primary key default gen_random_uuid(),
  -- El envío de la ventana: una salida repartida entre varias personas entra de una vez.
  envio_id               uuid not null,
  -- La salida de Almacén de donde salió el equipo. Solo se lee.
  movimiento_id          uuid not null references public.movimientos_materiales(id) on delete restrict,
  -- El equipo de esa salida, guardado aquí para saber qué entrega reemplaza a cuál.
  material_id            uuid not null references public.materiales(id) on delete restrict,
  trabajador_id          uuid not null references public.trabajadores(id) on delete restrict,
  cantidad               numeric(14,3) not null,
  -- El día de la salida, en Lima.
  entregado_el           date not null,
  renovar_el             date not null,
  creado_por             uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  sin_renovacion_por     uuid references public.usuarios(id) on delete restrict,
  sin_renovacion_en      timestamptz,
  motivo_sin_renovacion  text,
  anulado_por            uuid references public.usuarios(id) on delete restrict,
  anulado_en             timestamptz,
  motivo_anulacion       text,
  creado_en              timestamptz not null default now(),
  actualizado_en         timestamptz not null default now(),
  constraint ck_ssoma_epp_datos check (cantidad > 0 and cantidad <= 999 and renovar_el > entregado_el),
  constraint ck_ssoma_epp_sin_renovacion check (
    (sin_renovacion_por is null and sin_renovacion_en is null and motivo_sin_renovacion is null)
    or (sin_renovacion_por is not null and sin_renovacion_en is not null
        and char_length(btrim(coalesce(motivo_sin_renovacion, ''))) between 5 and 300)),
  constraint ck_ssoma_epp_anulada check (
    (anulado_por is null and anulado_en is null and motivo_anulacion is null)
    or (anulado_por is not null and anulado_en is not null
        and char_length(btrim(coalesce(motivo_anulacion, ''))) between 10 and 500))
);
comment on table public.ssoma_epp_entregas is
  'A quién se le entregó cada equipo de protección que salió de Almacén: la persona (de RR. HH.), cuánto, el día y hasta cuándo le dura. La anota SSOMA sobre la salida de Almacén, que no cambia. No se corrige ni se borra: se anula con su motivo.';
comment on column public.ssoma_epp_entregas.renovar_el is
  'Hasta cuándo le dura el equipo a esa persona: desde ese día sale en «Por renovar».';
comment on column public.ssoma_epp_entregas.motivo_sin_renovacion is
  'Por qué ese equipo ya no se le va a reponer a la persona (cambió de puesto, ya no lo usa). Con motivo, deja de salir en «Por renovar».';

-- Una persona figura una vez por salida mientras la entrega valga; también es el
-- índice con que se suma lo ya asignado de una salida (b).
create unique index if not exists uq_ssoma_epp_persona_por_salida
  on public.ssoma_epp_entregas (movimiento_id, trabajador_id) where anulado_en is null;
-- Las entregas de una salida, también las anuladas (b): el índice de arriba es
-- parcial y ni esa lectura ni la integridad de la llave lo pueden usar.
create index if not exists ix_ssoma_epp_salida on public.ssoma_epp_entregas (movimiento_id);
-- Lo que tiene una persona y qué entrega reemplaza a cuál (b): la hoja de la persona
-- y el estado de cada entrega filtran por persona y equipo.
create index if not exists ix_ssoma_epp_persona_equipo
  on public.ssoma_epp_entregas (trabajador_id, material_id, entregado_el desc);
-- La última entrega de un equipo, para proponer cuánto dura (b).
create index if not exists ix_ssoma_epp_equipo on public.ssoma_epp_entregas (material_id, entregado_el desc);
-- El envío de la ventana: si ya entró (b).
create index if not exists ix_ssoma_epp_envio on public.ssoma_epp_entregas (envio_id);
-- creado_por, sin_renovacion_por y anulado_por: (a), (b) y (c) no se cumplen; sin índice.
select public.activar_timestamps('ssoma_epp_entregas');
-- Sin `activar_auditoria`, como el resto de SSOMA: quién la anotó, quién la anuló y quién dijo que no se
-- renueva ya están en la fila, sellados por su disparador; y `audit_log` se lee con otro permiso.
select public.activar_registro_de_prueba('ssoma_epp_entregas');

-- 2. La entrega solo cambia al anularse o al dejar de renovarse; quién y cuándo los pone la base ----
create or replace function public.fn_ssoma_epp_entrega_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
declare
  v_cambian constant text[] := array['sin_renovacion_por', 'sin_renovacion_en', 'motivo_sin_renovacion',
                                     'anulado_por', 'anulado_en', 'motivo_anulacion', 'actualizado_en'];
begin
  if tg_op = 'DELETE' then
    raise exception 'Una entrega de EPP no se borra: SSOMA la anula con su motivo.' using errcode = 'check_violation';
  end if;
  if old.anulado_en is not null then
    raise exception 'La entrega está anulada: queda como evidencia.' using errcode = 'check_violation';
  end if;
  if (to_jsonb(new) - v_cambian) is distinct from (to_jsonb(old) - v_cambian) then
    raise exception 'Una entrega de EPP no se corrige: SSOMA la anula y la anota otra vez.' using errcode = 'check_violation';
  end if;
  -- «No se renueva» se dice una vez: no se cambia el motivo ni se deshace por debajo.
  if old.sin_renovacion_en is not null then
    new.sin_renovacion_por := old.sin_renovacion_por;
    new.sin_renovacion_en := old.sin_renovacion_en;
    new.motivo_sin_renovacion := old.motivo_sin_renovacion;
  elsif new.motivo_sin_renovacion is not null then
    new.sin_renovacion_por := coalesce(public.usuario_actual(), new.sin_renovacion_por);
    new.sin_renovacion_en := now();
  else
    new.sin_renovacion_por := null;
    new.sin_renovacion_en := null;
  end if;
  if new.motivo_anulacion is not null then
    new.anulado_por := coalesce(public.usuario_actual(), new.anulado_por);
    new.anulado_en := now();
  else
    new.anulado_por := null;
    new.anulado_en := null;
  end if;
  return new;
end;
$$;
revoke all on function public.fn_ssoma_epp_entrega_guardia() from public, anon, authenticated;
create or replace trigger trg_ssoma_epp_entrega_guardia
  before update or delete on public.ssoma_epp_entregas
  for each row execute function public.fn_ssoma_epp_entrega_guardia();

-- 3. Quién lee la tabla: SSOMA y Gerencia. Se escribe solo por las funciones -----------------------
alter table public.ssoma_epp_entregas enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ssoma_epp_entregas' and policyname = 'ver_ssoma_epp_entregas') then
    create policy ver_ssoma_epp_entregas on public.ssoma_epp_entregas for select to authenticated
      using ((select public.puede_ver_reportes_ssoma()));
  end if;
end $$;
revoke all on public.ssoma_epp_entregas from public, anon, authenticated;
grant select on public.ssoma_epp_entregas to authenticated;

-- 3b. La salida cuyo resto no se reparte por persona ----------------------------------------------
create table if not exists public.ssoma_epp_sin_reparto (
  id              uuid primary key default gen_random_uuid(),
  movimiento_id   uuid not null references public.movimientos_materiales(id) on delete restrict,
  motivo          text not null,
  creado_por      uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  -- Deshecho: la salida vuelve a esperar que se anote a quién le tocó.
  deshecho_por    uuid references public.usuarios(id) on delete restrict,
  deshecho_en     timestamptz,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  constraint ck_ssoma_epp_sin_reparto_motivo check (char_length(btrim(motivo)) between 5 and 300),
  constraint ck_ssoma_epp_sin_reparto_deshecho check ((deshecho_por is null) = (deshecho_en is null))
);
comment on table public.ssoma_epp_sin_reparto is
  'La salida del almacén de EPP de la que SSOMA dijo, con su motivo, que lo que queda no se reparte por persona (un consumible del área, algo para una visita): deja de esperar en su lista. No cambia la salida de Almacén. Se deshace, y queda quién y cuándo.';
-- Una vez por salida mientras valga. Es el índice con que se busca si una salida
-- está así (b); el completo de abajo es para la llave y para leer su historia.
create unique index if not exists uq_ssoma_epp_sin_reparto_vigente
  on public.ssoma_epp_sin_reparto (movimiento_id) where deshecho_en is null;
create index if not exists ix_ssoma_epp_sin_reparto_salida on public.ssoma_epp_sin_reparto (movimiento_id);
-- creado_por y deshecho_por: (a), (b) y (c) no se cumplen; sin índice.
select public.activar_timestamps('ssoma_epp_sin_reparto');
-- Sin `activar_auditoria`, por lo mismo: quién lo dijo y quién lo deshizo van en la fila.
select public.activar_registro_de_prueba('ssoma_epp_sin_reparto');

create or replace function public.fn_ssoma_epp_sin_reparto_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
declare
  v_cambian constant text[] := array['deshecho_por', 'deshecho_en', 'actualizado_en'];
begin
  if tg_op = 'DELETE' then
    raise exception 'Lo que SSOMA dijo de una salida de EPP no se borra: se deshace.' using errcode = 'check_violation';
  end if;
  if old.deshecho_en is not null then
    raise exception 'Eso ya se deshizo: queda como evidencia.' using errcode = 'check_violation';
  end if;
  if (to_jsonb(new) - v_cambian) is distinct from (to_jsonb(old) - v_cambian) then
    raise exception 'El motivo no se corrige: se deshace y se dice otra vez.' using errcode = 'check_violation';
  end if;
  if new.deshecho_en is not null or new.deshecho_por is not null then
    new.deshecho_por := coalesce(public.usuario_actual(), new.deshecho_por);
    new.deshecho_en := now();
  end if;
  return new;
end;
$$;
revoke all on function public.fn_ssoma_epp_sin_reparto_guardia() from public, anon, authenticated;
create or replace trigger trg_ssoma_epp_sin_reparto_guardia
  before update or delete on public.ssoma_epp_sin_reparto
  for each row execute function public.fn_ssoma_epp_sin_reparto_guardia();

alter table public.ssoma_epp_sin_reparto enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ssoma_epp_sin_reparto' and policyname = 'ver_ssoma_epp_sin_reparto') then
    create policy ver_ssoma_epp_sin_reparto on public.ssoma_epp_sin_reparto for select to authenticated
      using ((select public.puede_ver_reportes_ssoma()));
  end if;
end $$;
revoke all on public.ssoma_epp_sin_reparto from public, anon, authenticated;
grant select on public.ssoma_epp_sin_reparto to authenticated;

-- 4. Ayudantes ---------------------------------------------------------------------------------------
-- En qué quedó una entrega. La reemplaza otra del mismo equipo a la misma persona,
-- posterior y que valga.
create or replace function public.ssoma_epp_estado(
  p_id uuid, p_trabajador uuid, p_material uuid, p_entregado date, p_creado timestamptz,
  p_anulado timestamptz, p_sin_renovacion timestamptz
) returns text language sql stable set search_path to 'public' as $$
  select case
    when p_anulado is not null then 'ANULADA'
    when p_sin_renovacion is not null then 'SIN_RENOVACION'
    when exists (select 1 from public.ssoma_epp_entregas n
                  where n.trabajador_id = p_trabajador and n.material_id = p_material
                    and n.anulado_en is null and n.id <> p_id
                    and (n.entregado_el, n.creado_en, n.id) > (p_entregado, p_creado, p_id)) then 'RENOVADA'
    else 'VIGENTE' end;
$$;
comment on function public.ssoma_epp_estado(uuid, uuid, uuid, date, timestamptz, timestamptz, timestamptz) is
  'En qué quedó una entrega de EPP: VIGENTE, RENOVADA (hay otra posterior del mismo equipo a la misma persona), SIN_RENOVACION o ANULADA. Ayudante de las lecturas de SSOMA.';
revoke all on function public.ssoma_epp_estado(uuid, uuid, uuid, date, timestamptz, timestamptz, timestamptz) from public, anon, authenticated;

-- Una cantidad como se lee: 2, 1.5.
create or replace function public.ssoma_cantidad_en_texto(p_cantidad numeric)
returns text language sql immutable set search_path to 'public' as $$
  select rtrim(rtrim(round(coalesce(p_cantidad, 0), 3)::numeric(14,3)::text, '0'), '.');
$$;
revoke all on function public.ssoma_cantidad_en_texto(numeric) from public, anon, authenticated;

-- Con cuántos días se avisa antes de que venza un equipo.
create or replace function public.ssoma_epp_dias_de_aviso()
returns integer language sql immutable set search_path to 'public' as $$ select 15; $$;
revoke all on function public.ssoma_epp_dias_de_aviso() from public, anon, authenticated;

-- 5. Las salidas de EPP de Almacén, para repartirlas -----------------------------------------------
-- Solo lo que SSOMA necesita de la salida: su número, el día, el equipo, cuánto
-- salió, cuánto se devolvió y quién firmó que recibía. Sin precio.
create or replace function public.ssoma_salidas_de_epp(p_movimiento uuid)
returns table (
  movimiento_id uuid, numero text, fecha date, material_id uuid, material text, unidad text,
  cantidad numeric, devuelto numeric, asignado numeric, por_asignar numeric, asignado_de_mas numeric,
  recibio text, dias_sugeridos integer,
  sin_reparto boolean, motivo_sin_reparto text, dijo_sin_reparto text,
  a_quien jsonb, no_estaban uuid[])
language sql stable security definer set search_path to 'public' rows 50 as $$
  with s as (
    select k.id, k.numero_salida, (k.registrado_en at time zone 'America/Lima')::date as fecha, k.registrado_en,
           k.material_id, m.descripcion, u.codigo as unidad, k.cantidad::numeric as cantidad, k.recibido_por_nombre,
           coalesce((select sum(d.cantidad::numeric) from public.movimientos_materiales d
                      where d.devolucion_de = k.id and d.tipo = 'INGRESO' and d.origen = 'DEVOLUCION'), 0) as devuelto,
           coalesce((select sum(e.cantidad) from public.ssoma_epp_entregas e
                      where e.movimiento_id = k.id and e.anulado_en is null), 0) as asignado,
           x.motivo as motivo_sin_reparto, x.creado_por as dijo
      from public.movimientos_materiales k
      join public.materiales m on m.id = k.material_id
      join public.categorias_material c on c.id = m.categoria_id
      left join public.unidades_medida u on u.id = m.unidad_medida_id
      left join public.ssoma_epp_sin_reparto x on x.movimiento_id = k.id and x.deshecho_en is null
     where public.puede_ver_reportes_ssoma()
       and k.tipo = 'SALIDA' and c.almacen = 'EPP'
       and (p_movimiento is null or k.id = p_movimiento)
  )
  select s.id, s.numero_salida, s.fecha, s.material_id, s.descripcion, s.unidad,
         s.cantidad, s.devuelto, s.asignado,
         greatest(s.cantidad - s.devuelto - s.asignado, 0),
         greatest(s.asignado - (s.cantidad - s.devuelto), 0),
         s.recibido_por_nombre,
         -- Cuánto se le dio de duración la última vez a ese equipo: se propone lo mismo.
         (select (e.renovar_el - e.entregado_el)::integer from public.ssoma_epp_entregas e
           where e.material_id = s.material_id and e.anulado_en is null
           order by e.entregado_el desc, e.creado_en desc limit 1),
         s.motivo_sin_reparto is not null, s.motivo_sin_reparto, public.ssoma_nombre_de(s.dijo),
         -- A quién le tocó: las entregas que valen, con la salida misma. Leídas aparte y con
         -- tope, las salidas más antiguas de la lista se quedaban sin sus nombres.
         coalesce((select jsonb_agg(jsonb_build_object(
                            'id', e.id, 'trabajador_id', e.trabajador_id,
                            'persona', btrim(t.apellidos || ' ' || t.nombres), 'cantidad', e.cantidad)
                          order by t.apellidos, t.nombres, e.id)
                     from public.ssoma_epp_entregas e join public.trabajadores t on t.id = e.trabajador_id
                    where e.movimiento_id = s.id and e.anulado_en is null), '[]'::jsonb),
         -- De la lista para marcar (`ssoma_personal_para_epp`), quién no estaba en la planta el día
         -- de la salida: la ventana no los ofrece. Solo para quien anota y si queda algo por asignar.
         -- Es la regla de `ssoma_estuvo_en_la_planta` (la que usa la base al anotar) escrita aquí mismo:
         -- llamada por cada salida y cada persona costaba 19 µs el par, 0,4 s con 100 salidas por anotar.
         -- El check 493 compara las dos, par por par.
         case when (public.es_admin() or public.tiene_permiso('ssoma.gestionar')) and s.cantidad - s.devuelto - s.asignado > 0
              then coalesce((select array_agg(t.id) from public.trabajadores t
                              where (t.activo or t.fecha_baja >= public.ssoma_hoy() - 180)
                                and not ((t.fecha_ingreso is null or t.fecha_ingreso <= s.fecha)
                                         and case when t.activo then t.fecha_baja is null or t.fecha_baja >= s.fecha
                                                  else t.fecha_baja is not null and t.fecha_baja >= s.fecha end)
                                and not exists (select 1 from public.trabajador_periodos q
                                                 where q.trabajador_id = t.id
                                                   and (q.ingreso is null or q.ingreso <= s.fecha) and q.baja >= s.fecha)),
                            '{}'::uuid[])
              else '{}'::uuid[] end
    from s
   where p_movimiento is not null
      or s.fecha >= public.ssoma_hoy() - 60
      -- Lo que le queda algo por asignar no se pierde a los 60 días: sigue hasta los 180. También lo
      -- que se marcó «no va por persona»: fuera de la lista no habría dónde deshacerlo con «Repartir».
      or (s.fecha >= public.ssoma_hoy() - 180
          and (s.asignado > s.cantidad - s.devuelto or s.cantidad - s.devuelto - s.asignado > 0))
   order by (s.cantidad - s.devuelto - s.asignado > 0 and s.motivo_sin_reparto is null) desc, s.registrado_en desc, s.id;
$$;
comment on function public.ssoma_salidas_de_epp(uuid) is
  'Las salidas del almacén de EPP que SSOMA reparte entre personas: las de los últimos 60 días y, hasta 180 días atrás, las que tienen equipo por asignar (también las marcadas «no va por persona», para poder deshacerlo) o más asignado de lo que quedó fuera de Almacén; o una sola, de cualquier fecha. Número, día, equipo, cantidad, devuelto, asignado, quién recibió, a quién le tocó y, para quien anota, quién de la lista no estaba en la planta ese día; sin precio. La ven SSOMA y Gerencia.';
revoke all on function public.ssoma_salidas_de_epp(uuid) from public, anon;
grant execute on function public.ssoma_salidas_de_epp(uuid) to authenticated;

-- 6. A quién se le puede anotar una entrega ---------------------------------------------------------
-- De RR. HH. sale solo nombre, cargo y área: nunca DNI, cuentas ni costos.
create or replace function public.ssoma_personal_para_epp()
returns table (id uuid, nombre text, cargo text, area text, en_planta boolean)
language plpgsql stable security definer set search_path to 'public' rows 200 as $$
begin
  if public.usuario_actual() is null or not (public.es_admin() or public.tiene_permiso('ssoma.gestionar')) then
    raise exception 'La entrega de EPP la anota SSOMA.' using errcode = 'insufficient_privilege';
  end if;
  -- También quien se fue en los últimos 180 días, que es lo que una salida espera en la lista:
  -- pudo recibir un equipo de una salida de antes de irse.
  return query
    select t.id, btrim(t.apellidos || ' ' || t.nombres), t.cargo, a.nombre, t.activo
      from public.trabajadores t
      left join public.areas a on a.id = t.area_id
     where t.activo or t.fecha_baja >= public.ssoma_hoy() - 180
     order by a.nombre nulls last, t.apellidos, t.nombres;
end;
$$;
comment on function public.ssoma_personal_para_epp() is
  'El personal de RR. HH. al que SSOMA puede anotarle una entrega de EPP: el activo y quien se fue en los últimos 180 días. Solo nombre, cargo y área. Exige ssoma.gestionar.';
revoke all on function public.ssoma_personal_para_epp() from public, anon;
grant execute on function public.ssoma_personal_para_epp() to authenticated;

-- 7. Anotar a quién se le entregó --------------------------------------------------------------------
-- El id lo pone la ventana: un reintento con lo mismo devuelve lo que ya entró.
create or replace function public.ssoma_registrar_entregas_epp(
  p_envio uuid, p_movimiento uuid, p_renovar_el date, p_personas jsonb
) returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo        uuid := public.usuario_actual();
  v_envio     constant jsonb := jsonb_build_array(p_movimiento, p_renovar_el, p_personas);
  v_personas  jsonb := coalesce(p_personas, '[]'::jsonb);
  v_de        uuid;
  v_mov       record;
  v_ids       uuid[];
  v_cants     numeric[];
  v_nombres   text;
  v_n         integer;
  v_total     numeric;
  v_queda     numeric;
  v_salida    text;
begin
  if v_yo is null or not (public.es_admin() or public.tiene_permiso('ssoma.gestionar')) then
    raise exception 'La entrega de EPP la anota SSOMA.' using errcode = 'insufficient_privilege';
  end if;
  if p_envio is null or p_movimiento is null then
    raise exception 'Vuelve a abrir la ventana de la entrega.' using errcode = 'check_violation';
  end if;
  -- De a uno por salida: dos repartos a la vez no asignan más de lo que salió, y el
  -- reintento que llega con el primero todavía en camino espera aquí y lo encuentra.
  perform pg_advisory_xact_lock(hashtext('ssoma_epp:' || p_movimiento::text));
  select e.creado_por into v_de from public.ssoma_epp_entregas e where e.envio_id = p_envio limit 1;
  if found then
    if v_de is distinct from v_yo then
      raise exception 'Vuelve a abrir la ventana de la entrega.' using errcode = 'check_violation';
    end if;
    if public.mismo_envio(p_envio, 'EPP_SSOMA', v_envio) then return p_envio; end if;
    -- Dice a quiénes quedó: la ventana sigue con lo que se marcó después, que no entró.
    select string_agg(btrim(t.apellidos || ' ' || t.nombres)
                        || case when e.cantidad <> 1 then ' (' || public.ssoma_cantidad_en_texto(e.cantidad) || ')' else '' end,
                      ', ' order by t.apellidos, t.nombres)
      into v_nombres
      from public.ssoma_epp_entregas e join public.trabajadores t on t.id = e.trabajador_id
     where e.envio_id = p_envio;
    raise exception 'Esa entrega ya quedó anotada la primera vez que la enviaste, a %: lo que cambiaste después no se guardó.', v_nombres
      using errcode = 'check_violation';
  end if;

  select k.id, k.tipo, k.material_id, k.cantidad::numeric as cantidad, k.numero_salida,
         (k.registrado_en at time zone 'America/Lima')::date as fecha,
         public.almacen_de_material(k.material_id) as almacen
    into v_mov
    from public.movimientos_materiales k where k.id = p_movimiento;
  if not found or v_mov.tipo <> 'SALIDA' or v_mov.almacen is distinct from 'EPP' then
    raise exception 'Esa salida de Almacén no es de EPP: vuelve a cargar la pantalla.' using errcode = 'check_violation';
  end if;
  v_salida := coalesce('la salida ' || v_mov.numero_salida, 'esa salida') || ' del ' || public.ssoma_dia(v_mov.fecha);
  if exists (select 1 from public.ssoma_epp_sin_reparto x where x.movimiento_id = p_movimiento and x.deshecho_en is null) then
    raise exception 'De % se dijo que lo que queda no va por persona: toca «Repartir» en la salida y vuelve a anotar.', v_salida
      using errcode = 'check_violation';
  end if;

  if p_renovar_el is null or p_renovar_el <= v_mov.fecha then
    raise exception 'La fecha de renovación tiene que ser posterior al día de la entrega (%).', public.ssoma_dia(v_mov.fecha)
      using errcode = 'check_violation';
  end if;
  if p_renovar_el > v_mov.fecha + 1826 then
    raise exception 'La fecha de renovación va hasta cinco años después de la entrega.' using errcode = 'check_violation';
  end if;

  if jsonb_typeof(v_personas) <> 'array' or jsonb_array_length(v_personas) = 0 then
    raise exception 'Elige a quién se le entregó.' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(v_personas) > 200 then
    raise exception 'Van hasta 200 personas por entrega.' using errcode = 'check_violation';
  end if;
  begin
    select array_agg((x ->> 'trabajador')::uuid order by n), array_agg(coalesce((x ->> 'cantidad')::numeric, 1) order by n)
      into v_ids, v_cants
      from jsonb_array_elements(v_personas) with ordinality as t(x, n);
  exception when data_exception then
    raise exception 'Vuelve a elegir a las personas de la entrega.' using errcode = 'check_violation';
  end;
  if array_position(v_ids, null) is not null
     or (select count(distinct x) from unnest(v_ids) as x) <> cardinality(v_ids) then
    raise exception 'Vuelve a elegir a las personas de la entrega: cada una va una sola vez.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from unnest(v_cants) as c where c <= 0 or c > 999 or c <> round(c, 3)) then
    raise exception 'La cantidad de cada persona va de 0.001 a 999.' using errcode = 'check_violation';
  end if;

  -- Solo quien estaba en la planta el día de la salida, según RR. HH. Se dice quiénes, todos de una vez.
  select string_agg(coalesce(btrim(t.apellidos || ' ' || t.nombres), 'Alguien de la lista'), ', '
                    order by t.apellidos nulls last, t.nombres),
         count(*)
    into v_nombres, v_n
    from unnest(v_ids) as x left join public.trabajadores t on t.id = x
   where t.id is null
      or not public.ssoma_estuvo_en_la_planta(t.id, t.activo, t.fecha_ingreso, t.fecha_baja, v_mov.fecha, v_mov.fecha + 1);
  if v_n > 0 then
    raise exception '% %, según RR. HH.: %.', v_nombres,
      case when v_n = 1 then 'no estaba en la planta el ' else 'no estaban en la planta el ' end || public.ssoma_dia(v_mov.fecha),
      case when v_n = 1 then 'quita su nombre y vuelve a anotar' else 'quita sus nombres y vuelve a anotar' end
      using errcode = 'check_violation';
  end if;

  -- Una persona, una vez por salida: la cantidad dice cuánto se llevó.
  select string_agg(btrim(t.apellidos || ' ' || t.nombres), ', ' order by t.apellidos, t.nombres), count(*)
    into v_nombres, v_n
    from public.ssoma_epp_entregas e join public.trabajadores t on t.id = e.trabajador_id
   where e.movimiento_id = p_movimiento and e.anulado_en is null and e.trabajador_id = any (v_ids);
  if v_n > 0 then
    raise exception '% ya % de %: %.', v_nombres,
      case when v_n = 1 then 'tiene anotada su entrega' else 'tienen anotada su entrega' end, v_salida,
      case when v_n = 1 then 'quita su nombre de la lista' else 'quita sus nombres de la lista' end
      using errcode = 'check_violation';
  end if;

  -- No se reparte más de lo que salió y no volvió.
  select sum(c) into v_total from unnest(v_cants) as c;
  v_queda := v_mov.cantidad
    - coalesce((select sum(d.cantidad::numeric) from public.movimientos_materiales d
                 where d.devolucion_de = p_movimiento and d.tipo = 'INGRESO' and d.origen = 'DEVOLUCION'), 0)
    - coalesce((select sum(e.cantidad) from public.ssoma_epp_entregas e
                 where e.movimiento_id = p_movimiento and e.anulado_en is null), 0);
  if v_total > v_queda then
    raise exception 'De % % y anotaste %. Revisa las cantidades.', v_salida,
      case when v_queda <= 0 then 'ya no queda nada por asignar'
           when v_queda = 1 then 'queda 1 por asignar'
           else 'quedan ' || public.ssoma_cantidad_en_texto(v_queda) || ' por asignar' end,
      public.ssoma_cantidad_en_texto(v_total)
      using errcode = 'check_violation';
  end if;

  insert into public.ssoma_epp_entregas (envio_id, movimiento_id, material_id, trabajador_id, cantidad, entregado_el, renovar_el, creado_por)
  select p_envio, p_movimiento, v_mov.material_id, v_ids[i], v_cants[i], v_mov.fecha, p_renovar_el, v_yo
    from generate_subscripts(v_ids, 1) as i;

  perform public.anotar_envio(p_envio, 'EPP_SSOMA', v_envio);
  return p_envio;
end;
$$;
comment on function public.ssoma_registrar_entregas_epp(uuid, uuid, date, jsonb) is
  'SSOMA anota a quién de RR. HH. se le entregó el equipo de una salida del almacén de EPP, cuánto a cada uno y hasta cuándo dura. No reparte más de lo que salió y no volvió. No cambia el kardex. Exige ssoma.gestionar.';
revoke all on function public.ssoma_registrar_entregas_epp(uuid, uuid, date, jsonb) from public, anon;
grant execute on function public.ssoma_registrar_entregas_epp(uuid, uuid, date, jsonb) to authenticated;

-- 8. Anular, y sacar de «Por renovar» ---------------------------------------------------------------
create or replace function public.ssoma_anular_entrega_epp(p_id uuid, p_motivo text)
returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo     uuid := public.usuario_actual();
  v_e      public.ssoma_epp_entregas%rowtype;
  v_motivo text := btrim(coalesce(p_motivo, ''));
begin
  if v_yo is null or not (public.es_admin() or public.tiene_permiso('ssoma.gestionar')) then
    raise exception 'Una entrega de EPP la anula SSOMA.' using errcode = 'insufficient_privilege';
  end if;
  if char_length(v_motivo) not between 10 and 500 then
    raise exception 'Cuenta por qué se anula, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_e from public.ssoma_epp_entregas where id = p_id for update;
  if not found then raise exception 'Esa entrega no existe.' using errcode = 'check_violation'; end if;
  if v_e.anulado_en is not null then
    -- El mismo pedido repetido de la misma persona (se perdió la respuesta) entra; otro no se finge.
    if v_e.anulado_por is distinct from v_yo then
      raise exception 'Esta entrega ya estaba anulada, con este motivo: «%». No se cambia.', v_e.motivo_anulacion
        using errcode = 'check_violation';
    end if;
    if v_e.motivo_anulacion = v_motivo then return p_id; end if;
    raise exception 'Esta entrega ya quedó anulada la primera vez que la enviaste, con este motivo: «%». El motivo nuevo no se guardó.', v_e.motivo_anulacion
      using errcode = 'check_violation';
  end if;
  update public.ssoma_epp_entregas set motivo_anulacion = v_motivo, anulado_por = v_yo, anulado_en = now() where id = p_id;
  return p_id;
end;
$$;
comment on function public.ssoma_anular_entrega_epp(uuid, text) is
  'SSOMA anula una entrega de EPP mal anotada con su motivo (no se borra): lo asignado vuelve a quedar por asignar en su salida. Exige ssoma.gestionar.';
revoke all on function public.ssoma_anular_entrega_epp(uuid, text) from public, anon;
grant execute on function public.ssoma_anular_entrega_epp(uuid, text) to authenticated;

create or replace function public.ssoma_epp_no_se_renueva(p_id uuid, p_motivo text)
returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo     uuid := public.usuario_actual();
  v_e      public.ssoma_epp_entregas%rowtype;
  v_motivo text := btrim(coalesce(p_motivo, ''));
begin
  if v_yo is null or not (public.es_admin() or public.tiene_permiso('ssoma.gestionar')) then
    raise exception 'Lo que se renueva de EPP lo lleva SSOMA.' using errcode = 'insufficient_privilege';
  end if;
  if char_length(v_motivo) not between 5 and 300 then
    raise exception 'Cuenta por qué ya no se renueva, en 5 a 300 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_e from public.ssoma_epp_entregas where id = p_id for update;
  if not found then raise exception 'Esa entrega no existe.' using errcode = 'check_violation'; end if;
  if v_e.anulado_en is not null then
    raise exception 'Esa entrega está anulada: ya no cuenta para renovar.' using errcode = 'check_violation';
  end if;
  if v_e.sin_renovacion_en is not null then
    if v_e.sin_renovacion_por is distinct from v_yo then
      raise exception 'Esa entrega ya estaba fuera de «Por renovar», con este motivo: «%». No se cambia.', v_e.motivo_sin_renovacion
        using errcode = 'check_violation';
    end if;
    if v_e.motivo_sin_renovacion = v_motivo then return p_id; end if;
    raise exception 'Esa entrega ya quedó fuera de «Por renovar» la primera vez que lo enviaste, con este motivo: «%». El motivo nuevo no se guardó.', v_e.motivo_sin_renovacion
      using errcode = 'check_violation';
  end if;
  if public.ssoma_epp_estado(v_e.id, v_e.trabajador_id, v_e.material_id, v_e.entregado_el, v_e.creado_en, v_e.anulado_en, v_e.sin_renovacion_en) = 'RENOVADA' then
    raise exception 'A esa persona ya se le entregó otro igual después: esta entrega ya no está por renovar.' using errcode = 'check_violation';
  end if;
  update public.ssoma_epp_entregas set motivo_sin_renovacion = v_motivo, sin_renovacion_por = v_yo, sin_renovacion_en = now() where id = p_id;
  return p_id;
end;
$$;
comment on function public.ssoma_epp_no_se_renueva(uuid, text) is
  'SSOMA saca una entrega vigente de «Por renovar» con su motivo: ese equipo ya no se le va a reponer a la persona. La entrega sigue contando en su salida. Exige ssoma.gestionar.';
revoke all on function public.ssoma_epp_no_se_renueva(uuid, text) from public, anon;
grant execute on function public.ssoma_epp_no_se_renueva(uuid, text) to authenticated;

-- 8b. Lo que queda de una salida no va por persona, y deshacerlo ----------------------------------
create or replace function public.ssoma_epp_salida_sin_reparto(p_movimiento uuid, p_motivo text)
returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo     uuid := public.usuario_actual();
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_mov    record;
  v_x      public.ssoma_epp_sin_reparto%rowtype;
  v_queda  numeric;
  v_id     uuid;
begin
  if v_yo is null or not (public.es_admin() or public.tiene_permiso('ssoma.gestionar')) then
    raise exception 'Qué se reparte del EPP lo lleva SSOMA.' using errcode = 'insufficient_privilege';
  end if;
  if char_length(v_motivo) not between 5 and 300 then
    raise exception 'Cuenta por qué no va por persona, en 5 a 300 caracteres.' using errcode = 'check_violation';
  end if;
  if p_movimiento is null then
    raise exception 'Vuelve a cargar la pantalla.' using errcode = 'check_violation';
  end if;
  -- El mismo candado que anotar entregas: no se cruza con un reparto en camino.
  perform pg_advisory_xact_lock(hashtext('ssoma_epp:' || p_movimiento::text));
  select * into v_x from public.ssoma_epp_sin_reparto where movimiento_id = p_movimiento and deshecho_en is null;
  if found then
    -- El mismo pedido repetido de la misma persona (se perdió la respuesta) entra; otro no se finge.
    if v_x.creado_por = v_yo and v_x.motivo = v_motivo then return v_x.id; end if;
    if v_x.creado_por = v_yo then
      raise exception 'Eso ya quedó dicho la primera vez que lo enviaste, con este motivo: «%». El motivo nuevo no se guardó.', v_x.motivo
        using errcode = 'check_violation';
    end if;
    raise exception 'De esa salida ya se dijo que lo que queda no va por persona, con este motivo: «%». No se cambia: deshazlo y dilo otra vez.', v_x.motivo
      using errcode = 'check_violation';
  end if;

  select k.id, k.tipo, k.cantidad::numeric as cantidad, public.almacen_de_material(k.material_id) as almacen
    into v_mov from public.movimientos_materiales k where k.id = p_movimiento;
  if not found or v_mov.tipo <> 'SALIDA' or v_mov.almacen is distinct from 'EPP' then
    raise exception 'Esa salida de Almacén no es de EPP: vuelve a cargar la pantalla.' using errcode = 'check_violation';
  end if;
  v_queda := v_mov.cantidad
    - coalesce((select sum(d.cantidad::numeric) from public.movimientos_materiales d
                 where d.devolucion_de = p_movimiento and d.tipo = 'INGRESO' and d.origen = 'DEVOLUCION'), 0)
    - coalesce((select sum(e.cantidad) from public.ssoma_epp_entregas e
                 where e.movimiento_id = p_movimiento and e.anulado_en is null), 0);
  if v_queda <= 0 then
    raise exception 'De esa salida ya no queda nada por asignar.' using errcode = 'check_violation';
  end if;

  insert into public.ssoma_epp_sin_reparto (movimiento_id, motivo, creado_por) values (p_movimiento, v_motivo, v_yo) returning id into v_id;
  return v_id;
end;
$$;
comment on function public.ssoma_epp_salida_sin_reparto(uuid, text) is
  'SSOMA dice, con su motivo, que lo que queda por asignar de una salida del almacén de EPP no se reparte por persona: deja de esperar en su lista. No cambia la salida. Exige ssoma.gestionar.';
revoke all on function public.ssoma_epp_salida_sin_reparto(uuid, text) from public, anon;
grant execute on function public.ssoma_epp_salida_sin_reparto(uuid, text) to authenticated;

create or replace function public.ssoma_epp_salida_se_reparte(p_movimiento uuid)
returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo uuid := public.usuario_actual();
begin
  if v_yo is null or not (public.es_admin() or public.tiene_permiso('ssoma.gestionar')) then
    raise exception 'Qué se reparte del EPP lo lleva SSOMA.' using errcode = 'insufficient_privilege';
  end if;
  if p_movimiento is null then
    raise exception 'Vuelve a cargar la pantalla.' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.movimientos_materiales k
                  where k.id = p_movimiento and k.tipo = 'SALIDA' and public.almacen_de_material(k.material_id) = 'EPP') then
    raise exception 'Esa salida de Almacén no es de EPP: vuelve a cargar la pantalla.' using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(hashtext('ssoma_epp:' || p_movimiento::text));
  -- Si ya estaba deshecho no hay nada que cambiar: la salida ya espera su reparto, que es lo que se pidió.
  update public.ssoma_epp_sin_reparto set deshecho_por = v_yo, deshecho_en = now()
   where movimiento_id = p_movimiento and deshecho_en is null;
  return p_movimiento;
end;
$$;
comment on function public.ssoma_epp_salida_se_reparte(uuid) is
  'SSOMA deshace «no va por persona» de una salida del almacén de EPP: vuelve a esperar que se anote a quién le tocó. Queda quién lo deshizo y cuándo. Exige ssoma.gestionar.';
revoke all on function public.ssoma_epp_salida_se_reparte(uuid) from public, anon;
grant execute on function public.ssoma_epp_salida_se_reparte(uuid) to authenticated;

-- 9. Lo que se lee ----------------------------------------------------------------------------------
-- Las entregas: las de una persona, las de una salida o las que están por renovar
-- (vigentes, de gente que sigue en la planta, vencidas o por vencer en 15 días).
create or replace function public.ssoma_epp_entregas_a_la_vista(p_trabajador uuid, p_movimiento uuid, p_por_renovar boolean)
returns table (
  id uuid, trabajador_id uuid, persona text, cargo text, area text, en_planta boolean,
  movimiento_id uuid, numero_salida text, material_id uuid, material text, unidad text, cantidad numeric,
  entregado_el date, renovar_el date, estado text, situacion text, dias integer,
  registro text, creado_en timestamptz,
  sin_renovacion_en timestamptz, saco_de_renovar text, motivo_sin_renovacion text,
  anulado_en timestamptz, anulo text, motivo_anulacion text)
language sql stable security definer set search_path to 'public' rows 100 as $$
  with e as (
    select x.*,
           public.ssoma_epp_estado(x.id, x.trabajador_id, x.material_id, x.entregado_el, x.creado_en, x.anulado_en, x.sin_renovacion_en) as estado
      from public.ssoma_epp_entregas x
     where public.puede_ver_reportes_ssoma()
       and (p_trabajador is null or x.trabajador_id = p_trabajador)
       and (p_movimiento is null or x.movimiento_id = p_movimiento)
  )
  select e.id, e.trabajador_id, btrim(t.apellidos || ' ' || t.nombres), t.cargo, a.nombre, t.activo,
         e.movimiento_id, k.numero_salida, e.material_id, m.descripcion, u.codigo, e.cantidad,
         e.entregado_el, e.renovar_el, e.estado,
         case when e.estado <> 'VIGENTE' then null
              when e.renovar_el < public.ssoma_hoy() then 'VENCIDA'
              when e.renovar_el <= public.ssoma_hoy() + public.ssoma_epp_dias_de_aviso() then 'POR_VENCER'
              else 'AL_DIA' end,
         (e.renovar_el - public.ssoma_hoy())::integer,
         public.ssoma_nombre_de(e.creado_por), e.creado_en,
         e.sin_renovacion_en, public.ssoma_nombre_de(e.sin_renovacion_por), e.motivo_sin_renovacion,
         e.anulado_en, public.ssoma_nombre_de(e.anulado_por), e.motivo_anulacion
    from e
    join public.trabajadores t on t.id = e.trabajador_id
    left join public.areas a on a.id = t.area_id
    join public.materiales m on m.id = e.material_id
    left join public.unidades_medida u on u.id = m.unidad_medida_id
    join public.movimientos_materiales k on k.id = e.movimiento_id
   where not coalesce(p_por_renovar, false)
      or (e.estado = 'VIGENTE' and t.activo and e.renovar_el <= public.ssoma_hoy() + public.ssoma_epp_dias_de_aviso())
   order by case when coalesce(p_por_renovar, false) then e.renovar_el end,
            e.entregado_el desc, t.apellidos, t.nombres, e.creado_en desc, e.id;
$$;
comment on function public.ssoma_epp_entregas_a_la_vista(uuid, uuid, boolean) is
  'Las entregas de EPP que ven SSOMA y Gerencia: las de una persona, las de una salida de Almacén o las que están por renovar (vigentes, de quien sigue en la planta, vencidas o por vencer en 15 días), con su estado. De la persona, solo nombre, cargo y área.';
revoke all on function public.ssoma_epp_entregas_a_la_vista(uuid, uuid, boolean) from public, anon;
grant execute on function public.ssoma_epp_entregas_a_la_vista(uuid, uuid, boolean) to authenticated;

-- Cada persona con lo que tiene: cuántos equipos vigentes, cuántos vencidos o por
-- vencer y cuándo le toca el próximo. Sin persona, las que están en la planta.
create or replace function public.ssoma_epp_por_persona(p_trabajador uuid)
returns table (
  id uuid, persona text, cargo text, area text, en_planta boolean,
  vigentes integer, vencidas integer, por_vencer integer, proxima date)
language sql stable security definer set search_path to 'public' rows 200 as $$
  select t.id, btrim(t.apellidos || ' ' || t.nombres), t.cargo, a.nombre, t.activo,
         (count(*) filter (where v.estado = 'VIGENTE'))::integer,
         (count(*) filter (where v.estado = 'VIGENTE' and v.renovar_el < public.ssoma_hoy()))::integer,
         (count(*) filter (where v.estado = 'VIGENTE' and v.renovar_el >= public.ssoma_hoy()
                             and v.renovar_el <= public.ssoma_hoy() + public.ssoma_epp_dias_de_aviso()))::integer,
         min(v.renovar_el) filter (where v.estado = 'VIGENTE')
    from public.trabajadores t
    left join public.areas a on a.id = t.area_id
    left join lateral (
      select e.renovar_el,
             public.ssoma_epp_estado(e.id, e.trabajador_id, e.material_id, e.entregado_el, e.creado_en, e.anulado_en, e.sin_renovacion_en) as estado
        from public.ssoma_epp_entregas e
       where e.trabajador_id = t.id) v on true
   where public.puede_ver_reportes_ssoma()
     and case when p_trabajador is null then t.activo else t.id = p_trabajador end
   group by t.id, t.apellidos, t.nombres, t.cargo, a.nombre, t.activo
   order by a.nombre nulls last, t.apellidos, t.nombres;
$$;
comment on function public.ssoma_epp_por_persona(uuid) is
  'El personal de RR. HH. en la planta (o una persona) con su EPP: cuántos equipos vigentes, cuántos vencidos o por vencer en 15 días y cuándo le toca el próximo. Solo nombre, cargo y área. La ven SSOMA y Gerencia.';
revoke all on function public.ssoma_epp_por_persona(uuid) from public, anon;
grant execute on function public.ssoma_epp_por_persona(uuid) to authenticated;

-- 10. Lo que espera por SSOMA, para sus pendientes y el encabezado de su pantalla -------------------
-- Lo mismo que cuenta la pantalla: las salidas con equipo por asignar que no se
-- marcaron «no va por persona», lo vencido y todo lo que está por renovar de quien
-- sigue en la planta. Cuenta por su cuenta, sin armar la lista de salidas: corre
-- en cada pantalla de SSOMA (sus pendientes van en el marco), y por la lista
-- costaba un segundo con 400 salidas por anotar. El check 493 las compara.
create or replace function public.ssoma_epp_por_atender()
returns table (por_asignar integer, vencidos integer, por_renovar integer)
language plpgsql stable security definer set search_path to 'public' rows 1 as $$
declare
  v_hoy     constant date := public.ssoma_hoy();
  v_salidas integer;
  v_vencen  integer;
  v_renovar integer;
begin
  if not public.puede_ver_reportes_ssoma() then
    return query select 0, 0, 0;
    return;
  end if;
  select count(*) into v_salidas
    from public.movimientos_materiales k
    join public.materiales m on m.id = k.material_id
    join public.categorias_material c on c.id = m.categoria_id
   where k.tipo = 'SALIDA' and c.almacen = 'EPP'
     and (k.registrado_en at time zone 'America/Lima')::date >= v_hoy - 180
     and not exists (select 1 from public.ssoma_epp_sin_reparto x where x.movimiento_id = k.id and x.deshecho_en is null)
     and k.cantidad::numeric
         - coalesce((select sum(d.cantidad::numeric) from public.movimientos_materiales d
                      where d.devolucion_de = k.id and d.tipo = 'INGRESO' and d.origen = 'DEVOLUCION'), 0)
         - coalesce((select sum(e.cantidad) from public.ssoma_epp_entregas e
                      where e.movimiento_id = k.id and e.anulado_en is null), 0) > 0;
  select count(*) filter (where x.renovar_el < v_hoy), count(*) into v_vencen, v_renovar
    from public.ssoma_epp_entregas x
    join public.trabajadores t on t.id = x.trabajador_id
   where t.activo and x.anulado_en is null and x.sin_renovacion_en is null
     and x.renovar_el <= v_hoy + public.ssoma_epp_dias_de_aviso()
     and public.ssoma_epp_estado(x.id, x.trabajador_id, x.material_id, x.entregado_el, x.creado_en, x.anulado_en, x.sin_renovacion_en) = 'VIGENTE';
  return query select v_salidas, v_vencen, v_renovar;
end;
$$;
comment on function public.ssoma_epp_por_atender() is
  'Cuántas salidas del almacén de EPP esperan que se anote a quién le tocó, cuántos equipos vigentes ya vencieron y cuántos están por renovar (vencidos o por vencer en 15 días), de quien sigue en la planta. Solo para SSOMA y Gerencia; a los demás, ceros.';
revoke all on function public.ssoma_epp_por_atender() from public, anon;
grant execute on function public.ssoma_epp_por_atender() to authenticated;
