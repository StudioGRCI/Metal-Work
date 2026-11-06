-- =============================================================================
-- LAS OBSERVACIONES DE DISEÑO
-- -----------------------------------------------------------------------------
-- DKS trajo el 2026-11-06 las observaciones del área de Diseño sobre su puesto
-- («Observaciones del sistema de Metal Work»). Lo que toca a la base:
--
-- 1. EL COLABORADOR DE DISEÑO revisa la OT, pide material solo por
--    requerimiento y anota sus actividades del día. Recibe el permiso de
--    emitir el requerimiento (con el stock de Almacén, que todo el que emite
--    un RQ consulta antes de pedir) y deja de subir planos: «los juegos de
--    planos se revisan 2 a 3 veces, y después del visto bueno recién el
--    encargado del área los sube y define los porcentajes; los colaboradores
--    no deben tener acceso a subir planos». Ya no sube el PDF de un plano en
--    la OT (`ot_plano_versiones`), y en el código nunca pudo.
--
-- 2. LA FICHA TÉCNICA DEL CAMIÓN O TRACTO va junto a la OT: Diseño la adjunta
--    a la orden (PDF o foto) desde el código de la unidad. Es una fila más de
--    `ot_adjuntos`, con `tipo = 'FICHA_VEHICULO'`, y la ve quien ve la OT.
--
-- 3. LOS DXF COMPRIMIDOS que Diseño genera para el corte van en un acceso
--    aparte, solo para Diseño y Maestranza: Diseño sube el .zip, .rar o .7z por
--    código interno, y el supervisor de Maestranza lo ve y lo descarga. Nadie
--    más los lee, ni Gerencia ni Producción. Se quitan, no se borran.
--
-- 4. LAS ETAPAS. «El área de diseño define solo dos etapas específicas por
--    cada par de juego de planos entregados: el primero para Maestranza, que es
--    plano de habilitado, y en ese juego de planos Maestranza decide subetapas
--    en función del material que va a procesar; el segundo es plano de
--    ensamblaje para Producción, y así pueda crear subetapas en función de lo
--    que se va a ensamblar. Las otras áreas son independientes y pueden añadir
--    de manera independiente sus etapas posteriores o en paralelo.»
--      * Diseño arma por cada juego de planos el par Habilitado (Maestranza) y
--        Ensamblaje (Producción), y solo esas: su etapa es de Maestranza o de
--        Producción.
--      * El supervisor de cada área agrega subetapas debajo de una etapa de su
--        área, o etapas propias de su área, antes, después o en paralelo.
--        Corrige y quita solo las de su área que agregó el área.
--      * El avance de la unidad cuenta las etapas de arriba. Una etapa con
--        subetapas vale el promedio de ellas (100 la terminada); terminada,
--        vale 100.
--
-- En producción no había etapas, planos, DXF ni tareas de Diseño (0 filas el
-- 2026-11-06): nada que migrar. Las funciones que se reescriben enteras se
-- comparan antes con el texto que el repositorio conoce.
-- =============================================================================

do $$
declare
  v_esperado constant jsonb := jsonb_build_object(
    'codigos_internos_de_diseno', 'a073ca241e9b77b20212e732f6823a67',
    'codigo_interno_avance_calculado', '33c9b5ac23db9641e6e236c7c903c95d',
    'guardar_etapa_codigo', '186d5a83fcb2f92ff5ac02aae7b29f6a',
    'etapas_de_siempre_codigo', '5d309a253c0eda6b7252c30b0b944e62',
    'mover_etapa_codigo', 'cae7aae6307b58796cd9aa3bcaf27dc3',
    'quitar_etapa_codigo', '85e730f233d5b550f9c65d3162157ca6',
    'codigo_interno_avance_planos_calculado', '436686e9d5742d04c0bf395fa276a256');
  f record;
begin
  for f in select p.proname, md5(replace(p.prosrc, E'\r', '')) as huella
             from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in (select jsonb_object_keys(v_esperado)) loop
    -- Volver a correr la migración encuentra su propio texto: el comentario
    -- `-- obs-diseno-2026-11-06` que lleva cada una lo deja pasar.
    if f.huella <> v_esperado->>f.proname
       and not exists (select 1 from pg_proc p where p.proname = f.proname and p.pronamespace = 'public'::regnamespace
                          and p.prosrc like '%obs-diseno-2026-11-06%') then
      raise exception 'La función % de producción no es la que conoce el repositorio (huella %): revisarla antes de reescribirla.',
        f.proname, f.huella;
    end if;
  end loop;
end $$;

-- 1. El colaborador de Diseño ---------------------------------------------------------------------
-- Pide material por requerimiento y mira el stock antes de pedir, como todo el que emite un RQ.
insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, x.permiso
  from public.roles r
  cross join (values ('requerimientos.emitir'), ('requerimientos.ver'), ('almacen.stock')) as x(permiso)
 where r.codigo = 'DISENO_COLABORADOR'
on conflict do nothing;

-- Los planos los sube el encargado de Diseño: el colaborador ya no carga el PDF
-- de un plano en la OT. La función de la OT exigía `diseno.planos` o
-- `diseno.subir_pdf`; en vez de reescribirla, la tabla y el bucket se cierran.
create or replace function public.fn_solo_el_encargado_sube_planos()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if public.usuario_actual() is not null and not public.es_admin() and not public.tiene_permiso('diseno.planos') then
    raise exception 'Los planos los sube el encargado de Diseño, después de su revisión. Pásale el PDF a él.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_solo_el_encargado_sube_planos() from public, anon, authenticated;
create or replace trigger trg_solo_el_encargado_sube_planos
  before insert on public.ot_plano_versiones
  for each row execute function public.fn_solo_el_encargado_sube_planos();

alter policy planos_subir on storage.objects
  with check (bucket_id = 'planos-privados'
              and public.tiene_permiso('diseno.planos')
              and (storage.foldername(name))[1] = public.usuario_actual()::text
              and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.pdf$');

-- 2. La ficha técnica del camión o tracto, junto a la OT ------------------------------------------
alter table public.ot_adjuntos drop constraint if exists ck_ot_adjunto_tipo;
alter table public.ot_adjuntos add constraint ck_ot_adjunto_tipo check (tipo in ('ORDEN', 'CRONOGRAMA', 'FICHA_VEHICULO'));
comment on column public.ot_adjuntos.tipo is
  'ORDEN: el PDF de la orden. CRONOGRAMA: el Excel que Diseño carga. FICHA_VEHICULO: la ficha técnica del camión o tracto, que Diseño adjunta (desde el 2026-11-06).';

-- La foto de una ficha también entra: en el taller muchas veces llega así.
update storage.buckets
   set allowed_mime_types = array['application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                                  'image/jpeg', 'image/png']
 where id = 'adjuntos-ot';

alter policy crear_ot_adjuntos on public.ot_adjuntos
  with check ((public.es_admin()
               or public.tiene_permiso('produccion.actividades')
               or public.tiene_permiso('ordenes.editar')
               or public.tiene_permiso('ordenes.crear')
               or public.tiene_permiso('ordenes.abrir_taller')
               or (tipo = 'CRONOGRAMA' and public.tiene_permiso('diseno.planos'))
               or (tipo = 'FICHA_VEHICULO' and public.tiene_permiso('diseno.codigos')
                   and ruta_storage ~ '^ot/[0-9a-fA-F-]{36}/ficha-[0-9a-f-]{36}\.(pdf|jpg|png)$'))
              and public.puede_ver_orden(orden_id)
              and subido_por = public.usuario_actual());

-- La de la 20261027201000, con la ficha de Diseño: PDF, JPG o PNG.
alter policy mw_subir_adjuntos_ot on storage.objects
  with check (bucket_id = 'adjuntos-ot'
              and public.orden_de_ruta(name) is not null
              and public.puede_ver_orden(public.orden_de_ruta(name))
              and (public.es_admin()
                   or public.tiene_permiso('produccion.actividades')
                   or public.tiene_permiso('ordenes.editar')
                   or public.tiene_permiso('ordenes.crear')
                   or public.tiene_permiso('ordenes.abrir_taller')
                   or (public.tiene_permiso('diseno.planos') and lower(name) like '%.xlsx')
                   -- La ficha va con nombre propio: Diseño no puede dejar un PDF que pase por el de la orden.
                   or (public.tiene_permiso('diseno.codigos') and name ~ '^ot/[0-9a-fA-F-]{36}/ficha-[0-9a-f-]{36}\.(pdf|jpg|png)$')));

-- 3. Los DXF comprimidos, solo para Diseño y Maestranza ------------------------------------------
create table if not exists public.codigo_dxf (
  id               uuid primary key,
  codigo_interno   text not null,
  -- Qué traen: «Corte de planchas del chasis», «Cartelas y refuerzos».
  descripcion      text not null,
  nombre_archivo   text not null,
  ruta             text not null,
  tamano_bytes     bigint not null,
  subido_por       uuid not null default public.usuario_actual(),
  subido_en        timestamptz not null default now(),
  quitado_en       timestamptz,
  quitado_por      uuid,
  actualizado_en   timestamptz not null default now(),
  constraint codigo_dxf_subido_por_fkey foreign key (subido_por) references public.usuarios(id) on delete restrict,
  constraint codigo_dxf_quitado_por_fkey foreign key (quitado_por) references public.usuarios(id) on delete restrict,
  constraint uq_codigo_dxf_ruta unique (ruta),
  constraint ck_codigo_dxf check (
    codigo_interno = upper(btrim(codigo_interno)) and char_length(codigo_interno) between 2 and 60
    and char_length(btrim(descripcion)) between 2 and 200
    and char_length(btrim(nombre_archivo)) between 1 and 200
    and ruta ~ '^[0-9a-f-]{36}\.(zip|rar|7z)$'
    and tamano_bytes between 1 and 52428800
    and (quitado_en is null) = (quitado_por is null))
);
comment on table public.codigo_dxf is
  'Los DXF comprimidos (.zip, .rar, .7z) que Diseño genera para cada código interno. Los sube Diseño; los ven Diseño y el supervisor de Maestranza. Se quitan, no se borran.';
-- (b) Diseño y Maestranza los leen por código. Las llaves a usuarios no llevan
-- índice: las cuentas no se borran.
create index if not exists idx_codigo_dxf_codigo on public.codigo_dxf (codigo_interno, subido_en) where quitado_en is null;

select public.activar_timestamps('codigo_dxf');
select public.activar_auditoria('codigo_dxf');
select public.activar_registro_de_prueba('codigo_dxf');

create or replace trigger trg_codigo_dxf_no_se_borra
  before delete on public.codigo_dxf
  for each row execute function public.fn_codigo_no_se_borra();

-- Quién los ve: Diseño y quien supervisa Maestranza (el jefe de producción,
-- que ve todas las áreas, también).
create or replace function public.puede_ver_dxf()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.es_admin() or public.tiene_permiso('diseno.codigos')
      or (public.tiene_permiso('codigos_internos.area')
          and public.puede_hoja_de_area((select a.id from public.areas a where a.codigo = 'MTZ')));
$$;
revoke all on function public.puede_ver_dxf() from public, anon;
grant execute on function public.puede_ver_dxf() to authenticated;

alter table public.codigo_dxf enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'codigo_dxf' and policyname = 'ver_codigo_dxf') then
    create policy ver_codigo_dxf on public.codigo_dxf for select to authenticated using ((select public.puede_ver_dxf()));
  end if;
end $$;
revoke all on public.codigo_dxf from public, anon, authenticated;
grant select on public.codigo_dxf to authenticated;

-- 50 MB: un juego de DXF comprimido pesa poco más que un PDF de planos.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dxf-codigo', 'dxf-codigo', false, 52428800,
        array['application/zip', 'application/x-zip-compressed', 'application/x-rar-compressed', 'application/vnd.rar',
              'application/x-7z-compressed'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- La ruta es {id}.{zip|rar|7z}. Lo sube Diseño; lo ve quien lo subió (para
-- comprobarlo antes de registrarlo) y quien ve los DXF del código que lo
-- nombra. Uno suelto lo retira su dueño mientras ninguna fila lo nombre.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'dxf_codigo_subir') then
    create policy dxf_codigo_subir on storage.objects for insert to authenticated with check (
      bucket_id = 'dxf-codigo' and owner_id = (select auth.uid())::text
      and (select public.tiene_permiso('diseno.codigos'))
      and name ~ '^[0-9a-f-]{36}\.(zip|rar|7z)$');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'dxf_codigo_ver') then
    create policy dxf_codigo_ver on storage.objects for select to authenticated using (
      bucket_id = 'dxf-codigo'
      and (owner_id = (select auth.uid())::text
           or exists (select 1 from public.codigo_dxf d where d.ruta = objects.name and d.quitado_en is null)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'dxf_codigo_quitar_suelto') then
    create policy dxf_codigo_quitar_suelto on storage.objects for delete to authenticated using (
      bucket_id = 'dxf-codigo' and owner_id = (select auth.uid())::text
      and not exists (select 1 from public.codigo_dxf d where d.ruta = objects.name));
  end if;
end $$;

-- Diseño registra el comprimido que el navegador ya subió. El mismo pedido otra
-- vez (la respuesta no llegó) contesta con el mismo id.
create or replace function public.registrar_dxf_codigo(p_id uuid, p_codigo text, p_descripcion text, p_nombre_archivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo      uuid := public.usuario_actual();
  v_codigo  text;
  v_desc    text := regexp_replace(btrim(coalesce(p_descripcion, '')), '\s+', ' ', 'g');
  v_archivo text := btrim(coalesce(p_nombre_archivo, ''));
  v_ext     text := lower(substring(btrim(coalesce(p_nombre_archivo, '')) from '\.([A-Za-z0-9]+)$'));
  v_ruta    text;
  v_objeto  storage.objects%rowtype;
  v_hay     public.codigo_dxf%rowtype;
begin
  perform public.exigir_permiso('diseno.codigos');
  v_codigo := public.exigir_codigo_de_unidad(p_codigo);
  if p_id is null then
    raise exception 'Vuelve a elegir el archivo.' using errcode = 'check_violation';
  end if;
  if v_ext is null or v_ext not in ('zip', 'rar', '7z') then
    raise exception 'Los DXF van comprimidos en .zip, .rar o .7z.' using errcode = 'check_violation';
  end if;
  v_ruta := p_id::text || '.' || v_ext;

  select * into v_hay from public.codigo_dxf where id = p_id;
  if found then
    if v_hay.subido_por = v_yo and v_hay.codigo_interno = v_codigo and v_hay.ruta = v_ruta then
      return p_id;
    end if;
    raise exception 'Ese archivo ya quedó registrado en otro código: recarga la pantalla.' using errcode = 'check_violation';
  end if;
  if char_length(v_desc) not between 2 and 200 then
    raise exception 'Escribe qué traen los DXF, por ejemplo «Corte de planchas del chasis».' using errcode = 'check_violation';
  end if;
  if char_length(v_archivo) not between 1 and 200 then
    raise exception 'Vuelve a elegir el archivo.' using errcode = 'check_violation';
  end if;

  select * into v_objeto from storage.objects where bucket_id = 'dxf-codigo' and name = v_ruta;
  if not found or v_objeto.owner_id is distinct from v_yo::text
     or coalesce((v_objeto.metadata->>'size')::bigint, 0) not between 1 and 52428800 then
    raise exception 'El archivo no terminó de subir: vuelve a elegirlo.' using errcode = 'check_violation';
  end if;

  insert into public.codigo_dxf (id, codigo_interno, descripcion, nombre_archivo, ruta, tamano_bytes, subido_por)
  values (p_id, v_codigo, v_desc, v_archivo, v_ruta, (v_objeto.metadata->>'size')::bigint, v_yo);

  -- El aviso al supervisor de Maestranza, que es quien corta.
  insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
  select u.id, 'DXF nuevos: ' || v_codigo, v_desc || ' (' || v_archivo || ').', '/planos?q=' || replace(v_codigo, '/', '%2F'),
         'codigo_dxf', p_id
    from public.usuarios u
    join public.roles_permisos rp on rp.rol_id = u.rol_id and rp.permiso_codigo = 'codigos_internos.area'
   where u.activo and u.id is distinct from v_yo
     and (u.area_id = (select a.id from public.areas a where a.codigo = 'MTZ')
          or exists (select 1 from public.roles_permisos x where x.rol_id = u.rol_id and x.permiso_codigo = 'produccion.cualquier_area'));
  return p_id;
end;
$$;
comment on function public.registrar_dxf_codigo(uuid, text, text, text) is
  'Diseño registra un comprimido de DXF (.zip, .rar, .7z, hasta 50 MB) ya subido a dxf-codigo/{id}.{ext} para un código interno, y avisa a Maestranza. Exige diseno.codigos.';
revoke all on function public.registrar_dxf_codigo(uuid, text, text, text) from public, anon;
grant execute on function public.registrar_dxf_codigo(uuid, text, text, text) to authenticated;

create or replace function public.quitar_dxf_codigo(p_id uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.exigir_permiso('diseno.codigos');
  if not exists (select 1 from public.codigo_dxf where id = p_id) then
    raise exception 'Ese archivo ya no está. Vuelve a cargar la pantalla.' using errcode = 'check_violation';
  end if;
  update public.codigo_dxf set quitado_en = now(), quitado_por = public.usuario_actual()
   where id = p_id and quitado_en is null;
  return p_id;
end;
$$;
revoke all on function public.quitar_dxf_codigo(uuid) from public, anon;
grant execute on function public.quitar_dxf_codigo(uuid) to authenticated;

-- 4. Las etapas: el par de Diseño y lo que agrega cada área --------------------------------------
alter table public.codigo_etapas add column if not exists padre_id uuid;
alter table public.codigo_etapas add column if not exists de_area boolean not null default false;
comment on column public.codigo_etapas.padre_id is
  'La etapa de la que esta es subetapa (Maestranza y Producción las agregan debajo de la etapa que Diseño les puso). Vacía en las de arriba.';
comment on column public.codigo_etapas.de_area is
  'true: la agregó el supervisor del área (subetapa o etapa propia); la corrige y la quita esa área. false: la armó Diseño.';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'codigo_etapas_padre_id_fkey') then
    alter table public.codigo_etapas add constraint codigo_etapas_padre_id_fkey
      foreign key (padre_id) references public.codigo_etapas(id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_codigo_etapa_padre') then
    alter table public.codigo_etapas add constraint ck_codigo_etapa_padre check (padre_id is distinct from id);
  end if;
end $$;
-- (b) Las subetapas se leen y se cuentan por su etapa.
-- Entero, no parcial: la llave foránea solo puede usar un índice sin condición (check 190).
drop index if exists public.idx_codigo_etapas_padre;
create index if not exists idx_codigo_etapas_padre_id on public.codigo_etapas (padre_id);

-- Las áreas a las que Diseño les pone su etapa.
create or replace function public.area_de_etapa_de_diseno(p_area uuid)
returns boolean language sql stable set search_path to 'public' as $$
  select exists (select 1 from public.areas a where a.id = p_area and a.activo and a.codigo in ('MTZ', 'PRD'));
$$;
revoke all on function public.area_de_etapa_de_diseno(uuid) from public, anon, authenticated;

-- El par de un juego de planos: Habilitado para Maestranza y Ensamblaje para
-- Producción. Con nombre de juego, cada etapa lo lleva («Habilitado: caja»).
create or replace function public.par_de_etapas_codigo(p_codigo text, p_juego text)
returns integer language plpgsql security definer set search_path to 'public' as $$
-- obs-diseno-2026-11-06
declare
  v_codigo text;
  v_juego  text := nullif(regexp_replace(btrim(coalesce(p_juego, '')), '\s+', ' ', 'g'), '');
  v_n      integer;
begin
  perform public.exigir_permiso('diseno.codigos');
  v_codigo := public.exigir_codigo_de_unidad(p_codigo);
  if char_length(coalesce(v_juego, '')) > 100 then
    raise exception 'El nombre del juego de planos va hasta 100 caracteres.' using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(hashtext('codigo_etapas:' || v_codigo));
  if exists (select 1 from public.codigo_etapas e
              where e.codigo_interno = v_codigo and e.quitada_en is null and not e.de_area and e.padre_id is null
                and lower(e.nombre) in (lower('Habilitado' || coalesce(': ' || v_juego, '')), lower('Ensamblaje' || coalesce(': ' || v_juego, '')))) then
    raise exception 'El código % ya tiene las etapas de ese juego de planos. Para otro juego, ponle su nombre (por ejemplo «Caja»).', v_codigo
      using errcode = 'check_violation';
  end if;
  insert into public.codigo_etapas (codigo_interno, orden, nombre, area_id, creado_por)
  select v_codigo, (coalesce((select max(e.orden) from public.codigo_etapas e where e.codigo_interno = v_codigo), 0) + x.n)::smallint,
         x.nombre || coalesce(': ' || v_juego, ''), (select a.id from public.areas a where a.codigo = x.area), public.usuario_actual()
    from (values (1, 'Habilitado', 'MTZ'), (2, 'Ensamblaje', 'PRD')) as x(n, nombre, area);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
comment on function public.par_de_etapas_codigo(text, text) is
  'Diseño arma las dos etapas de un juego de planos: Habilitado (Maestranza) y Ensamblaje (Producción). Exige diseno.codigos.';
revoke all on function public.par_de_etapas_codigo(text, text) from public, anon;
grant execute on function public.par_de_etapas_codigo(text, text) to authenticated;

-- El botón de siempre arma ahora el par, sin nombre de juego.
create or replace function public.etapas_de_siempre_codigo(p_codigo text)
returns integer language plpgsql security definer set search_path to 'public' as $$
-- obs-diseno-2026-11-06
begin
  return public.par_de_etapas_codigo(p_codigo, null);
end;
$$;
revoke all on function public.etapas_de_siempre_codigo(text) from public, anon;
grant execute on function public.etapas_de_siempre_codigo(text) to authenticated;

-- Diseño corrige o agrega una etapa suya: de Maestranza o de Producción, arriba.
create or replace function public.guardar_etapa_codigo(
  p_id uuid, p_codigo text, p_nombre text, p_area uuid, p_inicio_plan date, p_fin_plan date)
returns uuid language plpgsql security definer set search_path to 'public' as $$
-- obs-diseno-2026-11-06
declare
  v_yo     uuid := public.usuario_actual();
  v_codigo text;
  v_etapa  public.codigo_etapas%rowtype;
  v_nombre text := regexp_replace(btrim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
  v_id     uuid;
begin
  perform public.exigir_permiso('diseno.codigos');
  if p_id is not null then
    select * into v_etapa from public.codigo_etapas where id = p_id for update;
    if not found or v_etapa.quitada_en is not null then
      raise exception 'Esa etapa ya no está. Vuelve a cargar la pantalla.' using errcode = 'check_violation';
    end if;
    if v_etapa.de_area then
      raise exception 'La etapa «%» la agregó el área: la corrige su supervisor.', v_etapa.nombre using errcode = 'check_violation';
    end if;
    v_codigo := v_etapa.codigo_interno;
  else
    v_codigo := public.exigir_codigo_de_unidad(p_codigo);
  end if;
  if char_length(v_nombre) not between 2 and 120 then
    raise exception 'Escribe el nombre de la etapa, por ejemplo Habilitado o Ensamblaje.' using errcode = 'check_violation';
  end if;
  if not public.area_de_etapa_de_diseno(p_area) then
    raise exception 'Las etapas de Diseño son de Maestranza (habilitado) o de Producción (ensamblaje). Las demás las agrega cada área.'
      using errcode = 'check_violation';
  end if;
  if p_inicio_plan is not null and p_fin_plan is not null and p_fin_plan < p_inicio_plan then
    raise exception 'La fecha comprometida no puede ser anterior al inicio de la etapa.' using errcode = 'check_violation';
  end if;
  if p_id is not null and p_area is distinct from v_etapa.area_id
     and exists (select 1 from public.codigo_etapas s where s.padre_id = p_id and s.quitada_en is null) then
    raise exception 'La etapa «%» ya tiene subetapas de su área: no se cambia de área.', v_etapa.nombre using errcode = 'check_violation';
  end if;

  if p_id is null then
    perform pg_advisory_xact_lock(hashtext('codigo_etapas:' || v_codigo));
    insert into public.codigo_etapas (codigo_interno, orden, nombre, area_id, inicio_plan, fin_plan, creado_por)
    values (v_codigo, coalesce((select max(e.orden) from public.codigo_etapas e where e.codigo_interno = v_codigo), 0) + 1,
            v_nombre, p_area, p_inicio_plan, p_fin_plan, v_yo)
    returning id into v_id;
  else
    update public.codigo_etapas
       set nombre = v_nombre, area_id = p_area, inicio_plan = p_inicio_plan, fin_plan = p_fin_plan, actualizado_por = v_yo
     where id = p_id
    returning id into v_id;
  end if;
  return v_id;
end;
$$;
comment on function public.guardar_etapa_codigo(uuid, text, text, uuid, date, date) is
  'Diseño agrega (p_id vacío) o corrige una etapa suya de un código interno: nombre, área (Maestranza o Producción), inicio y fecha comprometida. Exige diseno.codigos.';
revoke all on function public.guardar_etapa_codigo(uuid, text, text, uuid, date, date) from public, anon;
grant execute on function public.guardar_etapa_codigo(uuid, text, text, uuid, date, date) to authenticated;

-- ¿Puede quien llama tocar esta etapa? Diseño las suyas; el supervisor, las que
-- su área agregó.
create or replace function public.puede_tocar_etapa(p_etapa public.codigo_etapas)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.usuario_actual() is null or public.es_admin()
      or (not p_etapa.de_area and public.tiene_permiso('diseno.codigos'))
      or (p_etapa.de_area and public.tiene_permiso('codigos_internos.area') and p_etapa.area_id is not null
          and public.puede_hoja_de_area(p_etapa.area_id));
$$;
revoke all on function public.puede_tocar_etapa(public.codigo_etapas) from public, anon, authenticated;

-- El supervisor agrega una subetapa debajo de una etapa de su área (p_padre), o
-- una etapa propia de su área (p_area), o corrige una que su área agregó (p_id).
create or replace function public.guardar_etapa_de_area(
  p_id uuid, p_codigo text, p_padre uuid, p_area uuid, p_nombre text, p_inicio_plan date, p_fin_plan date)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo     uuid := public.usuario_actual();
  v_codigo text;
  v_etapa  public.codigo_etapas%rowtype;
  v_padre  public.codigo_etapas%rowtype;
  v_area   uuid;
  v_nombre text := regexp_replace(btrim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
  v_id     uuid;
begin
  if not (public.es_admin() or public.tiene_permiso('codigos_internos.area')) then
    raise exception 'Las etapas de un área las agrega el supervisor de esa área.' using errcode = 'insufficient_privilege';
  end if;
  if char_length(v_nombre) not between 2 and 120 then
    raise exception 'Escribe el nombre de la etapa, por ejemplo Corte de planchas o Armado del chasis.' using errcode = 'check_violation';
  end if;
  if p_inicio_plan is not null and p_fin_plan is not null and p_fin_plan < p_inicio_plan then
    raise exception 'La fecha comprometida no puede ser anterior al inicio de la etapa.' using errcode = 'check_violation';
  end if;

  if p_id is not null then
    select * into v_etapa from public.codigo_etapas where id = p_id for update;
    if not found or v_etapa.quitada_en is not null then
      raise exception 'Esa etapa ya no está. Vuelve a cargar la pantalla.' using errcode = 'check_violation';
    end if;
    if not v_etapa.de_area then
      raise exception 'La etapa «%» la puso Diseño: la corrige Diseño. Agrégale tus subetapas.', v_etapa.nombre using errcode = 'check_violation';
    end if;
    if not public.puede_tocar_etapa(v_etapa) then
      raise exception 'La etapa «%» es de otra área: la corrige su supervisor.', v_etapa.nombre using errcode = 'check_violation';
    end if;
    update public.codigo_etapas
       set nombre = v_nombre, inicio_plan = p_inicio_plan, fin_plan = p_fin_plan, actualizado_por = v_yo
     where id = p_id
    returning id into v_id;
    return v_id;
  end if;

  if p_padre is not null then
    select * into v_padre from public.codigo_etapas where id = p_padre for update;
    if not found or v_padre.quitada_en is not null then
      raise exception 'Esa etapa ya no está. Vuelve a cargar la pantalla.' using errcode = 'check_violation';
    end if;
    if v_padre.padre_id is not null then
      raise exception 'Una subetapa no lleva subetapas: agrégala debajo de «%».',
        (select p.nombre from public.codigo_etapas p where p.id = v_padre.padre_id) using errcode = 'check_violation';
    end if;
    if v_padre.area_id is null or not public.puede_hoja_de_area(v_padre.area_id) then
      raise exception 'La etapa «%» es de otra área: sus subetapas las agrega su supervisor.', v_padre.nombre using errcode = 'check_violation';
    end if;
    v_codigo := v_padre.codigo_interno;
    v_area := v_padre.area_id;
  else
    v_codigo := public.exigir_codigo_de_unidad(p_codigo);
    if p_area is null or not exists (select 1 from public.areas a where a.id = p_area and a.activo) then
      raise exception 'Elige el área que hace la etapa.' using errcode = 'check_violation';
    end if;
    if not public.puede_hoja_de_area(p_area) then
      raise exception 'Solo agregas etapas de tu área.' using errcode = 'check_violation';
    end if;
    v_area := p_area;
  end if;

  perform pg_advisory_xact_lock(hashtext('codigo_etapas:' || v_codigo));
  insert into public.codigo_etapas (codigo_interno, orden, nombre, area_id, inicio_plan, fin_plan, creado_por, padre_id, de_area)
  values (v_codigo, coalesce((select max(e.orden) from public.codigo_etapas e where e.codigo_interno = v_codigo), 0) + 1,
          v_nombre, v_area, p_inicio_plan, p_fin_plan, v_yo, p_padre, true)
  returning id into v_id;
  return v_id;
end;
$$;
comment on function public.guardar_etapa_de_area(uuid, text, uuid, uuid, text, date, date) is
  'El supervisor de un área agrega una subetapa (p_padre, una etapa de arriba de su área), una etapa propia de su área (p_codigo y p_area) o corrige una que su área agregó (p_id). Exige codigos_internos.area.';
revoke all on function public.guardar_etapa_de_area(uuid, text, uuid, uuid, text, date, date) from public, anon;
grant execute on function public.guardar_etapa_de_area(uuid, text, uuid, uuid, text, date, date) to authenticated;

-- Subir o bajar una etapa un lugar, entre sus hermanas (las de arriba, o las
-- subetapas de la misma etapa).
create or replace function public.mover_etapa_codigo(p_id uuid, p_arriba boolean)
returns uuid language plpgsql security definer set search_path to 'public' as $$
-- obs-diseno-2026-11-06
declare
  v_etapa public.codigo_etapas%rowtype;
  v_otra  public.codigo_etapas%rowtype;
begin
  perform public.exigir_ver_codigos_de_diseno();
  select * into v_etapa from public.codigo_etapas where id = p_id and quitada_en is null for update;
  if not found then
    raise exception 'Esa etapa ya no está. Vuelve a cargar la pantalla.' using errcode = 'check_violation';
  end if;
  if not public.puede_tocar_etapa(v_etapa) then
    raise exception 'La etapa «%» la mueve %.', v_etapa.nombre,
      case when v_etapa.de_area then 'el supervisor de su área' else 'Diseño' end using errcode = 'check_violation';
  end if;
  select * into v_otra from public.codigo_etapas e
   where e.codigo_interno = v_etapa.codigo_interno and e.quitada_en is null
     and e.padre_id is not distinct from v_etapa.padre_id
     and case when p_arriba then e.orden < v_etapa.orden else e.orden > v_etapa.orden end
   order by case when p_arriba then -e.orden else e.orden end
   limit 1
   for update;
  if not found then
    return p_id;
  end if;
  update public.codigo_etapas set orden = v_otra.orden, actualizado_por = public.usuario_actual() where id = v_etapa.id;
  update public.codigo_etapas set orden = v_etapa.orden, actualizado_por = public.usuario_actual() where id = v_otra.id;
  return p_id;
end;
$$;
revoke all on function public.mover_etapa_codigo(uuid, boolean) from public, anon;
grant execute on function public.mover_etapa_codigo(uuid, boolean) to authenticated;

-- Quitar: Diseño las suyas, el supervisor las que agregó su área. Una etapa con
-- subetapas vigentes no se quita: primero se quitan ellas.
create or replace function public.quitar_etapa_codigo(p_id uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $$
-- obs-diseno-2026-11-06
declare
  v_etapa public.codigo_etapas%rowtype;
begin
  perform public.exigir_ver_codigos_de_diseno();
  select * into v_etapa from public.codigo_etapas where id = p_id for update;
  if not found then
    raise exception 'Esa etapa no existe. Vuelve a cargar la pantalla.' using errcode = 'check_violation';
  end if;
  if v_etapa.quitada_en is not null then
    return p_id;
  end if;
  if not public.puede_tocar_etapa(v_etapa) then
    raise exception 'La etapa «%» la quita %.', v_etapa.nombre,
      case when v_etapa.de_area then 'el supervisor de su área' else 'Diseño' end using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.codigo_etapas s where s.padre_id = p_id and s.quitada_en is null) then
    raise exception 'La etapa «%» tiene subetapas de su área: primero las quita su supervisor.', v_etapa.nombre
      using errcode = 'check_violation';
  end if;
  update public.codigo_etapas set quitada_en = now(), quitada_por = public.usuario_actual() where id = p_id;
  return p_id;
end;
$$;
revoke all on function public.quitar_etapa_codigo(uuid) from public, anon;
grant execute on function public.quitar_etapa_codigo(uuid) to authenticated;

-- El avance: las etapas de arriba. La que tiene subetapas vale su promedio (100
-- la terminada; las demás, lo que reporta su área), salvo que ya terminó.
create or replace function public.codigo_interno_avance_calculado(p_codigo text)
returns table (codigo text, peso numeric, de_planos numeric, resto numeric, resto_por text,
               etapas integer, etapas_terminadas integer, trabajos integer, trabajos_terminados integer, ultimo_reporte date)
language sql stable set search_path to 'public' as $$
  -- obs-diseno-2026-11-06
  with actividad as (
    select a.*, exists (select 1 from public.codigo_planos p
                         where p.id = a.plano_id and p.anulado_en is null and p.peso > 0) as de_plano
      from public.codigo_interno_actividades_estado(p_codigo) a
  ), toda_etapa as (
    select e.*, x.padre_id,
           case when e.fin_real is not null then 100 else coalesce(e.avance_reportado, 0) end as valor
      from public.codigo_interno_etapas_calculado(p_codigo) e
      join public.codigo_etapas x on x.id = e.id
  ), de_sus_subetapas as (
    select s.padre_id, avg(s.valor) as valor from toda_etapa s where s.padre_id is not null group by s.padre_id
  ), etapa as (
    select e.codigo,
           count(*)::integer as etapas,
           count(*) filter (where e.fin_real is not null)::integer as terminadas,
           avg(case when e.fin_real is not null then 100 else coalesce(s.valor, e.valor) end) as avance
      from toda_etapa e
      left join de_sus_subetapas s on s.padre_id = e.id
     where e.padre_id is null
     group by e.codigo
  ), trabajo as (
    select a.codigo, count(*)::integer as trabajos, count(*) filter (where a.avance >= 100)::integer as terminados,
           avg(a.avance) filter (where not a.de_plano) as avance, max(a.ultima_fecha) as ultimo
      from actividad a group by a.codigo
  ), plano as (
    select k.codigo, sum(k.peso) as peso, sum(k.peso * k.avance / 100) as aporte
      from public.codigo_interno_avance_planos_calculado(p_codigo) k
     group by k.codigo
     having sum(k.peso) > 0
  ), codigos as (
    select e.codigo from etapa e union select t.codigo from trabajo t union select p.codigo from plano p
  )
  select c.codigo, coalesce(p.peso, 0), coalesce(p.aporte, 0), coalesce(e.avance, t.avance, 0),
         case when e.codigo is not null then 'ETAPAS' else 'ACTIVIDADES' end,
         coalesce(e.etapas, 0), coalesce(e.terminadas, 0),
         coalesce(t.trabajos, 0), coalesce(t.terminados, 0), t.ultimo
    from codigos c
    left join etapa e on e.codigo = c.codigo
    left join trabajo t on t.codigo = c.codigo
    left join plano p on p.codigo = c.codigo
   where c.codigo is not null and c.codigo <> 'PLANTA'
$$;
comment on function public.codigo_interno_avance_calculado(text) is
  'Las dos partes del avance de cada código (o de uno): el peso repartido en planos y lo que aportan, y el avance (0 a 100) de lo que no se repartió, por las etapas de arriba (la que tiene subetapas, por el promedio de ellas) o por actividades. No pide permiso: la llaman las funciones del avance.';
revoke all on function public.codigo_interno_avance_calculado(text) from public, anon, authenticated;

-- La lista de Diseño cuenta las etapas de arriba; vencidas, todas.
CREATE OR REPLACE FUNCTION public.codigos_internos_de_diseno()
 RETURNS TABLE(codigo text, unidad text, planos integer, planos_por_recibir integer, materiales integer, etapas integer, etapas_terminadas integer, etapas_vencidas integer, etapa_actual text, etapa_actual_area text, etapa_actual_fin date, ultimo_cambio timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
-- obs-diseno-2026-11-06
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
           where c.codigo_interno is not null and c.aprobacion not in ('RECHAZADA', 'ANULADA')
    union select public.normalizar_codigo_interno(s.codigo_interno) from public.ordenes_servicio s
           where s.codigo_interno is not null and s.estado <> 'ANULADA'
    union select public.normalizar_codigo_interno(d.codigo_interno) from public.reportes_diarios d where d.anulado_en is null
    union select public.normalizar_codigo_interno(v.codigo_interno) from public.registro_vehiculos v
           where v.codigo_interno is not null and v.anulado_en is null
    union select p.codigo_interno from public.codigo_planos p
    union select m.codigo_interno from public.codigo_materiales m where m.quitado_en is null
    union select e.codigo_interno from public.codigo_etapas e where e.quitada_en is null
    union select x.codigo_interno from public.codigo_dxf x where x.quitado_en is null
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
    select e.codigo_interno as codigo, (count(*) filter (where e.padre_id is null))::integer as etapas,
           (count(*) filter (where e.padre_id is null and e.fin_real is not null))::integer as terminadas,
           count(*) filter (where e.fin_real is null and e.fin_plan < v_hoy)::integer as vencidas,
           max(e.actualizado_en) as cambio
      from public.codigo_etapas e where e.quitada_en is null group by e.codigo_interno
  ), actual as (
    select distinct on (e.codigo_interno) e.codigo_interno as codigo, e.nombre, a.nombre as area, e.fin_plan
      from public.codigo_etapas e
      left join public.areas a on a.id = e.area_id
     where e.quitada_en is null and e.fin_real is null and e.padre_id is null
     order by e.codigo_interno, e.orden
  ), dxf as (
    select x.codigo_interno as codigo, max(x.actualizado_en) as cambio
      from public.codigo_dxf x where x.quitado_en is null group by x.codigo_interno
  )
  select c.codigo, u.texto, coalesce(p.planos, 0), coalesce(p.por_recibir, 0), coalesce(m.materiales, 0),
         coalesce(e.etapas, 0), coalesce(e.terminadas, 0), coalesce(e.vencidas, 0), ac.nombre::text, ac.area::text, ac.fin_plan,
         nullif(greatest(coalesce(p.cambio, '-infinity'), coalesce(m.cambio, '-infinity'), coalesce(e.cambio, '-infinity'),
                         coalesce(x.cambio, '-infinity')), '-infinity')
    from conocido c
    left join unidad u on u.codigo = c.codigo
    left join plano p on p.codigo = c.codigo
    left join material m on m.codigo = c.codigo
    left join etapa e on e.codigo = c.codigo
    left join actual ac on ac.codigo = c.codigo
    left join dxf x on x.codigo = c.codigo
   where c.codigo is not null and c.codigo <> 'PLANTA'
   order by 12 desc nulls last, 1;
end;
$function$;

-- El plano cuenta 100 % cuando la etapa de su área está terminada. Desde ahora
-- se mira la etapa de arriba: una subetapa abierta no le quita al plano lo que
-- su supervisor ya dio por terminado, igual que en el avance de la unidad.
create or replace function public.codigo_interno_avance_planos_calculado(p_codigo text)
returns table(plano_id uuid, codigo text, numero text, nombre text, area_id uuid, area text, peso numeric, avance numeric,
              aporte numeric, por_etapa boolean, ultima_fecha date, reportes integer)
language sql
stable
set search_path to 'public'
as $function$
  -- obs-diseno-2026-11-06
  with plano as (
    select p.* from public.codigo_planos p
     where p.anulado_en is null and p.peso is not null
       and (public.normalizar_codigo_interno(p_codigo) is null or p.codigo_interno = public.normalizar_codigo_interno(p_codigo))
  ), etapa_area as (
    select e.codigo_interno as codigo, e.area_id, bool_and(e.fin_real is not null) as terminada
      from public.codigo_etapas e
     where e.quitada_en is null and e.area_id is not null and e.padre_id is null
     group by 1, 2
  ), estado as (
    select * from public.codigo_interno_actividades_estado(p_codigo) where plano_id is not null
  )
  select p.id, p.codigo_interno, p.numero, p.nombre, p.area_id, a.nombre::text, p.peso,
         x.avance, round(p.peso * x.avance / 100, 2), coalesce(ea.terminada, false), e.ultima_fecha, coalesce(e.reportes, 0)
    from plano p
    join public.areas a on a.id = p.area_id
    left join etapa_area ea on ea.codigo = p.codigo_interno and ea.area_id = p.area_id
    left join estado e on e.plano_id = p.id
    cross join lateral (select case when ea.terminada then 100::numeric else coalesce(e.avance, 0) end as avance) x
$function$;

-- 5. Comprobación --------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
                  where r.codigo = 'DISENO_COLABORADOR' and rp.permiso_codigo = 'requerimientos.emitir') then
    raise exception 'El colaborador de Diseño no quedó con requerimientos.emitir';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'planos_subir'
                    and with_check not like '%diseno.subir_pdf%') then
    raise exception 'planos_subir sigue dejando subir al colaborador';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ot_adjuntos' and policyname = 'crear_ot_adjuntos'
                    and with_check like '%FICHA_VEHICULO%') then
    raise exception 'crear_ot_adjuntos no quedó con la ficha del vehículo';
  end if;
end $$;
