-- =============================================================================
-- CALIDAD: LA INSPECCIÓN POR CÓDIGO INTERNO Y ETAPA
-- -----------------------------------------------------------------------------
-- DKS pidió el 2026-11-26 (plan «Las demás áreas», entrega A.1) que Calidad
-- tenga lo mínimo para trabajar en el sistema. El SIG no tiene todavía un
-- formato de Calidad ni su numeración (docs/ANALISIS-ONEDRIVE.md: solo el
-- flujo «Calidad revisa ─ no conforme → el área corrige» y la etapa 13,
-- «Pruebas de la unidad · Control de calidad»), así que se propuso lo mínimo y
-- DKS lo aceptó con un «ok»:
--
--   * EL PUESTO YA EXISTÍA (rol CALIDAD, «Control de calidad»), con su menú de
--     consulta. Se le suma registrar inspecciones y ver los códigos internos
--     en lectura (codigos_internos.seguimiento: sin montos). No se crea ni se
--     asigna ninguna cuenta.
--   * LA INSPECCIÓN: Calidad elige el código interno y una de sus etapas (la
--     que Diseño armó en Etapas), o el área si el código no tiene etapas, y
--     anota «Conforme» o «No conforme». Lo no conforme lleva su observación y
--     hasta cuatro fotos, y LE LLEGA AL ÁREA: a su cuenta responsable (A.0,
--     responsable_del_area) o, si no tiene, a las cuentas activas del área.
--   * NO BLOQUEA LA ETAPA SIGUIENTE: registra y avisa. Nada de esta migración
--     toca las etapas, sus fechas ni el avance.
--   * EL ÁREA MARCA «CORREGIDO» con una nota o una foto, y Calidad lo levanta o
--     lo vuelve a observar. Cada paso queda anotado, con quién y cuándo.
--   * NO LLEVA NÚMERO (el SIG no tiene serie de Calidad; cuando la tenga, el
--     formato será MW-FOR-CAL-1) y NO SE BORRA: Calidad la anula con su motivo
--     y queda como evidencia.
--   * QUIÉN VE: Calidad todas; Gerencia todas, en consulta (calidad.ver); cada
--     área las suyas, sin las anuladas. Las pantallas nombran el puesto, no la
--     persona (migración 109).
--
-- Lo que la migración 094 retiró (ot_inspecciones, ot_inspeccion_items y los
-- permisos calidad.ver y calidad.inspeccionar) era una inspección por OT con
-- su lista de ítems, que no estaba en el circuito y solo tenía datos de prueba.
-- No se restaura: esta va por código interno y etapa, como trabaja hoy la
-- planta, y no lleva lista de ítems. Los dos permisos vuelven con su nombre.
--
-- Las tablas se escriben solo por las funciones de abajo. Sin DROP: el conector
-- de producción no deja pasar ninguno.
-- =============================================================================

-- 1. Permisos -----------------------------------------------------------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('calidad.inspeccionar', 'CALIDAD',
   'Registrar la inspección de una etapa de un código interno (conforme o no conforme, con fotos), levantar o volver a observar lo que el área corrigió y anular una inspección con su motivo'),
  ('calidad.ver', 'CALIDAD',
   'Consultar todas las inspecciones de calidad, con sus fotos y su recorrido, sin registrar')
on conflict (codigo) do update set modulo = excluded.modulo, descripcion = excluded.descripcion;

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, p.codigo from public.roles r cross join public.permisos p
 where (r.codigo = 'CALIDAD' and p.codigo in ('calidad.inspeccionar', 'codigos_internos.seguimiento'))
    or (r.codigo = 'GERENTE' and p.codigo = 'calidad.ver')
on conflict do nothing;

-- 2. La inspección ---------------------------------------------------------------------------
create table if not exists public.calidad_inspecciones (
  id                uuid primary key default gen_random_uuid(),
  codigo_interno    text not null,
  -- La etapa que Diseño armó para ese código. Vacía si el código no tiene etapas:
  -- entonces Calidad elige el área. Ni (a) ni (b) ni (c): la pantalla no filtra
  -- por etapa y una etapa no se borra (se quita con quitada_en).
  codigo_etapa_id   uuid references public.codigo_etapas(id) on delete restrict,
  area_id           uuid not null references public.areas(id) on delete restrict,
  resultado         text not null,
  observacion       text,
  estado            text not null,
  registrado_por    uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  anulado_por       uuid references public.usuarios(id) on delete restrict,
  anulado_en        timestamptz,
  motivo_anulacion  text,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),
  constraint ck_calidad_inspeccion_datos check (
    codigo_interno = upper(btrim(codigo_interno)) and char_length(codigo_interno) between 2 and 60
    and resultado in ('CONFORME', 'NO_CONFORME')
    and (observacion is null or char_length(observacion) <= 2000)
    and (resultado = 'CONFORME' or char_length(btrim(coalesce(observacion, ''))) >= 10)),
  constraint ck_calidad_inspeccion_estado check (
    estado in ('CONFORME', 'OBSERVADA', 'CORREGIDA', 'LEVANTADA', 'ANULADA')
    and (estado = 'ANULADA' or (resultado = 'CONFORME') = (estado = 'CONFORME'))
    and ((estado <> 'ANULADA' and anulado_en is null and anulado_por is null and motivo_anulacion is null)
         or (estado = 'ANULADA' and anulado_en is not null and anulado_por is not null
             and char_length(btrim(coalesce(motivo_anulacion, ''))) between 10 and 500)))
);
comment on table public.calidad_inspecciones is
  'La inspección de Calidad a una etapa de un código interno (o a un área, si el código no tiene etapas): conforme o no conforme. Lo no conforme le llega al área, que lo corrige; Calidad lo levanta o lo vuelve a observar (calidad_inspeccion_pasos). No lleva número, no bloquea la etapa siguiente y no se borra: Calidad la anula con su motivo.';
comment on column public.calidad_inspecciones.estado is
  'CONFORME · sin observación. OBSERVADA · no conforme, espera al área. CORREGIDA · el área dice que la corrigió, espera a Calidad. LEVANTADA · Calidad la dio por corregida. ANULADA · quedó sin efecto, con su motivo.';
-- La lista se lee de la más reciente a la más vieja (b).
create index if not exists ix_calidad_inspecciones_creado on public.calidad_inspecciones (creado_en desc);
-- «Las de tu área» (b); sirve también a su llave.
create index if not exists ix_calidad_inspecciones_area on public.calidad_inspecciones (area_id);
-- Las de un código interno (b).
create index if not exists ix_calidad_inspecciones_codigo on public.calidad_inspecciones (codigo_interno);
select public.activar_timestamps('calidad_inspecciones');
select public.activar_auditoria('calidad_inspecciones');
select public.activar_registro_de_prueba('calidad_inspecciones');

-- 3. Su recorrido: corregida, vuelta a observar, levantada ------------------------------------
create table if not exists public.calidad_inspeccion_pasos (
  id              uuid primary key default gen_random_uuid(),
  inspeccion_id   uuid not null references public.calidad_inspecciones(id) on delete restrict,
  tipo            text not null,
  nota            text,
  registrado_por  uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  -- La hora del reloj y no la de la transacción: el recorrido se ordena por ella.
  creado_en       timestamptz not null default clock_timestamp(),
  actualizado_en  timestamptz not null default now(),
  constraint ck_calidad_paso check (
    tipo in ('CORREGIDA', 'OBSERVADA_DE_NUEVO', 'LEVANTADA')
    and (nota is null or char_length(nota) <= 1000)
    and (tipo <> 'OBSERVADA_DE_NUEVO' or char_length(btrim(coalesce(nota, ''))) >= 10))
);
comment on table public.calidad_inspeccion_pasos is
  'Cada paso de una observación de calidad: el área la marca corregida (con nota o foto), Calidad la vuelve a observar (con nota) o la levanta. No se cambia ni se borra.';
-- El recorrido de una inspección, en orden (b); sirve también a su llave.
create index if not exists ix_calidad_pasos_inspeccion on public.calidad_inspeccion_pasos (inspeccion_id, creado_en);
select public.activar_timestamps('calidad_inspeccion_pasos');
select public.activar_auditoria('calidad_inspeccion_pasos');
select public.activar_registro_de_prueba('calidad_inspeccion_pasos');

-- 4. Las fotos -----------------------------------------------------------------------------
-- Las de la inspección llevan paso_id vacío; las de un paso, el suyo.
create table if not exists public.calidad_fotos (
  id              uuid primary key default gen_random_uuid(),
  inspeccion_id   uuid not null references public.calidad_inspecciones(id) on delete restrict,
  paso_id         uuid references public.calidad_inspeccion_pasos(id) on delete restrict,
  orden           smallint not null,
  ruta            text not null,
  mime_type       text not null,
  tamano_bytes    integer not null,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  -- También es el índice de la llave hacia la inspección.
  constraint uq_calidad_foto_orden unique nulls not distinct (inspeccion_id, paso_id, orden),
  -- Una foto, un registro; y la política de Storage la busca por su ruta.
  constraint uq_calidad_foto_ruta unique (ruta),
  constraint ck_calidad_foto check (
    orden between 1 and 4
    and mime_type in ('image/jpeg', 'image/png', 'image/webp')
    and tamano_bytes between 1 and 5242880)
);
comment on table public.calidad_fotos is
  'Hasta 4 fotos de una inspección de calidad y hasta 4 de cada paso, en el bucket fotos-calidad con la ruta {cuenta}/{inspección}/…. Las ve quien ve la inspección. No se cambian ni se borran.';
-- Las fotos de un paso (b); sirve también a su llave.
create index if not exists ix_calidad_fotos_paso on public.calidad_fotos (paso_id) where paso_id is not null;
select public.activar_timestamps('calidad_fotos');
select public.activar_registro_de_prueba('calidad_fotos');

-- 5. Lo que no se borra ni se corrige por debajo -------------------------------------------------
create or replace function public.fn_calidad_inspeccion_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
declare
  v_cambian constant text[] := array['estado', 'anulado_por', 'anulado_en', 'motivo_anulacion', 'actualizado_en'];
begin
  if tg_op = 'DELETE' then
    raise exception 'Una inspección de calidad no se borra: Calidad la anula con su motivo.' using errcode = 'check_violation';
  end if;
  if old.estado = 'ANULADA' then
    raise exception 'La inspección de % está anulada: queda como evidencia.', old.codigo_interno using errcode = 'check_violation';
  end if;
  if (to_jsonb(new) - v_cambian) is distinct from (to_jsonb(old) - v_cambian) then
    raise exception 'Lo que dice la inspección de % no se corrige: si está mal, Calidad la anula con su motivo y la registra de nuevo.', old.codigo_interno
      using errcode = 'check_violation';
  end if;
  -- La anulación se sella aquí: quién y cuándo los pone la base, y sin motivo no entra.
  if new.estado = 'ANULADA' then
    if char_length(btrim(coalesce(new.motivo_anulacion, ''))) < 10 then
      raise exception 'Para anular la inspección escribe el motivo (al menos 10 letras).' using errcode = 'check_violation';
    end if;
    new.motivo_anulacion := btrim(new.motivo_anulacion);
    new.anulado_por := coalesce(public.usuario_actual(), new.anulado_por);
    new.anulado_en := now();
  elsif (new.anulado_por, new.anulado_en, new.motivo_anulacion) is distinct from (old.anulado_por, old.anulado_en, old.motivo_anulacion) then
    raise exception 'La inspección no está anulada: quién, cuándo y el motivo se anotan solo al anularla.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_calidad_inspeccion_guardia() from public, anon, authenticated;
create or replace trigger trg_calidad_inspeccion_guardia
  before update or delete on public.calidad_inspecciones
  for each row execute function public.fn_calidad_inspeccion_guardia();

create or replace function public.fn_calidad_evidencia_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  raise exception 'El recorrido y las fotos de una inspección de calidad no se cambian ni se borran: quedan como evidencia.'
    using errcode = 'check_violation';
end;
$$;
revoke all on function public.fn_calidad_evidencia_guardia() from public, anon, authenticated;
create or replace trigger trg_calidad_paso_guardia
  before update or delete on public.calidad_inspeccion_pasos
  for each row execute function public.fn_calidad_evidencia_guardia();
create or replace trigger trg_calidad_foto_guardia
  before update or delete on public.calidad_fotos
  for each row execute function public.fn_calidad_evidencia_guardia();

-- 6. Quién ve qué -----------------------------------------------------------------------------
create or replace function public.puede_ver_toda_la_calidad()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.es_admin() or public.tiene_permiso('calidad.inspeccionar') or public.tiene_permiso('calidad.ver');
$$;
revoke all on function public.puede_ver_toda_la_calidad() from public, anon;
grant execute on function public.puede_ver_toda_la_calidad() to authenticated;

-- Del área es quien trabaja en ella (su cuenta activa lleva esa área) y su
-- cuenta responsable (A.0), aunque sea de otra área.
create or replace function public.calidad_es_del_area(p_area uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.usuarios u
                  where u.id = public.usuario_actual() and u.activo
                    and (u.area_id = p_area
                         or exists (select 1 from public.areas a where a.id = p_area and a.jefe_id = u.id)));
$$;
revoke all on function public.calidad_es_del_area(uuid) from public, anon;
grant execute on function public.calidad_es_del_area(uuid) to authenticated;

alter table public.calidad_inspecciones enable row level security;
alter table public.calidad_inspeccion_pasos enable row level security;
alter table public.calidad_fotos enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'calidad_inspecciones' and policyname = 'ver_calidad_inspecciones') then
    create policy ver_calidad_inspecciones on public.calidad_inspecciones for select to authenticated
      using ((select public.puede_ver_toda_la_calidad())
             or (estado <> 'ANULADA' and public.calidad_es_del_area(area_id)));
  end if;
  -- Quien ve la inspección ve su recorrido y sus fotos: la consulta pasa por la política de arriba.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'calidad_inspeccion_pasos' and policyname = 'ver_calidad_inspeccion_pasos') then
    create policy ver_calidad_inspeccion_pasos on public.calidad_inspeccion_pasos for select to authenticated
      using (exists (select 1 from public.calidad_inspecciones i where i.id = inspeccion_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'calidad_fotos' and policyname = 'ver_calidad_fotos') then
    create policy ver_calidad_fotos on public.calidad_fotos for select to authenticated
      using (exists (select 1 from public.calidad_inspecciones i where i.id = inspeccion_id));
  end if;
end $$;
-- Se escriben solo por las funciones de abajo: sin políticas de escritura ni grant.
revoke all on public.calidad_inspecciones from public, anon, authenticated;
revoke all on public.calidad_inspeccion_pasos from public, anon, authenticated;
revoke all on public.calidad_fotos from public, anon, authenticated;
grant select on public.calidad_inspecciones to authenticated;
grant select on public.calidad_inspeccion_pasos to authenticated;
grant select on public.calidad_fotos to authenticated;

-- 7. Las fotos en Storage ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos-calidad', 'fotos-calidad', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- «Ningún registro la nombra» se pregunta por encima del RLS.
create or replace function public.calidad_foto_anotada(p_ruta text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.calidad_fotos f where f.ruta = p_ruta);
$$;
revoke all on function public.calidad_foto_anotada(text) from public, anon;
grant execute on function public.calidad_foto_anotada(text) to authenticated;

-- La ruta es {cuenta}/{inspección}/{foto}: cada cuenta sube a su carpeta. Sube
-- quien inspecciona y quien corrige (una cuenta activa con área o responsable de
-- una). La foto la ve quien la subió y quien ve la inspección que la nombra; una
-- suelta la retira su dueño mientras nadie la nombre.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'calidad_subir_foto') then
    create policy calidad_subir_foto on storage.objects for insert to authenticated with check (
      bucket_id = 'fotos-calidad' and owner_id = (select auth.uid())::text
      and split_part(name, '/', 1) = (select auth.uid())::text
      and (select public.es_usuario_activo()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'calidad_ver_foto') then
    create policy calidad_ver_foto on storage.objects for select to authenticated using (
      bucket_id = 'fotos-calidad'
      and (owner_id = (select auth.uid())::text
           or exists (select 1 from public.calidad_fotos f where f.ruta = objects.name)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'calidad_quitar_foto_suelta') then
    create policy calidad_quitar_foto_suelta on storage.objects for delete to authenticated using (
      bucket_id = 'fotos-calidad' and owner_id = (select auth.uid())::text
      and not public.calidad_foto_anotada(objects.name));
  end if;
end $$;

-- p_fotos: ["{cuenta}/{inspección}/{foto}.jpg", …], ya subidas. De 0 a 4. La
-- llaman solo las funciones de abajo.
create or replace function public.calidad_anotar_fotos(p_inspeccion uuid, p_paso uuid, p_fotos jsonb)
returns integer language plpgsql set search_path to 'public' as $$
declare
  v_yo     uuid := public.usuario_actual();
  v_fotos  jsonb := coalesce(p_fotos, '[]'::jsonb);
  v_ruta   text;
  v_objeto storage.objects%rowtype;
  v_n      int := 0;
begin
  if jsonb_typeof(v_fotos) <> 'array' then
    raise exception 'Vuelve a poner las fotos.' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(v_fotos) > 4 then
    raise exception 'Van hasta 4 fotos.' using errcode = 'check_violation';
  end if;
  for v_ruta in select jsonb_array_elements_text(v_fotos) loop
    v_n := v_n + 1;
    if v_yo is null or v_ruta !~ ('^' || v_yo::text || '/' || p_inspeccion::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$') then
      raise exception 'Vuelve a poner las fotos.' using errcode = 'check_violation';
    end if;
    select * into v_objeto from storage.objects where bucket_id = 'fotos-calidad' and name = v_ruta;
    if not found or v_objeto.owner_id is distinct from v_yo::text
       or v_objeto.metadata->>'mimetype' not in ('image/jpeg', 'image/png', 'image/webp')
       or coalesce((v_objeto.metadata->>'size')::bigint, 0) not between 1 and 5242880 then
      raise exception 'La foto % no terminó de subir: quítala y vuelve a ponerla.', v_n using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.calidad_fotos where ruta = v_ruta) then
      raise exception 'La foto % está repetida: quítala.', v_n using errcode = 'check_violation';
    end if;
    insert into public.calidad_fotos (inspeccion_id, paso_id, orden, ruta, mime_type, tamano_bytes)
    values (p_inspeccion, p_paso, v_n, v_ruta, v_objeto.metadata->>'mimetype', (v_objeto.metadata->>'size')::integer);
  end loop;
  return v_n;
end;
$$;
revoke all on function public.calidad_anotar_fotos(uuid, uuid, jsonb) from public, anon, authenticated;

-- 8. Qué se inspecciona -------------------------------------------------------------------------
-- Los códigos internos que siguen en la planta: los de una OT que no está
-- anulada ni entregada, y los que Diseño ya tiene en Etapas. El mantenimiento y
-- la garantía van por el número de su OT (migración 20261120500000).
create or replace function public.calidad_codigos_para_inspeccionar()
returns table (codigo text, ot_numero text, cliente text, unidad text, etapas integer)
language plpgsql stable security definer set search_path to 'public' rows 100 as $$
begin
  if public.usuario_actual() is null or not (public.es_admin() or public.tiene_permiso('calidad.inspeccionar')) then
    raise exception 'No tienes permiso para registrar inspecciones de calidad.' using errcode = 'insufficient_privilege';
  end if;
  return query
  with de_ot as (
    select c.codigo, o.numero::text as numero, o.estado::text as estado, o.fecha_entrega_comprometida, o.fecha_registro,
           cl.razon_social::text as cliente,
           nullif(concat_ws(' · ', nullif(btrim(coalesce(u.placa::text, '')), ''), tc.nombre::text), '') as unidad
      from public.ordenes_trabajo o
      left join public.unidades u on u.id = o.unidad_id
      cross join lateral (select public.normalizar_codigo_interno(
                                   case when o.tipo_trabajo::text in ('MANTENIMIENTO', 'GARANTIA')
                                        then public.codigo_de_la_ot(o.numero) else u.codigo_interno end) as codigo) c
      left join public.clientes cl on cl.id = o.cliente_id
      left join public.tipos_carroceria tc on tc.id = u.tipo_carroceria_id
     where o.estado::text <> 'ANULADA' and c.codigo is not null
  ), abierta as (
    -- Con dos OT abiertas para el mismo código manda la que se entrega antes.
    select distinct on (d.codigo) d.codigo, d.numero, d.cliente, d.unidad
      from de_ot d
     where d.estado not in ('ENTREGADA', 'FACTURADA')
     order by d.codigo, d.fecha_entrega_comprometida nulls last, d.fecha_registro nulls last, d.numero
  ), con_etapas as (
    select e.codigo_interno as codigo, count(*) filter (where e.padre_id is null)::integer as etapas
      from public.codigo_etapas e
     where e.quitada_en is null
     group by e.codigo_interno
  ), codigos as (
    select a.codigo from abierta a
    union
    -- Un código con etapas y sin OT abierta entra si nunca se entregó.
    select ce.codigo from con_etapas ce
     where not exists (select 1 from de_ot d where d.codigo = ce.codigo and d.estado in ('ENTREGADA', 'FACTURADA'))
  )
  select k.codigo, a.numero, a.cliente, a.unidad, coalesce(ce.etapas, 0)
    from codigos k
    left join abierta a on a.codigo = k.codigo
    left join con_etapas ce on ce.codigo = k.codigo
   where k.codigo <> 'PLANTA'
   order by k.codigo;
end;
$$;
comment on function public.calidad_codigos_para_inspeccionar() is
  'Los códigos internos que Calidad puede inspeccionar: los de una OT abierta y los que tienen etapas sin haberse entregado, con su OT, cliente, unidad y cuántas etapas. Exige calidad.inspeccionar.';
revoke all on function public.calidad_codigos_para_inspeccionar() from public, anon;
grant execute on function public.calidad_codigos_para_inspeccionar() to authenticated;

-- Las etapas vivas de un código (o de todos, con p_codigo vacío), con su área:
-- la etapa decide a qué área va la observación.
create or replace function public.calidad_etapas_del_codigo(p_codigo text)
returns table (id uuid, codigo text, orden smallint, nombre text, padre_id uuid, area_id uuid, area text, terminada boolean)
language plpgsql stable security definer set search_path to 'public' rows 100 as $$
declare
  v_codigo text := public.normalizar_codigo_interno(p_codigo);
begin
  if public.usuario_actual() is null or not (public.es_admin() or public.tiene_permiso('calidad.inspeccionar')) then
    raise exception 'No tienes permiso para registrar inspecciones de calidad.' using errcode = 'insufficient_privilege';
  end if;
  return query
    select e.id, e.codigo_interno, e.orden, e.nombre, e.padre_id, e.area_id, a.nombre::text, e.fin_real is not null
      from public.codigo_etapas e
      left join public.areas a on a.id = e.area_id
     where e.quitada_en is null and (v_codigo is null or e.codigo_interno = v_codigo)
     order by e.codigo_interno, e.orden;
end;
$$;
comment on function public.calidad_etapas_del_codigo(text) is
  'Las etapas vivas de un código interno (de todos, con p_codigo vacío) con su área, para elegir qué se inspecciona. Exige calidad.inspeccionar.';
revoke all on function public.calidad_etapas_del_codigo(text) from public, anon;
grant execute on function public.calidad_etapas_del_codigo(text) to authenticated;

-- 9. A quién le llega ---------------------------------------------------------------------------
-- Al área: a su cuenta responsable o, si no tiene, a sus cuentas activas. Si el
-- área no tiene a nadie, a Gerencia (calidad.ver), para que no se pierda. Dice a
-- quién llegó: RESPONSABLE, AREA, GERENCIA o NADIE.
create or replace function public.calidad_avisar_al_area(p_inspeccion uuid, p_titulo text, p_cuerpo text)
returns text language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo     uuid := public.usuario_actual();
  v_area   public.areas%rowtype;
  v_jefe   uuid;
  v_n      integer;
begin
  select a.* into v_area from public.areas a join public.calidad_inspecciones i on i.area_id = a.id where i.id = p_inspeccion;
  v_jefe := public.responsable_del_area(v_area.codigo);
  if v_jefe is not null then
    if v_jefe is distinct from v_yo then
      insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
      values (v_jefe, left(p_titulo, 200), left(p_cuerpo, 500), '/calidad/' || p_inspeccion::text, 'calidad_inspecciones', p_inspeccion);
    end if;
    return 'RESPONSABLE';
  end if;
  insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
  select u.id, left(p_titulo, 200), left(p_cuerpo, 500), '/calidad/' || p_inspeccion::text, 'calidad_inspecciones', p_inspeccion
    from public.usuarios u
   where u.activo and u.area_id = v_area.id and u.id is distinct from v_yo;
  get diagnostics v_n = row_count;
  if v_n > 0 then return 'AREA'; end if;
  if exists (select 1 from public.usuarios u where u.activo and u.area_id = v_area.id) then return 'AREA'; end if;
  select count(*) into v_n from public.notificaciones n
   where n.origen_tabla = 'calidad_inspecciones' and n.origen_id = p_inspeccion;
  perform public.avisar_a_permiso('calidad.ver', left(p_titulo || ' (el área no tiene cuenta activa)', 200), p_cuerpo,
    '/calidad/' || p_inspeccion::text, 'calidad_inspecciones', p_inspeccion);
  return case when (select count(*) from public.notificaciones n
                     where n.origen_tabla = 'calidad_inspecciones' and n.origen_id = p_inspeccion) > v_n
              then 'GERENCIA' else 'NADIE' end;
end;
$$;
revoke all on function public.calidad_avisar_al_area(uuid, text, text) from public, anon, authenticated;

-- 10. Inspeccionar ---------------------------------------------------------------------------------
-- Un reintento con el mismo p_id y lo mismo devuelve la que ya entró; con otra
-- cosa, dice que ya quedó.
create or replace function public.calidad_inspeccionar(
  p_id uuid, p_codigo text, p_etapa uuid, p_area uuid, p_resultado text, p_observacion text, p_fotos jsonb
) returns table (inspeccion uuid, avisado text)
language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo      uuid := public.usuario_actual();
  v_envio   constant jsonb := jsonb_build_array(p_codigo, p_etapa, p_area, p_resultado, p_observacion, p_fotos);
  v_codigo  text := public.normalizar_codigo_interno(p_codigo);
  v_obs     text := nullif(btrim(coalesce(p_observacion, '')), '');
  v_actual  public.calidad_inspecciones%rowtype;
  v_etapa   public.codigo_etapas%rowtype;
  v_area    public.areas%rowtype;
  v_que     text;
  v_avisado text := 'NADIE';
begin
  if v_yo is null or not public.es_usuario_activo() or not (public.es_admin() or public.tiene_permiso('calidad.inspeccionar')) then
    raise exception 'No tienes permiso para registrar inspecciones de calidad.' using errcode = 'insufficient_privilege';
  end if;
  if p_id is null then
    raise exception 'Vuelve a abrir el formulario de la inspección.' using errcode = 'check_violation';
  end if;
  select * into v_actual from public.calidad_inspecciones where id = p_id;
  if found then
    if v_actual.registrado_por = v_yo and public.mismo_envio(p_id, 'INSPECCION_CALIDAD', v_envio) then
      return query select v_actual.id,
        case when v_actual.resultado = 'CONFORME' then 'NADIE'
             when exists (select 1 from public.notificaciones n join public.usuarios u on u.id = n.usuario_id
                           where n.origen_tabla = 'calidad_inspecciones' and n.origen_id = p_id
                             and u.id = public.responsable_del_area((select a.codigo from public.areas a where a.id = v_actual.area_id)))
               then 'RESPONSABLE'
             else 'AREA' end;
      return;
    end if;
    if v_actual.registrado_por = v_yo then
      raise exception 'La inspección ya quedó registrada la primera vez que la enviaste: lo que cambiaste después no se guardó. Si está mal, anúlala con su motivo y regístrala de nuevo.'
        using errcode = 'check_violation';
    end if;
    raise exception 'Esa inspección ya existe con otros datos: vuelve a abrir el formulario.' using errcode = 'unique_violation';
  end if;

  if v_codigo is null or not exists (select 1 from public.calidad_codigos_para_inspeccionar() c where c.codigo = v_codigo) then
    raise exception 'Elige un código interno de la lista: el que escribiste no tiene una OT abierta ni etapas.' using errcode = 'check_violation';
  end if;
  if p_etapa is not null then
    select * into v_etapa from public.codigo_etapas e where e.id = p_etapa and e.quitada_en is null;
    if not found or v_etapa.codigo_interno <> v_codigo then
      raise exception 'Esa etapa ya no es de %: vuelve a elegirla.', v_codigo using errcode = 'check_violation';
    end if;
    if v_etapa.area_id is not null then
      if p_area is not null and p_area <> v_etapa.area_id then
        raise exception 'La etapa «%» es de otra área: la observación va al área de la etapa.', v_etapa.nombre using errcode = 'check_violation';
      end if;
      p_area := v_etapa.area_id;
    end if;
  elsif exists (select 1 from public.codigo_etapas e where e.codigo_interno = v_codigo and e.quitada_en is null) then
    raise exception 'Elige la etapa de % que inspeccionaste.', v_codigo using errcode = 'check_violation';
  end if;
  select * into v_area from public.areas where id = p_area and activo;
  if not found then
    raise exception 'Elige el área que hizo el trabajo.' using errcode = 'check_violation';
  end if;
  if p_resultado is null or p_resultado not in ('CONFORME', 'NO_CONFORME') then
    raise exception 'Marca si la etapa está conforme o no conforme.' using errcode = 'check_violation';
  end if;
  if p_resultado = 'NO_CONFORME' and char_length(coalesce(v_obs, '')) < 10 then
    raise exception 'Escribe qué está no conforme, en al menos 10 caracteres: es lo que el área va a corregir.' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(v_obs, '')) > 2000 then
    raise exception 'La observación pasa de 2000 caracteres: acórtala.' using errcode = 'check_violation';
  end if;

  insert into public.calidad_inspecciones (id, codigo_interno, codigo_etapa_id, area_id, resultado, observacion, estado, registrado_por)
  values (p_id, v_codigo, p_etapa, v_area.id, p_resultado, v_obs,
          case when p_resultado = 'CONFORME' then 'CONFORME' else 'OBSERVADA' end, v_yo);
  perform public.calidad_anotar_fotos(p_id, null, p_fotos);
  perform public.anotar_envio(p_id, 'INSPECCION_CALIDAD', v_envio);

  if p_resultado = 'NO_CONFORME' then
    v_que := coalesce('«' || v_etapa.nombre || '» de ', '') || v_codigo;
    v_avisado := public.calidad_avisar_al_area(p_id, 'Calidad observó ' || v_que, v_obs);
  end if;
  return query select p_id, v_avisado;
end;
$$;
comment on function public.calidad_inspeccionar(uuid, text, uuid, uuid, text, text, jsonb) is
  'Calidad registra la inspección de una etapa de un código interno (o de un área, si el código no tiene etapas): conforme, o no conforme con su observación y hasta 4 fotos, que le llega al área. Exige calidad.inspeccionar. No bloquea ninguna etapa.';
revoke all on function public.calidad_inspeccionar(uuid, text, uuid, uuid, text, text, jsonb) from public, anon;
grant execute on function public.calidad_inspeccionar(uuid, text, uuid, uuid, text, text, jsonb) to authenticated;

-- 11. Corregida, vuelta a observar, levantada --------------------------------------------------------
--   CORREGIDA           · el área (o su responsable), de una OBSERVADA, con nota o foto.
--   OBSERVADA_DE_NUEVO  · Calidad, de una CORREGIDA, con nota.
--   LEVANTADA           · Calidad, de una OBSERVADA o CORREGIDA.
create or replace function public.calidad_registrar_paso(
  p_id uuid, p_inspeccion uuid, p_tipo text, p_nota text, p_fotos jsonb
) returns table (paso uuid, estado text, avisado text)
language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo      uuid := public.usuario_actual();
  v_envio   constant jsonb := jsonb_build_array(p_inspeccion, p_tipo, p_nota, p_fotos);
  v_nota    text := nullif(btrim(coalesce(p_nota, '')), '');
  v_ins     public.calidad_inspecciones%rowtype;
  v_actual  public.calidad_inspeccion_pasos%rowtype;
  v_etapa   text;
  v_que     text;
  v_estado  text;
  v_fotos   integer;
  v_avisado text := 'NADIE';
  v_calidad boolean := public.es_admin() or public.tiene_permiso('calidad.inspeccionar');
begin
  if v_yo is null or not public.es_usuario_activo() then
    raise exception 'Entra con tu cuenta.' using errcode = 'insufficient_privilege';
  end if;
  if p_id is null then
    raise exception 'Vuelve a abrir el formulario.' using errcode = 'check_violation';
  end if;
  select * into v_actual from public.calidad_inspeccion_pasos where id = p_id;
  if found then
    if v_actual.registrado_por = v_yo and public.mismo_envio(p_id, 'PASO_CALIDAD', v_envio) then
      return query select v_actual.id, (select i.estado from public.calidad_inspecciones i where i.id = v_actual.inspeccion_id),
                          case when v_actual.tipo = 'CORREGIDA' then 'CALIDAD' else 'AREA' end;
      return;
    end if;
    raise exception 'Eso ya quedó registrado la primera vez que lo enviaste: lo que cambiaste después no se guardó.' using errcode = 'check_violation';
  end if;

  select * into v_ins from public.calidad_inspecciones where id = p_inspeccion for update;
  if not found then
    raise exception 'Esa inspección no existe.' using errcode = 'check_violation';
  end if;
  select e.nombre into v_etapa from public.codigo_etapas e where e.id = v_ins.codigo_etapa_id;
  v_que := coalesce('«' || v_etapa || '» de ', '') || v_ins.codigo_interno;

  if p_tipo = 'CORREGIDA' then
    if not (public.es_admin() or public.calidad_es_del_area(v_ins.area_id)) then
      raise exception 'Marca corregido solo el área que recibió la observación.' using errcode = 'insufficient_privilege';
    end if;
    if v_ins.estado <> 'OBSERVADA' then
      raise exception 'Esta observación ya no espera corrección: está %.',
        case v_ins.estado when 'CORREGIDA' then 'marcada corregida, la revisa Calidad' when 'LEVANTADA' then 'levantada'
                          when 'ANULADA' then 'anulada' else 'conforme' end
        using errcode = 'check_violation';
    end if;
    if v_nota is null and jsonb_array_length(coalesce(p_fotos, '[]'::jsonb)) = 0 then
      raise exception 'Cuenta qué se corrigió o pon una foto: Calidad la revisa con eso.' using errcode = 'check_violation';
    end if;
    if v_nota is not null and char_length(v_nota) < 5 then
      raise exception 'Cuenta qué se corrigió en al menos 5 caracteres.' using errcode = 'check_violation';
    end if;
    v_estado := 'CORREGIDA';
  elsif p_tipo in ('OBSERVADA_DE_NUEVO', 'LEVANTADA') then
    if not v_calidad then
      raise exception 'Solo Calidad levanta o vuelve a observar.' using errcode = 'insufficient_privilege';
    end if;
    if p_tipo = 'OBSERVADA_DE_NUEVO' and v_ins.estado <> 'CORREGIDA' then
      raise exception 'Se vuelve a observar lo que el área marcó corregido; esta está %.', lower(v_ins.estado) using errcode = 'check_violation';
    end if;
    if p_tipo = 'LEVANTADA' and v_ins.estado not in ('OBSERVADA', 'CORREGIDA') then
      raise exception 'Esta inspección no tiene una observación abierta: está %.', lower(v_ins.estado) using errcode = 'check_violation';
    end if;
    if p_tipo = 'OBSERVADA_DE_NUEVO' and char_length(coalesce(v_nota, '')) < 10 then
      raise exception 'Escribe qué sigue mal, en al menos 10 caracteres.' using errcode = 'check_violation';
    end if;
    v_estado := case p_tipo when 'LEVANTADA' then 'LEVANTADA' else 'OBSERVADA' end;
  else
    raise exception 'Ese paso no existe.' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(v_nota, '')) > 1000 then
    raise exception 'La nota pasa de 1000 caracteres: acórtala.' using errcode = 'check_violation';
  end if;

  insert into public.calidad_inspeccion_pasos (id, inspeccion_id, tipo, nota, registrado_por)
  values (p_id, p_inspeccion, p_tipo, v_nota, v_yo);
  v_fotos := public.calidad_anotar_fotos(p_inspeccion, p_id, p_fotos);
  update public.calidad_inspecciones set estado = v_estado where id = p_inspeccion;
  perform public.anotar_envio(p_id, 'PASO_CALIDAD', v_envio);

  if p_tipo = 'CORREGIDA' then
    perform public.avisar_a_permiso('calidad.inspeccionar', 'El área corrigió ' || v_que,
      coalesce(v_nota, v_fotos || ' foto' || case when v_fotos = 1 then '' else 's' end || ' de la corrección'),
      '/calidad/' || p_inspeccion::text, 'calidad_inspecciones', p_inspeccion);
    v_avisado := case when exists (select 1 from public.usuarios u
                                     join public.roles_permisos rp on rp.rol_id = u.rol_id and rp.permiso_codigo = 'calidad.inspeccionar'
                                    where u.activo and u.id <> v_yo) then 'CALIDAD' else 'NADIE' end;
  elsif p_tipo = 'OBSERVADA_DE_NUEVO' then
    v_avisado := public.calidad_avisar_al_area(p_inspeccion, 'Calidad volvió a observar ' || v_que, v_nota);
  else
    v_avisado := public.calidad_avisar_al_area(p_inspeccion, 'Calidad levantó la observación de ' || v_que,
      coalesce(v_nota, 'Quedó conforme.'));
  end if;
  return query select p_id, v_estado, v_avisado;
end;
$$;
comment on function public.calidad_registrar_paso(uuid, uuid, text, text, jsonb) is
  'Un paso de una observación de calidad: CORREGIDA (el área o su responsable, con nota o foto), OBSERVADA_DE_NUEVO (Calidad, con nota) o LEVANTADA (Calidad). Avisa al otro lado.';
revoke all on function public.calidad_registrar_paso(uuid, uuid, text, text, jsonb) from public, anon;
grant execute on function public.calidad_registrar_paso(uuid, uuid, text, text, jsonb) to authenticated;

-- 12. Anular ---------------------------------------------------------------------------------------
create or replace function public.calidad_anular_inspeccion(p_id uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo   uuid := public.usuario_actual();
  v_ins  public.calidad_inspecciones%rowtype;
begin
  if v_yo is null or not (public.es_admin() or public.tiene_permiso('calidad.inspeccionar')) then
    raise exception 'No tienes permiso para anular una inspección de calidad.' using errcode = 'insufficient_privilege';
  end if;
  if char_length(btrim(coalesce(p_motivo, ''))) not between 10 and 500 then
    raise exception 'Cuenta por qué se anula, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_ins from public.calidad_inspecciones where id = p_id for update;
  if not found then raise exception 'Esa inspección no existe.' using errcode = 'check_violation'; end if;
  if v_ins.estado = 'ANULADA' then
    -- El mismo pedido repetido (se perdió la respuesta) entra; con otro motivo se dice, no se finge.
    if v_ins.motivo_anulacion = btrim(p_motivo) then return p_id; end if;
    raise exception 'La inspección ya estaba anulada, con este motivo: «%». No se cambia.', v_ins.motivo_anulacion
      using errcode = 'check_violation';
  end if;
  update public.calidad_inspecciones
     set estado = 'ANULADA', anulado_por = v_yo, anulado_en = now(), motivo_anulacion = btrim(p_motivo)
   where id = p_id;
  -- Al área se le avisó de lo no conforme: se le avisa también que quedó sin efecto.
  if v_ins.resultado = 'NO_CONFORME' then
    perform public.calidad_avisar_al_area(p_id, 'Calidad anuló su observación de ' || v_ins.codigo_interno, btrim(p_motivo));
  end if;
  return p_id;
end;
$$;
comment on function public.calidad_anular_inspeccion(uuid, text) is
  'Calidad anula una inspección con su motivo; queda como evidencia y, si era no conforme, se le avisa al área. Exige calidad.inspeccionar.';
revoke all on function public.calidad_anular_inspeccion(uuid, text) from public, anon;
grant execute on function public.calidad_anular_inspeccion(uuid, text) to authenticated;

-- 13. Lo que cada quien lee ------------------------------------------------------------------------
-- Una sola lectura para la lista (p_id vacío) y el detalle. `alcance`:
--   TODOS · Calidad, Gerencia y el administrador.   AREA · el área de la inspección.
-- puede_corregir / puede_revisar dicen qué botón le toca a quien mira.
create or replace function public.calidad_inspecciones_visibles(p_id uuid)
returns table (
  id uuid, codigo_interno text, etapa text, etapa_orden smallint, area_id uuid, area_codigo text, area text,
  resultado text, observacion text, estado text, creado_en timestamptz, registro_puesto text,
  dias_abierta integer, ultimo_paso text, ultimo_paso_en timestamptz, fotos integer, pasos integer,
  alcance text, puede_corregir boolean, puede_revisar boolean,
  anulado_en timestamptz, anulo_puesto text, motivo_anulacion text)
language sql stable security definer set search_path to 'public' rows 200 as $$
  with yo as (
    select u.id, public.puede_ver_toda_la_calidad() as todo,
           public.es_admin() or public.tiene_permiso('calidad.inspeccionar') as calidad
      from public.usuarios u
     where u.id = public.usuario_actual() and u.activo
  ), visibles as (
    select i.*, public.calidad_es_del_area(i.area_id) as del_area, yo.todo, yo.calidad
      from public.calidad_inspecciones i
      cross join yo
     where (p_id is null or i.id = p_id)
  )
  select v.id, v.codigo_interno, e.nombre, e.orden, v.area_id, a.codigo::text, a.nombre::text,
         v.resultado, v.observacion, v.estado, v.creado_en, public.puesto(ru),
         case when v.estado in ('OBSERVADA', 'CORREGIDA')
              then (now() at time zone 'America/Lima')::date - (v.creado_en at time zone 'America/Lima')::date end,
         up.tipo, up.creado_en,
         (select count(*)::integer from public.calidad_fotos f where f.inspeccion_id = v.id),
         (select count(*)::integer from public.calidad_inspeccion_pasos p where p.inspeccion_id = v.id),
         case when v.todo then 'TODOS' else 'AREA' end,
         v.estado = 'OBSERVADA' and (v.del_area or public.es_admin()),
         v.calidad and v.estado in ('OBSERVADA', 'CORREGIDA'),
         v.anulado_en, case when an.id is not null then public.puesto(an) end, v.motivo_anulacion
    from visibles v
    join public.areas a on a.id = v.area_id
    join public.usuarios ru on ru.id = v.registrado_por
    left join public.codigo_etapas e on e.id = v.codigo_etapa_id
    left join public.usuarios an on an.id = v.anulado_por
    left join lateral (select p.tipo, p.creado_en from public.calidad_inspeccion_pasos p
                        where p.inspeccion_id = v.id order by p.creado_en desc limit 1) up on true
   where v.todo or (v.del_area and v.estado <> 'ANULADA')
   order by v.creado_en desc;
$$;
comment on function public.calidad_inspecciones_visibles(uuid) is
  'Las inspecciones de calidad que ve quien pregunta (una, o todas con p_id vacío): todas para Calidad y Gerencia; las de su área, sin anuladas, para el área. Nombra el puesto, no la persona. dias_abierta se cuenta con la fecha de Lima.';
revoke all on function public.calidad_inspecciones_visibles(uuid) from public, anon;
grant execute on function public.calidad_inspecciones_visibles(uuid) to authenticated;

-- El recorrido de una inspección que quien pregunta puede ver.
create or replace function public.calidad_pasos_de_la_inspeccion(p_inspeccion uuid)
returns table (id uuid, tipo text, nota text, puesto text, creado_en timestamptz, fotos integer)
language sql stable security definer set search_path to 'public' rows 10 as $$
  select p.id, p.tipo, p.nota, public.puesto(u), p.creado_en,
         (select count(*)::integer from public.calidad_fotos f where f.paso_id = p.id)
    from public.calidad_inspeccion_pasos p
    join public.usuarios u on u.id = p.registrado_por
   where p.inspeccion_id = p_inspeccion
     and exists (select 1 from public.calidad_inspecciones_visibles(p_inspeccion))
   order by p.creado_en;
$$;
comment on function public.calidad_pasos_de_la_inspeccion(uuid) is
  'El recorrido de una inspección de calidad (corregida, vuelta a observar, levantada), con el puesto de quien lo hizo. Solo si quien pregunta ve la inspección.';
revoke all on function public.calidad_pasos_de_la_inspeccion(uuid) from public, anon;
grant execute on function public.calidad_pasos_de_la_inspeccion(uuid) to authenticated;
