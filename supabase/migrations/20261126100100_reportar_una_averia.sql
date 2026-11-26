-- =============================================================================
-- REPORTAR UNA AVERÍA
-- -----------------------------------------------------------------------------
-- DKS, 2026-11-25, Plan 16 (Mantenimiento de equipos), entrega 16.2: «Reportar
-- avería» en el menú de todos los puestos. Quien ve que una máquina falla, o
-- que está por fallar, lo dice en el momento desde su teléfono, y Mantenimiento
-- se entera sin que nadie vaya a buscarlo. Lo que nace aquí:
--
--   * EL REPORTE DE AVERÍA (AV-0001-2026, aprobado por DKS el 2026-11-26): el
--     equipo del padrón (16.1), si es una avería o una posible avería, si
--     detiene el trabajo, si es un riesgo para las personas, qué pasa y hasta
--     cuatro fotos en un bucket privado. LO REPORTA CUALQUIER CUENTA ACTIVA:
--     reportar no pide permiso.
--   * LA AVERÍA QUE DETIENE EL TRABAJO PONE EL EQUIPO EN «PARADO», con el
--     número del reporte en su nota. La posible avería no cambia su estado.
--     Si el reporte se anula y el equipo sigue parado por él, vuelve a como
--     estaba.
--   * LOS AVISOS POR LA CAMPANA: a Mantenimiento y al responsable del área del
--     equipo (`areas.jefe_id`, la cuenta que asigna el administrador). La que
--     es un riesgo para las personas, también a SSOMA. Si no hay una cuenta
--     activa de Mantenimiento, o la de riesgo no tiene SSOMA que la reciba,
--     le llega a Gerencia: un aviso no puede perderse en el aire. La pantalla
--     dice a quién llegó, nunca «ya le avisamos» si no llegó.
--   * EL MISMO ENVÍO REPETIDO NO ENTRA DOS VECES: el reintento con el mismo id
--     y lo mismo devuelve el reporte que ya entró (`mismo_envio`).
--   * QUIÉN VE QUÉ (DKS: «cada persona ve los reportes que hizo y los de su
--     área; Mantenimiento ve y atiende todos; Gerencia consulta»): la tabla se
--     lee con `averias.atender` (Mantenimiento) o `averias.ver` (Gerencia), o
--     siendo quien la reportó, o trabajando en el área del equipo.
--   * NO SE BORRA: Mantenimiento la anula con su motivo, y queda como
--     evidencia. La atención (diagnóstico, trabajo hecho, repuestos, cierre)
--     es la entrega 16.3.
--
-- Las tablas se escriben solo por las funciones de abajo. Sin DROP: el conector
-- de producción no deja pasar ninguno.
-- =============================================================================

-- 1. Permisos -------------------------------------------------------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('averias.atender', 'Mantenimiento',
   'Atender los reportes de avería: recibir el aviso de cada uno, verlos todos y anularlos con su motivo'),
  ('averias.ver', 'Mantenimiento',
   'Consultar todos los reportes de avería de la planta')
on conflict (codigo) do nothing;

-- Reportar no lleva permiso: lo hace cualquier cuenta activa.
insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, p.codigo from public.roles r cross join public.permisos p
 where (r.codigo = 'MANTENIMIENTO' and p.codigo = 'averias.atender')
    or (r.codigo = 'GERENTE' and p.codigo = 'averias.ver')
on conflict do nothing;

-- 2. La serie del reporte -------------------------------------------------------------
insert into public.series_documentarias (tipo, serie, prefijo, correlativo_actual, longitud, formato)
select 'REPORTE_AVERIA', '001', 'AV', 0, 4, 'AV-{numero}-{anio}'
 where not exists (select 1 from public.series_documentarias where tipo = 'REPORTE_AVERIA' and serie = '001');

-- 3. El reporte -----------------------------------------------------------------------
create table if not exists public.averias (
  id                    uuid primary key default gen_random_uuid(),
  numero                text not null,
  -- El historial de cada equipo (16.4) se lee por aquí (b).
  equipo_id             uuid not null references public.equipos(id) on delete restrict,
  tipo                  text not null,
  detiene_trabajo       boolean not null default false,
  riesgo_personas       boolean not null,
  descripcion           text not null,
  -- El área del equipo al reportarla: «los de tu área» filtran por ella (b).
  -- Queda congelada: si el equipo cambia de área, el reporte sigue siendo de
  -- la que tenía cuando falló.
  area_id               uuid references public.areas(id) on delete restrict,
  estado                text not null default 'REPORTADA',
  -- Si este reporte dejó el equipo parado, cómo estaba antes y desde cuándo
  -- quedó parado: al anularlo, vuelve a como estaba solo si sigue parado por él.
  paro_el_equipo        boolean not null default false,
  equipo_estado_antes   text,
  equipo_nota_antes     text,
  equipo_parado_desde   timestamptz,
  registrado_por        uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  anulado_por           uuid references public.usuarios(id) on delete restrict,
  anulado_en            timestamptz,
  motivo_anulacion      text,
  creado_en             timestamptz not null default now(),
  actualizado_en        timestamptz not null default now(),
  constraint uq_averias_numero unique (numero),
  constraint ck_averias_datos check (
    tipo in ('AVERIA', 'POSIBLE_AVERIA')
    -- Una posible avería no detiene el trabajo: si ya lo detiene, es una avería.
    and (tipo = 'AVERIA' or not detiene_trabajo)
    and char_length(btrim(descripcion)) between 10 and 2000),
  constraint ck_averias_paro check (
    (not paro_el_equipo and equipo_estado_antes is null and equipo_nota_antes is null and equipo_parado_desde is null)
    or (paro_el_equipo and detiene_trabajo and equipo_estado_antes in ('OPERATIVO', 'CON_OBSERVACION') and equipo_parado_desde is not null)),
  constraint ck_averias_estado check (
    (estado = 'REPORTADA' and anulado_en is null and anulado_por is null and motivo_anulacion is null)
    or (estado = 'ANULADA' and anulado_en is not null and anulado_por is not null
        and char_length(btrim(coalesce(motivo_anulacion, ''))) between 10 and 500))
);
comment on table public.averias is
  'El reporte de una avería o una posible avería de un equipo del padrón (AV-…), que hace cualquier cuenta. Lo ven Mantenimiento (averias.atender), Gerencia (averias.ver), quien lo reportó y quien trabaja en el área del equipo. No se borra: Mantenimiento lo anula con su motivo.';
comment on column public.averias.area_id is
  'El área del equipo cuando se reportó, congelada. «Los de tu área» filtran por ella.';
comment on column public.averias.paro_el_equipo is
  'Si este reporte dejó el equipo en PARADO. Con equipo_estado_antes, equipo_nota_antes y equipo_parado_desde, la anulación lo devuelve a como estaba si sigue parado por él.';
-- La lista se lee de la más reciente a la más vieja (b).
create index if not exists ix_averias_creado on public.averias (creado_en desc);
-- «Los de tu área», «tus reportes» y el historial del equipo (b); sirven también a sus llaves.
create index if not exists ix_averias_area on public.averias (area_id);
create index if not exists ix_averias_autor on public.averias (registrado_por);
create index if not exists ix_averias_equipo on public.averias (equipo_id, creado_en desc);
select public.activar_timestamps('averias');
select public.activar_auditoria('averias');
select public.activar_registro_de_prueba('averias');

-- 4. Sus fotos ------------------------------------------------------------------------
create table if not exists public.averia_fotos (
  id              uuid primary key default gen_random_uuid(),
  averia_id       uuid not null,
  orden           smallint not null,
  ruta            text not null,
  mime_type       text not null,
  tamano_bytes    integer not null,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  constraint averia_fotos_averia_id_fkey foreign key (averia_id) references public.averias(id) on delete restrict,
  -- También es el índice de la llave hacia el reporte.
  constraint uq_averia_foto_orden unique (averia_id, orden),
  -- Una foto, un reporte; y la política de Storage la busca por su ruta.
  constraint uq_averia_foto_ruta unique (ruta),
  constraint ck_averia_foto check (
    orden between 1 and 4
    and mime_type in ('image/jpeg', 'image/png', 'image/webp')
    and tamano_bytes between 1 and 5242880)
);
comment on table public.averia_fotos is
  'Hasta 4 fotos de un reporte de avería, en el bucket privado fotos-averias con la ruta {cuenta}/{averia}/…. Las ve quien ve el reporte. No se cambian ni se borran.';
select public.activar_timestamps('averia_fotos');
select public.activar_registro_de_prueba('averia_fotos');

-- 5. Lo que no se borra ni se corrige por debajo ---------------------------------------
create or replace function public.fn_averia_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
declare
  v_cambian constant text[] := array['estado', 'anulado_por', 'anulado_en', 'motivo_anulacion', 'actualizado_en'];
  v_paro    constant text[] := array['paro_el_equipo', 'equipo_estado_antes', 'equipo_nota_antes', 'equipo_parado_desde'];
begin
  if tg_op = 'DELETE' then
    raise exception 'Un reporte de avería no se borra: Mantenimiento lo anula con su motivo.' using errcode = 'check_violation';
  end if;
  if old.estado = 'ANULADA' then
    raise exception 'El reporte % está anulado: queda como evidencia.', old.numero using errcode = 'check_violation';
  end if;
  if (to_jsonb(new) - v_cambian) is distinct from (to_jsonb(old) - v_cambian)
     -- Lo único que cambia sin anular: `averias_anular` le pasa el paro del equipo
     -- al otro reporte vigente que dice que detiene el trabajo, y solo a ese.
     and not (coalesce(current_setting('averias.traspaso_del_paro', true), '') = old.id::text
              and old.estado = 'REPORTADA' and not old.paro_el_equipo and new.paro_el_equipo
              and (to_jsonb(new) - v_cambian - v_paro) = (to_jsonb(old) - v_cambian - v_paro)) then
    raise exception 'Lo que dice el reporte % no se corrige: si está mal, Mantenimiento lo anula con su motivo y se reporta de nuevo.', old.numero
      using errcode = 'check_violation';
  end if;
  -- La anulación se sella aquí y no solo en la función que anula: quién y cuándo
  -- los pone la base, y sin motivo no entra, venga de donde venga el UPDATE.
  if new.estado = 'ANULADA' then
    if char_length(btrim(coalesce(new.motivo_anulacion, ''))) < 10 then
      raise exception 'Para anular el reporte % escribe el motivo (al menos 10 letras).', old.numero using errcode = 'check_violation';
    end if;
    new.motivo_anulacion := btrim(new.motivo_anulacion);
    new.anulado_por := coalesce(public.usuario_actual(), new.anulado_por);
    new.anulado_en := now();
  elsif (new.anulado_por, new.anulado_en, new.motivo_anulacion) is distinct from (old.anulado_por, old.anulado_en, old.motivo_anulacion) then
    raise exception 'El reporte % no está anulado: quién, cuándo y el motivo se anotan solo al anularlo.', old.numero using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_averia_guardia() from public, anon, authenticated;
create or replace trigger trg_averia_guardia
  before update or delete on public.averias
  for each row execute function public.fn_averia_guardia();

create or replace function public.fn_averia_foto_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  raise exception 'Las fotos de un reporte de avería no se cambian ni se borran: quedan como evidencia.'
    using errcode = 'check_violation';
end;
$$;
revoke all on function public.fn_averia_foto_guardia() from public, anon, authenticated;
create or replace trigger trg_averia_foto_guardia
  before update or delete on public.averia_fotos
  for each row execute function public.fn_averia_foto_guardia();

-- 6. Quién ve qué -----------------------------------------------------------------------
create or replace function public.puede_ver_todas_las_averias()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.es_admin() or public.tiene_permiso('averias.atender') or public.tiene_permiso('averias.ver');
$$;
revoke all on function public.puede_ver_todas_las_averias() from public, anon;
grant execute on function public.puede_ver_todas_las_averias() to authenticated;

-- Las áreas de quien pregunta, para «los de tu área»: la suya y las que tiene a
-- cargo como responsable (`areas.jefe_id`), que puede ser de otra área. El aviso
-- le llega al responsable: tiene que poder abrir lo que le llegó. Una cuenta
-- dada de baja no tiene ninguna.
create or replace function public.averias_areas_de_la_cuenta()
returns uuid[] language sql stable security definer set search_path to 'public' as $$
  select coalesce(array_agg(x.id), '{}')
    from (select u.area_id as id from public.usuarios u
           where u.id = public.usuario_actual() and u.activo and u.area_id is not null
          union
          select a.id from public.areas a
            join public.usuarios u on u.id = a.jefe_id and u.activo
           where a.jefe_id = public.usuario_actual() and a.activo) x;
$$;
revoke all on function public.averias_areas_de_la_cuenta() from public, anon;
grant execute on function public.averias_areas_de_la_cuenta() to authenticated;

-- SSOMA recibe la avería que es un riesgo para las personas: la abre, sin ver las demás.
create or replace function public.averias_ve_las_de_riesgo()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.tiene_permiso('ssoma.gestionar');
$$;
revoke all on function public.averias_ve_las_de_riesgo() from public, anon;
grant execute on function public.averias_ve_las_de_riesgo() to authenticated;

alter table public.averias enable row level security;
alter table public.averia_fotos enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'averias' and policyname = 'ver_averias') then
    create policy ver_averias on public.averias for select to authenticated
      using ((select public.puede_ver_todas_las_averias())
             or registrado_por = (select public.usuario_actual())
             or area_id = any((select public.averias_areas_de_la_cuenta())::uuid[])
             or (riesgo_personas and (select public.averias_ve_las_de_riesgo())));
  end if;
  -- Quien ve el reporte ve sus fotos: la consulta pasa por la política de arriba.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'averia_fotos' and policyname = 'ver_averia_fotos') then
    create policy ver_averia_fotos on public.averia_fotos for select to authenticated
      using (exists (select 1 from public.averias a where a.id = averia_id));
  end if;
end $$;
-- Se escriben solo por las funciones de abajo (averias_reportar, averias_anotar_fotos,
-- averias_anular): por eso no hay políticas de insert, update ni delete, y
-- authenticated no tiene el grant. Sin política de escritura, RLS no deja escribir.
revoke all on public.averias from public, anon, authenticated;
revoke all on public.averia_fotos from public, anon, authenticated;
grant select on public.averias to authenticated;
grant select on public.averia_fotos to authenticated;

-- 7. Las fotos en Storage ------------------------------------------------------------------
-- Ya achicadas en el teléfono pesan unos cientos de KB: 5 MB es de sobra.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos-averias', 'fotos-averias', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- «Ningún reporte la nombra» se pregunta por encima del RLS: bajo él, una fila
-- que quien pregunta no ve contaría como inexistente.
create or replace function public.averias_foto_anotada(p_ruta text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.averia_fotos f where f.ruta = p_ruta);
$$;
revoke all on function public.averias_foto_anotada(text) from public, anon;
grant execute on function public.averias_foto_anotada(text) to authenticated;

-- La ruta es {cuenta}/{averia}/{foto}: cada cuenta sube solo a su carpeta, y
-- sube cualquier cuenta activa, porque reporta cualquiera. La foto la ve quien
-- la subió y quien ve el reporte que la nombra; una suelta la retira su dueño
-- mientras ningún reporte la nombre.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'averias_subir_foto') then
    create policy averias_subir_foto on storage.objects for insert to authenticated with check (
      bucket_id = 'fotos-averias' and owner_id = (select auth.uid())::text
      and split_part(name, '/', 1) = (select auth.uid())::text
      and (select public.es_usuario_activo()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'averias_ver_foto') then
    create policy averias_ver_foto on storage.objects for select to authenticated using (
      bucket_id = 'fotos-averias'
      and (owner_id = (select auth.uid())::text
           or exists (select 1 from public.averia_fotos f where f.ruta = objects.name)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'averias_quitar_foto_suelta') then
    create policy averias_quitar_foto_suelta on storage.objects for delete to authenticated using (
      bucket_id = 'fotos-averias' and owner_id = (select auth.uid())::text
      and not public.averias_foto_anotada(objects.name));
  end if;
end $$;

-- p_fotos: ["{cuenta}/{averia}/{foto}.jpg", …], ya subidas a fotos-averias. De 0 a 4.
-- La llama solo averias_reportar.
create or replace function public.averias_anotar_fotos(p_averia uuid, p_fotos jsonb)
returns void language plpgsql set search_path to 'public' as $$
declare
  v_yo     uuid := public.usuario_actual();
  v_fotos  jsonb := coalesce(p_fotos, '[]'::jsonb);
  v_ruta   text;
  v_objeto storage.objects%rowtype;
  v_n      int := 0;
begin
  if jsonb_typeof(v_fotos) <> 'array' then
    raise exception 'Vuelve a poner las fotos del reporte.' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(v_fotos) > 4 then
    raise exception 'Van hasta 4 fotos por reporte.' using errcode = 'check_violation';
  end if;
  for v_ruta in select jsonb_array_elements_text(v_fotos) loop
    v_n := v_n + 1;
    if v_yo is null or v_ruta !~ ('^' || v_yo::text || '/' || p_averia::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$') then
      raise exception 'Vuelve a poner las fotos del reporte.' using errcode = 'check_violation';
    end if;
    select * into v_objeto from storage.objects where bucket_id = 'fotos-averias' and name = v_ruta;
    if not found or v_objeto.owner_id is distinct from v_yo::text
       or v_objeto.metadata->>'mimetype' not in ('image/jpeg', 'image/png', 'image/webp')
       or coalesce((v_objeto.metadata->>'size')::bigint, 0) not between 1 and 5242880 then
      raise exception 'La foto % no terminó de subir: quítala y vuelve a ponerla.', v_n using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.averia_fotos where ruta = v_ruta) then
      raise exception 'La foto % está repetida: quítala.', v_n using errcode = 'check_violation';
    end if;
    insert into public.averia_fotos (averia_id, orden, ruta, mime_type, tamano_bytes)
    values (p_averia, v_n, v_ruta, v_objeto.metadata->>'mimetype', (v_objeto.metadata->>'size')::integer);
  end loop;
end;
$$;
revoke all on function public.averias_anotar_fotos(uuid, jsonb) from public, anon, authenticated;

-- 8. Los equipos para elegir ---------------------------------------------------------------
-- El padrón se lee con los permisos de equipos, y reportar no pide ninguno: de
-- aquí sale solo lo que hace falta para reconocer el equipo, y solo de los que
-- están en uso. Nada de series ni de quién lo tiene a cargo.
create or replace function public.averias_equipos_para_elegir()
returns table (id uuid, codigo text, descripcion text, categoria text, marca text, area_id uuid, area text, ubicacion text, estado text)
language plpgsql stable security definer set search_path to 'public' rows 200 as $$
begin
  if public.usuario_actual() is null or not public.es_usuario_activo() then
    raise exception 'Entra con tu cuenta para reportar.' using errcode = 'insufficient_privilege';
  end if;
  return query
    select e.id, e.codigo, e.descripcion, c.nombre, e.marca, e.area_id, a.nombre, e.ubicacion, e.estado
      from public.equipos e
      join public.equipo_categorias c on c.id = e.categoria_id
      left join public.areas a on a.id = e.area_id
     where e.activo
     order by e.codigo;
end;
$$;
comment on function public.averias_equipos_para_elegir() is
  'Los equipos en uso, para elegir cuál falla: código, descripción, categoría, marca, área, ubicación y estado. Cualquier cuenta activa.';
revoke all on function public.averias_equipos_para_elegir() from public, anon;
grant execute on function public.averias_equipos_para_elegir() to authenticated;

-- 9. A quién le llegó el aviso -----------------------------------------------------------------
-- Para que la pantalla no diga «ya le avisamos a Mantenimiento» cuando no había
-- nadie de Mantenimiento con cuenta. Se cuenta por los avisos de este reporte.
create or replace function public.averias_a_quien_se_aviso(p_averia uuid)
returns table (mantenimiento boolean, responsable boolean, ssoma boolean, gerencia boolean)
language sql stable security definer set search_path to 'public' as $$
  with avisados as (
    select n.usuario_id, u.rol_id
      from public.notificaciones n
      join public.usuarios u on u.id = n.usuario_id
     where n.origen_tabla = 'averias' and n.origen_id = p_averia
  ), jefe as (
    select ar.jefe_id from public.averias v join public.areas ar on ar.id = v.area_id where v.id = p_averia
  )
  select
    exists (select 1 from avisados a join public.roles_permisos rp on rp.rol_id = a.rol_id and rp.permiso_codigo = 'averias.atender'),
    exists (select 1 from avisados a join jefe j on j.jefe_id = a.usuario_id),
    exists (select 1 from avisados a join public.roles_permisos rp on rp.rol_id = a.rol_id and rp.permiso_codigo = 'ssoma.gestionar'),
    exists (select 1 from avisados a join public.roles_permisos rp on rp.rol_id = a.rol_id and rp.permiso_codigo = 'averias.ver');
$$;
revoke all on function public.averias_a_quien_se_aviso(uuid) from public, anon, authenticated;

-- 10. Reportar ---------------------------------------------------------------------------------
-- Reporta cualquier cuenta activa. Un reintento con el mismo p_id y lo mismo
-- devuelve el reporte que ya entró; con otra cosa, dice que ya quedó.
create or replace function public.averias_reportar(
  p_id uuid, p_equipo uuid, p_tipo text, p_detiene boolean, p_riesgo boolean, p_descripcion text, p_fotos jsonb
) returns table (averia uuid, numero_averia text, codigo_equipo text, equipo_parado boolean,
                 aviso_mantenimiento boolean, aviso_responsable boolean, aviso_ssoma boolean, aviso_gerencia boolean)
language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo      uuid := public.usuario_actual();
  v_envio   constant jsonb := jsonb_build_array(p_equipo, p_tipo, p_detiene, p_riesgo, p_descripcion, p_fotos);
  v_que     text := btrim(coalesce(p_descripcion, ''));
  v_actual  public.averias%rowtype;
  v_equipo  public.equipos%rowtype;
  v_numero  text;
  v_detiene boolean := coalesce(p_detiene, false);
  v_paro    boolean := false;
  v_desde   timestamptz;
  v_jefe    uuid;
  v_titulo  text;
  v_cuerpo  text;
  v_ruta    text := '/averias/' || p_id::text;
begin
  if v_yo is null or not public.es_usuario_activo() then
    raise exception 'Entra con tu cuenta para reportar.' using errcode = 'insufficient_privilege';
  end if;
  if p_id is null then
    raise exception 'Vuelve a abrir el formulario del reporte.' using errcode = 'check_violation';
  end if;
  -- Dos pedidos con el mismo id a la vez (un reintento que se cruza con el
  -- primero): el segundo espera aquí y después lee el que ya entró, en vez de
  -- chocar con la llave y decir «ya existe».
  perform pg_advisory_xact_lock(hashtextextended('averias_reportar:' || p_id::text, 0));
  select * into v_actual from public.averias where id = p_id;
  if found then
    if v_actual.registrado_por = v_yo and public.mismo_envio(p_id, 'REPORTE_AVERIA', v_envio) then
      return query select v_actual.id, v_actual.numero, (select e.codigo from public.equipos e where e.id = v_actual.equipo_id),
                          v_actual.paro_el_equipo, q.mantenimiento, q.responsable, q.ssoma, q.gerencia
                     from public.averias_a_quien_se_aviso(v_actual.id) q;
      return;
    end if;
    if v_actual.registrado_por = v_yo then
      raise exception 'El reporte % ya quedó registrado la primera vez que lo enviaste: lo que cambiaste después no se guardó. Si está mal, pídele a Mantenimiento que lo anule y repórtalo de nuevo.', v_actual.numero
        using errcode = 'check_violation';
    end if;
    raise exception 'Ese reporte ya existe con otros datos: vuelve a abrir el formulario.' using errcode = 'unique_violation';
  end if;

  select * into v_equipo from public.equipos where id = p_equipo for update;
  if not found then
    raise exception 'Elige el equipo de la lista: si no está, pídele a Mantenimiento que lo agregue al padrón.' using errcode = 'check_violation';
  end if;
  if not v_equipo.activo then
    raise exception 'El equipo % está dado de baja: ya no se usa. Si lo siguen usando, avísale a Mantenimiento.', v_equipo.codigo using errcode = 'check_violation';
  end if;
  if p_tipo is null or p_tipo not in ('AVERIA', 'POSIBLE_AVERIA') then
    raise exception 'Elige si es una avería o una posible avería.' using errcode = 'check_violation';
  end if;
  if p_tipo = 'AVERIA' and p_detiene is null then
    raise exception 'Marca si la avería detiene el trabajo.' using errcode = 'check_violation';
  end if;
  if p_tipo = 'POSIBLE_AVERIA' and v_detiene then
    raise exception 'Si ya detiene el trabajo, es una avería: elige «Avería».' using errcode = 'check_violation';
  end if;
  if p_riesgo is null then
    raise exception 'Marca si es un riesgo para las personas.' using errcode = 'check_violation';
  end if;
  if char_length(v_que) not between 10 and 2000 then
    raise exception 'Cuenta qué le pasa al equipo, en al menos 10 caracteres.' using errcode = 'check_violation';
  end if;

  v_numero := public.siguiente_correlativo('REPORTE_AVERIA', '001', null);

  -- La avería que detiene el trabajo deja el equipo parado, con el número en su
  -- nota. Si ya estaba parado, no se toca: lo paró otra cosa.
  if p_tipo = 'AVERIA' and v_detiene and v_equipo.estado <> 'PARADO' then
    update public.equipos
       set estado = 'PARADO', estado_nota = left('Avería ' || v_numero || ': ' || v_que, 300)
     where id = p_equipo
     returning estado_desde into v_desde;
    v_paro := true;
  end if;

  insert into public.averias (id, numero, equipo_id, tipo, detiene_trabajo, riesgo_personas, descripcion, area_id,
                              paro_el_equipo, equipo_estado_antes, equipo_nota_antes, equipo_parado_desde, registrado_por)
  values (p_id, v_numero, p_equipo, p_tipo, v_detiene, p_riesgo, v_que, v_equipo.area_id,
          v_paro, case when v_paro then v_equipo.estado end, case when v_paro then v_equipo.estado_nota end,
          case when v_paro then v_desde end, v_yo);
  perform public.averias_anotar_fotos(p_id, p_fotos);
  perform public.anotar_envio(p_id, 'REPORTE_AVERIA', v_envio);

  -- Los avisos. Lo urgente va primero en el título, para leerlo en la campana.
  v_titulo := case when p_tipo = 'AVERIA' then 'Avería' else 'Posible avería' end
              || ' ' || v_numero || ': ' || v_equipo.codigo || ' ' || v_equipo.descripcion;
  v_cuerpo := concat_ws(' ',
                case when v_detiene then 'Detiene el trabajo.' end,
                case when p_riesgo then 'Es un riesgo para las personas.' end,
                left(v_que, 300));
  perform public.avisar_a_permiso('averias.atender', v_titulo, v_cuerpo, v_ruta, 'averias', p_id);

  -- El responsable del área del equipo, si tiene cuenta activa y no es quien
  -- reporta ni ya recibió el de Mantenimiento.
  -- `responsable_del_area` (migración 20261125205000): la cuenta activa de un área activa.
  select public.responsable_del_area(a.codigo) into v_jefe from public.areas a where a.id = v_equipo.area_id;
  if v_jefe is not null and v_jefe <> v_yo
     and not exists (select 1 from public.notificaciones n where n.origen_tabla = 'averias' and n.origen_id = p_id and n.usuario_id = v_jefe) then
    insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
    values (v_jefe, left(v_titulo || ' (en tu área)', 200), left(v_cuerpo, 500), v_ruta, 'averias', p_id);
  end if;

  -- La que es un riesgo para las personas, también a SSOMA.
  if p_riesgo then
    perform public.avisar_a_permiso('ssoma.gestionar', 'Riesgo para las personas: ' || v_titulo, v_cuerpo, v_ruta, 'averias', p_id);
  end if;

  -- Sin nadie de Mantenimiento con cuenta activa, o sin SSOMA para la de riesgo,
  -- el aviso no puede perderse en el aire: le llega a Gerencia.
  if (not public.tiene_permiso('averias.atender')
      and not exists (select 1 from public.notificaciones n
                        join public.usuarios u on u.id = n.usuario_id
                        join public.roles_permisos rp on rp.rol_id = u.rol_id and rp.permiso_codigo = 'averias.atender'
                       where n.origen_tabla = 'averias' and n.origen_id = p_id))
     or (p_riesgo and not public.tiene_permiso('ssoma.gestionar')
         and not exists (select 1 from public.notificaciones n
                           join public.usuarios u on u.id = n.usuario_id
                           join public.roles_permisos rp on rp.rol_id = u.rol_id and rp.permiso_codigo = 'ssoma.gestionar'
                          where n.origen_tabla = 'averias' and n.origen_id = p_id)) then
    perform public.avisar_a_permiso('averias.ver',
      v_titulo || case when not public.tiene_permiso('averias.atender')
                            and not exists (select 1 from public.notificaciones n
                                              join public.usuarios u on u.id = n.usuario_id
                                              join public.roles_permisos rp on rp.rol_id = u.rol_id and rp.permiso_codigo = 'averias.atender'
                                             where n.origen_tabla = 'averias' and n.origen_id = p_id)
                       then ' (no hay cuenta de Mantenimiento que la reciba)'
                       else ' (no hay cuenta de SSOMA que reciba el riesgo)' end,
      v_cuerpo, v_ruta, 'averias', p_id);
  end if;

  return query select p_id, v_numero, v_equipo.codigo, v_paro, q.mantenimiento, q.responsable, q.ssoma, q.gerencia
                 from public.averias_a_quien_se_aviso(p_id) q;
end;
$$;
comment on function public.averias_reportar(uuid, uuid, text, boolean, boolean, text, jsonb) is
  'Cualquier cuenta activa reporta una avería o una posible avería de un equipo del padrón, con sus fotos ya en Storage; da el número AV-…, deja parado el equipo si la avería detiene el trabajo y avisa a Mantenimiento, al responsable del área y, si es un riesgo, a SSOMA.';
revoke all on function public.averias_reportar(uuid, uuid, text, boolean, boolean, text, jsonb) from public, anon;
grant execute on function public.averias_reportar(uuid, uuid, text, boolean, boolean, text, jsonb) to authenticated;

-- 11. Anular ----------------------------------------------------------------------------------
-- Un reporte mal hecho no se borra: Mantenimiento lo anula. Si el equipo sigue
-- parado por él, vuelve a como estaba; a quien lo reportó le llega el aviso.
create or replace function public.averias_anular(p_id uuid, p_motivo text)
returns table (averia uuid, equipo_vuelve_a text, sigue_parado_por text)
language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo     uuid := public.usuario_actual();
  v_av     public.averias%rowtype;
  v_equipo public.equipos%rowtype;
  v_vuelve text;
  v_otro   public.averias%rowtype;
  v_sigue  text;
begin
  if v_yo is null or not (public.es_admin() or public.tiene_permiso('averias.atender')) then
    raise exception 'Un reporte de avería lo anula Mantenimiento.' using errcode = 'insufficient_privilege';
  end if;
  if char_length(btrim(coalesce(p_motivo, ''))) not between 10 and 500 then
    raise exception 'Cuenta por qué se anula, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_av from public.averias where id = p_id for update;
  if not found then raise exception 'Ese reporte no existe.' using errcode = 'check_violation'; end if;
  if v_av.estado = 'ANULADA' then
    -- El mismo pedido repetido (se perdió la respuesta) entra; con otro motivo se dice, no se finge.
    if v_av.motivo_anulacion = btrim(p_motivo) and v_av.anulado_por = v_yo then
      return query select p_id, null::text, null::text;
      return;
    end if;
    raise exception 'El reporte % ya estaba anulado, con este motivo: «%». No se cambia.', v_av.numero, v_av.motivo_anulacion
      using errcode = 'check_violation';
  end if;

  update public.averias
     set estado = 'ANULADA', anulado_por = v_yo, anulado_en = now(), motivo_anulacion = btrim(p_motivo)
   where id = p_id;

  -- Vuelve solo si sigue parado por este reporte: si alguien lo cambió después,
  -- lo que dijo esa persona manda.
  if v_av.paro_el_equipo then
    select * into v_equipo from public.equipos where id = v_av.equipo_id for update;
    -- Y si otro reporte vigente del mismo equipo dice que detiene el trabajo, sigue
    -- parado: anular el repetido no arregla la falla que el otro reporta.
    select o.* into v_otro
      from public.averias o
     where o.equipo_id = v_av.equipo_id and o.id <> p_id and o.estado = 'REPORTADA' and o.detiene_trabajo
     order by o.creado_en
     limit 1
       for update;
    if v_equipo.activo and v_equipo.estado = 'PARADO' and v_equipo.estado_desde = v_av.equipo_parado_desde then
      if v_otro.id is null then
        update public.equipos
           set estado = v_av.equipo_estado_antes, estado_nota = v_av.equipo_nota_antes
         where id = v_av.equipo_id;
        v_vuelve := v_av.equipo_estado_antes;
      else
        -- El otro reporte se queda con el paro y con cómo estaba el equipo antes:
        -- cuando se cierre o se anule, el equipo vuelve a eso. La nota del padrón
        -- pasa a su número.
        perform set_config('averias.traspaso_del_paro', v_otro.id::text, true);
        update public.averias
           set paro_el_equipo = true, equipo_estado_antes = v_av.equipo_estado_antes,
               equipo_nota_antes = v_av.equipo_nota_antes, equipo_parado_desde = v_av.equipo_parado_desde
         where id = v_otro.id;
        perform set_config('averias.traspaso_del_paro', '', true);
        update public.equipos
           set estado_nota = left('Avería ' || v_otro.numero || ': ' || v_otro.descripcion, 300)
         where id = v_av.equipo_id;
        v_sigue := v_otro.numero;
      end if;
    end if;
  end if;

  if v_av.registrado_por is distinct from v_yo then
    insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
    values (v_av.registrado_por, 'Mantenimiento anuló tu reporte ' || v_av.numero, left(btrim(p_motivo), 500),
            '/averias/' || p_id::text, 'averias', p_id);
  end if;
  -- Si sigue parado porque otro reporte vigente dice que detiene, se dice cuál.
  return query select p_id, v_vuelve, v_sigue;
end;
$$;
comment on function public.averias_anular(uuid, text) is
  'Mantenimiento anula un reporte de avería con su motivo; si el equipo sigue parado por él, vuelve a como estaba, y avisa a quien lo reportó. Exige averias.atender.';
revoke all on function public.averias_anular(uuid, text) from public, anon;
grant execute on function public.averias_anular(uuid, text) to authenticated;

-- 12. Lo que cada quien lee ---------------------------------------------------------------------
-- Una sola lectura para la lista (p_id vacío) y el detalle, con el equipo: el
-- padrón no se lee sin los permisos de equipos, y quien reporta no los tiene.
-- `alcance` dice por qué lo ve: TODAS (Mantenimiento, Gerencia, el
-- administrador), PROPIA (quien la reportó), AREA (quien trabaja en el área o
-- la tiene a cargo) o RIESGO (SSOMA, la que es un riesgo para las personas).
create or replace function public.averias_visibles(p_id uuid)
returns table (
  id uuid, numero text, tipo text, detiene_trabajo boolean, riesgo_personas boolean, descripcion text,
  estado text, creado_en timestamptz, dias_en_espera integer, alcance text,
  equipo_id uuid, equipo_codigo text, equipo_descripcion text, equipo_ubicacion text, equipo_estado text,
  area_id uuid, area text, paro_el_equipo boolean,
  reporto text, reporto_puesto text, fotos integer,
  anulado_en timestamptz, anulo text, motivo_anulacion text)
language sql stable security definer set search_path to 'public' rows 200 as $$
  with yo as (
    select u.id, public.averias_areas_de_la_cuenta() as areas, public.puede_ver_todas_las_averias() as todo,
           public.averias_ve_las_de_riesgo() as riesgo
      from public.usuarios u
     where u.id = public.usuario_actual() and u.activo
  ), visibles as (
    select v.*, case when yo.todo then 'TODAS' when v.registrado_por = yo.id then 'PROPIA'
                     when v.area_id = any(yo.areas) then 'AREA' else 'RIESGO' end as alcance
      from public.averias v
      cross join yo
     where (p_id is null or v.id = p_id)
       -- La política `ver_averias`, tal cual.
       and (yo.todo or v.registrado_por = yo.id or v.area_id = any(yo.areas) or (v.riesgo_personas and yo.riesgo))
  )
  select v.id, v.numero, v.tipo, v.detiene_trabajo, v.riesgo_personas, v.descripcion,
         v.estado, v.creado_en,
         case when v.estado = 'REPORTADA'
              then (now() at time zone 'America/Lima')::date - (v.creado_en at time zone 'America/Lima')::date end,
         v.alcance,
         e.id, e.codigo, e.descripcion, e.ubicacion, e.estado,
         v.area_id, a.nombre, v.paro_el_equipo,
         btrim(u.nombres || ' ' || u.apellidos), ro.nombre,
         (select count(*)::integer from public.averia_fotos f where f.averia_id = v.id),
         v.anulado_en, btrim(an.nombres || ' ' || an.apellidos), v.motivo_anulacion
    from visibles v
    join public.equipos e on e.id = v.equipo_id
    left join public.areas a on a.id = v.area_id
    join public.usuarios u on u.id = v.registrado_por
    left join public.roles ro on ro.id = u.rol_id
    left join public.usuarios an on an.id = v.anulado_por
   order by v.creado_en desc;
$$;
comment on function public.averias_visibles(uuid) is
  'Los reportes de avería que ve quien pregunta (uno, o todos con p_id vacío), con su equipo: todos (Mantenimiento, Gerencia), los suyos, los del área donde trabaja o que tiene a cargo, y SSOMA los que son un riesgo. dias_en_espera se cuenta con la fecha de Lima.';
revoke all on function public.averias_visibles(uuid) from public, anon;
grant execute on function public.averias_visibles(uuid) to authenticated;

-- 13. El recorrido -------------------------------------------------------------------------------
-- «Quien reporta ve el recorrido» (DKS, Plan 16.2), con la misma forma que el
-- del requerimiento y la cotización (migración 20261125130000): una fila por
-- paso, con el puesto de quien lo hizo y nunca su nombre. Reportada →
-- Mantenimiento la atiende → la cierra → quien la reportó confirma que quedó
-- bien. La atención y el cierre son de la 16.3: hasta entonces, la tiene
-- Mantenimiento. La ve quien ve el reporte, ni uno más (la política
-- `ver_averias`, repetida aquí porque la función corre por encima del RLS).
create or replace function public.recorrido_de_averias(p_ids uuid[])
returns table (
  documento uuid,
  orden     integer,
  paso      text,
  situacion text,
  puesto    text,
  en        timestamptz,
  dias      integer,
  espera    text,
  detalle   text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_yo   constant uuid := public.usuario_actual();
  v_todo constant boolean := public.puede_ver_todas_las_averias();
  v_areas  constant uuid[] := public.averias_areas_de_la_cuenta();
  v_riesgo constant boolean := public.averias_ve_las_de_riesgo();
begin
  if v_yo is null or not public.es_usuario_activo() then
    raise exception 'Entra con tu cuenta para ver el recorrido.' using errcode = 'insufficient_privilege';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return;
  end if;
  if cardinality(p_ids) > 500 then
    raise exception 'Pide el recorrido de hasta 500 reportes a la vez.' using errcode = 'check_violation';
  end if;

  return query
  with av as (
    select v.id, v.estado, v.registrado_por, v.creado_en, v.anulado_por, v.anulado_en, v.paro_el_equipo
      from public.averias v
     where v.id = any(p_ids)
       -- La política `ver_averias`, tal cual.
       and (v_todo or v.registrado_por = v_yo or v.area_id = any(v_areas) or (v.riesgo_personas and v_riesgo))
  ),
  pasos as (
    select a.id as av, 10 as canon, 'REPORTE' as paso, 'HECHO' as situacion, a.registrado_por as quien, null::text as puesto_fijo,
           a.creado_en as en, null::text as espera, case when a.paro_el_equipo then 'PARADO' end as detalle
      from av a
    union all
    select a.id, 20, 'ATENCION', 'AHORA', null, 'Mantenimiento', a.creado_en, 'ATENCION', null
      from av a where a.estado = 'REPORTADA'
    union all
    select a.id, 30, 'CIERRE', 'PENDIENTE', null, null, null, null, null
      from av a where a.estado = 'REPORTADA'
    union all
    select a.id, 40, 'CONFIRMACION', 'PENDIENTE', null, null, null, null, null
      from av a where a.estado = 'REPORTADA'
    union all
    select a.id, 100, 'ANULACION', 'HECHO', a.anulado_por, null, a.anulado_en, null, null
      from av a where a.estado = 'ANULADA'
  )
  select p.av,
         (row_number() over (
            partition by p.av
            order by case p.situacion when 'HECHO' then 0 when 'AHORA' then 1 else 2 end,
                     case when p.situacion = 'HECHO' then p.en end, p.canon))::integer,
         p.paso, p.situacion,
         case when p.situacion = 'HECHO' then public.puesto(u) else p.puesto_fijo end,
         p.en,
         case when p.situacion = 'AHORA' then public.dias_en_espera(p.en) end,
         p.espera, p.detalle
    from pasos p
    left join public.usuarios u on u.id = p.quien;
end;
$$;
comment on function public.recorrido_de_averias(uuid[]) is
  'El recorrido de cada reporte de avería, un paso por fila: lo hecho con el puesto de quien lo hizo y su fecha; quién lo tiene ahora y hace cuántos días (fecha de Lima); y lo que falta. Devuelve solo los que la política ver_averias deja ver a quien llama.';
revoke all on function public.recorrido_de_averias(uuid[]) from public, anon;
grant execute on function public.recorrido_de_averias(uuid[]) to authenticated;
