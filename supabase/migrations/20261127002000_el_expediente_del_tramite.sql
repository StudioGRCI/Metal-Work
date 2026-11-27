-- =============================================================================
-- EL EXPEDIENTE DEL TRÁMITE
-- -----------------------------------------------------------------------------
-- Plan «El puesto de Tramitador», entrega 2 de 4. DKS pidió un usuario «para
-- subir trámites» que «pueda guardar todos los trámites». La entrega 1 dejó el
-- registro numerado; aquí cada trámite guarda lo suyo:
--
--   · Sus archivos: el cargo de presentación, los recibos de las tasas, lo que
--     haga falta y, al final, el documento que entrega la entidad (la tarjeta
--     de propiedad, la licencia, la póliza del SOAT). PDF o foto, hasta 20 MB.
--   · Sus gestiones: cada ida a la entidad, cada llamada, cada entrega, con su
--     fecha. Es la bitácora del trámite: lo anotado no se corrige ni se borra.
--   · Su cierre: el trámite se da por concluido al subir el documento final,
--     como DKS decidió («Solo la anulación»: Gerencia no aprueba el cierre, el
--     documento subido es la prueba). El que se renueva anota además hasta
--     cuándo vale, para avisar antes de que venza (entrega 3) y abrir su
--     renovación (entrega 4).
--
-- Un archivo del expediente no se borra: si se subió por error se retira, con
-- su motivo, quién y cuándo, y queda a la vista de quien ve todos los trámites.
-- Retirar el documento final reabre el trámite: sin documento no hay cierre.
--
-- Quién: sube, anota, cierra y retira quien lleva los trámites
-- (`tramites.gestionar`, el Tramitador). El expediente lo lee quien ve el
-- trámite: Gerencia y Administración, todos; Ventas y Gerencia Comercial, los
-- de una unidad, sin los archivos retirados.
-- =============================================================================

-- 0. Lo que se reemplaza es lo que el repositorio conoce ------------------------------------
-- Esta migración lleva enteras tres funciones de la entrega 1. Si en producción
-- alguna se arregló a mano en el editor de Supabase, reemplazarla pisaría ese
-- arreglo sin aviso: se detiene. Valen la huella de la entrega 1 y la de esta
-- migración (volver a correrla).
do $$
declare
  v record;
begin
  for v in
    select f.firma, f.huellas, md5(replace(p.prosrc, E'\r', '')) as huella
      from (values
        ('public.fn_tramite_guardia()', array['dc5f0b6dc178383b925a739db4ecf0f6', 'ca042b8c0f5cd0f7d703d514f140081a']),
        ('public.tramites_actualizar(uuid,text,text,text,text,date,date,text,timestamp with time zone)', array['e51d6c4c9cf605c9284a76194a9955e1', 'b166309ba3325004c1478d34e9266f9b']),
        ('public.tramites_visibles(uuid)', array['4cc467225336db0730dc00d66a02e496', '932ac816a97d83a7edfa0d8cda8cf2b9'])
      ) as f(firma, huellas)
      left join pg_proc p on p.oid = to_regprocedure(f.firma)
  loop
    if v.huella is null then
      raise exception 'Falta %: esta base no tiene la entrega 1 del Tramitador (20261126997100).', v.firma;
    end if;
    if not (v.huella = any (v.huellas)) then
      raise exception '% no es la que conoce el repositorio (se cambió a mano, huella %): no se reemplaza. Avisa antes de seguir.', v.firma, v.huella;
    end if;
  end loop;
end $$;

-- 1. El cierre del trámite -------------------------------------------------------------------
-- Sin índice en `concluido_por`: nadie filtra por quién cerró y un usuario no se borra.
alter table public.tramites
  add column if not exists fecha_conclusion date,
  add column if not exists vigente_hasta    date,
  add column if not exists concluido_por    uuid references public.usuarios(id) on delete restrict,
  add column if not exists concluido_en     timestamptz;
comment on column public.tramites.fecha_conclusion is
  'La fecha del documento final: cuándo la entidad dio por terminado el trámite. La anota quien lo cierra.';
comment on column public.tramites.vigente_hasta is
  'Hasta cuándo vale el documento final de un trámite que se renueva (el SOAT, una licencia). Vacío en los que no se renuevan.';

alter table public.tramites drop constraint if exists ck_tramite_estado;
alter table public.tramites add constraint ck_tramite_estado check (
  (estado = 'POR_INICIAR' and fecha_inicio is null)
  or (estado = 'EN_TRAMITE' and fecha_inicio is not null)
  -- Observado por la entidad: la nota dice qué observó.
  or (estado = 'OBSERVADO' and fecha_inicio is not null and char_length(btrim(coalesce(nota, ''))) >= 5)
  -- Concluido: se presentó y la entidad entregó el documento.
  or (estado = 'CONCLUIDO' and fecha_inicio is not null)
  or estado = 'ANULADO');
alter table public.tramites drop constraint if exists ck_tramite_conclusion;
alter table public.tramites add constraint ck_tramite_conclusion check (
  (concluido_en is null) = (concluido_por is null)
  and (concluido_en is null) = (fecha_conclusion is null)
  and (fecha_conclusion is null or fecha_inicio is null or fecha_conclusion >= fecha_inicio)
  and (vigente_hasta is null or (se_renueva and fecha_conclusion is not null and vigente_hasta > fecha_conclusion))
  -- Uno anulado conserva cómo estaba: concluido o no.
  and ((estado = 'CONCLUIDO' and concluido_en is not null and (vigente_hasta is not null) = se_renueva)
       or estado = 'ANULADO'
       or (estado in ('POR_INICIAR', 'EN_TRAMITE', 'OBSERVADO') and concluido_en is null and vigente_hasta is null)));

-- 2. Los archivos del expediente ---------------------------------------------------------------
create table if not exists public.tramite_archivos (
  id              uuid primary key,
  -- Índice (b): la ficha del trámite los lee por trámite.
  tramite_id      uuid not null constraint tramite_archivos_tramite_id_fkey references public.tramites(id) on delete restrict,
  clase           text not null,
  descripcion     text,
  archivo_ruta    text not null,
  archivo_nombre  text,
  archivo_mime    text not null,
  archivo_tamano  integer not null,
  -- Sin índice en quién subió ni en quién retiró: nadie filtra por ellos y un usuario no se borra.
  subido_por      uuid not null default public.usuario_actual() constraint tramite_archivos_subido_por_fkey references public.usuarios(id) on delete restrict,
  retirado_por    uuid constraint tramite_archivos_retirado_por_fkey references public.usuarios(id) on delete restrict,
  retirado_en     timestamptz,
  retiro_motivo   text,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  constraint uq_tramite_archivo_ruta unique (archivo_ruta),
  constraint ck_tramite_archivo_datos check (
    clase in ('CARGO', 'RECIBO', 'DOCUMENTO_FINAL', 'OTRO')
    and (descripcion is null or char_length(btrim(descripcion)) between 3 and 200)
    -- «Otro documento» dice qué es.
    and (clase <> 'OTRO' or descripcion is not null)
    and (archivo_nombre is null or char_length(archivo_nombre) between 1 and 200)
    and archivo_tamano > 0),
  constraint ck_tramite_archivo_retiro check (
    (retirado_en is null and retirado_por is null and retiro_motivo is null)
    or (retirado_en is not null and retirado_por is not null and char_length(btrim(coalesce(retiro_motivo, ''))) between 10 and 500))
);
create index if not exists ix_tramite_archivos_tramite on public.tramite_archivos (tramite_id, creado_en desc);
-- Un trámite tiene un solo documento final en pie: el que lo cerró.
create unique index if not exists uq_tramite_documento_final on public.tramite_archivos (tramite_id)
  where clase = 'DOCUMENTO_FINAL' and retirado_en is null;
comment on table public.tramite_archivos is
  'Los archivos del expediente de cada trámite, en el bucket tramites: el cargo de presentación, los recibos, otros documentos y el documento final, que es el que lo cierra. Los sube quien lleva los trámites (tramites.gestionar) y los lee quien ve el trámite. No se borran: el que se subió por error se retira, con su motivo, quién y cuándo.';

select public.activar_timestamps('tramite_archivos');
select public.activar_auditoria('tramite_archivos');
select public.activar_registro_de_prueba('tramite_archivos');

-- 3. Las gestiones ----------------------------------------------------------------------------
create table if not exists public.tramite_gestiones (
  id              uuid primary key,
  -- Índice (b): la ficha del trámite las lee por trámite.
  tramite_id      uuid not null constraint tramite_gestiones_tramite_id_fkey references public.tramites(id) on delete restrict,
  fecha           date not null,
  detalle         text not null,
  -- Sin índice: nadie filtra por quién anotó y un usuario no se borra.
  registrado_por  uuid not null default public.usuario_actual() constraint tramite_gestiones_registrado_por_fkey references public.usuarios(id) on delete restrict,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  constraint ck_tramite_gestion_detalle check (char_length(btrim(detalle)) between 5 and 500)
);
create index if not exists ix_tramite_gestiones_tramite on public.tramite_gestiones (tramite_id, fecha desc, creado_en desc);
comment on table public.tramite_gestiones is
  'La bitácora de cada trámite: cada gestión ante la entidad (una presentación, una llamada, una entrega) con su fecha. La anota quien lleva los trámites (tramites.gestionar) y la lee quien ve el trámite. Lo anotado no se corrige ni se borra: si algo quedó mal, se anota otra gestión que lo aclare.';

select public.activar_timestamps('tramite_gestiones');
select public.activar_auditoria('tramite_gestiones');
select public.activar_registro_de_prueba('tramite_gestiones');

-- 4. Lo que no se borra ni se corrige por debajo ------------------------------------------------
-- El trámite: se suma el cierre. Lo demás, como en la entrega 1.
create or replace function public.fn_tramite_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
declare
  -- Lo que fija quien registra: no cambia nunca.
  v_fijo     constant text[] := array['id', 'numero', 'tipo_id', 'tipo_nombre', 'se_renueva', 'ambito', 'unidad_id', 'cliente_id', 'orden_id',
                                   'registrado_por', 'creado_en'];
  -- Lo único que cambia mientras espera el visto de Gerencia: su respuesta.
  v_respuesta constant text[] := array['estado', 'anulado_por', 'anulado_en', 'anulacion_rechazada_por', 'anulacion_rechazada_en',
                                       'anulacion_rechazo_motivo', 'actualizado_en'];
  -- Lo único que cambia en uno concluido que sigue concluido: el pedido de anulación y su respuesta.
  v_anulacion constant text[] := array['anulacion_pedida_por', 'anulacion_pedida_en', 'motivo_anulacion', 'anulacion_rechazada_por',
                                       'anulacion_rechazada_en', 'anulacion_rechazo_motivo', 'actualizado_en'];
  -- Lo que cambia al cerrarlo o al reabrirlo.
  v_cierre   constant text[] := array['estado', 'fecha_conclusion', 'vigente_hasta', 'concluido_por', 'concluido_en', 'actualizado_en'];
  v_esperaba boolean;
begin
  if tg_op = 'DELETE' then
    raise exception 'Un trámite no se borra: se pide su anulación con el motivo y Gerencia la aprueba.' using errcode = 'check_violation';
  end if;
  if old.estado = 'ANULADO' then
    raise exception 'El trámite % está anulado: queda como evidencia.', old.numero using errcode = 'check_violation';
  end if;
  if (select jsonb_object_agg(k, to_jsonb(new) -> k) from unnest(v_fijo) k)
     is distinct from (select jsonb_object_agg(k, to_jsonb(old) -> k) from unnest(v_fijo) k) then
    raise exception 'El número, el tipo, la unidad y la OT del trámite % no se corrigen: si están mal, se pide su anulación y se registra de nuevo.', old.numero
      using errcode = 'check_violation';
  end if;
  v_esperaba := old.anulacion_pedida_en is not null and old.anulacion_rechazada_en is null;
  if v_esperaba and (to_jsonb(new) - v_respuesta) is distinct from (to_jsonb(old) - v_respuesta) then
    raise exception 'El trámite % espera el visto de Gerencia para anularse: no se cambia hasta que responda.', old.numero
      using errcode = 'check_violation';
  end if;

  -- El cierre. Se cierra con el documento final ya en el expediente; se reabre
  -- solo cuando ese documento ya está retirado (lo hace `fn_tramite_archivo_reabre`
  -- al retirarlo). Quién y cuándo los pone la base.
  if old.estado = 'CONCLUIDO' and new.estado = 'CONCLUIDO' then
    if (to_jsonb(new) - v_anulacion) is distinct from (to_jsonb(old) - v_anulacion) then
      raise exception 'El trámite % está concluido: para cambiarlo, retira su documento final con el motivo.', old.numero
        using errcode = 'check_violation';
    end if;
  elsif old.estado = 'CONCLUIDO' and new.estado <> 'ANULADO' then
    if new.estado <> 'EN_TRAMITE' or (to_jsonb(new) - v_cierre) is distinct from (to_jsonb(old) - v_cierre) then
      raise exception 'El trámite % está concluido: al retirar su documento final vuelve a «En trámite», sin otro cambio.', old.numero
        using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.tramite_archivos a
                where a.tramite_id = old.id and a.clase = 'DOCUMENTO_FINAL' and a.retirado_en is null) then
      raise exception 'El trámite % está concluido: se reabre solo al retirar su documento final, con el motivo.', old.numero
        using errcode = 'check_violation';
    end if;
    new.fecha_conclusion := null;
    new.vigente_hasta := null;
    new.concluido_por := null;
    new.concluido_en := null;
  elsif new.estado = 'CONCLUIDO' then
    if old.estado not in ('EN_TRAMITE', 'OBSERVADO') then
      raise exception 'El trámite % todavía no se presentó: anota la fecha en que se presentó antes de cerrarlo.', old.numero
        using errcode = 'check_violation';
    end if;
    if (to_jsonb(new) - v_cierre) is distinct from (to_jsonb(old) - v_cierre) then
      raise exception 'Al cerrar el trámite % solo se anota su documento final, su fecha y hasta cuándo vale.', old.numero
        using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.tramite_archivos a
                    where a.tramite_id = old.id and a.clase = 'DOCUMENTO_FINAL' and a.retirado_en is null) then
      raise exception 'El trámite % se cierra al subir su documento final.', old.numero using errcode = 'check_violation';
    end if;
    if new.fecha_conclusion is null then
      raise exception 'Pon la fecha del documento final del trámite %.', old.numero using errcode = 'check_violation';
    end if;
    new.concluido_por := coalesce(public.usuario_actual(), new.concluido_por);
    new.concluido_en := now();
  elsif new.estado <> 'ANULADO'
        and (new.fecha_conclusion, new.vigente_hasta, new.concluido_por, new.concluido_en)
            is distinct from (old.fecha_conclusion, old.vigente_hasta, old.concluido_por, old.concluido_en) then
    raise exception 'El trámite % no está concluido: su cierre se anota solo al subir el documento final.', old.numero using errcode = 'check_violation';
  end if;

  -- Quién y cuándo los pone la base, venga de donde venga el UPDATE.
  if (new.anulacion_pedida_por, new.anulacion_pedida_en, new.motivo_anulacion)
     is distinct from (old.anulacion_pedida_por, old.anulacion_pedida_en, old.motivo_anulacion) then
    if char_length(btrim(coalesce(new.motivo_anulacion, ''))) < 10 then
      raise exception 'Para pedir la anulación del trámite % escribe el motivo (al menos 10 letras).', old.numero using errcode = 'check_violation';
    end if;
    new.motivo_anulacion := btrim(new.motivo_anulacion);
    new.anulacion_pedida_por := coalesce(public.usuario_actual(), new.anulacion_pedida_por);
    -- La hora del reloj, no la de la transacción: cada pedido tiene la suya, y
    -- quien responde dice a cuál responde (`tramites_resolver_anulacion`).
    new.anulacion_pedida_en := clock_timestamp();
    -- Un pedido nuevo deja atrás la respuesta del anterior.
    new.anulacion_rechazada_por := null;
    new.anulacion_rechazada_en := null;
    new.anulacion_rechazo_motivo := null;
  elsif new.anulacion_rechazada_en is distinct from old.anulacion_rechazada_en
        or new.anulacion_rechazada_por is distinct from old.anulacion_rechazada_por
        or new.anulacion_rechazo_motivo is distinct from old.anulacion_rechazo_motivo then
    if not v_esperaba or new.estado = 'ANULADO' then
      raise exception 'El trámite % no espera el visto de Gerencia: no hay anulación que rechazar.', old.numero using errcode = 'check_violation';
    end if;
    if char_length(btrim(coalesce(new.anulacion_rechazo_motivo, ''))) < 10 then
      raise exception 'Para no aprobar la anulación del trámite % escribe el motivo (al menos 10 letras).', old.numero using errcode = 'check_violation';
    end if;
    new.anulacion_rechazo_motivo := btrim(new.anulacion_rechazo_motivo);
    new.anulacion_rechazada_por := coalesce(public.usuario_actual(), new.anulacion_rechazada_por);
    new.anulacion_rechazada_en := now();
  end if;
  if new.estado = 'ANULADO' then
    if not v_esperaba then
      raise exception 'El trámite % se anula solo con el motivo de quien lo lleva y el visto de Gerencia.', old.numero using errcode = 'check_violation';
    end if;
    new.anulado_por := coalesce(public.usuario_actual(), new.anulado_por);
    new.anulado_en := now();
  elsif (new.anulado_por, new.anulado_en) is distinct from (old.anulado_por, old.anulado_en) then
    raise exception 'El trámite % no está anulado: quién y cuándo se anotan solo al anularlo.', old.numero using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_tramite_guardia() from public, anon, authenticated;

-- El archivo: no se borra y no se cambia. Solo se retira, una vez, con su motivo.
create or replace function public.fn_tramite_archivo_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
declare
  v_retiro constant text[] := array['retirado_por', 'retirado_en', 'retiro_motivo', 'actualizado_en'];
  v_t      public.tramites%rowtype;
begin
  if tg_op = 'DELETE' then
    raise exception 'Un archivo del expediente no se borra: se retira con su motivo.' using errcode = 'check_violation';
  end if;
  if old.retirado_en is not null then
    raise exception 'Ese archivo ya está retirado: queda como evidencia.' using errcode = 'check_violation';
  end if;
  if (to_jsonb(new) - v_retiro) is distinct from (to_jsonb(old) - v_retiro) then
    raise exception 'Un archivo del expediente no se cambia: si está mal, se retira con su motivo y se sube de nuevo.' using errcode = 'check_violation';
  end if;
  if char_length(btrim(coalesce(new.retiro_motivo, ''))) < 10 then
    raise exception 'Para retirar un archivo del expediente escribe el motivo (al menos 10 letras).' using errcode = 'check_violation';
  end if;
  select * into v_t from public.tramites where id = old.tramite_id;
  if v_t.estado = 'ANULADO' then
    raise exception 'El trámite % está anulado: su expediente queda como evidencia.', v_t.numero using errcode = 'check_violation';
  end if;
  if v_t.anulacion_pedida_en is not null and v_t.anulacion_rechazada_en is null then
    raise exception 'El trámite % espera el visto de Gerencia para anularse: no se cambia hasta que responda.', v_t.numero using errcode = 'check_violation';
  end if;
  new.retiro_motivo := btrim(new.retiro_motivo);
  new.retirado_por := coalesce(public.usuario_actual(), new.retirado_por);
  new.retirado_en := now();
  return new;
end;
$$;
revoke all on function public.fn_tramite_archivo_guardia() from public, anon, authenticated;
create or replace trigger trg_tramite_archivo_guardia
  before update or delete on public.tramite_archivos
  for each row execute function public.fn_tramite_archivo_guardia();

-- El documento final sostiene el cierre: al retirarlo, el trámite concluido
-- vuelve a «En trámite» aquí mismo, venga de donde venga el retiro. Así no hay
-- trámite concluido sin su documento, ni reabierto con el documento en pie.
create or replace function public.fn_tramite_archivo_reabre()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if new.clase = 'DOCUMENTO_FINAL' and old.retirado_en is null and new.retirado_en is not null then
    update public.tramites set estado = 'EN_TRAMITE' where id = new.tramite_id and estado = 'CONCLUIDO';
  end if;
  return null;
end;
$$;
revoke all on function public.fn_tramite_archivo_reabre() from public, anon, authenticated;
create or replace trigger trg_tramite_archivo_reabre
  after update on public.tramite_archivos
  for each row execute function public.fn_tramite_archivo_reabre();

-- La gestión anotada no se toca.
create or replace function public.fn_tramite_gestion_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  raise exception 'Una gestión anotada no se corrige ni se borra: anota otra que la aclare.' using errcode = 'check_violation';
end;
$$;
revoke all on function public.fn_tramite_gestion_guardia() from public, anon, authenticated;
create or replace trigger trg_tramite_gestion_guardia
  before update or delete on public.tramite_gestiones
  for each row execute function public.fn_tramite_gestion_guardia();

-- 5. Quién lee el expediente ---------------------------------------------------------------------
-- Quien ve el trámite: la política de `tramites` decide dentro del `exists`.
-- Los archivos retirados, solo quien ve todos los trámites. Se escriben por las
-- funciones de abajo: sin grant de insert, update ni delete.
alter table public.tramite_archivos enable row level security;
alter table public.tramite_gestiones enable row level security;
revoke all on public.tramite_archivos from public, anon, authenticated;
revoke all on public.tramite_gestiones from public, anon, authenticated;
grant select on public.tramite_archivos to authenticated;
grant select on public.tramite_gestiones to authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tramite_archivos' and policyname = 'ver_tramite_archivos') then
    create policy ver_tramite_archivos on public.tramite_archivos for select to authenticated
      using ((retirado_en is null or (select public.tramites_ve_todos()))
             and exists (select 1 from public.tramites t where t.id = tramite_archivos.tramite_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tramite_gestiones' and policyname = 'ver_tramite_gestiones') then
    create policy ver_tramite_gestiones on public.tramite_gestiones for select to authenticated
      using (exists (select 1 from public.tramites t where t.id = tramite_gestiones.tramite_id));
  end if;
end $$;
-- La auditoría copia la fila entera: la del expediente se lee con lo mismo que
-- el trámite, no solo con `auditoria.ver`.
alter policy tramites_con_su_permiso on public.audit_log
  using (tabla not in ('tramites', 'tramite_archivos', 'tramite_gestiones') or (select public.tramites_ve_todos()));

-- 6. Los archivos en Storage ---------------------------------------------------------------------
-- Privado, hasta 20 MB, PDF o foto. La ruta es {trámite}/{archivo}: sube quien
-- lleva los trámites, solo a uno no anulado. Lo ve quien lo subió mientras está
-- suelto y, una vez en el expediente, quien ve ese archivo del trámite. Uno
-- suelto (subido y no anotado) lo retira su dueño. Las políticas se crean una
-- vez y se cambian con alter.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tramites', 'tramites', false, 20971520, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Si una fila del expediente nombra ese archivo, mirado por encima del RLS:
-- quien lo subió y después cambió de puesto ya no ve la fila que lo nombra, y
-- sin esto las políticas lo dejaban verlo y quitarlo como si estuviera suelto.
create or replace function public.tramite_ruta_adjunta(p_ruta text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.tramite_archivos a where a.archivo_ruta = p_ruta);
$$;
revoke all on function public.tramite_ruta_adjunta(text) from public, anon;
grant execute on function public.tramite_ruta_adjunta(text) to authenticated;
comment on function public.tramite_ruta_adjunta(text) is
  'Si un archivo del expediente de un trámite nombra esa ruta del bucket tramites. Solo responde sí o no: la usan las políticas del bucket.';

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'tramites_subir') then
    create policy tramites_subir on storage.objects for insert to authenticated with check (
      bucket_id = 'tramites' and owner_id = (select auth.uid())::text
      and (select public.es_admin() or public.tiene_permiso('tramites.gestionar'))
      and exists (select 1 from public.tramites t
                   where t.id::text = split_part(objects.name, '/', 1) and t.estado <> 'ANULADO'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'tramites_ver_archivo') then
    create policy tramites_ver_archivo on storage.objects for select to authenticated using (
      bucket_id = 'tramites'
      and ((owner_id = (select auth.uid())::text and not public.tramite_ruta_adjunta(objects.name))
           or exists (select 1 from public.tramite_archivos a where a.archivo_ruta = objects.name)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'tramites_quitar_suelto') then
    create policy tramites_quitar_suelto on storage.objects for delete to authenticated using (
      bucket_id = 'tramites' and owner_id = (select auth.uid())::text
      and not public.tramite_ruta_adjunta(objects.name));
  end if;
end $$;

-- El archivo que esta persona subió para este trámite, y que ninguna fila nombra todavía.
create or replace function public.tramite_archivo_subido(p_tramite uuid, p_ruta text)
returns storage.objects language plpgsql stable set search_path to 'public' as $$
declare v_obj storage.objects%rowtype;
begin
  if p_ruta is null or p_ruta !~ ('^' || p_tramite::text || '/[0-9a-f-]{36}\.(pdf|jpg|png|webp)$') then
    raise exception 'Vuelve a adjuntar el archivo.' using errcode = 'check_violation';
  end if;
  select * into v_obj from storage.objects where bucket_id = 'tramites' and name = p_ruta;
  if not found or v_obj.owner_id is distinct from public.usuario_actual()::text
     or v_obj.metadata->>'mimetype' not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
     or coalesce((v_obj.metadata->>'size')::bigint, 0) not between 1 and 20971520 then
    raise exception 'El archivo no terminó de subir: vuelve a adjuntarlo.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.tramite_archivos where archivo_ruta = p_ruta) then
    raise exception 'Ese archivo ya está en un expediente: vuelve a adjuntarlo.' using errcode = 'check_violation';
  end if;
  return v_obj;
end;
$$;
revoke all on function public.tramite_archivo_subido(uuid, text) from public, anon, authenticated;

-- 7. Subir un archivo al expediente --------------------------------------------------------------
-- El cargo, un recibo u otro documento. El documento final entra por
-- `tramites_concluir`, que además cierra el trámite. Uno concluido sigue
-- recibiendo archivos (el cargo de entrega al cliente); uno anulado o que
-- espera el visto de Gerencia, no. El mismo envío repetido devuelve el que ya entró.
create or replace function public.tramites_adjuntar_archivo(
  p_id uuid, p_tramite uuid, p_clase text, p_descripcion text, p_ruta text, p_nombre text
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo     uuid := public.usuario_actual();
  v_desc   text := nullif(btrim(regexp_replace(coalesce(p_descripcion, ''), '\s+', ' ', 'g')), '');
  v_nombre text := nullif(left(btrim(coalesce(p_nombre, '')), 200), '');
  v_t      public.tramites%rowtype;
  v_a      public.tramite_archivos%rowtype;
  v_obj    storage.objects%rowtype;
begin
  if v_yo is null or not public.es_usuario_activo() or not (public.es_admin() or public.tiene_permiso('tramites.gestionar')) then
    raise exception 'No tienes permiso para llevar los trámites.' using errcode = 'insufficient_privilege';
  end if;
  if p_id is null then
    raise exception 'Vuelve a abrir la ventana para subir el archivo.' using errcode = 'check_violation';
  end if;
  select * into v_a from public.tramite_archivos where id = p_id;
  if found then
    if v_a.tramite_id = p_tramite and v_a.subido_por = v_yo then
      if v_a.archivo_ruta = p_ruta then return p_id; end if;
      -- Se perdió la respuesta y se volvió a pulsar: el navegador subió otra
      -- copia a otra ruta. La primera ya está; la copia se quita sola.
      raise exception 'Ese archivo ya quedó en el expediente la primera vez que lo enviaste: recarga la pantalla para ver cómo quedó.'
        using errcode = 'check_violation';
    end if;
    raise exception 'Vuelve a abrir la ventana para subir el archivo.' using errcode = 'check_violation';
  end if;
  select * into v_t from public.tramites where id = p_tramite for update;
  if not found then raise exception 'Ese trámite no existe. Recarga la pantalla.' using errcode = 'check_violation'; end if;
  if v_t.estado = 'ANULADO' then
    raise exception 'El trámite % está anulado: su expediente queda como evidencia.', v_t.numero using errcode = 'check_violation';
  end if;
  if v_t.anulacion_pedida_en is not null and v_t.anulacion_rechazada_en is null then
    raise exception 'El trámite % espera el visto de Gerencia para anularse: no se cambia hasta que responda.', v_t.numero using errcode = 'check_violation';
  end if;
  if p_clase = 'DOCUMENTO_FINAL' then
    raise exception 'El documento final se sube al cerrar el trámite, con «Cerrar con el documento final».' using errcode = 'check_violation';
  end if;
  if p_clase is null or p_clase not in ('CARGO', 'RECIBO', 'OTRO') then
    raise exception 'Elige qué es el archivo: el cargo, un recibo u otro documento.' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(v_desc, '')) > 200 or (v_desc is not null and char_length(v_desc) < 3) then
    raise exception 'Describe el archivo en 3 a 200 caracteres.' using errcode = 'check_violation';
  end if;
  if p_clase = 'OTRO' and v_desc is null then
    raise exception 'Cuenta qué documento es, en 3 a 200 caracteres.' using errcode = 'check_violation';
  end if;
  v_obj := public.tramite_archivo_subido(p_tramite, p_ruta);
  insert into public.tramite_archivos (id, tramite_id, clase, descripcion, archivo_ruta, archivo_nombre, archivo_mime, archivo_tamano, subido_por)
  values (p_id, p_tramite, p_clase, v_desc, p_ruta, v_nombre, v_obj.metadata->>'mimetype', (v_obj.metadata->>'size')::integer, v_yo);
  return p_id;
end;
$$;
comment on function public.tramites_adjuntar_archivo(uuid, uuid, text, text, text, text) is
  'Quien lleva los trámites (tramites.gestionar) suma al expediente un archivo ya subido a Storage: el cargo, un recibo u otro documento. No al trámite anulado ni al que espera el visto de Gerencia. El documento final entra por tramites_concluir.';
revoke all on function public.tramites_adjuntar_archivo(uuid, uuid, text, text, text, text) from public, anon;
grant execute on function public.tramites_adjuntar_archivo(uuid, uuid, text, text, text, text) to authenticated;

-- 8. Cerrar el trámite con su documento final ------------------------------------------------------
-- El documento subido es la prueba del cierre: no pasa por Gerencia. Se cierra
-- el que ya se presentó (en trámite u observado). El que se renueva anota hasta
-- cuándo vale su documento.
create or replace function public.tramites_concluir(
  p_id uuid, p_tramite uuid, p_ruta text, p_nombre text, p_fecha date, p_vigente_hasta date
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo     uuid := public.usuario_actual();
  v_hoy    constant date := (now() at time zone 'America/Lima')::date;
  v_nombre text := nullif(left(btrim(coalesce(p_nombre, '')), 200), '');
  v_t      public.tramites%rowtype;
  v_a      public.tramite_archivos%rowtype;
  v_obj    storage.objects%rowtype;
begin
  if v_yo is null or not public.es_usuario_activo() or not (public.es_admin() or public.tiene_permiso('tramites.gestionar')) then
    raise exception 'No tienes permiso para llevar los trámites.' using errcode = 'insufficient_privilege';
  end if;
  if p_id is null then
    raise exception 'Vuelve a abrir la ventana para cerrar el trámite.' using errcode = 'check_violation';
  end if;
  select * into v_a from public.tramite_archivos where id = p_id;
  if found then
    if v_a.tramite_id = p_tramite and v_a.subido_por = v_yo and v_a.clase = 'DOCUMENTO_FINAL' then
      if v_a.archivo_ruta = p_ruta then return p_id; end if;
      raise exception 'El documento final ya quedó en el expediente la primera vez que lo enviaste: recarga la pantalla para ver cómo quedó el trámite.'
        using errcode = 'check_violation';
    end if;
    raise exception 'Vuelve a abrir la ventana para cerrar el trámite.' using errcode = 'check_violation';
  end if;
  select * into v_t from public.tramites where id = p_tramite for update;
  if not found then raise exception 'Ese trámite no existe. Recarga la pantalla.' using errcode = 'check_violation'; end if;
  if v_t.estado = 'ANULADO' then
    raise exception 'El trámite % está anulado: queda como evidencia.', v_t.numero using errcode = 'check_violation';
  end if;
  if v_t.anulacion_pedida_en is not null and v_t.anulacion_rechazada_en is null then
    raise exception 'El trámite % espera el visto de Gerencia para anularse: no se cambia hasta que responda.', v_t.numero using errcode = 'check_violation';
  end if;
  if v_t.estado = 'CONCLUIDO' then
    raise exception 'El trámite % ya está concluido, con su documento final. Recarga la pantalla.', v_t.numero using errcode = 'check_violation';
  end if;
  if v_t.estado = 'POR_INICIAR' then
    raise exception 'El trámite % todavía figura «Por iniciar»: anota primero la fecha en que se presentó, con «Actualizar».', v_t.numero
      using errcode = 'check_violation';
  end if;
  if p_fecha is null then
    raise exception 'Pon la fecha del documento final.' using errcode = 'check_violation';
  end if;
  if p_fecha > v_hoy then
    raise exception 'La fecha del documento final no puede ser futura.' using errcode = 'check_violation';
  end if;
  if p_fecha < v_t.fecha_inicio then
    raise exception 'La fecha del documento final no puede ser anterior a la fecha en que se presentó el trámite (%).', to_char(v_t.fecha_inicio, 'DD/MM/YYYY')
      using errcode = 'check_violation';
  end if;
  if v_t.se_renueva and p_vigente_hasta is null then
    raise exception 'Este trámite se renueva: pon hasta cuándo vale el documento.' using errcode = 'check_violation';
  end if;
  if not v_t.se_renueva and p_vigente_hasta is not null then
    raise exception 'Este trámite no se renueva: no lleva fecha de vigencia.' using errcode = 'check_violation';
  end if;
  if p_vigente_hasta is not null and p_vigente_hasta <= p_fecha then
    raise exception 'La vigencia tiene que terminar después de la fecha del documento.' using errcode = 'check_violation';
  end if;
  -- Un año mal tecleado (2207 por 2027) dejaría el trámite sin aviso de renovación para siempre.
  if p_vigente_hasta is not null and p_vigente_hasta > (p_fecha + interval '10 years')::date then
    raise exception 'La vigencia pasa de diez años desde la fecha del documento: revisa el año.' using errcode = 'check_violation';
  end if;
  v_obj := public.tramite_archivo_subido(p_tramite, p_ruta);
  insert into public.tramite_archivos (id, tramite_id, clase, archivo_ruta, archivo_nombre, archivo_mime, archivo_tamano, subido_por)
  values (p_id, p_tramite, 'DOCUMENTO_FINAL', p_ruta, v_nombre, v_obj.metadata->>'mimetype', (v_obj.metadata->>'size')::integer, v_yo);
  update public.tramites
     set estado = 'CONCLUIDO', fecha_conclusion = p_fecha, vigente_hasta = p_vigente_hasta
   where id = p_tramite;
  return p_id;
end;
$$;
comment on function public.tramites_concluir(uuid, uuid, text, text, date, date) is
  'Quien lleva los trámites (tramites.gestionar) cierra uno ya presentado al subir su documento final, con la fecha del documento y, si se renueva, hasta cuándo vale. No pasa por Gerencia: el documento es la prueba.';
revoke all on function public.tramites_concluir(uuid, uuid, text, text, date, date) from public, anon;
grant execute on function public.tramites_concluir(uuid, uuid, text, text, date, date) to authenticated;

-- 9. Retirar un archivo subido por error --------------------------------------------------------
-- No se borra: queda retirado, con su motivo. Retirar el documento final reabre
-- el trámite, que vuelve a «En trámite». Devuelve si lo reabrió.
create or replace function public.tramites_retirar_archivo(p_archivo uuid, p_motivo text)
returns boolean language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo     uuid := public.usuario_actual();
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_a      public.tramite_archivos%rowtype;
  v_t      public.tramites%rowtype;
  v_reabre boolean := false;
begin
  if v_yo is null or not public.es_usuario_activo() or not (public.es_admin() or public.tiene_permiso('tramites.gestionar')) then
    raise exception 'No tienes permiso para llevar los trámites.' using errcode = 'insufficient_privilege';
  end if;
  if char_length(v_motivo) not between 10 and 500 then
    raise exception 'Cuenta por qué se retira, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select tramite_id into v_a.tramite_id from public.tramite_archivos where id = p_archivo;
  if not found then raise exception 'Ese archivo no existe. Recarga la pantalla.' using errcode = 'check_violation'; end if;
  -- Primero el trámite y después su archivo, como las demás: sin abrazo entre dos envíos.
  select * into v_t from public.tramites where id = v_a.tramite_id for update;
  select * into v_a from public.tramite_archivos where id = p_archivo for update;
  if v_a.retirado_en is not null then
    -- El mismo envío repetido (se perdió la respuesta) entra, y dice lo mismo
    -- que la primera vez: el documento final retirado reabrió su trámite. Si
    -- después se cerró con otro, ya no está reabierto y no se dice.
    if v_a.retirado_por = v_yo and v_a.retiro_motivo = v_motivo then
      return v_a.clase = 'DOCUMENTO_FINAL' and v_t.estado <> 'CONCLUIDO';
    end if;
    raise exception 'Ese archivo ya estaba retirado. Recarga la pantalla.' using errcode = 'check_violation';
  end if;
  if v_t.estado = 'ANULADO' then
    raise exception 'El trámite % está anulado: su expediente queda como evidencia.', v_t.numero using errcode = 'check_violation';
  end if;
  if v_t.anulacion_pedida_en is not null and v_t.anulacion_rechazada_en is null then
    raise exception 'El trámite % espera el visto de Gerencia para anularse: no se cambia hasta que responda.', v_t.numero using errcode = 'check_violation';
  end if;
  -- Al trámite concluido lo reabre el retiro de su documento final (`fn_tramite_archivo_reabre`).
  v_reabre := v_a.clase = 'DOCUMENTO_FINAL' and v_t.estado = 'CONCLUIDO';
  update public.tramite_archivos set retiro_motivo = v_motivo, retirado_por = v_yo, retirado_en = now() where id = p_archivo;
  return v_reabre;
end;
$$;
comment on function public.tramites_retirar_archivo(uuid, text) is
  'Quien lleva los trámites (tramites.gestionar) retira del expediente un archivo subido por error, con su motivo: no se borra. Si es el documento final, el trámite se reabre y vuelve a «En trámite»; devuelve verdadero cuando lo reabrió.';
revoke all on function public.tramites_retirar_archivo(uuid, text) from public, anon;
grant execute on function public.tramites_retirar_archivo(uuid, text) to authenticated;

-- 10. Anotar una gestión ---------------------------------------------------------------------------
-- Uno concluido las sigue recibiendo (la entrega de la tarjeta al cliente); uno
-- anulado o que espera el visto de Gerencia, no.
create or replace function public.tramites_anotar_gestion(p_id uuid, p_tramite uuid, p_fecha date, p_detalle text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo      uuid := public.usuario_actual();
  v_hoy     constant date := (now() at time zone 'America/Lima')::date;
  v_detalle text := btrim(coalesce(p_detalle, ''));
  v_t       public.tramites%rowtype;
  v_g       public.tramite_gestiones%rowtype;
begin
  if v_yo is null or not public.es_usuario_activo() or not (public.es_admin() or public.tiene_permiso('tramites.gestionar')) then
    raise exception 'No tienes permiso para llevar los trámites.' using errcode = 'insufficient_privilege';
  end if;
  if p_id is null then
    raise exception 'Vuelve a abrir la ventana para anotar la gestión.' using errcode = 'check_violation';
  end if;
  select * into v_g from public.tramite_gestiones where id = p_id;
  if found then
    if v_g.tramite_id = p_tramite and v_g.registrado_por = v_yo then
      if v_g.fecha = p_fecha and v_g.detalle = v_detalle then return p_id; end if;
      raise exception 'Esa gestión ya quedó anotada la primera vez que la enviaste: lo que cambiaste después no se guardó. Si hace falta, anota otra.'
        using errcode = 'check_violation';
    end if;
    raise exception 'Vuelve a abrir la ventana para anotar la gestión.' using errcode = 'check_violation';
  end if;
  select * into v_t from public.tramites where id = p_tramite for update;
  if not found then raise exception 'Ese trámite no existe. Recarga la pantalla.' using errcode = 'check_violation'; end if;
  if v_t.estado = 'ANULADO' then
    raise exception 'El trámite % está anulado: su expediente queda como evidencia.', v_t.numero using errcode = 'check_violation';
  end if;
  if v_t.anulacion_pedida_en is not null and v_t.anulacion_rechazada_en is null then
    raise exception 'El trámite % espera el visto de Gerencia para anularse: no se cambia hasta que responda.', v_t.numero using errcode = 'check_violation';
  end if;
  if p_fecha is null then
    raise exception 'Pon la fecha de la gestión.' using errcode = 'check_violation';
  end if;
  if p_fecha > v_hoy then
    raise exception 'La fecha de la gestión no puede ser futura.' using errcode = 'check_violation';
  end if;
  if p_fecha < v_hoy - 1830 then
    raise exception 'La fecha de la gestión es de hace más de cinco años: revísala.' using errcode = 'check_violation';
  end if;
  if char_length(v_detalle) not between 5 and 500 then
    raise exception 'Cuenta qué se hizo, en 5 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  insert into public.tramite_gestiones (id, tramite_id, fecha, detalle, registrado_por)
  values (p_id, p_tramite, p_fecha, v_detalle, v_yo);
  return p_id;
end;
$$;
comment on function public.tramites_anotar_gestion(uuid, uuid, date, text) is
  'Quien lleva los trámites (tramites.gestionar) anota una gestión del trámite con su fecha. No en el anulado ni en el que espera el visto de Gerencia. Lo anotado no se corrige.';
revoke all on function public.tramites_anotar_gestion(uuid, uuid, date, text) from public, anon;
grant execute on function public.tramites_anotar_gestion(uuid, uuid, date, text) to authenticated;

-- 11. Llevarlo: uno concluido ya no se cambia por aquí ------------------------------------------------
-- Lo mismo que en la entrega 1, con una regla más: el concluido se cambia
-- solo retirando su documento final.
create or replace function public.tramites_actualizar(
  p_id uuid, p_estado text, p_asunto text, p_entidad text, p_expediente text, p_fecha_inicio date, p_fecha_limite date, p_nota text,
  p_visto timestamptz
) returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo      uuid := public.usuario_actual();
  v_hoy     constant date := (now() at time zone 'America/Lima')::date;
  v_asunto  text := btrim(regexp_replace(coalesce(p_asunto, ''), '\s+', ' ', 'g'));
  v_entidad text := btrim(regexp_replace(coalesce(p_entidad, ''), '\s+', ' ', 'g'));
  v_exp     text := nullif(btrim(coalesce(p_expediente, '')), '');
  v_nota    text := nullif(btrim(coalesce(p_nota, '')), '');
  v_t       public.tramites%rowtype;
begin
  if v_yo is null or not public.es_usuario_activo() or not (public.es_admin() or public.tiene_permiso('tramites.gestionar')) then
    raise exception 'No tienes permiso para llevar los trámites.' using errcode = 'insufficient_privilege';
  end if;
  select * into v_t from public.tramites where id = p_id for update;
  if not found then raise exception 'Ese trámite no existe.' using errcode = 'check_violation'; end if;
  if v_t.estado = 'ANULADO' then
    raise exception 'El trámite % está anulado: queda como evidencia.', v_t.numero using errcode = 'check_violation';
  end if;
  if v_t.estado = 'CONCLUIDO' then
    raise exception 'El trámite % está concluido: para cambiarlo, retira su documento final con el motivo.', v_t.numero using errcode = 'check_violation';
  end if;
  if v_t.anulacion_pedida_en is not null and v_t.anulacion_rechazada_en is null then
    raise exception 'El trámite % espera el visto de Gerencia para anularse: no se cambia hasta que responda.', v_t.numero using errcode = 'check_violation';
  end if;
  if p_estado is null or p_estado not in ('POR_INICIAR', 'EN_TRAMITE', 'OBSERVADO') then
    raise exception 'Elige en qué va el trámite: por iniciar, en trámite u observado.' using errcode = 'check_violation';
  end if;
  if char_length(v_asunto) not between 5 and 300 then
    raise exception 'Escribe qué se tramita, en 5 a 300 caracteres.' using errcode = 'check_violation';
  end if;
  if char_length(v_entidad) not between 2 and 80 then
    raise exception 'Escribe ante qué entidad se hace, en 2 a 80 caracteres.' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(v_exp, '')) > 60 then
    raise exception 'El número de expediente pasa de 60 caracteres.' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(v_nota, '')) > 1000 then
    raise exception 'La nota pasa de 1000 caracteres.' using errcode = 'check_violation';
  end if;
  if p_estado = 'POR_INICIAR' and p_fecha_inicio is not null then
    raise exception 'Un trámite por iniciar no lleva la fecha en que se presentó: quítala, o ponlo «En trámite».' using errcode = 'check_violation';
  end if;
  if p_estado <> 'POR_INICIAR' and p_fecha_inicio is null then
    raise exception 'Pon la fecha en que se presentó el trámite.' using errcode = 'check_violation';
  end if;
  if p_fecha_inicio is not null and p_fecha_inicio > v_hoy then
    raise exception 'La fecha en que se presentó no puede ser futura.' using errcode = 'check_violation';
  end if;
  if p_fecha_inicio is not null and p_fecha_limite is not null and p_fecha_limite < p_fecha_inicio then
    raise exception 'La fecha límite no puede ser anterior a la fecha en que se presentó.' using errcode = 'check_violation';
  end if;
  if p_estado = 'OBSERVADO' and char_length(coalesce(v_nota, '')) < 5 then
    raise exception 'Cuenta en la nota qué observó la entidad.' using errcode = 'check_violation';
  end if;

  -- Lo mismo que ya está: es el mismo envío, o nada que guardar.
  if (v_t.estado, v_t.asunto, v_t.entidad, v_t.expediente, v_t.fecha_inicio, v_t.fecha_limite, v_t.nota)
     is not distinct from (p_estado, v_asunto, v_entidad, v_exp, p_fecha_inicio, p_fecha_limite, v_nota) then
    return p_id;
  end if;
  if p_visto is null then
    raise exception 'Recarga la ficha del trámite antes de cambiarlo.' using errcode = 'check_violation';
  end if;
  if v_t.actualizado_en is distinct from p_visto then
    raise exception 'El trámite % cambió después de que abriste esta pantalla: recárgala y vuelve a anotar lo tuyo.', v_t.numero
      using errcode = 'check_violation';
  end if;

  update public.tramites
     set estado = p_estado, asunto = v_asunto, entidad = v_entidad, expediente = v_exp,
         fecha_inicio = p_fecha_inicio, fecha_limite = p_fecha_limite, nota = v_nota
   where id = p_id;
  return p_id;
end;
$$;
comment on function public.tramites_actualizar(uuid, text, text, text, text, date, date, text, timestamptz) is
  'Quien lleva los trámites (tramites.gestionar) anota en qué va uno: por iniciar, en trámite u observado, con su asunto, su entidad, su expediente, sus fechas y su nota. No toca el tipo, la unidad ni la OT. No vale sobre uno anulado ni sobre uno que espera el visto de Gerencia, ni pisa lo que cambió después de pintarse la ficha (p_visto).';
revoke all on function public.tramites_actualizar(uuid, text, text, text, text, date, date, text, timestamptz) from public, anon;
grant execute on function public.tramites_actualizar(uuid, text, text, text, text, date, date, text, timestamptz) to authenticated;

-- 12. Lo que cada quien lee ---------------------------------------------------------------------------
-- La lista y la ficha suman el cierre: cuándo se concluyó, hasta cuándo vale el
-- documento, cuántos archivos tiene en pie y lo que quien pregunta puede hacer.
-- Uno concluido deja de contar plazo: ya no vence. Cambian las columnas que
-- devuelve, así que la función se vuelve a crear.
drop function if exists public.tramites_visibles(uuid);
create function public.tramites_visibles(p_id uuid)
returns table (
  id uuid, numero text, estado text, situacion text, creado_en timestamptz, actualizado_en timestamptz,
  tipo_id uuid, tipo text, se_renueva boolean, ambito text, entidad text, asunto text, expediente text,
  fecha_inicio date, fecha_limite date, dias_para_limite integer, vencido boolean, nota text,
  unidad_id uuid, placa text, codigo_interno text, carroceria text, cliente text,
  orden_id uuid, orden_numero text,
  registro text, registro_puesto text,
  anulacion_pedida_en timestamptz, anulacion_pidio text, motivo_anulacion text,
  anulacion_rechazada_en timestamptz, anulacion_rechazo text, anulacion_rechazo_motivo text,
  anulado_en timestamptz, anulo text,
  puede_actualizar boolean, puede_pedir_anulacion boolean, puede_resolver_anulacion boolean,
  fecha_conclusion date, vigente_hasta date, concluido_en timestamptz, concluyo text,
  archivos integer, puede_llevar_expediente boolean, puede_concluir boolean)
language plpgsql stable security definer set search_path to 'public' rows 200 as $$
#variable_conflict use_column
declare
  v_todos    boolean := public.tramites_ve_todos();
  v_unidades boolean := public.tramites_ve_los_de_unidades();
  v_gestiona boolean;
  v_aprueba  boolean;
  v_hoy      constant date := (now() at time zone 'America/Lima')::date;
begin
  if not (v_todos or v_unidades) then
    return;
  end if;
  v_gestiona := public.es_admin() or public.tiene_permiso('tramites.gestionar');
  v_aprueba  := public.es_admin() or public.tiene_permiso('tramites.aprobar_anulacion');
  return query
  with base as (
    select t.*,
           (t.estado <> 'ANULADO' and t.anulacion_pedida_en is not null and t.anulacion_rechazada_en is null) as espera_visto,
           -- Mientras se lleva: ni anulado ni concluido.
           t.estado in ('POR_INICIAR', 'EN_TRAMITE', 'OBSERVADO') as abierto
      from public.tramites t
     where (p_id is null or t.id = p_id)
       and (v_todos or t.ambito = 'UNIDAD')
  )
  select b.id, b.numero, b.estado, case when b.espera_visto then 'POR_ANULAR' else b.estado end,
         b.creado_en, b.actualizado_en,
         b.tipo_id, b.tipo_nombre, b.se_renueva, b.ambito, b.entidad, b.asunto, b.expediente,
         b.fecha_inicio, b.fecha_limite,
         case when b.abierto and b.fecha_limite is not null then b.fecha_limite - v_hoy end,
         b.abierto and b.fecha_limite is not null and b.fecha_limite < v_hoy,
         b.nota,
         b.unidad_id, u.placa::text, u.codigo_interno::text, tc.nombre::text, c.razon_social::text,
         b.orden_id, o.numero::text,
         btrim(re.nombres || ' ' || re.apellidos), rre.nombre::text,
         b.anulacion_pedida_en, btrim(pi.nombres || ' ' || pi.apellidos), b.motivo_anulacion,
         b.anulacion_rechazada_en, btrim(rz.nombres || ' ' || rz.apellidos), b.anulacion_rechazo_motivo,
         b.anulado_en, btrim(an.nombres || ' ' || an.apellidos),
         v_gestiona and b.abierto and not b.espera_visto,
         v_gestiona and b.estado <> 'ANULADO' and not b.espera_visto,
         v_aprueba and b.espera_visto,
         b.fecha_conclusion, b.vigente_hasta, b.concluido_en, btrim(co.nombres || ' ' || co.apellidos),
         (select count(*)::integer from public.tramite_archivos a where a.tramite_id = b.id and a.retirado_en is null),
         v_gestiona and b.estado <> 'ANULADO' and not b.espera_visto,
         v_gestiona and b.estado in ('EN_TRAMITE', 'OBSERVADO') and not b.espera_visto
    from base b
    left join public.unidades u on u.id = b.unidad_id
    left join public.tipos_carroceria tc on tc.id = u.tipo_carroceria_id
    left join public.clientes c on c.id = b.cliente_id
    left join public.ordenes_trabajo o on o.id = b.orden_id
    join public.usuarios re on re.id = b.registrado_por
    left join public.roles rre on rre.id = re.rol_id
    left join public.usuarios pi on pi.id = b.anulacion_pedida_por
    left join public.usuarios rz on rz.id = b.anulacion_rechazada_por
    left join public.usuarios an on an.id = b.anulado_por
    left join public.usuarios co on co.id = b.concluido_por
   order by b.creado_en desc, b.numero desc;
end;
$$;
comment on function public.tramites_visibles(uuid) is
  'Los trámites (uno, o todos con p_id vacío) para quien puede verlos —todos, o solo los de una unidad para Ventas—, con su tipo, su unidad, su cliente, su OT, los días que faltan para su fecha límite (con la fecha de Lima; uno concluido ya no vence), su cierre, cuántos archivos tiene su expediente y lo que quien pregunta puede hacer en cada uno.';
revoke all on function public.tramites_visibles(uuid) from public, anon;
grant execute on function public.tramites_visibles(uuid) to authenticated;

-- El expediente de un trámite, para quien lo ve, con el nombre de quien subió
-- y de quien retiró: quien ve el trámite no siempre lee la tabla de usuarios.
-- Los retirados, solo para quien ve todos los trámites.
create or replace function public.tramites_archivos(p_tramite uuid)
returns table (
  id uuid, clase text, descripcion text, nombre text, mime text, tamano integer,
  subido_en timestamptz, subio text, retirado_en timestamptz, retiro text, retiro_motivo text, puede_retirar boolean)
language plpgsql stable security definer set search_path to 'public' rows 30 as $$
#variable_conflict use_column
declare
  v_todos    boolean := public.tramites_ve_todos();
  v_unidades boolean := public.tramites_ve_los_de_unidades();
  v_t        public.tramites%rowtype;
  v_puede    boolean;
begin
  if not (v_todos or v_unidades) then
    return;
  end if;
  select * into v_t from public.tramites t where t.id = p_tramite and (v_todos or t.ambito = 'UNIDAD');
  if not found then
    return;
  end if;
  v_puede := (public.es_admin() or public.tiene_permiso('tramites.gestionar'))
             and v_t.estado <> 'ANULADO'
             and not (v_t.anulacion_pedida_en is not null and v_t.anulacion_rechazada_en is null);
  return query
  select a.id, a.clase, a.descripcion, a.archivo_nombre, a.archivo_mime, a.archivo_tamano,
         a.creado_en, btrim(su.nombres || ' ' || su.apellidos),
         a.retirado_en, btrim(rt.nombres || ' ' || rt.apellidos), a.retiro_motivo,
         v_puede and a.retirado_en is null
    from public.tramite_archivos a
    join public.usuarios su on su.id = a.subido_por
    left join public.usuarios rt on rt.id = a.retirado_por
   where a.tramite_id = p_tramite
     and (a.retirado_en is null or v_todos)
   order by a.creado_en desc, a.id;
end;
$$;
comment on function public.tramites_archivos(uuid) is
  'Los archivos del expediente de un trámite para quien lo ve, del más reciente al más viejo, con quién lo subió y si quien pregunta lo puede retirar. Los retirados, solo para quien ve todos los trámites.';
revoke all on function public.tramites_archivos(uuid) from public, anon;
grant execute on function public.tramites_archivos(uuid) to authenticated;

create or replace function public.tramites_gestiones(p_tramite uuid)
returns table (id uuid, fecha date, detalle text, anotado_en timestamptz, anoto text)
language plpgsql stable security definer set search_path to 'public' rows 30 as $$
#variable_conflict use_column
declare
  v_todos    boolean := public.tramites_ve_todos();
  v_unidades boolean := public.tramites_ve_los_de_unidades();
begin
  if not (v_todos or v_unidades) then
    return;
  end if;
  if not exists (select 1 from public.tramites t where t.id = p_tramite and (v_todos or t.ambito = 'UNIDAD')) then
    return;
  end if;
  return query
  select g.id, g.fecha, g.detalle, g.creado_en, btrim(us.nombres || ' ' || us.apellidos)
    from public.tramite_gestiones g
    join public.usuarios us on us.id = g.registrado_por
   where g.tramite_id = p_tramite
   order by g.fecha desc, g.creado_en desc, g.id;
end;
$$;
comment on function public.tramites_gestiones(uuid) is
  'Las gestiones anotadas de un trámite para quien lo ve, de la más reciente a la más vieja, con quién la anotó.';
revoke all on function public.tramites_gestiones(uuid) from public, anon;
grant execute on function public.tramites_gestiones(uuid) to authenticated;

-- 13. El permiso dice lo que ahora permite -------------------------------------------------------
update public.permisos
   set descripcion = 'Registrar los trámites de las unidades y de la empresa, llevar su estado y sus fechas, guardar su expediente (archivos y gestiones), cerrarlos con el documento final, mantener el catálogo de tipos y pedir la anulación de uno'
 where codigo = 'tramites.gestionar'
   and descripcion is distinct from 'Registrar los trámites de las unidades y de la empresa, llevar su estado y sus fechas, guardar su expediente (archivos y gestiones), cerrarlos con el documento final, mantener el catálogo de tipos y pedir la anulación de uno';
